import type { ResourceDef, FieldDef } from "./types.js";

const active = (name = "is_active"): FieldDef => ({ name, label: "Ativo", type: "boolean", default: true, list: true, filter: true, span: 2 });
const B = (name: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ name, label, type: "boolean", default: false, ...extra });
const T = (name: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ name, label, type: "text", ...extra });
const M = (name: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ name, label, type: "money", ...extra });
const S = (name: string, label: string, options: [string, string][], extra: Partial<FieldDef> = {}): FieldDef => ({ name, label, type: "select", options: options.map(([value, label]) => ({ value, label })), ...extra });
const REF = (name: string, label: string, resource: string, extra: Partial<FieldDef> = {}): FieldDef => ({ name, label, type: "ref", ref: { resource }, ...extra });
const D = (name: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ name, label, type: "date", ...extra });

export const REGISTRY_RESOURCES: ResourceDef[] = [
  {
    key: "cost_centers", label: "Centro de Custo", labelPlural: "Centros de Custo", table: "cost_centers", permission: "cost_centers", labelField: "name", route: "/cadastros/centros-de-custo", tree: true, softDelete: true, printable: true, defaultSort: "code",
    fields: [
      T("code", "Código", { required: true, list: true, search: true, help: "Código hierárquico, ex.: 1.01.001.0001", span: 3 }),
      T("name", "Descrição", { required: true, list: true, search: true, span: 5 }),
      S("kind", "Classe", [["synthetic", "Sintética"], ["analytic", "Analítica"]], { default: "analytic", list: true, span: 2 }),
      S("activity_type", "Tipo", [["custeio", "Custeio"], ["investimento", "Investimento"], ["a_definir", "A definir"]], { span: 2 }),
      REF("parent_id", "Antecessor", "cost_centers", { span: 6 }),
      active()
    ]
  },
  {
    key: "farms", label: "Fazenda", labelPlural: "Fazendas", table: "farms", permission: "farms", labelField: "name", route: "/cadastros/fazendas", softDelete: true, defaultSort: "code",
    fields: [
      { name: "code", label: "Código", type: "integer", readOnly: true, list: true, span: 2 },
      T("name", "Nome", { required: true, list: true, search: true, span: 5 }),
      T("legal_name", "Razão social", { span: 5 }),
      T("document", "CPF/CNPJ", { list: true, search: true, span: 3 }),
      T("state_registration", "Inscrição estadual", { span: 3 }),
      T("address_zip", "CEP", { section: "Endereço", span: 2 }), T("address_street", "Local/Endereço", { section: "Endereço", span: 5 }), T("address_number", "Número", { section: "Endereço", span: 2 }), T("address_district", "Bairro", { section: "Endereço", span: 3 }),
      T("address_city", "Cidade", { section: "Endereço", span: 4 }), T("address_state", "UF", { section: "Endereço", maxLength: 2, span: 2 }),
      { name: "latitude", label: "Latitude", type: "number", section: "Endereço", span: 3 }, { name: "longitude", label: "Longitude", type: "number", section: "Endereço", span: 3 },
      { name: "area_ha", label: "Área Total (ha)", type: "quantity", section: "Dados econômicos", span: 3 },
      active()
    ]
  },
  {
    key: "harvests", label: "Safra", labelPlural: "Safras", table: "harvests", permission: "harvests", labelField: "description", route: "/cadastros/safras", softDelete: true, defaultSort: "start_date",
    fields: [
      T("description", "Descrição", { required: true, list: true, search: true, span: 4 }),
      D("start_date", "Data inicial", { required: true, list: true, span: 2 }), D("end_date", "Data final", { required: true, list: true, span: 2 }),
      S("herd_control", "Controle de rebanho", [["individual", "Individual"], ["batch", "Por lote"]], { default: "individual", span: 2 }),
      B("auto_evolution", "Evolução de rebanho", { default: true, span: 2 }),
      { name: "first_semester_month", label: "Primeiro Semestre (mês)", type: "integer", min: 1, max: 12, span: 2 }, { name: "second_semester_month", label: "Segundo Semestre (mês)", type: "integer", min: 1, max: 12, span: 2 },
      B("is_current", "Safra atual", { list: true, span: 2 }), active()
    ]
  },
  {
    key: "product_groups", label: "Grupo de Produto", labelPlural: "Grupos de Produto", table: "product_groups", permission: "products", labelField: "name", route: "/cadastros/grupos-de-produto",
    fields: [T("name", "Nome", { required: true, list: true, search: true, span: 8 }), active()]
  },
  {
    key: "product_categories", label: "Categoria de Produto", labelPlural: "Categorias de Produto", table: "product_categories", permission: "products", labelField: "name", route: "/cadastros/categorias-de-produto",
    fields: [REF("group_id", "Grupo", "product_groups", { required: true, list: true, filter: true, span: 4 }), T("name", "Nome", { required: true, list: true, search: true, span: 6 }), active()]
  },
  {
    key: "product_kinds", label: "Classe de Produto", labelPlural: "Classes de Produto", table: "product_kinds", permission: "products", labelField: "name", route: "/cadastros/classes-de-produto",
    fields: [REF("category_id", "Categoria", "product_categories", { required: true, list: true, filter: true, span: 4 }), T("name", "Nome", { required: true, list: true, search: true, span: 6 }), active()]
  },
  {
    key: "measurement_units", label: "Unidade de Medida", labelPlural: "Unidades de Medida", table: "measurement_units", permission: "products", labelField: "symbol", route: "/cadastros/unidades", sharedDefaults: true,
    fields: [T("symbol", "Sigla", { required: true, list: true, search: true, span: 2 }), T("name", "Nome", { required: true, list: true, search: true, span: 6 }), { name: "decimals", label: "Casas decimais", type: "integer", default: 2, min: 0, max: 6, span: 2 }]
  },
  {
    key: "addressings", label: "Endereçamento", labelPlural: "Endereçamentos", table: "addressings", permission: "addressings", labelField: "description", route: "/cadastros/enderecamentos", tree: true, softDelete: true,
    fields: [T("description", "Descrição", { required: true, list: true, search: true, span: 6 }), REF("parent_id", "Endereçamento pai", "addressings", { list: true, span: 6 })]
  },
  {
    key: "warehouses", label: "Armazém", labelPlural: "Armazéns", table: "warehouses", permission: "warehouses", labelField: "description", route: "/cadastros/armazens", softDelete: true, farmScoped: true,
    fields: [
      REF("farm_id", "Fazenda", "farms", { required: true, list: true, filter: true, span: 4 }),
      T("initials", "Sigla", { required: true, list: true, search: true, span: 2 }), T("description", "Descrição", { required: true, list: true, search: true, span: 4 }),
      S("type", "Tipo", [["inputs", "Insumos"], ["production", "Produção"], ["formulation", "Formulação"]], { required: true, default: "inputs", list: true, filter: true, span: 2 }), active()
    ]
  },
  {
    key: "cultivations", label: "Variedade/Cultura", labelPlural: "Variedades/Culturas", table: "cultivations", permission: "products", labelField: "variety", route: "/cadastros/variedades",
    fields: [T("crop", "Cultura", { required: true, list: true, search: true, span: 5 }), T("variety", "Variedade", { required: true, list: true, search: true, span: 5 }), active()]
  },
  {
    key: "products", label: "Produto", labelPlural: "Produtos", table: "products", permission: "products", labelField: "description", route: "/cadastros/produtos", softDelete: true, codeEntity: "product", printable: true, importExport: true, defaultSort: "description",
    fields: [
      T("code", "Código", { readOnly: true, list: true, search: true, span: 2 }),
      T("description", "Descrição", { required: true, list: true, search: true, maxLength: 120, help: "Nome do produto que está sendo cadastrado", span: 6 }),
      T("reference", "Cod. Produto (fornecedor)", { search: true, span: 2 }), T("barcode", "Código de barras", { span: 2 }),
      T("ncm_code", "NCM", { list: true, help: "Nomenclatura Comum do Mercosul (8 dígitos)", maxLength: 8, span: 3 }),
      REF("measurement_id", "1ª Un. Medida", "measurement_units", { required: true, span: 3 }), REF("second_measurement_id", "2ª Un. Medida", "measurement_units", { span: 2 }),
      S("factor_type", "Tipo de conversão", [["multiply", "Multiplica"], ["divide", "Divide"]], { help: "Quando converte de uma unidade maior para menor, multiplica; caso contrário divide.", span: 2 }),
      { name: "factor", label: "Fator conversão", type: "quantity", span: 2 },
      REF("group_id", "Grupo", "product_groups", { required: true, list: true, filter: true, section: "Classificação", span: 4 }),
      REF("category_id", "Categoria", "product_categories", { required: true, list: true, filter: true, section: "Classificação", span: 4 }),
      REF("kind_id", "Classe", "product_kinds", { required: true, list: true, filter: true, section: "Classificação", span: 4 }),
      REF("cultivation_id", "Variedade", "cultivations", { section: "Classificação", span: 4 }), T("quality", "Qualidade", { section: "Classificação", span: 2 }), T("active_principle", "Princípio ativo", { search: true, section: "Classificação", span: 6 }),
      B("has_lot", "Controla Lote/Validade", { section: "Estoque", help: "Ao ativar, o sistema controla lotes e alerta sobre validade", filter: true, span: 3 }),
      B("control_stock", "Controla estoque", { default: true, section: "Estoque", help: "Gerencia o produto no estoque e calcula custo médio automaticamente", span: 3 }),
      { name: "min_stock", label: "Estoque mínimo", type: "quantity", section: "Estoque", list: true, help: "Alerta quando o estoque atingir ou ficar abaixo", span: 3 },
      M("reference_price", "Valor de referência", { section: "Estoque", help: "Valor de mercado do produto", span: 3 }),
      { name: "average_cost", label: "Custo médio (calculado)", type: "money", readOnly: true, section: "Estoque", span: 3 }, D("last_purchase_date", "Última compra", { readOnly: true, section: "Estoque", span: 3 }),
      REF("financial_category_id", "Categoria financeira (custo)", "financial_categories", { section: "Estoque", help: "Obrigatória quando o produto controla estoque", span: 6 }),
      REF("default_cost_center_id", "Centro de custo padrão", "cost_centers", { section: "Estoque", span: 4 }), REF("default_warehouse_id", "Armazém padrão", "warehouses", { section: "Estoque", span: 4 }), REF("addressing_id", "Endereçamento", "addressings", { section: "Estoque", span: 4 }),
      { name: "withdrawal_period_days", label: "Período de Carência (dias)", type: "integer", section: "Estoque", help: "Dias de espera após aplicação antes de vender/abater o animal", span: 3 },
      B("allow_pointing", "Apontamento", { section: "Estoque", help: "Permite uso na aba de apontamentos", span: 3 }),
      B("is_equipment", "Adiciona ao Inventário", { section: "Estoque", help: "Cadastra automaticamente no inventário de bens", filter: true, span: 3 }),
      B("is_fiscal", "Emitir NFe", { section: "Fiscal", span: 3 }), REF("tax_rule_id", "Regra fiscal", "tax_rules", { section: "Fiscal", span: 5 }),
      { name: "taxes", label: "Parâmetros fiscais (CFOP, CST, alíquotas, IBS/CBS)", type: "json", section: "Fiscal", span: 12 },
      active()
    ]
  },
  {
    key: "apportionment_categories", label: "Categoria de Rateio", labelPlural: "Categorias de Rateio", table: "apportionment_categories", permission: "apportionments", labelField: "name", route: "/cadastros/rateios", softDelete: true,
    fields: [T("name", "Nome", { required: true, list: true, search: true, span: 8 }), active()]
  },
  {
    key: "financial_categories", label: "Categoria Financeira", labelPlural: "Categorias Financeiras", table: "financial_categories", permission: "financial_categories", labelField: "name", route: "/cadastros/categorias-financeiras", tree: true, softDelete: true, printable: true, defaultSort: "code",
    fields: [
      T("code", "Código", { required: true, list: true, search: true, span: 3 }), T("name", "Descrição", { required: true, list: true, search: true, span: 5 }),
      S("nature", "Natureza", [["income", "Receita"], ["expense", "Despesa"], ["both", "Ambas"]], { required: true, list: true, filter: true, span: 2 }),
      S("kind", "Classe", [["synthetic", "Sintética"], ["analytic", "Analítica"]], { default: "analytic", list: true, span: 2 }),
      S("classification", "Classificação", [["unclassified", "Não Classificado"], ["capex", "CAPEX"], ["opex", "OPEX"]], { span: 3 }),
      B("is_tax", "É tributo?", { span: 2 }), REF("parent_id", "Antecessor", "financial_categories", { span: 5 }), active()
    ]
  },
  {
    key: "chart_accounts", label: "Conta do Plano", labelPlural: "Plano de Contas", table: "chart_accounts", permission: "chart_accounts", labelField: "description", route: "/cadastros/plano-de-contas", tree: true, softDelete: true, defaultSort: "code",
    fields: [
      T("code", "Código", { required: true, list: true, search: true, span: 3 }), T("description", "Descrição", { required: true, list: true, search: true, span: 5 }),
      S("condition", "Condição", [["debit", "Débito"], ["credit", "Crédito"], ["both", "Ambos"]], { required: true, list: true, span: 2 }),
      S("kind", "Classe", [["synthetic", "Sintética"], ["analytic", "Analítica"]], { required: true, list: true, span: 2 }),
      S("type", "Tipo", [["capex", "CAPEX"], ["opex", "OPEX"]], { span: 3 }), REF("parent_id", "Antecessor", "chart_accounts", { span: 5 }), active()
    ]
  },
  {
    key: "tax_rules", label: "Regra Fiscal", labelPlural: "Regras Fiscais", table: "tax_rules", permission: "tax_rules", labelField: "name", route: "/cadastros/regras-fiscais", softDelete: true,
    fields: [
      T("name", "Descrição", { required: true, list: true, search: true, span: 6 }), active(), T("cbenef", "Código de benefício fiscal", { span: 3 }),
      T("cfop_out_internal", "CFOP Saída Interno", { required: true, span: 3 }), T("cfop_out_external", "CFOP Saída Externo", { required: true, span: 3 }),
      T("cst_csosn", "CST/CSOSN", { section: "Tributos", span: 2 }), T("cst_pis", "CST PIS", { section: "Tributos", span: 2 }), T("cst_cofins", "CST COFINS", { section: "Tributos", span: 2 }), T("cst_ipi", "CST IPI", { section: "Tributos", span: 2 }), T("cenq_ipi", "Enquadramento IPI", { section: "Tributos", span: 2 }),
      { name: "perc_icms", label: "% ICMS", type: "percent", section: "Tributos", span: 2 }, { name: "perc_pis", label: "% PIS", type: "percent", section: "Tributos", span: 2 }, { name: "perc_cofins", label: "% COFINS", type: "percent", section: "Tributos", span: 2 }, { name: "perc_ipi", label: "% IPI", type: "percent", section: "Tributos", span: 2 },
      T("cest", "CEST", { section: "Tributos", span: 2 }), { name: "percent_reduction", label: "% Redução BC", type: "percent", section: "Tributos", span: 2 },
      S("modality_bc", "Modalidade BC ICMS", [["0", "0 - Margem Valor Agregado"], ["1", "1 - Pauta"], ["2", "2 - Preço Tabelado Máx."], ["3", "3 - Valor da operação"]], { section: "Tributos", span: 4 }),
      S("origin", "Origem", [["0", "0 - Nacional"], ["1", "1 - Estrangeira (importação direta)"], ["2", "2 - Estrangeira (mercado interno)"], ["3", "3 - Nacional >40% importado"], ["4", "4 - Nacional PPB"], ["5", "5 - Nacional ≤40% importado"], ["6", "6 - Estrangeira sem similar nacional (CAMEX)"], ["7", "7 - Estrangeira (mercado interno) sem similar nacional"]], { section: "Tributos", span: 4 }),
      T("cst_csosn_export", "CST/CSOSN Exportação", { section: "Tributos", span: 2 }),
      { name: "reform", label: "Reforma tributária (IBS/CBS/IS)", type: "json", section: "Reforma Tributária", span: 12 }
    ]
  },
  {
    key: "nature_operations", label: "Natureza de Operação", labelPlural: "Naturezas de Operação", table: "nature_operations", permission: "nature_operations", labelField: "description", route: "/cadastros/naturezas-de-operacao", softDelete: true,
    fields: [
      T("description", "Descrição", { required: true, list: true, search: true, span: 5 }), S("type", "Tipo", [["out", "Saída"], ["in", "Entrada"]], { required: true, list: true, filter: true, span: 2 }), active(),
      T("cfop_out_internal", "CFOP saída interno", { required: true, span: 2 }), T("cfop_out_external", "CFOP saída externo", { required: true, span: 2 }), T("cfop_in_internal", "CFOP entrada interno", { required: true, span: 2 }), T("cfop_in_external", "CFOP entrada externo", { required: true, span: 2 }), T("cfop_out_export", "CFOP saída exportação", { span: 2 }), T("cfop_in_export", "CFOP entrada exportação", { span: 2 }),
      B("overrides_product_cfop", "Sobrescreve CFOP do produto", { span: 3 }), B("overrides_product_info", "Sobrescreve informações do produto", { span: 3 }), B("skip_financial", "Não gerar financeiro", { span: 3 }), B("auto_icms", "Cálculo ICMS automático", { span: 3 }),
      REF("tax_rule_id", "Regra fiscal", "tax_rules", { span: 4 }), REF("additional_info_id", "Info. Complementares", "additional_infos", { span: 4 }),
      { name: "taxes", label: "Tributos (CST/alíquotas/reforma)", type: "json", span: 12 }
    ]
  },
  {
    key: "additional_infos", label: "Informação Complementar", labelPlural: "Informações Complementares", table: "additional_infos", permission: "additional_infos", labelField: "description", route: "/cadastros/informacoes-complementares", softDelete: true,
    fields: [T("description", "Descrição", { required: true, list: true, search: true, span: 6 }), active(), { name: "info", label: "Informações Complementares", type: "textarea", span: 12 }]
  },
  {
    key: "job_functions", label: "Função", labelPlural: "Funções", table: "job_functions", permission: "job_functions", labelField: "name", route: "/gestao-pessoal/funcoes", softDelete: true,
    fields: [T("name", "Nome", { required: true, list: true, search: true, span: 4 }), T("cbo_code", "CBO", { list: true, span: 2 }), M("base_salary", "Salário base", { required: true, list: true, span: 2 }), { name: "monthly_hours", label: "Horas mensais", type: "integer", required: true, default: 220, span: 2 }, M("hour_value", "Valor da hora", { required: true, span: 2 }), active(), { name: "description", label: "Descrição", type: "textarea", required: true, span: 12 }]
  },
  {
    key: "teams", label: "Equipe", labelPlural: "Equipes", table: "teams", permission: "teams", labelField: "name", route: "/gestao-pessoal/equipes", softDelete: true,
    fields: [T("name", "Nome", { required: true, list: true, search: true, span: 5 }), REF("leader_person_id", "Encarregado", "people", { required: true, list: true, span: 5 }), active(), { name: "description", label: "Descrição", type: "textarea", span: 12 }]
  },
  {
    key: "hr_events", label: "Evento", labelPlural: "Eventos", table: "hr_events", permission: "hr_events", labelField: "name", route: "/gestao-pessoal/eventos", softDelete: true,
    fields: [
      T("name", "Nome", { required: true, list: true, search: true, span: 4 }),
      S("periodicity", "Tipo", [["weekly", "Semanal"], ["biweekly", "Quinzenal"], ["monthly", "Mensal"], ["quarterly", "Trimestral"], ["semiannual", "Semestral"]], { required: true, list: true, span: 2 }),
      S("method", "Método", [["informed", "Informado"], ["fixed", "Fixo"]], { required: true, list: true, span: 2 }),
      S("condition", "Estado", [["add", "Soma"], ["subtract", "Diminui"]], { required: true, list: true, span: 2 }),
      active(), B("is_quick_entry", "Entrada Rápida (Grade)", { span: 3 }), { name: "quick_entry_order", label: "Ordem", type: "integer", span: 2 }
    ]
  },
  {
    key: "document_types", label: "Tipo de Documento", labelPlural: "Tipos de Documento", table: "document_types", permission: "document_types", labelField: "name", route: "/documentos/tipos", tree: true, softDelete: true,
    fields: [T("name", "Nome", { required: true, list: true, search: true, span: 5 }), { name: "position", label: "Ordem", type: "integer", required: true, default: 0, list: true, span: 2 }, active(), REF("parent_id", "Antecessor", "document_types", { span: 5 })]
  },
  {
    key: "documents", label: "Documento", labelPlural: "Documentos", table: "documents", permission: "documents", labelField: "title", route: "/documentos", softDelete: true, farmScopedNulo: true,
    fields: [
      REF("farm_id", "Fazenda", "farms", { list: true, filter: true, span: 4 }), REF("document_type_id", "Tipo", "document_types", { required: true, list: true, filter: true, span: 4 }),
      T("title", "Título", { required: true, list: true, search: true, span: 4 }), D("issue_date", "Emissão", { list: true, span: 3 }), D("expiration_date", "Vencimento", { list: true, filter: true, span: 3 }),
      S("status", "Situação", [["active", "Ativo"], ["expired", "Vencido"], ["archived", "Arquivado"]], { default: "active", list: true, filter: true, span: 3 }),
      { name: "description", label: "Descrição", type: "textarea", span: 12 }
    ]
  },
  {
    key: "operations", label: "Operação", labelPlural: "Operações", table: "operations", permission: "operations", labelField: "name", route: "/cadastros/operacoes", softDelete: true,
    fields: [T("name", "Nome", { required: true, list: true, search: true, span: 4 }), { name: "position", label: "Ordem", type: "integer", required: true, default: 0, list: true, span: 2 }, REF("grouper_id", "Agrupador", "operations", { span: 4 }), S("use_in", "Uso", [["both", "Ambos"], ["agriculture", "Agricultura"], ["livestock", "Pecuária"]], { required: true, default: "both", list: true, span: 2 }), active(), { name: "description", label: "Descrição", type: "textarea", span: 12 }]
  },
  {
    key: "activities", label: "Atividade", labelPlural: "Atividades", table: "activities", permission: "activities", labelField: "name", route: "/cadastros/atividades", softDelete: true,
    fields: [T("name", "Nome", { required: true, list: true, search: true, span: 4 }), M("value_per_hectare", "Valor por hectare", { required: true, list: true, span: 2 }), S("use_in", "Uso", [["both", "Ambos"], ["agriculture", "Agricultura"], ["fruit", "Fruticultura"], ["beef", "Pecuária de Corte"]], { required: true, default: "both", list: true, span: 2 }), S("type", "Tipo", [["custeio", "Custeio"], ["investimento", "Investimento"], ["a_definir", "A definir"]], { required: true, default: "custeio", list: true, span: 2 }), active(), { name: "description", label: "Descrição", type: "textarea", span: 12 }]
  },
  {
    key: "bank_accounts", label: "Conta Bancária", labelPlural: "Contas Bancárias", table: "bank_accounts", permission: "bank_accounts", labelField: "description", route: "/cadastros/contas-bancarias", softDelete: true,
    fields: [
      T("code", "Sigla", { required: true, list: true, search: true, span: 2 }), T("description", "Descrição", { required: true, list: true, search: true, span: 4 }),
      S("type", "Tipo", [["checking", "Conta Corrente"], ["savings", "Conta Poupança"], ["investment", "Aplicação Financeira"], ["cash", "Caixa Interno (Espécie)"]], { required: true, list: true, filter: true, span: 3 }),
      T("bank_code", "Banco (código)", { list: true, span: 2 }), T("agency", "Agência", { list: true, span: 2 }), T("account_number", "Conta", { list: true, span: 2 }),
      M("opening_balance", "Saldo inicial", { help: "Saldo de abertura; o saldo atual é calculado pelos movimentos", span: 2 }), M("credit_limit", "Limite", { span: 2 }),
      B("use_cash_book", "Usa no Livro Caixa", { span: 2 }), B("issues_boleto", "Emite boleto", { span: 2 }),
      T("boleto_wallet", "Carteira", { visibleWhen: { field: "issues_boleto", equals: true }, span: 2 }), T("boleto_agreement", "Convênio/Cod. Beneficiário", { visibleWhen: { field: "issues_boleto", equals: true }, span: 3 }),
      S("cnab_type", "Tipo do boleto", [["240", "CNAB 240"], ["400", "CNAB 400"]], { visibleWhen: { field: "issues_boleto", equals: true }, span: 2 }),
      REF("investment_account_id", "Conta de investimento vinculada", "bank_accounts", { span: 4 }), active()
    ]
  },
  {
    key: "title_types", label: "Tipo de Título", labelPlural: "Tipos de Título", table: "title_types", permission: "payables", labelField: "name", route: "/cadastros/tipos-de-titulo", sharedDefaults: true,
    fields: [T("name", "Nome", { required: true, list: true, search: true, span: 6 }), B("is_advance", "É adiantamento", { list: true, span: 3 })]
  },
  {
    key: "payment_methods", label: "Forma de Pagamento", labelPlural: "Formas de Pagamento", table: "payment_methods", permission: "sales", labelField: "name", route: "/cadastros/formas-de-pagamento", sharedDefaults: true,
    fields: [T("name", "Nome", { required: true, list: true, search: true, span: 6 }), active()]
  },
  {
    key: "equipment_families", label: "Família de Bem", labelPlural: "Famílias de Bens", table: "equipment_families", permission: "equipments", labelField: "name", route: "/cadastros/familias-de-bens", sharedDefaults: true,
    fields: [T("name", "Nome", { required: true, list: true, search: true, span: 5 }), { name: "default_life_years", label: "Vida útil padrão (anos)", type: "integer", list: true, span: 3 }, { name: "default_depreciation_percent", label: "Depreciação padrão (%)", type: "percent", list: true, span: 3 }]
  },
  {
    key: "equipments", label: "Bem/Equipamento", labelPlural: "Inventário de Bens", table: "equipments", permission: "equipments", labelField: "description", route: "/cadastros/inventario", softDelete: true, farmScoped: true, codeEntity: "equipment", printable: true,
    fields: [
      T("code", "Código", { readOnly: true, list: true, search: true, span: 2 }), T("description", "Descrição", { required: true, list: true, search: true, span: 6 }), REF("farm_id", "Fazenda", "farms", { required: true, list: true, filter: true, span: 4 }),
      REF("family_id", "Família do bem", "equipment_families", { required: true, list: true, filter: true, span: 4 }), S("equipment_type", "Tipo", [["own", "Próprio"], ["outsourced", "Terceirizado"]], { span: 2 }), REF("proprietary_id", "Proprietário gestor", "people", { span: 3 }),
      S("status", "Situação", [["active", "Ativo"], ["inactive", "Inativo"], ["sold", "Vendido"], ["written_off", "Baixado"]], { default: "active", list: true, filter: true, span: 3 }),
      M("hour_value", "Valor por hora/km", { required: true, span: 2 }), { name: "hour_meter", label: "Horímetro/Km", type: "quantity", span: 2 }, T("year_model", "Ano/modelo", { required: true, span: 2 }), T("brand", "Marca", { span: 2 }), T("model", "Modelo", { span: 2 }), T("patrimony", "Patrimônio", { span: 2 }),
      T("chassis", "Chassi", { section: "Veículo", span: 3 }), T("renavam", "RENAVAM", { section: "Veículo", span: 2 }), T("serial_number", "Série", { section: "Veículo", span: 2 }), T("plate", "Placa", { section: "Veículo", span: 2 }), T("plate_state", "UF", { section: "Veículo", maxLength: 2, span: 1 }), T("color", "Cor", { section: "Veículo", span: 2 }),
      { name: "vehicle", label: "Dados MDFe (RNTRC, carroceria, rodado, tara, capacidade, proprietário)", type: "json", section: "Veículo", span: 12 },
      B("has_depreciation", "Tem depreciação", { section: "Depreciação", span: 2 }), M("acquisition_value", "Valor de aquisição/construção", { required: true, section: "Depreciação", span: 3 }), D("acquisition_date", "Data de aquisição", { section: "Depreciação", span: 2 }),
      S("depreciation_type", "Tipo de depreciação", [["with_residual", "Com valor residual"], ["without_residual", "Sem valor residual"]], { section: "Depreciação", span: 3 }), { name: "residual_percent", label: "Residual (%)", type: "percent", section: "Depreciação", span: 2 },
      { name: "life_years", label: "Vida útil (anos)", type: "quantity", section: "Depreciação", span: 2 }, { name: "depreciation_percent", label: "Depreciação (%)", type: "percent", section: "Depreciação", span: 2 },
      M("residual_value", "Valor residual", { section: "Depreciação", readOnly: true, span: 2 }), M("depreciable_value", "Valor a depreciar", { section: "Depreciação", readOnly: true, span: 2 }), M("depreciated_value", "Valor depreciado", { section: "Depreciação", readOnly: true, span: 2 }),
      REF("provider_id", "Fornecedor", "people", { section: "Outros", span: 4 }), REF("product_id", "Produto", "products", { section: "Outros", span: 4 }), B("use_fiscal", "Usa fiscal", { section: "Outros", span: 2 }),
      { name: "features", label: "Listar em funcionalidades", type: "tags", options: [{ value: "supply", label: "Abastecimento" }, { value: "maintenance", label: "Manutenção" }, { value: "batch", label: "Batelada" }, { value: "pointing", label: "Apontamento" }], section: "Outros", span: 6 },
      { name: "specification", label: "Especificação", type: "textarea", section: "Outros", span: 12 }
    ]
  },
  {
    key: "fodders", label: "Forragem", labelPlural: "Forragens", table: "fodders", permission: "fodders", labelField: "description", route: "/pecuaria/forragens", softDelete: true,
    fields: [T("description", "Descrição", { required: true, list: true, search: true, span: 6 }), active()]
  },
  {
    key: "weight_parameters", label: "Parâmetro de Peso", labelPlural: "Parâmetros/Peso", table: "weight_parameters", permission: "weight_parameters", labelField: "description", route: "/pecuaria/parametros-peso", softDelete: true, codeEntity: "weight_parameter",
    fields: [T("code", "Código", { readOnly: true, list: true, span: 2 }), D("param_date", "Data", { required: true, list: true, span: 2 }), T("responsible", "Responsável", { span: 3 }), T("description", "Descrição", { required: true, list: true, search: true, span: 5 }), { name: "initial_weight", label: "Peso Inicial (kg)", type: "quantity", required: true, list: true, span: 3 }, { name: "final_weight", label: "Peso Final (kg)", type: "quantity", required: true, list: true, span: 3 }]
  },
  {
    key: "animal_species", label: "Espécie", labelPlural: "Espécies", table: "animal_species", permission: "animals", labelField: "name", route: "/pecuaria/especies", sharedDefaults: true,
    fields: [T("name", "Nome", { required: true, list: true, search: true, span: 6 })]
  },
  {
    key: "animal_categories", label: "Categoria Animal", labelPlural: "Categorias de Animais", table: "animal_categories", permission: "animals", labelField: "name", route: "/pecuaria/categorias", sharedDefaults: true,
    fields: [REF("species_id", "Espécie", "animal_species", { required: true, list: true, filter: true, span: 3 }), T("name", "Nome", { required: true, list: true, search: true, span: 4 }), S("sex", "Sexo", [["M", "Macho"], ["F", "Fêmea"]], { list: true, span: 2 }), { name: "min_age_months", label: "Idade mínima (meses)", type: "integer", span: 2 }, { name: "max_age_months", label: "Idade máxima (meses)", type: "integer", span: 2 }, { name: "ua_factor", label: "Fator UA", type: "quantity", default: 1, span: 2 }, REF("next_category_id", "Próxima categoria (evolução)", "animal_categories", { span: 4 })]
  },
  {
    key: "breeds", label: "Raça", labelPlural: "Raças", table: "breeds", permission: "animals", labelField: "name", route: "/pecuaria/racas", sharedDefaults: true,
    fields: [REF("species_id", "Espécie", "animal_species", { list: true, filter: true, span: 4 }), T("name", "Nome", { required: true, list: true, search: true, span: 6 })]
  },
  {
    key: "identification_types", label: "Tipo de Identificação", labelPlural: "Tipos de Identificação", table: "identification_types", permission: "animals", labelField: "name", route: "/pecuaria/tipos-identificacao", sharedDefaults: true,
    fields: [T("name", "Nome", { required: true, list: true, search: true, span: 6 })]
  },
  {
    key: "grazing_modules", label: "Módulo de Pastejo", labelPlural: "Módulos de Pastejo", table: "grazing_modules", permission: "grazing_modules", labelField: "description", route: "/pecuaria/modulos-pastejo", softDelete: true, farmScoped: true, codeEntity: "grazing_module",
    fields: [T("code", "Código", { readOnly: true, list: true, span: 2 }), REF("farm_id", "Fazenda", "farms", { required: true, list: true, filter: true, span: 4 }), D("module_date", "Data de cadastro", { required: true, span: 2 }), T("responsible", "Responsável", { span: 4 }), T("description", "Descrição", { required: true, list: true, search: true, span: 6 }), REF("fodder_id", "Forragem", "fodders", { required: true, list: true, span: 3 }), T("color", "Cor do módulo", { span: 2 }), B("control_productivity", "Controla produtividade", { span: 3 })]
  },
  {
    key: "areas", label: "Área (Piquete)", labelPlural: "Áreas", table: "areas", permission: "batch_area", labelField: "name", route: "/pecuaria/areas", softDelete: true, farmScoped: true,
    fields: [REF("farm_id", "Fazenda", "farms", { required: true, list: true, filter: true, span: 4 }), T("code", "Código", { required: true, list: true, search: true, span: 2 }), T("name", "Nome", { required: true, list: true, search: true, span: 4 }), { name: "area_ha", label: "Área (ha)", type: "quantity", required: true, list: true, span: 2 }, REF("grazing_module_id", "Módulo de pastejo", "grazing_modules", { list: true, filter: true, span: 4 }), REF("fodder_id", "Forragem", "fodders", { span: 4 }), active()]
  },
  {
    key: "troughs", label: "Cocho", labelPlural: "Cochos", table: "troughs", permission: "troughs", labelField: "description", route: "/pecuaria/cochos", softDelete: true, codeEntity: "trough",
    fields: [T("code", "Código", { readOnly: true, list: true, span: 2 }), S("type", "Tipo", [["covered", "Coberto"], ["uncovered", "Descoberto"], ["drinker", "Bebedouro"]], { required: true, list: true, filter: true, span: 2 }), T("description", "Descrição", { required: true, list: true, search: true, span: 4 }), { name: "length_cm", label: "Área (cm)", type: "quantity", span: 2 }, REF("grazing_module_id", "Módulo de pastejo", "grazing_modules", { span: 4 }), REF("area_id", "Área", "areas", { list: true, span: 4 }), REF("corral_id", "Curral", "feedlot_corrals", { span: 4 }), active()]
  },
  {
    key: "batches", label: "Lote", labelPlural: "Lotes de Animais", table: "batches", permission: "batches", labelField: "description", route: "/pecuaria/lotes", softDelete: true, farmScoped: true, codeEntity: "batch",
    fields: [
      T("code", "Código", { readOnly: true, list: true, span: 2 }), REF("farm_id", "Fazenda", "farms", { required: true, list: true, filter: true, span: 4 }), D("batch_date", "Data", { required: true, list: true, span: 2 }), T("responsible", "Responsável", { span: 4 }),
      T("description", "Descrição", { required: true, list: true, search: true, span: 6 }), REF("species_id", "Espécie", "animal_species", { required: true, span: 3 }), REF("weight_parameter_id", "Peso (parâmetro)", "weight_parameters", { span: 3 }),
      S("batch_type", "Tipo", [["pasture", "Pasto"], ["feedlot", "Confinamento"], ["breeding", "Reprodução"], ["pre_batch", "Pré-lote"]], { default: "pasture", list: true, filter: true, span: 3 }),
      REF("grazing_module_id", "Módulo", "grazing_modules", { list: true, span: 3 }), REF("area_id", "Área", "areas", { list: true, span: 3 }), REF("corral_id", "Curral", "feedlot_corrals", { span: 3 }),
      REF("diet_id", "Dieta", "diets", { span: 3 }), REF("feeding_phase_id", "Fase alimentar", "feeding_phases", { span: 3 }), D("entry_date", "Entrada", { span: 2 }), D("exit_date", "Saída", { span: 2 }),
      S("status", "Situação", [["active", "Ativo"], ["closed", "Encerrado"]], { default: "active", list: true, filter: true, span: 2 })
    ]
  },
  {
    key: "feedlot_yards", label: "Pátio", labelPlural: "Pátios", table: "feedlot_yards", permission: "feedlot_yards", labelField: "name", route: "/confinamento/patios", softDelete: true, farmScoped: true,
    fields: [REF("farm_id", "Fazenda", "farms", { required: true, list: true, filter: true, span: 4 }), T("code", "Código", { required: true, list: true, span: 2 }), T("name", "Nome", { required: true, list: true, search: true, span: 4 }), active()]
  },
  {
    key: "feedlot_sectors", label: "Setor", labelPlural: "Setores", table: "feedlot_sectors", permission: "feedlot_sectors", labelField: "name", route: "/confinamento/setores", softDelete: true,
    fields: [REF("yard_id", "Pátio", "feedlot_yards", { required: true, list: true, filter: true, span: 4 }), T("code", "Código", { required: true, list: true, span: 2 }), T("name", "Nome", { required: true, list: true, search: true, span: 4 }), active()]
  },
  {
    key: "feedlot_corrals", label: "Curral", labelPlural: "Currais", table: "feedlot_corrals", permission: "feedlot_corrals", labelField: "name", route: "/confinamento/currais", softDelete: true,
    fields: [REF("sector_id", "Setor", "feedlot_sectors", { required: true, list: true, filter: true, span: 4 }), T("code", "Código", { required: true, list: true, span: 2 }), T("name", "Nome", { required: true, list: true, search: true, span: 3 }), { name: "capacity", label: "Capacidade (cab.)", type: "integer", required: true, list: true, span: 2 }, { name: "area_m2", label: "Área (m²)", type: "quantity", span: 2 }, active()]
  },
  {
    key: "diets", label: "Dieta", labelPlural: "Dietas", table: "diets", permission: "diets", labelField: "name", route: "/confinamento/dietas", softDelete: true, codeEntity: "diet",
    fields: [T("code", "Código", { readOnly: true, list: true, span: 2 }), T("name", "Nome", { required: true, list: true, search: true, span: 5 }), { name: "dry_matter_percent", label: "% Matéria Seca", type: "percent", list: true, span: 2 }, M("cost_per_kg", "Custo/kg (calculado)", { readOnly: true, list: true, span: 2 }), active(), { name: "description", label: "Descrição", type: "textarea", span: 12 }]
  },
  {
    key: "feeding_phases", label: "Fase Alimentar", labelPlural: "Fases/Regras de Troca", table: "feeding_phases", permission: "feeding_phases", labelField: "name", route: "/confinamento/fases", softDelete: true,
    fields: [T("name", "Nome", { required: true, list: true, search: true, span: 4 }), REF("diet_id", "Dieta", "diets", { list: true, span: 4 }), { name: "days_in_phase", label: "Dias na fase", type: "integer", list: true, span: 2 }, REF("next_phase_id", "Próxima fase", "feeding_phases", { span: 4 }), { name: "rules", label: "Regras de troca (JSON)", type: "json", span: 12 }, active()]
  },
  {
    key: "breeding_seasons", label: "Estação de Monta", labelPlural: "Estações de Monta", table: "breeding_seasons", permission: "breeding_seasons", labelField: "name", route: "/pecuaria/reproducao/estacoes", softDelete: true, farmScoped: true, codeEntity: "breeding_season",
    fields: [T("code", "Código", { readOnly: true, list: true, span: 2 }), REF("farm_id", "Fazenda", "farms", { required: true, list: true, filter: true, span: 4 }), T("name", "Nome", { required: true, list: true, search: true, span: 4 }), D("start_date", "Início", { required: true, list: true, span: 2 }), D("end_date", "Fim", { required: true, list: true, span: 2 }), S("status", "Situação", [["open", "Aberta"], ["closed", "Encerrada"]], { default: "open", list: true, filter: true, span: 2 })]
  },
  {
    key: "breeding_protocols", label: "Protocolo", labelPlural: "Protocolos/Estação", table: "breeding_protocols", permission: "breeding_protocols", labelField: "name", route: "/pecuaria/reproducao/protocolos",
    fields: [REF("season_id", "Estação de monta", "breeding_seasons", { required: true, list: true, filter: true, span: 4 }), T("name", "Nome", { required: true, list: true, search: true, span: 5 }), { name: "description", label: "Descrição", type: "textarea", span: 12 }, { name: "steps", label: "Etapas (dia, hormônio/ação)", type: "json", span: 12 }]
  },
  {
    key: "breeding_sires", label: "Touro/Sêmen/Embrião", labelPlural: "Touros/Sêmen/Embrião", table: "breeding_sires", permission: "breeding_sires", labelField: "name", route: "/pecuaria/reproducao/touros",
    fields: [REF("season_id", "Estação de monta", "breeding_seasons", { required: true, list: true, filter: true, span: 4 }), S("sire_type", "Tipo", [["bull", "Touro"], ["semen", "Sêmen"], ["embryo", "Embrião"]], { required: true, list: true, filter: true, span: 2 }), REF("animal_id", "Animal (touro)", "animals", { span: 4 }), T("name", "Nome/Identificação", { list: true, search: true, span: 4 }), { name: "doses", label: "Doses", type: "integer", list: true, span: 2 }, M("unit_cost", "Custo unitário", { span: 2 })]
  },
  {
    key: "preventive_maintenances", label: "Manutenção Preventiva", labelPlural: "Manutenções Preventivas", table: "preventive_maintenances", permission: "preventive_maintenances", labelField: "description", route: "/frota/preventivas", softDelete: true,
    fields: [REF("equipment_id", "Equipamento", "equipments", { required: true, list: true, filter: true, span: 4 }), T("description", "Descrição", { required: true, list: true, search: true, span: 4 }), S("trigger_type", "Gatilho", [["hours", "Horas"], ["km", "Km"], ["days", "Dias"]], { required: true, list: true, span: 2 }), { name: "interval_value", label: "Intervalo", type: "quantity", required: true, list: true, span: 2 }, { name: "last_done_value", label: "Última execução (valor)", type: "quantity", span: 3 }, D("last_done_date", "Última execução (data)", { span: 3 }), active()]
  },
  {
    key: "scheduled_reviews", label: "Revisão Agendada", labelPlural: "Revisões Agendadas", table: "scheduled_reviews", permission: "scheduled_reviews", labelField: "description", route: "/frota/revisoes", softDelete: true,
    fields: [REF("equipment_id", "Equipamento", "equipments", { required: true, list: true, filter: true, span: 4 }), D("scheduled_date", "Data agendada", { required: true, list: true, span: 3 }), T("description", "Descrição", { required: true, list: true, search: true, span: 5 }), S("status", "Situação", [["scheduled", "Agendada"], ["done", "Realizada"], ["cancelled", "Cancelada"]], { default: "scheduled", list: true, filter: true, span: 3 })]
  },
  {
    key: "rainfalls", label: "Registro Pluviométrico", labelPlural: "Pluviometria", table: "rainfalls", permission: "rainfalls", labelField: "date", route: "/pluviometria", farmScoped: true, defaultSort: "date",
    fields: [REF("farm_id", "Fazenda", "farms", { required: true, list: true, filter: true, span: 4 }), D("date", "Data", { required: true, list: true, filter: true, span: 3 }), { name: "millimeters", label: "Milímetros (mm)", type: "quantity", required: true, list: true, span: 3 }, T("note", "Observação", { span: 12 })]
  },
  {
    key: "financial_freezes", label: "Congelamento Financeiro", labelPlural: "Congelamentos Financeiros", table: "financial_freezes", permission: "financial_freezes", labelField: "year", route: "/financeiro/congelamentos", farmScopedNulo: true,
    fields: [REF("farm_id", "Fazenda (vazio = todas)", "farms", { list: true, span: 4 }), { name: "month", label: "Mês", type: "integer", required: true, min: 1, max: 12, list: true, span: 2 }, { name: "year", label: "Ano", type: "integer", required: true, list: true, span: 2 }, B("is_frozen", "Congelado?", { default: true, list: true, span: 2 })]
  },
  {
    key: "supply_status_sla", label: "Parâmetro SLA", labelPlural: "Parâmetros SLA", table: "supply_status_sla", permission: "supply_sla", labelField: "status", route: "/suprimentos/sla",
    fields: [T("status", "Situação", { required: true, list: true, readOnly: true, span: 6 }), { name: "max_hours", label: "Horas máximas", type: "integer", required: true, default: 0, list: true, span: 3 }]
  },
  {
    key: "authorizers", label: "Autorizador", labelPlural: "Autorizadores", table: "authorizers", permission: "authorizers", labelField: "user_id", route: "/cadastros/autorizadores", softDelete: true,
    fields: [REF("user_id", "Usuário", "users", { required: true, list: true, span: 4 }), M("max_value", "Até (R$)", { required: true, list: true, span: 2 }), active(), B("is_conditional", "Autorizador condicional", { span: 3 }), B("expense_organizer", "Ordenador de despesas", { span: 3 }), { name: "min_quotes", label: "Quantidade mínima de cotações", type: "integer", required: true, default: 1, list: true, span: 3 }, { name: "levels", label: "Níveis", type: "tags", options: [{ value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }], span: 3 }, { name: "rules", label: "Regras (tipo de chamado / aplica antes ou depois da cotação)", type: "json", span: 12 }]
  },
  {
    key: "provider_launch_profiles", label: "Perfil de Lançamento", labelPlural: "Perfis de Lançamento", table: "provider_launch_profiles", permission: "provider_launch_profiles", labelField: "provider_id", route: "/estoque/perfis-de-lancamento", softDelete: true,
    fields: [REF("provider_id", "Fornecedor", "people", { required: true, list: true, span: 5 }), S("default_destination", "Lançar sempre como", [["product_invoice", "Nota de Produto"], ["expense_invoice", "Nota de Despesa"], ["animal_invoice", "Nota de Animal"]], { required: true, list: true, span: 4 }), REF("default_title_type_id", "Tipo de título padrão", "title_types", { span: 3 })]
  },
  {
    key: "contracts", label: "Contrato", labelPlural: "Gestão de Contratos", table: "contracts", permission: "contracts", labelField: "number", route: "/financeiro/contratos", softDelete: true, farmScoped: true, codeEntity: "contract",
    fields: [T("code", "Código", { readOnly: true, list: true, span: 2 }), REF("farm_id", "Fazenda", "farms", { required: true, filter: true, span: 3 }), T("number", "Nº do contrato", { required: true, list: true, search: true, span: 3 }), D("contract_date", "Data", { required: true, list: true, span: 2 }), D("expiration_date", "Data de vencimento", { required: true, list: true, span: 2 }), REF("responsible_person_id", "Responsável", "people", { required: true, span: 4 }), REF("provider_id", "Fornecedor", "people", { required: true, list: true, span: 4 }), { name: "quantity_sacks", label: "Quantidade (sc)", type: "quantity", required: true, span: 2 }, M("unit_value_sack", "Valor unitário por saca", { required: true, span: 2 }), M("amount", "Valor (R$)", { required: true, list: true, span: 2 }), { name: "installments", label: "Parcelas", type: "integer", required: true, default: 1, span: 2 }, S("status", "Situação", [["active", "Ativo"], ["finished", "Finalizado"], ["cancelled", "Cancelado"]], { default: "active", list: true, filter: true, span: 2 })]
  },
  {
    key: "absences", label: "Registro de Falta", labelPlural: "Registro/Faltas", table: "absences", permission: "absences", labelField: "absence_date", route: "/gestao-pessoal/faltas", softDelete: true,
    fields: [REF("person_id", "Funcionário", "people", { required: true, list: true, filter: true, span: 4 }), D("absence_date", "Data", { required: true, list: true, filter: true, span: 2 }), S("kind", "Tipo", [["absence", "Falta"], ["justified", "Falta justificada"], ["half_day", "Meio período"], ["delay", "Atraso"]], { default: "absence", list: true, span: 3 }), { name: "hours", label: "Horas", type: "quantity", span: 2 }, T("note", "Observação", { span: 12 })]
  },
  {
    key: "employee_events", label: "Funcionário x Evento", labelPlural: "Funcionário x Eventos", table: "employee_events", permission: "employee_events", labelField: "event_id", route: "/gestao-pessoal/funcionario-eventos",
    fields: [REF("person_id", "Funcionário", "people", { required: true, list: true, filter: true, span: 4 }), REF("event_id", "Evento", "hr_events", { required: true, list: true, filter: true, span: 4 }), M("amount", "Valor", { required: true, list: true, span: 2 }), active()]
  },
  {
    key: "bonuses", label: "Registro de Evento", labelPlural: "Registro/Eventos", table: "bonuses", permission: "bonuses", labelField: "event_id", route: "/gestao-pessoal/registro-eventos", softDelete: true,
    fields: [REF("person_id", "Funcionário", "people", { required: true, list: true, filter: true, span: 4 }), REF("event_id", "Evento", "hr_events", { required: true, list: true, filter: true, span: 4 }), D("reference_month", "Mês de referência", { required: true, list: true, span: 2 }), { name: "quantity", label: "Quantidade", type: "quantity", default: 1, span: 2 }, M("amount", "Valor", { required: true, list: true, span: 2 }), T("note", "Observação", { span: 10 })]
  },
  {
    key: "livestock_plannings", label: "Planejamento Pecuário", labelPlural: "Planejamento Pecuário", table: "livestock_plannings", permission: "livestock_plannings", labelField: "description", route: "/pecuaria/planejamento", softDelete: true, farmScoped: true, codeEntity: "livestock_planning",
    fields: [T("code", "Código", { readOnly: true, list: true, span: 2 }), REF("farm_id", "Fazenda", "farms", { required: true, list: true, filter: true, span: 4 }), REF("harvest_id", "Safra", "harvests", { list: true, span: 3 }), D("planning_date", "Data", { required: true, list: true, span: 3 }), T("description", "Descrição", { required: true, list: true, search: true, span: 12 }), { name: "values", label: "Metas (JSON: categoria → quantidade/peso/receita)", type: "json", span: 12 }]
  },
  {
    key: "budget_plannings", label: "Previsão Orçamentária", labelPlural: "Previsões Orçamentárias", table: "budget_plannings", permission: "budget_plannings", labelField: "year", route: "/financeiro/previsao-orcamentaria", softDelete: true, codeEntity: "budget_planning", farmScopedNulo: true,
    fields: [T("code", "Código", { readOnly: true, list: true, span: 2 }), REF("farm_id", "Fazenda", "farms", { list: true, filter: true, span: 4 }), D("planning_date", "Data", { required: true, list: true, span: 3 }), { name: "year", label: "Ano", type: "integer", required: true, list: true, filter: true, span: 3 }]
  },
  {
    key: "integrations", label: "Integração", labelPlural: "Integrações", table: "integrations", permission: "integration.dominio", labelField: "provider", route: "/integracoes",
    fields: [S("provider", "Provedor", [["dominio", "Software Domínio"], ["cta_smart", "CTA Smart"], ["nfe_issuer", "Emissor NFe"], ["dfe_sync", "Sinc. DFe"], ["nfse_sync", "Sinc. NFS-e"]], { required: true, list: true, span: 4 }), active(), { name: "config", label: "Configuração (sem segredos em claro)", type: "json", span: 12 }]
  },
  {
    key: "users", label: "Usuário", labelPlural: "Usuários", table: "users", permission: "users", labelField: "name", route: "/cadastros/usuarios", reference: true,
    fields: [T("name", "Nome", { required: true, list: true, search: true, span: 5 }), { name: "email", label: "E-mail", type: "email", required: true, list: true, search: true, span: 5 }, T("phone", "Telefone", { span: 3 }), active()]
  },
  {
    key: "people", label: "Pessoa", labelPlural: "Pessoas", table: "people", permission: "people", labelField: "name", route: "/cadastros/pessoas", softDelete: true, codeEntity: "person", importExport: true, defaultSort: "name",
    fields: [
      T("code", "Código", { readOnly: true, list: true, span: 2 }), T("document", "CPF/CNPJ", { list: true, search: true, span: 3 }),
      S("person_type", "Tipo de pessoa", [["natural", "Física"], ["legal", "Jurídica"], ["foreign", "Estrangeira"]], { default: "legal", span: 2 }),
      T("name", "Nome Social/Fantasia", { required: true, list: true, search: true, span: 5 }), T("legal_name", "Nome Completo/Razão Social", { search: true, span: 6 }),
      { name: "email", label: "E-mail", type: "email", span: 3 }, T("phone", "Telefone", { list: true, span: 3 }), T("cellphone", "Celular", { span: 3 }),
      T("zip_code", "CEP", { section: "Endereço", span: 2 }), T("address", "Endereço", { section: "Endereço", span: 5 }), T("address_number", "Número", { section: "Endereço", span: 2 }), T("district", "Bairro", { section: "Endereço", span: 3 }), { name: "city_id", label: "Cidade (IBGE)", type: "integer", section: "Endereço", span: 3 },
      T("state_registration", "Inscrição estadual", { section: "Fiscal", span: 3 }), T("city_registration", "Inscrição municipal", { section: "Fiscal", span: 3 }), T("contact_name", "Contato", { section: "Fiscal", span: 3 }), T("contact_phone", "Telefone do contato", { section: "Fiscal", span: 3 }),
      T("bank_code", "Banco", { section: "Conta", span: 2 }), S("bank_account_type", "Tipo", [["checking", "Corrente"], ["savings", "Poupança"]], { section: "Conta", span: 2 }), T("bank_agency", "Agência", { section: "Conta", span: 2 }), T("bank_account", "Conta", { section: "Conta", span: 2 }), S("pix_type", "Tipo chave Pix", [["document", "CPF/CNPJ"], ["phone", "Telefone"], ["email", "E-mail"], ["random", "Aleatória"]], { section: "Conta", span: 2 }), T("pix_key", "Pix", { section: "Conta", span: 2 }),
      B("is_provider", "Fornecedor", { list: true, filter: true, section: "Papéis", span: 2 }), B("is_client", "Cliente", { list: true, filter: true, section: "Papéis", span: 2 }), B("is_employee", "Funcionário", { list: true, filter: true, section: "Papéis", span: 2 }), B("is_proprietary", "Proprietário", { list: true, filter: true, section: "Papéis", span: 2 }), B("is_transporter", "Transportador", { section: "Papéis", span: 2 }),
      active()
    ]
  }
];
