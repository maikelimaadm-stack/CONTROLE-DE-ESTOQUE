"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * SEÇÃO DO MODELO BASE 2 — um bloco titulado dentro do lançamento (Itens, Totais, Rateio, Histórico…).
 *
 * Existe porque o título de seção era um literal repetido: `<h3 className="text-xs font-semibold
 * uppercase text-brand-700">` aparece 23 vezes em 16 arquivos na `main` desta fatia. Literal repetido
 * não envelhece com barulho — ele envelhece em silêncio, e a vigésima quarta tela copia a vigésima
 * terceira. Aqui o estilo tem um dono.
 *
 * `contagem` mostra quantos registros a seção tem, ao lado do título. É informação de leitura, não
 * filtro: a moldura não conta nada que o chamador não tenha passado.
 */
export interface Base2SectionProps {
  titulo: string;
  /** Quantidade de linhas da seção (ex.: itens). Zero é exibido — "0 itens" é um fato, não um vazio. */
  contagem?: number;
  /** Ações da seção (ex.: abrir o histórico). Some na impressão, como as demais ações. */
  acoes?: React.ReactNode;
  descricao?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}

export function Base2Section({ titulo, contagem, acoes, descricao, children, className, testId = "base2-section" }: Base2SectionProps) {
  const headingId = React.useId();
  return (
    <section className={cn("space-y-1.5", className)} data-testid={testId} data-secao={titulo} aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={headingId} className="text-xs font-semibold uppercase text-brand-700">{titulo}</h3>
        {/* o `data-testid` fica no NÚMERO; a leitura acessível é irmã dele. Pôr as duas coisas no mesmo
            elemento faz o texto acessível vazar para quem lê o número — foi assim que o e2e quebrou. */}
        {contagem !== undefined && <span className="text-[11px] tabular-nums text-slate-400">
          <span data-testid="base2-section-contagem">{contagem}</span>
          <span className="sr-only">{contagem === 1 ? " registro nesta seção" : " registros nesta seção"}</span>
        </span>}
        {acoes && <span className="ml-auto flex items-center gap-1.5 no-print">{acoes}</span>}
      </div>
      {descricao && <p className="text-[11px] text-slate-500">{descricao}</p>}
      {children}
    </section>
  );
}
