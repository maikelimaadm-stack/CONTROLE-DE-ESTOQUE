/**
 * CONTRATO DE ID GLOBAL (docs/GLOBAL-ID-CONTRACT.md).
 *
 * Todo registro de negócio COM IDENTIDADE PRÓPRIA para o usuário tem três identificadores:
 *   1. UUID técnico            — chave primária, nunca exibida como identidade;
 *   2. código/número da entidade — sequência por entidade (`erp.next_code`), quando aplicável;
 *   3. ID GLOBAL (#55)         — sequência ÚNICA por ORGANIZAÇÃO, compartilhada por todas as empresas dela.
 *
 * O ID Global é alocado pelo BANCO (`erp.next_global_id`), nunca pelo frontend, e não é derivado da URL:
 * a rota canônica é resolvida a partir do registro (`resolveGlobalRecordRoute`), e não o contrário.
 * Sequências de organizações diferentes são independentes (nunca há numeração única entre tenants).
 *
 * Elegibilidade é declarada AQUI, em um registry central — nunca por `if` espalhado pelas rotas.
 */

export interface GlobalIdEntity {
  /** Chave canônica estável do tipo de entidade (igual ao nome da tabela quando há 1:1). */
  entityType: string;
  label: string;
  module: string;
  table: string;
  /** Rota canônica de detalhe; `:id` é substituído pelo UUID do registro. */
  route: string;
  /**
   * Quando uma tabela atende a mais de uma tela, a rota depende de um discriminador do próprio registro
   * (ex.: `financial_titles.direction`). O resolvedor lê a coluna e escolhe a rota.
   */
  variants?: { column: string; routes: Readonly<Record<string, string>> };
  /**
   * Coluna que amarra o registro à EMPRESA. `null` = registro da organização inteira (cadastro compartilhado).
   * Hoje materializada como `farm_id` (ver docs/DOMAIN-NAMING-STANDARD.md); vira `empresa_id` em PRE-BASE2-03.
   */
  companyColumn: string | null;
  /** Permissão de leitura exigida para resolver o ID Global (mesma da tela de detalhe). */
  permission: string;
}

const E = (
  entityType: string, label: string, module: string, table: string, route: string,
  permission: string, companyColumn: string | null = "farm_id",
  variants?: GlobalIdEntity["variants"]
): GlobalIdEntity => (variants ? { entityType, label, module, table, route, permission, companyColumn, variants } : { entityType, label, module, table, route, permission, companyColumn });

/**
 * Entidades ELEGÍVEIS a ID Global (identidade própria e ciclo de vida próprio, consultáveis pelo usuário).
 * Acrescentar aqui é uma decisão de contrato: exige rota de detalhe real e permissão de leitura.
 */
