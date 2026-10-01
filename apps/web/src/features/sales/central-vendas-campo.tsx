"use client";
/**
 * CENTRAL DE VENDAS — O CAMPO (VISUAL-UX-02, decisão 270; motor extraído em VISUAL-UX-04).
 *
 * O campo é o do motor (`@/features/central/campo`), sem nada de venda: a densidade vem do `[data-densidade]` da
 * moldura, e quem decide valor, obrigatoriedade, erro e payload continua sendo a página.
 */
export { CampoDaCentral, CampoLeitura, ChaveSimNao, ColunaDeCampos, DadosAdicionais, DataDaCentral } from "@/features/central/campo";
export type { Densidade, IconeDoCampo, EstadoDoCampo, PropsDoCampo } from "@/features/central/campo";
