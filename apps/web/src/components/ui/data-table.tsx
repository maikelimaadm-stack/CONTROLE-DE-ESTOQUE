"use client";
import * as React from "react";
import { ChevronLeft, ChevronRight, ArrowUpDown, Download, Printer } from "lucide-react";
import { Button, NativeSelect, Spinner, Empty } from "./index";
import { cn } from "@/lib/utils";

export interface Column<T> { key: string; label: string; render?: (row: T) => React.ReactNode; className?: string; sortable?: boolean; align?: "right" | "left" | "center" }
export interface DataTableProps<T> {
  columns: Column<T>[]; rows: T[]; total?: number; page?: number; pageSize?: number; onPage?: (p: number) => void; onPageSize?: (s: number) => void;
  sort?: { key: string; dir: "asc" | "desc" }; onSort?: (key: string) => void; loading?: boolean; rowKey?: (r: T) => string; actions?: (row: T) => React.ReactNode;
  footer?: React.ReactNode; onExport?: (format: "csv" | "xlsx") => void; selectable?: boolean; selected?: Set<string>; onSelect?: (ids: Set<string>) => void; onRowClick?: (row: T) => void; compact?: boolean; caption?: string; emptyText?: string;
}
export function DataTable<T extends Record<string, unknown>>({ columns, rows, total, page = 1, pageSize = 20, onPage, onPageSize, sort, onSort, loading, rowKey, actions, footer, onExport, selectable, selected, onSelect, onRowClick, caption, emptyText }: DataTableProps<T>) {
  const key = rowKey ?? ((r: T) => String(r["id"]));
  const pages = total !== undefined ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const toggleAll = () => { if (!onSelect) return; const all = new Set(rows.map(key)); onSelect(selected && rows.every((r) => selected.has(key(r))) ? new Set() : all); };
  return (
    <div>
      <div className="flex items-center justify-between gap-2 px-1 pb-2 text-xs text-slate-500 no-print">
        <span>{caption ?? (total !== undefined ? `N. Registros: ${total}` : `${rows.length} registro(s)`)}</span>
        <div className="flex items-center gap-2">
          {onExport && <><Button size="sm" variant="outline" onClick={() => onExport("csv")} title="Exportar CSV"><Download className="h-3.5 w-3.5" /> CSV</Button><Button size="sm" variant="outline" onClick={() => onExport("xlsx")} title="Exportar Excel"><Download className="h-3.5 w-3.5" /> Excel</Button></>}
          <Button size="sm" variant="outline" onClick={() => window.print()} title="Imprimir"><Printer className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-md border bg-white">
        <table className="table-dense w-full text-[12.5px]">
          <thead><tr>
            {selectable && <th className="w-6"><input type="checkbox" checked={rows.length > 0 && rows.every((r) => selected?.has(key(r)))} onChange={toggleAll} /></th>}
            {columns.map((c) => <th key={c.key} className={cn(c.align === "right" && "text-right", c.className)}>{c.sortable && onSort ? <button className="inline-flex items-center gap-1 hover:text-brand-700" onClick={() => onSort(c.key)}>{c.label}<ArrowUpDown className={cn("h-3 w-3", sort?.key === c.key ? "text-brand-700" : "text-slate-300")} /></button> : c.label}</th>)}
            {actions && <th className="w-10 text-right">Ação</th>}
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={columns.length + 2} className="py-8 text-center"><Spinner className="mx-auto" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={columns.length + 2}><Empty text={emptyText} /></td></tr>}
            {!loading && rows.map((r) => <tr key={key(r)} className={cn(onRowClick && "cursor-pointer", selected?.has(key(r)) && "bg-brand-50")} onClick={() => onRowClick?.(r)}>
              {selectable && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected?.has(key(r)) ?? false} onChange={() => { if (!onSelect) return; const n = new Set(selected); if (n.has(key(r))) n.delete(key(r)); else n.add(key(r)); onSelect(n); }} /></td>}
              {columns.map((c) => <td key={c.key} className={cn(c.align === "right" && "num", c.className)}>{c.render ? c.render(r) : String(r[c.key] ?? "")}</td>)}
              {actions && <td className="text-right" onClick={(e) => e.stopPropagation()}>{actions(r)}</td>}
            </tr>)}
          </tbody>
          {footer && <tfoot className="bg-slate-50 font-semibold">{footer}</tfoot>}
        </table>
      </div>
      {total !== undefined && onPage && <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-2 text-xs text-slate-500 no-print">
        <div className="flex items-center gap-2">Qtd. de registros <NativeSelect className="h-7 w-24" value={pageSize} onChange={(e) => onPageSize?.(Number(e.target.value))}>{[10, 20, 30, 50, 80, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}</NativeSelect></div>
        <div className="flex items-center gap-1"><Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button><span>Página {page} de {pages}</span><Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button></div>
      </div>}
    </div>
  );
}
