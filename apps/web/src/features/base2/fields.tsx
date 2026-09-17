"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import type { Base2Field, Base2Span } from "./types";

/** Vazio = sem informação a mostrar. `0` e `false` NÃO são vazios: são valores do lançamento. */
function vazio(v: React.ReactNode): boolean {
  return v === null || v === undefined || v === "" || (typeof v === "string" && v.trim() === "");
}

const SPANS: Record<Base2Span, string> = {
  1: "md:col-span-1", 2: "md:col-span-2", 3: "md:col-span-3",
  4: "md:col-span-4", 6: "md:col-span-6", 12: "md:col-span-12"
};

/**
 * DADOS PRINCIPAIS do lançamento — a lista de definição (`<dl>`) do cabeçalho.
 *
 * Sucessor declarativo do `KV` de `features/docs/shared`. Três diferenças que são o motivo de existir:
 *
 *  1. **Vazio vira travessão de verdade.** O `KV` escrevia `{v ?? "—"}`, mas as telas já chegavam com
 *     `String(d["campo"] ?? "")` — ou seja, `null` virava `""` antes, o `??` não pegava e o campo saía
 *     em branco. Um campo em branco e um campo com valor apagado são indistinguíveis para quem lê.
 *  2. **Largura por campo.** Observação e justificativa são frases; código e data são palavras. Na
 *     grade fixa de 4 colunas do `KV`, a frase era truncada junto com o código.
 *  3. **Campo opcional pode sumir** (`ocultarSeVazio`) em vez de ocupar uma célula com travessão.
 *
 * Só apresentação: não decide o que é obrigatório, não valida, não sabe o que os campos significam.
 */
export interface Base2FieldsProps {
  campos: readonly Base2Field[];
  className?: string;
  testId?: string;
}

export function Base2Fields({ campos, className, testId = "base2-fields" }: Base2FieldsProps) {
  const visiveis = campos.filter((c) => !(c.ocultarSeVazio && vazio(c.valor)));
  if (visiveis.length === 0) return null;
  return (
    <dl className={cn("grid grid-cols-12 gap-x-4 gap-y-2 text-[12.5px]", className)} data-testid={testId}>
      {visiveis.map((c) => (
        <div key={c.label} className={cn("col-span-12 min-w-0", SPANS[c.span ?? 3])} data-testid="base2-field" data-campo={c.label}>
          <dt className="text-[10.5px] font-semibold uppercase leading-tight text-slate-500">{c.label}</dt>
          <dd className="min-w-0 break-words">{vazio(c.valor) ? <span className="text-slate-400">—</span> : c.valor}</dd>
        </div>
      ))}
    </dl>
  );
}
