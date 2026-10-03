import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { todayISO } from "@agro/shared";
import { c, iniciar, encerrar, produto, saldoInicial, j, unico, DATA, type Resposta } from "./estoque-01-ajuda.js";

/**
 * OPERACOES-01 F5a (decisão 282) — O RAZÃO COM DESTINO (pacote `ledger`).
 *
 * O razão (`erp.stock_movements`) ganhou na 0043 as dimensões de destino que faltavam: máquina/equipamento
 * (`equipamento_id`), ordem de serviço (`ordem_servico_id`), lote de animais (`lote_animais_id`) e área/talhão
 * (`area_id`), ao lado do centro de resultado (`cost_center_id`) e da safra (`harvest_id`) que já existiam. Aqui se
 * prova, pelas rotas ANTIGAS (o documento de estoque com destino é do pacote `api-documento`):
 *   · a OS finalizada grava no movimento o centro de resultado, a safra e a própria OS — a data continua a de hoje;
 *   · o manejo grava o lote de animais (o manejo não tem centro de resultado);
 *   · "Saídas x Centro de Resultado" deixa de somar a saída estornada;
 *   · o estorno leva o destino do original — inclusive a cultura, que antes não levava, e as quatro colunas novas;
 *   · a lista de saldo traz a empresa do local de estoque de cada linha.
 *
 * O QUE CONTA COMO PROVA: o efeito é lido no banco por conexão própria de superusuário (`c.admin`, sem RLS), pela
 * origem do razão (`source_type`, `source_id`). Cada caso afirma a PREMISSA (o que a origem tem) ao lado da
 * conclusão (o que o movimento gravou), e cria o PRÓPRIO produto: nenhum caso lê o saldo de outro.
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

interface DestinoNoRazao {
  id: string; movement_type: string; direction: number; quantity: string; movement_date: string; note: string | null;
  cost_center_id: string | null; harvest_id: string | null; cultivation_id: string | null;
  equipamento_id: string | null; ordem_servico_id: string | null; lote_animais_id: string | null; area_id: string | null;
}
/** Os movimentos de uma origem com as sete colunas de destino (estornos inclusive), em ordem estável. */
async function razaoDaOrigem(sourceType: string, sourceId: string): Promise<DestinoNoRazao[]> {
  return (await c.admin.query<DestinoNoRazao>(
    `select id, movement_type, direction, quantity::text, to_char(movement_date,'YYYY-MM-DD') as movement_date, note,
            cost_center_id, harvest_id, cultivation_id, equipamento_id, ordem_servico_id, lote_animais_id, area_id
       from erp.stock_movements where source_type=$1 and source_id=$2
      order by created_at, (movement_type = 'reversal'), id`, [sourceType, sourceId])).rows;
}
const post = (url: string, payload: Record<string, unknown>): Promise<Resposta> => c.h.app.inject({ method: "POST", url, headers: c.h.headers(), payload });
const get = (url: string): Promise<Resposta> => c.h.app.inject({ method: "GET", url, headers: c.h.headers() });
function criado(r: Resposta): string {
  expect(r.statusCode, `premissa: o registro é criado — ${r.body}`).toBe(201);
  return (j(r) as { id: string }).id;
}
async function umId(sql: string, rotulo: string): Promise<string> {
  const id = (await c.admin.query<{ id: string }>(sql, [c.h.demo.orgId])).rows[0]?.id;
  expect(id, `premissa: o seed tem ${rotulo}`).toEqual(expect.any(String));
  return id!;
}
const safra = () => umId("select id from erp.harvests where organization_id=$1 and deleted_at is null order by start_date limit 1", "uma safra");
const area = () => umId("select id from erp.areas where organization_id=$1 and deleted_at is null order by code limit 1", "uma área/talhão");
/** Um centro de resultado analítico NOVO (por SQL): o nome é único, e a linha do relatório é só deste caso. */
async function centroNovo(): Promise<{ id: string; nome: string }> {
  const s = unico();
  const r = await c.admin.query<{ id: string; name: string }>(
    "insert into erp.cost_centers (organization_id, code, name, kind) values ($1,$2,$3,'analytic') returning id, name", [c.h.demo.orgId, `F5A${s}`, `Centro F5a ${s}`]);
  return { id: r.rows[0]!.id, nome: r.rows[0]!.name };
}
/** Uma cultura NOVA (por SQL; o seed não tem nenhuma). */
async function culturaNova(): Promise<string> {
  return (await c.admin.query<{ id: string }>(
    "insert into erp.cultivations (organization_id, crop, variety) values ($1,'Milho',$2) returning id", [c.h.demo.orgId, `F5a ${unico()}`])).rows[0]!.id;
}
/** Uma OS aberta pela rota antiga, com centro de resultado, safra e uma linha de insumo do produto. */
async function osAberta(produtoId: string, quantidade: string, destino: { centro: string; safra: string }): Promise<string> {
  return criado(await post("/api/service-orders", {
    empresa_id: c.I.empresa, order_date: DATA, cost_center_id: destino.centro, harvest_id: destino.safra, description: `OS F5a ${unico()}`,
    lines: [{ section: "input", product_id: produtoId, warehouse_id: c.I.warehouse, quantity: quantidade, unit_value: "0" }] }));
}

