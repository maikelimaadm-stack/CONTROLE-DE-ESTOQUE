/**
 * ANALÍTICO EM USO NÃO VIRA SINTÉTICO (CADASTROS R1-5, decisão 256).
 *
 * Natureza, centro de resultado e conta contábil ANALÍTICOS recebem lançamento; o sintético só agrupa. Se um
 * analítico já referenciado virasse sintético (bastava marcar "Analítica: Não" para depois incluir um filho),
 * todo título em aberto que o usa passaria a dar 422 na baixa — e com o período fechado nem o título dá para
 * corrigir. Por isso a troca analítico → sintético é recusada enquanto houver QUALQUER referência VIVA.
 *
 * "EM USO" = uma linha, viva, em alguma tabela cuja chave estrangeira aponta para o cadastro. A lista abaixo é
 * o CATÁLOGO de FKs do banco migrado (`pg_constraint`, contype 'f', confrelid = o cadastro), fixado aqui como
 * WHITELIST ESTÁTICA: nenhum identificador vem da requisição, o SQL é montado só daqui e o id vai como
 * parâmetro. O teste CAT-2 de `apps/api/test/integration/cadastros-arvore-analitico.test.ts` compara esta lista
 * com o catálogo real e REPROVA se surgir FK nova não coberta (ou se uma daqui sumir) — a lista não envelhece em
 * silêncio. CAT-1, no mesmo arquivo, exige que todo cadastro em árvore com Analítica esteja aqui ou tenha regra
 * própria.
 *
 *   · "viva" = `deleted_at is null` quando a tabela referenciadora tem exclusão lógica (`exclusaoLogica`);
 *     sem exclusão lógica própria, toda linha conta (inclusive a de um documento cancelado: o histórico
 *     continua apontando para ela). O teste confere a marca contra a coluna real.
 *   · a FK da própria árvore (`parent_id`) não é uso: filho de analítico já é recusado pela regra da árvore.
 *   · Grupo de Produtos tem a regra PRÓPRIA (produto vivo no grupo, `grupo-de-produtos.ts`) e fica fora.
 *
 * A conferência roda com a RLS de quem grava, que recorta por EMPRESA: a linha de uma empresa fora do escopo
 * seria invisível e o "não está em uso" seria falso. Por isso, sem uso visível, a troca exige que quem grava
 * enxergue a organização inteira (proprietário ou "todas" em cada módulo) — nada é concedido, só recusado.
 */
import { CHAVES_MODULO_EMPRESA, type ResourceDef } from "@agro/domain";
import { escopoDoModulo } from "@erp/plataforma";
import { ident } from "./sql.js";
import { validation } from "./errors.js";
import type { ServiceCtx } from "./context.js";

export interface ReferenciaDeUso {
  /** tabela referenciadora (schema `erp`) */
  readonly tabela: string;
  /** coluna que aponta para `id` do cadastro */
  readonly coluna: string;
  /** a tabela referenciadora tem `deleted_at`: linha excluída não conta */
  readonly exclusaoLogica: boolean;
}

const r = (tabela: string, coluna: string, exclusaoLogica = false): ReferenciaDeUso => ({ tabela, coluna, exclusaoLogica });

/** Tabela do cadastro em árvore → referências que contam como uso. Chave = `ResourceDef.table`. */
export const REFERENCIAS_DE_USO: Readonly<Record<string, readonly ReferenciaDeUso[]>> = {
  financial_categories: [
    r("bank_movement_apportionments", "financial_category_id"),
    r("budget_planning_values", "financial_category_id"),
    r("input_entry_items", "financial_category_id"),
    r("invoice_apportionments", "financial_category_id"),
    r("invoice_items", "financial_category_id"),
    r("products", "financial_category_id", true),
    r("provider_launch_profile_items", "financial_category_id"),
    r("sales_documents", "categoria_financeira_id", true),
    r("title_apportionments", "financial_category_id")
  ],
  cost_centers: [
    r("apportionment_category_items", "cost_center_id"),
    r("bank_movement_apportionments", "cost_center_id"),
    r("devolution_items", "cost_center_id"),
    r("empresa_cost_centers", "cost_center_id"),
    r("employee_profiles", "cost_center_id"),
    r("equipment_cost_centers", "cost_center_id"),
    r("fuel_supplies", "cost_center_id", true),
    r("input_entry_items", "cost_center_id"),
    r("invoice_apportionments", "cost_center_id"),
    r("invoice_items", "cost_center_id"),
    r("products", "default_cost_center_id", true),
    r("provider_launch_profile_items", "cost_center_id"),
    r("provider_profiles", "default_cost_center_id"),
    r("requisition_items", "cost_center_id"),
    r("sales_documents", "centro_custo_id", true),
    r("service_orders", "cost_center_id", true),
    r("stock_movements", "cost_center_id"),
    r("stock_writeoffs", "cost_center_id", true),
    r("title_apportionments", "cost_center_id"),
    r("warehouse_transfer_items", "cost_center_id")
  ],
  chart_accounts: [
    r("bank_movement_apportionments", "chart_account_id"),
    r("invoice_apportionments", "chart_account_id"),
    r("journal_entries", "credit_account_id"),
    r("journal_entries", "debit_account_id"),
    r("title_apportionments", "chart_account_id")
  ]
};

