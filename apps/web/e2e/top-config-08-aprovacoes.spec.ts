import { test, expect, type Page, type Response } from "@playwright/test";
import { MENSAGEM_APROVACAO_PENDENTE, mensagemAprovacaoReprovada } from "@agro/domain";
import { login, logout, api, uniq, empresaAtiva, primeiroId } from "./helpers";
import { cadastroDeEstoque, hojeISO } from "./estoque-01-comum";
import { cfg4, chamarApi, criarTopViaApi, detalheTopNoServidor, excluirTopE2E } from "./top-config-08-comum";

/**
 * TOP-CONFIG-08 (W-3) — A TELA DE APROVAÇÕES, PELO CAMINHO DO OPERADOR (API e banco REAIS; nada mockado).
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PROVA ──────────────────────────────────────────────────────────────────┐
 * │ A integração (AP-1..AP-12) prova no servidor a exigência, a ordem das recusas, a fila e a guarda │
 * │ do banco. Aqui se mede o elo da TELA, sobre documentos lançados pela API com uma TOP no FORMATO 4: │
 * │ (a) a venda pendente aparece na aba Vendas como "Aguardando aprovação";                          │
 * │ (b) "Abrir" leva à consulta do documento (as rotas de detalhe de hoje);                           │
 * │ (c) "Aprovar" pergunta "Aprovar o documento <código>?", com observação; a linha SAI e a mensagem  │
 * │     é "Aprovado." — ou "Aprovado e confirmado." quando a TOP confirma sozinha;                    │
 * │ (d) "Reprovar" exige o motivo; a linha FICA, como "Reprovado";                                    │
 * │ (e) a fila é a do escopo de quem aprova: vazia, ela diz "Nenhum documento aguardando aprovação."; │
 * │ (f) a aba Estoque mostra o documento de estoque pendente, abre a Central de Estoque e aprova.     │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ A REGRA ANTI-VACUIDADE ───────────────────────────────────────────────────────────────────────┐
 * │ Toda frase conferida na tela é conferida também contra o CORPO que o servidor devolveu à própria  │
 * │ tela (capturado no fio) ou contra o estado lido pela API. Toda ausência (a linha que saiu, a fila │
 * │ vazia) vem depois da PRESENÇA do mesmo alvo: a linha estava lá antes do clique; a venda pendente   │
 * │ existe e aparece para quem aprova na empresa dela. E a decisão vale de verdade: a confirmação, que │
 * │ recusava antes (APROVACAO_PENDENTE), passa depois de aprovar — e recusa com o motivo depois de     │
 * │ reprovar.                                                                                         │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Fixtures pela API oficial, cada caso com as PRÓPRIAS TOPs e documentos (a conta nunca depende do que outro spec
 * deixou no banco); as peças da TOP no formato 4 são as comuns da fatia (`top-config-08-comum.ts`). Nada é apagado
 * (decisão 247): no `finally`, o que ficou aberto é cancelado e as TOPs saem pela exclusão lógica da própria API, para
 * a fila e o lançador das próximas execuções no mesmo banco não herdarem pendências nem operações deste arquivo.
 */

type Regras = { confirmacao: "manual" | "automatica"; aprovacao: "nenhuma" | "sempre" };
type Venda = { id: string; code: string; status: string; version: string; titles: { id: string }[] };
type LinhaDaFila = { id: string; codigo: string; especie: string; situacao: string; version?: string; ultimaDecisao: { decisao: string; observacao: string | null } | null };
type Fila = { items: LinhaDaFila[]; total: number };
type ResultadoAutomatica = { confirmado: boolean; motivo?: string };
type Decisao = { aprovacao: { decisao: string; decididoEm: string }; confirmacaoAutomatica?: ResultadoAutomatica };
/** O corpo de uma recusa, como `chamarApi` o devolve. */
type CorpoDeErro = { error?: { code?: string; message?: string } };

const FILA_VENDAS = "/api/aprovacoes/vendas";
const FILA_ESTOQUE = "/api/aprovacoes/estoque";

/**
 * Uma TOP própria por caso, no FORMATO 4 (`cfg4`: o neutro do domínio com só as duas regras medidas fora dele; a
 * matriz aceita as duas na venda e no estoque), e a premissa lida no servidor: gravou no formato 4, com as regras.
 */
