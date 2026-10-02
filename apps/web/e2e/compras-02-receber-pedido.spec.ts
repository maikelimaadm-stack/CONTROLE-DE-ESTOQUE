import { test, expect, type Locator, type Page } from "@playwright/test";
import { login, api, uniq, empresaAtiva, primeiroId } from "./helpers";
import { codigoTop } from "./central-compras-fixtures";

/**
 * RECEBER O PEDIDO DE COMPRA — o caminho do operador (COMPRAS-02, decisão 268).
 *
 * A integração (CP-1..CP-8) prova o grafo, o saldo, a concorrência, a reabertura e o encerramento no servidor. O
 * que só este arquivo prova é o elo da TELA: a consulta do pedido mostra os Próximos passos que a TOP dele declara;
 * o passo abre a Central de Compras em modo RECEBER PEDIDO (fornecedor, empresa e produto travados, a linha pode sair
 * porque a aresta é "Em partes"); salvar chama o recebimento e abre a consulta da compra, que diz de onde veio;
 * confirmar dá a entrada; e o pedido passa a mostrar Recebido e Saldo — conferidos também no SERVIDOR.
 *
 * O GRAFO É MONTADO PELA API ADMINISTRATIVA dentro do teste (a TOP de Pedido de compra nasce com a Próxima operação
 * = a TOP de Compra, "Em partes"): cada execução cria as PRÓPRIAS TOPs, produtos e pedido, e nenhuma conta depende
 * do que outro spec deixou no banco.
 *
 * O VALOR UNITÁRIO DO RECEBER NÃO É O CUSTO MÉDIO DO ARMAZÉM: com custo médio > 0 no armazém, o "0" digitado continua
 * "0" no Receber e vai 0 no `/convert` (CX-2), e o mesmo numa compra nova (CX-1) — provados, com a premissa do custo
 * médio lida no servidor, em `central-compras-correcoes.spec.ts`. Não se repetem aqui: o armazém deste caso não tem a
 * premissa do custo médio, e a mesma asserção aqui seria verde sem prova.
 */
type Opcao = { id: string; label: string };
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
async function escolherNaLinha(page: Page, botao: Locator, nome: string) {
  await botao.click();
  await page.getByPlaceholder("Pesquisar pela descrição").fill(nome.slice(0, 20));
  await page.getByRole("option", { name: literal(nome.slice(0, 20)) }).first().click();
}

type ItemDoPedido = { id: string; produto_id: string; recebido?: string; saldo?: string };
type PedidoLido = { situacao: string; codigo: string; itens: ItemDoPedido[]; compras_geradas?: { id: string; codigo: string; situacao: string }[] };

async function cenario(page: Page) {
  // O GRAFO, pela API administrativa: Compra (padrão: entrada + conta a pagar) e Pedido de compra → Compra, "Em partes".
  const topCompra = { codigo: codigoTop("4"), id: "" };
  topCompra.id = (await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo: topCompra.codigo, codigoBase: "compras.compra", nome: uniq("Compra CP-W1") })).id;
  const topPedido = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", {
    codigo: codigoTop("3"), codigoBase: "compras.pedido", nome: uniq("Pedido CP-W1"),
    destinos: [{ tipoOperacaoId: topCompra.id, ordem: 0, emPartes: true }]
  });
  const declarado = await api<{ destinos: { tipoOperacaoId: string; emPartes?: boolean }[] }>(page, "GET", `/api/admin/tipos-operacao/${topPedido.id}`);
  expect(declarado.destinos.map((d) => [d.tipoOperacaoId, d.emPartes]), "premissa: a aresta pedido → compra, em partes, foi gravada").toEqual([[topCompra.id, true]]);

  // Dois produtos novos (dois itens: um fica de fora desta compra).
  const unidades = await api<Opcao[]>(page, "GET", "/api/resources/measurement_units/options");
  const un = unidades.find((u) => u.label.toUpperCase() === "UN");
  expect(un, "premissa: o seed tem a unidade UN").toBeTruthy();
  const grupos = await api<Opcao[]>(page, "GET", "/api/resources/product_groups/options?kind=analytic");
  const naturezas = await api<Opcao[]>(page, "GET", "/api/resources/financial_categories/options?kind=analytic&nature=expense");
  expect(naturezas.length, "premissa: há natureza de despesa analítica").toBeGreaterThan(0);
  const centros = await api<Opcao[]>(page, "GET", "/api/resources/cost_centers/options?kind=analytic");
  expect(centros.length, "premissa: há centro analítico").toBeGreaterThan(0);
  const produto = async (nome: string) => {
    const p = await api<{ id: string }>(page, "POST", "/api/resources/products", { description: uniq(nome), group_id: grupos[0]!.id, measurement_id: un!.id, financial_category_id: naturezas[0]!.id });
    return { id: p.id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${p.id}`))["description"]) };
  };
  const a = await produto("CP-W1 produto A"); const b = await produto("CP-W1 produto B");
  const empresa = await empresaAtiva(page);
  const armazem = await primeiroId(page, `/api/resources/warehouses?empresa_id=${empresa}&pageSize=1`);
  const nomeArmazem = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${armazem}`))["description"]);
  const fornecedor = await primeiroId(page, "/api/resources/people?is_provider=true&pageSize=1");

  // O PEDIDO: A 10 × 20,00 e B 2 × 5,00, com natureza e centro (vão para a compra, que gera conta a pagar). Sem armazém:
  // quem recebe informa onde a mercadoria entrou.
  const pedido = await api<{ id: string }>(page, "POST", "/api/compras/pedidos", {
    empresa_id: empresa, tipo_operacao_id: topPedido.id, fornecedor_id: fornecedor, data_documento: "2026-09-01",
    categoria_financeira_id: naturezas[0]!.id, centro_custo_id: centros[0]!.id,
    itens: [{ produto_id: a.id, quantidade: "10", valor_unitario: "20.00" }, { produto_id: b.id, quantidade: "2", valor_unitario: "5.00" }]
  });
  const lido = await api<PedidoLido>(page, "GET", `/api/compras/pedidos/${pedido.id}`);
  const itemA = lido.itens.find((i) => i.produto_id === a.id)!; const itemB = lido.itens.find((i) => i.produto_id === b.id)!;
  expect(itemA && itemB, "premissa: o pedido tem os dois itens").toBeTruthy();
  return { topCompra, pedido: { id: pedido.id, codigo: lido.codigo }, itemA, itemB, a, armazem, nomeArmazem };
}

