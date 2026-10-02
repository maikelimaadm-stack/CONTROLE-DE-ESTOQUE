/**
 * Capacidade da Central Financeira (OPERACOES-01 F8, decisão 285).
 *
 * A API nova responde `GET /api/financeiro/capacidades` com `{ centralFinanceira: 1 }`; a API anterior responde 404.
 * A web só monta a Central quando entende EXATAMENTE esta forma e esta versão: resposta desconhecida, de outra versão
 * ou ausente vale como "sem capacidade" e a tela de hoje continua (skew sentido 1).
 */
export const CAPACIDADE_CENTRAL_FINANCEIRA = 1 as const;

/** `true` só para um objeto não nulo com `centralFinanceira === 1` (o número, não o texto). */
export function entendeCentralFinanceira(resposta: unknown): boolean {
  if (typeof resposta !== "object" || resposta === null || Array.isArray(resposta)) return false;
  return (resposta as Record<string, unknown>)["centralFinanceira"] === CAPACIDADE_CENTRAL_FINANCEIRA;
}
