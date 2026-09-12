"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, monthStartISO, monthBR } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input, Spinner, StatusBadge } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { SimpleTable, useFarmDefault, type Row } from "@/features/docs/shared";
import { ActionDialog, useAction } from "@/features/docs/actions";
import { COPY } from "@/lib/copy";
export function EarningsPanel() {
  const { can } = useAuth(); const farm = useFarmDefault(); const [farmId, setFarmId] = React.useState(""); const [month, setMonth] = React.useState(monthStartISO()); const [sel, setSel] = React.useState<string | null>(null); const [gen, setGen] = React.useState(false);
  React.useEffect(() => { setFarmId((o) => o || farm); }, [farm]);
  const list = useQuery({ queryKey: ["earnings"], queryFn: () => api<{ items: Row[] }>("/api/hr/earnings") });
  const det = useQuery({ queryKey: ["earning", sel], queryFn: () => api<Row & { lines: Row[] }>(`/api/hr/earnings/${sel}`), enabled: Boolean(sel) });
  const act = useAction<{ id?: string }>((r) => { setGen(false); if (r?.id) setSel(r.id); });
  const byPerson = React.useMemo(() => { const m = new Map<string, { name: string; add: number; sub: number; lines: Row[] }>(); for (const l of det.data?.lines ?? []) { const k = String(l["person_id"]); const e = m.get(k) ?? { name: String(l["person_name"]), add: 0, sub: 0, lines: [] }; if (l["condition"] === "add") e.add += Number(l["amount"]); else e.sub += Number(l["amount"]); e.lines.push(l); m.set(k, e); } return [...m.values()]; }, [det.data]);
  return <div className="space-y-3">
    <Card><CardHeader title="Apuração Mensal (folha)" subtitle="Salário base + eventos fixos + bonificações − faltas − adiantamentos. Gera títulos a pagar por funcionário." /><CardBody>
      <div className="grid grid-cols-12 gap-2"><Field label="Fazenda" span={4}><RefSelect resource="farms" value={farmId} onChange={(v) => setFarmId(v ?? "")} /></Field><Field label="Mês" span={3}><Input type="date" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>{can("earnings.create") && <div className="col-span-3 flex items-end"><Button size="sm" loading={act.isPending} disabled={!farmId} onClick={() => act.mutate({ path: "/api/hr/earnings/calculate", body: { farm_id: farmId, reference_month: month } })}>Calcular / recalcular</Button></div>}</div>
      {list.isLoading ? <Spinner /> : <div className="mt-3"><SimpleTable rows={list.data?.items ?? []} cols={[{ key: "reference_month", label: "Mês", render: (r) => monthBR(r["reference_month"] as string) }, { key: "code", label: "Código" }, { key: "farm_name", label: "Fazenda" }, { key: "employees", label: "Funcionários", align: "right" }, { key: "total_earnings", label: "Proventos", align: "right", render: (r) => brl(r["total_earnings"] as string) }, { key: "total_deductions", label: "Descontos", align: "right", render: (r) => brl(r["total_deductions"] as string) }, { key: "total_net", label: "Líquido", align: "right", render: (r) => brl(r["total_net"] as string) }, { key: "status", label: COPY.situacao, render: (r) => <StatusBadge domain="status" value={r["status"]} /> }, { key: "x", label: "", render: (r) => <Button size="sm" variant="outline" onClick={() => setSel(String(r["id"]))}>Detalhar</Button> }]} /></div>}
    </CardBody></Card>
    {det.data && <Card><CardHeader title={`Apuração ${String(det.data["code"])} — ${String(det.data["reference_month"]).slice(0, 7)}`} actions={<>{det.data["status"] === "open" && can("earnings.generate_financial") && <Button size="sm" onClick={() => setGen(true)}>Gerar financeiro</Button>}{det.data["status"] !== "closed" && can("earnings.edit") && <Button size="sm" variant="outline" onClick={() => act.mutate({ path: `/api/hr/earnings/${sel}/close` })}>Fechar</Button>}</>} /><CardBody className="space-y-2">
      {byPerson.map((p) => <details key={p.name} className="rounded border p-2"><summary className="cursor-pointer text-sm">{p.name} — proventos {brl(p.add)} · descontos {brl(p.sub)} · <b>líquido {brl(p.add - p.sub)}</b></summary><SimpleTable rows={p.lines} cols={[{ key: "description", label: "Evento" }, { key: "condition", label: "Tipo", render: (r) => r["condition"] === "add" ? "Provento" : "Desconto" }, { key: "amount", label: "Valor", align: "right", render: (r) => brl(r["amount"] as string) }]} /></details>)}
    </CardBody></Card>}
    <ActionDialog open={gen} onOpenChange={setGen} title="Gerar contas a pagar da folha" loading={act.isPending} fields={[{ name: "due_date", label: "Vencimento", type: "date", required: true }, { name: "financial_category_id", label: "Categoria", type: "ref", resource: "financial_categories", required: true, filter: { kind: "analytic" } }, { name: "cost_center_id", label: "Centro de custo", type: "ref", resource: "cost_centers", required: true, filter: { kind: "analytic" } }]} onSubmit={(v) => act.mutate({ path: `/api/hr/earnings/${sel}/generate-financial`, body: v })} />
  </div>;
}
