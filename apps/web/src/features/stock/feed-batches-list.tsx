"use client";
import { useAuth } from "@/lib/auth";
import { DocList, colDate, colMoney, colQty, colStatus, colText, dateFilters } from "@/features/docs/shared";
export function FeedBatchesList() { const { can } = useAuth(); return <DocList title="Produções de ração" endpoint="/api/stock/feed-batches" base="/estoque/batidas" canCreate={can("feed_batches.create")} canCancel={can("feed_batches.delete")} filters={dateFilters} columns={[colText("code", "Código"), colDate("batch_date", "Data"), colText("formula_name", "Formulação"), colQty("quantity_produced", "Quantidade produzida", 4), colMoney("production_cost", "Custo de produção"), colStatus()]} />; }
