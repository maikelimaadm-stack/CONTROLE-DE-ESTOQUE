"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { todayISO, brl } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { useCreate, useFarmDefault } from "@/features/docs/shared";
import { Trash2, Plus } from "lucide-react";
const SEC: Record<string, string> = { labor: "Mão de obra", machine: "Equipamentos", input: "Insumos", ppe: "EPIs", production: "Produção" };
interface Line { section: string; person_id: string; equipment_id: string; product_id: string; warehouse_id: string; quantity: string; unit_value: string; hours: string; note: string }
export default function Page() {
  const router = useRouter(); const farm = useFarmDefault();
  const [h, setH] = React.useState({ farm_id: "", order_date: todayISO(), harvest_id: "", activity_id: "", operation_id: "", cost_center_id: "", responsible_person_id: "", team_id: "", description: "", planned_start: "", planned_end: "" });
  const [lines, setLines] = React.useState<Line[]>([]);
  React.useEffect(() => { setH((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const create = useCreate<{ id: string }>("/api/service-orders", (r) => router.push(`/os/${r.id}`));
  const upd = (i: number, p: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const add = (section: string) => setLines([...lines, { section, person_id: "", equipment_id: "", product_id: "", warehouse_id: "", quantity: "1", unit_value: "0", hours: "", note: "" }]);
  const total = lines.reduce((a, l) => a + Number(l.quantity || 0) * Number(l.unit_value || 0), 0);
  const submit = () => create.mutate({ ...h, harvest_id: h.harvest_id || null, activity_id: h.activity_id || null, operation_id: h.operation_id || null, cost_center_id: h.cost_center_id || null, responsible_person_id: h.responsible_person_id || null, team_id: h.team_id || null, description: h.description || null, planned_start: h.planned_start || null, planned_end: h.planned_end || null, lines: lines.map((l) => ({ section: l.section, person_id: l.person_id || null, equipment_id: l.equipment_id || null, product_id: l.product_id || null, warehouse_id: l.warehouse_id || null, quantity: l.quantity || "0", unit_value: l.unit_value || "0", hours: l.hours || null, note: l.note || null })) });
  return <Card><CardHeader title="Nova ordem de serviço" subtitle="Insumos/EPIs com armazém são baixados do estoque ao finalizar a OS." actions={<><Button variant="outline" size="sm" onClick={() => router.back()}>Voltar</Button><Button size="sm" loading={create.isPending} disabled={!h.farm_id} onClick={submit}>Salvar</Button></>} /><CardBody className="space-y-4">
    <div className="grid grid-cols-12 gap-3">
      <Field label="Fazenda" required span={3}><RefSelect resource="farms" value={h.farm_id} onChange={(v) => setH({ ...h, farm_id: v ?? "" })} /></Field>
      <Field label="Data" required span={2}><Input type="date" value={h.order_date} onChange={(e) => setH({ ...h, order_date: e.target.value })} /></Field>
      <Field label="Safra" span={3}><RefSelect resource="harvests" value={h.harvest_id} onChange={(v) => setH({ ...h, harvest_id: v ?? "" })} /></Field>
      <Field label="Atividade" span={2}><RefSelect resource="activities" value={h.activity_id} onChange={(v) => setH({ ...h, activity_id: v ?? "" })} /></Field>
      <Field label="Operação" span={2}><RefSelect resource="operations" value={h.operation_id} onChange={(v) => setH({ ...h, operation_id: v ?? "" })} /></Field>
      <Field label="Centro de Custo" span={3}><RefSelect resource="cost_centers" value={h.cost_center_id} onChange={(v) => setH({ ...h, cost_center_id: v ?? "" })} filter={{ kind: "analytic" }} /></Field>
      <Field label="Responsável" span={3}><RefSelect resource="people" value={h.responsible_person_id} onChange={(v) => setH({ ...h, responsible_person_id: v ?? "" })} filter={{ is_employee: "true" }} /></Field>
      <Field label="Equipe" span={2}><RefSelect resource="teams" value={h.team_id} onChange={(v) => setH({ ...h, team_id: v ?? "" })} /></Field>
      <Field label="Início previsto" span={2}><Input type="date" value={h.planned_start} onChange={(e) => setH({ ...h, planned_start: e.target.value })} /></Field>
      <Field label="Término previsto" span={2}><Input type="date" value={h.planned_end} onChange={(e) => setH({ ...h, planned_end: e.target.value })} /></Field>
      <Field label="Descrição" span={12}><Textarea value={h.description} onChange={(e) => setH({ ...h, description: e.target.value })} /></Field>
    </div>
    <div className="flex flex-wrap gap-2">{Object.entries(SEC).map(([k, l]) => <Button key={k} size="sm" variant="outline" onClick={() => add(k)}><Plus className="h-3.5 w-3.5" /> {l}</Button>)}<span className="ml-auto self-center font-semibold">Custo previsto: {brl(total)}</span></div>
    <div className="overflow-x-auto rounded border"><table className="table-dense w-full text-[12.5px]"><thead><tr><th>Seção</th><th className="min-w-[200px]">Pessoa / equipamento / produto</th><th className="min-w-[160px]">Armazém</th><th className="w-20">Quantidade</th><th className="w-24">Valor unitário</th><th className="w-20">Horas</th><th>Observação</th><th className="w-8" /></tr></thead><tbody>
      {lines.map((l, i) => <tr key={i}><td><NativeSelect value={l.section} onChange={(e) => upd(i, { section: e.target.value })}>{Object.entries(SEC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></td>
        <td>{l.section === "labor" ? <RefSelect resource="people" value={l.person_id} onChange={(v) => upd(i, { person_id: v ?? "" })} filter={{ is_employee: "true" }} /> : l.section === "machine" ? <RefSelect resource="equipments" value={l.equipment_id} onChange={(v) => upd(i, { equipment_id: v ?? "" })} /> : <RefSelect resource="products" value={l.product_id} onChange={(v) => upd(i, { product_id: v ?? "" })} />}</td>
        <td>{(l.section === "input" || l.section === "ppe") && <RefSelect resource="warehouses" value={l.warehouse_id} onChange={(v) => upd(i, { warehouse_id: v ?? "" })} />}</td>
        <td><Input type="number" step="0.0001" value={l.quantity} onChange={(e) => upd(i, { quantity: e.target.value })} /></td><td><Input type="number" step="0.01" value={l.unit_value} onChange={(e) => upd(i, { unit_value: e.target.value })} /></td><td><Input type="number" step="0.1" value={l.hours} onChange={(e) => upd(i, { hours: e.target.value })} /></td><td><Input value={l.note} onChange={(e) => upd(i, { note: e.target.value })} /></td>
        <td><button className="p-1 text-slate-400 hover:text-red-600" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></td></tr>)}
    </tbody></table></div>
  </CardBody></Card>;
}
