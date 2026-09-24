import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * R1-1 (PR #62) — SAÍDA DE PRODUTO COM CONTROLE DE LOTE, SEM LOTE INFORMADO: a API ESCOLHE o lote pela validade.
 *
 * A regra (decisão do Maike, opção b): candidatos são os saldos do produto NAQUELE armazém com quantidade > 0 e
 * lote preenchido; validade mais próxima primeiro, sem validade por último, empate pelo lote em ordem
 * alfabética; lote VENCIDO na data do movimento fica fora (só sai informado); a quantidade é dividida entre
 * lotes (um movimento por lote); faltou saldo nos lotes válidos → 409 dizendo quanto há em válidos e vencidos,
 * nada gravado. Com o lote informado, vale o informado — inclusive vencido.
 *
 * Toda asserção decisiva é lida no BANCO, por conexão própria: o ledger (`stock_movements`) diz qual lote saiu e
 * quanto; o saldo (`stock_balances`) é aritmética do gatilho, não do teste.
 */
let h: Harness; let admin: Db; let I: Awaited<ReturnType<typeof ids>>;
type Resp = { statusCode: number; body: string };
const j = (r: Resp) => JSON.parse(r.body) as Record<string, unknown> & { id?: string; error?: { code: string; message: string; details?: Record<string, string> } };
const hdr = () => h.headers({ "content-type": "application/json" });
const post = (url: string, payload: Record<string, unknown> = {}) => h.app.inject({ method: "POST", url, headers: hdr(), payload });
const um = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await admin.query<T>(sql, p)).rows[0];
const n = async (sql: string, p: unknown[] = []) => Number((await um<{ n: string }>(sql, p))!.n);
const nome = (s: string) => `LT ${s} ${Math.random().toString(36).slice(2, 8)}`;
const criado = (r: Resp) => { expect(r.statusCode, r.body).toBe(201); return j(r).id as string; };
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
let base: Record<string, unknown>;

async function produto(controle: "lote" | "lote_validade", rotulo: string): Promise<string> {
  return criado(await post("/api/resources/products", { ...base, description: nome(rotulo), controle_lote: controle }));
}
/** Saldo inicial de UM lote (a porta de entrada mais curta; o custo unitário distingue os lotes no custo médio). */
async function lote(product_id: string, provider_lot: string, expiration_date: string | null, quantity: string, unit_value = "5", warehouse_id = I.warehouse) {
  const r = await post("/api/stock/opening-balances", { empresa_id: I.empresa, warehouse_id, product_id, quantity, unit_value, provider_lot, ...(expiration_date ? { expiration_date } : {}) });
  expect(r.statusCode, r.body).toBe(201);
}
const baixa = (product_id: string, quantity: string, extra: Record<string, unknown> = {}, writeoff_date = "2026-09-20") =>
  post("/api/stock/writeoffs", { empresa_id: I.empresa, warehouse_id: I.warehouse, writeoff_date, reason: "loss", justification: "teste R1-1", items: [{ product_id, quantity, ...extra }] });
/** Saldo por lote do produto (lote → quantidade), lido do banco. */
async function saldos(product_id: string): Promise<Record<string, string>> {
  const r = await admin.query<{ provider_lot: string; quantity: string }>("select provider_lot, quantity::text from erp.stock_balances where product_id=$1 order by provider_lot", [product_id]);
  return Object.fromEntries(r.rows.map((x) => [x.provider_lot, x.quantity]));
}
/**
 * Os movimentos de uma ORIGEM: o que o ledger diz que saiu, de qual lote, quanto. Ordenados pelo LOTE: os
 * movimentos de uma mesma transação têm o MESMO `created_at` (now()), e o ledger não guarda a ordem de gravação.
 * A ordem da escolha se prova pelas QUANTIDADES — o lote que vem primeiro é esgotado antes de o seguinte ser
 * tocado —, nunca pela posição da linha.
 */
const daOrigem = async (source_type: string, source_id: string) => (await admin.query<{ movement_type: string; direction: number; provider_lot: string | null; quantity: string }>(
  "select movement_type, direction, provider_lot, quantity::text from erp.stock_movements where source_type=$1 and source_id=$2 order by provider_lot, movement_type", [source_type, source_id])).rows;
/** lote → quantidade dos movimentos de uma origem (filtrados pelo tipo, quando dado). */
const porLote = async (source_type: string, source_id: string, tipo?: string) =>
  Object.fromEntries((await daOrigem(source_type, source_id)).filter((m) => !tipo || m.movement_type === tipo).map((m) => [m.provider_lot, m.quantity]));
