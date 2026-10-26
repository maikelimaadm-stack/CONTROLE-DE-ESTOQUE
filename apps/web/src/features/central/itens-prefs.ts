"use client";
import * as React from "react";
import { normalizeItensPreferences, type ItensPreferences } from "@agro/shared";
import { useScreenPrefs, type ScreenPrefs } from "@/lib/preferences";

const SEM_CAMPOS: readonly string[] = [];

/**
 * Preferências da grade/formulário de itens — por usuário (API + cache local).
 * `module` = prefixo da Central (`central-compras`, `central-vendas`, …) ou `compras` no Portal.
 * Tela: `itens` (Central) ou `portal-itens` (painel mestre-detalhe).
 */
export function useItensPrefs(
  module: string,
  screen: "itens" | "portal-itens",
  columns: readonly string[],
  fields: readonly string[] = SEM_CAMPOS
): ScreenPrefs<ItensPreferences> {
  const colKey = columns.join("\0");
  const fieldKey = fields.join("\0");
  const known = React.useMemo(
    () => ({ columns: colKey ? colKey.split("\0") : [], fields: fieldKey ? fieldKey.split("\0") : [] }),
    [colKey, fieldKey]
  );
  const normalize = React.useCallback((raw: unknown) => normalizeItensPreferences(raw, known), [known]);
  return useScreenPrefs<ItensPreferences>(module, screen, normalize);
}

/** Grava lista Preferencia → bloco visible/order das prefs. */
export function blocoDeLista<K extends string>(lista: { chave: K; visivel: boolean }[]): { visible: string[]; order: string[] } {
  return { order: lista.map((c) => c.chave), visible: lista.filter((c) => c.visivel).map((c) => c.chave) };
}
