/**
 * OBSERVAÇÃO SATELITAL COMPLETA — SAT-BUNDLE-01A.
 *
 * Contrato canônico: uma observação Sentinel = seis índices do bundle pastagem-essencial-v2
 * + produtos espaciais (condição v3 + rasters técnicos) + temas de visualização para a F2.
 *
 * Análise ≠ visualização. Trocar tema NÃO cria consulta Statistical nem nova observação.
 * SSOT deste contrato: este arquivo. Sem segundo SSOT na web.
 */
import {
  INDICES_BUNDLE_ESSENCIAL,
  LIMIARES_COBERTURA_EXPERIMENTAL,
  VERSAO_METODO_PASTAGEM_ESSENCIAL,
  type IdIndiceSatelite
} from "./indices-satelitais.js";
import { VERSAO_CLASSIFICADOR_CONDICAO_PASTO } from "./condicao-pasto.js";

/** Identidade canônica da observação do bundle (seis índices irmãos). */
export interface IdentidadeObservacaoSatelital {
  organization_id: string;
  empresa_id: string;
  area_id: string;
  geometria_sha256: string;
  versao_metodo: string;
  observacao_inicio: string;
  observacao_fim: string;
  /** Dia civil UTC de observacao_inicio (AAAA-MM-DD). */
  data_imagem: string;
  colecao: string;
  provedor: string;
}

export interface SinalIndiceObservacao {
  indice: IdIndiceSatelite;
  analise_id: string;
  media: string | null;
  minimo: string | null;
  maximo: string | null;
  desvio_padrao: string | null;
  cobertura_valida: string | null;
  pixels_validos: number | null;
  resolucao_nativa_m: number | null;
  /** Percentis já persistidos em `analises_satelitais_ext` — null se indisponível. */
  percentis: unknown | null;
  /** Histograma já persistido — null se indisponível. */
  histograma: unknown | null;
}

export type StatusProdutoEspacial = "pronto" | "reutilizado" | "indisponivel" | "falhou";

export interface ProdutoRasterIndice {
  indice: IdIndiceSatelite;
  status: StatusProdutoEspacial;
  disponivel: boolean;
  raster_id: string | null;
  data_imagem: string | null;
  resolucao_m: number | null;
  versao_encoding: string | null;
}

export interface ProdutoMapaCondicao {
  status: StatusProdutoEspacial;
  disponivel: boolean;
  mapa_id: string | null;
  data_imagem: string | null;
  resolucao_m: number | null;
  versao_classificador: string | null;
  /** Resumo categórico quando o mapa existe (já persistido). */
  resumo: unknown | null;
}

export type IdTemaVisualizacaoSatelite =
  | "condicao"
  | "umidade"
  | "vigor"
  | "cobertura_solo";

export interface TemaVisualizacaoSatelite {
  id: IdTemaVisualizacaoSatelite;
  nome: string;
  /** Sinais do bundle que sustentam o tema. */
  sinais: readonly IdIndiceSatelite[];
  /** Sinal espacial primário contínuo (quando aplicável). */
  sinal_espacial_primario: IdIndiceSatelite | null;
  linguagem: string;
  ajuda: string;
  avisos: readonly string[];
}

/**
 * Classes EXPERIMENTAIS de umidade espectral do pasto (NDMI).
 * NÃO é umidade volumétrica do solo. Thresholds coerentes com LIMIARES_COBERTURA_EXPERIMENTAL.
 */
export const LIMIARES_UMIDADE_PASTO_EXPERIMENTAL = {
  versao: "umidade-pasto-v1",
  experimental: true as const,
  /** NDMI < baixa → classe "baixa". */
  baixa: LIMIARES_COBERTURA_EXPERIMENTAL.ndmiBaixa,
  /** NDMI < moderadaMax → "moderada"; ≥ e < adequadaMax → "adequada". */
  moderadaMax: 0.15,
  adequadaMax: LIMIARES_COBERTURA_EXPERIMENTAL.ndmiAlta
} as const;

export type ClasseUmidadePasto = "baixa" | "moderada" | "adequada" | "alta" | "indeterminada";

export function classificarUmidadePastoNdmi(medio: number | null): ClasseUmidadePasto {
  if (medio === null || !Number.isFinite(medio)) return "indeterminada";
  const L = LIMIARES_UMIDADE_PASTO_EXPERIMENTAL;
  if (medio < L.baixa) return "baixa";
  if (medio < L.moderadaMax) return "moderada";
  if (medio < L.adequadaMax) return "adequada";
  return "alta";
}

