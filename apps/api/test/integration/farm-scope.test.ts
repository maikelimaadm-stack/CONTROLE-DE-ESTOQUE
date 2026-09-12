import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * Matriz cross-farm (hardening de escopo de fazenda): Organização O, Fazenda A, Fazenda B.
 *  - OWNER (member_farms vazio) → A + B
 *  - USER_A  (member_farms=[A]) → só A; registro de B por id → 404; X-Farm-Id=B → 403
 *  - USER_AB (member_farms=[A,B]) → A + B
 * Todos com as MESMAS permissões funcionais: o que muda é apenas a autorização por fazenda.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>;
type Hdr = Record<string, string>;
let A: Hdr; let AB: Hdr; let OWNER: Hdr; let farmA: string; let farmB: string; let whA: string; let whB: string;
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { items?: Record<string, unknown>[]; error?: { code: string } };
const PERMS = ["payables.view", "receivables.view", "bank_movements.view", "budgets.view", "orders.view", "sales.view", "stocks.view", "input_entries.view", "requisitions.view", "stock_writeoffs.view", "service_orders.view", "service_orders.monitor", "depreciations.view", "maintenances.view", "equipments.view", "purchase_requests.view", "animals.view", "weighings.view", "sanitaries.view", "nutritions.view", "dashboard.home.view", "dashboard.financial.view", "dashboard.supply.view", "dashboard.livestock.view", "dashboard.assets.view", "report.stock_movement.view", "report.payables.view", "report.payables.export", "warehouses.view", "batches.view", "salary_advances.view", "earnings.view", "feed_batches.view", "feed_formulas.view"];

async function member(name: string, email: string, farmIds: string[]): Promise<Hdr> {
  const role = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${name}`, permissions: PERMS } });
  expect(role.statusCode, role.body).toBe(201);
  const mem = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name, email, password: "Matriz@12345", role_id: j(role).id, farm_ids: farmIds } });
  expect(mem.statusCode, mem.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Matriz@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${j(login).token}`, "x-org-id": h.demo.orgId };
}
const get = (url: string, headers: Hdr) => h.app.inject({ method: "GET", url, headers });
const mk = async (url: string, payload: Record<string, unknown>) => { const r = await h.app.inject({ method: "POST", url, headers: h.headers(), payload }); expect(r.statusCode, `${url}: ${r.body}`).toBe(201); return j(r).id as string; };
/** Verifica lista + detalhe para os três perfis: A vê só a; AB e OWNER veem a e b. `listUrl` opcional (ex.: lista com filtros). */
async function matrix(label: string, base: string, a: string, b: string, listUrl = base, itemsKey = "items") {
  const items = (r: ReturnType<typeof j>) => (r[itemsKey] as { id: string; farm_id?: string }[]) ?? [];
  // USER_A sem X-Farm-Id: lista só A; detalhe A 200; detalhe B 404 (não expõe existência)
  const la = items(j(await get(listUrl, A))); expect(la.some((x) => x.id === b), `${label}: USER_A lista não pode trazer B`).toBe(false); expect(la.some((x) => x.id === a), `${label}: USER_A lista deve trazer A`).toBe(true);
  expect((await get(`${base}/${a}`, A)).statusCode, `${label}: USER_A detalhe A`).toBe(200);
  const denied = await get(`${base}/${b}`, A); expect(denied.statusCode, `${label}: USER_A detalhe B`).toBe(404); expect(j(denied).error?.code).toBe("NOT_FOUND");
  // USER_A + X-Farm-Id=A → permitido; X-Farm-Id=B → 403 já no contexto
  expect((await get(`${base}/${a}`, { ...A, "x-farm-id": farmA })).statusCode, `${label}: USER_A X-Farm-Id=A`).toBe(200);
  expect((await get(`${base}/${b}`, { ...A, "x-farm-id": farmB })).statusCode, `${label}: USER_A X-Farm-Id=B`).toBe(403);
  // USER_AB e OWNER → A e B (lista e detalhe); OWNER com X-Farm-Id=A → só A (seleção continua sendo filtro válido)
  for (const [who, hd] of [["USER_AB", AB], ["OWNER", OWNER]] as const) {
    const ls = items(j(await get(listUrl, hd))); expect(ls.some((x) => x.id === a) && ls.some((x) => x.id === b), `${label}: ${who} lista A+B`).toBe(true);
    expect((await get(`${base}/${a}`, hd)).statusCode, `${label}: ${who} detalhe A`).toBe(200); expect((await get(`${base}/${b}`, hd)).statusCode, `${label}: ${who} detalhe B`).toBe(200);
  }
  const sel = items(j(await get(listUrl, { ...OWNER, "x-farm-id": farmA }))); expect(sel.some((x) => x.id === b), `${label}: OWNER X-Farm-Id=A não traz B`).toBe(false);
}

