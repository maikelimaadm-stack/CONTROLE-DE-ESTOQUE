"use client";
import * as React from "react";
import { Suspense } from "react";
import { Workspace, ViewSegment, NewChooser, useUrlParam, tab } from "@/components/workspace";
import { ResourceList } from "@/features/resources/resource-list";
import { ListaDeParceiros } from "@/features/resources/parceiros-lista";
import { SalaryAdvancesPanel } from "@/features/hr/advances";
import { EarningsPanel } from "@/features/hr/earnings";

/**
 * RH (CADASTROS Fase 4): Funcionários (parceiros do tipo Funcionário, com eventos fixos) · Ocorrências · Folha.
 * O cadastro de parceiros inteiro mora em Configurações › Parceiros; um link antigo com `role=…` continua
 * abrindo aqui com o filtro que ele guardava.
 */
const scroll = (c: React.ReactNode) => <div className="ws-scroll">{c}</div>;
function People() {
  const [role] = useUrlParam("role", "employee");
  return <ListaDeParceiros padrao="employee" tipos={role === "employee" ? ["employee"] : ["all", "client", "provider", "transporter", "employee", "proprietary"]} />;
}
function Inner() {
  return <Workspace title="RH" defaultTab="pessoas" actions={<NewChooser items={[
    { label: "Novo parceiro", href: "/cadastros/people/new", perm: "people.create" },
    { label: "Novo funcionário", href: "/cadastros/people/new?is_employee=true", perm: ["employees.create", "people.create"] },
    { label: "Ocorrência", children: [{ label: "Registrar falta", href: "/cadastros/absences/new", perm: "absences.create" }, { label: "Registrar bonificação / evento", href: "/cadastros/bonuses/new", perm: "bonuses.create" }] }
  ]} />} tabs={[
    tab("pessoas.pessoas", <People />),
    tab("pessoas.ocorrencias", <ViewSegment tabs={[
      tab("pessoas.ocorrencias.faltas", <ResourceList resourceKey="absences" />),
      tab("pessoas.ocorrencias.eventos", <ResourceList resourceKey="bonuses" />)
    ]} />),
    tab("pessoas.folha", <ViewSegment tabs={[
      tab("pessoas.folha.adiantamentos", scroll(<SalaryAdvancesPanel />)),
      tab("pessoas.folha.apuracao", scroll(<EarningsPanel />))
    ]} />)
  ]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
