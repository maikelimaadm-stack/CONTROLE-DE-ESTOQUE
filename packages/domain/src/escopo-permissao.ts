/**
 * CLASSIFICAÇÃO DE ESCOPO DE CADA RECURSO DE PERMISSÃO — CONFIGURAÇÃO DESTE PRODUTO.
 *
 * O MECANISMO (modos, fail-closed, interseção) vive em `@erp/plataforma`, neutro de segmento. AQUI ficam as
 * duas decisões de produto (docs/MULTI-COMPANY-CONTRACT.md §7):
 *
 *   1. QUAIS são os módulos de escopo empresarial;
 *   2. A QUE módulo cada recurso pertence — ou que ele é da ORGANIZAÇÃO inteira.
 *
 * POR QUE POR MÓDULO, E NÃO POR PERMISSÃO: uma permissão por empresa (`empresa_a.payables.view`) explodiria o
 * catálogo — 782 chaves × N empresas. O escopo empresarial é declarado uma vez por MÓDULO DE NEGÓCIO e cruza
 * com a permissão funcional: `capacidade AND escopo`.
 *
 * A CLASSIFICAÇÃO É EXPLÍCITA, NUNCA INFERIDA. Nada aqui deriva de prefixo textual nem do campo `module` do
 * catálogo (que guarda rótulos históricos como "Cadastros Base > …", "Administrativo > …"). Cada recurso é
 * listado à mão, e o gate `validarClassificacaoEscopo()` recusa recurso não classificado, módulo inválido e
 * escopo de organização declarado com módulo.
 *
 * REGRA DE OURO DA CLASSIFICAÇÃO: se a tabela do recurso tem coluna de empresa, o recurso é de EMPRESA.
 * Tabela da organização inteira → recurso de ORGANIZAÇÃO. As exceções conscientes estão em EXCECOES_ESCOPO.
 */
import { PERMISSION_RESOURCES } from "./permissions.js";

/** Um módulo de escopo empresarial: o domínio de autorização "em quais empresas posso operar isto". */
export interface ModuloEscopoEmpresa {
  chave: string;
  rotulo: string;
  ordem: number;
}

/**
 * MÓDULOS CANÔNICOS DE ESCOPO EMPRESARIAL.
 *
 * São os módulos de NEGÓCIO. Início, Relatórios e Configurações NÃO estão aqui de propósito: um relatório
 * financeiro respeita o escopo FINANCEIRO, um painel pecuário respeita PECUÁRIA, e um painel consolidado
 * consome vários escopos — nenhum deles é um escopo próprio (seria um atalho para esconder a origem do dado).
 *
 * `documentos` existe porque `erp.documents` (Biblioteca de Documentos) é company-scoped e não pertence a
 * nenhum módulo operacional: sem ele, o único caminho seria classificar uma tabela com empresa como recurso
 * de organização — exatamente a exceção que a regra de ouro proíbe.
 */
export const MODULOS_ESCOPO_EMPRESA: readonly ModuloEscopoEmpresa[] = [
  { chave: "compras", rotulo: "Compras", ordem: 1 },
  { chave: "estoque", rotulo: "Estoque", ordem: 2 },
  { chave: "financeiro", rotulo: "Financeiro", ordem: 3 },
  { chave: "vendas", rotulo: "Vendas", ordem: 4 },
  { chave: "pecuaria", rotulo: "Pecuária", ordem: 5 },
  { chave: "confinamento", rotulo: "Confinamento", ordem: 6 },
  { chave: "frota_ativos", rotulo: "Frota e Ativos", ordem: 7 },
  { chave: "pessoas_rh", rotulo: "Pessoas e RH", ordem: 8 },
  { chave: "ordens_servico", rotulo: "Ordens de Serviço", ordem: 9 },
  { chave: "fiscal", rotulo: "Fiscal", ordem: 10 },
  { chave: "documentos", rotulo: "Documentos", ordem: 11 }
];

export const CHAVES_MODULO_EMPRESA: readonly string[] = MODULOS_ESCOPO_EMPRESA.map((m) => m.chave);
const MODULOS = new Set(CHAVES_MODULO_EMPRESA);
export const moduloEscopoEmpresa = (chave: string): ModuloEscopoEmpresa | undefined =>
  MODULOS_ESCOPO_EMPRESA.find((m) => m.chave === chave);
export const moduloEmpresaValido = (chave: string): boolean => MODULOS.has(chave);

