"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { brl, dateBR } from "@/lib/utils";
import { Card, CardHeader, CardBody, Spinner, Stat } from "@/components/ui";
import { SimpleTable, STATUS_PT, type Row } from "@/features/docs/shared";
export default function Page() {
  const q = useQuery({ queryKey: ["os-mon"], queryFn: () => api<{ by_status: { status: string; n: number; total: string }[]; late: Row[] }>("/api/service-orders-monitoring") });
  if (q.isLoading) return <Spinner />;
  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{q.data?.by_status.map((s) => <Link key={s.status} href={`/os?status=${s.status}`}><Stat label={STATUS_PT[s.status] ?? s.status} value={s.n} hint={brl(s.total)} tone={s.status === "in_progress" ? "amber" : s.status === "finished" ? "green" : "slate"} /></Link>)}</div>
    <Card><CardHeader title="OS atrasadas" subtitle="Abertas ou em execução com término previsto vencido" /><CardBody><SimpleTable rows={q.data?.late ?? []} cols={[{ key: "code", label: "Código", render: (r) => <Link className="text-brand-700 underline" href={`/os/${r["id"]}`}>{String(r["code"])}</Link> }, { key: "description", label: "Descrição" }, { key: "planned_end", label: "Prev. término", render: (r) => dateBR(r["planned_end"] as string) }, { key: "status", label: "Status", render: (r) => STATUS_PT[String(r["status"])] ?? String(r["status"]) }]} /></CardBody></Card>
  </div>;
}
