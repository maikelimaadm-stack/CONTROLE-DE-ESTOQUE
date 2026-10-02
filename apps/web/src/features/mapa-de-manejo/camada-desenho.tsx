"use client";
import * as React from "react";
import { num } from "@/lib/utils";
import type { Acerto, Ima, Px } from "./editor-desenho";

/**
 * MAPA-01 (decisão 279) — camada visual do editor de desenho, por cima do canvas do mapa. Só APRESENTA: recebe
 * tudo já projetado em pixels e não captura evento nenhum (pointer-events: none) — quem decide é o editor.
 */

/**
 * Cores do desenho. A linha é CIANO com contorno escuro: contrasta com o verde e o marrom do satélite e com o
 * fundo claro do mapa de ruas (o amarelo/verde de antes sumia na lavoura). O ímã fica AMARELO, para não se
 * confundir com a linha; o elástico até o cursor é BRANCO tracejado (ainda não é lado).
 */
export const COR_DESENHO = { linha: "#22d3ee", elastico: "#ffffff", ima: "#facc15", meio: "#ffffff", guia: "#e0f2fe", contorno: "#0f172a" } as const;

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
}

const lista = (pts: Px[]) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
const AFORDANCIA: Record<Acerto["tipo"], { texto: string; cor: string }> = {
  vertice: { texto: "Segure para arrastar este ponto · 2 cliques apagam", cor: COR_DESENHO.ima },
  meio: { texto: "Segure para criar um ponto aqui", cor: COR_DESENHO.linha },
  poligono: { texto: "Segure para mover a área inteira", cor: "#c084fc" }
};

