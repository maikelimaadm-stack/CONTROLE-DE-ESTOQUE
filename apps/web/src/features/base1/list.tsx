"use client";
import * as React from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Filter, Plus, EyeOff, Eye, MoreHorizontal, ChevronLeft, ChevronRight, ChevronsDown, FilterX, Columns3, Copy, Printer, Download, History, Settings, FileDown, FileBarChart, PanelLeftClose, PanelLeftOpen, Trash2, Building2, RotateCcw } from "lucide-react";
import { BASE1_PAGE_SIZES, BASE1_DEFAULT_PAGE_SIZE, type ListPreferences } from "@agro/shared";
import { cn } from "@/lib/utils";
import { getSession } from "@/lib/api";
import { Confirm, ErrorBox } from "@/components/ui";
import { useListPrefs, type ListFilterInfo } from "@/features/listing/list-prefs";
import { IconBtn, PillBtn, ViewSwitch, B1Popover, MenuList, SearchBox, type ViewMode } from "./ui";
import { FilterChip } from "./filter-chip";
import { ColumnsDialog } from "./columns-dialog";
import { Base1Cards, CardsLayoutPopover, CardFieldsPopover } from "./cards";
import { Base1Grid } from "./grid";
import { FilterDrawer } from "./filter-drawer";
import { HistoryDialog } from "./history-dialog";
import { toParams, fromParams, emptyValue } from "./params";
import type { Base1Column, Base1FilterDef, DistinctValue, FilterValues, Row } from "./types";

export interface PageResult { items: Row[]; total: number; totals?: Record<string, string> }
export interface PageParams { page: number; pageSize: number; sort?: string; dir?: "asc" | "desc"; search?: string; filters: Record<string, string> }
export interface RecordProps { row: Row | null; index: number; total: number; go: (i: number) => void; onExit: () => void; refresh: () => void; rightSlot: React.ReactNode; mode: "view" | "edit" | "new"; setMode: (m: "view" | "edit" | "new") => void; copyFrom?: Row | null }

export interface Base1ListProps {
  moduleId: string; title: string; columns: Base1Column[]; filters: Base1FilterDef[];
  fetchPage: (p: PageParams) => Promise<PageResult>;
  /** total sem filtros (rodapé "Totais"); padrão: total da consulta sem filtros/pesquisa */
  distinct?: (key: string, search: string) => Promise<DistinctValue[]>;
  searchable?: boolean; searchPlaceholder?: string;
  canCreate?: boolean; onNew?: () => void;
  onOpen?: (row: Row) => void;
  rowActions?: (row: Row) => { label: string; onClick: () => void; danger?: boolean }[];
  /** entidade da auditoria (nome da tabela) para o "Histórico" */
  entity?: string;
  exportXlsx?: (p: { search?: string; filters: Record<string, string> }) => Promise<void> | void;
  reportHref?: (p: { search?: string; filters: Record<string, string> }) => string;
  canDelete?: boolean; onDelete?: (row: Row) => Promise<void> | void; deleteText?: string;
  onDuplicate?: (row: Row) => void;
  /** componente do modo "Registro" (formulário embutido com navegação entre registros) */
  Record?: React.ComponentType<RecordProps>;
  extraMenu?: { key: string; label: string; icon?: React.ReactNode; onClick: () => void }[];
  /** botões adicionais ao lado de "Novo" (ex.: Importar XML) */
  extraToolbar?: React.ReactNode;
  createLabel?: string;
  footerTotals?: (totals: Record<string, string>) => React.ReactNode;
  /** parâmetros vindos da URL (ex.: people?is_provider=true) → filtros aplicados */
  initialParams?: Record<string, string>;
  /** filtros iniciais (ex.: período do mês nos lançamentos) */
  defaultValues?: FilterValues;
  /** chave extra da consulta (muda quando fixos mudam) */
  queryKeyExtra?: unknown;
  /** exportação CSV local a partir das linhas carregadas quando não há exportação no servidor */
  csvName?: string;
  className?: string;
}

