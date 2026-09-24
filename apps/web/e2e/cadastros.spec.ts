import { test, expect } from "@playwright/test";
import { login, uniq } from "./helpers";
/**
 * Preenche os RefSelect obrigatórios VISÍVEIS com a primeira opção disponível. Campo de outra aba (ex.: a Natureza
 * de custo, obrigatória enquanto "Controla estoque" = Sim, fica na aba "Custos e venda") é preenchido pelo próprio teste.
 */
async function fillRequiredRefs(page: import("@playwright/test").Page) {
  const labels = page.locator("label:has(span.text-red-500)");
  const n = await labels.count();
  for (let i = 0; i < n; i++) {
    const field = labels.nth(i).locator("..");
    const btn = field.locator("button[type=button]").first();
    if (await btn.count() && await btn.isVisible() && (await btn.textContent())?.includes("Selecione")) { await btn.click(); await page.locator(".cmd-panel [role=option]").first().click(); }
  }
}
test("cria e localiza um produto no cadastro genérico", async ({ page }) => {
  await login(page); const name = uniq("Produto E2E");
  await page.goto("/cadastros/products/new");
  await page.getByLabel(/^Descrição/).first().fill(name);
  await fillRequiredRefs(page);
  // a Natureza de custo é obrigatória quando o produto controla estoque (regra de negócio); na ficha em abas
  // (Fase 6) o campo fica na aba "Custos e venda"
  await page.getByRole("tab", { name: "Custos e venda", exact: true }).click();
  await page.locator("label", { hasText: "Natureza de custo" }).first().locator("..").locator("button[type=button]").first().click(); await page.locator(".cmd-panel [role=option]").first().click();
  await page.getByRole("button", { name: /^Salvar/ }).click();
  const toast = page.locator("[data-sonner-toast]").first();
  await Promise.race([page.waitForURL(/\/cadastros\/products$/), toast.waitFor()]);
  if ((await toast.textContent())?.includes("sucesso")) await page.waitForURL(/\/cadastros\/products$/);
  if (!/\/cadastros\/products$/.test(page.url())) throw new Error("Falha ao salvar: " + (await toast.textContent()) + " | erros: " + (await page.locator("p.text-red-600").allTextContents()).join("; "));
  await page.getByLabel("Pesquisar", { exact: true }).click(); await page.getByPlaceholder(/^Pesquisar por/).fill(name); await page.keyboard.press("Enter");
  await expect(page.locator("tbody").getByText(name).first()).toBeVisible();
});
