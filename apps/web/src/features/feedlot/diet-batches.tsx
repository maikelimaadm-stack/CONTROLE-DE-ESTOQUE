"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { custoPorUnidade } from "@agro/domain";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, num, dateBR } from "@/lib/utils";
import { Card, CardHeader, CardBody, Spinner, buttonVariants } from "@/components/ui";
import { SimpleTable, type Row } from "@/features/docs/shared";

/**
 * Confinamento › Hoje › Produção: as bateladas produzidas. OPERACOES-01 F10 (decisão 287): o lançamento saiu do
 * formulário embutido para a Central da batelada (`/confinamento/bateladas/new`, botão "Nova batelada", com a
 * permissão de lançar). O R$/kg é o do servidor — o custo total gravado ÷ os quilos, em decimal (`custoPorUnidade`).
 */
export function DietBatchesPanel() {
  const { can } = useAuth(); const q = useQuery({ queryKey: ["diet-batches"], queryFn: () => api<{ items: Row[] }>("/api/feedlot/diet-batches") });
  const custoPorKg = (r: Row) => brl(custoPorUnidade(String(r["total_cost"] ?? ""), String(r["quantity_kg"] ?? "")));
  return <div className="space-y-3">
    <Card><CardHeader title="Bateladas produzidas" subtitle="Cada batelada consome os ingredientes da dieta (percentuais) do local de estoque, calcula o custo/kg e atualiza a dieta."
      actions={can("diet_batches.create") ? <Link href="/confinamento/bateladas/new" className={buttonVariants({ size: "sm" })} data-testid="confinamento-nova-batelada"><Plus className="h-3.5 w-3.5" aria-hidden /> Nova batelada</Link> : undefined} />
      <CardBody>{q.isLoading ? <Spinner /> : <SimpleTable rows={q.data?.items ?? []} cols={[{ key: "code", label: "Código" }, { key: "batch_date", label: "Data", render: (r) => dateBR(r["batch_date"] as string) }, { key: "diet_name", label: "Dieta" }, { key: "quantity_kg", label: "kg", align: "right", render: (r) => num(r["quantity_kg"] as string, 2) }, { key: "total_cost", label: "Custo", align: "right", render: (r) => brl(r["total_cost"] as string) }, { key: "cost_kg", label: "R$/kg", align: "right", render: custoPorKg }]} />}</CardBody></Card>
  </div>;
}
