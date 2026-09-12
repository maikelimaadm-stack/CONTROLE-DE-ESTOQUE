import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { D, money, isISODate } from "@agro/shared";
import { documentTotals, itemTotal, nextSalesKind, assertConvertible, type SalesKind } from "@agro/domain";
import { runService, nextCode, idempotent, audit, assertPeriodOpen } from "../lib/service.js";
import { notFound, validation, err } from "../lib/errors.js";
import { farmAllowed, farmScope, scopedById, allowedFarms, type ServiceCtx } from "../lib/context.js";
import { pageQuerySchema } from "../lib/pagination.js";
import { wrapListing } from "../lib/column-filters.js";
import { postStock, reverseStock } from "../services/stock-core.js";
import { createTitles, installmentPlanSchema } from "../services/financial-core.js";

const dec = z.union([z.number(), z.string()]).transform(String);
const date = z.string().refine(isISODate, "Data inválida");
const uuid = z.string().uuid();
const docSchema = z.object({ farm_id: uuid, document_date: date, shipping_date: date.optional().nullable(), due_date: date.optional().nullable(), client_id: uuid, transporter_id: uuid.optional().nullable(), proprietary_id: uuid.optional().nullable(), driver_name: z.string().optional().nullable(), payment_method_id: uuid.optional().nullable(), freight: dec.default("0"), freight_icms: dec.default("0"), other_values: dec.default("0"), discount: dec.default("0"), note: z.string().optional().nullable(), installment_plan: installmentPlanSchema.optional().nullable(), is_deductible: z.boolean().default(false), items: z.array(z.object({ product_id: uuid, warehouse_id: uuid.optional().nullable(), quantity: dec, unit_price: dec, discount: dec.default("0"), discount_percent: dec.default("0"), note: z.string().optional().nullable() })).min(1) });
const permOf = (k: SalesKind) => (k === "budget" ? "budgets" : k === "order" ? "orders" : "sales");

