import { test, expect, type Page } from "@playwright/test";
import { enumLabel, type ModoDeColoracao } from "@agro/domain";
import { api, primeiroId, uniq } from "./helpers";
import {
  abrirMapaNasAreas,
  aguardarAreasNoMapa,
  aguardarMapaParado,
  areaDaResposta,
  CAMADAS,
  CAMINHO_OPERACIONAL,
  dadosDaFonte,
  deslocar,
  enquadrar,
  entrarComoAdmin,
  hojeDaApi,
  mapaPronto,
  marcadoresNaFonte,
  marcadoresPorArea,
  OPCOES_WEBGL,
  ORIGEM_DOS_ICONES,
  pngSolido,
  pontoNaPagina,
  proximaRespostaOperacional,
  quadrado,
  regiao,
  renderizadas,
  semearAreas,
  somarDias,
  type AreaDaApi,
  type AreaSemeada,
  type PedidoDeArea,
  type RespostaOperacionalE2E
} from "./mapa-manejo-04-comum";
import { PALETA_LOTACAO_UA_HA, PALETA_SITUACAO_DO_PASTO, PALETA_USO_DA_AREA } from "../src/features/mapa-de-manejo/paleta-do-mapa";

/**
 * MAPA-MANEJO-04 (decisão 308) — T2: COLORAÇÃO, LEGENDA, FILTROS, CONTROLES E DESEMPENHO no /mapa-de-manejo.
 *
 * Cada caso semeia as PRÓPRIAS áreas (com polígono) e lotes (mapa-manejo-04-comum.ts, região "T2"), abre a tela e
 * compara o MAPA com a resposta REAL de `GET /api/mapa/operacional` que a tela recebeu no fio:
 *   - a cor de cada polígono: `cor_exibida` das features da fonte `areas` (`querySourceFeatures`, deduplicado por id)
 *     e o `fill-color` que o MapLibre avaliou na camada `areas-fill` = a cor da PALETA (paleta-do-mapa.ts, a única
 *     decisão da tela) para a `faixa.chave` que a API mandou. A faixa NUNCA é recalculada aqui: o teste só lê a chave;
 *   - a legenda (`legenda-do-mapa`) com as faixas presentes na resposta, o filtro de faixa (opacidade 0,95 na
 *     escolhida e 0,12 nas outras — OPACIDADE_FAIXA_* de coloracao-no-mapa.ts; 0,78 sem filtro, mapa-base.tsx) e o ESC
 *     em cascata (filtro → seleção);
 *   - cada faixa como TEXTO: na legenda e na linha a mais do rótulo da área (`mapa-rotulo-linha-extra`);
 *   - os controles da barra (lotes, objetos, rótulos) e o alvo de toque de 44 px em tela estreita;
 *   - UMA chamada a `/api/mapa/operacional` por mudança de filtro (retiro, módulo, coloração), contada no fio, e
 *     nenhuma por área; e a carga de 30 áreas com 60 lotes.
 * As cabeças vêm de rebanho por contagem de "Boi Gordo" (fator de UA 1 no seed): só a PREMISSA de que as faixas das
 * áreas semeadas se distinguem — o que vale é a chave que a API devolveu.
 */

test.use(OPCOES_WEBGL);

/** Opacidade do preenchimento: sem filtro de faixa (mapa-base.tsx), faixa escolhida e faixas atenuadas (coloracao-no-mapa.ts). */
const OPACIDADE_SEM_FILTRO = 0.78;
const OPACIDADE_ESCOLHIDA = 0.95;
const OPACIDADE_ATENUADA = 0.12;

/** Janela, em ms, depois da resposta de uma mudança de filtro, para provar que NENHUMA chamada a mais chega. */
const JANELA_SEM_CHAMADA_MS = 1500;

/** Registra uma medida do caso (anotação do relatório e linha no console do executor). */
function registrar(descricao: string): void {
  test.info().annotations.push({ type: "medida", description: descricao });
  console.log(`[${test.info().title.slice(0, 7)}] ${descricao}`);
}

// ------------------------------------------------------------------------------------------------------------------
// Leitura do mapa (gancho de e2e `window.__mapaManejoE2E`)
// ------------------------------------------------------------------------------------------------------------------

interface FeatureLidaT2 {
  id?: unknown;
  properties: Record<string, unknown> | null;
  layer?: { id: string; paint?: Record<string, unknown> };
}
interface MapaT2 {
  querySourceFeatures(fonte: string): FeatureLidaT2[];
  queryRenderedFeatures(opcoes: { layers: string[] }): FeatureLidaT2[];
  getLayoutProperty(camada: string, propriedade: string): unknown;
  getLayer(id: string): unknown;
}
type JanelaT2 = { __mapaManejoE2E?: MapaT2 };

/**
 * `cor_exibida` e `opacidade_fill` de cada área pedida, lidas da fonte `areas` por `querySourceFeatures` (a mesma
 * área se repete por tile: deduplicado por id — vale o primeiro registro).
 */
async function areasNaFonte(page: Page, ids: readonly string[]): Promise<Record<string, { cor: string; opacidade: number }>> {
  return page.evaluate((ids) => {
    const m = (window as unknown as JanelaT2).__mapaManejoE2E;
    const r: Record<string, { cor: string; opacidade: number }> = {};
    if (!m) return r;
    const alvo = new Set(ids);
    for (const f of m.querySourceFeatures("areas")) {
      const id = String(f.properties?.["id"] ?? f.id ?? "");
      if (!alvo.has(id) || r[id]) continue;
      r[id] = { cor: String(f.properties?.["cor_exibida"] ?? "").toLowerCase(), opacidade: Number(f.properties?.["opacidade_fill"]) };
    }
    return r;
  }, [...ids]);
}

/**
 * O que o MapLibre DESENHOU na camada `areas-fill` para cada área pedida: os `fill-color` (#rrggbb) e `fill-opacity`
 * avaliados para a feature — distintos, porque um polígono pode cair em mais de um tile.
 */
