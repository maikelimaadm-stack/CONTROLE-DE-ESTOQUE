/**
 * FONTE ÚNICA DE VERDADE DA NAVEGAÇÃO (Compactação V2 — docs/UX-ARCHITECTURE.md).
 *
 * Só metadados (sem React): módulos, áreas (abas), sub-áreas (seletor interno), ações e configurações, com rota
 * canônica, permissões, aliases antigos e palavras-chave. Daqui derivam: o menu principal (só módulos), a busca
 * global de funcionalidades, os breadcrumbs, os favoritos (rota canônica), os redirecionamentos de rotas antigas
 * (`redirects.mjs` → next.config.ts e scripts/parity.mjs), a canonicalização de abas antigas (`?tab=`/`?sub=` da
 * V1) e a auditoria/teste de navegação (`scripts/nav-audit.mjs`).
 *
 * Formato de cada entrada:
 *   id        identificador estável (módulo.área[.sub])
 *   type      "module" | "area" | "sub" | "action" | "config"
 *   module    id do módulo pai
 *   label     rótulo exibido
 *   path      rota (sem query) — módulos e áreas do mesmo módulo compartilham o path
 *   tab/sub   parâmetros canônicos (`?tab=`, `?sub=`); `query` = parâmetros estáveis adicionais
 *   perm      chave de permissão ou lista (qualquer uma libera); módulos herdam a união das áreas quando omitido
 *   aliases   rotas antigas (caminhos) que redirecionam para a rota canônica (parâmetros preservados)
 *   keywords  termos de busca (além do rótulo, descrição e rótulos dos pais)
 *   menu      aparece no menu principal (padrão: só módulos)
 *   search    aparece na busca (padrão: true)
 */
const P = {
  STOCK: ["stocks.view", "input_entries.view", "invoices.view", "requisitions.view", "stock_writeoffs.view", "warehouse_transfers.view", "farm_transfers.view", "feed_batches.view", "feed_formulas.view", "devolutions.view", "dfe.view", "dfe_drafts.view", "stock_corrections.view"],
  PURCHASE: ["purchase_requests.view", "purchase_quotations.view", "purchase_authorization.view", "purchase_buy.view", "purchase_receipts.view", "rejected_requests.view"],
  LIVESTOCK_MOV: ["animal_sales.view", "animal_purchases.view", "animal_births.view", "animal_deaths.view", "animal_losses.view"],
  HANDLING: ["weighings.view", "nutritions.view", "sanitaries.view", "weanings.view", "separations.view", "pastures.view"],
  HERD_MOVE: ["animal_batch_transfer.view", "batch_grouping.view", "batch_module_area_transfer.view", "batch_farm_transfer.view"],
  REPRO: ["advanced_reproductive.view", "breeding_seasons.view", "matings.view"],
  FEEDLOT: ["feedlot_yards.view", "feedlot_sectors.view", "feedlot_corrals.view", "diets.view", "feeding_phases.view", "diet_batches.view", "feed_deliveries.view", "trough_readings.view", "feedlot_map.view", "dashboard.feedlot.view", "dashboard.nutrition_stock.view", "dashboard.feedlot_performance.view", "dashboard.feedlot_cost.view", "dashboard.feed_consumption.view"],
  MAINT: ["maintenances.view", "preventive_maintenances.view", "scheduled_reviews.view"],
  HR_EVENTS: ["absences.view", "bonuses.view", "employee_events.view"],
  PEOPLE: ["people.view", "employees.view", "clients.view", "providers.view", "proprietaries.view"],
  COMPANY_CFG: ["farms.view", "cost_centers.view", "harvests.view", "rainfalls.view", "tenant_parameters.edit", "dashboard.rainfall.view"],
  PRODUCT_CFG: ["products.view", "warehouses.view", "addressings.view", "provider_launch_profiles.view", "apportionments.view"],
  FIN_CFG: ["financial_categories.view", "title_types.view", "payables.view", "sales.view", "financial_freezes.view", "chart_accounts.view"],
  LIVESTOCK_CFG: ["animals.view", "weight_parameters.view", "fodders.view", "grazing_modules.view", "batch_area.view", "troughs.view", "livestock_plannings.view", "operations.view", "activities.view", "breeding_sires.view", "breeding_protocols.view"],
  FISCAL_CFG: ["tax_rules.view", "nature_operations.view", "additional_infos.view", "document_types.view", "documents.view", "nfe.view"],
  HR_CFG: ["hr_events.view", "job_functions.view", "teams.view"]
};

const m = (id, label, path, extra = {}) => ({ id, type: "module", module: id, label, path, menu: true, ...extra });
const a = (module, tab, label, perm, extra = {}) => ({ id: `${module}.${tab}`, type: "area", module, tab, label, perm, ...extra });
const s = (module, tab, sub, label, perm, extra = {}) => ({ id: `${module}.${tab}.${sub}`, type: "sub", module, tab, sub, label, perm, ...extra });
const act = (module, key, label, href, perm, extra = {}) => ({ id: `${module}.acao.${key}`, type: "action", module, label, href, perm, ...extra });
const cfg = (tab, sub, label, perm, extra = {}) => ({ id: `configuracoes.${tab}${sub ? "." + sub : ""}`, type: sub ? "sub" : "area", module: "configuracoes", tab, ...(sub ? { sub } : {}), label, perm, ...extra });

export const MODULES = [
  m("inicio", "Início", "/", { perm: "dashboard.home.view", keywords: ["home", "painel", "dashboard"] }),
  m("compras", "Compras", "/compras", { keywords: ["suprimentos", "solicitação", "cotação", "pedido de compra"], description: "Processos de compra do início ao fim" }),
  m("estoque", "Estoque", "/estoque", { keywords: ["almoxarifado", "insumos", "armazém", "saldo"], description: "Saldo, recebimentos, operações e fábrica de ração" }),
  m("financeiro", "Financeiro", "/financeiro", { keywords: ["contas", "banco", "caixa", "títulos"], description: "Contas a pagar/receber, caixa e bancos, planejamento" }),
  m("vendas", "Vendas", "/vendas", { keywords: ["orçamento", "pedido", "faturamento", "cliente"], description: "Orçamento → pedido → venda" }),
  m("pecuaria", "Pecuária", "/pecuaria", { keywords: ["rebanho", "gado", "animais", "lote", "manejo"], description: "Rebanho, movimentações, manejos e reprodução" }),
  m("confinamento", "Confinamento", "/confinamento", { keywords: ["curral", "dieta", "trato", "cocho"], description: "Operação diária, currais, dietas e desempenho" }),
  m("frota", "Frota e Ativos", "/frota", { keywords: ["máquinas", "equipamentos", "veículos", "abastecimento", "manutenção", "patrimônio"], description: "Equipamentos, abastecimentos e manutenções" }),
  m("pessoas", "Pessoas e RH", "/pessoas", { keywords: ["funcionários", "clientes", "fornecedores", "folha", "rh"], description: "Pessoas, ocorrências e folha" }),
  m("os", "Ordens de Serviço", "/os", { perm: "service_orders.view", keywords: ["os", "serviço", "atividade", "operação"], description: "Ordens de serviço (todas / minhas, por status, atrasadas)" }),
  m("fiscal", "Fiscal", "/fiscal", { keywords: ["nota fiscal", "nf-e", "contábil", "lcdpr"], description: "Documentos de entrada, partida dobrada e livro caixa" }),
  m("relatorios", "Relatórios", "/relatorios", { perm: ["report.stock_movement.view", "saved_reports.view"], keywords: ["relatório", "exportar", "impressão"], description: "Catálogo de relatórios, favoritos e personalizados" }),
  m("configuracoes", "Configurações", "/configuracoes", { keywords: ["cadastros", "parâmetros", "administração", "usuários", "perfis"], description: "Cadastros técnicos, parâmetros, usuários, integrações e auditoria" })
];

