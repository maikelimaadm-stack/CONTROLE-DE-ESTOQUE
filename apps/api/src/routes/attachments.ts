import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { runService, audit } from "../lib/service.js";
import { notFound, validation } from "../lib/errors.js";
import { attachmentStorage } from "../lib/attachment-storage.js";
import { authorizeAttachmentParent } from "../lib/attachment-parent.js";

/**
 * Anexos por registro (modelo base do MG): entidade anexável (`entity` = nome da tabela, whitelist em lib/attachment-parent.ts)
 * + `entity_id`. Toda rota autoriza o REGISTRO-PAI antes de listar/gravar/entregar/excluir: tenant + escopo de fazenda
 * (membership) + permissão de visualização do pai — attachments.* sozinha não dá acesso a anexo de registro invisível.
 * O conteúdo fica no banco (erp.attachment_blobs, bytea) — sem dependência de storage externo; `bucket='db'`.
 * Envio em JSON base64 (limite 20 MB por arquivo), prévia/download por GET /attachments/:id/content.
 */
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "text/plain", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/xml", "text/xml"]);
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

/** Assinatura ("magic bytes") deve bater com o tipo informado nos formatos binários conhecidos. */
export function contentMatchesMime(buf: Buffer, mime: string): boolean {
  const h = (n: number) => buf.subarray(0, n);
  if (mime === "application/pdf") return h(5).toString("latin1") === "%PDF-";
  if (mime === "image/png") return h(8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === "image/jpeg") return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (mime === "image/gif") return h(4).toString("latin1") === "GIF8";
  if (mime === "image/webp") return h(4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP";
  if (mime.includes("openxmlformats")) return h(2).toString("latin1") === "PK";
  if (mime === "application/msword" || mime === "application/vnd.ms-excel") return h(8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) || h(2).toString("latin1") === "PK";
  return true; // texto/xml: sem assinatura
}
const safeName = (s: string) => s.replace(/[\\/:*?"<>|\s\u0000-\u001f-]/g, "_").trim().slice(0, 180) || "arquivo";

const createSchema = z.object({
  entity: z.string().regex(IDENT), entity_id: z.string().uuid(),
  file_name: z.string().min(1).max(200), mime_type: z.string().min(1).max(120),
  description: z.string().max(200).optional().nullable(),
  data_base64: z.string().min(1)
});
const listSchema = z.object({ entity: z.string().regex(IDENT), entity_id: z.string().uuid() });

export default async function attachmentRoutes(app: FastifyInstance) {
  app.get("/attachments", async (req) => runService(app, req, "attachments.view", async (ctx) => {
    const f = listSchema.parse(req.query);
    await authorizeAttachmentParent(ctx, f.entity, f.entity_id, "view");
    const r = await ctx.tx.query("select a.id, a.entity, a.entity_id, a.file_name, a.mime_type, a.size_bytes, a.description, a.created_at, u.name as uploaded_by_name from erp.attachments a left join erp.users u on u.id=a.uploaded_by where a.organization_id=$1 and a.entity=$2 and a.entity_id=$3 order by a.created_at desc", [ctx.orgId, f.entity, f.entity_id]);
    return { items: r.rows };
  }));

  app.post("/attachments", { bodyLimit: Math.ceil(ATTACHMENT_MAX_BYTES * 1.4) + 4096 }, async (req, reply) => runService(app, req, "attachments.create", async (ctx) => {
    const d = createSchema.parse(req.body);
    if (!ALLOWED_MIME.has(d.mime_type)) throw validation("Tipo de arquivo não permitido", { mime_type: d.mime_type });
    const buf = Buffer.from(d.data_base64, "base64");
    if (!buf.length) throw validation("Arquivo vazio");
    if (buf.length > ATTACHMENT_MAX_BYTES) throw validation("Arquivo excede 20 MB");
    if (!contentMatchesMime(buf, d.mime_type)) throw validation("Conteúdo do arquivo não corresponde ao tipo informado");
    await authorizeAttachmentParent(ctx, d.entity, d.entity_id, "create"); // pai existe, é do tenant, está no escopo e é visível
    const name = safeName(d.file_name);
    const objectPath = `${d.entity}/${d.entity_id}/${name}`;
    const ins = await ctx.tx.query<{ id: string }>("insert into erp.attachments(organization_id,entity,entity_id,bucket,object_path,file_name,mime_type,size_bytes,description,uploaded_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id", [ctx.orgId, d.entity, d.entity_id, attachmentStorage.bucket, objectPath, name, d.mime_type, buf.length, d.description ?? null, ctx.user.id]);
    const id = ins.rows[0]!.id;
    await attachmentStorage.put(ctx.tx, { attachmentId: id, organizationId: ctx.orgId, objectPath, data: buf });
    await audit(ctx.tx, ctx, d.entity, d.entity_id, "attachment_added", { attachment_id: id, file_name: name, size_bytes: buf.length });
    reply.code(201);
    return { id, entity: d.entity, entity_id: d.entity_id, file_name: name, mime_type: d.mime_type, size_bytes: buf.length, description: d.description ?? null };
  }));

  app.get("/attachments/:id/content", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const download = (req.query as Record<string, string>)["download"] === "1";
    const row = await runService(app, req, "attachments.view", async (ctx) => {
      const r = await ctx.tx.query<{ file_name: string; mime_type: string | null; bucket: string; object_path: string; entity: string; entity_id: string }>("select a.file_name, a.mime_type, a.bucket, a.object_path, a.entity, a.entity_id from erp.attachments a where a.id=$1 and a.organization_id=$2", [id, ctx.orgId]);
      const meta = r.rows[0]; if (!meta) throw notFound("Anexo");
      await authorizeAttachmentParent(ctx, meta.entity, meta.entity_id, "view"); // antes de ler qualquer byte
      const data = await attachmentStorage.get(ctx.tx, { attachmentId: id, organizationId: ctx.orgId, bucket: meta.bucket, objectPath: meta.object_path });
      if (!data) throw notFound("Conteúdo do anexo");
      return { ...meta, data };
    });
    const encoded = encodeURIComponent(row.file_name);
    reply.header("Content-Type", row.mime_type ?? "application/octet-stream");
    reply.header("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${row.file_name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encoded}`);
    reply.header("Cache-Control", "private, max-age=300");
    reply.header("X-Content-Type-Options", "nosniff");
    return reply.send(row.data);
  });

  app.delete("/attachments/:id", async (req) => runService(app, req, "attachments.delete", async (ctx) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    // 1) metadados 2) autorização do pai 3) só então remoção (storage + índice na mesma transação; blob cai por cascade)
    const r = await ctx.tx.query<{ entity: string; entity_id: string; file_name: string; bucket: string; object_path: string }>("select entity, entity_id, file_name, bucket, object_path from erp.attachments where id=$1 and organization_id=$2 for update", [id, ctx.orgId]);
    if (!r.rows[0]) throw notFound("Anexo");
    await authorizeAttachmentParent(ctx, r.rows[0].entity, r.rows[0].entity_id, "delete");
    await attachmentStorage.remove(ctx.tx, { attachmentId: id, bucket: r.rows[0].bucket, objectPath: r.rows[0].object_path });
    await ctx.tx.query("delete from erp.attachments where id=$1 and organization_id=$2", [id, ctx.orgId]);
    await audit(ctx.tx, ctx, r.rows[0].entity, r.rows[0].entity_id, "attachment_removed", { attachment_id: id, file_name: r.rows[0].file_name });
    return { ok: true };
  }));
}
