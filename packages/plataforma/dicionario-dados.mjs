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
 * Taxonomia PRÓPRIA e NEUTRA (docs/DOMAIN-NAMING-STANDARD.md): os códigos `ERP-<MÓDULO>-<ENTIDADE>` são nossos e
 * não amarram a plataforma a nenhum segmento de negócio (um prefixo de nicho no núcleo seria dívida arquitetural).
 * Não reproduzimos códigos, siglas ou numeração do sistema de referência.
 */

/** Versão do formato do dicionário. Incrementar quando a forma das entradas mudar. */
export const VERSAO_DICIONARIO = 1;

/** Módulos da taxonomia própria (prefixo dos códigos canônicos). */
export const MODULOS_DICIONARIO = Object.freeze({
  PLATAFORMA: "Plataforma",
  CADASTROS: "Cadastros",
  ESTOQUE: "Estoque",
  COMPRAS: "Compras",
  FINANCEIRO: "Financeiro",
  VENDAS: "Vendas",
  PECUARIA: "Pecuária",
  FROTA: "Frota e Ativos",
  OS: "Ordens de Serviço",
  RH: "Pessoas e RH"
});

/**
 * Entrada por ENTIDADE (tabela). Campos:
 *   code        código canônico próprio (ERP-<MÓDULO>-<ENTIDADE>)
 *   table       tabela real (erp.<nome>) — validada contra as migrations
 *   name        nome funcional em português
 *   description o que a entidade representa para o negócio
 *   module      chave de DICTIONARY_MODULES
 *   kind        "entidade" (identidade própria) | "linha" (estrutura interna) | "infraestrutura"
 *   globalId    recebe ID Global? (cruzado com ENTIDADES_ID_GLOBAL pelo teste de contrato)
 *   route       rota canônica de detalhe, quando houver
 *   top         TOP futura que classificará o lançamento (contrato — ainda não implementada)
 *   fields      overrides funcionais por coluna: { coluna: { name, description } }
 *   migracao    observação de migração (renomeação para Empresa, nomenclatura, backfill)
 */
