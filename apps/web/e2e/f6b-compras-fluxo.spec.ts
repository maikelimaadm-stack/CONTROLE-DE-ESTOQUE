import type { Locator, Page, Request, Response } from "@playwright/test";
import { api, empresaAtiva, login, uniq } from "./helpers";
import { cfg5, detalheTopNoServidor } from "./top-config-08-comum";
import { hojeISO } from "./estoque-01-comum";
import { test, expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed } from "./central-compras-fixtures";

/**
 * OPERACOES-01 · F6b (decisão 283) · F6B-F1 — O FLUXO INTEIRO DO PEDIDO DE COMPRA COM ORÇAMENTOS, PELA TELA (plano F6b
 * §3 P4.1; o E2E do pedido do Maike: "pedido → aprovado para orçamento → 2 orçamentos → vencedor → finalizar").
 *
 * ┌─ O QUE ESTE ARQUIVO PROVA ──────────────────────────────────────────────────────────────────────────┐
 * │ A partir de UM pedido criado pela API (TOP de pedido no formato 5, sem aprovação, sem "exigir        │
 * │ finalizado", com os destinos [compra, orçamento]), tudo o mais é feito PELA TELA da Central de       │
 * │ Compras: "Aprovar para orçamento" (UM POST, corpo vazio, Idempotency-Key) → "Novo orçamento" (a TOP │
 * │ do leque, `data-top-id`) → o orçamento do fornecedor A com os preços digitados → pelo link, de volta │
 * │ ao pedido → o orçamento do fornecedor B, mais barato → a aba "Orçamentos" compara (o "Menor total" e │
 * │ o "menor" de cada item no B) → "Escolher" o B (UM POST `/escolher`, corpo vazio, Idempotency-Key) → │
 * │ B "Escolhido" e A "Não escolhido"; o pedido com o fornecedor e o total do B → "Finalizar" (a prévia  │
 * │ diz que a operação não exige aprovação) → "Finalizado", com o "Receber…" habilitado.                 │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * A PREMISSA de cada passo é lida no FIO (o corpo e os cabeçalhos do que a tela enviou, o corpo do que o servidor
 * respondeu) ou no SERVIDOR (o GET do documento), nunca deduzida da tela. Cada caso monta os PRÓPRIOS cadastros e TOPs
 * pela API (`central-compras-fixtures.ts`: saem no fim do caso, passou ou falhou, pela exclusão lógica da própria API);
 * natureza e centro vêm do seed, pelo nome. Os documentos ficam (o ledger é imutável; decisão 247). As mensagens do
 * contrato estão escritas à mão: a constante de um dos lados não prova o fio.
 */

const P = "central-compras";
const caminho = (r: Request | Response) => new URL(r.url()).pathname;
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MSG_NAO_EXIGE_APROVACAO = "Esta operação não exige aprovação para finalizar.";

type ItemLido = { id: string; produto_id: string; quantidade: string; valor_unitario: string };
type OrcamentoNaLeitura = { id: string; codigo: string; situacao: string; fornecedor_id: string; valor_total: string };
type PedidoLido = {
  id: string; codigo: string; situacao: string; fornecedor_id: string; valor_itens: string; valor_total: string; itens: ItemLido[];
  aprovado_orcamento_em: string | null; aprovado_orcamento_por_nome: string | null; finalizado_em: string | null;
  orcamentos: OrcamentoNaLeitura[];
};
type PassoNoFio = { tipoOperacaoId: string; codigo: string; especie: string };
type ProximosPassosNoFio = { contractVersion: number; items: PassoNoFio[]; exigeFinalizar: boolean; orcamentos?: PassoNoFio[] };

/** Registra as requisições de um método cujo caminho casa com o filtro, enquanto o caso corre (o fio, não a tela). */
function gravar(page: Page, metodo: string, filtro: (p: string) => boolean): Request[] {
  const lista: Request[] = [];
  page.on("request", (r) => { if (r.method() === metodo && filtro(caminho(r))) lista.push(r); });
  return lista;
}

