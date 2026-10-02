/**
 * ═══ A SITUAÇÃO DA APROVAÇÃO DE UM DOCUMENTO (OPERACOES-01 F2, decisão 279) ═══
 *
 * Módulo de APOIO das duas leituras novas — não registra rota (sem `export default`):
 *
 *   GET /api/aprovacoes/vendas/:id    (`sales.view`,   `aprovacoes-vendas.ts`)
 *   GET /api/aprovacoes/compras/:id   (`compras.view`, `aprovacoes-compras.ts`)
 *
 * A consulta do documento (as Centrais de Vendas e de Compras) pergunta "este documento aguarda aprovação? quem
 * decidiu por último?" sem precisar de `<recurso>.approve`: quem VÊ o documento vê a situação dele; quem DECIDE
 * continua sendo quem tem a capacidade de aprovar (as rotas POST de hoje, que não mudam). Cada rota acha o documento
 * pela MESMA leitura do GET por id (`getDoc` / `lerDocumentoCompra`) — e é por isso que a 404 é a mesma — e entrega
 * aqui só o que a conta precisa. Este arquivo é UM dono para o contrato da resposta, a recusa dos parâmetros e a
 * leitura da última decisão; não acha documento, não confere capacidade e não grava nada.
 *
 * A RESPOSTA: `{ situacao, ultimaDecisao }`.
 *   · `nao_aberto`  — o documento não está aberto (venda: `status` fora de open/approved; compra: `situacao` fora de
 *                     "aberto"). A TOP NÃO é lida: a confirmação sobe a `version` da venda, e a conta por versão diria
 *                     "pendente" de um documento confirmado. Aprovação só existe para documento aberto (a decisão e a
 *                     guarda da 0041 recusam o resto).
 *   · aberto        — a MESMA conta da confirmação e das decisões: `lerVersaoCongeladaTop` + `situacaoDaAprovacao`
 *                     (`lib/aprovacao-documento.ts`), sobre a versão CONGELADA e o valor ATUAL → `nao_exigida` |
 *                     `pendente` | `aprovado` | `reprovado`. Formato 4 ilegível → o TIPO_OPERACAO_EXECUCAO_INDISPONIVEL
 *                     que a conta já lança (fail-closed; a porta administrativa não deixa gravar tal versão).
 *   · `ultimaDecisao` — a última decisão do documento, de QUALQUER versão (a mesma `ultimaDecisao` da linha da fila):
 *                     numa venda aprovada e alterada depois, a situação volta a "pendente" e a última decisão continua
 *                     dizendo o que foi decidido antes, por quem e quando. `null` sem decisão nenhuma. Lida também no
 *                     documento que não está aberto (a história de quem o viu passar pela aprovação).
 *
 * SÓ LEITURA, CONSULTAS FIXAS: a leitura do documento (de quem chama) + no máximo 1 da versão da TOP + no máximo 1 da
 * decisão vigente + 1 da última decisão — nenhuma por item. Sem idempotência, sem auditoria, sem ROW COUNT a conferir.
 *
 * O SQL da última decisão é FIXO por módulo, montado NA CARGA deste arquivo a partir da whitelist `TABELA_DA_APROVACAO`
 * (o mesmo dono das tabelas de aprovação): nenhum identificador vem de entrada. O índice (organization_id, documento_id,
 * id desc) da 0041 responde com uma leitura. A RLS das tabelas de aprovação recorta pelo módulo da permissão da rota
 * (vendas/compras) — o MESMO módulo do GET por id que achou o documento.
 */
import type { ServiceCtx } from "../lib/context.js";
import { err } from "../lib/errors.js";
import { TABELA_DA_APROVACAO, situacaoDaAprovacao } from "../lib/aprovacao-documento.js";
import { lerVersaoCongeladaTop } from "../lib/confirmacao-automatica.js";

// ─────────────── o contrato ───────────────

/** Os documentos que têm a consulta da situação: a venda e a compra (o estoque fica para a F5). */
export type ModuloDaConsulta = "vendas" | "compras";

/**
 * A situação como a consulta a mostra. Escrita por extenso (e não derivada do tipo da `lib`): se a conta ganhar um
 * valor novo, o typecheck desta atribuição falha, em vez de o contrato da resposta mudar em silêncio.
 */
export type SituacaoNaConsulta = "nao_aberto" | "nao_exigida" | "pendente" | "aprovado" | "reprovado";

/** A última decisão do documento (a mesma forma da `ultimaDecisao` da linha da fila). `decididoEm` em ISO. */
export interface UltimaDecisao {
  decisao: "aprovado" | "reprovado";
  observacao: string | null;
  decididoPor: { id: string; nome: string };
  decididoEm: string;
}

export interface RespostaDaSituacaoDaAprovacao {
  situacao: SituacaoNaConsulta;
  ultimaDecisao: UltimaDecisao | null;
}