const movimentosDo = (product_id: string) => n("select count(*)::text n from erp.stock_movements where product_id=$1", [product_id]);
const baixasDo = (product_id: string) => n("select count(*)::text n from erp.stock_writeoff_items where product_id=$1", [product_id]);

beforeAll(async () => {
  h = await harness(); admin = createPool(TEST_URL, { max: 3 }); I = await ids(h);
  const org = h.demo.orgId;
  const grupo = (await um<{ id: string }>("select id from erp.product_groups where organization_id=$1 and kind='analytic' and deleted_at is null order by code limit 1", [org]))!.id;
  const un = (await um<{ id: string }>("select id from erp.measurement_units where (organization_id is null or organization_id=$1) and upper(symbol)='UN' order by organization_id nulls last limit 1", [org]))!.id;
  base = { group_id: grupo, measurement_id: un, financial_category_id: I.category };
}, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("LT-1 — saída sem lote consome a validade mais próxima primeiro e divide a quantidade", () => {
  it("lotes de 05/10 e 10/10: 4 saem só do 05/10; 10 saem 6 do 05/10 + 4 do 10/10 (dois movimentos); custo ponderado", async () => {
    const p = await produto("lote_validade", "validade");
    // O NOME inverte a ordem: por lote, 'A-1010' viria antes; pela validade, 'B-0510' (05/10) sai primeiro.
    await lote(p, "A-1010", "2026-10-10", "10", "7");
    await lote(p, "B-0510", "2026-10-05", "10", "5");
    const r1 = await baixa(p, "4");
    const b1 = criado(r1);
    expect(await daOrigem("stock_writeoffs", b1)).toEqual([{ movement_type: "writeoff", direction: -1, provider_lot: "B-0510", quantity: "4.0000" }]);
    expect(await saldos(p)).toEqual({ "A-1010": "10.0000", "B-0510": "6.0000" });

    const r2 = await baixa(p, "10");
    const b2 = criado(r2);
    // dois movimentos: o 05/10 ESGOTADO (os 6 que restavam) e só o que faltou (4) do 10/10
    expect(await daOrigem("stock_writeoffs", b2)).toEqual([
      { movement_type: "writeoff", direction: -1, provider_lot: "A-1010", quantity: "4.0000" },
      { movement_type: "writeoff", direction: -1, provider_lot: "B-0510", quantity: "6.0000" }
    ]);
    expect(await saldos(p)).toEqual({ "A-1010": "6.0000", "B-0510": "0.0000" });
    // custo da baixa = 6 × 5 + 4 × 7 = 58,00 (média ponderada pelas partes, não o custo de um lote só)
    expect(j(r2).total_amount).toBe("58.00");
    // o ledger grava a validade do lote escolhido em cada parte
    expect((await admin.query("select provider_lot, expiration_date::text from erp.stock_movements where source_id=$1 order by provider_lot", [b2])).rows)
      .toEqual([{ provider_lot: "A-1010", expiration_date: "2026-10-10" }, { provider_lot: "B-0510", expiration_date: "2026-10-05" }]);
  });

  it("sem validade por último; empate de validade pelo lote em ordem alfabética", async () => {
    const p = await produto("lote", "desempate");
    await lote(p, "0-SEM", null, "10");      // primeiro na ordem alfabética, mas sem validade → último
    await lote(p, "Z-0510", "2026-10-05", "5");
    await lote(p, "M-0510", "2026-10-05", "5"); // mesma validade do Z: o lote decide (M antes de Z)
    // 7: esgota o M (5) e tira só 2 do Z; o sem validade não é tocado
    const b1 = criado(await baixa(p, "7"));
    expect(await porLote("stock_writeoffs", b1)).toEqual({ "M-0510": "5.0000", "Z-0510": "2.0000" });
    // 5: esgota o Z (3) e só então tira 2 do sem validade
    const b2 = criado(await baixa(p, "5"));
    expect(await porLote("stock_writeoffs", b2)).toEqual({ "Z-0510": "3.0000", "0-SEM": "2.0000" });
    expect(await saldos(p)).toEqual({ "0-SEM": "8.0000", "M-0510": "0.0000", "Z-0510": "0.0000" });
  });
});

describe("LT-2 — lote vencido fica fora da escolha automática", () => {
  it("vencido não é escolhido; faltou em válidos → 409 com as duas quantidades e NADA gravado; só vencido → 409", async () => {
    const p = await produto("lote_validade", "vencido");
    await lote(p, "A-VENCIDO", "2026-09-01", "10"); // vencido em 20/09 — e primeiro por validade E por nome
    await lote(p, "B-OK", "2026-12-31", "3");
    const movAntes = await movimentosDo(p); const docAntes = await baixasDo(p);

    const r = await baixa(p, "5");
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.code).toBe("INSUFFICIENT_STOCK");
    expect(j(r).error!.details).toMatchObject({ solicitado: "5.0000", em_lotes_validos: "3.0000", em_lotes_vencidos: "10.0000" });
    expect(j(r).error!.message).toMatch(/há 3 em lotes válidos e 10 em lotes vencidos/);
    expect(await movimentosDo(p)).toBe(movAntes); expect(await baixasDo(p)).toBe(docAntes);
    expect(await saldos(p)).toEqual({ "A-VENCIDO": "10.0000", "B-OK": "3.0000" });

    // cabe nos válidos: sai do B-OK, e o vencido fica intacto
    const b = criado(await baixa(p, "3"));
    expect((await daOrigem("stock_writeoffs", b)).map((m) => [m.provider_lot, m.quantity])).toEqual([["B-OK", "3.0000"]]);

    // só saldo vencido → 409 (0 em válidos, 10 em vencidos), nada gravado
    const movMeio = await movimentosDo(p);
    const s = await baixa(p, "1");
    expect(s.statusCode, s.body).toBe(409);
    expect(j(s).error!.details).toMatchObject({ em_lotes_validos: "0.0000", em_lotes_vencidos: "10.0000" });
    expect(await movimentosDo(p)).toBe(movMeio);
    expect(await saldos(p)).toEqual({ "A-VENCIDO": "10.0000", "B-OK": "0.0000" });
  });

  it("validade IGUAL à data do movimento ainda vale (vence no dia seguinte)", async () => {
    const p = await produto("lote_validade", "no dia");
    await lote(p, "HOJE", "2026-09-20", "2");
    const b = criado(await baixa(p, "2", {}, "2026-09-20"));
    expect((await daOrigem("stock_writeoffs", b)).map((m) => m.provider_lot)).toEqual(["HOJE"]);
  });
});

