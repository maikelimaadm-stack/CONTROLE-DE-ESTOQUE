"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, dateBR, todayISO } from "@/lib/utils";
import { Badge, Button, Card, CardHeader, CardBody, Dialog, Field, Input } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { DataTable } from "@/components/ui/data-table";
import { useCreate, useFarmDefault, type Row } from "@/features/docs/shared";
import { COPY, enumLabel, statusLabel } from "@/lib/copy";
export function SalaryAdvancesPanel() {
  const { can } = useAuth(); const farm = useFarmDefault(); const [open, setOpen] = React.useState(false); const [page, setPage] = React.useState(1);
  const q = useQuery({ queryKey: ["advances", page], queryFn: () => api<{ items: Row[]; total: number }>(`/api/hr/advances${qs({ page, pageSize: 20 })}`) });
  const [h, setH] = React.useState({ farm_id: "", advance_date: todayISO(), person_id: "", amount: "", installments: "1", note: "", due_date: "", financial_category_id: "", cost_center_id: "" });
  React.useEffect(() => { setH((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const create = useCreate("/api/hr/advances", () => { setOpen(false); void q.refetch(); });
  return <Card><CardHeader title="Adiantamentos Salariais" subtitle="Gera conta a pagar ao funcionário; é descontado automaticamente na apuração do mês." actions={can("salary_advances.create") && <Button size="sm" onClick={() => setOpen(true)}>Novo adiantamento</Button>} /><CardBody>
    <DataTable rows={q.data?.items ?? []} total={q.data?.total} page={page} pageSize={20} onPage={setPage} loading={q.isLoading} columns={[{ key: "code", label: "Código" }, { key: "advance_date", label: "Data", render: (r) => dateBR(r["advance_date"] as string) }, { key: "person_name", label: "Funcionário" }, { key: "farm_name", label: "Fazenda" }, { key: "amount", label: "Valor", align: "right", render: (r) => brl(r["amount"] as string) }, { key: "installments", label: "Parcelas" }, { key: "status", label: COPY.situacao, render: (r) => <Badge tone={r["status"] === "open" ? "amber" : "green"}>{statusLabel(r["status"])}</Badge> }, { key: "title_status", label: "Título", render: (r) => r["title_id"] ? <Link className="text-brand-700 underline" href={`/financeiro/contas-a-pagar/${r["title_id"]}`}>{enumLabel("title_status", r["title_status"])} ({brl(r["title_balance"] as string)})</Link> : "—" }, { key: "note", label: "Observação" }]} />
    <Dialog open={open} onOpenChange={setOpen} title="Novo adiantamento" footer={<Button size="sm" loading={create.isPending} disabled={!h.person_id || !h.amount} onClick={() => create.mutate({ ...h, installments: Number(h.installments), note: h.note || null, due_date: h.due_date || undefined, financial_category_id: h.financial_category_id || undefined, cost_center_id: h.cost_center_id || undefined })}>Salvar</Button>}>
      <div className="grid grid-cols-12 gap-2">
        <Field label="Fazenda" required span={6}><RefSelect resource="farms" value={h.farm_id} onChange={(v) => setH({ ...h, farm_id: v ?? "" })} /></Field><Field label="Data" span={3}><Input type="date" value={h.advance_date} onChange={(e) => setH({ ...h, advance_date: e.target.value })} /></Field><Field label="Vencimento" span={3}><Input type="date" value={h.due_date} onChange={(e) => setH({ ...h, due_date: e.target.value })} /></Field>
        <Field label="Funcionário" required span={8}><RefSelect resource="people" value={h.person_id} onChange={(v) => setH({ ...h, person_id: v ?? "" })} filter={{ is_employee: "true" }} /></Field><Field label="Valor" required span={2}><Input type="number" step="0.01" value={h.amount} onChange={(e) => setH({ ...h, amount: e.target.value })} /></Field><Field label="Parcelas" span={2}><Input type="number" min={1} max={12} value={h.installments} onChange={(e) => setH({ ...h, installments: e.target.value })} /></Field>
        <Field label="Categoria financeira" span={6}><RefSelect resource="financial_categories" value={h.financial_category_id} onChange={(v) => setH({ ...h, financial_category_id: v ?? "" })} filter={{ kind: "analytic" }} /></Field><Field label="Centro de custo" span={6}><RefSelect resource="cost_centers" value={h.cost_center_id} onChange={(v) => setH({ ...h, cost_center_id: v ?? "" })} filter={{ kind: "analytic" }} /></Field>
        <Field label="Observação" span={12}><Input value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></Field>
      </div>
    </Dialog>
  </CardBody></Card>;
}
