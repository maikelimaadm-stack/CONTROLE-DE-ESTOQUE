import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { addDays } from "@agro/shared";
import {
  planoDaCondicao,
  CAPACIDADE_CONDICAO_PAGAMENTO,
  ERRO_CONDICAO_PAGAMENTO_INVALIDA,
  MSG_CONDICAO_PAGAMENTO_INVALIDA,
  type CondicaoPagamento,
} from "@agro/domain";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * A CONDIÇÃO DE PAGAMENTO NO DOCUMENTO DE VENDA (VENDAS-A4, B-3…B-6).
 *
 * O documento (orçamento, pedido, venda) guarda `condicao_pagamento_id` e `parcelas_ajustadas`. Sem plano no
 * corpo e com condição, o servidor grava o plano DERIVADO por `planoDaCondicao` na data e no total gravados.
 * Com plano no corpo, grava o do corpo e marca as parcelas como ajustadas. A conversão leva a condição pela
 * mesma porta de validação e rederiva no destino (ou copia, se ajustado). D-1: a marca de dedutível
 * sobrevive sem plano.
 *
 * PROVA: linhas lidas por conexão própria (superusuário de teste) — plano gravado, títulos, contagens.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let outraOrg: string;
beforeAll(async () => {
  h = await harness();
  I = await ids(h);
  const r = await h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: h.headers(),
    payload: { empresa_id: I.empresa, warehouse_id: I.warehouse, product_id: I.product2, quantity: "500", unit_value: "10" } });
  expect(r.statusCode, r.body).toBe(201);
  outraOrg = await comPool(async (c) => (await c.query<{ id: string }>("insert into erp.organizations(name,slug) values ('[TEST] Org vizinha A4','orgvizinhaa4') returning id")).rows[0]!.id);
}, 180_000);
afterAll(async () => { await h.app.close(); await h.db.end(); });

type Resposta = { statusCode: number; body: string; json: () => unknown };
type Erro = { code: string; message: string; details?: unknown };
const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: Erro };
const ROTA = { budget: "budgets", order: "orders", sale: "sales" } as const;
type Variante = keyof typeof ROTA;

async function comPool<T>(fn: (c: Db) => Promise<T>): Promise<T> {
  const c = createPool(TEST_URL, { max: 1 });
  try { return await fn(c); } finally { await c.end(); }
}

let seq = 0;
type Cond = CondicaoPagamento & { id: string; code: string; nome: string };
/** Condição criada como o superusuário de teste monta cenário: cada variante recusável é uma linha REAL. */
async function condicao(o: Partial<CondicaoPagamento> & { ativo?: boolean; excluida?: boolean; org?: string } = {}): Promise<Cond> {
  const n = ++seq;
  const c: CondicaoPagamento = { parcelas: o.parcelas ?? 3, dias_primeira_parcela: o.dias_primeira_parcela ?? 30, modo: o.modo ?? "intervalo",
    intervalo_dias: o.intervalo_dias ?? 30, dia_vencimento: o.dia_vencimento ?? null, entrada: o.entrada ?? false, entrada_percentual: o.entrada_percentual ?? null };
  const code = `A4-${String(n).padStart(3, "0")}`; const nome = `Condição A4 ${n}`;
  const id = await comPool(async (db) => (await db.query<{ id: string }>(
    "insert into erp.condicoes_pagamento(organization_id,code,nome,parcelas,dias_primeira_parcela,modo,intervalo_dias,dia_vencimento,entrada,entrada_percentual,is_active,deleted_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id",
    [o.org ?? h.demo.orgId, code, nome, c.parcelas, c.dias_primeira_parcela, c.modo, c.intervalo_dias, c.dia_vencimento, c.entrada, c.entrada_percentual, o.ativo ?? true, o.excluida ? new Date() : null])).rows[0]!.id);
  return { ...c, id, code, nome };
}
const alterarCondicao = (id: string, set: "is_active=false" | "is_active=true") => comPool((c) => c.query(`update erp.condicoes_pagamento set ${set} where id=$1`, [id]));

const ITEM = (qtd = "1") => ({ product_id: I.product2!, warehouse_id: I.warehouse!, quantity: qtd, unit_price: "33.35" });
const corpoBase = (extra: Record<string, unknown> = {}) => ({ empresa_id: I.empresa, document_date: "2026-09-10", client_id: I.client, items: [ITEM("3")], ...extra });
const criar = (kind: Variante, extra: Record<string, unknown> = {}) =>
  h.app.inject({ method: "POST", url: `/api/sales/${ROTA[kind]}`, headers: h.headers(), payload: corpoBase(extra) });
