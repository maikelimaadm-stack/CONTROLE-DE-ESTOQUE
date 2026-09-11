"use client";
import * as React from "react";
import { MoreVertical, ArrowUp, ArrowDown, Filter, Scaling, PanelLeft, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Spinner, Empty } from "@/components/ui";
import { B1Popover, MenuList } from "./ui";
import type { Base1Column, Row } from "./types";

/**
 * Grade do modelo base (emp-table-pro do MG): coluna de seleção, cabeçalho de 30 px com menu por coluna
 * (filtro avançado, auto ajustar, congelar, ocultar), ordenação por clique, redimensionamento por arraste,
 * colunas congeladas (sticky), linhas de 26 px alternadas com destaque; clique seleciona, duplo clique abre.
 */
export function Base1Grid({ columns, rows, loading, sort, onSort, selected, onSelect, onOpen, frozen, onFreeze, onHide, onResize, onAutoFit, onFilter, footer, actions }: {
  columns: Base1Column[]; rows: Row[]; loading?: boolean; sort?: { key: string; dir: "asc" | "desc" }; onSort?: (key: string) => void;
  selected: Set<string>; onSelect: (ids: Set<string>) => void; onOpen?: (r: Row) => void; frozen: number; onFreeze: (n: number) => void; onHide: (key: string) => void;
  onResize: (key: string, width: number) => void; onAutoFit: (key: string) => void; onFilter?: (key: string) => void; density?: "compact" | "normal"; footer?: React.ReactNode;
  /** ações por linha (menu ⋮ na última coluna) */ actions?: (row: Row) => { label: string; onClick: () => void; danger?: boolean }[];
}) {
  const key = (r: Row) => String(r["id"]);
  const allOn = rows.length > 0 && rows.every((r) => selected.has(key(r)));
  const toggleAll = () => onSelect(allOn ? new Set() : new Set(rows.map(key)));
  const toggle = (id: string) => { const n = new Set(selected); if (n.has(id)) n.delete(id); else n.add(id); onSelect(n); };
  const ths = React.useRef<Record<string, HTMLTableCellElement | null>>({});
  const [lefts, setLefts] = React.useState<Record<string, number>>({});
  // deslocamento das colunas congeladas (sticky) medido após o layout
  React.useLayoutEffect(() => {
    const out: Record<string, number> = {}; let acc = 34;
    for (const c of columns.slice(0, frozen)) { out[c.key] = acc; acc += ths.current[c.key]?.getBoundingClientRect().width ?? 160; }
    setLefts(out);
  }, [columns, frozen, rows.length]);
  const startResize = (e: React.MouseEvent, c: Base1Column) => {
    e.preventDefault(); e.stopPropagation();
    const th = ths.current[c.key]; if (!th) return; const x0 = e.clientX; const w0 = th.getBoundingClientRect().width;
    const move = (ev: MouseEvent) => { th.style.width = th.style.minWidth = th.style.maxWidth = `${Math.max(48, w0 + ev.clientX - x0)}px`; };
    const up = (ev: MouseEvent) => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); onResize(c.key, Math.round(Math.max(48, w0 + ev.clientX - x0))); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  const cellText = (c: Base1Column, r: Row) => c.text ? c.text(r) : String(r[c.key] ?? "");
  const stickyBg = (on: boolean, ri: number) => on ? "var(--mg-selection-bg)" : ri % 2 === 1 ? "var(--mg-row-alt)" : "#fff";
  return <div className="mg-grid-wrap">
    <table className="mg-grid">
      <thead><tr>
        <th className="sticky left-0 z-[4] w-[34px] text-center" style={{ padding: 0 }}><input type="checkbox" className="mg-check" aria-label="Selecionar todos" checked={allOn} onChange={toggleAll} /></th>
        {columns.map((c, i) => { const isFrozen = i < frozen; return (
          <th key={c.key} ref={(el) => { ths.current[c.key] = el; }} style={{ ...(c.width ? { width: c.width, minWidth: c.width, maxWidth: c.width } : { minWidth: 110 }), ...(isFrozen ? { left: lefts[c.key] ?? 0, zIndex: 4 } : {}) }} className={cn("group relative", isFrozen && "sticky", c.align === "right" && "!text-right")}>
            <div className="flex h-[30px] items-center gap-1">
              <button type="button" className={cn("inline-flex min-w-0 flex-1 items-center gap-1 truncate text-left", !onSort && "cursor-default")} onClick={() => c.sortable !== false && onSort?.(c.key)} title={c.label}><span className="truncate">{c.label}</span>{sort?.key === c.key && (sort.dir === "asc" ? <ArrowUp className="h-3 w-3 text-[var(--mg-accent)]" /> : <ArrowDown className="h-3 w-3 text-[var(--mg-accent)]" />)}</button>
              <B1Popover className="w-52 p-1" align="start" trigger={<button type="button" aria-label={`Abrir menu da coluna ${c.label}`} className="th-menu"><MoreVertical /></button>}>
                <MenuList onPick={(k) => { if (k === "filter") onFilter?.(c.key); if (k === "fit") onAutoFit(c.key); if (k === "freeze") onFreeze(isFrozen ? i : i + 1); if (k === "hide") onHide(c.key); }} items={[
                  { key: "filter", label: "Abrir filtro avançado", icon: <Filter className="h-4 w-4" />, disabled: !onFilter || !c.kind },
                  { key: "fit", label: "Auto ajustar coluna", icon: <Scaling className="h-4 w-4" /> },
                  { key: "freeze", label: isFrozen ? "Descongelar coluna" : "Congelar coluna", icon: <PanelLeft className="h-4 w-4" /> },
                  { key: "hide", label: "Ocultar coluna", icon: <EyeOff className="h-4 w-4" />, disabled: columns.length <= 1 }
                ]} />
              </B1Popover>
            </div>
            <span role="separator" aria-label={`Redimensionar ${c.label}`} onMouseDown={(e) => startResize(e, c)} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 hover:bg-[var(--mg-accent)] hover:opacity-60" />
          </th>); })}
        {actions && <th className="w-10 !text-center">Ação</th>}
      </tr></thead>
      <tbody>
        {loading && rows.length === 0 && <tr><td colSpan={columns.length + 2} className="!h-24 text-center"><Spinner className="mx-auto" /></td></tr>}
        {!loading && rows.length === 0 && <tr><td colSpan={columns.length + 2} className="!h-24"><Empty /></td></tr>}
        {rows.map((r, ri) => { const id = key(r); const on = selected.has(id); return (
          <tr key={id} data-testid="b1-row" className={cn(on && "selected", ri % 2 === 1 ? "odd" : "even")} onClick={() => toggle(id)} onDoubleClick={() => onOpen?.(r)}>
            <td className="sticky left-0 z-[2] w-[34px] text-center" style={{ padding: 0, background: stickyBg(on, ri) }} onClick={(e) => e.stopPropagation()}><input type="checkbox" className="mg-check" aria-label="Selecionar linha" checked={on} onChange={() => toggle(id)} /></td>
            {columns.map((c, i) => { const isFrozen = i < frozen; const t = cellText(c, r); return (
              <td key={c.key} title={t} style={{ ...(c.width ? { width: c.width, minWidth: c.width, maxWidth: c.width } : {}), ...(isFrozen ? { left: lefts[c.key] ?? 0, position: "sticky", zIndex: 2, background: stickyBg(on, ri) } : {}) }} className={cn(onOpen && "cursor-pointer", c.align === "right" && "!text-right tabular-nums")}>{c.render ? c.render(r) : t || <span className="text-slate-400">–</span>}</td>); })}
            {actions && <td className="!text-center" onClick={(e) => e.stopPropagation()}>{(() => { const acts = actions(r); return acts.length ? <B1Popover className="w-44 p-1" trigger={<button type="button" aria-label="Ações" className="th-menu"><MoreVertical /></button>}>{acts.map((a) => <button key={a.label} type="button" onClick={a.onClick} className={cn("block w-full rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-slate-100", a.danger && "text-red-600")}>{a.label}</button>)}</B1Popover> : null; })()}</td>}
          </tr>); })}
      </tbody>
      {footer && <tfoot className="bg-slate-50 font-semibold">{footer}</tfoot>}
    </table>
  </div>;
}
