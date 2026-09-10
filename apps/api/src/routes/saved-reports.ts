import type { FastifyInstance } from "fastify";
import { z } from "zod";
import ExcelJS from "exceljs";
import { getResource, RESOURCES, type FieldDef, type ResourceDef } from "@agro/domain";
import { parseFilterKey, isValidOperator, filterKindOf } from "@agro/shared";
import { runService, requirePermission } from "../lib/service.js";
import { notFound, validation, DomainError } from "../lib/errors.js";
import { hasPermission, type ServiceCtx } from "../lib/context.js";
import { listResource } from "./resources.js";

/**
 * Relatórios personalizados por entidade (cadastros declarativos): o usuário escolhe colunas, filtros
 * (mesmo formato `campo__operador` das listagens), ordenação, agrupamento e totais; salva em
 * erp.saved_reports (privado ou compartilhado na organização) e exporta CSV/XLSX.
 */
const NUMERIC = new Set(["number", "integer", "money", "quantity", "percent"]);
const MAX_ROWS = 5000; const PAGE = 200;
export const definitionSchema = z.object({
  columns: z.array(z.string().regex(/^[a-z_][a-z0-9_]*$/)).min(1).max(60),
  filters: z.record(z.string().regex(/^[a-z_][a-z0-9_]*$/), z.string().max(500)).default({}),
  search: z.string().max(200).optional(),
  sort: z.object({ key: z.string().regex(/^[a-z_][a-z0-9_]*$/), dir: z.enum(["asc", "desc"]) }).optional(),
  groupBy: z.string().regex(/^[a-z_][a-z0-9_]*$/).nullable().optional(),
  totals: z.array(z.string().regex(/^[a-z_][a-z0-9_]*$/)).max(20).default([]),
  limit: z.number().int().min(1).max(MAX_ROWS).default(1000)
});
export type ReportDefinition = z.infer<typeof definitionSchema>;
const saveSchema = z.object({ resource_key: z.string().regex(/^[a-z0-9_]{1,64}$/), name: z.string().trim().min(1).max(80), definition: definitionSchema, is_shared: z.boolean().default(false) });

/** Valida a definição contra o recurso (colunas/filtros/agrupamento só de campos existentes). */
export function normalizeDefinition(def: ResourceDef, d: ReportDefinition): ReportDefinition {
  const byName = new Map(def.fields.map((f) => [f.name, f]));
  const columns = d.columns.filter((c) => byName.has(c));
  if (!columns.length) throw validation("Selecione ao menos uma coluna válida");
  const filters: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.filters)) { const p = parseFilterKey(k); const f = byName.get(p?.field ?? k); if (!f) continue; if (p && !isValidOperator(filterKindOf(f.type), p.op)) continue; filters[k] = v; }
  const sort = d.sort && byName.has(d.sort.key) ? d.sort : undefined;
  const groupBy = d.groupBy && byName.has(d.groupBy) ? d.groupBy : null;
  const totals = d.totals.filter((t) => byName.has(t) && NUMERIC.has(byName.get(t)!.type));
  return { columns, filters, search: d.search, sort, groupBy, totals, limit: d.limit };
}

export interface ReportColumn { key: string; label: string; type: FieldDef["type"] }
export interface ReportGroup { key: string; label: string; rows: Record<string, unknown>[]; totals: Record<string, string> }
export interface ReportResult { columns: ReportColumn[]; rows: Record<string, unknown>[]; groups: ReportGroup[] | null; totals: Record<string, string>; count: number; truncated: boolean }

const sum = (rows: Record<string, unknown>[], keys: string[]) => Object.fromEntries(keys.map((k) => [k, rows.reduce((a, r) => a + Number(r[k] ?? 0), 0).toFixed(2)]));
const cellText = (f: FieldDef | undefined, r: Record<string, unknown>) => { if (!f) return ""; if (f.type === "ref") return String(r[`${f.name}_label`] ?? ""); const v = r[f.name]; if (v === null || v === undefined) return ""; if (f.type === "select") return f.options?.find((o) => o.value === String(v))?.label ?? String(v); if (f.type === "boolean") return v ? "Sim" : "Não"; return String(v); };

