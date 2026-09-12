"use client";
import * as React from "react";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, num, dateBR, dateTimeBR } from "@/lib/utils";
import { Badge, Button, Dialog, Field, Input, Tabs, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { DetailShell, KV, SimpleTable, useDoc, LoadingOr, type Row } from "@/features/docs/shared";
import { ActionDialog, useAction, type ActionField } from "@/features/docs/actions";

const ACTIONS: Record<string, { label: string; perm: string; danger?: boolean; fields?: ActionField[] }> = {
  submit: { label: "Enviar para ciência", perm: "purchase_requests.edit" }, acknowledge: { label: "Dar ciência", perm: "purchase_quotations.create" }, start_quotation: { label: "Iniciar cotação", perm: "purchase_quotations.create" },
  send_to_approval: { label: "Enviar para autorização", perm: "purchase_quotations.edit", fields: [{ name: "authorizer_id", label: "Autorizador", type: "ref", resource: "authorizers" }] },
  approve: { label: "Aprovar", perm: "purchase_authorization.edit" }, reject: { label: "Reprovar", perm: "purchase_authorization.edit", danger: true }, review: { label: "Analisar processo", perm: "purchase_authorization.edit" },
  mark_purchased: { label: "Compra efetuada", perm: "purchase_buy.edit" }, mark_received: { label: "Compra recebida", perm: "purchase_receipts.edit" }, finish: { label: "Finalizar pedido", perm: "purchase_receipts.edit" },
  back_step: { label: "Voltar etapa", perm: "purchase_requests.edit" }, cancel: { label: "Cancelar pedido", perm: "purchase_requests.delete", danger: true }
};
const EVENT_PT: Record<string, string> = { create: "Criação", comment: "Comentário", transfer: "Transferência", financial: "Financeiro", quotation: "Cotação", quotation_selected: "Cotação selecionada", update: "Alteração", ...Object.fromEntries(Object.entries(ACTIONS).map(([k, v]) => [k, v.label])) };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const { can, ctx } = useAuth();
  const q = useDoc<Row & { items: Row[]; events: Row[]; quotations: Row[]; approvals: Row[]; children: Row[]; attachments: Row[]; allowed_actions: string[]; can_transfer: boolean }>(`/api/supply/requests/${id}`);
  const [action, setAction] = React.useState<string | null>(null); const [transfer, setTransfer] = React.useState(false); const [quote, setQuote] = React.useState(false); const [fin, setFin] = React.useState(false);
  const act = useAction(() => { setAction(null); setTransfer(false); setQuote(false); setFin(false); });
  const d = q.data;
  const doAction = (a: string, v: Record<string, string>) => act.mutate({ path: `/api/supply/requests/${id}/actions/${a}`, body: { justification: v["justification"] || ACTIONS[a]?.label, version: d?.["version"], authorizer_id: v["authorizer_id"] || null } });
  const allowed = (d?.allowed_actions ?? []).filter((a) => ACTIONS[a] && can(ACTIONS[a]!.perm));
  const isOwnerOrResponsible = d && (d["current_responsible_user_id"] === ctx?.user.id || d["requester_user_id"] === ctx?.user.id || ctx?.isOwner);
  return <DetailShell title={`Solicitação ${d?.["code"] ?? ""}`} back="/compras?tab=processos&scope=mine" actions={<>
    {d && allowed.map((a) => <Button key={a} size="sm" variant={ACTIONS[a]!.danger ? "danger" : a === "back_step" ? "outline" : "default"} onClick={() => setAction(a)}>{ACTIONS[a]!.label}</Button>)}
    {d?.can_transfer && <Button size="sm" variant="outline" onClick={() => setTransfer(true)}>Transferir responsável</Button>}
    {d && can("purchase_requests.financial") && <Button size="sm" variant="outline" onClick={() => setFin(true)}>Financeiro</Button>}
  </>}>
    <LoadingOr q={q}>{d && <>
      <div className="flex flex-wrap items-center gap-2"><Badge tone={d["status"] === "finished" ? "green" : d["status"] === "cancelled" || d["status"] === "not_approved" ? "red" : "blue"}>{String(d["status_label"])}</Badge>{!isOwnerOrResponsible && <span className="text-xs text-slate-500">Você não é o responsável atual por este processo.</span>}</div>
      <KV items={[["Fazenda", String(d["farm_name"])], ["Data", dateBR(d["request_date"] as string)], ["Tipo", String(d["request_type"])], ["Prioridade", String(d["priority"])], ["Solicitante", String(d["requester_name"] ?? "")], ["Responsável atual", String(d["current_responsible_name"] ?? "—")], ["Vl. estimado", brl(d["estimated_total"] as string)], ["Vl. aprovado", d["approved_total"] ? brl(d["approved_total"] as string) : "—"], ["Descrição", String(d["description"])], ["Justificativa", String(d["justification"])], ["Observação", String(d["observation"] ?? "—")], ["Versão", String(d["version"])], ["Classificação", String(d["classification"] ?? "unclassified")], ["Venc. financeiro", d["financial_due_date"] ? dateBR(d["financial_due_date"] as string) : "—"], ["Nota fiscal", String(d["invoice_number"] ?? "—")], ["Doc. fiscal lançado", d["invoice_id"] ? "Sim" : "Não"]]} />
      <Tabs tabs={[
        { value: "items", label: "Itens", badge: d.items.length, content: <SimpleTable rows={d.items} cols={[{ key: "product_name", label: "Produto", render: (r) => String(r["product_name"] ?? "—") }, { key: "description", label: "Descrição" }, { key: "quantity", label: "Qtd.", align: "right", render: (r) => num(r["quantity"] as string, 4) }, { key: "reference_value", label: "Vl. referência", align: "right", render: (r) => r["reference_value"] ? brl(r["reference_value"] as string) : "—" }, { key: "amount", label: "Valor", align: "right", render: (r) => r["amount"] ? brl(r["amount"] as string) : "—" }, { key: "observation", label: "Obs." }]} /> },
        { value: "quotes", label: "Cotações", badge: d.quotations.length, content: <Quotations d={d} id={id} onNew={() => setQuote(true)} act={act} /> },
        { value: "events", label: "Histórico", badge: d.events.length, content: <SimpleTable rows={d.events} cols={[{ key: "created_at", label: "Data", render: (r) => dateTimeBR(r["created_at"] as string) }, { key: "user_name", label: "Usuário" }, { key: "action", label: "Ação", render: (r) => EVENT_PT[String(r["action"])] ?? String(r["action"]) }, { key: "to_status_label", label: "Status" }, { key: "justification", label: "Justificativa / comentário" }, { key: "time_spent_minutes", label: "Tempo etapa", align: "right", render: (r) => r["time_spent_minutes"] != null ? `${Math.round(Number(r["time_spent_minutes"]) / 60)}h` : "" }]} /> },
        { value: "approvals", label: "Aprovações", badge: d.approvals.length, content: <SimpleTable rows={d.approvals} cols={[{ key: "decided_at", label: "Data", render: (r) => dateTimeBR(r["decided_at"] as string) }, { key: "decided_by_name", label: "Autorizador" }, { key: "level", label: "Nível" }, { key: "decision", label: "Decisão", render: (r) => <Badge tone={r["decision"] === "approved" ? "green" : r["decision"] === "rejected" ? "red" : "slate"}>{String(r["decision"])}</Badge> }, { key: "justification", label: "Justificativa" }]} /> },
        { value: "order", label: "Pedido de compra", content: <Order id={id} enabled={can("purchase_buy.view")} /> },
        { value: "comments", label: "Comentários", content: <Comment id={id} act={act} /> },
        { value: "files", label: "Anexos", badge: d.attachments.length, content: <div className="space-y-2"><SimpleTable rows={d.attachments} cols={[{ key: "file_name", label: "Arquivo" }, { key: "description", label: "Descrição" }, { key: "created_at", label: "Enviado em", render: (r) => dateTimeBR(r["created_at"] as string) }]} /><p className="text-xs text-slate-500">Upload de anexos é feito via Supabase Storage (bucket privado por organização) — pendente de configuração do projeto Supabase.</p></div> }
      ]} />
    </>}</LoadingOr>
    <ActionDialog open={Boolean(action)} onOpenChange={() => setAction(null)} title={action ? ACTIONS[action]!.label : ""} danger={action ? ACTIONS[action]!.danger : false} loading={act.isPending} fields={[...(action ? ACTIONS[action]!.fields ?? [] : []), { name: "justification", label: "Justificativa", type: "textarea", required: action === "reject" || action === "cancel" || action === "review" }]} onSubmit={(v) => action && doAction(action, v)} />
    <ActionDialog open={transfer} onOpenChange={setTransfer} title="Transferir responsável" fields={[{ name: "responsible_user_id", label: "Novo responsável", type: "ref", resource: "users", required: true, span: 12 }, { name: "justification", label: "Justificativa", type: "textarea", required: true }]} loading={act.isPending} onSubmit={(v) => act.mutate({ path: `/api/supply/requests/${id}/transfer`, body: v })} />
    <ActionDialog open={fin} onOpenChange={setFin} title="Dados financeiros da solicitação" fields={[{ name: "classification", label: "Classificação", type: "select", options: [{ value: "unclassified", label: "Não classificado" }, { value: "capex", label: "CAPEX (investimento)" }, { value: "opex", label: "OPEX (custeio)" }], default: String(d?.["classification"] ?? "unclassified") }, { name: "financial_due_date", label: "Vencimento", type: "date", default: String(d?.["financial_due_date"] ?? "").slice(0, 10) }, { name: "invoice_number", label: "Nota fiscal", default: String(d?.["invoice_number"] ?? "") }]} loading={act.isPending} submitLabel="Salvar" onSubmit={(v) => act.mutate({ path: `/api/supply/requests/${id}/financial`, method: "PUT", body: { classification: v["classification"] || undefined, financial_due_date: v["financial_due_date"] || null, invoice_number: v["invoice_number"] || null } })} />
    {d && <QuotationDialog open={quote} onOpenChange={setQuote} id={id} items={d.items} act={act} />}
  </DetailShell>;
}

