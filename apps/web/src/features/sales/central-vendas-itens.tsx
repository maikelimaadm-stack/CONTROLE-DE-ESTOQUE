"use client";
import { ItensDaCentral as ItensDoMotor, type LayoutDosItens } from "@/features/central/itens";
import { PESQUISA_DE_PRODUTO_DA_SAIDA, type LocalDeEstoque } from "@/features/central/contrato";
import type { ItemRow } from "@/features/docs/shared";
import { PREFIXO_CENTRAL_VENDAS, colunasDosItensDeVendas } from "./central-vendas-adaptador";

/**
 * ITENS DA CENTRAL DE VENDAS (VISUAL-UX-01 R1; desenho na VISUAL-UX-02; motor extraído em VISUAL-UX-04).
 *
 * A grade/formulário é o motor (`@/features/central/itens`), sobre o MESMO `items`/`onChange` da página. A venda
 * entrega o prefixo `central-vendas` dos testids e o catálogo de itens de VENDAS (colunas do sistema e o mapa
 * catálogo → coluna). Lote/validade, armazém por item e o modo "da origem" ficam DESLIGADOS: a grade, o DOM e o
 * payload são os de antes.
 *
 * OPERACOES-01 F3b (decisão 280): as três variantes (orçamento, pedido e venda) são SAÍDAS — a pesquisa de produto da
 * linha vem com "Só com saldo neste local" ligado (com a capacidade da pesquisa nova; sem ela, a pesquisa de hoje). O
 * local das linhas novas é o "Local de estoque" do cabeçalho, estado da tela que a página entrega em `armazemPadrao`.
 */

export type { LayoutDosItens } from "@/features/central/itens";

export function ItensDaCentral({ items, onChange, layout, erros, armazemPadrao, reservaEstoque }: {
  items: ItemRow[]; onChange: (i: ItemRow[]) => void;
  /** Só com a capacidade `layoutDocumento`: sem ele a grade é a de hoje, idêntica. */
  layout?: LayoutDosItens | null;
  /** Erros por caminho `items[i].<chave do catálogo>` (os mesmos de `camposObrigatoriosFaltando` e do 422). */
  erros?: Record<string, string>;
  /** TOP-CONFIG-07 — a versão da TOP escolhida RESERVA estoque. Ausente/null: a grade de hoje, idêntica. */
  reservaEstoque?: { obrigatorias: readonly string[] } | null;
  /**
   * O local das linhas NOVAS (OPERACOES-01 F3b): o "Local de estoque" do cabeçalho, que começa no padrão de cadastro do
   * layout (VENDAS-A3-1b). Ausente/null: a linha nasce sem local, como antes.
   */
  armazemPadrao?: LocalDeEstoque | null;
}) {
  return <ItensDoMotor prefixoTestid={PREFIXO_CENTRAL_VENDAS} colunas={colunasDosItensDeVendas} items={items} onChange={onChange} layout={layout}
    erros={erros} armazemPadrao={armazemPadrao} pesquisaDeProduto={PESQUISA_DE_PRODUTO_DA_SAIDA} reservaEstoque={reservaEstoque} />;
}
