"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardHeader, CardBody, Input, Spinner, Button } from "@/components/ui";
interface R { key: string; label: string; module: string }
export default function Page() {
  const q = useQuery({ queryKey: ["reports"], queryFn: () => api<R[]>("/api/reports") }); const [s, setS] = React.useState("");
  const groups = new Map<string, R[]>(); for (const r of q.data ?? []) if (!s || r.label.toLowerCase().includes(s.toLowerCase())) groups.set(r.module, [...(groups.get(r.module) ?? []), r]);
  return <Card><CardHeader title="Relatórios" subtitle={`${q.data?.length ?? 0} relatórios disponíveis para o seu perfil · exportação CSV/XLSX e impressão`} actions={<><Link href="/relatorios/personalizados"><Button size="sm" variant="outline">Relatórios personalizados</Button></Link><Input placeholder="Buscar relatório…" value={s} onChange={(e) => setS(e.target.value)} className="w-64" /></>} /><CardBody>
    {q.isLoading && <Spinner />}
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{[...groups.entries()].map(([m, rs]) => <div key={m}><h3 className="mb-1 text-xs font-semibold uppercase text-brand-700">{m} ({rs.length})</h3><ul className="space-y-0.5 text-sm">{rs.map((r) => <li key={r.key}><Link className="text-slate-700 hover:text-brand-700 hover:underline" href={`/relatorios/${r.key}`}>{r.label}</Link></li>)}</ul></div>)}</div>
  </CardBody></Card>;
}
