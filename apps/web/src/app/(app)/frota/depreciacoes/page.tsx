"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, monthStartISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { DataTable } from "@/components/ui/data-table";
import { useAction } from "@/features/docs/actions";
import { type Row } from "@/features/docs/shared";
export default function Page() {
  const { can } = useAuth(); const [month, setMonth] = React.useState(monthStartISO()); const [eq, setEq] = React.useState(""); const [page, setPage] = React.useState(1);
  const q = useQuery({ queryKey: ["depr", month, eq, page], queryFn: () => api<{ items: Row[]; total: number }>(`/api/assets/depreciations${qs({ period_month: month, equipment_id: eq, page, pageSize: 50 })}`) });
  const act = useAction();
  return <Card><CardHeader title="Depreciações de Ativos" subtitle="Cálculo mensal linear (com ou sem valor residual) por equipamento; idempotente por mês/equipamento." actions={can("depreciations.create") && <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ path: "/api/assets/depreciations/run", idem: true, body: { period_month: month } })}>Calcular mês</Button>} /><CardBody>
    <div className="mb-3 grid grid-cols-12 gap-2"><Field label="Mês de referência" span={3}><Input type="date" value={month} onChange={(e) => setMonth(e.target.value)} /></Field><Field label="Equipamento" span={4}><RefSelect resource="equipments" value={eq} onChange={(v) => setEq(v ?? "")} /></Field></div>
    <DataTable rows={q.data?.items ?? []} total={q.data?.total} page={page} pageSize={50} onPage={setPage} loading={q.isLoading} columns={[{ key: "period_month", label: "Mês", render: (r) => String(r["period_month"]).slice(0, 7) }, { key: "equipment_code", label: "Cód." }, { key: "equipment_name", label: "Equipamento" }, { key: "farm_name", label: "Fazenda" }, { key: "acquisition_value", label: "Vl. aquisição", align: "right", render: (r) => brl(r["acquisition_value"] as string) }, { key: "amount", label: "Depreciação", align: "right", render: (r) => brl(r["amount"] as string) }, { key: "accumulated", label: "Acumulada", align: "right", render: (r) => brl(r["accumulated"] as string) }]} />
  </CardBody></Card>;
}
