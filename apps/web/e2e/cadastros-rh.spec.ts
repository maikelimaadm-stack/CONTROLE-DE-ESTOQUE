import { test, expect, type Page } from "@playwright/test";
import { login, logout, api, uniq } from "./helpers";

/**
 * CADASTROS Fase 5 — RH: Funcionários na tela.
 *
 * RH-W1  RH › Funcionários lista os parceiros do tipo Funcionário; "Novo funcionário" começa pelo CPF (CPF novo
 *        cria e abre a ficha de RH); a ficha mostra as abas na ordem; a Remuneração grava e o salário volta
 *        para quem tem employees.edit; o mesmo CPF de novo abre o MESMO funcionário (não duplica).
 * RH-W2  (R1-2, SG-6) limpar a data de desligamento e o salário PELA TELA grava null; o motivo, que não foi mexido,
 *        continua gravado.
 * RH-W3  (R1-2, SG-1 na tela) perfil SÓ com employees.view — sem o sigilo (que é employees.edit, decisão 255) nem os
 *        cadastros de eventos e equipes: a Remuneração mostra só a jornada (salário, valor hora, meta e comissão não
 *        aparecem, nem o valor em lugar nenhum da página), a aba Eventos fixos e a grade de Equipes não aparecem.
 * RH-W3b (R1-2, SG-3 e SG-8 na tela) perfil com employees.view/edit — que É o sigilo — e sem people.edit nem os
 *        cadastros de eventos e equipes: o salário aparece, a aba Eventos fixos e a grade de Equipes não aparecem, e
 *        salvar a aba Documentos grava (a tela não manda as grades nem os campos da aba Pessoal, que a API recusaria
 *        com 403) sem mexer no salário. "Sem o sigilo" e "grava a ficha" não cabem no mesmo usuário: gravar a ficha
 *        exige employees.edit, e employees.edit é o sigilo.
 * RH-W4  (R1-6) funcionário gravado como pessoa Jurídica: um CPF no campo do documento da ficha de RH é recusado
 *        com a mensagem que diz onde o tipo se acerta, NO CAMPO, e o contador de erros aparece na aba Pessoal (a
 *        ficha de RH não tem a aba Identificação do cadastro de parceiros); nada gravado.
 */

