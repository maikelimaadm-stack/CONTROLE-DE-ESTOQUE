"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { D, money, sum } from "@agro/shared";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTradutor } from "@/lib/i18n";
import { brl, dateBR, monthBR, monthStartISO } from "@/lib/utils";
import { Card, CardHeader, CardBody, EmptyState, ErrorState, Field, Input, LoadingState, NativeSelect, Stat } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { DataTable, colSpanAteColuna, type Column } from "@/components/ui/data-table";
import { usePodeVerContas, useContasDaOrganizacao } from "./contas";
import { useFinanceiroPelaTop } from "@/features/financial/central/capacidade";

/**
 * FLUXO E RESULTADO › FLUXO DE CAIXA (OPERACOES-01 F8, decisão 285). PREVISTO (saldo dos títulos abertos por
 * vencimento, das direções que o usuário vê) × REALIZADO (movimentos confirmados pela data), por dia, semana ou mês,
 * por conta ou por empresa. Transferência entre contas (depósito, saque, aplicação, resgate) não é entrada nem saída:
 * fica numa coluna própria. Todo número vem do servidor como texto decimal; os totais da tela somam em decimal.
 *
 * Da ORGANIZAÇÃO (sem empresa) há saldo — e exige ver as contas; por EMPRESA não há saldo (saldo de conta é da
 * organização, MULTI-COMPANY §7).
 *
 * OS PREVISTOS DA PROVISÃO PELA TOP (OPERACOES-01 F9, decisão 286): com `financeiroPelaTop` declarado, "Incluir
 * previstos" liga (`previstos=1`) a série SEPARADA dos títulos previstos — as colunas "Provisão a receber" e "Provisão
 * a pagar" e o "Saldo projetado com previstos"; o saldo projetado de sempre não muda. Sem a capacidade (a API da F8),
 * a opção fica como na F8 — existe, desabilitada — e o pedido sai com `previstos=0`, idêntico.
 */

const TEXTO_PREVISTOS_F9 = "Os previstos chegam com a provisão pela TOP";
const TEXTO_PREVISTOS_LIGADOS = "Os títulos previstos (a provisão dos documentos pela TOP) em colunas próprias, fora do previsto e do saldo projetado";
type Agrupamento = "dia" | "semana" | "mes";
type AgruparPor = "nenhum" | "conta" | "empresa";
interface Periodo extends Record<string, unknown> {
  inicio: string; fim: string;
  realizado: { entradas: string; saidas: string; transferencias_liquidas: string; saldos_iniciais?: string };
  previsto: { entradas: string; saidas: string };
  saldo_realizado: string | null; saldo_projetado: string | null;
  /** F9: só com `previstos=1` — a provisão do período e o projetado com ela. */
  provisao?: { entradas: string; saidas: string }; saldo_projetado_com_previstos?: string | null;
}
interface RespostaFluxo {
  agrupamento: Agrupamento; de: string; ate: string; modo?: "organizacao" | "empresa"; saldo_inicial: string | null; periodos: Periodo[];
  previsto_em_atraso: { entradas: string; saidas: string }; previstos_incluidos: boolean; direcoes_previstas: ("payable" | "receivable")[];
  /** F9: só com `previstos=1` — a provisão vencida antes do início. */
  provisao_em_atraso?: { entradas: string; saidas: string };
  grupos?: { chave: string | null; rotulo: string; saldo_inicial?: string | null; periodos: Periodo[] }[];
}

/** Último dia do mês de uma data ISO (só datas; dinheiro nunca passa por aqui). */
function fimDoMes(iso: string): string {
  const [a, m] = iso.split("-").map((x) => Number.parseInt(x, 10));
  const ultimo = new Date(Date.UTC(a!, m!, 0)).getUTCDate();
  return `${iso.slice(0, 7)}-${String(ultimo).padStart(2, "0")}`;
}
const rotuloDoPeriodo = (p: Periodo, ag: Agrupamento) => ag === "mes" ? monthBR(p.inicio) : ag === "semana" ? `${dateBR(p.inicio)} a ${dateBR(p.fim)}` : dateBR(p.inicio);
const somar = (periodos: Periodo[], ler: (p: Periodo) => string) => money(sum(periodos.map(ler)));