async function getDoc(ctx: ServiceCtx, id: string) {
  const r = await ctx.tx.query("select d.*, c.name as client_name, c.document as client_document, t.name as transporter_name, pm.name as payment_method_name, u.name as responsible_name, f.name as farm_name from erp.sales_documents d join erp.people c on c.id=d.client_id left join erp.people t on t.id=d.transporter_id left join erp.payment_methods pm on pm.id=d.payment_method_id left join erp.users u on u.id=d.responsible_user_id join erp.farms f on f.id=d.farm_id where d.id=$1 and d.organization_id=$2 and d.deleted_at is null" + scopedById(ctx, "d", id).sql, scopedById(ctx, "d", id).params); if (!r.rows[0]) throw notFound("Documento");
  const items = await ctx.tx.query("select i.*, p.description as product_name, p.code as product_code, mu.symbol as unit, w.description as warehouse_name from erp.sales_document_items i join erp.products p on p.id=i.product_id left join erp.measurement_units mu on mu.id=p.measurement_id left join erp.warehouses w on w.id=i.warehouse_id where i.document_id=$1 order by i.position", [id]);
  const titles = await ctx.tx.query("select id, code, number, due_date, amount, balance, status from erp.financial_titles where organization_id=$1 and source_type='sales_documents' and source_id=$2 order by due_date", [ctx.orgId, id]);
  const derived = await ctx.tx.query("select id, kind, code, status from erp.sales_documents where origin_document_id=$1", [id]);
  return { ...(r.rows[0] as Record<string, unknown>), items: items.rows, titles: titles.rows, derived: derived.rows } as Record<string, unknown>;
}
async function writeDoc(ctx: ServiceCtx, kind: SalesKind, d: z.infer<typeof docSchema>, existingId?: string, origin?: string | null) {
  const totals = documentTotals(d.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unit_price, discount: i.discount, discountPercent: i.discount_percent })), { freight: d.freight, freightIcms: d.freight_icms, otherValues: d.other_values, discount: d.discount });
  let id = existingId;
  const plan = d.installment_plan ? { ...d.installment_plan, is_deductible: d.is_deductible } : {};
  if (!id) { const code = await nextCode(ctx.tx, ctx.orgId, `sales_${kind}`); id = (await ctx.tx.query<{ id: string }>("insert into erp.sales_documents(organization_id,farm_id,kind,code,document_date,shipping_date,due_date,responsible_user_id,client_id,transporter_id,proprietary_id,driver_name,payment_method_id,subtotal,freight,freight_icms,other_values,discount,total,note,installment_plan,origin_document_id,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$8) returning id", [ctx.orgId, d.farm_id, kind, code, d.document_date, d.shipping_date ?? null, d.due_date ?? null, ctx.user.id, d.client_id, d.transporter_id ?? null, d.proprietary_id ?? null, d.driver_name ?? null, d.payment_method_id ?? null, totals.subtotal, money(d.freight), money(d.freight_icms), money(d.other_values), money(d.discount), totals.total, d.note ?? null, JSON.stringify(plan), origin ?? null])).rows[0]!.id; }
  else { await ctx.tx.query("update erp.sales_documents set document_date=$3, shipping_date=$4, due_date=$5, client_id=$6, transporter_id=$7, proprietary_id=$8, driver_name=$9, payment_method_id=$10, subtotal=$11, freight=$12, freight_icms=$13, other_values=$14, discount=$15, total=$16, note=$17, installment_plan=$18, updated_at=now() where id=$1 and organization_id=$2", [id, ctx.orgId, d.document_date, d.shipping_date ?? null, d.due_date ?? null, d.client_id, d.transporter_id ?? null, d.proprietary_id ?? null, d.driver_name ?? null, d.payment_method_id ?? null, totals.subtotal, money(d.freight), money(d.freight_icms), money(d.other_values), money(d.discount), totals.total, d.note ?? null, JSON.stringify(plan)]); await ctx.tx.query("delete from erp.sales_document_items where document_id=$1", [id]); }
  for (const [i, it] of d.items.entries()) await ctx.tx.query("insert into erp.sales_document_items(document_id,product_id,warehouse_id,quantity,unit_price,discount,discount_percent,total,note,position) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [id, it.product_id, it.warehouse_id ?? null, it.quantity, it.unit_price, money(it.discount), it.discount_percent, itemTotal({ quantity: it.quantity, unitPrice: it.unit_price, discount: it.discount, discountPercent: it.discount_percent }), it.note ?? null, i]);
  return { id, ...totals };
}
async function confirmSale(ctx: ServiceCtx, id: string) {
  const d = await getDoc(ctx, id) as Record<string, unknown> & { kind: SalesKind; status: string; farm_id: string; document_date: string; shipping_date: string | null; due_date: string | null; client_id: string; total: string; code: string; installment_plan: Record<string, unknown>; items: { product_id: string; warehouse_id: string | null; quantity: string; total: string }[] };
  if (d.kind !== "sale") throw validation("Somente vendas são confirmadas"); if (d.status === "confirmed" || d.status === "invoiced") throw err("ALREADY_CONFIRMED", "Venda já confirmada"); if (d.status === "cancelled") throw err("ALREADY_CANCELLED", "Venda cancelada");
  await assertPeriodOpen(ctx.tx, ctx.orgId, d.farm_id, d.document_date);
  for (const it of d.items) if (it.warehouse_id) await postStock(ctx, { farmId: d.farm_id, warehouseId: it.warehouse_id, productId: it.product_id, movementType: "sale", direction: -1, quantity: it.quantity, sourceType: "sales_documents", sourceId: id, date: d.shipping_date ?? d.document_date, note: `Venda ${d.code}` });
  // Receita: categoria padrão de venda de produtos (1ª analítica de receita) e centro de custo padrão da fazenda
  const cat = (await ctx.tx.query<{ id: string }>("select id from erp.financial_categories where organization_id=$1 and nature='income' and kind='analytic' and deleted_at is null order by code limit 1", [ctx.orgId])).rows[0];
  const cc = (await ctx.tx.query<{ id: string }>("select cc.id from erp.cost_centers cc where cc.organization_id=$1 and cc.kind='analytic' and cc.deleted_at is null order by code limit 1", [ctx.orgId])).rows[0];
  if (!cat || !cc) throw validation("Cadastre uma categoria financeira de receita e um centro de custo analítico");
  const plan = d.installment_plan && (d.installment_plan as { installments?: number }).installments ? installmentPlanSchema.parse(d.installment_plan) : null;
  const t = await createTitles(ctx, { farmId: d.farm_id, direction: "receivable", number: `VND-${d.code}`, personId: d.client_id, amount: d.total, emissionDate: d.document_date, dueDate: plan?.first_due_date ?? d.due_date ?? d.document_date, note: `Venda ${d.code}`, isDeductible: Boolean((d.installment_plan as { is_deductible?: boolean }).is_deductible), apportionment: [{ financialCategoryId: cat.id, costCenterId: cc.id, percentage: "100" }], sourceType: "sales_documents", sourceId: id, plan });
  await ctx.tx.query("update erp.sales_documents set status='confirmed', updated_at=now() where id=$1", [id]);
  await audit(ctx.tx, ctx, "sales_documents", id, "confirm", { titles: t.ids });
  return { id, status: "confirmed", title_ids: t.ids };
}

