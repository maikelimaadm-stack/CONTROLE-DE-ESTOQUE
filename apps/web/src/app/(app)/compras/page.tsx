"use client";
import { Suspense } from "react";
import { Workspace, SubTabs, NewChooser } from "@/components/workspace";
import { Dashboard } from "@/features/dashboards/dashboard";
import { SupplyRequestsList, STAGES } from "@/features/supply/requests-list";

/** Compras: um único lugar para acompanhar o processo do início ao fim (etapas viram sub-abas da mesma lista). */
const STAGE_PERM: Record<string, string> = { all: "purchase_requests.view", mine: "purchase_requests.view", request: "purchase_requests.view", quotation: "purchase_quotations.view", authorization: "purchase_authorization.view", buy: "purchase_buy.view", receipts: "purchase_receipts.view", finished: "purchase_receipts.view", rejected: "rejected_requests.view" };
const ORDER = ["all", "mine", "request", "quotation", "authorization", "buy", "receipts", "finished", "rejected"];
function Inner() {
  return <Workspace title="Compras" actions={<NewChooser items={[{ label: "Nova solicitação de compra", href: "/suprimentos/new", perm: "purchase_requests.create" }]} />} tabs={[
    { key: "visao-geral", label: "Visão Geral", perm: "dashboard.supply.view", content: <Dashboard k="suprimentos" title="Indicadores de compras" /> },
    { key: "processos", label: "Processos de Compra", perm: ORDER.map((s) => STAGE_PERM[s]!), content: <SubTabs tabs={ORDER.map((s) => ({ key: s, label: STAGES[s]!.title, hint: STAGES[s]!.hint, perm: STAGE_PERM[s], content: <SupplyRequestsList stage={s} /> }))} /> }
  ]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