/** O pedido de UM POST (a lista do fio) com corpo vazio e Idempotency-Key — a regra das ações da F6b. */
function umPostVazioComChave(lista: Request[], rotulo: string) {
  expect(lista, `${rotulo}: UM POST`).toHaveLength(1);
  expect(lista[0]!.postDataJSON(), `${rotulo}: o corpo vazio`).toEqual({});
  expect(lista[0]!.headers()["idempotency-key"] ?? "", `${rotulo}: com Idempotency-Key`).toMatch(UUID);
}

const lerPedido = (page: Page, id: string) => api<PedidoLido>(page, "GET", `/api/compras/pedidos/${id}`);

/**
 * O cenário: as TOPs de compra e de orçamento (o neutro do servidor) e a de PEDIDO no formato 5, sem aprovação e sem
 * "exigir finalizado", com os dois destinos; dois produtos e três fornecedores NOVOS — o do pedido (C) e os dos dois
 * orçamentos (A e B), com nomes que se distinguem nos 20 primeiros caracteres (o que a pesquisa do campo digita).
 */
async function cenario(page: Page) {
  const ref = await referenciasDoSeed(page);
  const empresa = await empresaAtiva(page);
  const topCompra = { codigo: codigoTop("6fc") };
  const topOrc = { codigo: codigoTop("6fo") };
  const idCompra = (await criarTop(page, { codigo: topCompra.codigo, codigoBase: "compras.compra", nome: uniq("F6B-F1 compra") })).id;
  const idOrc = (await criarTop(page, { codigo: topOrc.codigo, codigoBase: "compras.orcamento", nome: uniq("F6B-F1 orçamento") })).id;
  const idPedido = (await criarTop(page, {
    codigo: codigoTop("6fp"), codigoBase: "compras.pedido", nome: uniq("F6B-F1 pedido"), configuracao: cfg5(),
    destinos: [{ tipoOperacaoId: idCompra, ordem: 0, emPartes: true }, { tipoOperacaoId: idOrc, ordem: 1, emPartes: false }]
  })).id;
  const top = await detalheTopNoServidor(page, idPedido);
  const valor = top.configuracao.valor as { aprovacao?: { politica?: string }; fluxoCompra?: { exigeFinalizar?: boolean } } | undefined;
  expect([top.configuracaoSchema, valor?.aprovacao?.politica, valor?.fluxoCompra?.exigeFinalizar],
    "premissa: a TOP de pedido gravada no formato 5, sem aprovação e sem exigir o pedido finalizado para receber").toEqual([5, "nenhuma", false]);
  const produto = async (rotulo: string) => {
    const { id } = await criarCadastro(page, "products", { description: uniq(rotulo), group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id });
    return { id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${id}`))["description"]) };
  };
  const fornecedor = async (rotulo: string) => {
    const { id } = await criarCadastro(page, "people", { name: uniq(rotulo), person_type: "legal", is_provider: true });
    return { id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${id}`))["name"]) };
  };
  return {
    ref, empresa, topCompra: { id: idCompra, ...topCompra }, topOrc: { id: idOrc, ...topOrc }, topPedido: idPedido,
    p1: await produto("F6BF1 produto um"), p2: await produto("F6BF1 produto dois"),
    c: await fornecedor("F6BF1 forn C"), a: await fornecedor("F6BF1 forn A"), b: await fornecedor("F6BF1 forn B")
  };
}
type Cenario = Awaited<ReturnType<typeof cenario>>;

/** Escolhe no RefSelect de um campo (o invólucro dado) pelo nome; o campo passa a mostrá-lo. */
async function escolherNoCampo(page: Page, campo: Locator, nome: string) {
  await campo.locator("button").first().click();
  const painel = page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nome.slice(0, 20));
  await painel.getByRole("option", { name: literal(nome.slice(0, 20)) }).first().click();
  await expect(campo, "o campo mostra a escolha").toContainText(nome);
}

/** Marca a linha do item do pedido na grade do motor e digita o preço. */
async function preencherPreco(page: Page, itemPedidoId: string, n: number, valor: string) {
  const linha = page.getByTestId(`compras-orcamento-item-${itemPedidoId}`);
  await linha.getByTestId(`${P}-selecionar-item`).click();
  const campo = linha.getByLabel(`Valor unitário do item ${n}`);
  await campo.fill(valor);
  await expect(campo).toHaveValue(valor);
}

