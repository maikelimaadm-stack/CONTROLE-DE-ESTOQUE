/**
 * CONSULTA SATELITAL EM LOTE (SAT-02, decisão 295) — UM dono das listas, do recorte do período em slots, da origem
 * da chave de idempotência e da ESTIMATIVA de créditos.
 *
 * Uma consulta pede o NDVI de várias áreas em vários slots de tempo de uma vez. Cada combinação área × slot × índice
 * vira um item da fila (`erp.satelite_consulta_itens`); quem executa os itens fica para outra fatia. Aqui mora só o
 * que é PURO e precisa dar o mesmo resultado na API, nos testes e na web: nada de relógio (o "hoje" vem por
 * parâmetro), nada de `node:crypto` (o sha256 da chave é feito na API, sobre a origem montada aqui) e nada de ponto
 * flutuante na conta de crédito (decimal.js via `D`/`money`, saída em string decimal).
 *
 * As listas da SAT-01 (provedor, coleção, índice, critério de observação útil) continuam em `analise-satelital.ts`;
 * este arquivo só acrescenta o que a consulta em lote tem de próprio e reaproveita de lá o que é a mesma coisa.
 */
import { D, addDays, compareISO, isISODate, isoToBR, money, qty, type Decimal } from "@agro/shared";
import { INDICE_NDVI } from "./analise-satelital.js";
import { BANDAS_POR_BUNDLE, BUNDLE_PASTAGEM_ESSENCIAL, VERSAO_METODO_PASTAGEM_ESSENCIAL } from "./indices-satelitais.js";

/**
 * Versão do método da consulta em lote. É outra versão que a da SAT-01 (`VERSAO_METODO_NDVI`) porque a janela deixa
 * de ser sempre "os últimos 30 dias": o slot muda o número, e análises de métodos diferentes não se reaproveitam.
 */
export const VERSAO_METODO_NDVI_V2 = "ndvi-v2";

/** `indice_bundle` aceito: NDVI avulso (SAT-02/03) ou o bundle essencial multi-índice (SAT-08). */
export const INDICES_CONSULTA_SATELITE = [INDICE_NDVI, BUNDLE_PASTAGEM_ESSENCIAL] as const;
export type IndiceBundleConsulta = (typeof INDICES_CONSULTA_SATELITE)[number];

/** Versão do método por bundle — o executor só aceita o par conhecido. */
export const VERSAO_METODO_POR_BUNDLE: Readonly<Record<IndiceBundleConsulta, string>> = {
  ndvi: VERSAO_METODO_NDVI_V2,
  pastagem_essencial: VERSAO_METODO_PASTAGEM_ESSENCIAL
};

/** Situação da consulta (o pedido inteiro). */
export const SITUACOES_CONSULTA_SATELITE: readonly [string, string][] = [
  ["pendente", "Pendente"],
  ["executando", "Em execução"],
  ["concluida", "Concluída"],
  ["concluida_com_falhas", "Concluída com falhas"],
  ["cancelada", "Cancelada"]
] as const;

/** Situação de cada item da fila (uma área × um slot × um índice). */
export const SITUACOES_ITEM_CONSULTA_SATELITE: readonly [string, string][] = [
  ["pendente", "Pendente"],
  ["executando", "Em execução"],
  ["concluido", "Concluído"],
  ["reaproveitado", "Reaproveitado"],
  ["falho", "Falhou"],
  ["cancelado", "Cancelado"]
] as const;

/**
 * Situações VIVAS: as únicas que valem a unicidade da chave (índice parcial da 0053). Um item vivo é trabalho que
 * vai acontecer, está acontecendo ou já aconteceu — pedir de novo seria pagar duas vezes. 'reaproveitado' (quem
 * aproveitou o item vivo de outra consulta), 'falho' e 'cancelado' podem repetir a chave: a falha pode ser pedida
 * de novo, e o reaproveitamento é justamente a repetição registrada.
 */
export const SITUACOES_ITEM_VIVAS = ["pendente", "executando", "concluido"] as const;

/** Operação do provedor que gastou PU, no ledger de consumo (`erp.satelite_consumo`). */
export const OPERACOES_CONSUMO_SATELITE = ["process", "statistical", "catalog"] as const;

