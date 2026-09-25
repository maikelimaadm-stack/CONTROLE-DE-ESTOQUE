import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { D, money, isISODate, todayISO } from "@agro/shared";
import { displayTitleStatus, settlementNet, assertSettlementWithinBalance, recurrenceDates, type TitleStatus } from "@agro/domain";
import { runService, idempotent, audit, assertPeriodOpen, nextCode, requirePermission } from "../lib/service.js";
import { notFound, validation, err } from "../lib/errors.js";
import { empresaScope, exigirEmpresaDeLancamento, exigirEmpresaVisivel, empresaPermitida, empresaScopeSql, scopedById, type ServiceCtx } from "../lib/context.js";
import { pageQuerySchema } from "../lib/pagination.js";
import { wrapListing } from "../lib/column-filters.js";
import { createTitles, createBankMovement, apportionmentSchema, installmentPlanSchema, exigirRateioAnalitico } from "../services/financial-core.js";
import { atribuirIdGlobal , paginaComIdGlobal } from "../lib/id-global.js";

const dec = z.union([z.number(), z.string()]).transform(String);
const date = z.string().refine(isISODate, "Data inválida");
const uuid = z.string().uuid();
const idem = (req: { headers: Record<string, unknown> }) => req.headers["idempotency-key"] as string | undefined;
const permOf = (dir: string, action: string) => `${dir === "payable" ? "payables" : "receivables"}.${action}`;

