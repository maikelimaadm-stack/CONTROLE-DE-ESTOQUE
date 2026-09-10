"use client";
import * as React from "react";
import { todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input, NativeSelect } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { useFarmDefault, useCreate, DocList, colDate, colStatus } from "@/features/docs/shared";
import { AnimalPicker } from "@/features/livestock/shared";
export default function Page() {
  const farm = useFarmDefault(); const [f, setF] = React.useState({ farm_id: "", destination_farm_id: "", movement_date: todayISO(), batch_id: "", destination_batch_id: "", note: "", mode: "batch" }); const [sel, setSel] = React.useState<string[]>([]);
  React.useEffect(() => { setF((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const create = useCreate("/api/livestock/transfers/to-farm", () => setSel([]));
  return <div className="space-y-3"><Card><CardHeader title="Transferência entre Fazendas" subtitle="Cria um movimento pendente; a fazenda de destino processa o recebimento (tela do movimento)." actions={<Button size="sm" loading={create.isPending} disabled={!f.destination_farm_id || (f.mode === "batch" ? !f.batch_id : !sel.length)} onClick={() => create.mutate({ farm_id: f.farm_id, destination_farm_id: f.destination_farm_id, movement_date: f.movement_date, batch_id: f.mode === "batch" ? f.batch_id : null, animal_ids: f.mode === "animals" ? sel : undefined, destination_batch_id: f.destination_batch_id || null, note: f.note || null })}>Transferir</Button>} /><CardBody className="space-y-3">
    <div className="grid grid-cols-12 gap-2"><Field label="Fazenda origem" span={3}><RefSelect resource="farms" value={f.farm_id} onChange={(v) => setF({ ...f, farm_id: v ?? "" })} /></Field><Field label="Fazenda destino" required span={3}><RefSelect resource="farms" value={f.destination_farm_id} onChange={(v) => setF({ ...f, destination_farm_id: v ?? "" })} /></Field><Field label="Data" span={2}><Input type="date" value={f.movement_date} onChange={(e) => setF({ ...f, movement_date: e.target.value })} /></Field><Field label="Modo" span={2}><NativeSelect value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="batch">Lote inteiro</option><option value="animals">Animais selecionados</option></NativeSelect></Field>
      {f.mode === "batch" ? <Field label="Lote" required span={4}><RefSelect resource="batches" value={f.batch_id} onChange={(v) => setF({ ...f, batch_id: v ?? "" })} /></Field> : null}<Field label="Lote destino (opcional)" span={4}><RefSelect resource="batches" value={f.destination_batch_id} onChange={(v) => setF({ ...f, destination_batch_id: v ?? "" })} /></Field><Field label="Observação" span={4}><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field></div>
    {f.mode === "animals" && <AnimalPicker selected={sel} onChange={setSel} farmId={f.farm_id || undefined} />}
  </CardBody></Card>
  <DocList title="Transferências entre fazendas" endpoint="/api/livestock/movements" base="/pecuaria/movimentacoes/farm_transfer" defaultFilters={{ movement_type: "farm_transfer" }} hideNew columns={[{ key: "code", label: "Código" }, colDate("movement_date", "Data"), { key: "farm_name", label: "Origem" }, { key: "batch_name", label: "Lote" }, { key: "quantity", label: "Cabeças", align: "right" }, colStatus()]} /></div>;
}
