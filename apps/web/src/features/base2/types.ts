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
 * Não existe `total` de coluna: ver `items.tsx` e docs/MODELO-BASE2-CONTRACT.md § Totais. O total do
 * documento é um CAMPO do cabeçalho, porque em documento fiscal ele inclui valores que não estão em
 * linha nenhuma (frete, outras despesas) — e pôr esse número sob a coluna de totais dos itens faz a
 * coluna não fechar.
 */
export interface Base2ItemColumn<T> {
  key: string;
  label: string;
  align?: Base2Align;
  render?: (row: T) => React.ReactNode;
}

/** Identificação do registro para o HISTÓRICO oficial (`features/base1/history-dialog`). */
export interface Base2Historico {
  /** Nome da tabela, como o backend grava em `erp.audit_logs.entity`. */
  entidade: string;
  /** UUID do registro. Ausente enquanto não há registro salvo. */
  id?: string;
}


/**
 * Identificação do registro para os ANEXOS oficiais (`features/base1/attachments-dialog`).
 *
 * `entidade` é o nome da tabela e precisa estar em `ATTACHMENT_PARENTS` no servidor — a whitelist é a
 * autoridade, não esta prop. Declarar aqui uma entidade que o servidor não aceita produz um botão que
 * aparece e não funciona (422 ao abrir), que é pior do que botão nenhum.
 */
export interface Base2Anexos {
  entidade: string;
  /** UUID do registro salvo. Sem ele não há do que pendurar anexo. */
  id: string;
}