export const AREAS = [
  // ---------------- Compras ----------------
  a("compras", "visao-geral", "Visão Geral", "dashboard.supply.view", { aliases: ["/dashboards/suprimentos"], keywords: ["indicadores de compras", "dashboard"] }),
  a("compras", "processos", "Processos", P.PURCHASE, { keywords: ["solicitação", "cotação", "aprovação", "autorização", "compra", "recebimento", "meus processos", "rejeitados"], description: "Uma lista: escopo (todos / meus) + etapa como filtro" }),
  act("compras", "solicitacao", "Nova solicitação de compra", "/suprimentos/new", "purchase_requests.create", { keywords: ["comprar", "pedir", "requisitar compra"] }),
  // ---------------- Estoque ----------------
  a("estoque", "visao-geral", "Visão Geral", "stocks.view", { keywords: ["indicadores de estoque"] }),
  a("estoque", "estoque", "Estoque", ["stocks.view", "stock_corrections.view"], { keywords: ["saldo", "lote", "validade", "estoque mínimo", "custo"], description: "Saldo, movimentações (ledger) e ajustes" }),
  s("estoque", "estoque", "saldo", "Saldo", "stocks.view", { aliases: ["/estoque/saldo"], keywords: ["consultar estoque", "quantidade", "produto"] }),
  s("estoque", "estoque", "ledger", "Movimentações", "stocks.view", { aliases: ["/estoque/movimentos"], keywords: ["histórico", "ledger", "extrato de estoque"] }),
  s("estoque", "estoque", "ajustes", "Ajustes de estoque", "stock_corrections.view", { aliases: ["/estoque/correcoes"], keywords: ["correção", "inventário", "acerto"] }),
  a("estoque", "recebimentos", "Recebimentos", ["invoices.view", "input_entries.view", "dfe.view", "dfe_drafts.view"], { keywords: ["entrada", "nota fiscal", "xml", "receber produto"] }),
  s("estoque", "recebimentos", "fiscais", "Documentos fiscais", "invoices.view", { aliases: ["/estoque/documentos-fiscais"], keywords: ["nf-e", "nota lançada", "entrada fiscal"] }),
  s("estoque", "recebimentos", "manuais", "Entradas manuais", "input_entries.view", { aliases: ["/estoque/entradas"], keywords: ["entrada de insumos", "sem nota"] }),
  s("estoque", "recebimentos", "dfe", "DFe / XML recebidos", "dfe.view", { aliases: ["/estoque/dfe"], keywords: ["dfe", "xml", "manifestação", "sefaz"] }),
  s("estoque", "recebimentos", "conferencia", "Em conferência", "dfe_drafts.view", { aliases: ["/estoque/aprovacao-notas"], keywords: ["aprovação de notas", "conferir nota"] }),
  a("estoque", "operacoes", "Operações", ["requisitions.view", "stock_writeoffs.view", "warehouse_transfers.view", "farm_transfers.view", "devolutions.view"], { keywords: ["saída", "requisição", "baixa", "transferência", "devolução"] }),
  s("estoque", "operacoes", "requisicoes", "Requisições", "requisitions.view", { aliases: ["/estoque/requisicoes"], keywords: ["solicitar material", "requisição de estoque", "assinatura"] }),
  s("estoque", "operacoes", "diretas", "Saídas diretas", "stock_writeoffs.view", { aliases: ["/estoque/baixas"], keywords: ["baixa", "consumo", "saída direta"] }),
  s("estoque", "operacoes", "transferencias", "Transferências", ["warehouse_transfers.view", "farm_transfers.view"], { aliases: ["/estoque/transferencias"], keywords: ["entre armazéns", "entre fazendas", "transferir estoque"] }),
  s("estoque", "operacoes", "devolucoes", "Devoluções", "devolutions.view", { aliases: ["/estoque/devolucoes"], keywords: ["devolver itens", "retorno ao estoque"] }),
  a("estoque", "fabrica", "Fábrica de Ração", ["feed_formulas.view", "feed_batches.view"], { keywords: ["ração", "fórmula", "batida", "produção de ração", "nutrição"] }),
  s("estoque", "fabrica", "formulas", "Fórmulas", "feed_formulas.view", { aliases: ["/estoque/formulacoes"], keywords: ["formulação", "receita de ração"] }),
  s("estoque", "fabrica", "producoes", "Produções", "feed_batches.view", { aliases: ["/estoque/batidas"], keywords: ["batida", "produzir ração"] }),
  s("estoque", "fabrica", "consumo", "Consumo de matéria-prima", "stocks.view", { search: false }),
  s("estoque", "fabrica", "custos", "Custos (produto acabado)", "stocks.view", { search: false }),
  act("estoque", "entrada-manual", "Nova entrada manual", "/estoque/entradas/new", "input_entries.create", { keywords: ["dar entrada", "receber insumo"] }),
  act("estoque", "documento-fiscal", "Novo documento fiscal / importar XML", "/estoque/documentos-fiscais/new", "invoices.create", { keywords: ["importar xml", "lançar nota"] }),
  act("estoque", "requisicao", "Nova requisição", "/estoque/requisicoes/new", "requisitions.create", { keywords: ["solicitar material", "pedir insumo"] }),
  act("estoque", "saida-direta", "Nova saída direta", "/estoque/baixas/new", "stock_writeoffs.create", { keywords: ["baixar estoque"] }),
  act("estoque", "transferencia-armazens", "Transferência entre armazéns", "/estoque/transferencias/new?kind=warehouse", "warehouse_transfers.create"),
  act("estoque", "transferencia-fazendas", "Transferência entre fazendas", "/estoque/transferencias/new?kind=farm", "farm_transfers.create"),
  act("estoque", "producao-racao", "Nova produção de ração", "/estoque/batidas/new", "feed_batches.create", { keywords: ["batida", "misturar ração"] }),
  // ---------------- Financeiro ----------------
  a("financeiro", "visao-geral", "Visão Geral", "dashboard.financial.view", { aliases: ["/dashboards/financeiro"], keywords: ["indicadores financeiros"] }),
  a("financeiro", "contas", "Contas", ["payables.view", "receivables.view", "contracts.view"], { keywords: ["título", "pagar conta", "receber", "vencimento", "compromissos"] }),
  s("financeiro", "contas", "pagar", "A Pagar", "payables.view", { aliases: ["/financeiro/contas-a-pagar"], keywords: ["despesa", "fornecedor", "boleto", "pagar"] }),
  s("financeiro", "contas", "receber", "A Receber", "receivables.view", { aliases: ["/financeiro/contas-a-receber"], keywords: ["receita", "cliente", "receber venda", "cobrança"] }),
  s("financeiro", "contas", "contratos", "Compromissos (contratos)", "contracts.view", { keywords: ["contrato", "compromisso", "parcelas"] }),
  a("financeiro", "caixa", "Caixa e Bancos", ["bank_movements.view", "cash_flow.view", "bank_accounts.view", "ofx_imports.view", "ofx_report.view"], { keywords: ["tesouraria", "extrato", "saldo bancário", "conciliação", "ofx"] }),
  s("financeiro", "caixa", "extrato", "Extrato", "bank_movements.view", { aliases: ["/financeiro/movimentos"], keywords: ["movimento bancário", "lançamento de caixa"] }),
  s("financeiro", "caixa", "fluxo", "Fluxo de Caixa", "cash_flow.view", { aliases: ["/financeiro/fluxo"], keywords: ["projeção", "entradas e saídas"] }),
  s("financeiro", "caixa", "conciliacao", "Conciliação (OFX)", "ofx_imports.view", { aliases: ["/financeiro/ofx"], keywords: ["conciliar", "importar ofx", "pendências"] }),
  s("financeiro", "caixa", "historico", "Meses conciliados", "ofx_report.view", { aliases: ["/financeiro/ofx/relatorio"], keywords: ["histórico de conciliação"] }),
  s("financeiro", "caixa", "bancos", "Contas Bancárias", "bank_accounts.view", { keywords: ["banco", "agência", "conta corrente"] }),
  a("financeiro", "planejamento", "Planejamento", "budget_plannings.view", { aliases: ["/financeiro/previsao-orcamentaria"], keywords: ["orçamento", "previsão orçamentária", "planejamento orçamentário"] }),
  act("financeiro", "despesa", "Nova despesa (conta a pagar)", "/financeiro/contas-a-pagar/new", "payables.create", { keywords: ["lançar conta", "pagar"] }),
  act("financeiro", "receita", "Nova receita (conta a receber)", "/financeiro/contas-a-receber/new", "receivables.create"),
  act("financeiro", "movimento", "Novo movimento bancário", "/financeiro/movimentos/new", "bank_movements.create"),
  // ---------------- Vendas ----------------
  a("vendas", "budgets", "Orçamentos", "budgets.view", { aliases: ["/vendas/budgets"], keywords: ["proposta", "cotação de venda"] }),
  a("vendas", "orders", "Pedidos", "orders.view", { aliases: ["/vendas/orders"], keywords: ["pedido de venda"] }),
  a("vendas", "sales", "Vendas", "sales.view", { aliases: ["/vendas/sales"], keywords: ["faturar", "venda confirmada"] }),
  act("vendas", "orcamento", "Novo orçamento", "/vendas/budgets/new", "budgets.create"),
  act("vendas", "pedido", "Novo pedido", "/vendas/orders/new", "orders.create"),
  act("vendas", "venda", "Nova venda", "/vendas/sales/new", "sales.create"),
  // ---------------- Pecuária ----------------
  a("pecuaria", "visao-geral", "Visão Geral", "dashboard.livestock.view", { aliases: ["/dashboards/pecuaria"], keywords: ["indicadores da pecuária"] }),
  a("pecuaria", "rebanho", "Rebanho", ["animals.view", "animals_management.view", "processings.view", "locate_animals.view", "batches.view", "herd_evolution.view", ...P.HERD_MOVE], { keywords: ["animais", "lotes", "brinco", "sisbov"] }),
  s("pecuaria", "rebanho", "animais", "Animais", ["animals.view", "animals_management.view", "locate_animals.view", "processings.view"], { aliases: ["/pecuaria/animais"], keywords: ["cadastrar animal", "buscar animal", "localizar animal", "identificação", "processamento pendente", "mover para lote"] }),
  s("pecuaria", "rebanho", "lotes", "Lotes", "batches.view", { keywords: ["lote", "curral", "mover de local", "agrupar lotes", "transferir de fazenda"] }),
  s("pecuaria", "rebanho", "reclassificacoes", "Reclassificações", "herd_evolution.view", { aliases: ["/pecuaria/transferencias/evolucao"], keywords: ["evolução de categoria", "evolução de rebanho", "reclassificar"] }),
  s("pecuaria", "rebanho", "transferencias", "Transferências (histórico)", P.HERD_MOVE, { keywords: ["movimentar rebanho", "animais entre lotes", "lote para local", "entre fazendas", "agrupar lotes"] }),
  a("pecuaria", "movimentacoes", "Movimentações", P.LIVESTOCK_MOV, { keywords: ["compra de gado", "venda de gado", "nascimento", "morte", "perda"], description: "Uma lista com filtro por tipo" }),
  a("pecuaria", "manejos", "Manejos", P.HANDLING, { keywords: ["pesagem", "pesar animal", "sanitário", "vacina", "medicamento", "nutrição", "desmama", "apartação", "pastagem"], description: "Uma lista com filtro por tipo" }),
  act("pecuaria", "animal", "Cadastrar animal", "/pecuaria/animais/new", "animals.create"),
  act("pecuaria", "pesagem", "Nova pesagem", "/pecuaria/pesagens/new", "weighings.create", { keywords: ["pesar", "balança"] }),
  act("pecuaria", "manejo-sanitario", "Novo manejo sanitário", "/pecuaria/manejo/sanitary/new", "sanitaries.create", { keywords: ["vacinar", "aplicar medicamento", "vermífugo"] }),
  act("pecuaria", "manejo-nutricao", "Novo manejo de nutrição", "/pecuaria/manejo/nutrition/new", "nutritions.create"),
  act("pecuaria", "mov-compra", "Nova compra de animais", "/pecuaria/movimentacoes/purchase/new", "animal_purchases.create"),
  act("pecuaria", "mov-venda", "Nova venda de animais", "/pecuaria/movimentacoes/sale/new", "animal_sales.create"),
  act("pecuaria", "mov-nascimento", "Registrar nascimento", "/pecuaria/movimentacoes/birth/new", "animal_births.create"),
  act("pecuaria", "mov-morte", "Registrar morte", "/pecuaria/movimentacoes/death/new", "animal_deaths.create"),
  // ---------------- Reprodução (rota própria) ----------------
  a("pecuaria", "reproducao", "Reprodução", P.REPRO, { path: "/pecuaria/reproducao", tab: null, keywords: ["estação de monta", "acasalamento", "diagnóstico de gestação", "iatf"] }),
  s("pecuaria", "reproducao", "visao-geral", "Visão Geral", "advanced_reproductive.view", { path: "/pecuaria/reproducao", sub: null, tab: "visao-geral" }),
  s("pecuaria", "reproducao", "estacoes", "Estações de Monta", "breeding_seasons.view", { path: "/pecuaria/reproducao", sub: null, tab: "estacoes" }),
  s("pecuaria", "reproducao", "acasalamentos", "Acasalamentos e Diagnósticos", "matings.view", { path: "/pecuaria/reproducao", sub: null, tab: "acasalamentos", aliases: ["/pecuaria/reproducao/acasalamentos"], keywords: ["cobertura", "inseminação", "diagnóstico"] }),
  // ---------------- Confinamento ----------------
  a("confinamento", "hoje", "Hoje", ["diet_batches.view", "feed_deliveries.view", "trough_readings.view"], { keywords: ["operação do dia", "produção", "trato", "leitura de cocho"] }),
  s("confinamento", "hoje", "producao", "Produção (bateladas)", "diet_batches.view", { aliases: ["/confinamento/bateladas"], keywords: ["batelada", "misturar dieta"] }),
  s("confinamento", "hoje", "trato", "Trato", "feed_deliveries.view", { aliases: ["/confinamento/trato"], keywords: ["fornecimento", "tratar currais"] }),
  s("confinamento", "hoje", "cocho", "Leitura de Cocho", "trough_readings.view", { aliases: ["/confinamento/leitura-cocho"], keywords: ["escore de cocho", "sobra"] }),
  a("confinamento", "currais", "Currais", ["feedlot_yards.view", "feedlot_sectors.view", "feedlot_corrals.view", "feedlot_map.view", "dashboard.feedlot.view"], { keywords: ["pátio", "setor", "curral", "mapa", "lotação", "estrutura"] }),
  a("confinamento", "dietas", "Dietas", ["diets.view", "feeding_phases.view"], { keywords: ["dieta", "fases", "regras de troca"] }),
  a("confinamento", "desempenho", "Desempenho", ["dashboard.feedlot_performance.view", "dashboard.feedlot_cost.view", "dashboard.feed_consumption.view", "dashboard.nutrition_stock.view"], { aliases: ["/dashboards/confinamento-desempenho", "/dashboards/confinamento-custos", "/dashboards/consumo-racao"], keywords: ["ganho de peso", "gmd", "custos do confinamento", "consumo de ração", "estoque de nutrição"] }),
  // ---------------- Frota e Ativos ----------------
  a("frota", "visao-geral", "Visão Geral", "dashboard.assets.view", { aliases: ["/dashboards/ativos"], keywords: ["custos da frota", "ativos"] }),
  a("frota", "equipamentos", "Equipamentos", ["equipments.view", "equipment_transfers.view", "depreciations.view", "depreciation_forecast.view", "dashboard.depreciation.view"], { keywords: ["máquina", "trator", "veículo", "inventário", "patrimônio"] }),
  s("frota", "equipamentos", "inventario", "Inventário", "equipments.view", { keywords: ["cadastrar máquina", "transferir de fazenda", "horímetro"] }),
  s("frota", "equipamentos", "transferencias", "Transferências (histórico)", "equipment_transfers.view", { aliases: ["/frota/transferencias"] }),
  s("frota", "equipamentos", "depreciacao", "Depreciação / Patrimônio", ["depreciations.view", "depreciation_forecast.view", "dashboard.depreciation.view"], { aliases: ["/frota/depreciacoes", "/frota/previsao-depreciacao", "/dashboards/depreciacoes"], keywords: ["depreciação mensal", "previsão de depreciação", "valor residual"] }),
  a("frota", "abastecimentos", "Abastecimentos", "fuel_supplies.view", { aliases: ["/frota/abastecimentos"], keywords: ["combustível", "diesel", "abastecer máquina"] }),
  a("frota", "manutencoes", "Manutenções", P.MAINT, { aliases: ["/frota/manutencoes", "/frota/alertas"], keywords: ["corretiva", "preventiva", "revisão", "agenda", "alertas", "oficina"] }),
  act("frota", "equipamento", "Nova máquina / equipamento", "/cadastros/equipments/new", "equipments.create"),
  act("frota", "abastecimento", "Novo abastecimento", "/frota/abastecimentos/new", "fuel_supplies.create", { keywords: ["abastecer"] }),
  act("frota", "manutencao", "Nova manutenção", "/frota/manutencoes/new", "maintenances.create", { keywords: ["abrir manutenção", "conserto"] }),
  act("frota", "plano-preventivo", "Novo plano preventivo", "/cadastros/preventive_maintenances/new", "preventive_maintenances.create"),
  act("frota", "revisao", "Agendar revisão", "/cadastros/scheduled_reviews/new", "scheduled_reviews.create"),
  // ---------------- Pessoas e RH ----------------
  a("pessoas", "pessoas", "Pessoas", P.PEOPLE, { keywords: ["funcionário", "cliente", "fornecedor", "proprietário", "cpf", "cnpj"], description: "Uma lista; papel como filtro" }),
  a("pessoas", "ocorrencias", "Ocorrências", P.HR_EVENTS, { keywords: ["falta", "bonificação", "evento de funcionário", "atestado"] }),
  s("pessoas", "ocorrencias", "faltas", "Faltas", "absences.view"),
  s("pessoas", "ocorrencias", "eventos", "Bonificações / eventos", "bonuses.view"),
  a("pessoas", "folha", "Folha", ["salary_advances.view", "earnings.view"], { keywords: ["salário", "adiantamento", "apuração mensal", "holerite"] }),
  s("pessoas", "folha", "adiantamentos", "Adiantamentos", "salary_advances.view", { aliases: ["/gestao-pessoal/adiantamentos"], keywords: ["vale", "adiantar salário"] }),
  s("pessoas", "folha", "apuracao", "Apuração Mensal", "earnings.view", { aliases: ["/gestao-pessoal/apuracao"], keywords: ["fechamento", "proventos", "descontos"] }),
  act("pessoas", "pessoa", "Nova pessoa", "/cadastros/people/new", "people.create"),
  act("pessoas", "funcionario", "Novo funcionário", "/cadastros/people/new?is_employee=true", ["employees.create", "people.create"], { keywords: ["contratar", "admitir"] }),
  act("pessoas", "falta", "Registrar falta", "/cadastros/absences/new", "absences.create", { keywords: ["ausência", "ocorrência de funcionário"] }),
  act("pessoas", "bonificacao", "Registrar bonificação / evento", "/cadastros/bonuses/new", "bonuses.create"),
  // ---------------- Ordens de serviço ----------------
  a("os", "lista", "Ordens de Serviço", "service_orders.view", { tab: null, aliases: ["/os/monitoramento"], keywords: ["minhas os", "em andamento", "atrasadas", "finalizadas", "avaliar os", "monitoramento"] }),
  act("os", "nova", "Nova ordem de serviço", "/os/new", "service_orders.create", { keywords: ["abrir os"] }),
  // ---------------- Fiscal ----------------
  a("fiscal", "documentos", "Documentos de entrada", "invoices.view", { keywords: ["nf-e de entrada", "xml"] }),
  a("fiscal", "partida-dobrada", "Partida dobrada", "journal_entries.view", { aliases: ["/fiscal/partida-dobrada"], keywords: ["razão", "débito e crédito", "contábil", "plano de contas"] }),
  a("fiscal", "livro-caixa", "Livro Caixa", ["dashboard.cash_book.view", "report.cash_book.view"], { aliases: ["/dashboards/livro-caixa"], keywords: ["lcdpr", "livro caixa digital", "produtor rural"] }),
  // ---------------- Relatórios ----------------
  a("relatorios", "catalogo", "Relatórios", ["report.stock_movement.view", "saved_reports.view"], { tab: null, aliases: ["/relatorios/personalizados"], keywords: ["buscar relatório", "favoritos", "personalizados"] }),
  act("relatorios", "personalizado", "Novo relatório personalizado", "/relatorios/personalizados/novo", "saved_reports.create"),
  // ---------------- Configurações (área administrativa; permite 3 níveis) ----------------
  cfg("empresa", null, "Empresa e Fazendas", P.COMPANY_CFG),
  cfg("empresa", "farms", "Fazendas", "farms.view", { keywords: ["propriedade", "unidade"] }),
  cfg("empresa", "cost-centers", "Centros de Custo", "cost_centers.view"),
  cfg("empresa", "harvests", "Safras", "harvests.view"),
  cfg("empresa", "rainfalls", "Pluviometria", "rainfalls.view", { keywords: ["chuva"] }),
  cfg("empresa", "pluviometria", "Indicadores de chuva", "dashboard.rainfall.view", { aliases: ["/dashboards/pluviometria"] }),
  cfg("empresa", "parametros", "Parâmetros", "tenant_parameters.edit", { aliases: ["/admin/parametros"], keywords: ["parâmetros da organização", "configurações gerais"] }),
  cfg("produtos", null, "Produtos e Classificações", P.PRODUCT_CFG),
  cfg("produtos", "products", "Produtos", "products.view", { keywords: ["insumo", "item", "cadastrar produto"] }),
  cfg("produtos", "product-groups", "Grupos / Categorias / Classes", "products.view"),
  cfg("produtos", "measurement-units", "Unidades de Medida", "products.view"),
  cfg("produtos", "cultivations", "Variedades / Culturas", "products.view"),
  cfg("produtos", "warehouses", "Armazéns", "warehouses.view", { keywords: ["depósito", "almoxarifado"] }),
  cfg("produtos", "addressings", "Endereçamentos", "addressings.view"),
  cfg("produtos", "provider-launch-profiles", "Perfis de Lançamento (NF-e)", "provider_launch_profiles.view"),
  cfg("produtos", "apportionment-categories", "Categorias de Rateio", "apportionments.view"),
  cfg("compras", null, "Compras", ["supply_sla.view", "authorizers.view"]),
  cfg("compras", "sla", "SLA por etapa", "supply_sla.view", { aliases: ["/suprimentos/sla"], keywords: ["prazo", "sla"] }),
  cfg("compras", "authorizers", "Autorizadores", "authorizers.view", { keywords: ["aprovador", "alçada"] }),
  cfg("financeiro", null, "Financeiro", P.FIN_CFG),
  cfg("financeiro", "financial-categories", "Categorias Financeiras", "financial_categories.view"),
  cfg("financeiro", "title-types", "Tipos de Título", "payables.view"),
  cfg("financeiro", "payment-methods", "Formas de Pagamento", "sales.view"),
  cfg("financeiro", "financial-freezes", "Congelamentos", "financial_freezes.view", { keywords: ["fechar período", "bloquear lançamentos"] }),
  cfg("financeiro", "chart-accounts", "Plano de Contas", "chart_accounts.view", { keywords: ["conta contábil"] }),
  cfg("pecuaria", null, "Pecuária", P.LIVESTOCK_CFG),
  cfg("pecuaria", "animal-categories", "Espécies / Categorias / Raças", "animals.view", { keywords: ["categoria animal", "raça"] }),
  cfg("pecuaria", "identification-types", "Tipos de Identificação", "animals.view", { keywords: ["brinco", "sisbov", "chip"] }),
  cfg("pecuaria", "weight-parameters", "Parâmetros de Peso", "weight_parameters.view"),
  cfg("pecuaria", "fodders", "Forragens", "fodders.view"),
  cfg("pecuaria", "grazing-modules", "Módulos de Pastejo", "grazing_modules.view"),
  cfg("pecuaria", "areas", "Áreas / Piquetes", "batch_area.view"),
  cfg("pecuaria", "troughs", "Cochos", "troughs.view"),
  cfg("pecuaria", "livestock-plannings", "Planejamento Pecuário", "livestock_plannings.view"),
  cfg("pecuaria", "operations", "Operações", "operations.view"),
  cfg("pecuaria", "activities", "Atividades", "activities.view"),
  cfg("pecuaria", "breeding-sires", "Reprodutores (touros / sêmen / embrião)", "breeding_sires.view", { keywords: ["touro", "sêmen", "embrião", "reprodutor"] }),
  cfg("pecuaria", "breeding-protocols", "Protocolos reprodutivos", "breeding_protocols.view", { keywords: ["protocolo", "iatf"] }),
  cfg("frota", null, "Frota", "equipments.view"),
  cfg("frota", "equipment-families", "Famílias de Bens", "equipments.view", { keywords: ["família de equipamento", "classe de bem"] }),
  cfg("rh", null, "RH", P.HR_CFG),
  cfg("rh", "hr-events", "Tipos de Evento", "hr_events.view"),
  cfg("rh", "job-functions", "Funções", "job_functions.view", { keywords: ["cargo"] }),
  cfg("rh", "teams", "Equipes", "teams.view"),
  cfg("fiscal", null, "Fiscal e Documentos", P.FISCAL_CFG),
  cfg("fiscal", "capacidades", "Capacidades fiscais (status)", null, { keywords: ["nf-e não iniciada", "mdf-e", "sped", "status fiscal", "situação fiscal"] }),
  cfg("fiscal", "tax-rules", "Regras Fiscais", "tax_rules.view", { keywords: ["imposto", "cfop", "icms"] }),
  cfg("fiscal", "nature-operations", "Naturezas de Operação", "nature_operations.view"),
  cfg("fiscal", "additional-infos", "Informações Complementares", "additional_infos.view"),
  cfg("fiscal", "document-types", "Tipos de Documento", "document_types.view"),
  cfg("fiscal", "documents", "Biblioteca de Documentos", "documents.view", { keywords: ["documentos da empresa", "licença", "certificado", "vencimento de documento"] }),
  cfg("implantacao", null, "Implantação (saldos iniciais)", ["opening_balances.view", "opening_movements.view"]),
  cfg("implantacao", "estoque", "Saldos iniciais de estoque", "opening_balances.view", { aliases: ["/estoque/estoque-inicial"], keywords: ["estoque inicial", "implantação"] }),
  cfg("implantacao", "financeiro", "Saldos iniciais bancários", "opening_movements.view", { aliases: ["/financeiro/saldo-inicial"], keywords: ["saldo inicial"] }),
  cfg("usuarios", null, "Usuários e Permissões", ["users.view", "roles.view", "dashboard.user_analysis.view"]),
  cfg("usuarios", "usuarios", "Usuários", "users.view", { aliases: ["/admin/usuarios"], keywords: ["acesso", "senha", "convidar usuário"] }),
  cfg("usuarios", "perfis", "Perfis e Permissões", "roles.view", { aliases: ["/admin/perfis"], keywords: ["permissão", "papel", "perfil de acesso"] }),
  cfg("usuarios", "atividade", "Atividade dos usuários", "dashboard.user_analysis.view", { aliases: ["/dashboards/usuarios"] }),
  cfg("integracoes", null, "Integrações", ["integration.dominio.view", "integration.csv_export.view"]),
  cfg("integracoes", "integrations", "Configurações (NF-e / DFe / NFS-e / Domínio)", "integration.dominio.view", { keywords: ["domínio", "certificado digital", "api"] }),
  cfg("integracoes", "exportacoes", "Exportações CSV / XLSX", "integration.csv_export.view", { aliases: ["/integracoes/exportacoes"] }),
  cfg("auditoria", null, "Auditoria", "audit_logs.view", { aliases: ["/admin/auditoria"], keywords: ["log", "histórico de alterações", "quem alterou"] })
];

