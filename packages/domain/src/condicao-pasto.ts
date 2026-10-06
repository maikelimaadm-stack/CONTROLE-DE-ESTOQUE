/**
 * CLASSIFICAÇÃO INTEGRADA DA CONDIÇÃO DO PASTO — SAT-COND-01 (decisão 302).
 *
 * Não é um índice científico. É uma classificação EXPERIMENTAL, determinística e versionada,
 * derivada da combinação de cobertura (MSAVI2+BSI), vigor (EVI2+NDRE+NDVI), umidade (NDMI)
 * e qualidade (SCL + dataMask) na MESMA observação.
 *
 * Vegetação detectada NÃO é capim. Hectares são ESTIMADOS pela proporção de pixels.
 * Sem kg MS/ha, biomassa, praga, espécie ou lotação.
 *
 * SSOT: este arquivo. Evalscript, API, UI e testes consomem daqui — ninguém redigita
 * classes, paleta, precedência ou thresholds.
 */
import { LIMIARES_COBERTURA_EXPERIMENTAL } from "./indices-satelitais.js";

/**
 * Versão OPERACIONAL do classificador (entra na identidade e no cache).
 * v3 = precedência conservadora (baixa cobertura ANTES de estresse) + estresse só com vigor/cobertura
 * suficientes (SAT-BUNDLE-01A). v1/v2 permanecem históricas; a listagem operacional só serve v3.
 */
export const VERSAO_CLASSIFICADOR_CONDICAO_PASTO = "condicao-pasto-v3";
/** Evalscript espectral alinhado à precedência v3. */
export const VERSAO_EVALSCRIPT_CONDICAO_PASTO = "condicao-pasto-v3";
/** Versão legada com resumo espacial incorreto (bbox inteira). Não reaproveitar como corrente. */
export const VERSAO_CLASSIFICADOR_CONDICAO_PASTO_V1 = "condicao-pasto-v1";
/** v2 = máscara geométrica + precedência antiga (estresse antes de baixa cobertura). Histórica. */
export const VERSAO_CLASSIFICADOR_CONDICAO_PASTO_V2 = "condicao-pasto-v2";
/** Resolução analítica efetiva: NDRE/NDMI/BSI são 20 m. */
export const RESOLUCAO_ANALITICA_CONDICAO_PASTO_M = 20;
export const TIPO_MAPA_CONDICAO_PASTO = "classificacao" as const;
export const CHAVE_MAPA_CONDICAO_PASTO = "condicao_pasto" as const;
/**
 * Byte no PNG para pixel FORA do polígono (não é classe).
 * Distinto de 0 (SEM_LEITURA dentro). LUT: alpha 0. Contagem: ignorado.
 */
export const BYTE_FORA_POLIGONO_CONDICAO = 255;

export const AVISO_CONDICAO_PASTO_EXPERIMENTAL =
  "Estimativa espectral de cobertura/atividade vegetal. Não representa diretamente kg de capim nem confirma espécie de forragem.";
export const AVISO_CONDICAO_PASTO_NAO_DIAGNOSTICO =
  "Imagem de satélite não confirma causa, degradação ou espécie vegetal.";
export const AVISO_LEITURA_PARCIAL =
  "Leitura parcial — nuvens/sombras reduziram a área observável.";

/**
 * SCL permitidas para classes produtivas (pastagem). Fail-closed: qualquer outra,
 * salvo água (6), vira SEM_LEITURA.
 * 2 = área escura; 4 = vegetação; 5 = solo; 7 = não classificado.
 */
export const SCL_PERMITIDAS_CONDICAO_PASTO: readonly number[] = [2, 4, 5, 7];
export const SCL_AGUA = 6;

/**
 * Thresholds EXPERIMENTAIS v1 — heurística espectral, NÃO calibração agronômica.
 * Reusa LIMIARES_COBERTURA_EXPERIMENTAL quando aplicável; os demais são nomeados aqui.
 */
