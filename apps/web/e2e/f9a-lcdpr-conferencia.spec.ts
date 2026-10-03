import { test, expect, type Locator, type Page, type Request, type Response } from "@playwright/test";
import { api, login, uniq } from "./helpers";

/**
 * OPERACOES-01 F9a (decisão 286) — O LCDPR: O IMÓVEL NA BAIXA E A CONFERÊNCIA NO LIVRO CAIXA.
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PODE PROVAR ────────────────────────────────────────────────────────────────┐
 * │ A integração (`f9a-lcdpr.test.ts`) prova o imóvel padrão da baixa e do movimento, as recusas e a      │
 * │ consulta da conferência (colunas, tipos, pendências, filtros, escopo). O que ela não alcança é a TELA:│
 * │ que o diálogo de baixa da Central já vem com o imóvel padrão da empresa e o MANDA no corpo, e que a   │
 * │ conferência do Fiscal › Livro Caixa mostra a linha com data, imóvel, conta, documento, participante,  │
 * │ tipo e valor — e a pendência só em "Pendentes", sem a transferência entre contas.                     │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *   1. imóvel padrão e natureza do tipo 1 pela API; conta a receber; a baixa pelo diálogo da Central (o imóvel já
 *      escolhido) → a linha na conferência, com os totais do tipo 1;
 *   2. natureza sem tipo → a linha só em "Pendentes" (com a contagem); a transferência entre contas do período não
 *      aparece em lado nenhum.
 *
 * FIXTURE PRÓPRIA E ISOLADA: cada teste cria a SUA empresa (o imóvel padrão é um por empresa — numa empresa do seed, a
 * segunda execução bateria no índice único e o padrão mudaria a baixa dos outros specs), a sua natureza (filha de uma
 * sintética do seed), o seu participante e o seu imóvel. A conferência é filtrada por essa empresa. O SERVIDOR é o
 * árbitro: a premissa e a conclusão são lidas na API, a tela é conferida contra elas.
 */

interface Conta { id: string; code: string; description: string }
interface LinhaApi { movimento_id: string; data: string; documento: string; tipo: string | null; entrada: string; saida: string; imovel: { id: string; nome: string } | null; participante: { nome: string } | null; conta: { codigo: string; descricao: string } }
interface Conferencia { itens: LinhaApi[]; total: number; totais: Record<string, { entradas: string; saidas: string }>; pendencias: { sem_imovel: { quantidade: number; valor: string }; sem_tipo: { quantidade: number; valor: string } } }

const hoje = () => new Date().toISOString().slice(0, 10);
const inicioDoAno = () => `${hoje().slice(0, 4)}-01-01`;
const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function premissas(page: Page): Promise<void> {
  const ctx = await api<{ capacidades?: Record<string, unknown> }>(page, "GET", "/api/auth/context");
  expect(ctx.capacidades?.["lcdpr"], "premissa: a API declara o LCDPR").toBe(1);
  expect(await api(page, "GET", "/api/financeiro/capacidades"), "premissa: a Central com o financeiro pela TOP").toEqual({ centralFinanceira: 1, financeiroPelaTop: 1 });
}
async function contas(page: Page): Promise<{ bb: Conta; outra: Conta }> {
  const r = await api<{ items: Conta[] }>(page, "GET", "/api/financial/bank-accounts/balances");
  const bb = r.items.find((c) => c.code === "BB"); const outra = r.items.find((c) => c.code !== "BB");
  expect(bb && outra, "premissa: a conta BB e uma segunda conta do seed (a transferência)").toBeTruthy();
  return { bb: bb!, outra: outra! };
}
async function primeiroId(page: Page, caminho: string, oQue: string): Promise<string> {
  const r = await api<{ items: { id: string }[] }>(page, "GET", caminho);
  expect(r.items?.[0]?.id, `premissa: o seed tem ${oQue}`).toBeTruthy();
  return r.items[0]!.id;
}

