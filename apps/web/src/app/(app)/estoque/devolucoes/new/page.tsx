"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { ItemsEditor, useCreate, useFarmDefault, type ItemRow } from "@/features/docs/shared";
export default function Page() {
  const router = useRouter(); const farm = useFarmDefault();
  const [h, setH] = React.useState({ farm_id: "", devolution_date: todayISO(), responsible_person_id: "", harvest_id: "" });
  const [items, setItems] = React.useState<ItemRow[]>([]);
  React.useEffect(() => { setH((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const create = useCreate("/api/stock/devolutions", () => router.push("/estoque/devolucoes"));
  return <Card><CardHeader title="Devolução do Estoque (entrada)" actions={<><Button variant="outline" size="sm" onClick={() => router.back()}>Voltar</Button><Button size="sm" loading={create.isPending} disabled={!items.length} onClick={() => create.mutate({ ...h, responsible_person_id: h.responsible_person_id || null, harvest_id: h.harvest_id || null, items: items.map((i) => ({ warehouse_id: i.warehouse_id, product_id: i.product_id, quantity: i.quantity, unit_value: i.unit_value && Number(i.unit_value) > 0 ? i.unit_value : null, cost_center_id: i.cost_center_id || null })) })}>Salvar</Button></>} /><CardBody className="space-y-4">
    <div className="grid grid-cols-12 gap-3">
      <Field label="Fazenda" required span={3}><RefSelect resource="farms" value={h.farm_id} onChange={(v) => setH({ ...h, farm_id: v ?? "" })} /></Field>
      <Field label="Data" required span={2}><Input type="date" value={h.devolution_date} onChange={(e) => setH({ ...h, devolution_date: e.target.value })} /></Field>
      <Field label="Responsável Devolução" span={4}><RefSelect resource="people" value={h.responsible_person_id} onChange={(v) => setH({ ...h, responsible_person_id: v ?? "" })} /></Field>
      <Field label="Safra" span={3}><RefSelect resource="harvests" value={h.harvest_id} onChange={(v) => setH({ ...h, harvest_id: v ?? "" })} /></Field>
    </div>
    <ItemsEditor items={items} onChange={setItems} fields={["warehouse", "product", "quantity", "unit_value", "cost_center"]} />
    <p className="text-xs text-slate-500">Valor unitário em branco/zero usa o custo médio do produto.</p>
  </CardBody></Card>;
}
