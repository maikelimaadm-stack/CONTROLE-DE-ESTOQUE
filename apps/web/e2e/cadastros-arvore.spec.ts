import { test, expect } from "@playwright/test";
import { login, api } from "./helpers";

/**
 * Cadastros em árvore na tela: a listagem recua pelo nível e recolhe o ramo; o formulário novo sugere o
 * código a partir do antecessor. Base: Categorias Financeiras do seed (RECEITAS = "1", filhos 1.01 e 1.02).
 */
test("A1 — listagem em árvore: recuo, sintético em destaque e recolher/expandir o ramo", async ({ page }) => {
  await login(page);
  await page.goto("/cadastros/financial_categories");
  const pai = page.locator("tbody tr", { hasText: "RECEITAS" }).first();
  const filho = page.locator("tbody tr", { hasText: "Receitas da Pecuária" }).first();
  await expect(pai).toBeVisible(); await expect(filho).toBeVisible();
  const botao = pai.getByTestId("arvore-alternar");
  await expect(botao).toHaveAttribute("aria-expanded", "true");
  await botao.click();
  await expect(filho).toBeHidden();
  await expect(botao).toHaveAttribute("aria-expanded", "false");
  await botao.click();
  await expect(filho).toBeVisible();
});

test("A2 — novo registro com antecessor: o código vem sugerido e continua editável", async ({ page }) => {
  await login(page);
  const r = await api<{ items: { id: string; code: string }[] }>(page, "GET", "/api/resources/financial_categories?code=1");
  const raiz = r.items.find((x) => x.code === "1");
  expect(raiz, "a raiz RECEITAS do seed").toBeTruthy();
  const s = await api<{ codigo: string }>(page, "GET", `/api/resources/financial_categories/proximo-codigo?parent_id=${raiz!.id}`);
  expect(s.codigo).toMatch(/^1\.\d{2}$/);
  await page.goto(`/cadastros/financial_categories/new?parent_id=${raiz!.id}`);
  const codigo = page.getByLabel(/^Código/).first();
  await expect(codigo).toHaveValue(s.codigo);
  await codigo.fill("1.99");
  await expect(codigo).toHaveValue("1.99");
});
