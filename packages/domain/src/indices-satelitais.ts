/**
 * CATÁLOGO VERSIONADO DE ÍNDICES SATELITAIS — SAT-08, decisão 299.
 *
 * O produto deixa de ser “mapa de NDVI” e passa a ser MONITORAMENTO DA CONDIÇÃO DA ÁREA.
 * Este arquivo é o SSOT das fórmulas, bandas, resolução nativa, limitações e do bundle essencial.
 * Banco (CHECKs da 0056), API e testes consomem ESTE arquivo; ninguém redigita as listas.
 *
 * Separação obrigatória:
 *   A) observação (o que o Sentinel mediu)
 *   B) índice (transformação matemática)
 *   C) interpretação cautelosa (vigor, solo, umidade…)
 *   D) diagnóstico agronômico (praga, kg MS/ha, lotação) — FORA desta fatia
 *
 * Vegetação detectada NÃO significa necessariamente capim útil.
 */

import { CLASSES_SCL_EXCLUIDAS, CRITERIO_OBSERVACAO_UTIL, INDICE_NDVI } from "./analise-satelital.js";

/** Bundle essencial da SAT-08: uma chamada Statistical → vários índices. */
export const BUNDLE_PASTAGEM_ESSENCIAL = "pastagem_essencial";
/** Método da #101 (evalscript/máscara monolítica) — permanece no histórico; não é mais o método ativo. */
export const VERSAO_METODO_PASTAGEM_ESSENCIAL_V1 = "pastagem-essencial-v1";
/**
 * Método ativo após SAT-08 R1 (decisão 300): dataMask por output, máscara por índice, histograma/percentis
 * no contrato oficial. Mudar máscara/evalscript muda a versão — análises v1 não se reaproveitam.
 */
export const VERSAO_METODO_PASTAGEM_ESSENCIAL = "pastagem-essencial-v2";
export const VERSAO_CATALOGO_INDICES = "2";

/** Agregação do bundle: 20 m — honesta para red-edge/SWIR; índices 10 m declaram resolução nativa à parte. */
export const RESOLUCAO_AGREGACAO_PASTAGEM_M = 20;

export type IdIndiceSatelite = "ndvi" | "evi2" | "ndre" | "ndmi" | "msavi2" | "bsi";
export type StatusIndice = "principal" | "avancado" | "experimental";
export type FamiliaIndice = "vegetacao" | "umidade" | "cobertura_solo" | "senescencia" | "agua" | "queimada";

export interface FaixaIndice { min: number; max: number }

/**
 * Faixas separadas (decisão 300): paleta visual NÃO define constraint científica.
 * - persistivel: CHECK do banco / rejeição na gravação
 * - operacional: faixa esperada em pastagem (documentação)
 * - visual: paleta da UI futura
 * - `dominio` = alias de `faixaPersistivel` (compat)
 */
export interface IndiceCatalogo {
  id: IdIndiceSatelite;
  nome: string;
  versao: string;
  formula: string;
  bandas: readonly string[];
  resolucaoNativaM: 10 | 20;
  faixaPersistivel: FaixaIndice;
  faixaOperacional: FaixaIndice;
  faixaVisual: FaixaIndice;
  dominio: FaixaIndice;
  finalidade: string;
  limitacoes: readonly string[];
  status: StatusIndice;
  familia: FamiliaIndice;
  pergunta: string;
}

/**
 * Bundle essencial (seção 28). NDRE e NDMI usam B8A (preferência de engenharia do pedido),
 * documentada e estável nesta versão do método.
 */
export const INDICES_BUNDLE_ESSENCIAL: readonly IdIndiceSatelite[] = [
  "ndvi", "evi2", "ndre", "ndmi", "msavi2", "bsi"
] as const;

/** Todos os índices persistíveis em `erp.analises_satelitais.indice` após a 0056. */
export const INDICES_SATELITE_PERSISTIVEIS: readonly IdIndiceSatelite[] = INDICES_BUNDLE_ESSENCIAL;

const faixa = (min: number, max: number): FaixaIndice => ({ min, max });