describe("LT-3 — saída COM lote informado usa o informado (inclusive vencido)", () => {
  it("lote vencido informado sai; lote de validade mais longa informado sai no lugar do mais próximo", async () => {
    const p = await produto("lote_validade", "informado");
    await lote(p, "VENCIDO", "2026-01-31", "4");
    await lote(p, "PERTO", "2026-10-01", "4");
    await lote(p, "LONGE", "2027-10-01", "4");
    const v = criado(await baixa(p, "4", { provider_lot: "VENCIDO" }));
    expect(await daOrigem("stock_writeoffs", v)).toEqual([{ movement_type: "writeoff", direction: -1, provider_lot: "VENCIDO", quantity: "4.0000" }]);
    const l = criado(await baixa(p, "1", { provider_lot: "LONGE" }));
    expect((await daOrigem("stock_writeoffs", l)).map((m) => m.provider_lot)).toEqual(["LONGE"]);
    expect(await saldos(p)).toEqual({ LONGE: "3.0000", PERTO: "4.0000", VENCIDO: "0.0000" });
    // lote informado sem saldo NÃO cai na escolha automática: é recusa do gatilho de saldo
    const x = await baixa(p, "5", { provider_lot: "PERTO" });
    expect(x.statusCode, x.body).toBe(409);
    expect(await saldos(p)).toEqual({ LONGE: "3.0000", PERTO: "4.0000", VENCIDO: "0.0000" });
  });
});

