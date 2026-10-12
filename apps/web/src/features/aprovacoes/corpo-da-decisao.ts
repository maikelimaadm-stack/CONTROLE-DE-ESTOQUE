/**
 * O CORPO DA DECISÃO DE APROVAÇÃO (`POST /api/aprovacoes/<área>/<id>/aprovar|reprovar`) — puro, sem dependência de tela,
 * para a regra da versão ser conferida por teste unitário.
 *
 * A `version` que a decisão leva é a do documento que a tela MOSTROU (a linha da fila, ou o documento da consulta): o
 * servidor confere a vista contra a travada e responde 409 CONCURRENCY_CONFLICT quando o documento mudou depois.
 *   · vendas  → "sempre": a fila e a consulta da venda declaram a versão desde a EDITAR-01 (decisão 272);
 *   · compras → "quandoDeclarada" (EDITAR-02, decisão 313, P5): manda SÓ quando uma resposta que SÓ a API nova emite a
 *     declarou. A API da base recusa (`.strict()`) a chave que não conhece — sem a declaração, o corpo é o de antes:
 *       - na FILA, a própria linha: a fila da base escolhe as colunas e nunca traz `version`;
 *       - na CONSULTA, a SITUAÇÃO da aprovação (`GET /api/aprovacoes/compras/:id`) declarando `version`. NUNCA a
 *         presença de `version` no documento: o GET por id da base devolve `d.*` e, com o banco já na 0063 (que migra
 *         antes do binário), a traz — a decisão mandaria a chave à base e levaria 422;
 *   · estoque → "nunca": a decisão do documento de estoque não é por versão.
 */
export type Decisao = "aprovar" | "reprovar";
export type VersaoNaDecisao = "sempre" | "quandoDeclarada" | "nunca";

/** A regra da versão de cada área de aprovação (as abas do módulo no `nav.registry.mjs`). */
export const VERSAO_NA_DECISAO = Object.freeze({ vendas: "sempre", compras: "quandoDeclarada", estoque: "nunca" } as const satisfies Record<string, VersaoNaDecisao>);

/**
 * O corpo — estrito, como as rotas o leem:
 *   · aprovar: `{ observacao? }` (ausente quando vazia), mais `version` pela regra da área;
 *   · reprovar: `{ motivo }` (obrigatório), mais `version` pela regra da área.
 * `versao`: a que a tela mostrou; `undefined` = não declarada (a decisão vai sem ela na regra "quandoDeclarada").
 */
export function corpoDaDecisaoPelaVersao(regra: VersaoNaDecisao, versao: string | undefined, decisao: Decisao, texto: string): Record<string, unknown> {
  const corpo: Record<string, unknown> = {};
  if (regra === "sempre" || (regra === "quandoDeclarada" && versao !== undefined)) corpo["version"] = versao;
  const t = texto.trim();
  if (decisao === "reprovar") corpo["motivo"] = t;
  else if (t) corpo["observacao"] = t;
  return corpo;
}

/** A forma canônica do texto do bigint que as rotas devolvem (sem sinal, sem zero à esquerda). */
const FORMA_DA_VERSAO = /^(0|[1-9]\d*)$/;

/**
 * A SITUAÇÃO da aprovação (a resposta crua de `GET /api/aprovacoes/<área>/:id`) DECLARA a versão? Só o texto canônico
 * do bigint conta; ausente, nulo, número ou fora da forma = não declarou (a resposta da base: `{ situacao, ultimaDecisao }`).
 */
export function situacaoDeclaraVersao(situacao: unknown): boolean {
  if (typeof situacao !== "object" || situacao === null || Array.isArray(situacao)) return false;
  const v = (situacao as Record<string, unknown>)["version"];
  return typeof v === "string" && FORMA_DA_VERSAO.test(v);
}

/**
 * A VERSÃO DA DECISÃO NA CONSULTA: a do documento que a tela mostra (`versaoDoDocumento` — o conteúdo VISTO; a da
 * situação pode ser de uma leitura posterior), pela regra da área. Na "quandoDeclarada" (a compra), só quando a
 * SITUAÇÃO declara a versão; senão, nenhuma. Nas outras, a do documento como sempre foi (a venda a manda sempre; o
 * estoque a descarta no corpo).
 */
export function versaoDaDecisaoNaConsulta(regra: VersaoNaDecisao, versaoDoDocumento: string | undefined, situacao: unknown): string | undefined {
  if (regra === "quandoDeclarada") return situacaoDeclaraVersao(situacao) ? versaoDoDocumento : undefined;
  return versaoDoDocumento;
}
