"use client";
import * as React from "react";
import { num } from "@/lib/utils";
import { Input } from "@/components/ui";
import { CampoDaCentral, CampoLeitura, ColunaDeCampos } from "@/features/central/campo";
import { PainelColuna, PainelLargo } from "@/features/central/painel";
import type { AbaDoPainel } from "@/features/central/contrato";
import type { EstadoDaCriacao } from "./estado";
import {
  DadosFiscaisDaConsulta, DadosFiscaisDaCriacao, RateioDaConsulta, RateioEItensDaCriacao, TipoDeTituloDaCriacao, temDadosFiscais
} from "./dados-fiscais";
import {
  ABA_DO_RATEIO, ROTULO_DA_ABA_DO_RATEIO, abaDoRateio, caminhoDoRateioComErro, fiscalNoPainel, rateioNoPainel
} from "./rateio-no-rodape";

/**
 * Organização do painel da Central de Compras — identificar → produtos → fechar
 * (Totais / Financeiro / Vínculos / Rateio e classificação / Fiscal / Entrega e transporte).
 * A conta do documento mora na aba Totais (subtotal dos produtos, despesas, frete, seguro, desconto e total final);
 * o Financeiro fica só com o pagamento (condição, tipo de título, forma, vencimento e parcelas, com a entrada), e os
 * títulos que o documento vincula moram na aba Vínculos.
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

/** O seguro do documento (dado fiscal) — na aba Totais, junto do que compõe o valor. */
function CampoSeguro({ e }: { e: EstadoDaCriacao }) {
  if (!e.editarFiscal && e.documentoEmEdicao) {
    const v = e.documentoEmEdicao["seguro"];
    const texto = v === null || v === undefined || v === "" ? "" : String(v);
    return <>
      <CampoLeitura rotulo="Seguro" testId="compras-seguro-campo" valor={texto} />
      <p className="text-[11px] text-slate-500">Gravado na compra — a edição aberta não altera dados fiscais.</p>
    </>;
  }
  return <CampoDaCentral rotulo="Seguro" erro={e.erro("seguro")} preenchido={e.fiscal.seguro !== ""} testId="compras-seguro-campo" data-campo-fiscal="seguro">
    <Input data-testid="compras-seguro" type="number" step="0.01" min="0" inputMode="decimal" value={e.fiscal.seguro}
      onChange={(ev) => e.mudarFiscal({ seguro: ev.target.value })} />
  </CampoDaCentral>;
}

/** Tipo de título: editável na criação; na edição, leitura do documento (PATCH não troca). */
function TipoDeTituloNoPainel({ e }: { e: EstadoDaCriacao }) {
  if (e.editarFiscal) return <TipoDeTituloDaCriacao e={e} />;
  if (e.documentoEmEdicao) {
    const nome = String(e.documentoEmEdicao["tipo_titulo_nome"] ?? "");
    const id = e.documentoEmEdicao["tipo_titulo_id"];
    const valor = nome || (id ? "Informado" : "");
    return <>
      <CampoLeitura rotulo="Tipo de título" adorno="pesquisa" testId="compras-tipo-titulo" valor={valor} />
      <p className="text-[11px] text-slate-500">Gravado na compra — a edição aberta não altera o tipo de título.</p>
    </>;
  }
  return null;
}

/**
 * A aba VÍNCULOS: as contas que o documento vincula (e os documentos ligados a ele). O tipo de título que as contas
 * vão nascer com fica no Financeiro, junto do pagamento — ele não é uma conta. Aba própria porque a lista de títulos
 * não convive com as parcelas na mesma coluna.
 */