/** A empresa, o imóvel padrão dela e o participante do teste — tudo pela API, tudo novo. */
async function cenario(page: Page, rotulo: string) {
  const empresa = await api<{ id: string; name: string }>(page, "POST", "/api/resources/empresas", { name: uniq(`F9a LCDPR ${rotulo}`), is_active: true });
  const imovelNome = uniq(`Sítio ${rotulo}`);
  const imovel = await api<{ id: string }>(page, "POST", "/api/resources/imoveis_rurais", {
    empresa_id: empresa.id, nome: imovelNome, cib: "12345678", tipo_exploracao: "individual", participacao: "100", padrao: true
  });
  const opcoes = await api<{ itens: { id: string; padrao: boolean }[] }>(page, "GET", `/api/financeiro/imoveis-rurais/opcoes?empresa_id=${empresa.id}`);
  expect(opcoes.itens, "premissa: o imóvel é o padrão da empresa nova (e o único)").toEqual([expect.objectContaining({ id: imovel.id, padrao: true })]);
  const participante = await api<{ id: string; name: string }>(page, "POST", "/api/resources/people", { name: uniq(`F9a Participante ${rotulo}`), person_type: "legal", is_client: true });
  const centro = await primeiroId(page, "/api/resources/cost_centers?kind=analytic&pageSize=1", "um centro de resultado analítico");
  const pai = await primeiroId(page, "/api/resources/financial_categories?kind=synthetic&nature=income&pageSize=1", "uma natureza sintética de receita");
  return { empresa, imovel: { id: imovel.id, nome: imovelNome }, participante, centro, pai };
}

/** Uma natureza de receita analítica, filha da sintética do seed, com ou sem o tipo no LCDPR. */
async function natureza(page: Page, pai: string, tipo: string | null): Promise<string> {
  const n = await api<{ id: string }>(page, "POST", "/api/resources/financial_categories", { name: uniq("F9a Natureza LCDPR"), nature: "income", kind: "analytic", parent_id: pai, ...(tipo ? { tipo_lcdpr: tipo } : {}) });
  const lida = await api<{ tipo_lcdpr: string | null }>(page, "GET", `/api/resources/financial_categories/${n.id}`);
  expect(lida.tipo_lcdpr ?? null, "premissa: o tipo no LCDPR da natureza").toBe(tipo);
  return n.id;
}

const conferenciaNaApi = (page: Page, empresa: string, situacao: "conferidas" | "pendentes") =>
  api<Conferencia>(page, "GET", `/api/financeiro/lcdpr/conferencia?de=${inicioDoAno()}&ate=${hoje()}&empresa_id=${empresa}&situacao=${situacao}`);

/** Abre a conferência no Fiscal › Livro Caixa e filtra pela empresa (o seletor da tela, a busca do servidor). */
async function abrirConferencia(page: Page, empresa: { id: string; name: string }): Promise<Locator> {
  await page.goto("/fiscal?tab=livro-caixa");
  const card = page.getByTestId("lcdpr-conferencia");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("lcdpr-filtro-de"), "o período padrão começa no 1º de janeiro").toHaveValue(inicioDoAno());
  await expect(card.getByTestId("lcdpr-filtro-ate"), "e vai até hoje").toHaveValue(hoje());
  const filtrada = page.waitForResponse((r: Response) => r.url().includes("/api/financeiro/lcdpr/conferencia") && r.url().includes(`empresa_id=${empresa.id}`));
  await card.locator("label", { hasText: "Empresa" }).first().locator("..").getByRole("combobox").click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(empresa.name);
  await painel.getByRole("option", { name: new RegExp(escapar(empresa.name), "i") }).first().click();
  expect((await filtrada).status(), "a conferência filtra pela empresa no servidor").toBe(200);
  return card;
}
const linhasDaTabela = (card: Locator) => card.getByTestId("lcdpr-tabela").getByTestId("b1-row");

