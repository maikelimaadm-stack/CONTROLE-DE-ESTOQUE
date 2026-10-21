"use client";
import * as React from "react";
import { brl, cn } from "@/lib/utils";
import { Input } from "@/components/ui";
import { CampoDaCentral, ColunaDeCampos } from "@/features/central/campo";
import { PainelColuna, PainelLargo, PainelRepartido, TitulosDoDocumento } from "@/features/central/painel";
import type { AbaDoPainel } from "@/features/central/contrato";
import { linkDoTituloDeCompra } from "./adaptador";
import type { EstadoDaCriacao } from "./estado";
import { DadosFiscaisDaCriacao, RateioEItensDaCriacao, TipoDeTituloDaCriacao } from "./dados-fiscais";
import {
  ABA_DO_RATEIO, ROTULO_DA_ABA_DO_RATEIO, abaDoRateio, caminhoDoRateioComErro, fiscalNoPainel, rateioNoPainel
} from "./rateio-no-rodape";

/**
 * Organização do painel da Central de Compras — identificar → produtos → fechar
 * (Financeiro / Rateio e classificação / Fiscal / Entrega e transporte).
 * Totais ficam FORA das abas (`faixaDosTotaisDoPainel`). Observação fica nos Dados principais.
 */

/** Campos do layout que a criação desenha no painel (nunca nos Dados principais). */
export const CAMPOS_DO_PAINEL_DA_CRIACAO: readonly string[] = [
  "frete", "outras_despesas", "desconto",
  "plano_parcelas", "condicao_pagamento_id", "forma_pagamento_id", "data_vencimento",
  "categoria_financeira_id", "centro_custo_id",
  "transportadora_id"
];

const TOTAIS = ["frete", "outras_despesas", "desconto"] as const;
const FINANCEIRO = ["condicao_pagamento_id", "forma_pagamento_id", "data_vencimento", "plano_parcelas"] as const;
const RATEIO_CAMPOS = ["categoria_financeira_id", "centro_custo_id"] as const;
const ENTREGA = ["transportadora_id"] as const;

/** Campos que permanecem nos Dados principais (identificação da compra). */
export const CAMPOS_DOS_DADOS_PRINCIPAIS: readonly string[] = [
  "empresa_id", "fornecedor_id", "numero_nota", "serie_nota", "data_documento", "data_entrada", "observacao"
];

export type DesenharCampo = (campo: string) => React.ReactNode;

export function camposDoPainelNoCabecalho(e: EstadoDaCriacao): Set<string> {
  const cabecalho = [...e.zonas.principais, ...e.zonas.adicionais];
  return new Set(cabecalho.filter((c) => CAMPOS_DO_PAINEL_DA_CRIACAO.includes(c)));
}

/**
 * Um total da faixa: o rótulo pequeno em cima e o valor embaixo, alinhados à direita. É RESUMO, não campo — os 126px
 * de rótulo do desenho não caberiam num bloco de total, e era isso que fazia o rótulo invadir o campo vizinho.
 */
function TotalDaFaixa({ rotulo, valor, testId, destaque }: { rotulo: string; valor: string; testId: string; destaque?: boolean }) {
  return <div className="flex w-[210px] max-w-full items-baseline justify-between gap-4">
    <span className="text-[11.5px] leading-5 text-slate-500">{rotulo}</span>
    <span data-testid={testId} className={cn("tabular-nums", destaque ? "text-[15px] font-semibold text-emerald-700" : "text-[13px] font-semibold text-slate-900")}>{valor}</span>
  </div>;
}

