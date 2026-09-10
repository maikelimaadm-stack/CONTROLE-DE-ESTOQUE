import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { harness, ids, type Harness } from "./setup.js";

let h: Harness; let I: Awaited<ReturnType<typeof ids>>;
beforeAll(async () => { h = await harness(); I = await ids(h); });
afterAll(async () => { await h.app.close(); await h.db.end(); });
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { items?: Record<string, unknown>[]; error?: { code: string } };
const st = (r: { statusCode: number; body: string }, code: number) => { if (r.statusCode !== code) process.stdout.write(`\n[DEBUG ${r.statusCode}] ${r.body.slice(0, 400)}\n`); return r.statusCode; };

describe("saúde e autenticação", () => {
  it("GET /health responde ok com banco", async () => { const r = await h.app.inject({ method: "GET", url: "/health" }); expect(r.statusCode).toBe(200); expect(j(r).db).toBe("ok"); });
  it("rejeita sem token e com senha errada", async () => {
    expect((await h.app.inject({ method: "GET", url: "/api/resources/products", headers: { "x-org-id": h.demo.orgId } })).statusCode).toBe(401);
    expect((await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: h.demo.adminEmail, password: "errada123" } })).statusCode).toBe(401);
  });
  it("contexto retorna fazendas e permissões", async () => { const r = await h.app.inject({ method: "GET", url: "/api/auth/context", headers: h.headers() }); expect(r.statusCode).toBe(200); const c = j(r) as { farms: unknown[]; permissions: string[]; isOwner: boolean }; expect(c.farms.length).toBe(2); expect(c.isOwner).toBe(true); expect(c.permissions.length).toBeGreaterThan(600); });
});

describe("cadastros genéricos (recursos declarativos)", () => {
  it("lista produtos com paginação, busca e filtros", async () => {
    const r = await h.app.inject({ method: "GET", url: "/api/resources/products?search=Sal&pageSize=5", headers: h.headers() });
    expect(r.statusCode).toBe(200); const b = j(r); expect(b.total).toBe(1); expect(b.items![0]!.description).toContain("Sal Mineral"); expect(b.items![0]!.group_id_label).toBeTruthy();
  });
  it("cria, edita, valida e exclui (soft) um centro de custo", async () => {
    const c = await h.app.inject({ method: "POST", url: "/api/resources/cost_centers", headers: h.headers(), payload: { code: "9.99", name: "Teste CC", kind: "analytic" } });
    expect(c.statusCode).toBe(201); const id = j(c).id as string;
    const bad = await h.app.inject({ method: "POST", url: "/api/resources/cost_centers", headers: h.headers(), payload: { code: "9.98" } });
    expect(bad.statusCode).toBe(422); expect(j(bad).error!.code).toBe("VALIDATION_ERROR");
    const dup = await h.app.inject({ method: "POST", url: "/api/resources/cost_centers", headers: h.headers(), payload: { code: "9.99", name: "Dup" } });
    expect(dup.statusCode).toBe(409);
    const u = await h.app.inject({ method: "PUT", url: `/api/resources/cost_centers/${id}`, headers: h.headers(), payload: { name: "Teste CC 2" } });
    expect(j(u).name).toBe("Teste CC 2");
    const d = await h.app.inject({ method: "DELETE", url: `/api/resources/cost_centers/${id}`, headers: h.headers() }); expect(d.statusCode).toBe(200);
    expect((await h.app.inject({ method: "GET", url: `/api/resources/cost_centers/${id}`, headers: h.headers() })).statusCode).toBe(404);
  });
  it("produto que controla estoque exige categoria financeira (CHECK do banco)", async () => {
    const r = await h.app.inject({ method: "POST", url: "/api/resources/products", headers: h.headers(), payload: { description: "X", measurement_id: (j(await h.app.inject({ method: "GET", url: "/api/resources/measurement_units/options", headers: h.headers() })) as unknown as { id: string }[])[0]!.id, group_id: (j(await h.app.inject({ method: "GET", url: "/api/resources/product_groups/options", headers: h.headers() })) as unknown as { id: string }[])[0]!.id, category_id: (j(await h.app.inject({ method: "GET", url: "/api/resources/product_categories/options", headers: h.headers() })) as unknown as { id: string }[])[0]!.id, kind_id: (j(await h.app.inject({ method: "GET", url: "/api/resources/product_kinds/options", headers: h.headers() })) as unknown as { id: string }[])[0]!.id, control_stock: true } });
    expect(r.statusCode).toBe(422);
  });
});

