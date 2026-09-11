"use client";
import { Suspense } from "react";
import { Workspace, SubTabs } from "@/components/workspace";
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

/**
 * Configurações: cadastros técnicos e administração fora do menu operacional, agrupados por contexto
 * (antes: "Cadastros Base" com 9 grupos + "Administração" + "Integrações" no menu principal).
 */
const scroll = (c: React.ReactNode) => <div className="ws-scroll">{c}</div>;
const res = (key: string, label: string, perm?: string) => ({ key: key.replace(/_/g, "-"), label, perm: perm ?? `${key}.view`, content: <ResourceList resourceKey={key} /> });
function Inner() {
  return <Workspace title="Configurações" layout="sidebar" tabs={[
    { key: "empresa", label: "Empresa e Fazendas", perm: ["farms.view", "cost_centers.view", "harvests.view", "rainfalls.view", "tenant_parameters.edit"], content: <SubTabs tabs={[
      res("farms", "Fazendas"), res("cost_centers", "Centros de Custo"), res("harvests", "Safras"), res("rainfalls", "Pluviometria"),
      { key: "pluviometria", label: "Indicadores de chuva", perm: "dashboard.rainfall.view", content: <Dashboard k="pluviometria" title="Pluviometria" /> },
      { key: "parametros", label: "Parâmetros", perm: "tenant_parameters.edit", content: scroll(<ParametersPanel />) }
    ]} /> },
    { key: "produtos", label: "Produtos e Classificações", perm: ["products.view", "warehouses.view", "addressings.view", "provider_launch_profiles.view", "apportionments.view"], content: <SubTabs tabs={[
      res("products", "Produtos"), res("product_groups", "Grupos / Categorias / Classes", "products.view"), res("measurement_units", "Unidades de Medida", "products.view"), res("cultivations", "Variedades / Culturas", "products.view"),
      res("warehouses", "Armazéns"), res("addressings", "Endereçamentos"), res("provider_launch_profiles", "Perfis de Lançamento (NF-e)"), res("apportionment_categories", "Categorias de Rateio", "apportionments.view")
    ]} /> },
    { key: "compras", label: "Compras", perm: ["supply_sla.view", "authorizers.view"], content: <SubTabs tabs={[
      { key: "sla", label: "SLA por etapa", perm: "supply_sla.view", content: scroll(<SupplySlaPanel />) }, res("authorizers", "Autorizadores")
    ]} /> },
    { key: "financeiro", label: "Financeiro", perm: ["financial_categories.view", "title_types.view", "payables.view", "sales.view", "financial_freezes.view", "chart_accounts.view", "budget_plannings.view"], content: <SubTabs tabs={[
      res("financial_categories", "Categorias Financeiras"), res("title_types", "Tipos de Título", "payables.view"), res("payment_methods", "Formas de Pagamento", "sales.view"),
      res("financial_freezes", "Congelamentos"), res("chart_accounts", "Plano de Contas"), res("budget_plannings", "Planejamentos Orçamentários")
    ]} /> },
    { key: "pecuaria", label: "Pecuária", perm: ["animals.view", "weight_parameters.view", "fodders.view", "grazing_modules.view", "batch_area.view", "troughs.view", "livestock_plannings.view", "operations.view", "activities.view"], content: <SubTabs tabs={[
      res("animal_categories", "Espécies / Categorias / Raças", "animals.view"), res("identification_types", "Tipos de Identificação", "animals.view"), res("weight_parameters", "Parâmetros de Peso"), res("fodders", "Forragens"),
      res("grazing_modules", "Módulos de Pastejo"), res("areas", "Áreas / Piquetes", "batch_area.view"), res("troughs", "Cochos"), res("livestock_plannings", "Planejamento Pecuário"),
      res("operations", "Operações"), res("activities", "Atividades")
    ]} /> },
    { key: "frota", label: "Frota", perm: "equipments.view", content: <SubTabs tabs={[res("equipment_families", "Famílias de Bens", "equipments.view")]} /> },
    { key: "rh", label: "RH", perm: ["hr_events.view", "job_functions.view", "teams.view"], content: <SubTabs tabs={[res("hr_events", "Tipos de Evento"), res("job_functions", "Funções"), res("teams", "Equipes")]} /> },
    { key: "fiscal", label: "Fiscal e Documentos", perm: ["tax_rules.view", "nature_operations.view", "additional_infos.view", "document_types.view", "documents.view"], content: <SubTabs tabs={[
      res("tax_rules", "Regras Fiscais"), res("nature_operations", "Naturezas de Operação"), res("additional_infos", "Informações Complementares"), res("document_types", "Tipos de Documento"), res("documents", "Documentos")
    ]} /> },
    { key: "implantacao", label: "Implantação (saldos iniciais)", perm: ["opening_balances.view", "opening_movements.view"], content: <SubTabs tabs={[
      { key: "estoque", label: "Saldos iniciais de estoque", perm: "opening_balances.view", content: scroll(<OpeningBalancesPanel />) },
      { key: "financeiro", label: "Saldos iniciais bancários", perm: "opening_movements.view", content: scroll(<OpeningMovementsPanel />) }
    ]} /> },
    { key: "usuarios", label: "Usuários e Permissões", perm: ["users.view", "roles.view", "dashboard.user_analysis.view"], content: <SubTabs tabs={[
      { key: "usuarios", label: "Usuários", perm: "users.view", content: scroll(<UsersPanel />) },
      { key: "perfis", label: "Perfis e Permissões", perm: "roles.view", content: scroll(<RolesPanel />) },
      { key: "atividade", label: "Atividade dos usuários", perm: "dashboard.user_analysis.view", content: <Dashboard k="usuarios" title="Análise de usuários" /> }
    ]} /> },
    { key: "integracoes", label: "Integrações", perm: ["integration.dominio.view", "integration.csv_export.view"], content: <SubTabs tabs={[
      res("integrations", "Configurações (NF-e / DFe / NFS-e / Domínio)", "integration.dominio.view"),
      { key: "exportacoes", label: "Exportações CSV / XLSX", perm: "integration.csv_export.view", content: scroll(<ExportsPanel />) }
    ]} /> },
    { key: "auditoria", label: "Auditoria", perm: "audit_logs.view", content: scroll(<AuditPanel />) }
  ]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
