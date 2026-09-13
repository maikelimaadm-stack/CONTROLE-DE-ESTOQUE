import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { D, money, isISODate, todayISO } from "@agro/shared";
import { displayTitleStatus, settlementNet, assertSettlementWithinBalance, recurrenceDates, type TitleStatus } from "@agro/domain";
import { runService, idempotent, audit, assertPeriodOpen, nextCode, requirePermission } from "../lib/service.js";
import { notFound, validation, err } from "../lib/errors.js";
import { empresaScope, exigirEmpresaDeLancamento, exigirEmpresaVisivel, farmAllowed, farmScope, farmScopeSql, scopedById, type ServiceCtx } from "../lib/context.js";
import { pageQuerySchema } from "../lib/pagination.js";
import { wrapListing } from "../lib/column-filters.js";
import { createTitles, createBankMovement, apportionmentSchema, installmentPlanSchema } from "../services/financial-core.js";

const dec = z.union([z.number(), z.string()]).transform(String);
const date = z.string().refine(isISODate, "Data inválida");
const uuid = z.string().uuid();
const idem = (req: { headers: Record<string, unknown> }) => req.headers["idempotency-key"] as string | undefined;
const permOf = (dir: string, action: string) => `${dir === "payable" ? "payables" : "receivables"}.${action}`;

const titleSchema = z.object({
  farm_id: uuid, number: z.string().min(1).max(40), title_type_id: uuid.optional().nullable(), proprietary_id: uuid.optional().nullable(), person_id: uuid.optional().nullable(), branch_id: uuid.optional().nullable(),
  payment_type: z.enum(["single", "installments", "recurring", "advance", "invoice_group"]).default("single"), recurrence_type: z.enum(["weekly", "monthly", "quarterly", "yearly"]).optional().nullable(), recurrence_count: z.number().int().min(1).max(60).optional(),
  classification: z.enum(["unclassified", "capex", "opex"]).default("unclassified"), document_type: z.enum(["nfe", "cte", "nfse", "nfce", "danfe", "darf", "dare", "gru", "other"]).optional().nullable(),
  is_deductible: z.boolean().default(false), is_tax: z.boolean().default(false), amount: dec, discount: dec.default("0"), emission_date: date, due_date: date, note: z.string().min(1), harvest_id: uuid.optional().nullable(),
  appropriation: z.enum(["direct", "indirect"]).default("direct"), appropriation_type: z.enum(["indirect", "livestock", "area", "maintenance", "fuel"]).optional().nullable(), appropriations: z.array(z.object({ kind: z.enum(["livestock", "area", "maintenance", "fuel"]), target: z.record(z.string(), z.unknown()), amount: dec })).optional(),
  apportionment: apportionmentSchema, plan: installmentPlanSchema.optional().nullable(),
  auto_settle: z.object({ bank_account_id: uuid, date: date }).optional().nullable()
});

async function listTitles(ctx: ServiceCtx, direction: "payable" | "receivable", query: Record<string, unknown>) {
  const q = pageQuerySchema.parse(query); const f = query as Record<string, string>;
  const where = ["t.organization_id=$1", "t.direction=$2", "t.deleted_at is null"]; const params: unknown[] = [ctx.orgId, direction];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
  if (f.farm_id) add("t.farm_id=?", f.farm_id); else if (ctx.farmId) add("t.farm_id=?", ctx.farmId);
  where.push(...empresaScope(ctx, "t", params, { ignoreSelected: true }));
  if (f.person_id) add("t.person_id=?", f.person_id);
  if (f.proprietary_id) add("t.proprietary_id=?", f.proprietary_id);
  if (f.document_type) add("t.document_type=?", f.document_type);
  if (f.number) add("t.number ilike ?", `%${f.number}%`);
  if (f.note) add("t.note ilike ?", `%${f.note}%`);
  if (f.amount) add("t.amount=?", f.amount);
  if (f.title_type_id) add("t.title_type_id=?", f.title_type_id);
  if (f.payment_type) add("t.payment_type=?", f.payment_type);
  if (f.harvest_id) add("t.harvest_id=?", f.harvest_id);
  if (f.classification) add("t.classification=?", f.classification);
  if (f.start_date) add("t.due_date>=?", f.start_date); if (f.end_date) add("t.due_date<=?", f.end_date);
  if (f.start_emission_date) add("t.emission_date>=?", f.start_emission_date); if (f.end_emission_date) add("t.emission_date<=?", f.end_emission_date);
  if (f.start_write_off_date) add("exists (select 1 from erp.title_settlements s where s.title_id=t.id and s.status='confirmed' and s.settlement_date>=?)", f.start_write_off_date);
  if (f.end_write_off_date) add("exists (select 1 from erp.title_settlements s where s.title_id=t.id and s.status='confirmed' and s.settlement_date<=?)", f.end_write_off_date);
  if (f.category_id) add("exists (select 1 from erp.title_apportionments a where a.title_id=t.id and a.financial_category_id=?)", f.category_id);
  if (f.center_id) add("exists (select 1 from erp.title_apportionments a where a.title_id=t.id and a.cost_center_id=?)", f.center_id);
  if (f.account_id) add("exists (select 1 from erp.title_settlements s where s.title_id=t.id and s.bank_account_id=?)", f.account_id);
  if (f.product) add("exists (select 1 from erp.invoices i join erp.invoice_items ii on ii.invoice_id=i.id join erp.products p on p.id=ii.product_id where t.source_type='invoices' and t.source_id=i.id and p.description ilike ?)", `%${f.product}%`);
  if (f.due_soon === "1") where.push("t.status in ('open','partially_paid') and t.due_date <= current_date + 3");
  const st = f.status;
  if (st === "open") where.push("t.status='open' and t.due_date >= current_date and t.payment_type not in ('advance','invoice_group')");
  else if (st === "overdue") where.push("t.status in ('open','partially_paid') and t.due_date < current_date");
  else if (st === "partially_paid") where.push("t.status='partially_paid'");
  else if (st === "paid") where.push("t.status='paid'");
  else if (st === "advance_pending") where.push("t.payment_type='advance' and t.status<>'paid'");
  else if (st === "advance_paid") where.push("t.payment_type='advance' and t.status='paid'");
  else if (st === "invoice_pending") where.push("t.payment_type='invoice_group' and t.status<>'paid'");
  else if (st === "invoice_paid") where.push("t.payment_type='invoice_group' and t.status='paid'");
  else if (st === "cancelled") where.push("t.status='cancelled'");
  else if (!st) where.push("t.status<>'cancelled'");
  const w = where.join(" and ");
  const sort = ["due_date", "emission_date", "amount", "number", "code", "balance"].includes(q.sort ?? "") ? q.sort : "due_date";
  const wl = wrapListing(`select t.*, p.name as person_name, pr.name as proprietary_name, tt.name as title_type_name, f.name as farm_name, (select max(settlement_date) from erp.title_settlements s where s.title_id=t.id and s.status='confirmed') as last_settlement_date, (select count(*) from erp.attachments a where a.entity='financial_title' and a.entity_id=t.id)::int as attachment_count from erp.financial_titles t left join erp.people p on p.id=t.person_id left join erp.people pr on pr.id=t.proprietary_id left join erp.title_types tt on tt.id=t.title_type_id join erp.farms f on f.id=t.farm_id where ${w} order by t.${sort} ${q.dir ?? "asc"}, t.code`, params, query, q, ", coalesce(sum(t.amount - t.discount),0)::text amount, coalesce(sum(t.balance),0)::text balance, coalesce(sum(t.paid_amount),0)::text paid");
  const tot = await ctx.tx.query<{ n: string; amount: string; balance: string; paid: string }>(wl.countSql, wl.params);
  const r = await ctx.tx.query(wl.pageSql, wl.params);
  const today = todayISO();
  return { items: r.rows.map((x) => ({ ...(x as Record<string, unknown>), status_label: displayTitleStatus({ status: (x as { status: TitleStatus }).status, dueDate: (x as { due_date: string }).due_date, paymentType: (x as { payment_type: string }).payment_type }, today) })), total: Number(tot.rows[0]!.n), page: q.page, pageSize: q.pageSize, totals: { amount: tot.rows[0]!.amount, balance: tot.rows[0]!.balance, paid: tot.rows[0]!.paid } };
}
async function getTitle(ctx: ServiceCtx, id: string) {
  const r = await ctx.tx.query("select t.*, p.name as person_name, p.document as person_document, pr.name as proprietary_name, tt.name as title_type_name, f.name as farm_name, h.description as harvest_name, u.name as created_by_name from erp.financial_titles t left join erp.people p on p.id=t.person_id left join erp.people pr on pr.id=t.proprietary_id left join erp.title_types tt on tt.id=t.title_type_id join erp.farms f on f.id=t.farm_id left join erp.harvests h on h.id=t.harvest_id left join erp.users u on u.id=t.created_by where t.id=$1 and t.organization_id=$2 and t.deleted_at is null" + scopedById(ctx, "t", id).sql, scopedById(ctx, "t", id).params);
  if (!r.rows[0]) throw notFound("Título");
  const t = r.rows[0] as Record<string, unknown> & { status: TitleStatus; due_date: string; payment_type: string; group_id: string | null; farm_name: string; number: string; code: string; person_name: string | null; amount: string; net_amount: string; note: string };
  const app_ = await ctx.tx.query("select a.*, fc.code as category_code, fc.name as category_name, cc.name as cost_center_name, ca.description as chart_account_name, ar.name as area_name, h.description as harvest_name from erp.title_apportionments a join erp.financial_categories fc on fc.id=a.financial_category_id join erp.cost_centers cc on cc.id=a.cost_center_id left join erp.chart_accounts ca on ca.id=a.chart_account_id left join erp.areas ar on ar.id=a.area_id left join erp.harvests h on h.id=a.harvest_id where a.title_id=$1", [id]);
  const appr = await ctx.tx.query("select * from erp.title_appropriations where title_id=$1", [id]);
  const settlements = await ctx.tx.query("select s.*, ba.description as bank_account_name, u.name as created_by_name from erp.title_settlements s left join erp.bank_accounts ba on ba.id=s.bank_account_id left join erp.users u on u.id=s.created_by where s.title_id=$1 order by s.created_at", [id]);
  const siblings = t.group_id ? (await ctx.tx.query("select id, code, number, installment_number, due_date, amount, balance, status from erp.financial_titles where group_id=$1 order by installment_number", [t.group_id])).rows : [];
  const attachments = await ctx.tx.query("select id, file_name, description, object_path, created_at from erp.attachments where entity='financial_title' and entity_id=$1", [id]);
  return { ...(t as Record<string, unknown>), ...t, status_label: displayTitleStatus({ status: t.status, dueDate: t.due_date, paymentType: t.payment_type }, todayISO()), apportionments: app_.rows, appropriations: appr.rows, settlements: settlements.rows, installments: siblings, attachments: attachments.rows };
}

