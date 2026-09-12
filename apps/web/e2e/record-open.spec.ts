import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * UI-STAB-01 — abertura de registros: para cada família operacional com rota de detalhe (DETAIL_ROUTES) busca um
 * registro real pela API de listagem e abre o detalhe; a tela precisa carregar (título, sem ErrorState/403/404) e a
 * lista precisa expor "Visualizar" explícito. Famílias sem registro no seed são anotadas (não silenciadas).
 */
async function apiGet<T>(page: Page, path: string): Promise<T> {
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";
  return page.evaluate(async ({ path, api }) => {
    const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string | null };
    const res = await fetch(`${api}${path}`, { headers: { authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}) } });
    if (!res.ok) throw new Error(`${res.status} ${path}`); return res.json();
  }, { path, api });
}
type Family = { name: string; list: string; href: (r: Record<string, unknown>) => string; /** cria um registro mínimo pela API quando o seed não tem nenhum */ fixture?: (page: Page, r: Refs) => Promise<void> };
async function apiPost<T>(page: Page, path: string, body: unknown): Promise<T> {
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";
  return page.evaluate(async ({ path, body, api }) => {
    const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string | null };
    const res = await fetch(`${api}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}) }, body: JSON.stringify(body) });
    const text = await res.text(); if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 200)}`); return text ? JSON.parse(text) : {};
  }, { path, body, api });
}
const first = async <T,>(page: Page, path: string): Promise<T> => { const d = await apiGet<{ items?: T[] } | T[]>(page, path); const items = Array.isArray(d) ? d : (d.items ?? []); if (!items[0]) throw new Error(`fixture: sem registro em ${path}`); return items[0]; };
type Refs = { farm: string; animal: string; batch: string; wh: string; prod: string; supplier: string; client: string; cat: string; cc: string; eq: string };
/** Referências do seed (cadastros) usadas pelas fixtures — resolvidas uma vez por teste. */
async function refs(page: Page): Promise<Refs> {
  const a = await first<{ id: string; farm_id: string; batch_id: string }>(page, "/api/livestock/animals?pageSize=1");
  const [wh, prod, supplier, client, cat, cc, eq] = await Promise.all([
    first<{ id: string }>(page, `/api/resources/warehouses?farm_id=${a.farm_id}&pageSize=1`), first<{ id: string }>(page, "/api/resources/products?pageSize=1"),
    first<{ id: string }>(page, "/api/resources/people?is_supplier=true&pageSize=1"), first<{ id: string }>(page, "/api/resources/people?is_client=true&pageSize=1"),
    first<{ id: string }>(page, "/api/resources/financial_categories?pageSize=1"), first<{ id: string }>(page, "/api/resources/cost_centers?pageSize=1"), first<{ id: string }>(page, "/api/resources/equipments?pageSize=1")
  ]);
  return { farm: a.farm_id, animal: a.id, batch: a.batch_id, wh: wh.id, prod: prod.id, supplier: supplier.id, client: client.id, cat: cat.id, cc: cc.id, eq: eq.id };
}
const title = (r: Refs, dir: "payable" | "receivable") => ({ farm_id: r.farm, number: `${dir === "payable" ? "PO" : "RO"}-${Date.now().toString(36)}`, person_id: dir === "payable" ? r.supplier : r.client, amount: "10.00", emission_date: "2026-09-10", due_date: "2026-10-10", note: "record-open", apportionment: [{ financial_category_id: r.cat, cost_center_id: r.cc, percentage: "100" }] });
const inputEntry = (r: Refs) => ({ farm_id: r.farm, entry_date: "2026-09-10", note: "record-open", items: [{ product_id: r.prod, quantity: "100", unit_value: "2", generate_stock: true, warehouse_id: r.wh }] });
/** Fixtures mínimas pela API para famílias que o seed de demonstração não cobre (o seed traz só cadastros + animais). */
const fixtures: Record<string, (page: Page, r: Refs) => Promise<void>> = {
  os: async (page, r) => { await apiPost(page, "/api/service-orders", { farm_id: r.farm, order_date: "2026-09-10", description: "OS record-open", planned_end: "2026-09-30" }); },
  budget: async (page, r) => { await apiPost(page, "/api/sales/budgets", { farm_id: r.farm, document_date: "2026-09-10", client_id: r.client, items: [{ product_id: r.prod, warehouse_id: r.wh, quantity: "1", unit_price: "5" }] }); },
  receivable: async (page, r) => { await apiPost(page, "/api/financial/receivables", title(r, "receivable")); },
  payable: async (page, r) => { await apiPost(page, "/api/financial/payables", title(r, "payable")); },
  inputEntry: async (page, r) => { await apiPost(page, "/api/stock/input-entries", inputEntry(r)); },
  requisition: async (page, r) => { await apiPost(page, "/api/stock/input-entries", inputEntry(r)); await apiPost(page, "/api/stock/requisitions", { farm_id: r.farm, requisition_date: "2026-09-10", items: [{ warehouse_id: r.wh, product_id: r.prod, quantity: "1" }] }); },
  writeoff: async (page, r) => { await apiPost(page, "/api/stock/input-entries", inputEntry(r)); await apiPost(page, "/api/stock/writeoffs", { farm_id: r.farm, writeoff_date: "2026-09-10", reason: "loss", warehouse_id: r.wh, justification: "record-open", items: [{ product_id: r.prod, quantity: "1" }] }); },
  fuel: async (page, r) => { await apiPost(page, "/api/fleet/fuel-supplies", { farm_id: r.farm, supply_date: "2026-09-10", equipment_id: r.eq, product_id: r.prod, quantity: "5", unit_value: "6.2", note: "record-open" }); },
  maintenance: async (page, r) => { await apiPost(page, "/api/fleet/maintenances", { farm_id: r.farm, maintenance_date: "2026-09-10", machines: [{ equipment_id: r.eq, service_total: "10", service_description: "record-open" }] }); },
  purchaseRequest: async (page, r) => { await apiPost(page, "/api/supply/requests", { farm_id: r.farm, request_date: "2026-09-10", request_type: "product", description: "record-open", justification: "record-open", items: [{ product_id: r.prod, description: "item", quantity: "1", reference_value: "5" }] }); },
  handling: async (page, r) => { await apiPost(page, "/api/livestock/handlings", { farm_id: r.farm, handling_type: "sanitary", handling_date: "2026-09-10", batch_id: r.batch, dose: "1", note: "record-open", items: [{ animal_id: r.animal, quantity: "1" }] }); },
  weighing: async (page, r) => { await apiPost(page, "/api/livestock/weighings", { farm_id: r.farm, weighing_date: "2026-09-10", batch_id: r.batch, items: [{ animal_id: r.animal, weight: "300" }] }); }
};
const FAMILIES: Family[] = [
  { name: "Compras › processo", list: "/api/supply/requests?pageSize=1", href: (r) => `/suprimentos/view/${r.id}`, fixture: fixtures.purchaseRequest },
  { name: "Estoque › entrada manual", list: "/api/stock/input-entries?pageSize=1", href: (r) => `/estoque/entradas/${r.id}`, fixture: fixtures.inputEntry },
  { name: "Estoque › documento fiscal", list: "/api/stock/invoices?pageSize=1", href: (r) => `/estoque/documentos-fiscais/${r.id}` },
  { name: "Estoque › requisição", list: "/api/stock/requisitions?pageSize=1", href: (r) => `/estoque/requisicoes/${r.id}`, fixture: fixtures.requisition },
  { name: "Estoque › saída direta", list: "/api/stock/writeoffs?pageSize=1", href: (r) => `/estoque/baixas/${r.id}`, fixture: fixtures.writeoff },
  { name: "Estoque › devolução", list: "/api/stock/devolutions?pageSize=1", href: (r) => `/estoque/devolucoes/${r.id}` },
  { name: "Estoque › transferência", list: "/api/stock/transfers?pageSize=1", href: (r) => `/estoque/transferencias/${r.id}` },
  { name: "Estoque › produção de ração", list: "/api/stock/feed-batches?pageSize=1", href: (r) => `/estoque/batidas/${r.id}` },
  { name: "Financeiro › conta a pagar", list: "/api/financial/payables?pageSize=1", href: (r) => `/financeiro/contas-a-pagar/${r.id}`, fixture: fixtures.payable },
  { name: "Financeiro › conta a receber", list: "/api/financial/receivables?pageSize=1", href: (r) => `/financeiro/contas-a-receber/${r.id}`, fixture: fixtures.receivable },
  { name: "Financeiro › movimento bancário", list: "/api/financial/bank-movements?pageSize=1", href: (r) => `/financeiro/movimentos/${r.id}` },
  { name: "Financeiro › importação OFX", list: "/api/financial/ofx-imports?pageSize=1", href: (r) => `/financeiro/ofx/${r.id}` },
  { name: "Vendas › orçamento", list: "/api/sales/budgets?pageSize=1", href: (r) => `/vendas/budgets/${r.id}`, fixture: fixtures.budget },
  { name: "Vendas › pedido", list: "/api/sales/orders?pageSize=1", href: (r) => `/vendas/orders/${r.id}` },
  { name: "Vendas › venda", list: "/api/sales/sales?pageSize=1", href: (r) => `/vendas/sales/${r.id}` },
  { name: "Pecuária › animal", list: "/api/livestock/animals?pageSize=1", href: (r) => `/pecuaria/animais/${r.id}` },
  { name: "Pecuária › movimentação", list: "/api/livestock/movements?pageSize=1", href: (r) => `/pecuaria/movimentacoes/${r.movement_type}/${r.id}` },
  { name: "Pecuária › manejo", list: "/api/livestock/handlings?pageSize=1", href: (r) => `/pecuaria/manejo/${r.handling_type}/${r.id}`, fixture: fixtures.handling },
  { name: "Pecuária › pesagem", list: "/api/livestock/weighings?pageSize=1", href: (r) => `/pecuaria/pesagens/${r.id}`, fixture: fixtures.weighing },
  { name: "Frota › abastecimento", list: "/api/fleet/fuel-supplies?pageSize=1", href: (r) => `/frota/abastecimentos/${r.id}`, fixture: fixtures.fuel },
  { name: "Frota › manutenção", list: "/api/fleet/maintenances?pageSize=1", href: (r) => `/frota/manutencoes/${r.id}`, fixture: fixtures.maintenance },
  { name: "Ordens de serviço", list: "/api/service-orders?pageSize=1", href: (r) => `/os/${r.id}`, fixture: fixtures.os },
  { name: "Cadastros › produto", list: "/api/resources/products?pageSize=1", href: (r) => `/cadastros/products/${r.id}?view=1` },
  { name: "Configurações › perfil de acesso", list: "/api/admin/roles?pageSize=1", href: (r) => `/admin/perfis/${r.id}` }
];

