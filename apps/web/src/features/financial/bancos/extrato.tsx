"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { D } from "@agro/shared";
import { rotuloFinanceiro } from "@agro/domain";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTradutor } from "@/lib/i18n";
import { brl, dateBR, dateTimeBR, todayISO } from "@/lib/utils";
import { enumLabel } from "@/lib/copy";
import { Button, Card, CardHeader, CardBody, Dialog, EmptyState, ErrorState, Field, Input, NativeSelect, Stat } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { DataTable, colSpanAteColuna, colSpanAposColuna, type Column } from "@/components/ui/data-table";
import { useUrlParam } from "@/components/workspace";
import { colunaIdGlobalTabela } from "@/features/listing/id-global-coluna";
import { useAction, ActionDialog } from "@/features/docs/actions";
import { useEmpresaPadrao } from "@/features/docs/shared";
import { POR_PAGINA, rotuloDaConta, usePodeVerContas, useContasDaOrganizacao, valorDecimal } from "./contas";

/**
 * BANCOS E CAIXA › EXTRATO (OPERACOES-01 F8, decisão 285). Uma conta, com o saldo REAL × CONCILIADO acumulados linha
 * a linha — o acumulado é calculado no SERVIDOR sobre todos os movimentos do período (o filtro de situação recorta as
 * linhas mostradas, não o saldo) e a paginação vem depois dele. Movimento confirmado é imutável: a correção é
 * ESTORNO (com motivo, pela rota de hoje) e movimento novo. A tarifa avulsa é uma despesa já paga: saída com a
 * natureza padrão da tarifa bancária (Configurações › Financeiro).
 */

interface LinhaExtrato extends Record<string, unknown> {
  id: string; codigo: string; data: string; descricao: string | null; documento: string | null; tipo: "in" | "out"; categoria: string; tipo_transferencia: string | null;
  valor: string; conciliado: boolean; conciliado_em: string | null; origem: string | null; empresa_id: string | null; saldo_real: string; saldo_conciliado: string; id_global?: number | null;
}
interface RespostaExtrato {
  conta: { id: string; codigo: string; descricao: string; tipo: string; saldo_inicial: string; data_saldo_inicial: string | null };
  de: string | null; ate: string | null; situacao: string;
  saldo_anterior: { real: string; conciliado: string }; saldo_final: { real: string; conciliado: string };
  itens: LinhaExtrato[]; total: number; page: number; pageSize: number;
}
interface NaturezaResumida { id: string; codigo: string; nome: string }

/** Movimento que nasceu de uma baixa de título: o estorno é pela baixa (a API recusa pela rota do movimento). */
const ORIGENS_DE_BAIXA = new Set(["title_settlements", "title_settlement_batch"]);

