"use client";
import { Magnet, Ruler } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Ferramentas sob Refazer: ímã (liga/desliga) e metragem dos lados (mostrar/ocultar).
 */

interface Props {
  ligado: boolean;
  onToggle: () => void;
  metragem: boolean;
  onToggleMetragem: () => void;
}

export function BarraIma(p: Props) {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-white/95 p-1 shadow-sm" data-testid="mapa-barra-ima">
      <button
        type="button"
        onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); p.onToggle(); }}
        aria-pressed={p.ligado}
        aria-label={p.ligado ? "Desligar ímã" : "Ligar ímã"}
        title={p.ligado ? "Ímã ligado — clique para desligar" : "Ímã desligado — clique para ligar"}
        data-testid="mapa-ima-toggle"
        data-ligado={p.ligado ? "1" : "0"}
        className={cn("tb-btn tb-btn-icon focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400", p.ligado && "is-active")}
      >
        <Magnet aria-hidden />
      </button>
      <button
        type="button"
        onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); p.onToggleMetragem(); }}
        aria-pressed={p.metragem}
        aria-label={p.metragem ? "Ocultar metragem" : "Mostrar metragem"}
        title={p.metragem ? "Metragem visível — clique para ocultar" : "Mostrar metragem"}
        data-testid="mapa-metragem-toggle"
        data-ligado={p.metragem ? "1" : "0"}
        className={cn("tb-btn tb-btn-icon focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400", p.metragem && "is-active")}
      >
        <Ruler aria-hidden />
      </button>
    </div>
  );
}
