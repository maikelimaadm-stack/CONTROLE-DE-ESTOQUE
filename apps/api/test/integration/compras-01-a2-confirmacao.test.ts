import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createPool, type Db } from "@agro/db";
import { configuracaoNeutraTopV2, type ConfiguracaoTipoOperacaoV2, type ModoExecucaoTop } from "@agro/domain";
import { appCom, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * COMPRAS-01 (A2) — PRÉVIA, CONFIRMAÇÃO e ESTORNO da Compra, e a NOTA DUPLICADA nos dois caminhos.
 *
 * Toda asserção decisiva é CONTAGEM ou VALOR no banco, por origem (`source_type='documentos_compra'`), lida por
 * conexão própria — status HTTP sozinho não prova efeito.
 */
let h: Harness; let ligada: FastifyInstance; let I: Awaited<ReturnType<typeof ids>>; let formaPagamento: string;
beforeAll(async () => {
  h = await harness();
  ligada = await appCom(h, { TOP_EFFECTS_RUNTIME_V1_ENABLED: "1" });
  I = await ids(h);
  formaPagamento = await comPool(async (c) => (await c.query<{ id: string }>("select id from erp.payment_methods where organization_id=$1 or organization_id is null order by name limit 1", [h.demo.orgId])).rows[0]!.id);
}, 180_000);
afterAll(async () => { await ligada?.close(); await h.app.close(); await h.db.end(); });

type Resposta = { statusCode: number; body: string; json: () => unknown };
const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: { code: string; message: string; details?: unknown } };

async function comPool<T>(fn: (c: Db) => Promise<T>): Promise<T> {
  const c = createPool(TEST_URL, { max: 1 });
  try { return await fn(c); } finally { await c.end(); }
}

let seq = 0;
const codigo = () => `7${String(++seq).padStart(3, "0")}`;
function v2(estoque: "padrao" | "nenhuma" | "entrada", financeiro: "padrao" | "nenhuma" | "pagar", ajuste: (c: ConfiguracaoTipoOperacaoV2) => void = () => {}) {
  const c = configuracaoNeutraTopV2();
  const modo = (x: string): ModoExecucaoTop => (x === "padrao" ? "legado" : "configurada");
  c.execucao = { estoque: modo(estoque), financeiro: modo(financeiro) };
  if (estoque !== "padrao") (c.estoque as { atualizacao: string }).atualizacao = estoque;
  if (financeiro !== "padrao") (c.financeiro as { atualizacao: string }).atualizacao = financeiro;
  ajuste(c);
  return c;
}
async function top(configuracao: unknown = configuracaoNeutraTopV2()): Promise<string> {
  const r = await ligada.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: codigo(), codigoBase: "compras.compra", nome: "Compra A2", configuracao } });
  expect(r.statusCode, r.body).toBe(201);
  return (j(r) as { id: string }).id;
}

let notaSeq = 1000;
const nota = () => String(++notaSeq);
type Item = { produto_id: string; armazem_id?: string | null; quantidade: string; valor_unitario: string; lote?: string; validade?: string };
async function compra(topId: string, extra: Record<string, unknown> = {}, itens?: Item[]): Promise<{ id: string; codigo: string }> {
  const r = await h.app.inject({ method: "POST", url: "/api/compras/compras", headers: h.headers(),
    payload: { empresa_id: I.empresa, tipo_operacao_id: topId, fornecedor_id: I.provider, data_documento: "2026-09-10",
      categoria_financeira_id: I.category, centro_custo_id: I.costCenter,
      itens: itens ?? [{ produto_id: I.product2!, armazem_id: I.warehouse!, quantidade: "1", valor_unitario: "10.00" }], ...extra } });
  expect(r.statusCode, r.body).toBe(201);
  const b = j(r) as { id: string; codigo?: string };
  const cod = b.codigo ?? (await comPool(async (c) => (await c.query<{ codigo: string }>("select codigo from erp.documentos_compra where id=$1", [b.id])).rows[0]!.codigo));
  return { id: b.id, codigo: cod };
}
const confirmar = (id: string, app: FastifyInstance = h.app, chave?: string) =>
  app.inject({ method: "POST", url: `/api/compras/compras/${id}/confirm`, headers: chave ? h.headers({ "idempotency-key": chave }) : h.headers() });
