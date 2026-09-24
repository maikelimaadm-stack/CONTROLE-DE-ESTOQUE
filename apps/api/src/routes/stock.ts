import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { D, money, isISODate } from "@agro/shared";
import { batchCost, tipoEntidadeDaTabela } from "@agro/domain";
import { runService, nextCode, idempotent, audit, assertPeriodOpen } from "../lib/service.js";
import { notFound, validation, err } from "../lib/errors.js";
import { consultaEscopada, empresaScope, empresaScopePar, exigirEmpresaDeLancamento, exigirEmpresaVisivel, empresaPermitida, empresaScopeSql, scopedById, type ServiceCtx } from "../lib/context.js";
import { empresasDisponiveis } from "../lib/empresa.js";
import { pageQuerySchema } from "../lib/pagination.js";
import { wrapListing } from "../lib/column-filters.js";
import { postStock, reverseStock, currentBalance, lineTotal } from "../services/stock-core.js";
import { createTitles, createBankMovement, apportionmentSchema, installmentPlanSchema } from "../services/financial-core.js";
import { atribuirIdGlobal, paginaComIdGlobal } from "../lib/id-global.js";
import { SEQUENCIA_WAREHOUSE_TRANSFER } from "../lib/sequencia-warehouse-transfer.js";

const dec = z.union([z.number(), z.string()]).transform((v) => String(v));
const date = z.string().refine(isISODate, "Data inválida");
const uuid = z.string().uuid();
/**
 * LOTE NA BORDA DA API (R1-1 f): aparado; vazio depois de aparar é "sem lote" (null). O saldo é chaveado pelo TEXTO
 * do lote — " L-1" e "L-1" seriam dois lotes do mesmo produto no mesmo armazém —, e por isso o que o item grava, a
 * conta do saldo atual da correção e a conferência de duplicidade do saldo inicial usam o MESMO texto aparado que o
 * movimento grava.
 */
const lote = z.string().trim().nullish().transform((v) => (v ? v : null));
const loteAte60 = z.string().trim().max(60).nullish().transform((v) => (v ? v : null));
const idem = (req: { headers: Record<string, unknown> }) => req.headers["idempotency-key"] as string | undefined;

const exigirEmpresa = (ctx: ServiceCtx, empresaId: string) => exigirEmpresaDeLancamento(ctx, empresaId);
/** Documento carregado por id para cancelar/estornar: fora do escopo de fazendas → 404. */
async function loadForWrite(ctx: ServiceCtx, table: string, id: string, what = "Documento") { const r = await ctx.tx.query<{ status: string; empresa_id: string | null }>(`select status, empresa_id from erp.${table} where id=$1 and organization_id=$2 for update`, [id, ctx.orgId]); if (!r.rows[0]) throw notFound(what); await exigirEmpresaVisivel(ctx, r.rows[0].empresa_id, what); return r.rows[0]; }
async function listDocs(ctx: ServiceCtx, table: string, dateCol: string, query: Record<string, unknown>, extraSelect = "", joins = "", opts: { softDelete?: boolean } = {}) {
  const q = pageQuerySchema.parse(query); const f = query as Record<string, string>;
  // feed_batches não tem deleted_at (cancelamento é por status): sem o filtro de soft delete a listagem quebrava com "column d.deleted_at does not exist"
  const where = ["d.organization_id=$1", ...(opts.softDelete === false ? [] : ["d.deleted_at is null"])]; const params: unknown[] = [ctx.orgId];
  if (f.empresa_id) { params.push(f.empresa_id); where.push(`d.empresa_id=$${params.length}`); } else if (ctx.empresaId) { params.push(ctx.empresaId); where.push(`d.empresa_id=$${params.length}`); }
  where.push(...empresaScope(ctx, "d", params, { ignoreSelected: true }));
  if (f.start_date) { params.push(f.start_date); where.push(`d.${dateCol} >= $${params.length}`); }
  if (f.end_date) { params.push(f.end_date); where.push(`d.${dateCol} <= $${params.length}`); }
  if (f.status) { params.push(f.status); where.push(`d.status=$${params.length}`); }
  if (f.search) { params.push(`%${f.search}%`); where.push(`(d.code ilike $${params.length} or coalesce(d.note,'') ilike $${params.length})`); }
  if (f.warehouse_id) { params.push(f.warehouse_id); where.push(`(d.warehouse_id=$${params.length})`); }
  // filtros genéricos por coluna (chips de qualquer coluna exibida) aplicados sobre o resultado (CTE)
  const w = wrapListing(`select d.*, f.name as empresa_name, u.name as created_by_name ${extraSelect} from erp.${table} d left join erp.empresas f on f.id=d.empresa_id left join erp.users u on u.id=d.created_by ${joins} where ${where.join(" and ")} order by d.${dateCol} desc, d.created_at desc`, params, query, q);
  const total = await ctx.tx.query<{ n: string }>(w.countSql, w.params);
  const r = await ctx.tx.query(w.pageSql, w.params);
  const pagina = { items: r.rows as Record<string, unknown>[], total: Number(total.rows[0]!.n), page: q.page, pageSize: q.pageSize };
  // O tipo de entidade sai da TABELA que este helper já recebe — nada de `switch` por documento aqui dentro.
  const tipoEntidade = tipoEntidadeDaTabela(table);
  return tipoEntidade ? paginaComIdGlobal(ctx, tipoEntidade, pagina) : pagina;
}
/**
 * Detalhe de documento de estoque. `headerWarehouse`: o armazém está no cabeçalho (baixa direta) e as linhas
 * não têm warehouse_id/cost_center_id.
 * EXISTÊNCIA FUNCIONAL: documento com exclusão lógica marcada não existe aqui — a mesma existência da
 * listagem e do ID Global (docs/GLOBAL-ID-CONTRACT.md §5.1). Cancelado é outra coisa: continua visível.
 */
async function getDoc(ctx: ServiceCtx, table: string, id: string, itemsTable: string, fk: string, opts: { headerWarehouse?: boolean } = {}) {
  const d = await ctx.tx.query(`select d.*, f.name as empresa_name, u.name as created_by_name${opts.headerWarehouse ? ", hw.description as warehouse_name" : ""} from erp.${table} d left join erp.empresas f on f.id=d.empresa_id left join erp.users u on u.id=d.created_by${opts.headerWarehouse ? " left join erp.warehouses hw on hw.id=d.warehouse_id" : ""} where d.id=$1 and d.organization_id=$2 and d.deleted_at is null` + scopedById(ctx, "d", id).sql, scopedById(ctx, "d", id).params);
  if (!d.rows[0]) throw notFound("Documento");
  const itemJoins = opts.headerWarehouse ? `left join erp.${table} h on h.id=i.${fk} left join erp.warehouses w on w.id=h.warehouse_id left join erp.cost_centers cc on cc.id=h.cost_center_id` : "left join erp.warehouses w on w.id=i.warehouse_id left join erp.cost_centers cc on cc.id=i.cost_center_id";
  const items = await ctx.tx.query(`select i.*, p.description as product_name, p.code as product_code, mu.symbol as unit, w.description as warehouse_name, cc.name as cost_center_name from erp.${itemsTable} i join erp.products p on p.id=i.product_id left join erp.measurement_units mu on mu.id=p.measurement_id ${itemJoins} where i.${fk}=$1 order by i.id`, [id]);
  const movements = await ctx.tx.query("select id, movement_type, direction, quantity, unit_cost, total_cost, balance_after, movement_date from erp.stock_movements where organization_id=$1 and source_type=$2 and source_id=$3 order by created_at", [ctx.orgId, table, id]);
  return { ...(d.rows[0] as Record<string, unknown>), items: items.rows, movements: movements.rows };
}

