import type { ResourceDef, FieldDef } from "./types.js";

const active = (name = "is_active"): FieldDef => ({ name, label: "Ativo", type: "boolean", default: true, list: true, filter: true, span: 2 });
const B = (name: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ name, label, type: "boolean", default: false, ...extra });
const T = (name: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ name, label, type: "text", ...extra });
const M = (name: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ name, label, type: "money", ...extra });
const S = (name: string, label: string, options: [string, string][], extra: Partial<FieldDef> = {}): FieldDef => ({ name, label, type: "select", options: options.map(([value, label]) => ({ value, label })), ...extra });
const REF = (name: string, label: string, resource: string, extra: Partial<FieldDef> = {}): FieldDef => ({ name, label, type: "ref", ref: { resource }, ...extra });
const D = (name: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ name, label, type: "date", ...extra });
const P = (name: string, label: string): FieldDef => ({ name, label, type: "percent" });
/** Campos novos do Parceiro (AJUSTES 01, 0030): só com a API que declara `consultaCnpjJanela` 1 (seção 7 da missão). */
const CAP_AJ01 = { nome: "consultaCnpjJanela", versao: 1 };

/** Tipo do item do SPED (registro 0200, campo TIPO_ITEM) — CADASTROS Fase 6. */
const TIPOS_DE_ITEM: [string, string][] = [
  ["00", "00 - Mercadoria para revenda"], ["01", "01 - Matéria-prima"], ["02", "02 - Embalagem"], ["03", "03 - Produto em processo"],
  ["04", "04 - Produto acabado"], ["05", "05 - Subproduto"], ["06", "06 - Produto intermediário"], ["07", "07 - Material de uso e consumo"],
  ["08", "08 - Ativo imobilizado"], ["09", "09 - Serviços"], ["10", "10 - Outros insumos"], ["99", "99 - Outras"]
];
/** Origem da mercadoria (tabela A da NF-e, 0 a 8). */
const ORIGENS_DA_MERCADORIA: [string, string][] = [
  ["0", "0 - Nacional"], ["1", "1 - Estrangeira (importação direta)"], ["2", "2 - Estrangeira (mercado interno)"], ["3", "3 - Nacional, importado > 40% e ≤ 70%"],
  ["4", "4 - Nacional, processos produtivos básicos"], ["5", "5 - Nacional, importado ≤ 40%"], ["6", "6 - Estrangeira (importação direta) sem similar nacional (CAMEX)"],
  ["7", "7 - Estrangeira (mercado interno) sem similar nacional (CAMEX)"], ["8", "8 - Nacional, importado > 70%"]
];
/**
 * `products.taxes` desenhado como CAMPOS (CADASTROS Fase 6): as MESMAS chaves dos tributos da Regra Fiscal
 * (`tax_rules`; um teste confere que cada chave existe lá). CEST e origem viraram colunas do produto; `reform` e
 * qualquer outra chave continuam no JSON e são PRESERVADAS.
 */
export const TRIBUTOS_DO_PRODUTO: FieldDef[] = [
  T("cfop_out_internal", "CFOP Saída Interno"), T("cfop_out_external", "CFOP Saída Externo"), T("cbenef", "Código de benefício fiscal"),
  T("cst_csosn", "CST/CSOSN"), T("cst_csosn_export", "CST/CSOSN Exportação"), T("cst_pis", "CST PIS"), T("cst_cofins", "CST COFINS"), T("cst_ipi", "CST IPI"), T("cenq_ipi", "Enquadramento IPI"),
  P("perc_icms", "% ICMS"), P("perc_pis", "% PIS"), P("perc_cofins", "% COFINS"), P("perc_ipi", "% IPI"), P("percent_reduction", "% Redução BC"),
  S("modality_bc", "Modalidade BC ICMS", [["0", "0 - Margem Valor Agregado"], ["1", "1 - Pauta"], ["2", "2 - Preço Tabelado Máx."], ["3", "3 - Valor da operação"]])
];

