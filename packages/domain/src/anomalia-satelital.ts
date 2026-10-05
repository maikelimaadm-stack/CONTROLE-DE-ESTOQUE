/**
 * ANOMALIA / TENDÊNCIA OPERACIONAL — SATÉLITE COMPLETO (decisão 301).
 *
 * Versão auditável `sat-anomalia-v1`. NÃO é diagnóstico de praga nem biomassa.
 * Usa vários índices; um único índice em queda NÃO gera alerta forte.
 * Sem interpolação artificial. Geometrias diferentes → não compara.
 */

import type { IdIndiceSatelite } from "./indices-satelitais.js";

export const VERSAO_ANOMALIA_SATELITE = "sat-anomalia-v1";

export type NivelAnomalia = "nenhuma" | "dados_insuficientes" | "leve" | "moderada" | "forte";

export interface PontoSerieIndice {
  data: string; // ISO day or instant
  media: number;
  qualidadeOk: boolean;
  geometriaSha256: string;
}

export interface MotivoAnomalia {
  codigo: string;
  mensagem: string;
  indice?: IdIndiceSatelite;
  delta?: number;
}

export interface ResultadoAnomalia {
  versao: typeof VERSAO_ANOMALIA_SATELITE;
  nivel: NivelAnomalia;
  score: number | null;
  motivos: MotivoAnomalia[];
  vistoria_recomendada: boolean;
  /** Sempre false — proibido pelo contrato. */
  praga_detectada: false;
  biomassa_estimada: false;
}

/** Tendência temporal por janela (não confundir com `TendenciaCurta` de rótulo em indices-satelitais). */
export interface TendenciaJanelaSatelite {
  periodo: "ultima" | "30d" | "90d";
  delta: number | null;
  pontos: number;
}

const MIN_PONTOS = 3;

function ultimoParUtil(serie: readonly PontoSerieIndice[]): [PontoSerieIndice, PontoSerieIndice] | null {
  const ok = serie.filter((p) => p.qualidadeOk && Number.isFinite(p.media));
  if (ok.length < 2) return null;
  const a = ok[ok.length - 2]!;
  const b = ok[ok.length - 1]!;
  if (a.geometriaSha256 !== b.geometriaSha256) return null;
  return [a, b];
}

function deltaRelativo(antes: number, depois: number): number {
  const base = Math.max(Math.abs(antes), 0.05);
  return (depois - antes) / base;
}

/**
 * Avalia anomalia multi-índice. Séries devem estar ordenadas do mais antigo ao mais recente.
 * Pontos de geometrias diferentes do hash atual são ignorados.
 */