async function criarTopFormato4(page: Page, codigoBase: string, r: Regras, tops: string[]): Promise<string> {
  const { id } = await criarTopViaApi(page, codigoBase, cfg4(r), { rotulo: `W-3 ${codigoBase}` });
  tops.push(id);
  const lida = await detalheTopNoServidor(page, id);
  expect([lida.configuracaoSchema, lida.configuracao.versaoSchema], "premissa: a versão da TOP gravou no FORMATO 4 (só ele executa a aprovação)").toEqual([4, 4]);
  expect([lida.configuracao.valor?.geral.confirmacao, lida.configuracao.valor?.aprovacao.politica], "premissa: as regras gravadas").toEqual([r.confirmacao, r.aprovacao]);
  return id;
}

/** Cliente e produto do seed; a venda vai SEM armazém (nada de saldo em jogo) e com valor positivo (o título nasce). */
async function insumosDaVenda(page: Page) {
  return {
    empresa: await empresaAtiva(page),
    cliente: await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1"),
    produto: await primeiroId(page, "/api/resources/products?pageSize=1")
  };
}

/** Uma venda pela API com a TOP, na data de hoje (a fila ordena pela data do documento, a mais nova primeiro). */
async function lancarVenda(page: Page, top: string, i: Awaited<ReturnType<typeof insumosDaVenda>>, vendas: string[]) {
  const criada = await api<{ id: string; confirmacaoAutomatica?: ResultadoAutomatica }>(page, "POST", "/api/sales/sales", {
    document_date: hojeISO(), empresa_id: i.empresa, client_id: i.cliente, tipo_operacao_id: top,
    items: [{ product_id: i.produto, warehouse_id: null, quantity: "1", unit_price: "25.00" }]
  });
  vendas.push(criada.id);
  return criada;
}

const lerVenda = (page: Page, id: string) => api<Venda>(page, "GET", `/api/sales/sales/${id}`);
const filaDeVendas = (page: Page) => api<Fila>(page, "GET", `${FILA_VENDAS}?page=1&pageSize=200`);

/** A linha da fila de UM documento (o contrato do teste: id, código, espécie e situação que o SERVIDOR devolveu). */
const linhaDaFila = (page: Page, id: string) => page.locator(`[data-testid="aprovacao-linha"][data-id="${id}"]`);
/** A linha inteira da grade (para ler o selo da situação na MESMA linha do documento). */
const linhaDaGrade = (page: Page, id: string) => page.getByRole("row").filter({ has: linhaDaFila(page, id) });
const dialogo = (page: Page) => page.getByTestId("aprovacao-dialogo");

/** A decisão DESTE documento, como o navegador a recebeu. */
const ehDecisao = (porta: string) => (r: Response) => r.request().method() === "POST" && new URL(r.url()).pathname === porta;

/** Abre uma aba do módulo e espera a FILA dela (o servidor respondeu e a lista montou — não o "carregando"). */
async function abrirAba(page: Page, aba: "vendas" | "compras" | "estoque") {
  await page.goto(`/aprovacoes?tab=${aba}`);
  await expect(page.getByTestId("aprovacoes-indisponivel"), "a API deste HEAD serve a fila").toHaveCount(0);
  await expect(page.getByTestId("aprovacoes-lista"), `a aba ${aba} montou a fila`).toHaveAttribute("data-area", aba);
}

/** Cancela o que ficou aberto e exclui (logicamente) as TOPs do caso — a fila das próximas execuções não herda nada daqui. */
async function limpar(page: Page, vendas: string[], estoque: { segmento: string; id: string }[], tops: string[]) {
  for (const id of vendas) {
    const v = await lerVenda(page, id).catch(() => null);
    if (v && ["open", "approved"].includes(v.status)) await api(page, "POST", `/api/sales/sales/${id}/cancel`, {}).catch(() => undefined);
  }
  for (const d of estoque) {
    const lido = await api<{ situacao: string }>(page, "GET", `/api/estoque/${d.segmento}/${d.id}`).catch(() => null);
    if (lido?.situacao === "aberto") await api(page, "POST", `/api/estoque/${d.segmento}/${d.id}/cancelar`, {}).catch(() => undefined);
  }
  for (const id of tops) await excluirTopE2E(page, id);
}

