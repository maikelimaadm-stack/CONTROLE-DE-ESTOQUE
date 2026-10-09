/**
 * OCUPAÇÃO DE ÁREA E LOTAÇÃO — MAPA-MANEJO-01.
 *
 * Funções PURAS (sem I/O) sobre `erp.ocupacoes_de_area` (migration 0061), `erp.areas` e
 * `erp.grazing_modules`. A API agrega no SQL e entrega aqui só o que é preciso para fechar a conta;
 * a tela apresenta. Ninguém redigita estas regras — API, tela e testes consomem DESTE arquivo.
 *
 * Datas são ISO `YYYY-MM-DD` (date do banco, sem hora) e a aritmética é em UTC: dia de calendário,
 * nunca fuso. Quantidades decimais trafegam como string e são calculadas com decimal.js (`D`),
 * nunca com ponto flutuante. O arredondamento de apresentação é MEIO PARA CIMA (`ROUND_HALF_UP`), o mesmo
 * do `round(numeric)` do Postgres para valores positivos: o número da tela bate com o do SQL e com a
 * calculadora de quem confere.
 *
 * O período de uma ocupação é `[data_inicio, data_fim]`, inclusivo nos dois lados; `data_fim` nula é
 * ocupação ABERTA (o lote ainda está na área). Vários lotes podem ocupar a mesma área ao mesmo tempo.
 */
import { D, Decimal, isISODate, type DecimalString, type ISODate } from "@agro/shared";
import { animalUnits } from "./livestock.js";

/**
 * De onde veio `data_inicio` da ocupação (CHECK de `erp.ocupacoes_de_area.origem_da_data`). Lista fechada,
 * na ordem da confiança: a data de um movimento registrado é fato; `criacao_do_lote` é estimativa.
 */
export const ORIGENS_DA_DATA = ["movimento", "entrada_do_lote", "criacao_do_lote", "informada"] as const;
export type OrigemDaData = (typeof ORIGENS_DA_DATA)[number];

/** Por que a ocupação terminou (CHECK de `erp.ocupacoes_de_area.motivo_saida`; nulo na ocupação aberta). */
export const MOTIVOS_DE_SAIDA = ["transferencia", "encerramento_do_lote", "correcao"] as const;
export type MotivoDeSaida = (typeof MOTIVOS_DE_SAIDA)[number];

/** Estações do ano para a capacidade de suporte da área. */
export const ESTACOES_DO_ANO = ["aguas", "seca"] as const;
export type EstacaoDoAno = (typeof ESTACOES_DO_ANO)[number];

/** Situação da lotação da área frente às referências cadastradas. */
export const SITUACOES_DE_LOTACAO = ["dentro", "proximo", "acima"] as const;
export type SituacaoDeLotacao = (typeof SITUACOES_DE_LOTACAO)[number];

/**
 * CORTES DA SITUAÇÃO DE LOTAÇÃO (razão de uso = carga atual ÷ referência).
 *
 * - `LIMITE_PROXIMO` ("0.90"): a partir de 90% da referência a área está PRÓXIMA da capacidade. Os 10% de
 *   margem existem para dar tempo de planejar a saída do lote ANTES de passar da capacidade: a recuperação
 *   do pasto depende de não ultrapassá-la, e o aviso que chega só quando já passou chega tarde.
 * - `LIMITE_ACIMA` ("1.00"): acima de 100% (estritamente maior) a área está ACIMA da capacidade. Exatamente
 *   100% ainda é "próximo" — está no limite, não além dele.
 */
export const LIMITE_PROXIMO: DecimalString = "0.90";
export const LIMITE_ACIMA: DecimalString = "1.00";

const MS_POR_DIA = 86_400_000;

function instanteUTC(data: ISODate, campo: string): number {
  if (typeof data !== "string" || !isISODate(data)) throw new RangeError(`${campo}: data inválida (esperado AAAA-MM-DD): ${String(data)}`);
  return Date.parse(`${data}T00:00:00Z`);
}

/** Dias corridos de `de` até `ate` (UTC, dia de calendário). Negativo quando `ate` vem antes. */
function diasEntre(de: ISODate, ate: ISODate, campoDe: string, campoAte: string): number {
  return Math.round((instanteUTC(ate, campoAte) - instanteUTC(de, campoDe)) / MS_POR_DIA);
}

/**
 * Dias de ocupação de um período: `(dataFim ?? hoje) − dataInicio`, nunca negativo.
 * O dia da entrada conta 0 dias (é tempo decorrido, não contagem de datas). Ocupação aberta
 * (`dataFim` nula) conta até `hoje`; entrada no futuro devolve 0.
 */
