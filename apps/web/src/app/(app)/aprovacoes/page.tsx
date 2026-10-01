"use client";
import { Suspense } from "react";
import { Workspace, tab } from "@/components/workspace";
import { FilaDeAprovacao } from "@/features/aprovacoes/fila-de-aprovacao";

/**
 * APROVAÇÕES (TOP-CONFIG-08, decisão 277): uma aba por área — Vendas, Compras e Estoque —, cada uma com a sua
 * capacidade Aprovar. Rótulo e permissão de cada aba saem do `nav.registry.mjs` (`tab()`), a fonte única: quem não
 * aprova numa área não vê a aba, e quem não aprova em nenhuma não vê o módulo. Quem nega, de fato, é a rota.
 * O título é o mesmo literal do registry, como nas outras telas `Workspace`.
 */
function Inner() {
  return <Workspace title="Aprovações" tabs={[
    tab("aprovacoes.vendas", <FilaDeAprovacao area="vendas" />),
    tab("aprovacoes.compras", <FilaDeAprovacao area="compras" />),
    tab("aprovacoes.estoque", <FilaDeAprovacao area="estoque" />)
  ]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