describe("LT-4 — cada fluxo real de saída, sem lote, grava pela escolha automática", () => {
  it("venda confirmada, abastecimento, manutenção, OS, manejo, dieta, ração, requisição e baixa escolhem o lote de validade mais próxima", async () => {
    const p = await produto("lote", "fluxos");
    // validades longe no futuro: a OS baixa com a data de HOJE, e o teste não pode depender do relógio.
    await lote(p, "A-TARDE", "2099-06-10", "100", "9");
    await lote(p, "Z-CEDO", "2099-01-10", "100", "4");
    const dia = "2026-09-20";
    const esperado = (tipo: string) => [{ movement_type: tipo, direction: -1, provider_lot: "Z-CEDO", quantity: "1.0000" }];
    const provas: Record<string, unknown> = {};

    // venda: cria, confirma; o movimento sai na confirmação
    const venda = criado(await post("/api/sales/sales", { empresa_id: I.empresa, document_date: dia, client_id: I.client, items: [{ product_id: p, warehouse_id: I.warehouse, quantity: "1", unit_price: "20.00" }] }));
    const conf = await post(`/api/sales/sales/${venda}/confirm`);
    expect(conf.statusCode, conf.body).toBe(200);
    provas.venda = await daOrigem("sales_documents", venda);

    const abast = criado(await post("/api/fleet/fuel-supplies", { empresa_id: I.empresa, supply_date: dia, equipment_id: I.equipment, warehouse_id: I.warehouse, product_id: p, quantity: "1" }));
    provas.abastecimento = await daOrigem("fuel_supplies", abast);

    const manut = criado(await post("/api/fleet/maintenances", { empresa_id: I.empresa, maintenance_date: dia, machines: [{ equipment_id: I.equipment, items: [{ warehouse_id: I.warehouse, product_id: p, quantity: "1" }] }] }));
    provas.manutencao = await daOrigem("maintenances", manut);

    const os = criado(await post("/api/service-orders", { empresa_id: I.empresa, order_date: dia, description: "OS R1-1", lines: [{ section: "input", product_id: p, warehouse_id: I.warehouse, quantity: "1", unit_value: "0" }] }));
    for (const status of ["in_progress", "finished"]) { const s = await post(`/api/service-orders/${os}/status`, { status }); expect(s.statusCode, s.body).toBe(200); }
    provas.os = await daOrigem("service_orders", os);

    // manejo: a tela não manda o lote — o corpo aqui também não
    const manejo = criado(await post("/api/livestock/handlings", { empresa_id: I.empresa, handling_type: "sanitary", handling_date: dia, batch_id: I.batch, product_id: p, warehouse_id: I.warehouse, dose: "1", items: [{ animal_id: I.animal, quantity: "1" }] }));
    provas.manejo = await daOrigem("animal_handlings", manejo);

    // dieta: ingrediente único (100%) — a dieta não tem porta de API para os itens; o cenário é gravado direto
    const dieta = criado(await post("/api/resources/diets", { name: nome("dieta") }));
    await admin.query("insert into erp.diet_items(diet_id, product_id, percentage) values ($1,$2,100)", [dieta, p]);
    const batelada = criado(await post("/api/feedlot/diet-batches", { empresa_id: I.empresa, batch_date: dia, diet_id: dieta, warehouse_id: I.warehouse, quantity_kg: "1" }));
    provas.dieta = await daOrigem("diet_batches", batelada);

    // ração: o insumo da fórmula (produto com lote) sai do armazém de origem; o acabado entra no destino
    const formula = criado(await post("/api/stock/feed-formulas", { name: nome("formula"), product_id: I.product2, items: [{ product_id: p, quantity: "1" }] }));
    const racao = criado(await post("/api/stock/feed-batches", { empresa_id: I.empresa, batch_date: dia, formula_id: formula, origin_warehouse_id: I.warehouse, destination_warehouse_id: I.warehouse2, quantity_produced: "1" }));
    provas.racao = (await daOrigem("feed_batches", racao)).filter((m) => m.direction === -1);

    const req = criado(await post("/api/stock/requisitions", { empresa_id: I.empresa, requisition_date: dia, items: [{ warehouse_id: I.warehouse, product_id: p, quantity: "1" }] }));
    provas.requisicao = await daOrigem("requisitions", req);

    const bx = criado(await baixa(p, "1", {}, dia));
    provas.baixa = await daOrigem("stock_writeoffs", bx);

    expect(provas).toEqual({
      venda: esperado("sale"), abastecimento: esperado("fuel_supply"), manutencao: esperado("maintenance"), os: esperado("requisition"),
      manejo: esperado("nutrition"), dieta: esperado("nutrition"), racao: esperado("production_out"), requisicao: esperado("requisition"), baixa: esperado("writeoff")
    });
    // nove saídas de 1, todas do Z-CEDO; o A-TARDE não foi tocado
    expect(await saldos(p)).toEqual({ "A-TARDE": "100.0000", "Z-CEDO": "91.0000" });
  });
});