export const LIMIARES_CLASSIFICADOR_CONDICAO_PASTO = {
  versao: VERSAO_CLASSIFICADOR_CONDICAO_PASTO,
  experimental: true as const,
  resolucaoAnaliticaM: RESOLUCAO_ANALITICA_CONDICAO_PASTO_M,
  msavi2BoaCobertura: 0.4,
  msavi2CoberturaModerada: 0.25,
  msavi2BaixaCobertura: 0.15,
  bsiSoloExposto: LIMIARES_COBERTURA_EXPERIMENTAL.bsiSoloExposto,
  bsiSoloExpostoForte: 0.2,
  ndviVegetacaoAtiva: LIMIARES_COBERTURA_EXPERIMENTAL.vegetacaoAtivaNdvi,
  ndviBaixaCobertura: LIMIARES_COBERTURA_EXPERIMENTAL.baixaCoberturaNdviMin,
  ndviSoloExposto: LIMIARES_COBERTURA_EXPERIMENTAL.soloExpostoNdvi,
  evi2VigorAtivo: 0.3,
  ndreVigorAtivo: 0.2,
  ndmiBaixa: LIMIARES_COBERTURA_EXPERIMENTAL.ndmiBaixa
} as const;

export type IdClasseCondicaoPasto =
  | "sem_leitura"
  | "vegetacao_ativa_boa_cobertura"
  | "vegetacao_ativa_cobertura_moderada"
  | "baixa_cobertura"
  | "possivel_estresse_hidrico"
  | "solo_exposto_estimado"
  | "agua";

export type CodigoClasseCondicaoPasto = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface ClasseCondicaoPasto {
  codigo: CodigoClasseCondicaoPasto;
  id: IdClasseCondicaoPasto;
  /** Nome humano da legenda (PT-BR). */
  nome: string;
  /** Cor categórica fixa (#RRGGBB). */
  cor: string;
  interpretacao: string;
  acao: string;
  agrupamentoProdutivoExperimental: boolean;
}

/**
 * Paleta categórica profissional (não é gradiente). Contraste sobre mapa claro e satélite.
 * Byte 0 = nodata/sem leitura — o mesmo contrato dos rasters de valores.
 */
export const CLASSES_CONDICAO_PASTO: readonly ClasseCondicaoPasto[] = [
  {
    codigo: 0, id: "sem_leitura", nome: "Sem leitura", cor: "#E0E0E0",
    interpretacao: "Nuvem, sombra ou pixel sem informação suficiente (somente DENTRO do polígono).",
    acao: "Aguarde outra passagem ou priorize vistoria se a área inteira ficou sem leitura.",
    agrupamentoProdutivoExperimental: false
  },
  {
    codigo: 1, id: "vegetacao_ativa_boa_cobertura", nome: "Vegetação ativa · boa cobertura", cor: "#1B5E20",
    interpretacao: "Resposta espectral compatível com vegetação ativa e cobertura relativamente alta.",
    acao: "Acompanhe a tendência; não substitui vistoria de campo.",
    agrupamentoProdutivoExperimental: true
  },
  {
    codigo: 2, id: "vegetacao_ativa_cobertura_moderada", nome: "Vegetação ativa · cobertura moderada", cor: "#7CB342",
    interpretacao: "Vegetação presente com cobertura intermediária na heurística espectral v1.",
    acao: "Compare com o histórico da área antes de decidir manejo.",
    agrupamentoProdutivoExperimental: true
  },
  {
    codigo: 3, id: "baixa_cobertura", nome: "Baixa cobertura", cor: "#F9A825",
    interpretacao: "Resposta espectral compatível com cobertura vegetal reduzida.",
    acao: "Priorize vistoria nas áreas com maior concentração.",
    agrupamentoProdutivoExperimental: false
  },
  {
    codigo: 4, id: "possivel_estresse_hidrico", nome: "Possível estresse hídrico", cor: "#EF6C00",
    interpretacao: "Vegetação com sinal de umidade espectral baixa (NDMI). Não confirma seca nem déficit hídrico real.",
    acao: "Priorize vistoria; confirme no campo se há restrição de água.",
    agrupamentoProdutivoExperimental: false
  },
  {
    codigo: 5, id: "solo_exposto_estimado", nome: "Solo exposto estimado", cor: "#BF360C",
    interpretacao: "Resposta espectral compatível com maior exposição de solo.",
    acao: "Priorize vistoria nas áreas com maior concentração.",
    agrupamentoProdutivoExperimental: false
  },
  {
    codigo: 6, id: "agua", nome: "Água", cor: "#1565C0",
    interpretacao: "Cena classificada como água pela SCL do Sentinel-2. Limitação: corpos pequenos ou mistos podem não aparecer.",
    acao: "Confira no mapa base se corresponde a açude, rio ou alagado.",
    agrupamentoProdutivoExperimental: false
  }
] as const;