export async function runSavedReport(ctx: ServiceCtx, def: ResourceDef, raw: ReportDefinition): Promise<ReportResult> {
  const d = normalizeDefinition(def, raw);
  const byName = new Map(def.fields.map((f) => [f.name, f]));
  const rows: Record<string, unknown>[] = []; let total = 0; let truncated = false;
  for (let page = 1; rows.length < d.limit; page++) {
    const r = await listResource(ctx, def, { ...d.filters, search: d.search, sort: d.sort?.key, dir: d.sort?.dir, page: String(page), pageSize: String(PAGE) });
    total = r.total; rows.push(...r.items);
    if (r.items.length < PAGE || rows.length >= r.total) break;
  }
  if (rows.length > d.limit) { rows.length = d.limit; truncated = true; } else if (total > rows.length) truncated = true;
  const columns: ReportColumn[] = d.columns.map((c) => { const f = byName.get(c)!; return { key: c, label: f.label, type: f.type }; });
  const items = rows.map((r) => { const o: Record<string, unknown> = { id: r["id"] }; for (const c of d.columns) { const f = byName.get(c)!; o[c] = NUMERIC.has(f.type) ? r[c] ?? null : cellText(f, r); } if (d.groupBy) o["__group"] = cellText(byName.get(d.groupBy), r) || "(vazio)"; return o; });
  let groups: ReportGroup[] | null = null;
  if (d.groupBy) {
    const m = new Map<string, Record<string, unknown>[]>();
    for (const it of items) { const k = String(it["__group"]); m.set(k, [...(m.get(k) ?? []), it]); }
    groups = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR")).map(([k, rs]) => ({ key: k, label: k, rows: rs, totals: sum(rs, d.totals) }));
  }
  return { columns, rows: items, groups, totals: sum(items, d.totals), count: items.length, truncated };
}

interface SavedRow { id: string; resource_key: string; name: string; definition: ReportDefinition; is_shared: boolean; user_id: string | null; created_by: string | null; created_at: string; updated_at: string }
async function getSaved(ctx: ServiceCtx, id: string): Promise<SavedRow> {
  const r = await ctx.tx.query<SavedRow>("select id, resource_key, name, definition, is_shared, user_id, created_by, created_at, updated_at from erp.saved_reports where id=$1 and organization_id=$2 and deleted_at is null and (is_shared or user_id=$3)", [id, ctx.orgId, ctx.user.id]);
  if (!r.rows[0]) throw notFound("Relatório personalizado"); return r.rows[0];
}
const canManage = (ctx: ServiceCtx, r: SavedRow, action: "edit" | "delete") => r.user_id === ctx.user.id || hasPermission(ctx, `saved_reports.${action}`);