export function diasDeOcupacao(dataInicio: ISODate, dataFim: ISODate | null, hoje: ISODate): number {
  const fim = dataFim ?? hoje;
  return Math.max(0, diasEntre(dataInicio, fim, "dataInicio", dataFim === null ? "hoje" : "dataFim"));
}

/**
 * Dias de descanso da área desde a última saída: `hoje − ultimaSaidaDaArea`, nunca negativo.
 * `null` quando a área nunca teve saída (nunca foi ocupada, ou continua ocupada desde a primeira entrada) —
 * "sem descanso registrado" é diferente de "0 dias de descanso".
 */
export function diasDeDescanso(ultimaSaidaDaArea: ISODate | null, hoje: ISODate): number | null {
  if (ultimaSaidaDaArea === null) return null;
  return Math.max(0, diasEntre(ultimaSaidaDaArea, hoje, "ultimaSaidaDaArea", "hoje"));
}

/**
 * Lotação em UA/ha, com 2 casas: `uaTotal ÷ usableAreaHa`.
 *
 * O denominador é `erp.areas.usable_area_ha` — a área pastejável/arável, que a COMMENT da migration
 * 0050 (linha 228) declara como "denominador de lotação e custo/ha". NUNCA `area_ha` (área total do
 * polígono, que inclui reserva, estrada e benfeitoria e por isso subestima a lotação).
 *
 * `null` quando a área útil é nula ou ≤ 0: sem denominador não há lotação a mostrar (nunca divide por zero,
 * nunca inventa 0).
 */
export function uaPorHectare(uaTotal: DecimalString, usableAreaHa: DecimalString | null): DecimalString | null {
  if (usableAreaHa === null) return null;
  const area = D(usableAreaHa);
  if (area.lte(0)) return null;
  return D(uaTotal).div(area).toFixed(2, Decimal.ROUND_HALF_UP);
}

/**
 * UA do rebanho de uma área (ou de um lote), com 2 casas.
 *
 * REGRA: quando o animal tem PESO (> 0), o peso manda — a UA é DEFINIDA por 450 kg (`animalUnits`), e o
 * `ua_factor` da categoria (`erp.animal_categories.ua_factor`) é só uma estimativa para quem não foi pesado.
 * Sem peso (nulo ou 0), vale o `ua_factor` da categoria.
 *
 * Como a soma é linear, a API não precisa trazer animal por animal: agrega no SQL o PESO TOTAL dos animais
 * pesados e a SOMA DOS FATORES dos não pesados, e este fecho devolve
 * `animalUnits(pesoTotalKgDosPesados) + uaPorFatorDosNaoPesados`. Animal sem peso e sem fator não soma UA —
 * quem agrega deve contar e informar esses animais em vez de esconder a falta.
 *
 * `animalUnits` devolve 3 casas (o contrato dela); o total é arredondado a 2 casas aqui.
 * Valor negativo é dado corrompido e LANÇA (não vira lotação menor em silêncio).
 */
export function uaDoRebanho(pesoTotalKgDosPesados: DecimalString | null, uaPorFatorDosNaoPesados: DecimalString | null): DecimalString {
  const peso = D(pesoTotalKgDosPesados ?? "0");
  const fatores = D(uaPorFatorDosNaoPesados ?? "0");
  if (peso.isNegative() || fatores.isNegative()) throw new RangeError("uaDoRebanho: peso total e soma de fatores não podem ser negativos");
  return D(animalUnits(peso.toString())).plus(fatores).toFixed(2, Decimal.ROUND_HALF_UP);
}

/**
 * Estação do ano de uma data: `aguas` de OUTUBRO a MARÇO; `seca` de ABRIL a SETEMBRO.
 *
 * É CONVENÇÃO, não medição: é o regime de chuvas do Centro-Oeste (Cerrado), onde o produto opera hoje e
 * onde a capacidade de suporte do pasto se cadastra em dois números (águas e seca — `erp.areas`). O mês
 * decide sozinho, sem chuva medida nem latitude; uma região com outro regime precisará de outra regra,
 * declarada aqui.
 */
export function estacaoDoAno(data: ISODate): EstacaoDoAno {
  instanteUTC(data, "data");
  const mes = Number(data.slice(5, 7));
  return mes >= 10 || mes <= 3 ? "aguas" : "seca";
}

/**
 * Capacidade de suporte da estação (UA/ha): `support_capacity_rainy_ua_ha` nas águas,
 * `support_capacity_dry_ua_ha` na seca. `null` quando a da estação não está cadastrada — nunca empresta a
 * da outra estação.
 */
export function capacidadeDaEstacao(estacao: EstacaoDoAno, rainyUaHa: DecimalString | null, dryUaHa: DecimalString | null): DecimalString | null {
  if (estacao === "aguas") return rainyUaHa;
  if (estacao === "seca") return dryUaHa;
  throw new RangeError(`estação desconhecida: ${String(estacao)}`);
}

