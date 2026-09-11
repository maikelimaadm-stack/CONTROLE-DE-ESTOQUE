"use client";
import { Suspense } from "react";
import { Workspace, SubTabs } from "@/components/workspace";
import { Dashboard } from "@/features/dashboards/dashboard";
import { ResourceList } from "@/features/resources/resource-list";
import { DietBatchesPanel } from "@/features/feedlot/diet-batches";
import { FeedDeliveriesPanel } from "@/features/feedlot/deliveries";
import { TroughReadingsPanel } from "@/features/feedlot/trough-readings";
import { FeedlotMap } from "@/features/feedlot/map";

/** Confinamento: estrutura (pátio → setor → curral), dietas, produção, trato, cocho, mapa e desempenho (dashboards absorvidos). */
const scroll = (c: React.ReactNode) => <div className="ws-scroll">{c}</div>;
function Inner() {
  return <Workspace title="Confinamento" tabs={[
    { key: "visao-geral", label: "Visão Geral", perm: ["dashboard.feedlot.view", "dashboard.nutrition_stock.view"], content: <SubTabs tabs={[
      { key: "lotacao", label: "Lotação de currais", perm: "dashboard.feedlot.view", content: <Dashboard k="confinamento" title="Lotação de currais" /> },
      { key: "nutricao", label: "Estoque de nutrição", perm: "dashboard.nutrition_stock.view", content: <Dashboard k="estoque-nutricao" title="Estoque de produtos de nutrição" /> }
    ]} /> },
    { key: "estrutura", label: "Estrutura", perm: ["feedlot_yards.view", "feedlot_sectors.view", "feedlot_corrals.view"], content: <SubTabs tabs={[
      { key: "patios", label: "1. Pátios", perm: "feedlot_yards.view", content: <ResourceList resourceKey="feedlot_yards" /> },
      { key: "setores", label: "2. Setores", perm: "feedlot_sectors.view", content: <ResourceList resourceKey="feedlot_sectors" /> },
      { key: "currais", label: "3. Currais", perm: "feedlot_corrals.view", content: <ResourceList resourceKey="feedlot_corrals" /> }
    ]} /> },
    { key: "dietas", label: "Dietas", perm: ["diets.view", "feeding_phases.view"], content: <SubTabs tabs={[
      { key: "dietas", label: "Dietas", perm: "diets.view", content: <ResourceList resourceKey="diets" /> },
      { key: "fases", label: "Fases / regras de troca", perm: "feeding_phases.view", content: <ResourceList resourceKey="feeding_phases" /> }
    ]} /> },
    { key: "producao", label: "Produção (bateladas)", perm: "diet_batches.view", content: scroll(<DietBatchesPanel />) },
    { key: "trato", label: "Trato", perm: "feed_deliveries.view", content: scroll(<FeedDeliveriesPanel />) },
    { key: "cocho", label: "Leitura de Cocho", perm: "trough_readings.view", content: scroll(<TroughReadingsPanel />) },
    { key: "mapa", label: "Mapa", perm: "feedlot_map.view", content: scroll(<FeedlotMap />) },
    { key: "desempenho", label: "Desempenho", perm: ["dashboard.feedlot_performance.view", "dashboard.feedlot_cost.view", "dashboard.feed_consumption.view"], content: <SubTabs tabs={[
      { key: "ganho", label: "Ganho de peso por lote", perm: "dashboard.feedlot_performance.view", content: <Dashboard k="confinamento-desempenho" title="Desempenho de lotes" /> },
      { key: "custos", label: "Custos", perm: "dashboard.feedlot_cost.view", content: <Dashboard k="confinamento-custos" title="Custos do confinamento" /> },
      { key: "consumo", label: "Consumo de ração", perm: "dashboard.feed_consumption.view", content: <Dashboard k="consumo-racao" title="Consumo vs fornecido" /> }
    ]} /> }
  ]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