async function pinturaNoMapa(page: Page, ids: readonly string[]): Promise<Record<string, { cores: string[]; opacidades: number[] }>> {
  return page.evaluate((ids) => {
    const m = (window as unknown as JanelaT2).__mapaManejoE2E;
    const r: Record<string, { cores: string[]; opacidades: number[] }> = {};
    if (!m || !m.getLayer("areas-fill")) return r;
    const alvo = new Set(ids);
    const hex = (v: unknown): string => {
      const c = v as { r?: number; g?: number; b?: number; a?: number } | null;
      if (!c || typeof c.r !== "number" || typeof c.g !== "number" || typeof c.b !== "number") return String(v);
      const a = typeof c.a === "number" && c.a > 0 ? c.a : 1;
      const h = (x: number) => Math.round((x / a) * 255).toString(16).padStart(2, "0");
      return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
    };
    for (const f of m.queryRenderedFeatures({ layers: ["areas-fill"] })) {
      const id = String(f.properties?.["id"] ?? f.id ?? "");
      if (!alvo.has(id)) continue;
      const atual = r[id] ?? { cores: [], opacidades: [] };
      const cor = hex(f.layer?.paint?.["fill-color"]);
      const opacidade = Number(f.layer?.paint?.["fill-opacity"]);
      if (!atual.cores.includes(cor)) atual.cores.push(cor);
      if (!atual.opacidades.includes(opacidade)) atual.opacidades.push(opacidade);
      r[id] = atual;
    }
    return r;
  }, [...ids]);
}

/** `visibility` de layout das camadas pedidas ("visible" quando nunca foi mudada). */
async function visibilidade(page: Page, camadas: readonly string[]): Promise<string[]> {
  return page.evaluate((camadas) => {
    const m = (window as unknown as JanelaT2).__mapaManejoE2E;
    return camadas.map((id) => (m && m.getLayer(id) ? String(m.getLayoutProperty(id, "visibility") ?? "visible") : "ausente"));
  }, [...camadas]);
}

// ------------------------------------------------------------------------------------------------------------------
// Coloração, rótulos e legenda
// ------------------------------------------------------------------------------------------------------------------

/** Paleta de cada modo de cor fixa (categoria é posicional e não entra na comparação de cor). */
const PALETA_DO_MODO: Partial<Record<ModoDeColoracao, Readonly<Record<string, string>>>> = {
  lotacao_ua_ha: PALETA_LOTACAO_UA_HA,
  situacao_pasto: PALETA_SITUACAO_DO_PASTO,
  uso_da_area: PALETA_USO_DA_AREA
};

/** A cor da paleta para a chave da faixa que a API mandou (premissa: a paleta tem a chave). */
function corDaPaleta(modo: ModoDeColoracao, chave: string): string {
  const cor = PALETA_DO_MODO[modo]?.[chave];
  expect(cor, `premissa: a paleta de ${modo} tem cor para "${chave}"`).toBeTruthy();
  return cor!.toLowerCase();
}

/** A faixa que a API deu à área (premissa: não nula fora do padrão). */
function faixaDaApi(resposta: RespostaOperacionalE2E, id: string): NonNullable<AreaDaApi["faixa"]> {
  const f = areaDaResposta(resposta, id).faixa;
  expect(f, `premissa: a API deu faixa à área ${id} no modo ${resposta.coloracao}`).not.toBeNull();
  return f!;
}

/**
 * Troca o modo em "Colorir por" e devolve a resposta REAL que a tela recebeu para ele (premissa: a query pediu o
 * modo). Só para uma combinação de filtros ainda não pedida — a repetida dentro do `staleTime` vem do cache, sem fio.
 */
async function trocarColoracao(page: Page, modo: ModoDeColoracao): Promise<RespostaOperacionalE2E> {
  const resposta = proximaRespostaOperacional(page);
  await page.getByTestId("seletor-coloracao").selectOption(modo);
  const { corpo, query } = await resposta;
  expect(query.get("coloracao"), `premissa: a tela pediu ?coloracao=${modo}`).toBe(modo);
  expect(corpo.coloracao, `premissa: a API respondeu no modo ${modo}`).toBe(modo);
  return corpo;
}

/** Número formatado em pt-BR pelo MESMO navegador (o `num` da tela). */
const formatar = (page: Page, numero: string | number, casas: number) =>
  page.evaluate(({ numero, casas }) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(Number(numero)), { numero: String(numero), casas });

/**
 * O texto da linha a mais do rótulo da área para a faixa que a API mandou, no formato da tela (`linhaDaFaixa`):
 * "<rótulo> · 1,45 UA/ha" (lotação), "<rótulo> · 21d" (situação do pasto), e só o rótulo sem número (uso da área,
 * categoria, "Sem registro de ocupação").
 */
async function linhaEsperada(page: Page, modo: ModoDeColoracao, faixa: NonNullable<AreaDaApi["faixa"]>): Promise<string> {
  if (faixa.numero !== null && modo === "lotacao_ua_ha" && faixa.unidade === "ua_ha") return `${faixa.rotulo} · ${await formatar(page, faixa.numero, 2)} UA/ha`;
  if (faixa.numero !== null && modo === "situacao_pasto" && faixa.unidade === "dias") return `${faixa.rotulo} · ${await formatar(page, faixa.numero, 0)}d`;
  return faixa.rotulo;
}

/** O rótulo DOM da área (overlay `mapa-rotulo-area`) pelo nome exato. */
const rotuloDaArea = (page: Page, nome: string) => page.getByTestId("mapa-rotulo-area").filter({ has: page.getByText(nome, { exact: true }) });

/** As chaves de faixa das áreas DESENHADAS (com polígono) da resposta — o que a legenda tem de listar. */
function chavesDesenhadas(resposta: RespostaOperacionalE2E): Map<string, { rotulo: string; quantidade: number }> {
  const porChave = new Map<string, { rotulo: string; quantidade: number }>();
  for (const a of resposta.areas) {
    const g = a["geometria"] as { type?: string } | null;
    if (g?.type !== "Polygon" || !a.faixa) continue;
    const atual = porChave.get(a.faixa.chave);
    if (atual) atual.quantidade += 1;
    else porChave.set(a.faixa.chave, { rotulo: a.faixa.rotulo, quantidade: 1 });
  }
  return porChave;
}

/** As chaves que a legenda mostra (`legenda-faixa-<chave>`), em ordem de exibição. */
const faixasDaLegenda = (page: Page) => page.locator('[data-testid^="legenda-faixa-"]').evaluateAll((els) => els.map((e) => (e.getAttribute("data-testid") ?? "").slice("legenda-faixa-".length)));

