import { describe, expect, it } from "vitest";
import {
  MSG_COMPARACAO_GEOMETRIA,
  TEXTO_DADOS_INSUFICIENTES,
  alturasDoHistograma,
  anomaliaDoHistorico,
  compararObservacoes,
  coberturaEmPercentual,
  itemDaObservacao,
  lerHistograma,
  lerTendencia,
  observacoesComparaveis,
  pontosDoGrafico,
  serieDoHistorico,
  type HistoricoIndice,
  type ItemHistoricoIndice
} from "./condicao-modelo";

const HASH = "a".repeat(64);
const OUTRO = "b".repeat(64);

function item(dia: string, media: string, extra: Partial<ItemHistoricoIndice> = {}): ItemHistoricoIndice {
  return {
    id: `i-${dia}-${media}`, situacao: "concluida", motivo_qualidade: null, geometria_sha256: HASH, do_poligono_atual: true,
    observacao_inicio: `${dia}T13:00:00.000Z`, observacao_fim: `${dia}T13:00:01.000Z`, valor_medio: media, valor_minimo: null,
    valor_maximo: null, desvio_padrao: null, cobertura_valida: "0.9500", criado_em: `${dia}T20:00:00.000Z`, ...extra
  };
}

const hist = (indice: HistoricoIndice["indice"], itens: ItemHistoricoIndice[], hash: string | null = HASH): HistoricoIndice =>
  ({ area_id: "a", indice, geometria_sha256: hash, do_poligono_atual: true, itens });

describe("serieDoHistorico", () => {
  it("ordena do mais antigo ao mais recente e dedupe por observação (a análise mais nova vence)", () => {
    const s = serieDoHistorico([
      item("2026-09-10", "0.70"),
      item("2026-08-10", "0.50"),
      item("2026-09-10", "0.72", { id: "mais-nova", criado_em: "2026-09-11T00:00:00.000Z" })
    ]);
    expect(s.map((p) => [p.data.slice(0, 10), p.media])).toEqual([["2026-08-10", 0.5], ["2026-09-10", 0.72]]);
  });

  it("qualidadeOk exige concluída e cobertura >= 60%", () => {
    const s = serieDoHistorico([
      item("2026-08-01", "0.5", { cobertura_valida: "0.5900" }),
      item("2026-08-02", "0.5", { cobertura_valida: "0.6000" }),
      item("2026-08-03", "0.5", { situacao: "sem_observacao_util", valor_medio: null })
    ]);
    expect(s.map((p) => p.qualidadeOk)).toEqual([false, true, false]);
  });
});

describe("anomaliaDoHistorico (domínio sat-anomalia-v1)", () => {
  const tres = (a: string, b: string, c: string) => [item("2026-07-01", a), item("2026-08-01", b), item("2026-09-01", c)];

  it("histórico curto → dados insuficientes, sem alarme", () => {
    const r = anomaliaDoHistorico({ ndvi: hist("ndvi", [item("2026-09-01", "0.6")]) }, HASH);
    expect(r.nivel).toBe("dados_insuficientes");
    expect(r.vistoria_recomendada).toBe(false);
  });

  it("queda em NDVI e NDRE → possível alteração com vistoria recomendada; nunca praga/biomassa", () => {
    const r = anomaliaDoHistorico({
      ndvi: hist("ndvi", tres("0.70", "0.70", "0.35")),
      ndre: hist("ndre", tres("0.40", "0.40", "0.20"))
    }, HASH);
    expect(["moderada", "forte"]).toContain(r.nivel);
    expect(r.vistoria_recomendada).toBe(true);
    expect(r.praga_detectada).toBe(false);
    expect(r.biomassa_estimada).toBe(false);
  });

  it("só o NDVI cai: no máximo leve, sem vistoria", () => {
    const r = anomaliaDoHistorico({
      ndvi: hist("ndvi", tres("0.70", "0.70", "0.35")),
      ndre: hist("ndre", tres("0.40", "0.40", "0.40"))
    }, HASH);
    expect(r.nivel).toBe("leve");
    expect(r.vistoria_recomendada).toBe(false);
  });

  it("pontos de outra geometria são ignorados", () => {
    const r = anomaliaDoHistorico({
      ndvi: hist("ndvi", [item("2026-07-01", "0.7", { geometria_sha256: OUTRO }), item("2026-08-01", "0.7", { geometria_sha256: OUTRO }), item("2026-09-01", "0.2", { geometria_sha256: OUTRO })]),
      ndre: hist("ndre", [])
    }, HASH);
    expect(r.nivel).toBe("dados_insuficientes");
  });

  it("sem geometria atual → dados insuficientes", () => {
    expect(anomaliaDoHistorico({}, null).nivel).toBe("dados_insuficientes");
  });
});

