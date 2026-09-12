"use client";
import { Suspense } from "react";
import { Workspace, NewChooser, tab } from "@/components/workspace";
import { ServiceOrdersList } from "@/features/os/orders-list";

/** Ordens de serviço (V2): uma única listagem com Escopo/Status/Atrasadas como filtros. Avaliação no detalhe da OS. */
function Inner() {
  return <Workspace title="Ordens de Serviço" actions={<NewChooser items={[{ label: "Nova ordem de serviço", href: "/os/new", perm: "service_orders.create" }]} />} tabs={[tab("os.lista", <ServiceOrdersList />)]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
