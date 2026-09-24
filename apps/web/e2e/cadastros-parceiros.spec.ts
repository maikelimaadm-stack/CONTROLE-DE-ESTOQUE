import { test, expect } from "@playwright/test";
import { login, api, uniq } from "./helpers";

/**
 * CADASTROS Fase 4 — Parceiros: ficha em abas (decisão 253) na tela.
 *
 * PA-W1  Navegação: Configurações › Parceiros com o filtro por tipo; o módulo "RH" mostra Funcionários; o
 *        endereço antigo `/pessoas?tab=pessoas&role=client` continua abrindo; a busca global acha Parceiros
 *        por "pessoa", "cliente", "fornecedor" e "parceiro".
 * PA-W2  Ficha: cabeçalho fixo, abas na ordem, aba de perfil aparece ao marcar o tipo, grade de endereços grava;
 *        erro na 2ª linha → contador na aba Endereços e linha marcada, nada gravado.
 * PA-W3  Cadastro rápido de cliente de dentro de um seletor: só os campos rápidos, tipo pré-marcado.
 */

test("PA-W1 — Configurações › Parceiros, RH › Funcionários, endereço antigo e busca", async ({ page }) => {
  await login(page);
  await page.goto("/configuracoes?tab=parceiros");
  const tipo = page.getByTestId("people-role");
  for (const t of ["Todos", "Clientes", "Fornecedores", "Transportadoras", "Funcionários", "Proprietários"]) await expect(tipo.getByRole("radio", { name: t, exact: true })).toBeVisible();
  await tipo.getByRole("radio", { name: "Clientes", exact: true }).click();
  await expect(page).toHaveURL(/[?&]role=client/);

  await page.goto("/pessoas");
  await expect(page.locator("main").getByRole("tab", { name: "Funcionários", exact: true })).toBeVisible();

  await page.goto("/pessoas?tab=pessoas&role=client");
  await expect(page.getByTestId("people-role").getByRole("radio", { name: "Clientes", exact: true })).toHaveAttribute("aria-checked", "true");

  // BUSCA GLOBAL: "pessoa", "cliente", "fornecedor" e "parceiro" acham Configurações › Parceiros
  const global = page.getByLabel("Buscar funcionalidade");
  for (const termo of ["pessoa", "cliente", "fornecedor", "parceiro"]) {
    await global.fill(termo);
    await expect(page.getByTestId("nav-search-results").getByRole("option", { name: /Parceiros/ }).first(), termo).toBeVisible();
  }
  await page.getByTestId("nav-search-results").getByRole("option", { name: /Parceiros/ }).first().click();
  await expect(page).toHaveURL(/\/configuracoes\?tab=parceiros/);
});

test("PA-W2 — ficha em abas: cabeçalho, perfil por tipo, grade de endereços e erro por aba", async ({ page }) => {
  await login(page);
  const nome = uniq("PA-W2 parceiro");
  await page.goto("/cadastros/people/new");
  const ficha = page.getByTestId("ficha-em-abas");
  await expect(ficha).toBeVisible();
  const abas = (await ficha.getByRole("tab").allInnerTexts()).map((t) => t.trim());
  expect(abas.slice(0, 5)).toEqual(["Identificação", "Endereços", "Contatos", "Fiscal", "Financeiro"]);
  expect(abas, "aba de perfil só aparece com o tipo marcado").not.toContain("Cliente");

  await page.getByLabel("Nome Social/Fantasia").fill(nome);
  // marca Cliente (campo booleano do modelo base)
  await page.getByLabel("Cliente", { exact: true }).click();
  await page.getByRole("option", { name: "Sim" }).click();
  await expect(ficha.getByRole("tab", { name: "Cliente" })).toBeVisible();
  await expect(page.getByTestId("ficha-cabecalho")).toContainText("Cliente");

  await ficha.getByRole("tab", { name: "Endereços" }).click();
  const grade = page.getByTestId("grade-enderecos");
  await grade.getByRole("button", { name: "Incluir linha" }).click();
  await grade.getByRole("button", { name: "Incluir linha" }).click();
  await grade.getByLabel("Tipo").nth(0).selectOption("entrega");
  await grade.getByLabel("Tipo").nth(1).selectOption("propriedade");
  await grade.getByLabel("IE").nth(1).fill("12AB");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByTestId("erros-aba-enderecos")).toHaveText("1");
  await expect(page.getByTestId("linha-enderecos-2")).toHaveClass(/bg-red-50/);
  const nada = await api<{ items: unknown[] }>(page, "GET", `/api/resources/people?search=${encodeURIComponent(nome)}`);
  expect(nada.items, "nada gravado").toHaveLength(0);

  await grade.getByLabel("IE").nth(1).fill("ISENTO");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(async () => (await api<{ items: { id: string }[] }>(page, "GET", `/api/resources/people?search=${encodeURIComponent(nome)}`)).items.length).toBe(1);
  const id = (await api<{ items: { id: string }[] }>(page, "GET", `/api/resources/people?search=${encodeURIComponent(nome)}`)).items[0]!.id;
  const gravado = await api<{ enderecos: { tipo: string; inscricao_estadual: string | null }[] }>(page, "GET", `/api/resources/people/${id}`);
  expect(gravado.enderecos.map((e) => e.tipo)).toEqual(["entrega", "propriedade"]);
});

test("PA-W3 — cadastro rápido de fornecedor dentro do seletor: campos rápidos e tipo pré-marcado", async ({ page }) => {
  await login(page);
  // A porta do cadastro rápido é o seletor com filtro de tipo — a mesma da venda e da compra. A entrada de
  // animal (Fornecedor de origem, is_provider) não depende de TOP configurada.
  await page.goto("/pecuaria/animais/new");
  const campo = page.locator("div", { has: page.getByText("Fornecedor de origem", { exact: true }) }).locator("[aria-expanded]").first();
  await campo.click();
  await page.getByRole("button", { name: /Cadastrar parceiro/ }).click();
  const rapido = page.getByTestId("cadastro-rapido");
  await expect(rapido).toBeVisible();
  await expect(page.getByTestId("ficha-em-abas"), "cadastro rápido não abre a ficha inteira").toHaveCount(0);
  const nome = uniq("PA-W3 rapido");
  await rapido.getByLabel("Nome Social/Fantasia").fill(nome);
  await page.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
  await expect.poll(async () => (await api<{ items: { is_provider: boolean }[] }>(page, "GET", `/api/resources/people?search=${encodeURIComponent(nome)}`)).items.map((x) => x.is_provider)).toEqual([true]);
});
