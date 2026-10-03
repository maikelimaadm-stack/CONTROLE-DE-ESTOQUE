import { test, expect, type Page, type Request } from "@playwright/test";
import { LAYOUT_DO_SISTEMA, entendeMovimentacaoInterna, familiaOperacionalDeDocumentoEstoque, type EstruturaLayout } from "@agro/domain";
import { api, login, uniq } from "./helpers";
import {
  cadastroDeEstoque, criarTopDeEstoque, entradaConfirmadaPelaApi, escolherNaReferencia, incluirItemNaCentralDeEstoque, type EspecieEstoqueE2E
} from "./estoque-01-comum";
import { cfg5, excluirTopE2E } from "./top-config-08-comum";

/**
 * A MOVIMENTAÇÃO INTERNA NA CENTRAL DE ESTOQUE (OPERACOES-01 F5b, decisão 282) — MI-W1 a MI-W3.
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PROVA ──────────────────────────────────────────────────────────────────────┐
 * │ A integração (F5a: `f5a-requisicao-consumo`, `f5a-destino-fluxo`; F5b: `f5b-estoque-tela`) prova no │
 * │ servidor a reserva, o atendimento, o destino e as recusas. O que ela não alcança é a TELA no motor:  │
 * │   MI-W1 a requisição → o consumo em parte (Atender requisição) → Encerrar saldo → a devolução       │
 * │         (Devolver itens), com a origem puxando os itens, o destino escolhido nas opções do servidor │
 * │         e o herdado travado no consumo;                                                            │
 * │   MI-W2 a saída com o destino OBRIGATÓRIO, o motivo e a justificativa — e o layout por TOP (a coluna │
 * │         renomeada e o Local de estoque padrão);                                                     │
 * │   MI-W3 o que a tela recusa: a prévia da requisição sem disponível e o consumo que a TOP manda vir  │
 * │         de uma requisição (zero POST).                                                             │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Toda verdade da tela tem a do SERVIDOR ao lado (o corpo do POST no fio, o documento relido, o saldo, o reservado e o
 * disponível pela API). Cada caso cria as PRÓPRIAS TOPs (formato 5, pela API), o próprio produto e a partida de saldo
 * (uma entrada confirmada pela API). No `finally`, o que ficou aberto é cancelado e as TOPs saem pela exclusão lógica
 * da própria API — nada é apagado (decisão 247).
 */

type Saldo = { quantity: string; reservado: string; disponivel: string };
type ItemLido = { id: string; produto_id: string; quantidade: string | null; quantidade_atendida: string | null; saldo_pendente: string | null; quantidade_devolvida: string | null };
type DocLido = {
  id: string; codigo: string; especie: string; situacao: string; atendimento: string | null; origem_documento_id: string | null;
  centro_custo_id: string | null; motivo_saida: string | null; justificativa: string | null; saldo_encerrado_motivo: string | null;
  itens: ItemLido[]; movimentos: { movement_type: string; quantity: string; direction: number }[];
};
type Opcao = { id: string; codigo: string | null; rotulo: string };

const saldo = (page: Page, armazem: string, produto: string) => api<Saldo>(page, "GET", `/api/stock/balances/${armazem}/${produto}`);
const ehPostDe = (segmento: string) => (r: Request) => r.method() === "POST" && new URL(r.url()).pathname === `/api/estoque/${segmento}`;
const idDaUrl = (page: Page, segmento: string) => new RegExp(`/estoque/movimentacoes/${segmento}/([0-9a-f-]{36})$`).exec(page.url())![1]!;
/** Uma aba do painel inferior da Central, pelo rótulo. */
const aba = (page: Page, nome: string) => page.getByRole("tab", { name: new RegExp(`^${nome}`) });

/** A premissa: a API deste HEAD declara a movimentação interna (as sete espécies, o destino, a origem). */
async function premissaDaMovimentacaoInterna(page: Page) {
  for (const seg of ["requisicoes", "consumos", "devolucoes-consumo", "saidas"]) {
    const r = await api<{ capacidades?: unknown }>(page, "GET", `/api/estoque/${seg}/operation-types`);
    expect(entendeMovimentacaoInterna(r.capacidades), `premissa: ${seg} declara movimentacaoInterna`).toBe(true);
  }
}