export default async function financialRoutes(app: FastifyInstance) {
  for (const dir of ["payable", "receivable"] as const) {
    const base = dir === "payable" ? "/financial/payables" : "/financial/receivables";
    app.get(base, async (req) => runService(app, req, permOf(dir, "view"), (ctx) => listTitles(ctx, dir, req.query as Record<string, unknown>)));
    app.get(`${base}/:id`, async (req) => runService(app, req, permOf(dir, "view"), (ctx) => getTitle(ctx, (req.params as { id: string }).id)));
    app.post(base, async (req, reply) => reply.status(201).send(await runService(app, req, permOf(dir, "create"), async (ctx) => {
      const d = titleSchema.parse(req.body); await exigirEmpresaDeLancamento(ctx, d.farm_id);
      if (dir === "receivable" && !d.person_id) throw validation("Cliente obrigatório"); if (dir === "payable" && !d.person_id) throw validation("Fornecedor obrigatório");
      return (await idempotent(ctx.tx, ctx.orgId, idem(req), d, async () => {
        const lines = d.apportionment.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, chartAccountId: a.chart_account_id ?? null, harvestId: a.harvest_id ?? null, areaId: a.area_id ?? null, percentage: a.percentage, amount: a.amount }));
        const ids: string[] = [];
        if (d.payment_type === "recurring" && d.recurrence_type) {
          const dates = recurrenceDates(d.due_date, d.recurrence_type, d.recurrence_count ?? 12);
          const groupId = (await ctx.tx.query<{ id: string }>("select gen_random_uuid() id")).rows[0]!.id;
          for (const [i, due] of dates.entries()) { const c = await createTitles(ctx, { ...mapTitle(d, dir), number: `${d.number}-${i + 1}`, dueDate: due, apportionment: lines, plan: null }); ids.push(...c.ids); await ctx.tx.query("update erp.financial_titles set group_id=$2, installment_number=$3, installment_count=$4 where id=$1", [c.ids[0], groupId, i + 1, dates.length]); }
        } else { const c = await createTitles(ctx, { ...mapTitle(d, dir), apportionment: lines, plan: d.plan ?? null }); ids.push(...c.ids); }
        if (d.appropriations?.length) for (const a of d.appropriations) await ctx.tx.query("insert into erp.title_appropriations(title_id,kind,target,amount) values ($1,$2,$3,$4)", [ids[0], a.kind, JSON.stringify(a.target), money(a.amount)]);
        if (d.auto_settle) for (const id of ids) await settle(ctx, id, { settlement_date: d.auto_settle.date, settlement_kind: "bank_movement", bank_account_id: d.auto_settle.bank_account_id, amount: (await ctx.tx.query<{ b: string }>("select balance b from erp.financial_titles where id=$1", [id])).rows[0]!.b, movement_mode: "separate" });
        await audit(ctx.tx, ctx, "financial_titles", ids[0]!, "create", { count: ids.length });
        return { ids, id: ids[0] };
      })).result;
    })));
    app.put(`${base}/:id`, async (req) => runService(app, req, permOf(dir, "edit"), async (ctx) => {
      const { id } = req.params as { id: string }; const d = titleSchema.partial().parse(req.body);
      const cur = await ctx.tx.query<{ status: string; paid_amount: string; farm_id: string; emission_date: string; version: number }>("select status, paid_amount, farm_id, emission_date, version from erp.financial_titles where id=$1 and organization_id=$2 and direction=$3 and deleted_at is null for update", [id, ctx.orgId, dir]);
      if (!cur.rows[0]) throw notFound("Título"); await exigirEmpresaVisivel(ctx, cur.rows[0].farm_id, "Título"); if (cur.rows[0].status === "cancelled") throw err("ALREADY_CANCELLED", "Título cancelado");
      if (D(cur.rows[0].paid_amount).gt(0) && (d.amount !== undefined || d.discount !== undefined)) throw err("CONFLICT", "Título com baixa: valor não pode ser alterado (cancele a baixa)");
      await assertPeriodOpen(ctx.tx, ctx.orgId, cur.rows[0].farm_id, cur.rows[0].emission_date);
      await ctx.tx.query("update erp.financial_titles set number=coalesce($3,number), title_type_id=coalesce($4,title_type_id), proprietary_id=coalesce($5,proprietary_id), person_id=coalesce($6,person_id), classification=coalesce($7,classification), document_type=coalesce($8,document_type), is_deductible=coalesce($9,is_deductible), is_tax=coalesce($10,is_tax), amount=coalesce($11,amount), discount=coalesce($12,discount), emission_date=coalesce($13,emission_date), due_date=coalesce($14,due_date), note=coalesce($15,note), harvest_id=coalesce($16,harvest_id), appropriation=coalesce($17,appropriation), appropriation_type=coalesce($18,appropriation_type), version=version+1 where id=$1 and organization_id=$2",
        [id, ctx.orgId, d.number ?? null, d.title_type_id ?? null, d.proprietary_id ?? null, d.person_id ?? null, d.classification ?? null, d.document_type ?? null, d.is_deductible ?? null, d.is_tax ?? null, d.amount ?? null, d.discount ?? null, d.emission_date ?? null, d.due_date ?? null, d.note ?? null, d.harvest_id ?? null, d.appropriation ?? null, d.appropriation_type ?? null]);
      if (d.apportionment) {
        const t = await ctx.tx.query<{ net: string }>("select amount - discount as net from erp.financial_titles where id=$1", [id]);
        const { normalizeApportionment } = await import("@agro/domain");
        const lines = normalizeApportionment(t.rows[0]!.net, d.apportionment.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, chartAccountId: a.chart_account_id ?? null, harvestId: a.harvest_id ?? null, areaId: a.area_id ?? null, percentage: a.percentage, amount: a.amount })));
        await ctx.tx.query("delete from erp.title_apportionments where title_id=$1", [id]);
        for (const l of lines) await ctx.tx.query("insert into erp.title_apportionments(title_id,financial_category_id,chart_account_id,cost_center_id,area_id,harvest_id,percentage,amount) values ($1,$2,$3,$4,$5,$6,$7,$8)", [id, l.financialCategoryId, l.chartAccountId, l.costCenterId, l.areaId, l.harvestId, l.percentage, l.amount]);
      }
      await ctx.tx.query("select erp.refresh_title_status($1)", [id]);
      await audit(ctx.tx, ctx, "financial_titles", id, "update");
      return getTitle(ctx, id);
    }));
    app.post(`${base}/:id/cancel`, async (req) => runService(app, req, permOf(dir, "delete"), async (ctx) => {
      const { id } = req.params as { id: string };
      const cur = await ctx.tx.query<{ status: string; paid_amount: string; farm_id: string; emission_date: string }>("select status, paid_amount, farm_id, emission_date from erp.financial_titles where id=$1 and organization_id=$2 and direction=$3 for update", [id, ctx.orgId, dir]);
      if (!cur.rows[0]) throw notFound("Título"); await exigirEmpresaVisivel(ctx, cur.rows[0].farm_id, "Título"); if (cur.rows[0].status === "cancelled") throw err("ALREADY_CANCELLED", "Já cancelado"); if (D(cur.rows[0].paid_amount).gt(0)) throw err("CONFLICT", "Título com baixa: cancele a baixa antes");
      await assertPeriodOpen(ctx.tx, ctx.orgId, cur.rows[0].farm_id, cur.rows[0].emission_date);
      await ctx.tx.query("update erp.financial_titles set status='cancelled', version=version+1 where id=$1", [id]);
      await audit(ctx.tx, ctx, "financial_titles", id, "cancel");
      return { id, status: "cancelled" };
    }));
    app.post(`${base}/cancel-batch`, async (req) => runService(app, req, permOf(dir, "delete"), async (ctx) => { const d = z.object({ ids: z.array(uuid).min(1) }).parse(req.body); let n = 0; for (const id of d.ids) { const bp: unknown[] = [id, ctx.orgId, dir]; const r = await ctx.tx.query("update erp.financial_titles set status='cancelled', version=version+1 where id=$1 and organization_id=$2 and direction=$3 and status<>'cancelled' and paid_amount=0" + farmScopeSql(ctx, "farm_id", bp), bp); n += r.rowCount ?? 0; } return { cancelled: n, skipped: d.ids.length - n }; }));
    app.post(`${base}/:id/duplicate`, async (req, reply) => reply.status(201).send(await runService(app, req, permOf(dir, "duplicate"), async (ctx) => {
      const { id } = req.params as { id: string }; const t = await getTitle(ctx, id) as Record<string, unknown> & { apportionments: { financial_category_id: string; cost_center_id: string; chart_account_id: string | null; harvest_id: string | null; area_id: string | null; percentage: string }[] };
      const c = await createTitles(ctx, { farmId: t.farm_id as string, direction: dir, number: `${t.number}-C`, titleTypeId: t.title_type_id as string | null, personId: t.person_id as string | null, proprietaryId: t.proprietary_id as string | null, classification: t.classification as "unclassified", documentType: t.document_type as string | null, isDeductible: t.is_deductible as boolean, isTax: t.is_tax as boolean, amount: t.amount as string, discount: t.discount as string, emissionDate: todayISO(), dueDate: t.due_date as string, note: t.note as string, harvestId: t.harvest_id as string | null, apportionment: t.apportionments.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, chartAccountId: a.chart_account_id, harvestId: a.harvest_id, areaId: a.area_id, percentage: a.percentage })) });
      return { id: c.ids[0] };
    })));
    // Baixa (individual ou em lote: "Baixar Contas")
    const settleSchema = z.object({ settlement_date: date, settlement_kind: z.enum(["bank_movement", "cross_settlement", "advance_compensation"]).default("bank_movement"), bank_account_id: uuid.optional().nullable(), cross_title_id: uuid.optional().nullable(), amount: dec, discount: dec.default("0"), penalty: dec.default("0"), interest: dec.default("0"), increase: dec.default("0"), foreign_amount: dec.optional().nullable(), ptax_rate: dec.optional().nullable(), exchange_adjustment: dec.default("0"), note: z.string().optional().nullable(), movement_mode: z.enum(["separate", "single"]).default("separate") });
    app.post(`${base}/:id/settle`, async (req, reply) => reply.status(201).send(await runService(app, req, permOf(dir, "settle"), async (ctx) => { const { id } = req.params as { id: string }; const d = settleSchema.parse(req.body); return (await idempotent(ctx.tx, ctx.orgId, idem(req), { id, ...d }, () => settle(ctx, id, d))).result; })));
    app.post(`${base}/settle-batch`, async (req, reply) => reply.status(201).send(await runService(app, req, permOf(dir, "settle"), async (ctx) => {
      const d = z.object({ ids: z.array(uuid).min(1), settlement_date: date, bank_account_id: uuid, movement_mode: z.enum(["separate", "single"]).default("separate"), note: z.string().optional().nullable() }).parse(req.body);
      return (await idempotent(ctx.tx, ctx.orgId, idem(req), d, async () => {
        const results = []; let sharedMovement: string | null = null; let total = D(0);
        for (const id of d.ids) { const bal = (await ctx.tx.query<{ balance: string; direction: string; farm_id: string; number: string }>("select balance, direction, farm_id, number from erp.financial_titles where id=$1 and organization_id=$2 and status in ('open','partially_paid') for update", [id, ctx.orgId])).rows[0]; if (!bal || !farmAllowed(ctx, bal.farm_id)) continue; total = total.plus(bal.balance); }
        if (d.movement_mode === "single" && total.gt(0)) sharedMovement = await createBankMovement(ctx, { farmId: ctx.farmId, bankAccountId: d.bank_account_id, date: d.settlement_date, type: dir === "payable" ? "out" : "in", amount: money(total), note: d.note ?? `Baixa em lote de ${d.ids.length} títulos`, sourceType: "title_settlement_batch", sourceId: d.ids[0] });
        for (const id of d.ids) { const bal = (await ctx.tx.query<{ balance: string }>("select balance from erp.financial_titles where id=$1 and status in ('open','partially_paid')", [id])).rows[0]; if (!bal) continue; results.push(await settle(ctx, id, { settlement_date: d.settlement_date, settlement_kind: "bank_movement", bank_account_id: d.bank_account_id, amount: bal.balance, note: d.note ?? null, movement_mode: d.movement_mode, shared_movement_id: sharedMovement })); }
        return { settled: results.length, total: money(total), items: results };
      })).result;
    })));
    app.post(`${base}/:id/settlements/:sid/cancel`, async (req) => runService(app, req, permOf(dir, "cancel_settlement"), async (ctx) => {
      const { id, sid } = req.params as { id: string; sid: string }; const d = z.object({ reason: z.string().min(1) }).parse(req.body);
      const s = await ctx.tx.query<{ status: string; bank_movement_id: string | null; settlement_date: string; cross_title_id: string | null; amount: string }>("select status, bank_movement_id, settlement_date, cross_title_id, amount from erp.title_settlements where id=$1 and title_id=$2 and organization_id=$3 for update", [sid, id, ctx.orgId]);
      if (!s.rows[0]) throw notFound("Baixa"); if (s.rows[0].status === "cancelled") throw err("ALREADY_CANCELLED", "Baixa já cancelada");
      const t = await ctx.tx.query<{ farm_id: string }>("select farm_id from erp.financial_titles where id=$1", [id]); await exigirEmpresaVisivel(ctx, t.rows[0]!.farm_id, "Título"); await assertPeriodOpen(ctx.tx, ctx.orgId, t.rows[0]!.farm_id, s.rows[0].settlement_date);
      await ctx.tx.query("update erp.title_settlements set status='cancelled', cancelled_at=now(), cancelled_by=$2, cancel_reason=$3 where id=$1", [sid, ctx.user.id, d.reason]);
      if (s.rows[0].bank_movement_id) { const shared = await ctx.tx.query<{ n: string }>("select count(*) n from erp.title_settlements where bank_movement_id=$1 and status='confirmed'", [s.rows[0].bank_movement_id]); if (Number(shared.rows[0]!.n) === 0) await ctx.tx.query("update erp.bank_movements set status='cancelled' where id=$1", [s.rows[0].bank_movement_id]); else throw err("CONFLICT", "Movimento bancário compartilhado com outras baixas: cancele todas ou lance ajuste"); }
      if (s.rows[0].cross_title_id) await ctx.tx.query("update erp.title_settlements set status='cancelled', cancelled_at=now(), cancelled_by=$2, cancel_reason=$3 where title_id=$1 and cross_title_id=$4 and status='confirmed'", [s.rows[0].cross_title_id, ctx.user.id, d.reason, id]);
      await audit(ctx.tx, ctx, "title_settlements", sid, "cancel", d);
      return getTitle(ctx, id);
    }));
    app.get(`${base}/:id/receipt`, async (req) => runService(app, req, permOf(dir, "receipt"), async (ctx) => { const t = await getTitle(ctx, (req.params as { id: string }).id); return { title: t, receipt_text: `RECIBO — ${t.farm_name}\nTítulo ${t.number} (${t.code})\n${dir === "payable" ? "Pago a" : "Recebido de"}: ${t.person_name ?? "-"}\nValor: R$ ${t.amount} (líquido R$ ${t.net_amount})\nBaixas: ${(t.settlements as { settlement_date: string; net_amount: string }[]).filter(Boolean).map((s) => `${s.settlement_date}: R$ ${s.net_amount}`).join("; ") || "nenhuma"}\nHistórico: ${t.note}` }; }));
  }

  async function settle(ctx: ServiceCtx, titleId: string, d: { settlement_date: string; settlement_kind: "bank_movement" | "cross_settlement" | "advance_compensation"; bank_account_id?: string | null; cross_title_id?: string | null; amount: string; discount?: string; penalty?: string; interest?: string; increase?: string; foreign_amount?: string | null; ptax_rate?: string | null; exchange_adjustment?: string; note?: string | null; movement_mode: "separate" | "single"; shared_movement_id?: string | null }) {
    const t = await ctx.tx.query<{ direction: "payable" | "receivable"; balance: string; status: string; farm_id: string; number: string; person_id: string | null; proprietary_id: string | null; harvest_id: string | null; is_deductible: boolean }>("select direction, balance, status, farm_id, number, person_id, proprietary_id, harvest_id, is_deductible from erp.financial_titles where id=$1 and organization_id=$2 and deleted_at is null for update", [titleId, ctx.orgId]);
    const title = t.rows[0]; if (!title) throw notFound("Título"); await exigirEmpresaVisivel(ctx, title.farm_id, "Título"); if (title.status === "cancelled") throw err("ALREADY_CANCELLED", "Título cancelado"); if (title.status === "paid") throw err("ALREADY_CONFIRMED", "Título já baixado");
    await assertPeriodOpen(ctx.tx, ctx.orgId, title.farm_id, d.settlement_date);
    const input = { amount: d.amount, discount: d.discount ?? "0", penalty: d.penalty ?? "0", interest: d.interest ?? "0", increase: d.increase ?? "0", exchangeAdjustment: d.exchange_adjustment ?? "0" };
    assertSettlementWithinBalance(title.balance, input);
    const net = settlementNet(input);
    let movementId: string | null = d.shared_movement_id ?? null;
    if (d.settlement_kind === "bank_movement") {
      if (!d.bank_account_id) throw validation("Conta bancária obrigatória");
      if (!movementId) {
        const lines = await ctx.tx.query<{ financial_category_id: string; cost_center_id: string; chart_account_id: string | null; harvest_id: string | null; percentage: string }>("select financial_category_id, cost_center_id, chart_account_id, harvest_id, percentage from erp.title_apportionments where title_id=$1", [titleId]);
        movementId = await createBankMovement(ctx, { farmId: title.farm_id, bankAccountId: d.bank_account_id, date: d.settlement_date, type: title.direction === "payable" ? "out" : "in", amount: net, interest: "0", document: title.number, note: d.note ?? `Baixa do título ${title.number}`, proprietaryId: title.proprietary_id, personId: title.person_id, harvestId: title.harvest_id, isDeductible: title.is_deductible, sourceType: "title_settlements", sourceId: titleId, apportionment: lines.rows.map((l) => ({ financialCategoryId: l.financial_category_id, costCenterId: l.cost_center_id, chartAccountId: l.chart_account_id, harvestId: l.harvest_id, percentage: l.percentage })) });
      }
    } else if (d.settlement_kind === "cross_settlement" || d.settlement_kind === "advance_compensation") {
      if (!d.cross_title_id) throw validation("Título contrário obrigatório para baixa cruzada");
      const ct = await ctx.tx.query<{ direction: string; balance: string; status: string }>("select direction, balance, status from erp.financial_titles where id=$1 and organization_id=$2 for update", [d.cross_title_id, ctx.orgId]);
      if (!ct.rows[0] || ct.rows[0].direction === title.direction) throw validation("Baixa cruzada exige um título de natureza oposta");
      if (D(ct.rows[0].balance).lt(d.amount)) throw err("PAYMENT_EXCEEDS_BALANCE", "Saldo do título contrário insuficiente");
      await ctx.tx.query("insert into erp.title_settlements(organization_id,title_id,settlement_date,settlement_kind,cross_title_id,amount,net_amount,note,created_by) values ($1,$2,$3,$4,$5,$6,$6,$7,$8)", [ctx.orgId, d.cross_title_id, d.settlement_date, d.settlement_kind, titleId, money(d.amount), d.note ?? `Baixa cruzada com ${title.number}`, ctx.user.id]);
    }
    const s = await ctx.tx.query<{ id: string }>("insert into erp.title_settlements(organization_id,title_id,settlement_date,settlement_kind,bank_account_id,bank_movement_id,cross_title_id,amount,discount,penalty,interest,increase,foreign_amount,ptax_rate,exchange_adjustment,net_amount,note,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id",
      [ctx.orgId, titleId, d.settlement_date, d.settlement_kind, d.bank_account_id ?? null, movementId, d.cross_title_id ?? null, money(d.amount), money(input.discount), money(input.penalty), money(input.interest), money(input.increase), d.foreign_amount ?? null, d.ptax_rate ?? null, money(input.exchangeAdjustment), net, d.note ?? null, ctx.user.id]);
    await audit(ctx.tx, ctx, "title_settlements", s.rows[0]!.id, "create", { title: titleId, net });
    const after = await ctx.tx.query<{ status: string; balance: string }>("select status, balance from erp.financial_titles where id=$1", [titleId]);
    return { settlement_id: s.rows[0]!.id, title_id: titleId, net_amount: net, status: after.rows[0]!.status, balance: after.rows[0]!.balance, bank_movement_id: movementId };
  }

  // ---------- Movimentos bancários ----------
  const bmSchema = z.object({ farm_id: uuid.optional().nullable(), bank_account_id: uuid, movement_date: date, type: z.enum(["in", "out"]), category_type: z.enum(["in", "out", "internal_transfer", "financing", "check_return"]).default("in"), destination_account_id: uuid.optional().nullable(), amount: dec, interest: dec.default("0"), document: z.string().optional().nullable(), generates_obligation: z.boolean().default(false), is_deductible: z.boolean().default(false), note: z.string().optional().nullable(), proprietary_id: uuid.optional().nullable(), person_id: uuid.optional().nullable(), harvest_id: uuid.optional().nullable(), apportionment: apportionmentSchema.optional() });
  app.get("/financial/bank-movements", async (req) => runService(app, req, "bank_movements.view", async (ctx) => {
    const q = pageQuerySchema.parse(req.query); const f = req.query as Record<string, string>;
    const where = ["m.organization_id=$1", "m.deleted_at is null"]; const params: unknown[] = [ctx.orgId];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace(/\?/g, `$${params.length}`)); };
    if (f.bank_account_id) add("m.bank_account_id=?", f.bank_account_id);
    if (f.start_date) add("m.movement_date>=?", f.start_date); if (f.end_date) add("m.movement_date<=?", f.end_date);
    if (f.start_value) add("m.amount>=?", f.start_value); if (f.end_value) add("m.amount<=?", f.end_value);
    if (f.proprietary_id) add("m.proprietary_id=?", f.proprietary_id); if (f.harvest_id) add("m.harvest_id=?", f.harvest_id); if (f.person_id) add("m.person_id=?", f.person_id);
    if (f.type) add("m.type=?", f.type); if (f.category_type) add("m.category_type=?", f.category_type);
    if (f.category_id) add("exists (select 1 from erp.bank_movement_apportionments a where a.movement_id=m.id and a.financial_category_id=?)", f.category_id);
    if (f.status) add("m.status=?", f.status); else where.push("m.status='confirmed'");
    if (f.farm_id) add("m.farm_id=?", f.farm_id);
    where.push(...farmScope(ctx, "m", params, { nullable: true, ignoreSelected: Boolean(f.farm_id) }));
    const w = where.join(" and ");
    const tot = await ctx.tx.query<{ n: string; in_amount: string; out_amount: string; interest: string }>(`select count(*) n, coalesce(sum(case when m.type='in' then m.amount end),0) in_amount, coalesce(sum(case when m.type='out' then m.amount end),0) out_amount, coalesce(sum(m.interest),0) interest from erp.bank_movements m where ${w}`, params);
    const r = await ctx.tx.query(`select m.*, ba.code as account_code, ba.agency, ba.account_number, ba.description as bank_account_name, p.name as person_name, pr.name as proprietary_name, u.name as created_by_name, (select count(*) from erp.attachments a where a.entity='bank_movement' and a.entity_id=m.id)::int as attachment_count from erp.bank_movements m join erp.bank_accounts ba on ba.id=m.bank_account_id left join erp.people p on p.id=m.person_id left join erp.people pr on pr.id=m.proprietary_id left join erp.users u on u.id=m.created_by where ${w} order by m.movement_date desc, m.created_at desc limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`, params);
    return { items: r.rows, total: Number(tot.rows[0]!.n), page: q.page, pageSize: q.pageSize, totals: { in: tot.rows[0]!.in_amount, out: tot.rows[0]!.out_amount, interest: tot.rows[0]!.interest, net: money(D(tot.rows[0]!.in_amount).minus(tot.rows[0]!.out_amount)) } };
  }));
  app.get("/financial/bank-movements/:id", async (req) => runService(app, req, "bank_movements.view", async (ctx) => {
    const { id } = req.params as { id: string };
    const r = await ctx.tx.query("select m.*, ba.description as bank_account_name, ba.bank_code, ba.agency, ba.account_number, f.name as farm_name, p.name as person_name, p.document as person_document, pr.name as proprietary_name, da.description as destination_account_name from erp.bank_movements m join erp.bank_accounts ba on ba.id=m.bank_account_id left join erp.farms f on f.id=m.farm_id left join erp.people p on p.id=m.person_id left join erp.people pr on pr.id=m.proprietary_id left join erp.bank_accounts da on da.id=m.destination_account_id where m.id=$1 and m.organization_id=$2 and m.deleted_at is null" + scopedById(ctx, "m", id, { nullable: true }).sql, scopedById(ctx, "m", id, { nullable: true }).params); if (!r.rows[0]) throw notFound("Movimento");
    const app_ = await ctx.tx.query("select a.*, fc.name as category_name, fc.code as category_code, cc.name as cost_center_name, ca.description as chart_account_name from erp.bank_movement_apportionments a join erp.financial_categories fc on fc.id=a.financial_category_id join erp.cost_centers cc on cc.id=a.cost_center_id left join erp.chart_accounts ca on ca.id=a.chart_account_id where a.movement_id=$1", [id]);
    const settlements = await ctx.tx.query("select s.id, s.title_id, t.number, t.code, s.net_amount from erp.title_settlements s join erp.financial_titles t on t.id=s.title_id where s.bank_movement_id=$1 and s.status='confirmed'", [id]);
    return { ...r.rows[0], apportionments: app_.rows, settlements: settlements.rows };
  }));
  app.post("/financial/bank-movements", async (req, reply) => reply.status(201).send(await runService(app, req, "bank_movements.create", async (ctx) => {
    const d = bmSchema.parse(req.body); await exigirEmpresaDeLancamento(ctx, d.farm_id);
    if (d.category_type === "internal_transfer" && !d.destination_account_id) throw validation("Conta destino obrigatória em transferência interna");
    if (d.category_type !== "internal_transfer" && !d.apportionment?.length) throw validation("Rateio (categoria/centro de custo) obrigatório");
    return (await idempotent(ctx.tx, ctx.orgId, idem(req), d, async () => {
      const id = await createBankMovement(ctx, { farmId: d.farm_id ?? ctx.farmId, bankAccountId: d.bank_account_id, date: d.movement_date, type: d.type, categoryType: d.category_type, destinationAccountId: d.destination_account_id ?? null, amount: d.amount, interest: d.interest, document: d.document, note: d.note, proprietaryId: d.proprietary_id, personId: d.person_id, harvestId: d.harvest_id, isDeductible: d.is_deductible, generatesObligation: d.generates_obligation, sourceType: "manual", sourceId: undefined, apportionment: d.apportionment?.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, chartAccountId: a.chart_account_id ?? null, harvestId: a.harvest_id ?? null, percentage: a.percentage, amount: a.amount })) });
      // "Gera obrigação": cria título correspondente já baixado por este movimento (ex.: saída sem título prévio)
      if (d.generates_obligation && d.person_id && d.apportionment?.length) {
        const c = await createTitles(ctx, { farmId: d.farm_id ?? ctx.farmId ?? (await ctx.tx.query<{ id: string }>("select id from erp.farms where organization_id=$1 order by code limit 1", [ctx.orgId])).rows[0]!.id, direction: d.type === "out" ? "payable" : "receivable", number: d.document ?? `MOV-${id.slice(0, 8)}`, personId: d.person_id, amount: money(d.amount), emissionDate: d.movement_date, dueDate: d.movement_date, note: d.note ?? "Gerado pelo movimento bancário", isDeductible: d.is_deductible, apportionment: d.apportionment.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, percentage: a.percentage, amount: a.amount })), sourceType: "bank_movements", sourceId: id });
        await ctx.tx.query("insert into erp.title_settlements(organization_id,title_id,settlement_date,settlement_kind,bank_account_id,bank_movement_id,amount,net_amount,note,created_by) values ($1,$2,$3,'bank_movement',$4,$5,$6,$6,'Baixa automática pelo movimento',$7)", [ctx.orgId, c.ids[0], d.movement_date, d.bank_account_id, id, money(d.amount), ctx.user.id]);
      }
      await audit(ctx.tx, ctx, "bank_movements", id, "create");
      return { id };
    })).result;
  })));
  app.put("/financial/bank-movements/:id", async (req) => runService(app, req, "bank_movements.edit", async (ctx) => {
    const { id } = req.params as { id: string }; const d = bmSchema.partial().parse(req.body);
    const cur = await ctx.tx.query<{ source_type: string | null; farm_id: string | null; movement_date: string; status: string }>("select source_type, farm_id, movement_date, status from erp.bank_movements where id=$1 and organization_id=$2 for update", [id, ctx.orgId]); if (!cur.rows[0]) throw notFound("Movimento"); await exigirEmpresaVisivel(ctx, cur.rows[0].farm_id, "Movimento");
    if (cur.rows[0].status === "cancelled") throw err("ALREADY_CANCELLED", "Movimento cancelado");
    if (cur.rows[0].source_type && cur.rows[0].source_type !== "manual") throw err("CONFLICT", "Movimento gerado por outro documento: altere pela origem");
    await assertPeriodOpen(ctx.tx, ctx.orgId, cur.rows[0].farm_id, cur.rows[0].movement_date);
    await ctx.tx.query("update erp.bank_movements set movement_date=coalesce($3,movement_date), amount=coalesce($4,amount), interest=coalesce($5,interest), document=coalesce($6,document), note=coalesce($7,note), is_deductible=coalesce($8,is_deductible), person_id=coalesce($9,person_id), proprietary_id=coalesce($10,proprietary_id), harvest_id=coalesce($11,harvest_id), updated_at=now() where id=$1 and organization_id=$2", [id, ctx.orgId, d.movement_date ?? null, d.amount ?? null, d.interest ?? null, d.document ?? null, d.note ?? null, d.is_deductible ?? null, d.person_id ?? null, d.proprietary_id ?? null, d.harvest_id ?? null]);
    if (d.apportionment) { const { normalizeApportionment } = await import("@agro/domain"); const amt = (await ctx.tx.query<{ amount: string }>("select amount from erp.bank_movements where id=$1", [id])).rows[0]!.amount; await ctx.tx.query("delete from erp.bank_movement_apportionments where movement_id=$1", [id]); for (const l of normalizeApportionment(amt, d.apportionment.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, chartAccountId: a.chart_account_id ?? null, harvestId: a.harvest_id ?? null, percentage: a.percentage, amount: a.amount })))) await ctx.tx.query("insert into erp.bank_movement_apportionments(movement_id,financial_category_id,chart_account_id,cost_center_id,harvest_id,percentage,amount) values ($1,$2,$3,$4,$5,$6,$7)", [id, l.financialCategoryId, l.chartAccountId, l.costCenterId, l.harvestId, l.percentage, l.amount]); }
    await audit(ctx.tx, ctx, "bank_movements", id, "update");
    return { id };
  }));
  app.post("/financial/bank-movements/:id/cancel", async (req) => runService(app, req, "bank_movements.delete", async (ctx) => {
    const { id } = req.params as { id: string };
    const cur = await ctx.tx.query<{ status: string; farm_id: string | null; movement_date: string; transfer_pair_id: string | null }>("select status, farm_id, movement_date, transfer_pair_id from erp.bank_movements where id=$1 and organization_id=$2 for update", [id, ctx.orgId]); if (!cur.rows[0]) throw notFound("Movimento"); await exigirEmpresaVisivel(ctx, cur.rows[0].farm_id, "Movimento"); if (cur.rows[0].status === "cancelled") throw err("ALREADY_CANCELLED", "Já cancelado");
    const linked = await ctx.tx.query("select 1 from erp.title_settlements where bank_movement_id=$1 and status='confirmed' limit 1", [id]); if (linked.rowCount) throw err("CONFLICT", "Movimento vinculado a baixa de título: cancele a baixa");
    await assertPeriodOpen(ctx.tx, ctx.orgId, cur.rows[0].farm_id, cur.rows[0].movement_date);
    await ctx.tx.query("update erp.bank_movements set status='cancelled', updated_at=now() where id=$1 or id=$2", [id, cur.rows[0].transfer_pair_id ?? id]);
    await audit(ctx.tx, ctx, "bank_movements", id, "cancel");
    return { id, status: "cancelled" };
  }));
  /**
   * SALDO DE CONTA BANCÁRIA É NÚMERO DA ORGANIZAÇÃO (docs/MULTI-COMPANY-CONTRACT.md §7, "Saldo bancário").
   *
   * A conta é cadastro da organização e o `opening_balance` dela não tem empresa — não é decomponível por
   * empresa sem inventar rateio. Por isso a porta exige CAPACIDADE DE ORGANIZAÇÃO (`bank_accounts.view`), e
   * não apenas a permissão financeira de empresa: uma permissão company-scoped não pode devolver em silêncio
   * um agregado que soma movimentos de empresas que o usuário não enxerga. A permissão financeira continua
   * exigida por cima — ninguém passa a ver o que não via antes.
   */
  app.get("/financial/bank-accounts/balances", async (req) => runService(app, req, "bank_accounts.view", async (ctx) => {
    requirePermission(ctx, "bank_movements.view");
    const r = await ctx.tx.query("select a.id, a.code, a.description, a.type, a.bank_code, a.agency, a.account_number, a.opening_balance, a.credit_limit, b.balance from erp.bank_accounts a join erp.v_bank_account_balances b on b.bank_account_id=a.id where a.organization_id=$1 and a.deleted_at is null and a.is_active order by a.code", [ctx.orgId]);
    return { items: r.rows, total_balance: money(r.rows.reduce((s, x) => s.plus((x as { balance: string }).balance), D(0))) };
  }));
  // Saldo inicial de conta (tela "Saldo Inicial"): movimento de abertura
  app.post("/financial/opening-movements", async (req, reply) => reply.status(201).send(await runService(app, req, "opening_movements.create", async (ctx) => {
    const d = z.object({ bank_account_id: uuid, date: date, amount: dec, proprietary_id: uuid.optional().nullable(), document: z.string().optional().nullable(), note: z.string().optional().nullable(), apportionment: apportionmentSchema.optional() }).parse(req.body);
    const exists = await ctx.tx.query("select 1 from erp.bank_movements where organization_id=$1 and bank_account_id=$2 and category_type='opening_balance' and status='confirmed'", [ctx.orgId, d.bank_account_id]); if (exists.rowCount) throw err("DUPLICATE_DOCUMENT", "Conta já possui saldo inicial lançado");
    const id = await createBankMovement(ctx, { farmId: ctx.farmId, bankAccountId: d.bank_account_id, date: d.date, type: "in", categoryType: "opening_balance", amount: d.amount, document: d.document, note: d.note ?? "Saldo inicial", proprietaryId: d.proprietary_id, sourceType: "opening_movement", apportionment: d.apportionment?.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, percentage: a.percentage, amount: a.amount })) });
    return { id };
  })));

  // ---------- Fluxo bancário (análise) ----------
  // Fluxo de caixa por CONTA: parte do `opening_balance` da conta (sem empresa) e acumula saldo — mesmo
  // contrato do saldo bancário: capacidade de organização + a permissão financeira por cima.
  app.get("/financial/cash-flow", async (req) => runService(app, req, "bank_accounts.view", async (ctx) => {
    requirePermission(ctx, "cash_flow.view");
    const q = z.object({ account_ids: z.union([z.string(), z.array(z.string())]).transform((v) => (Array.isArray(v) ? v : v.split(","))), period: z.enum(["daily", "monthly", "yearly"]).default("monthly"), mode: z.enum(["synthetic", "analytic"]).default("synthetic"), start_date: date, end_date: date }).parse(req.query);
    const trunc = q.period === "daily" ? "day" : q.period === "monthly" ? "month" : "year";
    const opening = await ctx.tx.query<{ v: string }>("select coalesce(sum(a.opening_balance),0) + coalesce((select sum(case when m.type='in' then m.amount+m.interest else -(m.amount+m.interest) end) from erp.bank_movements m where m.bank_account_id = any($2::uuid[]) and m.status='confirmed' and m.deleted_at is null and m.movement_date < $3),0) as v from erp.bank_accounts a where a.organization_id=$1 and a.id = any($2::uuid[])", [ctx.orgId, q.account_ids, q.start_date]);
    const rows = await ctx.tx.query<{ period: string; in_amount: string; out_amount: string }>(`select to_char(date_trunc('${trunc}', movement_date),'YYYY-MM-DD') as period, coalesce(sum(case when type='in' then amount+interest end),0) in_amount, coalesce(sum(case when type='out' then amount+interest end),0) out_amount from erp.bank_movements where organization_id=$1 and bank_account_id = any($2::uuid[]) and status='confirmed' and deleted_at is null and movement_date between $3 and $4 group by 1 order by 1`, [ctx.orgId, q.account_ids, q.start_date, q.end_date]);
    let bal = D(opening.rows[0]!.v);
    const periods = rows.rows.map((r) => { bal = bal.plus(r.in_amount).minus(r.out_amount); return { ...r, balance: money(bal) }; });
    const detail = q.mode === "analytic" ? (await ctx.tx.query("select m.id, m.movement_date, m.type, m.amount, m.interest, m.note, m.document, ba.code as account_code, (select string_agg(fc.name, ', ') from erp.bank_movement_apportionments a join erp.financial_categories fc on fc.id=a.financial_category_id where a.movement_id=m.id) as categories from erp.bank_movements m join erp.bank_accounts ba on ba.id=m.bank_account_id where m.organization_id=$1 and m.bank_account_id = any($2::uuid[]) and m.status='confirmed' and m.deleted_at is null and m.movement_date between $3 and $4 order by m.movement_date, m.created_at", [ctx.orgId, q.account_ids, q.start_date, q.end_date])).rows : [];
    return { opening_balance: money(opening.rows[0]!.v), closing_balance: money(bal), periods, movements: detail };
  }));

  // ---------- Conciliação OFX ----------
  app.get("/financial/ofx-imports", async (req) => runService(app, req, "ofx_imports.view", async (ctx) => { const f = req.query as Record<string, string>; const where = ["i.organization_id=$1", "i.deleted_at is null"]; const params: unknown[] = [ctx.orgId]; if (f.bank_account_id) { params.push(f.bank_account_id); where.push(`i.bank_account_id=$${params.length}`); } if (f.description) { params.push(`%${f.description}%`); where.push(`i.description ilike $${params.length}`); } if (f.start_date) { params.push(f.start_date); where.push(`i.start_date>=$${params.length}`); } if (f.end_date) { params.push(f.end_date); where.push(`i.end_date<=$${params.length}`); } const r = await ctx.tx.query(`select i.*, ba.description as bank_account_name, (select count(*) from erp.ofx_transactions t where t.import_id=i.id)::int as transaction_count, (select count(*) from erp.ofx_transactions t where t.import_id=i.id and t.status='matched')::int as matched_count from erp.ofx_imports i join erp.bank_accounts ba on ba.id=i.bank_account_id where ${where.join(" and ")} order by i.created_at desc`, params); return { items: r.rows, total: r.rowCount }; }));
  /** Importa OFX (conteúdo textual) — parser próprio do formato SGML/XML de STMTTRN. */
  app.post("/financial/ofx-imports", async (req, reply) => reply.status(201).send(await runService(app, req, "ofx_imports.create", async (ctx) => {
    const d = z.object({ bank_account_id: uuid, description: z.string().min(1), content: z.string().min(10) }).parse(req.body);
    const txs = parseOfx(d.content); if (!txs.length) throw validation("Nenhuma transação encontrada no OFX");
    const dates = txs.map((t) => t.date).sort(); const code = await nextCode(ctx.tx, ctx.orgId, "ofx_import");
    const r = await ctx.tx.query<{ id: string }>("insert into erp.ofx_imports(organization_id,code,description,bank_account_id,start_date,end_date,created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id", [ctx.orgId, code, d.description, d.bank_account_id, dates[0], dates[dates.length - 1], ctx.user.id]);
    let matched = 0;
    for (const t of txs) {
      const m = await ctx.tx.query<{ id: string }>("select id from erp.bank_movements where organization_id=$1 and bank_account_id=$2 and status='confirmed' and reconciled_at is null and movement_date=$3 and amount=$4 and type=$5 limit 1", [ctx.orgId, d.bank_account_id, t.date, Math.abs(t.amount).toFixed(2), t.amount >= 0 ? "in" : "out"]);
      const ins = await ctx.tx.query<{ id: string }>("insert into erp.ofx_transactions(import_id,organization_id,fitid,posted_date,amount,memo,check_number,bank_movement_id,status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (import_id,fitid) do nothing returning id", [r.rows[0]!.id, ctx.orgId, t.fitid, t.date, t.amount.toFixed(2), t.memo, t.checkNumber, m.rows[0]?.id ?? null, m.rows[0] ? "matched" : "pending"]);
      if (m.rows[0] && ins.rows[0]) { matched++; await ctx.tx.query("update erp.bank_movements set reconciled_at=now(), ofx_transaction_id=$2 where id=$1", [m.rows[0].id, ins.rows[0].id]); }
    }
    return { id: r.rows[0]!.id, code, transactions: txs.length, matched };
  })));
  app.get("/financial/ofx-imports/:id", async (req) => runService(app, req, "ofx_imports.view", async (ctx) => { const { id } = req.params as { id: string }; const i = await ctx.tx.query("select * from erp.ofx_imports where id=$1 and organization_id=$2 and deleted_at is null", [id, ctx.orgId]); if (!i.rows[0]) throw notFound(); const t = await ctx.tx.query("select t.*, m.code as movement_code, m.note as movement_note from erp.ofx_transactions t left join erp.bank_movements m on m.id=t.bank_movement_id where t.import_id=$1 order by t.posted_date", [id]); return { ...i.rows[0], transactions: t.rows }; }));
  app.post("/financial/ofx-imports/:id/transactions/:tid/match", async (req) => runService(app, req, "ofx_imports.reconcile", async (ctx) => {
    const { id, tid } = req.params as { id: string; tid: string }; const d = z.object({ bank_movement_id: uuid.optional().nullable(), ignore: z.boolean().default(false), create: z.object({ note: z.string().optional(), apportionment: apportionmentSchema }).optional() }).parse(req.body);
    const t = await ctx.tx.query<{ posted_date: string; amount: string; memo: string | null; status: string }>("select posted_date, amount, memo, status from erp.ofx_transactions where id=$1 and import_id=$2 and organization_id=$3 for update", [tid, id, ctx.orgId]); if (!t.rows[0]) throw notFound("Transação");
    const imp = await ctx.tx.query<{ bank_account_id: string }>("select bank_account_id from erp.ofx_imports where id=$1", [id]);
    if (d.ignore) { await ctx.tx.query("update erp.ofx_transactions set status='ignored' where id=$1", [tid]); return { id: tid, status: "ignored" }; }
    let mid = d.bank_movement_id ?? null;
    if (!mid && d.create) mid = await createBankMovement(ctx, { farmId: ctx.farmId, bankAccountId: imp.rows[0]!.bank_account_id, date: t.rows[0].posted_date, type: D(t.rows[0].amount).gte(0) ? "in" : "out", amount: D(t.rows[0].amount).abs().toFixed(2), note: d.create.note ?? t.rows[0].memo ?? "Conciliação OFX", sourceType: "ofx", sourceId: tid, apportionment: d.create.apportionment.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, percentage: a.percentage, amount: a.amount })) });
    if (!mid) throw validation("Informe o movimento ou os dados para criar um");
    await ctx.tx.query("update erp.ofx_transactions set bank_movement_id=$2, status='matched' where id=$1", [tid, mid]);
    await ctx.tx.query("update erp.bank_movements set reconciled_at=now(), ofx_transaction_id=$2 where id=$1", [mid, tid]);
    const pending = await ctx.tx.query<{ n: string }>("select count(*) n from erp.ofx_transactions where import_id=$1 and status='pending'", [id]);
    await ctx.tx.query("update erp.ofx_imports set status=$2 where id=$1", [id, Number(pending.rows[0]!.n) === 0 ? "reconciled" : "reconciling"]);
    return { id: tid, status: "matched", bank_movement_id: mid };
  }));
  // Conciliação OFX: `erp.ofx_transactions` é da CONTA (não tem empresa) — agregado de organização.
  app.get("/financial/ofx-report", async (req) => runService(app, req, "bank_accounts.view", async (ctx) => {
    requirePermission(ctx, "ofx_report.view"); const r = await ctx.tx.query("select ba.code as account_code, ba.description as account_name, to_char(t.posted_date,'YYYY-MM') as month, count(*)::int as transactions, count(*) filter (where t.status='matched')::int as matched, count(*) filter (where t.status='pending')::int as pending, count(*) filter (where t.status='ignored')::int as ignored from erp.ofx_transactions t join erp.ofx_imports i on i.id=t.import_id join erp.bank_accounts ba on ba.id=i.bank_account_id where t.organization_id=$1 group by 1,2,3 order by 3 desc, 1", [ctx.orgId]); return { items: r.rows.map((x) => ({ ...(x as Record<string, unknown>), reconciled: (x as { pending: number }).pending === 0 })) }; }));

  // ---------- Previsão orçamentária (valores por categoria × mês) ----------
  app.get("/financial/budget-plannings/:id/values", async (req) => runService(app, req, "budget_plannings.view", async (ctx) => {
    const { id } = req.params as { id: string }; const p = await ctx.tx.query<{ year: number; farm_id: string | null }>("select year, farm_id from erp.budget_plannings where id=$1 and organization_id=$2" + scopedById(ctx, "farm_id", id, { nullable: true }).sql, scopedById(ctx, "farm_id", id, { nullable: true }).params); if (!p.rows[0]) throw notFound();
    const cats = await ctx.tx.query("select id, code, name, nature, kind, parent_id from erp.financial_categories where organization_id=$1 and deleted_at is null and is_active order by code", [ctx.orgId]);
    const vals = await ctx.tx.query<{ financial_category_id: string; month: number; amount: string }>("select financial_category_id, month, amount from erp.budget_planning_values where planning_id=$1", [id]);
    const prev = await ctx.tx.query<{ financial_category_id: string; total: string }>("select a.financial_category_id, sum(a.amount) total from erp.title_apportionments a join erp.financial_titles t on t.id=a.title_id where t.organization_id=$1 and t.status<>'cancelled' and extract(year from t.due_date)=$2 and ($3::uuid is null or t.farm_id=$3) group by 1", [ctx.orgId, p.rows[0].year - 1, p.rows[0].farm_id]);
    const prevMap = new Map(prev.rows.map((r) => [r.financial_category_id, r.total]));
    return { year: p.rows[0].year, categories: cats.rows.map((c) => ({ ...(c as Record<string, unknown>), previous_year: prevMap.get((c as { id: string }).id) ?? "0.00", months: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, vals.rows.find((v) => v.financial_category_id === (c as { id: string }).id && v.month === i + 1)?.amount ?? "0.00"])) })) };
  }));
  app.put("/financial/budget-plannings/:id/values", async (req) => runService(app, req, "budget_plannings.edit", async (ctx) => {
    const { id } = req.params as { id: string }; const d = z.array(z.object({ financial_category_id: uuid, month: z.number().int().min(1).max(12), amount: dec })).parse(req.body);
    const p = await ctx.tx.query("select 1 from erp.budget_plannings where id=$1 and organization_id=$2" + scopedById(ctx, "farm_id", id, { nullable: true }).sql, scopedById(ctx, "farm_id", id, { nullable: true }).params); if (!p.rowCount) throw notFound();
    for (const v of d) await ctx.tx.query("insert into erp.budget_planning_values(planning_id,financial_category_id,month,amount) values ($1,$2,$3,$4) on conflict (planning_id,financial_category_id,month) do update set amount=excluded.amount", [id, v.financial_category_id, v.month, money(v.amount)]);
    return { saved: d.length };
  }));
  // Contas tributárias (títulos marcados como tributo)
  app.get("/financial/tax-accounts", async (req) => runService(app, req, "report.tax_accounts.view", async (ctx) => listTitles(ctx, "payable", { ...(req.query as Record<string, unknown>), is_tax: "true" }).then(async (r) => ({ ...r, items: r.items.filter((t) => (t as unknown as { is_tax: boolean }).is_tax) }))));
}

