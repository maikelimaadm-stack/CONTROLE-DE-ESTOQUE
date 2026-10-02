"use client";
import { ItensDaCentral as ItensDoMotor, type LayoutDosItens } from "@/features/central/itens";
import type { ItemRow } from "@/features/docs/shared";
import { PREFIXO_CENTRAL_VENDAS, colunasDosItensDeVendas } from "./central-vendas-adaptador";

/**
 * ITENS DA CENTRAL DE VENDAS (VISUAL-UX-01 R1; desenho na VISUAL-UX-02; motor extraído em VISUAL-UX-04).
 *
 * A grade/formulário é o motor (`@/features/central/itens`), sobre o MESMO `items`/`onChange` da página. A venda
 * entrega o prefixo `central-vendas` dos testids e o catálogo de itens de VENDAS (colunas do sistema e o mapa
 * catálogo → coluna). Lote/validade, armazém por item e o modo "da origem" ficam DESLIGADOS: a grade, o DOM e o
 * payload são os de antes.
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
  /** VENDAS-A3-1b: armazém padrão do layout que vale AGORA. Ausente/null: como hoje. */
  armazemPadrao?: { id: string; rotulo: string } | null;
}) {
  return <ItensDoMotor prefixoTestid={PREFIXO_CENTRAL_VENDAS} colunas={colunasDosItensDeVendas} items={items} onChange={onChange} layout={layout}
    erros={erros} armazemPadrao={armazemPadrao} reservaEstoque={reservaEstoque} />;
}
