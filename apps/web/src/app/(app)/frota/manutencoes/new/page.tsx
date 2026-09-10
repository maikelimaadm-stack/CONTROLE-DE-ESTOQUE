"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { todayISO, brl } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { ItemsEditor, useCreate, useFarmDefault, type ItemRow } from "@/features/docs/shared";
import { Trash2, Plus } from "lucide-react";
interface Machine { equipment_id: string; hour_meter: string; mileage: string; maintenance_type: string; executor_person_id: string; hours: string; service_total: string; service_description: string; items: ItemRow[] }
const blank = (): Machine => ({ equipment_id: "", hour_meter: "", mileage: "", maintenance_type: "employee", executor_person_id: "", hours: "", service_total: "0", service_description: "", items: [] });
export default function Page() {
  const router = useRouter(); const farm = useFarmDefault();
  const [h, setH] = React.useState({ farm_id: "", maintenance_date: todayISO(), harvest_id: "", note: "" }); const [ms, setMs] = React.useState<Machine[]>([blank()]);
  React.useEffect(() => { setH((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const create = useCreate<{ id: string }>("/api/fleet/maintenances", (r) => router.push(`/frota/manutencoes/${r.id}`));
  const upd = (i: number, p: Partial<Machine>) => setMs(ms.map((m, j) => (j === i ? { ...m, ...p } : m)));
  const total = ms.reduce((a, m) => a + Number(m.service_total || 0) + m.items.reduce((b, it) => b + Number(it.quantity || 0) * Number(it.unit_value || 0), 0), 0);
  const submit = () => create.mutate({ farm_id: h.farm_id, maintenance_date: h.maintenance_date, harvest_id: h.harvest_id || null, note: h.note || null, machines: ms.map((m) => ({ equipment_id: m.equipment_id, hour_meter: m.hour_meter || null, mileage: m.mileage || null, maintenance_type: m.maintenance_type || null, executor_person_id: m.executor_person_id || null, hours: m.hours || null, service_total: m.service_total || "0", service_description: m.service_description || null, items: m.items.map((it) => ({ warehouse_id: it.warehouse_id || null, product_id: it.product_id, quantity: it.quantity, unit_value: it.unit_value || null, note: null })) })) });
  return <Card><CardHeader title="Nova Manutenção" subtitle="Peças e insumos saem do estoque do armazém informado (custo médio); serviços compõem o custo da máquina." actions={<><Button variant="outline" size="sm" onClick={() => router.back()}>Voltar</Button><Button size="sm" loading={create.isPending} disabled={ms.some((m) => !m.equipment_id)} onClick={submit}>Salvar</Button></>} /><CardBody className="space-y-4">
    <div className="grid grid-cols-12 gap-3">
      <Field label="Fazenda" required span={3}><RefSelect resource="farms" value={h.farm_id} onChange={(v) => setH({ ...h, farm_id: v ?? "" })} /></Field>
      <Field label="Data" required span={2}><Input type="date" value={h.maintenance_date} onChange={(e) => setH({ ...h, maintenance_date: e.target.value })} /></Field>
      <Field label="Safra" span={3}><RefSelect resource="harvests" value={h.harvest_id} onChange={(v) => setH({ ...h, harvest_id: v ?? "" })} /></Field>
      <Field label="Observação" span={4}><Textarea value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></Field>
    </div>
    {ms.map((m, i) => <div key={i} className="space-y-2 rounded border p-3">
      <div className="flex items-center justify-between"><h3 className="text-xs font-semibold uppercase text-brand-700">Máquina {i + 1}</h3>{ms.length > 1 && <button className="text-slate-400 hover:text-red-600" onClick={() => setMs(ms.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>}</div>
      <div className="grid grid-cols-12 gap-2">
        <Field label="Máquina / equipamento" required span={4}><RefSelect resource="equipments" value={m.equipment_id} onChange={(v) => upd(i, { equipment_id: v ?? "" })} /></Field>
        <Field label="Horímetro" span={2}><Input type="number" step="0.1" value={m.hour_meter} onChange={(e) => upd(i, { hour_meter: e.target.value })} /></Field>
        <Field label="Km" span={2}><Input type="number" step="0.1" value={m.mileage} onChange={(e) => upd(i, { mileage: e.target.value })} /></Field>
        <Field label="Executor" span={2}><NativeSelect value={m.maintenance_type} onChange={(e) => upd(i, { maintenance_type: e.target.value })}><option value="employee">Funcionário</option><option value="provider">Fornecedor/terceiro</option></NativeSelect></Field>
        <Field label="Pessoa executora" span={2}><RefSelect resource="people" value={m.executor_person_id} onChange={(v) => upd(i, { executor_person_id: v ?? "" })} filter={m.maintenance_type === "employee" ? { is_employee: "true" } : { is_provider: "true" }} /></Field>
        <Field label="Horas" span={2}><Input type="number" step="0.1" value={m.hours} onChange={(e) => upd(i, { hours: e.target.value })} /></Field>
        <Field label="Valor serviço" span={2}><Input type="number" step="0.01" value={m.service_total} onChange={(e) => upd(i, { service_total: e.target.value })} /></Field>
        <Field label="Descrição do serviço" span={8}><Input value={m.service_description} onChange={(e) => upd(i, { service_description: e.target.value })} /></Field>
      </div>
      <ItemsEditor items={m.items} onChange={(items) => upd(i, { items })} fields={["warehouse", "product", "stock", "quantity", "unit_value"]} />
    </div>)}
    <div className="flex items-center gap-4"><Button size="sm" variant="outline" onClick={() => setMs([...ms, blank()])}><Plus className="h-3.5 w-3.5" /> Adicionar máquina</Button><span className="font-semibold">Total da manutenção: {brl(total)}</span></div>
  </CardBody></Card>;
}