test("W-3a — venda pendente na aba Vendas: 'Aguardando aprovação'; Abrir leva à consulta; Aprovar tira a linha com 'Aprovado.' e libera a confirmação; Reprovar exige o motivo e a linha fica 'Reprovado'", async ({ page }) => {
  await login(page);
  const vendas: string[] = []; const tops: string[] = [];
  try {
    const insumos = await insumosDaVenda(page);
    const top = await criarTopFormato4(page, "vendas.venda", { confirmacao: "manual", aprovacao: "sempre" }, tops);
    const aAprovar = await lancarVenda(page, top, insumos, vendas);
    const aReprovar = await lancarVenda(page, top, insumos, vendas);
    expect(aAprovar.confirmacaoAutomatica, "TOP manual: a resposta do POST é a de hoje, sem a chave nova").toBeUndefined();
    const vendaA = await lerVenda(page, aAprovar.id);
    const vendaR = await lerVenda(page, aReprovar.id);
    expect([vendaA.status, vendaR.status], "premissa: as duas nascem abertas").toEqual(["open", "open"]);

    // PREMISSA NO SERVIDOR: a confirmação recusa as duas (aprovação pendente) e a fila as tem como "pendente".
    const antes = await chamarApi<CorpoDeErro>(page, "POST", `/api/sales/sales/${aAprovar.id}/confirm`, {});
    expect([antes.status, antes.corpo.error?.code, antes.corpo.error?.message], "sem aprovação, a confirmação recusa").toEqual([409, "APROVACAO_PENDENTE", MENSAGEM_APROVACAO_PENDENTE]);
    const fila = await filaDeVendas(page);
    const doServidor = (id: string) => fila.items.find((l) => l.id === id);
    expect([doServidor(aAprovar.id)?.situacao, doServidor(aReprovar.id)?.situacao], "premissa: as duas estão na fila, pendentes").toEqual(["pendente", "pendente"]);
    expect(doServidor(aAprovar.id)?.codigo, "a fila devolve o código do documento").toBe(vendaA.code);

    // (a) A TELA: quem aprova nas três áreas vê as três abas (as áreas do nav.registry); a de Vendas mostra as duas,
    // "Aguardando aprovação".
    await abrirAba(page, "vendas");
    await expect(page.getByRole("tablist", { name: "Aprovações" }).getByRole("tab"), "as três áreas, na ordem do registry").toHaveText(["Vendas", "Compras", "Estoque"]);
    for (const v of [vendaA, vendaR]) {
      await expect(linhaDaFila(page, v.id), `a venda ${v.code} aparece na fila`).toHaveAttribute("data-situacao", "pendente");
      await expect(linhaDaFila(page, v.id)).toHaveAttribute("data-codigo", v.code);
      await expect(linhaDaFila(page, v.id)).toHaveAttribute("data-especie", "venda");
      await expect(linhaDaGrade(page, v.id).locator("[data-status]"), "o selo da situação").toHaveText("Aguardando aprovação");
    }

    // (b) ABRIR leva à consulta do documento — a rota de detalhe de hoje, desenhando ESTE documento.
    await page.getByTestId(`aprovacao-abrir-${vendaA.id}`).click();
    await expect(page, "Abrir vai à consulta da venda").toHaveURL(new RegExp(`/vendas/sales/${vendaA.id}$`));
    const consulta = page.getByTestId("central-vendas");
    await expect(consulta.locator('[data-campo="Número"]'), "a consulta desenhou ESTE documento").toContainText(vendaA.code);
    await expect(page.getByTestId("central-vendas-situacao").locator("[data-status]"), "e ela continua aberta").toHaveAttribute("data-status", "open");

    // (c) APROVAR, com observação: o diálogo diz o código; a linha SAI e a mensagem é a do corpo devolvido.
    await abrirAba(page, "vendas");
    await expect(linhaDaFila(page, vendaA.id), "presença: a linha está lá antes do clique").toBeVisible();
    await page.getByTestId(`aprovacao-aprovar-${vendaA.id}`).click();
    await expect(dialogo(page).getByRole("heading", { name: `Aprovar o documento ${vendaA.code}?` })).toBeVisible();
    await expect(dialogo(page).getByText("Observação (opcional)"), "o campo é opcional e diz isso").toBeVisible();
    await expect(dialogo(page).getByTestId("aprovacao-confirmar"), "sem observação, Aprovar já está habilitado").toBeEnabled();
    const observacao = `Conferido ${uniq("W-3")}`;
    await dialogo(page).getByTestId("aprovacao-observacao").fill(observacao);
    const portaAprovar = `${FILA_VENDAS}/${vendaA.id}/aprovar`;
    const aprovou = page.waitForResponse(ehDecisao(portaAprovar));
    await dialogo(page).getByTestId("aprovacao-confirmar").click();
    const respostaAprovar = await aprovou;
    expect(respostaAprovar.status(), "o servidor gravou a aprovação").toBe(200);
    const corpoAprovar = await respostaAprovar.json() as Decisao;
    expect(corpoAprovar.aprovacao.decisao).toBe("aprovado");
    expect("confirmacaoAutomatica" in corpoAprovar, "TOP manual: aprovar não confirma — sem a chave").toBe(false);
    expect(respostaAprovar.request().postDataJSON(), "o corpo leva a versão que a fila mostrou e a observação").toEqual({ version: doServidor(aAprovar.id)?.version, observacao });
    await expect(page.getByTestId("aprovacao-mensagem"), "sem confirmação automática, a mensagem é 'Aprovado.'").toHaveText("Aprovado.");
    await expect(dialogo(page), "o diálogo fechou").toHaveCount(0);
    await expect(linhaDaFila(page, vendaA.id), "a linha aprovada SAI da fila").toHaveCount(0);
    await expect(linhaDaFila(page, vendaR.id), "e a outra continua lá — a fila foi relida, não esvaziada").toBeVisible();
    // A decisão vale de verdade: a mesma confirmação, que recusava, agora passa.
    expect((await lerVenda(page, vendaA.id)).status, "aprovar não confirma a venda de TOP manual").toBe("open");
    const confirmada = await chamarApi<CorpoDeErro>(page, "POST", `/api/sales/sales/${aAprovar.id}/confirm`, {});
    expect(confirmada.status, `aprovada, a confirmação passa: ${JSON.stringify(confirmada.corpo)}`).toBe(200);
    expect((await lerVenda(page, vendaA.id)).status).toBe("confirmed");

    // (d) REPROVAR: o motivo é obrigatório (o botão espera por ele); a linha FICA, como "Reprovado".
    await page.getByTestId(`aprovacao-reprovar-${vendaR.id}`).click();
    await expect(dialogo(page).getByRole("heading", { name: `Reprovar o documento ${vendaR.code}?` })).toBeVisible();
    await expect(dialogo(page).getByText("Motivo"), "o campo do motivo").toBeVisible();
    await expect(dialogo(page).getByTestId("aprovacao-confirmar"), "sem motivo, Reprovar fica desabilitado").toBeDisabled();
    await dialogo(page).getByTestId("aprovacao-motivo").fill("   ");
    await expect(dialogo(page).getByTestId("aprovacao-confirmar"), "só espaços não é motivo").toBeDisabled();
    const motivo = `Preço fora da tabela ${uniq("W-3")}`;
    await dialogo(page).getByTestId("aprovacao-motivo").fill(motivo);
    await expect(dialogo(page).getByTestId("aprovacao-confirmar"), "com o motivo, habilita").toBeEnabled();
    const portaReprovar = `${FILA_VENDAS}/${vendaR.id}/reprovar`;
    const reprovou = page.waitForResponse(ehDecisao(portaReprovar));
    await dialogo(page).getByTestId("aprovacao-confirmar").click();
    const respostaReprovar = await reprovou;
    expect(respostaReprovar.status(), "o servidor gravou a reprovação").toBe(200);
    expect(((await respostaReprovar.json()) as Decisao).aprovacao.decisao).toBe("reprovado");
    expect(respostaReprovar.request().postDataJSON(), "o corpo leva a versão e o motivo").toEqual({ version: doServidor(aReprovar.id)?.version, motivo });
    await expect(dialogo(page)).toHaveCount(0);
    await expect(linhaDaFila(page, vendaR.id), "a reprovada FICA na fila").toHaveAttribute("data-situacao", "reprovado");
    await expect(linhaDaGrade(page, vendaR.id).locator("[data-status]"), "com o selo 'Reprovado'").toHaveText("Reprovado");
    await expect(page.getByTestId("aprovacao-mensagem"), "reprovar não tem mensagem própria: a linha é a resposta").toHaveCount(0);
    // No servidor: a última decisão é a reprovação com o motivo, e a confirmação recusa DIZENDO o motivo.
    const depois = (await filaDeVendas(page)).items.find((l) => l.id === vendaR.id);
    expect([depois?.situacao, depois?.ultimaDecisao?.decisao, depois?.ultimaDecisao?.observacao]).toEqual(["reprovado", "reprovado", motivo]);
    const recusada = await chamarApi<CorpoDeErro>(page, "POST", `/api/sales/sales/${aReprovar.id}/confirm`, {});
    expect([recusada.status, recusada.corpo.error?.code, recusada.corpo.error?.message], "reprovada, a confirmação recusa com o motivo")
      .toEqual([409, "APROVACAO_REPROVADA", mensagemAprovacaoReprovada(motivo)]);
  } finally {
    await limpar(page, vendas, [], tops);
  }
});

