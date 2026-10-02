"use client";
import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Eye, Star } from "lucide-react";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button, ErrorState, LoadingState } from "@/components/ui";
import { variantesDeVenda } from "@/features/sales/variantes";
import { variantesDeCompra } from "@/features/compras/variantes";
import { rotaDeLancamentoDeEstoque, todasAsVariantesDeEstoque } from "@/features/estoque/movimentacoes-variantes";
import { BASE_LAYOUTS, TEXTOS, chaveDetalhe, chaveLista, invalidarLayouts, lerLinhaLayout, rotuloDaTop } from "./contrato";
import { useTopsDoMovimento } from "./tops-do-movimento";

/**
 * STATUS DE USO DO LAYOUT (VENDAS-A3-1d, decisão 262) — responde, no topo da área, a pergunta que a A3-1c deixava sem
 * resposta: "a Central está usando ESTE layout?". Mesma regra da API (`layoutEfetivo`): layout inativo não vale em
 * lugar nenhum; ativo vale nas TOPs LIGADAS; se for o padrão do movimento, vale também nas TOPs do movimento que não
 * têm layout ATIVO ligado. Só apresenta: nenhuma regra nova, nenhuma rota nova. `can()` só esconde botão.
 *
 * ┌─ UM CACHE, UM FORMATO ────────────────────────────────────────────────────────────────────────────────────────┐
 * │ `chaveDetalhe(id)` e `chaveLista(f)` são compartilhadas pela área, grade, TOPs e este status. No TanStack Query  │
 * │ o `queryFn` usado num refetch é o do ÚLTIMO observador renderizado: por isso TODAS as peças guardam o JSON CRU  │
 * │ (`api<unknown>`) e convertem no `select`. Um `queryFn` que já devolvesse o formato "lido" trocaria o formato do │
 * │ cache depois de `invalidarLayouts` e quebraria quem lê o outro.                                                │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

export interface TopResumo { id: string; codigo: string; nome: string }
export type EstadoDeUso = "carregando" | "tops" | "padrao" | "nao-usado" | "inativo";

// ── leitura tolerante do JSON cru (GET admin /:id e lista), sem inventar valor ──
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const bool = (...vs: unknown[]): boolean | undefined => vs.find((v): v is boolean => typeof v === "boolean");
const itens = (v: unknown): unknown[] => (Array.isArray(v) ? v : Array.isArray(obj(v).items) ? (obj(v).items as unknown[]) : []);
function lerTop(v: unknown): TopResumo {
  if (typeof v === "string") return { id: v, codigo: "", nome: "" };
  const o = obj(v);
  return { id: str(o.id ?? o.tipoOperacaoId ?? o.tipo_operacao_id), codigo: str(o.codigo), nome: str(o.nome) };
}

/** `select` do detalhe (GET admin /:id cru): ativo, padrão e TOPs ligadas. Estável (fora do componente): memoizado. */
function lerUsoDoDetalhe(v: unknown): { ativo: boolean | undefined; padrao: boolean | undefined; ligadas: TopResumo[] } {
  const o = obj(v);
  return {
    ativo: bool(o.ativo, o.is_active, o.isActive), padrao: bool(o.padrao),
    ligadas: (Array.isArray(o.tops) ? o.tops : []).map(lerTop).filter((t) => t.id)
  };
}
/** `select` da lista (GET admin ?familia= cru). */
const lerLista = (v: unknown) => itens(v).map(lerLinhaLayout);

interface UsoCompleto {
  estado: EstadoDeUso; ligadas: TopResumo[]; valeEm: TopResumo[];
  /** também é o padrão do movimento (a segunda linha do estado "tops") */
  padrao: boolean;
  erro: unknown;
}

