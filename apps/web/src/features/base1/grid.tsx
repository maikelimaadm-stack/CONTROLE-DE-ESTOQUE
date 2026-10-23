"use client";
import * as React from "react";
import { MoreVertical, ArrowUp, ArrowDown, Filter, Scaling, PanelLeft, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { fonteDaCelula, medirTextos } from "@/lib/largura-coluna";
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
 * Congelamento em prefixo: "Congelar" na coluna N congela todas até N; âncora descongela.
 * Auto ajustar (menu) é estado contínuo até desligar; duplo clique na alça só ajusta a largura (não liga o modo).
 * Mini-ícones: filtro/auto; congelar só na âncora; com congeladas, a coluna de seleção também fica sticky.
 */
export function Base1Grid({ columns, rows, loading, sort, onSort, selected, onSelectClick, onToggle, onToggleAll, onOpen, frozen = 0, onFreeze, onHide, onResize, onAutoFit, onFilter, footer, rowKey, emptyText, scrollToId, filteredKeys, autoFitKeys, referenceHeaders: _referenceHeaders = false, popoverClassName, selecaoSticky = true }: {
  columns: Base1Column[]; rows: Row[]; loading?: boolean; sort?: { key: string; dir: "asc" | "desc" }; onSort?: (key: string) => void;
  selected: Set<string>; onSelectClick: (id: string, mod: SelectClick) => void; onToggle: (id: string) => void; onToggleAll: (on: boolean) => void; onOpen?: (r: Row) => void;
  frozen?: number; onFreeze?: (n: number) => void; onHide?: (key: string) => void;
  onResize?: (key: string, width: number) => void; onAutoFit?: (key: string) => void; onFilter?: (key: string) => void; density?: "compact" | "normal"; footer?: React.ReactNode;
  rowKey?: (r: Row) => string; emptyText?: string; scrollToId?: string | null;
  /** colunas com filtro ativo */ filteredKeys?: Set<string>;
  /** colunas com auto ajustar ligado (até desativar) */ autoFitKeys?: Set<string>;
  referenceHeaders?: boolean;
  popoverClassName?: string;
  /**
   * Se a coluna de seleção fica fixa à esquerda no scroll horizontal.
   * `false` no Portal de Compras (decisão 338).
   */
  selecaoSticky?: boolean;
}) {
  const key = rowKey ?? ((r: Row) => String(r["id"]));
  const allOn = rows.length > 0 && rows.every((r) => selected.has(key(r)));
  const someOn = !allOn && rows.some((r) => selected.has(key(r)));
  const ths = React.useRef<Record<string, HTMLTableCellElement | null>>({});
  const trs = React.useRef<Record<string, HTMLTableRowElement | null>>({});
  const [lefts, setLefts] = React.useState<Record<string, number>>({});
  const [menuFor, setMenuFor] = React.useState<string | null>(null);
  const pinnedCount = (() => { let n = 0; while (n < columns.length && columns[n]!.pinned === "left") n++; return n; })();
  const frozenCount = Math.max(0, Math.min(Math.max(frozen, pinnedCount), columns.length));
  /** Com colunas congeladas, a seleção também fica sticky (Portal e demais). */
  const selectCongelado = selecaoSticky || frozenCount > 0;
  const leftBase = selectCongelado ? SELECT_COLUMN_WIDTH : 0;
  const measure = React.useCallback(() => {
    const out: Record<string, number> = {};
    let acc = leftBase;
    for (const c of columns.slice(0, frozenCount)) {
      out[c.key] = acc;
      acc += ths.current[c.key]?.getBoundingClientRect().width ?? c.width ?? 160;
    }
    setLefts((prev) => {
      const keys = Object.keys(out);
      return keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === out[k]) ? prev : out;
    });
  }, [columns, frozenCount, leftBase]);
  React.useLayoutEffect(() => { measure(); }, [measure, rows.length]);
  React.useEffect(() => {
    if (!frozenCount || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    for (const c of columns.slice(0, frozenCount)) { const el = ths.current[c.key]; if (el) ro.observe(el); }
    return () => ro.disconnect();
  }, [columns, frozenCount, measure]);
  React.useEffect(() => { if (scrollToId) trs.current[scrollToId]?.scrollIntoView({ block: "center" }); }, [scrollToId, rows.length]);
  const cellText = (c: Base1Column, r: Row) => c.text ? c.text(r) : String(r[c.key] ?? "");
  /** Mede pelo texto do rótulo + células (canvas) — estável; não usa scrollWidth da caixa. */
  const larguraPorConteudo = (c: Base1Column) => {
    const th = ths.current[c.key];
    const textos = [c.label, ...rows.map((r) => cellText(c, r)).filter((t) => t && t !== "–" && t !== "—")];
    return medirTextos(textos, fonteDaCelula(th));
  };
  /** Menu: liga = mede + marca estado; desliga = só tira o estado (largura fica). */
  const aplicarAutoAjuste = (c: Base1Column, jaLigado: boolean) => {
    if (jaLigado) { onAutoFit?.(c.key); return; }
    onResize?.(c.key, larguraPorConteudo(c));
    onAutoFit?.(c.key);
  };
  /** Duplo clique na alça: só ajusta a largura uma vez — NÃO liga o modo auto ajustar. */
  const ajustarLarguraUmaVez = (c: Base1Column) => {
    onResize?.(c.key, larguraPorConteudo(c));
  };
  /** Enquanto o modo está ligado, reaplica quando mudam linhas/colunas. */
  React.useEffect(() => {
    if (!autoFitKeys?.size || !onResize) return;
    for (const c of columns) {
      if (!autoFitKeys.has(c.key)) continue;
      const w = larguraPorConteudo(c);
      if (c.width !== w) onResize(c.key, w);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mede com rows/columns atuais; evita loop por identidade de onResize
  }, [autoFitKeys, rows, columns]);
  const startResize = (e: React.MouseEvent, c: Base1Column) => {
    if (e.detail > 1) return;
    e.preventDefault(); e.stopPropagation();
    const th = ths.current[c.key]; if (!th) return; const x0 = e.clientX; const w0 = th.getBoundingClientRect().width;
    const move = (ev: MouseEvent) => { th.style.width = th.style.minWidth = th.style.maxWidth = `${Math.max(48, w0 + ev.clientX - x0)}px`; measure(); };
    const up = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up);
      onResize?.(c.key, Math.round(Math.max(48, w0 + ev.clientX - x0)));
      if (autoFitKeys?.has(c.key)) onAutoFit?.(c.key); // arrastar desliga o auto ajustar
    };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  const stickyBg = (on: boolean, ri: number) => on ? "var(--mg-selection-bg)" : ri % 2 === 1 ? "var(--mg-row-alt)" : "#fff";
  void _referenceHeaders;
  return <div className="mg-grid-wrap">
    <table className="mg-grid">
      <thead><tr>
        <th className={cn("th-select", selectCongelado && "sticky left-0 z-[4]")}><MgCheck aria-label="Selecionar todos" checked={allOn} indeterminate={someOn} onChange={(on) => onToggleAll(on)} /></th>
        {columns.map((c, i) => {
          const isFrozen = i < frozenCount;
          const isAnchor = i === frozenCount - 1 && frozenCount > 0;
          const fitOn = Boolean(autoFitKeys?.has(c.key));
          const filterOn = Boolean(filteredKeys?.has(c.key));
          /** Mini-ícones: filtro/auto; congelar só na âncora (não nas colunas à esquerda). */
          const temIcones = filterOn || fitOn || isAnchor;
          return (
          <th key={c.key} ref={(el) => { ths.current[c.key] = el; }} style={{ ...(c.width ? { width: c.width, minWidth: c.width, maxWidth: c.width } : { minWidth: 110 }), ...(isFrozen ? { left: lefts[c.key] ?? leftBase, zIndex: 4 } : {}) }} className={cn("group relative", isFrozen && "is-frozen", isAnchor && "is-frozen-anchor", c.align === "right" && "!text-right")}>
            <div className="flex h-[30px] items-center gap-1">
              <button type="button" className={cn("inline-flex min-w-0 flex-1 items-center gap-1 truncate text-left", !onSort && "cursor-default")} onClick={() => c.sortable !== false && onSort?.(c.key)} title={c.label}>
                <span className="truncate">{c.label}</span>
                {sort?.key === c.key && (sort.dir === "asc" ? <ArrowUp className="h-3 w-3 shrink-0 text-[var(--mg-accent)]" /> : <ArrowDown className="h-3 w-3 shrink-0 text-[var(--mg-accent)]" />)}
              </button>
              {temIcones && <span className="th-estado" aria-hidden>
                {filterOn && <Filter className="th-estado-icone" strokeWidth={2.25} />}
                {fitOn && <Scaling className="th-estado-icone" strokeWidth={2.25} />}
                {isAnchor && <PanelLeft className="th-estado-icone" strokeWidth={2.25} />}
              </span>}
              {(() => {
                const rotuloFreeze = isAnchor ? "Descongelar colunas" : isFrozen ? "Congelar até esta coluna" : "Congelar coluna";
                const itens = [
                  ...(c.filterable === false ? [] : [{ key: "filter", label: "Abrir filtro avançado", icon: <Filter className="h-4 w-4" />, disabled: !onFilter || !c.kind }]),
                  ...(c.autoFit === false ? [] : [{ key: "fit", label: fitOn ? "Desativar auto ajustar" : "Auto ajustar coluna", icon: <Scaling className="h-4 w-4" />, disabled: !onAutoFit }]),
                  ...(c.freezable === false ? [] : [{ key: "freeze", label: rotuloFreeze, icon: <PanelLeft className="h-4 w-4" />, disabled: !onFreeze }]),
                  ...(c.hideable === false ? [] : [{ key: "hide", label: "Ocultar coluna", icon: <EyeOff className="h-4 w-4" />, disabled: !onHide || columns.length <= 1 }])
                ];
                if (!itens.length) return null;
                return <B1Popover className={cn("w-52 p-1", popoverClassName)} align="start" open={menuFor === c.key} onOpenChange={(o) => setMenuFor(o ? c.key : null)} trigger={<button type="button" aria-label={`Abrir menu da coluna ${c.label}`} className="th-menu"><MoreVertical className="h-3 w-3" strokeWidth={2.25} /></button>}>
                  <MenuList onPick={(k) => {
                    setMenuFor(null);
                    if (k === "filter") onFilter?.(c.key);
                    if (k === "fit") aplicarAutoAjuste(c, fitOn);
                    if (k === "freeze") onFreeze?.(isAnchor ? 0 : i + 1);
                    if (k === "hide") onHide?.(c.key);
                  }} items={itens} />
                </B1Popover>;
              })()}
            </div>
            {c.resizable !== false && <span
              role="separator"
              aria-label={`Redimensionar ${c.label}`}
              title="Arraste para redimensionar · duplo clique para ajustar à largura"
              onMouseDown={(e) => startResize(e, c)}
              onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); ajustarLarguraUmaVez(c); }}
              className="absolute right-0 top-0 z-[5] h-full w-1.5 cursor-col-resize touch-none select-none bg-transparent"
            />}
          </th>); })}
      </tr></thead>
      <tbody>
        {loading && rows.length === 0 && <tr><td colSpan={columns.length + 2} className="!h-24 text-center"><Spinner className="mx-auto" /></td></tr>}
        {!loading && rows.length === 0 && <tr><td colSpan={columns.length + 2} className="!h-24"><Empty text={emptyText} /></td></tr>}
        {rows.map((r, ri) => { const id = key(r); const on = selected.has(id); return (
          <tr key={id} ref={(el) => { trs.current[id] = el; }} data-testid="b1-row" aria-selected={on} className={cn(on && "selected", ri % 2 === 1 ? "odd" : "even")} onClick={(e) => onSelectClick(id, selectClickOf(e))} onDoubleClick={() => onOpen?.(r)}>
            <td className={cn("td-select", selectCongelado && "sticky left-0 z-[2]")} style={selectCongelado ? { background: stickyBg(on, ri) } : undefined} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}><MgCheck aria-label="Selecionar linha" checked={on} onChange={() => onToggle(id)} /></td>
            {columns.map((c, i) => { const isFrozen = i < frozenCount; const t = cellText(c, r); return (
              <td key={c.key} title={t} style={{ ...(c.width ? { width: c.width, minWidth: c.width, maxWidth: c.width } : {}), ...(isFrozen ? { left: lefts[c.key] ?? leftBase, zIndex: 2, background: stickyBg(on, ri) } : {}) }} className={cn(onOpen && "cursor-pointer", isFrozen && "is-frozen", i === frozenCount - 1 && frozenCount > 0 && "is-frozen-anchor", c.align === "right" && "!text-right tabular-nums")}>{c.render ? c.render(r) : t || <span className="text-slate-400">–</span>}</td>); })}
          </tr>); })}
      </tbody>
      {footer && <tfoot className="bg-slate-50 font-semibold">{footer}</tfoot>}
    </table>
  </div>;
}
