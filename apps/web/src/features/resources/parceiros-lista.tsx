"use client";
import * as React from "react";
import { useAuth } from "@/lib/auth";
import { Dialog } from "@/components/ui";
import { FilterChips, useUrlParam } from "@/components/workspace";
import { ResourceList } from "./resource-list";

/**
 * PARCEIROS (CADASTROS Fase 4, decisão 253): UMA lista de `people`, com o TIPO como filtro — um parceiro
 * acumula tipos. Usada em Configurações › Parceiros (todos os tipos) e no RH › Funcionários (fixo em
 * Funcionário). O parâmetro continua `role`: os endereços antigos `/pessoas?tab=pessoas&role=…` seguem abrindo.
 */
export const TIPOS_DE_PARCEIRO_FILTRO = [
  { value: "all", label: "Todos", perm: "people.view" },
  { value: "client", label: "Clientes", perm: ["clients.view", "people.view"], filter: "is_client" },
  { value: "provider", label: "Fornecedores", perm: ["providers.view", "people.view"], filter: "is_provider" },
  { value: "transporter", label: "Transportadoras", perm: "people.view", filter: "is_transporter" },
  { value: "employee", label: "Funcionários", perm: ["employees.view", "people.view"], filter: "is_employee" },
  { value: "proprietary", label: "Proprietários", perm: ["proprietaries.view", "people.view"], filter: "is_proprietary" }
];

export function ListaDeParceiros({ padrao = "all", tipos = TIPOS_DE_PARCEIRO_FILTRO.map((t) => t.value) }: { padrao?: string; tipos?: string[] }) {
  const { can } = useAuth(); const [role, setRole] = useUrlParam("role", padrao); const [events, setEvents] = useUrlParam("events_of", "");
  const opcoes = TIPOS_DE_PARCEIRO_FILTRO.filter((t) => tipos.includes(t.value));
  const cur = opcoes.find((r) => r.value === role) ?? opcoes.find((r) => r.value === padrao) ?? opcoes[0]!;
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    {opcoes.length > 1 && <div className="mg-card ws-filters no-print"><FilterChips label="Tipo" testId="people-role" value={cur.value} onChange={setRole} options={opcoes} /></div>}
    <ResourceList key={cur.value} resourceKey="people" title={cur.value === "all" ? "Parceiros" : cur.label} fixedFilters={cur.filter ? { [cur.filter]: "true" } : undefined}
      extraRowActions={(r) => r["is_employee"] && can("employee_events.view") ? [{ label: "Eventos fixos do funcionário", onClick: () => setEvents(String(r["id"])) }] : []} />
    <Dialog open={Boolean(events)} onOpenChange={(o) => { if (!o) setEvents(""); }} title="Eventos fixos do funcionário" size="xl"><div className="flex min-h-[420px] flex-col"><ResourceList key={events} resourceKey="employee_events" fixedFilters={{ person_id: events }} /></div></Dialog>
  </div>;
}
