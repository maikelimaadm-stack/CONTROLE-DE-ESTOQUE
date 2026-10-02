"use client";
import * as React from "react";
import Link from "next/link";
import { LAYOUT_DO_SISTEMA } from "@agro/domain";
import { useTradutor } from "@/lib/i18n";
import { brl, dateBR, dateTimeBR, num } from "@/lib/utils";
import { enumLabel } from "@/lib/copy";
import { statusTone } from "@/components/ui";
import type { Row } from "@/features/docs/shared";
import { CampoLeitura, ColunaDeCampos, DadosAdicionais } from "@/features/central/campo";
import { ItensSalvos } from "@/features/central/itens-salvos";
import { PainelColuna, PainelLargo, PainelRepartido, PlanoEmLeitura, Relacao, Selo, TitulosDoDocumento, type ColunaDaRelacao } from "@/features/central/painel";
import type { AbaDoPainel } from "@/features/central/contrato";
import { AprovacaoDoDocumento } from "@/features/aprovacoes/aprovacao-do-documento";
import { zonasDaCentral, type ZonasDaCentral } from "../layout-da-central";
import { rotaDoDocumento } from "../documentos-compra-list";
import { PREFIXO_CENTRAL_COMPRAS, colunasDosItensDeCompras, linkDoTituloDeCompra } from "./adaptador";
import type { EstadoDaConsulta } from "./estado";

/**
 * O CORPO DA CONSULTA DA COMPRA NO MOTOR (VISUAL-UX-04, decisão 276): Dados principais e adicionais em LEITURA, os
 * itens salvos (grade do motor) e as abas do painel. Nada aqui calcula, decide ou grava: totais, subtotal, títulos,
 * movimentos e compras geradas vêm prontos do detalhe (`/api/compras/<segmento>/<id>`). Os testids `compras-*` de
 * antes continuam no elemento equivalente.
 *
 * Fiscal (nota, série, data de entrada) só aparece como aba quando o layout NÃO os põe nos Dados — a zona vem de
 * quem chama; sem ela, a do LAYOUT_DO_SISTEMA (a consulta não carrega layout).
 */

const t = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(v));
const codigoNome = (codigo: unknown, nome: unknown) => (nome ? [codigo, nome].filter(Boolean).join(" — ") : "");
const dataOuVazio = (v: unknown) => (typeof v === "string" && v ? dateBR(v) : "");

const CAMPOS_FISCAIS = ["numero_nota", "serie_nota", "data_entrada"] as const;

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
 * Dados principais e Dados adicionais (Movimento, Versão da TOP, Origem). Na COMPRA, antes dos campos, a situação da
 * aprovação (OPERACOES-01 F2): o bloco de Aprovações, que só aparece com a compra aberta e a TOP exigindo aprovação, e
 * oferece Aprovar/Reprovar a quem tem `compras.approve`. O pedido de compra não passa por aprovação (a 0041 só aceita
 * a compra).
 */
