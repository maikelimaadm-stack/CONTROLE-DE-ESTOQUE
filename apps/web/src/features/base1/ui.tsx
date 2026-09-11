"use client";
import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { FileText, Table2, LayoutGrid, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Botão de ícone do modelo base (tb-btn-icon do MG: 28px, fundo cinza, ativo em verde). */
export const IconBtn = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; size?: "sm" | "md"; danger?: boolean }>(({ className, active, size = "md", danger, children, ...p }, ref) => (
  <button ref={ref} type="button" className={cn("tb-btn tb-btn-icon", size === "sm" && "tb-btn-sm", active && "is-active", danger && "is-danger", className)} {...p}>{children}</button>
));
IconBtn.displayName = "IconBtn";

/** Botão com texto (tb-btn-green / gray / red / outline do MG). */
export const PillBtn = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "green" | "gray" | "red" | "outline" }>(({ className, tone = "green", children, ...p }, ref) => (
  <button ref={ref} type="button" className={cn("tb-btn", { green: "tb-btn-green", gray: "tb-btn-gray", red: "tb-btn-red", outline: "tb-btn-outline" }[tone], className)} {...p}>{children}</button>
));
PillBtn.displayName = "PillBtn";

export type ViewMode = "record" | "table" | "cards";
/** Alternância Registro / Tabela / Cards (view-seg do MG). */
export function ViewSwitch({ value, onChange, recordDisabled }: { value: ViewMode; onChange: (m: ViewMode) => void; recordDisabled?: boolean }) {
  const item = (m: ViewMode, label: string, Icon: React.ComponentType<{ className?: string }>, disabled?: boolean) => (
    <button type="button" aria-label={label} title={label} aria-pressed={value === m} disabled={disabled} onClick={() => onChange(m)}><Icon /></button>
  );
  return <div className="view-seg" role="group" aria-label="Modo de visualização">{item("record", "Registro", FileText, recordDisabled)}{item("table", "Tabela", Table2)}{item("cards", "Cards", LayoutGrid)}</div>;
}

/** Popover padrão do modelo base (cartão branco arredondado com rodapé Restaurar / Ok). */
export function B1Popover({ trigger, open, onOpenChange, children, footer, className, align = "end", title }: { trigger: React.ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void; children: React.ReactNode; footer?: React.ReactNode; className?: string; align?: "start" | "center" | "end"; title?: string }) {
  return <Popover.Root open={open} onOpenChange={onOpenChange}>
    <Popover.Trigger asChild>{trigger}</Popover.Trigger>
    <Popover.Portal><Popover.Content align={align} sideOffset={6} className={cn("z-50 w-72 rounded-xl border bg-white p-3 text-[12.5px] shadow-[0_8px_24px_rgba(16,24,40,.08),0_2px_8px_rgba(16,24,40,.06)] outline-none", className)} style={{ borderColor: "var(--mg-divider)" }}>
      {title && <div className="mb-2 text-[12px] font-semibold text-slate-700">{title}</div>}
      {children}
      {footer && <div className="mt-3 flex items-center gap-2">{footer}</div>}
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}

/** Item de menu (lista vertical com ícone), estilo "Mais opções" do MG (30px, raio 8px). */
export function MenuList({ items, onPick }: { items: { key: string; label: string; icon?: React.ReactNode; danger?: boolean; disabled?: boolean }[]; onPick: (key: string) => void }) {
  return <div className="flex flex-col">{items.map((i) => <button key={i.key} type="button" role="menuitem" disabled={i.disabled} onClick={() => onPick(i.key)} className={cn("flex h-[30px] items-center gap-2 rounded-lg px-2 text-left text-[12.5px] text-slate-700 hover:bg-[var(--mg-bg-page)] disabled:opacity-40", i.danger && "text-red-600")}>{i.icon && <span className="text-[var(--mg-icon)]">{i.icon}</span>}{i.label}</button>)}</div>;
}

/** Caixa de pesquisa em pílula (mg-search do MG). */
export const RoundInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn("h-7 w-full rounded-full border border-transparent bg-[var(--mg-gray-fill)] px-3 text-[12px] placeholder:text-slate-400 focus:border-[var(--mg-focus-border)] focus:bg-white focus:outline-none", className)} {...p} />
));
RoundInput.displayName = "RoundInput";

/** Radio estilizado (círculo verde). */
export function RadioRow({ checked, onClick, title, hint }: { checked: boolean; onClick: () => void; title: string; hint?: string }) {
  return <button type="button" role="radio" aria-checked={checked} onClick={onClick} className="flex w-full items-start gap-2 rounded-md px-1 py-1.5 text-left hover:bg-slate-50">
    <span className={cn("mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", checked ? "border-[var(--mg-accent)] bg-[var(--mg-accent)]" : "border-slate-300 bg-white")}>{checked && <span className="h-1.5 w-1.5 rounded-full bg-white" />}</span>
    <span><span className="block text-[12.5px] font-medium text-slate-800">{title}</span>{hint && <span className="block text-[11px] text-slate-500">{hint}</span>}</span>
  </button>;
}
export function CheckRow({ checked, onChange, label, hint }: { checked: boolean; onChange: (c: boolean) => void; label: React.ReactNode; hint?: string }) {
  return <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 hover:bg-slate-50">
    <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span className={cn("inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-white", checked ? "border-[var(--mg-accent)] bg-[var(--mg-accent)]" : "border-slate-300 bg-white")}>{checked && <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6l3 3 5-6" /></svg>}</span>
    <span className="text-[12.5px] text-slate-800">{label}</span>{hint && <span className="ml-auto text-[11px] text-slate-400">{hint}</span>}
  </label>;
}

/** Checkbox do modelo base (emp-table-select-check do MG): círculo cinza, verde com "check" quando marcado; suporta indeterminado. */
export function MgCheck({ checked, indeterminate, onChange, disabled, className, ...p }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "checked"> & { checked: boolean; indeterminate?: boolean; onChange?: (checked: boolean) => void }) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (ref.current) ref.current.indeterminate = Boolean(indeterminate) && !checked; }, [indeterminate, checked]);
  return <span className={cn("mg-check", checked && "is-checked", indeterminate && !checked && "is-indeterminate", disabled && "is-locked", className)} onClick={(e) => e.stopPropagation()}>
    <input ref={ref} type="checkbox" className="mg-check__input" checked={checked} disabled={disabled} onChange={(e) => { e.stopPropagation(); onChange?.(e.target.checked); }} onClick={(e) => e.stopPropagation()} {...p} />
    {checked ? <Check className="mg-check__icon" strokeWidth={2.5} aria-hidden /> : indeterminate ? <span className="mg-check__dash" aria-hidden /> : null}
  </span>;
}
