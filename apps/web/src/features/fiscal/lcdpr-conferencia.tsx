"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ROTULOS_FINANCEIRO, rotuloFinanceiro, SITUACOES_CONFERENCIA_LCDPR, TIPOS_LCDPR_NO_LIVRO, type SituacaoConferenciaLcdpr, type TipoLcdprNoLivro } from "@agro/domain";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, dateBR, todayISO, yearStartISO } from "@/lib/utils";
import { Card, CardBody, CardHeader, ErrorState, Field, Input, NativeSelect, Stat } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { colunaIdGlobalTabela } from "@/features/listing/id-global-coluna";
import { useLcdpr } from "@/features/financial/central/capacidade";

/**
 * CONFERÊNCIA DO LCDPR (OPERACOES-01 F9, decisão 286) — na aba Livro Caixa do Fiscal, embaixo do painel de hoje.
 *
 * Os DADOS do Livro Caixa Digital do Produtor Rural por período, para conferir antes do arquivo oficial (que ainda não é
 * gerado): uma linha por rateio de movimento bancário CONFIRMADO — data, imóvel rural, conta, documento, participante,
 * tipo (1 receita, 2 custeio e investimento, 3 produto entregue de adiantamento) e valor. As transferências entre contas
 * e o saldo inicial ficam fora; a natureza "Fora do LCDPR" nunca aparece.
 *   · CONFERIDAS: com o tipo do livro E o imóvel — o que o livro levaria (com os totais por tipo: o valor em destaque é
 *     o lado que o tipo soma — as entradas na receita e no produto adiantado, as SAÍDAS no custeio e investimento —, e o
 *     outro lado vai na dica);
 *   · PENDENTES: sem natureza, sem tipo, sem imóvel ou sem empresa — o que falta acertar (com as contagens no topo). O
 *     movimento sem empresa nunca leva imóvel: a linha e a contagem dizem "Sem empresa".
 *
 * TUDO NO SERVIDOR (`GET /api/financeiro/lcdpr/conferencia`): filtro, período (até 366 dias), escopo de empresa,
 * paginação, totais e pendências — a tela só formata. Só existe com `capacidades.lcdpr` declarado e com a permissão do
 * relatório do Livro Caixa (`report.cash_book.view`); sem isso, nada aparece e nenhum pedido sai.
 */
interface LinhaConferencia extends Record<string, unknown> {
  id: string; movimento_id: string; data: string; id_global?: number | null;
  imovel: { id: string; nome: string; cib: string | null } | null;
  /** O movimento não tem empresa (nunca terá imóvel). Ausente = falso. */
  sem_empresa?: boolean;
  conta: { id: string; codigo: string; descricao: string };
  documento: string; participante: { nome: string; documento: string | null } | null;
  tipo: TipoLcdprNoLivro | null; tipo_codigo: number | null;
  natureza: { id: string; codigo: string; nome: string } | null;
  entrada: string; saida: string; historico: string | null;
}
type ParDeValores = { entradas: string; saidas: string };
type Pendencia = { quantidade: number; valor: string };
interface RespostaConferencia {
  de: string; ate: string; situacao: SituacaoConferenciaLcdpr; itens: LinhaConferencia[]; total: number; page: number; pageSize: number;
  totais: Record<TipoLcdprNoLivro, ParDeValores>;
  pendencias: { sem_imovel: Pendencia; sem_tipo: Pendencia; sem_empresa?: Pendencia };
  idGlobal?: { rotulo: string };
}

/** Os tipos que entram no livro, na ordem do código (o "Fora do LCDPR" não é filtro: nunca aparece). */
const TIPOS_DO_LIVRO = TIPOS_LCDPR_NO_LIVRO;
const TESTID_DO_TOTAL: Record<TipoLcdprNoLivro, string> = { receita: "lcdpr-total-receita", custeio_investimento: "lcdpr-total-custeio", produto_adiantado: "lcdpr-total-adiantado" };
/** O lado que cada tipo SOMA no livro (o valor em destaque do cartão): receita e produto adiantado entram; o custeio sai. */
const LADO_DO_TIPO: Record<TipoLcdprNoLivro, keyof ParDeValores> = { receita: "entradas", custeio_investimento: "saidas", produto_adiantado: "entradas" };
const ROTULO_DO_LADO: Record<keyof ParDeValores, string> = { entradas: "Entradas", saidas: "Saídas" };
const outroLado = (lado: keyof ParDeValores): keyof ParDeValores => (lado === "entradas" ? "saidas" : "entradas");
const POR_PAGINA = 50;

