import { test, expect, type Page } from "@playwright/test";
import { login, api, uniq, empresaAtiva, primeiroId, abrirLancamentoDeVendas, escolherTopEContinuar } from "./helpers";

/**
 * RESERVA DE ESTOQUE PELO PEDIDO — o caminho do operador (TOP-CONFIG-07, decisão 266).
 *
 * A integração (RE-1..RE-11) prova a conta, as recusas e a concorrência no servidor. O que só este arquivo prova
 * é o elo da tela: a Central mostra o DISPONÍVEL (físico − reservado) do item de um pedido cuja TOP reserva, o
 * documento diz que a reserva está ativa e quanto cada item segura, Estoque › Saldo mostra reservado e
 * disponível do par (inclusive negativo, depois de um acerto de inventário) e, no editor da TOP, a caixa
 * "Reservar estoque ao salvar o pedido" existe só na família pedido e grava.
 *
 * Cada execução cria o PRÓPRIO produto (pela API) com 10 unidades no armazém da empresa ativa: a conta nunca
 * depende do que outro spec deixou no banco.
 */
async function cadastrarTop(page: Page, codigoBase: string, nome: string, extra: Record<string, unknown> = {}) {
  const codigo = `7${Math.floor(Math.random() * 90000 + 10000)}`;
  const criado = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase, nome, ...extra });
  return { id: criado.id, codigo };
}

/** O número como a tela pode formatá-lo (PT-BR, com ou sem casas decimais, com ou sem unidade depois). */
const numero = (n: number) => new RegExp(`^\\s*${n < 0 ? "-\\s?" : ""}${Math.abs(n)}(,0+)?(\\s.*)?$`);

type Saldo = { quantity: string; reservado?: string; disponivel?: string };
const saldoNoServidor = (page: Page, armazem: string, produto: string) => api<Saldo>(page, "GET", `/api/stock/balances/${armazem}/${produto}`);

/** Produto novo com 10 unidades no primeiro armazém da empresa ativa — e a premissa lida no servidor. */
async function produtoCom10(page: Page, empresa: string) {
  const unidades = await api<{ id: string; label: string }[]>(page, "GET", "/api/resources/measurement_units/options");
  const un = unidades.find((u) => u.label.toUpperCase() === "UN");
  expect(un, "premissa: o seed tem a unidade UN").toBeTruthy();
  const grupos = await api<{ id: string }[]>(page, "GET", "/api/resources/product_groups/options?kind=analytic");
  const naturezas = await api<{ id: string }[]>(page, "GET", "/api/resources/financial_categories/options?kind=analytic&nature=expense");
  const criado = await api<{ id: string }>(page, "POST", "/api/resources/products", { description: uniq("RE-W produto com reserva"), group_id: grupos[0]!.id, measurement_id: un!.id, financial_category_id: naturezas[0]!.id });
  const nome = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${criado.id}`))["description"]);
  const armazem = await primeiroId(page, `/api/resources/warehouses?empresa_id=${empresa}&pageSize=1`);
  const nomeArmazem = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${armazem}`))["description"]);
  await api(page, "POST", "/api/stock/opening-balances", { empresa_id: empresa, warehouse_id: armazem, product_id: criado.id, quantity: "10", unit_value: "3" });
  expect((await saldoNoServidor(page, armazem, criado.id)).quantity, "premissa: 10 unidades no armazém").toBe("10.0000");
  return { produto: criado.id, nome, armazem, nomeArmazem };
}

