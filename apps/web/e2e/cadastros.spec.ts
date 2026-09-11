import { test, expect } from "@playwright/test";
import { login, uniq } from "./helpers";
/** Preenche todos os RefSelect obrigatórios do formulário com a primeira opção disponível. */
async function fillRequiredRefs(page: import("@playwright/test").Page) {
  const labels = page.locator("label:has(span.text-red-500)");
  const n = await labels.count();
  for (let i = 0; i < n; i++) {
    const field = labels.nth(i).locator("..");
    const btn = field.locator("button[type=button]").first();
    if (await btn.count() && (await btn.textContent())?.includes("Selecione")) { await btn.click(); await page.locator(".cmd-panel [role=option]").first().click(); }
  }
}
test("cria e localiza um produto no cadastro genérico", async ({ page }) => {
  await login(page); const name = uniq("Produto E2E");
  await page.goto("/cadastros/products/new");
  await page.getByLabel(/^Descrição/).first().fill(name);
  await fillRequiredRefs(page);
  // categoria financeira é obrigatória quando o produto controla estoque (regra de negócio); o campo fica na aba "Estoque"
  const estoqueTab = page.getByRole("tab", { name: "Estoque" }); if (await estoqueTab.count()) await estoqueTab.click();
  await page.locator("label", { hasText: "Cat. Financeira" }).first().locator("..").locator("button[type=button]").first().click(); await page.locator(".cmd-panel [role=option]").first().click();
  await page.getByRole("button", { name: /^Salvar/ }).click();
  const toast = page.locator("[data-sonner-toast]").first();
  await Promise.race([page.waitForURL(/\/cadastros\/products$/), toast.waitFor()]);
  if ((await toast.textContent())?.includes("sucesso")) await page.waitForURL(/\/cadastros\/products$/);
  if (!/\/cadastros\/products$/.test(page.url())) throw new Error("Falha ao salvar: " + (await toast.textContent()) + " | erros: " + (await page.locator("p.text-red-600").allTextContents()).join("; "));
  await page.getByLabel("Pesquisar", { exact: true }).click(); await page.getByPlaceholder(/^Pesquisar por/).fill(name); await page.keyboard.press("Enter");
  await expect(page.locator("tbody").getByText(name).first()).toBeVisible();
});
