import { describe, expect, it } from "vitest";
import {
  DATA_ULTIMA_IMAGEM,
  analiseIdDaData,
  chaveDaData,
  dataDoSeletor,
  dataEscolhida,
  dataImagemDoPedido,
  datasUteisDoHistorico,
  diaDaObservacao,
  ehDiaIso,
  opcoesDeData,
  valorDoSeletorDeData
} from "./data-camada";
import type { ItemHistoricoIndice } from "./condicao-modelo";

function item(id: string, obs: string | null, extra: Partial<ItemHistoricoIndice> = {}): ItemHistoricoIndice {
  return {
    id, situacao: "concluida", motivo_qualidade: null, geometria_sha256: "h", do_poligono_atual: true,
    observacao_inicio: obs, observacao_fim: obs, valor_medio: "0.5", valor_minimo: null, valor_maximo: null, desvio_padrao: null,
    cobertura_valida: "0.9", criado_em: "2026-09-12T10:00:00.000Z", ...extra
  };
}

describe("DataDaCamada", () => {
  it("é 'última imagem útil' por padrão e só manda data_imagem quando há data escolhida", () => {
    expect(DATA_ULTIMA_IMAGEM).toEqual({ tipo: "ultima" });
    expect(dataImagemDoPedido(DATA_ULTIMA_IMAGEM)).toBeUndefined();
    expect(dataImagemDoPedido(dataEscolhida("2026-09-10"))).toBe("2026-09-10");
    expect(chaveDaData(DATA_ULTIMA_IMAGEM)).toBe("ultima");
    expect(chaveDaData(dataEscolhida("2026-09-10"))).toBe("data:2026-09-10");
  });

  it("recusa dia que não existe no calendário (nunca vira outra data)", () => {
    expect(ehDiaIso("2026-02-30")).toBe(false);
    expect(ehDiaIso("2026-9-1")).toBe(false);
    expect(() => dataEscolhida("2026-02-30")).toThrow(RangeError);
    expect(dataDoSeletor("lixo")).toEqual({ tipo: "ultima" });
    expect(dataDoSeletor("2026-09-10")).toEqual({ tipo: "data", data: "2026-09-10" });
    expect(valorDoSeletorDeData(dataEscolhida("2026-09-10"))).toBe("2026-09-10");
    expect(valorDoSeletorDeData(DATA_ULTIMA_IMAGEM)).toBe("ultima");
  });

  it("o dia da observação é o dia UTC (o mesmo da data_imagem do raster)", () => {
    expect(diaDaObservacao("2026-09-10T23:59:59.000Z")).toBe("2026-09-10");
    expect(diaDaObservacao(null)).toBeNull();
    expect(diaDaObservacao("ontem")).toBeNull();
  });
});

describe("datas úteis do histórico", () => {
  it("só observações concluídas com média; dias distintos, da mais recente à mais antiga", () => {
    const itens = [
      item("a", "2026-08-10T13:00:00.000Z"),
      item("b", "2026-09-10T13:00:00.000Z"),
      item("b2", "2026-09-10T14:00:00.000Z"),
      item("falha", null, { situacao: "sem_observacao_util", valor_medio: null }),
      item("sem-media", "2026-07-01T13:00:00.000Z", { valor_medio: null }),
      item("nao-concluida", "2026-06-01T13:00:00.000Z", { situacao: "falha" })
    ];
    expect(datasUteisDoHistorico(itens)).toEqual(["2026-09-10", "2026-08-10"]);
  });

  it("a análise do dia é a concluída mais recente por criação", () => {
    const itens = [
      item("velha", "2026-09-10T13:00:00.000Z", { criado_em: "2026-09-10T20:00:00.000Z" }),
      item("nova", "2026-09-10T13:00:00.000Z", { criado_em: "2026-09-11T20:00:00.000Z" }),
      item("outra-data", "2026-08-10T13:00:00.000Z")
    ];
    expect(analiseIdDaData(itens, "2026-09-10")).toBe("nova");
    expect(analiseIdDaData(itens, "2026-01-01")).toBeNull();
  });
});

describe("opções do seletor DATA", () => {
  const fmt = (d: string) => `fmt:${d}`;

  it("'Última imagem útil' + as datas úteis; sem área aberta, só a primeira", () => {
    expect(opcoesDeData([], DATA_ULTIMA_IMAGEM, fmt)).toEqual([{ valor: "ultima", rotulo: "Última imagem útil" }]);
    expect(opcoesDeData(["2026-09-10", "2026-08-10"], DATA_ULTIMA_IMAGEM, fmt).map((o) => o.valor)).toEqual(["ultima", "2026-09-10", "2026-08-10"]);
  });

  it("a data já escolhida permanece na lista mesmo que a área aberta mude", () => {
    const o = opcoesDeData(["2026-09-10"], dataEscolhida("2026-05-01"), fmt);
    expect(o.map((x) => x.valor)).toEqual(["ultima", "2026-09-10", "2026-05-01"]);
    expect(o.find((x) => x.valor === "2026-05-01")?.rotulo).toBe("fmt:2026-05-01");
  });
});
