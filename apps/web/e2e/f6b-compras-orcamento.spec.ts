import type { Locator, Page, Request, Response } from "@playwright/test";
import { test, expect, criarCadastro, criarTop, codigoTop, referenciasDoSeed } from "./central-compras-fixtures";
import { api, empresaAtiva, login, logout, uniq } from "./helpers";
import { cfg4 } from "./top-config-08-comum";
import { hojeISO } from "./estoque-01-comum";

/**
 * OPERACOES-01 · F6b (decisão 283) — O ORÇAMENTO DE COMPRA NA CENTRAL DE COMPRAS, PELA TELA (plano F6b §1.5 W6–W8, P3).
 *
 *   · F6B-O1 editar o orçamento NO LUGAR (um PUT com TODAS as chaves e Idempotency-Key); a comparação na aba (o menor
 *            total e o menor preço por item, decimais, com empate); e cancelar: o pedido finalizado
 *            pela API não cascateia nos orçamentos (M3, o comportamento de hoje): a aba "Orçamentos" do pedido avisa,
 *            "Escolher" fica desabilitado com a mensagem do domínio e "Cancelar" encerra cada um — o aviso some quando
 *            não há mais aberto;
 *   · F6B-O2 "Novo orçamento" a partir do pedido aprovado: as linhas do pedido (produto e quantidade travados, sem Local
 *            de estoque), o preço digitado; UM POST com o corpo EXATO (preço vazio = "0"); o mesmo fornecedor de novo é
 *            recusado e nada nasce; "Escolher" na aba do pedido (UM POST com Idempotency-Key) leva o fornecedor e os
 *            preços ao pedido e encerra a cotação (o Novo orçamento recusa); sem pedido na URL não há formulário, nem
 *            leitura do pedido, nem POST;
 *   · F6B-O3 o "Novo" do Portal não oferece orçamento avulso (nem no Tipo "Orçamento de compra", onde ele não existe); o
 *            usuário só com `orcamentos_compra.view` abre Documentos já no Tipo "Orçamento de compra" e vê o orçamento.
 *
 * Os dados nascem pela API (TOPs no formato 4, cadastros do caso com a limpeza da fixture — passou ou falhou); o que a
 * tela grava é conferido no fio (o corpo e o cabeçalho de cada requisição) e no servidor (a leitura do orçamento). Os
 * documentos não se apagam (ledger; decisão 247). As mensagens do contrato estão escritas à mão.
 */

const P = "central-compras";
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const caminho = (r: Request | Response) => new URL(r.url()).pathname;

const MSG_SEM_PEDIDO = "O orçamento de compra nasce do pedido: abra um pedido aprovado para orçamento e use “Novo orçamento”.";
const MSG_FORNECEDOR_REPETIDO = "Este pedido já tem orçamento deste fornecedor.";
const MSG_VENCEDOR_SO_PEDIDO_ABERTO = "O vencedor só é escolhido com o pedido aberto.";
const MSG_ORCAMENTO_NAO_ABERTO = "Este orçamento não está aberto.";
const MSG_ABERTOS = "Este pedido não está mais aberto: os orçamentos abertos não podem ser escolhidos. Cancele-os.";

type ItemDoPedidoLido = { id: string; produto_id: string; quantidade: string };
type PedidoLido = {
  id: string; codigo: string; situacao: string; fornecedor_id: string; valor_total: string; aprovado_orcamento_em: string | null; itens: ItemDoPedidoLido[];
};
type ItemDoOrcamentoLido = { id: string; item_pedido_orcado_id: string; valor_unitario: string };
type OrcamentoLido = {
  id: string; codigo: string; situacao: string; pedido_orcado_id: string; fornecedor_id: string; prazo_entrega_dias: number | null;
  validade_orcamento: string | null; valor_total: string; itens: ItemDoOrcamentoLido[];
};

/** Data local daqui a `dias` dias (ISO), para a validade. */
function isoDaquiA(dias: number): string {
  const d = new Date(); d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const emBR = (iso: string) => iso.split("-").reverse().join("/");

/** Registra as requisições de um método cujo caminho casa com o filtro, enquanto o caso corre (o fio, não a tela). */
function gravar(page: Page, metodo: string, filtro: (p: string) => boolean): Request[] {
  const lista: Request[] = [];
  page.on("request", (r) => { if (r.method() === metodo && filtro(caminho(r))) lista.push(r); });
  return lista;
}

/** Escolhe no RefSelect de um campo (o invólucro dado) pelo nome. */
async function escolherNoCampo(page: Page, campo: Locator, nome: string) {
  await campo.locator("button").first().click();
  const painel = page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nome.slice(0, 20));
  await painel.getByRole("option", { name: literal(nome.slice(0, 20)) }).first().click();
}

/** O calendário do produto: digita dd/mm/aaaa e Enter confirma; o invólucro do campo guarda o ISO. */
async function preencherData(page: Page, rotulo: string, testIdDoCampo: string, iso: string) {
  const campo = page.getByTestId("compras-orcamento-central").getByLabel(rotulo, { exact: true });
  await campo.fill(emBR(iso));
  await campo.press("Enter");
  await expect(page.getByTestId(testIdDoCampo).locator("input[type=hidden]"), `${rotulo}: a data vira ISO`).toHaveValue(iso);
}

