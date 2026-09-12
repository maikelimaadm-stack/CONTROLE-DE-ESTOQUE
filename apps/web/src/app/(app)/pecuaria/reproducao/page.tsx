"use client";
import { Suspense } from "react";
import { Workspace, tab } from "@/components/workspace";
import { ResourceList } from "@/features/resources/resource-list";
import { ReproductionOverview } from "@/features/livestock/reproduction-overview";
import { MatingsPanel } from "@/features/livestock/matings";

/**
 * Reprodução (V2): operação = Visão Geral · Estações · Acasalamentos e Diagnósticos. Reprodutores e protocolos são
 * cadastros técnicos de manutenção rara e vivem em Configurações › Pecuária (abas antigas redirecionam).
 */
function Inner() {
  return <Workspace title="Reprodução" tabs={[
    tab("pecuaria.reproducao.visao-geral", <div className="ws-scroll"><ReproductionOverview /></div>),
    tab("pecuaria.reproducao.estacoes", <ResourceList resourceKey="breeding_seasons" />),
    tab("pecuaria.reproducao.acasalamentos", <div className="ws-scroll"><MatingsPanel /></div>)
  ]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
