"use client";
import * as React from "react";
import { Bookmark, Check, RotateCcw } from "lucide-react";
import { CARD_FIELDS_MAX } from "@agro/shared";
import { cn } from "@/lib/utils";
import { Spinner, Empty, Dialog } from "@/components/ui";
import { RadioRow, CheckRow } from "./ui";
import type { Base1Column, Row } from "./types";

const initials = (s: string) => s.replace(/[^\p{L}\p{N} ]/gu, "").trim().slice(0, 3).toUpperCase() || "—";
const gridCls: Record<number, string> = { 1: "grid-cols-1", 2: "md:grid-cols-2", 3: "md:grid-cols-2 xl:grid-cols-3", 4: "md:grid-cols-2 xl:grid-cols-4" };

/** Modificadores do clique de seleção (mesma semântica da tabela e dos cards do MG). */
export interface SelectClick { ctrl: boolean; shift: boolean }
export const selectClickOf = (e: React.MouseEvent | React.KeyboardEvent): SelectClick => ({ ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });

/**
 * Cards do modelo base: avatar com iniciais, "CÓDIGO • título", linhas rótulo: valor, selo de seleção.
 * Seleção como no MG: clique seleciona só aquele card; clique no card já selecionado desmarca; Ctrl alterna
 * (multi); Shift seleciona o intervalo; duplo clique abre o registro.
 * Ações do registro ficam no Mais opções (com a linha selecionada) — sem ⋮ no card.
 */
export function Base1Cards({ rows, columns, fields, perRow, loading, onOpen, selected, onSelectClick, favorites, onFavorite, scrollToId }: { rows: Row[]; columns: Base1Column[]; fields: string[]; perRow: 1 | 2 | 3 | 4; loading?: boolean; onOpen?: (r: Row) => void; selected: Set<string>; onSelectClick: (id: string, mod: SelectClick) => void; favorites?: Set<string>; onFavorite?: (id: string, on: boolean) => void; scrollToId?: string | null }) {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const text = (c: Base1Column, r: Row) => c.text ? c.text(r) : String(r[c.key] ?? "");
  const titleCol = byKey.get("name") ?? byKey.get("description") ?? byKey.get("title") ?? columns.find((c) => c.key !== "code") ?? columns[0];
  const codeCol = byKey.get("code");
  const shown = fields.map((k) => byKey.get(k)).filter((c): c is Base1Column => Boolean(c) && c !== titleCol && c !== codeCol);
  const refs = React.useRef<Record<string, HTMLDivElement | null>>({});
  React.useEffect(() => { if (scrollToId) refs.current[scrollToId]?.scrollIntoView({ block: "center" }); }, [scrollToId, rows.length]);
  if (loading && !rows.length) return <div className="py-10 text-center"><Spinner className="mx-auto" /></div>;
  if (!rows.length) return <Empty />;
  return <div className={cn("grid grid-cols-1 gap-3", gridCls[perRow])} role="listbox" aria-multiselectable>
    {rows.map((r) => { const id = String(r["id"]); const on = selected.has(id); const t = titleCol ? text(titleCol, r) : ""; const code = codeCol ? text(codeCol, r) : ""; return (
      <div key={id} ref={(el) => { refs.current[id] = el; }} data-testid="b1-card" role="option" tabIndex={0} aria-selected={on} className={cn("mg-card b1-card group relative cursor-pointer select-none p-4 transition-shadow hover:shadow-[0_6px_20px_rgba(0,0,0,.09)]", on && "is-selected")}
        onClick={(e) => onSelectClick(id, selectClickOf(e))} onDoubleClick={() => onOpen?.(r)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onOpen?.(r); } else if (e.key === " ") { e.preventDefault(); onSelectClick(id, selectClickOf(e)); } }}>
        {on && <span className="b1-card__badge" aria-hidden><Check className="h-3 w-3" strokeWidth={3} /></span>}
        <div className="flex items-center gap-2">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--mg-accent)] text-[11px] font-bold text-white">{initials(t)}</span>
          <button type="button" aria-label={favorites?.has(id) ? "Remover dos favoritos" : "Adicionar aos favoritos"} title={favorites?.has(id) ? "Remover dos favoritos" : "Favoritar"} onClick={(e) => { e.stopPropagation(); onFavorite?.(id, !favorites?.has(id)); }} onDoubleClick={(e) => e.stopPropagation()} className={cn("mg-record-fav-btn rounded p-0.5", favorites?.has(id) && "is-active")}><Bookmark className={cn("h-4 w-4", favorites?.has(id) && "fill-current")} /></button>
          <span className="min-w-0 flex-1 truncate text-left text-[12.5px] font-semibold text-slate-800">{code && <span className="text-slate-500">{code} • </span>}{t}</span>
        </div>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
          {shown.map((c) => <React.Fragment key={c.key}><dt className="truncate text-slate-500">{c.label}:</dt><dd className="truncate font-medium text-slate-800" title={text(c, r)}>{c.render ? c.render(r) : text(c, r) || "–"}</dd></React.Fragment>)}
        </dl>
      </div>); })}
  </div>;
}

const PER_ROW: { n: 1 | 2 | 3 | 4; hint: string }[] = [{ n: 1, hint: "Até 5 campos por linha no card" }, { n: 2, hint: "Até 2 campos por linha no card" }, { n: 3, hint: "1 campo por linha no card" }, { n: 4, hint: "1 campo por linha no card" }];
/** Padrão do layout: 4 cards por linha (o mesmo fallback da listagem). */
const LAYOUT_PADRAO: 1 | 2 | 3 | 4 = 4;

