import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { DomainError } from "@agro/shared";
import { withTx, type Db } from "@agro/db";
import { AUTORIZACAO_PROPRIETARIO, autorizacaoPorModulo } from "@erp/plataforma";
import type { Config } from "../config.js";
import type { AuthUser, Membership, RequestContext } from "../lib/context.js";

declare module "fastify" {
  interface FastifyRequest { auth?: AuthUser; ctx?: RequestContext }
  interface FastifyInstance { db: Db; config: Config; issueLocalToken(user: AuthUser): Promise<string>; requireCtx(req: FastifyRequest): RequestContext; /** invalida o cache de contexto (perfil/permissões/fazendas) desta instância */ clearContextCache(): void }
}

const localSecret = (c: Config) => new TextEncoder().encode(c.LOCAL_AUTH_SECRET);

export async function verifyLocalPassword(db: Db, email: string, password: string): Promise<AuthUser | null> {
  const r = await db.query<{ id: string; email: string; name: string; password_hash: string | null; is_active: boolean }>("select id,email,name,password_hash,is_active from erp.users where email=$1", [email]);
  const u = r.rows[0];
  if (!u || !u.is_active || !u.password_hash) return null;
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return null;
  await db.query("update erp.users set last_login_at=now() where id=$1", [u.id]);
  return { id: u.id, email: u.email, name: u.name };
}

