"use client";
import { use } from "react";
import { useAuth } from "@/lib/auth";
import { DocList, colDate } from "@/features/docs/shared";
import { HANDLING_PT } from "@/features/livestock/shared";
const PERM: Record<string, string> = { nutrition: "nutritions", sanitary: "sanitaries", weaning: "weanings", separation: "separations", pasture: "pastures" };
export default function Page({ params }: { params: Promise<{ type: string }> }) {
  const { type } = use(params); const { can } = useAuth();
  return <DocList key={type} title={`Manejo — ${HANDLING_PT[type] ?? type}`} endpoint="/api/livestock/handlings" base={`/pecuaria/manejo/${type}`} defaultFilters={{ handling_type: type }} canCreate={can(`${PERM[type] ?? "nutritions"}.create`)} filters={[{ name: "batch_id", label: "Lote", type: "ref", resource: "batches" }, { name: "start_date", label: "Dt. Início", type: "date" }, { name: "end_date", label: "Dt. Fim", type: "date" }]}
    columns={[{ key: "code", label: "Código" }, colDate("handling_date", "Data"), { key: "batch_name", label: "Lote" }, { key: "product_name", label: "Produto" }, { key: "dose", label: "Dose", align: "right" }, { key: "animal_count", label: "Animais", align: "right" }, { key: "total_quantity", label: "Qtd. total", align: "right" }, { key: "withdrawal_until", label: "Carência até", render: (r) => r["withdrawal_until"] ? String(r["withdrawal_until"]).slice(0, 10).split("-").reverse().join("/") : "" }, { key: "responsible", label: "Responsável" }]} rowActions={() => []} />;
}
