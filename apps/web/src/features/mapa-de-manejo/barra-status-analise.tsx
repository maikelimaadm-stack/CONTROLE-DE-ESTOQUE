"use client";
/**
 * Barra compacta persistente da análise em curso (MAPA-UX-FINAL Part B).
 * Distinta de "Atualizando mapa…" (leitura de rasters existentes).
 */
import * as React from "react";
import type { ConsultaDto } from "./consulta-satelite";
import { feitosDaConsulta, progressoDaConsulta, rotuloBarraAnalise, MSG_FILA_INDISPONIVEL } from "./operacao-analise";

export interface BarraStatusAnaliseProps {
  consulta: ConsultaDto;
  onAcompanhar: () => void;
  filaIndisponivel?: boolean;
}

export function BarraStatusAnalise({ consulta, onAcompanhar, filaIndisponivel }: BarraStatusAnaliseProps) {
  const feitos = feitosDaConsulta(consulta);
  const pct = progressoDaConsulta(consulta);
  return (
    <div className="pointer-events-auto flex max-w-[min(22rem,calc(100vw-2rem))] flex-col gap-0.5" data-testid="mapa-barra-analise">
      <button
        type="button"
        onClick={onAcompanhar}
        className="flex w-full items-center gap-2 rounded bg-slate-900/90 px-2.5 py-1.5 text-left text-xs text-white shadow-sm hover:bg-slate-800"
        data-testid="mapa-barra-analise-btn"
        title="Abrir o acompanhamento da análise"
      >
        <span className="min-w-0 flex-1 truncate font-medium tabular-nums" data-testid="mapa-barra-analise-rotulo">
          {rotuloBarraAnalise(consulta)}
        </span>
        <span className="shrink-0 tabular-nums text-slate-300" data-testid="mapa-barra-analise-pct">{pct}%</span>
      </button>
      <div className="h-1 w-full overflow-hidden rounded bg-slate-300/80" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progresso da análise">
        <div className="h-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} data-testid="mapa-barra-analise-trilha" />
      </div>
      <span className="sr-only">{feitos} de {consulta.total_itens} análises</span>
      {filaIndisponivel && (
        <p className="rounded bg-amber-50/95 px-2 py-1 text-[11px] text-amber-800 shadow-sm" data-testid="mapa-fila-indisponivel" role="status">
          {MSG_FILA_INDISPONIVEL}
        </p>
      )}
    </div>
  );
}

/** Indicador de leitura de rasters existentes — não confundir com análise em curso. */
export function AvisoAtualizandoMapa({ visivel }: { visivel: boolean }) {
  if (!visivel) return null;
  return (
    <div className="rounded bg-white/90 px-2 py-1 text-xs text-slate-600 shadow-sm" data-testid="mapa-atualizando">
      Atualizando mapa…
    </div>
  );
}
