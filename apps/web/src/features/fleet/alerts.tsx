"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { dateBR, num } from "@/lib/utils";
import { Badge, Card, CardHeader, CardBody, Spinner } from "@/components/ui";
import { SimpleTable, type Row } from "@/features/docs/shared";
import { COPY, enumLabel, statusLabel } from "@/lib/copy";
export function FleetAlertsPanel() {
  const q = useQuery({ queryKey: ["fleet-alerts"], queryFn: () => api<{ preventives: Row[]; reviews: Row[] }>("/api/fleet/alerts") });
  if (q.isLoading) return <Spinner />;
  return <div className="space-y-3">
    <Card><CardHeader title="Alertas de Manutenção Preventiva" subtitle="Planos por horímetro/km/dias comparados com o uso atual do equipamento" /><CardBody><SimpleTable rows={q.data?.preventives ?? []} cols={[{ key: "equipment_name", label: "Equipamento" }, { key: "description", label: "Plano" }, { key: "trigger_type", label: "Gatilho", render: (r) => enumLabel("trigger_type", r["trigger_type"]) }, { key: "interval_value", label: "Intervalo", align: "right" }, { key: "last_done_value", label: "Última execução", align: "right", render: (r) => r["last_done_value"] != null ? num(r["last_done_value"] as string, 1) : r["last_done_date"] ? dateBR(r["last_done_date"] as string) : "—" }, { key: "current_value", label: "Atual", align: "right" }, { key: "due", label: "Situação", render: (r) => <Badge tone={r["due"] ? "red" : "green"}>{r["due"] ? "Vencida" : "Em dia"}</Badge> }]} /></CardBody></Card>
    <Card><CardHeader title="Revisões agendadas" /><CardBody><SimpleTable rows={q.data?.reviews ?? []} cols={[{ key: "equipment_name", label: "Equipamento" }, { key: "description", label: "Revisão" }, { key: "scheduled_date", label: "Data", render: (r) => dateBR(r["scheduled_date"] as string) }, { key: "status", label: COPY.situacao, render: (r) => statusLabel(r["status"]) }]} /></CardBody></Card>
  </div>;
}