/** Primeiro registro da família; quando o seed não tem nenhum e há fixture, cria pela API (falha de fixture é anotada, não silenciada). */
async function ensure(page: Page, f: Family, R: Refs): Promise<Record<string, unknown> | undefined> {
  const list = async () => { const d = await apiGet<{ items?: Record<string, unknown>[] } | Record<string, unknown>[]>(page, f.list); return (Array.isArray(d) ? d : (d.items ?? []))[0]; };
  let r: Record<string, unknown> | undefined;
  try { r = await list(); } catch (e) { throw new Error(`${f.name}: listagem falhou — ${(e as Error).message}`); }
  if (!r && f.fixture) { try { await f.fixture(page, R); r = await list(); } catch (e) { test.info().annotations.push({ type: "fixture-falhou", description: `${f.name}: ${(e as Error).message}` }); } }
  return r;
}
const family = (name: string) => { const f = FAMILIES.find((x) => x.name === name); if (!f) throw new Error(`família ${name}`); return f; };

test.describe("registros abrem", () => {
  test("todas as famílias com rota de detalhe abrem um registro real (ou são anotadas como sem registro no seed)", async ({ page }) => {
    test.setTimeout(180_000);
    await login(page); const R = await refs(page);
    const missing: string[] = []; const opened: string[] = [];
    for (const f of FAMILIES) {
      const r = await ensure(page, f, R);
      if (!r) { missing.push(f.name); continue; }
      await page.goto(f.href(r));
      await expect(page.getByText(/This page couldn|Application error|Erro na aplicação/), `${f.name}: tela quebrou (erro de renderização)`).toHaveCount(0);
      await expect(page.getByTestId("error-state"), `${f.name}: ErrorState`).toHaveCount(0);
      await expect(page.getByText(/Sem permissão|não encontrad/i), `${f.name}: bloqueio/404`).toHaveCount(0);
      // título: cabeçalho da tela ou o identificador do registro (cadastros em modo Registro mostram "CÓDIGO • nome" na barra)
      const label = String(r.code ?? r.number ?? r.name ?? r.description ?? "").trim();
      if (label) await expect(page.locator("main"), `${f.name}: registro ${label}`).toContainText(label); else await expect(page.locator("main").getByRole("heading").first(), `${f.name}: título`).toBeVisible();
      opened.push(f.name);
    }
    test.info().annotations.push({ type: "abertos", description: opened.join(" · ") }, { type: "sem-registro-no-seed", description: missing.join(" · ") || "nenhum" });
    expect(opened.length).toBeGreaterThanOrEqual(15);
  });

  test("listas expõem Visualizar explícito: DocList (menu da linha), DataTable (ação por linha) e cadastros", async ({ page }) => {
    await login(page); const R = await refs(page);
    for (const n of ["Financeiro › conta a pagar", "Frota › abastecimento"]) if (!(await ensure(page, family(n), R))) throw new Error(`${n}: sem registro e fixture falhou`);
    await page.goto("/financeiro?tab=contas&sub=pagar"); const view = page.getByTestId("row-view").first(); await expect(view).toBeVisible(); await view.click();
    await expect(page).toHaveURL(/\/financeiro\/contas-a-pagar\/[0-9a-f-]{36}$/); await expect(page.locator("main").getByRole("heading").first()).toBeVisible();
    await page.goto("/pecuaria?tab=rebanho&sub=animais"); await expect(page.getByTestId("row-view").first()).toBeVisible();
    await page.goto("/admin/perfis"); await page.getByTestId("row-view").first().click(); await expect(page).toHaveURL(/\/admin\/perfis\/[0-9a-f-]{36}$/);
    await page.goto("/frota?tab=abastecimentos"); const row = page.getByTestId("b1-row").first(); await expect(row).toBeVisible(); await row.click(); await page.getByLabel("Mais opções").first().click();
    await expect(page.getByRole("menuitem", { name: "Visualizar" })).toBeVisible(); await page.getByRole("menuitem", { name: "Visualizar" }).click(); await expect(page).toHaveURL(/\/frota\/abastecimentos\/[0-9a-f-]{36}$/);
    await page.goto("/cadastros/products"); await page.getByTestId("b1-row").first().click(); await page.getByLabel("Mais opções").first().click(); await expect(page.getByRole("menuitem", { name: "Visualizar" })).toBeVisible();
  });
});
