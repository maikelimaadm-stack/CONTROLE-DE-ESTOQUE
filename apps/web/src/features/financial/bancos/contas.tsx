"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { D, money } from "@agro/shared";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTradutor } from "@/lib/i18n";
import { brl, dateBR, todayISO } from "@/lib/utils";
import { enumLabel } from "@/lib/copy";
import { Button, Card, CardHeader, CardBody, Dialog, EmptyState, ErrorState, Field, Input, Stat } from "@/components/ui";
import { DataTable, colSpanAteColuna, colSpanAposColuna, type Column } from "@/components/ui/data-table";
import { useAction } from "@/features/docs/actions";

/**
 * BANCOS E CAIXA › CONTAS (OPERACOES-01 F8, decisão 285). As contas da ORGANIZAÇÃO com saldo inicial e data, saldo
 * REAL (todos os movimentos confirmados) × saldo CONCILIADO (só os que têm a marca de conciliado), pela porta
 * organizacional da API (`bank_accounts.view` E `bank_movements.view`): sem as duas, o painel não é montado, em vez
 * de bater numa negação do servidor (MULTI-COMPANY §7). Com escopo TOTAL no financeiro, a conta inteira; com escopo
 * parcial, só os movimentos das empresas de quem consulta, sem o saldo inicial — e a tela diz isso (`AvisoSaldoParcial`).
 *
 * Os helpers daqui (valor digitado → decimal, a lista de contas) servem às outras abas de Bancos e caixa.
 */

/**
 * Linhas por página nas listas da Central: as rotas novas limitam a página a 200, e os tamanhos que a grade oferece
 * (100 a 1000) passam desse teto — por isso o seletor de tamanho fica desabilitado nelas, em vez de oferecer o que o
 * servidor recusa.
 */
export const POR_PAGINA = 100;

/** Linha de `GET /api/financeiro/contas`. Dinheiro chega e fica como TEXTO decimal. */
export interface ContaComSaldo extends Record<string, unknown> {
  id: string; codigo: string; descricao: string; tipo: string; banco: string | null; agencia: string | null; conta: string | null; ativa: boolean;
  saldo_inicial: string; data_saldo_inicial: string | null; saldo_real: string; saldo_conciliado: string; conciliado_ate: string | null;
}
interface RespostaContas { itens: ContaComSaldo[]; total: number; page: number; pageSize: number; totais: { saldo_real: string; saldo_conciliado: string }; escopo_saldo?: EscopoSaldo }

/**
 * O recorte do saldo que a API devolve (MULTI-COMPANY §7): "total" = a conta inteira; "parcial" = só os movimentos das
 * empresas do escopo financeiro de quem consulta, SEM o saldo inicial do cadastro (ele não tem empresa). A API anterior
 * não manda o campo — ausente se lê como antes, sem aviso.
 */
export type EscopoSaldo = "total" | "parcial";

/** Aviso de que o saldo mostrado é o das empresas de quem consulta, não o da conta inteira. */
export function AvisoSaldoParcial({ escopo }: { escopo: EscopoSaldo | undefined }) {
  if (escopo !== "parcial") return null;
  return <p data-testid="fin-saldo-escopo-parcial" role="note" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
    Saldo das suas empresas: soma só os movimentos das empresas que você acessa no financeiro, sem o saldo inicial do cadastro. Não é o saldo da conta inteira.
  </p>;
}

/**
 * Valor digitado → texto decimal com 2 casas ("1234.5" → "1234.50"), sem ponto flutuante. Aceita vírgula ou ponto
 * como separador decimal (o campo numérico do navegador já entrega com ponto); separador de milhar não é aceito.
 * Inválido → `null`: o botão fica desabilitado, nada é "corrigido" em silêncio.
 */
