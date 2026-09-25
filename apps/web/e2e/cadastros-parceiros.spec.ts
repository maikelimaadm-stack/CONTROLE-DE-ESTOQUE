import { test, expect } from "@playwright/test";
import { login, logout, api, uniq } from "./helpers";

/**
 * CADASTROS Fase 4 — Parceiros: ficha em abas (decisão 253) na tela.
 *
 * PA-W1  Navegação: Configurações › Parceiros com o filtro por tipo; o módulo "RH" mostra Funcionários; o
 *        endereço antigo `/pessoas?tab=pessoas&role=client` continua abrindo; a busca global acha Parceiros
 *        por "pessoa", "cliente", "fornecedor" e "parceiro".
 * PA-W2  Ficha: cabeçalho fixo, abas na ordem, aba de perfil aparece ao marcar o tipo, grade de endereços grava;
 *        erro na 2ª linha → contador na aba Endereços e linha marcada, nada gravado.
 * PA-W3  Cadastro rápido de cliente de dentro de um seletor: só os campos rápidos, tipo pré-marcado.
 * PA-W4  Tipo de pessoa × documento (R1-6, decisão 253): Jurídica (o padrão) com CPF → a recusa da API aparece NO
 *        CAMPO CPF/CNPJ, com o contador na aba Identificação, e nada é gravado; trocar para Física grava.
 * PA-W5  Permissões por tipo (R1-4, decisão 253): perfil só com people.* → as abas Cliente, Fornecedor e Proprietário
 *        não aparecem (e a API não manda os dados delas); o parceiro NOVO pela ficha grava — a tela não manda as
 *        grades das abas que o perfil não grava, que a API recusaria com 403.
 */

