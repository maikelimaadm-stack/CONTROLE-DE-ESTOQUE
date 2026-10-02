/**
 * TOP-CONFIG-05 — AS REGRAS DA OPERAÇÃO NA CENTRAL (decisão 263).
 *
 * SÓ com `capacidades.regrasDaOperacao` EXATA (`CAPACIDADE_REGRAS_DA_OPERACAO`). Sem ela nenhuma pergunta sai
 * (`/regras-da-operacao`, `/situacao-cliente`) e a Central é a de hoje, idêntica. A régua de exigência é a MESMA
 * da API (`exigenciasFaltandoPorCampos`, `@agro/domain`); aqui ela só adianta o erro no campo antes do POST — a
 * autoridade continua sendo o servidor.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CAPACIDADE_REGRAS_DA_OPERACAO, POLITICAS_CLIENTE_EM_ATRASO, type RegrasDaOperacaoResposta, type SituacaoClienteResposta } from "@agro/domain";
import { api, type ApiError } from "@/lib/api";
import { lerRegrasGerais, type RegrasGeraisDaCentral } from "@/features/central/regras-gerais";
import type { EstadoTop } from "@/features/sales/tipo-operacao-select";

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ehUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

/** A API declara as regras da operação? Forma e versão EXATAS. */
export function entendeRegrasDaOperacao(e: EstadoTop): boolean {
  if (e.situacao !== "pronto") return false;
  const c = (e.dados as unknown as { capacidades?: unknown }).capacidades;
  return ehObjeto(c) && c.regrasDaOperacao === CAPACIDADE_REGRAS_DA_OPERACAO;
}

/**
 * As regras como a tela as usa: a resposta conferida + `reservaEstoque` (TOP-CONFIG-07), que é ADITIVO — a API
 * anterior não o manda, e ausente (ou qualquer valor que não seja `true`) é "esta operação não reserva": a Central é
 * a de antes. Não trava a resposta inteira: as outras regras continuam valendo.
 *
 * `regrasGerais` (OPERACOES-01 F2, decisão 279) também é ADITIVO: o servidor diz, pela MESMA régua da gravação, se o
 * Salvar desta TOP também confirma e se o documento pode ser salvo sem itens. Quem lê é o motor (`lerRegrasGerais`):
 * ausente (API anterior) ou fora da forma é o neutro inteiro — o rótulo "Salvar" e a pendência "ao menos um item" de
 * antes. Também não trava a resposta inteira.
 */
export type RegrasDaOperacaoNaTela = RegrasDaOperacaoResposta & { reservaEstoque: boolean; regrasGerais: RegrasGeraisDaCentral };

/**
 * O QUE A RESERVA EXIGE DO ITEM — a chave do catálogo da linha do item que a API cobra quando a versão da TOP
 * reserva (`422 VALIDATION_ERROR`, caminho `items[i].warehouse_id`). A reserva é por armazém e produto: sem armazém
 * não há onde reservar. A tela só marca o "*" e mostra o erro; quem recusa é o servidor.
 */
export const CAMPOS_DO_ITEM_EXIGIDOS_PELA_RESERVA: readonly string[] = Object.freeze(["warehouse_id"]);

/** O caminho do erro do servidor que a reserva devolve no item (`items[<i>].warehouse_id`). */
export function ehCaminhoDeItemDaReserva(caminho: string): boolean {
  const m = /^items\[\d+\]\.([a-z_]+)$/.exec(caminho);
  return m !== null && m[1] !== undefined && CAMPOS_DO_ITEM_EXIGIDOS_PELA_RESERVA.includes(m[1]);
}

/** Confere a resposta de `/regras-da-operacao` antes de ela governar a tela. Forma estranha = `null` (trava). */
export function lerRegrasDaOperacao(bruto: unknown): RegrasDaOperacaoNaTela | null {
  if (!ehObjeto(bruto) || typeof bruto.formato !== "number" || !Array.isArray(bruto.exigencias)) return null;
  if (!bruto.exigencias.every((x) => typeof x === "string")) return null;
  const cp = bruto.condicoesPermitidas;
  if (cp !== null && !(Array.isArray(cp) && cp.every(ehUuid))) return null;
  const ca = bruto.clienteEmAtraso;
  if (!ehObjeto(ca) || !(POLITICAS_CLIENTE_EM_ATRASO as readonly unknown[]).includes(ca.politica) || typeof ca.toleranciaDias !== "number") return null;
  // As duas chaves aditivas vêm DEPOIS do espalhamento: o valor lido sobrescreve o bruto, nunca o contrário.
  return { ...(bruto as unknown as RegrasDaOperacaoResposta), reservaEstoque: bruto.reservaEstoque === true, regrasGerais: lerRegrasGerais(bruto.regrasGerais) };
}

/** As regras da versão ATUAL da TOP escolhida. `ativo` = capacidade exata E TOP escolhida. */
export function useRegrasDaOperacao(kind: string, tipoOperacaoId: string, ativo: boolean) {
  const q = useQuery<unknown, ApiError>({
    queryKey: ["regras-da-operacao", kind, tipoOperacaoId],
    queryFn: () => api<unknown>(`/api/sales/${kind}/regras-da-operacao?tipo_operacao_id=${encodeURIComponent(tipoOperacaoId)}`),
    enabled: ativo && Boolean(tipoOperacaoId),
    retry: false,
  });
  // Memorizada pela resposta: a leitura monta um objeto novo (com `reservaEstoque`), e quem depende de `regras` num
  // `useMemo`/efeito não pode ver "mudou" a cada render.
  const regras = useMemo(() => (ativo && q.data !== undefined ? lerRegrasDaOperacao(q.data) : null), [ativo, q.data]);
  return { regras, pendente: ativo && Boolean(tipoOperacaoId) && !regras, erro: q.error ?? null };
}

/** Confere a resposta de `/situacao-cliente`. */
export function lerSituacaoCliente(bruto: unknown): SituacaoClienteResposta | null {
  if (!ehObjeto(bruto)) return null;
  if (bruto.politica === "nao_valida") return { politica: "nao_valida" };
  if ((bruto.politica === "avisa" || bruto.politica === "bloqueia") && typeof bruto.emAtraso === "boolean"
      && typeof bruto.titulos === "number" && typeof bruto.total === "string"
      && (bruto.vencimentoMaisAntigo === null || typeof bruto.vencimentoMaisAntigo === "string")) {
    return bruto as unknown as SituacaoClienteResposta;
  }
  return null;
}

/** A situação do cliente escolhido para a TOP escolhida. Só pergunta quando a política não é `nao_valida`. */
export function useSituacaoCliente(kind: string, clienteId: string, tipoOperacaoId: string, ativo: boolean) {
  const q = useQuery<unknown, ApiError>({
    queryKey: ["situacao-cliente", kind, tipoOperacaoId, clienteId],
    queryFn: () => api<unknown>(`/api/sales/${kind}/situacao-cliente?client_id=${encodeURIComponent(clienteId)}&tipo_operacao_id=${encodeURIComponent(tipoOperacaoId)}`),
    enabled: ativo && Boolean(clienteId) && Boolean(tipoOperacaoId),
    retry: false,
  });
  return { situacao: q.data !== undefined ? lerSituacaoCliente(q.data) : null, carregando: q.isFetching };
}
