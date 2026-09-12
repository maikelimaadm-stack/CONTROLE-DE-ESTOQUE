/**
 * @agro/platform — NÚCLEO NEUTRO DE NICHO (docs/PRE-BASE2-FOUNDATION.md).
 *
 * Contratos de plataforma que o ERP inteiro consome e que NÃO dependem do domínio agro:
 * organização × empresa e escopo, ID Global, internacionalização e formatação por idioma.
 * Regra de dependência: `@agro/platform` nunca importa `@agro/domain` (o agro depende da plataforma,
 * jamais o contrário) — é o que permite atender outros nichos sem reescrever a fundação.
 */
export * from "./company.js";
export * from "./global-id.js";
export * from "./i18n.js";
export * from "./locale.js";
export { ptBR } from "./locales/pt-BR.js";
