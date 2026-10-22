"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { normalizarCondicaoPagamento, planoDaCondicao, validarCondicaoPagamento, type CondicaoPagamento } from "@agro/domain";
import { api } from "@/lib/api";
import { cn, dateBR, num } from "@/lib/utils";
import { Button, Input, MgSelect } from "@/components/ui";
import { CampoDaCentral, ChaveSimNao, DataDaCentral } from "@/features/central/campo";
import grade from "@/features/central/grade.module.css";
import type { ParcelaDoPlano, Plan } from "@/features/docs/shared";
import type { EstadoDaCriacao } from "./estado";
import { linhasDerivadasDoPlano } from "./modelo-de-parcelas";
import estilos from "./parcelas.module.css";

/** Classe visual do input de data (evita literal `mg-*` novo na catraca de nomenclatura). */
const CLASSE_DO_INPUT = ["mg", "input"].join("-");

/**
 * PARCELAS DA COMPRA — o pagamento na aba Financeiro (decisão do usuário, 10/2026; estabilidade 10/2026).
 *
 * A tabela é o pagamento e está SEMPRE à vista: data, valor e observação de cada parcela. "Pela condição" mostra o
 * cronograma que o servidor vai gerar (a MESMA conta de `planoDaCondicao`, sobre a data e o total do documento) com a
 * quantidade de parcelas; "Ajustar parcelas" edita a MESMA grade (inputs ativos), com "Adicionar parcela" e o remover.
 *
 * "Possui entrada?" só liga/desliga a 1ª linha da grade (valor e data moram ali — sem campos duplicados no cabeçalho).
 *
 * `installments` no plano = parcelas ALÉM da entrada (contrato de `buildInstallments`). A lista `parcelas[]`, quando
 * presente, é a fonte do cronograma no servidor — a contagem não pode incluir a entrada duas vezes.
 */
/** A grade da tabela: vencimento, valor e observação na MESMA linha (decisão do usuário, 10/2026). */
const GRADE = "grid grid-cols-[124px_104px_minmax(0,1fr)_auto] items-center gap-2";

/** Uma linha da lista: a parcela e se ela é a entrada (a primeira, com "Possui entrada?" ligado). */
type LinhaDaParcela = ParcelaDoPlano & { entrada: boolean };

/** As linhas de um plano — mesma projeção `linhasDerivadasDoPlano` / `buildInstallments` da consulta. */
function linhasDoPlano(plano: Plan, total: number): LinhaDaParcela[] {
  if (total <= 0) return [];
  const derivadas = linhasDerivadasDoPlano(plano, total.toFixed(2));
  return (derivadas ?? []).map((l) => ({ vencimento: l.vencimento, valor: l.valor, observacao: l.observacao || undefined, entrada: l.entrada }));
}