/** O que a rota já leu do documento VISÍVEL (pela leitura do GET por id), na mesma transação. */
export interface DocumentoDaSituacao {
  modulo: ModuloDaConsulta;
  /** O id que o BANCO devolveu (canônico). */
  documentoId: string;
  /** Aberto para a aprovação: venda open | approved (o "approved" da 0005 é aberto); compra "aberto". */
  aberto: boolean;
  /** A `version` ATUAL da venda (texto do bigint); a compra não tem versão (`null`). */
  versaoDocumento: string | null;
  /** O valor ATUAL do documento (decimal em texto): `total` da venda, `valor_total` da compra. */
  valorDocumento: string;
  /** A versão CONGELADA da TOP que o documento cita; `null` no documento sem TOP. */
  tipoOperacaoVersaoId: string | null;
}

// ─────────────── a recusa dos parâmetros ───────────────

const MSG_PARAMETRO_NAO_RECONHECIDO = "Parâmetro não reconhecido na situação da aprovação";
const MSG_PARAMETRO_REPETIDO = "Parâmetro repetido: informe um valor só";

const recusa = (path: string, message: string) => err("VALIDATION_ERROR", message, [{ path, message }]);

/**
 * A situação não aceita parâmetro de consulta NENHUM: qualquer chave é 422 no parâmetro, nunca ignorada (descarte
 * silencioso de contrato não canônico é ampliação de escopo — CLAUDE.md). Repetido chega como lista: 422 com a
 * mensagem do repetido, nunca 500 (o molde da fila, `aprovacoes-vendas.ts`).
 */
export function recusarParametrosDaSituacao(query: unknown): void {
  const primeiro = Object.entries((query ?? {}) as Record<string, unknown>)[0];
  if (!primeiro) return;
  const [chave, valor] = primeiro;
  throw recusa(chave, Array.isArray(valor) ? MSG_PARAMETRO_REPETIDO : MSG_PARAMETRO_NAO_RECONHECIDO);
}

// ─────────────── a última decisão ───────────────

/**
 * A última decisão do documento, de qualquer versão, com o nome de quem decidiu. O `join` em `erp.users` é pela FK
 * `decidido_por` (not null): a decisão nunca some por causa dele (o mesmo da consulta da vigente, na `lib`).
 */
const consultaDaUltimaDecisao = (tabela: string): string =>
  `select a.decisao, a.observacao, a.decidido_por::text as decidido_por, u.name as decidido_por_nome, a.decidido_em
     from ${tabela} a
     join erp.users u on u.id = a.decidido_por
    where a.documento_id = $1 and a.organization_id = $2
    order by a.id desc
    limit 1`;

/** O SQL de cada módulo, fixado na carga a partir da whitelist da `lib`. */
export const SQL_DA_ULTIMA_DECISAO: Readonly<Record<ModuloDaConsulta, string>> = Object.freeze({
  vendas: consultaDaUltimaDecisao(TABELA_DA_APROVACAO.vendas),
  compras: consultaDaUltimaDecisao(TABELA_DA_APROVACAO.compras),
});

/** Módulo desconhecido NEGA (erro do chamador, 500), nunca cai na tabela vizinha — o tipo fecha, isto confere. */
function sqlDaUltimaDecisao(modulo: ModuloDaConsulta): string {
  if (!Object.hasOwn(SQL_DA_ULTIMA_DECISAO, modulo)) throw new Error("aprovacoes-situacao: módulo da consulta desconhecido");
  return SQL_DA_ULTIMA_DECISAO[modulo];
}

interface UltimaDecisaoLida {
  decisao: "aprovado" | "reprovado";
  observacao: string | null;
  decidido_por: string;
  decidido_por_nome: string;
  decidido_em: Date | string;
}

/** O pg entrega timestamptz como Date; a API responde ISO (o mesmo texto que o JSON de um Date daria). */
const emIso = (v: Date | string): string => (v instanceof Date ? v : new Date(v)).toISOString();

async function lerUltimaDecisao(ctx: ServiceCtx, modulo: ModuloDaConsulta, documentoId: string): Promise<UltimaDecisao | null> {
  const r = await ctx.tx.query<UltimaDecisaoLida>(sqlDaUltimaDecisao(modulo), [documentoId, ctx.orgId]);
  const u = r.rows[0];
  if (!u) return null;
  return { decisao: u.decisao, observacao: u.observacao, decididoPor: { id: u.decidido_por, nome: u.decidido_por_nome }, decididoEm: emIso(u.decidido_em) };
}

// ─────────────── a resposta ───────────────

/**
 * A situação da aprovação do documento VISÍVEL que a rota já leu. Não aberto → `nao_aberto`, sem ler a TOP; aberto →
 * a conta da `lib` (a mesma da confirmação e das decisões). Depois, UMA consulta da última decisão.
 */
export async function respostaDaSituacaoDaAprovacao(ctx: ServiceCtx, d: DocumentoDaSituacao): Promise<RespostaDaSituacaoDaAprovacao> {
  let situacao: SituacaoNaConsulta = "nao_aberto";
  if (d.aberto) {
    const versaoTop = await lerVersaoCongeladaTop(ctx, d.tipoOperacaoVersaoId);
    situacao = await situacaoDaAprovacao(ctx,
      { modulo: d.modulo, documentoId: d.documentoId, versaoDocumento: d.versaoDocumento, valorDocumento: d.valorDocumento, versaoTop });
  }
  return { situacao, ultimaDecisao: await lerUltimaDecisao(ctx, d.modulo, d.documentoId) };
}
