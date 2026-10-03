"use client";
import * as React from "react";
import { flushSync } from "react-dom";
import type { Polygon } from "geojson";
import type { Map as MapLibreMap } from "maplibre-gl";
import { Check, Redo2, RotateCcw, Undo2 } from "lucide-react";
import { Button, Spinner } from "@/components/ui";
import { toast } from "@/lib/toast";
import { cn, num } from "@/lib/utils";
import {
  IMA_PADRAO, acertar, acharIma, anelAberto, areaHa, coordsDe, distanciaM, lerPasso, novoHistorico, perimetroM, podeDesfazer,
  podeRefazer, poligonoGeoJSON, registrar, rumoGraus, travarAngulo,
  type Acerto, type AlvoPx, type ConfigIma, type Historico, type Ima, type LngLat, type PontoDesenho, type Px, type Retrato
} from "./editor-desenho";
import { CamadaDesenho, type Lado } from "./camada-desenho";
import { BarraIma } from "./barra-ima";
import { COR_PADRAO_AREA, corExibidaNoMapa } from "./cores";
import { AvisoDeLocalizacao, ID_CONTORNO_ATUAL, SeletorDeBase, desenharAreas, limites, marcarSelecao, rotulosDasAreas, useMapaBase, type AreaNoMapa } from "./mapa-base";

/**
 * EDITOR DE CONTORNO da ficha de Áreas/Piquetes: o mesmo editor de desenho que o Mapa de Manejo tinha (ímã nos
 * vértices e arestas das áreas vizinhas, arrastar ponto, ponto no meio do lado, apagar com dois cliques, mover a área
 * pela mãozinha, desfazer/refazer, Shift trava o ângulo, Alt solta o ímã), agora DENTRO do cadastro. "Concluir contorno"
 * devolve o polígono e a área em hectares para a ficha — nada é gravado aqui e nada abre por cima: quem grava é o Salvar
 * da ficha, com as mesmas regras de sempre no servidor. Com o desenho aberto, o Salvar da ficha é RECUSADO com aviso:
 * gravar a ficha sem o contorno que está na tela seria perder o desenho em silêncio.
 */

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

