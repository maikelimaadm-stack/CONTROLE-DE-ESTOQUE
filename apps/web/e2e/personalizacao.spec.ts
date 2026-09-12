import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/** MODELO BASE1: listagem (chips de filtro, colunas, cards), modo Registro, configuração de layout e relatórios. */
async function restoreScreen(page: import("@playwright/test").Page) {
  await page.getByLabel("Mais opções").click();
  await page.getByRole("menuitem", { name: "Restaurar padrão da tela" }).click();
  await expect(page.locator("[data-sonner-toast]").first()).toContainText("restaurada");
  await page.waitForTimeout(500);
}

test("listagem MODELO BASE1: chip de filtro com valores distintos, coluna oculta e modo cards persistem", async ({ page }) => {
  await login(page);
  await page.goto("/cadastros/warehouses");
  await expect(page.getByTestId("b1-list")).toBeVisible();
  await restoreScreen(page);
  await expect(page.locator("th", { hasText: "Sigla" })).toBeVisible();
  // chip de filtro: seleção de valores distintos ("Está na lista")
  await page.getByRole("button", { name: "Filtro Tipo" }).click();
  const pop = page.locator("[data-radix-popper-content-wrapper]").last();
  await expect(pop.getByText("Limpar Filtro de 'Tipo'")).toBeVisible();
  const first = pop.locator("label").nth(1); const firstLabel = (await first.innerText()).trim();
  await first.click();
  await pop.getByRole("button", { name: "OK" }).click();
  await expect(page.getByRole("button", { name: "Filtro Tipo" })).toContainText(firstLabel.split("\n")[0]!);
  await expect(page.getByText(/Filtrados: \d+/)).toBeVisible();
  await page.getByLabel("Limpar todos os filtros").click();
  // oculta a coluna Sigla pelo menu da coluna
  await page.getByLabel("Abrir menu da coluna Sigla").click();
  await page.getByRole("menuitem", { name: "Ocultar coluna" }).click();
  await expect(page.locator("th", { hasText: "Sigla" })).toHaveCount(0);
  // configuração de colunas: coluna volta pela lista "disponíveis"
  await page.getByLabel("Configurar colunas da tabela").click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByText("Configuração de colunas")).toBeVisible();
  await dlg.getByRole("button", { name: "Sigla" }).dblclick();
  await dlg.getByRole("button", { name: "OK" }).click();
  await expect(page.locator("th", { hasText: "Sigla" })).toBeVisible();
  await page.getByLabel("Abrir menu da coluna Sigla").click();
  await page.getByRole("menuitem", { name: "Ocultar coluna" }).click();
  // modo cards + cards por linha — espera o PUT de preferências com o modo "cards" chegar ao servidor antes de recarregar
  const saved = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes("/api/preferences/") && r.ok() && (r.request().postData() ?? "").includes("cards"));
  await page.getByRole("button", { name: "Cards", exact: true }).click();
  await expect(page.getByTestId("b1-card").first()).toBeVisible();
  await page.getByLabel("Configurar layout dos cards").click();
  await page.getByRole("radio", { name: /2 cards por linha/ }).click();
  await page.getByRole("button", { name: "OK" }).click();
  await saved;
  // recarrega sem cache local: preferências vêm do servidor
  await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith("agro:prefs:")).forEach((k) => localStorage.removeItem(k)); });
  await page.reload();
  await expect(page.getByTestId("b1-card").first()).toBeVisible();
  await page.getByRole("button", { name: "Tabela", exact: true }).click();
  await expect(page.locator("th", { hasText: "Sigla" })).toHaveCount(0);
  await restoreScreen(page);
  await expect(page.locator("th", { hasText: "Sigla" })).toBeVisible();
});

test("modo Registro: abre o formulário embutido, navega entre registros e edita", async ({ page }) => {
  await login(page);
  await page.goto("/cadastros/warehouses");
  await expect(page.getByTestId("b1-list")).toBeVisible();
  await page.getByTestId("b1-row").first().locator("td").nth(2).dblclick();
  await expect(page.getByTestId("b1-form")).toBeVisible();
  await expect(page.getByText(/^1\/\d+$/)).toBeVisible();
  await page.getByLabel("Próximo").click();
  await expect(page.getByText(/^2\/\d+$/)).toBeVisible();
  await page.getByRole("button", { name: "Editar" }).click();
  await expect(page.getByRole("button", { name: "Salvar" })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("button", { name: "Editar" })).toBeVisible();
  await page.getByRole("button", { name: "Tabela", exact: true }).click();
  await expect(page.getByTestId("b1-row").first()).toBeVisible();
});

test("configuração de layout: retira campo, renomeia rótulo e restaura padrão", async ({ page }) => {
  await login(page);
  await page.goto("/cadastros/warehouses/configuracao-layout");
  await expect(page.getByTestId("layout-config")).toBeVisible();
  await page.getByRole("button", { name: "Restaurar padrão" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await page.getByRole("button", { name: "Editar" }).click();
  // seleciona o campo "Ativo" e o retira do formulário; renomeia "Sigla"
  await page.getByRole("button", { name: "Ativo", exact: true }).click();
  await page.getByRole("button", { name: "Retirar do formulário" }).click();
  await expect(page.getByText("Campos disponíveis").locator("..").getByRole("button", { name: "Ativo", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sigla", exact: true }).click();
  await page.getByLabel("Rótulo exibido").fill("Sigla do armazém");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await page.waitForTimeout(800);
  await page.goto("/cadastros/warehouses/new");
  await expect(page.getByLabel(/^Sigla do armazém/)).toBeVisible();
  await expect(page.getByLabel(/^Ativo/)).toHaveCount(0);
  await page.goto("/cadastros/warehouses/configuracao-layout");
  await page.getByRole("button", { name: "Restaurar padrão" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await page.goto("/cadastros/warehouses/new");
  await expect(page.getByLabel(/^Sigla/).first()).toBeVisible();
  await expect(page.getByLabel(/^Ativo/)).toBeVisible();
});

test("relatório personalizado: prévia agrupada, salvar e listar", async ({ page }) => {
  await login(page);
  await page.goto("/relatorios/personalizados/novo?resource=warehouses");
  await expect(page.getByLabel("Entidade")).toHaveValue("warehouses");
  await page.getByLabel("Agrupar por").selectOption("type");
  await page.getByRole("button", { name: "Gerar prévia" }).click();
  await expect(page.locator("table").last().locator("tbody tr").first()).toBeVisible();
  await expect(page.getByText(/linha\(s\)/)).toBeVisible();
  const name = `Armazéns por tipo ${Date.now().toString(36).slice(-4)}`;
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await page.getByLabel("Nome").fill(name);
  await page.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
  await expect(page.locator("[data-sonner-toast]").first()).toContainText("Relatório salvo");
  await page.goto("/relatorios/personalizados");
  await expect(page.getByRole("link", { name })).toBeVisible();
});