export function CamadaDesenho(p: Props) {
  const { pts, fechado, cur, raw, ima, arrastando } = p;
  const linha = COR_DESENHO.linha;
  const ultimo = pts.length ? pts[pts.length - 1]! : null;
  const primeiro = pts.length ? pts[0]! : null;
  const hm = p.hover?.tipo === "meio" ? p.hover.i : -1;
  const hv = p.hover?.tipo === "vertice" ? p.hover.i : -1;
  const meios: { px: Px; i: number }[] = [];
  if (p.desenhando && pts.length >= 2 && !arrastando) {
    const n = fechado ? pts.length : pts.length - 1;
    for (let j = 0; j < n; j++) { const a = pts[j]!, b = pts[(j + 1) % pts.length]!; meios.push({ px: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, i: j }); }
  }
  const afordancia = p.desenhando && p.hover && !arrastando && cur ? AFORDANCIA[p.hover.tipo] : null;
  const puxou = ima && raw ? Math.round(Math.hypot(raw.x - ima.px.x, raw.y - ima.px.y)) : 0;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" data-testid="mapa-camada-desenho">
      {/* nomes das áreas gravadas */}
      {p.rotulosAreas.map((r) => (
        <div key={r.id} className="absolute -translate-x-1/2 -translate-y-1/2 text-center leading-tight drop-shadow-[0_1px_1px_rgba(15,23,42,0.95)]" style={{ left: r.px.x, top: r.px.y }}>
          <div className="text-xs font-semibold text-white">{r.nome}</div>
          <div className="text-[11px] tabular-nums text-slate-100">{num(r.ha, 2)} ha</div>
        </div>
      ))}

      {p.desenhando && (
        <>
          <svg className="absolute inset-0 h-full w-full" aria-hidden>
            {ima?.tipo === "aresta" && ima.aresta && (
              <g strokeLinecap="round">
                <line x1={ima.aresta[0].x} y1={ima.aresta[0].y} x2={ima.aresta[1].x} y2={ima.aresta[1].y} stroke={COR_DESENHO.ima} strokeWidth={9} strokeOpacity={0.3} />
                <line x1={ima.aresta[0].x} y1={ima.aresta[0].y} x2={ima.aresta[1].x} y2={ima.aresta[1].y} stroke={COR_DESENHO.ima} strokeWidth={3} />
              </g>
            )}
            {pts.length >= 3 && <polygon points={lista(pts)} fill={linha} fillOpacity={fechado ? 0.3 : 0.18} stroke="none" />}
            {pts.length >= 2 && (
              <g fill="none" strokeLinejoin="round" strokeLinecap="round">
                <polyline points={lista(pts)} stroke={COR_DESENHO.contorno} strokeOpacity={0.6} strokeWidth={7.5} />
                <polyline points={lista(pts)} stroke={linha} strokeWidth={3.5} />
              </g>
            )}
            {fechado && ultimo && primeiro && (
              <g strokeLinecap="round">
                <line x1={ultimo.x} y1={ultimo.y} x2={primeiro.x} y2={primeiro.y} stroke={COR_DESENHO.contorno} strokeOpacity={0.6} strokeWidth={7.5} />
                <line x1={ultimo.x} y1={ultimo.y} x2={primeiro.x} y2={primeiro.y} stroke={linha} strokeWidth={3.5} />
              </g>
            )}
            {cur && ultimo && !fechado && !arrastando && (
              <g strokeLinecap="round">
                <line x1={ultimo.x} y1={ultimo.y} x2={cur.x} y2={cur.y} stroke={COR_DESENHO.contorno} strokeOpacity={0.55} strokeWidth={6} />
                <line x1={ultimo.x} y1={ultimo.y} x2={cur.x} y2={cur.y} stroke={COR_DESENHO.elastico} strokeWidth={2.4} strokeDasharray="7 5" />
              </g>
            )}
            {p.travado && cur && ultimo && !fechado && (
              <line x1={ultimo.x} y1={ultimo.y} x2={ultimo.x + (cur.x - ultimo.x) * 1.35} y2={ultimo.y + (cur.y - ultimo.y) * 1.35} stroke={COR_DESENHO.guia} strokeWidth={1.4} strokeDasharray="4 6" strokeOpacity={0.85} />
            )}

            {meios.map((m) => (
              <g key={m.i}>
                {m.i === hm && (
                  <g>
                    <circle cx={m.px.x} cy={m.px.y} r={16} fill={COR_DESENHO.linha} fillOpacity={0.3} />
                    <g stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round">
                      <line x1={m.px.x - 5} y1={m.px.y} x2={m.px.x + 5} y2={m.px.y} />
                      <line x1={m.px.x} y1={m.px.y - 5} x2={m.px.x} y2={m.px.y + 5} />
                    </g>
                  </g>
                )}
                <circle cx={m.px.x} cy={m.px.y} r={4.5} fill="#ffffff" fillOpacity={0.6} stroke={COR_DESENHO.contorno} strokeOpacity={0.65} strokeWidth={1.4} />
              </g>
            ))}

            {pts.map((v, i) => (
              <g key={i}>
                {(p.grudados[i] || i === p.arrastoVertice) && <circle cx={v.x} cy={v.y} r={13} fill="none" stroke={COR_DESENHO.ima} strokeWidth={2} strokeOpacity={0.85} />}
                {i === hv && <circle cx={v.x} cy={v.y} r={18} fill="#ffffff" fillOpacity={0.18} />}
                <circle cx={v.x} cy={v.y} r={6.5} fill="#ffffff" stroke={COR_DESENHO.contorno} strokeWidth={1.8} />
              </g>
            ))}

            {ima && raw && cur && (
              <g>
                <line x1={raw.x} y1={raw.y} x2={cur.x} y2={cur.y} stroke={COR_DESENHO.ima} strokeWidth={1.6} strokeDasharray="3 3" strokeOpacity={0.9} />
                <circle cx={raw.x} cy={raw.y} r={4} fill="none" stroke="#ffffff" strokeWidth={1.6} strokeOpacity={0.7} />
                <circle cx={cur.x} cy={cur.y} r={30} fill={COR_DESENHO.ima} fillOpacity={0.09} />
                <circle cx={cur.x} cy={cur.y} r={22} fill="none" stroke={COR_DESENHO.ima} strokeWidth={1.4} strokeOpacity={0.5} />
                <circle cx={cur.x} cy={cur.y} r={14} fill="none" stroke={COR_DESENHO.ima} strokeWidth={2.6} />
                <g stroke={COR_DESENHO.ima} strokeWidth={2.2} strokeLinecap="round">
                  <line x1={cur.x} y1={cur.y - 40} x2={cur.x} y2={cur.y - 22} />
                  <line x1={cur.x} y1={cur.y + 22} x2={cur.x} y2={cur.y + 40} />
                  <line x1={cur.x - 40} y1={cur.y} x2={cur.x - 22} y2={cur.y} />
                  <line x1={cur.x + 22} y1={cur.y} x2={cur.x + 40} y2={cur.y} />
                </g>
                <circle cx={cur.x} cy={cur.y} r={7} fill={ima.tipo === "fechar" ? COR_DESENHO.linha : COR_DESENHO.ima} stroke={COR_DESENHO.contorno} strokeWidth={1.8} />
              </g>
            )}

            {cur && !ima && !fechado && !arrastando && !p.hover && (
              <g>
                <circle cx={cur.x} cy={cur.y} r={9} fill="none" stroke="#ffffff" strokeWidth={2} strokeOpacity={0.85} />
                <circle cx={cur.x} cy={cur.y} r={2.4} fill="#ffffff" />
              </g>
            )}
          </svg>

          {/* medida de cada lado */}
          {p.lados.map((l, i) => (
            <div key={i} className="absolute -translate-x-1/2 -translate-y-full rounded bg-slate-900/80 px-1.5 py-px text-[11px] tabular-nums text-amber-100" style={{ left: l.px.x, top: l.px.y - 6 }} data-testid="mapa-lado">
              {num(Math.round(l.metros), 0)} m
            </div>
          ))}

          {/* área ao vivo no centro */}
          {p.centro && pts.length >= 3 && (
            <div className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border bg-slate-900/90 px-3 py-1 text-xs font-medium tabular-nums ${fechado ? "border-cyan-300 text-cyan-50" : "border-cyan-400/70 text-cyan-100"}`} style={{ left: p.centro.x, top: p.centro.y }}>
              Área: {num(p.areaHaAtual, 2)} ha
            </div>
          )}

          {/* rumo com Shift */}
          {p.travado && cur && p.rumo !== null && !fechado && (
            <div className="absolute -translate-x-1/2 -translate-y-full rounded bg-slate-900/80 px-1.5 py-px text-[11px] tabular-nums text-sky-100" style={{ left: cur.x, top: cur.y - 16 }} data-testid="mapa-rumo">{p.rumo}°</div>
          )}

          {/* dica do ímã */}
          {ima && cur && (
            <div className="absolute w-52 rounded-md border border-yellow-400 bg-slate-900/95 px-3 py-1.5 shadow" style={{ left: cur.x + 30, top: cur.y - 56 }} data-testid="mapa-ima-dica">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10.5px] font-bold uppercase tracking-wide text-yellow-400">{ima.tipo === "fechar" ? "Fechar aqui" : `Ímã — ${ima.tipo === "aresta" ? "aresta" : "vértice"}`}</span>
                <span className="text-[10.5px] tabular-nums text-yellow-200/70">puxou {puxou} px</span>
              </div>
              <div className="truncate text-xs text-amber-50">{ima.tipo === "fechar" ? "volta ao primeiro ponto" : `divisa de ${ima.de}`}</div>
            </div>
          )}

          {/* o que acontece se segurar aqui */}
          {afordancia && cur && (
            <div className="absolute whitespace-nowrap rounded-full border bg-slate-900/95 px-3 py-1 text-xs" style={{ left: cur.x + 22, top: cur.y + 16, borderColor: afordancia.cor, color: afordancia.cor }}>{afordancia.texto}</div>
          )}
        </>
      )}
    </div>
  );
}