const previa = (id: string, app: FastifyInstance = h.app) => app.inject({ method: "GET", url: `/api/compras/compras/${id}/previa-confirmacao`, headers: h.headers() });
const cancelar = (id: string) => h.app.inject({ method: "POST", url: `/api/compras/compras/${id}/cancel`, headers: h.headers(), payload: {} });

async function efeitos(id: string) {
  return comPool(async (c) => {
    const doc = (await c.query<{ situacao: string }>("select situacao from erp.documentos_compra where id=$1", [id])).rows[0]!;
    const mov = (await c.query<{ movement_type: string; direction: number; quantity: string; unit_cost: string; product_id: string; provider_lot: string | null; expiration_date: string | null; movement_date: string }>(
      "select movement_type, direction, quantity::text, unit_cost::text, product_id, provider_lot, to_char(expiration_date,'YYYY-MM-DD') expiration_date, to_char(movement_date,'YYYY-MM-DD') movement_date from erp.stock_movements where source_type='documentos_compra' and source_id=$1 order by created_at, id", [id])).rows;
    const tit = (await c.query<{ id: string; status: string; amount: string; due_date: string; number: string; direction: string; person_id: string }>(
      "select id, status, amount::text, to_char(due_date,'YYYY-MM-DD') due_date, number, direction, person_id from erp.financial_titles where source_type='documentos_compra' and source_id=$1 order by due_date, number", [id])).rows;
    const rateio = (await c.query<{ financial_category_id: string; cost_center_id: string; percentage: string }>(
      "select a.financial_category_id, a.cost_center_id, a.percentage::text from erp.title_apportionments a join erp.financial_titles t on t.id=a.title_id where t.source_type='documentos_compra' and t.source_id=$1", [id])).rows;
    const aud = (await c.query<{ action: string; metadata: Record<string, unknown> | null }>(
      "select action, metadata from erp.audit_logs where entity='documentos_compra' and entity_id=$1 and action in ('confirm','cancel') order by created_at, id", [id])).rows;
    return {
      situacao: doc.situacao, mov, entradas: mov.filter((m) => m.movement_type === "receipt"), estornos: mov.filter((m) => m.movement_type === "reversal").length,
      tit, titulosAtivos: tit.filter((t) => t.status !== "cancelled").length, rateio, aud,
    };
  });
}