export default fp(async function authPlugin(app: FastifyInstance) {
  const cfg = app.config;
  app.decorate("issueLocalToken", async (user: AuthUser) =>
    new SignJWT({ email: user.email, name: user.name }).setProtectedHeader({ alg: "HS256" }).setSubject(user.id).setIssuedAt().setExpirationTime("12h").sign(localSecret(cfg)));

  app.decorate("requireCtx", (req: FastifyRequest) => {
    if (!req.auth) throw new DomainError("UNAUTHENTICATED", "Autenticação necessária");
    // Autenticado mas sem organização selecionada: erro de validação (422), não de sessão (401),
    // para que o cliente não encerre a sessão por uma chamada feita antes de escolher a organização.
    if (!req.ctx) throw new DomainError("VALIDATION_ERROR", "Cabeçalho X-Org-Id obrigatório: selecione a organização");
    return req.ctx;
  });

  app.addHook("onRequest", async (req) => {
    const h = req.headers.authorization;
    if (!h?.startsWith("Bearer ")) return;
    const token = h.slice(7);
    try {
      if (cfg.AUTH_MODE === "supabase") {
        const { payload } = await jwtVerify(token, new TextEncoder().encode(cfg.SUPABASE_JWT_SECRET!), { algorithms: ["HS256"] });
        const authId = payload.sub!;
        const email = (payload.email as string | undefined) ?? "";
        // Vincula/cria usuário ERP para o auth.uid()
        const r = await app.db.query<{ id: string; email: string; name: string }>(
          "insert into erp.users(auth_user_id,email,name) values ($1,$2,$3) on conflict (email) do update set auth_user_id=coalesce(erp.users.auth_user_id,excluded.auth_user_id), last_login_at=now() returning id,email,name",
          [authId, email, (payload.user_metadata as { name?: string } | undefined)?.name ?? email]);
        req.auth = r.rows[0]!;
      } else {
        const { payload } = await jwtVerify(token, localSecret(cfg), { algorithms: ["HS256"] });
        req.auth = { id: payload.sub!, email: payload.email as string, name: payload.name as string };
      }
    } catch {
      throw new DomainError("UNAUTHENTICATED", "Token inválido ou expirado");
    }
  });

  // Vínculo/permissões/escopos em cache por (usuário, organização) por 30 s: evita várias idas ao banco em
  // toda requisição (o banco fica em outra região). Alterações de perfil/vínculo passam a valer em até 30 s
  // nesta instância; a administração chama clearContextCache() e a mudança é imediata onde ela ocorre.
  type MemberRow = { organization_id: string; org_name: string; role_id: string | null; is_owner: boolean; member_id: string };
  type EscopoRow = { modulo: string; modo: string };
  const ctxCache = new Map<string, { at: number; value: { row: MemberRow; escopos: EscopoRow[]; perms: string[] } }>();
  const CTX_TTL_MS = 30_000;
  app.decorate("clearContextCache", () => ctxCache.clear());
  // Contexto de tenant: cabeçalhos X-Org-Id (obrigatório nas rotas de negócio) e X-Farm-Id (empresa ativa)
  app.addHook("preHandler", async (req) => {
    if (!req.auth) return;
    const orgId = (req.headers["x-org-id"] as string | undefined) ?? null;
    if (!orgId) return;
    const userId = req.auth.id;
    const cacheKey = `${userId}:${orgId}`; const cached = ctxCache.get(cacheKey);
    const { row, escopos, perms } = cached && Date.now() - cached.at < CTX_TTL_MS ? cached.value : await withTx(app.db, { orgId, userId }, async (tx) => {
      const m = await tx.query<MemberRow>(
        "select m.id as member_id, m.organization_id, o.name as org_name, m.role_id, m.is_owner from erp.organization_members m join erp.organizations o on o.id=m.organization_id where m.user_id=$1 and m.organization_id=$2 and m.is_active and o.deleted_at is null",
        [userId, orgId]);
      const row = m.rows[0];
      if (!row) throw new DomainError("PERMISSION_DENIED", "Usuário não é membro desta organização");
      // Só os MODOS por módulo — nunca a lista de empresas (podem ser centenas; o conjunto é resolvido no SQL).
      // `erp.member_farms` não é mais consultada aqui: a autoridade é o escopo por módulo (PRE-BASE2-02).
      const escopos = row.is_owner ? [] : (await tx.query<EscopoRow>(
        "select modulo, modo from erp.membro_escopos_empresa where organization_id=$1 and membro_id=$2", [orgId, row.member_id])).rows;
      const perms = row.is_owner ? [] : (await tx.query<{ permission_key: string }>("select permission_key from erp.role_permissions where role_id=$1", [row.role_id])).rows.map((r) => r.permission_key);
      return { row, escopos, perms };
    });
    if (!cached || Date.now() - cached.at >= CTX_TTL_MS) ctxCache.set(cacheKey, { at: Date.now(), value: { row, escopos, perms } });
    const membership: Membership = {
      orgId: row.organization_id, orgName: row.org_name, roleId: row.role_id, isOwner: row.is_owner,
      memberId: row.member_id,
      escopos: row.is_owner ? AUTORIZACAO_PROPRIETARIO : autorizacaoPorModulo(escopos.map((e) => [e.modulo, e.modo === "todas" ? "todas" : "selecionadas"] as const))
    };
    // X-Farm-Id é SELEÇÃO de trabalho, não autorização — e a autorização agora varia por módulo, então a
    // validação acontece na porta (runService conhece o módulo), não aqui. O que se exige neste ponto é o
    // mínimo verificável sem módulo: a empresa selecionada existe nesta organização e não está excluída.
    const farmId = (req.headers["x-farm-id"] as string | undefined) ?? null;
    if (farmId) {
      // dentro do contexto de tenant: a consulta passa pelo RLS como qualquer outra leitura da aplicação
      const f = await withTx(app.db, { orgId, userId }, (tx) => tx.query<{ ok: boolean }>(
        "select exists (select 1 from erp.farms where id=$1 and organization_id=$2 and deleted_at is null) ok", [farmId, orgId]));
      if (!f.rows[0]?.ok) throw new DomainError("PERMISSION_DENIED", "Sem acesso à empresa selecionada");
    }
    req.ctx = { user: req.auth, orgId, farmId, membership, permissions: new Set(perms), ip: req.ip };
  });
});
