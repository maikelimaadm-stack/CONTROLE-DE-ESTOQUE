import { test, expect, type Locator, type Page } from "@playwright/test";
import { login, api, empresaAtiva } from "./helpers";

/**
 * OPERACOES-01 F8 — CENTRAL FINANCEIRA · TÍTULOS (decisão 285).
 *
 * Três cenários, do jeito que o usuário trabalha, com os dados nascendo pela API REAL e a premissa conferida pela API
 * antes de qualquer tela (o detalhe das regras mora nos testes de API e de banco da fase):
 *   1. o caminho principal: busca no servidor, o cartão "A vencer" contando e filtrando, seleção dos dois títulos do
 *      mesmo fornecedor e BAIXA EM LOTE com movimento único — os dois "Baixado", o rodapé com saldo zero, e pela API um
 *      movimento só com o total e o MESMO lote nas duas baixas;
 *   2. o ESTORNO da baixa em lote, com motivo: os dois voltam a "A vencer" e o movimento único fica cancelado (nunca
 *      apagado), com o motivo na trilha;
 *   3. a recusa: em "Todos", um título a pagar e um a receber selecionados não se baixam juntos (o botão desabilita e
 *      diz por quê) — e com um só ele habilita, para a recusa não ser um botão que nunca funciona.
 */

interface Fixture { empresa: string; conta: { id: string; descricao: string }; fornecedor: string; cliente: string; despesa: string; receita: string; centro: string }
type Direcao = "payable" | "receivable";

async function umId(page: Page, caminho: string, oQue: string): Promise<string> {
  const r = await api<{ items: { id: string }[] }>(page, "GET", caminho);
  expect(r.items?.[0]?.id, `premissa: o seed tem ${oQue}`).toBeTruthy();
  return r.items[0]!.id;
}

async function fixture(page: Page): Promise<Fixture> {
  const contas = await api<{ items: { id: string; code: string; description: string }[] }>(page, "GET", "/api/financial/bank-accounts/balances");
  const bb = contas.items.find((c) => c.code === "BB");
  expect(bb, "premissa: a conta BB do seed").toBeTruthy();
  return {
    empresa: await empresaAtiva(page),
    conta: { id: bb!.id, descricao: bb!.description },
    fornecedor: await umId(page, "/api/resources/people?is_provider=true&pageSize=1", "um fornecedor"),
    cliente: await umId(page, "/api/resources/people?is_client=true&pageSize=1", "um cliente"),
    despesa: await umId(page, "/api/resources/financial_categories?kind=analytic&nature=expense&pageSize=1", "uma natureza de despesa analítica"),
    receita: await umId(page, "/api/resources/financial_categories?kind=analytic&nature=income&pageSize=1", "uma natureza de receita analítica"),
    centro: await umId(page, "/api/resources/cost_centers?kind=analytic&pageSize=1", "um centro de resultado analítico")
  };
}

/** Um título pela porta REAL de hoje, com vencimento no futuro (é "A vencer" pela régua do banco). */
async function criarTitulo(page: Page, fx: Fixture, dir: Direcao, numero: string, valor: string): Promise<string> {
  const r = await api<{ id: string }>(page, "POST", `/api/financial/${dir}s`, {
    empresa_id: fx.empresa, number: numero, person_id: dir === "payable" ? fx.fornecedor : fx.cliente, amount: valor,
    emission_date: "2026-01-10", due_date: "2031-03-10", note: `Central Financeira E2E ${numero}`,
    apportionment: [{ financial_category_id: dir === "payable" ? fx.despesa : fx.receita, cost_center_id: fx.centro, percentage: "100" }]
  });
  expect(r.id, "a API devolve o id do título").toBeTruthy();
  return r.id;
}

interface Linha { id: string; numero: string; situacao: string; saldo: string; direcao: Direcao }
interface Pagina { items: Linha[]; total: number; direcoes: Direcao[]; cartoes: Record<string, { quantidade: number; valor: string }> }
const daCentral = (page: Page, direcao: Direcao | "todos", busca: string) => api<Pagina>(page, "GET", `/api/financeiro/titulos?direcao=${direcao}&busca=${encodeURIComponent(busca)}`);

interface Baixa { id: string; status: string; lote_id: string | null; bank_movement_id: string | null; cancel_reason: string | null }
const tituloNaApi = (page: Page, dir: Direcao, id: string) => api<{ status: string; balance: string; settlements: Baixa[] }>(page, "GET", `/api/financial/${dir}s/${id}`);

/** Abre a aba de títulos, filtra pela busca (no servidor) e devolve a lista. */
async function abrirTitulos(page: Page, sub: "pagar" | "receber" | "todos", busca: string): Promise<Locator> {
  await page.goto(`/financeiro?tab=titulos&sub=${sub}`);
  const central = page.getByTestId("fin-titulos");
  await expect(central).toBeVisible();
  await central.getByLabel("Busca").fill(busca);
  await central.getByRole("button", { name: "Filtrar" }).click();
  return central;
}
const linhaDo = (central: Locator, numero: string) => central.locator("tbody tr").filter({ hasText: numero });

