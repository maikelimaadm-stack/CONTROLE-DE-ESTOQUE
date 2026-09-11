export type NavEntryType = "module" | "area" | "sub" | "action" | "config";
export interface NavEntry {
  id: string; type: NavEntryType; module: string; label: string;
  path?: string; tab?: string | null; sub?: string | null; href?: string; query?: Record<string, string>;
  perm?: string | string[] | null; aliases?: string[]; keywords?: string[]; description?: string; menu?: boolean; search?: boolean;
}
export interface LegacyTabTarget { path?: string; tab?: string | null; sub?: string | null; query?: Record<string, string> }
export interface RedirectRule { source: string; destination: string; permanent?: boolean; has?: { type: "query" | "header" | "cookie"; key: string; value: string }[] }
export const MODULES: NavEntry[];
export const AREAS: NavEntry[];
export const ALL: NavEntry[];
export const LEGACY_TABS: Record<string, Record<string, LegacyTabTarget>>;
export const EXTRA_REDIRECTS: RedirectRule[];
export function canonicalHref(e: NavEntry): string;
