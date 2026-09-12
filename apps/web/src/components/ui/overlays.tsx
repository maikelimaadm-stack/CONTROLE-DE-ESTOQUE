"use client";
import * as React from "react";
import * as DialogP from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { COPY } from "@/lib/copy";
import { Button } from "./index";

/**
 * Overlays oficiais (docs/UI-STANDARD.md › Primitives visuais), todos sobre @radix-ui/react-dialog (role=dialog,
 * foco preso e devolvido, ESC, Title/Description acessíveis): Dialog (centro), ConfirmDialog (confirmação curta)
 * e Drawer (painel lateral). Tamanhos oficiais: sm · md · lg · xl — nenhuma tela define largura própria.
 */
export type OverlaySize = "sm" | "md" | "lg" | "xl";
const DIALOG_W: Record<OverlaySize, string> = { sm: "max-w-md", md: "max-w-2xl", lg: "max-w-4xl", xl: "max-w-6xl" };
const DRAWER_W: Record<OverlaySize, string> = { sm: "w-[360px]", md: "w-[480px]", lg: "w-[640px]", xl: "w-[860px]" };

interface OverlayBase { open: boolean; onOpenChange: (open: boolean) => void; title: string; /** descrição visível sob o título (também é a descrição acessível); sem ela o título faz o papel */ description?: React.ReactNode; children?: React.ReactNode; footer?: React.ReactNode; size?: OverlaySize; /** bloqueia ESC, clique fora e o botão fechar (operação em curso / etapa crítica) */ preventClose?: boolean; hideClose?: boolean; className?: string; bodyClassName?: string; testId?: string }

/**
 * Devolve o foco a quem abriu o overlay. O Radix só refoca o seu próprio `Trigger`; aqui os overlays abrem por estado
 * (`open`), então guardamos o elemento ativo no momento da abertura e o refocamos ao fechar (a11y: foco devolvido).
 */
function useRestoreFocus() {
  const prev = React.useRef<HTMLElement | null>(null);
  const onOpenAutoFocus = React.useCallback(() => { prev.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }, []);
  const onCloseAutoFocus = React.useCallback((e: Event) => { e.preventDefault(); const el = prev.current; prev.current = null; if (el && el.isConnected) el.focus(); }, []);
  return { onOpenAutoFocus, onCloseAutoFocus };
}

function Header({ title, description, hideClose, preventClose, kind }: { title: string; description?: React.ReactNode; hideClose?: boolean; preventClose?: boolean; kind: "dialog" | "drawer" }) {
  return <div className={`mg-${kind}__header`}>
    <div className="min-w-0"><DialogP.Title className={`mg-${kind}__title`}>{title}</DialogP.Title>{description ? <DialogP.Description className={`mg-${kind}__description`}>{description}</DialogP.Description> : <DialogP.Description className="sr-only">{title}</DialogP.Description>}</div>
    {!hideClose && <DialogP.Close className="tb-btn tb-btn-icon tb-btn-sm shrink-0" aria-label={COPY.fechar} disabled={preventClose} data-testid={`${kind}-close`}><X /></DialogP.Close>}
  </div>;
}

export function Dialog({ open, onOpenChange, title, description, children, footer, size = "md", preventClose, hideClose, className, bodyClassName, testId }: OverlayBase) {
  const guard = (e: Event) => { if (preventClose) e.preventDefault(); };
  const focus = useRestoreFocus();
  return <DialogP.Root open={open} onOpenChange={(o) => { if (!o && preventClose) return; onOpenChange(o); }}><DialogP.Portal>
    <DialogP.Overlay className="mg-overlay" />
    <DialogP.Content className={cn("mg-dialog", DIALOG_W[size], className)} data-size={size} data-testid={testId ?? "dialog"} onEscapeKeyDown={guard} onPointerDownOutside={guard} onInteractOutside={guard} {...focus}>
      <Header kind="dialog" title={title} description={description} hideClose={hideClose} preventClose={preventClose} />
      <div className={cn("mg-dialog__body", bodyClassName)}>{children}</div>
      {footer && <div className="mg-dialog__footer">{footer}</div>}
    </DialogP.Content>
  </DialogP.Portal></DialogP.Root>;
}

export interface ConfirmDialogProps { open: boolean; onOpenChange: (open: boolean) => void; title: string; /** texto explicativo (alias: text) */ description?: React.ReactNode; text?: React.ReactNode; confirmLabel?: string; dismissLabel?: string; danger?: boolean; loading?: boolean; children?: React.ReactNode; onConfirm: () => void; size?: OverlaySize }
/** Confirmação curta: [Fechar] [Confirmar] por padrão; a ação recebe o objeto quando é negócio ("Excluir", "Estornar", "Cancelar documento"). Enquanto `loading`, não fecha. */
export function ConfirmDialog({ open, onOpenChange, title, description, text, confirmLabel = COPY.confirmar, dismissLabel = COPY.fechar, danger, loading, children, onConfirm, size = "sm" }: ConfirmDialogProps) {
  const desc = description ?? text;
  return <Dialog open={open} onOpenChange={onOpenChange} title={title} size={size} preventClose={loading} testId="confirm-dialog"
    footer={<><Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>{dismissLabel}</Button><Button variant={danger ? "danger" : "default"} loading={loading} onClick={onConfirm} data-testid="confirm-dialog-confirm">{confirmLabel}</Button></>}>
    {desc && <p className="text-sm text-slate-600">{desc}</p>}{children}
  </Dialog>;
}
/** compatibility alias — usar ConfirmDialog. */
export const Confirm = ConfirmDialog;

export function Drawer({ open, onOpenChange, title, description, children, footer, side = "right", size = "md", preventClose, hideClose, className, bodyClassName, testId }: OverlayBase & { side?: "right" | "left" }) {
  const guard = (e: Event) => { if (preventClose) e.preventDefault(); };
  const focus = useRestoreFocus();
  return <DialogP.Root open={open} onOpenChange={(o) => { if (!o && preventClose) return; onOpenChange(o); }}><DialogP.Portal>
    <DialogP.Overlay className="mg-overlay" />
    <DialogP.Content className={cn("mg-drawer", side === "left" ? "mg-drawer--left" : "mg-drawer--right", DRAWER_W[size], className)} data-side={side} data-size={size} data-testid={testId ?? "drawer"} onEscapeKeyDown={guard} onPointerDownOutside={guard} onInteractOutside={guard} {...focus}>
      <Header kind="drawer" title={title} description={description} hideClose={hideClose} preventClose={preventClose} />
      <div className={cn("mg-drawer__body", bodyClassName)}>{children}</div>
      {footer && <div className="mg-drawer__footer">{footer}</div>}
    </DialogP.Content>
  </DialogP.Portal></DialogP.Root>;
}
