"use client";
import * as React from "react";
import Link from "next/link";
import { LAYOUT_DO_SISTEMA } from "@agro/domain";
import { useTradutor } from "@/lib/i18n";
import { brl, dateBR, dateTimeBR } from "@/lib/utils";
import { enumLabel } from "@/lib/copy";
import { statusTone } from "@/components/ui";
import type { Row } from "@/features/docs/shared";
import { CampoLeitura, ColunaDeCampos } from "@/features/central/campo";
import { ItensSalvos } from "@/features/central/itens-salvos";
import { PainelColuna, PainelLargo, Relacao, Selo, TitulosDoDocumento, type ColunaDaRelacao } from "@/features/central/painel";
import type { AbaDoPainel } from "@/features/central/contrato";
import { AprovacaoDoDocumento } from "@/features/aprovacoes/aprovacao-do-documento";
import { zonasDaCentral, type ZonasDaCentral } from "../layout-da-central";
import { rotaDoDocumento } from "../documentos-compra-list";
import { CamposExtrasDaCompra } from "../campos-extras";
import { PREFIXO_CENTRAL_COMPRAS, colunasDosItensDeCompras, linkDoTituloDeCompra } from "./adaptador";
import type { EstadoDaConsulta } from "./estado";
import { BensDaConsulta, DadosFiscaisDaConsulta, RateioDaConsulta, temDadosFiscais } from "./dados-fiscais";
import { modeloDeParcelasParaTela } from "./modelo-de-parcelas";

/**
 * O CORPO DA CONSULTA DA COMPRA NO MOTOR (VISUAL-UX-04, decisão 276): Dados principais e extras em LEITURA (sem
 * acordeão "Dados adicionais"), os itens salvos (grade do motor) e as abas do painel. Nada aqui calcula, decide ou
 * grava: totais, subtotal, títulos, movimentos e compras geradas vêm prontos do detalhe
 * (`/api/compras/<segmento>/<id>`). Os testids `compras-*` de antes continuam no elemento equivalente.
 *
 * Organização alinhada à criação (PR #139): Dados = identificação; painel = Totais · Financeiro · Vínculos ·
 * Rateio e classificação · Fiscal · Entrega e transporte. Pagamento e rateio NÃO ficam nos Dados. Frete editável/
 * valor mora em Totais; a aba de entrega só traz a transportadora. Observação nos Dados (como na criação); bens do
 * imobilizado na aba Observações.
 *
 * Fiscal (nota, série, data de entrada) só aparece como aba quando o layout NÃO os põe nos Dados — a zona vem de
 * quem chama; sem ela, a do LAYOUT_DO_SISTEMA (a consulta não carrega layout).
 *
 * OPERACOES-01 F7 (decisão 284): a compra com dados fiscais ganha a seção "Dados fiscais"
 * (`compras-consulta-dados-fiscais`) na aba Fiscal; IPI, ICMS-ST e seguro entram nos Totais; o rateio na aba Rateio
 * (`compras-consulta-rateio`); títulos na aba Vínculos (`compras-consulta-titulos`).
 */

const t = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(v));
const codigoNome = (codigo: unknown, nome: unknown) => (nome ? [codigo, nome].filter(Boolean).join(" — ") : "");
const temValor = (v: unknown) => v !== null && v !== undefined && v !== "";
const dataOuVazio = (v: unknown) => (typeof v === "string" && v ? dateBR(v) : "");

const CAMPOS_FISCAIS = ["numero_nota", "serie_nota", "data_entrada"] as const;

/** "02/10/2026, 14:30 por Maria" — a data e hora de quem fez, como o "Saldo encerrado em … por …" dos itens. */
const quemEQuando = (q: { em: string; porNome: string }) => `${dateTimeBR(q.em)} por ${q.porNome || "—"}`;
/**
 * EDITAR-02 (decisão 313, P5): a `version` do documento que a consulta mostra — o conteúdo VISTO, para a decisão de
 * aprovação valer para ele (mudou depois → 409). SE ela vai na decisão não se decide aqui: o bloco da aprovação só a
 * manda quando a SITUAÇÃO da aprovação a declara (`versaoDaDecisaoDaConsulta`). A presença dela no documento não diz
 * nada: o GET por id da base também a devolve (`d.*`, com o banco na 0063).
 */
