import type { Page, Request, Response } from "@playwright/test";
import { login, api, uniq, empresaAtiva } from "./helpers";
import { cabecalhosDaSessao } from "./top-config-08-comum";
import { hojeISO } from "./estoque-01-comum";
import { test, expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed } from "./central-compras-fixtures";
import { API, MSG_ROTA_NAO_ENCONTRADA, vigiar, type Mundo } from "./operacoes-01-f2-skew-comum";

/**
 * OPERACOES-01 · F6b (decisão 283) · K-1, SENTIDO 1 — O WEB DESTE HEAD CONTRA A API DA BASE (a janela "web antes da
 * API" da DEPLOYMENT, e a reversão só da API).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 1 roda em `playwright.skew.config.ts`, cujo `testMatch` é
 * `/skew-api-producao\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o `playwright.config.ts` comum
 * ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (lá a API seria a deste HEAD e o caso ficaria
 * verde por vacuidade). Arquivo próprio, e não um caso em `skew-api-producao.spec.ts`: aquele é compartilhado com as
 * fases que correm em paralelo. Sem `scripts/lib` e sem passo no CI: o arquivo entra pelo nome. A prova de que cada
 * config o enxerga do jeito certo é o `--list` de cada uma (relatório da fase), e a identidade da árvore da base é a do
 * caso IDENTIDADE de `skew-api-producao.spec.ts`.
 *
 * O MUNDO É PERGUNTADO À BASE NA HORA (`mundoDaF6NaBase`), por duas portas que nascem no MESMO binário (a F6a): a
 * declaração `capacidades.finalizacaoEOrcamento` em `GET /api/compras/pedidos/operation-types` e a porta das TOPs de
 * orçamento, `GET /api/compras/orcamentos/operation-types` (a 404 de ROTA no binário que não a tem). Uma resposta sem
 * a outra é defeito, não skew. Os dois ramos cobram prova POSITIVA; nenhum deles só passa:
 *   · MUNDO LEGADO (a base de hoje, 622f194, sem a F6): sem a capacidade, a consulta do pedido é a de HOJE — nenhuma
 *     das pílulas novas (Finalizar, Aprovar para orçamento, Novo orçamento), nem a aba "Orçamentos", nem o bloco da
 *     aprovação; as abas de hoje, exatas; o "Receber…" com o testid do passo de hoje. No FIO: o `operation-types` que a
 *     tela recebeu sem a capacidade (a premissa), e NENHUMA pergunta às rotas novas — `/previa-finalizacao`,
 *     `/api/aprovacoes/compras/<pedido>` ou caminho com `/orcamentos` —, e nenhuma resposta 404/422/5xx na consulta;
 *     no Portal de Compras, o Tipo "Orçamento de compra" não existe (a lista dele, na base, viria vazia) e nada de
 *     orçamento é perguntado;
 *   · MUNDO NOVO (a base já com a F6, depois do merge): a capacidade declarada, Finalizar e Aprovar para orçamento na
 *     barra, a situação da aprovação do pedido perguntada (e "não exigida": o bloco não aparece), e as mesmas abas —
 *     o pedido que não usa cotação não ganha a aba "Orçamentos" (escolha E9); o Portal oferece o Tipo do orçamento.
 * K1-2: a prévia da confirmação da compra da base (sem `divergencia` no corpo) é lida como "pronta", sem a seção da
 * divergência, e confirmar dá 200 — nos dois mundos (a TOP da compra não tem a seção).
 *
 * Em todos, nenhuma requisição morre no navegador (`semBloqueio`). Não há mock: o servidor é o binário da base,
 * servindo o banco migrado e semeado por este HEAD. As TOPs, os cadastros e os documentos nascem PELA API DA BASE (as
 * portas de `central-compras-fixtures`, com a exclusão lógica no fim do caso, passou ou falhou). A TOP nasce SEM
 * configuração (o neutro do binário que a grava): nenhuma forma deste HEAD vai à base. Os documentos ficam (o ledger é
 * imutável; decisão 247).
 */

