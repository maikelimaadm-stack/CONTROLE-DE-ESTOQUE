import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * UI-STAB-01 — abas globais de trabalho: identidade (dedupe por tela, registros distintos = abas distintas), URL real
 * como autoridade (deep link, voltar/avançar, refresh), fechar (vizinha assume), "+" abre a busca, aba Início fixa,
 * troca de fazenda fecha abas de registro (farm-scoped).
 */
async function apiCall<T = Record<string, unknown>>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";
  return page.evaluate(async ({ method, path, body, api }) => {
    const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string | null; farmId: string | null };
    const res = await fetch(`${api}${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}), ...(s.farmId ? { "x-farm-id": s.farmId } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text(); const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 200)}`);
    return data as T;
  }, { method, path, body, api });
}
const tabs = (page: Page) => page.getByTestId("workspace-tab");
const activeTab = (page: Page) => page.getByTestId("workspace-tabs").locator('[role="tab"][aria-selected="true"]');
const openVia = async (page: Page, module: string, item: RegExp | string) => {
  let btn = page.getByTestId("nav-module").filter({ hasText: module }).first();
  if (!(await btn.isVisible())) { await page.getByTestId("nav-more").click(); btn = page.getByTestId("nav-module").filter({ hasText: module }).first(); } // módulo dentro de "Mais"
  await btn.hover(); await page.getByTestId("mega-menu").getByTestId("mega-item").filter({ hasText: item }).first().click();
};
async function fuelSupply(page: Page, note: string) {
  const eq = await apiCall<{ items: { id: string; farm_id: string }[] }>(page, "GET", "/api/resources/equipments?pageSize=1"); const e = eq.items[0]!;
  const prods = await apiCall<{ id: string }[]>(page, "GET", "/api/resources/products/options?search=Diesel"); const p = prods[0]!;
  return apiCall<{ id: string; code: string }>(page, "POST", "/api/fleet/fuel-supplies", { farm_id: e.farm_id, supply_date: "2026-09-10", equipment_id: e.id, product_id: p.id, quantity: "5", unit_value: "6.2", note });
}

