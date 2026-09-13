import { RESOURCES, permissaoManejo, permissaoMovimentacao } from "@agro/domain";
import { farmAllowed, hasPermission, scopedById, type ServiceCtx } from "./context.js";
import { notFound, validation, denied } from "./errors.js";

/**
 * Autorização central do REGISTRO-PAI de um anexo (docs/AUTHORIZATION.md, "Anexos").
 * `entity` vem da requisição e NUNCA vira SQL: só entradas deste registry (whitelist estática) determinam tabela e
 * consulta. Cada entidade anexável tem classificação, permissão funcional de visualização do pai e regra de escopo:
 *  - A FARM: tabela com organization_id + farm_id → tenant + scopedById (fora do escopo → 404, não expõe existência);
 *  - B ORG: tabela da organização inteira → tenant (+ compartilhados com organization_id null);
 *  - C CHILD: sem farm_id próprio → escopo derivado do pai (curral → setor → pátio.farm_id; usuário → membro da organização);
 *  - qualquer outra entidade → D NÃO ANEXÁVEL (VALIDATION_ERROR: é erro de parâmetro, não um registro invisível).
 * Política: attachments.view/create/delete + permissão de visualização do pai + escopo do pai — para listar, enviar,
 * baixar e excluir (o modelo de permissões atual não tem "anexos exigem edição do pai"; nada além disso foi inventado).
 */
export type ParentKind = "farm" | "org" | "child";
export interface ParentRule {
  kind: ParentKind;
  /**
   * Permissão de visualização do pai; pode depender da linha (tipo/direção).
   * `null` = tipo sem porta funcional (desconhecido ou interno): NEGA com 404, nunca cai numa permissão vizinha.
   */
  viewPerm: string | ((row: Record<string, unknown>) => string | null);
  /** Carrega a linha do pai dentro do tenant + escopo; null = não existe / invisível. SQL fixo por entidade (sem entity dinâmico). */
  load: (ctx: ServiceCtx, id: string) => Promise<Record<string, unknown> | null>;
  origin: "registry" | "explicit";
}

/**
 * As matrizes de manejo e movimentação de rebanho NÃO são copiadas aqui: vêm da fonte única de operações
 * (`@agro/domain`), a mesma consumida pelas rotas operacionais e pelo registry de ID Global. Tipo desconhecido
 * ou interno devolve `null` — fail-closed. Não existe mais `?? "animal_sales.view"` nem `?? "nutritions.view"`.
 */

/** Consulta por id com tenant e (opcional) escopo de fazenda/soft delete — tabela e colunas são literais do registry. */
function byId(table: string, opts: { farm?: boolean; softDelete?: boolean; shared?: boolean }) {
  return async (ctx: ServiceCtx, id: string) => {
    const s = opts.farm ? scopedById(ctx, "farm_id", id) : { sql: "", params: [id, ctx.orgId] as unknown[] };
    const org = opts.shared ? "(organization_id is null or organization_id=$2)" : "organization_id=$2";
    const r = await ctx.tx.query(`select * from erp.${table} where id=$1 and ${org}${opts.softDelete ? " and deleted_at is null" : ""}${s.sql}`, s.params);
    return (r.rows[0] as Record<string, unknown> | undefined) ?? null;
  };
}