/** Marca a linha do item do pedido na grade do motor e digita o preço. */
async function preencherPreco(page: Page, itemPedidoId: string, n: number, valor: string) {
  const linha = page.getByTestId(`compras-orcamento-item-${itemPedidoId}`);
  await linha.getByTestId(`${P}-selecionar-item`).click();
  const campo = linha.getByLabel(`Valor unitário do item ${n}`);
  await campo.fill(valor);
  await expect(campo).toHaveValue(valor);
}

/** Abre o leque de Ações rápidas (se fechado) e devolve o item. */
async function itemDoLeque(page: Page, testId: string) {
  const leque = page.getByTestId(`${P}-acoes-rapidas`);
  if ((await leque.getAttribute("aria-expanded")) !== "true") await leque.click();
  await expect(leque).toHaveAttribute("aria-expanded", "true");
  const item = page.getByTestId(testId);
  await expect(item).toBeVisible();
  return item;
}

/** Abre a aba "Orçamentos" do painel da consulta do pedido. */
async function abrirAbaDosOrcamentos(page: Page) {
  const aba = page.getByTestId(`${P}-painel`).getByRole("tab", { name: /^Orçamentos/ });
  await aba.click();
  await expect(aba).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("compras-orcamentos")).toBeVisible();
}

/**
 * O cenário: a TOP de orçamento e a TOP de pedido com a aresta para ela (formato 4, neutras), dois produtos e dois
 * fornecedores NOVOS (com a limpeza da fixture); natureza e centro do seed, pelo nome.
 */
async function cenario(page: Page) {
  const ref = await referenciasDoSeed(page);
  const empresa = await empresaAtiva(page);
  const topOrc = (await criarTop(page, { codigo: codigoTop("6o"), codigoBase: "compras.orcamento", nome: uniq("Orçamento F6B-O"), configuracao: cfg4() })).id;
  const topPedido = (await criarTop(page, {
    codigo: codigoTop("6p"), codigoBase: "compras.pedido", nome: uniq("Pedido F6B-O"), configuracao: cfg4(),
    destinos: [{ tipoOperacaoId: topOrc, ordem: 0, emPartes: false }]
  })).id;
  const produto = async (nome: string) => {
    const p = await criarCadastro(page, "products", { description: uniq(nome), group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id });
    return { id: p.id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${p.id}`))["description"]) };
  };
  const fornecedor = async (nome: string) => {
    const f = await criarCadastro(page, "people", { name: uniq(nome), person_type: "legal", is_provider: true });
    return { id: f.id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${f.id}`))["name"]) };
  };
  const p1 = await produto("F6B-O produto um");
  const p2 = await produto("F6B-O produto dois");
  const a = await fornecedor("F6B-O fornecedor A");
  const b = await fornecedor("F6B-O fornecedor B");
  return { ref, empresa, topOrc, topPedido, p1, p2, a, b };
}
type Cenario = Awaited<ReturnType<typeof cenario>>;

/** Um pedido aberto do fornecedor B (3 × 10,00 e 2 × 5,00), aprovado para orçamento pela API; os dois itens na ordem do pedido. */
async function pedidoAprovado(page: Page, c: Cenario) {
  const r = await api<{ id: string }>(page, "POST", "/api/compras/pedidos", {
    empresa_id: c.empresa, tipo_operacao_id: c.topPedido, fornecedor_id: c.b.id, data_documento: hojeISO(),
    categoria_financeira_id: c.ref.natureza.id, centro_custo_id: c.ref.centro.id,
    itens: [{ produto_id: c.p1.id, quantidade: "3", valor_unitario: "10.00" }, { produto_id: c.p2.id, quantidade: "2", valor_unitario: "5.00" }]
  });
  await api(page, "POST", `/api/compras/pedidos/${r.id}/aprovar-para-orcamento`, {});
  const lido = await api<PedidoLido>(page, "GET", `/api/compras/pedidos/${r.id}`);
  expect(lido.situacao, "premissa: o pedido nasce aberto").toBe("aberto");
  expect(lido.aprovado_orcamento_em, "premissa: o pedido está aprovado para orçamento").toBeTruthy();
  const item1 = lido.itens.find((i) => i.produto_id === c.p1.id);
  const item2 = lido.itens.find((i) => i.produto_id === c.p2.id);
  expect(item1 && item2, "premissa: o pedido tem os dois itens").toBeTruthy();
  return { id: r.id, codigo: lido.codigo, item1: item1!, item2: item2! };
}