test("F9a LCDPR · 1 — a baixa pela Central leva o imóvel padrão (já escolhido) e a conferência mostra a linha: data, imóvel, conta, documento, participante, tipo e valor", async ({ page }) => {
  await login(page);
  await premissas(page);
  const c = await cenario(page, "baixa");
  const { bb } = await contas(page);
  const receita = await natureza(page, c.pai, "receita");
  const numero = `F9AL1-${Date.now().toString(36)}`.toUpperCase();
  const titulo = await api<{ id: string }>(page, "POST", "/api/financial/receivables", {
    empresa_id: c.empresa.id, number: numero, person_id: c.participante.id, amount: "345.67", emission_date: hoje(), due_date: hoje(), note: `F9a LCDPR ${numero}`,
    apportionment: [{ financial_category_id: receita, cost_center_id: c.centro, percentage: "100" }]
  });
  expect((await conferenciaNaApi(page, c.empresa.id, "conferidas")).total, "premissa: a empresa nova ainda não tem lançamento no livro").toBe(0);

  // A BAIXA PELO DIÁLOGO DA CENTRAL: o imóvel padrão da empresa do título já vem escolhido.
  await page.goto(`/financeiro/contas-a-receber/${titulo.id}`);
  await expect(page.getByTestId("base2-shell")).toBeVisible();
  await page.getByRole("button", { name: "Baixar", exact: true }).click();
  const dialogo = page.getByTestId("fin-dialogo-baixa");
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByTestId("fin-baixa-imovel"), "o imóvel padrão da empresa vem escolhido").toHaveValue(c.imovel.id);
  await dialogo.locator("label", { hasText: "Conta bancária" }).first().locator("..").getByRole("combobox").click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(bb.description);
  await painel.getByRole("option", { name: new RegExp(escapar(bb.description), "i") }).first().click();
  const caminho = `/api/financial/receivables/${titulo.id}/settle`;
  const pedido = page.waitForRequest((r: Request) => r.method() === "POST" && new URL(r.url()).pathname === caminho);
  const resposta = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === caminho);
  await dialogo.getByRole("button", { name: "Confirmar baixa" }).click();
  expect(((await pedido).postDataJSON() as Record<string, unknown>)["imovel_rural_id"], "o corpo leva o imóvel escolhido").toBe(c.imovel.id);
  expect((await resposta).status()).toBe(201);

  // CONCLUSÃO (API): a baixa e o movimento com o imóvel; a conferência com a linha do tipo 1.
  const baixado = await api<{ status: string; settlements: { imovel_rural_id: string | null; bank_movement_id: string; status: string }[] }>(page, "GET", `/api/financial/receivables/${titulo.id}`);
  const s = baixado.settlements.find((x) => x.status === "confirmed")!;
  expect([baixado.status, s.imovel_rural_id], "o título baixado, a baixa com o imóvel").toEqual(["paid", c.imovel.id]);
  const mov = await api<{ imovel_rural_id: string | null }>(page, "GET", `/api/financial/bank-movements/${s.bank_movement_id}`);
  expect(mov.imovel_rural_id, "o movimento da baixa com o mesmo imóvel").toBe(c.imovel.id);
  const conf = await conferenciaNaApi(page, c.empresa.id, "conferidas");
  expect(conf.itens.map((l) => [l.data, l.imovel?.id, l.documento, l.participante?.nome, l.tipo, l.entrada, l.saida]), "a linha do livro").toEqual([[hoje(), c.imovel.id, numero, c.participante.name, "receita", "345.67", "0.00"]]);

  // A TELA: a mesma linha, e o total do tipo 1.
  const card = await abrirConferencia(page, c.empresa);
  const linha = linhasDaTabela(card);
  await expect(linha, "uma linha conferida").toHaveCount(1);
  for (const texto of [dataBR(hoje()), c.imovel.nome, bb.description, numero, c.participante.name, "1 — Receita da atividade rural", "R$ 345,67"]) await expect(linha).toContainText(texto);
  await expect(card.getByTestId("lcdpr-total-receita")).toContainText("R$ 345,67");
  await expect(card.getByTestId("lcdpr-pendencia-sem-tipo")).toContainText("Sem tipo no LCDPR: 0");
});

