"use client";
import * as React from "react";
import { normalizeListPreferences, applyColumnPreferences, type ListPreferences, type ListKnown, type FilterKind } from "@agro/shared";
import { useScreenPrefs, type ScreenPrefs } from "@/lib/preferences";
import type { Column } from "@/components/ui/data-table";

export interface ListColumnInfo { key: string; label: string }
export interface ListFilterInfo { key: string; label: string; kind: FilterKind }

/** Preferências de uma listagem (colunas, ordenação, página, cards, filtros) para o módulo informado. */
export function useListPrefs(module: string, columns: ListColumnInfo[], filters: ListFilterInfo[] = []): ScreenPrefs<ListPreferences> & { known: ListKnown } {
  const known = React.useMemo<ListKnown>(() => ({ columns: columns.map((c) => c.key), filters: filters.map((f) => f.key), filterKinds: Object.fromEntries(filters.map((f) => [f.key, f.kind])) }), [columns, filters]);
  const normalize = React.useCallback((raw: unknown) => normalizeListPreferences(raw, known), [known]);
  const p = useScreenPrefs<ListPreferences>(module, "list", normalize);
  return { ...p, known };
}

/** Aplica visibilidade, ordem e largura de colunas a colunas de DataTable. */
export function applyListColumns<T extends Record<string, unknown>>(columns: Column<T>[], prefs: ListPreferences): Column<T>[] {
  return applyColumnPreferences(columns, prefs.columns).map((c) => (prefs.columns.widths?.[c.key] ? { ...c, width: prefs.columns.widths[c.key] } : c));
}