export function DadosDaConsulta({ e, zonas }: { e: EstadoDaConsulta; zonas?: ZonasDaCentral }) {
  const tr = useTradutor();
  const [maisDados, setMaisDados] = React.useState(false);
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
  return <>
    {e.ehCompra && <AprovacaoDoDocumento area="compras" documentoId={String(d["id"])} documentoAberto={e.situacao === "aberto"}
      prefixoTestid={PREFIXO_CENTRAL_COMPRAS} codigo={t(d["codigo"])} />}
    <ColunaDeCampos>
      <CampoLeitura rotulo="Fornecedor" adorno="pesquisa" testId="compras-consulta-fornecedor" valor={t(d["fornecedor_nome"])} />
      <CampoLeitura rotulo="Empresa" adorno="pesquisa" testId="compras-consulta-empresa" valor={t(d["empresa_nome"])} />
      <CampoLeitura rotulo={tr("termos.tipo_operacao")} adorno="travado" testId="compras-consulta-top" valor={top ? `${t(top.codigo)} — ${t(top.nome)}` : ""} />
      <CampoLeitura rotulo="Data" adorno="data" valor={dataOuVazio(d["data_documento"])} />
      <CampoLeitura rotulo="Vencimento" adorno="data" valor={dataOuVazio(d["data_vencimento"])} />
      {e.ehCompra && nosDados.has("data_entrada") && <CampoLeitura rotulo="Data de entrada" adorno="data" valor={dataOuVazio(d["data_entrada"])} />}
      {e.ehCompra && nosDados.has("numero_nota") && <CampoLeitura rotulo="Nota" adorno="travado" valor={t(d["numero_nota"])} />}
      {e.ehCompra && nosDados.has("serie_nota") && <CampoLeitura rotulo="Série" adorno="travado" valor={t(d["serie_nota"])} />}
      <CampoLeitura rotulo="Condição de pagamento" adorno="pesquisa" valor={codigoNome(d["condicao_pagamento_codigo"], d["condicao_pagamento_nome"])} />
      <CampoLeitura rotulo="Forma de pagamento" adorno="pesquisa" valor={t(d["forma_pagamento_nome"])} />
      <CampoLeitura rotulo="Natureza de despesa" adorno="pesquisa" valor={codigoNome(d["categoria_financeira_codigo"], d["categoria_financeira_nome"])} />
      <CampoLeitura rotulo="Centro de resultado" adorno="pesquisa" valor={codigoNome(d["centro_custo_codigo"], d["centro_custo_nome"])} />
      <div data-testid="compras-consulta-codigo-campo"><CampoLeitura rotulo="Número" adorno="travado" testId="compras-consulta-codigo" valor={t(d["codigo"])} /></div>
    </ColunaDeCampos>
    <DadosAdicionais quantidade={top ? 3 : 2} aberto={maisDados} onAlternar={() => setMaisDados((m) => !m)} manterMontado>
      <CampoLeitura rotulo="Movimento" adorno="travado" valor={tr(e.variante.chaveI18n)} />
      {top && <CampoLeitura rotulo="Versão da TOP" adorno="travado" valor={top.versao ? String(top.versao) : ""} />}
      <CampoLeitura rotulo="Origem" adorno="travado" testId="compras-consulta-origem" valor={origem} />
    </DadosAdicionais>
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

const COLUNAS_DOS_MOVIMENTOS: readonly ColunaDaRelacao[] = [
  { chave: "movement_date", rotulo: "Data", celula: (r) => dataOuVazio(r["movement_date"]) || "—" },
  { chave: "product_name", rotulo: "Produto", celula: (r) => t(r["product_name"] ?? r["product_id"]) || "—" },
  { chave: "warehouse_name", rotulo: "Local de estoque", celula: (r) => t(r["warehouse_name"]) || "—" },
  { chave: "movement_type", rotulo: "Movimento", celula: (r) => enumLabel("stock_movement_type", r["movement_type"]) },
  { chave: "quantity", rotulo: "Quantidade", direita: true, celula: (r) => num(String(r["quantity"] ?? "0"), 4) },
  { chave: "unit_cost", rotulo: "Custo unitário", direita: true, celula: (r) => brl(String(r["unit_cost"] ?? "0")) },
  { chave: "total_cost", rotulo: "Custo total", direita: true, celula: (r) => brl(String(r["total_cost"] ?? "0")) }
];

const COLUNAS_DAS_COMPRAS_GERADAS: readonly ColunaDaRelacao[] = [
  { chave: "codigo", rotulo: "Código", celula: (r) => <Link className="text-brand-700 underline" data-testid="compras-gerada" href={rotaDoDocumento({ id: r["id"], especie: "compra" })}>{t(r["codigo"]) || "—"}</Link> },
  { chave: "situacao", rotulo: "Situação", celula: (r) => <Selo tom={statusTone(r["situacao"], "situacao_documento_compra")} valor={r["situacao"]}>{enumLabel("situacao_documento_compra", r["situacao"])}</Selo> }
];

/**
 * As abas do painel da consulta. Compra: Totais, Financeiro, Frete e transporte, Fiscal (se o layout não pôs nota,
 * série e entrada nos Dados), Estoque, Observações. Pedido: Totais, Financeiro, Frete e transporte, Compras geradas,
 * Observações. Sem documento: as abas sem conteúdo (estrutura da tela, não dado).
 */
export function abasDaConsulta(e: EstadoDaConsulta, zonas?: ZonasDaCentral): AbaDoPainel[] {
  const d = e.documento;
  const z = zonas ?? zonasPadraoDaConsulta(e.variante.familia);
  const nosDados = new Set([...z.principais, ...z.adicionais]);
  const fiscalNaAba = e.ehCompra && CAMPOS_FISCAIS.some((c) => !nosDados.has(c));
  if (!d) {
    return [
      { value: "totais", label: "Totais", content: null },
      { value: "financeiro", label: "Financeiro", content: null },
      { value: "frete", label: "Frete e transporte", content: null },
      ...(fiscalNaAba ? [{ value: "fiscal", label: "Fiscal", content: null }] : []),
      ...(e.ehCompra ? [{ value: "estoque", label: "Estoque", content: null }] : []),
      ...(e.ehPedido ? [{ value: "compras-geradas", label: "Compras geradas", content: null }] : []),
      { value: "observacoes", label: "Observações", content: null }
    ];
  }
  const codigo = t(d["codigo"]);
  const titulos = d.titulos ?? [];
  const movimentos = d.movimentos ?? [];
  const abas: AbaDoPainel[] = [
    { value: "totais", label: "Totais", content: <PainelRepartido lado={<PainelColuna>
      <CampoLeitura rotulo="Subtotal dos itens" valor={brl(String(d["valor_itens"] ?? "0"))} />
      <div data-testid="compras-consulta-total"><CampoLeitura rotulo="Total do documento" adorno="travado" testId="central-compras-total" valor={brl(String(d["valor_total"] ?? "0"))} /></div>
    </PainelColuna>}>
      <CampoLeitura rotulo="Frete" valor={brl(String(d["frete"] ?? "0"))} />
      <CampoLeitura rotulo="Outras despesas" valor={brl(String(d["outras_despesas"] ?? "0"))} />
      <CampoLeitura rotulo="Desconto" valor={brl(String(d["desconto"] ?? "0"))} />
    </PainelRepartido> },
    { value: "financeiro", label: "Financeiro", contador: titulos.length, content: <PainelRepartido lado={<div data-testid="compras-consulta-titulos">
      <TitulosDoDocumento legenda={`Contas a pagar geradas pelo documento ${codigo}`} titulos={titulos} linkDoTitulo={linkDoTituloDeCompra} />
    </div>}>
      <PlanoEmLeitura plano={d["plano_parcelas"]} />
    </PainelRepartido> },
    { value: "frete", label: "Frete e transporte", content: <PainelColuna>
      <CampoLeitura rotulo="Transportadora" adorno="pesquisa" valor={t(d["transportadora_nome"])} />
      <CampoLeitura rotulo="Frete" valor={brl(String(d["frete"] ?? "0"))} />
    </PainelColuna> }
  ];
  if (fiscalNaAba) abas.push({ value: "fiscal", label: "Fiscal", content: <PainelColuna>
    {!nosDados.has("numero_nota") && <CampoLeitura rotulo="Nota" adorno="travado" valor={t(d["numero_nota"])} />}
    {!nosDados.has("serie_nota") && <CampoLeitura rotulo="Série" adorno="travado" valor={t(d["serie_nota"])} />}
    {!nosDados.has("data_entrada") && <CampoLeitura rotulo="Data de entrada" adorno="data" valor={dataOuVazio(d["data_entrada"])} />}
  </PainelColuna> });
  if (e.ehCompra) abas.push({ value: "estoque", label: "Estoque", contador: movimentos.length, content: <PainelLargo><div data-testid="compras-consulta-movimentos">
    <Relacao legenda={`Entradas no estoque do documento ${codigo}`} modelo="derivados" colunas={COLUNAS_DOS_MOVIMENTOS} linhas={movimentos} vazio="Nenhuma entrada no estoque gerada." />
  </div></PainelLargo> });
  if (e.ehPedido) abas.push({ value: "compras-geradas", label: "Compras geradas", contador: e.comprasGeradas?.length, content: <PainelLargo><div data-testid="compras-geradas">
    {e.comprasGeradas
      ? <Relacao legenda={`Compras geradas do pedido ${codigo}`} modelo="derivados" colunas={COLUNAS_DAS_COMPRAS_GERADAS} linhas={e.comprasGeradas as unknown as Row[]} vazio="Nenhuma compra gerada deste pedido." />
      : <p className="text-[12.5px] text-slate-500">As compras geradas não estão disponíveis nesta versão do servidor.</p>}
  </div></PainelLargo> });
  abas.push({ value: "observacoes", label: "Observações", content: <PainelLargo><CampoLeitura rotulo="Observação" multilinha valor={t(d["observacao"])} /></PainelLargo> });
  return abas;
}
