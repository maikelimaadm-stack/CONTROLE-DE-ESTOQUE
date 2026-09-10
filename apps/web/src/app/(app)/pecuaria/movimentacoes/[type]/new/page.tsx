"use client";
import * as React from "react";
import { use } from "react";
import { useRouter } from "next/navigation";
import { todayISO, brl } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { useCreate, useFarmDefault, type Row } from "@/features/docs/shared";
import { AnimalPicker, HerdLotSelect, MOV_PT } from "@/features/livestock/shared";
import { Trash2, Plus } from "lucide-react";
interface Item { animal_id: string; herd_lot_id: string; category_id: string; breed_id: string; sex: string; quantity: string; weight: string; unit_value: string; identifications: { identification_type_id: string; value: string }[]; mother_id: string; birth_date: string }
const blank = (): Item => ({ animal_id: "", herd_lot_id: "", category_id: "", breed_id: "", sex: "", quantity: "1", weight: "", unit_value: "", identifications: [], mother_id: "", birth_date: todayISO() });
export default function Page({ params }: { params: Promise<{ type: string }> }) {
  const { type } = use(params); const router = useRouter(); const farm = useFarmDefault();
  const isIn = type === "purchase" || type === "birth"; const money = type === "purchase" || type === "sale";
  const [h, setH] = React.useState({ farm_id: "", movement_date: todayISO(), person_id: "", batch_id: "", cause: "", note: "", invoice_number: "", generate_financial: false, due_date: "", financial_category_id: "", cost_center_id: "" });
  const [mode, setMode] = React.useState<"animals" | "lot">(isIn ? "lot" : "animals");
  const [sel, setSel] = React.useState<string[]>([]); const [selRows, setSelRows] = React.useState<Row[]>([]); const [perAnimal, setPerAnimal] = React.useState<Record<string, { weight: string; unit_value: string }>>({});
  const [items, setItems] = React.useState<Item[]>([blank()]);
  React.useEffect(() => { setH((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const create = useCreate<{ id: string }>("/api/livestock/movements", (r) => router.push(`/pecuaria/movimentacoes/${type}/${r.id}`));
  const upd = (i: number, p: Partial<Item>) => setItems(items.map((it, j) => (j === i ? { ...it, ...p } : it)));
  const body = () => ({ farm_id: h.farm_id, movement_type: type, movement_date: h.movement_date, person_id: h.person_id || null, batch_id: h.batch_id || null, cause: h.cause || null, note: h.note || null, invoice_number: h.invoice_number || null, generate_financial: money && h.generate_financial, due_date: h.due_date || null, financial_category_id: h.financial_category_id || null, cost_center_id: h.cost_center_id || null,
    items: mode === "animals" && !isIn ? sel.map((id) => ({ animal_id: id, quantity: 1, weight: perAnimal[id]?.weight || null, unit_value: perAnimal[id]?.unit_value || null })) : items.map((it) => ({ animal_id: null, herd_lot_id: isIn ? null : it.herd_lot_id || null, category_id: it.category_id || null, breed_id: it.breed_id || null, sex: it.sex || null, quantity: Number(it.quantity || 1), weight: it.weight || null, unit_value: it.unit_value || null, identifications: it.identifications.filter((x) => x.identification_type_id && x.value), mother_id: type === "birth" ? it.mother_id || null : null, birth_date: type === "birth" ? it.birth_date || null : null })) });
  const total = mode === "animals" && !isIn ? sel.reduce((a, id) => a + Number(perAnimal[id]?.unit_value || 0), 0) : items.reduce((a, it) => a + Number(it.quantity || 0) * Number(it.unit_value || 0), 0);
  const valid = h.farm_id && (mode === "animals" && !isIn ? sel.length > 0 : items.length > 0 && items.every((it) => (isIn ? it.category_id : it.herd_lot_id)));
  return <Card><CardHeader title={`Nova ${MOV_PT[type] ?? type}`} subtitle={isIn ? "Entrada de animais: por contagem (lote) com opção de identificações individuais. Compras podem gerar contas a pagar." : "Saída de animais individualizados (seleção) ou por contagem (lote). Vendas podem gerar contas a receber."} actions={<><Button variant="outline" size="sm" onClick={() => router.back()}>Voltar</Button><Button size="sm" loading={create.isPending} disabled={!valid} onClick={() => create.mutate(body())}>Salvar</Button></>} /><CardBody className="space-y-4">
    <div className="grid grid-cols-12 gap-3">
      <Field label="Fazenda" required span={3}><RefSelect resource="farms" value={h.farm_id} onChange={(v) => setH({ ...h, farm_id: v ?? "" })} /></Field>
      <Field label="Data" required span={2}><Input type="date" value={h.movement_date} onChange={(e) => setH({ ...h, movement_date: e.target.value })} /></Field>
      {money && <Field label={type === "sale" ? "Cliente" : "Fornecedor"} span={4}><RefSelect resource="people" value={h.person_id} onChange={(v) => setH({ ...h, person_id: v ?? "" })} filter={type === "sale" ? { is_client: "true" } : { is_provider: "true" }} /></Field>}
      {money && <Field label="Nota fiscal" span={3}><Input value={h.invoice_number} onChange={(e) => setH({ ...h, invoice_number: e.target.value })} /></Field>}
      {isIn && <Field label="Lote de destino" span={4}><RefSelect resource="batches" value={h.batch_id} onChange={(v) => setH({ ...h, batch_id: v ?? "" })} /></Field>}
      {(type === "death" || type === "loss") && <Field label="Causa" span={4}><Input value={h.cause} onChange={(e) => setH({ ...h, cause: e.target.value })} /></Field>}
      {!isIn && <Field label="Modo" span={3}><NativeSelect value={mode} onChange={(e) => setMode(e.target.value as "animals" | "lot")}><option value="animals">Animais identificados</option><option value="lot">Por contagem (lote)</option></NativeSelect></Field>}
      <Field label="Observação" span={12}><Textarea value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></Field>
    </div>
    {mode === "animals" && !isIn ? <>
      <AnimalPicker selected={sel} onChange={(ids, rows) => { setSel(ids); setSelRows(rows); }} farmId={h.farm_id || undefined} />
      {sel.length > 0 && <table className="table-dense w-full max-w-3xl text-[12px]"><thead><tr><th>Animal</th><th className="w-32">Peso (kg)</th>{money && <th className="w-32">Valor (R$)</th>}</tr></thead><tbody>{sel.map((id) => <tr key={id}><td>{String(selRows.find((r) => r["id"] === id)?.["identifications"] ?? id)}</td><td><Input type="number" step="0.1" value={perAnimal[id]?.weight ?? ""} onChange={(e) => setPerAnimal({ ...perAnimal, [id]: { ...(perAnimal[id] ?? { unit_value: "" }), weight: e.target.value } })} /></td>{money && <td><Input type="number" step="0.01" value={perAnimal[id]?.unit_value ?? ""} onChange={(e) => setPerAnimal({ ...perAnimal, [id]: { ...(perAnimal[id] ?? { weight: "" }), unit_value: e.target.value } })} /></td>}</tr>)}</tbody></table>}
    </> : <div className="space-y-2">
      {items.map((it, i) => <div key={i} className="grid grid-cols-12 gap-2 rounded border p-2">
        {isIn ? <><Field label="Categoria" required span={3}><RefSelect resource="animal_categories" value={it.category_id} onChange={(v) => upd(i, { category_id: v ?? "" })} /></Field><Field label="Raça" span={2}><RefSelect resource="breeds" value={it.breed_id} onChange={(v) => upd(i, { breed_id: v ?? "" })} /></Field><Field label="Sexo" span={1}><NativeSelect value={it.sex} onChange={(e) => upd(i, { sex: e.target.value })}><option value="">—</option><option value="M">M</option><option value="F">F</option></NativeSelect></Field></>
          : <Field label="Lote (contagem)" required span={6}><HerdLotSelect value={it.herd_lot_id} onChange={(v, r) => upd(i, { herd_lot_id: v, category_id: String(r?.["category_id"] ?? "") })} farmId={h.farm_id || undefined} /></Field>}
        <Field label="Cabeças" required span={1}><Input type="number" min={1} value={it.quantity} onChange={(e) => upd(i, { quantity: e.target.value })} /></Field>
        <Field label="Peso médio" span={2}><Input type="number" step="0.1" value={it.weight} onChange={(e) => upd(i, { weight: e.target.value })} /></Field>
        {money && <Field label="Valor unit." span={2}><Input type="number" step="0.01" value={it.unit_value} onChange={(e) => upd(i, { unit_value: e.target.value })} /></Field>}
        {type === "birth" && <><Field label="Nascimento" span={2}><Input type="date" value={it.birth_date} onChange={(e) => upd(i, { birth_date: e.target.value })} /></Field></>}
        {isIn && <Field label="Identificações (uma por linha: tipo=valor)" span={12} help="Opcional; sem identificação o animal entra por contagem no lote."><IdList value={it.identifications} onChange={(v) => upd(i, { identifications: v })} /></Field>}
        <div className="col-span-12 flex justify-end"><button className="text-slate-400 hover:text-red-600" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></div>
      </div>)}
      <Button size="sm" variant="outline" onClick={() => setItems([...items, blank()])}><Plus className="h-3.5 w-3.5" /> Adicionar linha</Button>
    </div>}
    {money && <div className="grid grid-cols-12 gap-3 rounded border bg-slate-50 p-3">
      <div className="col-span-12 font-semibold">Total: {brl(total)}</div>
      <Field label="Gerar financeiro" span={3}><NativeSelect value={h.generate_financial ? "1" : "0"} onChange={(e) => setH({ ...h, generate_financial: e.target.value === "1" })}><option value="0">Não</option><option value="1">{type === "sale" ? "Conta a receber" : "Conta a pagar"}</option></NativeSelect></Field>
      {h.generate_financial && <><Field label="Vencimento" span={2}><Input type="date" value={h.due_date} onChange={(e) => setH({ ...h, due_date: e.target.value })} /></Field><Field label="Categoria" span={4}><RefSelect resource="financial_categories" value={h.financial_category_id} onChange={(v) => setH({ ...h, financial_category_id: v ?? "" })} filter={{ kind: "analytic" }} /></Field><Field label="Centro de custo" span={3}><RefSelect resource="cost_centers" value={h.cost_center_id} onChange={(v) => setH({ ...h, cost_center_id: v ?? "" })} filter={{ kind: "analytic" }} /></Field></>}
    </div>}
  </CardBody></Card>;
}
function IdList({ value, onChange }: { value: { identification_type_id: string; value: string }[]; onChange: (v: { identification_type_id: string; value: string }[]) => void }) {
  return <div className="space-y-1">{value.map((x, k) => <div key={k} className="flex gap-1"><div className="w-56"><RefSelect resource="identification_types" value={x.identification_type_id} onChange={(v) => onChange(value.map((y, j) => (j === k ? { ...y, identification_type_id: v ?? "" } : y)))} /></div><Input value={x.value} onChange={(e) => onChange(value.map((y, j) => (j === k ? { ...y, value: e.target.value } : y)))} className="max-w-xs" /><button className="text-slate-400 hover:text-red-600" onClick={() => onChange(value.filter((_, j) => j !== k))}><Trash2 className="h-4 w-4" /></button></div>)}<Button size="sm" variant="ghost" onClick={() => onChange([...value, { identification_type_id: "", value: "" }])}>+ identificação</Button></div>;
}
