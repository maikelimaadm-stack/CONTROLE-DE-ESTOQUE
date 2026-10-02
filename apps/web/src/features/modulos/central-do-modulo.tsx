"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { ERRO_EXIGENCIA_NAO_ATENDIDA } from "@agro/domain";
import { api, ApiError, newIdem } from "@/lib/api";
import { toast } from "@/lib/toast";
import { useDirtyTab } from "@/lib/workspace-tabs";
import { MolduraDaCentral } from "@/features/central/moldura";
import { PainelColuna } from "@/features/central/painel";
import { DialogoDescartar } from "@/features/central/dialogos";
import { BotaoDaBarra, ConjuntoDaBarra, ConjuntoDireito, IconeDescartar, IconeSalvar, PendenciasDoDocumento, type Pendencia } from "@/features/central/barra";
import { avisarSalvo, useCriarDocumento, type RespostaDoSalvar } from "@/features/central/salvar";

export { useCriarDocumento } from "@/features/central/salvar";
export type { Pendencia } from "@/features/central/barra";

/**
 * A CASCA DAS CENTRAIS DOS MÓDULOS (OPERACOES-01 F10, decisão 287) — a moldura do motor, a barra e o painel "Resumo".
 *
 * Abastecimento, manutenção, ordem de serviço, manejo, batelada e produção de ração desenham a mesma Central: os Dados
 * principais à esquerda, os itens (pelo motor, em `itens-do-modulo.tsx`) e o painel inferior com a aba "Resumo". A
 * barra tem Salvar e Descartar; o Salvar com pendência não envia nada — abre a lista "N pendências", que leva ao campo.
 * Cada Central continua dona da sua regra: o que é pendência, o corpo do POST, para onde ir depois de salvar.
 *
 * O aviso do Salvar é o do motor (`useCriarDocumento`: "Salvo com sucesso", a MESMA Idempotency-Key por tentativa e o
 * `toast.error` da recusa) — nada de toast próprio aqui além do que o motor já faz. Situação, quando há, vem pronta da
 * página (o `StatusBadge` oficial): esta casca não decide tom nem rótulo.
 */

export interface PropsDaCentralDoModulo {
  prefixoTestid: string;
  /** Nome da região para leitores de tela ("Novo abastecimento"). */
  titulo: string;
  /** A identidade na moldura ("Novo abastecimento", "Ordem de serviço 0012"). */
  nome: string;
  alterado: boolean;
  situacao?: React.ReactNode;
  aviso?: React.ReactNode;
  /** As pendências do cliente, já calculadas pela página (só aparecem depois de um Salvar que não enviou nada). */
  pendencias: readonly Pendencia[];
  salvando: boolean;
  /** Falso desabilita o Salvar (estado: carregando, documento que não se edita). Pendência de campo NÃO desabilita. */
  podeSalvar: boolean;
  /** Só é chamado sem pendências. */
  onSalvar: () => void;
  /** Descartar sem alteração vai para cá; com alteração, pergunta antes e vai para cá (ou chama `onDescartar`). */
  rotaDaLista: string;
  /** Opcional: em vez de sair para a lista, a página volta o formulário à abertura. */
  onDescartar?: () => void;
  /** Opcional: levar a uma pendência do jeito da página. Ausente: o campo pelo rótulo, ou a região dos itens. */
  onIrParaPendencia?: (p: Pendencia) => void;
  dados: React.ReactNode;
  itens: React.ReactNode;
  /** O conteúdo da aba "Resumo" (os totais da página, numa coluna). */
  resumo: React.ReactNode;
}

/** O controle focável dentro de um elemento (o primeiro botão, campo, seleção ou texto habilitado). */
const controleEm = (raiz: Element | null | undefined) =>
  raiz?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)") ?? null;
const semMarca = (t: string) => t.replace(/[*:]/g, "").replace(/\s+/g, " ").trim();

/**
 * Leva à pendência pelo DOM da própria Central: caminho de item → a região dos itens; senão o campo cujo rótulo é o
 * da pendência. Nada fora da Central é tocado.
 */
function irParaPendenciaPadrao(prefixoTestid: string, p: Pendencia) {
  const central = document.querySelector<HTMLElement>(`[data-testid="${prefixoTestid}"]`);
  if (!central) return;
  const alvo = p.caminho.startsWith("items") || p.caminho.startsWith("machines") || p.caminho.startsWith("lines")
    ? controleEm(central.querySelector(`[data-testid="${prefixoTestid}-itens"]`))
    : controleEm([...central.querySelectorAll("label")].find((l) => semMarca(l.textContent ?? "") === semMarca(p.rotulo))?.parentElement);
  if (!alvo) return;
  alvo.scrollIntoView({ block: "nearest" });
  alvo.focus();
}

