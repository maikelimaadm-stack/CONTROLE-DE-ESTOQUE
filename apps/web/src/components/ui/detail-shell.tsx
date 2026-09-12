"use client";
import * as React from "react";
import Link from "next/link";
import { COPY, type EnumDomain } from "@/lib/copy";
import { Button } from "./button";
import { Card, CardBody } from "./card";
import { StatusBadge } from "./status-badge";
import { PageHeader, type Crumb } from "./page-header";
import { useTabTitle } from "@/lib/workspace-tabs";

export interface DetailShellProps { title: React.ReactNode; subtitle?: React.ReactNode; /** destino do botão Voltar (alias antigo: back) */ backHref?: string; back?: string; backLabel?: string; breadcrumbs?: Crumb[]; /** valor técnico da situação (vira StatusBadge) ou um nó pronto */ status?: string | React.ReactNode; statusDomain?: EnumDomain; actions?: React.ReactNode; children: React.ReactNode; className?: string; testId?: string }
/** DetailShell oficial: Card + PageHeader (Voltar, título, situação, ações) + corpo. Só composição — não carrega dados, não conhece API nem permissões. */
export function DetailShell({ title, subtitle, backHref, back, backLabel = COPY.voltar, breadcrumbs, status, statusDomain = "status", actions, children, className, testId = "detail-shell" }: DetailShellProps) {
  useTabTitle(typeof title === "string" ? title : undefined);
  const href = backHref ?? back;
  const badge = status === null || status === undefined || status === "" ? null : typeof status === "string" ? <StatusBadge domain={statusDomain} value={status} /> : status;
  return <Card className={className} data-testid={testId}>
    <PageHeader inCard title={title} subtitle={subtitle} breadcrumbs={breadcrumbs} status={badge} secondaryActions={href ? <Link href={href}><Button variant="outline" size="sm">{backLabel}</Button></Link> : undefined} actions={actions} />
    <CardBody className="space-y-4">{children}</CardBody>
  </Card>;
}
