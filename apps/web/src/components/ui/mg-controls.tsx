"use client";
import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { toast } from "sonner";
import { ChevronDown, ChevronLeft, ChevronRight, Calendar, X, Check, Info, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/* ================================================================================================
   Controles do MODELO BASE1 replicados do PROJETOMG: seletor de opções (cmd-select), calendário (mg-dp),
   avisos (erp-toast-panel) e pílula de obrigatórios (form-validation-status).
   ================================================================================================ */

export interface SelectOption { value: string; label: string; code?: string | null }

/** Painel de opções do modelo base (cmd-panel): caixa de pesquisa + lista com destaque por teclado. */
export function CmdPanel({ options, value, onPick, search, onSearch, searchable = true, loading, emptyText = "Nenhuma opção", placeholder = "Pesquisar...", autoFocus = true }: { options: SelectOption[]; value?: string | null; onPick: (o: SelectOption) => void; search: string; onSearch: (s: string) => void; searchable?: boolean; loading?: boolean; emptyText?: string; placeholder?: string; autoFocus?: boolean }) {
  const [hi, setHi] = React.useState(0);
  React.useEffect(() => { setHi(0); }, [search, options.length]);
  const listRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { const el = listRef.current?.children[hi] as HTMLElement | undefined; el?.scrollIntoView?.({ block: "nearest" }); }, [hi]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(options.length - 1, h + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    if (e.key === "Enter") { e.preventDefault(); const o = options[hi]; if (o) onPick(o); }
  };
  return <div onKeyDown={onKey}>
    {searchable && <input autoFocus={autoFocus} className="cmd-panel__search" placeholder={placeholder} value={search} onChange={(e) => onSearch(e.target.value)} aria-label="Pesquisar opção" />}
    <div ref={listRef} className="cmd-panel-options" role="listbox">
      {loading && <div className="cmd-panel__empty">Carregando…</div>}
      {!loading && options.length === 0 && <div className="cmd-panel__empty">{emptyText}</div>}
      {options.map((o, i) => <button type="button" key={o.value} role="option" aria-selected={o.value === value} className={cn("cmd-option", o.value === value && "selected", i === hi && "highlighted")} onMouseEnter={() => setHi(i)} onClick={() => onPick(o)}>{o.code && <span className="cmd-option__code">{o.code}</span>}<span className="truncate">{o.label}</span></button>)}
    </div>
  </div>;
}

/** Gatilho do seletor (cmd-display + chevron), para uso dentro de um campo `.mg-field`. */
export const CmdDisplay = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { placeholder?: string; empty?: boolean; onClear?: () => void; wrapClassName?: string }>(({ className, placeholder = "Selecione", empty, onClear, children, disabled, wrapClassName, ...p }, ref) => (
  <span className={cn("relative flex w-full min-w-0 items-center", wrapClassName)}>
    <button ref={ref} type="button" role="combobox" disabled={disabled} className={cn("cmd-display", className)} {...p}>{empty ? <span className="cmd-display-placeholder">{placeholder}</span> : children}</button>
    {!empty && onClear && !disabled && <X className="cmd-clear" aria-label="Limpar" role="button" onClick={(e) => { e.stopPropagation(); onClear(); }} />}
    <ChevronDown className="cmd-chevron" aria-hidden />
  </span>
));
CmdDisplay.displayName = "CmdDisplay";

/** Seletor de opções fixas (substitui o <select> nativo): pesquisa, teclado e painel flutuante iguais ao MG. */
export function MgSelect({ value, onChange, options, placeholder = "Selecione", disabled, allowEmpty, id, name, onOpenChange, className }: { value: string; onChange: (v: string) => void; options: SelectOption[]; placeholder?: string; disabled?: boolean; allowEmpty?: boolean; id?: string; name?: string; onOpenChange?: (o: boolean) => void; className?: string }) {
  const [open, setOpenState] = React.useState(false); const [search, setSearch] = React.useState("");
  const setOpen = (o: boolean) => { if (disabled) return; setOpenState(o); onOpenChange?.(o); if (!o) setSearch(""); };
  const cur = options.find((o) => o.value === value);
  const filtered = search ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase())) : options;
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild><CmdDisplay id={id} name={name} aria-expanded={open} disabled={disabled} empty={!cur} placeholder={placeholder} onClear={allowEmpty ? () => onChange("") : undefined} className={className}>{cur?.label}</CmdDisplay></Popover.Trigger>
    <Popover.Portal><Popover.Content align="start" sideOffset={4} className="cmd-panel z-[10000] w-[var(--radix-popover-trigger-width)] min-w-[220px] outline-none" onOpenAutoFocus={(e) => { if (options.length <= 8) e.preventDefault(); }}>
      <CmdPanel options={filtered} value={value} search={search} onSearch={setSearch} searchable={options.length > 8} autoFocus={options.length > 8} onPick={(o) => { onChange(o.value); setOpen(false); }} />
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}

