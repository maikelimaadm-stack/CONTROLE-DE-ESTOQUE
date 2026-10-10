import { test, expect, type Page } from "@playwright/test";
import {
  CAMADAS,
  OPCOES_WEBGL,
  ORIGEM_DOS_ICONES,
  abrirMapaNasAreas,
  areaDaResposta,
  centroideDaApi,
  clicarNoMapa,
  configurarIcone,
  dadosDaFonte,
  descansarArea,
  desativarIcones,
  deslocar,
  desprojetar,
  diaDoBanco,
  distanciaEmPx,
  emL,
  entrarComoAdmin,
  escolherColoracao,
  formatoPtBr,
  marcadoresNaFonte,
  marcadoresPorArea,
  mediaDosVertices,
  ordemDasCamadas,
  painelDoPasto,
  pngSolido,
  projetar,
  quadrado,
  regiao,
  renderizadas,
  renderizadasDaArea,
  retangulo,
  semearAreas,
  servirIcones,
  temImagem,
  triangulo,
  zoomDoMapa,
  type AreaDaApi,
  type AreaSemeada,
  type FeatureDaFonte
} from "./mapa-manejo-04-comum";

/**
 * MAPA-MANEJO-04 (decisão 308) — T1: o MARCADOR AGREGADO por área no /mapa-de-manejo.
 *
 * Cada caso semeia as PRÓPRIAS áreas (com polígono), lotes, rebanho por contagem, identificadores e configurações de
 * ícone (mapa-manejo-04-comum.ts), abre a tela, pega a resposta REAL de /api/mapa/operacional que ela recebeu e compara
 * o MAPA com ela: o GeoJSON exato da fonte `lotes` (um registro por feature) e o que o MapLibre DESENHOU nas camadas
 * `lotes-fallback`, `lotes-icone` e `lotes-badge` (texto, imagem, tamanho e cores avaliados por feature).
 *
 * A tela desenha; não decide: centróide, cabeças, identificador e ícone vêm da API. O que a tela decide — e o teste
 * confere como apresentação — é só o corte da sigla em duas letras, o "M+" do misto e o círculo de fallback.
 *
 * O PAINEL DO PASTO (MM4-3*): o clique no marcador (que tem prioridade sobre o polígono por baixo dele) ou no polígono
 * abre um `<aside aria-label="Detalhe de <nome>">` — nunca um modal —, com os valores da MESMA resposta da API. O
 * descanso "sem registro" (nunca ocupada) não vira "0 dias". Em tela estreita o painel é bottom sheet e a legenda sai
 * enquanto ele está aberto: nunca dois por cima do mapa.
 */

test.use(OPCOES_WEBGL);

/** Número como o mapa o escreve (`number-format` pt-BR), formatado pelo MESMO navegador. */
const formatoDoMapa = (page: Page, n: number) => page.evaluate((n) => new Intl.NumberFormat("pt-BR").format(n), n);

/** A propriedade da feature da fonte. */
const prop = (f: FeatureDaFonte | undefined, nome: string) => f?.propriedades[nome];

/** O único ponto da área na fonte `lotes` (premissa: exatamente um). */
async function marcadorDaArea(page: Page, area: AreaSemeada): Promise<FeatureDaFonte> {
  const fs = await marcadoresNaFonte(page, [area.id]);
  expect(fs, `a área ${area.nome} tem UM ponto na fonte lotes`).toHaveLength(1);
  return fs[0]!;
}

test("MM4-1a — 3 áreas ocupadas → 3 marcadores, cada um no centróide que a API deu", async ({ page }) => {
  test.setTimeout(120_000);
  const empresa = await entrarComoAdmin(page);
  const o = regiao("T1", 1);
  const areas = await semearAreas(page, empresa, [
    { rotulo: "1a quadrado", geometria: quadrado(o), lotes: [{ cabecas: 7 }] },
    { rotulo: "1a L", geometria: emL(deslocar(o, 0.007)), lotes: [{ cabecas: 11 }] },
    { rotulo: "1a triangulo", geometria: triangulo(deslocar(o, 0.016)), lotes: [{ cabecas: 5 }] },
    { rotulo: "1a vazia", geometria: quadrado(deslocar(o, 0.023)) }
  ]);
  const [quad, emFormaDeL, tri, vazia] = areas as [AreaSemeada, AreaSemeada, AreaSemeada, AreaSemeada];
  const ocupadas = [quad, emFormaDeL, tri];
  const resposta = await abrirMapaNasAreas(page, areas);

  // premissas da API: três ocupadas, uma vazia, todas com centróide
  for (const a of ocupadas) expect(areaDaResposta(resposta, a.id).ocupada, `premissa: ${a.nome} ocupada`).toBe(true);
  expect(areaDaResposta(resposta, vazia.id).ocupada, "premissa: a quarta área está vazia").toBe(false);
  // premissa da reversa R5: no L, a média dos vértices cai LONGE do centróide de área que a API deu
  const centroL = centroideDaApi(areaDaResposta(resposta, emFormaDeL.id));
  expect(await distanciaEmPx(page, centroL, mediaDosVertices(emFormaDeL.geometria)), "premissa: o L separa centróide de área e média dos vértices").toBeGreaterThan(12);

  // a fonte: UM ponto por área ocupada, nenhum na vazia — 3 marcadores
  const ids = areas.map((a) => a.id);
  await expect.poll(() => marcadoresPorArea(page, ids), { message: "um ponto por área ocupada na fonte lotes" })
    .toEqual({ [quad.id]: 1, [emFormaDeL.id]: 1, [tri.id]: 1, [vazia.id]: 0 });

  for (const a of ocupadas) {
    const c = centroideDaApi(areaDaResposta(resposta, a.id));
    // o ponto da fonte É o centróide da API (passa direto, sem conta na tela). Folga de 1e-7° (~1 cm): absorve só
    // arredondamento; no quadrado e no triângulo qualquer conta dá o mesmo ponto — quem separa as contas é o L
    const f = await marcadorDaArea(page, a);
    expect(f.tipo).toBe("Point");
    const [lon, lat] = f.coordenadas as [number, number];
    expect(Math.abs(lon - c[0]), `${a.nome}: longitude do marcador = a do centróide da API`).toBeLessThan(1e-7);
    expect(Math.abs(lat - c[1]), `${a.nome}: latitude do marcador = a do centróide da API`).toBeLessThan(1e-7);
    // e o mapa DESENHOU o marcador daquela área no pixel do centróide da API
    await expect.poll(async () => (await renderizadas(page, [CAMADAS.lotesIcone], { posicao: c, raioPx: 4 })).some((x) => x.propriedades["area_id"] === a.id),
      { message: `${a.nome}: marcador desenhado no pixel do centróide da API` }).toBe(true);
  }

  // desenhados no caso: exatamente as três ocupadas; a vazia não tem marcador
  const desenhadas = new Set((await renderizadas(page, [CAMADAS.lotesFallback, CAMADAS.lotesIcone, CAMADAS.lotesBadge]))
    .map((x) => String(x.propriedades["area_id"])).filter((id) => ids.includes(id)));
  expect([...desenhadas].sort(), "3 marcadores desenhados, um por área ocupada").toEqual(ocupadas.map((a) => a.id).sort());
});

