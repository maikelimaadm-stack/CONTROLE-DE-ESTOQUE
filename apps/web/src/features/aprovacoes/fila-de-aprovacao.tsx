"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BASE1_DEFAULT_PAGE_SIZE } from "@agro/shared";
import { api, ApiError, newIdem, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { COPY, enumLabel } from "@/lib/copy";
import { brl, cn, dateBR } from "@/lib/utils";
import { Button, Card, EmptyState, ErrorState, LoadingState, StatusBadge, safeErrorMessage } from "@/components/ui";
import { DataTable, type Column } from "@/components/ui/data-table";
import { colunaIdGlobalTabela } from "@/features/listing/id-global-coluna";
import {
  CONFIGURACAO_DAS_AREAS, MSG_APROVACOES_INDISPONIVEIS, MSG_DOCUMENTO_MUDOU_NA_FILA, MSG_FILA_VAZIA,
  chaveDaFila, corpoDaDecisao, filaAusente, mensagemDaAprovacao, portaDaDecisaoAusente, valorDaSituacaoNaFila,
  type AreaDeAprovacao, type Decisao, type LinhaDaFila, type MensagemDaFila, type PaginaDaFila, type RespostaDaDecisao, type TomDaMensagem
} from "./areas-de-aprovacao";
import { DialogoDaDecisao } from "./decisao-de-aprovacao";

/**
 * UMA ABA DO MÓDULO APROVAÇÕES — A FILA DE UMA ÁREA (TOP-CONFIG-08, decisão 277). SEM DESENHO NOVO.
 *
 * O que está aqui é montagem de peças que já existem: a grade do modelo base (`DataTable`, paginação do SERVIDOR,
 * como a lista de Animais), o `Dialog` oficial com `Field`/`Textarea` (o mesmo do "Cancelar documento" da Central de
 * Estoque; desde a OPERACOES-01 F2 ele mora em `decisao-de-aprovacao.tsx`, que a consulta do documento também usa) e
 * o `StatusBadge` central. Nenhum estilo novo: os avisos usam as mesmas classes dos avisos de hoje.
 *
 * O SERVIDOR É A AUTORIDADE DE PONTA A PONTA:
 *   · a fila (`GET /api/aprovacoes/<área>`) já vem recortada — documentos abertos que exigem aprovação e não têm
 *     aprovação vigente, no escopo de empresa de quem aprova; no estoque, só das espécies que a pessoa aprova;
 *   · "Aprovar" e "Reprovar" aparecem só para quem tem `<família>.approve` (`can()` esconde; a rota nega);
 *   · depois de qualquer decisão a fila é perguntada de novo — a linha aprovada sai, a reprovada volta como
 *     "Reprovado". Nada é removido ou trocado na mão aqui: o que a tela mostra é sempre o que o servidor disse.
 *
 * SKEW (web nova, API anterior): a API anterior não tem `/api/aprovacoes/*` e responde 404 à fila. A aba diz que as
 * aprovações ainda não estão disponíveis neste servidor — nunca uma lista vazia, que afirmaria "nada a aprovar". O
 * resto do sistema não depende deste módulo.
 */
export function FilaDeAprovacao({ area }: { area: AreaDeAprovacao }) {
  const cfg = CONFIGURACAO_DAS_AREAS[area];
  const { can } = useAuth(); const router = useRouter(); const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<number>(BASE1_DEFAULT_PAGE_SIZE);
  const q = useQuery<PaginaDaFila, ApiError>({
    queryKey: [...chaveDaFila(area), page, pageSize],
    queryFn: () => api<PaginaDaFila>(`${cfg.porta}${qs({ page, pageSize })}`),
    placeholderData: keepPreviousData,
    retry: false
  });

  // A decisão: a linha como a fila a mostrou (a `version` da venda vem dela) e a ação escolhida. Ela continua guardada
  // enquanto o diálogo fecha — o título não pisca vazio na animação de saída.
  const [decisao, setDecisao] = React.useState<{ linha: LinhaDaFila; decisao: Decisao } | null>(null);
  const [aberto, setAberto] = React.useState(false);
  const [texto, setTexto] = React.useState("");
  const [erroDoDialogo, setErroDoDialogo] = React.useState<string | null>(null);
  const [mensagem, setMensagem] = React.useState<MensagemDaFila | null>(null);
  // Uma chave por decisão aberta: o reenvio do MESMO clique devolve o corpo gravado e nunca decide duas vezes; uma
  // decisão nova (ou a mesma, depois de um erro) leva chave nova.
  const chave = React.useRef(newIdem());

  const abrirDecisao = (linha: LinhaDaFila, d: Decisao) => {
    chave.current = newIdem(); setTexto(""); setErroDoDialogo(null); setDecisao({ linha, decisao: d }); setAberto(true);
  };
  const decidir = useMutation<RespostaDaDecisao, Error, { linha: LinhaDaFila; decisao: Decisao; texto: string }>({
    mutationFn: async ({ linha, decisao: d, texto: t }) => {
      const doc = cfg.documento(linha.especie);
      // Sem documento endereçável não há botão; isto só protege contra a linha que mudou de espécie entre cliques.
      if (!doc) throw new Error(COPY.erroGenerico);
      return api<RespostaDaDecisao>(cfg.portaDaDecisao(linha, doc, d), { method: "POST", body: corpoDaDecisao(area, linha.version, d, t), idempotencyKey: chave.current });
    },
    onSuccess: (resposta, { decisao: d }) => {
      setAberto(false);
      // Reprovar não tem mensagem própria: a linha volta da fila como "Reprovado", e isso é a resposta.
      setMensagem(d === "aprovar" ? mensagemDaAprovacao(resposta) : null);
      // A aprovação pode ter CONFIRMADO o documento (TOP automática): saldo, títulos e listas mudaram — tudo o que os
      // mostra é perguntado de novo, como depois do Confirmar da Central.
      void qc.invalidateQueries();
    },
    onError: (e) => {
      chave.current = newIdem();
      // Corpo recusado (motivo vazio, texto longo demais): o diálogo continua aberto, com o motivo do servidor.
      if (e instanceof ApiError && e.status === 422) { setErroDoDialogo(e.message); return; }
      setAberto(false);
      if (portaDaDecisaoAusente(e)) setMensagem({ texto: MSG_APROVACOES_INDISPONIVEIS, tom: "aviso" });
      // A venda mudou depois que a fila foi carregada (outra versão): a fila é recarregada e a pessoa confere de novo.
      else if (e instanceof ApiError && e.code === "CONCURRENCY_CONFLICT") setMensagem({ texto: MSG_DOCUMENTO_MUDOU_NA_FILA, tom: "aviso" });
      // O resto (documento que deixou de estar aberto, que não exige mais aprovação, sem permissão, invisível): a
      // mensagem é a do servidor, e a fila recarregada mostra o estado real.
      else setMensagem({ texto: safeErrorMessage(e), tom: "erro" });
      void qc.invalidateQueries({ queryKey: chaveDaFila(area) });
    }
  });

  // A última linha da última página foi decidida: a página deixou de existir — volta para a última que existe.
  const total = q.data?.total ?? 0;
  const paginaSemLinhas = Boolean(q.data && q.data.items.length === 0);
  React.useEffect(() => {
    if (paginaSemLinhas && page > 1) setPage(Math.max(1, Math.ceil(total / pageSize)));
  }, [paginaSemLinhas, page, total, pageSize]);

  if (q.isPending) return <div className="flex min-h-0 flex-1 flex-col"><LoadingState /></div>;
  if (filaAusente(q.error)) {
    return <p data-testid="aprovacoes-indisponivel" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">{MSG_APROVACOES_INDISPONIVEIS}</p>;
  }
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const acoes = (l: LinhaDaFila) => {
    const doc = cfg.documento(l.especie);
    if (!doc) return null;
    const podeAbrir = can(`${doc.perm}.view`);
    const podeDecidir = can(`${doc.perm}.approve`);
    // O clique no botão não seleciona a linha (a seleção é do clique na linha, como no "Ação" do motor).
    return <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {podeAbrir && <Button size="sm" variant="outline" data-testid={`aprovacao-abrir-${l.id}`} onClick={() => router.push(cfg.rotaDaConsulta(l, doc))}>Abrir</Button>}
      {podeDecidir && <Button size="sm" data-testid={`aprovacao-aprovar-${l.id}`} onClick={() => abrirDecisao(l, "aprovar")}>Aprovar</Button>}
      {podeDecidir && <Button size="sm" variant="danger" data-testid={`aprovacao-reprovar-${l.id}`} onClick={() => abrirDecisao(l, "reprovar")}>Reprovar</Button>}
    </span>;
  };
  const colunas: Column<LinhaDaFila>[] = [
    // O ID Global na frente, SÓ quando a resposta o declara (o molde da lista de Animais): os três documentos da fila
    // são do catálogo, e a fila não pode ser a única lista deles sem o número.
    ...(q.data?.idGlobal ? [colunaIdGlobalTabela<LinhaDaFila>(q.data.idGlobal.rotulo)] : []),
    {
      key: "codigo", label: "Documento", filterable: false,
      // A linha leva o contrato do teste (id, código, espécie e situação que o SERVIDOR devolveu).
      render: (l) => <span data-testid="aprovacao-linha" data-id={l.id} data-codigo={l.codigo} data-especie={l.especie} data-situacao={l.situacao}>{l.codigo}</span>,
      text: (l) => l.codigo
    },
    { key: "data", label: "Data", filterable: false, text: (l) => dateBR(l.data) },
    cfg.temValor
      ? { key: "parceiro", label: cfg.rotuloDoParceiro, filterable: false, text: (l) => l.parceiro?.nome ?? "—" }
      : { key: "especie", label: cfg.rotuloDoParceiro, filterable: false, text: (l) => enumLabel("especie_documento_estoque", l.especie) },
    { key: "empresa", label: "Empresa", filterable: false, text: (l) => l.empresa.nome },
    { key: "operacao", label: "Operação", filterable: false, text: (l) => l.operacao.nome },
    ...(cfg.temValor ? [{ key: "valor", label: "Valor", align: "right" as const, filterable: false, text: (l: LinhaDaFila) => brl(l.valor) }] : []),
    { key: "lancadoPor", label: "Lançado por", filterable: false, text: (l) => l.lancadoPor?.nome ?? "—" },
    {
      key: "situacao", label: COPY.situacao, filterable: false,
      // Na reprovada, o motivo da última decisão fica na dica do selo (o texto é o que quem reprovou escreveu).
      render: (l) => <StatusBadge domain="status" value={valorDaSituacaoNaFila(l.situacao)} title={l.ultimaDecisao?.decisao === "reprovado" ? l.ultimaDecisao.observacao ?? undefined : undefined} />,
      text: (l) => enumLabel("status", valorDaSituacaoNaFila(l.situacao))
    },
    // As ações em coluna própria, e não no "Ação" de 120 px do motor: três botões com texto não cabem nele.
    { key: "__acoes", label: "Ação", width: 250, align: "center", hideable: false, resizable: false, freezable: false, autoFit: false, filterable: false, render: acoes, text: () => "" }
  ];

  const linhas = q.data?.items ?? [];
  return <div data-testid="aprovacoes-lista" data-area={area} data-total={total} className="flex min-h-0 flex-1 flex-col gap-2">
    {mensagem && <p data-testid="aprovacao-mensagem" data-tom={mensagem.tom} role="status" className={cn("rounded border px-3 py-2 text-[12.5px]", CLASSES_DO_AVISO[mensagem.tom])}>{mensagem.texto}</p>}
    {total === 0 && linhas.length === 0
      ? <Card data-testid="aprovacoes-vazia"><EmptyState title={MSG_FILA_VAZIA} /></Card>
      : <DataTable<LinhaDaFila> columns={colunas} rows={linhas} total={total} page={page} pageSize={pageSize} loading={q.isFetching}
        onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} rowKey={(l) => l.id} emptyText={MSG_FILA_VAZIA} />}

    <DialogoDaDecisao aberto={aberto} onFechar={() => setAberto(false)} decisao={decisao?.decisao ?? null} codigo={decisao?.linha.codigo ?? ""}
      texto={texto} onTexto={setTexto} erro={erroDoDialogo} ocupado={decidir.isPending}
      onEnviar={() => { if (decisao) decidir.mutate({ linha: decisao.linha, decisao: decisao.decisao, texto }); }} />
  </div>;
}

/** As mesmas classes dos avisos de hoje (sucesso, aviso e erro) — nenhum estilo novo. */
const CLASSES_DO_AVISO: Readonly<Record<TomDaMensagem, string>> = {
  sucesso: "border-emerald-200 bg-emerald-50 text-emerald-900",
  aviso: "border-amber-200 bg-amber-50 text-amber-900",
  erro: "border-red-200 bg-red-50 text-red-800"
};
