"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { brl, num, dateBR, monthStartISO, todayISO } from "@/lib/utils";
import { Card, CardHeader, CardBody, Stat, Badge } from "@/components/ui";
import { SimpleTable, type Row } from "@/features/docs/shared";
import { enumLabel } from "@/lib/copy";

type Page = { items: Row[]; total: number; totals?: { quantity: string; value: string } };
/**
 * Visão Geral do Estoque: compõe consultas já existentes (saldo, saldo abaixo do mínimo, vencimentos, ledger)
 * — nenhum dado é duplicado no servidor.
 */
export function StockOverview() {
  const totals = useQuery({ queryKey: ["balances", {}, 1, 1, undefined], queryFn: () => api<Page>(`/api/stock/balances${qs({ page: 1, pageSize: 1 })}`) });
  const low = useQuery({ queryKey: ["stock-ov-low"], queryFn: () => api<Page>(`/api/stock/balances${qs({ below_min: "true", page: 1, pageSize: 8 })}`) });
  const exp = useQuery({ queryKey: ["stock-ov-exp"], queryFn: () => api<Page>(`/api/stock/balances${qs({ expiring_days: 30, page: 1, pageSize: 8, sort: "expiration_date", dir: "asc" })}`) });
  const mov = useQuery({ queryKey: ["stock-ov-mov"], queryFn: () => api<{ items: Row[]; totals: { in: string; out: string } }>(`/api/stock/movements${qs({ start_date: monthStartISO(), end_date: todayISO(), page: 1, pageSize: 12 })}`) });
  const items = mov.data?.items ?? [];
  return <div className="ws-scroll space-y-3">
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Link href="/estoque?tab=saldo"><Stat label="Valor em estoque" value={totals.data ? brl(totals.data.totals?.value ?? 0) : "…"} hint={totals.data ? `${totals.data.total} saldos (produto × armazém × lote)` : undefined} tone="green" /></Link>
      <Link href="/estoque?tab=saldo&below_min=true"><Stat label="Abaixo do mínimo" value={low.data?.total ?? "…"} tone={Number(low.data?.total) ? "amber" : "slate"} /></Link>
      <Link href="/estoque?tab=saldo&expiring_days=30"><Stat label="Vencem em 30 dias" value={exp.data?.total ?? "…"} tone={Number(exp.data?.total) ? "red" : "slate"} /></Link>
      <Link href="/estoque?tab=movimentacoes"><Stat label="Movimentado no mês" value={mov.data ? `+${num(mov.data.totals.in, 2)} / −${num(mov.data.totals.out, 2)}` : "…"} hint="quantidades (entradas / saídas)" /></Link>
    </div>
    <div className="grid gap-3 lg:grid-cols-2">
      <Card><CardHeader title="Produtos abaixo do mínimo" actions={<Link className="text-xs text-brand-700 hover:underline" href="/estoque?tab=saldo&below_min=true">ver todos</Link>} /><CardBody><SimpleTable rows={low.data?.items ?? []} cols={[{ key: "product_name", label: "Produto" }, { key: "warehouse_name", label: "Armazém" }, { key: "quantity", label: "Saldo", align: "right", render: (r) => `${num(r["quantity"] as string, 2)} ${r["unit"] ?? ""}` }, { key: "min_stock", label: "Mínimo", align: "right", render: (r) => num(r["min_stock"] as string, 2) }]} /></CardBody></Card>
      <Card><CardHeader title="Itens próximos do vencimento (30 dias)" actions={<Link className="text-xs text-brand-700 hover:underline" href="/estoque?tab=saldo&expiring_days=30">ver todos</Link>} /><CardBody><SimpleTable rows={exp.data?.items ?? []} cols={[{ key: "product_name", label: "Produto" }, { key: "provider_lot", label: "Lote" }, { key: "expiration_date", label: "Validade", render: (r) => <Badge tone={String(r["expiration_date"]) < todayISO() ? "red" : "amber"}>{dateBR(r["expiration_date"] as string)}</Badge> }, { key: "quantity", label: "Saldo", align: "right", render: (r) => num(r["quantity"] as string, 2) }]} /></CardBody></Card>
    </div>
    <Card><CardHeader title="Últimas movimentações do mês" actions={<Link className="text-xs text-brand-700 hover:underline" href="/estoque?tab=movimentacoes">ver ledger completo</Link>} /><CardBody><SimpleTable rows={items} cols={[{ key: "movement_date", label: "Data", render: (r) => dateBR(r["movement_date"] as string) }, { key: "movement_type", label: "Tipo", render: (r) => <Badge tone={r["direction"] === 1 ? "green" : "red"}>{enumLabel("stock_movement_type", r["movement_type"])}</Badge> }, { key: "product_name", label: "Produto" }, { key: "warehouse_name", label: "Armazém" }, { key: "quantity", label: "Quantidade", align: "right", render: (r) => `${r["direction"] === 1 ? "+" : "−"}${num(r["quantity"] as string, 2)}` }, { key: "total_cost", label: "Valor", align: "right", render: (r) => brl(r["total_cost"] as string) }, { key: "created_by_name", label: "Usuário" }]} /></CardBody></Card>
  </div>;
}
