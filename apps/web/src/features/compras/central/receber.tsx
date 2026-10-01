"use client";
import * as React from "react";
import type { ColunaDoLayout } from "@agro/domain";
import { ItensDaCentral as ItensDoMotor, type ItensDaOrigem, type LayoutDosItens, type LoteDosItens } from "@/features/central/itens";
import type { ColunasDosItens } from "@/features/central/contrato";
import type { ColunaDoEditorDeItens, ItemRow } from "@/features/docs/shared";
import { PREFIXO_CENTRAL_COMPRAS, colunasDosItensDeCompras } from "./adaptador";
import type { EstadoDaCriacao } from "./estado";

/**
 * CENTRAL DE COMPRAS EM MODO RECEBER PEDIDO, SOBRE O MOTOR (VISUAL-UX-04, decisão 276; regra da COMPRAS-02).
 *
 * Só desenha os itens do recebimento: as linhas vêm de `linhasDoRecebimento` (só itens com saldo, montadas pelo
 * estado), a grade do motor em modo "da origem" mostra a coluna "Saldo do pedido", trava o produto, não oferece
 * Adicionar produto nem Duplicar item, limita a quantidade ao saldo (travada fora de "em partes") e o desconto
 * acompanha a quantidade na proporção do pedido (`acompanharDescontoDaOrigem`, no `setItens` do estado). Remover
 * item segue a regra de hoje: disponível em "em partes"; no recebimento inteiro a linha não sai. O POST é o
 * `/convert` do estado, com as MESMAS chaves; nada aqui chama a API.
 */

/** Chave sintética do catálogo para a coluna de saldo: dá o rótulo "Saldo do pedido" pelo layout do motor. */
const CAMPO_DO_SALDO = "saldo_do_pedido";
export const ROTULO_DO_SALDO_DO_PEDIDO = "Saldo do pedido";

/** Coluna do editor de hoje → chave do catálogo de compras. */
const CATALOGO_DA_COLUNA: Partial<Record<ColunaDoEditorDeItens, string>> = {
  warehouse: "armazem_id", product: "produto_id", quantity: "quantidade", unit_value: "valor_unitario",
  discount: "desconto", discount_percent: "desconto_percentual", lot: "lote", expiration: "validade"
};

/** `itens.0.lote` / `itens[0].lote` → `items[0].lote` (o caminho que o motor lê). */
function caminhoDoMotor(caminho: string): string | null {
  const m = /^(?:itens|items)(?:\.(\d+)|\[(\d+)\])\.(.+)$/.exec(caminho);
  if (!m) return null;
  return `items[${m[1] ?? m[2]}].${m[3]}`;
}

/** As colunas da compra mais a do saldo do pedido (logo antes da quantidade). */
export function colunasDoRecebimento(colunasDaCompra: ColunasDosItens): ColunasDosItens {
  return { ...colunasDaCompra, doCatalogo: { ...colunasDaCompra.doCatalogo, [CAMPO_DO_SALDO]: "saldo" } };
}

/** Insere "Saldo do pedido" antes da quantidade (ou no fim, antes do total). */
export function layoutDoRecebimento(lista: readonly ColunaDoLayout[]): LayoutDosItens {
  const semSaldo = lista.filter((c) => c.campo !== CAMPO_DO_SALDO);
  const saldo: ColunaDoLayout = { campo: CAMPO_DO_SALDO, obrigatorio: false, rotulo: ROTULO_DO_SALDO_DO_PEDIDO };
  const i = semSaldo.findIndex((c) => c.campo === "quantidade");
  const comSaldo = i >= 0 ? [...semSaldo.slice(0, i), saldo, ...semSaldo.slice(i)] : [...semSaldo, saldo];
  return { colunas: comSaldo.some((c) => c.campo === "total") ? comSaldo : [...comSaldo, { campo: "total", obrigatorio: false }] };
}

/** testid da linha do recebimento (o de hoje). */
export const testIdDaLinhaDoRecebimento = (it: ItemRow) => `compras-receber-item-${String(it["item_origem_id"] ?? "")}`;

/** O modo "da origem" do motor para o recebimento: saldo do item, quantidade travada sem "em partes". */
export function origemDoRecebimento(emPartes: boolean): ItensDaOrigem {
  return { saldo: (it) => String(it["saldo"] ?? "0"), quantidadeTravada: !emPartes, testIdDaLinha: testIdDaLinhaDoRecebimento };
}

/** Os itens do recebimento. Fora do modo receber (ou sem o pedido pronto), nada. */
export function ItensDoRecebimento({ estado }: { estado: EstadoDaCriacao }) {
  const { variante, ehCompra, modo, recebendo, itens, setItens, colunasDoLayout, fieldsDosItens, errosDeItens, lote, emPartes } = estado;
  const colunas = React.useMemo(() => colunasDoRecebimento(colunasDosItensDeCompras(variante)), [variante]);

  const layout = React.useMemo<LayoutDosItens>(() => {
    const lista: ColunaDoLayout[] = colunasDoLayout
      ? colunasDoLayout.map((c) => ({ campo: c.chave, obrigatorio: c.obrigatorio, ...(c.rotulo ? { rotulo: c.rotulo } : {}) }))
      : fieldsDosItens.flatMap((f) => { const campo = CATALOGO_DA_COLUNA[f]; return campo ? [{ campo, obrigatorio: false }] : []; });
    return layoutDoRecebimento(ehCompra ? lista : lista.filter((c) => c.campo !== "lote" && c.campo !== "validade"));
  }, [colunasDoLayout, fieldsDosItens, ehCompra]);

  const erros = React.useMemo(() => {
    const r: Record<string, string> = {};
    for (const [c, m] of errosDeItens) { const k = caminhoDoMotor(c); if (k) r[k] = m; }
    return r;
  }, [errosDeItens]);

  const controleDeLote = React.useMemo<LoteDosItens | null>(
    () => (ehCompra ? { daLinha: (it: ItemRow) => lote.daLinha(it.product_id) } : null), [ehCompra, lote]);
  const daOrigem = React.useMemo(() => origemDoRecebimento(emPartes), [emPartes]);

  if (modo !== "receber" || !recebendo) return null;
  return <div data-testid="compras-itens" data-modo="receber" data-em-partes={String(emPartes)}>
    <ItensDoMotor prefixoTestid={PREFIXO_CENTRAL_COMPRAS} colunas={colunas} items={itens} onChange={setItens} layout={layout}
      erros={erros} armazemPadrao={null} armazemPorItem lote={controleDeLote} daOrigem={daOrigem} />
  </div>;
}
