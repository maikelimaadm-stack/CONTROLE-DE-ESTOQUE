import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DomainError } from "@agro/shared";
import { verifyLocalPassword } from "../plugins/auth.js";
import { hasPermission } from "../lib/context.js";
import { allPermissionKeys } from "@agro/domain";
import { withTx } from "@agro/db";
import { runService } from "../lib/service.js";

export default async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    if (app.config.AUTH_MODE !== "local") throw new DomainError("VALIDATION_ERROR", "Login local desabilitado: use Supabase Auth");
    const { email, password } = z.object({ email: z.string().email(), password: z.string().min(6) }).parse(req.body);
    const user = await verifyLocalPassword(app.db, email.toLowerCase(), password);
    if (!user) throw new DomainError("UNAUTHENTICATED", "E-mail ou senha inválidos");
    await app.db.query("insert into erp.audit_logs(user_id,entity,entity_id,action,ip) values ($1::uuid,'users',$1::text,'login',$2)", [user.id, req.ip]);
    return { token: await app.issueLocalToken(user), user };
  });

  // Organizações do usuário autenticado (para seleção de contexto)
  app.get("/auth/me", async (req) => {
    if (!req.auth) throw new DomainError("UNAUTHENTICATED", "Autenticação necessária");
    const uid = req.auth.id;
    const orgs = await withTx(app.db, { orgId: null, userId: uid }, (tx) => tx.query<{ id: string; name: string; is_owner: boolean; role_name: string | null }>(
      "select m.organization_id as id, (select name from erp.organizations o where o.id=m.organization_id) as name, m.is_owner, (select name from erp.roles r where r.id=m.role_id) as role_name from erp.organization_members m where m.user_id=$1 and m.is_active order by 2", [uid]));
    return { user: req.auth, organizations: orgs.rows };
  });

  // Contexto completo da organização selecionada: fazendas, permissões, favoritos, parâmetros
  app.get("/auth/context", async (req) => runService(app, req, null, async (ctx) => {
    const farms = await ctx.tx.query("select id, code, name from erp.farms where organization_id=$1 and deleted_at is null and is_active order by code", [ctx.orgId]);
    const visibleFarms = farms.rows.filter((f) => ctx.membership.farmIds.length === 0 || ctx.membership.farmIds.includes((f as { id: string }).id));
    const fav = await ctx.tx.query("select route,label,position from erp.user_favorites where user_id=$1 and organization_id=$2 order by position", [ctx.user.id, ctx.orgId]);
    const org = await ctx.tx.query<{ name: string; parameters: unknown }>("select name, parameters from erp.organizations where id=$1", [ctx.orgId]);
    const perms = ctx.membership.isOwner ? allPermissionKeys() : [...ctx.permissions];
    const unread = await ctx.tx.query<{ n: string }>("select count(*) n from erp.notifications where organization_id=$1 and (user_id is null or user_id=$2) and read_at is null", [ctx.orgId, ctx.user.id]);
    return { user: ctx.user, organization: { id: ctx.orgId, name: org.rows[0]?.name, parameters: org.rows[0]?.parameters ?? {} }, isOwner: ctx.membership.isOwner, farms: visibleFarms, permissions: perms, favorites: fav.rows, unreadNotifications: Number(unread.rows[0]?.n ?? 0), canViewUsers: hasPermission(ctx, "users.view") };
  }));
}