function Quotations({ d, id, onNew, act }: { d: Row & { quotations: Row[]; items: Row[] }; id: string; onNew: () => void; act: ReturnType<typeof useAction> }) {
  const { can } = useAuth(); const open = !["finished", "cancelled", "not_approved", "awaiting_purchase", "purchase_done", "purchase_received"].includes(String(d["status"]));
  return <div className="space-y-2">
    {open && can("purchase_quotations.create") && <Button size="sm" onClick={onNew}>Adicionar cotação</Button>}
    <SimpleTable rows={d.quotations} cols={[{ key: "provider_name", label: "Fornecedor" }, { key: "quotation_date", label: "Data", render: (r) => dateBR(r["quotation_date"] as string) }, { key: "payment_condition", label: "Cond. pagto" }, { key: "delivery_days", label: "Prazo (dias)", align: "right" }, { key: "freight", label: "Frete", align: "right", render: (r) => brl(r["freight"] as string) }, { key: "total", label: "Total", align: "right", render: (r) => brl(r["total"] as string) }, { key: "is_selected", label: "Vencedora", render: (r) => r["is_selected"] ? <Badge tone="green">Selecionada</Badge> : open && can("purchase_quotations.edit") ? <Button size="sm" variant="outline" onClick={() => act.mutate({ path: `/api/supply/requests/${id}/quotations/${r["id"]}/select` })}>Selecionar</Button> : "" }, { key: "del", label: "", render: (r) => open && !r["is_selected"] && can("purchase_quotations.delete") ? <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/api/supply/requests/${id}/quotations/${r["id"]}`, method: "DELETE" })}>Excluir</Button> : "" }]} />
    {d.quotations.map((qt) => <details key={String(qt["id"])} className="rounded border p-2 text-xs"><summary className="cursor-pointer">Itens — {String(qt["provider_name"])}</summary><SimpleTable rows={(qt["items"] as Row[] | null) ?? []} cols={[{ key: "request_item_id", label: "Item", render: (r) => String(d.items.find((i) => i["id"] === r["request_item_id"])?.["description"] ?? "") }, { key: "brand", label: "Marca" }, { key: "quantity", label: "Qtd.", align: "right" }, { key: "unit_price", label: "Vl. unit.", align: "right", render: (r) => brl(r["unit_price"] as string) }, { key: "total", label: "Total", align: "right", render: (r) => brl(r["total"] as string) }]} /></details>)}
  </div>;
}
function QuotationDialog({ open, onOpenChange, id, items, act }: { open: boolean; onOpenChange: (o: boolean) => void; id: string; items: Row[]; act: ReturnType<typeof useAction> }) {
  const [h, setH] = React.useState({ provider_id: "", payment_condition: "", delivery_days: "", freight: "0", note: "" });
  const [prices, setPrices] = React.useState<Record<string, { unit_price: string; brand: string }>>({});
  const total = items.reduce((a, i) => a + Number(prices[String(i["id"])]?.unit_price || 0) * Number(i["quantity"]), 0) + Number(h.freight || 0);
  return <Dialog open={open} onOpenChange={onOpenChange} title="Nova cotação" size="lg" footer={<><Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button><Button size="sm" loading={act.isPending} disabled={!h.provider_id} onClick={() => act.mutate({ path: `/api/supply/requests/${id}/quotations`, idem: true, body: { provider_id: h.provider_id, payment_condition: h.payment_condition || null, delivery_days: h.delivery_days ? Number(h.delivery_days) : null, freight: h.freight || "0", note: h.note || null, items: items.map((i) => ({ request_item_id: i["id"], unit_price: prices[String(i["id"])]?.unit_price || "0", brand: prices[String(i["id"])]?.brand || null })) } })}>Salvar cotação</Button></>}>
    <div className="grid grid-cols-12 gap-2">
      <Field label="Fornecedor" required span={6}><RefSelect resource="people" value={h.provider_id} onChange={(v) => setH({ ...h, provider_id: v ?? "" })} filter={{ is_provider: "true" }} /></Field>
      <Field label="Cond. pagamento" span={3}><Input value={h.payment_condition} onChange={(e) => setH({ ...h, payment_condition: e.target.value })} /></Field>
      <Field label="Prazo entrega (dias)" span={3}><Input type="number" value={h.delivery_days} onChange={(e) => setH({ ...h, delivery_days: e.target.value })} /></Field>
      <Field label="Frete" span={3}><Input type="number" step="0.01" value={h.freight} onChange={(e) => setH({ ...h, freight: e.target.value })} /></Field>
      <Field label="Observação" span={9}><Input value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></Field>
    </div>
    <table className="table-dense mt-3 w-full text-[12.5px]"><thead><tr><th>Item</th><th className="w-20">Qtd.</th><th className="w-32">Marca</th><th className="w-32">Vl. unitário</th><th className="w-28 text-right">Total</th></tr></thead><tbody>
      {items.map((i) => { const k = String(i["id"]); const p = prices[k] ?? { unit_price: "", brand: "" }; return <tr key={k}><td>{String(i["description"])}</td><td>{num(i["quantity"] as string, 2)}</td><td><Input value={p.brand} onChange={(e) => setPrices({ ...prices, [k]: { ...p, brand: e.target.value } })} /></td><td><Input type="number" step="0.01" value={p.unit_price} onChange={(e) => setPrices({ ...prices, [k]: { ...p, unit_price: e.target.value } })} /></td><td className="num">{brl(Number(p.unit_price || 0) * Number(i["quantity"]))}</td></tr>; })}
    </tbody><tfoot><tr><td colSpan={4} className="text-right font-semibold">Total c/ frete</td><td className="num font-semibold">{brl(total)}</td></tr></tfoot></table>
  </Dialog>;
}
function Order({ id, enabled }: { id: string; enabled: boolean }) {
  const q = useQuery({ queryKey: ["order", id], queryFn: () => api<{ code: string; provider: Row | null; text: string; whatsapp_url: string | null; mailto_url: string | null }>(`/api/supply/requests/${id}/order`), enabled });
  if (!enabled) return <p className="text-xs text-slate-500">Sem permissão para visualizar o pedido de compra.</p>;
  if (!q.data) return null;
  return <div className="space-y-2"><p className="text-xs text-slate-500">{q.data.provider ? `Fornecedor: ${String(q.data.provider["provider_name"])}` : "Nenhuma cotação selecionada — o pedido usa os itens da solicitação."}</p><pre className="whitespace-pre-wrap rounded border bg-slate-50 p-3 text-xs">{q.data.text}</pre><div className="flex gap-2">{q.data.whatsapp_url && <a href={q.data.whatsapp_url} target="_blank" rel="noreferrer"><Button size="sm" variant="outline">Enviar via WhatsApp</Button></a>}{q.data.mailto_url && <a href={q.data.mailto_url}><Button size="sm" variant="outline">Enviar por e-mail</Button></a>}<Button size="sm" variant="outline" onClick={() => window.print()}>Imprimir</Button></div></div>;
}
function Comment({ id, act }: { id: string; act: ReturnType<typeof useAction> }) {
  const [t, setT] = React.useState("");
  return <div className="space-y-2"><Textarea value={t} onChange={(e) => setT(e.target.value)} placeholder="Escreva um comentário para o histórico do processo" /><Button size="sm" disabled={!t} loading={act.isPending} onClick={() => { act.mutate({ path: `/api/supply/requests/${id}/comments`, body: { text: t } }); setT(""); }}>Comentar</Button></div>;
}