const versaoDoDocumento = (d: Record<string, unknown>): string | undefined =>
  typeof d["version"] === "string" || typeof d["version"] === "number" ? String(d["version"]) : undefined;

/** A zona padrão da consulta: a do layout do sistema da família da espécie. */
export const zonasPadraoDaConsulta = (familia: string): ZonasDaCentral => zonasDaCentral(familia, LAYOUT_DO_SISTEMA(familia));

/**
 * O ITEM DA COMPRA NAS CHAVES DA GRADE DO MOTOR (que lê `product_name`, `quantity`, `unit_price`…). No pedido,
 * "faturado" carrega o RECEBIDO do servidor; a validade sai em data brasileira. Nenhum valor é calculado.
 */
export function itemParaOMotor(it: Row): Row {
  return {
    ...it,
    product_id: it["produto_id"], warehouse_id: it["armazem_id"],
    product_code: it["produto_codigo"], product_name: it["produto_nome"], warehouse_name: it["armazem_nome"],
    quantity: it["quantidade"], unit: it["unidade"], unit_price: it["valor_unitario"],
    discount: it["desconto"], discount_percent: it["desconto_percentual"], total: it["valor_total"],
    validade: dataOuVazio(it["validade"]) || null,
    ...(it["recebido"] !== undefined ? { faturado: it["recebido"] } : {})
  };
}

/**
 * Dados principais e extras (Movimento, Versão da TOP, Origem) — sempre à vista, sem acordeão. Antes dos campos, a
 * situação da aprovação (OPERACOES-01 F2): o bloco de Aprovações, que só aparece com o documento aberto e a TOP
 * exigindo aprovação.
 *   · COMPRA: Aprovar/Reprovar a quem tem `compras.approve` (a aprovação vale ao confirmar).
 *   · PEDIDO DE COMPRA (F6b, decisão 283): a aprovação vale ao FINALIZAR (a 0044 a estendeu ao pedido) — o bloco só
 *     com a capacidade da F6 declarada pela API, e Aprovar/Reprovar a quem tem `pedidos_compra.approve` E
 *     `compras.approve` (a porta da decisão). Nos extras, quem finalizou e quem aprovou para orçamento.
 */
