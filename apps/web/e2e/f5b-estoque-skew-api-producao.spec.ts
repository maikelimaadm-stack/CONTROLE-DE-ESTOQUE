import { test, expect, type Locator, type Page, type Request } from "@playwright/test";
import { entendeMovimentacaoInterna } from "@agro/domain";
import { api, login } from "./helpers";
import {
  cadastroDeEstoque, criarTopDeEstoque, entradaConfirmadaPelaApi, escolherNaReferencia, incluirItemNaCentralDeEstoque, saldoNoServidor
} from "./estoque-01-comum";
import { cabecalhosDaSessao } from "./top-config-08-comum";

/**
 * OPERACOES-01 · F5b · K-1, SENTIDO 1 — O WEB DESTE HEAD CONTRA A API DA BASE (decisão 282, parte F5b; a janela "web
 * antes da API" da DEPLOYMENT).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O version skew roda em `playwright.skew.config.ts`, cujo `testMatch` é a
 * expressão `/skew-api-producao\.spec\.ts/` — sem âncora, então ela casa também com o fim deste nome; e o
 * `playwright.config.ts` comum ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (lá a API seria a
 * deste HEAD e o caso ficaria verde por vacuidade). Arquivo próprio, e não um caso a mais num spec de skew de outra
 * fase: as fases desta PR correm em paralelo, e cada uma acrescenta o SEU arquivo. Sem `scripts/lib` e sem passo no CI:
 * o arquivo entra pelo nome. A identidade da árvore da base é a do caso IDENTIDADE de `skew-api-producao.spec.ts`, na
 * mesma execução do job.
 *
 * O QUE SE MEDE. A Central de Estoque deste HEAD está no MOTOR da Central e oferece as SETE espécies quando a API declara
 * `capacidades.movimentacaoInterna` no `operation-types`; sem a declaração, as QUATRO de hoje, com o corpo de hoje (a
 * base é `.strict()`: uma chave nova seria 422), o custo obrigatório na entrada, nenhuma aba Destino nem Motivo da
 * saída, nenhum pedido às rotas novas (`/regras-da-operacao`, `/layout-efetivo`, `/destino/opcoes`), a prévia da base
 * lida como hoje e o "Ajustar estoque" do Saldo no diálogo de sempre.
 *
 * O MUNDO É PERGUNTADO À BASE NA HORA, e por duas portas que nascem juntas na OPERACOES-01: a declaração
 * `movimentacaoInterna` no `operation-types` da entrada e o `operation-types` da requisição de material (404 = a rota
 * não existe naquele binário). As duas respostas têm de descrever o MESMO binário — uma sem a outra é defeito, não skew
 * —, e a resposta decide o ramo. Os dois ramos cobram prova POSITIVA; nenhum deles só passa:
 *   · MUNDO LEGADO (a base de hoje, sem a OPERACOES-01): as quatro espécies, o corpo de hoje, o custo obrigatório, a
 *     prévia da base, o diálogo antigo do ajuste — e as rotas novas NUNCA pedidas, com a Central montada e pronta (a
 *     ausência só vale depois da presença de quem as pediria);
 *   · MUNDO NOVO (a base já com a OPERACOES-01, depois do merge): a tela USA a capacidade — as sete espécies, as regras
 *     e o layout da TOP pedidos à base, a entrada sem o custo obrigatório, a aba Motivo da saída e o ajuste do Saldo na
 *     Central.
 * Nenhuma requisição morre no navegador (CORS). Não há mock: o servidor é o binário da base, servindo o banco migrado e
 * semeado por este HEAD.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";

type Mundo = "legado" | "novo";

/** As espécies de hoje e as da movimentação interna, ESCRITAS AQUI: a família (o `data-familia` do "+ Novo") e o chip. */
const QUATRO = [
  { familia: "estoque.entrada", rotulo: "Entrada" },
  { familia: "estoque.saida", rotulo: "Saída" },
  { familia: "estoque.transferencia", rotulo: "Transferência" },
  { familia: "estoque.ajuste", rotulo: "Ajuste" }
] as const;
const TRES_NOVAS = [
  { familia: "estoque.requisicao_material", rotulo: "Requisição" },
  { familia: "estoque.consumo", rotulo: "Consumo" },
  { familia: "estoque.devolucao_consumo", rotulo: "Devolução de consumo" }
] as const;
const ESPECIES_DO_MUNDO: Readonly<Record<Mundo, readonly { familia: string; rotulo: string }[]>> = { legado: QUATRO, novo: [...QUATRO, ...TRES_NOVAS] };