test("MM4-1b — o contador de cada marcador = soma das cabeças dos lotes daquela área", async ({ page }) => {
  test.setTimeout(120_000);
  const empresa = await entrarComoAdmin(page);
  const o = regiao("T1", 2);
  const areas = await semearAreas(page, empresa, [
    { rotulo: "1b dois lotes", geometria: quadrado(o), lotes: [{ cabecas: 12 }, { cabecas: 30, categoria: "Novilha" }] },
    { rotulo: "1b um lote", geometria: quadrado(deslocar(o, 0.007)), lotes: [{ cabecas: 7 }] },
    { rotulo: "1b milhar", geometria: quadrado(deslocar(o, 0.014)), lotes: [{ cabecas: 1234 }] }
  ]);
  const resposta = await abrirMapaNasAreas(page, areas);

  for (const a of areas) {
    const daApi = areaDaResposta(resposta, a.id);
    // premissas da API: o total é a soma dos lotes que ela mesma devolveu, e bate com o que foi semeado
    expect(daApi.lotes, `premissa: ${a.nome} com os lotes semeados`).toHaveLength(a.lotes.length);
    expect(daApi.cabecas_total, `premissa: cabecas_total = soma de lotes[].cabecas (${a.nome})`).toBe(daApi.lotes.reduce((s, l) => s + l.cabecas, 0));
    expect(daApi.cabecas_total, `premissa: cabecas_total = o rebanho semeado (${a.nome})`).toBe(a.cabecas);

    // a fonte leva o total da API
    await expect.poll(async () => prop((await marcadoresNaFonte(page, [a.id]))[0], "cabecas"), { message: `${a.nome}: cabecas na fonte` }).toBe(daApi.cabecas_total);
    // e o mapa ESCREVEU esse número no marcador (text-field avaliado na camada do ícone)
    const esperado = await formatoDoMapa(page, daApi.cabecas_total);
    await expect.poll(async () => (await renderizadasDaArea(page, a.id, [CAMADAS.lotesIcone])).map((x) => x.texto),
      { message: `${a.nome}: o contador desenhado` }).toEqual([esperado]);
  }
  expect(await formatoDoMapa(page, 1234), "premissa: o milhar sai com separador pt-BR").toBe("1.234");
});

test("MM4-1c — área com 2 lotes → UM marcador, não dois", async ({ page }) => {
  test.setTimeout(120_000);
  const empresa = await entrarComoAdmin(page);
  const o = regiao("T1", 3);
  const areas = await semearAreas(page, empresa, [
    { rotulo: "1c dois lotes", geometria: quadrado(o), lotes: [{ cabecas: 9 }, { cabecas: 4 }] },
    { rotulo: "1c um lote", geometria: quadrado(deslocar(o, 0.007)), lotes: [{ cabecas: 6 }] }
  ]);
  const [dois, um] = areas as [AreaSemeada, AreaSemeada];
  const resposta = await abrirMapaNasAreas(page, areas);
  const daApi = areaDaResposta(resposta, dois.id);
  expect(daApi.lotes, "premissa: a API devolve os DOIS lotes abertos na área").toHaveLength(2);

  // a fonte: um ponto por ÁREA (o GeoJSON exato, sem repetição por tile)
  await expect.poll(() => marcadoresPorArea(page, [dois.id, um.id]), { message: "um ponto por área na fonte lotes" }).toEqual({ [dois.id]: 1, [um.id]: 1 });
  expect(prop(await marcadorDaArea(page, dois), "cabecas"), "o único marcador leva as cabeças somadas pela API").toBe(daApi.cabecas_total);
  // o desenho: um símbolo de marcador por área (camada de símbolo, sem duplicata entre tiles)
  for (const a of areas) {
    await expect.poll(async () => (await renderizadasDaArea(page, a.id, [CAMADAS.lotesIcone])).length, { message: `${a.nome}: um marcador desenhado` }).toBe(1);
  }
});

