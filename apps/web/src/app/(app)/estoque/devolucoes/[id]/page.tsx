"use client";
import { use } from "react";
import { StockDocDetail } from "@/features/docs/stock-detail";
export default function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = use(params); return <StockDocDetail id={id} endpoint="/api/stock/devolutions" base="/estoque?tab=operacoes&sub=devolucoes" title="Devolução de estoque" perm="devolutions" dateKey="devolution_date" />; }