/**
 * Diálogo "Layout dos cards" — padrão das colunas (340): Restaurar antes do Fechar (só ícone),
 * Pronto só ícone; ESC/fora não fecham (`fecharSoPeloBotao`); rascunho até o Pronto.
 */
export function CardsLayoutPopover({ value, onChange, onRestore, open, onOpenChange, className }: {
  value: 1 | 2 | 3 | 4; onChange: (n: 1 | 2 | 3 | 4) => void; onRestore: () => void;
  open: boolean; onOpenChange: (o: boolean) => void; className?: string;
}) {
  const [draft, setDraft] = React.useState(value);
  const [aplicarPadrao, setAplicarPadrao] = React.useState(false);
  const abriu = React.useRef(false);
  React.useEffect(() => {
    if (open && !abriu.current) { setDraft(value); setAplicarPadrao(false); }
    abriu.current = open;
  }, [open, value]);
  if (!open) return null;
  const salvar = () => { if (aplicarPadrao) onRestore(); else onChange(draft); onOpenChange(false); };
  return <Dialog open onOpenChange={onOpenChange} title="Layout dos cards" size="sm"
    className={cn("b1-portal-compras b1-colunas-dlg", className)}
    bodyClassName="!p-4"
    fecharSoPeloBotao
    antesDoFechar={<button type="button" className="tb-btn tb-btn-icon tb-btn-sm" title="Restaurar padrão" aria-label="Restaurar padrão" onClick={() => { setDraft(LAYOUT_PADRAO); setAplicarPadrao(true); }}><RotateCcw className="h-4 w-4" /></button>}
    footer={<div className="b1ref flex w-full items-center justify-end gap-2">
      <button type="button" className="tb-btn tb-btn-icon" title="Pronto" aria-label="Pronto" onClick={salvar}><Check className="h-4 w-4" /></button>
    </div>}>
    <div role="radiogroup" aria-label="Cards por linha">{PER_ROW.map((o) => <RadioRow key={o.n} checked={draft === o.n} onClick={() => { setAplicarPadrao(false); setDraft(o.n); }} title={`${o.n} card${o.n > 1 ? "s" : ""} por linha`} hint={o.hint} />)}</div>
  </Dialog>;
}

/**
 * Diálogo "Campos dos cards" — até CARD_FIELDS_MAX; mesmo chrome das colunas (340):
 * Restaurar/Pronto só ícone; fecha só pelo X; rascunho até o Pronto.
 */
export function CardFieldsPopover({ columns, value, onChange, onRestore, open, onOpenChange, className }: {
  columns: Base1Column[]; value: string[]; onChange: (keys: string[]) => void; onRestore: () => void;
  open: boolean; onOpenChange: (o: boolean) => void; className?: string;
}) {
  const padrao = React.useMemo(() => columns.slice(0, CARD_FIELDS_MAX).map((c) => c.key), [columns]);
  const [draft, setDraft] = React.useState<string[]>(() => value.slice(0, CARD_FIELDS_MAX));
  const [aplicarPadrao, setAplicarPadrao] = React.useState(false);
  const abriu = React.useRef(false);
  React.useEffect(() => {
    if (open && !abriu.current) { setDraft(value.slice(0, CARD_FIELDS_MAX)); setAplicarPadrao(false); }
    abriu.current = open;
  }, [open, value]);
  if (!open) return null;
  const cheio = draft.length >= CARD_FIELDS_MAX;
  const toggle = (key: string, on: boolean) => {
    setAplicarPadrao(false);
    setDraft((d) => {
      if (on) {
        if (d.includes(key) || d.length >= CARD_FIELDS_MAX) return d;
        return [...d, key];
      }
      return d.filter((k) => k !== key);
    });
  };
  const salvar = () => { if (aplicarPadrao) onRestore(); else onChange(draft.slice(0, CARD_FIELDS_MAX)); onOpenChange(false); };
  return <Dialog open onOpenChange={onOpenChange} title="Campos dos cards" size="sm"
    className={cn("b1-portal-compras b1-colunas-dlg", className)}
    bodyClassName="!p-4"
    fecharSoPeloBotao
    antesDoFechar={<button type="button" className="tb-btn tb-btn-icon tb-btn-sm" title="Restaurar padrão" aria-label="Restaurar padrão" onClick={() => { setDraft(padrao); setAplicarPadrao(true); }}><RotateCcw className="h-4 w-4" /></button>}
    footer={<div className="b1ref flex w-full items-center justify-end gap-2">
      <button type="button" className="tb-btn tb-btn-icon" title="Pronto" aria-label="Pronto" onClick={salvar}><Check className="h-4 w-4" /></button>
    </div>}>
    <p className="mb-2 text-[11.5px] text-slate-500">{draft.length} de {CARD_FIELDS_MAX} campos{cheio ? " · máximo atingido" : ""}</p>
    <div className="max-h-72 overflow-auto">{[...columns].sort((a, b) => a.label.localeCompare(b.label, "pt-BR")).map((c) => {
      const marcado = draft.includes(c.key);
      const travado = !marcado && cheio;
      return <CheckRow key={c.key} checked={marcado} disabled={travado}
        onChange={(on) => toggle(c.key, on)} label={c.label}
        hint={travado ? "Máximo 10" : undefined} />;
    })}</div>
  </Dialog>;
}