test.describe("abas globais", () => {
  test("mesma tela aberta duas vezes (mega-menu e busca) = uma aba; abas internas ficam dentro da aba do módulo", async ({ page }) => {
    await login(page);
    await openVia(page, "Estoque", "Saldo"); await expect(page).toHaveURL(/sub=saldo/);
    await openVia(page, "Estoque", "Movimentações"); await expect(page).toHaveURL(/sub=ledger/);
    await page.getByTestId("global-search").fill("saldo"); await page.keyboard.press("Enter"); await expect(page).toHaveURL(/sub=saldo/);
    await expect(tabs(page).filter({ hasText: "Estoque" })).toHaveCount(1); await expect(tabs(page)).toHaveCount(2);
    await expect(page.locator("main").getByRole("tab", { name: "Estoque", exact: true })).toHaveAttribute("aria-selected", "true");
  });

  test("registros diferentes da mesma entidade = abas distintas com título dinâmico; mesmo registro não duplica", async ({ page }) => {
    await login(page);
    const a = await fuelSupply(page, "tab A"); const b = await fuelSupply(page, "tab B");
    await page.goto(`/frota/abastecimentos/${a.id}`); await expect(activeTab(page)).toHaveText(`Abastecimento ${a.code}`);
    await page.goto(`/frota/abastecimentos/${b.id}`); await expect(activeTab(page)).toHaveText(`Abastecimento ${b.code}`);
    await expect(tabs(page).filter({ hasText: "Abastecimento" })).toHaveCount(2);
    await page.goto(`/frota/abastecimentos/${a.id}`); await expect(tabs(page).filter({ hasText: "Abastecimento" })).toHaveCount(2);
    await expect(activeTab(page)).toHaveText(`Abastecimento ${a.code}`);
  });

  test("fechar a aba ativa ativa a vizinha e sincroniza a URL; Início não fecha; fechar as outras mantém Início", async ({ page }) => {
    await login(page);
    await openVia(page, "Estoque", "Saldo"); await openVia(page, "Financeiro", "A Pagar"); await openVia(page, "Pecuária", /Animais/);
    await expect(tabs(page)).toHaveCount(4); await expect(activeTab(page)).toHaveText("Pecuária");
    await page.getByLabel("Fechar aba Pecuária").click();
    await expect(activeTab(page)).toHaveText("Financeiro"); await expect(page).toHaveURL(/\/financeiro\?tab=contas&sub=pagar/);
    await expect(page.getByLabel("Fechar aba Início")).toHaveCount(0);
    await activeTab(page).focus(); await page.keyboard.press("Delete"); await expect(activeTab(page)).toHaveText("Estoque"); await expect(page).toHaveURL(/\/estoque\?tab=estoque&sub=saldo/);
    await page.getByLabel("Fechar aba Estoque").click(); await expect(activeTab(page)).toHaveText("Início"); await expect(page).toHaveURL(/\/$/);
  });

  test("deep link cria/foca a aba; refresh restaura as abas e a ativa; voltar/avançar mantêm URL e conteúdo sincronizados", async ({ page }) => {
    await login(page);
    await page.goto("/configuracoes?tab=auditoria"); await expect(activeTab(page)).toHaveText("Configurações");
    await openVia(page, "Estoque", "Saldo"); await expect(activeTab(page)).toHaveText("Estoque"); await expect(page).toHaveURL(/sub=saldo/);
    await page.reload(); await expect(tabs(page)).toHaveCount(3); await expect(activeTab(page)).toHaveText("Estoque"); await expect(page).toHaveURL(/\/estoque\?tab=estoque&sub=saldo/);
    await expect(page.getByRole("heading", { name: "Saldo de Estoque" })).toBeVisible();
    await page.goBack(); await expect(page).toHaveURL(/\/configuracoes\?tab=auditoria/); await expect(activeTab(page)).toHaveText("Configurações"); await expect(page.getByRole("heading", { name: "Auditoria" })).toBeVisible();
    await page.goForward(); await expect(page).toHaveURL(/\/estoque\?tab=estoque&sub=saldo/); await expect(activeTab(page)).toHaveText("Estoque"); await expect(page.getByRole("heading", { name: "Saldo de Estoque" })).toBeVisible();
  });

  test("aba de registro (farm-scoped) fecha ao trocar de fazenda; abas de módulo permanecem", async ({ page }) => {
    await login(page);
    const a = await fuelSupply(page, "farm switch"); await openVia(page, "Estoque", "Saldo");
    await page.goto(`/frota/abastecimentos/${a.id}`); await expect(activeTab(page)).toHaveText(`Abastecimento ${a.code}`);
    await page.getByLabel("Fazenda ativa").selectOption({ index: 1 });
    await expect(tabs(page).filter({ hasText: "Abastecimento" })).toHaveCount(0); await expect(tabs(page).filter({ hasText: "Estoque" })).toHaveCount(1);
    await expect(page).not.toHaveURL(new RegExp(a.id)); await expect(page.getByTestId("error-state")).toHaveCount(0);
  });

  test("muitas abas: rail rola, menu de abas lista todas e foca a escolhida", async ({ page }) => {
    await login(page); await page.setViewportSize({ width: 1024, height: 768 });
    for (const [m, it] of [["Compras", /Processos/], ["Estoque", "Saldo"], ["Financeiro", "A Pagar"], ["Vendas", /Vendas/], ["Pecuária", /Animais/], ["Frota e Ativos", /Abastecimentos/], ["Configurações", /Auditoria/]] as const) await openVia(page, m, it);
    await expect(tabs(page)).toHaveCount(8);
    await page.getByTestId("workspace-tabs-menu").click(); await page.getByRole("menuitem", { name: /Compras/ }).click();
    await expect(activeTab(page)).toHaveText("Compras"); await expect(page).toHaveURL(/\/compras/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });

  test("alterações não salvas: a aba mostra indicador e fechar pede confirmação (cancelar mantém, confirmar fecha)", async ({ page }) => {
    await login(page);
    await page.goto("/cadastros/products/new"); await expect(activeTab(page)).toHaveText(/Novo/);
    await page.locator("main input:not([type=hidden]):not([readonly])").first().fill("Produto dirty e2e");
    const tab = tabs(page).filter({ hasText: /Novo/ }); await expect(tab.getByLabel("Alterações não salvas")).toBeVisible();
    await tab.getByRole("button", { name: /Fechar aba/ }).click();
    const dlg = page.getByTestId("confirm-dialog"); await expect(dlg).toBeVisible(); await expect(dlg.getByRole("heading", { name: /alterações não salvas/ })).toBeVisible();
    await dlg.locator(".mg-dialog__footer").getByRole("button", { name: "Fechar", exact: true }).click(); await expect(dlg).toBeHidden(); await expect(tab).toHaveCount(1);
    await tab.getByRole("button", { name: /Fechar aba/ }).click(); await page.getByTestId("confirm-dialog-confirm").click();
    await expect(tab).toHaveCount(0); await expect(activeTab(page)).toHaveText("Início");
  });
});