test("W-3b — TOP automática com aprovação: salvar deixa a venda aberta, aguardando; Aprovar confirma no mesmo pedido — 'Aprovado e confirmado.'", async ({ page }) => {
  await login(page);
  const vendas: string[] = []; const tops: string[] = [];
  try {
    const insumos = await insumosDaVenda(page);
    const top = await criarTopFormato4(page, "vendas.venda", { confirmacao: "automatica", aprovacao: "sempre" }, tops);
    const criada = await lancarVenda(page, top, insumos, vendas);
    // A automática tentou e parou no passo da aprovação, antes de qualquer efeito: a venda ficou salva e aberta.
    expect(criada.confirmacaoAutomatica, "o POST diz por que não confirmou").toEqual({ confirmado: false, motivo: "aguardando_aprovacao" });
    const venda = await lerVenda(page, criada.id);
    expect([venda.status, venda.titles.length], "premissa: aberta, sem título").toEqual(["open", 0]);

    await abrirAba(page, "vendas");
    await expect(linhaDaFila(page, venda.id), "a venda automática que espera aprovação está na fila").toHaveAttribute("data-situacao", "pendente");
    await page.getByTestId(`aprovacao-aprovar-${venda.id}`).click();
    await expect(dialogo(page).getByRole("heading", { name: `Aprovar o documento ${venda.code}?` })).toBeVisible();
    const aprovou = page.waitForResponse(ehDecisao(`${FILA_VENDAS}/${venda.id}/aprovar`));
    await dialogo(page).getByTestId("aprovacao-confirmar").click();
    const resposta = await aprovou;
    expect(resposta.status()).toBe(200);
    const corpo = await resposta.json() as Decisao;
    // O CORPO primeiro: quem aprovou confirmou, no mesmo pedido, pela confirmação única.
    expect([corpo.aprovacao.decisao, corpo.confirmacaoAutomatica], "aprovar com TOP automática confirma").toEqual(["aprovado", { confirmado: true }]);
    expect(resposta.request().postDataJSON(), "sem observação, o corpo leva só a versão").toEqual({ version: venda.version });
    await expect(page.getByTestId("aprovacao-mensagem"), "a mensagem diz as duas coisas").toHaveText("Aprovado e confirmado.");
    await expect(linhaDaFila(page, venda.id), "a linha sai da fila").toHaveCount(0);
    const confirmada = await lerVenda(page, venda.id);
    expect(confirmada.status, "no servidor, a venda está confirmada").toBe("confirmed");
    expect(confirmada.titles.length, "e a confirmação teve os efeitos dela (o título a receber)").toBeGreaterThan(0);
    // A auditoria da confirmação é a da automática (metadata `automatica: true`), e a da aprovação está lá.
    const trilha = await api<{ items: { action: string; metadata: Record<string, unknown> | null }[] }>(page, "GET", `/api/admin/audit?entity=sales_documents&entity_id=${venda.id}`);
    expect(trilha.items.filter((x) => x.action === "approve"), "uma aprovação na trilha").toHaveLength(1);
    const confirm = trilha.items.filter((x) => x.action === "confirm");
    expect(confirm, "uma confirmação na trilha").toHaveLength(1);
    expect(confirm[0]!.metadata?.["automatica"], "a confirmação foi a automática").toBe(true);
  } finally {
    await limpar(page, vendas, [], tops);
  }
});

