"use client";
import { Magnet } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Ícone do ímã sob Refazer — clique liga/desliga. Tolerância fixa (8 px), vértice+aresta sempre.
 */

interface Props {
  ligado: boolean;
  onToggle: () => void;
}

export function BarraIma(p: Props) {
  return (
    <div className="rounded-md bg-white/95 p-1 shadow-sm" data-testid="mapa-barra-ima">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={p.onToggle}
        aria-pressed={p.ligado}
        aria-label={p.ligado ? "Desligar ímã" : "Ligar ímã"}
        title={p.ligado ? "Ímã ligado — clique para desligar" : "Ímã desligado — clique para ligar"}
        data-testid="mapa-ima-toggle"
        className={cn(
          "h-8 w-8",
          p.ligado ? "text-emerald-600 hover:text-emerald-700" : "text-slate-400 hover:text-slate-500"
        )}
      >
        <Magnet className="h-4 w-4" strokeWidth={2.25} aria-hidden />
      </Button>
    </div>
  );
}
