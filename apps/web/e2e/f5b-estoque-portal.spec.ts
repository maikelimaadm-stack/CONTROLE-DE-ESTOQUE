import { test, expect, type Locator, type Page, type Request } from "@playwright/test";
import { entendeMovimentacaoInterna, familiaOperacionalDeDocumentoEstoque } from "@agro/domain";
import { api, empresaAtiva, login, uniq } from "./helpers";
import { cadastroDeEstoque, criarTopDeEstoque, entradaConfirmadaPelaApi, hojeISO, saldoNoServidor, type EspecieEstoqueE2E } from "./estoque-01-comum";
import { cfg5, chamarApi, criarTopViaApi, detalheTopNoServidor, excluirTopE2E } from "./top-config-08-comum";

/**
 * O PORTAL DE ESTOQUE COM A CENTRAL NO MOTOR (OPERACOES-01 F5b, decisão 282) — PT-1 a PT-3.
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PROVA ──────────────────────────────────────────────────────────────────────┐
 * │ A Central de Estoque no motor é provada em `f5b-movimentacao-interna.spec.ts` (MI-W1..W3) e em      │
 * │ `estoque-01-documento.spec.ts` (ES-W1/W2). O que fica para cá são as PORTAS do portal que levam a ela: │
 * │   PT-1 a lista (os chips e o "+ Novo" das SETE espécies) e o "Ajustar estoque" do Saldo, que abre a   │
 * │        Central de ajuste PREENCHIDA pela linha (empresa, Local de estoque, produto e lote), com a     │
 * │        contagem e o custo — e o servidor confirma pelo custo informado;                              │
 * │   PT-2 a fila de Aprovações › Estoque com as ações das espécies novas (a requisição da TOP "Sempre") │
 * │        — a F5a deixou a linha sem ações —, e a aprovação vale no servidor;                           │
 * │   PT-3 o configurador de layouts oferece os movimentos de estoque, e o "Abrir na Central" do layout   │
 * │        ligado a uma TOP de consumo leva à Central de Estoque com esse layout.                        │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Toda verdade da tela tem a do SERVIDOR ao lado (a capacidade declarada, o corpo do POST no fio, o documento relido,
 * o saldo pela API). Cada caso cria o PRÓPRIO cadastro (TOPs, produto, partida de saldo) pela API; no `finally`, o
 * documento que ficou aberto é cancelado, o layout é desligado e inativado e as TOPs saem pela exclusão lógica da API
 * — nada é apagado (decisão 247).
 */

/** As sete espécies e as famílias delas, ESCRITAS AQUI (conferidas contra o registry na premissa): o domínio não se aprova sozinho. */
const SETE: readonly { especie: EspecieEstoqueE2E; segmento: string; familia: string; rotulo: string }[] = [
  { especie: "entrada", segmento: "entradas", familia: "estoque.entrada", rotulo: "Entrada" },
  { especie: "saida", segmento: "saidas", familia: "estoque.saida", rotulo: "Saída" },
  { especie: "transferencia", segmento: "transferencias", familia: "estoque.transferencia", rotulo: "Transferência" },
  { especie: "ajuste", segmento: "ajustes", familia: "estoque.ajuste", rotulo: "Ajuste" },
  { especie: "requisicao", segmento: "requisicoes", familia: "estoque.requisicao_material", rotulo: "Requisição" },
  { especie: "consumo", segmento: "consumos", familia: "estoque.consumo", rotulo: "Consumo" },
  { especie: "devolucao_consumo", segmento: "devolucoes-consumo", familia: "estoque.devolucao_consumo", rotulo: "Devolução de consumo" }
];

type Opcao = { id: string; label: string };
type DocLido = {
  id: string; codigo: string; especie: string; situacao: string; empresa_id: string; armazem_id: string;
  itens: { produto_id: string; quantidade_contada: string | null; custo_unitario: string | null; lote: string | null }[];
  movimentos: { movement_type: string; direction: number; quantity: string; unit_cost: string; provider_lot: string | null }[];
};

