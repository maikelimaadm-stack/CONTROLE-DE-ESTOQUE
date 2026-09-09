export * from "./types.js";
import { REGISTRY_RESOURCES } from "./registries.js";
import type { ResourceDef } from "./types.js";
export const RESOURCES: readonly ResourceDef[] = REGISTRY_RESOURCES;
const byKey = new Map(RESOURCES.map((r) => [r.key, r]));
export function getResource(key: string): ResourceDef | undefined { return byKey.get(key); }
export function resourceKeys(): string[] { return RESOURCES.map((r) => r.key); }
