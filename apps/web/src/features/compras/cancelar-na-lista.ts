/**
 * Cancelar na lista de documentos de compra — contas PURAS (sem React).
 * A lista (`documentos-compra-list.tsx`) só as chama; a consulta usa a mesma regra em `estado.ts`.
 */

/** Situações em que a consulta mostra Cancelar (a mesma regra de `podeCancelar` em `estado.ts` / orçamento). */
export function situacaoCancelavel(especie: string, situacao: string): boolean {
  if (especie === "orcamento") return situacao === "aberto";
  if (especie === "pedido") return situacao === "aberto" || situacao === "finalizado";
  if (especie === "compra") return situacao === "aberto" || situacao === "confirmado";
  return false;
}
