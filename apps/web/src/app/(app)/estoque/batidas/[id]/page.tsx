"use client";
import { use } from "react";
import { StockDocDetail } from "@/features/docs/stock-detail";
export default function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = use(params); return <StockDocDetail id={id} endpoint="/api/stock/feed-batches" base="/estoque?tab=fabrica&sub=producoes" title="Batida" perm="feed_batches" dateKey="batch_date" />; }