describe("autorização (perfil sem permissão) e isolamento multiempresa", () => {
  it("operador vê produtos mas não pode criar contas a pagar", async () => {
    expect((await h.app.inject({ method: "GET", url: "/api/resources/products", headers: h.opHeaders() })).statusCode).toBe(200);
    const r = await h.app.inject({ method: "GET", url: "/api/financial/payables", headers: h.opHeaders() });
    expect(st(r, 403)).toBe(403); expect(j(r).error!.code).toBe("PERMISSION_DENIED");
    expect((await h.app.inject({ method: "DELETE", url: `/api/resources/products/${I.product}`, headers: h.opHeaders() })).statusCode).toBe(403);
  });
  it("organização B não enxerga dados da organização A (RLS + membership)", async () => {
    const { createPool, seedDemo } = await import("@agro/db");
    const adm = createPool((await import("./setup.js")).TEST_URL, { max: 1 });
    const b = await seedDemo(adm, { orgName: "[TEST] Org B", adminEmail: "adminb@demo.local", adminPassword: "Demo@12345", slug: "orgb" }, () => {}); await adm.end();
    const tok = (j(await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "adminb@demo.local", password: "Demo@12345" } })) as { token: string }).token;
    const hb = { authorization: `Bearer ${tok}`, "x-org-id": b.orgId };
    const list = await h.app.inject({ method: "GET", url: "/api/resources/products", headers: hb });
    expect(j(list).items!.every((p) => (p as { organization_id: string }).organization_id === b.orgId)).toBe(true);
    expect((await h.app.inject({ method: "GET", url: `/api/resources/products/${I.product}`, headers: hb })).statusCode).toBe(404);
    // usuário B tentando usar org A no header
    const cross = await h.app.inject({ method: "GET", url: "/api/resources/products", headers: { authorization: `Bearer ${tok}`, "x-org-id": h.demo.orgId } });
    expect(cross.statusCode).toBe(403);
    // admin A não pode ler recurso de B pelo id
    const bProd = j(list).items![0] as { id: string };
    expect((await h.app.inject({ method: "GET", url: `/api/resources/products/${bProd.id}`, headers: h.headers() })).statusCode).toBe(404);
  });
});