interface Filtros { de: string; ate: string; empresa: string; imovel: string; tipo: string; situacao: SituacaoConferenciaLcdpr }
const filtrosIniciais = (): Filtros => ({ de: yearStartISO(), ate: todayISO(), empresa: "", imovel: "", tipo: "", situacao: "conferidas" });

export function ConferenciaLcdpr() {
  const lcdpr = useLcdpr(); const { can } = useAuth();
  const pode = lcdpr && can("report.cash_book.view");
  const podeVerImoveis = can("imoveis_rurais.view");
  const [f, setF] = React.useState<Filtros>(filtrosIniciais);
  const [page, setPage] = React.useState(1);
  const periodoInvalido = !f.de || !f.ate || f.de > f.ate;
  const q = useQuery({
    queryKey: ["lcdpr-conferencia", f, page],
    enabled: pode && !periodoInvalido,
    retry: false,
    queryFn: () => api<RespostaConferencia>(`/api/financeiro/lcdpr/conferencia${qs({
      de: f.de, ate: f.ate, empresa_id: f.empresa, imovel_rural_id: f.imovel, tipo: f.tipo, situacao: f.situacao, page, pageSize: POR_PAGINA
    })}`)
  });
  const set = <K extends keyof Filtros>(k: K, v: Filtros[K]) => { setF((o) => ({ ...o, [k]: v, ...(k === "empresa" ? { imovel: "" } : {}) })); setPage(1); };
  const d = q.data;
  const colunas = React.useMemo<Column<LinhaConferencia>[]>(() => [
    ...(d?.idGlobal ? [colunaIdGlobalTabela<LinhaConferencia>(d.idGlobal.rotulo)] : []),
    { key: "data", label: "Data", render: (r) => dateBR(r.data), text: (r) => dateBR(r.data) },
    { key: "imovel", label: "Imóvel rural", render: (r) => (r.imovel ? r.imovel.nome : <span className="text-amber-700">{r.sem_empresa ? "Sem empresa" : "Sem imóvel"}</span>), text: (r) => r.imovel?.nome ?? (r.sem_empresa ? "Sem empresa" : "Sem imóvel") },
    { key: "conta", label: "Conta", render: (r) => `${r.conta.codigo} — ${r.conta.descricao}`, text: (r) => `${r.conta.codigo} — ${r.conta.descricao}` },
    { key: "documento", label: "Documento" },
    { key: "participante", label: "Participante", render: (r) => r.participante?.nome ?? "—", text: (r) => r.participante?.nome ?? "" },
    { key: "natureza", label: "Natureza", render: (r) => (r.natureza ? `${r.natureza.codigo} — ${r.natureza.nome}` : <span className="text-amber-700">Sem natureza</span>), text: (r) => (r.natureza ? `${r.natureza.codigo} — ${r.natureza.nome}` : "") },
    { key: "tipo", label: "Tipo", render: (r) => (r.tipo ? rotuloFinanceiro("tipo_lcdpr", r.tipo) : <span className="text-amber-700">Sem tipo</span>), text: (r) => (r.tipo ? rotuloFinanceiro("tipo_lcdpr", r.tipo) : "") },
    { key: "entrada", label: "Entrada", align: "right", render: (r) => brl(r.entrada), text: (r) => r.entrada },
    { key: "saida", label: "Saída", align: "right", render: (r) => brl(r.saida), text: (r) => r.saida }
  ], [d?.idGlobal]);
  if (!pode) return null;
  return <div className="flex flex-col gap-2" data-testid="lcdpr-conferencia">
    <Card>
      <CardHeader title="Conferência do LCDPR" subtitle="Os lançamentos de caixa do período por imóvel rural e tipo (as transferências entre contas ficam fora). O arquivo oficial ainda não é gerado." />
      <CardBody className="grid grid-cols-12 gap-2 pt-0">
        <Field label="De" span={2} error={periodoInvalido ? "Período inválido" : undefined}><Input type="date" data-testid="lcdpr-filtro-de" value={f.de} onChange={(e) => set("de", e.target.value)} /></Field>
        <Field label="Até" span={2}><Input type="date" data-testid="lcdpr-filtro-ate" value={f.ate} onChange={(e) => set("ate", e.target.value)} /></Field>
        <Field label="Empresa" span={3}><RefSelect resource="empresas" value={f.empresa} onChange={(v) => set("empresa", v ?? "")} /></Field>
        {podeVerImoveis && <Field label="Imóvel rural" span={3}><RefSelect resource="imoveis_rurais" value={f.imovel} filter={f.empresa ? { empresa_id: f.empresa } : undefined} onChange={(v) => set("imovel", v ?? "")} /></Field>}
        <Field label="Tipo" span={2}><NativeSelect data-testid="lcdpr-filtro-tipo" value={f.tipo} onChange={(e) => set("tipo", e.target.value)}>
          <option value="">Todos</option>
          {TIPOS_DO_LIVRO.map((t) => <option key={t} value={t}>{rotuloFinanceiro("tipo_lcdpr", t)}</option>)}
        </NativeSelect></Field>
        <Field label="Situação" span={2}><NativeSelect data-testid="lcdpr-filtro-situacao" value={f.situacao} onChange={(e) => set("situacao", e.target.value as SituacaoConferenciaLcdpr)}>
          {SITUACOES_CONFERENCIA_LCDPR.map((s) => <option key={s} value={s}>{ROTULOS_FINANCEIRO.situacao_conferencia_lcdpr[s]}</option>)}
        </NativeSelect></Field>
      </CardBody>
    </Card>
    {d && <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {TIPOS_DO_LIVRO.map((t) => {
          const lado = LADO_DO_TIPO[t]; const outro = outroLado(lado);
          return <div key={t} data-testid={TESTID_DO_TOTAL[t]}>
            <Stat label={`${rotuloFinanceiro("tipo_lcdpr", t)} · ${ROTULO_DO_LADO[lado].toLowerCase()}`} value={brl(d.totais[t][lado])} tone={lado === "entradas" ? "green" : "red"}
              hint={`${ROTULO_DO_LADO[outro]}: ${brl(d.totais[t][outro])} · só as conferidas do período`} />
          </div>;
        })}
      </div>
      <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900" data-testid="lcdpr-pendencias">
        <b>Pendências do período:</b>{" "}
        <span data-testid="lcdpr-pendencia-sem-imovel">Sem imóvel: {d.pendencias.sem_imovel.quantidade} ({brl(d.pendencias.sem_imovel.valor)})</span>{" · "}
        <span data-testid="lcdpr-pendencia-sem-tipo">Sem tipo no LCDPR: {d.pendencias.sem_tipo.quantidade} ({brl(d.pendencias.sem_tipo.valor)})</span>
        {d.pendencias.sem_empresa && <>{" · "}<span data-testid="lcdpr-pendencia-sem-empresa">Sem empresa: {d.pendencias.sem_empresa.quantidade} ({brl(d.pendencias.sem_empresa.valor)})</span></>}
      </p>
    </>}
    {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
    <div className="flex min-h-[320px] flex-col" data-testid="lcdpr-tabela">
      <DataTable<LinhaConferencia> rows={d?.itens ?? []} total={d?.total} page={page} pageSize={POR_PAGINA} onPage={setPage} loading={q.isLoading}
        columns={colunas} emptyText={f.situacao === "pendentes" ? "Nenhuma pendência no período." : "Nenhum lançamento conferido no período."} />
    </div>
  </div>;
}
