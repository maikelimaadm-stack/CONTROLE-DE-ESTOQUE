import { DomainError, type ErrorCode } from "@agro/shared";
export { DomainError };
export const notFound = (what = "Registro") => new DomainError("NOT_FOUND", `${what} não encontrado`);
export const denied = (perm?: string) => new DomainError("PERMISSION_DENIED", perm ? `Sem permissão: ${perm}` : "Sem permissão");
export const validation = (message: string, details?: unknown) => new DomainError("VALIDATION_ERROR", message, details);
export const err = (code: ErrorCode, message: string, details?: unknown) => new DomainError(code, message, details);

/** Converte exceções do Postgres (raise exception 'CODE: msg') em DomainError. */
export function fromPgError(e: unknown): DomainError | null {
  const pe = e as { code?: string; message?: string; constraint?: string; detail?: string };
  if (!pe || typeof pe !== "object") return null;
  if (pe.code === "P0001" && pe.message) {
    const m = /^([A-Z_]+):\s*(.*)$/.exec(pe.message.replace(/^error:\s*/i, ""));
    if (m) return new DomainError((m[1] as ErrorCode) ?? "CONFLICT", m[2]);
  }
  if (pe.code === "23505") return new DomainError("CONFLICT", "Registro duplicado", { constraint: pe.constraint, detail: pe.detail });
  if (pe.code === "23503") return new DomainError("CONFLICT", "Registro referenciado por outros dados ou referência inválida", { constraint: pe.constraint, detail: pe.detail });
  if (pe.code === "23514") return new DomainError("VALIDATION_ERROR", "Valor inválido para o campo", { constraint: pe.constraint });
  if (pe.code === "23502") return new DomainError("VALIDATION_ERROR", "Campo obrigatório ausente", { detail: pe.detail });
  if (pe.code === "42501") return new DomainError("PERMISSION_DENIED", "Acesso negado pela política de segurança (RLS)");
  if (pe.code === "40001" || pe.code === "40P01") return new DomainError("CONCURRENCY_CONFLICT", "Conflito de concorrência, tente novamente");
  return null;
}
