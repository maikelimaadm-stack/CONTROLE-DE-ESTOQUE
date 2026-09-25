/**
 * DICIONÁRIO DE DADOS — METADADOS CURADOS (SSOT funcional).
 *
 * Divisão de trabalho deliberada, para que o dicionário não vire um documento manual impossível de manter:
 *   • a parte TÉCNICA (tabelas, colunas, tipos, nulidade, chaves, enums) é DERIVADA das migrations pelo
 *     gerador `scripts/data-dictionary.mjs` — nunca escrita à mão, nunca desatualiza;
 *   • a parte FUNCIONAL (nome funcional, descrição, módulo, tela, Tipo de Operação, observações de migração) é
 *     CURADA aqui, versionada em Git e auditada pelo gate (`node scripts/data-dictionary.mjs --check`).
 *
 * O gate recusa entrada que aponte para tabela/coluna inexistente: o dicionário não pode mentir sobre o schema.
 * Cobertura é incremental por design (DATA-GOV certifica 100%); acrescentar entidade aqui é sempre aditivo.
 *
 * Taxonomia PRÓPRIA e NEUTRA (docs/DOMAIN-NAMING-STANDARD.md): os códigos `ERP-<MÓDULO>-<ENTIDADE>` são nossos e
 * não amarram a plataforma a nenhum segmento de negócio (um prefixo de nicho no núcleo seria dívida arquitetural).
 * Não reproduzimos códigos, siglas ou numeração do sistema de referência.
 */

/**
 * Versão do formato do dicionário. Incrementar quando a forma das entradas mudar.
 * 2 (BASE2-02): `top` deixou de ser prosa livre e passou a ser a CHAVE canônica de uma TOP declarada em
 * `packages/domain/src/tipo-operacao.ts`. É mudança INCOMPATÍVEL de formato — quem lia o campo esperando
 * uma frase em português passa a receber `estoque.entrada_manual`.
 */
