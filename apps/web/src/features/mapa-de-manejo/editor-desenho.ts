import area from "@turf/area";
import type { Polygon } from "geojson";

/**
 * MAPA-01 (decisão 289) — núcleo do editor de desenho de área, SEM React e SEM MapLibre.
 *
 * Toda a regra de interação (acerto em ponto/meio/polígono, ímã, trava de ângulo, histórico) roda em PIXELS DE
 * TELA, como no protótipo aprovado: a tolerância do ímã é em px e vale o que o olho vê no zoom atual. As medidas
 * (área, perímetro, lado) saem das coordenadas reais (geodésicas), nunca dos pixels. O ponto que gruda num
 * VÉRTICE recebe a coordenada EXATA daquele vértice: duas áreas vizinhas dividem a divisa sem fresta.
 */

export type LngLat = [number, number];
export interface Px { x: number; y: number }

export type TipoGrude = "vertice" | "aresta";
/** Ponto da área em desenho: coordenada real + de onde ele veio (livre, ou grudado em vértice/aresta de outra área). */
export interface PontoDesenho { lng: number; lat: number; grudado: boolean; tipo: TipoGrude | null; de: string | null }

/** Alvo encontrado pelo ímã sob o cursor. */
export interface Ima {
  px: Px;
  /** Coordenada exata do vértice-alvo (vértice e fechar). Na aresta é nula: a posição sai do pixel. */
  lngLat: LngLat | null;
  dist: number;
  tipo: TipoGrude | "fechar";
  de: string;
  aresta?: [Px, Px];
}

/** Área já gravada, projetada na tela, que serve de alvo do ímã. */
export interface AlvoPx { nome: string; pts: Px[]; coords: LngLat[] }

export interface ConfigIma { ligado: boolean; tolerancia: number; vertice: boolean; aresta: boolean }
export const IMA_PADRAO: ConfigIma = { ligado: true, tolerancia: 8, vertice: true, aresta: true };
export const TOLERANCIAS_RAPIDAS = [8, 14, 22, 32] as const;
export const TOLERANCIA_MIN = 1;
export const TOLERANCIA_MAX = 200;

export type Acerto = { tipo: "vertice"; i: number } | { tipo: "meio"; i: number; px: Px } | { tipo: "poligono" };
/** Raio de pega do ponto e do ponto do meio, em px (pontos um pouco maiores na tela). */
export const RAIO_VERTICE = 10;
export const RAIO_MEIO = 8;

export const distancia = (a: Px, b: Px) => Math.hypot(a.x - b.x, a.y - b.y);

/** Ponto mais próximo de `p` no segmento a–b. */
export function noSegmento(p: Px, a: Px, b: Px): Px {
  const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy;
  if (l2 === 0) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
  return { x: a.x + t * vx, y: a.y + t * vy };
}

export function dentroDoPoligono(p: Px, pts: Px[]): boolean {
  let dentro = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!, b = pts[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
  }
  return dentro;
}

/**
 * Ímã. Ordem do protótipo: (1) vértice de outra área; (2) o PRIMEIRO ponto, para fechar (só com 3+ pontos e
 * fora de arrasto); (3) aresta de outra área. Ímã desligado ou Alt pressionado = nenhum alvo.
 */
export function acharIma(
  p: Px,
  alvos: AlvoPx[],
  cfg: ConfigIma,
  desenho: { pts: Px[]; fechado: boolean },
  opts: { soltar: boolean; semFechar: boolean }
): Ima | null {
  if (!cfg.ligado || opts.soltar) return null;
  const tol = cfg.tolerancia;
  let melhor: Ima | null = null;
  if (cfg.vertice) {
    for (const alvo of alvos) {
      for (let j = 0; j < alvo.pts.length; j++) {
        const v = alvo.pts[j]!;
        const d = distancia(p, v);
        if (d <= tol && (!melhor || d < melhor.dist)) melhor = { px: v, lngLat: alvo.coords[j] ?? null, dist: d, tipo: "vertice", de: alvo.nome };
      }
    }
    if (melhor) return melhor;
  }
  const pts = desenho.pts;
  if (!desenho.fechado && pts.length >= 3 && !opts.semFechar) {
    const d = distancia(p, pts[0]!);
    if (d <= tol) return { px: pts[0]!, lngLat: null, dist: d, tipo: "fechar", de: "primeiro ponto" };
  }
  if (cfg.aresta) {
    for (const alvo of alvos) {
      const n = alvo.pts.length;
      for (let m = 0; m < n; m++) {
        const a = alvo.pts[m]!, b = alvo.pts[(m + 1) % n]!;
        const q = noSegmento(p, a, b);
        const d = distancia(p, q);
        if (d <= tol && (!melhor || d < melhor.dist)) melhor = { px: q, lngLat: null, dist: d, tipo: "aresta", de: alvo.nome, aresta: [a, b] };
      }
    }
  }
  return melhor;
}

/** Shift: trava a direção a partir do último ponto em passos de 45°, mantendo o comprimento. */
export function travarAngulo(ultimo: Px, p: Px): Px {
  const dx = p.x - ultimo.x, dy = p.y - ultimo.y;
  const len = Math.hypot(dx, dy), passo = Math.PI / 4;
  const ang = Math.round(Math.atan2(dy, dx) / passo) * passo;
  return { x: ultimo.x + Math.cos(ang) * len, y: ultimo.y + Math.sin(ang) * len };
}