export const DICIONARIO_DE_DADOS = Object.freeze([
  // ---------- Plataforma (núcleo neutro de nicho) ----------
  {
    codigo: "ERP-PLATAFORMA-ORGANIZACAO", tabela: "erp.organizations", nome: "Organização", modulo: "PLATAFORMA", natureza: "entidade", idGlobal: false,
    descricao: "Tenant do ERP: o cliente contratante. Agrupa empresas, usuários, permissões e a sequência de ID Global. Nunca se confunde com Empresa.",
    campos: {
      name: { nome: "Nome", descricao: "Nome do grupo/contratante." },
      document: { nome: "Documento", descricao: "CNPJ/CPF do contratante." },
      parameters: { nome: "Parâmetros", descricao: "Parametrizações do tenant (JSON)." },
      idioma_padrao: { nome: "Idioma padrão", descricao: "Idioma padrão da organização (BCP 47). Usuário pode sobrepor." }
    }
  },
  {
    codigo: "ERP-PLATAFORMA-EMPRESA", tabela: "erp.farms", nome: "Empresa", modulo: "PLATAFORMA", natureza: "entidade", idGlobal: false,
    descricao: "Entidade operacional/jurídica dos registros: é a EMPRESA do contrato multiempresa. Hoje materializada na tabela `farms` (nome herdado do nicho agro).",
    migracao: "PRE-BASE2-02/03: renomeada para empresa/`empresa_id` com camada de compatibilidade. Não renomear em massa antes do plano de migração.",
    campos: {
      code: { nome: "Código", descricao: "Código curto da empresa dentro da organização." },
      name: { nome: "Nome", descricao: "Nome da empresa." },
      document: { nome: "Documento", descricao: "CNPJ/CPF da empresa." }
    }
  },
  {
    codigo: "ERP-PLATAFORMA-USUARIO", tabela: "erp.users", nome: "Usuário", modulo: "PLATAFORMA", natureza: "entidade", idGlobal: false,
    descricao: "Pessoa que acessa o sistema. Autenticação local (desenvolvimento/teste) ou provedor externo.",
    campos: { idioma: { nome: "Idioma", descricao: "Idioma preferido do usuário (BCP 47). Vazio = idioma da organização." } }
  },
  {
    codigo: "ERP-PLATAFORMA-VINCULO", tabela: "erp.organization_members", nome: "Vínculo de Usuário", modulo: "PLATAFORMA", natureza: "linha", idGlobal: false,
    descricao: "Vínculo usuário × organização com perfil de acesso. Sem identidade própria para o usuário final."
  },
  {
    codigo: "ERP-PLATAFORMA-EMPRESA-PERMITIDA", tabela: "erp.member_farms", nome: "Empresa Permitida", modulo: "PLATAFORMA", natureza: "linha", idGlobal: false,
    descricao: "Empresas que o vínculo pode acessar. Lista vazia significa TODAS as empresas da organização. É a autoridade de autorização por empresa.",
    migracao: "PRE-BASE2-02: vira `member_empresas` (ou equivalente) mantendo a semântica de lista vazia = todas."
  },
  {
    codigo: "ERP-PLATAFORMA-PERFIL", tabela: "erp.roles", nome: "Perfil de Acesso", modulo: "PLATAFORMA", natureza: "entidade", idGlobal: true, rota: "/admin/perfis/:id",
    descricao: "Conjunto de permissões atribuível a usuários da organização."
  },
  {
    codigo: "ERP-PLATAFORMA-PERMISSAO-PERFIL", tabela: "erp.role_permissions", nome: "Permissão do Perfil", modulo: "PLATAFORMA", natureza: "linha", idGlobal: false,
    descricao: "Vínculo perfil × chave de permissão. Estrutura interna: nunca recebe ID Global."
  },
  {
    codigo: "ERP-PLATAFORMA-AUDITORIA", tabela: "erp.audit_logs", nome: "Registro de Auditoria", modulo: "PLATAFORMA", natureza: "infraestrutura", idGlobal: false,
    descricao: "Trilha imutável de eventos (criação, alteração, cancelamento, login) por organização e usuário."
  },
  {
    codigo: "ERP-PLATAFORMA-SEQUENCIA-CODIGO", tabela: "erp.code_sequences", nome: "Sequência de Código", modulo: "PLATAFORMA", natureza: "infraestrutura", idGlobal: false,
    descricao: "Contador por organização × entidade que gera o código/número próprio de cada entidade."
  },
  {
    codigo: "ERP-PLATAFORMA-SEQUENCIA-ID-GLOBAL", tabela: "erp.sequencias_id_global", nome: "Sequência de ID Global", modulo: "PLATAFORMA", natureza: "infraestrutura", idGlobal: false,
    descricao: "Contador ÚNICO por organização que gera o ID Global. Compartilhado por todas as empresas da organização; independente entre organizações."
  },
  {
    codigo: "ERP-PLATAFORMA-REGISTRO-GLOBAL", tabela: "erp.registros_globais", nome: "Registro Global", modulo: "PLATAFORMA", natureza: "infraestrutura", idGlobal: false,
    descricao: "Índice que resolve um ID Global no registro real: organização, empresa, tipo de entidade, UUID, módulo e rota canônica.",
    campos: {
      id_global: { nome: "ID Global", descricao: "Número sequencial por organização, exibido como #55." },
      tipo_entidade: { nome: "Tipo de Entidade", descricao: "Chave canônica do tipo (registry de elegibilidade em @erp/plataforma)." },
      rota_canonica: { nome: "Rota Canônica", descricao: "Rota de detalhe resolvida na criação; a URL deriva do registro. Entidade com variantes é reresolvida na leitura." }
    }
  },

  // ---------- Cadastros ----------
  {
    codigo: "ERP-CADASTROS-PRODUTO", tabela: "erp.products", nome: "Produto", modulo: "CADASTROS", natureza: "entidade", idGlobal: true, rota: "/cadastros/products/:id?view=1",
    descricao: "Item de estoque, insumo ou serviço. Compartilhado pela organização (não pertence a uma empresa)."
  },
  {
    codigo: "ERP-CADASTROS-PESSOA", tabela: "erp.people", nome: "Pessoa", modulo: "CADASTROS", natureza: "entidade", idGlobal: true, rota: "/cadastros/people/:id?view=1",
    descricao: "Cadastro unificado de pessoa física/jurídica; os papéis (fornecedor, cliente, funcionário, proprietário) são perfis dela."
  },
  {
    codigo: "ERP-CADASTROS-ARMAZEM", tabela: "erp.warehouses", nome: "Armazém", modulo: "CADASTROS", natureza: "entidade", idGlobal: false,
    descricao: "Local de guarda de estoque, pertencente a uma empresa."
  },

  // ---------- Estoque ----------
  {
    codigo: "ERP-ESTOQUE-ENTRADA", tabela: "erp.input_entries", nome: "Entrada Manual", modulo: "ESTOQUE", natureza: "entidade", idGlobal: true, rota: "/estoque/entradas/:id",
    top: "Entrada de estoque sem documento fiscal", descricao: "Lançamento de entrada de produtos sem documento fiscal vinculado."
  },
  {
    codigo: "ERP-ESTOQUE-ENTRADA-ITEM", tabela: "erp.input_entry_items", nome: "Item da Entrada", modulo: "ESTOQUE", natureza: "linha", idGlobal: false,
    descricao: "Produto, quantidade e valor de uma entrada. Identidade pertence ao documento: nunca recebe ID Global."
  },
  {
    codigo: "ERP-ESTOQUE-DOCUMENTO-FISCAL", tabela: "erp.invoices", nome: "Documento Fiscal", modulo: "ESTOQUE", natureza: "entidade", idGlobal: true, rota: "/estoque/documentos-fiscais/:id",
    top: "Entrada por documento fiscal", descricao: "Nota fiscal de entrada: itens, impostos, rateios e geração de estoque/financeiro."
  },
  {
    codigo: "ERP-ESTOQUE-REQUISICAO", tabela: "erp.requisitions", nome: "Requisição", modulo: "ESTOQUE", natureza: "entidade", idGlobal: true, rota: "/estoque/requisicoes/:id",
    top: "Saída por requisição", descricao: "Consumo interno de produtos por centro de custo/área."
  },
  {
    codigo: "ERP-ESTOQUE-SAIDA-DIRETA", tabela: "erp.stock_writeoffs", nome: "Saída Direta", modulo: "ESTOQUE", natureza: "entidade", idGlobal: true, rota: "/estoque/baixas/:id",
    top: "Baixa de estoque", descricao: "Baixa de estoque por perda, deterioração, doação e outros motivos."
  },
  {
    codigo: "ERP-ESTOQUE-DEVOLUCAO", tabela: "erp.devolutions", nome: "Devolução", modulo: "ESTOQUE", natureza: "entidade", idGlobal: true, rota: "/estoque/devolucoes/:id",
    descricao: "Retorno de produtos ao estoque a partir de uma requisição."
  },
  {
    codigo: "ERP-ESTOQUE-TRANSFERENCIA", tabela: "erp.warehouse_transfers", nome: "Transferência", modulo: "ESTOQUE", natureza: "entidade", idGlobal: true, rota: "/estoque/transferencias/:id",
    descricao: "Movimentação de produtos entre armazéns ou entre empresas.",
    migracao: "Possui DUAS colunas de empresa (origem e destino): o escopo de leitura considera ambas."
  },
  {
    codigo: "ERP-ESTOQUE-PRODUCAO-RACAO", tabela: "erp.feed_batches", nome: "Produção de Ração", modulo: "ESTOQUE", natureza: "entidade", idGlobal: true, rota: "/estoque/batidas/:id",
    descricao: "Produção de ração a partir de uma fórmula: consome insumos e gera produto acabado. Específico do nicho agro."
  },
  {
    codigo: "ERP-ESTOQUE-MOVIMENTO", tabela: "erp.stock_movements", nome: "Movimento de Estoque", modulo: "ESTOQUE", natureza: "infraestrutura", idGlobal: false,
    descricao: "Razão imutável de estoque (custo médio e saldo). Não é lançamento: é consequência contábil de um."
  },

  // ---------- Compras ----------
  {
    codigo: "ERP-COMPRAS-SOLICITACAO", tabela: "erp.purchase_requests", nome: "Solicitação de Compra", modulo: "COMPRAS", natureza: "entidade", idGlobal: true, rota: "/suprimentos/view/:id",
    top: "Solicitação de compra", descricao: "Pedido interno de compra que percorre autorização, cotação e recebimento."
  },

  // ---------- Financeiro ----------
  {
    codigo: "ERP-FINANCEIRO-TITULO", tabela: "erp.financial_titles", nome: "Título Financeiro", modulo: "FINANCEIRO", natureza: "entidade", idGlobal: true,
    discriminador: "direction", rotas: { payable: "/financeiro/contas-a-pagar/:id", receivable: "/financeiro/contas-a-receber/:id" },
    top: "Conta a pagar / Conta a receber", descricao: "Obrigação ou direito financeiro. A coluna `direction` decide a tela (pagar/receber) — uma tabela, duas telas.",
    campos: { direction: { nome: "Sentido", descricao: "payable = conta a pagar; receivable = conta a receber. Valor canônico: nunca traduzido no banco." } }
  },
  {
    codigo: "ERP-FINANCEIRO-BAIXA", tabela: "erp.title_settlements", nome: "Baixa de Título", modulo: "FINANCEIRO", natureza: "linha", idGlobal: false,
    descricao: "Pagamento/recebimento parcial ou total de um título. Identidade pertence ao título."
  },
  {
    codigo: "ERP-FINANCEIRO-MOVIMENTO-BANCARIO", tabela: "erp.bank_movements", nome: "Movimento Bancário", modulo: "FINANCEIRO", natureza: "entidade", idGlobal: true, rota: "/financeiro/movimentos/:id",
    descricao: "Lançamento em conta bancária (transferência, tarifa, aplicação)."
  },
  {
    codigo: "ERP-FINANCEIRO-IMPORTACAO-OFX", tabela: "erp.ofx_imports", nome: "Importação OFX", modulo: "FINANCEIRO", natureza: "entidade", idGlobal: true, rota: "/financeiro/ofx/:id",
    descricao: "Importação de extrato bancário para conciliação. Pertence à conta bancária, não a uma empresa."
  },

  // ---------- Vendas ----------
  {
    codigo: "ERP-VENDAS-DOCUMENTO", tabela: "erp.sales_documents", nome: "Documento de Venda", modulo: "VENDAS", natureza: "entidade", idGlobal: true,
    discriminador: "kind", rotas: { budget: "/vendas/budgets/:id", order: "/vendas/orders/:id", sale: "/vendas/sales/:id" },
    top: "Orçamento / Pedido / Venda", descricao: "Documento comercial. A coluna `kind` decide a etapa e a tela (orçamento, pedido, venda).",
    campos: { kind: { nome: "Tipo", descricao: "budget | order | sale. Valor canônico persistido; o rótulo é traduzido na apresentação." } }
  },

  // ---------- Pecuária (específico do nicho) ----------
  {
    codigo: "ERP-PECUARIA-ANIMAL", tabela: "erp.animals", nome: "Animal", modulo: "PECUARIA", natureza: "entidade", idGlobal: true, rota: "/pecuaria/animais/:id",
    descricao: "Animal identificado individualmente. Módulo específico do nicho agro (não faz parte do núcleo neutro)."
  },
  {
    codigo: "ERP-PECUARIA-MOVIMENTACAO", tabela: "erp.animal_movements", nome: "Movimentação de Rebanho", modulo: "PECUARIA", natureza: "entidade", idGlobal: true,
    discriminador: "movement_type", rotas: { purchase: "/pecuaria/movimentacoes/purchase/:id", sale: "/pecuaria/movimentacoes/sale/:id", birth: "/pecuaria/movimentacoes/birth/:id", death: "/pecuaria/movimentacoes/death/:id", loss: "/pecuaria/movimentacoes/loss/:id" },
    descricao: "Entrada, saída, venda ou morte de animais. O tipo faz parte da rota canônica."
  },
  {
    codigo: "ERP-PECUARIA-MANEJO", tabela: "erp.animal_handlings", nome: "Manejo", modulo: "PECUARIA", natureza: "entidade", idGlobal: true,
    discriminador: "handling_type", rotas: { nutrition: "/pecuaria/manejo/nutrition/:id", sanitary: "/pecuaria/manejo/sanitary/:id", weaning: "/pecuaria/manejo/weaning/:id", separation: "/pecuaria/manejo/separation/:id", pasture: "/pecuaria/manejo/pasture/:id", locate: "/pecuaria/manejo/locate/:id" },
    descricao: "Manejo sanitário, nutricional ou reprodutivo aplicado a animais/lotes."
  },
  {
    codigo: "ERP-PECUARIA-PESAGEM", tabela: "erp.weighings", nome: "Pesagem", modulo: "PECUARIA", natureza: "entidade", idGlobal: true, rota: "/pecuaria/pesagens/:id",
    descricao: "Evento de pesagem de animais, base de desempenho e ganho de peso."
  },

  // ---------- Frota e ativos ----------
  {
    codigo: "ERP-FROTA-EQUIPAMENTO", tabela: "erp.equipments", nome: "Equipamento", modulo: "FROTA", natureza: "entidade", idGlobal: true, rota: "/cadastros/equipments/:id?view=1",
    descricao: "Bem/máquina da empresa, com depreciação e histórico de manutenção."
  },
  {
    codigo: "ERP-FROTA-ABASTECIMENTO", tabela: "erp.fuel_supplies", nome: "Abastecimento", modulo: "FROTA", natureza: "entidade", idGlobal: true, rota: "/frota/abastecimentos/:id",
    top: "Abastecimento", descricao: "Consumo de combustível por equipamento, com baixa de estoque."
  },
  {
    codigo: "ERP-FROTA-MANUTENCAO", tabela: "erp.maintenances", nome: "Manutenção", modulo: "FROTA", natureza: "entidade", idGlobal: true, rota: "/frota/manutencoes/:id",
    top: "Manutenção", descricao: "Serviço e peças aplicados a um ou mais equipamentos."
  },

  // ---------- Ordens de serviço ----------
  {
    codigo: "ERP-OS-ORDEM", tabela: "erp.service_orders", nome: "Ordem de Serviço", modulo: "OS", natureza: "entidade", idGlobal: true, rota: "/os/:id",
    top: "Ordem de serviço", descricao: "Serviço planejado/executado com apontamento de recursos."
  }
]);

