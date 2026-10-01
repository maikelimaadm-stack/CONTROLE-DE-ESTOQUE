import { test, expect, type Page, type Request, type Response } from "@playwright/test";
import { MENSAGEM_APROVACAO_PENDENTE } from "@agro/domain";
import { login, api, uniq, pickRef, adicionarItemNaCentral, escolherPrimeiroProdutoDaLinha, preencherClassificacaoFinanceira } from "./helpers";
import { criarParceiro } from "./aj02-comum";
import { cadastroDeEstoque, criarTopDeEstoque, entradaConfirmadaPelaApi, escolherNaReferencia, hojeISO, saldoNoServidor } from "./estoque-01-comum";
import { cfg4, criarTopViaApi, detalheTopNoServidor, excluirTopE2E } from "./top-config-08-comum";

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
type ResultadoAutomatica = { confirmado: boolean; motivo?: string };
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
    await page.goto(`/estoque/movimentacoes/saidas/new?tipo_operacao_id=${top}`);
    const central = page.getByTestId("estoque-central");
    await expect(central).toHaveAttribute("data-especie", "saida");
    await expect(central).toHaveAttribute("data-modo", "criacao");
    await expect(page.getByTestId("estoque-central-top"), "a TOP formato 4 vem travada").toHaveAttribute("data-tipo-operacao-id", top);
    await escolherNaReferencia(page, page.getByTestId("estoque-central-armazem"), c.nomeArmazem);
    await page.getByTestId("estoque-item-adicionar").click();
    const linha = page.getByTestId("estoque-item").first();
    await escolherNaReferencia(page, linha.getByTestId("estoque-item-produto"), c.nomeProduto);
    await linha.getByTestId("estoque-item-quantidade").fill("2");
    const salvou = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/estoque/saidas");
    await page.getByTestId("estoque-salvar").click();
    const criado = await salvou;
    expect(criado.status(), "a saída foi salva").toBe(201);
    const doc = await criado.json() as { id: string; codigo: string; situacao: string };
    estoque.push({ segmento: "saidas", id: doc.id });
    expect([doc.situacao, "confirmacaoAutomatica" in doc], "aberta; TOP manual não ganha a chave nova").toEqual(["aberto", false]);
    await expect(page).toHaveURL(new RegExp(`/estoque/movimentacoes/saidas/${doc.id}$`));

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
