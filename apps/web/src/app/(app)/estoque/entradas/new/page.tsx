"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { ItemsEditor, useCreate, useFarmDefault, type ItemRow } from "@/features/docs/shared";
export default function Page() {
  const router = useRouter(); const farm = useFarmDefault();
  const [h, setH] = React.useState({ farm_id: "", entry_date: todayISO(), harvest_id: "", proprietary_id: "", note: "", pay: "false", account_id: "", movement_date: todayISO() });
  const [items, setItems] = React.useState<ItemRow[]>([]);
  React.useEffect(() => { setH((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const create = useCreate("/api/stock/input-entries", () => router.push("/estoque/entradas"));
  const submit = () => create.mutate({ farm_id: h.farm_id, entry_date: h.entry_date, harvest_id: h.harvest_id || null, proprietary_id: h.proprietary_id || null, note: h.note || null, items: items.map((i) => ({ product_id: i.product_id, quantity: i.quantity, unit_value: i.unit_value, generate_stock: i.generate_stock !== false, warehouse_id: i.warehouse_id || null, provider_lot: i.provider_lot || null, expiration_date: i.expiration_date || null, financial_category_id: i.financial_category_id || null, cost_center_id: i.cost_center_id || null })), bank_movement: h.pay === "true" ? { account_id: h.account_id, date: h.movement_date } : null });
  return <Card><CardHeader title="Nova Entrada / Insumos" actions={<><Button variant="outline" size="sm" onClick={() => router.back()}>Voltar</Button><Button size="sm" loading={create.isPending} onClick={submit} disabled={!items.length}>Salvar</Button></>} /><CardBody className="space-y-4">
    <div className="grid grid-cols-12 gap-3">
      <Field label="Fazenda" required span={3}><RefSelect resource="farms" value={h.farm_id} onChange={(v) => setH({ ...h, farm_id: v ?? "" })} /></Field>
      <Field label="Data" required span={2}><Input type="date" value={h.entry_date} onChange={(e) => setH({ ...h, entry_date: e.target.value })} /></Field>
      <Field label="Safra" span={3}><RefSelect resource="harvests" value={h.harvest_id} onChange={(v) => setH({ ...h, harvest_id: v ?? "" })} /></Field>
      <Field label="Proprietário Gestor" span={4}><RefSelect resource="people" value={h.proprietary_id} onChange={(v) => setH({ ...h, proprietary_id: v ?? "" })} filter={{ is_proprietary: "true" }} /></Field>
      <Field label="Observação" span={12}><Textarea value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></Field>
    </div>
    <h3 className="text-xs font-semibold uppercase text-brand-700">Itens</h3>
    <ItemsEditor items={items} onChange={setItems} fields={["warehouse", "product", "quantity", "unit_value", "generate_stock", "lot", "expiration", "financial_category", "cost_center"]} />
    <div className="grid grid-cols-12 gap-3">
      <Field label="Gerar Movimento Bancário" span={3}><NativeSelect value={h.pay} onChange={(e) => setH({ ...h, pay: e.target.value })}><option value="false">Não</option><option value="true">Sim</option></NativeSelect></Field>
      {h.pay === "true" && <><Field label="Conta Bancária" required span={4}><RefSelect resource="bank_accounts" value={h.account_id} onChange={(v) => setH({ ...h, account_id: v ?? "" })} /></Field><Field label="Data do Movimento" span={2}><Input type="date" value={h.movement_date} onChange={(e) => setH({ ...h, movement_date: e.target.value })} /></Field></>}
    </div>
  </CardBody></Card>;
}