/** "#rrggbb" → "rgb(r, g, b)" (o `backgroundColor` computado da amostra da legenda). */
function rgbDe(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/**
 * Confere a legenda do modo contra a resposta: as MESMAS chaves das áreas desenhadas, cada uma com o rótulo da API, a
 * quantidade de áreas e a amostra na cor da paleta (modos de cor fixa).
 */
async function conferirLegenda(page: Page, resposta: RespostaOperacionalE2E): Promise<void> {
  const modo = resposta.coloracao as ModoDeColoracao;
  const legenda = page.getByTestId("legenda-do-mapa");
  await expect(legenda, `a legenda aparece em ${modo}`).toBeVisible();
  await expect(page.getByTestId("legenda-do-mapa-modo"), "a legenda diz o modo (rótulo do domínio)").toHaveText(enumLabel("modo_de_coloracao", modo));
  const esperadas = chavesDesenhadas(resposta);
  await expect.poll(async () => (await faixasDaLegenda(page)).sort(), { message: `a legenda de ${modo} lista as faixas presentes na resposta` })
    .toEqual([...esperadas.keys()].sort());
  for (const [chave, f] of esperadas) {
    const item = page.getByTestId(`legenda-faixa-${chave}`);
    await expect(item, `legenda ${chave}: o rótulo da API em texto`).toContainText(f.rotulo);
    await expect(page.getByTestId(`legenda-quantidade-${chave}`), `legenda ${chave}: a quantidade de áreas`).toHaveText(new RegExp(`^${f.quantidade}\\s`));
    if (PALETA_DO_MODO[modo]) {
      const fundo = await item.locator("span[aria-hidden]").first().evaluate((e) => getComputedStyle(e).backgroundColor);
      expect(fundo, `legenda ${chave}: a amostra na cor da paleta`).toBe(rgbDe(corDaPaleta(modo, chave)));
    }
  }
}

/** Confere que cada área pedida está pintada (fonte E desenho) na cor da paleta da faixa que a API mandou. */
async function conferirCores(page: Page, resposta: RespostaOperacionalE2E, areas: readonly AreaSemeada[]): Promise<void> {
  const modo = resposta.coloracao as ModoDeColoracao;
  const ids = areas.map((a) => a.id);
  const esperado = Object.fromEntries(areas.map((a) => [a.id, corDaPaleta(modo, faixaDaApi(resposta, a.id).chave)]));
  await expect.poll(async () => Object.fromEntries(Object.entries(await areasNaFonte(page, ids)).map(([id, v]) => [id, v.cor])),
    { message: `${modo}: cor_exibida da fonte areas = cor da paleta da faixa da API` }).toEqual(esperado);
  await expect.poll(async () => Object.fromEntries(Object.entries(await pinturaNoMapa(page, ids)).map(([id, v]) => [id, v.cores])),
    { message: `${modo}: fill-color desenhado = cor da paleta da faixa da API` }).toEqual(Object.fromEntries(Object.entries(esperado).map(([id, c]) => [id, [c]])));
}

// ------------------------------------------------------------------------------------------------------------------
// Semeadura própria (retiro, módulo, objeto de mapa) e datas do banco
// ------------------------------------------------------------------------------------------------------------------

/** `dias` antes do `hoje` que a PRÓPRIA API usa (a régua da rota — nunca o `current_date` do banco), em ISO. */
const diasAtras = async (page: Page, dias: number) => somarDias(await hojeDaApi(page), -Math.trunc(dias));

/** Retiro NOVO pela API do cadastro. */
async function criarRetiro(page: Page, empresa: string, rotulo: string): Promise<{ id: string; nome: string }> {
  const nome = uniq(`MM4 Retiro ${rotulo}`);
  const r = await api<{ id: string }>(page, "POST", "/api/resources/retiros", { empresa_id: empresa, name: nome, main_activity: "cria" });
  expect(r.id, `premissa: o retiro "${nome}" foi criado`).toMatch(/^[0-9a-f-]{36}$/);
  return { id: r.id, nome };
}

/** Módulo de pastejo NOVO pela API do cadastro (forragem: a primeira do seed). */
async function criarModulo(page: Page, empresa: string, rotulo: string, retiro: string | null): Promise<{ id: string; nome: string }> {
  const nome = uniq(`MM4 Modulo ${rotulo}`);
  const forragem = await primeiroId(page, "/api/resources/fodders");
  const r = await api<{ id: string }>(page, "POST", "/api/resources/grazing_modules", {
    empresa_id: empresa, retiro_id: retiro, module_date: "2026-09-01", description: nome, fodder_id: forragem, grazing_method: "rotacionado"
  });
  expect(r.id, `premissa: o módulo "${nome}" foi criado`).toMatch(/^[0-9a-f-]{36}$/);
  return { id: r.id, nome };
}

/** Cocho NOVO (objeto de mapa, ponto) dentro da área, pela API do mapa. */
async function criarCocho(page: Page, empresa: string, area: AreaSemeada): Promise<string> {
  const [lon, lat] = area.geometria.coordinates[0]![0]!;
  const r = await api<{ id: string }>(page, "POST", "/api/mapa/objetos", {
    empresa_id: empresa, tipo: "cocho", geometria: { type: "Point", coordinates: [lon + 0.001, lat + 0.001] }, name: uniq("MM4 Cocho"), area_id: area.id
  });
  expect(r.id, "premissa: o cocho foi criado").toMatch(/^[0-9a-f-]{36}$/);
  return r.id;
}

/** Lote de "Boi Gordo" (fator de UA 1 no seed) com a entrada pedida. */
const boiGordo = (cabecas: number, entrada?: string) => ({ cabecas, categoria: "Boi Gordo" as const, ...(entrada ? { entrada } : {}) });

// ------------------------------------------------------------------------------------------------------------------
// MM4-4a
// ------------------------------------------------------------------------------------------------------------------

test("MM4-4a — trocar o modo de coloração muda a cor dos polígonos (cor da paleta da faixa da API) e a legenda; em padrao, sem legenda", async ({ page }) => {
  test.setTimeout(240_000);
  const empresa = await entrarComoAdmin(page);
  const o = regiao("T2", 1);
  const [d10, d60, d120] = [await diasAtras(page, 10), await diasAtras(page, 60), await diasAtras(page, 120)];
  // área útil 10 ha e cabeças de 5 a 30 (UA 1 cada): as faixas de lotação se distinguem; as entradas, as de situação
  const util = { usable_area_ha: "10" };
  const pedidos: PedidoDeArea[] = [
    { rotulo: "4a 5", geometria: quadrado(o), lotes: [boiGordo(5, d10)], campos: util },
    { rotulo: "4a 10", geometria: quadrado(deslocar(o, 0.007)), lotes: [boiGordo(10, d60)], campos: util },
    { rotulo: "4a 15", geometria: quadrado(deslocar(o, 0.014)), lotes: [boiGordo(15, d120)], campos: util },
    { rotulo: "4a 20", geometria: quadrado(deslocar(o, 0.021)), lotes: [boiGordo(20, d10)], campos: util },
    { rotulo: "4a 30", geometria: quadrado(deslocar(o, 0.028)), lotes: [boiGordo(30, d10)], campos: util },
    { rotulo: "4a vazia", geometria: quadrado(deslocar(o, 0.035)), campos: util }
  ];
  const areas = await semearAreas(page, empresa, pedidos);
  const ids = areas.map((a) => a.id);
  const inicial = await abrirMapaNasAreas(page, areas, 16);

  // PADRÃO: sem faixa na resposta, sem legenda, a cor do cadastro
  expect(inicial.coloracao, "premissa: a tela abre em padrao").toBe("padrao");
  for (const a of areas) expect(areaDaResposta(inicial, a.id).faixa, `premissa: sem faixa em padrao (${a.nome})`).toBeNull();
  await expect(page.getByTestId("seletor-coloracao")).toHaveValue("padrao");
  await expect(page.getByTestId("legenda-do-mapa"), "em padrao não há legenda").toHaveCount(0);
  await expect.poll(async () => Object.keys(await areasNaFonte(page, ids)).sort(), { message: "as áreas do caso na fonte areas" }).toEqual([...ids].sort());
  const corDoPadrao = Object.fromEntries(Object.entries(await areasNaFonte(page, ids)).map(([id, v]) => [id, v.cor]));

  // LOTAÇÃO (UA/ha)
  const lotacao = await trocarColoracao(page, "lotacao_ua_ha");
  const chavesLotacao = new Set(areas.map((a) => faixaDaApi(lotacao, a.id).chave));
  expect(chavesLotacao.size, "premissa: as áreas do caso caem em pelo menos 4 faixas de lotação distintas").toBeGreaterThanOrEqual(4);
  expect(new Set([...chavesLotacao].map((c) => corDaPaleta("lotacao_ua_ha", c))).size, "premissa: faixas distintas, cores distintas").toBe(chavesLotacao.size);
  await conferirCores(page, lotacao, areas);
  const corNaLotacao = await areasNaFonte(page, ids);
  for (const a of areas) expect(corNaLotacao[a.id]?.cor, `${a.nome}: a cor mudou ao sair do padrao`).not.toBe(corDoPadrao[a.id]);
  await conferirLegenda(page, lotacao);
  registrar(`lotação: faixas do caso ${[...chavesLotacao].sort().join(", ")}`);

  // SITUAÇÃO DO PASTO
  const situacao = await trocarColoracao(page, "situacao_pasto");
  const chavesSituacao = new Set(areas.map((a) => faixaDaApi(situacao, a.id).chave));
  expect(chavesSituacao.size, "premissa: as áreas do caso caem em pelo menos 3 situações distintas").toBeGreaterThanOrEqual(3);
  await conferirCores(page, situacao, areas);
  await conferirLegenda(page, situacao);
  registrar(`situação: faixas do caso ${[...chavesSituacao].sort().join(", ")}`);

  // DE VOLTA AO PADRÃO (a mesma combinação da carga: pode vir do cache — o que vale é a tela)
  await page.getByTestId("seletor-coloracao").selectOption("padrao");
  await expect(page.getByTestId("legenda-do-mapa"), "de volta ao padrao, a legenda some").toHaveCount(0);
  await expect.poll(async () => Object.fromEntries(Object.entries(await areasNaFonte(page, ids)).map(([id, v]) => [id, v.cor])),
    { message: "de volta ao padrao, a cor do cadastro" }).toEqual(corDoPadrao);
});

// ------------------------------------------------------------------------------------------------------------------
// MM4-4b
// ------------------------------------------------------------------------------------------------------------------

test("MM4-4b — clicar numa faixa da legenda atenua as outras (0,95 × 0,12); de novo ou ESC tira o filtro; ESC em cascata: filtro, depois seleção", async ({ page }) => {
  test.setTimeout(240_000);
  const empresa = await entrarComoAdmin(page);
  const o = regiao("T2", 2);
  const util = { usable_area_ha: "10" };
  const areas = await semearAreas(page, empresa, [
    { rotulo: "4b 15a", geometria: quadrado(o), lotes: [boiGordo(15)], campos: util },
    { rotulo: "4b 15b", geometria: quadrado(deslocar(o, 0.007)), lotes: [boiGordo(15)], campos: util },
    { rotulo: "4b 30", geometria: quadrado(deslocar(o, 0.014)), lotes: [boiGordo(30)], campos: util },
    { rotulo: "4b vazia", geometria: quadrado(deslocar(o, 0.021)), campos: util }
  ]);
  const ids = areas.map((a) => a.id);
  const vazia = areas[3]!;
  await abrirMapaNasAreas(page, areas, 16);
  const resposta = await trocarColoracao(page, "lotacao_ua_ha");

  // a faixa escolhida é a da primeira área (a chave que a API mandou); premissa: há área do caso dentro e fora dela
  const escolhida = faixaDaApi(resposta, areas[0]!.id).chave;
  const dentro = areas.filter((a) => faixaDaApi(resposta, a.id).chave === escolhida).map((a) => a.id);
  const fora = areas.filter((a) => faixaDaApi(resposta, a.id).chave !== escolhida).map((a) => a.id);
  expect(dentro.length, "premissa: mais de uma área do caso na faixa escolhida").toBeGreaterThanOrEqual(2);
  expect(fora.length, "premissa: áreas do caso fora da faixa escolhida").toBeGreaterThanOrEqual(1);
  const opacidadesEsperadas = (filtro: boolean) => Object.fromEntries(ids.map((id) => [id, !filtro ? OPACIDADE_SEM_FILTRO : dentro.includes(id) ? OPACIDADE_ESCOLHIDA : OPACIDADE_ATENUADA]));
  const opacidadesNaFonte = async () => Object.fromEntries(Object.entries(await areasNaFonte(page, ids)).map(([id, v]) => [id, v.opacidade]));
  const opacidadesDesenhadas = async () => Object.fromEntries(Object.entries(await pinturaNoMapa(page, ids)).map(([id, v]) => [id, v.opacidades]));
  const desenhadasEsperadas = (filtro: boolean) => Object.fromEntries(Object.entries(opacidadesEsperadas(filtro)).map(([id, v]) => [id, [v]]));

  const faixa = page.getByTestId(`legenda-faixa-${escolhida}`);
  await expect(faixa, "sem filtro, nenhuma faixa pressionada").toHaveAttribute("aria-pressed", "false");
  await expect.poll(opacidadesNaFonte, { message: "sem filtro: a opacidade normal em todas" }).toEqual(opacidadesEsperadas(false));

  // clicar filtra: a escolhida plena, as outras atenuadas (fonte E desenho)
  await faixa.click();
  await expect(faixa).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("legenda-limpar-filtro")).toBeVisible();
  await expect.poll(opacidadesNaFonte, { message: "com filtro: 0,95 na escolhida, 0,12 nas outras (fonte)" }).toEqual(opacidadesEsperadas(true));
  await expect.poll(opacidadesDesenhadas, { message: "com filtro: fill-opacity desenhado" }).toEqual(desenhadasEsperadas(true));
  // a cor não muda com o filtro: só a opacidade
  await conferirCores(page, resposta, areas);

  // clicar de novo tira o filtro
  await faixa.click();
  await expect(faixa).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("legenda-limpar-filtro")).toHaveCount(0);
  await expect.poll(opacidadesNaFonte, { message: "clicar de novo: volta a opacidade normal" }).toEqual(opacidadesEsperadas(false));

  // ESC tira o filtro
  await faixa.click();
  await expect.poll(opacidadesNaFonte).toEqual(opacidadesEsperadas(true));
  await page.keyboard.press("Escape");
  await expect(faixa, "ESC tira o filtro").toHaveAttribute("aria-pressed", "false");
  await expect.poll(opacidadesNaFonte, { message: "ESC: volta a opacidade normal" }).toEqual(opacidadesEsperadas(false));

  // ESC EM CASCATA: com filtro E seleção, o 1º ESC tira o filtro e o 2º a seleção
  const [lon, lat] = vazia.geometria.coordinates[0]![0]!;
  const ponto = await pontoNaPagina(page, [lon + 0.001, lat + 0.001]); // dentro do polígono da área vazia (sem marcador)
  await page.mouse.click(ponto.x, ponto.y);
  const painel = page.getByTestId("painel-do-pasto");
  await expect(painel, "o clique na área abre o painel dela").toHaveAttribute("aria-label", `Detalhe de ${vazia.nome}`);
  await faixa.click();
  await expect(faixa).toHaveAttribute("aria-pressed", "true");
  await expect.poll(opacidadesNaFonte).toEqual(opacidadesEsperadas(true));
  await page.keyboard.press("Escape");
  await expect(faixa, "1º ESC: sai o filtro").toHaveAttribute("aria-pressed", "false");
  await expect(painel, "1º ESC: a seleção fica").toBeVisible();
  await expect.poll(opacidadesNaFonte).toEqual(opacidadesEsperadas(false));
  await page.keyboard.press("Escape");
  await expect(painel, "2º ESC: sai a seleção").toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(painel, "3º ESC: nada a desfazer").toHaveCount(0);
  await expect(page.getByTestId("legenda-do-mapa"), "a legenda continua (a coloração não é desfeita pelo ESC)").toBeVisible();
});