async function documento(kind: Variante, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await criar(kind, extra);
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
const editar = (kind: Variante, id: string, corpo: Record<string, unknown>) =>
  h.app.inject({ method: "PUT", url: `/api/sales/${ROTA[kind]}/${id}`, headers: h.headers(), payload: corpo });
const converter = (kind: "budget" | "order", id: string) =>
  h.app.inject({ method: "POST", url: `/api/sales/${ROTA[kind]}/${id}/convert`, headers: h.headers(), payload: {} });
const ler = async (kind: Variante, id: string) => j(await h.app.inject({ method: "GET", url: `/api/sales/${ROTA[kind]}/${id}`, headers: h.headers() }));

const gravado = (id: string) => comPool(async (c) => (await c.query<{ condicao_pagamento_id: string | null; parcelas_ajustadas: boolean; installment_plan: Record<string, unknown>; document_date: string; total: string; status: string }>(
  "select condicao_pagamento_id, parcelas_ajustadas, installment_plan, to_char(document_date,'YYYY-MM-DD') as document_date, total::text as total, status from erp.sales_documents where id=$1", [id])).rows[0]!);
const documentosDaOrg = () => comPool(async (c) => Number((await c.query<{ n: string }>("select count(*)::text n from erp.sales_documents where organization_id=$1", [h.demo.orgId])).rows[0]!.n));
const hoje = () => new Date().toISOString().slice(0, 10);
const recusaCondicao: Erro = { code: ERRO_CONDICAO_PAGAMENTO_INVALIDA, message: MSG_CONDICAO_PAGAMENTO_INVALIDA, details: [{ path: "condicao_pagamento_id", message: MSG_CONDICAO_PAGAMENTO_INVALIDA }] };
/** O plano derivado mais a marca de dedutível, exatamente como o servidor grava. */
const esperado = (c: CondicaoPagamento, data: string, total: string, dedutivel = false) => ({ ...planoDaCondicao(c, { dataDocumento: data, total }), is_deductible: dedutivel });

describe("CP-A2 recusa única da condição", () => {
  it("CP-A2 inexistente, de outra organização, excluída e inativa → o MESMO 422 (código, mensagem, campo), nada gravado", async () => {
    const variantes: [string, string][] = [
      ["inexistente", "00000000-0000-4000-8000-0000000000a4"],
      ["de outra organização", (await condicao({ org: outraOrg })).id],
      ["excluída", (await condicao({ excluida: true })).id],
      ["inativa", (await condicao({ ativo: false })).id],
    ];
    const antes = await documentosDaOrg();
    const corpos = new Set<string>();
    for (const [motivo, id] of variantes) {
      const r = await criar("sale", { condicao_pagamento_id: id });
      expect(r.statusCode, `${motivo}: ${r.body}`).toBe(422);
      expect(j(r).error, motivo).toEqual(recusaCondicao);
      corpos.add(JSON.stringify(j(r)));
    }
    expect(corpos.size, "sem oráculo: um único corpo de recusa").toBe(1);
    expect(await documentosDaOrg()).toBe(antes);
    // Premissa: a mesma criação com condição válida grava.
    await documento("sale", { condicao_pagamento_id: (await condicao()).id });
    expect(await documentosDaOrg()).toBe(antes + 1);
  });
});

describe("CP-A3/CP-A4 criação", () => {
  it("CP-A3 condição sem plano → plano derivado na data e no total; não ajustado; GET devolve id, código e nome", async () => {
    const c = await condicao({ entrada: true, entrada_percentual: "10.00" });
    for (const kind of ["budget", "order", "sale"] as const) {
      const id = await documento(kind, { condicao_pagamento_id: c.id });
      const g = await gravado(id);
      expect(g.total).toBe("100.05");
      expect(g).toMatchObject({ condicao_pagamento_id: c.id, parcelas_ajustadas: false });
      expect(g.installment_plan).toEqual(esperado(c, "2026-09-10", "100.05"));
      expect(g.installment_plan.first_due_date).toBe("2026-10-10");
      expect(g.installment_plan.down_payment_value).toBe("10.00"); // 10,005 → meio-para-par
      expect(await ler(kind, id)).toMatchObject({ condicao_pagamento_id: c.id, condicao_pagamento_codigo: c.code, condicao_pagamento_nome: c.nome, parcelas_ajustadas: false });
    }
  });

  it("CP-A4 condição com plano → o plano do corpo, ajustado; sem condição e sem plano → como antes", async () => {
    const c = await condicao();
    const plano = { installments: 2, first_due_date: "2026-11-01", mode: "interval", interval_days: 15, has_down_payment: false };
    const id = await documento("order", { condicao_pagamento_id: c.id, installment_plan: plano });
    const g = await gravado(id);
    expect(g).toMatchObject({ condicao_pagamento_id: c.id, parcelas_ajustadas: true });
    expect(g.installment_plan).toEqual({ ...plano, is_deductible: false });
    const semNada = await gravado(await documento("order"));
    expect(semNada).toMatchObject({ condicao_pagamento_id: null, parcelas_ajustadas: false, installment_plan: {} });
    const soPlano = await gravado(await documento("order", { installment_plan: plano }));
    expect(soPlano).toMatchObject({ condicao_pagamento_id: null, parcelas_ajustadas: false });
  });
});

describe("CP-A5 edição: ausente preserva, null remove, uuid troca", () => {
  it("CP-A5 três estados, rederivação e condição já inativa reenviada igual", async () => {
    const c = await condicao();
    const id = await documento("budget", { condicao_pagamento_id: c.id });
    // AUSENTE → preserva e rederiva com a nova data e o novo total.
    const r1 = await editar("budget", id, { ...corpoBase(), document_date: "2026-09-20", items: [ITEM("6")] });
    expect(r1.statusCode, r1.body).toBe(200);
    let g = await gravado(id);
    expect(g.condicao_pagamento_id).toBe(c.id);
    expect(g.total).toBe("200.10");
    expect(g.installment_plan).toEqual(esperado(c, "2026-09-20", "200.10"));
    expect(g.parcelas_ajustadas).toBe(false);
    // A condição ficou inativa; reenviada IGUAL não é revalidada → 200.
    await alterarCondicao(c.id, "is_active=false");
    const r2 = await editar("budget", id, corpoBase({ condicao_pagamento_id: c.id }));
    expect(r2.statusCode, r2.body).toBe(200);
    expect((await gravado(id)).condicao_pagamento_id).toBe(c.id);
    // Ausente com a condição inativa também continua editável (preserva).
    expect((await editar("budget", id, corpoBase())).statusCode).toBe(200);
    // TROCAR para outra: validada.
    const inativa = await condicao({ ativo: false });
    const r3 = await editar("budget", id, corpoBase({ condicao_pagamento_id: inativa.id }));
    expect(r3.statusCode, r3.body).toBe(422);
    expect(j(r3).error).toEqual(recusaCondicao);
    const c2 = await condicao({ parcelas: 2, dias_primeira_parcela: 0, intervalo_dias: 15 });
    const r4 = await editar("budget", id, corpoBase({ condicao_pagamento_id: c2.id }));
    expect(r4.statusCode, r4.body).toBe(200);
    g = await gravado(id);
    expect(g.condicao_pagamento_id).toBe(c2.id);
    expect(g.installment_plan).toEqual(esperado(c2, "2026-09-10", "100.05"));
    // NULL → remove: sem condição e sem plano, como antes.
    const r5 = await editar("budget", id, corpoBase({ condicao_pagamento_id: null }));
    expect(r5.statusCode, r5.body).toBe(200);
    expect(await gravado(id)).toMatchObject({ condicao_pagamento_id: null, parcelas_ajustadas: false, installment_plan: {} });
  });
});

describe("CP-A6 venda confirmada", () => {
  it("CP-A6 30/60/90: títulos == plano derivado; a prévia mostra o mesmo 1º vencimento", async () => {
    const c = await condicao({ parcelas: 3, dias_primeira_parcela: 30, intervalo_dias: 30 });
    const id = await documento("sale", { condicao_pagamento_id: c.id });
    const plano = planoDaCondicao(c, { dataDocumento: "2026-09-10", total: "100.05" });
    const previa = j(await h.app.inject({ method: "GET", url: `/api/sales/sales/${id}/previa-confirmacao`, headers: h.headers() })) as { financeiro: { primeiroVencimento: string | null } };
    expect(previa.financeiro.primeiroVencimento).toBe(plano.first_due_date);
    const r = await h.app.inject({ method: "POST", url: `/api/sales/sales/${id}/confirm`, headers: h.headers() });
    expect(r.statusCode, r.body).toBe(200);
    const titulos = await comPool(async (db) => (await db.query<{ due_date: string; amount: string }>(
      "select to_char(due_date,'YYYY-MM-DD') as due_date, amount::text as amount from erp.financial_titles where source_type='sales_documents' and source_id=$1 order by installment_number", [id])).rows);
    expect(titulos.map((t) => t.due_date)).toEqual([plano.first_due_date, addDays(plano.first_due_date, 30), addDays(plano.first_due_date, 60)]);
    expect(titulos.map((t) => t.due_date)).toEqual(["2026-10-10", "2026-11-09", "2026-12-09"]);
    expect(titulos.reduce((a, t) => a + Math.round(Number(t.amount) * 100), 0)).toBe(10005);
  });
});

describe("CP-A7 conversão", () => {
  const estado = (origem: string) => comPool(async (c) => ({
    status: (await c.query<{ status: string }>("select status from erp.sales_documents where id=$1", [origem])).rows[0]!.status,
    derivados: Number((await c.query<{ n: string }>("select count(*)::text n from erp.sales_documents where origin_document_id=$1", [origem])).rows[0]!.n),
    conversoes: Number((await c.query<{ n: string }>("select count(*)::text n from erp.audit_logs where entity='sales_documents' and entity_id=$1 and action='convert'", [origem])).rows[0]!.n),
  }));

  it("CP-A7 não ajustado → o destino rederiva na SUA data; ajustado → copia; condição inativada → 422 sem efeito", async () => {
    const c = await condicao({ entrada: true, entrada_percentual: "25.00" });
    const orc = await documento("budget", { condicao_pagamento_id: c.id, document_date: "2026-01-05" });
    const rp = await converter("budget", orc);
    expect(rp.statusCode, rp.body).toBe(201);
    const pedido = j(rp).id as string;
    const gp = await gravado(pedido);
    expect(gp.document_date).toBe(hoje());
    expect(gp).toMatchObject({ condicao_pagamento_id: c.id, parcelas_ajustadas: false });
    expect(gp.installment_plan).toEqual(esperado(c, hoje(), gp.total));
    expect(gp.installment_plan).not.toEqual((await gravado(orc)).installment_plan);

    const plano = { installments: 2, first_due_date: "2026-03-01", mode: "interval", interval_days: 10, has_down_payment: false };
    const ajustado = await documento("order", { condicao_pagamento_id: c.id, installment_plan: plano });
    const rv = await converter("order", ajustado);
    expect(rv.statusCode, rv.body).toBe(201);
    const gv = await gravado(j(rv).id as string);
    expect(gv).toMatchObject({ condicao_pagamento_id: c.id, parcelas_ajustadas: true });
    expect(gv.installment_plan).toEqual({ ...plano, is_deductible: false });

    const c3 = await condicao();
    const origem = await documento("budget", { condicao_pagamento_id: c3.id });
    await alterarCondicao(c3.id, "is_active=false");
    const r = await converter("budget", origem);
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error).toEqual(recusaCondicao);
    expect(await estado(origem)).toEqual({ status: "open", derivados: 0, conversoes: 0 });
    // Premissa: reativada, a MESMA origem converte.
    await alterarCondicao(c3.id, "is_active=true");
    expect((await converter("budget", origem)).statusCode).toBe(201);
    expect(await estado(origem)).toEqual({ status: "converted", derivados: 1, conversoes: 1 });
  });
});

