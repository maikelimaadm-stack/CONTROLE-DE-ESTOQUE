"use client";
import * as React from "react";
import Link from "next/link";
import { brl, cn, dateBR } from "@/lib/utils";
import { enumLabel } from "@/lib/copy";
import { statusTone } from "@/components/ui";
import { PlanEditor, type CampoDoPlano, type ChaveDoPlano, type DesenhoDoPlano, type Row } from "@/features/docs/shared";
import type { IconeDoCampo, PropsDoPainelRepartido, PropsDoPainelSimples, PropsDoPlano, PropsDoPlanoEmLeitura, PropsDosTitulos } from "./contrato";
// O campo é o da Central: um só componente de campo, o de `campo.tsx` (leitura e edição).
import { CampoDaCentral, CampoLeitura, DataDaCentral } from "./campo";
import estilos from "./painel.module.css";

/**
 * MOTOR DA CENTRAL — O CONTEÚDO DAS ABAS DO PAINEL INFERIOR (VISUAL-UX-04, extraído da VISUAL-UX-02, decisão 270).
 *
 * A moldura (`moldura.tsx`) desenha a faixa das abas; aqui mora o que vai DENTRO delas, nos dois modos: campos numa
 * coluna de 330px e, quando a aba tem uma relação (os títulos do Financeiro), a relação à direita. Nada aqui calcula,
 * decide ou grava: em consulta os valores chegam prontos do detalhe do documento. O link de cada título vem da espécie.
 */

/** Campos à esquerda (330px) e, à direita, a relação da aba (ex.: títulos do Financeiro). */
export function PainelRepartido({ lado, children }: PropsDoPainelRepartido) {
  return <div className={estilos.repartido}>
    <div className={estilos.coluna}>{children}</div>
    {lado !== undefined && <div className={estilos.lado}>{lado}</div>}
  </div>;
}

/** Uma coluna de campos de 330px (Frete e transporte, Fiscal). */
export function PainelColuna({ children }: PropsDoPainelSimples) {
  return <div className={cn(estilos.coluna, estilos.colunaEstreita)}>{children}</div>;
}

/** Área larga (Observações): até 960px. */
export function PainelLargo({ children }: PropsDoPainelSimples) {
  return <div className={estilos.largo}>{children}</div>;
}

/**
 * O PLANO DE PARCELAS EDITÁVEL DA CRIAÇÃO (VISUAL-UX-02 Fase B, decisão 270). É o `PlanEditor` de sempre
 * (docs/shared.tsx) — nunca copiado: o plano, os controles e o que vai no corpo (`installment_plan`) são os dele. A
 * Central só passa o DESENHO opcional: a ordem da consulta (`PlanoEmLeitura`: Nº de parcelas, 1º vencimento,
 * Intervalo (dias), e depois Modo, Dia de vencimento, Possui entrada, Valor entrada, Data entrada), o rótulo
 * "Intervalo (dias)" do desenho e cada campo no `CampoDaCentral` (as duas densidades), com a data no `DataDaCentral`.
 * Cada campo leva `data-plano="<chave do plano>"` e `data-testid="central-plano-<chave>"`.
 */
const ORDEM_DO_PLANO: readonly ChaveDoPlano[] = ["installments", "first_due_date", "interval_days", "mode", "due_day", "has_down_payment", "down_payment_value", "down_payment_date"];
const ICONE_DO_PLANO: Partial<Record<ChaveDoPlano, IconeDoCampo>> = { first_due_date: "data", mode: "selecao", has_down_payment: "selecao", down_payment_date: "data" };
const campoDoPlano = (c: CampoDoPlano) =>
  <CampoDaCentral rotulo={c.rotulo} icone={ICONE_DO_PLANO[c.chave] ?? null} preenchido={c.preenchido} testId={`central-plano-${c.chave}`} data-plano={c.chave}>
    {c.data ? <DataDaCentral rotulo={c.rotulo} value={c.data.valor} onChange={c.data.definir} /> : c.controle}
  </CampoDaCentral>;
const DESENHO_DO_PLANO: DesenhoDoPlano = { ordem: ORDEM_DO_PLANO, rotulos: { interval_days: "Intervalo (dias)" }, campo: campoDoPlano };

export function PlanoDaCentral({ plano, onChange }: PropsDoPlano) {
  return <PlanEditor plan={plano} onChange={onChange} desenho={DESENHO_DO_PLANO} />;
}

export type Tom = ReturnType<typeof statusTone>;
/** Situação em pílula, com a tonalidade da família (`statusTone`) e o rótulo de `enumLabel`/`statusLabel`. */
export function Selo({ tom, valor, children }: { tom: Tom; valor: unknown; children: React.ReactNode }) {
  return <span className={estilos.selo} data-tom={tom} data-status={valor === null || valor === undefined ? "" : String(valor)}>{children}</span>;
}

export interface ColunaDaRelacao { chave: string; rotulo: string; direita?: boolean; celula: (r: Row) => React.ReactNode }

/**
 * Uma relação do documento (títulos, derivados) na pauta do desenho: linhas de 28px, cabeçalho em negrito. As
 * linhas levam `data-testid="base2-items-linha"` — o contrato que os testes já leem desde a BASE2-03C.
 */
export function Relacao({ legenda, modelo, colunas, linhas, vazio }: { legenda: string; modelo: "titulos" | "derivados"; colunas: readonly ColunaDaRelacao[]; linhas: Row[]; vazio: string }) {
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

const colunasDosTitulos = (linkDoTitulo: (titulo: Row) => string): readonly ColunaDaRelacao[] => [
  { chave: "number", rotulo: "Título", celula: (r) => <Link className={estilos.codigo} href={linkDoTitulo(r)} title={String(r["number"] ?? "")}>{String(r["number"] ?? "")}</Link> },
  { chave: "due_date", rotulo: "Vencimento", celula: (r) => dateBR(r["due_date"] as string) },
  { chave: "amount", rotulo: "Valor", direita: true, celula: (r) => brl(r["amount"] as string) },
  { chave: "balance", rotulo: "Saldo", direita: true, celula: (r) => brl(r["balance"] as string) },
  { chave: "status", rotulo: "Situação", celula: (r) => <Selo tom={statusTone(r["status"], "title_status")} valor={r["status"]}>{enumLabel("title_status", r["status"])}</Selo> }
];

/** Os títulos vinculados ao documento — do servidor; o link de cada um vem da espécie. Sem título: a frase do desenho. */
export function TitulosDoDocumento({ titulos, legenda, linkDoTitulo }: PropsDosTitulos) {
  const colunas = React.useMemo(() => colunasDosTitulos(linkDoTitulo), [linkDoTitulo]);
  return <Relacao legenda={legenda} modelo="titulos" colunas={colunas} linhas={titulos} vazio="Nenhum título vinculado a este documento." />;
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
export function PlanoEmLeitura({ plano }: PropsDoPlanoEmLeitura) {
  const p = lerPlano(plano);
  const parcelado = typeof p.installments === "number" && p.installments > 0;
  const modo = typeof p.mode === "string" ? p.mode : "";
  const entrada = p.has_down_payment === true;
  return <>
    <CampoLeitura rotulo="Parcelamento" adorno="selecao" valor={parcelado ? "Parcelado" : "À vista"} />
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
