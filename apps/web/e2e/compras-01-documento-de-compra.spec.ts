import { test, expect, type Page } from "@playwright/test";
import { login, api, uniq, empresaAtiva, primeiroId } from "./helpers";

/**
 * DOCUMENTO DE COMPRA — o caminho do operador (COMPRAS-01, decisão 267).
 *
 * A integração (CO-1..CO-8) prova as recusas, o rateio, a concorrência e o estorno no servidor. O que só este
 * arquivo prova é o elo da tela: Compras › Documentos › Novo → TOP de Compra → Central de Compras → salvar →
 * consulta → Confirmar com a prévia → a entrada no estoque e as contas a pagar aparecem NO DOCUMENTO, e o
 * servidor diz o mesmo (saldo e custo lidos pela API, não pela tela).
 *
 * Cada execução cria a PRÓPRIA TOP e o PRÓPRIO produto (pela API): a conta nunca depende do que outro spec
 * deixou no banco.
 */
type Opcao = { id: string; label: string };
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
/** Escolhe no RefSelect pelo rótulo do campo — o nome vai escapado (nomes do seed têm colchetes). */
async function escolher(page: Page, rotulo: string, nome: string) {
  const campo = page.getByTestId("compras-central").locator("label", { hasText: rotulo }).first().locator("..");
  await campo.locator("button").first().click();
  await page.getByPlaceholder("Pesquisar...").fill(nome.slice(0, 20));
  await page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last().getByRole("option", { name: literal(nome.slice(0, 20)) }).first().click();
}
async function escolherNaLinha(page: Page, botao: import("@playwright/test").Locator, nome: string) {
  await botao.click();
  await page.getByPlaceholder("Pesquisar pela descrição").fill(nome.slice(0, 20));
  await page.getByRole("option", { name: literal(nome.slice(0, 20)) }).first().click();
}
type Saldo = { quantity: string; average_cost?: string };

