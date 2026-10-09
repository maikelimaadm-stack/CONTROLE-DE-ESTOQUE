import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIMITE_ACIMA, LIMITE_PROXIMO, MOTIVOS_DE_SAIDA, ORIGENS_DA_DATA, SITUACOES_DE_LOTACAO,
  capacidadeDaEstacao, diasDeDescanso, diasDeOcupacao, estacaoDoAno, rodizioRealizadoVersusPlanejado,
  situacaoDeLotacao, uaDoRebanho, uaPorHectare, type EntradaSituacaoDeLotacao
} from "../src/ocupacao-de-area.js";
import {
  FORMAS_DE_OBJETO, TIPOS_DE_LINHA, TIPOS_DE_OBJETO_DE_MAPA, UNIDADES_DE_CAPACIDADE, VALORES_TIPO_DE_OBJETO_DE_MAPA, formaDoTipo
} from "../src/objetos-de-mapa.js";
import { enumLabel, hasEnumLabel } from "../src/labels.js";
import { allPermissionKeys, PERMISSION_RESOURCES } from "../src/permissions.js";
import { moduloDaPermissao, validarClassificacaoEscopo } from "../src/escopo-permissao.js";
import * as dominio from "../src/index.js";

/**
 * MAPA-MANEJO-01 — o domínio da ocupação de área (MM-11a: dias, UA, lotação; MM-11b: rodízio realizado ×
 * planejado) e o catálogo dos objetos do mapa. Asserções exatas: string decimal, número inteiro de dias.
 */

const DIR_MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations");

/**
 * Valores da CHECK nomeada, na migration MAIS RECENTE que a declara (quem redefine a CHECK depois manda).
 * `null` quando nenhuma migration a declara — a premissa falha alto, nunca vira lista vazia.
 */
