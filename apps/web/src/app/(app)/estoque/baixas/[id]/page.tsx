"use client";
import { use } from "react";
import { StockDocDetail } from "@/features/docs/stock-detail";
export default function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = use(params); return <StockDocDetail id={id} endpoint="/api/stock/writeoffs" base="/estoque/baixas" title="Baixa de Estoque" perm="stock_writeoffs" dateKey="writeoff_date" />; }