describe("LT-5 — cancelar a venda que consumiu 2 lotes devolve aos 2", () => {
  it("venda de 5 com Z-CEDO=3 e A-TARDE=10: sai 3 + 2; o cancelamento estorna cada movimento com o seu lote", async () => {
    const p = await produto("lote", "venda 2 lotes");
    await lote(p, "A-TARDE", "2099-06-10", "10");
    await lote(p, "Z-CEDO", "2099-01-10", "3");
    const venda = criado(await post("/api/sales/sales", { empresa_id: I.empresa, document_date: "2026-09-20", client_id: I.client, items: [{ product_id: p, warehouse_id: I.warehouse, quantity: "5", unit_price: "20.00" }] }));
    const c = await post(`/api/sales/sales/${venda}/confirm`);
    expect(c.statusCode, c.body).toBe(200);
    // o Z-CEDO (validade mais próxima) é esgotado; o A-TARDE dá só o que faltou
    expect(await porLote("sales_documents", venda, "sale")).toEqual({ "Z-CEDO": "3.0000", "A-TARDE": "2.0000" });
    expect(await saldos(p)).toEqual({ "A-TARDE": "8.0000", "Z-CEDO": "0.0000" });
    // a auditoria da confirmação lista os DOIS movimentos
    const aud = await um<{ m: string[] }>("select metadata->'movimentos' as m from erp.audit_logs where entity='sales_documents' and entity_id=$1 and action='confirm'", [venda]);
    expect(aud!.m).toHaveLength(2);

    const x = await post(`/api/sales/sales/${venda}/cancel`);
    expect(x.statusCode, x.body).toBe(200);
    const estornos = (await daOrigem("sales_documents", venda)).filter((m) => m.movement_type === "reversal");
    expect(estornos.map((m) => [m.direction, m.provider_lot, m.quantity])).toEqual([[1, "A-TARDE", "2.0000"], [1, "Z-CEDO", "3.0000"]]);
    expect(await saldos(p)).toEqual({ "A-TARDE": "10.0000", "Z-CEDO": "3.0000" });
  });
});