test("W-3c — a fila é a do escopo de quem aprova: sem pendência na empresa dele, 'Nenhum documento aguardando aprovação.' — a pendente da outra empresa não aparece", async ({ page }) => {
  await login(page);
  const vendas: string[] = []; const tops: string[] = [];
  const marca = Date.now().toString(36);
  const credencial = { email: `aprovador.vendas.${marca}@e2e.local`, password: "Demo@12345" };
  let comoAprovador = false;
  try {
    const insumos = await insumosDaVenda(page);
    const ctx = await api<{ empresas: { id: string; name: string }[] }>(page, "GET", "/api/auth/context");
    const outra = ctx.empresas.find((e) => e.id !== insumos.empresa);
    expect(outra, "premissa: a semente tem uma segunda empresa").toBeTruthy();
    const top = await criarTopFormato4(page, "vendas.venda", { confirmacao: "manual", aprovacao: "sempre" }, tops);
    const pendente = await lancarVenda(page, top, insumos, vendas);

    // PRESENÇA: a venda pendente existe e aparece para quem aprova na empresa dela (o administrador).
    await abrirAba(page, "vendas");
    await expect(linhaDaFila(page, pendente.id), "presença: o administrador vê a pendente").toHaveAttribute("data-situacao", "pendente");

    // Quem aprova vendas SÓ na outra empresa. O escopo é EXPLÍCITO: sem ele o servidor é fail-closed e a fila seria
    // vazia por falta de acesso — aqui ela é vazia porque a empresa DELE não tem pendência.
    const papel = await api<{ id: string }>(page, "POST", "/api/admin/roles", { name: `Aprovador de vendas E2E ${marca}`, permissions: ["sales.view", "sales.approve"] });
    await api(page, "POST", "/api/admin/members", {
      name: "Aprovador de Vendas E2E", email: credencial.email, password: credencial.password, role_id: papel.id,
      escopos_empresas: [{ modulo: "vendas", modo: "selecionadas", empresas: [outra!.id] }]
    });
    await expect(page.getByRole("tablist", { name: "Aprovações" }).getByRole("tab"), "presença: o administrador vê as três áreas").toHaveCount(3);
    await logout(page);
    await login(page, credencial);
    comoAprovador = true;

    // O SERVIDOR primeiro: a fila dele é vazia, de verdade (a premissa de que a outra empresa não tem pendência).
    const doAprovador = await filaDeVendas(page);
    expect([doAprovador.total, doAprovador.items.map((l) => l.id)], "premissa: nenhuma venda pendente na empresa do aprovador").toEqual([0, []]);
    await abrirAba(page, "vendas");
    await expect(page.getByTestId("aprovacoes-lista")).toHaveAttribute("data-total", "0");
    await expect(page.getByTestId("aprovacoes-vazia"), "a fila vazia diz isso").toContainText("Nenhum documento aguardando aprovação.");
    await expect(linhaDaFila(page, pendente.id), "a pendente da outra empresa não aparece").toHaveCount(0);
    // Só a área que ele aprova: com UMA área visível, o Workspace não desenha a barra de abas (Compras e Estoque, que
    // ele não aprova, não existem para ele). A presença da fila de Vendas, acima, é a premissa desta ausência.
    await expect(page.getByRole("tablist", { name: "Aprovações" }), "uma área só: sem barra de abas").toHaveCount(0);
  } finally {
    // De volta ao administrador para limpar (o aprovador não cancela venda).
    if (comoAprovador) {
      await logout(page).catch(() => page.evaluate(() => localStorage.removeItem("agro.session")));
      await login(page);
    }
    await limpar(page, vendas, [], tops);
  }
});