/**
 * Abas/sub-abas da V1 → destino canônico da V2 (canonicalização feita no cliente pelo Workspace; preserva favoritos e
 * links antigos `/modulo?tab=…&sub=…`). Chave: `tab` ou `tab/sub`. Valor: { tab, sub?, query?, path? }.
 */
export const LEGACY_TABS = {
  compras: { "processos/all": { tab: "processos" }, "processos/mine": { tab: "processos", query: { scope: "mine" } }, "processos/request": { tab: "processos", query: { stage: "request" } }, "processos/quotation": { tab: "processos", query: { stage: "quotation" } }, "processos/authorization": { tab: "processos", query: { stage: "authorization" } }, "processos/buy": { tab: "processos", query: { stage: "buy" } }, "processos/receipts": { tab: "processos", query: { stage: "receipts" } }, "processos/finished": { tab: "processos", query: { stage: "finished" } }, "processos/rejected": { tab: "processos", query: { stage: "rejected" } } },
  estoque: {
    saldo: { tab: "estoque", sub: "saldo" }, movimentacoes: { tab: "estoque", sub: "ledger" }, "movimentacoes/ledger": { tab: "estoque", sub: "ledger" }, "movimentacoes/correcoes": { tab: "estoque", sub: "ajustes" },
    entradas: { tab: "recebimentos" }, "entradas/lancadas": { tab: "recebimentos", sub: "fiscais" }, "entradas/manuais": { tab: "recebimentos", sub: "manuais" }, "entradas/dfe": { tab: "recebimentos", sub: "dfe" }, "entradas/conferencia": { tab: "recebimentos", sub: "conferencia" },
    saidas: { tab: "operacoes" }, "saidas/requisicoes": { tab: "operacoes", sub: "requisicoes" }, "saidas/diretas": { tab: "operacoes", sub: "diretas" }, "saidas/devolucoes": { tab: "operacoes", sub: "devolucoes" },
    transferencias: { tab: "operacoes", sub: "transferencias" }, "transferencias/warehouse": { tab: "operacoes", sub: "transferencias", query: { kind: "warehouse" } }, "transferencias/farm": { tab: "operacoes", sub: "transferencias", query: { kind: "farm" } }
  },
  financeiro: {
    tesouraria: { tab: "caixa" }, "tesouraria/extrato": { tab: "caixa", sub: "extrato" }, "tesouraria/fluxo": { tab: "caixa", sub: "fluxo" }, "tesouraria/contas": { tab: "caixa", sub: "bancos" },
    conciliacao: { tab: "caixa", sub: "conciliacao" }, "conciliacao/importar": { tab: "caixa", sub: "conciliacao" }, "conciliacao/pendencias": { tab: "caixa", sub: "conciliacao", query: { pending: "1" } }, "conciliacao/historico": { tab: "caixa", sub: "historico" },
    contratos: { tab: "contas", sub: "contratos" }
  },
  pecuaria: {
    "rebanho/buscar": { tab: "rebanho", sub: "animais", query: { locate: "1" } }, "rebanho/processamentos": { tab: "rebanho", sub: "animais", query: { processing: "1" } },
    "movimentacoes/purchase": { tab: "movimentacoes", query: { type: "purchase" } }, "movimentacoes/sale": { tab: "movimentacoes", query: { type: "sale" } }, "movimentacoes/birth": { tab: "movimentacoes", query: { type: "birth" } }, "movimentacoes/death": { tab: "movimentacoes", query: { type: "death" } }, "movimentacoes/loss": { tab: "movimentacoes", query: { type: "loss" } },
    "manejos/weighing": { tab: "manejos", query: { type: "weighing" } }, "manejos/sanitary": { tab: "manejos", query: { type: "sanitary" } }, "manejos/nutrition": { tab: "manejos", query: { type: "nutrition" } }, "manejos/weaning": { tab: "manejos", query: { type: "weaning" } }, "manejos/separation": { tab: "manejos", query: { type: "separation" } }, "manejos/pasture": { tab: "manejos", query: { type: "pasture" } }, "manejos/evolution": { tab: "rebanho", sub: "reclassificacoes" },
    movimentar: { tab: "rebanho", sub: "transferencias" }, "movimentar/animais-lote": { tab: "rebanho", sub: "transferencias", query: { action: "animais-lote" } }, "movimentar/lote-local": { tab: "rebanho", sub: "transferencias", query: { action: "lote-local" } }, "movimentar/fazendas": { tab: "rebanho", sub: "transferencias", query: { action: "fazendas" } }, "movimentar/agrupar": { tab: "rebanho", sub: "transferencias", query: { action: "agrupar" } }
  },
  "pecuaria/reproducao": { reprodutores: { path: "/configuracoes", tab: "pecuaria", sub: "breeding-sires" }, protocolos: { path: "/configuracoes", tab: "pecuaria", sub: "breeding-protocols" } },
  confinamento: {
    "visao-geral": { tab: "currais", query: { view: "lotacao" } }, "visao-geral/lotacao": { tab: "currais", query: { view: "lotacao" } }, "visao-geral/nutricao": { tab: "desempenho", query: { view: "nutricao" } },
    estrutura: { tab: "currais" }, "estrutura/patios": { tab: "currais" }, "estrutura/setores": { tab: "currais" }, "estrutura/currais": { tab: "currais" },
    "dietas/dietas": { tab: "dietas", sub: "dietas" }, "dietas/fases": { tab: "dietas", sub: "fases" },
    producao: { tab: "hoje", sub: "producao" }, trato: { tab: "hoje", sub: "trato" }, cocho: { tab: "hoje", sub: "cocho" }, mapa: { tab: "currais", query: { view: "mapa" } },
    "desempenho/ganho": { tab: "desempenho", query: { view: "ganho" } }, "desempenho/custos": { tab: "desempenho", query: { view: "custos" } }, "desempenho/consumo": { tab: "desempenho", query: { view: "consumo" } }
  },
  frota: {
    maquinas: { tab: "equipamentos" }, "maquinas/inventario": { tab: "equipamentos", sub: "inventario" }, "maquinas/familias": { path: "/configuracoes", tab: "frota", sub: "equipment-families" }, "maquinas/transferencias": { tab: "equipamentos", sub: "transferencias" },
    depreciacao: { tab: "equipamentos", sub: "depreciacao" }, "depreciacao/mensal": { tab: "equipamentos", sub: "depreciacao" }, "depreciacao/previsao": { tab: "equipamentos", sub: "depreciacao", query: { view: "previsao" } }, "depreciacao/indicadores": { tab: "equipamentos", sub: "depreciacao", query: { view: "indicadores" } },
    "manutencoes/corretivas": { tab: "manutencoes", sub: "corretivas" }, "manutencoes/preventivas": { tab: "manutencoes", sub: "preventivas" }, "manutencoes/agenda": { tab: "manutencoes", sub: "agenda" }, "manutencoes/alertas": { tab: "manutencoes", sub: "alertas" }
  },
  pessoas: {
    "pessoas/todas": { tab: "pessoas" }, "pessoas/clientes": { tab: "pessoas", query: { role: "client" } }, "pessoas/fornecedores": { tab: "pessoas", query: { role: "provider" } }, "pessoas/proprietarios": { tab: "pessoas", query: { role: "proprietary" } },
    funcionarios: { tab: "pessoas", query: { role: "employee" } }, "ocorrencias/faltas": { tab: "ocorrencias", sub: "faltas" }, "ocorrencias/eventos": { tab: "ocorrencias", sub: "eventos" }, "ocorrencias/fixos": { tab: "pessoas", query: { role: "employee" } },
    adiantamentos: { tab: "folha", sub: "adiantamentos" }, apuracao: { tab: "folha", sub: "apuracao" }
  },
  os: { todas: { tab: null }, minhas: { tab: null, query: { scope: "mine" } }, andamento: { tab: null, query: { status: "in_progress" } }, atrasadas: { tab: null, query: { late: "1" } }, finalizadas: { tab: null, query: { status: "finished" } } },
  fiscal: { situacao: { path: "/configuracoes", tab: "fiscal", sub: "capacidades" } },
  relatorios: { favoritos: { tab: null, query: { view: "favoritos" } }, todos: { tab: null }, personalizados: { tab: null, query: { view: "personalizados" } } },
  configuracoes: { "financeiro/budget-plannings": { path: "/financeiro", tab: "planejamento" } }
};