export const REGISTRY_RESOURCES: ResourceDef[] = [
  {
    key: "cost_centers", importacao: true, codigoAutomatico: "hierarquico", label: "Centro de Resultado", labelPlural: "Centros de Resultado", table: "cost_centers", permission: "cost_centers", labelField: "name", route: "/cadastros/centros-de-custo", tree: true, softDelete: true, printable: true, defaultSort: "code",
    fields: [
      T("code", "Código", { required: true, list: true, search: true, help: "Código hierárquico, ex.: 1.01.001.0001", span: 3 }),
      T("name", "Descrição", { required: true, list: true, search: true, span: 5 }),
      S("kind", "Analítica", [["analytic", "Sim"], ["synthetic", "Não"]], { default: "analytic", list: true, help: "Sim: recebe lançamentos. Não: sintética, só agrupa outras.", span: 2 }),
      S("activity_type", "Tipo", [["custeio", "Custeio"], ["investimento", "Investimento"], ["a_definir", "A definir"]], { span: 2 }),
      REF("parent_id", "Centro superior", "cost_centers", { span: 6 }),
      active()
    ]
  },
  {
    key: "empresas", label: "Empresa", labelPlural: "Empresas", table: "empresas", permission: "farms", labelField: "name", route: "/cadastros/empresas", softDelete: true, defaultSort: "code",
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
    key: "product_groups", importacao: true, codigoAutomatico: "hierarquico", label: "Grupo de Produtos", labelPlural: "Grupos de Produtos", table: "product_groups", permission: "products", labelField: "name", route: "/cadastros/grupos-de-produto", tree: true, softDelete: true, defaultSort: "code",
    fields: [
      T("code", "Código", { required: true, list: true, search: true, help: "Código hierárquico, ex.: 1.01", span: 3 }),
      T("name", "Nome", { required: true, list: true, search: true, span: 5 }),
      S("kind", "Analítico", [["analytic", "Sim"], ["synthetic", "Não"]], { default: "analytic", list: true, help: "Sim: recebe produtos. Não: só agrupa outros grupos.", span: 2 }),
      REF("parent_id", "Grupo superior", "product_groups", { span: 6 }),
      active()
    ]
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
    key: "measurement_units", importacao: true, label: "Unidade de Medida", labelPlural: "Unidades de Medida", table: "measurement_units", permission: "products", labelField: "symbol", route: "/cadastros/unidades", sharedDefaults: true,
    fields: [T("symbol", "Sigla", { required: true, list: true, search: true, span: 2 }), T("name", "Nome", { required: true, list: true, search: true, span: 6 }), { name: "decimals", label: "Casas decimais", type: "integer", default: 2, min: 0, max: 6, span: 2 }]
  },
  {
    key: "addressings", importacao: true, label: "Endereçamento", labelPlural: "Endereçamentos", table: "addressings", permission: "addressings", labelField: "description", route: "/cadastros/enderecamentos", tree: true, softDelete: true,
    fields: [T("description", "Descrição", { required: true, list: true, search: true, span: 6 }), REF("parent_id", "Endereçamento pai", "addressings", { list: true, span: 6 })]
  },
  {
    key: "warehouses", importacao: true, label: "Armazém", labelPlural: "Armazéns", table: "warehouses", permission: "warehouses", labelField: "description", route: "/cadastros/armazens", softDelete: true, empresaScoped: true,
    fields: [
      REF("empresa_id", "Empresa", "empresas", { required: true, list: true, filter: true, span: 4 }),
      T("initials", "Sigla", { required: true, list: true, search: true, span: 2 }), T("description", "Descrição", { required: true, list: true, search: true, span: 4 }),
      S("type", "Tipo", [["inputs", "Insumos"], ["production", "Produção"], ["formulation", "Formulação"]], { required: true, default: "inputs", list: true, filter: true, span: 2 }), active()
    ]
  },
  {
    key: "cultivations", importacao: true, label: "Variedade/Cultura", labelPlural: "Variedades/Culturas", table: "cultivations", permission: "products", labelField: "variety", route: "/cadastros/variedades",
    fields: [T("crop", "Cultura", { required: true, list: true, search: true, span: 5 }), T("variety", "Variedade", { required: true, list: true, search: true, span: 5 }), active()]
  },
  {
    key: "products", importacao: true, label: "Produto", labelPlural: "Produtos", table: "products", permission: "products", labelField: "description", route: "/cadastros/produtos", softDelete: true, codeEntity: "product", printable: true, importExport: true, defaultSort: "description",
    fields: [
      T("code", "Código", { readOnly: true, list: true, search: true, section: "Geral", span: 2 }),
      T("description", "Descrição", { required: true, list: true, search: true, maxLength: 120, help: "Nome do produto que está sendo cadastrado", section: "Geral", span: 6 }),
      REF("group_id", "Grupo", "product_groups", { ref: { resource: "product_groups", filtro: { kind: "analytic" }, exigeAnalitico: true }, required: true, list: true, filter: true, help: "Só grupo analítico recebe produto", section: "Geral", span: 4 }),
      REF("measurement_id", "1ª Un. Medida", "measurement_units", { required: true, help: "Unidade padrão (o rótulo é também o cabeçalho da planilha de importação)", section: "Geral", span: 3 }),
      T("marca", "Marca", { search: true, maxLength: 120, section: "Geral", span: 3 }), T("fabricante", "Fabricante", { maxLength: 120, section: "Geral", span: 3 }),
      T("reference", "Cod. Produto (fornecedor)", { search: true, help: "Referência", section: "Geral", span: 3 }), T("barcode", "Código de barras", { section: "Geral", span: 3 }),
      S("tipo_item", "Tipo do item", TIPOS_DE_ITEM, { filter: true, help: "Tipo do item do SPED (registro 0200)", section: "Geral", span: 4 }),
      // ESTOQUE E LOTES
      B("control_stock", "Controla estoque", { default: true, section: "Estoque", help: "Gerencia o produto no estoque e calcula custo médio automaticamente", span: 3 }),
      { name: "min_stock", label: "Estoque mínimo", type: "quantity", section: "Estoque", list: true, help: "Alerta quando o estoque atingir ou ficar abaixo", span: 3 },
      { name: "estoque_maximo", label: "Estoque máximo", type: "quantity", section: "Estoque", span: 3 },
      REF("default_warehouse_id", "Armazém padrão", "warehouses", { section: "Estoque", span: 4 }), REF("addressing_id", "Endereçamento", "addressings", { section: "Estoque", span: 4 }),
      S("controle_lote", "Controle de lote", [["nenhum", "Nenhum"], ["lote", "Lote"], ["lote_validade", "Lote + validade"]], { default: "nenhum", filter: true, section: "Estoque", help: "Lote: exige o lote na entrada; na saída sem lote informado, o sistema escolhe pela validade mais próxima (lote vencido só sai informado). Lote + validade: também exige a validade na entrada. Mudar com saldo exige zerar o saldo em todos os armazéns.", span: 4 }),
      { name: "withdrawal_period_days", label: "Período de Carência (dias)", type: "integer", section: "Estoque", help: "Dias de espera após aplicação antes de vender/abater o animal", span: 3 },
      // legado derivado do controle: continua na leitura (relatórios, web anterior); gravado pela API a partir do controle
      B("has_lot", "Controla lote (derivado)", { readOnly: true, section: "Estoque", help: "Derivado do Controle de lote", span: 3 }),
      // FISCAL
      T("ncm_code", "NCM", { list: true, help: "Nomenclatura Comum do Mercosul (8 dígitos)", maxLength: 8, section: "Fiscal", span: 3, busca: "ncm" }),
      T("cest", "CEST", { maxLength: 9, help: "7 dígitos (ex.: 28.038.00)", section: "Fiscal", span: 2 }),
      S("origem", "Origem", ORIGENS_DA_MERCADORIA, { section: "Fiscal", span: 5 }),
      B("is_fiscal", "Emitir NFe", { section: "Fiscal", span: 2 }), REF("tax_rule_id", "Regra fiscal", "tax_rules", { section: "Fiscal", span: 5 }),
      { name: "taxes", label: "Parâmetros fiscais (CFOP, CST, alíquotas, IBS/CBS)", type: "json", section: "Fiscal", span: 12, camposJson: TRIBUTOS_DO_PRODUTO },
      // CUSTOS E VENDA
      REF("financial_category_id", "Natureza de custo", "financial_categories", { ref: { resource: "financial_categories", filtro: { kind: "analytic" }, exigeAnalitico: true }, section: "Custos e venda", help: "Obrigatória quando o produto controla estoque", requiredWhen: { field: "control_stock", equals: true }, span: 6 }),
      REF("default_cost_center_id", "Centro de resultado padrão", "cost_centers", { ref: { resource: "cost_centers", filtro: { kind: "analytic" }, exigeAnalitico: true }, section: "Custos e venda", span: 4 }),
      M("reference_price", "Valor de referência", { section: "Custos e venda", help: "Valor de mercado do produto", span: 3 }),
      { name: "average_cost", label: "Custo médio (calculado)", type: "money", readOnly: true, section: "Custos e venda", span: 3 }, D("last_purchase_date", "Última compra", { readOnly: true, section: "Custos e venda", span: 3 }),
      // AGRO
      REF("cultivation_id", "Variedade", "cultivations", { section: "Agro", span: 4 }), T("quality", "Qualidade", { section: "Agro", span: 2 }), T("active_principle", "Princípio ativo", { search: true, section: "Agro", span: 6 }),
      T("registro_mapa", "Registro no MAPA", { maxLength: 60, section: "Agro", span: 3 }),
      B("allow_pointing", "Apontamento", { section: "Agro", help: "Permite uso na aba de apontamentos", span: 3 }),
      B("is_equipment", "Adiciona ao Inventário", { section: "Agro", help: "Cadastra automaticamente no inventário de bens", filter: true, span: 3 }),
      active("is_active")
    ],
    // FICHA EM ABAS (CADASTROS Fase 6) — mecanismo genérico da decisão 253
    cabecalho: ["code", "description", "ncm_code", "is_active"],
    abas: [
      { key: "geral", label: "Geral", secoes: ["Geral"] },
      { key: "estoque", label: "Estoque e lotes", secoes: ["Estoque"], painel: "saldo_por_lote" },
      { key: "unidades", label: "Unidades e embalagens", detalhes: ["unidades"] },
      { key: "fiscal", label: "Fiscal", secoes: ["Fiscal"] },
      { key: "compras", label: "Compras", detalhes: ["fornecedores"] },
      { key: "custos", label: "Custos e venda", secoes: ["Custos e venda"] },
      { key: "agro", label: "Agro", secoes: ["Agro"] },
      { key: "historico", label: "Histórico", painel: "historico" },
      { key: "anexos", label: "Anexos" }
    ],
    detalhes: [
      { key: "unidades", label: "Unidades alternativas e embalagens", table: "produto_unidades", chavePai: "product_id", organizacao: true, softDelete: true, maxLinhas: 50, fields: [
        REF("measurement_id", "Unidade", "measurement_units", { required: true }),
        S("tipo_fator", "Conversão", [["multiply", "Multiplica"], ["divide", "Divide"]], { required: true, default: "multiply" }),
        { name: "fator", label: "Fator", type: "quantity", required: true },
        T("codigo_barras", "Código de barras", { maxLength: 60 }),
        B("uso_compra", "Compra", { default: true }), B("uso_venda", "Venda", { default: true })] },
      { key: "fornecedores", label: "Fornecedores do produto", table: "produto_fornecedores", chavePai: "product_id", organizacao: true, softDelete: true, maxLinhas: 100, fields: [
        REF("person_id", "Fornecedor", "people", { required: true, ref: { resource: "people", filtro: { is_provider: "true" } } }),
        T("codigo_no_fornecedor", "Código no fornecedor", { maxLength: 60 }),
        REF("measurement_id", "Unidade de compra", "measurement_units"),
        B("preferencial", "Preferencial")] }
    ],
    // CADASTROS-ESTRUTURA: Categoria e Classe saíram do produto (o Grupo de Produtos virou árvore), mas a web
    // ANTERIOR ainda manda os dois na janela de deploy. Sem esta aceitação o `.strict()` recusaria o corpo
    // inteiro e o cadastro de produto pararia no meio do deploy. Opcionais; a API grava o que vier.
    // CADASTROS Fase 6: `has_lot` (vira o controle: true → lote, false → nenhum) e a 2ª unidade (agora a grade de
    // Unidades e embalagens) saíram da tela; a web ANTERIOR continua mandando e a API continua aceitando.
    camposLegadosDeEscrita: [REF("category_id", "Categoria (legado)", "product_categories"), REF("kind_id", "Classe (legado)", "product_kinds"),
      B("has_lot", "Controla Lote/Validade (legado)"), REF("second_measurement_id", "2ª Un. Medida (legado)", "measurement_units"),
      S("factor_type", "Tipo de conversão (legado)", [["multiply", "Multiplica"], ["divide", "Divide"]]), { name: "factor", label: "Fator conversão (legado)", type: "quantity" }]
  },
  {
    key: "apportionment_categories", label: "Categoria de Rateio", labelPlural: "Categorias de Rateio", table: "apportionment_categories", permission: "apportionments", labelField: "name", route: "/cadastros/rateios", softDelete: true,
    fields: [T("name", "Nome", { required: true, list: true, search: true, span: 8 }), active()]
  },
  {
    key: "financial_categories", importacao: true, codigoAutomatico: "hierarquico", label: "Natureza", labelPlural: "Naturezas", table: "financial_categories", permission: "financial_categories", labelField: "name", route: "/cadastros/categorias-financeiras", tree: true, softDelete: true, printable: true, defaultSort: "code",
    fields: [
      T("code", "Código", { required: true, list: true, search: true, span: 3 }), T("name", "Descrição", { required: true, list: true, search: true, span: 5 }),
      S("nature", "Tipo", [["income", "Receita"], ["expense", "Despesa"], ["both", "Receita e despesa"]], { required: true, herdaDoSuperior: true, help: "Natureza filha segue o Tipo da superior (salvo superior Receita e despesa).", list: true, filter: true, span: 2 }),
      S("kind", "Analítica", [["analytic", "Sim"], ["synthetic", "Não"]], { default: "analytic", list: true, help: "Sim: recebe lançamentos. Não: sintética, só agrupa outras.", span: 2 }),
      S("classification", "Classificação", [["unclassified", "Não Classificado"], ["capex", "CAPEX"], ["opex", "OPEX"]], { span: 3 }),
      B("is_tax", "É tributo?", { span: 2 }), REF("parent_id", "Natureza superior", "financial_categories", { span: 5 }), active()
    ]
  },
  {
    key: "chart_accounts", importacao: true, codigoAutomatico: "hierarquico", label: "Conta Contábil", labelPlural: "Plano de Contas", table: "chart_accounts", permission: "chart_accounts", labelField: "description", route: "/cadastros/plano-de-contas", tree: true, softDelete: true, defaultSort: "code",
    fields: [
      T("code", "Código", { required: true, list: true, search: true, span: 3 }), T("description", "Descrição", { required: true, list: true, search: true, span: 5 }),
      S("condition", "Condição", [["debit", "Débito"], ["credit", "Crédito"], ["both", "Ambos"]], { required: true, list: true, span: 2 }),
      S("kind", "Analítica", [["analytic", "Sim"], ["synthetic", "Não"]], { required: true, list: true, help: "Sim: recebe lançamentos. Não: sintética, só agrupa outras.", span: 2 }),
      S("type", "Tipo", [["capex", "CAPEX"], ["opex", "OPEX"]], { span: 3 }), REF("parent_id", "Conta superior", "chart_accounts", { span: 5 }), active()
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
    fields: [T("name", "Nome", { required: true, list: true, search: true, span: 4 }), T("cbo_code", "CBO", { list: true, span: 3, busca: "cbo", help: "Ocupação da CBO oficial (MTE)." }), M("base_salary", "Salário base", { required: true, list: true, span: 2, sigilo: "employees.edit" }), { name: "monthly_hours", label: "Horas mensais", type: "integer", required: true, default: 220, span: 2 }, M("hour_value", "Valor da hora", { required: true, span: 2, sigilo: "employees.edit" }), active(), { name: "description", label: "Descrição", type: "textarea", required: true, span: 12 }]
    // R1-2: salário e valor hora da FUNÇÃO são o salário real de quem não tem salário próprio (a folha usa
    // coalesce(ficha, função)) — o mesmo sigilo da ficha de RH (decisão 255).
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
    fields: [T("name", "Nome", { required: true, list: true, search: true, span: 5 }), { name: "position", label: "Ordem", type: "integer", required: true, default: 0, list: true, span: 2 }, active(), REF("parent_id", "Tipo superior", "document_types", { span: 5 })]
  },
  {
    key: "documents", label: "Documento", labelPlural: "Documentos", table: "documents", permission: "documents", labelField: "title", route: "/documentos", softDelete: true, empresaScopedNulo: true,
    fields: [
      REF("empresa_id", "Empresa", "empresas", { list: true, filter: true, span: 4 }), REF("document_type_id", "Tipo", "document_types", { required: true, list: true, filter: true, span: 4 }),
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
    key: "bank_accounts", codeEntity: "bank_account", codigoAutomatico: "sequencial", label: "Conta Bancária", labelPlural: "Contas Bancárias", table: "bank_accounts", permission: "bank_accounts", labelField: "description", route: "/cadastros/contas-bancarias", softDelete: true,
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
    key: "equipments", label: "Bem/Equipamento", labelPlural: "Inventário de Bens", table: "equipments", permission: "equipments", labelField: "description", route: "/cadastros/inventario", softDelete: true, empresaScoped: true, codeEntity: "equipment", printable: true,
    fields: [
      T("code", "Código", { readOnly: true, list: true, search: true, span: 2 }), T("description", "Descrição", { required: true, list: true, search: true, span: 6 }), REF("empresa_id", "Empresa", "empresas", { required: true, list: true, filter: true, span: 4 }),
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
    key: "grazing_modules", label: "Módulo de Pastejo", labelPlural: "Módulos de Pastejo", table: "grazing_modules", permission: "grazing_modules", labelField: "description", route: "/pecuaria/modulos-pastejo", softDelete: true, empresaScoped: true, codeEntity: "grazing_module",
    fields: [T("code", "Código", { readOnly: true, list: true, span: 2 }), REF("empresa_id", "Empresa", "empresas", { required: true, list: true, filter: true, span: 4 }), D("module_date", "Data de cadastro", { required: true, span: 2 }), T("responsible", "Responsável", { span: 4 }), T("description", "Descrição", { required: true, list: true, search: true, span: 6 }), REF("fodder_id", "Forragem", "fodders", { required: true, list: true, span: 3 }), T("color", "Cor do módulo", { span: 2 }), B("control_productivity", "Controla produtividade", { span: 3 })]
  },
  {
    key: "areas", codeEntity: "area", codigoAutomatico: "sequencial", label: "Área (Piquete)", labelPlural: "Áreas", table: "areas", permission: "batch_area", labelField: "name", route: "/pecuaria/areas", softDelete: true, empresaScoped: true,
    fields: [REF("empresa_id", "Empresa", "empresas", { required: true, list: true, filter: true, span: 4 }), T("code", "Código", { required: true, list: true, search: true, span: 2 }), T("name", "Nome", { required: true, list: true, search: true, span: 4 }), { name: "area_ha", label: "Área (ha)", type: "quantity", required: true, list: true, span: 2 }, REF("grazing_module_id", "Módulo de pastejo", "grazing_modules", { list: true, filter: true, span: 4 }), REF("fodder_id", "Forragem", "fodders", { span: 4 }), active()]
  },
  {
    key: "troughs", label: "Cocho", labelPlural: "Cochos", table: "troughs", permission: "troughs", labelField: "description", route: "/pecuaria/cochos", softDelete: true, codeEntity: "trough",
    fields: [T("code", "Código", { readOnly: true, list: true, span: 2 }), S("type", "Tipo", [["covered", "Coberto"], ["uncovered", "Descoberto"], ["drinker", "Bebedouro"]], { required: true, list: true, filter: true, span: 2 }), T("description", "Descrição", { required: true, list: true, search: true, span: 4 }), { name: "length_cm", label: "Área (cm)", type: "quantity", span: 2 }, REF("grazing_module_id", "Módulo de pastejo", "grazing_modules", { span: 4 }), REF("area_id", "Área", "areas", { list: true, span: 4 }), REF("corral_id", "Curral", "feedlot_corrals", { span: 4 }), active()]
  },
  {
    key: "batches", label: "Lote", labelPlural: "Lotes de Animais", table: "batches", permission: "batches", labelField: "description", route: "/pecuaria/lotes", softDelete: true, empresaScoped: true, codeEntity: "batch",
    fields: [
      T("code", "Código", { readOnly: true, list: true, span: 2 }), REF("empresa_id", "Empresa", "empresas", { required: true, list: true, filter: true, span: 4 }), D("batch_date", "Data", { required: true, list: true, span: 2 }), T("responsible", "Responsável", { span: 4 }),
      T("description", "Descrição", { required: true, list: true, search: true, span: 6 }), REF("species_id", "Espécie", "animal_species", { required: true, span: 3 }), REF("weight_parameter_id", "Peso (parâmetro)", "weight_parameters", { span: 3 }),
      S("batch_type", "Tipo", [["pasture", "Pasto"], ["feedlot", "Confinamento"], ["breeding", "Reprodução"], ["pre_batch", "Pré-lote"]], { default: "pasture", list: true, filter: true, span: 3 }),
      REF("grazing_module_id", "Módulo", "grazing_modules", { list: true, span: 3 }), REF("area_id", "Área", "areas", { list: true, span: 3 }), REF("corral_id", "Curral", "feedlot_corrals", { span: 3 }),
      REF("diet_id", "Dieta", "diets", { span: 3 }), REF("feeding_phase_id", "Fase alimentar", "feeding_phases", { span: 3 }), D("entry_date", "Entrada", { span: 2 }), D("exit_date", "Saída", { span: 2 }),
      S("status", "Situação", [["active", "Ativo"], ["closed", "Encerrado"]], { default: "active", list: true, filter: true, span: 2 })
    ]
  },
  {
    key: "feedlot_yards", codeEntity: "feedlot_yard", codigoAutomatico: "sequencial", label: "Pátio", labelPlural: "Pátios", table: "feedlot_yards", permission: "feedlot_yards", labelField: "name", route: "/confinamento/patios", softDelete: true, empresaScoped: true,
    fields: [REF("empresa_id", "Empresa", "empresas", { required: true, list: true, filter: true, span: 4 }), T("code", "Código", { required: true, list: true, span: 2 }), T("name", "Nome", { required: true, list: true, search: true, span: 4 }), active()]
  },
  {
    key: "feedlot_sectors", codeEntity: "feedlot_sector", codigoAutomatico: "sequencial", label: "Setor", labelPlural: "Setores", table: "feedlot_sectors", permission: "feedlot_sectors", labelField: "name", route: "/confinamento/setores", softDelete: true,
    fields: [REF("yard_id", "Pátio", "feedlot_yards", { required: true, list: true, filter: true, span: 4 }), T("code", "Código", { required: true, list: true, span: 2 }), T("name", "Nome", { required: true, list: true, search: true, span: 4 }), active()]
  },
  {
    key: "feedlot_corrals", codeEntity: "feedlot_corral", codigoAutomatico: "sequencial", label: "Curral", labelPlural: "Currais", table: "feedlot_corrals", permission: "feedlot_corrals", labelField: "name", route: "/confinamento/currais", softDelete: true,
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
    key: "breeding_seasons", label: "Estação de Monta", labelPlural: "Estações de Monta", table: "breeding_seasons", permission: "breeding_seasons", labelField: "name", route: "/pecuaria/reproducao/estacoes", softDelete: true, empresaScoped: true, codeEntity: "breeding_season",
    fields: [T("code", "Código", { readOnly: true, list: true, span: 2 }), REF("empresa_id", "Empresa", "empresas", { required: true, list: true, filter: true, span: 4 }), T("name", "Nome", { required: true, list: true, search: true, span: 4 }), D("start_date", "Início", { required: true, list: true, span: 2 }), D("end_date", "Fim", { required: true, list: true, span: 2 }), S("status", "Situação", [["open", "Aberta"], ["closed", "Encerrada"]], { default: "open", list: true, filter: true, span: 2 })]
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
    key: "rainfalls", label: "Registro Pluviométrico", labelPlural: "Pluviometria", table: "rainfalls", permission: "rainfalls", labelField: "date", route: "/pluviometria", empresaScoped: true, defaultSort: "date",
    fields: [REF("empresa_id", "Empresa", "empresas", { required: true, list: true, filter: true, span: 4 }), D("date", "Data", { required: true, list: true, filter: true, span: 3 }), { name: "millimeters", label: "Milímetros (mm)", type: "quantity", required: true, list: true, span: 3 }, T("note", "Observação", { span: 12 })]
  },
  {
    key: "financial_freezes", label: "Congelamento Financeiro", labelPlural: "Congelamentos Financeiros", table: "financial_freezes", permission: "financial_freezes", labelField: "year", route: "/financeiro/congelamentos", empresaScopedNulo: true,
    fields: [REF("empresa_id", "Empresa (vazio = todas)", "empresas", { list: true, span: 4 }), { name: "month", label: "Mês", type: "integer", required: true, min: 1, max: 12, list: true, span: 2 }, { name: "year", label: "Ano", type: "integer", required: true, list: true, span: 2 }, B("is_frozen", "Congelado?", { default: true, list: true, span: 2 })]
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
    key: "contracts", label: "Contrato", labelPlural: "Gestão de Contratos", table: "contracts", permission: "contracts", labelField: "number", route: "/financeiro/contratos", softDelete: true, empresaScoped: true, codeEntity: "contract",
    fields: [T("code", "Código", { readOnly: true, list: true, span: 2 }), REF("empresa_id", "Empresa", "empresas", { required: true, filter: true, span: 3 }), T("number", "Nº do contrato", { required: true, list: true, search: true, span: 3 }), D("contract_date", "Data", { required: true, list: true, span: 2 }), D("expiration_date", "Data de vencimento", { required: true, list: true, span: 2 }), REF("responsible_person_id", "Responsável", "people", { required: true, span: 4 }), REF("provider_id", "Fornecedor", "people", { required: true, list: true, span: 4 }), { name: "quantity_sacks", label: "Quantidade (sc)", type: "quantity", required: true, span: 2 }, M("unit_value_sack", "Valor unitário por saca", { required: true, span: 2 }), M("amount", "Valor (R$)", { required: true, list: true, span: 2 }), { name: "installments", label: "Parcelas", type: "integer", required: true, default: 1, span: 2 }, S("status", "Situação", [["active", "Ativo"], ["finished", "Finalizado"], ["cancelled", "Cancelado"]], { default: "active", list: true, filter: true, span: 2 })]
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
    key: "livestock_plannings", label: "Planejamento Pecuário", labelPlural: "Planejamento Pecuário", table: "livestock_plannings", permission: "livestock_plannings", labelField: "description", route: "/pecuaria/planejamento", softDelete: true, empresaScoped: true, codeEntity: "livestock_planning",
    fields: [T("code", "Código", { readOnly: true, list: true, span: 2 }), REF("empresa_id", "Empresa", "empresas", { required: true, list: true, filter: true, span: 4 }), REF("harvest_id", "Safra", "harvests", { list: true, span: 3 }), D("planning_date", "Data", { required: true, list: true, span: 3 }), T("description", "Descrição", { required: true, list: true, search: true, span: 12 }), { name: "values", label: "Metas (JSON: categoria → quantidade/peso/receita)", type: "json", span: 12 }]
  },
  {
    key: "budget_plannings", label: "Previsão Orçamentária", labelPlural: "Previsões Orçamentárias", table: "budget_plannings", permission: "budget_plannings", labelField: "year", route: "/financeiro/previsao-orcamentaria", softDelete: true, codeEntity: "budget_planning", empresaScopedNulo: true,
    fields: [T("code", "Código", { readOnly: true, list: true, span: 2 }), REF("empresa_id", "Empresa", "empresas", { list: true, filter: true, span: 4 }), D("planning_date", "Data", { required: true, list: true, span: 3 }), { name: "year", label: "Ano", type: "integer", required: true, list: true, filter: true, span: 3 }]
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
    // PARCEIRO (CADASTROS Fase 4, decisão 253): a tabela, a chave, a permissão e a rota continuam `people`;
    // a tela é a FICHA EM ABAS declarada em `abas`/`detalhes`/`perfis` abaixo.
    key: "people", importacao: true, label: "Parceiro", labelPlural: "Parceiros", table: "people", permission: "people", labelField: "name", route: "/cadastros/pessoas", softDelete: true, codeEntity: "person", importExport: true, defaultSort: "name",
    fields: [
      // AJUSTES 01 (decisão 257, C-3/C-4): Código (travado) fica no cabeçalho fixo (e só leitura no topo da 1ª aba); Identificação na ordem do padrão
      // de tela; campos de Física só aparecem em Física e os de Jurídica só em Jurídica (a API recusa o do outro tipo)
      T("code", "Código", { readOnly: true, list: true, span: 2 }),
      S("person_type", "Tipo de pessoa", [["natural", "Física"], ["legal", "Jurídica"], ["foreign", "Estrangeira"]], { default: "legal", section: "Identificação", span: 2, help: "Segue o documento: 11 dígitos → Física; 14 → Jurídica. Estrangeira só manual." }),
      T("document", "CPF/CNPJ", { list: true, search: true, section: "Identificação", span: 3, help: "CPF ou CNPJ (também o alfanumérico). Estrangeiro: livre." }),
      T("name", "Nome Social/Fantasia", { required: true, list: true, search: true, section: "Identificação", span: 5 }),
      T("legal_name", "Nome Completo/Razão Social", { search: true, section: "Identificação", span: 6, rotuloQuando: { field: "person_type", rotulos: { legal: "Razão social", natural: "Nome completo" } } }),
      B("is_client", "Cliente", { list: true, filter: true, section: "Identificação", grupo: "Tipo do parceiro", span: 2 }), B("is_provider", "Fornecedor", { list: true, filter: true, section: "Identificação", grupo: "Tipo do parceiro", span: 2 }), B("is_transporter", "Transportadora", { list: true, filter: true, section: "Identificação", grupo: "Tipo do parceiro", span: 2 }), B("is_employee", "Funcionário", { list: true, filter: true, section: "Identificação", grupo: "Tipo do parceiro", span: 2 }), B("is_proprietary", "Proprietário", { list: true, filter: true, section: "Identificação", grupo: "Tipo do parceiro", span: 2 }),
      REF("matriz_id", "Matriz", "people", { exigeCapacidade: CAP_AJ01, limpaQuandoOculto: true, section: "Identificação", span: 5, visibleWhen: { field: "person_type", equals: "legal" }, help: "Parceiro matriz desta filial (só Jurídica)." }),
      T("state_registration", "Inscrição estadual", { section: "Identificação", span: 3 }), T("city_registration", "Inscrição municipal", { section: "Identificação", span: 3 }),
      T("rg", "RG", { exigeCapacidade: CAP_AJ01, limpaQuandoOculto: true, section: "Identificação", span: 3, visibleWhen: { field: "person_type", equals: "natural" } }),
      T("caepf", "CAEPF", { exigeCapacidade: CAP_AJ01, limpaQuandoOculto: true, section: "Identificação", span: 3, maxLength: 14, padrao: { regex: "^\\d{14}$", mensagem: "Informe os 14 dígitos do CAEPF (só números)." }, visibleWhen: { field: "person_type", equals: "natural" }, help: "14 dígitos" }),
      D("nascimento_abertura", "Nascimento/Abertura", { section: "Identificação", span: 3, rotuloQuando: { field: "person_type", rotulos: { legal: "Abertura", natural: "Nascimento" } } }),
      S("sexo", "Sexo", [["F", "Feminino"], ["M", "Masculino"]], { exigeCapacidade: CAP_AJ01, limpaQuandoOculto: true, section: "Identificação", span: 2, visibleWhen: { field: "person_type", equals: "natural" } }),
      T("site", "Site", { exigeCapacidade: CAP_AJ01, section: "Identificação", span: 4 }),
      active("is_active"),
      T("zip_code", "CEP", { section: "Endereço", span: 2 }), T("address", "Endereço", { section: "Endereço", span: 5 }), T("address_number", "Número", { section: "Endereço", span: 2 }), T("complemento", "Complemento", { section: "Endereço", span: 3 }), T("district", "Bairro", { section: "Endereço", span: 3 }), { name: "city_id", label: "Cidade", type: "integer", list: true, section: "Endereço", span: 4, busca: "municipios" },
      T("caixa_postal", "Caixa postal", { exigeCapacidade: CAP_AJ01, section: "Endereço", span: 2 }), { name: "latitude", label: "Latitude", type: "number", exigeCapacidade: CAP_AJ01, section: "Endereço", span: 2, min: -90, max: 90 }, { name: "longitude", label: "Longitude", type: "number", exigeCapacidade: CAP_AJ01, section: "Endereço", span: 2, min: -180, max: 180 },
      T("phone", "Telefone", { list: true, section: "Contato", span: 3 }), T("cellphone", "Celular", { section: "Contato", span: 3 }), { name: "email", label: "E-mail", type: "email", section: "Contato", span: 4 }, { name: "email_nfe", label: "E-mail para NF-e", type: "email", exigeCapacidade: CAP_AJ01, section: "Contato", span: 4 }, T("contact_name", "Contato principal", { section: "Contato", span: 4 }), T("contact_phone", "Telefone do contato", { section: "Contato", span: 3 }),
      S("indicador_ie", "Indicador de IE", [["contribuinte", "Contribuinte"], ["isento", "Isento"], ["nao_contribuinte", "Não contribuinte"]], { section: "Fiscal", span: 3 }),
      B("consumidor_final", "Consumidor final", { section: "Fiscal", span: 2 }), B("produtor_rural", "Produtor rural", { section: "Fiscal", span: 2, help: "Um parceiro por CPF; cada propriedade tem a sua IE nos Endereços adicionais." }),
      B("calcula_funrural", "Calcula FUNRURAL", { exigeCapacidade: CAP_AJ01, section: "Fiscal", span: 2, help: "fornecedor produtor rural: a compra retém o FUNRURAL" }),
      S("regime_tributario", "Regime tributário", [["simples", "Simples Nacional"], ["mei", "MEI"], ["normal", "Normal"]], { section: "Fiscal", span: 3 }),
      T("cnae_principal", "CNAE principal", { section: "Fiscal", span: 3, maxLength: 7, help: "7 dígitos" }),
      T("situacao_receita", "Situação na Receita", { readOnly: true, list: true, section: "Fiscal", span: 3, help: "Vem da consulta de CNPJ." }), T("situacao_receita_consultada_em", "Consultado em", { readOnly: true, section: "Fiscal", span: 3 }),
      T("bank_code", "Banco", { section: "Conta", span: 3, busca: "bancos" }), S("bank_account_type", "Tipo de conta", [["checking", "Corrente"], ["savings", "Poupança"]], { section: "Conta", span: 2 }), T("bank_agency", "Agência", { section: "Conta", span: 2 }), T("bank_account", "Conta", { section: "Conta", span: 2 }), S("pix_type", "Tipo de chave Pix", [["document", "CPF/CNPJ"], ["phone", "Telefone"], ["email", "E-mail"], ["random", "Aleatória"]], { section: "Conta", span: 2 }), T("pix_key", "Chave Pix", { section: "Conta", span: 3 })
    ],
    cabecalho: ["code", "is_active", "person_type", "document", "name", "situacao_receita"],
    camposRapidos: ["is_client", "is_provider", "is_transporter", "is_employee", "is_proprietary", "person_type", "document", "name", "city_id", "phone", "email"],
    abas: [
      { key: "identificacao", label: "Identificação", secoes: ["Identificação"] },
      { key: "enderecos", label: "Endereço", secoes: ["Endereço"], detalhes: ["enderecos"] },
      { key: "contatos", label: "Contatos", secoes: ["Contato"], detalhes: ["contatos"] },
      { key: "fiscal", label: "Fiscal", secoes: ["Fiscal"] },
      { key: "financeiro", label: "Financeiro", secoes: ["Conta"], detalhes: ["contas"] },
      // ABAS DE TIPO (R1-4): ler exige `<tipo>.view` e gravar exige `<tipo>.edit`; marcar/desmarcar o tipo é do parceiro
      { key: "cliente", label: "Cliente", perfis: ["perfil_cliente"], visivelQuando: { field: "is_client", equals: true }, permissaoDeLeitura: "clients.view", permissaoDeEdicao: "clients.edit" },
      { key: "fornecedor", label: "Fornecedor", perfis: ["perfil_fornecedor"], detalhes: ["filiais", "vendedores"], visivelQuando: { field: "is_provider", equals: true }, permissaoDeLeitura: "providers.view", permissaoDeEdicao: "providers.edit" },
      { key: "proprietario", label: "Proprietário", perfis: ["perfil_proprietario"], detalhes: ["participacoes"], visivelQuando: { field: "is_proprietary", equals: true }, permissaoDeLeitura: "proprietaries.view", permissaoDeEdicao: "proprietaries.edit" },
      { key: "funcionario", label: "Funcionário", visivelQuando: { field: "is_employee", equals: true } },
      // Anexos saiu da última aba para a barra de ações (AJUSTES 01, C-1): mesmo diálogo
      { key: "historico", label: "Histórico", painel: "historico" }
    ],
    detalhes: [
      { key: "enderecos", label: "Outros endereços", table: "parceiro_enderecos", chavePai: "person_id", organizacao: true, softDelete: true, maxLinhas: 100, fields: [
        S("tipo", "Tipo", [["entrega", "Entrega"], ["cobranca", "Cobrança"], ["propriedade", "Propriedade"], ["outro", "Outro"]], { required: true }), T("descricao", "Descrição"),
        T("cep", "CEP", { maxLength: 8 }), T("logradouro", "Endereço"), T("numero", "Número"), T("complemento", "Complemento"), T("bairro", "Bairro"), { name: "city_id", label: "Cidade", type: "integer", busca: "municipios" },
        T("inscricao_estadual", "IE", { help: "Dígitos ou ISENTO" }), { name: "latitude", label: "Latitude", type: "number", exigeCapacidade: CAP_AJ01, min: -90, max: 90 }, { name: "longitude", label: "Longitude", type: "number", exigeCapacidade: CAP_AJ01, min: -180, max: 180 }, active("is_active")
      ] },
      { key: "contatos", label: "Contatos adicionais", table: "parceiro_contatos", chavePai: "person_id", organizacao: true, softDelete: true, maxLinhas: 100, fields: [
        T("nome", "Nome", { required: true }), T("funcao", "Função"), T("telefone", "Telefone"), T("celular", "Celular"), { name: "email", label: "E-mail", type: "email" }, B("recebe_nfe_email", "Recebe NF-e por e-mail")
      ] },
      { key: "contas", label: "Contas adicionais", table: "parceiro_contas", chavePai: "person_id", organizacao: true, softDelete: true, maxLinhas: 50, fields: [
        T("bank_code", "Banco", { busca: "bancos" }), T("agencia", "Agência"), T("conta", "Conta"), S("tipo", "Tipo", [["checking", "Corrente"], ["savings", "Poupança"]]), T("titular", "Titular"),
        S("pix_tipo", "Tipo chave Pix", [["document", "CPF/CNPJ"], ["phone", "Telefone"], ["email", "E-mail"], ["random", "Aleatória"]]), T("pix_chave", "Chave Pix")
      ] },
      { key: "filiais", label: "Filiais do fornecedor", table: "provider_branches", chavePai: "person_id", maxLinhas: 100, fields: [
        T("name", "Nome"), T("document", "CPF/CNPJ"), T("state_registration", "IE"), T("zip_code", "CEP"), T("address", "Endereço"), { name: "city_id", label: "Município", type: "integer", busca: "municipios" }
      ] },
      { key: "vendedores", label: "Vendedores do fornecedor", table: "provider_sellers", chavePai: "person_id", maxLinhas: 100, fields: [
        T("name", "Nome", { required: true }), { name: "email", label: "E-mail", type: "email" }, T("phone", "Telefone")
      ] },
      { key: "participacoes", label: "Participação por empresa", table: "proprietary_empresas", chavePai: "person_id", chaveNatural: "empresa_id", campoEmpresa: "empresa_id", maxLinhas: 100, fields: [
        REF("empresa_id", "Empresa", "empresas", { required: true }), { name: "percentage", label: "Participação (%)", type: "percent", required: true, min: 0, max: 100 }, T("registration_number", "Matrícula/Registro")
      ] }
    ],
    perfis: [
      { key: "perfil_cliente", label: "Perfil de cliente", table: "client_profiles", chavePai: "person_id", ativoPor: "is_client", fields: [M("limite_credito", "Limite de crédito (informativo)")] },
      { key: "perfil_fornecedor", label: "Perfil de fornecedor", table: "provider_profiles", chavePai: "person_id", ativoPor: "is_provider", fields: [S("provider_type", "Tipo de fornecedor", [["provider", "Fornecedor"], ["outsourced", "Terceirizado"], ["transporter", "Transportador"], ["employee", "Funcionário"]]), M("hour_value", "Valor da hora"), REF("default_cost_center_id", "Centro de resultado padrão", "cost_centers")] },
      { key: "perfil_proprietario", label: "Perfil de proprietário", table: "proprietary_profiles", chavePai: "person_id", ativoPor: "is_proprietary", fields: [] }
    ]
  },
  {
    // FUNCIONÁRIO (CADASTROS Fase 5): o PARCEIRO do tipo Funcionário (erp.people, recorte fixo is_employee) com a
    // FICHA DE RH (erp.employee_profiles, 1:1) sobre o mecanismo genérico de abas da Fase 4. Nasce pelo CPF
    // (`POST /api/hr/funcionarios/por-cpf`), nunca pela porta genérica. Salário, valor hora, meta e comissão são SIGILOSOS (R1-2).
    key: "funcionarios", label: "Funcionário", labelPlural: "Funcionários", table: "people", permission: "employees", labelField: "name", route: "/pessoas", softDelete: true, defaultSort: "name",
    filtroFixo: { is_employee: true },
    criacao: { rota: "/api/hr/funcionarios/por-cpf", mensagem: "Novo funcionário começa pelo CPF: CPF de parceiro existente abre a ficha dele e marca o tipo Funcionário; CPF novo cria o parceiro.", campos: ["document", "name"] },
    fields: [
      T("code", "Código", { readOnly: true, list: true, section: "Pessoal", span: 2 }),
      T("document", "CPF", { list: true, search: true, section: "Pessoal", span: 3 }),
      T("name", "Nome", { required: true, list: true, search: true, section: "Pessoal", span: 5 }), T("legal_name", "Nome completo", { search: true, section: "Pessoal", span: 6 }),
      D("nascimento_abertura", "Nascimento", { section: "Pessoal", span: 3 }),
      { name: "email", label: "E-mail", type: "email", section: "Pessoal", span: 4 }, T("phone", "Telefone", { list: true, section: "Pessoal", span: 3 }), T("cellphone", "Celular", { section: "Pessoal", span: 3 }),
      { ...active("is_active"), section: "Pessoal" }
    ],
    cabecalho: ["code", "name", "document", "is_active"],
    abas: [
      { key: "pessoal", label: "Pessoal", secoes: ["Pessoal"], permissaoDeEdicao: "people.edit", link: { label: "Abrir no cadastro de parceiros", href: "/cadastros/people/:id" } },
      { key: "admissao", label: "Admissão e lotação", perfis: ["rh_admissao"], detalhes: ["equipes"] },
      { key: "remuneracao", label: "Remuneração", perfis: ["rh_remuneracao"] },
      { key: "documentos", label: "Documentos", perfis: ["rh_documentos"] },
      { key: "pagamento", label: "Pagamento", perfis: ["rh_pagamento"] },
      { key: "desligamento", label: "Desligamento", perfis: ["rh_desligamento"] },
      { key: "eventos", label: "Eventos fixos", detalhes: ["eventos"] },
      { key: "usuario", label: "Usuário do sistema", perfis: ["rh_usuario"] }
    ],
    // R1-2: as duas grades gravam linhas de OUTRO cadastro e obedecem às permissões DELE. Equipes: a composição é
    // parte da equipe (Configurações › RH › Equipes), então incluir, mudar ou tirar o funcionário é EDITAR a equipe.
    detalhes: [
      { key: "equipes", label: "Equipes", table: "team_members", chavePai: "person_id", chaveNatural: "team_id", maxLinhas: 50,
        permissoes: { ler: "teams.view", criar: "teams.edit", editar: "teams.edit", excluir: "teams.edit" }, fields: [
        REF("team_id", "Equipe", "teams", { required: true }), S("member_type", "Tipo", [["employee", "Funcionário"], ["outsourced", "Terceirizado"]], { required: true, default: "employee" }), active("is_active")
      ] },
      { key: "eventos", label: "Eventos fixos", table: "employee_events", chavePai: "person_id", organizacao: true, maxLinhas: 100,
        permissoes: { ler: "employee_events.view", criar: "employee_events.create", editar: "employee_events.edit", excluir: "employee_events.delete" }, fields: [
        REF("event_id", "Evento", "hr_events", { required: true }), M("amount", "Valor", { required: true }), active("is_active")
      ] }
    ],
    // Vários perfis sobre a MESMA linha 1:1 (erp.employee_profiles): um por aba. Cada um grava só os seus campos.
    perfis: [
      { key: "rh_admissao", label: "Admissão e lotação", table: "employee_profiles", chavePai: "person_id", fields: [
        T("matricula", "Matrícula", { maxLength: 30 }), D("admission_date", "Admissão"), REF("empresa_id", "Empresa", "empresas"), REF("function_id", "Função", "job_functions"),
        REF("cost_center_id", "Centro de resultado", "cost_centers", { ref: { resource: "cost_centers", filtro: { kind: "analytic" }, exigeAnalitico: true } }),
        S("tipo_vinculo", "Tipo de vínculo", [["clt_indeterminado", "CLT prazo indeterminado"], ["clt_determinado", "CLT prazo determinado/safra"], ["temporario", "Temporário"], ["aprendiz", "Aprendiz"], ["estagio", "Estágio"], ["autonomo", "Autônomo/diarista"]]),
        B("trabalhador_rural", "Trabalhador rural"), T("office", "Cargo (texto livre)")
      ] },
      { key: "rh_remuneracao", label: "Remuneração", table: "employee_profiles", chavePai: "person_id", fields: [
        M("base_salary", "Salário base", { sigilo: "employees.edit" }), M("hour_value", "Valor da hora", { sigilo: "employees.edit" }), M("goal_salary", "Meta", { sigilo: "employees.edit" }),
        { name: "commission_percent", label: "Comissão (%)", type: "percent", min: 0, max: 100, sigilo: "employees.edit" }, { name: "jornada_semanal", label: "Jornada semanal (h)", type: "number", min: 0, max: 168 }
      ] },
      { key: "rh_documentos", label: "Documentos", table: "employee_profiles", chavePai: "person_id", fields: [
        T("pis_nis", "PIS/NIS", { maxLength: 11, help: "11 dígitos" }), T("ctps_numero", "CTPS número"), T("ctps_serie", "CTPS série"), T("rg_numero", "RG"), T("rg_orgao", "RG órgão emissor"),
        T("cnh_numero", "CNH número", { maxLength: 11 }), S("cnh_categoria", "CNH categoria", [["A", "A"], ["B", "B"], ["C", "C"], ["D", "D"], ["E", "E"], ["AB", "AB"], ["AC", "AC"], ["AD", "AD"], ["AE", "AE"]]), D("cnh_validade", "CNH validade")
      ] },
      { key: "rh_pagamento", label: "Pagamento", table: "employee_profiles", chavePai: "person_id", fields: [
        T("conta_pagamento_id", "Conta de pagamento", { help: "Vazio = conta principal do parceiro; ou uma conta adicional dele (aba Financeiro do parceiro)." })
      ] },
      { key: "rh_desligamento", label: "Desligamento", table: "employee_profiles", chavePai: "person_id", fields: [
        D("dismissal_date", "Data do desligamento"),
        S("motivo_desligamento", "Motivo", [["pedido_demissao", "Pedido de demissão"], ["sem_justa_causa", "Sem justa causa"], ["com_justa_causa", "Com justa causa"], ["termino_contrato", "Término de contrato"], ["acordo", "Acordo"], ["outro", "Outro"]])
      ] },
      { key: "rh_usuario", label: "Usuário do sistema", table: "employee_profiles", chavePai: "person_id", fields: [REF("user_id", "Usuário", "users")] }
    ]
  }
];
