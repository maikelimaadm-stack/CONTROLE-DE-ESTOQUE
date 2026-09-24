import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * R1-1 c e f (PR #62) — ENTRADAS de produto com controle de lote e o LOTE APARADO na borda da API.
 *
 *  · LT-6: devolução (lote e validade opcionais no item, exigidos só para produto com controle), correção de
 *    AUMENTO (a validade entra no contrato e é exigida no "lote + validade"; num ajuste para baixo ela é recusada)
 *    e produção de ração (o produzido com controle recebe o CÓDIGO da produção como lote; validade nova no lote de
 *    produção, exigida só no "lote + validade");
 *  · LT-7: transferência — a perna de entrada leva o lote E a validade da perna de saída, parte por parte;
 *  · LT-10: lote com espaços é gravado aparado em itens, correção (e na conta do saldo atual), saldo inicial e na
 *    conferência de duplicidade.
 *
 * Toda asserção decisiva é lida no BANCO por conexão própria: o ledger diz qual lote e validade cada movimento
 * gravou; o saldo é aritmética do gatilho. Toda recusa confere que NADA foi gravado.
 */
let h: Harness; let admin: Db; let I: Awaited<ReturnType<typeof ids>>;
type Resp = { statusCode: number; body: string };
type Erro = { error: { code: string; message: string; details?: { path: string; message: string }[] } };
const j = (r: Resp) => JSON.parse(r.body) as Record<string, unknown> & Erro & { id?: string; code?: string };
const hdr = () => h.headers({ "content-type": "application/json" });
const post = (url: string, payload: Record<string, unknown> = {}) => h.app.inject({ method: "POST", url, headers: hdr(), payload });
const um = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await admin.query<T>(sql, p)).rows[0];
const n = async (sql: string, p: unknown[] = []) => Number((await um<{ n: string }>(sql, p))!.n);
const nome = (s: string) => `LE ${s} ${Math.random().toString(36).slice(2, 8)}`;
const criado = (r: Resp) => { expect(r.statusCode, r.body).toBe(201); return j(r).id as string; };
/** Recusa 422 no CAMPO dado. */
const recusado = (r: Resp, campo: string) => {
  expect(r.statusCode, r.body).toBe(422);
  expect(j(r).error.code).toBe("VALIDATION_ERROR");
  expect((j(r).error.details ?? []).map((d) => d.path), r.body).toContain(campo);
};
let base: Record<string, unknown>;
const DIA = "2026-09-20";

async function produto(controle: "nenhum" | "lote" | "lote_validade", rotulo: string): Promise<string> {
  return criado(await post("/api/resources/products", { ...base, description: nome(rotulo), controle_lote: controle }));
}
async function lote(product_id: string, provider_lot: string | null, expiration_date: string | null, quantity: string, warehouse_id = I.warehouse, unit_value = "5") {
  const r = await post("/api/stock/opening-balances", { empresa_id: I.empresa, warehouse_id, product_id, quantity, unit_value, ...(provider_lot ? { provider_lot } : {}), ...(expiration_date ? { expiration_date } : {}) });
  expect(r.statusCode, r.body).toBe(201);
}
/** Saldos do produto num armazém: lote → { quantidade, validade }, lidos do banco. */
async function saldos(product_id: string, warehouse_id = I.warehouse): Promise<Record<string, { q: string; v: string | null }>> {
  const r = await admin.query<{ provider_lot: string; quantity: string; expiration_date: string | null }>(
    "select provider_lot, quantity::text, to_char(expiration_date,'YYYY-MM-DD') as expiration_date from erp.stock_balances where product_id=$1 and warehouse_id=$2 order by provider_lot", [product_id, warehouse_id]);
  return Object.fromEntries(r.rows.map((x) => [x.provider_lot, { q: x.quantity, v: x.expiration_date }]));
}
type Mov = { movement_type: string; direction: number; provider_lot: string | null; validade: string | null; quantity: string; warehouse_id: string };
const daOrigem = async (source_type: string, source_id: string, tipo?: string) => (await admin.query<Mov>(
  "select movement_type, direction, provider_lot, to_char(expiration_date,'YYYY-MM-DD') as validade, quantity::text, warehouse_id::text from erp.stock_movements where source_type=$1 and source_id=$2 order by movement_type, provider_lot",
  [source_type, source_id])).rows.filter((m) => !tipo || m.movement_type === tipo);
