"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, newIdem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { Button, StatusBadge, safeErrorMessage } from "@/components/ui";
import estilosCentral from "@/features/central/moldura.module.css";
import {
  MSG_APROVACOES_INDISPONIVEIS, MSG_DOCUMENTO_MUDOU_NA_CONSULTA,
  PERMISSAO_DA_PORTA_DA_DECISAO, chaveDaSituacaoDoDocumento, corpoDaDecisao, documentoDaConsulta, lerSituacaoDoDocumento, mensagemDaAprovacao,
  portaDaDecisaoAusente, portaDaDecisaoDoDocumento, portaDaSituacaoDoDocumento, textoDaUltimaDecisao, valorDaSituacaoNaFila,
  type AreaDaConsulta, type Decisao, type RespostaDaDecisao, type TomDaMensagem
} from "./areas-de-aprovacao";
import { DialogoDaDecisao } from "./decisao-de-aprovacao";

export interface PropsDaAprovacaoDoDocumento {
  area: AreaDaConsulta;
  documentoId: string;
  /** O documento está aberto (a consulta já sabe). Fechado, nada é perguntado nem desenhado. */
  documentoAberto: boolean;
  /** Na venda, a `version` do documento que a tela mostra: a decisão vale para o conteúdo visto (mudou → 409). */
  versao?: string;
  /** O prefixo de testid da Central que monta o bloco. */
  prefixoTestid: string;
  /** O código do documento, para o título do diálogo. */
  codigo: string;
  /**
   * A espécie do documento, quando NÃO é a da consulta da área (OPERACOES-01 F6b, decisão 283: o pedido de compra, que
   * se aprova ao finalizar). Com ela, Aprovar/Reprovar exigem também a capacidade da porta da rota de decisão
   * (`compras.approve`) — a rota cobra as duas, AND. Ausente: a espécie da área (a venda, a compra), como antes.
   */
  especie?: string;
}

/** O tom da mensagem da aprovação → a função do `toast` que a mostra. */
const TOAST_DO_TOM: Readonly<Record<TomDaMensagem, "success" | "warning" | "error">> = Object.freeze({ sucesso: "success", aviso: "warning", erro: "error" });

/**
 * A APROVAÇÃO NA CONSULTA DO DOCUMENTO (OPERACOES-01 F2, decisão 279) — a venda e a compra; desde a F6b (decisão 283),
 * também o pedido de compra (`especie="pedido"`), cuja aprovação vale ao finalizar.
 *
 * O SERVIDOR É A AUTORIDADE: a situação vem de `GET /api/aprovacoes/<área>/<id>` (a mesma régua da fila e do Confirmar),
 * e a decisão vai pelas MESMAS rotas e pelo MESMO diálogo da fila de Aprovações. Nenhuma regra nasce aqui:
 *   · o bloco só aparece quando há o que dizer — documento aberto cuja TOP exige aprovação (pendente, aprovado ou
 *     reprovado). Documento fechado, carregando, aprovação não exigida, resposta fora da forma ou QUALQUER erro: nada
 *     é desenhado. Na API anterior a rota não existe e responde o 404 de rota: o bloco não aparece, e a prévia do
 *     Confirmar continua explicando a recusa, como antes;
 *   · "Aprovar" e "Reprovar" aparecem só para quem tem `<família>.approve` (`can()` só esconde; a rota nega) e só em
 *     pendente ou reprovado — o mesmo recorte da fila;
 *   · depois de qualquer decisão TUDO é perguntado de novo: a aprovação pode ter CONFIRMADO o documento (TOP de
 *     Confirmação Automática), e situação, prévia, títulos e saldo mudam juntos.
 * A situação e a última decisão saem do vocabulário central (`StatusBadge`/`enumLabel`) e dos textos de
 * `areas-de-aprovacao` — nenhum rótulo, tom ou estilo novo.
 */