test("W-3d — aba Estoque: a entrada com TOP formato 4 'Sempre' aparece pendente; Abrir leva à Central de Estoque; Aprovar → 'Aprovado.' e a confirmação passa", async ({ page }) => {
  await login(page);
  const estoque: { segmento: string; id: string }[] = []; const tops: string[] = [];
  try {
    const top = await criarTopFormato4(page, "estoque.entrada", { confirmacao: "manual", aprovacao: "sempre" }, tops);
    const c = await cadastroDeEstoque(page);
    const doc = await api<{ id: string; codigo: string; situacao: string; confirmacaoAutomatica?: unknown }>(page, "POST", "/api/estoque/entradas", {
      empresa_id: c.empresa, tipo_operacao_id: top, armazem_id: c.armazem, data_documento: hojeISO(),
      itens: [{ produto_id: c.produto, quantidade: "2", custo_unitario: "3" }]
    });
    estoque.push({ segmento: "entradas", id: doc.id });
    expect([doc.situacao, "confirmacaoAutomatica" in doc], "premissa: aberta, e TOP manual não ganha a chave nova").toEqual(["aberto", false]);
    const antes = await chamarApi<CorpoDeErro>(page, "POST", `/api/estoque/entradas/${doc.id}/confirmar`, {});
    expect([antes.status, antes.corpo.error?.code], "sem aprovação, a confirmação recusa").toEqual([409, "APROVACAO_PENDENTE"]);
    const fila = await api<Fila>(page, "GET", `${FILA_ESTOQUE}?page=1&pageSize=200`);
    expect(fila.items.find((l) => l.id === doc.id)?.situacao, "premissa: a entrada está na fila do estoque").toBe("pendente");

    // A ABA ESTOQUE: a linha da entrada, pendente, com a espécie no lugar do parceiro.
    await abrirAba(page, "estoque");
    await expect(linhaDaFila(page, doc.id)).toHaveAttribute("data-situacao", "pendente");
    await expect(linhaDaFila(page, doc.id)).toHaveAttribute("data-especie", "entrada");
    await expect(linhaDaFila(page, doc.id)).toHaveAttribute("data-codigo", doc.codigo);
    await expect(linhaDaGrade(page, doc.id).locator("[data-status]")).toHaveText("Aguardando aprovação");
    await expect(linhaDaGrade(page, doc.id), "a coluna Espécie diz a espécie").toContainText("Entrada");

    // ABRIR → a Central de Estoque em consulta, com ESTE documento.
    await page.getByTestId(`aprovacao-abrir-${doc.id}`).click();
    await expect(page).toHaveURL(new RegExp(`/estoque/movimentacoes/entradas/${doc.id}$`));
    const central = page.getByTestId("estoque-central");
    await expect(central).toHaveAttribute("data-modo", "consulta");
    await expect(central).toHaveAttribute("data-situacao", "aberto");
    await expect(page.getByTestId("estoque-central-codigo")).toHaveText(doc.codigo);

    // APROVAR → "Aprovado." e a linha sai; a decisão vale: a prévia libera e a confirmação passa.
    await abrirAba(page, "estoque");
    await page.getByTestId(`aprovacao-aprovar-${doc.id}`).click();
    await expect(dialogo(page).getByRole("heading", { name: `Aprovar o documento ${doc.codigo}?` })).toBeVisible();
    const porta = `${FILA_ESTOQUE}/entradas/${doc.id}/aprovar`;
    const aprovou = page.waitForResponse(ehDecisao(porta));
    await dialogo(page).getByTestId("aprovacao-confirmar").click();
    const resposta = await aprovou;
    expect(resposta.status(), "a porta da decisão é a da espécie").toBe(200);
    const corpo = await resposta.json() as Decisao;
    expect([corpo.aprovacao.decisao, "confirmacaoAutomatica" in corpo]).toEqual(["aprovado", false]);
    expect(resposta.request().postDataJSON(), "estoque não leva versão; sem observação, corpo vazio").toEqual({});
    await expect(page.getByTestId("aprovacao-mensagem")).toHaveText("Aprovado.");
    await expect(linhaDaFila(page, doc.id), "a linha aprovada sai da fila").toHaveCount(0);
    const previa = await api<{ podeConfirmar: boolean; recusas?: unknown[] }>(page, "GET", `/api/estoque/entradas/${doc.id}/previa-confirmacao`);
    expect([previa.podeConfirmar, previa.recusas], "aprovada, a prévia libera").toEqual([true, []]);
    const confirmado = await api<{ situacao: string }>(page, "POST", `/api/estoque/entradas/${doc.id}/confirmar`, {});
    expect(confirmado.situacao, "e a confirmação passa").toBe("confirmado");
  } finally {
    await limpar(page, [], estoque, tops);
  }
});
