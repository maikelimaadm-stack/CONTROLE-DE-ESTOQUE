"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { brl, yearStartISO, todayISO } from "@/lib/utils";
import { Card, CardHeader, CardBody, Stat, Input, Button, Spinner } from "@/components/ui";
import { Bars, Donut } from "@/components/charts";

interface Home { period: { start: string; end: string }; forecast_vs_actual: { month: string; income_forecast: string; expense_forecast: string; income_done: string; expense_done: string }[]; production_cost_by_center: { cost_center: string; expense: string }[]; operational_result: { income: string; expense: string; stock_consumption: string; result: string; result_with_stock: string }; alerts: { overdue_payables: string; overdue_receivables: string; low_stock: string; pending_requests: string; pending_processings: string } }

export default function HomePage() {
  const [start, setStart] = React.useState(yearStartISO()); const [end, setEnd] = React.useState(todayISO());
  const q = useQuery({ queryKey: ["dash-home", start, end], queryFn: () => api<Home>(`/api/dashboards/home${qs({ start_date: start, end_date: end })}`) });
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2"><h1 className="text-lg font-semibold mr-auto">Início</h1><div><label className="text-[11px] text-slate-500">Início</label><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div><div><label className="text-[11px] text-slate-500">Fim</label><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div></div>
      {q.isLoading && <Spinner />}
      {d && <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Receitas realizadas" value={brl(d.operational_result.income)} tone="green" />
          <Stat label="Despesas realizadas" value={brl(d.operational_result.expense)} tone="red" />
          <Stat label="Consumo de estoque" value={brl(d.operational_result.stock_consumption)} tone="amber" />
          <Stat label="Resultado operacional" value={brl(d.operational_result.result)} tone={Number(d.operational_result.result) >= 0 ? "green" : "red"} hint="Receitas − despesas (caixa)" />
          <Stat label="Resultado com estoque" value={brl(d.operational_result.result_with_stock)} tone={Number(d.operational_result.result_with_stock) >= 0 ? "green" : "red"} hint="Inclui consumo de insumos" />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Link href="/financeiro?tab=contas&sub=pagar&status=overdue"><Stat label="Títulos a pagar vencidos" value={d.alerts.overdue_payables} tone={Number(d.alerts.overdue_payables) ? "red" : "slate"} /></Link>
          <Link href="/financeiro?tab=contas&sub=receber&status=overdue"><Stat label="Títulos a receber vencidos" value={d.alerts.overdue_receivables} tone={Number(d.alerts.overdue_receivables) ? "amber" : "slate"} /></Link>
          <Link href="/estoque?tab=saldo&below_min=true"><Stat label="Produtos abaixo do mínimo" value={d.alerts.low_stock} tone={Number(d.alerts.low_stock) ? "amber" : "slate"} /></Link>
          <Link href="/compras?tab=processos&sub=mine"><Stat label="Solicitações em andamento" value={d.alerts.pending_requests} /></Link>
          <Link href="/pecuaria?tab=rebanho&sub=processamentos"><Stat label="Processamentos pendentes" value={d.alerts.pending_processings} /></Link>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Card><CardHeader title="Previsão de receitas x despesas" subtitle="Por mês de vencimento (previsto) e baixas (realizado)" /><CardBody><Bars data={d.forecast_vs_actual} x="month" series={[{ key: "income_forecast", label: "Receita prevista", color: "#8cc797" }, { key: "income_done", label: "Receita realizada", color: "#2b6f3a" }, { key: "expense_forecast", label: "Despesa prevista", color: "#fca5a5" }, { key: "expense_done", label: "Despesa realizada", color: "#dc2626" }]} /></CardBody></Card>
          <Card><CardHeader title="Custo de produção por centro de custo" subtitle="Despesas (títulos) no período" /><CardBody>{d.production_cost_by_center.length ? <Donut data={d.production_cost_by_center} nameKey="cost_center" valueKey="expense" /> : <p className="text-sm text-slate-400">Sem despesas no período.</p>}</CardBody></Card>
        </div>
        <div className="flex gap-2 no-print"><Link href="/relatorios"><Button variant="outline" size="sm">Relatórios</Button></Link><Link href="/financeiro?tab=visao-geral"><Button variant="outline" size="sm">Indicadores financeiros</Button></Link><Link href="/pecuaria?tab=visao-geral"><Button variant="outline" size="sm">Pecuária de corte</Button></Link></div>
      </>}
    </div>
  );
}
