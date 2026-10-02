"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { Field, NativeSelect } from "@/components/ui";
import { useLcdpr } from "./capacidade";

/**
 * O IMÓVEL RURAL DO LCDPR NO LANÇAMENTO DE CAIXA (OPERACOES-01 F9, decisão 286): a baixa bancária do título e o
 * movimento bancário de entrada ou saída levam o imóvel do livro caixa.
 *
 * As OPÇÕES são do servidor (`GET /api/financeiro/imoveis-rurais/opcoes?empresa_id=`): os imóveis ativos da EMPRESA do
 * lançamento, o padrão primeiro. Só saem com `capacidades.lcdpr` declarado — sem ela, nem o campo nem o pedido existem.
 *
 * O VALOR tem três estados, e o terceiro importa para o skew e para a falha da consulta:
 *   · `undefined` — ainda não decidido: o corpo NÃO leva a chave e o servidor aplica o imóvel padrão da empresa;
 *   · `null`      — "Sem imóvel" escolhido: o lançamento fica fora do imóvel (pendência na conferência);
 *   · um id       — o imóvel escolhido (o servidor confere a empresa).
 * Carregadas as opções, o campo PRÉ-SELECIONA o padrão da empresa (ou "Sem imóvel", se ela não tem padrão) — o mesmo
 * que o servidor faria —, e o usuário vê o que vai ser gravado antes de confirmar.
 */
export interface ImovelRuralOpcao { id: string; nome: string; cib: string | null; padrao: boolean }

export function useImoveisRurais(empresaId: string | null | undefined) {
  const lcdpr = useLcdpr();
  return useQuery({
    queryKey: ["financeiro-imoveis-rurais", empresaId ?? null],
    enabled: lcdpr && Boolean(empresaId),
    retry: false,
    staleTime: 60_000,
    queryFn: () => api<{ itens: ImovelRuralOpcao[] }>(`/api/financeiro/imoveis-rurais/opcoes${qs({ empresa_id: empresaId })}`)
  });
}

/** O rótulo da opção: o nome e, quando há, o CIB (o código do imóvel no ITR). */
export const rotuloDoImovel = (i: { nome: string; cib: string | null }) => `${i.nome}${i.cib ? ` (CIB ${i.cib})` : ""}`;

export function CampoImovelRural({ empresaId, valor, onChange, testId, span = 4 }: {
  empresaId: string | null | undefined; valor: string | null | undefined; onChange: (v: string | null) => void; testId: string; span?: number;
}) {
  const q = useImoveisRurais(empresaId);
  const itens = q.data?.itens;
  // A pré-seleção: só enquanto ninguém decidiu (valor `undefined`) e só com as opções DESTA empresa carregadas.
  React.useEffect(() => {
    if (valor !== undefined || !itens) return;
    onChange(itens.find((i) => i.padrao)?.id ?? null);
  }, [valor, itens, onChange]);
  return <Field label="Imóvel rural (LCDPR)" span={span} help="O imóvel do livro caixa: vem o padrão da empresa. Sem imóvel, o lançamento fica como pendência na conferência do LCDPR." error={q.error ? (q.error as Error).message : undefined}>
    <NativeSelect data-testid={testId} value={valor ?? ""} disabled={!empresaId || q.isLoading} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{q.isLoading ? "Carregando…" : "Sem imóvel"}</option>
      {(itens ?? []).map((i) => <option key={i.id} value={i.id}>{rotuloDoImovel(i)}</option>)}
    </NativeSelect>
  </Field>;
}
