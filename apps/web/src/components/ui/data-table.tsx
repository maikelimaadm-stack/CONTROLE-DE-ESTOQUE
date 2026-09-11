"use client";
import * as React from "react";
import { ChevronLeft, ChevronRight, Download, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { BASE1_PAGE_SIZES } from "@agro/shared";
import { Base1Grid } from "@/features/base1/grid";
import { IconBtn } from "@/features/base1/ui";
import type { Base1Column, Row } from "@/features/base1/types";

export interface Column<T> { key: string; label: string; render?: (row: T) => React.ReactNode; className?: string; sortable?: boolean; align?: "right" | "left" | "center"; /** largura fixa em px (preferência do usuário) */ width?: number }
export interface DataTableProps<T> {
  columns: Column<T>[]; rows: T[]; total?: number; page?: number; pageSize?: number; onPage?: (p: number) => void; onPageSize?: (s: number) => void;
  sort?: { key: string; dir: "asc" | "desc" }; onSort?: (key: string) => void; loading?: boolean; rowKey?: (r: T) => string; actions?: (row: T) => React.ReactNode;
  footer?: React.ReactNode; onExport?: (format: "csv" | "xlsx") => void; selectable?: boolean; selected?: Set<string>; onSelect?: (ids: Set<string>) => void; onRowClick?: (row: T) => void; compact?: boolean; caption?: string; emptyText?: string;
}
/**
 * Tabela paginada no MODELO BASE1 (mesma grade `mg-grid` do Base1List: seleção circular, menus de coluna, linhas de 26 px,
 * rodapé Selecionados/Listados/Filtrados/Totais com pílula de quantidade). Clique seleciona; duplo clique abre.
 */
export function DataTable<T extends Record<string, unknown>>({ columns, rows, total, page = 1, pageSize = 20, onPage, onPageSize, sort, onSort, loading, rowKey, actions, footer, onExport, selected, onSelect, onRowClick, caption, emptyText }: DataTableProps<T>) {
  const key = React.useCallback((r: Row) => (rowKey ? rowKey(r as T) : String(r["id"])), [rowKey]);
  const [selLocal, setSelLocal] = React.useState<Set<string>>(new Set());
  const sel = selected ?? selLocal; const setSel = onSelect ?? setSelLocal;
  const pages = total !== undefined ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const cols = React.useMemo<Base1Column[]>(() => [
    ...columns.map((c) => ({ key: c.key, label: c.label, align: c.align, sortable: c.sortable, width: c.width, render: c.render ? (r: Row) => c.render!(r as T) : undefined, text: (r: Row) => { const v = r[c.key]; return v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); } })),
    ...(actions ? [{ key: "__actions", label: "Ação", sortable: false, width: 90, align: "center" as const, render: (r: Row) => <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>{actions(r as T)}</span>, text: () => "" }] : [])
  ], [columns, actions]);
  const sizes = React.useMemo(() => Array.from(new Set([...BASE1_PAGE_SIZES, pageSize])).sort((a, b) => a - b), [pageSize]);
  return <div className="mg-shell">
    {(onExport || caption) && <div className="mg-toolbar no-print border-b" style={{ borderColor: "var(--mg-divider)" }}>
      <span className="mg-page-subtitle">{caption}</span>
      <span className="ml-auto flex items-center gap-1.5">
        {onExport && <><IconBtn aria-label="Exportar CSV" title="Exportar CSV" onClick={() => onExport("csv")}><Download /></IconBtn><IconBtn aria-label="Exportar Excel" title="Exportar Excel" onClick={() => onExport("xlsx")}><Download /></IconBtn></>}
        <IconBtn aria-label="Imprimir" title="Imprimir" onClick={() => window.print()}><Printer /></IconBtn>
      </span>
    </div>}
    <Base1Grid columns={cols} rows={rows as Row[]} loading={loading} sort={sort} onSort={onSort} selected={sel} onSelect={setSel} onOpen={onRowClick ? (r) => onRowClick(r as T) : undefined} rowKey={key} footer={footer} emptyText={emptyText} />
    <div className="mg-summary no-print">
      <div className="mg-summary__counts"><span className="mg-summary__item">Selecionados: {sel.size}</span><span className="mg-summary__item">Listados: {rows.length}</span><span className="mg-summary__item">Filtrados: {total ?? rows.length}</span><span className="mg-summary__item">Totais: {total ?? rows.length}</span></div>
      {total !== undefined && onPage && <span className="flex items-center gap-2">
        <select aria-label="Quantidade de registros por página" className="mg-pill-select" value={pageSize} onChange={(e) => onPageSize?.(Number(e.target.value))} disabled={!onPageSize}>{sizes.map((n) => <option key={n} value={n}>{n}</option>)}</select>
        <IconBtn aria-label="Página anterior" title="Página anterior" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft /></IconBtn>
        <span className={cn("text-[11px] font-semibold text-[var(--mg-text-2)] tabular-nums")}>{page}/{pages}</span>
        <IconBtn aria-label="Próxima página" title="Próxima página" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight /></IconBtn>
      </span>}
    </div>
  </div>;
}