export function DadosDaConsulta({ e, zonas }: { e: EstadoDaConsulta; zonas?: ZonasDaCentral }) {
  const tr = useTradutor();
  const d = e.documento;
  if (!d) return null;
  const z = zonas ?? zonasPadraoDaConsulta(e.variante.familia);
  const nosDados = new Set([...z.principais, ...z.adicionais]);
  const top = e.top;
  // O detalhe devolve a coluna do item como está no banco (`origem_item_id`, 0037); `item_origem_id` é só a chave do
  // CORPO do `/convert`, e nunca volta na leitura.
  const recebidoPorItem = e.itens.some((it) => typeof it["origem_item_id"] === "string" && it["origem_item_id"] !== "");
  const origem = !e.origemId
    ? (recebidoPorItem ? "Recebido de pedido" : "Lançamento direto")
    : <Link data-testid="compras-origem" className="text-brand-700 underline" href={e.rotaDaOrigem}>{e.rotuloDoPedido}{d["origem_codigo"] ? ` ${String(d["origem_codigo"])}` : ""}</Link>;
  const importacaoId = typeof d["importacao_id"] === "string" && d["importacao_id"] ? d["importacao_id"] : "";
  const pendenteDeConfirmacao = e.ehCompra && e.situacao === "aberto" && Boolean(importacaoId);
  return <>
    {pendenteDeConfirmacao && <div data-testid="compras-pendente-confirmacao" className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-950">
      <p className="font-semibold">Pendente de confirmação</p>
      <p className="mt-0.5">Compra gerada pela importação do XML — ainda aberta. Revise o que a edição aberta permite (classificação interna, observação, campos liberados). Dados da NF-e e itens travados pela nota permanecem fiéis ao XML. A confirmação (estoque e financeiro) é explícita e não ocorre ao gerar a compra.</p>
      <p className="mt-1">
        <Link className="font-medium text-brand-700 underline" data-testid="compras-revisar-importacao" href={`/compras/importacoes/${importacaoId}`}>
          Ver conferência da nota
        </Link>
      </p>
    </div>}
    {e.ehCompra && <AprovacaoDoDocumento area="compras" documentoId={String(d["id"])} documentoAberto={e.situacao === "aberto"}
      versao={versaoDoDocumento(d)} prefixoTestid={PREFIXO_CENTRAL_COMPRAS} codigo={t(d["codigo"])} />}
    {e.ehPedido && e.capacidade === "sim" && <AprovacaoDoDocumento area="compras" especie="pedido" documentoId={String(d["id"])}
      documentoAberto={e.situacao === "aberto"} versao={versaoDoDocumento(d)} prefixoTestid={PREFIXO_CENTRAL_COMPRAS} codigo={t(d["codigo"])} />}
    <ColunaDeCampos>
      <CampoLeitura rotulo="Fornecedor" adorno="pesquisa" testId="compras-consulta-fornecedor" valor={t(d["fornecedor_nome"])} />
      <CampoLeitura rotulo="Empresa" adorno="pesquisa" testId="compras-consulta-empresa" valor={t(d["empresa_nome"])} />
      <CampoLeitura rotulo={tr("termos.tipo_operacao")} adorno="travado" testId="compras-consulta-top" valor={top ? `${t(top.codigo)} — ${t(top.nome)}` : ""} />
      <CampoLeitura rotulo="Data" adorno="data" valor={dataOuVazio(d["data_documento"])} />
      {e.ehCompra && nosDados.has("data_entrada") && <CampoLeitura rotulo="Data de entrada" adorno="data" valor={dataOuVazio(d["data_entrada"])} />}
      {e.ehCompra && nosDados.has("numero_nota") && <CampoLeitura rotulo="Nota" adorno="travado" valor={t(d["numero_nota"])} />}
      {e.ehCompra && nosDados.has("serie_nota") && <CampoLeitura rotulo="Série" adorno="travado" valor={t(d["serie_nota"])} />}
      <div data-testid="compras-consulta-codigo-campo"><CampoLeitura rotulo="Número" adorno="travado" testId="compras-consulta-codigo" valor={t(d["codigo"])} /></div>
      <CampoLeitura rotulo="Observação" multilinha valor={t(d["observacao"])} />
    </ColunaDeCampos>
    <CamposExtrasDaCompra>
      <CampoLeitura rotulo="Movimento" adorno="travado" valor={tr(e.variante.chaveI18n)} />
      {top && <CampoLeitura rotulo="Versão da TOP" adorno="travado" valor={top.versao ? String(top.versao) : ""} />}
      <CampoLeitura rotulo="Origem" adorno="travado" testId="compras-consulta-origem" valor={origem} />
      {e.aprovadoOrcamento && <CampoLeitura rotulo="Aprovado para orçamento" adorno="travado" testId="compras-consulta-aprovado-orcamento" valor={quemEQuando(e.aprovadoOrcamento)} />}
      {e.finalizacao && <CampoLeitura rotulo="Finalizado" adorno="travado" testId="compras-consulta-finalizado" valor={quemEQuando(e.finalizacao)} />}
    </CamposExtrasDaCompra>
  </>;
}

/**
 * Itens salvos no motor: Lote/Validade na compra; Recebido/Saldo no pedido (quando o servidor os declara). Quantidade,
 * recebido e saldo em 4 casas — a escala da compra (`numeric(18,4)`; o servidor devolve o saldo com 4 casas).
 */
export function ItensDaConsulta({ e }: { e: EstadoDaConsulta }) {
  const d = e.documento;
  const itens = React.useMemo(() => e.itens.map(itemParaOMotor), [e.itens]);
  const colunas = React.useMemo(() => colunasDosItensDeCompras(e.variante), [e.variante]);
  if (!d) return null;
  const avisos = e.saldoEncerradoEm ? [{
    testId: "compras-saldo-encerrado",
    conteudo: <>Saldo encerrado em {dateTimeBR(e.saldoEncerradoEm)} por {t(d["saldo_encerrado_por_nome"]) || "—"}: {t(d["saldo_encerrado_motivo"]) || "—"}</>
  }] : [];
  return <div data-testid="compras-consulta-itens" className="contents">
    <ItensSalvos prefixoTestid={PREFIXO_CENTRAL_COMPRAS} colunas={colunas} itens={itens} subtotal={String(d["valor_itens"] ?? "0")}
      legenda={`Itens ${e.ehPedido ? "do pedido de compra" : "da compra"} ${t(d["codigo"])}`}
      mostrarLote={e.ehCompra} mostrarSaldo={e.recebimentoDeclarado} rotuloDoGerado="Recebido" avisos={avisos} casasDaQuantidade={4} />
  </div>;
}

