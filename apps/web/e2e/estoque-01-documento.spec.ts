import { test, expect, type Page, type Request } from "@playwright/test";
import { entendeMovimentacaoInterna } from "@agro/domain";
import { login, api } from "./helpers";
import { cadastroDeEstoque, criarTopDeEstoque, entradaConfirmadaPelaApi, escolherNaReferencia, incluirItemNaCentralDeEstoque, saldoNoServidor } from "./estoque-01-comum";

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
 *
 * OPERACOES-01 F5b (decisão 282): a Central de Estoque passou ao MOTOR da Central. Os passos de TELA são os do motor
 * (a grade, a pesquisa de produto, os rótulos acessíveis da linha); TODA asserção do servidor ficou como estava. As
 * verdades novas entram com a premissa ao lado (a API declara `movimentacaoInterna`): a linha nova nasce EM BRANCO e o
 * rodapé dos itens não tem subtotal (o documento de estoque não tem valor); o ajuste tem a coluna "Custo unitário" e,
 * vazia, a correção sai pelo custo de sempre. Da revisão da F5b: a pesquisa de produto da Central só oferece produto que
 * CONTROLA estoque (o que não controla, com o mesmo nome, não aparece — e a tela pediu o recorte), e a consulta mostra,
 * na grade e no formulário de leitura, só os campos do documento de estoque (nada de desconto, desconto % e total, nem
 * um Local de estoque por item).
 */
/** A premissa das verdades novas: a API deste HEAD declara a movimentação interna no `operation-types` da espécie. */
async function premissaDaMovimentacaoInterna(page: Page, segmento: string) {
  const r = await api<{ capacidades?: unknown }>(page, "GET", `/api/estoque/${segmento}/operation-types`);
  expect(entendeMovimentacaoInterna(r.capacidades), `premissa: /api/estoque/${segmento}/operation-types declara movimentacaoInterna`).toBe(true);
}

