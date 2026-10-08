"use client";
import * as React from "react";
import { flushSync } from "react-dom";
import type { Feature, Polygon } from "geojson";
import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { num } from "@/lib/utils";
import { criarSessaoGoogle, estiloSatelite, estiloFundoLiso, fonteRaster, ID_BASE, type TipoBase, CENTRO_PADRAO, ZOOM_PADRAO } from "./basemap";
import { anelAberto, centroPx, centroideLngLat, type LngLat, type Px } from "./editor-desenho";
import { COR_LINHA_AREA, COR_PADRAO_AREA, corBordaNoMapa, corExibidaNoMapa } from "./cores";
import { suavizarRotulos } from "./rotulos";
import type { RotuloArea } from "./camada-desenho";

/**
 * Base de mapa COMPARTILHADA pelas telas do mesmo cadastro (erp.areas): o Mapa geral, o Mapa de Manejo (pastos)
 * e o editor de contorno da ficha de Áreas/Piquetes. Aqui fica só o mecanismo do mapa — imagem, camadas das
 * áreas, localização, troca de base, rótulos. Quem desenha e quem abre o cadastro é a tela.
 */

/** Área como a listagem de `areas` a devolve (só o que o mapa usa). */
export interface AreaNoMapa {
  id: string;
  empresa_id?: string;
  retiro_id?: string | null;
  name: string;
  code?: string | null;
  area_ha?: string | number | null;
  color: string | null;
  geometria: Polygon | null;
  land_use?: string | null;
  status?: string | null;
}

export const hectares = (v: AreaNoMapa["area_ha"]) => (v === null || v === undefined || v === "" ? 0 : Number(v));

/**
 * As áreas visíveis para o mapa (quem recorta por tenant e empresa é o servidor). A chave fica sob `["res", "areas"]`
 * de propósito: o Salvar e o Excluir da ficha de Áreas/Piquetes invalidam esse prefixo, e o mapa nunca mostra a área
 * de antes do salvar.
 */
export function useAreasDoMapa() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["res", "areas", "mapa", session?.empresaId ?? null],
    queryFn: () => api<{ items: AreaNoMapa[] }>(`/api/resources/areas${qs({ pageSize: 500 })}`)
  });
}

/** Textos dos controles do MapLibre (dicas dos botões) em PT-BR — o padrão do pacote é inglês. */
const TEXTOS_DO_MAPA: Record<string, string> = {
  "AttributionControl.ToggleAttribution": "Mostrar ou ocultar os créditos do mapa",
  "AttributionControl.MapFeedback": "Enviar comentário sobre o mapa",
  "GeolocateControl.FindMyLocation": "Minha localização",
  "GeolocateControl.LocationNotAvailable": "Localização indisponível",
  "NavigationControl.ResetBearing": "Voltar o norte para cima",
  "NavigationControl.ZoomIn": "Aproximar",
  "NavigationControl.ZoomOut": "Afastar"
};
/** Acima disto (em metros) a localização é avisada como aproximada — GPS de celular fica bem abaixo. */
const PRECISAO_BOA_M = 50;

/** Feature da área desenhada nesta ficha (contorno atual) na fonte das áreas. */
export const ID_CONTORNO_ATUAL = "__contorno_atual";

type GanchoE2E = "__mapaManejoE2E" | "__mapaManejoPastosE2E" | "__editorContornoE2E";

export interface MapaBase {
  containerRef: React.RefObject<HTMLDivElement | null>;
  mapRef: React.RefObject<MapLibreMap | null>;
  pronto: boolean;
  semImagem: boolean;
  base: TipoBase;
  trocarBase: (novo: TipoBase) => Promise<void>;
  erroBase: string | null;
  localizacao: { precisao: number } | null;
  erroLocalizacao: string | null;
  /** Força um novo desenho da tela (camada SVG e rótulos acompanham a projeção do mapa). */
  redesenhar: () => void;
}

/**
 * Cria o mapa uma vez só (satélite do Google quando há chave; fundo liso sem ela), com a fonte `areas` e suas três
 * camadas (preenchimento, contorno fino e contorno de destaque por feature-state `selecionada`/`hover`).
 * `aoCarregar` registra os eventos próprios da tela; `aoMudarVista` roda dentro do quadro do mapa a cada pan/zoom,
 * antes do redesenho síncrono da tela.
 */
