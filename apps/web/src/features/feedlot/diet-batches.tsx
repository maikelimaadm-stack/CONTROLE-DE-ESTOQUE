"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, num, dateBR, todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input, Spinner } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { SimpleTable, useCreate, useFarmDefault, type Row } from "@/features/docs/shared";
export function DietBatchesPanel() {
  const { can } = useAuth(); const farm = useFarmDefault(); const q = useQuery({ queryKey: ["diet-batches"], queryFn: () => api<{ items: Row[] }>("/api/feedlot/diet-batches") });
  const [f, setF] = React.useState({ farm_id: "", batch_date: todayISO(), diet_id: "", warehouse_id: "", equipment_id: "", quantity_kg: "" }); React.useEffect(() => { setF((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const create = useCreate("/api/feedlot/diet-batches", () => { setF({ ...f, quantity_kg: "" }); void q.refetch(); });
  return <div className="space-y-3">{can("diet_batches.create") && <Card><CardHeader title="Nova batelada de dieta" subtitle="Consome os ingredientes da dieta (percentuais) do armazém, calcula o custo/kg e atualiza a dieta." /><CardBody><div className="grid grid-cols-12 gap-2"><Field label="Fazenda" span={3}><RefSelect resource="farms" value={f.farm_id} onChange={(v) => setF({ ...f, farm_id: v ?? "" })} /></Field><Field label="Data" span={2}><Input type="date" value={f.batch_date} onChange={(e) => setF({ ...f, batch_date: e.target.value })} /></Field><Field label="Dieta" required span={3}><RefSelect resource="diets" value={f.diet_id} onChange={(v) => setF({ ...f, diet_id: v ?? "" })} /></Field><Field label="Armazém" required span={2}><RefSelect resource="warehouses" value={f.warehouse_id} onChange={(v) => setF({ ...f, warehouse_id: v ?? "" })} /></Field><Field label="kg" required span={2}><Input type="number" step="0.01" value={f.quantity_kg} onChange={(e) => setF({ ...f, quantity_kg: e.target.value })} /></Field><Field label="Vagão / misturador" span={4}><RefSelect resource="equipments" value={f.equipment_id} onChange={(v) => setF({ ...f, equipment_id: v ?? "" })} /></Field><div className="col-span-2 flex items-end"><Button size="sm" loading={create.isPending} disabled={!f.diet_id || !f.warehouse_id || !f.quantity_kg} onClick={() => create.mutate({ ...f, equipment_id: f.equipment_id || null })}>Produzir</Button></div></div></CardBody></Card>}
    <Card><CardHeader title="Bateladas produzidas" /><CardBody>{q.isLoading ? <Spinner /> : <SimpleTable rows={q.data?.items ?? []} cols={[{ key: "code", label: "Código" }, { key: "batch_date", label: "Data", render: (r) => dateBR(r["batch_date"] as string) }, { key: "diet_name", label: "Dieta" }, { key: "quantity_kg", label: "kg", align: "right", render: (r) => num(r["quantity_kg"] as string, 2) }, { key: "total_cost", label: "Custo", align: "right", render: (r) => brl(r["total_cost"] as string) }, { key: "cost_kg", label: "R$/kg", align: "right", render: (r) => brl(Number(r["total_cost"]) / Number(r["quantity_kg"] || 1)) }]} />}</CardBody></Card></div>;
}