export const CATALOGO_INDICES: Readonly<Record<IdIndiceSatelite, IndiceCatalogo>> = {
  ndvi: {
    id: "ndvi",
    nome: "NDVI",
    versao: "1",
    formula: "(B08 - B04) / (B08 + B04)",
    bandas: ["B04", "B08"],
    resolucaoNativaM: 10,
    faixaPersistivel: faixa(-1, 1),
    faixaOperacional: faixa(-1, 1),
    faixaVisual: faixa(-1, 1),
    dominio: faixa(-1, 1),
    finalidade: "Vigor geral e cobertura verde; série temporal.",
    limitacoes: [
      "Satura em vegetação densa.",
      "Qualquer vegetação verde eleva o índice — não separa capim de invasora.",
      "Não é biomassa, matéria seca, oferta nem lotação."
    ],
    status: "principal",
    familia: "vegetacao",
    pergunta: "Como está a vegetação?"
  },
  evi2: {
    id: "evi2",
    nome: "EVI2",
    versao: "1",
    formula: "2.5 * (B08 - B04) / (B08 + 2.4*B04 + 1)",
    bandas: ["B04", "B08"],
    resolucaoNativaM: 10,
    // EVI2 pode ultrapassar +1 (ex.: NIR=0,8 RED=0,02 ≈ 1,055). Persistível até ~2,5 (limite da fórmula com RED→0).
    faixaPersistivel: faixa(-1, 2.5),
    faixaOperacional: faixa(-1, 1.5),
    faixaVisual: faixa(-1, 1),
    dominio: faixa(-1, 2.5),
    finalidade: "Vigor com menor saturação em vegetação densa; complemento ao NDVI.",
    limitacoes: [
      "Ainda responde a qualquer vegetação verde.",
      "Não diagnostica espécie nem praga.",
      "Valores >1 são matematicamente válidos — a paleta visual não os limita."
    ],
    status: "principal",
    familia: "vegetacao",
    pergunta: "Como está a vegetação?"
  },
  ndre: {
    id: "ndre",
    nome: "NDRE",
    versao: "1",
    formula: "(B8A - B05) / (B8A + B05)",
    bandas: ["B05", "B8A"],
    resolucaoNativaM: 20,
    faixaPersistivel: faixa(-1, 1),
    faixaOperacional: faixa(-1, 1),
    faixaVisual: faixa(-1, 1),
    dominio: faixa(-1, 1),
    finalidade: "Red edge / clorofila relativa; complemento em dossel mais fechado.",
    limitacoes: [
      "Resolução nativa 20 m.",
      "Indicador relativo — não é teor de clorofila calibrado.",
      "Experimental para pastagem tropical até calibração local."
    ],
    status: "principal",
    familia: "vegetacao",
    pergunta: "Como está a vegetação?"
  },
  ndmi: {
    id: "ndmi",
    nome: "NDMI",
    versao: "1",
    formula: "(B8A - B11) / (B8A + B11)",
    bandas: ["B8A", "B11"],
    resolucaoNativaM: 20,
    faixaPersistivel: faixa(-1, 1),
    faixaOperacional: faixa(-1, 1),
    faixaVisual: faixa(-1, 1),
    dominio: faixa(-1, 1),
    finalidade: "Conteúdo relativo de água na vegetação; mudança temporal de estresse hídrico.",
    limitacoes: [
      "Resolução nativa 20 m.",
      "Não mede umidade do solo diretamente.",
      "Heurística — requer validação em campo."
    ],
    status: "principal",
    familia: "umidade",
    pergunta: "A vegetação está mostrando sinal de estresse hídrico?"
  },
  msavi2: {
    id: "msavi2",
    nome: "MSAVI2",
    versao: "1",
    formula: "(2*B08 + 1 - sqrt((2*B08 + 1)^2 - 8*(B08 - B04))) / 2",
    bandas: ["B04", "B08"],
    resolucaoNativaM: 10,
    // S2L2A óptico: REFLECTANCE default, DN=10000*REFLECTANCE, source UINT15 (até ≈3,2767).
    // Docs: "Reflectance values can easily be above 1." Com RED>1 e NIR baixo a fórmula
    // fica < -1 (ex.: NIR=0 RED=1,5 ≈ -1,30; RED=3,2767 ≈ -2,11). Teto matemático com
    // bandas ≥0 é +1. Persistível [-2,5, 1]; operacional/visual ficam em [-1, 1].
    faixaPersistivel: faixa(-2.5, 1),
    faixaOperacional: faixa(-1, 1),
    faixaVisual: faixa(-1, 1),
    dominio: faixa(-2.5, 1),
    finalidade: "Pastagem rala, degradação potencial e recuperação; reduz influência do solo.",
    limitacoes: [
      "Não confirma degradação sozinho.",
      "Não separa capim útil de invasora.",
      "Valores < -1 são matematicamente válidos com reflectância >1 (fonte oficial S2L2A)."
    ],
    status: "principal",
    familia: "cobertura_solo",
    pergunta: "Quanto da área está coberta por vegetação e onde há solo exposto?"
  },
  bsi: {
    id: "bsi",
    nome: "BSI",
    versao: "1",
    formula: "((B11 + B04) - (B08 + B02)) / ((B11 + B04) + (B08 + B02))",
    bandas: ["B02", "B04", "B08", "B11"],
    resolucaoNativaM: 20,
    faixaPersistivel: faixa(-1, 1),
    faixaOperacional: faixa(-1, 1),
    faixaVisual: faixa(-1, 1),
    dominio: faixa(-1, 1),
    finalidade: "Solo exposto / baixa cobertura como sinal auxiliar.",
    limitacoes: [
      "BSI alto NÃO é degradação confirmada.",
      "Resolução nativa 20 m.",
      "Heurística experimental até calibração."
    ],
    status: "principal",
    familia: "cobertura_solo",
    pergunta: "Quanto da área está coberta por vegetação e onde há solo exposto?"
  }
} as const;

