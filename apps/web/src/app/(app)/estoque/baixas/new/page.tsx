"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { ItemsEditor, useCreate, useFarmDefault, type ItemRow } from "@/features/docs/shared";
const REASONS: [string, string][] = [["loss", "Perda"], ["deterioration", "Deterioração"], ["theft", "Roubo"], ["damage", "Avaria"], ["inventory", "Inventário"], ["accounting", "Contabilização"], ["burglary", "Furto"], ["expiration", "Prazo de validade"], ["gift", "Brinde"], ["donation", "Doação"], ["consumption", "Consumo"], ["payment_with_product", "Pagamento com Produto"], ["other", "Outros"]];
export default function Page() {
  const router = useRouter(); const farm = useFarmDefault();
  const [h, setH] = React.useState({ farm_id: "", writeoff_date: todayISO(), reason: "loss", reason_note: "", cost_center_id: "", warehouse_id: "", justification: "" });
  const [items, setItems] = React.useState<ItemRow[]>([]);
  React.useEffect(() => { setH((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const create = useCreate("/api/stock/writeoffs", () => router.push("/estoque?tab=operacoes&sub=diretas"));
  return <Card><CardHeader title="Nova baixa de estoque" actions={<><Button variant="outline" size="sm" onClick={() => router.back()}>Voltar</Button><Button size="sm" loading={create.isPending} disabled={!items.length || !h.warehouse_id} onClick={() => create.mutate({ ...h, cost_center_id: h.cost_center_id || null, reason_note: h.reason_note || null, items: items.map((i) => ({ product_id: i.product_id, quantity: i.quantity, provider_lot: i.provider_lot || null })) })}>Salvar</Button></>} /><CardBody className="space-y-4">
    <div className="grid grid-cols-12 gap-3">
      <Field label="Fazenda" required span={3}><RefSelect resource="farms" value={h.farm_id} onChange={(v) => setH({ ...h, farm_id: v ?? "", warehouse_id: "" })} /></Field>
      <Field label="Data de criação" required span={2}><Input type="date" value={h.writeoff_date} onChange={(e) => setH({ ...h, writeoff_date: e.target.value })} /></Field>
      <Field label="Motivo da baixa" required span={3}><NativeSelect value={h.reason} onChange={(e) => setH({ ...h, reason: e.target.value })}>{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect></Field>
      <Field label="Armazém" required span={4}><RefSelect resource="warehouses" value={h.warehouse_id} onChange={(v) => setH({ ...h, warehouse_id: v ?? "" })} filter={{ farm_id: h.farm_id }} /></Field>
      <Field label="Centro de Custo" span={4}><RefSelect resource="cost_centers" value={h.cost_center_id} onChange={(v) => setH({ ...h, cost_center_id: v ?? "" })} filter={{ kind: "analytic" }} /></Field>
      <Field label="Motivo/Observação da Baixa" span={8}><Input value={h.reason_note} onChange={(e) => setH({ ...h, reason_note: e.target.value })} /></Field>
      <Field label="Justificativa" required span={12}><Textarea value={h.justification} onChange={(e) => setH({ ...h, justification: e.target.value })} /></Field>
    </div>
    <ItemsEditor items={items.map((i) => ({ ...i, warehouse_id: h.warehouse_id }))} onChange={setItems} fields={["product", "stock", "quantity", "lot"]} defaults={{ warehouse_id: h.warehouse_id }} />
    <p className="text-xs text-slate-500">O valor da baixa é calculado pelo custo médio corrente de cada produto.</p>
  </CardBody></Card>;
}
