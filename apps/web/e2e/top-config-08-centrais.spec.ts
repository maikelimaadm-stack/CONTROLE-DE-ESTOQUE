import { test, expect, type Page, type Request, type Response } from "@playwright/test";
import { MENSAGEM_APROVACAO_PENDENTE } from "@agro/domain";
import { login, logout, api, uniq, empresaAtiva, pickRef, adicionarItemNaCentral, escolherPrimeiroProdutoDaLinha, preencherClassificacaoFinanceira } from "./helpers";
import { criarParceiro } from "./aj02-comum";
import { cadastroDeEstoque, criarTopDeEstoque, entradaConfirmadaPelaApi, escolherNaReferencia, hojeISO, saldoNoServidor } from "./estoque-01-comum";
import { cfg3, cfg4, criarTopViaApi, detalheTopNoServidor, excluirTopE2E } from "./top-config-08-comum";

/**
 * TOP-CONFIG-08 (W-4, W-5) — AS CENTRAIS DE HOJE DIANTE DE UMA TOP NO FORMATO 4 (API e banco REAIS; nada mockado).
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PROVA ──────────────────────────────────────────────────────────────────┐
 * │ W-4 Central de Vendas — SEM UMA LINHA EDITADA NELA (é da PR da Central de Compras):              │
 * │   (a) TOP de Confirmação Automática: lançar pela Central e Salvar → a consulta mostra a venda     │
 * │       CONFIRMADA (o servidor confirmou no fim do POST, por quem salvou);                         │
 * │   (b) TOP com Aprovação "Sempre": Confirmar venda → a prévia mostra "Este documento precisa de   │
 * │       aprovação antes de ser confirmado." e o botão fica desabilitado — a Central de hoje já     │
 * │       mostra as recusas da prévia; aprovada, a mesma tela libera e confirma.                     │
 * │ W-5 Central de Estoque: o documento de TOP formato 4 "Sempre" → a prévia mostra a recusa da       │
 * │   aprovação (`estoque-previa-recusa`), SEM o aviso de saldo (`estoque-previa-bloqueio`), e o      │
 * │   Confirmar desabilitado; aprovado, libera e confirma.                                            │
 * │ W-5b Central de Estoque, o AVISO do Salvar lido do `confirmacaoAutomatica` do POST: formato 3 →   │
 * │   "Salvo com sucesso" (o de hoje); Automática sem saldo → "Salvo, mas não confirmado: <mensagem   │
 * │   do servidor>."; Automática → "Salvo e confirmado."; Automática + "Sempre" → "Salvo. Este        │
 * │   documento precisa de aprovação antes de ser confirmado." — cada um com a consulta que abre.     │
 * │ W-5c Central de Estoque, quem LANÇA saída mas não pode CONFIRMÁ-LA (papel sem `saidas_estoque.   │
 * │   edit`), com TOP Automática e saldo que cobre: `sem_permissao` no corpo → "Salvo, mas não       │
 * │   confirmado: você não tem permissão para confirmar este documento.", aberto, saldo parado; o     │
 * │   MESMO lançamento pelo administrador confirma.                                                  │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ A REGRA ANTI-VACUIDADE ───────────────────────────────────────────────────────────────────────┐
 * │ Toda frase conferida na tela é conferida também contra o CORPO que o servidor devolveu à própria  │
 * │ tela (capturado no fio). Toda ausência tem a PRESENÇA ao lado: o aviso de saldo ausente na saída  │
 * │ coberta aparece na saída sem saldo da MESMA TOP, na MESMA tela; o botão desabilitado pela recusa  │
 * │ habilita no MESMO documento depois de aprovado.                                                   │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Cada caso cria as PRÓPRIAS TOPs, o próprio cliente e o próprio produto (pela API): a conta nunca depende do que
 * outro spec deixou no banco; as peças da TOP no formato 4 são as comuns da fatia (`top-config-08-comum.ts`). Nada é
 * apagado (decisão 247): no `finally`, o que ficou aberto é cancelado e as TOPs saem pela exclusão lógica da própria
 * API, para a fila de Aprovações e o lançador das próximas execuções no mesmo banco não herdarem nada deste arquivo.
 */

type Regras = { confirmacao: "manual" | "automatica"; aprovacao: "nenhuma" | "sempre" };
type Venda = { id: string; code: string; status: string; version: string; titles: { id: string }[] };
type ResultadoAutomatica = { confirmado: boolean; motivo?: string; erro?: Recusa };
type Recusa = { code: string; message: string; details?: unknown };
type PreviaVenda = { podeConfirmar: boolean; recusas: Recusa[] };
type PreviaEstoque = { podeConfirmar: boolean; recusas?: Recusa[]; itens: { insuficiente: boolean; saldo_atual: string; saldo_depois: string }[] };

/**
 * Uma TOP própria por caso, no FORMATO 4 (`cfg4`: o neutro do domínio com só as duas regras medidas fora dele), e a
 * premissa lida no servidor: gravou no formato 4, com as regras.
 */