test("CP-W1 — pedido → Próximos passos → Central em modo receber (em partes) → compra → confirmar; o pedido mostra Recebido e Saldo", async ({ page }) => {
  await login(page);
  const c = await cenario(page);

  // (1) A CONSULTA DO PEDIDO: aberto, com o passo que a TOP declara — "em partes".
  await page.goto(`/compras/pedidos/${c.pedido.id}`);
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");
  const passos = page.getByTestId("compras-proximos-passos");
  await expect(passos).toHaveAttribute("data-situacao", "pronto");
  const passo = passos.getByTestId(`compras-proximo-passo-${c.topCompra.codigo}`);
  await expect(passo).toHaveAttribute("data-em-partes", "true");
  await expect(page.getByTestId("compras-proximos-passos-indisponivel"), "a API desta PR serve os próximos passos").toHaveCount(0);
  await passo.click();

  // (2) A CENTRAL EM MODO RECEBER PEDIDO: fornecedor, empresa e produto do pedido, travados; os dois itens com saldo.
  await expect(page).toHaveURL(new RegExp(`/compras/compras/new\\?.*pedido=${c.pedido.id}`));
  expect(new URL(page.url()).searchParams.get("tipo_operacao_id"), "a TOP do passo vai na URL").toBe(c.topCompra.id);
  const central = page.getByTestId("compras-central");
  await expect(central).toHaveAttribute("data-modo", "receber");
  const receber = page.getByTestId("compras-central-receber");
  await expect(receber).toHaveAttribute("data-situacao", "pronto");
  await expect(receber).toHaveAttribute("data-em-partes", "true");
  await expect(page.getByTestId("compras-receber-pedido")).toContainText(c.pedido.codigo);
  await expect(central.locator("label", { hasText: "Fornecedor" }).first().locator("..").locator("button").first(), "fornecedor do pedido, travado").toBeDisabled();
  await expect(central.locator("label", { hasText: "Empresa" }).first().locator("..").locator("button").first(), "empresa do pedido, travada").toBeDisabled();
  const linhaA = page.getByTestId(`compras-receber-item-${c.itemA.id}`);
  const linhaB = page.getByTestId(`compras-receber-item-${c.itemB.id}`);
  await expect(linhaA).toBeVisible();
  await expect(linhaB).toBeVisible();
  await expect(linhaA.getByTestId("central-compras-produto"), "produto do pedido, travado").toHaveAttribute("data-travado", "");
  await expect(linhaA.getByTestId("central-compras-produto").locator("button"), "produto do pedido, sem pesquisa").toHaveCount(0);
  await expect(linhaA.getByTestId("central-compras-saldo-da-origem")).toHaveText("10,0000");
  await expect(page.getByTestId("compras-itens").getByRole("button", { name: "Adicionar produto" }), "item fora do pedido é outra compra").toHaveCount(0);

  // (3) EM PARTES: a linha B sai; a A recebe 4 de 10, a 21,00 (vale o preço da NOTA), no armazém informado.
  await linhaB.getByTestId("central-compras-selecionar-item").click();
  await page.getByTestId("compras-itens").getByTestId("central-compras-remover-item").click();
  await expect(linhaB).toHaveCount(0);
  await escolherNaLinha(page, linhaA.getByTestId("central-compras-armazem"), c.nomeArmazem);
  const quantidade = linhaA.getByLabel("Quantidade do item 1");
  await expect(quantidade, "com 'Em partes' a quantidade começa no saldo e é editável").toHaveValue(/^10/);
  await quantidade.fill("4");
  await linhaA.getByLabel("Valor unitário do item 1").fill("21");
  const nota = `W1${Date.now().toString(36).toUpperCase()}`;
  await page.getByTestId("compras-numero-nota").fill(nota);
  await page.getByTestId("compras-serie-nota").fill("1");
  // O campo de data é o calendário do produto: digita-se dd/mm/aaaa e Enter confirma (o valor vira ISO).
  const entrada = central.getByLabel("Data de entrada", { exact: true });
  await entrada.fill("05/09/2026");
  await entrada.press("Enter");
  await expect(page.getByTestId("compras-data-entrada").locator("input[type=hidden]"), "a data de entrada vira ISO no formulário").toHaveValue("2026-09-05");
  await expect(page.getByTestId("compras-total")).toContainText("84,00");
  await page.getByTestId("compras-salvar").click();

  // (4) A CONSULTA DA COMPRA: aberta, dizendo de onde veio — e o servidor gravou a ligação.
  await expect(page).toHaveURL(/\/compras\/compras\/[0-9a-f-]{36}$/);
  const compraId = /\/compras\/compras\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
  const corpo = page.getByTestId("compras-consulta-corpo");
  await expect(corpo).toHaveAttribute("data-situacao", "aberto");
  await expect(page.getByTestId("compras-origem")).toContainText(`Pedido de compra ${c.pedido.codigo}`);
  const compra = await api<{ origem_documento_id: string; numero_nota: string; valor_total: string; itens: { origem_item_id: string; produto_id: string; quantidade: string; valor_unitario: string; armazem_id: string }[] }>(
    page, "GET", `/api/compras/compras/${compraId}`);
  expect(compra, "o servidor gravou o que a tela mostrou").toMatchObject({ origem_documento_id: c.pedido.id, numero_nota: nota, valor_total: "84.00", data_entrada: "2026-09-05" });
  expect(compra.itens.map((i) => [i.origem_item_id, i.produto_id, i.quantidade, i.valor_unitario, i.armazem_id])).toEqual([[c.itemA.id, c.a.id, "4.0000", "21.000000", c.armazem]]);

  // (5) CONFIRMAR COM A PRÉVIA: a compra gerada é uma compra comum.
  await page.getByTestId("compras-confirmar").click();
  await expect(page.getByTestId("compras-previa")).toHaveAttribute("data-situacao", "pronta");
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(corpo).toHaveAttribute("data-situacao", "confirmado");
  await page.getByRole("tab", { name: /^Estoque/ }).click();
  await expect(page.getByTestId("compras-consulta-movimentos")).toContainText(c.a.nome);

  // (6) O PEDIDO MOSTRA RECEBIDO E SALDO — continua aberto (falta 6 de A e todo o B), com a compra gerada na lista.
  // A Origem mora em "Dados adicionais", recolhido por padrão.
  await page.getByRole("button", { name: /^Dados adicionais/ }).click();
  await page.getByTestId("compras-origem").click();
  await expect(page).toHaveURL(new RegExp(`/compras/pedidos/${c.pedido.id}$`));
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");
  const ordem = (await api<PedidoLido>(page, "GET", `/api/compras/pedidos/${c.pedido.id}`)).itens.map((i) => i.id);
  const esperado = (a: string, b: string) => ordem.map((id) => (id === c.itemA.id ? a : b));
  // Recebido e Saldo na escala da compra (4 casas, `numeric(18,4)`), como antes da Central nova (VISUAL-UX-04b, S1).
  await expect(page.getByTestId("doc-item-faturado")).toHaveText(esperado("4,0000", "0,0000"));
  await expect(page.getByTestId("doc-item-saldo")).toHaveText(esperado("6,0000", "2,0000"));
  await page.getByRole("tab", { name: /^Compras geradas/ }).click();
  await expect(page.getByTestId("compras-geradas").getByTestId("compras-gerada")).toHaveText([/\S/]);
  await expect(page.getByTestId("compras-encerrar-saldo"), "com compra e saldo, encerrar o saldo passa a valer").toBeVisible();
  await expect(page.getByTestId("compras-proximos-passos"), "com saldo, receber continua oferecido").toBeVisible();
  const srv = await api<PedidoLido>(page, "GET", `/api/compras/pedidos/${c.pedido.id}`);
  expect(srv.situacao).toBe("aberto");
  expect(srv.itens.map((i) => [i.id, i.recebido, i.saldo])).toEqual(ordem.map((id) => (id === c.itemA.id ? [id, "4.0000", "6.0000"] : [id, "0.0000", "2.0000"])));
  expect(srv.compras_geradas, "a compra gerada, confirmada, é a história do pedido").toEqual([{ id: compraId, codigo: expect.any(String), situacao: "confirmado" }]);
});
