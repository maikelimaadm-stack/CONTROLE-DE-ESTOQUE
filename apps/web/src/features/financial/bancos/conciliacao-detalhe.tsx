"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { D, money, sum } from "@agro/shared";
import { rotuloFinanceiro } from "@agro/domain";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, dateBR, dateTimeBR } from "@/lib/utils";
import { COPY } from "@/lib/copy";
import { Button, Dialog, DetailShell, ErrorState, Field, Input, LoadingState, StatusBadge } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { colunaIdGlobalTabela } from "@/features/listing/id-global-coluna";
import { FilterChips } from "@/components/workspace";
import { KV } from "@/features/docs/shared";
import { useAction, ActionDialog } from "@/features/docs/actions";
import { useEmpresaPadrao } from "@/features/docs/shared";
import { POR_PAGINA } from "./contas";

/**
 * DETALHE DA IMPORTAÇÃO OFX NA CENTRAL FINANCEIRA (OPERACOES-01 F8, decisão 285). Cada transação do extrato com a
 * SUGESTÃO calculada no servidor (o domínio decide: "Encontrado" = valor e data iguais; "Sugestão" = mesmo valor, data
 * até 3 dias; "Soma de vários" = movimentos do mesmo sinal que somam o valor) e as ações: confirmar a sugestão,
 * vincular à mão (busca de candidatos, a soma tem de fechar com o extrato), criar o lançamento pelo extrato (tarifa,
 * juros…), ignorar e desfazer (com motivo). A marca de conciliado fica no MOVIMENTO; toda conta de dinheiro é decimal.
 */

interface MovimentoResumido { id: string; codigo: string; data: string; valor: string; observacao: string | null }
interface Transacao extends Record<string, unknown> {
  id: string; fitid: string; data: string; valor: string; memo: string | null; situacao: "pending" | "matched" | "ignored";
  movimentos: MovimentoResumido[]; sugestao: { tipo: "encontrado" | "sugestao" | "soma" | "nenhuma"; grupos: MovimentoResumido[][] } | null;
}
interface RespostaImportacao {
  importacao: { id: string; codigo: string; descricao: string; conta_id: string; conta: string; de: string | null; ate: string | null; situacao: string; criado_em: string; transacoes: number; conciliadas: number; ignoradas: number; pendentes: number; id_global?: number | null };
  transacoes: Transacao[]; total: number; page: number; pageSize: number;
}
interface Candidato extends Record<string, unknown> { id: string; codigo: string; data: string; valor: string; observacao: string | null; documento: string | null }

const caminhoDaTransacao = (tid: string, acao: string) => `/api/financeiro/conciliacao/transacoes/${tid}/${acao}`;
const resumoDoMovimento = (m: MovimentoResumido) => `${m.codigo} · ${dateBR(m.data)} · ${brl(m.valor)}`;