/** Rumo do segmento na tela, em graus (0 = norte, 90 = leste) — o mapa é sempre norte para cima. */
export const rumoGraus = (de: Px, para: Px) => Math.round(((Math.atan2(para.y - de.y, para.x - de.x) * 180) / Math.PI + 450) % 360);

/** O que está sob o cursor no desenho: um ponto, o meio de um lado, ou o interior da área fechada. */
export function acertar(p: Px, pts: Px[], fechado: boolean): Acerto | null {
  for (let i = 0; i < pts.length; i++) if (distancia(p, pts[i]!) <= RAIO_VERTICE) return { tipo: "vertice", i };
  const n = fechado ? pts.length : pts.length - 1;
  for (let j = 0; j < n; j++) {
    const a = pts[j]!, b = pts[(j + 1) % pts.length]!;
    const meio = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (distancia(p, meio) <= RAIO_MEIO) return { tipo: "meio", i: j, px: meio };
  }
  if (fechado && pts.length >= 3 && dentroDoPoligono(p, pts)) return { tipo: "poligono" };
  return null;
}

// ---------- medidas reais ----------
const RAIO_TERRA_M = 6371008.8;
const rad = (g: number) => (g * Math.PI) / 180;

export function distanciaM(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * RAIO_TERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function areaHa(coords: LngLat[]): number {
  if (coords.length < 3) return 0;
  return area({ type: "Polygon", coordinates: [[...coords, coords[0]!]] }) / 10000;
}

export function perimetroM(coords: LngLat[], fechado: boolean): number {
  if (coords.length < 2) return 0;
  const n = fechado ? coords.length : coords.length - 1;
  let t = 0;
  for (let i = 0; i < n; i++) t += distanciaM(coords[i]!, coords[(i + 1) % coords.length]!);
  return t;
}

export const coordsDe = (pontos: PontoDesenho[]): LngLat[] => pontos.map((p) => [p.lng, p.lat]);

/** Polígono GeoJSON canônico (anel fechado) — o mesmo formato que o gatilho do banco confere. */
export function poligonoGeoJSON(pontos: PontoDesenho[]): Polygon {
  const anel = coordsDe(pontos);
  return { type: "Polygon", coordinates: [[...anel, anel[0]!]] };
}

/** Anel externo de uma área gravada, sem o ponto repetido de fechamento. */
export function anelAberto(g: Polygon | null | undefined): LngLat[] {
  const anel = (g?.coordinates?.[0] ?? []).filter((c): c is LngLat => typeof c[0] === "number" && typeof c[1] === "number").map((c) => [c[0], c[1]] as LngLat);
  if (anel.length > 1) {
    const a = anel[0]!, z = anel[anel.length - 1]!;
    if (a[0] === z[0] && a[1] === z[1]) anel.pop();
  }
  return anel;
}

/**
 * Centroide geométrico do polígono (fórmula de área / shoelace) em coordenadas geográficas.
 * Polígono inválido ou degenerado → centro da caixa envolvente.
 */
export function centroideLngLat(coords: LngLat[]): LngLat | null {
  if (coords.length < 3) return null;
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < coords.length; i++) {
    const [x0, y0] = coords[i]!;
    const [x1, y1] = coords[(i + 1) % coords.length]!;
    const cruz = x0 * y1 - x1 * y0;
    a += cruz; cx += (x0 + x1) * cruz; cy += (y0 + y1) * cruz;
  }
  if (Math.abs(a) < 1e-18) {
    let oeste = Infinity, sul = Infinity, leste = -Infinity, norte = -Infinity;
    for (const [lng, lat] of coords) {
      if (lng < oeste) oeste = lng; if (lng > leste) leste = lng;
      if (lat < sul) sul = lat; if (lat > norte) norte = lat;
    }
    if (!Number.isFinite(oeste)) return null;
    return [(oeste + leste) / 2, (sul + norte) / 2];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Centroide em pixels: projeta o centroide geográfico; se falhar, média dos pontos na tela. */
export const centroPx = (pts: Px[], coords?: LngLat[], projetar?: (ll: LngLat) => Px): Px => {
  if (coords && projetar && coords.length >= 3) {
    const c = centroideLngLat(coords);
    if (c) return projetar(c);
  }
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / Math.max(1, pts.length), y: y / Math.max(1, pts.length) };
};

// ---------- histórico (desfazer / refazer) ----------
export interface Retrato { pontos: PontoDesenho[]; fechado: boolean }
export interface Historico { pilha: string[]; pos: number }
export const LIMITE_HISTORICO = 80;
const VAZIO: Retrato = { pontos: [], fechado: false };

export const novoHistorico = (): Historico => ({ pilha: [JSON.stringify(VAZIO)], pos: 0 });

/** Grava um passo. O que estava à frente (refazer) é descartado; o passo 0 (vazio) nunca sai — "Recomeçar" volta a ele. */
export function registrar(h: Historico, r: Retrato): Historico {
  const pilha = h.pilha.slice(0, h.pos + 1);
  pilha.push(JSON.stringify(r));
  if (pilha.length > LIMITE_HISTORICO) pilha.splice(1, 1);
  return { pilha, pos: pilha.length - 1 };
}

export const lerPasso = (h: Historico, i: number): Retrato => JSON.parse(h.pilha[i] ?? JSON.stringify(VAZIO)) as Retrato;
export const podeDesfazer = (h: Historico) => h.pos > 0;
export const podeRefazer = (h: Historico) => h.pos < h.pilha.length - 1;
