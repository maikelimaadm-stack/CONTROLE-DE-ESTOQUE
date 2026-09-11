"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { brl, dateBR, monthStartISO, todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input, NativeSelect, Spinner, Stat, ErrorBox } from "@/components/ui";
import { Lines } from "@/components/charts";
import { SimpleTable, type Row } from "@/features/docs/shared";
interface CF { opening_balance: string; closing_balance: string; periods: { period: string; in_amount: string; out_amount: string; balance: string }[]; movements: Row[] | null }
export function CashFlowPanel() {
  const accounts = useQuery({ queryKey: ["acc-bal"], queryFn: () => api<{ items: Row[]; total_balance: string }>("/api/financial/bank-accounts/balances") });
  const [sel, setSel] = React.useState<string[]>([]); const [f, setF] = React.useState({ period: "monthly", mode: "synthetic", start_date: monthStartISO(), end_date: todayISO() }); const [applied, setApplied] = React.useState<typeof f & { ids: string[] } | null>(null);
  React.useEffect(() => { if (accounts.data && !sel.length) setSel(accounts.data.items.map((a) => String(a["id"]))); }, [accounts.data, sel.length]);
  const q = useQuery({ queryKey: ["cashflow", applied], queryFn: () => api<CF>(`/api/financial/cash-flow${qs({ account_ids: applied!.ids.join(","), period: applied!.period, mode: applied!.mode, start_date: applied!.start_date, end_date: applied!.end_date })}`), enabled: Boolean(applied?.ids.length) });
  return <div className="space-y-3">
    <Card><CardHeader title="Fluxo de Caixa (realizado)" subtitle="Saldo inicial + entradas − saídas por período, por conta bancária" /><CardBody>
      <div className="grid grid-cols-12 gap-2">
        <Field label="Contas" span={12}><div className="flex flex-wrap gap-2">{accounts.data?.items.map((a) => <label key={String(a["id"])} className="flex items-center gap-1 rounded border px-2 py-1 text-xs"><input type="checkbox" checked={sel.includes(String(a["id"]))} onChange={(e) => setSel(e.target.checked ? [...sel, String(a["id"])] : sel.filter((x) => x !== a["id"]))} />{String(a["description"] ?? a["code"])} <span className="text-slate-400">({brl(a["balance"] as string)})</span></label>)}</div></Field>
        <Field label="Período" span={2}><NativeSelect value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}><option value="daily">Diário</option><option value="monthly">Mensal</option><option value="yearly">Anual</option></NativeSelect></Field>
        <Field label="Modo" span={2}><NativeSelect value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="synthetic">Sintético</option><option value="analytic">Analítico</option></NativeSelect></Field>
        <Field label="Início" span={2}><Input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
        <Field label="Fim" span={2}><Input type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
        <div className="col-span-2 flex items-end"><Button size="sm" onClick={() => setApplied({ ...f, ids: sel })} disabled={!sel.length}>Gerar</Button></div>
      </div>
    </CardBody></Card>
    {q.isLoading && <Spinner />}{q.error && <ErrorBox error={q.error} />}
    {q.data && <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Saldo inicial" value={brl(q.data.opening_balance)} /><Stat label="Entradas" value={brl(q.data.periods.reduce((a, p) => a + Number(p.in_amount), 0))} tone="green" /><Stat label="Saídas" value={brl(q.data.periods.reduce((a, p) => a + Number(p.out_amount), 0))} tone="red" /><Stat label="Saldo final" value={brl(q.data.closing_balance)} tone={Number(q.data.closing_balance) >= 0 ? "green" : "red"} /></div>
      <Card><CardBody><Lines data={q.data.periods.map((p) => ({ ...p, in: Number(p.in_amount), out: Number(p.out_amount), bal: Number(p.balance) }))} x="period" series={[{ key: "in", label: "Entradas", color: "#2b6f3a" }, { key: "out", label: "Saídas", color: "#c0392b" }, { key: "bal", label: "Saldo", color: "#2563eb" }]} /></CardBody></Card>
      <Card><CardHeader title="Por período" /><CardBody><SimpleTable rows={q.data.periods as unknown as Row[]} cols={[{ key: "period", label: "Período", render: (r) => f.period === "daily" ? dateBR(r["period"] as string) : String(r["period"]).slice(0, f.period === "yearly" ? 4 : 7) }, { key: "in_amount", label: "Entradas", align: "right", render: (r) => brl(r["in_amount"] as string) }, { key: "out_amount", label: "Saídas", align: "right", render: (r) => brl(r["out_amount"] as string) }, { key: "balance", label: "Saldo acumulado", align: "right", render: (r) => brl(r["balance"] as string) }]} /></CardBody></Card>
      {q.data.movements && <Card><CardHeader title="Movimentos (analítico)" /><CardBody><SimpleTable rows={q.data.movements} cols={[{ key: "movement_date", label: "Data", render: (r) => dateBR(r["movement_date"] as string) }, { key: "account_code", label: "Conta" }, { key: "type", label: "Tipo", render: (r) => r["type"] === "in" ? "Entrada" : "Saída" }, { key: "document", label: "Documento" }, { key: "categories", label: "Categorias" }, { key: "note", label: "Observação" }, { key: "amount", label: "Valor", align: "right", render: (r) => brl(r["amount"] as string) }]} /></CardBody></Card>}
    </>}
  </div>;
}
