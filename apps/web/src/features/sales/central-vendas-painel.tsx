"use client";
import * as React from "react";
import Link from "next/link";
import { brl, cn, dateBR } from "@/lib/utils";
import { enumLabel, statusLabel } from "@/lib/copy";
import { statusTone } from "@/components/ui";
import type { Row } from "@/features/docs/shared";
// O campo de leitura é o da Central (um só componente de campo). Quando `central-vendas-campo.tsx` existir, a
// importação passa a vir de lá — mesma assinatura (`rotulo`, `valor`, `adorno`, `testId`).
import { CampoLeitura } from "./central-vendas-consulta";
import estilos from "./central-vendas-painel.module.css";

/**
 * CENTRAL DE VENDAS — O CONTEÚDO DAS ABAS DO PAINEL INFERIOR (VISUAL-UX-02, decisão 270).
 *
 * A moldura (`central-vendas-workspace.tsx`) desenha a faixa das abas; aqui mora o que vai DENTRO delas, nos dois
 * modos, na geometria do desenho: campos numa coluna de 330px e, quando a aba tem uma relação (os títulos do
 * Financeiro), a relação à direita. Nada aqui calcula, decide ou grava: em consulta os valores chegam prontos do
 * detalhe do documento (`/api/sales/<segmento>/<id>`) — total, subtotal e plano são do SERVIDOR.
 */

/** Campos à esquerda (330px) e, à direita, a relação da aba (ex.: títulos do Financeiro). */
export function PainelRepartido({ lado, children }: { lado?: React.ReactNode; children: React.ReactNode }) {
  return <div className={estilos.repartido}>
    <div className={estilos.coluna}>{children}</div>
    {lado !== undefined && <div className={estilos.lado}>{lado}</div>}
  </div>;
}

/** Uma coluna de campos de 330px (Frete e transporte, Fiscal). */
export function PainelColuna({ children }: { children: React.ReactNode }) {
  return <div className={cn(estilos.coluna, estilos.colunaEstreita)}>{children}</div>;
}

/** Área larga (Observações): até 960px. */
export function PainelLargo({ children }: { children: React.ReactNode }) {
  return <div className={estilos.largo}>{children}</div>;
}

/**
 * O plano de parcelas EDITÁVEL da criação é o `PlanEditor` de sempre (docs/shared.tsx). Ele não é copiado nem
 * alterado: este invólucro só o põe na coluna do painel, um campo abaixo do outro, como os demais.
 */
export function PlanoNaColuna({ children }: { children: React.ReactNode }) {
  return <div className={estilos.plano}>{children}</div>;
}

type Tom = ReturnType<typeof statusTone>;
/** Situação em pílula, com a tonalidade da família (`statusTone`) e o rótulo de `enumLabel`/`statusLabel`. */
function Selo({ tom, valor, children }: { tom: Tom; valor: unknown; children: React.ReactNode }) {
  return <span className={estilos.selo} data-tom={tom} data-status={valor === null || valor === undefined ? "" : String(valor)}>{children}</span>;
}

interface ColunaDaRelacao { chave: string; rotulo: string; direita?: boolean; celula: (r: Row) => React.ReactNode }

/**
 * Uma relação do documento (títulos, derivados) na pauta do desenho: linhas de 28px, cabeçalho em negrito. As
 * linhas levam `data-testid="base2-items-linha"` — o contrato que os testes de vendas já leem desde a BASE2-03C.
 */
function Relacao({ legenda, modelo, colunas, linhas, vazio }: { legenda: string; modelo: "titulos" | "derivados"; colunas: readonly ColunaDaRelacao[]; linhas: Row[]; vazio: string }) {
  if (!linhas.length) return <p className={estilos.vazio}>{vazio}</p>;
  const linha = cn(estilos.linha, modelo === "titulos" ? estilos.linhaTitulos : estilos.linhaDerivados);
  return <div role="table" aria-label={legenda} className={estilos.relacao}>
    <div role="row" className={cn(linha, estilos.cabecalho)}>
      {colunas.map((c) => <span key={c.chave} role="columnheader" className={c.direita ? estilos.direita : undefined}>{c.rotulo}</span>)}
    </div>
    {linhas.map((r, i) => <div key={String(r["id"] ?? i)} role="row" className={linha} data-testid="base2-items-linha">
      {colunas.map((c) => <span key={c.chave} role="cell" className={c.direita ? estilos.direita : undefined}>{c.celula(r)}</span>)}
    </div>)}
  </div>;
}

