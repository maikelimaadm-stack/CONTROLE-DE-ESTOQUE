import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { FalhaCopernicus } from "../../src/lib/satelite/copernicus.js";
import { EVALSCRIPT_NDVI, escolherObservacao, montarCorpoEstatistica, type EstatisticaLida, type IntervaloEstatistico } from "../../src/lib/satelite/ndvi.js";
import { EVALSCRIPT_NDVI_SHA256, RESOLUCAO_NATIVA_NDVI_M, escolherObservacaoV2, janelaDoItem } from "../../src/lib/satelite/ndvi-v2.js";

/**
 * SAT-03 (decisão 296) — o método NDVI da consulta em lote, puro. Prova: a janela INCLUSIVA do item vira a janela de
 * FIM EXCLUSIVO da análise e do provedor (as duas pontas, virada de mês, de ano e o 29 de fevereiro); a escolha por data
 * alvo (a útil mais perto; empate → a mais recente) e sem data alvo (a v1, idêntica); o dia com erro do provedor que
 * poderia ganhar da escolha → `processamento_parcial`; o sha256 do evalscript é o do evalscript que vai no corpo.
 */

const DIA = 86_400_000;
const PIXELS = 11_860;
const UTIL = { amostra: 13_000, semDado: 2_000, validos: 11_000, media: 0.72, minimo: 0.31, maximo: 0.88, desvio: 0.09 };
const NUBLADO = { amostra: 13_000, semDado: 12_000, validos: 1_000, media: 0.3, minimo: 0.1, maximo: 0.5, desvio: 0.1 };
const MASCARADO = { amostra: 13_000, semDado: 13_000, validos: 0, media: null, minimo: null, maximo: null, desvio: null };

/** O intervalo P1D do dia 'YYYY-MM-DD' com a estatística dada (valores distintos por dia, para ver QUAL foi escolhido). */
function dia(iso: string, stats: Omit<IntervaloEstatistico, "inicio" | "fim">, media?: number): IntervaloEstatistico {
  const inicio = new Date(`${iso}T00:00:00Z`);
  return { inicio, fim: new Date(inicio.getTime() + DIA), ...stats, ...(media === undefined ? {} : { media }) };
}
const lida = (intervalos: IntervaloEstatistico[], errosEm: (Date | null)[] = []): EstatisticaLida => ({ intervalos, errosEm, statusProvedor: "OK" });
const erroEm = (iso: string) => new Date(`${iso}T00:00:00Z`);
const escolhido = (r: ReturnType<typeof escolherObservacaoV2>) => (r.situacao === "concluida" ? r.observacao.inicio.toISOString().slice(0, 10) : null);
function falha(fn: () => unknown): FalhaCopernicus {
  try { fn(); } catch (e) { if (e instanceof FalhaCopernicus) return e; throw e; }
  throw new Error("esperava FalhaCopernicus");
}