describe("compararObservacoes", () => {
  const ndvi = hist("ndvi", [item("2026-08-01", "0.50"), item("2026-09-01", "0.65")]);
  const ndmi = hist("ndmi", [item("2026-08-01", "0.10"), item("2026-09-01", "0.05")]);

  it("A × B lado a lado, com B − A por índice", () => {
    const r = compararObservacoes("2026-08-01T13:00:00.000Z", "2026-09-01T13:00:00.000Z", { ndvi, ndmi });
    expect(r.tipo).toBe("ok");
    if (r.tipo !== "ok") return;
    const n = r.linhas.find((l) => l.indice === "ndvi")!;
    expect([n.a, n.b]).toEqual([0.5, 0.65]);
    expect(n.delta).toBeCloseTo(0.15, 6);
    expect(r.linhas.find((l) => l.indice === "ndmi")!.delta).toBeCloseTo(-0.05, 6);
  });

  it("geometrias diferentes entre A e B bloqueiam a comparação", () => {
    const misto = hist("ndvi", [item("2026-08-01", "0.50", { geometria_sha256: OUTRO }), item("2026-09-01", "0.65")]);
    const r = compararObservacoes("2026-08-01T13:00:00.000Z", "2026-09-01T13:00:00.000Z", { ndvi: misto });
    expect(r).toEqual({ tipo: "bloqueada", motivo: MSG_COMPARACAO_GEOMETRIA });
  });

  it("observação de contorno diferente do vigente também bloqueia", () => {
    const h = hist("ndvi", [item("2026-08-01", "0.50", { geometria_sha256: OUTRO }), item("2026-09-01", "0.65", { geometria_sha256: OUTRO })], HASH);
    expect(compararObservacoes("2026-08-01T13:00:00.000Z", "2026-09-01T13:00:00.000Z", { ndvi: h }).tipo).toBe("bloqueada");
  });

  it("data sem valor num índice vira traço (null), sem inventar", () => {
    const r = compararObservacoes("2026-08-01T13:00:00.000Z", "2026-09-01T13:00:00.000Z", { ndvi, ndmi: hist("ndmi", [item("2026-09-01", "0.05")]) });
    if (r.tipo !== "ok") throw new Error("esperava ok");
    expect(r.linhas.find((l) => l.indice === "ndmi")).toMatchObject({ a: null, delta: null });
  });
});

describe("observacoesComparaveis / pontosDoGrafico / cobertura", () => {
  it("lista da mais recente à mais antiga, só com média válida", () => {
    const o = observacoesComparaveis([item("2026-08-01", "0.5"), item("2026-09-01", "0.6"), item("2026-07-01", "0.4", { valor_medio: null })]);
    expect(o.map((x) => x.data.slice(0, 10))).toEqual(["2026-09-01", "2026-08-01"]);
  });

  it("o gráfico usa a escala FIXA, nunca o intervalo dos dados", () => {
    const serie = serieDoHistorico([item("2026-08-01", "0.0"), item("2026-09-01", "0.5")]);
    const p = pontosDoGrafico(serie, { min: -1, max: 1 });
    expect(p.map((x) => x.y)).toEqual([0.5, 0.75]);
    expect(p.map((x) => x.x)).toEqual([0, 1]);
    expect(pontosDoGrafico(serieDoHistorico([item("2026-08-01", "5")]), { min: -1, max: 1 })[0]!.y).toBe(1);
  });

  it("cobertura 0..1 vira percentual", () => {
    expect(coberturaEmPercentual("0.8730")).toBeCloseTo(87.3, 6);
    expect(coberturaEmPercentual(null)).toBeNull();
  });
});