export function valorDecimal(texto: string, opts: { permitirNegativo?: boolean; permitirZero?: boolean } = {}): string | null {
  const limpo = texto.trim().replace(",", ".");
  if (!/^-?\d{1,16}(\.\d{1,2})?$/.test(limpo)) return null;
  const v = D(limpo);
  if (v.isNegative() && !v.isZero() && !opts.permitirNegativo) return null;
  if (v.isZero() && !opts.permitirZero) return null;
  return money(v);
}

/** O rótulo de uma conta numa lista de escolha: "BB — Banco do Brasil Principal (Corrente)". */
export const rotuloDaConta = (c: Pick<ContaComSaldo, "codigo" | "descricao" | "tipo">) => `${c.codigo} — ${c.descricao} (${enumLabel("bank_account_type", c.tipo)})`;

/** As duas capacidades que a porta organizacional de contas e saldo exige. */
export function usePodeVerContas(): boolean {
  const { can } = useAuth();
  return can("bank_accounts.view") && can("bank_movements.view");
}

/**
 * Todas as contas da organização (até 200 — o teto da página da API), para as listas de escolha e para dar nome à
 * conta destino de uma transferência. Uma consulta; só é feita com as duas capacidades.
 */
export function useContasDaOrganizacao() {
  const pode = usePodeVerContas();
  return useQuery({
    queryKey: ["financeiro-contas", "todas"],
    queryFn: () => api<RespostaContas>(`/api/financeiro/contas${qs({ ativas: "0", page: 1, pageSize: 200 })}`),
    enabled: pode,
    staleTime: 30_000
  });
}

