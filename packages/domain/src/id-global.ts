/**
 * CATÁLOGO DE ENTIDADES COM ID GLOBAL — CONFIGURAÇÃO DESTE PRODUTO.
 *
 * O MECANISMO (tipos, resolução de rota+permissão, validação) vive em `@erp/plataforma`, neutro de segmento.
 * A LISTA de entidades é configuração de produto e vive aqui, no domínio — que pode conhecer as tabelas, os
 * módulos e as permissões deste ERP. A dependência é unidirecional: o domínio importa a plataforma, nunca o
 * contrário (docs/PRE-BASE2-FOUNDATION.md).
 *
 * `exclusaoLogica` reflete o schema real: quando a tabela esconde excluídos, o ID Global enxerga o mesmo que
 * a rota canônica — registro excluído não vira atalho navegável (docs/GLOBAL-ID-CONTRACT.md).
 */
import {
  resolverRegistroDaEntidade, validarEntidadesIdGlobal,
  type EntidadeIdGlobal, type RegistroResolvido, type ResolucaoEntidade, type VarianteEntidade
} from "@erp/plataforma";
import { MANEJOS_REBANHO, MOVIMENTACOES_REBANHO, type OperacaoRebanho } from "./rebanho.js";

/**
 * Modo de visualização dos cadastros genéricos (Modelo Base1): o ID Global é uma CONSULTA, então a rota
 * canônica abre o registro para VER, nunca no fluxo de edição.
 */
export const CONSULTA_CADASTRO = "?view=1";

const fixa = (rota: string, permissao: string): ResolucaoEntidade => ({ tipo: "fixa", rota, permissao });
const porVariante = (coluna: string, variantes: Readonly<Record<string, VarianteEntidade>>): ResolucaoEntidade => ({ tipo: "variante", coluna, variantes });
/** Variantes derivadas da fonte única de operações de rebanho — nunca copiadas à mão. */
const variantesDeOperacoes = (operacoes: readonly OperacaoRebanho[]): Readonly<Record<string, VarianteEntidade>> =>
  Object.fromEntries(operacoes.map((o) => [o.tipo, { rota: o.rota, permissao: `${o.recurso}.view` }]));

const E = (
  tipoEntidade: string, rotulo: string, modulo: string, tabela: string, resolucao: ResolucaoEntidade,
  opts: { colunaEmpresa?: string | null; exclusaoLogica?: boolean } = {}
): EntidadeIdGlobal => ({
  tipoEntidade, rotulo, modulo, tabela, resolucao,
  colunaEmpresa: opts.colunaEmpresa === undefined ? "farm_id" : opts.colunaEmpresa,
  exclusaoLogica: opts.exclusaoLogica ?? true
});

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
  E("warehouse_transfers", "Transferência", "estoque", "erp.warehouse_transfers", fixa("/estoque/transferencias/:id", "warehouse_transfers.view"), { colunaEmpresa: "origin_farm_id" }),
  // Produção de ração é a única sem marca de exclusão (a tabela não tem deleted_at)
  E("feed_batches", "Produção de Ração", "estoque", "erp.feed_batches", fixa("/estoque/batidas/:id", "feed_batches.view"), { exclusaoLogica: false }),
  // Financeiro — uma tabela, duas telas e DUAS permissões distintas
  E("financial_titles", "Título Financeiro", "financeiro", "erp.financial_titles", porVariante("direction", {
    payable: { rota: "/financeiro/contas-a-pagar/:id", permissao: "payables.view" },
    receivable: { rota: "/financeiro/contas-a-receber/:id", permissao: "receivables.view" }
  })),
  E("bank_movements", "Movimento Bancário", "financeiro", "erp.bank_movements", fixa("/financeiro/movimentos/:id", "bank_movements.view")),
  E("ofx_imports", "Importação OFX", "financeiro", "erp.ofx_imports", fixa("/financeiro/ofx/:id", "ofx_imports.view"), { colunaEmpresa: null }),
  // Vendas — orçamento, pedido e venda têm permissões próprias
  E("sales_documents", "Documento de Venda", "vendas", "erp.sales_documents", porVariante("kind", {
    budget: { rota: "/vendas/budgets/:id", permissao: "budgets.view" },
    order: { rota: "/vendas/orders/:id", permissao: "orders.view" },
    sale: { rota: "/vendas/sales/:id", permissao: "sales.view" }
  })),
  // Pecuária — variantes derivadas da fonte única de operações de rebanho
  E("animals", "Animal", "pecuaria", "erp.animals", fixa("/pecuaria/animais/:id", "animals.view")),
  E("animal_movements", "Movimentação de Rebanho", "pecuaria", "erp.animal_movements", porVariante("movement_type", variantesDeOperacoes(MOVIMENTACOES_REBANHO))),
  E("animal_handlings", "Manejo", "pecuaria", "erp.animal_handlings", porVariante("handling_type", variantesDeOperacoes(MANEJOS_REBANHO))),
  E("weighings", "Pesagem", "pecuaria", "erp.weighings", fixa("/pecuaria/pesagens/:id", "weighings.view")),
  // Frota e ativos
  E("fuel_supplies", "Abastecimento", "frota", "erp.fuel_supplies", fixa("/frota/abastecimentos/:id", "fuel_supplies.view")),
  E("maintenances", "Manutenção", "frota", "erp.maintenances", fixa("/frota/manutencoes/:id", "maintenances.view")),
  E("equipments", "Equipamento", "frota", "erp.equipments", fixa(`/cadastros/equipments/:id${CONSULTA_CADASTRO}`, "equipments.view")),
  // Ordens de serviço
  E("service_orders", "Ordem de Serviço", "os", "erp.service_orders", fixa("/os/:id", "service_orders.view")),
  // Cadastros compartilhados pela organização (sem empresa)
  E("products", "Produto", "cadastros", "erp.products", fixa(`/cadastros/products/:id${CONSULTA_CADASTRO}`, "products.view"), { colunaEmpresa: null }),
  E("people", "Pessoa", "cadastros", "erp.people", fixa(`/cadastros/people/:id${CONSULTA_CADASTRO}`, "people.view"), { colunaEmpresa: null }),
  E("roles", "Perfil de Acesso", "configuracoes", "erp.roles", fixa("/admin/perfis/:id", "roles.view"), { colunaEmpresa: null })
];

const POR_TIPO = new Map(ENTIDADES_ID_GLOBAL.map((e) => [e.tipoEntidade, e]));

export const elegivelAIdGlobal = (tipoEntidade: string): boolean => POR_TIPO.has(tipoEntidade);
export const entidadeIdGlobal = (tipoEntidade: string): EntidadeIdGlobal | undefined => POR_TIPO.get(tipoEntidade);
export const tiposEntidadeIdGlobal = (): string[] => ENTIDADES_ID_GLOBAL.map((e) => e.tipoEntidade);

/** Rota + permissão deste registro. `linha` é sempre a linha VIVA do banco. `null` = negar. */
export function resolverRegistroGlobal(tipoEntidade: string, idEntidade: string, linha: Readonly<Record<string, unknown>> = {}): RegistroResolvido | null {
  const entidade = POR_TIPO.get(tipoEntidade);
  return entidade ? resolverRegistroDaEntidade(entidade, idEntidade, linha) : null;
}

/** Consistência do catálogo (testes e gate). Lista vazia = íntegro. */
export const validarRegistroIdGlobal = (): string[] => validarEntidadesIdGlobal(ENTIDADES_ID_GLOBAL);
