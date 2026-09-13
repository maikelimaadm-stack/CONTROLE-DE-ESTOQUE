import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * ACESSO POR EMPRESA (Configurações › Usuários): a tela de configuração tem fixtures próprias — cria o
 * usuário que ela mesma vai configurar, para não depender de estado deixado por outro teste.
 *
 * O que se verifica aqui é a TELA: a matriz por módulo existe, grava o modelo canônico e devolve o que
 * gravou. A autorização em si é provada no servidor (apps/api/test/integration/escopo-modulo.test.ts) —
 * interface nunca é prova de autorização.
 */
const email = `e2e-acesso-${Date.now()}@demo.local`;

test("matriz de acesso por empresa grava e relê o modelo por módulo", async ({ page }) => {
  await login(page);
  await page.goto("/admin/usuarios");
  await page.getByRole("button", { name: "Novo usuário" }).click();
  await page.getByRole("textbox", { name: "Nome *" }).fill("Usuário E2E Acesso");
  await page.getByRole("textbox", { name: "E-mail *" }).fill(email);
  await page.getByLabel(/Senha/).first().fill("Acesso@12345");

  // a matriz lista os módulos de negócio — Início/Relatórios/Configurações NÃO são escopos
  const linhaEstoque = page.getByLabel(/Acesso — Estoque/);
  await expect(linhaEstoque).toBeVisible();
  await expect(page.getByLabel(/Acesso — Relatórios/)).toHaveCount(0);

  await linhaEstoque.selectOption("selecionadas");
  await page.getByRole("checkbox").first().check();
  await page.getByLabel(/Acesso — Financeiro/).selectOption("todas");
  await page.getByRole("button", { name: "Salvar" }).click();

  // relê: o que voltou é o modelo canônico, módulo a módulo
  await expect(page.getByText("Usuário E2E Acesso").first()).toBeVisible();
  const linha = page.getByTestId("b1-row").filter({ hasText: "Usuário E2E Acesso" }).first();
  await linha.getByTestId("row-view").click();
  await expect(page.getByLabel(/Acesso — Estoque/)).toHaveValue("selecionadas");
  await expect(page.getByLabel(/Acesso — Financeiro/)).toHaveValue("todas");
  // módulo não configurado continua sem empresa nenhuma (fail-closed), e a tela mostra isso
  await expect(page.getByLabel(/Acesso — Pecuária/)).toHaveValue("");
});
