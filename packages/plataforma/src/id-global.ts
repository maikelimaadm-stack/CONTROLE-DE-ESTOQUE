/**
 * CONTRATO DE ID GLOBAL (docs/GLOBAL-ID-CONTRACT.md).
 *
 * Todo registro de negócio COM IDENTIDADE PRÓPRIA tem três identificadores:
 *   1. UUID técnico             — chave primária, nunca exibida como identidade;
 *   2. código/número da entidade — sequência por entidade, quando aplicável;
 *   3. ID GLOBAL (#55)          — sequência ÚNICA por ORGANIZAÇÃO, compartilhada por todas as empresas dela.
 *
 * O ID Global é alocado pelo BANCO, nunca pelo cliente, e não é derivado da URL: a rota canônica é resolvida
 * a partir do REGISTRO. Sequências de organizações diferentes são independentes.
 *
 * PERMISSÃO É DO REGISTRO, NÃO DA ENTIDADE
 * ----------------------------------------
 * Há tabelas em que uma linha representa coisas com permissões diferentes: um título financeiro é conta a
 * pagar OU a receber; um documento de venda é orçamento, pedido OU venda; manejo e movimentação de rebanho
 * têm uma permissão por tipo. Uma permissão fixa por tabela produziria dois defeitos:
 *   (a) falso negativo — quem tem `receivables.view` não abriria um recebível;
 *   (b) VAZAMENTO — quem tem só `payables.view` abriria um recebível.
 * Por isso `resolucao` é uma união discriminada: numa entidade com variantes é impossível, pelo tipo, ler
 * uma permissão fixa. Rota e permissão saem SEMPRE da mesma coluna do mesmo registro, e valor fora do mapa
 * é negado (fail-closed), nunca resolvido por uma permissão mais ampla.
 */

/** Rota + permissão de uma variante concreta do registro. */
export interface VarianteEntidade {
  rota: string;
  permissao: string;
}

/**
 * Como rota e permissão são obtidas:
 *  - `fixa`: toda linha da tabela tem a mesma rota e a mesma permissão;
 *  - `variante`: a coluna discriminadora do próprio registro decide as duas, juntas.
 */
export type ResolucaoEntidade =
  | ({ tipo: "fixa" } & VarianteEntidade)
  | { tipo: "variante"; coluna: string; variantes: Readonly<Record<string, VarianteEntidade>> };

export interface EntidadeIdGlobal {
  /** Chave canônica estável do tipo de entidade (igual ao nome da tabela quando há 1:1). */
  tipoEntidade: string;
  rotulo: string;
  modulo: string;
  tabela: string;
  /**
   * Coluna que amarra o registro à EMPRESA; `null` = registro da organização inteira (cadastro compartilhado).
   * Nomes de coluna da infraestrutura legada que hoje materializa Empresa — dependência inventariada em
   * docs/FARM-DEPENDENCY-INVENTORY.md e substituída em PRE-BASE2-03 sem mudar este contrato.
   */
  colunaEmpresa: string | null;
  resolucao: ResolucaoEntidade;
}

const fixa = (rota: string, permissao: string): ResolucaoEntidade => ({ tipo: "fixa", rota, permissao });
const porVariante = (coluna: string, variantes: Readonly<Record<string, VarianteEntidade>>): ResolucaoEntidade => ({ tipo: "variante", coluna, variantes });

const E = (tipoEntidade: string, rotulo: string, modulo: string, tabela: string, resolucao: ResolucaoEntidade, colunaEmpresa: string | null = "farm_id"): EntidadeIdGlobal =>
  ({ tipoEntidade, rotulo, modulo, tabela, resolucao, colunaEmpresa });

/**
 * Modo de visualização dos cadastros genéricos (Modelo Base1): o ID Global é uma CONSULTA, então a rota
 * canônica abre o registro para VER, nunca no fluxo de edição.
 */
export const CONSULTA_CADASTRO = "?view=1";

/**
 * Entidades ELEGÍVEIS a ID Global (identidade própria e ciclo de vida próprio, consultáveis pelo usuário).
 * Acrescentar aqui é decisão de contrato: exige rota de detalhe real e permissão de leitura existente.
 */
