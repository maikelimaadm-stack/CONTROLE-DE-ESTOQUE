"use client";
import * as React from "react";
import { Suspense } from "react";
import { useAuth } from "@/lib/auth";
import { Dialog } from "@/components/ui";
import { Workspace, ViewSegment, NewChooser, FilterChips, useUrlParam, tab } from "@/components/workspace";
import { Dashboard } from "@/features/dashboards/dashboard";
import { ResourceList } from "@/features/resources/resource-list";
import { MaintenancesList } from "@/features/fleet/maintenances-list";
import { FuelSuppliesList } from "@/features/fleet/fuel-supplies-list";
import { FleetAlertsPanel } from "@/features/fleet/alerts";
import { EquipmentTransfersPanel } from "@/features/fleet/equipment-transfers";
import { DepreciationsPanel } from "@/features/fleet/depreciations";
import { DepreciationForecastPanel } from "@/features/fleet/depreciation-forecast";

/**
 * Frota e Ativos (Compactação V2): Visão Geral · Equipamentos (inventário; transferir de fazenda é ação do
 * equipamento; histórico de transferências e depreciação/patrimônio como visões) · Abastecimentos · Manutenções
 * (corretivas, planos preventivos, agenda e alertas numa área). Famílias de bens só em Configurações › Frota.
 */
const scroll = (c: React.ReactNode) => <div className="ws-scroll">{c}</div>;
function Inventory() {
  const { can } = useAuth(); const [eq, setEq] = useUrlParam("equipment_id", ""); const [action, setAction] = useUrlParam("action", "");
  return <><ResourceList resourceKey="equipments" extraRowActions={(r) => can("equipment_transfers.create") ? [{ label: "Transferir para outra fazenda", onClick: () => { setEq(String(r["id"])); setAction("transferir"); } }] : []} />
    <Dialog open={action === "transferir"} onOpenChange={(o) => { if (!o) { setAction(""); setEq(""); } }} title="Transferir máquina entre fazendas" size="xl"><EquipmentTransfersPanel key={eq} equipmentId={eq || undefined} /></Dialog></>;
}
function Depreciation() {
  const { can } = useAuth(); const [view, setView] = useUrlParam("view", "mensal");
  const opts = [{ value: "mensal", label: "Depreciação mensal", perm: "depreciations.view" }, { value: "previsao", label: "Previsão", perm: "depreciation_forecast.view" }, { value: "indicadores", label: "Indicadores", perm: "dashboard.depreciation.view" }];
  const cur = opts.find((o) => o.value === view && can(o.perm)) ?? opts.find((o) => can(o.perm));
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    <div className="mg-card ws-filters no-print"><FilterChips label="Patrimônio" testId="depreciation-view" value={cur?.value ?? ""} onChange={setView} options={opts} /></div>
    {cur?.value === "mensal" && scroll(<DepreciationsPanel />)}{cur?.value === "previsao" && scroll(<DepreciationForecastPanel />)}{cur?.value === "indicadores" && <Dashboard k="depreciacoes" title="Indicadores de depreciação" />}
  </div>;
}
function Inner() {
  return <Workspace title="Frota e Ativos" defaultTab="equipamentos" actions={<NewChooser items={[
    { label: "Novo equipamento", href: "/cadastros/equipments/new", perm: "equipments.create" },
    { label: "Novo abastecimento", href: "/frota/abastecimentos/new", perm: "fuel_supplies.create" },
    { label: "Manutenção", children: [{ label: "Nova manutenção (corretiva)", href: "/frota/manutencoes/new", perm: "maintenances.create" }, { label: "Novo plano preventivo", href: "/cadastros/preventive_maintenances/new", perm: "preventive_maintenances.create" }, { label: "Agendar revisão", href: "/cadastros/scheduled_reviews/new", perm: "scheduled_reviews.create" }] }
  ]} />} tabs={[
    tab("frota.visao-geral", <Dashboard k="ativos" title="Bens e custos da frota" />),
    tab("frota.equipamentos", <ViewSegment tabs={[
      tab("frota.equipamentos.inventario", <Inventory />),
      tab("frota.equipamentos.transferencias", scroll(<EquipmentTransfersPanel />)),
      tab("frota.equipamentos.depreciacao", <Depreciation />)
    ]} />),
    tab("frota.abastecimentos", <FuelSuppliesList />),
    tab("frota.manutencoes", <ViewSegment tabs={[
      { key: "corretivas", label: "Corretivas", perm: "maintenances.view", content: <MaintenancesList /> },
      { key: "preventivas", label: "Planos preventivos", perm: "preventive_maintenances.view", content: <ResourceList resourceKey="preventive_maintenances" /> },
      { key: "agenda", label: "Agenda de revisões", perm: "scheduled_reviews.view", content: <ResourceList resourceKey="scheduled_reviews" /> },
      { key: "alertas", label: "Alertas", perm: "preventive_maintenances.view", content: scroll(<FleetAlertsPanel />) }
    ]} />)
  ]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