export function useMapaBase(opts: { ganchoE2E: GanchoE2E; aoCarregar?: (m: MapLibreMap) => void; aoMudarVista?: (m: MapLibreMap) => void }): MapaBase {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const [pronto, setPronto] = React.useState(false);
  const [semImagem, setSemImagem] = React.useState(false);
  const [base, setBase] = React.useState<TipoBase>("satelite");
  const [erroBase, setErroBase] = React.useState<string | null>(null);
  const [localizacao, setLocalizacao] = React.useState<{ precisao: number } | null>(null);
  const [erroLocalizacao, setErroLocalizacao] = React.useState<string | null>(null);
  const [, redesenhar] = React.useReducer((n: number) => n + 1, 0);
  const optsRef = React.useRef(opts);
  optsRef.current = opts;

  React.useEffect(() => {
    let cancelado = false;
    let mapaCleanup: MapLibreMap | null = null;
    const gancho = optsRef.current.ganchoE2E;
    (async () => {
      const container = containerRef.current;
      if (!container) return;
      // maplibre-gl 5 é UMD (worker embutido no próprio pacote — funciona em qualquer bundler sem servir arquivo à
      // parte); conforme a interop do bundler, a API vem no namespace ou em `default`.
      const mod = await import("maplibre-gl");
      const maplibre = mod.default ?? mod;
      if (cancelado) return;
      const sessao = await criarSessaoGoogle();
      if (cancelado || !containerRef.current) return;
      setSemImagem(!sessao);
      const m = new maplibre.Map({
        container: containerRef.current,
        style: sessao ? estiloSatelite(sessao) : estiloFundoLiso(),
        center: CENTRO_PADRAO,
        zoom: ZOOM_PADRAO,
        attributionControl: { compact: true },
        // mapa sempre norte para cima: o botão direito é "desfazer" no desenho e o rumo do Shift é de bússola
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        locale: TEXTOS_DO_MAPA
      });
      m.touchZoomRotate.disableRotation();
      mapaCleanup = m;
      m.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
      // "Minha localização": o controle do MapLibre pede a permissão do navegador e segue o usuário. Sempre a posição
      // NOVA (maximumAge 0) e tempo para o GPS fixar; a precisão vai para a tela, porque no computador a posição vem da
      // rede e pode errar centenas de metros — quem olha o ponto precisa saber disso.
      const geo = new maplibre.GeolocateControl({ positionOptions: { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }, fitBoundsOptions: { maxZoom: 18 }, trackUserLocation: true });
      geo.on("geolocate", (ev: { coords?: GeolocationCoordinates }) => {
        const precisao = ev.coords?.accuracy;
        if (typeof precisao === "number") { setLocalizacao({ precisao }); setErroLocalizacao(null); }
      });
      geo.on("error", (ev: { code?: number }) => {
        setErroLocalizacao(ev.code === 1 ? "Localização bloqueada: libere a permissão de localização no navegador." : ev.code === 3 ? "A localização demorou demais. Toque de novo no botão de localização." : "Localização indisponível agora.");
      });
      m.addControl(geo, "bottom-right");
      mapRef.current = m;

      m.on("load", () => {
        if (cancelado) return;
        m.addSource("areas", { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "id" });
        // `opacidade_fill` (SAT-07): no modo por pixel a área COM imagem fica transparente (o gradiente cobre);
        // sem imagem fica mais clara para distinguir o fallback "por área".
        m.addLayer({
          id: "areas-fill", type: "fill", source: "areas",
          paint: {
            "fill-color": ["coalesce", ["get", "cor_exibida"], COR_PADRAO_AREA],
            "fill-opacity": ["coalesce", ["get", "opacidade_fill"], 0.78]
          }
        });
        m.addLayer({
          id: "areas-contorno", type: "line", source: "areas",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": COR_LINHA_AREA, "line-opacity": 1, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.3, 13, 0.45, 16, 0.55, 18, 0.7] }
        });
        // Destaque: hover ou seleção — só a linha branca mais marcada (sem fill brilhante).
        m.addLayer({
          id: "areas-contorno-selecao", type: "line", source: "areas",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": COR_LINHA_AREA,
            "line-opacity": ["case", ["boolean", ["feature-state", "selecionada"], false], 1, ["boolean", ["feature-state", "hover"], false], 1, 0],
            "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.4, 14, 1.8, 18, 2.2]
          }
        });
        // A camada SVG e os nomes são DOM por cima do canvas. Redesenhá-los num quadro DEPOIS do mapa os fazia
        // "tremer" ao arrastar; aqui acompanham o MESMO quadro: no fim de cada render do mapa (dentro do
        // requestAnimationFrame dele) a tela é atualizada de forma síncrona — só quando a vista mudou de fato.
        let vista = "";
        m.on("render", () => {
          const c = m.getCenter(), tela = m.getCanvas();
          const agora = `${c.lng},${c.lat},${m.getZoom()},${m.getBearing()},${tela.width}x${tela.height}`;
          if (agora === vista) return;
          vista = agora;
          optsRef.current.aoMudarVista?.(m);
          flushSync(() => redesenhar());
        });
        optsRef.current.aoCarregar?.(m);
        // Gancho só para e2e: projetar vértices reais das áreas e disparar eventos do mapa.
        (window as unknown as Record<string, MapLibreMap | undefined>)[gancho] = m;
        setPronto(true);
      });
    })();
    return () => {
      cancelado = true;
      delete (window as unknown as Record<string, MapLibreMap | undefined>)[gancho];
      mapaCleanup?.remove();
      mapRef.current = null;
    };
  }, []);

  // Troca entre satélite e ruas sem recarregar o estilo: a base de ruas entra sob demanda, sob as áreas.
  const trocarBase = React.useCallback(async (novo: TipoBase) => {
    if (novo === base || semImagem) return;
    const m = mapRef.current;
    if (!m) return;
    if (!m.getLayer(ID_BASE[novo])) {
      const s = await criarSessaoGoogle(novo);
      if (!mapRef.current) return;
      if (!s) { setErroBase(novo === "mapa" ? "Não foi possível carregar o mapa de ruas agora." : "Não foi possível carregar o satélite agora."); return; }
      m.addSource(ID_BASE[novo], fonteRaster(s));
      m.addLayer({ id: ID_BASE[novo], type: "raster", source: ID_BASE[novo] }, m.getLayer("areas-fill") ? "areas-fill" : undefined);
    }
    for (const t of ["satelite", "mapa"] as const) {
      if (m.getLayer(ID_BASE[t])) m.setLayoutProperty(ID_BASE[t], "visibility", t === novo ? "visible" : "none");
    }
    setErroBase(null);
    setBase(novo);
  }, [base, semImagem]);

  return { containerRef, mapRef, pronto, semImagem, base, trocarBase, erroBase, localizacao, erroLocalizacao, redesenhar };
}