async function criarTopFormato4(page: Page, codigoBase: string, r: Regras, tops: string[]): Promise<string> {
  const { id } = await criarTopViaApi(page, codigoBase, cfg4(r), { rotulo: `W-4/5 ${codigoBase}` });
  tops.push(id);
  const lida = await detalheTopNoServidor(page, id);
  expect([lida.configuracaoSchema, lida.configuracao.versaoSchema], "premissa: a versão da TOP gravou no FORMATO 4 (só ele executa as regras gerais)").toEqual([4, 4]);
  expect([lida.configuracao.valor?.geral.confirmacao, lida.configuracao.valor?.aprovacao.politica], "premissa: as regras gravadas").toEqual([r.confirmacao, r.aprovacao]);
  return id;
}

/** Cancela o que ficou aberto e exclui (logicamente) as TOPs do caso. */
async function limpar(page: Page, vendas: string[], estoque: { segmento: string; id: string }[], tops: string[]) {
  for (const id of vendas) {
    const v = await api<Venda>(page, "GET", `/api/sales/sales/${id}`).catch(() => null);
    if (v && ["open", "approved"].includes(v.status)) await api(page, "POST", `/api/sales/sales/${id}/cancel`, {}).catch(() => undefined);
  }
  for (const d of estoque) {
    const lido = await api<{ situacao: string }>(page, "GET", `/api/estoque/${d.segmento}/${d.id}`).catch(() => null);
    if (lido?.situacao === "aberto") await api(page, "POST", `/api/estoque/${d.segmento}/${d.id}/cancelar`, {}).catch(() => undefined);
  }
  for (const id of tops) await excluirTopE2E(page, id);
}

// ── CENTRAL DE VENDAS ─────────────────────────────────────────────────────────────────────────────────────────

const WORKSPACE = "central-vendas";
const ehPostDeVenda = (r: Request) => r.method() === "POST" && new URL(r.url()).pathname === "/api/sales/sales";
const caminhoDaPrevia = (id: string) => `/api/sales/sales/${id}/previa-confirmacao`;
const ehPrevia = (id: string) => (r: Response) => r.request().method() === "GET" && new URL(r.url()).pathname === caminhoDaPrevia(id);
const situacaoNaConsulta = (page: Page) => page.getByTestId("central-vendas-situacao").locator("[data-status]");
const botaoConfirmarVenda = (page: Page) => page.getByTestId(WORKSPACE).getByTestId("central-vendas-acoes").getByRole("button", { name: "Confirmar venda" });
const dialogo = (page: Page) => page.getByTestId("confirm-dialog");
const botaoDoDialogo = (page: Page) => dialogo(page).getByTestId("confirm-dialog-confirm");
async function fecharDialogo(page: Page) {
  await dialogo(page).getByRole("button", { name: "Voltar", exact: true }).click();
  await expect(dialogo(page)).toHaveCount(0);
}

/**
 * Lança uma venda pela CENTRAL DE HOJE com a TOP: cliente próprio, um item (o primeiro produto que a pesquisa oferece)
 * de 1 × 40,00 e a classificação do seed. O botão que salva (Salvar ou Confirmar venda) é escolha de quem chama.
 */
async function preencherVendaNaCentral(page: Page, top: string) {
  const cliente = uniq("Cliente W-4");
  await criarParceiro(page, { name: cliente });
  await page.goto(`/vendas/sales/new?tipo_operacao_id=${top}`);
  await expect(page.getByTestId("top-contexto"), "a Central abriu o formulário desta TOP").toBeVisible();
  await pickRef(page, "Cliente", cliente);
  await adicionarItemNaCentral(page);
  await escolherPrimeiroProdutoDaLinha(page);
  const linha = page.getByTestId("central-vendas-linha").first();
  await linha.getByLabel("Quantidade").fill("1");
  await linha.getByLabel("Valor unitário").fill("40");
  await preencherClassificacaoFinanceira(page);
}

/** Salva pelo botão dado e devolve o 201 do POST (corpo enviado e corpo devolvido), já na consulta que abre. */
async function salvarPela(page: Page, botao: "central-vendas-salvar" | "central-vendas-confirmar", vendas: string[]) {
  const resposta = page.waitForResponse((r) => ehPostDeVenda(r.request()));
  await page.getByTestId(botao).click();
  const r = await resposta;
  expect(r.status(), "a venda foi criada").toBe(201);
  const corpo = await r.json() as { id: string; confirmacaoAutomatica?: ResultadoAutomatica };
  vendas.push(corpo.id);
  const enviado = r.request().postDataJSON() as { tipo_operacao_id: string; items: { warehouse_id?: string | null }[] };
  await expect(page, "depois do POST a Central abre a consulta do documento salvo").toHaveURL(new RegExp(`/vendas/sales/${corpo.id}$`));
  return { corpo, enviado };
}

