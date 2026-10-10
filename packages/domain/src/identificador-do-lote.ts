/**
 * IDENTIFICADOR DO LOTE — MAPA-MANEJO-02.
 *
 * Função PURA (sem I/O) sobre as colunas `identificador_nome`, `identificador_sigla` e `identificador_cor` de
 * `erp.batches` (migration 0062): o MARCADOR que a área mostra no mapa, a partir dos lotes abertos nela. A API lê os
 * lotes no SQL e entrega aqui; a tela desenha. Ninguém redigita esta regra — API, tela e testes consomem DESTE
 * arquivo.
 *
 * "Preenchido" = não nulo e com algo além de espaço; os valores são usados com `btrim` (o do Postgres, que tira só
 * o espaço — `configuracao-de-icone.ts`), a mesma régua da CHECK `chk_batches_identificador_sigla`.
 */
import { btrim } from "./configuracao-de-icone.js";

/**
 * Cor do marcador quando o lote tem sigla ou nome mas não tem cor. É o ÚNICO hex do mapa no domínio: a cor das
 * faixas de coloração NÃO mora aqui (`cores-do-mapa.ts` entrega só chave, rótulo, número e unidade).
 */
export const COR_PADRAO_DO_IDENTIFICADOR = "#64748b";

/** As três colunas do identificador, como saem de `erp.batches` (todas anuláveis). */
export interface LoteComIdentificador {
  identificador_nome: string | null;
  identificador_sigla: string | null;
  identificador_cor: string | null;
}

/**
 * O marcador da área: o identificador comum a todos os lotes identificados, ou `misto` quando eles divergem.
 * O misto não carrega cor nem sigla de propósito — escolher a de um dos lotes diria que a área é daquele lote.
 */
export type IdentificadorDaArea = { misto: false; cor: string; sigla: string; nome: string } | { misto: true };

/** Valor preenchido já com `btrim`; `null` quando nulo, não texto ou só espaço. */
function preenchido(valor: string | null): string | null {
  if (typeof valor !== "string") return null;
  const aparado = btrim(valor);
  return aparado === "" ? null : aparado;
}

/**
 * IDENTIFICADOR DA ÁREA a partir dos lotes ABERTOS nela.
 *
 * 1. Só entram os lotes com ALGUM dos três campos preenchido (basta um): lote sem identificador não vota.
 * 2. Completa cada um: `cor = cor ?? COR_PADRAO_DO_IDENTIFICADOR`; `sigla = sigla ?? nome ?? ""`;
 *    `nome = nome ?? sigla` (a sigla já completada). A sigla vai INTEIRA — quem corta para caber no marcador é a
 *    tela, que sabe o espaço que tem; o domínio não perde informação.
 * 3. Deduplica pela tripla (cor, sigla, nome), comparada como gravada depois do `btrim` (maiúscula ≠ minúscula,
 *    inclusive no hex da cor).
 * 4. Sobrou UMA tripla → ela, `misto: false` — vários lotes com o mesmo identificador são um marcador só.
 * 5. Mais de uma → `{ misto: true }`, sem cor e sem sigla.
 * 6. Nenhum lote identificado (ou nenhum lote) → `null`: a área não tem marcador, o que é diferente de "misto".
 *
 * O resultado não depende da ordem dos lotes.
 */
export function resolverIdentificadorDaArea(lotes: readonly LoteComIdentificador[]): IdentificadorDaArea | null {
  const triplas = new Map<string, { cor: string; sigla: string; nome: string }>();
  for (const lote of lotes) {
    const nome = preenchido(lote.identificador_nome);
    const sigla = preenchido(lote.identificador_sigla);
    const cor = preenchido(lote.identificador_cor);
    if (nome === null && sigla === null && cor === null) continue;
    const siglaCompleta = sigla ?? nome ?? "";
    const completa = { cor: cor ?? COR_PADRAO_DO_IDENTIFICADOR, sigla: siglaCompleta, nome: nome ?? siglaCompleta };
    triplas.set(JSON.stringify([completa.cor, completa.sigla, completa.nome]), completa);
  }
  if (triplas.size === 0) return null;
  if (triplas.size > 1) return { misto: true };
  const [unica] = triplas.values();
  return { misto: false, cor: unica!.cor, sigla: unica!.sigla, nome: unica!.nome };
}