/** As chaves do CORPO DE HOJE (o da Central da base, `central-estoque.tsx` da ESTOQUE-01), por extenso. */
const CABECALHO_DE_HOJE = ["armazem_id", "data_documento", "empresa_id", "itens", "tipo_operacao_id"];

/** As três rotas de leitura que só a API com a capacidade tem (F5b): nenhum pedido a elas contra a base de hoje. */
const ROTA_NOVA = /^\/api\/estoque\/[^/]+\/(regras-da-operacao|layout-efetivo|destino\/opcoes)$/;

/**
 * Vigia do navegador (o desenho de `skew-api-producao.spec.ts`): falha de CORS não vira exceção nem resposta HTTP — o
 * Chromium aborta a requisição antes de ela existir para a aplicação. Sem o coletor, a tela renderiza vazia e o teste
 * passa, que é exatamente o modo de falha desta janela. Junto, o registro de todo pedido às rotas novas do estoque. O
 * 404 da sonda (`/api/estoque/requisicoes/operation-types` na base) é RESPOSTA, não falha de rede.
 */
function vigiar(page: Page) {
  const falhas: string[] = []; const novas: string[] = [];
  page.on("requestfailed", (r) => { if (r.url().includes(API)) falhas.push(`${r.url()} → ${r.failure()?.errorText ?? "?"}`); });
  page.on("console", (m) => { if (m.type() === "error" && /CORS|preflight|Access-Control/i.test(m.text())) falhas.push(`console: ${m.text()}`); });
  page.on("request", (r) => { if (r.url().includes(API) && ROTA_NOVA.test(new URL(r.url()).pathname)) novas.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  return {
    semBloqueio: () => expect(falhas, "nenhuma requisição pode morrer no navegador (CORS/preflight)").toEqual([]),
    /** Os pedidos às rotas novas até agora. */
    rotasNovas: () => [...novas]
  };
}

/**
 * A PERGUNTA À BASE, feita antes de qualquer tela. A entrada sempre existe (ESTOQUE-01, na base desde a 274) e declara
 * `documentoEstoque`; a movimentação interna e a rota da requisição nascem juntas. No legado, nenhuma das três chaves da
 * OPERACOES-01 (`movimentacaoInterna`, `layoutDocumento`, `regrasDaOperacao`); no novo, as três. Status fora de
 * {200, 404} na sonda é defeito, não skew.
 */
async function perguntarABase(page: Page): Promise<Mundo> {
  const cab = await cabecalhosDaSessao(page);
  const entradas = await page.request.get(`${API}/api/estoque/entradas/operation-types`, { headers: cab });
  expect(entradas.status(), "premissa: a base serve o operation-types da entrada (ESTOQUE-01)").toBe(200);
  const capacidades = ((await entradas.json()) as { capacidades?: Record<string, unknown> }).capacidades ?? {};
  expect(capacidades["documentoEstoque"], "premissa: a base declara o documento de estoque").toBe(1);
  const declara = entendeMovimentacaoInterna(capacidades);
  const sonda = await page.request.get(`${API}/api/estoque/requisicoes/operation-types`, { headers: cab });
  expect([200, 404], "a base ou serve a requisição de material ou não a conhece — outro código é defeito, não skew").toContain(sonda.status());
  expect(sonda.status() === 200, "a capacidade `movimentacaoInterna` e a rota da requisição nascem no MESMO binário: uma sem a outra é defeito").toBe(declara);
  if (declara) {
    expect([capacidades["layoutDocumento"], capacidades["regrasDaOperacao"]], "no mundo novo, o layout e as regras do estoque também são declarados").toEqual([1, 1]);
  } else {
    expect(["movimentacaoInterna", "layoutDocumento", "regrasDaOperacao"].filter((k) => k in capacidades), "no legado, nenhuma chave da OPERACOES-01").toEqual([]);
  }
  const mundo: Mundo = declara ? "novo" : "legado";
  console.log(`[skew] F5b · K-1 · a base responde ${sonda.status()} a GET /api/estoque/requisicoes/operation-types e ${declara ? "DECLARA" : "NÃO declara"} movimentacaoInterna → mundo ${mundo}`);
  return mundo;
}

/** A Central montada e PRONTA (as perguntas que ela faz ao abrir já voltaram): o Salvar habilitado e a grade com o "Adicionar". */
async function centralPronta(page: Page, especie: string) {
  const central = page.getByTestId("estoque-central");
  await expect(central).toHaveAttribute("data-especie", especie);
  await expect(central).toHaveAttribute("data-modo", "criacao");
  await expect(page.getByTestId("estoque-salvar"), "o Salvar habilitado: a Central não espera mais nada do servidor").toBeEnabled();
  await expect(page.getByTestId("central-estoque-adicionar-item"), "a grade dos itens do motor").toBeVisible();
}

/** O que a Central pediu às rotas novas: nada no legado; no novo, as regras E o layout da TOP da espécie. */
function conferirRotasNovas(mundo: Mundo, pedidas: string[], segmento: string) {
  if (mundo === "legado") {
    expect(pedidas, "sem a capacidade, nenhum pedido às rotas novas (regras, layout, destino)").toEqual([]);
  } else {
    expect(pedidas, "com a capacidade, a Central pergunta à base as regras e o layout da TOP")
      .toEqual(expect.arrayContaining([`GET /api/estoque/${segmento}/regras-da-operacao`, `GET /api/estoque/${segmento}/layout-efetivo`]));
  }
}

/** Marca a linha da grade do motor (o círculo alterna: só clica quando ela ainda não está marcada). */
async function marcarLinha(linha: Locator) {
  const circulo = linha.getByTestId("central-estoque-selecionar-item");
  if ((await circulo.getAttribute("aria-checked")) !== "true") await circulo.click();
  await expect(circulo).toHaveAttribute("aria-checked", "true");
}

const ehPostDe = (segmento: string) => (r: Request) => r.method() === "POST" && new URL(r.url()).pathname === `/api/estoque/${segmento}`;
const aba = (page: Page, nome: string) => page.getByRole("tab", { name: new RegExp(`^${nome}`) });

/** Salva (o POST sai, a base responde 201) e devolve o corpo enviado e o id do documento. */
async function salvar(page: Page, segmento: string) {
  const post = page.waitForRequest(ehPostDe(segmento));
  const resposta = page.waitForResponse((r) => ehPostDe(segmento)(r.request()));
  await page.getByTestId("estoque-salvar").click();
  const corpo = (await post).postDataJSON() as Record<string, unknown> & { itens: Record<string, unknown>[] };
  const r = await resposta;
  expect(r.status(), `a base aceita o corpo deste web (${segmento}): ${await r.text()}`).toBe(201);
  await expect(page).toHaveURL(new RegExp(`/estoque/movimentacoes/${segmento}/[0-9a-f-]{36}$`));
  return { corpo, id: ((await r.json()) as { id: string }).id };
}

/** Confirma pela PRÉVIA da base: o corpo dela sem `baseDoSaldo` (a base não o conhece), lido como o FÍSICO, como hoje. */
async function confirmarPelaPreviaDaBase(page: Page, mundo: Mundo, segmento: string, id: string, saldoDepois: string) {
  const central = page.getByTestId("estoque-central");
  await expect(central).toHaveAttribute("data-modo", "consulta");
  await expect(central).toHaveAttribute("data-situacao", "aberto");
  const previa = page.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname === `/api/estoque/${segmento}/${id}/previa-confirmacao`);
  await page.getByTestId("estoque-confirmar").click();
  const corpo = (await (await previa).json()) as Record<string, unknown>;
  if (mundo === "legado") expect("baseDoSaldo" in corpo, "a prévia da base de hoje não manda `baseDoSaldo`").toBe(false);
  const corpoDaTela = page.getByTestId("estoque-previa-corpo");
  await expect(corpoDaTela, "a prévia da base é lida como PRONTA").toHaveAttribute("data-situacao", "pronta");
  await expect(corpoDaTela, "e a base do saldo é o físico, como hoje").toHaveAttribute("data-base-do-saldo", "fisico");
  await expect(page.getByTestId("estoque-previa-item")).toHaveAttribute("data-saldo-depois", saldoDepois);
  await expect(page.getByTestId("estoque-previa-bloqueio"), "sem falta de saldo").toHaveCount(0);
  await page.getByTestId("estoque-previa-confirmar").click();
  await expect(central, "a base confirmou pelo clique deste web").toHaveAttribute("data-situacao", "confirmado");
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K1-a · A LISTA: AS ESPÉCIES DO MUNDO, E O "+ NOVO" ATÉ A CENTRAL
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("OP01-F5b · K1-a (sentido 1) — a lista de Movimentações deste web sobre a API da base: sem a capacidade, os chips e o '+ Novo' só das QUATRO espécies, e a Central aberta pelo '+ Novo' não pede nenhuma rota nova; com ela, as SETE e as regras e o layout pedidos", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const mundo = await perguntarABase(page);
  const especies = ESPECIES_DO_MUNDO[mundo];
  const topEntrada = await criarTopDeEstoque(page, "entrada");

  await page.goto("/estoque?tab=movimentacoes");
  await expect(page.getByTestId("estoque-movimentacoes"), "a aba Movimentações monta nos dois mundos").toBeVisible();
  await expect(page.getByTestId("estoque-movimentacoes-indisponivel"), "a base serve a lista única (ESTOQUE-01)").toHaveCount(0);
  await expect(page.getByTestId("estoque-filtro-especie").getByRole("radio"), "os chips: Todas e as espécies deste mundo")
    .toHaveText(["Todas", ...especies.map((e) => e.rotulo)]);
  await expect(page.getByRole("columnheader").filter({ hasText: "Atendimento" }), "a coluna do atendimento só com a capacidade")
    .toHaveCount(mundo === "novo" ? 1 : 0);

  // O "+ NOVO": um grupo por espécie oferecida — as quatro no legado (as sondas das três novas voltaram 404).
  await page.getByTestId("estoque-novo").click();
  const lancador = page.getByTestId("lancador-unificado");
  await expect(lancador).toBeVisible();
  const grupos = lancador.getByTestId("lancador-grupo");
  await expect(grupos, "um grupo por espécie deste mundo").toHaveCount(especies.length);
  expect(await grupos.evaluateAll((gs) => gs.map((g) => g.getAttribute("data-familia"))), "os grupos são as famílias deste mundo").toEqual(especies.map((e) => e.familia));

  // A CENTRAL que o "+ Novo" abre: montada e pronta — é ela quem pediria as rotas novas.
  await lancador.locator(`[data-testid="lancador-top"][data-top-id="${topEntrada.id}"]`).click();
  await page.getByTestId("lancador-lancar").click();
  await expect(page).toHaveURL(new RegExp(`/estoque/movimentacoes/entradas/new\\?tipo_operacao_id=${topEntrada.id}$`));
  await centralPronta(page, "entrada");
  await expect(page.getByTestId("estoque-central-layout-efetivo"), "a linha do layout só com a capacidade").toHaveCount(mundo === "novo" ? 1 : 0);
  conferirRotasNovas(mundo, v.rotasNovas(), "entradas");
  v.semBloqueio();
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K1-b · A CENTRAL DE ENTRADA E A DE SAÍDA SOBRE A BASE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("OP01-F5b · K1-b (sentido 1) — as Centrais de entrada e de saída deste web sobre a API da base: sem a capacidade, o custo da entrada é obrigatório (pendência, zero POST), o corpo tem EXATAMENTE as chaves de hoje, sem aba Destino nem Motivo, e a prévia da base confirma; com ela, a entrada sem o custo obrigatório e a saída com o Motivo", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const mundo = await perguntarABase(page);
  const topEntrada = await criarTopDeEstoque(page, "entrada");
  const topSaida = await criarTopDeEstoque(page, "saida");
  const c = await cadastroDeEstoque(page);
  expect(Number((await saldoNoServidor(page, c.armazem, c.produto)).quantity), "premissa: produto novo, sem saldo").toBe(0);

  // ── ENTRADA ──
  await page.goto(`/estoque/movimentacoes/entradas/new?tipo_operacao_id=${topEntrada.id}`);
  await centralPronta(page, "entrada");
  await expect(page.getByTestId("estoque-central-aviso-saldo"), "o aviso do saldo, nos dois mundos").toBeVisible();
  await expect(page.getByTestId("estoque-central-aviso-custo"), "o aviso do custo vazio (custo médio) só com a capacidade").toHaveCount(mundo === "novo" ? 1 : 0);
  await expect(aba(page, "Observações"), "o painel da Central monta (a aba Observações)").toHaveCount(1);
  await expect(aba(page, "Destino"), "a entrada nunca tem Destino").toHaveCount(0);
  await escolherNaReferencia(page, page.getByTestId("estoque-central-armazem"), c.nomeArmazem);
  const linha = await incluirItemNaCentralDeEstoque(page, { nomeProduto: c.nomeProduto, quantidade: "5" });
  if (mundo === "legado") {
    // O CUSTO OBRIGATÓRIO DE HOJE: sem ele, a pendência e NENHUM POST (a base recusaria o corpo sem custo).
    // O botão da barra do motor é ícone: o rótulo é o nome acessível. Sem as regras da TOP, "Salvar" (nunca "Salvar e confirmar").
    await expect(page.getByTestId("estoque-salvar"), "o Salvar de hoje").toHaveAttribute("aria-label", "Salvar");
    const posts: string[] = [];
    const registrar = (r: Request) => { if (ehPostDe("entradas")(r)) posts.push(r.url()); };
    page.on("request", registrar);
    await page.getByTestId("estoque-salvar").click();
    const pendencia = page.getByTestId("central-estoque-pendencias-lista").locator('[data-testid="central-estoque-pendencia"][data-caminho="itens.0.custo_unitario"]');
    await expect(pendencia, "a pendência do custo da entrada, com a mensagem de hoje").toContainText("Informe o custo unitário da entrada");
    expect(posts, "nenhum POST saiu").toEqual([]);
    page.off("request", registrar);
    await page.keyboard.press("Escape");
  }
  await marcarLinha(linha);
  await linha.getByLabel("Valor unitário do item 1").fill("12.5");
  const entrada = await salvar(page, "entradas");
  expect(Object.keys(entrada.corpo).sort(), "o cabeçalho da entrada: as chaves de hoje, nem uma a mais").toEqual(CABECALHO_DE_HOJE);
  expect(entrada.corpo.itens, "o item da entrada: produto, quantidade e custo, em texto").toEqual([{ produto_id: c.produto, quantidade: "5", custo_unitario: "12.5" }]);
  expect(entrada.corpo, "a empresa, o local e a TOP").toMatchObject({ empresa_id: c.empresa, armazem_id: c.armazem, tipo_operacao_id: topEntrada.id });
  expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity, "salvar não move o saldo").toBe("0.0000");
  await confirmarPelaPreviaDaBase(page, mundo, "entradas", entrada.id, "5.0000");
  const lidaEntrada = await api<{ movimentos: { movement_type: string; unit_cost: string }[] }>(page, "GET", `/api/estoque/entradas/${entrada.id}`);
  expect(lidaEntrada.movimentos.map((m) => [m.movement_type, Number(m.unit_cost)]), "a base deu entrada pelo custo informado").toEqual([["entry", 12.5]]);
  expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity, "a base confirmou: 5 no local").toBe("5.0000");
  conferirRotasNovas(mundo, v.rotasNovas(), "entradas");

  // ── SAÍDA ──
  await page.goto(`/estoque/movimentacoes/saidas/new?tipo_operacao_id=${topSaida.id}`);
  await centralPronta(page, "saida");
  await expect(aba(page, "Observações"), "o painel da Central monta (a aba Observações)").toHaveCount(1);
  if (mundo === "novo") {
    // A TELA USA A CAPACIDADE: a aba do Motivo da saída (motivo e justificativa) — o resto é das provas da suíte comum.
    await expect(aba(page, "Motivo da saída"), "com a capacidade, a saída tem a aba do Motivo").toHaveCount(1);
    conferirRotasNovas(mundo, v.rotasNovas(), "saidas");
    v.semBloqueio();
    return;
  }
  await expect(aba(page, "Motivo da saída"), "sem a capacidade, nada de Motivo da saída").toHaveCount(0);
  await expect(aba(page, "Destino"), "nem de Destino").toHaveCount(0);
  await escolherNaReferencia(page, page.getByTestId("estoque-central-armazem"), c.nomeArmazem);
  await incluirItemNaCentralDeEstoque(page, { nomeProduto: c.nomeProduto, quantidade: "2" });
  const saida = await salvar(page, "saidas");
  expect(Object.keys(saida.corpo).sort(), "o cabeçalho da saída: as chaves de hoje (sem motivo, justificativa nem destino)").toEqual(CABECALHO_DE_HOJE);
  expect(saida.corpo.itens, "o item da saída: produto e quantidade").toEqual([{ produto_id: c.produto, quantidade: "2" }]);
  await confirmarPelaPreviaDaBase(page, mundo, "saidas", saida.id, "3.0000");
  // A CONSULTA DA SAÍDA (M-1 da revisão da F5b): a base nem grava destino — a aba Destino não aparece ("Sem destino." de
  // um recurso que aquela API não tem). A premissa: o painel da consulta montou.
  await expect(aba(page, "Movimentos"), "premissa: o painel da consulta montou (a aba Movimentos)").toHaveCount(1);
  await expect(aba(page, "Destino"), "a consulta da saída lançada na base não tem a aba Destino").toHaveCount(0);
  const lidaSaida = await api<{ movimentos: { movement_type: string; quantity: string }[] }>(page, "GET", `/api/estoque/saidas/${saida.id}`);
  expect(lidaSaida.movimentos.map((m) => [m.movement_type, m.quantity]), "a base baixou 2").toEqual([["writeoff", "2.0000"]]);
  expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity, "o saldo no servidor: 5 − 2").toBe("3.0000");
  conferirRotasNovas(mundo, v.rotasNovas(), "saidas");
  v.semBloqueio();
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K1-c · O "AJUSTAR ESTOQUE" DO SALDO
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("OP01-F5b · K1-c (sentido 1) — o Saldo deste web sobre a API da base: sem a capacidade, 'Ajustar estoque' abre o diálogo de sempre e a correção vale; com ela, a Central de ajuste preenchida", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const mundo = await perguntarABase(page);
  const topEntrada = await criarTopDeEstoque(page, "entrada");
  const topAjuste = await criarTopDeEstoque(page, "ajuste");
  const c = await cadastroDeEstoque(page);
  await entradaConfirmadaPelaApi(page, { top: topEntrada.id, empresa: c.empresa, armazem: c.armazem, produto: c.produto }, "5", "10");
  expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity, "premissa: a partida é 5").toBe("5.0000");
  // PREMISSA: a base tem TOP de ajuste para lançar — então o único motivo para a Central não abrir é a capacidade.
  const ajustes = await api<{ capacidades?: unknown; items: { id: string }[] }>(page, "GET", "/api/estoque/ajustes/operation-types");
  expect(ajustes.items.map((t) => t.id), "premissa: a base oferece a TOP de ajuste do caso").toContain(topAjuste.id);
  expect(entendeMovimentacaoInterna(ajustes.capacidades), "o ajuste declara a capacidade só no mundo novo").toBe(mundo === "novo");

  await page.goto(`/estoque?tab=estoque&sub=saldo&product_id=${c.produto}`);
  const noSaldo = page.getByRole("row").filter({ hasText: c.nomeProduto });
  await expect(noSaldo, "o produto aparece no Saldo").toHaveCount(1);
  await noSaldo.getByRole("button", { name: "Ajustar estoque" }).click();
  if (mundo === "novo") {
    await expect(page, "com a capacidade, a Central de ajuste, preenchida pela linha").toHaveURL(new RegExp(`/estoque/movimentacoes/ajustes/new\\?.*produto_id=${c.produto}`));
    await expect(page.getByTestId("top-lancador")).toBeVisible();
    v.semBloqueio();
    return;
  }
  const dialogo = page.getByRole("dialog").filter({ hasText: "Ajustar estoque" });
  await expect(dialogo, "sem a capacidade, o diálogo de sempre").toBeVisible();
  await expect(page, "e não a Central de ajuste").toHaveURL(/\/estoque\?/);
  await dialogo.getByLabel("Nova quantidade").fill("3");
  await dialogo.getByLabel("Justificativa").fill("K1-c contagem pelo diálogo de sempre");
  const post = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/stock/corrections");
  await dialogo.getByRole("button", { name: "Salvar" }).click();
  const resposta = await post;
  expect(resposta.status(), `a base aceita a correção de sempre: ${await resposta.text()}`).toBe(201);
  expect(resposta.request().postDataJSON(), "o corpo de sempre, com a linha do Saldo").toMatchObject({ empresa_id: c.empresa, warehouse_id: c.armazem, product_id: c.produto, new_quantity: "3" });
  expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity, "o saldo é a contagem").toBe("3.0000");
  expect(v.rotasNovas(), "nenhum pedido às rotas novas").toEqual([]);
  v.semBloqueio();
});