/**
 * Tolerância técnica de borda do histograma (= TOLERANCIA_FAIXA da API).
 * Amplia só a borda EXTERNA da faixa persistível para valores exatamente no limite
 * não caírem em underflow/overflow artificial. Thresholds agronômicos internos
 * (0.20 / 0.40 / 0.60 / …) permanecem EXATOS.
 */
export const HISTOGRAMA_EPS_BORDA = 1e-6;

/** Edges do histograma operacional NDVI/NDRE/NDMI (limiares internos exatos; bordas ±eps). */
export const HISTOGRAMA_BINS_VIGOR = [
  -1 - HISTOGRAMA_EPS_BORDA, 0.2, 0.4, 0.6, 1 + HISTOGRAMA_EPS_BORDA
] as const;
/** EVI2: limiares internos exatos; borda persistível ±eps (overflow acima de 2.5+eps). */
export const HISTOGRAMA_BINS_EVI2 = [
  -1 - HISTOGRAMA_EPS_BORDA, 0.2, 0.4, 0.6, 1, 2.5 + HISTOGRAMA_EPS_BORDA
] as const;
/** MSAVI2: borda persistível ±eps; limiares internos exatos. */
export const HISTOGRAMA_BINS_MSAVI2 = [
  -2.5 - HISTOGRAMA_EPS_BORDA, -1, 0.2, 0.4, 0.6, 1 + HISTOGRAMA_EPS_BORDA
] as const;
export const HISTOGRAMA_BINS_BSI = [
  -1 - HISTOGRAMA_EPS_BORDA, -0.1, 0.1, 0.2, 1 + HISTOGRAMA_EPS_BORDA
] as const;

/** Bandas de entrada do evalscript do bundle (além de SCL e dataMask). */
export const BANDAS_BUNDLE_ESSENCIAL: readonly string[] = ["B02", "B04", "B05", "B08", "B8A", "B11", "SCL"] as const;

/** Contagem de bandas para estimativa de PU (entrada do evalscript, sem dataMask). */
export const BANDAS_POR_BUNDLE: Readonly<Record<"ndvi" | "pastagem_essencial", number>> = {
  ndvi: 3,
  pastagem_essencial: BANDAS_BUNDLE_ESSENCIAL.length
};

export const AVISO_VEGETACAO_NAO_E_CAPIM =
  "Vegetação detectada por satélite não significa necessariamente capim útil. Pragas e invasoras exigem confirmação em campo.";

/** Percentis pedidos à Statistical API (chave = output id). */
export const PERCENTIS_SATELITE = [5, 10, 25, 50, 75, 90, 95] as const;

