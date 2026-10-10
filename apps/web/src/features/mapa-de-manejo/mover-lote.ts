import type { Feature, FeatureCollection, Point } from "geojson";
import type { GeoJSONSource, LayerSpecification, Map as MapLibreMap, MapMouseEvent, MapTouchEvent } from "maplibre-gl";
import { COR_ACENTO } from "./camada-lotes";
import { LADO_MAIOR_PX, LADO_MINIMO_PX, ZOOM_AFASTADO, ZOOM_DE_TRABALHO, tamanhoDoIconePorZoom } from "./imagens-do-mapa";
import type { AreaOperacional } from "./operacional-dados";
import { areaNoPontoGeografico, type PontoGeografico } from "./ponto-no-poligono";
import { CAMADAS_DO_MARCADOR, TOLERANCIA_DO_MARCADOR_PX, areaDoMarcador, areaNoPonto } from "./selecao-no-mapa";

/**
 * MAPA-MANEJO-04 (F2) — CAMADA 4: MOVER LOTE PELO MAPA. O gesto ESCOLHE o destino; ele NÃO grava nada.
 *
 *   arraste DESLIGADO (`ligado()` falso) ... nada aqui reage: o arraste do mapa (pan) segue normal
 *   pressionar sobre o marcador ............ o pan do mapa é desligado durante o gesto (e religado no fim)
 *   mover ................................... o marcador arrastado acompanha o ponteiro numa fonte PRÓPRIA
 *                                             (`lote-arrastado`), acima dos lotes; a área sob o ponteiro ganha o
 *                                             contorno de destaque (feature-state `hover` da fonte `areas`)
 *   soltar .................................. ponto da tela → lon/lat → `areaNoPontoGeografico` →
 *                                             mesma área | fora de qualquer área | outra área (`aoSoltar`)
 *   sempre, no fim .......................... a fonte própria esvazia e o pan volta: o ícone "volta" ao centróide de
 *                                             origem porque a fonte `lotes` NUNCA foi mexida
 *
 * Mouse e toque (um dedo). Segundo dedo, janela perdendo o foco ou Escape cancelam sem resultado. Gesto que não passou
 * do limiar é clique/toque: quem cuida é a seleção (painel do pasto), e nada é reportado aqui. Soltar fora do canvas
 * do mapa (sobre a barra, o painel, um controle) é "fora de qualquer área".
 *
 * Gravar é do formulário de movimentação (mover-lote-dialogo.tsx → POST /api/livestock/transfers/batch-to-module-area),
 * e só no Confirmar dele. Este arquivo não faz chamada nenhuma.
 *
 * Único cálculo: posição (pixel → lon/lat pelo próprio MapLibre, e o ponto-em-polígono de ponto-no-poligono.ts).
 */

/** Fonte PRÓPRIA do marcador arrastado (a fonte `lotes`, de camada-lotes.ts, nunca é tocada). */
export const FONTE_ARRASTADO = "lote-arrastado";
export const CAMADA_ARRASTADO_FALLBACK = "lote-arrastado-fallback";
export const CAMADA_ARRASTADO_ICONE = "lote-arrastado-icone";
/** Camadas do marcador arrastado, de baixo para cima; entram no TOPO da pilha (acima dos lotes e dos objetos). */
export const CAMADAS_DO_ARRASTADO = [CAMADA_ARRASTADO_FALLBACK, CAMADA_ARRASTADO_ICONE] as const;

/** Fonte das áreas (mapa-base.tsx): o destino em vista ganha o feature-state `hover` (contorno de destaque). */
const FONTE_DAS_AREAS = "areas";

/**
 * Deslocamento mínimo, em px, para o gesto virar ARRASTE. Mouse: o `clickTolerance` padrão do MapLibre (abaixo dele o
 * MapLibre dispara o clique, que abre o painel). Toque: folga maior, para o tremor do dedo não virar arraste.
 */
export const LIMIAR_DO_ARRASTE_PX = { mouse: 3, toque: 10 } as const;

/** O que o soltar decide. As áreas são as da resposta da API naquele momento (`areas()`). */
export type ResultadoDoArraste =
  | { tipo: "mesma-area"; origem: AreaOperacional }
  | { tipo: "fora"; origem: AreaOperacional }
  | { tipo: "destino"; origem: AreaOperacional; destino: AreaOperacional };

/**
 * Leitores (getters) em vez de valores: o arraste é registrado UMA vez por mapa e lê o estado da tela na hora do
 * gesto — nada é reinstalado a cada renderização.
 */
