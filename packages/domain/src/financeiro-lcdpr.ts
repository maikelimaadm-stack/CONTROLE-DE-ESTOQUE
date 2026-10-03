/**
 * OPERACOES-01 F9 (decisão 286) — OS DADOS DO LCDPR (Livro Caixa Digital do Produtor Rural).
 *
 * O ERP passa a guardar, desde já, o que o livro pede — o arquivo oficial fica para depois (fora desta PR):
 *   · o IMÓVEL RURAL (`erp.imoveis_rurais`, cadastro por empresa): nome, CIB/NIRF do ITR, CAEPF, inscrição estadual,
 *     tipo de exploração e % de participação; um imóvel PADRÃO por empresa, que a baixa e o movimento bancário usam
 *     quando nenhum é informado;
 *   · o TIPO NO LCDPR da natureza (`erp.financial_categories.tipo_lcdpr`): 1 receita da atividade rural, 2 despesa de
 *     custeio e investimento, 3 produto entregue de adiantamento, ou "fora" do livro;
 *   · a CONFERÊNCIA por período (data, imóvel, conta, documento, participante, tipo e valor), que lê o livro caixa — os
 *     movimentos confirmados, sem transferência entre contas nem saldo inicial.
 *
 * Os valores gravados são os CÓDIGOS deste arquivo (os CHECKs da 0045 os repetem — o banco é a rede); o número que o
 * livro usa (1, 2, 3 e 1 a 6 na exploração) é derivado aqui, nunca gravado. Arquivo folha: não importa nada.
 *
 * CAPACIDADE (skew): a API nova declara `capacidades.lcdpr: 1` em `GET /api/auth/context`. Sem a declaração (a API
 * anterior, na janela de deploy ou numa reversão só da API) a web não mostra nem envia nenhum campo do LCDPR — o
 * "Tipo no LCDPR" da natureza (`exigeCapacidade` do registry), o imóvel na baixa e no movimento e a conferência.
 */

/**
 * Os três tipos que ENTRAM no livro, na ordem do código (1, 2, 3): a lista ÚNICA da conferência — o filtro, os totais e
 * o SQL da API saem daqui (nenhuma segunda lista com os mesmos códigos).
 */
export const TIPOS_LCDPR_NO_LIVRO = ["receita", "custeio_investimento", "produto_adiantado"] as const;
/** Os três tipos que ENTRAM no livro (o "fora" não entra). */
export type TipoLcdprNoLivro = (typeof TIPOS_LCDPR_NO_LIVRO)[number];

/** O tipo que NÃO entra no livro: a natureza "Fora do LCDPR" nunca aparece na conferência. */
export const TIPO_LCDPR_FORA = "fora" as const;

/** O tipo da natureza no LCDPR, como o banco o grava (`financial_categories.tipo_lcdpr`). Nulo = ainda não classificada. */
export const TIPOS_LCDPR = [...TIPOS_LCDPR_NO_LIVRO, TIPO_LCDPR_FORA] as const;
export type TipoLcdpr = (typeof TIPOS_LCDPR)[number];

/** O código do tipo no livro (1, 2, 3). "Fora" não tem código: não entra no livro. */
export const CODIGO_DO_TIPO_LCDPR: Readonly<Record<TipoLcdprNoLivro, 1 | 2 | 3>> = Object.freeze({
  receita: 1,
  custeio_investimento: 2,
  produto_adiantado: 3,
});

/** As opções do campo "Tipo no LCDPR" da natureza (`[valor, rótulo]`, a forma do registry de cadastros). */
export const OPCOES_TIPO_LCDPR: readonly (readonly [TipoLcdpr, string])[] = Object.freeze([
  Object.freeze(["receita", "1 — Receita da atividade rural"] as const),
  Object.freeze(["custeio_investimento", "2 — Despesa de custeio e investimento"] as const),
  Object.freeze(["produto_adiantado", "3 — Produto entregue de adiantamento"] as const),
  Object.freeze(["fora", "Fora do LCDPR"] as const),
]);

/** O tipo de exploração do imóvel rural, como o banco o grava (`imoveis_rurais.tipo_exploracao`); códigos 1 a 6 do livro. */
export const TIPOS_EXPLORACAO_IMOVEL = ["individual", "condominio", "arrendado", "parceria", "comodato", "outros"] as const;
export type TipoExploracaoImovel = (typeof TIPOS_EXPLORACAO_IMOVEL)[number];

/** As opções do campo "Tipo de exploração" do imóvel rural (`[valor, rótulo]`), na ordem dos códigos do livro. */
export const OPCOES_TIPO_EXPLORACAO: readonly (readonly [TipoExploracaoImovel, string])[] = Object.freeze([
  Object.freeze(["individual", "1 — Exploração individual"] as const),
  Object.freeze(["condominio", "2 — Condomínio"] as const),
  Object.freeze(["arrendado", "3 — Imóvel arrendado"] as const),
  Object.freeze(["parceria", "4 — Parceria"] as const),
  Object.freeze(["comodato", "5 — Comodato"] as const),
  Object.freeze(["outros", "6 — Outros"] as const),
]);

/** O código do tipo de exploração no livro (1 a 6) — a posição na lista, nunca gravado. */
export const codigoDoTipoExploracao = (tipo: TipoExploracaoImovel): number => TIPOS_EXPLORACAO_IMOVEL.indexOf(tipo) + 1;

/** A versão da capacidade `lcdpr` que esta web entende (`GET /api/auth/context` → `capacidades.lcdpr`). */
export const CAPACIDADE_LCDPR = 1 as const;

/**
 * As capacidades da sessão declaram o LCDPR NESTA versão? `true` só para um objeto (não lista) com `lcdpr === 1` — o
 * número, não o texto. Resposta ausente, de outra versão ou de outra forma vale "sem capacidade": a tela de hoje.
 */
export function entendeLcdpr(capacidades: unknown): boolean {
  if (typeof capacidades !== "object" || capacidades === null || Array.isArray(capacidades)) return false;
  return (capacidades as Record<string, unknown>)["lcdpr"] === CAPACIDADE_LCDPR;
}

/** O maior período da conferência, em dias (um ano, com o bissexto). Acima → 422. */
export const PERIODO_MAXIMO_CONFERENCIA_LCDPR_DIAS = 366;

/**
 * As situações da conferência: `conferidas` = tipo 1, 2 ou 3 e imóvel presentes (o que o livro levaria);
 * `pendentes` = sem natureza, sem tipo ou sem imóvel (e não "fora"). O padrão é `conferidas`.
 */
export const SITUACOES_CONFERENCIA_LCDPR = ["conferidas", "pendentes"] as const;
export type SituacaoConferenciaLcdpr = (typeof SITUACOES_CONFERENCIA_LCDPR)[number];
