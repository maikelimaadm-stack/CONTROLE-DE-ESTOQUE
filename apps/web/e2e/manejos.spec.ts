import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

/** Chamada à API com a sessão do navegador (token + organização), para preparar dados do cenário. */
async function apiCall<T = Record<string, unknown>>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";
  return page.evaluate(async ({ method, path, body, api }) => {
    const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string | null; farmId: string | null };
    const res = await fetch(`${api}${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}), ...(s.farmId ? { "x-farm-id": s.farmId } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text(); const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 200)}`);
    return data;
  }, { method, path, body, api });
}
async function fixtures(page: Page) {
  const animals = await apiCall<{ items: { id: string; farm_id: string; batch_id: string | null }[] }>(page, "GET", "/api/livestock/animals?pageSize=1");
  const a = animals.items[0]; if (!a) throw new Error("sem animais no seed e2e");
  const batches = await apiCall<{ items: { id: string }[] }>(page, "GET", "/api/resources/batches?pageSize=1");
  return { animalId: a.id, farmId: a.farm_id, batchId: a.batch_id ?? batches.items[0]?.id ?? null };
}

/** Bloqueador do checkpoint V2: "Visualizar" de manejos e pesagens abria 404. Agora abre o registro real. */
test.describe("manejos: detalhe real (sem 404), breadcrumb, retorno com filtro e rota direta", () => {
  test("manejo sanitário: lista → filtro de tipo → Visualizar → registro correto → Voltar mantém o filtro", async ({ page }) => {
    await login(page); const fx = await fixtures(page);
    const h = await apiCall<{ id: string; code: string }>(page, "POST", "/api/livestock/handlings", { farm_id: fx.farmId, handling_type: "sanitary", handling_date: "2026-09-10", batch_id: fx.batchId, dose: "2", note: "e2e manejo sanitário", items: [{ animal_id: fx.animalId, quantity: "1" }] });
    await page.goto("/pecuaria?tab=manejos");
    await page.getByTestId("handling-type").getByRole("radio", { name: "Sanitário" }).click(); await expect(page).toHaveURL(/type=sanitary/);
    const row = page.getByTestId("b1-row").filter({ hasText: h.code }).first(); await expect(row).toBeVisible();
    await row.click(); await page.getByLabel("Mais opções").click(); await page.getByRole("menuitem", { name: "Visualizar" }).click();
    await expect(page).toHaveURL(new RegExp(`/pecuaria/manejo/sanitary/${h.id}$`));
    await expect(page.getByRole("heading", { name: `Sanitário ${h.code}` })).toBeVisible(); await expect(page.getByText("e2e manejo sanitário")).toBeVisible();
    const crumbs = page.getByRole("navigation", { name: "Navegação" }); await expect(crumbs).toContainText("Pecuária"); await expect(crumbs).toContainText("Manejos"); await expect(crumbs).toContainText("Manejo");
    await page.getByRole("button", { name: "Voltar" }).click(); await expect(page).toHaveURL(/tab=manejos/); await expect(page).toHaveURL(/type=sanitary/);
    await expect(page.getByTestId("handling-type").getByRole("radio", { name: "Sanitário" })).toHaveAttribute("aria-checked", "true");
  });
  test("pesagem: chip Pesagens → Visualizar abre /pecuaria/pesagens/:id com GMD; rota genérica /manejo/weighing/:id redireciona", async ({ page }) => {
    await login(page); const fx = await fixtures(page);
    const w = await apiCall<{ id: string; code: string }>(page, "POST", "/api/livestock/weighings", { farm_id: fx.farmId, weighing_date: "2026-09-10", batch_id: fx.batchId, items: [{ animal_id: fx.animalId, weight: "301" }] });
    await page.goto("/pecuaria?tab=manejos&type=weighing");
    await expect(page.getByTestId("handling-kind").getByRole("radio", { name: "Pesagens" })).toHaveAttribute("aria-checked", "true"); await expect(page.getByTestId("handling-type")).toHaveCount(0);
    const row = page.getByTestId("b1-row").filter({ hasText: w.code }).first(); await expect(row).toBeVisible();
    await row.click(); await page.getByLabel("Mais opções").click(); await page.getByRole("menuitem", { name: "Visualizar" }).click();
    await expect(page).toHaveURL(new RegExp(`/pecuaria/pesagens/${w.id}$`)); await expect(page.getByRole("heading", { name: `Pesagem ${w.code}` })).toBeVisible(); await expect(page.getByRole("columnheader", { name: /GMD/ })).toBeVisible();
    await page.goto(`/pecuaria/manejo/weighing/${w.id}`); await expect(page).toHaveURL(new RegExp(`/pecuaria/pesagens/${w.id}$`));
    await page.getByRole("button", { name: "Voltar" }).click(); await expect(page).toHaveURL(/type=weighing/);
  });
  test("rota direta: registro inexistente mostra erro (sem 404 de página) e usuário sem permissão recebe 403", async ({ page }) => {
    await login(page);
    await page.goto("/pecuaria/manejo/sanitary/00000000-0000-4000-8000-000000000000"); await expect(page.getByText(/Manejo não encontrado/)).toBeVisible();
    await page.goto("/pecuaria/pesagens/00000000-0000-4000-8000-000000000000"); await expect(page.getByText(/Pesagem não encontrada|não encontrad/)).toBeVisible();
    const fx = await fixtures(page);
    const h = await apiCall<{ id: string }>(page, "POST", "/api/livestock/handlings", { farm_id: fx.farmId, handling_type: "nutrition", handling_date: "2026-09-10", batch_id: fx.batchId, items: [{ animal_id: fx.animalId, quantity: "1" }] });
    await page.goto(`/pecuaria/manejo/nutrition/${h.id}`); await expect(page.getByRole("heading", { name: /^Nutrição/ })).toBeVisible();
    await page.getByLabel("Fixar menu").click(); await page.getByRole("button", { name: "Sair" }).first().click();
    await login(page, { email: "operador@demo.local", password: "Demo@12345" });
    await page.goto(`/pecuaria/manejo/nutrition/${h.id}`); await expect(page.getByText(/Sem permissão/)).toBeVisible();
  });
  test("frota: Visualizar abastecimento abre o registro (antes 404)", async ({ page }) => {
    await login(page);
    await page.goto("/frota?tab=abastecimentos");
    const row = page.getByTestId("b1-row").first();
    if (await row.count()) { await row.click(); await page.getByLabel("Mais opções").click(); await page.getByRole("menuitem", { name: "Visualizar" }).click(); await expect(page).toHaveURL(/\/frota\/abastecimentos\/[0-9a-f-]{36}$/); await expect(page.getByRole("heading", { name: /^Abastecimento/ })).toBeVisible(); await page.getByRole("button", { name: "Voltar" }).click(); await expect(page).toHaveURL(/tab=abastecimentos/); }
  });
});