function useUso(layoutId: string, familia: string): UsoCompleto {
  const detalheQ = useQuery({
    queryKey: chaveDetalhe(layoutId),
    queryFn: () => api<unknown>(`${BASE_LAYOUTS}/${layoutId}`),
    select: lerUsoDoDetalhe,
    retry: false
  });
  const carregado = detalheQ.data !== undefined;

  // O GET /:id traz `is_active` e `padrao`. A lista (`chaveLista("")`) só é consultada se o detalhe não os trouxer.
  const precisaDaLista = carregado && (detalheQ.data.ativo === undefined || detalheQ.data.padrao === undefined);
  const listaQ = useQuery({
    queryKey: chaveLista(""),
    queryFn: () => api<unknown>(`${BASE_LAYOUTS}${qs({ familia: "" })}`),
    select: lerLista,
    enabled: precisaDaLista
  });
  const linha = precisaDaLista ? listaQ.data?.find((l) => l.id === layoutId) : undefined;
  const ativo = detalheQ.data?.ativo ?? linha?.ativo;
  const padrao = detalheQ.data?.padrao ?? linha?.padrao;
  const ligadas = React.useMemo(() => detalheQ.data?.ligadas ?? [], [detalheQ.data]);

  const movimento = useTopsDoMovimento(familia);

  const estado: EstadoDeUso = !carregado || ativo === undefined || padrao === undefined ? "carregando"
    : !ativo ? "inativo"
    : ligadas.length > 0 ? "tops"
    : padrao ? "padrao"
    : "nao-usado";

  const { tops: topsDoMovimento, ondeEsta } = movimento;
  const valeEm = React.useMemo(() => {
    if (estado === "carregando" || estado === "inativo") return [];
    const ids = new Set(ligadas.map((t) => t.id));
    // Padrão do movimento: vale nas TOPs ATIVAS do movimento sem layout ATIVO ligado (`ondeEsta` inclui este layout).
    const peloPadrao = padrao
      ? topsDoMovimento.filter((t) => t.ativo && !ondeEsta.has(t.id) && !ids.has(t.id)).map((t) => ({ id: t.id, codigo: t.codigo, nome: t.nome }))
      : [];
    return [...ligadas, ...peloPadrao];
  }, [estado, ligadas, padrao, topsDoMovimento, ondeEsta]);

  const erro = detalheQ.error ?? (precisaDaLista ? listaQ.error : null) ?? (padrao && estado !== "inativo" ? movimento.erro : null) ?? null;
  return { estado, ligadas, valeEm, padrao: Boolean(padrao), erro };
}

/**
 * Onde o layout está em uso. `ligadas` = TOPs ligadas (do detalhe); `valeEm` = TOPs em que a Central usa ESTE layout
 * (as ligadas e, sendo padrão e ativo, as TOPs ativas do movimento sem layout ligado). Inativo: `valeEm` vazio.
 */
export function useUsoDoLayout(layoutId: string, familia: string): { estado: EstadoDeUso; ligadas: TopResumo[]; valeEm: TopResumo[] } {
  const { estado, ligadas, valeEm } = useUso(layoutId, familia);
  return { estado, ligadas, valeEm };
}

/**
 * "ABRIR NA CENTRAL" — a Central do movimento: a de Vendas (`/vendas/<segmento>/new`), na COMPRAS-03 (decisão 269) a
 * de Compras (`/compras/<segmento>/new`) e, na OPERACOES-01 F5b (decisão 282), a de Estoque
 * (`/estoque/movimentacoes/<segmento>/new`, as sete espécies). O segmento da rota e a capacidade de lançar vêm do
 * registro de variantes de cada portal (`variantesDeVenda`, `variantesDeCompra`, `todasAsVariantesDeEstoque` — os donos
 * da rota e da permissão), nunca de um mapa aqui. Vendas primeiro e compras depois: os links de venda e de compra são
 * os de antes, byte a byte. Movimento que nenhum portal sabe lançar não tem Central: sem link.
 */
