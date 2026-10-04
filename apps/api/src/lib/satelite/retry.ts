/**
 * DECISÃO APÓS FALHA DE UM ITEM DA FILA SATELITAL (SAT-03, decisão 296) — função PURA: o executor pergunta, ela
 * responde "repetir quando" ou "falhar com qual erro". Nenhum número mora aqui: todos vêm de `limites.ts`.
 *
 * REPETE (até `TENTATIVAS_POR_RODADA` tentativas na rodada): o que outra tentativa pode mudar — 429 (`limite`), 5xx
 * (`indisponivel`), tempo esgotado, falha de rede, dia com erro do provedor que decidiria a escolha
 * (`processamento_parcial`) e erro desconhecido (não é do provedor: pode ser passageiro, e o teto de tentativas impede
 * o laço). Espera = `ESPERA_BASE_S × ESPERA_FATOR^(tentativa − 1)`, com ±`ESPERA_JITTER` de variação (as réplicas não
 * voltam todas no mesmo segundo); `Retry-After` do provedor MAIOR que isso é respeitado.
 *
 * FALHA NA PRIMEIRA: o que repetir não muda e só gasta cota — 400/404/4xx (`requisicao_recusada`), 403
 * (`acesso_negado`), 401 (`autenticacao`), 2xx fora do contrato (`resposta_malformada`) e integração sem credencial
 * (`configuracao`). Tipo de falha que esta tabela não conhece também FALHA (fail-closed: nunca repete por padrão).
 *
 * O `erro` gravado no item é texto ESTÁVEL, sem segredo: o tipo e o status HTTP. Erro desconhecido vira
 * `erro_interno` — a mensagem crua (que pode carregar SQL, corpo ou credencial) nunca sai daqui.
 */
import { FalhaCopernicus, type TipoFalhaCopernicus } from "./copernicus.js";
import { ESPERA_BASE_S, ESPERA_FATOR, ESPERA_JITTER, TENTATIVAS_POR_RODADA } from "./limites.js";

export type DecisaoFalha = { tipo: "repetir"; proximaTentativaEm: Date; erro: string } | { tipo: "falhar"; erro: string };

/** Cada tipo de falha do provedor, classificado. `Record` exaustivo: tipo novo sem classificação não compila. */
const CLASSE: Record<TipoFalhaCopernicus, "repetir" | "falhar"> = {
  limite: "repetir",
  indisponivel: "repetir",
  tempo: "repetir",
  rede: "repetir",
  processamento_parcial: "repetir",
  requisicao_recusada: "falhar",
  acesso_negado: "falhar",
  autenticacao: "falhar",
  resposta_malformada: "falhar",
  configuracao: "falhar"
};

export const ERRO_INTERNO = "erro_interno";

/** Texto estável do erro: `tipo` e, se houver, ` (HTTP status)`. Nada da mensagem, do corpo ou do token. */
function textoDoErro(f: FalhaCopernicus): string {
  return `${f.tipo}${f.status ? ` (HTTP ${f.status})` : ""}`;
}

/**
 * `tentativasRodada` = tentativas JÁ FEITAS nesta rodada, contando a que acabou de falhar (a reserva soma 1 antes de
 * executar). Fora de inteiro ≥ 1 é tratado como esgotado: um contador estranho nunca abre laço.
 */
export function decidirAposFalha(erro: unknown, tentativasRodada: number, agoraMs: number, aleatorio: () => number = Math.random): DecisaoFalha {
  const doProvedor = erro instanceof FalhaCopernicus ? erro : null;
  const classe = doProvedor ? (Object.hasOwn(CLASSE, doProvedor.tipo) ? CLASSE[doProvedor.tipo] : null) : "repetir";
  const texto = doProvedor && classe ? textoDoErro(doProvedor) : ERRO_INTERNO;
  if (classe !== "repetir") return { tipo: "falhar", erro: texto };
  if (!Number.isInteger(tentativasRodada) || tentativasRodada < 1 || tentativasRodada >= TENTATIVAS_POR_RODADA) return { tipo: "falhar", erro: texto };

  const sorteio = Math.min(1, Math.max(0, Number(aleatorio()) || 0));
  const variacao = 1 + (sorteio * 2 - 1) * ESPERA_JITTER;
  let esperaS = ESPERA_BASE_S * ESPERA_FATOR ** (tentativasRodada - 1) * variacao;
  const pedida = doProvedor?.tentarAposSegundos;
  if (typeof pedida === "number" && Number.isFinite(pedida) && pedida > esperaS) esperaS = pedida;
  return { tipo: "repetir", proximaTentativaEm: new Date(agoraMs + Math.ceil(esperaS * 1000)), erro: texto };
}