test("W-4a — Central de Vendas, TOP de Confirmação Automática: lançar e Salvar → a consulta mostra a venda CONFIRMADA", async ({ page }) => {
  await login(page);
  const vendas: string[] = []; const tops: string[] = [];
  try {
    const top = await criarTopFormato4(page, "vendas.venda", { confirmacao: "automatica", aprovacao: "nenhuma" }, tops);
    await preencherVendaNaCentral(page, top);
    const { corpo, enviado } = await salvarPela(page, "central-vendas-salvar", vendas);
    expect(enviado.tipo_operacao_id, "o corpo leva a TOP automática").toBe(top);
    // Premissa: o item vai SEM armazém (nada de saldo em jogo) — a confirmação não depende do estoque desta base.
    expect(enviado.items.map((i) => i.warehouse_id ?? null), "premissa: o item sem armazém").toEqual([null]);
    // O CORPO: o servidor confirmou no fim do POST — e é dele que a consulta tira a situação.
    expect(corpo.confirmacaoAutomatica, "a confirmação automática aconteceu").toEqual({ confirmado: true });

    await expect(situacaoNaConsulta(page), "a consulta mostra a venda confirmada").toHaveAttribute("data-status", "confirmed");
    const lida = await api<Venda>(page, "GET", `/api/sales/sales/${corpo.id}`);
    expect(lida.status, "no servidor também").toBe("confirmed");
    await expect(page.getByTestId(WORKSPACE).locator('[data-campo="Número"]'), "a consulta desenhou ESTE documento").toContainText(lida.code);
    expect(lida.titles.length, "com os efeitos da confirmação (o título a receber)").toBeGreaterThan(0);
    // A Central de hoje não sabe da automática, e não precisa: a venda confirmada não oferece Confirmar.
    await expect(botaoConfirmarVenda(page), "confirmada, a pílula Confirmar venda fica desabilitada").toBeDisabled();
  } finally {
    await limpar(page, vendas, [], tops);
  }
});

test("W-4b — Central de Vendas, TOP com Aprovação 'Sempre': Confirmar venda → a prévia diz que precisa de aprovação e o botão fica desabilitado; aprovada, libera e confirma", async ({ page }) => {
  await login(page);
  const vendas: string[] = []; const tops: string[] = [];
  try {
    const top = await criarTopFormato4(page, "vendas.venda", { confirmacao: "manual", aprovacao: "sempre" }, tops);
    await preencherVendaNaCentral(page, top);
    const { corpo } = await salvarPela(page, "central-vendas-salvar", vendas);
    expect("confirmacaoAutomatica" in corpo, "TOP manual: o corpo do POST é o de hoje, sem a chave nova").toBe(false);
    await expect(situacaoNaConsulta(page), "salva e aberta").toHaveAttribute("data-status", "open");
    const id = corpo.id;

    // CONFIRMAR VENDA: a prévia é pedida ao abrir, e o CORPO dela é conferido antes da tela.
    const r1 = page.waitForResponse(ehPrevia(id));
    await botaoConfirmarVenda(page).click();
    const previa = await (await r1).json() as PreviaVenda;
    expect([previa.podeConfirmar, previa.recusas.map((r) => [r.code, r.message])], "o servidor prevê a recusa da aprovação")
      .toEqual([false, [["APROVACAO_PENDENTE", MENSAGEM_APROVACAO_PENDENTE]]]);
    const alerta = dialogo(page).getByTestId("previa-confirmacao-recusa");
    await expect(alerta, "a Central de hoje mostra as recusas da prévia").toBeVisible();
    await expect(alerta.getByTestId("previa-confirmacao-recusa-mensagem"), "a mensagem do servidor, palavra por palavra")
      .toHaveText("Este documento precisa de aprovação antes de ser confirmado.");
    await expect(dialogo(page).getByTestId("previa-confirmacao"), "com recusa prevista, nenhum efeito é prometido").toHaveCount(0);
    await expect(botaoDoDialogo(page), "e o Confirmar fica desabilitado").toBeDisabled();
    await fecharDialogo(page);

    // A PREMISSA: o MESMO documento, aprovado (pela porta de aprovação), habilita o botão — e confirma.
    const venda = await api<Venda>(page, "GET", `/api/sales/sales/${id}`);
    await api(page, "POST", `/api/aprovacoes/vendas/${id}/aprovar`, { version: venda.version });
    const r2 = page.waitForResponse(ehPrevia(id));
    await botaoConfirmarVenda(page).click();
    const depois = await (await r2).json() as PreviaVenda;
    expect([depois.podeConfirmar, depois.recusas], "aprovada, a prévia libera").toEqual([true, []]);
    await expect(dialogo(page).getByTestId("previa-confirmacao")).toBeVisible();
    await expect(dialogo(page).getByTestId("previa-confirmacao-recusa")).toHaveCount(0);
    await expect(botaoDoDialogo(page), "o mesmo botão, agora habilitado").toBeEnabled();
    const confirmacao = page.waitForResponse((x) => x.request().method() === "POST" && new URL(x.url()).pathname === `/api/sales/sales/${id}/confirm`);
    await botaoDoDialogo(page).click();
    expect((await confirmacao).status(), "o servidor confirmou").toBe(200);
    await expect(situacaoNaConsulta(page)).toHaveAttribute("data-status", "confirmed");
  } finally {
    await limpar(page, vendas, [], tops);
  }
});

/**
 * "CONFIRMAR VENDA" NA CRIAÇÃO, COM TOP AUTOMÁTICA — o que a Central de HOJE faz (SPEC 10: o rótulo "Salvar e
 * confirmar" é da fatia F2 da Central no motor; aqui só se prova que nada confirma duas vezes).
 *
 * O clique é "Salvar + abrir o diálogo de Confirmar venda na consulta". O POST já confirma (a TOP é automática), e a
 * consulta só abre o diálogo para venda ABERTA: chegando confirmada, mostra o "Salvo" e nenhum diálogo — nenhuma
 * prévia é pedida e nenhum segundo /confirm sai. A ausência do diálogo é lida DEPOIS do "Salvo": os dois nascem no
 * MESMO efeito de chegada da consulta, então o "Salvo" visível prova que a decisão de abrir (ou não) já foi tomada.
 */
