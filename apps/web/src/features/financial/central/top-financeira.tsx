"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { Field, NativeSelect } from "@/components/ui";
import { useFinanceiroPelaTop } from "./capacidade";

/**
 * A TOP FINANCEIRA NO LANÇAMENTO (OPERACOES-01 F9, decisão 286). O lançamento avulso da Central (conta a pagar e a
 * receber) e o "Novo movimento bancário" escolhem a TOP PRIMEIRO, e ela preenche os padrões dela: o tipo de título, a
 * conta (a prevista no título; a do movimento) e a natureza e o centro de resultado da 1ª linha do rateio.
 *
 * A LISTA é do SERVIDOR (`GET /api/financeiro/tops?direcao=pagar|receber|movimento`): as TOPs ativas da família do
 * lançamento, na versão corrente, a padrão primeiro, cada uma com a seção `financeiroPadrao` e os padrões (com o nome).
 * Só sai com `financeiroPelaTop` declarado — sem a capacidade, nenhum pedido (skew sentido 1).
 *
 * "O documento pode trocar os padrões" DESLIGADO (`documentoTroca: false`) TRAVA na tela os campos que a TOP tem. É
 * apresentação: quem recusa a troca é o servidor (422 com os campos). Sem TOP escolhida, o lançamento segue sem
 * operação, exatamente como hoje — a escolha nunca é automática (nem a TOP padrão), para o corpo de hoje continuar
 * sendo o que sai quando ninguém escolhe nada.
 */
export type DirecaoDaTop = "pagar" | "receber" | "movimento";

/** Um cadastro padrão como a API o devolve (natureza e centro com código; conta com código e descrição). */
export interface PadraoComCodigo { id: string; codigo: string; nome: string }
export interface TopFinanceira {
  id: string; codigo: string; nome: string; versao: number; versaoId: string; padrao: boolean;
  secao: { provisao: boolean; documentoTroca: boolean; semClassificacao: string };
  padroes: {
    natureza: PadraoComCodigo | null; centro: PadraoComCodigo | null;
    tipoTitulo: { id: string; nome: string } | null; formaPagamento: { id: string; nome: string } | null;
    conta: { id: string; codigo: string; descricao: string } | null;
  };
}

/** As TOPs da família do lançamento (só com a capacidade; sem ela, a consulta nem existe). */
export function useTopsFinanceiras(direcao: DirecaoDaTop) {
  const pelaTop = useFinanceiroPelaTop();
  return useQuery({
    queryKey: ["financeiro-tops", direcao],
    enabled: pelaTop,
    retry: false,
    staleTime: 60_000,
    queryFn: () => api<{ itens: TopFinanceira[] }>(`/api/financeiro/tops${qs({ direcao })}`)
  });
}

/** Os padrões que a TOP TRAVA: só os que ela tem, e só com a troca desligada. Sem TOP, nada travado. */
export interface TravaDaTop { natureza: string | null; centro: string | null; tipoTitulo: string | null; conta: string | null }
const SEM_TRAVA: TravaDaTop = Object.freeze({ natureza: null, centro: null, tipoTitulo: null, conta: null });

export function travaDaTop(top: TopFinanceira | null): TravaDaTop {
  if (!top || top.secao.documentoTroca) return SEM_TRAVA;
  const p = top.padroes;
  return { natureza: p.natureza?.id ?? null, centro: p.centro?.id ?? null, tipoTitulo: p.tipoTitulo?.id ?? null, conta: p.conta?.id ?? null };
}

/** Uma linha de rateio de qualquer formulário (em R$ ou em %): o que a TOP preenche e trava é a natureza e o centro. */
interface LinhaComClassificacao { financial_category_id: string; cost_center_id: string }

/**
 * A natureza e o centro TRAVADOS em TODAS as linhas: a linha nova nasce com eles e a troca numa linha volta ao padrão
 * (o servidor recusa qualquer linha diferente). Sem trava, as linhas passam como estão.
 */
export function linhasComATrava<L extends LinhaComClassificacao>(linhas: L[], t: TravaDaTop): L[] {
  if (!t.natureza && !t.centro) return linhas;
  return linhas.map((l) => ({ ...l, financial_category_id: t.natureza ?? l.financial_category_id, cost_center_id: t.centro ?? l.cost_center_id }));
}

/** Escolher a TOP aplica a natureza e o centro dela na 1ª linha — só os que ela tem; o resto fica como o usuário deixou. */
export function primeiraLinhaComOsPadroes<L extends LinhaComClassificacao>(linhas: L[], top: TopFinanceira): L[] {
  const natureza = top.padroes.natureza?.id ?? null; const centro = top.padroes.centro?.id ?? null;
  if (!natureza && !centro) return linhas;
  return linhas.map((l, i) => (i === 0 ? { ...l, financial_category_id: natureza ?? l.financial_category_id, cost_center_id: centro ?? l.cost_center_id } : l));
}

/** O aviso do rateio travado: o que a operação fixa em todas as linhas. */
export function textoDoRateioTravado(t: TravaDaTop): string | null {
  if (t.natureza && t.centro) return "A operação fixa a natureza e o centro de resultado de todas as linhas do rateio.";
  if (t.natureza) return "A operação fixa a natureza de todas as linhas do rateio.";
  if (t.centro) return "A operação fixa o centro de resultado de todas as linhas do rateio.";
  return null;
}

/**
 * O SELETOR DA TOP (o primeiro campo do lançamento). Vazio = "Sem tipo de operação" (o lançamento de hoje). Família
 * sem TOP ativa: o aviso `fin-sem-top` no lugar do campo. TOP com a troca desligada: o aviso `fin-padroes-travados`.
 * O campo, a ajuda e os avisos são células de uma grade de 12 colunas (quem usa põe o seletor numa `grid-cols-12`).
 */
export function SeletorDeTopFinanceira({ direcao, valor, onChange, testId }: {
  direcao: DirecaoDaTop; valor: string | null; onChange: (top: TopFinanceira | null) => void; testId: string;
}) {
  const q = useTopsFinanceiras(direcao);
  const itens = q.data?.itens ?? [];
  const escolhida = valor ? itens.find((t) => t.id === valor) ?? null : null;
  if (q.isSuccess && itens.length === 0) {
    return <p className="col-span-12 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600" data-testid="fin-sem-top">Nenhum tipo de operação ativo para este lançamento: ele segue sem operação.</p>;
  }
  return <>
    <Field label="Tipo de operação" span={6} help="Escolha primeiro a operação: ela preenche os padrões." error={q.error ? (q.error as Error).message : undefined}>
      <NativeSelect data-testid={testId} value={valor ?? ""} disabled={q.isLoading} onChange={(e) => onChange(itens.find((t) => t.id === e.target.value) ?? null)}>
        <option value="">{q.isLoading ? "Carregando…" : "Sem tipo de operação"}</option>
        {itens.map((t) => <option key={t.id} value={t.id}>{`${t.codigo} — ${t.nome}`}</option>)}
      </NativeSelect>
    </Field>
    {/* A ajuda é a do campo (uma só); a célula vazia fecha a linha da grade, para o próximo campo começar embaixo. */}
    <div aria-hidden="true" className="hidden md:col-span-6 md:block" />
    {escolhida && !escolhida.secao.documentoTroca && <p className="col-span-12 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800" data-testid="fin-padroes-travados">Esta operação não deixa trocar os padrões.</p>}
  </>;
}
