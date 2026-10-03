"use client";
import * as React from "react";
import { D } from "@agro/shared";
import type { ItensDaOrigem } from "@/features/central/contrato";
import type { ItemRow } from "@/features/docs/shared";

/**
 * OS ITENS DERIVADOS DOS MÓDULOS (OPERACOES-01 F10, decisão 287) — a peça comum da batelada (itens da DIETA) e da
 * produção de ração (itens da FÓRMULA): o modo "da origem" do motor, a quantidade da conta do domínio travada na linha,
 * a prévia do custo pelo custo médio do local e a soma da prévia. Mora aqui, e não numa das duas Centrais, porque as
 * duas a usam igual.
 */

/** A forma decimal digitada que conta: dígitos, fração opcional com ponto (sem sinal, sem expoente). */
const FORMA_DECIMAL = /^\d+(\.\d+)?$/;

/** Um decimal positivo digitado (texto canônico); qualquer outra forma — vazio, negativo, letra — não é quantidade. */
export const quantidadePositiva = (v: string): boolean => FORMA_DECIMAL.test(v.trim()) && D(v.trim()).gt(0);

/** Itens derivados: a quantidade é o saldo da origem, travada (a dieta e a fórmula decidem; a linha não). */
export const ITENS_DERIVADOS: ItensDaOrigem = Object.freeze({ saldo: (it: ItemRow) => it.quantity, quantidadeTravada: true });

/**
 * AS LINHAS DOS ITENS DERIVADOS (batelada e produção de ração), no local do cabeçalho — refeitas a cada dieta/fórmula,
 * quantidade ou local, sem cópia: a quantidade é a da conta do domínio e o produto, o da origem.
 *
 * O unitário é a PRÉVIA do custo: o motor escreve nele o custo médio do local (a linha nasce com "0") e a pessoa pode
 * digitar outro. O que chega por `onChange` é guardado POR LOCAL × PRODUTO, só a diferença de cada linha: o motor
 * calcula a mudança sobre os itens da renderização em que ela nasceu, e duas linhas atualizadas no mesmo instante
 * (os dois saldos chegando juntos) não se sobrescrevem — cada uma só escreve a sua chave. Trocar os quilos refaz as
 * linhas e mantém o unitário; trocar o local começa de novo (o custo médio é do local). Nada disto vai no corpo.
 */
export function useItensDerivados(derivados: readonly { product_id: string; quantidade: string }[], armazem: string): { itens: ItemRow[]; onChange: (novos: ItemRow[]) => void } {
  const [unitarios, setUnitarios] = React.useState<Readonly<Record<string, string>>>({});
  const itens = React.useMemo(() => derivados.map((d): ItemRow => ({
    product_id: d.product_id, quantity: d.quantidade, unit_value: unitarios[`${armazem}|${d.product_id}`] ?? "0", generate_stock: true,
    ...(armazem ? { warehouse_id: armazem } : {})
  })), [derivados, armazem, unitarios]);
  const onChange = React.useCallback((novos: ItemRow[]) => {
    const mudou: Record<string, string> = {};
    novos.forEach((n, i) => {
      const antes = itens[i];
      if (antes && n.product_id === antes.product_id && n.unit_value !== antes.unit_value) mudou[`${armazem}|${n.product_id}`] = typeof n.unit_value === "string" ? n.unit_value : "";
    });
    if (Object.keys(mudou).length) setUnitarios((o) => ({ ...o, ...mudou }));
  }, [itens, armazem]);
  return { itens, onChange };
}

/** A prévia do custo: Σ quantidade × unitário, em decimal (o texto que não é decimal conta zero). Texto canônico. */
export function subtotalDaPrevia(itens: readonly ItemRow[]): string {
  const dec = (v: unknown) => (typeof v === "string" && FORMA_DECIMAL.test(v.trim()) ? D(v.trim()) : D(0));
  return itens.reduce((acc, it) => acc.plus(dec(it.quantity).mul(dec(it.unit_value))), D(0)).toFixed();
}