export function ConciliacaoDetalhe({ id }: { id: string }) {
  const { can } = useAuth();
  const [situacao, setSituacao] = React.useState("");
  const [page, setPage] = React.useState(1); const pageSize = POR_PAGINA;
  const q = useQuery({
    queryKey: ["financeiro-ofx-importacao", id, situacao, page, pageSize],
    queryFn: () => api<RespostaImportacao>(`/api/financeiro/conciliacao/importacoes/${id}${qs({ situacao, page, pageSize })}`)
  });
  const [escolherGrupo, setEscolherGrupo] = React.useState<Transacao | null>(null);
  const [vincular, setVincular] = React.useState<Transacao | null>(null);
  const [criar, setCriar] = React.useState<Transacao | null>(null);
  const [desfazer, setDesfazer] = React.useState<Transacao | null>(null);
  const act = useAction(() => { setEscolherGrupo(null); setDesfazer(null); });
  const podeConciliar = can("ofx_imports.reconcile");
  const podeCriar = podeConciliar && can("bank_movements.create");

  const confirmar = React.useCallback((t: Transacao, grupo: MovimentoResumido[]) => act.mutate({ path: caminhoDaTransacao(t.id, "confirmar"), idem: true, body: { movimento_ids: grupo.map((m) => m.id) } }), [act]);
  const colunas = React.useMemo<Column<Transacao>[]>(() => [
    { key: "data", label: "Data", width: 110, render: (t) => <span data-testid="fin-ofx-transacao" data-transacao-id={t.id} data-fitid={t.fitid} data-situacao={t.situacao} data-sugestao={t.sugestao?.tipo ?? ""}>{dateBR(t.data)}</span>, text: (t) => t.data },
    { key: "memo", label: "Descrição", render: (t) => t.memo ?? "", text: (t) => t.memo ?? "" },
    { key: "fitid", label: "Identificador no banco" },
    { key: "valor", label: "Valor", align: "right", render: (t) => <span className={D(t.valor).isNegative() ? "text-red-600" : "text-green-700"}>{brl(t.valor)}</span> },
    { key: "situacao", label: COPY.situacao, render: (t) => <StatusBadge domain="status" value={t.situacao} label={rotuloFinanceiro("situacao_conciliacao", t.situacao)} />, text: (t) => rotuloFinanceiro("situacao_conciliacao", t.situacao) },
    { key: "sugestao", label: "Sugestão ou vínculo", width: 320, render: (t) => <SugestaoOuVinculo t={t} />, text: (t) => t.situacao === "matched" ? t.movimentos.map((m) => m.codigo).join(", ") : rotuloFinanceiro("sugestao_conciliacao", t.sugestao?.tipo ?? "nenhuma") },
    {
      key: "acoes", label: "Ações", width: 330, sortable: false, filterable: false, text: () => "",
      render: (t) => !podeConciliar ? null : <span className="inline-flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        {t.situacao === "pending" && t.sugestao && t.sugestao.grupos.length > 0 && <Button size="sm" data-testid="fin-ofx-confirmar" disabled={act.isPending}
          onClick={() => t.sugestao!.grupos.length === 1 ? confirmar(t, t.sugestao!.grupos[0]!) : setEscolherGrupo(t)}>Confirmar</Button>}
        {t.situacao === "pending" && <Button size="sm" variant="outline" data-testid="fin-ofx-vincular" onClick={() => setVincular(t)}>Vincular</Button>}
        {t.situacao === "pending" && podeCriar && <Button size="sm" variant="outline" data-testid="fin-ofx-criar" onClick={() => setCriar(t)}>Criar lançamento</Button>}
        {t.situacao === "pending" && <Button size="sm" variant="ghost" data-testid="fin-ofx-ignorar" disabled={act.isPending} onClick={() => act.mutate({ path: caminhoDaTransacao(t.id, "ignorar"), idem: true, body: {} })}>Ignorar</Button>}
        {t.situacao !== "pending" && <Button size="sm" variant="ghost" data-testid="fin-ofx-desfazer" onClick={() => setDesfazer(t)}>Desfazer</Button>}
      </span>
    }
  ], [podeConciliar, podeCriar, act, confirmar]);

  if (q.isLoading) return <LoadingState />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const { importacao: imp } = q.data;
  return <DetailShell title={`OFX ${imp.codigo} — ${imp.descricao}`} back="/financeiro?tab=conciliacao" status={imp.situacao} testId="fin-ofx-detalhe">
    <KV items={[
      ...(imp.id_global !== undefined ? [["ID Global", imp.id_global === null ? "–" : String(imp.id_global)] as [string, React.ReactNode]] : []),
      ["Conta", imp.conta], ["Período", `${dateBR(imp.de)} a ${dateBR(imp.ate)}`], ["Importado em", dateTimeBR(imp.criado_em)],
      ["Transações", String(imp.transacoes)], ["Conciliadas", String(imp.conciliadas)], ["Pendentes", String(imp.pendentes)], ["Ignoradas", String(imp.ignoradas)]
    ]} />
    <FilterChips label="Mostrar" testId="fin-ofx-filtro" value={situacao} onChange={(v) => { setSituacao(v); setPage(1); }} options={[
      { value: "", label: "Todas", count: imp.transacoes }, { value: "pending", label: "Pendentes", count: imp.pendentes },
      { value: "matched", label: "Conciliadas", count: imp.conciliadas }, { value: "ignored", label: "Ignoradas", count: imp.ignoradas }
    ]} />
    <DataTable<Transacao> rows={q.data.transacoes} total={q.data.total} page={page} pageSize={pageSize} onPage={setPage}
      columns={colunas} rowKey={(t) => t.id} emptyText="Nenhuma transação nesta situação." />
    {escolherGrupo && <Dialog open onOpenChange={(o) => { if (!o) setEscolherGrupo(null); }} title="Escolha a sugestão" size="md" testId="fin-ofx-dialogo-grupo"
      description={`${dateBR(escolherGrupo.data)} · ${escolherGrupo.memo ?? ""} · ${brl(escolherGrupo.valor)}`}>
      <ul className="space-y-2">{escolherGrupo.sugestao?.grupos.map((g, i) => <li key={g.map((m) => m.id).join("+")} className="flex items-center justify-between gap-2 rounded border p-2 text-sm">
        <span>{g.map(resumoDoMovimento).join(" + ")}</span>
        <Button size="sm" data-testid="fin-ofx-confirmar-grupo" data-grupo={i} loading={act.isPending} onClick={() => confirmar(escolherGrupo, g)}>Confirmar este</Button>
      </li>)}</ul>
    </Dialog>}
    {vincular && <DialogoVincular t={vincular} onClose={() => setVincular(null)} />}
    {criar && <DialogoCriarLancamento t={criar} onClose={() => setCriar(null)} />}
    <ActionDialog open={Boolean(desfazer)} onOpenChange={(o) => { if (!o) setDesfazer(null); }} title="Desfazer conciliação" danger loading={act.isPending} submitLabel="Desfazer"
      text={desfazer?.situacao === "ignored" ? "A transação volta a pendente." : "Os movimentos vinculados ficam livres de novo (sem a marca de conciliado) e a transação volta a pendente."}
      fields={[{ name: "motivo", label: "Motivo", type: "textarea", required: true }]}
      onSubmit={(v) => desfazer && act.mutate({ path: caminhoDaTransacao(desfazer.id, "desfazer"), idem: true, body: { motivo: v["motivo"] } })} />
  </DetailShell>;
}