const COLUNAS_TITULOS: readonly ColunaDaRelacao[] = [
  { chave: "number", rotulo: "Título", celula: (r) => <Link className={estilos.codigo} href={`/financeiro/contas-a-receber/${r["id"]}`} title={String(r["number"] ?? "")}>{String(r["number"] ?? "")}</Link> },
  { chave: "due_date", rotulo: "Vencimento", celula: (r) => dateBR(r["due_date"] as string) },
  { chave: "amount", rotulo: "Valor", direita: true, celula: (r) => brl(r["amount"] as string) },
  { chave: "balance", rotulo: "Saldo", direita: true, celula: (r) => brl(r["balance"] as string) },
  { chave: "status", rotulo: "Situação", celula: (r) => <Selo tom={statusTone(r["status"], "title_status")} valor={r["status"]}>{enumLabel("title_status", r["status"])}</Selo> }
];

const COLUNAS_DERIVADOS: readonly ColunaDaRelacao[] = [
  { chave: "kind", rotulo: "Tipo", celula: (r) => enumLabel("sales_kind", r["kind"]) },
  { chave: "code", rotulo: "Código", celula: (r) => <Link className={estilos.codigo} href={`/vendas/${r["kind"]}s/${r["id"]}`}>{String(r["code"] ?? "")}</Link> },
  { chave: "status", rotulo: "Situação", celula: (r) => <Selo tom={statusTone(r["status"])} valor={r["status"]}>{statusLabel(r["status"])}</Selo> }
];

/** Os títulos (contas a receber) vinculados ao documento — do servidor. Sem título: a frase do desenho. */
export function TitulosDoDocumento({ titulos, legenda }: { titulos: Row[]; legenda: string }) {
  return <Relacao legenda={legenda} modelo="titulos" colunas={COLUNAS_TITULOS} linhas={titulos} vazio="Nenhum título vinculado a este documento." />;
}

/** Documentos derivados (pedido e orçamento): mesma pauta dos títulos, com o link na rota da variante DELE. */
export function DerivadosDoDocumento({ derivados, legenda }: { derivados: Row[]; legenda: string }) {
  return <Relacao legenda={legenda} modelo="derivados" colunas={COLUNAS_DERIVADOS} linhas={derivados} vazio="Nenhum documento derivado." />;
}

/**
 * O PLANO GRAVADO, como o detalhe o devolve (`installment_plan`, JSON). Lido com desconfiança: o que não tem a forma
 * esperada não aparece — nunca vira um valor inventado. Sem `installments`, o documento é à vista (é o que a criação
 * grava quando não há plano: só `is_deductible`, ou nada).
 */
interface PlanoLido { installments?: unknown; first_due_date?: unknown; mode?: unknown; interval_days?: unknown; due_day?: unknown; has_down_payment?: unknown; down_payment_value?: unknown; down_payment_date?: unknown; is_deductible?: unknown }
export const lerPlano = (v: unknown): PlanoLido => (v !== null && typeof v === "object" && !Array.isArray(v) ? v as PlanoLido : {});
const inteiro = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? String(v) : "");
const data = (v: unknown) => (typeof v === "string" && v ? dateBR(v) : "");
/** Os mesmos textos das opções do editor do plano (docs/shared.tsx › PlanEditor). Modo desconhecido: nada. */
const MODO: Record<string, string> = { interval: "Por intervalo (dias)", fixed_day: "Dia fixo do mês" };

/** Financeiro da consulta, lado esquerdo: o plano em só leitura, na ordem do desenho e depois o resto do plano. */
export function PlanoEmLeitura({ plano }: { plano: unknown }) {
  const p = lerPlano(plano);
  const parcelado = typeof p.installments === "number" && p.installments > 0;
  const modo = typeof p.mode === "string" ? p.mode : "";
  const entrada = p.has_down_payment === true;
  return <>
    <CampoLeitura rotulo="Parcelamento" valor={parcelado ? "Parcelado" : "À vista"} />
    <CampoLeitura rotulo="Nº de parcelas" valor={parcelado ? inteiro(p.installments) : ""} />
    <CampoLeitura rotulo="1º vencimento" adorno="data" valor={parcelado ? data(p.first_due_date) : ""} />
    <CampoLeitura rotulo="Intervalo (dias)" valor={parcelado && modo === "interval" ? inteiro(p.interval_days) : ""} />
    {parcelado && <>
      <CampoLeitura rotulo="Modo" valor={MODO[modo] ?? ""} />
      {modo === "fixed_day" && <CampoLeitura rotulo="Dia de vencimento" valor={inteiro(p.due_day)} />}
      <CampoLeitura rotulo="Possui entrada" valor={entrada ? "Sim" : "Não"} />
      {entrada && <>
        <CampoLeitura rotulo="Valor entrada" valor={p.down_payment_value === undefined || p.down_payment_value === null ? "" : brl(String(p.down_payment_value))} />
        <CampoLeitura rotulo="Data entrada" adorno="data" valor={data(p.down_payment_date)} />
      </>}
    </>}
  </>;
}

/** "Dedutível" do documento salvo: `installment_plan.is_deductible` (é onde o servidor o grava). */
export const dedutivelDoPlano = (plano: unknown) => lerPlano(plano).is_deductible === true;
