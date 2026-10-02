"use client";
import { Magnet } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Ícone do ímã sob Refazer — clique liga/desliga.
 * Botão nativo com `.tb-btn-icon` / `.is-active` (design system): ligado = verde, desligado = cinza.
 */

interface Props {
  ligado: boolean;
  onToggle: () => void;
}

export function BarraIma(p: Props) {
  return (
    <div className="rounded-md bg-white/95 p-1 shadow-sm" data-testid="mapa-barra-ima">
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
    </div>
  );
}