/** Classes SCL excluídas — reexport explícito do SSOT da SAT-01 (mesma máscara no bundle). */
export const MASCARA_SCL_BUNDLE = CLASSES_SCL_EXCLUIDAS;
export const CRITERIO_UTIL_BUNDLE = CRITERIO_OBSERVACAO_UTIL;

// ---------------------------------------------------------------------------------------------------------------
// FÓRMULAS PURAS (pixels sintéticos / testes) — denominador zero → null; NaN/Infinity → null
// ---------------------------------------------------------------------------------------------------------------

function finito(v: number): number | null {
  return Number.isFinite(v) ? v : null;
}

export function calcularNdvi(b08: number, b04: number): number | null {
  const soma = b08 + b04;
  if (!(b04 >= 0) || !(b08 >= 0) || !(soma > 0)) return null;
  return finito((b08 - b04) / soma);
}

export function calcularEvi2(b08: number, b04: number): number | null {
  if (!(b04 >= 0) || !(b08 >= 0)) return null;
  const den = b08 + 2.4 * b04 + 1;
  if (!(den > 0)) return null;
  return finito((2.5 * (b08 - b04)) / den);
}

export function calcularNdre(b8a: number, b05: number): number | null {
  const soma = b8a + b05;
  if (!(b8a >= 0) || !(b05 >= 0) || !(soma > 0)) return null;
  return finito((b8a - b05) / soma);
}

export function calcularNdmi(b8a: number, b11: number): number | null {
  const soma = b8a + b11;
  if (!(b8a >= 0) || !(b11 >= 0) || !(soma > 0)) return null;
  return finito((b8a - b11) / soma);
}

export function calcularMsavi2(b08: number, b04: number): number | null {
  if (!(b04 >= 0) || !(b08 >= 0)) return null;
  const a = 2 * b08 + 1;
  const interno = a * a - 8 * (b08 - b04);
  if (interno < 0) return null;
  return finito((a - Math.sqrt(interno)) / 2);
}

export function calcularBsi(b11: number, b04: number, b08: number, b02: number): number | null {
  if (!(b11 >= 0) || !(b04 >= 0) || !(b08 >= 0) || !(b02 >= 0)) return null;
  const num = (b11 + b04) - (b08 + b02);
  const den = (b11 + b04) + (b08 + b02);
  if (!(den > 0)) return null;
  return finito(num / den);
}

export function calcularIndice(
  id: IdIndiceSatelite,
  bandas: { B02?: number; B04?: number; B05?: number; B08?: number; B8A?: number; B11?: number }
): number | null {
  switch (id) {
    case "ndvi": return calcularNdvi(bandas.B08 ?? NaN, bandas.B04 ?? NaN);
    case "evi2": return calcularEvi2(bandas.B08 ?? NaN, bandas.B04 ?? NaN);
    case "ndre": return calcularNdre(bandas.B8A ?? NaN, bandas.B05 ?? NaN);
    case "ndmi": return calcularNdmi(bandas.B8A ?? NaN, bandas.B11 ?? NaN);
    case "msavi2": return calcularMsavi2(bandas.B08 ?? NaN, bandas.B04 ?? NaN);
    case "bsi": return calcularBsi(bandas.B11 ?? NaN, bandas.B04 ?? NaN, bandas.B08 ?? NaN, bandas.B02 ?? NaN);
    default: return null;
  }
}

/** Pixel válido para vegetação: dataMask + SCL não excluída + reflectâncias ≥ 0. */
export function pixelValidoParaVegetacao(p: {
  dataMask: number; scl: number;
  B02?: number; B04?: number; B05?: number; B08?: number; B8A?: number; B11?: number;
}): boolean {
  if (p.dataMask !== 1) return false;
  if (CLASSES_SCL_EXCLUIDAS.some(([c]) => c === p.scl)) return false;
  const vals = [p.B02, p.B04, p.B05, p.B08, p.B8A, p.B11].filter((v) => v !== undefined) as number[];
  return vals.every((v) => v >= 0);
}

/**
 * Validade mínima POR ÍNDICE (decisão 300): só as bandas do índice entram na máscara.
 * B05 inválida NÃO invalida NDVI; B11 inválida NÃO invalida EVI2.
 */
