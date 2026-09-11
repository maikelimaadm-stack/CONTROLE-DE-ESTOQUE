"use client";
import * as React from "react";
import { MoreVertical, ArrowUp, ArrowDown, Filter, Scaling, PanelLeft, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Spinner, Empty } from "@/components/ui";
import { B1Popover, MenuList, MgCheck } from "./ui";
import { selectClickOf, type SelectClick } from "./cards";
import type { Base1Column, Row } from "./types";

export const SELECT_COLUMN_WIDTH = 36;

/**
 * Grade do modelo base (emp-table-pro do MG): coluna de seleção, cabeçalho de 30 px com menu por coluna
 * (filtro avançado, auto ajustar, congelar, ocultar), ordenação por clique, redimensionamento por arraste,
 * colunas congeladas (sticky), linhas de 26 px alternadas com destaque.
 * Seleção como no MG: clique na linha seleciona só ela (Ctrl alterna, Shift intervalo); o controle da linha
 * alterna sem desmarcar as demais; duplo clique abre o registro.
 * Congelamento como no MG: "Congelar" na coluna N congela todas até N (contagem à esquerda); clicar na âncora
 * (última congelada) descongela todas.
 */
export function Base1Grid({ columns, rows, loading, sort, onSort, selected, onSelectClick, onToggle, onToggleAll, onOpen, frozen = 0, onFreeze, onHide, onResize, onAutoFit, onFilter, footer, rowKey, emptyText, scrollToId }: {
  columns: Base1Column[]; rows: Row[]; loading?: boolean; sort?: { key: string; dir: "asc" | "desc" }; onSort?: (key: string) => void;
  selected: Set<string>; onSelectClick: (id: string, mod: SelectClick) => void; onToggle: (id: string) => void; onToggleAll: (on: boolean) => void; onOpen?: (r: Row) => void;
  frozen?: number; onFreeze?: (n: number) => void; onHide?: (key: string) => void;
  onResize?: (key: string, width: number) => void; onAutoFit?: (key: string) => void; onFilter?: (key: string) => void; density?: "compact" | "normal"; footer?: React.ReactNode;
  rowKey?: (r: Row) => string; emptyText?: string; scrollToId?: string | null;
}) {
  const key = rowKey ?? ((r: Row) => String(r["id"]));
  const allOn = rows.length > 0 && rows.every((r) => selected.has(key(r)));
  const someOn = !allOn && rows.some((r) => selected.has(key(r)));
  const ths = React.useRef<Record<string, HTMLTableCellElement | null>>({});
  const trs = React.useRef<Record<string, HTMLTableRowElement | null>>({});
  const [lefts, setLefts] = React.useState<Record<string, number>>({});
  const [menuFor, setMenuFor] = React.useState<string | null>(null); // menu de coluna aberto (fecha ao escolher uma opção)
  const frozenCount = Math.max(0, Math.min(frozen, columns.length));
  // deslocamento das colunas congeladas (sticky): larguras medidas após o layout e a cada redimensionamento
  const measure = React.useCallback(() => {
    const out: Record<string, number> = {}; let acc = SELECT_COLUMN_WIDTH;
    for (const c of columns.slice(0, frozenCount)) { out[c.key] = acc; acc += ths.current[c.key]?.getBoundingClientRect().width ?? c.width ?? 160; }
    setLefts((prev) => { const keys = Object.keys(out); return keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === out[k]) ? prev : out; });
  }, [columns, frozenCount]);
  React.useLayoutEffect(() => { measure(); }, [measure, rows.length]);
  React.useEffect(() => {
    if (!frozenCount || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    for (const c of columns.slice(0, frozenCount)) { const el = ths.current[c.key]; if (el) ro.observe(el); }
    return () => ro.disconnect();
  }, [columns, frozenCount, measure]);
  React.useEffect(() => { if (scrollToId) trs.current[scrollToId]?.scrollIntoView({ block: "center" }); }, [scrollToId, rows.length]);
  const startResize = (e: React.MouseEvent, c: Base1Column) => {
    e.preventDefault(); e.stopPropagation();
    const th = ths.current[c.key]; if (!th) return; const x0 = e.clientX; const w0 = th.getBoundingClientRect().width;
    const move = (ev: MouseEvent) => { th.style.width = th.style.minWidth = th.style.maxWidth = `${Math.max(48, w0 + ev.clientX - x0)}px`; measure(); };
    const up = (ev: MouseEvent) => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); onResize?.(c.key, Math.round(Math.max(48, w0 + ev.clientX - x0))); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  const cellText = (c: Base1Column, r: Row) => c.text ? c.text(r) : String(r[c.key] ?? "");
  const stickyBg = (on: boolean, ri: number) => on ? "var(--mg-selection-bg)" : ri % 2 === 1 ? "var(--mg-row-alt)" : "#fff";
  return <div className="mg-grid-wrap">
    <table className="mg-grid">
      <thead><tr>
        <th className="th-select sticky left-0 z-[4]"><MgCheck aria-label="Selecionar todos" checked={allOn} indeterminate={someOn} onChange={(on) => onToggleAll(on)} /></th>
        {columns.map((c, i) => { const isFrozen = i < frozenCount; const isAnchor = i === frozenCount - 1; return (
          <th key={c.key} ref={(el) => { ths.current[c.key] = el; }} style={{ ...(c.width ? { width: c.width, minWidth: c.width, maxWidth: c.width } : { minWidth: 110 }), ...(isFrozen ? { left: lefts[c.key] ?? 0, zIndex: 4 } : {}) }} className={cn("group relative", isFrozen && "is-frozen", isAnchor && "is-frozen-anchor", c.align === "right" && "!text-right")}>
            <div className="flex h-[30px] items-center gap-1">
              <button type="button" className={cn("inline-flex min-w-0 flex-1 items-center gap-1 truncate text-left", !onSort && "cursor-default")} onClick={() => c.sortable !== false && onSort?.(c.key)} title={c.label}><span className="truncate">{c.label}</span>{sort?.key === c.key && (sort.dir === "asc" ? <ArrowUp className="h-3 w-3 text-[var(--mg-accent)]" /> : <ArrowDown className="h-3 w-3 text-[var(--mg-accent)]" />)}</button>
              <B1Popover className="w-52 p-1" align="start" open={menuFor === c.key} onOpenChange={(o) => setMenuFor(o ? c.key : null)} trigger={<button type="button" aria-label={`Abrir menu da coluna ${c.label}`} className="th-menu"><MoreVertical /></button>}>
                <MenuList onPick={(k) => { setMenuFor(null); if (k === "filter") onFilter?.(c.key); if (k === "fit") onAutoFit?.(c.key); if (k === "freeze") onFreeze?.(isAnchor ? 0 : i + 1); if (k === "hide") onHide?.(c.key); }} items={[
                  { key: "filter", label: "Abrir filtro avançado", icon: <Filter className="h-4 w-4" />, disabled: !onFilter || !c.kind },
                  { key: "fit", label: "Auto ajustar coluna", icon: <Scaling className="h-4 w-4" />, disabled: !onAutoFit },
                  { key: "freeze", label: isAnchor ? "Descongelar colunas" : isFrozen ? "Congelar até esta coluna" : "Congelar coluna", icon: <PanelLeft className="h-4 w-4" />, disabled: !onFreeze },
                  { key: "hide", label: "Ocultar coluna", icon: <EyeOff className="h-4 w-4" />, disabled: !onHide || columns.length <= 1 }
                ]} />
              </B1Popover>
            </div>
            <span role="separator" aria-label={`Redimensionar ${c.label}`} onMouseDown={(e) => startResize(e, c)} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 hover:bg-[var(--mg-accent)] hover:opacity-60" />
          </th>); })}
      </tr></thead>
      <tbody>
        {loading && rows.length === 0 && <tr><td colSpan={columns.length + 2} className="!h-24 text-center"><Spinner className="mx-auto" /></td></tr>}
        {!loading && rows.length === 0 && <tr><td colSpan={columns.length + 2} className="!h-24"><Empty text={emptyText} /></td></tr>}
        {rows.map((r, ri) => { const id = key(r); const on = selected.has(id); return (
          <tr key={id} ref={(el) => { trs.current[id] = el; }} data-testid="b1-row" aria-selected={on} className={cn(on && "selected", ri % 2 === 1 ? "odd" : "even")} onClick={(e) => onSelectClick(id, selectClickOf(e))} onDoubleClick={() => onOpen?.(r)}>
            <td className="td-select sticky left-0 z-[2]" style={{ background: stickyBg(on, ri) }} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}><MgCheck aria-label="Selecionar linha" checked={on} onChange={() => onToggle(id)} /></td>
            {columns.map((c, i) => { const isFrozen = i < frozenCount; const t = cellText(c, r); return (
              <td key={c.key} title={t} style={{ ...(c.width ? { width: c.width, minWidth: c.width, maxWidth: c.width } : {}), ...(isFrozen ? { left: lefts[c.key] ?? 0, zIndex: 2, background: stickyBg(on, ri) } : {}) }} className={cn(onOpen && "cursor-pointer", isFrozen && "is-frozen", i === frozenCount - 1 && "is-frozen-anchor", c.align === "right" && "!text-right tabular-nums")}>{c.render ? c.render(r) : t || <span className="text-slate-400">–</span>}</td>); })}
          </tr>); })}
      </tbody>
      {footer && <tfoot className="bg-slate-50 font-semibold">{footer}</tfoot>}
    </table>
  </div>;
}