const ehPostDe = (segmento: string) => (r: Request) => r.method() === "POST" && new URL(r.url()).pathname === `/api/estoque/${segmento}`;
const idDaUrl = (page: Page, segmento: string) => new RegExp(`/estoque/movimentacoes/${segmento}/([0-9a-f-]{36})$`).exec(page.url())![1]!;

/** A premissa de todo o arquivo: a API deste HEAD declara a movimentação interna nas SETE espécies, e o registry dá as famílias escritas acima. */
async function premissaDasSete(page: Page) {
  for (const s of SETE) {
    expect(familiaOperacionalDeDocumentoEstoque(s.especie), `premissa: o registry dá a família de ${s.especie}`).toBe(s.familia);
    const r = await api<{ capacidades?: unknown }>(page, "GET", `/api/estoque/${s.segmento}/operation-types`);
    expect(entendeMovimentacaoInterna(r.capacidades), `premissa: /api/estoque/${s.segmento}/operation-types declara movimentacaoInterna`).toBe(true);
  }
}

/** Marca a linha da grade do motor (o círculo alterna: só clica quando ela ainda não está marcada). */
async function marcarLinha(linha: Locator) {
  const circulo = linha.getByTestId("central-estoque-selecionar-item");
  if ((await circulo.getAttribute("aria-checked")) !== "true") await circulo.click();
  await expect(circulo).toHaveAttribute("aria-checked", "true");
}

/** Abre a prévia da consulta e confirma; devolve o item da prévia já conferido pelo chamador. */
async function confirmarPelaPrevia(page: Page, conferir: (item: Locator) => Promise<void>) {
  await page.getByTestId("estoque-confirmar").click();
  await expect(page.getByTestId("estoque-previa-corpo"), "a prévia está pronta").toHaveAttribute("data-situacao", "pronta");
  await conferir(page.getByTestId("estoque-previa-item"));
  await page.getByTestId("estoque-previa-confirmar").click();
  await expect(page.getByTestId("estoque-central"), "confirmado").toHaveAttribute("data-situacao", "confirmado");
}