/** Um centro de resultado VÁLIDO para o destino, pela lista do próprio servidor (a mesma régua do POST). */
async function centroDoDestino(page: Page, segmento: string, empresa: string): Promise<Opcao> {
  const r = await api<{ itens: Opcao[] }>(page, "GET", `/api/estoque/${segmento}/destino/opcoes?dimensao=centroCusto&empresa_id=${empresa}`);
  expect(r.itens.length, "premissa: há centro de resultado analítico e ativo para o destino").toBeGreaterThan(0);
  return r.itens[0]!;
}

/** O cenário comum: o produto, o Local de estoque e a partida de 10 unidades a 10,00 (entrada confirmada pela API). */
async function cenario(page: Page, tops: string[]) {
  await premissaDaMovimentacaoInterna(page);
  const c = await cadastroDeEstoque(page);
  const entrada = await criarTopDeEstoque(page, "entrada");
  tops.push(entrada.id);
  await entradaConfirmadaPelaApi(page, { top: entrada.id, empresa: c.empresa, armazem: c.armazem, produto: c.produto }, "10", "10");
  const partida = await saldo(page, c.armazem, c.produto);
  expect([partida.quantity, partida.reservado, partida.disponivel], "premissa: a partida é 10, nada reservado").toEqual(["10.0000", "0.0000", "10.0000"]);
  return c;
}

/** Uma TOP da espécie no formato 5 (o neutro do domínio, mais o que o caso ajusta). */
async function topFormato5(page: Page, especie: EspecieEstoqueE2E, tops: string[], ajustar?: Parameters<typeof cfg5>[1]) {
  const { id } = await criarTopDeEstoque(page, especie, cfg5({}, ajustar));
  tops.push(id);
  return id;
}

/** Lança pela Central da espécie a partir do lançador da própria Central (a rota com a origem ou o preenchimento). */
async function escolherNoLancador(page: Page, top: string) {
  await expect(page.getByTestId("top-lancador"), "sem a TOP na URL, a Central abre no lançador").toBeVisible();
  await page.locator(`[data-testid="top-opcao"][data-top-id="${top}"]`).click();
  await page.getByTestId("top-continuar").click();
}

/** Abre a prévia, confere o corpo, e confirma; devolve o corpo da prévia que a tela recebeu. */
async function confirmarPelaPrevia(page: Page, segmento: string, id: string, conferir: (corpo: Record<string, unknown>) => Promise<void> | void) {
  const previa = page.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname === `/api/estoque/${segmento}/${id}/previa-confirmacao`);
  await page.getByTestId("estoque-confirmar").click();
  const corpo = await (await previa).json() as Record<string, unknown>;
  await expect(page.getByTestId("estoque-previa-corpo"), "a prévia está pronta").toHaveAttribute("data-situacao", "pronta");
  await conferir(corpo);
  await page.getByTestId("estoque-previa-confirmar").click();
  await expect(page.getByTestId("estoque-central"), "confirmado").toHaveAttribute("data-situacao", "confirmado");
}