/** Um orçamento do pedido pela API (sem preço: os itens nascem com "0"). */
async function orcamentoPelaApi(page: Page, c: Cenario, pedidoId: string, fornecedorId: string) {
  const r = await api<{ id: string; codigo: string }>(page, "POST", `/api/compras/pedidos/${pedidoId}/orcamentos`,
    { tipo_operacao_id: c.topOrc, fornecedor_id: fornecedorId, data_documento: hojeISO() });
  return lerOrcamento(page, r.id);
}
const lerOrcamento = (page: Page, id: string) => api<OrcamentoLido>(page, "GET", `/api/compras/orcamentos/${id}`);

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════ */

test("F6B-O1 — editar o orçamento no lugar: UM PUT com todas as chaves e Idempotency-Key; com o pedido finalizado (sem cascata), a aba avisa dos abertos, Escolher fica desabilitado e Cancelar encerra cada um", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const ped = await pedidoAprovado(page, c);
  const orcA = await orcamentoPelaApi(page, c, ped.id, c.a.id);
  const orcB = await orcamentoPelaApi(page, c, ped.id, c.b.id);
  expect(orcA.itens.map((i) => i.valor_unitario), "premissa: o orçamento nasce sem preço (0 em cada item)").toEqual(["0.000000", "0.000000"]);
  expect(orcA.itens.map((i) => i.item_pedido_orcado_id), "premissa: as linhas na ordem do pedido").toEqual([ped.item1.id, ped.item2.id]);

  // (1) A CONSULTA DO ORÇAMENTO: sem Novo e sem Duplicar; o link do pedido; "Editar orçamento" habilitado (aberto).
  await page.goto(`/compras/orcamentos/${orcA.id}`);
  const corpo = page.getByTestId("compras-consulta-corpo");
  await expect(corpo).toHaveAttribute("data-especie", "orcamento");
  await expect(corpo).toHaveAttribute("data-situacao", "aberto");
  await expect(page.getByTestId("compras-orcamento-pedido")).toHaveText(`Pedido de compra ${ped.codigo}`);
  await expect(page.getByTestId("compras-orcamento-pedido")).toHaveAttribute("href", `/compras/pedidos/${ped.id}`);
  await expect(page.getByTestId(`${P}-novo`), "o orçamento nasce do pedido: sem Novo documento").toHaveCount(0);
  await expect(page.getByTestId(`${P}-duplicar`), "e sem Duplicar").toHaveCount(0);
  const editar = page.getByTestId("compras-orcamento-editar");
  await expect(editar).toBeEnabled();
  await editar.click();

  // (2) A EDIÇÃO NO LUGAR: Fornecedor, Empresa e Data em leitura; o preço, o prazo e a validade se digitam.
  const central = page.getByTestId("compras-orcamento-central");
  await expect(central).toHaveAttribute("data-modo", "edicao");
  await expect(central).toHaveAttribute("data-situacao", "formulario");
  await expect(page.getByTestId(`${P}-identidade-nome`)).toHaveText(`Editar orçamento ${orcA.codigo}`);
  for (const id of ["compras-orcamento-fornecedor", "compras-orcamento-empresa", "compras-data-documento"]) {
    await expect(page.getByTestId(id).locator("button, input"), `${id} em leitura (o PUT não o aceita)`).toHaveCount(0);
  }
  await expect(page.getByTestId("compras-orcamento-fornecedor")).toContainText(c.a.nome);
  await preencherPreco(page, ped.item1.id, 1, "9.50");
  await page.getByTestId("compras-orcamento-prazo-dias").fill("15");
  const validade = isoDaquiA(10);
  await preencherData(page, "Validade do orçamento", "compras-orcamento-validade-campo", validade);
  await expect(page.getByTestId(`${P}-alterado`), "a edição conta como alteração").toBeVisible();

  const puts = gravar(page, "PUT", (p) => p.startsWith("/api/compras/orcamentos/"));
  const respostaDoPut = page.waitForResponse((r) => r.request().method() === "PUT" && caminho(r) === `/api/compras/orcamentos/${orcA.id}`);
  await page.getByTestId("compras-salvar").click();
  expect((await respostaDoPut).status(), "o PUT grava").toBe(200);
  expect(puts, "UM PUT").toHaveLength(1);
  const corpoDoPut = puts[0]!.postDataJSON() as Record<string, unknown>;
  expect(Object.keys(corpoDoPut).sort(), "TODAS as chaves do PUT (ele substitui os editáveis)")
    .toEqual(["condicao_pagamento_id", "itens", "observacao", "prazo_entrega_dias", "validade_orcamento"]);
  expect(corpoDoPut, "o corpo exato: o preço digitado, o de antes na outra linha, os vazios nulos").toEqual({
    condicao_pagamento_id: null, prazo_entrega_dias: 15, validade_orcamento: validade, observacao: null,
    itens: [{ id: orcA.itens[0]!.id, valor_unitario: "9.50" }, { id: orcA.itens[1]!.id, valor_unitario: "0.000000" }]
  });
  expect(puts[0]!.headers()["idempotency-key"], "com Idempotency-Key").toBeTruthy();

  // (3) DE VOLTA À LEITURA, com os valores gravados — conferidos no servidor.
  await expect(corpo).toHaveAttribute("data-situacao", "aberto");
  await expect(page.getByTestId("compras-orcamento-prazo")).toContainText("15");
  await expect(page.getByTestId("compras-orcamento-validade")).toContainText(emBR(validade));
  await expect(page.getByTestId(`${P}-salvo`), "o Salvo da edição").toBeVisible();
  const editado = await lerOrcamento(page, orcA.id);
  expect(editado.itens.map((i) => i.valor_unitario), "no servidor: 9,50 no item 1").toEqual(["9.500000", "0.000000"]);
  expect([editado.prazo_entrega_dias, editado.validade_orcamento, editado.valor_total], "no servidor: prazo, validade e o total novo").toEqual([15, validade, "28.50"]);

  // (3b) A COMPARAÇÃO NA ABA DO PEDIDO ABERTO: B (0,00) é o menor total; no mapa, o item 1 tem o menor no B e o item 2
  //      empata (0 × 0) — o empate marca os dois. Escolher habilitado; sem o aviso dos abertos (o pedido está aberto).
  await page.goto(`/compras/pedidos/${ped.id}`);
  await abrirAbaDosOrcamentos(page);
  const linhaA = page.locator(`[data-testid="compras-orcamento-linha"][data-id="${orcA.id}"]`);
  const linhaB = page.locator(`[data-testid="compras-orcamento-linha"][data-id="${orcB.id}"]`);
  await expect(page.getByTestId("compras-orcamento-linha")).toHaveCount(2);
  await expect(linhaA.getByTestId("compras-orcamento-total")).toContainText("28,50");
  await expect(linhaB.getByTestId("compras-orcamento-menor-total"), "o menor total (decimal)").toBeVisible();
  await expect(linhaA.getByTestId("compras-orcamento-menor-total")).toHaveCount(0);
  const celula = (itemId: string, orcamentoId: string) => page.getByTestId("compras-orcamentos-mapa")
    .locator(`[data-testid="compras-orcamentos-mapa-linha"][data-item-id="${itemId}"] [data-testid="compras-orcamentos-mapa-celula"][data-orcamento-id="${orcamentoId}"]`);
  await expect(celula(ped.item1.id, orcA.id)).toContainText("9,50");
  await expect(celula(ped.item1.id, orcA.id)).not.toHaveAttribute("data-menor", "true");
  await expect(celula(ped.item1.id, orcB.id)).toHaveAttribute("data-menor", "true");
  await expect(celula(ped.item1.id, orcB.id)).toContainText("menor");
  await expect(celula(ped.item2.id, orcA.id), "empate: os dois são o menor").toHaveAttribute("data-menor", "true");
  await expect(celula(ped.item2.id, orcB.id)).toHaveAttribute("data-menor", "true");
  await expect(page.getByTestId(`compras-orcamento-escolher-${orcA.id}`), "pedido aberto, sem vencedor, sem compra").toBeEnabled();
  await expect(page.getByTestId("compras-orcamentos-abertos-aviso")).toHaveCount(0);

  // (4) O PEDIDO FINALIZADO PELA API: os orçamentos continuam abertos (sem cascata — o comportamento de hoje).
  await api(page, "POST", `/api/compras/pedidos/${ped.id}/finalizar`, {});
  expect((await api<PedidoLido>(page, "GET", `/api/compras/pedidos/${ped.id}`)).situacao, "premissa: o pedido foi finalizado").toBe("finalizado");
  expect((await lerOrcamento(page, orcB.id)).situacao, "premissa: o orçamento B continua aberto (sem cascata)").toBe("aberto");

  // (5) A ABA "ORÇAMENTOS" DO PEDIDO: o aviso dos abertos; Escolher desabilitado com a mensagem; Cancelar o B.
  await page.goto(`/compras/pedidos/${ped.id}`);
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "finalizado");
  await abrirAbaDosOrcamentos(page);
  const aviso = page.getByTestId("compras-orcamentos-abertos-aviso");
  await expect(aviso).toHaveText(MSG_ABERTOS);
  await expect(linhaA).toHaveAttribute("data-situacao", "aberto");
  await expect(linhaB).toHaveAttribute("data-situacao", "aberto");
  const escolherA = page.getByTestId(`compras-orcamento-escolher-${orcA.id}`);
  await expect(escolherA, "o pedido não está aberto: Escolher desabilitado").toBeDisabled();
  await expect(escolherA).toHaveAttribute("title", MSG_VENCEDOR_SO_PEDIDO_ABERTO);

  const cancelamentos = gravar(page, "POST", (p) => p.startsWith("/api/compras/orcamentos/") && p.endsWith("/cancel"));
  await page.getByTestId(`compras-orcamento-cancelar-${orcB.id}`).click();
  const dialogo = page.getByTestId("confirm-dialog");
  await expect(dialogo).toContainText(`Cancelar orçamento de compra ${orcB.codigo}?`);
  await expect(dialogo).toContainText("O orçamento passa a cancelado e libera o fornecedor para um orçamento novo neste pedido.");
  const cancelouB = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/compras/orcamentos/${orcB.id}/cancel`);
  await dialogo.getByRole("button", { name: "Cancelar orçamento de compra" }).click();
  expect((await cancelouB).status(), "o cancelamento grava").toBe(200);
  expect(cancelamentos.map((r) => [caminho(r), r.postDataJSON(), Boolean(r.headers()["idempotency-key"])]), "UM POST, sem motivo, com Idempotency-Key")
    .toEqual([[`/api/compras/orcamentos/${orcB.id}/cancel`, {}, true]]);
  await expect(linhaB).toHaveAttribute("data-situacao", "cancelado");
  expect((await lerOrcamento(page, orcB.id)).situacao, "no servidor: B cancelado").toBe("cancelado");
  await expect(aviso, "o A continua aberto: o aviso fica").toBeVisible();

  // (6) O A PELA CONSULTA DELE: o leque "Cancelar orçamento de compra…"; depois, "Editar orçamento" desabilitado.
  await page.goto(`/compras/orcamentos/${orcA.id}`);
  await expect(corpo).toHaveAttribute("data-situacao", "aberto");
  await (await itemDoLeque(page, "compras-cancelar")).click();
  const cancelouA = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/compras/orcamentos/${orcA.id}/cancel`);
  await page.getByTestId("confirm-dialog").getByRole("button", { name: "Cancelar orçamento de compra" }).click();
  expect((await cancelouA).status()).toBe(200);
  await expect(corpo).toHaveAttribute("data-situacao", "cancelado");
  await expect(editar, "cancelado não se edita").toBeDisabled();
  await expect(editar).toHaveAttribute("data-dica", MSG_ORCAMENTO_NAO_ABERTO);
  expect((await lerOrcamento(page, orcA.id)).situacao, "no servidor: A cancelado").toBe("cancelado");

  // (7) SEM ORÇAMENTO ABERTO, O AVISO SOME; as duas linhas canceladas continuam na relação (a história da cotação).
  await page.goto(`/compras/pedidos/${ped.id}`);
  await abrirAbaDosOrcamentos(page);
  await expect(linhaA).toHaveAttribute("data-situacao", "cancelado");
  await expect(linhaB).toHaveAttribute("data-situacao", "cancelado");
  await expect(aviso).toHaveCount(0);
});