describe("tendência do painel", () => {
  const fmt = (v: number) => v.toFixed(2).replace(".", ",");

  it("delta nulo é 'Dados insuficientes' — NULL não é zero", () => {
    const nula = lerTendencia({ periodo: "30d", delta: null, pontos: 1 }, fmt);
    expect(nula).toEqual({ delta: null, texto: TEXTO_DADOS_INSUFICIENTES, direcao: "insuficiente" });
    expect(lerTendencia(undefined, fmt).direcao).toBe("insuficiente");
    expect(lerTendencia(null, fmt).texto).toBe("Dados insuficientes");
    expect(lerTendencia({ periodo: "ultima", delta: Number.NaN, pontos: 3 }, fmt).direcao).toBe("insuficiente");
  });

  it("zero verdadeiro é '0,00' e estável; com sinal quando sobe ou cai", () => {
    expect(lerTendencia({ periodo: "90d", delta: 0, pontos: 4 }, fmt)).toEqual({ delta: 0, texto: "0,00", direcao: "estavel" });
    expect(lerTendencia({ periodo: "90d", delta: 0.054, pontos: 4 }, fmt)).toMatchObject({ texto: "+0,05", direcao: "subiu" });
    expect(lerTendencia({ periodo: "90d", delta: -0.12, pontos: 4 }, fmt)).toMatchObject({ texto: "−0,12", direcao: "caiu" });
  });
});

describe("histograma e observação da comparação", () => {
  const oficial = { bins: [{ lowEdge: 0, highEdge: 0.5, count: 10 }, { lowEdge: 0.5, highEdge: 1, count: 30 }], underflowCount: 2, overflowCount: 0 };

  it("lê o histograma oficial; forma estranha vira nulo", () => {
    expect(lerHistograma(oficial)).toEqual({ bins: [{ baixo: 0, alto: 0.5, contagem: 10 }, { baixo: 0.5, alto: 1, contagem: 30 }], abaixo: 2, acima: 0 });
    expect(lerHistograma(null)).toBeNull();
    expect(lerHistograma({ bins: [] })).toBeNull();
    expect(lerHistograma({ bins: [0, 1, 2], counts: [1, 2] })).toBeNull();
    expect(lerHistograma({ bins: [{ lowEdge: 1, highEdge: 0, count: 1 }] })).toBeNull();
    expect(lerHistograma({ bins: [{ lowEdge: 0, highEdge: 1, count: -1 }] })).toBeNull();
  });

  it("alturas relativas ao maior bin; histograma vazio de contagem não divide por zero", () => {
    expect(alturasDoHistograma(lerHistograma(oficial)!)).toEqual([10 / 30, 1]);
    expect(alturasDoHistograma({ bins: [{ baixo: 0, alto: 1, contagem: 0 }], abaixo: 0, acima: 0 })).toEqual([0]);
  });

  it("a análise da observação é a mais recente por criação", () => {
    const itens = [
      item("2026-09-10", "0.5", { id: "velha", criado_em: "2026-09-10T20:00:00.000Z" }),
      item("2026-09-10", "0.6", { id: "nova", criado_em: "2026-09-11T20:00:00.000Z" })
    ];
    expect(itemDaObservacao(itens, "2026-09-10T13:00:00.000Z")?.id).toBe("nova");
    expect(itemDaObservacao(itens, "2026-01-01T13:00:00.000Z")).toBeNull();
  });
});