export default async function salesRoutes(app: FastifyInstance) {
  for (const kind of ["budget", "order", "sale"] as const) {
    const base = `/sales/${kind}s`; const perm = permOf(kind);
    app.get(base, async (req) => runService(app, req, `${perm}.view`, async (ctx) => {
      const q = pageQuerySchema.parse(req.query); const f = req.query as Record<string, string>;
      const where = ["d.organization_id=$1", "d.kind=$2", "d.deleted_at is null"]; const params: unknown[] = [ctx.orgId, kind];
      if (f.client_id) { params.push(f.client_id); where.push(`d.client_id=$${params.length}`); }
      if (f.status) { params.push(f.status); where.push(`d.status=$${params.length}`); }
      if (f.farm_id) { params.push(f.farm_id); where.push(`d.farm_id=$${params.length}`); } where.push(...farmScope(ctx, "d", params, { ignoreSelected: Boolean(f.farm_id) }));
      if (f.start_date) { params.push(f.start_date); where.push(`d.document_date>=$${params.length}`); } if (f.end_date) { params.push(f.end_date); where.push(`d.document_date<=$${params.length}`); }
      if (f.search) { params.push(`%${f.search}%`); where.push(`(d.code ilike $${params.length} or c.name ilike $${params.length})`); }
      if (f.product_id) { params.push(f.product_id); where.push(`exists (select 1 from erp.sales_document_items i where i.document_id=d.id and i.product_id=$${params.length})`); }
      const w = where.join(" and ");
      const wl = wrapListing(`select d.id, d.code, d.document_date, d.created_at, d.shipping_date, d.due_date, d.status, d.total, d.subtotal, d.nfe_id, c.name as client_name, u.name as responsible_name, f.name as farm_name, (select count(*) from erp.sales_document_items i where i.document_id=d.id)::int as item_count from erp.sales_documents d join erp.people c on c.id=d.client_id left join erp.users u on u.id=d.responsible_user_id join erp.farms f on f.id=d.farm_id where ${w} order by d.document_date desc, d.created_at desc`, params, req.query as Record<string, unknown>, q, ", coalesce(sum(t.total),0)::text total");
      const tot = await ctx.tx.query<{ n: string; total: string }>(wl.countSql, wl.params);
      const r = await ctx.tx.query(wl.pageSql, wl.params);
      return { items: r.rows, total: Number(tot.rows[0]!.n), page: q.page, pageSize: q.pageSize, totals: { total: tot.rows[0]!.total } };
    }));
    app.get(`${base}/:id`, async (req) => runService(app, req, `${perm}.view`, (ctx) => getDoc(ctx, (req.params as { id: string }).id)));
    app.post(base, async (req, reply) => reply.status(201).send(await runService(app, req, `${perm}.create`, async (ctx) => { const d = docSchema.parse(req.body); if (!farmAllowed(ctx, d.farm_id)) throw validation("Sem acesso à fazenda"); return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined, d, async () => { const r = await writeDoc(ctx, kind, d); await audit(ctx.tx, ctx, "sales_documents", r.id!, "create"); return r; })).result; })));
    app.put(`${base}/:id`, async (req) => runService(app, req, `${perm}.edit`, async (ctx) => { const { id } = req.params as { id: string }; const cur = await getDoc(ctx, id) as { status: string; kind: string }; if (cur.kind !== kind) throw notFound(); if (cur.status !== "open" && cur.status !== "approved") throw err("INVALID_STATUS_TRANSITION", "Documento não editável neste status"); const d = docSchema.parse(req.body); const r = await writeDoc(ctx, kind, d, id); await audit(ctx.tx, ctx, "sales_documents", id, "update"); return r; }));
    app.post(`${base}/:id/cancel`, async (req) => runService(app, req, `${perm}.delete`, async (ctx) => {
      const { id } = req.params as { id: string }; const cur = await getDoc(ctx, id) as { status: string; kind: string };
      if (cur.status === "cancelled") throw err("ALREADY_CANCELLED", "Já cancelado");
      if (cur.kind === "sale" && cur.status === "confirmed") { const paid = await ctx.tx.query("select 1 from erp.financial_titles where source_type='sales_documents' and source_id=$1 and paid_amount>0", [id]); if (paid.rowCount) throw err("CONFLICT", "Títulos com baixa: cancele as baixas antes"); await reverseStock(ctx, "sales_documents", id, new Date().toISOString().slice(0, 10)); await ctx.tx.query("update erp.financial_titles set status='cancelled' where source_type='sales_documents' and source_id=$1", [id]); }
      await ctx.tx.query("update erp.sales_documents set status='cancelled', updated_at=now() where id=$1", [id]); await audit(ctx.tx, ctx, "sales_documents", id, "cancel"); return { id, status: "cancelled" };
    }));
    if (kind !== "sale") app.post(`${base}/:id/convert`, async (req, reply) => reply.status(201).send(await runService(app, req, `${permOf(nextSalesKind(kind))}.create`, async (ctx) => {
      const { id } = req.params as { id: string }; const cur = await getDoc(ctx, id) as Record<string, unknown> & { status: string; kind: SalesKind; items: Record<string, unknown>[] };
      assertConvertible({ kind: cur.kind, status: cur.status as "open" });
      const next = nextSalesKind(kind);
      const body = docSchema.parse({ farm_id: cur.farm_id, document_date: new Date().toISOString().slice(0, 10), shipping_date: cur.shipping_date, due_date: cur.due_date, client_id: cur.client_id, transporter_id: cur.transporter_id, proprietary_id: cur.proprietary_id, driver_name: cur.driver_name, payment_method_id: cur.payment_method_id, freight: cur.freight, freight_icms: cur.freight_icms, other_values: cur.other_values, discount: cur.discount, note: cur.note, installment_plan: (cur.installment_plan as { installments?: number })?.installments ? cur.installment_plan : null, items: cur.items.map((i) => ({ product_id: i.product_id, warehouse_id: i.warehouse_id, quantity: i.quantity, unit_price: i.unit_price, discount: i.discount, discount_percent: i.discount_percent, note: i.note })) });
      const r = await writeDoc(ctx, next, body, undefined, id);
      await ctx.tx.query("update erp.sales_documents set status='converted', updated_at=now() where id=$1", [id]);
      await audit(ctx.tx, ctx, "sales_documents", id, "convert", { to: r.id });
      return { id: r.id, kind: next, from: id };
    })));
    if (kind === "sale") app.post(`${base}/:id/confirm`, async (req) => runService(app, req, "sales.edit", async (ctx) => (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined, { confirm: (req.params as { id: string }).id }, () => confirmSale(ctx, (req.params as { id: string }).id))).result));
  }
  // Curva ABC e relatórios de vendas simples
  app.get("/sales/abc", async (req) => runService(app, req, "report.sales_abc.view", async (ctx) => { const f = req.query as Record<string, string>; const r = await ctx.tx.query<{ product_id: string; product_name: string; value: string; quantity: string }>("select i.product_id, p.description as product_name, sum(i.total) as value, sum(i.quantity) as quantity from erp.sales_document_items i join erp.sales_documents d on d.id=i.document_id join erp.products p on p.id=i.product_id where d.organization_id=$1 and d.kind='sale' and d.status in ('confirmed','invoiced') and ($2::date is null or d.document_date>=$2) and ($3::date is null or d.document_date<=$3) and ($4::uuid[] is null or d.farm_id = any($4)) group by 1,2 order by 3 desc", [ctx.orgId, f.start_date ?? null, f.end_date ?? null, allowedFarms(ctx)]); const { abcClassify } = await import("@agro/domain"); return { items: abcClassify(r.rows), total: money(r.rows.reduce((a, x) => a.plus(x.value), D(0))) }; }));
}