describe("A2-1 confirmação padrão: entrada com custo rateado e parcelas; a prévia mostra exatamente isso", () => {
  it("rateio de frete, outras e desconto; duas parcelas; last_purchase_date; auditoria", async () => {
    const topId = await top();
    const n = nota();
    // itens 10×10=100 e 5×20=100; frete 30, outras 10, desconto 20 → total 220 → 110 para cada item.
    const { id } = await compra(topId, { numero_nota: n, serie_nota: "", frete: "30", outras_despesas: "10", desconto: "20", data_entrada: "2026-09-12",
      plano_parcelas: { installments: 2, first_due_date: "2026-10-10", mode: "interval", interval_days: 30 } },
      [{ produto_id: I.product2!, armazem_id: I.warehouse!, quantidade: "10", valor_unitario: "10" }, { produto_id: I.product!, armazem_id: I.warehouse!, quantidade: "5", valor_unitario: "20" }]);
    const p = await previa(id);
    expect(p.statusCode, p.body).toBe(200);
    const pv = j(p) as unknown as { podeConfirmar: boolean; estoque: { efeito: string; itens: { produto_id: string; custoUnitario: string; valorEntrada: string }[] }; financeiro: { efeito: string; valor: string; numero: string; parcelas: { vencimento: string; valor: string }[] } };
    expect(pv.podeConfirmar).toBe(true);
    expect(pv.estoque.efeito).toBe("entrada");
    expect(pv.estoque.itens.map((i) => [i.valorEntrada, Number(i.custoUnitario)])).toEqual([["110.00", 11], ["110.00", 22]]);
    expect(pv.financeiro).toMatchObject({ efeito: "pagar", valor: "220.00", numero: n });

    // A prévia não grava nada.
    expect((await efeitos(id)).mov.length).toBe(0);

    const r = await confirmar(id);
    expect(r.statusCode, r.body).toBe(200);
    const e = await efeitos(id);
    expect(e.situacao).toBe("confirmado");
    // Mesma transação → mesmo created_at: ordena pela quantidade (10 antes de 5), não pelo id aleatório.
    e.entradas.sort((a, b) => Number(b.quantity) - Number(a.quantity));
    expect(e.entradas.map((m) => [m.product_id, Number(m.quantity), Number(m.unit_cost), m.direction, m.movement_date])).toEqual([
      [I.product2, 10, 11, 1, "2026-09-12"], [I.product, 5, 22, 1, "2026-09-12"]]);
    expect(e.tit.map((t) => [t.direction, t.amount, t.due_date, t.person_id])).toEqual([
      ["payable", "110.00", "2026-10-10", I.provider], ["payable", "110.00", "2026-11-09", I.provider]]);
    expect(e.tit.every((t) => t.number.startsWith(`${n}-`))).toBe(true);
    expect(new Set(e.rateio.map((x) => `${x.financial_category_id}|${x.cost_center_id}|${Number(x.percentage)}`))).toEqual(new Set([`${I.category}|${I.costCenter}|100`]));
    // PRÉVIA = CONFIRMAÇÃO, campo a campo.
    expect(pv.estoque.itens.map((i) => [i.produto_id, Number(i.custoUnitario)])).toEqual(e.entradas.map((m) => [m.product_id, Number(m.unit_cost)]));
    expect(pv.financeiro.parcelas.map((x) => [x.vencimento, x.valor])).toEqual(e.tit.map((t) => [t.due_date, t.amount]));
    const lpd = await comPool(async (c) => (await c.query<{ d: string }>("select to_char(last_purchase_date,'YYYY-MM-DD') d from erp.products where id=$1", [I.product2])).rows[0]!.d);
    expect(lpd).toBe("2026-09-12");
    expect(e.aud.filter((a) => a.action === "confirm")).toHaveLength(1);
    // Idempotência pelo estado: a segunda é 409 e não duplica nada.
    const de = await confirmar(id);
    expect(de.statusCode).toBe(409);
    expect((await efeitos(id)).entradas).toHaveLength(2);
  });

  it("sem nota: título CMP-<código>; sem plano: vencimento do documento", async () => {
    const topId = await top();
    const { id, codigo: cod } = await compra(topId, { data_vencimento: "2026-09-30" });
    expect((await confirmar(id)).statusCode).toBe(200);
    const e = await efeitos(id);
    expect(e.tit.map((t) => [t.number, t.due_date, t.amount])).toEqual([[`CMP-${cod}`, "2026-09-30", "10.00"]]);
  });

  it("gera título e não tem natureza/centro → 422 sem efeito (sem padrão silencioso)", async () => {
    const topId = await top();
    // Ao SALVAR já é recusado (R1 g); a confirmação continua conferindo: a classificação é tirada no banco,
    // com o documento ainda aberto, para provar a trava da confirmação.
    const { id } = await compra(topId);
    await comPool((c) => c.query("update erp.documentos_compra set categoria_financeira_id=null, centro_custo_id=null where id=$1", [id]));
    const pv = j(await previa(id)) as unknown as { podeConfirmar: boolean; recusas: { code: string }[] };
    expect(pv.podeConfirmar).toBe(false);
    const r = await confirmar(id);
    expect(r.statusCode, r.body).toBe(422);
    expect(pv.recusas[0]!.code).toBe(j(r).error!.code);
    const e = await efeitos(id);
    expect([e.situacao, e.mov.length, e.tit.length]).toEqual(["aberto", 0, 0]);
  });
});