/**
 * "Novo orçamento" na consulta do pedido (a TOP ÚNICA do leque, `data-top-id`) → a Central do orçamento: o fornecedor,
 * os dois preços, o total na aba Totais, Salvar → UM POST com o corpo EXATO → a consulta do orçamento. Devolve o id e
 * o código do orçamento (lido no servidor).
 */
async function novoOrcamentoPelaTela(page: Page, c: Cenario, ped: { id: string; i1: ItemLido; i2: ItemLido }, f: { id: string; nome: string }, precos: [string, string], total: string) {
  const pilula = page.getByTestId("compras-novo-orcamento");
  await expect(pilula, "Novo orçamento habilitado: o leque tem UMA TOP de orçamento").toBeEnabled();
  await expect(pilula, "a TOP do leque").toHaveAttribute("data-top-id", c.topOrc.id);
  await pilula.click();
  await expect(page).toHaveURL(new RegExp(`/compras/orcamentos/new\\?tipo_operacao_id=${c.topOrc.id}&pedido=${ped.id}$`));
  const central = page.getByTestId("compras-orcamento-central");
  await expect(central).toHaveAttribute("data-modo", "criacao");
  await expect(central, "o formulário (e não uma recusa ou o carregando)").toHaveAttribute("data-situacao", "formulario");
  await expect(page.getByTestId("compras-top-travada")).toHaveAttribute("data-tipo-operacao-id", c.topOrc.id);
  await escolherNoCampo(page, page.getByTestId("compras-orcamento-fornecedor"), f.nome);
  await preencherPreco(page, ped.i1.id, 1, precos[0]);
  await preencherPreco(page, ped.i2.id, 2, precos[1]);
  await page.getByTestId(`${P}-painel`).getByRole("tab", { name: "Totais" }).click();
  await expect(page.getByTestId("compras-total"), "o total do orçamento (2 × o 1º preço + 3 × o 2º)").toContainText(total);
  const dataDoDocumento = await page.getByTestId("compras-data-documento").locator("input[type=hidden]").inputValue();
  expect(dataDoDocumento, "premissa: a data do documento nasce preenchida").toBe(hojeISO());

  const posts = gravar(page, "POST", (p) => p === `/api/compras/pedidos/${ped.id}/orcamentos`);
  const criou = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/compras/pedidos/${ped.id}/orcamentos`);
  await page.getByTestId("compras-salvar").click();
  const resposta = await criou;
  expect(resposta.status(), "o orçamento nasce").toBe(201);
  const { id } = (await resposta.json()) as { id: string };
  expect(posts, "UM POST").toHaveLength(1);
  expect(posts[0]!.postDataJSON(), "o corpo exato: a TOP do leque, o fornecedor, a data e o preço de cada item do pedido").toEqual({
    tipo_operacao_id: c.topOrc.id, fornecedor_id: f.id, data_documento: dataDoDocumento,
    itens: [{ item_pedido_id: ped.i1.id, valor_unitario: precos[0] }, { item_pedido_id: ped.i2.id, valor_unitario: precos[1] }]
  });
  expect(posts[0]!.headers()["idempotency-key"] ?? "", "com Idempotency-Key").toMatch(UUID);
  await expect(page).toHaveURL(new RegExp(`/compras/orcamentos/${id}$`));
  const corpo = page.getByTestId("compras-consulta-corpo");
  await expect(corpo).toHaveAttribute("data-especie", "orcamento");
  await expect(corpo).toHaveAttribute("data-situacao", "aberto");
  const lido = await api<{ codigo: string; situacao: string; fornecedor_id: string; pedido_orcado_id: string; valor_total: string }>(page, "GET", `/api/compras/orcamentos/${id}`);
  expect([lido.situacao, lido.fornecedor_id, lido.pedido_orcado_id], "no servidor: aberto, do fornecedor, ligado ao pedido").toEqual(["aberto", f.id, ped.id]);
  return { id, codigo: lido.codigo };
}

/** O link do pedido na consulta do orçamento, de volta à consulta do pedido. */
async function voltarAoPedido(page: Page, ped: { id: string; codigo: string }) {
  const link = page.getByTestId("compras-orcamento-pedido");
  await expect(link).toHaveText(`Pedido de compra ${ped.codigo}`);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/compras/pedidos/${ped.id}$`));
  await expect(page.getByTestId(`${P}-identidade-nome`), "a consulta do pedido do caso").toHaveText(ped.codigo);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════ */

