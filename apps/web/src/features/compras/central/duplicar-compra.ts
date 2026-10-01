"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import type { ItemRow, Row } from "@/features/docs/shared";
import { podeLancar, type EstadoTop } from "@/features/sales/tipo-operacao-select";
import { topSelecionada } from "@/features/sales/lancador-tipo-operacao";
import { copiaValePara, descartarCopia, entregarCopia, espiarCopia, montarCopia } from "@/features/central/duplicar-memoria";
import { tabKeyFor, useWorkspaceTabs } from "@/lib/workspace-tabs";
import { chaveDaCopiaDeCompra, rotaDaNovaCompra } from "./adaptador";
import type { Cabecalho, CopiaDeCompra } from "./estado";

/**
 * DUPLICAR COMPRA E PEDIDO DE COMPRA (VISUAL-UX-04, decisão 276) — sobre a entrega em memória do motor
 * (`@/features/central/duplicar-memoria`): nada na URL além da TOP, nada no armazenamento do navegador.
 *
 * ┌─ O QUE A CÓPIA LEVA E O QUE ELA NÃO LEVA ──────────────────────────────────────────────────────┐
 * │ Leva, do GET do detalhe: a MESMA TOP, fornecedor, empresa, transportadora, natureza, centro,    │
 * │ condição, forma, frete, outras despesas, desconto, observação e os itens (produto, armazém,     │
 * │ quantidade, valor unitário, desconto e desconto %).                                              │
 * │ NÃO leva: número, nota, série, data de entrada, lote, validade, origem, títulos, situação. A Data │
 * │ é a de hoje; o vencimento fica vazio (a condição, se houver, o recalcula na criação); o plano não │
 * │ viaja (é recalculado).                                                                           │
 * │ Compra gerada de pedido e documento sem TOP não se duplicam (a dica é a de `estado.ts`).         │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

const texto = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/** Os campos do cabeçalho que a cópia LEVA. */
export const CAMPOS_COPIADOS_DA_COMPRA = [
  "empresa_id", "fornecedor_id", "transportadora_id", "categoria_financeira_id", "centro_custo_id", "condicao_pagamento_id",
  "forma_pagamento_id", "frete", "outras_despesas", "desconto", "observacao"
] as const satisfies readonly (keyof Cabecalho)[];

/** Os campos que a cópia NUNCA leva (documentação executável; os testes podem conferir). */
export const CAMPOS_NAO_COPIADOS_DA_COMPRA = ["numero_nota", "serie_nota", "data_entrada", "data_vencimento"] as const satisfies readonly (keyof Cabecalho)[];

/** A TOP do detalhe: `tipo_operacao_id` ou `tipo_operacao.id`. Vazio = documento sem TOP. */
export function topDoDetalhe(d: Row): string {
  const direto = texto(d["tipo_operacao_id"]);
  if (direto) return direto;
  const t = d["tipo_operacao"];
  return typeof t === "object" && t !== null && !Array.isArray(t) ? texto((t as Record<string, unknown>)["id"]) : "";
}

/** A compra tem origem (cabeçalho ou algum item apontando para o item do pedido)? */
export function compraTemOrigem(d: Row): boolean {
  if (texto(d["origem_documento_id"])) return true;
  const itens = Array.isArray(d["itens"]) ? (d["itens"] as Row[]) : [];
  return itens.some((it) => texto(it["item_origem_id"]) !== "");
}

/**
 * Monta a cópia a partir do GET do detalhe. `null` sem TOP ou com origem (o botão já fica desabilitado; aqui é a
 * segunda trava). `hoje` entra por parâmetro para a função continuar pura.
 */
export function copiaDaCompra(d: Row, segmento: string, hoje: string, tipoOperacaoId: string = topDoDetalhe(d)): CopiaDeCompra | null {
  if (!tipoOperacaoId || compraTemOrigem(d)) return null;
  const cabecalho: Partial<Cabecalho> = { data_documento: hoje, data_vencimento: "" };
  for (const c of CAMPOS_COPIADOS_DA_COMPRA) if (d[c] !== undefined && d[c] !== null) cabecalho[c] = texto(d[c]);
  const itens = (Array.isArray(d["itens"]) ? (d["itens"] as Row[]) : []).map((it): ItemRow => {
    const linha: ItemRow = { product_id: texto(it["produto_id"]), quantity: texto(it["quantidade"]) || "1", unit_value: texto(it["valor_unitario"]) || "0" };
    if (texto(it["armazem_id"])) linha.warehouse_id = texto(it["armazem_id"]);
    if (texto(it["desconto"])) linha.discount = texto(it["desconto"]);
    if (texto(it["desconto_percentual"])) linha.discount_percent = texto(it["desconto_percentual"]);
    return linha;
  }).filter((l) => l.product_id !== "");
  return montarCopia<Partial<Cabecalho>>(segmento, tipoOperacaoId, cabecalho, itens, null);
}

