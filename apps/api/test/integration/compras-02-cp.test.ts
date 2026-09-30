import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createPool, type Db, type Tx } from "@agro/db";
import { configuracaoNeutraTopV3, MSG_ITENS_DO_RECEBIMENTO } from "@agro/domain";
import { appCom, escoposDeTodosOsModulos, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * RECEBER O PEDIDO DE COMPRA (COMPRAS-02, decisão 268) — CP-1..CP-8 da missão.
 *
 * O QUE CONTA COMO PROVA. Nenhuma asserção decisiva é só status HTTP: a situação do pedido, a origem da compra, a
 * ligação de cada item (`origem_item_id`), a soma ligada (o saldo é CONTA), as compras geradas e a auditoria são
 * LIDAS NO BANCO por conexão própria (superusuário, sem RLS). Toda asserção de "zero efeito" vem com a PREMISSA ao
 * lado: o mesmo cenário, corrigido, produz o efeito.
 *
 * O GRAFO É MONTADO PELA API ADMINISTRATIVA (`destinos` com `emPartes` na criação da TOP de pedido) — a mesma porta
 * do editor —, e nunca por SQL: CP-1 prova que a própria escrita aceita pedido → compra e recusa o resto.
 *
 * DUAS INSTÂNCIAS DA API sobre o mesmo banco: `h.app` com o gate da execução configurada DESLIGADO e `ligada` com
 * `TOP_EFFECTS_RUNTIME_V1_ENABLED=1` (o de produção), para o item 0 (CP-8), que só existe com a execução configurada.
 */
let h: Harness; let ligada: FastifyInstance; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
type Hdr = Record<string, string>;
type Resposta = { statusCode: number; body: string; json: () => unknown };
type Erro = { code: string; message: string; details?: unknown };
const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: Erro };

const COMPRA = "compras.compra";
const PEDIDO = "compras.pedido";
const DATA = "2026-09-10";
/** A MESMA recusa para política não declarada, declarada vazia e TOP fora do leque (contrato da fatia). */
const SEM_PROXIMA = "A TOP deste pedido não tem próxima operação configurada.";

let seq = 0;
const unico = () => `${Date.now().toString(36).slice(-4)}${++seq}`;

beforeAll(async () => {
  h = await harness();
  ligada = await appCom(h, { TOP_EFFECTS_RUNTIME_V1_ENABLED: "1" });
  I = await ids(h);
  admin = createPool(TEST_URL, { max: 4 });
}, 240_000);
afterAll(async () => { await ligada?.close(); await h?.app.close(); await h?.db.end(); await admin?.end(); });

// ---------------------------------------------------------------------------------------------------------
// Cenário
// ---------------------------------------------------------------------------------------------------------
const criarTop = (codigoBase: string, extra: Record<string, unknown> = {}) =>
  ligada.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: `5${String(++seq).padStart(3, "0")}${Math.floor(Math.random() * 90 + 10)}`, codigoBase, nome: `TOP CP ${codigoBase} ${seq}`, ...extra } });
async function top(codigoBase: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await criarTop(codigoBase, extra);
  expect(r.statusCode, `premissa: a TOP ${codigoBase} é cadastrada — ${r.body}`).toBe(201);
  return (j(r) as { id: string }).id;
}
/** TOP de Compra (padrão: entrada + conta a pagar) e TOP de Pedido de compra com a aresta para ela, pela API. */
async function grafo(emPartes: boolean, configuracaoCompra?: unknown): Promise<{ topCompra: string; topPedido: string }> {
  const topCompra = await top(COMPRA, configuracaoCompra ? { configuracao: configuracaoCompra } : {});
  const topPedido = await top(PEDIDO, { destinos: [{ tipoOperacaoId: topCompra, ordem: 0, emPartes }] });
  return { topCompra, topPedido };
}

/** Produto NOVO por SQL (admin), no modelo de um do seed: cada cenário lê a própria soma, sem herdar de outro. */
async function produto(): Promise<string> {
  const m = (await admin.query<Record<string, string>>("select measurement_id, group_id, category_id, kind_id, financial_category_id from erp.products where id=$1", [I.product2])).rows[0]!;
  const s = unico();
  return (await admin.query<{ id: string }>(
    `insert into erp.products (organization_id, code, description, measurement_id, group_id, category_id, kind_id, financial_category_id, control_stock, controle_lote, has_lot)
     values ($1,$2,$3,$4,$5,$6,$7,$8,true,'nenhum',false) returning id`,
    [h.demo.orgId, `CP${s}`, `Produto CP ${s}`, m.measurement_id, m.group_id, m.category_id, m.kind_id, m.financial_category_id])).rows[0]!.id;
}
async function condicao(parcelas: number): Promise<string> {
  const s = unico();
  return (await admin.query<{ id: string }>(
    "insert into erp.condicoes_pagamento(organization_id,code,nome,parcelas,dias_primeira_parcela,modo,intervalo_dias,entrada) values ($1,$2,$3,$4,30,'intervalo',30,false) returning id",
    [h.demo.orgId, `CP-${s}`, `Condição CP ${s}`, parcelas])).rows[0]!.id;
}

type ItemPedido = { produto_id: string; quantidade: string; valor_unitario: string };
type Pedido = { id: string; codigo: string; itens: { id: string; produto_id: string; quantidade: string }[] };
async function pedido(topPedido: string, itens: ItemPedido[], app: FastifyInstance = h.app): Promise<Pedido> {
  const r = await app.inject({ method: "POST", url: "/api/compras/pedidos", headers: h.headers(),
    payload: { empresa_id: I.empresa, tipo_operacao_id: topPedido, fornecedor_id: I.provider, data_documento: DATA,
      categoria_financeira_id: I.category, centro_custo_id: I.costCenter, itens: itens.map((i) => ({ armazem_id: I.warehouse, ...i })) } });
  expect(r.statusCode, `premissa: o pedido é lançado — ${r.body}`).toBe(201);
  const id = (j(r) as { id: string }).id;
  const codigo = (await admin.query<{ codigo: string }>("select codigo from erp.documentos_compra where id=$1", [id])).rows[0]!.codigo;
  const linhas = (await admin.query<{ id: string; produto_id: string; quantidade: string }>(
    "select id, produto_id, quantidade::text from erp.documentos_compra_itens where documento_id=$1 order by posicao, id", [id])).rows;
  return { id, codigo, itens: linhas };
}