/** Índice por tabela. */
export const dicionarioPorTabela = () => new Map(DATA_DICTIONARY.map((e) => [e.table, e]));

/**
 * Validação estrutural + coerência com o schema real.
 * `schema`: Map<tabela, { columns: Map<coluna, ...> }> produzido pelo parser das migrations.
 * Devolve a lista de problemas (vazia = dicionário íntegro).
 */
export function validarDicionarioDeDados(entradas, schema) {
  const problemas = [];
  const codigosVistos = new Set();
  const tabelasVistas = new Set();
  const NATUREZA = new Set(["entidade", "linha", "infraestrutura"]);
  for (const e of entradas) {
    if (!/^ERP-[A-Z]{2,12}-[A-Z-]+$/.test(e.codigo)) problemas.push(`${e.codigo}: código fora da taxonomia própria (ERP-<MÓDULO>-<ENTIDADE>)`);
    if (codigosVistos.has(e.codigo)) problemas.push(`${e.codigo}: código duplicado`);
    codigosVistos.add(e.codigo);
    if (tabelasVistas.has(e.tabela)) problemas.push(`${e.tabela}: tabela duplicada no dicionário`);
    tabelasVistas.add(e.tabela);
    if (!MODULOS_DICIONARIO[e.modulo]) problemas.push(`${e.codigo}: módulo desconhecido "${e.modulo}"`);
    if (!NATUREZA.has(e.natureza)) problemas.push(`${e.codigo}: natureza inválida "${e.natureza}"`);
    if (!e.nome || !e.descricao) problemas.push(`${e.codigo}: nome funcional e descrição são obrigatórios`);
    if (e.idGlobal && e.natureza !== "entidade") problemas.push(`${e.codigo}: só entidade com identidade própria recebe ID Global`);
    const rotasVariante = Object.keys(e.rotas ?? {});
    if (e.idGlobal && !e.rota && !rotasVariante.length) problemas.push(`${e.codigo}: entidade com ID Global precisa de rota canônica`);
    if (e.rota && e.rotas) problemas.push(`${e.codigo}: declare rota fixa OU rotas por variante, nunca as duas`);
    if (e.rotas && !e.discriminador) problemas.push(`${e.codigo}: rotas por variante exigem a coluna discriminadora`);
    if (e.rotas && rotasVariante.length < 2) problemas.push(`${e.codigo}: rotas por variante exigem pelo menos dois valores`);
    const t = schema.get(e.tabela);
    if (!t) { problemas.push(`${e.codigo}: tabela inexistente no schema: ${e.tabela}`); continue; }
    if (e.discriminador && !t.columns.has(e.discriminador)) problemas.push(`${e.codigo}: coluna discriminadora inexistente em ${e.tabela}: ${e.discriminador}`);
    for (const col of Object.keys(e.campos ?? {})) {
      if (!t.columns.has(col)) problemas.push(`${e.codigo}: coluna inexistente em ${e.tabela}: ${col}`);
    }
  }
  return problemas;
}