export function FluxoDeCaixa() {
  const { can } = useAuth(); const tr = useTradutor();
  const podeVerContas = usePodeVerContas();
  const contas = useContasDaOrganizacao();
  const pelaTop = useFinanceiroPelaTop();
  const [f, setF] = React.useState<{ de: string; ate: string; agrupamento: Agrupamento; agruparPor: AgruparPor; empresa: string; contas: string[]; previstos: boolean }>(() => ({
    de: monthStartISO(), ate: fimDoMes(monthStartISO()), agrupamento: "dia", agruparPor: podeVerContas ? "nenhum" : "empresa", empresa: "", contas: [], previstos: false
  }));
  // Sem a capacidade, `previstos` nunca vai "1" — o pedido é o da F8, idêntico.
  const comPrevistos = pelaTop && f.previstos;
  const periodoInvalido = Boolean(f.de && f.ate && f.de > f.ate) || Boolean(f.de) !== Boolean(f.ate);
  // Fluxo da organização (sem empresa, sem detalhar por empresa) soma todas as empresas da conta: exige ver as contas.
  const daOrganizacao = !f.empresa && f.agruparPor !== "empresa";
  const semPorta = daOrganizacao && !podeVerContas;
  const q = useQuery({
    queryKey: ["financeiro-fluxo", f, comPrevistos],
    queryFn: () => api<RespostaFluxo>(`/api/financeiro/fluxo${qs({ de: f.de, ate: f.ate, agrupamento: f.agrupamento, agrupar_por: f.agruparPor, empresa_id: f.empresa, contas: f.contas.join(","), previstos: comPrevistos ? "1" : "0" })}`),
    enabled: can("cash_flow.view") && !periodoInvalido && !semPorta
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((o) => ({ ...o, [k]: v }));
  const d = q.data;
  return <div className="ws-scroll flex min-h-0 flex-1 flex-col gap-2" data-testid="fin-fluxo">
    <Card className="ws-filters no-print">
      <CardBody className="grid grid-cols-12 gap-2 py-2">
        <Field label="De" span={2} error={periodoInvalido ? "Período inválido" : undefined}><Input type="date" value={f.de} onChange={(e) => set("de", e.target.value)} /></Field>
        <Field label="Até" span={2}><Input type="date" value={f.ate} onChange={(e) => set("ate", e.target.value)} /></Field>
        <Field label="Agrupar por" span={2}><NativeSelect value={f.agrupamento} onChange={(e) => set("agrupamento", e.target.value as Agrupamento)}>
          <option value="dia">Dia</option><option value="semana">Semana</option><option value="mes">Mês</option>
        </NativeSelect></Field>
        <Field label="Detalhar por" span={2}><NativeSelect value={f.agruparPor} onChange={(e) => set("agruparPor", e.target.value as AgruparPor)}>
          <option value="nenhum">Total</option>{podeVerContas && <option value="conta">Conta</option>}<option value="empresa">Empresa</option>
        </NativeSelect></Field>
        <Field label="Empresa" span={3}><RefSelect resource="empresas" value={f.empresa} onChange={(v) => set("empresa", v ?? "")} /></Field>
        <div className="col-span-12 flex items-end md:col-span-1">
          {pelaTop
            ? <label className="flex items-center gap-1.5 text-xs text-slate-600" title={TEXTO_PREVISTOS_LIGADOS} data-testid="fin-fluxo-previstos"><input type="checkbox" checked={f.previstos} onChange={(e) => set("previstos", e.target.checked)} /> Incluir previstos</label>
            : <label className="flex items-center gap-1.5 text-xs text-slate-400" title={TEXTO_PREVISTOS_F9} data-testid="fin-fluxo-previstos"><input type="checkbox" disabled checked={false} readOnly title={TEXTO_PREVISTOS_F9} /> Incluir previstos</label>}
        </div>
        {podeVerContas && <Field label="Contas" span={12} help="Nenhuma marcada = todas as contas"><div className="flex flex-wrap gap-2">
          {contas.data?.itens.map((c) => <label key={c.id} className="flex items-center gap-1 rounded border px-2 py-1 text-xs">
            <input type="checkbox" checked={f.contas.includes(c.id)} onChange={(e) => set("contas", e.target.checked ? [...f.contas, c.id] : f.contas.filter((x) => x !== c.id))} />{c.codigo} — {c.descricao}
          </label>)}
        </div></Field>}
      </CardBody>
    </Card>
    {semPorta && <Card><CardBody><EmptyState title={tr("acesso_empresa.saldo_organizacao")} description="Escolha uma empresa ou detalhe por empresa para ver o fluxo sem o saldo das contas." /></CardBody></Card>}
    {q.isLoading && !semPorta && <LoadingState />}
    {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
    {d && <ResumoDoFluxo d={d} pelaTop={pelaTop} />}
    {d && (d.grupos?.length
      ? d.grupos.map((g) => <Card key={g.chave ?? "sem"}><CardHeader title={g.rotulo} subtitle={g.saldo_inicial !== undefined && g.saldo_inicial !== null ? `Saldo inicial: ${brl(g.saldo_inicial)}` : undefined} /><TabelaDoFluxo periodos={g.periodos} agrupamento={d.agrupamento} comProvisao={d.previstos_incluidos} /></Card>)
      : <TabelaDoFluxo periodos={d.periodos} agrupamento={d.agrupamento} comProvisao={d.previstos_incluidos} />)}
  </div>;
}

function ResumoDoFluxo({ d, pelaTop }: { d: RespostaFluxo; pelaTop: boolean }) {
  const ultimo = d.periodos[d.periodos.length - 1];
  const direcoes = d.direcoes_previstas.map((x) => x === "receivable" ? "a receber" : "a pagar").join(" e ");
  const comProvisao = d.previstos_incluidos;
  const atraso = d.provisao_em_atraso;
  return <>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
      <Stat label="Saldo inicial" value={d.saldo_inicial === null ? "—" : brl(d.saldo_inicial)} hint={d.saldo_inicial === null ? "Por empresa não há saldo de conta" : `Em ${dateBR(d.de)}`} />
      <Stat label="Entradas realizadas" value={brl(somar(d.periodos, (p) => p.realizado.entradas))} tone="green" />
      <Stat label="Saídas realizadas" value={brl(somar(d.periodos, (p) => p.realizado.saidas))} tone="red" />
      <Stat label="Transferências (líquido)" value={brl(somar(d.periodos, (p) => p.realizado.transferencias_liquidas))} hint="Não são entrada nem saída" />
      <Stat label="Saldo realizado" value={ultimo?.saldo_realizado == null ? "—" : brl(ultimo.saldo_realizado)} hint={`Em ${dateBR(d.ate)}`} />
      <Stat label="Saldo projetado" value={ultimo?.saldo_projetado == null ? "—" : brl(ultimo.saldo_projetado)} tone="amber" hint="Realizado + previsto do período" />
    </div>
    <div className={comProvisao ? "grid grid-cols-2 gap-3 md:grid-cols-4" : "grid grid-cols-2 gap-3 md:grid-cols-3"} data-testid="fin-fluxo-atraso">
      <Stat label="Em atraso a receber" value={brl(d.previsto_em_atraso.entradas)} hint={`Vencidos antes de ${dateBR(d.de)}`} />
      <Stat label="Em atraso a pagar" value={brl(d.previsto_em_atraso.saidas)} hint={`Vencidos antes de ${dateBR(d.de)}`} />
      <Stat label="Previsto" value={<span className="text-sm">{direcoes ? `Títulos ${direcoes} em aberto` : "Sem acesso a títulos"}</span>} hint={pelaTop ? "A provisão pela TOP fica fora: marque “Incluir previstos”" : TEXTO_PREVISTOS_F9} />
      {comProvisao && <div data-testid="fin-fluxo-saldo-com-previstos">
        <Stat label="Saldo projetado com previstos" value={ultimo?.saldo_projetado_com_previstos == null ? "—" : brl(ultimo.saldo_projetado_com_previstos)} tone="amber"
          hint={atraso ? `Provisão vencida antes de ${dateBR(d.de)}: a receber ${brl(atraso.entradas)} · a pagar ${brl(atraso.saidas)}` : undefined} />
      </div>}
    </div>
  </>;
}

/** A provisão de um período (zero quando a série não veio). */
const provisaoDo = (p: Periodo) => p.provisao ?? { entradas: "0", saidas: "0" };

function TabelaDoFluxo({ periodos, agrupamento, comProvisao }: { periodos: Periodo[]; agrupamento: Agrupamento; comProvisao: boolean }) {
  const comAbertura = periodos.some((p) => p.realizado.saldos_iniciais && !D(p.realizado.saldos_iniciais).isZero());
  const colunas = React.useMemo<Column<Periodo>[]>(() => [
    { key: "inicio", label: "Período", render: (p) => rotuloDoPeriodo(p, agrupamento), text: (p) => rotuloDoPeriodo(p, agrupamento) },
    { key: "previsto_entradas", label: "Entradas previstas", align: "right", render: (p) => brl(p.previsto.entradas), text: (p) => p.previsto.entradas },
    { key: "previsto_saidas", label: "Saídas previstas", align: "right", render: (p) => brl(p.previsto.saidas), text: (p) => p.previsto.saidas },
    ...(comProvisao ? [
      { key: "provisao_entradas", label: "Provisão a receber", align: "right" as const, render: (p: Periodo) => brl(provisaoDo(p).entradas), text: (p: Periodo) => provisaoDo(p).entradas },
      { key: "provisao_saidas", label: "Provisão a pagar", align: "right" as const, render: (p: Periodo) => brl(provisaoDo(p).saidas), text: (p: Periodo) => provisaoDo(p).saidas }
    ] : []),
    { key: "realizado_entradas", label: "Entradas realizadas", align: "right", render: (p) => brl(p.realizado.entradas), text: (p) => p.realizado.entradas },
    { key: "realizado_saidas", label: "Saídas realizadas", align: "right", render: (p) => brl(p.realizado.saidas), text: (p) => p.realizado.saidas },
    { key: "transferencias", label: "Transferências (líquido)", align: "right", render: (p) => brl(p.realizado.transferencias_liquidas), text: (p) => p.realizado.transferencias_liquidas },
    ...(comAbertura ? [{ key: "saldos_iniciais", label: "Saldo inicial lançado", align: "right" as const, render: (p: Periodo) => brl(p.realizado.saldos_iniciais ?? "0"), text: (p: Periodo) => p.realizado.saldos_iniciais ?? "0" }] : []),
    { key: "saldo_realizado", label: "Saldo realizado", align: "right", render: (p) => p.saldo_realizado === null ? "—" : brl(p.saldo_realizado), text: (p) => p.saldo_realizado ?? "" },
    { key: "saldo_projetado", label: "Saldo projetado", align: "right", render: (p) => p.saldo_projetado === null ? "—" : brl(p.saldo_projetado), text: (p) => p.saldo_projetado ?? "" },
    ...(comProvisao ? [{ key: "saldo_projetado_com_previstos", label: "Projetado com previstos", align: "right" as const, render: (p: Periodo) => p.saldo_projetado_com_previstos == null ? "—" : brl(p.saldo_projetado_com_previstos), text: (p: Periodo) => p.saldo_projetado_com_previstos ?? "" }] : [])
  ], [agrupamento, comAbertura, comProvisao]);
  const ultimo = periodos[periodos.length - 1];
  return <DataTable<Periodo> rows={periodos} columns={colunas} rowKey={(p) => p.inicio} pageSize={Math.max(periodos.length, 1)} emptyText="Nenhum período."
    footer={periodos.length > 0 && <tr>
      <td colSpan={colSpanAteColuna(colunas, "previsto_entradas")} className="px-2 py-1">Totais</td>
      <td className="num">{brl(somar(periodos, (p) => p.previsto.entradas))}</td>
      <td className="num">{brl(somar(periodos, (p) => p.previsto.saidas))}</td>
      {comProvisao && <><td className="num">{brl(somar(periodos, (p) => provisaoDo(p).entradas))}</td><td className="num">{brl(somar(periodos, (p) => provisaoDo(p).saidas))}</td></>}
      <td className="num">{brl(somar(periodos, (p) => p.realizado.entradas))}</td>
      <td className="num">{brl(somar(periodos, (p) => p.realizado.saidas))}</td>
      <td className="num">{brl(somar(periodos, (p) => p.realizado.transferencias_liquidas))}</td>
      {comAbertura && <td className="num">{brl(somar(periodos, (p) => p.realizado.saldos_iniciais ?? "0"))}</td>}
      <td className="num">{ultimo?.saldo_realizado == null ? "—" : brl(ultimo.saldo_realizado)}</td>
      <td className="num">{ultimo?.saldo_projetado == null ? "—" : brl(ultimo.saldo_projetado)}</td>
      {comProvisao && <td className="num">{ultimo?.saldo_projetado_com_previstos == null ? "—" : brl(ultimo.saldo_projetado_com_previstos)}</td>}
    </tr>} />;
}
