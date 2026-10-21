"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { buildInstallments, normalizarCondicaoPagamento, planoDaCondicao, validarCondicaoPagamento, type CondicaoPagamento } from "@agro/domain";
import { api } from "@/lib/api";
import { cn, dateBR, num } from "@/lib/utils";
import { Button, Input } from "@/components/ui";
import { MgSelect } from "@/components/ui/mg-controls";
import { CampoDaCentral, ChaveSimNao, DataDaCentral } from "@/features/central/campo";
import grade from "@/features/central/grade.module.css";
import type { ParcelaDoPlano, Plan } from "@/features/docs/shared";
import type { EstadoDaCriacao } from "./estado";

/**
 * PARCELAS DA COMPRA — o pagamento na aba Financeiro (decisão do usuário, 10/2026).
 *
 * A tabela é o pagamento e está SEMPRE à vista: data, valor e observação de cada parcela. "Pela condição" mostra o
 * cronograma que o servidor vai gerar (a MESMA conta de `planoDaCondicao`, sobre a data e o total do documento) com a
 * quantidade de parcelas; "Ajustar parcelas" abre a lista linha a linha, com "Adicionar parcela" e o remover de cada
 * linha (o plano grava `parcelas` e a confirmação gera os títulos a partir dela).
 *
 * "Possui entrada?" liga a entrada: ela é a PRIMEIRA linha da lista (o cronograma inteiro, entrada incluída, é o que
 * vai no `parcelas` do plano) — por isso os campos de entrada moram na própria linha, como os das demais parcelas.
 */
/** A grade da tabela: vencimento, valor e observação na MESMA linha (decisão do usuário, 10/2026). */
const GRADE = "grid grid-cols-[124px_104px_minmax(0,1fr)_auto] items-center gap-2";

/** Uma linha da lista: a parcela e se ela é a entrada (a primeira, com "Possui entrada?" ligado). */
type LinhaDaParcela = ParcelaDoPlano & { entrada: boolean };

/** As linhas de um plano — o MESMO `buildInstallments` do servidor (entrada incluída como primeira linha). */
function linhasDoPlano(plano: Plan, total: number): LinhaDaParcela[] {
  if (!Number.isInteger(plano.installments) || plano.installments < 1 || total <= 0) return [];
  try {
    return buildInstallments({
      totalAmount: total.toFixed(2), installments: plano.installments, firstDueDate: plano.first_due_date,
      mode: plano.mode, intervalDays: plano.interval_days || 30, dueDay: plano.due_day,
      hasDownPayment: plano.has_down_payment, downPaymentValue: plano.down_payment_value || undefined,
      downPaymentDate: plano.down_payment_date || undefined
    }).map((x) => ({ vencimento: x.dueDate, valor: x.amount, entrada: x.isDownPayment }));
  } catch { return []; }
}

/** Quantas PARCELAS a lista tem — a entrada não conta como parcela. */
const contarParcelas = (linhas: readonly LinhaDaParcela[]) => linhas.filter((l) => !l.entrada).length;