/** No fim: o que ficou aberto é cancelado, e as TOPs saem pela exclusão lógica da API. */
async function limpar(page: Page, docs: { segmento: string; id: string }[], tops: string[]) {
  for (const d of docs) {
    const lido = await api<{ situacao: string }>(page, "GET", `/api/estoque/${d.segmento}/${d.id}`).catch(() => null);
    if (lido?.situacao === "aberto") await api(page, "POST", `/api/estoque/${d.segmento}/${d.id}/cancelar`, {}).catch(() => undefined);
  }
  for (const id of tops) await excluirTopE2E(page, id);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * MI-W1 — REQUISIÇÃO → CONSUMO EM PARTE → ENCERRAR SALDO → DEVOLUÇÃO
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("MI-W1 — requisição (destino das opções do servidor) → Atender requisição: consumo em parte, com o destino herdado travado → Encerrar saldo → Devolver itens", async ({ page }) => {
  await login(page);
  const tops: string[] = []; const docs: { segmento: string; id: string }[] = [];
  try {
    const c = await cenario(page, tops);
    const centro = await centroDoDestino(page, "requisicoes", c.empresa);
    const topRequisicao = await topFormato5(page, "requisicao", tops, (x) => ({ ...x, destino: { ...x.destino, centroCusto: "opcional" } }));
    const topConsumo = await topFormato5(page, "consumo", tops);
    const topDevolucao = await topFormato5(page, "devolucao_consumo", tops);
    const regras = await api<{ destino: { centroCusto: string } | null }>(page, "GET", `/api/estoque/requisicoes/regras-da-operacao?tipo_operacao_id=${topRequisicao}`);
    expect(regras.destino?.centroCusto, "premissa: a TOP da requisição usa o centro de resultado, opcional").toBe("opcional");

    // (1) MOVIMENTAÇÕES › + NOVO → a TOP de requisição → a Central da requisição, no motor.
    await page.goto("/estoque?tab=movimentacoes");
    await page.getByTestId("estoque-novo").click();
    const lancador = page.getByTestId("lancador-unificado");
    await lancador.locator(`[data-testid="lancador-top"][data-top-id="${topRequisicao}"]`).click();
    await page.getByTestId("lancador-lancar").click();
    await expect(page).toHaveURL(new RegExp(`/estoque/movimentacoes/requisicoes/new\\?tipo_operacao_id=${topRequisicao}`));
    const central = page.getByTestId("estoque-central");
    await expect(central).toHaveAttribute("data-especie", "requisicao");
    await expect(central).toHaveAttribute("data-modo", "criacao");
    await escolherNaReferencia(page, page.getByTestId("estoque-central-armazem"), c.nomeArmazem);
    const linha = await incluirItemNaCentralDeEstoque(page, { nomeProduto: c.nomeProduto, quantidade: "6" });
    // A coluna Estoque da requisição mostra o DISPONÍVEL (a régua da confirmação dela).
    await expect(linha.getByTestId("central-estoque-disponivel"), "o disponível do local, lido do servidor").toContainText("10,0000");

    // (2) A ABA DESTINO: o centro de resultado (opcional), escolhido nas opções que o servidor do estoque devolve.
    await aba(page, "Destino").click();
    const campoCentro = page.getByTestId("estoque-destino-centro-custo");
    await expect(campoCentro).toHaveAttribute("data-exigencia", "opcional");
    const opcoes = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/estoque/requisicoes/destino/opcoes");
    await escolherNaReferencia(page, campoCentro, centro.rotulo);
    expect((await opcoes).status(), "as opções vêm do servidor do estoque").toBe(200);

    // (3) SALVAR: o corpo leva o centro, a quantidade em texto, nenhum motivo; o saldo não muda.
    const post = page.waitForRequest(ehPostDe("requisicoes"));
    await page.getByTestId("estoque-salvar").click();
    const corpo = (await post).postDataJSON() as Record<string, unknown>;
    expect(corpo, "o corpo da requisição").toMatchObject({ armazem_id: c.armazem, centro_custo_id: centro.id, itens: [{ produto_id: c.produto, quantidade: "6" }] });
    expect(["motivo_saida", "justificativa", "origem_documento_id"].filter((k) => k in corpo), "sem motivo, justificativa nem origem na requisição").toEqual([]);
    await expect(page).toHaveURL(/\/estoque\/movimentacoes\/requisicoes\/[0-9a-f-]{36}$/);
    const requisicao = idDaUrl(page, "requisicoes");
    docs.push({ segmento: "requisicoes", id: requisicao });
    await expect(central).toHaveAttribute("data-situacao", "aberto");
    expect((await saldo(page, c.armazem, c.produto)).reservado, "salvar não reserva: a requisição ainda está aberta").toBe("0.0000");

    // (4) CONFIRMAR pela prévia do DISPONÍVEL: 10 → 4.
    await confirmarPelaPrevia(page, "requisicoes", requisicao, async (p) => {
      expect(p["baseDoSaldo"], "a prévia da requisição fala do disponível").toBe("disponivel");
      await expect(page.getByTestId("estoque-previa-corpo")).toHaveAttribute("data-base-do-saldo", "disponivel");
      const item = page.getByTestId("estoque-previa-item");
      await expect(item).toHaveAttribute("data-saldo-atual", "10.0000");
      await expect(item).toHaveAttribute("data-saldo-depois", "4.0000");
      await expect(item).toContainText("Nenhum: a requisição reserva no local de estoque");
    });
    await expect(page.getByTestId("estoque-central-atendimento")).toHaveAttribute("data-atendimento", "pendente");
    const reservada = await saldo(page, c.armazem, c.produto);
    expect([reservada.quantity, reservada.reservado, reservada.disponivel], "confirmada, a requisição reserva 6; o físico não muda").toEqual(["10.0000", "6.0000", "4.0000"]);
    const lidaRequisicao = await api<DocLido>(page, "GET", `/api/estoque/requisicoes/${requisicao}`);
    expect(lidaRequisicao.centro_custo_id, "o servidor gravou o destino escolhido").toBe(centro.id);

    // (5) ATENDER REQUISIÇÃO → o lançador do consumo (a origem viaja na URL) → a Central do consumo com a origem.
    await page.getByTestId("estoque-atender").click();
    await expect(page).toHaveURL(new RegExp(`/estoque/movimentacoes/consumos/new\\?origem=${requisicao}`));
    await escolherNoLancador(page, topConsumo);
    await expect(page).toHaveURL(new RegExp(`/estoque/movimentacoes/consumos/new\\?tipo_operacao_id=${topConsumo}&origem=${requisicao}`));
    await expect(central).toHaveAttribute("data-especie", "consumo");
    await expect(page.getByTestId("estoque-central-origem"), "a requisição de origem").toHaveAttribute("data-origem-id", requisicao);
    const linhas = page.getByTestId("central-estoque-linha");
    await expect(linhas, "uma linha por item com saldo da requisição").toHaveCount(1);
    await expect(linhas.first().getByTestId("central-estoque-produto"), "o produto vem da requisição, travado").toHaveAttribute("data-travado", "");
    await expect(linhas.first().getByTestId("central-estoque-saldo-da-origem"), "a coluna Saldo: o pendente da requisição").toHaveText("6,0000");
    await expect(page.getByTestId("central-estoque-adicionar-item"), "o consumo da requisição só leva itens dela").toHaveCount(0);
    await aba(page, "Destino").click();
    const herdado = page.getByTestId("estoque-destino-centro-custo");
    await expect(herdado, "o destino herdado da requisição, travado").toHaveAttribute("data-exigencia", "herdada");
    await expect(herdado).toContainText(centro.rotulo);
    // Em parte: 4 dos 6.
    await linhas.first().getByTestId("central-estoque-selecionar-item").click();
    await linhas.first().getByLabel("Quantidade do item 1").fill("4");
    const postConsumo = page.waitForRequest(ehPostDe("consumos"));
    await page.getByTestId("estoque-salvar").click();
    const corpoConsumo = (await postConsumo).postDataJSON() as { centro_custo_id?: string; origem_documento_id?: string; itens: { origem_item_id?: string; quantidade?: string }[] };
    const itemDaRequisicao = lidaRequisicao.itens[0]!.id;
    expect(corpoConsumo.origem_documento_id, "o consumo aponta a requisição").toBe(requisicao);
    expect(corpoConsumo.itens, "o item aponta o item da requisição, com a parte").toEqual([{ produto_id: c.produto, quantidade: "4", origem_item_id: itemDaRequisicao }]);
    expect("centro_custo_id" in corpoConsumo, "o destino herdado NÃO viaja (o servidor herda)").toBe(false);
    await expect(page).toHaveURL(/\/estoque\/movimentacoes\/consumos\/[0-9a-f-]{36}$/);
    const consumo = idDaUrl(page, "consumos");
    docs.push({ segmento: "consumos", id: consumo });
    await confirmarPelaPrevia(page, "consumos", consumo, async () => {
      await expect(page.getByTestId("estoque-previa-corpo")).toHaveAttribute("data-base-do-saldo", "fisico");
      await expect(page.getByTestId("estoque-previa-item")).toHaveAttribute("data-saldo-depois", "6.0000");
      await expect(page.getByTestId("estoque-previa-item")).toContainText("Consumo (saída do local de estoque)");
    });
    expect((await saldo(page, c.armazem, c.produto)).quantity, "o consumo baixou 4").toBe("6.0000");
    const parcial = await api<DocLido>(page, "GET", `/api/estoque/requisicoes/${requisicao}`);
    expect([parcial.atendimento, parcial.itens[0]!.quantidade_atendida, parcial.itens[0]!.saldo_pendente], "a requisição, atendida em parte").toEqual(["parcial", "4.0000", "2.0000"]);
    // O consumo que atende uma requisição não se duplica (a dica diz por quê).
    const duplicarConsumo = page.getByTestId("central-estoque-duplicar");
    await expect(duplicarConsumo).toBeDisabled();
    await expect(duplicarConsumo).toHaveAttribute("data-dica", "Documento que atende ou devolve outro não se duplica: lance de novo a partir da origem.");

    // (6) ENCERRAR SALDO na requisição (atendida em parte), com o motivo obrigatório.
    await page.goto(`/estoque/movimentacoes/requisicoes/${requisicao}`);
    await expect(page.getByTestId("estoque-central-atendimento")).toHaveAttribute("data-atendimento", "parcial");
    await expect(page.getByTestId("central-estoque-duplicar"), "a requisição (sem origem) se duplica").toBeEnabled();
    await page.getByTestId("central-estoque-acoes-rapidas").click();
    await expect(page.getByTestId("central-estoque-imprimir"), "o leque tem Imprimir").toBeVisible();
    await expect(page.getByTestId("central-estoque-historico"), "e Histórico").toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("estoque-encerrar-saldo").click();
    const dialogo = page.getByTestId("estoque-encerrar-dialogo");
    await expect(dialogo).toBeVisible();
    await expect(page.getByTestId("estoque-encerrar-confirmar"), "sem motivo, o botão fica desabilitado").toBeDisabled();
    const motivo = uniq("MI-W1 o restante não será usado");
    await page.getByTestId("estoque-encerrar-motivo").fill(motivo);
    const encerrou = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/estoque/requisicoes/${requisicao}/encerrar-saldo`);
    await page.getByTestId("estoque-encerrar-confirmar").click();
    expect((await encerrou).status(), "o servidor encerrou o saldo").toBe(200);
    await expect(page.getByTestId("estoque-central-atendimento")).toHaveAttribute("data-atendimento", "encerrado");
    await aba(page, "Atendimento").click();
    await expect(page.getByTestId("estoque-central-saldo-encerrado")).toContainText(motivo);
    const encerrada = await saldo(page, c.armazem, c.produto);
    expect([encerrada.quantity, encerrada.reservado], "encerrado, nada mais fica reservado").toEqual(["6.0000", "0.0000"]);

    // (7) NO CONSUMO: a aba Atendimento aponta a requisição; DEVOLVER ITENS → a Central da devolução com a linha do consumo.
    await page.goto(`/estoque/movimentacoes/consumos/${consumo}`);
    await aba(page, "Atendimento").click();
    await expect(page.getByTestId("estoque-central-vinculados-origem"), "o consumo atende a requisição").toHaveText(lidaRequisicao.codigo);
    await page.getByTestId("estoque-devolver").click();
    await expect(page).toHaveURL(new RegExp(`/estoque/movimentacoes/devolucoes-consumo/new\\?origem=${consumo}`));
    await escolherNoLancador(page, topDevolucao);
    await expect(central).toHaveAttribute("data-especie", "devolucao_consumo");
    await expect(page.getByTestId("estoque-central-origem")).toHaveAttribute("data-origem-id", consumo);
    await expect(linhas).toHaveCount(1);
    await expect(linhas.first().getByTestId("central-estoque-saldo-da-origem"), "o que o consumo baixou e ainda não voltou").toHaveText("4,0000");
    await linhas.first().getByTestId("central-estoque-selecionar-item").click();
    await linhas.first().getByLabel("Quantidade do item 1").fill("1");
    const lidoConsumo = await api<DocLido>(page, "GET", `/api/estoque/consumos/${consumo}`);
    const postDevolucao = page.waitForRequest(ehPostDe("devolucoes-consumo"));
    await page.getByTestId("estoque-salvar").click();
    const corpoDevolucao = (await postDevolucao).postDataJSON() as { origem_documento_id?: string; itens: unknown[] };
    expect(corpoDevolucao.origem_documento_id).toBe(consumo);
    expect(corpoDevolucao.itens, "a linha aponta o item do consumo").toEqual([{ produto_id: c.produto, quantidade: "1", origem_item_id: lidoConsumo.itens[0]!.id }]);
    await expect(page).toHaveURL(/\/estoque\/movimentacoes\/devolucoes-consumo\/[0-9a-f-]{36}$/);
    const devolucao = idDaUrl(page, "devolucoes-consumo");
    docs.push({ segmento: "devolucoes-consumo", id: devolucao });
    await confirmarPelaPrevia(page, "devolucoes-consumo", devolucao, async () => {
      await expect(page.getByTestId("estoque-previa-item")).toContainText("Devolução");
    });

    // (8) O SERVIDOR: a devolução voltou 1 (movimento `devolution`), o consumo registra o devolvido, e o destino foi COPIADO.
    expect((await saldo(page, c.armazem, c.produto)).quantity, "a devolução voltou 1 ao local de estoque").toBe("7.0000");
    const lidaDevolucao = await api<DocLido>(page, "GET", `/api/estoque/devolucoes-consumo/${devolucao}`);
    expect(lidaDevolucao.movimentos.map((m) => [m.movement_type, m.direction, m.quantity]), "o movimento da devolução de consumo").toEqual([["devolution", 1, "1.0000"]]);
    expect(lidaDevolucao.centro_custo_id, "o destino do consumo, copiado na devolução").toBe(centro.id);
    expect((await api<DocLido>(page, "GET", `/api/estoque/consumos/${consumo}`)).itens[0]!.quantidade_devolvida, "o consumo sabe o que voltou").toBe("1.0000");
  } finally {
    await limpar(page, docs, tops);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * MI-W2 — SAÍDA: DESTINO OBRIGATÓRIO, MOTIVO E JUSTIFICATIVA; O LAYOUT POR TOP
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("MI-W2 — saída com o destino obrigatório pela TOP e o layout ligado (coluna renomeada, Local de estoque padrão): faltando centro, motivo e justificativa, ZERO POST; preenchidos, o servidor grava os três", async ({ page }) => {
  await login(page);
  const tops: string[] = []; const docs: { segmento: string; id: string }[] = [];
  try {
    const c = await cenario(page, tops);
    const centro = await centroDoDestino(page, "saidas", c.empresa);
    const top = await topFormato5(page, "saida", tops, (x) => ({ ...x, destino: { ...x.destino, centroCusto: "obrigatoria" } }));

    // O LAYOUT DA SAÍDA, pela API administrativa: a cópia do sistema, com a coluna "Quantidade" renomeada e o Local de
    // estoque padrão (registro) — ligado à TOP do caso.
    const familia = familiaOperacionalDeDocumentoEstoque("saida")!;
    const estrutura: EstruturaLayout = structuredClone(LAYOUT_DO_SISTEMA(familia));
    expect(estrutura.itens.some((x) => x.campo === "quantidade"), "premissa: a quantidade está nos itens do layout do sistema da saída").toBe(true);
    estrutura.itens = estrutura.itens.map((x) => (x.campo === "quantidade" ? { ...x, rotulo: "Qtd. a baixar" } : x));
    estrutura.cabecalho = estrutura.cabecalho.map((x) => (x.campo === "armazem_id" ? { ...x, valorPadrao: { tipo: "registro" as const, id: c.armazem } } : x));
    const layout = (await api<{ id: string }>(page, "POST", "/api/admin/layouts-documento", { familia, nome: uniq("Layout MI-W2"), estrutura })).id;
    await api(page, "PUT", `/api/admin/layouts-documento/${layout}/tops`, { tipoOperacaoIds: [top] });
    const efetivo = await api<{ origem: string; id: string; padroesDeCadastro?: Record<string, { id: string; empresaId?: string }> }>(page, "GET", `/api/estoque/saidas/layout-efetivo?tipo_operacao_id=${top}`);
    expect(efetivo, "premissa: o layout está ligado e o Local de estoque padrão vale para a empresa").toMatchObject({ origem: "ligado", id: layout, padroesDeCadastro: { armazem_id: { id: c.armazem, empresaId: c.empresa } } });

    // (1) A CENTRAL DA SAÍDA abre com o layout: a linha do layout, o Local de estoque já preenchido, a coluna renomeada.
    await page.goto(`/estoque/movimentacoes/saidas/new?tipo_operacao_id=${top}`);
    const central = page.getByTestId("estoque-central");
    await expect(central).toHaveAttribute("data-especie", "saida");
    await expect(page.getByTestId("estoque-central-layout-efetivo")).toHaveAttribute("data-origem", "ligado");
    await expect(page.getByTestId("estoque-central-layout-efetivo")).toHaveAttribute("data-layout-id", layout);
    await expect(page.getByTestId("estoque-central-armazem"), "o Local de estoque padrão do layout").toContainText(c.nomeArmazem);
    await incluirItemNaCentralDeEstoque(page, { nomeProduto: c.nomeProduto, quantidade: "2" });
    const cabecalhos = (await page.getByTestId("central-estoque-grade").locator("thead th").allTextContents()).map((x) => x.trim());
    expect(cabecalhos, "a coluna com o rótulo do layout").toContain("Qtd. a baixar");
    expect(cabecalhos, "e não o de sempre").not.toContain("Quantidade");

    // (2) SALVAR SEM O DESTINO, O MOTIVO E A JUSTIFICATIVA: ZERO POST, e a pílula lista os três.
    const posts: string[] = [];
    const registrar = (r: Request) => { if (ehPostDe("saidas")(r)) posts.push(r.url()); };
    page.on("request", registrar);
    await page.getByTestId("estoque-salvar").click();
    const lista = page.getByTestId("central-estoque-pendencias-lista");
    await expect(lista, "a pílula abre a lista das pendências").toBeVisible();
    for (const [caminho, rotulo] of [["centro_custo_id", "Centro de resultado"], ["motivo_saida", "Motivo"], ["justificativa", "Justificativa"]] as const) {
      await expect(lista.locator(`[data-testid="central-estoque-pendencia"][data-caminho="${caminho}"]`), `a pendência de ${rotulo}`).toContainText(rotulo);
    }
    await expect(lista.locator('[data-caminho="centro_custo_id"]')).toContainText("Esta operação exige centro de resultado.");
    expect(posts, "nenhum POST saiu").toEqual([]);
    page.off("request", registrar);
    await page.keyboard.press("Escape");

    // (3) PREENCHE os três — o centro nas opções do servidor, o motivo e a justificativa — e Salva.
    await aba(page, "Destino").click();
    await expect(page.getByTestId("estoque-destino-centro-custo")).toHaveAttribute("data-exigencia", "obrigatoria");
    await escolherNaReferencia(page, page.getByTestId("estoque-destino-centro-custo"), centro.rotulo);
    await aba(page, "Motivo da saída").click();
    await page.getByTestId("estoque-central-motivo-saida-campo").selectOption("loss");
    const justificativa = uniq("MI-W2 avaria no transporte");
    await page.getByTestId("estoque-central-justificativa").fill(justificativa);
    const post = page.waitForRequest(ehPostDe("saidas"));
    const resposta = page.waitForResponse((r) => ehPostDe("saidas")(r.request()));
    await page.getByTestId("estoque-salvar").click();
    const corpo = (await post).postDataJSON() as Record<string, unknown>;
    expect(corpo, "o corpo leva o destino, o motivo e a justificativa").toMatchObject({ centro_custo_id: centro.id, motivo_saida: "loss", justificativa, armazem_id: c.armazem });
    expect((await resposta).status(), "o servidor gravou").toBe(201);
    await expect(page).toHaveURL(/\/estoque\/movimentacoes\/saidas\/[0-9a-f-]{36}$/);
    const saida = idDaUrl(page, "saidas");
    docs.push({ segmento: "saidas", id: saida });
    const lida = await api<DocLido>(page, "GET", `/api/estoque/saidas/${saida}`);
    expect([lida.centro_custo_id, lida.motivo_saida, lida.justificativa], "o servidor gravou os três").toEqual([centro.id, "loss", justificativa]);
    await aba(page, "Motivo da saída").click();
    await expect(page.getByTestId("estoque-central-motivo-saida")).toContainText("Perda");
    // A consulta da saída COM destino tem a aba Destino, com o centro gravado (sem destino, a saída não a tem: M-1 da
    // revisão da F5b, provado no skew sentido 1).
    await aba(page, "Destino").click();
    await expect(page.getByTestId("estoque-central-destino").getByTestId("estoque-destino-centro-custo"), "o centro gravado, na consulta")
      .toHaveAttribute("data-valor-id", centro.id);
  } finally {
    await limpar(page, docs, tops);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * MI-W3 — O QUE A TELA RECUSA
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("MI-W3 — a prévia da requisição sem disponível bloqueia o Confirmar; o consumo que a TOP manda vir de uma requisição, lançado direto, não envia nada", async ({ page }) => {
  await login(page);
  const tops: string[] = []; const docs: { segmento: string; id: string }[] = [];
  try {
    const c = await cenario(page, tops);
    const topRequisicao = await topFormato5(page, "requisicao", tops);
    const topConsumo = await topFormato5(page, "consumo", tops, (x) => ({ ...x, fluxo: { exigeRequisicao: "todos", permiteParcial: true } }));

    // (1) A REQUISIÇÃO DE 20 COM 10 DISPONÍVEIS: salva aberta; a prévia marca o item e bloqueia o Confirmar.
    expect((await saldo(page, c.armazem, c.produto)).disponivel, "premissa: o disponível lido no servidor é 10").toBe("10.0000");
    await page.goto(`/estoque/movimentacoes/requisicoes/new?tipo_operacao_id=${topRequisicao}`);
    await escolherNaReferencia(page, page.getByTestId("estoque-central-armazem"), c.nomeArmazem);
    await incluirItemNaCentralDeEstoque(page, { nomeProduto: c.nomeProduto, quantidade: "20" });
    await page.getByTestId("estoque-salvar").click();
    await expect(page).toHaveURL(/\/estoque\/movimentacoes\/requisicoes\/[0-9a-f-]{36}$/);
    const requisicao = idDaUrl(page, "requisicoes");
    docs.push({ segmento: "requisicoes", id: requisicao });
    await expect(page.getByTestId("estoque-central")).toHaveAttribute("data-situacao", "aberto");
    const previa = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/estoque/requisicoes/${requisicao}/previa-confirmacao`);
    await page.getByTestId("estoque-confirmar").click();
    const corpo = await (await previa).json() as { podeConfirmar: boolean; itens: { insuficiente: boolean }[] };
    expect([corpo.podeConfirmar, corpo.itens.map((i) => i.insuficiente)], "o servidor prevê a falta de disponível").toEqual([false, [true]]);
    await expect(page.getByTestId("estoque-previa-item")).toHaveAttribute("data-insuficiente", "true");
    await expect(page.getByTestId("estoque-previa-bloqueio")).toHaveText("Há item sem disponível suficiente no local de estoque. Ajuste a requisição ou o saldo antes de confirmar.");
    await expect(page.getByTestId("estoque-previa-confirmar"), "o Confirmar fica desabilitado").toBeDisabled();
    await page.getByTestId("estoque-previa").getByRole("button", { name: "Voltar", exact: true }).click();

    // (2) O CONSUMO DIRETO DE UMA TOP QUE EXIGE REQUISIÇÃO EM TODOS OS ITENS: zero POST, e a pendência da origem.
    const regras = await api<{ fluxo: { exigeRequisicao: string } | null }>(page, "GET", `/api/estoque/consumos/regras-da-operacao?tipo_operacao_id=${topConsumo}`);
    expect(regras.fluxo?.exigeRequisicao, "premissa: a TOP do consumo exige requisição em todos os itens").toBe("todos");
    await page.goto(`/estoque/movimentacoes/consumos/new?tipo_operacao_id=${topConsumo}`);
    await expect(page.getByTestId("estoque-central")).toHaveAttribute("data-especie", "consumo");
    await escolherNaReferencia(page, page.getByTestId("estoque-central-armazem"), c.nomeArmazem);
    await incluirItemNaCentralDeEstoque(page, { nomeProduto: c.nomeProduto, quantidade: "1" });
    const posts: string[] = [];
    const registrar = (r: Request) => { if (ehPostDe("consumos")(r)) posts.push(r.url()); };
    page.on("request", registrar);
    await page.getByTestId("estoque-salvar").click();
    const pendencia = page.getByTestId("central-estoque-pendencias-lista").locator('[data-caminho="origem_documento_id"]');
    await expect(pendencia).toContainText("Esta operação exige requisição: informe a requisição de origem.");
    expect(posts, "nenhum POST saiu").toEqual([]);
    page.off("request", registrar);
  } finally {
    await limpar(page, docs, tops);
  }
});