const COLUNAS_DAS_COMPRAS_GERADAS: readonly ColunaDaRelacao[] = [
  { chave: "codigo", rotulo: "Código", celula: (r) => <Link className="text-brand-700 underline" data-testid="compras-gerada" href={rotaDoDocumento({ id: r["id"], especie: "compra" })}>{t(r["codigo"]) || "—"}</Link> },
  { chave: "situacao", rotulo: "Situação", celula: (r) => <Selo tom={statusTone(r["situacao"], "situacao_documento_compra")} valor={r["situacao"]}>{enumLabel("situacao_documento_compra", r["situacao"])}</Selo> }
];

/**
 * Cronograma em leitura — projeção `modeloDeParcelasParaTela` (plano / derivado / nota / títulos).
 * Confirmado: títulos reais com situação; observação do título não vem no GET — plano só como `observacaoDoPlano`.
 */
function ParcelasEmLeitura({ d, situacao }: { d: Row; situacao: string | null | undefined }) {
  const confirmado = situacao === "confirmado";
  const modelo = modeloDeParcelasParaTela({
    plano: d["plano_parcelas_operacional"] ?? d["plano_parcelas"],
    parcelasNota: d["parcelas_nota"],
    totalAmount: temValor(d["valor_total"]) ? String(d["valor_total"]) : null,
    titulos: Array.isArray(d.titulos) ? d.titulos as { due_date?: unknown; amount?: unknown; note?: unknown; installment_number?: unknown; status?: unknown; situacao?: unknown }[] : null,
    preferirTitulos: confirmado
  });
  if (modelo.especie === "vazio") {
    return <p className="text-[12px] text-slate-500" data-testid="compras-consulta-parcelas-vazio">Nenhum cronograma de pagamento gravado.</p>;
  }
  if (modelo.especie === "resumo") {
    return <div data-testid="compras-consulta-parcelas-resumo" className="space-y-1 text-[12px] text-slate-600">
      <p>{modelo.texto}</p>
      {modelo.comEntrada && <p>Com entrada.</p>}
      {modelo.primeiroVencimento && <p>Primeiro vencimento: {dataOuVazio(modelo.primeiroVencimento)}</p>}
    </div>;
  }
  return <div data-testid="compras-consulta-parcelas" className="mt-1 space-y-3">
    {modelo.linhas.map((l, k) => {
      const obs = l.observacao || (l.observacaoDoPlano
        ? <span className="text-slate-500" data-testid="compras-consulta-parcela-obs-plano" title="Do plano gravado — não é a nota do título">
            {l.observacaoDoPlano} <span className="text-[10px] text-slate-400">(plano)</span>
          </span>
        : null);
      const tipo = modelo.comEntrada && !confirmado ? (l.entrada ? "Entrada" : "Parcela") : "";
      return <div key={k} data-testid="compras-consulta-parcela" data-entrada={l.entrada ? "sim" : "nao"} data-origem={l.origem}
        className="space-y-1">
        {tipo && <p className="text-[11px] font-medium text-slate-500">{tipo}</p>}
        <ColunaDeCampos>
          <CampoLeitura rotulo="Vencimento" adorno="data" valor={dataOuVazio(l.vencimento)} />
          <CampoLeitura rotulo="Valor" valor={temValor(l.valor) ? brl(String(l.valor)) : ""} />
          <CampoLeitura rotulo="Observação" valor={obs || ""} />
          {confirmado && <CampoLeitura rotulo="Situação" valor={l.situacaoTitulo
            ? <Selo tom={statusTone(l.situacaoTitulo, "title_status")} valor={l.situacaoTitulo}>{enumLabel("title_status", l.situacaoTitulo)}</Selo>
            : ""} />}
        </ColunaDeCampos>
      </div>;
    })}
    {confirmado && <p className="text-[11px] text-slate-500" data-testid="compras-consulta-parcelas-titulos-aviso">
      {modelo.avisoObservacaoTitulos ?? "Títulos gerados (valores e situação atuais). Detalhes de baixa na aba Vínculos."}
    </p>}
    {modelo.linhas.some((l) => l.origem === "plano_derivado") && <p className="text-[11px] text-slate-500" data-testid="compras-consulta-parcelas-derivado">
      Cronograma derivado do plano gravado com a mesma regra de parcelamento do sistema (sem lista linha a linha persistida).
    </p>}
  </div>;
}

