"use client";
import * as React from "react";
import { Button, Input } from "@/components/ui";
import { num } from "@/lib/utils";
import { TOLERANCIAS_RAPIDAS, TOLERANCIA_MAX, TOLERANCIA_MIN, type ConfigIma } from "./editor-desenho";

/**
 * Escolha da distância do ímã — fica sob o botão Refazer. Sem liga/desliga: o ímã permanece ativo.
 */

interface Props {
  cfg: ConfigIma;
  onCfg: (m: Partial<ConfigIma>) => void;
  metrosPorPx: number;
}

export function BarraIma(p: Props) {
  const [texto, setTexto] = React.useState(String(p.cfg.tolerancia));
  React.useEffect(() => { setTexto(String(p.cfg.tolerancia)); }, [p.cfg.tolerancia]);

  function aoDigitar(v: string) {
    setTexto(v);
    if (v.trim() === "") return;
    const n = Number.parseInt(v, 10);
    if (Number.isNaN(n)) return;
    p.onCfg({ tolerancia: Math.max(TOLERANCIA_MIN, Math.min(TOLERANCIA_MAX, n)) });
  }

  return (
    <div className="flex w-36 flex-col gap-1 rounded-md border border-emerald-200 bg-white/95 p-1.5 shadow-sm" data-testid="mapa-barra-ima">
      <div className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
        Ímã · {p.cfg.tolerancia} px ≈ {num(Math.round(p.cfg.tolerancia * p.metrosPorPx), 0)} m
      </div>
      <div className="relative">
        <Input
          type="number"
          min={TOLERANCIA_MIN}
          max={TOLERANCIA_MAX}
          step={1}
          value={texto}
          onChange={(e) => aoDigitar(e.target.value)}
          onBlur={() => setTexto(String(p.cfg.tolerancia))}
          aria-label="Distância do ímã em pixels"
          className="h-7 pr-7 text-xs tabular-nums"
          data-testid="mapa-ima-tolerancia"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">px</span>
      </div>
      <div className="grid grid-cols-4 gap-0.5">
        {TOLERANCIAS_RAPIDAS.map((t) => (
          <Button
            key={t}
            type="button"
            size="sm"
            variant={p.cfg.tolerancia === t ? "secondary" : "outline"}
            className="h-6 px-0 text-[10px] tabular-nums"
            onClick={() => p.onCfg({ tolerancia: t })}
            aria-pressed={p.cfg.tolerancia === t}
          >
            {t}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-0.5">
        <Button type="button" size="sm" variant={p.cfg.vertice ? "secondary" : "outline"} className="h-6 text-[10px]" onClick={() => p.onCfg({ vertice: !p.cfg.vertice })} aria-pressed={p.cfg.vertice} data-testid="mapa-ima-vertice">Vértice</Button>
        <Button type="button" size="sm" variant={p.cfg.aresta ? "secondary" : "outline"} className="h-6 text-[10px]" onClick={() => p.onCfg({ aresta: !p.cfg.aresta })} aria-pressed={p.cfg.aresta} data-testid="mapa-ima-aresta">Aresta</Button>
      </div>
    </div>
  );
}