export function pixelValidoParaIndice(
  id: IdIndiceSatelite,
  p: {
    dataMask: number; scl: number;
    B02?: number; B04?: number; B05?: number; B08?: number; B8A?: number; B11?: number;
  }
): boolean {
  if (p.dataMask !== 1) return false;
  if (CLASSES_SCL_EXCLUIDAS.some(([c]) => c === p.scl)) return false;
  const ok = (v: number | undefined) => v !== undefined && v >= 0;
  switch (id) {
    case "ndvi":
    case "evi2":
    case "msavi2":
      return ok(p.B04) && ok(p.B08);
    case "ndre":
      return ok(p.B05) && ok(p.B8A);
    case "ndmi":
      return ok(p.B8A) && ok(p.B11);
    case "bsi":
      return ok(p.B02) && ok(p.B04) && ok(p.B08) && ok(p.B11);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// QUALIDADE / INDICADORES DERIVADOS (heurísticas experimentais, versionadas)
// ---------------------------------------------------------------------------------------------------------------

export const VERSAO_QUALIDADE = "1";
export const VERSAO_INDICADORES_DERIVADOS = "1";

export type EstadoQualidade = "excelente" | "boa" | "limitada" | "insuficiente" | "sem_imagem_util";

/** Limiares de cobertura válida → estado. Mudar = versão nova. */
export const LIMIARES_QUALIDADE = {
  excelente: 0.9,
  boa: 0.75,
  limitada: 0.6,
  insuficiente: 0.01
} as const;

export function estadoQualidade(coberturaValida: number | null, situacao: "concluida" | "sem_observacao_util"): EstadoQualidade {
  if (situacao === "sem_observacao_util" || coberturaValida === null) return "sem_imagem_util";
  if (coberturaValida >= LIMIARES_QUALIDADE.excelente) return "excelente";
  if (coberturaValida >= LIMIARES_QUALIDADE.boa) return "boa";
  if (coberturaValida >= LIMIARES_QUALIDADE.limitada) return "limitada";
  if (coberturaValida >= LIMIARES_QUALIDADE.insuficiente) return "insuficiente";
  return "sem_imagem_util";
}

/**
 * Thresholds EXPERIMENTAIS de cobertura a partir do NDVI médio (não são % de área até haver histograma).
 * Marcados como experimentais até calibração — nunca “área produtiva real”.
 */
export const LIMIARES_COBERTURA_EXPERIMENTAL = {
  versao: VERSAO_INDICADORES_DERIVADOS,
  vegetacaoAtivaNdvi: 0.4,
  baixaCoberturaNdviMin: 0.2,
  soloExpostoNdvi: 0.2,
  bsiSoloExposto: 0.1,
  ndmiBaixa: 0.0,
  ndmiAlta: 0.3
} as const;

export type CondicaoHidrica = "baixa" | "media" | "alta" | "indeterminada";
export type RotuloVigor = "muito_baixo" | "baixo" | "medio" | "alto" | "indeterminado";

export function rotuloVigorNdvi(medio: number | null): RotuloVigor {
  if (medio === null || !Number.isFinite(medio)) return "indeterminado";
  if (medio < 0.2) return "muito_baixo";
  if (medio < 0.4) return "baixo";
  if (medio < 0.6) return "medio";
  return "alto";
}

/** Linguagem segura: NDVI alto → “alta resposta de vegetação”, nunca “pasto bom”. */
export function rotuloRespostaVegetacao(medio: number | null): string {
  const r = rotuloVigorNdvi(medio);
  switch (r) {
    case "muito_baixo": return "Resposta de vegetação muito baixa";
    case "baixo": return "Baixa resposta de vegetação";
    case "medio": return "Resposta de vegetação média";
    case "alto": return "Alta resposta de vegetação";
    default: return "Resposta de vegetação indeterminada";
  }
}

export function condicaoHidricaNdmi(medio: number | null): CondicaoHidrica {
  if (medio === null || !Number.isFinite(medio)) return "indeterminada";
  if (medio < LIMIARES_COBERTURA_EXPERIMENTAL.ndmiBaixa) return "baixa";
  if (medio >= LIMIARES_COBERTURA_EXPERIMENTAL.ndmiAlta) return "alta";
  return "media";
}

/**
 * Indicadores derivados EXPERIMENTAIS a partir de médias (não % espacial real sem histograma).
 * Quando há frações de histograma, preferir as frações.
 */
export interface IndicadoresDerivados {
  versao: string;
  experimental: true;
  aviso: string;
  vegetacao_ativa_estimada: "alta" | "media" | "baixa" | "indeterminada";
  baixa_cobertura_estimada: "alta" | "media" | "baixa" | "indeterminada";
  solo_exposto_estimado: "alto" | "medio" | "baixo" | "indeterminado";
  condicao_hidrica: CondicaoHidrica;
  resposta_vegetacao: string;
  fracoes_histograma: {
    vegetacao_ativa: number | null;
    baixa_cobertura: number | null;
    solo_exposto: number | null;
  };
}

export function indicadoresDerivados(p: {
  ndviMedio: number | null;
  ndmiMedio: number | null;
  bsiMedio: number | null;
  fracaoVegetacaoAtiva?: number | null;
  fracaoBaixaCobertura?: number | null;
  fracaoSoloExposto?: number | null;
}): IndicadoresDerivados {
  const ndvi = p.ndviMedio;
  let vegetacao: IndicadoresDerivados["vegetacao_ativa_estimada"] = "indeterminada";
  let baixa: IndicadoresDerivados["baixa_cobertura_estimada"] = "indeterminada";
  let solo: IndicadoresDerivados["solo_exposto_estimado"] = "indeterminado";
  if (ndvi !== null) {
    vegetacao = ndvi >= 0.6 ? "alta" : ndvi >= 0.4 ? "media" : "baixa";
    baixa = ndvi >= 0.2 && ndvi < 0.4 ? "alta" : ndvi < 0.2 ? "media" : "baixa";
  }
  if (p.bsiMedio !== null) {
    solo = p.bsiMedio >= 0.2 ? "alto" : p.bsiMedio >= LIMIARES_COBERTURA_EXPERIMENTAL.bsiSoloExposto ? "medio" : "baixo";
  } else if (ndvi !== null) {
    solo = ndvi < LIMIARES_COBERTURA_EXPERIMENTAL.soloExpostoNdvi ? "alto" : "baixo";
  }
  return {
    versao: VERSAO_INDICADORES_DERIVADOS,
    experimental: true,
    aviso: AVISO_VEGETACAO_NAO_E_CAPIM,
    vegetacao_ativa_estimada: vegetacao,
    baixa_cobertura_estimada: baixa,
    solo_exposto_estimado: solo,
    condicao_hidrica: condicaoHidricaNdmi(p.ndmiMedio),
    resposta_vegetacao: rotuloRespostaVegetacao(ndvi),
    fracoes_histograma: {
      vegetacao_ativa: p.fracaoVegetacaoAtiva ?? null,
      baixa_cobertura: p.fracaoBaixaCobertura ?? null,
      solo_exposto: p.fracaoSoloExposto ?? null
    }
  };
}

/** Delta percentual seguro: (atual − anterior) / |anterior|; anterior ~0 → null. */
export function deltaPercentual(atual: number | null, anterior: number | null): number | null {
  if (atual === null || anterior === null || !Number.isFinite(atual) || !Number.isFinite(anterior)) return null;
  if (Math.abs(anterior) < 1e-6) return null;
  return finito(((atual - anterior) / Math.abs(anterior)) * 100);
}

export type TendenciaCurta = "subiu" | "estavel" | "caiu" | "queda_forte" | "indeterminada";

export function tendenciaCurta(deltaPct: number | null): TendenciaCurta {
  if (deltaPct === null) return "indeterminada";
  if (deltaPct <= -15) return "queda_forte";
  if (deltaPct < -5) return "caiu";
  if (deltaPct > 5) return "subiu";
  return "estavel";
}

/** Índice canônico do bundle (não confundir com o NDVI avulso da SAT-01). */
export function ehIndiceDoBundle(id: string): id is IdIndiceSatelite {
  return Object.prototype.hasOwnProperty.call(CATALOGO_INDICES, id);
}

/** Mantém compatibilidade: o NDVI da SAT-01 continua o primeiro da lista persistível. */
export const INDICE_REFERENCIA_BUNDLE = INDICE_NDVI;