const titleSchema = z.object({
  empresa_id: uuid, number: z.string().min(1).max(40), title_type_id: uuid.optional().nullable(), proprietary_id: uuid.optional().nullable(), person_id: uuid.optional().nullable(), branch_id: uuid.optional().nullable(),
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
  if (f.empresa_id) add("t.empresa_id=?", f.empresa_id); else if (ctx.empresaId) add("t.empresa_id=?", ctx.empresaId);
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
  const wl = wrapListing(`select t.*, p.name as person_name, pr.name as proprietary_name, tt.name as title_type_name, f.name as empresa_name, (select max(settlement_date) from erp.title_settlements s where s.title_id=t.id and s.status='confirmed') as last_settlement_date, (select count(*) from erp.attachments a where a.entity='financial_title' and a.entity_id=t.id)::int as attachment_count from erp.financial_titles t left join erp.people p on p.id=t.person_id left join erp.people pr on pr.id=t.proprietary_id left join erp.title_types tt on tt.id=t.title_type_id join erp.empresas f on f.id=t.empresa_id where ${w} order by t.${sort} ${q.dir ?? "asc"}, t.code`, params, query, q, ", coalesce(sum(t.amount - t.discount),0)::text amount, coalesce(sum(t.balance),0)::text balance, coalesce(sum(t.paid_amount),0)::text paid");
  const tot = await ctx.tx.query<{ n: string; amount: string; balance: string; paid: string }>(wl.countSql, wl.params);
  const r = await ctx.tx.query(wl.pageSql, wl.params);
  const today = todayISO();
  return paginaComIdGlobal(ctx, "financial_titles", { items: r.rows.map((x) => ({ ...(x as Record<string, unknown>), status_label: displayTitleStatus({ status: (x as { status: TitleStatus }).status, dueDate: (x as { due_date: string }).due_date, paymentType: (x as { payment_type: string }).payment_type }, today) })), total: Number(tot.rows[0]!.n), page: q.page, pageSize: q.pageSize, totals: { amount: tot.rows[0]!.amount, balance: tot.rows[0]!.balance, paid: tot.rows[0]!.paid } });
}
/**
 * FRONTEIRA DE VARIANTE — `direction` FAZ PARTE DA AUTORIZAÇÃO, NÃO É FILTRO DE CONVENIÊNCIA.
 *
 * `erp.financial_titles` é UMA tabela com DUAS variantes, e cada variante tem a sua própria família
 * de capacidades (`payables.*` × `receivables.*`). A capacidade da ROTA não substitui a variante do
 * REGISTRO: quem tem `receivables.view` não pode ler um pagável só porque pediu o UUID dele pela rota
 * de recebíveis. Autorização efetiva = CAPACIDADE DA ROTA ∧ DIRECTION DO REGISTRO ∧ TENANT ∧ ESCOPO
 * DE EMPRESA, combinadas com AND.
 *
 * Por isso `expectedDirection` é OBRIGATÓRIO e entra no `where`, não numa conferência posterior:
 * conferir depois de ler já teria lido. Variante errada responde a MESMA 404 de inexistente — não
 * revela que o UUID existe na variante vizinha, nem redireciona para ela.
 *
 * Os placeholders são montados aqui em vez de por `scopedById` porque aquele helper fixa
 * `params=[id, org]` e constrói o escopo a partir de `$3`; acrescentar a direction por fora colidiria
 * com o primeiro placeholder do escopo. O helper global não muda por causa deste caso.
 */
async function getTitle(ctx: ServiceCtx, id: string, expectedDirection: "payable" | "receivable") {
  const params: unknown[] = [id, ctx.orgId, expectedDirection];
  const escopo = empresaScopeSql(ctx, "t", params);
  const r = await ctx.tx.query("select t.*, p.name as person_name, p.document as person_document, pr.name as proprietary_name, tt.name as title_type_name, f.name as empresa_name, h.description as harvest_name, u.name as created_by_name from erp.financial_titles t left join erp.people p on p.id=t.person_id left join erp.people pr on pr.id=t.proprietary_id left join erp.title_types tt on tt.id=t.title_type_id join erp.empresas f on f.id=t.empresa_id left join erp.harvests h on h.id=t.harvest_id left join erp.users u on u.id=t.created_by where t.id=$1 and t.organization_id=$2 and t.direction=$3 and t.deleted_at is null" + escopo, params);
  if (!r.rows[0]) throw notFound("Título");
  const t = r.rows[0] as Record<string, unknown> & { status: TitleStatus; due_date: string; payment_type: string; group_id: string | null; empresa_name: string; number: string; code: string; person_name: string | null; amount: string; net_amount: string; note: string };
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
    app.get(`${base}/:id`, async (req) => runService(app, req, permOf(dir, "view"), (ctx) => getTitle(ctx, (req.params as { id: string }).id, dir)));
    app.post(base, async (req, reply) => reply.status(201).send(await runService(app, req, permOf(dir, "create"), async (ctx) => {
      const d = titleSchema.parse(req.body); await exigirEmpresaDeLancamento(ctx, d.empresa_id);
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
        if (d.auto_settle) for (const id of ids) await settle(ctx, id, dir, { settlement_date: d.auto_settle.date, settlement_kind: "bank_movement", bank_account_id: d.auto_settle.bank_account_id, amount: (await ctx.tx.query<{ b: string }>("select balance b from erp.financial_titles where id=$1", [id])).rows[0]!.b, movement_mode: "separate" });
        await audit(ctx.tx, ctx, "financial_titles", ids[0]!, "create", { count: ids.length });
        return { ids, id: ids[0] };
      })).result;
    })));
    app.put(`${base}/:id`, async (req) => runService(app, req, permOf(dir, "edit"), async (ctx) => {
      const { id } = req.params as { id: string }; const d = titleSchema.partial().parse(req.body);
      const cur = await ctx.tx.query<{ status: string; paid_amount: string; empresa_id: string; emission_date: string; version: number }>("select status, paid_amount, empresa_id, emission_date, version from erp.financial_titles where id=$1 and organization_id=$2 and direction=$3 and deleted_at is null for update", [id, ctx.orgId, dir]);
      if (!cur.rows[0]) throw notFound("Título"); await exigirEmpresaVisivel(ctx, cur.rows[0].empresa_id, "Título"); if (cur.rows[0].status === "cancelled") throw err("ALREADY_CANCELLED", "Título cancelado");
      if (D(cur.rows[0].paid_amount).gt(0) && (d.amount !== undefined || d.discount !== undefined)) throw err("CONFLICT", "Título com baixa: valor não pode ser alterado (cancele a baixa)");
      await assertPeriodOpen(ctx.tx, ctx.orgId, cur.rows[0].empresa_id, cur.rows[0].emission_date);
      await ctx.tx.query("update erp.financial_titles set number=coalesce($3,number), title_type_id=coalesce($4,title_type_id), proprietary_id=coalesce($5,proprietary_id), person_id=coalesce($6,person_id), classification=coalesce($7,classification), document_type=coalesce($8,document_type), is_deductible=coalesce($9,is_deductible), is_tax=coalesce($10,is_tax), amount=coalesce($11,amount), discount=coalesce($12,discount), emission_date=coalesce($13,emission_date), due_date=coalesce($14,due_date), note=coalesce($15,note), harvest_id=coalesce($16,harvest_id), appropriation=coalesce($17,appropriation), appropriation_type=coalesce($18,appropriation_type), version=version+1 where id=$1 and organization_id=$2",
        [id, ctx.orgId, d.number ?? null, d.title_type_id ?? null, d.proprietary_id ?? null, d.person_id ?? null, d.classification ?? null, d.document_type ?? null, d.is_deductible ?? null, d.is_tax ?? null, d.amount ?? null, d.discount ?? null, d.emission_date ?? null, d.due_date ?? null, d.note ?? null, d.harvest_id ?? null, d.appropriation ?? null, d.appropriation_type ?? null]);
      if (d.apportionment) {
        const t = await ctx.tx.query<{ net: string }>("select amount - discount as net from erp.financial_titles where id=$1", [id]);
        const { normalizeApportionment } = await import("@agro/domain");
        await exigirRateioAnalitico(ctx, d.apportionment.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, chartAccountId: a.chart_account_id })));
        const lines = normalizeApportionment(t.rows[0]!.net, d.apportionment.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, chartAccountId: a.chart_account_id ?? null, harvestId: a.harvest_id ?? null, areaId: a.area_id ?? null, percentage: a.percentage, amount: a.amount })));
        await ctx.tx.query("delete from erp.title_apportionments where title_id=$1", [id]);
        for (const l of lines) await ctx.tx.query("insert into erp.title_apportionments(title_id,financial_category_id,chart_account_id,cost_center_id,area_id,harvest_id,percentage,amount) values ($1,$2,$3,$4,$5,$6,$7,$8)", [id, l.financialCategoryId, l.chartAccountId, l.costCenterId, l.areaId, l.harvestId, l.percentage, l.amount]);
      }
      await ctx.tx.query("select erp.refresh_title_status($1)", [id]);
      await audit(ctx.tx, ctx, "financial_titles", id, "update");
      return getTitle(ctx, id, dir);
    }));
    app.post(`${base}/:id/cancel`, async (req) => runService(app, req, permOf(dir, "delete"), async (ctx) => {
      const { id } = req.params as { id: string };
      const cur = await ctx.tx.query<{ status: string; paid_amount: string; empresa_id: string; emission_date: string }>("select status, paid_amount, empresa_id, emission_date from erp.financial_titles where id=$1 and organization_id=$2 and direction=$3 for update", [id, ctx.orgId, dir]);
      if (!cur.rows[0]) throw notFound("Título"); await exigirEmpresaVisivel(ctx, cur.rows[0].empresa_id, "Título"); if (cur.rows[0].status === "cancelled") throw err("ALREADY_CANCELLED", "Já cancelado"); if (D(cur.rows[0].paid_amount).gt(0)) throw err("CONFLICT", "Título com baixa: cancele a baixa antes");
      await assertPeriodOpen(ctx.tx, ctx.orgId, cur.rows[0].empresa_id, cur.rows[0].emission_date);
      await ctx.tx.query("update erp.financial_titles set status='cancelled', version=version+1 where id=$1", [id]);
      await audit(ctx.tx, ctx, "financial_titles", id, "cancel");
      return { id, status: "cancelled" };
    }));
    app.post(`${base}/cancel-batch`, async (req) => runService(app, req, permOf(dir, "delete"), async (ctx) => { const d = z.object({ ids: z.array(uuid).min(1) }).parse(req.body); let n = 0; for (const id of d.ids) { const bp: unknown[] = [id, ctx.orgId, dir]; const r = await ctx.tx.query("update erp.financial_titles set status='cancelled', version=version+1 where id=$1 and organization_id=$2 and direction=$3 and status<>'cancelled' and paid_amount=0" + empresaScopeSql(ctx, "empresa_id", bp), bp); n += r.rowCount ?? 0; } return { cancelled: n, skipped: d.ids.length - n }; }));
    app.post(`${base}/:id/duplicate`, async (req, reply) => reply.status(201).send(await runService(app, req, permOf(dir, "duplicate"), async (ctx) => {
      const { id } = req.params as { id: string }; const t = await getTitle(ctx, id, dir) as Record<string, unknown> & { apportionments: { financial_category_id: string; cost_center_id: string; chart_account_id: string | null; harvest_id: string | null; area_id: string | null; percentage: string }[] };
      const c = await createTitles(ctx, { empresaId: t.empresa_id as string, direction: dir, number: `${t.number}-C`, titleTypeId: t.title_type_id as string | null, personId: t.person_id as string | null, proprietaryId: t.proprietary_id as string | null, classification: t.classification as "unclassified", documentType: t.document_type as string | null, isDeductible: t.is_deductible as boolean, isTax: t.is_tax as boolean, amount: t.amount as string, discount: t.discount as string, emissionDate: todayISO(), dueDate: t.due_date as string, note: t.note as string, harvestId: t.harvest_id as string | null, apportionment: t.apportionments.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, chartAccountId: a.chart_account_id, harvestId: a.harvest_id, areaId: a.area_id, percentage: a.percentage })) });
      return { id: c.ids[0] };
    })));
    // Baixa (individual ou em lote: "Baixar Contas")
    const settleSchema = z.object({ settlement_date: date, settlement_kind: z.enum(["bank_movement", "cross_settlement", "advance_compensation"]).default("bank_movement"), bank_account_id: uuid.optional().nullable(), cross_title_id: uuid.optional().nullable(), amount: dec, discount: dec.default("0"), penalty: dec.default("0"), interest: dec.default("0"), increase: dec.default("0"), foreign_amount: dec.optional().nullable(), ptax_rate: dec.optional().nullable(), exchange_adjustment: dec.default("0"), note: z.string().optional().nullable(), movement_mode: z.enum(["separate", "single"]).default("separate") });
    app.post(`${base}/:id/settle`, async (req, reply) => reply.status(201).send(await runService(app, req, permOf(dir, "settle"), async (ctx) => { const { id } = req.params as { id: string }; const d = settleSchema.parse(req.body); return (await idempotent(ctx.tx, ctx.orgId, idem(req), { id, ...d }, () => settle(ctx, id, dir, d))).result; })));
    app.post(`${base}/settle-batch`, async (req, reply) => reply.status(201).send(await runService(app, req, permOf(dir, "settle"), async (ctx) => {
      const d = z.object({ ids: z.array(uuid).min(1), settlement_date: date, bank_account_id: uuid, movement_mode: z.enum(["separate", "single"]).default("separate"), note: z.string().optional().nullable() }).parse(req.body);
      return (await idempotent(ctx.tx, ctx.orgId, idem(req), d, async () => {
        const results = []; let sharedMovement: string | null = null; let total = D(0);
        for (const id of d.ids) { const bal = (await ctx.tx.query<{ balance: string; direction: string; empresa_id: string; number: string }>("select balance, direction, empresa_id, number from erp.financial_titles where id=$1 and organization_id=$2 and direction=$3 and status in ('open','partially_paid') for update", [id, ctx.orgId, dir])).rows[0]; if (!bal || !empresaPermitida(ctx, bal.empresa_id)) continue; total = total.plus(bal.balance); }
        if (d.movement_mode === "single" && total.gt(0)) sharedMovement = await createBankMovement(ctx, { empresaId: ctx.empresaId, bankAccountId: d.bank_account_id, date: d.settlement_date, type: dir === "payable" ? "out" : "in", amount: money(total), note: d.note ?? `Baixa em lote de ${d.ids.length} títulos`, sourceType: "title_settlement_batch", sourceId: d.ids[0] });
        for (const id of d.ids) { const bal = (await ctx.tx.query<{ balance: string }>("select balance from erp.financial_titles where id=$1 and organization_id=$2 and direction=$3 and status in ('open','partially_paid')", [id, ctx.orgId, dir])).rows[0]; if (!bal) continue; results.push(await settle(ctx, id, dir, { settlement_date: d.settlement_date, settlement_kind: "bank_movement", bank_account_id: d.bank_account_id, amount: bal.balance, note: d.note ?? null, movement_mode: d.movement_mode, shared_movement_id: sharedMovement })); }
        return { settled: results.length, total: money(total), items: results };
      })).result;
    })));
    app.post(`${base}/:id/settlements/:sid/cancel`, async (req) => runService(app, req, permOf(dir, "cancel_settlement"), async (ctx) => {
      const { id, sid } = req.params as { id: string; sid: string }; const d = z.object({ reason: z.string().min(1) }).parse(req.body);
      // FRONTEIRA DE VARIANTE: o TÍTULO é provado ANTES de olhar a baixa. Descobrir a direction depois
      // seria descobrir depois de já ter lido a baixa — e a ordem antiga chegava a `for update` numa linha
      // que esta rota não tinha o direito de tocar. Variante errada devolve a MESMA 404 de baixa
      // inexistente: não revela que o título existe na variante vizinha.
      // A MENSAGEM TAMBÉM É SUPERFÍCIE DE RECUSA. Todas as recusas desta rota dizem "Baixa não encontrado":
      // título inexistente, de outro tenant, excluído, de variante errada E fora do escopo de empresa. Com
      // rótulos diferentes ("Baixa" aqui, "Título" logo abaixo) o 404 de FORA DE ESCOPO se distinguiria do
      // 404 de INEXISTENTE — e distinguir é confirmar que aquele UUID é um título desta variante neste
      // tenant. Mesmo status, mesma mensagem, ou a 404 vira oráculo de existência.
      const t = await ctx.tx.query<{ empresa_id: string }>("select empresa_id from erp.financial_titles where id=$1 and organization_id=$2 and direction=$3 and deleted_at is null", [id, ctx.orgId, dir]);
      if (!t.rows[0]) throw notFound("Baixa");
      await exigirEmpresaVisivel(ctx, t.rows[0].empresa_id, "Baixa");
      const s = await ctx.tx.query<{ status: string; bank_movement_id: string | null; settlement_date: string; cross_title_id: string | null; amount: string }>("select status, bank_movement_id, settlement_date, cross_title_id, amount from erp.title_settlements where id=$1 and title_id=$2 and organization_id=$3 for update", [sid, id, ctx.orgId]);
      if (!s.rows[0]) throw notFound("Baixa"); if (s.rows[0].status === "cancelled") throw err("ALREADY_CANCELLED", "Baixa já cancelada");
      await assertPeriodOpen(ctx.tx, ctx.orgId, t.rows[0].empresa_id, s.rows[0].settlement_date);
      /**
       * CANCELAR UMA BAIXA CRUZADA É DUAS MUTAÇÕES, E A AUTORIZAÇÃO COMPOSTA FECHA ANTES DA PRIMEIRA.
       *
       * Quando a baixa tem `cross_title_id`, este cancelamento também cancela a linha ESPELHO, que vive
       * no título da variante contrária. Só `{variant}.cancel_settlement` da rota não autoriza isso.
       * Tudo é resolvido ANTES do primeiro UPDATE: deixar a mutação principal acontecer e só depois
       * descobrir que falta permissão do outro lado é descobrir tarde demais — mesmo com rollback, o
       * CÓDIGO DE ERRO que sai já teria contado o que não devia.
       *
       * IDENTIDADE DO ESPELHO — LOCALIZAR NÃO É PROVAR, ENTÃO A CARDINALIDADE É QUE DECIDE.
       *
       * `erp.title_settlements` NÃO tem constraint que torne o espelho único (0004_financial.sql: só
       * índices em title_id e em (organization_id, settlement_date)). Não existe, nesta versão, nenhuma
       * garantia de BANCO ligando as duas linhas de uma baixa cruzada. Logo a garantia tem de ser da
       * APLICAÇÃO — e uma garantia de aplicação que aceita "achei alguma coisa" não é garantia.
       *
       * Os discriminadores abaixo LOCALIZAM o candidato; quem decide é `rowCount === 1`. O corte anterior
       * fazia `rows[0]?.id ?? null` e falhava ABERTO nas duas pontas: com ZERO candidatos seguia adiante,
       * cancelava o principal e deixava o par pela metade, sem erro nenhum; com MAIS DE UM escolhia
       * arbitrariamente o primeiro e chamava isso de identidade. Zero ou vários agora abortam ANTES do
       * primeiro UPDATE — nada do principal, nada do espelho, nada do movimento bancário, nada de trilha.
       *
       * QUAIS discriminadores, e por que só estes: são os campos que as DUAS linhas recebem do MESMO
       * valor no momento da criação (ver `settle`) — `organization_id`, o par cruzado de
       * (`title_id`, `cross_title_id`) invertido, `settlement_kind`, `settlement_date`, `amount`,
       * `created_by` e `created_at` (= `now()`, o início da TRANSAÇÃO que gravou as duas). Ficam de
       * fora, de propósito, os campos que comprovadamente DIVERGEM entre os lados: `net_amount` (o
       * principal soma desconto/juros/multa, o espelho recebe o bruto), `note` (o espelho tem texto
       * próprio quando o pedido não traz nota) e os acréscimos, que no espelho ficam em zero. Filtrar
       * por um campo que diverge transformaria toda baixa cruzada com desconto em "zero candidatos".
       *
       * A comparação fica DENTRO do SQL. Trafegar `created_at` por JavaScript perderia precisão:
       * `timestamptz` tem microssegundos e o `Date` do driver só tem milissegundos, então o valor
       * voltaria truncado e nunca casaria — o primeiro corte deste hotfix fazia esse round-trip e
       * silenciosamente não achava espelho nenhum. O mesmo vale para `amount`: comparar `numeric` no
       * banco evita qualquer normalização de string no meio do caminho.
       */
      let espelhoId: string | null = null;
      if (s.rows[0].cross_title_id) {
        const contraria = dir === "payable" ? "receivable" : "payable";
        requirePermission(ctx, permOf(contraria, "cancel_settlement"));
        const ct = await ctx.tx.query<{ empresa_id: string }>("select empresa_id from erp.financial_titles where id=$1 and organization_id=$2 and direction=$3 and deleted_at is null", [s.rows[0].cross_title_id, ctx.orgId, contraria]);
        if (!ct.rows[0]) throw notFound("Baixa");
        await exigirEmpresaVisivel(ctx, ct.rows[0].empresa_id, "Baixa");
        await assertPeriodOpen(ctx.tx, ctx.orgId, ct.rows[0].empresa_id, s.rows[0].settlement_date);
        const e = await ctx.tx.query<{ id: string }>(
          "select e.id from erp.title_settlements e"
          + " where e.organization_id=$1 and e.title_id=$2 and e.cross_title_id=$3 and e.status='confirmed' and e.id<>$4"
          + " and exists (select 1 from erp.title_settlements p where p.id=$4 and p.organization_id=$1"
          + " and e.created_at=p.created_at and e.settlement_kind=p.settlement_kind"
          + " and e.settlement_date=p.settlement_date and e.amount=p.amount"
          + " and e.created_by is not distinct from p.created_by)"
          + " for update",
          [ctx.orgId, s.rows[0].cross_title_id, id, sid]);
        // Zero e "mais de um" são o MESMO defeito visto de dois lados: em nenhum dos dois o par está
        // provado, e cancelar sem o par provado é escrever um estado que ninguém consegue reconstituir.
        if (e.rowCount !== 1) throw err("CONFLICT", "Par da baixa cruzada não identificado com exatidão: cancelamento bloqueado");
        espelhoId = e.rows[0]!.id;
      }
      await ctx.tx.query("update erp.title_settlements set status='cancelled', cancelled_at=now(), cancelled_by=$2, cancel_reason=$3 where id=$1", [sid, ctx.user.id, d.reason]);
      if (s.rows[0].bank_movement_id) { const shared = await ctx.tx.query<{ n: string }>("select count(*) n from erp.title_settlements where bank_movement_id=$1 and status='confirmed'", [s.rows[0].bank_movement_id]); if (Number(shared.rows[0]!.n) === 0) await ctx.tx.query("update erp.bank_movements set status='cancelled' where id=$1", [s.rows[0].bank_movement_id]); else throw err("CONFLICT", "Movimento bancário compartilhado com outras baixas: cancele todas ou lance ajuste"); }
      if (espelhoId) {
        const r = await ctx.tx.query("update erp.title_settlements set status='cancelled', cancelled_at=now(), cancelled_by=$2, cancel_reason=$3 where id=$1", [espelhoId, ctx.user.id, d.reason]);
        if (r.rowCount !== 1) throw err("CONFLICT", "Baixa espelho não pôde ser cancelada");
        await audit(ctx.tx, ctx, "title_settlements", espelhoId, "cancel", { ...d, title: s.rows[0].cross_title_id, cruzada_com: id, lado: "par" });
      }
      /**
       * SIMETRIA DA TRILHA — E POR QUE O CANCELAMENTO NÃO USA OS RÓTULOS DA CRIAÇÃO.
       *
       * O espelho carregava `cruzada_com` e o principal não, então reconstruir o par a partir de
       * `audit_logs` só funcionava a partir de UM dos lados; pelo outro exigia voltar à linha de
       * `title_settlements`, que pode ter mudado de status desde então. Agora os DOIS se nomeiam, e
       * `title` + `cruzada_com` bastam para reconstituir o par em qualquer caminho.
       *
       * `lado` no cancelamento vale "alvo" e "par", NÃO "principal" e "espelho", e a diferença é de
       * verdade, não de gosto. A linha espelho também tem `cross_title_id`, então ela é cancelável pela
       * PRÓPRIA rota: nesse caminho quem chega como alvo é o espelho, e o principal original é que vem
       * como o outro lado. Nada na linha distingue quem foi principal na criação — o espelho não guarda
       * conta bancária, movimento, acréscimos nem nada que sirva de marca, e as duas nascem no mesmo
       * `created_at`. Carimbar "principal" no alvo faria o campo dizer, na metade dos caminhos, o
       * contrário do que a criação registrou: o MESMO id apareceria como `lado: "principal"` no `create`
       * e `lado: "espelho"` no `cancel`. Papel de criação é irrecuperável aqui; papel NESTA operação é
       * observável. O campo diz o que é observável.
       */
      await audit(ctx.tx, ctx, "title_settlements", sid, "cancel", espelhoId ? { ...d, title: id, cruzada_com: s.rows[0].cross_title_id, lado: "alvo" } : d);
      return getTitle(ctx, id, dir);
    }));
    app.get(`${base}/:id/receipt`, async (req) => runService(app, req, permOf(dir, "receipt"), async (ctx) => { const t = await getTitle(ctx, (req.params as { id: string }).id, dir); return { title: t, receipt_text: `RECIBO — ${t.empresa_name}\nTítulo ${t.number} (${t.code})\n${dir === "payable" ? "Pago a" : "Recebido de"}: ${t.person_name ?? "-"}\nValor: R$ ${t.amount} (líquido R$ ${t.net_amount})\nBaixas: ${(t.settlements as { settlement_date: string; net_amount: string }[]).filter(Boolean).map((s) => `${s.settlement_date}: R$ ${s.net_amount}`).join("; ") || "nenhuma"}\nHistórico: ${t.note}` }; }));
  }

  async function settle(ctx: ServiceCtx, titleId: string, expectedDirection: "payable" | "receivable", d: { settlement_date: string; settlement_kind: "bank_movement" | "cross_settlement" | "advance_compensation"; bank_account_id?: string | null; cross_title_id?: string | null; amount: string; discount?: string; penalty?: string; interest?: string; increase?: string; foreign_amount?: string | null; ptax_rate?: string | null; exchange_adjustment?: string; note?: string | null; movement_mode: "separate" | "single"; shared_movement_id?: string | null }) {
    const t = await ctx.tx.query<{ direction: "payable" | "receivable"; balance: string; status: string; empresa_id: string; number: string; person_id: string | null; proprietary_id: string | null; harvest_id: string | null; is_deductible: boolean }>("select direction, balance, status, empresa_id, number, person_id, proprietary_id, harvest_id, is_deductible from erp.financial_titles where id=$1 and organization_id=$2 and direction=$3 and deleted_at is null for update", [titleId, ctx.orgId, expectedDirection]);
    const title = t.rows[0]; if (!title) throw notFound("Título"); await exigirEmpresaVisivel(ctx, title.empresa_id, "Título"); if (title.status === "cancelled") throw err("ALREADY_CANCELLED", "Título cancelado"); if (title.status === "paid") throw err("ALREADY_CONFIRMED", "Título já baixado");
    await assertPeriodOpen(ctx.tx, ctx.orgId, title.empresa_id, d.settlement_date);
    const input = { amount: d.amount, discount: d.discount ?? "0", penalty: d.penalty ?? "0", interest: d.interest ?? "0", increase: d.increase ?? "0", exchangeAdjustment: d.exchange_adjustment ?? "0" };
    assertSettlementWithinBalance(title.balance, input);
    const net = settlementNet(input);
    let movementId: string | null = d.shared_movement_id ?? null;
    // Preenchido só na operação cruzada: é o que dá ao lado PRINCIPAL a mesma nomeação do par que o
    // espelho já tinha. Nulo aqui significa baixa comum, e baixa comum não inventa metadata de par.
    let ladoPrincipal: { cruzada_com: string; lado: "principal" } | null = null;
    if (d.settlement_kind === "bank_movement") {
      if (!d.bank_account_id) throw validation("Conta bancária obrigatória");
      if (!movementId) {
        // o movimento COPIA o rateio gravado no título e não o reconfere (`rateioJaGravado`, decisão 256): natureza ou
        // centro inativado/excluído depois da emissão não pode deixar o título em aberto sem baixa
        const lines = await ctx.tx.query<{ financial_category_id: string; cost_center_id: string; chart_account_id: string | null; harvest_id: string | null; percentage: string }>("select financial_category_id, cost_center_id, chart_account_id, harvest_id, percentage from erp.title_apportionments where title_id=$1", [titleId]);
        movementId = await createBankMovement(ctx, { empresaId: title.empresa_id, bankAccountId: d.bank_account_id, date: d.settlement_date, type: title.direction === "payable" ? "out" : "in", amount: net, interest: "0", document: title.number, note: d.note ?? `Baixa do título ${title.number}`, proprietaryId: title.proprietary_id, personId: title.person_id, harvestId: title.harvest_id, isDeductible: title.is_deductible, sourceType: "title_settlements", sourceId: titleId, apportionment: lines.rows.map((l) => ({ financialCategoryId: l.financial_category_id, costCenterId: l.cost_center_id, chartAccountId: l.chart_account_id, harvestId: l.harvest_id, percentage: l.percentage })), rateioJaGravado: true });
      }
    } else if (d.settlement_kind === "cross_settlement" || d.settlement_kind === "advance_compensation") {
      if (!d.cross_title_id) throw validation("Título contrário obrigatório para baixa cruzada");
      /**
       * AUTORIZAÇÃO COMPOSTA — A OPERAÇÃO MUTA DOIS TÍTULOS, ENTÃO EXIGE AS DUAS CAPACIDADES.
       *
       * A PR #42 fechou a fronteira da ROTA (capacidade da rota ∧ direction do registro). Mas a baixa
       * cruzada é, por projeto, uma operação sobre um PAR de variantes opostas: ela grava uma linha de
       * baixa no título contrário. Exigir só `payables.settle` para gravar num recebível seria a
       * capacidade de uma família autorizando escrita na outra — o mesmo OR que a decisão 184 proibiu,
       * agora por dentro. Escopo de empresa e RLS NÃO substituem capacidade: respondem a outra pergunta.
       *
       * A conferência vem ANTES de tocar no registro contrário de propósito. Assim o 403 fala apenas do
       * CHAMADOR — não revela que aquele UUID existe, nem de que variante ele é. Depois disso, tudo que
       * é do REGISTRO (inexistente, outro tenant, fora de escopo, excluído, direction errada) cai na
       * MESMA 404, como no resto da entidade.
       */
      const contraria = expectedDirection === "payable" ? "receivable" : "payable";
      requirePermission(ctx, permOf(contraria, "settle"));
      const ct = await ctx.tx.query<{ direction: string; balance: string; status: string; empresa_id: string }>("select direction, balance, status, empresa_id from erp.financial_titles where id=$1 and organization_id=$2 and direction=$3 and deleted_at is null for update", [d.cross_title_id, ctx.orgId, contraria]);
      if (!ct.rows[0]) throw notFound("Título");
      await exigirEmpresaVisivel(ctx, ct.rows[0].empresa_id, "Título");
      /**
       * ELEGIBILIDADE DE ESTADO DO CONTRÁRIO — A MESMA QUE O PRINCIPAL JÁ TINHA.
       *
       * O principal recusa `cancelled` e `paid` logo acima; o contrário carregava `status` e NÃO o usava.
       * Isso não é assimetria estética, é inconsistência de ledger, e o schema explica por quê:
       *
       *   - `balance` é COLUNA GERADA: `amount - discount - paid_amount` (0004_financial.sql). Cancelar um
       *     título sem baixa não zera nada — a porta oficial de cancelamento exige `paid_amount = 0` —,
       *     então um título CANCELADO continua com `balance > 0` e passa direto pela conferência de saldo.
       *   - `erp.refresh_title_status` começa com `if v_status = 'cancelled' then return`. O gatilho
       *     DELIBERADAMENTE não recalcula título cancelado.
       *
       * Juntando os dois: a linha de baixa entraria `confirmed`, o gatilho não mexeria em
       * `paid_amount`/`status`, e sobraria um settlement confirmado pendurado num título cancelado, com
       * o `balance` gerado sem refletir a baixa. Ledger inconsistente, escrito pela própria operação que
       * esta fatia certifica.
       *
       * Só `open` e `partially_paid` seguem — `partially_paid` continua elegível de propósito: barrar
       * tudo que não fosse `open` seria correção excessiva e quebraria baixa cruzada parcial legítima.
       * Estado de negócio de um registro que o chamador JÁ está autorizado a operar não se disfarça de
       * 404: a uniformização da decisão 184 é para inexistência, tenant, escopo, direction e exclusão.
       */
      if (ct.rows[0].status === "cancelled") throw err("ALREADY_CANCELLED", "Título contrário cancelado");
      if (ct.rows[0].status === "paid") throw err("ALREADY_CONFIRMED", "Título contrário já baixado");
      /**
       * PERÍODO DOS DOIS LADOS. `assertPeriodOpen` já roda para a empresa do título PRINCIPAL. O título
       * contrário pode ser de OUTRA empresa — não existe no contrato nenhuma regra que exija mesma
       * empresa numa baixa cruzada, e inventar uma aqui seria mudar negócio dentro de um hotfix de
       * autorização. Preservada a possibilidade, a proteção tem de valer para quem for gravado: fechar
       * o período de uma empresa precisa barrar a gravação nela, venha ela por qual porta vier.
       */
      await assertPeriodOpen(ctx.tx, ctx.orgId, ct.rows[0].empresa_id, d.settlement_date);
      if (D(ct.rows[0].balance).lt(d.amount)) throw err("PAYMENT_EXCEEDS_BALANCE", "Saldo do título contrário insuficiente");
      // A linha ESPELHO recebe trilha própria: são duas linhas de `title_settlements`, e um auditor
      // precisa reconstruir os DOIS lados. Sem `returning id` só o lado principal tinha rastro.
      const espelho = await ctx.tx.query<{ id: string }>("insert into erp.title_settlements(organization_id,title_id,settlement_date,settlement_kind,cross_title_id,amount,net_amount,note,created_by) values ($1,$2,$3,$4,$5,$6,$6,$7,$8) returning id", [ctx.orgId, d.cross_title_id, d.settlement_date, d.settlement_kind, titleId, money(d.amount), d.note ?? `Baixa cruzada com ${title.number}`, ctx.user.id]);
      await audit(ctx.tx, ctx, "title_settlements", espelho.rows[0]!.id, "create", { title: d.cross_title_id, cruzada_com: titleId, lado: "espelho", net: money(d.amount) });
      ladoPrincipal = { cruzada_com: d.cross_title_id, lado: "principal" };
    }
    const s = await ctx.tx.query<{ id: string }>("insert into erp.title_settlements(organization_id,title_id,settlement_date,settlement_kind,bank_account_id,bank_movement_id,cross_title_id,amount,discount,penalty,interest,increase,foreign_amount,ptax_rate,exchange_adjustment,net_amount,note,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id",
      [ctx.orgId, titleId, d.settlement_date, d.settlement_kind, d.bank_account_id ?? null, movementId, d.cross_title_id ?? null, money(d.amount), money(input.discount), money(input.penalty), money(input.interest), money(input.increase), d.foreign_amount ?? null, d.ptax_rate ?? null, money(input.exchangeAdjustment), net, d.note ?? null, ctx.user.id]);
    await audit(ctx.tx, ctx, "title_settlements", s.rows[0]!.id, "create", { title: titleId, net, ...(ladoPrincipal ?? {}) });
    const after = await ctx.tx.query<{ status: string; balance: string }>("select status, balance from erp.financial_titles where id=$1", [titleId]);
    return { settlement_id: s.rows[0]!.id, title_id: titleId, net_amount: net, status: after.rows[0]!.status, balance: after.rows[0]!.balance, bank_movement_id: movementId };
  }

  // ---------- Movimentos bancários ----------
  const bmSchema = z.object({ empresa_id: uuid.optional().nullable(), bank_account_id: uuid, movement_date: date, type: z.enum(["in", "out"]), category_type: z.enum(["in", "out", "internal_transfer", "financing", "check_return"]).default("in"), destination_account_id: uuid.optional().nullable(), amount: dec, interest: dec.default("0"), document: z.string().optional().nullable(), generates_obligation: z.boolean().default(false), is_deductible: z.boolean().default(false), note: z.string().optional().nullable(), proprietary_id: uuid.optional().nullable(), person_id: uuid.optional().nullable(), harvest_id: uuid.optional().nullable(), apportionment: apportionmentSchema.optional() });
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
    if (f.empresa_id) add("m.empresa_id=?", f.empresa_id);
    where.push(...empresaScope(ctx, "m", params, { nullable: true, ignoreSelected: Boolean(f.empresa_id) }));
    const w = where.join(" and ");
    const tot = await ctx.tx.query<{ n: string; in_amount: string; out_amount: string; interest: string }>(`select count(*) n, coalesce(sum(case when m.type='in' then m.amount end),0) in_amount, coalesce(sum(case when m.type='out' then m.amount end),0) out_amount, coalesce(sum(m.interest),0) interest from erp.bank_movements m where ${w}`, params);
    const r = await ctx.tx.query(`select m.*, ba.code as account_code, ba.agency, ba.account_number, ba.description as bank_account_name, p.name as person_name, pr.name as proprietary_name, u.name as created_by_name, (select count(*) from erp.attachments a where a.entity='bank_movement' and a.entity_id=m.id)::int as attachment_count from erp.bank_movements m join erp.bank_accounts ba on ba.id=m.bank_account_id left join erp.people p on p.id=m.person_id left join erp.people pr on pr.id=m.proprietary_id left join erp.users u on u.id=m.created_by where ${w} order by m.movement_date desc, m.created_at desc limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`, params);
    return paginaComIdGlobal(ctx, "bank_movements", { items: r.rows as Record<string, unknown>[], total: Number(tot.rows[0]!.n), page: q.page, pageSize: q.pageSize, totals: { in: tot.rows[0]!.in_amount, out: tot.rows[0]!.out_amount, interest: tot.rows[0]!.interest, net: money(D(tot.rows[0]!.in_amount).minus(tot.rows[0]!.out_amount)) } });
  }));
  app.get("/financial/bank-movements/:id", async (req) => runService(app, req, "bank_movements.view", async (ctx) => {
    const { id } = req.params as { id: string };
    const r = await ctx.tx.query("select m.*, ba.description as bank_account_name, ba.bank_code, ba.agency, ba.account_number, f.name as empresa_name, p.name as person_name, p.document as person_document, pr.name as proprietary_name, da.description as destination_account_name from erp.bank_movements m join erp.bank_accounts ba on ba.id=m.bank_account_id left join erp.empresas f on f.id=m.empresa_id left join erp.people p on p.id=m.person_id left join erp.people pr on pr.id=m.proprietary_id left join erp.bank_accounts da on da.id=m.destination_account_id where m.id=$1 and m.organization_id=$2 and m.deleted_at is null" + scopedById(ctx, "m", id, { nullable: true }).sql, scopedById(ctx, "m", id, { nullable: true }).params); if (!r.rows[0]) throw notFound("Movimento");
    const app_ = await ctx.tx.query("select a.*, fc.name as category_name, fc.code as category_code, cc.name as cost_center_name, ca.description as chart_account_name from erp.bank_movement_apportionments a join erp.financial_categories fc on fc.id=a.financial_category_id join erp.cost_centers cc on cc.id=a.cost_center_id left join erp.chart_accounts ca on ca.id=a.chart_account_id where a.movement_id=$1", [id]);
    const settlements = await ctx.tx.query("select s.id, s.title_id, t.number, t.code, s.net_amount from erp.title_settlements s join erp.financial_titles t on t.id=s.title_id where s.bank_movement_id=$1 and s.status='confirmed'", [id]);
    return { ...r.rows[0], apportionments: app_.rows, settlements: settlements.rows };
  }));
  app.post("/financial/bank-movements", async (req, reply) => reply.status(201).send(await runService(app, req, "bank_movements.create", async (ctx) => {
    const d = bmSchema.parse(req.body); await exigirEmpresaDeLancamento(ctx, d.empresa_id);
    if (d.category_type === "internal_transfer" && !d.destination_account_id) throw validation("Conta destino obrigatória em transferência interna");
    if (d.category_type !== "internal_transfer" && !d.apportionment?.length) throw validation("Rateio (natureza/centro de resultado) obrigatório");
    return (await idempotent(ctx.tx, ctx.orgId, idem(req), d, async () => {
      const id = await createBankMovement(ctx, { empresaId: d.empresa_id ?? ctx.empresaId, bankAccountId: d.bank_account_id, date: d.movement_date, type: d.type, categoryType: d.category_type, destinationAccountId: d.destination_account_id ?? null, amount: d.amount, interest: d.interest, document: d.document, note: d.note, proprietaryId: d.proprietary_id, personId: d.person_id, harvestId: d.harvest_id, isDeductible: d.is_deductible, generatesObligation: d.generates_obligation, sourceType: "manual", sourceId: undefined, apportionment: d.apportionment?.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, chartAccountId: a.chart_account_id ?? null, harvestId: a.harvest_id ?? null, percentage: a.percentage, amount: a.amount })) });
      // "Gera obrigação": cria título correspondente já baixado por este movimento (ex.: saída sem título prévio)
      if (d.generates_obligation && d.person_id && d.apportionment?.length) {
        const c = await createTitles(ctx, { empresaId: d.empresa_id ?? ctx.empresaId ?? (await ctx.tx.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code limit 1", [ctx.orgId])).rows[0]!.id, direction: d.type === "out" ? "payable" : "receivable", number: d.document ?? `MOV-${id.slice(0, 8)}`, personId: d.person_id, amount: money(d.amount), emissionDate: d.movement_date, dueDate: d.movement_date, note: d.note ?? "Gerado pelo movimento bancário", isDeductible: d.is_deductible, apportionment: d.apportionment.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, percentage: a.percentage, amount: a.amount })), sourceType: "bank_movements", sourceId: id });
        await ctx.tx.query("insert into erp.title_settlements(organization_id,title_id,settlement_date,settlement_kind,bank_account_id,bank_movement_id,amount,net_amount,note,created_by) values ($1,$2,$3,'bank_movement',$4,$5,$6,$6,'Baixa automática pelo movimento',$7)", [ctx.orgId, c.ids[0], d.movement_date, d.bank_account_id, id, money(d.amount), ctx.user.id]);
      }
      await audit(ctx.tx, ctx, "bank_movements", id, "create");
      return { id };
    })).result;
  })));
  app.put("/financial/bank-movements/:id", async (req) => runService(app, req, "bank_movements.edit", async (ctx) => {
    const { id } = req.params as { id: string }; const d = bmSchema.partial().parse(req.body);
    const cur = await ctx.tx.query<{ source_type: string | null; empresa_id: string | null; movement_date: string; status: string }>("select source_type, empresa_id, movement_date, status from erp.bank_movements where id=$1 and organization_id=$2 for update", [id, ctx.orgId]); if (!cur.rows[0]) throw notFound("Movimento"); await exigirEmpresaVisivel(ctx, cur.rows[0].empresa_id, "Movimento");
    if (cur.rows[0].status === "cancelled") throw err("ALREADY_CANCELLED", "Movimento cancelado");
    if (cur.rows[0].source_type && cur.rows[0].source_type !== "manual") throw err("CONFLICT", "Movimento gerado por outro documento: altere pela origem");
    await assertPeriodOpen(ctx.tx, ctx.orgId, cur.rows[0].empresa_id, cur.rows[0].movement_date);
    await ctx.tx.query("update erp.bank_movements set movement_date=coalesce($3,movement_date), amount=coalesce($4,amount), interest=coalesce($5,interest), document=coalesce($6,document), note=coalesce($7,note), is_deductible=coalesce($8,is_deductible), person_id=coalesce($9,person_id), proprietary_id=coalesce($10,proprietary_id), harvest_id=coalesce($11,harvest_id), updated_at=now() where id=$1 and organization_id=$2", [id, ctx.orgId, d.movement_date ?? null, d.amount ?? null, d.interest ?? null, d.document ?? null, d.note ?? null, d.is_deductible ?? null, d.person_id ?? null, d.proprietary_id ?? null, d.harvest_id ?? null]);
    if (d.apportionment) { await exigirRateioAnalitico(ctx, d.apportionment.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, chartAccountId: a.chart_account_id }))); const { normalizeApportionment } = await import("@agro/domain"); const amt = (await ctx.tx.query<{ amount: string }>("select amount from erp.bank_movements where id=$1", [id])).rows[0]!.amount; await ctx.tx.query("delete from erp.bank_movement_apportionments where movement_id=$1", [id]); for (const l of normalizeApportionment(amt, d.apportionment.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, chartAccountId: a.chart_account_id ?? null, harvestId: a.harvest_id ?? null, percentage: a.percentage, amount: a.amount })))) await ctx.tx.query("insert into erp.bank_movement_apportionments(movement_id,financial_category_id,chart_account_id,cost_center_id,harvest_id,percentage,amount) values ($1,$2,$3,$4,$5,$6,$7)", [id, l.financialCategoryId, l.chartAccountId, l.costCenterId, l.harvestId, l.percentage, l.amount]); }
    await audit(ctx.tx, ctx, "bank_movements", id, "update");
    return { id };
  }));
  app.post("/financial/bank-movements/:id/cancel", async (req) => runService(app, req, "bank_movements.delete", async (ctx) => {
    const { id } = req.params as { id: string };
    const cur = await ctx.tx.query<{ status: string; empresa_id: string | null; movement_date: string; transfer_pair_id: string | null }>("select status, empresa_id, movement_date, transfer_pair_id from erp.bank_movements where id=$1 and organization_id=$2 for update", [id, ctx.orgId]); if (!cur.rows[0]) throw notFound("Movimento"); await exigirEmpresaVisivel(ctx, cur.rows[0].empresa_id, "Movimento"); if (cur.rows[0].status === "cancelled") throw err("ALREADY_CANCELLED", "Já cancelado");
    const linked = await ctx.tx.query("select 1 from erp.title_settlements where bank_movement_id=$1 and status='confirmed' limit 1", [id]); if (linked.rowCount) throw err("CONFLICT", "Movimento vinculado a baixa de título: cancele a baixa");
    await assertPeriodOpen(ctx.tx, ctx.orgId, cur.rows[0].empresa_id, cur.rows[0].movement_date);
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
    // O saldo sai de `erp.movimentos_conta_organizacao`, não da view: a view respeita a RLS empresarial de
    // `erp.bank_movements` (corretamente, para leitura normal), e sob ela o `opening_balance` da ORGANIZAÇÃO
    // somaria só os movimentos das empresas do usuário — um saldo que não fecha com o extrato do banco.
    const r = await ctx.tx.query("select a.id, a.code, a.description, a.type, a.bank_code, a.agency, a.account_number, a.opening_balance, a.credit_limit, (a.opening_balance + coalesce(s.delta,0))::text as balance from erp.bank_accounts a left join (select bank_account_id, sum(case when type='in' then amount+interest else -(amount+interest) end) delta from erp.movimentos_conta_organizacao() group by 1) s on s.bank_account_id=a.id where a.organization_id=$1 and a.deleted_at is null and a.is_active order by a.code", [ctx.orgId]);
    return { items: r.rows, total_balance: money(r.rows.reduce((s, x) => s.plus((x as { balance: string }).balance), D(0))) };
  }));
  // Saldo inicial de conta (tela "Saldo Inicial"): movimento de abertura
  app.post("/financial/opening-movements", async (req, reply) => reply.status(201).send(await runService(app, req, "opening_movements.create", async (ctx) => {
    const d = z.object({ bank_account_id: uuid, date: date, amount: dec, proprietary_id: uuid.optional().nullable(), document: z.string().optional().nullable(), note: z.string().optional().nullable(), apportionment: apportionmentSchema.optional() }).parse(req.body);
    const exists = await ctx.tx.query("select 1 from erp.bank_movements where organization_id=$1 and bank_account_id=$2 and category_type='opening_balance' and status='confirmed'", [ctx.orgId, d.bank_account_id]); if (exists.rowCount) throw err("DUPLICATE_DOCUMENT", "Conta já possui saldo inicial lançado");
    const id = await createBankMovement(ctx, { empresaId: ctx.empresaId, bankAccountId: d.bank_account_id, date: d.date, type: "in", categoryType: "opening_balance", amount: d.amount, document: d.document, note: d.note ?? "Saldo inicial", proprietaryId: d.proprietary_id, sourceType: "opening_movement", apportionment: d.apportionment?.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, percentage: a.percentage, amount: a.amount })) });
    return { id };
  })));

  // ---------- Fluxo bancário (análise) ----------
  // Fluxo de caixa por CONTA: parte do `opening_balance` da conta (sem empresa) e acumula saldo — mesmo
  // contrato do saldo bancário: capacidade de organização + a permissão financeira por cima.
  app.get("/financial/cash-flow", async (req) => runService(app, req, "bank_accounts.view", async (ctx) => {
    requirePermission(ctx, "cash_flow.view");
    const q = z.object({ account_ids: z.union([z.string(), z.array(z.string())]).transform((v) => (Array.isArray(v) ? v : v.split(","))), period: z.enum(["daily", "monthly", "yearly"]).default("monthly"), mode: z.enum(["synthetic", "analytic"]).default("synthetic"), start_date: date, end_date: date }).parse(req.query);
    const trunc = q.period === "daily" ? "day" : q.period === "monthly" ? "month" : "year";
    // Mesmo contrato do saldo: a conta é da organização, então o acumulado dela também é.
    const opening = await ctx.tx.query<{ v: string }>("select coalesce(sum(a.opening_balance),0) + coalesce((select sum(case when m.type='in' then m.amount+m.interest else -(m.amount+m.interest) end) from erp.movimentos_conta_organizacao($2::uuid[]) m where m.movement_date < $3),0) as v from erp.bank_accounts a where a.organization_id=$1 and a.id = any($2::uuid[])", [ctx.orgId, q.account_ids, q.start_date]);
    const rows = await ctx.tx.query<{ period: string; in_amount: string; out_amount: string }>(`select to_char(date_trunc('${trunc}', movement_date),'YYYY-MM-DD') as period, coalesce(sum(case when type='in' then amount+interest end),0) in_amount, coalesce(sum(case when type='out' then amount+interest end),0) out_amount from erp.movimentos_conta_organizacao($1::uuid[], $2, $3) group by 1 order by 1`, [q.account_ids, q.start_date, q.end_date]);
    let bal = D(opening.rows[0]!.v);
    const periods = rows.rows.map((r) => { bal = bal.plus(r.in_amount).minus(r.out_amount); return { ...r, balance: money(bal) }; });
    // O analítico mostra os movimentos DA CONTA, com a mesma autoridade do sintético — inclusive as
    // categorias, que a função já traz (as linhas-filhas herdam a visibilidade do movimento pai).
    const detail = q.mode === "analytic" ? (await ctx.tx.query("select id, movement_date, type, amount, interest, note, document, account_code, categories from erp.movimentos_conta_organizacao($1::uuid[], $2, $3) order by movement_date, created_at", [q.account_ids, q.start_date, q.end_date])).rows : [];
    return { opening_balance: money(opening.rows[0]!.v), closing_balance: money(bal), periods, movements: detail };
  }));

  // ---------- Conciliação OFX ----------
  app.get("/financial/ofx-imports", async (req) => runService(app, req, "ofx_imports.view", async (ctx) => { const f = req.query as Record<string, string>; const where = ["i.organization_id=$1", "i.deleted_at is null"]; const params: unknown[] = [ctx.orgId]; if (f.bank_account_id) { params.push(f.bank_account_id); where.push(`i.bank_account_id=$${params.length}`); } if (f.description) { params.push(`%${f.description}%`); where.push(`i.description ilike $${params.length}`); } if (f.start_date) { params.push(f.start_date); where.push(`i.start_date>=$${params.length}`); } if (f.end_date) { params.push(f.end_date); where.push(`i.end_date<=$${params.length}`); } const r = await ctx.tx.query(`select i.*, ba.description as bank_account_name, (select count(*) from erp.ofx_transactions t where t.import_id=i.id)::int as transaction_count, (select count(*) from erp.ofx_transactions t where t.import_id=i.id and t.status='matched')::int as matched_count from erp.ofx_imports i join erp.bank_accounts ba on ba.id=i.bank_account_id where ${where.join(" and ")} order by i.created_at desc`, params); return paginaComIdGlobal(ctx, "ofx_imports", { items: r.rows as Record<string, unknown>[], total: r.rowCount }); }));
  /** Importa OFX (conteúdo textual) — parser próprio do formato SGML/XML de STMTTRN. */
  app.post("/financial/ofx-imports", async (req, reply) => reply.status(201).send(await runService(app, req, "ofx_imports.create", async (ctx) => {
    const d = z.object({ bank_account_id: uuid, description: z.string().min(1), content: z.string().min(10) }).parse(req.body);
    const txs = parseOfx(d.content); if (!txs.length) throw validation("Nenhuma transação encontrada no OFX");
    const dates = txs.map((t) => t.date).sort(); const code = await nextCode(ctx.tx, ctx.orgId, "ofx_import");
    const r = await ctx.tx.query<{ id: string }>("insert into erp.ofx_imports(organization_id,code,description,bank_account_id,start_date,end_date,created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id", [ctx.orgId, code, d.description, d.bank_account_id, dates[0], dates[dates.length - 1], ctx.user.id]);
    await atribuirIdGlobal(ctx, "ofx_imports", r.rows[0]!.id);
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
    if (!mid && d.create) mid = await createBankMovement(ctx, { empresaId: ctx.empresaId, bankAccountId: imp.rows[0]!.bank_account_id, date: t.rows[0].posted_date, type: D(t.rows[0].amount).gte(0) ? "in" : "out", amount: D(t.rows[0].amount).abs().toFixed(2), note: d.create.note ?? t.rows[0].memo ?? "Conciliação OFX", sourceType: "ofx", sourceId: tid, apportionment: d.create.apportionment.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, percentage: a.percentage, amount: a.amount })) });
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
    const { id } = req.params as { id: string }; const p = await ctx.tx.query<{ year: number; empresa_id: string | null }>("select year, empresa_id from erp.budget_plannings where id=$1 and organization_id=$2" + scopedById(ctx, "empresa_id", id, { nullable: true }).sql, scopedById(ctx, "empresa_id", id, { nullable: true }).params); if (!p.rows[0]) throw notFound();
    const cats = await ctx.tx.query("select id, code, name, nature, kind, parent_id from erp.financial_categories where organization_id=$1 and deleted_at is null and is_active order by code", [ctx.orgId]);
    const vals = await ctx.tx.query<{ financial_category_id: string; month: number; amount: string }>("select financial_category_id, month, amount from erp.budget_planning_values where planning_id=$1", [id]);
    // O realizado do ano anterior é agregado de TÍTULOS, que têm empresa própria. O filtro pela empresa do
    // PLANEJAMENTO não basta: planejamento da organização (empresa_id nulo) tornava o predicado `true` e somava
    // o realizado de todas as empresas para quem enxerga uma só. O escopo do módulo entra por cima.
    const pp: unknown[] = [ctx.orgId, p.rows[0].year - 1, p.rows[0].empresa_id];
    const prev = await ctx.tx.query<{ financial_category_id: string; total: string }>("select a.financial_category_id, sum(a.amount) total from erp.title_apportionments a join erp.financial_titles t on t.id=a.title_id where t.organization_id=$1 and t.status<>'cancelled' and extract(year from t.due_date)=$2 and ($3::uuid is null or t.empresa_id=$3)" + empresaScopeSql(ctx, "t.empresa_id", pp) + " group by 1", pp);
    const prevMap = new Map(prev.rows.map((r) => [r.financial_category_id, r.total]));
    return { year: p.rows[0].year, categories: cats.rows.map((c) => ({ ...(c as Record<string, unknown>), previous_year: prevMap.get((c as { id: string }).id) ?? "0.00", months: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, vals.rows.find((v) => v.financial_category_id === (c as { id: string }).id && v.month === i + 1)?.amount ?? "0.00"])) })) };
  }));
  app.put("/financial/budget-plannings/:id/values", async (req) => runService(app, req, "budget_plannings.edit", async (ctx) => {
    const { id } = req.params as { id: string }; const d = z.array(z.object({ financial_category_id: uuid, month: z.number().int().min(1).max(12), amount: dec })).parse(req.body);
    const p = await ctx.tx.query("select 1 from erp.budget_plannings where id=$1 and organization_id=$2" + scopedById(ctx, "empresa_id", id, { nullable: true }).sql, scopedById(ctx, "empresa_id", id, { nullable: true }).params); if (!p.rowCount) throw notFound();
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
  return { empresaId: d.empresa_id, direction: dir, number: d.number, titleTypeId: d.title_type_id ?? null, personId: d.person_id ?? null, proprietaryId: d.proprietary_id ?? null, branchId: d.branch_id ?? null, paymentType: d.payment_type, recurrenceType: d.recurrence_type ?? null, classification: d.classification, documentType: d.document_type ?? null, isDeductible: d.is_deductible, isTax: d.is_tax, amount: d.amount, discount: d.discount, emissionDate: d.emission_date, dueDate: d.due_date, note: d.note, harvestId: d.harvest_id ?? null, appropriation: d.appropriation, appropriationType: d.appropriation_type ?? null, sourceType: "manual" } as const;
}
