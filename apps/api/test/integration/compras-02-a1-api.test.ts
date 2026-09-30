import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createPool, type Db } from "@agro/db";
import { configuracaoNeutraTopV3 } from "@agro/domain";
import { appCom, escoposDeTodosOsModulos, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * COMPRAS-02 (decisão 268) — A1: SMOKE DAS ROTAS NOVAS DA API e do ITEM 0.
 *
 *   · item 0: TOP que exige vencimento + condição de pagamento, SEM o campo Vencimento → salva, e a confirmação passa;
 *   · GET /compras/pedidos/:id/proximos-passos — o leque da versão congelada, 404 uniforme;
 *   · POST /compras/pedidos/:id/convert — em partes e inteiro, recusas no campo, idempotência, capacidade do destino;
 *   · POST /compras/pedidos/:id/encerrar-saldo — sem compra, com compra, de novo;
 *   · cancelar: pedido com compra → 409; compra aberta e confirmada canceladas reabrem o pedido; saldo encerrado não;
 *   · leituras: recebido e saldo por item, compras geradas, origem da compra, filtro "convertido" na lista única.
 *
 * As matrizes CP-1..CP-8 da missão são de outra suíte (T1). Aqui cada prova decisiva é LIDA NO BANCO por conexão
 * própria (superusuário, sem RLS): situação, origem, ligações dos itens, trilha — nunca só o status HTTP.
 */
let h: Harness; let ligada: FastifyInstance; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
type Resposta = { statusCode: number; body: string; json: () => unknown };
type Erro = { code: string; message: string; details?: unknown };
const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: Erro };

const COMPRA = "compras.compra";
const PEDIDO = "compras.pedido";
const DATA = "2026-09-10";

beforeAll(async () => {
  h = await harness();
  ligada = await appCom(h, { TOP_EFFECTS_RUNTIME_V1_ENABLED: "1" });
  I = await ids(h);
  admin = createPool(TEST_URL, { max: 3 });
}, 240_000);
afterAll(async () => { await ligada?.close(); await h?.app.close(); await h?.db.end(); await admin?.end(); });

// ---------------------------------------------------------------------------------------------------------
// Cenário
// ---------------------------------------------------------------------------------------------------------
let seq = 0;
async function top(codigoBase: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await ligada.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: `6${String(++seq).padStart(3, "0")}`, codigoBase, nome: `TOP A1 ${codigoBase} ${seq}`, ...extra } });
  expect(r.statusCode, `premissa: a TOP ${codigoBase} é cadastrada — ${r.body}`).toBe(201);
  return j(r).id as string;
}
/** TOP de pedido com UMA próxima operação: a TOP de compra dada, com ou sem "Em partes". */
const topPedidoPara = (topCompra: string, emPartes: boolean) => top(PEDIDO, { destinos: [{ tipoOperacaoId: topCompra, ordem: 0, emPartes }] });

type ItemPedido = { produto_id: string; quantidade: string; valor_unitario: string; armazem_id?: string | null };
async function pedido(topPedido: string, itens: ItemPedido[]): Promise<{ id: string; codigo: string; itens: { id: string; produto_id: string }[] }> {
  const r = await h.app.inject({ method: "POST", url: "/api/compras/pedidos", headers: h.headers(),
    payload: { empresa_id: I.empresa, tipo_operacao_id: topPedido, fornecedor_id: I.provider, data_documento: DATA, itens } });
  expect(r.statusCode, r.body).toBe(201);
  const id = j(r).id as string;
  const g = j(await h.app.inject({ method: "GET", url: `/api/compras/pedidos/${id}`, headers: h.headers() }));
  return { id, codigo: g.codigo as string, itens: g.itens as { id: string; produto_id: string }[] };
}

