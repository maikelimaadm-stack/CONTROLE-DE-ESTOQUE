"use client";
import * as React from "react";
import { todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { useFarmDefault, useCreate, DocList, colDate } from "@/features/docs/shared";
export default function Page() {
  const farm = useFarmDefault(); const [f, setF] = React.useState({ farm_id: "", movement_date: todayISO(), batch_id: "", grazing_module_id: "", area_id: "", corral_id: "", note: "" });
  React.useEffect(() => { setF((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const create = useCreate("/api/livestock/transfers/batch-to-module-area", () => setF({ ...f, batch_id: "" }));
  return <div className="space-y-3"><Card><CardHeader title="Transferência de Lote → Módulo / Área / Curral" subtitle="Atualiza a localização do lote (pastejo rotacionado ou confinamento) e registra o histórico." actions={<Button size="sm" loading={create.isPending} disabled={!f.batch_id || !(f.grazing_module_id || f.area_id || f.corral_id)} onClick={() => create.mutate({ ...f, grazing_module_id: f.grazing_module_id || null, area_id: f.area_id || null, corral_id: f.corral_id || null, note: f.note || null })}>Transferir</Button>} /><CardBody>
    <div className="grid grid-cols-12 gap-2"><Field label="Fazenda" span={3}><RefSelect resource="farms" value={f.farm_id} onChange={(v) => setF({ ...f, farm_id: v ?? "" })} /></Field><Field label="Data" span={2}><Input type="date" value={f.movement_date} onChange={(e) => setF({ ...f, movement_date: e.target.value })} /></Field><Field label="Lote" required span={4}><RefSelect resource="batches" value={f.batch_id} onChange={(v) => setF({ ...f, batch_id: v ?? "" })} /></Field>
      <Field label="Módulo de pastejo" span={4}><RefSelect resource="grazing_modules" value={f.grazing_module_id} onChange={(v) => setF({ ...f, grazing_module_id: v ?? "" })} /></Field><Field label="Área / piquete" span={4}><RefSelect resource="areas" value={f.area_id} onChange={(v) => setF({ ...f, area_id: v ?? "" })} /></Field><Field label="Curral (confinamento)" span={4}><RefSelect resource="feedlot_corrals" value={f.corral_id} onChange={(v) => setF({ ...f, corral_id: v ?? "" })} /></Field><Field label="Observação" span={12}><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field></div>
  </CardBody></Card>
  <DocList title="Histórico" endpoint="/api/livestock/movements" base="/pecuaria/movimentacoes/batch_module_area_transfer" defaultFilters={{ movement_type: "batch_module_area_transfer" }} hideNew columns={[{ key: "code", label: "Código" }, colDate("movement_date", "Data"), { key: "batch_name", label: "Lote" }, { key: "note", label: "Destino / obs." }]} /></div>;
}
