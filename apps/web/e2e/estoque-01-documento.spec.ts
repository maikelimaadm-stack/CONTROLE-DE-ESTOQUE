import { test, expect } from "@playwright/test";
import { login, api } from "./helpers";
import { cadastroDeEstoque, criarTopDeEstoque, entradaConfirmadaPelaApi, escolherNaReferencia, saldoNoServidor } from "./estoque-01-comum";

/**
 * DOCUMENTO DE ESTOQUE — o caminho do operador (ESTOQUE-01, decisão 274).
 *
 * A integração (ES-1..ES-11) prova no servidor as recusas, a trava do ajuste, o estorno e o escopo. O que só este
 * arquivo prova é o elo da TELA: Estoque › Movimentações › `+ Novo` → TOP de estoque → Central de Estoque → salvar
 * (aberto, saldo intacto) → consulta → Confirmar com a prévia → o documento aparece na lista única e o saldo muda —
 * e o servidor diz o mesmo (saldo lido pela API, não pela tela).
 *
 * Cada execução cria as PRÓPRIAS TOPs e o PRÓPRIO produto (pela API): a produção não tem TOP de estoque, e a conta
 * nunca depende do que outro spec deixou no banco.
 */
type DocLido = {
  codigo: string; especie: string; situacao: string; tipo_operacao: { id: string } | null;
  itens: { quantidade: string | null; quantidade_contada: string | null; custo_unitario: string | null; saldo_na_confirmacao: string | null; diferenca: string | null }[];
  movimentos: { movement_type: string; quantity: string; unit_cost: string }[];
};