describe("L-1 — a OS finalizada grava no movimento o destino que já tem", () => {
  it("L-1 OS com centro de resultado e safra, finalizada → o movimento `requisition` leva o centro, a safra e a própria OS; a data continua a de hoje", async () => {
    const p = await produto();
    await saldoInicial(p.id, "10");
    const centro = c.I.costCenter; const s = await safra();
    const os = await osAberta(p.id, "3", { centro, safra: s });
    // PREMISSA: a OS tem os dois (o que ela já tinha antes da F5a), a data dela não é a de hoje, e nada saiu ainda.
    const gravada = (await c.admin.query<{ cost_center_id: string | null; harvest_id: string | null; order_date: string }>(
      "select cost_center_id, harvest_id, to_char(order_date,'YYYY-MM-DD') as order_date from erp.service_orders where id=$1", [os])).rows[0]!;
    expect(gravada, "premissa: a OS tem centro de resultado e safra").toEqual({ cost_center_id: centro, harvest_id: s, order_date: DATA });
    expect(DATA, "premissa: a data da OS difere da de hoje").not.toBe(todayISO());
    expect(await razaoDaOrigem("service_orders", os), "premissa: a OS aberta não moveu nada").toEqual([]);

    for (const status of ["in_progress", "finished"]) {
      const r = await post(`/api/service-orders/${os}/status`, { status });
      expect(r.statusCode, r.body).toBe(200);
    }

    const mov = await razaoDaOrigem("service_orders", os);
    expect(mov.map((m) => ({ ...m, id: "-" }))).toEqual([{
      id: "-", movement_type: "requisition", direction: -1, quantity: "3.0000", movement_date: todayISO(), note: expect.stringMatching(/^OS /),
      cost_center_id: centro, harvest_id: s, cultivation_id: null,
      equipamento_id: null, ordem_servico_id: os, lote_animais_id: null, area_id: null,
    }]);
  });
});

