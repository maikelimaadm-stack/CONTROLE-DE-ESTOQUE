import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createPool, seedDemo, type Db } from "@agro/db";
import {
  CAPACIDADE_LAYOUT_DOCUMENTO, LAYOUT_DO_SISTEMA, configuracaoNeutraTopV2, configuracaoNeutraTopV3, mensagemCampoObrigatorio,
  type EstruturaLayout, type CampoDoLayout, type ColunaDoLayout,
} from "@agro/domain";
import { appCom, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * COMPRAS-03 (decisão 269) — A1: SMOKE DA API DO LAYOUT DO DOCUMENTO DE COMPRA e do ITEM 0.
 *
 *   A1-1  operation-types das duas espécies declara `layoutDocumento` (depois de condicaoPagamento, como em vendas);
 *   A1-2  GET /compras/{pedidos|compras}/layout-efetivo — sistema, ligado, padrão da família; TOP ausente, malformada,
 *         repetida, de outra família, inativa, excluída ou de outra organização → a MESMA 404;
 *   A1-3  cobrança ao lançar: pedido, compra e RECEBER → 422 LAYOUT_CAMPO_OBRIGATORIO no campo (itens[i].campo
 *         inclusive); nada gravado; layout do sistema = nada muda; a nota duplicada vem antes; confirmar e cancelar
 *         não cobram;
 *   A1-4  regras-da-operacao ganha exigeFormaPagamento, exigeVencimento e exigeArmazem (e nada mais muda — depois,
 *         a OPERACOES-01 F2, decisão 279, acrescentou `regrasGerais`, e só ela);
 *   A1-5  padrão de cadastro do Fornecedor (`is_provider`) vale; o de vendas não muda;
 *   A1-6  item 0 a) pedido convertido com compra viva → "tem compras"; c) receber com UUID em maiúsculas;
 *         d) compra de valor zero confirma sem forma/vencimento.
 *
 * As matrizes LC-1..LC-6 são da suíte de T1. Aqui cada prova decisiva é LIDA NO BANCO por conexão própria
 * (superusuário, sem RLS) quando o que importa é o que foi — ou não foi — gravado.
 */
let h: Harness; let ligada: FastifyInstance; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
type Resposta = { statusCode: number; body: string; json: () => unknown };
type Erro = { code: string; message: string; details?: { path: string; message: string }[] };
const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: Erro };

const COMPRA = "compras.compra";
const PEDIDO = "compras.pedido";
const DATA = "2026-09-10";
const LAYOUTS = "/api/admin/layouts-documento";
const NAO_ACHADO = "00000000-0000-4000-8000-000000000000";

/** A outra organização (A1-2: TOP de outro tenant). */
let outra: { headers: Record<string, string> };

beforeAll(async () => {
  h = await harness();
  ligada = await appCom(h, { TOP_EFFECTS_RUNTIME_V1_ENABLED: "1" });
  I = await ids(h);
  admin = createPool(TEST_URL, { max: 3 });
  const o = await seedDemo(admin, { orgName: "[TEST] Org C03 A1", adminEmail: "admin-c03a1@demo.local", adminPassword: "Demo@12345", slug: "orgc03a1" }, () => {});
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin-c03a1@demo.local", password: "Demo@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  outra = { headers: { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": o.orgId } };
}, 240_000);
afterAll(async () => { await ligada?.close(); await h?.app.close(); await h?.db.end(); await admin?.end(); });

// ---------------------------------------------------------------------------------------------------------
// Cenário
// ---------------------------------------------------------------------------------------------------------
let seq = 0;
/** TOP pela API administrativa (instância com a execução configurada ligada: aceita qualquer configuração válida). */
async function top(codigoBase: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = h.headers()): Promise<string> {
  const r = await ligada.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers,
    payload: { codigo: `8${String(++seq).padStart(3, "0")}`, codigoBase, nome: `TOP C03 A1 ${codigoBase} ${seq}`, ...extra } });
  expect(r.statusCode, `premissa: a TOP ${codigoBase} é cadastrada — ${r.body}`).toBe(201);
  return j(r).id as string;
}
const topPedidoPara = (topCompra: string, emPartes: boolean) => top(PEDIDO, { destinos: [{ tipoOperacaoId: topCompra, ordem: 0, emPartes }] });

/** O layout do sistema da família, ajustado, gravado e (opcionalmente) ligado às TOPs dadas. */
async function layout(familia: string, ajuste: (e: EstruturaLayout) => void, tops: string[] = []): Promise<string> {
  const estrutura = structuredClone(LAYOUT_DO_SISTEMA(familia));
  ajuste(estrutura);
  const r = await h.app.inject({ method: "POST", url: LAYOUTS, headers: h.headers(), payload: { familia, nome: `C03 A1 ${familia} ${++seq}`, estrutura } });
  expect(r.statusCode, `premissa: o layout de ${familia} grava — ${r.body}`).toBe(201);
  const id = j(r).id as string;
  if (tops.length) await ligar(id, tops);
  return id;
}
async function ligar(layoutId: string, tops: string[]): Promise<void> {
  const r = await h.app.inject({ method: "PUT", url: `${LAYOUTS}/${layoutId}/tops`, headers: h.headers(), payload: { tipoOperacaoIds: tops } });
  expect(r.statusCode, r.body).toBe(200);
}
function campo(e: EstruturaLayout, chave: string): CampoDoLayout {
  const c = e.cabecalho.find((x) => x.campo === chave) ?? e.rodape.flatMap((a) => a.campos).find((x) => x.campo === chave);
  if (!c) throw new Error(`campo ${chave} fora da estrutura`);
  return c;
}
function coluna(e: EstruturaLayout, chave: string): ColunaDoLayout {
  const c = e.itens.find((x) => x.campo === chave);
  if (!c) throw new Error(`coluna ${chave} fora dos itens`);
  return c;
}
/** Observação obrigatória, com rótulo próprio (a mensagem tem de usar o rótulo do LAYOUT). */
const exigeObservacao = (e: EstruturaLayout) => { Object.assign(campo(e, "observacao"), { obrigatorio: true, rotulo: "Obs. da nota" }); };
const exigeArmazem = (e: EstruturaLayout) => { coluna(e, "armazem_id").obrigatorio = true; };