export const VERSAO_DICIONARIO = 2;

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
 *   codigo      código canônico próprio (ERP-<MÓDULO>-<ENTIDADE>)
 *   tabela      tabela real (erp.<nome>) — validada contra as migrations
 *   nome        nome funcional em português
 *   descricao   o que a entidade representa para o negócio
 *   modulo      chave de MODULOS_DICIONARIO
 *   natureza    "entidade" (identidade própria) | "linha" (estrutura interna) | "infraestrutura"
 *   idGlobal    recebe ID Global? (cruzado com ENTIDADES_ID_GLOBAL pelo teste de contrato)
 *   rota        rota canônica de detalhe, quando houver
 *   discriminador / rotas   coluna que decide a variante e a rota de cada valor
 *   top         CHAVE canônica do Tipo de Operação (BASE2-02), do registry `packages/domain/src/tipo-operacao.ts`.
 *               Referência estável, nunca prosa: era texto livre até a BASE2-02, e texto livre não tem
 *               unicidade, não resolve e não reprova quando diverge. Só entrada de natureza "entidade" a recebe.
 *   tops        quando a tabela tem VARIANTES, a lista das chaves — uma por variante. Exclusivo com `top`:
 *               "Conta a pagar / Conta a receber" numa string só era a forma de perder uma distinção real.
 *   discriminadorTop  coluna que decide qual das `tops` o registro é. Obrigatória com `tops`, proibida com `top`.
 *               É independente de `discriminador` (que decide ROTA): a transferência tem uma rota só e duas
 *               operações, e o título financeiro tem duas rotas e duas operações — os dois eixos coincidem
 *               às vezes, e tratá-los como um só apagaria o caso em que não coincidem.
 *   campos      overrides funcionais por coluna: { coluna: { nome, descricao } }
 *   migracao    observação de migração (renomeação para Empresa, nomenclatura, backfill)
 *
 * Os nomes de campo acima são os REAIS (em português). Até a BASE2-02 este bloco descrevia campos em
 * inglês (`code`, `table`, `name`, `kind`, `globalId`, `route`, `fields`) que o array nunca usou.
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
    codigo: "ERP-PLATAFORMA-EMPRESA", tabela: "erp.empresas", nome: "Empresa", modulo: "PLATAFORMA", natureza: "entidade", idGlobal: false,
    descricao: "Entidade operacional/jurídica dos registros: é a EMPRESA do contrato multiempresa. Tabela CANÔNICA desde PRE-BASE2-03; antes chamava-se `erp.farms`, nome herdado do nicho agro.",
    migracao: "PRE-BASE2-03: `erp.farms` renomeada para `erp.empresas`; o nome antigo continua como VIEW de compatibilidade (`security_invoker`) até nenhuma versão viva usá-lo. A coluna de empresa dos lançamentos é `empresa_id`, com `farm_id` como espelho sincronizado por gatilho.",
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
    codigo: "ERP-PLATAFORMA-EMPRESA-PERMITIDA", tabela: "erp.membro_empresas", nome: "Empresa Permitida", modulo: "PLATAFORMA", natureza: "linha", idGlobal: false,
    descricao: "Empresas que o vínculo pode acessar DENTRO DE UM MÓDULO, quando o modo daquele módulo é `selecionadas` (erp.membro_escopos_empresa). É a autoridade de autorização por empresa desde PRE-BASE2-02 — não existe mais lista vazia significando TODAS: `todas` é um modo explícito.",
    migracao: "PRE-BASE2-03: `erp.member_farms`, a autoridade anterior, foi APOSENTADA fisicamente; o conteúdo dela está em `erp.legado_escopo_empresa_v0` (arquivo morto, não é autoridade de nada)."
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
    descricao: "Item de estoque, insumo ou serviço. Compartilhado pela organização (não pertence a uma empresa). Ficha em abas (CADASTROS Fase 6, decisão 254).",
    campos: {
      controle_lote: { nome: "Controle de lote", descricao: "nenhum, lote (lote obrigatório na entrada e na saída) ou lote_validade (também exige validade na entrada). Mudar com saldo ≠ 0 é recusado." },
      has_lot: { nome: "Controla lote (legado)", descricao: "Derivado de controle_lote (controle ≠ nenhum). Gravar has_lot=true grava o controle 'lote'; false, 'nenhum'." },
      taxes: { nome: "Parâmetros fiscais", descricao: "Mesmas chaves dos tributos da Regra Fiscal. Chave desconhecida é preservada na edição (a API funde; só null remove)." }
    }
  },
  {
    codigo: "ERP-CADASTROS-PESSOA", tabela: "erp.people", nome: "Pessoa", modulo: "CADASTROS", natureza: "entidade", idGlobal: true, rota: "/cadastros/people/:id?view=1",
    descricao: "Cadastro unificado de pessoa física/jurídica; os papéis (fornecedor, cliente, funcionário, proprietário) são perfis dela.",
    campos: {
      document: { nome: "Documento", descricao: "CPF (11 dígitos) ou CNPJ (14 posições) normalizado: sem pontuação, maiúsculas. Desde a Fase 3 do CADASTROS o CNPJ pode ser ALFANUMÉRICO (IN RFB 2.229/2024: 12 primeiras posições dígitos ou letras, 2 DV dígitos) — o comentário \"somente dígitos\" da 0002 deixa de valer para CNPJ com letras. Regra única em packages/domain/src/documento.ts." },
      city_id: { nome: "Município", descricao: "Código IBGE do município (erp.cities), escolhido pela busca de Município." },
      bank_code: { nome: "Banco", descricao: "Código COMPE do banco (erp.banks), escolhido pela busca de Banco." }
    }
  },
  {
    codigo: "ERP-CADASTROS-REF-MUNICIPIO", tabela: "erp.cities", nome: "Município (IBGE)", modulo: "CADASTROS", natureza: "infraestrutura", idGlobal: false,
    descricao: "Referência oficial global, só leitura. Fonte: https://servicodados.ibge.gov.br/api/v1/localidades/municipios — baixado em 2026-09-24, 5.571 linhas, sha256 do bruto 86ecdccdf97d72e7e5e46f0854cfcea8bacc28154cc1bc4ed0e6110e3a6c9c02 (supabase/referencias/municipios.csv). UF pelos 2 primeiros dígitos do código IBGE.",
    campos: { id: { nome: "Código IBGE", descricao: "7 dígitos; os 2 primeiros são a UF." } }
  },
  {
    codigo: "ERP-CADASTROS-REF-UF", tabela: "erp.states", nome: "UF (IBGE)", modulo: "CADASTROS", natureza: "infraestrutura", idGlobal: false,
    descricao: "Referência oficial global. Fonte: https://servicodados.ibge.gov.br/api/v1/localidades/estados — baixado em 2026-09-24, 27 linhas, sha256 do bruto 7ca1368dea3af83cba1af84ae8a7e88f1173c97586831d086cc8b3c1ba9c6596."
  },
  {
    codigo: "ERP-CADASTROS-REF-BANCO", tabela: "erp.banks", nome: "Banco", modulo: "CADASTROS", natureza: "infraestrutura", idGlobal: false,
    descricao: "Referência oficial global. Fonte: BCB, lista de participantes do STR (https://www.bcb.gov.br/content/estabilidadefinanceira/str1/ParticipantesSTR.csv) — baixado em 2026-09-24, 463 participantes com código COMPE, sha256 do bruto 3073c905bcf196c56c78e5cd8244588b7781c6aa02fd8659027d7f5529e3abb9. Os códigos anteriores à carga (ex.: 000 Caixa Interno) continuam.",
    campos: { ispb: { nome: "ISPB", descricao: "Identificador do participante no SPB (8 dígitos); nulo fora da lista do STR." } }
  },
  {
    codigo: "ERP-CADASTROS-REF-NCM", tabela: "erp.ncm", nome: "NCM", modulo: "CADASTROS", natureza: "infraestrutura", idGlobal: false,
    descricao: "Referência oficial global. Fonte: Siscomex (https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json) — baixado em 2026-09-24, 15.156 linhas (10.515 de 8 dígitos), vigente em 24/09/2026 pela Resolução Gecex nº 926/2026, sha256 do bruto da9f6e28c09d4639322891d354a6441686d2dff4d1c7f4de1987277f0ea1df24. Só a NCM de 8 dígitos vigente é escolhível no produto.",
    campos: { code: { nome: "Código", descricao: "Só dígitos (2, 4, 5, 6, 7 ou 8)." }, nivel: { nome: "Nível", descricao: "Quantidade de dígitos do código." }, descricao_completa: { nome: "Descrição completa", descricao: "Da posição (4 dígitos) até o código, juntando os níveis de cima." } }
  },
  {
    codigo: "ERP-CADASTROS-REF-CBO", tabela: "erp.cbo_ocupacoes", nome: "Ocupação (CBO)", modulo: "CADASTROS", natureza: "infraestrutura", idGlobal: false,
    descricao: "Referência oficial global. Fonte: MTE (https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/cbo/servicos/downloads/cbo2002-ocupacao.csv, ISO-8859-1 convertido para UTF-8) — baixado em 2026-09-24, 2.694 ocupações, sha256 do bruto ad6d51d5d139125b15ea746464b2a39fa832ae295cdb6aa63dc7eddf2d2bed00."
  },
  {
    codigo: "ERP-CADASTROS-CACHE-CEP", tabela: "erp.consulta_cep_cache", nome: "Cache da consulta de CEP", modulo: "CADASTROS", natureza: "infraestrutura", idGlobal: false,
    descricao: "Cache global (30 dias) da consulta de CEP (ViaCEP, BrasilAPI). Só a API lê e grava."
  },
  {
    codigo: "ERP-CADASTROS-CACHE-CNPJ", tabela: "erp.consulta_cnpj_cache", nome: "Cache da consulta de CNPJ", modulo: "CADASTROS", natureza: "infraestrutura", idGlobal: false,
    descricao: "Cache global (7 dias) da consulta de CNPJ nas fontes gratuitas (BrasilAPI, CNPJá aberta, CNPJ.ws pública). Nunca guarda o quadro societário. Só a API lê e grava."
  },
  {
    codigo: "ERP-CADASTROS-PARCEIRO-ENDERECO", tabela: "erp.parceiro_enderecos", nome: "Endereço adicional do parceiro", modulo: "CADASTROS", natureza: "linha", idGlobal: false,
    descricao: "Endereços ADICIONAIS do parceiro (entrega, cobrança, propriedade, outro), gravados junto com a ficha (CADASTROS Fase 4, decisão 253). O principal continua nas colunas de erp.people. Linha removida da grade é excluída logicamente.",
    campos: { inscricao_estadual: { nome: "IE", descricao: "IE própria do endereço (produtor rural: uma por propriedade). Só formato: dígitos ou ISENTO." } }
  },
  {
    codigo: "ERP-CADASTROS-PARCEIRO-CONTATO", tabela: "erp.parceiro_contatos", nome: "Contato adicional do parceiro", modulo: "CADASTROS", natureza: "linha", idGlobal: false,
    descricao: "Contatos ADICIONAIS do parceiro (nome, função, telefones, e-mail, recebe NF-e por e-mail). O contato principal continua em erp.people."
  },
  {
    codigo: "ERP-CADASTROS-PARCEIRO-CONTA", tabela: "erp.parceiro_contas", nome: "Conta bancária adicional do parceiro", modulo: "CADASTROS", natureza: "linha", idGlobal: false,
    descricao: "Contas bancárias ADICIONAIS do parceiro (banco pela busca, agência, conta, tipo, titular, Pix). A principal continua nas colunas de erp.people."
  },
  {
    codigo: "ERP-CADASTROS-PRODUTO-UNIDADE", tabela: "erp.produto_unidades", nome: "Unidade alternativa do produto", modulo: "CADASTROS", natureza: "linha", idGlobal: false,
    descricao: "Unidades ALTERNATIVAS e embalagens do produto (unidade, multiplica/divide, fator > 0, código de barras, uso compra e/ou venda), gravadas junto com a ficha (CADASTROS Fase 6, decisão 254). Não repete a unidade padrão. A 2ª unidade antiga virou a primeira linha; erp.product_packages fica como legado."
  },
  {
    codigo: "ERP-CADASTROS-PRODUTO-FORNECEDOR", tabela: "erp.produto_fornecedores", nome: "Fornecedor do produto", modulo: "CADASTROS", natureza: "linha", idGlobal: false,
    descricao: "Fornecedores do produto (CADASTROS Fase 6): só parceiro com tipo Fornecedor, código do produto no fornecedor, unidade de compra e no máximo um preferencial."
  },
  {
    codigo: "ERP-CADASTROS-ARMAZEM", tabela: "erp.warehouses", nome: "Armazém", modulo: "CADASTROS", natureza: "entidade", idGlobal: false,
    descricao: "Local de guarda de estoque, pertencente a uma empresa."
  },

  // ---------- Estoque ----------
  {
    codigo: "ERP-ESTOQUE-ENTRADA", tabela: "erp.input_entries", nome: "Entrada Manual", modulo: "ESTOQUE", natureza: "entidade", idGlobal: true, rota: "/estoque/entradas/:id",
    top: "estoque.entrada_manual", descricao: "Lançamento de entrada de produtos sem documento fiscal vinculado."
  },
  {
    codigo: "ERP-ESTOQUE-ENTRADA-ITEM", tabela: "erp.input_entry_items", nome: "Item da Entrada", modulo: "ESTOQUE", natureza: "linha", idGlobal: false,
    descricao: "Produto, quantidade e valor de uma entrada. Identidade pertence ao documento: nunca recebe ID Global."
  },
  {
    codigo: "ERP-ESTOQUE-DOCUMENTO-FISCAL", tabela: "erp.invoices", nome: "Documento Fiscal", modulo: "ESTOQUE", natureza: "entidade", idGlobal: true, rota: "/estoque/documentos-fiscais/:id",
    top: "estoque.documento_fiscal", descricao: "Nota fiscal de entrada: itens, impostos, rateios e geração de estoque/financeiro."
  },
  {
    codigo: "ERP-ESTOQUE-REQUISICAO", tabela: "erp.requisitions", nome: "Requisição", modulo: "ESTOQUE", natureza: "entidade", idGlobal: true, rota: "/estoque/requisicoes/:id",
    top: "estoque.requisicao", descricao: "Consumo interno de produtos por centro de custo/área."
  },
  {
    codigo: "ERP-ESTOQUE-SAIDA-DIRETA", tabela: "erp.stock_writeoffs", nome: "Saída Direta", modulo: "ESTOQUE", natureza: "entidade", idGlobal: true, rota: "/estoque/baixas/:id",
    top: "estoque.baixa", descricao: "Baixa de estoque por perda, deterioração, doação e outros motivos."
  },
  {
    codigo: "ERP-ESTOQUE-DEVOLUCAO", tabela: "erp.devolutions", nome: "Devolução", modulo: "ESTOQUE", natureza: "entidade", idGlobal: true, rota: "/estoque/devolucoes/:id",
    top: "estoque.devolucao", descricao: "Retorno de produtos ao estoque a partir de uma requisição."
  },
  {
    codigo: "ERP-ESTOQUE-TRANSFERENCIA", tabela: "erp.warehouse_transfers", nome: "Transferência", modulo: "ESTOQUE", natureza: "entidade", idGlobal: true, rota: "/estoque/transferencias/:id",
    discriminadorTop: "kind", tops: ["estoque.transferencia_entre_armazens", "estoque.transferencia_entre_empresas"],
    descricao: "Movimentação de produtos entre armazéns ou entre empresas. A coluna `kind` decide QUAL das duas operações é: dentro da mesma empresa, ou atravessando a fronteira de empresa — a rota de detalhe é a mesma para as duas, a operação não.",
    migracao: "Possui DUAS colunas de empresa (origem e destino): o escopo de leitura considera ambas."
  },
  {
    codigo: "ERP-ESTOQUE-PRODUCAO-RACAO", tabela: "erp.feed_batches", nome: "Produção de Ração", modulo: "ESTOQUE", natureza: "entidade", idGlobal: true, rota: "/estoque/batidas/:id",
    top: "estoque.producao_de_racao", descricao: "Produção de ração a partir de uma fórmula: consome insumos e gera produto acabado. Específico do nicho agro."
  },
  {
    codigo: "ERP-ESTOQUE-MOVIMENTO", tabela: "erp.stock_movements", nome: "Movimento de Estoque", modulo: "ESTOQUE", natureza: "infraestrutura", idGlobal: false,
    descricao: "Razão imutável de estoque (custo médio e saldo). Não é lançamento: é consequência contábil de um."
  },

  // ---------- Compras ----------
  {
    codigo: "ERP-COMPRAS-SOLICITACAO", tabela: "erp.purchase_requests", nome: "Solicitação de Compra", modulo: "COMPRAS", natureza: "entidade", idGlobal: true, rota: "/suprimentos/view/:id",
    top: "compras.solicitacao", descricao: "Pedido interno de compra que percorre autorização, cotação e recebimento."
  },

  // ---------- Financeiro ----------
  {
    codigo: "ERP-FINANCEIRO-TITULO", tabela: "erp.financial_titles", nome: "Título Financeiro", modulo: "FINANCEIRO", natureza: "entidade", idGlobal: true,
    discriminador: "direction", rotas: { payable: "/financeiro/contas-a-pagar/:id", receivable: "/financeiro/contas-a-receber/:id" },
    discriminadorTop: "direction",
    tops: ["financeiro.conta_a_pagar", "financeiro.conta_a_receber"], descricao: "Obrigação ou direito financeiro. A coluna `direction` decide a tela (pagar/receber) — uma tabela, duas telas.",
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
    discriminadorTop: "kind",
    tops: ["vendas.orcamento", "vendas.pedido", "vendas.venda"], descricao: "Documento comercial. A coluna `kind` decide a etapa e a tela (orçamento, pedido, venda).",
    campos: {
      kind: { nome: "Tipo", descricao: "budget | order | sale. Valor canônico persistido; o rótulo é traduzido na apresentação." },
      categoria_financeira_id: { nome: "Categoria financeira", descricao: "Categoria de RECEITA analítica e ativa dos títulos a receber gerados pela confirmação. Anda em PAR com o centro de custo (os dois ou nenhum); FK composta com o tenant. Documento sem classificação confirma pelo padrão legado (decisão 248)." },
      centro_custo_id: { nome: "Centro de custo", descricao: "Centro de custo analítico e ativo dos títulos a receber gerados pela confirmação. Anda em PAR com a categoria financeira (os dois ou nenhum); FK composta com o tenant (decisão 248)." }
    }
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
    top: "frota_ativos.abastecimento", descricao: "Consumo de combustível por equipamento, com baixa de estoque."
  },
  {
    codigo: "ERP-FROTA-MANUTENCAO", tabela: "erp.maintenances", nome: "Manutenção", modulo: "FROTA", natureza: "entidade", idGlobal: true, rota: "/frota/manutencoes/:id",
    top: "frota_ativos.manutencao", descricao: "Serviço e peças aplicados a um ou mais equipamentos."
  },

  // ---------- Ordens de serviço ----------
  {
    codigo: "ERP-OS-ORDEM", tabela: "erp.service_orders", nome: "Ordem de Serviço", modulo: "OS", natureza: "entidade", idGlobal: true, rota: "/os/:id",
    top: "ordens_servico.ordem_de_servico", descricao: "Serviço planejado/executado com apontamento de recursos."
  }
]);

