import { describe, it, expect } from "vitest";
import { addDays } from "@agro/shared";
import { INDICE_NDVI, VERSAO_METODO_NDVI } from "../src/analise-satelital.js";
import * as barril from "../src/index.js";
import {
  BANDAS_POR_INDICE,
  COEFICIENTES_ESTIMATIVA_PU,
  CREDITOS_POR_PU,
  DATA_MINIMA_SENTINEL2_L2A,
  ErroPeriodoConsulta,
  FAIXA_ZERO,
  INDICES_CONSULTA_SATELITE,
  JANELA_CONSULTA_DIAS,
  MAX_ITENS_POR_CONSULTA,
  OPERACOES_CONSUMO_SATELITE,
  PAGINA_CONSULTAS,
  PAGINA_ITENS_CONSULTA,
  SITUACOES_CONSULTA_SATELITE,
  SITUACOES_ITEM_CONSULTA_SATELITE,
  SITUACOES_ITEM_VIVAS,
  TOLERANCIA_CONSULTA_DIAS,
  VERSAO_METODO_NDVI_V2,
  diasDaJanela,
  estimarCreditosItem,
  observacoesDoSlot,
  origemChaveIdempotencia,
  puPorObservacao,
  slotsDoPeriodo,
  somarFaixas,
  type PeriodoConsulta,
  type SlotConsulta
} from "../src/consulta-satelital.js";

/**
 * SAT-02 (decisão 295) — o que é puro na consulta em lote: o recorte do período em slots, a origem da chave de
 * idempotência e a estimativa de créditos. O "hoje" é fixo: a função não lê relógio, e o teste prova isso passando
 * dias diferentes e conferindo datas exatas.
 */
const HOJE = "2026-10-04";

const slot = (inicio: string, fim: string, data_alvo: string | null = null): SlotConsulta => ({ data_alvo, janela_inicio: inicio, janela_fim: fim });
const janelas = (s: SlotConsulta[]) => s.map((x) => `${x.janela_inicio}..${x.janela_fim}`);

/** Captura a recusa e devolve o campo — falha o teste se a função NÃO recusar ou recusar com outro tipo de erro. */
function campoDaRecusa(p: unknown, hoje = HOJE): string {
  try {
    slotsDoPeriodo(p as PeriodoConsulta, hoje);
  } catch (e) {
    expect(e).toBeInstanceOf(ErroPeriodoConsulta);
    expect((e as Error).name).toBe("ErroPeriodoConsulta");
    expect((e as Error).message.length).toBeGreaterThan(0);
    return (e as ErroPeriodoConsulta).campo;
  }
  throw new Error(`esperava recusa para ${JSON.stringify(p)}`);
}