/**
 * Põe as áreas na fonte `areas` do mapa (as sem contorno ficam de fora). `atual` é o contorno da ficha aberta.
 * `corPorArea` (Mapa geral, decisão 294) troca a cor exibida de cada área — o NDVI —, sem mudar a cor do cadastro.
 * `opacidadePorArea` (SAT-07) ajusta o preenchimento quando o gradiente por pixel cobre a área.
 */
export function desenharAreas(
  m: MapLibreMap,
  areas: readonly AreaNoMapa[],
  atual?: { geometria: Polygon; cor: string | null } | null,
  corPorArea?: ReadonlyMap<string, string> | null,
  opacidadePorArea?: ReadonlyMap<string, number> | null
) {
  const src = m.getSource("areas") as GeoJSONSource | undefined;
  if (!src) return;
  const feature = (id: string, nome: string, cor: string | null, geometria: Polygon): Feature<Polygon> => {
    const exibida = corPorArea?.get(id) ?? corExibidaNoMapa(cor);
    const opacidade = opacidadePorArea?.get(id) ?? 0.78;
    return {
      type: "Feature", id,
      properties: { id, nome, cor: cor ?? COR_PADRAO_AREA, cor_exibida: exibida, cor_borda: corBordaNoMapa(exibida), opacidade_fill: opacidade },
      geometry: geometria
    };
  };
  const features = areas.filter((a) => a.geometria && a.geometria.type === "Polygon").map((a) => feature(a.id, a.name, a.color, a.geometria as Polygon));
  if (atual) features.push(feature(ID_CONTORNO_ATUAL, "", atual.cor, atual.geometria));
  src.setData({ type: "FeatureCollection", features });
}