// ------------------------------------------------------------------------------------------------------------------
// MM4-4c
// ------------------------------------------------------------------------------------------------------------------

test("MM4-4c — cada faixa aparece como TEXTO, não só cor: na legenda e na linha a mais do rótulo da área, em todo modo", async ({ page }) => {
  test.setTimeout(240_000);
  const empresa = await entrarComoAdmin(page);
  const o = regiao("T2", 3);
  const util = { usable_area_ha: "10" };
  const areas = await semearAreas(page, empresa, [
    { rotulo: "4c a", geometria: quadrado(o), lotes: [boiGordo(15, await diasAtras(page, 12))], campos: util },
    { rotulo: "4c b", geometria: quadrado(deslocar(o, 0.007)), lotes: [boiGordo(10, await diasAtras(page, 60))], campos: util },
    { rotulo: "4c c", geometria: quadrado(deslocar(o, 0.014)), campos: util }
  ]);
  const vazia = areas[2]!;
  await abrirMapaNasAreas(page, areas, 16);
  for (const a of areas) await expect(rotuloDaArea(page, a.nome), `premissa: o rótulo de ${a.nome} está no mapa`).toHaveCount(1);

  // padrao: nenhuma linha a mais em rótulo nenhum
  await expect(page.getByTestId("mapa-rotulo-linha-extra"), "em padrao, nenhum rótulo tem a linha da faixa").toHaveCount(0);

  for (const modo of ["lotacao_ua_ha", "situacao_pasto", "uso_da_area", "categoria"] as const) {
    const resposta = await trocarColoracao(page, modo);
    for (const a of areas) {
      const f = faixaDaApi(resposta, a.id);
      const linha = await linhaEsperada(page, modo, f);
      await expect(rotuloDaArea(page, a.nome).getByTestId("mapa-rotulo-linha-extra"), `${modo} · ${a.nome}: a faixa em texto no rótulo`).toHaveText(linha);
      const item = page.getByTestId(`legenda-faixa-${f.chave}`);
      await expect(item, `${modo} · ${a.nome}: a faixa em texto na legenda`).toContainText(f.rotulo);
      await expect(item).toHaveAttribute("title", f.rotulo);
    }
    // "sem registro" é texto próprio — nunca "0d"
    if (modo === "situacao_pasto") {
      const f = faixaDaApi(resposta, vazia.id);
      expect(f.chave, "premissa: a área nunca ocupada vem sem registro").toBe("sem_registro");
      expect(f.numero, "premissa: sem número").toBeNull();
      await expect(rotuloDaArea(page, vazia.nome).getByTestId("mapa-rotulo-linha-extra")).not.toContainText("0d");
    }
    registrar(`${modo}: ${await page.getByTestId("mapa-rotulo-linha-extra").count()} linhas de faixa nos rótulos`);
  }
});

