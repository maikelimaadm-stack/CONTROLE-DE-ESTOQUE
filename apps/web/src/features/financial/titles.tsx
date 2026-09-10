"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs, download } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, num, dateBR, dateTimeBR, todayISO } from "@/lib/utils";
import { Badge, Button, Card, CardHeader, CardBody, Field, Input, NativeSelect, Textarea, Tabs, Menu, Confirm, ErrorBox, Dialog } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { RefSelect } from "@/components/ui/ref-select";
import { FilterBar, useFilters, ApportionmentEditor, toAppLines, PlanEditor, defaultPlan, useCreate, useFarmDefault, DetailShell, KV, SimpleTable, useDoc, LoadingOr, type Row, type AppLine, type Plan } from "@/features/docs/shared";
import { ActionDialog, useAction } from "@/features/docs/actions";
import { MoreVertical, Plus } from "lucide-react";

export type Dir = "payable" | "receivable";
export const dirCfg = (dir: Dir) => ({ base: dir === "payable" ? "/financeiro/contas-a-pagar" : "/financeiro/contas-a-receber", endpoint: `/api/financial/${dir}s`, perm: dir === "payable" ? "payables" : "receivables", title: dir === "payable" ? "Contas a Pagar" : "Contas a Receber", person: dir === "payable" ? "Fornecedor" : "Cliente", personFilter: (dir === "payable" ? { is_provider: "true" } : { is_client: "true" }) as Record<string, string> });
const STATUS_OPTS = [["open", "Á vencer"], ["overdue", "Vencida"], ["partially_paid", "Baixa parcial"], ["paid", "Baixada"], ["advance_pending", "Adiantamento/Pendente"], ["advance_paid", "Adiantamento/Baixado"], ["invoice_pending", "Fatura/Pendente"], ["invoice_paid", "Fatura/Baixado"], ["cancelled", "Cancelada"]].map(([value, label]) => ({ value: value!, label: label! }));
const PAY_TYPES = [["single", "À vista"], ["installments", "Parcelado"], ["recurring", "Recorrente"], ["advance", "Adiantamento"], ["invoice_group", "Fatura"]];
const DOC_TYPES = ["nfe", "cte", "nfse", "nfce", "danfe", "darf", "dare", "gru", "other"];
export const titleTone = (s: string) => (s.includes("Baixad") ? "green" : s === "Vencida" ? "red" : s === "Cancelada" ? "slate" : s.includes("Parcial") ? "amber" : "blue");

