import { test, expect } from "@playwright/test";
import { login, api, uniq } from "./helpers";

/**
 * CADASTROS Fase 5 — RH: Funcionários na tela.
 *
 * RH-W1  RH › Funcionários lista os parceiros do tipo Funcionário; "Novo funcionário" começa pelo CPF (CPF novo
 *        cria e abre a ficha de RH); a ficha mostra as abas na ordem; a Remuneração grava e o salário volta
 *        para quem tem employees.edit; o mesmo CPF de novo abre o MESMO funcionário (não duplica).
 */

function cpfValido(): string {
  const b = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (xs: number[]) => { const s = xs.reduce((a, x, i) => a + x * (xs.length + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(b); const d2 = dv([...b, d1]);
  return [...b, d1, d2].join("");
}

test("RH-W1 — novo funcionário pelo CPF, ficha de RH em abas e salário", async ({ page }) => {
  await login(page);
  const nome = uniq("RH-W1 funcionario");
  const cpf = cpfValido();

  await page.goto("/cadastros/funcionarios/new");
  const novo = page.getByTestId("criacao-por-outra-porta");
  await expect(novo).toBeVisible();
  await novo.getByLabel("CPF").fill(cpf);
  await novo.getByLabel("Nome").fill(nome);
  await novo.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(/\/cadastros\/funcionarios\/[0-9a-f-]{36}$/);
  const id = /funcionarios\/([0-9a-f-]{36})/.exec(page.url())![1]!;

  const ficha = page.getByTestId("ficha-em-abas");
  await expect(ficha).toBeVisible();
  const abas = (await ficha.getByRole("tab").allInnerTexts()).map((t) => t.trim());
  expect(abas).toEqual(["Pessoal", "Admissão e lotação", "Remuneração", "Documentos", "Pagamento", "Desligamento", "Eventos fixos", "Usuário do sistema"]);
  await expect(page.getByTestId("ficha-cabecalho")).toContainText(nome);

  await ficha.getByRole("tab", { name: "Remuneração" }).click();
  await ficha.getByRole("tabpanel", { name: "Remuneração" }).getByLabel("Salário base").fill("4321.00");
  await page.getByRole("button", { name: /Salvar/ }).first().click();
  await expect(page.getByText("Salvo com sucesso")).toBeVisible();

  const gravado = await api<{ rh_remuneracao: { base_salary?: string } }>(page, "GET", `/api/resources/funcionarios/${id}`);
  expect(gravado.rh_remuneracao.base_salary).toBe("4321.00");

  // RH › Funcionários lista o novo funcionário
  await page.goto("/pessoas?tab=pessoas");
  await expect(page.getByText(nome).first()).toBeVisible();

  // o mesmo CPF de novo abre o MESMO funcionário
  await page.goto("/cadastros/funcionarios/new");
  await page.getByTestId("criacao-por-outra-porta").getByLabel("CPF").fill(cpf);
  await page.getByTestId("criacao-por-outra-porta").getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(new RegExp(`/cadastros/funcionarios/${id}$`));
});
