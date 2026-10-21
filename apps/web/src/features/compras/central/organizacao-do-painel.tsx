"use client";
import * as React from "react";
import { brl } from "@/lib/utils";
import { Input } from "@/components/ui";
import { CampoDaCentral, CampoLeitura, ColunaDeCampos } from "@/features/central/campo";
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
 * Fora das abas fica SÓ o fechamento do documento (`faixaDosTotaisDoPainel`); o subtotal dos produtos e os ajustes
 * moram no Financeiro, e o frete mora em Entrega e transporte, com o transporte. Observação nos Dados principais.
 */

/** Campos do layout que a criação desenha no painel (nunca nos Dados principais). */
export const CAMPOS_DO_PAINEL_DA_CRIACAO: readonly string[] = [
  "frete", "outras_despesas", "desconto",
  "plano_parcelas", "condicao_pagamento_id", "forma_pagamento_id", "data_vencimento",
  "categoria_financeira_id", "centro_custo_id",
  "transportadora_id"
];

/** Ajustes do valor (desconto/despesa) — no Financeiro, DEPOIS do subtotal dos produtos, que é outra conta. */
const AJUSTES = ["outras_despesas", "desconto"] as const;
const FINANCEIRO = ["outras_despesas", "desconto", "condicao_pagamento_id", "forma_pagamento_id", "data_vencimento", "plano_parcelas"] as const;
const RATEIO_CAMPOS = ["categoria_financeira_id", "centro_custo_id"] as const;
/** O frete NÃO é despesa do documento: ele pertence à entrega, junto da transportadora. */
const ENTREGA = ["frete", "transportadora_id"] as const;

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
 * O FECHAMENTO do documento, sempre visível e FORA das abas — só ele: o subtotal dos produtos e os ajustes que o
 * formam moram no Financeiro, cada um no seu lugar. É um campo como os outros (`CampoLeitura`), na largura do desenho.
 */
export function faixaDosTotaisDoPainel(e: EstadoDaCriacao): React.ReactNode {
  if (!e.mostrarFormulario) return null;
  return <div data-testid="compras-faixa-totais" className="flex justify-end pb-2">
    <div className="w-[300px] max-w-full">
      <CampoLeitura rotulo="Total do documento" valor={brl(e.totalExibido)} testId="compras-total" />
    </div>
  </div>;
}

/** A régua entre os grupos do Financeiro (subtotal × ajustes × pagamento). */
const Divisor = () => <div className="h-px bg-slate-200" aria-hidden />;

/** O seguro do documento (dado fiscal) — no Financeiro, junto do que compõe o valor. */
function CampoSeguro({ e }: { e: EstadoDaCriacao }) {
  return <CampoDaCentral rotulo="Seguro" erro={e.erro("seguro")} preenchido={e.fiscal.seguro !== ""} testId="compras-seguro-campo" data-campo-fiscal="seguro">
    <Input data-testid="compras-seguro" type="number" step="0.01" min="0" inputMode="decimal" value={e.fiscal.seguro}
      onChange={(ev) => e.mudarFiscal({ seguro: ev.target.value })} />
  </CampoDaCentral>;
}

/**
 * O lado direito do Financeiro: o que o documento VINCULA — o tipo de título que as contas a pagar vão nascer com
 * (dado fiscal, não é pagamento) e as contas do documento. Não se mistura com os campos de pagamento.
 */
function VinculosDoDocumento({ e }: { e: EstadoDaCriacao }) {
  return <div className="space-y-2" data-testid="compras-vinculos">
    <h3 className="text-[11.5px] font-semibold text-slate-600">Vínculos</h3>
    {fiscalNoPainel(e) && <div className="max-w-[300px]"><TipoDeTituloDaCriacao e={e} /></div>}
    <TitulosDoDocumento legenda="Contas a pagar do documento" titulos={[]} linkDoTitulo={linkDoTituloDeCompra} />
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
  if (financeiro.length || fiscalNoPainel(e)) {
    /* Três grupos, na ordem da conta: o subtotal dos produtos, o que o ajusta (despesas, desconto, seguro) e o
       pagamento com as parcelas. "Tipo de título" não é pagamento: mora nos Vínculos, do lado direito. */
    const ajustes = financeiro.filter((c) => (AJUSTES as readonly string[]).includes(c));
    const pagamento = financeiro.filter((c) => !(AJUSTES as readonly string[]).includes(c));
    const seguro = fiscalNoPainel(e);
    abas.push({
      value: valorUnico("financeiro"), label: "Financeiro",
      erro: comErro(financeiro) || Boolean(e.erro("tipo_titulo_id")) || Boolean(e.erro("seguro")),
      content: <PainelRepartido lado={<VinculosDoDocumento e={e} />}>
        <CampoLeitura rotulo="Total dos produtos" valor={brl(e.totalItens)} testId="compras-total-produtos" />
        {(ajustes.length > 0 || seguro) && <Divisor />}
        {ajustes.map((c) => <React.Fragment key={c}>{desenharCampo(c)}</React.Fragment>)}
        {seguro && <CampoSeguro e={e} />}
        {pagamento.length > 0 && <Divisor />}
        {pagamento.map((c) => <React.Fragment key={c}>{desenharCampo(c)}</React.Fragment>)}
      </PainelRepartido>
    });
  }

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
      value: valorUnico("resumo"), label: "Resumo", erro: comErro([...FINANCEIRO]),
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
  if (campo === "seguro" && fiscalNoPainel(e)) return "financeiro";
  if (fiscalNoPainel(e) && ["chave_acesso", "uf_nota", "tipo_documento_fiscal", "valor_ipi", "valor_icms_st"].includes(campo)) {
    return "fiscal";
  }
  const doCabecalho = camposDoPainelNoCabecalho(e);
  if (doCabecalho.has(campo)) {
    if ((FINANCEIRO as readonly string[]).includes(campo)) return "financeiro";
    if ((RATEIO_CAMPOS as readonly string[]).includes(campo)) return ABA_DO_RATEIO;
    if ((ENTREGA as readonly string[]).includes(campo)) return "entrega";
  }
  const a = e.zonas.abas.find((x) => x.campos.includes(campo) && !CAMPOS_DO_PAINEL_DA_CRIACAO.includes(campo) && campo !== "observacao");
  return a ? `aba-${a.indice}` : null;
}