/** A sugestão de uma transação pendente (rótulo + os movimentos de cada grupo) ou, já conciliada, os movimentos vinculados. */
function SugestaoOuVinculo({ t }: { t: Transacao }) {
  if (t.situacao === "matched") return <span className="text-xs">{t.movimentos.length ? t.movimentos.map(resumoDoMovimento).join(" + ") : "—"}</span>;
  if (t.situacao === "ignored") return <span className="text-xs text-slate-400">—</span>;
  const tipo = t.sugestao?.tipo ?? "nenhuma";
  return <span className="flex flex-col gap-0.5 text-xs">
    <b className={tipo === "nenhuma" ? "text-slate-400" : "text-slate-700"}>{rotuloFinanceiro("sugestao_conciliacao", tipo)}</b>
    {t.sugestao?.grupos.map((g) => <span key={g.map((m) => m.id).join("+")}>{g.map(resumoDoMovimento).join(" + ")}</span>)}
  </span>;
}

/**
 * VINCULAR À MÃO: candidatos do servidor (movimentos confirmados e livres da conta da importação, do mesmo sinal,
 * os mais próximos da data primeiro), escolha de 1 a 10, e a SOMA tem de fechar com o valor do extrato — a mesma
 * regra que o servidor confere. A seleção sobrevive à troca de página (guarda id → valor).
 */