export function CentralDoModulo(p: PropsDaCentralDoModulo) {
  const router = useRouter();
  const [tentou, setTentou] = React.useState(false);
  const [aberta, setAberta] = React.useState(false);
  const [perguntaDescartar, setPerguntaDescartar] = React.useState(false);
  useDirtyTab(p.alterado);
  const pendencias = tentou ? p.pendencias : [];
  React.useEffect(() => { if (!pendencias.length) setAberta(false); }, [pendencias.length]);

  /** A defesa no HANDLER, não só no `disabled`: com pendência, nada sai — a lista abre. */
  const salvar = () => {
    if (!p.podeSalvar || p.salvando) return;
    if (p.pendencias.length) { setTentou(true); setAberta(true); return; }
    p.onSalvar();
  };
  const sair = () => { if (p.onDescartar) p.onDescartar(); else router.push(p.rotaDaLista); };
  const descartar = () => { if (p.alterado) setPerguntaDescartar(true); else router.push(p.rotaDaLista); };
  const irPara = (x: Pendencia) => (p.onIrParaPendencia ? p.onIrParaPendencia(x) : irParaPendenciaPadrao(p.prefixoTestid, x));

  return <>
    <MolduraDaCentral prefixoTestid={p.prefixoTestid} titulo={p.titulo}
      identidade={{ nome: p.nome, alterado: p.alterado, situacao: p.situacao }}
      aviso={p.aviso}
      acoes={<ConjuntoDaBarra>
        <BotaoDaBarra rotulo="Descartar" disabled={p.salvando} data-testid={`${p.prefixoTestid}-descartar`} onClick={descartar}><IconeDescartar /></BotaoDaBarra>
        <BotaoDaBarra rotulo="Salvar" solido dica={p.salvando ? "Salvando…" : "Salvar"} ocupado={p.salvando} disabled={!p.podeSalvar} data-testid={`${p.prefixoTestid}-salvar`}
          onClick={salvar}><IconeSalvar /></BotaoDaBarra>
      </ConjuntoDaBarra>}
      acoesDireita={<ConjuntoDireito>
        {tentou && <PendenciasDoDocumento prefixoTestid={p.prefixoTestid} pendencias={pendencias} aberta={aberta} onAbertaChange={setAberta} onIr={irPara} />}
      </ConjuntoDireito>}
      dados={p.dados}
      itens={p.itens}
      abas={[{ value: "resumo", label: "Resumo", content: <PainelColuna>{p.resumo}</PainelColuna> }]}
    />
    <DialogoDescartar aberto={perguntaDescartar} onFechar={() => setPerguntaDescartar(false)} onDescartar={() => { setPerguntaDescartar(false); sair(); }} />
  </>;
}

/** O Salvar da criação: o `useCriarDocumento` do motor, com o nome do módulo. */
export const useSalvarDoModulo = useCriarDocumento;

/**
 * O Salvar da EDIÇÃO (o PUT da OS): o irmão de `useCriarDocumento` — o mesmo aviso ("Salvo com sucesso"), a MESMA
 * Idempotency-Key por tentativa (renovada só depois de uma recusa), o mesmo `toast.error` com a mensagem do servidor e
 * o `invalidateQueries()` antes do `onDone`.
 */
export function useAtualizarDoModulo<T extends RespostaDoSalvar = RespostaDoSalvar>(porta: string, onDone: (r: T) => void): UseMutationResult<T, Error, unknown> {
  const qc = useQueryClient();
  const chave = React.useRef(newIdem());
  return useMutation<T, Error, unknown>({
    mutationFn: (corpo: unknown) => api<T>(porta, { method: "PUT", body: corpo, idempotencyKey: chave.current }),
    onSuccess: (r) => { avisarSalvo(r); void qc.invalidateQueries(); onDone(r); },
    onError: (e) => { toast.error(e.message); chave.current = newIdem(); },
  });
}

const ehObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Os erros por campo de uma recusa do servidor: `VALIDATION_ERROR` com `details[].path` → mensagem;
 * `TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA` com `details.exigencias[].caminho` → mensagem. Qualquer outra forma → `{}`.
 */
export function errosDoServidor(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError)) return {};
  const out: Record<string, string> = {};
  if (e.code === ERRO_EXIGENCIA_NAO_ATENDIDA) {
    const lista = ehObj(e.details) && Array.isArray(e.details.exigencias) ? (e.details.exigencias as unknown[]) : [];
    for (const x of lista) if (ehObj(x) && typeof x.caminho === "string" && typeof x.mensagem === "string") out[x.caminho] = x.mensagem;
    return out;
  }
  if (e.code === "VALIDATION_ERROR" && Array.isArray(e.details)) {
    for (const d of e.details as unknown[]) if (ehObj(d) && typeof d.path === "string" && typeof d.message === "string") out[d.path] = d.message;
  }
  return out;
}

/** O texto da pendência de exigência da TOP — o MESMO da recusa do servidor. */
export const pendenciaDaExigencia = (rotulo: string): string => `${rotulo} é obrigatório nesta operação.`;
