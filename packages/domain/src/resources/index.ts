export * from "./types.js";
export * from "./referencias.js";
import { REGISTRY_RESOURCES } from "./registries.js";
import type { ResourceDef } from "./types.js";
export const RESOURCES: readonly ResourceDef[] = REGISTRY_RESOURCES;
const byKey = new Map(RESOURCES.map((r) => [r.key, r]));

/**
 * A chave de recurso é CANÔNICA desde PRE-BASE2-05B: só `empresas` resolve. A entrada anterior existia para
 * links salvos e favoritos; o que precisava dela era NAVEGAÇÃO, e navegação continua atendida pelo redirect
 * do web (a rota antiga de cadastro redireciona para `/cadastros/empresas`, em nav.registry.mjs, até
 * PRE-BASE2-05C).
 *
 * Rota de navegação e chave de protocolo não são a mesma coisa: o redirect devolve o usuário à tela certa;
 * a chave aqui decide permissão, escopo e definição de recurso. Manter a segunda para servir a primeira era
 * pagar em superfície de API por um problema que o roteador já resolve.
 */
export function getResource(key: string): ResourceDef | undefined {
  return byKey.get(key);
}
export function resourceKeys(): string[] { return RESOURCES.map((r) => r.key); }
