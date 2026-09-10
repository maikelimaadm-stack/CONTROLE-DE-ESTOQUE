"use client";
import { use } from "react";
import { StockDocDetail } from "@/features/docs/stock-detail";
export default function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = use(params); return <StockDocDetail id={id} endpoint="/api/stock/requisitions" base="/estoque/requisicoes" title="Requisição do Estoque" perm="requisitions" dateKey="requisition_date" />; }