describe("estoque: ledger, documentos e concorrência", () => {
  it("estoque inicial → requisição → saldo e custo médio; saldo negativo é bloqueado", async () => {
    const ob = await h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: h.headers(), payload: { farm_id: I.farm, warehouse_id: I.warehouse, product_id: I.product, quantity: "100", unit_value: "10" } });
    expect(st(ob, 201)).toBe(201);
    const entry = await h.app.inject({ method: "POST", url: "/api/stock/input-entries", headers: h.headers(), payload: { farm_id: I.farm, entry_date: "2026-09-01", items: [{ product_id: I.product, quantity: "100", unit_value: "20", warehouse_id: I.warehouse, financial_category_id: I.category, cost_center_id: I.costCenter }] } });
    expect(entry.statusCode).toBe(201); expect(j(entry).total_amount).toBe("2000.00");
    const bal = j(await h.app.inject({ method: "GET", url: `/api/stock/balances/${I.warehouse}/${I.product}`, headers: h.headers() }));
    expect(bal.quantity).toBe("200.0000"); expect(bal.averageCost).toBe("15.000000");
    const req = await h.app.inject({ method: "POST", url: "/api/stock/requisitions", headers: h.headers(), payload: { farm_id: I.farm, requisition_date: "2026-09-02", requester_person_id: I.employee, items: [{ warehouse_id: I.warehouse, product_id: I.product, quantity: "50", cost_center_id: I.costCenter }] } });
    expect(req.statusCode).toBe(201); expect(j(req).total_amount).toBe("750.00");
    const over = await h.app.inject({ method: "POST", url: "/api/stock/requisitions", headers: h.headers(), payload: { farm_id: I.farm, requisition_date: "2026-09-02", items: [{ warehouse_id: I.warehouse, product_id: I.product, quantity: "500" }] } });
    expect(over.statusCode).toBe(409); expect(j(over).error!.code).toBe("INSUFFICIENT_STOCK");
    const balances = j(await h.app.inject({ method: "GET", url: `/api/stock/balances?product_id=${I.product}`, headers: h.headers() }));
    expect(balances.items![0]!.quantity).toBe("150.0000");
  });
  it("transação atômica: falha no 2º item não deixa o 1º lançado", async () => {
    const before = j(await h.app.inject({ method: "GET", url: `/api/stock/balances/${I.warehouse}/${I.product}`, headers: h.headers() })).quantity;
    const r = await h.app.inject({ method: "POST", url: "/api/stock/requisitions", headers: h.headers(), payload: { farm_id: I.farm, requisition_date: "2026-09-02", items: [{ warehouse_id: I.warehouse, product_id: I.product, quantity: "10" }, { warehouse_id: I.warehouse, product_id: I.product2, quantity: "999999" }] } });
    expect(r.statusCode).toBe(409);
    const after = j(await h.app.inject({ method: "GET", url: `/api/stock/balances/${I.warehouse}/${I.product}`, headers: h.headers() })).quantity;
    expect(after).toBe(before);
    const docs = j(await h.app.inject({ method: "GET", url: "/api/stock/requisitions?search=", headers: h.headers() }));
    expect(docs.total).toBe(1);
  });
  it("idempotência: mesma chave não duplica o documento; corpo diferente conflita", async () => {
    const payload = { farm_id: I.farm, requisition_date: "2026-09-03", items: [{ warehouse_id: I.warehouse, product_id: I.product, quantity: "5" }] };
    const a = await h.app.inject({ method: "POST", url: "/api/stock/requisitions", headers: h.headers({ "idempotency-key": "req-abc" }), payload });
    const b = await h.app.inject({ method: "POST", url: "/api/stock/requisitions", headers: h.headers({ "idempotency-key": "req-abc" }), payload });
    expect(a.statusCode).toBe(201); expect(b.statusCode).toBe(201); expect(j(a).id).toBe(j(b).id);
    const c = await h.app.inject({ method: "POST", url: "/api/stock/requisitions", headers: h.headers({ "idempotency-key": "req-abc" }), payload: { ...payload, requisition_date: "2026-09-04" } });
    expect(c.statusCode).toBe(409);
    const bal = j(await h.app.inject({ method: "GET", url: `/api/stock/balances/${I.warehouse}/${I.product}`, headers: h.headers() }));
    expect(bal.quantity).toBe("145.0000");
  });
  it("concorrência: 10 requisições simultâneas de 20 un. com saldo 145 → exatamente 7 sucessos", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => h.app.inject({ method: "POST", url: "/api/stock/requisitions", headers: h.headers(), payload: { farm_id: I.farm, requisition_date: "2026-09-05", items: [{ warehouse_id: I.warehouse, product_id: I.product, quantity: "20" }] } })));
    const ok = results.filter((r) => r.statusCode === 201).length; const fail = results.filter((r) => r.statusCode === 409).length;
    expect(ok).toBe(7); expect(fail).toBe(3);
    const bal = j(await h.app.inject({ method: "GET", url: `/api/stock/balances/${I.warehouse}/${I.product}`, headers: h.headers() }));
    expect(bal.quantity).toBe("5.0000");
  });
  it("cancelamento estorna o ledger", async () => {
    const dev = await h.app.inject({ method: "POST", url: "/api/stock/devolutions", headers: h.headers(), payload: { farm_id: I.farm, devolution_date: "2026-09-06", items: [{ warehouse_id: I.warehouse, product_id: I.product, quantity: "95" }] } });
    expect(dev.statusCode).toBe(201);
    expect(j(await h.app.inject({ method: "GET", url: `/api/stock/balances/${I.warehouse}/${I.product}`, headers: h.headers() })).quantity).toBe("100.0000");
    const c = await h.app.inject({ method: "POST", url: `/api/stock/devolutions/${j(dev).id}/cancel`, headers: h.headers() }); expect(c.statusCode).toBe(200);
    expect(j(await h.app.inject({ method: "GET", url: `/api/stock/balances/${I.warehouse}/${I.product}`, headers: h.headers() })).quantity).toBe("5.0000");
    expect((await h.app.inject({ method: "POST", url: `/api/stock/devolutions/${j(dev).id}/cancel`, headers: h.headers() })).statusCode).toBe(409);
  });
  it("transferência entre fazendas com financeiro gera par de títulos", async () => {
    await h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: h.headers(), payload: { farm_id: I.farm, warehouse_id: I.warehouse, product_id: I.product2, quantity: "1000", unit_value: "2" } });
    const t = await h.app.inject({ method: "POST", url: "/api/stock/transfers", headers: h.headers(), payload: { kind: "farm", transfer_date: "2026-09-07", origin_farm_id: I.farm, origin_warehouse_id: I.warehouse, destination_farm_id: I.farm2, destination_warehouse_id: I.warehouseFarm2, items: [{ product_id: I.product2, quantity: "100" }], generate_financial: true, plan: { installments: 2, first_due_date: "2026-10-01", mode: "interval", interval_days: 30 }, income_apportionment: [{ financial_category_id: I.incomeCategory, cost_center_id: I.costCenter, percentage: "100" }], expense_apportionment: [{ financial_category_id: I.category, cost_center_id: I.costCenter, percentage: "100" }] } });
    expect(st(t, 201)).toBe(201); expect(j(t).total_value).toBe("200.00");
    const detail = j(await h.app.inject({ method: "GET", url: `/api/stock/transfers/${j(t).id}`, headers: h.headers() })) as { titles: { direction: string; amount: string }[] };
    expect(detail.titles.length).toBe(4); expect(detail.titles.filter((x) => x.direction === "payable").length).toBe(2);
    expect(j(await h.app.inject({ method: "GET", url: `/api/stock/balances/${I.warehouseFarm2}/${I.product2}`, headers: h.headers() })).quantity).toBe("100.0000");
    const same = await h.app.inject({ method: "POST", url: "/api/stock/transfers", headers: h.headers(), payload: { kind: "warehouse", transfer_date: "2026-09-07", origin_farm_id: I.farm, origin_warehouse_id: I.warehouse, destination_warehouse_id: I.warehouse, items: [{ product_id: I.product2, quantity: "1" }] } });
    expect(j(same).error!.code).toBe("SAME_WAREHOUSE_TRANSFER");
  });
  it("documento fiscal gera estoque, títulos parcelados e bloqueia duplicidade", async () => {
    const inv = await h.app.inject({ method: "POST", url: "/api/stock/invoices", headers: h.headers(), payload: { farm_id: I.farm, number: "12345", series: "1", provider_id: I.provider, emission_date: "2026-09-08", freight: "50", items: [{ product_id: I.product2, quantity: "100", unit_value: "3", warehouse_id: I.warehouse, financial_category_id: I.category, cost_center_id: I.costCenter }], apportionment_type: "by_product", plan: { installments: 3, first_due_date: "2026-10-08", mode: "interval", interval_days: 30 } } });
    expect(st(inv, 201)).toBe(201); expect(j(inv).total).toBe("350.00"); expect((j(inv).title_ids as string[]).length).toBe(3);
    const dup = await h.app.inject({ method: "POST", url: "/api/stock/invoices", headers: h.headers(), payload: { farm_id: I.farm, number: "12345", series: "1", provider_id: I.provider, emission_date: "2026-09-08", items: [{ product_id: I.product2, quantity: "1", unit_value: "3", warehouse_id: I.warehouse, financial_category_id: I.category, cost_center_id: I.costCenter }] } });
    expect(j(dup).error!.code).toBe("DUPLICATE_DOCUMENT");
    const bal = j(await h.app.inject({ method: "GET", url: `/api/stock/balances/${I.warehouse}/${I.product2}`, headers: h.headers() }));
    expect(bal.quantity).toBe("1000.0000"); // 1000 - 100 (transf) + 100 (NF)
    const titles = j(await h.app.inject({ method: "GET", url: "/api/financial/payables?number=12345", headers: h.headers() }));
    expect(titles.total).toBe(3); expect(titles.totals).toMatchObject({ amount: "350.00" });
  });
});