export const ENTIDADES_ID_GLOBAL: readonly EntidadeIdGlobal[] = [
  // Compras
  E("purchase_requests", "Solicitação de Compra", "compras", "erp.purchase_requests", fixa("/suprimentos/view/:id", "purchase_requests.view")),
  // Estoque
  E("input_entries", "Entrada Manual", "estoque", "erp.input_entries", fixa("/estoque/entradas/:id", "input_entries.view")),
  E("invoices", "Documento Fiscal", "estoque", "erp.invoices", fixa("/estoque/documentos-fiscais/:id", "invoices.view")),
  E("requisitions", "Requisição", "estoque", "erp.requisitions", fixa("/estoque/requisicoes/:id", "requisitions.view")),
  E("stock_writeoffs", "Saída Direta", "estoque", "erp.stock_writeoffs", fixa("/estoque/baixas/:id", "stock_writeoffs.view")),
  E("devolutions", "Devolução", "estoque", "erp.devolutions", fixa("/estoque/devolucoes/:id", "devolutions.view")),
  E("warehouse_transfers", "Transferência", "estoque", "erp.warehouse_transfers", fixa("/estoque/transferencias/:id", "warehouse_transfers.view"), "origin_farm_id"),
  E("feed_batches", "Produção de Ração", "estoque", "erp.feed_batches", fixa("/estoque/batidas/:id", "feed_batches.view")),
  // Financeiro — uma tabela, duas telas e DUAS permissões distintas
  E("financial_titles", "Título Financeiro", "financeiro", "erp.financial_titles", porVariante("direction", {
    payable: { rota: "/financeiro/contas-a-pagar/:id", permissao: "payables.view" },
    receivable: { rota: "/financeiro/contas-a-receber/:id", permissao: "receivables.view" }
  })),
  E("bank_movements", "Movimento Bancário", "financeiro", "erp.bank_movements", fixa("/financeiro/movimentos/:id", "bank_movements.view")),
  E("ofx_imports", "Importação OFX", "financeiro", "erp.ofx_imports", fixa("/financeiro/ofx/:id", "ofx_imports.view"), null),
  // Vendas — orçamento, pedido e venda têm permissões próprias
  E("sales_documents", "Documento de Venda", "vendas", "erp.sales_documents", porVariante("kind", {
    budget: { rota: "/vendas/budgets/:id", permissao: "budgets.view" },
    order: { rota: "/vendas/orders/:id", permissao: "orders.view" },
    sale: { rota: "/vendas/sales/:id", permissao: "sales.view" }
  })),
  // Pecuária
  E("animals", "Animal", "pecuaria", "erp.animals", fixa("/pecuaria/animais/:id", "animals.view")),
  E("animal_movements", "Movimentação de Rebanho", "pecuaria", "erp.animal_movements", porVariante("movement_type", {
    purchase: { rota: "/pecuaria/movimentacoes/purchase/:id", permissao: "animal_purchases.view" },
    sale: { rota: "/pecuaria/movimentacoes/sale/:id", permissao: "animal_sales.view" },
    birth: { rota: "/pecuaria/movimentacoes/birth/:id", permissao: "animal_births.view" },
    death: { rota: "/pecuaria/movimentacoes/death/:id", permissao: "animal_deaths.view" },
    loss: { rota: "/pecuaria/movimentacoes/loss/:id", permissao: "animal_losses.view" }
  })),
  E("animal_handlings", "Manejo", "pecuaria", "erp.animal_handlings", porVariante("handling_type", {
    nutrition: { rota: "/pecuaria/manejo/nutrition/:id", permissao: "nutritions.view" },
    sanitary: { rota: "/pecuaria/manejo/sanitary/:id", permissao: "sanitaries.view" },
    weaning: { rota: "/pecuaria/manejo/weaning/:id", permissao: "weanings.view" },
    separation: { rota: "/pecuaria/manejo/separation/:id", permissao: "separations.view" },
    pasture: { rota: "/pecuaria/manejo/pasture/:id", permissao: "pastures.view" },
    locate: { rota: "/pecuaria/manejo/locate/:id", permissao: "locate_animals.view" }
  })),
  E("weighings", "Pesagem", "pecuaria", "erp.weighings", fixa("/pecuaria/pesagens/:id", "weighings.view")),
  // Frota e ativos
  E("fuel_supplies", "Abastecimento", "frota", "erp.fuel_supplies", fixa("/frota/abastecimentos/:id", "fuel_supplies.view")),
  E("maintenances", "Manutenção", "frota", "erp.maintenances", fixa("/frota/manutencoes/:id", "maintenances.view")),
  E("equipments", "Equipamento", "frota", "erp.equipments", fixa(`/cadastros/equipments/:id${CONSULTA_CADASTRO}`, "equipments.view")),
  // Ordens de serviço
  E("service_orders", "Ordem de Serviço", "os", "erp.service_orders", fixa("/os/:id", "service_orders.view")),
  // Cadastros compartilhados pela organização (sem empresa)
  E("products", "Produto", "cadastros", "erp.products", fixa(`/cadastros/products/:id${CONSULTA_CADASTRO}`, "products.view"), null),
  E("people", "Pessoa", "cadastros", "erp.people", fixa(`/cadastros/people/:id${CONSULTA_CADASTRO}`, "people.view"), null),
  E("roles", "Perfil de Acesso", "configuracoes", "erp.roles", fixa("/admin/perfis/:id", "roles.view"), null)
];