describe("LT-9 — saídas SIMULTÂNEAS do mesmo lote", () => {
  /**
   * Duas transações de verdade (o pool da API tem várias conexões). O determinismo vem de uma TERCEIRA conexão,
   * B, que segura a linha de saldo: as duas baixas só são soltas depois de o PostgreSQL mostrar as duas
   * esperando trava numa consulta de estoque — nada de sleep adivinhando a janela.
   */
  const esperandoTrava = async () => Number((await admin.query<{ n: string }>(
    `select count(*)::text n from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock' and query ilike '%erp.stock_%'`)).rows[0]!.n);
  async function ateEsperarem(quantas: number) {
    const t0 = performance.now(); let vistos = 0;
    while (vistos < quantas && performance.now() - t0 < 20_000) { vistos = await esperandoTrava(); if (vistos < quantas) await espera(20); }
    expect(vistos, "as saídas não foram vistas esperando a trava de B").toBeGreaterThanOrEqual(quantas);
  }

  it("lote único com 10, duas vendas de 7 confirmadas ao mesmo tempo: uma confirma, a outra 409; saldo 3, nunca negativo", async () => {
    // Confirmação de venda: nenhum contador (código, ID Global) serializa as duas antes do estoque — a disputa
    // acontece exatamente na linha de saldo do lote. (Duas BAIXAS fariam fila antes, no contador do código.)
    const p = await produto("lote", "concorrencia");
    await lote(p, "UNICO", "2099-01-01", "10");
    const venda = async () => criado(await post("/api/sales/sales", { empresa_id: I.empresa, document_date: "2026-09-20", client_id: I.client, items: [{ product_id: p, warehouse_id: I.warehouse, quantity: "7", unit_price: "20.00" }] }));
    const v1 = await venda(); const v2 = await venda();
    const b = await admin.connect();
    let aberta = false; let corrida: Promise<Resp[]> | null = null;
    try {
      await b.query("begin"); aberta = true;
      const trava = await b.query("select 1 from erp.stock_balances where product_id=$1 and provider_lot='UNICO' for update", [p]);
      expect(trava.rowCount, "premissa: B travou o saldo").toBe(1);
      corrida = Promise.all([post(`/api/sales/sales/${v1}/confirm`), post(`/api/sales/sales/${v2}/confirm`)]);
      await ateEsperarem(2);
      await b.query("rollback"); aberta = false;
      const rs = await corrida;
      expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      const recusa = rs.find((r) => r.statusCode === 409)!;
      expect(j(recusa).error!.code, recusa.body).toBe("INSUFFICIENT_STOCK");
      expect(j(recusa).error!.details, recusa.body).toMatchObject({ solicitado: "7.0000", em_lotes_validos: "3.0000", em_lotes_vencidos: "0.0000" });
    } finally {
      if (aberta) await b.query("rollback").catch(() => undefined);
      await corrida?.catch(() => undefined);
      b.release();
    }
    expect(await saldos(p)).toEqual({ UNICO: "3.0000" });
    expect(await n("select count(*)::text n from erp.stock_movements where product_id=$1 and direction=-1", [p])).toBe(1);
    expect(await n("select count(*)::text n from erp.stock_balances where product_id=$1 and quantity < 0", [p])).toBe(0);
  }, 60_000);

  it("a escolha é feita sobre o saldo RELIDO depois da espera: outra transação levou 7 do lote mais próximo → 3 dele + 5 do seguinte", async () => {
    const p = await produto("lote", "relida");
    await lote(p, "A-1", "2099-01-01", "10");
    await lote(p, "B-2", "2099-02-01", "10");
    const b = await admin.connect();
    let aberta = false; let saida: Promise<Resp> | null = null;
    try {
      await b.query("begin"); aberta = true;
      // B é uma saída concorrente de 7 do A-1, ainda não confirmada (o gatilho de saldo já travou e baixou a linha)
      await b.query(`insert into erp.stock_movements (organization_id, empresa_id, warehouse_id, product_id, movement_type, direction, quantity, provider_lot, source_type, source_id, movement_date)
                     values ($1,$2,$3,$4,'writeoff',-1,7,'A-1','teste_concorrencia',gen_random_uuid(),'2026-09-20')`, [h.demo.orgId, I.empresa, I.warehouse, p]);
      saida = baixa(p, "8");
      await ateEsperarem(1);
      await b.query("commit"); aberta = false;
      const r = await saida;
      const id = criado(r);
      expect((await daOrigem("stock_writeoffs", id)).map((m) => [m.provider_lot, m.quantity])).toEqual([["A-1", "3.0000"], ["B-2", "5.0000"]]);
    } finally {
      if (aberta) await b.query("rollback").catch(() => undefined);
      await saida?.catch(() => undefined);
      b.release();
    }
    expect(await saldos(p)).toEqual({ "A-1": "0.0000", "B-2": "5.0000" });
  }, 60_000);

  /**
   * LT-9c — a escolha trava SÓ os lotes que vai consumir (revisão do R1). O gatilho de saldo trava a linha do saldo
   * e DEPOIS a do produto (`update erp.products`). B faz o papel de uma transferência W2 → W do lote B-LONGE: a perna
   * de saída já segurou a linha do PRODUTO, e a perna de entrada ainda vai pedir o saldo B-LONGE do armazém W. A
   * venda sem lote em W precisa só do A-PERTO. Travando também o B-LONGE (que não usa) antes de gravar, a venda
   * fechava um ciclo com B — venda espera o produto, B espera o B-LONGE — e o PostgreSQL abortava uma das duas
   * (40P01, que a API devolve como 409 CONCURRENCY_CONFLICT). Travando só o que consome, não há ciclo.
   */
  it("LT-9c: venda sem lote que só precisa do lote mais próximo não trava o outro — a transferência concorrente para o armazém pega o outro lote e a venda confirma (sem 40P01)", async () => {
    const p = await produto("lote", "trava so o usado");
    await lote(p, "A-PERTO", "2099-01-01", "10");
    await lote(p, "B-LONGE", "2099-06-01", "10");
    const v = criado(await post("/api/sales/sales", { empresa_id: I.empresa, document_date: "2026-09-20", client_id: I.client, items: [{ product_id: p, warehouse_id: I.warehouse, quantity: "1", unit_price: "20.00" }] }));
    const b = await admin.connect();
    let aberta = false; let conf: Promise<Resp> | null = null;
    try {
      await b.query("begin"); aberta = true;
      await b.query("set local lock_timeout = '10s'");
      await b.query("select 1 from erp.products where id=$1 for update", [p]); // a perna de saída da transferência já travou o produto
      conf = post(`/api/sales/sales/${v}/confirm`);
      await ateEsperarem(1); // a venda gravou o seu lote e espera a linha do produto
      const t = await b.query("select 1 from erp.stock_balances where product_id=$1 and warehouse_id=$2 and provider_lot='B-LONGE' for update", [p, I.warehouse]);
      expect(t.rowCount, "a perna de entrada da transferência travou o B-LONGE").toBe(1);
      await b.query("rollback"); aberta = false;
      const r = await conf;
      expect(r.statusCode, r.body).toBe(200);
    } finally {
      if (aberta) await b.query("rollback").catch(() => undefined);
      await conf?.catch(() => undefined);
      b.release();
    }
    expect(await porLote("sales_documents", v, "sale")).toEqual({ "A-PERTO": "1.0000" });
    expect(await saldos(p)).toEqual({ "A-PERTO": "9.0000", "B-LONGE": "10.0000" });
  }, 60_000);
});

