"use client";
import * as React from "react";
import { Field, NativeSelect } from "@/components/ui";
import {
  ROTULOS_SEM_CLASSIFICACAO_TOP, SEM_CLASSIFICACAO_TOP, perfilDosPadroesFinanceiros, regraDeProvisaoDaFamilia,
  type MomentoDaProvisao, type RegraDeProvisao, type SemClassificacaoTop
} from "@agro/domain";
import type { PropsDaSecaoV5 } from "./top-secoes-formato5";

/**
 * A ABA "PADRÕES FINANCEIROS" DO FORMATO 5 — A SEÇÃO DO JSON (OPERACOES-01 F9, decisão 286).
 *
 * ┌─ O QUE ESTA ABA EDITA, E O QUE ELA NÃO EDITA ──────────────────────────────────────────────────────┐
 * │ Só as REGRAS da seção `financeiroPadrao` (`tipo-operacao-secao-financeiro-padrao.ts`, no domínio):  │
 * │ a provisão, se o documento troca os padrões e o que fazer sem natureza e centro. Os PADRÕES em si   │
 * │ (natureza, centro, tipo de título, forma e conta) moram na tabela da versão e são outro componente  │
 * │ (`top-padroes-financeiros.tsx`), que o editor põe embaixo desta aba quando o servidor os grava.     │
 * │                                                                                                      │
 * │ O QUE APARECE É O QUE A FAMÍLIA USA, pelo perfil do domínio (`perfilDosPadroesFinanceiros`): a      │
 * │ provisão só onde ela é executada (o pedido de venda e o pedido de compra — F9b), com o rótulo e a    │
 * │ ajuda pela REGRA da família (a direção e o momento); "Sem natureza e centro" só onde o documento     │
 * │ pode chegar sem eles e hoje recai na 1ª por código (a venda, o pedido de venda, a solicitação) — e,  │
 * │ no pedido de venda, que só gera título pela provisão, só com a provisão marcada. Na compra e no      │
 * │ pedido de compra ela NÃO vale: a compra não tem padrão legado (sem o par, a recusa de hoje). "O      │
 * │ documento pode trocar os padrões" só onde o documento informa algum deles (a solicitação não informa │
 * │ nenhum). Um valor gravado fora do neutro continua VISÍVEL para poder ser desligado: esconder seria   │
 * │ deixá-lo ir na gravação sem ninguém ver. Quem decide continua sendo o servidor (422 no campo).       │
 * │                                                                                                      │
 * │ TUDO NASCE DESLIGADO (decisão 281, item 4 da 240): o neutro é o comportamento de hoje — sem          │
 * │ provisão, o documento decide (sem natureza e centro, cada família faz o que faz hoje).               │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/**
 * A ajuda da caixa da provisão pelo MOMENTO da regra da família (nunca por um literal de família): o pedido de venda
 * provisiona ao salvar; o de compra, ao finalizar (OPERACOES-01 F9b). O texto da venda é o de antes, idêntico.
 */
const AJUDA_DA_PROVISAO: Readonly<Record<MomentoDaProvisao, string>> = Object.freeze({
  ao_salvar_o_pedido: "O pedido gera títulos previstos, fora das baixas. A venda os troca pelos títulos de verdade; encerrar o saldo ou cancelar o pedido os cancela.",
  ao_finalizar_o_pedido: "O pedido finalizado gera títulos previstos a pagar, fora das baixas. A compra confirmada os troca pelos títulos de verdade; encerrar o saldo ou cancelar o pedido os cancela."
});
const ROTULO_DOCUMENTO_TROCA = "O documento pode trocar os padrões";
const AJUDA_DOCUMENTO_TROCA =
  "Desmarcado, o documento não pode informar natureza, centro de resultado, tipo de título, forma de pagamento ou conta diferentes dos padrões desta operação. Deixar o campo vazio no documento usa o padrão.";
const ROTULO_SEM_CLASSIFICACAO = "Sem natureza e centro";
const AJUDA_SEM_CLASSIFICACAO = "O que vale quando nem o documento nem os padrões desta operação dizem a natureza e o centro de resultado.";

/** O rótulo da caixa da provisão pela REGRA da família (a direção e o momento), nunca por um literal de família. */
function rotuloDaProvisao(regra: RegraDeProvisao | undefined): string {
  const sentido = regra?.direcao === "payable" ? "a pagar" : "a receber";
  const quando = regra?.momento === "ao_finalizar_o_pedido" ? "ao finalizar o pedido" : "ao salvar o pedido";
  return `Provisionar ${sentido} ${quando}`;
}

