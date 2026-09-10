"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardHeader, CardBody, Spinner } from "@/components/ui";
import { type Row } from "@/features/docs/shared";
export default function Page() {
  const q = useQuery({ queryKey: ["feedlot-map"], queryFn: () => api<{ items: Row[] } | Row[]>("/api/feedlot/map") }); const rows = Array.isArray(q.data) ? q.data : q.data?.items ?? [];
  const groups = new Map<string, Row[]>(); for (const r of rows) { const k = `${r["yard"] ?? "Pátio"} / ${r["sector"] ?? "Setor"}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
  return <Card><CardHeader title="Mapa do Confinamento" subtitle="Ocupação por curral (capacidade × animais), lotes alojados e último escore de cocho" /><CardBody className="space-y-4">{q.isLoading && <Spinner />}
    {[...groups.entries()].map(([g, cs]) => <div key={g}><h3 className="mb-2 text-xs font-semibold uppercase text-brand-700">{g}</h3><div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">{cs.map((c) => { const occ = Number(c["occupancy"] ?? 0); const cap = Number(c["capacity"] ?? 0); const pct = cap ? occ / cap : 0; return <div key={String(c["corral_id"])} className={`rounded border p-2 text-xs ${pct > 1 ? "border-red-400 bg-red-50" : pct > 0.85 ? "border-amber-400 bg-amber-50" : occ > 0 ? "border-green-400 bg-green-50" : "bg-slate-50"}`}><div className="font-semibold">{String(c["code"] ?? "")} {String(c["name"])}</div><div>{occ} / {cap || "—"} cab. {cap ? `(${(pct * 100).toFixed(0)}%)` : ""}</div><div className="truncate text-slate-500" title={String(c["batches"] ?? "")}>{String(c["batches"] ?? "vazio")}</div><div className="text-slate-500">Cocho: {String(c["last_score"] ?? c["score"] ?? "—")}</div></div>; })}</div></div>)}
    {!q.isLoading && rows.length === 0 && <p className="text-sm text-slate-400">Cadastre pátios, setores e currais em Cadastros › Confinamento.</p>}
  </CardBody></Card>;
}
