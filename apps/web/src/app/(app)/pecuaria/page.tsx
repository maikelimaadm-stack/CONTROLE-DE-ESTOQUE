"use client";
import * as React from "react";
import { Suspense } from "react";
import { useAuth } from "@/lib/auth";
import { Workspace, ViewSegment, NewChooser, FilterChips, useUrlParam, tab } from "@/components/workspace";
import { Dashboard } from "@/features/dashboards/dashboard";
import { ResourceList } from "@/features/resources/resource-list";
import { AnimalsList } from "@/features/livestock/animals-list";
import { LivestockMovementsList, MOVEMENT_TYPES } from "@/features/livestock/movements-list";
import { HandlingsList } from "@/features/livestock/handlings-list";
import { WeighingsList } from "@/features/livestock/weighings-list";
import { HerdEvolutionPanel } from "@/features/livestock/evolution";
import { HerdActionDialog, HerdTransfersHistory, useHerdAction } from "@/features/livestock/herd-actions";
import { MOV_PT, HANDLING_PT } from "@/features/livestock/shared";

/**
 * Pecuária (Compactação V2): Visão Geral · Rebanho (Animais / Lotes / Reclassificações / Transferências) ·
 * Movimentações (uma lista, tipo como filtro) · Manejos (uma lista, tipo como filtro; pesagem usa fluxo próprio).
 * "Movimentar rebanho" deixou de ser aba: nasce do animal/lote (ações contextuais). Reprodução tem rota própria.
 */
const MOV_PERM: Record<string, string> = { purchase: "animal_purchases", sale: "animal_sales", birth: "animal_births", death: "animal_deaths", loss: "animal_losses" };
const HAND_PERM: Record<string, string> = { sanitary: "sanitaries", nutrition: "nutritions", weaning: "weanings", separation: "separations", pasture: "pastures" };
const scroll = (c: React.ReactNode) => <div className="ws-scroll">{c}</div>;

function Movements() {
  const { can } = useAuth(); const [type, setType] = useUrlParam("type", "");
  const ok = MOVEMENT_TYPES.filter((t) => can(`${MOV_PERM[t]}.view`)); const cur = type && ok.includes(type) ? type : "";
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    <div className="mg-card ws-filters no-print"><FilterChips label="Tipo" testId="mov-type" value={cur || "all"} onChange={(v) => setType(v === "all" ? "" : v)} options={[{ value: "all", label: "Todos" }, ...ok.map((t) => ({ value: t, label: MOV_PT[t]! }))]} /></div>
    <LivestockMovementsList type={cur} />
  </div>;
}
function Handlings() {
  const { can } = useAuth(); const [type, setType] = useUrlParam("type", "");
  const ok = Object.keys(HANDLING_PT).filter((t) => can(`${HAND_PERM[t]}.view`)); const cur = type === "weighing" && can("weighings.view") ? "weighing" : type && ok.includes(type) ? type : "";
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    <div className="mg-card ws-filters no-print"><FilterChips label="Tipo" testId="handling-type" value={cur || "all"} onChange={(v) => setType(v === "all" ? "" : v)} options={[{ value: "all", label: "Todos os manejos" }, { value: "weighing", label: "Pesagem", perm: "weighings.view", hint: "Pesagens usam fluxo próprio (GMD por lote)" }, ...ok.map((t) => ({ value: t, label: HANDLING_PT[t]! }))]} /></div>
    {cur === "weighing" ? <WeighingsList /> : <HandlingsList type={cur} />}
  </div>;
}
function Batches() {
  const { can } = useAuth(); const herd = useHerdAction();
  return <><ResourceList resourceKey="batches" extraRowActions={(r) => [
    ...(can("batch_module_area_transfer.create") ? [{ label: "Mover de local (módulo / área / curral)", onClick: () => herd.open("lote-local", { batchId: String(r["id"]) }) }] : []),
    ...(can("batch_farm_transfer.create") ? [{ label: "Transferir de fazenda", onClick: () => herd.open("fazendas", { batchId: String(r["id"]) }) }] : []),
    ...(can("batch_grouping.create") ? [{ label: "Agrupar com outros lotes", onClick: () => herd.open("agrupar", { batchIds: [String(r["id"])] }) }] : [])
  ]} />
  <HerdActionDialog action={herd.action} ctx={herd.ctx} onClose={herd.close} /></>;
}
function Transfers() { const herd = useHerdAction(); return <><HerdTransfersHistory /><HerdActionDialog action={herd.action} ctx={herd.ctx} onClose={herd.close} /></>; }
function Inner() {
  return <Workspace title="Pecuária" defaultTab="rebanho" actions={<NewChooser items={[
    { label: "Cadastrar animal", href: "/pecuaria/animais/new", perm: "animals.create" },
    { label: "Movimentação", children: MOVEMENT_TYPES.map((m) => ({ label: MOV_PT[m]!, href: `/pecuaria/movimentacoes/${m}/new`, perm: `${MOV_PERM[m]}.create` })) },
    { label: "Manejo", children: [{ label: "Pesagem", href: "/pecuaria/pesagens/new", perm: "weighings.create" }, ...Object.keys(HANDLING_PT).map((h) => ({ label: HANDLING_PT[h]!, href: `/pecuaria/manejo/${h}/new`, perm: `${HAND_PERM[h]}.create` }))] }
  ]} />} tabs={[
    tab("pecuaria.visao-geral", <Dashboard k="pecuaria" title="Indicadores da pecuária de corte" />),
    tab("pecuaria.rebanho", <ViewSegment tabs={[
      tab("pecuaria.rebanho.animais", scroll(<AnimalsList />)),
      tab("pecuaria.rebanho.lotes", <Batches />),
      tab("pecuaria.rebanho.reclassificacoes", scroll(<HerdEvolutionPanel />)),
      tab("pecuaria.rebanho.transferencias", <Transfers />)
    ]} />),
    tab("pecuaria.movimentacoes", <Movements />),
    tab("pecuaria.manejos", <Handlings />)
  ]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
