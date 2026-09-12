/**
 * CONTRATO CANÔNICO DE EMPRESA E ESCOPO (docs/MULTI-COMPANY-CONTRACT.md).
 *
 * Hierarquia: ORGANIZAÇÃO (tenant/cliente do ERP) › EMPRESA (entidade operacional/jurídica dos registros).
 * Os dois conceitos NUNCA se colapsam: isolamento de tenant é organização; escopo de trabalho é empresa.
 *
 * Este módulo é puro (sem banco, sem HTTP) e é a autoridade de *regra*; a autoridade de *dados* continua no
 * backend (API/RLS). Nada aqui depende do nicho agro — no código atual a empresa é materializada pela tabela
 * `erp.farms` e pelo vínculo `erp.member_farms` (ver docs/DOMAIN-NAMING-STANDARD.md); a substituição é
 * progressiva (PRE-BASE2-02/03) e esta camada existe justamente para que a troca não mude a regra.
 *
 * Autorização (`authorized`): lista de empresas permitidas ao usuário. Lista VAZIA significa "todas as empresas
 * da organização" — é a convenção já existente em `membership.farmIds` e é preservada deliberadamente para que
 * a migração seja compatível. `assertAuthorizationCompat` documenta e testa essa equivalência.
 */
import { DomainError } from "@agro/shared";

export type CompanyId = string;

/** Empresa como o usuário a vê (identidade + código próprio). */
export interface CompanyRef {
  id: CompanyId;
  /** Código curto e estável dentro da organização (exibido ao usuário). */
  code: string | number;
  name: string;
  isActive?: boolean;
}

/**
 * ESCOPO DE VISUALIZAÇÃO. "Todas as empresas" é um escopo, nunca uma empresa:
 * jamais é persistido em um lançamento (ver `assertPersistableCompanyId`).
 */
export type CompanyScope =
  | { kind: "all" }
  | { kind: "one"; companyId: CompanyId }
  | { kind: "set"; companyIds: CompanyId[] };

/** Valor reservado usado em filtros/URL para o escopo "todas as empresas autorizadas". */
export const ALL_COMPANIES = "all" as const;
export type AllCompanies = typeof ALL_COMPANIES;

export const ALL_COMPANIES_SCOPE: CompanyScope = { kind: "all" };

/** Autorização do usuário na organização. `authorized` vazio = todas as empresas da organização. */
export interface CompanyAuthorization {
  authorized: readonly CompanyId[];
}

/** Pedido de escopo vindo da borda (query string, cabeçalho, seleção de contexto) — sempre não confiável. */
export interface CompanyScopeRequest {
  /** Empresas pedidas explicitamente (`?empresa_id=a,b` ou lista). `ALL_COMPANIES` = todas as autorizadas. */
  requested?: readonly CompanyId[] | CompanyId | AllCompanies | null;
  /** Empresa selecionada no contexto de trabalho (seleção, nunca autorização). */
  selected?: CompanyId | null;
}

/**
 * Resolução de escopo para LEITURA (listas, buscas, painéis, relatórios).
 * `companyIds === null` significa "sem restrição por empresa" — só acontece quando o usuário está autorizado a
 * todas as empresas da organização E não pediu recorte algum. O isolamento por organização é sempre aplicado
 * por fora (RLS + organization_id) e não é responsabilidade deste contrato.
 *
 * Pedido fora da autorização NUNCA amplia o escopo: resulta em lista vazia (nenhuma linha), e as empresas
 * recusadas voltam em `denied` para que a camada de API possa auditar/erro 403 quando for uma seleção explícita.
 */
export interface ResolvedCompanyScope {
  companyIds: CompanyId[] | null;
  denied: CompanyId[];
  /** true quando o escopo efetivo é "todas as empresas autorizadas" (sem recorte adicional). */
  isAll: boolean;
}

const asList = (v: CompanyScopeRequest["requested"]): CompanyId[] => {
  if (v == null) return [];
  const raw = Array.isArray(v) ? [...v] : typeof v === "string" ? v.split(",") : [];
  return raw.map((s) => String(s).trim()).filter((s) => s.length > 0 && s !== ALL_COMPANIES);
};