type ItemReceber = { item_origem_id: string; quantidade: string; valor_unitario?: string; armazem_id?: string | null } & Record<string, unknown>;
const corpoReceber = (topCompra: string, itens: ItemReceber[], extra: Record<string, unknown> = {}) => ({
  tipo_operacao_id: topCompra, data_documento: DATA, categoria_financeira_id: I.category, centro_custo_id: I.costCenter,
  itens: itens.map((i) => ({ valor_unitario: "10.00", armazem_id: I.warehouse, ...i })), ...extra,
});
const receber = (pedidoId: string, corpo: unknown, headers: Record<string, string> = h.headers(), app: FastifyInstance = h.app) =>
  app.inject({ method: "POST", url: `/api/compras/pedidos/${pedidoId}/convert`, headers, payload: corpo as Record<string, unknown> });
async function recebido(pedidoId: string, corpo: unknown): Promise<{ id: string; codigo: string; pedidoSituacao: string }> {
  const r = await receber(pedidoId, corpo);
  expect(r.statusCode, r.body).toBe(201);
  return j(r) as unknown as { id: string; codigo: string; pedidoSituacao: string };
}
const encerrar = (pedidoId: string, payload: unknown, headers: Record<string, string> = h.headers()) =>
  h.app.inject({ method: "POST", url: `/api/compras/pedidos/${pedidoId}/encerrar-saldo`, headers, payload: payload as Record<string, unknown> });
const cancelar = (especie: "pedidos" | "compras", id: string) =>
  h.app.inject({ method: "POST", url: `/api/compras/${especie}/${id}/cancel`, headers: h.headers(), payload: {} });

const situacao = async (id: string) =>
  (await admin.query<{ situacao: string }>("select situacao from erp.documentos_compra where id=$1", [id])).rows[0]!.situacao;
const documentosNoBanco = async () =>
  Number((await admin.query<{ n: string }>("select count(*) as n from erp.documentos_compra where organization_id=$1", [h.demo.orgId])).rows[0]!.n);
const caminhos = (r: Resposta) => ((j(r).error?.details ?? []) as { path: string }[]).map((d) => d.path);

async function condicao(parcelas: number, dias: number): Promise<string> {
  const s = `${Date.now().toString(36).slice(-4)}${++seq}`;
  return (await admin.query<{ id: string }>(
    "insert into erp.condicoes_pagamento(organization_id,code,nome,parcelas,dias_primeira_parcela,modo,intervalo_dias,entrada) values ($1,$2,$3,$4,$5,'intervalo',30,false) returning id",
    [h.demo.orgId, `A1C-${s}`, `Condição A1 ${s}`, parcelas, dias])).rows[0]!.id;
}