describe("financeiro: títulos, baixas, movimentos, congelamento", () => {
  let titleId: string; let settlementId: string;
  it("cria título com rateio e parcelamento, baixa parcial e total, e rejeita excesso", async () => {
    const r = await h.app.inject({ method: "POST", url: "/api/financial/payables", headers: h.headers(), payload: { farm_id: I.farm, number: "NF-777", person_id: I.provider, amount: "1000.00", emission_date: "2026-09-01", due_date: "2026-09-30", note: "Teste", apportionment: [{ financial_category_id: I.category, cost_center_id: I.costCenter, percentage: "60" }, { financial_category_id: I.category, cost_center_id: I.costCenter, percentage: "40" }] } });
    expect(r.statusCode).toBe(201); titleId = j(r).id as string;
    const t = j(await h.app.inject({ method: "GET", url: `/api/financial/payables/${titleId}`, headers: h.headers() })) as { apportionments: { amount: string }[]; status_label: string };
    expect(t.apportionments.map((a) => a.amount)).toEqual(["600.00", "400.00"]); expect(t.status_label).toBe("Á vencer");
    const s1 = await h.app.inject({ method: "POST", url: `/api/financial/payables/${titleId}/settle`, headers: h.headers(), payload: { settlement_date: "2026-09-10", bank_account_id: I.bankAccount, amount: "400", discount: "0", interest: "10" } });
    expect(s1.statusCode).toBe(201); expect(j(s1).status).toBe("partially_paid"); expect(j(s1).net_amount).toBe("410.00"); settlementId = j(s1).settlement_id as string;
    const over = await h.app.inject({ method: "POST", url: `/api/financial/payables/${titleId}/settle`, headers: h.headers(), payload: { settlement_date: "2026-09-11", bank_account_id: I.bankAccount, amount: "700" } });
    expect(j(over).error!.code).toBe("PAYMENT_EXCEEDS_BALANCE");
    const s2 = await h.app.inject({ method: "POST", url: `/api/financial/payables/${titleId}/settle`, headers: h.headers(), payload: { settlement_date: "2026-09-11", bank_account_id: I.bankAccount, amount: "550", discount: "50" } });
    expect(j(s2).status).toBe("paid"); expect(j(s2).balance).toBe("0.00");
    const banks = j(await h.app.inject({ method: "GET", url: "/api/financial/bank-accounts/balances", headers: h.headers() })) as { items: { code: string; balance: string }[] };
    expect(banks.items.find((b) => b.code === "BB")!.balance).toBe("149090.00"); // 150000 - 410 - (550-50)
  });
  it("cancelar baixa reabre o título e cancela o movimento bancário", async () => {
    const c = await h.app.inject({ method: "POST", url: `/api/financial/payables/${titleId}/settlements/${settlementId}/cancel`, headers: h.headers(), payload: { reason: "lançamento errado" } });
    expect(c.statusCode).toBe(200); expect(j(c).status).toBe("partially_paid"); expect(j(c).balance).toBe("400.00");
    const banks = j(await h.app.inject({ method: "GET", url: "/api/financial/bank-accounts/balances", headers: h.headers() })) as { items: { code: string; balance: string }[] };
    expect(banks.items.find((b) => b.code === "BB")!.balance).toBe("149500.00");
  });
  it("baixa em lote com movimento único e baixa cruzada", async () => {
    const a = j(await h.app.inject({ method: "POST", url: "/api/financial/payables", headers: h.headers(), payload: { farm_id: I.farm, number: "L1", person_id: I.provider, amount: "100", emission_date: "2026-09-01", due_date: "2026-09-30", note: "lote", apportionment: [{ financial_category_id: I.category, cost_center_id: I.costCenter, percentage: "100" }] } })).id;
    const b = j(await h.app.inject({ method: "POST", url: "/api/financial/payables", headers: h.headers(), payload: { farm_id: I.farm, number: "L2", person_id: I.provider, amount: "200", emission_date: "2026-09-01", due_date: "2026-09-30", note: "lote", apportionment: [{ financial_category_id: I.category, cost_center_id: I.costCenter, percentage: "100" }] } })).id;
    const batch = await h.app.inject({ method: "POST", url: "/api/financial/payables/settle-batch", headers: h.headers(), payload: { ids: [a, b], settlement_date: "2026-09-12", bank_account_id: I.cashAccount, movement_mode: "single" } });
    expect(batch.statusCode).toBe(201); expect(j(batch).settled).toBe(2); expect(j(batch).total).toBe("300.00");
    const recv = j(await h.app.inject({ method: "POST", url: "/api/financial/receivables", headers: h.headers(), payload: { farm_id: I.farm, number: "R1", person_id: I.provider, amount: "150", emission_date: "2026-09-01", due_date: "2026-09-30", note: "cruzada", apportionment: [{ financial_category_id: I.incomeCategory, cost_center_id: I.costCenter, percentage: "100" }] } })).id;
    const cross = await h.app.inject({ method: "POST", url: `/api/financial/payables/${titleId}/settle`, headers: h.headers(), payload: { settlement_date: "2026-09-13", settlement_kind: "cross_settlement", cross_title_id: recv, amount: "150" } });
    expect(st(cross, 201)).toBe(201);
    const rt = j(await h.app.inject({ method: "GET", url: `/api/financial/receivables/${recv}`, headers: h.headers() }));
    expect(rt.status).toBe("paid");
  });
  it("movimento bancário com transferência interna cria o par; congelamento bloqueia lançamentos", async () => {
    const m = await h.app.inject({ method: "POST", url: "/api/financial/bank-movements", headers: h.headers(), payload: { bank_account_id: I.bankAccount, movement_date: "2026-09-14", type: "out", category_type: "internal_transfer", destination_account_id: I.cashAccount, amount: "1000" } });
    expect(st(m, 201)).toBe(201);
    const list = j(await h.app.inject({ method: "GET", url: "/api/financial/bank-movements?category_type=internal_transfer", headers: h.headers() }));
    expect(list.total).toBe(2);
    const fr = await h.app.inject({ method: "POST", url: "/api/resources/financial_freezes", headers: h.headers(), payload: { month: 8, year: 2026, is_frozen: true } });
    expect(fr.statusCode).toBe(201);
    const blocked = await h.app.inject({ method: "POST", url: "/api/financial/bank-movements", headers: h.headers(), payload: { bank_account_id: I.bankAccount, movement_date: "2026-08-15", type: "out", amount: "10", apportionment: [{ financial_category_id: I.category, cost_center_id: I.costCenter, percentage: "100" }] } });
    expect(blocked.statusCode).toBe(409); expect(j(blocked).error!.code).toBe("PERIOD_FROZEN");
  });
  it("fluxo bancário e relatórios financeiros retornam dados reais", async () => {
    const cf = j(await h.app.inject({ method: "GET", url: `/api/financial/cash-flow?account_ids=${I.bankAccount}&period=monthly&start_date=2026-09-01&end_date=2026-09-30`, headers: h.headers() })) as { opening_balance: string; periods: unknown[]; closing_balance: string };
    expect(cf.opening_balance).toBe("150000.00"); expect(cf.periods.length).toBe(1);
    const rep = j(await h.app.inject({ method: "GET", url: "/api/reports/paid?start_date=2026-09-01&end_date=2026-09-30", headers: h.headers() })) as { rows: unknown[]; totals: Record<string, string> };
    expect(rep.rows.length).toBeGreaterThanOrEqual(2);
    const csv = await h.app.inject({ method: "GET", url: "/api/reports/bank_statement?bank_account_id=" + I.bankAccount + "&format=csv", headers: h.headers() });
    expect(csv.headers["content-type"]).toContain("text/csv"); expect(csv.body).toContain("Saldo");
    const xlsx = await h.app.inject({ method: "GET", url: "/api/reports/stocks_consolidated?format=xlsx", headers: h.headers() });
    expect(xlsx.headers["content-type"]).toContain("spreadsheetml");
    const all = await h.app.inject({ method: "GET", url: "/api/reports", headers: h.headers() });
    expect((j(all) as unknown as unknown[]).length).toBeGreaterThan(80);
  });
});