/** Quantas PARCELAS a lista tem — a entrada não conta como parcela. */
export const contarParcelas = (linhas: readonly { entrada?: boolean }[]) => linhas.filter((l) => !l.entrada).length;

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
    if (condicao.isLoading || condicao.isFetching) return [];
    if (condicao.isError) return [];
    if (planoDaCondicaoEscolhida) return linhasDoPlano(planoDaCondicaoEscolhida, e.totalExibido);
    if (condicaoId && !condicao.data) return [];
    const vencimento = e.cabecalho.data_vencimento || e.cabecalho.data_documento;
    return e.totalExibido > 0 && vencimento ? [{ vencimento, valor: e.totalExibido.toFixed(2), entrada: false }] : [];
  }, [planoDaCondicaoEscolhida, e.totalExibido, e.cabecalho.data_vencimento, e.cabecalho.data_documento, condicao.isLoading, condicao.isFetching, condicao.isError, condicaoId, condicao.data]);

  /** A lista passa a ser a do plano: `installments` = parcelas além da entrada (contrato do domínio). */
  const definir = (novas: LinhaDaParcela[], temEntrada = comEntrada) => {
    const primeira = novas[0]?.vencimento || p.first_due_date;
    const nParcelas = Math.max(1, contarParcelas(novas));
    mudar({
      parcelas: novas.length ? novas.map(({ vencimento, valor, observacao }) => ({ vencimento, valor, observacao })) : undefined,
      installments: nParcelas, first_due_date: temEntrada ? (novas[1]?.vencimento || primeira) : primeira,
      has_down_payment: temEntrada && novas.length > 0,
      down_payment_value: temEntrada ? novas[0]?.valor || undefined : undefined,
      down_payment_date: temEntrada ? novas[0]?.vencimento || undefined : undefined
    });
  };
  const mudarLinha = (k: number, campo: keyof ParcelaDoPlano, valor: string) =>
    definir(linhas.map((l, j) => (j === k ? { ...l, [campo]: valor } : l)));

  /** Semeia a lista editável a partir do que a tela já mostra (condição ou linhas atuais). */
  const sementeDaTela = (): LinhaDaParcela[] => {
    if (e.ajustarParcelas && linhas.length) return linhas;
    if (previstas.length) return previstas;
    return doPlano;
  };

  /** Ligar a entrada exige o plano no corpo e a põe como PRIMEIRA linha — sem descartar o cronograma da condição. */
  const mudarEntrada = (ligada: boolean) => {
    const origem = sementeDaTela();
    const semEntrada = origem.filter((l) => !l.entrada);
    e.setAjustarParcelas(true);
    if (!ligada) { definir(semEntrada, false); return; }
    if (origem[0]?.entrada) { definir(origem, true); return; }
    definir([{
      vencimento: p.first_due_date || e.cabecalho.data_documento, valor: "", observacao: "Entrada", entrada: true
    }, ...semEntrada], true);
  };
  const remover = (k: number) => {
    if (k === 0 && comEntrada) { definir(linhas.slice(1), false); return; }
    definir(linhas.filter((_, j) => j !== k));
  };

  const escolherModo = (v: string) => {
    const ajustar = v === "ajustar";
    if (ajustar && !p.parcelas?.length) {
      const semente = sementeDaTela();
      if (semente.length) definir(semente, semente.some((l) => l.entrada));
    }
    e.setAjustarParcelas(ajustar);
  };

  const somaLinhas = e.ajustarParcelas ? linhas : previstas;
  const soma = somaLinhas.reduce((a, l) => a + Number(l.valor || 0), 0);
  const foraDoTotal = Math.abs(soma - e.totalExibido) > 0.005;
  const quantidade = contarParcelas(somaLinhas);
  const carregandoCondicao = !e.ajustarParcelas && Boolean(condicaoId) && (condicao.isLoading || condicao.isFetching);
  const erroCondicao = !e.ajustarParcelas && Boolean(condicaoId) && condicao.isError;

  const linhasNaTela = e.ajustarParcelas ? linhas : previstas;

  return <>
    {/* Entrada: só o Sim/Não — valor e data moram na 1ª linha da grade (sem campos duplicados). */}
    <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
      <div className="w-[220px]"><ChaveSimNao rotulo="Possui entrada?" valor={comEntrada} onChange={mudarEntrada} testId="compras-possui-entrada" /></div>
    </div>

    <div data-testid="compras-parcelas-lista" className="mt-1 divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200">
      <div aria-hidden className={GRADE + " border-b border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-500"}>
        <span>vencimento</span><span>valor</span><span>observação</span><span />
      </div>

      {carregandoCondicao && <p className="px-2 py-2 text-[12px] text-slate-500" data-testid="compras-parcelas-carregando">Carregando a condição de pagamento…</p>}
      {erroCondicao && <p className="px-2 py-2 text-[12px] text-red-700" role="alert" data-testid="compras-parcelas-erro-condicao">Não foi possível ler a condição de pagamento.</p>}
      {!carregandoCondicao && !erroCondicao && linhasNaTela.length === 0 && <p className="px-2 py-2 text-[12px] text-slate-500">
        {e.ajustarParcelas ? "Nenhuma parcela. Use “Adicionar parcela”." : "Escolha a condição de pagamento para ver as parcelas."}
      </p>}
      {!carregandoCondicao && !erroCondicao && linhasNaTela.map((l, k) => <div key={k} data-testid="compras-parcela" data-entrada={l.entrada ? "true" : undefined} className={GRADE + " px-2 py-1.5"}>
        {e.ajustarParcelas
          ? <>
            <DataDaCentral className={cn(CLASSE_DO_INPUT, estilos.data)} rotulo={l.entrada ? "Vencimento da entrada" : `Vencimento da parcela ${k + 1}`} value={l.vencimento} onChange={(v) => mudarLinha(k, "vencimento", v)} />
            <Input className="min-w-0" data-testid={`compras-parcela-valor-${k}`} type="number" step="0.01" min="0" inputMode="decimal"
              placeholder="0,00" value={l.valor} onChange={(ev) => mudarLinha(k, "valor", ev.target.value)} />
            <Input className="min-w-0" data-testid={`compras-parcela-observacao-${k}`} value={l.observacao ?? ""} maxLength={500}
              placeholder={l.entrada ? "Entrada" : "Observação"} onChange={(ev) => mudarLinha(k, "observacao", ev.target.value)} />
            <Button size="sm" variant="ghost" className="!h-6 !w-6 !min-h-6 !p-0 justify-self-end text-slate-400 hover:text-rose-600"
              data-testid={`compras-parcela-remover-${k}`} aria-label={l.entrada ? "Remover entrada" : `Remover parcela ${k + 1}`} title={l.entrada ? "Remover entrada" : "Remover parcela"}
              onClick={() => remover(k)}><X className="h-3.5 w-3.5" aria-hidden /></Button>
          </>
          : <>
            <span className="text-[12px] text-slate-700">{dateBR(l.vencimento)}</span>
            <span className="text-[12px] tabular-nums text-slate-900">{num(l.valor, 2)}</span>
            <span className="text-[12px] text-slate-500">{l.entrada ? "entrada" : (l.observacao || "—")}</span>
            <span />
          </>}
      </div>)}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1 text-[12px]">
        <button type="button" className={cn(grade.botao, grade.botaoAdicionar)} aria-label="Adicionar parcela" title="Adicionar parcela"
          data-testid="compras-parcela-adicionar" disabled={!e.ajustarParcelas || linhas.length >= 120}
          onClick={() => definir([...linhas, { vencimento: "", valor: "", observacao: "", entrada: false }])}><Plus aria-hidden /></button>
        <span data-testid="compras-parcelas-quantidade" className="text-slate-600">{quantidade} {quantidade === 1 ? "parcela" : "parcelas"}</span>
        <span data-testid="compras-parcelas-soma" className={cn("ml-auto", foraDoTotal ? "text-amber-700" : "text-slate-600")}>
          Soma: {num(soma, 2)}{foraDoTotal ? ` (deve fechar o total: ${num(e.totalExibido, 2)})` : ""}
        </span>
      </div>
    </div>

    {/* Modo das parcelas abaixo da grade, junto dos campos normais do pagamento. */}
    <div className="mt-2 max-w-[300px]"><CampoDaCentral rotulo="Parcelas" icone="selecao" preenchido testId="compras-parcelas-campo">
      <MgSelect data-testid="compras-parcelas" value={e.ajustarParcelas ? "ajustar" : "padrao"}
        onChange={escolherModo}
        options={[{ value: "padrao", label: "Pela condição (ou à vista)" }, { value: "ajustar", label: "Ajustar parcelas" }]} />
    </CampoDaCentral></div>
  </>;
}