describe("constantes da SAT-02 — o contrato que a 0053 e a API consomem", () => {
  it("listas fechadas e limites", () => {
    expect(VERSAO_METODO_NDVI_V2).toBe("ndvi-v2");
    expect(VERSAO_METODO_NDVI_V2).not.toBe(VERSAO_METODO_NDVI); // método novo, não se reaproveita com a SAT-01
    expect(INDICES_CONSULTA_SATELITE).toEqual(["ndvi"]);
    expect(INDICES_CONSULTA_SATELITE[0]).toBe(INDICE_NDVI); // o mesmo índice da SAT-01, não uma segunda grafia
    expect(SITUACOES_CONSULTA_SATELITE.map(([v]) => v)).toEqual(["pendente", "executando", "concluida", "concluida_com_falhas", "cancelada"]);
    expect(SITUACOES_ITEM_CONSULTA_SATELITE.map(([v]) => v)).toEqual(["pendente", "executando", "concluido", "reaproveitado", "falho", "cancelado"]);
    for (const [, rotulo] of [...SITUACOES_CONSULTA_SATELITE, ...SITUACOES_ITEM_CONSULTA_SATELITE]) expect(rotulo.trim()).not.toBe("");
    expect([...SITUACOES_ITEM_VIVAS]).toEqual(["pendente", "executando", "concluido"]);
    const valoresItem = SITUACOES_ITEM_CONSULTA_SATELITE.map(([v]) => v);
    for (const viva of SITUACOES_ITEM_VIVAS) expect(valoresItem).toContain(viva);
    expect([...OPERACOES_CONSUMO_SATELITE]).toEqual(["process", "statistical", "catalog"]);
    expect(MAX_ITENS_POR_CONSULTA).toBe(200);
    expect(JANELA_CONSULTA_DIAS).toEqual({ minimo: 1, maximo: 90 });
    expect(TOLERANCIA_CONSULTA_DIAS).toEqual({ minimo: 0, maximo: 30 });
    expect(DATA_MINIMA_SENTINEL2_L2A).toBe("2017-03-28");
    expect(CREDITOS_POR_PU).toBe(100);
    expect(COEFICIENTES_ESTIMATIVA_PU).toEqual({ pixelsReferencia: 262144, fatorAreaMinimo: 0.01, bandasReferencia: 3, fatorFormato: 1, revisitaDias: 5 });
    expect(BANDAS_POR_INDICE).toEqual({ ndvi: 3 });
    expect(PAGINA_CONSULTAS).toEqual({ padrao: 20, maximo: 100 });
    expect(PAGINA_ITENS_CONSULTA).toEqual({ padrao: 50, maximo: 100 });
  });
  it("o barril do domínio exporta o módulo (a API importa de @agro/domain)", () => {
    expect(barril.slotsDoPeriodo).toBe(slotsDoPeriodo);
    expect(barril.estimarCreditosItem).toBe(estimarCreditosItem);
    expect(barril.ErroPeriodoConsulta).toBe(ErroPeriodoConsulta);
  });
});

describe("slotsDoPeriodo — mais_recente", () => {
  it("janela de 1 dia = só hoje; de 30 e de 90 dias terminam hoje e contam hoje", () => {
    expect(slotsDoPeriodo({ tipo: "mais_recente", janela_dias: 1 }, HOJE)).toEqual([slot(HOJE, HOJE)]);
    expect(slotsDoPeriodo({ tipo: "mais_recente", janela_dias: 30 }, HOJE)).toEqual([slot("2026-09-05", HOJE)]);
    const [noventa] = slotsDoPeriodo({ tipo: "mais_recente", janela_dias: 90 }, HOJE);
    expect(noventa).toEqual(slot("2026-07-07", HOJE));
    expect(diasDaJanela(noventa!)).toBe(90);
  });
  it("a janela atravessa a virada do ano e o fevereiro bissexto sem fuso", () => {
    expect(slotsDoPeriodo({ tipo: "mais_recente", janela_dias: 10 }, "2027-01-05")).toEqual([slot("2026-12-27", "2027-01-05")]);
    expect(slotsDoPeriodo({ tipo: "mais_recente", janela_dias: 2 }, "2028-03-01")).toEqual([slot("2028-02-29", "2028-03-01")]);
  });
  it("o hoje é parâmetro: outro dia, outra janela (nada de relógio dentro)", () => {
    expect(slotsDoPeriodo({ tipo: "mais_recente", janela_dias: 30 }, "2026-10-05")).toEqual([slot("2026-09-06", "2026-10-05")]);
  });
  it("janela fora de 1..90 ou não inteira → recusa em periodo.janela_dias", () => {
    for (const janela_dias of [0, 91, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "30", null, undefined]) {
      expect(campoDaRecusa({ tipo: "mais_recente", janela_dias })).toBe("periodo.janela_dias");
    }
  });
});

