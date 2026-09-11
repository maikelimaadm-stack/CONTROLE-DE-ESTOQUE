"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Workspace, NewChooser } from "@/components/workspace";
import { ServiceOrdersList } from "@/features/os/orders-list";
import { ServiceOrdersMonitoring } from "@/features/os/monitoring";

/** Ordens de serviço: Todas / Minhas / Em andamento / Atrasadas (monitoramento) / Finalizadas. Avaliação fica no detalhe da OS. */
function Inner() {
  const sp = useSearchParams(); const status = sp.get("status") ?? undefined;
  return <Workspace title="Ordens de Serviço" actions={<NewChooser items={[{ label: "Nova ordem de serviço", href: "/os/new", perm: "service_orders.create" }]} />} tabs={[
    { key: "todas", label: "Todas", perm: "service_orders.view", content: <ServiceOrdersList scope="all" status={status} /> },
    { key: "minhas", label: "Minhas", perm: "service_orders.view", content: <ServiceOrdersList scope="mine" /> },
    { key: "andamento", label: "Em andamento", perm: "service_orders.view", content: <ServiceOrdersList scope="in_progress" /> },
    { key: "atrasadas", label: "Atrasadas", perm: "service_orders.monitor", content: <div className="ws-scroll"><ServiceOrdersMonitoring /></div> },
    { key: "finalizadas", label: "Finalizadas", perm: "service_orders.view", content: <ServiceOrdersList scope="finished" /> }
  ]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
