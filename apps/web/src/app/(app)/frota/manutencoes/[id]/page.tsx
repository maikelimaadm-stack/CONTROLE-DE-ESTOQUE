"use client";
import * as React from "react";
import { use } from "react";
import { useAuth } from "@/lib/auth";
import { brl, num, dateBR } from "@/lib/utils";
import { Button, Confirm } from "@/components/ui";
import { DetailShell, KV, SimpleTable, useDoc, LoadingOr, type Row } from "@/features/docs/shared";
import { useAction } from "@/features/docs/actions";
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const { can } = useAuth(); const [c, setC] = React.useState(false);
  const q = useDoc<Row & { machines: (Row & { items: Row[] | null })[] }>(`/api/fleet/maintenances/${id}`); const act = useAction(() => setC(false)); const d = q.data;
  return <LoadingOr q={q}>{d && <DetailShell title={`Manutenção ${String(d["code"])}`} back="/frota/manutencoes" status={String(d["status"])} actions={d["status"] !== "cancelled" && can("maintenances.delete") && <Button size="sm" variant="danger" onClick={() => setC(true)}>Cancelar (estorna estoque)</Button>}>
    <KV items={[["Data", dateBR(d["maintenance_date"] as string)], ["Responsável", String(d["responsible_name"] ?? "")], ["Peças/insumos", brl(d["items_total"] as string)], ["Serviços", brl(d["service_total"] as string)], ["Total", brl(d["total"] as string)], ["Observação", String(d["note"] ?? "")]]} />
    {d.machines.map((m) => <div key={String(m["id"])} className="space-y-2 rounded border p-3">
      <KV items={[["Máquina", `${m["equipment_code"] ?? ""} ${m["equipment_name"]}`], ["Horímetro", String(m["hour_meter"] ?? "—")], ["Km", String(m["mileage"] ?? "—")], ["Executor", String(m["executor_name"] ?? "—")], ["Horas", String(m["hours"] ?? "—")], ["Serviço", brl(m["service_total"] as string)], ["Descrição", String(m["service_description"] ?? "")]]} />
      <SimpleTable rows={m.items ?? []} cols={[{ key: "product_name", label: "Produto" }, { key: "quantity", label: "Qtd.", align: "right", render: (r) => num(r["quantity"] as string, 4) }, { key: "unit_value", label: "Vl. unit.", align: "right", render: (r) => brl(r["unit_value"] as string) }, { key: "total", label: "Total", align: "right", render: (r) => brl(r["total"] as string) }]} />
    </div>)}
    <Confirm open={c} onOpenChange={setC} title="Cancelar manutenção" danger loading={act.isPending} onConfirm={() => act.mutate({ path: `/api/fleet/maintenances/${id}/cancel` })} />
  </DetailShell>}</LoadingOr>;
}