describe("slotsDoPeriodo — data (com tolerância)", () => {
  it("tolerância 0 = só a própria data; tolerância 30 abre 30 dias para cada lado", () => {
    expect(slotsDoPeriodo({ tipo: "data", data: "2026-03-15", tolerancia_dias: 0 }, HOJE)).toEqual([slot("2026-03-15", "2026-03-15", "2026-03-15")]);
    expect(slotsDoPeriodo({ tipo: "data", data: "2026-03-15", tolerancia_dias: 30 }, HOJE)).toEqual([slot("2026-02-13", "2026-04-14", "2026-03-15")]);
  });
  it("29/02 de ano bissexto é data válida; a tolerância cruza o fim do mês", () => {
    expect(slotsDoPeriodo({ tipo: "data", data: "2028-02-29", tolerancia_dias: 1 }, "2028-06-01")).toEqual([slot("2028-02-28", "2028-03-01", "2028-02-29")]);
    expect(slotsDoPeriodo({ tipo: "data", data: "2026-01-31", tolerancia_dias: 1 }, HOJE)).toEqual([slot("2026-01-30", "2026-02-01", "2026-01-31")]);
  });
  it("data perto de hoje: a janela é cortada em hoje (não pede imagem do futuro)", () => {
    expect(slotsDoPeriodo({ tipo: "data", data: "2026-10-01", tolerancia_dias: 10 }, HOJE)).toEqual([slot("2026-09-21", HOJE, "2026-10-01")]);
    expect(slotsDoPeriodo({ tipo: "data", data: HOJE, tolerancia_dias: 30 }, HOJE)).toEqual([slot("2026-09-04", HOJE, HOJE)]);
  });
  it("data perto do início do acervo: a janela é cortada na data mínima; a própria data mínima é aceita", () => {
    expect(slotsDoPeriodo({ tipo: "data", data: "2017-04-05", tolerancia_dias: 30 }, HOJE)).toEqual([slot(DATA_MINIMA_SENTINEL2_L2A, "2017-05-05", "2017-04-05")]);
    expect(slotsDoPeriodo({ tipo: "data", data: DATA_MINIMA_SENTINEL2_L2A, tolerancia_dias: 0 }, HOJE)).toEqual([slot("2017-03-28", "2017-03-28", "2017-03-28")]);
  });
  it("data antes da mínima, no futuro ou fora do calendário → recusa em periodo.data", () => {
    expect(campoDaRecusa({ tipo: "data", data: "2017-03-27", tolerancia_dias: 5 })).toBe("periodo.data");
    expect(campoDaRecusa({ tipo: "data", data: "2026-10-05", tolerancia_dias: 0 })).toBe("periodo.data");
    for (const data of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "2026-1-05", "05/10/2026", "2026-10-04T00:00:00Z", " 2026-10-04", "", null, 20261004]) {
      expect(campoDaRecusa({ tipo: "data", data, tolerancia_dias: 0 })).toBe("periodo.data");
    }
  });
  it("mensagem da data mínima em PT-BR, com a data no formato brasileiro", () => {
    expect(() => slotsDoPeriodo({ tipo: "data", data: "2016-12-01", tolerancia_dias: 0 }, HOJE)).toThrow("28/03/2017");
  });
  it("tolerância fora de 0..30 ou não inteira → recusa em periodo.tolerancia_dias", () => {
    for (const tolerancia_dias of [-1, 31, 0.5, Number.NaN, "3", null]) {
      expect(campoDaRecusa({ tipo: "data", data: "2026-03-15", tolerancia_dias })).toBe("periodo.tolerancia_dias");
    }
  });
});

