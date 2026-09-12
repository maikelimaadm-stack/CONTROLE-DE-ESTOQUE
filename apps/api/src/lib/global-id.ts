/**
 * SERVIÇO DE ID GLOBAL (docs/GLOBAL-ID-CONTRACT.md).
 *
 * Alocação é sempre do BANCO (`erp.next_global_id`), dentro da transação do serviço, e a elegibilidade vem do
 * registry central de `@agro/platform` — nunca de `if` na rota. A rota canônica é resolvida a partir do
 * registro e gravada junto, para que a resolução de `#N` não dependa de varrer tabelas.
 *
 * Garantias: unicidade e crescimento monotônico por organização. NÃO há garantia de ausência de lacunas
 * (uma transação que aloca e falha consome o número) nem de ordem temporal perfeita entre registros
 * criados no mesmo instante — ver o contrato.
 */
import { DomainError } from "@agro/shared";
import { globalIdEntity, globalRecordRouteColumns, resolveGlobalRecordRoute, type GlobalIdEntity } from "@agro/platform";
import { farmAllowed, hasPermission, type ServiceCtx } from "./context.js";

export interface GlobalRecord {
  globalId: number;
  entityType: string;
  entityId: string;
  module: string;
  route: string;
  companyId: string | null;
  createdAt: string;
}

const requireEntity = (entityType: string): GlobalIdEntity => {
  const entity = globalIdEntity(entityType);
  if (!entity) throw new DomainError("VALIDATION_ERROR", `Tipo de entidade sem ID Global: ${entityType}`);
  return entity;
};

/**
 * Atribui (ou devolve, se já existir) o ID Global do registro. Idempotente por (organização, tipo, registro).
 * `row` é a própria linha gravada: dela saem a empresa e os parâmetros da rota canônica.
 */
export async function assignGlobalId(ctx: ServiceCtx, entityType: string, entityId: string, row: Readonly<Record<string, unknown>> = {}): Promise<number> {
  const entity = requireEntity(entityType);
  const existing = await ctx.tx.query<{ global_id: string }>(
    "select global_id from erp.global_records where organization_id=$1 and entity_type=$2 and entity_id=$3", [ctx.orgId, entityType, entityId]);
  if (existing.rows[0]) return Number(existing.rows[0].global_id);

  for (const column of globalRecordRouteColumns(entity)) {
    if (row[column] === undefined) throw new DomainError("VALIDATION_ERROR", `ID Global de ${entityType}: coluna ${column} é necessária para a rota canônica`);
  }
  const route = resolveGlobalRecordRoute(entityType, entityId, row);
  if (!route) throw new DomainError("VALIDATION_ERROR", `ID Global de ${entityType}: não foi possível resolver a rota canônica`);
  const companyId = entity.companyColumn ? ((row[entity.companyColumn] as string | null | undefined) ?? null) : null;

  const inserted = await ctx.tx.query<{ global_id: string }>(
    `insert into erp.global_records (organization_id, global_id, entity_type, entity_id, empresa_id, module, canonical_route, created_by)
     values ($1, erp.next_global_id($1), $2, $3, $4, $5, $6, $7)
     on conflict (organization_id, entity_type, entity_id) do nothing
     returning global_id`,
    [ctx.orgId, entityType, entityId, companyId, entity.module, route, ctx.user.id]);
  if (inserted.rows[0]) return Number(inserted.rows[0].global_id);
  // corrida: outra transação gravou primeiro — o ID dela é o válido
  const race = await ctx.tx.query<{ global_id: string }>(
    "select global_id from erp.global_records where organization_id=$1 and entity_type=$2 and entity_id=$3", [ctx.orgId, entityType, entityId]);
  if (!race.rows[0]) throw new DomainError("CONCURRENCY_CONFLICT", "Não foi possível alocar o ID Global");
  return Number(race.rows[0].global_id);
}

/**
 * Resolve `#N` no registro real. Fora da organização, sem permissão de leitura da entidade ou fora do escopo
 * de empresas do usuário → NOT_FOUND (mesma convenção do resto da API: nunca expõe existência).
 */
export async function resolveGlobalRecord(ctx: ServiceCtx, globalId: number): Promise<GlobalRecord> {
  const notFound = () => new DomainError("NOT_FOUND", "Nenhum registro encontrado para este ID Global");
  const r = await ctx.tx.query<{ global_id: string; entity_type: string; entity_id: string; empresa_id: string | null; module: string; canonical_route: string; created_at: string }>(
    "select global_id, entity_type, entity_id, empresa_id, module, canonical_route, created_at from erp.global_records where organization_id=$1 and global_id=$2",
    [ctx.orgId, globalId]);
  const row = r.rows[0];
  if (!row) throw notFound();
  const entity = globalIdEntity(row.entity_type);
  if (!entity) throw notFound();
  if (!hasPermission(ctx, entity.permission)) throw notFound();
  if (!farmAllowed(ctx, row.empresa_id)) throw notFound();
  return {
    globalId: Number(row.global_id),
    entityType: row.entity_type,
    entityId: row.entity_id,
    module: row.module,
    route: row.canonical_route,
    companyId: row.empresa_id,
    createdAt: row.created_at
  };
}
