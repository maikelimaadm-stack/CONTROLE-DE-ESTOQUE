"use client";
import * as React from "react";
import { use } from "react";
import { useRouter } from "next/navigation";
import { todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { useCreate, useFarmDefault } from "@/features/docs/shared";
import { AnimalPicker, HerdLotSelect, HANDLING_PT } from "@/features/livestock/shared";
export default function Page({ params }: { params: Promise<{ type: string }> }) {
  const { type } = use(params); const router = useRouter(); const farm = useFarmDefault();
  const usesProduct = type === "nutrition" || type === "sanitary"; const reclass = type === "weaning" || type === "separation";
  const [f, setF] = React.useState({ farm_id: "", handling_date: todayISO(), batch_id: "", product_id: "", warehouse_id: "", dose: "", responsible: "", note: "", new_batch_id: "", new_category_id: "", mode: "animals", herd_lot_id: "", quantity: "1" }); const [sel, setSel] = React.useState<string[]>([]);
  React.useEffect(() => { setF((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const create = useCreate("/api/livestock/handlings", () => router.push(`/pecuaria/manejo/${type}`));
  const submit = () => create.mutate({ farm_id: f.farm_id, handling_type: type, handling_date: f.handling_date, batch_id: f.batch_id || null, product_id: usesProduct ? f.product_id || null : null, warehouse_id: usesProduct ? f.warehouse_id || null : null, dose: usesProduct ? f.dose || null : null, responsible: f.responsible || null, note: f.note || null, items: f.mode === "animals" ? sel.map((id) => ({ animal_id: id, quantity: f.dose || "1", new_batch_id: reclass ? f.new_batch_id || null : null, new_category_id: reclass ? f.new_category_id || null : null })) : [{ herd_lot_id: f.herd_lot_id, quantity: f.quantity, new_batch_id: reclass ? f.new_batch_id || null : null, new_category_id: reclass ? f.new_category_id || null : null }] });
  return <Card><CardHeader title={`Novo manejo — ${HANDLING_PT[type] ?? type}`} subtitle={usesProduct ? "Produto com armazém informado é baixado do estoque (dose × animais) ao custo médio; carência calculada pelo cadastro do produto." : reclass ? "Reclassifica lote e/ou categoria dos animais selecionados." : "Registra o manejo no histórico dos animais/lote."} actions={<><Button variant="outline" size="sm" onClick={() => router.back()}>Voltar</Button><Button size="sm" loading={create.isPending} disabled={f.mode === "animals" ? !sel.length : !f.herd_lot_id} onClick={submit}>Salvar</Button></>} /><CardBody className="space-y-3">
    <div className="grid grid-cols-12 gap-2">
      <Field label="Fazenda" span={3}><RefSelect resource="farms" value={f.farm_id} onChange={(v) => setF({ ...f, farm_id: v ?? "" })} /></Field><Field label="Data" span={2}><Input type="date" value={f.handling_date} onChange={(e) => setF({ ...f, handling_date: e.target.value })} /></Field><Field label="Lote" span={3}><RefSelect resource="batches" value={f.batch_id} onChange={(v) => setF({ ...f, batch_id: v ?? "" })} /></Field><Field label="Responsável" span={2}><Input value={f.responsible} onChange={(e) => setF({ ...f, responsible: e.target.value })} /></Field><Field label="Modo" span={2}><NativeSelect value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="animals">Animais identificados</option><option value="lot">Por contagem (lote)</option></NativeSelect></Field>
      {usesProduct && <><Field label="Produto" span={4}><RefSelect resource="products" value={f.product_id} onChange={(v) => setF({ ...f, product_id: v ?? "" })} /></Field><Field label="Armazém (baixa estoque)" span={4}><RefSelect resource="warehouses" value={f.warehouse_id} onChange={(v) => setF({ ...f, warehouse_id: v ?? "" })} /></Field><Field label="Dose por animal" span={2}><Input type="number" step="0.0001" value={f.dose} onChange={(e) => setF({ ...f, dose: e.target.value })} /></Field></>}
      {reclass && <><Field label="Novo lote" span={4}><RefSelect resource="batches" value={f.new_batch_id} onChange={(v) => setF({ ...f, new_batch_id: v ?? "" })} /></Field><Field label="Nova categoria" span={4}><RefSelect resource="animal_categories" value={f.new_category_id} onChange={(v) => setF({ ...f, new_category_id: v ?? "" })} /></Field></>}
      <Field label="Observação" span={12}><Textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
    </div>
    {f.mode === "animals" ? <AnimalPicker selected={sel} onChange={setSel} farmId={f.farm_id || undefined} batchId={f.batch_id || undefined} /> : <div className="grid grid-cols-12 gap-2"><Field label="Lote (contagem)" span={8}><HerdLotSelect value={f.herd_lot_id} onChange={(v) => setF({ ...f, herd_lot_id: v })} farmId={f.farm_id || undefined} /></Field><Field label="Cabeças" span={2}><Input type="number" min={1} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field></div>}
  </CardBody></Card>;
}
