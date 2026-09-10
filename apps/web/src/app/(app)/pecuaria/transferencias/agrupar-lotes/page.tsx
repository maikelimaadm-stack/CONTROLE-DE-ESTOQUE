"use client";
import * as React from "react";
import { todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input, NativeSelect } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { useFarmDefault, useCreate } from "@/features/docs/shared";
import { Trash2 } from "lucide-react";
export default function Page() {
  const farm = useFarmDefault(); const [f, setF] = React.useState({ farm_id: "", movement_date: todayISO(), destination_batch_id: "", close_sources: "true" }); const [src, setSrc] = React.useState<string[]>([""]);
  React.useEffect(() => { setF((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const create = useCreate("/api/livestock/transfers/group-batches", () => setSrc([""]));
  const ids = src.filter(Boolean);
  return <Card><CardHeader title="Agrupar Lotes" subtitle="Move todos os animais (identificados e por contagem) dos lotes de origem para o lote de destino; opcionalmente encerra os lotes de origem." actions={<Button size="sm" loading={create.isPending} disabled={!ids.length || !f.destination_batch_id} onClick={() => create.mutate({ farm_id: f.farm_id, movement_date: f.movement_date, source_batch_ids: ids, destination_batch_id: f.destination_batch_id, close_sources: f.close_sources === "true" })}>Agrupar</Button>} /><CardBody className="space-y-3">
    <div className="grid grid-cols-12 gap-2"><Field label="Fazenda" span={3}><RefSelect resource="farms" value={f.farm_id} onChange={(v) => setF({ ...f, farm_id: v ?? "" })} /></Field><Field label="Data" span={2}><Input type="date" value={f.movement_date} onChange={(e) => setF({ ...f, movement_date: e.target.value })} /></Field><Field label="Lote de destino" required span={4}><RefSelect resource="batches" value={f.destination_batch_id} onChange={(v) => setF({ ...f, destination_batch_id: v ?? "" })} /></Field><Field label="Encerrar lotes de origem" span={3}><NativeSelect value={f.close_sources} onChange={(e) => setF({ ...f, close_sources: e.target.value })}><option value="true">Sim</option><option value="false">Não</option></NativeSelect></Field></div>
    <h3 className="text-xs font-semibold uppercase text-brand-700">Lotes de origem</h3>
    {src.map((s, i) => <div key={i} className="flex max-w-lg gap-2"><RefSelect resource="batches" value={s} onChange={(v) => setSrc(src.map((x, j) => (j === i ? v ?? "" : x)))} /><button className="text-slate-400 hover:text-red-600" onClick={() => setSrc(src.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></div>)}
    <Button size="sm" variant="outline" onClick={() => setSrc([...src, ""])}>+ lote</Button>
  </CardBody></Card>;
}
