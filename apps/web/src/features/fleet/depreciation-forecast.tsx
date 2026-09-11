"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { brl, monthStartISO } from "@/lib/utils";
import { Card, CardHeader, CardBody, Field, Input, Spinner } from "@/components/ui";
interface Fc { equipment_id: string; code: string; description: string; monthly: string; depreciable: string; depreciated: string; forecast: { month: string; amount: string; accumulated: string }[] }
export function DepreciationForecastPanel() {
  const [from, setFrom] = React.useState(monthStartISO()); const [months, setMonths] = React.useState(12);
  const q = useQuery({ queryKey: ["depr-fc", from, months], queryFn: () => api<{ items: Fc[] }>(`/api/assets/depreciation-forecast${qs({ from, months })}`) });
  const cols = q.data?.items[0]?.forecast.map((f) => f.month) ?? [];
  return <Card><CardHeader title="Previsão de Depreciação" subtitle="Projeção mensal por equipamento a partir do mês informado" /><CardBody>
    <div className="mb-3 grid grid-cols-12 gap-2"><Field label="A partir de" span={3}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="Meses" span={2}><Input type="number" min={1} max={120} value={months} onChange={(e) => setMonths(Number(e.target.value))} /></Field></div>
    {q.isLoading ? <Spinner /> : <div className="overflow-x-auto rounded border"><table className="table-dense w-full text-[11.5px]"><thead><tr><th>Equipamento</th><th className="text-right">Depreciável</th><th className="text-right">Depreciado</th><th className="text-right">Mensal</th>{cols.map((c) => <th key={c} className="text-right">{c.slice(0, 7)}</th>)}</tr></thead><tbody>{q.data?.items.map((e) => <tr key={e.equipment_id}><td>{e.code} {e.description}</td><td className="num">{brl(e.depreciable)}</td><td className="num">{brl(e.depreciated)}</td><td className="num">{brl(e.monthly)}</td>{e.forecast.map((f) => <td key={f.month} className="num">{brl(f.amount)}</td>)}</tr>)}</tbody></table></div>}
  </CardBody></Card>;
}