/** Entidades especializadas (lançamentos fora do registry genérico) e filhas com escopo derivado. */
const EXPLICIT: Record<string, ParentRule> = {
  service_orders: { kind: "farm", viewPerm: "service_orders.view", load: byId("service_orders", { farm: true, softDelete: true }), origin: "explicit" },
  purchase_requests: { kind: "farm", viewPerm: "purchase_requests.view", load: byId("purchase_requests", { farm: true, softDelete: true }), origin: "explicit" },
  weighings: { kind: "farm", viewPerm: "weighings.view", load: byId("weighings", { farm: true, softDelete: true }), origin: "explicit" },
  animal_handlings: { kind: "farm", viewPerm: (row) => permissaoManejo(String(row["handling_type"] ?? ""), "view"), load: byId("animal_handlings", { farm: true, softDelete: true }), origin: "explicit" },
  animal_movements: { kind: "farm", viewPerm: (row) => permissaoMovimentacao(String(row["movement_type"] ?? ""), "view"), load: byId("animal_movements", { farm: true, softDelete: true }), origin: "explicit" },
  financial_titles: { kind: "farm", viewPerm: (row) => (row["direction"] === "payable" ? "payables.view" : row["direction"] === "receivable" ? "receivables.view" : null), load: byId("financial_titles", { farm: true, softDelete: true }), origin: "explicit" },
  animals: { kind: "farm", viewPerm: "animals.view", load: byId("animals", { farm: true, softDelete: true }), origin: "explicit" },
  // filhas: fazenda herdada do pátio (feedlot_yards.farm_id)
  feedlot_sectors: { kind: "child", viewPerm: "feedlot_sectors.view", origin: "explicit", load: async (ctx, id) => {
    const r = await ctx.tx.query<{ farm_id: string }>("select s.id, y.farm_id from erp.feedlot_sectors s join erp.feedlot_yards y on y.id=s.yard_id where s.id=$1 and s.organization_id=$2 and s.deleted_at is null", [id, ctx.orgId]);
    return r.rows[0] && farmAllowed(ctx, r.rows[0].farm_id) ? r.rows[0] : null;
  } },
  feedlot_corrals: { kind: "child", viewPerm: "feedlot_corrals.view", origin: "explicit", load: async (ctx, id) => {
    const r = await ctx.tx.query<{ farm_id: string }>("select c.id, y.farm_id from erp.feedlot_corrals c join erp.feedlot_sectors s on s.id=c.sector_id join erp.feedlot_yards y on y.id=s.yard_id where c.id=$1 and c.organization_id=$2 and c.deleted_at is null", [id, ctx.orgId]);
    return r.rows[0] && farmAllowed(ctx, r.rows[0].farm_id) ? r.rows[0] : null;
  } },
  // usuários são globais: o "pai" visível é o membro ativo da organização atual
  users: { kind: "child", viewPerm: "users.view", origin: "explicit", load: async (ctx, id) => {
    const r = await ctx.tx.query("select u.id from erp.users u join erp.organization_members m on m.user_id=u.id where u.id=$1 and m.organization_id=$2 and m.is_active", [id, ctx.orgId]);
    return (r.rows[0] as Record<string, unknown> | undefined) ?? null;
  } }
};

/** Registry completo: explícitos + recursos genéricos (metadata de @agro/domain: table, farmScoped, permission, softDelete). */
export const ATTACHMENT_PARENTS: Readonly<Record<string, ParentRule>> = (() => {
  const out: Record<string, ParentRule> = {};
  for (const def of RESOURCES) {
    if (EXPLICIT[def.table] || def.table === "users") continue;
    out[def.table] = { kind: def.farmScoped ? "farm" : "org", viewPerm: `${def.permission}.view`, origin: "registry", load: byId(def.table, { farm: Boolean(def.farmScoped), softDelete: Boolean(def.softDelete), shared: Boolean(def.reference || def.sharedDefaults) }) };
  }
  return { ...out, ...EXPLICIT };
})();

export function attachableEntity(entity: string): ParentRule | undefined { return Object.prototype.hasOwnProperty.call(ATTACHMENT_PARENTS, entity) ? ATTACHMENT_PARENTS[entity] : undefined; }

/**
 * Autoriza a operação `action` sobre anexos do pai (entity, entityId). Ordem: entidade suportada (422) → permissão de
 * anexos (403, feita pela rota) → registro existe no tenant e no escopo de fazenda (404) → permissão de visualização do
 * pai (403). Nada é lido/escrito/entregue antes deste retorno.
 */
export async function authorizeAttachmentParent(ctx: ServiceCtx, entity: string, entityId: string, action: "view" | "create" | "delete"): Promise<{ rule: ParentRule; row: Record<string, unknown> }> {
  const rule = attachableEntity(entity);
  if (!rule) throw validation("Entidade não aceita anexos", { entity });
  const row = await rule.load(ctx, entityId);
  if (!row) throw notFound("Registro");
  const perm = typeof rule.viewPerm === "function" ? rule.viewPerm(row) : rule.viewPerm;
  // tipo sem porta funcional: o registro é tratado como inexistente (404), nunca resolvido por permissão vizinha
  if (!perm) throw notFound("Registro");
  if (!hasPermission(ctx, perm)) throw denied(perm);
  void action; // política única para view/create/delete (ver cabeçalho); mantido na assinatura para evolução sem mudar chamadores
  return { rule, row };
}
