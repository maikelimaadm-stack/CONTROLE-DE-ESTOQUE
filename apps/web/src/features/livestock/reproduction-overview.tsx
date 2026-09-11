"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { dateBR } from "@/lib/utils";
import { Badge, Card, CardHeader, CardBody, Spinner } from "@/components/ui";
import { SimpleTable, type Row } from "@/features/docs/shared";
export function ReproductionOverview() {
  const q = useQuery({ queryKey: ["repro"], queryFn: () => api<{ items: Row[] } | Row[]>("/api/livestock/reproduction/overview") }); const rows = Array.isArray(q.data) ? q.data : q.data?.items ?? [];
  return <Card><CardHeader title="Reprodução — Estações de Monta" subtitle="Coberturas, diagnósticos e taxa de prenhez por estação" /><CardBody>{q.isLoading ? <Spinner /> : <SimpleTable rows={rows} cols={[{ key: "name", label: "Estação" }, { key: "start_date", label: "Início", render: (r) => dateBR(r["start_date"] as string) }, { key: "end_date", label: "Fim", render: (r) => dateBR(r["end_date"] as string) }, { key: "status", label: "Status", render: (r) => <Badge tone={r["status"] === "open" ? "green" : "slate"}>{String(r["status"])}</Badge> }, { key: "matings", label: "Coberturas", align: "right" }, { key: "pregnant", label: "Prenhas", align: "right" }, { key: "empty", label: "Vazias", align: "right" }, { key: "pending", label: "Pendentes", align: "right" }, { key: "rate", label: "Taxa prenhez", align: "right", render: (r) => Number(r["matings"]) ? `${(Number(r["pregnant"]) / Number(r["matings"]) * 100).toFixed(1)}%` : "—" }]} />}</CardBody></Card>;
}
