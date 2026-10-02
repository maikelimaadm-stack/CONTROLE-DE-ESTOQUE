import type { Locator, Page, Request, Response } from "@playwright/test";
import { todayISO } from "../src/lib/utils";
import { login, api, uniq, empresaAtiva } from "./helpers";
import { cfg5, detalheTopNoServidor } from "./top-config-08-comum";
import { test, expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed } from "./central-compras-fixtures";

/**
 * OPERACOES-01 F6b (decisão 283) — A CONSULTA DO PEDIDO DE COMPRA COM A CAPACIDADE DA F6, A DIVERGÊNCIA NA PRÉVIA DA
 * COMPRA E A CHAVE DE IDEMPOTÊNCIA DA CENTRAL DE COMPRAS (API e banco REAIS).
 *
 * ┌─ O QUE ESTE ARQUIVO PROVA ──────────────────────────────────────────────────────────────────────────┐
 * │ F6B-P1 TOP de pedido (formato 5) com aprovação "Sempre" e "Exigir pedido finalizado para receber":   │
 * │        a consulta mostra o bloco da aprovação PENDENTE e o "Receber…" DESABILITADO com a mensagem do │
 * │        servidor; "Finalizar" mostra a prévia (pendente, a recusa) e não envia nada; "Aprovar" no     │
 * │        bloco → aprovado; "Finalizar" → UM POST com corpo vazio e Idempotency-Key → "Finalizado"     │
 * │        (tom informativo), quem finalizou nos Dados adicionais, e o "Receber…" habilitado abre a     │
 * │        Central em modo receber. As pílulas novas cabem na barra em 1280×720 (sem rolagem).          │
 * │ F6B-P2 A divergência com o pedido na prévia da confirmação da compra: "Avisar" mostra a linha e     │
 * │        deixa confirmar; "Bloquear" (acima da tolerância) mostra a recusa e trava o botão — zero      │
 * │        POST de confirmar. PREMISSA: a compra SEM origem, na mesma TOP, tem a prévia de hoje.        │
 * │ F6B-P3 A queda de rede depois de o servidor gravar: o reenvio do Salvar leva a MESMA Idempotency-Key │
 * │        e recebe a resposta gravada (o mesmo id) — UMA compra no servidor. E o reenvio com OUTROS     │
 * │        dados (o motivo do Cancelar mudado depois da queda): a MESMA chave, o 409 do servidor, e o    │
 * │        aviso em português — nunca o texto técnico da chave reutilizada.                            │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * A PREMISSA de cada passo é lida no FIO (o que o servidor mandou à tela) ou no SERVIDOR (o GET do documento), nunca
 * deduzida da tela. Cada caso monta os PRÓPRIOS cadastros e TOPs pela API (`central-compras-fixtures.ts`: os cadastros
 * e as TOPs saem no fim do caso, passou ou falhou, pela exclusão lógica da própria API); natureza e centro vêm do seed,
 * pelo nome. Os documentos ficam (o ledger é imutável; decisão 247).
 */

const P = "central-compras";
const caminho = (r: Request | Response) => new URL(r.url()).pathname;
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** O aviso do reenvio com a mesma chave e outros dados (`MSG_REENVIO_COM_OUTROS_DADOS`, escrito à mão). */
const MSG_REENVIO_COM_OUTROS_DADOS = "A tentativa anterior ficou sem resposta do servidor e pode ter sido gravada. Os dados mudaram desde então, e nada foi gravado agora: confira o documento antes de tentar de novo.";

type ItemLido = { id: string; produto_id: string; quantidade: string };
type PedidoLido = {
  id: string; codigo: string; situacao: string; itens: ItemLido[];
  finalizado_em: string | null; finalizado_por_nome: string | null; aprovado_orcamento_em: string | null;
};
type Divergencia = {
  modo: string; toleranciaPrecoPercentual: string; toleranciaQuantidadePercentual: string; bloqueia: boolean;
  itens: { campo: string; itemPedidoId: string; produto: string; diferencaPercentual: string | null; acimaDaTolerancia: boolean }[];
};
type PreviaNoFio = { podeConfirmar: boolean; recusas: { code: string; message: string }[]; divergencia?: Divergencia };

