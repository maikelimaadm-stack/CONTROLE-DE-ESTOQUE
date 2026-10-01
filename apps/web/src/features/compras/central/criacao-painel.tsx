"use client";
import * as React from "react";
import { brl } from "@/lib/utils";
import { CampoLeitura } from "@/features/central/campo";
import { PainelColuna, PainelLargo, PainelRepartido, TitulosDoDocumento } from "@/features/central/painel";
import type { AbaDoPainel } from "@/features/central/contrato";
import { linkDoTituloDeCompra } from "./adaptador";
import type { EstadoDaCriacao } from "./estado";

/**
 * CENTRAL DE COMPRAS — O PAINEL INFERIOR DA CRIAÇÃO (VISUAL-UX-04, decisão 276).
 *
 * A moldura do motor desenha a faixa das abas; daqui sai só a lista de abas (`AbaDoPainel[]`). Nada aqui decide valor,
 * obrigatoriedade, erro ou corpo: os campos são desenhados pelo MESMO renderizador dos Dados principais (`desenharCampo`,
 * o `render` de `criacao-dados.tsx`), e o estado é o de `useEstadoDaCriacao`.
 *
 * QUEM VAI PARA O PAINEL (um campo nunca aparece em dois lugares):
 *   - cada aba do RODAPÉ do layout de compra (COMPRAS-03, `e.zonas.abas`) vira uma aba do painel, com os campos dela;
 *   - dos campos que o layout põe no CABEÇALHO (principais ou adicionais), os do painel (`CAMPOS_DO_PAINEL_DA_CRIACAO`)
 *     saem dos Dados e entram nas abas fixas do desenho:
 *       Totais      → Frete, Outras despesas, Desconto e o Total do documento (`compras-total`, apresentação);
 *       Financeiro  → Parcelas e o plano do motor (`PlanoDaCentral`, via o renderizador), com os títulos à direita
 *                     (na criação ainda não há nenhum);
 *       Observações → Observação (área larga).
 */

/** Os campos do cabeçalho que a criação desenha no painel, não nos Dados. `criacao-dados.tsx` deixa de desenhá-los. */
export const CAMPOS_DO_PAINEL_DA_CRIACAO: readonly string[] = ["frete", "outras_despesas", "desconto", "plano_parcelas", "observacao"];
const TOTAIS = ["frete", "outras_despesas", "desconto"];
const FINANCEIRO = ["plano_parcelas"];
const OBSERVACOES = ["observacao"];

/** Os campos do cabeçalho (principais + adicionais) que o painel toma, na ordem do layout. */
export function camposDoPainelNoCabecalho(e: EstadoDaCriacao): Set<string> {
  const cabecalho = [...e.zonas.principais, ...e.zonas.adicionais];
  return new Set(cabecalho.filter((c) => CAMPOS_DO_PAINEL_DA_CRIACAO.includes(c)));
}

export type DesenharCampo = (campo: string) => React.ReactNode;

/**
 * As abas do painel da criação. Sem o formulário à vista (receber sem o pedido pronto), nenhuma aba.
 * `desenharCampo` desenha o campo com rótulo, "*", erro, padrão e trava do layout — o mesmo dos Dados principais.
 */
export function abasDoPainelDaCriacao(e: EstadoDaCriacao, desenharCampo: DesenharCampo): AbaDoPainel[] {
  if (!e.mostrarFormulario) return [];
  const doCabecalho = camposDoPainelNoCabecalho(e);
  const presentes = (lista: readonly string[]) => lista.filter((c) => doCabecalho.has(c));
  const comErro = (campos: readonly string[]) => campos.some((c) => Boolean(e.erro(c)));
  const usados = new Set<string>();
  const valorUnico = (preferido: string) => {
    let v = preferido; let n = 2;
    while (usados.has(v)) v = `${preferido}-${n++}`;
    usados.add(v);
    return v;
  };

  const abas: AbaDoPainel[] = [];

  const totais = presentes(TOTAIS);
  abas.push({
    value: valorUnico("totais"), label: "Totais", erro: comErro(totais),
    content: <PainelRepartido>
      {totais.map((c) => <React.Fragment key={c}>{desenharCampo(c)}</React.Fragment>)}
      <CampoLeitura rotulo="Total do documento" valor={brl(e.totalExibido)} testId="compras-total" />
    </PainelRepartido>
  });

  const financeiro = presentes(FINANCEIRO);
  if (financeiro.length) abas.push({
    value: valorUnico("financeiro"), label: "Financeiro", erro: comErro(financeiro),
    content: <PainelRepartido lado={<TitulosDoDocumento legenda="Contas a pagar do documento" titulos={[]} linkDoTitulo={linkDoTituloDeCompra} />}>
      {financeiro.map((c) => <React.Fragment key={c}>{desenharCampo(c)}</React.Fragment>)}
    </PainelRepartido>
  });

  /* As abas do rodapé do layout, na ordem dele; `compras-zona-aba-<índice>` continua no conteúdo de cada uma. */
  for (const a of e.zonas.abas) {
    const especial = a.campos.includes("plano_parcelas") || a.campos.includes("condicao_pagamento_id");
    const campos = a.campos.map((c) => <React.Fragment key={c}>{desenharCampo(c)}</React.Fragment>);
    const corpo = a.campos.length === 1 && a.campos[0] === "observacao"
      ? <PainelLargo>{campos}</PainelLargo>
      : especial
        ? <PainelRepartido lado={<TitulosDoDocumento legenda="Contas a pagar do documento" titulos={[]} linkDoTitulo={linkDoTituloDeCompra} />}>{campos}</PainelRepartido>
        : <PainelColuna>{campos}</PainelColuna>;
    abas.push({
      value: valorUnico(`aba-${a.indice}`), label: a.aba, erro: comErro(a.campos),
      content: <div data-testid={`compras-zona-aba-${a.indice}`}>{corpo}</div>
    });
  }

  const observacoes = presentes(OBSERVACOES);
  if (observacoes.length) abas.push({
    value: valorUnico("observacoes"), label: "Observações", erro: comErro(observacoes),
    content: <PainelLargo>{observacoes.map((c) => <React.Fragment key={c}>{desenharCampo(c)}</React.Fragment>)}</PainelLargo>
  });

  return abas;
}

/** O valor da aba do painel em que o campo mora (para a lista de pendências levar ao campo). `null` = não está no painel. */
export function abaDoCampoNoPainel(e: EstadoDaCriacao, campo: string): string | null {
  const doCabecalho = camposDoPainelNoCabecalho(e);
  if (doCabecalho.has(campo)) {
    if (TOTAIS.includes(campo)) return "totais";
    if (FINANCEIRO.includes(campo)) return "financeiro";
    if (OBSERVACOES.includes(campo)) return "observacoes";
  }
  const a = e.zonas.abas.find((x) => x.campos.includes(campo));
  return a ? `aba-${a.indice}` : null;
}