/** Onde o recurso vive: na organização inteira ou dentro de um módulo de empresa. */
export type EscopoRecurso =
  | { tipo: "organizacao" }
  | { tipo: "empresa"; modulo: string };

const ORG: EscopoRecurso = { tipo: "organizacao" };
const emp = (modulo: string): EscopoRecurso => ({ tipo: "empresa", modulo });

/**
 * RECURSOS DA ORGANIZAÇÃO INTEIRA — a permissão funcional basta; não existe empresa a cruzar.
 * São cadastros, parametrizações e administração que não pertencem a uma empresa: quem pode, pode em toda a
 * organização; quem não pode, não vê nada. Registros dessas tabelas não têm coluna de empresa (as exceções
 * conscientes, como vínculos empresa × cadastro, estão em EXCECOES_ESCOPO).
 */
const RECURSOS_ORGANIZACAO: readonly string[] = [
  // Estrutura e cadastros compartilhados
  "cost_centers", "farms", "harvests", "addressings", "products", "apportionments",
  "operations", "activities",
  // Pessoas (cadastro único da organização)
  "people", "proprietaries", "employees", "providers", "clients", "authorizers",
  // Financeiro: estrutura (os LANÇAMENTOS são de empresa)
  "bank_accounts", "report.bank_statement", "report.birthdays", "report.active_employees", "report.logged_hours", "financial_categories", "chart_accounts",
  // Fiscal: cadastros e credenciais da organização (os DOCUMENTOS emitidos são de empresa)
  "nfe_issuers", "dfe_sync", "nfse_sync", "tax_rules", "accountants", "nature_operations", "additional_infos",
  // Pecuária/frota: taxonomias da organização
  "weight_parameters", "fodders", "troughs",
  // Pessoas e RH: cadastros da organização
  "hr_events", "job_functions", "teams", "document_types",
  // Suprimentos: parametrização
  "supply_sla", "provider_launch_profiles",
  // Administração do tenant
  "roles", "users", "tenant_parameters", "audit_logs", "notifications", "screen_layouts", "attachments",
  "integration.dominio", "integration.cta_smart", "integration.csv_export",
  // Relatórios personalizados: a definição é da organização; os DADOS que ele lê respeitam o módulo da fonte
  "saved_reports",
  // Painel inicial: capacidade de abrir a tela. Cada bloco aplica o escopo do módulo de onde vem o dado.
  "dashboard.home", "dashboard.user_analysis"
];

/**
 * RECURSOS DE EMPRESA, POR MÓDULO.
 * Cada lista é a fonte única do módulo daquele recurso — é isto que `runService` usa para decidir o escopo
 * empresarial ativo da requisição (nunca a URL, nunca o frontend).
 */
