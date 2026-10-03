"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, newIdem, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { COPY } from "@/lib/copy";
import { Button, Card, CardHeader, CardBody, ErrorState, Field, LoadingState } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";

/**
 * CONFIGURAÇÕES › FINANCEIRO › NATUREZAS PADRÃO DA BAIXA (OPERACOES-01 F8, decisão 285). Juros, multa, acréscimo,
 * desconto e tarifa bancária da baixa viram lançamentos separados com a natureza configurada aqui (por direção). Sem
 * natureza configurada, o componente fica dentro do movimento principal (como hoje); a tarifa exige a natureza. O
 * servidor confere cada uma (da organização, ativa, analítica e do tipo certo — receita ou despesa) e recusa por campo.
 */

type Chave = "juros_pagos" | "juros_recebidos" | "multa_paga" | "multa_recebida" | "acrescimo_pago" | "acrescimo_recebido" | "desconto_obtido" | "desconto_concedido" | "tarifa_bancaria";
type NaturezaResumida = { id: string; codigo: string; nome: string } | null;
type Configuracao = Record<Chave, NaturezaResumida>;

const GRUPOS: { titulo: string; descricao: string; campos: { chave: Chave; rotulo: string }[] }[] = [
  { titulo: "Contas a pagar", descricao: "Despesas com juros, multa e acréscimo; o desconto obtido é receita.", campos: [
    { chave: "juros_pagos", rotulo: "Juros pagos" }, { chave: "multa_paga", rotulo: "Multa paga" }, { chave: "acrescimo_pago", rotulo: "Acréscimo pago" }, { chave: "desconto_obtido", rotulo: "Desconto obtido" }
  ] },
  { titulo: "Contas a receber", descricao: "Receitas com juros, multa e acréscimo; o desconto concedido é despesa.", campos: [
    { chave: "juros_recebidos", rotulo: "Juros recebidos" }, { chave: "multa_recebida", rotulo: "Multa recebida" }, { chave: "acrescimo_recebido", rotulo: "Acréscimo recebido" }, { chave: "desconto_concedido", rotulo: "Desconto concedido" }
  ] },
  { titulo: "Banco", descricao: "A tarifa bancária é uma despesa já paga, lançada em movimento próprio de saída.", campos: [
    { chave: "tarifa_bancaria", rotulo: "Tarifa bancária" }
  ] }
];
const CHAVES = GRUPOS.flatMap((g) => g.campos.map((c) => c.chave));

/** Erros por campo devolvidos pelo servidor (`details: [{ path: ["juros_pagos_id"], message }]`). */
function errosPorCampo(e: unknown): Partial<Record<Chave, string>> {
  if (!(e instanceof ApiError) || !Array.isArray(e.details)) return {};
  const out: Partial<Record<Chave, string>> = {};
  for (const d of e.details as { path?: unknown[]; message?: string }[]) {
    const campo = String(d.path?.[0] ?? "").replace(/_id$/, "") as Chave;
    if (CHAVES.includes(campo) && d.message) out[campo] = d.message;
  }
  return out;
}

export function NaturezasPadraoDaBaixa() {
  const { can } = useAuth(); const qc = useQueryClient();
  const podeEditar = can("financial_categories.edit");
  const q = useQuery({ queryKey: ["financeiro-naturezas-padrao"], queryFn: () => api<Configuracao>("/api/financeiro/configuracoes/naturezas-padrao") });
  const [valores, setValores] = React.useState<Record<Chave, string>>(() => Object.fromEntries(CHAVES.map((c) => [c, ""])) as Record<Chave, string>);
  React.useEffect(() => { if (q.data) setValores(Object.fromEntries(CHAVES.map((c) => [c, q.data[c]?.id ?? ""])) as Record<Chave, string>); }, [q.data]);
  const salvar = useMutation({
    mutationFn: () => api<Configuracao>("/api/financeiro/configuracoes/naturezas-padrao", { method: "PUT", idempotencyKey: newIdem(), body: Object.fromEntries(CHAVES.map((c) => [`${c}_id`, valores[c] || null])) }),
    onSuccess: (r) => { toast.success("Naturezas padrão salvas"); qc.setQueryData(["financeiro-naturezas-padrao"], r); },
    onError: (e) => toast.error((e as Error).message)
  });
  const erros = salvar.error ? errosPorCampo(salvar.error) : {};
  const mudou = q.data ? CHAVES.some((c) => (q.data[c]?.id ?? "") !== valores[c]) : false;
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <Card data-testid="fin-naturezas-padrao">
    <CardHeader title="Naturezas padrão da baixa" subtitle="Juros, multa, acréscimo, desconto e tarifa da baixa são lançados separados, cada um na sua natureza. Sem natureza, o componente fica no movimento principal; a tarifa exige a natureza."
      actions={podeEditar && <Button size="sm" loading={salvar.isPending} disabled={!mudou || salvar.isPending} data-testid="fin-naturezas-padrao-salvar" onClick={() => salvar.mutate()}>{COPY.salvar}</Button>} />
    <CardBody className="space-y-4">
      {GRUPOS.map((g) => <section key={g.titulo} className="space-y-2">
        <div><h3 className="text-xs font-semibold uppercase text-brand-700">{g.titulo}</h3><p className="text-xs text-slate-500">{g.descricao}</p></div>
        <div className="grid grid-cols-12 gap-2">
          {g.campos.map((c) => <Field key={c.chave} label={c.rotulo} span={3} error={erros[c.chave]}>
            <RefSelect resource="financial_categories" value={valores[c.chave] || null} filter={{ kind: "analytic" }} disabled={!podeEditar}
              labelHint={q.data?.[c.chave] && q.data[c.chave]!.id === valores[c.chave] ? `${q.data[c.chave]!.codigo} — ${q.data[c.chave]!.nome}` : undefined}
              onChange={(v) => setValores((o) => ({ ...o, [c.chave]: v ?? "" }))} />
          </Field>)}
        </div>
      </section>)}
    </CardBody>
  </Card>;
}