type ItemRecebido = { item_origem_id: string; quantidade: string } & Record<string, unknown>;
/** O corpo do recebimento: o de lançar compra sem empresa e fornecedor, cada item com `item_origem_id`. */
const corpoDoRecebimento = (topCompra: string, itens: ItemRecebido[], extra: Record<string, unknown> = {}) => ({
  tipo_operacao_id: topCompra, data_documento: DATA, categoria_financeira_id: I.category, centro_custo_id: I.costCenter,
  itens: itens.map((i) => ({ armazem_id: I.warehouse, valor_unitario: "5.00", ...i })), ...extra,
});
const receber = (pedidoId: string, topCompra: string, itens: ItemRecebido[], extra: Record<string, unknown> = {}, headers: Hdr = h.headers(), app: FastifyInstance = h.app) =>
  app.inject({ method: "POST", url: `/api/compras/pedidos/${pedidoId}/convert`, headers, payload: corpoDoRecebimento(topCompra, itens, extra) });
type Recebido = { id: string; codigo: string; especie: string; situacao: string; from: string; pedidoSituacao: string };
async function recebida(pedidoId: string, topCompra: string, itens: ItemRecebido[], extra: Record<string, unknown> = {}, app: FastifyInstance = h.app): Promise<Recebido> {
  const r = await receber(pedidoId, topCompra, itens, extra, h.headers(), app);
  expect(r.statusCode, r.body).toBe(201);
  return j(r) as unknown as Recebido;
}
const proximosPassos = (id: string, headers: Hdr = h.headers()) =>
  h.app.inject({ method: "GET", url: `/api/compras/pedidos/${id}/proximos-passos`, headers });
const encerrar = (id: string, payload: unknown, chave?: string) =>
  h.app.inject({ method: "POST", url: `/api/compras/pedidos/${id}/encerrar-saldo`, headers: h.headers(chave ? { "idempotency-key": chave } : {}), payload: payload as Record<string, unknown> });
const cancelar = (especie: "pedido" | "compra", id: string) =>
  h.app.inject({ method: "POST", url: `/api/compras/${especie === "pedido" ? "pedidos" : "compras"}/${id}/cancel`, headers: h.headers(), payload: {} });
async function confirmada(id: string, app: FastifyInstance = h.app) {
  const r = await app.inject({ method: "POST", url: `/api/compras/compras/${id}/confirm`, headers: h.headers(), payload: {} });
  expect(r.statusCode, `premissa: a compra gerada confirma — ${r.body}`).toBe(200);
}

type PedidoLido = { situacao: string; codigo: string; itens: { id: string; recebido: string; saldo: string }[]; compras_geradas: { id: string; codigo: string; situacao: string }[] };
async function lerPedido(id: string): Promise<PedidoLido> {
  const r = await h.app.inject({ method: "GET", url: `/api/compras/pedidos/${id}`, headers: h.headers() });
  expect(r.statusCode, r.body).toBe(200);
  return j(r) as unknown as PedidoLido;
}

// ---- leituras no banco ----
const situacao = async (id: string) => (await admin.query<{ situacao: string }>("select situacao from erp.documentos_compra where id=$1", [id])).rows[0]!.situacao;
/** Soma ligada ao item de origem em compras NÃO canceladas — a conta do saldo, lida no banco. */
const ligado = async (itemId: string) => (await admin.query<{ n: string }>(
  `select coalesce(sum(i.quantidade),0)::text n from erp.documentos_compra_itens i
     join erp.documentos_compra c on c.id=i.documento_id where i.origem_item_id=$1 and c.situacao<>'cancelado'`, [itemId])).rows[0]!.n;
/** Compras com origem neste pedido (todas, inclusive canceladas: é a história do pedido). */
const comprasDoPedido = async (id: string) => Number((await admin.query<{ n: string }>(
  "select count(*)::text n from erp.documentos_compra where origem_documento_id=$1", [id])).rows[0]!.n);
const auditoria = async (id: string, acao: string) => (await admin.query<{ metadata: Record<string, unknown> | null; after: Record<string, unknown> | null }>(
  "select metadata, after from erp.audit_logs where entity='documentos_compra' and entity_id=$1 and action=$2 order by created_at, id", [id, acao])).rows;
const caminhos = (r: Resposta) => ((j(r).error?.details as { path?: string }[] | undefined) ?? []).map((d) => d.path);

