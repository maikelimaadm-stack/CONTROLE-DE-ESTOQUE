"use client";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Workspace, SubTabs, NewChooser } from "@/components/workspace";
import { Dashboard } from "@/features/dashboards/dashboard";
import { ResourceList } from "@/features/resources/resource-list";
import { MaintenancesList } from "@/features/fleet/maintenances-list";
import { FuelSuppliesList } from "@/features/fleet/fuel-supplies-list";
import { FleetAlertsPanel } from "@/features/fleet/alerts";
import { EquipmentTransfersPanel } from "@/features/fleet/equipment-transfers";
import { DepreciationsPanel } from "@/features/fleet/depreciations";
import { DepreciationForecastPanel } from "@/features/fleet/depreciation-forecast";

/** Frota e Ativos: inventário de bens + gestão de frota (abastecimentos, manutenções, depreciação) em uma área. */
const scroll = (c: React.ReactNode) => <div className="ws-scroll">{c}</div>;
function Inner() {
  const router = useRouter(); const sp = useSearchParams(); const { can } = useAuth(); const eq = sp.get("equipment_id") ?? undefined;
  return <Workspace title="Frota e Ativos" actions={<NewChooser items={[
    { label: "Nova máquina / equipamento", href: "/cadastros/equipments/new", perm: "equipments.create" },
    { label: "Novo abastecimento", href: "/frota/abastecimentos/new", perm: "fuel_supplies.create" },
    { label: "Nova manutenção", href: "/frota/manutencoes/new", perm: "maintenances.create" },
    { label: "Novo plano preventivo", href: "/cadastros/preventive_maintenances/new", perm: "preventive_maintenances.create" },
    { label: "Agendar revisão", href: "/cadastros/scheduled_reviews/new", perm: "scheduled_reviews.create" }
  ]} />} tabs={[
    { key: "visao-geral", label: "Visão Geral", perm: "dashboard.assets.view", content: <Dashboard k="ativos" title="Ativos e custos da frota" /> },
    { key: "maquinas", label: "Máquinas e Equipamentos", perm: ["equipments.view", "equipment_transfers.view"], content: <SubTabs tabs={[
      { key: "inventario", label: "Inventário", perm: "equipments.view", content: <ResourceList resourceKey="equipments" extraRowActions={(r) => can("equipment_transfers.create") ? [{ label: "Transferir para outra fazenda", onClick: () => router.push(`/frota?tab=maquinas&sub=transferencias&equipment_id=${r["id"]}`) }] : []} /> },
      { key: "familias", label: "Famílias de bens", perm: "equipments.view", content: <ResourceList resourceKey="equipment_families" /> },
      { key: "transferencias", label: "Transferências entre fazendas", perm: "equipment_transfers.view", content: scroll(<EquipmentTransfersPanel key={eq} equipmentId={eq} />) }
    ]} /> },
    { key: "abastecimentos", label: "Abastecimentos", perm: "fuel_supplies.view", content: <FuelSuppliesList /> },
    { key: "manutencoes", label: "Manutenções", perm: ["maintenances.view", "preventive_maintenances.view", "scheduled_reviews.view"], content: <SubTabs tabs={[
      { key: "corretivas", label: "Corretivas", perm: "maintenances.view", content: <MaintenancesList /> },
      { key: "preventivas", label: "Preventivas (planos)", perm: "preventive_maintenances.view", content: <ResourceList resourceKey="preventive_maintenances" /> },
      { key: "agenda", label: "Agenda de revisões", perm: "scheduled_reviews.view", content: <ResourceList resourceKey="scheduled_reviews" /> },
      { key: "alertas", label: "Alertas", perm: "preventive_maintenances.view", content: scroll(<FleetAlertsPanel />) }
    ]} /> },
    { key: "depreciacao", label: "Depreciação", perm: ["depreciations.view", "depreciation_forecast.view", "dashboard.depreciation.view"], content: <SubTabs tabs={[
      { key: "mensal", label: "Depreciação mensal", perm: "depreciations.view", content: scroll(<DepreciationsPanel />) },
      { key: "previsao", label: "Previsão", perm: "depreciation_forecast.view", content: scroll(<DepreciationForecastPanel />) },
      { key: "indicadores", label: "Indicadores", perm: "dashboard.depreciation.view", content: <Dashboard k="depreciacoes" title="Indicadores de depreciação" /> }
    ]} /> }
  ]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
