"use client";
import * as React from "react";
import { todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { useFarmDefault, useCreate } from "@/features/docs/shared";
import { AnimalPicker } from "@/features/livestock/shared";
export function TransferAnimalsToBatch() {
  const farm = useFarmDefault(); const [f, setF] = React.useState({ farm_id: "", movement_date: todayISO(), destination_batch_id: "", source_batch_id: "", note: "" }); const [sel, setSel] = React.useState<string[]>([]);
  React.useEffect(() => { setF((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const create = useCreate("/api/livestock/transfers/animals-to-batch", () => setSel([]));
  return <Card><CardHeader title="Transferência de Animais entre Lotes" actions={<Button size="sm" loading={create.isPending} disabled={!sel.length || !f.destination_batch_id} onClick={() => create.mutate({ farm_id: f.farm_id, movement_date: f.movement_date, animal_ids: sel, destination_batch_id: f.destination_batch_id, note: f.note || null })}>Transferir {sel.length} animal(is)</Button>} /><CardBody className="space-y-3">
    <div className="grid grid-cols-12 gap-2"><Field label="Fazenda" span={3}><RefSelect resource="farms" value={f.farm_id} onChange={(v) => setF({ ...f, farm_id: v ?? "" })} /></Field><Field label="Data" span={2}><Input type="date" value={f.movement_date} onChange={(e) => setF({ ...f, movement_date: e.target.value })} /></Field><Field label="Filtrar lote de origem" span={3}><RefSelect resource="batches" value={f.source_batch_id} onChange={(v) => setF({ ...f, source_batch_id: v ?? "" })} /></Field><Field label="Lote de destino" required span={4}><RefSelect resource="batches" value={f.destination_batch_id} onChange={(v) => setF({ ...f, destination_batch_id: v ?? "" })} /></Field></div>
    <AnimalPicker selected={sel} onChange={setSel} farmId={f.farm_id || undefined} batchId={f.source_batch_id || undefined} />
  </CardBody></Card>;
}
