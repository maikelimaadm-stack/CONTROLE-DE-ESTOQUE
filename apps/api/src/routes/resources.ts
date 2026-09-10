import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getResource, RESOURCES, type FieldDef, type ResourceDef } from "@agro/domain";
import { isISODate, parseFilterKey, filterKindOf, isValidOperator, decodeRange, relativeDateRange } from "@agro/shared";
import { ident, SqlBuilder } from "../lib/sql.js";
import { pageQuerySchema, extractFilters } from "../lib/pagination.js";
import { runService, nextCode, requirePermission } from "../lib/service.js";
import { notFound, validation } from "../lib/errors.js";
import { farmAllowed, hasPermission, type ServiceCtx } from "../lib/context.js";

/** Constrói o schema zod de um recurso a partir da definição declarativa. */
export function buildSchema(def: ResourceDef, partial = false) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of def.fields) {
    if (f.readOnly) continue;
    let t: z.ZodTypeAny;
    switch (f.type) {
      case "text": case "textarea": t = z.string().max(f.maxLength ?? 4000); break;
      case "email": t = z.string().email().max(200); break;
      case "number": case "money": case "quantity": case "percent": t = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)]).transform(String); break;
      case "integer": t = z.coerce.number().int(); if (f.min !== undefined) t = (t as z.ZodNumber).min(f.min); if (f.max !== undefined) t = (t as z.ZodNumber).max(f.max); break;
      case "date": t = z.string().refine(isISODate, "Data inválida (use AAAA-MM-DD)"); break;
      case "boolean": t = z.coerce.boolean(); break;
      case "select": t = z.enum(f.options!.map((o) => o.value) as [string, ...string[]]); break;
      case "ref": t = z.string().uuid(); break;
      case "json": t = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]); break;
      case "tags": t = z.array(z.string()); break;
      default: t = z.unknown();
    }
    if (f.name === "city_id") t = z.coerce.number().int();
    if (f.type === "boolean") { shape[f.name] = partial ? t.optional() : t.optional().default(Boolean(f.default ?? false)); continue; }
    shape[f.name] = f.required && !partial ? t : t.nullable().optional();
  }
  return z.object(shape).strict();
}

function listColumns(def: ResourceDef): string[] {
  const cols = new Set<string>(["id", "organization_id", ...def.fields.map((f) => f.name)]);
  cols.add("created_at"); cols.add("updated_at");
  if (def.softDelete) cols.add("deleted_at");
  return [...cols];
}

