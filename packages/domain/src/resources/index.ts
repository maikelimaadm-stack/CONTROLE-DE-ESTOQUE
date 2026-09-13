export * from "./types.js";
import { REGISTRY_RESOURCES } from "./registries.js";
import type { ResourceDef } from "./types.js";
export const RESOURCES: readonly ResourceDef[] = REGISTRY_RESOURCES;
const byKey = new Map(RESOURCES.map((r) => [r.key, r]));

/**
 * CHAVES LEGADAS DE RECURSO (PRE-BASE2-03). Uma tela só, duas entradas durante a transição: `/cadastros/farms`
 * continua resolvendo para o MESMO recurso de `/cadastros/empresas`. Não é um segundo recurso — é o mesmo
 * `ResourceDef`, então regra, permissão e escopo não têm como divergir. A entrada antiga sai quando nenhuma
 * versão viva do web a produzir (favoritos e links salvos ainda produzem).
 */
export const CHAVES_LEGADAS: Readonly<Record<string, string>> = { farms: "empresas" };

export function getResource(key: string): ResourceDef | undefined {
  return byKey.get(key) ?? byKey.get(CHAVES_LEGADAS[key] ?? "");
}
export function resourceKeys(): string[] { return RESOURCES.map((r) => r.key); }