describe("CP-A8 D-1: dedutível sem plano", () => {
  it("CP-A8 venda à vista dedutível confirmada → título dedutível; orçamento dedutível convertido → destino dedutível", async () => {
    const venda = await documento("sale", { is_deductible: true });
    expect((await gravado(venda)).installment_plan).toEqual({ is_deductible: true });
    const r = await h.app.inject({ method: "POST", url: `/api/sales/sales/${venda}/confirm`, headers: h.headers() });
    expect(r.statusCode, r.body).toBe(200);
    const titulos = await comPool(async (db) => (await db.query<{ is_deductible: boolean }>("select is_deductible from erp.financial_titles where source_type='sales_documents' and source_id=$1", [venda])).rows);
    expect(titulos.length).toBe(1);
    expect(titulos[0]!.is_deductible).toBe(true);

    const orc = await documento("budget", { is_deductible: true });
    const rp = await converter("budget", orc);
    expect(rp.statusCode, rp.body).toBe(201);
    expect((await gravado(j(rp).id as string)).installment_plan).toMatchObject({ is_deductible: true });
  });
});

describe("CP-A9 capacidade", () => {
  it("CP-A9 as três variantes declaram condicaoPagamento; contractVersion inalterado", async () => {
    for (const kind of ["budget", "order", "sale"] as const) {
      const r = await h.app.inject({ method: "GET", url: `/api/sales/${ROTA[kind]}/operation-types`, headers: h.headers() });
      expect(r.statusCode, r.body).toBe(200);
      const b = j(r) as { contractVersion: number; capacidades: Record<string, number> };
      expect(b.contractVersion).toBe(1);
      // VENDAS-A3-1: `layoutDocumento` entra por último (aditiva); a comparação segue EXATA de propósito.
      expect(b.capacidades).toEqual({ classificacaoFinanceira: 1, condicaoPagamento: CAPACIDADE_CONDICAO_PAGAMENTO, layoutDocumento: 1 });
      expect(CAPACIDADE_CONDICAO_PAGAMENTO).toBe(1);
    }
  });
});
