/**
 * Árvore de navegação do sistema: módulos funcionais com poucas entradas; cada entrada abre uma ÁREA
 * (`/modulo?tab=...`) cujas abas/ações são montadas conforme as permissões do usuário (ver docs/UX-ARCHITECTURE.md).
 * `perm` aceita uma chave ou uma lista (o item aparece se o usuário tiver QUALQUER uma delas); grupos aparecem
 * quando ao menos um filho é visível. As rotas antigas continuam válidas por redirecionamento (apps/web/redirects.mjs).
 */
export interface NavItem { label: string; href?: string; perm?: string | string[]; children?: NavItem[] }

const STOCK_VIEW = ["stocks.view", "input_entries.view", "invoices.view", "requisitions.view", "stock_writeoffs.view", "warehouse_transfers.view", "farm_transfers.view", "feed_batches.view", "feed_formulas.view", "devolutions.view", "dfe.view"];
const PURCHASE_VIEW = ["purchase_requests.view", "purchase_quotations.view", "purchase_authorization.view", "purchase_buy.view", "purchase_receipts.view", "rejected_requests.view"];
const LIVESTOCK_VIEW = ["animals.view", "animals_management.view", "animal_sales.view", "animal_purchases.view", "animal_births.view", "animal_deaths.view", "animal_losses.view"];
const HANDLING_VIEW = ["weighings.view", "nutritions.view", "sanitaries.view", "weanings.view", "separations.view", "pastures.view", "herd_evolution.view"];
const HERD_MOVE_VIEW = ["animal_batch_transfer.view", "batch_grouping.view", "batch_module_area_transfer.view", "batch_farm_transfer.view"];
const REPRO_VIEW = ["advanced_reproductive.view", "breeding_seasons.view", "breeding_sires.view", "breeding_protocols.view", "matings.view"];
const FEEDLOT_VIEW = ["feedlot_yards.view", "feedlot_sectors.view", "feedlot_corrals.view", "diets.view", "diet_batches.view", "feed_deliveries.view", "trough_readings.view", "feedlot_map.view", "dashboard.feedlot.view"];
const MAINT_VIEW = ["maintenances.view", "preventive_maintenances.view", "scheduled_reviews.view"];
const HR_EVENTS_VIEW = ["absences.view", "bonuses.view", "employee_events.view"];
const PEOPLE_VIEW = ["people.view", "employees.view", "clients.view", "providers.view", "proprietaries.view"];
const ADMIN_VIEW = ["users.view", "roles.view", "audit_logs.view", "tenant_parameters.edit", "integration.dominio.view", "integration.csv_export.view"];
const COMPANY_CFG = ["farms.view", "cost_centers.view", "harvests.view", "rainfalls.view", "tenant_parameters.edit"];
const PRODUCT_CFG = ["products.view", "warehouses.view", "addressings.view", "provider_launch_profiles.view", "apportionments.view"];
const FIN_CFG = ["financial_categories.view", "bank_accounts.view", "payables.view", "sales.view", "financial_freezes.view", "chart_accounts.view", "opening_movements.view", "budget_plannings.view"];
const LIVESTOCK_CFG = ["animals.view", "weight_parameters.view", "fodders.view", "grazing_modules.view", "batch_area.view", "troughs.view", "batches.view", "livestock_plannings.view", "operations.view", "activities.view"];
const FISCAL_CFG = ["tax_rules.view", "nature_operations.view", "additional_infos.view", "chart_accounts.view", "document_types.view", "documents.view"];
const HR_CFG = ["hr_events.view", "job_functions.view", "teams.view"];