const P = "central-compras";
const caminho = (r: Request | Response) => new URL(r.url()).pathname;
/** A porta da capacidade, a das TOPs de orçamento, e as abas da consulta do pedido de HOJE (CC-11), exatas. */
const PORTA_DA_CAPACIDADE = "/api/compras/pedidos/operation-types";
const PORTA_DAS_TOPS_DE_ORCAMENTO = "/api/compras/orcamentos/operation-types";
const ABAS_DO_PEDIDO_DE_HOJE = ["Totais", "Financeiro", "Frete e transporte", "Compras geradas", "Observações"];
/** As quatro capacidades de compras de hoje, na ordem de hoje (a capacidade da F6 só pode vir DEPOIS delas). */
const CAPACIDADES_DE_HOJE = ["classificacaoFinanceira", "condicaoPagamento", "layoutDocumento", "regrasDaOperacao"];

type OperationTypes = { contractVersion?: unknown; capacidades?: Record<string, unknown> };

/** O corpo de uma resposta como JSON, ou o texto cru (a asserção mostra o que veio). */
async function corpoDe(r: { text(): Promise<string> }): Promise<unknown> {
  const texto = await r.text();
  try { return JSON.parse(texto) as unknown; } catch { return texto; }
}

/**
 * A capacidade no corpo de `/operation-types`, conferida: o contrato 1, as quatro de hoje na ordem de hoje e, depois
 * delas, `finalizacaoEOrcamento` ausente (`ausente`) ou exatamente 1 (`declarada`). Outra forma reprova.
 */
function capacidadeDoCorpo(corpo: OperationTypes, contexto: string): "ausente" | "declarada" {
  expect(corpo.contractVersion, `${contexto}: o contrato que o web lê é o 1`).toBe(1);
  const chaves = Object.keys(corpo.capacidades ?? {});
  expect(chaves.slice(0, 4), `${contexto}: as quatro capacidades de hoje, na ordem de hoje`).toEqual(CAPACIDADES_DE_HOJE);
  if (!("finalizacaoEOrcamento" in (corpo.capacidades ?? {}))) return "ausente";
  expect(corpo.capacidades?.["finalizacaoEOrcamento"], `${contexto}: a capacidade da F6 declarada é a versão 1`).toBe(1);
  return "declarada";
}

/**
 * SENTIDO 1 — O MUNDO É PERGUNTADO À API DA BASE NA HORA (o contexto de requisição, fora do fio do navegador), pelas
 * duas portas que nascem juntas na F6a: a declaração da capacidade em `/api/compras/pedidos/operation-types` e a porta
 * `/api/compras/orcamentos/operation-types` (a 404 de ROTA, "Rota não encontrada", no binário que não a tem; 200 com a
 * mesma declaração no que a tem). As duas respostas têm de descrever o MESMO binário.
 */
async function mundoDaF6NaBase(page: Page, cab: Record<string, string>): Promise<Mundo> {
  const r = await page.request.get(`${API}${PORTA_DA_CAPACIDADE}`, { headers: cab });
  expect(r.status(), `premissa: a base serve ${PORTA_DA_CAPACIDADE}`).toBe(200);
  const capacidade = capacidadeDoCorpo((await r.json()) as OperationTypes, PORTA_DA_CAPACIDADE);
  const o = await page.request.get(`${API}${PORTA_DAS_TOPS_DE_ORCAMENTO}`, { headers: cab });
  const corpoDoOrcamento = await corpoDe(o);
  let porta: "ausente" | "presente";
  if (o.status() === 404) {
    expect(corpoDoOrcamento, `GET ${PORTA_DAS_TOPS_DE_ORCAMENTO}: a 404 é a de ROTA (o binário não tem a porta), nenhuma outra`)
      .toEqual({ error: { code: "NOT_FOUND", message: MSG_ROTA_NAO_ENCONTRADA } });
    porta = "ausente";
  } else {
    expect(o.status(), `GET ${PORTA_DAS_TOPS_DE_ORCAMENTO}: a 404 de rota ou 200 — outra resposta é defeito: ${JSON.stringify(corpoDoOrcamento).slice(0, 300)}`).toBe(200);
    expect(capacidadeDoCorpo(corpoDoOrcamento as OperationTypes, PORTA_DAS_TOPS_DE_ORCAMENTO), "a porta do orçamento declara a mesma capacidade").toBe("declarada");
    porta = "presente";
  }
  expect(porta === "presente", "a capacidade da F6 e a porta das TOPs de orçamento nascem no MESMO binário: uma resposta sem a outra é defeito").toBe(capacidade === "declarada");
  const mundo: Mundo = capacidade === "declarada" ? "novo" : "legado";
  console.log(`[skew] OPERACOES-01 F6b · K-1 · a base ${capacidade === "declarada" ? "DECLARA" : "NÃO declara"} finalizacaoEOrcamento em ${PORTA_DA_CAPACIDADE} `
    + `e responde ${o.status()} a ${PORTA_DAS_TOPS_DE_ORCAMENTO} → mundo ${mundo}`);
  return mundo;
}