/* ═════════════════════════════ Na criação: consumir a cópia ═════════════════════════════ */

export type DestinoDaCopia =
  /** Ainda não se sabe (lista de TOPs carregando, ou não há cópia). */
  | { situacao: "nenhuma" }
  /** A TOP da cópia está na lista do servidor: a criação a aplica. */
  | { situacao: "aplicar"; copia: CopiaDeCompra }
  /** A TOP da cópia não está mais disponível (inativa, excluída): a cópia é descartada e vale a mensagem de hoje do lançador. */
  | { situacao: "descartada" };

/**
 * O que a criação faz com a cópia que espera a espécie. Pura sobre o estado da lista de TOPs: TOP inativa →
 * "descartada" (o lançador mostra a mensagem de hoje, `top-indisponivel`: "O Tipo de Operação selecionado não está
 * disponível para este lançamento."); quem chama descarta a entrega.
 */
export function destinoDaCopia(copia: CopiaDeCompra | null, estado: EstadoTop, segmento: string, tipoDaUrl: string | null | undefined): DestinoDaCopia {
  if (!copia || !tipoDaUrl || !copiaValePara(copia, segmento, tipoDaUrl)) return { situacao: "nenhuma" };
  if (!podeLancar(estado)) return { situacao: "nenhuma" };
  return topSelecionada(estado, copia.tipoOperacaoId) ? { situacao: "aplicar", copia } : { situacao: "descartada" };
}

/** Hook da criação: espia a cópia; com a lista de TOPs respondida e a TOP fora dela, descarta a entrega. */
export function useCopiaNaCriacao(estado: EstadoTop, segmento: string, tipoDaUrl: string | null | undefined): DestinoDaCopia {
  const [copia] = React.useState<CopiaDeCompra | null>(() =>
    (tipoDaUrl ? espiarCopia<Partial<Cabecalho>>(chaveDaCopiaDeCompra, segmento, tipoDaUrl) : null));
  const destino = destinoDaCopia(copia, estado, segmento, tipoDaUrl);
  React.useEffect(() => { if (destino.situacao === "descartada") descartarCopia(chaveDaCopiaDeCompra, segmento); }, [destino.situacao, segmento]);
  return destino;
}

/* ═════════════════════════════ Na consulta: disparar o Duplicar ═════════════════════════════ */

/** A aba da criação da espécie (a mesma chave que `useDirtyTab` marca em `/compras/<seg>/new`). */
export const abaDaCriacaoDeCompra = (segmento: string) => tabKeyFor(`/compras/${segmento}/new`);

export interface DuplicarCompra {
  /** Clique no Duplicar: com rascunho alterado da espécie, abre a pergunta; senão entrega e navega. */
  duplicar: () => void;
  /** A pergunta "Substituir o rascunho?" (ConfirmDialog oficial, desenhado por quem chama). */
  perguntando: boolean;
  setPerguntando: (v: boolean) => void;
  /** Confirma a substituição: entrega e navega. */
  confirmar: () => void;
}

/**
 * Duplicar a partir do documento salvo. `pode` = `EstadoDaConsulta.podeDuplicar` (permissão, sem origem, com TOP).
 * Zero escrita: só a entrega em memória e a navegação para `/compras/<seg>/new?tipo_operacao_id=<id>`.
 */
export function useDuplicarCompra({ documento, segmento, pode, hoje }: { documento: Row | null | undefined; segmento: string; pode: boolean; hoje: string }): DuplicarCompra {
  const router = useRouter();
  const ws = useWorkspaceTabs();
  const [perguntando, setPerguntando] = React.useState(false);
  const confirmar = () => {
    setPerguntando(false);
    if (!pode || !documento) return;
    const copia = copiaDaCompra(documento, segmento, hoje);
    if (!copia) return;
    entregarCopia(chaveDaCopiaDeCompra, copia);
    router.push(rotaDaNovaCompra(segmento, copia.tipoOperacaoId));
  };
  const duplicar = () => {
    if (!pode || !documento) return;
    if (ws?.dirty.has(abaDaCriacaoDeCompra(segmento))) { setPerguntando(true); return; }
    confirmar();
  };
  return { duplicar, perguntando, setPerguntando, confirmar };
}