export const NAV: NavItem[] = [
  { label: "Início", href: "/", perm: "dashboard.home.view" },
  { label: "Compras", children: [
    { label: "Visão Geral", href: "/compras?tab=visao-geral", perm: "dashboard.supply.view" },
    { label: "Processos de Compra", href: "/compras?tab=processos", perm: PURCHASE_VIEW }
  ] },
  { label: "Estoque", children: [
    { label: "Visão Geral", href: "/estoque?tab=visao-geral", perm: "stocks.view" },
    { label: "Saldo e Movimentações", href: "/estoque?tab=saldo", perm: ["stocks.view", "stock_corrections.view"] },
    { label: "Entradas e Recebimentos", href: "/estoque?tab=entradas", perm: ["invoices.view", "input_entries.view", "dfe.view", "dfe_drafts.view"] },
    { label: "Saídas", href: "/estoque?tab=saidas", perm: ["requisitions.view", "stock_writeoffs.view", "devolutions.view"] },
    { label: "Transferências", href: "/estoque?tab=transferencias", perm: ["warehouse_transfers.view", "farm_transfers.view"] },
    { label: "Fábrica de Ração", href: "/estoque?tab=fabrica", perm: ["feed_formulas.view", "feed_batches.view"] }
  ] },
  { label: "Financeiro", children: [
    { label: "Visão Geral", href: "/financeiro?tab=visao-geral", perm: "dashboard.financial.view" },
    { label: "Contas", href: "/financeiro?tab=contas", perm: ["payables.view", "receivables.view"] },
    { label: "Tesouraria", href: "/financeiro?tab=tesouraria", perm: ["bank_movements.view", "cash_flow.view", "bank_accounts.view"] },
    { label: "Conciliação Bancária", href: "/financeiro?tab=conciliacao", perm: ["ofx_imports.view", "ofx_report.view"] },
    { label: "Planejamento", href: "/financeiro?tab=planejamento", perm: "budget_plannings.view" },
    { label: "Contratos", href: "/financeiro?tab=contratos", perm: "contracts.view" }
  ] },
  { label: "Vendas", children: [{ label: "Orçamentos / Pedidos / Vendas", href: "/vendas", perm: ["budgets.view", "orders.view", "sales.view"] }] },
  { label: "Pecuária", children: [
    { label: "Visão Geral", href: "/pecuaria?tab=visao-geral", perm: "dashboard.livestock.view" },
    { label: "Rebanho", href: "/pecuaria?tab=rebanho", perm: ["animals.view", "animals_management.view", "processings.view", "locate_animals.view"] },
    { label: "Movimentações", href: "/pecuaria?tab=movimentacoes", perm: LIVESTOCK_VIEW },
    { label: "Manejos", href: "/pecuaria?tab=manejos", perm: HANDLING_VIEW },
    { label: "Movimentar Rebanho", href: "/pecuaria?tab=movimentar", perm: HERD_MOVE_VIEW },
    { label: "Reprodução", href: "/pecuaria/reproducao", perm: REPRO_VIEW },
    { label: "Confinamento", href: "/confinamento", perm: FEEDLOT_VIEW }
  ] },
  { label: "Frota e Ativos", children: [
    { label: "Visão Geral", href: "/frota?tab=visao-geral", perm: ["dashboard.assets.view", "dashboard.depreciation.view"] },
    { label: "Máquinas e Equipamentos", href: "/frota?tab=maquinas", perm: ["equipments.view", "equipment_transfers.view"] },
    { label: "Abastecimentos", href: "/frota?tab=abastecimentos", perm: "fuel_supplies.view" },
    { label: "Manutenções", href: "/frota?tab=manutencoes", perm: MAINT_VIEW },
    { label: "Depreciação", href: "/frota?tab=depreciacao", perm: ["depreciations.view", "depreciation_forecast.view"] }
  ] },
  { label: "Pessoas e RH", children: [
    { label: "Pessoas", href: "/pessoas?tab=pessoas", perm: PEOPLE_VIEW },
    { label: "Funcionários", href: "/pessoas?tab=funcionarios", perm: ["employees.view", "people.view"] },
    { label: "Ocorrências", href: "/pessoas?tab=ocorrencias", perm: HR_EVENTS_VIEW },
    { label: "Adiantamentos", href: "/pessoas?tab=adiantamentos", perm: "salary_advances.view" },
    { label: "Apuração Mensal", href: "/pessoas?tab=apuracao", perm: "earnings.view" }
  ] },
  { label: "Ordens de Serviço", href: "/os", perm: "service_orders.view" },
  { label: "Fiscal", href: "/fiscal", perm: ["nfe.view", "journal_entries.view", "report.cash_book.view", "invoices.view"] },
  { label: "Relatórios", href: "/relatorios", perm: ["report.stock_movement.view", "saved_reports.view"] },
  { label: "Configurações", children: [
    { label: "Empresa e Fazendas", href: "/configuracoes?tab=empresa", perm: COMPANY_CFG },
    { label: "Produtos e Classificações", href: "/configuracoes?tab=produtos", perm: PRODUCT_CFG },
    { label: "Compras", href: "/configuracoes?tab=compras", perm: ["supply_sla.view", "authorizers.view"] },
    { label: "Financeiro", href: "/configuracoes?tab=financeiro", perm: FIN_CFG },
    { label: "Pecuária", href: "/configuracoes?tab=pecuaria", perm: LIVESTOCK_CFG },
    { label: "Frota", href: "/configuracoes?tab=frota", perm: "equipments.view" },
    { label: "RH", href: "/configuracoes?tab=rh", perm: HR_CFG },
    { label: "Fiscal", href: "/configuracoes?tab=fiscal", perm: FISCAL_CFG },
    { label: "Implantação", href: "/configuracoes?tab=implantacao", perm: ["opening_balances.view", "opening_movements.view"] },
    { label: "Usuários e Permissões", href: "/configuracoes?tab=usuarios", perm: ["users.view", "roles.view", "dashboard.user_analysis.view"] },
    { label: "Integrações", href: "/configuracoes?tab=integracoes", perm: ["integration.dominio.view", "integration.csv_export.view"] },
    { label: "Auditoria", href: "/configuracoes?tab=auditoria", perm: "audit_logs.view" }
  ] }
];
export const NAV_PERMS = { STOCK_VIEW, PURCHASE_VIEW, LIVESTOCK_VIEW, HANDLING_VIEW, HERD_MOVE_VIEW, REPRO_VIEW, FEEDLOT_VIEW, MAINT_VIEW, HR_EVENTS_VIEW, PEOPLE_VIEW, ADMIN_VIEW };

export function flatNav(items: NavItem[] = NAV, path: string[] = []): { href: string; label: string; path: string[]; perm?: string | string[] }[] {
  return items.flatMap((i) => [...(i.href ? [{ href: i.href, label: i.label, path: [...path, i.label], perm: i.perm }] : []), ...(i.children ? flatNav(i.children, [...path, i.label]) : [])]);
}
/** Chave de comparação de rota: caminho + aba (`tab`) — ignora demais parâmetros. */
export function navKey(pathname: string, search?: string | URLSearchParams | null): string {
  const sp = typeof search === "string" ? new URLSearchParams(search) : search;
  const tab = sp?.get("tab"); return tab ? `${pathname}?tab=${tab}` : pathname;
}
export function hrefKey(href: string): string { const [p, q] = href.split("?"); return navKey(p!, q ?? null); }
/** Um item aparece se não exige permissão ou se o usuário tem qualquer uma das listadas. */
export const permOk = (can: (p: string) => boolean, perm?: string | string[]) => !perm || (Array.isArray(perm) ? perm.some(can) : can(perm));
