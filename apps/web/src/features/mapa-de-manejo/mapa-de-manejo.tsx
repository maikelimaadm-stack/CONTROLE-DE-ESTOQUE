"use client";
import * as React from "react";
import type { Feature, Polygon } from "geojson";
import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl";
import { Magnet, Redo2, RotateCcw, Undo2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, qs, newIdem } from "@/lib/api";
import { useAuth, empresasDoContexto } from "@/lib/auth";
import { useEmpresaPadrao } from "@/features/docs/shared";
import { Card, CardBody, Button, Spinner, EmptyState, ErrorState, Field, Input, ConfirmDialog } from "@/components/ui";
import { cn, num } from "@/lib/utils";
import { criarSessaoGoogle, estiloSatelite, estiloFundoLiso, fonteRaster, ID_BASE, type TipoBase, CENTRO_PADRAO, ZOOM_PADRAO } from "./basemap";
import {
  IMA_PADRAO, acertar, acharIma, anelAberto, areaHa, centroPx, coordsDe, distanciaM, lerPasso, novoHistorico, perimetroM, podeDesfazer,
  podeRefazer, poligonoGeoJSON, registrar, rumoGraus, travarAngulo,
  type Acerto, type AlvoPx, type ConfigIma, type Historico, type Ima, type LngLat, type PontoDesenho, type Px, type Retrato
} from "./editor-desenho";
import { CamadaDesenho, type Lado, type RotuloArea } from "./camada-desenho";
import { PainelDesenho } from "./painel-desenho";

/**
 * MAPA-01 (decisão 279) — Mapa de Manejo: cadastro de áreas NEUTRO (lavoura e pecuária). Só nome, tamanho e
 * cor; o polígono é desenhado no mapa (MapLibre + editor próprio, `editor-desenho.ts`) e vale como GeoJSON. As
 * FUNÇÕES do desenho são as do protótipo aprovado (ímã em vértice/aresta, trava de ângulo, desfazer/refazer,
 * ponto do meio, mover a área, medidas ao vivo); o visual é o do produto. O tamanho sai do desenho e pode ser
 * ajustado à mão. CRUD pela API do recurso `mapa_areas` (escopo por empresa no servidor). Sem gado, sem base44.
 */

interface AreaApi {
  id: string;
  empresa_id: string;
  nome: string;
  tamanho_ha: string | number | null;
  cor: string | null;
  geometria: Polygon | null;
}

const COR_PADRAO = "#facc15";
/** Cor sugerida para a área nova (gira pela paleta do protótipo); o usuário troca no formulário. */
const PALETA = ["#82b1ff", "#ffab91", "#b39ddb", "#80deea", "#fff59d", "#a5d6a7"];
const hectares = (v: AreaApi["tamanho_ha"]) => (v === null || v === undefined || v === "" ? 0 : Number(v));

type Rascunho = { geometria: Polygon; tamanho_ha: number };

type Arrasto =
  | { tipo: "vertice"; i: number; novo: boolean; mexeu: boolean }
  | { tipo: "poligono"; origem: Px; orig: LngLat[]; mexeu: boolean };

/** Estado do editor. Vive num ref (os eventos do mapa leem sempre o atual) e a tela redesenha por contador. */
interface Editor {
  pontos: PontoDesenho[];
  fechado: boolean;
  hist: Historico;
  cur: Px | null;
  raw: Px | null;
  ima: Ima | null;
  travado: boolean;
  arrasto: Arrasto | null;
  hover: Acerto | null;
  acao: string;
  ultimoClique: { i: number; t: number } | null;
}
const editorVazio = (): Editor => ({
  pontos: [], fechado: false, hist: novoHistorico(), cur: null, raw: null, ima: null, travado: false,
  arrasto: null, hover: null, acao: "Clique no mapa para marcar os pontos", ultimoClique: null
});
const livre = (ll: LngLat): PontoDesenho => ({ lng: ll[0], lat: ll[1], grudado: false, tipo: null, de: null });
/** Janela do duplo clique: o ponto criado pelo 1º clique do gesto não é apagado pelo dblclick do mesmo gesto. */
const JANELA_DUPLO_MS = 600;