/** Entrada de `situacaoDeLotacao`: a carga atual e as duas referências cadastradas da área. */
export interface EntradaSituacaoDeLotacao {
  /** Lotação atual em UA/ha (`uaPorHectare`). */
  uaPorHectare: DecimalString | null;
  /** Capacidade de suporte da estação atual em UA/ha (`capacidadeDaEstacao`). */
  capacidadeDaEstacaoUaHa: DecimalString | null;
  /** UA total presente na área (`uaDoRebanho`). */
  uaTotal: DecimalString | null;
  /** `erp.areas.max_stocking_ua`: lotação máxima da área em UA TOTAL (não por hectare). */
  maxStockingUa: DecimalString | null;
}

/**
 * Situação da lotação: `dentro`, `proximo` ou `acima` da capacidade; `null` quando não há referência
 * (o chamador mostra "sem referência" — nunca "dentro").
 *
 * A razão de uso é a MAIOR entre as duas referências presentes (e > 0):
 * - `uaPorHectare ÷ capacidadeDaEstacaoUaHa` — as duas em UA/ha;
 * - `uaTotal ÷ maxStockingUa` — `max_stocking_ua` é a lotação máxima da área em UA TOTAL (rótulo
 *   "Lotação máxima (UA)" em registries.ts), por isso compara com a UA total e NÃO com a UA/ha.
 * Vale a mais restritiva: estar dentro de uma referência não compensa estourar a outra.
 *
 * Cortes (`LIMITE_PROXIMO`, `LIMITE_ACIMA`): razão > 1,00 → `acima`; razão ≥ 0,90 → `proximo`;
 * senão `dentro`. Comparação em decimal.js, nunca em ponto flutuante.
 */
export function situacaoDeLotacao(entrada: EntradaSituacaoDeLotacao): SituacaoDeLotacao | null {
  const razoes = [
    razao(entrada.uaPorHectare, entrada.capacidadeDaEstacaoUaHa),
    razao(entrada.uaTotal, entrada.maxStockingUa)
  ].filter((r): r is Decimal => r !== null);
  if (razoes.length === 0) return null;
  const maior = razoes.reduce((a, b) => (b.gt(a) ? b : a));
  if (maior.gt(LIMITE_ACIMA)) return "acima";
  if (maior.gte(LIMITE_PROXIMO)) return "proximo";
  return "dentro";
}

function razao(carga: DecimalString | null, referencia: DecimalString | null): Decimal | null {
  if (carga === null || referencia === null) return null;
  const ref = D(referencia);
  if (ref.lte(0)) return null;
  return D(carga).div(ref);
}

/** Uma ocupação da área, como sai de `erp.ocupacoes_de_area` (qualquer lote). */
export interface PeriodoDeOcupacao {
  dataInicio: ISODate;
  dataFim: ISODate | null;
}

/** Um ciclo de ocupação DA ÁREA: a união dos períodos de todos os lotes que se sobrepõem ou se tocam. */
export interface CicloDeOcupacao {
  inicio: ISODate;
  /** `null` = a área continua ocupada. */
  fim: ISODate | null;
  /** `diasDeOcupacao(inicio, fim, hoje)`. */
  diasOcupacao: number;
  /** Dias entre o fim do ciclo anterior e o início deste; `null` no primeiro ciclo. */
  diasDescansoAntes: number | null;
}

/** Planejado × realizado de uma grandeza do rodízio (ocupação ou descanso), em dias. */
export interface ComparacaoRodizio {
  /** `occupation_days` / `rest_days` do módulo de pastejo; `null` quando não planejado. */
  planejado: number | null;
  /** Do ciclo mais recente; `null` quando ainda não há o que medir. */
  ultimo: number | null;
  /** Média dos ciclos FECHADOS, 1 casa decimal (string); `null` sem ciclo fechado. */
  medio: DecimalString | null;
  /** `ultimo − planejado`; `null` se algum dos dois for `null`. Positivo = passou do planejado. */
  diferencaUltimo: number | null;
}

export interface RodizioRealizadoVersusPlanejado {
  /** Ciclos da área em ordem cronológica. */
  ciclos: CicloDeOcupacao[];
  ocupacao: ComparacaoRodizio;
  descanso: ComparacaoRodizio;
}

