"use client";
import * as React from "react";
import { use } from "react";
import { useRouter } from "next/navigation";
import { todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { ItemsEditor, PlanEditor, defaultPlan, useCreate, useFarmDefault, type ItemRow, type Plan } from "@/features/docs/shared";
const T: Record<string, string> = { budgets: "Novo Orçamento", orders: "Novo Pedido de Venda", sales: "Nova Venda" };
export default function Page({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = use(params); const router = useRouter(); const farm = useFarmDefault();
  const [h, setH] = React.useState({ farm_id: "", document_date: todayISO(), shipping_date: "", due_date: "", client_id: "", transporter_id: "", proprietary_id: "", driver_name: "", payment_method_id: "", freight: "0", freight_icms: "0", other_values: "0", discount: "0", note: "", is_deductible: false, installments: false });
  const [items, setItems] = React.useState<ItemRow[]>([]); const [plan, setPlan] = React.useState<Plan>(defaultPlan());
  React.useEffect(() => { setH((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const create = useCreate<{ id: string }>(`/api/sales/${kind}`, (r) => router.push(`/vendas/${kind}/${r.id}`));
  const submit = () => create.mutate({ farm_id: h.farm_id, document_date: h.document_date, shipping_date: h.shipping_date || null, due_date: h.due_date || null, client_id: h.client_id, transporter_id: h.transporter_id || null, proprietary_id: h.proprietary_id || null, driver_name: h.driver_name || null, payment_method_id: h.payment_method_id || null, freight: h.freight || "0", freight_icms: h.freight_icms || "0", other_values: h.other_values || "0", discount: h.discount || "0", note: h.note || null, is_deductible: h.is_deductible, installment_plan: h.installments ? plan : null, items: items.map((i) => ({ product_id: i.product_id, warehouse_id: i.warehouse_id || null, quantity: i.quantity, unit_price: i.unit_value ?? "0", discount: i.discount || "0", discount_percent: i.discount_percent || "0", note: null })) });
  return <Card><CardHeader title={T[kind] ?? "Novo"} subtitle={kind === "sales" ? "A confirmação da venda baixa o estoque dos itens com armazém e gera as contas a receber." : "Documento comercial sem efeito em estoque/financeiro até ser convertido em venda confirmada."} actions={<><Button variant="outline" size="sm" onClick={() => router.back()}>Voltar</Button><Button size="sm" loading={create.isPending} disabled={!h.client_id || !items.length || items.some((i) => !i.product_id)} onClick={submit}>Salvar</Button></>} /><CardBody className="space-y-4">
    <div className="grid grid-cols-12 gap-3">
      <Field label="Fazenda" required span={3}><RefSelect resource="farms" value={h.farm_id} onChange={(v) => setH({ ...h, farm_id: v ?? "" })} /></Field>
      <Field label="Data" required span={2}><Input type="date" value={h.document_date} onChange={(e) => setH({ ...h, document_date: e.target.value })} /></Field>
      <Field label="Data de saída" span={2}><Input type="date" value={h.shipping_date} onChange={(e) => setH({ ...h, shipping_date: e.target.value })} /></Field>
      <Field label="Vencimento" span={2}><Input type="date" value={h.due_date} onChange={(e) => setH({ ...h, due_date: e.target.value })} /></Field>
      <Field label="Forma de pagamento" span={3}><RefSelect resource="payment_methods" value={h.payment_method_id} onChange={(v) => setH({ ...h, payment_method_id: v ?? "" })} /></Field>
      <Field label="Cliente" required span={5}><RefSelect resource="people" value={h.client_id} onChange={(v) => setH({ ...h, client_id: v ?? "" })} filter={{ is_client: "true" }} /></Field>
      <Field label="Transportadora" span={4}><RefSelect resource="people" value={h.transporter_id} onChange={(v) => setH({ ...h, transporter_id: v ?? "" })} filter={{ is_transporter: "true" }} /></Field>
      <Field label="Motorista" span={3}><Input value={h.driver_name} onChange={(e) => setH({ ...h, driver_name: e.target.value })} /></Field>
      <Field label="Proprietário" span={3}><RefSelect resource="people" value={h.proprietary_id} onChange={(v) => setH({ ...h, proprietary_id: v ?? "" })} filter={{ is_proprietary: "true" }} /></Field>
      <Field label="Frete" span={2}><Input type="number" step="0.01" value={h.freight} onChange={(e) => setH({ ...h, freight: e.target.value })} /></Field>
      <Field label="ICMS frete" span={2}><Input type="number" step="0.01" value={h.freight_icms} onChange={(e) => setH({ ...h, freight_icms: e.target.value })} /></Field>
      <Field label="Outros valores" span={2}><Input type="number" step="0.01" value={h.other_values} onChange={(e) => setH({ ...h, other_values: e.target.value })} /></Field>
      <Field label="Desconto" span={2}><Input type="number" step="0.01" value={h.discount} onChange={(e) => setH({ ...h, discount: e.target.value })} /></Field>
      <Field label="Dedutível" span={1}><NativeSelect value={h.is_deductible ? "1" : "0"} onChange={(e) => setH({ ...h, is_deductible: e.target.value === "1" })}><option value="0">Não</option><option value="1">Sim</option></NativeSelect></Field>
      <Field label="Observação" span={12}><Textarea value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></Field>
    </div>
    <h3 className="text-xs font-semibold uppercase text-brand-700">Itens</h3>
    <ItemsEditor items={items} onChange={setItems} fields={["warehouse", "product", "stock", "quantity", "unit_value", "discount", "discount_percent"]} />
    <div className="grid grid-cols-12 gap-3"><Field label="Parcelamento" span={3}><NativeSelect value={h.installments ? "1" : "0"} onChange={(e) => setH({ ...h, installments: e.target.value === "1" })}><option value="0">À vista</option><option value="1">Parcelado</option></NativeSelect></Field></div>
    {h.installments && <PlanEditor plan={plan} onChange={setPlan} />}
  </CardBody></Card>;
}
