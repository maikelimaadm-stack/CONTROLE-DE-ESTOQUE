import { test, expect, type Locator, type Page } from "@playwright/test";
import { LAYOUT_DO_SISTEMA, mensagemCampoObrigatorio, type EstruturaLayout } from "@agro/domain";
import { login, api, uniq, empresaAtiva, primeiroId } from "./helpers";
import { codigoTop } from "./central-compras-fixtures";

/**
 * LAYOUT DO DOCUMENTO DE COMPRA — o caminho do operador (COMPRAS-03, decisão 269).
 *
 * A integração (LC-1..LC-6) prova o cadastro, o layout efetivo, a cobrança no servidor e o padrão de cadastro. O que
 * só este arquivo prova é o elo da TELA: um layout de Compra ligado à TOP — um campo escondido (Transportadora), outro
 * renomeado (Número da nota → "Nº da NF"), a Observação obrigatória, um Fornecedor como padrão de cadastro e a coluna
 * Armazém ESCONDIDA dos itens — governa a Central de Compras (no `data-campo`, no rótulo, no "*", no Fornecedor já
 * preenchido e nas colunas da grade: a regra desta TOP não exige armazém, então nada força a coluna de volta — a
 * VISUAL-UX-04b, S2, desfez o "armazém sempre" que ignorava o layout); salvar sem Observação é
 * recusado NO CAMPO, sem sair nada para o servidor; e no modo RECEBER PEDIDO o MESMO layout vale, com o pedido vencendo
 * o padrão (o fornecedor é o do pedido, não o do layout).
 *
 * O LAYOUT É MONTADO PELA API ADMINISTRATIVA dentro do teste (a mesma porta do configurador), assim como as TOPs, o
 * produto e o pedido: cada execução cria os PRÓPRIOS dados, e nenhuma conta depende do que outro spec deixou no banco.
 * Anti-vacuidade: toda ausência (campo escondido, POST que não saiu) vem depois de uma presença do mesmo tipo de alvo.
 */
type Opcao = { id: string; label: string };
const FAMILIA = "compras.compra";
const LAYOUTS = "/api/admin/layouts-documento";
const ROTULO_NOTA = "Nº da NF";
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const campo = (page: Page, chave: string) => page.getByTestId("compras-central").locator(`[data-campo="${chave}"]`);

/** Escolhe no RefSelect pelo rótulo do campo — o nome vai escapado (nomes do seed têm colchetes). */
async function escolher(page: Page, rotulo: string, nome: string) {
  const c = page.getByTestId("compras-central").locator("label", { hasText: rotulo }).first().locator("..");
  await c.locator("button").first().click();
  await page.getByPlaceholder("Pesquisar...").fill(nome.slice(0, 20));
  await page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last().getByRole("option", { name: literal(nome.slice(0, 20)) }).first().click();
}
async function escolherNaLinha(page: Page, botao: Locator, nome: string) {
  await botao.click();
  await page.getByPlaceholder("Pesquisar pela descrição").fill(nome.slice(0, 20));
  await page.getByRole("option", { name: literal(nome.slice(0, 20)) }).first().click();
}

