import { test, expect } from "@playwright/test";
import { login } from "./helpers";
/** Reorganização funcional: áreas com abas, rotas antigas redirecionadas, abas montadas por permissão. */
test("rotas antigas redirecionam para a área/aba equivalente preservando parâmetros", async ({ page }) => {
  await login(page);
  await page.goto("/estoque/transferencias?kind=farm"); await expect(page).toHaveURL(/\/estoque\?.*tab=transferencias&sub=farm/);
  await page.goto("/financeiro/contas-a-pagar?status=overdue"); await expect(page).toHaveURL(/\/financeiro\?.*tab=contas&sub=pagar/);
  await page.goto("/suprimentos/mine"); await expect(page).toHaveURL(/\/compras\?tab=processos&sub=mine/);
  await page.goto("/pecuaria/movimentacoes/sale"); await expect(page).toHaveURL(/\/pecuaria\?tab=movimentacoes&sub=sale/);
  await page.goto("/admin/usuarios"); await expect(page).toHaveURL(/\/configuracoes\?tab=usuarios&sub=usuarios/);
  await page.goto("/dashboards/financeiro"); await expect(page).toHaveURL(/\/financeiro\?tab=visao-geral/);
});
test("área de estoque: abas, sub-abas, saldo com ação contextual de ajuste e '+ Novo' com seletor de operação", async ({ page }) => {
  await login(page);
  await page.goto("/estoque?tab=saldo");
  await expect(page.getByRole("tab", { name: "Saldo" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("table")).toBeVisible();
  // ação contextual por linha (quando há saldo) e pelo seletor "+ Novo" (sempre): ambos abrem o mesmo diálogo de ajuste
  const rowAction = page.getByRole("button", { name: "Ajustar estoque" }).first();
  if (await rowAction.count()) { await rowAction.click(); await expect(page.getByRole("dialog").getByRole("heading", { name: "Ajustar estoque" })).toBeVisible(); await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toBeHidden(); }
  await page.getByTestId("ws-new").click();
  await expect(page.getByRole("menuitem", { name: /Requisição/ })).toBeVisible();
  await page.getByRole("menuitem", { name: /Ajuste de estoque/ }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Ajustar estoque" })).toBeVisible(); await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("tab", { name: "Saídas" }).click(); await expect(page).toHaveURL(/tab=saidas/);
  await page.getByRole("tab", { name: /Saídas diretas/ }).click(); await expect(page).toHaveURL(/sub=diretas/);
});
test("menu principal enxuto: módulos funcionais, sem 'Cadastros Base'; configurações agrupam cadastros técnicos", async ({ page }) => {
  await login(page);
  await page.getByLabel("Fixar menu").click();
  const nav = page.getByRole("navigation", { name: "Menu principal" });
  await expect(nav.getByText("Cadastros Base")).toHaveCount(0);
  await expect(nav.getByText("Dashboards")).toHaveCount(0);
  for (const m of ["Compras", "Estoque", "Financeiro", "Vendas", "Pecuária", "Frota e Ativos", "Pessoas e RH", "Ordens de Serviço", "Relatórios", "Configurações"]) await expect(nav.getByText(m, { exact: true }).first()).toBeVisible();
  await page.goto("/configuracoes?tab=produtos&sub=products");
  await expect(page.getByRole("tab", { name: "Produtos e Classificações" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("table")).toBeVisible();
});
test("abas respeitam permissões: operador de estoque não vê abas financeiras nem o módulo no menu", async ({ page }) => {
  await login(page, { email: "operador@demo.local", password: "Demo@12345" });
  await page.getByLabel("Fixar menu").click();
  const nav = page.getByRole("navigation", { name: "Menu principal" });
  await expect(nav.getByText("Financeiro", { exact: true })).toHaveCount(0);
  await page.goto("/financeiro?tab=contas"); await expect(page.getByText(/Sem permissão/)).toBeVisible();
  await page.goto("/estoque?tab=saidas"); await expect(page.getByRole("tab", { name: "Requisições" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Fábrica/ })).toHaveCount(0);
});
