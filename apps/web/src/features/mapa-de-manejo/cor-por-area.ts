/**
 * Cor do preenchimento da área no Mapa geral — regra pura (sem React e sem `@/`, para ser testada).
 *
 * Ordem de decisão (nunca outra):
 *   1. imagem por pixel da área → o pixel (o preenchimento some; isso é com a camada de raster, não daqui);
 *   2. sem imagem, mas com estatística válida DO ÍNDICE ATIVO → cor da ÁREA pela paleta DESSE índice;
 *   3. sem análise válida → cinza neutro;
 *   4. cor do cadastro SÓ quando o usuário escolheu "Cor do cadastro" (aqui devolve `null`: o mapa usa a do cadastro).
 * A cor de cadastro nunca é recurso analítico: NDMI sem análise não vira "verde do cadastro".
 */
import { CLASSES_NDVI_MAPA, classeNdvi, type ChaveClasseNdvi } from "@agro/domain";
import { corDoValor, type IdIndice } from "./paletas-indices";

export type ModoCor = "pixel" | "area" | "cadastro";

/** Cor de cada classe da escala fixa do NDVI (do vermelho ao verde escuro). A classe e o limite são do domínio. */
export const COR_CLASSE_NDVI: Readonly<Record<ChaveClasseNdvi, string>> = {
  sem_vegetacao: "#d73027",
  baixo: "#fc8d59",
  medio: "#d9ef8b",
  alto: "#1a9850"
};
/** Área sem observação útil (ou nunca analisada): cinza — nunca uma cor de classe inventada. */
export const COR_SEM_NDVI = "#94a3b8";
export const COR_SEM_ANALISE = COR_SEM_NDVI;

export const corDoNdvi = (valor: string | null | undefined) => {
  const c = classeNdvi(valor);
  return c ? COR_CLASSE_NDVI[c.chave] : COR_SEM_NDVI;
};

export { CLASSES_NDVI_MAPA };

/** O pedaço do resumo por área de que a cor precisa (a forma de `ResumoNdviDaArea`, valendo para qualquer índice). */
export interface ResumoParaCor {
  ultima_observacao: { valor_medio: string | null; do_poligono_atual?: boolean } | null;
}

/** Média válida do índice ativo: há observação, é do contorno ATUAL e a média é um número finito. Senão `null`. */
export function mediaValidaDoIndice(item: ResumoParaCor | null | undefined): number | null {
  const obs = item?.ultima_observacao;
  if (!obs || obs.do_poligono_atual === false) return null;
  if (obs.valor_medio === null || obs.valor_medio === undefined || obs.valor_medio === "") return null;
  const n = Number(obs.valor_medio);
  return Number.isFinite(n) ? n : null;
}

const hex2 = (n: number) => n.toString(16).padStart(2, "0");

/** Cor da MÉDIA da área na paleta do índice. NDVI mantém as classes da escala fixa (a legenda "por área" do NDVI). */
export function corDaMediaDoIndice(indice: IdIndice, media: number): string {
  if (indice === "ndvi") return corDoNdvi(String(media));
  const [r, g, b] = corDoValor(indice, media);
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

export type OrigemCorArea = "indice" | "sem_analise";

export function corAnaliticaDaArea(indice: IdIndice, item: ResumoParaCor | null | undefined): { cor: string; origem: OrigemCorArea } {
  const media = mediaValidaDoIndice(item);
  return media === null ? { cor: COR_SEM_ANALISE, origem: "sem_analise" } : { cor: corDaMediaDoIndice(indice, media), origem: "indice" };
}

/**
 * Cor sólida por área para os modos "area" e "pixel" (no pixel, vale para a área SEM imagem). No modo "cadastro" não
 * há cor analítica: `null` (o mapa pinta com a cor do cadastro porque o usuário a escolheu).
 */
export function coresPorArea(
  modo: ModoCor,
  indice: IdIndice,
  areas: readonly { id: string }[],
  resumoPorArea: ReadonlyMap<string, ResumoParaCor> | null
): ReadonlyMap<string, string> | null {
  if (modo === "cadastro") return null;
  return new Map(areas.map((a) => [a.id, corAnaliticaDaArea(indice, resumoPorArea?.get(a.id)).cor] as const));
}