/** O cadastro do caso: fornecedor, Local de estoque e dois produtos CRIADOS aqui; natureza e centro do seed, pelo nome. */
async function cenario(page: Page) {
  const ref = await referenciasDoSeed(page);
  const empresa = await empresaAtiva(page);
  const nome = async (recurso: string, id: string, coluna: string) => String((await api<Record<string, unknown>>(page, "GET", `/api/resources/${recurso}/${id}`))[coluna]);
  const fornecedor = (await criarCadastro(page, "people", { name: uniq("F6B forn"), person_type: "legal", is_provider: true })).id;
  const armazem = (await criarCadastro(page, "warehouses", {
    empresa_id: empresa, initials: `B${Date.now().toString(36).slice(-4).toUpperCase()}`, description: uniq("F6B local"), type: "inputs"
  })).id;
  const produto = async (rotulo: string) => {
    const { id } = await criarCadastro(page, "products", { description: uniq(rotulo), group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id });
    return { id, nome: await nome("products", id, "description") };
  };
  return {
    empresa, fornecedor, nomeFornecedor: await nome("people", fornecedor, "name"), armazem, nomeArmazem: await nome("warehouses", armazem, "description"),
    produtoA: await produto("F6B produto A"), produtoB: await produto("F6B produto B"), natureza: ref.natureza, centro: ref.centro
  };
}
type Cenario = Awaited<ReturnType<typeof cenario>>;

/** Uma TOP nova pela porta administrativa (a limpeza fica registrada na fixture); o formato GRAVADO é premissa. */
async function topNova(page: Page, codigoBase: "compras.compra" | "compras.pedido", rotulo: string, extra: Record<string, unknown>, formato?: number) {
  const codigo = codigoTop("f6b");
  const { id } = await criarTop(page, { codigo, codigoBase, nome: uniq(`F6B ${rotulo}`), ...extra });
  if (formato !== undefined) expect((await detalheTopNoServidor(page, id)).configuracaoSchema, `premissa: a TOP ${rotulo} foi gravada no formato ${formato}`).toBe(formato);
  return { id, codigo };
}

/** O pedido pela API (com natureza e centro, que vão para a compra) e a leitura dele no servidor. */
async function pedidoPelaApi(page: Page, c: Cenario, topPedido: string, itens: { produto: string; quantidade: string; unitario: string }[]) {
  const { id } = await api<{ id: string }>(page, "POST", "/api/compras/pedidos", {
    empresa_id: c.empresa, tipo_operacao_id: topPedido, fornecedor_id: c.fornecedor, data_documento: todayISO(),
    categoria_financeira_id: c.natureza.id, centro_custo_id: c.centro.id,
    itens: itens.map((i) => ({ produto_id: i.produto, quantidade: i.quantidade, valor_unitario: i.unitario }))
  });
  return api<PedidoLido>(page, "GET", `/api/compras/pedidos/${id}`);
}

/** Abre a consulta e confere que a tela desenhou ESTE documento. */
async function abrirConsulta(page: Page, segmento: "pedidos" | "compras", doc: { id: string; codigo: string }) {
  await page.goto(`/compras/${segmento}/${doc.id}`);
  await expect(page.getByTestId(`${P}-identidade-nome`), "premissa: a tela desenhou ESTE documento").toHaveText(doc.codigo);
}

/**
 * SEM ROLAGEM HORIZONTAL (o critério do CC-14a, `central-compras-desenho-c.spec.ts`): a página E a área de trabalho, com
 * a PREMISSA de que a Central está montada nela — a casca tem `overflow-hidden` e o conteúdo rola dentro da área.
 */
async function semRolagemHorizontal(page: Page, rotulo: string) {
  await expect(page.getByTestId("active-workspace").getByTestId(P), `premissa: ${rotulo} — a Central está montada na área de trabalho`).toBeVisible();
  const medida = await page.evaluate(() => {
    const raiz = document.documentElement;
    const area = document.querySelector<HTMLElement>('[data-testid="active-workspace"]');
    return { pagina: raiz.scrollWidth - raiz.clientWidth, area: area ? area.scrollWidth - area.clientWidth : null };
  });
  expect(medida.area, `premissa: ${rotulo} — a área de trabalho existe`).not.toBeNull();
  expect(medida.pagina, `${rotulo}: rolagem horizontal na página`).toBeLessThanOrEqual(0);
  expect(medida.area!, `${rotulo}: rolagem horizontal na área de trabalho`).toBeLessThanOrEqual(0);
}

/** Abre a aba do painel inferior pelo nome. */
async function abrirAba(page: Page, nome: string) {
  const aba = page.getByTestId(`${P}-painel`).getByRole("tab", { name: nome });
  await aba.click();
  await expect(aba).toHaveAttribute("aria-selected", "true");
}

/** Escolhe no RefSelect da Central pelo rótulo do campo (nome escapado: nomes do seed têm colchetes). */
async function escolher(page: Page, rotulo: string, nome: string) {
  const campo = page.getByTestId("compras-central").locator("label", { hasText: rotulo }).first().locator("..");
  await campo.locator("button").first().click();
  const painel = page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nome.slice(0, 20));
  await painel.getByRole("option", { name: literal(nome.slice(0, 20)) }).first().click();
}