/** No fim: o documento que ficou aberto é cancelado, e as TOPs saem pela exclusão lógica da API. */
async function limpar(page: Page, docs: { segmento: string; id: string }[], tops: string[]) {
  for (const d of docs) {
    const lido = await api<{ situacao: string }>(page, "GET", `/api/estoque/${d.segmento}/${d.id}`).catch(() => null);
    if (lido?.situacao === "aberto") await api(page, "POST", `/api/estoque/${d.segmento}/${d.id}/cancelar`, {}).catch(() => undefined);
  }
  for (const id of tops) await excluirTopE2E(page, id);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * PT-1 — A LISTA DAS SETE E O "AJUSTAR ESTOQUE" DO SALDO NA CENTRAL DE AJUSTE, PREENCHIDA PELA LINHA
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("PT-1 — Movimentações tem os chips e o '+ Novo' das SETE espécies; no Saldo, 'Ajustar estoque' de uma linha com lote (de outra empresa) abre a Central de ajuste PREENCHIDA, e a contagem com custo vale no servidor", async ({ page }) => {
  await login(page);
  const tops: string[] = []; const docs: { segmento: string; id: string }[] = [];
  try {
    await premissaDasSete(page);
    // As TOPs das três espécies novas (para os grupos do "+ Novo" terem o que mostrar), a de entrada (a partida) e a de ajuste.
    const novas: Record<string, string> = {};
    for (const especie of ["requisicao", "consumo", "devolucao_consumo"] as const) {
      novas[especie] = (await criarTopDeEstoque(page, especie)).id;
      tops.push(novas[especie]!);
    }
    const topEntrada = (await criarTopDeEstoque(page, "entrada")).id; tops.push(topEntrada);
    const topAjuste = (await criarTopDeEstoque(page, "ajuste")).id; tops.push(topAjuste);

    // (1) A LISTA: os chips das sete espécies, na ordem do domínio, e a coluna do atendimento da requisição.
    await page.goto("/estoque?tab=movimentacoes");
    await expect(page.getByTestId("estoque-movimentacoes"), "a aba Movimentações abre").toBeVisible();
    await expect(page.getByTestId("estoque-movimentacoes-indisponivel"), "a API deste HEAD serve a lista única").toHaveCount(0);
    await expect(page.getByTestId("estoque-filtro-especie").getByRole("radio"), "os chips: Todas e as SETE espécies")
      .toHaveText(["Todas", ...SETE.map((s) => s.rotulo)]);
    await expect(page.getByRole("columnheader").filter({ hasText: "Atendimento" }), "com a capacidade, a coluna do atendimento").toHaveCount(1);

    // (2) O "+ NOVO": um grupo por espécie, as sete, na ordem do domínio — e as TOPs das três novas dentro do grupo delas.
    await page.getByTestId("estoque-novo").click();
    const lancador = page.getByTestId("lancador-unificado");
    await expect(lancador).toBeVisible();
    const grupos = lancador.getByTestId("lancador-grupo");
    await expect(grupos, "um grupo por espécie oferecida").toHaveCount(SETE.length);
    expect(await grupos.evaluateAll((gs) => gs.map((g) => g.getAttribute("data-familia"))), "os grupos são as SETE famílias").toEqual(SETE.map((s) => s.familia));
    for (const s of SETE.filter((x) => x.especie in novas)) {
      await expect(lancador.locator(`[data-testid="lancador-grupo"][data-familia="${s.familia}"] [data-testid="lancador-top"][data-top-id="${novas[s.especie]}"]`),
        `a TOP de ${s.rotulo} está no grupo dela`).toBeVisible();
    }
    await page.getByTestId("lancador-cancelar").click();
    await expect(lancador).toHaveCount(0);

    // (3) A LINHA DO SALDO: um produto COM LOTE, numa empresa que NÃO é a padrão (só assim o preenchimento prova que vem
    // da linha, e não do padrão da Central), com a partida de 5 a 10,00 no lote.
    const padrao = await empresaAtiva(page);
    const ctx = await api<{ empresas?: { id: string; name: string }[] }>(page, "GET", "/api/auth/context");
    const locais = await api<{ items: { id: string; empresa_id?: string; description: string; is_active?: boolean }[] }>(page, "GET", "/api/resources/warehouses?pageSize=100");
    const outra = (ctx.empresas ?? []).filter((e) => e.id !== padrao)
      .map((e) => ({ empresa: e, local: locais.items.find((w) => w.empresa_id === e.id && w.is_active !== false) }))
      .find((x) => x.local);
    expect(outra, "premissa: a semente tem uma segunda empresa com local de estoque").toBeTruthy();
    const { empresa, local } = outra as { empresa: { id: string; name: string }; local: { id: string; description: string } };
    const unidades = await api<Opcao[]>(page, "GET", "/api/resources/measurement_units/options");
    const grupos2 = await api<Opcao[]>(page, "GET", "/api/resources/product_groups/options?kind=analytic");
    const naturezas = await api<Opcao[]>(page, "GET", "/api/resources/financial_categories/options?kind=analytic&nature=expense");
    const un = unidades.find((u) => u.label.toUpperCase() === "UN");
    expect([Boolean(un), grupos2.length > 0, naturezas.length > 0], "premissa: unidade UN, grupo analítico e natureza de despesa").toEqual([true, true, true]);
    const nomeProduto = uniq("PT-1 produto com lote");
    const produto = (await api<{ id: string }>(page, "POST", "/api/resources/products", {
      description: nomeProduto, group_id: grupos2[0]!.id, measurement_id: un!.id, financial_category_id: naturezas[0]!.id, controle_lote: "lote"
    })).id;
    const lote = `PT1-${Date.now().toString(36).toUpperCase()}`;
    const partida = await api<{ id: string; situacao: string }>(page, "POST", "/api/estoque/entradas", {
      empresa_id: empresa.id, tipo_operacao_id: topEntrada, armazem_id: local.id, data_documento: hojeISO(),
      itens: [{ produto_id: produto, quantidade: "5", custo_unitario: "10", lote }]
    });
    expect((await api<{ situacao: string }>(page, "POST", `/api/estoque/entradas/${partida.id}/confirmar`, {})).situacao, "premissa: a partida confirmada").toBe("confirmado");
    const doSaldo = await api<{ items: { warehouse_id: string; empresa_id?: string; provider_lot: string | null; quantity: string }[] }>(page, "GET", `/api/stock/balances?product_id=${produto}`);
    expect(doSaldo.items.map((x) => [x.warehouse_id, x.empresa_id, x.provider_lot, x.quantity]), "premissa: a linha do Saldo traz a empresa no fio, com o lote")
      .toEqual([[local.id, empresa.id, lote, "5.0000"]]);

    // (4) "AJUSTAR ESTOQUE" → a Central de ajuste (não o diálogo antigo), sem TOP: o lançador, e o "Continuar" preserva a linha.
    await page.goto(`/estoque?tab=estoque&sub=saldo&product_id=${produto}`);
    const noSaldo = page.getByRole("row").filter({ hasText: lote });
    await expect(noSaldo, "a linha do lote no Saldo").toHaveCount(1);
    await noSaldo.getByRole("button", { name: "Ajustar estoque" }).click();
    await expect(page).toHaveURL(new RegExp(`/estoque/movimentacoes/ajustes/new\\?empresa_id=${empresa.id}&armazem_id=${local.id}&produto_id=${produto}&lote=${lote}$`));
    await expect(page.getByRole("dialog").filter({ hasText: "Ajustar estoque" }), "nada do diálogo antigo").toHaveCount(0);
    await expect(page.getByTestId("top-lancador"), "sem a TOP na URL, a Central abre no lançador").toBeVisible();
    await page.locator(`[data-testid="top-opcao"][data-top-id="${topAjuste}"]`).click();
    await page.getByTestId("top-continuar").click();
    await expect(page).toHaveURL(new RegExp(`/estoque/movimentacoes/ajustes/new\\?tipo_operacao_id=${topAjuste}&empresa_id=${empresa.id}&armazem_id=${local.id}&produto_id=${produto}&lote=${lote}$`));

    // (5) A CENTRAL DE AJUSTE PREENCHIDA: a empresa e o local da linha, e UMA linha com o produto e o lote; a contagem em branco.
    const central = page.getByTestId("estoque-central");
    await expect(central).toHaveAttribute("data-especie", "ajuste");
    await expect(central).toHaveAttribute("data-modo", "criacao");
    await expect(page.getByTestId("estoque-central-empresa"), "a empresa da linha, não a padrão").toContainText(empresa.name);
    await expect(page.getByTestId("estoque-central-armazem"), "o Local de estoque da linha").toContainText(local.description);
    const linhas = page.getByTestId("central-estoque-linha");
    await expect(linhas, "uma linha, a do Saldo").toHaveCount(1);
    await expect(linhas.first().getByTestId("central-estoque-produto"), "o produto da linha").toContainText(nomeProduto);
    await marcarLinha(linhas.first());
    await expect(linhas.first().getByLabel("Lote do item 1"), "o lote da linha").toHaveValue(lote);
    await expect(linhas.first().getByLabel("Quantidade do item 1"), "a contagem nasce em branco (nunca \"1\")").toHaveValue("");
    const cabecalhos = (await page.getByTestId("central-estoque-grade").locator("thead th").allTextContents()).map((x) => x.trim());
    expect(cabecalhos, "a contagem e o custo informável do ajuste").toEqual(expect.arrayContaining(["Quantidade contada", "Custo unitário"]));
    await linhas.first().getByLabel("Quantidade do item 1").fill("3");
    await linhas.first().getByLabel("Valor unitário do item 1").fill("7");

    // (6) SALVAR: o corpo é o da linha do Saldo, com a contagem e o custo em texto; o saldo não muda.
    const post = page.waitForRequest(ehPostDe("ajustes"));
    const resposta = page.waitForResponse((r) => ehPostDe("ajustes")(r.request()));
    await page.getByTestId("estoque-salvar").click();
    const corpo = (await post).postDataJSON() as Record<string, unknown>;
    expect((await resposta).status(), "o servidor gravou o ajuste").toBe(201);
    expect(Object.keys(corpo).sort(), "o cabeçalho do ajuste").toEqual(["armazem_id", "data_documento", "empresa_id", "itens", "tipo_operacao_id"]);
    expect(corpo, "a empresa, o local e a TOP").toMatchObject({ empresa_id: empresa.id, armazem_id: local.id, tipo_operacao_id: topAjuste });
    expect(corpo["itens"], "o produto e o lote da linha, a contagem e o custo").toEqual([{ produto_id: produto, quantidade_contada: "3", custo_unitario: "7", lote }]);
    await expect(page).toHaveURL(/\/estoque\/movimentacoes\/ajustes\/[0-9a-f-]{36}$/);
    const ajuste = idDaUrl(page, "ajustes");
    docs.push({ segmento: "ajustes", id: ajuste });
    await expect(central).toHaveAttribute("data-situacao", "aberto");
    expect((await saldoNoServidor(page, local.id, produto)).quantity, "salvar o ajuste não muda o saldo").toBe("5.0000");

    // (7) CONFIRMAR pela prévia: 5 → 3 (diferença −2), e o servidor tira 2 do lote pelo custo INFORMADO (7), não pelo médio (10).
    await confirmarPelaPrevia(page, async (item) => {
      await expect(item).toHaveAttribute("data-saldo-atual", "5.0000");
      await expect(item).toHaveAttribute("data-saldo-depois", "3.0000");
      await expect(item).toHaveAttribute("data-diferenca", "-2.0000");
    });
    const lido = await api<DocLido>(page, "GET", `/api/estoque/ajustes/${ajuste}`);
    expect([lido.empresa_id, lido.armazem_id], "o ajuste é da empresa e do local da linha").toEqual([empresa.id, local.id]);
    expect(lido.movimentos.map((m) => [m.movement_type, m.direction, m.quantity, Number(m.unit_cost), m.provider_lot]), "correção para baixo de 2, no lote, pelo custo informado")
      .toEqual([["correction_out", -1, "2.0000", 7, lote]]);
    expect((await saldoNoServidor(page, local.id, produto)).quantity, "o saldo é a contagem").toBe("3.0000");
  } finally {
    await limpar(page, docs, tops);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * PT-2 — APROVAÇÕES › ESTOQUE: A REQUISIÇÃO DA TOP "SEMPRE" TEM AS AÇÕES, E A APROVAÇÃO VALE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("PT-2 — Aprovações › Estoque: a requisição de uma TOP 'Aprovação: Sempre' aparece com Abrir, Aprovar e Reprovar; sem aprovação a confirmação recusa; aprovada, a confirmação passa e reserva", async ({ page }) => {
  await login(page);
  const tops: string[] = []; const docs: { segmento: string; id: string }[] = [];
  try {
    await premissaDasSete(page);
    const c = await cadastroDeEstoque(page);
    const topEntrada = (await criarTopDeEstoque(page, "entrada")).id; tops.push(topEntrada);
    await entradaConfirmadaPelaApi(page, { top: topEntrada, empresa: c.empresa, armazem: c.armazem, produto: c.produto }, "5", "10");
    const familia = familiaOperacionalDeDocumentoEstoque("requisicao")!;
    const top = await criarTopViaApi(page, familia, cfg5({ confirmacao: "manual", aprovacao: "sempre" }), { rotulo: "PT-2 requisição" });
    tops.push(top.id);
    const gravada = await detalheTopNoServidor(page, top.id);
    expect([gravada.configuracaoSchema, gravada.configuracao.valor?.aprovacao.politica, gravada.configuracao.valor?.geral.confirmacao],
      "premissa: a TOP da requisição no formato 5, com 'Aprovação: Sempre' e confirmação manual").toEqual([5, "sempre", "manual"]);

    const req = await api<{ id: string; codigo: string; situacao: string }>(page, "POST", "/api/estoque/requisicoes", {
      empresa_id: c.empresa, tipo_operacao_id: top.id, armazem_id: c.armazem, data_documento: hojeISO(), itens: [{ produto_id: c.produto, quantidade: "2" }]
    });
    docs.push({ segmento: "requisicoes", id: req.id });
    expect(req.situacao, "premissa: a requisição nasce aberta").toBe("aberto");
    const antes = await chamarApi<{ error?: { code?: string } }>(page, "POST", `/api/estoque/requisicoes/${req.id}/confirmar`, {});
    expect([antes.status, antes.corpo.error?.code], "premissa: sem aprovação, a confirmação recusa").toEqual([409, "APROVACAO_PENDENTE"]);
    const fila = await api<{ items: { id: string; especie: string; situacao: string }[] }>(page, "GET", "/api/aprovacoes/estoque?page=1&pageSize=200");
    expect(fila.items.filter((l) => l.id === req.id).map((l) => [l.especie, l.situacao]), "premissa: a fila do servidor tem a requisição pendente").toEqual([["requisicao", "pendente"]]);

    // (1) A FILA: a linha da requisição, pendente, com as TRÊS ações (a F5a a deixava sem nenhuma).
    await page.goto("/aprovacoes?tab=estoque");
    await expect(page.getByTestId("aprovacoes-indisponivel"), "a API deste HEAD serve a fila").toHaveCount(0);
    await expect(page.getByTestId("aprovacoes-lista"), "a fila do estoque montou").toHaveAttribute("data-area", "estoque");
    const linha = page.locator(`[data-testid="aprovacao-linha"][data-id="${req.id}"]`);
    await expect(linha).toHaveAttribute("data-especie", "requisicao");
    await expect(linha).toHaveAttribute("data-situacao", "pendente");
    await expect(linha).toHaveAttribute("data-codigo", req.codigo);
    await expect(page.getByRole("row").filter({ has: linha }), "a coluna Espécie diz a espécie").toContainText("Requisição");
    for (const acao of ["abrir", "aprovar", "reprovar"]) await expect(page.getByTestId(`aprovacao-${acao}-${req.id}`), `a requisição tem ${acao}`).toBeVisible();

    // (2) ABRIR → a Central de Estoque em consulta, com ESTA requisição, ainda aberta.
    await page.getByTestId(`aprovacao-abrir-${req.id}`).click();
    await expect(page).toHaveURL(new RegExp(`/estoque/movimentacoes/requisicoes/${req.id}$`));
    const central = page.getByTestId("estoque-central");
    await expect(central).toHaveAttribute("data-especie", "requisicao");
    await expect(central).toHaveAttribute("data-modo", "consulta");
    await expect(central).toHaveAttribute("data-situacao", "aberto");
    await expect(page.getByTestId("estoque-central-codigo")).toHaveText(req.codigo);

    // (3) APROVAR na fila → a porta da espécie, "Aprovado." e a linha sai.
    await page.goto("/aprovacoes?tab=estoque");
    await expect(page.getByTestId("aprovacoes-lista")).toHaveAttribute("data-area", "estoque");
    await page.getByTestId(`aprovacao-aprovar-${req.id}`).click();
    const dialogo = page.getByTestId("aprovacao-dialogo");
    await expect(dialogo.getByRole("heading", { name: `Aprovar o documento ${req.codigo}?` })).toBeVisible();
    const porta = `/api/aprovacoes/estoque/requisicoes/${req.id}/aprovar`;
    const aprovou = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === porta);
    await dialogo.getByTestId("aprovacao-confirmar").click();
    const resposta = await aprovou;
    expect(resposta.status(), "a porta da decisão é a da requisição").toBe(200);
    expect(((await resposta.json()) as { aprovacao: { decisao: string } }).aprovacao.decisao).toBe("aprovado");
    await expect(page.getByTestId("aprovacao-mensagem")).toHaveText("Aprovado.");
    await expect(linha, "a linha aprovada sai da fila").toHaveCount(0);

    // (4) O SERVIDOR: aprovada, a prévia libera, a confirmação passa e a requisição reserva 2 dos 5.
    const previa = await api<{ podeConfirmar: boolean; recusas?: unknown[] }>(page, "GET", `/api/estoque/requisicoes/${req.id}/previa-confirmacao`);
    expect([previa.podeConfirmar, previa.recusas], "aprovada, a prévia libera").toEqual([true, []]);
    expect((await api<{ situacao: string }>(page, "POST", `/api/estoque/requisicoes/${req.id}/confirmar`, {})).situacao, "e a confirmação passa").toBe("confirmado");
    const reservado = await api<{ quantity: string; reservado: string; disponivel: string }>(page, "GET", `/api/stock/balances/${c.armazem}/${c.produto}`);
    expect([reservado.quantity, reservado.reservado, reservado.disponivel], "a requisição confirmada reserva 2; o físico não muda").toEqual(["5.0000", "2.0000", "3.0000"]);
    // A requisição confirmada continua RESERVANDO: cancelada no fim, a reserva não fica para quem vier depois.
    await api(page, "POST", `/api/estoque/requisicoes/${req.id}/cancelar`, {});
  } finally {
    await limpar(page, docs, tops);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * PT-3 — O CONFIGURADOR DE LAYOUTS OFERECE O MOVIMENTO DE ESTOQUE, E "ABRIR NA CENTRAL" LEVA À CENTRAL DE ESTOQUE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

const BASE_LAYOUTS = "/api/admin/layouts-documento";

test("PT-3 — o assistente de layouts oferece os sete movimentos de estoque (depois de vendas e compras); um layout de Consumo ligado a uma TOP mostra 'Abrir na Central' para /estoque/movimentacoes/consumos/new?tipo_operacao_id=<top>, e a Central abre com ele", async ({ page }) => {
  await login(page);
  const tops: string[] = []; const layouts: string[] = [];
  try {
    await premissaDasSete(page);
    const consumo = SETE.find((s) => s.especie === "consumo")!;
    const top = (await criarTopDeEstoque(page, "consumo")).id; tops.push(top);
    const nome = uniq("PT-3 layout do consumo");

    // (1) O ASSISTENTE: o primeiro movimento continua o de vendas (o estoque entra POR ÚLTIMO), e os sete de estoque estão lá.
    await page.goto("/configuracoes?tab=operacoes&sub=layouts-documento");
    await expect(page.getByTestId("layouts-tela")).toBeVisible();
    await page.getByTestId("layouts-novo").click();
    await expect(page.getByTestId("layout-novo-passo-1")).toBeVisible();
    const movimento = page.getByTestId("layout-novo-familia");
    await expect(movimento, "o Novo continua abrindo no orçamento de venda").toHaveValue("vendas.orcamento");
    const oferecidos = await movimento.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    const doEstoque = oferecidos.filter((v) => v.startsWith("estoque."));
    expect(doEstoque, "os sete movimentos de estoque, na ordem do registry").toEqual(SETE.map((s) => s.familia));
    expect(oferecidos.some((v) => v.startsWith("compras.")), "premissa: compras também é oferecido").toBe(true);
    // O estoque entra DEPOIS de vendas e de compras (a ordem que vendas e compras já tinham não muda).
    const ultimoDeVendasECompras = Math.max(...oferecidos.map((v, i) => (v.startsWith("vendas.") || v.startsWith("compras.") ? i : -1)));
    expect(oferecidos.findIndex((v) => v.startsWith("estoque.")), "o primeiro movimento de estoque vem depois do último de vendas e de compras")
      .toBeGreaterThan(ultimoDeVendasECompras);
    await movimento.selectOption(consumo.familia);
    await page.getByTestId("layout-novo-nome").fill(nome);
    await page.getByTestId("layout-novo-avancar").click();
    await expect(page.getByTestId("layout-novo-passo-2")).toBeVisible();
    await page.getByTestId("layout-novo-origem").selectOption("sistema");
    await page.getByTestId("layout-novo-avancar").click();
    await expect(page.getByTestId("layout-novo-passo-3")).toBeVisible();

    // (2) ONDE USAR: a TOP do consumo, movida para as ligadas → Criar.
    const disponivel = page.getByTestId("layout-novo-tops-disponiveis").getByTestId(`layout-novo-top-${top}`);
    await expect(disponivel, "a TOP do consumo está entre as disponíveis do movimento").toBeVisible();
    await disponivel.getByRole("button").click();
    await page.getByTestId("layout-novo-tops-mover").click();
    await expect(page.getByTestId("layout-novo-tops-ligadas").getByTestId(`layout-novo-top-${top}`)).toBeVisible();
    const criado = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === BASE_LAYOUTS);
    await page.getByTestId("layout-novo-criar").click();
    const resposta = await criado;
    expect(resposta.status(), "o assistente criou o layout").toBe(201);
    const id = ((await resposta.json()) as { id: string }).id;
    layouts.push(id);
    await expect(page.getByTestId("layout-novo")).toHaveCount(0);
    const gravado = await api<{ familia: string; tops: { id: string }[] }>(page, "GET", `${BASE_LAYOUTS}/${id}`);
    expect([gravado.familia, gravado.tops.map((t) => t.id)], "o servidor gravou o layout do consumo, ligado à TOP").toEqual([consumo.familia, [top]]);

    // (3) A ÁREA DO LAYOUT: a prévia com o Local de estoque do catálogo do estoque, e "Abrir na Central" para a Central de Estoque.
    await expect(page.getByTestId(`layout-linha-${id}`)).toHaveAttribute("data-selecionado", "true");
    await expect(page.getByTestId("config-campo-armazem_id"), "a prévia é a do catálogo do estoque").toContainText("Local de estoque");
    await expect(page.getByTestId("config-zona-principal").locator(":scope > *").first().getByTestId("config-operacao-fixa"),
      "a Operação abre os Dados principais da prévia, como na Central de Estoque").toBeVisible();
    await expect(page.getByTestId("config-status")).toHaveAttribute("data-estado", "tops");
    const abrir = page.locator(`[data-testid="config-abrir-central"][data-top-id="${top}"]`);
    await expect(abrir).toHaveAttribute("href", `/estoque/movimentacoes/${consumo.segmento}/new?tipo_operacao_id=${top}`);

    // (4) A CENTRAL DE ESTOQUE do consumo abre com o layout ligado — e o servidor diz o mesmo.
    await abrir.click();
    await expect(page).toHaveURL(new RegExp(`/estoque/movimentacoes/${consumo.segmento}/new\\?tipo_operacao_id=${top}$`));
    const central = page.getByTestId("estoque-central");
    await expect(central).toHaveAttribute("data-especie", "consumo");
    await expect(central).toHaveAttribute("data-modo", "criacao");
    const efetivo = page.getByTestId("estoque-central-layout-efetivo");
    await expect(efetivo, "a Central usa o layout ligado à TOP").toHaveAttribute("data-origem", "ligado");
    await expect(efetivo).toHaveAttribute("data-layout-id", id);
    const doServidor = await api<{ origem: string; id: string | null }>(page, "GET", `/api/estoque/${consumo.segmento}/layout-efetivo?tipo_operacao_id=${top}`);
    expect([doServidor.origem, doServidor.id], "o servidor responde o mesmo layout efetivo").toEqual(["ligado", id]);
  } finally {
    for (const id of layouts) {
      await api(page, "PUT", `${BASE_LAYOUTS}/${id}/tops`, { tipoOperacaoIds: [] }).catch(() => undefined);
      await api(page, "POST", `${BASE_LAYOUTS}/${id}/ativo`, { ativo: false }).catch(() => undefined);
    }
    for (const id of tops) await excluirTopE2E(page, id);
  }
});