// ------------------------------------------------------------------------------------------------------------------
// MM4-4c-bis (controles)
// ------------------------------------------------------------------------------------------------------------------

test("MM4-4c-bis — controles: lotes, objetos e rótulos ligam e desligam; alvo de toque ≥ 44 px em 390 px e compacto de 640 px para cima", async ({ page }) => {
  test.setTimeout(240_000);
  const empresa = await entrarComoAdmin(page);
  const retiro = await criarRetiro(page, empresa, "4c-bis");
  const modulo = await criarModulo(page, empresa, "4c-bis", retiro.id);
  const o = regiao("T2", 4);
  const areas = await semearAreas(page, empresa, [
    { rotulo: "4cb a", geometria: quadrado(o), lotes: [boiGordo(8)], campos: { retiro_id: retiro.id, grazing_module_id: modulo.id } },
    { rotulo: "4cb b", geometria: quadrado(deslocar(o, 0.007)), lotes: [boiGordo(4)] }
  ]);
  const cocho = await criarCocho(page, empresa, areas[0]!);
  const resposta = await abrirMapaNasAreas(page, areas, 16);
  const ids = areas.map((a) => a.id);
  expect(resposta.capacidades.objetos, "premissa: o admin vê objetos de mapa").toBe(true);
  expect(resposta.objetos.map((x) => x["id"]), "premissa: o cocho veio na resposta").toContain(cocho);

  const marcadoresDesenhados = async () => new Set((await renderizadas(page, [CAMADAS.lotesFallback, CAMADAS.lotesIcone, CAMADAS.lotesBadge]))
    .map((f) => String(f.propriedades["area_id"])).filter((id) => ids.includes(id))).size;
  const cochoDesenhado = async () => (await renderizadas(page, [CAMADAS.objetosFallback, CAMADAS.objetos])).filter((f) => f.propriedades["objeto_id"] === cocho).length;
  const camadasDeLotes = [CAMADAS.lotesFallback, CAMADAS.lotesIcone, CAMADAS.lotesBadge];
  const camadasDeObjetos = [CAMADAS.objetosFallback, CAMADAS.objetos];

  // LOTES
  const lotes = page.getByTestId("camada-lotes");
  await expect(lotes).toHaveAttribute("aria-pressed", "true");
  await expect.poll(marcadoresDesenhados, { message: "lotes ligados: os 2 marcadores desenhados" }).toBe(2);
  expect(await visibilidade(page, camadasDeLotes)).not.toContain("none");
  await lotes.click();
  await expect(lotes).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => visibilidade(page, camadasDeLotes), { message: "lotes desligados: visibility none nas 3 camadas" }).toEqual(["none", "none", "none"]);
  await expect.poll(marcadoresDesenhados, { message: "lotes desligados: nenhum marcador desenhado" }).toBe(0);
  await lotes.click();
  await expect(lotes).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => visibilidade(page, camadasDeLotes)).toEqual(["visible", "visible", "visible"]);
  await expect.poll(marcadoresDesenhados, { message: "lotes religados: os marcadores voltam" }).toBe(2);

  // OBJETOS DE MAPA
  const objetos = page.getByTestId("camada-objetos");
  await expect(objetos).toHaveAttribute("aria-pressed", "true");
  await expect.poll(cochoDesenhado, { message: "objetos ligados: o cocho desenhado" }).toBeGreaterThan(0);
  await objetos.click();
  await expect(objetos).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => visibilidade(page, camadasDeObjetos), { message: "objetos desligados: visibility none" }).toEqual(["none", "none"]);
  await expect.poll(cochoDesenhado, { message: "objetos desligados: o cocho some" }).toBe(0);
  expect(await visibilidade(page, camadasDeLotes), "desligar objetos não mexe nos lotes").toEqual(["visible", "visible", "visible"]);
  await objetos.click();
  await expect.poll(() => visibilidade(page, camadasDeObjetos)).toEqual(["visible", "visible"]);
  await expect.poll(cochoDesenhado, { message: "objetos religados: o cocho volta" }).toBeGreaterThan(0);

  // RÓTULOS (overlay DOM)
  const rotulos = page.getByTestId("camada-rotulos");
  await expect(rotulos).toHaveAttribute("aria-pressed", "true");
  for (const a of areas) await expect(rotuloDaArea(page, a.nome), `rótulos ligados: ${a.nome}`).toHaveCount(1);
  await rotulos.click();
  await expect(rotulos).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("mapa-rotulo-area"), "rótulos desligados: nenhum rótulo de área").toHaveCount(0);
  expect(await visibilidade(page, camadasDeLotes), "desligar rótulos não mexe nos lotes").toEqual(["visible", "visible", "visible"]);
  await rotulos.click();
  for (const a of areas) await expect(rotuloDaArea(page, a.nome), `rótulos religados: ${a.nome}`).toHaveCount(1);

  // ALVO DE TOQUE: os botões e selects da barra
  await expect(page.getByTestId("filtro-retiro").locator(`option[value="${retiro.id}"]`), "premissa: o filtro de retiro tem o retiro do caso").toHaveCount(1);
  await expect(page.getByTestId("filtro-modulo").locator(`option[value="${modulo.id}"]`), "premissa: o filtro de módulo tem o módulo do caso").toHaveCount(1);
  const alturas = async () => page.getByTestId("mapa-barra-operacional").locator("button, select").evaluateAll((els) => els
    .filter((e) => (e as HTMLElement).offsetParent !== null)
    .map((e) => ({ id: e.getAttribute("data-testid") ?? e.textContent?.trim() ?? e.tagName, altura: e.getBoundingClientRect().height })));
  const obrigatorios = ["camada-lotes", "camada-objetos", "camada-rotulos", "filtro-retiro", "filtro-modulo", "mapa-minha-localizacao", "seletor-coloracao"];

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await alturas()).filter((c) => c.altura < 44 - 0.01), { message: "390 px: todo controle da barra com altura ≥ 44 px" }).toEqual([]);
  const estreita = await alturas();
  expect(estreita.map((c) => c.id), "390 px: os controles da barra foram medidos").toEqual(expect.arrayContaining(obrigatorios));
  registrar(`390 px: ${estreita.map((c) => `${c.id}=${c.altura.toFixed(1)}`).join(" ")}`);

  await page.setViewportSize({ width: 640, height: 844 });
  await expect.poll(async () => (await alturas()).filter((c) => c.altura >= 44), { message: "640 px: os controles voltam ao compacto (< 44 px)" }).toEqual([]);
  const larga = await alturas();
  expect(larga.map((c) => c.id), "640 px: os controles da barra foram medidos").toEqual(expect.arrayContaining(obrigatorios));
  registrar(`640 px: ${larga.map((c) => `${c.id}=${c.altura.toFixed(1)}`).join(" ")}`);
});

