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

// AJUSTES 01 (D-1): o código das árvores é GERADO no servidor — o formulário Novo mostra "será gerado ao salvar:
// <código>" e não deixa digitar (antes: sugerido e editável).
test("A2 — novo registro com antecessor: o código vem previsto pelo servidor e não é digitável", async ({ page }) => {
  await login(page);
  const r = await api<{ items: { id: string; code: string }[] }>(page, "GET", "/api/resources/financial_categories?code=1");
  const raiz = r.items.find((x) => x.code === "1");
  expect(raiz, "a raiz RECEITAS do seed").toBeTruthy();
  const s = await api<{ codigo: string }>(page, "GET", `/api/resources/financial_categories/proximo-codigo?parent_id=${raiz!.id}`);
  expect(s.codigo).toMatch(/^1\.\d{2}$/);
  await page.goto(`/cadastros/financial_categories/new?parent_id=${raiz!.id}`);
  await expect(page.getByText(`será gerado ao salvar: ${s.codigo}`), "prévia do código no Novo (D-1)").toBeVisible();
  const codigo = page.getByLabel(/^Código/);
  if (await codigo.count()) await expect(codigo.first()).not.toBeEditable();
});
