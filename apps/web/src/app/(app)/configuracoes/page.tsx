"use client";
import * as React from "react";
import { Suspense } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { configEntries, canonicalHref, permOk, moduleOf } from "@/lib/nav";
import { Workspace, ViewSegment, tab } from "@/components/workspace";
import { Dashboard } from "@/features/dashboards/dashboard";
import { ResourceList } from "@/features/resources/resource-list";
import { UsersPanel } from "@/features/admin/users";
import { RolesPanel } from "@/features/admin/roles";
import { AuditPanel } from "@/features/admin/audit";
import { ParametersPanel } from "@/features/admin/parameters";
import { ExportsPanel } from "@/features/admin/exports";
import { SupplySlaPanel } from "@/features/supply/sla";
import { OpeningBalancesPanel } from "@/features/stock/opening-balances";
import { OpeningMovementsPanel } from "@/features/financial/opening-movements";
import { FiscalStatusPanel } from "@/features/fiscal/status";

/**
 * Configurações (área administrativa — pode ter 3 níveis): cadastros técnicos, parâmetros, usuários, integrações,
 * auditoria e capacidades fiscais. Só PARÂMETROS/REGRAS vivem aqui: operações (planejamento orçamentário, contas
 * bancárias, transferências…) ficam nos módulos. "Buscar configuração" usa a fonte única de navegação.
 */