export default async function stockRoutes(app: FastifyInstance) {
  // ---------- Saldo de estoque ----------
  app.get("/stock/balances", async (req) => runService(app, req, "stocks.view", async (ctx) => {
    const q = pageQuerySchema.parse(req.query); const f = req.query as Record<string, string>;
    const where = ["sb.organization_id=$1", "sb.quantity <> 0"]; const params: unknown[] = [ctx.orgId];
    if (f.warehouse_id) { params.push(f.warehouse_id); where.push(`sb.warehouse_id=$${params.length}`); }
    if (f.empresa_id) { params.push(f.empresa_id); where.push(`w.empresa_id=$${params.length}`); } where.push(...empresaScope(ctx, "w", params, { ignoreSelected: Boolean(f.empresa_id) }));
    if (f.product_id) { params.push(f.product_id); where.push(`sb.product_id=$${params.length}`); }
    if (f.search) { params.push(`%${f.search}%`); where.push(`(p.description ilike $${params.length} or sb.provider_lot ilike $${params.length} or coalesce(p.active_principle,'') ilike $${params.length} or p.code ilike $${params.length})`); }
    if (f.below_min === "true") where.push("p.min_stock > 0 and sb.quantity <= p.min_stock");
    if (f.expiring_days) { params.push(Number(f.expiring_days)); where.push(`sb.expiration_date <= current_date + ($${params.length}::int)`); }
    const total = await ctx.tx.query<{ n: string; qty: string; value: string }>(`select count(*) n, coalesce(sum(sb.quantity),0) qty, coalesce(sum(sb.total_value),0) value from erp.stock_balances sb join erp.products p on p.id=sb.product_id join erp.warehouses w on w.id=sb.warehouse_id where ${where.join(" and ")}`, params);
    const sort = ["product_name", "quantity", "total_value", "warehouse_name", "expiration_date"].includes(q.sort ?? "") ? q.sort : "product_name";
    const r = await ctx.tx.query(`select sb.warehouse_id, sb.product_id, sb.provider_lot, sb.quantity, sb.average_cost, sb.total_value, sb.expiration_date, sb.updated_at, p.code as product_code, p.description as product_name, p.ncm_code, p.min_stock, mu.symbol as unit, w.description as warehouse_name, w.initials as warehouse_initials, f.name as empresa_name from erp.stock_balances sb join erp.products p on p.id=sb.product_id left join erp.measurement_units mu on mu.id=p.measurement_id join erp.warehouses w on w.id=sb.warehouse_id join erp.empresas f on f.id=w.empresa_id where ${where.join(" and ")} order by ${sort} ${q.dir ?? "asc"} limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`, params);
    return { items: r.rows, total: Number(total.rows[0]!.n), page: q.page, pageSize: q.pageSize, totals: { quantity: total.rows[0]!.qty, value: total.rows[0]!.value } };
  }));
  app.get("/stock/movements", async (req) => runService(app, req, "stocks.view", async (ctx) => {
    const q = pageQuerySchema.parse(req.query); const f = req.query as Record<string, string>;
    const where = ["m.organization_id=$1"]; const params: unknown[] = [ctx.orgId];
    if (f.product_id) { params.push(f.product_id); where.push(`m.product_id=$${params.length}`); }
    if (f.warehouse_id) { params.push(f.warehouse_id); where.push(`m.warehouse_id=$${params.length}`); }
    if (f.empresa_id) { params.push(f.empresa_id); where.push(`m.empresa_id=$${params.length}`); } where.push(...empresaScope(ctx, "m", params, { ignoreSelected: Boolean(f.empresa_id) }));
    if (f.movement_type) { params.push(f.movement_type); where.push(`m.movement_type=$${params.length}`); }
    if (f.start_date) { params.push(f.start_date); where.push(`m.movement_date>=$${params.length}`); }
    if (f.end_date) { params.push(f.end_date); where.push(`m.movement_date<=$${params.length}`); }
    if (f.cost_center_id) { params.push(f.cost_center_id); where.push(`m.cost_center_id=$${params.length}`); }
    const wl = wrapListing(`select m.*, p.description as product_name, p.code as product_code, mu.symbol as unit, w.description as warehouse_name, cc.name as cost_center_name, u.name as created_by_name from erp.stock_movements m join erp.products p on p.id=m.product_id left join erp.measurement_units mu on mu.id=p.measurement_id join erp.warehouses w on w.id=m.warehouse_id left join erp.cost_centers cc on cc.id=m.cost_center_id left join erp.users u on u.id=m.created_by where ${where.join(" and ")} order by m.movement_date desc, m.created_at desc`, params, req.query as Record<string, unknown>, q, ", coalesce(sum(case when t.direction=1 then t.quantity end),0)::text in_qty, coalesce(sum(case when t.direction=-1 then t.quantity end),0)::text out_qty");
    const total = await ctx.tx.query<{ n: string; in_qty: string; out_qty: string }>(wl.countSql, wl.params);
    const r = await ctx.tx.query(wl.pageSql, wl.params);
    return { items: r.rows, total: Number(total.rows[0]!.n), page: q.page, pageSize: q.pageSize, totals: { in: total.rows[0]!.in_qty, out: total.rows[0]!.out_qty } };
  }));
  app.get("/stock/balances/:warehouseId/:productId", async (req) => runService(app, req, "stocks.view", async (ctx) => { const { warehouseId, productId } = req.params as { warehouseId: string; productId: string }; const wh = await ctx.tx.query<{ empresa_id: string }>("select empresa_id from erp.warehouses where id=$1 and organization_id=$2", [warehouseId, ctx.orgId]); if (!wh.rows[0]) throw notFound("Armazém"); await exigirEmpresaVisivel(ctx, wh.rows[0].empresa_id, "Armazém"); const b = await currentBalance(ctx, warehouseId, productId); const lots = await ctx.tx.query("select provider_lot, quantity, average_cost, total_value, expiration_date from erp.stock_balances where organization_id=$1 and warehouse_id=$2 and product_id=$3 and quantity<>0 order by expiration_date nulls last", [ctx.orgId, warehouseId, productId]); return { ...b, lots: lots.rows }; }));

  // ---------- Estoque inicial ----------
  const openingSchema = z.object({ empresa_id: uuid, warehouse_id: uuid, product_id: uuid, quantity: dec, unit_value: dec, provider_lot: loteAte60, expiration_date: date.optional().nullable(), cultivation_id: uuid.optional().nullable() });
  app.get("/stock/opening-balances", async (req) => runService(app, req, "opening_balances.view", async (ctx) => {
    const q = pageQuerySchema.parse(req.query); const f = req.query as Record<string, string>;
    const where = ["o.organization_id=$1"]; const params: unknown[] = [ctx.orgId]; where.push(...empresaScope(ctx, "o", params));
    if (f.warehouse_id) { params.push(f.warehouse_id); where.push(`o.warehouse_id=$${params.length}`); }
    if (f.search) { params.push(`%${f.search}%`); where.push(`p.description ilike $${params.length}`); }
    const total = await ctx.tx.query<{ n: string }>(`select count(*) n from erp.opening_balances o join erp.products p on p.id=o.product_id where ${where.join(" and ")}`, params);
    const r = await ctx.tx.query(`select o.*, p.description as product_name, p.code as product_code, mu.symbol as unit, w.description as warehouse_name from erp.opening_balances o join erp.products p on p.id=o.product_id left join erp.measurement_units mu on mu.id=p.measurement_id join erp.warehouses w on w.id=o.warehouse_id where ${where.join(" and ")} order by o.created_at desc limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`, params);
    return { items: r.rows, total: Number(total.rows[0]!.n), page: q.page, pageSize: q.pageSize };
  }));
  app.post("/stock/opening-balances", async (req, reply) => reply.status(201).send(await runService(app, req, "opening_balances.create", async (ctx) => {
    const d = openingSchema.parse(req.body); await exigirEmpresa(ctx, d.empresa_id);
    return (await idempotent(ctx.tx, ctx.orgId, idem(req), d, async () => {
      // o lote já vem aparado; o gravado antes do R1-1 pode ter espaços — a conferência apara os dois lados
      const exists = await ctx.tx.query("select 1 from erp.opening_balances where organization_id=$1 and warehouse_id=$2 and product_id=$3 and nullif(btrim(provider_lot),'') is not distinct from $4::text and status='confirmed'", [ctx.orgId, d.warehouse_id, d.product_id, d.provider_lot]);
      if (exists.rowCount) throw err("DUPLICATE_DOCUMENT", "Já existe estoque inicial confirmado para este produto/armazém/lote");
      const total = lineTotal(d.quantity, d.unit_value);
      const r = await ctx.tx.query<{ id: string }>("insert into erp.opening_balances(organization_id,empresa_id,warehouse_id,product_id,quantity,unit_value,total_value,provider_lot,expiration_date,cultivation_id,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id", [ctx.orgId, d.empresa_id, d.warehouse_id, d.product_id, d.quantity, d.unit_value, total, d.provider_lot ?? null, d.expiration_date ?? null, d.cultivation_id ?? null, ctx.user.id]);
      await postStock(ctx, { empresaId: d.empresa_id, warehouseId: d.warehouse_id, productId: d.product_id, movementType: "opening_balance", direction: 1, quantity: d.quantity, unitCost: d.unit_value, providerLot: d.provider_lot, expirationDate: d.expiration_date, cultivationId: d.cultivation_id, sourceType: "opening_balances", sourceId: r.rows[0]!.id, date: new Date().toISOString().slice(0, 10) });
      await audit(ctx.tx, ctx, "opening_balances", r.rows[0]!.id, "create", d);
      return { id: r.rows[0]!.id, total_value: total };
    })).result;
  })));
  app.delete("/stock/opening-balances/:id", async (req) => runService(app, req, "opening_balances.delete", async (ctx) => {
    const { id } = req.params as { id: string };
    const o_ = await loadForWrite(ctx, "opening_balances", id, "Estoque inicial"); const o = { rows: [o_] as [typeof o_] }; if (o.rows[0].status === "reversed") throw err("ALREADY_CANCELLED", "Já estornado");
    await reverseStock(ctx, "opening_balances", id, new Date().toISOString().slice(0, 10));
    await ctx.tx.query("update erp.opening_balances set status='reversed', updated_at=now() where id=$1", [id]);
    await audit(ctx.tx, ctx, "opening_balances", id, "reverse");
    return { id, reversed: true };
  }));

  // ---------- Entrada de insumos (sem NF) ----------
  const entryItem = z.object({ product_id: uuid, measurement_id: uuid.optional().nullable(), quantity: dec, unit_value: dec, generate_stock: z.boolean().default(true), warehouse_id: uuid.optional().nullable(), appropriation_type: z.enum(["livestock", "maintenance", "fuel"]).optional().nullable(), provider_lot: lote, expiration_date: date.optional().nullable(), cultivation_id: uuid.optional().nullable(), financial_category_id: uuid.optional().nullable(), cost_center_id: uuid.optional().nullable() });
  const entrySchema = z.object({ empresa_id: uuid, entry_date: date, harvest_id: uuid.optional().nullable(), proprietary_id: uuid.optional().nullable(), note: z.string().max(2000).optional().nullable(), items: z.array(entryItem).min(1), bank_movement: z.object({ account_id: uuid, date: date }).optional().nullable() });
  app.get("/stock/input-entries", async (req) => runService(app, req, "input_entries.view", (ctx) => listDocs(ctx, "input_entries", "entry_date", req.query as Record<string, unknown>, ", (select count(*) from erp.input_entry_items i where i.entry_id=d.id)::int as item_count")));
  app.get("/stock/input-entries/:id", async (req) => runService(app, req, "input_entries.view", (ctx) => getDoc(ctx, "input_entries", (req.params as { id: string }).id, "input_entry_items", "entry_id")));
  app.post("/stock/input-entries", async (req, reply) => reply.status(201).send(await runService(app, req, "input_entries.create", async (ctx) => {
    const d = entrySchema.parse(req.body); await exigirEmpresa(ctx, d.empresa_id);
    return (await idempotent(ctx.tx, ctx.orgId, idem(req), d, async () => {
      await assertPeriodOpen(ctx.tx, ctx.orgId, d.empresa_id, d.entry_date);
      const code = await nextCode(ctx.tx, ctx.orgId, "input_entry");
      const totalAmount = money(d.items.reduce((a, i) => a.plus(D(i.quantity).mul(i.unit_value)), D(0)));
      const r = await ctx.tx.query<{ id: string }>("insert into erp.input_entries(organization_id,empresa_id,code,entry_date,harvest_id,proprietary_id,responsible_user_id,note,total_amount,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$7) returning id", [ctx.orgId, d.empresa_id, code, d.entry_date, d.harvest_id ?? null, d.proprietary_id ?? null, ctx.user.id, d.note ?? null, totalAmount]);
      const id = r.rows[0]!.id;
      await atribuirIdGlobal(ctx, "input_entries", id);
      for (const [i, it] of d.items.entries()) {
        if (it.generate_stock && !it.warehouse_id) throw validation(`Item ${i + 1}: armazém obrigatório quando gera estoque`);
        await ctx.tx.query("insert into erp.input_entry_items(entry_id,product_id,measurement_id,quantity,unit_value,total_value,generate_stock,warehouse_id,appropriation_type,provider_lot,expiration_date,cultivation_id,financial_category_id,cost_center_id,position) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)", [id, it.product_id, it.measurement_id ?? null, it.quantity, it.unit_value, lineTotal(it.quantity, it.unit_value), it.generate_stock, it.warehouse_id ?? null, it.appropriation_type ?? null, it.provider_lot ?? null, it.expiration_date ?? null, it.cultivation_id ?? null, it.financial_category_id ?? null, it.cost_center_id ?? null, i]);
        if (it.generate_stock) { await postStock(ctx, { empresaId: d.empresa_id, warehouseId: it.warehouse_id!, productId: it.product_id, movementType: "entry", direction: 1, quantity: it.quantity, unitCost: it.unit_value, providerLot: it.provider_lot, expirationDate: it.expiration_date, costCenterId: it.cost_center_id, harvestId: d.harvest_id, cultivationId: it.cultivation_id, sourceType: "input_entries", sourceId: id, date: d.entry_date }); await ctx.tx.query("update erp.products set last_purchase_date=$2 where id=$1", [it.product_id, d.entry_date]); }
      }
      if (d.bank_movement) {
        const lines = d.items.filter((i) => i.financial_category_id && i.cost_center_id).map((i) => ({ financialCategoryId: i.financial_category_id!, costCenterId: i.cost_center_id!, amount: lineTotal(i.quantity, i.unit_value) }));
        const bm = await createBankMovement(ctx, { empresaId: d.empresa_id, bankAccountId: d.bank_movement.account_id, date: d.bank_movement.date, type: "out", amount: totalAmount, note: `Entrada de insumos ${code}`, proprietaryId: d.proprietary_id, harvestId: d.harvest_id, sourceType: "input_entries", sourceId: id, apportionment: lines.length ? lines : undefined });
        await ctx.tx.query("update erp.input_entries set bank_movement_id=$2 where id=$1", [id, bm]);
      }
      await audit(ctx.tx, ctx, "input_entries", id, "create", { code, total: totalAmount });
      return { id, code, total_amount: totalAmount };
    })).result;
  })));
  app.post("/stock/input-entries/:id/cancel", async (req) => runService(app, req, "input_entries.delete", async (ctx) => {
    const { id } = req.params as { id: string };
    await loadForWrite(ctx, "input_entries", id, "Entrada"); const e = await ctx.tx.query<{ status: string; bank_movement_id: string | null; entry_date: string }>("select status, bank_movement_id, entry_date from erp.input_entries where id=$1 and organization_id=$2 for update", [id, ctx.orgId]); if (!e.rows[0]) throw notFound(); if (e.rows[0].status === "cancelled") throw err("ALREADY_CANCELLED", "Entrada já cancelada");
    await reverseStock(ctx, "input_entries", id, new Date().toISOString().slice(0, 10));
    if (e.rows[0].bank_movement_id) await ctx.tx.query("update erp.bank_movements set status='cancelled' where id=$1", [e.rows[0].bank_movement_id]);
    await ctx.tx.query("update erp.input_entries set status='cancelled', updated_at=now() where id=$1", [id]);
    await audit(ctx.tx, ctx, "input_entries", id, "cancel");
    return { id, status: "cancelled" };
  }));

  // ---------- Documento fiscal de entrada (NF) ----------
  const invoiceItem = z.object({ product_id: uuid, xml_product_description: z.string().optional().nullable(), measurement_id: uuid.optional().nullable(), quantity: dec, unit_value: dec, discount: dec.default("0"), ipi: dec.default("0"), icms: dec.default("0"), generate_stock: z.boolean().default(true), warehouse_id: uuid.optional().nullable(), appropriation_type: z.enum(["livestock", "maintenance", "fuel"]).optional().nullable(), provider_lot: lote, expiration_date: date.optional().nullable(), cultivation_id: uuid.optional().nullable(), financial_category_id: uuid.optional().nullable(), cost_center_id: uuid.optional().nullable(), is_equipment: z.boolean().default(false), equipment: z.record(z.string(), z.unknown()).optional().nullable(), grain_quality: z.record(z.string(), z.unknown()).optional().nullable() });
  const invoiceSchema = z.object({
    empresa_id: uuid, number: z.string().min(1).max(20), series: z.string().max(5).default("1"), access_key: z.string().length(44).optional().nullable(), provider_id: uuid, branch_id: uuid.optional().nullable(), proprietary_id: uuid.optional().nullable(), harvest_id: uuid.optional().nullable(),
    emission_date: date, delivery_date: date.optional().nullable(), state_code: z.string().length(2).optional().nullable(), document_type: z.enum(["nfe", "cte", "nfse", "nfce", "danfe", "darf", "dare", "gru", "other"]).default("nfe"), title_type_id: uuid.optional().nullable(),
    classification: z.enum(["unclassified", "capex", "opex"]).default("unclassified"), apportionment_type: z.enum(["by_value", "by_product"]).default("by_value"), note: z.string().optional().nullable(),
    freight: dec.default("0"), other_expenses: dec.default("0"), items: z.array(invoiceItem).min(1),
    generate_financial: z.boolean().default(true), apportionment: apportionmentSchema.optional(), plan: installmentPlanSchema.optional().nullable(), due_date: date.optional(), purchase_request_id: uuid.optional().nullable(), dfe_id: uuid.optional().nullable()
  });
  app.get("/stock/invoices", async (req) => runService(app, req, "invoices.view", async (ctx) => {
    const f = req.query as Record<string, string>; const extraWhere: string[] = []; const p: unknown[] = [];
    void extraWhere; void p;
    const res = await listDocs(ctx, "invoices", "emission_date", req.query as Record<string, unknown>, ", pr.name as provider_name, (select count(*) from erp.invoice_items i where i.invoice_id=d.id)::int as item_count", "left join erp.people pr on pr.id=d.provider_id");
    if (f.provider_id) res.items = res.items.filter((i) => (i as { provider_id: string }).provider_id === f.provider_id);
    return res;
  }));
  app.get("/stock/invoices/:id", async (req) => runService(app, req, "invoices.view", async (ctx) => {
    const id = (req.params as { id: string }).id;
    const doc = await getDoc(ctx, "invoices", id, "invoice_items", "invoice_id");
    const prov = await ctx.tx.query("select name, document from erp.people where id=$1", [(doc as unknown as { provider_id: string }).provider_id]);
    const app_ = await ctx.tx.query("select a.*, fc.name as category_name, cc.name as cost_center_name from erp.invoice_apportionments a join erp.financial_categories fc on fc.id=a.financial_category_id join erp.cost_centers cc on cc.id=a.cost_center_id where a.invoice_id=$1", [id]);
    const titles = await ctx.tx.query("select id, code, number, due_date, amount, balance, status from erp.financial_titles where organization_id=$1 and source_type='invoices' and source_id=$2 order by due_date", [ctx.orgId, id]);
    return { ...doc, provider: prov.rows[0], apportionments: app_.rows, titles: titles.rows };
  }));
  app.post("/stock/invoices", async (req, reply) => reply.status(201).send(await runService(app, req, "invoices.create", async (ctx) => {
    const d = invoiceSchema.parse(req.body); await exigirEmpresa(ctx, d.empresa_id);
    return (await idempotent(ctx.tx, ctx.orgId, idem(req), d, async () => {
      await assertPeriodOpen(ctx.tx, ctx.orgId, d.empresa_id, d.emission_date);
      const dup = await ctx.tx.query("select 1 from erp.invoices where organization_id=$1 and provider_id=$2 and number=$3 and series=$4 and status<>'cancelled' and deleted_at is null", [ctx.orgId, d.provider_id, d.number, d.series]);
      if (dup.rowCount) throw err("DUPLICATE_DOCUMENT", `Documento ${d.number}/${d.series} já lançado para este fornecedor`);
      const code = await nextCode(ctx.tx, ctx.orgId, "invoice");
      let products = D(0), disc = D(0), ipi = D(0), icms = D(0);
      for (const it of d.items) { products = products.plus(D(it.quantity).mul(it.unit_value)); disc = disc.plus(it.discount); ipi = ipi.plus(it.ipi); icms = icms.plus(it.icms); }
      const total = money(products.minus(disc).plus(ipi).plus(d.freight).plus(d.other_expenses));
      const r = await ctx.tx.query<{ id: string }>("insert into erp.invoices(organization_id,empresa_id,code,number,series,access_key,provider_id,branch_id,proprietary_id,harvest_id,emission_date,delivery_date,state_code,document_type,title_type_id,classification,apportionment_type,note,products_total,discount_total,ipi_total,icms_total,freight,other_expenses,total,origin,purchase_request_id,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28) returning id",
        [ctx.orgId, d.empresa_id, code, d.number, d.series, d.access_key ?? null, d.provider_id, d.branch_id ?? null, d.proprietary_id ?? null, d.harvest_id ?? null, d.emission_date, d.delivery_date ?? null, d.state_code ?? null, d.document_type, d.title_type_id ?? null, d.classification, d.apportionment_type, d.note ?? null, money(products), money(disc), money(ipi), money(icms), money(d.freight), money(d.other_expenses), total, d.purchase_request_id ? "purchase_request" : d.dfe_id ? "dfe" : d.access_key ? "xml" : "manual", d.purchase_request_id ?? null, ctx.user.id]);
      const id = r.rows[0]!.id;
      await atribuirIdGlobal(ctx, "invoices", id);
      const prodLines: { financialCategoryId: string; costCenterId: string; amount: string }[] = [];
      for (const [i, it] of d.items.entries()) {
        const itemTotal = money(D(it.quantity).mul(it.unit_value).minus(it.discount).plus(it.ipi));
        let equipmentId: string | null = null;
        if (it.is_equipment) {
          const eq = it.equipment ?? {};
          const ecode = await nextCode(ctx.tx, ctx.orgId, "equipment");
          const e = await ctx.tx.query<{ id: string }>("insert into erp.equipments(organization_id,empresa_id,code,description,family_id,equipment_type,proprietary_id,hour_value,year_model,brand,has_depreciation,acquisition_value,acquisition_date,provider_id,product_id,status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12,$13,$14,'active') returning id",
            [ctx.orgId, d.empresa_id, ecode, (eq["description"] as string) ?? it.xml_product_description ?? "Bem adquirido", (eq["family_id"] as string) ?? null, (eq["equipment_type"] as string) ?? "own", d.proprietary_id ?? null, eq["hour_value"] ?? 0, (eq["year_model"] as string) ?? String(new Date().getFullYear()), (eq["brand"] as string) ?? null, itemTotal, d.emission_date, d.provider_id, it.product_id]);
          equipmentId = e.rows[0]!.id;
          await atribuirIdGlobal(ctx, "equipments", equipmentId);
        }
        await ctx.tx.query("insert into erp.invoice_items(invoice_id,product_id,xml_product_description,measurement_id,quantity,unit_value,discount,ipi,icms,total,generate_stock,warehouse_id,appropriation_type,provider_lot,expiration_date,cultivation_id,financial_category_id,cost_center_id,is_equipment,equipment_id,grain_quality,position) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)",
          [id, it.product_id, it.xml_product_description ?? null, it.measurement_id ?? null, it.quantity, it.unit_value, it.discount, it.ipi, it.icms, itemTotal, it.generate_stock, it.warehouse_id ?? null, it.appropriation_type ?? null, it.provider_lot ?? null, it.expiration_date ?? null, it.cultivation_id ?? null, it.financial_category_id ?? null, it.cost_center_id ?? null, it.is_equipment, equipmentId, JSON.stringify(it.grain_quality ?? {}), i]);
        if (it.generate_stock) {
          if (!it.warehouse_id) throw validation(`Item ${i + 1}: armazém obrigatório quando gera estoque`);
          // custo unitário de entrada inclui IPI e rateio do frete por valor
          const share = products.isZero() ? D(0) : D(it.quantity).mul(it.unit_value).div(products);
          const cost = D(itemTotal).plus(share.mul(d.freight)).plus(share.mul(d.other_expenses)).div(it.quantity);
          await postStock(ctx, { empresaId: d.empresa_id, warehouseId: it.warehouse_id, productId: it.product_id, movementType: "invoice_entry", direction: 1, quantity: it.quantity, unitCost: cost.toFixed(6), providerLot: it.provider_lot, expirationDate: it.expiration_date, costCenterId: it.cost_center_id, harvestId: d.harvest_id, cultivationId: it.cultivation_id, sourceType: "invoices", sourceId: id, date: d.delivery_date ?? d.emission_date });
          await ctx.tx.query("update erp.products set last_purchase_date=$2 where id=$1", [it.product_id, d.emission_date]);
        }
        if (it.financial_category_id && it.cost_center_id) prodLines.push({ financialCategoryId: it.financial_category_id, costCenterId: it.cost_center_id, amount: itemTotal });
      }
      let titleIds: string[] = [];
      if (d.generate_financial) {
        let lines: { financialCategoryId: string; costCenterId: string; chartAccountId?: string | null; harvestId?: string | null; percentage?: string | number; amount?: string | number }[] = d.apportionment_type === "by_product" ? prodLines : (d.apportionment ?? []).map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, chartAccountId: a.chart_account_id ?? null, harvestId: a.harvest_id ?? null, percentage: a.percentage, amount: a.amount }));
        if (!lines.length) lines = prodLines;
        if (!lines.length) throw validation("Informe o rateio financeiro (natureza/centro de resultado) ou natureza e centro de resultado nos itens");
        if (d.apportionment_type === "by_product") { // ajusta frete/outros na última linha
          const sumLines = lines.reduce((a, l) => a.plus(l.amount ?? 0), D(0)); const diff = D(total).minus(sumLines); if (!diff.isZero()) { const last = lines[lines.length - 1]!; last.amount = money(D(last.amount ?? 0).plus(diff)); }
        }
        for (const l of lines) await ctx.tx.query("insert into erp.invoice_apportionments(invoice_id,financial_category_id,chart_account_id,cost_center_id,harvest_id,percentage,amount) values ($1,$2,$3,$4,$5,$6,$7)", [id, l.financialCategoryId, (l as { chartAccountId?: string | null }).chartAccountId ?? null, l.costCenterId, (l as { harvestId?: string | null }).harvestId ?? null, l.percentage ?? 0, l.amount ?? 0]);
        const created = await createTitles(ctx, { empresaId: d.empresa_id, direction: "payable", number: d.number, titleTypeId: d.title_type_id, personId: d.provider_id, proprietaryId: d.proprietary_id, branchId: d.branch_id, classification: d.classification, documentType: d.document_type, isDeductible: true, amount: total, emissionDate: d.emission_date, dueDate: d.plan?.first_due_date ?? d.due_date ?? d.emission_date, note: `NF ${d.number}/${d.series} ${d.note ?? ""}`.trim(), harvestId: d.harvest_id, apportionment: lines, sourceType: "invoices", sourceId: id, plan: d.plan ?? null });
        titleIds = created.ids;
      }
      if (d.purchase_request_id) await ctx.tx.query("update erp.purchase_requests set invoice_id=$2, invoice_number=$3 where id=$1 and organization_id=$4", [d.purchase_request_id, id, d.number, ctx.orgId]);
      if (d.dfe_id) await ctx.tx.query("update erp.dfe_documents set launch_status='launched', invoice_id=$2 where id=$1 and organization_id=$3", [d.dfe_id, id, ctx.orgId]);
      await audit(ctx.tx, ctx, "invoices", id, "create", { code, total, titles: titleIds.length });
      return { id, code, total, title_ids: titleIds };
    })).result;
  })));
  app.post("/stock/invoices/:id/cancel", async (req) => runService(app, req, "invoices.delete", async (ctx) => {
    const { id } = req.params as { id: string };
    const inv_ = await loadForWrite(ctx, "invoices", id, "Documento fiscal"); const inv = { rows: [inv_] as [typeof inv_] }; if (inv.rows[0].status === "cancelled") throw err("ALREADY_CANCELLED", "Documento já cancelado");
    const paid = await ctx.tx.query("select 1 from erp.financial_titles where organization_id=$1 and source_type='invoices' and source_id=$2 and paid_amount > 0 limit 1", [ctx.orgId, id]);
    if (paid.rowCount) throw err("CONFLICT", "Existem títulos com baixa: cancele as baixas antes");
    await reverseStock(ctx, "invoices", id, new Date().toISOString().slice(0, 10));
    await ctx.tx.query("update erp.financial_titles set status='cancelled', version=version+1 where organization_id=$1 and source_type='invoices' and source_id=$2", [ctx.orgId, id]);
    await ctx.tx.query("update erp.equipments set status='written_off' where id in (select equipment_id from erp.invoice_items where invoice_id=$1 and equipment_id is not null)", [id]);
    await ctx.tx.query("update erp.invoices set status='cancelled', updated_at=now() where id=$1", [id]);
    await audit(ctx.tx, ctx, "invoices", id, "cancel");
    return { id, status: "cancelled" };
  }));

  // ---------- Baixa de estoque ----------
  const writeoffSchema = z.object({ empresa_id: uuid, writeoff_date: date, reason: z.enum(["loss", "deterioration", "theft", "damage", "inventory", "accounting", "burglary", "expiration", "gift", "donation", "consumption", "payment_with_product", "other"]), reason_note: z.string().optional().nullable(), cost_center_id: uuid.optional().nullable(), warehouse_id: uuid, justification: z.string().min(3), items: z.array(z.object({ product_id: uuid, provider_lot: lote, quantity: dec })).min(1) });
  app.get("/stock/writeoffs", async (req) => runService(app, req, "stock_writeoffs.view", (ctx) => listDocs(ctx, "stock_writeoffs", "writeoff_date", req.query as Record<string, unknown>, ", w.description as warehouse_name", "left join erp.warehouses w on w.id=d.warehouse_id")));
  app.get("/stock/writeoffs/:id", async (req) => runService(app, req, "stock_writeoffs.view", (ctx) => getDoc(ctx, "stock_writeoffs", (req.params as { id: string }).id, "stock_writeoff_items", "writeoff_id", { headerWarehouse: true })));
  app.post("/stock/writeoffs", async (req, reply) => reply.status(201).send(await runService(app, req, "stock_writeoffs.create", async (ctx) => {
    const d = writeoffSchema.parse(req.body); await exigirEmpresa(ctx, d.empresa_id);
    return (await idempotent(ctx.tx, ctx.orgId, idem(req), d, async () => {
      const code = await nextCode(ctx.tx, ctx.orgId, "stock_writeoff");
      const r = await ctx.tx.query<{ id: string }>("insert into erp.stock_writeoffs(organization_id,empresa_id,code,writeoff_date,reason,reason_note,cost_center_id,warehouse_id,justification,responsible_user_id,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) returning id", [ctx.orgId, d.empresa_id, code, d.writeoff_date, d.reason, d.reason_note ?? null, d.cost_center_id ?? null, d.warehouse_id, d.justification, ctx.user.id]);
      const id = r.rows[0]!.id; let total = D(0);
      await atribuirIdGlobal(ctx, "stock_writeoffs", id);
      for (const it of d.items) {
        const m = await postStock(ctx, { empresaId: d.empresa_id, warehouseId: d.warehouse_id, productId: it.product_id, movementType: "writeoff", direction: -1, quantity: it.quantity, providerLot: it.provider_lot, costCenterId: d.cost_center_id, sourceType: "stock_writeoffs", sourceId: id, date: d.writeoff_date, note: d.reason });
        const t = lineTotal(it.quantity, m.unitCost); total = total.plus(t);
        await ctx.tx.query("insert into erp.stock_writeoff_items(writeoff_id,product_id,provider_lot,quantity,unit_value,total_value) values ($1,$2,$3,$4,$5,$6)", [id, it.product_id, it.provider_lot ?? null, it.quantity, m.unitCost, t]);
      }
      await ctx.tx.query("update erp.stock_writeoffs set total_amount=$2 where id=$1", [id, money(total)]);
      await audit(ctx.tx, ctx, "stock_writeoffs", id, "create", { code });
      return { id, code, total_amount: money(total) };
    })).result;
  })));
  app.post("/stock/writeoffs/:id/cancel", async (req) => runService(app, req, "stock_writeoffs.delete", async (ctx) => { const { id } = req.params as { id: string }; const w_ = await loadForWrite(ctx, "stock_writeoffs", id, "Baixa"); const w = { rows: [w_] as [typeof w_] }; if (w.rows[0].status === "cancelled") throw err("ALREADY_CANCELLED", "Já cancelada"); await reverseStock(ctx, "stock_writeoffs", id, new Date().toISOString().slice(0, 10)); await ctx.tx.query("update erp.stock_writeoffs set status='cancelled' where id=$1", [id]); await audit(ctx.tx, ctx, "stock_writeoffs", id, "cancel"); return { id, status: "cancelled" }; }));

  // ---------- Requisição/Saída ----------
  const reqSchema = z.object({ empresa_id: uuid, requisition_date: date, classification: z.enum(["unclassified", "capex", "opex"]).default("unclassified"), requester_person_id: uuid.optional().nullable(), area_id: uuid.optional().nullable(), harvest_id: uuid.optional().nullable(), items: z.array(z.object({ warehouse_id: uuid, product_id: uuid, provider_lot: lote, quantity: dec, cost_center_id: uuid.optional().nullable(), addressing: z.string().optional().nullable() })).min(1) });
  app.get("/stock/requisitions", async (req) => runService(app, req, "requisitions.view", async (ctx) => {
    const f = req.query as Record<string, string>;
    const res = await listDocs(ctx, "requisitions", "requisition_date", req.query as Record<string, unknown>, ", rp.name as requester_name, (select count(*) from erp.requisition_items i where i.requisition_id=d.id)::int as item_count, (select string_agg(p.description, ', ') from erp.requisition_items i join erp.products p on p.id=i.product_id where i.requisition_id=d.id) as items_summary", "left join erp.people rp on rp.id=d.requester_person_id");
    if (f.product_id || f.cost_center_id) { const ids = await ctx.tx.query<{ requisition_id: string }>("select distinct requisition_id from erp.requisition_items where ($1::uuid is null or product_id=$1) and ($2::uuid is null or cost_center_id=$2)", [f.product_id ?? null, f.cost_center_id ?? null]); const set = new Set(ids.rows.map((r) => r.requisition_id)); res.items = res.items.filter((i) => set.has((i as { id: string }).id)); }
    return res;
  }));
  app.get("/stock/requisitions/:id", async (req) => runService(app, req, "requisitions.view", (ctx) => getDoc(ctx, "requisitions", (req.params as { id: string }).id, "requisition_items", "requisition_id")));
  app.post("/stock/requisitions", async (req, reply) => reply.status(201).send(await runService(app, req, "requisitions.create", async (ctx) => {
    const d = reqSchema.parse(req.body); await exigirEmpresa(ctx, d.empresa_id);
    return (await idempotent(ctx.tx, ctx.orgId, idem(req), d, async () => {
      const code = await nextCode(ctx.tx, ctx.orgId, "requisition");
      const r = await ctx.tx.query<{ id: string }>("insert into erp.requisitions(organization_id,empresa_id,code,requisition_date,classification,requester_person_id,responsible_user_id,area_id,harvest_id,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$7) returning id", [ctx.orgId, d.empresa_id, code, d.requisition_date, d.classification, d.requester_person_id ?? null, ctx.user.id, d.area_id ?? null, d.harvest_id ?? null]);
      const id = r.rows[0]!.id; let total = D(0);
      await atribuirIdGlobal(ctx, "requisitions", id);
      for (const it of d.items) {
        const m = await postStock(ctx, { empresaId: d.empresa_id, warehouseId: it.warehouse_id, productId: it.product_id, movementType: "requisition", direction: -1, quantity: it.quantity, providerLot: it.provider_lot, costCenterId: it.cost_center_id, harvestId: d.harvest_id, sourceType: "requisitions", sourceId: id, date: d.requisition_date });
        const t = lineTotal(it.quantity, m.unitCost); total = total.plus(t);
        await ctx.tx.query("insert into erp.requisition_items(requisition_id,warehouse_id,product_id,provider_lot,quantity,unit_value,total_value,cost_center_id,addressing) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id, it.warehouse_id, it.product_id, it.provider_lot ?? null, it.quantity, m.unitCost, t, it.cost_center_id ?? null, it.addressing ?? null]);
      }
      await ctx.tx.query("update erp.requisitions set total_amount=$2 where id=$1", [id, money(total)]);
      await audit(ctx.tx, ctx, "requisitions", id, "create", { code });
      return { id, code, total_amount: money(total) };
    })).result;
  })));
  app.post("/stock/requisitions/:id/sign", async (req) => runService(app, req, "requisitions.edit", async (ctx) => { const { id } = req.params as { id: string }; const d = z.object({ signed_document_path: z.string().optional().nullable() }).parse(req.body ?? {}); const sp: unknown[] = [id, ctx.orgId, d.signed_document_path ?? null]; const u = await ctx.tx.query("update erp.requisitions set signature_status='signed', signed_document_path=coalesce($3,signed_document_path), updated_at=now() where id=$1 and organization_id=$2 and status='confirmed'" + empresaScopeSql(ctx, "empresa_id", sp) + " returning id", sp); if (!u.rowCount) throw notFound(); await audit(ctx.tx, ctx, "requisitions", id, "sign"); return { id, signature_status: "signed" }; }));
  app.post("/stock/requisitions/:id/cancel", async (req) => runService(app, req, "requisitions.delete", async (ctx) => { const { id } = req.params as { id: string }; const w_ = await loadForWrite(ctx, "requisitions", id, "Requisição"); const w = { rows: [w_] as [typeof w_] }; if (w.rows[0].status === "cancelled") throw err("ALREADY_CANCELLED", "Já cancelada"); await reverseStock(ctx, "requisitions", id, new Date().toISOString().slice(0, 10)); await ctx.tx.query("update erp.requisitions set status='cancelled', updated_at=now() where id=$1", [id]); await audit(ctx.tx, ctx, "requisitions", id, "cancel"); return { id, status: "cancelled" }; }));

  // ---------- Devolução/Entrada ----------
  // Devolução é ENTRADA avulsa: lote e validade do item são opcionais no contrato e exigidos pelo núcleo só para
  // produto com controle de lote (validade no "lote + validade") — R1-1 c.
  const devSchema = z.object({ empresa_id: uuid, devolution_date: date, responsible_person_id: uuid.optional().nullable(), harvest_id: uuid.optional().nullable(), items: z.array(z.object({ warehouse_id: uuid, product_id: uuid, quantity: dec, unit_value: dec.optional().nullable(), cost_center_id: uuid.optional().nullable(), provider_lot: lote, expiration_date: date.optional().nullable() })).min(1) });
  app.get("/stock/devolutions", async (req) => runService(app, req, "devolutions.view", (ctx) => listDocs(ctx, "devolutions", "devolution_date", req.query as Record<string, unknown>, ", rp.name as responsible_name", "left join erp.people rp on rp.id=d.responsible_person_id")));
  app.get("/stock/devolutions/:id", async (req) => runService(app, req, "devolutions.view", (ctx) => getDoc(ctx, "devolutions", (req.params as { id: string }).id, "devolution_items", "devolution_id")));
  app.post("/stock/devolutions", async (req, reply) => reply.status(201).send(await runService(app, req, "devolutions.create", async (ctx) => {
    const d = devSchema.parse(req.body); await exigirEmpresa(ctx, d.empresa_id);
    return (await idempotent(ctx.tx, ctx.orgId, idem(req), d, async () => {
      const code = await nextCode(ctx.tx, ctx.orgId, "devolution");
      const r = await ctx.tx.query<{ id: string }>("insert into erp.devolutions(organization_id,empresa_id,code,devolution_date,responsible_person_id,harvest_id,created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id", [ctx.orgId, d.empresa_id, code, d.devolution_date, d.responsible_person_id ?? null, d.harvest_id ?? null, ctx.user.id]);
      const id = r.rows[0]!.id; let total = D(0);
      await atribuirIdGlobal(ctx, "devolutions", id);
      for (const it of d.items) {
        const cost = it.unit_value ?? (await ctx.tx.query<{ average_cost: string }>("select average_cost from erp.products where id=$1", [it.product_id])).rows[0]!.average_cost;
        await postStock(ctx, { empresaId: d.empresa_id, warehouseId: it.warehouse_id, productId: it.product_id, movementType: "devolution", direction: 1, quantity: it.quantity, unitCost: cost, providerLot: it.provider_lot, expirationDate: it.expiration_date, costCenterId: it.cost_center_id, harvestId: d.harvest_id, sourceType: "devolutions", sourceId: id, date: d.devolution_date });
        const t = lineTotal(it.quantity, cost); total = total.plus(t);
        await ctx.tx.query("insert into erp.devolution_items(devolution_id,warehouse_id,product_id,quantity,unit_value,total_value,cost_center_id) values ($1,$2,$3,$4,$5,$6,$7)", [id, it.warehouse_id, it.product_id, it.quantity, cost, t, it.cost_center_id ?? null]);
      }
      await ctx.tx.query("update erp.devolutions set total_amount=$2 where id=$1", [id, money(total)]);
      await audit(ctx.tx, ctx, "devolutions", id, "create", { code });
      return { id, code, total_amount: money(total) };
    })).result;
  })));
  app.post("/stock/devolutions/:id/cancel", async (req) => runService(app, req, "devolutions.delete", async (ctx) => { const { id } = req.params as { id: string }; const w_ = await loadForWrite(ctx, "devolutions", id, "Devolução"); const w = { rows: [w_] as [typeof w_] }; if (w.rows[0].status === "cancelled") throw err("ALREADY_CANCELLED", "Já cancelada"); await reverseStock(ctx, "devolutions", id, new Date().toISOString().slice(0, 10)); await ctx.tx.query("update erp.devolutions set status='cancelled', updated_at=now() where id=$1", [id]); await audit(ctx.tx, ctx, "devolutions", id, "cancel"); return { id, status: "cancelled" }; }));

  // ---------- Correção de estoque ----------
  // `expiration_date`: validade do lote que ENTRA num ajuste para cima (exigida no "lote + validade"); num ajuste
  // para baixo o lote sai com a validade que já tem, e a validade informada é recusada (422), nunca ignorada.
  const corrSchema = z.object({ empresa_id: uuid, correction_date: date, warehouse_id: uuid, product_id: uuid, provider_lot: lote, expiration_date: date.optional().nullable(), new_quantity: dec, unit_value: dec.optional().nullable(), justification: z.string().min(3) });
  app.get("/stock/corrections", async (req) => runService(app, req, "stock_corrections.view", (ctx) => listDocs(ctx, "stock_corrections", "correction_date", { ...(req.query as Record<string, unknown>) }, ", p.description as product_name, w.description as warehouse_name", "left join erp.products p on p.id=d.product_id left join erp.warehouses w on w.id=d.warehouse_id").then((r) => r)));
  app.post("/stock/corrections", async (req, reply) => reply.status(201).send(await runService(app, req, "stock_corrections.create", async (ctx) => {
    const d = corrSchema.parse(req.body); await exigirEmpresa(ctx, d.empresa_id);
    return (await idempotent(ctx.tx, ctx.orgId, idem(req), d, async () => {
      const b = await currentBalance(ctx, d.warehouse_id, d.product_id, d.provider_lot);
      const diff = D(d.new_quantity).minus(b.quantity);
      if (diff.isZero()) throw validation("Nova quantidade igual ao saldo atual");
      if (diff.lt(0) && d.expiration_date) throw validation("A validade só é informada quando o ajuste aumenta o saldo.", [{ path: "expiration_date", message: "Validade só no ajuste para cima" }]);
      const code = await nextCode(ctx.tx, ctx.orgId, "stock_correction");
      const cost = d.unit_value ?? b.averageCost;
      const r = await ctx.tx.query<{ id: string }>("insert into erp.stock_corrections(organization_id,empresa_id,code,correction_date,warehouse_id,product_id,provider_lot,previous_quantity,new_quantity,unit_value,justification,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id", [ctx.orgId, d.empresa_id, code, d.correction_date, d.warehouse_id, d.product_id, d.provider_lot, b.quantity, d.new_quantity, cost, d.justification, ctx.user.id]);
      await postStock(ctx, { empresaId: d.empresa_id, warehouseId: d.warehouse_id, productId: d.product_id, movementType: diff.gt(0) ? "correction_in" : "correction_out", direction: diff.gt(0) ? 1 : -1, quantity: diff.abs().toFixed(4), unitCost: cost, providerLot: d.provider_lot, expirationDate: d.expiration_date, sourceType: "stock_corrections", sourceId: r.rows[0]!.id, date: d.correction_date, note: d.justification });
      await audit(ctx.tx, ctx, "stock_corrections", r.rows[0]!.id, "create", { code, diff: diff.toFixed(4) });
      return { id: r.rows[0]!.id, code, difference: diff.toFixed(4) };
    })).result;
  })));

  // ---------- Transferências (armazém e entre fazendas) ----------
  const transferSchema = z.object({ kind: z.enum(["warehouse", "farm"]), transfer_date: date, empresa_origem_id: uuid, origin_warehouse_id: uuid, empresa_destino_id: uuid.optional(), destination_warehouse_id: uuid, harvest_id: uuid.optional().nullable(), items: z.array(z.object({ product_id: uuid, provider_lot: lote, quantity: dec, cost_center_id: uuid.optional().nullable() })).min(1), generate_financial: z.boolean().default(false), proprietary_id: uuid.optional().nullable(), plan: installmentPlanSchema.optional().nullable(), income_apportionment: apportionmentSchema.optional(), expense_apportionment: apportionmentSchema.optional(), is_deductible: z.boolean().default(false) });
  app.get("/stock/transfers", async (req) => runService(app, req, "warehouse_transfers.view", async (ctx) => {
    const q = pageQuerySchema.parse(req.query); const f = req.query as Record<string, string>;
    const where = ["d.organization_id=$1", "d.deleted_at is null"]; const params: unknown[] = [ctx.orgId];
    if (f.kind) { params.push(f.kind); where.push(`d.kind=$${params.length}`); }
    if (ctx.empresaId) { params.push(ctx.empresaId); where.push(`(d.empresa_origem_id=$${params.length} or d.empresa_destino_id=$${params.length})`); } where.push(...empresaScopePar(ctx, ["d.empresa_origem_id", "d.empresa_destino_id"], params));
    if (f.start_date) { params.push(f.start_date); where.push(`d.transfer_date>=$${params.length}`); } if (f.end_date) { params.push(f.end_date); where.push(`d.transfer_date<=$${params.length}`); }
    const total = await ctx.tx.query<{ n: string }>(`select count(*) n from erp.warehouse_transfers d where ${where.join(" and ")}`, params);
    const r = await ctx.tx.query(`select d.*, wo.description as origin_warehouse_name, wd.description as destination_warehouse_name, fo.name as empresa_origem_name, fd.name as empresa_destino_name, u.name as created_by_name, (select count(*) from erp.warehouse_transfer_items i where i.transfer_id=d.id)::int as item_count from erp.warehouse_transfers d left join erp.warehouses wo on wo.id=d.origin_warehouse_id left join erp.warehouses wd on wd.id=d.destination_warehouse_id left join erp.empresas fo on fo.id=d.empresa_origem_id left join erp.empresas fd on fd.id=d.empresa_destino_id left join erp.users u on u.id=d.created_by where ${where.join(" and ")} order by d.transfer_date desc, d.created_at desc limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`, params);
    return paginaComIdGlobal(ctx, "warehouse_transfers", { items: r.rows as Record<string, unknown>[], total: Number(total.rows[0]!.n), page: q.page, pageSize: q.pageSize });
  }));
  app.get("/stock/transfers/:id", async (req) => runService(app, req, "warehouse_transfers.view", async (ctx) => {
    const id = (req.params as { id: string }).id;
    const d = await consultaEscopada(ctx, "select d.*, wo.description as origin_warehouse_name, wd.description as destination_warehouse_name, fo.name as empresa_origem_name, fd.name as empresa_destino_name from erp.warehouse_transfers d left join erp.warehouses wo on wo.id=d.origin_warehouse_id left join erp.warehouses wd on wd.id=d.destination_warehouse_id left join erp.empresas fo on fo.id=d.empresa_origem_id left join erp.empresas fd on fd.id=d.empresa_destino_id where d.id=$1 and d.organization_id=$2 and d.deleted_at is null and {{escopo_par:d.empresa_origem_id,d.empresa_destino_id}}", [id, ctx.orgId]); if (!d.rows[0]) throw notFound();
    const items = await ctx.tx.query("select i.*, p.description as product_name, p.code as product_code, mu.symbol as unit from erp.warehouse_transfer_items i join erp.products p on p.id=i.product_id left join erp.measurement_units mu on mu.id=p.measurement_id where i.transfer_id=$1", [id]);
    const titles = await ctx.tx.query("select id, code, direction, number, due_date, amount, balance, status from erp.financial_titles where organization_id=$1 and source_type='warehouse_transfers' and source_id=$2", [ctx.orgId, id]);
    return { ...d.rows[0], items: items.rows, titles: titles.rows };
  }));
  app.post("/stock/transfers", async (req, reply) => reply.status(201).send(await runService(app, req, "warehouse_transfers.create", async (ctx) => {
    const d = transferSchema.parse(req.body); await exigirEmpresa(ctx, d.empresa_origem_id);
    const destFarm = d.kind === "farm" ? d.empresa_destino_id : d.empresa_origem_id;
    if (!destFarm) throw validation("Fazenda destino obrigatória"); await exigirEmpresa(ctx, destFarm);
    if (d.kind === "farm" && destFarm === d.empresa_origem_id) throw validation("Transferência entre fazendas exige fazendas distintas");
    if (d.origin_warehouse_id === d.destination_warehouse_id) throw err("SAME_WAREHOUSE_TRANSFER", "Armazém de origem e destino iguais");
    return (await idempotent(ctx.tx, ctx.orgId, idem(req), d, async () => {
      // HOTFIX 0019: UM contador por namespace de unicidade. `erp.warehouse_transfers` tem
      // `unique (organization_id, code)` — sem `kind` —, então as duas variantes compartilham o
      // namespace e precisam compartilhar a sequência. Numerar por variante fazia as duas emitirem
      // `0001` e a segunda colidir com 409 (ver `lib/sequencia-warehouse-transfer.ts`).
      const code = await nextCode(ctx.tx, ctx.orgId, SEQUENCIA_WAREHOUSE_TRANSFER);
      const r = await ctx.tx.query<{ id: string }>("insert into erp.warehouse_transfers(organization_id,code,transfer_date,kind,empresa_origem_id,origin_warehouse_id,empresa_destino_id,destination_warehouse_id,harvest_id,generate_financial,proprietary_id,responsible_user_id,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) returning id", [ctx.orgId, code, d.transfer_date, d.kind, d.empresa_origem_id, d.origin_warehouse_id, destFarm, d.destination_warehouse_id, d.harvest_id ?? null, d.generate_financial, d.proprietary_id ?? null, ctx.user.id]);
      const id = r.rows[0]!.id; let total = D(0);
      await atribuirIdGlobal(ctx, "warehouse_transfers", id);
      for (const it of d.items) {
        const out = await postStock(ctx, { empresaId: d.empresa_origem_id, warehouseId: d.origin_warehouse_id, productId: it.product_id, movementType: d.kind === "farm" ? "farm_transfer_out" : "transfer_out", direction: -1, quantity: it.quantity, providerLot: it.provider_lot, costCenterId: it.cost_center_id, harvestId: d.harvest_id, sourceType: "warehouse_transfers", sourceId: id, date: d.transfer_date });
        // R1-1 c: a perna de ENTRADA espelha a de SAÍDA parte por parte — mesmo lote, mesma validade, mesma quantidade
        // e custo. Uma saída que a escolha automática dividiu em dois lotes chega ao destino como os mesmos dois lotes.
        for (const parte of out.partes) {
          await postStock(ctx, { empresaId: destFarm, warehouseId: d.destination_warehouse_id, productId: it.product_id, movementType: d.kind === "farm" ? "farm_transfer_in" : "transfer_in", direction: 1, quantity: parte.quantidade, unitCost: parte.unitCost, providerLot: parte.lote, expirationDate: parte.validade, costCenterId: it.cost_center_id, harvestId: d.harvest_id, sourceType: "warehouse_transfers", sourceId: id, date: d.transfer_date });
        }
        const t = lineTotal(it.quantity, out.unitCost); total = total.plus(t);
        await ctx.tx.query("insert into erp.warehouse_transfer_items(transfer_id,product_id,provider_lot,quantity,unit_value,total_value,cost_center_id) values ($1,$2,$3,$4,$5,$6,$7)", [id, it.product_id, it.provider_lot ?? null, it.quantity, out.unitCost, t, it.cost_center_id ?? null]);
      }
      await ctx.tx.query("update erp.warehouse_transfers set total_value=$2 where id=$1", [id, money(total)]);
      if (d.kind === "farm" && d.generate_financial) {
        if (!d.income_apportionment?.length || !d.expense_apportionment?.length) throw validation("Informe rateio a receber (origem) e a pagar (destino)");
        const toLines = (a: NonNullable<typeof d.income_apportionment>) => a.map((x) => ({ financialCategoryId: x.financial_category_id, costCenterId: x.cost_center_id, percentage: x.percentage, amount: x.amount }));
        await createTitles(ctx, { empresaId: d.empresa_origem_id, direction: "receivable", number: `TRF-${code}`, personId: null, proprietaryId: d.proprietary_id, amount: money(total), emissionDate: d.transfer_date, dueDate: d.plan?.first_due_date ?? d.transfer_date, note: `Transferência de estoque ${code} para outra fazenda`, harvestId: d.harvest_id, isDeductible: d.is_deductible, apportionment: toLines(d.income_apportionment), sourceType: "warehouse_transfers", sourceId: id, plan: d.plan ?? null });
        await createTitles(ctx, { empresaId: destFarm, direction: "payable", number: `TRF-${code}`, personId: null, proprietaryId: d.proprietary_id, amount: money(total), emissionDate: d.transfer_date, dueDate: d.plan?.first_due_date ?? d.transfer_date, note: `Conta a pagar vinda da transferência de estoque ${code}`, harvestId: d.harvest_id, isDeductible: d.is_deductible, apportionment: toLines(d.expense_apportionment), sourceType: "warehouse_transfers", sourceId: id, plan: d.plan ?? null });
      }
      await audit(ctx.tx, ctx, "warehouse_transfers", id, "create", { code, kind: d.kind });
      return { id, code, total_value: money(total) };
    })).result;
  })));
  app.post("/stock/transfers/:id/cancel", async (req) => runService(app, req, "warehouse_transfers.delete", async (ctx) => { const { id } = req.params as { id: string }; const w = await ctx.tx.query<{ status: string; empresa_origem_id: string; empresa_destino_id: string }>("select status, empresa_origem_id, empresa_destino_id from erp.warehouse_transfers where id=$1 and organization_id=$2 for update", [id, ctx.orgId]); if (!w.rows[0]) throw notFound();
    // CANCELAR EXIGE AS DUAS PONTAS — o mesmo que a CRIAÇÃO exige, porque desfaz exatamente o que ela fez.
    // Duas razões, e a segunda é a que corrompia dado: (1) a criação lança no ledger das duas empresas e
    // pode gerar título nos dois lados; (2) `reverseStock` lê `erp.stock_movements` pela RLS NORMAL, que é
    // recortada por empresa — quem enxerga uma ponta só estornava METADE do ledger e ainda assim marcava a
    // transferência como cancelada. O `&&` também estava quebrado: `empresaPermitida` é assíncrona e faltava
    // o `await`, então `!Promise` era sempre falso e a guarda inteira nunca disparava.
    const [origemOk, destinoOk] = [await empresaPermitida(ctx, w.rows[0].empresa_origem_id), await empresaPermitida(ctx, w.rows[0].empresa_destino_id)];
    if (!origemOk && !destinoOk) throw notFound("Transferência");
    if (!origemOk || !destinoOk) throw err("PERMISSION_DENIED", "Cancelar a transferência exige acesso às empresas de origem E de destino: o estorno desfaz o lançamento das duas");
    if (w.rows[0].status === "cancelled") throw err("ALREADY_CANCELLED", "Já cancelada");
    const paid = await ctx.tx.query("select 1 from erp.financial_titles where source_type='warehouse_transfers' and source_id=$1 and paid_amount>0", [id]); if (paid.rowCount) throw err("CONFLICT", "Títulos com baixa: cancele as baixas antes");
    // ROW COUNT: o estorno tem de alcançar TODOS os lançamentos da origem. Se a RLS escondeu algum, a
    // transação cai aqui — nunca "cancelada" com meio ledger revertido.
    const lancamentos = await ctx.tx.query<{ n: string }>("select count(*)::text n from erp.stock_movements where organization_id=$1 and source_type='warehouse_transfers' and source_id=$2 and movement_type<>'reversal'", [ctx.orgId, id]);
    const estornados = await reverseStock(ctx, "warehouse_transfers", id, new Date().toISOString().slice(0, 10));
    if (estornados !== Number(lancamentos.rows[0]!.n)) throw err("CONFLICT", "Estorno incompleto: a transferência tem lançamentos fora do alcance desta sessão");
    await ctx.tx.query("update erp.financial_titles set status='cancelled' where source_type='warehouse_transfers' and source_id=$1", [id]);
    const fim = await ctx.tx.query("update erp.warehouse_transfers set status='cancelled', updated_at=now() where id=$1 returning id", [id]);
    if (!fim.rowCount) throw err("CONFLICT", "Cancelamento não afetou a transferência");
    await audit(ctx.tx, ctx, "warehouse_transfers", id, "cancel", { estornados });
    return { id, status: "cancelled", reversals: estornados }; }));

  // ---------- Fábrica: formulação e batida ----------
  const formulaSchema = z.object({ name: z.string().min(1), description: z.string().optional().nullable(), product_id: uuid.optional().nullable(), items: z.array(z.object({ product_id: uuid, quantity: dec })).min(1) });
  app.get("/stock/feed-formulas", async (req) => runService(app, req, "feed_formulas.view", async (ctx) => { const r = await ctx.tx.query("select f.*, p.description as product_name, (select json_agg(json_build_object('product_id',i.product_id,'product_name',pp.description,'quantity',i.quantity,'percentage',i.percentage)) from erp.feed_formula_items i join erp.products pp on pp.id=i.product_id where i.formula_id=f.id) as items from erp.feed_formulas f left join erp.products p on p.id=f.product_id where f.organization_id=$1 and f.deleted_at is null order by f.name", [ctx.orgId]); return { items: r.rows, total: r.rowCount }; }));
  app.post("/stock/feed-formulas", async (req, reply) => reply.status(201).send(await runService(app, req, "feed_formulas.create", async (ctx) => {
    const d = formulaSchema.parse(req.body); const total = d.items.reduce((a, i) => a.plus(i.quantity), D(0)); const code = await nextCode(ctx.tx, ctx.orgId, "feed_formula");
    const r = await ctx.tx.query<{ id: string }>("insert into erp.feed_formulas(organization_id,code,name,description,product_id,total_quantity) values ($1,$2,$3,$4,$5,$6) returning id", [ctx.orgId, code, d.name, d.description ?? null, d.product_id ?? null, total.toFixed(4)]);
    for (const it of d.items) await ctx.tx.query("insert into erp.feed_formula_items(formula_id,product_id,quantity,percentage) values ($1,$2,$3,$4)", [r.rows[0]!.id, it.product_id, it.quantity, total.isZero() ? 0 : D(it.quantity).div(total).mul(100).toFixed(4)]);
    return { id: r.rows[0]!.id, code };
  })));
  app.put("/stock/feed-formulas/:id", async (req) => runService(app, req, "feed_formulas.edit", async (ctx) => {
    const { id } = req.params as { id: string }; const d = formulaSchema.parse(req.body); const total = d.items.reduce((a, i) => a.plus(i.quantity), D(0));
    const u = await ctx.tx.query("update erp.feed_formulas set name=$3, description=$4, product_id=$5, total_quantity=$6, updated_at=now() where id=$1 and organization_id=$2 returning id", [id, ctx.orgId, d.name, d.description ?? null, d.product_id ?? null, total.toFixed(4)]); if (!u.rowCount) throw notFound();
    await ctx.tx.query("delete from erp.feed_formula_items where formula_id=$1", [id]);
    for (const it of d.items) await ctx.tx.query("insert into erp.feed_formula_items(formula_id,product_id,quantity,percentage) values ($1,$2,$3,$4)", [id, it.product_id, it.quantity, total.isZero() ? 0 : D(it.quantity).div(total).mul(100).toFixed(4)]);
    return { id };
  }));
  app.delete("/stock/feed-formulas/:id", async (req) => runService(app, req, "feed_formulas.delete", async (ctx) => { await ctx.tx.query("update erp.feed_formulas set deleted_at=now() where id=$1 and organization_id=$2", [(req.params as { id: string }).id, ctx.orgId]); return { deleted: true }; }));
  // `validade`: do produto PRODUZIDO (R1-1 c) — opcional, exigida quando ele controla "lote + validade". O lote do
  // produzido com controle é o CÓDIGO da produção.
  const feedBatchSchema = z.object({ empresa_id: uuid, batch_date: date, formula_id: uuid, origin_warehouse_id: uuid, destination_warehouse_id: uuid, quantity_produced: dec, multiplier: dec.default("1"), validade: date.optional().nullable() });
  app.get("/stock/feed-batches", async (req) => runService(app, req, "feed_batches.view", (ctx) => listDocs(ctx, "feed_batches", "batch_date", req.query as Record<string, unknown>, ", ff.name as formula_name", "left join erp.feed_formulas ff on ff.id=d.formula_id", { softDelete: false })));
  // detalhe da produção de ração (UI-STAB-01: /estoque/batidas/:id não tinha GET by id) — escopo de organização + fazenda, permissão feed_batches.view, id inválido/inexistente → 404
  app.get("/stock/feed-batches/:id", async (req) => runService(app, req, "feed_batches.view", async (ctx) => {
    const id = (req.params as { id: string }).id; if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw notFound("Documento");
    const sc = scopedById(ctx, "d", id);
    const d = await ctx.tx.query(`select d.*, f.name as empresa_name, u.name as created_by_name, ff.name as formula_name, wo.description as origin_warehouse_name, wd.description as destination_warehouse_name from erp.feed_batches d left join erp.empresas f on f.id=d.empresa_id left join erp.users u on u.id=d.created_by left join erp.feed_formulas ff on ff.id=d.formula_id left join erp.warehouses wo on wo.id=d.origin_warehouse_id left join erp.warehouses wd on wd.id=d.destination_warehouse_id where d.id=$1 and d.organization_id=$2` + sc.sql, sc.params);
    if (!d.rows[0]) throw notFound("Documento");
    const items = await ctx.tx.query("select i.*, p.description as product_name, p.code as product_code, mu.symbol as unit from erp.feed_batch_items i join erp.products p on p.id=i.product_id left join erp.measurement_units mu on mu.id=p.measurement_id where i.batch_id=$1 order by i.id", [id]);
    const movements = await ctx.tx.query("select id, movement_type, direction, quantity, unit_cost, total_cost, balance_after, movement_date from erp.stock_movements where organization_id=$1 and source_type=$2 and source_id=$3 order by created_at", [ctx.orgId, "feed_batches", id]);
    return { ...(d.rows[0] as Record<string, unknown>), items: items.rows, movements: movements.rows };
  }));
  app.post("/stock/feed-batches", async (req, reply) => reply.status(201).send(await runService(app, req, "feed_batches.create", async (ctx) => {
    const d = feedBatchSchema.parse(req.body); await exigirEmpresa(ctx, d.empresa_id);
    return (await idempotent(ctx.tx, ctx.orgId, idem(req), d, async () => {
      const f = await ctx.tx.query<{ product_id: string | null; name: string }>("select product_id, name from erp.feed_formulas where id=$1 and organization_id=$2", [d.formula_id, ctx.orgId]); if (!f.rows[0]) throw notFound("Formulação");
      if (!f.rows[0].product_id) throw validation("Formulação sem produto acabado vinculado");
      const acabado = await ctx.tx.query<{ controle_lote: string | null; has_lot: boolean }>("select to_jsonb(p)->>'controle_lote' as controle_lote, has_lot from erp.products p where id=$1 and organization_id=$2", [f.rows[0].product_id, ctx.orgId]);
      const controleDoAcabado = acabado.rows[0]?.controle_lote ?? (acabado.rows[0]?.has_lot ? "lote" : "nenhum");
      // recusa ANTES de consumir a matéria-prima, no campo da tela (o núcleo recusaria de novo, no campo do movimento)
      if (controleDoAcabado === "lote_validade" && !d.validade) throw validation("O produto produzido controla lote e validade: informe a validade da produção.", [{ path: "validade", message: "Informe a validade" }]);
      const items = await ctx.tx.query<{ product_id: string; quantity: string }>("select product_id, quantity from erp.feed_formula_items where formula_id=$1", [d.formula_id]);
      const code = await nextCode(ctx.tx, ctx.orgId, "feed_batch");
      const r = await ctx.tx.query<{ id: string }>("insert into erp.feed_batches(organization_id,empresa_id,code,batch_date,formula_id,origin_warehouse_id,destination_warehouse_id,quantity_produced,validade,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id", [ctx.orgId, d.empresa_id, code, d.batch_date, d.formula_id, d.origin_warehouse_id, d.destination_warehouse_id, d.quantity_produced, d.validade ?? null, ctx.user.id]);
      const id = r.rows[0]!.id; const consumed: { quantity: string; unitCost: string }[] = [];
      await atribuirIdGlobal(ctx, "feed_batches", id);
      for (const it of items.rows) {
        const q = D(it.quantity).mul(d.multiplier).toFixed(4);
        const m = await postStock(ctx, { empresaId: d.empresa_id, warehouseId: d.origin_warehouse_id, productId: it.product_id, movementType: "production_out", direction: -1, quantity: q, sourceType: "feed_batches", sourceId: id, date: d.batch_date, note: `Batida ${code}` });
        consumed.push({ quantity: q, unitCost: m.unitCost });
        await ctx.tx.query("insert into erp.feed_batch_items(batch_id,product_id,quantity,unit_cost,total_cost) values ($1,$2,$3,$4,$5)", [id, it.product_id, q, m.unitCost, lineTotal(q, m.unitCost)]);
      }
      const cost = batchCost(consumed, d.quantity_produced);
      await postStock(ctx, { empresaId: d.empresa_id, warehouseId: d.destination_warehouse_id, productId: f.rows[0].product_id, movementType: "production_in", direction: 1, quantity: d.quantity_produced, unitCost: cost.unit, providerLot: controleDoAcabado === "nenhum" ? null : code, expirationDate: d.validade ?? null, sourceType: "feed_batches", sourceId: id, date: d.batch_date, note: `Batida ${code} (${f.rows[0].name})` });
      await ctx.tx.query("update erp.feed_batches set production_cost=$2 where id=$1", [id, cost.total]);
      await audit(ctx.tx, ctx, "feed_batches", id, "create", { code, cost: cost.total });
      return { id, code, production_cost: cost.total, unit_cost: cost.unit };
    })).result;
  })));
  app.post("/stock/feed-batches/:id/cancel", async (req) => runService(app, req, "feed_batches.delete", async (ctx) => { const { id } = req.params as { id: string }; const w_ = await loadForWrite(ctx, "feed_batches", id, "Batida"); const w = { rows: [w_] as [typeof w_] }; if (w.rows[0].status === "cancelled") throw err("ALREADY_CANCELLED", "Já cancelada"); await reverseStock(ctx, "feed_batches", id, new Date().toISOString().slice(0, 10)); await ctx.tx.query("update erp.feed_batches set status='cancelled' where id=$1", [id]); return { id, status: "cancelled" }; }));

  // ---------- DFe recebidas e rascunhos de aprovação ----------
  app.get("/stock/dfe", async (req) => runService(app, req, "dfe.view", async (ctx) => {
    const q = pageQuerySchema.parse(req.query); const f = req.query as Record<string, string>;
    const where = ["organization_id=$1"]; const params: unknown[] = [ctx.orgId]; where.push(...empresaScope(ctx, "empresa_id", params, { nullable: true }));
    if (f.launch_status) { params.push(f.launch_status); where.push(`launch_status=$${params.length}`); }
    if (f.manifest_status) { params.push(f.manifest_status); where.push(`manifest_status=$${params.length}`); }
    if (f.search) { params.push(`%${f.search}%`); where.push(`(access_key ilike $${params.length} or issuer_name ilike $${params.length} or number ilike $${params.length})`); }
    const total = await ctx.tx.query<{ n: string }>(`select count(*) n from erp.dfe_documents where ${where.join(" and ")}`, params);
    const r = await ctx.tx.query(`select * from erp.dfe_documents where ${where.join(" and ")} order by emission_date desc nulls last, created_at desc limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`, params);
    return { items: r.rows, total: Number(total.rows[0]!.n), page: q.page, pageSize: q.pageSize };
  }));
  /** Registro manual/importação de DFe (a captura automática na SEFAZ depende de integração de certificado — ver GAP-ANALYSIS). */
  app.post("/stock/dfe", async (req, reply) => reply.status(201).send(await runService(app, req, "dfe.create", async (ctx) => {
    const d = z.object({ empresa_id: uuid.optional().nullable(), access_key: z.string().length(44), document_type: z.enum(["nfe", "cte", "nfse"]).default("nfe"), number: z.string().optional().nullable(), series: z.string().optional().nullable(), issuer_document: z.string().optional().nullable(), issuer_name: z.string().optional().nullable(), emission_date: date.optional().nullable(), total: dec.optional().nullable(), raw: z.record(z.string(), z.unknown()).optional().nullable() }).parse(req.body); if (d.empresa_id) await exigirEmpresa(ctx, d.empresa_id);
    const r = await ctx.tx.query<{ id: string }>("insert into erp.dfe_documents(organization_id,empresa_id,access_key,document_type,number,series,issuer_document,issuer_name,emission_date,total,raw) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (organization_id,access_key) do update set issuer_name=coalesce(excluded.issuer_name,erp.dfe_documents.issuer_name) returning id", [ctx.orgId, d.empresa_id ?? null, d.access_key, d.document_type, d.number ?? null, d.series ?? null, d.issuer_document ?? null, d.issuer_name ?? null, d.emission_date ?? null, d.total ?? null, d.raw ? JSON.stringify(d.raw) : null]);
    const id = r.rows[0]!.id;
    // Perfil de lançamento do fornecedor → gera rascunho automaticamente
    if (d.issuer_document) {
      const prof = await ctx.tx.query<{ id: string; provider_id: string; default_destination: string; default_title_type_id: string | null }>("select lp.id, lp.provider_id, lp.default_destination, lp.default_title_type_id from erp.provider_launch_profiles lp join erp.people p on p.id=lp.provider_id where lp.organization_id=$1 and lp.deleted_at is null and p.document=$2", [ctx.orgId, d.issuer_document.replace(/\D/g, "")]);
      if (prof.rows[0]) {
        const items = await ctx.tx.query("select financial_category_id, cost_center_id, percentage from erp.provider_launch_profile_items where profile_id=$1", [prof.rows[0].id]);
        await ctx.tx.query("insert into erp.dfe_drafts(organization_id,dfe_id,proposed) values ($1,$2,$3)", [ctx.orgId, id, JSON.stringify({ provider_id: prof.rows[0].provider_id, destination: prof.rows[0].default_destination, title_type_id: prof.rows[0].default_title_type_id, apportionment: items.rows, total: d.total, number: d.number, series: d.series, emission_date: d.emission_date })]);
        await ctx.tx.query("update erp.dfe_documents set launch_status='draft' where id=$1", [id]);
      }
    }
    return { id };
  })));
  app.post("/stock/dfe/:id/manifest", async (req) => runService(app, req, "dfe.manifest", async (ctx) => { const { id } = req.params as { id: string }; const d = z.object({ status: z.enum(["awareness", "confirmed", "unknown", "not_performed"]) }).parse(req.body); const mp: unknown[] = [id, ctx.orgId, d.status]; const u = await ctx.tx.query("update erp.dfe_documents set manifest_status=$3, updated_at=now() where id=$1 and organization_id=$2" + empresaScopeSql(ctx, "empresa_id", mp, { nullable: true }) + " returning id", mp); if (!u.rowCount) throw notFound(); await audit(ctx.tx, ctx, "dfe_documents", id, "manifest", d); return { id, manifest_status: d.status }; }));
  app.post("/stock/dfe/:id/ignore", async (req) => runService(app, req, "dfe_drafts.ignore", async (ctx) => { const { id } = req.params as { id: string }; const ip: unknown[] = [id, ctx.orgId]; const ig = await ctx.tx.query("update erp.dfe_documents set launch_status='ignored' where id=$1 and organization_id=$2" + empresaScopeSql(ctx, "empresa_id", ip, { nullable: true }) + " returning id", ip); if (!ig.rowCount) throw notFound(); await ctx.tx.query("update erp.dfe_drafts set status='ignored', reviewed_by=$3, reviewed_at=now() where dfe_id=$1 and organization_id=$2 and status='pending'", [id, ctx.orgId, ctx.user.id]); return { id, launch_status: "ignored" }; }));
  app.get("/stock/dfe-drafts", async (req) => runService(app, req, "dfe_drafts.view", async (ctx) => { const r = await consultaEscopada(ctx, "select dr.*, d.access_key, d.number, d.issuer_name, d.total, d.emission_date from erp.dfe_drafts dr join erp.dfe_documents d on d.id=dr.dfe_id where dr.organization_id=$1 and dr.status='pending' and {{escopo_nulo:d.empresa_id}} order by dr.created_at desc", [ctx.orgId]); return { items: r.rows, total: r.rowCount }; }));
  app.post("/stock/dfe-drafts/:id/approve", async (req) => runService(app, req, "dfe_drafts.approve", async (ctx) => {
    const { id } = req.params as { id: string };
    const dr = await ctx.tx.query<{ dfe_id: string; proposed: Record<string, unknown>; status: string }>("select dfe_id, proposed, status from erp.dfe_drafts where id=$1 and organization_id=$2 for update", [id, ctx.orgId]); if (!dr.rows[0]) throw notFound(); if (dr.rows[0].status !== "pending") throw err("ALREADY_CONFIRMED", "Rascunho já processado");
    const p = dr.rows[0].proposed; const empresaId = ctx.empresaId ?? (await empresasDisponiveis(ctx))[0]; if (!empresaId) throw validation("Nenhuma empresa disponível para lançar o rascunho"); await exigirEmpresa(ctx, empresaId);
    // Nota de despesa: gera conta a pagar diretamente com rateio do perfil
    const app_ = (p["apportionment"] as { financial_category_id: string; cost_center_id: string; percentage: string }[]) ?? [];
    if (!app_.length || !p["total"]) throw validation("Rascunho sem rateio/total: lance manualmente pela tela de Documento Fiscal");
    const t = await createTitles(ctx, { empresaId, direction: "payable", number: String(p["number"] ?? "DFE"), titleTypeId: (p["title_type_id"] as string) ?? null, personId: p["provider_id"] as string, amount: money(String(p["total"])), emissionDate: (p["emission_date"] as string) ?? new Date().toISOString().slice(0, 10), dueDate: (p["emission_date"] as string) ?? new Date().toISOString().slice(0, 10), note: `DFe aprovada automaticamente (${p["destination"]})`, isDeductible: true, documentType: "nfe", apportionment: app_.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, percentage: a.percentage })), sourceType: "dfe_documents", sourceId: dr.rows[0].dfe_id });
    await ctx.tx.query("update erp.dfe_drafts set status='approved', reviewed_by=$3, reviewed_at=now() where id=$1 and organization_id=$2", [id, ctx.orgId, ctx.user.id]);
    await ctx.tx.query("update erp.dfe_documents set launch_status='launched' where id=$1", [dr.rows[0].dfe_id]);
    await audit(ctx.tx, ctx, "dfe_drafts", id, "approve", { titles: t.ids });
    return { id, title_ids: t.ids };
  }));
}
