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

/**
 * OPERACOES-01 F9 (decisão 286): o FINANCEIRO PELA TOP. A API nova acrescenta `financeiroPelaTop: 1` à MESMA resposta
 * (`{ centralFinanceira: 1, financeiroPelaTop: 1 }`): o lançamento avulso e o movimento escolhem a TOP primeiro
 * (`GET /api/financeiro/tops`), e o título previsto aparece no cartão "Previstos", na situação "Previsto" e no fluxo.
 * Sem ela (a API da F8, ou a anterior), a Central e o movimento ficam como estavam e nenhum pedido sai para as rotas
 * novas (skew sentido 1).
 */
export const CAPACIDADE_FINANCEIRO_PELA_TOP = 1 as const;

/** `true` só quando a resposta entende a Central (`entendeCentralFinanceira`) E traz `financeiroPelaTop === 1` (o número). */
export function entendeFinanceiroPelaTop(resposta: unknown): boolean {
  return entendeCentralFinanceira(resposta) && (resposta as Record<string, unknown>)["financeiroPelaTop"] === CAPACIDADE_FINANCEIRO_PELA_TOP;
}
