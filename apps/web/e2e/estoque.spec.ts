import { test, expect } from "@playwright/test";
import { login, pickRef } from "./helpers";
test("entrada de insumos gera saldo e ledger; cancelamento estorna", async ({ page }) => {
  await login(page);
  await page.goto("/estoque/entradas/new");
  await page.getByRole("button", { name: "Adicionar item" }).click();
  const row = page.locator("tbody tr").first();
  await row.locator("button").nth(0).click(); await page.getByPlaceholder("Pesquisar...").fill("Almox"); await page.getByRole("option", { name: /Almox/i }).first().click();
  await row.locator("button").nth(1).click(); await page.getByPlaceholder("Pesquisar...").fill("Diesel"); await page.getByRole("option", { name: /Diesel/i }).first().click();
  await row.locator("input[type=number]").nth(0).fill("10"); await row.locator("input[type=number]").nth(1).fill("6.5");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page).toHaveURL(/\/estoque\/entradas$/);
  await page.locator("tbody tr").first().dblclick();
  await expect(page.getByText("Movimentações de estoque (ledger)")).toBeVisible();
  await expect(page.locator("tbody tr", { hasText: "Entrada" }).first()).toBeVisible();
  await page.getByRole("button", { name: /Cancelar documento/ }).click(); await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByText("Estornado").or(page.getByText("Cancelado")).first()).toBeVisible();
  await expect(page.locator("tbody tr", { hasText: "reversal" }).or(page.locator("tbody tr", { hasText: "Estorno" })).first()).toBeVisible();
});
test("saldo de estoque lista produtos por armazém", async ({ page }) => {
  await login(page); await page.goto("/estoque/saldo"); await expect(page.getByText(/Saldo/i).first()).toBeVisible(); await expect(page.locator("table")).toBeVisible();
});
