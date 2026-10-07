"use client";
import * as React from "react";
import { Button, Dialog } from "@/components/ui";
import { num } from "@/lib/utils";
import { agregarFaixaTema, type AreaParaAgregado } from "./agregar-faixa-tema";
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
  onFaixa,
  areas
}: {
  tema: TemaMapaPasto;
  faixaAtiva?: string | null;
  onFaixa?: (id: string | null) => void;
  /** Áreas com médias do bulk — para o resumo agregado (zero POST). */
  areas?: readonly AreaParaAgregado[];
}) {
  if (tema === "condicao") return null;
  const faixas = faixasDoTema(tema);
  if (!faixas) return null;
  const agregado = faixaAtiva && areas
    ? agregarFaixaTema({ tema, faixaId: faixaAtiva, areas })
    : null;

  return (
    <>
      <div
        className="rounded-md border border-slate-200 bg-white/95 p-2 shadow-sm"
        data-testid="mapa-legenda-tema"
        aria-label={`Legenda ${TITULO[tema]}`}
      >
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{TITULO[tema]}</div>
        <ul className="flex flex-col gap-0.5" role="list">
          {faixas.map((f) => {
            const ativa = faixaAtiva === f.id;
            const opaca = faixaAtiva !== null && faixaAtiva !== undefined && !ativa;
            return (
              <li key={f.id}>
                <button
                  type="button"
                  data-testid={`mapa-legenda-faixa-${f.id}`}
                  aria-pressed={ativa}
                  aria-label={`${f.rotulo}${ativa ? " (selecionada)" : ""}`}
                  onClick={() => onFaixa?.(ativa ? null : f.id)}
                  className={`flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-800 ${opaca ? "opacity-40" : ""} hover:bg-slate-50`}
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

      <Dialog
        key={faixaAtiva ?? "nenhuma"}
        open={Boolean(faixaAtiva && agregado)}
        onOpenChange={(o) => { if (!o) onFaixa?.(null); }}
        title={agregado ? agregado.rotulo.toUpperCase() : "Faixa"}
        description="Áreas com essa faixa na observação atual (média do índice do tema)."
        size="md"
        profile="content"
        testId="dialog-faixa-tema"
        footer={<Button type="button" variant="ghost" onClick={() => onFaixa?.(null)} data-testid="dialog-faixa-fechar">Fechar</Button>}
      >
        {agregado && (
          <div className="flex flex-col gap-1.5 text-sm" data-testid="painel-faixa-tema">
            <p className="tabular-nums text-slate-700">
              {num(agregado.ha, 1)} ha · {num(agregado.pct, 1)}% da área analisada · {agregado.pastos}{" "}
              {agregado.pastos === 1 ? "pasto afetado" : "pastos afetados"}
            </p>
            {agregado.principais.length > 0 && (
              <ol className="mt-1 flex flex-col gap-0.5 text-xs">
                {agregado.principais.map((x) => (
                  <li key={x.id} className="flex justify-between gap-2 tabular-nums">
                    <span className="truncate text-slate-700">{x.nome}</span>
                    <span>{num(x.ha, 1)} ha</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