test("W-4c — 'Confirmar venda' na criação com TOP automática: o POST confirma UMA vez; a consulta abre confirmada, sem diálogo, sem prévia e sem segundo /confirm", async ({ page }) => {
  await login(page);
  const vendas: string[] = []; const tops: string[] = [];
  try {
    const top = await criarTopFormato4(page, "vendas.venda", { confirmacao: "automatica", aprovacao: "nenhuma" }, tops);
    await preencherVendaNaCentral(page, top);
    const confirms: string[] = []; const previas: string[] = [];
    page.on("request", (r) => {
      const p = new URL(r.url()).pathname;
      if (r.method() === "POST" && /^\/api\/sales\/sales\/[^/]+\/confirm$/.test(p)) confirms.push(p);
      if (r.method() === "GET" && /^\/api\/sales\/sales\/[^/]+\/previa-confirmacao$/.test(p)) previas.push(p);
    });
    await expect(page.getByTestId("central-vendas-confirmar"), "a criação da venda oferece 'Confirmar venda'").toContainText("Confirmar venda");
    const { corpo } = await salvarPela(page, "central-vendas-confirmar", vendas);
    expect(corpo.confirmacaoAutomatica, "o POST já confirmou").toEqual({ confirmado: true });
    await expect(situacaoNaConsulta(page), "a consulta abre a venda confirmada").toHaveAttribute("data-status", "confirmed");
    await expect(page.getByTestId("central-vendas-salvo"), "o efeito de chegada rodou (o 'Salvo' do clique)").toBeVisible();
    await expect(dialogo(page), "confirmada, o diálogo de Confirmar venda NÃO abre").toHaveCount(0);
    expect(previas, "nenhuma prévia pedida para a venda confirmada").toEqual([]);
    expect(confirms, "e nenhum segundo /confirm: a venda confirmou uma vez, no POST").toEqual([]);
    await expect(botaoConfirmarVenda(page), "na consulta, Confirmar venda fica desabilitado").toBeDisabled();
    const trilha = await api<{ items: { action: string; metadata: Record<string, unknown> | null }[] }>(page, "GET", `/api/admin/audit?entity=sales_documents&entity_id=${corpo.id}`);
    const confirm = trilha.items.filter((x) => x.action === "confirm");
    expect(confirm.map((x) => x.metadata?.["automatica"]), "uma confirmação na trilha, a automática").toEqual([true]);
  } finally {
    await limpar(page, vendas, [], tops);
  }
});

// ── CENTRAL DE ESTOQUE ────────────────────────────────────────────────────────────────────────────────────────

const caminhoDaPreviaEstoque = (segmento: string, id: string) => `/api/estoque/${segmento}/${id}/previa-confirmacao`;
const ehPreviaEstoque = (segmento: string, id: string) => (r: Response) => r.request().method() === "GET" && new URL(r.url()).pathname === caminhoDaPreviaEstoque(segmento, id);

/** Abre a consulta de um documento de estoque e o diálogo da prévia; devolve o CORPO que a tela recebeu. */
async function abrirPreviaEstoque(page: Page, segmento: string, id: string): Promise<PreviaEstoque> {
  const central = page.getByTestId("estoque-central");
  if (!new RegExp(`/estoque/movimentacoes/${segmento}/${id}$`).test(page.url())) {
    await page.goto(`/estoque/movimentacoes/${segmento}/${id}`);
  }
  await expect(central).toHaveAttribute("data-modo", "consulta");
  await expect(central).toHaveAttribute("data-situacao", "aberto");
  const resposta = page.waitForResponse(ehPreviaEstoque(segmento, id));
  await page.getByTestId("estoque-confirmar").click();
  const r = await resposta;
  expect(r.status(), "a API deste HEAD serve a prévia").toBe(200);
  await expect(page.getByTestId("estoque-previa")).toBeVisible();
  await expect(page.getByTestId("estoque-previa-corpo"), "a prévia está PRONTA (não 'indisponível': o corpo é o contrato)").toHaveAttribute("data-situacao", "pronta");
  return await r.json() as PreviaEstoque;
}
async function fecharPreviaEstoque(page: Page) {
  await page.getByTestId("estoque-previa").getByRole("button", { name: "Voltar", exact: true }).click();
  await expect(page.getByTestId("estoque-previa")).toHaveCount(0);
}

type CadastroEstoque = Awaited<ReturnType<typeof cadastroDeEstoque>>;
/** O 201 do POST do documento de estoque — com `confirmacaoAutomatica` só quando a TOP é formato 4 Automática. */
type DocSalvoEstoque = { id: string; codigo: string; situacao: string; confirmacaoAutomatica?: ResultadoAutomatica };

/**
 * Lança PELA CENTRAL DE ESTOQUE um documento de um item (o produto e o armazém do cadastro do caso) com a TOP dada, e
 * Salva. Devolve o CORPO do 201 que a própria tela recebeu, no instante do aviso: quem chama confere o aviso, e só
 * depois a consulta que a Central abre.
 */