describe("suprimentos: workflow completo", () => {
  let reqId: string;
  it("solicitação → ciência → cotação → seleção → aprovação → compra → recebimento (exige NF) → finalização", async () => {
    const r = await h.app.inject({ method: "POST", url: "/api/supply/requests", headers: h.headers(), payload: { farm_id: I.farm, request_date: "2026-09-01", request_type: "product", description: "Compra de sal", justification: "Reposição", priority: "high", items: [{ product_id: I.product, description: "Sal mineral", quantity: "10", reference_value: "5" }] } });
    expect(r.statusCode).toBe(201); reqId = j(r).id as string;
    let d = j(await h.app.inject({ method: "GET", url: `/api/supply/requests/${reqId}`, headers: h.headers() }));
    expect(d.status).toBe("request"); // sem encarregado/chefe: permanece em Solicitação
    const act = (a: string, body: Record<string, unknown> = {}) => h.app.inject({ method: "POST", url: `/api/supply/requests/${reqId}/actions/${a}`, headers: h.headers(), payload: { justification: "ok", ...body } });
    expect((await act("approve")).statusCode).toBe(409); // transição inválida
    expect((await act("start_quotation")).statusCode).toBe(200);
    const q1 = await h.app.inject({ method: "POST", url: `/api/supply/requests/${reqId}/quotations`, headers: h.headers(), payload: { provider_id: I.provider, items: [{ request_item_id: (d.items as { id: string }[])[0]!.id, unit_price: "4.50" }] } });
    expect(q1.statusCode).toBe(201); expect(j(q1).total).toBe("45.00");
    const noSel = await act("send_to_approval"); expect(noSel.statusCode).toBe(422);
    await h.app.inject({ method: "POST", url: `/api/supply/requests/${reqId}/quotations/${j(q1).id}/select`, headers: h.headers() });
    expect((await act("send_to_approval")).statusCode).toBe(200);
    expect((await act("approve")).statusCode).toBe(200);
    d = j(await h.app.inject({ method: "GET", url: `/api/supply/requests/${reqId}`, headers: h.headers() }));
    expect(d.status).toBe("awaiting_purchase"); expect(d.approved_total).toBe("45.00");
    expect((await act("mark_purchased")).statusCode).toBe(200);
    const noNf = await act("mark_received"); expect(noNf.statusCode).toBe(422); // exige documento fiscal lançado
    const inv = await h.app.inject({ method: "POST", url: "/api/stock/invoices", headers: h.headers(), payload: { farm_id: I.farm, number: "555", provider_id: I.provider, emission_date: "2026-09-09", purchase_request_id: reqId, items: [{ product_id: I.product, quantity: "10", unit_value: "4.5", warehouse_id: I.warehouse, financial_category_id: I.category, cost_center_id: I.costCenter }], apportionment_type: "by_product" } });
    expect(inv.statusCode).toBe(201);
    expect((await act("mark_received")).statusCode).toBe(200);
    expect((await act("finish")).statusCode).toBe(200);
    d = j(await h.app.inject({ method: "GET", url: `/api/supply/requests/${reqId}`, headers: h.headers() }));
    expect(d.status).toBe("finished"); expect((d.events as unknown[]).length).toBeGreaterThanOrEqual(8);
    const order = j(await h.app.inject({ method: "GET", url: `/api/supply/requests/${reqId}/order`, headers: h.headers() }));
    expect(order.text).toContain("Pedido de compra");
  });
  it("controle otimista (version) e operador sem permissão de aprovar", async () => {
    const r2 = j(await h.app.inject({ method: "POST", url: "/api/supply/requests", headers: h.headers(), payload: { farm_id: I.farm, request_date: "2026-09-02", request_type: "service", description: "Serviço", justification: "x", items: [{ description: "Conserto", quantity: "1", amount: "300" }] } })).id;
    const stale = await h.app.inject({ method: "POST", url: `/api/supply/requests/${r2}/actions/send_to_approval`, headers: h.headers(), payload: { justification: "x", version: 999 } });
    expect(j(stale).error!.code).toBe("CONCURRENCY_CONFLICT");
    expect((await h.app.inject({ method: "POST", url: `/api/supply/requests/${r2}/actions/send_to_approval`, headers: h.headers(), payload: { justification: "x" } })).statusCode).toBe(200);
    const op = await h.app.inject({ method: "POST", url: `/api/supply/requests/${r2}/actions/approve`, headers: h.opHeaders(), payload: { justification: "x" } });
    expect(op.statusCode).toBe(403);
  });
});