export function ExtratoDaConta() {
  const { can } = useAuth(); const tr = useTradutor(); const router = useRouter();
  const pode = usePodeVerContas();
  const contas = useContasDaOrganizacao();
  const [conta, setConta] = useUrlParam("conta", "");
  const [f, setF] = React.useState({ de: "", ate: "", situacao: "todos" });
  const [page, setPage] = React.useState(1); const pageSize = POR_PAGINA;
  const contaEscolhida = conta || contas.data?.itens.find((c) => c.ativa)?.id || "";
  const q = useQuery({
    queryKey: ["financeiro-extrato", contaEscolhida, f, page, pageSize],
    queryFn: () => api<RespostaExtrato>(`/api/financeiro/extrato${qs({ conta_id: contaEscolhida, de: f.de, ate: f.ate, situacao: f.situacao, page, pageSize })}`),
    enabled: pode && Boolean(contaEscolhida) && (!f.de || !f.ate || f.de <= f.ate)
  });
  const [estornar, setEstornar] = React.useState<LinhaExtrato | null>(null);
  const [tarifa, setTarifa] = React.useState(false);
  const act = useAction(() => setEstornar(null));
  const d = q.data;
  const temIdGlobal = Boolean(d?.itens.some((r) => "id_global" in r));

  const colunas = React.useMemo<Column<LinhaExtrato>[]>(() => [
    ...(temIdGlobal ? [colunaIdGlobalTabela<LinhaExtrato>()] : []),
    { key: "data", label: "Data", render: (r) => dateBR(r.data) },
    { key: "codigo", label: "Código" },
    { key: "descricao", label: "Descrição", render: (r) => r.descricao ?? "" },
    { key: "documento", label: "Documento", render: (r) => r.documento ?? "" },
    { key: "categoria", label: "Categoria", render: (r) => categoriaDoMovimento(r), text: (r) => categoriaDoMovimento(r) },
    { key: "origem", label: "Origem", render: (r) => enumLabel("source_type", r.origem ?? "manual"), text: (r) => enumLabel("source_type", r.origem ?? "manual") },
    { key: "valor", label: "Valor", align: "right", render: (r) => <span className={D(r.valor).isNegative() ? "text-red-600" : "text-green-700"}>{brl(r.valor)}</span> },
    { key: "conciliado", label: "Conciliado", render: (r) => r.conciliado ? (r.conciliado_em ? dateTimeBR(r.conciliado_em) : "Sim") : "Não", text: (r) => r.conciliado ? "Sim" : "Não" },
    { key: "saldo_real", label: "Saldo real", align: "right", render: (r) => brl(r.saldo_real) },
    { key: "saldo_conciliado", label: "Saldo conciliado", align: "right", render: (r) => brl(r.saldo_conciliado) }
  ], [temIdGlobal]);

  if (!pode) return <Card><CardHeader title="Extrato" /><CardBody><EmptyState title={tr("acesso_empresa.saldo_organizacao")} /></CardBody></Card>;
  const setFiltro = (k: keyof typeof f, v: string) => { setF((o) => ({ ...o, [k]: v })); setPage(1); };
  const periodoInvalido = Boolean(f.de && f.ate && f.de > f.ate);
  return <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="fin-extrato">
    <Card className="ws-filters no-print">
      <CardBody className="grid grid-cols-12 gap-2 py-2">
        <Field label="Conta" span={4}><NativeSelect value={contaEscolhida} onChange={(e) => { setConta(e.target.value); setPage(1); }}>
          {!contaEscolhida && <option value="">Selecione</option>}
          {contas.data?.itens.map((c) => <option key={c.id} value={c.id}>{rotuloDaConta(c)}{c.ativa ? "" : " — inativa"}</option>)}
        </NativeSelect></Field>
        <Field label="De" span={2} error={periodoInvalido ? "Início depois do fim" : undefined}><Input type="date" value={f.de} onChange={(e) => setFiltro("de", e.target.value)} /></Field>
        <Field label="Até" span={2}><Input type="date" value={f.ate} onChange={(e) => setFiltro("ate", e.target.value)} /></Field>
        <Field label="Situação" span={2}><NativeSelect value={f.situacao} onChange={(e) => setFiltro("situacao", e.target.value)}>
          <option value="todos">Todos</option><option value="conciliados">Conciliados</option><option value="pendentes">Pendentes de conciliação</option>
        </NativeSelect></Field>
        <div className="col-span-12 flex items-end justify-end gap-2 md:col-span-2">
          {can("bank_movements.create") && <Button size="sm" variant="outline" data-testid="fin-nova-tarifa" disabled={!contaEscolhida} onClick={() => setTarifa(true)}>Nova tarifa</Button>}
        </div>
      </CardBody>
    </Card>
    {!contaEscolhida && !contas.isLoading && <Card><CardBody><EmptyState title="Escolha uma conta para ver o extrato." /></CardBody></Card>}
    {d && <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <div data-testid="fin-saldo-real" data-valor={d.saldo_final.real}><Stat label="Saldo real" value={brl(d.saldo_final.real)} tone={D(d.saldo_final.real).isNegative() ? "red" : "green"} hint={`Anterior: ${brl(d.saldo_anterior.real)}`} /></div>
      <div data-testid="fin-saldo-conciliado" data-valor={d.saldo_final.conciliado}><Stat label="Saldo conciliado" value={brl(d.saldo_final.conciliado)} hint={`Anterior: ${brl(d.saldo_anterior.conciliado)}`} /></div>
      <Stat label="Período" value={<span className="text-sm">{d.de ? dateBR(d.de) : "Início"} a {d.ate ? dateBR(d.ate) : "hoje"}</span>} hint={d.conta.data_saldo_inicial ? `Saldo inicial em ${dateBR(d.conta.data_saldo_inicial)}` : undefined} />
      <Stat label="Movimentos" value={String(d.total)} hint={f.situacao === "todos" ? "No período" : f.situacao === "conciliados" ? "Conciliados no período" : "Pendentes no período"} />
    </div>}
    {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
    {contaEscolhida && <DataTable<LinhaExtrato> rows={d?.itens ?? []} total={d?.total} page={page} pageSize={pageSize} onPage={setPage} loading={q.isLoading}
      columns={colunas} rowKey={(r) => r.id} emptyText="Nenhum movimento no período." onRowClick={(r) => router.push(`/financeiro/movimentos/${r.id}`)}
      footer={d && <tr><td colSpan={colSpanAteColuna(colunas, "saldo_real")} className="px-2 py-1">Saldo final do período</td><td className="num">{brl(d.saldo_final.real)}</td><td className="num">{brl(d.saldo_final.conciliado)}</td><td colSpan={colSpanAposColuna(colunas, "saldo_conciliado", true)} /></tr>}
      actions={can("bank_movements.delete") ? (r) => {
        const motivo = r.conciliado ? "Movimento conciliado: desfaça a conciliação antes" : r.origem && ORIGENS_DE_BAIXA.has(r.origem) ? "Movimento de baixa: estorne a baixa pelo título" : undefined;
        return <Button size="sm" variant="ghost" data-testid="fin-extrato-estornar" disabled={Boolean(motivo)} title={motivo} onClick={() => setEstornar(r)}>Estornar</Button>;
      } : undefined} />}
    <ActionDialog open={Boolean(estornar)} onOpenChange={(o) => { if (!o) setEstornar(null); }} title={`Estornar movimento ${estornar?.codigo ?? ""}`} danger loading={act.isPending} submitLabel="Confirmar estorno"
      text="Movimento confirmado não se altera: o estorno cancela o movimento (e a outra ponta, se for transferência) e o saldo é recalculado. Para corrigir, lance outro movimento."
      fields={[{ name: "reason", label: "Motivo", type: "textarea", required: true }]}
      onSubmit={(v) => estornar && act.mutate({ path: `/api/financial/bank-movements/${estornar.id}/cancel`, body: { reason: v["reason"] } })} />
    {tarifa && <DialogoTarifa contaId={contaEscolhida} onClose={() => setTarifa(false)} />}
  </div>;
}

/** Categoria do movimento: o rótulo da transferência quando há (depósito, saque…), senão a categoria de hoje. */
function categoriaDoMovimento(r: LinhaExtrato): string {
  if (r.categoria === "internal_transfer" && r.tipo_transferencia) return rotuloFinanceiro("tipo_transferencia", r.tipo_transferencia);
  return enumLabel("bank_category_type", r.categoria);
}

/**
 * TARIFA BANCÁRIA AVULSA: uma saída já paga, com a natureza padrão da tarifa (a mesma que a baixa usa) e o centro de
 * resultado escolhido. Sem natureza configurada, não há o que lançar: o aviso diz onde configurar.
 */
function DialogoTarifa({ contaId, onClose }: { contaId: string; onClose: () => void }) {
  const contas = useContasDaOrganizacao();
  const empresaPadrao = useEmpresaPadrao();
  const naturezas = useQuery({ queryKey: ["financeiro-naturezas-padrao"], queryFn: () => api<Record<string, NaturezaResumida | null>>("/api/financeiro/configuracoes/naturezas-padrao") });
  const [h, setH] = React.useState({ conta: contaId, data: todayISO(), valor: "", empresa: empresaPadrao, centro: "", observacao: "Tarifa bancária" });
  const act = useAction(() => onClose());
  const natureza = naturezas.data?.["tarifa_bancaria"] ?? null;
  const valor = valorDecimal(h.valor);
  const pronto = Boolean(natureza && h.conta && h.data && valor && h.empresa && h.centro);
  return <Dialog open onOpenChange={(o) => { if (!o) onClose(); }} title="Nova tarifa bancária" size="md" testId="fin-dialogo-tarifa"
    description="A tarifa é uma despesa já paga: sai da conta na data informada, com a natureza padrão da tarifa bancária."
    footer={<><Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button><Button size="sm" loading={act.isPending} disabled={!pronto || act.isPending}
      onClick={() => natureza && valor && act.mutate({ path: "/api/financial/bank-movements", idem: true, body: {
        empresa_id: h.empresa, bank_account_id: h.conta, movement_date: h.data, type: "out", category_type: "out", amount: valor, interest: "0",
        note: h.observacao || "Tarifa bancária", apportionment: [{ financial_category_id: natureza.id, cost_center_id: h.centro, percentage: "100" }]
      } })}>Lançar tarifa</Button></>}>
    {naturezas.error ? <ErrorState error={naturezas.error} />
      : naturezas.data && !natureza ? <p className="mb-2 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800" role="alert" data-testid="fin-tarifa-sem-natureza">Configure a natureza padrão da tarifa em Configurações › Financeiro</p>
      : null}
    <div className="grid grid-cols-12 gap-2">
      <Field label="Conta" required span={6}><NativeSelect value={h.conta} onChange={(e) => setH({ ...h, conta: e.target.value })}>
        {contas.data?.itens.filter((c) => c.ativa || c.id === h.conta).map((c) => <option key={c.id} value={c.id}>{rotuloDaConta(c)}</option>)}
      </NativeSelect></Field>
      <Field label="Data" required span={3}><Input type="date" value={h.data} onChange={(e) => setH({ ...h, data: e.target.value })} /></Field>
      <Field label="Valor" required span={3} error={h.valor && !valor ? "Valor inválido" : undefined}><Input type="number" step="0.01" min="0" value={h.valor} onChange={(e) => setH({ ...h, valor: e.target.value })} /></Field>
      <Field label="Empresa" required span={6}><RefSelect resource="empresas" value={h.empresa} onChange={(v) => setH({ ...h, empresa: v ?? "" })} /></Field>
      <Field label="Centro de resultado" required span={6}><RefSelect resource="cost_centers" value={h.centro} filter={{ kind: "analytic" }} onChange={(v) => setH({ ...h, centro: v ?? "" })} /></Field>
      <Field label="Natureza" span={6}><Input value={natureza ? `${natureza.codigo} — ${natureza.nome}` : ""} readOnly disabled /></Field>
      <Field label="Observação" span={6}><Input value={h.observacao} onChange={(e) => setH({ ...h, observacao: e.target.value })} /></Field>
    </div>
  </Dialog>;
}
