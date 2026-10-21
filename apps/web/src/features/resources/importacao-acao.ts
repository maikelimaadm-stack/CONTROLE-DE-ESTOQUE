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
 * Linhas por pedido na GRAVAÇÃO. A conferência (prévia) vai num pedido só — no servidor ela só valida,
 * sem INSERT. A API aceita `limit` até 500.
 */
export const LOTE_DA_IMPORTACAO = 40;

/**
 * O cadastro tem a ação ATUALIZAR? Importável E com o campo `code` no registry (a chave do casamento) — a mesma regra
 * da API (`aceitaAtualizar`), do mesmo registry. A API continua sendo a autoridade: ela recusa (422) o que não aceita.
 */
export function cadastroAceitaAtualizar(def: Pick<ResourceDef, "importacao" | "fields"> | undefined): boolean {
  return Boolean(def?.importacao) && Boolean(def?.fields.some((f) => f.name === "code"));
}

export interface LoteDaImportacao { offset: number; limit: number }

/** URL do envio. CRIAR: a de sempre (`modo` só no parcial). ATUALIZAR: + `acao=atualizar`. Lote: + `offset`/`limit`. */
export function urlDaImportacao(resourceKey: string, simular: boolean, modo: ModoImportacao, acao: AcaoImportacao, lote?: LoteDaImportacao): string {
  const base = `/api/imports/${resourceKey}?simular=${simular ? 1 : 0}${modo === "parcial" ? "&modo=parcial" : ""}${acao === "atualizar" ? "&acao=atualizar" : ""}`;
  return lote ? `${base}&offset=${lote.offset}&limit=${lote.limit}` : base;
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

/** Fatia de resultado que a tela agrega (CRIAR ou ATUALIZAR). */
export interface FatiaImportacao {
  linhas: number;
  gravadas: number;
  erros: { linha: number; coluna: string | null; mensagem: string }[];
  certas?: number;
  com_erro?: number;
  linhas_arquivo?: number;
  planilha_erros_base64?: string | null;
  acao?: string;
  casaram?: number;
  nao_casaram?: number;
  sem_alteracao?: number;
  alteracoes?: AlteracaoNaPrevia[];
}

/**
 * Junta as fatias de um arquivo processado em lotes: somas e erros na ordem; a planilha de erros fica a da
 * última fatia que a trouxe (a API gera por fatia). `linhas` no agregado = total do arquivo quando a API mandou
 * `linhas_arquivo`, senão a soma das fatias.
 */
export function juntarFatias(fatias: FatiaImportacao[]): FatiaImportacao {
  const vazia: FatiaImportacao = { linhas: 0, gravadas: 0, erros: [], certas: 0, com_erro: 0, planilha_erros_base64: null };
  if (!fatias.length) return vazia;
  const linhasArquivo = fatias.find((f) => typeof f.linhas_arquivo === "number")?.linhas_arquivo;
  const erros = fatias.flatMap((f) => f.erros);
  const linhasComErro = new Set(erros.map((e) => e.linha)).size;
  const certas = fatias.reduce((s, f) => s + (f.certas ?? Math.max(0, f.linhas - new Set(f.erros.map((e) => e.linha)).size)), 0);
  const gravadas = fatias.reduce((s, f) => s + f.gravadas, 0);
  const linhasSoma = fatias.reduce((s, f) => s + f.linhas, 0);
  const planilha = [...fatias].reverse().find((f) => f.planilha_erros_base64)?.planilha_erros_base64 ?? null;
  const base: FatiaImportacao = {
    linhas: linhasArquivo ?? linhasSoma,
    gravadas,
    erros,
    certas,
    com_erro: linhasComErro,
    planilha_erros_base64: planilha,
    ...(linhasArquivo !== undefined ? { linhas_arquivo: linhasArquivo } : {}),
  };
  if (fatias.some((f) => f.acao === "atualizar")) {
    const alteracoes = fatias.flatMap((f) => f.alteracoes ?? []);
    return {
      ...base,
      acao: "atualizar",
      casaram: fatias.reduce((s, f) => s + (f.casaram ?? 0), 0),
      nao_casaram: fatias.reduce((s, f) => s + (f.nao_casaram ?? 0), 0),
      sem_alteracao: fatias.reduce((s, f) => s + (f.sem_alteracao ?? 0), 0),
      alteracoes,
    };
  }
  return base;
}

/** Estado puro do progresso da conferência/gravação em lotes (a tela pinta isto a cada lote). */
export interface ProgressoDaImportacao {
  fase: "conferir" | "gravar";
  /** linhas já concluídas (fim do último lote respondido) */
  feitas: number;
  /** total do arquivo; 0 até a 1ª resposta trazer `linhas_arquivo` */
  total: number;
  /** número do lote em andamento (1-based) */
  lote: number;
  /** quantos lotes no total quando `total` é conhecido */
  lotes: number;
  /** true enquanto o pedido HTTP do lote atual não voltou */
  aguardando: boolean;
}

export function progressoInicial(fase: "conferir" | "gravar"): ProgressoDaImportacao {
  return { fase, feitas: 0, total: 0, lote: 1, lotes: 0, aguardando: true };
}

export function progressoDoLote(fase: "conferir" | "gravar", offset: number, limit: number, total: number, aguardando: boolean): ProgressoDaImportacao {
  const lote = Math.floor(offset / limit) + 1;
  const lotes = total > 0 ? Math.max(1, Math.ceil(total / limit)) : 0;
  return { fase, feitas: offset, total, lote, lotes, aguardando };
}

/** Texto legível do progresso — sempre menciona conferência/importação e o lote. */
export function textoDoProgresso(p: ProgressoDaImportacao): string {
  const verbo = p.fase === "conferir" ? "Conferência" : "Importação";
  if (p.total <= 0) {
    return p.aguardando
      ? `${verbo}: lendo o arquivo e conferindo o lote ${p.lote}…`
      : `${verbo}: lote ${p.lote} concluído…`;
  }
  const pct = Math.min(100, Math.round((p.feitas / p.total) * 100));
  const lotes = p.lotes > 0 ? ` · lote ${p.lote} de ${p.lotes}` : ` · lote ${p.lote}`;
  if (p.aguardando) return `${verbo}: ${p.feitas} de ${p.total} linhas (${pct}%)${lotes} — conferindo agora…`;
  return `${verbo}: ${p.feitas} de ${p.total} linhas (${pct}%)${lotes}`;
}

/** Percentual da barra (0–100). Sem total: barra indeterminada na UI (null). */
export function percentualDoProgresso(p: ProgressoDaImportacao): number | null {
  if (p.total <= 0) return null;
  // enquanto aguarda o lote N, mostra o já feito; ao terminar o lote, `feitas` sobe
  return Math.min(100, Math.round((p.feitas / p.total) * 100));
}