function DialogoVincular({ t, onClose }: { t: Transacao; onClose: () => void }) {
  const [busca, setBusca] = React.useState(""); const [buscaAplicada, setBuscaAplicada] = React.useState("");
  const [page, setPage] = React.useState(1); const pageSize = 20;
  const [selecao, setSelecao] = React.useState<Map<string, string>>(new Map());
  const q = useQuery({
    queryKey: ["financeiro-ofx-candidatos", t.id, buscaAplicada, page, pageSize],
    queryFn: () => api<{ itens: Candidato[]; total: number }>(`${caminhoDaTransacao(t.id, "candidatos")}${qs({ busca: buscaAplicada, page, pageSize })}`)
  });
  const act = useAction(() => onClose());
  const linhas = q.data?.itens ?? [];
  const soma = money(sum([...selecao.values()]));
  const diferenca = money(D(t.valor).minus(soma));
  const fecha = selecao.size > 0 && selecao.size <= 10 && D(diferenca).isZero();
  // A grade de cima lista TRANSAÇÕES do extrato (sem identidade própria); os candidatos são movimentos bancários,
  // que têm ID Global.
  const temIdGlobal = linhas.some((r) => "id_global" in r);
  const colunas: Column<Candidato>[] = [
    ...(temIdGlobal ? [colunaIdGlobalTabela<Candidato>("Movimento bancário")] : []),
    { key: "data", label: "Data", render: (r) => dateBR(r.data) },
    { key: "codigo", label: "Código" },
    { key: "observacao", label: "Observação", render: (r) => r.observacao ?? "" },
    { key: "documento", label: "Documento", render: (r) => r.documento ?? "" },
    { key: "valor", label: "Valor", align: "right", render: (r) => brl(r.valor) }
  ];
  return <Dialog open onOpenChange={(o) => { if (!o) onClose(); }} title="Vincular a movimentos" size="lg" testId="fin-ofx-dialogo-vincular"
    description={`Extrato: ${dateBR(t.data)} · ${t.memo ?? ""} · ${brl(t.valor)}`}
    footer={<><span className="mr-auto text-sm" data-testid="fin-ofx-vincular-soma">Selecionados: <b>{brl(soma)}</b> · {D(diferenca).isZero() ? "a soma fecha com o extrato" : <>falta <b>{brl(diferenca)}</b></>}</span>
      <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
      <Button size="sm" loading={act.isPending} disabled={!fecha || act.isPending} data-testid="fin-ofx-vincular-confirmar" onClick={() => act.mutate({ path: caminhoDaTransacao(t.id, "confirmar"), idem: true, body: { movimento_ids: [...selecao.keys()] } })}>Vincular</Button></>}>
    <div className="mb-2 flex items-end gap-2">
      <Field label="Buscar por código, observação ou documento" span={12} className="flex-1"><Input value={busca} maxLength={100} onChange={(e) => setBusca(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { setBuscaAplicada(busca.trim()); setPage(1); } }} /></Field>
      <Button size="sm" variant="outline" onClick={() => { setBuscaAplicada(busca.trim()); setPage(1); }}>{COPY.buscar}</Button>
    </div>
    {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
    <DataTable<Candidato> rows={linhas} total={q.data?.total} page={page} pageSize={pageSize} onPage={setPage} loading={q.isLoading}
      columns={colunas} rowKey={(r) => r.id} selectable emptyText="Nenhum movimento livre desta conta com o mesmo sinal."
      selected={new Set(selecao.keys())}
      onSelect={(ids) => setSelecao((atual) => {
        const proxima = new Map(atual);
        for (const r of linhas) { if (ids.has(r.id)) proxima.set(r.id, r.valor); else proxima.delete(r.id); }
        return proxima;
      })} />
  </Dialog>;
}

/** CRIAR LANÇAMENTO PELO EXTRATO (tarifa, juros, crédito não lançado…): o movimento nasce com a data e o valor da transação e já conciliado. */
function DialogoCriarLancamento({ t, onClose }: { t: Transacao; onClose: () => void }) {
  const empresaPadrao = useEmpresaPadrao();
  const [h, setH] = React.useState({ empresa: empresaPadrao, natureza: "", centro: "", observacao: "" });
  const act = useAction(() => onClose());
  const pronto = Boolean(h.empresa && h.natureza && h.centro);
  return <Dialog open onOpenChange={(o) => { if (!o) onClose(); }} title="Criar lançamento pelo extrato" size="md" testId="fin-ofx-dialogo-criar"
    description={`${D(t.valor).isNegative() ? "Saída" : "Entrada"} de ${brl(money(D(t.valor).abs()))} em ${dateBR(t.data)} — o movimento nasce conciliado com esta transação.`}
    footer={<><Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button><Button size="sm" loading={act.isPending} disabled={!pronto || act.isPending} data-testid="fin-ofx-criar-confirmar"
      onClick={() => act.mutate({ path: caminhoDaTransacao(t.id, "criar-lancamento"), idem: true, body: { empresa_id: h.empresa, rateio: [{ financial_category_id: h.natureza, cost_center_id: h.centro, percentage: "100" }], observacao: h.observacao || null } })}>Criar e conciliar</Button></>}>
    <div className="grid grid-cols-12 gap-2">
      <Field label="Empresa" required span={6}><RefSelect resource="empresas" value={h.empresa} onChange={(v) => setH({ ...h, empresa: v ?? "" })} /></Field>
      <Field label="Natureza" required span={6}><RefSelect resource="financial_categories" value={h.natureza} filter={{ kind: "analytic" }} onChange={(v) => setH({ ...h, natureza: v ?? "" })} /></Field>
      <Field label="Centro de resultado" required span={6}><RefSelect resource="cost_centers" value={h.centro} filter={{ kind: "analytic" }} onChange={(v) => setH({ ...h, centro: v ?? "" })} /></Field>
      <Field label="Observação" span={6}><Input value={h.observacao} maxLength={500} placeholder={t.memo ?? "Lançamento pelo extrato"} onChange={(e) => setH({ ...h, observacao: e.target.value })} /></Field>
    </div>
  </Dialog>;
}