async function salvarNaCentralEstoque(
  page: Page,
  o: { segmento: "entradas" | "saidas"; especie: "entrada" | "saida"; top: string; c: CadastroEstoque; quantidade: string; custo?: string },
  estoque: { segmento: string; id: string }[]
): Promise<DocSalvoEstoque> {
  await page.goto(`/estoque/movimentacoes/${o.segmento}/new?tipo_operacao_id=${o.top}`);
  const central = page.getByTestId("estoque-central");
  await expect(central).toHaveAttribute("data-especie", o.especie);
  await expect(central).toHaveAttribute("data-modo", "criacao");
  await expect(page.getByTestId("estoque-central-top"), "a TOP do caso vem travada").toHaveAttribute("data-tipo-operacao-id", o.top);
  await escolherNaReferencia(page, page.getByTestId("estoque-central-armazem"), o.c.nomeArmazem);
  await page.getByTestId("estoque-item-adicionar").click();
  const linha = page.getByTestId("estoque-item").first();
  await escolherNaReferencia(page, linha.getByTestId("estoque-item-produto"), o.c.nomeProduto);
  await linha.getByTestId("estoque-item-quantidade").fill(o.quantidade);
  if (o.custo !== undefined) await linha.getByTestId("estoque-item-custo").fill(o.custo);
  const salvou = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/estoque/${o.segmento}`);
  await page.getByTestId("estoque-salvar").click();
  const criado = await salvou;
  expect(criado.status(), "o documento foi salvo").toBe(201);
  const doc = await criado.json() as DocSalvoEstoque;
  estoque.push({ segmento: o.segmento, id: doc.id });
  return doc;
}

/**
 * O aviso do Salvar: o toast do TIPO dado (`erp-toast-panel--<tipo>`), pela descrição — o título é o fixo do tipo. O
 * tipo entra no seletor: o texto certo no tom errado também reprova.
 */
const avisoDoSalvar = (page: Page, tipo: "success" | "info" | "warning") =>
  page.locator(`[data-sonner-toast] .erp-toast-panel--${tipo} .erp-toast-panel__description`);
/** Todos os avisos na tela — um Salvar dá UM aviso, nunca o novo ao lado do de hoje. */
const avisos = (page: Page) => page.locator("[data-sonner-toast]");

/** Depois do aviso, a Central abre a consulta DESTE documento, na situação que o servidor leu. */
async function consultaAbre(page: Page, segmento: string, doc: DocSalvoEstoque, situacao: "aberto" | "confirmado") {
  await expect(page, "depois do POST a Central abre a consulta do documento salvo").toHaveURL(new RegExp(`/estoque/movimentacoes/${segmento}/${doc.id}$`));
  const central = page.getByTestId("estoque-central");
  await expect(central).toHaveAttribute("data-modo", "consulta");
  await expect(page.getByTestId("estoque-central-codigo"), "a consulta desenhou ESTE documento").toHaveText(doc.codigo);
  await expect(central, `a consulta abre ${situacao}`).toHaveAttribute("data-situacao", situacao);
  await expect(page.getByTestId("estoque-central-situacao")).toHaveAttribute("data-situacao", situacao);
}

test("W-5 — Central de Estoque, TOP formato 4 'Sempre': a prévia mostra a recusa da aprovação, SEM o aviso de saldo, e o Confirmar desabilitado; aprovada, libera e confirma", async ({ page }) => {
  await login(page);
  const estoque: { segmento: string; id: string }[] = []; const tops: string[] = [];
  try {
    const c = await cadastroDeEstoque(page);
    // Partida: 5 unidades (uma entrada de TOP sem regra geral, confirmada pela API — o caso é a saída).
    const { id: topEntrada } = await criarTopDeEstoque(page, "entrada");
    tops.push(topEntrada);
    await entradaConfirmadaPelaApi(page, { top: topEntrada, empresa: c.empresa, armazem: c.armazem, produto: c.produto }, "5", "10");
    expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity, "premissa: a partida é 5").toBe("5.0000");
    const top = await criarTopFormato4(page, "estoque.saida", { confirmacao: "manual", aprovacao: "sempre" }, tops);

    // (1) A SAÍDA COBERTA, lançada PELA CENTRAL DE ESTOQUE: 2 de 5.
    const doc = await salvarNaCentralEstoque(page, { segmento: "saidas", especie: "saida", top, c, quantidade: "2" }, estoque);
    expect([doc.situacao, "confirmacaoAutomatica" in doc], "aberta; TOP manual não ganha a chave nova").toEqual(["aberto", false]);
    // Sem a chave nova, o aviso é o de hoje (TOP formato 4 MANUAL; o formato 3 é o W-5b).
    await expect(avisoDoSalvar(page, "success"), "TOP Manual: o aviso de hoje, byte a byte").toHaveText(["Salvo com sucesso"]);
    await expect(avisos(page), "um aviso só").toHaveCount(1);
    await consultaAbre(page, "saidas", doc, "aberto");

    // (2) A PRÉVIA: o CORPO primeiro — saldo coberto (nada insuficiente) e a recusa da aprovação.
    const previa = await abrirPreviaEstoque(page, "saidas", doc.id);
    expect(previa.itens.map((i) => [i.insuficiente, i.saldo_atual, i.saldo_depois]), "premissa: o saldo cobre a saída").toEqual([[false, "5.0000", "3.0000"]]);
    expect([previa.podeConfirmar, (previa.recusas ?? []).map((r) => [r.code, r.message])], "o servidor prevê a recusa da aprovação")
      .toEqual([false, [["APROVACAO_PENDENTE", MENSAGEM_APROVACAO_PENDENTE]]]);
    // A TELA: a recusa do documento acima da tabela, com a mensagem do servidor; o aviso de saldo NÃO aparece.
    await expect(page.getByTestId("estoque-previa-recusas")).toBeVisible();
    const recusa = page.getByTestId("estoque-previa-recusa");
    await expect(recusa).toHaveCount(1);
    await expect(recusa).toHaveAttribute("data-code", "APROVACAO_PENDENTE");
    await expect(recusa).toHaveText("Este documento precisa de aprovação antes de ser confirmado.");
    await expect(page.getByTestId("estoque-previa-item"), "a tabela de itens continua lá").toHaveAttribute("data-insuficiente", "false");
    await expect(page.getByTestId("estoque-previa-bloqueio"), "sem item insuficiente, SEM o aviso de saldo").toHaveCount(0);
    await expect(page.getByTestId("estoque-previa-confirmar"), "o Confirmar fica desabilitado").toBeDisabled();
    await fecharPreviaEstoque(page);

    // (3) A PRESENÇA DO AVISO, na MESMA tela e com a MESMA TOP: a saída SEM saldo (50 de 5) mostra os dois.
    const semSaldo = await api<{ id: string }>(page, "POST", "/api/estoque/saidas", {
      empresa_id: c.empresa, tipo_operacao_id: top, armazem_id: c.armazem, data_documento: hojeISO(),
      itens: [{ produto_id: c.produto, quantidade: "50" }]
    });
    estoque.push({ segmento: "saidas", id: semSaldo.id });
    const previaSemSaldo = await abrirPreviaEstoque(page, "saidas", semSaldo.id);
    expect([previaSemSaldo.itens.map((i) => i.insuficiente), (previaSemSaldo.recusas ?? []).map((r) => r.code)], "premissa: falta saldo E falta aprovação")
      .toEqual([[true], ["APROVACAO_PENDENTE"]]);
    await expect(page.getByTestId("estoque-previa-recusa")).toHaveAttribute("data-code", "APROVACAO_PENDENTE");
    await expect(page.getByTestId("estoque-previa-bloqueio"), "com item insuficiente, o aviso de saldo aparece").toBeVisible();
    await expect(page.getByTestId("estoque-previa-bloqueio")).toContainText("Há item sem saldo suficiente");
    await expect(page.getByTestId("estoque-previa-confirmar")).toBeDisabled();
    await fecharPreviaEstoque(page);

    // (4) A PREMISSA DO BOTÃO: a saída coberta, aprovada, libera a prévia — e o Confirmar confirma.
    await api(page, "POST", `/api/aprovacoes/estoque/saidas/${doc.id}/aprovar`, {});
    const aprovada = await abrirPreviaEstoque(page, "saidas", doc.id);
    expect([aprovada.podeConfirmar, aprovada.recusas ?? []], "aprovada, nenhuma recusa").toEqual([true, []]);
    await expect(page.getByTestId("estoque-previa-recusas"), "sem recusa, sem a lista").toHaveCount(0);
    await expect(page.getByTestId("estoque-previa-bloqueio")).toHaveCount(0);
    await expect(page.getByTestId("estoque-previa-confirmar"), "o mesmo botão, agora habilitado").toBeEnabled();
    await page.getByTestId("estoque-previa-confirmar").click();
    await expect(page.getByTestId("estoque-central")).toHaveAttribute("data-situacao", "confirmado");
    expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity, "a saída aprovada baixou o saldo").toBe("3.0000");
  } finally {
    await limpar(page, [], estoque, tops);
  }
});

/**
 * O AVISO DO SALVAR NA CENTRAL DE ESTOQUE, lido do `confirmacaoAutomatica` que o POST devolve — o mesmo produto, o
 * mesmo armazém, quatro TOPs, numa ordem que deixa cada premissa medida no servidor ao lado da conclusão:
 *   (1) formato 3 com "Automática" só DECLARADA (o corte da decisão 277): o corpo de hoje e o aviso de hoje;
 *   (2) Automática com o saldo ZERO: a confirmação recusa, o documento fica salvo e aberto, e o aviso traz a mensagem
 *       que o servidor pôs no corpo (lida do fio, nunca escrita aqui), com o ponto final dela uma vez só;
 *   (3) Automática numa entrada: confirma no POST, e o saldo sobe;
 *   (4) Automática + "Sempre" numa saída COBERTA pelo saldo de (3): para na aprovação, antes de qualquer efeito.
 * O "sem permissão" exige quem lança sem poder confirmar: é o W-5c, logo abaixo.
 */
test("W-5b — Central de Estoque, o aviso do Salvar pelo resultado da confirmação automática: formato 3 'Salvo com sucesso'; Automática sem saldo 'Salvo, mas não confirmado: …'; Automática 'Salvo e confirmado.'; Automática + 'Sempre' 'Salvo. … aprovação …'", async ({ page }) => {
  await login(page);
  const estoque: { segmento: string; id: string }[] = []; const tops: string[] = [];
  try {
    const c = await cadastroDeEstoque(page);
    expect(Number((await saldoNoServidor(page, c.armazem, c.produto)).quantity), "premissa: o produto novo começa sem saldo").toBe(0);

    // (1) O CASO DE HOJE — formato 3 que declara "Automática": o formato 3 só declara, nada confirma sozinho.
    const top3 = await criarTopViaApi(page, "estoque.entrada", cfg3({ confirmacao: "automatica" }), { rotulo: "W-5b formato 3" });
    tops.push(top3.id);
    const lida3 = await detalheTopNoServidor(page, top3.id);
    expect([lida3.configuracaoSchema, lida3.configuracao.valor?.geral.confirmacao], "premissa: formato 3, com a 'Automática' só declarada")
      .toEqual([3, "automatica"]);
    const deHoje = await salvarNaCentralEstoque(page, { segmento: "entradas", especie: "entrada", top: top3.id, c, quantidade: "1", custo: "10" }, estoque);
    expect([deHoje.situacao, "confirmacaoAutomatica" in deHoje], "o corpo de hoje: aberto, SEM a chave nova").toEqual(["aberto", false]);
    await expect(avisoDoSalvar(page, "success"), "sem a chave, o aviso de hoje, byte a byte").toHaveText(["Salvo com sucesso"]);
    await expect(avisos(page), "um aviso só").toHaveCount(1);
    await consultaAbre(page, "entradas", deHoje, "aberto");

    // (2) AUTOMÁTICA SEM SALDO: o servidor tenta, a confirmação recusa — salvo e aberto.
    const topRecusa = await criarTopFormato4(page, "estoque.saida", { confirmacao: "automatica", aprovacao: "nenhuma" }, tops);
    const recusado = await salvarNaCentralEstoque(page, { segmento: "saidas", especie: "saida", top: topRecusa, c, quantidade: "2" }, estoque);
    const resultado = recusado.confirmacaoAutomatica;
    expect([recusado.situacao, resultado?.confirmado, resultado?.motivo], "o servidor tentou e recusou: o documento fica salvo e aberto")
      .toEqual(["aberto", false, "recusada"]);
    const mensagem = resultado?.erro?.message ?? "";
    // A premissa do molde: a mensagem é a do saldo e termina em UM ponto — o aviso não pode dobrá-lo nem perdê-lo.
    expect(mensagem, "premissa: a recusa é a do saldo, e a mensagem do servidor termina em ponto").toMatch(/^Saldo insuficiente .*[^.]\.$/);
    await expect(avisoDoSalvar(page, "warning"), "o aviso traz a mensagem do servidor, com o ponto final uma vez só")
      .toHaveText([`Salvo, mas não confirmado: ${mensagem}`]);
    await expect(avisos(page), "um aviso só (nada de 'Salvo com sucesso' ao lado)").toHaveCount(1);
    await consultaAbre(page, "saidas", recusado, "aberto");
    expect(Number((await saldoNoServidor(page, c.armazem, c.produto)).quantity), "a recusa não moveu o saldo").toBe(0);

    // (3) AUTOMÁTICA numa ENTRADA: confirma no fim do POST.
    const topConfirma = await criarTopFormato4(page, "estoque.entrada", { confirmacao: "automatica", aprovacao: "nenhuma" }, tops);
    const confirmado = await salvarNaCentralEstoque(page, { segmento: "entradas", especie: "entrada", top: topConfirma, c, quantidade: "5", custo: "10" }, estoque);
    expect([confirmado.situacao, confirmado.confirmacaoAutomatica], "o servidor confirmou no fim do POST").toEqual(["confirmado", { confirmado: true }]);
    await expect(avisoDoSalvar(page, "success")).toHaveText(["Salvo e confirmado."]);
    await expect(avisos(page), "um aviso só").toHaveCount(1);
    await consultaAbre(page, "entradas", confirmado, "confirmado");
    expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity, "a entrada confirmada subiu o saldo (e cobre a saída de (4))").toBe("5.0000");

    // (4) AUTOMÁTICA + "SEMPRE" numa saída COBERTA (2 de 5): a única razão para não confirmar é a aprovação.
    const topAprovacao = await criarTopFormato4(page, "estoque.saida", { confirmacao: "automatica", aprovacao: "sempre" }, tops);
    const pendente = await salvarNaCentralEstoque(page, { segmento: "saidas", especie: "saida", top: topAprovacao, c, quantidade: "2" }, estoque);
    expect([pendente.situacao, pendente.confirmacaoAutomatica], "o servidor parou na aprovação")
      .toEqual(["aberto", { confirmado: false, motivo: "aguardando_aprovacao" }]);
    await expect(avisoDoSalvar(page, "info")).toHaveText(["Salvo. Este documento precisa de aprovação antes de ser confirmado."]);
    await expect(avisos(page), "um aviso só").toHaveCount(1);
    await consultaAbre(page, "saidas", pendente, "aberto");
    expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity, "a aprovação pendente não moveu o saldo").toBe("5.0000");
  } finally {
    await limpar(page, [], estoque, tops);
  }
});

/**
 * O AVISO "SEM PERMISSÃO" — quem LANÇA a saída mas não pode CONFIRMÁ-LA. A confirmação automática é feita por quem
 * salvou, com a capacidade da confirmação manual (`saidas_estoque.edit`): a TOP nunca dá a ninguém um poder que ele
 * não tem. O papel do caso nasce pela API (o molde do W-3c): VER e LANÇAR saídas, e o que a Central pede para lançar
 * (armazém e produto) — SEM `saidas_estoque.edit` —, com o escopo de estoque EXPLÍCITO na empresa do cadastro.
 * A premissa fica ao lado: o MESMO lançamento (a mesma TOP, o mesmo armazém, o mesmo produto, a mesma quantidade,
 * sobre o mesmo saldo) pelo administrador confirma — o que faltou ao primeiro foi só a capacidade.
 */
test("W-5c — Central de Estoque, quem lança sem poder confirmar, TOP Automática com saldo: 'Salvo, mas não confirmado: você não tem permissão …', aberto, saldo parado; o mesmo lançamento pelo administrador confirma", async ({ page }) => {
  await login(page);
  const estoque: { segmento: string; id: string }[] = []; const tops: string[] = [];
  const marca = Date.now().toString(36);
  const credencial = { email: `lancador.saidas.${marca}@e2e.local`, password: "Demo@12345" };
  let comoLancador = false;
  try {
    const c = await cadastroDeEstoque(page);
    // Partida: 5 unidades (uma entrada de TOP sem regra geral, confirmada pela API — o caso é a saída).
    const { id: topEntrada } = await criarTopDeEstoque(page, "entrada");
    tops.push(topEntrada);
    await entradaConfirmadaPelaApi(page, { top: topEntrada, empresa: c.empresa, armazem: c.armazem, produto: c.produto }, "5", "10");
    expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity, "premissa: a partida é 5").toBe("5.0000");
    const top = await criarTopFormato4(page, "estoque.saida", { confirmacao: "automatica", aprovacao: "nenhuma" }, tops);

    // Quem lança saídas e não as confirma. O escopo é EXPLÍCITO: sem ele o servidor é fail-closed e o lançamento
    // seria recusado por falta de acesso à empresa — aqui ele grava, e só a confirmação fica de fora.
    const papel = await api<{ id: string }>(page, "POST", "/api/admin/roles", {
      name: `Lançador de saídas E2E ${marca}`, permissions: ["saidas_estoque.view", "saidas_estoque.create", "warehouses.view", "products.view"]
    });
    await api(page, "POST", "/api/admin/members", {
      name: "Lançador de Saídas E2E", email: credencial.email, password: credencial.password, role_id: papel.id,
      escopos_empresas: [{ modulo: "estoque", modo: "selecionadas", empresas: [c.empresa] }]
    });
    await logout(page);
    await login(page, credencial);
    comoLancador = true;

    // O SERVIDOR primeiro: ele lança, não confirma, e opera na empresa do cadastro (a que a Central escolhe sozinha).
    const contexto = await api<{ isOwner: boolean; permissions: string[] }>(page, "GET", "/api/auth/context");
    expect([contexto.isOwner, contexto.permissions.includes("saidas_estoque.create"), contexto.permissions.includes("saidas_estoque.edit")],
      "premissa: não é dono, LANÇA saída e NÃO a confirma").toEqual([false, true, false]);
    expect(await empresaAtiva(page), "premissa: a empresa da Central dele é a do cadastro (a do armazém)").toBe(c.empresa);

    // (1) PELA CENTRAL DE ESTOQUE, por ele: 2 de 5 — o saldo cobre, a TOP é Automática, falta só a capacidade.
    const semPermissao = await salvarNaCentralEstoque(page, { segmento: "saidas", especie: "saida", top, c, quantidade: "2" }, estoque);
    expect([semPermissao.situacao, semPermissao.confirmacaoAutomatica], "o corpo do 201: salvo e aberto, e o motivo é a capacidade")
      .toEqual(["aberto", { confirmado: false, motivo: "sem_permissao" }]);
    await expect(avisoDoSalvar(page, "warning"), "o aviso de quem não pode confirmar, no tom de atenção")
      .toHaveText(["Salvo, mas não confirmado: você não tem permissão para confirmar este documento."]);
    await expect(avisos(page), "um aviso só (nada de 'Salvo com sucesso' ao lado)").toHaveCount(1);
    await consultaAbre(page, "saidas", semPermissao, "aberto");

    // De volta ao administrador: o saldo é lido por quem pode ler (o lançador não tem `stocks.view`).
    await logout(page);
    await login(page);
    comoLancador = false;
    const lido = await api<{ situacao: string }>(page, "GET", `/api/estoque/saidas/${semPermissao.id}`);
    expect(lido.situacao, "no servidor também: aberto").toBe("aberto");
    expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity, "sem a confirmação, o saldo ficou parado").toBe("5.0000");

    // (2) A PREMISSA: o MESMO lançamento, sobre o MESMO saldo, por quem pode confirmar — confirma no fim do POST.
    const completo = await salvarNaCentralEstoque(page, { segmento: "saidas", especie: "saida", top, c, quantidade: "2" }, estoque);
    expect([completo.situacao, completo.confirmacaoAutomatica], "premissa: com a capacidade, a mesma TOP confirma").toEqual(["confirmado", { confirmado: true }]);
    await expect(avisoDoSalvar(page, "success")).toHaveText(["Salvo e confirmado."]);
    await expect(avisos(page), "um aviso só").toHaveCount(1);
    await consultaAbre(page, "saidas", completo, "confirmado");
    expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity, "a saída confirmada baixou o saldo").toBe("3.0000");
  } finally {
    // De volta ao administrador para limpar (o lançador não cancela documento).
    if (comoLancador) {
      await logout(page).catch(() => page.evaluate(() => localStorage.removeItem("agro.session")));
      await login(page);
    }
    await limpar(page, [], estoque, tops);
  }
});