type Item = { produto_id: string; armazem_id?: string | null; quantidade: string; valor_unitario: string };
const corpoCompra = (topId: string, o: Record<string, unknown> = {}) => ({
  empresa_id: I.empresa, tipo_operacao_id: topId, fornecedor_id: I.provider, data_documento: DATA,
  categoria_financeira_id: I.category, centro_custo_id: I.costCenter,
  itens: [{ produto_id: I.product2, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "10.00" }] as Item[], ...o,
});
const corpoPedido = (topId: string, o: Record<string, unknown> = {}) => ({
  empresa_id: I.empresa, tipo_operacao_id: topId, fornecedor_id: I.provider, data_documento: DATA,
  itens: [{ produto_id: I.product, quantidade: "2", valor_unitario: "5.00" }] as Item[], ...o,
});
const lancar = (segmento: "pedidos" | "compras", corpo: unknown, headers: Record<string, string> = h.headers(), app: FastifyInstance = h.app) =>
  app.inject({ method: "POST", url: `/api/compras/${segmento}`, headers, payload: corpo as Record<string, unknown> });
async function lancado(segmento: "pedidos" | "compras", corpo: unknown, app: FastifyInstance = h.app): Promise<string> {
  const r = await lancar(segmento, corpo, h.headers(), app);
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
async function pedido(topPedido: string, itens: Item[]): Promise<{ id: string; itens: { id: string }[] }> {
  const id = await lancado("pedidos", corpoPedido(topPedido, { itens }));
  const g = j(await h.app.inject({ method: "GET", url: `/api/compras/pedidos/${id}`, headers: h.headers() }));
  return { id, itens: g.itens as { id: string }[] };
}
const receber = (pedidoId: string, corpo: unknown, headers: Record<string, string> = h.headers()) =>
  h.app.inject({ method: "POST", url: `/api/compras/pedidos/${pedidoId}/convert`, headers, payload: corpo as Record<string, unknown> });
const corpoReceber = (topCompra: string, itens: ({ item_origem_id: string; quantidade: string } & Record<string, unknown>)[], extra: Record<string, unknown> = {}) => ({
  tipo_operacao_id: topCompra, data_documento: DATA, categoria_financeira_id: I.category, centro_custo_id: I.costCenter,
  itens: itens.map((i) => ({ valor_unitario: "10.00", armazem_id: I.warehouse, ...i })), ...extra,
});
const cancelar = (segmento: "pedidos" | "compras", id: string) =>
  h.app.inject({ method: "POST", url: `/api/compras/${segmento}/${id}/cancel`, headers: h.headers(), payload: {} });
const efetivo = (segmento: "pedidos" | "compras", query: string, headers: Record<string, string> = h.headers()) =>
  h.app.inject({ method: "GET", url: `/api/compras/${segmento}/layout-efetivo${query}`, headers });

const situacao = async (id: string) =>
  (await admin.query<{ situacao: string }>("select situacao from erp.documentos_compra where id=$1", [id])).rows[0]!.situacao;
const documentosNoBanco = async () =>
  Number((await admin.query<{ n: string }>("select count(*) as n from erp.documentos_compra where organization_id=$1", [h.demo.orgId])).rows[0]!.n);
const detalhes = (r: Resposta) => j(r).error?.details ?? [];

// ---------------------------------------------------------------------------------------------------------
// A1-1 capacidade
// ---------------------------------------------------------------------------------------------------------
describe("A1-1 — operation-types declara o layout do documento", () => {
  it("as duas espécies: layoutDocumento = CAPACIDADE_LAYOUT_DOCUMENTO, depois de condicaoPagamento", async () => {
    for (const segmento of ["pedidos", "compras"] as const) {
      const r = await h.app.inject({ method: "GET", url: `/api/compras/${segmento}/operation-types`, headers: h.headers() });
      expect(r.statusCode, r.body).toBe(200);
      const capacidades = j(r).capacidades as Record<string, unknown>;
      expect(capacidades.layoutDocumento, segmento).toBe(CAPACIDADE_LAYOUT_DOCUMENTO);
      // OPERACOES-01 F6a (decisão 283): `finalizacaoEOrcamento` acrescentada no FIM; as de hoje na mesma ordem.
      // OPERACOES-01 F7 (decisão 284): `importacaoXml` no FIM, depois dela.
      expect(Object.keys(capacidades), segmento).toEqual(["classificacaoFinanceira", "condicaoPagamento", "layoutDocumento", "regrasDaOperacao", "finalizacaoEOrcamento", "importacaoXml"]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------
// A1-2 layout efetivo
// ---------------------------------------------------------------------------------------------------------
describe("A1-2 — GET /compras/{pedidos|compras}/layout-efetivo", () => {
  it("sem layout → o do sistema da família (sem os mapas); ligado → o ligado, com id e nome", async () => {
    for (const [segmento, familia] of [["pedidos", PEDIDO], ["compras", COMPRA]] as const) {
      const t = await top(familia);
      const s = await efetivo(segmento, `?tipo_operacao_id=${t}`);
      expect(s.statusCode, s.body).toBe(200);
      expect(j(s)).toEqual({ estrutura: LAYOUT_DO_SISTEMA(familia), origem: "sistema", nome: null, id: null });

      const l = await layout(familia, exigeObservacao, [t]);
      const g = await efetivo(segmento, `?tipo_operacao_id=${t}`);
      expect(g.statusCode, g.body).toBe(200);
      const b = j(g) as { origem: string; id: string; nome: string; estrutura: EstruturaLayout };
      expect(b).toMatchObject({ origem: "ligado", id: l });
      expect(b.nome).toMatch(/^C03 A1 /);
      expect(campo(b.estrutura, "observacao")).toMatchObject({ obrigatorio: true, rotulo: "Obs. da nota" });
      expect(Object.keys(b).sort()).toEqual(["estrutura", "id", "nome", "origem"]);
    }
  });

  it("TOP ausente, malformada, repetida, de outra família, inativa, excluída ou de outra organização → a MESMA 404", async () => {
    const inativa = await top(COMPRA);
    const rev = j(await ligada.inject({ method: "GET", url: `/api/admin/tipos-operacao/${inativa}`, headers: h.headers() })).revisao as number;
    expect((await ligada.inject({ method: "PUT", url: `/api/admin/tipos-operacao/${inativa}`, headers: h.headers(), payload: { ativo: false, revisao: rev } })).statusCode).toBe(200);
    const excluida = await top(COMPRA);
    const rev2 = j(await ligada.inject({ method: "GET", url: `/api/admin/tipos-operacao/${excluida}`, headers: h.headers() })).revisao as number;
    const del = await ligada.inject({ method: "DELETE", url: `/api/admin/tipos-operacao/${excluida}?revisao=${rev2}`, headers: h.headers() });
    expect(del.statusCode, del.body).toBe(200);
    const deOutraOrg = await top(COMPRA, {}, outra.headers);
    const valida = await top(COMPRA);

    const casos: [string, string][] = [
      ["ausente", ""], ["malformada", "?tipo_operacao_id=nao-e-uuid"], ["inexistente", `?tipo_operacao_id=${NAO_ACHADO}`],
      ["repetida", `?tipo_operacao_id=${valida}&tipo_operacao_id=${valida}`],
      ["de pedido na porta da compra", `?tipo_operacao_id=${await top(PEDIDO)}`], ["de vendas", `?tipo_operacao_id=${await top("vendas.pedido")}`],
      ["inativa", `?tipo_operacao_id=${inativa}`], ["excluída", `?tipo_operacao_id=${excluida}`], ["de outra organização", `?tipo_operacao_id=${deOutraOrg}`],
    ];
    const corpos = new Set<string>();
    for (const [caso, query] of casos) {
      const r = await efetivo("compras", query);
      expect(r.statusCode, `${caso}: ${r.body}`).toBe(404);
      corpos.add(r.body);
    }
    expect(corpos.size, "corpos idênticos em todos os casos").toBe(1);
    // O corpo CRAVADO: a mesma 404 de "Tipo de operação" das regras-da-operacao — nada da TOP sai na recusa.
    expect(JSON.parse([...corpos][0]!)).toEqual({ error: { code: "NOT_FOUND", message: "Tipo de operação não encontrado" } });
    // A compra na porta do PEDIDO também é a mesma 404; premissa: a válida responde.
    expect((await efetivo("pedidos", `?tipo_operacao_id=${valida}`)).body).toBe([...corpos][0]);
    expect((await efetivo("compras", `?tipo_operacao_id=${valida}`)).statusCode).toBe(200);
    // Na outra organização, a TOP dela responde (a 404 acima é recorte de tenant, não TOP quebrada).
    expect((await efetivo("compras", `?tipo_operacao_id=${deOutraOrg}`, outra.headers)).statusCode).toBe(200);
  });

  it("padrão ativo da família vale para a TOP sem layout ligado; desligado, volta o do sistema", async () => {
    const t = await top(PEDIDO);
    const l = await layout(PEDIDO, exigeObservacao);
    try {
      expect((await h.app.inject({ method: "POST", url: `${LAYOUTS}/${l}/padrao`, headers: h.headers(), payload: {} })).statusCode).toBe(200);
      const g = await efetivo("pedidos", `?tipo_operacao_id=${t}`);
      expect(j(g)).toMatchObject({ origem: "padrao_da_familia", id: l });
      // e é cobrado ao lançar (a cobrança usa o MESMO layoutEfetivo)
      const r = await lancar("pedidos", corpoPedido(t));
      expect(r.statusCode, r.body).toBe(422);
      expect(j(r).error!.code).toBe("LAYOUT_CAMPO_OBRIGATORIO");
    } finally {
      expect((await h.app.inject({ method: "POST", url: `${LAYOUTS}/${l}/ativo`, headers: h.headers(), payload: { ativo: false } })).statusCode).toBe(200);
    }
    expect(j(await efetivo("pedidos", `?tipo_operacao_id=${t}`))).toMatchObject({ origem: "sistema", id: null });
  });
});

// ---------------------------------------------------------------------------------------------------------
// A1-3 cobrança
// ---------------------------------------------------------------------------------------------------------
describe("A1-3 — cobrança do layout ao lançar", () => {
  it("compra: obrigatório vazio → 422 no campo (rótulo do layout, itens[i].campo); nada gravado; preenchido → 201", async () => {
    const t = await top(COMPRA);
    await layout(COMPRA, (e) => { exigeObservacao(e); exigeArmazem(e); }, [t]);
    const antes = await documentosNoBanco();
    const r = await lancar("compras", corpoCompra(t, { itens: [
      { produto_id: I.product2, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "10.00" },
      { produto_id: I.product, armazem_id: null, quantidade: "1", valor_unitario: "3.00" },
    ] }));
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error).toMatchObject({ code: "LAYOUT_CAMPO_OBRIGATORIO", message: mensagemCampoObrigatorio("Obs. da nota") });
    expect(detalhes(r)).toEqual([
      { path: "observacao", message: mensagemCampoObrigatorio("Obs. da nota") },
      { path: "itens[1].armazem_id", message: mensagemCampoObrigatorio("Local de estoque") },
    ]);
    expect(await documentosNoBanco()).toBe(antes);
    // Observação só com espaços é vazia (a mesma regra da tela).
    const branco = await lancar("compras", corpoCompra(t, { observacao: "   " }));
    expect(branco.statusCode, branco.body).toBe(422);
    expect(detalhes(branco).map((d) => d.path)).toEqual(["observacao"]);
    await lancado("compras", corpoCompra(t, { observacao: "conferida" }));
    expect(await documentosNoBanco()).toBe(antes + 1);
  });

  it("pedido: obrigatório do layout de compras.pedido vazio → 422; preenchido → 201", async () => {
    const t = await top(PEDIDO);
    await layout(PEDIDO, (e) => { campo(e, "data_vencimento").obrigatorio = true; }, [t]);
    const r = await lancar("pedidos", corpoPedido(t));
    expect(r.statusCode, r.body).toBe(422);
    expect(detalhes(r)).toEqual([{ path: "data_vencimento", message: mensagemCampoObrigatorio("Vencimento") }]);
    await lancado("pedidos", corpoPedido(t, { data_vencimento: "2026-10-10" }));
  });

  it("RECEBER: a compra de destino usa o layout da TOP DELA — 422 no campo, pedido intacto; preenchido → 201", async () => {
    const topCompra = await top(COMPRA);
    await layout(COMPRA, (e) => { exigeObservacao(e); exigeArmazem(e); }, [topCompra]);
    const topPedido = await topPedidoPara(topCompra, true);
    const p = await pedido(topPedido, [{ produto_id: I.product!, quantidade: "4", valor_unitario: "5.00" }]);
    // O layout da TOP do PEDIDO (origem) exigindo a Transportadora, ligado DEPOIS do pedido lançado: o recebimento
    // não o cobra — a compra é cobrada só pelo layout da TOP de destino (a dela).
    await layout(PEDIDO, (e) => { campo(e, "transportadora_id").obrigatorio = true; }, [topPedido]);
    const antes = await documentosNoBanco();
    const r = await receber(p.id, corpoReceber(topCompra, [{ item_origem_id: p.itens[0]!.id, quantidade: "4", armazem_id: null }]));
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error!.code).toBe("LAYOUT_CAMPO_OBRIGATORIO");
    expect(detalhes(r).map((d) => d.path)).toEqual(["observacao", "itens[0].armazem_id"]);
    expect(await documentosNoBanco()).toBe(antes);
    expect(await situacao(p.id)).toBe("aberto");
    const ok = await receber(p.id, corpoReceber(topCompra, [{ item_origem_id: p.itens[0]!.id, quantidade: "4" }], { observacao: "recebido" }));
    expect(ok.statusCode, `sem Transportadora (exigida só pelo layout do pedido de origem): ${ok.body}`).toBe(201);
    expect(await situacao(p.id)).toBe("convertido");
  });

  it("layout do sistema (TOP sem layout) e layout igual ao do sistema: nada muda", async () => {
    const semLayout = await top(COMPRA);
    const comLayoutDoSistema = await top(COMPRA);
    await layout(COMPRA, () => {}, [comLayoutDoSistema]);
    expect(j(await efetivo("compras", `?tipo_operacao_id=${comLayoutDoSistema}`)).origem).toBe("ligado");
    // Sem observação, sem transportadora, sem vencimento, item sem armazém: o que já passava continua passando.
    for (const t of [semLayout, comLayoutDoSistema]) {
      await lancado("compras", corpoCompra(t, { itens: [{ produto_id: I.product2, armazem_id: null, quantidade: "1", valor_unitario: "10.00" }] }));
    }
  });

  it("a nota duplicada é recusada ANTES do layout (409, não 422)", async () => {
    const semLayout = await top(COMPRA);
    const comLayout = await top(COMPRA);
    await layout(COMPRA, exigeObservacao, [comLayout]);
    const nota = { numero_nota: `C03A1-${Date.now().toString(36)}`, serie_nota: "1" };
    await lancado("compras", corpoCompra(semLayout, nota));
    const r = await lancar("compras", corpoCompra(comLayout, nota));
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.code).toBe("DUPLICATE_DOCUMENT");
  });

  it("confirmar a compra e cancelar o pedido NÃO cobram o layout", async () => {
    const tCompra = await top(COMPRA);
    const tPedido = await top(PEDIDO);
    const compraId = await lancado("compras", corpoCompra(tCompra));
    const pedidoId = await lancado("pedidos", corpoPedido(tPedido));
    await layout(COMPRA, exigeObservacao, [tCompra]);
    await layout(PEDIDO, (e) => { campo(e, "data_vencimento").obrigatorio = true; }, [tPedido]);
    // Premissa: os layouts estão valendo — um lançamento novo, igual, é recusado.
    expect((await lancar("compras", corpoCompra(tCompra))).statusCode).toBe(422);
    expect((await lancar("pedidos", corpoPedido(tPedido))).statusCode).toBe(422);

    const previa = j(await h.app.inject({ method: "GET", url: `/api/compras/compras/${compraId}/previa-confirmacao`, headers: h.headers() }));
    expect(previa.podeConfirmar, JSON.stringify(previa.recusas)).toBe(true);
    const c = await h.app.inject({ method: "POST", url: `/api/compras/compras/${compraId}/confirm`, headers: h.headers(), payload: {} });
    expect(c.statusCode, c.body).toBe(200);
    expect(await situacao(compraId)).toBe("confirmado");
    const x = await cancelar("pedidos", pedidoId);
    expect(x.statusCode, x.body).toBe(200);
    expect(await situacao(pedidoId)).toBe("cancelado");
  });
});

// ---------------------------------------------------------------------------------------------------------
// A1-4 regras da operação
// ---------------------------------------------------------------------------------------------------------
describe("A1-4 — regras-da-operacao: exigeFormaPagamento, exigeVencimento e exigeArmazem (e, desde a OPERACOES-01 F2, regrasGerais)", () => {
  // OPERACOES-01 F2 (decisão 279) acrescentou `regrasGerais` — e nenhuma outra chave. O valor é provado em
  // `operacoes-01-f2-regras-gerais.test.ts`; aqui, só a lista exata das chaves.
  // LANCAMENTO-01 (decisão 311): + `padroes` e `secao` (o valor é provado em `lancamento-01-regras-padroes.test.ts`).
  const CHAVES = ["condicoesPermitidas", "contractVersion", "exigeArmazem", "exigeFormaPagamento", "exigeVencimento", "exigencias", "formato", "geraTitulos", "padroes", "regrasGerais", "secao"];
  const regras = (segmento: "pedidos" | "compras", t: string, app: FastifyInstance = h.app) =>
    app.inject({ method: "GET", url: `/api/compras/${segmento}/regras-da-operacao?tipo_operacao_id=${t}`, headers: h.headers() });

  it("os mesmos do lançamento (versão atual); padrão e pedido → false; nenhuma outra chave nova além de regrasGerais (F2)", async () => {
    const cfg = configuracaoNeutraTopV2();
    cfg.execucao = { estoque: "configurada", financeiro: "configurada" };
    (cfg.estoque as { atualizacao: string }).atualizacao = "entrada";
    (cfg.estoque as { exigeArmazem: boolean }).exigeArmazem = true;
    (cfg.financeiro as { atualizacao: string }).atualizacao = "pagar";
    (cfg.financeiro as { exigeFormaPagamento: boolean }).exigeFormaPagamento = true;
    (cfg.financeiro as { exigeVencimento: boolean }).exigeVencimento = true;
    const exigente = await top(COMPRA, { configuracao: cfg });

    const r = await regras("compras", exigente, ligada);
    expect(r.statusCode, r.body).toBe(200);
    expect(Object.keys(j(r)).sort()).toEqual(CHAVES);
    expect(j(r)).toMatchObject({ geraTitulos: true, exigeFormaPagamento: true, exigeVencimento: true, exigeArmazem: true });
    // Premissa: o lançamento cobra o mesmo (o armazém do item é a primeira recusa; depois, forma no cabeçalho).
    const semArmazem = await lancar("compras", corpoCompra(exigente, { itens: [{ produto_id: I.product2, armazem_id: null, quantidade: "1", valor_unitario: "10.00" }] }), h.headers(), ligada);
    expect(semArmazem.statusCode, semArmazem.body).toBe(422);
    expect(detalhes(semArmazem).map((d) => d.path)).toEqual(["itens[0].armazem_id"]);
    const semForma = await lancar("compras", corpoCompra(exigente, { data_vencimento: "2026-10-10" }), h.headers(), ligada);
    expect(semForma.statusCode, semForma.body).toBe(422);
    expect(detalhes(semForma).map((d) => d.path)).toEqual(["forma_pagamento_id"]);

    // Execução configurada desligada neste servidor: a política não resolve — o lançamento não presume, e aqui também não.
    expect(j(await regras("compras", exigente))).toMatchObject({ geraTitulos: false, exigeFormaPagamento: false, exigeVencimento: false, exigeArmazem: false });
    // TOP padrão: gera título, sem exigência de política.
    const padrao = j(await regras("compras", await top(COMPRA), ligada));
    expect(padrao).toMatchObject({ geraTitulos: true, exigeFormaPagamento: false, exigeVencimento: false, exigeArmazem: false });
    // Pedido: nunca.
    const p = await regras("pedidos", await top(PEDIDO), ligada);
    expect(Object.keys(j(p)).sort()).toEqual(CHAVES);
    expect(j(p)).toMatchObject({ geraTitulos: false, exigeFormaPagamento: false, exigeVencimento: false, exigeArmazem: false });
  });
});

// ---------------------------------------------------------------------------------------------------------
// A1-5 padrão de cadastro do Fornecedor
// ---------------------------------------------------------------------------------------------------------
describe("A1-5 — padrão de cadastro: Fornecedor (is_provider)", () => {
  it("fornecedor vale; pessoa que não é fornecedor → 422 no caminho; morto depois → padroesInvalidos; armazém com a empresa", async () => {
    const f = await h.app.inject({ method: "POST", url: "/api/resources/people", headers: h.headers(), payload: { name: "C03 A1 Fornecedor", person_type: "legal", is_provider: true } });
    expect(f.statusCode, f.body).toBe(201);
    const fornecedor = j(f).id as string;
    const soCliente = (await admin.query<{ id: string }>(
      "select id from erp.people where organization_id=$1 and is_client and not is_provider and deleted_at is null order by code limit 1", [h.demo.orgId])).rows[0]!.id;

    const comPadrao = (pessoa: string) => (e: EstruturaLayout) => {
      campo(e, "fornecedor_id").valorPadrao = { tipo: "registro", id: pessoa };
      coluna(e, "armazem_id").valorPadrao = { tipo: "registro", id: I.warehouse! };
    };
    const indice = LAYOUT_DO_SISTEMA(COMPRA).cabecalho.findIndex((x) => x.campo === "fornecedor_id");
    const est = structuredClone(LAYOUT_DO_SISTEMA(COMPRA)); comPadrao(soCliente)(est);
    const recusa = await h.app.inject({ method: "POST", url: LAYOUTS, headers: h.headers(), payload: { familia: COMPRA, nome: `C03 A1 recusa ${++seq}`, estrutura: est } });
    expect(recusa.statusCode, recusa.body).toBe(422);
    expect(detalhes(recusa)).toEqual([{ path: `cabecalho[${indice}].valorPadrao`, message: "Registro padrão inválido para \"Fornecedor\"." }]);

    const t = await top(COMPRA);
    await layout(COMPRA, comPadrao(fornecedor), [t]);
    const g = j(await efetivo("compras", `?tipo_operacao_id=${t}`)) as { estrutura: EstruturaLayout; padroesDeCadastro: Record<string, unknown>; padroesInvalidos: string[] };
    expect(g.padroesDeCadastro).toEqual({
      fornecedor_id: { id: fornecedor, rotulo: "C03 A1 Fornecedor" },
      "itens.armazem_id": { id: I.warehouse, rotulo: expect.any(String), empresaId: I.empresa },
    });
    expect(g.padroesInvalidos).toEqual([]);
    expect(JSON.stringify(g.estrutura).includes("\"registro\""), "a estrutura sai SEM os padrões registro").toBe(false);

    await admin.query("update erp.people set is_active=false where id=$1", [fornecedor]);
    const morto = j(await efetivo("compras", `?tipo_operacao_id=${t}`)) as { padroesDeCadastro: Record<string, unknown>; padroesInvalidos: string[] };
    expect(morto.padroesInvalidos).toEqual(["fornecedor_id"]);
    expect(Object.keys(morto.padroesDeCadastro)).toEqual(["itens.armazem_id"]);

    // Vendas não muda: o Cliente continua pedindo CLIENTE — um fornecedor ativo que não é cliente não serve lá.
    const f2 = await h.app.inject({ method: "POST", url: "/api/resources/people", headers: h.headers(), payload: { name: "C03 A1 Fornecedor 2", person_type: "legal", is_provider: true } });
    expect(f2.statusCode, f2.body).toBe(201);
    const naoCliente = (await admin.query<{ c: boolean }>("select is_client as c from erp.people where id=$1", [j(f2).id])).rows[0]!.c;
    expect(naoCliente, "premissa: o fornecedor novo não é cliente").toBe(false);
    const vendas = structuredClone(LAYOUT_DO_SISTEMA("vendas.pedido"));
    const indiceCliente = vendas.cabecalho.findIndex((x) => x.campo === "client_id");
    campo(vendas, "client_id").valorPadrao = { tipo: "registro", id: j(f2).id as string };
    const rv = await h.app.inject({ method: "POST", url: LAYOUTS, headers: h.headers(), payload: { familia: "vendas.pedido", nome: `C03 A1 vendas ${++seq}`, estrutura: vendas } });
    expect(rv.statusCode, rv.body).toBe(422);
    expect(detalhes(rv)).toEqual([{ path: `cabecalho[${indiceCliente}].valorPadrao`, message: "Registro padrão inválido para \"Cliente\"." }]);
    campo(vendas, "client_id").valorPadrao = { tipo: "registro", id: soCliente };
    const ok = await h.app.inject({ method: "POST", url: LAYOUTS, headers: h.headers(), payload: { familia: "vendas.pedido", nome: `C03 A1 vendas ${++seq}`, estrutura: vendas } });
    expect(ok.statusCode, ok.body).toBe(201);
  });
});

// ---------------------------------------------------------------------------------------------------------
// A1-6 item 0
// ---------------------------------------------------------------------------------------------------------
describe("A1-6 — item 0", () => {
  it("a) três casos, corpo exato: aberto com compra viva; convertido sem saldo encerrado com compra viva; convertido com saldo encerrado (com e sem compra viva)", async () => {
    const corpo409 = (message: string) => ({ error: { code: "CONFLICT", message } });
    const topCompra = await top(COMPRA);
    const topPedido = await topPedidoPara(topCompra, true);

    // 1) aberto com compra viva (recebido em parte) → os dois caminhos.
    const aberto = await pedido(topPedido, [{ produto_id: I.product!, quantidade: "5", valor_unitario: "1.00" }]);
    expect((await receber(aberto.id, corpoReceber(topCompra, [{ item_origem_id: aberto.itens[0]!.id, quantidade: "2" }]))).statusCode).toBe(201);
    expect(await situacao(aberto.id), "premissa").toBe("aberto");
    const rAberto = await cancelar("pedidos", aberto.id);
    expect(rAberto.statusCode, rAberto.body).toBe(409);
    expect(JSON.parse(rAberto.body)).toEqual(corpo409("Este pedido tem compras: cancele-as ou encerre o saldo."));

    // 2) convertido pelo saldo ZERADO (sem saldo encerrado), com compra viva → só cancelar as compras.
    const cheio = await pedido(topPedido, [{ produto_id: I.product!, quantidade: "3", valor_unitario: "2.00" }]);
    const c = await receber(cheio.id, corpoReceber(topCompra, [{ item_origem_id: cheio.itens[0]!.id, quantidade: "3" }]));
    expect(c.statusCode, c.body).toBe(201);
    expect(await situacao(cheio.id), "premissa").toBe("convertido");
    const rCheio = await cancelar("pedidos", cheio.id);
    expect(rCheio.statusCode, rCheio.body).toBe(409);
    expect(JSON.parse(rCheio.body)).toEqual(corpo409("Este pedido tem compras: cancele-as primeiro."));
    // e o caminho que a mensagem aponta existe: cancelada a compra, o pedido reabre e se cancela.
    expect((await cancelar("compras", j(c).id as string)).statusCode).toBe(200);
    expect(await situacao(cheio.id)).toBe("aberto");
    expect((await cancelar("pedidos", cheio.id)).statusCode).toBe(200);

    // 3) convertido com saldo ENCERRADO: com compra viva e sem ela, a mensagem do convertido.
    const enc = await pedido(topPedido, [{ produto_id: I.product!, quantidade: "5", valor_unitario: "1.00" }]);
    const c2 = await receber(enc.id, corpoReceber(topCompra, [{ item_origem_id: enc.itens[0]!.id, quantidade: "2" }]));
    expect(c2.statusCode, c2.body).toBe(201);
    const e = await h.app.inject({ method: "POST", url: `/api/compras/pedidos/${enc.id}/encerrar-saldo`, headers: h.headers(), payload: { motivo: "resto não vem" } });
    expect(e.statusCode, e.body).toBe(200);
    const comViva = await cancelar("pedidos", enc.id);
    expect(comViva.statusCode, comViva.body).toBe(409);
    expect(JSON.parse(comViva.body), "encerrado, com compra viva").toEqual(corpo409("Este pedido já foi convertido em compra e não é cancelado."));
    expect((await cancelar("compras", j(c2).id as string)).statusCode).toBe(200);
    expect(await situacao(enc.id), "saldo encerrado: cancelar a compra não reabre").toBe("convertido");
    const semViva = await cancelar("pedidos", enc.id);
    expect(semViva.statusCode, semViva.body).toBe(409);
    expect(JSON.parse(semViva.body), "encerrado, sem compra viva").toEqual(corpo409("Este pedido já foi convertido em compra e não é cancelado."));
  });

  it("c) receber com :id, tipo_operacao_id e item_origem_id em MAIÚSCULAS → 201; o reenvio em minúsculas com a mesma chave é o mesmo recebimento", async () => {
    const topCompra = await top(COMPRA);
    const p = await pedido(await topPedidoPara(topCompra, true), [{ produto_id: I.product!, quantidade: "6", valor_unitario: "2.00" }]);
    const item = p.itens[0]!.id;
    const chave = { "idempotency-key": `c03-a1-maiusculas-${p.id}` };
    const maiusculo = corpoReceber(topCompra.toUpperCase(), [{ item_origem_id: item.toUpperCase(), quantidade: "2", armazem_id: I.warehouse!.toUpperCase() }]);
    const r = await receber(p.id.toUpperCase(), maiusculo, h.headers(chave));
    expect(r.statusCode, r.body).toBe(201);
    const compraId = j(r).id as string;
    const antes = await documentosNoBanco();
    const replay = await receber(p.id, corpoReceber(topCompra, [{ item_origem_id: item, quantidade: "2", armazem_id: I.warehouse }]), h.headers(chave));
    expect(replay.statusCode, replay.body).toBe(201);
    expect(j(replay).id).toBe(compraId);
    expect(await documentosNoBanco()).toBe(antes);
  });

  it("c) lançar compra e pedido com armazém, condição e demais uuid em MAIÚSCULAS → 201; o corpo em minúsculas tem EXATAMENTE o hash de antes", async () => {
    const s = `${Date.now().toString(36).slice(-4)}${++seq}`;
    const cond = (await admin.query<{ id: string }>(
      "insert into erp.condicoes_pagamento(organization_id,code,nome,parcelas,dias_primeira_parcela,modo,intervalo_dias,entrada) values ($1,$2,$3,1,30,'intervalo',30,false) returning id",
      [h.demo.orgId, `A1M-${s}`, `Condição A1 ${s}`])).rows[0]!.id;
    // A TOP restringe a condição: a comparação com a lista permitida é a que dava CONDICAO_PAGAMENTO_NAO_PERMITIDA falso.
    const t = await top(COMPRA, { configuracao: configuracaoNeutraTopV3(), condicoesPermitidas: [cond] });
    const ator = (await admin.query<{ id: string }>("select id from erp.users where email=$1", [h.demo.adminEmail])).rows[0]!.id;

    // O corpo CANÔNICO (minúsculas, todas as chaves na ordem do schema, sem default a preencher): o parse de ANTES
    // era a identidade nele, então o hash de antes é o sha256 de { action, especie, corpo: ele mesmo, actorId }.
    const canonico = {
      empresa_id: I.empresa, tipo_operacao_id: t, fornecedor_id: I.provider, transportadora_id: null, data_documento: DATA,
      data_entrada: null, data_vencimento: null, numero_nota: null, serie_nota: null,
      categoria_financeira_id: I.category, centro_custo_id: I.costCenter, condicao_pagamento_id: cond, plano_parcelas: null,
      forma_pagamento_id: null, frete: "0", outras_despesas: "0", desconto: "0", observacao: null,
      itens: [{ produto_id: I.product2, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "10.00", desconto: "0",
        desconto_percentual: "0", lote: null, validade: null, observacao: null }],
    };
    const chave = `c03-a1-hash-${s}`;
    const r = await h.app.inject({ method: "POST", url: "/api/compras/compras", headers: h.headers({ "idempotency-key": chave }), payload: canonico });
    expect(r.statusCode, r.body).toBe(201);
    const gravado = (await admin.query<{ request_hash: string }>("select request_hash from erp.idempotency_keys where organization_id=$1 and key=$2", [h.demo.orgId, chave])).rows[0]!.request_hash;
    const deAntes = createHash("sha256").update(JSON.stringify({ action: "lancar_documento_compra", especie: "compra", corpo: canonico, actorId: ator })).digest("hex");
    expect(gravado, "corpo em minúsculas: o MESMO hash de antes").toBe(deAntes);

    // O MESMO corpo em maiúsculas (todo uuid, armazém e condição inclusive) com a mesma chave: mesmo hash → a mesma compra.
    const maiusculo = (o: unknown): unknown => typeof o === "string" && /^[0-9a-f-]{36}$/.test(o) ? o.toUpperCase()
      : Array.isArray(o) ? o.map(maiusculo) : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, maiusculo(v)])) : o;
    const antes = await documentosNoBanco();
    const replay = await h.app.inject({ method: "POST", url: "/api/compras/compras", headers: h.headers({ "idempotency-key": chave }), payload: maiusculo(canonico) as Record<string, unknown> });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(j(replay).id).toBe(j(r).id);
    expect(await documentosNoBanco()).toBe(antes);

    // Sem chave, em maiúsculas: grava (sem "Armazém inválido" nem condição não permitida falsos), pedido também.
    const nova = await h.app.inject({ method: "POST", url: "/api/compras/compras", headers: h.headers(), payload: maiusculo(canonico) as Record<string, unknown> });
    expect(nova.statusCode, nova.body).toBe(201);
    const ped = await lancar("pedidos", maiusculo(corpoPedido(await top(PEDIDO), { itens: [{ produto_id: I.product, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "1.00" }] })));
    expect(ped.statusCode, ped.body).toBe(201);
  });

  it("d) compra de valor ZERO com forma e vencimento exigidos: salva e confirma (não gera título); com valor, a exigência vale", async () => {
    const cfg = configuracaoNeutraTopV2();
    cfg.execucao = { estoque: "legado", financeiro: "configurada" };
    (cfg.financeiro as { atualizacao: string }).atualizacao = "pagar";
    (cfg.financeiro as { exigeFormaPagamento: boolean }).exigeFormaPagamento = true;
    (cfg.financeiro as { exigeVencimento: boolean }).exigeVencimento = true;
    const t = await top(COMPRA, { configuracao: cfg });
    const zero = { itens: [{ produto_id: I.product2, armazem_id: null, quantidade: "1", valor_unitario: "0" }] };

    // Premissa: com valor, salvar sem forma é 422 no campo.
    const comValor = await lancar("compras", corpoCompra(t), h.headers(), ligada);
    expect(comValor.statusCode, comValor.body).toBe(422);
    expect(detalhes(comValor).map((d) => d.path)).toEqual(["forma_pagamento_id"]);

    const id = await lancado("compras", corpoCompra(t, zero), ligada);
    const previa = j(await ligada.inject({ method: "GET", url: `/api/compras/compras/${id}/previa-confirmacao`, headers: h.headers() }));
    expect(previa.podeConfirmar, JSON.stringify(previa.recusas)).toBe(true);
    const c = await ligada.inject({ method: "POST", url: `/api/compras/compras/${id}/confirm`, headers: h.headers(), payload: {} });
    expect(c.statusCode, c.body).toBe(200);
    expect(await situacao(id)).toBe("confirmado");
    const titulos = await admin.query("select 1 from erp.financial_titles where source_type='documentos_compra' and source_id=$1", [id]);
    expect(titulos.rowCount, "valor zero não gera título").toBe(0);
  });
});
