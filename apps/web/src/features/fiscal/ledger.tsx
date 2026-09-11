"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { brl, monthStartISO, todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Input, Spinner, ErrorBox } from "@/components/ui";
import { SimpleTable, type Row } from "@/features/docs/shared";
export function DoubleEntryPanel() {
  const [f, setF] = React.useState({ start_date: monthStartISO(), end_date: todayISO() }); const [a, setA] = React.useState(f);
  const q = useQuery({ queryKey: ["ledger", a], queryFn: () => api<{ rows: Row[]; columns: { key: string; label: string }[] }>(`/api/reports/ledger${qs(a)}`) });
  return <Card><CardHeader title="Partida Dobrada — Razão por conta bancária e categoria" subtitle="Cada baixa gera débito/crédito entre a conta bancária e a categoria/conta contábil do rateio." actions={<div className="flex gap-2"><Input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /><Input type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /><Button size="sm" onClick={() => setA(f)}>Gerar</Button></div>} /><CardBody>{q.isLoading && <Spinner />}{q.error && <ErrorBox error={q.error} />}{q.data && <SimpleTable rows={q.data.rows} cols={q.data.columns.map((c) => ({ key: c.key, label: c.label, align: ["debit", "credit", "balance", "amount", "income", "expense"].includes(c.key) ? "right" as const : undefined, render: (r: Row) => ["debit", "credit", "balance", "amount", "income", "expense"].includes(c.key) ? brl(r[c.key] as string) : String(r[c.key] ?? "") }))} />}</CardBody></Card>;
}
