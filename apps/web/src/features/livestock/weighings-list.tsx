"use client";
import { useAuth } from "@/lib/auth";
import { num } from "@/lib/utils";
import { DocList, colDate } from "@/features/docs/shared";
export function WeighingsList() {
  const { can } = useAuth();
  return <DocList title="Pesagens" endpoint="/api/livestock/weighings" base="/pecuaria/pesagens" hideNew canCreate={can("weighings.create")} entity="weighings" filters={[{ name: "batch_id", label: "Lote", type: "ref", resource: "batches" }, { name: "start_date", label: "Dt. Início", type: "date" }, { name: "end_date", label: "Dt. Fim", type: "date" }]}
    columns={[{ key: "code", label: "Código" }, colDate("weighing_date", "Data"), { key: "batch_name", label: "Lote" }, { key: "animal_count", label: "Animais", align: "right" }, { key: "avg_weight", label: "Peso médio", align: "right", render: (r) => r["avg_weight"] ? num(r["avg_weight"] as string, 1) : "" }, { key: "avg_gmd", label: "GMD médio", align: "right", render: (r) => r["avg_gmd"] ? num(r["avg_gmd"] as string, 3) : "" }, { key: "responsible", label: "Responsável" }, { key: "note", label: "Obs." }]} rowActions={() => []} />;
}