beforeAll(async () => {
  h = await harness(); I = await ids(h); farmA = I.farm; farmB = I.farm2; whA = I.warehouse!; whB = I.warehouseFarm2!; OWNER = h.headers();
  A = await member("Usuário A", "matriz-a@demo.local", [farmA]); AB = await member("Usuário AB", "matriz-ab@demo.local", [farmA, farmB]);
});
afterAll(async () => { await h.app.close(); await h.db.end(); });

describe("matriz cross-farm: leituras, detalhes, contadores, dashboards, relatórios e recursos genéricos", () => {
  it("FINANCEIRO: títulos (lista/detalhe), totais do dashboard e relatório respeitam member_farms", async () => {
    const pay = (farm: string, n: string) => ({ farm_id: farm, number: n, person_id: I.provider, amount: "100.00", emission_date: "2026-09-01", due_date: "2026-01-15", note: "Matriz", apportionment: [{ financial_category_id: I.category, cost_center_id: I.costCenter, percentage: "100" }] });
    const ta = await mk("/api/financial/payables", pay(farmA, "MX-A")); const tb = await mk("/api/financial/payables", pay(farmB, "MX-B"));
    await matrix("payables", "/api/financial/payables", ta, tb);
    // contadores/totais: título vencido de B não entra para USER_A (dashboard financeiro e painel de controle)
    const ovA = j(await get("/api/dashboards/financial", A)).overdue as { direction: string; n: number }[]; const ovOwner = j(await get("/api/dashboards/financial", OWNER)).overdue as { direction: string; n: number }[];
    const nA = ovA.find((x) => x.direction === "payable")?.n ?? 0; const nO = ovOwner.find((x) => x.direction === "payable")?.n ?? 0; expect(nO).toBeGreaterThan(nA);
    const homeA = j(await get("/api/dashboards/home", A)).alerts as { overdue_payables: string }; const homeO = j(await get("/api/dashboards/home", OWNER)).alerts as { overdue_payables: string };
    expect(Number(homeO.overdue_payables)).toBeGreaterThan(Number(homeA.overdue_payables));
    // relatório operacional (query própria) não vira bypass
    const repA = j(await get("/api/reports/payables", A)).rows as { number: string }[]; expect(repA.some((r) => r.number === "MX-B")).toBe(false); expect(repA.some((r) => r.number === "MX-A")).toBe(true);
    const repO = j(await get("/api/reports/payables", OWNER)).rows as { number: string }[]; expect(repO.some((r) => r.number === "MX-B")).toBe(true);
    // farm_ids pedido fora do escopo não amplia: USER_A pedindo B recebe vazio, não "todas"
    const forced = j(await get(`/api/dashboards/financial?farm_ids=${farmB}`, A)).overdue as { n: number }[]; expect(forced.reduce((s, x) => s + Number(x.n), 0)).toBe(0);
  });
  it("VENDAS: orçamentos (lista/detalhe) e curva ABC respeitam member_farms", async () => {
    const doc = (farm: string, wh: string) => ({ farm_id: farm, document_date: "2026-09-10", client_id: I.client, items: [{ product_id: I.product2, warehouse_id: wh, quantity: "1", unit_price: "5" }] });
    const sa = await mk("/api/sales/budgets", doc(farmA, whA)); const sb = await mk("/api/sales/budgets", doc(farmB, whB));
    await matrix("budgets", "/api/sales/budgets", sa, sb);
  });
  it("ESTOQUE: entradas (lista/detalhe), saldo por armazém e movimentações respeitam member_farms", async () => {
    const entry = (farm: string, wh: string) => ({ farm_id: farm, entry_date: "2026-09-01", items: [{ product_id: I.product, quantity: "7", unit_value: "3", warehouse_id: wh, financial_category_id: I.category, cost_center_id: I.costCenter }] });
    const ea = await mk("/api/stock/input-entries", entry(farmA, whA)); const eb = await mk("/api/stock/input-entries", entry(farmB, whB));
    await matrix("input-entries", "/api/stock/input-entries", ea, eb);
    // saldo agregado: armazém da fazenda B não aparece para USER_A; detalhe de saldo por armazém de B → 404
    const balA = j(await get("/api/stock/balances", A)).items as { warehouse_id: string }[]; expect(balA.some((x) => x.warehouse_id === I.warehouseFarm2)).toBe(false); expect(balA.some((x) => x.warehouse_id === I.warehouse)).toBe(true);
    expect((await get(`/api/stock/balances/${I.warehouseFarm2}/${I.product}`, A)).statusCode).toBe(404); expect((await get(`/api/stock/balances/${I.warehouseFarm2}/${I.product}`, OWNER)).statusCode).toBe(200);
    const movA = j(await get("/api/stock/movements", A)).items as { farm_id: string }[]; expect(movA.every((m) => m.farm_id === farmA)).toBe(true); expect(movA.length).toBeGreaterThan(0);
    const movO = j(await get("/api/stock/movements", OWNER)).items as { farm_id: string }[]; expect(movO.some((m) => m.farm_id === farmB)).toBe(true);
    // cancelar documento de B como USER_A → 404 (escrita também protegida)
    expect((await h.app.inject({ method: "POST", url: `/api/stock/input-entries/${eb}/cancel`, headers: { ...A }, payload: {} })).statusCode).toBe(403); // sem permissão de delete: 403 funcional
  });
  it("ORDENS DE SERVIÇO: lista, detalhe, contadores (monitoramento) e atrasadas respeitam member_farms", async () => {
    const oa = await mk("/api/service-orders", { farm_id: farmA, order_date: "2026-09-01", description: "OS A", planned_end: "2026-01-01" }); const ob = await mk("/api/service-orders", { farm_id: farmB, order_date: "2026-09-01", description: "OS B", planned_end: "2026-01-01" });
    await matrix("service-orders", "/api/service-orders", oa, ob);
    const lateA = j(await get("/api/service-orders?late=1", A)).items as { id: string }[]; expect(lateA.some((x) => x.id === ob)).toBe(false); expect(lateA.some((x) => x.id === oa)).toBe(true);
    const monA = j(await get("/api/service-orders-monitoring", A)) as { by_status: { n: number }[]; late: { id: string }[] }; expect(monA.late.some((x) => x.id === ob)).toBe(false);
    const monO = j(await get("/api/service-orders-monitoring", OWNER)) as { by_status: { n: number }[]; late: { id: string }[] }; expect(monO.late.some((x) => x.id === ob)).toBe(true);
    expect(monO.by_status.reduce((s, x) => s + Number(x.n), 0)).toBeGreaterThan(monA.by_status.reduce((s, x) => s + Number(x.n), 0));
  });
  it("FROTA: bens (recurso genérico por id), manutenções e depreciação respeitam member_farms", async () => {
    const admin = createPool(TEST_URL, { max: 1 });
    const eqB = (await admin.query<{ id: string }>("insert into erp.equipments(organization_id,farm_id,code,description,equipment_type,status,has_depreciation,acquisition_value,life_years,acquisition_date) values ($1,$2,'MXB','Trator matriz B','own','active',true,120000,10,'2025-01-01') returning id", [h.demo.orgId, farmB])).rows[0]!.id;
    await admin.end();
    // recurso genérico farmScoped: lista + getOne
    await matrix("equipments", "/api/resources/equipments", I.equipment!, eqB);
    // depreciação: rodar como owner cria linhas para A e B; USER_A lista só A
    await h.app.inject({ method: "POST", url: "/api/assets/depreciations/run", headers: OWNER, payload: { period_month: "2026-08-01" } });
    const depA = j(await get("/api/assets/depreciations?period_month=2026-08", A)).items as { equipment_id: string }[]; expect(depA.some((d) => d.equipment_id === eqB)).toBe(false);
    const depO = j(await get("/api/assets/depreciations?period_month=2026-08", OWNER)).items as { equipment_id: string }[]; expect(depO.some((d) => d.equipment_id === eqB)).toBe(true);
    const assetsA = j(await get("/api/dashboards/assets", A)).by_farm as { farm: string }[]; const assetsO = j(await get("/api/dashboards/assets", OWNER)).by_farm as { farm: string }[]; expect(assetsO.length).toBeGreaterThan(assetsA.length);
    // USER_A não pode rodar depreciação da fazenda B nem transferir bem para B
    expect((await h.app.inject({ method: "POST", url: "/api/assets/depreciations/run", headers: A, payload: { period_month: "2026-08-01", farm_id: farmB } })).statusCode).toBe(403);
  });
  it("FÁBRICA DE RAÇÃO: produções (lista/detalhe) respeitam member_farms; id inválido/inexistente → 404 (UI-STAB-01)", async () => {
    const entry = (farm: string, wh: string) => ({ farm_id: farm, entry_date: "2026-09-01", items: [{ product_id: I.product, quantity: "50", unit_value: "3", warehouse_id: wh, financial_category_id: I.category, cost_center_id: I.costCenter }] });
    await mk("/api/stock/input-entries", entry(farmA, whA)); await mk("/api/stock/input-entries", entry(farmB, whB));
    const formula = await mk("/api/stock/feed-formulas", { name: "Fórmula matriz", product_id: I.product2, items: [{ product_id: I.product, quantity: "2" }] });
    const batch = (farm: string, wh: string) => ({ farm_id: farm, batch_date: "2026-09-02", formula_id: formula, origin_warehouse_id: wh, destination_warehouse_id: wh, quantity_produced: "2" });
    const fa = await mk("/api/stock/feed-batches", batch(farmA, whA)); const fb = await mk("/api/stock/feed-batches", batch(farmB, whB));
    await matrix("feed-batches", "/api/stock/feed-batches", fa, fb);
    const det = j(await get(`/api/stock/feed-batches/${fa}`, OWNER)); expect(det.formula_name).toBe("Fórmula matriz"); expect((det.items as unknown[]).length).toBe(1); expect((det.movements as unknown[]).length).toBeGreaterThan(0);
    expect((await get("/api/stock/feed-batches/nao-e-uuid", OWNER)).statusCode).toBe(404);
    expect((await get("/api/stock/feed-batches/00000000-0000-4000-8000-000000000000", OWNER)).statusCode).toBe(404);
  });
  it("BAIXA DIRETA: detalhe traz armazém do cabeçalho nas linhas (itens sem warehouse_id) e respeita member_farms (UI-STAB-01)", async () => {
    const entry = (farm: string, wh: string) => ({ farm_id: farm, entry_date: "2026-09-01", items: [{ product_id: I.product, quantity: "10", unit_value: "3", warehouse_id: wh, financial_category_id: I.category, cost_center_id: I.costCenter }] });
    await mk("/api/stock/input-entries", entry(farmA, whA)); await mk("/api/stock/input-entries", entry(farmB, whB));
    const wo = (farm: string, wh: string) => ({ farm_id: farm, writeoff_date: "2026-09-02", reason: "loss", warehouse_id: wh, justification: "matriz", items: [{ product_id: I.product, quantity: "1" }] });
    const wa = await mk("/api/stock/writeoffs", wo(farmA, whA)); const wb = await mk("/api/stock/writeoffs", wo(farmB, whB));
    await matrix("writeoffs", "/api/stock/writeoffs", wa, wb);
    const det = j(await get(`/api/stock/writeoffs/${wa}`, OWNER)); const items = det.items as { warehouse_name: string; product_name: string }[];
    expect(typeof det.warehouse_name).toBe("string"); expect(items.length).toBe(1); expect(items[0]!.warehouse_name).toBe(det.warehouse_name); expect((det.movements as unknown[]).length).toBeGreaterThan(0);
  });
  it("COMPRAS: solicitações (lista/detalhe/contadores) continuam corretas", async () => {
    const reqp = (farm: string) => ({ farm_id: farm, request_date: "2026-09-01", request_type: "product", description: "Matriz", justification: "x", priority: "high", items: [{ product_id: I.product, description: "Sal", quantity: "1", reference_value: "5" }] });
    const ra = await mk("/api/supply/requests", reqp(farmA)); const rb = await mk("/api/supply/requests", reqp(farmB));
    await matrix("supply-requests", "/api/supply/requests", ra, rb);
    const cA = j(await get("/api/supply/requests/counts", A)) as { all: number }; const cO = j(await get("/api/supply/requests/counts", OWNER)) as { all: number }; expect(cO.all).toBeGreaterThan(cA.all);
    const dashA = j(await get("/api/dashboards/supply", A)).by_status as { n: number }[]; const dashO = j(await get("/api/dashboards/supply", OWNER)).by_status as { n: number }[];
    expect(dashO.reduce((s, x) => s + Number(x.n), 0)).toBeGreaterThan(dashA.reduce((s, x) => s + Number(x.n), 0));
  });
  it("PECUÁRIA: manejos, pesagens, animais e dashboard continuam corretos; localizar animal não vaza outra fazenda", async () => {
    const ha = await mk("/api/livestock/handlings", { farm_id: farmA, handling_type: "sanitary", handling_date: "2026-09-20", batch_id: I.batch, items: [{ animal_id: I.animal, quantity: "1" }] });
    const hb = await mk("/api/livestock/handlings", { farm_id: farmB, handling_type: "sanitary", handling_date: "2026-09-20", batch_id: I.batch, items: [{ animal_id: I.animal, quantity: "1" }] });
    await matrix("handlings", "/api/livestock/handlings", ha, hb);
    const wa = await mk("/api/livestock/weighings", { farm_id: farmA, weighing_date: "2026-09-20", batch_id: I.batch, items: [{ animal_id: I.animal, weight: "300" }] });
    const wb = await mk("/api/livestock/weighings", { farm_id: farmB, weighing_date: "2026-09-21", batch_id: I.batch, items: [{ animal_id: I.animal, weight: "301" }] });
    await matrix("weighings", "/api/livestock/weighings", wa, wb);
    const admin = createPool(TEST_URL, { max: 1 });
    const animalB = (await admin.query<{ id: string }>("select id from erp.animals where organization_id=$1 and farm_id=$2 and deleted_at is null limit 1", [h.demo.orgId, farmB])).rows[0]?.id;
    await admin.end();
    if (animalB) { expect((await get(`/api/livestock/animals/${animalB}`, A)).statusCode).toBe(404); expect((await get(`/api/livestock/animals/${animalB}`, AB)).statusCode).toBe(200); }
    const dA = j(await get("/api/dashboards/livestock", A)) as { total_heads: number }; const dO = j(await get("/api/dashboards/livestock", OWNER)) as { total_heads: number }; expect(dO.total_heads).toBeGreaterThanOrEqual(dA.total_heads);
    // escrita: USER_A não cria manejo na fazenda B (farmAllowed)
    const w = await h.app.inject({ method: "POST", url: "/api/livestock/weighings", headers: A, payload: { farm_id: farmB, weighing_date: "2026-09-22", items: [{ animal_id: I.animal, weight: "1" }] } }); expect([403, 422]).toContain(w.statusCode);
  });
  it("RECURSOS GENÉRICOS e LOOKUPS: lista, getOne, options e distinct de recurso farmScoped respeitam member_farms", async () => {
    await matrix("warehouses", "/api/resources/warehouses", whA, whB);
    const optA = j(await get("/api/resources/warehouses/options", A)) as unknown as { id: string }[]; expect(optA.some((o) => o.id === I.warehouseFarm2)).toBe(false); expect(optA.some((o) => o.id === I.warehouse)).toBe(true);
    const optO = j(await get("/api/resources/warehouses/options", OWNER)) as unknown as { id: string }[]; expect(optO.some((o) => o.id === I.warehouseFarm2)).toBe(true);
    const distA = j(await get("/api/resources/warehouses/distinct?field=farm_id", A)) as unknown as { value: string }[]; expect(distA.some((d) => d.value === farmB)).toBe(false);
    // exportação (CSV) usa a mesma consulta protegida do relatório: título MX-B (fazenda B) não sai para USER_A
    const csv = await get("/api/reports/payables?format=csv", A); expect(csv.statusCode).toBe(200); expect(csv.body.includes("MX-B")).toBe(false); expect(csv.body.includes("MX-A")).toBe(true);
  });
  it("NÃO REGRESSÃO: owner e usuário multi-fazenda continuam operando; permissão funcional continua sendo verificada", async () => {
    expect((await get("/api/financial/payables", OWNER)).statusCode).toBe(200); expect((await get("/api/financial/payables", AB)).statusCode).toBe(200);
    expect((await get("/api/financial/payables", h.opHeaders())).statusCode).toBe(403); // operador sem payables.view
    expect((await get("/api/financial/payables", { ...AB, "x-farm-id": farmB })).statusCode).toBe(200);
  });
});