test("MM4-1d — área sem ícone cadastrado → desenha o fallback, não some do mapa", async ({ page }) => {
  test.setTimeout(120_000);
  const empresa = await entrarComoAdmin(page);
  // Vaca: nenhuma configuração ativa; Boi Magro: configuração SÓ com cor (sem imagem)
  await desativarIcones(page, empresa, "Vaca");
  const soCor = await configurarIcone(page, { empresa, categoria: "Boi Magro", icone_url: null, cor_padrao: "#d97706" });
  const o = regiao("T1", 4);
  const areas = await semearAreas(page, empresa, [
    { rotulo: "1d sem config", geometria: quadrado(o), lotes: [{ cabecas: 8, categoria: "Vaca" }] },
    { rotulo: "1d so cor", geometria: quadrado(deslocar(o, 0.007)), lotes: [{ cabecas: 5, categoria: "Boi Magro" }] }
  ]);
  const [semConfig, comCor] = areas as [AreaSemeada, AreaSemeada];
  const resposta = await abrirMapaNasAreas(page, areas);

  // premissas da API: a capacidade de ícone veio; uma área sem configuração, outra com a configuração só de cor
  expect(resposta.capacidades.icones, "premissa: o admin tem icon_config.view").toBe(true);
  const iconeSem = areaDaResposta(resposta, semConfig.id).icone;
  expect(iconeSem?.config_id ?? "nulo", "premissa: nenhuma configuração casou com VACA").toBe("nulo");
  expect(iconeSem?.categorias).toEqual(["VACA"]);
  const iconeCor = areaDaResposta(resposta, comCor.id).icone;
  expect(iconeCor?.config_id, "premissa: a configuração só de cor casou com BOI MAGRO").toBe(soCor);
  expect(iconeCor?.icone_url ?? null).toBeNull();

  for (const a of areas) {
    await expect.poll(async () => prop((await marcadoresNaFonte(page, [a.id]))[0], "icone_pronto"), { message: `${a.nome}: na fonte, sem imagem pronta` }).toBe(false);
    // o fallback DESENHADO (o círculo) e o contador continuam na tela
    await expect.poll(async () => (await renderizadasDaArea(page, a.id, [CAMADAS.lotesFallback])).length, { message: `${a.nome}: círculo de fallback desenhado` }).toBeGreaterThan(0);
    const icone = await renderizadasDaArea(page, a.id, [CAMADAS.lotesIcone]);
    expect(icone.map((x) => x.texto), `${a.nome}: o contador continua desenhado`).toEqual([await formatoDoMapa(page, areaDaResposta(resposta, a.id).cabecas_total)]);
    expect(icone[0]?.imagem ?? null, `${a.nome}: nenhuma imagem no símbolo`).toBeNull();
  }
  // a cor do círculo: a cor_padrao da configuração que a API devolveu; sem configuração, o verde de acento da casa
  const corDe = async (a: AreaSemeada) => (await renderizadasDaArea(page, a.id, [CAMADAS.lotesFallback]))[0]?.corDoCirculo;
  expect(await corDe(comCor), "fallback na cor_padrao da configuração").toBe(iconeCor?.cor_padrao?.toLowerCase());
  expect(await corDe(semConfig), "fallback sem configuração: o verde de acento (#40de63, globals.css)").toBe("#40de63");

  // ordem z: contorno das áreas → fallback → ícone
  const ordem = await ordemDasCamadas(page);
  expect(ordem.indexOf(CAMADAS.areasContorno), "o contorno das áreas fica abaixo do fallback").toBeLessThan(ordem.indexOf(CAMADAS.lotesFallback));
  expect(ordem.indexOf(CAMADAS.lotesFallback), "o fallback fica ABAIXO da camada do ícone").toBeLessThan(ordem.indexOf(CAMADAS.lotesIcone));
});