test("ES-W1 — Estoque › Movimentações › Novo → TOP de entrada → Central → salvar (saldo intacto) → confirmar com prévia → na lista e no saldo", async ({ page }) => {
  await login(page);
  const { id: top } = await criarTopDeEstoque(page, "entrada");
  const c = await cadastroDeEstoque(page);
  expect(Number((await saldoNoServidor(page, c.armazem, c.produto)).quantity), "premissa: produto novo, sem saldo").toBe(0);

  // (1) O PORTAL: a aba Movimentações, e o `+ Novo` abre a janela de TOPs com a de entrada recém-criada.
  await page.goto("/estoque?tab=movimentacoes");
  await expect(page.getByTestId("estoque-movimentacoes"), "a aba nova do Portal de Estoque abre").toBeVisible();
  await expect(page.getByTestId("estoque-movimentacoes-indisponivel"), "a API deste HEAD serve a lista única").toHaveCount(0);
  await page.getByTestId("estoque-novo").click();
  const lancador = page.getByTestId("lancador-unificado");
  await expect(lancador).toBeVisible();
  await lancador.locator(`[data-testid="lancador-top"][data-top-id="${top}"]`).click();
  await page.getByTestId("lancador-lancar").click();
  await expect(page).toHaveURL(new RegExp(`/estoque/movimentacoes/entradas/new\\?tipo_operacao_id=${top}`));

  // (2) A CENTRAL DE ESTOQUE em modo criação: TOP travada, armazém, um item com quantidade e custo.
  const central = page.getByTestId("estoque-central");
  await expect(central).toBeVisible();
  await expect(central).toHaveAttribute("data-especie", "entrada");
  await expect(central).toHaveAttribute("data-modo", "criacao");
  await expect(page.getByTestId("estoque-central-top"), "a TOP escolhida vem travada").toHaveAttribute("data-tipo-operacao-id", top);
  await escolherNaReferencia(page, page.getByTestId("estoque-central-armazem"), c.nomeArmazem);
  await page.getByTestId("estoque-item-adicionar").click();
  const linha = page.getByTestId("estoque-item").first();
  await escolherNaReferencia(page, linha.getByTestId("estoque-item-produto"), c.nomeProduto);
  // Vírgula de digitação: a Central a manda como ponto, em TEXTO canônico (nunca float).
  await linha.getByTestId("estoque-item-quantidade").fill("5");
  await linha.getByTestId("estoque-item-custo").fill("12,5");
  await page.getByTestId("estoque-salvar").click();

  // (3) A CONSULTA: aberto — e SALVAR NÃO MEXE NO SALDO (a decisão do Maike: o saldo muda na confirmação).
  await expect(page).toHaveURL(/\/estoque\/movimentacoes\/entradas\/[0-9a-f-]{36}$/);
  const id = /\/estoque\/movimentacoes\/entradas\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
  await expect(central).toHaveAttribute("data-modo", "consulta");
  await expect(central).toHaveAttribute("data-situacao", "aberto");
  const aberto = await api<DocLido>(page, "GET", `/api/estoque/entradas/${id}`);
  expect(aberto, "o servidor gravou o que a tela mostrou").toMatchObject({ especie: "entrada", situacao: "aberto", tipo_operacao: { id: top } });
  expect(aberto.itens.map((i) => [i.quantidade, i.custo_unitario]), "números exatos, como texto").toEqual([["5.0000", "12.500000"]]);
  expect(aberto.movimentos, "aberto não tem movimento").toEqual([]);
  expect(Number((await saldoNoServidor(page, c.armazem, c.produto)).quantity), "salvar não muda o saldo").toBe(0);
  await expect(page.getByTestId("estoque-central-codigo")).toHaveText(aberto.codigo);

  // (4) CONFIRMAR COM A PRÉVIA: o saldo de agora (0) e o de depois (5), sem falta.
  await page.getByTestId("estoque-confirmar").click();
  await expect(page.getByTestId("estoque-previa")).toBeVisible();
  const itemDaPrevia = page.getByTestId("estoque-previa-item");
  await expect(itemDaPrevia).toHaveCount(1);
  await expect(itemDaPrevia).toHaveAttribute("data-saldo-atual", "0.0000");
  await expect(itemDaPrevia).toHaveAttribute("data-saldo-depois", "5.0000");
  await expect(itemDaPrevia).toHaveAttribute("data-insuficiente", "false");
  await page.getByTestId("estoque-previa-confirmar").click();

  // (5) O DOCUMENTO mostra o movimento — e o servidor diz o mesmo: entrada pelo custo informado.
  await expect(central).toHaveAttribute("data-situacao", "confirmado");
  await expect(page.getByTestId("estoque-central-movimentos")).toContainText(c.nomeProduto);
  const confirmado = await api<DocLido>(page, "GET", `/api/estoque/entradas/${id}`);
  expect(confirmado.movimentos.map((m) => m.movement_type), "a entrada é o movimento 'entry' — o da espécie").toEqual(["entry"]);
  expect(Number(confirmado.movimentos[0]!.quantity)).toBe(5);
  expect(Number(confirmado.movimentos[0]!.unit_cost), "o custo informado na entrada").toBe(12.5);
  const saldo = await saldoNoServidor(page, c.armazem, c.produto);
  expect(saldo.quantity, "a entrada vale no servidor").toBe("5.0000");

  // (6) NA LISTA ÚNICA: a linha do documento, confirmada.
  await page.goto("/estoque?tab=movimentacoes");
  const naLista = page.locator(`[data-testid="estoque-doc-linha"][data-especie="entrada"][data-codigo="${confirmado.codigo}"]`);
  await expect(naLista, "o documento aparece na lista única").toBeVisible();
  await expect(naLista).toHaveAttribute("data-situacao", "confirmado");

  // (7) NO SALDO (a tela antiga do saldo, que não mudou): o produto no armazém, com as 5 unidades.
  await page.goto(`/estoque?tab=estoque&sub=saldo&product_id=${c.produto}`);
  const doSaldo = page.getByRole("row").filter({ hasText: c.nomeProduto }).first();
  await expect(doSaldo, "o saldo novo aparece na tela de saldo").toBeVisible();
  await expect(doSaldo).toContainText("5,0000");
});

