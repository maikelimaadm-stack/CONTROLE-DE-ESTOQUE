"use client";
import { CentralDeDocumento, type PropsDaMoldura } from "@/features/central/moldura";
import { PREFIXO_CENTRAL_VENDAS } from "./central-vendas-adaptador";

/**
 * CENTRAL DE VENDAS — a moldura (VISUAL-UX-01; motor extraído em VISUAL-UX-04).
 *
 * A moldura é a do motor (`@/features/central/moldura`): barra, Dados principais, Itens, painel inferior, divisores e
 * Ampliar. A venda só lhe entrega o prefixo `central-vendas` dos testids — o DOM, as classes e os testids são os de
 * antes. Valor, payload e chamada de API continuam na página (`vendas/[kind]/new` e `vendas/[kind]/[id]`).
 */

export { ALTURA_PAINEL, LARGURA_DADOS, BotaoAmpliar } from "@/features/central/moldura";
export type { AbaDoPainel, ControleDaCentral, RegiaoAmpliavel } from "@/features/central/moldura";

/** As props da Central de Vendas: as da moldura, sem o prefixo (que é sempre o da venda). */
export type CentralVendasWorkspaceProps = Omit<PropsDaMoldura, "prefixoTestid">;

export function CentralVendasWorkspace(props: CentralVendasWorkspaceProps) {
  return <CentralDeDocumento prefixoTestid={PREFIXO_CENTRAL_VENDAS} {...props} />;
}
