"use client";
import { Magnet } from "lucide-react";

/**
 * Indicador do ímã — só o ícone, sob as ferramentas de desenho.
 * Sem liga/desliga, sem tolerância editável, sem Vértice/Aresta na UI: padrão fixo (8 px, vértice+aresta).
 */

export function BarraIma() {
  return (
    <div
      className="flex items-center justify-center rounded-md bg-white/95 p-1 shadow-sm"
      data-testid="mapa-barra-ima"
      title="Ímã ativo"
      aria-label="Ímã ativo"
    >
      <span className="inline-flex h-8 w-8 items-center justify-center text-emerald-600" aria-hidden>
        <Magnet className="h-4 w-4" strokeWidth={2.25} />
      </span>
    </div>
  );
}
