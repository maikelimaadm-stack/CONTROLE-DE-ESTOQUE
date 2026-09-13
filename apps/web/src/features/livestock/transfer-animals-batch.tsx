"use client";
import * as React from "react";
import { todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { useEmpresaPadrao, useCreate } from "@/features/docs/shared";
import { AnimalPicker } from "@/features/livestock/shared";
export function TransferAnimalsToBatch({ animalIds, onDone }: { animalIds?: string[]; onDone?: () => void } = {}) {
  const empresa = useEmpresaPadrao(); const [f, setF] = React.useState({ empresa_id: "", movement_date: todayISO(), destination_batch_id: "", source_batch_id: "", note: "" }); const [sel, setSel] = React.useState<string[]>(animalIds ?? []);
  React.useEffect(() => { setF((o) => ({ ...o, empresa_id: o.empresa_id || empresa })); }, [empresa]);
  const create = useCreate("/api/livestock/transfers/animals-to-batch", () => { setSel([]); onDone?.(); });
  return <Card><CardHeader title="Transferência de Animais entre Lotes" actions={<Button size="sm" loading={create.isPending} disabled={!sel.length || !f.destination_batch_id} onClick={() => create.mutate({ empresa_id: f.empresa_id, movement_date: f.movement_date, animal_ids: sel, destination_batch_id: f.destination_batch_id, note: f.note || null })}>Transferir {sel.length} animal(is)</Button>} /><CardBody className="space-y-3">
    <div className="grid grid-cols-12 gap-2"><Field label="Empresa" span={3}><RefSelect resource="empresas" value={f.empresa_id} onChange={(v) => setF({ ...f, empresa_id: v ?? "" })} /></Field><Field label="Data" span={2}><Input type="date" value={f.movement_date} onChange={(e) => setF({ ...f, movement_date: e.target.value })} /></Field><Field label="Filtrar lote de origem" span={3}><RefSelect resource="batches" value={f.source_batch_id} onChange={(v) => setF({ ...f, source_batch_id: v ?? "" })} /></Field><Field label="Lote de destino" required span={4}><RefSelect resource="batches" value={f.destination_batch_id} onChange={(v) => setF({ ...f, destination_batch_id: v ?? "" })} /></Field></div>
    <AnimalPicker selected={sel} onChange={setSel} empresaId={f.empresa_id || undefined} batchId={f.source_batch_id || undefined} />
  </CardBody></Card>;
}