describe("slotsDoPeriodo — intervalo mensal", () => {
  it("um slot por mês civil, cortado nas pontas do intervalo", () => {
    expect(janelas(slotsDoPeriodo({ tipo: "intervalo", de: "2026-01-15", ate: "2026-04-10", cadencia: "mensal" }, HOJE)))
      .toEqual(["2026-01-15..2026-01-31", "2026-02-01..2026-02-28", "2026-03-01..2026-03-31", "2026-04-01..2026-04-10"]);
  });
  it("o ano inteiro: último dia de cada mês (28, 30 e 31) certo", () => {
    const fins = slotsDoPeriodo({ tipo: "intervalo", de: "2025-01-01", ate: "2025-12-31", cadencia: "mensal" }, HOJE).map((s) => s.janela_fim.slice(8));
    expect(fins).toEqual(["31", "28", "31", "30", "31", "30", "31", "31", "30", "31", "30", "31"]);
  });
  it("fevereiro bissexto vai até 29; a virada do ano não perde nem repete mês", () => {
    expect(janelas(slotsDoPeriodo({ tipo: "intervalo", de: "2028-02-01", ate: "2028-03-31", cadencia: "mensal" }, "2028-06-01")))
      .toEqual(["2028-02-01..2028-02-29", "2028-03-01..2028-03-31"]);
    expect(janelas(slotsDoPeriodo({ tipo: "intervalo", de: "2025-11-20", ate: "2026-02-05", cadencia: "mensal" }, HOJE)))
      .toEqual(["2025-11-20..2025-11-30", "2025-12-01..2025-12-31", "2026-01-01..2026-01-31", "2026-02-01..2026-02-05"]);
  });
  it("de == ate → um slot de um dia; slot de intervalo não tem data alvo", () => {
    expect(slotsDoPeriodo({ tipo: "intervalo", de: "2026-05-31", ate: "2026-05-31", cadencia: "mensal" }, HOJE)).toEqual([slot("2026-05-31", "2026-05-31")]);
    expect(slotsDoPeriodo({ tipo: "intervalo", de: "2026-05-01", ate: HOJE, cadencia: "mensal" }, HOJE).every((s) => s.data_alvo === null)).toBe(true);
  });
});

describe("slotsDoPeriodo — intervalo decendial", () => {
  it("mês de 31, de 30, de 28 e de 29 dias: 1–10, 11–20, 21–último dia", () => {
    expect(janelas(slotsDoPeriodo({ tipo: "intervalo", de: "2026-01-01", ate: "2026-01-31", cadencia: "decendial" }, HOJE)))
      .toEqual(["2026-01-01..2026-01-10", "2026-01-11..2026-01-20", "2026-01-21..2026-01-31"]);
    expect(janelas(slotsDoPeriodo({ tipo: "intervalo", de: "2026-04-01", ate: "2026-04-30", cadencia: "decendial" }, HOJE)))
      .toEqual(["2026-04-01..2026-04-10", "2026-04-11..2026-04-20", "2026-04-21..2026-04-30"]);
    expect(janelas(slotsDoPeriodo({ tipo: "intervalo", de: "2026-02-01", ate: "2026-02-28", cadencia: "decendial" }, HOJE)))
      .toEqual(["2026-02-01..2026-02-10", "2026-02-11..2026-02-20", "2026-02-21..2026-02-28"]);
    expect(janelas(slotsDoPeriodo({ tipo: "intervalo", de: "2028-02-01", ate: "2028-02-29", cadencia: "decendial" }, "2028-06-01")))
      .toEqual(["2028-02-01..2028-02-10", "2028-02-11..2028-02-20", "2028-02-21..2028-02-29"]);
  });
  it("intervalo cortado no meio do decêndio e do mês", () => {
    expect(janelas(slotsDoPeriodo({ tipo: "intervalo", de: "2026-03-05", ate: "2026-04-15", cadencia: "decendial" }, HOJE)))
      .toEqual(["2026-03-05..2026-03-10", "2026-03-11..2026-03-20", "2026-03-21..2026-03-31", "2026-04-01..2026-04-10", "2026-04-11..2026-04-15"]);
  });
  it("de == ate → um slot; dois dias na fronteira do decêndio → dois slots de um dia", () => {
    expect(janelas(slotsDoPeriodo({ tipo: "intervalo", de: "2026-03-10", ate: "2026-03-10", cadencia: "decendial" }, HOJE))).toEqual(["2026-03-10..2026-03-10"]);
    expect(janelas(slotsDoPeriodo({ tipo: "intervalo", de: "2026-03-10", ate: "2026-03-11", cadencia: "decendial" }, HOJE))).toEqual(["2026-03-10..2026-03-10", "2026-03-11..2026-03-11"]);
  });
  it("propriedade: os slots cobrem [de, ate] sem buraco nem sobreposição, cada um dentro de um mês", () => {
    let conferidos = 0;
    for (const de of ["2025-12-29", "2026-01-31", "2026-02-10", "2026-02-21", "2028-02-11"]) {
      for (const dias of [0, 1, 9, 10, 27, 45, 100, 400]) {
        const ate = addDays(de, dias);
        for (const cadencia of ["mensal", "decendial"] as const) {
          const s = slotsDoPeriodo({ tipo: "intervalo", de, ate, cadencia }, "2030-01-01");
          expect(s[0]!.janela_inicio).toBe(de);
          expect(s[s.length - 1]!.janela_fim).toBe(ate);
          for (let i = 0; i < s.length; i++) {
            expect(s[i]!.janela_inicio.slice(0, 7)).toBe(s[i]!.janela_fim.slice(0, 7));
            if (i > 0) expect(s[i]!.janela_inicio).toBe(addDays(s[i - 1]!.janela_fim, 1));
          }
          expect(s.reduce((t, x) => t + diasDaJanela(x), 0)).toBe(dias + 1);
          conferidos++;
        }
      }
    }
    expect(conferidos).toBe(80); // a propriedade foi conferida de verdade, não em lista vazia
  });
});

