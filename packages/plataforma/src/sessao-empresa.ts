/**
 * SESSÃO DO NAVEGADOR — LEITURA CANÔNICA DA EMPRESA SELECIONADA (PRE-BASE2-05B).
 *
 * A sessão gravada no `localStorage` é o único estado do cliente que ATRAVESSA deploys: ninguém a migra
 * quando o bundle novo sobe. Por isso a leitura é a porta onde o contrato é verificado.
 *
 * O QUE SAIU EM 05B
 *
 * A PROMOÇÃO da chave anterior. Ela existiu durante a PRE-BASE2-05A por uma razão com prazo: quem já estava
 * logado quando o web canônico subiu tinha a empresa gravada no formato antigo, e ler só o canônico zeraria
 * a seleção de todo mundo no primeiro acesso. Esse rollout terminou — o web canônico está em produção, e
 * nenhuma versão viva do cliente grava a chave anterior. Uma sessão dormante o bastante para ainda tê-la
 * simplesmente pede login de novo: um login a mais é barato, e uma ponte que ninguém mais atravessa, não —
 * ela só continuaria pedindo para ser mantida a cada mudança.
 *
 * O QUE FICOU, E NÃO É PONTE
 *
 * A VALIDAÇÃO do valor. `localStorage` é editável pelo usuário e sobrevive a qualquer versão do cliente.
 * Aceitar `empresaId` só porque a chave existe deixaria passar `42`, `{}`, `""` ou `"abc"` — que seguiriam
 * em `X-Empresa-Id` e voltariam como 422 em telas sem relação com a causa. O backend continua sendo a
 * autoridade (não há escalada de autorização aqui), mas um contrato que só o servidor faz cumprir não é
 * contrato: a sessão inválida é recusada na porta, que é onde o estado nasce. Isso é canônico e fica.
 */

/** Chave canônica da empresa selecionada. É a única que a sessão conhece. */
const CHAVE_CANONICA = "empresaId";

/** O que a leitura encontrou, e o que o chamador tem de fazer com isso. */
export type LeituraSessao =
  /** Nada utilizável no armazenamento (ausente, corrompido, ou não é um objeto). */
  | { tipo: "ausente" }
  /** Formato canônico e valor válido: usar como está, sem regravar. */
  | { tipo: "canonica"; sessao: Record<string, unknown> }
  /**
   * O armazenamento tem forma de sessão, mas a empresa gravada não respeita o contrato canônico. O chamador
   * DEVE apagar a sessão e exigir novo login. Vale tanto para valor fora do contrato quanto para a chave
   * ausente — inclusive quando o que sobrou ali foi gravado por uma versão anterior do cliente.
   */
  | { tipo: "invalida"; motivo: string };

/**
 * Contrato canônico do identificador de empresa na sessão: `null` ("nenhuma empresa selecionada", que é
 * escolha e não ausência) ou UUID.
 *
 * `"todas"` NÃO entra de propósito: "todas as empresas" é ESCOPO DE LEITURA, resolvido no servidor a cada
 * requisição (ver `empresa.ts`), nunca uma empresa persistida na sessão.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehEmpresaIdValido = (v: unknown): v is string | null => v === null || (typeof v === "string" && UUID.test(v));

/**
 * Interpreta o conteúdo BRUTO da sessão gravada e devolve o que fazer com ele.
 *
 * Puro de propósito: não toca em `localStorage`, não dispara evento, não navega. Quem decide o efeito é o
 * cliente (apps/web/src/lib/api.ts) — aqui mora só a regra, que é o que precisa de teste.
 */
export function lerSessaoArmazenada(bruto: unknown): LeituraSessao {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return { tipo: "ausente" };
  const obj = bruto as Record<string, unknown>;
  if (!(CHAVE_CANONICA in obj)) return { tipo: "invalida", motivo: "sessão sem a chave canônica da empresa selecionada" };
  if (!ehEmpresaIdValido(obj[CHAVE_CANONICA])) return { tipo: "invalida", motivo: "empresa selecionada não é UUID nem nula" };
  return { tipo: "canonica", sessao: obj };
}