async function checkColumns(ctx: ServiceCtx, def: ResourceDef): Promise<Set<string>> {
  const r = await ctx.tx.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema='erp' and table_name=$1", [def.table]);
  return new Set(r.rows.map((x) => x.column_name));
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
/**
 * Filtro avançado `campo__operador=valor` (ver @agro/shared/preferences). O nome da coluna vem SEMPRE da definição
 * declarativa (nunca do cliente) e os valores são parametrizados; operador desconhecido é ignorado.
 */
export function advancedClause(f: FieldDef, op: string, raw: string, b: SqlBuilder): string | null {
  const kind = filterKindOf(f.type);
  if (!isValidOperator(kind, op)) return null;
  const col = ident(f.name);
  if (op === "is_empty") return kind === "text" ? `(${col} is null or ${col}::text = '')` : `${col} is null`;
  if (op === "is_not_empty") return kind === "text" ? `(${col} is not null and ${col}::text <> '')` : `${col} is not null`;
  if (kind === "text") {
    const v = escapeLike(raw);
    switch (op) {
      case "contains": return `${col}::text ilike ${b.add(`%${v}%`)}`;
      case "not_contains": return `(${col} is null or ${col}::text not ilike ${b.add(`%${v}%`)})`;
      case "starts_with": return `${col}::text ilike ${b.add(`${v}%`)}`;
      case "ends_with": return `${col}::text ilike ${b.add(`%${v}`)}`;
      default: return `${col}::text = ${b.add(raw)}`;
    }
  }
  if (kind === "number") {
    const n = (s: string) => { if (!/^-?\d+(\.\d+)?$/.test(s.trim())) throw validation(`Valor numérico inválido no filtro ${f.label}`); return s.trim(); };
    if (op === "between") { const [a, c] = decodeRange(raw); return `${col} between ${b.add(n(a))} and ${b.add(n(c))}`; }
    const cmp: Record<string, string> = { eq: "=", ne: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };
    return `${col} ${cmp[op] ?? "="} ${b.add(n(raw))}`;
  }
  if (kind === "date") {
    const d = (s: string) => { if (!isISODate(s)) throw validation(`Data inválida no filtro ${f.label} (use AAAA-MM-DD)`); return s; };
    const rel = relativeDateRange(op, new Date().toISOString().slice(0, 10));
    if (rel) return `${col} between ${b.add(rel[0])} and ${b.add(rel[1])}`;
    if (op === "between") { const [a, c] = decodeRange(raw); return `${col} between ${b.add(d(a))} and ${b.add(d(c))}`; }
    if (op === "before") return `${col} < ${b.add(d(raw))}`;
    if (op === "after") return `${col} > ${b.add(d(raw))}`;
    return `${col} = ${b.add(d(raw))}`;
  }
  if (kind === "boolean") return `${col} = ${b.add(raw === "true")}`;
  if (f.type === "tags") return op === "ne" ? `not (${b.add(raw)} = any(${col}))` : `${b.add(raw)} = any(${col})`;
  return op === "ne" ? `(${col} is null or ${col} <> ${b.add(raw)})` : `${col} = ${b.add(raw)}`;
}

export async function listResource(ctx: ServiceCtx, def: ResourceDef, query: Record<string, unknown>) {
  const q = pageQuerySchema.parse(query);
  const filters = extractFilters(q as Record<string, unknown>);
  const existing = await checkColumns(ctx, def);
  const cols = listColumns(def).filter((c) => existing.has(c));
  const b = new SqlBuilder();
  const where: string[] = [];
  if (existing.has("organization_id")) where.push(def.reference || def.sharedDefaults ? `(organization_id is null or organization_id = ${b.add(ctx.orgId)})` : `organization_id = ${b.add(ctx.orgId)}`);
  if (def.softDelete) where.push("deleted_at is null");
  if (def.farmScoped && ctx.farmId && existing.has("farm_id") && !filters["farm_id"]) where.push(`farm_id = ${b.add(ctx.farmId)}`);
  if (def.farmScoped && ctx.membership.farmIds.length && existing.has("farm_id")) where.push(`farm_id = any(${b.add(ctx.membership.farmIds)}::uuid[])`);
  if (q.search) {
    const sf = def.fields.filter((f) => f.search).map((f) => f.name);
    if (sf.length) { const p = b.add(`%${q.search}%`); where.push("(" + sf.map((c) => `${ident(c)}::text ilike ${p}`).join(" or ") + ")"); }
  }
  for (const [k, v] of Object.entries(filters)) {
    const adv = parseFilterKey(k);
    if (adv) { const f = def.fields.find((x) => x.name === adv.field); if (f && existing.has(adv.field) && !Array.isArray(v)) { const clause = advancedClause(f, adv.op, v, b); if (clause) where.push(clause); } continue; }
    const f = def.fields.find((x) => x.name === k);
    if (f && existing.has(k)) {
      if (Array.isArray(v)) where.push(`${ident(k)} = any(${b.add(v)})`);
      else if (f.type === "boolean") where.push(`${ident(k)} = ${b.add(v === "true")}`);
      else if (f.type === "date") where.push(`${ident(k)} = ${b.add(v)}`);
      else where.push(`${ident(k)} = ${b.add(v)}`);
    } else if (/^(.+)_(from|to)$/.test(k)) {
      const m = /^(.+)_(from|to)$/.exec(k)!; const col = m[1]!;
      if (existing.has(col)) where.push(`${ident(col)} ${m[2] === "from" ? ">=" : "<="} ${b.add(v)}`);
    }
  }
  const sortCol = q.sort && existing.has(q.sort) ? q.sort : (def.defaultSort && existing.has(def.defaultSort) ? def.defaultSort : (existing.has("created_at") ? "created_at" : "id"));
  const dir = q.dir ?? (sortCol === "created_at" ? "desc" : "asc");
  const wsql = where.length ? "where " + where.join(" and ") : "";
  const total = await ctx.tx.query<{ n: string }>(`select count(*) as n from erp.${ident(def.table)} ${wsql}`, b.params);
  const offset = (q.page - 1) * q.pageSize;
  const rows = await ctx.tx.query(`select ${cols.map(ident).join(",")} from erp.${ident(def.table)} ${wsql} order by ${ident(sortCol)} ${dir} nulls last, id limit ${q.pageSize} offset ${offset}`, b.params);
  // resolve rótulos de referências (evita N+1: uma query por recurso referenciado)
  const refs = def.fields.filter((f) => f.type === "ref" && f.ref);
  const labels: Record<string, Record<string, string>> = {};
  for (const f of refs) {
    const rdef = getResource(f.ref!.resource); if (!rdef) continue;
    const ids = [...new Set(rows.rows.map((r) => (r as Record<string, unknown>)[f.name]).filter(Boolean))] as string[];
    if (!ids.length) continue;
    const lr = await ctx.tx.query<{ id: string; label: string }>(`select id, ${ident(rdef.labelField)}::text as label from erp.${ident(rdef.table)} where id = any($1::uuid[])`, [ids]);
    labels[f.name] = Object.fromEntries(lr.rows.map((r) => [r.id, r.label]));
  }
  const items = rows.rows.map((r) => { const o = { ...(r as Record<string, unknown>) } as Record<string, unknown>; for (const f of refs) { const v = o[f.name] as string | null; o[`${f.name}_label`] = v ? labels[f.name]?.[v] ?? null : null; } return o; });
  return { items, page: q.page, pageSize: q.pageSize, total: Number(total.rows[0]!.n) };
}

export async function getOne(ctx: ServiceCtx, def: ResourceDef, id: string) {
  const existing = await checkColumns(ctx, def);
  const cols = listColumns(def).filter((c) => existing.has(c));
  const orgCond = existing.has("organization_id") ? (def.reference || def.sharedDefaults ? "and (organization_id is null or organization_id=$2)" : "and organization_id=$2") : "";
  const r = await ctx.tx.query(`select ${cols.map(ident).join(",")} from erp.${ident(def.table)} where id=$1 ${orgCond} ${def.softDelete ? "and deleted_at is null" : ""}`, orgCond ? [id, ctx.orgId] : [id]);
  if (!r.rows[0]) throw notFound(def.label);
  return r.rows[0] as Record<string, unknown>;
}

function coerceValue(f: FieldDef, v: unknown): unknown {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (f.type === "json") return JSON.stringify(v);
  if (f.type === "tags") return v;
  return v;
}

export async function createOne(ctx: ServiceCtx, def: ResourceDef, body: unknown) {
  const data = buildSchema(def).parse(body) as Record<string, unknown>;
  if (def.farmScoped && data["farm_id"] && !farmAllowed(ctx, data["farm_id"] as string)) throw validation("Sem acesso à fazenda informada");
  const existing = await checkColumns(ctx, def);
  const cols: string[] = []; const vals: unknown[] = [];
  if (existing.has("organization_id")) { cols.push("organization_id"); vals.push(ctx.orgId); }
  if (def.codeEntity && existing.has("code") && !data["code"]) { cols.push("code"); vals.push(await nextCode(ctx.tx, ctx.orgId, def.codeEntity, def.key === "products" ? 5 : 4)); }
  if (existing.has("created_by")) { cols.push("created_by"); vals.push(ctx.user.id); }
  if (def.farmScoped && existing.has("farm_id") && !data["farm_id"] && ctx.farmId) { cols.push("farm_id"); vals.push(ctx.farmId); }
  for (const f of def.fields) {
    if (f.readOnly || !(f.name in data) || !existing.has(f.name)) continue;
    const v = coerceValue(f, data[f.name]); if (v === undefined) continue;
    cols.push(f.name); vals.push(v);
  }
  if (def.key === "farms" && !cols.includes("code")) { cols.push("code"); vals.push(Number(await nextCode(ctx.tx, ctx.orgId, "farm", 1))); }
  const r = await ctx.tx.query(`insert into erp.${ident(def.table)} (${cols.map(ident).join(",")}) values (${vals.map((_, i) => `$${i + 1}`).join(",")}) returning id`, vals);
  return getOne(ctx, def, (r.rows[0] as { id: string }).id);
}

export async function updateOne(ctx: ServiceCtx, def: ResourceDef, id: string, body: unknown) {
  await getOne(ctx, def, id);
  const data = buildSchema(def, true).parse(body) as Record<string, unknown>;
  const existing = await checkColumns(ctx, def);
  const sets: string[] = []; const vals: unknown[] = [];
  for (const f of def.fields) {
    if (f.readOnly || !(f.name in data) || !existing.has(f.name)) continue;
    const v = coerceValue(f, data[f.name]); if (v === undefined) continue;
    vals.push(v); sets.push(`${ident(f.name)} = $${vals.length}`);
  }
  if (!sets.length) return getOne(ctx, def, id);
  vals.push(id);
  const orgCond = existing.has("organization_id") && !def.reference ? `and organization_id = $${vals.push(ctx.orgId)}` : "";
  await ctx.tx.query(`update erp.${ident(def.table)} set ${sets.join(", ")} where id = $${vals.indexOf(id) + 1} ${orgCond}`, vals);
  return getOne(ctx, def, id);
}

export async function deleteOne(ctx: ServiceCtx, def: ResourceDef, id: string) {
  await getOne(ctx, def, id);
  const existing = await checkColumns(ctx, def);
  const orgCond = existing.has("organization_id") && !def.reference ? "and organization_id=$2" : "";
  const params = orgCond ? [id, ctx.orgId] : [id];
  if (def.softDelete) await ctx.tx.query(`update erp.${ident(def.table)} set deleted_at = now() where id=$1 ${orgCond}`, params);
  else await ctx.tx.query(`delete from erp.${ident(def.table)} where id=$1 ${orgCond}`, params);
  return { id, deleted: true };
}

/** Opções para selects (busca por rótulo, limitada), respeitando tenant/fazenda. */
export async function options(ctx: ServiceCtx, def: ResourceDef, search: string | undefined, extra: Record<string, string>) {
  const existing = await checkColumns(ctx, def);
  const b = new SqlBuilder(); const where: string[] = [];
  // labelField que é referência (ex.: authorizers.user_id) mostra o rótulo da tabela referenciada
  const lf = def.fields.find((f) => f.name === def.labelField);
  const refDef = lf?.type === "ref" && lf.ref ? getResource(lf.ref.resource) : undefined;
  const labelExpr = refDef ? `r.${ident(refDef.labelField)}::text` : `t.${ident(def.labelField)}::text`;
  const join = refDef ? `left join erp.${ident(refDef.table)} r on r.id = t.${ident(def.labelField)}` : "";
  if (existing.has("organization_id")) where.push(def.reference || def.sharedDefaults ? `(t.organization_id is null or t.organization_id=${b.add(ctx.orgId)})` : `t.organization_id=${b.add(ctx.orgId)}`);
  // Usuários são globais (sem organization_id): restringe aos membros ativos da organização atual (isolamento multi-tenant)
  if (def.table === "users") where.push(`t.id in (select m.user_id from erp.organization_members m where m.organization_id=${b.add(ctx.orgId)} and m.is_active)`);
  if (def.softDelete) where.push("t.deleted_at is null");
  if (existing.has("is_active") && !extra["include_inactive"]) where.push("t.is_active");
  if (search) where.push(`${labelExpr} ilike ${b.add(`%${search}%`)}`);
  for (const [k, v] of Object.entries(extra)) if (existing.has(k) && k !== "include_inactive") where.push(`t.${ident(k)} = ${b.add(v)}`);
  const codeSel = existing.has("code") ? ", t.code::text as code" : ", null as code";
  const r = await ctx.tx.query(`select t.id, ${labelExpr} as label ${codeSel} from erp.${ident(def.table)} t ${join} ${where.length ? "where " + where.join(" and ") : ""} order by 2 limit 200`, b.params);
  return r.rows;
}

export default async function resourceRoutes(app: FastifyInstance) {
  app.get("/resources", async (req) => { const ctx = app.requireCtx(req); return RESOURCES.filter((r) => hasPermission(ctx, `${r.permission}.view`)).map(({ key, label, labelPlural, route, permission }) => ({ key, label, labelPlural, route, permission })); });
  app.get("/resources/:key/definition", async (req) => { const def = getResource((req.params as { key: string }).key); if (!def) throw notFound("Recurso"); app.requireCtx(req); return def; });
  app.get("/resources/:key", async (req) => { const def = getResource((req.params as { key: string }).key); if (!def) throw notFound("Recurso"); return runService(app, req, `${def.permission}.view`, (ctx) => listResource(ctx, def, req.query as Record<string, unknown>)); });
  app.get("/resources/:key/options", async (req) => { const def = getResource((req.params as { key: string }).key); if (!def) throw notFound("Recurso"); const { search, ...extra } = req.query as Record<string, string>; return runService(app, req, null, (ctx) => options(ctx, def, search, extra)); });
  app.get("/resources/:key/:id", async (req) => { const { key, id } = req.params as { key: string; id: string }; const def = getResource(key); if (!def) throw notFound("Recurso"); return runService(app, req, `${def.permission}.view`, (ctx) => getOne(ctx, def, id)); });
  app.post("/resources/:key", async (req, reply) => { const def = getResource((req.params as { key: string }).key); if (!def) throw notFound("Recurso"); const r = await runService(app, req, `${def.permission}.create`, (ctx) => createOne(ctx, def, req.body)); return reply.status(201).send(r); });
  app.put("/resources/:key/:id", async (req) => { const { key, id } = req.params as { key: string; id: string }; const def = getResource(key); if (!def) throw notFound("Recurso"); return runService(app, req, `${def.permission}.edit`, (ctx) => updateOne(ctx, def, id, req.body)); });
  app.delete("/resources/:key/:id", async (req) => { const { key, id } = req.params as { key: string; id: string }; const def = getResource(key); if (!def) throw notFound("Recurso"); return runService(app, req, `${def.permission}.delete`, (ctx) => { requirePermission(ctx, `${def.permission}.delete`); return deleteOne(ctx, def, id); }); });
}