// ------------------------------------------------------------------------------------------------------------------
// MM4-6a
// ------------------------------------------------------------------------------------------------------------------

interface RequisicaoDaApi {
  metodo: string;
  caminho: string;
  url: string;
}

/** Registra, a partir de agora, toda requisição da página a `/api/...` (a lista cresce; leia por fatia). */
function registrarRequisicoes(page: Page): RequisicaoDaApi[] {
  const lista: RequisicaoDaApi[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/")) lista.push({ metodo: r.method(), caminho: u.pathname, url: r.url() });
  });
  return lista;
}

const ehOperacional = (r: RequisicaoDaApi) => r.metodo === "GET" && r.caminho === CAMINHO_OPERACIONAL;
const ehListagemDosFiltros = (r: RequisicaoDaApi) => r.caminho === "/api/resources/retiros" || r.caminho === "/api/resources/grazing_modules";

/**
 * Faz UMA mudança de filtro e devolve a resposta e as requisições à API desde a ação até o fim da janela de
 * observação (espera a resposta e mais `JANELA_SEM_CHAMADA_MS`: uma segunda chamada teria tempo de aparecer).
 */
async function mudarEContar(page: Page, lista: RequisicaoDaApi[], acao: () => Promise<void>): Promise<{ resposta: RespostaOperacionalE2E; query: URLSearchParams; novas: RequisicaoDaApi[] }> {
  const inicio = lista.length;
  const proxima = proximaRespostaOperacional(page);
  await acao();
  const { corpo, query } = await proxima;
  await page.waitForTimeout(JANELA_SEM_CHAMADA_MS);
  return { resposta: corpo, query, novas: lista.slice(inicio) };
}

