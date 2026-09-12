import { test, expect } from "@playwright/test";
import { login } from "./helpers";
/** Compactação V2: menu só com módulos, rotas antigas (V1 e anteriores) canonicalizadas, abas montadas por permissão. */
test("rotas antigas redirecionam para a rota canônica preservando parâmetros (aliases importantes)", async ({ page }) => {
  await login(page);
  const has = async (...parts: RegExp[]) => { for (const p of parts) await expect(page).toHaveURL(p); };
  await page.goto("/estoque/transferencias?kind=farm"); await has(/\/estoque\?/, /tab=operacoes/, /sub=transferencias/, /kind=farm/);
  await page.goto("/financeiro/contas-a-pagar?status=overdue"); await has(/\/financeiro\?/, /tab=contas/, /sub=pagar/, /status=overdue/);
  await page.goto("/suprimentos/mine"); await expect(page).toHaveURL(/\/compras\?tab=processos&scope=mine/);
  await page.goto("/suprimentos/quotation"); await expect(page).toHaveURL(/\/compras\?tab=processos&stage=quotation/);
  await page.goto("/pecuaria/movimentacoes/sale"); await expect(page).toHaveURL(/\/pecuaria\?tab=movimentacoes&type=sale/);
  await page.goto("/pecuaria/localizar"); await expect(page).toHaveURL(/\/pecuaria\?tab=rebanho&sub=animais&locate=1/); await expect(page.getByRole("dialog").getByRole("heading", { name: "Localizar animal" }).first()).toBeVisible();
  await page.goto("/dashboards/estoque-nutricao"); await expect(page).toHaveURL(/\/confinamento\?tab=desempenho&view=nutricao/);
  await page.goto("/admin/usuarios"); await expect(page).toHaveURL(/\/configuracoes\?tab=usuarios&sub=usuarios/);
  await page.goto("/dashboards/financeiro"); await expect(page).toHaveURL(/\/financeiro\?tab=visao-geral/);
  await page.goto("/os/monitoramento"); await expect(page).toHaveURL(/\/os\?late=1/);
  // abas/sub-abas da V1 (favoritos e links salvos) são canonicalizadas no cliente, preservando os demais parâmetros
  await page.goto("/estoque?tab=saidas&sub=requisicoes&x=1"); await has(/\/estoque\?/, /tab=operacoes/, /sub=requisicoes/, /x=1/);
  await page.goto("/financeiro?tab=tesouraria&sub=extrato"); await has(/\/financeiro\?/, /tab=caixa/, /sub=extrato/);
  await page.goto("/pecuaria?tab=movimentar&sub=animais-lote"); await has(/\/pecuaria\?/, /tab=rebanho/, /sub=transferencias/, /action=animais-lote/);
  await page.goto("/frota?tab=maquinas&sub=familias"); await has(/\/configuracoes\?/, /tab=frota/, /sub=equipment-families/);
  await page.goto("/fiscal?tab=situacao"); await has(/\/configuracoes\?/, /tab=fiscal/, /sub=capacidades/);
});
test("área de estoque: abas, seletor interno, '+ Novo' em dois níveis e ajuste contextual a partir do saldo", async ({ page }) => {
  await login(page);
  await page.goto("/estoque?tab=estoque&sub=saldo");
  await expect(page.getByRole("tab", { name: "Estoque", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("table")).toBeVisible();
  const rowAction = page.getByRole("button", { name: "Ajustar estoque" }).first();
  if (await rowAction.count()) { await rowAction.click(); await expect(page.getByRole("dialog").getByRole("heading", { name: "Ajustar estoque" })).toBeVisible(); await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toBeHidden(); }
  // "+ Novo": primeiro nível só com grupos; Ajuste e Devolução não são opções cotidianas
  await page.getByTestId("ws-new").click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Saída" })).toBeVisible(); await expect(menu.getByRole("menuitem", { name: /Ajuste/ })).toHaveCount(0); await expect(menu.getByRole("menuitem", { name: /Devolução/ })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "Saída" }).click(); await expect(menu.getByRole("menuitem", { name: "Requisição" })).toBeVisible(); await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Operações" }).click(); await expect(page).toHaveURL(/tab=operacoes/);
  await page.getByRole("tab", { name: /Saídas diretas/ }).click(); await expect(page).toHaveURL(/sub=diretas/);
  await page.getByRole("tab", { name: "Transferências" }).click(); await page.getByTestId("stock-transfer-kind").getByRole("radio", { name: "Entre fazendas" }).click(); await expect(page).toHaveURL(/kind=farm/);
});
test("menu principal: só módulos (≤ 14), sem abas repetidas; breadcrumbs derivados da navegação", async ({ page }) => {
  await login(page);
  await page.getByLabel("Fixar menu").click();
  const nav = page.getByRole("navigation", { name: "Menu principal" });
  const modules = nav.getByTestId("nav-module"); const n = await modules.count(); expect(n).toBeGreaterThanOrEqual(10); expect(n).toBeLessThanOrEqual(13);
  await expect(nav.getByText("Cadastros Base")).toHaveCount(0); await expect(nav.getByText("Saldo e Movimentações")).toHaveCount(0); await expect(nav.getByText("Entradas e Recebimentos")).toHaveCount(0);
  for (const m of ["Compras", "Estoque", "Financeiro", "Vendas", "Pecuária", "Confinamento", "Frota e Ativos", "Pessoas e RH", "Ordens de Serviço", "Fiscal", "Relatórios", "Configurações"]) await expect(modules.filter({ hasText: m }).first()).toBeVisible();
  await page.goto("/configuracoes?tab=financeiro&sub=chart-accounts");
  const crumbs = page.getByRole("navigation", { name: "Navegação" }); await expect(crumbs).toContainText("Configurações"); await expect(crumbs).toContainText("Financeiro"); await expect(crumbs).toContainText("Plano de Contas");
  await expect(page.locator("table")).toBeVisible();
});
test("permissões: operador de estoque não vê o módulo Financeiro; Estoque aparece com permissão parcial e as abas respeitam permissões", async ({ page }) => {
  await login(page, { email: "operador@demo.local", password: "Demo@12345" });
  await page.getByLabel("Fixar menu").click();
  const nav = page.getByRole("navigation", { name: "Menu principal" });
  await expect(nav.getByTestId("nav-module").filter({ hasText: "Financeiro" })).toHaveCount(0);
  await expect(nav.getByTestId("nav-module").filter({ hasText: "Estoque" })).toHaveCount(1);
  await page.goto("/financeiro?tab=contas"); await expect(page.getByText(/Sem permissão/)).toBeVisible();
  // operador só tem Requisições dentro de Operações: o seletor interno some (uma única fonte) e a lista abre direto
  await page.goto("/estoque?tab=operacoes"); await expect(page.getByRole("tab", { name: "Operações" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("columnheader", { name: "Solicitante" })).toBeVisible(); await expect(page.getByRole("tab", { name: /Saídas diretas/ })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /Fábrica/ })).toHaveCount(0);
});
