"use client";
import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input, NativeSelect, Tabs } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { ItemsEditor, ApportionmentEditor, PlanEditor, defaultPlan, toAppLines, useCreate, useFarmDefault, type ItemRow, type AppLine, type Plan } from "@/features/docs/shared";
function Inner() {
  const router = useRouter(); const sp = useSearchParams(); const farm = useFarmDefault();
  const [h, setH] = React.useState({ kind: sp.get("kind") === "farm" ? "farm" : "warehouse", transfer_date: todayISO(), origin_farm_id: "", origin_warehouse_id: "", destination_farm_id: "", destination_warehouse_id: "", harvest_id: "", generate_financial: "false", proprietary_id: "", is_deductible: "false" });
  const [items, setItems] = React.useState<ItemRow[]>([]); const [inc, setInc] = React.useState<AppLine[]>([]); const [exp, setExp] = React.useState<AppLine[]>([]); const [plan, setPlan] = React.useState<Plan>(defaultPlan());
  React.useEffect(() => { setH((o) => ({ ...o, origin_farm_id: o.origin_farm_id || farm })); }, [farm]);
  const create = useCreate("/api/stock/transfers", () => router.push(`/estoque?tab=transferencias&sub=${h.kind}`));
  const isFarm = h.kind === "farm";
  const submit = () => create.mutate({ kind: h.kind, transfer_date: h.transfer_date, origin_farm_id: h.origin_farm_id, origin_warehouse_id: h.origin_warehouse_id, destination_farm_id: isFarm ? h.destination_farm_id : undefined, destination_warehouse_id: h.destination_warehouse_id, harvest_id: h.harvest_id || null, generate_financial: isFarm && h.generate_financial === "true", proprietary_id: h.proprietary_id || null, is_deductible: h.is_deductible === "true", plan: plan.installments > 1 || plan.has_down_payment ? plan : null, income_apportionment: inc.length ? toAppLines(inc) : undefined, expense_apportionment: exp.length ? toAppLines(exp) : undefined, items: items.map((i) => ({ product_id: i.product_id, quantity: i.quantity, provider_lot: i.provider_lot || null, cost_center_id: i.cost_center_id || null })) });
  return <Card><CardHeader title={isFarm ? "Transferência de Armazém entre Fazendas" : "Transferência de Armazém"} actions={<><Button variant="outline" size="sm" onClick={() => router.back()}>Voltar</Button><Button size="sm" loading={create.isPending} disabled={!items.length} onClick={submit}>Salvar</Button></>} /><CardBody className="space-y-4">
    <div className="grid grid-cols-12 gap-3">
      <Field label="Tipo de movimentação" span={2}><NativeSelect value={h.kind} onChange={(e) => setH({ ...h, kind: e.target.value })}><option value="warehouse">Entre armazéns</option><option value="farm">Entre fazendas</option></NativeSelect></Field>
      <Field label="Data de criação" required span={2}><Input type="date" value={h.transfer_date} onChange={(e) => setH({ ...h, transfer_date: e.target.value })} /></Field>
      <Field label="Fazenda" required span={4}><RefSelect resource="farms" value={h.origin_farm_id} onChange={(v) => setH({ ...h, origin_farm_id: v ?? "", origin_warehouse_id: "" })} /></Field>
      <Field label="Armazém" required span={4}><RefSelect resource="warehouses" value={h.origin_warehouse_id} onChange={(v) => setH({ ...h, origin_warehouse_id: v ?? "" })} filter={{ farm_id: h.origin_farm_id }} /></Field>
      {isFarm && <Field label="Fazenda destino" required span={4}><RefSelect resource="farms" value={h.destination_farm_id} onChange={(v) => setH({ ...h, destination_farm_id: v ?? "", destination_warehouse_id: "" })} /></Field>}
      <Field label="Armazém destino" required span={4}><RefSelect resource="warehouses" value={h.destination_warehouse_id} onChange={(v) => setH({ ...h, destination_warehouse_id: v ?? "" })} filter={{ farm_id: isFarm ? h.destination_farm_id : h.origin_farm_id }} /></Field>
      <Field label="Safra" span={4}><RefSelect resource="harvests" value={h.harvest_id} onChange={(v) => setH({ ...h, harvest_id: v ?? "" })} /></Field>
      {isFarm && <><Field label="Gerar financeiro?" span={2}><NativeSelect value={h.generate_financial} onChange={(e) => setH({ ...h, generate_financial: e.target.value })}><option value="false">Não</option><option value="true">Sim</option></NativeSelect></Field><Field label="Proprietário gestor" span={3}><RefSelect resource="people" value={h.proprietary_id} onChange={(v) => setH({ ...h, proprietary_id: v ?? "" })} filter={{ is_proprietary: "true" }} /></Field><Field label="Dedutível" span={2}><NativeSelect value={h.is_deductible} onChange={(e) => setH({ ...h, is_deductible: e.target.value })}><option value="false">Não</option><option value="true">Sim</option></NativeSelect></Field></>}
    </div>
    <ItemsEditor items={items.map((i) => ({ ...i, warehouse_id: h.origin_warehouse_id }))} onChange={setItems} fields={["product", "stock", "quantity", "lot", "cost_center"]} defaults={{ warehouse_id: h.origin_warehouse_id }} />
    {isFarm && h.generate_financial === "true" && <Tabs tabs={[{ value: "plan", label: "Condição de pagamento (parcelamento)", content: <PlanEditor plan={plan} onChange={setPlan} /> }, { value: "inc", label: "Rateio: armazém de origem (a receber)", content: <ApportionmentEditor lines={inc} onChange={setInc} total={0} /> }, { value: "exp", label: "Rateio: armazém de destino (a pagar)", content: <ApportionmentEditor lines={exp} onChange={setExp} total={0} /> }]} />}
    <p className="text-xs text-slate-500">Itens transferidos saem ao custo médio da origem e entram no destino com o mesmo custo.</p>
  </CardBody></Card>;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