export function TitleList({ dir, initialStatus }: { dir: Dir; initialStatus?: string }) {
  const c = dirCfg(dir); const { can } = useAuth(); const router = useRouter(); const qc = useQueryClient();
  const def = { status: initialStatus ?? "" };
  const { f, set, reset } = useFilters(def); const [applied, setApplied] = React.useState<Record<string, string>>(def);
  const [page, setPage] = React.useState(1); const [pageSize, setPageSize] = React.useState(20); const [sel, setSel] = React.useState<Set<string>>(new Set());
  const [batch, setBatch] = React.useState<"settle" | "cancel" | null>(null); const [cancelOne, setCancelOne] = React.useState<string | null>(null);
  const q = useQuery({ queryKey: ["titles", dir, applied, page, pageSize], queryFn: () => api<{ items: Row[]; total: number; totals: { amount: string; balance: string; paid: string } }>(`${c.endpoint}${qs({ ...applied, page, pageSize })}`) });
  const act = useAction(() => { setBatch(null); setCancelOne(null); setSel(new Set()); void qc.invalidateQueries({ queryKey: ["titles"] }); });
  return <Card>
    <CardHeader title={c.title} actions={<>
      {sel.size > 0 && can(`${c.perm}.settle`) && <Button size="sm" variant="secondary" onClick={() => setBatch("settle")}>Baixar selecionados ({sel.size})</Button>}
      {sel.size > 0 && can(`${c.perm}.delete`) && <Button size="sm" variant="danger" onClick={() => setBatch("cancel")}>Cancelar selecionados</Button>}
      {can(`${c.perm}.create`) && <Link href={`${c.base}/new`}><Button size="sm"><Plus className="h-3.5 w-3.5" /> Adicionar Novo</Button></Link>}
    </>} />
    <CardBody>
      <FilterBar f={f} set={set} reset={() => { reset(); setApplied(def); setPage(1); }} onApply={() => { setApplied({ ...f }); setPage(1); }} filters={[
        { name: "status", label: "Status", type: "select", options: STATUS_OPTS }, { name: "start_date", label: "Venc. início", type: "date" }, { name: "end_date", label: "Venc. fim", type: "date" }, { name: "start_emission_date", label: "Emissão início", type: "date" }, { name: "end_emission_date", label: "Emissão fim", type: "date" }, { name: "start_write_off_date", label: "Baixa início", type: "date" }, { name: "end_write_off_date", label: "Baixa fim", type: "date" },
        { name: "person_id", label: c.person, type: "ref", resource: "people", extra: c.personFilter }, { name: "number", label: "Nº documento", type: "text" }, { name: "note", label: "Observação", type: "text" }, { name: "amount", label: "Valor", type: "text" }, { name: "category_id", label: "Categoria", type: "ref", resource: "financial_categories" }, { name: "center_id", label: "Centro de Custo", type: "ref", resource: "cost_centers" }, { name: "account_id", label: "Conta bancária", type: "ref", resource: "bank_accounts" },
        { name: "title_type_id", label: "Tipo de título", type: "ref", resource: "title_types" }, { name: "payment_type", label: "Forma", type: "select", options: PAY_TYPES.map(([value, label]) => ({ value: value!, label: label! })) }, { name: "classification", label: "Classificação", type: "select", options: [{ value: "capex", label: "CAPEX" }, { value: "opex", label: "OPEX" }, { value: "unclassified", label: "Não classificado" }] }, { name: "harvest_id", label: "Safra", type: "ref", resource: "harvests" }, { name: "proprietary_id", label: "Proprietário", type: "ref", resource: "people", extra: { is_proprietary: "true" } }, { name: "farm_id", label: "Fazenda", type: "ref", resource: "farms" }, { name: "product", label: "Produto (NF)", type: "text" }
      ]} />
      {q.error && <ErrorBox error={q.error} />}
      <DataTable rows={q.data?.items ?? []} total={q.data?.total} page={page} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} loading={q.isLoading} selectable selected={sel} onSelect={setSel} onRowClick={(r) => router.push(`${c.base}/${r["id"]}`)}
        onExport={can(`${c.perm}.export`) ? (fmt) => download(`/api/reports/${dir === "payable" ? "payables" : "receivables"}${qs({ ...applied, format: fmt })}`, `${dir}.${fmt}`) : undefined}
        columns={[{ key: "code", label: "Cód." }, { key: "number", label: "Documento" }, { key: "farm_name", label: "Fazenda" }, { key: "person_name", label: c.person }, { key: "emission_date", label: "Emissão", render: (r) => dateBR(r["emission_date"] as string) }, { key: "due_date", label: "Vencimento", render: (r) => dateBR(r["due_date"] as string) }, { key: "installment_number", label: "PC", render: (r) => r["installment_number"] ? `${r["installment_number"]}/${r["installment_count"] ?? "?"}` : "1/1" }, { key: "amount", label: "Valor", align: "right", render: (r) => brl(r["amount"] as string) }, { key: "balance", label: "Saldo", align: "right", render: (r) => brl(r["balance"] as string) }, { key: "status_label", label: "Status", render: (r) => <Badge tone={titleTone(String(r["status_label"]))}>{String(r["status_label"])}</Badge> }, { key: "last_settlement_date", label: "Últ. baixa", render: (r) => r["last_settlement_date"] ? dateBR(r["last_settlement_date"] as string) : "" }, { key: "note", label: "Observação", className: "max-w-[260px] truncate" }]}
        footer={q.data && <tr><td colSpan={8} className="px-2 py-1">Totais (filtro)</td><td className="num">{brl(q.data.totals.amount)}</td><td className="num">{brl(q.data.totals.balance)}</td><td colSpan={3} className="px-2">Baixado: {brl(q.data.totals.paid)}</td></tr>}
        actions={(r) => <Menu trigger={<button className="rounded p-1 hover:bg-slate-100"><MoreVertical className="h-4 w-4" /></button>} items={[{ label: "Visualizar", href: `${c.base}/${r["id"]}` }, { label: "Editar", href: `${c.base}/${r["id"]}/edit`, disabled: r["status"] !== "open" || !can(`${c.perm}.edit`) }, { label: "Baixar", href: `${c.base}/${r["id"]}?settle=1`, disabled: !["open", "partially_paid"].includes(String(r["status"])) || !can(`${c.perm}.settle`) }, { label: "Duplicar", onClick: () => act.mutate({ path: `${c.endpoint}/${r["id"]}/duplicate` }), disabled: !can(`${c.perm}.duplicate`) }, { label: "Recibo", href: `${c.base}/${r["id"]}?receipt=1`, disabled: !can(`${c.perm}.receipt`) }, { label: "Cancelar", danger: true, onClick: () => setCancelOne(String(r["id"])), disabled: r["status"] === "cancelled" || !can(`${c.perm}.delete`) }]} />} />
      <Confirm open={Boolean(cancelOne)} onOpenChange={() => setCancelOne(null)} title="Cancelar título" text="Títulos com baixas confirmadas não podem ser cancelados; cancele as baixas antes. Continuar?" danger loading={act.isPending} onConfirm={() => cancelOne && act.mutate({ path: `${c.endpoint}/${cancelOne}/cancel`, body: { reason: "Cancelado pelo usuário" } })} />
      <Confirm open={batch === "cancel"} onOpenChange={() => setBatch(null)} title={`Cancelar ${sel.size} títulos`} danger loading={act.isPending} onConfirm={() => act.mutate({ path: `${c.endpoint}/cancel-batch`, body: { ids: [...sel] } })} />
      <ActionDialog open={batch === "settle"} onOpenChange={() => setBatch(null)} title={`Baixa em lote (${sel.size} títulos)`} text="Cada título é baixado pelo saldo integral. Escolha se o movimento bancário será único ou um por título." loading={act.isPending} fields={[{ name: "settlement_date", label: "Data da baixa", type: "date", required: true, default: todayISO() }, { name: "bank_account_id", label: "Conta bancária", type: "ref", resource: "bank_accounts", required: true }, { name: "movement_mode", label: "Movimento bancário", type: "select", options: [{ value: "separate", label: "Um por título" }, { value: "single", label: "Único (agrupado)" }], default: "separate" }, { name: "note", label: "Observação" }]} onSubmit={(v) => act.mutate({ path: `${c.endpoint}/settle-batch`, idem: true, body: { ids: [...sel], ...v, note: v["note"] || null } })} />
    </CardBody>
  </Card>;
}