/**
 * MODELO BASE1 — listagem completa: barra superior, faixa de chips de filtro, grade / cards / registro,
 * rodapé com contadores e "Carregar mais". Preferências por usuário (padrão da organização opcional).
 */
export function Base1List(props: Base1ListProps) {
  const { moduleId, title, columns, filters, fetchPage, distinct, searchable, canCreate, onNew, onOpen, rowActions, entity, exportXlsx, reportHref, canDelete, onDelete, onDuplicate, Record, extraMenu, footerTotals, initialParams, defaultValues, queryKeyExtra, csvName } = props;
  const colInfo = React.useMemo(() => columns.map((c) => ({ key: c.key, label: c.label })), [columns]);
  const filterInfo = React.useMemo<ListFilterInfo[]>(() => filters.map((f) => ({ key: f.key, label: f.label, kind: f.kind })), [filters]);
  const p = useListPrefs(moduleId, colInfo, filterInfo);
  const prefs = p.prefs;
  const [view, setView] = React.useState<ViewMode>(prefs.view.mode);
  React.useEffect(() => { if (view !== "record") setView(prefs.view.mode); }, [prefs.view.mode]);
  const [values, setValues] = React.useState<FilterValues>(defaultValues ?? {});
  const [applied, setApplied] = React.useState<{ search: string; params: Record<string, string> }>({ search: "", params: toParams(filters, defaultValues ?? {}) });
  const [search, setSearch] = React.useState(""); const [favOnly, setFavOnly] = React.useState(false);
  const [showChips, setShowChips] = React.useState(true); const [drawer, setDrawer] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [openChip, setOpenChip] = React.useState<string | null>(null);
  const [colsDlg, setColsDlg] = React.useState(false); const [histDlg, setHistDlg] = React.useState(false); const [delRow, setDelRow] = React.useState<Row | null>(null);
  const [sortLocal, setSortLocal] = React.useState<{ key: string; dir: "asc" | "desc" } | undefined>();
  const [pageSizeLocal, setPageSizeLocal] = React.useState<number | undefined>();
  const [recIndex, setRecIndex] = React.useState(0); const [recMode, setRecMode] = React.useState<"view" | "edit" | "new">("view"); const [copyFrom, setCopyFrom] = React.useState<Row | null>(null);
  const stripRef = React.useRef<HTMLDivElement>(null);
  // parâmetros da URL (menus como "Fornecedores") entram como filtros aplicados
  React.useEffect(() => { if (initialParams && Object.keys(initialParams).length) { const v = fromParams(filters, initialParams, prefs.filters.operators); setValues((o) => ({ ...o, ...v })); setApplied((a) => ({ ...a, params: { ...a.params, ...initialParams } })); } }, [JSON.stringify(initialParams)]);
  const sort = sortLocal ?? prefs.sort;
  const pageSize = pageSizeLocal ?? prefs.pageSize ?? BASE1_DEFAULT_PAGE_SIZE;
  const visibleKeys = prefs.columns.visible?.length ? prefs.columns.visible : columns.map((c) => c.key);
  const orderRank = new Map((prefs.columns.order ?? []).map((k, i) => [k, i]));
  const visibleColumns = React.useMemo(() => columns.filter((c) => visibleKeys.includes(c.key)).sort((a, b) => (orderRank.get(a.key) ?? 1e6) - (orderRank.get(b.key) ?? 1e6)).map((c) => ({ ...c, width: prefs.columns.widths?.[c.key] ?? c.width })), [columns, prefs.columns]);
  const frozen = Math.min(prefs.columns.frozen ?? 0, visibleColumns.length);
  const qk = ["b1", moduleId, applied, sort, pageSize, queryKeyExtra];
  const q = useInfiniteQuery({
    queryKey: qk, initialPageParam: 1,
    queryFn: ({ pageParam }) => fetchPage({ page: pageParam, pageSize, sort: sort?.key, dir: sort?.dir, search: applied.search || undefined, filters: applied.params }),
    getNextPageParam: (last, all) => (all.reduce((n, pg) => n + pg.items.length, 0) < last.total ? all.length + 1 : undefined)
  });
  const allRows = React.useMemo(() => q.data?.pages.flatMap((pg) => pg.items) ?? [], [q.data]);
  // "Buscar favoritos": mostra só os registros marcados (selecionados) entre os carregados
  const rows = React.useMemo(() => (favOnly ? allRows.filter((r) => selected.has(String(r["id"]))) : allRows), [allRows, favOnly, selected]);
  const total = q.data?.pages[0]?.total ?? 0; const totals = q.data?.pages[0]?.totals;
  const filtersActive = Object.keys(applied.params).length > 0 || Boolean(applied.search);
  // "Totais" (sem filtro) só precisa de consulta própria quando há filtro aplicado
  const grand = useQuery({ queryKey: ["b1-total", moduleId, queryKeyExtra], queryFn: async () => (await fetchPage({ page: 1, pageSize: 1, filters: {} })).total, staleTime: 120_000, enabled: filtersActive });
  const apply = (v: FilterValues = values, s: string = search) => { setApplied({ search: s, params: toParams(filters, v) }); setSelected(new Set()); setFavOnly(false); };
  const clearAll = () => { const v = defaultValues ?? {}; setValues(v); setSearch(""); setApplied({ search: "", params: toParams(filters, v) }); setSelected(new Set()); setFavOnly(false); };
  const onSort = (k: string) => { const next = { key: k, dir: (sort?.key === k && sort.dir === "asc" ? "desc" : "asc") as "asc" | "desc" }; setSortLocal(next); p.update((x) => ({ ...x, sort: next })); };
  const setPageSize = (n: number) => { setPageSizeLocal(n); p.update((x) => ({ ...x, pageSize: n })); };
  const updCols = (fn: (c: ListPreferences["columns"]) => ListPreferences["columns"]) => p.update((x) => ({ ...x, columns: fn(x.columns) }));
  const chips = filters.filter((f) => (prefs.filters.visible ?? filters.map((x) => x.key)).includes(f.key));
  const scrollStrip = (dx: number) => stripRef.current?.scrollBy({ left: dx, behavior: "smooth" });
  const selectedRows = rows.filter((r) => selected.has(String(r["id"])));
  const one = selectedRows.length === 1 ? selectedRows[0]! : null;
  const exportCsv = () => { const cols = visibleColumns; const esc = (s: string) => `"${s.replace(/"/g, '""')}"`; const lines = [cols.map((c) => esc(c.label)).join(";"), ...rows.map((r) => cols.map((c) => esc(c.text ? c.text(r) : String(r[c.key] ?? ""))).join(";"))]; const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${csvName ?? moduleId}.csv`; a.click(); URL.revokeObjectURL(a.href); };
  const enterRecord = (r?: Row) => { if (!Record) { if (r) onOpen?.(r); return; } const i = r ? rows.findIndex((x) => x["id"] === r["id"]) : one ? rows.findIndex((x) => x["id"] === one["id"]) : 0; setRecIndex(Math.max(0, i)); setRecMode("view"); setCopyFrom(null); setView("record"); };
  // navega para um índice ainda não carregado buscando quantas páginas forem necessárias (ex.: "Último")
  const goRecord = async (i: number) => {
    if (i < 0) return;
    let loaded = rows.length; let hasNext = q.hasNextPage;
    while (i >= loaded && hasNext) { const r = await q.fetchNextPage(); loaded = r.data?.pages.reduce((n, pg) => n + pg.items.length, 0) ?? loaded; hasNext = Boolean(r.hasNextPage); if (!r.data || loaded === 0) break; }
    if (i < loaded) { setRecIndex(i); setRecMode("view"); }
  };
  const newRecord = () => { if (Record) { setCopyFrom(null); setRecMode("new"); setView("record"); } else onNew?.(); };
  const duplicate = (r: Row) => { if (onDuplicate) return onDuplicate(r); if (Record) { setCopyFrom(r); setRecMode("new"); setView("record"); } };
  const rowMenu = one && rowActions ? rowActions(one) : [];
  const menuItems = [
    ...rowMenu.map((a, i) => ({ key: `row:${i}`, label: a.label, danger: a.danger })),
    { key: "dup", label: "Duplicar", icon: <Copy className="h-4 w-4" />, disabled: !one || (!onDuplicate && !Record) },
    { key: "print", label: "Imprimir", icon: <Printer className="h-4 w-4" /> },
    { key: "export", label: exportXlsx ? "Exportar (Excel)" : "Exportar (CSV)", icon: <Download className="h-4 w-4" /> },
    ...(entity ? [{ key: "hist", label: "Histórico", icon: <History className="h-4 w-4" /> }] : []),
    { key: "cfg", label: "Configurações", icon: <Settings className="h-4 w-4" /> },
    { key: "pdf", label: "Exportar PDF", icon: <FileDown className="h-4 w-4" /> },
    ...(reportHref ? [{ key: "report", label: "Relatório personalizado", icon: <FileBarChart className="h-4 w-4" /> }] : []),
    ...(extraMenu ?? []).map((m) => ({ key: m.key, label: m.label, icon: m.icon })),
    ...(p.canEditOrg ? [{ key: "org", label: "Salvar tela como padrão da organização", icon: <Building2 className="h-4 w-4" /> }] : []),
    { key: "reset", label: "Restaurar padrão da tela", icon: <RotateCcw className="h-4 w-4" /> }
  ];
  const onMenu = (k: string) => {
    if (k.startsWith("row:")) { rowMenu[Number(k.slice(4))]?.onClick(); return; }
    if (k === "dup" && one) duplicate(one);
    if (k === "print" || k === "pdf") window.print();
    if (k === "export") { if (exportXlsx) void exportXlsx({ search: applied.search || undefined, filters: applied.params }); else exportCsv(); }
    if (k === "hist") setHistDlg(true);
    if (k === "cfg") setColsDlg(true);
    if (k === "report" && reportHref) location.href = reportHref({ search: applied.search || undefined, filters: applied.params });
    if (k === "org") void p.saveAsOrgDefault();
    if (k === "reset") void p.reset().then(() => { setSortLocal(undefined); setPageSizeLocal(undefined); toast.success("Tela restaurada ao padrão"); });
    extraMenu?.find((m) => m.key === k)?.onClick();
  };
  const rightSlot = <div className="ml-auto flex items-center gap-1.5">
    {searchable && <SearchBox value={search} onChange={setSearch} active={Boolean(applied.search) || favOnly} placeholder={props.searchPlaceholder} onApply={() => apply(values, search)} onApplyFavorites={() => { if (search !== applied.search) setApplied((a) => ({ ...a, search })); setFavOnly(true); }} favoritesDisabled={selected.size === 0} onClear={() => { setSearch(""); setFavOnly(false); setApplied((a) => ({ ...a, search: "" })); }} onConfig={() => setColsDlg(true)} />}
    <IconBtn aria-label={showChips ? "Recolher faixa de filtros" : "Exibir faixa de filtros"} title={showChips ? "Recolher faixa de filtros" : "Exibir faixa de filtros"} onClick={() => setShowChips((s) => !s)}>{showChips ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</IconBtn>
    <ViewSwitch value={view} recordDisabled={!Record && !onOpen} onChange={(m) => { if (m === "record") enterRecord(); else { setView(m); p.update((x) => ({ ...x, view: { ...x.view, mode: m } })); } }} />
    <B1Popover className="w-64 p-1.5" trigger={<IconBtn aria-label="Mais opções" title="Mais opções"><MoreHorizontal className="h-4 w-4" /></IconBtn>}><MenuList items={menuItems} onPick={onMenu} /></B1Popover>
  </div>;
  const sess = getSession();
  const chipScope = `${moduleId}:${sess?.orgId ?? "-"}:${sess?.farmId ?? "-"}:${sess?.user?.id ?? "-"}:${JSON.stringify(queryKeyExtra ?? null)}`;
  const distinctFor = (f: Base1FilterDef) => distinct && f.mode === "advanced" && f.kind !== "boolean" && !f.options ? (s: string) => distinct(f.key, s) : undefined;
  const cardFields = prefs.view.cardFields ?? columns.slice(0, 7).map((c) => c.key);

  if (view === "record" && Record) {
    return <div className={cn("b1", props.className)}>
      <Record row={recMode === "new" ? null : rows[recIndex] ?? null} index={recIndex} total={total} go={goRecord} onExit={() => { setView(prefs.view.mode); void q.refetch(); }} refresh={() => void q.refetch()} rightSlot={rightSlot} mode={recMode} setMode={setRecMode} copyFrom={copyFrom} />
      {entity && <HistoryDialog open={histDlg} onOpenChange={setHistDlg} entity={entity} entityId={rows[recIndex] ? String(rows[recIndex]!["id"]) : undefined} title={title} />}
    </div>;
  }
  return <div className={cn("b1 flex flex-col gap-2", props.className)} data-testid="b1-list">
    {/* barra superior */}
    <div className="mg-toolbar mg-card flex-wrap no-print">
      <IconBtn aria-label="Filtros" title="Filtros" active={drawer} onClick={() => setDrawer((d) => !d)}><Filter className="h-4 w-4" /></IconBtn>
      {canCreate !== false && (onNew || Record) && <PillBtn onClick={newRecord}><Plus className="h-4 w-4" /> {props.createLabel ?? "Novo"}</PillBtn>}
      {props.extraToolbar}
      {canDelete && onDelete && one && <PillBtn tone="red" onClick={() => setDelRow(one)}><Trash2 className="h-4 w-4" /> Excluir</PillBtn>}
      {rightSlot}
    </div>
    {/* faixa de chips de filtro */}
    {showChips && <div className="mg-rail mg-card no-print">
      <IconBtn size="sm" aria-label="Recolher faixa de filtros" title="Recolher faixa de filtros" active onClick={() => setShowChips(false)}><PanelLeftClose className="h-4 w-4" /></IconBtn>
      <IconBtn size="sm" aria-label="Rolar filtros para a esquerda" onClick={() => scrollStrip(-240)}><ChevronLeft className="h-4 w-4" /></IconBtn>
      <div ref={stripRef} className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:none]">
        {chips.map((f) => <FilterChip key={f.key} f={f} value={values[f.key]} open={openChip === f.key} onOpenChange={(o) => setOpenChip(o ? f.key : null)} distinct={distinctFor(f)} scope={chipScope}
          onApply={(v) => { const nv = { ...values, [f.key]: v }; setValues(nv); apply(nv, search); }} onClear={() => { const nv = { ...values, [f.key]: emptyValue(f) }; setValues(nv); apply(nv, search); }} />)}
        {chips.length === 0 && <span className="px-2 text-[11.5px] text-slate-400">Esta tela não possui filtros por coluna.</span>}
      </div>
      <IconBtn size="sm" aria-label="Rolar filtros para a direita" onClick={() => scrollStrip(240)}><ChevronRight className="h-4 w-4" /></IconBtn>
      <IconBtn size="sm" aria-label="Limpar todos os filtros" title="Limpar todos os filtros" onClick={clearAll} disabled={!filtersActive} className={cn(filtersActive && "text-red-600")}><FilterX className="h-4 w-4" /></IconBtn>
      <span className="mx-1 h-5 w-px bg-[var(--mg-divider)]" />
      {view === "cards" ? <><CardsLayoutPopover value={prefs.view.cardsPerRow ?? 4} onChange={(n) => p.update((x) => ({ ...x, view: { ...x.view, cardsPerRow: n } }))} onRestore={() => p.update((x) => ({ ...x, view: { ...x.view, cardsPerRow: undefined } }))} /><CardFieldsPopover columns={columns} value={cardFields} onChange={(keys) => p.update((x) => ({ ...x, view: { ...x.view, cardFields: keys } }))} onRestore={() => p.update((x) => ({ ...x, view: { ...x.view, cardFields: undefined } }))} /></>
        : <IconBtn size="sm" aria-label="Configurar colunas da tabela" title="Configurar colunas da tabela" onClick={() => setColsDlg(true)}><Columns3 className="h-4 w-4" /></IconBtn>}
    </div>}
    {!showChips && <div className="no-print"><button type="button" className="tb-btn tb-btn-gray" onClick={() => setShowChips(true)}><PanelLeftOpen /> Exibir faixa de filtros</button></div>}
    {/* corpo */}
    <div className="flex gap-2">
      <FilterDrawer open={drawer} onClose={() => setDrawer(false)} filters={filters} values={values} onChange={setValues} onApply={() => apply()} onClear={clearAll} />
      <div className="mg-shell min-w-0 flex-1">
        {q.error && <div className="p-2"><ErrorBox error={q.error} /></div>}
        {view === "cards"
          ? <div className="p-2.5"><Base1Cards rows={rows} columns={columns} fields={cardFields} perRow={prefs.view.cardsPerRow ?? 4} loading={q.isLoading} onOpen={(r) => enterRecord(r)} selected={selected} onSelect={(id, on) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; })} actions={rowActions} /></div>
          : <Base1Grid columns={visibleColumns} rows={rows} loading={q.isLoading} sort={sort} onSort={onSort} selected={selected} onSelect={setSelected} onOpen={(r) => enterRecord(r)} frozen={frozen}
            onFreeze={(n) => updCols((c) => ({ ...c, frozen: n }))} onHide={(k) => updCols((c) => ({ ...c, visible: visibleColumns.map((x) => x.key).filter((x) => x !== k) }))} onResize={(k, w) => updCols((c) => ({ ...c, widths: { ...(c.widths ?? {}), [k]: w } }))} onAutoFit={(k) => updCols((c) => { const w = { ...(c.widths ?? {}) }; delete w[k]; return { ...c, widths: w }; })}
            onFilter={(k) => { const f = filters.find((x) => x.key === k); if (!f) { toast.info("Esta coluna não possui filtro"); return; } if (!(prefs.filters.visible ?? filters.map((x) => x.key)).includes(k)) p.update((x) => ({ ...x, filters: { ...x.filters, visible: [...(x.filters.visible ?? filters.map((y) => y.key)), k] } })); setShowChips(true); setTimeout(() => setOpenChip(k), 50); }}
            footer={footerTotals && totals ? footerTotals(totals) : undefined} />}
        {/* rodapé (mg-records-summary) */}
        <div className="mg-summary no-print">
          <div className="mg-summary__counts"><span className="mg-summary__item">Selecionados: {selected.size}</span><span className="mg-summary__item">Listados: {allRows.length}</span><span className="mg-summary__item">Filtrados: {total}</span><span className="mg-summary__item">Totais: {filtersActive ? grand.data ?? "…" : total}</span></div>
          <span className="flex items-center gap-2">
            <select aria-label="Quantidade de registros por carregamento" className="mg-pill-select" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>{BASE1_PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select>
            <IconBtn aria-label="Carregar mais registros" title="Carregar mais registros" disabled={!q.hasNextPage || q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}><ChevronsDown /></IconBtn>
          </span>
        </div>
      </div>
    </div>
    <ColumnsDialog open={colsDlg} onOpenChange={setColsDlg} columns={columns} visible={visibleColumns.map((c) => c.key)} onApply={(keys) => updCols((c) => ({ ...c, visible: keys, order: keys }))} onRestore={() => updCols((c) => ({ ...c, visible: undefined, order: undefined, widths: undefined, frozen: undefined }))} />
    {entity && <HistoryDialog open={histDlg} onOpenChange={setHistDlg} entity={entity} entityId={one ? String(one["id"]) : undefined} title={title} />}
    {onDelete && <Confirm open={Boolean(delRow)} onOpenChange={() => setDelRow(null)} title="Confirme a exclusão" text={props.deleteText ?? "Excluir o registro selecionado? A ação fica registrada na auditoria."} danger onConfirm={async () => { if (delRow) { await onDelete(delRow); setDelRow(null); setSelected(new Set()); void q.refetch(); } }} />}
  </div>;
}