export const GLOBAL_ID_ENTITIES: readonly GlobalIdEntity[] = [
  // Compras
  E("purchase_requests", "Solicitação de Compra", "compras", "erp.purchase_requests", "/suprimentos/view/:id", "purchase_requests.view"),
  // Estoque
  E("input_entries", "Entrada Manual", "estoque", "erp.input_entries", "/estoque/entradas/:id", "input_entries.view"),
  E("invoices", "Documento Fiscal", "estoque", "erp.invoices", "/estoque/documentos-fiscais/:id", "invoices.view"),
  E("requisitions", "Requisição", "estoque", "erp.requisitions", "/estoque/requisicoes/:id", "requisitions.view"),
  E("stock_writeoffs", "Saída Direta", "estoque", "erp.stock_writeoffs", "/estoque/baixas/:id", "stock_writeoffs.view"),
  E("devolutions", "Devolução", "estoque", "erp.devolutions", "/estoque/devolucoes/:id", "devolutions.view"),
  E("warehouse_transfers", "Transferência", "estoque", "erp.warehouse_transfers", "/estoque/transferencias/:id", "warehouse_transfers.view", "origin_farm_id"),
  E("feed_batches", "Produção de Ração", "estoque", "erp.feed_batches", "/estoque/batidas/:id", "feed_batches.view"),
  // Financeiro
  E("financial_titles", "Título Financeiro", "financeiro", "erp.financial_titles", "/financeiro/contas-a-pagar/:id", "payables.view", "farm_id",
    { column: "direction", routes: { payable: "/financeiro/contas-a-pagar/:id", receivable: "/financeiro/contas-a-receber/:id" } }),
  E("bank_movements", "Movimento Bancário", "financeiro", "erp.bank_movements", "/financeiro/movimentos/:id", "bank_movements.view"),
  E("ofx_imports", "Importação OFX", "financeiro", "erp.ofx_imports", "/financeiro/ofx/:id", "ofx_imports.view", null),
  // Vendas
  E("sales_documents", "Documento de Venda", "vendas", "erp.sales_documents", "/vendas/sales/:id", "sales.view", "farm_id",
    { column: "kind", routes: { budget: "/vendas/budgets/:id", order: "/vendas/orders/:id", sale: "/vendas/sales/:id" } }),
  // Pecuária
  E("animals", "Animal", "pecuaria", "erp.animals", "/pecuaria/animais/:id", "animals.view"),
  E("animal_movements", "Movimentação de Rebanho", "pecuaria", "erp.animal_movements", "/pecuaria/movimentacoes/:movement_type/:id", "animal_sales.view"),
  E("animal_handlings", "Manejo", "pecuaria", "erp.animal_handlings", "/pecuaria/manejo/:handling_type/:id", "sanitaries.view"),
  E("weighings", "Pesagem", "pecuaria", "erp.weighings", "/pecuaria/pesagens/:id", "weighings.view"),
  // Frota e ativos
  E("fuel_supplies", "Abastecimento", "frota", "erp.fuel_supplies", "/frota/abastecimentos/:id", "fuel_supplies.view"),
  E("maintenances", "Manutenção", "frota", "erp.maintenances", "/frota/manutencoes/:id", "maintenances.view"),
  E("equipments", "Equipamento", "frota", "erp.equipments", "/cadastros/equipments/:id", "equipments.view"),
  // Ordens de serviço
  E("service_orders", "Ordem de Serviço", "os", "erp.service_orders", "/os/:id", "service_orders.view"),
  // Cadastros compartilhados pela organização (sem empresa)
  E("products", "Produto", "cadastros", "erp.products", "/cadastros/products/:id", "products.view", null),
  E("people", "Pessoa", "cadastros", "erp.people", "/cadastros/people/:id", "people.view", null),
  E("roles", "Perfil de Acesso", "configuracoes", "erp.roles", "/admin/perfis/:id", "roles.view", null)
];

const BY_TYPE = new Map(GLOBAL_ID_ENTITIES.map((e) => [e.entityType, e]));

/**
 * Padrões de tabela NÃO elegíveis: linhas técnicas sem identidade própria para o usuário
 * (itens de documento, rateios, vínculos de associação, permissões de perfil).
 * Servem de guarda contra registry mal preenchido — ver `assertGlobalIdRegistry`.
 */
export const NON_ELIGIBLE_TABLE_PATTERNS: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /_items$/, reason: "item de documento: identidade pertence ao documento pai" },
  { pattern: /_lines$/, reason: "linha de documento: identidade pertence ao documento pai" },
  { pattern: /_apportionments$/, reason: "linha de rateio: estrutura interna do documento" },
  { pattern: /_permissions$/, reason: "vínculo perfil × permissão: sem identidade para o usuário" },
  { pattern: /^member_/, reason: "tabela de vínculo de membro: sem identidade para o usuário" },
  { pattern: /_members$/, reason: "tabela de vínculo: sem identidade para o usuário" },
  { pattern: /^(erp\.)?(code_sequences|global_id_sequences|idempotency_keys|audit_logs|erp_migrations)$/, reason: "infraestrutura interna" }
];

