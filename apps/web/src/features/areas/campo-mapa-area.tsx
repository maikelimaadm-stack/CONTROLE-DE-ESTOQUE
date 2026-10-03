"use client";
import * as React from "react";
import type { Feature, Polygon } from "geojson";
import type { Map as MapLibreMap, GeoJSONSource, MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Check, RotateCcw, Undo2 } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { criarSessaoGoogle, estiloSatelite, estiloFundoLiso, CENTRO_PADRAO, ZOOM_PADRAO } from "@/features/mapa-de-manejo/basemap";
import { areaHa, anelAberto, poligonoGeoJSON, type LngLat } from "@/features/mapa-de-manejo/editor-desenho";
import { COR_LINHA_AREA, COR_PADRAO_AREA } from "@/features/mapa-de-manejo/cores";

/**
 * Campo de mapa do cadastro de Área/Piquete: desenha o perímetro (GeoJSON Polygon) e devolve
 * geometria + área total (ha). Fluxo do cadastro: mapa primeiro, depois a ficha.
 */

function lerGeometria(v: unknown): Polygon | null {
  if (v == null || v === "") return null;
  let g: unknown = v;
  if (typeof v === "string") {
    try { g = JSON.parse(v); } catch { return null; }
  }
  if (!g || typeof g !== "object") return null;
  const o = g as { type?: string; coordinates?: unknown };
  if (o.type !== "Polygon" || !Array.isArray(o.coordinates)) return null;
  return o as Polygon;
}