test("MM4-1e — icone_url que falha ao carregar → aquela área cai no fallback e as OUTRAS continuam desenhadas", async ({ page }) => {
  test.setTimeout(120_000);
  const empresa = await entrarComoAdmin(page);
  // as imagens: uma que falha (404), uma deitada (92 × 46) e uma em pé (46 × 92) — bytes gerados agora
  const servidor = await servirIcones(page, {
    "/mm4-1e/falha.png": 404,
    "/mm4-1e/deitado.png": pngSolido(92, 46, [37, 99, 235, 255]),
    "/mm4-1e/em-pe.png": pngSolido(46, 92, [217, 119, 6, 255])
  });
  const cfgFalha = await configurarIcone(page, { empresa, categoria: "Bezerra", icone_url: `${ORIGEM_DOS_ICONES}/mm4-1e/falha.png` });
  const cfgDeitado = await configurarIcone(page, { empresa, categoria: "Novilha", icone_url: `${ORIGEM_DOS_ICONES}/mm4-1e/deitado.png` });
  const cfgEmPe = await configurarIcone(page, { empresa, categoria: "Touro", icone_url: `${ORIGEM_DOS_ICONES}/mm4-1e/em-pe.png` });
  const o = regiao("T1", 5);
  const areas = await semearAreas(page, empresa, [
    { rotulo: "1e falha", geometria: quadrado(o), lotes: [{ cabecas: 4, categoria: "Bezerra" }] },
    { rotulo: "1e deitado", geometria: quadrado(deslocar(o, 0.007)), lotes: [{ cabecas: 6, categoria: "Novilha" }] },
    { rotulo: "1e em pe", geometria: quadrado(deslocar(o, 0.014)), lotes: [{ cabecas: 3, categoria: "Touro" }] }
  ]);
  const [falha, deitado, emPe] = areas as [AreaSemeada, AreaSemeada, AreaSemeada];
  const resposta = await abrirMapaNasAreas(page, areas);

  // premissas da API: cada área resolveu a SUA configuração, com a url cadastrada
  for (const [a, cfg] of [[falha, cfgFalha], [deitado, cfgDeitado], [emPe, cfgEmPe]] as const) {
    expect(areaDaResposta(resposta, a.id).icone?.config_id, `premissa: ${a.nome} resolveu a configuração dela`).toBe(cfg);
  }

  // as que carregaram: imagem registrada com o id da configuração e o marcador apontando para ela
  for (const [a, cfg] of [[deitado, cfgDeitado], [emPe, cfgEmPe]] as const) {
    await expect.poll(() => temImagem(page, cfg), { message: `${a.nome}: imagem registrada (hasImage)` }).toBe(true);
    await expect.poll(async () => prop((await marcadoresNaFonte(page, [a.id]))[0], "icone_pronto"), { message: `${a.nome}: icone_pronto na fonte` }).toBe(true);
    await expect.poll(async () => (await renderizadasDaArea(page, a.id, [CAMADAS.lotesIcone])).map((x) => x.imagem), { message: `${a.nome}: o símbolo desenha a imagem da configuração` }).toEqual([cfg]);
    expect(await renderizadasDaArea(page, a.id, [CAMADAS.lotesFallback]), `${a.nome}: sem círculo de fallback`).toEqual([]);
  }
  // a que falhou: sem imagem, no fallback — e o mapa seguiu (as outras acima foram desenhadas)
  expect(servidor.pedidos(), "a imagem que falha foi pedida de fato").toContain("/mm4-1e/falha.png");
  expect(await temImagem(page, cfgFalha), "a imagem que falhou não foi registrada").toBe(false);
  expect(prop(await marcadorDaArea(page, falha), "icone_pronto"), "a área da imagem que falhou: sem imagem pronta").toBe(false);
  await expect.poll(async () => (await renderizadasDaArea(page, falha.id, [CAMADAS.lotesFallback])).length, { message: "a área da imagem que falhou cai no círculo de fallback" }).toBeGreaterThan(0);
  expect((await renderizadasDaArea(page, falha.id, [CAMADAS.lotesIcone])).map((x) => x.imagem), "e o símbolo dela fica sem imagem (só o contador)").toEqual([null]);

  // proporção: a escala é UMA (1 ÷ maior lado medido na imagem) e o formato vem da imagem real
  const deitadoNaFonte = await marcadorDaArea(page, deitado);
  const emPeNaFonte = await marcadorDaArea(page, emPe);
  expect(prop(deitadoNaFonte, "escala"), "92 × 46: escala = 1 ÷ 92").toBeCloseTo(1 / 92, 10);
  expect(prop(emPeNaFonte, "escala"), "46 × 92: escala = 1 ÷ 92").toBeCloseTo(1 / 92, 10);
  expect(prop(deitadoNaFonte, "aspecto"), "deitada: (46 − 92) ÷ 92").toBeCloseTo(-0.5, 10);
  expect(prop(emPeNaFonte, "aspecto"), "em pé: (92 − 46) ÷ 92").toBeCloseTo(0.5, 10);
  const tamanho = (await renderizadasDaArea(page, deitado.id, [CAMADAS.lotesIcone]))[0]?.tamanhoDoIcone ?? 0;
  expect(tamanho * 92, "o maior lado exibido fica entre o piso (20 px) e o alvo (46 px)").toBeGreaterThanOrEqual(20 - 1e-6);
  expect(tamanho * 92).toBeLessThanOrEqual(46 + 1e-6);
});

test("MM4-2a — badge com a sigla cortada em 2 letras; sem identificador, sem badge", async ({ page }) => {
  test.setTimeout(120_000);
  const empresa = await entrarComoAdmin(page);
  const o = regiao("T1", 6);
  const areas = await semearAreas(page, empresa, [
    { rotulo: "2a com sigla", geometria: quadrado(o), lotes: [{ cabecas: 10, identificador: { nome: "Alfa Bravo", sigla: "ABCD", cor: "#aa3300" } }] },
    { rotulo: "2a sem identificador", geometria: quadrado(deslocar(o, 0.007)), lotes: [{ cabecas: 4 }] }
  ]);
  const [comSigla, sem] = areas as [AreaSemeada, AreaSemeada];
  const resposta = await abrirMapaNasAreas(page, areas);

  // premissas da API: a sigla vem INTEIRA (o corte é da tela); sem lote identificado, identificador nulo
  const ident = areaDaResposta(resposta, comSigla.id).identificador;
  expect(ident, "premissa: o identificador resolvido pela API").toEqual({ misto: false, cor: "#aa3300", sigla: "ABCD", nome: "Alfa Bravo" });
  expect(areaDaResposta(resposta, sem.id).identificador, "premissa: sem lote identificado, identificador nulo").toBeNull();
  const siglaDaApi = ident && !ident.misto ? ident.sigla : "";
  const corte = Array.from(siglaDaApi).slice(0, 2).join("");
  expect(corte, "premissa: o corte em 2 letras muda a sigla da API").not.toBe(siglaDaApi);

  // com identificador: UM badge desenhado, com a sigla cortada e a cor do identificador
  await expect.poll(async () => (await renderizadasDaArea(page, comSigla.id, [CAMADAS.lotesBadge])).map((x) => x.texto), { message: "o badge escreve a sigla cortada" }).toEqual([corte]);
  expect(corte).toBe("AB");
  const badge = (await renderizadasDaArea(page, comSigla.id, [CAMADAS.lotesBadge]))[0];
  expect(badge?.corDoIcone, "o fundo do badge na cor do identificador").toBe(ident && !ident.misto ? ident.cor.toLowerCase() : "?");
  expect(prop(await marcadorDaArea(page, comSigla), "identificador_sigla"), "na fonte, a sigla já cortada").toBe(corte);

  // sem identificador: o marcador existe, o badge não
  const semNaFonte = await marcadorDaArea(page, sem);
  expect(prop(semNaFonte, "tem_identificador"), "na fonte, sem identificador").toBe(false);
  await expect.poll(async () => (await renderizadasDaArea(page, sem.id, [CAMADAS.lotesIcone])).length, { message: "o marcador da área sem identificador está desenhado" }).toBe(1);
  expect(await renderizadasDaArea(page, sem.id, [CAMADAS.lotesBadge]), "e nenhum badge para ela").toEqual([]);

  // ordem z: o badge fica ACIMA da camada do ícone
  const ordem = await ordemDasCamadas(page);
  expect(ordem.indexOf(CAMADAS.lotesIcone), "o badge fica acima do ícone").toBeLessThan(ordem.indexOf(CAMADAS.lotesBadge));
});