/** Totais sempre visíveis, fora das abas — um único local de edição dos valores. */
export function faixaDosTotaisDoPainel(e: EstadoDaCriacao, desenharCampo: DesenharCampo): React.ReactNode {
  if (!e.mostrarFormulario) return null;
  const doCabecalho = camposDoPainelNoCabecalho(e);
  const totais = TOTAIS.filter((c) => doCabecalho.has(c));
  const seguro = fiscalNoPainel(e);
  /* Ajustes à esquerda (uma célula por campo, com largura mínima para o rótulo não encostar na caixa) e o fechamento
     do documento à direita, separado pela régua — em coluna, para não roubar largura dos campos. */
  return <div data-testid="compras-faixa-totais" className="flex flex-wrap items-center gap-x-8 gap-y-3 pb-2">
    <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-5 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
      {totais.map((c) => <div key={c} className="min-w-0">{desenharCampo(c)}</div>)}
      {seguro && <div className="min-w-0">
        <CampoDaCentral rotulo="Seguro" erro={e.erro("seguro")} preenchido={e.fiscal.seguro !== ""} testId="compras-seguro-campo" data-campo-fiscal="seguro">
          <Input data-testid="compras-seguro" type="number" step="0.01" min="0" inputMode="decimal" value={e.fiscal.seguro}
            onChange={(ev) => e.mudarFiscal({ seguro: ev.target.value })} />
        </CampoDaCentral>
      </div>}
    </div>
    <div className="flex shrink-0 flex-col gap-0.5 pl-6 sm:border-l sm:border-slate-200">
      <TotalDaFaixa rotulo="Total dos produtos" valor={brl(e.totalItens)} testId="compras-total-produtos" />
      <TotalDaFaixa rotulo="Total do documento" valor={brl(e.totalExibido)} testId="compras-total" destaque />
    </div>
  </div>;
}

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

  const financeiro = presentes(FINANCEIRO);
  if (financeiro.length) abas.push({
    value: valorUnico("financeiro"), label: "Financeiro", erro: comErro(financeiro) || Boolean(e.erro("tipo_titulo_id")),
    content: <PainelRepartido lado={<TitulosDoDocumento legenda="Contas a pagar do documento" titulos={[]} linkDoTitulo={linkDoTituloDeCompra} />}>
      <p className="col-span-full text-[12px] text-slate-500" data-testid="compras-plano-dica">
        Para informar a quantidade de parcelas e as datas, escolha &quot;Ajustar parcelas&quot; e preencha Nº de parcelas e 1º vencimento.
      </p>
      {financeiro.map((c) => <React.Fragment key={c}>{desenharCampo(c)}</React.Fragment>)}
      {fiscalNoPainel(e) && <TipoDeTituloDaCriacao e={e} />}
    </PainelRepartido>
  });

  const rateioCampos = presentes(RATEIO_CAMPOS);
  if (rateioNoPainel(e) || rateioCampos.length) abas.push({
    value: valorUnico(ABA_DO_RATEIO), label: ROTULO_DA_ABA_DO_RATEIO,
    erro: caminhoDoRateioComErro(e.errosDaTela) !== null || comErro(rateioCampos) || Boolean(e.erro("classificacao_gasto")),
    content: <PainelLargo>
      {rateioCampos.length > 0 && <ColunaDeCampos>
        {rateioCampos.map((c) => <React.Fragment key={c}>{desenharCampo(c)}</React.Fragment>)}
      </ColunaDeCampos>}
      {rateioNoPainel(e) && <RateioEItensDaCriacao e={e} />}
    </PainelLargo>
  });

  if (fiscalNoPainel(e)) abas.push({
    value: valorUnico("fiscal"), label: "Fiscal",
    erro: ["chave_acesso", "uf_nota", "valor_ipi", "valor_icms_st"].some((c) => Boolean(e.erro(c))),
    content: <PainelColuna><DadosFiscaisDaCriacao e={e} noPainel /></PainelColuna>
  });

  const entrega = presentes(ENTREGA);
  if (entrega.length) abas.push({
    value: valorUnico("entrega"), label: "Entrega e transporte", erro: comErro(entrega),
    content: <PainelColuna>{entrega.map((c) => <React.Fragment key={c}>{desenharCampo(c)}</React.Fragment>)}</PainelColuna>
  });

  for (const a of e.zonas.abas) {
    const camposRestantes = a.campos.filter((c) => !CAMPOS_DO_PAINEL_DA_CRIACAO.includes(c) && c !== "observacao");
    if (!camposRestantes.length) continue;
    const campos = camposRestantes.map((c) => <React.Fragment key={c}>{desenharCampo(c)}</React.Fragment>);
    abas.push({
      value: valorUnico(`aba-${a.indice}`), label: a.aba, erro: comErro(camposRestantes),
      content: <div data-testid={`compras-zona-aba-${a.indice}`}><PainelColuna>{campos}</PainelColuna></div>
    });
  }

  if (!abas.length) {
    abas.push({
      value: valorUnico("resumo"), label: "Resumo", erro: comErro([...TOTAIS]),
      content: <p className="text-[12.5px] text-slate-500">Totais da compra na faixa acima.</p>
    });
  }

  return abas;
}

export function abaDoCampoNoPainel(e: EstadoDaCriacao, campo: string): string | null {
  const doRateio = abaDoRateio(e, campo);
  if (doRateio) return doRateio;
  if (campo === "tipo_titulo_id" && fiscalNoPainel(e)) return "financeiro";
  if (campo === "classificacao_gasto" && rateioNoPainel(e)) return ABA_DO_RATEIO;
  if (campo === "seguro" && fiscalNoPainel(e)) return null; // faixa de totais
  if (fiscalNoPainel(e) && ["chave_acesso", "uf_nota", "tipo_documento_fiscal", "valor_ipi", "valor_icms_st"].includes(campo)) {
    return "fiscal";
  }
  const doCabecalho = camposDoPainelNoCabecalho(e);
  if (doCabecalho.has(campo)) {
    if ((TOTAIS as readonly string[]).includes(campo)) return null;
    if ((FINANCEIRO as readonly string[]).includes(campo)) return "financeiro";
    if ((RATEIO_CAMPOS as readonly string[]).includes(campo)) return ABA_DO_RATEIO;
    if ((ENTREGA as readonly string[]).includes(campo)) return "entrega";
  }
  const a = e.zonas.abas.find((x) => x.campos.includes(campo) && !CAMPOS_DO_PAINEL_DA_CRIACAO.includes(campo) && campo !== "observacao");
  return a ? `aba-${a.indice}` : null;
}
