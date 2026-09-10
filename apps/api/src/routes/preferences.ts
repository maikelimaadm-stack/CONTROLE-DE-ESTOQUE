import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getResource } from "@agro/domain";
import { normalizeListPreferences, normalizeFormLayout, preferencesByteSize, PREFERENCES_MAX_BYTES, filterKindOf, type FilterKind } from "@agro/shared";
import { runService } from "../lib/service.js";
import { DomainError, validation } from "../lib/errors.js";
import { hasPermission, type ServiceCtx } from "../lib/context.js";

/**
 * Preferências de tela ("modelo base"): um documento JSON por (organização, usuário, módulo, tela).
 * Escopo `user` = do próprio usuário; `org` = padrão da organização (exige permissão screen_layouts.edit ou owner).
 * Precedência na leitura: usuário > organização > padrão do código (aplicada no cliente).
 * Concorrência: `revision` incrementada no servidor; PUT/PATCH com `expectedRevision` divergente → 409 com o estado atual.
 */
const scopeSchema = z.enum(["user", "org"]).default("user");
const keySchema = z.object({ module: z.string().regex(/^[a-z0-9_.-]{1,64}$/), screen: z.string().regex(/^[a-z0-9_.-]{1,64}$/) });
const putSchema = z.object({ preferences: z.record(z.string(), z.unknown()), expectedRevision: z.number().int().optional() });
const patchSchema = z.object({ section: z.string().regex(/^[a-zA-Z]{1,40}$/), patch: z.record(z.string(), z.unknown()), expectedRevision: z.number().int().optional() });

interface Row { id: string; user_id: string | null; module: string; screen: string; schema_version: number; preferences: Record<string, unknown>; revision: number; updated_at: string }
const pub = (r: Row) => ({ scope: r.user_id ? "user" : "org", module: r.module, screen: r.screen, schemaVersion: r.schema_version, preferences: r.preferences, revision: r.revision, updatedAt: r.updated_at });

/** Validação por tipo de tela. Módulos que são recursos declarativos validam contra a definição (colunas/campos conhecidos). */
export function validatePreferences(module: string, screen: string, doc: unknown): Record<string, unknown> {
  if (preferencesByteSize(doc) > PREFERENCES_MAX_BYTES) throw validation("Preferências excedem o tamanho máximo (256 KB)");
  const def = getResource(module);
  if (screen === "list") {
    const known = def ? { columns: def.fields.map((f) => f.name), filters: def.fields.filter((f) => f.filter || f.search).map((f) => f.name), filterKinds: Object.fromEntries(def.fields.map((f) => [f.name, filterKindOf(f.type) as FilterKind])) } : {};
    return normalizeListPreferences(doc, known) as unknown as Record<string, unknown>;
  }
  if (screen === "form") {
    if (!def) throw validation("Layout de formulário só é suportado para cadastros declarativos");
    const { layout } = normalizeFormLayout(doc, def.fields.map((f) => ({ id: f.name, label: f.label, section: f.section, span: f.span, required: f.required, readOnly: f.readOnly })));
    return layout as unknown as Record<string, unknown>;
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) throw validation("Preferências devem ser um objeto");
  return doc as Record<string, unknown>;
}

function assertScope(ctx: ServiceCtx, scope: "user" | "org") {
  if (scope === "org" && !hasPermission(ctx, "screen_layouts.edit")) throw new DomainError("PERMISSION_DENIED", "Sem permissão para definir o padrão da organização");
}
const userCond = (scope: "user" | "org", ctx: ServiceCtx, b: unknown[]) => scope === "user" ? `user_id = $${b.push(ctx.user.id)}` : "user_id is null";

async function current(ctx: ServiceCtx, scope: "user" | "org", module: string, screen: string, lock = false): Promise<Row | null> {
  const p: unknown[] = [ctx.orgId, module, screen];
  const r = await ctx.tx.query<Row>(`select id, user_id, module, screen, schema_version, preferences, revision, updated_at from erp.user_screen_preferences where organization_id=$1 and module=$2 and screen=$3 and ${userCond(scope, ctx, p)} ${lock ? "for update" : ""}`, p);
  return r.rows[0] ?? null;
}