/** Os ids das áreas desenhadas na fonte `areas` (GeoJSON exato). */
const idsNaFonteAreas = async (page: Page) => (await dadosDaFonte(page, "areas")).map((f) => String(f.propriedades["id"])).sort();
/** Os ids das áreas COM POLÍGONO da resposta. */
const idsComPoligono = (r: RespostaOperacionalE2E) => r.areas.filter((a) => (a["geometria"] as { type?: string } | null)?.type === "Polygon").map((a) => a.id).sort();

test("MM4-6a — uma mudança de filtro (retiro, módulo, coloração) = UMA chamada a /api/mapa/operacional, contada no fio; nenhuma por área", async ({ page }) => {
  test.setTimeout(240_000);
  const empresa = await entrarComoAdmin(page);
  const retiro = await criarRetiro(page, empresa, "6a");
  const modulo = await criarModulo(page, empresa, "6a", retiro.id);
  const o = regiao("T2", 5);
  const areas = await semearAreas(page, empresa, [
    { rotulo: "6a retiro e modulo", geometria: quadrado(o), lotes: [boiGordo(6)], campos: { retiro_id: retiro.id, grazing_module_id: modulo.id } },
    { rotulo: "6a so retiro", geometria: quadrado(deslocar(o, 0.007)), lotes: [boiGordo(4)], campos: { retiro_id: retiro.id } },
    { rotulo: "6a so modulo", geometria: quadrado(deslocar(o, 0.014)), lotes: [boiGordo(3)], campos: { grazing_module_id: modulo.id } },
    { rotulo: "6a sem nada", geometria: quadrado(deslocar(o, 0.021)), lotes: [boiGordo(2)] }
  ]);
  const [ambos, soRetiro, soModulo, semNada] = areas as [AreaSemeada, AreaSemeada, AreaSemeada, AreaSemeada];
  const ids = areas.map((a) => a.id);
  await abrirMapaNasAreas(page, areas, 16);
  await expect(page.getByTestId("filtro-retiro").locator(`option[value="${retiro.id}"]`), "premissa: o retiro do caso está no filtro").toHaveCount(1);
  await expect(page.getByTestId("filtro-modulo").locator(`option[value="${modulo.id}"]`), "premissa: o módulo do caso está no filtro").toHaveCount(1);
  const lista = registrarRequisicoes(page);

  const conferirChamadas = (rotulo: string, novas: RequisicaoDaApi[]) => {
    const operacionais = novas.filter(ehOperacional);
    const porArea = novas.filter((r) => r.caminho.startsWith("/api/mapa/areas/") || ids.some((id) => r.url.includes(id)));
    expect(operacionais.map((r) => r.url), `${rotulo}: UMA chamada a ${CAMINHO_OPERACIONAL}`).toHaveLength(1);
    expect(porArea.map((r) => r.url), `${rotulo}: nenhuma chamada por área`).toEqual([]);
    expect(novas.filter(ehListagemDosFiltros).map((r) => r.url), `${rotulo}: as opções dos filtros não são pedidas de novo`).toEqual([]);
    registrar(`${rotulo}: ${operacionais.length} chamada(s) a ${CAMINHO_OPERACIONAL}, ${porArea.length} por área; requisições à API na janela: ${novas.map((r) => `${r.metodo} ${r.caminho}`).join(", ")}`);
  };

  // 1) RETIRO
  const r1 = await mudarEContar(page, lista, () => page.getByTestId("filtro-retiro").selectOption(retiro.id).then(() => undefined));
  conferirChamadas("retiro", r1.novas);
  expect(r1.query.get("retiro_id")).toBe(retiro.id);
  expect(r1.query.get("grazing_module_id")).toBeNull();
  expect(r1.resposta.areas.every((a) => a["retiro_id"] === retiro.id), "o recorte é do servidor: só áreas do retiro").toBe(true);
  expect(r1.resposta.areas.map((a) => a.id).filter((id) => ids.includes(id)).sort()).toEqual([ambos.id, soRetiro.id].sort());
  await expect.poll(() => idsNaFonteAreas(page), { message: "retiro: o mapa desenha exatamente as áreas da resposta" }).toEqual(idsComPoligono(r1.resposta));

  // 2) MÓDULO (o retiro continua)
  const r2 = await mudarEContar(page, lista, () => page.getByTestId("filtro-modulo").selectOption(modulo.id).then(() => undefined));
  conferirChamadas("módulo", r2.novas);
  expect(r2.query.get("retiro_id")).toBe(retiro.id);
  expect(r2.query.get("grazing_module_id")).toBe(modulo.id);
  expect(r2.resposta.areas.map((a) => a.id).filter((id) => ids.includes(id))).toEqual([ambos.id]);
  await expect.poll(() => idsNaFonteAreas(page), { message: "módulo: o mapa desenha exatamente as áreas da resposta" }).toEqual(idsComPoligono(r2.resposta));
  for (const fora of [soRetiro, soModulo, semNada]) expect(await marcadoresNaFonte(page, [fora.id]), `${fora.nome}: fora do filtro, sem marcador`).toEqual([]);

  // 3) COLORAÇÃO (os dois filtros continuam)
  const r3 = await mudarEContar(page, lista, () => page.getByTestId("seletor-coloracao").selectOption("lotacao_ua_ha").then(() => undefined));
  conferirChamadas("coloração", r3.novas);
  expect(r3.query.get("coloracao")).toBe("lotacao_ua_ha");
  expect(r3.query.get("retiro_id")).toBe(retiro.id);
  expect(r3.query.get("grazing_module_id")).toBe(modulo.id);
  await conferirLegenda(page, r3.resposta);

  // 4) DE VOLTA A "Todos" no módulo: combinação nova (retiro + lotação) → uma chamada
  const r4 = await mudarEContar(page, lista, () => page.getByTestId("filtro-modulo").selectOption("").then(() => undefined));
  conferirChamadas("módulo → Todos", r4.novas);
  expect(r4.query.get("grazing_module_id")).toBeNull();
  expect(r4.resposta.areas.map((a) => a.id).filter((id) => ids.includes(id)).sort()).toEqual([ambos.id, soRetiro.id].sort());
  registrar(`total no caso: ${lista.filter(ehOperacional).length} chamadas a ${CAMINHO_OPERACIONAL} para 4 mudanças de filtro`);
});