describe("LT-11 — quantidade que arredonda a zero na escala do estoque (4 casas)", () => {
  it("baixa sem lote de 0,00004 → 422 'Quantidade deve ser positiva', nada gravado (a divisão por lotes recebia zero e respondia 500)", async () => {
    const p = await produto("lote", "quase zero");
    await lote(p, "Q-1", "2099-01-01", "10");
    const movAntes = await movimentosDo(p);
    const r = await baixa(p, "0.00004");
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error!.code).toBe("VALIDATION_ERROR");
    expect(j(r).error!.message).toMatch(/Quantidade deve ser positiva/);
    expect(await movimentosDo(p)).toBe(movAntes); expect(await baixasDo(p)).toBe(0);
    expect(await saldos(p)).toEqual({ "Q-1": "10.0000" });
  });
});

describe("LT-12 — soma exata: o valor do documento é a soma do razão, também quando a saída é dividida", () => {
  /** Soma de `total_cost` (round(q × custo, 2) por movimento) de uma origem, lida do banco. */
  const razao = async (source_type: string, source_id: string, tipo?: string) => (await um<{ t: string }>(
    "select coalesce(sum(total_cost),0)::text t from erp.stock_movements where source_type=$1 and source_id=$2 and ($3::text is null or movement_type=$3)", [source_type, source_id, tipo ?? null]))!.t;
  /** Custos médios que NÃO dão conta exata: 3 a 5,333333 → saldo 16,00; 3 a 7,333333 → 22,00. */
  async function doisLotesDeCustoQuebrado(rotulo: string) {
    const p = await produto("lote_validade", rotulo);
    await lote(p, "A-CEDO", "2099-01-01", "3", "5.333333");
    await lote(p, "B-TARDE", "2099-06-01", "3", "7.333333");
    criado(await baixa(p, "2", { provider_lot: "A-CEDO" })); // o A fica com 1 (média 5,333333)
    return p;
  }

  it("baixa e transferência de 2 que saem 1 de cada lote: total 12,66 = Σ razão (5,33 + 7,33), nunca 2 × a média ponderada (12,67)", async () => {
    const p = await doisLotesDeCustoQuebrado("soma baixa");
    const r = await baixa(p, "2");
    const bx = criado(r);
    expect(await porLote("stock_writeoffs", bx)).toEqual({ "A-CEDO": "1.0000", "B-TARDE": "1.0000" });
    expect(await razao("stock_writeoffs", bx)).toBe("12.66");
    expect(j(r).total_amount).toBe("12.66");
    expect(await um("select sum(total_value)::text t from erp.stock_writeoff_items where writeoff_id=$1", [bx])).toEqual({ t: "12.66" });

    const q = await doisLotesDeCustoQuebrado("soma transf");
    const t = await post("/api/stock/transfers", { kind: "warehouse", transfer_date: "2026-09-20", empresa_origem_id: I.empresa, origin_warehouse_id: I.warehouse, destination_warehouse_id: I.warehouse2, items: [{ product_id: q, quantity: "2" }] });
    const tr = criado(t);
    // o que sai da origem, o que entra no destino e o valor do documento são o MESMO número
    expect(await razao("warehouse_transfers", tr, "transfer_out")).toBe("12.66");
    expect(await razao("warehouse_transfers", tr, "transfer_in")).toBe("12.66");
    expect(j(t).total_value).toBe("12.66");
    expect(await um("select total_value::text t from erp.warehouse_transfer_items where transfer_id=$1", [tr])).toEqual({ t: "12.66" });
  });

  it("correção para BAIXO sem lote: cada parte sai pela média do PRÓPRIO lote — o razão bate com o valor que o saldo perdeu", async () => {
    const p = await produto("lote", "correcao media");
    await lote(p, "A-CEDO", "2099-01-01", "10", "5");
    await lote(p, "B-TARDE", "2099-06-01", "10", "7");
    const valor = async () => (await um<{ v: string }>("select sum(total_value)::text v from erp.stock_balances where product_id=$1", [p]))!.v;
    expect(await valor()).toBe("120.00");
    const r = await post("/api/stock/corrections", { empresa_id: I.empresa, correction_date: "2026-09-20", warehouse_id: I.warehouse, product_id: p, new_quantity: "6", justification: "teste soma exata" });
    const c = criado(r);
    // −14: esgota o A (10 a 5) e tira 4 do B (a 7) — e não 14 a 6 (a média dos DOIS lotes)
    expect((await admin.query("select provider_lot, quantity::text, unit_cost::text, total_cost::text from erp.stock_movements where source_id=$1 order by provider_lot", [c])).rows)
      .toEqual([{ provider_lot: "A-CEDO", quantity: "10.0000", unit_cost: "5.000000", total_cost: "50.00" }, { provider_lot: "B-TARDE", quantity: "4.0000", unit_cost: "7.000000", total_cost: "28.00" }]);
    expect(await valor()).toBe("42.00");
    expect(await razao("stock_corrections", c)).toBe("78.00"); // 120 − 42
  });
});

