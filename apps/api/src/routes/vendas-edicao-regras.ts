import type { SalesKind } from "@agro/domain";
import type { ServiceCtx } from "../lib/context.js";
import { partesDaOrigem, MSG_ORIGEM_COM_PARTES_ATIVAS_PUT, MSG_ORIGEM_COM_PARTES_CANCELADAS_PUT } from "./vendas-faturar-em-partes.js";
import { origemReservaEstoque } from "./vendas-reserva-estoque.js";

/**
 * EDITAR-01 (decisão 272) — AS RECUSAS DE ESTADO DA EDIÇÃO, num lugar só.
 *
 * O PUT, a PATCH e o `GET <base>/:id/edicao` fazem a MESMA pergunta ("este documento pode ser editado?"), e a
 * resposta tem de ser a mesma nos três: a tela que abre o lápis pelo `/edicao` não pode oferecer edição que a PATCH
 * recusa, nem esconder edição que ela aceita. Por isso a pergunta mora aqui, e as mensagens são as de hoje do PUT.
 *
 * Ordem = a do PUT: situação, depois origem com partes (ativas, depois só canceladas). `exigirTop` é só da PATCH e
 * do `/edicao`: o PUT continua aceitando documento legado (sem TOP), como sempre aceitou.
 */
export const MSG_DOCUMENTO_NAO_EDITAVEL = "Documento não editável neste status";
export const MSG_DOCUMENTO_SEM_TOP = "Este documento não tem tipo de operação (registro anterior às operações) e não pode ser editado.";

export async function recusaDaEdicao(ctx: ServiceCtx, doc: { id: string; status: string; tipo_operacao_id: string | null }, o: { exigirTop: boolean }): Promise<string | null> {
  if (doc.status !== "open" && doc.status !== "approved") return MSG_DOCUMENTO_NAO_EDITAVEL;
  const partes = await partesDaOrigem(ctx, doc.id);
  if (partes.ativas > 0) return MSG_ORIGEM_COM_PARTES_ATIVAS_PUT;
  if (partes.total > 0) return MSG_ORIGEM_COM_PARTES_CANCELADAS_PUT;
  if (o.exigirTop && doc.tipo_operacao_id === null) return MSG_DOCUMENTO_SEM_TOP;
  return null;
}

/**
 * OS LIMITES DE UMA EDIÇÃO PERMITIDA (TOP-CONFIG-06 e 07, as mesmas guardas do PUT):
 *   somenteArmazemEObservacao → a PARTE GERADA (algum item ligado a item de origem): só armazém e observação do item.
 *   armazemTravado            → a parte gerada de pedido que reserva estoque: nem o armazém.
 */
export async function limitesDaEdicao(ctx: ServiceCtx, kind: SalesKind, doc: { origin_document_id: string | null; items: readonly { origem_item_id: string | null }[] }): Promise<{ somenteArmazemEObservacao: boolean; armazemTravado: boolean }> {
  const somenteArmazemEObservacao = doc.items.some((i) => i.origem_item_id !== null);
  const armazemTravado = somenteArmazemEObservacao && kind === "sale" && doc.origin_document_id !== null
    ? await origemReservaEstoque(ctx, doc.origin_document_id) : false;
  return { somenteArmazemEObservacao, armazemTravado };
}
