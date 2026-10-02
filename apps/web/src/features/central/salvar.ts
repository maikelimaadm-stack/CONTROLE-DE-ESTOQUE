"use client";
import * as React from "react";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { MENSAGEM_APROVACAO_PENDENTE } from "@agro/domain";
import { api, newIdem } from "@/lib/api";
import { toast } from "@/lib/toast";
import type { AvisoDoSalvar, RespostaDoSalvar } from "./contrato";

export type { ResultadoConfirmacaoAutomatica, RespostaDoSalvar, AvisoDoSalvar, TipoDoAviso } from "./contrato";

/**
 * MOTOR DA CENTRAL — O SALVAR (OPERACOES-01 F2, decisão 279). UM dono para o aviso que aparece depois de gravar.
 *
 * Com a TOP no formato 4 e Confirmação Automática o SERVIDOR tenta confirmar no fim do POST e diz o que aconteceu em
 * `confirmacaoAutomatica` (TOP-CONFIG-08, decisão 277). A Central não supõe nada pela TOP da tela: o aviso sai da
 * RESPOSTA. Os textos são os que a Central de Estoque já mostrava (W-5b e W-5c os conferem letra por letra), e as
 * Centrais de Vendas, de Compras e de Estoque usam este mesmo módulo — um aviso por Salvar.
 *
 * O motor não conhece espécie: nada aqui importa `features/sales`, `features/compras`, `features/aprovacoes` ou
 * `features/estoque`. Quem precisa do molde da mensagem do servidor (a fila de Aprovações) importa daqui.
 */

/**
 * A mensagem do servidor dentro de um molde que já termina em ponto: o ponto final dela sai antes de entrar — "…saldo
 * insuficiente.." seria o molde mal aplicado, não a mensagem. Um dono só para essa pontuação: o aviso do Salvar (as
 * Centrais) e a decisão de aprovar (Aprovações) usam este.
 */
export const mensagemDoServidorNoMolde = (prefixo: string, mensagem: string): string =>
  `${prefixo}${mensagem.trim().replace(/\.+$/, "")}.`;

// ── Textos do aviso (exatos: os E2E procuram por eles) ─────────────────────────────────────────────────────────
export const MSG_SALVO_COM_SUCESSO = "Salvo com sucesso";
export const MSG_SALVO_E_CONFIRMADO = "Salvo e confirmado.";
export const MSG_SALVO_AGUARDANDO_APROVACAO = `Salvo. ${MENSAGEM_APROVACAO_PENDENTE}`;
export const MSG_SALVO_SEM_PERMISSAO = "Salvo, mas não confirmado: você não tem permissão para confirmar este documento.";
export const PREFIXO_SALVO_NAO_CONFIRMADO = "Salvo, mas não confirmado: ";

/** Um campo de um objeto que veio do fio; qualquer outra coisa (nulo, texto, número) não tem campo nenhum. */
const campo = (o: unknown, chave: string): unknown => (typeof o === "object" && o !== null ? (o as Record<string, unknown>)[chave] : undefined);

/**
 * O AVISO DO SALVAR, lido da resposta — nunca suposto pela TOP da tela. A resposta é dado externo: a entrada é
 * tolerante e o estreitamento é feito aqui, na mesma ordem e com o mesmo critério do aviso que a Central de Estoque
 * tinha:
 *   · `{ confirmado: true }` → "Salvo e confirmado." (sucesso);
 *   · `aguardando_aprovacao` → "Salvo. <a mensagem da aprovação pendente do domínio>" (informação);
 *   · `sem_permissao` → "Salvo, mas não confirmado: você não tem permissão para confirmar este documento." (aviso);
 *   · `recusada` com mensagem não vazia → "Salvo, mas não confirmado: <mensagem do servidor>." — a MESMA mensagem que
 *     o Confirmar daria, com um ponto final só (aviso);
 *   · sem `confirmacaoAutomatica`, ou fora do contrato → "Salvo com sucesso" (o de antes, byte a byte). O 201 já prova
 *     que o documento foi gravado, e a consulta que abre em seguida mostra a situação que o servidor leu. Nenhum texto
 *     é inventado para o que está fora do contrato.
 */
export function avisoDoSalvar(r: { confirmacaoAutomatica?: unknown } | null | undefined): AvisoDoSalvar {
  const a = campo(r, "confirmacaoAutomatica");
  if (campo(a, "confirmado") === true) return { tipo: "success", texto: MSG_SALVO_E_CONFIRMADO };
  if (campo(a, "confirmado") === false) {
    const motivo = campo(a, "motivo");
    if (motivo === "aguardando_aprovacao") return { tipo: "info", texto: MSG_SALVO_AGUARDANDO_APROVACAO };
    if (motivo === "sem_permissao") return { tipo: "warning", texto: MSG_SALVO_SEM_PERMISSAO };
    const mensagem = campo(campo(a, "erro"), "message");
    if (motivo === "recusada" && typeof mensagem === "string" && mensagem.trim()) {
      return { tipo: "warning", texto: mensagemDoServidorNoMolde(PREFIXO_SALVO_NAO_CONFIRMADO, mensagem) };
    }
  }
  return { tipo: "success", texto: MSG_SALVO_COM_SUCESSO };
}

/** Mostra o aviso do Salvar: UM toast, no tom que a resposta pediu. */
export function avisarSalvo(r: { confirmacaoAutomatica?: unknown } | null | undefined): void {
  const aviso = avisoDoSalvar(r);
  toast[aviso.tipo](aviso.texto);
}

/**
 * O POST que cria o documento a partir da Central: o `useCreate` de `features/docs/shared.tsx` com o aviso acima no
 * lugar do "Salvo com sucesso" fixo — a MESMA Idempotency-Key por tentativa (renovada só depois de uma recusa), o
 * mesmo `toast.error` com a mensagem do servidor no erro, e o `invalidateQueries()` antes do `onDone`. `useCreate` não
 * muda: as outras telas que o usam continuam com o aviso fixo.
 */
export function useCriarDocumento<T extends RespostaDoSalvar = RespostaDoSalvar>(porta: string, onDone: (r: T) => void): UseMutationResult<T, Error, unknown> {
  const qc = useQueryClient(); const chave = React.useRef(newIdem());
  return useMutation<T, Error, unknown>({
    mutationFn: (corpo: unknown) => api<T>(porta, { method: "POST", body: corpo, idempotencyKey: chave.current }),
    onSuccess: (r) => { avisarSalvo(r); void qc.invalidateQueries(); onDone(r); },
    onError: (e) => { toast.error(e.message); chave.current = newIdem(); }
  });
}
