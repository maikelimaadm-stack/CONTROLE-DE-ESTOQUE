/**
 * SESSÃO DO NAVEGADOR — LEITURA CANÔNICA DA EMPRESA SELECIONADA (PRE-BASE2-05A).
 *
 * A sessão gravada no `localStorage` é o único estado do cliente que ATRAVESSA deploys: ninguém a migra
 * quando o bundle novo sobe, e quem já estava logado continua com o que gravou antes. Por isso a leitura é
 * o lugar — o único — onde o formato antigo vira o canônico.
 *
 * O formato canônico guarda `empresaId`; o anterior a PRE-BASE2-03 guardava a chave legada declarada
 * abaixo. Ler só o canônico zeraria a empresa selecionada de todo mundo no primeiro acesso; ler as duas
 * para sempre é como um fallback vira arquitetura. A saída deste módulo resolve as duas coisas: promove
 * uma vez e manda REGRAVAR, para que a próxima leitura já encontre só o canônico.
 *
 * POR QUE DUAS CHAVES DIVERGENTES SÃO AMBIGUIDADE DE VERDADE, E NÃO PREFERÊNCIA
 *
 * Os dois clientes preservam, ao regravar a sessão, as chaves que não conhecem: o anterior grava a legada
 * e carrega junto um `empresaId` que não entende; o canônico grava `empresaId` e carregava junto a legada
 * que sobrou.
 *
 * Logo, quando as duas chaves existem com valores DIFERENTES, o armazenamento não diz qual delas foi
 * escrita por último. Escolher uma seria decidir, no escuro, em qual empresa o usuário vai operar — e
 * empresa errada não é detalhe de interface, é lançamento no lugar errado. A saída é FAIL-SAFE: invalidar
 * a sessão e exigir login novo, que restabelece o contexto com o usuário olhando.
 *
 * Este módulo é a promoção temporária citada em docs/MULTI-COMPANY-CONTRACT.md: isolado, testado e com
 * remoção marcada para PRE-BASE2-05B, quando a borda legada do servidor sair e nenhum cliente anterior
 * puder mais gravá-la.
 */

/** Chave legada da empresa selecionada. Existe só aqui — nenhum outro ponto do cliente a conhece. */
const CHAVE_LEGADA = "farmId";
/** Chave canônica da empresa selecionada. */
const CHAVE_CANONICA = "empresaId";

/** O que a leitura encontrou, e o que o chamador tem de fazer com isso. */
export type LeituraSessao =
  /** Nada utilizável no armazenamento (ausente, corrompido, ou não é um objeto). */
  | { tipo: "ausente" }
  /** Já estava no formato canônico: usar como está, sem regravar. */
  | { tipo: "canonica"; sessao: Record<string, unknown> }
  /**
   * Veio no formato anterior e foi promovida. O chamador DEVE regravar `sessao` no armazenamento — é o que
   * faz a migração acontecer uma vez só, em vez de a cada leitura.
   */
  | { tipo: "migrada"; sessao: Record<string, unknown>; empresaId: string | null }
  /**
   * As duas chaves existem com valores diferentes e não há como saber qual é a atual. O chamador DEVE
   * invalidar a sessão e exigir novo login. Nunca escolher uma das empresas.
   */
  | { tipo: "conflito"; canonico: unknown; legado: unknown };

/** `null` é valor legítimo ("nenhuma empresa selecionada"); qualquer outra coisa que não seja texto, não. */
const ehIdentificadorDeEmpresa = (v: unknown): v is string | null => v === null || typeof v === "string";

/**
 * Interpreta o conteúdo BRUTO da sessão gravada e devolve o que fazer com ele.
 *
 * Puro de propósito: não toca em `localStorage`, não dispara evento, não navega. Quem decide o efeito é o
 * cliente (apps/web/src/lib/api.ts) — aqui mora só a regra, que é o que precisa de teste.
 */
export function lerSessaoArmazenada(bruto: unknown): LeituraSessao {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return { tipo: "ausente" };
  const obj = bruto as Record<string, unknown>;

  const temLegado = CHAVE_LEGADA in obj;
  const temCanonico = CHAVE_CANONICA in obj;

  // Caminho comum e final: o armazenamento já fala só o canônico.
  if (!temLegado) return { tipo: "canonica", sessao: obj };

  const legado = obj[CHAVE_LEGADA];
  const canonico = obj[CHAVE_CANONICA];

  // Duas chaves, valores divergentes: ambíguo por construção (ver cabeçalho). Fail-safe.
  if (temCanonico && canonico !== legado) return { tipo: "conflito", canonico, legado };

  // Sobrou uma chave legada inútil (tipo inesperado) sem canônico para sustentar a sessão.
  if (!temCanonico && !ehIdentificadorDeEmpresa(legado)) return { tipo: "conflito", canonico: undefined, legado };

  // Promoção: o valor canônico passa a ser a autoridade e a chave legada SAI do armazenamento.
  const sessao = { ...obj };
  const empresaId = (temCanonico ? canonico : legado) as string | null;
  sessao[CHAVE_CANONICA] = empresaId;
  delete sessao[CHAVE_LEGADA];
  return { tipo: "migrada", sessao, empresaId };
}
