/** Tipos do dicionário de dados (SSOT funcional em data-dictionary.registry.mjs). */
export type DictionaryKind = "entidade" | "linha" | "infraestrutura";
export interface DictionaryFieldOverride { name: string; description: string }
export interface DictionaryEntry {
  code: string;
  table: string;
  name: string;
  description: string;
  module: string;
  kind: DictionaryKind;
  globalId: boolean;
  route?: string;
  top?: string;
  migration?: string;
  fields?: Record<string, DictionaryFieldOverride>;
}
export interface SchemaColumn { name: string; type: string; notNull: boolean; primaryKey: boolean; references: string | null; check: string | null }
export interface SchemaTable { table: string; columns: Map<string, SchemaColumn> }
export const DATA_DICTIONARY_VERSION: number;
export const DICTIONARY_MODULES: Record<string, string>;
export const DATA_DICTIONARY: readonly DictionaryEntry[];
export function dictionaryByTable(): Map<string, DictionaryEntry>;
export function validateDataDictionary(entries: readonly DictionaryEntry[], schema: Map<string, SchemaTable>): string[];
