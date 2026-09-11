"use client";
import { use } from "react";
import { StockDocDetail } from "@/features/docs/stock-detail";
export default function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = use(params); return <StockDocDetail id={id} endpoint="/api/stock/invoices" base="/estoque?tab=recebimentos&sub=fiscais" title="Documento Fiscal" perm="invoices" dateKey="emission_date" extraKV={(d) => [["Frete", String(d["freight"])], ["IPI", String(d["ipi_total"])], ["Origem", String(d["origin"])]]} />; }
