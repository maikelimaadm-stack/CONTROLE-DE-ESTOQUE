"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CARTOES_TITULO, ROTULOS_FINANCEIRO, TOM_DA_SITUACAO_TITULO, rotuloDoCartaoBaixados, rotuloFinanceiro, type CartaoTitulo, type GrupoOrigem, type SituacaoTitulo } from "@agro/domain";
import { api, qs, download } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { COPY } from "@/lib/copy";
import { brl, cn, dateBR } from "@/lib/utils";
import { Button, ErrorBox, Menu, StatusBadge } from "@/components/ui";
import { DataTable, colSpanAteColuna, colSpanAposColuna, type Column } from "@/components/ui/data-table";
import { colunaIdGlobalTabela } from "@/features/listing/id-global-coluna";
import { FilterBar, useFilters, type Filter } from "@/features/docs/shared";
import { DialogoBaixaEmLote, DialogoEstorno, DialogoVencimento, ResultadoDoLote, type ResultadoLote, type TituloDoLote } from "./titulos-lote";
import { useFinanceiroPelaTop } from "./capacidade";

export type DirecaoTitulo = "payable" | "receivable";
export type DirecaoDaCentral = DirecaoTitulo | "todos";

/** A linha da Central como o servidor a devolve (`GET /api/financeiro/titulos`): dinheiro em texto decimal. */
export type TituloLinha = {
  id: string; direcao: DirecaoTitulo; codigo: string; numero: string; empresa_id: string; empresa_nome: string;
  pessoa_id: string | null; pessoa_nome: string | null; emissao: string; competencia: string; vencimento: string;
  parcela: { numero: number; total: number }; valor: string; desconto: string; liquido: string; pago: string; saldo: string;
  status: string; situacao: SituacaoTitulo; situacao_rotulo: string; origem: { tipo: string | null; id: string | null; grupo: GrupoOrigem };
  bloqueado_pela_origem: boolean; eh_adiantamento: boolean; conta_prevista: { id: string; descricao: string | null } | null;
  tipo_titulo_nome: string | null; ultima_baixa: string | null; anexos: number; version: number; observacao: string; id_global?: number | null;
};
type Totais = { valor: string; pago: string; saldo: string };
type Cartao = { quantidade: number; valor: string; de?: string | null; ate?: string | null; disponivel?: boolean };
interface RespostaTitulos {
  items: TituloLinha[]; total: number; page: number; pageSize: number; idGlobal?: { rotulo: string };
  direcoes: DirecaoTitulo[]; totais: Partial<Record<DirecaoTitulo, Totais>>; cartoes: Record<CartaoTitulo, Cartao>;
}

const PERM: Record<DirecaoTitulo, string> = { payable: "payables", receivable: "receivables" };
const ROTA: Record<DirecaoTitulo, string> = { payable: "/financeiro/contas-a-pagar", receivable: "/financeiro/contas-a-receber" };
const ROTULO_DIRECAO: Record<DirecaoTitulo, string> = { payable: "A pagar", receivable: "A receber" };
/** Sem `financeiroPelaTop` (a API da F8): o cartão existe e se declara indisponível, como na F8. */
const PREVISTOS_INDISPONIVEIS = "Os previstos chegam com a provisão pela TOP";
/** O previsto é promessa de caixa: não recebe baixa (o servidor recusa com 409; o lote o pula). */
const PREVISTO_SEM_BAIXA = "Título previsto não recebe baixa";
/** O limite das rotas de lote (e da lista por página): o servidor recusa mais que isso. */
const LIMITE_DO_LOTE = 200;
/** Ordenação: coluna da grade → chave da whitelist do servidor (o resto da grade não ordena). */
const ORDEM: Record<string, string> = { codigo: "codigo", numero: "numero", pessoa_nome: "parceiro", emissao: "emissao", vencimento: "vencimento", liquido: "valor", saldo: "saldo" };

