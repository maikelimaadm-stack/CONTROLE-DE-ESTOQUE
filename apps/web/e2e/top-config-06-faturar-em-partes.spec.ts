import { test, expect, type Page } from "@playwright/test";
import { login, api, uniq, empresaAtiva, primeiroId } from "./helpers";

/**
 * FATURAR EM PARTES — o caminho do operador (TOP-CONFIG-06, decisão 265).
 *
 * A integração prova as contas e as recusas no servidor. O que só este arquivo prova é o elo da tela:
 * o diálogo de conversão mostra os itens com saldo quando a aresta é "Em partes", manda só o que foi
 * marcado, o pedido passa a exibir Faturado e Saldo, e o cancelamento de uma parte devolve o saldo à
 * tela. E, no editor da TOP, que a caixa "Em partes" existe e grava.
 */
async function cadastrarTop(page: Page, codigoBase: string, nome: string, extra: Record<string, unknown> = {}) {
  const codigo = `7${Math.floor(Math.random() * 90000 + 10000)}`;
  const criado = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase, nome, ...extra });
  return { id: criado.id, codigo };
}

type Item = { id: string; quantity: string; faturado?: string; saldo?: string };
const pedidoNoServidor = (page: Page, id: string) =>
  api<{ status: string; items: Item[] }>(page, "GET", `/api/sales/orders/${id}`);

test("FP-W1 — pedido de 2 itens: converte parte, mostra Faturado/Saldo, converte o resto, cancela uma parte e o saldo volta", async ({ page }) => {
  await login(page);
  const empresa = await empresaAtiva(page);
  const topVenda = await cadastrarTop(page, "vendas.venda", uniq("Venda em partes"));
  const topPedido = await cadastrarTop(page, "vendas.pedido", uniq("Pedido em partes"),
    { destinos: [{ tipoOperacaoId: topVenda.id, ordem: 0, emPartes: true }] });

  const cliente = await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1");
  const produtos = await api<{ items: { id: string }[] }>(page, "GET", "/api/resources/products?pageSize=2");
  expect(produtos.items, "a premissa: dois produtos para dois itens").toHaveLength(2);
  const pedido = await api<{ id: string }>(page, "POST", "/api/sales/orders", {
    empresa_id: empresa, document_date: "2026-09-01", client_id: cliente, tipo_operacao_id: topPedido.id,
    items: [
      { product_id: produtos.items[0]!.id, warehouse_id: null, quantity: "10", unit_price: "5.00" },
      { product_id: produtos.items[1]!.id, warehouse_id: null, quantity: "2", unit_price: "7.00" },
    ],
  });
  const [a, b] = (await pedidoNoServidor(page, pedido.id)).items;

  // (1) PARTE: 4 do primeiro item, o segundo fica de fora.
  await page.goto(`/vendas/orders/${pedido.id}`);
  await expect(page.getByTestId("central-vendas"), "a premissa: o pedido abriu").toBeVisible();
  await page.getByTestId("acao-conversao").click();
  const dialogo = page.getByTestId("dialog-conversao");
  await expect(dialogo.getByTestId("conversao-itens"), "aresta 'Em partes' mostra a tabela de itens").toBeVisible();
  await dialogo.getByTestId(`conversao-item-${b!.id}-incluir`).uncheck();
  await dialogo.getByTestId(`conversao-item-${a!.id}-quantidade`).fill("4");
  await dialogo.getByRole("button", { name: "Converter" }).click();
  await expect(page).toHaveURL(/\/vendas\/sales\//);
  const parte1 = page.url().split("/").pop()!.split("?")[0]!;
  await expect(page.getByTestId("parte-itens-da-origem"), "a parte diz de onde veio").toBeVisible();

  // (2) O PEDIDO MOSTRA FATURADO E SALDO — e continua aberto.
  let srv = await pedidoNoServidor(page, pedido.id);
  expect(srv.status).not.toBe("converted");
  expect(srv.items.map((i) => i.saldo)).toEqual(["6.0000", "2.0000"]);
  await page.goto(`/vendas/orders/${pedido.id}`);
  await expect(page.getByTestId("doc-item-faturado")).toHaveText(["4,00", "0,00"]);
  await expect(page.getByTestId("doc-item-saldo")).toHaveText(["6,00", "2,00"]);

  // (3) O RESTO: saldo inteiro → o pedido vira Convertido.
  await page.getByTestId("acao-conversao").click();
  await expect(page.getByTestId(`conversao-item-${a!.id}-quantidade`), "a quantidade começa no saldo").toHaveValue(/^6/);
  await page.getByTestId("dialog-conversao").getByRole("button", { name: "Converter" }).click();
  await expect(page).toHaveURL(/\/vendas\/sales\//);
  srv = await pedidoNoServidor(page, pedido.id);
  expect(srv.status, "o saldo zerou").toBe("converted");
  await page.goto(`/vendas/orders/${pedido.id}`);
  await expect(page.getByTestId("central-vendas").getByText("Convertido").first()).toBeVisible();
  await expect(page.getByTestId("doc-item-saldo")).toHaveText(["0,00", "0,00"]);

  // (4) CANCELAR UMA PARTE DEVOLVE O SALDO — e o pedido volta a aberto.
  await api(page, "POST", `/api/sales/sales/${parte1}/cancel`, {});
  srv = await pedidoNoServidor(page, pedido.id);
  expect(srv.status).toBe("open");
  await page.reload();
  await expect(page.getByTestId("doc-item-saldo")).toHaveText(["4,00", "0,00"]);
  await expect(page.getByTestId("acao-conversao"), "com saldo, a conversão volta a ser oferecida").toBeVisible();
});

test("FP-W2 — editor da TOP: a caixa 'Em partes' aparece no destino e grava", async ({ page }) => {
  await login(page);
  const topVenda = await cadastrarTop(page, "vendas.venda", uniq("Venda W2"));
  const topPedido = await cadastrarTop(page, "vendas.pedido", uniq("Pedido W2"),
    { destinos: [{ tipoOperacaoId: topVenda.id, ordem: 0 }] });

  await page.goto("/configuracoes?tab=operacoes&sub=tipos-operacao");
  await expect(page.getByRole("heading", { name: "Tipos de Operação" })).toBeVisible();
  await page.getByLabel("Buscar tipo de operação").fill(topPedido.codigo);
  const linha = page.getByRole("row").filter({ hasText: topPedido.codigo });
  await expect(linha).toHaveCount(1);
  await linha.getByRole("button", { name: "Mais opções" }).click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const forma = page.getByTestId("form-tipo-operacao");
  await forma.getByTestId("top-aba-destinos").click();
  const caixa = forma.getByTestId(`top-destino-${topVenda.id}-em-partes`);
  await expect(caixa, "a aresta nasce sem 'Em partes'").not.toBeChecked();
  await caixa.check();
  await forma.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(async () => (await api<{ destinos: { tipoOperacaoId: string; emPartes?: boolean }[] }>(page, "GET", `/api/admin/tipos-operacao/${topPedido.id}`))
    .destinos.find((d) => d.tipoOperacaoId === topVenda.id)?.emPartes, { message: "o servidor gravou 'Em partes'" }).toBe(true);
});
