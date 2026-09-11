"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input, NativeSelect, Textarea, Tabs } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { ItemsEditor, ApportionmentEditor, PlanEditor, defaultPlan, toAppLines, useCreate, useFarmDefault, type ItemRow, type AppLine, type Plan } from "@/features/docs/shared";
import { parseNfeXml } from "@/features/docs/nfe-xml";
export default function Page() {
  const router = useRouter(); const sp = useSearchParams(); const farm = useFarmDefault();
  const [h, setH] = React.useState({ farm_id: "", number: "", series: "1", access_key: "", provider_id: "", proprietary_id: "", harvest_id: "", emission_date: todayISO(), delivery_date: "", state_code: "", document_type: "nfe", title_type_id: "", classification: "unclassified", apportionment_type: "by_product", note: "", freight: "0", other_expenses: "0", generate_financial: "true", purchase_request_id: sp.get("purchase_request_id") ?? "", dfe_id: sp.get("dfe_id") ?? "" });
  const [items, setItems] = React.useState<ItemRow[]>([]); const [lines, setLines] = React.useState<AppLine[]>([]); const [plan, setPlan] = React.useState<Plan>(defaultPlan());
  React.useEffect(() => { setH((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const create = useCreate("/api/stock/invoices", () => router.push("/estoque?tab=recebimentos&sub=fiscais"));
  const total = items.reduce((a, i) => a + Number(i.quantity || 0) * Number(i.unit_value || 0) - Number(i.discount || 0), 0) + Number(h.freight || 0) + Number(h.other_expenses || 0);
  const onXml = async (f: File) => { const p = parseNfeXml(await f.text()); if (!p) return; setH((o) => ({ ...o, number: p.number, series: p.series, access_key: p.accessKey, emission_date: p.emissionDate, state_code: p.state })); setItems(p.items.map((i) => ({ product_id: "", quantity: i.quantity, unit_value: i.unitValue, discount: i.discount, generate_stock: true, xml_product_description: i.description }))); };
  const submit = () => create.mutate({ ...h, access_key: h.access_key || null, delivery_date: h.delivery_date || null, state_code: h.state_code || null, title_type_id: h.title_type_id || null, proprietary_id: h.proprietary_id || null, harvest_id: h.harvest_id || null, purchase_request_id: h.purchase_request_id || null, dfe_id: h.dfe_id || null, generate_financial: h.generate_financial === "true", items: items.map((i) => ({ product_id: i.product_id, xml_product_description: (i["xml_product_description"] as string) ?? null, quantity: i.quantity, unit_value: i.unit_value, discount: i.discount || "0", generate_stock: i.generate_stock !== false, warehouse_id: i.warehouse_id || null, provider_lot: i.provider_lot || null, expiration_date: i.expiration_date || null, financial_category_id: i.financial_category_id || null, cost_center_id: i.cost_center_id || null })), apportionment: h.apportionment_type === "by_value" && lines.length ? toAppLines(lines) : undefined, plan: plan.installments > 1 || plan.has_down_payment ? plan : null, due_date: plan.first_due_date });
  return <Card><CardHeader title="Documento Fiscal de Entrada" actions={<><Button variant="outline" size="sm" onClick={() => router.back()}>Voltar</Button><Button size="sm" loading={create.isPending} onClick={submit} disabled={!items.length}>Salvar</Button></>} /><CardBody className="space-y-4">
    <div className="rounded border border-dashed p-3 text-xs text-slate-500">Upload XML NFe: <input type="file" accept=".xml" onChange={(e) => e.target.files?.[0] && onXml(e.target.files[0])} /> <span className="ml-2">Preenche número, série, chave, data e itens (o produto de cada item deve ser vinculado ao cadastro).</span></div>
    <div className="grid grid-cols-12 gap-3">
      <Field label="Fazenda" required span={3}><RefSelect resource="farms" value={h.farm_id} onChange={(v) => setH({ ...h, farm_id: v ?? "" })} /></Field>
      <Field label="Documento Fiscal" required span={2}><Input value={h.number} onChange={(e) => setH({ ...h, number: e.target.value })} /></Field>
      <Field label="Série" required span={1}><Input value={h.series} onChange={(e) => setH({ ...h, series: e.target.value })} /></Field>
      <Field label="Fornecedor" required span={4}><RefSelect resource="people" value={h.provider_id} onChange={(v) => setH({ ...h, provider_id: v ?? "" })} filter={{ is_provider: "true" }} /></Field>
      <Field label="Proprietário Gestor" span={2}><RefSelect resource="people" value={h.proprietary_id} onChange={(v) => setH({ ...h, proprietary_id: v ?? "" })} filter={{ is_proprietary: "true" }} /></Field>
      <Field label="Safra" span={3}><RefSelect resource="harvests" value={h.harvest_id} onChange={(v) => setH({ ...h, harvest_id: v ?? "" })} /></Field>
      <Field label="Dt. Emissão" required span={2}><Input type="date" value={h.emission_date} onChange={(e) => setH({ ...h, emission_date: e.target.value })} /></Field>
      <Field label="Dt. Entrega" span={2}><Input type="date" value={h.delivery_date} onChange={(e) => setH({ ...h, delivery_date: e.target.value })} /></Field>
      <Field label="UF" span={1}><Input maxLength={2} value={h.state_code} onChange={(e) => setH({ ...h, state_code: e.target.value.toUpperCase() })} /></Field>
      <Field label="Tipo Nota" required span={2}><NativeSelect value={h.document_type} onChange={(e) => setH({ ...h, document_type: e.target.value })}>{["nfe", "cte", "nfse", "nfce", "danfe", "darf", "dare", "gru", "other"].map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}</NativeSelect></Field>
      <Field label="Tipo de Título" span={2}><RefSelect resource="title_types" value={h.title_type_id} onChange={(v) => setH({ ...h, title_type_id: v ?? "" })} /></Field>
      <Field label="Classificação" required span={2}><NativeSelect value={h.classification} onChange={(e) => setH({ ...h, classification: e.target.value })}><option value="unclassified">Não Classificado</option><option value="capex">CAPEX</option><option value="opex">OPEX</option></NativeSelect></Field>
      <Field label="Tipo Rateio" required span={2}><NativeSelect value={h.apportionment_type} onChange={(e) => setH({ ...h, apportionment_type: e.target.value })}><option value="by_product">Por Produto</option><option value="by_value">Por Valor</option></NativeSelect></Field>
      <Field label="Chave de acesso" span={4}><Input maxLength={44} value={h.access_key} onChange={(e) => setH({ ...h, access_key: e.target.value })} /></Field>
      <Field label="Frete" span={2}><Input type="number" step="0.01" value={h.freight} onChange={(e) => setH({ ...h, freight: e.target.value })} /></Field>
      <Field label="Outras despesas" span={2}><Input type="number" step="0.01" value={h.other_expenses} onChange={(e) => setH({ ...h, other_expenses: e.target.value })} /></Field>
      <Field label="Gera financeiro" span={2}><NativeSelect value={h.generate_financial} onChange={(e) => setH({ ...h, generate_financial: e.target.value })}><option value="true">Sim (contas a pagar)</option><option value="false">Não</option></NativeSelect></Field>
      <Field label="Observações" span={12}><Textarea value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></Field>
    </div>
    <Tabs tabs={[
      { value: "items", label: "Itens", content: <ItemsEditor items={items} onChange={setItems} fields={["warehouse", "product", "quantity", "unit_value", "discount", "generate_stock", "lot", "expiration", "financial_category", "cost_center"]} /> },
      { value: "pay", label: "Parcelamento", content: <PlanEditor plan={plan} onChange={setPlan} /> },
      { value: "app", label: "Rateio por valor", content: h.apportionment_type === "by_value" ? <ApportionmentEditor lines={lines} onChange={setLines} total={total} /> : <p className="text-xs text-slate-500">Rateio por produto: usa categoria financeira e centro de custo de cada item.</p> }
    ]} />
    <div className="text-right text-sm font-semibold">Total do documento: {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(total)}</div>
  </CardBody></Card>;
}