/** Parser OFX (SGML ou XML) para STMTTRN. */
export function parseOfx(content: string): { fitid: string; date: string; amount: number; memo: string | null; checkNumber: string | null }[] {
  const out: { fitid: string; date: string; amount: number; memo: string | null; checkNumber: string | null }[] = [];
  const blocks = content.split(/<STMTTRN>/i).slice(1);
  for (const b of blocks) {
    const get = (tag: string) => { const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(b); return m ? m[1]!.trim() : null; };
    const dt = get("DTPOSTED") ?? ""; const amt = get("TRNAMT"); const fitid = get("FITID");
    if (!fitid || !amt || dt.length < 8) continue;
    out.push({ fitid, date: `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`, amount: Number(amt.replace(",", ".")), memo: get("MEMO") ?? get("NAME"), checkNumber: get("CHECKNUM") });
  }
  return out;
}
function mapTitle(d: z.infer<typeof titleSchema>, dir: "payable" | "receivable") {
  return { farmId: d.farm_id, direction: dir, number: d.number, titleTypeId: d.title_type_id ?? null, personId: d.person_id ?? null, proprietaryId: d.proprietary_id ?? null, branchId: d.branch_id ?? null, paymentType: d.payment_type, recurrenceType: d.recurrence_type ?? null, classification: d.classification, documentType: d.document_type ?? null, isDeductible: d.is_deductible, isTax: d.is_tax, amount: d.amount, discount: d.discount, emissionDate: d.emission_date, dueDate: d.due_date, note: d.note, harvestId: d.harvest_id ?? null, appropriation: d.appropriation, appropriationType: d.appropriation_type ?? null, sourceType: "manual" } as const;
}