describe("A2-2 TOP configurada: só estoque, só financeiro, exigências", () => {
  it("só estoque: entrada sem título, e sem exigir natureza", async () => {
    const topId = await top(v2("entrada", "nenhuma"));
    const { id } = await compra(topId, { categoria_financeira_id: null, centro_custo_id: null });
    const r = await confirmar(id, ligada);
    expect(r.statusCode, r.body).toBe(200);
    const e = await efeitos(id);
    expect([e.entradas.length, e.tit.length]).toEqual([1, 0]);
  });
  it("só financeiro: título sem entrada", async () => {
    const topId = await top(v2("nenhuma", "pagar"));
    const { id } = await compra(topId);
    const r = await confirmar(id, ligada);
    expect(r.statusCode, r.body).toBe(200);
    const e = await efeitos(id);
    expect([e.entradas.length, e.tit.length]).toEqual([0, 1]);
  });
  it("gate desligado com TOP configurada → recusa sem efeito", async () => {
    const topId = await top(v2("entrada", "nenhuma"));
    const { id } = await compra(topId);
    const r = await confirmar(id);
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.code).toBe("TIPO_OPERACAO_EXECUCAO_INDISPONIVEL");
    expect((await efeitos(id)).mov.length).toBe(0);
  });
  it("exigeArmazem, exigeFormaPagamento, exigeVencimento → 422 com as três exigências; corrigido confirma", async () => {
    const topId = await top(v2("entrada", "pagar", (c) => {
      (c.estoque as { exigeArmazem: boolean }).exigeArmazem = true;
      (c.financeiro as { exigeFormaPagamento: boolean }).exigeFormaPagamento = true;
      (c.financeiro as { exigeVencimento: boolean }).exigeVencimento = true;
    }));
    const { id } = await compra(topId, {}, [{ produto_id: I.product2!, armazem_id: null, quantidade: "1", valor_unitario: "10" }]);
    const r = await confirmar(id, ligada);
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error!.code).toBe("TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA");
    expect((j(r).error!.details as { exigencias: { caminho: string }[] }).exigencias.map((x) => x.caminho))
      .toEqual(["estoque.exigeArmazem", "financeiro.exigeFormaPagamento", "financeiro.exigeVencimento"]);
    expect((await efeitos(id)).mov.length).toBe(0);
    // Premissa: o mesmo cenário, com os dados, confirma.
    const ok = await compra(topId, { forma_pagamento_id: formaPagamento, data_vencimento: "2026-10-01" });
    expect((await confirmar(ok.id, ligada)).statusCode).toBe(200);
  });
});

describe("A2-3 estorno da compra confirmada", () => {
  it("cancelar confirmada: estorno de estoque, títulos cancelados, situação cancelado", async () => {
    const topId = await top();
    const { id } = await compra(topId, {}, [{ produto_id: I.product2!, armazem_id: I.warehouse!, quantidade: "3", valor_unitario: "10" }]);
    expect((await confirmar(id)).statusCode).toBe(200);
    const r = await cancelar(id);
    expect(r.statusCode, r.body).toBe(200);
    const e = await efeitos(id);
    expect(e.situacao).toBe("cancelado");
    expect(e.estornos).toBe(1);
    expect(e.mov.reduce((a, m) => a + Number(m.quantity) * m.direction, 0)).toBe(0);
    expect(e.titulosAtivos).toBe(0);
    expect(e.aud.filter((a) => a.action === "cancel")).toHaveLength(1);
  });
  it("título com baixa → 409 'cancele as baixas antes', sem efeito", async () => {
    const topId = await top();
    const { id } = await compra(topId);
    expect((await confirmar(id)).statusCode).toBe(200);
    const titulo = (await efeitos(id)).tit[0]!.id;
    const b = await h.app.inject({ method: "POST", url: `/api/financial/payables/${titulo}/settle`, headers: h.headers(),
      payload: { settlement_date: "2026-09-11", bank_account_id: I.bankAccount, amount: "5.00" } });
    expect(b.statusCode, b.body).toBeLessThan(300);
    const r = await cancelar(id);
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.message).toMatch(/cancele as baixas antes/);
    const e = await efeitos(id);
    expect([e.situacao, e.estornos, e.titulosAtivos]).toEqual(["confirmado", 0, 1]);
  });
  it("estoque já consumido → 409 dizendo produto e armazém (nunca 500), sem efeito", async () => {
    // Produto e armazém sem outro saldo: o armazém SILO com o produto Sal Mineral.
    const topId = await top();
    const { id } = await compra(topId, {}, [{ produto_id: I.product!, armazem_id: I.warehouse2!, quantidade: "4", valor_unitario: "10" }]);
    expect((await confirmar(id)).statusCode).toBe(200);
    const saida = await h.app.inject({ method: "POST", url: "/api/sales/sales", headers: h.headers(),
      payload: { empresa_id: I.empresa, document_date: "2026-09-12", client_id: I.client, items: [{ product_id: I.product, warehouse_id: I.warehouse2, quantity: "3", unit_price: "20" }] } });
    expect(saida.statusCode, saida.body).toBe(201);
    const cv = await h.app.inject({ method: "POST", url: `/api/sales/sales/${(j(saida) as { id: string }).id}/confirm`, headers: h.headers() });
    expect(cv.statusCode, cv.body).toBe(200);
    const r = await cancelar(id);
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.code).toBe("INSUFFICIENT_STOCK");
    expect(j(r).error!.message).toMatch(/Sal Mineral/);
    expect(j(r).error!.message).toMatch(/ no local de estoque /);
    const e = await efeitos(id);
    expect([e.situacao, e.estornos, e.titulosAtivos]).toEqual(["confirmado", 0, 1]);
  });
});