/** Escolhe na pesquisa do motor ancorada à célula (Local de estoque ou produto) da linha — pelo NOME INTEIRO. */
async function escolherNaCelula(page: Page, celula: Locator, nome: string) {
  await celula.click();
  const pesquisa = page.getByTestId(`${P}-pesquisa`);
  await expect(pesquisa).toBeVisible();
  await pesquisa.getByPlaceholder("Pesquisar pela descrição").fill(nome);
  await pesquisa.getByRole("option", { name: literal(nome) }).first().click();
  await expect(pesquisa).toHaveCount(0);
}

/** A Central abre a prévia da confirmação da compra; devolve o corpo que o SERVIDOR mandou (esperado desde antes do clique). */
async function abrirPreviaDaCompra(page: Page, compra: { id: string; codigo: string }): Promise<PreviaNoFio> {
  await abrirConsulta(page, "compras", compra);
  const previa = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === `/api/compras/compras/${compra.id}/previa-confirmacao`);
  await page.getByTestId("compras-confirmar").click();
  const r = await previa;
  expect(r.status(), "premissa: o servidor respondeu a prévia").toBe(200);
  await expect(page.getByTestId("compras-previa"), "a prévia foi lida no contrato").toHaveAttribute("data-situacao", "pronta");
  return await r.json() as PreviaNoFio;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * F6B-P1 — FINALIZAR COM APROVAÇÃO; O RECEBER EXIGE O FINALIZADO
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("F6B-P1 — pedido com aprovação 'Sempre' e 'Exigir finalizado': Receber… desabilitado e Finalizar recusado (prévia pendente, zero POST) → Aprovar no bloco → Finalizar (UM POST, corpo vazio, Idempotency-Key) → 'Finalizado', quem finalizou, e o Receber… abre a Central em modo receber", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const topCompra = await topNova(page, "compras.compra", "compra", {});
  const topPedido = await topNova(page, "compras.pedido", "pedido aprovação", {
    configuracao: cfg5({ aprovacao: "sempre" }, (x) => ({ ...x, fluxoCompra: { ...x.fluxoCompra, exigeFinalizar: true } })),
    destinos: [{ tipoOperacaoId: topCompra.id, ordem: 0, emPartes: false }]
  }, 5);
  const pedido = await pedidoPelaApi(page, c, topPedido.id, [{ produto: c.produtoA.id, quantidade: "2", unitario: "10.00" }]);
  expect(pedido.situacao, "premissa: o pedido nasce aberto").toBe("aberto");
  const finalizacoes: Request[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && caminho(r) === `/api/compras/pedidos/${pedido.id}/finalizar`) finalizacoes.push(r); });

  // (1) A CONSULTA DO PEDIDO ABERTO, em 1280×720: o que o servidor disse no fio é o que a tela mostra.
  await page.setViewportSize({ width: 1280, height: 720 });
  const passosNoFio = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === `/api/compras/pedidos/${pedido.id}/proximos-passos`);
  const situacaoNoFio = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === `/api/aprovacoes/compras/${pedido.id}`);
  await abrirConsulta(page, "pedidos", pedido);
  const passos = await passosNoFio;
  const corpoDosPassos = await passos.json() as { exigeFinalizar?: unknown; items: { codigo: string }[] };
  expect([passos.status(), corpoDosPassos.exigeFinalizar, corpoDosPassos.items.map((x) => x.codigo)], "premissa no fio: a TOP exige o pedido finalizado, e o passo é a compra")
    .toEqual([200, true, [topCompra.codigo]]);
  const situacao = await situacaoNoFio;
  expect([situacao.status(), await situacao.json()], "premissa no fio: a aprovação do pedido está pendente").toEqual([200, { situacao: "pendente", ultimaDecisao: null }]);
  const bloco = page.getByTestId(`${P}-aprovacao`);
  await expect(bloco, "o bloco da aprovação aparece no pedido, pendente").toHaveAttribute("data-situacao", "pendente");
  await expect(page.getByTestId(`${P}-aprovacao-situacao`)).toHaveText("Aguardando aprovação");
  const receber = page.getByTestId(`${P}-receber`);
  await expect(receber, "o aberto não é recebido: a TOP exige o pedido finalizado").toBeDisabled();
  await expect(receber).toHaveAttribute("data-dica", "Este pedido precisa ser finalizado antes de ser recebido.");
  await expect(page.getByTestId(`compras-proximo-passo-${topCompra.codigo}`), "nenhum passo habilitado no aberto").toHaveCount(0);
  const finalizar = page.getByTestId("compras-finalizar");
  await expect(finalizar, "Finalizar habilitado no pedido aberto").toBeEnabled();
  await expect(page.getByTestId("compras-aprovar-para-orcamento"), "Aprovar para orçamento no pedido aberto ainda não aprovado").toBeEnabled();
  await semRolagemHorizontal(page, "pedido aberto com Receber…, Finalizar e Aprovar para orçamento (1280×720)");

  // (2) FINALIZAR COM A APROVAÇÃO PENDENTE: a prévia diz por quê, o botão trava e nada é enviado.
  await finalizar.click();
  const dialogo = page.getByTestId("confirm-dialog");
  await expect(dialogo.getByRole("heading", { name: `Finalizar pedido de compra ${pedido.codigo}?`, exact: true })).toBeVisible();
  const previa = page.getByTestId("compras-previa-finalizacao");
  await expect(previa).toHaveAttribute("data-situacao", "pronta");
  await expect(previa).toContainText("Finalizar confirma o pedido de compra: ele não volta a aberto. Não mexe em estoque, e os orçamentos abertos continuam abertos. Se esta operação provisiona contas a pagar, os títulos previstos nascem agora.");
  const linhaDaAprovacao = page.getByTestId("compras-previa-finalizacao-aprovacao");
  await expect(linhaDaAprovacao).toHaveAttribute("data-situacao", "pendente");
  await expect(linhaDaAprovacao).toHaveText("Aguardando aprovação: o pedido está na fila de Aprovações.");
  await expect(page.getByTestId("compras-previa-finalizacao-recusas").getByRole("listitem")).toHaveText(["Este pedido precisa de aprovação antes de ser finalizado."]);
  await expect(page.getByTestId("confirm-dialog-confirm"), "com a recusa prevista, Finalizar fica desabilitado").toBeDisabled();
  await dialogo.getByRole("button", { name: "Voltar", exact: true }).click();
  await expect(dialogo).toHaveCount(0);
  expect(finalizacoes, "zero POST de finalizar com a aprovação pendente").toHaveLength(0);

  // (3) APROVAR NO BLOCO (o diálogo da fila; o pedido exige pedidos_compra.approve E compras.approve).
  await page.getByTestId(`${P}-aprovar`).click();
  const decisao = page.getByTestId("aprovacao-dialogo");
  await expect(decisao.getByRole("heading", { name: `Aprovar o documento ${pedido.codigo}?`, exact: true })).toBeVisible();
  const aprovou = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/aprovacoes/compras/${pedido.id}/aprovar`);
  await decisao.getByTestId("aprovacao-confirmar").click();
  const ra = await aprovou;
  expect(ra.status(), "o servidor aprovou o pedido").toBe(200);
  expect((await ra.json() as { aprovacao: { decisao: string } }).aprovacao.decisao).toBe("aprovado");
  await expect(bloco, "o bloco passa a aprovado").toHaveAttribute("data-situacao", "aprovado");
  await expect(page.getByTestId(`${P}-aprovacao-situacao`)).toHaveText("Aprovado");

  // (4) FINALIZAR: a prévia sem recusa → UM POST, corpo vazio, com Idempotency-Key.
  await finalizar.click();
  await expect(previa).toHaveAttribute("data-situacao", "pronta");
  await expect(linhaDaAprovacao).toHaveAttribute("data-situacao", "aprovado");
  await expect(linhaDaAprovacao).toHaveText("Aprovado.");
  await expect(page.getByTestId("compras-previa-finalizacao-recusas"), "sem recusa prevista").toHaveCount(0);
  const finalizou = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/compras/pedidos/${pedido.id}/finalizar`);
  await page.getByTestId("confirm-dialog-confirm").click();
  const rf = await finalizou;
  expect(rf.status(), "o servidor finalizou").toBe(200);
  expect(rf.request().postDataJSON(), "o corpo do Finalizar: nenhuma chave").toEqual({});
  expect(finalizacoes, "UM POST de finalizar").toHaveLength(1);
  expect(finalizacoes[0]!.headers()["idempotency-key"] ?? "", "com Idempotency-Key").toMatch(UUID);
  await expect(dialogo).toHaveCount(0);

  // (5) O EFEITO: no servidor, e na tela — o selo, quem finalizou, a pílula desabilitada, o bloco fora.
  const lido = await api<PedidoLido>(page, "GET", `/api/compras/pedidos/${pedido.id}`);
  expect([lido.situacao, Boolean(lido.finalizado_em), Boolean(lido.finalizado_por_nome)], "no servidor: finalizado, com quem e quando").toEqual(["finalizado", true, true]);
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "finalizado");
  const selo = page.getByTestId(`${P}-situacao`).locator("[data-tone]");
  await expect(selo).toHaveText("Finalizado");
  await expect(selo, "finalizado = em curso: o tom informativo").toHaveAttribute("data-tone", "info");
  await page.getByTestId(`${P}-dados`).getByRole("button", { name: /^Dados adicionais/ }).click();
  const quando = await page.evaluate((v) => new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }), lido.finalizado_em!);
  await expect(page.getByTestId("compras-consulta-finalizado").locator('[data-parte="valor"]')).toHaveText(`${quando} por ${lido.finalizado_por_nome}`);
  await expect(finalizar, "finalizado: a pílula fica, desabilitada").toBeDisabled();
  await expect(finalizar).toHaveAttribute("data-dica", "Só pedido aberto é finalizado.");
  await expect(page.getByTestId("compras-aprovar-para-orcamento"), "fora do aberto não há aprovação para orçamento").toHaveCount(0);
  await expect(bloco, "pedido finalizado: não há o que aprovar, o bloco some").toHaveCount(0);

  // (6) O RECEBER do pedido finalizado: o passo habilitado abre a Central em modo receber.
  const passo = page.getByTestId(`compras-proximo-passo-${topCompra.codigo}`);
  await expect(passo, "finalizado: o Receber… habilitado, pelo passo da compra").toBeEnabled();
  await passo.click();
  await expect(page).toHaveURL(new RegExp(`/compras/compras/new\\?.*pedido=${pedido.id}`));
  await expect(page.getByTestId("compras-central")).toHaveAttribute("data-modo", "receber");
  await expect(page.getByTestId("compras-central-receber"), "o pedido finalizado é recebido").toHaveAttribute("data-situacao", "pronto");
  expect(finalizacoes, "nada mais foi finalizado").toHaveLength(1);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * F6B-P2 — A DIVERGÊNCIA COM O PEDIDO NA PRÉVIA DA CONFIRMAÇÃO DA COMPRA
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("F6B-P2 — divergência na prévia da compra: 'Avisar' mostra a linha do preço (+20,00%) e deixa confirmar; 'Bloquear' mostra a recusa e trava (zero POST); a compra sem origem tem a prévia de hoje", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const comDivergencia = (modo: "avisa" | "bloqueia", tolerancia: string) =>
    cfg5({}, (x) => ({ ...x, divergenciaPedido: { modo, toleranciaPrecoPercentual: tolerancia, toleranciaQuantidadePercentual: tolerancia } }));
  const avisa = await topNova(page, "compras.compra", "compra avisa", { configuracao: comDivergencia("avisa", "0") }, 5);
  const bloqueia = await topNova(page, "compras.compra", "compra bloqueia", { configuracao: comDivergencia("bloqueia", "5") }, 5);
  const topPedido = await topNova(page, "compras.pedido", "pedido neutro", {
    destinos: [{ tipoOperacaoId: avisa.id, ordem: 0, emPartes: true }, { tipoOperacaoId: bloqueia.id, ordem: 1, emPartes: true }]
  });
  // Um item por compra, recebido inteiro (sem divergência de quantidade): só o PREÇO difere — 12,00 contra 10,00.
  const pedido = await pedidoPelaApi(page, c, topPedido.id, [
    { produto: c.produtoA.id, quantidade: "1", unitario: "10.00" }, { produto: c.produtoB.id, quantidade: "1", unitario: "10.00" }
  ]);
  const itemA = pedido.itens.find((i) => i.produto_id === c.produtoA.id)!;
  const itemB = pedido.itens.find((i) => i.produto_id === c.produtoB.id)!;
  expect(itemA && itemB, "premissa: o pedido tem os dois itens").toBeTruthy();
  const receber = async (top: string, item: string) => {
    const { id } = await api<{ id: string }>(page, "POST", `/api/compras/pedidos/${pedido.id}/convert`, {
      tipo_operacao_id: top, data_documento: todayISO(), categoria_financeira_id: c.natureza.id, centro_custo_id: c.centro.id,
      itens: [{ item_origem_id: item, armazem_id: c.armazem, quantidade: "1", valor_unitario: "12.00" }]
    });
    const lida = await api<{ codigo: string; origem_documento_id: string | null }>(page, "GET", `/api/compras/compras/${id}`);
    expect(lida.origem_documento_id, "premissa: a compra foi recebida do pedido").toBe(pedido.id);
    return { id, codigo: lida.codigo };
  };
  const compraAvisa = await receber(avisa.id, itemA.id);
  const compraBloqueia = await receber(bloqueia.id, itemB.id);
  const confirmacoes: Request[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && /^\/api\/compras\/compras\/[^/]+\/confirm$/.test(caminho(r))) confirmacoes.push(r); });
  const secao = page.getByTestId("compras-previa-divergencia");
  const linhas = secao.getByTestId("compras-previa-divergencia-item");
  const tolerancia = (d: Divergencia) => `Tolerância: preço ${d.toleranciaPrecoPercentual.replace(".", ",")}% · quantidade ${d.toleranciaQuantidadePercentual.replace(".", ",")}%.`;

  // PREMISSA: a compra SEM origem, na MESMA TOP "Bloquear", tem a prévia de hoje — o servidor não manda a divergência.
  const { id: semOrigemId } = await api<{ id: string }>(page, "POST", "/api/compras/compras", {
    empresa_id: c.empresa, tipo_operacao_id: bloqueia.id, fornecedor_id: c.fornecedor, data_documento: todayISO(),
    categoria_financeira_id: c.natureza.id, centro_custo_id: c.centro.id,
    itens: [{ produto_id: c.produtoA.id, armazem_id: c.armazem, quantidade: "1", valor_unitario: "12.00" }]
  });
  const semOrigem = { id: semOrigemId, codigo: (await api<{ codigo: string }>(page, "GET", `/api/compras/compras/${semOrigemId}`)).codigo };
  const previaSemOrigem = await abrirPreviaDaCompra(page, semOrigem);
  expect("divergencia" in previaSemOrigem, "premissa no fio: a compra sem origem não traz a divergência").toBe(false);
  await expect(secao, "sem a divergência no fio, a seção não existe").toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);

  // (1) AVISAR: a linha do preço, acima da tolerância (0%), e o Confirmar continua habilitado.
  const previaAvisa = await abrirPreviaDaCompra(page, compraAvisa);
  const dAvisa = previaAvisa.divergencia!;
  expect([dAvisa.modo, dAvisa.bloqueia, previaAvisa.podeConfirmar, dAvisa.itens.map((i) => [i.campo, i.itemPedidoId, i.diferencaPercentual, i.acimaDaTolerancia])],
    "premissa no fio: avisa, sem bloquear, o preço +20% do item A").toEqual(["avisa", false, true, [["preco", itemA.id, "20.00", true]]]);
  await expect(secao).toHaveAttribute("data-modo", "avisa");
  await expect(secao).toHaveAttribute("data-bloqueia", "false");
  await expect(secao.getByRole("heading", { name: "Divergência com o pedido", exact: true })).toBeVisible();
  await expect(secao).toContainText("A compra difere do pedido de origem. Esta operação só avisa: a confirmação continua possível.");
  await expect(secao.getByTestId("compras-previa-divergencia-tolerancia")).toHaveText(tolerancia(dAvisa));
  await expect(secao.locator("thead th")).toHaveText(["Produto", "O que difere", "No pedido", "Na compra", "Diferença", "Acima da tolerância"]);
  await expect(linhas).toHaveCount(1);
  await expect(linhas.first()).toHaveAttribute("data-campo", "preco");
  await expect(linhas.first()).toHaveAttribute("data-acima", "true");
  await expect(linhas.first().locator("td")).toHaveText([dAvisa.itens[0]!.produto, "Preço", /R\$\s*10,00/, /R\$\s*12,00/, "+20,00%", "Sim"]);
  await expect(page.getByTestId("compras-previa-recusas"), "avisar não recusa").toHaveCount(0);
  await expect(page.getByTestId("confirm-dialog-confirm"), "avisar: a confirmação continua possível").toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);

  // (2) BLOQUEAR: acima da tolerância (5%) — a recusa do servidor, o botão travado, e nada enviado.
  const previaBloqueia = await abrirPreviaDaCompra(page, compraBloqueia);
  const dBloqueia = previaBloqueia.divergencia!;
  expect([dBloqueia.modo, dBloqueia.bloqueia, previaBloqueia.podeConfirmar, previaBloqueia.recusas.map((r) => r.code), dBloqueia.itens.map((i) => [i.campo, i.itemPedidoId, i.diferencaPercentual, i.acimaDaTolerancia])],
    "premissa no fio: bloqueia, com a recusa da divergência, o preço +20% do item B").toEqual(["bloqueia", true, false, ["DIVERGENCIA_COM_O_PEDIDO"], [["preco", itemB.id, "20.00", true]]]);
  await expect(secao).toHaveAttribute("data-modo", "bloqueia");
  await expect(secao).toHaveAttribute("data-bloqueia", "true");
  await expect(secao).toContainText("A compra difere do pedido além da tolerância desta operação: a confirmação é recusada.");
  await expect(secao.getByTestId("compras-previa-divergencia-tolerancia")).toHaveText(tolerancia(dBloqueia));
  await expect(linhas).toHaveCount(1);
  await expect(linhas.first()).toHaveAttribute("data-acima", "true");
  await expect(linhas.first().locator("td")).toHaveText([dBloqueia.itens[0]!.produto, "Preço", /R\$\s*10,00/, /R\$\s*12,00/, "+20,00%", "Sim"]);
  await expect(page.getByTestId("compras-previa-recusas").getByRole("listitem")).toHaveText(["A compra diverge do pedido além da tolerância desta operação."]);
  await expect(page.getByTestId("confirm-dialog-confirm"), "bloquear: a confirmação é recusada").toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
  expect(confirmacoes, "zero POST de confirmar (nenhuma prévia confirmou nada)").toHaveLength(0);
  for (const compra of [compraAvisa, compraBloqueia, semOrigem]) {
    expect((await api<{ situacao: string }>(page, "GET", `/api/compras/compras/${compra.id}`)).situacao, "no servidor, as três continuam abertas").toBe("aberto");
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * F6B-P3 — A CHAVE DE IDEMPOTÊNCIA NÃO TROCA NA QUEDA DE REDE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("F6B-P3 — a rede cai depois de o servidor gravar a compra: o reenvio do Salvar leva a MESMA Idempotency-Key, recebe a resposta gravada (o mesmo id) e a consulta abre; UMA compra no servidor; o reenvio do Cancelar com outro motivo é recusado com o aviso em português", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const topCompra = await topNova(page, "compras.compra", "compra rede", {});
  const observacao = uniq("F6B-P3 observação única do caso");

  // O FIO: a 1ª requisição do Salvar chega ao servidor (route.fetch — ele GRAVA) e o navegador recebe um erro de rede
  // (route.abort); a 2ª passa direto. As chaves de cada uma são lidas da requisição.
  const fio = { chaves: [] as string[], primeira: null as null | { status: number; id: string } };
  await page.route("**/api/compras/compras", async (rota) => {
    const r = rota.request();
    if (r.method() !== "POST") return rota.fallback();
    fio.chaves.push(r.headers()["idempotency-key"] ?? "");
    if (fio.chaves.length > 1) return rota.fallback();
    const resposta = await rota.fetch();
    fio.primeira = { status: resposta.status(), id: String((await resposta.json() as { id?: unknown }).id ?? "") };
    await rota.abort("failed");
  });

  // A CRIAÇÃO: fornecedor, classificação, um item e a observação única do caso.
  await page.goto(`/compras/compras/new?tipo_operacao_id=${topCompra.id}`);
  await expect(page.getByTestId("compras-central")).toHaveAttribute("data-especie", "compra");
  const salvar = page.getByTestId("compras-salvar");
  await expect(salvar, "o Salvar saiu da trava").toBeEnabled();
  await escolher(page, "Fornecedor", c.nomeFornecedor);
  await escolher(page, "Natureza de despesa", c.natureza.label);
  await escolher(page, "Centro de resultado", c.centro.label);
  await page.getByTestId(`${P}-adicionar-item`).click();
  const linha = page.getByTestId(`${P}-linha`).first();
  await escolherNaCelula(page, linha.getByTestId(`${P}-produto`), c.produtoA.nome);
  await escolherNaCelula(page, linha.getByTestId(`${P}-armazem`), c.nomeArmazem);
  await linha.getByLabel("Quantidade do item 1").fill("3");
  await linha.getByLabel("Valor unitário do item 1").fill("7");
  await expect(page.getByTestId(`${P}-subtotal`)).toContainText("21,00");
  await abrirAba(page, "Observações");
  await page.getByTestId("compras-observacao").fill(observacao);

  // (1) A 1ª TENTATIVA: o servidor gravou, mas o navegador viu a rede cair — a tela continua na criação.
  await salvar.click();
  await expect.poll(() => fio.primeira, { message: "a 1ª requisição chegou ao servidor" }).not.toBeNull();
  expect(fio.primeira!.status, "premissa: a 1ª requisição foi GRAVADA (201)").toBe(201);
  expect(fio.primeira!.id, "premissa: com o id da compra criada").toMatch(UUID);
  await expect(page.locator("[data-sonner-toast] .erp-toast-panel--error"), "a queda de rede vira um aviso de erro").toHaveCount(1);
  await expect(salvar, "o Salvar volta a valer").toBeEnabled();
  await expect(page, "nada foi aberto: a tela não soube do 201").toHaveURL(new RegExp(`/compras/compras/new\\?tipo_operacao_id=${topCompra.id}$`));

  // (2) O REENVIO: a MESMA chave, e o servidor devolve a resposta gravada — o mesmo id; a consulta abre.
  const segunda = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === "/api/compras/compras");
  await salvar.click();
  const r2 = await segunda;
  expect(r2.status(), "o reenvio é respondido com a resposta gravada").toBe(201);
  expect((await r2.json() as { id: string }).id, "o MESMO documento, nunca um segundo").toBe(fio.primeira!.id);
  expect(fio.chaves, "duas requisições do Salvar").toHaveLength(2);
  expect(fio.chaves[0], "a 1ª levou Idempotency-Key").toMatch(UUID);
  expect(fio.chaves[1], "o reenvio levou a MESMA chave").toBe(fio.chaves[0]);
  await expect(page).toHaveURL(new RegExp(`/compras/compras/${fio.primeira!.id}$`));
  await expect(page.getByTestId("compras-consulta-corpo"), "a consulta da compra abre").toHaveAttribute("data-situacao", "aberto");
  await page.unroute("**/api/compras/compras");

  // (3) NO SERVIDOR: UMA compra deste fornecedor (criado só para o caso), com a observação única.
  const lista = await api<{ items: { id: string }[]; total: number }>(page, "GET", `/api/compras/compras?fornecedor_id=${c.fornecedor}`);
  expect([lista.total, lista.items.map((i) => i.id)], "UMA compra do fornecedor do caso").toEqual([1, [fio.primeira!.id]]);
  const lida = await api<{ observacao: string | null }>(page, "GET", `/api/compras/compras/${fio.primeira!.id}`);
  expect(lida.observacao, "a compra é a deste caso").toBe(observacao);

  // (4) O REENVIO COM OUTROS DADOS: a rede cai depois de o servidor CANCELAR esta compra; o motivo muda e o reenvio leva
  //     a MESMA chave — o servidor recusa a chave com corpo diferente (409) e nada grava de novo. O aviso diz, em
  //     português, que a tentativa anterior pode ter sido gravada; o texto técnico da chave nunca chega à tela.
  const caminhoDoCancelamento = `/api/compras/compras/${fio.primeira!.id}/cancel`;
  const cancelamento = { chaves: [] as string[], corpos: [] as unknown[], primeira: null as number | null };
  await page.route(`**${caminhoDoCancelamento}`, async (rota) => {
    const r = rota.request();
    if (r.method() !== "POST") return rota.fallback();
    cancelamento.chaves.push(r.headers()["idempotency-key"] ?? "");
    cancelamento.corpos.push(r.postDataJSON());
    if (cancelamento.chaves.length > 1) return rota.fallback();
    const resposta = await rota.fetch();
    cancelamento.primeira = resposta.status();
    await rota.abort("failed");
  });
  const leque = page.getByTestId(`${P}-acoes-rapidas`);
  await leque.click();
  await expect(leque).toHaveAttribute("aria-expanded", "true");
  await page.getByTestId("compras-cancelar").click();
  const dialogo = page.getByTestId("confirm-dialog");
  const motivo = page.getByTestId(`${P}-cancelar-motivo`);
  await motivo.fill("Primeiro motivo do caso");
  await dialogo.getByRole("button", { name: "Cancelar compra" }).click();
  await expect.poll(() => cancelamento.primeira, { message: "o 1º cancelamento chegou ao servidor" }).not.toBeNull();
  expect(cancelamento.primeira, "premissa: o servidor CANCELOU a compra (200)").toBe(200);
  await expect(dialogo, "a tela não soube do 200: o diálogo continua aberto, com o motivo").toBeVisible();
  await expect(motivo).toHaveValue("Primeiro motivo do caso");
  await motivo.fill("Segundo motivo, diferente");
  const recusa = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === caminhoDoCancelamento);
  await dialogo.getByRole("button", { name: "Cancelar compra" }).click();
  const r4 = await recusa;
  expect([r4.status(), ((await r4.json()) as { error?: { code?: string } }).error?.code], "o servidor recusa a chave com corpo diferente").toEqual([409, "CONFLICT"]);
  expect(cancelamento.chaves, "duas requisições do Cancelar").toHaveLength(2);
  expect(cancelamento.chaves[1], "premissa: o reenvio levou a MESMA chave").toBe(cancelamento.chaves[0]);
  expect(cancelamento.corpos, "premissa: com o motivo mudado").toEqual([{ motivo: "Primeiro motivo do caso" }, { motivo: "Segundo motivo, diferente" }]);
  await expect(page.locator("[data-sonner-toast] .erp-toast-panel--error").filter({ hasText: MSG_REENVIO_COM_OUTROS_DADOS }), "o aviso em português").toHaveCount(1);
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Idempotency-Key" }), "nunca o texto técnico da chave").toHaveCount(0);
  await page.unroute(`**${caminhoDoCancelamento}`);
  expect((await api<{ situacao: string }>(page, "GET", `/api/compras/compras/${fio.primeira!.id}`)).situacao, "no servidor: a compra foi cancelada (pela 1ª tentativa)").toBe("cancelado");
});
