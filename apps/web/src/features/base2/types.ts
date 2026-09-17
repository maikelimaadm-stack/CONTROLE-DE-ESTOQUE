/**
 * CONTRATO DE TIPOS DO MODELO BASE 2 (docs/MODELO-BASE2-CONTRACT.md).
 *
 * A moldura é de APRESENTAÇÃO. Nada aqui carrega regra de negócio: não há tipo de operação, não há
 * enumeração de módulo, não há mapa de efeito contábil. Quem sabe o que um lançamento significa é o
 * módulo dono dele; a moldura só sabe DESENHAR o que recebe.
 */
import type * as React from "react";

/** Alinhamento de célula. `right` é para número (a classe `num` já traz `tabular-nums`). */
export type Base2Align = "left" | "right" | "center";

/** Larguras válidas de um campo na grade de 12 colunas dos dados principais. */
export type Base2Span = 1 | 2 | 3 | 4 | 6 | 12;

/**
 * Um campo do bloco de DADOS PRINCIPAIS.
 *
 * `valor` é um nó já formatado pelo chamador (`brl`, `num`, `dateBR`, `enumLabel`…). A moldura não
 * formata moeda nem data: formatar aqui criaria uma segunda política de formatação ao lado de
 * `lib/utils.ts`, e as duas divergiriam na primeira exceção.
 */
export interface Base2Field {
  label: string;
  valor: React.ReactNode;
  span?: Base2Span;
  /** Campo ausente some em vez de exibir travessão (opcional do documento, não campo vazio). */
  ocultarSeVazio?: boolean;
}

/**
 * Coluna da tabela de ITENS.
 *
 * `total` é opcional e recebe as linhas, mas existe para o chamador devolver o total que o SERVIDOR
 * calculou — não para a moldura somar. Ver docs/MODELO-BASE2-CONTRACT.md § Totais: cliente que soma
 * item a item vira uma segunda autoridade contábil, e ela diverge do backend na primeira regra de
 * arredondamento, desconto ou rateio.
 */
export interface Base2ItemColumn<T> {
  key: string;
  label: string;
  align?: Base2Align;
  render?: (row: T) => React.ReactNode;
  /** Célula do rodapé, sob esta mesma coluna. Sem `total`, a célula do rodapé fica vazia. */
  total?: (rows: readonly T[]) => React.ReactNode;
}

/** Identificação do registro para o HISTÓRICO oficial (`features/base1/history-dialog`). */
export interface Base2Historico {
  /** Nome da tabela, como o backend grava em `erp.audit_logs.entity`. */
  entidade: string;
  /** UUID do registro. Ausente enquanto não há registro salvo. */
  id?: string;
}

/** Identificação do registro para os ANEXOS oficiais (`features/base1/attachments-dialog`). */
export interface Base2Anexos {
  /** Nome da tabela. Precisa estar em `ATTACHMENT_PARENTS` no servidor, senão a API recusa com 422. */
  entidade: string;
  id?: string | null;
}
