import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { DomainError } from "@agro/shared";
import { withTx, type Db } from "@agro/db";
import type { Config } from "../config.js";
import type { AuthUser, Membership, RequestContext } from "../lib/context.js";
import { lerDadosDoMembro, vinculoDoMembro, type DadosDoMembro } from "../lib/contexto-membro.js";
import { resolverEmpresaSelecionada } from "../lib/empresa-header.js";

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
  // A LEITURA do vínculo mora em `lib/contexto-membro.ts` (o executor da fila satelital lê o mesmo, SAT-03); o cache é daqui.
  const ctxCache = new Map<string, { at: number; value: DadosDoMembro }>();
  const CTX_TTL_MS = 30_000;
  app.decorate("clearContextCache", () => ctxCache.clear());
  // Contexto de tenant: X-Org-Id (obrigatório nas rotas de negócio) e X-Empresa-Id (empresa ativa — o
  // cabeçalho anterior é RECUSADO desde PRE-BASE2-05B; ver lib/empresa-header.ts)
  app.addHook("preHandler", async (req) => {
    if (!req.auth) return;
    const orgId = (req.headers["x-org-id"] as string | undefined) ?? null;
    if (!orgId) return;
    const userId = req.auth.id;
    const cacheKey = `${userId}:${orgId}`; const cached = ctxCache.get(cacheKey);
    const dados = cached && Date.now() - cached.at < CTX_TTL_MS ? cached.value : await withTx(app.db, { orgId, userId }, async (tx) => {
      const lidos = await lerDadosDoMembro(tx, orgId, userId);
      if (!lidos) throw new DomainError("PERMISSION_DENIED", "Usuário não é membro desta organização");
      return lidos;
    });
    if (!cached || Date.now() - cached.at >= CTX_TTL_MS) ctxCache.set(cacheKey, { at: Date.now(), value: dados });
    const { perms } = dados;
    const membership: Membership = vinculoDoMembro(dados);
    // X-Empresa-Id é SELEÇÃO de trabalho, não autorização — e a autorização por MÓDULO é validada na porta
    // (runService conhece o módulo), não aqui. O que se exige neste ponto é que a empresa selecionada seja
    // uma das que este membro enxerga em ALGUM módulo: é exatamente o conjunto que alimenta o seletor de
    // empresa (empresasVisiveisNaOrganizacao). Validar apenas "existe na organização" transformava o
    // cabeçalho em oráculo — 200 para empresa viva, 403 para o resto — e respondia sobre a existência de
    // empresas que o usuário não enxerga. Uma resposta só para os dois casos: não distingue "não existe"
    // de "existe e não é sua".
    // RECUSA antes do banco o que é erro do cliente: cabeçalho anterior e identificador malformado.
    // Malformado seguia até o PostgreSQL e voltava como "invalid input syntax for uuid" dentro de um 500 —
    // erro de servidor para o que é erro de requisição.
    const empresaId = resolverEmpresaSelecionada(req.headers as Record<string, unknown>);
    if (empresaId) {
      // dentro do contexto de tenant: a consulta passa pelo RLS como qualquer outra leitura da aplicação
      const f = await withTx(app.db, { orgId, userId }, (tx) => tx.query<{ ok: boolean }>(
        `select exists (
           select 1 from erp.empresas f
            where f.id=$1 and f.organization_id=$2 and f.deleted_at is null
              and ($4::boolean or exists (
                select 1 from erp.membro_escopos_empresa e
                 where e.organization_id=$2 and e.membro_id=$3
                   and (e.modo='todas' or exists (
                     select 1 from erp.membro_empresas me
                      where me.organization_id=$2 and me.membro_id=$3 and me.modulo=e.modulo and me.empresa_id=f.id))))
         ) ok`, [empresaId, orgId, membership.memberId, membership.isOwner]));
      if (!f.rows[0]?.ok) throw new DomainError("PERMISSION_DENIED", "Sem acesso à empresa selecionada");
    }
    req.ctx = { user: req.auth, orgId, empresaId, membership, permissions: new Set(perms), ip: req.ip };
  });
});
