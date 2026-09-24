import { test, expect, type Page } from "@playwright/test";
import { login, api, uniq, abrirLancamentoDeVendas, escolherTopEContinuar, CLASSIFICACAO_DO_SEED } from "./helpers";

/**
 * CADASTROS Fase 7 — TELA DE ÁRVORE (decisão 256). Base: Naturezas do seed (RECEITAS = "1", sintética, com
 * filhos "1.01 Receitas da Pecuária" → "1.01.001 Venda de Boi Gordo", analítica).
 *
 * AR-1 árvore à esquerda, ficha à direita; recolher/expandir; a busca abre o caminho; alternar com a lista.
 * AR-2 "Novo filho": superior preenchido e código sugerido pelo servidor; grava e aparece na árvore.
 * AR-3 o campo de busca da venda mostra o CAMINHO e só oferece analítico (premissa: sem o recorte, a
 *      sintética existe e viria). RV1: tirar o recorte do lookup da venda deixa este teste vermelho.
 * AR-4 "Mover": novo superior + código novo sugerido; a recusa da API (decisão 244) aparece na tela.
 */
type No = { id: string; code: string; name: string; kind: string; parent_id: string | null };
const naturezas = async (page: Page) => (await api<{ items: No[] }>(page, "GET", "/api/resources/financial_categories?pageSize=1000")).items;
const no = (page: Page, texto: string) => page.getByTestId("arvore-tela").getByTestId("arvore-no").filter({ hasText: texto }).first();

test("AR-1 — árvore com ficha ao lado: recolher, busca que abre o caminho e alternar com a lista", async ({ page }) => {
  await login(page);
  await page.goto("/cadastros/financial_categories");
  await page.getByTestId("visao-arvore").click();
  await expect(page).toHaveURL(/visao=arvore/);
  const raiz = no(page, "RECEITAS"); const filho = no(page, "Receitas da Pecuária"); const neto = no(page, "Venda de Boi Gordo");
  await expect(raiz).toBeVisible(); await expect(neto).toBeVisible();
  await expect(raiz).toHaveAttribute("aria-expanded", "true");
  await raiz.getByTestId("arvore-no-alternar").click();
  await expect(raiz).toHaveAttribute("aria-expanded", "false");
  await expect(filho).toBeHidden(); await expect(neto).toBeHidden();
  // BUSCA (no servidor) abre o caminho até o que bate, mesmo com o ramo recolhido
  await page.getByLabel("Buscar na árvore").fill("Boi Gordo");
  await expect(neto).toBeVisible(); await expect(filho).toBeVisible(); await expect(raiz).toBeVisible();
  await expect(page.getByTestId("arvore-no").filter({ hasText: "Energia" }), "fora do caminho some durante a busca").toHaveCount(0);
  // ficha à direita
  await neto.getByRole("button", { name: /Venda de Boi Gordo/ }).click();
  await expect(page.getByRole("region", { name: "Ficha" }).getByText("Venda de Boi Gordo").first()).toBeVisible();
  await page.getByLabel("Buscar na árvore").fill("");
  await expect(filho, "sem busca, volta o recolhido").toBeHidden();
  // a lista em árvore de hoje continua
  await page.getByTestId("visao-lista").click();
  await expect(page).not.toHaveURL(/visao=arvore/);
  await expect(page.locator("tbody tr", { hasText: "RECEITAS" }).first()).toBeVisible();
});

test("AR-2 — Novo filho: superior preenchido, código sugerido pelo servidor, grava e aparece na árvore", async ({ page }) => {
  await login(page);
  const nos = await naturezas(page);
  const pai = nos.find((x) => x.code === "1.01")!;
  expect(pai, "premissa: 1.01 do seed").toBeTruthy();
  const sugerido = await api<{ codigo: string }>(page, "GET", `/api/resources/financial_categories/proximo-codigo?parent_id=${pai.id}`);
  await page.goto("/cadastros/financial_categories?visao=arvore");
  await no(page, "Receitas da Pecuária").getByRole("button", { name: /Receitas da Pecuária/ }).click();
  await page.getByRole("button", { name: "Novo filho" }).click();
  await expect(page.getByTestId("arvore-novo-superior")).toContainText("1.01 Receitas da Pecuária");
  const codigo = page.getByRole("region", { name: "Ficha" }).getByLabel(/^Código/).first();
  await expect(codigo).toHaveValue(sugerido.codigo);
  const nome = uniq("Filho AR2");
  await page.getByRole("region", { name: "Ficha" }).getByLabel(/^Descrição/).first().fill(nome);
  const resposta = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/resources/financial_categories");
  await page.getByRole("button", { name: "Salvar" }).click();
  const r = await resposta;
  expect(r.status(), await r.text()).toBe(201);
  const enviado = r.request().postDataJSON() as Record<string, unknown>;
  expect(enviado["parent_id"]).toBe(pai.id); expect(enviado["code"]).toBe(sugerido.codigo);
  await expect(no(page, nome)).toBeVisible();
  await expect(no(page, nome)).toHaveAttribute("aria-level", "3");
});

