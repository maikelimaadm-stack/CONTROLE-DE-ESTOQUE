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
 *
 * Congelamento:
 * - padrão (prefixo): "Congelar" na coluna N congela todas até N; âncora descongela.
 * - `freezeSingle` (Portal/itens da nota, decisão 349): no máximo UMA coluna sticky à esquerda.
 */
export function Base1Grid({ columns, rows, loading, sort, onSort, selected, onSelectClick, onToggle, onToggleAll, onOpen, frozen = 0, onFreeze, onHide, onResize, onAutoFit, onFilter, footer, rowKey, emptyText, scrollToId, filteredKeys, referenceHeaders: _referenceHeaders = false, popoverClassName, selecaoSticky = true, freezeSingle = false }: {
  columns: Base1Column[]; rows: Row[]; loading?: boolean; sort?: { key: string; dir: "asc" | "desc" }; onSort?: (key: string) => void;
  selected: Set<string>; onSelectClick: (id: string, mod: SelectClick) => void; onToggle: (id: string) => void; onToggleAll: (on: boolean) => void; onOpen?: (r: Row) => void;
  frozen?: number; onFreeze?: (n: number) => void; onHide?: (key: string) => void;
  onResize?: (key: string, width: number) => void; onAutoFit?: (key: string) => void; onFilter?: (key: string) => void; density?: "compact" | "normal"; footer?: React.ReactNode;
  rowKey?: (r: Row) => string; emptyText?: string; scrollToId?: string | null; /** colunas com filtro ativo (o botão do menu fica destacado) */ filteredKeys?: Set<string>; referenceHeaders?: boolean;
  /** classe extra nos popovers portalados do menu de coluna (ex.: marcador do Portal de Compras). */ popoverClassName?: string;
  /**
   * Se a coluna de seleção fica fixa à esquerda no scroll horizontal.
   * `false` no Portal de Compras (decisão 338): a célula da linha grudava e o cabeçalho não —
   * o checkbox sobrepunha o conteúdo; a seleção rola com a grade.
   */
  selecaoSticky?: boolean;
  /** No máximo uma coluna congelada (índice 1-based em `frozen`; 0 = nenhuma). */
  freezeSingle?: boolean;
}) {
  const key = rowKey ?? ((r: Row) => String(r["id"]));
  const allOn = rows.length > 0 && rows.every((r) => selected.has(key(r)));
  const someOn = !allOn && rows.some((r) => selected.has(key(r)));
  const ths = React.useRef<Record<string, HTMLTableCellElement | null>>({});
  const trs = React.useRef<Record<string, HTMLTableRowElement | null>>({});
  const [lefts, setLefts] = React.useState<Record<string, number>>({});
  const [menuFor, setMenuFor] = React.useState<string | null>(null); // menu de coluna aberto (fecha ao escolher uma opção)
  /**
   * Congelamento = PREFIXO ESTRUTURAL + escolha do usuário (modo padrão).
   * Com `freezeSingle`, `frozen` é o índice 1-based da única coluna sticky.
   */
  const pinnedCount = (() => { let n = 0; while (n < columns.length && columns[n]!.pinned === "left") n++; return n; })();
  const frozenCount = Math.max(0, Math.min(Math.max(frozen, pinnedCount), columns.length));
  const frozenIdx = freezeSingle ? (frozenCount > 0 ? frozenCount - 1 : -1) : -1;
  const leftBase = selecaoSticky ? SELECT_COLUMN_WIDTH : 0;
  // deslocamento das colunas congeladas (sticky): larguras medidas após o layout e a cada redimensionamento.
  const measure = React.useCallback(() => {
    const out: Record<string, number> = {};
    if (freezeSingle) {
      if (frozenIdx >= 0) {
        const c = columns[frozenIdx];
        if (c) out[c.key] = leftBase;
      }
    } else {
      let acc = leftBase;
      for (const c of columns.slice(0, frozenCount)) {
        out[c.key] = acc;
        acc += ths.current[c.key]?.getBoundingClientRect().width ?? c.width ?? 160;
      }
    }
    setLefts((prev) => {
      const keys = Object.keys(out);
      return keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === out[k]) ? prev : out;
    });
  }, [columns, frozenCount, frozenIdx, freezeSingle, leftBase]);
  React.useLayoutEffect(() => { measure(); }, [measure, rows.length]);
  React.useEffect(() => {
    if (!frozenCount || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    const observed = freezeSingle && frozenIdx >= 0
      ? [columns[frozenIdx]].filter(Boolean)
      : columns.slice(0, frozenCount);
    for (const c of observed) { const el = ths.current[c!.key]; if (el) ro.observe(el); }
    return () => ro.disconnect();
  }, [columns, frozenCount, frozenIdx, freezeSingle, measure]);
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
  const isColFrozen = (i: number) => (freezeSingle ? i === frozenIdx : i < frozenCount);
  const isColAnchor = (i: number) => (freezeSingle ? i === frozenIdx : i === frozenCount - 1 && frozenCount > 0);
  void _referenceHeaders; // pais ainda passam (filtro/ordem); o menu do cabeçalho é sempre o completo (349)
  return <div className="mg-grid-wrap">
    <table className="mg-grid">
      <thead><tr>
        <th className={cn("th-select", selecaoSticky && "sticky left-0 z-[4]")}><MgCheck aria-label="Selecionar todos" checked={allOn} indeterminate={someOn} onChange={(on) => onToggleAll(on)} /></th>
        {columns.map((c, i) => {
          const isFrozen = isColFrozen(i);
          const isAnchor = isColAnchor(i);
          return (
          <th key={c.key} ref={(el) => { ths.current[c.key] = el; }} style={{ ...(c.width ? { width: c.width, minWidth: c.width, maxWidth: c.width } : { minWidth: 110 }), ...(isFrozen ? { left: lefts[c.key] ?? leftBase, zIndex: 4 } : {}) }} className={cn("group relative", isFrozen && "is-frozen", isAnchor && "is-frozen-anchor", c.align === "right" && "!text-right")}>
            <div className="flex h-[30px] items-center gap-1">
              <button type="button" className={cn("inline-flex min-w-0 flex-1 items-center gap-1 truncate text-left", !onSort && "cursor-default")} onClick={() => c.sortable !== false && onSort?.(c.key)} title={c.label}><span className="truncate">{c.label}</span>{sort?.key === c.key && (sort.dir === "asc" ? <ArrowUp className="h-3 w-3 text-[var(--mg-accent)]" /> : <ArrowDown className="h-3 w-3 text-[var(--mg-accent)]" />)}</button>
              {(() => {
                /**
                 * O menu só existe quando ALGUMA ação é realmente possível nesta coluna. Uma coluna que
                 * declara `hideable/resizable/freezable/autoFit: false` (identidade fixa) não ganha um menu
                 * com entradas mortas: ela simplesmente não tem menu — e a alça de redimensionar também não
                 * é renderizada. Controle que não faz nada é pior do que controle ausente.
                 */
                const rotuloFreeze = freezeSingle
                  ? (isFrozen ? "Descongelar coluna" : "Congelar coluna")
                  : (isAnchor ? "Descongelar colunas" : isFrozen ? "Congelar até esta coluna" : "Congelar coluna");
                const itens = [
                  ...(c.filterable === false ? [] : [{ key: "filter", label: "Abrir filtro avançado", icon: <Filter className="h-4 w-4" />, disabled: !onFilter || !c.kind }]),
                  ...(c.autoFit === false ? [] : [{ key: "fit", label: "Auto ajustar coluna", icon: <Scaling className="h-4 w-4" />, disabled: !onAutoFit }]),
                  ...(c.freezable === false ? [] : [{ key: "freeze", label: rotuloFreeze, icon: <PanelLeft className="h-4 w-4" />, disabled: !onFreeze }]),
                  ...(c.hideable === false ? [] : [{ key: "hide", label: "Ocultar coluna", icon: <EyeOff className="h-4 w-4" />, disabled: !onHide || columns.length <= 1 }])
                ];
                if (!itens.length) return null;
                return <B1Popover className={cn("w-52 p-1", popoverClassName)} align="start" open={menuFor === c.key} onOpenChange={(o) => setMenuFor(o ? c.key : null)} trigger={<button type="button" aria-label={`Abrir menu da coluna ${c.label}`} className={cn("th-menu", filteredKeys?.has(c.key) && "is-on")}>{filteredKeys?.has(c.key) ? <Filter /> : <MoreVertical />}</button>}>
                  <MenuList onPick={(k) => {
                    setMenuFor(null);
                    if (k === "filter") onFilter?.(c.key);
                    if (k === "fit") onAutoFit?.(c.key);
                    if (k === "freeze") {
                      if (freezeSingle) onFreeze?.(isFrozen ? 0 : i + 1);
                      else onFreeze?.(isAnchor ? 0 : i + 1);
                    }
                    if (k === "hide") onHide?.(c.key);
                  }} items={itens} />
                </B1Popover>;
              })()}
            </div>
            {/* Alça na divisão: hit 6px, sem marcador; cursor col-resize (par com grade Central). */}
            {c.resizable !== false && <span role="separator" aria-label={`Redimensionar ${c.label}`} onMouseDown={(e) => startResize(e, c)} className="absolute right-0 top-0 z-[5] h-full w-1.5 cursor-col-resize touch-none select-none bg-transparent" />}
          </th>); })}
      </tr></thead>
      <tbody>
        {loading && rows.length === 0 && <tr><td colSpan={columns.length + 2} className="!h-24 text-center"><Spinner className="mx-auto" /></td></tr>}
        {!loading && rows.length === 0 && <tr><td colSpan={columns.length + 2} className="!h-24"><Empty text={emptyText} /></td></tr>}
        {rows.map((r, ri) => { const id = key(r); const on = selected.has(id); return (
          <tr key={id} ref={(el) => { trs.current[id] = el; }} data-testid="b1-row" aria-selected={on} className={cn(on && "selected", ri % 2 === 1 ? "odd" : "even")} onClick={(e) => onSelectClick(id, selectClickOf(e))} onDoubleClick={() => onOpen?.(r)}>
            <td className={cn("td-select", selecaoSticky && "sticky left-0 z-[2]")} style={selecaoSticky ? { background: stickyBg(on, ri) } : undefined} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}><MgCheck aria-label="Selecionar linha" checked={on} onChange={() => onToggle(id)} /></td>
            {columns.map((c, i) => { const isFrozen = isColFrozen(i); const t = cellText(c, r); return (
              <td key={c.key} title={t} style={{ ...(c.width ? { width: c.width, minWidth: c.width, maxWidth: c.width } : {}), ...(isFrozen ? { left: lefts[c.key] ?? leftBase, zIndex: 2, background: stickyBg(on, ri) } : {}) }} className={cn(onOpen && "cursor-pointer", isFrozen && "is-frozen", isColAnchor(i) && "is-frozen-anchor", c.align === "right" && "!text-right tabular-nums")}>{c.render ? c.render(r) : t || <span className="text-slate-400">–</span>}</td>); })}
          </tr>); })}
      </tbody>
      {footer && <tfoot className="bg-slate-50 font-semibold">{footer}</tfoot>}
    </table>
  </div>;
}
