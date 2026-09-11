import type { Tx } from "@agro/db";

/**
 * Armazenamento físico dos anexos (abstração — ver docs/ARCHITECTURE.md "Anexos").
 * Hoje o conteúdo fica no banco (erp.attachment_blobs, bytea; `bucket='db'`). Para trocar por Supabase Storage / S3 /
 * object storage basta outra implementação desta interface (a UI e as rotas de /api/attachments não mudam): o índice
 * erp.attachments guarda `bucket` + `object_path`, que identificam onde o conteúdo está.
 */
export interface AttachmentStorage {
  readonly bucket: string;
  put(tx: Tx, args: { attachmentId: string; organizationId: string; objectPath: string; data: Buffer }): Promise<void>;
  get(tx: Tx, args: { attachmentId: string; organizationId: string; bucket: string; objectPath: string }): Promise<Buffer | null>;
  /** Remoção do conteúdo; no banco é feita pela FK on delete cascade, aqui é no-op. */
  remove(tx: Tx, args: { attachmentId: string; bucket: string; objectPath: string }): Promise<void>;
}

export const dbAttachmentStorage: AttachmentStorage = {
  bucket: "db",
  async put(tx, a) { await tx.query("insert into erp.attachment_blobs(attachment_id,organization_id,data) values ($1,$2,$3)", [a.attachmentId, a.organizationId, a.data]); },
  async get(tx, a) { if (a.bucket !== "db") return null; const r = await tx.query<{ data: Buffer }>("select data from erp.attachment_blobs where attachment_id=$1 and organization_id=$2", [a.attachmentId, a.organizationId]); return r.rows[0]?.data ?? null; },
  async remove() { /* cascade */ }
};

/** Implementação ativa (única hoje). */
export const attachmentStorage: AttachmentStorage = dbAttachmentStorage;
