"use client";
import { use } from "react";
import { StockDocDetail } from "@/features/docs/stock-detail";
export default function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = use(params); return <StockDocDetail id={id} endpoint="/api/stock/transfers" base="/estoque?tab=transferencias" title="Transferência" perm="warehouse_transfers" dateKey="transfer_date" extraKV={(d) => [["Origem", `${d["origin_farm_name"]} / ${d["origin_warehouse_name"]}`], ["Destino", `${d["destination_farm_name"]} / ${d["destination_warehouse_name"]}`]]} />; }
