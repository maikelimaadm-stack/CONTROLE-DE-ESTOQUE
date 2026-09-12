"use client";
import * as React from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { COPY } from "@/lib/copy";
import { Button } from "./button";
import { Spinner } from "./spinner";

/**
 * Estados genéricos oficiais (docs/UI-STANDARD.md › Primitives visuais): carregando, vazio e erro.
 * Skeletons e mensagens funcionais específicas continuam válidos onde já existem; estes cobrem o caso genérico.
 */

export function LoadingState({ label = COPY.carregando, variant = "block", className }: { label?: string; variant?: "block" | "compact" | "inline"; className?: string }) {
  if (variant === "inline") return <span role="status" aria-live="polite" data-testid="loading-state" className={cn("inline-flex items-center gap-1.5 text-xs text-slate-500", className)}><Spinner className="h-3.5 w-3.5" />{label}</span>;
  return <div role="status" aria-live="polite" data-testid="loading-state" className={cn("flex flex-col items-center justify-center gap-2 text-sm text-slate-400", variant === "compact" ? "py-3" : "py-10", className)}><Spinner /><span>{label}</span></div>;
}

export function EmptyState({ icon, title = COPY.nenhumRegistro, description, action, compact, className }: { icon?: React.ReactNode; title?: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; compact?: boolean; className?: string }) {
  return <div data-testid="empty-state" className={cn("flex flex-col items-center justify-center gap-1.5 text-center", compact ? "py-4" : "py-10", className)}>
    {!compact && <span className="mb-1 inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-400" aria-hidden>{icon ?? <Inbox className="h-4 w-4" />}</span>}
    <p className="text-sm text-slate-400">{title}</p>
    {description && <p className="max-w-md text-xs text-slate-400">{description}</p>}
    {action && <div className="mt-2 no-print">{action}</div>}
  </div>;
}

/** Mensagem segura para o usuário: só a primeira linha da mensagem do erro (nunca stack trace), com fallback genérico. */
export function safeErrorMessage(error: unknown, fallback = COPY.erroGenerico): string {
  const raw = typeof error === "string" ? error : error && typeof error === "object" && "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  const first = raw.split("\n")[0]?.trim() ?? "";
  return first ? first.slice(0, 300) : fallback;
}

export function ErrorState({ title = COPY.erro, error, message, onRetry, retryLabel = COPY.tentarNovamente, variant = "inline", className }: { title?: string; error?: unknown; message?: string; onRetry?: () => void; retryLabel?: string; variant?: "inline" | "block"; className?: string }) {
  const text = message ?? safeErrorMessage(error);
  if (variant === "block") return <div role="alert" data-testid="error-state" className={cn("flex flex-col items-center justify-center gap-2 py-8 text-center", className)}>
    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-red-600" aria-hidden><AlertTriangle className="h-4 w-4" /></span>
    <p className="text-sm font-semibold text-slate-700">{title}</p><p className="max-w-md text-xs text-slate-500">{text}</p>
    {onRetry && <Button size="sm" variant="outline" className="mt-1" onClick={onRetry}>{retryLabel}</Button>}
  </div>;
  return <div role="alert" data-testid="error-state" className={cn("flex flex-wrap items-center gap-2 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700", className)} style={{ borderRadius: "var(--mg-radius-control)" }}>
    <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /><span className="min-w-0 flex-1"><b>{title}:</b> {text}</span>
    {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>{retryLabel}</Button>}
  </div>;
}

/** compatibility alias — usar EmptyState (migração gradual). */
export const Empty = ({ text = COPY.nenhumRegistro }: { text?: string }) => <EmptyState title={text} compact />;
/** compatibility alias — usar ErrorState (migração gradual). */
export const ErrorBox = ({ error }: { error: unknown }) => <ErrorState error={error} variant="inline" />;
