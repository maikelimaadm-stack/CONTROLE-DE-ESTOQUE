"use client";
/**
 * OPERACOES-01 F6a (decisão 283) — a aba "Fluxo de compra" do editor da TOP no formato 5 (seção `fluxoCompra`).
 *
 * Um campo só, do PEDIDO DE COMPRA: "Exigir pedido finalizado para receber" (Não, o neutro e o comportamento de hoje;
 * Sim, o Receber só aceita o pedido finalizado). A definição — rótulo, ajuda, neutro, leitura e normalização — é do
 * domínio (`SECAO_FLUXO_COMPRA`); a aba só mostra o valor e devolve o novo. O editor mostra esta aba quando o perfil do
 * tipo a lista (`usadaPor`), entrega o valor já lido e mostra o erro da seção inteira (`top-erro-fluxoCompra`); aqui
 * ficam os erros de CAMPO (`fluxoCompra.<campo>`), do domínio antes de enviar ou do 422 do servidor.
 */
import * as React from "react";
import { Field, NativeSelect } from "@/components/ui";
import type { PropsDaSecaoV5 } from "./top-secoes-formato5";

/** Os erros de campo desta seção (`fluxoCompra.<campo>`), na ordem em que chegaram. O da seção inteira é do editor. */
const errosDosCampos = (erros: Readonly<Record<string, string>>, secao: string): [string, string][] =>
  Object.entries(erros).filter(([caminho]) => caminho.startsWith(`${secao}.`));

export function SecaoFluxoCompra({ valor, erros, onChange }: PropsDaSecaoV5<"fluxoCompra">): React.ReactNode {
  return <div className="grid grid-cols-12 gap-3">
    <Field label="Exigir pedido finalizado para receber" span={6}>
      <NativeSelect data-testid="top-campo-fluxoCompra-exigeFinalizar" value={valor.exigeFinalizar ? "true" : "false"}
        onChange={(e) => onChange({ ...valor, exigeFinalizar: e.target.value === "true" })}>
        <option value="false">Não</option>
        <option value="true">Sim</option>
      </NativeSelect>
    </Field>
    {errosDosCampos(erros, "fluxoCompra").map(([caminho, mensagem]) =>
      <p key={caminho} data-testid={`top-erro-${caminho}`} className="col-span-12 text-[11.5px] text-red-700">{mensagem}</p>)}
  </div>;
}