describe("vendas, frota, RH e pecuária", () => {
  it("orçamento → pedido → venda confirmada gera baixa de estoque e conta a receber", async () => {
    const b = await h.app.inject({ method: "POST", url: "/api/sales/budgets", headers: h.headers(), payload: { farm_id: I.farm, document_date: "2026-09-10", client_id: I.client, items: [{ product_id: I.product2, warehouse_id: I.warehouse, quantity: "10", unit_price: "5", discount_percent: "10" }], freight: "20" } });
    expect(b.statusCode).toBe(201); expect(j(b).total).toBe("65.00");
    const o = await h.app.inject({ method: "POST", url: `/api/sales/budgets/${j(b).id}/convert`, headers: h.headers() }); expect(st(o, 201)).toBe(201); expect(j(o).kind).toBe("order");
    expect((await h.app.inject({ method: "POST", url: `/api/sales/budgets/${j(b).id}/convert`, headers: h.headers() })).statusCode).toBe(409);
    const s = await h.app.inject({ method: "POST", url: `/api/sales/orders/${j(o).id}/convert`, headers: h.headers() }); expect(j(s).kind).toBe("sale");
    const before = j(await h.app.inject({ method: "GET", url: `/api/stock/balances/${I.warehouse}/${I.product2}`, headers: h.headers() })).quantity;
    const c = await h.app.inject({ method: "POST", url: `/api/sales/sales/${j(s).id}/confirm`, headers: h.headers() }); expect(c.statusCode).toBe(200); expect((j(c).title_ids as string[]).length).toBe(1);
    const after = j(await h.app.inject({ method: "GET", url: `/api/stock/balances/${I.warehouse}/${I.product2}`, headers: h.headers() })).quantity;
    expect(Number(before) - Number(after)).toBe(10);
    expect((await h.app.inject({ method: "POST", url: `/api/sales/sales/${j(s).id}/confirm`, headers: h.headers() })).statusCode).toBe(409);
  });
  it("abastecimento baixa combustível do estoque e atualiza horímetro; depreciação mensal roda idempotente", async () => {
    const diesel = j(await h.app.inject({ method: "GET", url: "/api/resources/products?search=Diesel", headers: h.headers() })).items![0] as { id: string };
    await h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: h.headers(), payload: { farm_id: I.farm, warehouse_id: I.warehouse, product_id: diesel.id, quantity: "500", unit_value: "6" } });
    const s = await h.app.inject({ method: "POST", url: "/api/fleet/fuel-supplies", headers: h.headers(), payload: { farm_id: I.farm, supply_date: "2026-09-10", equipment_id: I.equipment, warehouse_id: I.warehouse, product_id: diesel.id, quantity: "50", hour_meter: "1200" } });
    expect(s.statusCode).toBe(201); expect(j(s).total).toBe("300.00");
    const eq = j(await h.app.inject({ method: "GET", url: `/api/resources/equipments/${I.equipment}`, headers: h.headers() })); expect(eq.hour_meter).toBe("1200.00");
    const d1 = await h.app.inject({ method: "POST", url: "/api/assets/depreciations/run", headers: h.headers(), payload: { period_month: "2026-09-01" } });
    expect(d1.statusCode).toBe(201); expect(j(d1).count).toBe(3);
    const d2 = await h.app.inject({ method: "POST", url: "/api/assets/depreciations/run", headers: h.headers(), payload: { period_month: "2026-09-01" } });
    expect(j(d2).count).toBe(0);
    const fc = j(await h.app.inject({ method: "GET", url: "/api/assets/depreciation-forecast?months=3", headers: h.headers() })) as { items: { forecast: unknown[] }[] };
    expect(fc.items.length).toBe(3); expect(fc.items[0]!.forecast.length).toBe(3);
  });
  it("apuração mensal consolida salário, adiantamento e faltas e gera financeiro", async () => {
    await h.app.inject({ method: "POST", url: "/api/resources/absences", headers: h.headers(), payload: { person_id: I.employee, absence_date: "2026-09-03", kind: "absence" } });
    const adv = await h.app.inject({ method: "POST", url: "/api/hr/advances", headers: h.headers(), payload: { farm_id: I.farm, advance_date: "2026-09-05", person_id: I.employee, amount: "300", due_date: "2026-09-20", financial_category_id: I.category, cost_center_id: I.costCenter } });
    expect(adv.statusCode).toBe(201);
    const e = await h.app.inject({ method: "POST", url: "/api/hr/earnings/calculate", headers: h.headers(), payload: { farm_id: I.farm, reference_month: "2026-09-01" } });
    expect(e.statusCode).toBe(201); expect(j(e).total_earnings).toBe("2200.00"); expect(j(e).total_deductions).toBe("373.33"); // 300 adiantamento + 2200/30
    const g = await h.app.inject({ method: "POST", url: `/api/hr/earnings/${j(e).id}/generate-financial`, headers: h.headers(), payload: { due_date: "2026-10-05", financial_category_id: I.category, cost_center_id: I.costCenter } });
    expect(g.statusCode).toBe(200); expect((j(g).title_ids as string[]).length).toBe(1);
  });
  it("pecuária: pesagem calcula GMD, venda de animal gera receita, compra cria processamento, manejo sanitário aplica carência", async () => {
    const w1 = await h.app.inject({ method: "POST", url: "/api/livestock/weighings", headers: h.headers(), payload: { farm_id: I.farm, weighing_date: "2026-09-01", batch_id: I.batch, items: [{ animal_id: I.animal, weight: "280" }] } });
    expect(w1.statusCode).toBe(201);
    const w2 = await h.app.inject({ method: "POST", url: "/api/livestock/weighings", headers: h.headers(), payload: { farm_id: I.farm, weighing_date: "2026-09-11", batch_id: I.batch, items: [{ animal_id: I.animal, weight: "290" }] } });
    expect(j(w2).average).toBe("290.00");
    const a = j(await h.app.inject({ method: "GET", url: `/api/livestock/animals/${I.animal}`, headers: h.headers() })) as { weighings: { gmd: string }[]; current_weight: string };
    expect(a.weighings[1]!.gmd).toBe("1.000"); expect(a.current_weight).toBe("290.00");
    const san = await h.app.inject({ method: "POST", url: "/api/livestock/handlings", headers: h.headers(), payload: { farm_id: I.farm, handling_type: "sanitary", handling_date: "2026-09-12", batch_id: I.batch, product_id: I.productLot, warehouse_id: null, dose: "2", items: [{ animal_id: I.animal, quantity: "1" }] } });
    expect(san.statusCode).toBe(201);
    const ivm = j(await h.app.inject({ method: "GET", url: "/api/resources/products?search=Ivermectina", headers: h.headers() })).items![0] as { id: string };
    await h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: h.headers(), payload: { farm_id: I.farm, warehouse_id: I.warehouse, product_id: ivm.id, quantity: "10", unit_value: "85", provider_lot: "L1", expiration_date: "2027-01-01" } });
    const san2 = await h.app.inject({ method: "POST", url: "/api/livestock/handlings", headers: h.headers(), payload: { farm_id: I.farm, handling_type: "sanitary", handling_date: "2026-09-12", batch_id: I.batch, product_id: ivm.id, warehouse_id: I.warehouse, dose: "0.01", items: [{ animal_id: I.animal, quantity: "1" }] } });
    expect(san2.statusCode).toBe(201); expect(j(san2).withdrawal_until).toBe("2026-10-10");
    const sale = await h.app.inject({ method: "POST", url: "/api/livestock/movements", headers: h.headers(), payload: { farm_id: I.farm, movement_type: "sale", movement_date: "2026-09-15", person_id: I.client, generate_financial: true, items: [{ animal_id: I.animal, weight: "290", unit_value: "2900" }] } });
    expect(st(sale, 201)).toBe(201); expect((j(sale).title_ids as string[]).length).toBe(1);
    expect(j(await h.app.inject({ method: "GET", url: `/api/livestock/animals/${I.animal}`, headers: h.headers() })).status).toBe("sold");
    const again = await h.app.inject({ method: "POST", url: "/api/livestock/movements", headers: h.headers(), payload: { farm_id: I.farm, movement_type: "death", movement_date: "2026-09-16", items: [{ animal_id: I.animal }] } });
    expect(j(again).error!.code).toBe("ANIMAL_NOT_ACTIVE");
    const buy = await h.app.inject({ method: "POST", url: "/api/livestock/movements", headers: h.headers(), payload: { farm_id: I.farm, movement_type: "purchase", movement_date: "2026-09-17", person_id: I.provider, batch_id: I.batch, generate_financial: true, items: [{ category_id: I.speciesCategory, quantity: 5, weight: "200", unit_value: "2000" }] } });
    expect(buy.statusCode).toBe(201); expect(j(buy).total_value).toBe("10000.00");
    const proc = j(await h.app.inject({ method: "GET", url: "/api/livestock/processings", headers: h.headers() })) as { items: { id: string; expected_quantity: number; status: string }[] };
    expect(proc.items[0]!.expected_quantity).toBe(5);
    const lots = j(await h.app.inject({ method: "GET", url: "/api/livestock/herd-lots", headers: h.headers() })) as { items: { id: string; quantity: number }[] };
    const lot = lots.items.find((l) => l.quantity === 5)!;
    const p = await h.app.inject({ method: "POST", url: `/api/livestock/processings/${proc.items[0]!.id}/process`, headers: h.headers(), payload: { animals: [{ herd_lot_id: lot.id, category_id: I.speciesCategory, sex: "M", weight: "200", batch_id: I.batch, identifications: [{ identification_type_id: I.idType, value: "NEW-0001" }] }] } });
    expect(p.statusCode).toBe(200); expect(j(p).processed).toBe(1);
    const dash = j(await h.app.inject({ method: "GET", url: "/api/dashboards/livestock?start_date=2026-09-01&end_date=2026-09-30", headers: h.headers() })) as { total_heads: number; avg_gmd: string };
    expect(dash.total_heads).toBeGreaterThan(20); expect(Number(dash.avg_gmd)).toBeGreaterThan(0);
  });
  it("dashboards e auditoria", async () => {
    for (const d of ["home", "financial", "supply", "assets", "depreciation", "rainfall", "feedlot", "feedlot-cost", "feedlot-performance", "nutrition-stock", "feed-consumption", "user-analysis", "cash-book"]) { const r = await h.app.inject({ method: "GET", url: `/api/dashboards/${d}`, headers: h.headers() }); expect(st(r, 200), d).toBe(200); }
    const home = j(await h.app.inject({ method: "GET", url: "/api/dashboards/home?start_date=2026-09-01&end_date=2026-12-31", headers: h.headers() })) as { operational_result: { income: string }; alerts: { pending_requests: string } };
    expect(Number(home.operational_result.income)).toBeGreaterThan(0);
    const audit = j(await h.app.inject({ method: "GET", url: "/api/admin/audit?entity=financial_titles", headers: h.headers() }));
    expect(audit.total).toBeGreaterThan(5);
    const roles = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: "Financeiro", permissions: ["payables.view", "payables.create"] } });
    expect(roles.statusCode).toBe(201);
    const badRole = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: "X", permissions: ["nao.existe"] } });
    expect(badRole.statusCode).toBe(422);
    const notif = await h.app.inject({ method: "POST", url: "/api/admin/notifications/refresh", headers: h.headers() }); expect(notif.statusCode).toBe(200);
    const list = j(await h.app.inject({ method: "GET", url: "/api/admin/notifications", headers: h.headers() })); expect(list.items!.length).toBeGreaterThan(0);
  });
});