/** Escolhe uma conta no seletor de referência do campo `rotulo`, dentro do diálogo. */
async function escolherConta(page: Page, dialogo: Locator, rotulo: string, busca: string) {
  await dialogo.locator("label", { hasText: rotulo }).first().locator("..").locator("button").first().click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(busca);
  await painel.getByRole("option", { name: new RegExp(busca, "i") }).first().click();
}

test("Central Financeira · títulos → cartão A vencer, baixa em lote com movimento único, rodapé zerado e um lote só", async ({ page }) => {
  await login(page);
  const fx = await fixture(page);
  const prefixo = `CFT${Date.now().toString(36)}`.toUpperCase();
  const a = await criarTitulo(page, fx, "payable", `${prefixo}-A`, "150.00");
  const b = await criarTitulo(page, fx, "payable", `${prefixo}-B`, "250.00");

  // PREMISSA (API): os dois existem, estão "a vencer", e o cartão conta os dois pelo recorte da busca.
  const antes = await daCentral(page, "payable", prefixo);
  expect(antes.total, "premissa: a busca recorta exatamente os dois títulos do caso").toBe(2);
  expect(antes.items.map((i) => i.situacao), "premissa: os dois estão a vencer").toEqual(["a_vencer", "a_vencer"]);
  expect(antes.cartoes["a_vencer"]!.quantidade).toBe(2);
  expect(antes.cartoes["a_vencer"]!.valor).toBe("400.00");

  const central = await abrirTitulos(page, "pagar", prefixo);
  await expect(central).toHaveAttribute("data-direcao", "payable");
  const cartao = page.getByTestId("fin-cartao-a_vencer");
  await expect(cartao.getByTestId("fin-cartao-quantidade"), "o cartão conta pelo MESMO recorte da lista").toHaveText("2");
  await expect(page.getByTestId("fin-cartao-previstos"), "Previstos existe e é declarado indisponível (F9)").toBeDisabled();
  await expect(page.getByTestId("fin-cartao-previstos")).toHaveAttribute("title", "Os previstos chegam com a provisão pela TOP");
  // O cartão também FILTRA (no servidor): ligado, a lista são os dois a vencer; desligado, volta.
  await cartao.click();
  await expect(cartao).toHaveAttribute("aria-pressed", "true");
  await expect(linhaDo(central, prefixo)).toHaveCount(2);
  await cartao.click();
  await expect(cartao).toHaveAttribute("aria-pressed", "false");

  await linhaDo(central, `${prefixo}-A`).getByLabel("Selecionar linha").click();
  await linhaDo(central, `${prefixo}-B`).getByLabel("Selecionar linha").click();
  await expect(page.getByTestId("fin-lote-contagem")).toHaveText("2 selecionado(s)");
  await expect(page.getByTestId("fin-lote-baixar")).toBeEnabled();
  await page.getByTestId("fin-lote-baixar").click();

  const dialogo = page.getByTestId("fin-dialogo-baixa-lote");
  await expect(dialogo.getByTestId("fin-baixa-lote-linha"), "a grade traz os dois títulos selecionados").toHaveCount(2);
  await escolherConta(page, dialogo, "Conta bancária", fx.conta.descricao);
  await dialogo.getByLabel("Movimento").selectOption("single");
  await expect(dialogo.getByTestId("fin-baixa-lote-total"), "o total do movimento é a soma dos saldos (decimal)").toContainText("400,00");
  await dialogo.getByRole("button", { name: "Confirmar baixa" }).click();

  const resultado = page.getByTestId("fin-resultado-lote");
  await expect(resultado.getByTestId("fin-resultado-resumo")).toHaveText("2 baixado(s) · 0 pulado(s)");
  await resultado.getByTestId("fin-resultado-fechar").click();

  // TELA: os dois "Baixado" e o rodapé do filtro com saldo zero.
  for (const n of [`${prefixo}-A`, `${prefixo}-B`]) await expect(linhaDo(central, n).locator("[data-status]")).toHaveText("Baixado");
  const rodape = page.getByTestId("fin-titulos-totais");
  await expect(rodape).toHaveCount(1);
  await expect(rodape.locator('[data-total="saldo"]')).toContainText("0,00");
  await expect(rodape.locator('[data-total="pago"]')).toContainText("400,00");

  // CONCLUSÃO (API): pagos; UM movimento com o total; o MESMO lote nas duas baixas.
  const ta = await tituloNaApi(page, "payable", a); const tb = await tituloNaApi(page, "payable", b);
  expect([ta.status, tb.status]).toEqual(["paid", "paid"]);
  const [ba] = ta.settlements; const [bb] = tb.settlements;
  expect(ba!.lote_id, "a baixa em lote grava o lote").toBeTruthy();
  expect(bb!.lote_id, "as duas baixas são do MESMO lote").toBe(ba!.lote_id);
  expect(bb!.bank_movement_id, "movimento único: as duas baixas apontam o MESMO movimento").toBe(ba!.bank_movement_id);
  const mov = await api<{ amount: string; status: string }>(page, "GET", `/api/financial/bank-movements/${ba!.bank_movement_id}`);
  expect(mov.amount, "o movimento único é o total do lote").toBe("400.00");
  expect(mov.status).toBe("confirmed");
});

