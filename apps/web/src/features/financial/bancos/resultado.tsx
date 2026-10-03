"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { D } from "@agro/shared";
import { rotuloFinanceiro } from "@agro/domain";
import { api, qs } from "@/lib/api";
import { brl, dateBR, monthStartISO, todayISO } from "@/lib/utils";
import { Card, CardBody, ErrorState, Field, Input, LoadingState, NativeSelect, Stat } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { DataTable, colSpanAteColuna, colSpanAposColuna, type Column } from "@/components/ui/data-table";

/**
 * FLUXO E RESULTADO › RESULTADO (DRE gerencial) (OPERACOES-01 F8, decisão 285). Por grupo de natureza — Receitas,
 * Deduções, Custos, Despesas, Investimentos —, por COMPETÊNCIA (títulos pela competência ou emissão, movimentos
 * avulsos, componentes da baixa e descontos) ou por CAIXA (movimentos confirmados pela data). A montagem é do domínio,
 * no servidor; os valores chegam com sinal (+ receita, − despesa) e a tela só apresenta.
 */

type Regime = "competencia" | "caixa";
interface Dre {
  grupos: { grupo: string; total: string; naturezas: { id: string; codigo: string; nome: string; total: string }[] }[];
  receitaLiquida: string; resultadoOperacional: string; investimentos: string; resultadoFinal: string; regime: Regime; de: string; ate: string;
}
interface LinhaDre extends Record<string, unknown> { chave: string; nivel: "grupo" | "natureza"; rotulo: string; codigo: string; total: string }

const cor = (v: string) => D(v).isNegative() ? "text-red-700" : "text-green-700";

export function ResultadoDre() {
  const [f, setF] = React.useState<{ de: string; ate: string; regime: Regime; empresa: string }>({ de: monthStartISO(), ate: todayISO(), regime: "competencia", empresa: "" });
  const periodoInvalido = !f.de || !f.ate || f.de > f.ate;
  const q = useQuery({
    queryKey: ["financeiro-resultado", f],
    queryFn: () => api<Dre>(`/api/financeiro/resultado${qs({ de: f.de, ate: f.ate, regime: f.regime, empresa_id: f.empresa })}`),
    enabled: !periodoInvalido
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((o) => ({ ...o, [k]: v }));
  const d = q.data;
  // Grupo e as naturezas dele, numa lista só (a grade é a mesma; a linha diz o nível).
  const linhas = React.useMemo<LinhaDre[]>(() => (d?.grupos ?? []).flatMap((g) => [
    { chave: `g:${g.grupo}`, nivel: "grupo" as const, rotulo: rotuloFinanceiro("grupo_dre", g.grupo), codigo: "", total: g.total },
    ...g.naturezas.map((n) => ({ chave: `n:${g.grupo}:${n.id}`, nivel: "natureza" as const, rotulo: n.nome, codigo: n.codigo, total: n.total }))
  ]), [d]);
  const colunas = React.useMemo<Column<LinhaDre>[]>(() => [
    { key: "rotulo", label: "Grupo e natureza", render: (r) => r.nivel === "grupo" ? <b data-testid="fin-dre-grupo">{r.rotulo}</b> : <span className="pl-4">{r.codigo ? `${r.codigo} — ` : ""}{r.rotulo}</span>, text: (r) => r.nivel === "grupo" ? r.rotulo : `${r.codigo} — ${r.rotulo}` },
    { key: "total", label: "Valor", align: "right", render: (r) => <span className={r.nivel === "grupo" ? `font-semibold ${cor(r.total)}` : cor(r.total)}>{brl(r.total)}</span>, text: (r) => r.total }
  ], []);
  const resumo: [string, string, string][] = d ? [["Receita líquida", d.receitaLiquida, "fin-dre-receita-liquida"], ["Resultado operacional", d.resultadoOperacional, "fin-dre-resultado-operacional"], ["Investimentos", d.investimentos, "fin-dre-investimentos"], ["Resultado final", d.resultadoFinal, "fin-dre-resultado-final"]] : [];
  return <div className="ws-scroll flex min-h-0 flex-1 flex-col gap-2" data-testid="fin-resultado">
    <Card className="ws-filters no-print">
      <CardBody className="grid grid-cols-12 gap-2 py-2">
        <Field label="De" span={2} error={periodoInvalido ? "Período inválido" : undefined}><Input type="date" value={f.de} onChange={(e) => set("de", e.target.value)} /></Field>
        <Field label="Até" span={2}><Input type="date" value={f.ate} onChange={(e) => set("ate", e.target.value)} /></Field>
        <Field label="Regime" span={3}><NativeSelect value={f.regime} onChange={(e) => set("regime", e.target.value as Regime)}>
          <option value="competencia">{rotuloFinanceiro("regime_dre", "competencia")}</option><option value="caixa">{rotuloFinanceiro("regime_dre", "caixa")}</option>
        </NativeSelect></Field>
        <Field label="Empresa" span={5}><RefSelect resource="empresas" value={f.empresa} onChange={(v) => set("empresa", v ?? "")} /></Field>
      </CardBody>
    </Card>
    {q.isLoading && <LoadingState />}
    {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
    {d && <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {resumo.map(([rotulo, valor, testId]) => <div key={testId} data-testid={testId} data-valor={valor}><Stat label={rotulo} value={brl(valor)} tone={D(valor).isNegative() ? "red" : "green"} hint={`${rotuloFinanceiro("regime_dre", d.regime)} · ${dateBR(d.de)} a ${dateBR(d.ate)}`} /></div>)}
      </div>
      <DataTable<LinhaDre> rows={linhas} columns={colunas} rowKey={(r) => r.chave} pageSize={Math.max(linhas.length, 1)} emptyText="Nenhum lançamento com natureza no período."
        footer={<>{resumo.map(([rotulo, valor]) => <tr key={rotulo}>
          <td colSpan={colSpanAteColuna(colunas, "total")} className="px-2 py-1 font-semibold">{rotulo}</td>
          <td className={`num ${cor(valor)}`}>{brl(valor)}</td>
          {colSpanAposColuna(colunas, "total") > 0 && <td colSpan={colSpanAposColuna(colunas, "total")} />}
        </tr>)}</>} />
    </>}
  </div>;
}