export function avaliarAnomaliaSatelite(opts: {
  geometriaSha256Atual: string | null;
  series: Partial<Record<IdIndiceSatelite, readonly PontoSerieIndice[]>>;
}): ResultadoAnomalia {
  const base: ResultadoAnomalia = {
    versao: VERSAO_ANOMALIA_SATELITE,
    nivel: "nenhuma",
    score: null,
    motivos: [],
    vistoria_recomendada: false,
    praga_detectada: false,
    biomassa_estimada: false
  };

  if (!opts.geometriaSha256Atual) {
    return { ...base, nivel: "dados_insuficientes", motivos: [{ codigo: "sem_geometria", mensagem: "Área sem contorno atual." }] };
  }

  const hash = opts.geometriaSha256Atual;
  const filtrar = (s: readonly PontoSerieIndice[] | undefined) =>
    (s ?? []).filter((p) => p.geometriaSha256 === hash && p.qualidadeOk && Number.isFinite(p.media));

  const ndvi = filtrar(opts.series.ndvi);
  const ndre = filtrar(opts.series.ndre);
  const ndmi = filtrar(opts.series.ndmi);
  const msavi2 = filtrar(opts.series.msavi2);
  const bsi = filtrar(opts.series.bsi);

  if (ndvi.length < MIN_PONTOS && ndre.length < MIN_PONTOS) {
    return {
      ...base,
      nivel: "dados_insuficientes",
      motivos: [{ codigo: "historico_curto", mensagem: "Dados insuficientes para avaliar tendência." }]
    };
  }

  const motivos: MotivoAnomalia[] = [];
  let pontos = 0;

  const parNdvi = ultimoParUtil(ndvi);
  if (parNdvi) {
    const d = deltaRelativo(parNdvi[0].media, parNdvi[1].media);
    if (d <= -0.25) {
      motivos.push({ codigo: "queda_ndvi", mensagem: "Queda de vigor (NDVI).", indice: "ndvi", delta: d });
      pontos += d <= -0.4 ? 2 : 1;
    }
  }

  const parNdre = ultimoParUtil(ndre);
  if (parNdre) {
    const d = deltaRelativo(parNdre[0].media, parNdre[1].media);
    if (d <= -0.2) {
      motivos.push({ codigo: "queda_ndre", mensagem: "Queda de resposta no red edge (NDRE).", indice: "ndre", delta: d });
      pontos += d <= -0.35 ? 2 : 1;
    }
  }

  const parNdmi = ultimoParUtil(ndmi);
  if (parNdmi) {
    const d = deltaRelativo(parNdmi[0].media, parNdmi[1].media);
    if (d <= -0.2 || parNdmi[1].media < -0.1) {
      motivos.push({ codigo: "ndmi_baixo", mensagem: "Menor umidade relativa na vegetação (NDMI).", indice: "ndmi", delta: d });
      pontos += 1;
    }
  }

  const parBsi = ultimoParUtil(bsi);
  if (parBsi) {
    const d = deltaRelativo(parBsi[0].media, parBsi[1].media);
    if (d >= 0.2) {
      motivos.push({ codigo: "bsi_sobe", mensagem: "Aumento de sinal de solo exposto (BSI).", indice: "bsi", delta: d });
      pontos += 1;
    }
  }

  const parMsavi = ultimoParUtil(msavi2);
  if (parMsavi) {
    const d = deltaRelativo(parMsavi[0].media, parMsavi[1].media);
    if (d <= -0.2) {
      motivos.push({ codigo: "msavi2_cai", mensagem: "Redução de cobertura (MSAVI2).", indice: "msavi2", delta: d });
      pontos += 1;
    }
  }

  // A-3: só NDVI cai, outros normais → evitar diagnóstico forte
  const soNdvi = motivos.length === 1 && motivos[0]?.codigo === "queda_ndvi";
  if (soNdvi) {
    return {
      ...base,
      nivel: "leve",
      score: 20,
      motivos: [
        ...motivos,
        { codigo: "sinal_unico", mensagem: "Alteração concentrada em mais de um índice ainda não confirmada." }
      ],
      vistoria_recomendada: false
    };
  }

  if (pontos === 0) {
    return { ...base, nivel: "nenhuma", score: 0, motivos: [] };
  }

  let nivel: NivelAnomalia = "leve";
  if (pontos >= 4) nivel = "forte";
  else if (pontos >= 2) nivel = "moderada";

  return {
    ...base,
    nivel,
    score: Math.min(100, pontos * 18),
    motivos,
    vistoria_recomendada: nivel === "moderada" || nivel === "forte"
  };
}

/** Delta entre último e penúltimo ponto útil da mesma geometria. */
export function tendenciaUltimaComparacao(serie: readonly PontoSerieIndice[]): TendenciaJanelaSatelite {
  const par = ultimoParUtil(serie);
  if (!par) return { periodo: "ultima", delta: null, pontos: serie.filter((p) => p.qualidadeOk).length };
  return { periodo: "ultima", delta: par[1].media - par[0].media, pontos: serie.filter((p) => p.qualidadeOk).length };
}

export function tendenciaJanela(
  serie: readonly PontoSerieIndice[],
  dias: 30 | 90,
  agoraMs = Date.now()
): TendenciaJanelaSatelite {
  const periodo = dias === 30 ? "30d" : "90d";
  const corte = agoraMs - dias * 86_400_000;
  const ok = serie.filter((p) => p.qualidadeOk && Number.isFinite(p.media) && Date.parse(p.data) >= corte);
  if (ok.length < 2) return { periodo, delta: null, pontos: ok.length };
  const primeiro = ok[0]!;
  const ultimo = ok[ok.length - 1]!;
  if (primeiro.geometriaSha256 !== ultimo.geometriaSha256) {
    return { periodo, delta: null, pontos: ok.length };
  }
  return { periodo, delta: ultimo.media - primeiro.media, pontos: ok.length };
}
