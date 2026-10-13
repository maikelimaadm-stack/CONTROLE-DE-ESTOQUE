import type { ResourceDef } from "@agro/domain";

/**
 * IMPORTAR-01 (decisão 317) — as contas PURAS da escolha da ação no diálogo de importação (sem React e sem rede).
 *
 * Duas ações, escolha EXPLÍCITA da pessoa, nunca inferida: CRIAR (o padrão, o de sempre) e ATUALIZAR (casa pelo código e
 * altera só as colunas presentes). O pedido do CRIAR sai EXATAMENTE como antes — sem `acao` —, e por isso continua
 * valendo com a API anterior; só o ATUALIZAR leva `acao=atualizar`.
 */
export type AcaoImportacao = "criar" | "atualizar";
export type ModoImportacao = "tudo" | "parcial";

/**
 * O cadastro tem a ação ATUALIZAR? Importável E com o campo `code` no registry (a chave do casamento) — a mesma regra
 * da API (`aceitaAtualizar`), do mesmo registry. A API continua sendo a autoridade: ela recusa (422) o que não aceita.
 */
export function cadastroAceitaAtualizar(def: Pick<ResourceDef, "importacao" | "fields"> | undefined): boolean {
  return Boolean(def?.importacao) && Boolean(def?.fields.some((f) => f.name === "code"));
}

/** URL do envio. CRIAR: a de sempre (`modo` só no parcial). ATUALIZAR: + `acao=atualizar`. */
export function urlDaImportacao(resourceKey: string, simular: boolean, modo: ModoImportacao, acao: AcaoImportacao): string {
  return `/api/imports/${resourceKey}?simular=${simular ? 1 : 0}${modo === "parcial" ? "&modo=parcial" : ""}${acao === "atualizar" ? "&acao=atualizar" : ""}`;
}

/** O modelo de cada ação: o do CRIAR é o do menu do cadastro; o do ATUALIZAR traz a coluna Código (a chave). */
export const urlDoModelo = (resourceKey: string, acao: AcaoImportacao) => `/api/imports/${resourceKey}/modelo${acao === "atualizar" ? "?acao=atualizar" : ""}`;
export const nomeDoModelo = (resourceKey: string, acao: AcaoImportacao) => `modelo-${resourceKey}${acao === "atualizar" ? "-atualizar" : ""}.xlsx`;

/** Corpo de erro como a API o devolve. */
export interface CorpoComErro { error?: { code?: string; message?: string; details?: unknown } }

/**
 * A API ANTERIOR recusa parâmetro que não conhece (consulta estrita): 422 VALIDATION_ERROR com "Campo não reconhecido".
 * É como a tela sabe que o servidor ainda não tem o `modo` parcial, ou o `acao` — nada foi aberto nem gravado.
 */
export function ehRecusaDeParametro(c: CorpoComErro): boolean {
  return c.error?.code === "VALIDATION_ERROR" && Array.isArray(c.error.details) && (c.error.details as { message?: unknown }[]).some((d) => d?.message === "Campo não reconhecido");
}

export interface AlteracaoNaPrevia { linha: number; codigo: string; colunas: string[] }
export interface ResumoDaAtualizacao { casaram: number; naoCasaram: number; mudam: number; semAlteracao: number; alteracoes: AlteracaoNaPrevia[] }

/**
 * O que a prévia do ATUALIZAR mostra: quantas casaram pelo código, quantas não, quantas mudam e QUAIS colunas em cada
 * uma. Resposta SEM a forma do ATUALIZAR (`acao: "atualizar"` e as contagens) = null: a tela não inventa contagem e
 * não oferece gravar — um servidor que tivesse tratado o pedido como CRIAR nunca recebe o "Atualizar".
 */
export function resumoDaAtualizacao(r: Record<string, unknown>): ResumoDaAtualizacao | null {
  const n = (k: string) => (typeof r[k] === "number" && Number.isInteger(r[k]) && (r[k] as number) >= 0 ? (r[k] as number) : null);
  const [casaram, naoCasaram, semAlteracao] = [n("casaram"), n("nao_casaram"), n("sem_alteracao")];
  const alteracoes = r["alteracoes"];
  if (r["acao"] !== "atualizar" || casaram === null || naoCasaram === null || semAlteracao === null || !Array.isArray(alteracoes)) return null;
  const validas = alteracoes.every((a: unknown) => {
    const x = a as Partial<AlteracaoNaPrevia> | null;
    return Boolean(x) && typeof x!.linha === "number" && typeof x!.codigo === "string" && Array.isArray(x!.colunas) && x!.colunas.every((c) => typeof c === "string");
  });
  if (!validas) return null;
  return { casaram, naoCasaram, mudam: alteracoes.length, semAlteracao, alteracoes: alteracoes as AlteracaoNaPrevia[] };
}

/**
 * Os botões de gravar do ATUALIZAR: "Atualizar N registro(s)" só com a prévia SEM erro e algo a mudar; "Atualizar só as
 * X linhas certas" com erro, alguma certa e algo a mudar. Nada a mudar = nenhum botão (não há o que gravar).
 */
export function botoesDoAtualizar(resumo: ResumoDaAtualizacao | null, erros: number, certas: number): { tudo: boolean; parcial: boolean } {
  if (!resumo || resumo.mudam === 0) return { tudo: false, parcial: false };
  return { tudo: erros === 0, parcial: erros > 0 && certas > 0 };
}