export const CLASSE_CONDICAO_POR_CODIGO: Readonly<Record<CodigoClasseCondicaoPasto, ClasseCondicaoPasto>> =
  Object.fromEntries(CLASSES_CONDICAO_PASTO.map((c) => [c.codigo, c])) as Record<CodigoClasseCondicaoPasto, ClasseCondicaoPasto>;

export const CLASSE_CONDICAO_POR_ID: Readonly<Record<IdClasseCondicaoPasto, ClasseCondicaoPasto>> =
  Object.fromEntries(CLASSES_CONDICAO_PASTO.map((c) => [c.id, c])) as Record<IdClasseCondicaoPasto, ClasseCondicaoPasto>;

export const ROTULOS_CLASSE_CONDICAO_PASTO: Readonly<Record<IdClasseCondicaoPasto, string>> =
  Object.fromEntries(CLASSES_CONDICAO_PASTO.map((c) => [c.id, c.nome])) as Record<IdClasseCondicaoPasto, string>;

/**
 * Precedência fail-closed v3 (a primeira regra que casa vence; classes mutuamente exclusivas):
 * 1. SEM_LEITURA  2. AGUA  3. SOLO_EXPOSTO  4. BAIXA_COBERTURA  5. ESTRESSE
 * 6. COBERTURA_MODERADA  7. BOA_COBERTURA
 * Baixa cobertura NÃO é renomeada como estresse só porque NDMI é baixo.
 * Água nunca vira solo. Pixel mascarado nunca vira classe produtiva.
 */
export const PRECEDENCIA_CLASSES_CONDICAO_PASTO: readonly IdClasseCondicaoPasto[] = [
  "sem_leitura",
  "agua",
  "solo_exposto_estimado",
  "baixa_cobertura",
  "possivel_estresse_hidrico",
  "vegetacao_ativa_cobertura_moderada",
  "vegetacao_ativa_boa_cobertura"
];

export interface PixelCondicaoPasto {
  dataMask: number;
  scl: number;
  ndvi: number | null;
  evi2: number | null;
  ndre: number | null;
  ndmi: number | null;
  msavi2: number | null;
  bsi: number | null;
}

function finito(n: number | null): n is number {
  return n !== null && Number.isFinite(n);
}

function sclPermitida(scl: number): boolean {
  return SCL_PERMITIDAS_CONDICAO_PASTO.includes(scl);
}

/**
 * Classifica UM pixel (v3). Determinístico: mesmos sinais → mesma classe.
 * Índices de datas diferentes NÃO devem ser misturados pelo chamador (I-04).
 *
 * Estresse hídrico só quando há cobertura/vigor suficientes para interpretar NDMI —
 * não é classe-curinga para vegetação rala ou solo misto.
 */
