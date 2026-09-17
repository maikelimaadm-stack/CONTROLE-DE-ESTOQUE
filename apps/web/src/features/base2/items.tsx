"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui";
import { COPY } from "@/lib/copy";
import type { Base2ItemColumn } from "./types";

/**
 * TABELA DE ITENS DO LANÇAMENTO, em leitura — a metade de leitura do `ItemsTable` que o
 * `docs/UI-STANDARD.md` § "ItemsTable (contrato desejado)" descrevia sem implementação. A metade de
 * EDIÇÃO continua em cada editor do módulo; unificar edição é fatia própria.
 *
 * SEM RODAPÉ DE TOTAIS, e isso foi MEDIDO, não suposto (ver docs/MODELO-BASE2-CONTRACT.md § Totais e a
 * decisão 151, retratada). A primeira versão desta moldura punha o total do documento sob a coluna de
 * total dos itens. Parecia seguro — era o número do servidor, alinhado por construção. Não é:
 *
 *  - numa NOTA FISCAL o total do documento é `produtos − desconto + IPI + frete + outras despesas`
 *    (`apps/api/src/routes/stock.ts:194`), enquanto a linha é `qtd × unitário − desconto + IPI`
 *    (`:201`). Uma nota com R$ 10.000,00 em itens e R$ 500,00 de frete mostraria a coluna somando
 *    10.000 e, logo abaixo dela, em negrito, 10.500;
 *  - numa BATIDA não existe total de documento nenhum (só `production_cost`), e o rodapé saía "—",
 *    que numa coluna de dinheiro se lê como zero.
 *
 * E o cliente também não pode somar a coluna: `CLAUDE.md` proíbe ponto flutuante para dinheiro e o
 * `apps/web` não tem `decimal.js`. Não sobra forma correta de produzir um subtotal aqui — então não se
 * produz. O total do DOCUMENTO é um campo do cabeçalho, onde o rótulo diz de que total se trata.
 */
export interface Base2ItemsProps<T> {
  colunas: readonly Base2ItemColumn<T>[];
  linhas: readonly T[];
  /** Chave estável da linha. Padrão: campo `id`, senão o índice. */
  rowKey?: (row: T, index: number) => string;
  /** Resumo da tabela para leitor de tela. Obrigatório quando há mais de uma tabela na tela. */
  legenda?: string;
  vazioTexto?: string;
  className?: string;
  testId?: string;
}

export function Base2Items<T extends Record<string, unknown>>({
  colunas, linhas, rowKey, legenda, vazioTexto = COPY.nenhumItem, className, testId = "base2-items"
}: Base2ItemsProps<T>) {
  const chave = React.useCallback((r: T, i: number) => (rowKey ? rowKey(r, i) : String(r["id"] ?? i)), [rowKey]);

  if (linhas.length === 0) return <div className={cn("rounded border", className)} data-testid={testId} data-vazio="sim"><EmptyState title={vazioTexto} compact /></div>;

  return (
    <div className={cn("overflow-x-auto rounded border", className)} data-testid={testId}>
      <table className="table-dense w-full text-[12.5px]">
        {legenda && <caption className="sr-only">{legenda}</caption>}
        <thead>
          <tr>{colunas.map((c) => <th key={c.key} scope="col" className={c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : ""}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {linhas.map((r, i) => (
            <tr key={chave(r, i)} data-testid="base2-items-linha">
              {colunas.map((c) => (
                <td key={c.key} className={c.align === "right" ? "num" : c.align === "center" ? "text-center" : ""}>
                  {c.render ? c.render(r) : String(r[c.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