const movimentosDo = (product_id: string) => n("select count(*)::text n from erp.stock_movements where product_id=$1", [product_id]);

beforeAll(async () => {
  h = await harness(); admin = createPool(TEST_URL, { max: 3 }); I = await ids(h);
  const org = h.demo.orgId;
  const grupo = (await um<{ id: string }>("select id from erp.product_groups where organization_id=$1 and kind='analytic' and deleted_at is null order by code limit 1", [org]))!.id;
  const un = (await um<{ id: string }>("select id from erp.measurement_units where (organization_id is null or organization_id=$1) and upper(symbol)='UN' order by organization_id nulls last limit 1", [org]))!.id;
  base = { group_id: grupo, measurement_id: un, financial_category_id: I.category };
}, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("LT-6 — devolução: lote e validade opcionais no item, exigidos só para produto com controle", () => {
  const devolucao = (product_id: string, extra: Record<string, unknown> = {}) =>
    post("/api/stock/devolutions", { empresa_id: I.empresa, devolution_date: DIA, items: [{ warehouse_id: I.warehouse, product_id, quantity: "2", unit_value: "4", ...extra }] });
  const devolucoes = () => n("select count(*)::text n from erp.devolutions where organization_id=$1", [h.demo.orgId]);

  it("sem controle: sem lote grava sem lote (como antes); com lote e validade informados, o movimento os grava", async () => {
    const p = await produto("nenhum", "dev sem controle");
    const d1 = criado(await devolucao(p));
    expect(await daOrigem("devolutions", d1)).toMatchObject([{ movement_type: "devolution", direction: 1, provider_lot: null, validade: null, quantity: "2.0000" }]);
    const d2 = criado(await devolucao(p, { provider_lot: "DV-1", expiration_date: "2027-01-31" }));
    expect(await daOrigem("devolutions", d2)).toMatchObject([{ provider_lot: "DV-1", validade: "2027-01-31", quantity: "2.0000" }]);
    expect(await saldos(p)).toEqual({ "": { q: "2.0000", v: null }, "DV-1": { q: "2.0000", v: "2027-01-31" } });
  });

  it("lote: sem lote → 422 no campo do lote, nada gravado; com lote → 201 no lote informado", async () => {
    const p = await produto("lote", "dev lote");
    const antes = await devolucoes();
    recusado(await devolucao(p), "provider_lot");
    expect(await devolucoes(), "a devolução recusada não ficou gravada").toBe(antes);
    expect(await movimentosDo(p)).toBe(0);
    const d = criado(await devolucao(p, { provider_lot: "DL-1" }));
    expect(await daOrigem("devolutions", d)).toMatchObject([{ provider_lot: "DL-1", validade: null, quantity: "2.0000" }]);
    expect(await saldos(p)).toEqual({ "DL-1": { q: "2.0000", v: null } });
  });

  it("lote + validade: lote sem validade → 422 no campo da validade, nada gravado; com os dois → 201", async () => {
    const p = await produto("lote_validade", "dev validade");
    const antes = await devolucoes();
    recusado(await devolucao(p, { provider_lot: "DV-2" }), "expiration_date");
    expect(await devolucoes()).toBe(antes);
    expect(await movimentosDo(p)).toBe(0);
    const d = criado(await devolucao(p, { provider_lot: "DV-2", expiration_date: "2027-03-31" }));
    expect(await daOrigem("devolutions", d)).toMatchObject([{ provider_lot: "DV-2", validade: "2027-03-31" }]);
    expect(await saldos(p)).toEqual({ "DV-2": { q: "2.0000", v: "2027-03-31" } });
  });
});

describe("LT-6 — correção de aumento: validade no contrato, exigida no lote + validade", () => {
  const correcao = (product_id: string, new_quantity: string, extra: Record<string, unknown> = {}) =>
    post("/api/stock/corrections", { empresa_id: I.empresa, correction_date: DIA, warehouse_id: I.warehouse, product_id, new_quantity, justification: "teste R1-1 c", ...extra });
  const correcoes = (product_id: string) => n("select count(*)::text n from erp.stock_corrections where product_id=$1", [product_id]);

  it("sem controle: aumento sem lote continua aceito", async () => {
    const p = await produto("nenhum", "corr sem controle");
    const c = criado(await correcao(p, "3"));
    expect(await daOrigem("stock_corrections", c)).toMatchObject([{ movement_type: "correction_in", provider_lot: null, validade: null, quantity: "3.0000" }]);
  });

  it("lote: aumento sem lote → 422; com lote → 201 no lote", async () => {
    const p = await produto("lote", "corr lote");
    recusado(await correcao(p, "3"), "provider_lot");
    expect(await correcoes(p)).toBe(0);
    const c = criado(await correcao(p, "3", { provider_lot: "CL-1" }));
    expect(await daOrigem("stock_corrections", c)).toMatchObject([{ movement_type: "correction_in", provider_lot: "CL-1", quantity: "3.0000" }]);
  });

  it("lote + validade: aumento sem validade → 422 no campo, nada gravado; com validade → 201 e o saldo do lote leva a validade", async () => {
    const p = await produto("lote_validade", "corr validade");
    recusado(await correcao(p, "5", { provider_lot: "CV-1" }), "expiration_date");
    expect(await correcoes(p)).toBe(0);
    expect(await movimentosDo(p)).toBe(0);
    const c = criado(await correcao(p, "5", { provider_lot: "CV-1", expiration_date: "2027-05-31" }));
    expect(await daOrigem("stock_corrections", c)).toMatchObject([{ movement_type: "correction_in", provider_lot: "CV-1", validade: "2027-05-31", quantity: "5.0000" }]);
    expect(await saldos(p)).toEqual({ "CV-1": { q: "5.0000", v: "2027-05-31" } });
  });

  it("ajuste para BAIXO com validade → 422 (a validade não é descartada em silêncio); sem ela → sai com a validade do lote, que fica intacta", async () => {
    const p = await produto("lote_validade", "corr baixo");
    await lote(p, "CB-1", "2027-07-31", "10");
    recusado(await correcao(p, "4", { provider_lot: "CB-1", expiration_date: "2030-01-01" }), "expiration_date");
    expect(await correcoes(p)).toBe(0);
    expect(await saldos(p)).toEqual({ "CB-1": { q: "10.0000", v: "2027-07-31" } });
    const c = criado(await correcao(p, "4", { provider_lot: "CB-1" }));
    // a saída com lote informado grava a validade DO LOTE (a do saldo), nunca reescreve a do saldo
    expect(await daOrigem("stock_corrections", c)).toMatchObject([{ movement_type: "correction_out", direction: -1, provider_lot: "CB-1", validade: "2027-07-31", quantity: "6.0000" }]);
    expect(await saldos(p)).toEqual({ "CB-1": { q: "4.0000", v: "2027-07-31" } });
  });
});

describe("LT-6 — produção de ração: o produzido com controle recebe o código da produção como lote", () => {
  let insumo: string;
  beforeAll(async () => {
    insumo = await produto("nenhum", "insumo racao");
    await lote(insumo, null, null, "1000");
  });
  async function formulaDe(produzido: string) {
    return criado(await post("/api/stock/feed-formulas", { name: nome("formula"), product_id: produzido, items: [{ product_id: insumo, quantity: "1" }] }));
  }
  const producao = (formula_id: string, extra: Record<string, unknown> = {}) =>
    post("/api/stock/feed-batches", { empresa_id: I.empresa, batch_date: DIA, formula_id, origin_warehouse_id: I.warehouse, destination_warehouse_id: I.warehouse2, quantity_produced: "2", ...extra });
  const producoes = () => n("select count(*)::text n from erp.feed_batches where organization_id=$1", [h.demo.orgId]);
  const producaoGravada = (id: string) => um<{ code: string; validade: string | null }>("select code, to_char(validade,'YYYY-MM-DD') as validade from erp.feed_batches where id=$1", [id]);

  it("sem controle: entra sem lote, como antes; validade informada fica na produção e no movimento", async () => {
    const acabado = await produto("nenhum", "racao sem controle");
    const f = await formulaDe(acabado);
    const b = criado(await producao(f));
    expect(await daOrigem("feed_batches", b, "production_in")).toMatchObject([{ provider_lot: null, validade: null, quantity: "2.0000", warehouse_id: I.warehouse2 }]);
    const b2 = criado(await producao(f, { validade: "2026-12-31" }));
    expect(await producaoGravada(b2)).toMatchObject({ validade: "2026-12-31" });
    expect(await daOrigem("feed_batches", b2, "production_in")).toMatchObject([{ provider_lot: null, validade: "2026-12-31" }]);
  });

  it("lote: o lote do produzido é o CÓDIGO da produção; validade opcional", async () => {
    const acabado = await produto("lote", "racao lote");
    const f = await formulaDe(acabado);
    const b = criado(await producao(f));
    const { code } = (await producaoGravada(b))!;
    expect(await daOrigem("feed_batches", b, "production_in")).toMatchObject([{ provider_lot: code, validade: null, quantity: "2.0000" }]);
    expect(await saldos(acabado, I.warehouse2)).toEqual({ [code]: { q: "2.0000", v: null } });
  });

  it("lote + validade: sem validade → 422 no campo da produção ANTES de consumir a matéria-prima; com validade → lote = código, validade gravada", async () => {
    const acabado = await produto("lote_validade", "racao validade");
    const f = await formulaDe(acabado);
    const antes = { producoes: await producoes(), insumo: await saldos(insumo), movimentos: await movimentosDo(insumo) };
    recusado(await producao(f), "validade");
    expect({ producoes: await producoes(), insumo: await saldos(insumo), movimentos: await movimentosDo(insumo) }, "nada gravado, nada consumido").toEqual(antes);
    const b = criado(await producao(f, { validade: "2026-11-30" }));
    const gravada = (await producaoGravada(b))!;
    expect(gravada.validade).toBe("2026-11-30");
    expect(await daOrigem("feed_batches", b, "production_in")).toMatchObject([{ provider_lot: gravada.code, validade: "2026-11-30", quantity: "2.0000" }]);
    expect(await saldos(acabado, I.warehouse2)).toEqual({ [gravada.code]: { q: "2.0000", v: "2026-11-30" } });
  });
});

describe("LT-7 — transferência: o destino recebe o lote E a validade da saída", () => {
  const transferir = (product_id: string, quantity: string, extra: Record<string, unknown> = {}, destino: Record<string, unknown> = { kind: "warehouse", destination_warehouse_id: I.warehouse2 }) =>
    post("/api/stock/transfers", { transfer_date: DIA, empresa_origem_id: I.empresa, origin_warehouse_id: I.warehouse, ...destino, items: [{ product_id, quantity, ...extra }] });

  it("sem lote informado e saída dividida pela escolha automática: o destino recebe os MESMOS dois lotes, cada um com a sua validade", async () => {
    const p = await produto("lote_validade", "transf auto");
    await lote(p, "TA-LONGE", "2099-06-10", "10", I.warehouse, "7");
    await lote(p, "TA-PERTO", "2099-01-10", "3", I.warehouse, "5");
    const t = criado(await transferir(p, "5"));
    const movs = await daOrigem("warehouse_transfers", t);
    expect(movs.filter((m) => m.direction === -1).map((m) => [m.provider_lot, m.validade, m.quantity])).toEqual([["TA-LONGE", "2099-06-10", "2.0000"], ["TA-PERTO", "2099-01-10", "3.0000"]]);
    expect(movs.filter((m) => m.direction === 1).map((m) => [m.movement_type, m.provider_lot, m.validade, m.quantity, m.warehouse_id]))
      .toEqual([["transfer_in", "TA-LONGE", "2099-06-10", "2.0000", I.warehouse2], ["transfer_in", "TA-PERTO", "2099-01-10", "3.0000", I.warehouse2]]);
    expect(await saldos(p, I.warehouse2)).toEqual({ "TA-LONGE": { q: "2.0000", v: "2099-06-10" }, "TA-PERTO": { q: "3.0000", v: "2099-01-10" } });
    expect(await saldos(p)).toEqual({ "TA-LONGE": { q: "8.0000", v: "2099-06-10" }, "TA-PERTO": { q: "0.0000", v: "2099-01-10" } });
    // cada parte entra com o SEU custo: o valor total que chega é o que saiu (3×5 + 2×7 = 29)
    expect(await um("select coalesce(sum(total_value),0)::text as v from erp.stock_balances where product_id=$1 and warehouse_id=$2", [p, I.warehouse2])).toEqual({ v: "29.00" });

    // o cancelamento estorna as quatro pernas, cada uma no seu lote, e os saldos voltam
    const x = await post(`/api/stock/transfers/${t}/cancel`);
    expect(x.statusCode, x.body).toBe(200);
    expect(j(x)).toMatchObject({ reversals: 4 });
    expect(await saldos(p, I.warehouse2)).toEqual({ "TA-LONGE": { q: "0.0000", v: "2099-06-10" }, "TA-PERTO": { q: "0.0000", v: "2099-01-10" } });
    expect(await saldos(p)).toEqual({ "TA-LONGE": { q: "10.0000", v: "2099-06-10" }, "TA-PERTO": { q: "3.0000", v: "2099-01-10" } });
  });

  it("com o lote informado: o destino recebe o lote com a validade do saldo de origem", async () => {
    const p = await produto("lote_validade", "transf informado");
    await lote(p, "TI-1", "2099-03-15", "10");
    await lote(p, "TI-0", "2099-01-01", "10");
    const t = criado(await transferir(p, "4", { provider_lot: "TI-1" }));
    expect((await daOrigem("warehouse_transfers", t)).map((m) => [m.direction, m.provider_lot, m.validade, m.quantity])).toEqual([[1, "TI-1", "2099-03-15", "4.0000"], [-1, "TI-1", "2099-03-15", "4.0000"]]);
    expect(await saldos(p, I.warehouse2)).toEqual({ "TI-1": { q: "4.0000", v: "2099-03-15" } });
    expect(await saldos(p)).toEqual({ "TI-0": { q: "10.0000", v: "2099-01-01" }, "TI-1": { q: "6.0000", v: "2099-03-15" } });
  });

  it("entre empresas (farm), produto com controle 'lote': lote e validade chegam ao armazém da outra empresa", async () => {
    const p = await produto("lote", "transf empresas");
    await lote(p, "TE-1", "2099-02-02", "6");
    const t = criado(await transferir(p, "6", {}, { kind: "farm", empresa_destino_id: I.empresa2, destination_warehouse_id: I.warehouseEmpresa2 }));
    expect(await daOrigem("warehouse_transfers", t, "farm_transfer_in")).toMatchObject([{ provider_lot: "TE-1", validade: "2099-02-02", quantity: "6.0000", warehouse_id: I.warehouseEmpresa2 }]);
    expect(await saldos(p, I.warehouseEmpresa2)).toEqual({ "TE-1": { q: "6.0000", v: "2099-02-02" } });
  });

  it("sem controle e sem lote: como antes — uma perna de cada lado, sem lote", async () => {
    const p = await produto("nenhum", "transf sem controle");
    await lote(p, null, null, "10");
    const t = criado(await transferir(p, "4"));
    expect((await daOrigem("warehouse_transfers", t)).map((m) => [m.direction, m.provider_lot, m.validade, m.quantity])).toEqual([[1, null, null, "4.0000"], [-1, null, null, "4.0000"]]);
    expect(await saldos(p, I.warehouse2)).toEqual({ "": { q: "4.0000", v: null } });
  });
});

describe("LT-10 — lote aparado na borda da API (R1-1 f)", () => {
  it("saldo inicial: '  T-1  ' grava 'T-1' no documento, no movimento e no saldo; a conferência de duplicidade compara o aparado", async () => {
    const p = await produto("lote", "trim inicial");
    const r = await post("/api/stock/opening-balances", { empresa_id: I.empresa, warehouse_id: I.warehouse, product_id: p, quantity: "10", unit_value: "5", provider_lot: "  T-1  " });
    const id = criado(r);
    expect(await um("select provider_lot from erp.opening_balances where id=$1", [id])).toEqual({ provider_lot: "T-1" });
    expect(await daOrigem("opening_balances", id)).toMatchObject([{ provider_lot: "T-1" }]);
    expect(Object.keys(await saldos(p))).toEqual(["T-1"]);
    for (const outro of ["T-1", " T-1", "T-1\t"]) {
      const dup = await post("/api/stock/opening-balances", { empresa_id: I.empresa, warehouse_id: I.warehouse, product_id: p, quantity: "1", unit_value: "5", provider_lot: outro });
      expect(dup.statusCode, `${JSON.stringify(outro)}: ${dup.body}`).toBe(409);
      expect(j(dup).error.code).toBe("DUPLICATE_DOCUMENT");
    }
    expect(await n("select count(*)::text n from erp.opening_balances where product_id=$1", [p])).toBe(1);
    // o documento gravado ANTES do R1-1 (sem aparar) também é achado pela conferência
    await admin.query("insert into erp.opening_balances(organization_id,empresa_id,warehouse_id,product_id,quantity,unit_value,total_value,provider_lot) values ($1,$2,$3,$4,1,5,5,'  T-2 ')", [h.demo.orgId, I.empresa, I.warehouse, p]);
    const legado = await post("/api/stock/opening-balances", { empresa_id: I.empresa, warehouse_id: I.warehouse, product_id: p, quantity: "1", unit_value: "5", provider_lot: "T-2" });
    expect(legado.statusCode, legado.body).toBe(409);
  });

  it("lote só de espaços é 'sem lote': produto com controle → 422 no campo do lote", async () => {
    const p = await produto("lote", "trim vazio");
    recusado(await post("/api/stock/opening-balances", { empresa_id: I.empresa, warehouse_id: I.warehouse, product_id: p, quantity: "1", unit_value: "5", provider_lot: "   " }), "provider_lot");
    expect(await movimentosDo(p)).toBe(0);
  });

  it("itens de entrada de insumo, NF-e, devolução e baixa gravam o lote aparado (item e movimento)", async () => {
    const p = await produto("lote", "trim itens");
    const e = criado(await post("/api/stock/input-entries", { empresa_id: I.empresa, entry_date: DIA, items: [{ product_id: p, quantity: "5", unit_value: "2", warehouse_id: I.warehouse, provider_lot: " E-1 " }] }));
    expect(await um("select provider_lot from erp.input_entry_items where entry_id=$1", [e])).toEqual({ provider_lot: "E-1" });
    expect(await daOrigem("input_entries", e)).toMatchObject([{ provider_lot: "E-1" }]);
    const nf = criado(await post("/api/stock/invoices", { empresa_id: I.empresa, number: `LE${Date.now() % 1_000_000}`, series: "1", provider_id: I.provider, emission_date: DIA, generate_financial: false, items: [{ product_id: p, quantity: "5", unit_value: "2", warehouse_id: I.warehouse, provider_lot: "\tNF-1  " }] }));
    expect(await um("select provider_lot from erp.invoice_items where invoice_id=$1", [nf])).toEqual({ provider_lot: "NF-1" });
    expect(await daOrigem("invoices", nf)).toMatchObject([{ provider_lot: "NF-1" }]);
    const d = criado(await post("/api/stock/devolutions", { empresa_id: I.empresa, devolution_date: DIA, items: [{ warehouse_id: I.warehouse, product_id: p, quantity: "1", unit_value: "2", provider_lot: " E-1" }] }));
    expect(await daOrigem("devolutions", d)).toMatchObject([{ provider_lot: "E-1" }]);
    const b = criado(await post("/api/stock/writeoffs", { empresa_id: I.empresa, warehouse_id: I.warehouse, writeoff_date: DIA, reason: "loss", justification: "teste trim", items: [{ product_id: p, quantity: "1", provider_lot: "NF-1 " }] }));
    expect(await um("select provider_lot from erp.stock_writeoff_items where writeoff_id=$1", [b])).toEqual({ provider_lot: "NF-1" });
    expect(await saldos(p)).toEqual({ "E-1": { q: "6.0000", v: null }, "NF-1": { q: "4.0000", v: null } });
  });

  it("correção: o saldo atual é o do lote APARADO; o ajuste grava o aparado", async () => {
    const p = await produto("lote", "trim correcao");
    await lote(p, "C-9", null, "10");
    const r = await post("/api/stock/corrections", { empresa_id: I.empresa, correction_date: DIA, warehouse_id: I.warehouse, product_id: p, provider_lot: "  C-9 ", new_quantity: "12", justification: "teste trim" });
    const c = criado(r);
    expect(j(r)).toMatchObject({ difference: "2.0000" });
    expect(await um("select provider_lot, previous_quantity::text, new_quantity::text from erp.stock_corrections where id=$1", [c])).toEqual({ provider_lot: "C-9", previous_quantity: "10.0000", new_quantity: "12.0000" });
    expect(await daOrigem("stock_corrections", c)).toMatchObject([{ movement_type: "correction_in", provider_lot: "C-9", quantity: "2.0000" }]);
    expect(await saldos(p)).toEqual({ "C-9": { q: "12.0000", v: null } });
  });

  /**
   * O SALDO gravado ANTES do R1-1 pode ter espaços no lote: a API anterior não aparava. O lote informado (aparado)
   * é resolvido pela CHAVE GRAVADA (`btrim(provider_lot)`): a correção lê o saldo certo, a saída com o lote informado
   * sai dele e a entrada soma nele — nenhum lote novo "sem espaços" nasce ao lado do antigo.
   */
  const legado = (product_id: string, provider_lot: string, quantity: string, expiration_date: string | null) => admin.query(
    `insert into erp.stock_movements (organization_id, empresa_id, warehouse_id, product_id, movement_type, direction, quantity, unit_cost, provider_lot, expiration_date, source_type, source_id, movement_date)
     values ($1,$2,$3,$4,'entry',1,$5,5,$6,$7,'teste_legado',gen_random_uuid(),'2026-09-01')`, [h.demo.orgId, I.empresa, I.warehouse, product_id, quantity, provider_lot, expiration_date]);
  const correcao = (product_id: string, provider_lot: string, new_quantity: string) => post("/api/stock/corrections", { empresa_id: I.empresa, correction_date: DIA, warehouse_id: I.warehouse, product_id, provider_lot, new_quantity, justification: "teste lote legado" });

  it("lote LEGADO com espaços já no saldo: a correção lê o saldo gravado e baixa dele; a entrada soma nele; a correção a zero zera", async () => {
    const p = await produto("lote_validade", "trim legado");
    await legado(p, "  T-9 ", "10", "2099-01-01");
    // o botão "Ajustar estoque" manda o lote CRU da linha de saldo; a API apara e resolve pela chave gravada
    const r = await correcao(p, "  T-9 ", "8");
    const c = criado(r);
    expect(j(r)).toMatchObject({ difference: "-2.0000" });
    expect(await um("select previous_quantity::text, new_quantity::text from erp.stock_corrections where id=$1", [c])).toEqual({ previous_quantity: "10.0000", new_quantity: "8.0000" });
    expect(await daOrigem("stock_corrections", c)).toMatchObject([{ movement_type: "correction_out", direction: -1, provider_lot: "  T-9 ", quantity: "2.0000" }]);
    // entrada do mesmo lote, digitado sem espaços: soma no saldo gravado
    const e = criado(await post("/api/stock/input-entries", { empresa_id: I.empresa, entry_date: DIA, items: [{ product_id: p, quantity: "1", unit_value: "5", warehouse_id: I.warehouse, provider_lot: "T-9", expiration_date: "2099-01-01" }] }));
    expect(await daOrigem("input_entries", e)).toMatchObject([{ provider_lot: "  T-9 ", quantity: "1.0000" }]);
    // correção a ZERO (antes: 422 "Nova quantidade igual ao saldo atual" — o saldo lido era 0 e o lote nunca zerava)
    const z = criado(await correcao(p, "T-9", "0"));
    expect(await daOrigem("stock_corrections", z)).toMatchObject([{ movement_type: "correction_out", provider_lot: "  T-9 ", quantity: "9.0000" }]);
    expect(await saldos(p)).toEqual({ "  T-9 ": { q: "0.0000", v: "2099-01-01" } });
  });

  it("lote LEGADO com espaços e VENCIDO: fora da escolha automática, mas o lote informado (aparado) sai dele", async () => {
    const p = await produto("lote_validade", "trim vencido");
    await legado(p, " V-1", "3", "2026-01-31");
    const b = criado(await post("/api/stock/writeoffs", { empresa_id: I.empresa, warehouse_id: I.warehouse, writeoff_date: DIA, reason: "expiration", justification: "teste lote legado", items: [{ product_id: p, quantity: "3", provider_lot: "V-1" }] }));
    expect(await daOrigem("stock_writeoffs", b)).toMatchObject([{ movement_type: "writeoff", provider_lot: " V-1", validade: "2026-01-31", quantity: "3.0000" }]);
    expect(await saldos(p)).toEqual({ " V-1": { q: "0.0000", v: "2026-01-31" } });
  });

  it("dois saldos legados do MESMO lote que só diferem por espaços, ambos com saldo: o lote informado → 422 nomeando o lote, nada gravado", async () => {
    const p = await produto("lote", "trim ambiguo");
    await legado(p, " A-1", "2", null);
    await legado(p, "A-1 ", "3", null);
    const movAntes = await movimentosDo(p);
    const r = await post("/api/stock/writeoffs", { empresa_id: I.empresa, warehouse_id: I.warehouse, writeoff_date: DIA, reason: "loss", justification: "teste lote ambiguo", items: [{ product_id: p, quantity: "1", provider_lot: "A-1" }] });
    recusado(r, "provider_lot");
    expect(j(r).error.message).toMatch(/"A-1"/);
    expect(await movimentosDo(p)).toBe(movAntes);
    expect(await saldos(p)).toEqual({ " A-1": { q: "2.0000", v: null }, "A-1 ": { q: "3.0000", v: null } });
  });
});
