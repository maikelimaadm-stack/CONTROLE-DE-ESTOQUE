"use client";
import { Suspense } from "react";
import { Workspace, SubTabs, NewChooser } from "@/components/workspace";
import { Dashboard } from "@/features/dashboards/dashboard";
import { ResourceList } from "@/features/resources/resource-list";
import { AnimalsList } from "@/features/livestock/animals-list";
import { LocateAnimalPanel } from "@/features/livestock/locate";
import { ProcessingsPanel } from "@/features/livestock/processings";
import { LivestockMovementsList } from "@/features/livestock/movements-list";
import { HandlingsList } from "@/features/livestock/handlings-list";
import { WeighingsList } from "@/features/livestock/weighings-list";
import { TransferAnimalsToBatch } from "@/features/livestock/transfer-animals-batch";
import { GroupBatches } from "@/features/livestock/transfer-group-batches";
import { TransferBatchLocation } from "@/features/livestock/transfer-batch-location";
import { TransferToFarm } from "@/features/livestock/transfer-farm";
import { HerdEvolutionPanel } from "@/features/livestock/evolution";
import { MOV_PT, HANDLING_PT } from "@/features/livestock/shared";

/** Pecuária: Rebanho, Movimentações (compra/venda/nascimento/morte/perda), Manejos e Movimentar Rebanho em uma área. */
const MOV: { key: string; perm: string }[] = [{ key: "purchase", perm: "animal_purchases" }, { key: "sale", perm: "animal_sales" }, { key: "birth", perm: "animal_births" }, { key: "death", perm: "animal_deaths" }, { key: "loss", perm: "animal_losses" }];
const HAND: { key: string; perm: string }[] = [{ key: "sanitary", perm: "sanitaries" }, { key: "nutrition", perm: "nutritions" }, { key: "weaning", perm: "weanings" }, { key: "separation", perm: "separations" }, { key: "pasture", perm: "pastures" }];
const scroll = (c: React.ReactNode) => <div className="ws-scroll">{c}</div>;
function Inner() {
  return <Workspace title="Pecuária" actions={<NewChooser items={[
    { label: "Cadastrar animal", href: "/pecuaria/animais/new", perm: "animals.create" },
    ...MOV.map((m) => ({ label: `Nova movimentação: ${MOV_PT[m.key]}`, href: `/pecuaria/movimentacoes/${m.key}/new`, perm: `${m.perm}.create` })),
    { label: "Nova pesagem", href: "/pecuaria/pesagens/new", perm: "weighings.create" },
    ...HAND.map((h) => ({ label: `Novo manejo: ${HANDLING_PT[h.key]}`, href: `/pecuaria/manejo/${h.key}/new`, perm: `${h.perm}.create` }))
  ]} />} tabs={[
    { key: "visao-geral", label: "Visão Geral", perm: "dashboard.livestock.view", content: <Dashboard k="pecuaria" title="Indicadores da pecuária de corte" /> },
    { key: "rebanho", label: "Rebanho", perm: ["animals.view", "animals_management.view", "processings.view", "locate_animals.view", "batches.view"], content: <SubTabs tabs={[
      { key: "animais", label: "Animais", perm: ["animals.view", "animals_management.view"], content: scroll(<AnimalsList />) },
      { key: "buscar", label: "Buscar animal (localização)", perm: "locate_animals.view", content: scroll(<LocateAnimalPanel />) },
      { key: "processamentos", label: "Pendentes de processamento", perm: "processings.view", hint: "Animais comprados por contagem aguardando identificação individual", content: scroll(<ProcessingsPanel />) },
      { key: "lotes", label: "Lotes", perm: "batches.view", content: <ResourceList resourceKey="batches" /> }
    ]} /> },
    { key: "movimentacoes", label: "Movimentações", perm: MOV.map((m) => `${m.perm}.view`), content: <SubTabs tabs={MOV.map((m) => ({ key: m.key, label: MOV_PT[m.key]!, perm: `${m.perm}.view`, content: <LivestockMovementsList type={m.key} /> }))} /> },
    { key: "manejos", label: "Manejos", perm: ["weighings.view", ...HAND.map((h) => `${h.perm}.view`), "herd_evolution.view"], content: <SubTabs tabs={[
      { key: "weighing", label: "Pesagens", perm: "weighings.view", content: <WeighingsList /> },
      ...HAND.map((h) => ({ key: h.key, label: HANDLING_PT[h.key]!, perm: `${h.perm}.view`, content: <HandlingsList type={h.key} /> })),
      { key: "evolution", label: "Evolução de categoria", perm: "herd_evolution.view", hint: "Reclassificação automática por idade", content: scroll(<HerdEvolutionPanel />) }
    ]} /> },
    { key: "movimentar", label: "Movimentar Rebanho", perm: ["animal_batch_transfer.view", "batch_grouping.view", "batch_module_area_transfer.view", "batch_farm_transfer.view"], content: <SubTabs tabs={[
      { key: "animais-lote", label: "Animais entre lotes", perm: "animal_batch_transfer.view", content: scroll(<TransferAnimalsToBatch />) },
      { key: "lote-local", label: "Lote → módulo / área / curral", perm: "batch_module_area_transfer.view", content: scroll(<TransferBatchLocation />) },
      { key: "fazendas", label: "Entre fazendas", perm: "batch_farm_transfer.view", content: scroll(<TransferToFarm />) },
      { key: "agrupar", label: "Agrupar lotes", perm: "batch_grouping.view", content: scroll(<GroupBatches />) }
    ]} /> }
  ]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
