/**
 * TEMAS OPERACIONAIS DO MAPA DE PASTO — SAT-BUNDLE-01B [F2].
 *
 * Apresentação: cinco temas. Não cria análise. Mapeia para produtos F1 já materializados.
 * `cobertura_solo` do domínio vira dois temas de UI (Cobertura / Solo).
 */
import {
  AVISO_UMIDADE_NAO_E_SOLO,
  LIMIARES_UMIDADE_PASTO_EXPERIMENTAL,
  SUBPRODUTOS_COBERTURA_SOLO,
  type IdIndiceSatelite
} from "@agro/domain";

export type TemaMapaPasto = "condicao" | "umidade" | "vigor" | "cobertura" | "solo";

export const TEMAS_MAPA_PASTO: readonly {
  id: TemaMapaPasto;
  rotulo: string;
  indiceFonte: IdIndiceSatelite | null;
  linguagem: string;
  aviso?: string;
}[] = [
  {
    id: "condicao",
    rotulo: "Condição",
    indiceFonte: null,
    linguagem: "Classificação multi-índice da condição espectral do pasto"
  },
  {
    id: "umidade",
    rotulo: "Umidade",
    indiceFonte: "ndmi",
    linguagem: "Umidade espectral da vegetação/pasto",
    aviso: AVISO_UMIDADE_NAO_E_SOLO
  },
  {
    id: "vigor",
    rotulo: "Vigor",
    indiceFonte: "ndre",
    linguagem: "Vigor relativo da vegetação"
  },
  {
    id: "cobertura",
    rotulo: "Cobertura",
    indiceFonte: SUBPRODUTOS_COBERTURA_SOLO.cobertura.indice,
    linguagem: "Resposta de cobertura vegetal"
  },
  {
    id: "solo",
    rotulo: "Solo",
    indiceFonte: SUBPRODUTOS_COBERTURA_SOLO.solo.indice,
    linguagem: "Exposição de solo estimada"
  }
] as const;

export const TEMA_DEFAULT: TemaMapaPasto = "condicao";

export type ModoMapaPasto = "operacional" | "tecnico";

/** Faixas VISUAIS fixas — comparáveis entre pastos/datas. Não inventam ciência. */
export interface FaixaVisualTema {
  id: string;
  rotulo: string;
  /** Limite inferior inclusivo do valor decodificado (exceto nodata). */
  min: number;
  /** Limite superior exclusivo (último usa +Infinity). */
  max: number;
  cor: string;
  /** Código bin 1..N gravado na grade categórica intermediária. */
  codigo: number;
}

const L = LIMIARES_UMIDADE_PASTO_EXPERIMENTAL;

export const FAIXAS_UMIDADE: readonly FaixaVisualTema[] = [
  { id: "muito_baixa", rotulo: "Muito baixa", min: -Infinity, max: L.baixa - 0.05, cor: "#fef3c7", codigo: 1 },
  { id: "baixa", rotulo: "Baixa", min: L.baixa - 0.05, max: L.baixa, cor: "#fde68a", codigo: 2 },
  { id: "moderada", rotulo: "Moderada", min: L.baixa, max: L.moderadaMax, cor: "#a7f3d0", codigo: 3 },
  { id: "adequada", rotulo: "Adequada", min: L.moderadaMax, max: L.adequadaMax, cor: "#34d399", codigo: 4 },
  { id: "alta", rotulo: "Alta", min: L.adequadaMax, max: Infinity, cor: "#059669", codigo: 5 }
];

export const FAIXAS_VIGOR: readonly FaixaVisualTema[] = [
  { id: "baixo", rotulo: "Baixo", min: -Infinity, max: 0.15, cor: "#d4d4aa", codigo: 1 },
  { id: "moderado", rotulo: "Moderado", min: 0.15, max: 0.30, cor: "#86efac", codigo: 2 },
  { id: "alto", rotulo: "Alto", min: 0.30, max: Infinity, cor: "#166534", codigo: 3 }
];

export const FAIXAS_COBERTURA: readonly FaixaVisualTema[] = [
  { id: "baixa", rotulo: "Baixa", min: -Infinity, max: 0.25, cor: "#fbbf24", codigo: 1 },
  { id: "moderada", rotulo: "Moderada", min: 0.25, max: 0.45, cor: "#86efac", codigo: 2 },
  { id: "alta", rotulo: "Alta", min: 0.45, max: Infinity, cor: "#14532d", codigo: 3 }
];

export const FAIXAS_SOLO: readonly FaixaVisualTema[] = [
  { id: "baixa", rotulo: "Baixa exposição", min: -Infinity, max: 0.05, cor: "#d1fae5", codigo: 1 },
  { id: "moderada", rotulo: "Moderada", min: 0.05, max: 0.20, cor: "#d6b88c", codigo: 2 },
  { id: "alta", rotulo: "Alta exposição", min: 0.20, max: Infinity, cor: "#b45309", codigo: 3 }
];

export function faixasDoTema(tema: TemaMapaPasto): readonly FaixaVisualTema[] | null {
  switch (tema) {
    case "umidade": return FAIXAS_UMIDADE;
    case "vigor": return FAIXAS_VIGOR;
    case "cobertura": return FAIXAS_COBERTURA;
    case "solo": return FAIXAS_SOLO;
    default: return null;
  }
}

export function indiceFonteDoTema(tema: TemaMapaPasto): IdIndiceSatelite | null {
  return TEMAS_MAPA_PASTO.find((t) => t.id === tema)?.indiceFonte ?? null;
}

export type StatusAreaMapa =
  | "SEM_ANALISE"
  | "PREPARANDO"
  | "PRONTO"
  | "PARCIAL"
  | "FALHA"
  | "DESATUALIZADO";

export function statusAreaDoResumo(p: {
  status_bundle: string;
  visual_pronto: boolean;
  condicao_disponivel: boolean;
  rasters_disponiveis: number;
}): StatusAreaMapa {
  if (p.status_bundle === "sem_observacao") return "SEM_ANALISE";
  if (p.status_bundle === "identidade_invalida") return "FALHA";
  if (p.status_bundle === "incompleto_indices") return "PREPARANDO";
  if (p.visual_pronto && p.status_bundle === "completo") return "PRONTO";
  if (p.status_bundle === "produtos_parciais") return "PARCIAL";
  return "PREPARANDO";
}

export function rotuloStatusLista(status: StatusAreaMapa, tema: TemaMapaPasto, resumoTema?: string | null): string {
  if (status === "SEM_ANALISE") return "Sem análise";
  if (status === "PREPARANDO") return "Preparando visualizações";
  if (status === "FALHA") return "Falha na observação";
  if (status === "DESATUALIZADO") return "Desatualizado";
  if (resumoTema) return resumoTema;
  const nomes: Record<TemaMapaPasto, string> = {
    condicao: "Condição disponível",
    umidade: "Umidade disponível",
    vigor: "Vigor disponível",
    cobertura: "Cobertura disponível",
    solo: "Solo disponível"
  };
  return status === "PARCIAL" ? "Parcial" : nomes[tema];
}
