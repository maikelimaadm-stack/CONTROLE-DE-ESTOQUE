"use client";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Download, Eye, FileText, Image as ImageIcon, File as FileIcon, X } from "lucide-react";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { cn, num } from "@/lib/utils";
import { Dialog, Spinner, Confirm, Field, Input } from "@/components/ui";
import { IconBtn, PillBtn } from "./ui";

/**
 * Anexos do registro (modelo base do MG: nome do anexo + arquivos; lista com Nome do anexo / Arquivo / tamanho).
 * Além do MG: prévia embutida (imagem, PDF, texto) e download com o mesmo conteúdo. Conteúdo servido pela API com
 * autenticação (blob URL local), nunca por link público.
 */
export interface Attachment { id: string; file_name: string; mime_type: string | null; size_bytes: string | number | null; description: string | null; created_at: string; uploaded_by_name?: string | null }
const MAX_BYTES = 20 * 1024 * 1024;
export const formatSize = (n: number) => n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${num(n / 1024, 1)} KB` : `${num(n / 1024 / 1024, 1)} MB`;
const isImage = (m?: string | null) => Boolean(m?.startsWith("image/"));
const isPdf = (m?: string | null) => m === "application/pdf";
const isText = (m?: string | null) => Boolean(m && (m.startsWith("text/") || m.endsWith("/xml")));
const canPreview = (m?: string | null) => isImage(m) || isPdf(m) || isText(m);
const dateTime = (s: string) => { const d = new Date(s); return Number.isNaN(d.getTime()) ? s : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); };
const toBase64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] ?? ""); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
const mimeOf = (f: File) => f.type || ({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", txt: "text/plain", csv: "text/csv", xml: "application/xml", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } as Record<string, string>)[f.name.split(".").pop()?.toLowerCase() ?? ""] || "application/octet-stream";

/** Busca o conteúdo autenticado e devolve um blob URL (revogado ao desmontar). */
function useAttachmentBlob(id: string | null) {
  const [url, setUrl] = React.useState<string | null>(null); const [text, setText] = React.useState<string | null>(null); const [loading, setLoading] = React.useState(false); const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cur: string | null = null; let alive = true;
    setUrl(null); setText(null); setError(null);
    if (!id) return;
    setLoading(true);
    void api<Response>(`/api/attachments/${id}/content`, { raw: true }).then(async (res) => {
      if (!res.ok) throw new Error(res.status === 404 ? "Anexo não encontrado" : "Falha ao carregar o anexo");
      const blob = await res.blob(); if (!alive) return;
      if (blob.type.startsWith("text/") || blob.type.endsWith("/xml")) setText((await blob.text()).slice(0, 200_000));
      cur = URL.createObjectURL(blob); setUrl(cur);
    }).catch((e: Error) => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; if (cur) URL.revokeObjectURL(cur); };
  }, [id]);
  return { url, text, loading, error };
}

export function AttachmentsDialog({ open, onOpenChange, entity, entityId, title }: { open: boolean; onOpenChange: (o: boolean) => void; entity: string; entityId?: string | null; title: string }) {
  const { can } = useAuth(); const qc = useQueryClient();
  const [name, setName] = React.useState(""); const [preview, setPreview] = React.useState<Attachment | null>(null); const [del, setDel] = React.useState<Attachment | null>(null); const [uploading, setUploading] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const key = ["b1-attachments", entity, entityId];
  const q = useQuery({ queryKey: key, queryFn: () => api<{ items: Attachment[] }>(`/api/attachments${qs({ entity, entity_id: entityId })}`), enabled: open && Boolean(entityId) && can("attachments.view") });
  const items = q.data?.items ?? [];
  React.useEffect(() => { if (!open) { setPreview(null); setName(""); } }, [open]);
  const upload = async (files: FileList | null) => {
    if (!files || !files.length || !entityId) return;
    for (const f of Array.from(files)) {
      if (f.size > MAX_BYTES) { toast.error(`${f.name}: excede 20 MB`); continue; }
      setUploading(f.name);
      try { await api("/api/attachments", { method: "POST", body: { entity, entity_id: entityId, file_name: f.name, mime_type: mimeOf(f), description: name.trim() || null, data_base64: await toBase64(f) } }); toast.success(`${f.name} anexado`); }
      catch (e) { toast.error(`${f.name}: ${(e as Error).message}`); }
    }
    setUploading(null); setName(""); if (fileRef.current) fileRef.current.value = ""; void qc.invalidateQueries({ queryKey: key });
  };
  const remove = useMutation({ mutationFn: (a: Attachment) => api(`/api/attachments/${a.id}`, { method: "DELETE" }), onSuccess: () => { toast.success("Anexo excluído"); setDel(null); if (preview && del && preview.id === del.id) setPreview(null); void qc.invalidateQueries({ queryKey: key }); }, onError: (e) => toast.error((e as Error).message) });
  const download = async (a: Attachment) => { try { const res = await api<Response>(`/api/attachments/${a.id}/content?download=1`, { raw: true }); if (!res.ok) throw new Error("Falha ao baixar"); const blob = await res.blob(); const u = URL.createObjectURL(blob); const el = document.createElement("a"); el.href = u; el.download = a.file_name; el.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); } catch (e) { toast.error((e as Error).message); } };
  const icon = (m: string | null) => isImage(m) ? <ImageIcon className="h-4 w-4" /> : isPdf(m) ? <FileText className="h-4 w-4" /> : <FileIcon className="h-4 w-4" />;
  const canCreate = can("attachments.create"); const canDelete = can("attachments.delete");
  return <Dialog open={open} onOpenChange={onOpenChange} title={`Anexos — ${title}`} size={preview ? "xl" : "lg"}>
    {!can("attachments.view") ? <div className="text-sm text-slate-500">Você não tem permissão para ver os anexos.</div>
      : !entityId ? <div className="text-sm text-slate-500">Salve o registro antes de anexar arquivos.</div>
      : <div className={cn("b1-attach flex min-h-[320px] gap-3", preview && "b1-attach--preview")}>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {canCreate && <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1"><Field label="Nome do anexo"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} /></Field></div>
            <input ref={fileRef} type="file" multiple className="hidden" aria-label="Selecionar arquivos" onChange={(e) => void upload(e.target.files)} accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.csv,.xml,.xls,.xlsx,.doc,.docx" />
            <PillBtn onClick={() => fileRef.current?.click()} disabled={Boolean(uploading)}><Plus className="h-4 w-4" /> {uploading ? `Enviando ${uploading}…` : "Anexar arquivos"}</PillBtn>
          </div>}
          <div className="mg-grid-wrap min-h-0 flex-1 overflow-auto">
            <table className="mg-grid b1-attach__table">
              <thead><tr><th style={{ width: "34%" }}>Nome do anexo</th><th>Arquivo</th><th style={{ width: 90 }} className="!text-right">Tamanho</th><th style={{ width: 130 }}>Enviado em</th><th style={{ width: 104 }} aria-label="Ações" /></tr></thead>
              <tbody>
                {q.isLoading && <tr><td colSpan={5} className="!h-16 text-center"><Spinner className="mx-auto" /></td></tr>}
                {!q.isLoading && items.length === 0 && <tr><td colSpan={5} className="!h-16 text-center text-slate-400">Nenhum arquivo anexado.</td></tr>}
                {items.map((a, i) => <tr key={a.id} className={cn(i % 2 ? "odd" : "even", preview?.id === a.id && "selected")} data-testid="b1-attachment" onDoubleClick={() => canPreview(a.mime_type) && setPreview(a)}>
                  <td title={a.description ?? ""}>{a.description || <span className="text-slate-400">–</span>}</td>
                  <td title={a.file_name}><span className="inline-flex items-center gap-1.5 text-[var(--mg-icon)]">{icon(a.mime_type)}<span className="truncate text-slate-800">{a.file_name}</span></span></td>
                  <td className="!text-right tabular-nums">{a.size_bytes != null ? formatSize(Number(a.size_bytes)) : "–"}</td>
                  <td>{dateTime(a.created_at)}</td>
                  <td className="!text-right"><span className="inline-flex items-center gap-0.5">
                    <IconBtn size="sm" aria-label={`Prévia de ${a.file_name}`} title={canPreview(a.mime_type) ? "Prévia" : "Prévia indisponível para este tipo"} disabled={!canPreview(a.mime_type)} active={preview?.id === a.id} onClick={() => setPreview(preview?.id === a.id ? null : a)}><Eye className="h-4 w-4" /></IconBtn>
                    <IconBtn size="sm" aria-label={`Baixar ${a.file_name}`} title="Baixar" onClick={() => void download(a)}><Download className="h-4 w-4" /></IconBtn>
                    {canDelete && <IconBtn size="sm" aria-label={`Excluir ${a.file_name}`} title="Excluir" className="text-red-600" onClick={() => setDel(a)}><Trash2 className="h-4 w-4" /></IconBtn>}
                  </span></td>
                </tr>)}
              </tbody>
            </table>
          </div>
          <div className="text-[11px] text-slate-400">Tipos aceitos: PDF, imagens (PNG, JPG, WEBP, GIF), texto/CSV/XML, Excel e Word · até 20 MB por arquivo.</div>
        </div>
        {preview && <PreviewPane a={preview} onClose={() => setPreview(null)} onDownload={() => void download(preview)} />}
      </div>}
    <Confirm open={Boolean(del)} onOpenChange={() => setDel(null)} title="Excluir anexo" text={`Excluir o anexo "${del?.file_name ?? ""}"? A ação fica registrada na auditoria.`} danger loading={remove.isPending} onConfirm={() => del && remove.mutate(del)} />
  </Dialog>;
}

function PreviewPane({ a, onClose, onDownload }: { a: Attachment; onClose: () => void; onDownload: () => void }) {
  const { url, text, loading, error } = useAttachmentBlob(a.id);
  return <div className="b1-attach__preview flex min-w-0 flex-1 flex-col gap-1.5" data-testid="b1-attachment-preview">
    <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-800"><span className="truncate">{a.file_name}</span><span className="ml-auto flex items-center gap-0.5"><IconBtn size="sm" aria-label="Baixar" title="Baixar" onClick={onDownload}><Download className="h-4 w-4" /></IconBtn><IconBtn size="sm" aria-label="Fechar prévia" title="Fechar prévia" onClick={onClose}><X className="h-4 w-4" /></IconBtn></span></div>
    <div className="b1-attach__frame">
      {loading && <div className="flex h-full items-center justify-center"><Spinner /></div>}
      {error && <div className="p-3 text-sm text-red-600">{error}</div>}
      {url && isImage(a.mime_type) && <img src={url} alt={a.file_name} className="max-h-full max-w-full object-contain" />}
      {url && isPdf(a.mime_type) && <iframe src={url} title={a.file_name} className="h-full w-full" />}
      {text !== null && isText(a.mime_type) && <pre className="h-full w-full overflow-auto whitespace-pre-wrap p-2 text-[11.5px] text-slate-700">{text}</pre>}
    </div>
  </div>;
}
