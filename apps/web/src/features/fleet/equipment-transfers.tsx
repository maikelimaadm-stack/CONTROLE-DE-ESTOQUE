"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateBR, todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input, Spinner } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { SimpleTable, useCreate, type Row } from "@/features/docs/shared";
/** Transferência de máquina entre fazendas + histórico (ação contextual a partir da máquina: `equipmentId`). */
export function EquipmentTransfersPanel({ equipmentId }: { equipmentId?: string } = {}) {
  const { can } = useAuth(); const q = useQuery({ queryKey: ["eq-transfers"], queryFn: () => api<{ items: Row[] }>("/api/fleet/equipment-transfers") });
  const [h, setH] = React.useState({ equipment_id: equipmentId ?? "", destination_farm_id: "", transfer_date: todayISO(), note: "" });
  const create = useCreate("/api/fleet/equipment-transfers", () => { setH({ ...h, equipment_id: "" }); void q.refetch(); });
  return <div className="space-y-3">
    {can("equipment_transfers.create") && <Card><CardHeader title="Transferência de Equipamento entre Fazendas" /><CardBody><div className="grid grid-cols-12 gap-3">
      <Field label="Equipamento" required span={4}><RefSelect resource="equipments" value={h.equipment_id} onChange={(v) => setH({ ...h, equipment_id: v ?? "" })} /></Field>
      <Field label="Fazenda destino" required span={3}><RefSelect resource="farms" value={h.destination_farm_id} onChange={(v) => setH({ ...h, destination_farm_id: v ?? "" })} /></Field>
      <Field label="Data" span={2}><Input type="date" value={h.transfer_date} onChange={(e) => setH({ ...h, transfer_date: e.target.value })} /></Field>
      <Field label="Observação" span={2}><Input value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></Field>
      <div className="col-span-1 flex items-end"><Button size="sm" loading={create.isPending} disabled={!h.equipment_id || !h.destination_farm_id} onClick={() => create.mutate({ ...h, note: h.note || null })}>Transferir</Button></div>
    </div></CardBody></Card>}
    <Card><CardHeader title="Histórico de transferências" /><CardBody>{q.isLoading ? <Spinner /> : <SimpleTable rows={q.data?.items ?? []} cols={[{ key: "transfer_date", label: "Data", render: (r) => dateBR(r["transfer_date"] as string) }, { key: "equipment_name", label: "Equipamento" }, { key: "origin_farm_name", label: "Origem" }, { key: "destination_farm_name", label: "Destino" }, { key: "created_by_name", label: "Usuário" }, { key: "note", label: "Observação" }]} />}</CardBody></Card>
  </div>;
}