export function AprovacaoDoDocumento({ area, documentoId, documentoAberto, versao, prefixoTestid, codigo, especie }: PropsDaAprovacaoDoDocumento) {
  const { can } = useAuth(); const qc = useQueryClient();
  const q = useQuery({
    queryKey: chaveDaSituacaoDoDocumento(area, documentoId),
    queryFn: () => api<unknown>(portaDaSituacaoDoDocumento(area, documentoId)),
    enabled: documentoAberto,
    retry: false
  });

  // A decisão escolhida continua guardada enquanto o diálogo fecha (o título não pisca vazio na animação de saída).
  const [decisao, setDecisao] = React.useState<Decisao | null>(null);
  const [aberto, setAberto] = React.useState(false);
  const [texto, setTexto] = React.useState("");
  const [erroDoDialogo, setErroDoDialogo] = React.useState<string | null>(null);
  // Uma chave por abertura do diálogo: o reenvio do MESMO clique devolve o corpo gravado e nunca decide duas vezes; uma
  // abertura nova (ou o envio depois de um erro) leva chave nova.
  const chave = React.useRef(newIdem());

  const abrirDecisao = (d: Decisao) => {
    chave.current = newIdem(); setTexto(""); setErroDoDialogo(null); setDecisao(d); setAberto(true);
  };
  const decidir = useMutation<RespostaDaDecisao, Error, { decisao: Decisao; texto: string }>({
    mutationFn: ({ decisao: d, texto: t }) => api<RespostaDaDecisao>(portaDaDecisaoDoDocumento(area, documentoId, d), {
      method: "POST", body: corpoDaDecisao(area, versao, d, t), idempotencyKey: chave.current
    }),
    onSuccess: (resposta, { decisao: d }) => {
      setAberto(false);
      // Reprovar não tem aviso próprio: o bloco passa a "Reprovado" com o motivo, e isso é a resposta.
      if (d === "aprovar") { const m = mensagemDaAprovacao(resposta); toast[TOAST_DO_TOM[m.tom]](m.texto); }
      void qc.invalidateQueries();
    },
    onError: (e) => {
      chave.current = newIdem();
      // Corpo recusado (motivo vazio, texto longo demais): o diálogo continua aberto, com o motivo do servidor.
      if (e instanceof ApiError && e.status === 422) setErroDoDialogo(e.message);
      else {
        setAberto(false);
        if (portaDaDecisaoAusente(e)) toast.warning(MSG_APROVACOES_INDISPONIVEIS);
        // A venda mudou depois que a consulta foi aberta (outra versão): ela é recarregada e a pessoa confere de novo.
        else if (e instanceof ApiError && e.code === "CONCURRENCY_CONFLICT") toast.warning(MSG_DOCUMENTO_MUDOU_NA_CONSULTA);
        // O resto (documento que deixou de estar aberto, que não exige mais aprovação, sem permissão, invisível): a
        // mensagem é a do servidor, e a consulta recarregada mostra o estado real.
        else toast.error(safeErrorMessage(e));
      }
      void qc.invalidateQueries();
    }
  });

  // Documento fechado (mesmo com uma resposta antiga no cache), carregando, erro de qualquer tipo ou resposta fora da
  // forma: nada. Aprovação que não se aplica ao documento: nada também.
  const leitura = documentoAberto && !q.isError ? lerSituacaoDoDocumento(q.data) : null;
  if (!leitura || leitura.situacao === "nao_aberto" || leitura.situacao === "nao_exigida") return null;

  const doc = documentoDaConsulta(area, especie);
  // Outra espécie da área (o pedido de compra): a capacidade da espécie E a da porta da rota de decisão.
  const pelaPorta = especie === undefined || can(PERMISSAO_DA_PORTA_DA_DECISAO[area]);
  const podeDecidir = doc !== undefined && can(`${doc.perm}.approve`) && pelaPorta && (leitura.situacao === "pendente" || leitura.situacao === "reprovado");
  const u = leitura.ultimaDecisao;
  return <div data-testid={`${prefixoTestid}-aprovacao`} data-situacao={leitura.situacao} role="group" aria-label="Aprovação" className="flex min-w-0 flex-col gap-1.5">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11.5px] font-semibold text-slate-600">Aprovação</span>
      <span data-testid={`${prefixoTestid}-aprovacao-situacao`}><StatusBadge domain="status" value={valorDaSituacaoNaFila(leitura.situacao)} /></span>
    </div>
    {u && <p data-testid={`${prefixoTestid}-aprovacao-decisao`} className={estilosCentral.descricao}>{textoDaUltimaDecisao(u)}</p>}
    {podeDecidir && <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" data-testid={`${prefixoTestid}-aprovar`} onClick={() => abrirDecisao("aprovar")}>Aprovar</Button>
      <Button size="sm" variant="danger" data-testid={`${prefixoTestid}-reprovar`} onClick={() => abrirDecisao("reprovar")}>Reprovar</Button>
    </div>}
    <DialogoDaDecisao aberto={aberto} onFechar={() => setAberto(false)} decisao={decisao} codigo={codigo}
      texto={texto} onTexto={setTexto} erro={erroDoDialogo} ocupado={decidir.isPending}
      onEnviar={() => { if (decisao) decidir.mutate({ decisao, texto }); }} />
  </div>;
}