async function membro(nome: string, perms: string[]): Promise<Hdr> {
  const email = `${nome.toLowerCase().replace(/\W+/g, "")}${unico()}@cp02.local`;
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome} ${unico()}`, permissions: perms } });
  expect(papel.statusCode, papel.body).toBe(201);
  const v = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Restrito@12345", role_id: j(papel).id, escopos_empresas: escoposDeTodosOsModulos([]) } });
  expect(v.statusCode, v.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Restrito@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}

// ---------------------------------------------------------------------------------------------------------
// CP-1 — o grafo de compras
// ---------------------------------------------------------------------------------------------------------
describe("CP-1 — grafo: pedido → compra aceito; compra → pedido e compra × vendas recusados (422)", () => {
  it("CP-1a a escrita da TOP aceita pedido → compra e recusa compra → pedido e compra × vendas nos dois sentidos, com a MESMA recusa", async () => {
    const topCompra = await top(COMPRA); const topPedidoAlvo = await top(PEDIDO);
    const topVenda = await top("vendas.venda"); const topPedidoVenda = await top("vendas.pedido");

    // ACEITO: pedido de compra → compra, com e sem "Em partes"; a versão declara a política.
    for (const emPartes of [false, true]) {
      const id = await top(PEDIDO, { destinos: [{ tipoOperacaoId: topCompra, ordem: 0, emPartes }] });
      const lido = await h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${id}`, headers: h.headers() });
      expect(lido.statusCode, lido.body).toBe(200);
      const b = j(lido) as { destinosConfigurados?: boolean; destinos: { tipoOperacaoId: string; emPartes?: boolean }[] };
      expect(b.destinos.map((d) => [d.tipoOperacaoId, Boolean(d.emPartes)]), "a aresta foi gravada como enviada").toEqual([[topCompra, emPartes]]);
      expect(b.destinosConfigurados).toBe(true);
    }

    // RECUSADO: compra → pedido; compra × vendas (nos dois sentidos); pedido de compra → pedido de compra (mesma família).
    const antes = Number((await admin.query<{ n: string }>("select count(*)::text n from erp.tipos_operacao where organization_id=$1", [h.demo.orgId])).rows[0]!.n);
    const casos: [string, string, string][] = [
      ["compra → pedido", COMPRA, topPedidoAlvo],
      ["pedido de compra → venda", PEDIDO, topVenda],
      ["compra → venda", COMPRA, topVenda],
      ["pedido de venda → compra", "vendas.pedido", topCompra],
      ["venda → pedido de compra", "vendas.venda", topPedidoAlvo],
      ["pedido de compra → pedido de compra", PEDIDO, topPedidoAlvo],
    ];
    const recusas: Resposta[] = [];
    for (const [nome, origem, destino] of casos) {
      const r = await criarTop(origem, { destinos: [{ tipoOperacaoId: destino, ordem: 0 }] });
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(422);
      expect(j(r).error!.code, nome).toBe("TIPO_OPERACAO_INDISPONIVEL");
      recusas.push(r);
    }
    // A superfície de recusa é ÚNICA: família incompatível é indistinguível de destino inexistente.
    const inexistente = await criarTop(PEDIDO, { destinos: [{ tipoOperacaoId: "00000000-0000-4000-8000-000000000000", ordem: 0 }] });
    expect(inexistente.statusCode).toBe(422);
    for (const r of recusas) expect([j(r).error!.code, j(r).error!.message]).toEqual([j(inexistente).error!.code, j(inexistente).error!.message]);
    expect(Number((await admin.query<{ n: string }>("select count(*)::text n from erp.tipos_operacao where organization_id=$1", [h.demo.orgId])).rows[0]!.n),
      "nenhuma recusa gravou TOP").toBe(antes);
    // PREMISSA das recusas de vendas: a aresta de vendas continua aceita (vendas não mudou).
    await top("vendas.pedido", { destinos: [{ tipoOperacaoId: topVenda, ordem: 0 }] });
    expect(topPedidoVenda).toBeTruthy();
  });

  it("CP-1b /destinos-possiveis: pedido de compra → só TOPs de Compra; compra → nenhuma; vendas nunca oferece compra", async () => {
    const topCompra = await top(COMPRA); const topPedido = await top(PEDIDO); const topVenda = await top("vendas.venda");
    const possiveis = async (codigoBase: string) => {
      const r = await h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/destinos-possiveis?codigoBase=${codigoBase}`, headers: h.headers() });
      expect(r.statusCode, r.body).toBe(200);
      return (j(r) as unknown as { items: { id: string; codigoBase: string }[] }).items;
    };
    const doPedido = await possiveis(PEDIDO);
    expect(doPedido.map((i) => i.id), "a TOP de Compra é oferecida ao pedido de compra").toContain(topCompra);
    expect(new Set(doPedido.map((i) => i.codigoBase)), "e SÓ TOPs de Compra").toEqual(new Set([COMPRA]));
    expect(doPedido.map((i) => i.id)).not.toContain(topVenda);
    expect(doPedido.map((i) => i.id)).not.toContain(topPedido);
    expect(await possiveis(COMPRA), "a compra é o fim da cadeia").toEqual([]);
    for (const familia of ["vendas.orcamento", "vendas.pedido", "vendas.venda"]) {
      const itens = await possiveis(familia);
      expect(itens.length, `premissa: ${familia} tem destinos de vendas`).toBeGreaterThan(0);
      expect(itens.filter((i) => i.codigoBase.startsWith("compras.")), `${familia} nunca oferece compra`).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------
// CP-2 — receber inteiro (aresta SEM "Em partes")
// ---------------------------------------------------------------------------------------------------------
describe("CP-2 — receber inteiro: compra com origem e ligações; pedido convertido; faltar item ou quantidade menor → 422", () => {
  it("CP-2a próximos passos declaram a aresta; recusas sem efeito; o inteiro gera a compra ligada e converte o pedido", async () => {
    const { topCompra, topPedido } = await grafo(false);
    const a = await produto(); const b = await produto();
    const p = await pedido(topPedido, [{ produto_id: a, quantidade: "10", valor_unitario: "5.00" }, { produto_id: b, quantidade: "4", valor_unitario: "12.50" }]);
    const [ia, ib] = p.itens;

    const pp = await proximosPassos(p.id);
    expect(pp.statusCode, pp.body).toBe(200);
    expect(j(pp)).toMatchObject({ contractVersion: 1, politicaConfigurada: true, items: [{ tipoOperacaoId: topCompra, especie: "compra", emPartes: false, codigoBase: COMPRA }] });

    // FALTAR ITEM: só o A, com o saldo inteiro.
    const falta = await receber(p.id, topCompra, [{ item_origem_id: ia!.id, quantidade: "10" }]);
    expect(falta.statusCode, falta.body).toBe(422);
    expect(j(falta).error!.code).toBe("VALIDATION_ERROR");
    expect(j(falta).error!.message).toBe(MSG_ITENS_DO_RECEBIMENTO.recebimento_incompleto);
    expect(caminhos(falta)).toContain("itens");
    // QUANTIDADE MENOR QUE O SALDO: B com 3 de 4.
    const menor = await receber(p.id, topCompra, [{ item_origem_id: ia!.id, quantidade: "10" }, { item_origem_id: ib!.id, quantidade: "3" }]);
    expect(menor.statusCode, menor.body).toBe(422);
    expect(caminhos(menor)).toContain("itens[1].quantidade");
    // CONTRATO ESTRITO: produto ou fornecedor no corpo são recusados, nunca descartados.
    const comProduto = await receber(p.id, topCompra, [{ item_origem_id: ia!.id, quantidade: "10", produto_id: a }, { item_origem_id: ib!.id, quantidade: "4" }]);
    expect(comProduto.statusCode, comProduto.body).toBe(422);
    const comFornecedor = await receber(p.id, topCompra, [{ item_origem_id: ia!.id, quantidade: "10" }, { item_origem_id: ib!.id, quantidade: "4" }], { fornecedor_id: I.provider });
    expect(comFornecedor.statusCode, comFornecedor.body).toBe(422);
    expect([await situacao(p.id), await comprasDoPedido(p.id)], "nenhuma recusa gravou compra nem mexeu no pedido").toEqual(["aberto", 0]);

    // PREMISSA: o recebimento INTEIRO — preço da NOTA no corpo (A a 5,50, não os 5,00 do pedido).
    const nota = `N${unico()}`;
    const c = await recebida(p.id, topCompra, [
      { item_origem_id: ia!.id, quantidade: "10", valor_unitario: "5.50" },
      { item_origem_id: ib!.id, quantidade: "4", valor_unitario: "12.50", desconto: "1.00" },
    ], { numero_nota: nota, serie_nota: "1", data_entrada: "2026-09-12" });
    expect(c).toMatchObject({ especie: "compra", situacao: "aberto", from: p.id, pedidoSituacao: "convertido" });

    // NO BANCO: a compra aponta o pedido, com empresa e fornecedor dele; cada linha aponta o item do pedido.
    const cab = (await admin.query<{ origem_documento_id: string; empresa_id: string; fornecedor_id: string; especie: string; numero_nota: string; valor_total: string }>(
      "select origem_documento_id, empresa_id, fornecedor_id, especie, numero_nota, valor_total::text from erp.documentos_compra where id=$1", [c.id])).rows[0]!;
    expect(cab).toEqual({ origem_documento_id: p.id, empresa_id: I.empresa, fornecedor_id: I.provider, especie: "compra", numero_nota: nota, valor_total: "104.00" });
    const linhas = (await admin.query<{ origem_item_id: string; produto_id: string; quantidade: string; valor_unitario: string }>(
      "select origem_item_id, produto_id, quantidade::text, valor_unitario::text from erp.documentos_compra_itens where documento_id=$1 order by posicao", [c.id])).rows;
    expect(linhas).toEqual([
      { origem_item_id: ia!.id, produto_id: a, quantidade: "10.0000", valor_unitario: "5.500000" },
      { origem_item_id: ib!.id, produto_id: b, quantidade: "4.0000", valor_unitario: "12.500000" },
    ]);
    expect([await situacao(p.id), await ligado(ia!.id), await ligado(ib!.id)]).toEqual(["convertido", "10.0000", "4.0000"]);

    // LEITURA: o pedido mostra recebido, saldo e a compra gerada; a compra mostra a origem.
    const lido = await lerPedido(p.id);
    expect(lido.situacao).toBe("convertido");
    expect(lido.itens.map((i) => [i.recebido, i.saldo])).toEqual([["10.0000", "0.0000"], ["4.0000", "0.0000"]]);
    expect(lido.compras_geradas).toEqual([{ id: c.id, codigo: c.codigo, situacao: "aberto" }]);
    const compra = await h.app.inject({ method: "GET", url: `/api/compras/compras/${c.id}`, headers: h.headers() });
    expect(compra.statusCode, compra.body).toBe(200);
    expect(j(compra)).toMatchObject({ origem_documento_id: p.id, origem_codigo: p.codigo });
    expect((j(compra).itens as { origem_item_id: string }[]).map((i) => i.origem_item_id)).toEqual([ia!.id, ib!.id]);

    // AUDITORIA NOS DOIS DOCUMENTOS.
    const conv = await auditoria(p.id, "convert");
    expect(conv.length).toBe(1);
    expect(conv[0]!.metadata).toMatchObject({ to: c.id });
    expect((await auditoria(c.id, "create")).some((l) => l.metadata?.["from"] === p.id), "o create da compra diz de onde veio").toBe(true);

    // CONVERTIDO NÃO RECEBE MAIS: 409, e nenhuma compra nova.
    const de_novo = await receber(p.id, topCompra, [{ item_origem_id: ia!.id, quantidade: "1" }]);
    expect(de_novo.statusCode, de_novo.body).toBe(409);
    expect(await comprasDoPedido(p.id)).toBe(1);
  });

  it("CP-2b capacidade: pedidos_compra.edit sem compras.create → 403 sem efeito; com compras.create → 201", async () => {
    const { topCompra, topPedido } = await grafo(false);
    const a = await produto();
    const p = await pedido(topPedido, [{ produto_id: a, quantidade: "2", valor_unitario: "5.00" }]);
    const itens = [{ item_origem_id: p.itens[0]!.id, quantidade: "2" }];
    const semCriar = await membro("Sem Criar Compra", ["pedidos_compra.view", "pedidos_compra.edit"]);
    const r = await receber(p.id, topCompra, itens, {}, semCriar);
    expect(r.statusCode, r.body).toBe(403);
    expect([await situacao(p.id), await comprasDoPedido(p.id)]).toEqual(["aberto", 0]);
    const comCriar = await membro("Com Criar Compra", ["pedidos_compra.view", "pedidos_compra.edit", "compras.create"]);
    const ok = await receber(p.id, topCompra, itens, {}, comCriar);
    expect(ok.statusCode, ok.body).toBe(201);
    expect([await situacao(p.id), await comprasDoPedido(p.id)]).toEqual(["convertido", 1]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// CP-3 — em partes
// ---------------------------------------------------------------------------------------------------------
describe("CP-3 — em partes: duas parciais; a terceira acima do saldo → 422; a que zera converte", () => {
  it("CP-3 pedido A 10 · B 2 → parte A4 → parte A3+B2 → A4 (saldo 3) recusada → A3 converte", async () => {
    const { topCompra, topPedido } = await grafo(true);
    const a = await produto(); const b = await produto();
    const p = await pedido(topPedido, [{ produto_id: a, quantidade: "10", valor_unitario: "5.00" }, { produto_id: b, quantidade: "2", valor_unitario: "7.00" }]);
    const [ia, ib] = p.itens;
    expect(j(await proximosPassos(p.id))).toMatchObject({ politicaConfigurada: true, items: [{ tipoOperacaoId: topCompra, emPartes: true }] });

    const p1 = await recebida(p.id, topCompra, [{ item_origem_id: ia!.id, quantidade: "4" }]);
    expect(p1.pedidoSituacao).toBe("aberto");
    expect([await situacao(p.id), await ligado(ia!.id), await ligado(ib!.id)]).toEqual(["aberto", "4.0000", "0"]);

    const p2 = await recebida(p.id, topCompra, [{ item_origem_id: ia!.id, quantidade: "3" }, { item_origem_id: ib!.id, quantidade: "2" }]);
    expect(p2.pedidoSituacao).toBe("aberto");
    expect([await situacao(p.id), await ligado(ia!.id), await ligado(ib!.id)]).toEqual(["aberto", "7.0000", "2.0000"]);
    expect((await lerPedido(p.id)).itens.map((i) => i.saldo)).toEqual(["3.0000", "0.0000"]);

    // ACIMA DO SALDO: 4 onde restam 3. Item já sem saldo e item repetido também são 422 no item.
    const acima = await receber(p.id, topCompra, [{ item_origem_id: ia!.id, quantidade: "4" }]);
    expect(acima.statusCode, acima.body).toBe(422);
    expect(j(acima).error!.message).toBe(MSG_ITENS_DO_RECEBIMENTO.acima_do_saldo);
    expect(caminhos(acima)).toContain("itens[0].quantidade");
    const semSaldo = await receber(p.id, topCompra, [{ item_origem_id: ib!.id, quantidade: "1" }]);
    expect(semSaldo.statusCode, semSaldo.body).toBe(422);
    const repetido = await receber(p.id, topCompra, [{ item_origem_id: ia!.id, quantidade: "1" }, { item_origem_id: ia!.id, quantidade: "1" }]);
    expect(repetido.statusCode, repetido.body).toBe(422);
    expect(caminhos(repetido)).toContain("itens[1].item_origem_id");
    expect([await situacao(p.id), await comprasDoPedido(p.id), await ligado(ia!.id)], "as recusas não gravaram nada").toEqual(["aberto", 2, "7.0000"]);

    // A QUE ZERA O SALDO converte o pedido.
    const p3 = await recebida(p.id, topCompra, [{ item_origem_id: ia!.id, quantidade: "3" }]);
    expect(p3.pedidoSituacao).toBe("convertido");
    expect([await situacao(p.id), await ligado(ia!.id), await ligado(ib!.id)]).toEqual(["convertido", "10.0000", "2.0000"]);
    const lido = await lerPedido(p.id);
    expect(lido.itens.map((i) => i.saldo)).toEqual(["0.0000", "0.0000"]);
    expect(lido.compras_geradas.map((c) => c.id)).toEqual([p1.id, p2.id, p3.id]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// CP-4 — cancelar a compra parte
// ---------------------------------------------------------------------------------------------------------
describe("CP-4 — cancelar a compra (aberta e confirmada): o pedido reabre e o saldo volta; com saldo encerrado, não reabre", () => {
  it("CP-4a compra ABERTA que zerou o saldo: cancelar reabre o pedido e devolve o saldo", async () => {
    const { topCompra, topPedido } = await grafo(true);
    const a = await produto();
    const p = await pedido(topPedido, [{ produto_id: a, quantidade: "6", valor_unitario: "5.00" }]);
    const ia = p.itens[0]!;
    await recebida(p.id, topCompra, [{ item_origem_id: ia.id, quantidade: "2" }]);
    const ultima = await recebida(p.id, topCompra, [{ item_origem_id: ia.id, quantidade: "4" }]);
    expect([await situacao(p.id), await ligado(ia.id)], "premissa: o saldo zerou").toEqual(["convertido", "6.0000"]);

    const r = await cancelar("compra", ultima.id);
    expect(r.statusCode, r.body).toBe(200);
    expect([await situacao(ultima.id), await situacao(p.id), await ligado(ia.id)]).toEqual(["cancelado", "aberto", "2.0000"]);
    expect((await lerPedido(p.id)).itens.map((i) => i.saldo)).toEqual(["4.0000"]);
    const aud = await auditoria(p.id, "compra_cancelada");
    expect(aud.length).toBe(1);
    expect(aud[0]!.after).toMatchObject({ situacao: "aberto" });
    // O saldo devolvido é recebível de novo.
    await recebida(p.id, topCompra, [{ item_origem_id: ia.id, quantidade: "4" }]);
    expect(await situacao(p.id)).toBe("convertido");
  });

  it("CP-4b compra CONFIRMADA que zerou o saldo: cancelar estorna, reabre o pedido e devolve o saldo", async () => {
    const { topCompra, topPedido } = await grafo(false);
    const a = await produto();
    const p = await pedido(topPedido, [{ produto_id: a, quantidade: "5", valor_unitario: "8.00" }]);
    const ia = p.itens[0]!;
    const c = await recebida(p.id, topCompra, [{ item_origem_id: ia.id, quantidade: "5", valor_unitario: "8.00" }]);
    await confirmada(c.id);
    const entradas = async () => Number((await admin.query<{ n: string }>(
      "select count(*)::text n from erp.stock_movements where source_type='documentos_compra' and source_id=$1 and movement_type='receipt'", [c.id])).rows[0]!.n);
    expect([await situacao(c.id), await situacao(p.id), await entradas()], "premissa: compra confirmada, pedido convertido").toEqual(["confirmado", "convertido", 1]);

    const r = await cancelar("compra", c.id);
    expect(r.statusCode, r.body).toBe(200);
    const estornos = Number((await admin.query<{ n: string }>(
      "select count(*)::text n from erp.stock_movements where source_type='documentos_compra' and source_id=$1 and movement_type='reversal'", [c.id])).rows[0]!.n);
    expect([await situacao(c.id), estornos, await situacao(p.id), await ligado(ia.id)]).toEqual(["cancelado", 1, "aberto", "0"]);
    expect((await lerPedido(p.id)).itens.map((i) => [i.recebido, i.saldo])).toEqual([["0.0000", "5.0000"]]);
  });

  it("CP-4c com o saldo ENCERRADO: cancelar a compra aberta e a confirmada não reabre o pedido", async () => {
    const { topCompra, topPedido } = await grafo(true);
    const a = await produto();
    const p = await pedido(topPedido, [{ produto_id: a, quantidade: "10", valor_unitario: "5.00" }]);
    const ia = p.itens[0]!;
    const aberta = await recebida(p.id, topCompra, [{ item_origem_id: ia.id, quantidade: "2" }]);
    const confirmadaId = (await recebida(p.id, topCompra, [{ item_origem_id: ia.id, quantidade: "3" }])).id;
    await confirmada(confirmadaId);
    const e = await encerrar(p.id, { motivo: "fornecedor não entrega o resto" });
    expect(e.statusCode, e.body).toBe(200);
    expect(await situacao(p.id), "premissa: saldo encerrado").toBe("convertido");

    expect((await cancelar("compra", aberta.id)).statusCode).toBe(200);
    expect((await cancelar("compra", confirmadaId)).statusCode).toBe(200);
    const pd = (await admin.query<{ situacao: string; saldo_encerrado_em: string | null }>(
      "select situacao, saldo_encerrado_em::text from erp.documentos_compra where id=$1", [p.id])).rows[0]!;
    expect(pd.situacao, "o encerramento é decisão: cancelar compra não o desfaz").toBe("convertido");
    expect(pd.saldo_encerrado_em).not.toBeNull();
    expect([await situacao(aberta.id), await situacao(confirmadaId), await ligado(ia.id)]).toEqual(["cancelado", "cancelado", "0"]);
    expect(await auditoria(p.id, "compra_cancelada"), "nenhuma reabertura registrada").toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// CP-5 — encerrar saldo; cancelar pedido com compra
// ---------------------------------------------------------------------------------------------------------
describe("CP-5 — encerrar saldo: sem compra ligada → 422; com compra → convertido; cancelar pedido com compra → 409", () => {
  it("CP-5a sem compra (ou só com compra cancelada) → 422; com compra não cancelada → convertido com quem, quando e motivo (idempotente)", async () => {
    const { topCompra, topPedido } = await grafo(true);
    const a = await produto();
    const p = await pedido(topPedido, [{ produto_id: a, quantidade: "10", valor_unitario: "5.00" }]);
    const ia = p.itens[0]!;
    const MSG_SEM_COMPRA = "Este pedido ainda não tem compra: cancele-o em vez de encerrar o saldo.";

    const semCompra = await encerrar(p.id, { motivo: "teste" });
    expect(semCompra.statusCode, semCompra.body).toBe(422);
    expect(j(semCompra).error!.message).toBe(MSG_SEM_COMPRA);
    const cancelada = await recebida(p.id, topCompra, [{ item_origem_id: ia.id, quantidade: "3" }]);
    expect((await cancelar("compra", cancelada.id)).statusCode).toBe(200);
    const soCancelada = await encerrar(p.id, { motivo: "teste" });
    expect(soCancelada.statusCode, soCancelada.body).toBe(422);
    expect(j(soCancelada).error!.message).toBe(MSG_SEM_COMPRA);
    // Corpo estrito: motivo vazio ou chave desconhecida → 422.
    expect((await encerrar(p.id, { motivo: "   " })).statusCode).toBe(422);
    expect((await encerrar(p.id, { motivo: "x", extra: 1 })).statusCode).toBe(422);
    expect((await admin.query<{ situacao: string; saldo_encerrado_em: string | null }>("select situacao, saldo_encerrado_em::text from erp.documentos_compra where id=$1", [p.id])).rows[0])
      .toEqual({ situacao: "aberto", saldo_encerrado_em: null });

    // PREMISSA: com uma compra não cancelada ligada, encerra — e a mesma chave devolve a mesma resposta.
    await recebida(p.id, topCompra, [{ item_origem_id: ia.id, quantidade: "4" }]);
    const chave = `cp5-${unico()}`;
    const ok = await encerrar(p.id, { motivo: "fornecedor encerrou a linha" }, chave);
    expect(ok.statusCode, ok.body).toBe(200);
    const replay = await encerrar(p.id, { motivo: "fornecedor encerrou a linha" }, chave);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(ok.json());
    const pd = (await admin.query<{ situacao: string; saldo_encerrado_por: string; saldo_encerrado_motivo: string; em: boolean }>(
      "select situacao, saldo_encerrado_por, saldo_encerrado_motivo, saldo_encerrado_em is not null as em from erp.documentos_compra where id=$1", [p.id])).rows[0]!;
    expect(pd).toEqual({ situacao: "convertido", saldo_encerrado_por: h.demo.adminUserId, saldo_encerrado_motivo: "fornecedor encerrou a linha", em: true });
    expect((await auditoria(p.id, "encerrar_saldo")).length, "uma auditoria, mesmo com o replay").toBe(1);
    expect((await lerPedido(p.id)).itens.map((i) => i.saldo), "o saldo que sobrou continua à vista").toEqual(["6.0000"]);

    // Encerrado não recebe mais nem encerra de novo.
    expect((await receber(p.id, topCompra, [{ item_origem_id: ia.id, quantidade: "1" }])).statusCode).toBe(409);
    expect((await encerrar(p.id, { motivo: "de novo" })).statusCode).toBe(409);
    // Convertido não se cancela.
    const cancPedido = await cancelar("pedido", p.id);
    expect(cancPedido.statusCode, cancPedido.body).toBe(409);
    expect(await situacao(p.id)).toBe("convertido");
  });

  it("CP-5b cancelar pedido aberto com compra ligada não cancelada → 409; cancelada a compra, o pedido cancela", async () => {
    const { topCompra, topPedido } = await grafo(true);
    const a = await produto();
    const p = await pedido(topPedido, [{ produto_id: a, quantidade: "10", valor_unitario: "5.00" }]);
    const c = await recebida(p.id, topCompra, [{ item_origem_id: p.itens[0]!.id, quantidade: "2" }]);
    const r = await cancelar("pedido", p.id);
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.message).toBe("Este pedido tem compras: cancele-as ou encerre o saldo.");
    expect(await situacao(p.id)).toBe("aberto");
    // PREMISSA: sem compra viva, o pedido cancela.
    expect((await cancelar("compra", c.id)).statusCode).toBe(200);
    const ok = await cancelar("pedido", p.id);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await situacao(p.id)).toBe("cancelado");
  });
});

// ---------------------------------------------------------------------------------------------------------
// CP-6 — concorrência
// ---------------------------------------------------------------------------------------------------------
describe("CP-6 — duas conversões ao mesmo tempo sobre o mesmo saldo → só uma passa", () => {
  it("CP-6a pela API: em partes, 6 + 6 sobre saldo 10 → [201, 422]; inteiro, 10 + 10 → [201, 409]; a soma nunca passa", async () => {
    const emPartes = await grafo(true);
    const a = await produto();
    const p = await pedido(emPartes.topPedido, [{ produto_id: a, quantidade: "10", valor_unitario: "5.00" }]);
    const ia = p.itens[0]!;
    const rs = await Promise.all([
      receber(p.id, emPartes.topCompra, [{ item_origem_id: ia.id, quantidade: "6" }]),
      receber(p.id, emPartes.topCompra, [{ item_origem_id: ia.id, quantidade: "6" }]),
    ]);
    expect(rs.map((r) => r.statusCode).sort(), rs.map((r) => r.body).join(" | ")).toEqual([201, 422]);
    expect([await ligado(ia.id), await comprasDoPedido(p.id), await situacao(p.id)]).toEqual(["6.0000", 1, "aberto"]);

    const inteiro = await grafo(false);
    const b = await produto();
    const q = await pedido(inteiro.topPedido, [{ produto_id: b, quantidade: "10", valor_unitario: "5.00" }]);
    const ib = q.itens[0]!;
    const rq = await Promise.all([
      receber(q.id, inteiro.topCompra, [{ item_origem_id: ib.id, quantidade: "10" }]),
      receber(q.id, inteiro.topCompra, [{ item_origem_id: ib.id, quantidade: "10" }]),
    ]);
    expect(rq.map((r) => r.statusCode).sort(), rq.map((r) => r.body).join(" | ")).toEqual([201, 409]);
    expect([await ligado(ib.id), await comprasDoPedido(q.id), await situacao(q.id)]).toEqual(["10.0000", 1, "convertido"]);
  });

  /**
   * A PROVA DO BANCO (a que a reversa "tirar a soma do gatilho" deixa vermelha). Duas transações com o PAPEL DA
   * APLICAÇÃO (sem bypass de RLS) inserem, AO MESMO TEMPO, um item ligado ao mesmo item de origem, cada um dentro do
   * saldo e os dois juntos acima dele. A primeira trava o item de origem; a segunda fica ESPERANDO a trava (medido em
   * `pg_stat_activity`, não suposto), e quando a primeira comita, a soma da segunda já a enxerga e o gatilho recusa.
   */
  it("CP-6b no banco: dois INSERTs simultâneos (papel da aplicação) de 5 sobre saldo 8 → a segunda espera a trava e o gatilho a recusa", async () => {
    const { topCompra, topPedido } = await grafo(true);
    const a = await produto();
    const p = await pedido(topPedido, [{ produto_id: a, quantidade: "10", valor_unitario: "5.00" }]);
    const ia = p.itens[0]!;
    const x = await recebida(p.id, topCompra, [{ item_origem_id: ia.id, quantidade: "1" }]);
    const y = await recebida(p.id, topCompra, [{ item_origem_id: ia.id, quantidade: "1" }]);
    expect(await ligado(ia.id), "premissa: saldo 8").toBe("2.0000");

    const INSERE = `insert into erp.documentos_compra_itens (organization_id, documento_id, produto_id, armazem_id, quantidade, valor_unitario, valor_total, posicao, origem_item_id)
                    values ($1,$2,$3,$4,$5,1,$5,9,$6)`;
    const contexto = async (c: Tx) => {
      await c.query("begin");
      await c.query("select set_config('app.org_id',$1,true), set_config('app.user_id',$2,true), set_config('app.modulo_empresa','compras',true)", [h.demo.orgId, h.demo.adminUserId]);
    };
    const c1 = await h.db.connect(); const c2 = await h.db.connect();
    try {
      await contexto(c1); await contexto(c2);
      // T1: 5 (2 + 5 = 7 ≤ 10) — passa e SEGURA a trava do item de origem até o commit.
      await c1.query(INSERE, [h.demo.orgId, x.id, a, I.warehouse, "5", ia.id]);
      const pid2 = (await c2.query<{ p: number }>("select pg_backend_pid() as p")).rows[0]!.p;
      // T2: 5 (sozinha caberia: 2 + 5 = 7) — tem de ESPERAR a trava de T1.
      const segunda = c2.query(INSERE, [h.demo.orgId, y.id, a, I.warehouse, "5", ia.id]).then(() => "gravou", (e: Error) => e.message);
      let esperando = false;
      for (let t = 0; t < 100 && !esperando; t++) {
        const w = (await admin.query<{ wait_event_type: string | null }>("select wait_event_type from pg_stat_activity where pid=$1", [pid2])).rows[0];
        esperando = w?.wait_event_type === "Lock";
        if (!esperando) await new Promise((ok) => setTimeout(ok, 100));
      }
      expect(esperando, "a segunda transação espera a trava do item de origem (as duas estão, de fato, ao mesmo tempo)").toBe(true);
      await c1.query("commit");
      expect(await segunda, "com a primeira comitada, a soma passa do saldo e o gatilho recusa").toMatch(/passa do saldo/);
      await c2.query("rollback");

      // PREMISSA da recusa: o que ainda cabe (10 − 7 = 3) o mesmo papel insere — a recusa foi a soma, não outra coisa.
      await contexto(c2);
      await c2.query(INSERE, [h.demo.orgId, y.id, a, I.warehouse, "3", ia.id]);
      await c2.query("rollback");
    } finally {
      await c1.query("rollback").catch(() => {});
      await c2.query("rollback").catch(() => {});
      c1.release(); c2.release();
    }
    expect(await ligado(ia.id), "a soma nunca passou da quantidade: 1 + 1 + 5").toBe("7.0000");
  });
});

// ---------------------------------------------------------------------------------------------------------
// CP-7 — a mesma recusa
// ---------------------------------------------------------------------------------------------------------
describe("CP-7 — TOP sem próxima operação declarada, declarada vazia, ou TOP fora do leque → a MESMA recusa", () => {
  it("CP-7 não declarada · declarada vazia · outra TOP de Compra · TOP de venda · inexistente → mesma 422, sem efeito; a do leque passa", async () => {
    const topCompra = await top(COMPRA); const outraCompra = await top(COMPRA); const topVenda = await top("vendas.venda");
    const naoDeclarada = await top(PEDIDO);
    const vazia = await top(PEDIDO, { destinos: [] });
    const comLeque = await top(PEDIDO, { destinos: [{ tipoOperacaoId: topCompra, ordem: 0, emPartes: true }] });
    const a = await produto();
    const item = (p: Pedido) => [{ item_origem_id: p.itens[0]!.id, quantidade: "1" }];

    const pNao = await pedido(naoDeclarada, [{ produto_id: a, quantidade: "5", valor_unitario: "1.00" }]);
    const pVazia = await pedido(vazia, [{ produto_id: a, quantidade: "5", valor_unitario: "1.00" }]);
    const pLeque = await pedido(comLeque, [{ produto_id: a, quantidade: "5", valor_unitario: "1.00" }]);

    // Os próximos passos dizem o estado sem inventar a cadeia: não declarada → false; vazia → true; ambas sem itens.
    expect(j(await proximosPassos(pNao.id))).toMatchObject({ contractVersion: 1, politicaConfigurada: false, items: [] });
    expect(j(await proximosPassos(pVazia.id))).toMatchObject({ contractVersion: 1, politicaConfigurada: true, items: [] });

    const recusas: [string, Resposta][] = [
      ["política não declarada", await receber(pNao.id, topCompra, item(pNao))],
      ["política declarada vazia", await receber(pVazia.id, topCompra, item(pVazia))],
      ["outra TOP de Compra, fora do leque", await receber(pLeque.id, outraCompra, item(pLeque))],
      ["TOP de venda", await receber(pLeque.id, topVenda, item(pLeque))],
      ["TOP inexistente", await receber(pLeque.id, "00000000-0000-4000-8000-000000000000", item(pLeque))],
    ];
    for (const [nome, r] of recusas) {
      expect([r.statusCode, j(r).error?.code, j(r).error?.message], `${nome}: ${r.body}`).toEqual([422, "TIPO_OPERACAO_INDISPONIVEL", SEM_PROXIMA]);
    }
    for (const p of [pNao, pVazia, pLeque]) expect([await situacao(p.id), await comprasDoPedido(p.id)]).toEqual(["aberto", 0]);

    // PREMISSA: a TOP do leque passa.
    expect((await receber(pLeque.id, topCompra, item(pLeque))).statusCode).toBe(201);
    expect(await comprasDoPedido(pLeque.id)).toBe(1);

    // A porta dos próximos passos é a do GET: compra na porta do pedido, inexistente e malformado são a MESMA 404.
    const compraId = (await admin.query<{ id: string }>("select id from erp.documentos_compra where origem_documento_id=$1", [pLeque.id])).rows[0]!.id;
    const naPorta = await proximosPassos(compraId);
    const inexistente = await proximosPassos("00000000-0000-4000-8000-000000000000");
    const malformado = await proximosPassos("nao-e-uuid");
    expect(naPorta.statusCode).toBe(404);
    for (const r of [inexistente, malformado]) expect([r.statusCode, j(r).error?.code, j(r).error?.message]).toEqual([naPorta.statusCode, j(naPorta).error?.code, j(naPorta).error?.message]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// CP-8 — item 0: exigeVencimento + condição
// ---------------------------------------------------------------------------------------------------------
describe("CP-8 — item 0: TOP que exige vencimento + condição de pagamento, sem Vencimento → salva e confirma", () => {
  function exigeVencimento() {
    const c = configuracaoNeutraTopV3();
    c.execucao = { estoque: "configurada", financeiro: "configurada" };
    c.estoque.atualizacao = "entrada";
    c.financeiro.atualizacao = "pagar";
    c.financeiro.exigeVencimento = true;
    return c;
  }
  const lancarCompra = (topId: string, extra: Record<string, unknown>) => ligada.inject({ method: "POST", url: "/api/compras/compras", headers: h.headers(),
    payload: { empresa_id: I.empresa, tipo_operacao_id: topId, fornecedor_id: I.provider, data_documento: DATA,
      categoria_financeira_id: I.category, centro_custo_id: I.costCenter,
      itens: [{ produto_id: I.product2, armazem_id: I.warehouse, quantidade: "2", valor_unitario: "30.00" }], ...extra } });
  const titulos = async (id: string) => (await admin.query<{ amount: string; due_date: string }>(
    "select amount::text, to_char(due_date,'YYYY-MM-DD') as due_date from erp.financial_titles where source_type='documentos_compra' and source_id=$1 and status<>'cancelled' order by installment_number", [id])).rows;

  it("CP-8a lançar compra: sem condição e sem vencimento → 422 no vencimento (a exigência vale); com condição → salva, e a confirmação gera as parcelas da condição", async () => {
    const topId = await top(COMPRA, { configuracao: exigeVencimento() });
    const cond = await condicao(2);
    const sem = await lancarCompra(topId, {});
    expect(sem.statusCode, `premissa: a exigência de vencimento está ativa — ${sem.body}`).toBe(422);
    expect(caminhos(sem)).toContain("data_vencimento");

    const r = await lancarCompra(topId, { condicao_pagamento_id: cond });
    expect(r.statusCode, `a condição já define os vencimentos — ${r.body}`).toBe(201);
    const id = (j(r) as { id: string }).id;
    const plano = (await admin.query<{ first_due_date: string | null; data_vencimento: string | null }>(
      "select plano_parcelas->>'first_due_date' as first_due_date, data_vencimento::text from erp.documentos_compra where id=$1", [id])).rows[0]!;
    expect(plano.data_vencimento, "o campo Vencimento ficou vazio").toBeNull();
    expect(plano.first_due_date, "o plano gravado tem o primeiro vencimento").toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await confirmada(id, ligada);
    const t = await titulos(id);
    expect(t.map((x) => x.amount), "duas parcelas da condição").toEqual(["30.00", "30.00"]);
    expect(t[0]!.due_date, "o primeiro título vence no primeiro vencimento do plano").toBe(plano.first_due_date);
  });

  it("CP-8b pelo recebimento do pedido (a MESMA função): com condição e sem vencimento → recebe e confirma", async () => {
    const { topCompra, topPedido } = await grafo(false, exigeVencimento());
    const cond = await condicao(1);
    const a = await produto();
    const p = await pedido(topPedido, [{ produto_id: a, quantidade: "3", valor_unitario: "10.00" }], ligada);
    const c = await recebida(p.id, topCompra, [{ item_origem_id: p.itens[0]!.id, quantidade: "3", valor_unitario: "10.00" }], { condicao_pagamento_id: cond }, ligada);
    expect(c.pedidoSituacao).toBe("convertido");
    await confirmada(c.id, ligada);
    expect((await titulos(c.id)).map((x) => x.amount)).toEqual(["30.00"]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// A chave de idempotência é do USUÁRIO: a mesma chave, com o mesmo corpo, vinda de outra pessoa nunca devolve a
// resposta de quem a usou primeiro (o hash leva o usuário). Sem o usuário no hash, o segundo POST seria um replay 200/201.
// ---------------------------------------------------------------------------------------------------------
describe("CP-IDEM — a chave de idempotência do recebimento e do encerramento é do usuário", () => {
  it("CP-IDEM a mesma chave e o mesmo corpo, de outro usuário → 409 sem efeito, no /convert e no /encerrar-saldo", async () => {
    const { topCompra, topPedido } = await grafo(true);
    const a = await produto();
    const p = await pedido(topPedido, [{ produto_id: a, quantidade: "10", valor_unitario: "5.00" }]);
    const itens = [{ item_origem_id: p.itens[0]!.id, quantidade: "4" }];
    const outro = await membro("Outro Comprador", ["pedidos_compra.view", "pedidos_compra.edit", "compras.create"]);

    const chaveReceber = `cp-idem-r-${unico()}`;
    const primeiro = await receber(p.id, topCompra, itens, {}, h.headers({ "idempotency-key": chaveReceber }));
    expect(primeiro.statusCode, primeiro.body).toBe(201);
    const alheio = await receber(p.id, topCompra, itens, {}, { ...outro, "idempotency-key": chaveReceber });
    expect(alheio.statusCode, alheio.body).toBe(409);
    expect(j(alheio).error!.code).toBe("CONFLICT");
    expect([await comprasDoPedido(p.id), await ligado(p.itens[0]!.id)]).toEqual([1, "4.0000"]);

    const chaveEncerrar = `cp-idem-e-${unico()}`;
    const encerrou = await encerrar(p.id, { motivo: "fim da safra" }, chaveEncerrar);
    expect(encerrou.statusCode, encerrou.body).toBe(200);
    const encerrarAlheio = await h.app.inject({ method: "POST", url: `/api/compras/pedidos/${p.id}/encerrar-saldo`,
      headers: { ...outro, "idempotency-key": chaveEncerrar }, payload: { motivo: "fim da safra" } });
    expect(encerrarAlheio.statusCode, encerrarAlheio.body).toBe(409);
    expect(j(encerrarAlheio).error!.code).toBe("CONFLICT");
    expect((await auditoria(p.id, "encerrar_saldo")).length).toBe(1);
  });
});