/** Teto de itens de UMA consulta (áreas × slots × índices). Acima disso a consulta é recusada, não truncada. */
export const MAX_ITENS_POR_CONSULTA = 200;

/** Período "mais recente": a janela que termina hoje, em dias UTC inteiros (hoje incluído). */
export const JANELA_CONSULTA_DIAS = { minimo: 1, maximo: 90 } as const;

/** Período "data": quantos dias antes e depois da data alvo a imagem ainda serve. 0 = só a própria data. */
export const TOLERANCIA_CONSULTA_DIAS = { minimo: 0, maximo: 30 } as const;

/**
 * Primeiro dia do acervo Sentinel-2 L2A adotado por esta fatia (decisão 295). Pedido de data anterior é recusado
 * antes de virar item: a coleção não tem cena ali, e o item só gastaria crédito para voltar sem observação.
 */
export const DATA_MINIMA_SENTINEL2_L2A = "2017-03-28";

/** Conversão do provedor: 1 crédito = 0,01 PU (processing unit), ou seja, 100 créditos por PU. */
export const CREDITOS_POR_PU = 100;

/**
 * Coeficientes da estimativa — UM lugar só, para corrigir quando o consumo real for medido (o ledger
 * `erp.satelite_consumo` grava o PU que o provedor de fato cobrou, pelo cabeçalho `x-processingunits-spent`).
 *
 * - `pixelsReferencia`: a requisição de referência do provedor, 512 × 512 px, vale 1 PU de área.
 * - `fatorAreaMinimo`: piso da fração de área — requisição minúscula ainda paga 0,01 do PU de referência.
 * - `bandasReferencia`: as 3 bandas da requisição de referência; o fator de bandas é bandas do índice ÷ 3.
 * - `fatorFormato`: multiplicador do formato de saída; 1 para a Statistical API (FLOAT32 de 1 banda) até calibrar.
 * - `revisitaDias`: revisita do Sentinel-2 com os dois satélites; dá o MÁXIMO de passagens numa janela.
 *
 * São números de PREVISÃO, não de cobrança: a cobrança é o que o provedor devolve. Mudar um deles muda só a
 * estimativa das consultas novas — o que já foi gravado fica como foi estimado.
 */
export const COEFICIENTES_ESTIMATIVA_PU = {
  pixelsReferencia: 262144, // 512 × 512
  fatorAreaMinimo: 0.01,
  bandasReferencia: 3,
  fatorFormato: 1, // Statistical API, saída FLOAT32 de 1 banda (calibrar)
  revisitaDias: 5 // Sentinel-2 (2 satélites) — máximo de passagens por janela
} as const;

/**
 * Coeficientes da estimativa do Process AUTOMÁTICO do bundle (mapa integrado de condição).
 * SSOT do produto automático — NÃO inclui rasters técnicos lazy (on-demand).
 *
 * - `bandas`: bandas de entrada do evalscript de condição (B02…B11+SCL), sem dataMask.
 * - `fatorFormato`: PNG UINT8 de 1 banda; 1 = conservador até calibrar com o ledger.
 * Uma chamada Process por item (a data da observação escolhida), não multiplica pela janela.
 */
export const COEFICIENTES_ESTIMATIVA_PROCESS_CONDICAO = {
  bandas: BANDAS_POR_BUNDLE.pastagem_essencial,
  fatorFormato: 1
} as const;

/** Bandas lidas por bundle/índice (entrada do evalscript, sem dataMask). */
export const BANDAS_POR_INDICE: Readonly<Record<IndiceBundleConsulta, number>> = BANDAS_POR_BUNDLE;

/** Histórico de consultas (`GET /api/satelite/consultas`): tamanho padrão e máximo de página, no servidor. */
export const PAGINA_CONSULTAS = { padrao: 20, maximo: 100 } as const;

/** Itens de uma consulta (`GET /api/satelite/consultas/:id`): tamanho padrão e máximo de página, no servidor. */
export const PAGINA_ITENS_CONSULTA = { padrao: 50, maximo: 100 } as const;

// ---------------------------------------------------------------------------------------------------------------
// PERÍODO → SLOTS
// ---------------------------------------------------------------------------------------------------------------

export type PeriodoConsulta =
  | { tipo: "mais_recente"; janela_dias: number }
  | { tipo: "data"; data: string; tolerancia_dias: number }
  | { tipo: "intervalo"; de: string; ate: string; cadencia: "mensal" | "decendial" };

