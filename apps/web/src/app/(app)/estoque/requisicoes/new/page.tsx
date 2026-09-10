"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input, NativeSelect } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { ItemsEditor, useCreate, useFarmDefault, type ItemRow } from "@/features/docs/shared";
export default function Page() {
  const router = useRouter(); const farm = useFarmDefault();
  const [h, setH] = React.useState({ farm_id: "", requisition_date: todayISO(), classification: "unclassified", requester_person_id: "", area_id: "", harvest_id: "" });
  const [items, setItems] = React.useState<ItemRow[]>([]);
  React.useEffect(() => { setH((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const create = useCreate("/api/stock/requisitions", () => router.push("/estoque/requisicoes"));
  return <Card><CardHeader title="Requisição do Estoque (saída)" actions={<><Button variant="outline" size="sm" onClick={() => router.back()}>Voltar</Button><Button size="sm" loading={create.isPending} disabled={!items.length} onClick={() => create.mutate({ ...h, requester_person_id: h.requester_person_id || null, area_id: h.area_id || null, harvest_id: h.harvest_id || null, items: items.map((i) => ({ warehouse_id: i.warehouse_id, product_id: i.product_id, quantity: i.quantity, provider_lot: i.provider_lot || null, cost_center_id: i.cost_center_id || null })) })}>Salvar</Button></>} /><CardBody className="space-y-4">
    <div className="grid grid-cols-12 gap-3">
      <Field label="Fazenda" required span={3}><RefSelect resource="farms" value={h.farm_id} onChange={(v) => setH({ ...h, farm_id: v ?? "" })} /></Field>
      <Field label="Data" required span={2}><Input type="date" value={h.requisition_date} onChange={(e) => setH({ ...h, requisition_date: e.target.value })} /></Field>
      <Field label="Classificação" required span={2}><NativeSelect value={h.classification} onChange={(e) => setH({ ...h, classification: e.target.value })}><option value="unclassified">Não Classificado</option><option value="capex">CAPEX</option><option value="opex">OPEX</option></NativeSelect></Field>
      <Field label="Requisitante" span={3}><RefSelect resource="people" value={h.requester_person_id} onChange={(v) => setH({ ...h, requester_person_id: v ?? "" })} filter={{ is_employee: "true" }} /></Field>
      <Field label="Área" span={2}><RefSelect resource="areas" value={h.area_id} onChange={(v) => setH({ ...h, area_id: v ?? "" })} /></Field>
      <Field label="Safra" span={3}><RefSelect resource="harvests" value={h.harvest_id} onChange={(v) => setH({ ...h, harvest_id: v ?? "" })} /></Field>
    </div>
    <h3 className="text-xs font-semibold uppercase text-brand-700">Itens</h3>
    <ItemsEditor items={items} onChange={setItems} fields={["warehouse", "product", "stock", "quantity", "lot", "cost_center"]} />
    <p className="text-xs text-slate-500">Saídas são valoradas ao custo médio; saldo insuficiente é bloqueado.</p>
  </CardBody></Card>;
}
