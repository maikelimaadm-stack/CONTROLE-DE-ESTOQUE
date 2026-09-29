/**
 * PORTAS DE LANÇAMENTO COMUNS AOS DOCUMENTOS COMERCIAIS (venda e compra) — extraídas de `routes/sales.ts` sem
 * mudança de comportamento (COMPRAS-01). Cada função recebe o que a distingue (a família da TOP, a natureza
 * aceita na classificação) como PARÂMETRO; a consulta, a trava e a superfície de recusa são as mesmas.
 */
import { DomainError } from "@agro/shared";
import { ERRO_CONDICAO_PAGAMENTO_INVALIDA, MSG_CONDICAO_PAGAMENTO_INVALIDA, type CondicaoPagamento } from "@agro/domain";
import { err } from "./errors.js";
import type { ServiceCtx } from "./context.js";

/** O snapshot que o documento grava: identidade da TOP + a versão exata que valia no instante do lançamento. */
export interface TopDoLancamento { tipoOperacaoId: string; tipoOperacaoVersaoId: string; codigo: string; nome: string; versao: number; codigoBase: string }

/**
 * RESOLVE A TOP ESCOLHIDA E CONGELA A VERSÃO CORRENTE — a única porta por onde o snapshot nasce.
 *
 * O cliente manda `tipo_operacao_id` e NADA MAIS; a versão é decidida pelo SERVIDOR no instante da escrita.
 * `for share of t` — só no PAI (a versão é imutável e o `for share` dela exigiria o privilégio revogado pela 0020).
 * SUPERFÍCIE ÚNICA DE RECUSA: inexistente, de outro tenant, de outra família, inativa e excluída caem no MESMO 422.
 */
export async function resolverTopParaLancamento(ctx: ServiceCtx, familiaEsperada: string, tipoOperacaoId: string): Promise<TopDoLancamento> {
  const r = await ctx.tx.query<{ id: string; codigo: string; codigo_base: string; versao_id: string; nome: string; versao: number }>(
    `select t.id, t.codigo, t.codigo_base, v.id as versao_id, v.nome, v.versao
       from erp.tipos_operacao t
       join erp.tipos_operacao_versoes v
         on v.tipo_operacao_id = t.id and v.organization_id = t.organization_id and v.versao = t.versao_atual
      where t.id = $1 and t.organization_id = $2 and t.ativo and t.excluido_em is null and t.codigo_base = $3
        for share of t`,
    [tipoOperacaoId, ctx.orgId, familiaEsperada]);
  const top = r.rows[0];
  if (!top) throw new DomainError("TIPO_OPERACAO_INDISPONIVEL", "Tipo de operação indisponível para este lançamento");
  return { tipoOperacaoId: top.id, tipoOperacaoVersaoId: top.versao_id, codigo: top.codigo, nome: top.nome, versao: top.versao, codigoBase: top.codigo_base };
}

/** O PAR natureza × centro de resultado que vai para o rateio dos títulos. */
export interface ClassificacaoFinanceira { categoriaFinanceiraId: string; centroCustoId: string }

/**
 * O QUE DISTINGUE a classificação de um tipo de documento: as naturezas aceitas (`nature` do cadastro) e os
 * textos da recusa. A regra (analítica, ativa, não excluída, da organização; centro analítico) é uma só.
 */
export interface RegraDaClassificacao {
  naturezas: readonly string[];
  msgCategoria: string;
  msgCentro: string;
  /** Texto da recusa na confirmação, a partir da mensagem base. */
  textoConfirmacao: (base: string) => string;
}

export const recusaDeCampoDaClassificacao = (campo: "categoria_financeira_id" | "centro_custo_id", mensagem: string) =>
  err("VALIDATION_ERROR", mensagem, [{ path: campo, message: mensagem }]);

/**
 * A PORTA ÚNICA DE VALIDAÇÃO da classificação. Inexistente, de outra organização, sintética, de natureza não aceita,
 * inativa e excluída caem no MESMO 422 com a MESMA mensagem. `for share` contra a inativação concorrente;
 * `trava: false` só em leitura para mostrar (prévia).
 */
export async function validarClassificacaoDoDocumento(ctx: ServiceCtx, regra: RegraDaClassificacao, par: ClassificacaoFinanceira, contexto: "lancamento" | "origem" | "confirmacao" = "lancamento", opcoes: { trava: boolean } = { trava: true }): Promise<ClassificacaoFinanceira> {
  const trava = opcoes.trava ? " for share" : "";
  const cat = await ctx.tx.query(`select 1 from erp.financial_categories where id=$1 and organization_id=$2 and deleted_at is null and is_active and kind='analytic' and nature = any($3::text[])${trava}`, [par.categoriaFinanceiraId, ctx.orgId, [...regra.naturezas]]);
  const cc = await ctx.tx.query(`select 1 from erp.cost_centers where id=$1 and organization_id=$2 and deleted_at is null and is_active and kind='analytic'${trava}`, [par.centroCustoId, ctx.orgId]);
  const texto = (base: string) => contexto === "origem" ? `A classificação do documento de origem deixou de valer. ${base}`
    : contexto === "confirmacao" ? regra.textoConfirmacao(base) : base;
  if (!cat.rowCount) throw recusaDeCampoDaClassificacao("categoria_financeira_id", texto(regra.msgCategoria));
  if (!cc.rowCount) throw recusaDeCampoDaClassificacao("centro_custo_id", texto(regra.msgCentro));
  return par;
}

/** A condição de pagamento lida do cadastro, no formato que `planoDaCondicao` consome. */
export type CondicaoDoDocumento = CondicaoPagamento & { id: string };
export const COLUNAS_CONDICAO = "id, parcelas, dias_primeira_parcela, modo, intervalo_dias, dia_vencimento, entrada, entrada_percentual::text as entrada_percentual";

/**
 * A PORTA ÚNICA DE VALIDAÇÃO da condição de pagamento. Inexistente, de outra organização, excluída e inativa caem
 * na MESMA recusa (422, mesmo código, mesma mensagem, mesmo campo). `for share` contra a inativação concorrente.
 */
export async function validarCondicaoDoDocumento(ctx: ServiceCtx, id: string): Promise<CondicaoDoDocumento> {
  const r = await ctx.tx.query<CondicaoDoDocumento>(`select ${COLUNAS_CONDICAO} from erp.condicoes_pagamento where id=$1 and organization_id=$2 and deleted_at is null and is_active for share`, [id, ctx.orgId]);
  if (!r.rows[0]) throw err(ERRO_CONDICAO_PAGAMENTO_INVALIDA, MSG_CONDICAO_PAGAMENTO_INVALIDA, [{ path: "condicao_pagamento_id", message: MSG_CONDICAO_PAGAMENTO_INVALIDA }]);
  return r.rows[0];
}

/** A condição que o documento JÁ tem: não revalidada; lida só para derivar o plano; recorte de organização sempre. */
export async function condicaoGravada(ctx: ServiceCtx, id: string): Promise<CondicaoDoDocumento | null> {
  const r = await ctx.tx.query<CondicaoDoDocumento>(`select ${COLUNAS_CONDICAO} from erp.condicoes_pagamento where id=$1 and organization_id=$2`, [id, ctx.orgId]);
  return r.rows[0] ?? null;
}
