"use client";
import { useAuth } from "@/lib/auth";
import { DocList, colDate } from "@/features/docs/shared";
import { HANDLING_PT } from "@/features/livestock/shared";
import { enumLabel } from "@/lib/copy";
const PERM: Record<string, string> = { nutrition: "nutritions", sanitary: "sanitaries", weaning: "weanings", separation: "separations", pasture: "pastures" };
/** Manejos por tipo (antes: /pecuaria/manejo/[type]). */
/** `type` vazio = todos os tipos de manejo; cada linha abre o detalhe do seu tipo. */
export function HandlingsList({ type = "" }: { type?: string } = {}) {
  const { can } = useAuth();
  return <DocList key={type || "all"} title={type ? `Manejo — ${HANDLING_PT[type] ?? type}` : "Manejos"} endpoint="/api/livestock/handlings" base="/pecuaria/manejo" rowHref={(r) => `/pecuaria/manejo/${String(r["handling_type"])}/${r["id"]}`} defaultFilters={type ? { handling_type: type } : {}} hideNew canCreate={Boolean(type) && can(`${PERM[type] ?? "nutritions"}.create`)} entity="animal_handlings" filters={[{ name: "batch_id", label: "Lote", type: "ref", resource: "batches" }, { name: "start_date", label: "Data inicial", type: "date" }, { name: "end_date", label: "Data final", type: "date" }]}
    columns={[{ key: "code", label: "Código" }, colDate("handling_date", "Data"), { key: "handling_type", label: "Tipo", kind: "enum", options: Object.entries(HANDLING_PT).map(([value, label]) => ({ value, label })), render: (r) => enumLabel("handling_type", r["handling_type"]) }, { key: "batch_name", label: "Lote" }, { key: "product_name", label: "Produto" }, { key: "dose", label: "Dose", align: "right" }, { key: "animal_count", label: "Animais", align: "right" }, { key: "total_quantity", label: "Quantidade total", align: "right" }, { key: "withdrawal_until", label: "Carência até", render: (r) => r["withdrawal_until"] ? String(r["withdrawal_until"]).slice(0, 10).split("-").reverse().join("/") : "" }, { key: "responsible", label: "Responsável" }]} rowActions={() => []} />;
}