const scroll = (c: React.ReactNode) => <div className="ws-scroll">{c}</div>;
const res = (id: string, resourceKey: string) => tab(id, <ResourceList resourceKey={resourceKey} />);
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
function ConfigSearch() {
  const { can } = useAuth(); const router = useRouter(); const [q, setQ] = React.useState("");
  const hits = React.useMemo(() => { const t = norm(q.trim()); if (t.length < 2) return []; return configEntries().filter((e) => e.type === "sub" && permOk(can, e.perm) && [e.label, ...(e.keywords ?? [])].some((x) => norm(x).includes(t))).slice(0, 8); }, [q, can]);
  const parentLabel = (tabKey: string) => configEntries().find((e) => e.tab === tabKey && !e.sub)?.label ?? moduleOf("configuracoes")?.label;
  return <div className="relative w-72 max-w-full">
    <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-slate-400" />
    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar configuração… (plano de contas, SLA, família)" aria-label="Buscar configuração" className="h-7 w-full rounded-full bg-[var(--mg-gray-fill)] pl-7 pr-2 text-[12px] focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-300" onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) { e.preventDefault(); setQ(""); router.push(canonicalHref(hits[0])); } if (e.key === "Escape") setQ(""); }} />
    {hits.length > 0 && <div role="listbox" data-testid="config-search-results" className="absolute right-0 z-20 mt-1 w-full rounded-md border bg-white shadow-lg">{hits.map((h) => <button key={h.id} role="option" aria-selected={false} className="block w-full px-3 py-1.5 text-left text-[12px] hover:bg-slate-100" onClick={() => { setQ(""); router.push(canonicalHref(h)); }}>{h.label}<span className="ml-2 text-[10px] text-slate-400">{parentLabel(h.tab!)}</span></button>)}</div>}
  </div>;
}
function Inner() {
  return <Workspace title="Configurações" layout="sidebar" header={<ConfigSearch />} tabs={[
    tab("configuracoes.empresa", <ViewSegment tabs={[
      res("configuracoes.empresa.farms", "farms"), res("configuracoes.empresa.cost-centers", "cost_centers"), res("configuracoes.empresa.harvests", "harvests"), res("configuracoes.empresa.rainfalls", "rainfalls"),
      tab("configuracoes.empresa.pluviometria", <Dashboard k="pluviometria" title="Pluviometria" />),
      tab("configuracoes.empresa.parametros", scroll(<ParametersPanel />))
    ]} />),
    tab("configuracoes.produtos", <ViewSegment tabs={[
      res("configuracoes.produtos.products", "products"), res("configuracoes.produtos.product-groups", "product_groups"), res("configuracoes.produtos.measurement-units", "measurement_units"), res("configuracoes.produtos.cultivations", "cultivations"),
      res("configuracoes.produtos.warehouses", "warehouses"), res("configuracoes.produtos.addressings", "addressings"), res("configuracoes.produtos.provider-launch-profiles", "provider_launch_profiles"), res("configuracoes.produtos.apportionment-categories", "apportionment_categories")
    ]} />),
    tab("configuracoes.compras", <ViewSegment tabs={[tab("configuracoes.compras.sla", scroll(<SupplySlaPanel />)), res("configuracoes.compras.authorizers", "authorizers")]} />),
    tab("configuracoes.financeiro", <ViewSegment tabs={[
      res("configuracoes.financeiro.financial-categories", "financial_categories"), res("configuracoes.financeiro.title-types", "title_types"), res("configuracoes.financeiro.payment-methods", "payment_methods"),
      res("configuracoes.financeiro.financial-freezes", "financial_freezes"), res("configuracoes.financeiro.chart-accounts", "chart_accounts")
    ]} />),
    tab("configuracoes.pecuaria", <ViewSegment tabs={[
      res("configuracoes.pecuaria.animal-categories", "animal_categories"), res("configuracoes.pecuaria.identification-types", "identification_types"), res("configuracoes.pecuaria.weight-parameters", "weight_parameters"), res("configuracoes.pecuaria.fodders", "fodders"),
      res("configuracoes.pecuaria.grazing-modules", "grazing_modules"), res("configuracoes.pecuaria.areas", "areas"), res("configuracoes.pecuaria.troughs", "troughs"), res("configuracoes.pecuaria.livestock-plannings", "livestock_plannings"),
      res("configuracoes.pecuaria.operations", "operations"), res("configuracoes.pecuaria.activities", "activities"),
      res("configuracoes.pecuaria.breeding-sires", "breeding_sires"), res("configuracoes.pecuaria.breeding-protocols", "breeding_protocols")
    ]} />),
    tab("configuracoes.frota", <ViewSegment tabs={[res("configuracoes.frota.equipment-families", "equipment_families")]} />),
    tab("configuracoes.rh", <ViewSegment tabs={[res("configuracoes.rh.hr-events", "hr_events"), res("configuracoes.rh.job-functions", "job_functions"), res("configuracoes.rh.teams", "teams")]} />),
    tab("configuracoes.fiscal", <ViewSegment tabs={[
      tab("configuracoes.fiscal.capacidades", scroll(<FiscalStatusPanel />)),
      res("configuracoes.fiscal.tax-rules", "tax_rules"), res("configuracoes.fiscal.nature-operations", "nature_operations"), res("configuracoes.fiscal.additional-infos", "additional_infos"), res("configuracoes.fiscal.document-types", "document_types"), res("configuracoes.fiscal.documents", "documents")
    ]} />),
    tab("configuracoes.implantacao", <ViewSegment tabs={[
      tab("configuracoes.implantacao.estoque", scroll(<OpeningBalancesPanel />)),
      tab("configuracoes.implantacao.financeiro", scroll(<OpeningMovementsPanel />))
    ]} />),
    tab("configuracoes.usuarios", <ViewSegment tabs={[
      tab("configuracoes.usuarios.usuarios", scroll(<UsersPanel />)),
      tab("configuracoes.usuarios.perfis", scroll(<RolesPanel />)),
      tab("configuracoes.usuarios.atividade", <Dashboard k="usuarios" title="Análise de usuários" />)
    ]} />),
    tab("configuracoes.integracoes", <ViewSegment tabs={[
      res("configuracoes.integracoes.integrations", "integrations"),
      tab("configuracoes.integracoes.exportacoes", scroll(<ExportsPanel />))
    ]} />),
    tab("configuracoes.auditoria", scroll(<AuditPanel />))
  ]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
