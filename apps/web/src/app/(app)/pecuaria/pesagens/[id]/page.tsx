"use client";
import { use } from "react";
import { num, dateBR } from "@/lib/utils";
import { DetailShell } from "@/components/ui";
import { KV, SimpleTable, useDoc, LoadingOr, type Row } from "@/features/docs/shared";

/** Detalhe de uma pesagem (fluxo próprio: peso anterior e GMD por animal) — GET /api/livestock/weighings/:id. */
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useDoc<Row & { items: Row[] }>(`/api/livestock/weighings/${id}`); const d = q.data;
  return <LoadingOr q={q}>{d && <DetailShell title={`Pesagem ${String(d["code"])}`} subtitle={`${String(d["farm_name"])} · ${dateBR(d["weighing_date"] as string)}`} backHref="/pecuaria?tab=manejos&type=weighing" breadcrumbs={[{ label: "Pecuária", href: "/pecuaria" }, { label: "Pesagens", href: "/pecuaria?tab=manejos&type=weighing" }, { label: String(d["code"]) }]}>
    <KV items={[["Fazenda", String(d["farm_name"])], ["Data", dateBR(d["weighing_date"] as string)], ["Lote", String(d["batch_name"] ?? "—")], ["Animais", String(d["animals_count"] ?? "")], ["Peso total", `${num(String(d["total_weight"] ?? "0"), 1)} kg`], ["Responsável", String(d["responsible"] ?? "—")], ["Registrado por", String(d["created_by_name"] ?? "—")], ["Observação", String(d["note"] ?? "—")]]} />
    <SimpleTable rows={d.items} cols={[{ key: "identifications", label: "Animal" }, { key: "category_name", label: "Categoria" }, { key: "previous_weight", label: "Peso anterior (kg)", align: "right", render: (r) => r["previous_weight"] ? num(r["previous_weight"] as string, 1) : "—" }, { key: "weight", label: "Peso (kg)", align: "right", render: (r) => num(String(r["weight"]), 1) }, { key: "gmd", label: "GMD (kg/dia)", align: "right", render: (r) => r["gmd"] ? num(r["gmd"] as string, 3) : "—" }]} />
  </DetailShell>}</LoadingOr>;
}
