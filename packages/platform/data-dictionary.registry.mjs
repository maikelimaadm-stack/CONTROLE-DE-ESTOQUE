/**
 * DICIONÁRIO DE DADOS — METADADOS CURADOS (SSOT funcional).
 *
 * Divisão de trabalho deliberada, para que o dicionário não vire um documento manual impossível de manter:
 *   • a parte TÉCNICA (tabelas, colunas, tipos, nulidade, chaves, enums) é DERIVADA das migrations pelo
 *     gerador `scripts/data-dictionary.mjs` — nunca escrita à mão, nunca desatualiza;
 *   • a parte FUNCIONAL (nome funcional, descrição, módulo, tela, TOP futura, observações de migração) é
 *     CURADA aqui, versionada em Git e auditada pelo gate (`node scripts/data-dictionary.mjs --check`).
 *
 * O gate recusa entrada que aponte para tabela/coluna inexistente: o dicionário não pode mentir sobre o schema.
 * Cobertura é incremental por design (DATA-GOV certifica 100%); acrescentar entidade aqui é sempre aditivo.
 *
 * Taxonomia PRÓPRIA (docs/DOMAIN-NAMING-STANDARD.md): os códigos `AGR-<MÓDULO>-<ENTIDADE>` são nossos.
 * Não reproduzimos códigos, siglas ou numeração do sistema de referência.
 */

/** Versão do formato do dicionário. Incrementar quando a forma das entradas mudar. */
export const DATA_DICTIONARY_VERSION = 1;

/** Módulos da taxonomia própria (prefixo dos códigos canônicos). */
export const DICTIONARY_MODULES = Object.freeze({
  PLAT: "Plataforma",
  CAD: "Cadastros",
  EST: "Estoque",
  CMP: "Compras",
  FIN: "Financeiro",
  VND: "Vendas",
  PEC: "Pecuária",
  FRT: "Frota e Ativos",
  OS: "Ordens de Serviço",
  RH: "Pessoas e RH"
});

/**
 * Entrada por ENTIDADE (tabela). Campos:
 *   code        código canônico próprio (AGR-<MÓDULO>-<ENTIDADE>)
 *   table       tabela real (erp.<nome>) — validada contra as migrations
 *   name        nome funcional em português
 *   description o que a entidade representa para o negócio
 *   module      chave de DICTIONARY_MODULES
 *   kind        "entidade" (identidade própria) | "linha" (estrutura interna) | "infraestrutura"
 *   globalId    recebe ID Global? (cruzado com GLOBAL_ID_ENTITIES pelo teste de contrato)
 *   route       rota canônica de detalhe, quando houver
 *   top         TOP futura que classificará o lançamento (contrato — ainda não implementada)
 *   fields      overrides funcionais por coluna: { coluna: { name, description } }
 *   migration   observação de migração (farm → empresa, nomenclatura, backfill)
 */
