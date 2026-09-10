"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { DocList, colDate, colMoney, colStatus, colText, dateFilters } from "@/features/docs/shared";
function Inner() { const { can } = useAuth(); const kind = useSearchParams().get("kind") ?? "warehouse"; const farm = kind === "farm"; return <DocList key={kind} title={farm ? "Transferência de Armazém entre Fazendas" : "Transferência de Armazém"} endpoint="/api/stock/transfers" base="/estoque/transferencias" defaultFilters={{ kind }} canCreate={can(farm ? "farm_transfers.create" : "warehouse_transfers.create")} canCancel={can(farm ? "farm_transfers.delete" : "warehouse_transfers.delete")} filters={dateFilters} columns={[colText("code", "Código"), colDate("transfer_date", "Dt. Criação"), colText("origin_farm_name", "Fazenda"), colText("origin_warehouse_name", "Armazém"), colText("destination_farm_name", "Fazenda Destino"), colText("destination_warehouse_name", "Armazém Destino"), colText("item_count", "Itens"), colMoney("total_value", "Valor"), { key: "generate_financial", label: "Financeiro", render: (r) => (r["generate_financial"] ? "Sim" : "Não") }, colStatus()]} />; }
export default function Page() { return <Suspense><Inner /></Suspense>; }
