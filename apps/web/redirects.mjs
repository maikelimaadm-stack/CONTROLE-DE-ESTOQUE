/**
 * Compatibilidade de rotas antigas → rotas canônicas da Compactação V2 (ver docs/UX-ARCHITECTURE.md).
 * DERIVADO da fonte única de navegação (nav.registry.mjs): cada `alias` de uma entrada vira um redirecionamento 307
 * para a rota canônica (parâmetros de consulta preservados); `EXTRA_REDIRECTS` cobre rotas com parâmetros dinâmicos.
 * Consumido por next.config.ts e pela auditoria de paridade (scripts/parity.mjs).
 */
import { ALL, EXTRA_REDIRECTS, canonicalHref } from "./nav.registry.mjs";

const fromAliases = ALL.flatMap((e) => (e.aliases ?? []).map((source) => ({ source, destination: canonicalHref(e), permanent: false })));
const seen = new Set();
export const LEGACY_REDIRECTS = [...EXTRA_REDIRECTS.map((r) => ({ permanent: false, ...r })), ...fromAliases].filter((r) => { const k = `${r.source}|${JSON.stringify(r.has ?? null)}`; if (seen.has(k)) return false; seen.add(k); return true; });