export function classificarPixelCondicaoPasto(p: PixelCondicaoPasto): CodigoClasseCondicaoPasto {
  const L = LIMIARES_CLASSIFICADOR_CONDICAO_PASTO;
  if (p.dataMask !== 1) return 0;
  if (!Number.isInteger(p.scl) || p.scl < 0) return 0;
  if (p.scl === SCL_AGUA) return 6;
  if (!sclPermitida(p.scl)) return 0;
  if (!finito(p.ndvi) || !finito(p.evi2) || !finito(p.ndre) || !finito(p.ndmi) || !finito(p.msavi2) || !finito(p.bsi)) {
    return 0;
  }
  const { ndvi, evi2, ndre, ndmi, msavi2, bsi } = p;

  const soloForte = bsi >= L.bsiSoloExpostoForte && msavi2 < L.msavi2CoberturaModerada;
  const soloFraco = bsi >= L.bsiSoloExposto && ndvi < L.ndviSoloExposto && msavi2 < L.msavi2CoberturaModerada;
  if (soloForte || soloFraco) return 5;

  // Baixa cobertura ANTES de estresse: NDMI baixo em cobertura fraca ≠ estresse hídrico.
  const baixaCobertura = msavi2 < L.msavi2CoberturaModerada && ndvi < L.ndviVegetacaoAtiva;
  if (baixaCobertura) return 3;

  const vigorAtivo = ndvi >= L.ndviVegetacaoAtiva && (evi2 >= L.evi2VigorAtivo || ndre >= L.ndreVigorAtivo);
  const coberturaSuficienteParaHidrico = msavi2 >= L.msavi2CoberturaModerada;
  if (ndmi < L.ndmiBaixa && coberturaSuficienteParaHidrico && vigorAtivo) return 4;

  if (msavi2 >= L.msavi2BoaCobertura && vigorAtivo) return 1;

  if (msavi2 >= L.msavi2CoberturaModerada || ndvi >= L.ndviVegetacaoAtiva) return 2;

  return 0;
}

export function classeDeCodigo(codigo: number): ClasseCondicaoPasto {
  if (codigo === 0 || codigo === 1 || codigo === 2 || codigo === 3 || codigo === 4 || codigo === 5 || codigo === 6) {
    return CLASSE_CONDICAO_POR_CODIGO[codigo];
  }
  return CLASSE_CONDICAO_POR_CODIGO[0];
}

export type ContagemPixelsCondicao = Record<CodigoClasseCondicaoPasto, number>;

