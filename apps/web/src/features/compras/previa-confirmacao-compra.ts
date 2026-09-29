"use client";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";

/**
 * A PRÉVIA DA CONFIRMAÇÃO DA COMPRA — o que a confirmação faria agora, dito pelo servidor (COMPRAS-01).
 *
 * Mesmo desenho da prévia da venda (`features/sales/previa-confirmacao.ts`), com o contrato PRÓPRIO da compra
 * (`GET /api/compras/compras/:id/previa-confirmacao`, `contractVersion` 1): entrada no estoque com o custo
 * rateado por item, e contas a pagar com as parcelas. Copiado e adaptado, não parametrizado: o contrato da venda
 * fala de baixa e de receber, e mudá-lo mudaria vendas.
 *
 * A prévia é apresentação; a confirmação é a autoridade. Corpo que não é o contrato (API diferente) vira
 * "prévia indisponível" e o Confirmar continua possível — o servidor recusa de novo o que tiver de recusar.
 */
export const CONTRATO_PREVIA_CONFIRMACAO_COMPRA = 1 as const;

export interface RecusaPrevistaCompra { code: string; message: string }
export interface EntradaPrevista { item_id: string; produto: string; armazem: string | null; quantidade: string; lote: string | null; validade: string | null; valorEntrada: string; custoUnitario: string }
export interface ParcelaPrevista { numero: number; entrada: boolean; vencimento: string; valor: string }
export interface PreviaDaConfirmacaoCompra {
  contractVersion: typeof CONTRATO_PREVIA_CONFIRMACAO_COMPRA;
  podeConfirmar: boolean;
  recusas: RecusaPrevistaCompra[];
  estoque: { efeito: "entrada" | "nenhum" | null; dataEntrada: string | null; itens: EntradaPrevista[] };
  financeiro: { efeito: "pagar" | "nenhum" | null; valor: string | null; numero: string | null; parcelas: ParcelaPrevista[]; primeiroVencimento: string | null };
}

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ehTexto = (v: unknown): v is string => typeof v === "string";
const ehTextoOuNulo = (v: unknown) => v === null || ehTexto(v);
const ehEntrada = (v: unknown): v is EntradaPrevista => ehObjeto(v) && ehTexto(v.item_id) && ehTexto(v.produto) && ehTextoOuNulo(v.armazem)
  && ehTexto(v.quantidade) && ehTextoOuNulo(v.lote) && ehTextoOuNulo(v.validade) && ehTexto(v.valorEntrada) && ehTexto(v.custoUnitario);
const ehParcela = (v: unknown): v is ParcelaPrevista => ehObjeto(v) && typeof v.numero === "number" && typeof v.entrada === "boolean" && ehTexto(v.vencimento) && ehTexto(v.valor);

export const ehPreviaDaConfirmacaoCompra = (v: unknown): v is PreviaDaConfirmacaoCompra => {
  if (!ehObjeto(v) || v.contractVersion !== CONTRATO_PREVIA_CONFIRMACAO_COMPRA || typeof v.podeConfirmar !== "boolean") return false;
  if (!Array.isArray(v.recusas) || !v.recusas.every((r) => ehObjeto(r) && ehTexto(r.code) && ehTexto(r.message))) return false;
  if (v.podeConfirmar !== (v.recusas.length === 0)) return false;
  const e = v.estoque; const f = v.financeiro;
  if (!ehObjeto(e) || !(e.efeito === "entrada" || e.efeito === "nenhum" || e.efeito === null) || !ehTextoOuNulo(e.dataEntrada) || !Array.isArray(e.itens) || !e.itens.every(ehEntrada)) return false;
  if (!ehObjeto(f) || !(f.efeito === "pagar" || f.efeito === "nenhum" || f.efeito === null) || !ehTextoOuNulo(f.valor) || !ehTextoOuNulo(f.numero)
    || !Array.isArray(f.parcelas) || !f.parcelas.every(ehParcela) || !ehTextoOuNulo(f.primeiroVencimento)) return false;
  return true;
};

export type EstadoDaPreviaCompra =
  | { situacao: "carregando" }
  | { situacao: "pronta"; previa: PreviaDaConfirmacaoCompra }
  | { situacao: "indisponivel" }
  | { situacao: "erro"; mensagem: string };

/** Só pergunta com o diálogo aberto; `staleTime: 0` — o que vale é o estado de AGORA. */
export function usePreviaDaConfirmacaoCompra(id: string, ativo: boolean): EstadoDaPreviaCompra {
  const q = useQuery<unknown, ApiError>({
    queryKey: ["compras-previa-confirmacao", id],
    queryFn: () => api<unknown>(`/api/compras/compras/${id}/previa-confirmacao`),
    enabled: ativo && Boolean(id),
    retry: false,
    staleTime: 0
  });
  if (!ativo || q.isPending) return { situacao: "carregando" };
  if (q.error) return q.error.status === 404 || q.error.status >= 500 ? { situacao: "indisponivel" } : { situacao: "erro", mensagem: q.error.message };
  return ehPreviaDaConfirmacaoCompra(q.data) ? { situacao: "pronta", previa: q.data } : { situacao: "indisponivel" };
}