/**
 * Situação: os conjuntos que fazem sentido para quem filtra (o padrão, sem filtro, é tudo menos cancelado e previsto).
 * "Previsto" (F9, decisão 286) só existe com o financeiro pela TOP declarado: a API da F8 recusaria a situação.
 */
function situacoesDoFiltro(comPrevisto: boolean): { value: string; label: string }[] {
  return [
    { value: "a_vencer,vencido,parcial", label: "Em aberto (a vencer, vencido e parcial)" },
    ...(["a_vencer", "vencido", "parcial", "baixado", ...(comPrevisto ? ["previsto" as const] : []), "cancelado"] as const).map((s) => ({ value: s, label: ROTULOS_FINANCEIRO.situacao_titulo[s] })),
    { value: "a_vencer,vencido,parcial,baixado,cancelado", label: "Todas, inclusive canceladas" }
  ];
}
const ORIGENS: { value: string; label: string }[] = (Object.keys(ROTULOS_FINANCEIRO.origem_titulo) as GrupoOrigem[]).map((g) => ({ value: g, label: ROTULOS_FINANCEIRO.origem_titulo[g] }));
const CAMPOS_DE_PERIODO = (Object.keys(ROTULOS_FINANCEIRO.campo_periodo) as (keyof typeof ROTULOS_FINANCEIRO.campo_periodo)[]).map((c) => ({ value: c, label: ROTULOS_FINANCEIRO.campo_periodo[c] }));

/** O que os diálogos de lote precisam de uma linha. */
const paraOLote = (t: TituloLinha): TituloDoLote => ({ id: t.id, direcao: t.direcao, codigo: t.codigo, numero: t.numero, pessoa_nome: t.pessoa_nome, empresa_id: t.empresa_id, status: t.status, saldo: t.saldo });

/**
 * Valor digitado no filtro ("1.234,56", "100,5", "100.50") → o decimal canônico da API ("1234.56"). É a TELA lendo o
 * que o usuário escreveu; o que não for número segue como está e o servidor recusa (422) — nada é descartado calado.
 */
function valorDoFiltro(v: string | undefined): string | undefined {
  const t = (v ?? "").replace(/\s|R\$/g, "");
  if (!t) return undefined;
  if (/^-?\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) return t.replace(/\./g, "").replace(",", ".");
  if (/^-?\d+,\d{1,2}$/.test(t)) return t.replace(",", ".");
  return t;
}

/** TOPs que geram título (vendas e compras), para o filtro "Tipo de operação". Sem a capacidade de ver TOPs, sem filtro. */
function useOpcoesDeTop(): { value: string; label: string }[] {
  const { can } = useAuth();
  const pode = can("tipos_operacao.view");
  const q = useQuery({
    queryKey: ["financeiro-tops-dos-titulos"], enabled: pode, staleTime: 5 * 60_000, retry: false,
    queryFn: async () => {
      type Lista = { items: { id: string; codigo: string; nome: string }[] };
      const [vendas, compras] = await Promise.all([
        api<Lista>(`/api/admin/tipos-operacao${qs({ modulo: "vendas", pageSize: 200 })}`),
        api<Lista>(`/api/admin/tipos-operacao${qs({ modulo: "compras", pageSize: 200 })}`)
      ]);
      return [...vendas.items, ...compras.items];
    }
  });
  return React.useMemo(() => (pode ? (q.data ?? []).map((t) => ({ value: t.id, label: `${t.codigo} — ${t.nome}` })) : []), [pode, q.data]);
}

/**
 * TÍTULOS DA CENTRAL FINANCEIRA (OPERACOES-01 F8, decisão 285) — cada linha é uma parcela. Tudo no SERVIDOR: cartões
 * (que também filtram), filtros, ordenação, paginação e os totais do rodapé, com o MESMO recorte da lista. A grade é a
 * Base1 (`DataTable`), com seleção para as ações em lote: baixar, estornar baixa, alterar vencimento e exportar.
 * "Todos" mostra só as direções que o usuário vê (o servidor recorta). Dinheiro chega em texto e só é FORMATADO aqui.
 */
