"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { dateBR } from "@/lib/utils";
import { Badge, Card, CardHeader, CardBody, Spinner } from "@/components/ui";
import { SimpleTable, type Row } from "@/features/docs/shared";
export function FleetAlertsPanel() {
  const q = useQuery({ queryKey: ["fleet-alerts"], queryFn: () => api<{ preventives: Row[]; reviews: Row[] }>("/api/fleet/alerts") });
  if (q.isLoading) return <Spinner />;
  return <div className="space-y-3">
    <Card><CardHeader title="Alertas de Manutenção Preventiva" subtitle="Planos por horímetro/km/dias comparados com o uso atual da máquina" /><CardBody><SimpleTable rows={q.data?.preventives ?? []} cols={[{ key: "equipment_name", label: "Máquina" }, { key: "description", label: "Plano" }, { key: "trigger_type", label: "Gatilho" }, { key: "interval_value", label: "Intervalo", align: "right" }, { key: "last_done_value", label: "Última exec.", align: "right", render: (r) => String(r["last_done_value"] ?? r["last_done_date"] ?? "—") }, { key: "current_value", label: "Atual", align: "right" }, { key: "due", label: "Situação", render: (r) => <Badge tone={r["due"] ? "red" : "green"}>{r["due"] ? "Vencida" : "Em dia"}</Badge> }]} /></CardBody></Card>
    <Card><CardHeader title="Revisões agendadas" /><CardBody><SimpleTable rows={q.data?.reviews ?? []} cols={[{ key: "equipment_name", label: "Máquina" }, { key: "description", label: "Revisão" }, { key: "scheduled_date", label: "Data", render: (r) => dateBR(r["scheduled_date"] as string) }, { key: "status", label: "Status" }]} /></CardBody></Card>
  </div>;
}
