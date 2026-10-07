"use client";
import * as React from "react";
import { faixasDoTema, type TemaMapaPasto } from "./temas-mapa-pasto";

const TITULO: Record<Exclude<TemaMapaPasto, "condicao">, string> = {
  umidade: "Umidade (NDMI)",
  vigor: "Vigor (NDRE)",
  cobertura: "Cobertura (MSAVI2)",
  solo: "Solo (BSI)"
};

export function LegendaTemaPasto({
  tema,
  faixaAtiva,
  onFaixa
}: {
  tema: TemaMapaPasto;
  faixaAtiva?: string | null;
  onFaixa?: (id: string | null) => void;
}) {
  if (tema === "condicao") return null;
  const faixas = faixasDoTema(tema);
  if (!faixas) return null;
  return (
    <div
      className="rounded-md border border-slate-200 bg-white/95 p-2 shadow-sm"
      data-testid="mapa-legenda-tema"
      aria-label={`Legenda ${TITULO[tema]}`}
    >
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{TITULO[tema]}</div>
      <ul className="flex flex-col gap-0.5">
        {faixas.map((f) => {
          const ativa = faixaAtiva === f.id;
          const opaca = faixaAtiva !== null && faixaAtiva !== undefined && !ativa;
          return (
            <li key={f.id}>
              <button
                type="button"
                data-testid={`mapa-legenda-faixa-${f.id}`}
                aria-pressed={ativa}
                onClick={() => onFaixa?.(ativa ? null : f.id)}
                className={`flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs ${opaca ? "opacity-40" : ""} hover:bg-slate-50`}
              >
                <span className="h-3 w-3 shrink-0 rounded-sm border border-slate-300" style={{ backgroundColor: f.cor }} aria-hidden />
                <span className="text-slate-700">{f.rotulo}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-[10px] leading-snug text-slate-400">
        Análise em grade de 20 m; contornos suavizados só para visualização.
      </p>
    </div>
  );
}