export const DATA_DICTIONARY = Object.freeze([
  // ---------- Plataforma (núcleo neutro de nicho) ----------
  {
    code: "AGR-PLAT-ORGANIZACAO", table: "erp.organizations", name: "Organização", module: "PLAT", kind: "entidade", globalId: false,
    description: "Tenant do ERP: o cliente contratante. Agrupa empresas, usuários, permissões e a sequência de ID Global. Nunca se confunde com Empresa.",
    fields: {
      name: { name: "Nome", description: "Nome do grupo/contratante." },
      document: { name: "Documento", description: "CNPJ/CPF do contratante." },
      parameters: { name: "Parâmetros", description: "Parametrizações do tenant (JSON)." },
      default_language: { name: "Idioma padrão", description: "Idioma padrão da organização (BCP 47). Usuário pode sobrepor." }
    }
  },
  {
    code: "AGR-PLAT-EMPRESA", table: "erp.farms", name: "Empresa", module: "PLAT", kind: "entidade", globalId: false,
    description: "Entidade operacional/jurídica dos registros: é a EMPRESA do contrato multiempresa. Hoje materializada na tabela `farms` (nome herdado do nicho agro).",
    migration: "PRE-BASE2-02/03: renomeada para empresa/`empresa_id` com camada de compatibilidade. Não renomear em massa antes do plano de migração.",
    fields: {
      code: { name: "Código", description: "Código curto da empresa dentro da organização." },
      name: { name: "Nome", description: "Nome da empresa." },
      document: { name: "Documento", description: "CNPJ/CPF da empresa." }
    }
  },
  {
    code: "AGR-PLAT-USUARIO", table: "erp.users", name: "Usuário", module: "PLAT", kind: "entidade", globalId: false,
    description: "Pessoa que acessa o sistema. Autenticação local (desenvolvimento/teste) ou provedor externo.",
    fields: { language: { name: "Idioma", description: "Idioma preferido do usuário (BCP 47). Vazio = idioma da organização." } }
  },
  {
    code: "AGR-PLAT-VINCULO", table: "erp.organization_members", name: "Vínculo de Usuário", module: "PLAT", kind: "linha", globalId: false,
    description: "Vínculo usuário × organização com perfil de acesso. Sem identidade própria para o usuário final."
  },
  {
    code: "AGR-PLAT-EMPRESA-PERMITIDA", table: "erp.member_farms", name: "Empresa Permitida", module: "PLAT", kind: "linha", globalId: false,
    description: "Empresas que o vínculo pode acessar. Lista vazia significa TODAS as empresas da organização. É a autoridade de autorização por empresa.",
    migration: "PRE-BASE2-02: vira `member_empresas` (ou equivalente) mantendo a semântica de lista vazia = todas."
  },
  {
    code: "AGR-PLAT-PERFIL", table: "erp.roles", name: "Perfil de Acesso", module: "PLAT", kind: "entidade", globalId: true, route: "/admin/perfis/:id",
    description: "Conjunto de permissões atribuível a usuários da organização."
  },
  {
    code: "AGR-PLAT-PERMISSAO-PERFIL", table: "erp.role_permissions", name: "Permissão do Perfil", module: "PLAT", kind: "linha", globalId: false,
    description: "Vínculo perfil × chave de permissão. Estrutura interna: nunca recebe ID Global."
  },
  {
    code: "AGR-PLAT-AUDITORIA", table: "erp.audit_logs", name: "Registro de Auditoria", module: "PLAT", kind: "infraestrutura", globalId: false,
    description: "Trilha imutável de eventos (criação, alteração, cancelamento, login) por organização e usuário."
  },
  {
    code: "AGR-PLAT-SEQUENCIA-CODIGO", table: "erp.code_sequences", name: "Sequência de Código", module: "PLAT", kind: "infraestrutura", globalId: false,
    description: "Contador por organização × entidade que gera o código/número próprio de cada entidade."
  },
  {
    code: "AGR-PLAT-SEQUENCIA-ID-GLOBAL", table: "erp.global_id_sequences", name: "Sequência de ID Global", module: "PLAT", kind: "infraestrutura", globalId: false,
    description: "Contador ÚNICO por organização que gera o ID Global. Compartilhado por todas as empresas da organização; independente entre organizações."
  },
  {
    code: "AGR-PLAT-REGISTRO-GLOBAL", table: "erp.global_records", name: "Registro Global", module: "PLAT", kind: "infraestrutura", globalId: false,
    description: "Índice que resolve um ID Global no registro real: organização, empresa, tipo de entidade, UUID, módulo e rota canônica.",
    fields: {
      global_id: { name: "ID Global", description: "Número sequencial por organização, exibido como #55." },
      entity_type: { name: "Tipo de Entidade", description: "Chave canônica do tipo (registry de elegibilidade em @agro/platform)." },
      canonical_route: { name: "Rota Canônica", description: "Rota de detalhe resolvida na criação; a URL deriva do registro, nunca o contrário." }
    }
  },

  // ---------- Cadastros ----------
  {
    code: "AGR-CAD-PRODUTO", table: "erp.products", name: "Produto", module: "CAD", kind: "entidade", globalId: true, route: "/cadastros/products/:id",
    description: "Item de estoque, insumo ou serviço. Compartilhado pela organização (não pertence a uma empresa)."
  },
  {
    code: "AGR-CAD-PESSOA", table: "erp.people", name: "Pessoa", module: "CAD", kind: "entidade", globalId: true, route: "/cadastros/people/:id",
    description: "Cadastro unificado de pessoa física/jurídica; os papéis (fornecedor, cliente, funcionário, proprietário) são perfis dela."
  },
  {
    code: "AGR-CAD-ARMAZEM", table: "erp.warehouses", name: "Armazém", module: "CAD", kind: "entidade", globalId: false,
    description: "Local de guarda de estoque, pertencente a uma empresa."
  },

  // ---------- Estoque ----------
  {
    code: "AGR-EST-ENTRADA", table: "erp.input_entries", name: "Entrada Manual", module: "EST", kind: "entidade", globalId: true, route: "/estoque/entradas/:id",
    top: "Entrada de estoque sem documento fiscal", description: "Lançamento de entrada de produtos sem documento fiscal vinculado."
  },
  {
    code: "AGR-EST-ENTRADA-ITEM", table: "erp.input_entry_items", name: "Item da Entrada", module: "EST", kind: "linha", globalId: false,
    description: "Produto, quantidade e valor de uma entrada. Identidade pertence ao documento: nunca recebe ID Global."
  },
  {
    code: "AGR-EST-DOCUMENTO-FISCAL", table: "erp.invoices", name: "Documento Fiscal", module: "EST", kind: "entidade", globalId: true, route: "/estoque/documentos-fiscais/:id",
    top: "Entrada por documento fiscal", description: "Nota fiscal de entrada: itens, impostos, rateios e geração de estoque/financeiro."
  },
  {
    code: "AGR-EST-REQUISICAO", table: "erp.requisitions", name: "Requisição", module: "EST", kind: "entidade", globalId: true, route: "/estoque/requisicoes/:id",
    top: "Saída por requisição", description: "Consumo interno de produtos por centro de custo/área."
  },
  {
    code: "AGR-EST-SAIDA-DIRETA", table: "erp.stock_writeoffs", name: "Saída Direta", module: "EST", kind: "entidade", globalId: true, route: "/estoque/baixas/:id",
    top: "Baixa de estoque", description: "Baixa de estoque por perda, deterioração, doação e outros motivos."
  },
  {
    code: "AGR-EST-DEVOLUCAO", table: "erp.devolutions", name: "Devolução", module: "EST", kind: "entidade", globalId: true, route: "/estoque/devolucoes/:id",
    description: "Retorno de produtos ao estoque a partir de uma requisição."
  },
  {
    code: "AGR-EST-TRANSFERENCIA", table: "erp.warehouse_transfers", name: "Transferência", module: "EST", kind: "entidade", globalId: true, route: "/estoque/transferencias/:id",
    description: "Movimentação de produtos entre armazéns ou entre empresas.",
    migration: "Possui DUAS colunas de empresa (origem e destino): o escopo de leitura considera ambas."
  },
  {
    code: "AGR-EST-PRODUCAO-RACAO", table: "erp.feed_batches", name: "Produção de Ração", module: "EST", kind: "entidade", globalId: true, route: "/estoque/batidas/:id",
    description: "Produção de ração a partir de uma fórmula: consome insumos e gera produto acabado. Específico do nicho agro."
  },
  {
    code: "AGR-EST-MOVIMENTO", table: "erp.stock_movements", name: "Movimento de Estoque", module: "EST", kind: "infraestrutura", globalId: false,
    description: "Razão imutável de estoque (custo médio e saldo). Não é lançamento: é consequência contábil de um."
  },

  // ---------- Compras ----------
  {
    code: "AGR-CMP-SOLICITACAO", table: "erp.purchase_requests", name: "Solicitação de Compra", module: "CMP", kind: "entidade", globalId: true, route: "/suprimentos/view/:id",
    top: "Solicitação de compra", description: "Pedido interno de compra que percorre autorização, cotação e recebimento."
  },

  // ---------- Financeiro ----------
  {
    code: "AGR-FIN-TITULO", table: "erp.financial_titles", name: "Título Financeiro", module: "FIN", kind: "entidade", globalId: true, route: "/financeiro/contas-a-pagar/:id",
    top: "Conta a pagar / Conta a receber", description: "Obrigação ou direito financeiro. A coluna `direction` decide a tela (pagar/receber) — uma tabela, duas telas.",
    fields: { direction: { name: "Sentido", description: "payable = conta a pagar; receivable = conta a receber. Valor canônico: nunca traduzido no banco." } }
  },
  {
    code: "AGR-FIN-BAIXA", table: "erp.title_settlements", name: "Baixa de Título", module: "FIN", kind: "linha", globalId: false,
    description: "Pagamento/recebimento parcial ou total de um título. Identidade pertence ao título."
  },
  {
    code: "AGR-FIN-MOVIMENTO-BANCARIO", table: "erp.bank_movements", name: "Movimento Bancário", module: "FIN", kind: "entidade", globalId: true, route: "/financeiro/movimentos/:id",
    description: "Lançamento em conta bancária (transferência, tarifa, aplicação)."
  },
  {
    code: "AGR-FIN-IMPORTACAO-OFX", table: "erp.ofx_imports", name: "Importação OFX", module: "FIN", kind: "entidade", globalId: true, route: "/financeiro/ofx/:id",
    description: "Importação de extrato bancário para conciliação. Pertence à conta bancária, não a uma empresa."
  },

  // ---------- Vendas ----------
  {
    code: "AGR-VND-DOCUMENTO", table: "erp.sales_documents", name: "Documento de Venda", module: "VND", kind: "entidade", globalId: true, route: "/vendas/sales/:id",
    top: "Orçamento / Pedido / Venda", description: "Documento comercial. A coluna `kind` decide a etapa e a tela (orçamento, pedido, venda).",
    fields: { kind: { name: "Tipo", description: "budget | order | sale. Valor canônico persistido; o rótulo é traduzido na apresentação." } }
  },

  // ---------- Pecuária (específico do nicho) ----------
  {
    code: "AGR-PEC-ANIMAL", table: "erp.animals", name: "Animal", module: "PEC", kind: "entidade", globalId: true, route: "/pecuaria/animais/:id",
    description: "Animal identificado individualmente. Módulo específico do nicho agro (não faz parte do núcleo neutro)."
  },
  {
    code: "AGR-PEC-MOVIMENTACAO", table: "erp.animal_movements", name: "Movimentação de Rebanho", module: "PEC", kind: "entidade", globalId: true, route: "/pecuaria/movimentacoes/:movement_type/:id",
    description: "Entrada, saída, venda ou morte de animais. O tipo faz parte da rota canônica."
  },
  {
    code: "AGR-PEC-MANEJO", table: "erp.animal_handlings", name: "Manejo", module: "PEC", kind: "entidade", globalId: true, route: "/pecuaria/manejo/:handling_type/:id",
    description: "Manejo sanitário, nutricional ou reprodutivo aplicado a animais/lotes."
  },
  {
    code: "AGR-PEC-PESAGEM", table: "erp.weighings", name: "Pesagem", module: "PEC", kind: "entidade", globalId: true, route: "/pecuaria/pesagens/:id",
    description: "Evento de pesagem de animais, base de desempenho e ganho de peso."
  },

  // ---------- Frota e ativos ----------
  {
    code: "AGR-FRT-EQUIPAMENTO", table: "erp.equipments", name: "Equipamento", module: "FRT", kind: "entidade", globalId: true, route: "/cadastros/equipments/:id",
    description: "Bem/máquina da empresa, com depreciação e histórico de manutenção."
  },
  {
    code: "AGR-FRT-ABASTECIMENTO", table: "erp.fuel_supplies", name: "Abastecimento", module: "FRT", kind: "entidade", globalId: true, route: "/frota/abastecimentos/:id",
    top: "Abastecimento", description: "Consumo de combustível por equipamento, com baixa de estoque."
  },
  {
    code: "AGR-FRT-MANUTENCAO", table: "erp.maintenances", name: "Manutenção", module: "FRT", kind: "entidade", globalId: true, route: "/frota/manutencoes/:id",
    top: "Manutenção", description: "Serviço e peças aplicados a um ou mais equipamentos."
  },

  // ---------- Ordens de serviço ----------
  {
    code: "AGR-OS-ORDEM", table: "erp.service_orders", name: "Ordem de Serviço", module: "OS", kind: "entidade", globalId: true, route: "/os/:id",
    top: "Ordem de serviço", description: "Serviço planejado/executado com apontamento de recursos."
  }
]);

