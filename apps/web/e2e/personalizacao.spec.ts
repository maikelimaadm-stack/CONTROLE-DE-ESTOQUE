import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("listagem personalizável: coluna oculta, modo cards e filtro salvo persistem após recarregar", async ({ page }) => {
  await login(page);
  await page.goto("/cadastros/warehouses");
  // garante estado inicial (remove personalização de execuções anteriores)
  await page.getByTitle("Configurar colunas, filtros e visualização").click();
  await page.getByRole("dialog").getByRole("button", { name: "Restaurar padrão" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await page.getByRole("dialog").locator("button", { hasText: "Fechar" }).click();
  await expect(page.locator("table")).toBeVisible();
  await expect(page.locator("th", { hasText: "Sigla" })).toBeVisible();
  // oculta a coluna NCM
  await page.getByTitle("Configurar colunas, filtros e visualização").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Exibir Sigla").uncheck();
  await dialog.locator("button", { hasText: "Fechar" }).click();
  await expect(page.locator("th", { hasText: "Sigla" })).toHaveCount(0);
  // modo cards
  await page.getByTitle("Configurar colunas, filtros e visualização").click();
  await dialog.getByRole("tab", { name: "Visualização" }).click();
  await dialog.locator("select").nth(1).selectOption("cards");
  await dialog.locator("button", { hasText: "Fechar" }).click();
  await expect(page.locator("dl").first()).toBeVisible();
  // filtro salvo (pesquisa textual + operador booleano)
  await page.getByLabel(/^Pesquisar por/).fill("Almox");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.locator("dl").first()).toBeVisible();
  await page.getByRole("button", { name: /Filtros salvos/ }).click();
  await page.getByRole("menuitem", { name: "Salvar filtro atual…" }).click();
  await page.getByLabel("Nome do filtro").fill("Almoxarifados");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.locator("[data-sonner-toast]").first()).toContainText("salvo");
  // recarrega sem cache local: preferências vêm do servidor
  await page.waitForTimeout(800);
  await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith("agro:prefs:")).forEach((k) => localStorage.removeItem(k)); });
  await page.reload();
  await expect(page.locator("dl").first()).toBeVisible();
  await expect(page.locator("th", { hasText: "Sigla" })).toHaveCount(0);
  await page.getByRole("button", { name: /Filtros salvos \(1\)/ }).click();
  await expect(page.getByRole("menuitem", { name: "Aplicar: Almoxarifados" })).toBeVisible();
  await page.keyboard.press("Escape");
  // restaura o padrão
  await page.getByTitle("Configurar colunas, filtros e visualização").click();
  await dialog.getByRole("button", { name: "Restaurar padrão" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.locator("table").first()).toBeVisible();
  await expect(page.locator("th", { hasText: "Sigla" })).toBeVisible();
});
