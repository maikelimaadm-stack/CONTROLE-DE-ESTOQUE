"use client";
import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { FileText, Table2, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";

/** Botão de ícone redondo da barra do modelo base (fundo cinza claro, ativo em verde). */
export const IconBtn = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; size?: "sm" | "md" }>(({ className, active, size = "md", children, ...p }, ref) => (
  <button ref={ref} type="button" className={cn("inline-flex shrink-0 items-center justify-center rounded-full border border-transparent text-slate-600 transition-colors hover:bg-slate-200/70 disabled:opacity-40 disabled:hover:bg-transparent", size === "md" ? "h-8 w-8" : "h-7 w-7", active ? "bg-brand-100 text-brand-700" : "bg-slate-100", className)} {...p}>{children}</button>
));
IconBtn.displayName = "IconBtn";

/** Botão verde "pílula" (Novo / Aplicar / Ok). */
export const PillBtn = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "green" | "gray" | "red" | "outline" }>(({ className, tone = "green", children, ...p }, ref) => (
  <button ref={ref} type="button" className={cn("inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[12.5px] font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none", tone === "green" && "bg-brand-500 text-white hover:bg-brand-600 shadow-sm", tone === "gray" && "bg-slate-100 text-slate-700 hover:bg-slate-200", tone === "red" && "bg-red-50 text-red-600 hover:bg-red-100", tone === "outline" && "border bg-white text-slate-700 hover:bg-slate-50", className)} {...p}>{children}</button>
));
PillBtn.displayName = "PillBtn";

export type ViewMode = "record" | "table" | "cards";
/** Alternância Registro / Tabela / Cards (segmentada, como no sistema de referência). */
export function ViewSwitch({ value, onChange, recordDisabled }: { value: ViewMode; onChange: (m: ViewMode) => void; recordDisabled?: boolean }) {
  const item = (m: ViewMode, label: string, Icon: React.ComponentType<{ className?: string }>, disabled?: boolean) => (
    <button type="button" aria-label={label} title={label} aria-pressed={value === m} disabled={disabled} onClick={() => onChange(m)} className={cn("inline-flex h-7 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-40", value === m ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-800")}><Icon className="h-4 w-4" /></button>
  );
  return <div className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 p-0.5" role="group" aria-label="Modo de visualização">{item("record", "Registro", FileText, recordDisabled)}{item("table", "Tabela", Table2)}{item("cards", "Cards", LayoutGrid)}</div>;
}

/** Popover padrão do modelo base (cartão branco arredondado com rodapé Restaurar / Ok). */
export function B1Popover({ trigger, open, onOpenChange, children, footer, className, align = "end", title }: { trigger: React.ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void; children: React.ReactNode; footer?: React.ReactNode; className?: string; align?: "start" | "center" | "end"; title?: string }) {
  return <Popover.Root open={open} onOpenChange={onOpenChange}>
    <Popover.Trigger asChild>{trigger}</Popover.Trigger>
    <Popover.Portal><Popover.Content align={align} sideOffset={6} className={cn("z-50 w-72 rounded-xl border bg-white p-3 text-[12.5px] shadow-xl outline-none", className)}>
      {title && <div className="mb-2 text-[12px] font-semibold text-slate-700">{title}</div>}
      {children}
      {footer && <div className="mt-3 flex items-center gap-2">{footer}</div>}
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}

/** Item de menu (lista vertical com ícone), estilo "Mais opções". */
export function MenuList({ items, onPick }: { items: { key: string; label: string; icon?: React.ReactNode; danger?: boolean; disabled?: boolean }[]; onPick: (key: string) => void }) {
  return <div className="flex flex-col">{items.map((i) => <button key={i.key} type="button" role="menuitem" disabled={i.disabled} onClick={() => onPick(i.key)} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-slate-100 disabled:opacity-40", i.danger && "text-red-600")}>{i.icon && <span className="text-slate-500">{i.icon}</span>}{i.label}</button>)}</div>;
}

/** Caixa de pesquisa arredondada. */
export const RoundInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn("h-8 w-full rounded-full border bg-slate-50 px-3 text-[12.5px] placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-300", className)} {...p} />
));
RoundInput.displayName = "RoundInput";

/** Radio estilizado (círculo verde). */
export function RadioRow({ checked, onClick, title, hint }: { checked: boolean; onClick: () => void; title: string; hint?: string }) {
  return <button type="button" role="radio" aria-checked={checked} onClick={onClick} className="flex w-full items-start gap-2 rounded-md px-1 py-1.5 text-left hover:bg-slate-50">
    <span className={cn("mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", checked ? "border-brand-500 bg-brand-500" : "border-slate-300 bg-white")}>{checked && <span className="h-1.5 w-1.5 rounded-full bg-white" />}</span>
    <span><span className="block text-[12.5px] font-medium text-slate-800">{title}</span>{hint && <span className="block text-[11px] text-slate-500">{hint}</span>}</span>
  </button>;
}
export function CheckRow({ checked, onChange, label, hint }: { checked: boolean; onChange: (c: boolean) => void; label: React.ReactNode; hint?: string }) {
  return <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 hover:bg-slate-50">
    <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span className={cn("inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-white", checked ? "border-brand-500 bg-brand-500" : "border-slate-300 bg-white")}>{checked && <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6l3 3 5-6" /></svg>}</span>
    <span className="text-[12.5px] text-slate-800">{label}</span>{hint && <span className="ml-auto text-[11px] text-slate-400">{hint}</span>}
  </label>;
}