/** Redirecionamentos que não são aliases de uma entrada (parâmetros dinâmicos, rotas com query). */
export const EXTRA_REDIRECTS = [
  { source: "/suprimentos/mine", destination: "/compras?tab=processos&scope=mine" },
  { source: "/suprimentos/:stage(request|quotation|authorization|buy|receipts|finished|rejected)", destination: "/compras?tab=processos&stage=:stage" },
  { source: "/estoque/transferencias", destination: "/estoque?tab=operacoes&sub=transferencias&kind=farm", has: [{ type: "query", key: "kind", value: "farm" }] },
  { source: "/dashboards/estoque-nutricao", destination: "/confinamento?tab=desempenho&view=nutricao" },
  { source: "/dashboards/confinamento", destination: "/confinamento?tab=currais&view=lotacao" },
  { source: "/confinamento/mapa", destination: "/confinamento?tab=currais&view=mapa" },
  { source: "/pecuaria/localizar", destination: "/pecuaria?tab=rebanho&sub=animais&locate=1" },
  { source: "/pecuaria/processamentos", destination: "/pecuaria?tab=rebanho&sub=animais&processing=1" },
  { source: "/pecuaria/movimentacoes/:type(sale|purchase|birth|death|loss)", destination: "/pecuaria?tab=movimentacoes&type=:type" },
  { source: "/pecuaria/manejo/:type(nutrition|sanitary|weaning|separation|pasture)", destination: "/pecuaria?tab=manejos&type=:type" },
  { source: "/pecuaria/pesagens", destination: "/pecuaria?tab=manejos&type=weighing" },
  { source: "/pecuaria/transferencias/animais-lote", destination: "/pecuaria?tab=rebanho&sub=transferencias&action=animais-lote" },
  { source: "/pecuaria/transferencias/agrupar-lotes", destination: "/pecuaria?tab=rebanho&sub=transferencias&action=agrupar" },
  { source: "/pecuaria/transferencias/lote-modulo-area", destination: "/pecuaria?tab=rebanho&sub=transferencias&action=lote-local" },
  { source: "/pecuaria/transferencias/lote-fazenda", destination: "/pecuaria?tab=rebanho&sub=transferencias&action=fazendas" },
  { source: "/vendas/:kind(budgets|orders|sales)", destination: "/vendas?tab=:kind" },
  { source: "/os", destination: "/os?scope=mine", has: [{ type: "query", key: "mine", value: "1" }] },
  { source: "/os/monitoramento", destination: "/os?late=1" },
  { source: "/relatorios/personalizados", destination: "/relatorios?view=personalizados" },
  { source: "/documentos/:id", destination: "/cadastros/documents/:id" },
  { source: "/documentos", destination: "/configuracoes?tab=fiscal&sub=documents" }
];