async function cadastroDaCompra(page: Page) {
  const codigo = `6${Math.floor(Math.random() * 90000 + 10000)}`;
  const top = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase: "compras.compra", nome: uniq("Compra E2E") });
  const unidades = await api<Opcao[]>(page, "GET", "/api/resources/measurement_units/options");
  const un = unidades.find((u) => u.label.toUpperCase() === "UN");
  expect(un, "premissa: o seed tem a unidade UN").toBeTruthy();
  const grupos = await api<Opcao[]>(page, "GET", "/api/resources/product_groups/options?kind=analytic");
  const naturezas = await api<Opcao[]>(page, "GET", "/api/resources/financial_categories/options?kind=analytic&nature=expense");
  expect(naturezas.length, "premissa: há natureza de despesa analítica").toBeGreaterThan(0);
  const produto = await api<{ id: string }>(page, "POST", "/api/resources/products", { description: uniq("CO-W produto"), group_id: grupos[0]!.id, measurement_id: un!.id, financial_category_id: naturezas[0]!.id });
  const nomeProduto = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${produto.id}`))["description"]);
  const empresa = await empresaAtiva(page);
  const armazem = await primeiroId(page, `/api/resources/warehouses?empresa_id=${empresa}&pageSize=1`);
  const nomeArmazem = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${armazem}`))["description"]);
  const fornecedor = await primeiroId(page, "/api/resources/people?is_provider=true&pageSize=1");
  const nomeFornecedor = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${fornecedor}`))["name"]);
  const centros = await api<Opcao[]>(page, "GET", "/api/resources/cost_centers/options?kind=analytic");
  expect(centros.length, "premissa: há centro analítico").toBeGreaterThan(0);
  return { top: top.id, produto: produto.id, nomeProduto, armazem, nomeArmazem, fornecedor, nomeFornecedor, natureza: naturezas[0]!, centro: centros[0]! };
}

test("CO-W1 — Compras › Novo → TOP de Compra → Central → salvar → consulta → confirmar com prévia → entrada e títulos no documento", async ({ page }) => {
  await login(page);
  const c = await cadastroDaCompra(page);
  const saldoAntes = await api<Saldo>(page, "GET", `/api/stock/balances/${c.armazem}/${c.produto}`).catch(() => ({ quantity: "0" }));
  expect(Number(saldoAntes.quantity), "premissa: produto novo, sem saldo").toBe(0);

  // (1) O PORTAL: a aba Documentos é a padrão, e o `+ Novo` abre a janela de TOPs, com a de Compra.
  await page.goto("/compras");
  await expect(page.getByTestId("compras-documentos"), "Documentos é a aba padrão de Compras").toBeVisible();
  await page.getByTestId("compras-novo").click();
  const lancador = page.getByTestId("lancador-unificado");
  await expect(lancador).toBeVisible();
  await lancador.locator(`[data-testid="lancador-top"][data-top-id="${c.top}"]`).click();
  await page.getByTestId("lancador-lancar").click();
  await expect(page).toHaveURL(new RegExp(`/compras/compras/new\\?tipo_operacao_id=${c.top}`));

  // (2) A CENTRAL DE COMPRAS: cabeçalho, frete e um item com armazém.
  const central = page.getByTestId("compras-central");
  await expect(central).toBeVisible();
  await expect(central).toHaveAttribute("data-especie", "compra");
  await escolher(page, "Fornecedor", c.nomeFornecedor);
  await escolher(page, "Natureza de despesa", c.natureza.label);
  await escolher(page, "Centro de resultado", c.centro.label);
  await page.getByTestId("compras-frete").fill("10.00");
  const itens = page.getByTestId("compras-itens");
  await itens.getByTestId("central-compras-adicionar-item").click();
  const linha = itens.locator("tbody tr").first();
  await escolherNaLinha(page, linha.getByTestId("central-compras-armazem"), c.nomeArmazem);
  await escolherNaLinha(page, linha.getByTestId("central-compras-produto"), c.nomeProduto);
  await linha.getByLabel("Quantidade do item 1").fill("5");
  await linha.getByLabel("Valor unitário do item 1").fill("20");
  // 5 × 20,00 + frete 10,00 = 110,00.
  await expect(page.getByTestId("compras-total")).toContainText("110,00");
  await page.getByTestId("compras-salvar").click();

  // (3) A CONSULTA: aberta, com o total do servidor.
  await expect(page).toHaveURL(/\/compras\/compras\/[0-9a-f-]{36}$/);
  const id = /\/compras\/compras\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
  const corpo = page.getByTestId("compras-consulta-corpo");
  await expect(corpo).toHaveAttribute("data-situacao", "aberto");
  await expect(page.getByTestId("compras-consulta-total")).toContainText("110,00");
  const doc = await api<{ situacao: string; valor_total: string; tipo_operacao: { id: string } }>(page, "GET", `/api/compras/compras/${id}`);
  expect(doc, "o servidor gravou o que a tela mostrou").toMatchObject({ situacao: "aberto", valor_total: "110.00", tipo_operacao: { id: c.top } });

  // (4) CONFIRMAR COM A PRÉVIA: a prévia diz a entrada (com o custo do frete) e o título antes de confirmar.
  await page.getByTestId("compras-confirmar").click();
  const previa = page.getByTestId("compras-previa");
  await expect(previa).toHaveAttribute("data-situacao", "pronta");
  await expect(page.getByTestId("compras-previa-estoque")).toContainText(c.nomeProduto);
  await expect(page.getByTestId("compras-previa-estoque")).toContainText("110,00");
  await expect(page.getByTestId("compras-previa-financeiro")).toContainText("110,00");
  await page.getByTestId("confirm-dialog-confirm").click();

  // (5) O DOCUMENTO mostra a entrada e as contas a pagar — e o servidor diz o mesmo.
  await expect(corpo).toHaveAttribute("data-situacao", "confirmado");
  await page.getByRole("tab", { name: /^Estoque/ }).click();
  await expect(page.getByTestId("compras-consulta-movimentos")).toContainText(c.nomeProduto);
  await page.getByRole("tab", { name: /^Financeiro/ }).click();
  await expect(page.getByTestId("compras-consulta-titulos")).toContainText("110,00");
  const saldo = await api<Saldo>(page, "GET", `/api/stock/balances/${c.armazem}/${c.produto}`);
  expect(saldo.quantity, "a entrada vale no servidor").toBe("5.0000");
  const lido = await api<{ movimentos: { unit_cost: string }[]; titulos: { amount: string; direction?: string }[] }>(page, "GET", `/api/compras/compras/${id}`);
  expect(lido.movimentos.length).toBe(1);
  expect(Number(lido.movimentos[0]!.unit_cost), "o frete entrou no custo: 110 ÷ 5").toBe(22);
  expect(lido.titulos.map((t) => t.amount)).toEqual(["110.00"]);
});
