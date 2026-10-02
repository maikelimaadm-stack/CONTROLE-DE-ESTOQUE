"use client";
import * as React from "react";
import { num } from "@/lib/utils";
import type { Acerto, Ima, Px } from "./editor-desenho";

/**
 * Camada visual do editor de desenho, por cima do canvas do mapa. Só apresenta: pointer-events none.
 * Ímã: verde, compacto, sem cruzetas. Rótulos das áreas: tipografia da ficha (sem fundo).
 */

export const COR_DESENHO = {
  linha: "#22d3ee",
  elastico: "#ffffff",
  ima: "#22c55e",
  meio: "#ffffff",
  guia: "#e0f2fe",
  contorno: "#0f172a"
} as const;

export interface RotuloArea { id: string; px: Px; nome: string; ha: number }
export interface Lado { px: Px; metros: number }

interface Props {
  desenhando: boolean;
  rotulosAreas: RotuloArea[];
  pts: Px[];
  grudados: boolean[];
  fechado: boolean;
  cur: Px | null;
  raw: Px | null;
  ima: Ima | null;
  travado: boolean;
  rumo: number | null;
  arrastando: boolean;
  arrastoVertice: number;
  hover: Acerto | null;
  lados: Lado[];
  areaHaAtual: number;
  centro: Px | null;
  /** Cor de preview da área em gravação (listagem de cores — atualiza na hora). */
  corPreview?: string | null;
  /** Esconde rótulos das áreas gravadas (ex.: durante o desenho). */
  ocultarRotulos?: boolean;
}

const lista = (pts: Px[]) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
const AFORDANCIA: Record<Acerto["tipo"], { texto: string; cor: string }> = {
  vertice: { texto: "Segure para arrastar · 2 cliques apagam", cor: COR_DESENHO.ima },
  meio: { texto: "Segure para criar um ponto", cor: COR_DESENHO.linha },
  poligono: { texto: "Segure para mover a área", cor: "#86efac" }
};