export interface OpcoesDoArraste {
  /** interruptor ligado E capacidade de criar a transferência (quem chama combina os dois) */
  ligado: () => boolean;
  /** as áreas da resposta atual (destino possível = área com polígono) */
  areas: () => readonly AreaOperacional[];
  aoSoltar: (r: ResultadoDoArraste) => void;
}

/**
 * Decide o resultado do soltar. `ponto` nulo = soltou fora do mapa. Origem que não está mais na resposta (refetch no
 * meio do gesto): `null`, nada a reportar.
 */
export function resultadoDaSoltura(origemId: string, ponto: PontoGeografico | null, areas: readonly AreaOperacional[]): ResultadoDoArraste | null {
  const origem = areas.find((a) => a.id === origemId);
  if (!origem) return null;
  const destinoId = ponto ? areaNoPontoGeografico(ponto, areas) : null;
  const destino = destinoId === null ? undefined : areas.find((a) => a.id === destinoId);
  if (!destino) return { tipo: "fora", origem };
  if (destino.id === origem.id) return { tipo: "mesma-area", origem };
  return { tipo: "destino", origem, destino };
}

/** Texto do aviso do soltar que não abre o formulário; `null` quando há destino (abre o formulário). */
export function textoDoAviso(r: ResultadoDoArraste): string | null {
  if (r.tipo === "mesma-area") return `Arraste para outra área: o lote continua em ${r.origem.name}.`;
  if (r.tipo === "fora") return `Solte o lote sobre uma área do mapa: fora de qualquer área nada é movido, e o lote continua em ${r.origem.name}.`;
  return null;
}

type CamadaSimbolo = Extract<LayerSpecification, { type: "symbol" }>;
type CamadaCirculo = Extract<LayerSpecification, { type: "circle" }>;

/**
 * As camadas do marcador arrastado: o mesmo desenho do marcador (o ícone registrado da configuração, ou o círculo na
 * cor padrão / verde de acento), meio transparente para o mapa aparecer por baixo. As propriedades são as da feature
 * da fonte `lotes` que foi pega.
 */
export function especificacoesDoArrastado(): LayerSpecification[] {
  const fallback: CamadaCirculo = {
    id: CAMADA_ARRASTADO_FALLBACK,
    type: "circle",
    source: FONTE_ARRASTADO,
    filter: ["!=", ["get", "icone_pronto"], true],
    paint: {
      "circle-color": ["to-color", ["get", "cor_padrao"], COR_ACENTO],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], ZOOM_AFASTADO, 12, ZOOM_DE_TRABALHO, 20],
      "circle-opacity": 0.8,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2
    }
  };
  const icone: CamadaSimbolo = {
    id: CAMADA_ARRASTADO_ICONE,
    type: "symbol",
    source: FONTE_ARRASTADO,
    filter: ["==", ["get", "icone_pronto"], true],
    layout: {
      "icon-image": ["get", "icone_id"],
      "icon-size": tamanhoDoIconePorZoom(LADO_MAIOR_PX, LADO_MINIMO_PX),
      "icon-allow-overlap": true,
      "icon-ignore-placement": true
    },
    paint: { "icon-opacity": 0.8 }
  };
  return [fallback, icone];
}

const VAZIA: FeatureCollection<Point> = { type: "FeatureCollection", features: [] };

/** Instala a fonte e as camadas do marcador arrastado — IDEMPOTENTE. Só com o estilo carregado (`mapa.pronto`). */
export function instalarCamadaDoArrastado(m: MapLibreMap): void {
  if (!m.getSource(FONTE_ARRASTADO)) m.addSource(FONTE_ARRASTADO, { type: "geojson", data: VAZIA });
  for (const camada of especificacoesDoArrastado()) {
    if (!m.getLayer(camada.id)) m.addLayer(camada);
  }
}

function publicarArrastado(m: MapLibreMap, dados: FeatureCollection<Point>): void {
  const src = m.getSource(FONTE_ARRASTADO) as GeoJSONSource | undefined;
  src?.setData(dados);
}

function marcarDestino(m: MapLibreMap, id: string, hover: boolean): void {
  if (m.getSource(FONTE_DAS_AREAS)) m.setFeatureState({ source: FONTE_DAS_AREAS, id }, { hover });
}

type PontoNaTela = { x: number; y: number };

interface Gesto {
  tipo: "mouse" | "toque";
  origemId: string;
  /** as propriedades da feature do marcador pego (o desenho do arrastado) */
  propriedades: Record<string, unknown>;
  inicio: PontoNaTela;
  /** passou do limiar: é arraste, não clique */
  arrastando: boolean;
  /** este gesto desligou o pan do mapa (e o religa no fim) */
  desligouPan: boolean;
  /** área com o contorno de destaque agora (destino em vista) */
  destacada: string | null;
}