describe("LT-13 — estorno que devolveria saldo ao balde SEM lote de produto com controle (R1-1 h)", () => {
  it("produto sem controle movimentado sem lote, controle ligado com saldo zero: cancelar a baixa e o saldo inicial → 422, nada gravado (o saldo ficaria preso)", async () => {
    const p = criado(await post("/api/resources/products", { ...base, description: nome("balde"), controle_lote: "nenhum" }));
    const ob = criado(await post("/api/stock/opening-balances", { empresa_id: I.empresa, warehouse_id: I.warehouse, product_id: p, quantity: "4", unit_value: "5" }));
    const bx = criado(await baixa(p, "4"));
    expect(await saldos(p)).toEqual({ "": "0.0000" });
    // saldo zero na organização: o controle pode mudar
    const put = await h.app.inject({ method: "PUT", url: `/api/resources/products/${p}`, headers: hdr(), payload: { controle_lote: "lote" } });
    expect(put.statusCode, put.body).toBe(200);
    const movAntes = await movimentosDo(p);

    const c = await post(`/api/stock/writeoffs/${bx}/cancel`);
    expect(c.statusCode, c.body).toBe(422);
    expect(j(c).error!.code).toBe("VALIDATION_ERROR");
    expect(j(c).error!.message).toMatch(/sem lote/);
    expect(await um("select status from erp.stock_writeoffs where id=$1", [bx])).toEqual({ status: "confirmed" });

    const o = await h.app.inject({ method: "DELETE", url: `/api/stock/opening-balances/${ob}`, headers: h.headers() });
    expect(o.statusCode, o.body).toBe(422);
    expect(await um("select status from erp.opening_balances where id=$1", [ob])).toEqual({ status: "confirmed" });

    expect(await movimentosDo(p)).toBe(movAntes);
    expect(await saldos(p)).toEqual({ "": "0.0000" });
  });

  it("o estorno de movimento COM lote continua normal depois de o controle mudar", async () => {
    const p = await produto("lote", "estorno com lote");
    await lote(p, "L-1", null, "5");
    const bx = criado(await baixa(p, "2"));
    const c = await post(`/api/stock/writeoffs/${bx}/cancel`);
    expect(c.statusCode, c.body).toBe(200);
    expect(await saldos(p)).toEqual({ "L-1": "5.0000" });
  });
});

describe("LT-14 — o detalhe do documento diz de qual lote saiu cada movimento (R1-1 c: devolução a partir da requisição)", () => {
  it("requisição sem lote dividida em 2 lotes: os movimentos do detalhe trazem armazém, produto, lote, validade e centro de cada parte", async () => {
    const p = await produto("lote_validade", "detalhe");
    await lote(p, "A-CEDO", "2099-01-01", "3");
    await lote(p, "B-TARDE", "2099-06-01", "10");
    const req = criado(await post("/api/stock/requisitions", { empresa_id: I.empresa, requisition_date: "2026-09-20", items: [{ warehouse_id: I.warehouse, product_id: p, quantity: "5" }] }));
    const d = await h.app.inject({ method: "GET", url: `/api/stock/requisitions/${req}`, headers: h.headers() });
    expect(d.statusCode, d.body).toBe(200);
    const doc = JSON.parse(d.body) as { items: Record<string, unknown>[]; movements: Record<string, unknown>[] };
    // o item da requisição não tem lote (a escolha foi automática) — o lote está no MOVIMENTO
    expect(doc.items.map((i) => i["provider_lot"])).toEqual([null]);
    const partes = doc.movements.map((m) => ({ lote: m["provider_lot"], validade: m["expiration_date"], quantidade: m["quantity"], armazem: m["warehouse_id"], produto: m["product_id"], centro: m["cost_center_id"] }))
      .sort((a, b) => String(a.lote).localeCompare(String(b.lote)));
    expect(partes).toEqual([
      { lote: "A-CEDO", validade: "2099-01-01", quantidade: "3.0000", armazem: I.warehouse, produto: p, centro: null },
      { lote: "B-TARDE", validade: "2099-06-01", quantidade: "2.0000", armazem: I.warehouse, produto: p, centro: null }
    ]);
  });
});
