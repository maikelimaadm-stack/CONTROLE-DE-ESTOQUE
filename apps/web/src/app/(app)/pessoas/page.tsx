"use client";
import { Suspense } from "react";
import { Workspace, SubTabs, NewChooser } from "@/components/workspace";
import { ResourceList } from "@/features/resources/resource-list";
import { SalaryAdvancesPanel } from "@/features/hr/advances";
import { EarningsPanel } from "@/features/hr/earnings";

/** Pessoas e RH: cadastro único de pessoas (papéis como filtros) + funcionários, ocorrências, adiantamentos e apuração. */
const scroll = (c: React.ReactNode) => <div className="ws-scroll">{c}</div>;
function Inner() {
  return <Workspace title="Pessoas e RH" actions={<NewChooser items={[
    { label: "Nova pessoa", href: "/cadastros/people/new", perm: "people.create" },
    { label: "Novo funcionário", href: "/cadastros/people/new?is_employee=true", perm: ["employees.create", "people.create"] },
    { label: "Registrar falta", href: "/cadastros/absences/new", perm: "absences.create" },
    { label: "Registrar bonificação / evento", href: "/cadastros/bonuses/new", perm: "bonuses.create" }
  ]} />} tabs={[
    { key: "pessoas", label: "Pessoas", perm: ["people.view", "clients.view", "providers.view", "proprietaries.view"], content: <SubTabs tabs={[
      { key: "todas", label: "Todas", perm: "people.view", content: <ResourceList resourceKey="people" /> },
      { key: "clientes", label: "Clientes", perm: ["clients.view", "people.view"], content: <ResourceList resourceKey="people" title="Clientes" fixedFilters={{ is_client: "true" }} /> },
      { key: "fornecedores", label: "Fornecedores", perm: ["providers.view", "people.view"], content: <ResourceList resourceKey="people" title="Fornecedores" fixedFilters={{ is_provider: "true" }} /> },
      { key: "proprietarios", label: "Proprietários", perm: ["proprietaries.view", "people.view"], content: <ResourceList resourceKey="people" title="Proprietários" fixedFilters={{ is_proprietary: "true" }} /> }
    ]} /> },
    { key: "funcionarios", label: "Funcionários", perm: ["employees.view", "people.view"], content: <ResourceList resourceKey="people" title="Funcionários" fixedFilters={{ is_employee: "true" }} /> },
    { key: "ocorrencias", label: "Ocorrências", perm: ["absences.view", "bonuses.view", "employee_events.view"], content: <SubTabs tabs={[
      { key: "faltas", label: "Faltas", perm: "absences.view", content: <ResourceList resourceKey="absences" /> },
      { key: "eventos", label: "Bonificações / eventos", perm: "bonuses.view", content: <ResourceList resourceKey="bonuses" /> },
      { key: "fixos", label: "Eventos fixos por funcionário", perm: "employee_events.view", content: <ResourceList resourceKey="employee_events" /> }
    ]} /> },
    { key: "adiantamentos", label: "Adiantamentos", perm: "salary_advances.view", content: scroll(<SalaryAdvancesPanel />) },
    { key: "apuracao", label: "Apuração Mensal", perm: "earnings.view", content: scroll(<EarningsPanel />) }
  ]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