/** A ajuda da caixa da provisão pela REGRA da família; sem regra (valor gravado fora do perfil), a do pedido de venda. */
const ajudaDaProvisao = (regra: RegraDeProvisao | undefined): string => AJUDA_DA_PROVISAO[regra?.momento ?? "ao_salvar_o_pedido"];

/** O erro do servidor (ou da conferência local) de um campo da seção, embaixo dele. */
const ErroDoCampo = ({ erros, caminho }: { erros: Readonly<Record<string, string>>; caminho: string }) => {
  const mensagem = erros[caminho];
  return mensagem === undefined ? null
    : <p data-testid={`top-erro-${caminho}`} className="mt-1 text-[11.5px] text-red-700">{mensagem}</p>;
};

/** Uma caixa de marcar com o rótulo e a ajuda ao lado (o molde de "Reservar estoque ao salvar o pedido"). */
function Caixa({ testId, rotulo, ajuda, marcado, onChange }: {
  testId: string; rotulo: string; ajuda: string; marcado: boolean; onChange: (v: boolean) => void;
}) {
  const idAjuda = React.useId();
  return <label className="flex items-start gap-2 text-[12.5px] text-slate-700">
    <input type="checkbox" data-testid={testId} className="mt-0.5" aria-describedby={idAjuda}
      checked={marcado} onChange={(e) => onChange(e.target.checked)} />
    <span>
      <span className="font-medium">{rotulo}</span>
      <span id={idAjuda} className="mt-0.5 block text-[11.5px] leading-relaxed text-slate-500">{ajuda}</span>
    </span>
  </label>;
}

export function AbaFinanceiroPadrao({ valor, familia, erros, onChange }: PropsDaSecaoV5<"financeiroPadrao">): React.ReactNode {
  const perfil = perfilDosPadroesFinanceiros(familia);
  const regraDaProvisao = regraDeProvisaoDaFamilia(familia);
  const mostraProvisao = perfil?.provisao === true || valor.provisao;
  // A família que provisiona e tem "Sem natureza e centro" (o pedido de venda) só gera título PELA provisão: sem ela, a
  // regra não tem efeito. O pedido de compra provisiona, mas a regra não vale nele (perfil `semClassificacao: false`).
  const semClassificacaoTemEfeito = perfil?.semClassificacao === true && (perfil.provisao !== true || valor.provisao);
  const mostraSemClassificacao = semClassificacaoTemEfeito || valor.semClassificacao !== "padrao_legado";
  const mostraDocumentoTroca = perfil?.trocaPeloDocumento === true || !valor.documentoTroca;
  return <div data-testid="top-secao-financeiro-padrao" className="grid grid-cols-12 gap-3">
    {mostraProvisao && <div className="col-span-12">
      <Caixa testId="top-campo-financeiroPadrao-provisao" rotulo={rotuloDaProvisao(regraDaProvisao)} ajuda={ajudaDaProvisao(regraDaProvisao)}
        marcado={valor.provisao} onChange={(provisao) => onChange({ ...valor, provisao })} />
      <ErroDoCampo erros={erros} caminho="financeiroPadrao.provisao" />
    </div>}
    {mostraSemClassificacao && <div className="col-span-12 md:col-span-8">
      <Field label={ROTULO_SEM_CLASSIFICACAO} help={AJUDA_SEM_CLASSIFICACAO} span={12}>
        <NativeSelect data-testid="top-campo-financeiroPadrao-semClassificacao" value={valor.semClassificacao}
          onChange={(e) => onChange({ ...valor, semClassificacao: e.target.value as SemClassificacaoTop })}>
          {SEM_CLASSIFICACAO_TOP.map((o) => <option key={o} value={o}>{ROTULOS_SEM_CLASSIFICACAO_TOP[o]}</option>)}
        </NativeSelect>
      </Field>
      <ErroDoCampo erros={erros} caminho="financeiroPadrao.semClassificacao" />
    </div>}
    {mostraDocumentoTroca && <div className="col-span-12">
      <Caixa testId="top-campo-financeiroPadrao-documentoTroca" rotulo={ROTULO_DOCUMENTO_TROCA} ajuda={AJUDA_DOCUMENTO_TROCA}
        marcado={valor.documentoTroca} onChange={(documentoTroca) => onChange({ ...valor, documentoTroca })} />
      <ErroDoCampo erros={erros} caminho="financeiroPadrao.documentoTroca" />
    </div>}
  </div>;
}