function centralDoMovimento(familia: string): { perm: string; rota: (topId: string) => string } | undefined {
  const venda = variantesDeVenda().find((v) => v.familia === familia);
  if (venda) return { perm: venda.perm, rota: (topId) => `/vendas/${venda.segmento}/new?tipo_operacao_id=${encodeURIComponent(topId)}` };
  const compra = variantesDeCompra().find((v) => v.familia === familia);
  if (compra) return { perm: compra.perm, rota: (topId) => `/compras/${compra.segmento}/new?tipo_operacao_id=${encodeURIComponent(topId)}` };
  // A rota de lançamento é a do portal de estoque (`rotaDeLancamentoDeEstoque`), a mesma do "+ Novo" da lista.
  const estoque = todasAsVariantesDeEstoque().find((v) => v.familia === familia);
  if (estoque) return { perm: estoque.perm, rota: (topId) => rotaDeLancamentoDeEstoque({ segmento: estoque.segmento, id: topId }) };
  return undefined;
}

/** POST /:id/padrao — "Usar como padrão do movimento" (a mesma rota da barra da grade). */
function useUsarComoPadrao(layoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`${BASE_LAYOUTS}/${layoutId}/padrao`, { method: "POST" }),
    onSuccess: () => { void invalidarLayouts(qc); }
  });
}

/** Faixa amarela "não está em uso" + Visualizar TOPs + Usar como padrão (status e confirmação de gravação). */
function FaixaNaoUsado({ layoutId, onVisualizarTops, testId, idVisualizar, idUsarPadrao }: {
  layoutId: string; onVisualizarTops: () => void; testId: string; idVisualizar: string; idUsarPadrao: string;
}) {
  const { can } = useAuth();
  const usar = useUsarComoPadrao(layoutId);
  return <div data-testid={testId} role="status" className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
    <div className="flex flex-wrap items-center gap-2">
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 font-medium">{TEXTOS.naoUsado}</span>
      {can("tipos_operacao.view") && <Button size="sm" variant="outline" data-testid={idVisualizar} onClick={onVisualizarTops}><Eye aria-hidden /> {TEXTOS.visualizarTops}</Button>}
      {can("tipos_operacao.edit") && <Button size="sm" data-testid={idUsarPadrao} loading={usar.isPending} onClick={() => usar.mutate()}><Star aria-hidden /> {TEXTOS.usarComoPadrao}</Button>}
    </div>
    {usar.isError && <ErrorState error={usar.error} />}
  </div>;
}

/**
 * Aviso da confirmação de gravação (W3 mostra quando o layout salvo NÃO está em uso). Os botões levam o `testId` como
 * prefixo (`<testId>-visualizar-tops`, `<testId>-usar-padrao`): o status de uso fica na tela ao mesmo tempo, e dois
 * elementos com o mesmo testid quebrariam a localização estrita dos E2E.
 */
export function AvisoNaoUsado({ layoutId, onVisualizarTops, testId }: { layoutId: string; onVisualizarTops: () => void; testId: string }) {
  return <FaixaNaoUsado layoutId={layoutId} onVisualizarTops={onVisualizarTops} testId={testId}
    idVisualizar={`${testId}-visualizar-tops`} idUsarPadrao={`${testId}-usar-padrao`} />;
}

