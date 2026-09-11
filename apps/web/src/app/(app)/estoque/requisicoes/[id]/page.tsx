"use client";
import { use } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui";
import { StockDocDetail } from "@/features/docs/stock-detail";
/** Detalhe da requisição; "Devolver itens" abre a devolução já preenchida com os itens desta saída (ação contextual). */
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const { can } = useAuth();
  return <StockDocDetail id={id} endpoint="/api/stock/requisitions" base="/estoque?tab=saidas&sub=requisicoes" title="Requisição do Estoque" perm="requisitions" dateKey="requisition_date"
    extraActions={(d) => d["status"] === "confirmed" && can("devolutions.create") ? <Link href={`/estoque/devolucoes/new?requisition_id=${id}`}><Button size="sm" variant="outline">Devolver itens</Button></Link> : null} />;
}