/** Cadastros em árvore com `kind` que têm regra de uso PRÓPRIA (e por isso não estão na whitelist). */
export const CADASTROS_COM_REGRA_PROPRIA_DE_USO: readonly string[] = ["product_groups"];

export const MENSAGEM_ANALITICO_EM_USO = "Em uso em lançamentos: crie outra analítica e mova os lançamentos antes.";
export const MENSAGEM_ANALITICO_SEM_VISAO_TOTAL = "Mudar para sintético vale para a organização inteira: é preciso ter acesso a todas as empresas em todos os módulos.";

/**
 * Uma consulta por cadastro (UNION ALL com LIMIT 1, sem N+1). Montada uma vez, só da whitelist.
 *
 * CUSTO (risco declarado na decisão 256): nenhuma das colunas referenciadoras tem índice próprio. Quando HÁ uso,
 * a consulta para no primeiro achado; quando NÃO há — o caminho que termina em sucesso —, cada ramo varre a
 * tabela inteira (movimentos de estoque, rateios, itens de NF…), com a linha do cadastro travada `for update`:
 * lançamentos concorrentes naquela natureza/centro/conta esperam a varredura. A troca analítico → sintético é
 * rara e administrativa; índices nas FKs pedem fatia com migration autorizada (o R1 proíbe migration nova).
 */
const CONSULTA_DE_USO: ReadonlyMap<string, string> = new Map(Object.entries(REFERENCIAS_DE_USO).map(([tabela, refs]) => [tabela,
  `${refs.map((x) => `select 1 from erp.${ident(x.tabela)} where ${ident(x.coluna)} = $1${x.exclusaoLogica ? " and deleted_at is null" : ""}`).join(" union all ")} limit 1`]));

/** O membro enxerga todas as empresas em todos os módulos (a RLS não esconde linha nenhuma do tenant). */
function enxergaAOrganizacaoInteira(ctx: ServiceCtx): boolean {
  if (ctx.membership.isOwner || ctx.membership.escopos.todosOsModulos) return true;
  return CHAVES_MODULO_EMPRESA.every((m) => escopoDoModulo(ctx.membership.escopos, m).tipo === "todas");
}

/**
 * `atual` = linha antes da edição. Só a troca analítico → outro valor é conferida; criar sintético, manter o
 * valor ou voltar a analítico (a regra dos filhos cuida disso) não passam por aqui.
 */
export async function conferirAnaliticoEmUso(ctx: ServiceCtx, def: ResourceDef, id: string, data: Record<string, unknown>, atual: Record<string, unknown>): Promise<void> {
  if (!("kind" in data) || atual["kind"] !== "analytic" || data["kind"] === "analytic") return;
  if (CADASTROS_COM_REGRA_PROPRIA_DE_USO.includes(def.key)) return;
  const sql = CONSULTA_DE_USO.get(def.table);
  // cadastro em árvore com `kind` sem lista conferida: não há como provar que não está em uso → recusa
  if (!sql) throw validation(MENSAGEM_ANALITICO_EM_USO, [{ path: ["kind"], message: MENSAGEM_ANALITICO_EM_USO }]);
  // TRAVA a linha do cadastro ANTES de procurar uso: `for update` conflita com o `for key share` da FK de qualquer
  // inserção concorrente que aponte para ela e com o `for share` do rateio (`exigirRateioAnalitico`). Quem
  // chegou antes termina primeiro e a busca abaixo (nova leitura) já o vê; quem chega depois espera e relê o
  // cadastro já sintético. Sem a trava, um lançamento commitado entre a busca e o `update` escaparia.
  await ctx.tx.query(`select 1 from erp.${ident(def.table)} where id = $1 and organization_id = $2 for update`, [id, ctx.orgId]);
  const uso = await ctx.tx.query(sql, [id]);
  if (uso.rowCount) throw validation(MENSAGEM_ANALITICO_EM_USO, [{ path: ["kind"], message: MENSAGEM_ANALITICO_EM_USO }]);
  if (!enxergaAOrganizacaoInteira(ctx)) throw validation(MENSAGEM_ANALITICO_SEM_VISAO_TOTAL, [{ path: ["kind"], message: MENSAGEM_ANALITICO_SEM_VISAO_TOTAL }]);
}