describe("SAT-03 · janela do item → janela da análise (fim exclusivo)", () => {
  it("o início é a meia-noite UTC do primeiro dia e o fim é a meia-noite UTC do dia SEGUINTE ao último", () => {
    const j = janelaDoItem({ janela_inicio: "2026-01-01", janela_fim: "2026-01-31" });
    expect(j.inicio.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(j.fim.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("as DUAS pontas: o início não anda (nem um dia para trás, nem para frente) e o fim inclui o último dia inteiro", () => {
    const j = janelaDoItem({ janela_inicio: "2026-08-10", janela_fim: "2026-08-20" });
    expect(j.inicio.getTime()).toBe(Date.parse("2026-08-10T00:00:00Z"));
    // O último dia do item (20) cabe inteiro: o intervalo P1D dele termina exatamente no fim da janela.
    expect(j.fim.getTime()).toBe(Date.parse("2026-08-20T00:00:00Z") + DIA);
    expect((j.fim.getTime() - j.inicio.getTime()) / DIA).toBe(11);
  });

  it("janela de UM dia (início = fim no item) dura um dia", () => {
    const j = janelaDoItem({ janela_inicio: "2026-03-15", janela_fim: "2026-03-15" });
    expect([j.inicio.toISOString(), j.fim.toISOString()]).toEqual(["2026-03-15T00:00:00.000Z", "2026-03-16T00:00:00.000Z"]);
  });

  it("virada de mês, de ano e o 29 de fevereiro", () => {
    expect(janelaDoItem({ janela_inicio: "2026-04-21", janela_fim: "2026-04-30" }).fim.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(janelaDoItem({ janela_inicio: "2025-12-21", janela_fim: "2025-12-31" }).fim.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(janelaDoItem({ janela_inicio: "2026-02-01", janela_fim: "2026-02-28" }).fim.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(janelaDoItem({ janela_inicio: "2024-02-29", janela_fim: "2024-02-29" }).fim.toISOString()).toBe("2024-03-01T00:00:00.000Z");
  });

  it("dia fora do formato ou fora do calendário, e fim antes do início, LANÇAM (defeito, nunca janela inventada)", () => {
    for (const [ini, fim] of [["2026-02-30", "2026-03-01"], ["2026-1-01", "2026-01-31"], ["", "2026-01-31"], ["2026-01-01", "2026-01-01T00:00:00Z"], ["2026-01-10", "2026-01-09"]]) {
      expect(() => janelaDoItem({ janela_inicio: ini!, janela_fim: fim! }), `${ini}..${fim}`).toThrow(RangeError);
    }
  });
});

describe("SAT-03 · escolha da observação (v2)", () => {
  it("SEM data alvo é a v1, idêntica — inclusive nos erros", () => {
    const casos: EstatisticaLida[] = [
      lida([dia("2026-08-01", UTIL, 0.5), dia("2026-08-07", UTIL, 0.6), dia("2026-08-09", NUBLADO)]),
      lida([dia("2026-08-01", NUBLADO), dia("2026-08-02", MASCARADO)]),
      lida([]),
      lida([dia("2026-08-01", UTIL)], [erroEm("2026-07-30")])
    ];
    for (const c of casos) expect(escolherObservacaoV2(c, PIXELS, null)).toEqual(escolherObservacao(c, PIXELS));
    const comErroDecisivo = lida([dia("2026-08-01", UTIL)], [erroEm("2026-08-03")]);
    expect(falha(() => escolherObservacaoV2(comErroDecisivo, PIXELS, null)).tipo).toBe("processamento_parcial");
    expect(falha(() => escolherObservacao(comErroDecisivo, PIXELS)).tipo).toBe("processamento_parcial");
  });

  it("COM data alvo: a útil MAIS PERTO do dia alvo, mesmo que não seja a mais recente", () => {
    const l = lida([dia("2026-08-13", UTIL, 0.61), dia("2026-08-20", UTIL, 0.62), dia("2026-08-15", NUBLADO)]);
    const r = escolherObservacaoV2(l, PIXELS, "2026-08-15");
    expect(escolhido(r)).toBe("2026-08-13");
    expect(r.situacao === "concluida" && r.valores.medio).toBe("0.6100");
    // A v1 (mais recente) escolheria outra — a diferença é a regra nova, não acaso.
    expect(escolhido(escolherObservacao(l, PIXELS))).toBe("2026-08-20");
  });

  it("o dia alvo útil ganha de todos; dia alvo nublado não conta (o critério útil é o da v1)", () => {
    expect(escolhido(escolherObservacaoV2(lida([dia("2026-08-14", UTIL), dia("2026-08-15", UTIL), dia("2026-08-16", UTIL)]), PIXELS, "2026-08-15"))).toBe("2026-08-15");
    expect(escolhido(escolherObservacaoV2(lida([dia("2026-08-15", NUBLADO), dia("2026-08-17", UTIL)]), PIXELS, "2026-08-15"))).toBe("2026-08-17");
  });

  it("EMPATE de distância → a mais recente", () => {
    const r = escolherObservacaoV2(lida([dia("2026-08-13", UTIL, 0.4), dia("2026-08-17", UTIL, 0.7)]), PIXELS, "2026-08-15");
    expect(escolhido(r)).toBe("2026-08-17");
  });

  it("sem útil: o motivo da v1 (cobertura insuficiente / sem aquisição), sem número", () => {
    const nublado = escolherObservacaoV2(lida([dia("2026-08-15", NUBLADO), dia("2026-08-16", MASCARADO)]), PIXELS, "2026-08-15");
    expect(nublado).toMatchObject({ situacao: "sem_observacao_util", motivo: "cobertura_insuficiente", pixelsGeometria: PIXELS });
    expect(escolherObservacaoV2(lida([]), PIXELS, "2026-08-15")).toMatchObject({ situacao: "sem_observacao_util", motivo: "sem_aquisicao" });
  });

  it("dia com ERRO que poderia ganhar da escolha → processamento_parcial; o que não poderia, não atrapalha", () => {
    const uteis = [dia("2026-08-13", UTIL), dia("2026-08-20", UTIL)];
    // escolhida = 13 (distância 2). Erro a 1 dia (mais perto) decide.
    expect(falha(() => escolherObservacaoV2(lida(uteis, [erroEm("2026-08-16")]), PIXELS, "2026-08-15")).tipo).toBe("processamento_parcial");
    // Erro à MESMA distância e mais recente (17 vs 13): no empate ganharia — decide.
    expect(falha(() => escolherObservacaoV2(lida(uteis, [erroEm("2026-08-17")]), PIXELS, "2026-08-15")).tipo).toBe("processamento_parcial");
    // Erro sem intervalo legível: não dá para dizer que não ganharia — decide.
    expect(falha(() => escolherObservacaoV2(lida(uteis, [null]), PIXELS, "2026-08-15")).tipo).toBe("processamento_parcial");
    // Qualquer erro quando nada serviu — decide.
    expect(falha(() => escolherObservacaoV2(lida([dia("2026-08-15", NUBLADO)], [erroEm("2026-08-01")]), PIXELS, "2026-08-15")).tipo).toBe("processamento_parcial");
    // Erro mais LONGE (19, distância 4) ou à mesma distância e mais ANTIGO (escolhida 17, erro 13): a escolha vale.
    expect(escolhido(escolherObservacaoV2(lida(uteis, [erroEm("2026-08-19")]), PIXELS, "2026-08-15"))).toBe("2026-08-13");
    expect(escolhido(escolherObservacaoV2(lida([dia("2026-08-17", UTIL)], [erroEm("2026-08-13")]), PIXELS, "2026-08-15"))).toBe("2026-08-17");
    // A v1 trataria o erro do dia 19 (mais recente que 13) como decisivo: a medida da v2 é a distância.
    expect(falha(() => escolherObservacao(lida([dia("2026-08-13", UTIL)], [erroEm("2026-08-19")]), PIXELS)).tipo).toBe("processamento_parcial");
  });

  it("os metadados descrevem a resposta INTEIRA (erros e úteis não escolhidos incluídos)", () => {
    const r = escolherObservacaoV2(lida([dia("2026-08-13", UTIL), dia("2026-08-20", UTIL), dia("2026-08-15", NUBLADO), dia("2026-08-14", MASCARADO)], [erroEm("2026-08-25")]), PIXELS, "2026-08-15");
    expect(r.metadados).toEqual({
      intervalos_recebidos: 5, intervalos_com_erro: 1, intervalos_com_dado: 3, intervalos_uteis: 2,
      maior_cobertura: (Math.floor((11_000 * 10_000) / PIXELS) / 10_000).toFixed(4), fonte_pixels_geometria: "grade_crs84", status_provedor: "OK"
    });
  });

  it("quando a mais perto É a mais recente, o resultado é IGUAL ao da v1 (mesma medida, mesma formatação, mesmos metadados)", () => {
    const l = lida([dia("2026-08-10", UTIL, 0.55), dia("2026-08-12", NUBLADO), dia("2026-08-18", UTIL, 0.66)], [erroEm("2026-08-02")]);
    expect(escolherObservacaoV2(l, PIXELS, "2026-08-19")).toEqual(escolherObservacao(l, PIXELS));
  });

  it("a escolhida com valor fora do contrato continua recusada como na v1 (resposta_malformada)", () => {
    const fora = dia("2026-08-15", UTIL, 1.7);
    expect(falha(() => escolherObservacaoV2(lida([fora]), PIXELS, "2026-08-15")).tipo).toBe("resposta_malformada");
  });

  it("data alvo fora do formato LANÇA (defeito de quem chama)", () => {
    expect(() => escolherObservacaoV2(lida([dia("2026-08-15", UTIL)]), PIXELS, "15/08/2026")).toThrow(RangeError);
  });
});

describe("SAT-03 · evalscript e resolução", () => {
  it("o sha256 gravado é o do evalscript da v1 — o mesmo texto que vai no corpo enviado ao provedor", () => {
    expect(EVALSCRIPT_NDVI_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(EVALSCRIPT_NDVI_SHA256).toBe(createHash("sha256").update(EVALSCRIPT_NDVI, "utf8").digest("hex"));
    const corpo = montarCorpoEstatistica({ type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
      janelaDoItem({ janela_inicio: "2026-01-01", janela_fim: "2026-01-31" }), { resx: 0.0001, resy: 0.0001 });
    expect(createHash("sha256").update(corpo.aggregation.evalscript, "utf8").digest("hex")).toBe(EVALSCRIPT_NDVI_SHA256);
    expect(corpo.aggregation.timeRange).toEqual({ from: "2026-01-01T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z" });
  });

  it("resolução nativa da Sentinel-2 (B04/B08) = 10 m", () => {
    expect(RESOLUCAO_NATIVA_NDVI_M).toBe(10);
  });
});