describe("L-2 — o manejo grava no movimento o lote de animais", () => {
  it("L-2 manejo de nutrição com lote → o movimento `nutrition` leva o lote de animais (e nenhum centro: o manejo não tem)", async () => {
    // PREMISSA: o manejo não tem centro de resultado — `erp.animal_handlings` não tem a coluna; o destino que ele tem é o lote.
    const colunas = (await c.admin.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema='erp' and table_name='animal_handlings' and column_name in ('cost_center_id','batch_id') order by column_name")).rows.map((r) => r.column_name);
    expect(colunas, "premissa: o manejo tem lote de animais e não tem centro de resultado").toEqual(["batch_id"]);
    const p = await produto();
    await saldoInicial(p.id, "10");

    const r = await post("/api/livestock/handlings", {
      empresa_id: c.I.empresa, handling_type: "nutrition", handling_date: DATA, batch_id: c.I.batch, product_id: p.id, warehouse_id: c.I.warehouse,
      dose: "2", items: [{ animal_id: c.I.animal, quantity: "1" }] });
    const manejo = criado(r);
    expect((await c.admin.query<{ batch_id: string }>("select batch_id from erp.animal_handlings where id=$1", [manejo])).rows[0]!.batch_id,
      "premissa: o manejo gravou o lote de animais").toBe(c.I.batch);

    const mov = await razaoDaOrigem("animal_handlings", manejo);
    expect(mov.map((m) => ({ ...m, id: "-", note: "-" }))).toEqual([{
      id: "-", movement_type: "nutrition", direction: -1, quantity: "2.0000", movement_date: DATA, note: "-",
      cost_center_id: null, harvest_id: null, cultivation_id: null,
      equipamento_id: null, ordem_servico_id: null, lote_animais_id: c.I.batch, area_id: null,
    }]);
  });
});

describe("L-3 — \"Saídas x Centro de Resultado\" não soma saída estornada", () => {
  it("L-3 duas baixas no centro (5 e 3), a de 3 cancelada → o centro soma 5; a baixa viva não some por causa do estorno da outra", async () => {
    const p = await produto();
    await saldoInicial(p.id, "20", { custo: "10" });
    const centro = await centroNovo();
    const baixa = (quantidade: string) => post("/api/stock/writeoffs", {
      empresa_id: c.I.empresa, writeoff_date: DATA, reason: "consumption", cost_center_id: centro.id, warehouse_id: c.I.warehouse,
      justification: "consumo no centro F5a", items: [{ product_id: p.id, quantity: quantidade }] });
    const viva = criado(await baixa("5"));
    const cancelada = criado(await baixa("3"));
    const r = await post(`/api/stock/writeoffs/${cancelada}/cancel`, {});
    expect(r.statusCode, r.body).toBe(200);

    // PREMISSA LIDA NO RAZÃO: as duas saídas existem no centro, e o estorno +3 é da baixa cancelada — no mesmo
    // produto e local de estoque. A soma de antes (toda saída não estorno) daria 8.
    const daViva = await razaoDaOrigem("stock_writeoffs", viva);
    const daCancelada = await razaoDaOrigem("stock_writeoffs", cancelada);
    expect(daViva.map((m) => [m.movement_type, m.direction, m.quantity, m.cost_center_id])).toEqual([["writeoff", -1, "5.0000", centro.id]]);
    expect(daCancelada.map((m) => [m.movement_type, m.direction, m.quantity, m.cost_center_id])).toEqual([
      ["writeoff", -1, "3.0000", centro.id], ["reversal", 1, "3.0000", centro.id]]);
    const somaDeAntes = (await c.admin.query<{ q: string }>(
      "select sum(quantity)::text q from erp.stock_movements where product_id=$1 and direction=-1 and movement_type<>'reversal' and cost_center_id=$2", [p.id, centro.id])).rows[0]!.q;
    expect(somaDeAntes, "premissa: sem o filtro do estorno, o centro somaria 8").toBe("8.0000");

    const rel = await get("/api/reports/exits_cost_center");
    expect(rel.statusCode, rel.body).toBe(200);
    const linhas = (j(rel) as { rows: { cost_center: string; product: string; quantity: string; total_cost: string }[] }).rows.filter((x) => x.product === p.nome);
    expect(linhas, "o centro soma só a baixa viva: 5 unidades a 10").toEqual([{ cost_center: centro.nome, product: p.nome, quantity: "5.0000", total_cost: "50.00" }]);
  });
});

describe("L-4 — o estorno leva o destino do original", () => {
  it("L-4a entrada manual antiga com cultura, centro e safra, cancelada → o estorno leva a cultura (antes não levava), o centro e a safra", async () => {
    const p = await produto();
    const cultura = await culturaNova(); const centro = c.I.costCenter; const s = await safra();
    const entrada = criado(await post("/api/stock/input-entries", {
      empresa_id: c.I.empresa, entry_date: DATA, harvest_id: s,
      items: [{ product_id: p.id, quantity: "4", unit_value: "12.5", warehouse_id: c.I.warehouse, cultivation_id: cultura, cost_center_id: centro }] }));
    const [original] = await razaoDaOrigem("input_entries", entrada);
    // PREMISSA: o original tem a cultura (e o centro e a safra).
    expect(original, "premissa: a entrada gravou um movimento com cultura, centro e safra").toMatchObject({
      movement_type: "entry", direction: 1, quantity: "4.0000", cultivation_id: cultura, cost_center_id: centro, harvest_id: s });

    const r = await post(`/api/stock/input-entries/${entrada}/cancel`, {});
    expect(r.statusCode, r.body).toBe(200);
    const estornos = (await razaoDaOrigem("input_entries", entrada)).filter((m) => m.movement_type === "reversal");
    expect(estornos.map((m) => ({ ...m, id: "-", movement_date: "-" }))).toEqual([{
      id: "-", movement_type: "reversal", direction: -1, quantity: "4.0000", movement_date: "-", note: `estorno de ${original!.id}`,
      cost_center_id: centro, harvest_id: s, cultivation_id: cultura,
      equipamento_id: null, ordem_servico_id: null, lote_animais_id: null, area_id: null,
    }]);
  });

  it("L-4b o estorno leva também máquina/equipamento, OS, lote de animais e área/talhão do original", async () => {
    // PREMISSA DO CENÁRIO: nenhuma rota antiga grava essas colunas E cancela (a OS e o manejo não estornam; o
    // abastecimento e a manutenção gravam o equipamento e estornam desde a F10 — `f10-frota` FA-5/FM-3 —, mas não gravam
    // OS, lote nem área; o documento de estoque com destino é do pacote `api-documento`). O movimento com as quatro é gravado por SQL na
    // origem de uma entrada manual, e o cancelamento é o da rota antiga — o `reverseStock` de sempre.
    const p = await produto();
    const centro = c.I.costCenter; const s = await safra(); const a = await area(); const cultura = await culturaNova();
    const os = await osAberta(p.id, "1", { centro, safra: s });
    const entrada = criado(await post("/api/stock/input-entries", {
      empresa_id: c.I.empresa, entry_date: DATA, items: [{ product_id: p.id, quantity: "4", unit_value: "2", warehouse_id: c.I.warehouse }] }));
    const semeado = (await c.admin.query<{ id: string }>(
      `insert into erp.stock_movements (organization_id, empresa_id, warehouse_id, product_id, movement_type, direction, quantity, unit_cost,
         cost_center_id, harvest_id, cultivation_id, equipamento_id, ordem_servico_id, lote_animais_id, area_id, source_type, source_id, movement_date, note)
       values ($1,$2,$3,$4,'entry',1,2,'2',$5,$6,$7,$8,$9,$10,$11,'input_entries',$12,$13,'gravado pelo teste F5a') returning id`,
      [c.h.demo.orgId, c.I.empresa, c.I.warehouse, p.id, centro, s, cultura, c.I.equipment, os, c.I.batch, a, entrada, DATA])).rows[0]!.id;
    const antes = await razaoDaOrigem("input_entries", entrada);
    expect(antes.find((m) => m.id === semeado), "premissa: o original tem as sete dimensões (as quatro novas aceitas pelas FKs compostas)").toMatchObject({
      cost_center_id: centro, harvest_id: s, cultivation_id: cultura, equipamento_id: c.I.equipment, ordem_servico_id: os, lote_animais_id: c.I.batch, area_id: a });

    const r = await post(`/api/stock/input-entries/${entrada}/cancel`, {});
    expect(r.statusCode, r.body).toBe(200);
    const estornos = (await razaoDaOrigem("input_entries", entrada)).filter((m) => m.movement_type === "reversal");
    expect(estornos, "premissa: um estorno por movimento da origem").toHaveLength(2);
    expect(estornos.find((m) => m.note === `estorno de ${semeado}`), "o estorno do movimento com destino leva as sete dimensões").toMatchObject({
      direction: -1, quantity: "2.0000",
      cost_center_id: centro, harvest_id: s, cultivation_id: cultura, equipamento_id: c.I.equipment, ordem_servico_id: os, lote_animais_id: c.I.batch, area_id: a });
    expect(estornos.find((m) => m.note !== `estorno de ${semeado}`), "o estorno do movimento sem destino continua sem destino").toMatchObject({
      direction: -1, quantity: "4.0000",
      cost_center_id: null, harvest_id: null, cultivation_id: null, equipamento_id: null, ordem_servico_id: null, lote_animais_id: null, area_id: null });
  });
});

describe("L-5 — a lista de saldo traz a empresa do local de estoque", () => {
  it("L-5 cada linha de GET /stock/balances tem `empresa_id` = a empresa do local de estoque dela (aditivo: as chaves de antes continuam)", async () => {
    const p = await produto();
    await saldoInicial(p.id, "3");
    const r2 = await post("/api/stock/opening-balances", { empresa_id: c.I.empresa2, warehouse_id: c.I.warehouseEmpresa2, product_id: p.id, quantity: "2", unit_value: "10" });
    criado(r2);
    // PREMISSA: os dois locais de estoque são de empresas diferentes.
    const empresas = new Map((await c.admin.query<{ id: string; empresa_id: string }>(
      "select id, empresa_id from erp.warehouses where id = any($1::uuid[])", [[c.I.warehouse, c.I.warehouseEmpresa2]])).rows.map((w) => [w.id, w.empresa_id]));
    expect([empresas.get(c.I.warehouse), empresas.get(c.I.warehouseEmpresa2)], "premissa: um local de estoque em cada empresa").toEqual([c.I.empresa, c.I.empresa2]);

    const r = await get(`/api/stock/balances?product_id=${p.id}&pageSize=50`);
    expect(r.statusCode, r.body).toBe(200);
    const linhas = (j(r) as { items: Record<string, unknown>[] }).items;
    expect(linhas.map((x) => [x.warehouse_id, x.quantity, x.empresa_id]).sort((a, b) => String(a[1]).localeCompare(String(b[1])))).toEqual([
      [c.I.warehouseEmpresa2, "2.0000", c.I.empresa2], [c.I.warehouse, "3.0000", c.I.empresa]]);
    for (const x of linhas) expect(Object.keys(x), "as chaves de antes continuam").toEqual(expect.arrayContaining(["empresa_name", "warehouse_name", "reservado", "disponivel"]));
  });
});
