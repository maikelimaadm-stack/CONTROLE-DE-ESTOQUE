"use client";
import * as React from "react";
import { Bookmark, LayoutGrid, ListChecks, MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { Spinner, Empty } from "@/components/ui";
import { B1Popover, IconBtn, PillBtn, RadioRow, CheckRow } from "./ui";
import type { Base1Column, Row } from "./types";

const initials = (s: string) => s.replace(/[^\p{L}\p{N} ]/gu, "").trim().slice(0, 3).toUpperCase() || "—";
const gridCls: Record<number, string> = { 1: "grid-cols-1", 2: "md:grid-cols-2", 3: "md:grid-cols-2 xl:grid-cols-3", 4: "md:grid-cols-2 xl:grid-cols-4" };

/** Cards do modelo base: avatar com iniciais, "CÓDIGO • título", linhas rótulo: valor. */
export function Base1Cards({ rows, columns, fields, perRow, loading, onOpen, selected, onSelect, actions }: { rows: Row[]; columns: Base1Column[]; fields: string[]; perRow: 1 | 2 | 3 | 4; loading?: boolean; onOpen?: (r: Row) => void; selected: Set<string>; onSelect: (id: string, on: boolean) => void; actions?: (r: Row) => { label: string; onClick: () => void; danger?: boolean }[] }) {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const text = (c: Base1Column, r: Row) => c.text ? c.text(r) : String(r[c.key] ?? "");
  const titleCol = byKey.get("name") ?? byKey.get("description") ?? byKey.get("title") ?? columns.find((c) => c.key !== "code") ?? columns[0];
  const codeCol = byKey.get("code");
  const shown = fields.map((k) => byKey.get(k)).filter((c): c is Base1Column => Boolean(c) && c !== titleCol && c !== codeCol);
  if (loading && !rows.length) return <div className="py-10 text-center"><Spinner className="mx-auto" /></div>;
  if (!rows.length) return <Empty />;
  return <div className={cn("grid grid-cols-1 gap-3", gridCls[perRow])}>
    {rows.map((r) => { const id = String(r["id"]); const t = titleCol ? text(titleCol, r) : ""; const code = codeCol ? text(codeCol, r) : ""; const acts = actions?.(r) ?? []; return (
      <div key={id} data-testid="b1-card" className={cn("group rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,.04),0_4px_14px_rgba(0,0,0,.05)] transition-shadow hover:shadow-[0_6px_20px_rgba(0,0,0,.09)]", selected.has(id) && "ring-2 ring-brand-300")} onDoubleClick={() => onOpen?.(r)}>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-[11px] font-bold text-white">{initials(t)}</span>
          <button type="button" aria-label={selected.has(id) ? "Desmarcar" : "Marcar"} onClick={() => onSelect(id, !selected.has(id))} className={cn("rounded p-0.5 text-slate-400 hover:text-brand-600", selected.has(id) && "text-brand-600")}><Bookmark className={cn("h-4 w-4", selected.has(id) && "fill-current")} /></button>
          <button type="button" className="min-w-0 flex-1 truncate text-left text-[12.5px] font-semibold text-slate-800 hover:text-brand-700" onClick={() => onOpen?.(r)}>{code && <span className="text-slate-500">{code} • </span>}{t}</button>
          {acts.length > 0 && <B1Popover className="w-44 p-1" trigger={<IconBtn size="sm" aria-label="Ações do registro" className="bg-transparent"><MoreVertical className="h-4 w-4" /></IconBtn>}>{acts.map((a) => <button key={a.label} type="button" onClick={a.onClick} className={cn("block w-full rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-slate-100", a.danger && "text-red-600")}>{a.label}</button>)}</B1Popover>}
        </div>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
          {shown.map((c) => <React.Fragment key={c.key}><dt className="truncate text-slate-500">{c.label}:</dt><dd className="truncate font-medium text-slate-800" title={text(c, r)}>{c.render ? c.render(r) : text(c, r) || "–"}</dd></React.Fragment>)}
        </dl>
      </div>); })}
  </div>;
}

const PER_ROW: { n: 1 | 2 | 3 | 4; hint: string }[] = [{ n: 1, hint: "Até 5 campos por linha no card" }, { n: 2, hint: "Até 2 campos por linha no card" }, { n: 3, hint: "1 campo por linha no card" }, { n: 4, hint: "1 campo por linha no card" }];

/** Popover "Configurar layout dos cards" (cards por linha) com Restaurar / Ok. */
export function CardsLayoutPopover({ value, onChange, onRestore }: { value: 1 | 2 | 3 | 4; onChange: (n: 1 | 2 | 3 | 4) => void; onRestore: () => void }) {
  const [open, setOpen] = React.useState(false); const [draft, setDraft] = React.useState(value);
  React.useEffect(() => { if (open) setDraft(value); }, [open, value]);
  return <B1Popover open={open} onOpenChange={setOpen} trigger={<IconBtn aria-label="Configurar layout dos cards" title="Configurar layout dos cards" active={open}><LayoutGrid className="h-4 w-4" /></IconBtn>}
    footer={<><PillBtn tone="gray" className="flex-1 justify-center" onClick={() => { onRestore(); setOpen(false); }}>Restaurar</PillBtn><PillBtn className="flex-1 justify-center" onClick={() => { onChange(draft); setOpen(false); }}>Ok</PillBtn></>}>
    <div role="radiogroup" aria-label="Cards por linha">{PER_ROW.map((o) => <RadioRow key={o.n} checked={draft === o.n} onClick={() => setDraft(o.n)} title={`${o.n} card${o.n > 1 ? "s" : ""} por linha`} hint={o.hint} />)}</div>
  </B1Popover>;
}

/** Popover "Configurar campos dos cards" (quais colunas aparecem nos cards). */
export function CardFieldsPopover({ columns, value, onChange, onRestore }: { columns: Base1Column[]; value: string[]; onChange: (keys: string[]) => void; onRestore: () => void }) {
  const [open, setOpen] = React.useState(false); const [draft, setDraft] = React.useState<string[]>(value);
  React.useEffect(() => { if (open) setDraft(value); }, [open, value]);
  return <B1Popover open={open} onOpenChange={setOpen} className="w-72" trigger={<IconBtn aria-label="Configurar campos dos cards" title="Configurar campos dos cards" active={open}><ListChecks className="h-4 w-4" /></IconBtn>}
    footer={<><PillBtn tone="gray" className="flex-1 justify-center" onClick={() => { onRestore(); setOpen(false); }}>Restaurar</PillBtn><PillBtn className="flex-1 justify-center" onClick={() => { onChange(draft); setOpen(false); }}>Ok</PillBtn></>}>
    <div className="max-h-72 overflow-auto">{[...columns].sort((a, b) => a.label.localeCompare(b.label)).map((c) => <CheckRow key={c.key} checked={draft.includes(c.key)} onChange={(on) => setDraft((d) => (on ? [...d, c.key] : d.filter((k) => k !== c.key)))} label={c.label} />)}</div>
  </B1Popover>;
}
