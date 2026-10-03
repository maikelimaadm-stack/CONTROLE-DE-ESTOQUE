"use client";
/**
 * OPERACOES-01 F11 (decisão 288) — a aba "Implantação" do editor da TOP no formato 5 (seção `implantacao`), só da
 * ENTRADA de estoque.
 *
 * Um campo: "Lança o saldo inicial" — Não (o neutro: a entrada é comum, como hoje) ou Sim (a confirmação grava o
 * movimento "Estoque inicial" e recusa o segundo saldo inicial do mesmo produto, local de estoque e lote). O rótulo do
 * campo é o mesmo das `linhas` da definição (`SECAO_IMPLANTACAO`), as do histórico.
 *
 * O editor mostra esta aba quando o perfil do tipo a lista (`SECAO_IMPLANTACAO.usadaPor`: só a entrada), entrega o
 * valor já lido, mostra a ajuda da definição e o erro da SEÇÃO inteira (`top-erro-implantacao`, a recusa do tipo).
 * Aqui fica o erro de CAMPO (`implantacao.saldoInicial`) logo abaixo do campo (`top-erro-implantacao-saldo-inicial`);
 * um caminho `implantacao.<x>` que não é campo nenhum aparece no fim, para a mensagem nunca sumir.
 */
import type * as React from "react";
import type { SecaoImplantacaoTop } from "@agro/domain";
import { Field, NativeSelect } from "@/components/ui";
import type { PropsDaSecaoV5 } from "./top-secoes-formato5";

/** O campo da seção: a chave (o caminho do erro é `implantacao.<chave>`) e o pedaço do testid. */
const CAMPO_SALDO_INICIAL = { chave: "saldoInicial", testid: "saldo-inicial" } as const satisfies {
  chave: keyof SecaoImplantacaoTop;
  testid: string;
};

export function AbaImplantacao({ valor, erros, onChange }: PropsDaSecaoV5<"implantacao">): React.ReactNode {
  const caminho = `implantacao.${CAMPO_SALDO_INICIAL.chave}`;
  const erro = erros[caminho];
  const outros = Object.entries(erros).filter(([c]) => c.startsWith("implantacao.") && c !== caminho);
  return <div data-testid="top-secao-implantacao" className="grid grid-cols-12 gap-3">
    <div className="col-span-12 md:col-span-6">
      <Field label="Lança o saldo inicial" span={12}>
        <NativeSelect data-testid={`top-campo-implantacao-${CAMPO_SALDO_INICIAL.testid}`} value={valor.saldoInicial ? "true" : "false"}
          onChange={(e) => onChange({ ...valor, saldoInicial: e.target.value === "true" })}>
          <option value="false">Não</option>
          <option value="true">Sim</option>
        </NativeSelect>
      </Field>
      {erro !== undefined && <p data-testid={`top-erro-implantacao-${CAMPO_SALDO_INICIAL.testid}`} role="alert" className="mt-0.5 text-[11.5px] text-red-700">{erro}</p>}
    </div>
    {outros.map(([c, mensagem]) =>
      <p key={c} data-testid={`top-erro-${c}`} role="alert" className="col-span-12 text-[11.5px] text-red-700">{mensagem}</p>)}
  </div>;
}
