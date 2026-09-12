"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { api, qs, download } from "@/lib/api";
import { brl, num, dateBR } from "@/lib/utils";
import { Card, CardBody, Button, Badge, PageHeader } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar, useFilters, type Row } from "@/features/docs/shared";

/** Saldo de estoque (antes: /estoque/saldo). `onAdjust` habilita a ação contextual "Ajustar estoque" por linha. */
export function BalancesPanel({ onAdjust }: { onAdjust?: (row: Row) => void } = {}) {
  const sp = useSearchParams();
  const { f, set, reset } = useFilters({ product_id: sp.get("product_id") ?? "", below_min: sp.get("below_min") ?? "", expiring_days: sp.get("expiring_days") ?? "" }); const [applied, setApplied] = React.useState(f);
  const [page, setPage] = React.useState(1); const [pageSize, setPageSize] = React.useState(50); const [sort, setSort] = React.useState<{ key: string; dir: "asc" | "desc" }>();
  const q = useQuery({ queryKey: ["balances", applied, page, pageSize, sort], queryFn: () => api<{ items: Row[]; total: number; totals: { quantity: string; value: string } }>(`/api/stock/balances${qs({ ...applied, page, pageSize, sort: sort?.key, dir: sort?.dir })}`) });
  return <Card className="flex min-h-0 flex-1 flex-col"><PageHeader inCard title="Saldo de Estoque" actions={<><Button size="sm" variant="outline" onClick={() => download(`/api/reports/stocks_consolidated?format=xlsx`, "estoque.xlsx")}>Exportar</Button></>} /><CardBody>
    <FilterBar filters={[{ name: "search", label: "Pesquisar por produto/lote/princípio ativo", type: "text" }, { name: "product_id", label: "Produto", type: "ref", resource: "products" }, { name: "warehouse_id", label: "Armazém", type: "ref", resource: "warehouses" }, { name: "below_min", label: "Abaixo do mínimo", type: "select", options: [{ value: "true", label: "Sim" }] }, { name: "expiring_days", label: "Vence em (dias)", type: "text" }]} f={f} set={set} reset={() => { reset(); setApplied({}); }} onApply={() => { setApplied({ ...f }); setPage(1); }} />
    <DataTable rows={q.data?.items ?? []} total={q.data?.total} page={page} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} loading={q.isLoading} sort={sort} onSort={(k) => setSort((s) => ({ key: k, dir: s?.key === k && s.dir === "asc" ? "desc" : "asc" }))}
      rowKey={(r) => `${r["warehouse_id"]}-${r["product_id"]}-${r["provider_lot"]}`}
      actions={onAdjust ? (r) => <Button size="sm" variant="ghost" onClick={() => onAdjust(r)}>Ajustar estoque</Button> : undefined}
      columns={[{ key: "product_code", label: "Código" }, { key: "product_name", label: "Produto", sortable: true, render: (r) => <span>{String(r["product_name"])}{Number(r["min_stock"]) > 0 && Number(r["quantity"]) <= Number(r["min_stock"]) && <Badge tone="amber" className="ml-1">mínimo</Badge>}</span> }, { key: "ncm_code", label: "NCM" }, { key: "warehouse_name", label: "Armazém", sortable: true, render: (r) => `${r["warehouse_initials"]}-${r["warehouse_name"]}` }, { key: "provider_lot", label: "Lote" }, { key: "expiration_date", label: "Validade", sortable: true, render: (r) => dateBR(r["expiration_date"] as string) }, { key: "quantity", label: "Quantidade total", align: "right", sortable: true, render: (r) => `${num(r["quantity"] as string, 4)} ${r["unit"] ?? ""}` }, { key: "average_cost", label: "Custo médio unitário", align: "right", render: (r) => brl(r["average_cost"] as string) }, { key: "total_value", label: "Valor total", align: "right", sortable: true, render: (r) => brl(r["total_value"] as string) }, { key: "updated_at", label: "Atualizado", render: (r) => dateBR(r["updated_at"] as string) }]}
      footer={q.data && <tr><td colSpan={6} className="px-2 py-1">Total</td><td className="num">{num(q.data.totals.quantity, 4)}</td><td /><td className="num">{brl(q.data.totals.value)}</td><td /></tr>} />
  </CardBody></Card>;
}
