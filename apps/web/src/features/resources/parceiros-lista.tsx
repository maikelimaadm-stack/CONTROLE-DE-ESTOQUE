"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Dialog } from "@/components/ui";
import { FilterChips, useUrlParam } from "@/components/workspace";
import { PillBtn } from "@/features/base1/ui";
import { ResourceList } from "./resource-list";
import { JanelaConsultaCnpj, guardarImportacaoPendente, useConsultaCnpjJanela } from "./consulta-cnpj-janela";

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
  // NOVO PELO CNPJ (AJUSTES 01, C-2): a mesma janela da ficha; Importar abre um parceiro NOVO já preenchido (nada gravado).
  // Os dados vão EM MEMÓRIA para o formulário novo (R1, W-5): nada no armazenamento do navegador.
  const router = useRouter(); const janela = useConsultaCnpjJanela() && can("people.create"); const [novoPeloCnpj, setNovoPeloCnpj] = React.useState(false);
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    {(opcoes.length > 1 || janela) && <div className="mg-card ws-filters no-print flex flex-wrap items-center gap-2">
      {opcoes.length > 1 && <FilterChips label="Tipo" testId="people-role" value={cur.value} onChange={setRole} options={opcoes} />}
      {janela && <PillBtn tone="gray" className="ml-auto" data-testid="parceiros-novo-pelo-cnpj" onClick={() => setNovoPeloCnpj(true)}><Search className="h-3.5 w-3.5" /> Novo pelo CNPJ</PillBtn>}
    </div>}
    {janela && <JanelaConsultaCnpj open={novoPeloCnpj} onOpenChange={setNovoPeloCnpj} cadastro={null} rotuloImportar="Importar para um parceiro novo"
      onImportar={(v) => { guardarImportacaoPendente(v); router.push("/cadastros/people/new"); }} />}
    <ResourceList key={cur.value} resourceKey="people" title={cur.value === "all" ? "Parceiros" : cur.label} fixedFilters={cur.filter ? { [cur.filter]: "true" } : undefined}
      extraRowActions={(r) => r["is_employee"] && can("employee_events.view") ? [{ label: "Eventos fixos do funcionário", onClick: () => setEvents(String(r["id"])) }] : []} />
    <Dialog open={Boolean(events)} onOpenChange={(o) => { if (!o) setEvents(""); }} title="Eventos fixos do funcionário" size="xl"><div className="flex min-h-[420px] flex-col"><ResourceList key={events} resourceKey="employee_events" fixedFilters={{ person_id: events }} /></div></Dialog>
  </div>;
}
