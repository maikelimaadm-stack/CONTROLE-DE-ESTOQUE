"use client";
import * as React from "react";
import { Check, Magnet } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { cn, num } from "@/lib/utils";
import { TOLERANCIAS_RAPIDAS, TOLERANCIA_MAX, TOLERANCIA_MIN, type ConfigIma, type PontoDesenho } from "./editor-desenho";

/**
 * MAPA-01 (decisão 289) — painel lateral do editor: ajuste do ímã, pontos da área nova e as ações
 * (Recomeçar · Cancelar · Fechar polígono / Gravar área). As FUNÇÕES são as do protótipo aprovado; o visual é o
 * do produto (primitives de @/components/ui).
 */

interface Props {
  cfg: ConfigIma;
  onCfg: (mudanca: Partial<ConfigIma>) => void;
  metrosPorPx: number;
  pontos: PontoDesenho[];
  arrastoVertice: number;
  fechado: boolean;
  onRecomecar: () => void;
  onCancelar: () => void;
  onConfirmar: () => void;
}

const ROTULO_ORIGEM = { livre: "LIVRE", vertice: "VÉRTICE", aresta: "ARESTA" } as const;

export function PainelDesenho(p: Props) {
  const { cfg } = p;
  const metros = (px: number) => num(Math.round(px * p.metrosPorPx), 0);
  const [texto, setTexto] = React.useState(String(cfg.tolerancia));
  React.useEffect(() => { setTexto(String(cfg.tolerancia)); }, [cfg.tolerancia]);

  function aoDigitar(v: string) {
    setTexto(v);
    if (v.trim() === "") return;
    const n = Number.parseInt(v, 10);
    if (Number.isNaN(n)) return;
    p.onCfg({ tolerancia: Math.max(TOLERANCIA_MIN, Math.min(TOLERANCIA_MAX, n)) });
  }

  const confirmar = p.fechado ? "Gravar área" : p.pontos.length >= 3 ? "Fechar polígono" : "Marque 3 pontos";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="mapa-painel-desenho">
      {/* Ímã */}
      <section className="flex flex-col gap-2 border-b border-slate-200 pb-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ímã</span>
          <span className="text-[11px] tabular-nums text-slate-400">{cfg.tolerancia} px ≈ {metros(cfg.tolerancia)} m neste zoom</span>
        </div>
        <Button type="button" variant={cfg.ligado ? "default" : "outline"} className="justify-start" onClick={() => p.onCfg({ ligado: !cfg.ligado })} aria-pressed={cfg.ligado} data-testid="mapa-ima-alternar">
          <Magnet className="h-4 w-4" aria-hidden />
          <span className="flex-1 text-left">{cfg.ligado ? "Ímã ligado" : "Ímã desligado"}</span>
          <span className="text-[11px] opacity-80">{cfg.ligado ? `${cfg.tolerancia} px` : "clique para ligar"}</span>
        </Button>
        <div className="flex items-center gap-1.5">
          <div className="relative w-24 shrink-0">
            <Input type="number" min={TOLERANCIA_MIN} max={TOLERANCIA_MAX} step={1} value={texto} onChange={(e) => aoDigitar(e.target.value)} onBlur={() => setTexto(String(cfg.tolerancia))} aria-label="Distância do ímã em pixels" className="pr-8 tabular-nums" data-testid="mapa-ima-tolerancia" />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">px</span>
          </div>
          {TOLERANCIAS_RAPIDAS.map((t) => (
            <Button key={t} type="button" size="sm" variant={cfg.tolerancia === t ? "secondary" : "outline"} className="flex-1 tabular-nums" onClick={() => p.onCfg({ tolerancia: t })} aria-pressed={cfg.tolerancia === t}>{t}</Button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <Button type="button" size="sm" variant={cfg.vertice ? "secondary" : "outline"} className="flex-1" onClick={() => p.onCfg({ vertice: !cfg.vertice })} aria-pressed={cfg.vertice} data-testid="mapa-ima-vertice">Vértice</Button>
          <Button type="button" size="sm" variant={cfg.aresta ? "secondary" : "outline"} className="flex-1" onClick={() => p.onCfg({ aresta: !cfg.aresta })} aria-pressed={cfg.aresta} data-testid="mapa-ima-aresta">Aresta</Button>
        </div>
      </section>

      {/* Pontos da área nova */}
      <section className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto">
        {p.pontos.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
            Clique no mapa para o primeiro ponto. Chegue perto da divisa de uma área e o ímã gruda sozinho.
          </p>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pontos da área nova</span>
              <span className="text-[11px] tabular-nums text-slate-400">{p.pontos.length}</span>
            </div>
            <ol className="flex flex-col gap-1">
              {p.pontos.map((pt, i) => {
                const origem = pt.grudado && pt.tipo ? pt.tipo : "livre";
                return (
                  <li key={i} data-testid="mapa-ponto" data-origem={origem}
                    className={cn("flex items-center gap-2 rounded-md border px-2 py-1", i === p.arrastoVertice ? "border-yellow-400 bg-yellow-50" : "border-slate-200 bg-white")}>
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] tabular-nums text-slate-500">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] tabular-nums text-slate-600">{num(pt.lat, 5)} · {num(pt.lng, 5)}</span>
                    <span className={cn("rounded-full px-2 py-px text-[9.5px] font-bold", origem === "livre" ? "bg-slate-100 text-slate-500" : "bg-yellow-400 text-slate-900")}>{ROTULO_ORIGEM[origem]}</span>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </section>

      {/* Ações */}
      <div className="flex shrink-0 flex-col gap-1.5 border-t border-slate-200 pt-3">
        <Button type="button" className="w-full justify-center" onClick={p.onConfirmar} disabled={!p.fechado && p.pontos.length < 3} data-testid="mapa-confirmar">
          <Check className="h-4 w-4" aria-hidden />{confirmar}
        </Button>
        <div className="flex gap-1.5">
          <Button type="button" variant="ghost" className="flex-1" onClick={p.onRecomecar} data-testid="mapa-recomecar">Recomeçar</Button>
          <Button type="button" variant="ghost" className="flex-1" onClick={p.onCancelar} data-testid="mapa-cancelar-desenho">Cancelar</Button>
        </div>
      </div>
    </div>
  );
}