/**
 * As abas do painel da consulta — mesma finalidade da criação: Totais, Financeiro, Vínculos, Rateio e classificação,
 * Fiscal, Entrega e transporte, Observações (bens). Pedido: + Compras geradas. Sem aba Estoque.
 */
export function abasDaConsulta(e: EstadoDaConsulta, zonas?: ZonasDaCentral): AbaDoPainel[] {
  const d = e.documento;
  const z = zonas ?? zonasPadraoDaConsulta(e.variante.familia);
  const nosDados = new Set([...z.principais, ...z.adicionais]);
  const notaNaAba = e.ehCompra && CAMPOS_FISCAIS.some((c) => !nosDados.has(c));
  const comDadosFiscais = e.ehCompra && temDadosFiscais(d);
  const fiscalNaAba = notaNaAba || comDadosFiscais;
  if (!d) {
    return [
      { value: "totais", label: "Totais", content: null },
      { value: "financeiro", label: "Financeiro", content: null },
      { value: "vinculos", label: "Vínculos", content: null },
      ...(e.ehCompra ? [{ value: "rateio", label: "Rateio e classificação", content: null }] : []),
      { value: "entrega", label: "Entrega e transporte", content: null },
      ...(fiscalNaAba ? [{ value: "fiscal", label: "Fiscal", content: null }] : []),
      ...(e.ehPedido ? [{ value: "compras-geradas", label: "Compras geradas", content: null }] : []),
      { value: "observacoes", label: "Observações", content: null }
    ];
  }
  const codigo = t(d["codigo"]);
  const titulos = d.titulos ?? [];
  const abas: AbaDoPainel[] = [
    { value: "totais", label: "Totais", content: <PainelColuna>
      <CampoLeitura rotulo="Total dos produtos" valor={brl(String(d["valor_itens"] ?? "0"))} />
      <CampoLeitura rotulo="Outras despesas" valor={brl(String(d["outras_despesas"] ?? "0"))} />
      <CampoLeitura rotulo="Frete" valor={brl(String(d["frete"] ?? "0"))} />
      {temValor(d["seguro"]) && <CampoLeitura rotulo="Seguro" testId="compras-consulta-total-seguro" valor={brl(String(d["seguro"]))} />}
      <CampoLeitura rotulo="Desconto" valor={brl(String(d["desconto"] ?? "0"))} />
      {temValor(d["valor_ipi"]) && <CampoLeitura rotulo="IPI" testId="compras-consulta-total-ipi" valor={brl(String(d["valor_ipi"]))} />}
      {temValor(d["valor_icms_st"]) && <CampoLeitura rotulo="ICMS-ST" testId="compras-consulta-total-icms-st" valor={brl(String(d["valor_icms_st"]))} />}
      <div data-testid="compras-consulta-total"><CampoLeitura rotulo="Total da compra" adorno="travado" testId="central-compras-total" valor={brl(String(d["valor_total"] ?? "0"))} /></div>
    </PainelColuna> },
    { value: "financeiro", label: "Financeiro", content: (() => {
      const modeloFin = modeloDeParcelasParaTela({
        plano: d["plano_parcelas_operacional"] ?? d["plano_parcelas"], parcelasNota: d["parcelas_nota"],
        totalAmount: temValor(d["valor_total"]) ? String(d["valor_total"]) : null,
        titulos: Array.isArray(d.titulos) ? d.titulos as { due_date?: unknown; amount?: unknown; installment_number?: unknown; status?: unknown }[] : null,
        preferirTitulos: e.situacao === "confirmado"
      });
      /* Com grade de parcelas, o vencimento solto do cabeçalho não aparece (evita segundo vencimento contraditório). */
      const mostrarVencimentoSolto = modeloFin.especie !== "lista";
      return <div className="space-y-3">
        <PainelColuna>
          <CampoLeitura rotulo="Condição de pagamento" adorno="pesquisa" valor={codigoNome(d["condicao_pagamento_codigo"], d["condicao_pagamento_nome"])} />
          <CampoLeitura rotulo="Tipo de título" adorno="pesquisa" testId="compras-consulta-tipo-titulo"
            valor={t(d["tipo_titulo_nome"]) || (temValor(d["tipo_titulo_id"]) ? "Informado" : "")} />
          <CampoLeitura rotulo="Forma de pagamento" adorno="pesquisa" valor={t(d["forma_pagamento_nome"])} />
          {mostrarVencimentoSolto && <CampoLeitura rotulo="Vencimento" adorno="data" valor={dataOuVazio(d["data_vencimento"])} />}
        </PainelColuna>
        <ParcelasEmLeitura d={d} situacao={e.situacao} />
      </div>;
    })() },
    { value: "vinculos", label: "Vínculos", contador: titulos.length, content: <PainelLargo><div data-testid="compras-consulta-titulos">
      {titulos.length
        ? <TitulosDoDocumento legenda={`Contas a pagar geradas pelo documento ${codigo}`} titulos={titulos} linkDoTitulo={linkDoTituloDeCompra} />
        : <p className="text-[12px] text-slate-500" data-testid="compras-vinculos-vazio">
            {e.situacao === "aberto"
              ? "Os títulos serão gerados após a confirmação, conforme a TOP e o pagamento."
              : "Nenhum título vinculado a este documento."}
          </p>}
    </div></PainelLargo> }
  ];
  if (e.ehCompra) abas.push({
    value: "rateio", label: "Rateio e classificação",
    content: <PainelLargo>
      <div className="space-y-3">
        <RateioDaConsulta d={d} />
        <ColunaDeCampos>
          <CampoLeitura rotulo="Classificação CAPEX/OPEX" adorno="selecao" testId="compras-consulta-classificacao"
            valor={typeof d["classificacao_gasto"] === "string" && (d["classificacao_gasto"] === "capex" || d["classificacao_gasto"] === "opex")
              ? enumLabel("classificacao_gasto", d["classificacao_gasto"])
              : enumLabel("classification", "unclassified")} />
        </ColunaDeCampos>
      </div>
    </PainelLargo>
  });
  abas.push({ value: "entrega", label: "Entrega e transporte", content: <PainelColuna>
    <CampoLeitura rotulo="Transportadora" adorno="pesquisa" valor={t(d["transportadora_nome"])} />
  </PainelColuna> });
  if (fiscalNaAba) abas.push({ value: "fiscal", label: "Fiscal", content: <PainelColuna>
    {!nosDados.has("numero_nota") && <CampoLeitura rotulo="Nota" adorno="travado" valor={t(d["numero_nota"])} />}
    {!nosDados.has("serie_nota") && <CampoLeitura rotulo="Série" adorno="travado" valor={t(d["serie_nota"])} />}
    {!nosDados.has("data_entrada") && <CampoLeitura rotulo="Data de entrada" adorno="data" valor={dataOuVazio(d["data_entrada"])} />}
    {comDadosFiscais && <DadosFiscaisDaConsulta d={d} />}
  </PainelColuna> });
  if (e.ehPedido) abas.push({ value: "compras-geradas", label: "Compras geradas", contador: e.comprasGeradas?.length, content: <PainelLargo><div data-testid="compras-geradas">
    {e.comprasGeradas
      ? <Relacao legenda={`Compras geradas do pedido ${codigo}`} modelo="derivados" colunas={COLUNAS_DAS_COMPRAS_GERADAS} linhas={e.comprasGeradas as unknown as Row[]} vazio="Nenhuma compra gerada deste pedido." />
      : <p className="text-[12.5px] text-slate-500">As compras geradas não estão disponíveis nesta versão do servidor.</p>}
  </div></PainelLargo> });
  abas.push({ value: "observacoes", label: "Observações", content: <PainelLargo>
    {e.ehCompra
      ? <BensDaConsulta itens={e.itens} />
      : <p className="text-[12px] text-slate-500">A observação do documento está nos Dados principais.</p>}
  </PainelLargo> });
  return abas;
}
