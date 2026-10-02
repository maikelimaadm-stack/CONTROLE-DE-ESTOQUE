"use client";
import { Suspense, use } from "react";
import { EmptyState } from "@/components/ui";
import { CentralDeCompras } from "@/features/compras/central-compras";
import { varianteDeCompraPorSegmento } from "@/features/compras/variantes";

/** Central de Compras (COMPRAS-01; sobre o motor, VISUAL-UX-04): `/compras/<segmento>/new?tipo_operacao_id=…`. Segmento desconhecido não vira formulário. */
export default function Page({ params }: { params: Promise<{ especie: string }> }) {
  const { especie } = use(params);
  const variante = varianteDeCompraPorSegmento(especie);
  if (!variante) return <EmptyState title="Página não encontrada" />;
  return <Suspense><CentralDeCompras variante={variante} /></Suspense>;
}