/**
 * Um recorte de tempo da consulta. Datas 'YYYY-MM-DD' em dia UTC, janela INCLUSIVA nas duas pontas.
 * `data_alvo` nulo = "a imagem útil mais recente dentro da janela" (mais recente e intervalo); preenchido = a data
 * pedida, com a tolerância em volta (período "data").
 */
export interface SlotConsulta { data_alvo: string | null; janela_inicio: string; janela_fim: string }

/**
 * Recusa do período pedido. `campo` é o CAMINHO do campo no corpo da requisição (ex.: "periodo.data"), para a API
 * devolver 422 apontando exatamente o que corrigir.
 */
export class ErroPeriodoConsulta extends Error {
  constructor(message: string, readonly campo: string) {
    super(message);
    this.name = "ErroPeriodoConsulta";
  }
}

const MS_POR_DIA = 86_400_000;

/** Número do dia UTC (dias desde 1970-01-01). Só para data já validada; o "Z" explícito tira o fuso da conta. */
function numeroDoDia(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`) / MS_POR_DIA;
}

const maiorData = (a: string, b: string) => (compareISO(a, b) >= 0 ? a : b);
const menorData = (a: string, b: string) => (compareISO(a, b) <= 0 ? a : b);

/** Último dia do mês civil (1–12): 28/29 em fevereiro conforme o ano bissexto gregoriano, 30 ou 31 nos outros. */
function ultimoDiaDoMes(ano: number, mes: number): number {
  if (mes === 2) return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0 ? 29 : 28;
  return mes === 4 || mes === 6 || mes === 9 || mes === 11 ? 30 : 31;
}

const doisDigitos = (n: number) => String(n).padStart(2, "0");
const isoDe = (ano: number, mes: number, dia: number) => `${ano}-${doisDigitos(mes)}-${doisDigitos(dia)}`;

/**
 * Data pedida pelo cliente: formato canônico E dia que existe no calendário (2026-02-30 é recusada, não "rola" para
 * março), não futura e não anterior ao acervo. A ordem das recusas é fixa: a primeira que falhar é a devolvida.
 */
function lerDataPedida(valor: unknown, hoje: string, campo: string): string {
  if (typeof valor !== "string" || !isISODate(valor)) {
    throw new ErroPeriodoConsulta("A data deve estar no formato AAAA-MM-DD e existir no calendário.", campo);
  }
  if (compareISO(valor, hoje) > 0) throw new ErroPeriodoConsulta("A data não pode estar no futuro.", campo);
  if (compareISO(valor, DATA_MINIMA_SENTINEL2_L2A) < 0) {
    throw new ErroPeriodoConsulta(`Não há imagem Sentinel-2 L2A antes de ${isoToBR(DATA_MINIMA_SENTINEL2_L2A)}.`, campo);
  }
  return valor;
}

/** Inteiro dentro da faixa. `1.5`, `NaN`, `"5"` e `Infinity` não são inteiros: recusados, nunca arredondados. */
function lerInteiroNaFaixa(valor: unknown, faixa: { minimo: number; maximo: number }, campo: string, oQue: string): number {
  if (typeof valor !== "number" || !Number.isInteger(valor) || valor < faixa.minimo || valor > faixa.maximo) {
    throw new ErroPeriodoConsulta(`${oQue} deve ser um número inteiro de ${faixa.minimo} a ${faixa.maximo} dias.`, campo);
  }
  return valor;
}

/**
 * Os slots do intervalo [de, ate], um por mês civil (mensal) ou por decêndio (dias 1–10, 11–20 e 21 ao último dia
 * do mês), cada um cortado nas pontas do intervalo. O primeiro e o último slot podem ser parciais; slot vazio não
 * existe. `data_alvo` nulo: o que vale é a imagem útil mais recente DENTRO do slot.
 */
function slotsDoIntervalo(de: string, ate: string, cadencia: "mensal" | "decendial"): SlotConsulta[] {
  const slots: SlotConsulta[] = [];
  let ano = Number(de.slice(0, 4));
  let mes = Number(de.slice(5, 7));
  const anoFim = Number(ate.slice(0, 4));
  const mesFim = Number(ate.slice(5, 7));
  while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
    const ultimo = ultimoDiaDoMes(ano, mes);
    const pedacos: [number, number][] = cadencia === "mensal" ? [[1, ultimo]] : [[1, 10], [11, 20], [21, ultimo]];
    for (const [diaInicio, diaFim] of pedacos) {
      const inicio = maiorData(isoDe(ano, mes, diaInicio), de);
      const fim = menorData(isoDe(ano, mes, diaFim), ate);
      if (compareISO(inicio, fim) <= 0) slots.push({ data_alvo: null, janela_inicio: inicio, janela_fim: fim });
    }
    mes += 1;
    if (mes > 12) { mes = 1; ano += 1; }
  }
  return slots;
}

/**
 * Os slots de tempo do período pedido. `hoje` = 'YYYY-MM-DD' (dia UTC, passado pelo chamador — a função não lê
 * relógio, para dar o mesmo resultado no teste, na API e na web).
 *
 * - mais_recente: um slot, de hoje − (janela_dias − 1) até hoje, sem data alvo.
 * - data: um slot com a data alvo e a tolerância em volta, cortado no acervo (embaixo) e em hoje (em cima).
 * - intervalo: um slot por mês ou por decêndio, cortados em [de, ate].
 *
 * Período fora do contrato é RECUSADO (ErroPeriodoConsulta, com o caminho do campo), nunca corrigido: data que não
 * existe, futura, anterior ao acervo, `de` depois de `ate`, janela ou tolerância fora da faixa, número não inteiro,
 * tipo ou cadência desconhecidos.
 */
export function slotsDoPeriodo(p: PeriodoConsulta, hoje: string): SlotConsulta[] {
  // `hoje` vem do servidor, não do cliente: inválido é defeito do chamador (500), não pedido a recusar (422).
  if (typeof hoje !== "string" || !isISODate(hoje)) throw new RangeError(`hoje inválido: ${String(hoje)}`);
  if (!p || typeof p !== "object") throw new ErroPeriodoConsulta("Informe o período da consulta.", "periodo");

  // Lido como registro solto: o tipo estático promete a forma, mas o domínio recusa o que fugir dela em execução.
  const r = p as unknown as Record<string, unknown>;
  switch (r["tipo"]) {
    case "mais_recente": {
      const janela = lerInteiroNaFaixa(r["janela_dias"], JANELA_CONSULTA_DIAS, "periodo.janela_dias", "A janela");
      return [{ data_alvo: null, janela_inicio: addDays(hoje, -(janela - 1)), janela_fim: hoje }];
    }
    case "data": {
      const data = lerDataPedida(r["data"], hoje, "periodo.data");
      const tolerancia = lerInteiroNaFaixa(r["tolerancia_dias"], TOLERANCIA_CONSULTA_DIAS, "periodo.tolerancia_dias", "A tolerância");
      return [{
        data_alvo: data,
        janela_inicio: maiorData(addDays(data, -tolerancia), DATA_MINIMA_SENTINEL2_L2A),
        janela_fim: menorData(addDays(data, tolerancia), hoje)
      }];
    }
    case "intervalo": {
      const de = lerDataPedida(r["de"], hoje, "periodo.de");
      const ate = lerDataPedida(r["ate"], hoje, "periodo.ate");
      if (compareISO(de, ate) > 0) {
        throw new ErroPeriodoConsulta("A data inicial não pode ser posterior à data final.", "periodo.de");
      }
      const cadencia = r["cadencia"];
      if (cadencia !== "mensal" && cadencia !== "decendial") {
        throw new ErroPeriodoConsulta("A cadência deve ser mensal ou decendial.", "periodo.cadencia");
      }
      return slotsDoIntervalo(de, ate, cadencia);
    }
    default:
      // Discriminador desconhecido NEGA: não cai num tipo vizinho nem num padrão.
      throw new ErroPeriodoConsulta("O tipo do período deve ser mais_recente, data ou intervalo.", "periodo.tipo");
  }
}

/** Dias da janela do slot, contando as duas pontas (início == fim → 1). Slot fora do formato é defeito: recusado. */
export function diasDaJanela(s: SlotConsulta): number {
  if (!isISODate(s.janela_inicio) || !isISODate(s.janela_fim) || compareISO(s.janela_inicio, s.janela_fim) > 0) {
    throw new RangeError(`janela inválida: ${s.janela_inicio}..${s.janela_fim}`);
  }
  return numeroDoDia(s.janela_fim) - numeroDoDia(s.janela_inicio) + 1;
}

// ---------------------------------------------------------------------------------------------------------------
// CHAVE DE IDEMPOTÊNCIA
// ---------------------------------------------------------------------------------------------------------------

const SEPARADOR_ORIGEM = "|";

/**
 * A ORIGEM da chave de idempotência — string legível, gravada ao lado do hash para depurar. O sha256 é feito na API
 * (`chaveIdempotencia`), sobre esta string: o domínio roda também na web e não depende de `node:crypto`.
 *
 * Formato: org|área|sha256 da geometria|índice|`<data_alvo ou "recente">@<início>..<fim>`|versão do método.
 *
 * A JANELA entra junto da data alvo: sem ela, "recente" valeria para sempre (o pedido de hoje e o do mês que vem
 * teriam a mesma chave) e um slot de intervalo poderia colidir com um pedido por data. A geometria entra pelo hash:
 * redesenhar o contorno da área é outra análise. Nenhuma parte pode conter o separador — se pudesse, duas origens
 * diferentes poderiam montar a mesma string.
 */
export function origemChaveIdempotencia(p: {
  organizationId: string; areaId: string; geometriaSha256: string; indiceBundle: IndiceBundleConsulta; slot: SlotConsulta; versaoMetodo: string;
}): string {
  const partes = [
    p.organizationId,
    p.areaId,
    p.geometriaSha256,
    p.indiceBundle,
    `${p.slot.data_alvo ?? "recente"}@${p.slot.janela_inicio}..${p.slot.janela_fim}`,
    p.versaoMetodo
  ];
  for (const parte of partes) {
    if (typeof parte !== "string" || parte === "" || parte.includes(SEPARADOR_ORIGEM)) {
      throw new RangeError(`parte inválida na origem da chave: ${String(parte)}`);
    }
  }
  return partes.join(SEPARADOR_ORIGEM);
}

// ---------------------------------------------------------------------------------------------------------------
// ESTIMATIVA DE CRÉDITOS
// ---------------------------------------------------------------------------------------------------------------

/** Faixa de créditos estimada. Strings decimais com 2 casas; `minimo` ≤ `maximo` sempre. */
export interface FaixaCreditos { minimo: string; maximo: string }

/** A faixa nula: soma de nada, ou consulta só com itens reaproveitados. Congelada: é compartilhada. */
export const FAIXA_ZERO: FaixaCreditos = Object.freeze({ minimo: "0.00", maximo: "0.00" });

/**
 * Quantas observações (datas processadas) um item pode cobrar. Mínimo 1: o slot tem pelo menos uma imagem a
 * processar. Máximo: uma passagem a cada `revisitaDias` dentro da janela — a Statistical API cobra cada data
 * processada, não só a escolhida, então a janela longa custa mais.
 */
export function observacoesDoSlot(s: SlotConsulta): { minimo: number; maximo: number } {
  const dias = diasDaJanela(s);
  return { minimo: 1, maximo: Math.max(1, Math.ceil(dias / COEFICIENTES_ESTIMATIVA_PU.revisitaDias)) };
}

/** PU exato de UMA observação, em decimal (sem arredondar): a estimativa arredonda uma vez só, no fim. */
function puExatoPorObservacao(pixelsBbox: number, indice: IndiceBundleConsulta): Decimal {
  if (!Number.isSafeInteger(pixelsBbox) || pixelsBbox < 1) throw new RangeError(`pixels da caixa inválidos: ${pixelsBbox}`);
  // Índice fora da lista não herda as bandas de outro: sem bandas declaradas, não há estimativa.
  if (!Object.prototype.hasOwnProperty.call(BANDAS_POR_INDICE, indice)) throw new RangeError(`índice sem bandas declaradas: ${String(indice)}`);
  const c = COEFICIENTES_ESTIMATIVA_PU;
  const fatorArea = D(pixelsBbox).div(c.pixelsReferencia);
  const fatorAreaComPiso = fatorArea.gte(c.fatorAreaMinimo) ? fatorArea : D(c.fatorAreaMinimo);
  return fatorAreaComPiso.mul(D(BANDAS_POR_INDICE[indice]).div(c.bandasReferencia)).mul(c.fatorFormato);
}

/**
 * PU de UMA observação da caixa (bbox) do polígono, em pixels da grade da análise:
 * max(pixels ÷ pixelsReferencia, fatorAreaMinimo) × (bandas do índice ÷ bandasReferencia) × fatorFormato.
 * Sai com 4 casas — a escala de `pu_gasto` no banco — só para exibir; a estimativa em créditos usa o valor exato.
 */
export function puPorObservacao(pixelsBbox: number, indice: IndiceBundleConsulta): string {
  return qty(puExatoPorObservacao(pixelsBbox, indice), 4);
}

/** PU exato de UMA chamada Process do mapa de condição (área × bandas × formato). */
function puExatoProcessCondicao(pixelsBbox: number): Decimal {
  if (!Number.isSafeInteger(pixelsBbox) || pixelsBbox < 1) throw new RangeError(`pixels da caixa inválidos: ${pixelsBbox}`);
  const c = COEFICIENTES_ESTIMATIVA_PU;
  const p = COEFICIENTES_ESTIMATIVA_PROCESS_CONDICAO;
  const fatorArea = D(pixelsBbox).div(c.pixelsReferencia);
  const fatorAreaComPiso = fatorArea.gte(c.fatorAreaMinimo) ? fatorArea : D(c.fatorAreaMinimo);
  return fatorAreaComPiso.mul(D(p.bandas).div(c.bandasReferencia)).mul(p.fatorFormato);
}

/**
 * Faixa de créditos do Process AUTOMÁTICO (mapa de condição v3) — UM produto, UMA chamada.
 * `mapaReutilizavel: true` (comprovado) → zero. Ausente/false → estimativa conservadora
 * (a prévia não assume cache sem prova).
 * Rasters técnicos lazy NÃO entram.
 */
export function estimarCreditosProcessCondicao(p: {
  pixelsBbox: number;
  mapaReutilizavel?: boolean;
}): FaixaCreditos {
  if (p.mapaReutilizavel === true) return { minimo: money(0), maximo: money(0) };
  const creditos = puExatoProcessCondicao(p.pixelsBbox).mul(CREDITOS_POR_PU);
  const valor = money(creditos);
  return { minimo: valor, maximo: valor };
}

/**
 * Faixa de créditos de UM item novo.
 * - NDVI avulso: só Statistical (janela × observações).
 * - `pastagem_essencial`: Statistical + Process do mapa de condição (produto automático).
 * Rasters técnicos lazy NÃO entram na prévia.
 * Item totalmente reaproveitado (Statistical + mapa) não passa por aqui: custa zero.
 */
export function estimarCreditosItem(p: {
  pixelsBbox: number;
  indice: IndiceBundleConsulta;
  slot: SlotConsulta;
  /** Só para pastagem: true quando o mapa de condição já existe e é comprovadamente reutilizável. */
  mapaCondicaoReutilizavel?: boolean;
}): FaixaCreditos {
  const creditosPorObservacao = puExatoPorObservacao(p.pixelsBbox, p.indice).mul(CREDITOS_POR_PU);
  const obs = observacoesDoSlot(p.slot);
  const statistical: FaixaCreditos = {
    minimo: money(creditosPorObservacao.mul(obs.minimo)),
    maximo: money(creditosPorObservacao.mul(obs.maximo))
  };
  if (p.indice !== BUNDLE_PASTAGEM_ESSENCIAL) return statistical;
  return somarFaixas([
    statistical,
    estimarCreditosProcessCondicao({
      pixelsBbox: p.pixelsBbox,
      mapaReutilizavel: p.mapaCondicaoReutilizavel
    })
  ]);
}

/** Soma de faixas, em decimal (0,1 + 0,2 = 0,30, sem o resíduo do ponto flutuante). Lista vazia → zero. */
export function somarFaixas(f: readonly FaixaCreditos[]): FaixaCreditos {
  let minimo = D(0);
  let maximo = D(0);
  for (const faixa of f) {
    minimo = minimo.plus(D(faixa.minimo));
    maximo = maximo.plus(D(faixa.maximo));
  }
  return { minimo: money(minimo), maximo: money(maximo) };
}