/** Os cadastros do caso PELA API DA BASE: produto, fornecedor e Local de estoque novos; natureza e centro do seed. */
async function cadastros(page: Page, rotulo: string) {
  const ref = await referenciasDoSeed(page);
  const empresa = await empresaAtiva(page);
  const produto = (await criarCadastro(page, "products", { description: uniq(`F6bK1 ${rotulo} produto`), group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id })).id;
  const fornecedor = (await criarCadastro(page, "people", { name: uniq(`F6bK1 ${rotulo} forn`), person_type: "legal", is_provider: true })).id;
  const armazem = (await criarCadastro(page, "warehouses", {
    empresa_id: empresa, initials: `K${Math.random().toString(36).slice(2, 7).toUpperCase()}`, description: uniq(`F6bK1 ${rotulo} local`), type: "inputs"
  })).id;
  return { empresa, produto, fornecedor, armazem, natureza: ref.natureza.id, centro: ref.centro.id };
}

/** O fio da página: cada requisição à API (método e caminho) e cada resposta (caminho e status), enquanto o caso corre. */
function ouvirFio(page: Page) {
  const requisicoes: { metodo: string; caminho: string; busca: string }[] = [];
  const respostas: { caminho: string; status: number }[] = [];
  page.on("request", (r) => { if (r.url().startsWith(API)) requisicoes.push({ metodo: r.method(), caminho: caminho(r), busca: new URL(r.url()).search }); });
  page.on("response", (r) => { if (r.url().startsWith(API)) respostas.push({ caminho: caminho(r), status: r.status() }); });
  return { requisicoes, respostas };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K1-1 · A CONSULTA DO PEDIDO
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("OP01-F6b · K1-1 (sentido 1) — a consulta do pedido deste web sobre a API da base: sem a capacidade, a de HOJE (sem Finalizar, Aprovar para orçamento, Novo orçamento, aba Orçamentos nem bloco da aprovação; as abas e o Receber… de hoje) e nenhuma pergunta às rotas novas nem resposta 404/422/5xx; o Portal sem o Tipo do orçamento; com a capacidade, as pílulas novas e o Tipo", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const mundo = await mundoDaF6NaBase(page, cab);

  // O PEDIDO PELA API DA BASE: TOP de compra e TOP de pedido com o destino [compra] (o neutro do binário), um item.
  const c = await cadastros(page, "K1-1");
  const topCompra = { codigo: codigoTop("6k1c") };
  const idCompra = (await criarTop(page, { codigo: topCompra.codigo, codigoBase: "compras.compra", nome: uniq("F6b K1-1 compra") })).id;
  const idPedido = (await criarTop(page, {
    codigo: codigoTop("6k1p"), codigoBase: "compras.pedido", nome: uniq("F6b K1-1 pedido"), destinos: [{ tipoOperacaoId: idCompra, ordem: 0, emPartes: true }]
  })).id;
  const { id: pedidoId } = await api<{ id: string }>(page, "POST", "/api/compras/pedidos", {
    empresa_id: c.empresa, tipo_operacao_id: idPedido, fornecedor_id: c.fornecedor, data_documento: hojeISO(),
    categoria_financeira_id: c.natureza, centro_custo_id: c.centro, itens: [{ produto_id: c.produto, quantidade: "4", valor_unitario: "12.50" }]
  });
  const pedido = await api<{ id: string; codigo: string; situacao: string }>(page, "GET", `/api/compras/pedidos/${pedidoId}`);
  expect(pedido.situacao, "premissa: a base lançou o pedido aberto").toBe("aberto");

  // O FIO nasce AGORA (os cadastros acima foram pela página e não contam): o que a CONSULTA pediu e recebeu.
  const v = vigiar(page);
  const fio = ouvirFio(page);
  const capacidadeNoFio = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === PORTA_DA_CAPACIDADE);
  const passosNoFio = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === `/api/compras/pedidos/${pedido.id}/proximos-passos`);
  await page.goto(`/compras/pedidos/${pedido.id}`);
  await expect(page.getByTestId(`${P}-identidade-nome`), "premissa: a tela desenhou ESTE documento").toHaveText(pedido.codigo);
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");

  // A CAPACIDADE QUE A PRÓPRIA TELA RECEBEU: a premissa do ramo, no fio.
  const ot = await capacidadeNoFio;
  expect(ot.status(), "a tela perguntou a capacidade à base, e ela respondeu").toBe(200);
  expect(capacidadeDoCorpo((await ot.json()) as OperationTypes, "o operation-types que a tela recebeu"), `mundo ${mundo}: a capacidade no fio`)
    .toBe(mundo === "novo" ? "declarada" : "ausente");

  // O RECEBER… DE HOJE: os próximos passos da base, prontos, com o passo da compra pelo testid de hoje — e só ele.
  const passos = await passosNoFio;
  const corpoDosPassos = (await passos.json()) as Record<string, unknown> & { items: { codigo: string }[] };
  expect([passos.status(), corpoDosPassos.items.map((x) => x.codigo)], "premissa no fio: o passo é a TOP de compra").toEqual([200, [topCompra.codigo]]);
  if (mundo === "legado") expect(Object.keys(corpoDosPassos), "a base responde os próximos passos de hoje (sem `exigeFinalizar` nem `orcamentos`)").toEqual(["contractVersion", "politicaConfigurada", "items"]);
  else expect([corpoDosPassos["exigeFinalizar"], corpoDosPassos["orcamentos"]], "a TOP não exige finalizar e não oferece orçamento").toEqual([false, []]);
  await expect(page.getByTestId("compras-proximos-passos")).toHaveAttribute("data-situacao", "pronto");
  const receber = page.getByTestId(`compras-proximo-passo-${topCompra.codigo}`);
  await expect(receber, "o Receber… de hoje, pelo testid do passo").toBeEnabled();
  await expect(receber).toHaveText("Receber…");
  await expect(page.locator("[data-testid^='compras-proximo-passo-']"), "um passo só").toHaveCount(1);

  // A TELA ASSENTADA: nenhuma requisição em voo (as perguntas da capacidade já voltaram e a tela já as leu).
  await page.waitForLoadState("networkidle");
  const painel = page.getByTestId(`${P}-painel`);
  const nomesDasAbas = (await painel.getByRole("tab").allInnerTexts()).map((n) => n.replace(/\d+/g, "").trim());
  expect(nomesDasAbas, "as abas da consulta do pedido de HOJE, exatas: o pedido sem cotação não ganha a aba Orçamentos").toEqual(ABAS_DO_PEDIDO_DE_HOJE);
  await expect(page.getByTestId(`${P}-aprovacao`), "nenhum bloco de aprovação no pedido").toHaveCount(0);
  await expect(page.getByTestId("compras-novo-orcamento"), "nenhum Novo orçamento (o pedido não foi aprovado para orçamento)").toHaveCount(0);
  if (mundo === "legado") {
    await expect(page.getByTestId("compras-finalizar"), "sem a capacidade: nada de Finalizar").toHaveCount(0);
    await expect(page.getByTestId("compras-aprovar-para-orcamento"), "nem Aprovar para orçamento").toHaveCount(0);
  } else {
    await expect(page.getByTestId("compras-finalizar"), "com a capacidade: Finalizar no pedido aberto").toBeEnabled();
    await expect(page.getByTestId("compras-aprovar-para-orcamento"), "e Aprovar para orçamento").toBeEnabled();
  }
  await page.getByTestId(`${P}-dados`).getByRole("button", { name: /^Dados adicionais/ }).click();
  await expect(page.getByTestId("compras-consulta-finalizado"), "nada de \"Finalizado\" nos Dados adicionais").toHaveCount(0);
  await expect(page.getByTestId("compras-consulta-aprovado-orcamento"), "nem \"Aprovado para orçamento\"").toHaveCount(0);

  // O FIO: o que a consulta perguntou à base. Premissa anti-vacuidade: a tela falou com a base (o pedido e os passos).
  await page.waitForLoadState("networkidle");
  expect(fio.requisicoes.some((r) => r.caminho === `/api/compras/pedidos/${pedido.id}`), "premissa: o fio registrou a leitura do pedido").toBe(true);
  const situacaoDoPedido = `/api/aprovacoes/compras/${pedido.id}`;
  const daFinalizacao = fio.requisicoes.filter((r) => r.caminho.endsWith("/previa-finalizacao")).map((r) => `${r.metodo} ${r.caminho}`);
  expect(daFinalizacao, "nenhuma pergunta à prévia da finalização (o diálogo não foi aberto)").toEqual([]);
  const daSituacao = fio.respostas.filter((r) => r.caminho === situacaoDoPedido).map((r) => r.status);
  const doOrcamento = fio.requisicoes.filter((r) => /\/orcamentos(\/|$)/.test(r.caminho)).map((r) => `${r.metodo} ${r.caminho}`);
  if (mundo === "legado") {
    expect(daSituacao, `sem a capacidade, nenhuma pergunta a ${situacaoDoPedido}`).toEqual([]);
    expect(doOrcamento, "sem a capacidade, nenhuma pergunta a caminho com /orcamentos (a base não tem nenhum)").toEqual([]);
  } else {
    expect(daSituacao.length, `com a capacidade, a situação da aprovação do pedido é perguntada (${situacaoDoPedido})`).toBeGreaterThan(0);
    expect(daSituacao.every((s) => s === 200), "e respondida (não exigida: o bloco não aparece)").toBe(true);
    expect(doOrcamento.filter((x) => x !== `GET ${PORTA_DAS_TOPS_DE_ORCAMENTO}`), "com a capacidade, nenhuma pergunta com /orcamentos além da porta das TOPs de orçamento").toEqual([]);
  }

  // O PORTAL DE COMPRAS: o Tipo "Orçamento de compra" segue a capacidade lida nas portas. Na base sem ela, a lista desse
  // Tipo viria VAZIA (a base descarta a espécie que não conhece) e afirmaria "não há orçamentos": o Tipo não existe.
  // Com ela, existe. PREMISSA: o Tipo abriu, com as espécies de hoje.
  await page.goto("/compras?tab=documentos");
  await expect(page.getByTestId("compras-documentos"), "premissa: Documentos, no Tipo \"Todos\"").toHaveAttribute("data-especie", "");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("compras-tipo").click();
  const opcaoDoTipo = (valor: string) => page.locator(`[data-testid="compras-tipo-opcao"][data-valor="${valor}"]`);
  await expect(opcaoDoTipo("pedido"), "premissa: o Tipo abriu, com o pedido de compra").toHaveCount(1);
  await expect(opcaoDoTipo("compra"), "premissa: e com a compra").toHaveCount(1);
  if (mundo === "legado") await expect(opcaoDoTipo("orcamento"), "sem a capacidade, o Tipo não oferece o orçamento de compra").toHaveCount(0);
  else await expect(opcaoDoTipo("orcamento"), "com a capacidade, o Tipo oferece o orçamento de compra").toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.waitForLoadState("networkidle");
  if (mundo === "legado") {
    const doOrcamentoNoPortal = fio.requisicoes.filter((r) => /\/orcamentos(\/|$)/.test(r.caminho) || new URLSearchParams(r.busca).get("especie") === "orcamento")
      .map((r) => `${r.metodo} ${r.caminho}${r.busca}`);
    expect(doOrcamentoNoPortal, "o Portal também não pergunta nada de orçamento à base").toEqual([]);
  }
  v.semBloqueio();
  v.semErroDeContrato();
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K1-2 · A PRÉVIA DA CONFIRMAÇÃO DA COMPRA
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("OP01-F6b · K1-2 (sentido 1) — a prévia da confirmação da compra deste web sobre a API da base: o corpo sem `divergencia` é lido como 'pronta', sem a seção da divergência, e confirmar dá 200, como hoje", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const mundo = await mundoDaF6NaBase(page, cab);

  // A COMPRA PELA API DA BASE: TOP de compra (o neutro do binário, sem a seção da divergência), sem origem, um item.
  const c = await cadastros(page, "K1-2");
  const idCompra = (await criarTop(page, { codigo: codigoTop("6k2c"), codigoBase: "compras.compra", nome: uniq("F6b K1-2 compra") })).id;
  const { id: compraId } = await api<{ id: string }>(page, "POST", "/api/compras/compras", {
    empresa_id: c.empresa, tipo_operacao_id: idCompra, fornecedor_id: c.fornecedor, data_documento: hojeISO(),
    categoria_financeira_id: c.natureza, centro_custo_id: c.centro, itens: [{ produto_id: c.produto, armazem_id: c.armazem, quantidade: "2", valor_unitario: "7.00" }]
  });
  const compra = await api<{ codigo: string; situacao: string }>(page, "GET", `/api/compras/compras/${compraId}`);
  expect(compra.situacao, "premissa: a base lançou a compra aberta").toBe("aberto");

  const v = vigiar(page);
  await page.goto(`/compras/compras/${compraId}`);
  await expect(page.getByTestId(`${P}-identidade-nome`), "premissa: a tela desenhou ESTE documento").toHaveText(compra.codigo);
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");

  // A PRÉVIA QUE A BASE DEVOLVE: sem `divergencia` (a premissa, no fio) — a Central deste HEAD a lê como "pronta".
  const previaNoFio = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === `/api/compras/compras/${compraId}/previa-confirmacao`);
  await page.getByTestId("compras-confirmar").click();
  const previa = await previaNoFio;
  expect(previa.status(), "a base respondeu a prévia").toBe(200);
  const corpoDaPrevia = (await previa.json()) as Record<string, unknown> & { podeConfirmar?: unknown };
  expect(["divergencia" in corpoDaPrevia, corpoDaPrevia.podeConfirmar], `mundo ${mundo}: a prévia da base, sem a chave nova, e podendo confirmar`).toEqual([false, true]);
  await expect(page.getByTestId("compras-previa"), "o corpo de hoje é lido como prévia PRONTA, não como indisponível").toHaveAttribute("data-situacao", "pronta");
  await expect(page.getByTestId("compras-previa-divergencia"), "sem a divergência no fio, a seção não existe").toHaveCount(0);
  await expect(page.getByTestId("compras-previa-recusas"), "nem recusa").toHaveCount(0);
  const confirmar = page.getByTestId("confirm-dialog-confirm");
  await expect(confirmar, "o Confirmar fica habilitado, como hoje").toBeEnabled();

  // CONFIRMAR: a base confirma pelo clique deste web (200), e a consulta mostra a compra confirmada.
  const confirmou = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/compras/compras/${compraId}/confirm`);
  await confirmar.click();
  expect((await confirmou).status(), "a base confirma a compra (200)").toBe(200);
  await expect(page.getByTestId("compras-consulta-corpo"), "a consulta mostra a compra confirmada").toHaveAttribute("data-situacao", "confirmado");
  expect((await api<{ situacao: string }>(page, "GET", `/api/compras/compras/${compraId}`)).situacao, "na base também").toBe("confirmado");
  v.semBloqueio();
});
