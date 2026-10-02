"use client";
import * as React from "react";
import { num } from "@/lib/utils";
import type { Acerto, Ima, Px } from "./editor-desenho";

/**
 * Camada visual do editor de desenho, por cima do canvas do mapa. Só apresenta: pointer-events none.
 * Linha e ímã brancos; pontos verdes de registro (sem brilho, sem borda).
 */

export const COR_DESENHO = {
  linha: "#ffffff",
  elastico: "#ffffff",
  ima: "#ffffff",
  /** Pontos do cadastro — verde de registro/salvar. */
  ponto: "#40de63",
  meio: "#ffffff",
  guia: "#ffffff"
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
  /** Quando true, mostra rótulos de metros em cada lado. */
  mostrarMetragem?: boolean;
  /** Cor de preview da área em gravação (listagem de cores — atualiza na hora). */
  corPreview?: string | null;
  /** Esconde rótulos das áreas gravadas (ex.: durante o desenho). */
  ocultarRotulos?: boolean;
}

const lista = (pts: Px[]) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

export function CamadaDesenho(p: Props) {
  const { pts, fechado, cur, ima, arrastando } = p;
  const fillPreview = p.corPreview && fechado ? p.corPreview : COR_DESENHO.linha;
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
                <line x1={ima.aresta[0].x} y1={ima.aresta[0].y} x2={ima.aresta[1].x} y2={ima.aresta[1].y} stroke={COR_DESENHO.ima} strokeWidth={5} strokeOpacity={0.22} />
                <line x1={ima.aresta[0].x} y1={ima.aresta[0].y} x2={ima.aresta[1].x} y2={ima.aresta[1].y} stroke={COR_DESENHO.ima} strokeWidth={2} />
              </g>
            )}
            {pts.length >= 3 && (
              <polygon
                points={lista(pts)}
                fill={fillPreview}
                fillOpacity={fechado ? (p.corPreview ? 0.7 : 0.22) : 0.12}
                stroke="none"
              />
            )}
            {pts.length >= 2 && (
              <polyline
                points={lista(pts)}
                fill="none"
                stroke={p.corPreview && fechado ? fillPreview : COR_DESENHO.linha}
                strokeWidth={2.4}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {fechado && ultimo && primeiro && (
              <line
                x1={ultimo.x} y1={ultimo.y} x2={primeiro.x} y2={primeiro.y}
                stroke={p.corPreview ? fillPreview : COR_DESENHO.linha}
                strokeWidth={2.4}
                strokeLinecap="round"
              />
            )}
            {p.travado && cur && ultimo && !fechado && (
              <line x1={ultimo.x} y1={ultimo.y} x2={ultimo.x + (cur.x - ultimo.x) * 1.35} y2={ultimo.y + (cur.y - ultimo.y) * 1.35} stroke={COR_DESENHO.guia} strokeWidth={1.2} strokeDasharray="4 6" strokeOpacity={0.85} />
            )}

            {meios.map((m) => (
              <g key={m.i}>
                {m.i === hm && <circle cx={m.px.x} cy={m.px.y} r={6} fill={COR_DESENHO.ponto} fillOpacity={0.22} />}
                <circle cx={m.px.x} cy={m.px.y} r={2} fill={COR_DESENHO.ponto} />
              </g>
            ))}

            {pts.map((v, i) => (
              <g key={i}>
                {(p.grudados[i] || i === p.arrastoVertice || i === hv) && (
                  <circle cx={v.x} cy={v.y} r={6} fill={COR_DESENHO.ponto} fillOpacity={0.2} />
                )}
                <circle cx={v.x} cy={v.y} r={3.2} fill={COR_DESENHO.ponto} />
              </g>
            ))}

            {/* Ímã branco no alvo — acompanha só o snap, sem tooltip. */}
            {ima && cur && (
              <g data-testid="mapa-ima-marca" data-tipo={ima.tipo}>
                <circle cx={cur.x} cy={cur.y} r={9} fill={COR_DESENHO.ima} fillOpacity={0.14} />
                <circle cx={cur.x} cy={cur.y} r={5} fill="none" stroke={COR_DESENHO.ima} strokeWidth={1.5} strokeOpacity={0.9} />
                <circle cx={cur.x} cy={cur.y} r={2.4} fill={ima.tipo === "fechar" ? COR_DESENHO.ponto : COR_DESENHO.ima} />
              </g>
            )}

            {/* Cursor livre: só sob o mouse (sem linha até o último ponto). */}
            {cur && !ima && !fechado && !arrastando && !p.hover && (
              <circle cx={cur.x} cy={cur.y} r={2.2} fill={COR_DESENHO.ima} />
            )}
          </svg>

          {p.mostrarMetragem && p.lados.map((l, i) => (
            <div key={i} className="absolute -translate-x-1/2 -translate-y-full rounded bg-slate-900/80 px-1.5 py-px text-[10px] tabular-nums text-amber-100" style={{ left: l.px.x, top: l.px.y - 6 }} data-testid="mapa-lado">
              {num(Math.round(l.metros), 0)} m
            </div>
          ))}

          {p.travado && cur && p.rumo !== null && !fechado && (
            <div className="absolute -translate-x-1/2 -translate-y-full rounded bg-slate-900/80 px-1.5 py-px text-[10px] tabular-nums text-sky-100" style={{ left: cur.x, top: cur.y - 14 }} data-testid="mapa-rumo">{p.rumo}°</div>
          )}
        </>
      )}
    </div>
  );
}