/**
 * Padrões de rota de DETALHE (registro individual): a SSOT define o padrão, não cada id. Usados pelos breadcrumbs
 * (Módulo › Área › Registro) e pela auditoria de links (`scripts/nav-audit.mjs`: toda ação "Visualizar"/link estático
 * precisa casar com uma página existente ou com um destes padrões).
 */
export const DETAIL_ROUTES = [
  { id: "compras.processos.detalhe", module: "compras", area: "processos", label: "Processo de compra", pattern: "/suprimentos/view/:id", perm: "purchase_requests.view" },
  { id: "estoque.recebimentos.manuais.detalhe", module: "estoque", area: "recebimentos", label: "Entrada manual", pattern: "/estoque/entradas/:id", perm: "input_entries.view" },
  { id: "estoque.recebimentos.fiscais.detalhe", module: "estoque", area: "recebimentos", label: "Documento fiscal", pattern: "/estoque/documentos-fiscais/:id", perm: "invoices.view" },
  { id: "estoque.operacoes.requisicoes.detalhe", module: "estoque", area: "operacoes", label: "Requisição", pattern: "/estoque/requisicoes/:id", perm: "requisitions.view" },
  { id: "estoque.operacoes.diretas.detalhe", module: "estoque", area: "operacoes", label: "Saída direta", pattern: "/estoque/baixas/:id", perm: "stock_writeoffs.view" },
  { id: "estoque.operacoes.devolucoes.detalhe", module: "estoque", area: "operacoes", label: "Devolução", pattern: "/estoque/devolucoes/:id", perm: "devolutions.view" },
  { id: "estoque.operacoes.transferencias.detalhe", module: "estoque", area: "operacoes", label: "Transferência", pattern: "/estoque/transferencias/:id", perm: ["warehouse_transfers.view", "farm_transfers.view"] },
  { id: "estoque.fabrica.producoes.detalhe", module: "estoque", area: "fabrica", label: "Produção de ração", pattern: "/estoque/batidas/:id", perm: "feed_batches.view" },
  { id: "financeiro.contas.pagar.detalhe", module: "financeiro", area: "contas", label: "Conta a pagar", pattern: "/financeiro/contas-a-pagar/:id", perm: "payables.view" },
  { id: "financeiro.contas.receber.detalhe", module: "financeiro", area: "contas", label: "Conta a receber", pattern: "/financeiro/contas-a-receber/:id", perm: "receivables.view" },
  { id: "financeiro.caixa.extrato.detalhe", module: "financeiro", area: "caixa", label: "Movimento bancário", pattern: "/financeiro/movimentos/:id", perm: "bank_movements.view" },
  { id: "financeiro.caixa.conciliacao.detalhe", module: "financeiro", area: "caixa", label: "Importação OFX", pattern: "/financeiro/ofx/:id", perm: "ofx_imports.view" },
  { id: "vendas.detalhe", module: "vendas", area: null, label: "Documento de venda", pattern: "/vendas/:kind/:id", perm: ["budgets.view", "orders.view", "sales.view"] },
  { id: "pecuaria.rebanho.animais.detalhe", module: "pecuaria", area: "rebanho", label: "Animal", pattern: "/pecuaria/animais/:id", perm: ["animals.view", "animals_management.view"] },
  { id: "pecuaria.movimentacoes.detalhe", module: "pecuaria", area: "movimentacoes", label: "Movimentação", pattern: "/pecuaria/movimentacoes/:type/:id", perm: P.LIVESTOCK_MOV },
  { id: "pecuaria.manejos.detalhe", module: "pecuaria", area: "manejos", label: "Manejo", pattern: "/pecuaria/manejo/:type/:id", perm: ["nutritions.view", "sanitaries.view", "weanings.view", "separations.view", "pastures.view"] },
  { id: "pecuaria.manejos.pesagem.detalhe", module: "pecuaria", area: "manejos", label: "Pesagem", pattern: "/pecuaria/pesagens/:id", perm: "weighings.view" },
  { id: "frota.abastecimentos.detalhe", module: "frota", area: "abastecimentos", label: "Abastecimento", pattern: "/frota/abastecimentos/:id", perm: "fuel_supplies.view" },
  { id: "frota.manutencoes.detalhe", module: "frota", area: "manutencoes", label: "Manutenção", pattern: "/frota/manutencoes/:id", perm: "maintenances.view" },
  { id: "os.detalhe", module: "os", area: null, label: "Ordem de serviço", pattern: "/os/:id", perm: "service_orders.view" },
  { id: "cadastros.detalhe", module: "configuracoes", area: null, label: "Registro", pattern: "/cadastros/:resource/:id", perm: null }
];

/** Rota canônica de uma entrada (path + tab + sub + query estável). */
export function canonicalHref(e) {
  if (e.href) return e.href;
  const mod = MODULES.find((x) => x.id === e.module);
  const path = e.path ?? mod?.path ?? "/";
  const p = new URLSearchParams();
  if (e.tab) p.set("tab", e.tab); if (e.sub) p.set("sub", e.sub);
  for (const [k, v] of Object.entries(e.query ?? {})) p.set(k, String(v));
  const qs = p.toString(); return qs ? `${path}?${qs}` : path;
}
export const ALL = [...MODULES, ...AREAS];