test("ES-W2 — ajuste (inventário): a prévia mostra saldo, contado e a DIFERENÇA; confirmado, o saldo vira a contagem", async ({ page }) => {
  await login(page);
  const { id: topEntrada } = await criarTopDeEstoque(page, "entrada");
  const { id: topAjuste } = await criarTopDeEstoque(page, "ajuste");
  const c = await cadastroDeEstoque(page);
  // Partida: 5 unidades a 10,00 (entrada confirmada pela API — o caso aqui é o ajuste, não a entrada).
  await entradaConfirmadaPelaApi(page, { top: topEntrada, empresa: c.empresa, armazem: c.armazem, produto: c.produto }, "5", "10");
  expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity, "premissa: a partida é 5").toBe("5.0000");

  // A Central direto pela rota de criação com a TOP (o `+ Novo` é o ES-W1): contagem de 3.
  await page.goto(`/estoque/movimentacoes/ajustes/new?tipo_operacao_id=${topAjuste}`);
  const central = page.getByTestId("estoque-central");
  await expect(central).toHaveAttribute("data-especie", "ajuste");
  await expect(central).toHaveAttribute("data-modo", "criacao");
  await escolherNaReferencia(page, page.getByTestId("estoque-central-armazem"), c.nomeArmazem);
  await page.getByTestId("estoque-item-adicionar").click();
  const linha = page.getByTestId("estoque-item").first();
  await escolherNaReferencia(page, linha.getByTestId("estoque-item-produto"), c.nomeProduto);
  await expect(linha.getByTestId("estoque-item-quantidade"), "no ajuste se informa a CONTAGEM, não a quantidade").toHaveCount(0);
  await expect(linha.getByTestId("estoque-item-custo"), "o ajuste não tem custo informado").toHaveCount(0);
  await linha.getByTestId("estoque-item-quantidade-contada").fill("3");
  await page.getByTestId("estoque-salvar").click();
  await expect(page).toHaveURL(/\/estoque\/movimentacoes\/ajustes\/[0-9a-f-]{36}$/);
  const id = /\/estoque\/movimentacoes\/ajustes\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
  await expect(central).toHaveAttribute("data-situacao", "aberto");
  expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity, "salvar o ajuste não muda o saldo").toBe("5.0000");

  // A PRÉVIA: saldo 5, contado 3, diferença −2 (uma saída por correção), sem bloqueio.
  await page.getByTestId("estoque-confirmar").click();
  await expect(page.getByTestId("estoque-previa")).toBeVisible();
  const itemDaPrevia = page.getByTestId("estoque-previa-item");
  await expect(itemDaPrevia).toHaveCount(1);
  await expect(itemDaPrevia).toHaveAttribute("data-saldo-atual", "5.0000");
  await expect(itemDaPrevia).toHaveAttribute("data-saldo-depois", "3.0000");
  await expect(itemDaPrevia).toHaveAttribute("data-diferenca", "-2.0000");
  await expect(itemDaPrevia).toHaveAttribute("data-insuficiente", "false");
  await expect(itemDaPrevia, "a diferença está escrita na prévia, não só no atributo").toContainText("2,0000");
  await page.getByTestId("estoque-previa-confirmar").click();

  // CONFIRMADO: o saldo é a contagem; o item guarda o saldo lido sob a trava e a diferença.
  await expect(central).toHaveAttribute("data-situacao", "confirmado");
  const lido = await api<DocLido>(page, "GET", `/api/estoque/ajustes/${id}`);
  expect(lido.itens.map((i) => [i.quantidade_contada, i.saldo_na_confirmacao, i.diferenca]), "o item guarda contagem, saldo e diferença").toEqual([["3.0000", "5.0000", "-2.0000"]]);
  expect(lido.movimentos.map((m) => m.movement_type), "diferença negativa → 'correction_out'").toEqual(["correction_out"]);
  expect(Number(lido.movimentos[0]!.quantity)).toBe(2);
  expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity, "o saldo é a contagem").toBe("3.0000");
});