test("Central Financeira · estornar a baixa de um lote único com motivo → títulos a vencer e o movimento cancelado", async ({ page }) => {
  await login(page);
  const fx = await fixture(page);
  const prefixo = `CFE${Date.now().toString(36)}`.toUpperCase();
  const a = await criarTitulo(page, fx, "payable", `${prefixo}-A`, "120.00");
  const b = await criarTitulo(page, fx, "payable", `${prefixo}-B`, "80.00");
  await api(page, "POST", "/api/financial/payables/settle-batch", { ids: [a, b], settlement_date: "2026-01-15", bank_account_id: fx.conta.id, movement_mode: "single" });

  // PREMISSA (API): os dois pagos pelo MESMO movimento, num lote.
  const pa = await tituloNaApi(page, "payable", a); const pb = await tituloNaApi(page, "payable", b);
  expect([pa.status, pb.status], "premissa: o lote baixou os dois").toEqual(["paid", "paid"]);
  const movimento = pa.settlements[0]!.bank_movement_id;
  expect(movimento, "premissa: movimento único").toBeTruthy();
  expect(pb.settlements[0]!.bank_movement_id).toBe(movimento);

  const central = await abrirTitulos(page, "pagar", prefixo);
  for (const n of [`${prefixo}-A`, `${prefixo}-B`]) await expect(linhaDo(central, n).locator("[data-status]")).toHaveText("Baixado");
  await central.getByLabel("Selecionar todos").click();
  await expect(page.getByTestId("fin-lote-contagem")).toHaveText("2 selecionado(s)");
  await page.getByTestId("fin-lote-estornar").click();
  const dialogo = page.getByTestId("fin-dialogo-estorno");
  const confirmar = dialogo.getByRole("button", { name: "Confirmar estorno" });
  await expect(confirmar, "sem motivo não há estorno").toBeDisabled();
  const motivo = `Estorno E2E ${prefixo}`;
  await dialogo.getByLabel(/^Motivo/).fill(motivo);
  await confirmar.click();
  const resultado = page.getByTestId("fin-resultado-lote");
  await expect(resultado.getByTestId("fin-resultado-resumo")).toHaveText("2 estornado(s) · 0 pulado(s)");
  await resultado.getByTestId("fin-resultado-fechar").click();
  for (const n of [`${prefixo}-A`, `${prefixo}-B`]) await expect(linhaDo(central, n).locator("[data-status]")).toHaveText("A vencer");

  // CONCLUSÃO (API): títulos abertos, baixas canceladas com o motivo, movimento CANCELADO (não apagado).
  const da = await tituloNaApi(page, "payable", a); const db = await tituloNaApi(page, "payable", b);
  expect([da.status, db.status]).toEqual(["open", "open"]);
  expect([da.settlements[0]!.status, db.settlements[0]!.status]).toEqual(["cancelled", "cancelled"]);
  expect(da.settlements[0]!.cancel_reason, "o motivo vai para a baixa").toBe(motivo);
  const mov = await api<{ status: string }>(page, "GET", `/api/financial/bank-movements/${movimento}`);
  expect(mov.status, "o movimento único foi estornado uma vez, e continua existindo").toBe("cancelled");
});

test("Central Financeira · em Todos, um a pagar e um a receber não se baixam juntos — o botão diz por quê", async ({ page }) => {
  await login(page);
  const fx = await fixture(page);
  const prefixo = `CFM${Date.now().toString(36)}`.toUpperCase();
  await criarTitulo(page, fx, "payable", `${prefixo}-P`, "90.00");
  await criarTitulo(page, fx, "receivable", `${prefixo}-R`, "60.00");

  // PREMISSA (API): em "Todos" o admin vê as duas direções, e o recorte traz exatamente os dois.
  const todos = await daCentral(page, "todos", prefixo);
  expect(todos.direcoes.sort(), "premissa: o usuário vê as duas direções").toEqual(["payable", "receivable"]);
  expect(todos.items.map((i) => i.direcao).sort()).toEqual(["payable", "receivable"]);

  const central = await abrirTitulos(page, "todos", prefixo);
  await expect(central).toHaveAttribute("data-direcao", "todos");
  await expect(linhaDo(central, prefixo)).toHaveCount(2);
  await expect(page.getByTestId("fin-titulos-totais"), "o rodapé tem uma linha por direção").toHaveCount(2);

  // Uma direção só: o botão funciona.
  await linhaDo(central, `${prefixo}-P`).getByLabel("Selecionar linha").click();
  await expect(page.getByTestId("fin-lote-baixar")).toBeEnabled();
  // As duas direções: o botão desabilita e explica.
  await linhaDo(central, `${prefixo}-R`).getByLabel("Selecionar linha").click();
  const baixar = page.getByTestId("fin-lote-baixar");
  await expect(baixar).toBeDisabled();
  await expect(baixar).toHaveAttribute("title", "Selecione títulos de uma só direção");
  await expect(page.getByTestId("fin-dialogo-baixa-lote")).toHaveCount(0);
});
