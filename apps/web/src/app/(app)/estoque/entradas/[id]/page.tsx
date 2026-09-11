"use client";
import { use } from "react";
import { StockDocDetail } from "@/features/docs/stock-detail";
export default function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = use(params); return <StockDocDetail id={id} endpoint="/api/stock/input-entries" base="/estoque?tab=entradas&sub=manuais" title="Entrada / Insumos" perm="input_entries" dateKey="entry_date" />; }