export function EditorDeContorno({ value, onGravar, onRemover, vizinhas, cor, disabled }: {
  /** Contorno atual da ficha (ainda não salvo, se acabou de ser desenhado). */
  value: Polygon | null;
  /** "Concluir contorno": o polígono fechado e a área dele em hectares. */
  onGravar: (geometria: Polygon, areaHa: number) => void;
  onRemover?: () => void;
  /** As OUTRAS áreas visíveis: aparecem no mapa e são o alvo do ímã. */
  vizinhas: readonly AreaNoMapa[];
  /** Cor escolhida na ficha (o contorno aparece nela antes de salvar). */
  cor?: string | null;
  /** Ficha em leitura: o mapa só mostra. */
  disabled?: boolean;
}) {
  const [desenhando, setDesenhando] = React.useState(false);
  /** Contorno concluído nesta visita e ainda não salvo pela ficha (só o aviso "falta Salvar"). */
  const [concluido, setConcluido] = React.useState(false);
  const raizRef = React.useRef<HTMLDivElement | null>(null);
  const [cfg, setCfg] = React.useState<ConfigIma>(IMA_PADRAO);
  const [mostrarMetragem, setMostrarMetragem] = React.useState(false);
  /** Mãozinha: só com ela ligada o arrasto move a área fechada inteira. */
  const [moverArea, setMoverArea] = React.useState(false);
  // Refs lidos pelos eventos do mapa (registrados uma vez só).
  const ed = React.useRef<Editor>(editorVazio());
  const cfgRef = React.useRef<ConfigIma>(IMA_PADRAO);
  const moverAreaRef = React.useRef(false);
  const desenhandoRef = React.useRef(false);
  const vizinhasRef = React.useRef<readonly AreaNoMapa[]>(vizinhas);
  React.useEffect(() => { vizinhasRef.current = vizinhas; }, [vizinhas]);
  const soltarArrastoRef = React.useRef<(() => void) | null>(null);
  /** True enquanto o usuário pan/zoom o mapa — bloqueia o cursor de inserção. */
  const mapaMovendoRef = React.useRef(false);

  const mapa = useMapaBase({ ganchoE2E: "__editorContornoE2E", aoCarregar: registrarEventos, aoMudarVista: acompanharVista });
  const { mapRef, redesenhar } = mapa;

  React.useEffect(() => {
    (window as unknown as { __editorContornoVizinhasE2E?: readonly AreaNoMapa[] }).__editorContornoVizinhasE2E = vizinhas;
    return () => { delete (window as unknown as { __editorContornoVizinhasE2E?: readonly AreaNoMapa[] }).__editorContornoVizinhasE2E; };
  }, [vizinhas]);

  // ---------- projeção ----------
  const proj = (ll: LngLat): Px => { const m = mapRef.current; if (!m) return { x: 0, y: 0 }; const p = m.project(ll); return { x: p.x, y: p.y }; };
  const desproj = (p: Px): LngLat => { const m = mapRef.current; if (!m) return [0, 0]; const ll = m.unproject([p.x, p.y]); return [ll.lng, ll.lat]; };
  const ptsPx = () => ed.current.pontos.map((pt) => proj([pt.lng, pt.lat]));
  const alvosPx = (): AlvoPx[] => vizinhasRef.current.flatMap((a) => {
    const coords = anelAberto(a.geometria);
    return coords.length >= 2 ? [{ nome: a.name, coords, pts: coords.map(proj) }] : [];
  });
  const ativo = () => desenhandoRef.current;
  const doIma = (s: Ima): PontoDesenho => { const ll = s.lngLat ?? desproj(s.px); return { lng: ll[0], lat: ll[1], grudado: true, tipo: s.tipo === "aresta" ? "aresta" : "vertice", de: s.de }; };

  // ---------- histórico ----------
  function aplicar(r: Retrato, acao?: string) {
    const e = ed.current;
    e.hist = registrar(e.hist, r);
    e.pontos = r.pontos; e.fechado = r.fechado; e.arrasto = null;
    if (acao) e.acao = acao;
    redesenhar();
  }
  function irPara(i: number, acao?: string) {
    const e = ed.current; const r = lerPasso(e.hist, i);
    e.hist = { ...e.hist, pos: i }; e.pontos = r.pontos; e.fechado = r.fechado; e.arrasto = null; e.ima = null; e.hover = null;
    if (acao) e.acao = acao;
    redesenhar();
  }
  function desfazer() { const e = ed.current; if (podeDesfazer(e.hist)) irPara(e.hist.pos - 1, "Desfeito"); else { e.acao = "Nada para desfazer"; redesenhar(); } }
  function refazer() { const e = ed.current; if (podeRefazer(e.hist)) irPara(e.hist.pos + 1, "Refeito"); else { e.acao = "Nada para refazer"; redesenhar(); } }
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
    // Só acompanha o mouse de verdade — durante pan/zoom o mousemove do MapLibre não reposiciona o cursor.
    if (mapaMovendoRef.current) return;
    const e = ed.current;
    if (e.arrasto) return;
    const pts = ptsPx();
    const h = acertar(px, pts, e.fechado, { moverArea: moverAreaRef.current });
    if (h?.tipo === "vertice" && h.i === 0 && !e.fechado && pts.length >= 3) {
      // o primeiro ponto, com 3+ marcados, é o alvo de fechar
      Object.assign(e, { hover: null, raw: px, cur: pts[0], ima: { px: pts[0]!, lngLat: null, dist: 0, tipo: "fechar", de: "primeiro ponto" }, travado: false });
    } else if (h) {
      Object.assign(e, { hover: h, cur: px, raw: px, ima: null, travado: false });
    } else if (e.fechado) {
      Object.assign(e, { hover: null, cur: px, raw: null, ima: null, travado: false });
    } else {
      const s0 = acharIma(px, alvosPx(), cfgRef.current, { pts, fechado: false }, { soltar: alt, semFechar: false });
      // Guarda lngLat também na aresta: no pan do mapa o px é reprojetado a partir disso (não "arrasta" o ponto).
      const s = s0 && !s0.lngLat ? { ...s0, lngLat: desproj(s0.px) } : s0;
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
    const h = acertar(px, ptsPx(), e.fechado, { moverArea: moverAreaRef.current });
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
      const s0 = acharIma(px, alvosPx(), cfgRef.current, { pts: ptsPx(), fechado: e.fechado }, { soltar: alt, semFechar: true });
      const s = s0 && !s0.lngLat ? { ...s0, lngLat: desproj(s0.px) } : s0;
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
    if (acertar(px, pts, e.fechado, { moverArea: moverAreaRef.current })) return; // segurar/soltar num alvo já foi tratado
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
    const h = acertar(px, ptsPx(), e.fechado, { moverArea: moverAreaRef.current });
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
    // Trava o pan do mapa enquanto o ponto/área acompanha o mouse — senão o mapa "puxa" o ponto.
    m.dragPan.disable();
    const caixa = m.getCanvasContainer();
    const mover = (ev: PointerEvent) => {
      const r = caixa.getBoundingClientRect();
      aoArrastar({ x: ev.clientX - r.left, y: ev.clientY - r.top }, ev.altKey);
    };
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      window.removeEventListener("pointercancel", soltar);
      soltarArrastoRef.current = null;
      m.dragPan.enable();
      aoSoltar();
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
    window.addEventListener("pointercancel", soltar);
    soltarArrastoRef.current = soltar;
  }
  React.useEffect(() => () => soltarArrastoRef.current?.(), []);

  // ---------- eventos do mapa (registrados uma vez, no load) ----------
  function registrarEventos(m: MapLibreMap) {
    const px = (ev: { point: { x: number; y: number } }): Px => ({ x: ev.point.x, y: ev.point.y });
    m.on("mousemove", (ev) => aoMover(px(ev), ev.originalEvent.altKey, ev.originalEvent.shiftKey));
    m.on("mouseout", () => aoSair());
    m.on("mousedown", (ev) => { if (ev.originalEvent.button === 0 && aoPressionar(px(ev))) { ev.preventDefault(); iniciarArrasto(); } });
    m.on("touchstart", (ev) => { if (ev.points.length === 1 && aoPressionar(px(ev))) { ev.preventDefault(); iniciarArrasto(); } });
    m.on("click", (ev) => aoClicar(px(ev), ev.originalEvent.altKey, ev.originalEvent.shiftKey, ev.originalEvent.detail));
    m.on("dblclick", (ev) => { if (!ativo()) return; ev.preventDefault(); aoDuploClique(px(ev)); });
    m.on("contextmenu", (ev) => { if (!ativo()) return; ev.originalEvent.preventDefault(); desfazer(); });
    // Ao pan/zoom: some o cursor de inserção e ignora o mousemove até soltar.
    m.on("movestart", () => {
      if (!desenhandoRef.current || ed.current.arrasto) return;
      mapaMovendoRef.current = true;
      Object.assign(ed.current, { cur: null, raw: null, ima: null, hover: null, travado: false });
      flushSync(() => redesenhar());
    });
    m.on("moveend", () => { mapaMovendoRef.current = false; });
  }
  /** Dentro do quadro do mapa, antes do redesenho: o ímã acompanha o vértice/aresta geográfico na projeção nova. */
  function acompanharVista(m: MapLibreMap) {
    const e = ed.current;
    if (e.arrasto) return; // arrasto: os pontos já vêm do pointermove
    if (mapaMovendoRef.current) {
      if (e.cur || e.raw || e.ima || e.hover) Object.assign(e, { cur: null, raw: null, ima: null, hover: null, travado: false });
      return;
    }
    if (!e.ima?.lngLat) return;
    const pxIma = { x: m.project(e.ima.lngLat).x, y: m.project(e.ima.lngLat).y };
    let aresta = e.ima.aresta;
    if (e.ima.tipo === "aresta" && aresta) {
      let melhor: { d: number; a: Px; b: Px } | null = null;
      for (const alvo of vizinhasRef.current) {
        const pts = anelAberto(alvo.geometria).map((ll) => ({ x: m.project(ll).x, y: m.project(ll).y }));
        if (pts.length < 2) continue;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
          const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy;
          const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((pxIma.x - a.x) * vx + (pxIma.y - a.y) * vy) / l2));
          const d = Math.hypot(pxIma.x - (a.x + t * vx), pxIma.y - (a.y + t * vy));
          if (!melhor || d < melhor.d) melhor = { d, a, b };
        }
      }
      if (melhor) aresta = [melhor.a, melhor.b];
    }
    e.ima = { ...e.ima, px: pxIma, aresta };
    e.cur = pxIma;
    e.raw = pxIma;
  }

  // ---------- modo desenho: atalhos de teclado e gestos do mapa ----------
  React.useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapa.pronto) return;
    if (desenhando) { m.doubleClickZoom.disable(); m.boxZoom.disable(); } else { m.doubleClickZoom.enable(); m.boxZoom.enable(); m.getCanvas().style.cursor = ""; }
  }, [desenhando, mapa.pronto, mapRef]);
  React.useEffect(() => {
    const m = mapRef.current;
    if (m && desenhando) m.getCanvas().style.cursor = ed.current.arrasto ? "grabbing" : "crosshair";
  });
  React.useEffect(() => {
    if (!desenhando) return;
    const aoTeclar = (ev: KeyboardEvent) => {
      const alvo = ev.target instanceof HTMLElement ? ev.target : null;
      // Os atalhos são do MAPA: valem com o foco no editor (ou em lugar nenhum) — nunca num campo ou botão da ficha.
      if (alvo && alvo !== document.body && !raizRef.current?.contains(alvo)) return;
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
  // Desenho aberto: o Salvar da ficha espera o contorno ser concluído ou cancelado (captura, antes do envio do formulário).
  React.useEffect(() => {
    if (!desenhando) return;
    const form = raizRef.current?.closest("form");
    if (!form) return;
    const segurar = (ev: Event) => {
      ev.preventDefault();
      ev.stopPropagation();
      ed.current.acao = "Conclua ou cancele o contorno antes de salvar";
      redesenhar();
      toast.warning("Conclua o contorno antes de salvar", { description: "Use \"Concluir contorno\" para levar o desenho para a ficha, ou \"Cancelar\" para descartá-lo." });
    };
    form.addEventListener("submit", segurar, true);
    return () => form.removeEventListener("submit", segurar, true);
  }, [desenhando, redesenhar]);

  // ---------- áreas no mapa: as vizinhas e, fora do desenho, o contorno desta ficha ----------
  const corDaFicha = cor && cor.trim() !== "" ? cor : COR_PADRAO_AREA;
  React.useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapa.pronto) return;
    desenharAreas(m, vizinhas, value && !desenhando ? { geometria: value, cor: corDaFicha } : null);
    if (value && !desenhando) marcarSelecao(m, ID_CONTORNO_ATUAL, true);
  }, [vizinhas, value, desenhando, corDaFicha, mapa.pronto, mapRef]);
  // Enquadra uma vez: no contorno desta ficha ou, sem ele, nas áreas vizinhas (a propriedade).
  const enquadrouRef = React.useRef(false);
  React.useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapa.pronto || enquadrouRef.current) return;
    const caixa = limites(value ? [value] : vizinhas.map((a) => a.geometria));
    if (!caixa) return;
    enquadrouRef.current = true;
    m.fitBounds(caixa, { padding: 48, maxZoom: 16, duration: 0 });
  }, [value, vizinhas, mapa.pronto, mapRef]);

  // ---------- comandos ----------
  function iniciarDesenho() {
    if (disabled || !mapRef.current || !mapa.pronto) return;
    const anel = anelAberto(value);
    if (anel.length >= 3) {
      // Editar: o contorno atual vira os pontos (fechado), e "Concluir contorno" devolve o novo.
      const pontos = anel.map(livre);
      ed.current = { ...editorVazio(), pontos, fechado: true, hist: registrar(novoHistorico(), { pontos, fechado: true }), acao: "Arraste os pontos ou o polígono · Concluir contorno devolve para a ficha" };
    } else {
      ed.current = editorVazio();
    }
    setMoverArea(false); moverAreaRef.current = false;
    desenhandoRef.current = true;
    setConcluido(false);
    setDesenhando(true);
  }
  function sairDoDesenho() {
    soltarArrastoRef.current?.();
    ed.current = editorVazio();
    desenhandoRef.current = false;
    setMoverArea(false); moverAreaRef.current = false;
    setDesenhando(false);
  }
  function confirmar() {
    const e = ed.current;
    if (e.fechado && e.pontos.length >= 3) {
      const ha = Math.round(areaHa(coordsDe(e.pontos)) * 10000) / 10000;
      onGravar(poligonoGeoJSON(e.pontos), ha);
      sairDoDesenho();
      setConcluido(true);
      return;
    }
    if (e.pontos.length >= 3) { fechar("Fechado"); return; }
    e.acao = "Marque pelo menos 3 pontos"; redesenhar();
  }
  function toggleIma() {
    setCfg((c) => {
      const novo = { ...c, ligado: !c.ligado };
      cfgRef.current = novo;
      ed.current.ima = null;
      ed.current.acao = novo.ligado ? "Ímã ligado" : "Ímã desligado";
      redesenhar();
      return novo;
    });
  }
  function toggleMetragem() {
    setMostrarMetragem((v) => {
      ed.current.acao = !v ? "Metragem visível" : "Metragem oculta";
      redesenhar();
      return !v;
    });
  }
  function toggleMoverArea() {
    setMoverArea((v) => {
      moverAreaRef.current = !v;
      ed.current.acao = !v ? "Mover área ligado — segure dentro do polígono" : "Mover área desligado";
      redesenhar();
      return !v;
    });
  }

  // ---------- derivados para a tela ----------
  const m = mapa.pronto ? mapRef.current : null;
  // Recalcula a cada redesenhar() do mapa (pan/zoom) — sem memo, senão o rótulo "gruda" na tela.
  const rotulos = m && !desenhando ? rotulosDasAreas(m, vizinhas, null) : [];
  const e = ed.current;
  const ptsTela = m && desenhando ? ptsPx() : [];
  const coords = coordsDe(e.pontos);
  const comCursor = m && !e.fechado && e.cur && e.pontos.length >= 2 && !e.arrasto ? [...coords, desproj(e.cur)] : coords;
  const haAtual = areaHa(comCursor);
  const perimetro = perimetroM(comCursor, e.fechado || comCursor.length >= 3);
  const lados: Lado[] = [];
  const nLados = e.fechado ? ptsTela.length : ptsTela.length - 1;
  for (let i = 0; i < nLados; i++) {
    const a = ptsTela[i]!, b = ptsTela[(i + 1) % ptsTela.length]!;
    lados.push({ px: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, metros: distanciaM(coords[i]!, coords[(i + 1) % coords.length]!) });
  }
  const ultimoTela = ptsTela.length ? ptsTela[ptsTela.length - 1]! : null;
  const haDaFicha = value ? Math.round(areaHa(anelAberto(value)) * 100) / 100 : null;
  const confirmarRotulo = e.fechado ? "Concluir contorno" : e.pontos.length >= 3 ? "Fechar polígono" : "Marque 3 pontos";

  return (
    <div ref={raizRef} className="flex w-full flex-col gap-2" data-testid="campo-mapa-area">
      {desenhando ? (
        <p className="text-[12px] text-slate-600" data-testid="mapa-instrucao">
          Clique para marcar o ponto. Segure num ponto e arraste para mover. Mãozinha liga mover a área. Dois cliques fecham.
          <span className="ml-2 text-slate-400">Botão direito desfaz · Ctrl+Z / Ctrl+Shift+Z · Alt solta o ímã · Shift trava o ângulo</span>
        </p>
      ) : (
        <p className="text-[12px] text-slate-600">
          {disabled ? "Contorno da área no mapa." : "Desenhe o contorno no mapa: os pontos grudam nas áreas vizinhas. A área total (ha) vem do desenho."}
          {haDaFicha != null && <span className="ml-1 font-medium tabular-nums text-slate-800" data-testid="campo-mapa-ha">Área do contorno: {num(haDaFicha, 2)} ha</span>}
          {concluido && value && <span className="ml-1 font-medium text-emerald-700" data-testid="campo-mapa-falta-salvar">Contorno pronto — clique em Salvar para gravar a área.</span>}
        </p>
      )}
      <div className="relative h-[460px] overflow-hidden rounded-md border border-slate-200 bg-slate-100">
        <div ref={mapa.containerRef} data-testid="mapa-canvas" className="h-full w-full" />
        {mapa.pronto && (
          <CamadaDesenho
            desenhando={desenhando}
            rotulosAreas={rotulos}
            ocultarRotulos={desenhando}
            pts={ptsTela}
            fechado={e.fechado}
            cur={e.cur}
            raw={e.raw}
            ima={e.ima}
            travado={e.travado}
            rumo={e.travado && e.cur && ultimoTela ? rumoGraus(ultimoTela, e.cur) : null}
            arrastando={e.arrasto !== null}
            arrastoVertice={e.arrasto?.tipo === "vertice" ? e.arrasto.i : -1}
            hover={e.hover}
            lados={lados}
            mostrarMetragem={mostrarMetragem}
            corPreview={e.fechado ? corExibidaNoMapa(corDaFicha) : null}
          />
        )}
        {!mapa.pronto && <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"><Spinner /></div>}
        {mapa.pronto && (
          <div className="pointer-events-none absolute left-2 top-2 flex max-w-[calc(100%-1rem)] flex-col items-start gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <SeletorDeBase mapa={mapa} aviso="Sem imagem de satélite (configure a chave do Google). Desenho disponível." />
              {desenhando && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="mapa-medidas">
                  <span className="rounded-full border border-slate-200 bg-white/95 px-2.5 py-1 shadow-sm">Área <b className="tabular-nums text-emerald-700" data-testid="mapa-medida-area">{num(haAtual, 2)}</b> ha</span>
                  <span className="rounded-full border border-slate-200 bg-white/95 px-2.5 py-1 shadow-sm">Perímetro <b className="tabular-nums">{num(Math.round(perimetro), 0)}</b> m</span>
                  <span className="rounded-full border border-slate-200 bg-white/95 px-2.5 py-1 shadow-sm">Pontos <b className="tabular-nums" data-testid="mapa-medida-pontos">{e.pontos.length}</b></span>
                  <span className="rounded-full border border-emerald-300 bg-emerald-50/95 px-2.5 py-1 shadow-sm">Grudados <b className="tabular-nums text-emerald-700" data-testid="mapa-medida-grudados">{e.pontos.filter((p) => p.grudado).length}</b></span>
                </div>
              )}
            </div>
            {desenhando && (
              <div className="pointer-events-auto flex flex-col items-start gap-1" role="toolbar" aria-label="Ferramentas do desenho">
                <div className="flex flex-col gap-1 rounded-md bg-white/95 p-1 shadow-sm">
                  <Button type="button" size="icon" variant="ghost" onClick={desfazer} disabled={!podeDesfazer(e.hist)} aria-label="Desfazer" title="Desfazer (Ctrl+Z, botão direito)" data-testid="mapa-desfazer"><Undo2 className="h-4 w-4" aria-hidden /></Button>
                  <Button type="button" size="icon" variant="ghost" onClick={refazer} disabled={!podeRefazer(e.hist)} aria-label="Refazer" title="Refazer (Ctrl+Shift+Z)" data-testid="mapa-refazer"><Redo2 className="h-4 w-4" aria-hidden /></Button>
                  <Button type="button" size="icon" variant="ghost" onClick={recomecar} aria-label="Recomeçar" title="Recomeçar" data-testid="mapa-recomecar"><RotateCcw className="h-4 w-4" aria-hidden /></Button>
                </div>
                <BarraIma ligado={cfg.ligado} onToggle={toggleIma} metragem={mostrarMetragem} onToggleMetragem={toggleMetragem} moverArea={moverArea} onToggleMoverArea={toggleMoverArea} />
              </div>
            )}
            {mapa.erroBase && <div className="rounded bg-white/95 px-2 py-1 text-xs text-red-600 shadow-sm">{mapa.erroBase}</div>}
          </div>
        )}
        {desenhando && (
          <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-7rem)] items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-3 py-1 text-xs shadow-sm">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", e.arrasto ? "bg-emerald-400" : "bg-green-500")} aria-hidden />
            <span className="truncate text-slate-700" data-testid="mapa-acao">{e.acao}</span>
          </div>
        )}
        <AvisoDeLocalizacao mapa={mapa} />
      </div>
      {!disabled && (
        <div className="flex flex-wrap gap-2">
          {desenhando ? (
            <>
              <Button type="button" size="sm" onClick={confirmar} disabled={!e.fechado && e.pontos.length < 3} data-testid="mapa-confirmar">
                <Check className="h-3.5 w-3.5" aria-hidden />{confirmarRotulo}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={sairDoDesenho} data-testid="mapa-cancelar-desenho">Cancelar</Button>
            </>
          ) : (
            <>
              <Button type="button" size="sm" disabled={!mapa.pronto} onClick={iniciarDesenho} data-testid="campo-mapa-desenhar">
                {value ? "Editar contorno" : "Desenhar contorno"}
              </Button>
              {value && onRemover && (
                <Button type="button" size="sm" variant="ghost" onClick={onRemover} data-testid="campo-mapa-limpar">Remover contorno</Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