/**
 * Índice por tabela canônica. Devolve as MESMAS referências do SSOT, nunca cópias — quem indexa não
 * pode acabar lendo uma segunda versão da entrada.
 *
 * Esta função esteve QUEBRADA desde que nasceu: referenciava `DATA_DICTIONARY` e `e.table`, nomes que
 * nunca existiram neste arquivo (são `DICIONARIO_DE_DADOS` e `e.tabela`). Lançava `ReferenceError` a
 * qualquer chamada, e ninguém percebeu porque ninguém chamava — um exportado sem leitor não é testado
 * por acidente. Agora funciona e tem teste.
 */
export const dicionarioPorTabela = () => new Map(DICIONARIO_DE_DADOS.map((e) => [e.tabela, e]));

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
  // Dono de cada chave de TOP: a mesma operação não pode classificar duas entidades diferentes.
  const donoDaTop = new Map();
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

    // ---- Tipo de Operação (BASE2-02) ----
    // O dicionário valida a FORMA da referência e a coerência interna; que a chave EXISTA no registry e
    // que a origem dela aponte para esta mesma tabela é cruzado pelo teste de contrato
    // (packages/domain/test/tipo-operacao.test.ts), que lê o registry tipado sem depender de build.
    const tops = e.tops ?? (e.top === undefined ? [] : [e.top]);
    if (e.top !== undefined && e.tops) problemas.push(`${e.codigo}: declare \`top\` (uma operação) OU \`tops\` (uma por variante), nunca as duas`);
    if (tops.length && e.natureza !== "entidade") problemas.push(`${e.codigo}: só entidade recebe Tipo de Operação — "${e.natureza}" não é lançamento`);
    if (e.tops && !e.discriminadorTop) problemas.push(`${e.codigo}: \`tops\` exige \`discriminadorTop\` (a coluna que decide qual variante é)`);
    if (e.tops && e.tops.length < 2) problemas.push(`${e.codigo}: \`tops\` exige pelo menos duas variantes; use \`top\` para operação única`);
    if (e.discriminadorTop && !e.tops) problemas.push(`${e.codigo}: \`discriminadorTop\` sem \`tops\` não decide nada`);
    const vistasNaEntrada = new Set();
    for (const chave of tops) {
      if (typeof chave !== "string" || !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(chave)) {
        problemas.push(`${e.codigo}: Tipo de Operação precisa ser a CHAVE canônica <modulo>.<operacao>, não texto livre: "${String(chave)}"`);
        continue;
      }
      if (vistasNaEntrada.has(chave)) problemas.push(`${e.codigo}: Tipo de Operação repetido na mesma entrada: ${chave}`);
      vistasNaEntrada.add(chave);
      const dono = donoDaTop.get(chave);
      if (dono && dono !== e.codigo) problemas.push(`${e.codigo}: Tipo de Operação ${chave} já classifica ${dono}`);
      donoDaTop.set(chave, e.codigo);
    }

    const t = schema.get(e.tabela);
    if (!t) { problemas.push(`${e.codigo}: tabela inexistente no schema: ${e.tabela}`); continue; }
    if (e.discriminador && !t.columns.has(e.discriminador)) problemas.push(`${e.codigo}: coluna discriminadora inexistente em ${e.tabela}: ${e.discriminador}`);
    if (e.discriminadorTop && !t.columns.has(e.discriminadorTop)) problemas.push(`${e.codigo}: coluna discriminadora de Tipo de Operação inexistente em ${e.tabela}: ${e.discriminadorTop}`);
    for (const col of Object.keys(e.campos ?? {})) {
      if (!t.columns.has(col)) problemas.push(`${e.codigo}: coluna inexistente em ${e.tabela}: ${col}`);
    }
  }
  return problemas;
}