function valoresDaCheck(padrao: RegExp): { arquivo: string; valores: string[] } | null {
  const arquivos = readdirSync(DIR_MIGRATIONS).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort().reverse();
  for (const arquivo of arquivos) {
    const ultimo = [...readFileSync(join(DIR_MIGRATIONS, arquivo), "utf8").matchAll(padrao)].at(-1);
    if (ultimo?.[1] !== undefined) return { arquivo, valores: [...ultimo[1].matchAll(/'([^']*)'|([a-z_]+)/g)].map((x) => x[1] ?? x[2] ?? "") };
  }
  return null;
}

/** Só a referência de capacidade (UA/ha) presente. */
const soCapacidade = (uaHa: string, capacidade: string): EntradaSituacaoDeLotacao =>
  ({ uaPorHectare: uaHa, capacidadeDaEstacaoUaHa: capacidade, uaTotal: null, maxStockingUa: null });
/** Só a lotação máxima (UA total) presente. */
const soMaximo = (uaTotal: string, max: string): EntradaSituacaoDeLotacao =>
  ({ uaPorHectare: null, capacidadeDaEstacaoUaHa: null, uaTotal, maxStockingUa: max });

describe("MM-11a — dias de ocupação e de descanso", () => {
  it("MM-11a diasDeOcupacao: fim − início; dia da entrada = 0; aberta conta até hoje; nunca negativo", () => {
    expect(diasDeOcupacao("2026-03-01", "2026-03-01", "2026-04-01")).toBe(0);
    expect(diasDeOcupacao("2026-03-01", "2026-03-11", "2026-04-01")).toBe(10);
    expect(diasDeOcupacao("2026-03-01", null, "2026-03-31")).toBe(30);
    expect(diasDeOcupacao("2026-03-01", null, "2026-03-01")).toBe(0);
    // entrada no futuro: 0, não negativo
    expect(diasDeOcupacao("2026-04-10", null, "2026-04-01")).toBe(0);
  });
  it("MM-11a diasDeOcupacao: aritmética de calendário em UTC (virada de mês, de ano e ano bissexto)", () => {
    expect(diasDeOcupacao("2026-02-25", null, "2026-03-05")).toBe(8);
    expect(diasDeOcupacao("2025-12-30", "2026-01-02", "2026-06-01")).toBe(3);
    expect(diasDeOcupacao("2028-02-28", "2028-03-01", "2028-06-01")).toBe(2);
    // a troca de horário de verão de outros fusos não muda nada: é dia de calendário
    expect(diasDeOcupacao("2026-03-07", "2026-03-09", "2026-06-01")).toBe(2);
  });
  it("MM-11a diasDeOcupacao: data inválida LANÇA (nunca vira NaN nem 0)", () => {
    expect(() => diasDeOcupacao("2026-02-30", null, "2026-03-01")).toThrowError(RangeError);
    expect(() => diasDeOcupacao("2026-02-01", null, "01/03/2026")).toThrowError(RangeError);
  });
  it("MM-11a diasDeDescanso: null sem saída; hoje − última saída; nunca negativo", () => {
    expect(diasDeDescanso(null, "2026-03-25")).toBeNull();
    expect(diasDeDescanso("2026-03-10", "2026-03-10")).toBe(0);
    expect(diasDeDescanso("2026-03-10", "2026-03-25")).toBe(15);
    expect(diasDeDescanso("2026-04-01", "2026-03-25")).toBe(0);
  });
});

describe("MM-11a — UA e lotação", () => {
  it("MM-11a uaPorHectare: denominador é usable_area_ha, 2 casas, meio para cima", () => {
    // área com area_ha 120 e usable_area_ha 100: a lotação é 150 ÷ 100, nunca 150 ÷ 120
    expect(uaPorHectare("150.00", "100.00")).toBe("1.50");
    expect(uaPorHectare("10", "3")).toBe("3.33");
    expect(uaPorHectare("2", "3")).toBe("0.67");
    expect(uaPorHectare("0.125", "1")).toBe("0.13");
    expect(uaPorHectare("0", "50")).toBe("0.00");
  });
  it("MM-11a uaPorHectare: área útil nula, 0 ou negativa → null (sem divisão por zero)", () => {
    expect(uaPorHectare("50", null)).toBeNull();
    expect(uaPorHectare("50", "0")).toBeNull();
    expect(uaPorHectare("50", "0.00")).toBeNull();
    expect(uaPorHectare("50", "-5")).toBeNull();
  });
  it("MM-11a uaDoRebanho: peso total dos pesados ÷ 450 + soma dos fatores dos não pesados", () => {
    expect(uaDoRebanho("4500", "3.25")).toBe("13.25");
    expect(uaDoRebanho("450", null)).toBe("1.00");
    expect(uaDoRebanho(null, "2.5")).toBe("2.50");
    expect(uaDoRebanho(null, null)).toBe("0.00");
    // 1000 kg ÷ 450 = 2,222… (animalUnits: "2.222") → 2,22
    expect(uaDoRebanho("1000", "0")).toBe("2.22");
    expect(uaDoRebanho("1000.50", "0.75")).toBe("2.97");
  });
  it("MM-11a uaDoRebanho: valor negativo é dado corrompido e LANÇA", () => {
    expect(() => uaDoRebanho("-1", null)).toThrowError(RangeError);
    expect(() => uaDoRebanho(null, "-0.5")).toThrowError(RangeError);
  });
  it("MM-11a estacaoDoAno: águas de outubro a março, seca de abril a setembro", () => {
    expect(estacaoDoAno("2026-10-01")).toBe("aguas");
    expect(estacaoDoAno("2026-12-31")).toBe("aguas");
    expect(estacaoDoAno("2026-01-15")).toBe("aguas");
    expect(estacaoDoAno("2026-03-31")).toBe("aguas");
    expect(estacaoDoAno("2026-04-01")).toBe("seca");
    expect(estacaoDoAno("2026-07-01")).toBe("seca");
    expect(estacaoDoAno("2026-09-30")).toBe("seca");
    expect(() => estacaoDoAno("2026-13-01")).toThrowError(RangeError);
  });
  it("MM-11a capacidadeDaEstacao: a da estação; sem a da estação → null (nunca empresta a outra)", () => {
    expect(capacidadeDaEstacao("aguas", "1.50", "0.80")).toBe("1.50");
    expect(capacidadeDaEstacao("seca", "1.50", "0.80")).toBe("0.80");
    expect(capacidadeDaEstacao("seca", "1.50", null)).toBeNull();
    expect(capacidadeDaEstacao("aguas", null, "0.80")).toBeNull();
  });
  it("MM-11a situacaoDeLotacao: cortes declarados", () => {
    expect(LIMITE_PROXIMO).toBe("0.90");
    expect(LIMITE_ACIMA).toBe("1.00");
    expect(SITUACOES_DE_LOTACAO).toEqual(["dentro", "proximo", "acima"]);
  });
  it("MM-11a situacaoDeLotacao: só capacidade (UA/ha) — bordas 0.89, 0.90, 1.00, 1.01", () => {
    expect(situacaoDeLotacao(soCapacidade("0.89", "1.00"))).toBe("dentro");
    expect(situacaoDeLotacao(soCapacidade("0.90", "1.00"))).toBe("proximo");
    expect(situacaoDeLotacao(soCapacidade("1.00", "1.00"))).toBe("proximo");
    expect(situacaoDeLotacao(soCapacidade("1.01", "1.00"))).toBe("acima");
    expect(situacaoDeLotacao(soCapacidade("0.00", "1.00"))).toBe("dentro");
  });
  it("MM-11a situacaoDeLotacao: só lotação máxima (UA TOTAL, comparada com a UA total) — bordas 0.89, 0.90, 1.00, 1.01", () => {
    expect(situacaoDeLotacao(soMaximo("89", "100"))).toBe("dentro");
    expect(situacaoDeLotacao(soMaximo("90", "100"))).toBe("proximo");
    expect(situacaoDeLotacao(soMaximo("100", "100"))).toBe("proximo");
    expect(situacaoDeLotacao(soMaximo("101", "100"))).toBe("acima");
  });
  it("MM-11a situacaoDeLotacao: decimal exato, não ponto flutuante (0,99 ÷ 1,10 é 0,90 — em float daria 0,8999…)", () => {
    expect(0.99 / 1.1).toBeLessThan(0.9);
    expect(situacaoDeLotacao(soCapacidade("0.99", "1.10"))).toBe("proximo");
    expect(situacaoDeLotacao(soCapacidade("1.17", "1.30"))).toBe("proximo");
  });
  it("MM-11a situacaoDeLotacao: com as duas referências vale a MAIOR razão (a mais restritiva)", () => {
    // 0,50 de capacidade, 0,95 do máximo → próximo
    expect(situacaoDeLotacao({ uaPorHectare: "0.50", capacidadeDaEstacaoUaHa: "1.00", uaTotal: "95", maxStockingUa: "100" })).toBe("proximo");
    // 1,20 de capacidade, 0,10 do máximo → acima
    expect(situacaoDeLotacao({ uaPorHectare: "1.20", capacidadeDaEstacaoUaHa: "1.00", uaTotal: "10", maxStockingUa: "100" })).toBe("acima");
    // as duas abaixo → dentro
    expect(situacaoDeLotacao({ uaPorHectare: "0.50", capacidadeDaEstacaoUaHa: "1.00", uaTotal: "50", maxStockingUa: "100" })).toBe("dentro");
  });
  it("MM-11a situacaoDeLotacao: nenhuma referência (ausente ou ≤ 0) → null", () => {
    expect(situacaoDeLotacao({ uaPorHectare: "1.50", capacidadeDaEstacaoUaHa: null, uaTotal: "150", maxStockingUa: null })).toBeNull();
    expect(situacaoDeLotacao({ uaPorHectare: "1.50", capacidadeDaEstacaoUaHa: "0", uaTotal: "150", maxStockingUa: "0.00" })).toBeNull();
    expect(situacaoDeLotacao({ uaPorHectare: null, capacidadeDaEstacaoUaHa: null, uaTotal: null, maxStockingUa: null })).toBeNull();
  });
  it("MM-11a situacaoDeLotacao: área útil 0 → UA/ha nula → sem referência de capacidade → null", () => {
    const uaHa = uaPorHectare("50", "0");
    expect(uaHa).toBeNull();
    expect(situacaoDeLotacao({ uaPorHectare: uaHa, capacidadeDaEstacaoUaHa: "1.00", uaTotal: "50", maxStockingUa: null })).toBeNull();
    // a lotação máxima (UA total) não depende da área útil e continua valendo
    expect(situacaoDeLotacao({ uaPorHectare: uaHa, capacidadeDaEstacaoUaHa: "1.00", uaTotal: "50", maxStockingUa: "40" })).toBe("acima");
  });
});

describe("MM-11a — listas fechadas, rótulos, objetos do mapa e permissão", () => {
  it("MM-11a origem da data e motivo de saída: listas do banco, todas com rótulo PT-BR", () => {
    expect(ORIGENS_DA_DATA).toEqual(["movimento", "entrada_do_lote", "criacao_do_lote", "informada"]);
    expect(MOTIVOS_DE_SAIDA).toEqual(["transferencia", "encerramento_do_lote", "correcao"]);
    expect(ORIGENS_DA_DATA.map((v) => enumLabel("origem_da_data_ocupacao", v))).toEqual(["Movimento registrado", "Entrada do lote", "Criação do lote (estimativa)", "Informada"]);
    expect(MOTIVOS_DE_SAIDA.map((v) => enumLabel("motivo_saida_ocupacao", v))).toEqual(["Transferência", "Encerramento do lote", "Correção"]);
    expect(SITUACOES_DE_LOTACAO.map((v) => enumLabel("situacao_lotacao", v))).toEqual(["Dentro da capacidade", "Próximo da capacidade", "Acima da capacidade"]);
    expect(hasEnumLabel("origem_da_data_ocupacao", "estimada")).toBe(false);
  });
  it("MM-11a objetos do mapa: catálogo fechado, dois tipos de ponto, nenhum de linha", () => {
    expect(TIPOS_DE_OBJETO_DE_MAPA).toEqual([
      { tipo: "cocho", rotulo: "Cocho", forma: "ponto", unidadeCapacidade: "m" },
      { tipo: "deposito_a_pasto", rotulo: "Depósito a pasto", forma: "ponto", unidadeCapacidade: "t" }
    ]);
    expect(VALORES_TIPO_DE_OBJETO_DE_MAPA).toEqual(["cocho", "deposito_a_pasto"]);
    expect(FORMAS_DE_OBJETO).toEqual(["ponto", "linha"]);
    expect(UNIDADES_DE_CAPACIDADE).toEqual(["m", "t", "kg", "sc"]);
    expect(TIPOS_DE_LINHA).toEqual([]);
    expect(formaDoTipo("cocho")).toBe("ponto");
    expect(formaDoTipo("deposito_a_pasto")).toBe("ponto");
    // discriminador desconhecido NEGA: não cai em "ponto" por padrão
    expect(formaDoTipo("cerca")).toBeNull();
    expect(formaDoTipo("")).toBeNull();
  });
  it("MM-11a objetos do mapa: rótulo do tipo vem do catálogo; forma e unidade têm rótulo", () => {
    expect(VALORES_TIPO_DE_OBJETO_DE_MAPA.map((v) => enumLabel("tipo_objeto_mapa", v))).toEqual(["Cocho", "Depósito a pasto"]);
    expect(FORMAS_DE_OBJETO.map((v) => enumLabel("forma_objeto_mapa", v))).toEqual(["Ponto", "Linha"]);
    expect(UNIDADES_DE_CAPACIDADE.map((v) => enumLabel("unidade_capacidade_objeto_mapa", v))).toEqual(["metros", "toneladas", "quilos", "sacas"]);
  });
  it("MM-11a paridade com as CHECKs do banco: as listas do domínio são as mesmas, na mesma ordem", () => {
    const casos: [string, RegExp, readonly string[]][] = [
      ["chk_ocupacoes_origem_da_data", /constraint\s+chk_ocupacoes_origem_da_data\s+check\s*\(\s*origem_da_data\s+in\s*\(([^)]*)\)/gi, ORIGENS_DA_DATA],
      ["chk_ocupacoes_motivo_saida", /constraint\s+chk_ocupacoes_motivo_saida\s+check\s*\([^)]*?\bin\s*\(([^)]*)\)/gi, MOTIVOS_DE_SAIDA],
      ["chk_objetos_tipo", /constraint\s+chk_objetos_tipo\s+check\s*\(\s*tipo\s+in\s*\(([^)]*)\)/gi, VALORES_TIPO_DE_OBJETO_DE_MAPA],
      ["chk_objetos_forma", /constraint\s+chk_objetos_forma\s+check\s*\(\s*forma\s+in\s*\(([^)]*)\)/gi, FORMAS_DE_OBJETO],
      ["chk_objetos_unidade", /constraint\s+chk_objetos_unidade\s+check\s*\([^)]*?\bin\s*\(([^)]*)\)/gi, UNIDADES_DE_CAPACIDADE],
      // a lista entre chaves é a dos tipos de LINHA: tipo de linha ⇔ forma linha
      ["chk_objetos_forma_bate_com_tipo", /constraint\s+chk_objetos_forma_bate_com_tipo\s+check\s*\(\s*\(\s*tipo\s*=\s*any\s*\(\s*'\{([^}]*)\}'::text\[\]\s*\)\s*\)\s*=\s*\(\s*forma\s*=\s*'linha'\s*\)\s*\)/gi, TIPOS_DE_LINHA]
    ];
    for (const [nome, padrao, dominio] of casos) {
      const r = valoresDaCheck(padrao);
      expect(r?.arquivo && r.arquivo >= "0061", `a premissa — ${nome} existe desde a 0061 (${r?.arquivo})`).toBe(true);
      expect(r?.valores, nome).toEqual([...dominio]);
    }
  });
  it("MM-11a sem ícone no catálogo (os desenhos vêm depois)", () => {
    for (const t of TIPOS_DE_OBJETO_DE_MAPA) expect(Object.keys(t).sort()).toEqual(["forma", "rotulo", "tipo", "unidadeCapacidade"]);
  });
  it("MM-11a permissão map_objects: CRUD, grupo Mapa geral, escopo pecuária (não o módulo mapa)", () => {
    const r = PERMISSION_RESOURCES.find((p) => p.key === "map_objects");
    expect(r).toEqual({ key: "map_objects", label: "Objetos do mapa", module: "Mapa geral", actions: ["view", "create", "edit", "delete"] });
    const chaves = allPermissionKeys().filter((k) => k.startsWith("map_objects."));
    expect(chaves).toEqual(["map_objects.view", "map_objects.create", "map_objects.edit", "map_objects.delete"]);
    for (const k of chaves) expect(moduloDaPermissao(k), k).toBe("pecuaria");
    expect(moduloDaPermissao("mapa_areas.view")).toBe("mapa");
    expect(validarClassificacaoEscopo()).toEqual([]);
  });
  it("MM-11a o barril do domínio exporta os dois módulos novos", () => {
    expect(dominio.rodizioRealizadoVersusPlanejado).toBe(rodizioRealizadoVersusPlanejado);
    expect(dominio.situacaoDeLotacao).toBe(situacaoDeLotacao);
    expect(dominio.formaDoTipo).toBe(formaDoTipo);
    expect(dominio.TIPOS_DE_OBJETO_DE_MAPA).toBe(TIPOS_DE_OBJETO_DE_MAPA);
  });
});