function VinculosDoDocumento() {
  return <div className="space-y-2" data-testid="compras-vinculos">
    <h3 className="text-[11.5px] font-semibold text-slate-600">Vínculos</h3>
    <p className="text-[12px] text-slate-500" data-testid="compras-vinculos-vazio">
      Os títulos serão gerados após a confirmação, conforme a TOP e o pagamento.
    </p>
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

  /* O PAGAMENTO na aba Financeiro: condição, tipo de título, forma de pagamento, vencimento e as parcelas (com a
     entrada, quando há). Os totais do documento ficam na aba Totais; as contas vinculadas, na aba Vínculos. */
  const financeiro = presentes(FINANCEIRO);
  const tipoTitulo = fiscalNoPainel(e);
  /* Com a lista de parcelas manual, a data de cada parcela é o cronograma — o "Vencimento" solto não aparece. */
  const vencimentoSolto = financeiro.includes("data_vencimento") && !e.ajustarParcelas;
  if (financeiro.length || tipoTitulo) {
    abas.push({
      value: valorUnico("financeiro"), label: "Financeiro",
      erro: comErro(financeiro) || Boolean(e.erro("tipo_titulo_id")),
      /* O pagamento fica na coluna de 330px; a tabela de parcelas ocupa a largura do painel, abaixo dele, para
         vencimento, valor e observação caberem na mesma linha. */
      content: <div className="space-y-3">
        <PainelColuna>
          {financeiro.includes("condicao_pagamento_id") && <React.Fragment>{desenharCampo("condicao_pagamento_id")}</React.Fragment>}
          {tipoTitulo && <div className="max-w-[300px]"><TipoDeTituloNoPainel e={e} /></div>}
          {financeiro.includes("forma_pagamento_id") && <React.Fragment>{desenharCampo("forma_pagamento_id")}</React.Fragment>}
          {vencimentoSolto && <Divisor />}
          {vencimentoSolto && <React.Fragment>{desenharCampo("data_vencimento")}</React.Fragment>}
        </PainelColuna>
        {financeiro.includes("plano_parcelas") &&
          <div className="max-w-[960px]" data-testid="compras-financeiro-parcelas">{desenharCampo("plano_parcelas")}</div>}
      </div>
    });
  }

  /* OS VÍNCULOS do documento (os títulos que nascem dele) têm aba própria: a lista não divide mais o espaço com o
     pagamento nem com as parcelas. */
  abas.push({
    value: valorUnico("vinculos"), label: "Vínculos",
    content: <PainelLargo><VinculosDoDocumento /></PainelLargo>
  });

  const rateioCampos = presentes(RATEIO_CAMPOS);
  if (rateioNoPainel(e) || rateioCampos.length) abas.push({
    value: valorUnico(ABA_DO_RATEIO), label: ROTULO_DA_ABA_DO_RATEIO,
    erro: caminhoDoRateioComErro(e.errosDaTela) !== null || comErro(rateioCampos) || Boolean(e.erro("classificacao_gasto")),
    content: <PainelLargo>
      {rateioCampos.length > 0 && <ColunaDeCampos>
        {rateioCampos.map((c) => <React.Fragment key={c}>{desenharCampo(c)}</React.Fragment>)}
      </ColunaDeCampos>}
      {/* Edição: classificação/rateio gravados em leitura no MESMO lugar da criação (PATCH não os altera). */}
      {rateioNoPainel(e) && (e.editarRateio
        ? <RateioEItensDaCriacao e={e} />
        : e.documentoEmEdicao
          ? <div data-testid="compras-edicao-rateio-leitura" className="space-y-2">
              <p className="text-[12px] text-slate-600" data-testid="compras-rateio-leitura-motivo">
                Classificação e rateio gravados na compra. A edição aberta não altera estes campos — só o que a PATCH aceita.
              </p>
              <RateioDaConsulta d={e.documentoEmEdicao} />
              {!e.documentoEmEdicao["rateio_tipo"] && <PainelColuna>
                <CampoLeitura rotulo="Natureza de despesa" adorno="pesquisa"
                  valor={[e.documentoEmEdicao["categoria_financeira_codigo"], e.documentoEmEdicao["categoria_financeira_nome"]].filter(Boolean).join(" — ")} />
                <CampoLeitura rotulo="Centro de resultado" adorno="pesquisa"
                  valor={[e.documentoEmEdicao["centro_custo_codigo"], e.documentoEmEdicao["centro_custo_nome"]].filter(Boolean).join(" — ")} />
              </PainelColuna>}
            </div>
          : null)}
    </PainelLargo>
  });

  if (fiscalNoPainel(e)) abas.push({
    value: valorUnico("fiscal"), label: "Fiscal",
    erro: ["chave_acesso", "uf_nota", "valor_ipi", "valor_icms_st"].some((c) => Boolean(e.erro(c))),
    content: <PainelColuna>
      {e.editarFiscal
        ? <DadosFiscaisDaCriacao e={e} noPainel />
        : e.documentoEmEdicao && temDadosFiscais(e.documentoEmEdicao)
          ? <div data-testid="compras-edicao-fiscal-leitura">
              <p className="mb-2 text-[12px] text-slate-600" data-testid="compras-fiscal-leitura-motivo">
                Dados fiscais da nota — imutáveis na edição aberta (a PATCH os recusa).
              </p>
              <DadosFiscaisDaConsulta d={e.documentoEmEdicao} />
            </div>
          : <p className="text-[12px] text-slate-500" data-testid="compras-fiscal-vazio">Nenhum dado fiscal gravado nesta compra.</p>}
    </PainelColuna>
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
