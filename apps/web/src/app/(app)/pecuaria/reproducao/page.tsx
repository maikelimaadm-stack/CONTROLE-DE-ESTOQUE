"use client";
import { Suspense } from "react";
import { Workspace } from "@/components/workspace";
import { ResourceList } from "@/features/resources/resource-list";
import { ReproductionOverview } from "@/features/livestock/reproduction-overview";
import { MatingsPanel } from "@/features/livestock/matings";

/** Reprodução: estações, reprodutores, protocolos e acasalamentos/diagnósticos numa única área (antes: 5 cadastros soltos). */
function Inner() {
  return <Workspace title="Reprodução" tabs={[
    { key: "visao-geral", label: "Visão Geral", perm: "advanced_reproductive.view", content: <div className="ws-scroll"><ReproductionOverview /></div> },
    { key: "estacoes", label: "Estações de Monta", perm: "breeding_seasons.view", content: <ResourceList resourceKey="breeding_seasons" /> },
    { key: "reprodutores", label: "Reprodutores (touros / sêmen / embrião)", perm: "breeding_sires.view", content: <ResourceList resourceKey="breeding_sires" /> },
    { key: "protocolos", label: "Protocolos", perm: "breeding_protocols.view", content: <ResourceList resourceKey="breeding_protocols" /> },
    { key: "acasalamentos", label: "Acasalamentos e Diagnósticos", perm: "matings.view", content: <div className="ws-scroll"><MatingsPanel /></div> }
  ]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