/** Status de uso no topo da área de configuração (container `config-status`, data-estado). */
export function StatusDeUso({ layoutId, familia, rotuloMovimento, onVisualizarTops, sujo = false }: {
  layoutId: string; familia: string; rotuloMovimento: string; onVisualizarTops: () => void;
  /** rascunho com mudança não salva (VENDAS-A3-1d_R1): navegar agora descartaria o trabalho em silêncio */
  sujo?: boolean;
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const uso = useUso(layoutId, familia);
  const ativar = useMutation({
    mutationFn: () => api(`${BASE_LAYOUTS}/${layoutId}/ativo`, { method: "POST", body: { ativo: true } }),
    onSuccess: () => { void invalidarLayouts(qc); }
  });
  // "Abrir na Central": a rota do lançamento é a da variante do movimento (registry), de venda, de compra ou de
  // estoque. Sem variante, ou sem a capacidade de lançar nela, não há link — a Central recusaria.
  const central = React.useMemo(() => centralDoMovimento(familia), [familia]);
  const podeAbrir = central !== undefined && can(`${central.perm}.create`);

  const visualizar = can("tipos_operacao.view")
    ? <Button size="sm" variant="outline" data-testid="config-status-visualizar-tops" onClick={onVisualizarTops}><Eye aria-hidden /> {TEXTOS.visualizarTops}</Button>
    : null;
  const caixa = "flex flex-wrap items-center gap-2 rounded border px-3 py-2 text-[12.5px]";
  const emUso = "border-emerald-200 bg-emerald-50 text-emerald-900";

  return <section data-testid="config-status" data-estado={uso.estado} aria-label="Onde este layout está em uso" className="flex flex-col gap-1.5">
    {uso.estado === "carregando" && !uso.erro && <div className={cn(caixa, "border-slate-200 bg-white text-slate-600")}><LoadingState variant="inline" /></div>}

    {uso.estado === "tops" && <div className={cn(caixa, emUso, "flex-col items-stretch gap-1")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 font-medium">{TEXTOS.emUsoTops(uso.ligadas.map(rotuloDaTop).join(", "))}</span>
        {visualizar}
      </div>
      {uso.padrao && <p>{TEXTOS.emUsoPadrao(rotuloMovimento)}</p>}
    </div>}

    {uso.estado === "padrao" && <div className={cn(caixa, emUso)}>
      <span className="min-w-0 flex-1 font-medium">{TEXTOS.emUsoPadrao(rotuloMovimento)}</span>
      {visualizar}
    </div>}

    {uso.estado === "nao-usado" && <FaixaNaoUsado layoutId={layoutId} onVisualizarTops={onVisualizarTops} testId="config-status-nao-usado"
      idVisualizar="config-status-visualizar-tops" idUsarPadrao="config-status-usar-padrao" />}

    {uso.estado === "inativo" && <div className={cn(caixa, "border-slate-200 bg-slate-50 text-slate-700")}>
      <span className="min-w-0 flex-1 font-medium">{TEXTOS.inativo}</span>
      {can("tipos_operacao.edit") && <Button size="sm" data-testid="config-status-ativar" loading={ativar.isPending} onClick={() => ativar.mutate()}>Ativar</Button>}
    </div>}

    {podeAbrir && uso.valeEm.length > 0 && <ul aria-label="Abrir a Central nas TOPs em que o layout vale" className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-[12px] text-slate-600">
      {uso.valeEm.map((t) => <li key={t.id} className="flex items-center gap-1.5">
        <span>{rotuloDaTop(t)}</span>
        {sujo
          ? <button type="button" disabled data-testid="config-abrir-central" data-top-id={t.id} className="font-medium text-slate-400">{TEXTOS.abrirNaCentral}</button>
          : <Link data-testid="config-abrir-central" data-top-id={t.id} className="font-medium text-brand-700 underline-offset-2 hover:underline"
            href={central.rota(t.id)}>{TEXTOS.abrirNaCentral}</Link>}
      </li>)}
    </ul>}
    {/* A navegação do cliente não passa pelo useDirtyTab: com rascunho sujo, o link desliga em vez de descartar. */}
    {podeAbrir && uso.valeEm.length > 0 && sujo && <p data-testid="config-abrir-central-salvar-antes" className="px-1 text-[12px] text-amber-800">{TEXTOS.salvarAntesDeAbrirCentral}</p>}

    {ativar.isError && <ErrorState error={ativar.error} />}
    {uso.erro !== null && <ErrorState error={uso.erro} />}
  </section>;
}