async function upsert(ctx: ServiceCtx, scope: "user" | "org", module: string, screen: string, next: Record<string, unknown>, expectedRevision?: number) {
  const cur = await current(ctx, scope, module, screen, true);
  if (cur && expectedRevision !== undefined && expectedRevision !== cur.revision) throw new DomainError("CONFLICT", "Preferência foi alterada em outra aba/sessão", { current: pub(cur) });
  const revision = (cur?.revision ?? 0) + 1;
  const doc = { ...next, meta: { revision, updatedAt: new Date().toISOString() } };
  if (cur) { await ctx.tx.query("update erp.user_screen_preferences set preferences=$1, revision=$2 where id=$3", [JSON.stringify(doc), revision, cur.id]); }
  else await ctx.tx.query("insert into erp.user_screen_preferences(organization_id,user_id,module,screen,preferences,revision) values ($1,$2,$3,$4,$5,$6)", [ctx.orgId, scope === "user" ? ctx.user.id : null, module, screen, JSON.stringify(doc), revision]);
  return pub((await current(ctx, scope, module, screen))!);
}

export default async function preferenceRoutes(app: FastifyInstance) {
  app.get("/preferences/bootstrap", async (req) => runService(app, req, null, async (ctx) => {
    const r = await ctx.tx.query<Row>("select id, user_id, module, screen, schema_version, preferences, revision, updated_at from erp.user_screen_preferences where organization_id=$1 and (user_id=$2 or user_id is null) order by module, screen", [ctx.orgId, ctx.user.id]);
    return { items: r.rows.map(pub) };
  }));
  app.get("/preferences/:module/:screen", async (req) => { const { module, screen } = keySchema.parse(req.params); return runService(app, req, null, async (ctx) => ({ user: (await current(ctx, "user", module, screen).then((r) => r && pub(r))) ?? null, org: (await current(ctx, "org", module, screen).then((r) => r && pub(r))) ?? null, canEditOrg: hasPermission(ctx, "screen_layouts.edit") })); });
  app.put("/preferences/:module/:screen", async (req) => {
    const { module, screen } = keySchema.parse(req.params); const scope = scopeSchema.parse((req.query as { scope?: string }).scope); const body = putSchema.parse(req.body);
    return runService(app, req, null, async (ctx) => { assertScope(ctx, scope); return upsert(ctx, scope, module, screen, validatePreferences(module, screen, body.preferences), body.expectedRevision); });
  });
  app.patch("/preferences/:module/:screen", async (req) => {
    const { module, screen } = keySchema.parse(req.params); const scope = scopeSchema.parse((req.query as { scope?: string }).scope); const body = patchSchema.parse(req.body);
    return runService(app, req, null, async (ctx) => {
      assertScope(ctx, scope);
      const cur = await current(ctx, scope, module, screen);
      const base = cur?.preferences ?? {}; const sec = (base[body.section] ?? {}) as Record<string, unknown>;
      return upsert(ctx, scope, module, screen, validatePreferences(module, screen, { ...base, [body.section]: { ...sec, ...body.patch } }), body.expectedRevision ?? cur?.revision);
    });
  });
  app.delete("/preferences/:module/:screen", async (req) => {
    const { module, screen } = keySchema.parse(req.params); const scope = scopeSchema.parse((req.query as { scope?: string }).scope);
    return runService(app, req, null, async (ctx) => { assertScope(ctx, scope); const p: unknown[] = [ctx.orgId, module, screen]; const r = await ctx.tx.query(`delete from erp.user_screen_preferences where organization_id=$1 and module=$2 and screen=$3 and ${userCond(scope, ctx, p)}`, p); return { deleted: r.rowCount ?? 0 }; });
  });
}