// ------------------------------------------------------------------------------------------------------------------
// MM4-7a
// ------------------------------------------------------------------------------------------------------------------

test("MM4-7a — 30 áreas e 60 lotes semeados: desenha tudo, UMA chamada a /api/mapa/operacional na carga, sem erro no console", async ({ page }) => {
  test.setTimeout(480_000);
  const empresa = await entrarComoAdmin(page);
  const o = regiao("T2", 6);
  // grade 6 × 5 de quadrados; 2 lotes por área (Boi Gordo e Garrote), cabeças variando por área
  const pedidos: PedidoDeArea[] = Array.from({ length: 30 }, (_, i) => ({
    rotulo: `7a ${String(i + 1).padStart(2, "0")}`,
    geometria: quadrado(deslocar(o, (i % 6) * 0.007, Math.floor(i / 6) * 0.007)),
    lotes: [boiGordo(3 + (i % 7)), { cabecas: 2 + (i % 5), categoria: "Garrote" as const }]
  }));
  const t0Semeadura = Date.now();
  const areas = await semearAreas(page, empresa, pedidos);
  const ids = areas.map((a) => a.id);
  expect(areas.flatMap((a) => a.lotes), "premissa: 60 lotes semeados").toHaveLength(60);
  registrar(`semeadura: 30 áreas e 60 lotes em ${Date.now() - t0Semeadura} ms`);

  // erro de página ou de console, e as requisições, desde ANTES de abrir a tela
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") erros.push(`console: ${m.text()}`); });
  // imagem de ícone de outro caso (configuração de outra spec no mesmo banco) não vira 404 no console deste
  await page.route(`${ORIGEM_DOS_ICONES}/**`, (r) => r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, contentType: "image/png", body: pngSolido(46, 46) }));
  const lista = registrarRequisicoes(page);

  const t0 = Date.now();
  const resposta = proximaRespostaOperacional(page);
  await page.goto("/mapa-de-manejo");
  const { corpo } = await resposta;
  const tResposta = Date.now() - t0;
  await mapaPronto(page);
  await expect.poll(async () => Object.values(await marcadoresPorArea(page, ids)).filter((n) => n === 1).length,
    { message: "os 30 marcadores na fonte lotes, um por área", timeout: 60_000, intervals: [100] }).toBe(30);
  const tMarcadores = Date.now() - t0;

  // a resposta: as 30 áreas, ocupadas, 2 lotes cada
  for (const a of areas) {
    const daApi = areaDaResposta(corpo, a.id);
    expect(daApi.lotes, `premissa: ${a.nome} com 2 lotes na resposta`).toHaveLength(2);
    expect(daApi.cabecas_total, `premissa: ${a.nome} cabeças = o semeado`).toBe(a.cabecas);
  }
  // 30 polígonos na fonte areas e 30 pontos (exatamente um por área) na fonte lotes
  await aguardarAreasNoMapa(page, ids);
  expect(new Set((await dadosDaFonte(page, "areas")).map((f) => String(f.propriedades["id"])).filter((id) => ids.includes(id))).size, "30 polígonos na fonte areas").toBe(30);
  expect(Object.values(await marcadoresPorArea(page, ids)), "um ponto por área na fonte lotes").toEqual(Array.from({ length: 30 }, () => 1));
  // os contadores: as cabeças da API em cada ponto
  const naFonte = await marcadoresNaFonte(page, ids);
  for (const a of areas) {
    expect(naFonte.find((f) => f.propriedades["area_id"] === a.id)?.propriedades["cabecas"], `${a.nome}: contador = cabecas_total da API`).toBe(areaDaResposta(corpo, a.id).cabecas_total);
  }
  // desenhados: 30 marcadores distintos, cada um escrevendo o total da API
  await enquadrar(page, areas.map((a) => a.geometria), 16);
  await expect.poll(async () => new Set((await renderizadas(page, [CAMADAS.lotesIcone])).map((f) => String(f.propriedades["area_id"])).filter((id) => ids.includes(id))).size,
    { message: "30 marcadores desenhados" }).toBe(30);
  const formato = new Map<number, string>();
  for (const a of areas) {
    const n = areaDaResposta(corpo, a.id).cabecas_total;
    if (!formato.has(n)) formato.set(n, await page.evaluate((n) => new Intl.NumberFormat("pt-BR").format(n), n));
  }
  const textos = new Map((await renderizadas(page, [CAMADAS.lotesIcone])).filter((f) => ids.includes(String(f.propriedades["area_id"]))).map((f) => [String(f.propriedades["area_id"]), f.texto]));
  for (const a of areas) expect(textos.get(a.id), `${a.nome}: o contador desenhado`).toBe(formato.get(areaDaResposta(corpo, a.id).cabecas_total));
  const tDesenho = Date.now() - t0;
  await aguardarMapaParado(page);
  await page.waitForTimeout(JANELA_SEM_CHAMADA_MS);

  // as chamadas da carga
  const operacionais = lista.filter(ehOperacional);
  const retiros = lista.filter((r) => r.caminho === "/api/resources/retiros");
  const modulos = lista.filter((r) => r.caminho === "/api/resources/grazing_modules");
  const porArea = lista.filter((r) => r.caminho.startsWith("/api/mapa/areas/") || ids.some((id) => r.url.includes(id)));
  expect(operacionais.map((r) => r.url), `UMA chamada a ${CAMINHO_OPERACIONAL} na carga`).toHaveLength(1);
  expect(retiros.map((r) => r.url), "a listagem de retiros (opções do filtro): uma vez").toHaveLength(1);
  expect(modulos.map((r) => r.url), "a listagem de módulos (opções do filtro): uma vez").toHaveLength(1);
  expect(porArea.map((r) => r.url), "nenhuma chamada por área").toEqual([]);
  expect(erros, "nenhum erro de página nem de console").toEqual([]);
  registrar(`carga: resposta de ${CAMINHO_OPERACIONAL} em ${tResposta} ms (${corpo.areas.length} áreas na resposta); 30 marcadores na fonte em ${tMarcadores} ms; 30 marcadores desenhados e conferidos em ${tDesenho} ms`);
  registrar(`chamadas na carga: ${operacionais.length} operacional, ${retiros.length} retiros, ${modulos.length} módulos, ${porArea.length} por área; todas as requisições à API: ${lista.map((r) => `${r.metodo} ${r.caminho}`).join(", ")}`);
});