test("F9a LCDPR · 2 — natureza sem tipo: a linha só em Pendentes; a transferência entre contas do período não aparece", async ({ page }) => {
  await login(page);
  await premissas(page);
  const c = await cenario(page, "pendente");
  const { bb, outra } = await contas(page);
  const semTipo = await natureza(page, c.pai, null);
  const sufixo = Date.now().toString(36).toUpperCase();
  const docEntrada = `F9AL2-E-${sufixo}`; const docTransf = `F9AL2-T-${sufixo}`;
  const entrada = await api<{ id: string }>(page, "POST", "/api/financial/bank-movements", {
    empresa_id: c.empresa.id, bank_account_id: bb.id, movement_date: hoje(), type: "in", category_type: "in", amount: "222.22", document: docEntrada, note: "F9a LCDPR pendente",
    person_id: c.participante.id, apportionment: [{ financial_category_id: semTipo, cost_center_id: c.centro, percentage: "100" }]
  });
  await api(page, "POST", "/api/financial/bank-movements", {
    empresa_id: c.empresa.id, bank_account_id: bb.id, movement_date: hoje(), type: "out", category_type: "internal_transfer", destination_account_id: outra.id, amount: "111.11", document: docTransf, note: "F9a LCDPR transferência"
  });
  // PREMISSA (API): a entrada tem o imóvel padrão (o servidor aplicou) e cai em Pendentes por falta de tipo; a
  // transferência não aparece em lado nenhum.
  expect((await api<{ imovel_rural_id: string | null }>(page, "GET", `/api/financial/bank-movements/${entrada.id}`)).imovel_rural_id, "premissa: o movimento levou o imóvel padrão").toBe(c.imovel.id);
  const pendentes = await conferenciaNaApi(page, c.empresa.id, "pendentes");
  const conferidas = await conferenciaNaApi(page, c.empresa.id, "conferidas");
  expect(pendentes.itens.map((l) => [l.documento, l.tipo, l.entrada]), "premissa: só a entrada, sem tipo").toEqual([[docEntrada, null, "222.22"]]);
  expect(conferidas.total, "premissa: nada conferido").toBe(0);
  expect(pendentes.pendencias.sem_tipo, "premissa: a pendência sem tipo").toEqual({ quantidade: 1, valor: "222.22" });
  expect(pendentes.pendencias.sem_imovel.quantidade, "premissa: o imóvel não falta").toBe(0);

  const card = await abrirConferencia(page, c.empresa);
  await expect(card.getByTestId("lcdpr-filtro-situacao"), "a conferência abre em Conferidas").toHaveValue("conferidas");
  await expect(linhasDaTabela(card), "em Conferidas, nada").toHaveCount(0);
  await expect(card.getByText("Nenhum lançamento conferido no período.")).toBeVisible();
  await expect(card.getByTestId("lcdpr-pendencia-sem-tipo")).toContainText("Sem tipo no LCDPR: 1 (R$ 222,22)");

  const pendentesNaTela = page.waitForResponse((r) => r.url().includes("/api/financeiro/lcdpr/conferencia") && r.url().includes("situacao=pendentes"));
  await card.getByTestId("lcdpr-filtro-situacao").selectOption("pendentes");
  expect((await pendentesNaTela).status()).toBe(200);
  const linha = linhasDaTabela(card);
  await expect(linha, "em Pendentes, só a entrada sem tipo").toHaveCount(1);
  await expect(linha).toContainText(docEntrada);
  await expect(linha).toContainText("Sem tipo");
  await expect(linha).toContainText(c.imovel.nome);
  await expect(card.getByText(docTransf), "a transferência entre contas fica fora do livro").toHaveCount(0);
});