describe("slotsDoPeriodo — recusas do intervalo e do tipo", () => {
  it("de > ate → periodo.de; ate no futuro → periodo.ate; de antes da mínima → periodo.de", () => {
    expect(campoDaRecusa({ tipo: "intervalo", de: "2026-05-02", ate: "2026-05-01", cadencia: "mensal" })).toBe("periodo.de");
    expect(campoDaRecusa({ tipo: "intervalo", de: "2026-09-01", ate: "2026-10-05", cadencia: "mensal" })).toBe("periodo.ate");
    expect(campoDaRecusa({ tipo: "intervalo", de: "2017-03-01", ate: "2017-04-30", cadencia: "mensal" })).toBe("periodo.de");
    expect(campoDaRecusa({ tipo: "intervalo", de: "2026-10-05", ate: "2026-10-06", cadencia: "mensal" })).toBe("periodo.de");
  });
  it("calendário inválido em de ou ate → o próprio campo", () => {
    expect(campoDaRecusa({ tipo: "intervalo", de: "2026-02-30", ate: "2026-03-10", cadencia: "mensal" })).toBe("periodo.de");
    expect(campoDaRecusa({ tipo: "intervalo", de: "2026-02-01", ate: "2026-02-29", cadencia: "decendial" })).toBe("periodo.ate");
  });
  it("cadência desconhecida → periodo.cadencia; tipo desconhecido → periodo.tipo; sem período → periodo", () => {
    for (const cadencia of ["semanal", "Mensal", "", null]) {
      expect(campoDaRecusa({ tipo: "intervalo", de: "2026-01-01", ate: "2026-02-01", cadencia })).toBe("periodo.cadencia");
    }
    for (const tipo of ["recente", "MAIS_RECENTE", "", null, undefined]) expect(campoDaRecusa({ tipo, janela_dias: 30 })).toBe("periodo.tipo");
    for (const p of [null, undefined, "mais_recente", 30]) expect(campoDaRecusa(p)).toBe("periodo");
  });
  it("hoje inválido é defeito do servidor (RangeError), não pedido a recusar com 422", () => {
    for (const hoje of ["2026-02-30", "04/10/2026", ""]) {
      expect(() => slotsDoPeriodo({ tipo: "mais_recente", janela_dias: 1 }, hoje)).toThrow(RangeError);
      expect(() => slotsDoPeriodo({ tipo: "mais_recente", janela_dias: 1 }, hoje)).not.toThrow(ErroPeriodoConsulta);
    }
  });
  it("o resultado não depende do fuso do processo (dia UTC, sem hora local)", () => {
    const original = process.env.TZ;
    const periodos: PeriodoConsulta[] = [
      { tipo: "mais_recente", janela_dias: 90 },
      { tipo: "data", data: "2028-02-29", tolerancia_dias: 30 },
      { tipo: "intervalo", de: "2026-01-15", ate: "2026-04-10", cadencia: "decendial" }
    ];
    try {
      const resultados = ["UTC", "America/Sao_Paulo", "Pacific/Kiritimati", "Pacific/Pago_Pago"].map((tz) => {
        process.env.TZ = tz;
        return JSON.stringify(periodos.map((p) => slotsDoPeriodo(p, "2028-06-01")));
      });
      expect(new Set(resultados).size).toBe(1);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe("diasDaJanela — inclusiva nas duas pontas", () => {
  it("contagens exatas", () => {
    expect(diasDaJanela(slot(HOJE, HOJE))).toBe(1);
    expect(diasDaJanela(slot("2026-02-01", "2026-02-28"))).toBe(28);
    expect(diasDaJanela(slot("2028-02-01", "2028-02-29"))).toBe(29);
    expect(diasDaJanela(slot("2026-12-31", "2027-01-01"))).toBe(2);
    expect(diasDaJanela(slot("2026-01-01", "2026-12-31"))).toBe(365);
  });
  it("janela invertida ou com data inválida é recusada (sem número negativo virando estimativa)", () => {
    expect(() => diasDaJanela(slot("2026-01-02", "2026-01-01"))).toThrow(RangeError);
    expect(() => diasDaJanela(slot("2026-02-30", "2026-03-01"))).toThrow(RangeError);
  });
});

describe("origemChaveIdempotencia", () => {
  const base = {
    organizationId: "11111111-1111-4111-8111-111111111111",
    areaId: "22222222-2222-4222-8222-222222222222",
    geometriaSha256: "a".repeat(64),
    indiceBundle: "ndvi" as const,
    versaoMetodo: VERSAO_METODO_NDVI_V2
  };
  it("formato exato: org|área|geometria|índice|<data_alvo ou recente>@<início>..<fim>|versão", () => {
    expect(origemChaveIdempotencia({ ...base, slot: slot("2026-09-05", HOJE) }))
      .toBe(`11111111-1111-4111-8111-111111111111|22222222-2222-4222-8222-222222222222|${"a".repeat(64)}|ndvi|recente@2026-09-05..2026-10-04|ndvi-v2`);
    expect(origemChaveIdempotencia({ ...base, slot: slot("2026-02-13", "2026-04-14", "2026-03-15") }))
      .toBe(`11111111-1111-4111-8111-111111111111|22222222-2222-4222-8222-222222222222|${"a".repeat(64)}|ndvi|2026-03-15@2026-02-13..2026-04-14|ndvi-v2`);
  });
  it("a JANELA entra na chave: 'recente' de hoje e o de amanhã são pedidos diferentes", () => {
    const [hoje] = slotsDoPeriodo({ tipo: "mais_recente", janela_dias: 30 }, HOJE);
    const [amanha] = slotsDoPeriodo({ tipo: "mais_recente", janela_dias: 30 }, "2026-10-05");
    expect(origemChaveIdempotencia({ ...base, slot: hoje! })).not.toBe(origemChaveIdempotencia({ ...base, slot: amanha! }));
  });
  it("períodos diferentes sobre a mesma janela não colidem: data com tolerância 0 ≠ intervalo de um dia", () => {
    const [porData] = slotsDoPeriodo({ tipo: "data", data: "2026-03-15", tolerancia_dias: 0 }, HOJE);
    const [porIntervalo] = slotsDoPeriodo({ tipo: "intervalo", de: "2026-03-15", ate: "2026-03-15", cadencia: "mensal" }, HOJE);
    expect(janelas([porData!])).toEqual(janelas([porIntervalo!]));
    expect(origemChaveIdempotencia({ ...base, slot: porData! })).not.toBe(origemChaveIdempotencia({ ...base, slot: porIntervalo! }));
  });
  it("cada parte muda a origem (área, geometria, versão)", () => {
    const s = slot("2026-09-05", HOJE);
    const ref = origemChaveIdempotencia({ ...base, slot: s });
    expect(origemChaveIdempotencia({ ...base, slot: s, areaId: "33333333-3333-4333-8333-333333333333" })).not.toBe(ref);
    expect(origemChaveIdempotencia({ ...base, slot: s, geometriaSha256: "b".repeat(64) })).not.toBe(ref);
    expect(origemChaveIdempotencia({ ...base, slot: s, versaoMetodo: "ndvi-v3" })).not.toBe(ref);
  });
  it("parte vazia ou com o separador é recusada (duas origens nunca montam a mesma string)", () => {
    const s = slot("2026-09-05", HOJE);
    expect(() => origemChaveIdempotencia({ ...base, slot: s, areaId: "a|b" })).toThrow(RangeError);
    expect(() => origemChaveIdempotencia({ ...base, slot: s, organizationId: "" })).toThrow(RangeError);
  });
});

describe("estimativa de créditos", () => {
  it("puPorObservacao: 512 × 512 px = 1 PU; NDVI tem fator de bandas 1 (3 ÷ 3)", () => {
    expect(puPorObservacao(262144, "ndvi")).toBe("1.0000");
    expect(puPorObservacao(524288, "ndvi")).toBe("2.0000");
    expect(puPorObservacao(393216, "ndvi")).toBe("1.5000");
    expect(puPorObservacao(131072, "ndvi")).toBe("0.5000");
    expect(puPorObservacao(100000, "ndvi")).toBe("0.3815");
  });
  it("puPorObservacao: piso de 0,01 PU para caixa minúscula", () => {
    expect(puPorObservacao(1, "ndvi")).toBe("0.0100");
    expect(puPorObservacao(2621, "ndvi")).toBe("0.0100"); // 2621 ÷ 262144 < 0,01 → piso
    expect(estimarCreditosItem({ pixelsBbox: 1, indice: "ndvi", slot: slot(HOJE, HOJE) })).toEqual({ minimo: "1.00", maximo: "1.00" });
    expect(estimarCreditosItem({ pixelsBbox: 2621, indice: "ndvi", slot: slot(HOJE, HOJE) })).toEqual({ minimo: "1.00", maximo: "1.00" });
  });
  it("pixels inválidos ou índice sem bandas declaradas → recusa, nunca estimativa", () => {
    for (const px of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) expect(() => puPorObservacao(px, "ndvi")).toThrow(RangeError);
    expect(() => puPorObservacao(262144, "evi" as "ndvi")).toThrow(RangeError);
    expect(() => puPorObservacao(262144, "toString" as "ndvi")).toThrow(RangeError);
  });
  it("observacoesDoSlot: mínimo 1; máximo = teto(dias ÷ 5), nunca abaixo de 1", () => {
    expect(observacoesDoSlot(slot(HOJE, HOJE))).toEqual({ minimo: 1, maximo: 1 });
    expect(observacoesDoSlot(slot("2026-10-01", "2026-10-05"))).toEqual({ minimo: 1, maximo: 1 });
    expect(observacoesDoSlot(slot("2026-10-01", "2026-10-06"))).toEqual({ minimo: 1, maximo: 2 });
    expect(observacoesDoSlot(slot("2026-09-05", HOJE))).toEqual({ minimo: 1, maximo: 6 });
    expect(observacoesDoSlot(slot("2026-01-01", "2026-01-31"))).toEqual({ minimo: 1, maximo: 7 });
    expect(observacoesDoSlot(slot("2026-07-07", HOJE))).toEqual({ minimo: 1, maximo: 18 });
  });
  it("estimarCreditosItem: valores exatos em string", () => {
    expect(estimarCreditosItem({ pixelsBbox: 262144, indice: "ndvi", slot: slot("2026-09-05", HOJE) })).toEqual({ minimo: "100.00", maximo: "600.00" });
    // 100000 px = 38,14697265625 créditos por observação; arredonda UMA vez, no fim (não 0,3815 PU × 100 × 6 = 228,90)
    expect(estimarCreditosItem({ pixelsBbox: 100000, indice: "ndvi", slot: slot("2026-09-05", HOJE) })).toEqual({ minimo: "38.15", maximo: "228.88" });
    // a maior caixa da grade (2500 × 2500 px) na maior janela (90 dias → 18 observações)
    expect(estimarCreditosItem({ pixelsBbox: 2500 * 2500, indice: "ndvi", slot: slot("2026-07-07", HOJE) })).toEqual({ minimo: "2384.19", maximo: "42915.34" });
  });
  it("estimarCreditosItem: arredondamento a 2 casas pelo padrão do repositório (meio para o par)", () => {
    // 8192 px = 3,125 créditos exatos → 3,12; 24576 px = 9,375 → 9,38
    expect(estimarCreditosItem({ pixelsBbox: 8192, indice: "ndvi", slot: slot(HOJE, HOJE) })).toEqual({ minimo: "3.12", maximo: "3.12" });
    expect(estimarCreditosItem({ pixelsBbox: 24576, indice: "ndvi", slot: slot(HOJE, HOJE) })).toEqual({ minimo: "9.38", maximo: "9.38" });
  });
  it("a faixa sempre tem mínimo ≤ máximo e duas casas decimais", () => {
    let conferidas = 0;
    for (const px of [1, 2621, 2622, 8192, 100000, 262144, 6_250_000]) {
      for (const dias of [1, 5, 6, 30, 31, 90]) {
        const f = estimarCreditosItem({ pixelsBbox: px, indice: "ndvi", slot: slot(addDays(HOJE, -(dias - 1)), HOJE) });
        expect(f.minimo).toMatch(/^\d+\.\d{2}$/);
        expect(f.maximo).toMatch(/^\d+\.\d{2}$/);
        expect(Number(f.minimo) <= Number(f.maximo)).toBe(true);
        conferidas++;
      }
    }
    expect(conferidas).toBe(42);
  });
  it("somarFaixas: lista vazia → zero (objeto novo; FAIXA_ZERO é congelada)", () => {
    expect(somarFaixas([])).toEqual({ minimo: "0.00", maximo: "0.00" });
    expect(somarFaixas([])).not.toBe(FAIXA_ZERO);
    expect(FAIXA_ZERO).toEqual({ minimo: "0.00", maximo: "0.00" });
    expect(Object.isFrozen(FAIXA_ZERO)).toBe(true);
  });
  it("somarFaixas: soma decimal exata (0,1 + 0,2 = 0,30; e onde o ponto flutuante erraria o centavo)", () => {
    expect(somarFaixas([{ minimo: "0.1", maximo: "0.10" }, { minimo: "0.2", maximo: "0.20" }])).toEqual({ minimo: "0.30", maximo: "0.30" });
    // em ponto flutuante, 99999999999999.98 + 0.01 vira 100000000000000.00
    expect(somarFaixas([{ minimo: "99999999999999.98", maximo: "99999999999999.98" }, { minimo: "0.01", maximo: "0.01" }]))
      .toEqual({ minimo: "99999999999999.99", maximo: "99999999999999.99" });
    const itens = [262144, 100000, 1].map((px) => estimarCreditosItem({ pixelsBbox: px, indice: "ndvi", slot: slot("2026-09-05", HOJE) }));
    expect(somarFaixas(itens)).toEqual({ minimo: "139.15", maximo: "834.88" });
  });
});