test("F6B-O2 — Novo orçamento a partir do pedido: as linhas do pedido travadas e o preço digitado; UM POST com o corpo exato; o mesmo fornecedor de novo é recusado; o vencedor escolhido na aba encerra a cotação; sem pedido não há formulário nem POST", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const ped = await pedidoAprovado(page, c);
  const posts = gravar(page, "POST", (p) => /^\/api\/compras\/pedidos\/[^/]+\/orcamentos$/.test(p));

  // (1) A CENTRAL DO ORÇAMENTO: a faixa do pedido; as linhas do pedido, produto e quantidade travados, sem Local de estoque.
  await page.goto(`/compras/orcamentos/new?tipo_operacao_id=${c.topOrc}&pedido=${ped.id}`);
  const central = page.getByTestId("compras-orcamento-central");
  await expect(central).toHaveAttribute("data-modo", "criacao");
  await expect(central, "o formulário (e não uma recusa ou o carregando)").toHaveAttribute("data-situacao", "formulario");
  await expect(page.getByTestId(`${P}-identidade-nome`)).toHaveText("Novo orçamento de compra");
  await expect(page.getByTestId("compras-orcamento-do-pedido")).toContainText(`pedido de compra ${ped.codigo}`);
  await expect(page.getByTestId("compras-orcamento-pedido")).toHaveAttribute("href", `/compras/pedidos/${ped.id}`);
  await expect(page.getByTestId("compras-top-travada")).toHaveAttribute("data-tipo-operacao-id", c.topOrc);
  await expect(page.getByTestId(`${P}-grade`).locator("thead th"), "Produto, Quantidade, Valor unitário e Total — sem Local de estoque nem Saldo")
    .toHaveText(["", "Produto", "Quantidade", "Valor unitário", "Total"]);
  const l1 = page.getByTestId(`compras-orcamento-item-${ped.item1.id}`);
  const l2 = page.getByTestId(`compras-orcamento-item-${ped.item2.id}`);
  await expect(l1.getByTestId(`${P}-produto`)).toHaveAttribute("data-travado", "");
  await expect(l1.getByTestId(`${P}-produto`)).toContainText(c.p1.nome);
  await expect(l2.getByTestId(`${P}-produto`)).toContainText(c.p2.nome);
  await expect(l1.getByTestId(`${P}-quantidade`)).toHaveText("3,00");
  await expect(l2.getByTestId(`${P}-quantidade`)).toHaveText("2,00");
  await expect(page.getByTestId(`${P}-armazem`), "sem Local de estoque").toHaveCount(0);
  await expect(page.getByTestId(`${P}-adicionar-item`), "as linhas são as do pedido: sem Adicionar").toHaveCount(0);
  await l1.getByTestId(`${P}-selecionar-item`).click();
  await expect(l1.getByLabel("Quantidade do item 1"), "a quantidade não se digita").toHaveCount(0);
  await expect(page.getByTestId(`${P}-remover-item`), "nem se remove linha").toHaveCount(0);
  await l1.getByTestId(`${P}-selecionar-item`).click();

  // (2) FORNECEDOR A, O PREÇO DO ITEM 1 (o 2 fica vazio), PRAZO E VALIDADE.
  await escolherNoCampo(page, page.getByTestId("compras-orcamento-fornecedor"), c.a.nome);
  await preencherPreco(page, ped.item1.id, 1, "10.50");
  await page.getByTestId("compras-orcamento-prazo-dias").fill("7");
  const validade = isoDaquiA(10);
  await preencherData(page, "Validade do orçamento", "compras-orcamento-validade-campo", validade);
  await page.getByTestId(`${P}-painel`).getByRole("tab", { name: "Totais" }).click();
  await expect(page.getByTestId("compras-total"), "3 × 10,50 + 2 × 0").toContainText("31,50");
  const dataDoDocumento = await page.getByTestId("compras-data-documento").locator("input[type=hidden]").inputValue();
  expect(dataDoDocumento, "premissa: a data do documento nasce preenchida").toMatch(/^\d{4}-\d{2}-\d{2}$/);

  // (3) SALVAR: UM POST com o corpo EXATO e Idempotency-Key; a consulta do orçamento abre.
  const criou = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/compras/pedidos/${ped.id}/orcamentos`);
  await page.getByTestId("compras-salvar").click();
  const resposta = await criou;
  expect(resposta.status(), "o orçamento nasce").toBe(201);
  const criado = (await resposta.json()) as { id: string };
  expect(posts, "UM POST").toHaveLength(1);
  const corpoDoPost = posts[0]!.postDataJSON() as Record<string, unknown>;
  expect(Object.keys(corpoDoPost).sort(), "as chaves: sem condição nem observação (vazias não viajam)")
    .toEqual(["data_documento", "fornecedor_id", "itens", "prazo_entrega_dias", "tipo_operacao_id", "validade_orcamento"]);
  expect(corpoDoPost, "o corpo exato: o preço vazio vai \"0\"").toEqual({
    tipo_operacao_id: c.topOrc, fornecedor_id: c.a.id, data_documento: dataDoDocumento, prazo_entrega_dias: 7, validade_orcamento: validade,
    itens: [{ item_pedido_id: ped.item1.id, valor_unitario: "10.50" }, { item_pedido_id: ped.item2.id, valor_unitario: "0" }]
  });
  expect(posts[0]!.headers()["idempotency-key"], "com Idempotency-Key").toBeTruthy();
  await expect(page).toHaveURL(new RegExp(`/compras/orcamentos/${criado.id}$`));
  const corpo = page.getByTestId("compras-consulta-corpo");
  await expect(corpo).toHaveAttribute("data-especie", "orcamento");
  await expect(corpo).toHaveAttribute("data-situacao", "aberto");
  await expect(page.getByTestId(`${P}-situacao`)).toHaveText("Aberto");
  await expect(page.getByTestId("compras-orcamento-pedido")).toHaveText(`Pedido de compra ${ped.codigo}`);
  const lido = await lerOrcamento(page, criado.id);
  expect([lido.situacao, lido.pedido_orcado_id, lido.fornecedor_id, lido.prazo_entrega_dias, lido.validade_orcamento, lido.valor_total], "no servidor")
    .toEqual(["aberto", ped.id, c.a.id, 7, validade, "31.50"]);
  expect(lido.itens.map((i) => [i.item_pedido_orcado_id, i.valor_unitario]), "no servidor: os preços de cada item")
    .toEqual([[ped.item1.id, "10.500000"], [ped.item2.id, "0.000000"]]);

  // (4) O MESMO FORNECEDOR DE NOVO: a recusa do servidor no Fornecedor, e nenhum orçamento novo.
  await page.goto(`/compras/orcamentos/new?tipo_operacao_id=${c.topOrc}&pedido=${ped.id}`);
  await expect(central).toHaveAttribute("data-modo", "criacao");
  await expect(central, "o formulário (e não uma recusa ou o carregando)").toHaveAttribute("data-situacao", "formulario");
  await escolherNoCampo(page, page.getByTestId("compras-orcamento-fornecedor"), c.a.nome);
  const recusou = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/compras/pedidos/${ped.id}/orcamentos`);
  await page.getByTestId("compras-salvar").click();
  expect((await recusou).status(), "um orçamento vivo por fornecedor").toBe(409);
  await expect(page.getByTestId("compras-orcamento-fornecedor"), "a mensagem do servidor no Fornecedor").toContainText(MSG_FORNECEDOR_REPETIDO);
  await expect(central, "a recusa não sai do formulário").toHaveAttribute("data-situacao", "formulario");
  expect(posts, "o segundo POST foi o recusado").toHaveLength(2);
  const doPedido = await api<{ items: { id: string }[] }>(page, "GET", `/api/compras/orcamentos?pedido_orcado_id=${ped.id}`);
  expect(doPedido.items.map((x) => x.id), "nenhum orçamento novo no servidor").toEqual([criado.id]);

  // (5) O VENCEDOR PELA ABA DO PEDIDO: o diálogo diz o que a escolha faz; UM POST `/escolher` com {} e Idempotency-Key;
  //     o orçamento "Escolhido"; no servidor, o pedido com o fornecedor (era B) e os preços do vencedor.
  await page.goto(`/compras/pedidos/${ped.id}`);
  await abrirAbaDosOrcamentos(page);
  const linha = page.locator(`[data-testid="compras-orcamento-linha"][data-id="${criado.id}"]`);
  await expect(linha).toHaveAttribute("data-situacao", "aberto");
  await expect(linha.getByTestId("compras-orcamento-menor-total"), "o único vivo é o menor").toBeVisible();
  const escolhas = gravar(page, "POST", (p) => p.endsWith("/escolher"));
  await page.getByTestId(`compras-orcamento-escolher-${criado.id}`).click();
  const confirmacao = page.getByTestId("confirm-dialog");
  await expect(confirmacao).toContainText(`Escolher o orçamento ${lido.codigo} como vencedor?`);
  await expect(confirmacao).toContainText(`O pedido passa a ter o fornecedor ${c.a.nome}, os preços deste orçamento (sem o desconto dos itens)`);
  const escolheu = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/compras/pedidos/${ped.id}/orcamentos/${criado.id}/escolher`);
  await confirmacao.getByRole("button", { name: "Escolher vencedor" }).click();
  expect((await escolheu).status(), "o vencedor é escolhido").toBe(200);
  expect(escolhas.map((r) => [caminho(r), r.postDataJSON(), Boolean(r.headers()["idempotency-key"])]), "UM POST, corpo vazio, com Idempotency-Key")
    .toEqual([[`/api/compras/pedidos/${ped.id}/orcamentos/${criado.id}/escolher`, {}, true]]);
  await expect(linha).toHaveAttribute("data-situacao", "escolhido");
  await expect(page.getByTestId(`compras-orcamento-escolher-${criado.id}`), "escolhido não se escolhe de novo").toHaveCount(0);
  const pedidoDepois = await api<PedidoLido>(page, "GET", `/api/compras/pedidos/${ped.id}`);
  expect([pedidoDepois.fornecedor_id, pedidoDepois.valor_total], "no servidor: o pedido com o fornecedor A e o total do vencedor").toEqual([c.a.id, "31.50"]);

  // (6) A COTAÇÃO ENCERRADA: o "Novo orçamento" desse pedido recusa ANTES do formulário, sem POST.
  await page.goto(`/compras/orcamentos/new?tipo_operacao_id=${c.topOrc}&pedido=${ped.id}`);
  await expect(page.getByTestId("compras-orcamento-recusado")).toHaveAttribute("data-motivo", "pedido-com-vencedor");
  await expect(page.getByTestId("compras-orcamento-recusado-mensagem")).toHaveText("Este pedido já tem orçamento vencedor.");
  await expect(page.getByTestId("compras-salvar")).toHaveCount(0);

  // (7) SEM PEDIDO NA URL: a mensagem e o caminho para Documentos; nenhum formulário, nenhuma leitura de pedido, nenhum POST.
  // a leitura de UM pedido (`/api/compras/pedidos/<uuid>…`); as TOPs da espécie (`/operation-types`) não são pedido
  const leiturasDoPedido = gravar(page, "GET", (p) => /^\/api\/compras\/pedidos\/[0-9a-f-]{36}/i.test(p));
  await page.goto(`/compras/orcamentos/new?tipo_operacao_id=${c.topOrc}`);
  const recusa = page.getByTestId("compras-orcamento-recusado");
  await expect(recusa).toHaveAttribute("data-motivo", "sem-pedido");
  await expect(page.getByTestId("compras-orcamento-sem-pedido")).toHaveText(MSG_SEM_PEDIDO);
  await expect(page.getByTestId("compras-orcamento-ir-para-documentos")).toHaveAttribute("href", "/compras?tab=documentos");
  await expect(page.getByTestId(P), "sem a Central (formulário)").toHaveCount(0);
  await expect(page.getByTestId("compras-salvar")).toHaveCount(0);
  expect(leiturasDoPedido, "nenhuma pergunta ao pedido").toEqual([]);
  expect(posts, "nenhum POST além dos dois de antes").toHaveLength(2);
});

test("F6B-O3 — o Novo do Portal não oferece orçamento avulso; quem só vê orçamento de compra abre Documentos já no Tipo dele e vê o orçamento", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const ped = await pedidoAprovado(page, c);
  const orc = await orcamentoPelaApi(page, c, ped.id, c.a.id);
  const tops = await api<{ items: { id: string }[] }>(page, "GET", "/api/compras/orcamentos/operation-types");
  expect(tops.items.map((x) => x.id), "premissa: a TOP de orçamento existe e é lançável pela porta dela").toContain(c.topOrc);

  // (1) O NOVO DO PORTAL (Tipo "Todos"): as TOPs do pedido, nenhuma de orçamento.
  await page.goto("/compras?tab=documentos");
  await expect(page.getByTestId("compras-documentos")).toHaveAttribute("data-especie", "");
  await page.getByTestId("compras-novo").click();
  const janela = page.getByTestId("lancador-unificado");
  await expect(janela).toBeVisible();
  await expect(janela.getByTestId("lancador-carregando")).toHaveCount(0);
  await expect(janela.locator(`[data-testid="lancador-top"][data-top-id="${c.topPedido}"]`), "premissa: o Novo lista a TOP de pedido do caso").toHaveCount(1);
  await expect(janela.locator(`[data-testid="lancador-top"][data-top-id="${c.topOrc}"]`), "a TOP de orçamento não aparece").toHaveCount(0);
  await expect(janela.locator('[data-testid="lancador-grupo"][data-familia="compras.orcamento"]'), "nem o grupo do orçamento").toHaveCount(0);
  await janela.getByTestId("lancador-cancelar").click();
  await expect(janela).toHaveCount(0);

  // (2) O TIPO "ORÇAMENTO DE COMPRA": a lista dos orçamentos, e o Novo não existe.
  await page.getByTestId("compras-tipo").click();
  await page.locator('[data-testid="compras-tipo-opcao"][data-valor="orcamento"]').click();
  await expect(page.getByTestId("compras-documentos")).toHaveAttribute("data-especie", "orcamento");
  // a linha do caso pelo fornecedor NOVO dele (o código "0001…" sozinho casaria com outros números da linha)
  const linhaDoCaso = page.getByTestId("b1-row").filter({ hasText: c.a.nome });
  await expect(linhaDoCaso, "premissa: a lista do Tipo mostra o orçamento do caso (e só ele, do fornecedor A)").toHaveCount(1);
  await expect(linhaDoCaso).toContainText(orc.codigo);
  await expect(page.getByTestId("compras-novo"), "sem orçamento avulso: o Novo não existe").toHaveCount(0);

  // (3) QUEM SÓ VÊ ORÇAMENTO DE COMPRA: a lista já no Tipo dele, com o orçamento — sem 403 na lista.
  const papel = await api<{ id: string }>(page, "POST", "/api/admin/roles", { name: uniq("Leitor de orçamento F6B"), permissions: ["orcamentos_compra.view"] });
  const leitor = { email: `e2e-orcamento-${Date.now().toString(36)}@demo.local`, password: "Orcamento@12345" };
  await api(page, "POST", "/api/admin/members", {
    name: "Leitor de orçamento E2E", email: leitor.email, password: leitor.password, role_id: papel.id,
    escopos_empresas: [{ modulo: "compras", modo: "todas", empresas: [] }]
  });
  await logout(page);
  try {
    await login(page, leitor);
    const respostas: { url: URL; status: number }[] = [];
    page.on("response", (r) => { if (new URL(r.url()).pathname.startsWith("/api/compras/")) respostas.push({ url: new URL(r.url()), status: r.status() }); });
    await page.goto("/compras?tab=documentos");
    const documentos = page.getByTestId("compras-documentos");
    await expect(documentos, "abre já no Tipo do orçamento").toHaveAttribute("data-especie", "orcamento");
    await expect(page.getByTestId("compras-tipo")).toHaveAttribute("data-valor", "orcamento");
    await expect(linhaDoCaso, "vê o orçamento do caso").toHaveCount(1);
    await expect(linhaDoCaso).toContainText(orc.codigo);
    await expect(page.getByTestId("compras-novo"), "quem não lança nada de compras não tem o Novo").toHaveCount(0);
    const daLista = respostas.filter((r) => r.url.pathname === "/api/compras/documentos" && r.url.searchParams.get("especie") === "orcamento");
    expect(daLista.length, "premissa: a lista pediu o orçamento ao servidor").toBeGreaterThan(0);
    expect(daLista.map((r) => r.status), "a lista do orçamento responde 200").toEqual(daLista.map(() => 200));
    // A sonda da porta da lista (`usePortaDisponivel`, `?limit=1`) leva a MESMA espécie que a lista pede: sem ela,
    // quem não vê pedido nem compra receberia 403 por nada.
    const sondas = respostas.filter((r) => r.url.pathname === "/api/compras/documentos" && r.url.searchParams.get("limit") === "1");
    expect(sondas.map((r) => `${r.url.searchParams.get("especie")}:${r.status}`), "premissa: a sonda saiu, com a espécie do orçamento, e respondeu 200").toEqual(sondas.map(() => "orcamento:200"));
    expect(sondas.length, "premissa: a sonda saiu").toBeGreaterThan(0);
    expect(respostas.filter((r) => r.status === 403).map((r) => `${r.url.pathname}${r.url.search}`), "nenhuma resposta 403 das rotas de compras (/api/compras/) no fio").toEqual([]);
  } finally {
    // A limpeza da fixture exclui as TOPs e os cadastros com a sessão do administrador.
    await logout(page);
    await login(page);
  }
});
