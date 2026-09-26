import { test, expect } from "@playwright/test";
import { api, login, uniq } from "./helpers";
import { criarParceiro, estaTravada, rotulosEmOrdem } from "./aj02-comum";

/**
 * AJUSTES 02 · 19 — o Cadastro rápido do parceiro mostra Cidade · Código IBGE · UF; a lista de Parceiros mostra a
 * cidade pelo NOME ("Pontes e Lacerda - MT"), a partir do `city_id_nome` da API.
 */
test("AJ02-19a — Cadastro rápido de parceiro: Cidade · Código IBGE · UF (código e UF só leitura)", async ({ page }) => {
  await login(page);
  await page.goto("/pecuaria/animais/new");
  const campo = page.locator("label", { hasText: "Fornecedor de origem" }).first().locator("..").locator("[aria-expanded]").first();
  await campo.click();
  await page.getByRole("button", { name: /Cadastrar parceiro/ }).click();
  const rapido = page.getByTestId("cadastro-rapido");
  await expect(rapido).toBeVisible();
  const rotulos = await rotulosEmOrdem(rapido);
  const i = rotulos.indexOf("Cidade");
  expect(i, `premissa: a Cidade está no cadastro rápido (${rotulos.join(" · ")})`).toBeGreaterThanOrEqual(0);
  expect(rotulos.slice(i, i + 3), "Cidade · Código IBGE · UF, lado a lado e nessa ordem").toEqual(["Cidade", "Código IBGE", "UF"]);
  for (const t of ["cidade-busca", "cidade-ibge", "cidade-uf"]) await expect(rapido.getByTestId(t), t).toHaveCount(1);
  expect(await estaTravada(rapido.getByTestId("cidade-ibge")), "Código IBGE só leitura").toBe(true);
  expect(await estaTravada(rapido.getByTestId("cidade-uf")), "UF só leitura").toBe(true);
});

test("AJ02-19b — lista de Parceiros: coluna Cidade com \"Pontes e Lacerda - MT\" (API devolve city_id_nome)", async ({ page }) => {
  await login(page);
  const nome = uniq("AJ02-19 parceiro");
  await criarParceiro(page, { name: nome, city_id: 5106752 });
  const lista = await api<{ items: Record<string, unknown>[] }>(page, "GET", `/api/resources/people?search=${encodeURIComponent(nome)}`);
  expect(lista.items, "premissa: exatamente o parceiro criado").toHaveLength(1);
  expect(lista.items[0]!["city_id_nome"], "a API devolve o nome da cidade").toBe("Pontes e Lacerda - MT");

  await page.goto("/configuracoes?tab=parceiros");
  await page.getByPlaceholder(/^Pesquisar/).first().fill(nome);
  const linha = page.getByRole("row").filter({ hasText: nome });
  await expect(linha, "a busca da lista acha o parceiro (uma linha)").toHaveCount(1);
  // a célula da coluna "Cidade": mesmo índice do cabeçalho
  const cabecalhos = (await page.getByRole("columnheader").allInnerTexts()).map((t) => t.trim());
  const col = cabecalhos.findIndex((t) => /^Cidade\b/.test(t));
  expect(col, `premissa: a coluna Cidade existe (${cabecalhos.join(" | ")})`).toBeGreaterThanOrEqual(0);
  await expect(linha.getByRole("cell").nth(col)).toHaveText(/^\s*Pontes e Lacerda - MT\s*$/);
  await expect(linha, "nunca o código IBGE no lugar do nome").not.toContainText("5106752");
});
