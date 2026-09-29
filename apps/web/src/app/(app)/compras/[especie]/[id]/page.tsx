"use client";
import { Suspense, use } from "react";
import { EmptyState } from "@/components/ui";
import { ConsultaDeCompra } from "@/features/compras/consulta-compra";
import { varianteDeCompraPorSegmento } from "@/features/compras/variantes";

/** Consulta do documento de compra (COMPRAS-01): `/compras/<segmento>/<id>`, só leitura. */
export default function Page({ params }: { params: Promise<{ especie: string; id: string }> }) {
  const { especie, id } = use(params);
  const variante = varianteDeCompraPorSegmento(especie);
  if (!variante) return <EmptyState title="Página não encontrada" />;
  return <Suspense><ConsultaDeCompra variante={variante} id={id} /></Suspense>;
}