/** Liga/desliga o destaque (linha branca mais marcada) de uma área por feature-state. */
export function marcarSelecao(m: MapLibreMap, id: string, selecionada: boolean) {
  try { m.setFeatureState({ source: "areas", id }, { selecionada }); } catch { /* fonte ainda sem a feature */ }
}

type Caixa = [[number, number], [number, number]];

/** Caixa envolvente [[oeste, sul],[leste, norte]] de polígonos GeoJSON, para enquadrar no mapa. */
export function limites(poligonos: readonly (Polygon | null | undefined)[]): Caixa | null {
  let oeste = Infinity, sul = Infinity, leste = -Infinity, norte = -Infinity;
  for (const g of poligonos) {
    for (const pos of g?.coordinates?.[0] ?? []) {
      const lng = pos[0], lat = pos[1];
      if (lng === undefined || lat === undefined) continue;
      if (lng < oeste) oeste = lng;
      if (lng > leste) leste = lng;
      if (lat < sul) sul = lat;
      if (lat > norte) norte = lat;
    }
  }
  if (!Number.isFinite(oeste)) return null;
  return [[oeste, sul], [leste, norte]];
}

/** Nomes e hectares das áreas na projeção atual, já sem sobreposição (recalcula a cada redesenho). */
export function rotulosDasAreas(m: MapLibreMap, areas: readonly AreaNoMapa[], destaqueId: string | null): RotuloArea[] {
  const proj = (ll: LngLat): Px => { const p = m.project(ll); return { x: p.x, y: p.y }; };
  const brutos = areas.flatMap((a) => {
    const anel = anelAberto(a.geometria);
    if (anel.length < 3) return [];
    const pts = anel.map(proj);
    const c = centroideLngLat(anel);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return [{ id: a.id, px: c ? proj(c) : centroPx(pts, anel, proj), nome: a.name, ha: hectares(a.area_ha), larguraPx: maxX - minX, alturaPx: maxY - minY }];
  });
  return suavizarRotulos(brutos, { destaqueId, zoom: m.getZoom() });
}

/** Satélite × ruas (sem chave do Google, só o aviso). */
export function SeletorDeBase({ mapa, aviso }: { mapa: MapaBase; aviso: string }) {
  if (mapa.semImagem) return <div className="rounded bg-slate-800/80 px-2 py-1 text-xs text-white">{aviso}</div>;
  const botao = (tipo: TipoBase, rotulo: string) => (
    <button type="button" onClick={() => void mapa.trocarBase(tipo)} aria-pressed={mapa.base === tipo} data-testid={`mapa-base-${tipo}`}
      className={`px-2.5 py-1 ${mapa.base === tipo ? "bg-slate-800 font-medium text-white" : "text-slate-600 hover:bg-slate-100"}`}>{rotulo}</button>
  );
  return (
    <div className="pointer-events-auto flex overflow-hidden rounded-md border border-slate-300 bg-white text-xs shadow-sm" role="group" aria-label="Tipo de mapa">
      {botao("satelite", "Satélite")}
      {botao("mapa", "Mapa")}
    </div>
  );
}

/** Precisão da localização do usuário (ou o motivo de não haver localização). */
export function AvisoDeLocalizacao({ mapa }: { mapa: MapaBase }) {
  const { localizacao, erroLocalizacao } = mapa;
  if (!localizacao && !erroLocalizacao) return null;
  return (
    <div className="pointer-events-none absolute bottom-[7.5rem] right-2 max-w-xs rounded-md border border-slate-200 bg-white/95 px-3 py-1.5 text-xs shadow-sm" data-testid="mapa-localizacao">
      {erroLocalizacao ? (
        <span className="text-red-600">{erroLocalizacao}</span>
      ) : localizacao && (
        <>
          <span className="font-medium tabular-nums text-slate-700">Sua localização: precisão de ± {num(Math.round(localizacao.precisao), 0)} m</span>
          {localizacao.precisao > PRECISAO_BOA_M && (
            <span className="mt-0.5 block text-amber-700" data-testid="mapa-localizacao-aproximada">Posição aproximada: no computador ela vem da rede (Wi-Fi). No celular com GPS ligado fica precisa.</span>
          )}
        </>
      )}
    </div>
  );
}
