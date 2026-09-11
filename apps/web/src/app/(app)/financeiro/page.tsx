"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Workspace, SubTabs, NewChooser } from "@/components/workspace";
import { Dashboard } from "@/features/dashboards/dashboard";
import { TitleList } from "@/features/financial/titles";
import { BankMovementsList } from "@/features/financial/bank-movements-list";
import { CashFlowPanel } from "@/features/financial/cash-flow";
import { OfxImportsPanel } from "@/features/financial/ofx-imports";
import { OfxReportPanel } from "@/features/financial/ofx-report";
import { BudgetPlanningPanel } from "@/features/financial/budget-planning";
import { ResourceList } from "@/features/resources/resource-list";

/** Financeiro: Contas (a pagar / a receber), Tesouraria, Conciliação e Planejamento em uma única área. */
function Inner() {
  const sp = useSearchParams(); const status = sp.get("status") ?? undefined; const dueSoon = sp.get("due_soon") ?? undefined;
  return <Workspace title="Financeiro" actions={<NewChooser items={[{ label: "Nova despesa (conta a pagar)", href: "/financeiro/contas-a-pagar/new", perm: "payables.create" }, { label: "Nova receita (conta a receber)", href: "/financeiro/contas-a-receber/new", perm: "receivables.create" }, { label: "Novo movimento bancário", href: "/financeiro/movimentos/new", perm: "bank_movements.create" }]} />} tabs={[
    { key: "visao-geral", label: "Visão Geral", perm: "dashboard.financial.view", content: <Dashboard k="financeiro" title="Indicadores financeiros" /> },
    { key: "contas", label: "Contas", perm: ["payables.view", "receivables.view"], content: <SubTabs tabs={[
      { key: "pagar", label: "A Pagar", perm: "payables.view", content: <TitleList key={`p${status}${dueSoon}`} dir="payable" initialStatus={status} /> },
      { key: "receber", label: "A Receber", perm: "receivables.view", content: <TitleList key={`r${status}`} dir="receivable" initialStatus={status} /> }
    ]} /> },
    { key: "tesouraria", label: "Tesouraria", perm: ["bank_movements.view", "cash_flow.view", "bank_accounts.view"], content: <SubTabs tabs={[
      { key: "extrato", label: "Extrato", perm: "bank_movements.view", content: <BankMovementsList /> },
      { key: "fluxo", label: "Fluxo de Caixa", perm: "cash_flow.view", content: <div className="ws-scroll"><CashFlowPanel /></div> },
      { key: "contas", label: "Contas Bancárias", perm: "bank_accounts.view", content: <ResourceList resourceKey="bank_accounts" /> }
    ]} /> },
    { key: "conciliacao", label: "Conciliação Bancária", perm: ["ofx_imports.view", "ofx_report.view"], content: <SubTabs tabs={[
      { key: "importar", label: "Importar OFX", perm: "ofx_imports.view", content: <OfxImportsPanel /> },
      { key: "pendencias", label: "Pendências", perm: "ofx_imports.view", content: <OfxImportsPanel pendingOnly /> },
      { key: "historico", label: "Histórico (meses conciliados)", perm: "ofx_report.view", content: <OfxReportPanel /> }
    ]} /> },
    { key: "planejamento", label: "Planejamento", perm: "budget_plannings.view", content: <div className="ws-scroll"><BudgetPlanningPanel /></div> },
    { key: "contratos", label: "Contratos", perm: "contracts.view", content: <ResourceList resourceKey="contracts" /> }
  ]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