const POR_TIPO = new Map(ENTIDADES_ID_GLOBAL.map((e) => [e.tipoEntidade, e]));

/**
 * Padrões de tabela NÃO elegíveis: linhas técnicas sem identidade própria para o usuário
 * (itens de documento, rateios, vínculos de associação, permissões de perfil, infraestrutura).
 */
export const PADROES_TABELA_NAO_ELEGIVEL: readonly { padrao: RegExp; motivo: string }[] = [
  { padrao: /_items$/, motivo: "item de documento: identidade pertence ao documento pai" },
  { padrao: /_lines$/, motivo: "linha de documento: identidade pertence ao documento pai" },
  { padrao: /_apportionments$/, motivo: "linha de rateio: estrutura interna do documento" },
  { padrao: /_permissions$/, motivo: "vínculo perfil × permissão: sem identidade para o usuário" },
  { padrao: /^member_/, motivo: "tabela de vínculo de membro: sem identidade para o usuário" },
  { padrao: /_members$/, motivo: "tabela de vínculo: sem identidade para o usuário" },
  { padrao: /^(erp\.)?(code_sequences|sequencias_id_global|idempotency_keys|audit_logs|erp_migrations|registros_globais)$/, motivo: "infraestrutura interna" }
];

/** A tabela é técnica (linha auxiliar, vínculo, item)? Recebe o nome com ou sem o schema. */
export function tabelaTecnica(tabela: string): { tecnica: boolean; motivo?: string } {
  const nua = tabela.replace(/^erp\./, "");
  for (const r of PADROES_TABELA_NAO_ELEGIVEL) {
    if (r.padrao.test(nua) || r.padrao.test(tabela)) return { tecnica: true, motivo: r.motivo };
  }
  return { tecnica: false };
}

export const elegivelAIdGlobal = (tipoEntidade: string): boolean => POR_TIPO.has(tipoEntidade);
export const entidadeIdGlobal = (tipoEntidade: string): EntidadeIdGlobal | undefined => POR_TIPO.get(tipoEntidade);
export const tiposEntidadeIdGlobal = (): string[] => ENTIDADES_ID_GLOBAL.map((e) => e.tipoEntidade);

/** Coluna do registro que decide rota e permissão; null quando a entidade é fixa. */
export const colunaDiscriminadora = (entidade: EntidadeIdGlobal): string | null =>
  entidade.resolucao.tipo === "variante" ? entidade.resolucao.coluna : null;

/** Valores de variante declarados (vazio quando a entidade é fixa). */
export const variantesDeclaradas = (entidade: EntidadeIdGlobal): string[] =>
  entidade.resolucao.tipo === "variante" ? Object.keys(entidade.resolucao.variantes) : [];