test("MM4-2b — dois identificadores distintos na área → badge de MISTO", async ({ page }) => {
  test.setTimeout(120_000);
  const empresa = await entrarComoAdmin(page);
  const o = regiao("T1", 7);
  const areas = await semearAreas(page, empresa, [
    { rotulo: "2b misto", geometria: quadrado(o), lotes: [
      { cabecas: 5, identificador: { sigla: "AA", cor: "#111111" } },
      { cabecas: 6, identificador: { sigla: "BB", cor: "#222222" } }
    ] },
    { rotulo: "2b mesmo identificador", geometria: quadrado(deslocar(o, 0.007)), lotes: [
      { cabecas: 3, identificador: { nome: "Charlie", sigla: "CC", cor: "#333333" } },
      { cabecas: 2, identificador: { nome: "Charlie", sigla: "CC", cor: "#333333" } }
    ] }
  ]);
  const [misto, mesmo] = areas as [AreaSemeada, AreaSemeada];
  const resposta = await abrirMapaNasAreas(page, areas);

  // premissas da API: identificadores diferentes → misto (sem cor nem sigla); iguais → um só
  expect(areaDaResposta(resposta, misto.id).identificador, "premissa: dois identificadores distintos = misto").toEqual({ misto: true });
  expect(areaDaResposta(resposta, mesmo.id).identificador, "premissa: o mesmo identificador nos dois lotes = um só").toEqual({ misto: false, cor: "#333333", sigla: "CC", nome: "Charlie" });

  // o badge do misto
  await expect.poll(async () => (await renderizadasDaArea(page, misto.id, [CAMADAS.lotesBadge])).map((x) => x.texto), { message: "o badge do misto" }).toEqual(["M+"]);
  const noMisto = await marcadorDaArea(page, misto);
  expect(prop(noMisto, "identificador_misto"), "na fonte, marcado como misto").toBe(true);
  const corDoMisto = (await renderizadasDaArea(page, misto.id, [CAMADAS.lotesBadge]))[0]?.corDoIcone;
  expect(["#111111", "#222222"], "o misto não pinta a cor de nenhum dos lotes").not.toContain(corDoMisto);

  // a área com o mesmo identificador nos dois lotes: badge normal, sem misto
  await expect.poll(async () => (await renderizadasDaArea(page, mesmo.id, [CAMADAS.lotesBadge])).map((x) => x.texto), { message: "o badge do identificador comum" }).toEqual(["CC"]);
  expect(prop(await marcadorDaArea(page, mesmo), "identificador_misto")).toBe(false);
  // nenhuma das duas virou dois marcadores
  expect((await dadosDaFonte(page, "lotes")).filter((f) => [misto.id, mesmo.id].includes(String(f.propriedades["area_id"]))), "um ponto por área").toHaveLength(2);
});

// ------------------------------------------------------------------------------------------------------------------
// O PAINEL DO PASTO
// ------------------------------------------------------------------------------------------------------------------

/** Nenhum modal na página: nem papel de diálogo, nem `aria-modal`. */
async function semModal(page: Page, motivo: string) {
  await expect(page.locator("[role=dialog], [role=alertdialog], [aria-modal=true]"), `${motivo}: nenhum diálogo ou modal aberto`).toHaveCount(0);
}

/** Os `<aside>` dentro da tela do mapa (o painel do pasto é o único possível). */
const asidesDoMapa = (page: Page) => page.getByTestId("mapa-de-manejo").locator("aside");

/** "N dias" / "1 dia" — o número é o que a API mandou, no formato pt-BR do navegador. */
async function textoDeDiasEsperado(page: Page, dias: number) {
  return `${await formatoPtBr(page, dias, 0)} ${dias === 1 ? "dia" : "dias"}`;
}