function cpfValido(): string {
  const b = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (xs: number[]) => { const s = xs.reduce((a, x, i) => a + x * (xs.length + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(b); const d2 = dv([...b, d1]);
  return [...b, d1, d2].join("");
}

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
  // AJUSTES 01 (C-4): a aba passou a se chamar "Endereço"
  expect(abas.slice(0, 5)).toEqual(["Identificação", "Endereço", "Contatos", "Fiscal", "Financeiro"]);
  expect(abas, "aba de perfil só aparece com o tipo marcado").not.toContain("Cliente");

  await page.getByLabel("Nome Social/Fantasia").fill(nome);
  // marca Cliente — AJUSTES 01 (C-3): "Tipo do parceiro" é UM campo de marcação múltipla, e o cabeçalho fixo
  // passou a ser Código · Ativo · Tipo de pessoa · CPF/CNPJ · Nome · situação (o tipo do parceiro saiu dele)
  await page.getByTestId("grupo-tipo-do-parceiro").getByLabel("Cliente", { exact: true }).check();
  await expect(ficha.getByRole("tab", { name: "Cliente" })).toBeVisible();
  await expect(page.getByTestId("grupo-tipo-do-parceiro").getByLabel("Cliente", { exact: true })).toBeChecked();

  await ficha.getByRole("tab", { name: "Endereço" }).click();
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
  // ancorado no rótulo do campo: `div` que CONTÉM o texto casa também o layout inteiro, e o 1º [aria-expanded]
  // passava a ser o menu "Compras" do cabeçalho
  const campo = page.locator("label", { hasText: "Fornecedor de origem" }).first().locator("..").locator("[aria-expanded]").first();
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

test("PA-W4 — Jurídica com CPF: a mensagem aparece no campo do documento; Física grava", async ({ page }) => {
  await login(page);
  const nome = uniq("PA-W4 parceiro");
  const cpf = cpfValido();
  await page.goto("/cadastros/people/new");
  const ficha = page.getByTestId("ficha-em-abas");
  await expect(ficha).toBeVisible();
  await page.getByLabel("Nome Social/Fantasia").fill(nome);
  await page.getByTestId("grupo-tipo-do-parceiro").getByLabel("Cliente", { exact: true }).check();
  // o documento é um CPF formatado. AJUSTES 01 (C-3): o tipo de pessoa SEGUE o documento (vira Física sozinho);
  // "Jurídica com CPF" agora só existe se o usuário escolher Jurídica À MÃO depois — e a API continua recusando
  await page.getByLabel("CPF/CNPJ").fill(`${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`);
  await page.getByLabel("Tipo de pessoa").click();
  await page.getByRole("option", { name: "Jurídica", exact: true }).click();
  await expect(page.getByTestId("faixa-tipo-documento")).toBeVisible();
  await page.getByRole("button", { name: "Salvar" }).click();

  // a recusa (422) volta com `path: "document"` e a ficha a mostra NO CAMPO, com o contador na aba
  await expect(ficha.getByText("Pessoa jurídica usa CNPJ", { exact: true })).toBeVisible();
  await expect(page.getByTestId("erros-aba-identificacao")).toHaveText("1");
  const nada = await api<{ items: unknown[] }>(page, "GET", `/api/resources/people?search=${encodeURIComponent(nome)}`);
  expect(nada.items, "nada gravado").toHaveLength(0);

  // acertar o tipo resolve
  await page.getByLabel("Tipo de pessoa").click();
  await page.getByRole("option", { name: "Física", exact: true }).click();
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(async () => (await api<{ items: { person_type: string; document: string }[] }>(page, "GET", `/api/resources/people?search=${encodeURIComponent(nome)}`)).items.map((x) => [x.person_type, x.document])).toEqual([["natural", cpf]]);
});

test("PA-W5 — perfil sem clients/providers/proprietaries: as abas de tipo não aparecem; o parceiro novo pela ficha grava", async ({ page }) => {
  await login(page);
  const x = await api<{ id: string }>(page, "POST", "/api/resources/people", { name: uniq("PA-W5 todos os tipos"), person_type: "legal", is_client: true, is_provider: true, is_proprietary: true, perfil_cliente: { limite_credito: "1000" } });
  const papel = await api<{ id: string }>(page, "POST", "/api/admin/roles", { name: uniq("Só Parceiros E2E"), permissions: ["people.view", "people.create", "people.edit"] });
  const usuario = { email: `e2e-so-parceiros-${Date.now()}@demo.local`, password: "Leitor@12345" };
  await api(page, "POST", "/api/admin/members", { name: "Parceiros E2E", email: usuario.email, password: usuario.password, role_id: papel.id, escopos_empresas: [] });
  await logout(page);
  await login(page, usuario);

  // ficha existente: os tipos estão marcados, mas as abas deles não aparecem — e a API não manda os dados
  await page.goto(`/cadastros/people/${x.id}`);
  const ficha = page.getByTestId("ficha-em-abas");
  await expect(ficha).toBeVisible();
  await expect(ficha.getByRole("tab", { name: "Identificação" })).toBeVisible();
  // AJUSTES 01 (C-3): o tipo do parceiro saiu do cabeçalho fixo; está no campo de marcação múltipla
  await expect(page.getByTestId("grupo-tipo-do-parceiro").getByLabel("Cliente", { exact: true })).toBeChecked();
  const abas = (await ficha.getByRole("tab").allInnerTexts()).map((t) => t.trim());
  for (const t of ["Cliente", "Fornecedor", "Proprietário"]) expect(abas, `aba ${t} sem a permissão de leitura`).not.toContain(t);
  const lido = await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${x.id}`);
  for (const k of ["perfil_cliente", "perfil_fornecedor", "filiais", "vendedores", "perfil_proprietario", "participacoes"]) expect(lido, k).not.toHaveProperty(k);

  // parceiro NOVO: a criação manda todas as grades da ficha — menos as das abas que este perfil não grava
  const nome = uniq("PA-W5 novo");
  await page.goto("/cadastros/people/new");
  await expect(ficha).toBeVisible();
  await page.getByLabel("Nome Social/Fantasia").fill(nome);
  await page.getByTestId("grupo-tipo-do-parceiro").getByLabel("Cliente", { exact: true }).check();
  await expect(ficha.getByRole("tab", { name: "Cliente", exact: true }), "marcar o tipo não mostra a aba sem clients.view").toHaveCount(0);
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(async () => (await api<{ items: { is_client: boolean }[] }>(page, "GET", `/api/resources/people?search=${encodeURIComponent(nome)}`)).items.map((i) => i.is_client)).toEqual([true]);
});
