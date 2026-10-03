"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, dateBR } from "@/lib/utils";
import { Card, CardHeader, CardBody, EmptyState, ErrorState, Field, NativeSelect } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { colunaIdGlobalTabela } from "@/features/listing/id-global-coluna";
import { POR_PAGINA } from "./contas";

/**
 * ADIANTAMENTOS (OPERACOES-01 F8, decisão 285). Adiantamento a fornecedor (a pagar) e de cliente (a receber) vira
 * SALDO DE CRÉDITO por parceiro e empresa: adiantado (o que foi pago no título de adiantamento) − usado (as
 * compensações confirmadas). O crédito é usado na baixa de um título ("Compensação com adiantamento", sem banco).
 * É adiantamento o título com forma "Adiantamento" OU com o tipo de título marcado como adiantamento. Agrupamento,
 * filtro e paginação são do servidor; a linha escolhida mostra os títulos que têm crédito.
 */

type Direcao = "payable" | "receivable";
interface LinhaCredito extends Record<string, unknown> {
  direcao: Direcao; pessoa_id: string | null; pessoa_nome: string | null; empresa_id: string; empresa_nome: string;
  adiantado: string; usado: string; saldo: string; quantidade: number;
}
interface TituloComCredito extends Record<string, unknown> { id: string; codigo: string; numero: string; emissao: string; pago: string; usado: string; credito_disponivel: string }

const ROTULO_DIRECAO: Record<Direcao, string> = { payable: "Adiantamento a fornecedor", receivable: "Adiantamento de cliente" };
const chaveDaLinha = (r: LinhaCredito) => `${r.direcao}|${r.pessoa_id ?? ""}|${r.empresa_id}`;