/** Formulário de título (novo/edição) — espelha os campos da tela de referência, com rateio obrigatório = 100%. */
export function TitleForm({ dir, id }: { dir: Dir; id?: string }) {
  const c = dirCfg(dir); const router = useRouter(); const farm = useFarmDefault(); const qc = useQueryClient();
  const existing = useDoc<Row & { apportionments: Row[] }>(`${c.endpoint}/${id}`, Boolean(id));
  const [h, setH] = React.useState({ farm_id: "", number: "", title_type_id: "", proprietary_id: "", person_id: "", payment_type: "single", recurrence_type: "monthly", recurrence_count: "12", classification: "unclassified", document_type: "", is_deductible: false, is_tax: false, amount: "", discount: "0", emission_date: todayISO(), due_date: todayISO(), note: "", harvest_id: "", appropriation: "direct", appropriation_type: "", auto: false, auto_account: "", auto_date: todayISO() });
  const [lines, setLines] = React.useState<AppLine[]>([{ financial_category_id: "", cost_center_id: "", percentage: "100" }]);
  const [plan, setPlan] = React.useState<Plan>(defaultPlan());
  React.useEffect(() => { setH((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  React.useEffect(() => { const d = existing.data; if (!d) return; setH((o) => ({ ...o, farm_id: String(d["farm_id"]), number: String(d["number"]), title_type_id: String(d["title_type_id"] ?? ""), proprietary_id: String(d["proprietary_id"] ?? ""), person_id: String(d["person_id"] ?? ""), payment_type: String(d["payment_type"]), classification: String(d["classification"] ?? "unclassified"), document_type: String(d["document_type"] ?? ""), is_deductible: Boolean(d["is_deductible"]), is_tax: Boolean(d["is_tax"]), amount: String(d["amount"]), discount: String(d["discount"] ?? "0"), emission_date: String(d["emission_date"]).slice(0, 10), due_date: String(d["due_date"]).slice(0, 10), note: String(d["note"] ?? ""), harvest_id: String(d["harvest_id"] ?? ""), appropriation: String(d["appropriation"] ?? "direct") })); setLines(d.apportionments.map((a) => ({ financial_category_id: String(a["financial_category_id"]), cost_center_id: String(a["cost_center_id"]), chart_account_id: String(a["chart_account_id"] ?? ""), harvest_id: String(a["harvest_id"] ?? ""), percentage: String(a["percentage"]) }))); }, [existing.data]);
  const create = useCreate<{ id: string }>(c.endpoint, (r) => router.push(`${c.base}/${r.id}`));
  const upd = useAction(() => { void qc.invalidateQueries(); router.push(`${c.base}/${id}`); });
  const body = () => ({ farm_id: h.farm_id, number: h.number, title_type_id: h.title_type_id || null, proprietary_id: h.proprietary_id || null, person_id: h.person_id || null, payment_type: h.payment_type, recurrence_type: h.payment_type === "recurring" ? h.recurrence_type : null, recurrence_count: h.payment_type === "recurring" ? Number(h.recurrence_count) : undefined, classification: h.classification, document_type: h.document_type || null, is_deductible: h.is_deductible, is_tax: h.is_tax, amount: h.amount, discount: h.discount || "0", emission_date: h.emission_date, due_date: h.due_date, note: h.note, harvest_id: h.harvest_id || null, appropriation: h.appropriation, appropriation_type: h.appropriation === "indirect" ? h.appropriation_type || "indirect" : null, apportionment: toAppLines(lines), plan: h.payment_type === "installments" ? plan : null, auto_settle: h.auto && h.auto_account ? { bank_account_id: h.auto_account, date: h.auto_date } : null });
  const sumOk = Math.abs(lines.reduce((a, l) => a + Number(l.percentage || 0), 0) - 100) < 0.01 && lines.every((l) => l.financial_category_id && l.cost_center_id);
  const valid = h.farm_id && h.number && h.person_id && Number(h.amount) > 0 && h.note && sumOk;
  const busy = create.isPending || upd.isPending;
  return <Card><CardHeader title={`${id ? "Editar" : "Novo"} título — ${c.title}`} actions={<><Button variant="outline" size="sm" onClick={() => router.back()}>Voltar</Button><Button size="sm" loading={busy} disabled={!valid} onClick={() => (id ? upd.mutate({ path: `${c.endpoint}/${id}`, method: "PUT", body: body() }) : create.mutate(body()))}>Salvar</Button></>} /><CardBody className="space-y-4">
    <LoadingOr q={{ isLoading: Boolean(id) && existing.isLoading, error: existing.error }}>
    <div className="grid grid-cols-12 gap-3">
      <Field label="Fazenda" required span={3}><RefSelect resource="farms" value={h.farm_id} onChange={(v) => setH({ ...h, farm_id: v ?? "" })} /></Field>
      <Field label="Nº Documento" required span={2}><Input value={h.number} onChange={(e) => setH({ ...h, number: e.target.value })} /></Field>
      <Field label="Tipo de Título" span={2}><RefSelect resource="title_types" value={h.title_type_id} onChange={(v) => setH({ ...h, title_type_id: v ?? "" })} /></Field>
      <Field label="Tipo de Documento" span={2}><NativeSelect value={h.document_type} onChange={(e) => setH({ ...h, document_type: e.target.value })}><option value="">—</option>{DOC_TYPES.map((d) => <option key={d} value={d}>{d.toUpperCase()}</option>)}</NativeSelect></Field>
      <Field label="Proprietário Gestor" span={3}><RefSelect resource="people" value={h.proprietary_id} onChange={(v) => setH({ ...h, proprietary_id: v ?? "" })} filter={{ is_proprietary: "true" }} /></Field>
      <Field label={c.person} required span={4}><RefSelect resource="people" value={h.person_id} onChange={(v) => setH({ ...h, person_id: v ?? "" })} filter={c.personFilter} /></Field>
      <Field label="Forma de pagamento" span={2}><NativeSelect value={h.payment_type} onChange={(e) => setH({ ...h, payment_type: e.target.value })} disabled={Boolean(id)}>{PAY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect></Field>
      {h.payment_type === "recurring" && <><Field label="Recorrência" span={2}><NativeSelect value={h.recurrence_type} onChange={(e) => setH({ ...h, recurrence_type: e.target.value })}><option value="weekly">Semanal</option><option value="monthly">Mensal</option><option value="quarterly">Trimestral</option><option value="yearly">Anual</option></NativeSelect></Field><Field label="Qtd. ocorrências" span={2}><Input type="number" min={1} max={60} value={h.recurrence_count} onChange={(e) => setH({ ...h, recurrence_count: e.target.value })} /></Field></>}
      <Field label="Classificação" span={2}><NativeSelect value={h.classification} onChange={(e) => setH({ ...h, classification: e.target.value })}><option value="unclassified">Não classificado</option><option value="capex">CAPEX</option><option value="opex">OPEX</option></NativeSelect></Field>
      <Field label="Valor" required span={2}><Input type="number" step="0.01" min="0.01" value={h.amount} onChange={(e) => setH({ ...h, amount: e.target.value })} /></Field>
      <Field label="Desconto" span={2}><Input type="number" step="0.01" min="0" value={h.discount} onChange={(e) => setH({ ...h, discount: e.target.value })} /></Field>
      <Field label="Emissão" required span={2}><Input type="date" value={h.emission_date} onChange={(e) => setH({ ...h, emission_date: e.target.value })} /></Field>
      <Field label="Vencimento" required span={2}><Input type="date" value={h.due_date} onChange={(e) => setH({ ...h, due_date: e.target.value })} /></Field>
      <Field label="Safra" span={2}><RefSelect resource="harvests" value={h.harvest_id} onChange={(v) => setH({ ...h, harvest_id: v ?? "" })} /></Field>
      <Field label="Dedutível (IR)" span={2}><NativeSelect value={h.is_deductible ? "1" : "0"} onChange={(e) => setH({ ...h, is_deductible: e.target.value === "1" })}><option value="0">Não</option><option value="1">Sim</option></NativeSelect></Field>
      <Field label="Tributo" span={2}><NativeSelect value={h.is_tax ? "1" : "0"} onChange={(e) => setH({ ...h, is_tax: e.target.value === "1" })}><option value="0">Não</option><option value="1">Sim</option></NativeSelect></Field>
      <Field label="Apropriação" span={2}><NativeSelect value={h.appropriation} onChange={(e) => setH({ ...h, appropriation: e.target.value })}><option value="direct">Direta</option><option value="indirect">Indireta</option></NativeSelect></Field>
      {h.appropriation === "indirect" && <Field label="Tipo de apropriação" span={2}><NativeSelect value={h.appropriation_type} onChange={(e) => setH({ ...h, appropriation_type: e.target.value })}><option value="indirect">Indireta</option><option value="livestock">Pecuária</option><option value="area">Área</option><option value="maintenance">Manutenção</option><option value="fuel">Combustível</option></NativeSelect></Field>}
      <Field label="Observação" required span={12}><Textarea value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></Field>
    </div>
    {h.payment_type === "installments" && !id && <><h3 className="text-xs font-semibold uppercase text-brand-700">Parcelamento</h3><PlanEditor plan={plan} onChange={setPlan} /></>}
    <h3 className="text-xs font-semibold uppercase text-brand-700">Rateio (categoria / centro de custo)</h3>
    <ApportionmentEditor lines={lines} onChange={setLines} total={Number(h.amount || 0) - Number(h.discount || 0)} />
    {!id && <div className="grid grid-cols-12 gap-3"><Field label="Baixar automaticamente" span={3}><NativeSelect value={h.auto ? "1" : "0"} onChange={(e) => setH({ ...h, auto: e.target.value === "1" })}><option value="0">Não</option><option value="1">Sim (gera movimento bancário)</option></NativeSelect></Field>{h.auto && <><Field label="Conta bancária" required span={4}><RefSelect resource="bank_accounts" value={h.auto_account} onChange={(v) => setH({ ...h, auto_account: v ?? "" })} /></Field><Field label="Data da baixa" span={2}><Input type="date" value={h.auto_date} onChange={(e) => setH({ ...h, auto_date: e.target.value })} /></Field></>}</div>}
    </LoadingOr>
  </CardBody></Card>;
}

export function TitleDetail({ dir, id }: { dir: Dir; id: string }) {
  const c = dirCfg(dir); const { can } = useAuth();
  const q = useDoc<Row & { apportionments: Row[]; settlements: Row[]; installments: Row[]; attachments: Row[]; appropriations: Row[] }>(`${c.endpoint}/${id}`);
  const [settle, setSettle] = React.useState(false); const [cancelS, setCancelS] = React.useState<string | null>(null); const [receipt, setReceipt] = React.useState(false); const [cancel, setCancel] = React.useState(false);
  React.useEffect(() => { const p = new URLSearchParams(window.location.search); if (p.get("settle")) setSettle(true); if (p.get("receipt")) setReceipt(true); }, []);
  const act = useAction(() => { setSettle(false); setCancelS(null); setCancel(false); });
  const d = q.data; const open = d && ["open", "partially_paid"].includes(String(d["status"]));
  return <DetailShell title={`${c.title} — ${d?.["number"] ?? ""}`} back={c.base} actions={d && <>
    {open && can(`${c.perm}.settle`) && <Button size="sm" onClick={() => setSettle(true)}>Baixar</Button>}
    {d["status"] === "open" && can(`${c.perm}.edit`) && <Link href={`${c.base}/${id}/edit`}><Button size="sm" variant="outline">Editar</Button></Link>}
    {can(`${c.perm}.receipt`) && <Button size="sm" variant="outline" onClick={() => setReceipt(true)}>Recibo</Button>}
    {can(`${c.perm}.duplicate`) && <Button size="sm" variant="outline" onClick={() => act.mutate({ path: `${c.endpoint}/${id}/duplicate` })}>Duplicar</Button>}
    {d["status"] !== "cancelled" && can(`${c.perm}.delete`) && <Button size="sm" variant="danger" onClick={() => setCancel(true)}>Cancelar</Button>}
  </>}>
    <LoadingOr q={q}>{d && <>
      <div><Badge tone={titleTone(String(d["status_label"]))}>{String(d["status_label"])}</Badge></div>
      <KV items={[["Código", String(d["code"])], ["Fazenda", String(d["farm_name"])], [c.person, String(d["person_name"] ?? "—")], ["Proprietário", String(d["proprietary_name"] ?? "—")], ["Emissão", dateBR(d["emission_date"] as string)], ["Vencimento", dateBR(d["due_date"] as string)], ["Valor", brl(d["amount"] as string)], ["Desconto", brl(d["discount"] as string)], ["Valor líquido", brl(d["net_amount"] as string)], ["Saldo", brl(d["balance"] as string)], ["Forma", String(d["payment_type"])], ["Parcela", d["installment_number"] ? `${d["installment_number"]}/${d["installment_count"]}` : "1/1"], ["Classificação", String(d["classification"])], ["Tipo doc.", String(d["document_type"] ?? "—")], ["Safra", String(d["harvest_name"] ?? "—")], ["Dedutível", d["is_deductible"] ? "Sim" : "Não"], ["Tributo", d["is_tax"] ? "Sim" : "Não"], ["Origem", d["source_type"] ? `${d["source_type"]}` : "Manual"], ["Criado por", String(d["created_by_name"] ?? "")], ["Versão", String(d["version"])], ["Observação", String(d["note"])]]} />
      <Tabs tabs={[
        { value: "app", label: "Rateio", content: <SimpleTable rows={d.apportionments} cols={[{ key: "category_code", label: "Cód." }, { key: "category_name", label: "Categoria" }, { key: "cost_center_name", label: "Centro de Custo" }, { key: "chart_account_name", label: "Conta contábil" }, { key: "harvest_name", label: "Safra" }, { key: "percentage", label: "%", align: "right", render: (r) => num(r["percentage"] as string) }, { key: "amount", label: "Valor", align: "right", render: (r) => brl(r["amount"] as string) }]} /> },
        { value: "settlements", label: "Baixas", badge: d.settlements.length, content: <SimpleTable rows={d.settlements} cols={[{ key: "settlement_date", label: "Data", render: (r) => dateBR(r["settlement_date"] as string) }, { key: "settlement_kind", label: "Tipo", render: (r) => ({ bank_movement: "Movimento bancário", cross_settlement: "Encontro de contas", advance_compensation: "Compensação de adiantamento" } as Record<string, string>)[String(r["settlement_kind"])] ?? String(r["settlement_kind"]) }, { key: "bank_account_name", label: "Conta" }, { key: "amount", label: "Valor", align: "right", render: (r) => brl(r["amount"] as string) }, { key: "discount", label: "Desconto", align: "right", render: (r) => brl(r["discount"] as string) }, { key: "interest", label: "Juros", align: "right", render: (r) => brl(r["interest"] as string) }, { key: "penalty", label: "Multa", align: "right", render: (r) => brl(r["penalty"] as string) }, { key: "net_amount", label: "Líquido", align: "right", render: (r) => brl(r["net_amount"] as string) }, { key: "status", label: "Status", render: (r) => <Badge tone={r["status"] === "confirmed" ? "green" : "red"}>{r["status"] === "confirmed" ? "Confirmada" : "Cancelada"}</Badge> }, { key: "created_by_name", label: "Usuário" }, { key: "x", label: "", render: (r) => r["status"] === "confirmed" && can(`${c.perm}.cancel_settlement`) ? <Button size="sm" variant="ghost" onClick={() => setCancelS(String(r["id"]))}>Cancelar baixa</Button> : null }]} /> },
        { value: "inst", label: "Parcelas", badge: d.installments.length, content: <SimpleTable rows={d.installments} cols={[{ key: "installment_number", label: "PC" }, { key: "code", label: "Cód." }, { key: "number", label: "Documento" }, { key: "due_date", label: "Vencimento", render: (r) => dateBR(r["due_date"] as string) }, { key: "amount", label: "Valor", align: "right", render: (r) => brl(r["amount"] as string) }, { key: "balance", label: "Saldo", align: "right", render: (r) => brl(r["balance"] as string) }, { key: "status", label: "Status", render: (r) => <Link className="text-brand-700 underline" href={`${c.base}/${r["id"]}`}>{String(r["status"])}</Link> }]} /> },
        { value: "files", label: "Anexos", badge: d.attachments.length, content: <SimpleTable rows={d.attachments} cols={[{ key: "file_name", label: "Arquivo" }, { key: "description", label: "Descrição" }, { key: "created_at", label: "Enviado em", render: (r) => dateTimeBR(r["created_at"] as string) }]} /> }
      ]} />
    </>}</LoadingOr>
    {d && <SettleDialog open={settle} onOpenChange={setSettle} dir={dir} title={d} act={act} />}
    <ActionDialog open={Boolean(cancelS)} onOpenChange={() => setCancelS(null)} title="Cancelar baixa" text="O movimento bancário vinculado será estornado e o saldo do título restabelecido." danger loading={act.isPending} fields={[{ name: "reason", label: "Motivo", type: "textarea", required: true }]} onSubmit={(v) => act.mutate({ path: `${c.endpoint}/${id}/settlements/${cancelS}/cancel`, body: v })} />
    <ActionDialog open={cancel} onOpenChange={setCancel} title="Cancelar título" danger loading={act.isPending} fields={[{ name: "reason", label: "Motivo", type: "textarea", required: true }]} onSubmit={(v) => act.mutate({ path: `${c.endpoint}/${id}/cancel`, body: v })} />
    <ReceiptDialog open={receipt} onOpenChange={setReceipt} path={`${c.endpoint}/${id}/receipt`} />
  </DetailShell>;
}

function SettleDialog({ open, onOpenChange, dir, title, act }: { open: boolean; onOpenChange: (o: boolean) => void; dir: Dir; title: Row; act: ReturnType<typeof useAction> }) {
  const c = dirCfg(dir);
  const [v, setV] = React.useState({ settlement_date: todayISO(), settlement_kind: "bank_movement", bank_account_id: "", cross_title_id: "", amount: String(title["balance"]), discount: "0", penalty: "0", interest: "0", increase: "0", note: "", movement_mode: "separate" });
  React.useEffect(() => { if (open) setV((o) => ({ ...o, amount: String(title["balance"]) })); }, [open, title]);
  const net = Number(v.amount || 0) - Number(v.discount || 0) + Number(v.penalty || 0) + Number(v.interest || 0) + Number(v.increase || 0);
  const exceeds = Number(v.amount || 0) > Number(title["balance"]) + 0.005;
  return <ActionDialogRaw open={open} onOpenChange={onOpenChange} title={`Baixar título ${String(title["number"])}`} footer={<><Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button><Button size="sm" loading={act.isPending} disabled={exceeds || (v.settlement_kind === "bank_movement" && !v.bank_account_id) || (v.settlement_kind === "cross_settlement" && !v.cross_title_id)} onClick={() => act.mutate({ path: `${c.endpoint}/${title["id"]}/settle`, idem: true, body: { ...v, bank_account_id: v.bank_account_id || null, cross_title_id: v.cross_title_id || null, note: v.note || null } })}>Confirmar baixa</Button></>}>
    <div className="grid grid-cols-12 gap-2">
      <Field label="Data da baixa" required span={4}><Input type="date" value={v.settlement_date} onChange={(e) => setV({ ...v, settlement_date: e.target.value })} /></Field>
      <Field label="Tipo" span={4}><NativeSelect value={v.settlement_kind} onChange={(e) => setV({ ...v, settlement_kind: e.target.value })}><option value="bank_movement">Movimento bancário</option><option value="cross_settlement">Encontro de contas</option><option value="advance_compensation">Compensação de adiantamento</option></NativeSelect></Field>
      <Field label="Movimento" span={4}><NativeSelect value={v.movement_mode} onChange={(e) => setV({ ...v, movement_mode: e.target.value })}><option value="separate">Separado (valor + juros)</option><option value="single">Único (líquido)</option></NativeSelect></Field>
      {v.settlement_kind === "bank_movement" ? <Field label="Conta bancária" required span={12}><RefSelect resource="bank_accounts" value={v.bank_account_id} onChange={(x) => setV({ ...v, bank_account_id: x ?? "" })} /></Field> : <Field label={dir === "payable" ? "Título a receber (contrapartida)" : "Título a pagar (contrapartida)"} required span={12}><CrossTitleSelect dir={dir} value={v.cross_title_id} onChange={(x) => setV({ ...v, cross_title_id: x })} /></Field>}
      <Field label="Valor" required span={3} error={exceeds ? "Maior que o saldo" : undefined}><Input type="number" step="0.01" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
      <Field label="Desconto" span={2}><Input type="number" step="0.01" value={v.discount} onChange={(e) => setV({ ...v, discount: e.target.value })} /></Field>
      <Field label="Juros" span={2}><Input type="number" step="0.01" value={v.interest} onChange={(e) => setV({ ...v, interest: e.target.value })} /></Field>
      <Field label="Multa" span={2}><Input type="number" step="0.01" value={v.penalty} onChange={(e) => setV({ ...v, penalty: e.target.value })} /></Field>
      <Field label="Acréscimo" span={3}><Input type="number" step="0.01" value={v.increase} onChange={(e) => setV({ ...v, increase: e.target.value })} /></Field>
      <Field label="Observação" span={12}><Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
    </div>
    <p className="mt-2 text-sm">Saldo do título: <b>{brl(title["balance"] as string)}</b> · Valor líquido do movimento: <b>{brl(net)}</b>{exceeds && <span className="ml-2 text-red-600">O valor da baixa não pode exceder o saldo.</span>}</p>
  </ActionDialogRaw>;
}
function CrossTitleSelect({ dir, value, onChange }: { dir: Dir; value: string; onChange: (v: string) => void }) {
  const other = dir === "payable" ? "receivable" : "payable";
  const q = useQuery({ queryKey: ["cross", other], queryFn: () => api<{ items: Row[] }>(`/api/financial/${other}s${qs({ pageSize: 100 })}`) });
  return <NativeSelect value={value} onChange={(e) => onChange(e.target.value)}><option value="">Selecione</option>{q.data?.items.filter((t) => ["open", "partially_paid"].includes(String(t["status"]))).map((t) => <option key={String(t["id"])} value={String(t["id"])}>{String(t["number"])} — {String(t["person_name"] ?? "")} — saldo {brl(t["balance"] as string)}</option>)}</NativeSelect>;
}
function ReceiptDialog({ open, onOpenChange, path }: { open: boolean; onOpenChange: (o: boolean) => void; path: string }) {
  const q = useQuery({ queryKey: ["receipt", path], queryFn: () => api<{ receipt_text: string }>(path), enabled: open });
  return <ActionDialogRaw open={open} onOpenChange={onOpenChange} title="Recibo" footer={<Button size="sm" onClick={() => window.print()}>Imprimir</Button>}><pre className="whitespace-pre-wrap rounded border bg-slate-50 p-3 text-xs">{q.data?.receipt_text ?? "…"}</pre></ActionDialogRaw>;
}
function ActionDialogRaw(p: { open: boolean; onOpenChange: (o: boolean) => void; title: string; footer: React.ReactNode; children: React.ReactNode }) { return <Dialog open={p.open} onOpenChange={p.onOpenChange} title={p.title} size="lg" footer={p.footer}>{p.children}</Dialog>; }