/** A tabela é técnica (linha auxiliar, vínculo, item)? Recebe o nome com ou sem o schema. */
export function isTechnicalTable(table: string): { technical: boolean; reason?: string } {
  const bare = table.replace(/^erp\./, "");
  for (const r of NON_ELIGIBLE_TABLE_PATTERNS) {
    if (r.pattern.test(bare) || r.pattern.test(table)) return { technical: true, reason: r.reason };
  }
  return { technical: false };
}

export const isGlobalIdEligible = (entityType: string): boolean => BY_TYPE.has(entityType);
export const globalIdEntity = (entityType: string): GlobalIdEntity | undefined => BY_TYPE.get(entityType);
export const globalIdEntityTypes = (): string[] => GLOBAL_ID_ENTITIES.map((e) => e.entityType);

export const GLOBAL_ID_PREFIX = "#";
/** ID Global é um inteiro positivo por organização; exibido com "#". */
export const formatGlobalId = (n: number | string): string => `${GLOBAL_ID_PREFIX}${String(n).replace(/^#/, "")}`;

/** Aceita "#55", "55" e " #55 ". Devolve null quando não for um ID Global válido (nunca lança). */
export function parseGlobalId(input: unknown): number | null {
  if (typeof input === "number") return Number.isSafeInteger(input) && input > 0 ? input : null;
  if (typeof input !== "string") return null;
  const m = /^\s*#?(\d{1,15})\s*$/.exec(input);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Rota canônica do registro. `row` é a linha do banco (usada só quando a entidade tem variantes ou a rota
 * tem parâmetros além de `:id`). Devolve null quando a entidade não é elegível ou falta um parâmetro.
 */
export function resolveGlobalRecordRoute(entityType: string, entityId: string, row: Readonly<Record<string, unknown>> = {}): string | null {
  const entity = BY_TYPE.get(entityType);
  if (!entity) return null;
  let template = entity.route;
  if (entity.variants) {
    const key = row[entity.variants.column];
    const variant = typeof key === "string" ? entity.variants.routes[key] : undefined;
    if (variant) template = variant;
  }
  let missing = false;
  const route = template.replace(/:([a-z_]+)/gi, (_, param: string) => {
    if (param === "id") return entityId;
    const v = row[param];
    if (v == null || v === "") { missing = true; return ""; }
    return encodeURIComponent(String(v));
  });
  return missing ? null : route;
}

/** Colunas que o resolvedor precisa ler além do id (discriminadores e parâmetros da rota). */
export function globalRecordRouteColumns(entity: GlobalIdEntity): string[] {
  const params = [...entity.route.matchAll(/:([a-z_]+)/gi)].map((m) => m[1]!).filter((p) => p !== "id");
  const variantParams = entity.variants
    ? [entity.variants.column, ...Object.values(entity.variants.routes).flatMap((r) => [...r.matchAll(/:([a-z_]+)/gi)].map((m) => m[1]!).filter((p) => p !== "id"))]
    : [];
  return [...new Set([...params, ...variantParams])];
}

/** Consistência do registry (usado pelos testes e pelo gate de nomenclatura). */
export function assertGlobalIdRegistry(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const e of GLOBAL_ID_ENTITIES) {
    if (seen.has(e.entityType)) problems.push(`entityType duplicado: ${e.entityType}`);
    seen.add(e.entityType);
    if (!e.table.startsWith("erp.")) problems.push(`${e.entityType}: tabela deve ser qualificada (erp.<tabela>)`);
    const tech = isTechnicalTable(e.table);
    if (tech.technical) problems.push(`${e.entityType}: ${tech.reason} — não deve receber ID Global`);
    if (!e.route.includes(":id")) problems.push(`${e.entityType}: rota canônica precisa conter :id`);
    if (!/^[a-z_]+\.[a-z_]+$/.test(e.permission)) problems.push(`${e.entityType}: permissão inválida (${e.permission})`);
  }
  return problems;
}
