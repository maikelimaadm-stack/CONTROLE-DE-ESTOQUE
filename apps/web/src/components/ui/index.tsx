"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import * as TabsP from "@radix-ui/react-tabs";
import * as DropdownP from "@radix-ui/react-dropdown-menu";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { MgDatePicker } from "./mg-controls";
import { Card } from "./card";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => {
  if (p.type === "date") return <DateInput ref={ref} className={className} {...p} />;
  return <input ref={ref} className={cn("mg-input", className)} placeholder={p.placeholder ?? " "} {...p} />;
});
Input.displayName = "Input";
/** Campo de data = calendário do modelo base; mantém um <input hidden> com name/ref para react-hook-form (onChange recebe {target:{name,value}}). */
const DateInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, value, defaultValue, onChange, onBlur, name, id, disabled, readOnly, placeholder, type: _type, ...rest }, ref) => {
  const inner = React.useRef<HTMLInputElement | null>(null);
  const [local, setLocal] = React.useState(String(defaultValue ?? ""));
  const controlled = value !== undefined;
  const cur = controlled ? String(value ?? "") : local;
  // react-hook-form (register) lê o valor via ref e recebe notificações pelo onChange do input escondido
  const emit = (iso: string) => { if (!controlled) setLocal(iso); const el = inner.current; if (el) { el.value = iso; const ev = { target: el, currentTarget: el, type: "change" } as unknown as React.ChangeEvent<HTMLInputElement>; onChange?.(ev); onBlur?.(ev as unknown as React.FocusEvent<HTMLInputElement>); } };
  const setRef = (el: HTMLInputElement | null) => { inner.current = el; if (typeof ref === "function") ref(el); else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el; };
  // quando o formulário faz reset(), o input escondido recebe o valor por ref: espelha no calendário
  React.useEffect(() => { const el = inner.current; if (!el || controlled) return; const t = setInterval(() => { if (el.value !== local) setLocal(el.value); }, 250); return () => clearInterval(t); }, [controlled, local]);
  return <>
    <input ref={setRef} type="hidden" name={name} value={cur} readOnly {...(rest as object)} />
    <MgDatePicker id={id} value={cur} onChange={emit} disabled={disabled || readOnly} className={cn("mg-input", className)} placeholder={placeholder} />
  </>;
});
DateInput.displayName = "DateInput";
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn("mg-input", className)} placeholder={p.placeholder ?? " "} {...p} />
));
Textarea.displayName = "Textarea";
export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select ref={ref} className={cn("mg-input", className)} {...p}>{children}</select>
));
NativeSelect.displayName = "NativeSelect";
export function Label({ className, required, children, ...p }: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return <label className={cn("mg-label", className)} {...p}>{children}{required && <span className="text-red-500"> *</span>}</label>;
}
export function Field({ label, required, error, help, children, className, span = 3 }: { label?: string; required?: boolean; error?: string; help?: string; children: React.ReactNode; className?: string; span?: number }) {
  const spans: Record<number, string> = { 1: "md:col-span-1", 2: "md:col-span-2", 3: "md:col-span-3", 4: "md:col-span-4", 5: "md:col-span-5", 6: "md:col-span-6", 7: "md:col-span-7", 8: "md:col-span-8", 9: "md:col-span-9", 10: "md:col-span-10", 11: "md:col-span-11", 12: "md:col-span-12" };
  const id = React.useId();
  // Associa o rótulo ao controle (acessibilidade e testes): injeta id no filho único sem id
  const child = React.isValidElement(children) && !(children.props as { id?: string }).id ? React.cloneElement(children as React.ReactElement<{ id?: string }>, { id }) : children;
  // campo padrão do modelo (mg-field): rótulo flutuante detectado por CSS (:has) — mesmo visual dos cadastros declarativos
  return <div className={cn("col-span-12", spans[span] ?? "md:col-span-3", className)}>
    <div className={cn("mg-field mg-field--auto", error && "is-invalid")} title={help}>{label && <label htmlFor={id} className="mg-field__label">{label}{required && <span className="req text-red-500"> *</span>}</label>}<div className="mg-field__control">{child}</div></div>
    {error && <p className="mt-0.5 text-[11px] text-red-600">{error}</p>}
  </div>;
}
export function Tabs({ tabs, defaultValue, className }: { tabs: { value: string; label: string; content: React.ReactNode; badge?: React.ReactNode }[]; defaultValue?: string; className?: string }) {
  return (
    <TabsP.Root defaultValue={defaultValue ?? tabs[0]?.value} className={className}>
      <TabsP.List className="flex flex-wrap gap-1 border-b">{tabs.map((t) => <TabsP.Trigger key={t.value} value={t.value} className="px-3 py-1.5 text-xs font-medium text-slate-500 border-b-2 border-transparent data-[state=active]:border-brand-600 data-[state=active]:text-brand-700">{t.label}{t.badge}</TabsP.Trigger>)}</TabsP.List>
      {tabs.map((t) => <TabsP.Content key={t.value} value={t.value} className="pt-3">{t.content}</TabsP.Content>)}
    </TabsP.Root>
  );
}
export function Menu({ trigger, items }: { trigger: React.ReactNode; items: { label: string; onClick?: () => void; href?: string; danger?: boolean; disabled?: boolean }[] }) {
  const router = useRouter();
  return (
    <DropdownP.Root><DropdownP.Trigger asChild>{trigger}</DropdownP.Trigger><DropdownP.Portal>
      <DropdownP.Content align="end" className="z-50 min-w-[160px] rounded-md border bg-white p-1 shadow-lg text-[13px]">
        {items.map((i, k) => <DropdownP.Item key={k} disabled={i.disabled} onSelect={() => { if (i.href) router.push(i.href); else i.onClick?.(); }} className={cn("cursor-pointer rounded px-2 py-1.5 outline-none data-[highlighted]:bg-slate-100 data-[disabled]:opacity-40", i.danger && "text-red-600")}>{i.label}</DropdownP.Item>)}
      </DropdownP.Content>
    </DropdownP.Portal></DropdownP.Root>
  );
}
export const Chevron = ChevronDown;
export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "green" | "red" | "slate" | "amber" }) {
  const c = { green: "text-green-700", red: "text-red-700", slate: "text-slate-800", amber: "text-amber-700" }[tone ?? "slate"];
  return <Card className="p-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className={cn("mt-1 text-xl font-semibold tabular-nums", c)}>{value}</div>{hint && <div className="text-[11px] text-slate-400">{hint}</div>}</Card>;
}

/* ---- API pública dos primitives (docs/UI-STANDARD.md › Primitives visuais). Este barrel só reexporta: nenhum leaf
   importa ./index (grafo acíclico: button/card/badge/spinner → status-badge/overlays/states/page-header → detail-shell).
   Empty/ErrorBox/Confirm são compatibility aliases. ---- */
export { Button, buttonVariants, type ButtonProps } from "./button";
export { Card, CardBody } from "./card";
export { Badge } from "./badge";
export { Spinner } from "./spinner";
export { Dialog, ConfirmDialog, Confirm, Drawer, type OverlaySize, type ConfirmDialogProps } from "./overlays";
export { LoadingState, EmptyState, ErrorState, Empty, ErrorBox, safeErrorMessage } from "./states";
export { StatusBadge, statusTone, TONE_BADGE, type StatusTone, type BadgeTone, type StatusBadgeProps } from "./status-badge";
export { PageHeader, CardHeader, type PageHeaderProps, type Crumb } from "./page-header";
export { DetailShell, type DetailShellProps } from "./detail-shell";
