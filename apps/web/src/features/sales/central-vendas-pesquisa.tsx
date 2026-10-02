"use client";
/**
 * PESQUISA DA CENTRAL DE VENDAS — o painel do motor (`@/features/central/pesquisa`), sobre a fonte real de opções
 * (`/api/resources/<recurso>/options`, a mesma chave de cache do `RefSelect`). Nada de venda mora nele.
 */
export { PainelDePesquisa, useOpcoes } from "@/features/central/pesquisa";
export type { OpcaoReal } from "@/features/central/pesquisa";