/* ---------- calendário ---------- */
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MONTHS_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const pad = (n: number) => String(n).padStart(2, "0");
export const isoToBR = (iso?: string | null) => { if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return ""; return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`; };
const brToISO = (s: string) => { const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (!m) return null; const iso = `${m[3]}-${m[2]}-${m[1]}`; const d = new Date(`${iso}T00:00:00`); return Number.isNaN(d.getTime()) || d.getDate() !== Number(m[1]) ? null : iso; };
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Calendário do modelo base (mg-dp): painel 320×320 com dias circulares; título abre meses → anos. Valor ISO (AAAA-MM-DD). */
export function MgDatePicker({ value, onChange, disabled, id, name, className, onOpenChange, placeholder }: { value: string; onChange: (iso: string) => void; disabled?: boolean; id?: string; name?: string; className?: string; onOpenChange?: (o: boolean) => void; placeholder?: string }) {
  const [open, setOpenState] = React.useState(false); const [view, setView] = React.useState<"days" | "months" | "years">("days");
  const [text, setText] = React.useState(isoToBR(value));
  React.useEffect(() => { setText(isoToBR(value)); }, [value]);
  const today = new Date(); const sel = value && /^\d{4}-\d{2}-\d{2}/.test(value) ? new Date(`${value.slice(0, 10)}T00:00:00`) : null;
  const [cursor, setCursor] = React.useState<Date>(sel ?? today);
  const setOpen = (o: boolean) => { if (disabled) return; if (o) { setCursor(sel ?? today); setView("days"); } setOpenState(o); onOpenChange?.(o); };
  const y = cursor.getFullYear(), m = cursor.getMonth();
  const first = new Date(y, m, 1); const start = new Date(y, m, 1 - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const yearStart = y - 5;
  const title = view === "days" ? `${MONTHS[m]} de ${y}` : view === "months" ? String(y) : `${yearStart} – ${yearStart + 11}`;
  const nav = (dir: -1 | 1) => setCursor(view === "days" ? new Date(y, m + dir, 1) : view === "months" ? new Date(y + dir, m, 1) : new Date(y + dir * 12, m, 1));
  const pick = (d: Date) => { onChange(toISO(d)); setOpen(false); };
  const commitText = () => { if (!text) { if (value) onChange(""); return; } const iso = brToISO(text); if (iso) { if (iso !== value) onChange(iso); } else setText(isoToBR(value)); };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); commitText(); setOpen(false); return; }
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); const base = sel ?? today; const d = new Date(base); d.setDate(d.getDate() + (e.key === "ArrowUp" ? -7 : 7)); onChange(toISO(d)); }
  };
  const fmtInput = (raw: string) => { const digits = raw.replace(/\D/g, "").slice(0, 8); return digits.length > 4 ? `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}` : digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits; };
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Anchor asChild>
      <div className="relative flex w-full items-center">
        <input id={id} name={name} type="text" inputMode="numeric" className={cn("mg-dp-field", className)} value={text} placeholder={placeholder ?? " "} disabled={disabled} onChange={(e) => setText(fmtInput(e.target.value))} onBlur={commitText} onKeyDown={onKey} onClick={() => setOpen(true)} onFocus={(e) => { if (!open && e.currentTarget.matches(":focus-visible")) setOpen(true); }} autoComplete="off" />
        <span className="mg-dp-icon"><Calendar /></span>
      </div>
    </Popover.Anchor>
    <Popover.Portal><Popover.Content align="start" sideOffset={4} className="mg-dp-panel z-[10001] outline-none" onOpenAutoFocus={(e) => e.preventDefault()}>
      <div className="mg-dp-header">
        <button type="button" className="mg-dp-nav" aria-label="Anterior" onClick={() => nav(-1)}><ChevronLeft /></button>
        <button type="button" className="mg-dp-title" onClick={() => setView(view === "days" ? "months" : "years")}>{title}</button>
        <button type="button" className="mg-dp-nav" aria-label="Próximo" onClick={() => nav(1)}><ChevronRight /></button>
      </div>
      <div className="mg-dp-body"><div className="mg-dp-viewport"><div className="mg-dp-view-track" style={{ transform: `translate3d(0, -${({ days: 0, months: 1, years: 2 })[view] * 272}px, 0)` }}>
        <div className="mg-dp-view-layer mg-dp-view-layer--days">
          <div className="mg-dp-weekdays">{WEEKDAYS.map((w) => <div key={w} className="mg-dp-wd">{w}</div>)}</div>
          <div className="mg-dp-days">{cells.map((d) => { const other = d.getMonth() !== m; const isSel = sel ? toISO(d) === toISO(sel) : false; const isToday = toISO(d) === toISO(today); return <button type="button" key={toISO(d)} disabled={other} className={cn("mg-dp-day", other && "other", isToday && "today", isSel && "selected")} onClick={() => pick(d)}>{d.getDate()}</button>; })}</div>
        </div>
        <div className="mg-dp-view-layer mg-dp-view-layer--grid"><div className="mg-dp-grid">{MONTHS_SHORT.map((mm, i) => <button type="button" key={mm} className={cn("mg-dp-pick", i === m && "selected")} onClick={() => { setCursor(new Date(y, i, 1)); setView("days"); }}>{mm}</button>)}</div></div>
        <div className="mg-dp-view-layer mg-dp-view-layer--grid"><div className="mg-dp-grid">{Array.from({ length: 12 }, (_, i) => yearStart + i).map((yy) => <button type="button" key={yy} className={cn("mg-dp-pick", yy === y && "selected")} onClick={() => { setCursor(new Date(yy, m, 1)); setView("months"); }}>{yy}</button>)}</div></div>
      </div></div></div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}

/* ---------- avisos ---------- */
type ToastKind = "success" | "error" | "warning" | "info";
const TOAST_META: Record<ToastKind, { title: string; Icon: React.ComponentType<{ className?: string }>; ms: number }> = { success: { title: "Sucesso!", Icon: Check, ms: 3000 }, info: { title: "Informação", Icon: Info, ms: 4000 }, warning: { title: "Atenção", Icon: AlertTriangle, ms: 5000 }, error: { title: "Erro", Icon: X, ms: 6000 } };
export const REQUIRED_FIELDS_MESSAGE = "Existem campos obrigatórios que precisam ser preenchidos.";

/** Aviso no canto superior direito no visual do MG (erp-toast-panel): selo colorido, título fixo por tipo, descrição. */
export function notify(kind: ToastKind, message?: string, opts?: { title?: string; duration?: number }) {
  const meta = TOAST_META[kind];
  return toast.custom((id) => (
    <div className={`erp-toast-panel erp-toast-panel--${kind}`} role="status">
      <div className={`erp-toast-panel__icon-badge erp-toast-panel__icon-badge--${kind}`}><meta.Icon /></div>
      <div className="min-w-0"><p className="erp-toast-panel__message">{opts?.title ?? meta.title}</p>{message && <p className="erp-toast-panel__description">{message}</p>}</div>
      <button type="button" className="erp-toast-panel__close" aria-label="Fechar aviso" onClick={() => toast.dismiss(id)}><X /></button>
    </div>
  ), { duration: opts?.duration ?? meta.ms });
}

/** Pílula "n/N Obrigatórios" com a lista de pendentes na dica. */
export function RequiredPill({ filled, total, pending }: { filled: number; total: number; pending: string[] }) {
  if (!total) return null;
  const isPending = filled < total;
  return <span className={cn("erp-info-pill", isPending && "is-pending")} title={isPending ? `Campos pendentes:\n${pending.map((p) => `• ${p}`).join("\n")}` : "Todos os campos obrigatórios preenchidos"}>
    <span className="erp-info-pill__dot-wrap">{isPending && <span className="erp-info-pill__dot-ring" />}<span className="erp-info-pill__dot" /></span>
    <span>{filled}/{total} Obrigatórios</span>
  </span>;
}