test("F6B-F1 — pelo pedido, na tela: Aprovar para orçamento → dois orçamentos pelo Novo orçamento → a comparação marca o B → Escolher o B (UM POST com Idempotency-Key) → o pedido com o fornecedor e o total do B → Finalizar (sem aprovação) → Finalizado, com o Receber… habilitado", async ({ page }) => {
  await login(page);
  const c = await cenario(page);

  // O PEDIDO, pela API: fornecedor C, 2 × 11,00 + 3 × 21,00 = 85,00.
  const { id: pedidoId } = await api<{ id: string }>(page, "POST", "/api/compras/pedidos", {
    empresa_id: c.empresa, tipo_operacao_id: c.topPedido, fornecedor_id: c.c.id, data_documento: hojeISO(),
    categoria_financeira_id: c.ref.natureza.id, centro_custo_id: c.ref.centro.id,
    itens: [{ produto_id: c.p1.id, quantidade: "2", valor_unitario: "11.00" }, { produto_id: c.p2.id, quantidade: "3", valor_unitario: "21.00" }]
  });
  const antes = await lerPedido(page, pedidoId);
  const i1 = antes.itens.find((i) => i.produto_id === c.p1.id);
  const i2 = antes.itens.find((i) => i.produto_id === c.p2.id);
  expect(i1 && i2, "premissa: o pedido tem os dois itens").toBeTruthy();
  expect([antes.situacao, antes.fornecedor_id, antes.valor_total, antes.aprovado_orcamento_em, antes.orcamentos],
    "premissa: o pedido nasce aberto, do fornecedor C, 85,00, não aprovado para orçamento e sem orçamento").toEqual(["aberto", c.c.id, "85.00", null, []]);
  const ot = await api<{ capacidades?: Record<string, unknown> }>(page, "GET", "/api/compras/pedidos/operation-types");
  expect(ot.capacidades?.["finalizacaoEOrcamento"], "premissa: a API declara a capacidade da F6 (a tela nova a lê)").toBe(1);
  const ped = { id: pedidoId, codigo: antes.codigo, i1: i1!, i2: i2! };

  // (1) A CONSULTA DO PEDIDO ABERTO: Finalizar e Aprovar para orçamento; nada de Novo orçamento nem da aba Orçamentos
  //     (o pedido não usa cotação ainda).
  await page.goto(`/compras/pedidos/${ped.id}`);
  await expect(page.getByTestId(`${P}-identidade-nome`), "premissa: a tela desenhou ESTE documento").toHaveText(ped.codigo);
  const painel = page.getByTestId(`${P}-painel`);
  const finalizar = page.getByTestId("compras-finalizar");
  const aprovarParaOrcamento = page.getByTestId("compras-aprovar-para-orcamento");
  await expect(finalizar, "Finalizar habilitado no pedido aberto").toBeEnabled();
  await expect(aprovarParaOrcamento).toBeEnabled();
  await expect(page.getByTestId("compras-novo-orcamento"), "sem a aprovação para orçamento, nada de Novo orçamento").toHaveCount(0);
  await expect(painel.getByRole("tab", { name: /^Orçamentos/ }), "sem cotação, as abas de hoje").toHaveCount(0);

  // (2) APROVAR PARA ORÇAMENTO: o diálogo diz o que fica registrado; UM POST, corpo vazio, Idempotency-Key. Os próximos
  //     passos que a tela pergunta de novo trazem o leque de orçamento (a premissa do Novo orçamento, no fio).
  const aprovacoes = gravar(page, "POST", (p) => p === `/api/compras/pedidos/${ped.id}/aprovar-para-orcamento`);
  await aprovarParaOrcamento.click();
  const dialogo = page.getByTestId("confirm-dialog");
  await expect(dialogo.getByRole("heading", { name: `Aprovar o pedido ${ped.codigo} para orçamento?`, exact: true })).toBeVisible();
  await expect(dialogo).toContainText("O pedido passa a receber orçamentos de compra, um por fornecedor. A aprovação para orçamento fica registrada com quem aprovou e quando, e não se desfaz.");
  const aprovou = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/compras/pedidos/${ped.id}/aprovar-para-orcamento`);
  const passosNoFio = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === `/api/compras/pedidos/${ped.id}/proximos-passos`);
  await dialogo.getByTestId("confirm-dialog-confirm").click();
  expect((await aprovou).status(), "o servidor aprovou o pedido para orçamento").toBe(200);
  umPostVazioComChave(aprovacoes, "Aprovar para orçamento");
  await expect(dialogo).toHaveCount(0);
  const passos = await passosNoFio;
  const corpoDosPassos = (await passos.json()) as ProximosPassosNoFio;
  expect([passos.status(), corpoDosPassos.exigeFinalizar, corpoDosPassos.items.map((x) => x.codigo), (corpoDosPassos.orcamentos ?? []).map((x) => [x.tipoOperacaoId, x.especie])],
    "premissa no fio: o passo de receber é a compra, sem exigir o finalizado, e o leque de orçamento é a TOP do caso")
    .toEqual([200, false, [c.topCompra.codigo], [[c.topOrc.id, "orcamento"]]]);
  const aprovado = await lerPedido(page, ped.id);
  expect([aprovado.situacao, Boolean(aprovado.aprovado_orcamento_em), Boolean(aprovado.aprovado_orcamento_por_nome)],
    "no servidor: o pedido continua aberto, aprovado para orçamento, com quem e quando").toEqual(["aberto", true, true]);
  await expect(aprovarParaOrcamento, "aprovado para orçamento: a pílula sai").toHaveCount(0);
  await page.getByTestId(`${P}-dados`).getByRole("button", { name: /^Dados adicionais/ }).click();
  const quando = await page.evaluate((v) => new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }), aprovado.aprovado_orcamento_em!);
  await expect(page.getByTestId("compras-consulta-aprovado-orcamento").locator('[data-parte="valor"]'), "quem aprovou para orçamento e quando, nos Dados adicionais")
    .toHaveText(`${quando} por ${aprovado.aprovado_orcamento_por_nome}`);

  // (3) O ORÇAMENTO DO FORNECEDOR A (10,00 e 20,00 → 80,00), e de volta ao pedido pelo link da consulta do orçamento.
  const orcA = await novoOrcamentoPelaTela(page, c, ped, c.a, ["10.00", "20.00"], "80,00");
  await voltarAoPedido(page, ped);

  // (4) O ORÇAMENTO DO FORNECEDOR B, mais barato (9,00 e 18,00 → 72,00), e de volta ao pedido.
  const orcB = await novoOrcamentoPelaTela(page, c, ped, c.b, ["9.00", "18.00"], "72,00");
  await voltarAoPedido(page, ped);

  // (5) A ABA "ORÇAMENTOS": as duas linhas; o "Menor total" só no B; no mapa, o "menor" nas duas células do B.
  const abaDosOrcamentos = painel.getByRole("tab", { name: /^Orçamentos/ });
  await expect(abaDosOrcamentos, "o contador: dois orçamentos vivos").toContainText("2");
  await abaDosOrcamentos.click();
  await expect(abaDosOrcamentos).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("compras-orcamentos")).toBeVisible();
  const linhaA = page.locator(`[data-testid="compras-orcamento-linha"][data-id="${orcA.id}"]`);
  const linhaB = page.locator(`[data-testid="compras-orcamento-linha"][data-id="${orcB.id}"]`);
  await expect(page.getByTestId("compras-orcamento-linha"), "as duas linhas da cotação").toHaveCount(2);
  await expect(linhaA).toHaveAttribute("data-situacao", "aberto");
  await expect(linhaB).toHaveAttribute("data-situacao", "aberto");
  await expect(linhaA.getByTestId("compras-orcamento-total")).toContainText("80,00");
  await expect(linhaB.getByTestId("compras-orcamento-total")).toContainText("72,00");
  await expect(linhaB.getByTestId("compras-orcamento-menor-total"), "o menor total é o do B").toHaveText("Menor total");
  await expect(linhaA.getByTestId("compras-orcamento-menor-total")).toHaveCount(0);
  const celula = (itemId: string, orcamentoId: string) => page.getByTestId("compras-orcamentos-mapa")
    .locator(`[data-testid="compras-orcamentos-mapa-linha"][data-item-id="${itemId}"] [data-testid="compras-orcamentos-mapa-celula"][data-orcamento-id="${orcamentoId}"]`);
  for (const [item, precoA, precoB] of [[ped.i1.id, "10,00", "9,00"], [ped.i2.id, "20,00", "18,00"]] as const) {
    await expect(celula(item, orcB.id), "o B tem o menor preço do item").toHaveAttribute("data-menor", "true");
    await expect(celula(item, orcB.id)).toContainText(precoB);
    await expect(celula(item, orcB.id)).toContainText("menor");
    await expect(celula(item, orcA.id)).not.toHaveAttribute("data-menor", "true");
    await expect(celula(item, orcA.id)).toContainText(precoA);
    await expect(celula(item, orcA.id)).not.toContainText("menor");
  }

  // (6) ESCOLHER O B: o diálogo diz o que a escolha faz; UM POST `/escolher`, corpo vazio, Idempotency-Key; a resposta
  //     leva ao pedido o fornecedor e o total do B, e diz quem não foi escolhido.
  const escolhas = gravar(page, "POST", (p) => p.endsWith("/escolher"));
  const escolherB = page.getByTestId(`compras-orcamento-escolher-${orcB.id}`);
  await expect(escolherB, "pedido aberto, sem vencedor e sem compra: Escolher habilitado").toBeEnabled();
  await escolherB.click();
  await expect(dialogo.getByRole("heading", { name: `Escolher o orçamento ${orcB.codigo} como vencedor?`, exact: true })).toBeVisible();
  await expect(dialogo).toContainText(`O pedido passa a ter o fornecedor ${c.b.nome}, os preços deste orçamento (sem o desconto dos itens)`);
  const escolheu = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/compras/pedidos/${ped.id}/orcamentos/${orcB.id}/escolher`);
  await dialogo.getByRole("button", { name: "Escolher vencedor", exact: true }).click();
  const respostaDaEscolha = await escolheu;
  expect(respostaDaEscolha.status(), "o vencedor é escolhido").toBe(200);
  expect(await respostaDaEscolha.json(), "a resposta: o pedido com o fornecedor B e 2 × 9,00 + 3 × 18,00 = 72,00; B escolhido, A não").toEqual({
    pedido: { id: ped.id, situacao: "aberto", fornecedor_id: c.b.id, condicao_pagamento_id: null, valor_itens: "72.00", valor_total: "72.00" },
    vencedor: { id: orcB.id, situacao: "escolhido" }, naoEscolhidos: [orcA.id]
  });
  umPostVazioComChave(escolhas, "Escolher vencedor");
  expect(caminho(escolhas[0]!), "o POST do par pedido × orçamento B").toBe(`/api/compras/pedidos/${ped.id}/orcamentos/${orcB.id}/escolher`);
  await expect(dialogo).toHaveCount(0);
  await expect(linhaB, "B escolhido").toHaveAttribute("data-situacao", "escolhido");
  await expect(linhaA, "A não escolhido").toHaveAttribute("data-situacao", "nao_escolhido");
  await expect(linhaB.locator('[data-status="escolhido"]'), "o selo do B").toHaveText("Escolhido");
  await expect(linhaA.locator('[data-status="nao_escolhido"]'), "o selo do A").toHaveText("Não escolhido");
  await expect(page.locator("[data-testid^='compras-orcamento-escolher-']"), "decidido: nenhum Escolher").toHaveCount(0);

  // (7) O PEDIDO NO SERVIDOR: o fornecedor e os preços do B, o total 72,00, ainda aberto; e na tela, o fornecedor B.
  const escolhido = await lerPedido(page, ped.id);
  expect([escolhido.situacao, escolhido.fornecedor_id, escolhido.valor_itens, escolhido.valor_total], "no servidor: aberto, do fornecedor B, 72,00").toEqual(["aberto", c.b.id, "72.00", "72.00"]);
  expect(escolhido.itens.map((i) => [i.id, i.quantidade, i.valor_unitario]), "no servidor: os preços do B em cada item do pedido")
    .toEqual([[ped.i1.id, "2.0000", "9.000000"], [ped.i2.id, "3.0000", "18.000000"]]);
  await expect(page.getByTestId("compras-consulta-fornecedor"), "a consulta mostra o fornecedor do vencedor").toContainText(c.b.nome);
  await expect(page.getByTestId("compras-novo-orcamento"), "com vencedor, o Novo orçamento fica desabilitado").toBeDisabled();

  // (8) FINALIZAR: a prévia (pronta, "não exige aprovação", sem recusa) → UM POST, corpo vazio, Idempotency-Key.
  const finalizacoes = gravar(page, "POST", (p) => p === `/api/compras/pedidos/${ped.id}/finalizar`);
  await expect(finalizar).toBeEnabled();
  await finalizar.click();
  await expect(dialogo.getByRole("heading", { name: `Finalizar pedido de compra ${ped.codigo}?`, exact: true })).toBeVisible();
  const previa = page.getByTestId("compras-previa-finalizacao");
  await expect(previa).toHaveAttribute("data-situacao", "pronta");
  const linhaDaAprovacao = page.getByTestId("compras-previa-finalizacao-aprovacao");
  await expect(linhaDaAprovacao).toHaveAttribute("data-situacao", "nao_exigida");
  await expect(linhaDaAprovacao).toHaveText(MSG_NAO_EXIGE_APROVACAO);
  await expect(page.getByTestId("compras-previa-finalizacao-recusas"), "sem recusa prevista").toHaveCount(0);
  const finalizou = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/compras/pedidos/${ped.id}/finalizar`);
  await expect(dialogo.getByTestId("confirm-dialog-confirm")).toBeEnabled();
  await dialogo.getByTestId("confirm-dialog-confirm").click();
  expect((await finalizou).status(), "o servidor finalizou").toBe(200);
  umPostVazioComChave(finalizacoes, "Finalizar");
  await expect(dialogo).toHaveCount(0);

  // (9) FINALIZADO: a situação e o selo; o Receber… pelo passo da compra, habilitado; o Finalizar desabilitado.
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "finalizado");
  await expect(page.getByTestId(`${P}-situacao`).locator("[data-tone]")).toHaveText("Finalizado");
  await expect(page.getByTestId(`compras-proximo-passo-${c.topCompra.codigo}`), "finalizado: o Receber… habilitado, pelo passo da compra").toBeEnabled();
  await expect(page.getByTestId(`compras-proximo-passo-${c.topCompra.codigo}`)).toContainText("Receber…");
  await expect(finalizar, "finalizado: a pílula fica, desabilitada").toBeDisabled();
  await expect(page.getByTestId("compras-novo-orcamento"), "fora do aberto, nada de Novo orçamento").toHaveCount(0);

  // (10) NO SERVIDOR: o pedido finalizado, do B, 72,00; os orçamentos escolhido e não escolhido.
  const depois = await lerPedido(page, ped.id);
  expect([depois.situacao, Boolean(depois.finalizado_em), depois.fornecedor_id, depois.valor_total], "no servidor: finalizado, do B, 72,00").toEqual(["finalizado", true, c.b.id, "72.00"]);
  expect(depois.orcamentos.map((o) => [o.id, o.situacao]).sort(), "os orçamentos do pedido: B escolhido, A não escolhido")
    .toEqual([[orcA.id, "nao_escolhido"], [orcB.id, "escolhido"]].sort());
});
