"use client";
import * as React from "react";
import type { ColunaDoLayout } from "@agro/domain";
import { ItensDaCentral, type LayoutDosItens } from "@/features/central/itens";
import { PESQUISA_DE_PRODUTO_DA_SAIDA, type ChaveColunaDoItem, type ColunasDosItens, type ItensDaOrigem, type LocalDeEstoque } from "@/features/central/contrato";
import type { ItemRow } from "@/features/docs/shared";

/**
 * OS ITENS DOS MÓDULOS (OPERACOES-01 F10, decisão 287) — a grade do motor da Central para abastecimento, manutenção,
 * ordem de serviço (insumos e EPIs), batelada e produção de ração.
 *
 * É o ÚNICO arquivo dos módulos que importa o motor (`ItensDaCentral`): cada Central de módulo desenha a sua grade por
 * aqui, com o MESMO `items`/`onChange` da página. O que muda de um módulo para outro chega por props; o resto é fixo:
 *   · o layout é SEMPRE o mesmo — Local de estoque, Código, Produto, Estoque, [Saldo da origem], Quantidade, Valor
 *     unitário e Total, SEM desconto (nenhum módulo tem desconto); Produto e Quantidade obrigatórios;
 *   · os módulos SAEM do estoque: a pesquisa de produto vem com "Só com saldo neste local" (com a capacidade da
 *     pesquisa nova; sem ela, a de hoje);
 *   · o custo médio do local preenche o unitário vazio (o padrão do motor: a prévia do custo) — o custo final é o do
 *     servidor na hora de gravar;
 *   · os erros de item vêm em `items[<i>].<coluna>` (`produto`, `quantidade`, `armazem`, `unitario`).
 * `linhaUnica` (o abastecimento: uma linha, sem Adicionar, Duplicar e Remover) e `daOrigem` (batelada e ração: os
 * itens derivados da dieta ou da fórmula, quantidade travada) são do motor; `armazemPorItem={false}` tira a coluna do
 * local quando ele é o do cabeçalho.
 */

export interface PropsDosItensDoModulo {
  prefixoTestid: string;
  items: ItemRow[];
  onChange: (i: ItemRow[]) => void;
  /** Erros por caminho `items[<i>].<coluna>` (`produto`, `quantidade`, `armazem`, `unitario`). */
  erros?: Record<string, string>;
  /** O local de estoque das linhas NOVAS (o "Local de estoque" do cabeçalho). */
  armazemPadrao?: LocalDeEstoque | null;
  /** Coluna "Local de estoque" na linha. Padrão `true`; `false` nos itens derivados (o local é o do cabeçalho). */
  armazemPorItem?: boolean;
  /** Uma linha só, criada pela página (o abastecimento). Padrão `false`. */
  linhaUnica?: boolean;
  /** Os itens derivados da dieta ou da fórmula (quantidade travada). Ausente: itens livres. */
  daOrigem?: ItensDaOrigem | null;
  /** Rótulo da coluna Saldo no modo "da origem" ("Pela dieta (kg)", "Pela fórmula"). */
  rotuloDaOrigem?: string;
}

/** Catálogo dos módulos: a chave do catálogo é o nome da coluna do motor (os erros de item vêm por ela). */
const DO_CATALOGO: Readonly<Record<string, ChaveColunaDoItem>> = Object.freeze({
  armazem: "armazem", codigo: "codigo", produto: "produto", estoque: "estoque", saldo: "saldo",
  quantidade: "quantidade", unitario: "unitario", total: "total",
});

/** As colunas dos módulos: nenhuma "do sistema" (o "*" aparece onde o layout manda), nenhuma leitura (a consulta é do detalhe). */
export const COLUNAS_DO_MODULO: ColunasDosItens = Object.freeze({ doSistema: new Set<string>(), doCatalogo: DO_CATALOGO, leitura: [] });

const coluna = (campo: string, rotulo: string, obrigatorio = false): ColunaDoLayout => ({ campo, rotulo, obrigatorio });

/**
 * O layout fixo dos módulos — sem desconto. A coluna do local só com o local por linha; a do saldo da origem só no modo
 * "da origem".
 */
function layoutDoModulo(armazemPorItem: boolean, comOrigem: boolean, rotuloDaOrigem: string): LayoutDosItens {
  return {
    colunas: [
      ...(armazemPorItem ? [coluna("armazem", "Local de estoque")] : []),
      coluna("codigo", "Código"),
      coluna("produto", "Produto", true),
      coluna("estoque", "Estoque"),
      ...(comOrigem ? [coluna("saldo", rotuloDaOrigem)] : []),
      coluna("quantidade", "Quantidade", true),
      coluna("unitario", "Valor unitário"),
      coluna("total", "Total"),
    ],
  };
}

export function ItensDoModulo(p: PropsDosItensDoModulo) {
  const armazemPorItem = p.armazemPorItem ?? true;
  const linhaUnica = p.linhaUnica ?? false;
  const daOrigem = p.daOrigem ?? null;
  const comOrigem = daOrigem !== null;
  const rotulo = p.rotuloDaOrigem ?? "Saldo";
  // A identidade do layout muda só quando a forma da grade muda: o motor refaz as colunas visíveis a cada layout novo.
  const layout = React.useMemo(() => layoutDoModulo(armazemPorItem, comOrigem, rotulo), [armazemPorItem, comOrigem, rotulo]);
  return <ItensDaCentral prefixoTestid={p.prefixoTestid} colunas={COLUNAS_DO_MODULO} layout={layout} items={p.items} onChange={p.onChange}
    erros={p.erros} armazemPadrao={p.armazemPadrao} armazemPorItem={armazemPorItem} linhaUnica={linhaUnica} daOrigem={daOrigem}
    pesquisaDeProduto={PESQUISA_DE_PRODUTO_DA_SAIDA} />;
}