async function cenario(page: Page) {
  // TOPs: Compra (padrão: entrada + conta a pagar) e Pedido de compra → Compra, recebido de uma vez (sem "Em partes").
  const topCompra = { codigo: codigoTop("8"), id: "" };
  topCompra.id = (await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo: topCompra.codigo, codigoBase: FAMILIA, nome: uniq("Compra LC-W1") })).id;
  const topPedido = (await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", {
    codigo: codigoTop("7"), codigoBase: "compras.pedido", nome: uniq("Pedido LC-W1"),
    destinos: [{ tipoOperacaoId: topCompra.id, ordem: 0, emPartes: false }]
  })).id;

  // Cadastros: um produto novo; o fornecedor do PEDIDO (o primeiro do seed) e, criado DEPOIS, o fornecedor PADRÃO do
  // layout — dois fornecedores diferentes, para o modo receber mostrar qual dos dois vence.
  const unidades = await api<Opcao[]>(page, "GET", "/api/resources/measurement_units/options");
  const un = unidades.find((u) => u.label.toUpperCase() === "UN");
  expect(un, "premissa: o seed tem a unidade UN").toBeTruthy();
  const grupos = await api<Opcao[]>(page, "GET", "/api/resources/product_groups/options?kind=analytic");
  const naturezas = await api<Opcao[]>(page, "GET", "/api/resources/financial_categories/options?kind=analytic&nature=expense");
  expect(naturezas.length, "premissa: há natureza de despesa analítica").toBeGreaterThan(0);
  const centros = await api<Opcao[]>(page, "GET", "/api/resources/cost_centers/options?kind=analytic");
  expect(centros.length, "premissa: há centro analítico").toBeGreaterThan(0);
  const produto = await api<{ id: string }>(page, "POST", "/api/resources/products", { description: uniq("LC-W1 produto"), group_id: grupos[0]!.id, measurement_id: un!.id, financial_category_id: naturezas[0]!.id });
  const nomeProduto = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${produto.id}`))["description"]);
  const empresa = await empresaAtiva(page);
  const armazem = await primeiroId(page, `/api/resources/warehouses?empresa_id=${empresa}&pageSize=1`);
  const doPedido = await primeiroId(page, "/api/resources/people?is_provider=true&pageSize=1");
  const nomeDoPedido = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${doPedido}`))["name"]);
  const padrao = (await api<{ id: string }>(page, "POST", "/api/resources/people", { name: uniq("LC-W1 Fornecedor padrão"), person_type: "legal", is_provider: true })).id;
  const nomePadrao = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${padrao}`))["name"]);
  expect(padrao, "premissa: o padrão do layout não é o fornecedor do pedido").not.toBe(doPedido);

  // O LAYOUT DE COMPRA, pela API administrativa: a cópia do sistema, sem Transportadora, com a nota renomeada, a
  // Observação obrigatória e o Fornecedor padrão (registro) — ligado à TOP de Compra.
  const estrutura: EstruturaLayout = structuredClone(LAYOUT_DO_SISTEMA(FAMILIA));
  const semTransportadora = estrutura.cabecalho.filter((c) => c.campo !== "transportadora_id");
  expect(semTransportadora.length, "premissa: a Transportadora está no layout do sistema da compra").toBe(estrutura.cabecalho.length - 1);
  estrutura.cabecalho = semTransportadora.map((c) => {
    if (c.campo === "numero_nota") return { ...c, rotulo: ROTULO_NOTA };
    if (c.campo === "observacao") return { ...c, obrigatorio: true };
    if (c.campo === "fornecedor_id") return { ...c, valorPadrao: { tipo: "registro" as const, id: padrao } };
    return c;
  });
  // A coluna Armazém sai dos ITENS: não é coluna do sistema (o layout pode escondê-la) e a TOP desta execução não exige
  // armazém — só a regra (`exigeArmazem`) a forçaria de volta.
  const semArmazem = estrutura.itens.filter((c) => c.campo !== "armazem_id");
  expect(semArmazem.length, "premissa: o Armazém está nos itens do layout do sistema da compra").toBe(estrutura.itens.length - 1);
  estrutura.itens = semArmazem;
  const layout = (await api<{ id: string }>(page, "POST", LAYOUTS, { familia: FAMILIA, nome: uniq("Layout LC-W1"), estrutura })).id;
  await api(page, "PUT", `${LAYOUTS}/${layout}/tops`, { tipoOperacaoIds: [topCompra.id] });
  const efetivo = await api<{ origem: string; id: string; padroesDeCadastro?: Record<string, { id: string }> }>(page, "GET", `/api/compras/compras/layout-efetivo?tipo_operacao_id=${topCompra.id}`);
  expect(efetivo, "premissa: o layout está ligado e o padrão de cadastro vale").toMatchObject({ origem: "ligado", id: layout, padroesDeCadastro: { fornecedor_id: { id: padrao } } });
  const regras = await api<{ exigeArmazem: boolean }>(page, "GET", `/api/compras/compras/regras-da-operacao?tipo_operacao_id=${topCompra.id}`);
  expect(regras.exigeArmazem, "premissa: a regra desta TOP não exige armazém (nada força a coluna)").toBe(false);

  return { topCompra, topPedido, layout, produto: { id: produto.id, nome: nomeProduto }, empresa, armazem,
    natureza: naturezas[0]!, centro: centros[0]!, fornecedor: { doPedido, nomeDoPedido, padrao, nomePadrao } };
}

/** O layout desta execução governa a Central aberta: linha do layout, campo escondido, rótulo, "*" — nas duas portas. */
async function conferirLayoutNaCentral(page: Page, layoutId: string) {
  const central = page.getByTestId("compras-central");
  await expect(page.getByTestId("compras-layout-efetivo"), "a Central leu o layout conferido").toHaveAttribute("data-origem", "ligado");
  await expect(page.getByTestId("compras-layout-efetivo")).toHaveAttribute("data-layout-id", layoutId);
  // PRESENÇA antes da ausência: os campos governados estão desenhados, com o invólucro do layout.
  await expect(campo(page, "fornecedor_id")).toHaveCount(1);
  await expect(campo(page, "numero_nota").locator("label"), "o rótulo do layout").toHaveText(new RegExp(`^${ROTULO_NOTA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  await expect(central.locator("label", { hasText: "Número da nota" }), "o rótulo de hoje saiu").toHaveCount(0);
  // A Observação mora na aba "Observações" do painel de baixo.
  await central.getByRole("tab", { name: /^Observações/ }).click();
  await expect(campo(page, "observacao")).toHaveAttribute("data-obrigatorio", "true");
  await expect(campo(page, "observacao").locator(`label [data-parte="req"]`), "o \"*\" da Observação").toHaveCount(1);
  await expect(campo(page, "transportadora_id"), "a Transportadora está fora do layout").toHaveCount(0);
  await expect(central.locator("label", { hasText: "Transportadora" }), "e não aparece na Central").toHaveCount(0);
  // As colunas dos itens também seguem o layout. PRESENÇA antes da ausência: a grade desenhou as colunas pelo layout
  // (`data-campo`), e o Produto está lá; o Armazém, escondido pelo layout e não exigido pela regra, NÃO.
  const itens = page.getByTestId("compras-itens");
  await expect(itens.locator('th[data-campo="produto_id"]'), "a grade dos itens desenhou as colunas pelo layout").toHaveCount(1);
  await expect(itens.locator('th[data-campo="armazem_id"]'), "o Armazém escondido pelo layout não aparece nos itens").toHaveCount(0);
  await expect(itens.getByRole("columnheader", { name: "Armazém" }), "nem pelo rótulo").toHaveCount(0);
}