export function CampoMapaArea({
  value,
  onChange,
  onAreaHa,
  disabled,
  cor = COR_PADRAO_AREA
}: {
  value: unknown;
  onChange: (geometria: Polygon | null) => void;
  /** Preenche área total (ha) a partir do polígono. */
  onAreaHa?: (ha: number) => void;
  disabled?: boolean;
  cor?: string;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const [pronto, setPronto] = React.useState(false);
  const [desenhando, setDesenhando] = React.useState(false);
  const [pontos, setPontos] = React.useState<LngLat[]>([]);
  const pontosRef = React.useRef<LngLat[]>([]);
  React.useEffect(() => { pontosRef.current = pontos; }, [pontos]);
  const desenhandoRef = React.useRef(false);
  React.useEffect(() => { desenhandoRef.current = desenhando; }, [desenhando]);
  const geom = React.useMemo(() => lerGeometria(value), [value]);
  const haAtual = geom ? Math.round(areaHa(anelAberto(geom)) * 100) / 100 : null;

  React.useEffect(() => {
    let cancelado = false;
    let mapa: MapLibreMap | null = null;
    (async () => {
      const el = containerRef.current;
      if (!el) return;
      const mod = await import("maplibre-gl");
      const maplibre = mod.default ?? mod;
      if (cancelado || !containerRef.current) return;
      const sessao = await criarSessaoGoogle("satelite");
      const estilo = sessao ? estiloSatelite(sessao) : estiloFundoLiso();
      mapa = new maplibre.Map({
        container: containerRef.current,
        style: estilo,
        center: CENTRO_PADRAO,
        zoom: ZOOM_PADRAO,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false
      });
      mapRef.current = mapa;
      mapa.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
      mapa.on("load", () => {
        if (cancelado || !mapa) return;
        mapa.addSource("ficha", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        mapa.addLayer({ id: "ficha-fill", type: "fill", source: "ficha", paint: { "fill-color": ["coalesce", ["get", "cor"], COR_PADRAO_AREA], "fill-opacity": 0.35 } });
        mapa.addLayer({ id: "ficha-line", type: "line", source: "ficha", paint: { "line-color": COR_LINHA_AREA, "line-width": 2 } });
        mapa.addSource("rascunho", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        mapa.addLayer({ id: "rascunho-line", type: "line", source: "rascunho", paint: { "line-color": "#22c55e", "line-width": 2, "line-dasharray": [2, 1] } });
        mapa.addLayer({ id: "rascunho-pts", type: "circle", source: "rascunho", filter: ["==", ["get", "tipo"], "ponto"], paint: { "circle-radius": 5, "circle-color": "#22c55e", "circle-stroke-width": 1, "circle-stroke-color": "#fff" } });
        setPronto(true);
      });
      mapa.on("click", (ev: MapMouseEvent) => {
        if (!desenhandoRef.current || disabled) return;
        const ll: LngLat = [ev.lngLat.lng, ev.lngLat.lat];
        setPontos((p) => [...p, ll]);
      });
    })();
    return () => {
      cancelado = true;
      mapa?.remove();
      mapRef.current = null;
      setPronto(false);
    };
  }, [disabled]);

  // Polígono gravado / valor do formulário
  React.useEffect(() => {
    const m = mapRef.current;
    if (!m || !pronto || desenhando) return;
    const src = m.getSource("ficha") as GeoJSONSource | undefined;
    if (!src) return;
    const features: Feature[] = [];
    if (geom) {
      features.push({
        type: "Feature",
        properties: { cor: cor || COR_PADRAO_AREA },
        geometry: geom
      });
      const anel = anelAberto(geom);
      if (anel.length >= 3) {
        let o = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
        for (const [lng, lat] of anel) {
          if (lng < o) o = lng; if (lng > e) e = lng;
          if (lat < s) s = lat; if (lat > n) n = lat;
        }
        if (Number.isFinite(o)) m.fitBounds([[o, s], [e, n]], { padding: 48, maxZoom: 16 });
      }
    }
    src.setData({ type: "FeatureCollection", features });
  }, [geom, cor, pronto, desenhando]);

  // Rascunho do desenho
  React.useEffect(() => {
    const m = mapRef.current;
    if (!m || !pronto) return;
    const src = m.getSource("rascunho") as GeoJSONSource | undefined;
    if (!src) return;
    const features: Feature[] = [];
    if (pontos.length >= 2) {
      features.push({
        type: "Feature",
        properties: { tipo: "linha" },
        geometry: { type: "LineString", coordinates: pontos }
      });
    }
    for (const p of pontos) {
      features.push({
        type: "Feature",
        properties: { tipo: "ponto" },
        geometry: { type: "Point", coordinates: p }
      });
    }
    src.setData({ type: "FeatureCollection", features });
  }, [pontos, pronto]);

  function iniciarDesenho() {
    if (disabled) return;
    setPontos([]);
    setDesenhando(true);
  }
  function desfazerPonto() {
    setPontos((p) => p.slice(0, -1));
  }
  function limparDesenho() {
    setPontos([]);
  }
  function cancelarDesenho() {
    setPontos([]);
    setDesenhando(false);
  }
  function fecharPoligono() {
    if (pontos.length < 3) return;
    const pts = pontos.map((ll) => ({ lng: ll[0], lat: ll[1], grudado: false as const, tipo: null, de: null }));
    const g = poligonoGeoJSON(pts);
    const ha = Math.round(areaHa(pontos) * 100) / 100;
    onChange(g);
    onAreaHa?.(ha);
    setDesenhando(false);
    setPontos([]);
  }
  function limparGeometria() {
    if (disabled) return;
    onChange(null);
  }

  return (
    <div className="flex w-full flex-col gap-2" data-testid="campo-mapa-area">
      <p className="text-[12px] text-slate-600">
        Desenhe o perímetro no mapa e, em seguida, preencha os demais campos do cadastro.
        {haAtual != null && !desenhando && (
          <span className="ml-1 font-medium tabular-nums text-slate-800">Área do polígono: {haAtual.toFixed(2)} ha</span>
        )}
      </p>
      <div className="relative overflow-hidden rounded-md border border-slate-200 bg-slate-100">
        <div ref={containerRef} className="h-[320px] w-full" data-testid="campo-mapa-canvas" />
        {desenhando && (
          <div className="pointer-events-none absolute bottom-2 left-2 rounded-full border border-slate-200 bg-white/95 px-3 py-1 text-xs text-slate-700 shadow-sm">
            Clique para marcar os pontos · mínimo 3 · use Fechar para gravar o contorno
            {pontos.length > 0 && <span className="ml-1 tabular-nums text-slate-500">({pontos.length} ponto{pontos.length === 1 ? "" : "s"})</span>}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {!desenhando ? (
          <>
            <Button type="button" size="sm" disabled={disabled || !pronto} onClick={iniciarDesenho} data-testid="campo-mapa-desenhar">
              {geom ? "Redesenhar contorno" : "Desenhar no mapa"}
            </Button>
            {geom && (
              <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={limparGeometria} data-testid="campo-mapa-limpar">
                Remover contorno
              </Button>
            )}
          </>
        ) : (
          <>
            <Button type="button" size="sm" disabled={pontos.length < 3} onClick={fecharPoligono} data-testid="campo-mapa-fechar">
              <Check className="mr-1 h-3.5 w-3.5" /> Fechar polígono
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={pontos.length === 0} onClick={desfazerPonto} data-testid="campo-mapa-desfazer">
              <Undo2 className="mr-1 h-3.5 w-3.5" /> Desfazer ponto
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pontos.length === 0} onClick={limparDesenho}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Recomeçar
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={cancelarDesenho}>Cancelar</Button>
          </>
        )}
      </div>
      {!pronto && <p className={cn("text-[11px] text-slate-400")}>Carregando mapa…</p>}
    </div>
  );
}
