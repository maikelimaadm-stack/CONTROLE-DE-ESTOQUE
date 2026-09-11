import type { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { PERMISSION_RESOURCES, ACTION_LABELS, allPermissionKeys } from "@agro/domain";
import { runService, audit } from "../lib/service.js";
import { notFound, validation, denied } from "../lib/errors.js";
import { hasPermission } from "../lib/context.js";
import { pageQuerySchema } from "../lib/pagination.js";

export default async function adminRoutes(app: FastifyInstance) {
  // ---------- Catálogo de permissões (árvore para a tela de perfis) ----------
  app.get("/admin/permissions", async (req) => { app.requireCtx(req); return PERMISSION_RESOURCES.map((r) => ({ ...r, actions: r.actions.map((a) => ({ key: `${r.key}.${a}`, action: a, label: ACTION_LABELS[a] ?? a })) })); });

  // ---------- Perfis ----------
  app.get("/admin/roles", async (req) => runService(app, req, "roles.view", async (ctx) => {
    const r = await ctx.tx.query("select r.id, r.name, r.description, r.is_system, r.created_at, r.updated_at, (select count(*) from erp.role_permissions rp where rp.role_id=r.id)::int as permission_count, (select count(*) from erp.organization_members m where m.role_id=r.id)::int as member_count from erp.roles r where r.organization_id=$1 and r.deleted_at is null order by r.name", [ctx.orgId]);
    return { items: r.rows, total: r.rowCount };
  }));
  app.get("/admin/roles/:id", async (req) => runService(app, req, "roles.view", async (ctx) => {
    const { id } = req.params as { id: string };
    const r = await ctx.tx.query("select id,name,description,is_system from erp.roles where id=$1 and organization_id=$2 and deleted_at is null", [id, ctx.orgId]);
    if (!r.rows[0]) throw notFound("Perfil");
    const p = await ctx.tx.query<{ permission_key: string }>("select permission_key from erp.role_permissions where role_id=$1", [id]);
    return { ...r.rows[0], permissions: p.rows.map((x) => x.permission_key) };
  }));
  const roleSchema = z.object({ name: z.string().min(1).max(80), description: z.string().max(200).optional().nullable(), permissions: z.array(z.string()).default([]) });
  app.post("/admin/roles", async (req, reply) => reply.status(201).send(await runService(app, req, "roles.create", async (ctx) => {
    const d = roleSchema.parse(req.body);
    const valid = new Set(allPermissionKeys()); const bad = d.permissions.filter((p) => !valid.has(p)); if (bad.length) throw validation("Permissões inválidas", bad);
    const r = await ctx.tx.query<{ id: string }>("insert into erp.roles(organization_id,name,description) values ($1,$2,$3) returning id", [ctx.orgId, d.name, d.description ?? null]);
    for (const p of d.permissions) await ctx.tx.query("insert into erp.role_permissions(role_id,permission_key) values ($1,$2) on conflict do nothing", [r.rows[0]!.id, p]);
    await audit(ctx.tx, ctx, "roles", r.rows[0]!.id, "create", { permissions: d.permissions.length });
    return { id: r.rows[0]!.id };
  })));
  app.put("/admin/roles/:id", async (req) => runService(app, req, "roles.edit", async (ctx) => {
    const { id } = req.params as { id: string }; const d = roleSchema.parse(req.body);
    const cur = await ctx.tx.query<{ is_system: boolean }>("select is_system from erp.roles where id=$1 and organization_id=$2 and deleted_at is null", [id, ctx.orgId]);
    if (!cur.rows[0]) throw notFound("Perfil");
    await ctx.tx.query("update erp.roles set name=$3, description=$4 where id=$1 and organization_id=$2", [id, ctx.orgId, d.name, d.description ?? null]);
    if (!cur.rows[0].is_system) {
      await ctx.tx.query("delete from erp.role_permissions where role_id=$1", [id]);
      for (const p of d.permissions) await ctx.tx.query("insert into erp.role_permissions(role_id,permission_key) values ($1,$2) on conflict do nothing", [id, p]);
    }
    await audit(ctx.tx, ctx, "roles", id, "update", { permissions: d.permissions.length });
    return { id };
  }));
  app.delete("/admin/roles/:id", async (req) => runService(app, req, "roles.delete", async (ctx) => {
    const { id } = req.params as { id: string };
    const cur = await ctx.tx.query<{ is_system: boolean }>("select is_system from erp.roles where id=$1 and organization_id=$2", [id, ctx.orgId]);
    if (!cur.rows[0]) throw notFound("Perfil"); if (cur.rows[0].is_system) throw validation("Perfil de sistema não pode ser excluído");
    const inUse = await ctx.tx.query("select 1 from erp.organization_members where role_id=$1 and is_active limit 1", [id]); if (inUse.rowCount) throw validation("Perfil em uso por usuários");
    await ctx.tx.query("update erp.roles set deleted_at=now() where id=$1", [id]);
    return { id, deleted: true };
  }));

  // ---------- Usuários/membros da organização ----------
  app.get("/admin/members", async (req) => runService(app, req, "users.view", async (ctx) => {
    const q = pageQuerySchema.parse(req.query);
    const where = ["m.organization_id=$1"]; const params: unknown[] = [ctx.orgId];
    if (q.search) { params.push(`%${q.search}%`); where.push(`(u.name ilike $${params.length} or u.email::text ilike $${params.length})`); }
    const total = await ctx.tx.query<{ n: string }>(`select count(*) n from erp.organization_members m join erp.users u on u.id=m.user_id where ${where.join(" and ")}`, params);
    const r = await ctx.tx.query(`select m.id as member_id, u.id, u.name, u.email, u.phone, u.is_active as user_active, m.is_active, m.is_owner, m.role_id, r.name as role_name, u.last_login_at, m.created_at, (select array_agg(farm_id) from erp.member_farms mf where mf.member_id=m.id) as farm_ids from erp.organization_members m join erp.users u on u.id=m.user_id left join erp.roles r on r.id=m.role_id where ${where.join(" and ")} order by u.name limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`, params);
    return { items: r.rows, total: Number(total.rows[0]!.n), page: q.page, pageSize: q.pageSize };
  }));
  const memberSchema = z.object({ name: z.string().min(1), email: z.string().email(), phone: z.string().optional().nullable(), password: z.string().min(8).optional(), role_id: z.string().uuid().nullable().optional(), farm_ids: z.array(z.string().uuid()).default([]), is_active: z.boolean().default(true), boss_user_ids: z.array(z.string().uuid()).default([]) });
  app.post("/admin/members", async (req, reply) => reply.status(201).send(await runService(app, req, "users.create", async (ctx) => {
    const d = memberSchema.parse(req.body);
    const hash = d.password ? await bcrypt.hash(d.password, 10) : null;
    const u = await ctx.tx.query<{ id: string }>("insert into erp.users(email,name,phone,password_hash) values ($1,$2,$3,$4) on conflict (email) do update set name=excluded.name, phone=coalesce(excluded.phone, erp.users.phone), password_hash=coalesce(excluded.password_hash, erp.users.password_hash) returning id", [d.email.toLowerCase(), d.name, d.phone ?? null, hash]);
    const m = await ctx.tx.query<{ id: string }>("insert into erp.organization_members(organization_id,user_id,role_id,is_active) values ($1,$2,$3,$4) on conflict (organization_id,user_id) do update set role_id=excluded.role_id, is_active=excluded.is_active returning id", [ctx.orgId, u.rows[0]!.id, d.role_id ?? null, d.is_active]);
    await ctx.tx.query("delete from erp.member_farms where member_id=$1", [m.rows[0]!.id]);
    for (const f of d.farm_ids) await ctx.tx.query("insert into erp.member_farms(member_id,farm_id) values ($1,$2) on conflict do nothing", [m.rows[0]!.id, f]);
    await ctx.tx.query("delete from erp.user_bosses where organization_id=$1 and user_id=$2", [ctx.orgId, u.rows[0]!.id]);
    for (const b of d.boss_user_ids) await ctx.tx.query("insert into erp.user_bosses(organization_id,user_id,boss_user_id) values ($1,$2,$3) on conflict do nothing", [ctx.orgId, u.rows[0]!.id, b]);
    await audit(ctx.tx, ctx, "users", u.rows[0]!.id, "create");
    return { id: u.rows[0]!.id, member_id: m.rows[0]!.id };
  })));
  app.put("/admin/members/:userId", async (req) => runService(app, req, "users.edit", async (ctx) => {
    const { userId } = req.params as { userId: string }; const d = memberSchema.partial().parse(req.body);
    const m = await ctx.tx.query<{ id: string; is_owner: boolean }>("select id, is_owner from erp.organization_members where organization_id=$1 and user_id=$2", [ctx.orgId, userId]);
    if (!m.rows[0]) throw notFound("Usuário");
    if (d.name || d.phone !== undefined || d.password) await ctx.tx.query("update erp.users set name=coalesce($2,name), phone=coalesce($3,phone), password_hash=coalesce($4,password_hash) where id=$1", [userId, d.name ?? null, d.phone ?? null, d.password ? await bcrypt.hash(d.password, 10) : null]);
    if (d.role_id !== undefined || d.is_active !== undefined) {
      if (m.rows[0].is_owner && d.is_active === false) throw validation("Proprietário não pode ser desativado");
      await ctx.tx.query("update erp.organization_members set role_id=coalesce($3,role_id), is_active=coalesce($4,is_active) where id=$1 and organization_id=$2", [m.rows[0].id, ctx.orgId, d.role_id ?? null, d.is_active ?? null]);
    }
    if (d.farm_ids) { await ctx.tx.query("delete from erp.member_farms where member_id=$1", [m.rows[0].id]); for (const f of d.farm_ids) await ctx.tx.query("insert into erp.member_farms(member_id,farm_id) values ($1,$2) on conflict do nothing", [m.rows[0].id, f]); }
    if (d.boss_user_ids) { await ctx.tx.query("delete from erp.user_bosses where organization_id=$1 and user_id=$2", [ctx.orgId, userId]); for (const b of d.boss_user_ids) await ctx.tx.query("insert into erp.user_bosses(organization_id,user_id,boss_user_id) values ($1,$2,$3) on conflict do nothing", [ctx.orgId, userId, b]); }
    await audit(ctx.tx, ctx, "users", userId, "update");
    return { id: userId };
  }));

  // ---------- Parametrizações do tenant ----------
  app.get("/admin/parameters", async (req) => runService(app, req, null, async (ctx) => (await ctx.tx.query("select parameters from erp.organizations where id=$1", [ctx.orgId])).rows[0]));
  app.put("/admin/parameters", async (req) => runService(app, req, "tenant_parameters.edit", async (ctx) => {
    const d = z.object({ calc_icms_desonerado: z.boolean().optional(), financial_freeze_scope: z.enum(["organization", "farm"]).optional() }).passthrough().parse(req.body);
    await ctx.tx.query("update erp.organizations set parameters = parameters || $2::jsonb where id=$1", [ctx.orgId, JSON.stringify(d)]);
    await audit(ctx.tx, ctx, "organizations", ctx.orgId, "update", d);
    return d;
  }));

  // ---------- Favoritos ----------
  app.put("/admin/favorites", async (req) => runService(app, req, null, async (ctx) => {
    const d = z.array(z.object({ route: z.string().min(1), label: z.string().min(1) })).max(30).parse(req.body);
    await ctx.tx.query("delete from erp.user_favorites where user_id=$1 and organization_id=$2", [ctx.user.id, ctx.orgId]);
    for (const [i, f] of d.entries()) await ctx.tx.query("insert into erp.user_favorites(user_id,organization_id,route,label,position) values ($1,$2,$3,$4,$5)", [ctx.user.id, ctx.orgId, f.route, f.label, i]);
    return d;
  }));

  // ---------- Notificações ----------
  app.get("/admin/notifications", async (req) => runService(app, req, null, async (ctx) => {
    const r = await ctx.tx.query("select id,kind,title,body,route,read_at,created_at from erp.notifications where organization_id=$1 and (user_id is null or user_id=$2) order by created_at desc limit 50", [ctx.orgId, ctx.user.id]);
    return { items: r.rows };
  }));
  app.post("/admin/notifications/read-all", async (req) => runService(app, req, null, async (ctx) => { await ctx.tx.query("update erp.notifications set read_at=now() where organization_id=$1 and (user_id is null or user_id=$2) and read_at is null", [ctx.orgId, ctx.user.id]); return { ok: true }; }));
  app.post("/admin/notifications/:id/read", async (req) => runService(app, req, null, async (ctx) => { await ctx.tx.query("update erp.notifications set read_at=now() where id=$1 and organization_id=$2", [(req.params as { id: string }).id, ctx.orgId]); return { ok: true }; }));
  /** Gera notificações derivadas do estado atual (compras pendentes, estoque mínimo, títulos vencendo, aniversariantes, documentos vencendo). Idempotente por dia. */
  app.post("/admin/notifications/refresh", async (req) => runService(app, req, null, async (ctx) => {
    const today = new Date().toISOString().slice(0, 10);
    const exists = async (kind: string, route: string) => (await ctx.tx.query("select 1 from erp.notifications where organization_id=$1 and kind=$2 and route=$3 and created_at::date=$4::date", [ctx.orgId, kind, route, today])).rowCount;
    const add = async (kind: string, title: string, body: string | null, route: string, userId: string | null = null) => { if (!(await exists(kind, route))) await ctx.tx.query("insert into erp.notifications(organization_id,user_id,kind,title,body,route) values ($1,$2,$3,$4,$5,$6)", [ctx.orgId, userId, kind, title, body, route]); };
    const pend = await ctx.tx.query<{ code: string; id: string; days: number; current_responsible_user_id: string | null }>("select code, id, extract(day from now()-status_changed_at)::int as days, current_responsible_user_id from erp.purchase_requests where organization_id=$1 and status not in ('finished','cancelled') and status_changed_at < now() - interval '3 days'", [ctx.orgId]);
    for (const p of pend.rows) await add("purchase_pending", `Compras nº ${p.code} pendente há ${p.days} dia(s)`, null, `/suprimentos/view/${p.id}`, p.current_responsible_user_id);
    const low = await ctx.tx.query<{ description: string; id: string }>("select p.description, p.id from erp.products p where p.organization_id=$1 and p.min_stock > 0 and coalesce((select sum(quantity) from erp.stock_balances sb where sb.product_id=p.id),0) <= p.min_stock and p.deleted_at is null", [ctx.orgId]);
    for (const l of low.rows) await add("stock_min", `Estoque mínimo atingido: ${l.description}`, null, `/estoque/saldo?product_id=${l.id}`);
    const due = await ctx.tx.query<{ n: string }>("select count(*) n from erp.financial_titles where organization_id=$1 and status in ('open','partially_paid') and due_date between current_date and current_date + 3", [ctx.orgId]);
    if (Number(due.rows[0]!.n) > 0) await add("title_due", `${due.rows[0]!.n} título(s) vencendo nos próximos 3 dias`, null, "/financeiro?tab=contas&sub=pagar&due_soon=1");
    const bday = await ctx.tx.query<{ name: string; birthday: string }>("select p.name, e.birthday from erp.employee_profiles e join erp.people p on p.id=e.person_id where p.organization_id=$1 and e.is_active and to_char(e.birthday,'MM-DD')=to_char(current_date,'MM-DD')", [ctx.orgId]);
    for (const b of bday.rows) await add("birthday", `${b.name} está fazendo aniversário hoje`, null, "/pessoas?tab=pessoas");
    const docs = await ctx.tx.query<{ title: string; id: string }>("select title, id from erp.documents where organization_id=$1 and status='active' and expiration_date between current_date and current_date + 15", [ctx.orgId]);
    for (const d of docs.rows) await add("document_expiring", `Documento vencendo: ${d.title}`, null, `/documentos/${d.id}`);
    return { ok: true };
  }));

  // ---------- Auditoria ----------
  app.get("/admin/audit", async (req) => runService(app, req, "audit_logs.view", async (ctx) => {
    const q = pageQuerySchema.parse(req.query); const f = req.query as Record<string, string>;
    const where = ["organization_id=$1"]; const params: unknown[] = [ctx.orgId];
    if (f.entity) { params.push(f.entity); where.push(`entity=$${params.length}`); }
    if (f.entity_id) { params.push(f.entity_id); where.push(`entity_id=$${params.length}`); }
    if (f.user_id) { params.push(f.user_id); where.push(`user_id=$${params.length}`); }
    if (f.created_at_from) { params.push(f.created_at_from); where.push(`created_at >= $${params.length}`); }
    if (f.created_at_to) { params.push(f.created_at_to); where.push(`created_at < ($${params.length}::date + 1)`); }
    const total = await ctx.tx.query<{ n: string }>(`select count(*) n from erp.audit_logs where ${where.join(" and ")}`, params);
    const r = await ctx.tx.query(`select a.id,a.entity,a.entity_id,a.action,a.before,a.after,a.metadata,a.ip,a.created_at,u.name as user_name from erp.audit_logs a left join erp.users u on u.id=a.user_id where ${where.join(" and ")} order by a.id desc limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`, params);
    return { items: r.rows, total: Number(total.rows[0]!.n), page: q.page, pageSize: q.pageSize };
  }));

  // ---------- Perfil do usuário ----------
  app.put("/admin/profile", async (req) => runService(app, req, null, async (ctx) => {
    const d = z.object({ name: z.string().min(1).optional(), phone: z.string().optional().nullable(), password: z.string().min(8).optional(), current_password: z.string().optional() }).parse(req.body);
    if (d.password) {
      if (app.config.AUTH_MODE === "local") {
        const u = await ctx.tx.query<{ password_hash: string | null }>("select password_hash from erp.users where id=$1", [ctx.user.id]);
        if (!d.current_password || !u.rows[0]?.password_hash || !(await bcrypt.compare(d.current_password, u.rows[0].password_hash))) throw denied("senha atual inválida");
        await ctx.tx.query("update erp.users set password_hash=$2 where id=$1", [ctx.user.id, await bcrypt.hash(d.password, 10)]);
      } else throw validation("Troca de senha é feita pelo Supabase Auth");
    }
    await ctx.tx.query("update erp.users set name=coalesce($2,name), phone=coalesce($3,phone) where id=$1", [ctx.user.id, d.name ?? null, d.phone ?? null]);
    return { ok: true, can: hasPermission(ctx, "users.view") };
  }));
}
