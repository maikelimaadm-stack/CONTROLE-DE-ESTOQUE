"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { useCreate, useFarmDefault } from "@/features/docs/shared";
export default function Page() {
  const router = useRouter(); const farm = useFarmDefault();
  const [h, setH] = React.useState({ farm_id: "", supply_date: todayISO(), equipment_id: "", operator_person_id: "", warehouse_id: "", product_id: "", quantity: "", unit_value: "", hour_meter: "", mileage: "", cost_center_id: "", harvest_id: "", note: "", origin: "manual" });
  React.useEffect(() => { setH((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const create = useCreate("/api/fleet/fuel-supplies", () => router.push("/frota?tab=abastecimentos"));
  const submit = () => create.mutate({ ...h, operator_person_id: h.operator_person_id || null, warehouse_id: h.warehouse_id || null, unit_value: h.unit_value || null, hour_meter: h.hour_meter || null, mileage: h.mileage || null, cost_center_id: h.cost_center_id || null, harvest_id: h.harvest_id || null, note: h.note || null });
  return <Card><CardHeader title="Novo Abastecimento" subtitle="Com armazém/tanque informado o combustível é baixado do estoque ao custo médio; sem armazém, usa o valor unitário informado." actions={<><Button variant="outline" size="sm" onClick={() => router.back()}>Voltar</Button><Button size="sm" loading={create.isPending} disabled={!h.equipment_id || !h.product_id || !h.quantity} onClick={submit}>Salvar</Button></>} /><CardBody>
    <div className="grid grid-cols-12 gap-3">
      <Field label="Fazenda" required span={3}><RefSelect resource="farms" value={h.farm_id} onChange={(v) => setH({ ...h, farm_id: v ?? "" })} /></Field>
      <Field label="Data" required span={2}><Input type="date" value={h.supply_date} onChange={(e) => setH({ ...h, supply_date: e.target.value })} /></Field>
      <Field label="Máquina" required span={4}><RefSelect resource="equipments" value={h.equipment_id} onChange={(v) => setH({ ...h, equipment_id: v ?? "" })} /></Field>
      <Field label="Operador" span={3}><RefSelect resource="people" value={h.operator_person_id} onChange={(v) => setH({ ...h, operator_person_id: v ?? "" })} filter={{ is_employee: "true" }} /></Field>
      <Field label="Armazém / tanque" span={3}><RefSelect resource="warehouses" value={h.warehouse_id} onChange={(v) => setH({ ...h, warehouse_id: v ?? "" })} /></Field>
      <Field label="Combustível" required span={3}><RefSelect resource="products" value={h.product_id} onChange={(v) => setH({ ...h, product_id: v ?? "" })} /></Field>
      <Field label="Litros" required span={2}><Input type="number" step="0.001" value={h.quantity} onChange={(e) => setH({ ...h, quantity: e.target.value })} /></Field>
      <Field label="Vl. unitário" span={2}><Input type="number" step="0.0001" value={h.unit_value} onChange={(e) => setH({ ...h, unit_value: e.target.value })} /></Field>
      <Field label="Origem" span={2}><NativeSelect value={h.origin} onChange={(e) => setH({ ...h, origin: e.target.value })}><option value="manual">Manual</option><option value="cta_smart">CTA Smart</option><option value="import">Importação</option></NativeSelect></Field>
      <Field label="Horímetro" span={2}><Input type="number" step="0.1" value={h.hour_meter} onChange={(e) => setH({ ...h, hour_meter: e.target.value })} /></Field>
      <Field label="Km" span={2}><Input type="number" step="0.1" value={h.mileage} onChange={(e) => setH({ ...h, mileage: e.target.value })} /></Field>
      <Field label="Centro de Custo" span={4}><RefSelect resource="cost_centers" value={h.cost_center_id} onChange={(v) => setH({ ...h, cost_center_id: v ?? "" })} filter={{ kind: "analytic" }} /></Field>
      <Field label="Safra" span={4}><RefSelect resource="harvests" value={h.harvest_id} onChange={(v) => setH({ ...h, harvest_id: v ?? "" })} /></Field>
      <Field label="Observação" span={12}><Textarea value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></Field>
    </div>
  </CardBody></Card>;
}
