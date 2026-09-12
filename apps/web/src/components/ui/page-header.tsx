"use client";
import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * PageHeader oficial (docs/UI-STANDARD.md › Primitives visuais): trilha opcional, título, subtítulo, situação, ações
 * principais e secundárias e um slot inferior. Recebe tudo por props — não conhece nav.registry nem o menu; o
 * AppShell futuro poderá alimentá-lo. `inCard` é o cabeçalho de cartão (CardHeader é um alias sobre ele).
 */
export interface Crumb { label: string; href?: string }
export interface PageHeaderProps { title: React.ReactNode; subtitle?: React.ReactNode; breadcrumbs?: Crumb[]; status?: React.ReactNode; actions?: React.ReactNode; secondaryActions?: React.ReactNode; children?: React.ReactNode; inCard?: boolean; level?: 1 | 2; className?: string; testId?: string }

export function PageHeader({ title, subtitle, breadcrumbs, status, actions, secondaryActions, children, inCard, level = 1, className, testId = "page-header" }: PageHeaderProps) {
  const H = level === 1 ? "h1" : "h2";
  return <header className={cn("mg-page-header", inCard ? "mg-page-header--card" : "mg-page-header--page mg-card", className)} data-testid={testId}>
    {breadcrumbs && breadcrumbs.length > 0 && <nav aria-label="Trilha da tela" className="mg-page-header__crumbs">{breadcrumbs.map((c, i) => <React.Fragment key={`${c.label}-${i}`}>{i > 0 && <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />}{c.href ? <Link href={c.href} className="hover:underline">{c.label}</Link> : <span aria-current="page">{c.label}</span>}</React.Fragment>)}</nav>}
    <div className="mg-page-header__row">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2"><H className="mg-page-title truncate">{title}</H>{status}</div>
        {subtitle && <p className="mg-page-subtitle">{subtitle}</p>}
      </div>
      {(actions || secondaryActions) && <div className="mg-page-header__actions no-print">{secondaryActions}{actions}</div>}
    </div>
    {children && <div className="mg-page-header__extra">{children}</div>}
  </header>;
}

/** Cabeçalho de cartão = PageHeader `inCard` (mesma família visual do cabeçalho de página). */
export const CardHeader = ({ title, actions, subtitle }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) => <PageHeader inCard level={2} title={title} subtitle={subtitle} actions={actions} testId="card-header" />;