// ---------------------------------------------------------------------------------------------------------
// Item 0
// ---------------------------------------------------------------------------------------------------------
describe("A1-0 — item 0: exige vencimento + condição, sem Vencimento", () => {
  it("salva (o vencimento é o primeiro do plano derivado da condição) e a confirmação passa; sem condição continua 422", async () => {
    const cfg = configuracaoNeutraTopV3();
    cfg.execucao = { estoque: "legado", financeiro: "configurada" };
    cfg.financeiro.atualizacao = "pagar";
    cfg.financeiro.exigeVencimento = true;
    const topCompra = await top(COMPRA, { configuracao: cfg });
    const cond = await condicao(2, 15);
    const corpo = (o: Record<string, unknown>) => ({ empresa_id: I.empresa, tipo_operacao_id: topCompra, fornecedor_id: I.provider, data_documento: DATA,
      categoria_financeira_id: I.category, centro_custo_id: I.costCenter,
      itens: [{ produto_id: I.product2, armazem_id: I.warehouse, quantidade: "2", valor_unitario: "30.00" }], ...o });

    // Premissa: a exigência está LIGADA — sem condição e sem vencimento, 422 no campo.
    const sem = await ligada.inject({ method: "POST", url: "/api/compras/compras", headers: h.headers(), payload: corpo({}) });
    expect(sem.statusCode, sem.body).toBe(422);
    expect(caminhos(sem)).toEqual(["data_vencimento"]);

    const r = await ligada.inject({ method: "POST", url: "/api/compras/compras", headers: h.headers(), payload: corpo({ condicao_pagamento_id: cond }) });
    expect(r.statusCode, r.body).toBe(201);
    const id = j(r).id as string;
    const d = (await admin.query<{ data_vencimento: string | null; plano: { first_due_date: string } }>(
      "select data_vencimento, plano_parcelas as plano from erp.documentos_compra where id=$1", [id])).rows[0]!;
    expect(d.data_vencimento).toBeNull();
    expect(d.plano.first_due_date).toBe("2026-09-25");

    const c = await ligada.inject({ method: "POST", url: `/api/compras/compras/${id}/confirm`, headers: h.headers(), payload: {} });
    expect(c.statusCode, c.body).toBe(200);
    const tit = (await admin.query<{ due: string }>(
      "select to_char(due_date,'YYYY-MM-DD') as due from erp.financial_titles where source_type='documentos_compra' and source_id=$1 order by installment_number", [id])).rows;
    expect(tit.map((x) => x.due)).toEqual(["2026-09-25", "2026-10-25"]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Próximos passos
// ---------------------------------------------------------------------------------------------------------
describe("A1-1 — GET /compras/pedidos/:id/proximos-passos", () => {
  it("o leque da versão congelada (contractVersion 1); TOP sem próximas operações: configurada false, vazio; 404 uniforme", async () => {
    const topCompra = await top(COMPRA);
    const topPedido = await topPedidoPara(topCompra, true);
    const p = await pedido(topPedido, [{ produto_id: I.product!, quantidade: "3", valor_unitario: "5" }]);
    const r = await h.app.inject({ method: "GET", url: `/api/compras/pedidos/${p.id}/proximos-passos`, headers: h.headers() });
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toMatchObject({ contractVersion: 1, politicaConfigurada: true });
    expect(j(r).items).toEqual([expect.objectContaining({ tipoOperacaoId: topCompra, especie: "compra", codigoBase: COMPRA, ordem: 0, emPartes: true })]);

    const semPolitica = await pedido(await top(PEDIDO), [{ produto_id: I.product!, quantidade: "1", valor_unitario: "5" }]);
    const v = j(await h.app.inject({ method: "GET", url: `/api/compras/pedidos/${semPolitica.id}/proximos-passos`, headers: h.headers() }));
    expect(v).toMatchObject({ contractVersion: 1, politicaConfigurada: false, items: [] });

    // Destino desativado some do leque SEM mexer na versão do pedido.
    const rev = j(await ligada.inject({ method: "GET", url: `/api/admin/tipos-operacao/${topCompra}`, headers: h.headers() })).revisao as number;
    const off = await ligada.inject({ method: "PUT", url: `/api/admin/tipos-operacao/${topCompra}`, headers: h.headers(), payload: { ativo: false, revisao: rev } });
    expect(off.statusCode, off.body).toBe(200);
    const depois = j(await h.app.inject({ method: "GET", url: `/api/compras/pedidos/${p.id}/proximos-passos`, headers: h.headers() }));
    expect(depois).toMatchObject({ politicaConfigurada: true, items: [] });

    // Compra na porta do pedido, id malformado e inexistente: a MESMA 404.
    const compraComum = await h.app.inject({ method: "POST", url: "/api/compras/compras", headers: h.headers(),
      payload: { empresa_id: I.empresa, tipo_operacao_id: await top(COMPRA), fornecedor_id: I.provider, data_documento: DATA, categoria_financeira_id: I.category, centro_custo_id: I.costCenter,
        itens: [{ produto_id: I.product!, quantidade: "1", valor_unitario: "1" }] } });
    expect(compraComum.statusCode, compraComum.body).toBe(201);
    for (const id of [j(compraComum).id as string, "nao-e-uuid", "00000000-0000-4000-8000-000000000000"]) {
      const x = await h.app.inject({ method: "GET", url: `/api/compras/pedidos/${id}/proximos-passos`, headers: h.headers() });
      expect(x.statusCode, id).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------
// Receber
// ---------------------------------------------------------------------------------------------------------
describe("A1-2 — POST /compras/pedidos/:id/convert (em partes)", () => {
  it("parte → compra com origem e ligações, pedido aberto com recebido/saldo; idempotente; o resto converte o pedido", async () => {
    const topCompra = await top(COMPRA);
    const p = await pedido(await topPedidoPara(topCompra, true), [
      { produto_id: I.product!, quantidade: "10", valor_unitario: "8.00" },
      { produto_id: I.product2!, quantidade: "5", valor_unitario: "3.00" },
    ]);
    const [a, b] = p.itens as [{ id: string; produto_id: string }, { id: string; produto_id: string }];

    const chave = { "idempotency-key": `a1-receber-${p.id}` };
    const corpo = corpoReceber(topCompra, [{ item_origem_id: a.id, quantidade: "4", valor_unitario: "7.50" }], { numero_nota: `A1-${p.codigo}`, serie_nota: "1" });
    const r = await receber(p.id, corpo, h.headers(chave));
    expect(r.statusCode, r.body).toBe(201);
    const c1 = j(r) as { id: string; codigo: string; especie: string; situacao: string; from: string; pedidoSituacao: string };
    expect(c1).toMatchObject({ especie: "compra", situacao: "aberto", from: p.id, pedidoSituacao: "aberto" });

    // No banco: a compra cita o pedido e a linha cita o item; empresa, fornecedor e produto são os do pedido; o preço é o da nota.
    const doc = (await admin.query<{ origem_documento_id: string; empresa_id: string; fornecedor_id: string; especie: string }>(
      "select origem_documento_id, empresa_id, fornecedor_id, especie from erp.documentos_compra where id=$1", [c1.id])).rows[0]!;
    expect(doc).toEqual({ origem_documento_id: p.id, empresa_id: I.empresa, fornecedor_id: I.provider, especie: "compra" });
    const linhas = (await admin.query<{ origem_item_id: string; produto_id: string; quantidade: string; valor_unitario: string }>(
      "select origem_item_id, produto_id, quantidade::text, valor_unitario::text from erp.documentos_compra_itens where documento_id=$1 order by posicao", [c1.id])).rows;
    expect(linhas).toEqual([{ origem_item_id: a.id, produto_id: a.produto_id, quantidade: "4.0000", valor_unitario: "7.500000" }]);
    expect(await situacao(p.id)).toBe("aberto");

    // Trilha nos dois documentos: `convert` no pedido (to, itens) e `create` na compra (from).
    const trilha = (await admin.query<{ entity_id: string; action: string; metadata: Record<string, unknown> }>(
      "select entity_id, action, metadata from erp.audit_logs where entity='documentos_compra' and entity_id = any($1) and metadata is not null order by created_at",
      [[p.id, c1.id]])).rows;
    expect(trilha.find((x) => x.entity_id === p.id && x.action === "convert")!.metadata).toMatchObject({ to: c1.id, emPartes: true, zeraOSaldo: false, itens: [{ origemItemId: a.id, quantidade: "4.0000" }] });
    expect(trilha.find((x) => x.entity_id === c1.id && x.action === "create")!.metadata).toMatchObject({ from: p.id, especie: "compra" });

    // Replay: mesma resposta, nenhum documento a mais. Mesma chave com outro corpo: 409.
    const antes = await documentosNoBanco();
    const rep = await receber(p.id, corpo, h.headers(chave));
    expect(rep.statusCode, rep.body).toBe(201);
    expect(j(rep).id).toBe(c1.id);
    expect(await documentosNoBanco()).toBe(antes);
    const outro = await receber(p.id, { ...corpo, observacao: "outra" }, h.headers(chave));
    expect(outro.statusCode, outro.body).toBe(409);

    // Leituras: recebido e saldo por item, compras geradas; a compra mostra a origem.
    const gp = j(await h.app.inject({ method: "GET", url: `/api/compras/pedidos/${p.id}`, headers: h.headers() })) as { itens: { id: string; recebido: string; saldo: string }[]; compras_geradas: unknown[] };
    expect(gp.itens.map((i) => [i.id, i.recebido, i.saldo])).toEqual([[a.id, "4.0000", "6.0000"], [b.id, "0.0000", "5.0000"]]);
    expect(gp.compras_geradas).toEqual([{ id: c1.id, codigo: c1.codigo, situacao: "aberto" }]);
    const gc = j(await h.app.inject({ method: "GET", url: `/api/compras/compras/${c1.id}`, headers: h.headers() })) as { origem_documento_id: string; origem_codigo: string; itens: { origem_item_id: string }[] };
    expect(gc).toMatchObject({ origem_documento_id: p.id, origem_codigo: p.codigo });
    expect(gc.itens.map((i) => i.origem_item_id)).toEqual([a.id]);

    // O resto zera o saldo: o pedido vira convertido, e aparece na lista única filtrada por "convertido".
    const c2 = await recebido(p.id, corpoReceber(topCompra, [{ item_origem_id: b.id, quantidade: "5" }, { item_origem_id: a.id, quantidade: "6" }]));
    expect(c2.pedidoSituacao).toBe("convertido");
    expect(await situacao(p.id)).toBe("convertido");
    const lista = j(await h.app.inject({ method: "GET", url: "/api/compras/documentos?situacao=convertido&pageSize=100", headers: h.headers() })) as { items: { id: string; situacao: string }[] };
    expect(lista.items.map((x) => x.id)).toContain(p.id);
    expect(lista.items.every((x) => x.situacao === "convertido")).toBe(true);

    // Pedido convertido não recebe mais: 409, e nada é gravado.
    const antes2 = await documentosNoBanco();
    const mais = await receber(p.id, corpoReceber(topCompra, [{ item_origem_id: a.id, quantidade: "1" }]));
    expect(mais.statusCode, mais.body).toBe(409);
    expect(j(mais).error!.code).toBe("CONFLICT");
    expect(await documentosNoBanco()).toBe(antes2);
  });
});

describe("A1-3 — recusas do recebimento", () => {
  it("corpo estrito, itens (campo apontado), TOP fora do leque e sem política (mesma recusa), aresta inteira", async () => {
    const topParte = await top(COMPRA); const topInteira = await top(COMPRA); const foraDoLeque = await top(COMPRA);
    const pParte = await pedido(await topPedidoPara(topParte, true), [
      { produto_id: I.product!, quantidade: "10", valor_unitario: "8" }, { produto_id: I.product2!, quantidade: "5", valor_unitario: "3" }]);
    const a = pParte.itens[0]!;
    const outroPedido = await pedido(await topPedidoPara(topParte, true), [{ produto_id: I.product!, quantidade: "1", valor_unitario: "1" }]);
    const antes = await documentosNoBanco();

    // Contrato estrito: fornecedor, empresa e produto não entram no corpo; chave desconhecida no item → 422.
    for (const extra of [{ fornecedor_id: I.provider }, { empresa_id: I.empresa }]) {
      const x = await receber(pParte.id, corpoReceber(topParte, [{ item_origem_id: a.id, quantidade: "1" }], extra));
      expect(x.statusCode, x.body).toBe(422);
    }
    const comProduto = await receber(pParte.id, corpoReceber(topParte, [{ item_origem_id: a.id, quantidade: "1", produto_id: I.product }]));
    expect(comProduto.statusCode, comProduto.body).toBe(422);

    // Itens: o campo certo em cada recusa.
    const casos: [ItemReceber[], string[]][] = [
      [[{ item_origem_id: a.id, quantidade: "10.0001" }], ["itens[0].quantidade"]],
      [[{ item_origem_id: a.id, quantidade: "1" }, { item_origem_id: a.id, quantidade: "1" }], ["itens[1].item_origem_id"]],
      [[{ item_origem_id: outroPedido.itens[0]!.id, quantidade: "1" }], ["itens[0].item_origem_id"]],
    ];
    for (const [itens, esperado] of casos) {
      const x = await receber(pParte.id, corpoReceber(topParte, itens));
      expect(x.statusCode, x.body).toBe(422);
      expect(j(x).error!.code).toBe("VALIDATION_ERROR");
      expect(caminhos(x), x.body).toEqual(esperado);
    }

    // TOP fora do leque, e pedido cuja TOP não declarou próximas operações: a MESMA recusa, a MESMA mensagem.
    const fora = await receber(pParte.id, corpoReceber(foraDoLeque, [{ item_origem_id: a.id, quantidade: "1" }]));
    const semPolitica = await pedido(await top(PEDIDO), [{ produto_id: I.product!, quantidade: "1", valor_unitario: "1" }]);
    const sem = await receber(semPolitica.id, corpoReceber(topParte, [{ item_origem_id: semPolitica.itens[0]!.id, quantidade: "1" }]));
    for (const x of [fora, sem]) {
      expect(x.statusCode, x.body).toBe(422);
      expect(j(x).error).toMatchObject({ code: "TIPO_OPERACAO_INDISPONIVEL", message: "A TOP deste pedido não tem próxima operação configurada." });
    }

    // Aresta SEM "Em partes": menos que o saldo aponta a linha; item com saldo que ficou de fora aponta `itens`.
    const pInteiro = await pedido(await topPedidoPara(topInteira, false), [
      { produto_id: I.product!, quantidade: "10", valor_unitario: "8" }, { produto_id: I.product2!, quantidade: "5", valor_unitario: "3" }]);
    const ia = pInteiro.itens[0]!; const ib = pInteiro.itens[1]!;
    const menor = await receber(pInteiro.id, corpoReceber(topInteira, [{ item_origem_id: ia.id, quantidade: "9" }, { item_origem_id: ib.id, quantidade: "5" }]));
    expect(menor.statusCode, menor.body).toBe(422);
    expect(caminhos(menor)).toEqual(["itens[0].quantidade"]);
    const faltando = await receber(pInteiro.id, corpoReceber(topInteira, [{ item_origem_id: ia.id, quantidade: "10" }]));
    expect(faltando.statusCode, faltando.body).toBe(422);
    expect(caminhos(faltando)).toEqual(["itens"]);
    expect(await documentosNoBanco()).toBe(antes + 2); // só os dois pedidos criados acima

    // Premissa: o inteiro, correto, recebe e converte de uma vez.
    const ok = await recebido(pInteiro.id, corpoReceber(topInteira, [{ item_origem_id: ib.id, quantidade: "5" }, { item_origem_id: ia.id, quantidade: "10" }]));
    expect(ok.pedidoSituacao).toBe("convertido");
  });

  it("sem compras.create → 403 e nada gravado; pedido de outra espécie na porta → 404", async () => {
    const topCompra = await top(COMPRA);
    const p = await pedido(await topPedidoPara(topCompra, true), [{ produto_id: I.product!, quantidade: "2", valor_unitario: "1" }]);
    const email = `a1-c02-${Date.now().toString(36)}@demo.local`;
    const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `A1 C02 ${email}`, permissions: ["pedidos_compra.view", "pedidos_compra.edit"] } });
    expect(papel.statusCode, papel.body).toBeLessThan(300);
    const u = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: email, email, password: "Restrito@12345", role_id: j(papel).id, escopos_empresas: escoposDeTodosOsModulos([]) } });
    expect(u.statusCode, u.body).toBeLessThan(300);
    const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Restrito@12345" } });
    const restrito = { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };

    const antes = await documentosNoBanco();
    const r = await receber(p.id, corpoReceber(topCompra, [{ item_origem_id: p.itens[0]!.id, quantidade: "1" }]), restrito);
    expect(r.statusCode, r.body).toBe(403);
    expect(await documentosNoBanco()).toBe(antes);
    expect(await situacao(p.id)).toBe("aberto");
    // Premissa: o mesmo corpo, com quem tem compras.create, recebe.
    await recebido(p.id, corpoReceber(topCompra, [{ item_origem_id: p.itens[0]!.id, quantidade: "1" }]));

    const x = await h.app.inject({ method: "POST", url: `/api/compras/pedidos/00000000-0000-4000-8000-000000000000/convert`, headers: h.headers(),
      payload: corpoReceber(topCompra, [{ item_origem_id: p.itens[0]!.id, quantidade: "1" }]) });
    expect(x.statusCode, x.body).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Encerrar saldo e cancelar
// ---------------------------------------------------------------------------------------------------------
describe("A1-4 — POST /compras/pedidos/:id/encerrar-saldo", () => {
  it("sem compra → 422; com compra e saldo → convertido com quem/quando/motivo; idempotente; de novo → 409", async () => {
    const topCompra = await top(COMPRA);
    const p = await pedido(await topPedidoPara(topCompra, true), [{ produto_id: I.product!, quantidade: "10", valor_unitario: "2" }]);
    const semCompra = await encerrar(p.id, { motivo: "fornecedor parou" });
    expect(semCompra.statusCode, semCompra.body).toBe(422);
    expect(j(semCompra).error!.message).toBe("Este pedido ainda não tem compra: cancele-o em vez de encerrar o saldo.");
    expect((await encerrar(p.id, { motivo: "x", extra: 1 })).statusCode).toBe(422);
    expect((await encerrar(p.id, { motivo: "   " })).statusCode).toBe(422);

    await recebido(p.id, corpoReceber(topCompra, [{ item_origem_id: p.itens[0]!.id, quantidade: "4" }]));
    const chave = { "idempotency-key": `a1-encerrar-${p.id}` };
    const r = await encerrar(p.id, { motivo: "fornecedor parou" }, h.headers(chave));
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ id: p.id, situacao: "convertido" });
    const d = (await admin.query<{ situacao: string; em: string | null; por: string | null; motivo: string | null }>(
      "select situacao, saldo_encerrado_em::text as em, saldo_encerrado_por as por, saldo_encerrado_motivo as motivo from erp.documentos_compra where id=$1", [p.id])).rows[0]!;
    expect(d.situacao).toBe("convertido"); expect(d.em).not.toBeNull(); expect(d.por).toBeTruthy(); expect(d.motivo).toBe("fornecedor parou");
    expect((await encerrar(p.id, { motivo: "fornecedor parou" }, h.headers(chave))).statusCode).toBe(200);
    const again = await encerrar(p.id, { motivo: "fornecedor parou" });
    expect(again.statusCode, again.body).toBe(409);
    const g = j(await h.app.inject({ method: "GET", url: `/api/compras/pedidos/${p.id}`, headers: h.headers() }));
    expect(g).toMatchObject({ situacao: "convertido", saldo_encerrado_motivo: "fornecedor parou" });
    expect(g.saldo_encerrado_por_nome).toBeTruthy();
    const aud = await admin.query("select 1 from erp.audit_logs where entity='documentos_compra' and entity_id=$1 and action='encerrar_saldo'", [p.id]);
    expect(aud.rowCount).toBe(1);
  });
});

describe("A1-5 — cancelamentos", () => {
  it("pedido com compra → 409; compra ABERTA cancelada reabre o pedido convertido e devolve o saldo; pedido convertido → 409", async () => {
    const topCompra = await top(COMPRA);
    const p = await pedido(await topPedidoPara(topCompra, true), [{ produto_id: I.product!, quantidade: "3", valor_unitario: "2" }]);
    const c = await recebido(p.id, corpoReceber(topCompra, [{ item_origem_id: p.itens[0]!.id, quantidade: "3" }]));
    expect(await situacao(p.id)).toBe("convertido");
    const conv = await cancelar("pedidos", p.id);
    expect(conv.statusCode, conv.body).toBe(409);
    expect(await situacao(p.id)).toBe("convertido");

    const cc = await cancelar("compras", c.id);
    expect(cc.statusCode, cc.body).toBe(200);
    expect(await situacao(c.id)).toBe("cancelado");
    expect(await situacao(p.id)).toBe("aberto");
    const g = j(await h.app.inject({ method: "GET", url: `/api/compras/pedidos/${p.id}`, headers: h.headers() })) as { itens: { saldo: string }[]; compras_geradas: { situacao: string }[] };
    expect(g.itens[0]!.saldo).toBe("3.0000");
    expect(g.compras_geradas).toEqual([expect.objectContaining({ id: c.id, situacao: "cancelado" })]);
    const aud = await admin.query("select 1 from erp.audit_logs where entity='documentos_compra' and entity_id=$1 and action='compra_cancelada'", [p.id]);
    expect(aud.rowCount).toBe(1);

    // Pedido aberto com compra NÃO cancelada: 409 com a mensagem que diz o que fazer.
    await recebido(p.id, corpoReceber(topCompra, [{ item_origem_id: p.itens[0]!.id, quantidade: "1" }]));
    const comCompra = await cancelar("pedidos", p.id);
    expect(comCompra.statusCode, comCompra.body).toBe(409);
    expect(j(comCompra).error!.message).toBe("Este pedido tem compras: cancele-as ou encerre o saldo.");
    expect(await situacao(p.id)).toBe("aberto");
  });

  it("compra CONFIRMADA cancelada (estorno) reabre o pedido; com saldo encerrado o pedido não reabre", async () => {
    const topCompra = await top(COMPRA);
    const p = await pedido(await topPedidoPara(topCompra, true), [{ produto_id: I.product2!, quantidade: "2", valor_unitario: "4" }]);
    const c = await recebido(p.id, corpoReceber(topCompra, [{ item_origem_id: p.itens[0]!.id, quantidade: "2" }]));
    const conf = await h.app.inject({ method: "POST", url: `/api/compras/compras/${c.id}/confirm`, headers: h.headers(), payload: {} });
    expect(conf.statusCode, conf.body).toBe(200);
    expect(await situacao(p.id)).toBe("convertido");
    const cc = await cancelar("compras", c.id);
    expect(cc.statusCode, cc.body).toBe(200);
    expect(await situacao(c.id)).toBe("cancelado");
    const estornos = await admin.query("select 1 from erp.stock_movements where source_type='documentos_compra' and source_id=$1 and movement_type='reversal'", [c.id]);
    expect(estornos.rowCount).toBeGreaterThan(0);
    expect(await situacao(p.id)).toBe("aberto");

    // Saldo encerrado: cancelar a compra devolve o saldo, mas o pedido fica convertido.
    const p2 = await pedido(await topPedidoPara(topCompra, true), [{ produto_id: I.product!, quantidade: "5", valor_unitario: "1" }]);
    const c2 = await recebido(p2.id, corpoReceber(topCompra, [{ item_origem_id: p2.itens[0]!.id, quantidade: "2" }]));
    expect((await encerrar(p2.id, { motivo: "resto não vem" })).statusCode).toBe(200);
    const cc2 = await cancelar("compras", c2.id);
    expect(cc2.statusCode, cc2.body).toBe(200);
    expect(await situacao(c2.id)).toBe("cancelado");
    expect(await situacao(p2.id)).toBe("convertido");
  });
});