export function CentralTitulos({ direcao }: { direcao: DirecaoDaCentral }) {
  const { can } = useAuth(); const router = useRouter();
  // F9 (decisão 286): o previsto da provisão pela TOP — o cartão "Previstos" ligado e a situação "Previsto" no filtro.
  const pelaTop = useFinanceiroPelaTop();
  const tops = useOpcoesDeTop();
  const { f, set, reset } = useFilters({});
  const [aplicados, setAplicados] = React.useState<Record<string, string>>({});
  const [cartao, setCartao] = React.useState<CartaoTitulo | null>(null);
  const [page, setPage] = React.useState(1); const [pageSize, setPageSize] = React.useState(100);
  const [ordem, setOrdem] = React.useState<{ key: string; dir: "asc" | "desc" }>({ key: "vencimento", dir: "asc" });
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  const [dialogo, setDialogo] = React.useState<"baixa" | "estorno" | "vencimento" | null>(null);
  const [resultado, setResultado] = React.useState<ResultadoLote | null>(null);
  /** Linhas já vistas, por id: a seleção sobrevive à troca de página e as ações precisam da direção e do saldo. */
  const conhecidos = React.useRef(new Map<string, TituloLinha>());

  const consulta = React.useMemo(() => {
    const { valor_de, valor_ate, ...resto } = aplicados;
    return { direcao, ...resto, valor_de: valorDoFiltro(valor_de), valor_ate: valorDoFiltro(valor_ate), cartao: cartao ?? undefined, sort: ORDEM[ordem.key], dir: ordem.dir };
  }, [direcao, aplicados, cartao, ordem]);
  const q = useQuery({ queryKey: ["financeiro-titulos", consulta, page, pageSize], queryFn: () => api<RespostaTitulos>(`/api/financeiro/titulos${qs({ ...consulta, page, pageSize })}`) });
  // Registrado no próprio render (e não num efeito): a seleção feita nesta página já encontra as linhas dela.
  const pagina = React.useMemo(() => { for (const l of q.data?.items ?? []) conhecidos.current.set(l.id.toLowerCase(), l); return q.data?.items ?? []; }, [q.data]);
  const limparSelecao = () => setSel(new Set());
  const aplicar = (novos: Record<string, string>) => { setAplicados(novos); setPage(1); limparSelecao(); };

  const rotuloParceiro = direcao === "payable" ? "Fornecedor" : direcao === "receivable" ? "Cliente" : "Parceiro";
  const filtros: Filter[] = [
    { name: "situacao", label: COPY.situacao, type: "select", options: situacoesDoFiltro(pelaTop) },
    { name: "periodo_campo", label: "Período por", type: "select", options: CAMPOS_DE_PERIODO },
    { name: "periodo_de", label: "De", type: "date" },
    { name: "periodo_ate", label: "Até", type: "date" },
    { name: "pessoa_id", label: rotuloParceiro, type: "ref", resource: "people", extra: direcao === "payable" ? { is_provider: "true" } : direcao === "receivable" ? { is_client: "true" } : undefined },
    { name: "natureza_id", label: "Natureza", type: "ref", resource: "financial_categories" },
    { name: "centro_id", label: "Centro de resultado", type: "ref", resource: "cost_centers" },
    { name: "safra_id", label: "Safra", type: "ref", resource: "harvests" },
    { name: "area_id", label: "Área", type: "ref", resource: "areas" },
    { name: "conta_id", label: "Conta", type: "ref", resource: "bank_accounts" },
    { name: "empresa_id", label: "Empresa", type: "ref", resource: "empresas" },
    { name: "tipo_titulo_id", label: "Tipo de título", type: "ref", resource: "title_types" },
    { name: "origem", label: "Origem", type: "select", options: ORIGENS },
    // SEM OPÇÕES, SEM FILTRO: um select vazio é controle que aparece e não funciona (quem não vê TOPs não filtra por TOP).
    ...(tops.length ? [{ name: "tipo_operacao_id", label: "Tipo de operação", type: "select" as const, options: tops }] : []),
    { name: "busca", label: "Busca", type: "text" },
    { name: "valor_de", label: "Valor de", type: "text" },
    { name: "valor_ate", label: "Valor até", type: "text" },
    { name: "adiantamento", label: "Adiantamentos", type: "select", options: [{ value: "1", label: "Só adiantamentos" }, { value: "0", label: "Sem adiantamentos" }] }
  ];

  /** Colunas em UMA lista: a grade e o rodapé de totais leem a mesma coisa (`colSpanAteColuna`/`colSpanAposColuna`). */
  const colunas = React.useMemo<Column<TituloLinha>[]>(() => [
    ...(q.data?.idGlobal ? [colunaIdGlobalTabela<TituloLinha>(q.data.idGlobal.rotulo)] : []),
    { key: "codigo", label: "Código", sortable: true },
    { key: "numero", label: "Nº do documento", sortable: true },
    ...(direcao === "todos" ? [{ key: "direcao", label: "Direção", sortable: false, render: (r: TituloLinha) => ROTULO_DIRECAO[r.direcao], text: (r: TituloLinha) => ROTULO_DIRECAO[r.direcao] }] : []),
    { key: "empresa_nome", label: "Empresa", sortable: false },
    { key: "pessoa_nome", label: rotuloParceiro, sortable: true },
    { key: "emissao", label: "Emissão", sortable: true, render: (r) => dateBR(r.emissao), text: (r) => dateBR(r.emissao) },
    { key: "vencimento", label: "Vencimento", sortable: true, render: (r) => dateBR(r.vencimento), text: (r) => dateBR(r.vencimento) },
    { key: "parcela", label: "Parcela", sortable: false, render: (r) => `${r.parcela.numero}/${r.parcela.total}`, text: (r) => `${r.parcela.numero}/${r.parcela.total}` },
    { key: "liquido", label: "Valor", align: "right", sortable: true, render: (r) => brl(r.liquido), text: (r) => r.liquido },
    { key: "pago", label: "Pago", align: "right", sortable: false, render: (r) => brl(r.pago), text: (r) => r.pago },
    { key: "saldo", label: "Saldo", align: "right", sortable: true, render: (r) => brl(r.saldo), text: (r) => r.saldo },
    { key: "situacao", label: COPY.situacao, sortable: false, render: (r) => <StatusBadge domain="title_status" value={r.status} label={r.situacao_rotulo} tone={TOM_DA_SITUACAO_TITULO[r.situacao]} />, text: (r) => r.situacao_rotulo },
    { key: "origem", label: "Origem", sortable: false, render: (r) => rotuloFinanceiro("origem_titulo", r.origem.grupo), text: (r) => rotuloFinanceiro("origem_titulo", r.origem.grupo) },
    { key: "conta_prevista", label: "Conta prevista", sortable: false, render: (r) => r.conta_prevista?.descricao ?? "", text: (r) => r.conta_prevista?.descricao ?? "" },
    { key: "ultima_baixa", label: "Última baixa", sortable: false, render: (r) => (r.ultima_baixa ? dateBR(r.ultima_baixa) : ""), text: (r) => (r.ultima_baixa ? dateBR(r.ultima_baixa) : "") }
  ], [q.data?.idGlobal, direcao, rotuloParceiro]);

  // A seleção, com as linhas que a compõem (inclusive de páginas anteriores) e as direções presentes.
  const selecionados = React.useMemo(() => [...sel].map((id) => conhecidos.current.get(id.toLowerCase())).filter((x): x is TituloLinha => Boolean(x)), [sel, pagina]);
  const dirsSel = [...new Set(selecionados.map((t) => t.direcao))];
  const pode = (acao: string) => dirsSel.length > 0 && dirsSel.every((d) => can(`${PERM[d]}.${acao}`));
  const podeAlguma = (acao: string) => (direcao === "todos" ? (["payable", "receivable"] as const).some((d) => can(`${PERM[d]}.${acao}`)) : can(`${PERM[direcao]}.${acao}`));
  const excesso = sel.size > LIMITE_DO_LOTE ? `Selecione até ${LIMITE_DO_LOTE} títulos` : null;
  const motivoBaixar = excesso ?? (dirsSel.length > 1 ? "Selecione títulos de uma só direção" : selecionados.some((t) => t.status === "previsto") ? PREVISTO_SEM_BAIXA : !pode("settle") ? "Sem permissão para baixar estes títulos" : null);
  const doLote = React.useMemo<TituloDoLote[]>(() => selecionados.map(paraOLote), [selecionados]);
  const aoConcluir = (r: ResultadoLote) => { limparSelecao(); setResultado(r); };

  const exportar = async (formato: "csv" | "xlsx") => {
    try { await download(`/api/financeiro/titulos/exportar${qs({ ...consulta, formato, ids: sel.size ? [...sel].join(",") : undefined })}`, `titulos.${formato}`); }
    catch (e) { toast.error((e as Error).message); }
  };

  const dados = q.data;
  const totaisDoRodape = (dados?.direcoes ?? []).flatMap((d) => (dados?.totais[d] ? [[d, dados.totais[d]!] as const] : []));
  const depoisDoSaldo = colSpanAposColuna(colunas, "saldo", true);
  return <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="fin-titulos" data-direcao={direcao}>
    <div className="grid grid-cols-2 gap-2 md:grid-cols-5" role="group" aria-label="Cartões dos títulos">
      {CARTOES_TITULO.map((chave) => {
        const c = dados?.cartoes[chave];
        // Com o financeiro pela TOP, o cartão conta e filtra os previstos (a API diz `disponivel`); sem ele, o da F8.
        const indisponivel = chave === "previstos" && (!pelaTop || c?.disponivel === false);
        const rotulo = chave === "pagos_no_periodo" ? rotuloDoCartaoBaixados(direcao) : ROTULOS_FINANCEIRO.cartao_titulo[chave];
        return <button key={chave} type="button" data-testid={`fin-cartao-${chave}`} aria-pressed={cartao === chave} disabled={indisponivel} title={indisponivel ? PREVISTOS_INDISPONIVEIS : undefined}
          onClick={() => { setCartao(cartao === chave ? null : chave); setPage(1); limparSelecao(); }}
          className={cn("rounded-lg border bg-white px-3 py-2 text-left shadow-sm transition-colors hover:border-brand-600", cartao === chave && "border-brand-600 ring-1 ring-brand-600", indisponivel && "cursor-not-allowed opacity-60 hover:border-slate-200")}>
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{rotulo}</span>
          <span className="mt-0.5 flex items-baseline justify-between gap-2">
            <span className="text-lg font-semibold tabular-nums text-slate-800" data-testid="fin-cartao-quantidade">{c ? c.quantidade : "—"}</span>
            <span className="text-[12px] tabular-nums text-slate-600" data-testid="fin-cartao-valor">{c ? brl(c.valor) : "—"}</span>
          </span>
          {chave === "pagos_no_periodo" && c?.de && c?.ate && <span className="block text-[10.5px] text-slate-400">{dateBR(c.de)} a {dateBR(c.ate)}</span>}
        </button>;
      })}
    </div>

    <FilterBar f={f} set={set} reset={() => { reset(); aplicar({}); }} onApply={() => aplicar({ ...f })} filters={filtros} />

    <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Ações em lote">
      <span className="mr-1 text-[12px] text-slate-500" data-testid="fin-lote-contagem">{sel.size ? `${sel.size} selecionado(s)` : "Selecione títulos para agir em lote"}</span>
      {sel.size > 0 && podeAlguma("settle") && <Button size="sm" data-testid="fin-lote-baixar" disabled={Boolean(motivoBaixar)} title={motivoBaixar ?? undefined} onClick={() => setDialogo("baixa")}>Baixar selecionados</Button>}
      {sel.size > 0 && podeAlguma("cancel_settlement") && <Button size="sm" variant="outline" data-testid="fin-lote-estornar" disabled={Boolean(excesso) || !pode("cancel_settlement")} title={excesso ?? (!pode("cancel_settlement") ? "Sem permissão para estornar a baixa destes títulos" : undefined)} onClick={() => setDialogo("estorno")}>Estornar baixa</Button>}
      {sel.size > 0 && podeAlguma("edit") && <Button size="sm" variant="outline" data-testid="fin-lote-vencimento" disabled={Boolean(excesso) || !pode("edit")} title={excesso ?? (!pode("edit") ? "Sem permissão para alterar estes títulos" : undefined)} onClick={() => setDialogo("vencimento")}>Alterar vencimento</Button>}
      {podeAlguma("export") && <Menu trigger={<Button size="sm" variant="outline" data-testid="fin-lote-exportar" disabled={Boolean(excesso)} title={excesso ?? (sel.size ? "Exporta os títulos selecionados" : "Exporta os títulos do filtro")}>Exportar</Button>}
        items={[{ label: "Exportar CSV", onClick: () => void exportar("csv") }, { label: "Exportar Excel", onClick: () => void exportar("xlsx") }]} />}
      {sel.size > 0 && <Button size="sm" variant="ghost" onClick={limparSelecao}>Limpar seleção</Button>}
    </div>

    {q.error && <ErrorBox error={q.error} />}
    <DataTable<TituloLinha> rows={pagina} total={dados?.total} page={page} pageSize={pageSize} onPage={setPage}
      onPageSize={(s) => { setPageSize(Math.min(s, LIMITE_DO_LOTE)); setPage(1); }} loading={q.isLoading}
      sort={ordem} onSort={(key) => { if (!ORDEM[key]) return; setOrdem((o) => ({ key, dir: o.key === key && o.dir === "asc" ? "desc" : "asc" })); setPage(1); }}
      selectable selected={sel} onSelect={setSel} onRowClick={(r) => router.push(`${ROTA[r.direcao]}/${r.id}`)}
      emptyText="Nenhum título neste filtro"
      columns={colunas}
      footer={totaisDoRodape.length > 0 && <>{totaisDoRodape.map(([d, t]) => <tr key={d} data-testid="fin-titulos-totais" data-direcao={d}>
        <td colSpan={colSpanAteColuna(colunas, "liquido")} className="px-2 py-1">Totais do filtro{direcao === "todos" ? ` · ${ROTULO_DIRECAO[d]}` : ""}</td>
        <td className="num" data-total="valor">{brl(t.valor)}</td><td className="num" data-total="pago">{brl(t.pago)}</td><td className="num" data-total="saldo">{brl(t.saldo)}</td>
        {depoisDoSaldo > 0 && <td colSpan={depoisDoSaldo} />}
      </tr>)}</>} />

    {dirsSel.length === 1 && <DialogoBaixaEmLote open={dialogo === "baixa"} onOpenChange={(o) => setDialogo(o ? "baixa" : null)} direcao={dirsSel[0]!} titulos={doLote} aoConcluir={aoConcluir} />}
    <DialogoEstorno open={dialogo === "estorno"} onOpenChange={(o) => setDialogo(o ? "estorno" : null)} titulos={doLote} aoConcluir={aoConcluir} />
    <DialogoVencimento open={dialogo === "vencimento"} onOpenChange={(o) => setDialogo(o ? "vencimento" : null)} titulos={doLote} aoConcluir={aoConcluir} />
    <ResultadoDoLote resultado={resultado} onOpenChange={(o) => { if (!o) setResultado(null); }} titulos={new Map([...conhecidos.current].map(([k, t]) => [k, paraOLote(t)]))} />
  </div>;
}
