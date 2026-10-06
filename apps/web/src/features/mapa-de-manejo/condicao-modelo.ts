/**
 * Condição da área — contratos de leitura e regras puras (sem React e sem `@/`, para serem testadas).
 *
 * As formas abaixo espelham o que a API devolve em
 *   GET /api/satelite/areas/:id/resumo
 *   GET /api/satelite/areas/:id/historico?indice=
 * O texto que o usuário lê sai daqui: sinal de satélite não é diagnóstico — fala em "resposta de vegetação",
 * "possível alteração" e "solo exposto estimado".
 */
import {
  LIMIARES_QUALIDADE,
  avaliarAnomaliaSatelite,
  type EstadoQualidade,
  type IdIndiceSatelite,
  type IndicadoresDerivados,
  type NivelAnomalia,
  type PontoSerieIndice,
  type ResultadoAnomalia
} from "@agro/domain";

export type IdIndice = IdIndiceSatelite;

export interface ComparacaoAnterior {
  anterior_id: string;
  anterior_valor_medio: string;
  anterior_observacao_inicio: string | null;
  delta_percentual: number | null;
  tendencia: "subiu" | "estavel" | "caiu" | "queda_forte" | "indeterminada";
}

export interface IndiceDoResumo {
  id: string;
  situacao: string;
  motivo_qualidade: string | null;
  observacao_inicio: string | null;
  observacao_fim: string | null;
  valor_medio: string | null;
  valor_minimo: string | null;
  valor_maximo: string | null;
  desvio_padrao: string | null;
  cobertura_valida: string | null;
  resolucao_m: string;
  resolucao_nativa_m: string | null;
  comparacao_observacao_anterior?: ComparacaoAnterior | null;
}

export interface QualidadeDoResumo {
  estado: EstadoQualidade;
  cobertura_valida: string | null;
  indice_limitante: IdIndice | null;
  coberturas_por_indice: Partial<Record<IdIndice, string | null>>;
  cloud_ratio: string | null;
  motivo: string | null;
}

export interface BundleDoResumo {
  observacao_inicio: string | null;
  observacao_fim: string | null;
  do_poligono_atual: boolean;
  qualidade: QualidadeDoResumo;
  indices: Partial<Record<IdIndice, IndiceDoResumo>>;
}

/** Tendência do NDVI numa janela. `delta` NULO = dados insuficientes (nunca zero): `NULL ≠ 0`. */
export interface TendenciaJanela {
  periodo: "ultima" | "30d" | "90d";
  delta: number | null;
  pontos: number;
}

export interface TendenciaDoResumo {
  ultima: TendenciaJanela;
  "30d": TendenciaJanela;
  "90d": TendenciaJanela;
}

export interface ResumoCondicao {
  area_id: string;
  versao_metodo: string;
  /** Hash do contorno vigente da área, calculado pelo servidor (parte da identidade do cache de rasters). */
  geometria_sha256?: string | null;
  /** Tendência do NDVI (a API a calcula sobre a série do NDVI). Ausente na API anterior. */
  tendencia?: TendenciaDoResumo | null;
  ultima_observacao_util: (BundleDoResumo & { indicadores_derivados: IndicadoresDerivados | null }) | null;
  ultima_tentativa: (BundleDoResumo & { situacao: string; motivo_qualidade: string | null; criado_em: string }) | null;
  /** A API pode devolver a anomalia pronta; sem ela a tela calcula pelo histórico. */
  anomalia?: ResultadoAnomalia | null;
  aviso: string;
}

export interface ItemHistoricoIndice {
  id: string;
  situacao: string;
  motivo_qualidade: string | null;
  geometria_sha256: string;
  do_poligono_atual: boolean;
  observacao_inicio: string | null;
  observacao_fim: string | null;
  valor_medio: string | null;
  valor_minimo: string | null;
  valor_maximo: string | null;
  desvio_padrao: string | null;
  cobertura_valida: string | null;
  criado_em: string;
  /** Histograma oficial da Statistical API, quando a análise o guardou. */
  histograma?: unknown;
}

export interface HistoricoIndice {
  area_id: string;
  indice: IdIndice;
  geometria_sha256: string | null;
  do_poligono_atual: boolean;
  itens: ItemHistoricoIndice[];
}

export const ROTULO_QUALIDADE: Readonly<Record<EstadoQualidade, string>> = {
  excelente: "Excelente",
  boa: "Boa",
  limitada: "Limitada",
  insuficiente: "Insuficiente",
  sem_imagem_util: "Sem imagem útil"
};

export const ROTULO_NIVEL_ANOMALIA: Readonly<Record<NivelAnomalia, string>> = {
  nenhuma: "Sem alteração relevante",
  dados_insuficientes: "Dados insuficientes para avaliar",
  leve: "Possível alteração (leve)",
  moderada: "Possível alteração (moderada)",
  forte: "Possível alteração (forte)"
};