export function AdiantamentosPorParceiro() {
  const { can } = useAuth();
  const direcoesVisiveis = (["receivable", "payable"] as const).filter((d) => can(`${d === "payable" ? "payables" : "receivables"}.view`));
  const [f, setF] = React.useState({ direcao: "todos", pessoa: "", empresa: "", soComSaldo: true });
  const [page, setPage] = React.useState(1); const pageSize = POR_PAGINA;
  const [aberta, setAberta] = React.useState<LinhaCredito | null>(null);
  const q = useQuery({
    queryKey: ["financeiro-adiantamentos", f, page, pageSize],
    queryFn: () => api<{ itens: LinhaCredito[]; total: number }>(`/api/financeiro/adiantamentos${qs({ direcao: f.direcao, pessoa_id: f.pessoa, empresa_id: f.empresa, so_com_saldo: f.soComSaldo ? "1" : "0", page, pageSize })}`),
    enabled: direcoesVisiveis.length > 0
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((o) => ({ ...o, [k]: v })); setPage(1); setAberta(null); };
  const colunas = React.useMemo<Column<LinhaCredito>[]>(() => [
    { key: "direcao", label: "Direção", render: (r) => ROTULO_DIRECAO[r.direcao], text: (r) => ROTULO_DIRECAO[r.direcao] },
    { key: "pessoa_nome", label: "Parceiro", render: (r) => r.pessoa_nome ?? "Sem parceiro" },
    { key: "empresa_nome", label: "Empresa" },
    { key: "quantidade", label: "Títulos", align: "right" },
    { key: "adiantado", label: "Adiantado", align: "right", render: (r) => brl(r.adiantado) },
    { key: "usado", label: "Usado", align: "right", render: (r) => brl(r.usado) },
    { key: "saldo", label: "Saldo", align: "right", render: (r) => <b>{brl(r.saldo)}</b> }
  ], []);
  if (!direcoesVisiveis.length) return <Card><CardBody><EmptyState title="Sem permissão para ver contas a pagar ou a receber." /></CardBody></Card>;
  return <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="fin-adiantamentos">
    <Card>
      <CardHeader title="Adiantamentos" subtitle="Crédito do parceiro por empresa: o que foi adiantado menos o que já foi usado em compensações. O crédito é usado na baixa de um título." />
      <CardBody className="grid grid-cols-12 gap-2 pt-0">
        <Field label="Direção" span={3}><NativeSelect value={f.direcao} onChange={(e) => set("direcao", e.target.value)}>
          <option value="todos">Todos</option>
          {direcoesVisiveis.map((d) => <option key={d} value={d}>{ROTULO_DIRECAO[d]}</option>)}
        </NativeSelect></Field>
        <Field label="Parceiro" span={4}><RefSelect resource="people" value={f.pessoa} onChange={(v) => set("pessoa", v ?? "")} /></Field>
        <Field label="Empresa" span={3}><RefSelect resource="empresas" value={f.empresa} onChange={(v) => set("empresa", v ?? "")} /></Field>
        <div className="col-span-12 flex items-end md:col-span-2"><label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={f.soComSaldo} onChange={(e) => set("soComSaldo", e.target.checked)} /> Só com saldo</label></div>
      </CardBody>
    </Card>
    {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
    <DataTable<LinhaCredito> rows={q.data?.itens ?? []} total={q.data?.total} page={page} pageSize={pageSize} onPage={setPage} loading={q.isLoading}
      columns={colunas} rowKey={chaveDaLinha} emptyText="Nenhum adiantamento com saldo." onRowClick={(r) => setAberta((a) => a && chaveDaLinha(a) === chaveDaLinha(r) ? null : r)} />
    {aberta && <TitulosDoCredito linha={aberta} />}
  </div>;
}

/** Os títulos de adiantamento que compõem o crédito da linha escolhida (só os que ainda têm crédito). */
function TitulosDoCredito({ linha }: { linha: LinhaCredito }) {
  const [page, setPage] = React.useState(1); const pageSize = 20;
  const q = useQuery({
    queryKey: ["financeiro-adiantamentos-titulos", chaveDaLinha(linha), page, pageSize],
    queryFn: () => api<{ itens: TituloComCredito[]; total: number }>(`/api/financeiro/adiantamentos/titulos${qs({ direcao: linha.direcao, pessoa_id: linha.pessoa_id ?? undefined, empresa_id: linha.empresa_id, page, pageSize })}`)
  });
  const base = linha.direcao === "payable" ? "/financeiro/contas-a-pagar" : "/financeiro/contas-a-receber";
  // A grade de cima é agregada (parceiro × empresa) e não tem identidade; esta lista TÍTULOS, que têm ID Global.
  const temIdGlobal = Boolean(q.data?.itens.some((r) => "id_global" in r));
  const colunas: Column<TituloComCredito>[] = [
    ...(temIdGlobal ? [colunaIdGlobalTabela<TituloComCredito>("Título")] : []),
    { key: "codigo", label: "Código", render: (r) => <Link className="text-brand-700 underline" href={`${base}/${r.id}`}>{r.codigo}</Link>, text: (r) => r.codigo },
    { key: "numero", label: "Nº do documento" },
    { key: "emissao", label: "Emissão", render: (r) => dateBR(r.emissao) },
    { key: "pago", label: "Adiantado", align: "right", render: (r) => brl(r.pago) },
    { key: "usado", label: "Usado", align: "right", render: (r) => brl(r.usado) },
    { key: "credito_disponivel", label: "Crédito disponível", align: "right", render: (r) => <b>{brl(r.credito_disponivel)}</b> }
  ];
  return <Card data-testid="fin-adiantamentos-titulos">
    <CardHeader title={`${ROTULO_DIRECAO[linha.direcao]} — ${linha.pessoa_nome ?? "Sem parceiro"}`} subtitle={`${linha.empresa_nome} · saldo ${brl(linha.saldo)}`} />
    {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
    <DataTable<TituloComCredito> rows={q.data?.itens ?? []} total={q.data?.total} page={page} pageSize={pageSize} onPage={setPage} loading={q.isLoading}
      columns={colunas} rowKey={(r) => r.id} emptyText="Nenhum título com crédito disponível." />
  </Card>;
}
