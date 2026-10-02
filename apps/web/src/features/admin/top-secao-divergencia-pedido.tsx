"use client";
/**
 * OPERACOES-01 F6a (decisão 283) — a aba "Divergência com o pedido" do editor da TOP no formato 5 (seção
 * `divergenciaPedido`, da COMPRA).
 *
 * O modo (Nenhuma — o neutro e o comportamento de hoje —, Avisar, Bloquear) e as duas tolerâncias em %, em TEXTO
 * decimal (de 0 a 100, até duas casas, ponto como separador) — nunca número de ponto flutuante: o valor digitado vai
 * como foi digitado, e quem aceita ou recusa é o domínio (o leitor estrito) e o servidor (422). Com "Nenhuma" as
 * tolerâncias não decidem nada: ficam desabilitadas e, AO ESCOLHER "Nenhuma", voltam ao "0" pela normalização do
 * próprio domínio (`SECAO_DIVERGENCIA_PEDIDO.normalizar`) — a tela mostra o que vai ser gravado, e um valor recusado
 * (um "150" digitado antes) nunca fica preso num campo desabilitado, sem como corrigir.
 *
 * A mensagem "Informe um percentual…" ao lado do campo é SÓ APRESENTAÇÃO (avisa enquanto se digita); não bloqueia nada.
 * Os erros de campo (`divergenciaPedido.<campo>`) vêm do domínio antes de enviar ou do 422 do servidor; o da seção
 * inteira (`top-erro-divergenciaPedido`) é o editor que mostra.
 */
import * as React from "react";
import { Field, Input, NativeSelect } from "@/components/ui";
import { D } from "@agro/shared";
import {
  MODOS_DIVERGENCIA_PEDIDO, ROTULOS_MODO_DIVERGENCIA_PEDIDO, SECAO_DIVERGENCIA_PEDIDO, TOLERANCIA_MAXIMA_DIVERGENCIA_PEDIDO,
  type DivergenciaPedidoTop, type ModoDivergenciaPedido
} from "@agro/domain";
import type { PropsDaSecaoV5 } from "./top-secoes-formato5";

/** A forma que o domínio aceita na tolerância: até 3 dígitos inteiros e até 2 casas, ponto como separador. */
const FORMA_PERCENTUAL = /^\d{1,3}(\.\d{1,2})?$/;

const MENSAGEM_PERCENTUAL_INVALIDO = "Informe um percentual de 0 a 100, com até duas casas decimais.";

/** O texto não vazio é um percentual aceitável? Vazio não é avisado aqui (o domínio recusa ao salvar). */
const percentualAceitavel = (texto: string): boolean =>
  texto === "" || (FORMA_PERCENTUAL.test(texto) && D(texto).lte(D(TOLERANCIA_MAXIMA_DIVERGENCIA_PEDIDO)));

type ChaveTolerancia = "toleranciaPrecoPercentual" | "toleranciaQuantidadePercentual";

function CampoTolerancia({ campo, rotulo, valor, desabilitado, erros, onChange }: {
  campo: ChaveTolerancia; rotulo: string; valor: DivergenciaPedidoTop; desabilitado: boolean;
  erros: Readonly<Record<string, string>>; onChange: (v: DivergenciaPedidoTop) => void;
}): React.ReactNode {
  const texto = valor[campo];
  const caminho = `divergenciaPedido.${campo}`;
  const erroDoServidor = erros[caminho];
  const avisoDoCliente = !desabilitado && !percentualAceitavel(texto);
  return <div className="col-span-12 md:col-span-3">
    <Field label={rotulo} span={12}>
      <Input data-testid={`top-campo-divergenciaPedido-${campo}`} inputMode="decimal" placeholder="0.00"
        value={texto} disabled={desabilitado}
        onChange={(e) => onChange({ ...valor, [campo]: e.target.value })} />
    </Field>
    {avisoDoCliente && <p data-testid={`top-aviso-${caminho}`} className="mt-0.5 text-[11.5px] text-red-700">{MENSAGEM_PERCENTUAL_INVALIDO}</p>}
    {erroDoServidor !== undefined && <p data-testid={`top-erro-${caminho}`} className="mt-0.5 text-[11.5px] text-red-700">{erroDoServidor}</p>}
  </div>;
}

export function SecaoDivergenciaPedido({ valor, erros, onChange }: PropsDaSecaoV5<"divergenciaPedido">): React.ReactNode {
  const semComparacao = valor.modo === "nenhuma";
  // Os erros de campo que não são das tolerâncias (o modo, ou um campo que o servidor apontar e esta aba não conhece):
  // nunca somem — aparecem embaixo, como no resto do editor.
  const outros = Object.entries(erros).filter(([caminho]) => caminho.startsWith("divergenciaPedido.")
    && caminho !== "divergenciaPedido.toleranciaPrecoPercentual" && caminho !== "divergenciaPedido.toleranciaQuantidadePercentual");
  return <div className="grid grid-cols-12 gap-3">
    <Field label="Divergência" span={6}>
      <NativeSelect data-testid="top-campo-divergenciaPedido-modo" value={valor.modo}
        onChange={(e) => onChange(SECAO_DIVERGENCIA_PEDIDO.normalizar({ ...valor, modo: e.target.value as ModoDivergenciaPedido }))}>
        {MODOS_DIVERGENCIA_PEDIDO.map((m) => <option key={m} value={m}>{ROTULOS_MODO_DIVERGENCIA_PEDIDO[m]}</option>)}
      </NativeSelect>
    </Field>
    <CampoTolerancia campo="toleranciaPrecoPercentual" rotulo="Tolerância de preço (%)" valor={valor}
      desabilitado={semComparacao} erros={erros} onChange={onChange} />
    <CampoTolerancia campo="toleranciaQuantidadePercentual" rotulo="Tolerância de quantidade (%)" valor={valor}
      desabilitado={semComparacao} erros={erros} onChange={onChange} />
    {outros.map(([caminho, mensagem]) =>
      <p key={caminho} data-testid={`top-erro-${caminho}`} className="col-span-12 text-[11.5px] text-red-700">{mensagem}</p>)}
  </div>;
}
