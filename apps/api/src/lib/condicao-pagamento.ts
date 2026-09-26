/**
 * Regras da CONDIÇÃO DE PAGAMENTO (erp.condicoes_pagamento) — VENDAS-A4. Chamadas pelo `createOne`/`updateOne`
 * genérico ANTES de qualquer gravação, dentro da mesma transação.
 *
 *  · a conta é ÚNICA e mora no domínio: `normalizarCondicaoPagamento` e `validarCondicaoPagamento`;
 *  · valida o objeto que a linha TERÁ: padrões do banco ← linha atual (PUT) ← corpo;
 *  · o campo que a regra esconde (dia_vencimento fora de "dia_fixo"; entrada_percentual sem entrada) é gravado
 *    null — inclusive quando só o modo/entrada mudou e o corpo não mandou o campo escondido;
 *  · erro → 422 no campo (`details: [{ path, message }]`), antes do banco. Os CHECKs da 0031 são a rede.
 * Código (sequencial) e nome duplicado seguem as recusas genéricas do motor de cadastros.
 */
import { normalizarCondicaoPagamento, validarCondicaoPagamento, type CondicaoPagamento } from "@agro/domain";
import { validation } from "./errors.js";

type Linha = Record<string, unknown>;

/** Os defaults da 0031 (a linha nova sem o campo recebe estes valores do banco). */
const PADROES: CondicaoPagamento = { parcelas: 1, dias_primeira_parcela: 0, modo: "intervalo", intervalo_dias: 30, dia_vencimento: null, entrada: false, entrada_percentual: null };
const CAMPOS = Object.keys(PADROES) as (keyof CondicaoPagamento)[];
const ESCONDIDOS = ["dia_vencimento", "entrada_percentual"] as const;

export function conferirCondicaoPagamento(data: Linha, atual: Linha | null): void {
  const resultante = { ...PADROES } as Record<keyof CondicaoPagamento, unknown>;
  for (const c of CAMPOS) {
    if (c in data) resultante[c] = data[c] ?? null;
    else if (atual && c in atual) resultante[c] = atual[c] ?? null;
  }
  const normalizada = normalizarCondicaoPagamento(resultante as unknown as CondicaoPagamento);
  const erros = validarCondicaoPagamento(normalizada);
  if (erros.length) throw validation(erros.map((e) => e.mensagem).join(" "), erros.map((e) => ({ path: e.caminho, message: e.mensagem })));
  // o escondido que a linha teria com valor vira null na gravação
  for (const c of ESCONDIDOS) if (normalizada[c] === null && resultante[c] !== null) data[c] = null;
}