test("MM4-3a — clique no marcador → painel com aria-label \"Detalhe de <nome>\", e é um <aside>, não um modal", async ({ page }) => {
  test.setTimeout(120_000);
  const empresa = await entrarComoAdmin(page);
  await desativarIcones(page, empresa, "Matriz"); // o marcador de A é o círculo de fallback, de raio conhecido
  const o = regiao("T1", 8);
  const LARGURA_A = 0.0002;
  // A: faixa estreita e ocupada; B: vizinha colada à direita, vazia — o marcador de A transborda sobre o polígono de B
  const areas = await semearAreas(page, empresa, [
    { rotulo: "3a estreita", geometria: retangulo(o, LARGURA_A, 0.004), lotes: [{ cabecas: 8, categoria: "Matriz" }] },
    { rotulo: "3a vizinha", geometria: quadrado(deslocar(o, LARGURA_A)) }
  ]);
  const [a, b] = areas as [AreaSemeada, AreaSemeada];
  const resposta = await abrirMapaNasAreas(page, areas);
  const apiA = areaDaResposta(resposta, a.id);
  const apiB = areaDaResposta(resposta, b.id);
  await semModal(page, "antes do clique");
  await expect(painelDoPasto(page), "antes do clique, nenhum painel").toHaveCount(0);

  // o ponto do clique: 4 px à direita da borda de A, na altura do marcador — DENTRO do polígono de B e ao alcance do
  // marcador de A (círculo de 18 px de raio do zoom 15 em diante)
  const cA = centroideDaApi(apiA);
  expect(await zoomDoMapa(page), "premissa: zoom de trabalho (círculo de 18 px)").toBeGreaterThanOrEqual(15);
  const pMarcador = await projetar(page, cA);
  const pBorda = await projetar(page, [o[0] + LARGURA_A, cA[1]]);
  const pClique = { x: pBorda.x + 4, y: pMarcador.y };
  expect(pClique.x - pMarcador.x, "premissa: o clique fica dentro do círculo do marcador de A").toBeLessThan(16);
  const posClique = await desprojetar(page, pClique);
  await expect.poll(async () => (await renderizadasDaArea(page, a.id, [CAMADAS.lotesFallback])).length, { message: "premissa: o marcador de A está desenhado" }).toBeGreaterThan(0);
  expect([...new Set((await renderizadas(page, [CAMADAS.areasFill], { posicao: posClique, raioPx: 0.5 })).map((f) => f.propriedades["id"]))],
    "premissa: o polígono sob o clique é o de B").toEqual([b.id]);
  expect((await renderizadas(page, [CAMADAS.lotesFallback], { posicao: posClique, raioPx: 6 })).map((f) => f.propriedades["area_id"]),
    "premissa: o marcador de A está ao alcance do toque").toContain(a.id);

  await clicarNoMapa(page, posClique);
  // o MARCADOR venceu o polígono por baixo: o painel é o de A
  const painel = page.getByRole("complementary", { name: `Detalhe de ${apiA.name}` });
  await expect(painel, "o painel de A, pelo nome acessível").toBeVisible();
  await expect(painelDoPasto(page)).toHaveAttribute("data-area-id", a.id);
  expect(await painelDoPasto(page).evaluate((el) => el.tagName), "é um <aside>").toBe("ASIDE");
  await expect(painelDoPasto(page)).toHaveAttribute("aria-label", `Detalhe de ${apiA.name}`);
  await expect(painelDoPasto(page), "não é modal").not.toHaveAttribute("aria-modal", /.*/);
  await expect(painelDoPasto(page), "não tem papel de diálogo").not.toHaveAttribute("role", /.*/);
  await semModal(page, "com o painel aberto");
  await expect(asidesDoMapa(page), "um único painel").toHaveCount(1);
  await expect(page.getByTestId("painel-nome")).toHaveText(apiA.name);
  await expect(page.getByTestId("painel-abrir-cadastro"), "o link para a ficha da área").toHaveAttribute("href", `/cadastros/areas/${a.id}`);
  // forma lateral (lg): 320 px de largura, ao lado do mapa — o mapa continua clicável
  const caixa = await painelDoPasto(page).boundingBox();
  expect(caixa?.width ?? 0, "painel lateral de 320 px em tela larga").toBeCloseTo(320, 0);

  // fechar → nenhum painel; clique no INTERIOR de B (longe do marcador de A) → o painel de B, pelo polígono
  await page.getByTestId("painel-fechar").click();
  await expect(painelDoPasto(page), "o Fechar tira o painel").toHaveCount(0);
  await clicarNoMapa(page, centroideDaApi(apiB));
  await expect(page.getByRole("complementary", { name: `Detalhe de ${apiB.name}` }), "o clique no polígono de B abre o painel de B").toBeVisible();
  await expect(asidesDoMapa(page)).toHaveCount(1);
});

test("MM4-3b — o painel traz cabeças, UA/ha, dias no piquete e a faixa, com os MESMOS valores que a API devolveu", async ({ page }) => {
  test.setTimeout(120_000);
  const empresa = await entrarComoAdmin(page);
  const o = regiao("T1", 9);
  // 40 Boi Gordo (1 UA) + 30 Garrote (0,5 UA) em 45 ha úteis: lotação de faixa com número
  const areas = await semearAreas(page, empresa, [
    { rotulo: "3b lotada", geometria: quadrado(o), lotes: [
      { cabecas: 40, categoria: "Boi Gordo", entrada: diaDoBanco(-12) },
      { cabecas: 30, categoria: "Garrote", entrada: diaDoBanco(-5) }
    ] }
  ]);
  const [c] = areas as [AreaSemeada];
  await abrirMapaNasAreas(page, areas);
  const resposta = await escolherColoracao(page, "lotacao_ua_ha");
  const api: AreaDaApi = areaDaResposta(resposta, c.id);
  // premissas da API
  expect(api.faixa, "premissa: a faixa de lotação veio").not.toBeNull();
  expect(api.faixa?.unidade).toBe("ua_ha");
  expect(api.ua_por_hectare, "premissa: UA/ha calculada pela API").not.toBeNull();
  expect(api.lotes, "premissa: os dois lotes").toHaveLength(2);
  expect(new Set(api.lotes.map((l) => l.dias_de_ocupacao)).size, "premissa: dias no piquete diferentes por lote").toBe(2);

  await clicarNoMapa(page, centroideDaApi(api));
  await expect(page.getByRole("complementary", { name: `Detalhe de ${api.name}` })).toBeVisible();
  await expect(page.getByTestId("painel-cabecas"), "cabeças = cabecas_total da API").toHaveText(await formatoPtBr(page, api.cabecas_total, 0));
  await expect(page.getByTestId("painel-ua-ha"), "UA/ha = ua_por_hectare da API").toHaveText(await formatoPtBr(page, api.ua_por_hectare ?? "", 2));
  await expect(page.getByTestId("painel-faixa"), "a faixa da API").toHaveAttribute("data-faixa", api.faixa?.chave ?? "?");
  await expect(page.getByTestId("painel-faixa"), "o rótulo da faixa, em texto").toContainText(api.faixa?.rotulo ?? "?");
  await expect(page.getByTestId("painel-faixa-numero"), "o número da faixa, com a unidade").toHaveText(`· ${await formatoPtBr(page, api.faixa?.numero ?? "", 2)} UA/ha`);
  await expect(page.getByTestId("painel-lote"), "um item por lote da API").toHaveCount(api.lotes.length);
  for (const l of api.lotes) {
    const item = page.locator(`[data-testid="painel-lote"][data-lote-id="${l.lote.id}"]`);
    await expect(item.getByTestId("painel-lote-dias"), `dias no piquete do lote ${l.lote.code}`).toHaveText(`${await textoDeDiasEsperado(page, l.dias_de_ocupacao)} no piquete`);
    await expect(item.getByTestId("painel-lote-cabecas"), `cabeças do lote ${l.lote.code}`).toHaveText(`${await formatoPtBr(page, l.cabecas, 0)} ${l.cabecas === 1 ? "cabeça" : "cabeças"}`);
  }
});