export function contagemVazia(): ContagemPixelsCondicao {
  return { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
}

/**
 * Contagem SEM máscara (legado v1 / testes unitários de classificação).
 * Bytes fora de 0..6 entram em SEM_LEITURA (fail-closed). Preferir `contarPixelsCondicaoComMascara`.
 */
export function contarPixelsCondicao(pixels: Uint8Array | readonly number[]): { contagem: ContagemPixelsCondicao; universo: number; bytesInvalidos: number } {
  const contagem = contagemVazia();
  let bytesInvalidos = 0;
  for (const b of pixels) {
    if (b === BYTE_FORA_POLIGONO_CONDICAO) continue;
    if (b === 0 || b === 1 || b === 2 || b === 3 || b === 4 || b === 5 || b === 6) contagem[b] += 1;
    else {
      contagem[0] += 1;
      bytesInvalidos += 1;
    }
  }
  const universo = CLASSES_CONDICAO_PASTO.reduce((s, c) => s + contagem[c.codigo], 0);
  return { contagem, universo, bytesInvalidos };
}

/**
 * Contagem com suporte espacial: só pixels com máscara=1 (centro dentro do polígono).
 * Fora do polígono não entra em universo, hectares nem %.
 */
export function contarPixelsCondicaoComMascara(
  pixels: Uint8Array | readonly number[],
  mascara: Uint8Array | readonly (0 | 1)[] | readonly boolean[]
): { contagem: ContagemPixelsCondicao; universo: number; bytesInvalidos: number; pixelsForaPoligono: number } {
  if (pixels.length !== mascara.length) {
    throw new RangeError("contarPixelsCondicaoComMascara: pixels e máscara com tamanhos diferentes");
  }
  const contagem = contagemVazia();
  let bytesInvalidos = 0;
  let pixelsForaPoligono = 0;
  for (let i = 0; i < pixels.length; i++) {
    const dentro = mascara[i] === true || mascara[i] === 1;
    if (!dentro) {
      pixelsForaPoligono += 1;
      continue;
    }
    const b = pixels[i]!;
    if (b === 0 || b === 1 || b === 2 || b === 3 || b === 4 || b === 5 || b === 6) contagem[b] += 1;
    else {
      contagem[0] += 1;
      bytesInvalidos += 1;
    }
  }
  const universo = CLASSES_CONDICAO_PASTO.reduce((s, c) => s + contagem[c.codigo], 0);
  return { contagem, universo, bytesInvalidos, pixelsForaPoligono };
}

/** Marca fora do polígono com BYTE_FORA_POLIGONO_CONDICAO; dentro permanece 0..6. */
export function aplicarMascaraPoligonoNosPixels(
  pixels: Uint8Array,
  mascara: Uint8Array | readonly (0 | 1)[] | readonly boolean[]
): Uint8Array {
  if (pixels.length !== mascara.length) throw new RangeError("aplicarMascaraPoligonoNosPixels: tamanhos diferentes");
  const saida = new Uint8Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    const dentro = mascara[i] === true || mascara[i] === 1;
    saida[i] = dentro ? (pixels[i]! > 6 ? 0 : pixels[i]!) : BYTE_FORA_POLIGONO_CONDICAO;
  }
  return saida;
}

