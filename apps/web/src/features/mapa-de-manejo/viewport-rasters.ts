/**
 * Quais áreas pedem raster — a regra de DESEMPENHO do Mapa geral, sem React e sem `@/`, para ser testada.
 *
 * O raster é por ÁREA × ÍNDICE × DATA. Uma propriedade com ~200 áreas e 6 índices teria 1.200 imagens; a tela só
 * pede o que está à vista:
 *   · só as áreas cujo retângulo cruza a vista do mapa;
 *   · só o índice ATIVO (trocar de índice refaz o pedido; nunca pede os seis juntos);
 *   · no máximo `TETO_RASTERS_NO_VIEWPORT` áreas por vez, as mais próximas do centro (a selecionada sempre entra);
 *   · a listagem parte em lotes de `AREAS_POR_LISTAGEM` ids, e o pedido obsoleto é abortado pelo `AbortSignal`.
 */

/** Teto de áreas com imagem baixada por vista. Acima disso, aproxime o mapa. */
export const TETO_RASTERS_NO_VIEWPORT = 60;
/** Ids por listagem — o mesmo teto da API (`area_ids` 1..200). */
export const AREAS_POR_LISTAGEM = 200;

export interface RasterIndiceDto {
  id: string;
  analise_id: string;
  area_id: string;
  indice: string;
  tipo: string;
  data_imagem: string;
  largura: number;
  altura: number;
  /** Ordem MapLibre: NO, NE, SE, SO — NUNCA reordenar. */
  cantos_lnglat: [[number, number], [number, number], [number, number], [number, number]];
  escala_min: number;
  escala_max: number;
  resolucao_m: number;
  resolucao_reduzida: boolean;
  url_assinada: string;
  expira_em: string;
  encoding_version?: string | null;
  nodata?: number;
  bits?: number;
  native_resolution_m?: number | null;
  processing_resolution_m?: number | null;
}

export interface Vista { oeste: number; sul: number; leste: number; norte: number }
export interface AreaComGeometria { id: string; geometria: unknown }

interface CaixaDaArea { oeste: number; sul: number; leste: number; norte: number }

export function caixaDaArea(geometria: unknown): CaixaDaArea | null {
  const g = geometria as { type?: string; coordinates?: number[][][] } | null;
  if (!g || g.type !== "Polygon" || !g.coordinates?.[0]?.length) return null;
  let oeste = Infinity, sul = Infinity, leste = -Infinity, norte = -Infinity;
  for (const pos of g.coordinates[0]) {
    const lng = pos[0], lat = pos[1];
    if (lng === undefined || lat === undefined) continue;
    if (lng < oeste) oeste = lng;
    if (lng > leste) leste = lng;
    if (lat < sul) sul = lat;
    if (lat > norte) norte = lat;
  }
  return Number.isFinite(oeste) ? { oeste, sul, leste, norte } : null;
}

export interface SelecaoViewport {
  /** Ids a pedir, já limitados ao teto e ordenados do mais próximo do centro ao mais distante. */
  ids: string[];
  /** Quantas áreas cruzam a vista (antes do teto). */
  naVista: number;
  /** Todas as áreas que cruzam a vista (antes do teto), da mais próxima do centro à mais distante. */
  idsNaVista: string[];
  /** `true` se o teto cortou áreas da vista. */
  truncado: boolean;
}

/**
 * Áreas da vista, limitadas ao teto. `prioritarias` (ex.: a área aberta no painel) entram primeiro se cruzam a vista.
 * Sem `vista` (mapa ainda não pronto) → nenhuma área: nada é pedido antes de saber o que está à vista.
 */
export function selecionarAreasDaVista(
  areas: readonly AreaComGeometria[],
  vista: Vista | null,
  opcoes: { teto?: number; prioritarias?: readonly string[] } = {}
): SelecaoViewport {
  const teto = opcoes.teto ?? TETO_RASTERS_NO_VIEWPORT;
  if (!vista) return { ids: [], naVista: 0, idsNaVista: [], truncado: false };
  const cx = (vista.oeste + vista.leste) / 2;
  const cy = (vista.sul + vista.norte) / 2;
  const dentro: { id: string; distancia: number }[] = [];
  for (const a of areas) {
    const c = caixaDaArea(a.geometria);
    if (!c) continue;
    if (!(c.leste >= vista.oeste && c.oeste <= vista.leste && c.norte >= vista.sul && c.sul <= vista.norte)) continue;
    const dx = (c.oeste + c.leste) / 2 - cx;
    const dy = (c.sul + c.norte) / 2 - cy;
    dentro.push({ id: a.id, distancia: dx * dx + dy * dy });
  }
  const prioridade = new Set(opcoes.prioritarias ?? []);
  dentro.sort((a, b) => {
    const pa = prioridade.has(a.id) ? 0 : 1;
    const pb = prioridade.has(b.id) ? 0 : 1;
    return pa - pb || a.distancia - b.distancia || a.id.localeCompare(b.id);
  });
  const idsNaVista = dentro.map((d) => d.id);
  return { ids: idsNaVista.slice(0, teto), naVista: idsNaVista.length, idsNaVista, truncado: idsNaVista.length > teto };
}

/** Pedido de página de listagem, injetado: a tela passa `api()`, o teste passa um `fetch` simulado. */
export type RequisitarJson = <T>(caminho: string, opcoes?: { signal?: AbortSignal }) => Promise<T>;

interface PaginaRasters { itens: RasterIndiceDto[]; pagina: number; tamanho: number; tem_mais: boolean }

function consulta(parametros: Record<string, string | number>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(parametros)) p.set(k, String(v));
  return `?${p.toString()}`;
}

/** A imagem MAIS RECENTE do índice para cada área pedida (nunca gera). Lotes de até 200 ids; só o índice pedido. */
export async function listarRastersPorAreas(
  areaIds: readonly string[],
  indice: string,
  requisitar: RequisitarJson,
  opcoes: { signal?: AbortSignal } = {}
): Promise<RasterIndiceDto[]> {
  const unicos = [...new Set(areaIds.filter(Boolean))];
  const saida: RasterIndiceDto[] = [];
  for (let i = 0; i < unicos.length; i += AREAS_POR_LISTAGEM) {
    const fatia = unicos.slice(i, i + AREAS_POR_LISTAGEM);
    let pagina = 1;
    for (;;) {
      if (opcoes.signal?.aborted) throw new DOMException("Pedido de raster abortado", "AbortError");
      const r = await requisitar<PaginaRasters>(
        `/api/mapa/rasters${consulta({ area_ids: fatia.join(","), indice, pagina, tamanho: AREAS_POR_LISTAGEM })}`,
        { signal: opcoes.signal }
      );
      saida.push(...r.itens);
      if (!r.tem_mais) break;
      pagina += 1;
    }
  }
  return saida;
}

/** Ids da vista que ainda NÃO estão no cache do índice ativo — é o que de fato vai à rede. */
export function idsFaltando(ids: readonly string[], emCache: ReadonlySet<string>): string[] {
  return ids.filter((id) => !emCache.has(id));
}
