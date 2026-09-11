import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { D, money, isISODate } from "@agro/shared";
import { nextPurchaseStatus, allowedPurchaseActions, authorizerCanApprove, PURCHASE_STATUS_LABELS, slaStatus, type PurchaseRequestStatus, type PurchaseAction } from "@agro/domain";
import { runService, nextCode, idempotent, audit } from "../lib/service.js";
import { notFound, validation, err } from "../lib/errors.js";
import { farmAllowed, hasPermission, type ServiceCtx } from "../lib/context.js";
import { pageQuerySchema } from "../lib/pagination.js";
import { createTitles } from "../services/financial-core.js";

const dec = z.union([z.number(), z.string()]).transform(String);
const date = z.string().refine(isISODate, "Data inválida");
const uuid = z.string().uuid();
const itemSchema = z.object({ product_id: uuid.optional().nullable(), description: z.string().min(1), quantity: dec.default("1"), reference_value: dec.optional().nullable(), amount: dec.optional().nullable(), observation: z.string().optional().nullable(), extra: z.record(z.string(), z.unknown()).optional().nullable() });
const requestSchema = z.object({ farm_id: uuid, request_date: date, priority: z.enum(["low", "medium", "high"]).default("medium"), request_type: z.enum(["product", "service", "advance", "refund", "daily", "contract", "finished_product"]), authorizer_id: uuid.optional().nullable(), description: z.string().min(1), justification: z.string().min(1), observation: z.string().optional().nullable(), parent_id: uuid.optional().nullable(), items: z.array(itemSchema).min(1) });

async function loadRequest(ctx: ServiceCtx, id: string, lock = false) {
  if (lock) await ctx.tx.query("select 1 from erp.purchase_requests where id=$1 and organization_id=$2 for update", [id, ctx.orgId]);
  const r = await ctx.tx.query("select r.*, f.name as farm_name, u.name as requester_name, cu.name as current_responsible_name from erp.purchase_requests r join erp.farms f on f.id=r.farm_id left join erp.users u on u.id=r.requester_user_id left join erp.users cu on cu.id=r.current_responsible_user_id where r.id=$1 and r.organization_id=$2 and r.deleted_at is null", [id, ctx.orgId]);
  if (!r.rows[0]) throw notFound("Solicitação");
  return r.rows[0] as Record<string, unknown> & { id: string; status: PurchaseRequestStatus; farm_id: string; farm_name: string; version: number; requester_user_id: string; current_responsible_user_id: string | null; estimated_total: string; approved_total: string | null; selected_quotation_id: string | null; code: string; request_type: string; request_date: string; observation: string | null; status_changed_at: Date };
}
async function addEvent(ctx: ServiceCtx, requestId: string, from: string | null, to: string, action: string, justification: string | null, since?: Date) {
  const mins = since ? Math.round((Date.now() - new Date(since).getTime()) / 60000) : null;
  await ctx.tx.query("insert into erp.purchase_request_events(request_id,organization_id,user_id,from_status,to_status,action,justification,time_spent_minutes) values ($1,$2,$3,$4,$5,$6,$7,$8)", [requestId, ctx.orgId, ctx.user.id, from, to, action, justification, mins]);
}
async function transition(ctx: ServiceCtx, id: string, action: PurchaseAction, justification: string | null, extra: { responsible?: string | null; expectedVersion?: number } = {}) {
  const r = await ctx.tx.query<{ status: PurchaseRequestStatus; version: number; status_changed_at: Date; requester_user_id: string }>("select status, version, status_changed_at, requester_user_id from erp.purchase_requests where id=$1 and organization_id=$2 and deleted_at is null for update", [id, ctx.orgId]);
  const cur = r.rows[0]; if (!cur) throw notFound("Solicitação");
  if (extra.expectedVersion !== undefined && extra.expectedVersion !== cur.version) throw err("CONCURRENCY_CONFLICT", "A solicitação foi alterada por outro usuário; recarregue");
  const next = nextPurchaseStatus(cur.status, action);
  const responsible = extra.responsible === undefined ? (next === "request" || next === "not_approved" ? cur.requester_user_id : null) : extra.responsible;
  await ctx.tx.query("update erp.purchase_requests set status=$3, status_changed_at=now(), version=version+1, current_responsible_user_id=coalesce($4,current_responsible_user_id) where id=$1 and organization_id=$2", [id, ctx.orgId, next, responsible]);
  await addEvent(ctx, id, cur.status, next, action, justification, cur.status_changed_at);
  await audit(ctx.tx, ctx, "purchase_requests", id, action, { from: cur.status, to: next });
  return next;
}