export function resolveCompanyScope(auth: CompanyAuthorization, req: CompanyScopeRequest = {}): ResolvedCompanyScope {
  const authorized = auth.authorized;
  const requested = asList(req.requested);
  const askedAll = req.requested === ALL_COMPANIES || (Array.isArray(req.requested) && req.requested.includes(ALL_COMPANIES as CompanyId));
  // "todas" pedido explicitamente ignora a seleção de trabalho; sem pedido, a seleção vale como recorte.
  const asked = requested.length ? requested : askedAll ? [] : req.selected ? [req.selected] : [];
  if (!asked.length) {
    const all = authorized.length ? [...authorized] : null;
    return { companyIds: all, denied: [], isAll: true };
  }
  if (!authorized.length) return { companyIds: [...new Set(asked)], denied: [], isAll: false };
  const allowed = asked.filter((c) => authorized.includes(c));
  const denied = asked.filter((c) => !authorized.includes(c));
  return { companyIds: [...new Set(allowed)], denied, isAll: false };
}

/** O usuário pode operar nesta empresa? (lista de autorização vazia = todas as empresas da organização) */
export function isCompanyAuthorized(auth: CompanyAuthorization, companyId: CompanyId | null | undefined): boolean {
  if (!companyId) return true;
  return auth.authorized.length === 0 || auth.authorized.includes(companyId);
}

/** Mesma convenção das leituras: empresa fora do escopo não existe para o usuário (nunca expõe existência). */
export function assertCompanyVisible(auth: CompanyAuthorization, companyId: CompanyId | null | undefined, what = "Registro"): void {
  if (!isCompanyAuthorized(auth, companyId)) throw new DomainError("NOT_FOUND", `${what} não encontrado`);
}

/**
 * Seleção de empresa para LANÇAMENTO (documento operacional). Um lançamento pertence sempre a UMA empresa concreta:
 *  - uma única empresa efetiva  → `auto` (a UI preenche sem perguntar);
 *  - várias empresas efetivas   → `required` (seleção explícita obrigatória);
 *  - empresa pedida fora da autorização → `denied`.
 * `available` são as empresas ativas da organização; só é consultada quando a autorização é "todas".
 */
export type CompanySelection =
  | { status: "ok"; companyId: CompanyId }
  | { status: "auto"; companyId: CompanyId }
  | { status: "required"; options: CompanyId[] }
  | { status: "denied"; companyId: CompanyId };

export function selectCompanyForEntry(
  auth: CompanyAuthorization,
  opts: { available?: readonly CompanyId[]; requested?: CompanyId | null } = {}
): CompanySelection {
  const effective = auth.authorized.length ? [...auth.authorized] : [...(opts.available ?? [])];
  const requested = opts.requested?.trim() ? opts.requested.trim() : null;
  if (requested) {
    if (requested === ALL_COMPANIES) throw new DomainError("VALIDATION_ERROR", "Um lançamento pertence a uma empresa: \"todas as empresas\" é um escopo de consulta");
    if (!isCompanyAuthorized(auth, requested)) return { status: "denied", companyId: requested };
    if (effective.length && !effective.includes(requested)) return { status: "denied", companyId: requested };
    return { status: "ok", companyId: requested };
  }
  if (effective.length === 1) return { status: "auto", companyId: effective[0]! };
  return { status: "required", options: effective };
}

/** Guarda de persistência: o valor que vai para a coluna de empresa precisa ser uma empresa concreta. */
export function assertPersistableCompanyId(value: unknown, what = "Empresa"): CompanyId {
  if (typeof value !== "string" || !value.trim() || value === ALL_COMPANIES) {
    throw new DomainError("VALIDATION_ERROR", `${what} obrigatória: selecione uma empresa (o escopo \"todas as empresas\" não pode ser gravado)`);
  }
  return value;
}

/** Descrição do escopo resolvido para exibição/auditoria (não é rótulo traduzido — ver i18n). */
export function describeCompanyScope(scope: ResolvedCompanyScope): CompanyScope {
  if (scope.companyIds === null) return { kind: "all" };
  if (scope.companyIds.length === 1) return { kind: "one", companyId: scope.companyIds[0]! };
  return { kind: "set", companyIds: scope.companyIds };
}

/**
 * Compatibilidade com o mecanismo atual (`allowedFarms` em apps/api/src/lib/context.ts): mesma entrada,
 * mesma saída. Existe para ser testada explicitamente enquanto os dois nomes coexistem (PRE-BASE2-02/03).
 */
export function legacyAllowedCompanies(authorized: readonly CompanyId[], selected: CompanyId | null, requested?: readonly CompanyId[] | string | null): CompanyId[] | null {
  return resolveCompanyScope({ authorized }, { requested: requested ?? null, selected }).companyIds;
}
