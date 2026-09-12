"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { useCreate, useFarmDefault, type Row } from "@/features/docs/shared";
import { AnimalPicker } from "@/features/livestock/shared";
export default function Page() {
  const router = useRouter(); const farm = useFarmDefault();
  const [f, setF] = React.useState({ farm_id: "", weighing_date: todayISO(), batch_id: "", responsible: "", note: "" }); const [sel, setSel] = React.useState<string[]>([]); const [rows, setRows] = React.useState<Row[]>([]); const [w, setW] = React.useState<Record<string, string>>({});
  React.useEffect(() => { setF((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const create = useCreate("/api/livestock/weighings", () => router.push("/pecuaria?tab=manejos&sub=weighing"));
  const items = sel.filter((id) => Number(w[id]) > 0).map((id) => ({ animal_id: id, weight: w[id]! }));
  return <Card><CardHeader title="Nova pesagem" subtitle="Calcula GMD (kg/dia) em relação à pesagem anterior de cada animal e atualiza o peso atual." actions={<><Button variant="outline" size="sm" onClick={() => router.back()}>Voltar</Button><Button size="sm" loading={create.isPending} disabled={!items.length} onClick={() => create.mutate({ ...f, batch_id: f.batch_id || null, responsible: f.responsible || null, note: f.note || null, items })}>Salvar ({items.length})</Button></>} /><CardBody className="space-y-3">
    <div className="grid grid-cols-12 gap-2"><Field label="Fazenda" span={3}><RefSelect resource="farms" value={f.farm_id} onChange={(v) => setF({ ...f, farm_id: v ?? "" })} /></Field><Field label="Data" span={2}><Input type="date" value={f.weighing_date} onChange={(e) => setF({ ...f, weighing_date: e.target.value })} /></Field><Field label="Lote" span={3}><RefSelect resource="batches" value={f.batch_id} onChange={(v) => setF({ ...f, batch_id: v ?? "" })} /></Field><Field label="Responsável" span={2}><Input value={f.responsible} onChange={(e) => setF({ ...f, responsible: e.target.value })} /></Field><Field label="Observação" span={2}><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field></div>
    <AnimalPicker selected={sel} onChange={(ids, r) => { setSel(ids); setRows(r); }} farmId={f.farm_id || undefined} batchId={f.batch_id || undefined} />
    {sel.length > 0 && <table className="table-dense w-full max-w-2xl text-[12px]"><thead><tr><th>Animal</th><th className="text-right">Peso anterior</th><th className="w-32">Peso (kg)</th></tr></thead><tbody>{sel.map((id) => { const r = rows.find((x) => x["id"] === id); return <tr key={id}><td>{String(r?.["identifications"] ?? id)}</td><td className="num">{r?.["current_weight"] ? String(r["current_weight"]) : "—"}</td><td><Input type="number" step="0.1" value={w[id] ?? ""} onChange={(e) => setW({ ...w, [id]: e.target.value })} /></td></tr>; })}</tbody></table>}
  </CardBody></Card>;
}
