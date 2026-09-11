/**
 * Catálogo de permissões do nosso sistema. Espelha a granularidade observada no sistema de referência
 * (recurso × ação: view/create/edit/delete + ações especiais), organizado pela nossa árvore de módulos.
 * Chave: `<recurso>.<ação>`.
 */
export type PermAction = "view" | "create" | "edit" | "delete" | (string & {});

export interface PermissionResource {
  key: string;
  label: string;
  module: string;
  actions: readonly PermAction[];
}

const CRUD = ["view", "create", "edit", "delete"] as const;
const R = (key: string, label: string, module: string, actions: readonly PermAction[] = CRUD): PermissionResource => ({ key, label, module, actions });

export const PERMISSION_RESOURCES: readonly PermissionResource[] = [
  // Painel / Dashboards
  R("dashboard.home", "Painel de Controle", "Painel", ["view"]),
  R("dashboard.financial", "Dashboard Financeiro", "Dashboards", ["view"]),
  R("dashboard.cash_book", "Dashboard Livro Caixa", "Dashboards", ["view"]),
  R("dashboard.supply", "Dashboard Suprimentos", "Dashboards", ["view"]),
  R("dashboard.livestock", "Dashboard Pecuária de Corte", "Dashboards", ["view"]),
  R("dashboard.depreciation", "Dashboard Depreciações", "Dashboards", ["view"]),
  R("dashboard.assets", "Dashboard Ativos", "Dashboards", ["view"]),
  R("dashboard.user_analysis", "Dashboard Análise de Usuários", "Dashboards", ["view"]),
  R("dashboard.rainfall", "Dashboard Pluviometria", "Dashboards", ["view"]),
  R("dashboard.feedlot", "Dashboard Lotação de Currais", "Dashboards", ["view"]),
  R("dashboard.feedlot_cost", "Dashboard Custos do Confinamento", "Dashboards", ["view"]),
  R("dashboard.feedlot_performance", "Dashboard Desempenho de Lotes", "Dashboards", ["view"]),
  R("dashboard.nutrition_stock", "Dashboard Estoque Nutrição", "Dashboards", ["view"]),
  R("dashboard.feed_consumption", "Dashboard Consumo de Ração", "Dashboards", ["view"]),
  // Cadastros base
  R("cost_centers", "Centros de Custo", "Cadastros Base > Estrutura"),
  R("farms", "Fazendas", "Cadastros Base > Estrutura", [...CRUD, "import_kml"]),
  R("harvests", "Safras", "Cadastros Base > Estrutura"),
  R("addressings", "Endereçamentos", "Cadastros Base > Estrutura > Produtos"),
  R("products", "Produtos", "Cadastros Base > Estrutura > Produtos", [...CRUD, "import", "export", "merge"]),
  R("warehouses", "Armazéns", "Cadastros Base > Estrutura > Produtos"),
  R("opening_balances", "Estoques Iniciais", "Cadastros Base > Estrutura > Produtos"),
  R("apportionments", "Categorias de Rateio", "Cadastros Base > Estrutura > Rateios"),
  R("roles", "Perfis de Usuário", "Cadastros Base > Pessoas"),
  R("people", "Pessoas Unificado", "Cadastros Base > Pessoas"),
  R("proprietaries", "Proprietários", "Cadastros Base > Pessoas"),
  R("employees", "Funcionários", "Cadastros Base > Pessoas"),
  R("providers", "Fornecedores", "Cadastros Base > Pessoas"),
  R("clients", "Clientes", "Cadastros Base > Pessoas"),
  R("users", "Usuários", "Cadastros Base > Pessoas"),
  R("authorizers", "Autorizadores", "Cadastros Base > Pessoas"),
  R("bank_accounts", "Contas Bancárias", "Cadastros Base > Financeiros"),
  R("opening_movements", "Saldo Inicial", "Cadastros Base > Financeiros"),
  R("financial_categories", "Categorias Financeiras", "Cadastros Base > Financeiros"),
  R("nfe_issuers", "Emissores NFe", "Cadastros Base > Fiscais"),
  R("dfe_sync", "Sinc. DFe", "Cadastros Base > Fiscais"),
  R("nfse_sync", "Sinc. NFS-e", "Cadastros Base > Fiscais"),
  R("tax_rules", "Regras Fiscais", "Cadastros Base > Fiscais"),
  R("accountants", "Contador", "Cadastros Base > Fiscais"),
  R("nature_operations", "Natureza de Operação", "Cadastros Base > Fiscais"),
  R("additional_infos", "Informações Complementares", "Cadastros Base > Fiscais"),
  R("chart_accounts", "Plano de Contas", "Cadastros Base > Fiscais"),
  R("operations", "Operações", "Cadastros Base > Agrícolas"),
  R("activities", "Atividades", "Cadastros Base > Agrícolas"),
  R("weight_parameters", "Parâmetros/Peso", "Cadastros Base > Pecuários"),
  R("fodders", "Forragem", "Cadastros Base > Pecuários"),
  R("animals", "Rebanho", "Cadastros Base > Pecuários"),
  R("animal_retroactive_costs", "Custo Retroativo", "Cadastros Base > Pecuários", ["view", "create", "edit"]),
  R("grazing_modules", "Módulo Pastejo", "Cadastros Base > Pecuários"),
  R("troughs", "Cochos", "Cadastros Base > Pecuários"),
  R("batches", "Lotes Animais", "Cadastros Base > Pecuários"),
  R("batch_grazing", "Lote/Módulo", "Cadastros Base > Pecuários"),
  R("batch_area", "Lote/Área", "Cadastros Base > Pecuários"),
  R("equipments", "Inventário (Bens)", "Cadastros Base > Bens/Ativos"),
  R("depreciations", "Depreciação Mensal", "Cadastros Base > Bens/Ativos"),
  R("depreciation_forecast", "Previsão de Depreciação", "Cadastros Base > Bens/Ativos", ["view"]),
  R("tenant_parameters", "Parametrizações", "Cadastros Base > Gerais", ["edit"]),
  // Administrativo > Suprimentos
  R("supply_sla", "Parâmetros SLA", "Administrativo > Suprimentos", ["view", "edit"]),
  R("purchase_requests", "Solicitações", "Administrativo > Suprimentos", [...CRUD, "transfer", "financial", "back_step", "cancel"]),
  R("rejected_requests", "Rejeitados/Cancelados", "Administrativo > Suprimentos", ["view"]),
  R("purchase_quotations", "Cotações", "Administrativo > Suprimentos"),
  R("purchase_authorization", "Autorização", "Administrativo > Suprimentos", ["view", "edit"]),
  R("purchase_buy", "Compras", "Administrativo > Suprimentos", ["view", "edit"]),
  R("purchase_receipts", "Recebimentos", "Administrativo > Suprimentos", ["view", "edit"]),
  // Administrativo > Estoque
  R("invoices", "Doc. Fiscal/Entrada", "Administrativo > Estoque"),
  R("input_entries", "Entrada/Insumos", "Administrativo > Estoque"),
  R("dfe", "DFe Recebidas", "Administrativo > Estoque", ["view", "create", "manifest", "launch", "danfe", "xml"]),
  R("dfe_drafts", "Aprovação de Notas", "Administrativo > Estoque", ["view", "approve", "ignore"]),
  R("provider_launch_profiles", "Perfis de Lançamento", "Administrativo > Estoque"),
  R("stock_writeoffs", "Baixa de Estoque", "Administrativo > Estoque", ["view", "create", "delete"]),
  R("requisitions", "Requisição/Saída", "Administrativo > Estoque"),
  R("devolutions", "Devolução/Entrada", "Administrativo > Estoque"),
  R("stock_corrections", "Correção de Estoque", "Administrativo > Estoque", ["view", "create", "delete"]),
  R("warehouse_transfers", "Transferência de Armazém", "Administrativo > Estoque"),
  R("farm_transfers", "Transferência entre Fazendas", "Administrativo > Estoque", ["view", "create", "delete"]),
  R("stocks", "Saldo de Estoque", "Administrativo > Estoque", ["view", "export"]),
  R("feed_formulas", "Formulação", "Administrativo > Estoque > Fábrica"),
  R("feed_batches", "Batida", "Administrativo > Estoque > Fábrica"),
  // Gestão pessoal
  R("hr_events", "Eventos", "Administrativo > Gestão Pessoal"),
  R("job_functions", "Funções", "Administrativo > Gestão Pessoal"),
  R("teams", "Equipes", "Administrativo > Gestão Pessoal"),
  R("absences", "Registro/Faltas", "Administrativo > Gestão Pessoal"),
  R("salary_advances", "Adiantamento Salarial", "Administrativo > Gestão Pessoal"),
  R("bonuses", "Registro/Eventos", "Administrativo > Gestão Pessoal"),
  R("employee_events", "Funcionário x Eventos", "Administrativo > Gestão Pessoal"),
  R("earnings", "Apuração Mensal", "Administrativo > Gestão Pessoal", [...CRUD, "generate_financial"]),
  R("document_types", "Tipos de Documento", "Administrativo > Gestão Documentos"),
  R("documents", "Documentos", "Administrativo > Gestão Documentos"),
  // Operacional > Pecuária
  R("animals_management", "Gestão de Animais", "Operacional > Pecuária"),
  R("inventoried_animals", "Inventariado", "Operacional > Pecuária", ["view", "create", "delete"]),
  R("livestock_plannings", "Planejamento Pecuário", "Operacional > Pecuária"),
  R("herd_evolution", "Evolução/Rebanho", "Operacional > Pecuária > Transferências", ["view", "create"]),
  R("animal_batch_transfer", "Animais/Lote", "Operacional > Pecuária > Transferências", ["view", "create"]),
  R("batch_grouping", "Agrupar/Lotes", "Operacional > Pecuária > Transferências", ["view", "create"]),
  R("batch_module_area_transfer", "Lote/Módulo/Área", "Operacional > Pecuária > Transferências", ["view", "create"]),
  R("batch_farm_transfer", "Lote/Fazenda", "Operacional > Pecuária > Transferências", ["view", "create", "process"]),
  R("animal_farm_transfer", "Animal/Fazenda", "Operacional > Pecuária > Transferências", ["view", "create"]),
  R("animal_sales", "Vendas de Animais", "Operacional > Pecuária > Movimentações"),
  R("animal_purchases", "Compras de Animais", "Operacional > Pecuária > Movimentações"),
  R("animal_births", "Nascimentos", "Operacional > Pecuária > Movimentações"),
  R("animal_deaths", "Mortes", "Operacional > Pecuária > Movimentações"),
  R("animal_losses", "Perdas", "Operacional > Pecuária > Movimentações"),
  R("processings", "Processamentos", "Operacional > Pecuária > Manejo", ["view", "create", "delete", "process"]),
  R("pre_batches", "Pré-Lotes", "Operacional > Pecuária > Manejo"),
  R("weighings", "Pesagem", "Operacional > Pecuária > Manejo", [...CRUD, "stock"]),
  R("nutritions", "Nutrição", "Operacional > Pecuária > Manejo"),
  R("sanitaries", "Sanitário", "Operacional > Pecuária > Manejo"),
  R("weanings", "Desmama", "Operacional > Pecuária > Manejo"),
  R("separations", "Apartação", "Operacional > Pecuária > Manejo"),
  R("locate_animals", "Localiza Animal", "Operacional > Pecuária > Manejo"),
  R("pastures", "Pastagem", "Operacional > Pecuária > Manejo"),
  R("advanced_reproductive", "Gerenciamento Reprodutivo Avançado", "Operacional > Pecuária > Reprodução", ["view"]),
  R("breeding_seasons", "Estação de Monta", "Operacional > Pecuária > Reprodução"),
  R("breeding_batches", "Lotes/Reprodução", "Operacional > Pecuária > Reprodução"),
  R("breeding_sires", "Touros/Sêmen/Embrião", "Operacional > Pecuária > Reprodução"),
  R("breeding_protocols", "Protocolos/Estação", "Operacional > Pecuária > Reprodução"),
  R("matings", "Acasalamento", "Operacional > Pecuária > Reprodução"),
  R("pregnancy_diagnosis", "Diagnóstico de Gestação", "Operacional > Pecuária > Reprodução"),
  R("feedlot_yards", "Pátios", "Operacional > Confinamento > Cadastros"),
  R("feedlot_sectors", "Setores", "Operacional > Confinamento > Cadastros"),
  R("feedlot_corrals", "Currais", "Operacional > Confinamento > Cadastros"),
  R("diets", "Dieta", "Operacional > Confinamento > Nutrição"),
  R("feeding_phases", "Fases/Regras de Troca", "Operacional > Confinamento > Nutrição"),
  R("diet_batches", "Batelada", "Operacional > Confinamento > Nutrição"),
  R("feed_deliveries", "Trato Diário", "Operacional > Confinamento > Nutrição"),
  R("trough_readings", "Leitura de Cocho", "Operacional > Confinamento > Nutrição"),
  R("feedlot_map", "Mapa do Confinamento", "Operacional > Confinamento", ["view"]),
  R("rainfalls", "Pluviometria", "Operacional"),
  R("budgets", "Orçamentos", "Operacional > Vendas"),
  R("orders", "Pedidos", "Operacional > Vendas"),
  R("sales", "Vendas", "Operacional > Vendas"),
  R("service_orders", "Ordens de Serviço", "Operacional > Ordens de Serviço", [...CRUD, "monitor", "rate"]),
  // Financeiro
  R("payables", "Contas a Pagar", "Financeiro", [...CRUD, "settle", "cancel_settlement", "import", "export", "receipt", "boleto", "duplicate"]),
  R("receivables", "Contas a Receber", "Financeiro", [...CRUD, "settle", "cancel_settlement", "import", "export", "receipt", "boleto", "duplicate"]),
  R("bank_movements", "Movimento Caixa/Bancário", "Financeiro", [...CRUD, "import", "export"]),
  R("cash_flow", "Fluxo Bancário", "Financeiro", ["view"]),
  R("ofx_imports", "Importação OFX", "Financeiro > Conciliação", [...CRUD, "reconcile"]),
  R("ofx_report", "Meses Conciliados", "Financeiro > Conciliação", ["view"]),
  R("contracts", "Gestão de Contratos", "Financeiro"),
  R("budget_plannings", "Previsão Orçamentária", "Financeiro"),
  R("financial_freezes", "Congelamentos Financeiros", "Financeiro"),
  R("movement_sheets", "Importação de Movimentos", "Financeiro", ["view", "import"]),
  // Frota
  R("maintenances", "Manutenções", "Gestão de Frota"),
  R("fuel_supplies", "Abastecimentos", "Gestão de Frota"),
  R("preventive_maintenances", "Manutenções Preventivas", "Gestão de Frota"),
  R("scheduled_reviews", "Revisões Agendadas", "Gestão de Frota"),
  R("equipment_transfers", "Transferência de Máquinas", "Gestão de Frota", ["view", "create"]),
  // Fiscal
  R("nfe", "NFe Emitidas", "Gestão Fiscal > NFe", [...CRUD, "transmit", "cancel"]),
  R("xml_files", "Arquivos XML", "Gestão Fiscal > NFe", ["view", "export"]),
  R("mdfe", "MDFe", "Gestão Fiscal > MDFe"),
  R("nfse", "NFSe Recebidas", "Gestão Fiscal", ["view", "create"]),
  R("cash_book", "LCDPR", "Gestão Fiscal", ["view", "create"]),
  R("sped_fiscal", "SPED Fiscal", "Gestão Fiscal", ["view", "create"]),
  R("journal_entries", "Partida Dobrada", "Gestão Fiscal"),
  // Relatórios (uma permissão por relatório, como no sistema de referência)
  ...[
    ["report.equipment", "Inventário"], ["report.accumulated_depreciation", "Depreciação Acumulada"],
    ["report.herd_composition", "Composição Rebanho"], ["report.costing_livestock_area", "Custeio/Área Pecuária"], ["report.weighing_animal", "Pesagem/Animal"], ["report.weighing_batch", "Pesagem/Lote"], ["report.feedlot_weighing", "Pesagem Confinamento"], ["report.nutrition_batch", "Nutrição Consumo/Lote"], ["report.sanitary_batch", "Sanitário/Lote"], ["report.management_batch", "Manejo/Lote"], ["report.category_animal", "Estq. Animais/Categoria"], ["report.transfer_batch_area", "Transf/Lote/Módulo/Área"], ["report.animals", "Estoque/Rebanho"], ["report.application_management", "Aplicação/Manejo"], ["report.animal_movements", "Movimentação/Rebanho"], ["report.weaning", "Desmamas"], ["report.birth", "Nascimentos"], ["report.death", "Mortes"], ["report.animal_record", "Ficha Animal"], ["report.pregnant_cows", "Vacas Prenhas"], ["report.animal_sales", "Vendas/Animais"], ["report.animal_purchases", "Compras/Animais"], ["report.herd_evolution", "Evolução/Rebanho"], ["report.sisbov_identification", "Identificação/SISBOV"], ["report.sisbov_death", "Mortes/SISBOV"], ["report.sisbov_birth", "Nascimentos/SISBOV"], ["report.costing_batch", "Custeio/Lote"], ["report.costing_module", "Custeio/Módulo"], ["report.costing_animal", "Custeio/Animal"], ["report.reproduction_cost", "Custo Total/Reprodução"], ["report.batch_profitability", "Performance Animal"], ["report.reproductive_history", "Histórico Reprodutivo"], ["report.family_tree", "Registro Genealógico"], ["report.bull_efficiency", "Eficiência Reprodutiva Touro"], ["report.batch_movement_analysis", "Análise Mov. Lote"], ["report.receiver_productivity", "Prod. Receptora"], ["report.animals_per_batch", "Animais por Lote"], ["report.animal_batch_history", "Histórico de Animais/Lote"], ["report.feedlot_batch_control", "Lotes Confinamento"], ["report.feedlot_planned_consumption", "Consumo/Planejado"], ["report.feedlot_activity", "Atividades/Confinamento"],
    ["report.rainfall", "Pluviometria"],
    ["report.payment_schedule", "Agenda/Pagamentos"], ["report.receipt_schedule", "Agenda/Recebimentos"], ["report.payables", "C. à Pagar"], ["report.paid", "C. Pagas"], ["report.receivables", "C. à Receber"], ["report.received", "C. Recebidas"], ["report.received_interest", "Juros Recebidos"], ["report.paid_interest", "Juros Pagos"], ["report.bank_statement", "Extrato Financeiro"], ["report.ledger", "Livro Razão"], ["report.ledger_category", "Razão por Categoria"], ["report.rec_prev_real", "Rec. Prev. x Real"], ["report.pag_prev_real", "Pag. Prev. x Real"], ["report.budget_predicted", "Prev. x Realizado Anual"], ["report.cash_flow_category", "Fluxo de Caixa Mensal"], ["report.cash_flow_forecast", "Fluxo de Caixa Mensal Previsto"], ["report.financial_movement", "Movimento Bancário"], ["report.fiscal_difference", "Fiscal/Não Fiscal"], ["report.income_statement", "Custo de Produção"], ["report.accumulated_income_statement", "Custo de Produção Acumulado"], ["report.dre", "DRE"], ["report.dre_annual", "DRE Anual"], ["report.payment_cashflow", "Fluxo Mensal de Pagamento"], ["report.receipt_cashflow", "Fluxo Mensal de Recebimento"], ["report.cashflow_product", "Estoque Financeiro"], ["report.cost_center", "Centro de Custo"], ["report.cost_calculation", "Apuração de Custo"], ["report.financings", "Financiamentos"], ["report.advance_titles", "Adiantamento"], ["report.account_reconciliation", "Conciliação de Contas"], ["report.cost_centers_unified", "Centro de Custo/Unificado"], ["report.tax_accounts", "Contas Tributárias"], ["report.payable_receivable", "Consolidado Pagar/Receber"], ["report.provider_balance", "Saldo Devedor/Fornecedor"],
    ["report.stock_movement", "Mov. Estoque"], ["report.requisitions", "Requisição/Saída"], ["report.stock_writeoffs", "Baixas Estoque"], ["report.dfe", "DFe/Lançadas"], ["report.feed_batch_cost", "Custo Produção Batida"], ["report.stocks_abc", "Curva ABC/Estoque"], ["report.receipts", "Recebimentos"], ["report.stocks_consolidated", "Estoque Consolidado"], ["report.stocks_lot_provider", "Lote/Fornecedor"], ["report.exits_cost_center", "Saídas x Centro Custo"],
    ["report.supplies", "Suprimentos"], ["report.savings", "Savings"], ["report.ans", "ANS"], ["report.quotations", "Orçamentos (Cotações)"], ["report.purchase_forecast", "Produtos x Prev. Entrega"], ["report.supply_sla", "Relatório SLA"], ["report.purchase_management", "Gerencial de Solicitações"],
    ["report.sales_client", "Vendas/Cliente"], ["report.sales_product", "Vendas/Produto"], ["report.sales_client_product", "Cliente/Produto"], ["report.sales_employee", "Vendas/Funcionário"], ["report.sales_abc", "Curva ABC Vendas"],
    ["report.monthly_calculation", "Apuração Mensal"], ["report.birthdays", "Aniversariantes"], ["report.logged_hours", "Horas Logadas"], ["report.active_employees", "Funcionários Ativos"], ["report.advances", "Adiantamento Salarial"],
    ["report.journal_entries", "Partida Dobrada"], ["report.nfe", "NFe/Emitidas"], ["report.nfe_product", "Faturamento"], ["report.cash_book", "Livro Caixa"],
    ["report.machines", "Máquinas"], ["report.machine_supplies", "Abastecimentos"], ["report.machine_maintenances", "Manutenções"]
  ].map(([k, l]) => R(k!, l!, "Relatórios", ["view", "export"])),
  // Integrações
  R("integration.dominio", "Software Domínio", "Integrações", ["view", "edit", "export"]),
  R("integration.cta_smart", "CTA Smart", "Integrações", ["view", "edit", "sync"]),
  R("integration.csv_export", "Exportações CSV", "Integrações", ["view", "export"]),
  // Administração do tenant
  R("audit_logs", "Auditoria", "Administração", ["view"]),
  R("attachments", "Anexos de Registros", "Administração", ["view", "create", "delete"]),
  R("notifications", "Notificações", "Administração", ["view"]),
  R("screen_layouts", "Personalização de Telas (padrão da organização)", "Administração", ["edit"]),
  R("saved_reports", "Relatórios Personalizados", "Relatórios", ["view", "create", "edit", "delete", "share"])
];

