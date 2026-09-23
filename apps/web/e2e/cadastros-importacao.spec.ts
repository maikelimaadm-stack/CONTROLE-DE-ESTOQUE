import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * Importação na tela: o menu "Mais opções" do cadastro traz "Baixar modelo de importação" (baixa o XLSX)
 * e "Importar planilha" (abre o diálogo com a prévia). O processamento é coberto pela integração da API.
 */
test("M1 — o cadastro oferece baixar o modelo e importar planilha", async ({ page }) => {
  await login(page);
  await page.goto("/cadastros/financial_categories");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await page.getByRole("button", { name: "Mais opções" }).first().click();
  const [arquivo] = await Promise.all([page.waitForEvent("download"), page.getByText("Baixar modelo de importação").click()]);
  expect(arquivo.suggestedFilename()).toBe("modelo-financial_categories.xlsx");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Importar planilha")).toBeHidden();
  await page.getByRole("button", { name: "Mais opções" }).first().click();
  await page.getByText("Importar planilha").click();
  await expect(page.getByTestId("importar-dialogo")).toBeVisible();
  await expect(page.getByTestId("importar-arquivo")).toBeAttached();
});