describe("MM-11b — rodízio realizado × planejado", () => {
  it("MM-11b dois lotes sobrepostos viram UM ciclo da área (ordem de entrada irrelevante)", () => {
    const r = rodizioRealizadoVersusPlanejado(
      [{ dataInicio: "2026-01-10", dataFim: "2026-01-25" }, { dataInicio: "2026-01-01", dataFim: "2026-01-20" }],
      30, 20, "2026-03-01"
    );
    expect(r.ciclos).toEqual([{ inicio: "2026-01-01", fim: "2026-01-25", diasOcupacao: 24, diasDescansoAntes: null }]);
    expect(r.ocupacao).toEqual({ planejado: 20, ultimo: 24, medio: "24.0", diferencaUltimo: 4 });
    // área vazia: descanso em curso = 25/01 → 01/03 = 35 dias; nenhum descanso completo ainda
    expect(r.descanso).toEqual({ planejado: 30, ultimo: 35, medio: null, diferencaUltimo: 5 });
  });
  it("MM-11b entrada no mesmo dia da saída toca e funde; um dia de diferença já é descanso de 1 dia", () => {
    const tocando = rodizioRealizadoVersusPlanejado(
      [{ dataInicio: "2026-01-01", dataFim: "2026-01-10" }, { dataInicio: "2026-01-10", dataFim: "2026-01-20" }], null, null, "2026-01-20");
    expect(tocando.ciclos).toEqual([{ inicio: "2026-01-01", fim: "2026-01-20", diasOcupacao: 19, diasDescansoAntes: null }]);
    const umDia = rodizioRealizadoVersusPlanejado(
      [{ dataInicio: "2026-01-01", dataFim: "2026-01-10" }, { dataInicio: "2026-01-11", dataFim: "2026-01-20" }], null, null, "2026-01-20");
    expect(umDia.ciclos).toEqual([
      { inicio: "2026-01-01", fim: "2026-01-10", diasOcupacao: 9, diasDescansoAntes: null },
      { inicio: "2026-01-11", fim: "2026-01-20", diasOcupacao: 9, diasDescansoAntes: 1 }
    ]);
  });
  it("MM-11b ocupação aberta absorve o que começa depois dela", () => {
    const r = rodizioRealizadoVersusPlanejado(
      [{ dataInicio: "2026-02-01", dataFim: "2026-02-10" }, { dataInicio: "2026-01-01", dataFim: null }], 30, 20, "2026-03-01");
    expect(r.ciclos).toEqual([{ inicio: "2026-01-01", fim: null, diasOcupacao: 59, diasDescansoAntes: null }]);
    expect(r.ocupacao).toEqual({ planejado: 20, ultimo: 59, medio: null, diferencaUltimo: 39 });
    // um ciclo só, ainda ocupado: não há descanso a medir
    expect(r.descanso).toEqual({ planejado: 30, ultimo: null, medio: null, diferencaUltimo: null });
  });
  it("MM-11b descanso entre ciclos; área ocupada → último descanso é o que antecedeu o ciclo atual", () => {
    const r = rodizioRealizadoVersusPlanejado(
      [
        { dataInicio: "2026-03-01", dataFim: null },
        { dataInicio: "2026-01-01", dataFim: "2026-01-10" },
        { dataInicio: "2026-02-09", dataFim: "2026-02-14" }
      ],
      28, 7, "2026-03-05"
    );
    expect(r.ciclos).toEqual([
      { inicio: "2026-01-01", fim: "2026-01-10", diasOcupacao: 9, diasDescansoAntes: null },
      { inicio: "2026-02-09", fim: "2026-02-14", diasOcupacao: 5, diasDescansoAntes: 30 },
      { inicio: "2026-03-01", fim: null, diasOcupacao: 4, diasDescansoAntes: 15 }
    ]);
    // ocupação: último = o aberto até hoje (4); médio = ciclos fechados (9 + 5) ÷ 2
    expect(r.ocupacao).toEqual({ planejado: 7, ultimo: 4, medio: "7.0", diferencaUltimo: -3 });
    // descanso: último = 14/02 → 01/03 (15); médio = (30 + 15) ÷ 2
    expect(r.descanso).toEqual({ planejado: 28, ultimo: 15, medio: "22.5", diferencaUltimo: -13 });
  });
  it("MM-11b área vazia → descanso conta até hoje", () => {
    const r = rodizioRealizadoVersusPlanejado(
      [{ dataInicio: "2026-04-01", dataFim: "2026-04-10" }, { dataInicio: "2026-05-10", dataFim: "2026-05-31" }], 35, 15, "2026-06-30");
    expect(r.ciclos).toEqual([
      { inicio: "2026-04-01", fim: "2026-04-10", diasOcupacao: 9, diasDescansoAntes: null },
      { inicio: "2026-05-10", fim: "2026-05-31", diasOcupacao: 21, diasDescansoAntes: 30 }
    ]);
    expect(r.ocupacao).toEqual({ planejado: 15, ultimo: 21, medio: "15.0", diferencaUltimo: 6 });
    // descanso em curso: 31/05 → 30/06 = 30; médio só dos descansos completos (30)
    expect(r.descanso).toEqual({ planejado: 35, ultimo: 30, medio: "30.0", diferencaUltimo: -5 });
  });
  it("MM-11b planejado nulo → diferença nula (o realizado continua medido)", () => {
    const r = rodizioRealizadoVersusPlanejado(
      [{ dataInicio: "2026-04-01", dataFim: "2026-04-10" }, { dataInicio: "2026-05-10", dataFim: "2026-05-31" }], null, null, "2026-06-30");
    expect(r.ocupacao).toEqual({ planejado: null, ultimo: 21, medio: "15.0", diferencaUltimo: null });
    expect(r.descanso).toEqual({ planejado: null, ultimo: 30, medio: "30.0", diferencaUltimo: null });
  });
  it("MM-11b área sem ocupação: nenhum ciclo, nada medido", () => {
    expect(rodizioRealizadoVersusPlanejado([], 30, 20, "2026-06-30")).toEqual({
      ciclos: [],
      ocupacao: { planejado: 20, ultimo: null, medio: null, diferencaUltimo: null },
      descanso: { planejado: 30, ultimo: null, medio: null, diferencaUltimo: null }
    });
  });
  it("MM-11b média com 1 casa, meio para cima (0,25 → 0,3)", () => {
    const r = rodizioRealizadoVersusPlanejado(
      [
        { dataInicio: "2026-01-01", dataFim: "2026-01-01" }, { dataInicio: "2026-01-03", dataFim: "2026-01-03" },
        { dataInicio: "2026-01-05", dataFim: "2026-01-05" }, { dataInicio: "2026-01-07", dataFim: "2026-01-08" }
      ],
      null, null, "2026-01-08"
    );
    expect(r.ciclos.map((c) => c.diasOcupacao)).toEqual([0, 0, 0, 1]);
    expect(r.ocupacao.medio).toBe("0.3");
    expect(r.descanso.medio).toBe("2.0");
  });
  it("MM-11b período com fim antes do início é dado corrompido e LANÇA", () => {
    expect(() => rodizioRealizadoVersusPlanejado([{ dataInicio: "2026-02-10", dataFim: "2026-02-01" }], null, null, "2026-03-01")).toThrowError(RangeError);
  });
});