export function ParcelasDaCriacao({ e }: { e: EstadoDaCriacao }) {
  const p = e.plano;
  const mudar = (novo: Partial<Plan>) => e.setPlano({ ...p, ...novo });
  const comEntrada = p.has_down_payment === true;

  /* A CONDIÇÃO escolhida, como o servidor a lê: é dela que sai o cronograma mostrado em "Pela condição". */
  const condicaoId = e.cabecalho.condicao_pagamento_id;
  const condicao = useQuery({
    queryKey: ["condicao-pagamento", condicaoId],
    queryFn: () => api<Record<string, unknown>>(`/api/resources/condicoes_pagamento/${encodeURIComponent(condicaoId)}`),
    enabled: Boolean(condicaoId) && !e.ajustarParcelas
  });
  const planoDaCondicaoEscolhida = React.useMemo<Plan | null>(() => {
    const r = condicao.data;
    if (!r || !condicaoId || e.ajustarParcelas) return null;
    try {
      const c = normalizarCondicaoPagamento({
        parcelas: Number(r["parcelas"]), dias_primeira_parcela: Number(r["dias_primeira_parcela"]), modo: r["modo"] as CondicaoPagamento["modo"],
        intervalo_dias: Number(r["intervalo_dias"]), dia_vencimento: r["dia_vencimento"] === null || r["dia_vencimento"] === undefined ? null : Number(r["dia_vencimento"]),
        entrada: r["entrada"] === true, entrada_percentual: (r["entrada_percentual"] ?? null) as CondicaoPagamento["entrada_percentual"]
      });
      if (validarCondicaoPagamento(c).length) return null;
      return planoDaCondicao(c, { dataDocumento: e.cabecalho.data_documento, total: e.totalExibido }) as Plan;
    } catch { return null; }
  }, [condicao.data, condicaoId, e.ajustarParcelas, e.cabecalho.data_documento, e.totalExibido]);

  /* A lista EDITÁVEL ("Ajustar parcelas"): o que foi escrito à mão; sem linhas, as do plano. */
  const doPlano = React.useMemo(() => linhasDoPlano(p, e.totalExibido), [p, e.totalExibido]);
  const linhas: LinhaDaParcela[] = (p.parcelas ?? doPlano).map((l, k) => ({ ...l, entrada: comEntrada && k === 0 }));

  /* A lista PELA CONDIÇÃO: o cronograma do servidor; sem condição escolhida, à vista (uma parcela no vencimento). */
  const previstas: LinhaDaParcela[] = React.useMemo(() => {
    if (planoDaCondicaoEscolhida) return linhasDoPlano(planoDaCondicaoEscolhida, e.totalExibido);
    const vencimento = e.cabecalho.data_vencimento || e.cabecalho.data_documento;
    return e.totalExibido > 0 && vencimento ? [{ vencimento, valor: e.totalExibido.toFixed(2), entrada: false }] : [];
  }, [planoDaCondicaoEscolhida, e.totalExibido, e.cabecalho.data_vencimento, e.cabecalho.data_documento]);

  /** A lista passa a ser a do plano: o número de parcelas e o 1º vencimento acompanham, e a entrada com ela. */
  const definir = (novas: LinhaDaParcela[], temEntrada = comEntrada) => {
    const primeira = novas[0]?.vencimento || p.first_due_date;
    mudar({
      parcelas: novas.length ? novas.map(({ vencimento, valor, observacao }) => ({ vencimento, valor, observacao })) : undefined,
      installments: Math.max(1, novas.length), first_due_date: primeira,
      has_down_payment: temEntrada && novas.length > 0,
      down_payment_value: temEntrada ? novas[0]?.valor || undefined : undefined,
      down_payment_date: temEntrada ? novas[0]?.vencimento || undefined : undefined
    });
  };
  const mudarLinha = (k: number, campo: keyof ParcelaDoPlano, valor: string) =>
    definir(linhas.map((l, j) => (j === k ? { ...l, [campo]: valor } : l)));

  /** Ligar a entrada exige o plano no corpo (é nele que a entrada vive) e a põe como PRIMEIRA linha da lista. */
  const mudarEntrada = (ligada: boolean) => {
    if (!ligada) { definir(linhas.slice(comEntrada ? 1 : 0), false); return; }
    e.setAjustarParcelas(true);
    definir([{ vencimento: p.first_due_date || e.cabecalho.data_documento, valor: "", observacao: "Entrada", entrada: true }, ...linhas], true);
  };
  const remover = (k: number) => {
    if (k === 0 && comEntrada) { definir(linhas.slice(1), false); return; }
    definir(linhas.filter((_, j) => j !== k));
  };

  const somaLinhas = e.ajustarParcelas ? linhas : previstas;
  const soma = somaLinhas.reduce((a, l) => a + Number(l.valor || 0), 0);
  const foraDoTotal = Math.abs(soma - e.totalExibido) > 0.005;
  const quantidade = contarParcelas(somaLinhas);

  return <>
    <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
      <div className="w-[260px]"><ChaveSimNao rotulo="Possui entrada?" valor={comEntrada} onChange={mudarEntrada} testId="compras-possui-entrada" /></div>
      <div className="w-[300px]"><CampoDaCentral rotulo="Parcelas" icone="selecao" preenchido testId="compras-parcelas-campo">
        <MgSelect data-testid="compras-parcelas" value={e.ajustarParcelas ? "ajustar" : "padrao"}
          onChange={(v) => e.setAjustarParcelas(v === "ajustar")}
          options={[{ value: "padrao", label: "Pela condição (ou à vista)" }, { value: "ajustar", label: "Ajustar parcelas" }]} />
      </CampoDaCentral></div>
    </div>

    <div data-testid="compras-parcelas-lista" className="mt-1 divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200">
      <div aria-hidden className={GRADE + " border-b border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-500"}>
        <span>vencimento</span><span>valor</span><span>observação</span><span />
      </div>

      {!e.ajustarParcelas && <>
        {previstas.length === 0 && <p className="px-2 py-2 text-[12px] text-slate-500">Escolha a condição de pagamento para ver as parcelas.</p>}
        {previstas.map((l, k) => <div key={k} data-testid="compras-parcela" data-entrada={l.entrada ? "true" : undefined} className={GRADE + " px-2 py-1.5 text-[12px]"}>
          <span className="text-slate-700">{dateBR(l.vencimento)}</span>
          <span className="tabular-nums text-slate-900">{num(l.valor, 2)}</span>
          <span className="text-slate-500">{l.entrada ? "entrada" : "—"}</span>
          <span />
        </div>)}
      </>}

      {e.ajustarParcelas && <>
        {linhas.length === 0 && <p className="px-2 py-2 text-[12px] text-slate-500">Nenhuma parcela. Use “Adicionar parcela”.</p>}
        {linhas.map((l, k) => <div key={k} data-testid="compras-parcela" data-entrada={l.entrada ? "true" : undefined} className={GRADE + " px-2 py-1.5"}>
          <DataDaCentral className="mg-input" rotulo={l.entrada ? "Vencimento da entrada" : `Vencimento da parcela ${k + 1}`} value={l.vencimento} onChange={(v) => mudarLinha(k, "vencimento", v)} />
          <Input className="min-w-0" data-testid={`compras-parcela-valor-${k}`} type="number" step="0.01" min="0" inputMode="decimal"
            placeholder="0,00" value={l.valor} onChange={(ev) => mudarLinha(k, "valor", ev.target.value)} />
          <Input className="min-w-0" data-testid={`compras-parcela-observacao-${k}`} value={l.observacao ?? ""} maxLength={500}
            placeholder={l.entrada ? "Entrada" : "Observação"} onChange={(ev) => mudarLinha(k, "observacao", ev.target.value)} />
          <Button size="sm" variant="ghost" className="!h-6 !w-6 !min-h-6 !p-0 justify-self-end text-slate-400 hover:text-rose-600"
            data-testid={`compras-parcela-remover-${k}`} aria-label={l.entrada ? "Remover entrada" : `Remover parcela ${k + 1}`} title={l.entrada ? "Remover entrada" : "Remover parcela"}
            onClick={() => remover(k)}><X className="h-3.5 w-3.5" aria-hidden /></Button>
        </div>)}
      </>}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1 text-[12px]">
        {e.ajustarParcelas && <button type="button" className={cn(grade.botao, grade.botaoAdicionar)} aria-label="Adicionar parcela" title="Adicionar parcela"
          data-testid="compras-parcela-adicionar" disabled={linhas.length >= 120}
          onClick={() => definir([...linhas, { vencimento: "", valor: "", observacao: "", entrada: false }])}><Plus aria-hidden /></button>}
        <span data-testid="compras-parcelas-quantidade" className="text-slate-600">{quantidade} {quantidade === 1 ? "parcela" : "parcelas"}</span>
        <span data-testid="compras-parcelas-soma" className={cn("ml-auto", foraDoTotal ? "text-amber-700" : "text-slate-600")}>
          Soma: {num(soma, 2)}{foraDoTotal ? ` (deve fechar o total: ${num(e.totalExibido, 2)})` : ""}
        </span>
      </div>
    </div>
  </>;
}
