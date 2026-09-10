import { test, expect } from "@playwright/test";
import { login, uniq } from "./helpers";
test("solicitação de compra percorre o fluxo até aguardando compra", async ({ page }) => {
  await login(page); const desc = uniq("Compra E2E");
  await page.goto("/suprimentos/new");
  await page.getByLabel(/^Tipo/).selectOption("service");
  await page.getByLabel(/^Descrição/).first().fill(desc); await page.getByLabel(/^Justificativa/).fill("Teste automatizado");
  await page.locator("tbody tr").first().locator("input").first().fill("Serviço de teste");
  await page.locator("tbody tr").first().locator("input[type=number]").nth(1).fill("100");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page).toHaveURL(/\/suprimentos\/view\//);
  await expect(page.getByText("Solicitação", { exact: true }).first()).toBeVisible();
  const steps: [string, string][] = [["Enviar para ciência", "Aguardando Ciência"], ["Dar ciência", "Cotação em Andamento"], ["Enviar para autorização", "Aguardando Aprovação"], ["Aprovar", "Aguardando a Compra"]];
  for (const [action, status] of steps) {
    await page.getByRole("button", { name: action, exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText(status, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText("Aguardando a Compra").first()).toBeVisible();
  await page.getByRole("tab", { name: /Histórico/ }).click();
  await expect(page.locator("tbody tr")).toHaveCount(5);
});