/** Índice por tabela. */
export const dictionaryByTable = () => new Map(DATA_DICTIONARY.map((e) => [e.table, e]));

/**
 * Validação estrutural + coerência com o schema real.
 * `schema`: Map<tabela, { columns: Map<coluna, ...> }> produzido pelo parser das migrations.
 * Devolve a lista de problemas (vazia = dicionário íntegro).
 */
export function validateDataDictionary(entries, schema) {
  const problems = [];
  const seenCode = new Set();
  const seenTable = new Set();
  const KIND = new Set(["entidade", "linha", "infraestrutura"]);
  for (const e of entries) {
    if (!/^AGR-[A-Z]{2,4}-[A-Z-]+$/.test(e.code)) problems.push(`${e.code}: código fora da taxonomia própria (AGR-<MÓDULO>-<ENTIDADE>)`);
    if (seenCode.has(e.code)) problems.push(`${e.code}: código duplicado`);
    seenCode.add(e.code);
    if (seenTable.has(e.table)) problems.push(`${e.table}: tabela duplicada no dicionário`);
    seenTable.add(e.table);
    if (!DICTIONARY_MODULES[e.module]) problems.push(`${e.code}: módulo desconhecido "${e.module}"`);
    if (!KIND.has(e.kind)) problems.push(`${e.code}: kind inválido "${e.kind}"`);
    if (!e.name || !e.description) problems.push(`${e.code}: nome funcional e descrição são obrigatórios`);
    if (e.globalId && e.kind !== "entidade") problems.push(`${e.code}: só entidade com identidade própria recebe ID Global`);
    if (e.globalId && !e.route) problems.push(`${e.code}: entidade com ID Global precisa de rota canônica`);
    const t = schema.get(e.table);
    if (!t) { problems.push(`${e.code}: tabela inexistente no schema: ${e.table}`); continue; }
    for (const col of Object.keys(e.fields ?? {})) {
      if (!t.columns.has(col)) problems.push(`${e.code}: coluna inexistente em ${e.table}: ${col}`);
    }
  }
  return problems;
}
