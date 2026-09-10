"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { brl, num, dateBR } from "@/lib/utils";
import { Card, CardHeader, CardBody, Badge } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar, useFilters, monthRange, type Row } from "@/features/docs/shared";
const TYPES: Record<string, string> = { opening_balance: "Estoque inicial", entry: "Entrada/insumos", invoice_entry: "Doc. fiscal", receipt: "Recebimento", devolution: "Devolução", requisition: "Requisição", writeoff: "Baixa", correction_in: "Correção (+)", correction_out: "Correção (−)", transfer_out: "Transf. saída", transfer_in: "Transf. entrada", farm_transfer_out: "Transf. fazenda (saída)", farm_transfer_in: "Transf. fazenda (entrada)", sale: "Venda", production_in: "Produção (entrada)", production_out: "Produção (consumo)", maintenance: "Manutenção", fuel_supply: "Abastecimento", nutrition: "Nutrição/Sanitário", reversal: "Estorno" };
export default function Page() {
  const { f, set, reset } = useFilters(monthRange()); const [applied, setApplied] = React.useState<Record<string, string>>(monthRange()); const [page, setPage] = React.useState(1); const [pageSize, setPageSize] = React.useState(50);
  const q = useQuery({ queryKey: ["stock-mov", applied, page, pageSize], queryFn: () => api<{ items: Row[]; total: number; totals: { in: string; out: string } }>(`/api/stock/movements${qs({ ...applied, page, pageSize })}`) });
  return <Card><CardHeader title="Movimentação de Estoque (ledger)" subtitle="Todo lançamento é imutável; cancelamentos geram estornos." /><CardBody>
    <FilterBar filters={[{ name: "start_date", label: "Dt. Início", type: "date" }, { name: "end_date", label: "Dt. Fim", type: "date" }, { name: "product_id", label: "Produto", type: "ref", resource: "products" }, { name: "warehouse_id", label: "Armazém", type: "ref", resource: "warehouses" }, { name: "movement_type", label: "Tipo", type: "select", options: Object.entries(TYPES).map(([value, label]) => ({ value, label })) }, { name: "cost_center_id", label: "Centro de Custo", type: "ref", resource: "cost_centers" }]} f={f} set={set} reset={() => { reset(); setApplied(monthRange()); }} onApply={() => { setApplied({ ...f }); setPage(1); }} />
    <DataTable rows={q.data?.items ?? []} total={q.data?.total} page={page} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} loading={q.isLoading}
      columns={[{ key: "movement_date", label: "Data", render: (r) => dateBR(r["movement_date"] as string) }, { key: "product_name", label: "Produto" }, { key: "warehouse_name", label: "Armazém" }, { key: "movement_type", label: "Tipo", render: (r) => <Badge tone={r["direction"] === 1 ? "green" : "red"}>{TYPES[String(r["movement_type"])] ?? String(r["movement_type"])}</Badge> }, { key: "quantity", label: "Qtd.", align: "right", render: (r) => `${r["direction"] === 1 ? "+" : "−"}${num(r["quantity"] as string, 4)} ${r["unit"] ?? ""}` }, { key: "unit_cost", label: "Custo unit.", align: "right", render: (r) => brl(r["unit_cost"] as string) }, { key: "total_cost", label: "Total", align: "right", render: (r) => brl(r["total_cost"] as string) }, { key: "balance_after", label: "Saldo após", align: "right", render: (r) => num(r["balance_after"] as string, 4) }, { key: "provider_lot", label: "Lote" }, { key: "cost_center_name", label: "Centro de Custo" }, { key: "source_type", label: "Origem" }, { key: "created_by_name", label: "Usuário" }]}
      footer={q.data && <tr><td colSpan={4} className="px-2 py-1">Totais</td><td className="num">+{num(q.data.totals.in, 4)} / −{num(q.data.totals.out, 4)}</td><td colSpan={7} /></tr>} />
  </CardBody></Card>;
}
