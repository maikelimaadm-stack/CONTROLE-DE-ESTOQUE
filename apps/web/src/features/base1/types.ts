import type * as React from "react";
import type { FilterKind } from "@agro/shared";

/**
 * MODELO BASE1 — modelo de tela reutilizável (réplica do cadastro de Empresas do sistema de referência MG):
 * barra superior (Novo, pesquisa, alternância Registro/Tabela/Cards, mais opções), faixa de chips de filtro por
 * coluna, grade com seleção/menus de coluna/congelar/redimensionar, cards configuráveis, rodapé com contadores.
 */
export type Row = Record<string, unknown>;

export interface Base1Column {
  key: string;
  label: string;
  /** família de operadores/valores (para o chip de filtro desta coluna) */
  kind?: FilterKind;
  render?: (row: Row) => React.ReactNode;
  /** texto simples da célula (tooltip, cards, exportação); padrão: String(row[key]) */
  text?: (row: Row) => string;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  width?: number;
}

/** Como o filtro vira parâmetro de consulta. `advanced` = `campo__operador=valor` (recursos declarativos); `simple` = `campo=valor`. */
export interface Base1FilterDef {
  key: string;
  label: string;
  kind: FilterKind;
  mode: "advanced" | "simple";
  /** recurso referenciado (kind ref): lista de valores via /options */
  resource?: string;
  /** filtro extra para as opções do recurso referenciado */
  resourceFilter?: Record<string, string>;
  /** opções fixas (kind enum/boolean) */
  options?: { value: string; label: string }[];
  /** modo simple + kind date: nomes dos parâmetros de início/fim (ex.: start_date/end_date) */
  range?: { from: string; to: string };
}

export interface FilterValue { op: string; value: string; value2?: string; values?: string[] }
export type FilterValues = Record<string, FilterValue>;

export interface DistinctValue { value: string; label: string; count?: number }
