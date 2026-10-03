"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { ItemsEditor, useCreate, useEmpresaPadrao, type ItemRow } from "@/features/docs/shared";
import { enumOptions } from "@/lib/copy";
export default function Page() {
  const router = useRouter(); const empresa = useEmpresaPadrao();
  const [h, setH] = React.useState({ empresa_id: "", writeoff_date: todayISO(), reason: "loss", reason_note: "", cost_center_id: "", warehouse_id: "", justification: "" });
  const [items, setItems] = React.useState<ItemRow[]>([]);
  React.useEffect(() => { setH((o) => ({ ...o, empresa_id: o.empresa_id || empresa })); }, [empresa]);
  const create = useCreate("/api/stock/writeoffs", () => router.push("/estoque?tab=operacoes&sub=diretas"));
  return <Card><CardHeader title="Nova baixa de estoque" actions={<><Button variant="outline" size="sm" onClick={() => router.back()}>Voltar</Button><Button size="sm" loading={create.isPending} disabled={!items.length || !h.warehouse_id} onClick={() => create.mutate({ ...h, cost_center_id: h.cost_center_id || null, reason_note: h.reason_note || null, items: items.map((i) => ({ product_id: i.product_id, quantity: i.quantity, provider_lot: i.provider_lot || null })) })}>Salvar</Button></>} /><CardBody className="space-y-4">
    <div className="grid grid-cols-12 gap-3">
      <Field label="Empresa" required span={3}><RefSelect resource="empresas" value={h.empresa_id} onChange={(v) => setH({ ...h, empresa_id: v ?? "", warehouse_id: "" })} /></Field>
      <Field label="Data de criação" required span={2}><Input type="date" value={h.writeoff_date} onChange={(e) => setH({ ...h, writeoff_date: e.target.value })} /></Field>
      <Field label="Motivo da baixa" required span={3}><NativeSelect value={h.reason} onChange={(e) => setH({ ...h, reason: e.target.value })}>{enumOptions("writeoff_reason").map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect></Field>
      <Field label="Local de estoque" required span={4}><RefSelect resource="warehouses" value={h.warehouse_id} onChange={(v) => setH({ ...h, warehouse_id: v ?? "" })} filter={{ empresa_id: h.empresa_id }} /></Field>
      <Field label="Centro de Resultado" span={4}><RefSelect resource="cost_centers" value={h.cost_center_id} onChange={(v) => setH({ ...h, cost_center_id: v ?? "" })} filter={{ kind: "analytic" }} /></Field>
      <Field label="Motivo/Observação da Baixa" span={8}><Input value={h.reason_note} onChange={(e) => setH({ ...h, reason_note: e.target.value })} /></Field>
      <Field label="Justificativa" required span={12}><Textarea value={h.justification} onChange={(e) => setH({ ...h, justification: e.target.value })} /></Field>
    </div>
    <ItemsEditor items={items.map((i) => ({ ...i, warehouse_id: h.warehouse_id }))} onChange={setItems} fields={["product", "stock", "quantity", "lot"]} defaults={{ warehouse_id: h.warehouse_id }} />
    <p className="text-xs text-slate-500">O valor da baixa é calculado pelo custo médio corrente de cada produto.</p>
  </CardBody></Card>;
}
