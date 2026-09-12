"use client";
import * as React from "react";
import { Suspense } from "react";
import { useAuth } from "@/lib/auth";
import { Dialog } from "@/components/ui";
import { Workspace, ViewSegment, NewChooser, FilterChips, useUrlParam, tab } from "@/components/workspace";
import { ResourceList } from "@/features/resources/resource-list";
import { SalaryAdvancesPanel } from "@/features/hr/advances";
import { EarningsPanel } from "@/features/hr/earnings";

/**
 * Pessoas e RH (Compactação V2): Pessoas (uma lista; papel como filtro — uma pessoa acumula papéis) · Ocorrências
 * (faltas / bonificações) · Folha (adiantamentos / apuração). Eventos fixos são contextuais ao funcionário.
 */
const scroll = (c: React.ReactNode) => <div className="ws-scroll">{c}</div>;
const ROLES = [{ value: "all", label: "Todos", perm: "people.view" }, { value: "employee", label: "Funcionários", perm: ["employees.view", "people.view"], filter: "is_employee" }, { value: "client", label: "Clientes", perm: ["clients.view", "people.view"], filter: "is_client" }, { value: "provider", label: "Fornecedores", perm: ["providers.view", "people.view"], filter: "is_provider" }, { value: "proprietary", label: "Proprietários", perm: ["proprietaries.view", "people.view"], filter: "is_proprietary" }];
function People() {
  const { can } = useAuth(); const [role, setRole] = useUrlParam("role", "all"); const [events, setEvents] = useUrlParam("events_of", "");
  const cur = ROLES.find((r) => r.value === role) ?? ROLES[0]!;
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    <div className="mg-card ws-filters no-print"><FilterChips label="Papel" testId="people-role" value={cur.value} onChange={setRole} options={ROLES} /></div>
    <ResourceList key={cur.value} resourceKey="people" title={cur.value === "all" ? "Pessoas" : cur.label} fixedFilters={cur.filter ? { [cur.filter]: "true" } : undefined}
      extraRowActions={(r) => r["is_employee"] && can("employee_events.view") ? [{ label: "Eventos fixos do funcionário", onClick: () => setEvents(String(r["id"])) }] : []} />
    <Dialog open={Boolean(events)} onOpenChange={(o) => { if (!o) setEvents(""); }} title="Eventos fixos do funcionário" size="xl"><div className="flex min-h-[420px] flex-col"><ResourceList key={events} resourceKey="employee_events" fixedFilters={{ person_id: events }} /></div></Dialog>
  </div>;
}
function Inner() {
  return <Workspace title="Pessoas e RH" defaultTab="pessoas" actions={<NewChooser items={[
    { label: "Nova pessoa", href: "/cadastros/people/new", perm: "people.create" },
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