test("RE-W1 — pedido com reserva: a Central mostra o disponível, o documento mostra a reserva e Estoque › Saldo mostra reservado e disponível", async ({ page }) => {
  await login(page);
  const empresa = await empresaAtiva(page);
  const topPedido = await cadastrarTop(page, "vendas.pedido", uniq("Pedido com reserva"), { reservaEstoque: true });
  const c = await produtoCom10(page, empresa);
  const cliente = await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1");

  // O pedido de 8 com reserva, pela API: o servidor passa a dizer físico 10, reservado 8, disponível 2.
  const pedido = await api<{ id: string }>(page, "POST", "/api/sales/orders", {
    empresa_id: empresa, document_date: "2026-09-10", client_id: cliente, tipo_operacao_id: topPedido.id,
    items: [{ product_id: c.produto, warehouse_id: c.armazem, quantity: "8", unit_price: "5.00" }],
  });
  expect(await saldoNoServidor(page, c.armazem, c.produto), "premissa: a reserva vale no servidor").toMatchObject({ quantity: "10.0000", reservado: "8.0000", disponivel: "2.0000" });

  // (1) A CENTRAL de um pedido NOVO com a mesma TOP: o item com o produto e o armazém mostra o DISPONÍVEL.
  await abrirLancamentoDeVendas(page, "orders");
  await escolherTopEContinuar(page, topPedido.id);
  await page.getByRole("button", { name: /Adicionar item/ }).click();
  const linha = page.getByTestId("central-vendas-linha").first();
  const painel = page.getByTestId("central-vendas-pesquisa");
  const escolher = async (celula: string, nome: string) => {
    await linha.getByTestId(celula).click();
    await painel.getByRole("combobox").fill(nome);
    await painel.getByRole("option").filter({ hasText: nome }).first().click();
    await expect(painel).toHaveCount(0);
  };
  await escolher("central-vendas-produto", c.nome);
  await escolher("central-vendas-armazem", c.nomeArmazem);
  const disponivel = linha.getByTestId("central-estoque-disponivel");
  await expect(disponivel, "a célula Estoque mostra o disponível (10 − 8), não o físico").toHaveText(numero(2));
  await expect(disponivel, "a dica diz físico e reservado").toHaveAttribute("title", /Físico 10(,0+)?.*Reservado 8(,0+)?/);

  // (2) O DOCUMENTO do pedido diz que a reserva está ativa e quanto o item segura.
  await page.goto(`/vendas/orders/${pedido.id}`);
  await expect(page.getByTestId("central-vendas"), "premissa: o pedido abriu").toBeVisible();
  await expect(page.getByTestId("doc-reserva-ativa")).toContainText("Reserva de estoque");
  await expect(page.getByTestId("doc-reserva-ativa")).toContainText("ativa");
  await expect(page.getByTestId("doc-item-reservado")).toHaveText([numero(8)]);

  // (3) ESTOQUE › SALDO: reservado e disponível do par, na linha do produto.
  await page.goto(`/estoque?tab=estoque&sub=saldo&product_id=${c.produto}`);
  const linhaSaldo = page.getByRole("row").filter({ hasText: c.nome });
  await expect(linhaSaldo, "premissa: a linha do produto no armazém").toHaveCount(1);
  await expect(linhaSaldo.getByTestId("saldo-reservado")).toHaveText(numero(8));
  await expect(linhaSaldo.getByTestId("saldo-disponivel")).toHaveText(numero(2));

  // (4) Um acerto de inventário abaixo do reservado passa; o disponível fica NEGATIVO e a tela o mostra.
  await api(page, "POST", "/api/stock/corrections", { empresa_id: empresa, correction_date: "2026-09-10", warehouse_id: c.armazem, product_id: c.produto, new_quantity: "5", justification: "RE-W1 contagem" });
  expect(await saldoNoServidor(page, c.armazem, c.produto)).toMatchObject({ quantity: "5.0000", reservado: "8.0000", disponivel: "-3.0000" });
  await page.reload();
  await expect(linhaSaldo.getByTestId("saldo-reservado")).toHaveText(numero(8));
  await expect(linhaSaldo.getByTestId("saldo-disponivel")).toHaveText(numero(-3));

  // (5) CANCELADO, o pedido não segura mais nada: o servidor zera a reserva, e o documento mostra o Reservado 0 do item
  //     (a prova de que a tela carregou o pedido com reserva) SEM dizer que a reserva está "ativa".
  await api(page, "POST", `/api/sales/orders/${pedido.id}/cancel`, {});
  expect(await saldoNoServidor(page, c.armazem, c.produto)).toMatchObject({ quantity: "5.0000", reservado: "0.0000", disponivel: "5.0000" });
  await page.goto(`/vendas/orders/${pedido.id}`);
  await expect(page.getByTestId("doc-item-reservado"), "premissa: o pedido cancelado abriu com a coluna Reservado").toHaveText([numero(0)]);
  await expect(page.getByTestId("doc-reserva-ativa"), "pedido cancelado não diz 'Reserva de estoque: ativa'").toHaveCount(0);
});

test("RE-W2 — editor da TOP: 'Reservar estoque ao salvar o pedido' existe só no pedido e grava", async ({ page }) => {
  await login(page);
  const topPedido = await cadastrarTop(page, "vendas.pedido", uniq("Pedido RE-W2"));
  const topVenda = await cadastrarTop(page, "vendas.venda", uniq("Venda RE-W2"));
  const detalhe = (id: string) => api<{ reservaEstoque?: boolean }>(page, "GET", `/api/admin/tipos-operacao/${id}`);
  expect((await detalhe(topPedido.id)).reservaEstoque, "premissa: a TOP nasce sem reserva").toBe(false);

  const abrirEditor = async (codigo: string) => {
    await page.goto("/configuracoes?tab=operacoes&sub=tipos-operacao");
    await expect(page.getByRole("heading", { name: "Tipos de Operação" })).toBeVisible();
    await page.getByLabel("Buscar tipo de operação").fill(codigo);
    const linha = page.getByRole("row").filter({ hasText: codigo });
    await expect(linha).toHaveCount(1);
    await linha.getByRole("button", { name: "Mais opções" }).click();
    await page.getByRole("menuitem", { name: "Editar" }).click();
    const forma = page.getByTestId("form-tipo-operacao");
    await forma.getByTestId("top-aba-estoque").click();
    return forma;
  };

  // Família venda: a caixa não aparece.
  const formaVenda = await abrirEditor(topVenda.codigo);
  await expect(formaVenda.getByTestId("top-aba-estoque"), "premissa: a aba Estoque abriu").toHaveAttribute("aria-selected", "true");
  await expect(formaVenda.getByTestId("top-campo-estoque-atualizacao"), "premissa: a seção Estoque montou (senão a ausência não prova nada)").toBeVisible();
  await expect(formaVenda.getByTestId("top-reserva-estoque"), "fora da família pedido não há reserva").toHaveCount(0);

  // Família pedido: a caixa aparece desmarcada, é marcada e o servidor grava.
  const forma = await abrirEditor(topPedido.codigo);
  const caixa = forma.getByTestId("top-reserva-estoque");
  await expect(caixa).not.toBeChecked();
  await caixa.check();
  await forma.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(async () => (await detalhe(topPedido.id)).reservaEstoque, { message: "o servidor gravou 'Reservar estoque'" }).toBe(true);
});