/**
 * Registra o arraste do marcador de lotes no mapa (UMA vez, depois de `mapa.pronto`; de preferência DEPOIS de
 * `registrarSelecao`, para o cursor de arraste prevalecer sobre o de seleção no mesmo evento). Devolve a função que
 * remove tudo o que registrou (e cancela um gesto em curso).
 */
export function registrarArraste(m: MapLibreMap, opcoes: OpcoesDoArraste): () => void {
  instalarCamadaDoArrastado(m);
  const canvas = m.getCanvas();
  const doc = canvas.ownerDocument;
  const janela = doc.defaultView;
  let gesto: Gesto | null = null;
  /** o cursor "grab" atual foi posto por este arquivo */
  let cursorDeArraste = false;
  let desligarEscutas: (() => void)[] = [];

  const pontoDaTela = (clientX: number, clientY: number): PontoNaTela => {
    const r = canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };

  /** O ponteiro está sobre o canvas do mapa (e não sobre a barra, o painel ou um controle por cima dele)? */
  const sobreOCanvas = (clientX: number, clientY: number): boolean => {
    if (typeof doc.elementFromPoint === "function") return doc.elementFromPoint(clientX, clientY) === canvas;
    const r = canvas.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  };

  const geografico = (p: PontoNaTela): PontoGeografico => {
    const ll = m.unproject([p.x, p.y]);
    return { lon: ll.lng, lat: ll.lat };
  };

  /** O marcador de lotes sob o ponto (com a folga de toque da seleção); camada desligada não responde. */
  const marcadorNoPonto = (p: PontoNaTela): { origemId: string; propriedades: Record<string, unknown> } | null => {
    const camadas = CAMADAS_DO_MARCADOR.filter((id) => m.getLayer(id));
    if (camadas.length === 0) return null;
    const t = TOLERANCIA_DO_MARCADOR_PX;
    for (const f of m.queryRenderedFeatures([[p.x - t, p.y - t], [p.x + t, p.y + t]], { layers: camadas })) {
      const origemId = areaDoMarcador(f);
      if (origemId !== null) return { origemId, propriedades: { ...(f.properties ?? {}) } };
    }
    return null;
  };

  const destacar = (g: Gesto, id: string | null) => {
    if (g.destacada === id) return;
    if (g.destacada !== null) marcarDestino(m, g.destacada, false);
    if (id !== null) marcarDestino(m, id, true);
    g.destacada = id;
  };

  /**
   * O cursor fora de um gesto: "grab" sobre o marcador com o arraste ligado; senão o da seleção (pointer sobre área,
   * nada no vazio). Sem ponto (cancelamento, ponteiro fora do mapa): nenhum cursor próprio.
   */
  const cursorEm = (p: PontoNaTela | null) => {
    if (p !== null && opcoes.ligado() && marcadorNoPonto(p)) {
      canvas.style.cursor = "grab";
      cursorDeArraste = true;
      return;
    }
    cursorDeArraste = false;
    canvas.style.cursor = p !== null && areaNoPonto(m, p) !== null ? "pointer" : "";
  };

  /**
   * Fim do gesto, com ou sem resultado: esvazia o arrastado, apaga o destaque, religa o pan, solta as escutas e devolve
   * o cursor (`p`: onde o ponteiro está agora, sobre o canvas; `null` sem ponto).
   */
  const encerrar = (p: PontoNaTela | null): Gesto | null => {
    const g = gesto;
    if (!g) return null;
    gesto = null;
    for (const desligar of desligarEscutas) desligar();
    desligarEscutas = [];
    if (g.arrastando) publicarArrastado(m, VAZIA);
    destacar(g, null);
    if (g.desligouPan && !m.dragPan.isEnabled()) m.dragPan.enable();
    if (g.arrastando || cursorDeArraste) cursorEm(p);
    return g;
  };

  const cancelar = () => { encerrar(null); };

  const mover = (clientX: number, clientY: number) => {
    const g = gesto;
    if (!g) return;
    const p = pontoDaTela(clientX, clientY);
    if (!g.arrastando) {
      if (Math.hypot(p.x - g.inicio.x, p.y - g.inicio.y) < LIMIAR_DO_ARRASTE_PX[g.tipo]) return;
      g.arrastando = true;
    }
    canvas.style.cursor = "grabbing";
    const ponto = geografico(p);
    publicarArrastado(m, {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Point", coordinates: [ponto.lon, ponto.lat] }, properties: g.propriedades } satisfies Feature<Point>]
    });
    const sob = sobreOCanvas(clientX, clientY) ? areaNoPontoGeografico(ponto, opcoes.areas()) : null;
    destacar(g, sob !== null && sob !== g.origemId ? sob : null);
  };

  const soltar = (clientX: number, clientY: number) => {
    const p = sobreOCanvas(clientX, clientY) ? pontoDaTela(clientX, clientY) : null;
    const g = encerrar(p);
    if (!g || !g.arrastando) return; // clique ou toque: a seleção (painel) cuida
    const r = resultadoDaSoltura(g.origemId, p === null ? null : geografico(p), opcoes.areas());
    if (r) opcoes.aoSoltar(r);
  };

  const ouvir = (alvo: EventTarget | null, tipo: string, fn: (e: Event) => void, op?: AddEventListenerOptions) => {
    if (!alvo) return;
    alvo.addEventListener(tipo, fn, op);
    desligarEscutas.push(() => alvo.removeEventListener(tipo, fn, op));
  };

  const escutarGesto = (tipo: Gesto["tipo"]) => {
    if (tipo === "mouse") {
      ouvir(doc, "mousemove", (e) => { const ev = e as MouseEvent; mover(ev.clientX, ev.clientY); });
      ouvir(doc, "mouseup", (e) => { const ev = e as MouseEvent; if (ev.button === 0) soltar(ev.clientX, ev.clientY); });
    } else {
      ouvir(doc, "touchmove", (e) => {
        const ev = e as TouchEvent;
        const t = ev.touches[0];
        if (!t || ev.touches.length !== 1) { cancelar(); return; }
        mover(t.clientX, t.clientY);
        if (gesto?.arrastando && ev.cancelable) ev.preventDefault(); // o dedo arrasta o lote, não a página
      }, { passive: false });
      ouvir(doc, "touchend", (e) => {
        const ev = e as TouchEvent;
        const t = ev.changedTouches[0];
        if (!t || ev.touches.length > 0) { cancelar(); return; }
        soltar(t.clientX, t.clientY);
      });
      ouvir(doc, "touchcancel", cancelar);
    }
    // Escape cancela o arraste — e só ele: o evento sai marcado, e a cascata do ESC (filtro, seleção) não o trata.
    ouvir(doc, "keydown", (e) => {
      const ev = e as KeyboardEvent;
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      cancelar();
    });
    ouvir(janela, "blur", cancelar);
  };

  const comecar = (tipo: Gesto["tipo"], p: PontoNaTela, e: MapMouseEvent | MapTouchEvent): boolean => {
    if (gesto || !opcoes.ligado()) return false;
    const alvo = marcadorNoPonto(p);
    if (!alvo) return false;
    // O pan do mapa não começa neste gesto (preventDefault do MapLibre) e fica desligado até o fim dele.
    e.preventDefault();
    const desligouPan = m.dragPan.isEnabled();
    if (desligouPan) m.dragPan.disable();
    gesto = { tipo, ...alvo, inicio: p, arrastando: false, desligouPan, destacada: null };
    escutarGesto(tipo);
    return true;
  };

  const aoPressionar = (e: MapMouseEvent) => {
    if (e.originalEvent.button !== 0) return;
    // sem seleção de texto da página enquanto o lote é arrastado
    if (comecar("mouse", e.point, e)) e.originalEvent.preventDefault();
  };

  const aoTocar = (e: MapTouchEvent) => {
    if (gesto) {
      if (e.points.length > 1) cancelar(); // segundo dedo: é pinça (zoom), não arraste
      return;
    }
    if (e.points.length !== 1) return;
    comecar("toque", e.point, e);
  };

  /**
   * Cursor "grab" sobre o marcador só com o arraste ligado; ao sair dele, devolve o cursor da seleção (área ou nada).
   * Fora disso não mexe no cursor: ele é todo da seleção.
   */
  const aoPassar = (e: MapMouseEvent) => {
    if (gesto) return;
    if (cursorDeArraste || (opcoes.ligado() && marcadorNoPonto(e.point))) cursorEm(e.point);
  };

  const aoSairDoMapa = () => {
    if (gesto || !cursorDeArraste) return;
    cursorDeArraste = false;
    canvas.style.cursor = "";
  };

  m.on("mousedown", aoPressionar);
  m.on("touchstart", aoTocar);
  m.on("mousemove", aoPassar);
  m.on("mouseout", aoSairDoMapa);

  return () => {
    m.off("mousedown", aoPressionar);
    m.off("touchstart", aoTocar);
    m.off("mousemove", aoPassar);
    m.off("mouseout", aoSairDoMapa);
    cancelar();
    if (cursorDeArraste) {
      cursorDeArraste = false;
      canvas.style.cursor = "";
    }
  };
}
