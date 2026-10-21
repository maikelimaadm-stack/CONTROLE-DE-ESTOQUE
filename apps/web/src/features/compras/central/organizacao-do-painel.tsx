"use client";
import * as React from "react";
import { num } from "@/lib/utils";
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
 * (Totais / Financeiro / Rateio e classificação / Fiscal / Entrega e transporte).
 * A conta do documento mora na aba Totais (subtotal dos produtos, despesas, frete, seguro, desconto e total final);
 * o Financeiro fica só com o pagamento (condição, tipo de título, forma, vencimento e parcelas, com a entrada).
 * O total do documento aparece uma vez só, na aba Totais — sem a faixa de fechamento fora das abas. Observação nos
 * Dados principais. Valores em dinheiro sem o símbolo "R$" (decisão do usuário, 10/2026).
 */

/** Campos do layout que a criação desenha no painel (nunca nos Dados principais). */
export const CAMPOS_DO_PAINEL_DA_CRIACAO: readonly string[] = [
  "frete", "outras_despesas", "desconto",
  "plano_parcelas", "condicao_pagamento_id", "forma_pagamento_id", "data_vencimento",
  "categoria_financeira_id", "centro_custo_id",
  "transportadora_id"
];

/**
 * Os TOTAIS da compra (aba "Totais"): o subtotal dos produtos, o que compõe/ajusta o valor (outras despesas, frete,
 * seguro, desconto) e o total final. Nada de pagamento aqui.
 */
const TOTAIS = ["outras_despesas", "frete", "desconto"] as const;
/** A ordem dos totais no desenho — o seguro (fiscal) entra entre o frete e o desconto. */
const ORDEM_DOS_TOTAIS = ["outras_despesas", "frete", "seguro", "desconto"] as const;
/** O pagamento na aba Financeiro: condição, tipo de título, forma, vencimento e as parcelas (com a entrada). */
const FINANCEIRO = ["condicao_pagamento_id", "forma_pagamento_id", "data_vencimento", "plano_parcelas"] as const;
const RATEIO_CAMPOS = ["categoria_financeira_id", "centro_custo_id"] as const;
/** A entrega fica com o transporte; o frete compõe o valor, na aba Totais. */
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
 * O lado direito do Financeiro: as contas que o documento VINCULA. O tipo de título que as contas vão nascer com
 * subiu para a coluna do pagamento (antes dos vencimentos) — ele não é uma conta.
 */
function VinculosDoDocumento() {
  return <div className="space-y-2" data-testid="compras-vinculos">
    <h3 className="text-[11.5px] font-semibold text-slate-600">Vínculos</h3>
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

  /* OS TOTAIS: a conta do documento fechada, na ordem do desenho — subtotal dos produtos, o que o compõe
     (outras despesas, frete, seguro) e o que o reduz (desconto), com o total final. Nada de pagamento aqui. */
  const totais = presentes(TOTAIS);
  const seguro = fiscalNoPainel(e);
  abas.push({
    value: valorUnico("totais"), label: "Totais",
    erro: comErro(totais) || Boolean(e.erro("seguro")),
    content: <PainelColuna>
      <CampoLeitura rotulo="Total dos produtos" valor={num(e.totalItens, 2)} testId="compras-total-produtos" />
      {ORDEM_DOS_TOTAIS.map((c) => {
        if (c === "seguro") return seguro ? <CampoSeguro key="seguro" e={e} /> : null;
        return totais.includes(c) ? <React.Fragment key={c}>{desenharCampo(c)}</React.Fragment> : null;
      })}
      <Divisor />
      <CampoLeitura rotulo="Total da compra" valor={num(e.totalExibido, 2)} testId="compras-total" />
    </PainelColuna>
  });

  /* O PAGAMENTO na aba Financeiro: condição, tipo de título, forma de pagamento e só então o vencimento e as
     parcelas (com a entrada, quando há). Os totais do documento ficam na aba Totais; à direita, as contas. */
  const financeiro = presentes(FINANCEIRO);
  const tipoTitulo = fiscalNoPainel(e);
  if (financeiro.length || tipoTitulo) {
    abas.push({
      value: valorUnico("financeiro"), label: "Financeiro",
      erro: comErro(financeiro) || Boolean(e.erro("tipo_titulo_id")),
      content: <PainelRepartido lado={<VinculosDoDocumento />}>
        {financeiro.includes("condicao_pagamento_id") && <React.Fragment>{desenharCampo("condicao_pagamento_id")}</React.Fragment>}
        {tipoTitulo && <div className="max-w-[300px]"><TipoDeTituloDaCriacao e={e} /></div>}
        {financeiro.includes("forma_pagamento_id") && <React.Fragment>{desenharCampo("forma_pagamento_id")}</React.Fragment>}
        {(financeiro.includes("data_vencimento") || financeiro.includes("plano_parcelas")) && <Divisor />}
        {financeiro.includes("data_vencimento") && <React.Fragment>{desenharCampo("data_vencimento")}</React.Fragment>}
        {financeiro.includes("plano_parcelas") && <React.Fragment>{desenharCampo("plano_parcelas")}</React.Fragment>}
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

  return abas;
}

export function abaDoCampoNoPainel(e: EstadoDaCriacao, campo: string): string | null {
  const doRateio = abaDoRateio(e, campo);
  if (doRateio) return doRateio;
  if (campo === "tipo_titulo_id" && fiscalNoPainel(e)) return "financeiro";
  if (campo === "classificacao_gasto" && rateioNoPainel(e)) return ABA_DO_RATEIO;
  if (campo === "seguro" && fiscalNoPainel(e)) return "totais";
  if (fiscalNoPainel(e) && ["chave_acesso", "uf_nota", "tipo_documento_fiscal", "valor_ipi", "valor_icms_st"].includes(campo)) {
    return "fiscal";
  }
  const doCabecalho = camposDoPainelNoCabecalho(e);
  if (doCabecalho.has(campo)) {
    if ((FINANCEIRO as readonly string[]).includes(campo)) return "financeiro";
    if ((TOTAIS as readonly string[]).includes(campo)) return "totais";
    if ((RATEIO_CAMPOS as readonly string[]).includes(campo)) return ABA_DO_RATEIO;
    if ((ENTREGA as readonly string[]).includes(campo)) return "entrega";
  }
  const a = e.zonas.abas.find((x) => x.campos.includes(campo) && !CAMPOS_DO_PAINEL_DA_CRIACAO.includes(campo) && campo !== "observacao");
  return a ? `aba-${a.indice}` : null;
}
