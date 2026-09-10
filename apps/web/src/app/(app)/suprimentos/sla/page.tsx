"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, CardHeader, CardBody, Input, Spinner } from "@/components/ui";
import { useAction } from "@/features/docs/actions";
export default function Page() {
  const { can } = useAuth(); const q = useQuery({ queryKey: ["sla"], queryFn: () => api<{ items: { status: string; label: string; max_hours: number }[] }>("/api/supply/sla") });
  const [v, setV] = React.useState<Record<string, number>>({}); React.useEffect(() => { if (q.data) setV(Object.fromEntries(q.data.items.map((i) => [i.status, i.max_hours]))); }, [q.data]);
  const act = useAction();
  return <Card><CardHeader title="SLA de Suprimentos" subtitle="Tempo máximo (horas) em cada status. Solicitações acima do limite ficam sinalizadas nas listagens e no relatório de SLA." actions={can("supply_sla.edit") && <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ path: "/api/supply/sla", method: "PUT", body: Object.entries(v).map(([status, max_hours]) => ({ status, max_hours: Number(max_hours) })) })}>Salvar</Button>} /><CardBody>
    {q.isLoading ? <Spinner /> : <table className="table-dense w-full max-w-lg text-sm"><thead><tr><th>Status</th><th className="w-40">Horas máximas</th></tr></thead><tbody>{q.data?.items.map((i) => <tr key={i.status}><td>{i.label}</td><td><Input type="number" min={0} value={v[i.status] ?? 0} onChange={(e) => setV({ ...v, [i.status]: Number(e.target.value) })} disabled={!can("supply_sla.edit")} /></td></tr>)}</tbody></table>}
  </CardBody></Card>;
}
