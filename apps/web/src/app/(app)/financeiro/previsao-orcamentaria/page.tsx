"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Spinner } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { useAction } from "@/features/docs/actions";
interface Cat { id: string; code: string; name: string; nature: string; kind: string; previous_year: string; months: Record<string, string> }
const M = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export default function Page() {
  const { can } = useAuth(); const [pid, setPid] = React.useState("");
  const q = useQuery({ queryKey: ["budget", pid], queryFn: () => api<{ year: number; categories: Cat[] }>(`/api/financial/budget-plannings/${pid}/values`), enabled: Boolean(pid) });
  const [vals, setVals] = React.useState<Record<string, Record<string, string>>>({});
  React.useEffect(() => { if (q.data) setVals(Object.fromEntries(q.data.categories.map((c) => [c.id, { ...c.months }]))); }, [q.data]);
  const act = useAction();
  const save = () => act.mutate({ path: `/api/financial/budget-plannings/${pid}/values`, method: "PUT", body: Object.entries(vals).flatMap(([cid, m]) => Object.entries(m).map(([month, amount]) => ({ financial_category_id: cid, month: Number(month), amount: amount || "0" }))) });
  const total = (c: Cat) => Object.values(vals[c.id] ?? {}).reduce((a, v) => a + Number(v || 0), 0);
  return <Card><CardHeader title="Previsão Orçamentária" subtitle="Valores previstos por categoria financeira × mês. Cadastre o planejamento em Cadastros › Previsão Orçamentária." actions={pid && can("budget_plannings.edit") && <Button size="sm" loading={act.isPending} onClick={save}>Salvar</Button>} /><CardBody className="space-y-3">
    <Field label="Planejamento" span={4}><RefSelect resource="budget_plannings" value={pid} onChange={(v) => setPid(v ?? "")} /></Field>
    {q.isLoading && <Spinner />}
    {q.data && <div className="overflow-x-auto rounded border"><table className="table-dense w-full text-[11.5px]"><thead><tr><th className="min-w-[220px]">Categoria ({q.data.year})</th><th className="text-right">Ano anterior</th>{M.map((m) => <th key={m} className="w-24 text-right">{m}</th>)}<th className="text-right">Total</th></tr></thead><tbody>
      {q.data.categories.map((c) => <tr key={c.id} className={c.kind !== "analytic" ? "bg-slate-50 font-semibold" : ""}><td>{c.code} {c.name}</td><td className="num">{brl(c.previous_year)}</td>{M.map((_, i) => <td key={i}>{c.kind === "analytic" ? <input className="w-full rounded border px-1 text-right" value={vals[c.id]?.[String(i + 1)] ?? ""} disabled={!can("budget_plannings.edit")} onChange={(e) => setVals({ ...vals, [c.id]: { ...(vals[c.id] ?? {}), [String(i + 1)]: e.target.value } })} /> : null}</td>)}<td className="num">{brl(total(c))}</td></tr>)}
    </tbody></table></div>}
  </CardBody></Card>;
}