describe("A2-4 concorrência", () => {
  it("duas confirmações simultâneas → uma entrada e um conjunto de títulos", async () => {
    const topId = await top();
    const { id } = await compra(topId, { plano_parcelas: { installments: 3, first_due_date: "2026-10-10", mode: "interval", interval_days: 30 } },
      [{ produto_id: I.product2!, armazem_id: I.warehouse!, quantidade: "2", valor_unitario: "30" }]);
    const [a, b] = await Promise.all([confirmar(id), confirmar(id)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const e = await efeitos(id);
    expect([e.entradas.length, e.tit.length, e.aud.length]).toEqual([1, 3, 1]);
  });
});

describe("A2-5 nota duplicada nos três sentidos", () => {
  const nf = (numero: string, series?: string) => h.app.inject({ method: "POST", url: "/api/stock/invoices", headers: h.headers(),
    payload: { empresa_id: I.empresa, number: numero, ...(series !== undefined ? { series } : {}), provider_id: I.provider, emission_date: "2026-09-10",
      items: [{ product_id: I.product2, warehouse_id: I.warehouse, quantity: "1", unit_value: "10" }], generate_financial: false } });
  const postCompra = async (topId: string, numero: string, serie: string | null) => h.app.inject({ method: "POST", url: "/api/compras/compras", headers: h.headers(),
    payload: { empresa_id: I.empresa, tipo_operacao_id: topId, fornecedor_id: I.provider, data_documento: "2026-09-10", numero_nota: numero, serie_nota: serie,
      categoria_financeira_id: I.category, centro_custo_id: I.costCenter, itens: [{ produto_id: I.product2!, armazem_id: I.warehouse!, quantidade: "1", valor_unitario: "10" }] } });

  it("Compra × Compra (série vazia = '1') → 409 dizendo a Compra", async () => {
    const topId = await top(); const n = nota();
    const a = await postCompra(topId, n, "1");
    expect(a.statusCode, a.body).toBe(201);
    const cod = await comPool(async (c) => (await c.query<{ codigo: string }>("select codigo from erp.documentos_compra where id=$1", [(j(a) as { id: string }).id])).rows[0]!.codigo);
    const b = await postCompra(topId, n, "");
    expect(b.statusCode, b.body).toBe(409);
    expect(j(b).error!.code).toBe("DUPLICATE_DOCUMENT");
    expect(j(b).error!.message).toContain(`Compra ${cod}`);
    // Cancelada não conta.
    expect((await cancelar((j(a) as { id: string }).id)).statusCode).toBe(200);
    expect((await postCompra(topId, n, null)).statusCode).toBe(201);
  });
  it("Documento fiscal × Compra → 409 dizendo o Documento fiscal de Estoque", async () => {
    const topId = await top(); const n = nota();
    const d = await nf(n);
    expect(d.statusCode, d.body).toBe(201);
    const code = (j(d) as { code: string }).code;
    const b = await postCompra(topId, n, null);
    expect(b.statusCode, b.body).toBe(409);
    expect(j(b).error!.code).toBe("DUPLICATE_DOCUMENT");
    expect(j(b).error!.message).toContain(`Documento fiscal de Estoque ${code}`);
  });
  it("Compra × Documento fiscal → 409 dizendo a Compra; outro fornecedor/série passa", async () => {
    const topId = await top(); const n = nota();
    const a = await postCompra(topId, n, "");
    expect(a.statusCode, a.body).toBe(201);
    const cod = await comPool(async (c) => (await c.query<{ codigo: string }>("select codigo from erp.documentos_compra where id=$1", [(j(a) as { id: string }).id])).rows[0]!.codigo);
    const d = await nf(n, "1");
    expect(d.statusCode, d.body).toBe(409);
    expect(j(d).error!.code).toBe("DUPLICATE_DOCUMENT");
    expect(j(d).error!.message).toContain(`Compra ${cod}`);
    expect((await nf(n, "2")).statusCode).toBe(201);
  });
});