test("AR-3 — venda: o campo Natureza mostra o caminho e só oferece analítico", async ({ page }) => {
  await login(page);
  // premissa anti-vácuo: sem o recorte, a porta de opções devolve a SINTÉTICA com caminho
  const sem = await api<{ id: string; kind: string; caminho: string }[]>(page, "GET", "/api/resources/financial_categories/options?search=Receitas");
  const sinteticas = sem.filter((o) => o.kind === "synthetic");
  expect(sinteticas.length, "premissa: há sintética que casaria a busca").toBeGreaterThan(0);
  const top = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo: `8${Date.now().toString(36)}`, codigoBase: "vendas.venda", nome: uniq("AR-3") });
  await abrirLancamentoDeVendas(page, "sales");
  await escolherTopEContinuar(page, top.id);
  const campo = page.locator("label", { hasText: "Natureza" }).first().locator("..");
  await campo.locator("button").first().click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  // busca por um termo que casa sintéticas (RECEITAS, Receitas da Pecuária) E a analítica abaixo delas
  const resp = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith("/api/resources/financial_categories/options") && new URL(r.url()).searchParams.get("search") === "Boi");
  await page.getByPlaceholder("Pesquisar...").fill("Boi");
  const corpo = await (await resp).json() as { id: string; kind: string }[];
  expect(corpo.length).toBeGreaterThan(0);
  expect(corpo.filter((o) => o.kind !== "analytic"), "nenhuma sintética chega ao lookup").toEqual([]);
  const opcao = painel.getByRole("option", { name: new RegExp(CLASSIFICACAO_DO_SEED.categoria.nome) });
  await expect(opcao).toHaveCount(1);
  await expect(opcao, "o caminho aparece: '1 RECEITAS › 1.01 Receitas da Pecuária › 1.01.001 Venda de Boi Gordo'").toContainText(/1 RECEITAS › 1\.01 Receitas da Pecuária › 1\.01\.001 Venda de Boi Gordo/);
  // e a sintética, buscada pelo nome, não é oferecida
  await page.getByPlaceholder("Pesquisar...").fill("Receitas da Pecuária");
  await expect(painel.getByRole("option").filter({ hasText: /Receitas da Pecuária$/ })).toHaveCount(0);
});

test("AR-4 — Mover: novo superior com código sugerido; a recusa da API aparece na tela", async ({ page }) => {
  await login(page);
  const nos = await naturezas(page);
  const destino = nos.find((x) => x.code === "1.02")!;
  const origem = nos.find((x) => x.code === "1.01")!;
  expect(destino && origem, "premissa: 1.01 e 1.02 do seed").toBeTruthy();
  const s = await api<{ codigo: string }>(page, "GET", `/api/resources/financial_categories/proximo-codigo?parent_id=${origem.id}`);
  const nome = uniq("Mover AR4");
  await api(page, "POST", "/api/resources/financial_categories", { code: s.codigo, name: nome, nature: "income", kind: "analytic", parent_id: origem.id });
  const esperado = await api<{ codigo: string }>(page, "GET", `/api/resources/financial_categories/proximo-codigo?parent_id=${destino.id}`);
  await page.goto("/cadastros/financial_categories?visao=arvore");
  await no(page, nome).getByRole("button").last().click();
  await page.getByRole("region", { name: "Ficha" }).getByRole("button", { name: "Mover", exact: true }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.locator("label", { hasText: "Novo superior" }).first().locator("..").locator("button").first().click();
  await page.getByPlaceholder("Pesquisar...").fill("Receitas Agrícolas");
  await page.locator("[data-radix-popper-content-wrapper]").last().getByRole("option").first().click();
  await expect(dialogo.getByLabel("Código novo")).toHaveValue(esperado.codigo);
  // código fora do prefixo: a API recusa (244) e a tela mostra
  await dialogo.getByLabel("Código novo").fill("1.01.999");
  await dialogo.getByRole("button", { name: "Mover", exact: true }).click();
  await expect(dialogo.getByRole("alert")).toContainText(/começar com o código do superior/);
  await dialogo.getByLabel("Código novo").fill(esperado.codigo);
  await dialogo.getByRole("button", { name: "Mover", exact: true }).click();
  await expect(dialogo).toBeHidden();
  const depois = (await naturezas(page)).find((x) => x.name === nome)!;
  expect(depois.parent_id).toBe(destino.id); expect(depois.code).toBe(esperado.codigo);
});
