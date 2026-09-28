"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ApiError, api, qs } from "@/lib/api";
import { COPY } from "@/lib/copy";
import { Button, Dialog, EmptyState, ErrorState, LoadingState, NativeSelect } from "@/components/ui";
import { familiaTemLayout } from "@agro/domain";
import { BASE_LAYOUTS, TEXTOS, chaveDetalhe, chaveLista, lerLinhaLayout, type LayoutLinha } from "./contrato";
import { BarraGrade } from "./barra-grade";
import { GradeLayouts } from "./grade";
import { AreaConfiguracao } from "./pagina";
import { VisualizarTopsDialogo } from "./tops-lista-dupla";
import { NovoLayoutAssistente } from "./novo-layout";

/**
 * CONFIGURAÇÕES › OPERAÇÕES › LAYOUTS DE DOCUMENTO — A TELA ÚNICA (VENDAS-A3-1d, decisão 262).
 *
 * Em cima a GRADE dos layouts (com a barra que age sobre a linha selecionada e o filtro de movimento); clicar numa
 * linha SELECIONA e abre a ÁREA DE CONFIGURAÇÃO dela logo abaixo, na mesma tela, sem navegar. A rota
 * `/configuracoes/layouts-documento/<id>` monta esta mesma tela com a linha já selecionada (`idInicial`).
 *
 * RASCUNHO SUJO: a área avisa por `onSujo`. Trocar de linha ou pedir Novo com o rascunho sujo pergunta antes
 * (`TEXTOS.descartarRascunho`); "Descartar" remonta a área (o rascunho sai de verdade) e segue com o pedido; "Voltar"
 * não muda nada. Se a linha selecionada sair da lista por causa do filtro, a área continua aberta (o id continua).
 *
 * Os movimentos vêm do servidor (`/api/admin/tipos-operacao/familias`), recortados por `familiaTemLayout`; o cliente
 * não tem lista própria. `can()` só esconde botão (na barra e na área); quem nega é a rota.
 */

interface Familia { codigo: string; rotulo: string }
/** O que o usuário pediu e que, com o rascunho sujo, espera a resposta da pergunta. */
type Pedido = { tipo: "linha"; id: string } | { tipo: "novo" };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const itens = (v: unknown): unknown[] => (Array.isArray(v) ? v : Array.isArray(obj(v).items) ? (obj(v).items as unknown[]) : []);
/**
 * A chave `chaveLista` é COMPARTILHADA com outras peças (assistente, TOPs, status de uso): o cache guarda a resposta
 * CRUA do GET e cada peça converte no `select`. Assim ninguém recebe a lista no formato de outra.
 */
const lerLista = (v: unknown): LayoutLinha[] => itens(v).map(lerLinhaLayout);
const buscarLista = (familia: string) => api<unknown>(`${BASE_LAYOUTS}${qs({ familia })}`);

/**
 * Nome de um layout pela lista de todos os movimentos (a MESMA chave e o mesmo cache da grade sem filtro) — para o
 * título da aba da rota `/configuracoes/layouts-documento/<id>`. Dentro de Configurações ninguém renomeia a aba.
 */
export function useNomeDoLayout(id: string): string | undefined {
  const q = useQuery({ queryKey: chaveLista(""), queryFn: () => buscarLista(""), select: lerLista });
  return q.data?.find((l) => l.id === id)?.nome || undefined;
}

