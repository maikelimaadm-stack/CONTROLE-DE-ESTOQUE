/**
 * Códigos de erro de domínio. Usados pela API (mapeados para HTTP) e pelo frontend (mensagens pt-BR).
 */
export const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  CONFLICT: "CONFLICT",
  ALREADY_CONFIRMED: "ALREADY_CONFIRMED",
  ALREADY_CANCELLED: "ALREADY_CANCELLED",
  INVALID_STATUS_TRANSITION: "INVALID_STATUS_TRANSITION",
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  PAYMENT_EXCEEDS_BALANCE: "PAYMENT_EXCEEDS_BALANCE",
  CONCURRENCY_CONFLICT: "CONCURRENCY_CONFLICT",
  IDEMPOTENT_REPLAY: "IDEMPOTENT_REPLAY",
  PERIOD_FROZEN: "PERIOD_FROZEN",
  APPORTIONMENT_MISMATCH: "APPORTIONMENT_MISMATCH",
  INSTALLMENTS_MISMATCH: "INSTALLMENTS_MISMATCH",
  DUPLICATE_DOCUMENT: "DUPLICATE_DOCUMENT",
  PRODUCT_NOT_STOCK_CONTROLLED: "PRODUCT_NOT_STOCK_CONTROLLED",
  WAREHOUSE_FARM_MISMATCH: "WAREHOUSE_FARM_MISMATCH",
  SAME_WAREHOUSE_TRANSFER: "SAME_WAREHOUSE_TRANSFER",
  ANIMAL_NOT_ACTIVE: "ANIMAL_NOT_ACTIVE",
  BATCH_CLOSED: "BATCH_CLOSED",
  ACCOUNT_INACTIVE: "ACCOUNT_INACTIVE",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  // TOP configurada (TOP-CONFIG-01). Em português porque nomeiam conceito do NOSSO domínio, como manda
  // `docs/DOMAIN-NAMING-STANDARD.md` §1.6 para superfície nova — e porque são os mesmos identificadores que
  // os gatilhos da 0020 levantam em SQL: `fromPgError` converte `^[A-Z_]+:` direto em código, então divergir
  // aqui produziria um código que este mapa não conhece e uma resposta sem status.
  TIPO_OPERACAO_BASE_DESCONHECIDA: "TIPO_OPERACAO_BASE_DESCONHECIDA",
  TIPO_OPERACAO_IDENTIDADE_IMUTAVEL: "TIPO_OPERACAO_IDENTIDADE_IMUTAVEL",
  TIPO_OPERACAO_VERSAO_IMUTAVEL: "TIPO_OPERACAO_VERSAO_IMUTAVEL",
  /**
   * UMA superfície para CINCO motivos: a TOP não existe, é de outro tenant, é de outra família, está
   * inativa ou foi excluída. Distinguir seria transformar a mensagem num oráculo — quem tentasse UUIDs
   * saberia quais existem na organização vizinha e qual família cada um tem. É a mesma regra que faz
   * inexistente e fora de escopo responderem a MESMA 404 (.claude/rules/security.md).
   */
  TIPO_OPERACAO_INDISPONIVEL: "TIPO_OPERACAO_INDISPONIVEL",
  /**
   * Configuração versionada da TOP (TOP-CONFIG-03). DOIS códigos, e não um, porque descrevem situações
   * que o cliente resolve de formas diferentes: um payload malformado é erro DELE, corrigível agora; uma
   * versão de schema que este servidor não conhece é SKEW de implantação, e o cliente antigo não tem o
   * que corrigir — ele precisa recarregar. Um código só faria o front tratar as duas como digitação.
   */
  TIPO_OPERACAO_CONFIGURACAO_INVALIDA: "TIPO_OPERACAO_CONFIGURACAO_INVALIDA",
  TIPO_OPERACAO_CONFIGURACAO_SCHEMA_NAO_SUPORTADO: "TIPO_OPERACAO_CONFIGURACAO_SCHEMA_NAO_SUPORTADO",
  /**
   * Grafo de próximas operações (TOP-CONFIG-03): a LISTA enviada é malformada — não é lista, excede o
   * teto, repete um destino ou traz chave desconhecida.
   *
   * Note o que NÃO está aqui: "este destino não serve". Destino inexistente, de outro tenant, inativo,
   * excluído ou de família incompatível respondem `TIPO_OPERACAO_INDISPONIVEL`, que já É a superfície
   * única de recusa de TOP. Criar um código próprio para cada uma dessas cinco razões transformaria a
   * resposta num oráculo de quais identificadores existem na organização vizinha.
   */
  TIPO_OPERACAO_DESTINO_INVALIDO: "TIPO_OPERACAO_DESTINO_INVALIDO"
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export const errorHttpStatus: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 422,
  NOT_FOUND: 404,
  PERMISSION_DENIED: 403,
  UNAUTHENTICATED: 401,
  CONFLICT: 409,
  ALREADY_CONFIRMED: 409,
  ALREADY_CANCELLED: 409,
  INVALID_STATUS_TRANSITION: 409,
  INSUFFICIENT_STOCK: 409,
  PAYMENT_EXCEEDS_BALANCE: 409,
  CONCURRENCY_CONFLICT: 409,
  IDEMPOTENT_REPLAY: 200,
  PERIOD_FROZEN: 409,
  APPORTIONMENT_MISMATCH: 422,
  INSTALLMENTS_MISMATCH: 422,
  DUPLICATE_DOCUMENT: 409,
  PRODUCT_NOT_STOCK_CONTROLLED: 422,
  WAREHOUSE_FARM_MISMATCH: 422,
  SAME_WAREHOUSE_TRANSFER: 422,
  ANIMAL_NOT_ACTIVE: 409,
  BATCH_CLOSED: 409,
  ACCOUNT_INACTIVE: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  // 422: o cliente mandou uma família que não existe — entrada inválida, não conflito de estado.
  TIPO_OPERACAO_BASE_DESCONHECIDA: 422,
  // 409: o registro existe e o pedido conflita com o que ele já é.
  TIPO_OPERACAO_IDENTIDADE_IMUTAVEL: 409,
  TIPO_OPERACAO_VERSAO_IMUTAVEL: 409,
  // 422 e não 404: a recusa fala do PEDIDO de lançamento (a TOP escolhida não serve), não da existência
  // do documento. 403 seria errado também — quem pode lançar tem a capacidade; o que falta é uma TOP válida.
  TIPO_OPERACAO_INDISPONIVEL: 422,
  // 422 nos dois: contrato de entrada não canônico é RECUSADO, nunca traduzido nem ignorado.
  TIPO_OPERACAO_CONFIGURACAO_INVALIDA: 422,
  TIPO_OPERACAO_CONFIGURACAO_SCHEMA_NAO_SUPORTADO: 422,
  TIPO_OPERACAO_DESTINO_INVALIDO: 422
};

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;
  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? code);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
  get httpStatus(): number {
    return errorHttpStatus[this.code];
  }
  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export const isDomainError = (e: unknown): e is DomainError => e instanceof DomainError;