/** Aviso agronômico fixo da tela: o satélite mede sinal espectral, não decide manejo. */
export const AVISO_AGRONOMICO =
  "Sinal de satélite não é diagnóstico: vegetação detectada não significa necessariamente capim útil. Confirme em campo antes de decidir.";

export const ROTULO_ESTIMATIVA: Readonly<Record<string, string>> = {
  alta: "Alta",
  alto: "Alto",
  media: "Média",
  medio: "Médio",
  baixa: "Baixa",
  baixo: "Baixo",
  indeterminada: "Indeterminada",
  indeterminado: "Indeterminado"
};

export const estimativaLegivel = (v: string | null | undefined): string => (v ? (ROTULO_ESTIMATIVA[v] ?? v) : "—");

export const paraNumero = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Cobertura do bundle é razão 0..1 em texto: "0,8730" → 87,3. */
export const coberturaEmPercentual = (v: string | null | undefined): number | null => {
  const n = paraNumero(v);
  return n === null ? null : n * 100;
};

// ---------------------------------------------------------------------------------------------------------------
// SÉRIE / ANOMALIA / COMPARAÇÃO
// ---------------------------------------------------------------------------------------------------------------

/**
 * Pontos de uma série do histórico para o domínio: do mais antigo ao mais recente, um por observação (a análise
 * mais recente vence), com `qualidadeOk` = concluída e cobertura válida ao menos "limitada".
 */
export function serieDoHistorico(itens: readonly ItemHistoricoIndice[]): PontoSerieIndice[] {
  const porObservacao = new Map<string, ItemHistoricoIndice>();
  for (const i of itens) {
    if (!i.observacao_inicio) continue;
    const atual = porObservacao.get(i.observacao_inicio);
    if (!atual || atual.criado_em < i.criado_em) porObservacao.set(i.observacao_inicio, i);
  }
  return [...porObservacao.values()]
    .sort((a, b) => (a.observacao_inicio ?? "").localeCompare(b.observacao_inicio ?? ""))
    .map((i) => {
      const media = paraNumero(i.valor_medio);
      const cobertura = paraNumero(i.cobertura_valida);
      return {
        data: i.observacao_inicio!,
        media: media ?? Number.NaN,
        qualidadeOk: i.situacao === "concluida" && media !== null && cobertura !== null && cobertura >= LIMIARES_QUALIDADE.limitada,
        geometriaSha256: i.geometria_sha256
      };
    });
}

export const INDICES_DA_ANOMALIA: readonly IdIndice[] = ["ndvi", "ndre", "ndmi", "msavi2", "bsi"];

/** Anomalia pelo domínio (`sat-anomalia-v1`) a partir do histórico já filtrado pela API ao polígono atual. */
export function anomaliaDoHistorico(
  historicos: Partial<Record<IdIndice, HistoricoIndice | undefined>>,
  geometriaSha256Atual: string | null
): ResultadoAnomalia {
  const series: Partial<Record<IdIndice, PontoSerieIndice[]>> = {};
  for (const id of INDICES_DA_ANOMALIA) {
    const h = historicos[id];
    if (h) series[id] = serieDoHistorico(h.itens);
  }
  return avaliarAnomaliaSatelite({ geometriaSha256Atual, series });
}

export interface ObservacaoComparavel {
  chave: string;
  data: string;
  geometriaSha256: string;
}

/** Observações distintas (por data) do histórico, da mais recente à mais antiga, só as com média válida. */
export function observacoesComparaveis(itens: readonly ItemHistoricoIndice[]): ObservacaoComparavel[] {
  return serieDoHistorico(itens)
    .filter((p) => Number.isFinite(p.media))
    .map((p) => ({ chave: p.data, data: p.data, geometriaSha256: p.geometriaSha256 }))
    .reverse();
}

export type ResultadoComparacao =
  | { tipo: "bloqueada"; motivo: string }
  | { tipo: "ok"; linhas: LinhaComparacao[] };

export interface LinhaComparacao {
  indice: IdIndice;
  a: number | null;
  b: number | null;
  delta: number | null;
}

export const MSG_COMPARACAO_GEOMETRIA =
  "As duas datas foram calculadas sobre contornos diferentes da área. A comparação é bloqueada para não misturar formas distintas.";

/**
 * A × B por índice. Bloqueia se as geometrias das duas observações diferem (em qualquer índice) — comparar contornos
 * distintos seria comparar áreas distintas.
 */
export function compararObservacoes(
  chaveA: string,
  chaveB: string,
  historicos: Partial<Record<IdIndice, HistoricoIndice | undefined>>
): ResultadoComparacao {
  const hashes = new Set<string>();
  const linhas: LinhaComparacao[] = [];
  for (const [id, h] of Object.entries(historicos) as [IdIndice, HistoricoIndice | undefined][]) {
    if (!h) continue;
    const serie = serieDoHistorico(h.itens);
    const a = serie.find((p) => p.data === chaveA);
    const b = serie.find((p) => p.data === chaveB);
    if (a) hashes.add(a.geometriaSha256);
    if (b) hashes.add(b.geometriaSha256);
    if (h.geometria_sha256 && (a || b)) hashes.add(h.geometria_sha256);
    const va = a && Number.isFinite(a.media) ? a.media : null;
    const vb = b && Number.isFinite(b.media) ? b.media : null;
    linhas.push({ indice: id, a: va, b: vb, delta: va !== null && vb !== null ? vb - va : null });
  }
  if (hashes.size > 1) return { tipo: "bloqueada", motivo: MSG_COMPARACAO_GEOMETRIA };
  return { tipo: "ok", linhas };
}

