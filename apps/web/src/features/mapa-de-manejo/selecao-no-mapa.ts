import * as React from "react";
import type { Map as MapLibreMap, MapMouseEvent, PointLike } from "maplibre-gl";
import { CAMADAS_DE_LOTES } from "./camada-lotes";
import { ID_CONTORNO_ATUAL, marcarSelecao, type MapaBase } from "./mapa-base";

/**
 * MAPA-MANEJO-04 (F2) — CAMADA 2: o CLIQUE no mapa operacional escolhe a área do painel.
 *
 *   clique no MARCADOR (lotes-fallback | lotes-icone | lotes-badge) → `area_id` da feature do marcador
 *   senão, clique no POLÍGONO (`areas-fill`)                        → id da área (o contorno da ficha é ignorado)
 *   senão (clique no vazio)                                          → null
 *
 * O marcador tem prioridade sobre o polígono que está por baixo dele, e entre marcadores sobrepostos vale o de cima
 * (`queryRenderedFeatures` devolve o de cima primeiro). Camada desligada (`visibility: none`) não é desenhada e,
 * portanto, não responde ao clique. A área vazia (sem marcador) abre o MESMO painel pelo polígono.
 *
 * O único cálculo aqui é posição em pixel (a caixa de tolerância do toque ao redor do ponto).
 */

/** Camada de preenchimento das áreas (mapa-base.tsx). */
export const CAMADA_AREAS = "areas-fill";
/** Camadas do marcador que abrem o painel. */
export const CAMADAS_DO_MARCADOR: readonly string[] = CAMADAS_DE_LOTES;
/** Folga, em px, ao redor do toque para acertar o marcador (dedo no celular); o polígono usa o ponto exato. */
export const TOLERANCIA_DO_MARCADOR_PX = 6;
/** Espera, em ms, para o canvas do MapLibre medir o contêiner depois que o painel abre ou fecha (o /mapa-geral usa 80). */
export const ATRASO_DO_RESIZE_MS = 80;

/** O que a seleção lê de uma feature do mapa (o `MapGeoJSONFeature` do MapLibre satisfaz). */
export interface FeatureDoClique {
  id?: string | number;
  properties?: Record<string, unknown> | null;
}

const texto = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : null);

/** Área do marcador: `properties.area_id` (toda feature da fonte `lotes` o tem). */
export function areaDoMarcador(f: FeatureDoClique): string | null {
  return texto(f.properties?.area_id);
}

/** Área do polígono: `properties.id` (ou o id promovido); o contorno da ficha aberta (editor) não é área do mapa. */
export function areaDoPoligono(f: FeatureDoClique): string | null {
  const id = texto(f.properties?.id) ?? texto(f.id);
  return id !== null && id !== ID_CONTORNO_ATUAL ? id : null;
}

/** A área do clique: o primeiro marcador com área; senão o primeiro polígono com área; senão `null` (vazio). */
export function areaDoClique(marcadores: readonly FeatureDoClique[], poligonos: readonly FeatureDoClique[]): string | null {
  for (const f of marcadores) {
    const id = areaDoMarcador(f);
    if (id !== null) return id;
  }
  for (const f of poligonos) {
    const id = areaDoPoligono(f);
    if (id !== null) return id;
  }
  return null;
}

type Ponto = { x: number; y: number };

function consultar(m: MapLibreMap, p: Ponto, camadas: readonly string[], folga: number): FeatureDoClique[] {
  const existentes = camadas.filter((id) => m.getLayer(id));
  if (existentes.length === 0) return [];
  const alvo: PointLike | [PointLike, PointLike] = folga > 0 ? [[p.x - folga, p.y - folga], [p.x + folga, p.y + folga]] : [p.x, p.y];
  return m.queryRenderedFeatures(alvo, { layers: existentes });
}

/** A área sob o ponto da tela (marcador antes do polígono), ou `null`. */
export function areaNoPonto(m: MapLibreMap, p: Ponto): string | null {
  return areaDoClique(consultar(m, p, CAMADAS_DO_MARCADOR, TOLERANCIA_DO_MARCADOR_PX), consultar(m, p, [CAMADA_AREAS], 0));
}

/**
 * Registra o clique e o cursor de seleção: `aoSelecionar(id da área)` no marcador ou no polígono, `aoSelecionar(null)`
 * no vazio; cursor `pointer` sobre marcador e área. Devolve a função que remove tudo o que registrou.
 */
export function registrarSelecao(m: MapLibreMap, aoSelecionar: (areaId: string | null) => void): () => void {
  let sobreArea = false;
  const cursor = (sobre: boolean) => {
    if (sobre === sobreArea) return;
    sobreArea = sobre;
    m.getCanvas().style.cursor = sobre ? "pointer" : "";
  };
  const aoClicar = (e: MapMouseEvent) => { aoSelecionar(areaNoPonto(m, e.point)); };
  const aoMover = (e: MapMouseEvent) => { cursor(areaNoPonto(m, e.point) !== null); };
  const aoSair = () => { cursor(false); };
  m.on("click", aoClicar);
  m.on("mousemove", aoMover);
  m.on("mouseout", aoSair);
  return () => {
    m.off("click", aoClicar);
    m.off("mousemove", aoMover);
    m.off("mouseout", aoSair);
    cursor(false);
  };
}

/** Destaque da seleção no contorno (feature-state `selecionada` da fonte `areas`): apaga o anterior e acende o atual. */
export function destacarSelecao(m: MapLibreMap, anterior: string | null, atual: string | null): void {
  if (anterior !== null && anterior !== atual) marcarSelecao(m, anterior, false);
  if (atual !== null) marcarSelecao(m, atual, true);
}

/**
 * `m.resize()` adiado (debounce) quando o painel abre ou fecha: sem isso o canvas WebGL fica com o tamanho velho. O
 * mesmo padrão do /mapa-geral (setTimeout + clearTimeout). `deps`: o que muda o tamanho do mapa (ex.: a seleção);
 * o número de itens tem de ser fixo entre renderizações.
 */
export function useResizeAdiado(mapa: Pick<MapaBase, "mapRef" | "pronto">, deps: React.DependencyList): void {
  const { mapRef, pronto } = mapa;
  React.useEffect(() => {
    const m = mapRef.current;
    if (!m || !pronto) return;
    const t = window.setTimeout(() => { m.resize(); }, ATRASO_DO_RESIZE_MS);
    return () => window.clearTimeout(t);
  }, [mapRef, pronto, ...deps]);
}