/** CNPJ numérico válido (dígitos verificadores pela regra da Receita). */
function cnpjValido(): string {
  const b = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const dv = (xs: number[], pesos: number[]) => { const r = xs.reduce((a, x, i) => a + x * pesos[i]!, 0) % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(b, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); const d2 = dv([...b, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return [...b, d1, d2].join("");
}

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

test("RH-W2 (SG-6) — limpar a data de desligamento e o salário pela tela grava null", async ({ page }) => {
  await login(page);
  const { id } = await api<{ id: string }>(page, "POST", "/api/hr/funcionarios/por-cpf", { document: cpfValido(), name: uniq("RH-W2 desligado") });
  await api(page, "PUT", `/api/resources/funcionarios/${id}`, { rh_desligamento: { dismissal_date: "2032-06-30", motivo_desligamento: "acordo" }, rh_remuneracao: { base_salary: "1500" } });

  await page.goto(`/cadastros/funcionarios/${id}`);
  const ficha = page.getByTestId("ficha-em-abas");
  await expect(ficha).toBeVisible();
  await ficha.getByRole("tab", { name: "Desligamento" }).click();
  const data = ficha.getByRole("tabpanel", { name: "Desligamento" }).getByLabel("Data do desligamento");
  await expect(data).toHaveValue("2032-06-30");
  await data.fill("");
  await ficha.getByRole("tab", { name: "Remuneração" }).click();
  const salario = ficha.getByRole("tabpanel", { name: "Remuneração" }).getByLabel("Salário base");
  await expect(salario).toHaveValue("1500.00");
  await salario.fill("");
  await page.getByRole("button", { name: /Salvar/ }).first().click();
  await expect(page.getByText("Salvo com sucesso")).toBeVisible();

  const gravado = await api<{ rh_desligamento: Record<string, unknown>; rh_remuneracao: Record<string, unknown> }>(page, "GET", `/api/resources/funcionarios/${id}`);
  expect(gravado.rh_desligamento).toMatchObject({ dismissal_date: null, motivo_desligamento: "acordo" });
  expect(gravado.rh_remuneracao["base_salary"]).toBeNull();
});

/**
 * Funcionário com salário, meta e jornada gravados pelo admin, e um usuário com EXATAMENTE `permissions` (sem
 * escopo de empresa: funcionário é cadastro da organização). Sai logado como esse usuário.
 */
async function funcionarioELoginCom(page: Page, rotulo: string, permissions: string[]): Promise<string> {
  await login(page);
  const { id } = await api<{ id: string }>(page, "POST", "/api/hr/funcionarios/por-cpf", { document: cpfValido(), name: uniq(`${rotulo} funcionario`) });
  await api(page, "PUT", `/api/resources/funcionarios/${id}`, { rh_remuneracao: { base_salary: "4321.00", goal_salary: "999.00", jornada_semanal: "44" } });
  const papel = await api<{ id: string }>(page, "POST", "/api/admin/roles", { name: uniq(`${rotulo} E2E`), permissions });
  const usuario = { email: `e2e-${rotulo.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}@demo.local`, password: "Leitor@12345" };
  await api(page, "POST", "/api/admin/members", { name: `${rotulo} E2E`, email: usuario.email, password: usuario.password, role_id: papel.id, escopos_empresas: [] });
  await logout(page);
  await login(page, usuario);
  return id;
}

test("RH-W3 (SG-1) — só employees.view, sem o sigilo nem eventos/equipes: salário, Eventos fixos e Equipes não aparecem", async ({ page }) => {
  const id = await funcionarioELoginCom(page, "RH so leitura", ["employees.view"]);

  await page.goto(`/cadastros/funcionarios/${id}`);
  const ficha = page.getByTestId("ficha-em-abas");
  await expect(ficha).toBeVisible();
  const abas = (await ficha.getByRole("tab").allInnerTexts()).map((t) => t.trim());
  expect(abas).not.toContain("Eventos fixos");
  expect(abas).toContain("Remuneração");
  await ficha.getByRole("tab", { name: "Remuneração" }).click();
  const rem = ficha.getByRole("tabpanel", { name: "Remuneração" });
  // a presença positiva: a jornada, que não é sigilosa, aparece — senão as ausências abaixo seriam vácuo
  await expect(rem.getByLabel("Jornada semanal (h)")).toHaveValue("44.00");
  for (const campo of ["Salário base", "Valor da hora", "Meta", "Comissão (%)"]) await expect(rem.getByLabel(campo, { exact: true })).toHaveCount(0);
  for (const v of ["4321.00", "4.321,00", "999.00", "999,00"]) await expect(page.locator("body")).not.toContainText(v);
  await ficha.getByRole("tab", { name: "Admissão e lotação" }).click();
  await expect(ficha.getByTestId("grade-equipes")).toHaveCount(0);
});

test("RH-W3b (SG-3, SG-8) — employees.view/edit sem people.edit nem eventos/equipes: o salário aparece, Eventos fixos e Equipes não, e outra aba grava", async ({ page }) => {
  const id = await funcionarioELoginCom(page, "RH sem eventos equipes", ["employees.view", "employees.edit"]);

  await page.goto(`/cadastros/funcionarios/${id}`);
  const ficha = page.getByTestId("ficha-em-abas");
  await expect(ficha).toBeVisible();
  const abas = (await ficha.getByRole("tab").allInnerTexts()).map((t) => t.trim());
  expect(abas).not.toContain("Eventos fixos");
  expect(abas).toContain("Remuneração");
  await ficha.getByRole("tab", { name: "Remuneração" }).click();
  const rem = ficha.getByRole("tabpanel", { name: "Remuneração" });
  await expect(rem.getByLabel("Jornada semanal (h)")).toHaveValue("44.00");
  // employees.edit É o sigilo (decisão 255): quem grava a ficha vê o salário
  await expect(rem.getByLabel("Salário base", { exact: true })).toHaveValue("4321.00");
  await expect(rem.getByLabel("Meta", { exact: true })).toHaveValue("999.00");
  await ficha.getByRole("tab", { name: "Admissão e lotação" }).click();
  await expect(ficha.getByTestId("grade-equipes")).toHaveCount(0);
  // outra aba grava: a tela não manda as grades de Eventos fixos e Equipes nem os campos da aba Pessoal (people.edit),
  // que a API recusaria com 403
  await ficha.getByRole("tab", { name: "Documentos" }).click();
  await ficha.getByRole("tabpanel", { name: "Documentos" }).getByLabel("RG", { exact: true }).fill("RG-W3");
  await page.getByRole("button", { name: /Salvar/ }).first().click();
  await expect(page.getByText("Salvo com sucesso")).toBeVisible();

  const gravado = await api<{ rh_documentos: Record<string, unknown>; rh_remuneracao: Record<string, unknown> }>(page, "GET", `/api/resources/funcionarios/${id}`);
  expect(gravado.rh_documentos["rg_numero"], "a aba Documentos gravou").toBe("RG-W3");
  expect(gravado.rh_remuneracao, "o salário, que não foi mexido, continua o mesmo").toMatchObject({ base_salary: "4321.00", goal_salary: "999.00" });
});

test("RH-W4 (R1-6) — CPF num funcionário Jurídica: a recusa aparece no campo e o contador na aba Pessoal, com o caminho do acerto", async ({ page }) => {
  await login(page);
  const nome = uniq("RH-W4 juridica");
  const cnpj = cnpjValido();
  // funcionário pessoa JURÍDICA (com CNPJ, coerente) criado pelo cadastro de parceiros; a ficha de RH não tem o tipo de pessoa
  const { id } = await api<{ id: string }>(page, "POST", "/api/resources/people", { name: nome, person_type: "legal", document: cnpj, is_employee: true });

  await page.goto(`/cadastros/funcionarios/${id}`);
  const ficha = page.getByTestId("ficha-em-abas");
  await expect(ficha).toBeVisible();
  await ficha.getByLabel("CPF", { exact: true }).fill(cpfValido());
  await page.getByRole("button", { name: /Salvar/ }).first().click();

  // a recusa (422) volta com `path: "document"` e a aba DESTA ficha: a mensagem no campo e o contador em Pessoal
  await expect(ficha.getByText("Pessoa jurídica usa CNPJ — o parceiro está como Jurídica; acerte o tipo de pessoa no cadastro de parceiros", { exact: true })).toBeVisible();
  await expect(page.getByTestId("erros-aba-pessoal")).toHaveText("1");
  await expect(page.getByTestId("erros-aba-identificacao")).toHaveCount(0);
  const gravado = await api<{ document: string }>(page, "GET", `/api/resources/funcionarios/${id}`);
  expect(gravado.document, "nada gravado").toBe(cnpj);
});