/** Ponto do gráfico simples: posição 0..1 em X (ordem no tempo) e Y na escala FIXA do índice. */
export interface PontoDoGrafico { x: number; y: number; data: string; valor: number; qualidadeOk: boolean }

export function pontosDoGrafico(serie: readonly PontoSerieIndice[], escala: { min: number; max: number }): PontoDoGrafico[] {
  const validos = serie.filter((p) => Number.isFinite(p.media));
  const vao = escala.max - escala.min;
  return validos.map((p, i) => ({
    x: validos.length === 1 ? 0.5 : i / (validos.length - 1),
    y: Math.min(1, Math.max(0, (p.media - escala.min) / vao)),
    data: p.data,
    valor: p.media,
    qualidadeOk: p.qualidadeOk
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// TENDÊNCIA
// ---------------------------------------------------------------------------------------------------------------

export const ROTULO_JANELA_TENDENCIA: Readonly<Record<TendenciaJanela["periodo"], string>> = {
  ultima: "Desde a imagem anterior",
  "30d": "Últimos 30 dias",
  "90d": "Últimos 90 dias"
};

export const TEXTO_DADOS_INSUFICIENTES = "Dados insuficientes";

export interface LeituraTendencia {
  /** `null` = dados insuficientes. */
  delta: number | null;
  /** Texto pronto: "+0,05", "−0,12", "0,00" ou "Dados insuficientes". */
  texto: string;
  direcao: "subiu" | "caiu" | "estavel" | "insuficiente";
}

/** Delta nulo (ou não finito) é "Dados insuficientes" — nunca "0,00". Zero verdadeiro é "0,00" e `estavel`. */
export function lerTendencia(t: TendenciaJanela | null | undefined, formatar: (v: number) => string): LeituraTendencia {
  const delta = t?.delta;
  if (delta === null || delta === undefined || !Number.isFinite(delta)) {
    return { delta: null, texto: TEXTO_DADOS_INSUFICIENTES, direcao: "insuficiente" };
  }
  const t2 = formatar(Math.abs(delta));
  if (delta > 0) return { delta, texto: `+${t2}`, direcao: "subiu" };
  if (delta < 0) return { delta, texto: `−${t2}`, direcao: "caiu" };
  return { delta, texto: t2, direcao: "estavel" };
}

// ---------------------------------------------------------------------------------------------------------------
// HISTOGRAMA (comparação A × B)
// ---------------------------------------------------------------------------------------------------------------

export interface HistogramaIndice {
  bins: { baixo: number; alto: number; contagem: number }[];
  abaixo: number;
  acima: number;
}

const finito = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Lê o histograma oficial (`{ bins:[{lowEdge,highEdge,count}], underflowCount, overflowCount }`). Forma estranha → `null`. */
export function lerHistograma(v: unknown): HistogramaIndice | null {
  if (!v || typeof v !== "object") return null;
  const h = v as { bins?: unknown; underflowCount?: unknown; overflowCount?: unknown };
  if (!Array.isArray(h.bins) || h.bins.length === 0) return null;
  const bins: HistogramaIndice["bins"] = [];
  for (const b of h.bins) {
    const o = b as { lowEdge?: unknown; highEdge?: unknown; count?: unknown } | null;
    if (!o || !finito(o.lowEdge) || !finito(o.highEdge) || !finito(o.count) || o.count < 0 || o.highEdge <= o.lowEdge) return null;
    bins.push({ baixo: o.lowEdge, alto: o.highEdge, contagem: o.count });
  }
  return { bins, abaixo: finito(h.underflowCount) ? h.underflowCount : 0, acima: finito(h.overflowCount) ? h.overflowCount : 0 };
}

/** O item do histórico da observação (a análise mais recente dela — a mesma regra de `serieDoHistorico`). */
export function itemDaObservacao(itens: readonly ItemHistoricoIndice[], observacaoInicio: string): ItemHistoricoIndice | null {
  let melhor: ItemHistoricoIndice | null = null;
  for (const i of itens) {
    if (i.observacao_inicio !== observacaoInicio) continue;
    if (!melhor || melhor.criado_em < i.criado_em) melhor = i;
  }
  return melhor;
}

/** Alturas 0..1 das barras (pelo maior bin do próprio histograma). Sem contagem nenhuma: tudo zero. */
export function alturasDoHistograma(h: HistogramaIndice): number[] {
  const maior = Math.max(0, ...h.bins.map((b) => b.contagem));
  return h.bins.map((b) => (maior === 0 ? 0 : b.contagem / maior));
}