export const ACTION_LABELS: Record<string, string> = {
  view: "Visualizar", create: "Criar", edit: "Editar", delete: "Excluir", import: "Importar", export: "Exportar", merge: "Agrupar",
  import_kml: "Importar KML", transfer: "Transferir Responsável", financial: "Financeiro", back_step: "Voltar Etapa", cancel: "Cancelar",
  manifest: "Manifestar", launch: "Lançar", danfe: "DANFE", xml: "XML", approve: "Aprovar", ignore: "Ignorar", generate_financial: "Gerar Financeiro",
  process: "Processar", stock: "Estoque", settle: "Baixar", cancel_settlement: "Cancelar Baixa", receipt: "Gerar Recibo", boleto: "Gerar Boleto",
  duplicate: "Duplicar", reconcile: "Conciliar", transmit: "Transmitir", monitor: "Monitorar", rate: "Avaliar", sync: "Sincronizar"
};

export function allPermissionKeys(): string[] {
  return PERMISSION_RESOURCES.flatMap((r) => r.actions.map((a) => `${r.key}.${a}`));
}
export function permissionRows(): { key: string; module: string; resource: string; action: string; label: string }[] {
  return PERMISSION_RESOURCES.flatMap((r) => r.actions.map((a) => ({ key: `${r.key}.${a}`, module: r.module, resource: r.label, action: a, label: ACTION_LABELS[a] ?? a })));
}