export function ContasBancarias() {
  const { can } = useAuth(); const tr = useTradutor(); const router = useRouter();
  const pode = usePodeVerContas();
  const [inativas, setInativas] = React.useState(false);
  const [page, setPage] = React.useState(1); const pageSize = POR_PAGINA;
  const q = useQuery({
    queryKey: ["financeiro-contas", { inativas, page, pageSize }],
    queryFn: () => api<RespostaContas>(`/api/financeiro/contas${qs({ ativas: inativas ? "0" : "1", page, pageSize })}`),
    enabled: pode
  });
  const [editar, setEditar] = React.useState<ContaComSaldo | null>(null);
  const abrirExtrato = (r: ContaComSaldo) => router.push(`/financeiro?tab=bancos&sub=extrato&conta=${r.id}`);

  const colunas = React.useMemo<Column<ContaComSaldo>[]>(() => [
    { key: "codigo", label: "Código" },
    { key: "descricao", label: "Descrição" },
    { key: "tipo", label: "Tipo", render: (r) => enumLabel("bank_account_type", r.tipo), text: (r) => enumLabel("bank_account_type", r.tipo) },
    { key: "saldo_inicial", label: "Saldo inicial", align: "right", render: (r) => brl(r.saldo_inicial) },
    { key: "data_saldo_inicial", label: "Data do saldo inicial", render: (r) => dateBR(r.data_saldo_inicial) },
    { key: "saldo_real", label: "Saldo real", align: "right", render: (r) => brl(r.saldo_real) },
    { key: "saldo_conciliado", label: "Saldo conciliado", align: "right", render: (r) => brl(r.saldo_conciliado) },
    { key: "conciliado_ate", label: "Conciliado até", render: (r) => dateBR(r.conciliado_ate) }
  ], []);

  if (!pode) return <Card><CardHeader title="Contas" /><CardBody><EmptyState title={tr("acesso_empresa.saldo_organizacao")} /></CardBody></Card>;
  const d = q.data;
  return <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="fin-contas">
    <Card>
      <CardHeader title="Contas bancárias e caixa" subtitle="Saldo real = saldo inicial + todos os movimentos confirmados. Saldo conciliado = saldo inicial + só os movimentos conciliados com o extrato."
        actions={<>
          <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={inativas} onChange={(e) => { setInativas(e.target.checked); setPage(1); }} /> Mostrar inativas</label>
          <Link href="/financeiro?tab=caixa&sub=bancos"><Button size="sm" variant="outline">Cadastro de contas</Button></Link>
        </>} />
      {d && d.escopo_saldo === "parcial" && <CardBody className="pt-0"><AvisoSaldoParcial escopo={d.escopo_saldo} /></CardBody>}
      {d && <CardBody className="grid grid-cols-2 gap-3 pt-0 md:grid-cols-3">
        <Stat label="Saldo real" value={brl(d.totais.saldo_real)} tone={D(d.totais.saldo_real).isNegative() ? "red" : "green"} hint={d.escopo_saldo === "parcial" ? "Soma das contas listadas, só das suas empresas" : "Soma das contas listadas"} />
        <Stat label="Saldo conciliado" value={brl(d.totais.saldo_conciliado)} hint="Conferido com o extrato do banco" />
        <Stat label="A conciliar" value={brl(money(D(d.totais.saldo_real).minus(d.totais.saldo_conciliado)))} tone="amber" hint="Saldo real − saldo conciliado" />
      </CardBody>}
    </Card>
    {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
    <DataTable<ContaComSaldo> rows={d?.itens ?? []} total={d?.total} page={page} pageSize={pageSize} onPage={setPage} loading={q.isLoading}
      columns={colunas} rowKey={(r) => r.id} emptyText="Nenhuma conta bancária cadastrada." onRowClick={abrirExtrato}
      footer={d && <tr><td colSpan={colSpanAteColuna(colunas, "saldo_real")} className="px-2 py-1">Totais</td><td className="num">{brl(d.totais.saldo_real)}</td><td className="num">{brl(d.totais.saldo_conciliado)}</td><td colSpan={colSpanAposColuna(colunas, "saldo_conciliado", true)} /></tr>}
      actions={(r) => <span className="inline-flex gap-1">
        <Button size="sm" variant="ghost" data-testid="fin-conta-extrato" onClick={() => abrirExtrato(r)}>Ver extrato</Button>
        {can("bank_accounts.edit") && <Button size="sm" variant="ghost" data-testid="fin-conta-saldo-inicial" onClick={() => setEditar(r)}>Saldo inicial</Button>}
      </span>} />
    <DialogoSaldoInicial conta={editar} onClose={() => setEditar(null)} />
  </div>;
}

/** Saldo inicial e a data dele (o ponto de partida padrão do extrato). O valor pode ser negativo (conta que começa devedora). */
function DialogoSaldoInicial({ conta, onClose }: { conta: ContaComSaldo | null; onClose: () => void }) {
  const [valor, setValor] = React.useState(""); const [data, setData] = React.useState(todayISO());
  React.useEffect(() => { if (conta) { setValor(conta.saldo_inicial); setData(conta.data_saldo_inicial ?? todayISO()); } }, [conta]);
  const act = useAction(() => onClose());
  const v = valorDecimal(valor, { permitirNegativo: true, permitirZero: true });
  return <Dialog open={Boolean(conta)} onOpenChange={(o) => { if (!o) onClose(); }} title={`Saldo inicial — ${conta ? conta.descricao : ""}`} size="sm" testId="fin-dialogo-saldo-inicial"
    description="O saldo inicial do cadastro entra no saldo real e no conciliado. A data é o ponto de partida padrão do extrato."
    footer={<><Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button><Button size="sm" loading={act.isPending} disabled={!conta || v === null || !data || act.isPending}
      onClick={() => conta && v !== null && act.mutate({ path: `/api/financeiro/contas/${conta.id}/saldo-inicial`, method: "PUT", idem: true, body: { valor: v, data } })}>Salvar</Button></>}>
    <div className="grid grid-cols-12 gap-2">
      <Field label="Valor" required span={6} error={valor && v === null ? "Valor inválido" : undefined}><Input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} /></Field>
      <Field label="Data" required span={6}><Input type="date" value={data} onChange={(e) => setData(e.target.value)} /></Field>
    </div>
  </Dialog>;
}