export const AVISO_UMIDADE_NAO_E_SOLO =
  "Derivado do NDMI; indica resposta espectral relacionada à água na vegetação e no dossel — não é umidade volumétrica do solo.";

export const TEMAS_VISUALIZACAO_SATELITE: readonly TemaVisualizacaoSatelite[] = [
  {
    id: "condicao",
    nome: "Condição geral",
    sinais: INDICES_BUNDLE_ESSENCIAL,
    sinal_espacial_primario: null,
    linguagem: "Classificação multi-índice da condição espectral do pasto",
    ajuda: `Mapa categórico ${VERSAO_CLASSIFICADOR_CONDICAO_PASTO}: cobertura, vigor e umidade espectral na mesma observação.`,
    avisos: [
      "Estimativa espectral experimental — não confirma espécie, biomassa nem diagnóstico agronômico."
    ]
  },
  {
    id: "umidade",
    nome: "Umidade do pasto",
    sinais: ["ndmi"],
    sinal_espacial_primario: "ndmi",
    linguagem: "Umidade espectral da vegetação/pasto",
    ajuda: AVISO_UMIDADE_NAO_E_SOLO,
    avisos: [AVISO_UMIDADE_NAO_E_SOLO]
  },
  {
    id: "vigor",
    nome: "Vigor",
    sinais: ["ndre", "evi2", "ndvi"],
    sinal_espacial_primario: "ndre",
    linguagem: "Vigor vegetal relativo (NDRE primário; NDVI e EVI2 corroboram)",
    ajuda: "Camada espacial contínua = NDRE. NDVI e EVI2 entram no resumo/interpretação — não há score opaco 0–100.",
    avisos: [
      "NDRE tem resolução nativa 20 m.",
      "Não é teor de clorofila calibrado nem diagnóstico de praga."
    ]
  },
  {
    id: "cobertura_solo",
    nome: "Cobertura / Solo",
    sinais: ["msavi2", "bsi"],
    sinal_espacial_primario: null,
    linguagem: "Cobertura vegetal (MSAVI2) e exposição de solo (BSI) — sinais separados",
    ajuda: "Dois subprodutos: cobertura (MSAVI2) e solo (BSI). Não há média MSAVI2+BSI.",
    avisos: [
      "MSAVI2 e BSI não são fundidos num índice único.",
      "Exposição de solo estimada ≠ diagnóstico de erosão."
    ]
  }
] as const;

export const TEMA_POR_ID: Readonly<Record<IdTemaVisualizacaoSatelite, TemaVisualizacaoSatelite>> =
  Object.fromEntries(TEMAS_VISUALIZACAO_SATELITE.map((t) => [t.id, t])) as Record<
    IdTemaVisualizacaoSatelite,
    TemaVisualizacaoSatelite
  >;

/** Subprodutos do tema cobertura/solo — nunca média dos dois. */
export interface SubprodutosCoberturaSolo {
  cobertura: { indice: "msavi2"; papel: "cobertura_vegetal" };
  solo: { indice: "bsi"; papel: "exposicao_solo" };
}

export const SUBPRODUTOS_COBERTURA_SOLO: SubprodutosCoberturaSolo = {
  cobertura: { indice: "msavi2", papel: "cobertura_vegetal" },
  solo: { indice: "bsi", papel: "exposicao_solo" }
};

export type StatusBundleObservacao =
  | "completo"
  | "incompleto_indices"
  | "produtos_parciais"
  | "sem_observacao"
  | "identidade_invalida";

export interface ObservacaoSatelitalCompleta {
  identidade: IdentidadeObservacaoSatelital;
  resolucao_analitica_m: number;
  cobertura_valida_bundle: string | null;
  indice_limitante_qualidade: IdIndiceSatelite | null;
  indices: Record<IdIndiceSatelite, SinalIndiceObservacao | null>;
  temas: readonly TemaVisualizacaoSatelite[];
  produtos: {
    condicao: ProdutoMapaCondicao;
    rasters: Record<IdIndiceSatelite, ProdutoRasterIndice>;
  };
  status_bundle: StatusBundleObservacao;
  /**
   * Bundle visual pronto = 6 índices Statistical + condição v3 + 6 rasters temáticos
   * da mesma observação (SAT-BUNDLE-01C). Ausência de qualquer produto espacial → false.
   */
  visual_pronto: boolean;
  avisos: readonly string[];
  umidade_pasto: {
    classe: ClasseUmidadePasto;
    ndmi_medio: string | null;
    experimental: true;
    versao: string;
  };
  vigor: {
    sinal_espacial_primario: "ndre";
    ndre_medio: string | null;
    evi2_medio: string | null;
    ndvi_medio: string | null;
  };
  cobertura_solo: SubprodutosCoberturaSolo & {
    msavi2_medio: string | null;
    bsi_medio: string | null;
  };
}

