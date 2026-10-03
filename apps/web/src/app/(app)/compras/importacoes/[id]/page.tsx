"use client";
import { Suspense, use } from "react";
import { useSearchParams } from "next/navigation";
import { ConferenciaDaImportacao } from "@/features/compras/importacao/conferencia";

/**
 * A CONFERÊNCIA DO XML DA NF-e IMPORTADA (OPERACOES-01 F7, decisão 284): `/compras/importacoes/<id>`. A `solicitacao_id`
 * da URL (vinda da solicitação de compra antiga) é PEDIDO: vai no corpo do "Gerar compra" e o servidor a confere.
 */
function Conferencia({ id }: { id: string }) {
  const sp = useSearchParams();
  return <ConferenciaDaImportacao id={id} solicitacaoId={sp.get("solicitacao_id") || null} />;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense><Conferencia id={id} /></Suspense>;
}