test("MM4-3c — clique em área VAZIA → painel com dias de descanso", async ({ page }) => {
  test.setTimeout(120_000);
  const empresa = await entrarComoAdmin(page);
  const o = regiao("T1", 10);
  const areas = await semearAreas(page, empresa, [
    { rotulo: "3c em descanso", geometria: quadrado(o) },
    { rotulo: "3c ocupada", geometria: quadrado(deslocar(o, 0.007)), lotes: [{ cabecas: 9 }] }
  ]);
  const [vazia] = areas as [AreaSemeada, AreaSemeada];
  await descansarArea(page, { empresa, area: vazia.id, dias: 21 });
  const resposta = await abrirMapaNasAreas(page, areas);
  const api = areaDaResposta(resposta, vazia.id);
  expect(api.ocupada, "premissa: a área está vazia").toBe(false);
  expect(api.dias_de_descanso, "premissa: a API diz 21 dias de descanso").toBe(21);
  const cV = centroideDaApi(api);
  expect(await renderizadas(page, [CAMADAS.lotesFallback, CAMADAS.lotesIcone, CAMADAS.lotesBadge], { posicao: cV, raioPx: 8 }), "premissa: nenhum marcador sob o clique").toEqual([]);

  await clicarNoMapa(page, cV);
  await expect(page.getByRole("complementary", { name: `Detalhe de ${api.name}` }), "o MESMO painel, pelo polígono").toBeVisible();
  await expect(page.getByTestId("painel-dias-descanso"), "dias de descanso = os da API").toHaveText(await textoDeDiasEsperado(page, api.dias_de_descanso ?? -1));
  await expect(page.getByTestId("painel-ultima-saida"), "a última saída da API").toHaveText(String(api["ultima_saida"]).replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, "$3/$2/$1"));
  await expect(page.getByTestId("painel-lotacao"), "vazia: sem bloco de lotação").toHaveCount(0);
  await expect(page.getByTestId("painel-lote"), "vazia: nenhum lote").toHaveCount(0);
});

test("MM4-3d — área nunca ocupada → o painel diz \"sem registro\", NÃO \"0 dias\"", async ({ page }) => {
  test.setTimeout(120_000);
  const empresa = await entrarComoAdmin(page);
  const o = regiao("T1", 11);
  const areas = await semearAreas(page, empresa, [
    { rotulo: "3d nunca ocupada", geometria: quadrado(o) },
    { rotulo: "3d saiu hoje", geometria: quadrado(deslocar(o, 0.007)) }
  ]);
  const [nunca, hoje] = areas as [AreaSemeada, AreaSemeada];
  await descansarArea(page, { empresa, area: hoje.id, dias: 0 });
  const resposta = await abrirMapaNasAreas(page, areas);
  const apiNunca = areaDaResposta(resposta, nunca.id);
  const apiHoje = areaDaResposta(resposta, hoje.id);
  // premissas da API: nunca ocupada = sem registro (nulo); a que saiu hoje = 0 dias — a distinção é da API
  expect([apiNunca.ocupada, apiNunca.dias_de_descanso, apiNunca["ultima_saida"]], "premissa: nunca ocupada, sem saída").toEqual([false, null, null]);
  expect(apiHoje.dias_de_descanso, "premissa: a que saiu hoje tem 0 dias de descanso").toBe(0);

  await clicarNoMapa(page, centroideDaApi(apiNunca));
  await expect(page.getByRole("complementary", { name: `Detalhe de ${apiNunca.name}` })).toBeVisible();
  await expect(page.getByTestId("painel-dias-descanso"), "nunca ocupada: sem registro").toHaveText("Sem registro de ocupação");
  await expect(painelDoPasto(page), "e em lugar nenhum do painel \"0 dias\"").not.toContainText(/\b0 dias?\b/);
  await expect(page.getByTestId("painel-ultima-saida"), "sem saída, sem data").toHaveCount(0);

  // a outra vazia, com saída hoje: "0 dias" — o painel respeita a diferença
  await clicarNoMapa(page, centroideDaApi(apiHoje));
  await expect(page.getByRole("complementary", { name: `Detalhe de ${apiHoje.name}` })).toBeVisible();
  await expect(page.getByTestId("painel-dias-descanso"), "saída hoje: 0 dias").toHaveText(await textoDeDiasEsperado(page, 0));
});