/**
 * RODÍZIO REALIZADO × PLANEJADO de uma área.
 *
 * É a PRIMEIRA consumidora de `erp.grazing_modules.rest_days` e `occupation_days`: até aqui eles eram só
 * cadastrados — nada no banco nem na aplicação comparava o plano com o realizado.
 *
 * 1. Funde as ocupações da área num só histórico: vários lotes ao mesmo tempo são UM período de ocupação da
 *    ÁREA (união de intervalos). Ordena por data; períodos que se sobrepõem ou SE TOCAM (a entrada de um no
 *    mesmo dia da saída do outro — descanso de 0 dias) viram um só ciclo. Um dia de diferença já é
 *    descanso de 1 dia, coerente com `diasDeDescanso` (tempo decorrido). Período aberto absorve todo
 *    período que começa depois dele.
 * 2. OCUPAÇÃO: `ultimo` = dias do ciclo mais recente (aberto conta até `hoje`); `medio` = média dos ciclos
 *    fechados.
 * 3. DESCANSO: `ultimo` = se a área está VAZIA, de fim do último ciclo até `hoje` (descanso em curso); se
 *    está ocupada, o intervalo entre o fim do penúltimo e o início do último; com um ciclo só e ocupado,
 *    `null`. `medio` = média dos descansos completos (entre dois ciclos).
 *
 * Período com `dataFim` anterior a `dataInicio` é dado corrompido e LANÇA.
 */
export function rodizioRealizadoVersusPlanejado(
  ocupacoesDaArea: readonly PeriodoDeOcupacao[],
  restDays: number | null,
  occupationDays: number | null,
  hoje: ISODate
): RodizioRealizadoVersusPlanejado {
  instanteUTC(hoje, "hoje");
  const periodos = ocupacoesDaArea.map((p, i) => {
    instanteUTC(p.dataInicio, `ocupacoesDaArea[${i}].dataInicio`);
    if (p.dataFim !== null && diasEntre(p.dataInicio, p.dataFim, `ocupacoesDaArea[${i}].dataInicio`, `ocupacoesDaArea[${i}].dataFim`) < 0) {
      throw new RangeError(`ocupacoesDaArea[${i}]: dataFim (${p.dataFim}) anterior a dataInicio (${p.dataInicio})`);
    }
    return { inicio: p.dataInicio, fim: p.dataFim };
  });
  // ISO AAAA-MM-DD ordena como texto; no mesmo início, o aberto (fim nulo) vem por último.
  periodos.sort((a, b) => (a.inicio !== b.inicio ? (a.inicio < b.inicio ? -1 : 1) : comparaFim(a.fim, b.fim)));

  const fundidos: { inicio: ISODate; fim: ISODate | null }[] = [];
  for (const p of periodos) {
    const atual = fundidos[fundidos.length - 1];
    if (atual && (atual.fim === null || p.inicio <= atual.fim)) {
      if (atual.fim !== null && (p.fim === null || p.fim > atual.fim)) atual.fim = p.fim;
      continue;
    }
    fundidos.push({ inicio: p.inicio, fim: p.fim });
  }

  const ciclos: CicloDeOcupacao[] = fundidos.map((c, i) => {
    const anterior = i > 0 ? fundidos[i - 1]! : null;
    return {
      inicio: c.inicio,
      fim: c.fim,
      diasOcupacao: diasDeOcupacao(c.inicio, c.fim, hoje),
      // o anterior está sempre fechado: um aberto teria absorvido este ciclo
      diasDescansoAntes: anterior?.fim ? diasEntre(anterior.fim, c.inicio, "fim", "inicio") : null
    };
  });

  const ultimoCiclo = ciclos[ciclos.length - 1] ?? null;
  const ocupacaoUltimo = ultimoCiclo ? ultimoCiclo.diasOcupacao : null;
  const ocupacaoFechados = ciclos.filter((c) => c.fim !== null).map((c) => c.diasOcupacao);

  let descansoUltimo: number | null = null;
  if (ultimoCiclo?.fim) descansoUltimo = diasDeDescanso(ultimoCiclo.fim, hoje);
  else if (ultimoCiclo) descansoUltimo = ultimoCiclo.diasDescansoAntes;
  const descansosCompletos = ciclos.map((c) => c.diasDescansoAntes).filter((d): d is number => d !== null);

  return {
    ciclos,
    ocupacao: comparacao(occupationDays, ocupacaoUltimo, ocupacaoFechados),
    descanso: comparacao(restDays, descansoUltimo, descansosCompletos)
  };
}

function comparaFim(a: ISODate | null, b: ISODate | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

function comparacao(planejado: number | null, ultimo: number | null, fechados: readonly number[]): ComparacaoRodizio {
  return {
    planejado,
    ultimo,
    medio: fechados.length === 0 ? null : fechados.reduce((s, d) => s.plus(d), D(0)).div(fechados.length).toFixed(1, Decimal.ROUND_HALF_UP),
    diferencaUltimo: planejado === null || ultimo === null ? null : ultimo - planejado
  };
}
