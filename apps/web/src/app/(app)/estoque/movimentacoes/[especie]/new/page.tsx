"use client";
import { Suspense, use } from "react";
import { EmptyState } from "@/components/ui";
import { CentralEstoque } from "@/features/estoque/central-estoque";
import { varianteDeEstoquePorSegmento } from "@/features/estoque/movimentacoes-variantes";

/** Central de Estoque em modo criação (ESTOQUE-01): `/estoque/movimentacoes/<segmento>/new?tipo_operacao_id=…`. Segmento desconhecido não vira formulário. */
export default function Page({ params }: { params: Promise<{ especie: string }> }) {
  const { especie } = use(params);
  const variante = varianteDeEstoquePorSegmento(especie);
  if (!variante) return <EmptyState title="Página não encontrada" />;
  return <Suspense><CentralEstoque variante={variante} /></Suspense>;
}
