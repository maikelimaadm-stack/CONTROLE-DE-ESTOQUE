"use client";
import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { COPY, type EnumDomain } from "@/lib/copy";
import { Button, Card, CardBody } from "./index";
import { StatusBadge } from "./status-badge";

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

export interface DetailShellProps { title: React.ReactNode; subtitle?: React.ReactNode; /** destino do botão Voltar (alias antigo: back) */ backHref?: string; back?: string; backLabel?: string; breadcrumbs?: Crumb[]; /** valor técnico da situação (vira StatusBadge) ou um nó pronto */ status?: string | React.ReactNode; statusDomain?: EnumDomain; actions?: React.ReactNode; children: React.ReactNode; className?: string; testId?: string }
/** DetailShell oficial: Card + PageHeader (Voltar, título, situação, ações) + corpo. Só composição — não carrega dados, não conhece API nem permissões. */
export function DetailShell({ title, subtitle, backHref, back, backLabel = COPY.voltar, breadcrumbs, status, statusDomain = "status", actions, children, className, testId = "detail-shell" }: DetailShellProps) {
  const href = backHref ?? back;
  const badge = status === null || status === undefined || status === "" ? null : typeof status === "string" ? <StatusBadge domain={statusDomain} value={status} /> : status;
  return <Card className={className} data-testid={testId}>
    <PageHeader inCard title={title} subtitle={subtitle} breadcrumbs={breadcrumbs} status={badge} secondaryActions={href ? <Link href={href}><Button variant="outline" size="sm">{backLabel}</Button></Link> : undefined} actions={actions} />
    <CardBody className="space-y-4">{children}</CardBody>
  </Card>;
}
