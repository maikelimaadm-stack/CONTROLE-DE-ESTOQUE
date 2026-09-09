import type { ServiceCtx } from "../lib/context.js";
import { validation, err } from "../lib/errors.js";
import { money, qty as fqty, D } from "@agro/shared";

export interface StockPost {
  farmId: string; warehouseId: string; productId: string; movementType: string; direction: 1 | -1; quantity: string; unitCost?: string | null;
  providerLot?: string | null; expirationDate?: string | null; costCenterId?: string | null; harvestId?: string | null; cultivationId?: string | null;
  sourceType: string; sourceId: string; date: string; note?: string | null;
}

/** Valida produto/armazém e lança no ledger. Retorna saldo e custo após o lançamento. */
export async function postStock(ctx: ServiceCtx, p: StockPost): Promise<{ id: string; balanceAfter: string; avgCostAfter: string; unitCost: string }> {
  const prod = await ctx.tx.query<{ control_stock: boolean; has_lot: boolean; is_active: boolean }>("select control_stock, has_lot, is_active from erp.products where id=$1 and organization_id=$2 and deleted_at is null", [p.productId, ctx.orgId]);
  if (!prod.rows[0]) throw validation("Produto inválido");
  if (!prod.rows[0].control_stock) throw err("PRODUCT_NOT_STOCK_CONTROLLED", "Produto não controla estoque");
  const wh = await ctx.tx.query<{ farm_id: string; is_active: boolean }>("select farm_id, is_active from erp.warehouses where id=$1 and organization_id=$2 and deleted_at is null", [p.warehouseId, ctx.orgId]);
  if (!wh.rows[0]) throw validation("Armazém inválido");
  if (wh.rows[0].farm_id !== p.farmId) throw err("WAREHOUSE_FARM_MISMATCH", "Armazém não pertence à fazenda informada");
  if (D(p.quantity).lte(0)) throw validation("Quantidade deve ser positiva");
  let lot = p.providerLot ?? null;
  if (p.direction === -1 && prod.rows[0].has_lot && !lot) {
    // saída FIFO por validade quando o produto controla lote e o lote não foi informado
    const l = await ctx.tx.query<{ provider_lot: string }>("select provider_lot from erp.stock_balances where organization_id=$1 and warehouse_id=$2 and product_id=$3 and quantity >= $4 order by expiration_date nulls last limit 1", [ctx.orgId, p.warehouseId, p.productId, p.quantity]);
    lot = l.rows[0]?.provider_lot ?? null;
  }
  const r = await ctx.tx.query<{ id: string; balance_after: string; avg_cost_after: string; unit_cost: string }>(
    "insert into erp.stock_movements(organization_id,farm_id,warehouse_id,product_id,movement_type,direction,quantity,unit_cost,provider_lot,expiration_date,cost_center_id,harvest_id,cultivation_id,source_type,source_id,movement_date,note,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id, balance_after, avg_cost_after, unit_cost",
    [ctx.orgId, p.farmId, p.warehouseId, p.productId, p.movementType, p.direction, fqty(p.quantity), p.unitCost ? D(p.unitCost).toFixed(6) : "0", lot, p.expirationDate ?? null, p.costCenterId ?? null, p.harvestId ?? null, p.cultivationId ?? null, p.sourceType, p.sourceId, p.date, p.note ?? null, ctx.user.id]);
  const row = r.rows[0]!;
  return { id: row.id, balanceAfter: row.balance_after, avgCostAfter: row.avg_cost_after, unitCost: row.unit_cost };
}

/** Estorna todos os movimentos de uma origem (lança o inverso). Usado em cancelamentos. */
export async function reverseStock(ctx: ServiceCtx, sourceType: string, sourceId: string, date: string): Promise<number> {
  const ms = await ctx.tx.query<{ id: string; farm_id: string; warehouse_id: string; product_id: string; direction: number; quantity: string; unit_cost: string; provider_lot: string | null; cost_center_id: string | null; harvest_id: string | null }>(
    "select id,farm_id,warehouse_id,product_id,direction,quantity,unit_cost,provider_lot,cost_center_id,harvest_id from erp.stock_movements where organization_id=$1 and source_type=$2 and source_id=$3 and reversed_by is null and movement_type<>'reversal' order by created_at", [ctx.orgId, sourceType, sourceId]);
  for (const m of ms.rows) {
    const rev = await ctx.tx.query<{ id: string }>("insert into erp.stock_movements(organization_id,farm_id,warehouse_id,product_id,movement_type,direction,quantity,unit_cost,provider_lot,cost_center_id,harvest_id,source_type,source_id,movement_date,note,created_by) values ($1,$2,$3,$4,'reversal',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id",
      [ctx.orgId, m.farm_id, m.warehouse_id, m.product_id, -m.direction, m.quantity, m.unit_cost, m.provider_lot, m.cost_center_id, m.harvest_id, sourceType, sourceId, date, `estorno de ${m.id}`, ctx.user.id]);
    // marca o original como estornado via coluna (ledger imutável => usamos tabela de vínculo pela coluna reversed_by no estorno através de update permitido? não: ledger é imutável)
    void rev;
  }
  return ms.rowCount ?? 0;
}

export async function currentBalance(ctx: ServiceCtx, warehouseId: string, productId: string, lot: string | null = null) {
  const r = await ctx.tx.query<{ quantity: string; average_cost: string }>("select coalesce(sum(quantity),0) as quantity, coalesce(sum(total_value)/nullif(sum(quantity),0),0) as average_cost from erp.stock_balances where organization_id=$1 and warehouse_id=$2 and product_id=$3 and ($4::text is null or provider_lot=$4)", [ctx.orgId, warehouseId, productId, lot]);
  return { quantity: fqty(r.rows[0]!.quantity), averageCost: D(r.rows[0]!.average_cost).toFixed(6) };
}
export const lineTotal = (q: string, u: string) => money(D(q).mul(u));
