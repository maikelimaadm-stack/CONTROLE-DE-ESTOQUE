/**
 * FATURAR EM PARTES — AS LEITURAS DO BANCO (TOP-CONFIG-06, decisão 265).
 *
 * As contas moram no domínio (`faturamento-parcial.ts`); aqui só se LÊ o que elas consomem. Toda leitura é em
 * lote (uma consulta por pergunta, nunca por item) e roda DEPOIS da trava da origem quando alimenta uma escrita:
 * o saldo lido antes da trava seria o de outra transação.
 *
 * "PARTE" = documento com pelo menos um item cujo `origem_item_id` aponta um item da origem. `origin_document_id`
 * sozinho não basta: a conversão sem "Em partes" também o grava, e aquele derivado não é parte de nada.
 */
import { D } from "@agro/shared";
import { especieNaFrase, type ItemDeOrigem, type ValoresDoCabecalho } from "@agro/domain";
import type { ServiceCtx } from "../lib/context.js";

/** Os itens da origem com o que já foi para partes NÃO canceladas — uma consulta. */
export async function itensDeOrigemComSaldo(ctx: ServiceCtx, origemId: string): Promise<(ItemDeOrigem & { warehouseId: string | null; note: string | null })[]> {
  const r = await ctx.tx.query<{ id: string; product_id: string; warehouse_id: string | null; note: string | null; quantity: string; unit_price: string; discount: string; discount_percent: string; faturado: string; desconto_alocado: string }>(
    `select i.id, i.product_id, i.warehouse_id, i.note, i.quantity::text, i.unit_price::text, i.discount::text, i.discount_percent::text,
            coalesce(l.faturado, 0)::text as faturado, coalesce(l.desconto, 0)::text as desconto_alocado
       from erp.sales_document_items i
       left join lateral (
         select sum(p.quantity) as faturado, sum(p.discount) as desconto
           from erp.sales_document_items p join erp.sales_documents pd on pd.id = p.document_id
          where p.origem_item_id = i.id and pd.status <> 'cancelled') l on true
      where i.document_id = $1
      order by i.position`, [origemId]);
  return r.rows.map((x) => ({ id: x.id, productId: x.product_id, warehouseId: x.warehouse_id, note: x.note, quantity: x.quantity, unitPrice: x.unit_price,
    discount: x.discount, discountPercent: x.discount_percent, faturado: x.faturado, descontoAlocado: x.desconto_alocado }));
}

/** O cabeçalho já levado por partes não canceladas desta origem — uma consulta. */
export async function cabecalhoJaAlocado(ctx: ServiceCtx, origemId: string): Promise<ValoresDoCabecalho> {
  const r = await ctx.tx.query<{ freight: string; freight_icms: string; other_values: string; discount: string; entrada: string }>(
    `select coalesce(sum(d.freight), 0)::text as freight, coalesce(sum(d.freight_icms), 0)::text as freight_icms,
            coalesce(sum(d.other_values), 0)::text as other_values, coalesce(sum(d.discount), 0)::text as discount,
            coalesce(sum(case when (d.installment_plan->>'has_down_payment')::boolean
                              then nullif(d.installment_plan->>'down_payment_value', '')::numeric end), 0)::text as entrada
       from erp.sales_documents d
      where d.origin_document_id = $1 and d.organization_id = $2 and d.status <> 'cancelled'
        and exists (select 1 from erp.sales_document_items p where p.document_id = d.id and p.origem_item_id is not null)`,
    [origemId, ctx.orgId]);
  const x = r.rows[0]!;
  return { freight: x.freight, freightIcms: x.freight_icms, otherValues: x.other_values, discount: x.discount, entrada: x.entrada };
}

/** Quantas partes este documento gerou: `ativas` (não canceladas) e `total` (inclusive canceladas). */
export async function partesDaOrigem(ctx: ServiceCtx, origemId: string): Promise<{ ativas: number; total: number }> {
  const r = await ctx.tx.query<{ ativas: number; total: number }>(
    `select count(distinct pd.id) filter (where pd.status <> 'cancelled')::int as ativas, count(distinct pd.id)::int as total
       from erp.sales_document_items oi
       join erp.sales_document_items p on p.origem_item_id = oi.id
       join erp.sales_documents pd on pd.id = p.document_id
      where oi.document_id = $1`, [origemId]);
  return r.rows[0] ?? { ativas: 0, total: 0 };
}

/** O saldo inteiro do documento (soma do saldo de todos os itens). */
export function saldoTotal(itens: readonly Pick<ItemDeOrigem, "quantity" | "faturado">[]): ReturnType<typeof D> {
  return itens.reduce((a, i) => { const s = D(i.quantity).minus(i.faturado); return s.gt(0) ? a.plus(s) : a; }, D(0));
}

export const MSG_NAO_PERMITE_EM_PARTES = "Esta operação não permite converter em partes.";
export const MSG_SEM_SALDO_PARA_CONVERTER = "Não há saldo para converter.";
export const MSG_SEM_PARTES = "Este documento não tem partes geradas.";
export const MSG_SEM_SALDO_A_ENCERRAR = "Não há saldo a encerrar.";
/** Nem cancelar as partes nem encerrar o saldo libera a troca dos itens: a mensagem diz o que dá para fazer. */
export const MSG_ORIGEM_COM_PARTES_ATIVAS_PUT = "Este documento já tem partes geradas, e os itens não podem mais ser trocados. Para faturar o resto, converta outra parte; para parar, encerre o saldo.";
export const MSG_ORIGEM_COM_PARTES_CANCELADAS_PUT = "Este documento já teve partes geradas; os itens não podem mais ser trocados.";
export const MSG_ORIGEM_COM_PARTES_ATIVAS_CANCEL = "Cancele antes as partes geradas deste documento, ou encerre o saldo.";
/**
 * A parte com os itens trocados. As ESPÉCIES vêm dos documentos (a da parte, pela rota; a da origem, pela linha
 * lida): a origem pode ser um orçamento, e a parte pode ser um pedido — "desta venda … do pedido" era fixo.
 */
export const msgItensDaParte = (kindDaParte: string, kindDaOrigem: string | null | undefined, codigoOrigem: string | null | undefined) => {
  const parte = especieNaFrase(kindDaParte);
  const origem = codigoOrigem ? `${especieNaFrase(kindDaOrigem).do} ${codigoOrigem}` : "do documento de origem";
  return `Os itens ${parte.deste} vieram ${origem}. Para mudar, cancele ${parte.este} e gere de novo.`;
};
