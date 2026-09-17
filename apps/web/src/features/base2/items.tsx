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
 * RODAPÉ ALINHADO POR CONSTRUÇÃO. O rodapé emite UMA célula por coluna, na mesma ordem do cabeçalho:
 * não existe `colSpan` para ficar desatualizado. Esse cuidado não é teórico — `components/ui/data-table.tsx`
 * carrega um comentário longo explicando que um `colSpan={8}` escrito à mão ficou para trás quando a
 * listagem de Animais ganhou a coluna de Empresa (PRE-BASE2-03) e a de ID Global (PRE-BASE2-05B.1), e o
 * total passou a aparecer sob a coluna errada. Aqui o erro é impossível: quem acrescenta uma coluna
 * acrescenta a célula do rodapé junto, porque é a mesma lista.
 *
 * A moldura NÃO SOMA. `total` devolve o que o servidor calculou (ver docs/MODELO-BASE2-CONTRACT.md
 * § Totais). Somar no cliente criaria uma segunda autoridade contábil, que diverge do backend na
 * primeira regra de arredondamento, desconto ou rateio — e a tela passaria a ser a versão "certa".
 */
export interface Base2ItemsProps<T> {
  colunas: readonly Base2ItemColumn<T>[];
  linhas: readonly T[];
  /** Chave estável da linha. Padrão: campo `id`, senão o índice. */
  rowKey?: (row: T, index: number) => string;
  /** Rótulo da primeira célula do rodapé. Só aparece quando a primeira coluna não tem total próprio. */
  rotuloTotais?: string;
  /** Resumo da tabela para leitor de tela. */
  legenda?: string;
  vazioTexto?: string;
  className?: string;
  testId?: string;
}

export function Base2Items<T extends Record<string, unknown>>({
  colunas, linhas, rowKey, rotuloTotais = "Totais", legenda, vazioTexto = COPY.nenhumItem, className, testId = "base2-items"
}: Base2ItemsProps<T>) {
  const temTotais = colunas.some((c) => c.total);
  // o rótulo só cabe na primeira célula quando aquela coluna não tem total próprio disputando o espaço
  const rotuloNaPrimeira = temTotais && !colunas[0]?.total;
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
        {temTotais && (
          <tfoot>
            <tr data-testid="base2-items-totais" className="font-semibold">
              {colunas.map((c, i) => {
                const conteudo = c.total ? c.total(linhas) : i === 0 && rotuloNaPrimeira ? rotuloTotais : null;
                const Cell = i === 0 && rotuloNaPrimeira ? "th" : "td";
                return <Cell key={c.key} {...(Cell === "th" ? { scope: "row" as const } : {})} className={c.align === "right" ? "num" : c.align === "center" ? "text-center" : ""}>{conteudo}</Cell>;
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
