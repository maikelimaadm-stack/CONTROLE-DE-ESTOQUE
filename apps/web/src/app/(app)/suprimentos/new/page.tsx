"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { todayISO, brl } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { useCreate, useFarmDefault } from "@/features/docs/shared";
import { Trash2, Plus } from "lucide-react";

const TYPES = [["product", "Produto"], ["service", "Serviço"], ["advance", "Adiantamento"], ["refund", "Reembolso"], ["daily", "Diária"], ["contract", "Contrato"], ["finished_product", "Produto acabado"]];
interface Item { product_id: string; description: string; quantity: string; reference_value: string; amount: string; observation: string }
export default function Page() {
  const router = useRouter(); const farm = useFarmDefault();
  const [h, setH] = React.useState({ farm_id: "", request_date: todayISO(), priority: "medium", request_type: "product", authorizer_id: "", description: "", justification: "", observation: "" });
  const [items, setItems] = React.useState<Item[]>([{ product_id: "", description: "", quantity: "1", reference_value: "", amount: "", observation: "" }]);
  React.useEffect(() => { setH((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const create = useCreate<{ id: string }>("/api/supply/requests", (r) => router.push(`/suprimentos/view/${r.id}`));
  const upd = (i: number, k: keyof Item, v: string) => setItems(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const isProduct = h.request_type === "product" || h.request_type === "finished_product";
  const total = items.reduce((a, i) => a + (Number(i.amount) || Number(i.reference_value || 0) * Number(i.quantity || 0)), 0);
  const submit = () => create.mutate({ ...h, authorizer_id: h.authorizer_id || null, observation: h.observation || null, items: items.map((i) => ({ product_id: i.product_id || null, description: i.description, quantity: i.quantity, reference_value: i.reference_value || null, amount: i.amount || null, observation: i.observation || null })) });
  return <Card><CardHeader title="Nova Solicitação de Compra" subtitle="A solicitação entra no fluxo: Solicitação → Ciência → Cotação → Autorização → Compra → Recebimento → Finalizado" actions={<><Button variant="outline" size="sm" onClick={() => router.back()}>Voltar</Button><Button size="sm" loading={create.isPending} disabled={!h.description || !h.justification || items.some((i) => !i.description)} onClick={submit}>Salvar</Button></>} /><CardBody className="space-y-4">
    <div className="grid grid-cols-12 gap-3">
      <Field label="Fazenda" required span={3}><RefSelect resource="farms" value={h.farm_id} onChange={(v) => setH({ ...h, farm_id: v ?? "" })} /></Field>
      <Field label="Data" required span={2}><Input type="date" value={h.request_date} onChange={(e) => setH({ ...h, request_date: e.target.value })} /></Field>
      <Field label="Tipo" required span={2}><NativeSelect value={h.request_type} onChange={(e) => setH({ ...h, request_type: e.target.value })}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect></Field>
      <Field label="Prioridade" span={2}><NativeSelect value={h.priority} onChange={(e) => setH({ ...h, priority: e.target.value })}><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option></NativeSelect></Field>
      <Field label="Autorizador" span={3} help="Opcional: define quem recebe o pedido para aprovação"><RefSelect resource="authorizers" value={h.authorizer_id} onChange={(v) => setH({ ...h, authorizer_id: v ?? "" })} /></Field>
      <Field label="Descrição" required span={6}><Input value={h.description} onChange={(e) => setH({ ...h, description: e.target.value })} /></Field>
      <Field label="Justificativa" required span={6}><Input value={h.justification} onChange={(e) => setH({ ...h, justification: e.target.value })} /></Field>
      <Field label="Observação" span={12}><Textarea value={h.observation} onChange={(e) => setH({ ...h, observation: e.target.value })} /></Field>
    </div>
    <h3 className="text-xs font-semibold uppercase text-brand-700">Itens</h3>
    <div className="overflow-x-auto rounded border"><table className="table-dense w-full text-[12.5px]"><thead><tr>{isProduct && <th className="min-w-[220px]">Produto</th>}<th className="min-w-[220px]">Descrição</th><th className="w-24">Qtd.</th><th className="w-28">Vl. Referência</th><th className="w-28">Valor total</th><th>Observação</th><th className="w-8" /></tr></thead><tbody>
      {items.map((it, i) => <tr key={i}>
        {isProduct && <td><RefSelect resource="products" value={it.product_id || null} onChange={(v, o) => { upd(i, "product_id", v ?? ""); if (o && !it.description) upd(i, "description", o.label); }} /></td>}
        <td><Input value={it.description} onChange={(e) => upd(i, "description", e.target.value)} /></td>
        <td><Input type="number" step="0.0001" value={it.quantity} onChange={(e) => upd(i, "quantity", e.target.value)} /></td>
        <td><Input type="number" step="0.01" value={it.reference_value} onChange={(e) => upd(i, "reference_value", e.target.value)} /></td>
        <td><Input type="number" step="0.01" value={it.amount} onChange={(e) => upd(i, "amount", e.target.value)} placeholder={brl(Number(it.reference_value || 0) * Number(it.quantity || 0))} /></td>
        <td><Input value={it.observation} onChange={(e) => upd(i, "observation", e.target.value)} /></td>
        <td><button type="button" className="p-1 text-slate-400 hover:text-red-600" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></td>
      </tr>)}
    </tbody><tfoot><tr><td colSpan={8} className="p-2"><Button type="button" size="sm" variant="outline" onClick={() => setItems([...items, { product_id: "", description: "", quantity: "1", reference_value: "", amount: "", observation: "" }])}><Plus className="h-3.5 w-3.5" /> Adicionar item</Button><span className="ml-4 font-semibold">Total estimado: {brl(total)}</span></td></tr></tfoot></table></div>
  </CardBody></Card>;
}
