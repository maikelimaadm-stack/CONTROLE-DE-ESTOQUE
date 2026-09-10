"use client";
import * as React from "react";
import * as DialogP from "@radix-ui/react-dialog";
import * as TabsP from "@radix-ui/react-tabs";
import * as DropdownP from "@radix-ui/react-dropdown-menu";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva("inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 whitespace-nowrap", {
  variants: {
    variant: { default: "bg-brand-600 text-white hover:bg-brand-700", secondary: "bg-slate-100 text-slate-800 hover:bg-slate-200", outline: "border bg-white hover:bg-slate-50", ghost: "hover:bg-slate-100", danger: "bg-red-600 text-white hover:bg-red-700", link: "text-brand-700 underline-offset-4 hover:underline" },
    size: { sm: "h-7 px-2.5 text-xs", md: "h-8 px-3 text-[13px]", lg: "h-10 px-4 text-sm", icon: "h-8 w-8" }
  }, defaultVariants: { variant: "default", size: "md" }
});
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { loading?: boolean }
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, loading, children, ...p }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={loading || p.disabled} {...p}>{loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{children}</button>
));
Button.displayName = "Button";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn("h-8 w-full rounded-md border bg-white px-2.5 text-[13px] shadow-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:bg-slate-50 read-only:bg-slate-50", className)} {...p} />
));
Input.displayName = "Input";
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn("min-h-[64px] w-full rounded-md border bg-white px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-300", className)} {...p} />
));
Textarea.displayName = "Textarea";
export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select ref={ref} className={cn("h-8 w-full rounded-md border bg-white px-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:bg-slate-50", className)} {...p}>{children}</select>
));
NativeSelect.displayName = "NativeSelect";
export function Label({ className, required, children, ...p }: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return <label className={cn("mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500", className)} {...p}>{children}{required && <span className="text-red-500"> *</span>}</label>;
}
export function Field({ label, required, error, help, children, className, span = 3 }: { label?: string; required?: boolean; error?: string; help?: string; children: React.ReactNode; className?: string; span?: number }) {
  const spans: Record<number, string> = { 1: "md:col-span-1", 2: "md:col-span-2", 3: "md:col-span-3", 4: "md:col-span-4", 5: "md:col-span-5", 6: "md:col-span-6", 7: "md:col-span-7", 8: "md:col-span-8", 9: "md:col-span-9", 10: "md:col-span-10", 11: "md:col-span-11", 12: "md:col-span-12" };
  const id = React.useId();
  // Associa o rótulo ao controle (acessibilidade e testes): injeta id no filho único sem id
  const child = React.isValidElement(children) && !(children.props as { id?: string }).id ? React.cloneElement(children as React.ReactElement<{ id?: string }>, { id }) : children;
  return <div className={cn("col-span-12", spans[span] ?? "md:col-span-3", className)}>{label && <Label required={required} title={help} htmlFor={id}>{label}</Label>}{child}{error && <p className="mt-0.5 text-[11px] text-red-600">{error}</p>}{!error && help && <p className="mt-0.5 text-[11px] text-slate-400 line-clamp-1" title={help}>{help}</p>}</div>;
}
export const Card = ({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("rounded-lg border bg-white shadow-xs", className)} {...p}>{children}</div>;
export const CardHeader = ({ title, actions, subtitle }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) => (
  <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5"><div><h2 className="text-sm font-semibold text-slate-800">{title}</h2>{subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}</div>{actions && <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div>}</div>
);
export const CardBody = ({ className, children }: { className?: string; children: React.ReactNode }) => <div className={cn("p-4", className)}>{children}</div>;
export const Badge = ({ children, tone = "slate", className }: { children: React.ReactNode; tone?: "slate" | "green" | "red" | "amber" | "blue" | "violet"; className?: string }) => {
  const t = { slate: "bg-slate-100 text-slate-700", green: "bg-green-100 text-green-800", red: "bg-red-100 text-red-800", amber: "bg-amber-100 text-amber-800", blue: "bg-blue-100 text-blue-800", violet: "bg-violet-100 text-violet-800" }[tone];
  return <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium", t, className)}>{children}</span>;
};
export function Dialog({ open, onOpenChange, title, children, footer, size = "md" }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: React.ReactNode; footer?: React.ReactNode; size?: "sm" | "md" | "lg" | "xl" }) {
  const w = { sm: "max-w-md", md: "max-w-2xl", lg: "max-w-4xl", xl: "max-w-6xl" }[size];
  return (
    <DialogP.Root open={open} onOpenChange={onOpenChange}><DialogP.Portal>
      <DialogP.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <DialogP.Content className={cn("fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[95vw] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-lg bg-white shadow-xl", w)}>
        <div className="flex items-center justify-between border-b px-4 py-2.5"><DialogP.Title className="text-sm font-semibold">{title}</DialogP.Title><DialogP.Close className="rounded p-1 hover:bg-slate-100" aria-label="Fechar"><X className="h-4 w-4" /></DialogP.Close></div>
        <DialogP.Description className="sr-only">{title}</DialogP.Description>
        <div className="p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t px-4 py-2.5">{footer}</div>}
      </DialogP.Content>
    </DialogP.Portal></DialogP.Root>
  );
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
  return (
    <DropdownP.Root><DropdownP.Trigger asChild>{trigger}</DropdownP.Trigger><DropdownP.Portal>
      <DropdownP.Content align="end" className="z-50 min-w-[160px] rounded-md border bg-white p-1 shadow-lg text-[13px]">
        {items.map((i, k) => <DropdownP.Item key={k} disabled={i.disabled} onSelect={() => { if (i.href) location.href = i.href; else i.onClick?.(); }} className={cn("cursor-pointer rounded px-2 py-1.5 outline-none data-[highlighted]:bg-slate-100 data-[disabled]:opacity-40", i.danger && "text-red-600")}>{i.label}</DropdownP.Item>)}
      </DropdownP.Content>
    </DropdownP.Portal></DropdownP.Root>
  );
}
export const Spinner = ({ className }: { className?: string }) => <Loader2 className={cn("h-5 w-5 animate-spin text-brand-600", className)} />;
export const Empty = ({ text = "Nenhum registro encontrado." }: { text?: string }) => <div className="py-10 text-center text-sm text-slate-400">{text}</div>;
export const ErrorBox = ({ error }: { error: unknown }) => <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">{(error as Error)?.message ?? "Erro"}</div>;
export const Chevron = ChevronDown;
export function Confirm({ open, onOpenChange, title, text, onConfirm, danger, loading, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; text?: string; onConfirm: () => void; danger?: boolean; loading?: boolean; children?: React.ReactNode }) {
  return <Dialog open={open} onOpenChange={onOpenChange} title={title} size="sm" footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button variant={danger ? "danger" : "default"} loading={loading} onClick={onConfirm}>Confirmar</Button></>}><p className="text-sm text-slate-600">{text}</p>{children}</Dialog>;
}
export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "green" | "red" | "slate" | "amber" }) {
  const c = { green: "text-green-700", red: "text-red-700", slate: "text-slate-800", amber: "text-amber-700" }[tone ?? "slate"];
  return <Card className="p-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className={cn("mt-1 text-xl font-semibold tabular-nums", c)}>{value}</div>{hint && <div className="text-[11px] text-slate-400">{hint}</div>}</Card>;
}