const RECURSOS_POR_MODULO: Readonly<Record<string, readonly string[]>> = {
  compras: [
    "purchase_requests", "rejected_requests", "purchase_quotations", "purchase_authorization",
    "purchase_buy", "purchase_receipts",
    "dashboard.supply",
    "report.supplies", "report.savings", "report.ans", "report.quotations", "report.purchase_forecast",
    "report.supply_sla", "report.purchase_management"
  ],
  estoque: [
    "warehouses", "opening_balances", "invoices", "input_entries", "dfe", "dfe_drafts",
    "stock_writeoffs", "requisitions", "devolutions", "stock_corrections", "warehouse_transfers",
    "farm_transfers", "stocks", "feed_formulas", "feed_batches",
    "dashboard.nutrition_stock",
    "report.stock_movement", "report.requisitions", "report.stock_writeoffs", "report.dfe",
    "report.feed_batch_cost", "report.stocks_abc", "report.receipts", "report.stocks_consolidated",
    "report.stocks_lot_provider", "report.exits_cost_center"
  ],
  financeiro: [
    "opening_movements", "payables", "receivables", "bank_movements", "cash_flow", "ofx_imports",
    "ofx_report", "contracts", "budget_plannings", "financial_freezes", "movement_sheets",
    "dashboard.financial", "dashboard.cash_book",
    "report.payment_schedule", "report.receipt_schedule", "report.payables", "report.paid",
    "report.receivables", "report.received", "report.received_interest", "report.paid_interest",
    "report.ledger", "report.ledger_category", "report.rec_prev_real",
    "report.pag_prev_real", "report.budget_predicted", "report.cash_flow_category",
    "report.cash_flow_forecast", "report.financial_movement", "report.fiscal_difference",
    "report.income_statement", "report.accumulated_income_statement", "report.dre", "report.dre_annual",
    "report.payment_cashflow", "report.receipt_cashflow", "report.cashflow_product", "report.cost_center",
    "report.cost_calculation", "report.financings", "report.advance_titles", "report.account_reconciliation",
    "report.cost_centers_unified", "report.tax_accounts", "report.payable_receivable", "report.provider_balance"
  ],
  vendas: [
    "budgets", "orders", "sales",
    "report.sales_client", "report.sales_product", "report.sales_client_product", "report.sales_employee",
    "report.sales_abc"
  ],
  pecuaria: [
    "animals", "animal_retroactive_costs", "grazing_modules", "batches", "batch_grazing", "batch_area",
    "animals_management", "inventoried_animals", "livestock_plannings", "herd_evolution",
    "animal_batch_transfer", "batch_grouping", "batch_module_area_transfer", "batch_farm_transfer",
    "animal_farm_transfer", "animal_sales", "animal_purchases", "animal_births", "animal_deaths",
    "animal_losses", "processings", "pre_batches", "weighings", "nutritions", "sanitaries", "weanings",
    "separations", "locate_animals", "pastures", "advanced_reproductive", "breeding_seasons",
    "breeding_batches", "breeding_sires", "breeding_protocols", "matings", "pregnancy_diagnosis",
    "rainfalls",
    "dashboard.livestock", "dashboard.rainfall",
    "report.herd_composition", "report.costing_livestock_area", "report.weighing_animal",
    "report.weighing_batch", "report.nutrition_batch", "report.sanitary_batch", "report.management_batch",
    "report.category_animal", "report.transfer_batch_area", "report.animals", "report.application_management",
    "report.animal_movements", "report.weaning", "report.birth", "report.death", "report.animal_record",
    "report.pregnant_cows", "report.animal_sales", "report.animal_purchases", "report.herd_evolution",
    "report.sisbov_identification", "report.sisbov_death", "report.sisbov_birth", "report.costing_batch",
    "report.costing_module", "report.costing_animal", "report.reproduction_cost", "report.batch_profitability",
    "report.reproductive_history", "report.family_tree", "report.bull_efficiency",
    "report.batch_movement_analysis", "report.receiver_productivity", "report.animals_per_batch",
    "report.animal_batch_history", "report.rainfall"
  ],
  confinamento: [
    "feedlot_yards", "feedlot_sectors", "feedlot_corrals", "diets", "feeding_phases", "diet_batches",
    "feed_deliveries", "trough_readings", "feedlot_map",
    "dashboard.feedlot", "dashboard.feedlot_cost", "dashboard.feedlot_performance", "dashboard.feed_consumption",
    "report.feedlot_weighing", "report.feedlot_batch_control", "report.feedlot_planned_consumption",
    "report.feedlot_activity"
  ],
  frota_ativos: [
    "equipments", "depreciations", "depreciation_forecast", "maintenances", "fuel_supplies",
    "preventive_maintenances", "scheduled_reviews", "equipment_transfers",
    "dashboard.assets", "dashboard.depreciation",
    "report.equipment", "report.accumulated_depreciation", "report.machines", "report.machine_supplies",
    "report.machine_maintenances"
  ],
  pessoas_rh: [
    "absences", "salary_advances", "bonuses", "employee_events", "earnings",
    "report.monthly_calculation",
    "report.advances"
  ],
  ordens_servico: ["service_orders"],
  fiscal: [
    "nfe", "xml_files", "mdfe", "nfse", "cash_book", "sped_fiscal", "journal_entries",
    "report.journal_entries", "report.nfe", "report.nfe_product", "report.cash_book"
  ],
  documentos: ["documents"]
};

/**
 * EXCEÇÕES CONSCIENTES — recurso de ORGANIZAÇÃO cuja tabela (ou alguma tabela ligada) tem coluna de empresa.
 * Texto = justificativa auditável; o gate de classificação usa esta lista para não acusar falso positivo.
 */
