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
type Family = { name: string; list: string; href: (r: Record<string, unknown>) => string; /** cria um registro mínimo pela API quando o seed não tem nenhum */ fixture?: (page: Page) => Promise<void> };
async function apiPost<T>(page: Page, path: string, body: unknown): Promise<T> {
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";
  return page.evaluate(async ({ path, body, api }) => {
    const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string | null };
    const res = await fetch(`${api}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}) }, body: JSON.stringify(body) });
    const text = await res.text(); if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 200)}`); return text ? JSON.parse(text) : {};
  }, { path, body, api });
}
const first = async <T,>(page: Page, path: string): Promise<T> => { const d = await apiGet<{ items?: T[] } | T[]>(page, path); const items = Array.isArray(d) ? d : (d.items ?? []); if (!items[0]) throw new Error(`fixture: sem registro em ${path}`); return items[0]; };
const farmOf = async (page: Page) => (await first<{ farm_id: string }>(page, "/api/livestock/animals?pageSize=1")).farm_id;
const fixtures = {
  os: async (page: Page) => { await apiPost(page, "/api/service-orders", { farm_id: await farmOf(page), order_date: "2026-09-10", description: "OS record-open", planned_end: "2026-09-30" }); },
  budget: async (page: Page) => { const farm = await farmOf(page); const client = await first<{ id: string }>(page, "/api/resources/people?is_client=true&pageSize=1"); const wh = await first<{ id: string }>(page, `/api/resources/warehouses?farm_id=${farm}&pageSize=1`); const prod = await first<{ id: string }>(page, "/api/resources/products?pageSize=1"); await apiPost(page, "/api/sales/budgets", { farm_id: farm, document_date: "2026-09-10", client_id: client.id, items: [{ product_id: prod.id, warehouse_id: wh.id, quantity: "1", unit_price: "5" }] }); },
  receivable: async (page: Page) => { const farm = await farmOf(page); const client = await first<{ id: string }>(page, "/api/resources/people?is_client=true&pageSize=1"); const cat = await first<{ id: string }>(page, "/api/resources/financial_categories?pageSize=1"); const cc = await first<{ id: string }>(page, "/api/resources/cost_centers?pageSize=1"); await apiPost(page, "/api/financial/receivables", { farm_id: farm, number: `RO-${Date.now().toString(36)}`, person_id: client.id, amount: "10.00", emission_date: "2026-09-10", due_date: "2026-10-10", note: "record-open", apportionment: [{ financial_category_id: cat.id, cost_center_id: cc.id, percentage: "100" }] }); }
};
const FAMILIES: Family[] = [
  { name: "Compras › processo", list: "/api/supply/requests?pageSize=1", href: (r) => `/suprimentos/view/${r.id}` },
  { name: "Estoque › entrada manual", list: "/api/stock/input-entries?pageSize=1", href: (r) => `/estoque/entradas/${r.id}` },
  { name: "Estoque › documento fiscal", list: "/api/stock/invoices?pageSize=1", href: (r) => `/estoque/documentos-fiscais/${r.id}` },
  { name: "Estoque › requisição", list: "/api/stock/requisitions?pageSize=1", href: (r) => `/estoque/requisicoes/${r.id}` },
  { name: "Estoque › saída direta", list: "/api/stock/writeoffs?pageSize=1", href: (r) => `/estoque/baixas/${r.id}` },
  { name: "Estoque › devolução", list: "/api/stock/devolutions?pageSize=1", href: (r) => `/estoque/devolucoes/${r.id}` },
  { name: "Estoque › transferência", list: "/api/stock/transfers?pageSize=1", href: (r) => `/estoque/transferencias/${r.id}` },
  { name: "Estoque › produção de ração", list: "/api/stock/feed-batches?pageSize=1", href: (r) => `/estoque/batidas/${r.id}` },
  { name: "Financeiro › conta a pagar", list: "/api/financial/payables?pageSize=1", href: (r) => `/financeiro/contas-a-pagar/${r.id}` },
  { name: "Financeiro › conta a receber", list: "/api/financial/receivables?pageSize=1", href: (r) => `/financeiro/contas-a-receber/${r.id}`, fixture: fixtures.receivable },
  { name: "Financeiro › movimento bancário", list: "/api/financial/bank-movements?pageSize=1", href: (r) => `/financeiro/movimentos/${r.id}` },
  { name: "Financeiro › importação OFX", list: "/api/financial/ofx-imports?pageSize=1", href: (r) => `/financeiro/ofx/${r.id}` },
  { name: "Vendas › orçamento", list: "/api/sales/budgets?pageSize=1", href: (r) => `/vendas/budgets/${r.id}`, fixture: fixtures.budget },
  { name: "Vendas › pedido", list: "/api/sales/orders?pageSize=1", href: (r) => `/vendas/orders/${r.id}` },
  { name: "Vendas › venda", list: "/api/sales/sales?pageSize=1", href: (r) => `/vendas/sales/${r.id}` },
  { name: "Pecuária › animal", list: "/api/livestock/animals?pageSize=1", href: (r) => `/pecuaria/animais/${r.id}` },
  { name: "Pecuária › movimentação", list: "/api/livestock/movements?pageSize=1", href: (r) => `/pecuaria/movimentacoes/${r.movement_type}/${r.id}` },
  { name: "Pecuária › manejo", list: "/api/livestock/handlings?pageSize=1", href: (r) => `/pecuaria/manejo/${r.handling_type}/${r.id}` },
  { name: "Pecuária › pesagem", list: "/api/livestock/weighings?pageSize=1", href: (r) => `/pecuaria/pesagens/${r.id}` },
  { name: "Frota › abastecimento", list: "/api/fleet/fuel-supplies?pageSize=1", href: (r) => `/frota/abastecimentos/${r.id}` },
  { name: "Frota › manutenção", list: "/api/fleet/maintenances?pageSize=1", href: (r) => `/frota/manutencoes/${r.id}` },
  { name: "Ordens de serviço", list: "/api/service-orders?pageSize=1", href: (r) => `/os/${r.id}`, fixture: fixtures.os },
  { name: "Cadastros › produto", list: "/api/resources/products?pageSize=1", href: (r) => `/cadastros/products/${r.id}?view=1` },
  { name: "Configurações › perfil de acesso", list: "/api/admin/roles?pageSize=1", href: (r) => `/admin/perfis/${r.id}` }
];