test("MM4-3e — nunca dois overlays abertos ao mesmo tempo", async ({ page }) => {
  test.setTimeout(150_000);
  const empresa = await entrarComoAdmin(page);
  const o = regiao("T1", 12);
  const areas = await semearAreas(page, empresa, [
    { rotulo: "3e ocupada", geometria: quadrado(o), lotes: [{ cabecas: 10 }] },
    { rotulo: "3e em descanso", geometria: quadrado(deslocar(o, 0.007)) }
  ]);
  const [ocupada, descanso] = areas as [AreaSemeada, AreaSemeada];
  await descansarArea(page, { empresa, area: descanso.id, dias: 21 });
  await abrirMapaNasAreas(page, areas);
  const resposta = await escolherColoracao(page, "situacao_pasto");
  const apiO = areaDaResposta(resposta, ocupada.id);
  const apiD = areaDaResposta(resposta, descanso.id);
  expect(apiO.faixa?.chave, "premissa: faixas diferentes nas duas áreas").not.toBe(apiD.faixa?.chave);
  const legenda = page.getByTestId("legenda-do-mapa");
  await expect(legenda, "coloração por faixa: a legenda aparece").toBeVisible();
  const painel = painelDoPasto(page);

  // filtro de faixa na legenda (a faixa da ocupada): a outra área fica atenuada
  const opacidade = async (id: string) => Number((await dadosDaFonte(page, "areas")).find((f) => f.propriedades["id"] === id)?.propriedades["opacidade_fill"]);
  await page.getByTestId(`legenda-faixa-${apiO.faixa?.chave}`).click();
  await expect.poll(async () => (await opacidade(descanso.id)) < (await opacidade(ocupada.id)), { message: "com o filtro, a área da outra faixa fica atenuada" }).toBe(true);

  // tela larga: o painel é LATERAL (ao lado do mapa) — abrir pelo marcador e trocar pela outra área nunca abre um segundo
  await clicarNoMapa(page, centroideDaApi(apiO));
  await expect(page.getByRole("complementary", { name: `Detalhe de ${apiO.name}` })).toBeVisible();
  await expect(asidesDoMapa(page), "um único painel").toHaveCount(1);
  await semModal(page, "painel aberto");
  await clicarNoMapa(page, centroideDaApi(apiD));
  await expect(page.getByRole("complementary", { name: `Detalhe de ${apiD.name}` }), "o clique na outra área TROCA o painel").toBeVisible();
  await expect(asidesDoMapa(page), "continua um único painel").toHaveCount(1);
  await semModal(page, "painel trocado");

  // tela estreita (390 × 844), com o painel aberto: ele vira bottom sheet POR CIMA do mapa e a legenda SAI
  await page.setViewportSize({ width: 390, height: 844 });
  const moldura = page.getByTestId("painel-do-pasto-moldura");
  await expect.poll(() => moldura.evaluate((el) => getComputedStyle(el).position), { message: "bottom sheet: moldura absoluta sobre o mapa" }).toBe("absolute");
  await expect(legenda, "em tela estreita, com o painel aberto, a legenda some").toBeHidden();
  await expect(asidesDoMapa(page), "um único painel").toHaveCount(1);
  await semModal(page, "bottom sheet");
  // a folha: na base da caixa do mapa (margem de 8 px), na largura dela, com a altura limitada a min(45dvh, 22rem)
  const caixa = await moldura.evaluate((el: HTMLElement) => {
    const r = (el.offsetParent ?? el.parentElement ?? el).getBoundingClientRect();
    return { y: r.top, largura: r.width, altura: r.height };
  });
  const folha = await painel.boundingBox();
  expect(folha, "o painel tem caixa").not.toBeNull();
  expect(Math.abs((folha!.y + folha!.height) - (caixa.y + caixa.altura - 8)), "encostado na base da caixa do mapa").toBeLessThanOrEqual(1);
  expect(Math.abs(folha!.width - (caixa.largura - 16)), "na largura da caixa do mapa menos as margens").toBeLessThanOrEqual(1);
  expect(folha!.height, "altura limitada a min(45dvh, 22rem)").toBeLessThanOrEqual(Math.min(844 * 0.45, 352) + 1);
  const fechar = await page.getByTestId("painel-fechar").boundingBox();
  expect(fechar?.height ?? 0, "o botão Fechar detalhe tem alvo de toque de 44 px").toBeGreaterThanOrEqual(44);
  expect(fechar?.width ?? 0, "e 44 px de largura").toBeGreaterThanOrEqual(44);

  // ESC em cascata: 1º tira o filtro de faixa (o painel fica); 2º fecha o painel (a legenda volta); 3º não faz nada
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await opacidade(descanso.id)) === (await opacidade(ocupada.id)), { message: "1º ESC: o filtro de faixa saiu" }).toBe(true);
  await expect(painel, "1º ESC: o painel continua").toBeVisible();
  await page.keyboard.press("Escape");
  await expect(painel, "2º ESC: o painel fecha").toHaveCount(0);
  await expect(legenda, "sem painel, a legenda volta").toBeVisible();
  await expect(page.getByTestId(`legenda-faixa-${apiO.faixa?.chave}`), "e sem filtro").toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");
  await expect(legenda, "3º ESC: nada muda").toBeVisible();
  await expect(painel).toHaveCount(0);
  await expect(asidesDoMapa(page)).toHaveCount(0);
});