export const EXCECOES_ESCOPO: Readonly<Record<string, string>> = {
  farms: "A empresa é o próprio registro administrado: quem administra empresas administra a organização (e a lista que o membro enxerga continua recortada pelo escopo dos módulos).",
  cost_centers: "Cadastro da organização; `erp.farm_cost_centers` é o vínculo que diz em quais empresas o centro de custo se aplica, não um lançamento de empresa.",
  proprietaries: "Cadastro da organização; `erp.proprietary_farms` é vínculo de abrangência.",
  authorizers: "Cadastro da organização; `erp.authorizer_farms` é vínculo de abrangência.",
  "report.birthdays": "Aniversariantes e quadro de pessoal saem de `erp.people` + `erp.employee_profiles`, cadastros da ORGANIZAÇÃO sem coluna de empresa: não há empresa a cruzar. Os LANÇAMENTOS de pessoal (apuração, adiantamentos) continuam de empresa, no módulo pessoas_rh.",
  "report.active_employees": "Mesmo caso de report.birthdays: quadro de pessoal ativo é cadastro da organização (erp.people/erp.employee_profiles), sem dimensão de empresa.",
  "report.logged_hours": "Horas registradas saem de `erp.audit_logs` — auditoria de uso do sistema por usuário, da organização inteira, sem coluna de empresa (mesma natureza de dashboard.user_analysis).",
  "report.bank_statement": "Extrato de CONTA bancária: parte do saldo inicial da conta (que não tem empresa) e fecha com o saldo da conta. Recortá-lo por empresa produziria um extrato que não reconcilia — número financeiramente falso. Por isso é documento da organização e a porta exige `bank_accounts.view` além da permissão do relatório.",
  bank_accounts: "Cadastro da organização; `erp.bank_account_farms` é vínculo de abrangência. Os MOVIMENTOS (`erp.bank_movements`) são de empresa, no módulo financeiro.",
  users: "Usuário pertence à organização; o acesso dele às empresas é justamente o que esta missão passa a configurar (o vínculo legado de fazendas do membro era autorização, não dado de negócio).",
  notifications: "A caixa de notificações é PORTA DINÂMICA: `erp.notifications` tem empresa, mas a autorização de cada linha vem da FONTE dela (a solicitação de compra, o documento, o título), não de um módulo \"notificações\" — que, se existisse, seria um segundo caminho para o mesmo dado, com escopo próprio e capaz de divergir do primeiro. Por isso cada linha carrega o módulo e a capacidade da origem (`erp.tipos_notificacao` + `notifications_tipo_fk` impedem combinação não declarada) e a leitura resolve CAPACIDADE ∩ ESCOPO em SQL, via `erp.tem_acesso_empresa`. Ver docs/NOTIFICATION-SCOPE-MATRIX.md."
};

/** Índice recurso → escopo, montado das listas acima (a fonte continua sendo a declaração explícita). */
const ESCOPO_POR_RECURSO: Map<string, EscopoRecurso> = (() => {
  const m = new Map<string, EscopoRecurso>();
  for (const k of RECURSOS_ORGANIZACAO) m.set(k, ORG);
  for (const [modulo, recursos] of Object.entries(RECURSOS_POR_MODULO)) {
    for (const k of recursos) m.set(k, emp(modulo));
  }
  return m;
})();

/** Escopo declarado do RECURSO (`payables`, `report.dre`, …). `undefined` = não classificado (o gate acusa). */
export const escopoDoRecurso = (recurso: string): EscopoRecurso | undefined => ESCOPO_POR_RECURSO.get(recurso);

/** Recurso de uma permission key: a ação é sempre o último segmento (`report.dre.export` → `report.dre`). */
export function recursoDaPermissao(permissao: string): string {
  const i = permissao.lastIndexOf(".");
  return i < 0 ? permissao : permissao.slice(0, i);
}

/** Escopo declarado da PERMISSÃO (`payables.view` → financeiro). */
export const escopoDaPermissao = (permissao: string): EscopoRecurso | undefined => escopoDoRecurso(recursoDaPermissao(permissao));

/**
 * Módulo de escopo empresarial de uma permissão; `null` quando é recurso da organização.
 * Lança em permissão desconhecida: uma porta nova sem classificação não pode virar acesso irrestrito.
 */
export function moduloDaPermissao(permissao: string): string | null {
  const escopo = escopoDaPermissao(permissao);
  if (!escopo) throw new Error(`Permissão sem classificação de escopo: ${permissao}`);
  return escopo.tipo === "empresa" ? escopo.modulo : null;
}

/** Módulos empresariais de um conjunto de permissões (para montar telas e diagnósticos). */
export function modulosDasPermissoes(permissoes: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const p of permissoes) {
    const e = escopoDaPermissao(p);
    if (e?.tipo === "empresa") out.add(e.modulo);
  }
  return [...out].sort();
}