test.describe("registros abrem", () => {
  test("todas as famílias com rota de detalhe abrem um registro real (ou são anotadas como sem registro no seed)", async ({ page }) => {
    test.setTimeout(180_000);
    await login(page);
    const missing: string[] = []; const opened: string[] = [];
    for (const f of FAMILIES) {
      let items: Record<string, unknown>[] = [];
      try { const d = await apiGet<{ items?: Record<string, unknown>[] } | Record<string, unknown>[]>(page, f.list); items = Array.isArray(d) ? d : (d.items ?? []); } catch (e) { throw new Error(`${f.name}: listagem falhou — ${(e as Error).message}`); }
      let r = items[0];
      if (!r && f.fixture) { try { await f.fixture(page); const d = await apiGet<{ items?: Record<string, unknown>[] }>(page, f.list); r = d.items?.[0]; } catch (e) { test.info().annotations.push({ type: "fixture-falhou", description: `${f.name}: ${(e as Error).message}` }); } }
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
    expect(opened.length).toBeGreaterThanOrEqual(12);
  });

  test("listas expõem Visualizar explícito: DocList (menu da linha), DataTable (ação por linha) e cadastros", async ({ page }) => {
    await login(page);
    await page.goto("/financeiro?tab=contas&sub=pagar"); const view = page.getByTestId("row-view").first(); await expect(view).toBeVisible(); await view.click();
    await expect(page).toHaveURL(/\/financeiro\/contas-a-pagar\/[0-9a-f-]{36}$/); await expect(page.locator("main").getByRole("heading").first()).toBeVisible();
    await page.goto("/pecuaria?tab=rebanho&sub=animais"); await expect(page.getByTestId("row-view").first()).toBeVisible();
    await page.goto("/admin/perfis"); await page.getByTestId("row-view").first().click(); await expect(page).toHaveURL(/\/admin\/perfis\/[0-9a-f-]{36}$/);
    await page.goto("/frota?tab=abastecimentos"); const row = page.getByTestId("b1-row").first(); await expect(row).toBeVisible(); await row.click(); await page.getByLabel("Mais opções").first().click();
    await expect(page.getByRole("menuitem", { name: "Visualizar" })).toBeVisible(); await page.getByRole("menuitem", { name: "Visualizar" }).click(); await expect(page).toHaveURL(/\/frota\/abastecimentos\/[0-9a-f-]{36}$/);
    await page.goto("/cadastros/products"); await page.getByTestId("b1-row").first().click(); await page.getByLabel("Mais opções").first().click(); await expect(page.getByRole("menuitem", { name: "Visualizar" })).toBeVisible();
  });
});
