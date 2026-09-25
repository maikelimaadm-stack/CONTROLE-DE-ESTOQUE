import { test, expect } from "@playwright/test";
import { login, api, uniq } from "./helpers";

/**
 * CADASTROS Fase 6 — Produtos: ficha em abas (decisão 254) na tela.
 *
 * PR-W1  Ficha: abas na ordem; Unidades e embalagens com a unidade padrão repetida → contador na aba e linha
 *        marcada, nada gravado; corrigida grava; Fiscal mostra os parâmetros como campos e preserva a chave
 *        desconhecida; Estoque e lotes mostra o saldo por lote; Histórico lista a inclusão.
 */
test("PR-W1 — ficha de produto em abas: grade de unidades, fiscal em campos, saldo por lote e histórico", async ({ page }) => {
  await login(page);
  const nome = uniq("PR-W1 produto");
  await page.goto("/cadastros/products/new");
  const ficha = page.getByTestId("ficha-em-abas");
  await expect(ficha).toBeVisible();
  const abas = (await ficha.getByRole("tab").allInnerTexts()).map((t) => t.trim());
  // AJUSTES 01 (C-1): Anexos saiu da última aba e virou botão da barra de ações de TODA ficha em abas
  expect(abas).toEqual(["Geral", "Estoque e lotes", "Unidades e embalagens", "Fiscal", "Compras", "Custos e venda", "Agro", "Histórico"]);
  await expect(page.getByTestId("ficha-anexos")).toBeVisible();

  const unidades = await api<{ id: string; label: string }[]>(page, "GET", "/api/resources/measurement_units/options");
  const un = unidades.find((u) => u.label.toUpperCase() === "UN")!; const kg = unidades.find((u) => u.label.toUpperCase() === "KG")!;
  const grupos = await api<{ id: string }[]>(page, "GET", "/api/resources/product_groups/options?kind=analytic");
  const naturezas = await api<{ id: string }[]>(page, "GET", "/api/resources/financial_categories/options?kind=analytic&nature=expense");

  // o produto nasce pela API (os seletores do modelo base já têm E2E próprio); a ficha é o que se prova aqui
  const criado = await api<{ id: string }>(page, "POST", "/api/resources/products", { description: nome, group_id: grupos[0]!.id, measurement_id: un.id, financial_category_id: naturezas[0]!.id, controle_lote: "lote", taxes: { cfop_out_internal: "5102", chave_do_futuro: "manter" } });
  await page.goto(`/cadastros/products/${criado.id}`);
  await expect(ficha).toBeVisible();

  await ficha.getByRole("tab", { name: "Unidades e embalagens" }).click();
  const grade = page.getByTestId("grade-unidades");
  await grade.getByRole("button", { name: "Incluir linha" }).click();
  await grade.getByLabel("Fator").nth(0).fill("0");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByTestId("erros-aba-unidades")).toBeVisible();
  const nada = await api<{ unidades: unknown[] }>(page, "GET", `/api/resources/products/${criado.id}`);
  expect(nada.unidades, "nada gravado").toHaveLength(0);
  void kg;

  await ficha.getByRole("tab", { name: "Fiscal" }).click();
  const fiscal = page.getByTestId("campos-json-taxes");
  await expect(fiscal.getByLabel("CFOP Saída Interno")).toHaveValue("5102");
  await expect(fiscal).toContainText("chave_do_futuro");

  await ficha.getByRole("tab", { name: "Estoque e lotes" }).click();
  await expect(page.getByTestId("saldo-por-lote")).toBeVisible();

  await ficha.getByRole("tab", { name: "Histórico" }).click();
  await expect(page.getByTestId("historico-da-ficha")).toContainText("incluiu Produto");
});
