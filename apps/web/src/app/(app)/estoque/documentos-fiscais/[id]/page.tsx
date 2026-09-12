"use client";
import { use } from "react";
import { StockDocDetail } from "@/features/docs/stock-detail";
import { enumLabel } from "@/lib/copy";
export default function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = use(params); return <StockDocDetail id={id} endpoint="/api/stock/invoices" base="/estoque?tab=recebimentos&sub=fiscais" title="Documento fiscal" perm="invoices" dateKey="emission_date" extraKV={(d) => [["Frete", String(d["freight"])], ["IPI", String(d["ipi_total"])], ["Origem", enumLabel("origin", d["origin"])]]} />; }
