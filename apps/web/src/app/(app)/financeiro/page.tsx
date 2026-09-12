"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Workspace, ViewSegment, NewChooser, FilterChips, useUrlParam, tab } from "@/components/workspace";
import { Dashboard } from "@/features/dashboards/dashboard";
import { TitleList } from "@/features/financial/titles";
import { BankMovementsList } from "@/features/financial/bank-movements-list";
import { CashFlowPanel } from "@/features/financial/cash-flow";
import { OfxImportsPanel } from "@/features/financial/ofx-imports";
import { OfxReportPanel } from "@/features/financial/ofx-report";
import { BudgetPlanningPanel } from "@/features/financial/budget-planning";
import { ResourceList } from "@/features/resources/resource-list";

/**
 * Financeiro (Compactação V2): Visão Geral · Contas (A Pagar / A Receber / Compromissos) · Caixa e Bancos (extrato,
 * fluxo, conciliação, meses conciliados, contas bancárias) · Planejamento. O planejamento orçamentário existe só
 * aqui (em Configurações ficam apenas parâmetros/regras).
 */
function Reconciliation() {
  const [pending, setPending] = useUrlParam("pending", "");
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    <div className="mg-card ws-filters no-print"><FilterChips label="Mostrar" testId="ofx-scope" value={pending === "1" ? "pending" : "all"} onChange={(v) => setPending(v === "pending" ? "1" : "")} options={[{ value: "all", label: "Importações" }, { value: "pending", label: "Somente pendências" }]} /></div>
    <OfxImportsPanel key={pending} pendingOnly={pending === "1"} />
  </div>;
}
function Inner() {
  const sp = useSearchParams(); const status = sp.get("status") ?? undefined; const dueSoon = sp.get("due_soon") ?? undefined;
  return <Workspace title="Financeiro" defaultTab="contas" actions={<NewChooser items={[{ label: "Nova despesa (conta a pagar)", href: "/financeiro/contas-a-pagar/new", perm: "payables.create" }, { label: "Nova receita (conta a receber)", href: "/financeiro/contas-a-receber/new", perm: "receivables.create" }, { label: "Novo movimento bancário", href: "/financeiro/movimentos/new", perm: "bank_movements.create" }]} />} tabs={[
    tab("financeiro.visao-geral", <Dashboard k="financeiro" title="Indicadores financeiros" />),
    tab("financeiro.contas", <ViewSegment tabs={[
      tab("financeiro.contas.pagar", <TitleList key={`p${status}${dueSoon}`} dir="payable" initialStatus={status} />),
      tab("financeiro.contas.receber", <TitleList key={`r${status}`} dir="receivable" initialStatus={status} />),
      tab("financeiro.contas.contratos", <ResourceList resourceKey="contracts" />)
    ]} />),
    tab("financeiro.caixa", <ViewSegment tabs={[
      tab("financeiro.caixa.extrato", <BankMovementsList />),
      tab("financeiro.caixa.fluxo", <div className="ws-scroll"><CashFlowPanel /></div>),
      tab("financeiro.caixa.conciliacao", <Reconciliation />),
      tab("financeiro.caixa.historico", <OfxReportPanel />),
      tab("financeiro.caixa.bancos", <ResourceList resourceKey="bank_accounts" />)
    ]} />),
    tab("financeiro.planejamento", <div className="ws-scroll"><BudgetPlanningPanel /></div>)
  ]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
