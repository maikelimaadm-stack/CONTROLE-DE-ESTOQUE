import { test, expect } from "@playwright/test";
import { login, logout } from "./helpers";
/** Compactação V2: busca global, favoritos canônicos, filtros em vez de abas (Compras, OS, Pecuária), Relatórios. */
test("busca global encontra funções fora do menu, respeita permissão e abre a rota canônica", async ({ page }) => {
  await login(page);
  const box = page.getByLabel("Buscar funcionalidade");
  await box.fill("pesar animal"); const res = page.getByTestId("nav-search-results");
  await expect(res.getByRole("option", { name: /Manejos/ }).first()).toBeVisible();
  await box.fill("plano de contas"); await res.getByRole("option", { name: /Plano de Contas/ }).first().click();
  await expect(page).toHaveURL(/\/configuracoes\?tab=financeiro&sub=chart-accounts/);
  await box.fill("dfe"); await expect(res.getByRole("option", { name: /DFe/ }).first()).toBeVisible(); await page.keyboard.press("Escape");
  // operador de estoque: funções financeiras não aparecem na busca
  await logout(page);
  await login(page, { email: "operador@demo.local", password: "Demo@12345" });
  await page.getByLabel("Buscar funcionalidade").fill("plano de contas"); await expect(page.getByTestId("nav-search-results")).toHaveCount(0);
  await page.getByLabel("Buscar funcionalidade").fill("requisi"); await expect(page.getByTestId("nav-search-results").getByRole("option", { name: /Requisições/ }).first()).toBeVisible();
});
test("favoritos guardam tab + sub e favoritos antigos continuam abrindo o local certo", async ({ page }) => {
  await login(page);
  await page.goto("/estoque?tab=recebimentos&sub=dfe");
  await page.getByLabel("Favoritos").click(); await page.getByRole("menuitem", { name: "Adicionar esta tela aos favoritos" }).click(); await expect(page.locator("[data-sonner-toast]").first()).toContainText("Favoritos");
  await page.goto("/"); await page.getByLabel("Favoritos").click(); await page.getByRole("menuitem", { name: /DFe \/ XML recebidos/ }).click();
  await expect(page).toHaveURL(/\/estoque\?tab=recebimentos&sub=dfe/);
  await page.getByLabel("Favoritos").click(); await page.getByRole("menuitem", { name: "Remover esta tela dos favoritos" }).click(); // remove
  // favorito antigo (V1, `tab=saidas&sub=requisicoes`) abre a rota canonicalizada
  await page.goto("/estoque?tab=saidas&sub=requisicoes"); await expect(page).toHaveURL(/tab=operacoes.*sub=requisicoes/);
});
test("compras: uma lista com escopo (Todos/Meus) e etapa como filtro; permissões nos chips", async ({ page }) => {
  await login(page);
  await page.goto("/compras?tab=processos");
  await expect(page.getByRole("tab", { name: /Solicitações/ })).toHaveCount(0);
  await page.getByTestId("supply-scope").getByRole("radio", { name: "Meus" }).click(); await expect(page).toHaveURL(/scope=mine/);
  await page.getByTestId("supply-stage").getByRole("radio", { name: /^Cotações/ }).click(); await expect(page).toHaveURL(/stage=quotation/);
  await expect(page.locator("table")).toBeVisible();
  await page.getByTestId("supply-stage").getByRole("radio", { name: /^Todos/ }).click(); await expect(page).not.toHaveURL(/stage=/);
});
test("ordens de serviço: uma lista com Todas/Minhas, status e atrasadas", async ({ page }) => {
  await login(page);
  await page.goto("/os");
  await expect(page.getByRole("tab", { name: "Minhas" })).toHaveCount(0);
  await page.getByTestId("os-scope").getByRole("radio", { name: "Minhas" }).click(); await expect(page).toHaveURL(/scope=mine/);
  await page.getByTestId("os-status").getByRole("radio", { name: /Em andamento/ }).click(); await expect(page).toHaveURL(/status=in_progress/);
  await page.getByTestId("os-late").click(); await expect(page).toHaveURL(/late=1/);
  await expect(page.locator("table")).toBeVisible();
});
test("pecuária: pesquisa de animal, filtro de movimentação, filtro de manejo e ações contextuais", async ({ page }) => {
  await login(page);
  await page.goto("/pecuaria?tab=rebanho&sub=animais");
  await expect(page.getByLabel("Identificação (brinco, SISBOV, chip, nome)")).toBeVisible(); await expect(page.getByTestId("animals-locate")).toBeVisible();
  await expect(page.getByRole("tab", { name: /Buscar animal/ })).toHaveCount(0); await expect(page.getByRole("tab", { name: /Movimentar Rebanho/ })).toHaveCount(0);
  await page.getByRole("tab", { name: "Movimentações" }).click(); await page.getByTestId("mov-type").getByRole("radio", { name: "Venda" }).click(); await expect(page).toHaveURL(/type=sale/); await expect(page.locator("table")).toBeVisible();
  await page.getByRole("tab", { name: "Manejos" }).click(); await page.getByTestId("handling-kind").getByRole("radio", { name: "Pesagens" }).click(); await expect(page).toHaveURL(/type=weighing/); await expect(page.getByTestId("handling-type")).toHaveCount(0);
  await page.getByRole("tab", { name: "Rebanho" }).click(); await page.getByRole("tab", { name: "Lotes" }).click();
  const row = page.getByTestId("b1-row").first();
  if (await row.count()) { await row.click(); await page.getByLabel("Mais opções").click(); await expect(page.getByRole("menuitem", { name: /Mover de local/ })).toBeVisible(); await page.getByRole("menuitem", { name: /Mover de local/ }).click(); await expect(page.getByRole("dialog").getByRole("heading", { name: "Mover lote de local" })).toBeVisible(); await page.keyboard.press("Escape"); }
});
test("relatórios: busca, filtro de módulo, favoritos e personalizados numa única área", async ({ page }) => {
  await login(page);
  await page.goto("/relatorios");
  await expect(page.getByRole("tab", { name: "Estoque" })).toHaveCount(0);
  await page.getByTestId("reports-search").fill("estoque"); await expect(page.getByRole("link", { name: /estoque/i }).first()).toBeVisible();
  await page.getByTestId("reports-view").getByRole("radio", { name: /Favoritos/ }).click(); await expect(page).toHaveURL(/view=favoritos/);
  await page.getByTestId("reports-view").getByRole("radio", { name: "Personalizados" }).click(); await expect(page).toHaveURL(/view=personalizados/);
});