/**
 * GATE DE CLASSIFICAÇÃO (docs/MULTI-COMPANY-CONTRACT.md §7). Lista vazia = catálogo íntegro.
 * Recusa: recurso sem classificação, módulo inexistente, recurso classificado que não existe no catálogo,
 * duplicidade entre módulos e recurso de organização declarado com módulo.
 */
export function validarClassificacaoEscopo(): string[] {
  const problemas: string[] = [];
  const doCatalogo = new Set(PERMISSION_RESOURCES.map((r) => r.key));

  for (const r of PERMISSION_RESOURCES) {
    const escopo = ESCOPO_POR_RECURSO.get(r.key);
    if (!escopo) { problemas.push(`${r.key}: recurso sem classificação de escopo (organização ou empresa+módulo)`); continue; }
    if (escopo.tipo === "empresa" && !moduloEmpresaValido(escopo.modulo)) {
      problemas.push(`${r.key}: módulo de escopo inválido (${escopo.modulo})`);
    }
  }
  for (const k of ESCOPO_POR_RECURSO.keys()) {
    if (!doCatalogo.has(k)) problemas.push(`${k}: classificado mas não existe no catálogo de permissões`);
  }
  const vistos = new Set<string>();
  for (const [modulo, recursos] of Object.entries(RECURSOS_POR_MODULO)) {
    if (!moduloEmpresaValido(modulo)) problemas.push(`módulo declarado fora do catálogo canônico: ${modulo}`);
    for (const k of recursos) {
      if (vistos.has(k)) problemas.push(`${k}: classificado em mais de um módulo`);
      vistos.add(k);
      if (RECURSOS_ORGANIZACAO.includes(k)) problemas.push(`${k}: classificado como organização E como empresa/${modulo}`);
    }
  }
  for (const k of Object.keys(EXCECOES_ESCOPO)) {
    const escopo = ESCOPO_POR_RECURSO.get(k);
    if (!escopo) problemas.push(`exceção documentada para recurso inexistente: ${k}`);
    else if (escopo.tipo !== "organizacao") problemas.push(`${k}: exceção documentada só faz sentido em recurso de organização`);
  }
  const ordens = MODULOS_ESCOPO_EMPRESA.map((m) => m.ordem);
  if (new Set(ordens).size !== ordens.length) problemas.push("módulos com ordem duplicada");
  if (new Set(CHAVES_MODULO_EMPRESA).size !== CHAVES_MODULO_EMPRESA.length) problemas.push("módulos com chave duplicada");
  for (const m of MODULOS_ESCOPO_EMPRESA) {
    if (!/^[a-z][a-z_]*$/.test(m.chave)) problemas.push(`chave de módulo inválida: ${m.chave}`);
  }
  return problemas;
}

/** Resumo da classificação (relatórios e documentação gerada). */
export function resumoClassificacaoEscopo(): { recursos: number; organizacao: number; empresa: number; porModulo: Record<string, number> } {
  const porModulo: Record<string, number> = Object.fromEntries(CHAVES_MODULO_EMPRESA.map((m) => [m, 0]));
  let organizacao = 0; let empresa = 0;
  for (const r of PERMISSION_RESOURCES) {
    const e = ESCOPO_POR_RECURSO.get(r.key);
    if (!e) continue;
    if (e.tipo === "organizacao") organizacao++;
    else { empresa++; porModulo[e.modulo] = (porModulo[e.modulo] ?? 0) + 1; }
  }
  return { recursos: PERMISSION_RESOURCES.length, organizacao, empresa, porModulo };
}

/**
 * Módulo ÚNICO de um conjunto de permissões — para portas cuja permissão varia por LINHA (tipo de
 * movimentação, direção do título, espécie do documento). Todas as variantes da mesma porta precisam
 * pertencer ao mesmo módulo de escopo: se divergirem, a porta não tem um "onde" definido e a classificação
 * está errada. Lança em vez de escolher uma das opções — escolher seria ampliar ou reduzir acesso em silêncio.
 */
export function moduloUnicoDasPermissoes(permissoes: Iterable<string>): string | null {
  const modulos = modulosDasPermissoes(permissoes);
  if (modulos.length > 1) throw new Error(`Permissões da mesma porta em módulos diferentes: ${modulos.join(", ")}`);
  return modulos[0] ?? null;
}
