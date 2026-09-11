"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardHeader, CardBody, Spinner } from "@/components/ui";
import { SimpleTable, type Row } from "@/features/docs/shared";
export function OfxReportPanel() {
  const q = useQuery({ queryKey: ["ofx-report"], queryFn: () => api<{ items: Row[] } | Row[]>("/api/financial/ofx-report") });
  const rows = Array.isArray(q.data) ? q.data : q.data?.items ?? [];
  return <Card><CardHeader title="Relatório de Conciliação OFX" subtitle="Transações importadas por conta e mês, com o status de conciliação" /><CardBody>{q.isLoading ? <Spinner /> : <SimpleTable rows={rows} cols={[{ key: "account_code", label: "Conta" }, { key: "account_name", label: "Descrição" }, { key: "month", label: "Mês" }, { key: "transactions", label: "Transações", align: "right" }, { key: "matched", label: "Conciliadas", align: "right" }, { key: "pending", label: "Pendentes", align: "right" }, { key: "ignored", label: "Ignoradas", align: "right" }]} />}</CardBody></Card>;
}