function arredondar(n: number, casas: number): number {
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

/** Método do maior resto: a soma dos arredondados fecha o total (em `casas` decimais). */
export function distribuirComMaiorResto(partes: readonly number[], total: number, casas: number): number[] {
  const n = partes.length;
  if (n === 0) return [];
  const totalArred = arredondar(total, casas);
  if (!Number.isFinite(totalArred) || totalArred === 0 || partes.every((p) => p === 0)) {
    return Array.from({ length: n }, () => 0);
  }
  const somaPartes = partes.reduce((s, p) => s + p, 0);
  if (somaPartes <= 0) return Array.from({ length: n }, () => 0);
  const fator = 10 ** casas;
  const quotas = partes.map((p) => (p / somaPartes) * totalArred);
  const floors = quotas.map((q) => Math.floor(q * fator + 1e-12));
  let resto = Math.round(totalArred * fator) - floors.reduce((s, x) => s + x, 0);
  const ordem = quotas
    .map((q, i) => ({ i, frac: q * fator - floors[i]! }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const extra = new Array<number>(n).fill(0);
  for (const o of ordem) {
    if (resto <= 0) break;
    extra[o.i] = 1;
    resto -= 1;
  }
  return floors.map((f, i) => (f + extra[i]!) / fator);
}

export interface LinhaResumoClasseCondicao {
  id: IdClasseCondicaoPasto;
  codigo: CodigoClasseCondicaoPasto;
  nome: string;
  cor: string;
  pixels: number;
  proporcao: string;
  area_estimada_ha: string;
  area_estimada_percentual: string;
}

export interface ResumoCondicaoPasto {
  versao_classificador: string;
  experimental: true;
  resolucao_m: number;
  area_total_ha: string;
  area_lida_ha: string;
  area_sem_leitura_ha: string;
  cobertura_valida: string;
  pixels_universo: number;
  pixels_sem_leitura: number;
  /** Auditoria: pixels da bbox fora do polígono (não entram em %). */
  pixels_fora_poligono?: number;
  classes: LinhaResumoClasseCondicao[];
  area_potencialmente_produtiva_ha: string;
  area_potencialmente_produtiva_percentual: string;
  aviso: string;
  avisos: string[];
}

export function resumirCondicaoPasto(p: {
  contagem: ContagemPixelsCondicao;
  areaTotalHa: number;
  resolucaoM?: number;
  bytesInvalidos?: number;
  pixelsForaPoligono?: number;
}): ResumoCondicaoPasto {
  const universo = CLASSES_CONDICAO_PASTO.reduce((s, c) => s + p.contagem[c.codigo], 0);
  const area = Number.isFinite(p.areaTotalHa) && p.areaTotalHa > 0 ? p.areaTotalHa : 0;
  const pixels = CLASSES_CONDICAO_PASTO.map((c) => p.contagem[c.codigo]);
  const has = universo === 0 || area === 0
    ? CLASSES_CONDICAO_PASTO.map(() => 0)
    : distribuirComMaiorResto(pixels, area, 2);
  const pcts = universo === 0
    ? CLASSES_CONDICAO_PASTO.map(() => 0)
    : distribuirComMaiorResto(pixels, 100, 1);
  const classes: LinhaResumoClasseCondicao[] = CLASSES_CONDICAO_PASTO.map((c, i) => ({
    id: c.id,
    codigo: c.codigo,
    nome: c.nome,
    cor: c.cor,
    pixels: p.contagem[c.codigo],
    proporcao: universo === 0 ? "0.0000" : (p.contagem[c.codigo] / universo).toFixed(4),
    area_estimada_ha: has[i]!.toFixed(2),
    area_estimada_percentual: pcts[i]!.toFixed(1)
  }));
  const lidaHa = CLASSES_CONDICAO_PASTO
    .filter((c) => c.codigo !== 0)
    .reduce((s, c, _i) => s + Number(classes[c.codigo]!.area_estimada_ha), 0);
  const semHa = Number(classes[0]!.area_estimada_ha);
  const prodHa = Number(classes[1]!.area_estimada_ha) + Number(classes[2]!.area_estimada_ha);
  const cobertura = universo === 0 ? 0 : (universo - p.contagem[0]) / universo;
  const avisos = [AVISO_CONDICAO_PASTO_EXPERIMENTAL, AVISO_CONDICAO_PASTO_NAO_DIAGNOSTICO];
  if (cobertura < 0.8 && universo > 0) avisos.push(AVISO_LEITURA_PARCIAL);
  if ((p.bytesInvalidos ?? 0) > 0) avisos.push("Havia bytes fora das classes 0–6; foram tratados como sem leitura.");
  return {
    versao_classificador: VERSAO_CLASSIFICADOR_CONDICAO_PASTO,
    experimental: true,
    resolucao_m: p.resolucaoM ?? RESOLUCAO_ANALITICA_CONDICAO_PASTO_M,
    area_total_ha: arredondar(area, 2).toFixed(2),
    area_lida_ha: lidaHa.toFixed(2),
    area_sem_leitura_ha: semHa.toFixed(2),
    cobertura_valida: cobertura.toFixed(4),
    pixels_universo: universo,
    pixels_sem_leitura: p.contagem[0],
    ...(p.pixelsForaPoligono !== undefined ? { pixels_fora_poligono: p.pixelsForaPoligono } : {}),
    classes,
    area_potencialmente_produtiva_ha: prodHa.toFixed(2),
    area_potencialmente_produtiva_percentual: (universo === 0 ? 0 : Number(classes[1]!.area_estimada_percentual) + Number(classes[2]!.area_estimada_percentual)).toFixed(1),
    aviso: AVISO_CONDICAO_PASTO_EXPERIMENTAL,
    avisos
  };
}

export interface IdentidadeMapaCondicaoPasto {
  organizationId: string;
  empresaId: string;
  areaId: string;
  geometriaSha256: string;
  dataImagem: string;
  versaoClassificador: string;
  versaoEvalscript: string;
  resolucaoM: number;
  fonte: string;
}

/** Identidade canônica: qualquer campo diferente invalida o mapa anterior. */
export function chaveIdentidadeMapaCondicao(p: IdentidadeMapaCondicaoPasto): string {
  return [
    p.organizationId, p.empresaId, p.areaId, p.geometriaSha256, p.dataImagem,
    p.versaoClassificador, p.versaoEvalscript, String(p.resolucaoM), p.fonte
  ].join("|");
}

export function identidadesEquivalentes(a: IdentidadeMapaCondicaoPasto, b: IdentidadeMapaCondicaoPasto): boolean {
  return chaveIdentidadeMapaCondicao(a) === chaveIdentidadeMapaCondicao(b);
}

/** Badge da lista: alerta (solo/estresse/baixa) se ≥ 15% combinados; senão a classe produtiva predominante. */
export function badgePrincipalCondicao(resumo: ResumoCondicaoPasto): { id: IdClasseCondicaoPasto; rotulo: string; cor: string } {
  const porId = (id: IdClasseCondicaoPasto) => resumo.classes.find((c) => c.id === id)!;
  const atencaoPct =
    Number(porId("baixa_cobertura").area_estimada_percentual)
    + Number(porId("possivel_estresse_hidrico").area_estimada_percentual)
    + Number(porId("solo_exposto_estimado").area_estimada_percentual);
  if (atencaoPct >= 15) {
    const alerta = [porId("solo_exposto_estimado"), porId("possivel_estresse_hidrico"), porId("baixa_cobertura")]
      .sort((a, b) => Number(b.area_estimada_ha) - Number(a.area_estimada_ha) || a.codigo - b.codigo)[0]!;
    return { id: alerta.id, rotulo: "Atenção", cor: CLASSE_CONDICAO_POR_ID[alerta.id].cor };
  }
  const produtivas = [porId("vegetacao_ativa_boa_cobertura"), porId("vegetacao_ativa_cobertura_moderada")];
  const top = [...produtivas, ...resumo.classes.filter((c) => c.id !== "vegetacao_ativa_boa_cobertura" && c.id !== "vegetacao_ativa_cobertura_moderada")]
    .sort((a, b) => b.pixels - a.pixels || a.codigo - b.codigo)[0]!;
  if (top.id === "vegetacao_ativa_boa_cobertura") {
    return { id: top.id, rotulo: "Boa cobertura", cor: CLASSE_CONDICAO_POR_ID[top.id].cor };
  }
  return { id: top.id, rotulo: CLASSE_CONDICAO_POR_ID[top.id].nome, cor: CLASSE_CONDICAO_POR_ID[top.id].cor };
}

/**
 * LUT RGBA 256×4: classes 0–6 com cor fixa; BYTE_FORA_POLIGONO (255) transparente.
 * SEM_LEITURA (0) usa alpha baixo (~0,35) para não dominar a tela.
 */
export function montarLutCondicaoPasto(opts?: { classeDestaque?: CodigoClasseCondicaoPasto | null; opacidadeOutras?: number; opacidadeSemLeitura?: number }): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  const destaque = opts?.classeDestaque;
  const opOutras = opts?.opacidadeOutras ?? 0.18;
  const opSem = opts?.opacidadeSemLeitura ?? 0.35;
  for (const c of CLASSES_CONDICAO_PASTO) {
    const r = Number.parseInt(c.cor.slice(1, 3), 16);
    const g = Number.parseInt(c.cor.slice(3, 5), 16);
    const b = Number.parseInt(c.cor.slice(5, 7), 16);
    const base = c.codigo * 4;
    lut[base] = r;
    lut[base + 1] = g;
    lut[base + 2] = b;
    if (c.codigo === 0) {
      const a = destaque != null && destaque !== 0 ? Math.round(255 * opOutras * opSem) : Math.round(255 * opSem);
      lut[base + 3] = a;
    } else {
      lut[base + 3] = destaque == null || destaque === c.codigo ? 255 : Math.round(255 * opOutras);
    }
  }
  // 7..254 e 255 (fora do polígono): transparentes
  return lut;
}

export type OrdenacaoListaCondicao = "atencao" | "nome" | "area" | "solo" | "baixa" | "estresse";

export const ROTULO_ORDENACAO_CONDICAO: Readonly<Record<OrdenacaoListaCondicao, string>> = {
  atencao: "Mais atenção primeiro",
  nome: "Nome",
  area: "Maior área",
  solo: "Maior solo exposto",
  baixa: "Maior baixa cobertura",
  estresse: "Maior possível estresse"
};

export function haDaClasseCondicao(resumo: ResumoCondicaoPasto | undefined, codigo: CodigoClasseCondicaoPasto): number {
  if (!resumo) return -1;
  return Number(resumo.classes.find((c) => c.codigo === codigo)?.area_estimada_ha ?? 0);
}

export function pontuacaoAtencaoCondicao(resumo: ResumoCondicaoPasto | undefined): number {
  if (!resumo) return -1;
  return haDaClasseCondicao(resumo, 3) + haDaClasseCondicao(resumo, 4) + haDaClasseCondicao(resumo, 5);
}

/** Cor sólida quando o raster categórico ainda não entrou (zoom distante / sem PNG). */
export function corPredominanteCondicao(resumo: ResumoCondicaoPasto | undefined): string | null {
  if (!resumo) return null;
  const top = [...resumo.classes]
    .filter((c) => c.codigo !== 0 && c.pixels > 0)
    .sort((a, b) => b.pixels - a.pixels || a.codigo - b.codigo)[0];
  return top ? CLASSE_CONDICAO_POR_CODIGO[top.codigo].cor : null;
}

export function agregarResumosCondicao(resumos: readonly ResumoCondicaoPasto[]): ResumoCondicaoPasto {
  const contagem = contagemVazia();
  let area = 0;
  for (const r of resumos) {
    area += Number(r.area_total_ha);
    for (const c of r.classes) contagem[c.codigo] += c.pixels;
  }
  return resumirCondicaoPasto({ contagem, areaTotalHa: area });
}

export interface AreaParaOrdenacaoCondicao {
  id: string;
  nome: string;
  areaHa: number;
  resumo?: ResumoCondicaoPasto;
}

export function ordenarAreasCondicao(
  areas: readonly AreaParaOrdenacaoCondicao[],
  ordenacao: OrdenacaoListaCondicao,
  classeFiltro: CodigoClasseCondicaoPasto | null
): AreaParaOrdenacaoCondicao[] {
  const copia = [...areas];
  copia.sort((a, b) => {
    if (classeFiltro !== null) {
      const d = haDaClasseCondicao(b.resumo, classeFiltro) - haDaClasseCondicao(a.resumo, classeFiltro);
      if (d !== 0) return d;
    } else if (ordenacao === "atencao") {
      const d = pontuacaoAtencaoCondicao(b.resumo) - pontuacaoAtencaoCondicao(a.resumo);
      if (d !== 0) return d;
    } else if (ordenacao === "area") {
      const d = b.areaHa - a.areaHa;
      if (d !== 0) return d;
    } else if (ordenacao === "solo") {
      const d = haDaClasseCondicao(b.resumo, 5) - haDaClasseCondicao(a.resumo, 5);
      if (d !== 0) return d;
    } else if (ordenacao === "baixa") {
      const d = haDaClasseCondicao(b.resumo, 3) - haDaClasseCondicao(a.resumo, 3);
      if (d !== 0) return d;
    } else if (ordenacao === "estresse") {
      const d = haDaClasseCondicao(b.resumo, 4) - haDaClasseCondicao(a.resumo, 4);
      if (d !== 0) return d;
    }
    return a.nome.localeCompare(b.nome, "pt-BR") || a.id.localeCompare(b.id);
  });
  return copia;
}