const ehPostDe = (segmento: string) => (r: Request) => r.method() === "POST" && new URL(r.url()).pathname === `/api/estoque/${segmento}`;

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

  // (2) A CENTRAL DE ESTOQUE (no motor) em modo criação: TOP travada, Local de estoque, um item com quantidade e custo.
  await premissaDaMovimentacaoInterna(page, "entradas");
  const central = page.getByTestId("estoque-central");
  await expect(central).toBeVisible();
  await expect(central).toHaveAttribute("data-especie", "entrada");
  await expect(central).toHaveAttribute("data-modo", "criacao");
  await expect(page.getByTestId("estoque-central-top"), "a TOP escolhida vem travada").toHaveAttribute("data-tipo-operacao-id", top);
  await escolherNaReferencia(page, page.getByTestId("estoque-central-armazem"), c.nomeArmazem);
  // SÓ PRODUTO QUE CONTROLA ESTOQUE: um segundo produto, com o MESMO começo de nome, que NÃO controla — a pesquisa
  // genérica acha os dois (a premissa); a da Central de Estoque pede o recorte e não o oferece.
  const modelo = await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${c.produto}`);
  const semEstoque = await api<{ id: string }>(page, "POST", "/api/resources/products", {
    description: `${c.nomeProduto} sem estoque`, group_id: modelo["group_id"], measurement_id: modelo["measurement_id"], control_stock: false
  });
  const lidoSemEstoque = await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${semEstoque.id}`);
  expect(lidoSemEstoque["control_stock"], "premissa: o segundo produto NÃO controla estoque").toBe(false);
  const termo = c.nomeProduto.slice(0, 20);
  const daPesquisaGenerica = await api<{ id: string }[]>(page, "GET", `/api/resources/products/options?search=${encodeURIComponent(termo)}`);
  expect(daPesquisaGenerica.map((o) => o.id), "premissa: sem o recorte, o termo acha os dois produtos").toEqual(expect.arrayContaining([c.produto, semEstoque.id]));
  const pesquisas: string[] = [];
  const registrarPesquisa = (r: Request) => { if (new URL(r.url()).pathname === "/api/produtos/pesquisa") pesquisas.push(r.url()); };
  page.on("request", registrarPesquisa);
  const linha = await incluirItemNaCentralDeEstoque(page, { nomeProduto: c.nomeProduto, naoOferecidos: [String(lidoSemEstoque["description"])] });
  page.off("request", registrarPesquisa);
  expect(pesquisas.length, "premissa: a Central pesquisou o produto pela porta da pesquisa").toBeGreaterThan(0);
  for (const u of pesquisas) expect(new URL(u).searchParams.get("controla_estoque"), `a pesquisa da Central pede só produto que controla estoque: ${u}`).toBe("true");
  // A LINHA NOVA EM BRANCO: nada inventado — nem a quantidade "1", nem o unitário "0" (o custo vazio é o custo médio).
  await expect(linha.getByLabel("Quantidade do item 1"), "a quantidade nasce vazia").toHaveValue("");
  await expect(linha.getByLabel("Valor unitário do item 1"), "o custo nasce vazio").toHaveValue("");
  // O RODAPÉ SEM SUBTOTAL: "Itens (1)" está lá (a premissa), o "Subtotal dos itens" não (o documento de estoque não tem valor).
  await expect(page.getByTestId("central-estoque-itens-contagem"), "o rodapé dos itens existe e conta a linha").toHaveText("(1)");
  await expect(page.getByTestId("central-estoque-subtotal"), "sem subtotal no rodapé").toHaveCount(0);
  await expect(page.getByTestId("central-estoque-itens-rodape")).not.toContainText("Subtotal");
  // Os números vão em TEXTO canônico (nunca float).
  await linha.getByLabel("Quantidade do item 1").fill("5");
  await linha.getByLabel("Valor unitário do item 1").fill("12.5");
  const post = page.waitForRequest(ehPostDe("entradas"));
  await page.getByTestId("estoque-salvar").click();
  const corpo = (await post).postDataJSON() as { itens: Record<string, unknown>[] };
  expect(corpo.itens, "o corpo leva os números como texto").toEqual([{ produto_id: c.produto, quantidade: "5", custo_unitario: "12.5" }]);

  // (3) A CONSULTA: aberto — e SALVAR NÃO MEXE NO SALDO (a decisão do Maike: o saldo muda na confirmação).
  await expect(page).toHaveURL(/\/estoque\/movimentacoes\/entradas\/[0-9a-f-]{36}$/);
  const id = /\/estoque\/movimentacoes\/entradas\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
  await expect(central).toHaveAttribute("data-modo", "consulta");
  await expect(central).toHaveAttribute("data-situacao", "aberto");
  // A COR da situação vem do mapa PRÓPRIO do documento de estoque (F12): aberto = pendente.
  const seloDaConsulta = page.getByTestId("estoque-central-situacao").locator("[data-status]");
  await expect(seloDaConsulta, "premissa: o selo da consulta é o do aberto").toHaveAttribute("data-status", "aberto");
  await expect(seloDaConsulta).toHaveAttribute("data-tone", "warning");
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
  await expect(seloDaConsulta, "premissa: o selo da consulta mudou para o confirmado").toHaveAttribute("data-status", "confirmado");
  await expect(seloDaConsulta).toHaveAttribute("data-tone", "positive");
  await expect(page.getByTestId("estoque-central-movimentos")).toContainText(c.nomeProduto);
  const confirmado = await api<DocLido>(page, "GET", `/api/estoque/entradas/${id}`);
  expect(confirmado.movimentos.map((m) => m.movement_type), "a entrada é o movimento 'entry' — o da espécie").toEqual(["entry"]);
  expect(Number(confirmado.movimentos[0]!.quantity)).toBe(5);
  expect(Number(confirmado.movimentos[0]!.unit_cost), "o custo informado na entrada").toBe(12.5);
  const saldo = await saldoNoServidor(page, c.armazem, c.produto);
  expect(saldo.quantity, "a entrada vale no servidor").toBe("5.0000");

  // (5b) OS ITENS DA CONSULTA: a grade e o formulário de leitura só com os campos do documento de estoque — nada de
  // desconto, desconto % e total (o documento não tem valor), nem um Local de estoque por item (o local é do cabeçalho).
  const grade = page.getByTestId("central-estoque-grade");
  await expect(grade.getByTestId("central-estoque-linha"), "premissa: a grade da consulta tem o item do servidor").toHaveCount(1);
  expect((await grade.locator("thead th").allInnerTexts()).map((t) => t.trim()), "a grade da consulta da entrada")
    .toEqual(["Código", "Produto", "Estoque", "Quantidade", "Custo unitário", "Lote", "Validade"]);
  const barraDosItens = page.getByRole("toolbar", { name: "Itens" });
  await barraDosItens.getByRole("button", { name: "Formulário", exact: true }).click();
  const formulario = page.getByTestId("central-estoque-item-form");
  await expect(formulario.getByTestId("central-estoque-item-posicao"), "premissa: o formulário mostra o item do servidor").toHaveText("Item 1 de 1");
  expect(await formulario.locator("[data-campo]").evaluateAll((els) => els.map((e) => e.getAttribute("data-campo"))), "o formulário de leitura da entrada")
    .toEqual(["Produto", "Estoque", "Unidade", "Quantidade", "Custo unitário", "Lote", "Validade"]);
  await expect(formulario.locator('[data-campo="Custo unitário"]'), "o custo do servidor, no formulário").toContainText("12,50");
  await barraDosItens.getByRole("button", { name: "Grade", exact: true }).click();
  await expect(grade, "de volta à grade").toBeVisible();

  // (6) NA LISTA ÚNICA: a linha do documento, confirmada.
  await page.goto("/estoque?tab=movimentacoes");
  const naLista = page.locator(`[data-testid="estoque-doc-linha"][data-especie="entrada"][data-codigo="${confirmado.codigo}"]`);
  await expect(naLista, "o documento aparece na lista única").toBeVisible();
  await expect(naLista).toHaveAttribute("data-situacao", "confirmado");
  const seloDaLista = page.getByRole("row").filter({ has: naLista }).locator("[data-status]");
  await expect(seloDaLista, "premissa: o selo da linha é o do confirmado").toHaveAttribute("data-status", "confirmado");
  await expect(seloDaLista, "a lista usa o mesmo mapa de cor do estoque").toHaveAttribute("data-tone", "positive");

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
  await premissaDaMovimentacaoInterna(page, "ajustes");
  await page.goto(`/estoque/movimentacoes/ajustes/new?tipo_operacao_id=${topAjuste}`);
  const central = page.getByTestId("estoque-central");
  await expect(central).toHaveAttribute("data-especie", "ajuste");
  await expect(central).toHaveAttribute("data-modo", "criacao");
  await escolherNaReferencia(page, page.getByTestId("estoque-central-armazem"), c.nomeArmazem);
  const linha = await incluirItemNaCentralDeEstoque(page, { nomeProduto: c.nomeProduto });
  // A COLUNA DA CONTAGEM: no ajuste se informa a CONTAGEM ("Quantidade contada"), nunca a "Quantidade"; e, com a
  // movimentação interna declarada, a coluna "Custo unitário" existe (o ajuste aceita o custo da correção).
  const cabecalhos = (await page.getByTestId("central-estoque-grade").locator("thead th").allTextContents()).map((x) => x.trim());
  expect(cabecalhos, "a coluna da contagem e a do custo, com os rótulos do ajuste").toEqual(expect.arrayContaining(["Quantidade contada", "Custo unitário"]));
  expect(cabecalhos, "nenhuma coluna \"Quantidade\" solta no ajuste").not.toContain("Quantidade");
  await expect(linha.getByLabel("Quantidade do item 1"), "a contagem nasce vazia (nunca \"1\")").toHaveValue("");
  await linha.getByLabel("Quantidade do item 1").fill("3");
  const post = page.waitForRequest(ehPostDe("ajustes"));
  await page.getByTestId("estoque-salvar").click();
  const corpo = (await post).postDataJSON() as { itens: Record<string, unknown>[] };
  expect(corpo.itens, "a contada vai como texto; o custo vazio não viaja").toEqual([{ produto_id: c.produto, quantidade_contada: "3" }]);
  await expect(page).toHaveURL(/\/estoque\/movimentacoes\/ajustes\/[0-9a-f-]{36}$/);
  const id = /\/estoque\/movimentacoes\/ajustes\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
  await expect(central).toHaveAttribute("data-situacao", "aberto");
  expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity, "salvar o ajuste não muda o saldo").toBe("5.0000");
  const salvo = await api<DocLido>(page, "GET", `/api/estoque/ajustes/${id}`);
  expect(salvo.itens.map((i) => [i.quantidade_contada, i.custo_unitario]), "premissa: o ajuste foi gravado com a contagem e SEM custo").toEqual([["3.0000", null]]);

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
  // O custo vazio (premissa lida no servidor antes de confirmar): a correção sai pelo custo de sempre — o médio da partida (10).
  expect(Number(lido.movimentos[0]!.unit_cost), "a saída por correção pelo custo médio da partida").toBe(10);
  expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity, "o saldo é a contagem").toBe("3.0000");
});
