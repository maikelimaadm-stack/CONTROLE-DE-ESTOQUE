"use client";
import * as React from "react";
import { MODOS_DE_COLORACAO, type ModoDeColoracao } from "@agro/domain";
import { NativeSelect } from "@/components/ui";
import { enumLabel } from "@/lib/copy";
import { cn } from "@/lib/utils";

/**
 * MAPA-MANEJO-04 (F2) — "Colorir por": os modos de coloração do mapa operacional.
 *
 * A lista é a do domínio (`MODOS_DE_COLORACAO`) e o texto de cada modo é o de `labels.ts` (`enumLabel`); a tela não
 * redigita nenhum dos dois. O valor escolhido vai como `?coloracao=` para a API. Valor fora da lista é ignorado.
 */

const ehModo = (v: string): v is ModoDeColoracao => (MODOS_DE_COLORACAO as readonly string[]).includes(v);

export interface SeletorDeColoracaoProps {
  valor: ModoDeColoracao;
  aoMudar: (modo: ModoDeColoracao) => void;
  className?: string;
}

export function SeletorDeColoracao({ valor, aoMudar, className }: SeletorDeColoracaoProps) {
  const id = React.useId();
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <label htmlFor={id} className="whitespace-nowrap text-xs font-medium text-slate-600">Colorir por</label>
      <NativeSelect
        id={id}
        value={valor}
        onChange={(e) => { if (ehModo(e.target.value)) aoMudar(e.target.value); }}
        data-testid="seletor-coloracao"
        className="!min-h-11 !w-auto min-w-[10rem] text-xs sm:!min-h-0"
      >
        {MODOS_DE_COLORACAO.map((m) => (
          <option key={m} value={m}>{enumLabel("modo_de_coloracao", m)}</option>
        ))}
      </NativeSelect>
    </div>
  );
}