test("LC-W1 — layout de Compra (campo escondido, rótulo, Observação obrigatória, Fornecedor padrão) governa a Central; sem Observação recusa no campo; no modo receber vale o mesmo layout e o pedido vence o padrão", async ({ page }) => {
  // NO FIO: todo POST de lançamento e de recebimento fica registrado — a recusa no campo não pode ter chamado o servidor.
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "POST") return;
    const p = new URL(r.url()).pathname;
    if (p === "/api/compras/compras" || /^\/api\/compras\/pedidos\/[0-9a-f-]{36}\/convert$/.test(p)) posts.push(p);
  });
  await login(page);
  const c = await cenario(page);
  const central = page.getByTestId("compras-central");
  const erroDaObservacao = mensagemCampoObrigatorio("Observação");

  // (1) A CENTRAL DE COMPRAS com a TOP travada e o layout aplicado — e o Fornecedor já preenchido pelo padrão.
  await page.goto(`/compras/compras/new?tipo_operacao_id=${c.topCompra.id}`);
  await expect(central).toBeVisible();
  await expect(central).toHaveAttribute("data-modo", "lancar");
  // ÂNCORA no começo do VALOR do campo travado (o rótulo "Tipo de Operação" mora fora dele): "<código> · <nome>".
  await expect(page.getByTestId("compras-top-travada").locator('[data-parte="valor"]'), "a TOP escolhida, travada").toHaveText(new RegExp(`^${c.topCompra.codigo} · `));
  await conferirLayoutNaCentral(page, c.layout);
  await expect(campo(page, "fornecedor_id").locator("button").first(), "o Fornecedor padrão do layout, aplicado ao abrir").toContainText(c.fornecedor.nomePadrao);

  // (2) SALVAR SEM OBSERVAÇÃO: o documento está completo menos ela — a recusa é no campo, e nada sai para o servidor.
  await escolher(page, "Natureza de despesa", c.natureza.label);
  await escolher(page, "Centro de resultado", c.centro.label);
  const itens = page.getByTestId("compras-itens");
  await itens.getByTestId("central-compras-adicionar-item").click();
  const linha = itens.locator("tbody tr").first();
  // sem a coluna Armazém (o layout a escondeu), a linha não tem onde escolhê-lo — e a regra não o exige
  await expect(linha.getByTestId("central-compras-armazem"), "a linha não desenha a célula do Armazém").toHaveCount(0);
  await escolherNaLinha(page, linha.getByTestId("central-compras-produto"), c.produto.nome);
  await linha.getByLabel("Quantidade do item 1").fill("2");
  await linha.getByLabel("Valor unitário do item 1").fill("15");
  await central.getByRole("tab", { name: /^Totais/ }).click();
  await expect(page.getByTestId("compras-total")).toContainText("30,00");
  await expect(page.getByTestId("compras-salvar"), "premissa: o layout chegou e o Salvar está liberado").toBeEnabled();
  await page.getByTestId("compras-salvar").click();
  // A Observação está na aba "Observações" (a Totais estava à vista): a pendência marca a aba, e o erro está no campo.
  const abaObservacoes = central.getByRole("tab", { name: /^Observações/ });
  await expect(abaObservacoes.getByRole("img", { name: "Com pendência" }), "a aba da Observação acusa a pendência").toHaveCount(1);
  await abaObservacoes.click();
  await expect(campo(page, "observacao"), "a recusa aparece NO campo, com o rótulo do layout").toContainText(erroDaObservacao);
  await expect(campo(page, "fornecedor_id"), "o Fornecedor (preenchido pelo padrão) não é cobrado").not.toContainText("é obrigatório");
  await expect(page).toHaveURL(/\/compras\/compras\/new\?/);
  expect(posts, "a conferência é do cliente, com a mesma função do servidor: nenhum POST saiu").toEqual([]);

  // (3) COM A OBSERVAÇÃO, grava — e o servidor guardou o Fornecedor do padrão e a Observação digitada.
  await page.getByTestId("compras-observacao").fill("Conferida na portaria");
  await expect(campo(page, "observacao")).not.toContainText(erroDaObservacao);
  await page.getByTestId("compras-salvar").click();
  await expect(page).toHaveURL(/\/compras\/compras\/[0-9a-f-]{36}$/);
  const compraId = /\/compras\/compras\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
  expect(posts, "um POST, o que gravou").toEqual(["/api/compras/compras"]);
  const gravada = await api<Record<string, unknown>>(page, "GET", `/api/compras/compras/${compraId}`);
  expect(gravada, "o servidor gravou o que a tela mostrou").toMatchObject({ fornecedor_id: c.fornecedor.padrao, observacao: "Conferida na portaria", transportadora_id: null, tipo_operacao: { id: c.topCompra.id } });
  expect((gravada["itens"] as { produto_id: string; armazem_id: string | null }[]).map((i) => [i.produto_id, i.armazem_id]),
    "sem a coluna (e sem padrão), o item foi gravado sem armazém — a regra desta TOP não o exige").toEqual([[c.produto.id, null]]);

  // (4) MODO RECEBER: um pedido de OUTRO fornecedor, sem observação; Próximos passos → a Central em modo receber.
  const pedido = (await api<{ id: string }>(page, "POST", "/api/compras/pedidos", {
    empresa_id: c.empresa, tipo_operacao_id: c.topPedido, fornecedor_id: c.fornecedor.doPedido, data_documento: "2026-09-01",
    categoria_financeira_id: c.natureza.id, centro_custo_id: c.centro.id,
    itens: [{ produto_id: c.produto.id, armazem_id: c.armazem, quantidade: "3", valor_unitario: "7.00" }]
  })).id;
  await page.goto(`/compras/pedidos/${pedido}`);
  const passos = page.getByTestId("compras-proximos-passos");
  await expect(passos).toHaveAttribute("data-situacao", "pronto");
  await passos.getByTestId(`compras-proximo-passo-${c.topCompra.codigo}`).click();
  await expect(page).toHaveURL(new RegExp(`/compras/compras/new\\?.*pedido=${pedido}`));
  await expect(central).toHaveAttribute("data-modo", "receber");
  await expect(page.getByTestId("compras-central-receber")).toHaveAttribute("data-situacao", "pronto");
  await conferirLayoutNaCentral(page, c.layout);
  // O PEDIDO VENCE O PADRÃO: o fornecedor é o do pedido, travado — não o do layout.
  const fornecedor = campo(page, "fornecedor_id").locator("button").first();
  await expect(fornecedor, "o fornecedor do pedido").toContainText(c.fornecedor.nomeDoPedido);
  await expect(fornecedor, "não o padrão do layout").not.toContainText(c.fornecedor.nomePadrao);
  await expect(fornecedor, "travado, como no recebimento").toBeDisabled();

  // (5) Salvar sem Observação recusa no campo, sem chamar o recebimento; com ela, recebe.
  await expect(page.getByTestId("compras-salvar")).toBeEnabled();
  await page.getByTestId("compras-salvar").click();
  await expect(campo(page, "observacao"), "o mesmo layout cobra no recebimento").toContainText(erroDaObservacao);
  expect(posts, "nenhum POST de recebimento saiu").toEqual(["/api/compras/compras"]);
  await page.getByTestId("compras-observacao").fill("Recebido inteiro");
  await page.getByTestId("compras-salvar").click();
  await expect(page).toHaveURL(/\/compras\/compras\/[0-9a-f-]{36}$/);
  const recebidaId = /\/compras\/compras\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
  expect(recebidaId).not.toBe(compraId);
  expect(posts).toEqual(["/api/compras/compras", `/api/compras/pedidos/${pedido}/convert`]);
  const recebida = await api<Record<string, unknown>>(page, "GET", `/api/compras/compras/${recebidaId}`);
  expect(recebida, "a compra gerada tem a origem, o fornecedor do PEDIDO e a Observação digitada").toMatchObject({
    origem_documento_id: pedido, fornecedor_id: c.fornecedor.doPedido, observacao: "Recebido inteiro", tipo_operacao: { id: c.topCompra.id }
  });
});
