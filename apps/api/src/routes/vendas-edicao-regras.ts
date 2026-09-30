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
 * O que `limitesDaEdicao` lê do documento — o formato do `getDoc` (`GET <base>/:id`), que o PUT, a PATCH e o
 * `/edicao` já carregam; nenhuma leitura a mais.
 *   id                 → o documento (o mesmo que o `getDoc` carregou);
 *   origin_document_id → a origem da venda gerada (pedido ou orçamento); `null` = lançada direto;
 *   items[].id         → o item GRAVADO (é por ele que a tela e a PATCH endereçam o limite);
 *   items[].origem_item_id → a ligação do item ao item de origem (TOP-CONFIG-06): algum preenchido = parte gerada;
 *   items[].product_control_stock → `p.control_stock` do join do `getDoc` (TOP-CONFIG-07): `false` = não reserva.
 */
export interface DocumentoParaLimites {
  id: string;
  origin_document_id: string | null;
  items: readonly { id: string; origem_item_id: string | null; product_control_stock: boolean | null }[];
}

/**
 * OS LIMITES DE UMA EDIÇÃO PERMITIDA (TOP-CONFIG-06 e 07) — a ÚNICA função que os calcula, para o PUT, a PATCH e o
 * `/edicao`: a tela trava exatamente o que a gravação recusa, item por item.
 *   somenteArmazemEObservacao → a PARTE GERADA (algum item ligado a item de origem): nos ITENS, só armazém e
 *                               observação mudam. O cabeçalho da parte continua editável.
 *   itens[]                   → um por item gravado, na ordem do documento.
 *     armazemTravado          → parte gerada ∧ venda gerada de pedido que RESERVA estoque (a versão congelada da
 *                               origem) ∧ o produto do item CONTROLA estoque. Item de produto sem controle de estoque
 *                               não reserva (a conta da reserva não o soma), então o armazém dele não carrega reserva
 *                               e fica LIVRE — é a regra da guarda do armazém em `salvarEdicao` (sales.ts).
 * Consultas: no máximo UMA (a reserva da origem), e só quando há item que ela poderia travar — nunca uma por item.
 */
export interface LimitesDaEdicao {
  somenteArmazemEObservacao: boolean;
  itens: { id: string; armazemTravado: boolean }[];
}

export async function limitesDaEdicao(ctx: ServiceCtx, kind: SalesKind, doc: DocumentoParaLimites): Promise<LimitesDaEdicao> {
  const somenteArmazemEObservacao = doc.items.some((i) => i.origem_item_id !== null);
  const reservaQueTrava = somenteArmazemEObservacao && kind === "sale" && doc.origin_document_id !== null
    && doc.items.some((i) => i.product_control_stock !== false)
    ? await origemReservaEstoque(ctx, doc.origin_document_id) : false;
  return {
    somenteArmazemEObservacao,
    itens: doc.items.map((i) => ({ id: i.id, armazemTravado: reservaQueTrava && i.product_control_stock !== false })),
  };
}