export const PREFIXO_ID_GLOBAL = "#";
/** ID Global é um inteiro positivo por organização; exibido com "#". */
export const formatarIdGlobal = (n: number | string): string => `${PREFIXO_ID_GLOBAL}${String(n).replace(/^#/, "")}`;

/** Aceita "#55", "55" e " #55 ". Devolve null quando não for um ID Global válido (nunca lança). */
export function interpretarIdGlobal(entrada: unknown): number | null {
  if (typeof entrada === "number") return Number.isSafeInteger(entrada) && entrada > 0 ? entrada : null;
  if (typeof entrada !== "string") return null;
  const m = /^\s*#?(\d{1,15})\s*$/.exec(entrada);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Rota canônica + permissão exigida para ESTE registro. */
export interface RegistroResolvido {
  rota: string;
  permissao: string;
}

/**
 * Resolve rota e permissão a partir do REGISTRO — sempre juntas, sempre da mesma coluna.
 * `linha` é a linha do banco (só é consultada quando a entidade tem variantes).
 * Devolve `null` quando a entidade não é elegível, o discriminador está ausente ou o valor não está
 * declarado: o chamador NEGA (404). Nunca há queda para uma permissão mais ampla.
 */
export function resolverRegistroGlobal(tipoEntidade: string, idEntidade: string, linha: Readonly<Record<string, unknown>> = {}): RegistroResolvido | null {
  const entidade = POR_TIPO.get(tipoEntidade);
  if (!entidade) return null;
  const r = entidade.resolucao;
  if (r.tipo === "fixa") return { rota: r.rota.replace(":id", idEntidade), permissao: r.permissao };
  const valor = linha[r.coluna];
  if (typeof valor !== "string" || !valor) return null;
  const variante = r.variantes[valor];
  if (!variante) return null;
  return { rota: variante.rota.replace(":id", idEntidade), permissao: variante.permissao };
}

/** Consistência do registry (usada pelos testes e pelo gate). Lista vazia = registry íntegro. */
export function validarRegistroIdGlobal(): string[] {
  const problemas: string[] = [];
  const vistos = new Set<string>();
  const permValida = (p: string) => /^[a-z_]+\.[a-z_]+$/.test(p);
  const rotaValida = (r: string) => r.includes(":id") && r.startsWith("/");
  for (const e of ENTIDADES_ID_GLOBAL) {
    const onde = e.tipoEntidade;
    if (vistos.has(onde)) problemas.push(`${onde}: tipo de entidade duplicado`);
    vistos.add(onde);
    if (!e.tabela.startsWith("erp.")) problemas.push(`${onde}: tabela deve ser qualificada (erp.<tabela>)`);
    const tec = tabelaTecnica(e.tabela);
    if (tec.tecnica) problemas.push(`${onde}: ${tec.motivo} — não deve receber ID Global`);
    const r = e.resolucao;
    if (r.tipo === "fixa") {
      if (!rotaValida(r.rota)) problemas.push(`${onde}: rota canônica inválida (${r.rota})`);
      if (!permValida(r.permissao)) problemas.push(`${onde}: permissão inválida (${r.permissao})`);
    } else {
      if (!/^[a-z_]+$/.test(r.coluna)) problemas.push(`${onde}: coluna discriminadora inválida (${r.coluna})`);
      const valores = Object.entries(r.variantes);
      if (valores.length < 2) problemas.push(`${onde}: entidade com variantes precisa declarar pelo menos duas`);
      for (const [valor, v] of valores) {
        if (!rotaValida(v.rota)) problemas.push(`${onde}[${valor}]: rota canônica inválida (${v.rota})`);
        if (!permValida(v.permissao)) problemas.push(`${onde}[${valor}]: permissão inválida (${v.permissao})`);
      }
      const permissoes = new Set(valores.map(([, v]) => v.permissao));
      if (permissoes.size === 1) problemas.push(`${onde}: todas as variantes têm a mesma permissão — use resolução fixa`);
    }
  }
  return problemas;
}
