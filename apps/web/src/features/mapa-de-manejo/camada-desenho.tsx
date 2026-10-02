"use client";
import * as React from "react";
import { num } from "@/lib/utils";
import type { Acerto, Ima, Px } from "./editor-desenho";

/**
 * Camada visual do editor de desenho, por cima do canvas do mapa. Só apresenta: pointer-events none.
 * Linha e cruzinha laranja (estilo da foto); pontos grandes branco com borda laranja; meios só laranja.
 */

/** Laranja do desenho — mesma família da foto de referência. */
export const COR_DESENHO = {
  linha: "#f5a01b",
  elastico: "#f5a01b",
  ima: "#f5a01b",
  pontoBorda: "#f5a01b",
  pontoDentro: "#ffffff",
  meio: "#f5a01b",
  guia: "#f5a01b",
  cruz: "#f5a01b"
} as const;

export interface RotuloArea {
  id: string;
  px: Px;
  nome: string;
  ha: number;
  opacidade?: number;
  fonteNome?: number;
  fonteHa?: number;
}
export interface Lado { px: Px; metros: number }

interface Props {
  desenhando: boolean;
  rotulosAreas: RotuloArea[];
  pts: Px[];
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

function Cruzinha({ x, y, cor = COR_DESENHO.cruz }: { x: number; y: number; cor?: string }) {
  const r = 7;
  return (
    <g data-testid="mapa-cruzinha" stroke={cor} strokeWidth={1.8} strokeLinecap="round">
      <line x1={x - r} y1={y} x2={x + r} y2={y} />
      <line x1={x} y1={y - r} x2={x} y2={y + r} />
    </g>
  );
}

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
      {!p.ocultarRotulos && p.rotulosAreas.map((r) => {
        const fonteNome = r.fonteNome ?? 11;
        const fonteHa = r.fonteHa ?? 9.5;
        return (
          <div
            key={r.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 text-center transition-opacity duration-150"
            style={{
              left: r.px.x,
              top: r.px.y,
              zIndex: 100,
              opacity: r.opacidade ?? 0.95,
              fontFamily: "Inter, Arial, sans-serif",
              lineHeight: 1.2,
              textShadow: "0 1px 2px rgba(2,6,23,0.9), 0 0 5px rgba(2,6,23,0.7)"
            }}
            data-testid="mapa-rotulo-area"
          >
            <div className="whitespace-nowrap font-bold text-white" style={{ fontSize: fonteNome, letterSpacing: 0.15 }}>{r.nome}</div>
            {r.ha > 0 && (
              <div className="mt-px whitespace-nowrap font-semibold tabular-nums" style={{ fontSize: fonteHa, color: "#e2e8f0" }}>
                ha {num(r.ha, 2)}
              </div>
            )}
          </div>
        );
      })}

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
                fillOpacity={fechado ? (p.corPreview ? 0.7 : 0.18) : 0.1}
                stroke="none"
              />
            )}
            {pts.length >= 2 && (
              <polyline
                points={lista(pts)}
                fill="none"
                stroke={p.corPreview && fechado ? fillPreview : COR_DESENHO.linha}
                strokeWidth={2.2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {fechado && ultimo && primeiro && (
              <line
                x1={ultimo.x} y1={ultimo.y} x2={primeiro.x} y2={primeiro.y}
                stroke={p.corPreview ? fillPreview : COR_DESENHO.linha}
                strokeWidth={2.2}
                strokeLinecap="round"
              />
            )}
            {/* Linha até o mouse (elástico sólido laranja). */}
            {!fechado && !arrastando && cur && ultimo && (
              <line
                x1={ultimo.x} y1={ultimo.y} x2={cur.x} y2={cur.y}
                stroke={COR_DESENHO.elastico}
                strokeWidth={2.2}
                strokeLinecap="round"
              />
            )}
            {p.travado && cur && ultimo && !fechado && (
              <line x1={ultimo.x} y1={ultimo.y} x2={ultimo.x + (cur.x - ultimo.x) * 1.35} y2={ultimo.y + (cur.y - ultimo.y) * 1.35} stroke={COR_DESENHO.guia} strokeWidth={1.2} strokeDasharray="4 6" strokeOpacity={0.85} />
            )}

            {/* Pontos do meio: só laranja, sem borda. */}
            {meios.map((m) => (
              <circle
                key={m.i}
                cx={m.px.x}
                cy={m.px.y}
                r={m.i === hm ? 3.4 : 2.8}
                fill={COR_DESENHO.meio}
              />
            ))}

            {/* Pontos grandes: branco por dentro, borda laranja. */}
            {pts.map((v, i) => {
              const ativo = i === p.arrastoVertice || i === hv;
              return (
                <circle
                  key={i}
                  cx={v.x}
                  cy={v.y}
                  r={ativo ? 5.6 : 5}
                  fill={COR_DESENHO.pontoDentro}
                  stroke={COR_DESENHO.pontoBorda}
                  strokeWidth={2.4}
                />
              );
            })}

            {/* Ímã no alvo (anel laranja). */}
            {ima && cur && (
              <g data-testid="mapa-ima-marca" data-tipo={ima.tipo}>
                <circle cx={cur.x} cy={cur.y} r={8} fill="none" stroke={COR_DESENHO.ima} strokeWidth={1.6} strokeOpacity={0.95} />
                {ima.tipo === "fechar" ? (
                  <circle cx={cur.x} cy={cur.y} r={4.2} fill={COR_DESENHO.pontoDentro} stroke={COR_DESENHO.pontoBorda} strokeWidth={2} />
                ) : (
                  <Cruzinha x={cur.x} y={cur.y} />
                )}
              </g>
            )}

            {/* Cruzinha livre sob o mouse. */}
            {cur && !ima && !fechado && !arrastando && !p.hover && (
              <Cruzinha x={cur.x} y={cur.y} />
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