export default async function savedReportRoutes(app: FastifyInstance) {
  /** Entidades disponíveis para relatório (recursos com permissão de visualização) e seus campos. */
  app.get("/saved-reports/resources", async (req) => { const ctx = app.requireCtx(req); return RESOURCES.filter((r) => !r.reference && hasPermission(ctx, `${r.permission}.view`)).map((r) => ({ key: r.key, label: r.labelPlural, fields: r.fields.map((f) => ({ name: f.name, label: f.label, type: f.type, filter: Boolean(f.filter), resource: f.ref?.resource, options: f.options })) })); });
  app.get("/saved-reports", async (req) => runService(app, req, "saved_reports.view", async (ctx) => {
    const { resource } = req.query as { resource?: string };
    const r = await ctx.tx.query<SavedRow & { owner_name: string | null }>(`select s.id, s.resource_key, s.name, s.definition, s.is_shared, s.user_id, s.created_by, s.created_at, s.updated_at, u.name as owner_name from erp.saved_reports s left join erp.users u on u.id = s.user_id where s.organization_id=$1 and s.deleted_at is null and (s.is_shared or s.user_id=$2) ${resource ? "and s.resource_key=$3" : ""} order by s.name`, resource ? [ctx.orgId, ctx.user.id, resource] : [ctx.orgId, ctx.user.id]);
    return { items: r.rows.map((x) => ({ ...x, mine: x.user_id === ctx.user.id, resource_label: getResource(x.resource_key)?.labelPlural ?? x.resource_key })) };
  }));
  app.get("/saved-reports/:id", async (req) => runService(app, req, "saved_reports.view", (ctx) => getSaved(ctx, (req.params as { id: string }).id)));
  app.post("/saved-reports", async (req, reply) => {
    const body = saveSchema.parse(req.body); const def = getResource(body.resource_key); if (!def) throw notFound("Recurso");
    const r = await runService(app, req, "saved_reports.create", async (ctx) => {
      requirePermission(ctx, `${def.permission}.view`); if (body.is_shared) requirePermission(ctx, "saved_reports.share");
      const d = normalizeDefinition(def, body.definition);
      const ins = await ctx.tx.query<{ id: string }>("insert into erp.saved_reports(organization_id,user_id,resource_key,name,definition,is_shared,created_by) values ($1,$2,$3,$4,$5,$6,$2) returning id", [ctx.orgId, ctx.user.id, body.resource_key, body.name, JSON.stringify(d), body.is_shared]);
      return getSaved(ctx, ins.rows[0]!.id);
    });
    return reply.status(201).send(r);
  });
  app.put("/saved-reports/:id", async (req) => {
    const body = saveSchema.partial().parse(req.body);
    return runService(app, req, "saved_reports.view", async (ctx) => {
      const cur = await getSaved(ctx, (req.params as { id: string }).id);
      if (!canManage(ctx, cur, "edit")) throw new DomainError("PERMISSION_DENIED", "Somente o autor ou quem tem permissão de edição pode alterar este relatório");
      const def = getResource(cur.resource_key)!;
      const d = body.definition ? normalizeDefinition(def, body.definition) : cur.definition;
      if (body.is_shared !== undefined && body.is_shared !== cur.is_shared) requirePermission(ctx, "saved_reports.share");
      await ctx.tx.query("update erp.saved_reports set name=coalesce($2,name), definition=$3, is_shared=coalesce($4,is_shared) where id=$1", [cur.id, body.name ?? null, JSON.stringify(d), body.is_shared ?? null]);
      return getSaved(ctx, cur.id);
    });
  });
  app.delete("/saved-reports/:id", async (req) => runService(app, req, "saved_reports.view", async (ctx) => {
    const cur = await getSaved(ctx, (req.params as { id: string }).id);
    if (!canManage(ctx, cur, "delete")) throw new DomainError("PERMISSION_DENIED", "Somente o autor ou quem tem permissão de exclusão pode remover este relatório");
    await ctx.tx.query("update erp.saved_reports set deleted_at=now() where id=$1", [cur.id]); return { id: cur.id, deleted: true };
  }));
  /** Executa uma definição (salva ou ad hoc). `format=csv|xlsx` exporta (exige permissão de exportação do recurso quando existir). */
  app.post("/saved-reports/run", async (req, reply) => {
    const body = z.object({ resource_key: z.string().regex(/^[a-z0-9_]{1,64}$/), definition: definitionSchema, format: z.enum(["csv", "xlsx"]).optional(), name: z.string().max(80).optional() }).parse(req.body);
    const def = getResource(body.resource_key); if (!def) throw notFound("Recurso");
    const result = await runService(app, req, `${def.permission}.view`, (ctx) => runSavedReport(ctx, def, body.definition));
    if (!body.format) return result;
    const name = (body.name ?? def.labelPlural).replace(/[^\w\- ]+/g, "").slice(0, 60) || "relatorio";
    const lines: (string | number | null)[][] = [];
    const push = (r: Record<string, unknown>) => lines.push(result.columns.map((c) => (NUMERIC.has(c.type) ? Number(r[c.key] ?? 0) : String(r[c.key] ?? ""))));
    const totalsRow = (label: string, t: Record<string, string>) => lines.push(result.columns.map((c, i) => (i === 0 ? label : t[c.key] !== undefined ? Number(t[c.key]) : null)));
    if (result.groups) for (const g of result.groups) { lines.push([`${def.fields.find((f) => f.name === body.definition.groupBy)?.label ?? "Grupo"}: ${g.label}`, ...result.columns.slice(1).map(() => null)]); g.rows.forEach(push); if (Object.keys(g.totals).length) totalsRow("Subtotal", g.totals); }
    else result.rows.forEach(push);
    if (Object.keys(result.totals).length) totalsRow("Total", result.totals);
    if (body.format === "xlsx") {
      const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(name.slice(0, 30)); ws.columns = result.columns.map((c) => ({ header: c.label, key: c.key, width: 20 }));
      for (const l of lines) ws.addRow(l); const buf = await wb.xlsx.writeBuffer();
      return reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").header("Content-Disposition", `attachment; filename="${name}.xlsx"`).send(Buffer.from(buf));
    }
    const csv = [result.columns.map((c) => c.label).join(";"), ...lines.map((l) => l.map((v) => String(v ?? "").replace(/;/g, ",")).join(";"))].join("\n");
    return reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="${name}.csv"`).send("﻿" + csv);
  });
}
