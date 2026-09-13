import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DomainError } from "@agro/shared";
import { verifyLocalPassword } from "../plugins/auth.js";
import { hasPermission } from "../lib/context.js";
import { visibilidadeNotificacaoSql } from "../lib/notificacao.js";
import { empresasVisiveisNaOrganizacao } from "../lib/empresa.js";
import { allPermissionKeys } from "@agro/domain";
import { resolverIdioma } from "@erp/plataforma";
import { withTx } from "@agro/db";
import { runService } from "../lib/service.js";

export default async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", { config: { rateLimit: { max: app.config.LOGIN_RATE_LIMIT_MAX, timeWindow: "1 minute" } } }, async (req) => {
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
    // Empresas que o usuário enxerga em ALGUM módulo (é o seletor de contexto de trabalho; a autorização
    // efetiva de cada tela continua sendo a do módulo daquela tela).
    const visibleFarms = await empresasVisiveisNaOrganizacao(ctx);
    const fav = await ctx.tx.query("select route,label,position from erp.user_favorites where user_id=$1 and organization_id=$2 order by position", [ctx.user.id, ctx.orgId]);
    const org = await ctx.tx.query<{ name: string; parameters: unknown; idioma_padrao: string }>("select name, parameters, idioma_padrao from erp.organizations where id=$1", [ctx.orgId]);
    const idiomaUsuario = await ctx.tx.query<{ idioma: string | null }>("select idioma from erp.users where id=$1", [ctx.user.id]);
    const perms = ctx.membership.isOwner ? allPermissionKeys() : [...ctx.permissions];
    // O badge usa EXATAMENTE a mesma autoridade da listagem: contador e caixa divergirem é como o usuário
    // acaba com "3 não lidas" e uma caixa com uma linha — ou com o número de avisos que não pode ver.
    const pn: unknown[] = [];
    const visivelN = visibilidadeNotificacaoSql(ctx, "n", pn);
    const usuarioN = `$${pn.push(ctx.user.id)}`;
    const unread = await ctx.tx.query<{ n: string }>(
      `select count(*) n from erp.notifications n
        where ${visivelN}
          and not exists (select 1 from erp.notificacao_leituras l
                           where l.organization_id = n.organization_id and l.notificacao_id = n.id and l.usuario_id = ${usuarioN})`, pn);
    const idioma = { organizacao: org.rows[0]?.idioma_padrao ?? null, usuario: idiomaUsuario.rows[0]?.idioma ?? null, efetivo: resolverIdioma({ usuario: idiomaUsuario.rows[0]?.idioma ?? null, organizacao: org.rows[0]?.idioma_padrao ?? null }) };
    // `farms` é a lista de EMPRESAS visíveis (docs/MULTI-COMPANY-CONTRACT.md); o nome do campo migra em PRE-BASE2-03.
    return { user: ctx.user, organization: { id: ctx.orgId, name: org.rows[0]?.name, parameters: org.rows[0]?.parameters ?? {} }, isOwner: ctx.membership.isOwner, farms: visibleFarms, permissions: perms, favorites: fav.rows, unreadNotifications: Number(unread.rows[0]?.n ?? 0), canViewUsers: hasPermission(ctx, "users.view"), idioma };
  }));
}