/** Campos mínimos de uma linha de análise para validar identidade do bundle. */
export interface LinhaIndiceParaIdentidade {
  indice: string;
  organization_id: string;
  empresa_id: string;
  area_id: string;
  geometria_sha256: string;
  versao_metodo: string;
  observacao_inicio: string | Date;
  observacao_fim: string | Date;
  colecao?: string | null;
  provedor?: string | null;
}

function iso(v: string | Date): string {
  return v instanceof Date ? v.toISOString() : v;
}

function diaCivilUtc(inicio: string | Date): string {
  const d = inicio instanceof Date ? inicio : new Date(inicio);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/**
 * Forma a identidade do bundle SOMENTE quando os seis sinais são irmãos da mesma observação.
 * Fail-closed: qualquer divergência → null (bundle não é “pronto”).
 */
export function identidadeDoBundle(
  linhas: readonly LinhaIndiceParaIdentidade[]
): IdentidadeObservacaoSatelital | null {
  if (linhas.length !== INDICES_BUNDLE_ESSENCIAL.length) return null;
  const porIndice = new Map(linhas.map((l) => [l.indice, l]));
  for (const id of INDICES_BUNDLE_ESSENCIAL) {
    if (!porIndice.has(id)) return null;
  }
  const ref = porIndice.get("ndvi")!;
  if (ref.versao_metodo !== VERSAO_METODO_PASTAGEM_ESSENCIAL) return null;
  const inicioRef = iso(ref.observacao_inicio);
  const fimRef = iso(ref.observacao_fim);
  const data = diaCivilUtc(ref.observacao_inicio);
  if (!data) return null;
  for (const id of INDICES_BUNDLE_ESSENCIAL) {
    const l = porIndice.get(id)!;
    if (
      l.organization_id !== ref.organization_id
      || l.empresa_id !== ref.empresa_id
      || l.area_id !== ref.area_id
      || l.geometria_sha256 !== ref.geometria_sha256
      || l.versao_metodo !== ref.versao_metodo
      || iso(l.observacao_inicio) !== inicioRef
      || iso(l.observacao_fim) !== fimRef
    ) {
      return null;
    }
  }
  return {
    organization_id: ref.organization_id,
    empresa_id: ref.empresa_id,
    area_id: ref.area_id,
    geometria_sha256: ref.geometria_sha256,
    versao_metodo: ref.versao_metodo,
    observacao_inicio: inicioRef,
    observacao_fim: fimRef,
    data_imagem: data,
    colecao: ref.colecao ?? "sentinel-2-l2a",
    provedor: ref.provedor ?? "copernicus_cdse"
  };
}

/** True se os seis índices estão presentes e a identidade fecha. */
export function bundleIndicesCompleto(
  indices: Record<IdIndiceSatelite, SinalIndiceObservacao | null>
): boolean {
  return INDICES_BUNDLE_ESSENCIAL.every((id) => indices[id] !== null);
}

export function produtoRasterIndisponivel(indice: IdIndiceSatelite): ProdutoRasterIndice {
  return {
    indice,
    status: "indisponivel",
    disponivel: false,
    raster_id: null,
    data_imagem: null,
    resolucao_m: null,
    versao_encoding: null
  };
}

export function produtoCondicaoIndisponivel(): ProdutoMapaCondicao {
  return {
    status: "indisponivel",
    disponivel: false,
    mapa_id: null,
    data_imagem: null,
    resolucao_m: null,
    versao_classificador: null,
    resumo: null
  };
}

/**
 * Status do bundle. “Completo” = identidade + 6 índices + condição v3 + 6 rasters.
 * Qualquer produto espacial faltante → `produtos_parciais` (SAT-BUNDLE-01C).
 */
export function statusBundleDe(p: {
  identidade: IdentidadeObservacaoSatelital | null;
  indicesCompletos: boolean;
  condicaoDisponivel: boolean;
  /** Quantos rasters técnicos já materializados (de 6). Bloqueia completo se < 6. */
  rastersDisponiveis?: number;
}): StatusBundleObservacao {
  if (!p.identidade) return p.indicesCompletos ? "identidade_invalida" : "sem_observacao";
  if (!p.indicesCompletos) return "incompleto_indices";
  const rastersOk = p.rastersDisponiveis ?? 0;
  if (!p.condicaoDisponivel || rastersOk < INDICES_BUNDLE_ESSENCIAL.length) {
    return "produtos_parciais";
  }
  return "completo";
}