export function CamadaDesenho(p: Props) {
  const { pts, fechado, cur, raw, ima, arrastando } = p;
  const linha = COR_DESENHO.linha;
  const fillPreview = p.corPreview && fechado ? p.corPreview : linha;
  const ultimo = pts.length ? pts[pts.length - 1]! : null;
  const primeiro = pts.length ? pts[0]! : null;
  const hm = p.hover?.tipo === "meio" ? p.hover.i : -1;
  const hv = p.hover?.tipo === "vertice" ? p.hover.i : -1;
  const meios: { px: Px; i: number }[] = [];
  if (p.desenhando && pts.length >= 2 && !arrastando) {
    const n = fechado ? pts.length : pts.length - 1;
    for (let j = 0; j < n; j++) {
      const a = pts[j]!, b = pts[(j + 1) % pts.length]!;
      meios.push({ px: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, i: j });
    }
  }
  const afordancia = p.desenhando && p.hover && !arrastando && cur ? AFORDANCIA[p.hover.tipo] : null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" data-testid="mapa-camada-desenho">
      {!p.ocultarRotulos && p.rotulosAreas.map((r) => (
        <div
          key={r.id}
          className="absolute -translate-x-1/2 -translate-y-1/2 text-center"
          style={{
            left: r.px.x,
            top: r.px.y,
            zIndex: 100,
            fontFamily: "Inter, Arial, sans-serif",
            lineHeight: 1.25,
            textShadow: "0 1px 3px rgba(2,6,23,0.95), 0 0 8px rgba(2,6,23,0.85)"
          }}
          data-testid="mapa-rotulo-area"
        >
          <div className="whitespace-nowrap font-bold text-white" style={{ fontSize: 11.5, letterSpacing: 0.3 }}>{r.nome}</div>
          {r.ha > 0 && (
            <div className="mt-px whitespace-nowrap font-semibold tabular-nums" style={{ fontSize: 10, color: "#f1f5f9" }}>
              ha {num(r.ha, 2)}
            </div>
          )}
        </div>
      ))}

      {p.desenhando && (
        <>
          <svg className="absolute inset-0 h-full w-full" aria-hidden>
            {ima?.tipo === "aresta" && ima.aresta && (
              <g strokeLinecap="round">
                <line x1={ima.aresta[0].x} y1={ima.aresta[0].y} x2={ima.aresta[1].x} y2={ima.aresta[1].y} stroke={COR_DESENHO.ima} strokeWidth={6} strokeOpacity={0.28} />
                <line x1={ima.aresta[0].x} y1={ima.aresta[0].y} x2={ima.aresta[1].x} y2={ima.aresta[1].y} stroke={COR_DESENHO.ima} strokeWidth={2.2} />
              </g>
            )}
            {pts.length >= 3 && (
              <polygon
                points={lista(pts)}
                fill={fillPreview}
                fillOpacity={fechado ? (p.corPreview ? 0.7 : 0.3) : 0.18}
                stroke="none"
              />
            )}
            {pts.length >= 2 && (
              <g fill="none" strokeLinejoin="round" strokeLinecap="round">
                <polyline points={lista(pts)} stroke={COR_DESENHO.contorno} strokeOpacity={0.55} strokeWidth={5} />
                <polyline points={lista(pts)} stroke={p.corPreview && fechado ? fillPreview : linha} strokeWidth={2.6} />
              </g>
            )}
            {fechado && ultimo && primeiro && (
              <g strokeLinecap="round">
                <line x1={ultimo.x} y1={ultimo.y} x2={primeiro.x} y2={primeiro.y} stroke={COR_DESENHO.contorno} strokeOpacity={0.55} strokeWidth={5} />
                <line x1={ultimo.x} y1={ultimo.y} x2={primeiro.x} y2={primeiro.y} stroke={p.corPreview ? fillPreview : linha} strokeWidth={2.6} />
              </g>
            )}
            {cur && ultimo && !fechado && !arrastando && (
              <g strokeLinecap="round">
                <line x1={ultimo.x} y1={ultimo.y} x2={cur.x} y2={cur.y} stroke={COR_DESENHO.contorno} strokeOpacity={0.5} strokeWidth={4.5} />
                <line x1={ultimo.x} y1={ultimo.y} x2={cur.x} y2={cur.y} stroke={COR_DESENHO.elastico} strokeWidth={2} strokeDasharray="6 4" />
              </g>
            )}
            {p.travado && cur && ultimo && !fechado && (
              <line x1={ultimo.x} y1={ultimo.y} x2={ultimo.x + (cur.x - ultimo.x) * 1.35} y2={ultimo.y + (cur.y - ultimo.y) * 1.35} stroke={COR_DESENHO.guia} strokeWidth={1.2} strokeDasharray="4 6" strokeOpacity={0.85} />
            )}

            {meios.map((m) => (
              <g key={m.i}>
                {m.i === hm && <circle cx={m.px.x} cy={m.px.y} r={7} fill={COR_DESENHO.linha} fillOpacity={0.28} />}
                <circle cx={m.px.x} cy={m.px.y} r={2.2} fill="#ffffff" fillOpacity={0.65} stroke={COR_DESENHO.contorno} strokeOpacity={0.6} strokeWidth={1} />
              </g>
            ))}

            {pts.map((v, i) => (
              <g key={i}>
                {(p.grudados[i] || i === p.arrastoVertice) && (
                  <circle cx={v.x} cy={v.y} r={5.5} fill="none" stroke={COR_DESENHO.ima} strokeWidth={1.3} strokeOpacity={0.9} />
                )}
                {i === hv && <circle cx={v.x} cy={v.y} r={7} fill="#ffffff" fillOpacity={0.14} />}
                <circle cx={v.x} cy={v.y} r={2.6} fill="#ffffff" stroke={COR_DESENHO.contorno} strokeWidth={1.1} />
              </g>
            ))}

            {/* Ímã: anéis verdes compactos — sem cruzetas, sem rótulo de nome. */}
            {ima && raw && cur && (
              <g data-testid="mapa-ima-marca" data-tipo={ima.tipo}>
                <line x1={raw.x} y1={raw.y} x2={cur.x} y2={cur.y} stroke={COR_DESENHO.ima} strokeWidth={1} strokeDasharray="2 3" strokeOpacity={0.7} />
                <circle cx={raw.x} cy={raw.y} r={1.8} fill="none" stroke="#ffffff" strokeWidth={1} strokeOpacity={0.6} />
                <circle cx={cur.x} cy={cur.y} r={9} fill={COR_DESENHO.ima} fillOpacity={0.14} />
                <circle cx={cur.x} cy={cur.y} r={5.5} fill="none" stroke={COR_DESENHO.ima} strokeWidth={1.4} strokeOpacity={0.9} />
                <circle cx={cur.x} cy={cur.y} r={2.4} fill={ima.tipo === "fechar" ? COR_DESENHO.linha : COR_DESENHO.ima} stroke={COR_DESENHO.contorno} strokeWidth={1} />
              </g>
            )}

            {cur && !ima && !fechado && !arrastando && !p.hover && (
              <g>
                <circle cx={cur.x} cy={cur.y} r={4} fill="none" stroke="#ffffff" strokeWidth={1.3} strokeOpacity={0.85} />
                <circle cx={cur.x} cy={cur.y} r={1.4} fill="#ffffff" />
              </g>
            )}
          </svg>

          {p.lados.map((l, i) => (
            <div key={i} className="absolute -translate-x-1/2 -translate-y-full rounded bg-slate-900/80 px-1.5 py-px text-[10px] tabular-nums text-amber-100" style={{ left: l.px.x, top: l.px.y - 6 }} data-testid="mapa-lado">
              {num(Math.round(l.metros), 0)} m
            </div>
          ))}

          {p.centro && pts.length >= 3 && !p.corPreview && (
            <div className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border bg-slate-900/90 px-2.5 py-0.5 text-[11px] font-medium tabular-nums ${fechado ? "border-cyan-300 text-cyan-50" : "border-cyan-400/70 text-cyan-100"}`} style={{ left: p.centro.x, top: p.centro.y }}>
              {num(p.areaHaAtual, 2)} ha
            </div>
          )}

          {p.travado && cur && p.rumo !== null && !fechado && (
            <div className="absolute -translate-x-1/2 -translate-y-full rounded bg-slate-900/80 px-1.5 py-px text-[10px] tabular-nums text-sky-100" style={{ left: cur.x, top: cur.y - 14 }} data-testid="mapa-rumo">{p.rumo}°</div>
          )}

          {afordancia && cur && (
            <div className="absolute whitespace-nowrap rounded-full border bg-slate-900/95 px-2.5 py-0.5 text-[11px]" style={{ left: cur.x + 16, top: cur.y + 12, borderColor: afordancia.cor, color: afordancia.cor }}>{afordancia.texto}</div>
          )}
        </>
      )}
    </div>
  );
}