export default async function supplyRoutes(app: FastifyInstance) {
  // Listagem por etapa (Solicitação, Cotações, Autorização, Compras, Recebimentos, Rejeitados, Meus processos)
  app.get("/supply/requests", async (req) => runService(app, req, "purchase_requests.view", async (ctx) => {
    const q = pageQuerySchema.parse(req.query); const f = req.query as Record<string, string>;
    const where = ["r.organization_id=$1", "r.deleted_at is null"]; const params: unknown[] = [ctx.orgId];
    const stage = f.stage; // request | quotation | authorization | buy | receipts | rejected | mine
    const stageStatuses: Record<string, PurchaseRequestStatus[]> = { request: ["request"], quotation: ["awaiting_awareness", "quotation_in_progress"], authorization: ["awaiting_approval", "awaiting_awareness", "under_review"], buy: ["awaiting_purchase", "purchase_done"], receipts: ["purchase_done", "purchase_received", "finished"], finished: ["finished"], rejected: ["not_approved", "cancelled"] };
    if (stage && stageStatuses[stage]) { params.push(stageStatuses[stage]); where.push(`r.status = any($${params.length})`); }
    if (stage === "mine") { params.push(ctx.user.id); where.push(`(r.current_responsible_user_id=$${params.length} or r.requester_user_id=$${params.length}) and r.status not in ('finished','cancelled')`); }
    if (f.status) { params.push(f.status); where.push(`r.status=$${params.length}`); }
    if (f.request_type) { params.push(f.request_type); where.push(`r.request_type=$${params.length}`); }
    if (f.priority) { params.push(f.priority); where.push(`r.priority=$${params.length}`); }
    if (f.farm_id) { params.push(f.farm_id); where.push(`r.farm_id=$${params.length}`); } else if (ctx.farmId) { params.push(ctx.farmId); where.push(`r.farm_id=$${params.length}`); }
    if (ctx.membership.farmIds.length) { params.push(ctx.membership.farmIds); where.push(`r.farm_id = any($${params.length}::uuid[])`); }
    if (f.requester_user_id) { params.push(f.requester_user_id); where.push(`r.requester_user_id=$${params.length}`); }
    if (f.responsible_user_id) { params.push(f.responsible_user_id); where.push(`r.current_responsible_user_id=$${params.length}`); }
    if (f.start_date) { params.push(f.start_date); where.push(`r.request_date>=$${params.length}`); } if (f.end_date) { params.push(f.end_date); where.push(`r.request_date<=$${params.length}`); }
    if (f.search) { params.push(`%${f.search}%`); where.push(`(r.code ilike $${params.length} or r.description ilike $${params.length})`); }
    const total = await ctx.tx.query<{ n: string }>(`select count(*) n from erp.purchase_requests r where ${where.join(" and ")}`, params);
    const r = await ctx.tx.query(`select r.id, r.code, r.request_date, r.description, r.priority, r.request_type, r.status, r.status_changed_at, r.estimated_total, r.approved_total, r.invoice_number, r.updated_at, r.version, f.name as farm_name, u.name as requester_name, cu.name as current_responsible_name, extract(epoch from now()-r.status_changed_at)/3600 as hours_in_status, (select count(*) from erp.purchase_quotations q where q.request_id=r.id)::int as quotation_count, (select max_hours from erp.supply_status_sla s where s.organization_id=r.organization_id and s.status=r.status) as sla_hours, r.invoice_id is not null as launched from erp.purchase_requests r join erp.farms f on f.id=r.farm_id left join erp.users u on u.id=r.requester_user_id left join erp.users cu on cu.id=r.current_responsible_user_id where ${where.join(" and ")} order by r.request_date desc, r.created_at desc limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`, params);
    return { items: r.rows.map((x) => ({ ...(x as Record<string, unknown>), status_label: PURCHASE_STATUS_LABELS[(x as { status: PurchaseRequestStatus }).status], sla: slaStatus(new Date((x as { status_changed_at: string }).status_changed_at), new Date(), Number((x as { sla_hours: number | null }).sla_hours ?? 0)) })), total: Number(total.rows[0]!.n), page: q.page, pageSize: q.pageSize };
  }));
  app.get("/supply/requests/:id", async (req) => runService(app, req, "purchase_requests.view", async (ctx) => {
    const id = (req.params as { id: string }).id; const r = await loadRequest(ctx, id);
    const items = await ctx.tx.query("select i.*, p.description as product_name, p.code as product_code from erp.purchase_request_items i left join erp.products p on p.id=i.product_id where i.request_id=$1 order by i.position", [id]);
    const events = await ctx.tx.query("select e.*, u.name as user_name from erp.purchase_request_events e left join erp.users u on u.id=e.user_id where e.request_id=$1 order by e.created_at", [id]);
    const quotations = await ctx.tx.query("select q.*, p.name as provider_name, (select json_agg(json_build_object('request_item_id',qi.request_item_id,'unit_price',qi.unit_price,'quantity',qi.quantity,'total',qi.total,'brand',qi.brand)) from erp.purchase_quotation_items qi where qi.quotation_id=q.id) as items from erp.purchase_quotations q join erp.people p on p.id=q.provider_id where q.request_id=$1 order by q.total", [id]);
    const approvals = await ctx.tx.query("select a.*, u.name as decided_by_name from erp.purchase_approvals a left join erp.users u on u.id=a.decided_by where a.request_id=$1 order by a.decided_at", [id]);
    const children = await ctx.tx.query("select id, code, status, current_responsible_user_id from erp.purchase_requests where parent_id=$1", [id]);
    const attachments = await ctx.tx.query("select id, file_name, description, object_path, created_at from erp.attachments where entity='purchase_request' and entity_id=$1", [id]);
    const canTransfer = hasPermission(ctx, "purchase_requests.transfer");
    return { ...r, status_label: PURCHASE_STATUS_LABELS[r.status], items: items.rows, events: events.rows.map((e) => ({ ...(e as Record<string, unknown>), to_status_label: PURCHASE_STATUS_LABELS[(e as { to_status: PurchaseRequestStatus }).to_status] })), quotations: quotations.rows, approvals: approvals.rows, children: children.rows, attachments: attachments.rows, allowed_actions: allowedPurchaseActions(r.status), can_transfer: canTransfer };
  }));
  app.post("/supply/requests", async (req, reply) => reply.status(201).send(await runService(app, req, "purchase_requests.create", async (ctx) => {
    const d = requestSchema.parse(req.body); if (!farmAllowed(ctx, d.farm_id)) throw validation("Sem acesso à fazenda");
    return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined, d, async () => {
      const code = await nextCode(ctx.tx, ctx.orgId, "purchase_request");
      const est = d.items.reduce((a, i) => a.plus(D(i.amount ?? D(i.reference_value ?? 0).mul(i.quantity))), D(0));
      // responsável inicial: encarregado (autorizador) informado ou o "chefe" do solicitante
      let responsible: string | null = null;
      if (d.authorizer_id) responsible = (await ctx.tx.query<{ user_id: string }>("select user_id from erp.authorizers where id=$1 and organization_id=$2 and is_active", [d.authorizer_id, ctx.orgId])).rows[0]?.user_id ?? null;
      if (!responsible) responsible = (await ctx.tx.query<{ boss_user_id: string }>("select boss_user_id from erp.user_bosses where organization_id=$1 and user_id=$2 limit 1", [ctx.orgId, ctx.user.id])).rows[0]?.boss_user_id ?? null;
      const r = await ctx.tx.query<{ id: string }>("insert into erp.purchase_requests(organization_id,farm_id,code,parent_id,request_date,priority,request_type,requester_user_id,authorizer_id,current_responsible_user_id,description,justification,observation,estimated_total) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id", [ctx.orgId, d.farm_id, code, d.parent_id ?? null, d.request_date, d.priority, d.request_type, ctx.user.id, d.authorizer_id ?? null, responsible ?? ctx.user.id, d.description, d.justification, d.observation ?? null, money(est)]);
      const id = r.rows[0]!.id;
      for (const [i, it] of d.items.entries()) await ctx.tx.query("insert into erp.purchase_request_items(request_id,product_id,description,quantity,reference_value,amount,observation,extra,position) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id, it.product_id ?? null, it.description, it.quantity, it.reference_value ?? null, it.amount ?? null, it.observation ?? null, JSON.stringify(it.extra ?? {}), i]);
      await addEvent(ctx, id, null, "request", "create", d.justification);
      // Fluxo simplificado da fazenda: pula direto para "Aguardando a Compra"; senão vai para ciência do encarregado
      const simplified = (await ctx.tx.query<{ v: boolean }>("select coalesce((parameters->>'simplified_purchase_flow')::boolean,false) v from erp.organizations where id=$1", [ctx.orgId])).rows[0]?.v;
      if (simplified) { await transition(ctx, id, "send_to_approval", "Fluxo simplificado"); await transition(ctx, id, "approve", "Fluxo simplificado (aprovação automática)"); }
      else if (responsible) await transition(ctx, id, "submit", "Enviado para ciência do encarregado", { responsible });
      if (d.parent_id) await addEvent(ctx, d.parent_id, null, (await loadRequest(ctx, d.parent_id)).status, "comment", `Criação de sub solicitação de código ${code}`);
      await audit(ctx.tx, ctx, "purchase_requests", id, "create", { code });
      return { id, code };
    })).result;
  })));
  app.put("/supply/requests/:id", async (req) => runService(app, req, "purchase_requests.edit", async (ctx) => {
    const { id } = req.params as { id: string }; const d = requestSchema.partial().parse(req.body); const r = await loadRequest(ctx, id, true);
    if (!["request", "awaiting_awareness", "not_approved"].includes(r.status)) throw err("INVALID_STATUS_TRANSITION", "Solicitação só pode ser editada antes da cotação");
    await ctx.tx.query("update erp.purchase_requests set priority=coalesce($3,priority), description=coalesce($4,description), justification=coalesce($5,justification), observation=coalesce($6,observation), version=version+1 where id=$1 and organization_id=$2", [id, ctx.orgId, d.priority ?? null, d.description ?? null, d.justification ?? null, d.observation ?? null]);
    if (d.items) { await ctx.tx.query("delete from erp.purchase_request_items where request_id=$1", [id]); for (const [i, it] of d.items.entries()) await ctx.tx.query("insert into erp.purchase_request_items(request_id,product_id,description,quantity,reference_value,amount,observation,extra,position) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id, it.product_id ?? null, it.description, it.quantity, it.reference_value ?? null, it.amount ?? null, it.observation ?? null, JSON.stringify(it.extra ?? {}), i]); }
    await audit(ctx.tx, ctx, "purchase_requests", id, "update");
    return { id };
  }));
  // Ações do workflow
  const actionSchema = z.object({ justification: z.string().min(1), version: z.number().int().optional(), responsible_user_id: uuid.optional().nullable(), authorizer_id: uuid.optional().nullable() });
  const permFor: Record<PurchaseAction, string> = { submit: "purchase_requests.edit", acknowledge: "purchase_quotations.view", start_quotation: "purchase_quotations.create", send_to_approval: "purchase_quotations.edit", approve: "purchase_authorization.edit", reject: "purchase_authorization.edit", review: "purchase_authorization.edit", mark_purchased: "purchase_buy.edit", mark_received: "purchase_receipts.edit", finish: "purchase_receipts.edit", cancel: "purchase_requests.cancel", back_step: "purchase_requests.back_step" };
  app.post("/supply/requests/:id/actions/:action", async (req) => {
    const { id, action } = req.params as { id: string; action: PurchaseAction };
    const perm = permFor[action]; if (!perm) throw validation("Ação inválida");
    return runService(app, req, perm, async (ctx) => {
      const d = actionSchema.parse(req.body); const r = await loadRequest(ctx, id, true);
      nextPurchaseStatus(r.status, action); // valida a transição antes de qualquer efeito colateral
      if (action === "approve" || action === "reject") {
        const auth = await ctx.tx.query<{ id: string; max_value: string; is_active: boolean; min_quotes: number; levels: number[] }>("select id, max_value, is_active, min_quotes, levels from erp.authorizers where organization_id=$1 and user_id=$2 and deleted_at is null", [ctx.orgId, ctx.user.id]);
        const a = auth.rows[0];
        if (!a && !ctx.membership.isOwner) throw err("PERMISSION_DENIED", "Usuário não é autorizador");
        const total = r.approved_total ?? r.estimated_total;
        const quotes = (await ctx.tx.query<{ n: string }>("select count(*) n from erp.purchase_quotations where request_id=$1", [id])).rows[0]!.n;
        // Regra: mínimo de cotações do autorizador aplica-se a solicitações de produto (serviço/adiantamento/diária não cotam)
        if (a && action === "approve") { const chk = authorizerCanApprove({ maxValue: a.max_value, isActive: a.is_active, minQuotes: r.request_type === "product" ? a.min_quotes : 0 }, { approvedTotal: total, quotationCount: Number(quotes) }); if (!chk.ok) throw err("PERMISSION_DENIED", chk.reason!); }
        if (a) await ctx.tx.query("insert into erp.purchase_approvals(request_id,authorizer_id,level,decision,justification,decided_by) values ($1,$2,$3,$4,$5,$6)", [id, a.id, a.levels?.[0] ?? 1, action === "approve" ? "approved" : "rejected", d.justification, ctx.user.id]);
        if (action === "approve") { const buyer = (await ctx.tx.query<{ user_id: string }>("select m.user_id from erp.organization_members m join erp.role_permissions rp on rp.role_id=m.role_id where m.organization_id=$1 and rp.permission_key='purchase_buy.edit' and m.is_active limit 1", [ctx.orgId])).rows[0]?.user_id ?? null; const next = await transition(ctx, id, action, d.justification, { expectedVersion: d.version, responsible: buyer ?? ctx.user.id }); return { id, status: next }; }
      }
      if (action === "acknowledge") { await ctx.tx.query("insert into erp.purchase_approvals(request_id,authorizer_id,level,decision,justification,decided_by) select $1, a.id, 1, 'awareness', $2, $3 from erp.authorizers a where a.organization_id=$4 and a.user_id=$3", [id, d.justification, ctx.user.id, ctx.orgId]); }
      if (action === "send_to_approval") {
        const q = await ctx.tx.query<{ n: string }>("select count(*) n from erp.purchase_quotations where request_id=$1", [id]);
        const minQ = d.authorizer_id ? (await ctx.tx.query<{ min_quotes: number }>("select min_quotes from erp.authorizers where id=$1", [d.authorizer_id])).rows[0]?.min_quotes ?? 0 : 0;
        if (r.request_type === "product" && Number(q.rows[0]!.n) < minQ) throw validation(`Mínimo de ${minQ} cotações para enviar à autorização`);
        if (!r.selected_quotation_id && Number(q.rows[0]!.n) > 0) throw validation("Selecione a cotação vencedora antes de enviar para autorização");
        const authUser = d.authorizer_id ? (await ctx.tx.query<{ user_id: string }>("select user_id from erp.authorizers where id=$1 and organization_id=$2", [d.authorizer_id, ctx.orgId])).rows[0]?.user_id : null;
        const next = await transition(ctx, id, action, d.justification, { expectedVersion: d.version, responsible: authUser ?? null }); return { id, status: next };
      }
      if (action === "mark_received") {
        // Regra: recebimento de produto exige documento fiscal lançado (invoice_id) — "Lançado" na tela de Recebimentos
        if (r.request_type === "product" && !(r as { invoice_id?: string | null }).invoice_id) throw validation("Lance o documento fiscal de entrada (estoque) antes de confirmar o recebimento");
      }
      if (action === "finish" && ["advance", "refund", "daily", "contract", "service"].includes(r.request_type) && !(r as { financial_generated?: boolean }).financial_generated) {
        // Gera conta a pagar para tipos não-produto ao finalizar (fluxo "Financeiro" da solicitação)
        const items = await ctx.tx.query<{ amount: string | null; reference_value: string | null; quantity: string; description: string }>("select amount, reference_value, quantity, description from erp.purchase_request_items where request_id=$1", [id]);
        const total = items.rows.reduce((a, i) => a.plus(D(i.amount ?? D(i.reference_value ?? 0).mul(i.quantity))), D(0));
        const cat = (await ctx.tx.query<{ id: string }>("select id from erp.financial_categories where organization_id=$1 and nature='expense' and kind='analytic' and deleted_at is null order by code limit 1", [ctx.orgId])).rows[0];
        const cc = (await ctx.tx.query<{ id: string }>("select id from erp.cost_centers where organization_id=$1 and kind='analytic' and deleted_at is null order by code limit 1", [ctx.orgId])).rows[0];
        if (total.gt(0) && cat && cc && hasPermission(ctx, "purchase_requests.financial")) {
          const t = await createTitles(ctx, { farmId: r.farm_id, direction: "payable", number: `SOL-${r.code}`, personId: null, amount: money(total), emissionDate: new Date().toISOString().slice(0, 10), dueDate: ((r as { financial_due_date?: string | null }).financial_due_date) ?? new Date().toISOString().slice(0, 10), note: `Solicitação ${r.code}: ${items.rows.map((i) => i.description).join("; ")}`, apportionment: [{ financialCategoryId: cat.id, costCenterId: cc.id, percentage: "100" }], sourceType: "purchase_requests", sourceId: id });
          await addEvent(ctx, id, r.status, r.status, "financial", `Títulos gerados: ${t.ids.length}`);
        }
      }
      const next = await transition(ctx, id, action, d.justification, { expectedVersion: d.version, responsible: d.responsible_user_id ?? undefined });
      return { id, status: next, status_label: PURCHASE_STATUS_LABELS[next] };
    });
  });
  // Transferir responsável (sem mudar status)
  app.post("/supply/requests/:id/transfer", async (req) => runService(app, req, "purchase_requests.transfer", async (ctx) => {
    const { id } = req.params as { id: string }; const d = z.object({ responsible_user_id: uuid, justification: z.string().min(1) }).parse(req.body); const r = await loadRequest(ctx, id, true);
    await ctx.tx.query("update erp.purchase_requests set current_responsible_user_id=$3, version=version+1 where id=$1 and organization_id=$2", [id, ctx.orgId, d.responsible_user_id]);
    await addEvent(ctx, id, r.status, r.status, "transfer", d.justification); return { id };
  }));
  app.post("/supply/requests/transfer-batch", async (req) => runService(app, req, "purchase_requests.transfer", async (ctx) => {
    const d = z.object({ ids: z.array(uuid).min(1), responsible_user_id: uuid, justification: z.string().min(1) }).parse(req.body);
    for (const id of d.ids) { const r = await loadRequest(ctx, id, true); await ctx.tx.query("update erp.purchase_requests set current_responsible_user_id=$3, version=version+1 where id=$1 and organization_id=$2", [id, ctx.orgId, d.responsible_user_id]); await addEvent(ctx, id, r.status, r.status, "transfer", d.justification); }
    return { transferred: d.ids.length };
  }));
  app.post("/supply/requests/:id/comments", async (req) => runService(app, req, "purchase_requests.view", async (ctx) => { const { id } = req.params as { id: string }; const d = z.object({ text: z.string().min(1) }).parse(req.body); const r = await loadRequest(ctx, id); await addEvent(ctx, id, r.status, r.status, "comment", d.text); return { id }; }));
  app.put("/supply/requests/:id/financial", async (req) => runService(app, req, "purchase_requests.financial", async (ctx) => { const { id } = req.params as { id: string }; const d = z.object({ classification: z.enum(["unclassified", "capex", "opex"]).optional(), financial_due_date: date.optional().nullable(), invoice_number: z.string().optional().nullable(), final_observation: z.string().optional().nullable() }).parse(req.body); await loadRequest(ctx, id, true); await ctx.tx.query("update erp.purchase_requests set classification=coalesce($3,classification), financial_due_date=coalesce($4,financial_due_date), invoice_number=coalesce($5,invoice_number), final_observation=coalesce($6,final_observation), version=version+1 where id=$1 and organization_id=$2", [id, ctx.orgId, d.classification ?? null, d.financial_due_date ?? null, d.invoice_number ?? null, d.final_observation ?? null]); return { id }; }));

  // Cotações
  const quotationSchema = z.object({ provider_id: uuid, quotation_date: date.optional(), payment_condition: z.string().optional().nullable(), delivery_days: z.number().int().optional().nullable(), freight: dec.default("0"), note: z.string().optional().nullable(), items: z.array(z.object({ request_item_id: uuid, unit_price: dec, quantity: dec.optional(), brand: z.string().optional().nullable() })).min(1) });
  app.post("/supply/requests/:id/quotations", async (req, reply) => reply.status(201).send(await runService(app, req, "purchase_quotations.create", async (ctx) => {
    const { id } = req.params as { id: string }; const d = quotationSchema.parse(req.body); const r = await loadRequest(ctx, id, true);
    if (!["awaiting_awareness", "quotation_in_progress", "request", "under_review", "not_approved"].includes(r.status)) throw err("INVALID_STATUS_TRANSITION", "Cotações só na etapa de cotação");
    if (r.status !== "quotation_in_progress") { try { await transition(ctx, id, r.status === "request" ? "start_quotation" : r.status === "awaiting_awareness" ? "acknowledge" : "back_step", "Início da cotação"); } catch { /* status já adequado */ } }
    const q = await ctx.tx.query<{ id: string }>("insert into erp.purchase_quotations(request_id,organization_id,provider_id,quotation_date,payment_condition,delivery_days,freight,note,created_by) values ($1,$2,$3,coalesce($4,current_date),$5,$6,$7,$8,$9) returning id", [id, ctx.orgId, d.provider_id, d.quotation_date ?? null, d.payment_condition ?? null, d.delivery_days ?? null, d.freight, d.note ?? null, ctx.user.id]);
    let total = D(d.freight);
    for (const it of d.items) {
      const ri = await ctx.tx.query<{ quantity: string }>("select quantity from erp.purchase_request_items where id=$1 and request_id=$2", [it.request_item_id, id]); if (!ri.rows[0]) throw validation("Item da solicitação inválido");
      const qty = it.quantity ?? ri.rows[0].quantity; const t = money(D(qty).mul(it.unit_price)); total = total.plus(t);
      await ctx.tx.query("insert into erp.purchase_quotation_items(quotation_id,request_item_id,unit_price,quantity,total,brand) values ($1,$2,$3,$4,$5,$6)", [q.rows[0]!.id, it.request_item_id, it.unit_price, qty, t, it.brand ?? null]);
    }
    await ctx.tx.query("update erp.purchase_quotations set total=$2 where id=$1", [q.rows[0]!.id, money(total)]);
    await addEvent(ctx, id, r.status, "quotation_in_progress", "comment", `Cotação registrada: ${money(total)}`);
    return { id: q.rows[0]!.id, total: money(total) };
  })));
  app.post("/supply/requests/:id/quotations/:qid/select", async (req) => runService(app, req, "purchase_quotations.edit", async (ctx) => {
    const { id, qid } = req.params as { id: string; qid: string }; await loadRequest(ctx, id, true);
    const q = await ctx.tx.query<{ total: string }>("select total from erp.purchase_quotations where id=$1 and request_id=$2", [qid, id]); if (!q.rows[0]) throw notFound("Cotação");
    await ctx.tx.query("update erp.purchase_quotations set is_selected=(id=$2) where request_id=$1", [id, qid]);
    await ctx.tx.query("update erp.purchase_requests set selected_quotation_id=$2, approved_total=$3, version=version+1 where id=$1", [id, qid, q.rows[0].total]);
    await audit(ctx.tx, ctx, "purchase_requests", id, "select_quotation", { quotation: qid });
    return { id, approved_total: q.rows[0].total };
  }));
  app.delete("/supply/requests/:id/quotations/:qid", async (req) => runService(app, req, "purchase_quotations.delete", async (ctx) => { const { id, qid } = req.params as { id: string; qid: string }; await loadRequest(ctx, id, true); await ctx.tx.query("delete from erp.purchase_quotations where id=$1 and request_id=$2 and not is_selected", [qid, id]); return { deleted: true }; }));
  // Pedido de compra (texto para envio ao fornecedor por e-mail/WhatsApp) — gerado pelo servidor, envio a cargo do cliente
  app.get("/supply/requests/:id/order", async (req) => runService(app, req, "purchase_buy.view", async (ctx) => {
    const { id } = req.params as { id: string }; const r = await loadRequest(ctx, id);
    const q = await ctx.tx.query("select q.*, p.name as provider_name, p.email as provider_email, p.phone as provider_phone from erp.purchase_quotations q join erp.people p on p.id=q.provider_id where q.request_id=$1 and q.is_selected", [id]);
    const items = await ctx.tx.query("select i.description, i.quantity, qi.unit_price, qi.total from erp.purchase_request_items i left join erp.purchase_quotation_items qi on qi.request_item_id=i.id and qi.quotation_id=$2 where i.request_id=$1 order by i.position", [id, (q.rows[0] as { id?: string } | undefined)?.id ?? null]);
    const lines = items.rows.map((i) => { const x = i as { description: string; quantity: string; unit_price: string | null; total: string | null }; return `- ${x.description} × ${x.quantity}${x.unit_price ? ` @ R$ ${x.unit_price} = R$ ${x.total}` : ""}`; });
    const text = `Pedido de compra ${r.code} — ${r.farm_name}\nData: ${r.request_date}\n${lines.join("\n")}\nTotal: R$ ${r.approved_total ?? r.estimated_total}\n${r.observation ?? ""}`;
    return { code: r.code, provider: q.rows[0] ?? null, items: items.rows, text, whatsapp_url: (q.rows[0] as { provider_phone?: string } | undefined)?.provider_phone ? `https://wa.me/55${String((q.rows[0] as { provider_phone: string }).provider_phone).replace(/\D/g, "")}?text=${encodeURIComponent(text)}` : null, mailto_url: (q.rows[0] as { provider_email?: string } | undefined)?.provider_email ? `mailto:${(q.rows[0] as { provider_email: string }).provider_email}?subject=${encodeURIComponent("Pedido de compra " + r.code)}&body=${encodeURIComponent(text)}` : null };
  }));
  // SLA (parâmetros + relatório por solicitação)
  app.get("/supply/sla", async (req) => runService(app, req, "supply_sla.view", async (ctx) => { const r = await ctx.tx.query("select status, max_hours from erp.supply_status_sla where organization_id=$1", [ctx.orgId]); const map = new Map(r.rows.map((x) => [(x as { status: string }).status, (x as { max_hours: number }).max_hours])); return { items: Object.entries(PURCHASE_STATUS_LABELS).map(([status, label]) => ({ status, label, max_hours: map.get(status) ?? 0 })) }; }));
  app.put("/supply/sla", async (req) => runService(app, req, "supply_sla.edit", async (ctx) => { const d = z.array(z.object({ status: z.string(), max_hours: z.number().int().min(0) })).parse(req.body); for (const s of d) { if (!(s.status in PURCHASE_STATUS_LABELS)) throw validation("Status inválido"); await ctx.tx.query("insert into erp.supply_status_sla(organization_id,status,max_hours) values ($1,$2,$3) on conflict (organization_id,status) do update set max_hours=excluded.max_hours", [ctx.orgId, s.status, s.max_hours]); } return { ok: true }; }));
}
