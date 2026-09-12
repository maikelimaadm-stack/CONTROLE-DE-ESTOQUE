"use client";
import * as React from "react";
import { Suspense } from "react";
import { useAuth } from "@/lib/auth";
import { Workspace, ViewSegment, FilterChips, useUrlParam, tab } from "@/components/workspace";
import { Dashboard } from "@/features/dashboards/dashboard";
import { ResourceList } from "@/features/resources/resource-list";
import { DietBatchesPanel } from "@/features/feedlot/diet-batches";
import { FeedDeliveriesPanel } from "@/features/feedlot/deliveries";
import { TroughReadingsPanel } from "@/features/feedlot/trough-readings";
import { CorralsPanel } from "@/features/feedlot/corrals";

/**
 * Confinamento (Compactação V2): Hoje (produção → trato → leitura de cocho) · Currais (árvore pátio/setor/curral;
 * mapa e lotação como modos) · Dietas (dietas / fases) · Desempenho (ganho, custos, consumo e estoque de nutrição num
 * único painel com seletor de seção — cada consulta continua sendo a sua).
 */
const scroll = (c: React.ReactNode) => <div className="ws-scroll">{c}</div>;
const SECTIONS = [{ value: "ganho", label: "Ganho de peso", perm: "dashboard.feedlot_performance.view", k: "confinamento-desempenho", title: "Desempenho de lotes (GMD)" }, { value: "custos", label: "Custos", perm: "dashboard.feedlot_cost.view", k: "confinamento-custos", title: "Custos do confinamento" }, { value: "consumo", label: "Consumo de ração", perm: "dashboard.feed_consumption.view", k: "consumo-racao", title: "Consumo vs fornecido" }, { value: "nutricao", label: "Estoque de nutrição", perm: "dashboard.nutrition_stock.view", k: "estoque-nutricao", title: "Estoque de produtos de nutrição" }];
function Performance() {
  const { can } = useAuth(); const [view, setView] = useUrlParam("view", "");
  const ok = SECTIONS.filter((s) => can(s.perm)); const cur = ok.find((s) => s.value === view) ?? ok[0];
  if (!cur) return null;
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    <div className="mg-card ws-filters no-print"><FilterChips label="Seção" testId="feedlot-performance-view" value={cur.value} onChange={setView} options={ok} /></div>
    <Dashboard key={cur.k} k={cur.k} title={cur.title} />
  </div>;
}
function Inner() {
  return <Workspace title="Confinamento" defaultTab="hoje" tabs={[
    tab("confinamento.hoje", <ViewSegment tabs={[
      tab("confinamento.hoje.producao", scroll(<DietBatchesPanel />)),
      tab("confinamento.hoje.trato", scroll(<FeedDeliveriesPanel />)),
      tab("confinamento.hoje.cocho", scroll(<TroughReadingsPanel />))
    ]} />),
    tab("confinamento.currais", <CorralsPanel />),
    tab("confinamento.dietas", <ViewSegment tabs={[
      { key: "dietas", label: "Dietas", perm: "diets.view", content: <ResourceList resourceKey="diets" /> },
      { key: "fases", label: "Fases / regras de troca", perm: "feeding_phases.view", content: <ResourceList resourceKey="feeding_phases" /> }
    ]} />),
    tab("confinamento.desempenho", <Performance />)
  ]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