export function TelaLayouts({ idInicial, sincronizarEndereco = false }: { idInicial?: string; sincronizarEndereco?: boolean }) {
  const [filtro, setFiltro] = React.useState("");
  const [selecionadoId, setSelecionadoId] = React.useState<string | null>(idInicial ?? null);
  /**
   * VENDAS-A3-1d_R1 — o id que veio do ENDEREÇO é pedido, não fato: antes de abrir a área, o GET do layout confirma que
   * ele existe. 404 → nenhuma linha, nenhuma mensagem, e o `layout=` sai do endereço. Não se decide pela página da
   * grade: layout válido fora da página visível continua selecionável.
   */
  const [aVerificar, setAVerificar] = React.useState<string | null>(sincronizarEndereco ? idInicial ?? null : null);
  const verificacao = useQuery({
    queryKey: chaveDetalhe(aVerificar ?? ""), queryFn: () => api<unknown>(`${BASE_LAYOUTS}/${aVerificar}`),
    enabled: aVerificar !== null, retry: false
  });
  React.useEffect(() => {
    if (aVerificar === null) return;
    if (verificacao.isSuccess) setAVerificar(null);
    else if (verificacao.isError) {
      if (verificacao.error instanceof ApiError && verificacao.error.status === 404) {
        setSelecionadoId((atual) => (atual === aVerificar ? null : atual));
      }
      setAVerificar(null);
    }
  }, [aVerificar, verificacao.isSuccess, verificacao.isError, verificacao.error]);

  // Toda seleção (clique, troca confirmada, Novo/Duplicar/Importar, exclusão) vai para `&layout=` com replace:
  // sem recarregar, sem remontar a área e sem aba de trabalho nova. Os outros parâmetros (tab, sub) ficam.
  const router = useRouter();
  React.useEffect(() => {
    if (!sincronizarEndereco || aVerificar !== null) return;
    const url = new URL(window.location.href);
    if ((url.searchParams.get("layout") ?? null) === selecionadoId) return;
    if (selecionadoId) url.searchParams.set("layout", selecionadoId); else url.searchParams.delete("layout");
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }, [sincronizarEndereco, selecionadoId, aVerificar, router]);
  /** Remonta a área depois de "Descartar" (o rascunho da mesma linha sai de verdade antes de abrir o Novo). */
  const [geracao, setGeracao] = React.useState(0);
  const [pendente, setPendente] = React.useState<Pedido | null>(null);
  const [novo, setNovo] = React.useState(false);
  const [topsAberto, setTopsAberto] = React.useState(false);
  /**
   * Rascunho sujo da área. Ref, não estado: só a decisão de perguntar o lê, e ela pode vir de um retorno assíncrono
   * da barra (duplicar/importar selecionam a linha nova) — o ref dá o valor de AGORA, não o do render do clique.
   */
  const sujo = React.useRef(false);
  const marcarSujo = React.useCallback((s: boolean) => { sujo.current = s; }, []);

  const familiasQ = useQuery({
    queryKey: ["tipos-operacao", "familias"],
    queryFn: () => api<{ items: Familia[] }>("/api/admin/tipos-operacao/familias")
  });
  const familias = React.useMemo(
    () => (familiasQ.data?.items ?? []).filter((f) => familiaTemLayout(f.codigo)).map((f) => ({ codigo: f.codigo, rotulo: f.rotulo })),
    [familiasQ.data]
  );
  const rotuloMovimento = React.useCallback((c: string) => familias.find((f) => f.codigo === c)?.rotulo ?? c, [familias]);

  const lista = useQuery({ queryKey: chaveLista(filtro), queryFn: () => buscarLista(filtro), select: lerLista });
  const linhas = lista.data ?? [];
  const naLista = selecionadoId ? linhas.find((l) => l.id === selecionadoId) ?? null : null;
  // Selecionada fora do filtro: a barra e o diálogo de TOPs leem a linha da lista de todos os movimentos.
  const todas = useQuery({
    queryKey: chaveLista(""), queryFn: () => buscarLista(""), select: lerLista,
    enabled: Boolean(selecionadoId) && filtro !== "" && lista.isSuccess && !naLista
  });
  const linha: LayoutLinha | null = naLista ?? (selecionadoId ? todas.data?.find((l) => l.id === selecionadoId) ?? null : null);

  const executar = (p: Pedido) => {
    if (p.tipo === "novo") { setNovo(true); return; }
    sujo.current = false;
    setTopsAberto(false);
    setSelecionadoId(p.id);
  };
  const pedir = (p: Pedido) => {
    if (p.tipo === "linha" && p.id === selecionadoId) return;
    if (sujo.current) setPendente(p); else executar(p);
  };
  const descartar = () => {
    const p = pendente;
    setPendente(null);
    sujo.current = false;
    setGeracao((g) => g + 1);
    if (p) executar(p);
  };
  const selecionar = (id: string) => pedir({ tipo: "linha", id });
  const abrirTops = () => setTopsAberto(true);

  // Rota com a linha já selecionada: a grade rola até ela uma vez (a grade tem altura limitada; a área fica abaixo).
  const telaRef = React.useRef<HTMLDivElement>(null);
  const rolou = React.useRef(false);
  React.useEffect(() => {
    if (rolou.current || !idInicial || naLista?.id !== idInicial) return;
    rolou.current = true;
    telaRef.current?.querySelector(`[data-testid="layout-linha-${CSS.escape(idInicial)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [idInicial, naLista]);

  return <div ref={telaRef} data-testid="layouts-tela" className="flex flex-col gap-3">
    <BarraGrade linha={linha} familias={familias} onNovo={() => pedir({ tipo: "novo" })} onSelecionar={selecionar}
      onVisualizarTops={abrirTops}
      onExcluido={() => { sujo.current = false; setTopsAberto(false); setSelecionadoId(null); }} />

    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect aria-label="Movimento" data-testid="layouts-filtro-familia" className="w-56" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
        <option value="">Todos os movimentos</option>
        {familias.map((f) => <option key={f.codigo} value={f.codigo}>{f.rotulo}</option>)}
      </NativeSelect>
    </div>

    <div data-testid="layouts-documento" className="flex max-h-[45dvh] flex-col print:max-h-none">
      {lista.isPending ? <LoadingState />
        : lista.isError ? <ErrorState error={lista.error} onRetry={() => { void lista.refetch(); }} />
        : linhas.length === 0 ? <EmptyState title="Nenhum layout cadastrado" description="Sem layout, a Central usa o layout do sistema." />
        : <GradeLayouts linhas={linhas} selecionadoId={selecionadoId} onSelecionar={selecionar} rotuloMovimento={rotuloMovimento} />}
    </div>

    {selecionadoId && aVerificar === selecionadoId ? <LoadingState />
      : selecionadoId
      ? <AreaConfiguracao key={`${selecionadoId}:${geracao}`} id={selecionadoId} onSujo={marcarSujo} onVisualizarTops={abrirTops} />
      : linhas.length > 0 && <p data-testid="layouts-sem-selecao"
        className="rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-[12.5px] text-slate-500">
        Selecione um layout na grade para configurar.
      </p>}

    {topsAberto && selecionadoId && linha && <VisualizarTopsDialogo key={selecionadoId} layoutId={selecionadoId} familia={linha.familia}
      onFechar={() => setTopsAberto(false)} />}
    {novo && <NovoLayoutAssistente familias={familias} onFechar={() => setNovo(false)}
      onCriado={(id) => { setNovo(false); selecionar(id); }} />}

    {/* Não é o ConfirmDialog porque ele não leva testid nos botões; mesmo visual (Dialog sm + rodapé Voltar/Descartar). */}
    <Dialog open={pendente !== null} onOpenChange={(o) => { if (!o) setPendente(null); }} title="Descartar alterações" size="sm"
      testId="config-descartar-dialogo"
      footer={<>
        <Button variant="outline" data-testid="config-descartar-voltar" onClick={() => setPendente(null)}>{COPY.voltar}</Button>
        <Button variant="danger" data-testid="config-descartar" onClick={descartar}>Descartar</Button>
      </>}>
      <p className="text-sm text-slate-600">{TEXTOS.descartarRascunho}</p>
    </Dialog>
  </div>;
}
