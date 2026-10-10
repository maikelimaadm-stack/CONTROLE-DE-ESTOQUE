"use client";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import type { ModoDeColoracao } from "@agro/domain";
import { Button } from "@/components/ui";
import { enumLabel } from "@/lib/copy";
import { cn, num } from "@/lib/utils";
import type { FaixaPresente } from "./coloracao-no-mapa";

/**
 * MAPA-MANEJO-04 (F2) — a legenda da coloração do mapa operacional.
 *
 * Só aparece quando a coloração não é `padrao`. Cada faixa mostra a amostra de cor E o texto (rótulo + quantidade de
 * áreas): cor nunca carrega significado sozinha. Clicar numa faixa filtra (as áreas das outras ficam atenuadas);
 * clicar de novo tira o filtro. Colapsável pelo botão "Legenda".
 */

/** Onde a legenda fica sobre o mapa: canto inferior esquerdo, acima dos rótulos das áreas (z 100 na camada de desenho). */
export const POSICAO_DA_LEGENDA = "pointer-events-auto absolute bottom-2 left-2 z-[101]";

export interface LegendaDoMapaProps {
  modo: ModoDeColoracao;
  /** `coloracaoDasAreas(...).faixasPresentes`. */
  faixas: readonly FaixaPresente[];
  /** O filtro em vigor (`coloracaoDasAreas(...).filtroAplicado`); `null` sem filtro. */
  faixaFiltro: string | null;
  aoFiltrar: (chave: string | null) => void;
  className?: string;
}

export function LegendaDoMapa({ modo, faixas, faixaFiltro, aoFiltrar, className }: LegendaDoMapaProps) {
  const [aberta, setAberta] = React.useState(true);
  const idDaLista = React.useId();
  if (modo === "padrao") return null;
  const rotuloDoModo = enumLabel("modo_de_coloracao", modo);

  return (
    <section
      aria-label="Legenda do mapa"
      data-testid="legenda-do-mapa"
      className={cn("w-[min(17rem,calc(100vw-2rem))] rounded-md border border-slate-200 bg-white/95 p-1.5 text-xs shadow-sm", className)}
    >
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="!min-h-11 sm:!min-h-0"
          aria-expanded={aberta}
          aria-controls={idDaLista}
          onClick={() => setAberta((v) => !v)}
          data-testid="legenda-do-mapa-alternar"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !aberta && "-rotate-90")} aria-hidden />
          Legenda
        </Button>
        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500" data-testid="legenda-do-mapa-modo">{rotuloDoModo}</span>
      </div>

      <div id={idDaLista} hidden={!aberta}>
        {faixas.length === 0 ? (
          <p className="px-1.5 py-1 text-slate-500" data-testid="legenda-do-mapa-vazia">Nenhuma área com contorno para colorir.</p>
        ) : (
          <ul className="flex max-h-[min(40dvh,18rem)] flex-col gap-0.5 overflow-y-auto overscroll-contain" aria-label={`Faixas de ${rotuloDoModo}`}>
            {faixas.map((f) => {
              const ativa = faixaFiltro === f.chave;
              const atenuada = faixaFiltro !== null && !ativa;
              return (
                <li key={f.chave}>
                  <button
                    type="button"
                    aria-pressed={ativa}
                    title={f.rotulo}
                    onClick={() => aoFiltrar(ativa ? null : f.chave)}
                    data-testid={`legenda-faixa-${f.chave}`}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-2 rounded px-1.5 py-0.5 text-left hover:bg-slate-100 sm:min-h-0",
                      ativa && "bg-slate-100 ring-1 ring-slate-300",
                      atenuada && "opacity-60"
                    )}
                  >
                    <span className="h-3 w-3 shrink-0 rounded-sm border border-slate-300" style={{ backgroundColor: f.cor }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-slate-700">{f.rotulo}</span>
                    <span className="tabular-nums font-medium text-slate-600" data-testid={`legenda-quantidade-${f.chave}`}>
                      {num(f.quantidade, 0)}
                      <span className="sr-only"> {f.quantidade === 1 ? "área" : "áreas"}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {faixaFiltro !== null && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-0.5 w-full !min-h-11 sm:!min-h-0"
            onClick={() => aoFiltrar(null)}
            data-testid="legenda-limpar-filtro"
          >
            Mostrar todas as faixas
          </Button>
        )}
      </div>
    </section>
  );
}