export function MapaDeManejo() {
  const { session, ctx } = useAuth();
  const empresaSessao = session?.empresaId ?? null;
  // Empresa da área nova: a da sessão, ou a primeira do contexto (mesma regra das telas de lançamento). É PEDIDO —
  // o servidor confere o escopo.
  const empresaId = useEmpresaPadrao();
  const empresaNome = empresasDoContexto(ctx).find((e) => e.id === empresaId)?.name ?? "";
  const queryClient = useQueryClient();

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const [mapaPronto, setMapaPronto] = React.useState(false);
  const [semImagem, setSemImagem] = React.useState(false);
  const [base, setBase] = React.useState<TipoBase>("satelite");
  const [desenhando, setDesenhando] = React.useState(false);
  const [rascunho, setRascunho] = React.useState<Rascunho | null>(null);
  const [selecionada, setSelecionada] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<{ nome: string; cor: string; tamanho_ha: string }>({ nome: "", cor: COR_PADRAO, tamanho_ha: "" });
  const [excluir, setExcluir] = React.useState<AreaApi | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [cfg, setCfg] = React.useState<ConfigIma>(IMA_PADRAO);

  // Refs lidos pelos eventos do mapa (registrados uma vez só).
  const ed = React.useRef<Editor>(editorVazio());
  const cfgRef = React.useRef<ConfigIma>(IMA_PADRAO);
  const desenhandoRef = React.useRef(false);
  const formAbertoRef = React.useRef(false);
  const areasRef = React.useRef<AreaApi[]>([]);
  const quadroRef = React.useRef<number | null>(null);
  const soltarArrastoRef = React.useRef<(() => void) | null>(null);
  const [, redesenhar] = React.useReducer((n: number) => n + 1, 0);

  const listaQuery = useQuery({
    queryKey: ["mapa-areas", empresaSessao],
    queryFn: () => api<{ items: AreaApi[] }>(`/api/resources/mapa_areas${qs({ pageSize: 500 })}`)
  });
  const areas = React.useMemo(() => listaQuery.data?.items ?? [], [listaQuery.data]);
  React.useEffect(() => { areasRef.current = areas; }, [areas]);
  React.useEffect(() => { formAbertoRef.current = rascunho !== null; }, [rascunho]);

  // ---------- projeção ----------
  const proj = (ll: LngLat): Px => { const m = mapRef.current; if (!m) return { x: 0, y: 0 }; const p = m.project(ll); return { x: p.x, y: p.y }; };
  const desproj = (p: Px): LngLat => { const m = mapRef.current; if (!m) return [0, 0]; const ll = m.unproject([p.x, p.y]); return [ll.lng, ll.lat]; };
  const ptsPx = () => ed.current.pontos.map((pt) => proj([pt.lng, pt.lat]));
  const alvosPx = (): AlvoPx[] => areasRef.current.flatMap((a) => { const coords = anelAberto(a.geometria); return coords.length >= 2 ? [{ nome: a.nome, coords, pts: coords.map(proj) }] : []; });
  const ativo = () => desenhandoRef.current && !formAbertoRef.current;
  const doIma = (s: Ima): PontoDesenho => { const ll = s.lngLat ?? desproj(s.px); return { lng: ll[0], lat: ll[1], grudado: true, tipo: s.tipo === "aresta" ? "aresta" : "vertice", de: s.de }; };
  const agendarRedesenho = () => {
    if (quadroRef.current !== null) return;
    quadroRef.current = requestAnimationFrame(() => { quadroRef.current = null; redesenhar(); });
  };

  // ---------- histórico ----------
  function aplicar(r: Retrato, acao?: string) {
    const e = ed.current;
    e.hist = registrar(e.hist, r);
    e.pontos = r.pontos; e.fechado = r.fechado; e.arrasto = null;
    if (acao) e.acao = acao;
    redesenhar();
  }
  function irPara(i: number) {
    const e = ed.current; const r = lerPasso(e.hist, i);
    e.hist = { ...e.hist, pos: i }; e.pontos = r.pontos; e.fechado = r.fechado; e.arrasto = null; e.ima = null; e.hover = null;
    redesenhar();
  }
  function desfazer() { const e = ed.current; if (podeDesfazer(e.hist)) irPara(e.hist.pos - 1); else { e.acao = "Nada para desfazer"; redesenhar(); } }
  function refazer() { const e = ed.current; if (podeRefazer(e.hist)) irPara(e.hist.pos + 1); else { e.acao = "Nada para refazer"; redesenhar(); } }
  function recomecar() { irPara(0); ed.current.acao = "Recomeçado"; redesenhar(); }
  function fechar(acao: string) {
    const e = ed.current;
    if (e.fechado || e.pontos.length < 3) return;
    aplicar({ pontos: e.pontos, fechado: true }, acao);
    e.cur = null; e.ima = null; e.ultimoClique = { i: 0, t: performance.now() };
  }

  // ---------- eventos do desenho (px relativos ao mapa) ----------
  function aoMover(px: Px, alt: boolean, shift: boolean) {
    if (!ativo()) return;
    const e = ed.current;
    if (e.arrasto) return;
    const pts = ptsPx();
    const h = acertar(px, pts, e.fechado);
    if (h?.tipo === "vertice" && h.i === 0 && !e.fechado && pts.length >= 3) {
      // o primeiro ponto, com 3+ marcados, é o alvo de fechar
      Object.assign(e, { hover: null, raw: px, cur: pts[0], ima: { px: pts[0]!, lngLat: null, dist: 0, tipo: "fechar", de: "primeiro ponto" }, travado: false });
    } else if (h) {
      Object.assign(e, { hover: h, cur: px, raw: px, ima: null, travado: false });
    } else if (e.fechado) {
      Object.assign(e, { hover: null, cur: px, raw: null, ima: null, travado: false });
    } else {
      const s = acharIma(px, alvosPx(), cfgRef.current, { pts, fechado: false }, { soltar: alt, semFechar: false });
      const travar = shift && !s && pts.length > 0;
      Object.assign(e, { hover: null, raw: px, cur: s ? s.px : travar ? travarAngulo(pts[pts.length - 1]!, px) : px, ima: s, travado: travar });
    }
    redesenhar();
  }
  function aoSair() {
    if (!ativo() || ed.current.arrasto) return;
    Object.assign(ed.current, { cur: null, raw: null, ima: null, hover: null, travado: false });
    redesenhar();
  }
  /** Segurar: num ponto (arrasta), no meio de um lado (cria ponto e arrasta) ou dentro da área fechada (move tudo). */
  function aoPressionar(px: Px): boolean {
    if (!ativo()) return false;
    const e = ed.current;
    const h = acertar(px, ptsPx(), e.fechado);
    if (!h) return false;
    if (h.tipo === "vertice") {
      e.arrasto = { tipo: "vertice", i: h.i, novo: false, mexeu: false }; e.acao = `Arrastando o ponto ${h.i + 1}`;
    } else if (h.tipo === "meio") {
      const np = e.pontos.slice(); np.splice(h.i + 1, 0, livre(desproj(h.px))); e.pontos = np;
      e.arrasto = { tipo: "vertice", i: h.i + 1, novo: true, mexeu: false }; e.acao = "Ponto novo criado no meio";
    } else {
      e.arrasto = { tipo: "poligono", origem: px, orig: coordsDe(e.pontos), mexeu: false }; e.acao = "Movendo a área";
    }
    e.hover = null;
    redesenhar();
    return true;
  }
  function aoArrastar(px: Px, alt: boolean) {
    const e = ed.current; const d = e.arrasto;
    if (!d) return;
    if (d.tipo === "vertice") {
      const s = acharIma(px, alvosPx(), cfgRef.current, { pts: ptsPx(), fechado: e.fechado }, { soltar: alt, semFechar: true });
      const np = e.pontos.slice(); np[d.i] = s ? doIma(s) : livre(desproj(px)); e.pontos = np;
      Object.assign(e, { raw: px, cur: s ? s.px : px, ima: s });
    } else {
      const dx = px.x - d.origem.x, dy = px.y - d.origem.y;
      e.pontos = d.orig.map((ll) => { const p = proj(ll); return livre(desproj({ x: p.x + dx, y: p.y + dy })); });
      Object.assign(e, { cur: px, raw: px, ima: null });
    }
    d.mexeu = true;
    redesenhar();
  }
  function aoSoltar() {
    const e = ed.current; const d = e.arrasto;
    if (!d) return;
    if (d.tipo === "vertice") {
      if (d.novo || d.mexeu) aplicar({ pontos: e.pontos, fechado: e.fechado }, d.novo ? "Ponto do meio virou vértice" : "Ponto solto");
      else if (d.i === 0 && !e.fechado && e.pontos.length >= 3) { e.arrasto = null; fechar("Fechado no primeiro ponto"); }
      else { e.arrasto = null; e.acao = "Ponto solto"; }
    } else if (d.mexeu) {
      aplicar({ pontos: e.pontos, fechado: e.fechado }, "Área movida");
    } else {
      e.arrasto = null;
    }
    e.ima = null;
    redesenhar();
  }
  function aoClicar(px: Px, alt: boolean, shift: boolean, detalhe: number) {
    if (!ativo()) return;
    if (detalhe >= 2) return; // 2º clique do duplo: o dblclick decide
    const e = ed.current; const pts = ptsPx();
    if (acertar(px, pts, e.fechado)) return; // segurar/soltar num alvo já foi tratado
    if (e.fechado) { e.acao = "Fechada — arraste os pontos, ou toque em Recomeçar"; redesenhar(); return; }
    const s = acharIma(px, alvosPx(), cfgRef.current, { pts, fechado: false }, { soltar: alt, semFechar: false });
    if (s?.tipo === "fechar") { fechar("Fechado no primeiro ponto"); return; }
    const novo = s ? doIma(s) : livre(desproj(shift && pts.length ? travarAngulo(pts[pts.length - 1]!, px) : px));
    aplicar({ pontos: [...e.pontos, novo], fechado: false }, s ? `Ponto grudou ${s.tipo === "aresta" ? "na aresta" : "no vértice"} de ${s.de}` : "Ponto marcado");
    e.ultimoClique = { i: e.pontos.length - 1, t: performance.now() };
  }
  function aoDuploClique(px: Px) {
    if (!ativo()) return;
    const e = ed.current;
    const h = acertar(px, ptsPx(), e.fechado);
    const uc = e.ultimoClique;
    const mesmoGesto = !!uc && h?.tipo === "vertice" && h.i === uc.i && performance.now() - uc.t < JANELA_DUPLO_MS;
    if (h?.tipo === "vertice" && !mesmoGesto && e.pontos.length > 3) {
      const np = e.pontos.slice(); np.splice(h.i, 1);
      aplicar({ pontos: np, fechado: e.fechado }, `Ponto ${h.i + 1} apagado`);
      e.hover = null;
      return;
    }
    fechar("Fechado com dois cliques");
  }
  function iniciarArrasto() {
    const m = mapRef.current;
    if (!m) return;
    const caixa = m.getCanvasContainer();
    const mover = (ev: PointerEvent) => { const r = caixa.getBoundingClientRect(); aoArrastar({ x: ev.clientX - r.left, y: ev.clientY - r.top }, ev.altKey); };
    const soltar = () => {
      window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", soltar); window.removeEventListener("pointercancel", soltar);
      soltarArrastoRef.current = null;
      aoSoltar();
    };
    window.addEventListener("pointermove", mover); window.addEventListener("pointerup", soltar); window.addEventListener("pointercancel", soltar);
    soltarArrastoRef.current = soltar;
  }

  // ---------- mapa (inicialização única) ----------
  React.useEffect(() => {
    let cancelado = false;
    let mapaCleanup: MapLibreMap | null = null;
    (async () => {
      const container = containerRef.current;
      if (!container) return;
      // maplibre-gl 5 é UMD (worker embutido no próprio pacote — funciona em qualquer bundler sem servir arquivo à
      // parte); conforme a interop do bundler, a API vem no namespace ou em `default`.
      const mod = await import("maplibre-gl");
      const maplibre = mod.default ?? mod;
      if (cancelado) return;
      const sessao = await criarSessaoGoogle();
      if (cancelado) return;
      setSemImagem(!sessao);
      const m = new maplibre.Map({
        container,
        style: sessao ? estiloSatelite(sessao) : estiloFundoLiso(),
        center: CENTRO_PADRAO,
        zoom: ZOOM_PADRAO,
        attributionControl: { compact: true },
        // mapa sempre norte para cima: o botão direito é "desfazer" no desenho e o rumo do Shift é de bússola
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false
      });
      m.touchZoomRotate.disableRotation();
      mapaCleanup = m;
      m.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
      // "Habilitar minha localização": o controle do MapLibre pede a permissão do navegador e centra no usuário.
      m.addControl(new maplibre.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), "bottom-right");
      mapRef.current = m;

      m.on("load", () => {
        if (cancelado) return;
        m.addSource("areas", { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "id" });
        m.addLayer({ id: "areas-fill", type: "fill", source: "areas", paint: { "fill-color": ["coalesce", ["get", "cor"], COR_PADRAO], "fill-opacity": ["case", ["boolean", ["feature-state", "selecionada"], false], 0.45, 0.25] } });
        m.addLayer({ id: "areas-contorno", type: "line", source: "areas", paint: { "line-color": ["coalesce", ["get", "cor"], COR_PADRAO], "line-width": ["case", ["boolean", ["feature-state", "selecionada"], false], 3, 2] } });
        m.on("click", "areas-fill", (e) => { if (desenhandoRef.current) return; const f = e.features?.[0]; if (f && f.properties) setSelecionada(String(f.properties.id)); });
        m.on("mouseenter", "areas-fill", () => { if (!desenhandoRef.current) m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", "areas-fill", () => { if (!desenhandoRef.current) m.getCanvas().style.cursor = ""; });

        // editor de desenho
        const px = (ev: { point: { x: number; y: number } }): Px => ({ x: ev.point.x, y: ev.point.y });
        m.on("mousemove", (ev) => aoMover(px(ev), ev.originalEvent.altKey, ev.originalEvent.shiftKey));
        m.on("mouseout", () => aoSair());
        m.on("mousedown", (ev) => { if (ev.originalEvent.button === 0 && aoPressionar(px(ev))) { ev.preventDefault(); iniciarArrasto(); } });
        m.on("touchstart", (ev) => { if (ev.points.length === 1 && aoPressionar(px(ev))) { ev.preventDefault(); iniciarArrasto(); } });
        m.on("click", (ev) => aoClicar(px(ev), ev.originalEvent.altKey, ev.originalEvent.shiftKey, ev.originalEvent.detail));
        m.on("dblclick", (ev) => { if (!ativo()) return; ev.preventDefault(); aoDuploClique(px(ev)); });
        m.on("contextmenu", (ev) => { if (!ativo()) return; ev.originalEvent.preventDefault(); desfazer(); });
        m.on("move", () => agendarRedesenho());
        setMapaPronto(true);
      });
    })();
    return () => {
      cancelado = true;
      soltarArrastoRef.current?.();
      if (quadroRef.current !== null) cancelAnimationFrame(quadroRef.current);
      mapaCleanup?.remove(); mapRef.current = null;
    };
  }, []);

  // ---------- modo desenho: atalhos de teclado e gestos do mapa ----------
  React.useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapaPronto) return;
    if (desenhando) { m.doubleClickZoom.disable(); m.boxZoom.disable(); } else { m.doubleClickZoom.enable(); m.boxZoom.enable(); m.getCanvas().style.cursor = ""; }
  }, [desenhando, mapaPronto]);
  React.useEffect(() => {
    const m = mapRef.current;
    if (m && desenhando) m.getCanvas().style.cursor = ed.current.arrasto ? "grabbing" : "crosshair";
  });
  React.useEffect(() => {
    if (!desenhando) return;
    const aoTeclar = (ev: KeyboardEvent) => {
      if (formAbertoRef.current) return;
      const alvo = ev.target instanceof HTMLElement ? ev.target : null;
      if (alvo?.closest("input, textarea, select, [contenteditable='true']")) return;
      const k = ev.key, mod = ev.ctrlKey || ev.metaKey;
      if (mod && (k === "z" || k === "Z")) { ev.preventDefault(); if (ev.shiftKey) refazer(); else desfazer(); return; }
      if (mod && (k === "y" || k === "Y")) { ev.preventDefault(); refazer(); return; }
      if (k === "Backspace" || k === "Delete") { ev.preventDefault(); desfazer(); return; }
      if (k === "Enter" && !ed.current.fechado && ed.current.pontos.length >= 3) { ev.preventDefault(); fechar("Fechado com Enter"); }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [desenhando]);

  // ---------- desenhar as áreas salvas no mapa ----------
  React.useEffect(() => {
    const mapa = mapRef.current;
    if (!mapa || !mapaPronto) return;
    const src = mapa.getSource("areas") as GeoJSONSource | undefined;
    if (!src) return;
    const features: Feature<Polygon>[] = areas
      .filter((a) => a.geometria && a.geometria.type === "Polygon")
      .map((a) => ({ type: "Feature", id: a.id, properties: { id: a.id, nome: a.nome, cor: a.cor ?? COR_PADRAO }, geometry: a.geometria as Polygon }));
    src.setData({ type: "FeatureCollection", features });
  }, [areas, mapaPronto]);

  // ---------- realce da selecionada ----------
  React.useEffect(() => {
    const mapa = mapRef.current;
    if (!mapa || !mapaPronto) return;
    for (const a of areas) { try { mapa.setFeatureState({ source: "areas", id: a.id }, { selecionada: a.id === selecionada }); } catch { /* fonte ainda não pronta */ } }
  }, [selecionada, areas, mapaPronto]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!rascunho) return;
      if (!empresaId) throw new Error("Nenhuma empresa disponível para cadastrar a área.");
      const tamanho = form.tamanho_ha.trim() === "" ? rascunho.tamanho_ha : Number(form.tamanho_ha.replace(",", "."));
      await api("/api/resources/mapa_areas", { method: "POST", idempotencyKey: newIdem(), body: { empresa_id: empresaId, nome: form.nome.trim(), cor: form.cor, tamanho_ha: tamanho, geometria: rascunho.geometria } });
    },
    onSuccess: () => { sairDoDesenho(); setErro(null); void queryClient.invalidateQueries({ queryKey: ["mapa-areas"] }); },
    onError: (e: unknown) => setErro(e instanceof Error ? e.message : "Não foi possível salvar a área.")
  });

  const remover = useMutation({
    mutationFn: async (id: string) => { await api(`/api/resources/mapa_areas/${id}`, { method: "DELETE" }); },
    onSuccess: () => { setExcluir(null); setSelecionada(null); void queryClient.invalidateQueries({ queryKey: ["mapa-areas"] }); },
    onError: (e: unknown) => setErro(e instanceof Error ? e.message : "Não foi possível excluir a área.")
  });

  function iniciarDesenho() {
    setErro(null); setSelecionada(null); setRascunho(null);
    if (!mapRef.current || !mapaPronto) { setErro("O mapa ainda está carregando. Aguarde a imagem abrir e tente de novo."); return; }
    ed.current = editorVazio();
    desenhandoRef.current = true;
    setDesenhando(true);
  }
  function sairDoDesenho() {
    soltarArrastoRef.current?.();
    ed.current = editorVazio();
    desenhandoRef.current = false;
    setDesenhando(false); setRascunho(null);
  }
  function confirmar() {
    const e = ed.current;
    if (e.fechado && e.pontos.length >= 3) {
      const ha = Math.round(areaHa(coordsDe(e.pontos)) * 10000) / 10000;
      setRascunho({ geometria: poligonoGeoJSON(e.pontos), tamanho_ha: ha });
      setForm({ nome: "", cor: PALETA[areas.length % PALETA.length] ?? COR_PADRAO, tamanho_ha: String(ha) });
      return;
    }
    if (e.pontos.length >= 3) { fechar("Fechado"); return; }
    e.acao = "Marque pelo menos 3 pontos"; redesenhar();
  }
  function mudarIma(m: Partial<ConfigIma>) {
    const novo = { ...cfgRef.current, ...m };
    cfgRef.current = novo; setCfg(novo);
    const e = ed.current; e.ima = null;
    if (m.ligado !== undefined) e.acao = novo.ligado ? "Ímã ligado" : "Ímã desligado";
    else if (m.tolerancia !== undefined) e.acao = `Ímã em ${novo.tolerancia} px ≈ ${num(Math.round(novo.tolerancia * metrosPorPx), 0)} m neste zoom`;
    redesenhar();
  }

  // Troca entre satélite e ruas sem recarregar o estilo: a base de ruas entra sob demanda, sob as áreas.
  async function trocarBase(novo: TipoBase) {
    if (novo === base || semImagem) return;
    const m = mapRef.current;
    if (!m) return;
    if (!m.getLayer(ID_BASE[novo])) {
      const s = await criarSessaoGoogle(novo);
      if (!mapRef.current) return;
      if (!s) { setErro(novo === "mapa" ? "Não foi possível carregar o mapa de ruas agora." : "Não foi possível carregar o satélite agora."); return; }
      m.addSource(ID_BASE[novo], fonteRaster(s));
      const sob = m.getLayer("areas-fill") ? "areas-fill" : undefined;
      m.addLayer({ id: ID_BASE[novo], type: "raster", source: ID_BASE[novo] }, sob);
    }
    for (const t of ["satelite", "mapa"] as const) {
      if (m.getLayer(ID_BASE[t])) m.setLayoutProperty(ID_BASE[t], "visibility", t === novo ? "visible" : "none");
    }
    setErro(null);
    setBase(novo);
  }

  // ---------- derivados para a tela ----------
  const mapa = mapaPronto ? mapRef.current : null;
  const metrosPorPx = (() => {
    if (!mapa) return 0;
    const c = mapa.getCanvasContainer(); const x = c.clientWidth / 2, y = c.clientHeight / 2;
    const a = mapa.unproject([x, y]), b = mapa.unproject([x + 100, y]);
    return distanciaM([a.lng, a.lat], [b.lng, b.lat]) / 100;
  })();
  const rotulosAreas: RotuloArea[] = mapa
    ? areas.flatMap((a) => { const anel = anelAberto(a.geometria); return anel.length >= 3 ? [{ id: a.id, px: centroPx(anel.map(proj)), nome: a.nome, ha: hectares(a.tamanho_ha) }] : []; })
    : [];
  const e = ed.current;
  const ptsTela = mapa && desenhando ? ptsPx() : [];
  const coords = coordsDe(e.pontos);
  const comCursor = mapa && !e.fechado && e.cur && e.pontos.length >= 2 && !e.arrasto ? [...coords, desproj(e.cur)] : coords;
  const haAtual = areaHa(comCursor);
  const perimetro = perimetroM(comCursor, e.fechado || comCursor.length >= 3);
  const lados: Lado[] = [];
  const nLados = e.fechado ? ptsTela.length : ptsTela.length - 1;
  for (let i = 0; i < nLados; i++) {
    const a = ptsTela[i]!, b = ptsTela[(i + 1) % ptsTela.length]!;
    lados.push({ px: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, metros: distanciaM(coords[i]!, coords[(i + 1) % coords.length]!) });
  }
  const ultimoTela = ptsTela.length ? ptsTela[ptsTela.length - 1]! : null;
  const arrastoVertice = e.arrasto?.tipo === "vertice" ? e.arrasto.i : -1;

  const selecionadaObj = areas.find((a) => a.id === selecionada) ?? null;
  const podeCadastrar = Boolean(empresaId);
  const totalHa = areas.reduce((s, a) => s + hectares(a.tamanho_ha), 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-800">Mapa de Manejo</h1>
          {desenhando ? (
            <p className="text-xs text-slate-600" data-testid="mapa-instrucao">
              Clique para marcar o ponto. Segure num ponto e arraste para mover. Dois cliques fecham.
              <span className="ml-2 text-slate-400">Botão direito desfaz · Ctrl+Z / Ctrl+Shift+Z · Alt solta o ímã · Shift trava o ângulo</span>
            </p>
          ) : (
            <p className="text-xs text-slate-500">Áreas da propriedade desenhadas no mapa (lavoura e pecuária).</p>
          )}
        </div>
        <Button type="button" onClick={iniciarDesenho} disabled={!mapaPronto || desenhando || !podeCadastrar} data-testid="mapa-nova-area">Nova área</Button>
      </div>

      {!podeCadastrar && <Card><CardBody><p className="text-sm text-amber-700">Nenhuma empresa disponível para cadastrar áreas.</p></CardBody></Card>}
      {erro && <Card><CardBody><p className="text-sm text-red-600" data-testid="mapa-erro">{erro}</p></CardBody></Card>}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[320px_1fr]">
        {/* Painel: ferramentas do desenho, ou a lista de áreas */}
        <Card className="min-h-0 overflow-hidden">
          <CardBody className="flex h-full min-h-0 flex-col gap-1 overflow-auto">
            {desenhando ? (
              <PainelDesenho cfg={cfg} onCfg={mudarIma} metrosPorPx={metrosPorPx} pontos={e.pontos} arrastoVertice={arrastoVertice} fechado={e.fechado}
                onRecomecar={recomecar} onCancelar={sairDoDesenho} onConfirmar={confirmar} />
            ) : (
              <>
                <div className="mb-1 flex items-baseline justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <span>Áreas</span>
                  {areas.length > 0 && <span className="font-normal normal-case tabular-nums text-slate-400">{areas.length} · {num(totalHa, 2)} ha</span>}
                </div>
                {listaQuery.isLoading && <Spinner />}
                {/* recusa da API não pode virar "lista vazia": quem vê vazio acha que não há área, e não que a leitura falhou */}
                {listaQuery.error && <ErrorState title="Não foi possível carregar as áreas" error={listaQuery.error} onRetry={() => void listaQuery.refetch()} />}
                {!listaQuery.isLoading && !listaQuery.error && areas.length === 0 && <EmptyState title="Nenhuma área cadastrada" description="Use “Nova área” para desenhar a primeira no mapa." />}
                {areas.map((a) => (
                  <button key={a.id} type="button" data-testid="mapa-item-area" onClick={() => { setSelecionada(a.id); const g = a.geometria; const m = mapRef.current; if (g && m) { const b = limites(g); if (b) m.fitBounds(b, { padding: 60, maxZoom: 16 }); } }}
                    className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100 ${a.id === selecionada ? "bg-slate-100 ring-1 ring-slate-300" : ""}`}>
                    <span className="h-3 w-3 shrink-0 rounded-sm border border-slate-300" style={{ backgroundColor: a.cor ?? COR_PADRAO }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{a.nome}</span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">{num(hectares(a.tamanho_ha), 2)} ha</span>
                  </button>
                ))}
              </>
            )}
          </CardBody>
        </Card>

        {/* Mapa */}
        <Card className="relative min-h-0 overflow-hidden">
          <div ref={containerRef} data-testid="mapa-canvas" className="h-full min-h-[420px] w-full" />
          {mapaPronto && (
            <CamadaDesenho desenhando={desenhando} rotulosAreas={rotulosAreas} pts={ptsTela} grudados={e.pontos.map((p) => p.grudado)} fechado={e.fechado}
              cur={e.cur} raw={e.raw} ima={e.ima} travado={e.travado} rumo={e.travado && e.cur && ultimoTela ? rumoGraus(ultimoTela, e.cur) : null}
              arrastando={e.arrasto !== null} arrastoVertice={arrastoVertice} hover={e.hover} lados={lados} areaHaAtual={haAtual} centro={ptsTela.length >= 3 ? centroPx(ptsTela) : null} />
          )}
          {!mapaPronto && <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"><Spinner /></div>}

          {/* canto superior esquerdo: base do mapa, medidas e ferramentas do desenho */}
          {mapaPronto && (
            <div className="pointer-events-none absolute left-2 top-2 flex max-w-[calc(100%-1rem)] flex-col items-start gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {semImagem ? (
                  <div className="rounded bg-slate-800/80 px-2 py-1 text-xs text-white">Sem imagem de satélite (configure a chave do Google). Desenho disponível.</div>
                ) : (
                  <div className="pointer-events-auto flex overflow-hidden rounded-md border border-slate-300 bg-white text-xs shadow-sm" role="group" aria-label="Tipo de mapa">
                    <button type="button" onClick={() => trocarBase("satelite")} aria-pressed={base === "satelite"} data-testid="mapa-base-satelite"
                      className={`px-2.5 py-1 ${base === "satelite" ? "bg-slate-800 font-medium text-white" : "text-slate-600 hover:bg-slate-100"}`}>Satélite</button>
                    <button type="button" onClick={() => trocarBase("mapa")} aria-pressed={base === "mapa"} data-testid="mapa-base-mapa"
                      className={`px-2.5 py-1 ${base === "mapa" ? "bg-slate-800 font-medium text-white" : "text-slate-600 hover:bg-slate-100"}`}>Mapa</button>
                  </div>
                )}
                {desenhando && (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="mapa-medidas">
                    <span className="rounded-full border border-slate-200 bg-white/95 px-2.5 py-1 shadow-sm">Área <b className="tabular-nums text-amber-600" data-testid="mapa-medida-area">{num(haAtual, 2)}</b> ha</span>
                    <span className="rounded-full border border-slate-200 bg-white/95 px-2.5 py-1 shadow-sm">Perímetro <b className="tabular-nums">{num(Math.round(perimetro), 0)}</b> m</span>
                    <span className="rounded-full border border-slate-200 bg-white/95 px-2.5 py-1 shadow-sm">Pontos <b className="tabular-nums" data-testid="mapa-medida-pontos">{e.pontos.length}</b></span>
                    <span className="rounded-full border border-yellow-300 bg-yellow-50/95 px-2.5 py-1 shadow-sm">Grudados <b className="tabular-nums text-amber-600" data-testid="mapa-medida-grudados">{e.pontos.filter((p) => p.grudado).length}</b></span>
                  </div>
                )}
              </div>
              {desenhando && !rascunho && (
                <div className="pointer-events-auto flex flex-col gap-1 rounded-md bg-white/95 p-1 shadow-sm" role="toolbar" aria-label="Ferramentas do desenho">
                  <Button type="button" size="icon" variant="ghost" onClick={desfazer} disabled={!podeDesfazer(e.hist)} aria-label="Desfazer" title="Desfazer (Ctrl+Z, botão direito)" data-testid="mapa-desfazer"><Undo2 className="h-4 w-4" aria-hidden /></Button>
                  <Button type="button" size="icon" variant="ghost" onClick={refazer} disabled={!podeRefazer(e.hist)} aria-label="Refazer" title="Refazer (Ctrl+Shift+Z)" data-testid="mapa-refazer"><Redo2 className="h-4 w-4" aria-hidden /></Button>
                  <Button type="button" size="icon" variant={cfg.ligado ? "default" : "ghost"} onClick={() => mudarIma({ ligado: !cfg.ligado })} aria-pressed={cfg.ligado} aria-label="Ligar ou desligar o ímã" title="Ímã (Alt solta enquanto segura)"><Magnet className="h-4 w-4" aria-hidden /></Button>
                  <Button type="button" size="icon" variant="ghost" onClick={recomecar} aria-label="Recomeçar" title="Recomeçar"><RotateCcw className="h-4 w-4" aria-hidden /></Button>
                </div>
              )}
            </div>
          )}

          {/* o que acabou de acontecer + ímã */}
          {desenhando && (
            <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-7rem)] items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-3 py-1 text-xs shadow-sm">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", e.arrasto ? "bg-yellow-400" : "bg-green-500")} aria-hidden />
              <span className="truncate text-slate-700" data-testid="mapa-acao">{e.acao}</span>
              <span className="shrink-0 tabular-nums text-slate-400">· {cfg.ligado ? `ímã ${cfg.tolerancia} px ≈ ${num(Math.round(cfg.tolerancia * metrosPorPx), 0)} m` : "ímã desligado"}</span>
            </div>
          )}

          {/* Formulário da área recém-desenhada */}
          {rascunho && (
            <Card className="absolute right-2 top-2 w-72 shadow-lg">
              <CardBody className="flex flex-col gap-2">
                <div className="text-sm font-semibold text-slate-800">Nova área</div>
                {empresaNome && <div className="text-xs text-slate-500">Empresa: <span className="font-medium text-slate-700">{empresaNome}</span></div>}
                <Field label="Nome" required><Input value={form.nome} onChange={(ev) => setForm((f) => ({ ...f, nome: ev.target.value }))} data-testid="mapa-form-nome" /></Field>
                <Field label="Tamanho (ha)"><Input type="number" step="0.0001" value={form.tamanho_ha} onChange={(ev) => setForm((f) => ({ ...f, tamanho_ha: ev.target.value }))} data-testid="mapa-form-tamanho" /></Field>
                <Field label="Cor"><input type="color" value={form.cor} onChange={(ev) => setForm((f) => ({ ...f, cor: ev.target.value }))} className="h-8 w-16 cursor-pointer rounded border border-slate-300" data-testid="mapa-form-cor" /></Field>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setRascunho(null)}>Voltar ao desenho</Button>
                  <Button type="button" onClick={() => salvar.mutate()} loading={salvar.isPending} disabled={form.nome.trim() === ""} data-testid="mapa-form-salvar">Salvar</Button>
                </div>
              </CardBody>
            </Card>
          )}

          {/* Detalhe da área selecionada */}
          {selecionadaObj && !desenhando && (
            <Card className="absolute right-2 top-2 w-72 shadow-lg">
              <CardBody className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-sm border border-slate-300" style={{ backgroundColor: selecionadaObj.cor ?? COR_PADRAO }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{selecionadaObj.nome}</span>
                </div>
                <div className="text-xs tabular-nums text-slate-500">{num(hectares(selecionadaObj.tamanho_ha), 2)} ha</div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setSelecionada(null)}>Fechar</Button>
                  <Button type="button" variant="danger" onClick={() => setExcluir(selecionadaObj)} data-testid="mapa-excluir">Excluir</Button>
                </div>
              </CardBody>
            </Card>
          )}
        </Card>
      </div>

      <ConfirmDialog open={excluir !== null} onOpenChange={(o) => { if (!o) setExcluir(null); }} title="Excluir área" description={excluir ? `Excluir a área “${excluir.nome}”? Esta ação não pode ser desfeita.` : ""} confirmLabel="Excluir" danger loading={remover.isPending} onConfirm={() => { if (excluir) remover.mutate(excluir.id); }} />
    </div>
  );
}

/** Caixa envolvente [[oeste, sul],[leste, norte]] de um polígono GeoJSON, para enquadrar no mapa. */
function limites(g: Polygon): [[number, number], [number, number]] | null {
  const anel = g.coordinates?.[0];
  if (!anel || anel.length === 0) return null;
  let oeste = Infinity, sul = Infinity, leste = -Infinity, norte = -Infinity;
  for (const pos of anel) {
    const lng = pos[0], lat = pos[1];
    if (lng === undefined || lat === undefined) continue;
    if (lng < oeste) oeste = lng;
    if (lng > leste) leste = lng;
    if (lat < sul) sul = lat;
    if (lat > norte) norte = lat;
  }
  if (!Number.isFinite(oeste)) return null;
  return [[oeste, sul], [leste, norte]];
}
