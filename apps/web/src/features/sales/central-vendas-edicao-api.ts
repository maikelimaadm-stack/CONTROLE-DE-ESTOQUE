import { FORMA_UUID_PADRAO } from "@agro/domain";
import type { Row } from "@/features/docs/shared";
import type { RegrasGeraisDaCentral } from "@/features/central/contrato";

/**
 * EDITAR-03 (decisão 315) — O CONTRATO DA EDIÇÃO DO DOCUMENTO DE VENDA (orçamento, pedido e venda), num lugar só (o
 * ADAPTADOR): as portas, a forma da resposta do `GET /edicao` conferida antes de virar tela, a guarda de versão e a
 * leitura do erro do salvar. Contas PURAS, sem React e sem rede (o formulário, `central-vendas-formulario.tsx`, faz as
 * perguntas; o teste de unidade prova a leitura). Se o contrato do servidor mudar, a troca é AQUI. O molde é o adaptador
 * da edição de compras (decisão 313) — lido, não importado: os nomes de compras não entram na venda.
 *
 *   GET   /api/sales/{budgets|orders|sales}/:id          o documento (o MESMO objeto da consulta)
 *   GET   /api/sales/{budgets|orders|sales}/:id/edicao   { podeEditar, motivo, limites, version, regras,
 *                                                          condicoesPermitidas, layout, situacaoCliente }
 *   PATCH /api/sales/{budgets|orders|sales}/:id          { version, ...só o que mudou }  (Idempotency-Key)
 *
 * DIFERENÇA DECLARADA PARA COMPRAS: o `/edicao` de vendas NÃO traz o documento (`apps/api/src/routes/vendas-edicao.ts`,
 * `EdicaoDoDocumentoDeVenda`). A tela carrega os DOIS — o `GET :id` e o `/edicao` — e só abre quando as duas leituras são
 * da MESMA versão (`versaoConfere`): abrir o documento de uma versão e mandar a PATCH com a de outra faria um item que
 * outra aba incluiu sair em silêncio (a lista de itens da PATCH é COMPLETA).
 *
 * FAIL-CLOSED: resposta fora da forma ⇒ `null` — a tela diz "indisponível" e não entra em edição (nunca um formulário
 * meio desenhado, nunca um limite ou uma regra inventada em nome do servidor). Em particular `regras.regrasGerais` TEM de
 * vir com as duas chaves booleanas (o servidor sempre o manda, neutro em orçamento e pedido): na venda ele diz se o Salvar
 * CONFIRMA (`confirmacaoAutomatica`), e ler a ausência como "não confirma" esconderia uma confirmação (A0 da EDITAR-03).
 */

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ehTexto = (v: unknown): v is string => typeof v === "string";
/** Propriedade PRÓPRIA (nunca herdada do protótipo): um corpo que não a declara não a tem. */
const propria = (o: Record<string, unknown>, chave: string): unknown => (Object.hasOwn(o, chave) ? o[chave] : undefined);

/* ═════════════════════════════════════ AS PORTAS ═════════════════════════════════════ */

/** `GET` do documento e `PATCH` da edição (a MESMA porta da consulta). */
export const portaDoDocumentoDeVenda = (segmento: string, id: string) => `/api/sales/${segmento}/${encodeURIComponent(id)}`;
/** `GET` da edição: o que a tela precisa para abrir o documento salvo em edição (sem o documento). */
export const portaDaEdicaoDeVenda = (segmento: string, id: string) => `${portaDoDocumentoDeVenda(segmento, id)}/edicao`;
/** As chaves do React Query da abertura (a leitura entra na chave: "Recarregar" pergunta de novo, nunca o cache). */
export const chaveDoDocumentoEmEdicaoDeVenda = (segmento: string, id: string, leitura: number) => ["sales-edicao-documento", segmento, id, leitura] as const;
export const chaveDaEdicaoDeVenda = (segmento: string, id: string, leitura: number) => ["sales-edicao", segmento, id, leitura] as const;

/* ═════════════════════════════════════ A RESPOSTA DO GET /edicao ═════════════════════════════════════ */

/** O limite de UM item gravado (por `id`): o local de estoque que a PATCH recusa trocar (`armazemTravado`). */
export interface LimiteDoItemDeVenda { id: string; armazemTravado: boolean }

/**
 * OS LIMITES DE UMA EDIÇÃO PERMITIDA, como o servidor os declara (`limitesDaEdicao`, a MESMA função da PATCH —
 * `apps/api/src/routes/vendas-edicao-regras.ts:58-72`):
 *   somenteArmazemEObservacao → a PARTE GERADA (algum item ligado a item de origem): nos ITENS só o armazém e a
 *                               observação mudam — mesma contagem de linhas, sem item novo, sem remover;
 *   itens[]                   → um por item gravado; `armazemTravado` = a parte de pedido que reserva estoque, item de
 *                               produto que controla estoque. SÓ o booleano: o servidor não manda o texto (A0).
 */
export interface LimitesDaEdicaoDeVenda { somenteArmazemEObservacao: boolean; itens: readonly LimiteDoItemDeVenda[] }

/** Os limites pela forma; qualquer coisa fora dela ⇒ `null` (a resposta inteira cai). Cópia própria. */
export function lerLimitesDaEdicaoDeVenda(v: unknown): LimitesDaEdicaoDeVenda | null {
  if (!ehObjeto(v)) return null;
  const parte = propria(v, "somenteArmazemEObservacao");
  const itens = propria(v, "itens");
  if (typeof parte !== "boolean" || !Array.isArray(itens)) return null;
  const lidos: LimiteDoItemDeVenda[] = [];
  for (const x of itens) {
    if (!ehObjeto(x)) return null;
    const id = propria(x, "id"); const travado = propria(x, "armazemTravado");
    if (!ehTexto(id) || !FORMA_UUID_PADRAO.test(id) || typeof travado !== "boolean") return null;
    lidos.push({ id: id.toLowerCase(), armazemTravado: travado });
  }
  return { somenteArmazemEObservacao: parte, itens: lidos };
}

/** O bloco `regrasGerais` ESTRITO (as duas chaves booleanas); fora disso, `null` — nunca o neutro (ver o topo). */
export function lerRegrasGeraisDaEdicao(v: unknown): RegrasGeraisDaCentral | null {
  if (!ehObjeto(v)) return null;
  const c = propria(v, "confirmacaoAutomatica"); const s = propria(v, "aceitaSemItens");
  return typeof c === "boolean" && typeof s === "boolean" ? { confirmacaoAutomatica: c, aceitaSemItens: s } : null;
}

/** A resposta do `GET /edicao` conferida. */
export interface EdicaoDoDocumentoDeVenda {
  podeEditar: boolean;
  /** A recusa do servidor quando `podeEditar` é falso (a MESMA da PATCH); `null` quando pode. */
  motivo: string | null;
  /** A versão lida (texto de dígitos): a PATCH a manda de volta. */
  version: string;
  limites: LimitesDaEdicaoDeVenda;
  /** A forma de `/regras-da-operacao` pela versão CONGELADA — lida pelo leitor de sempre (`lerRegrasDaOperacao`). */
  regras: Record<string, unknown>;
  /** `regras.regrasGerais` conferido ESTRITO: confirma ao salvar? aceita sem itens? */
  regrasGerais: RegrasGeraisDaCentral;
  /** O MESMO valor de `regras.condicoesPermitidas` (null = todas). */
  condicoesPermitidas: readonly string[] | null;
  /** A forma de `/layout-efetivo` (o layout de HOJE da TOP do documento) — a `estrutura` lida pelo leitor de sempre. */
  layout: Record<string, unknown>;
  /** A forma de `/situacao-cliente` para o cliente GRAVADO, pela versão congelada — lida por `lerSituacaoCliente`. */
  situacaoCliente: unknown;
}

const VERSAO = /^(0|[1-9]\d{0,18})$/;
/** A versão como texto canônico de dígitos (o número inteiro seguro também vale); outra forma ⇒ `null`. */
export function versaoCanonica(v: unknown): string | null {
  if (ehTexto(v) && VERSAO.test(v)) return v;
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return String(v);
  return null;
}

/**
 * A resposta do `GET /edicao`, FAIL-CLOSED: `podeEditar` booleano; `motivo` texto (obrigatório quando não pode); `version`
 * canônica; `limites` pela forma; `regras` objeto com `regrasGerais` estrito; `condicoesPermitidas` null ou lista de UUID
 * igual à de `regras`; `layout` objeto com `estrutura` objeto. O resto de `regras`, a `estrutura` e `situacaoCliente`
 * passam como vieram: quem os lê são os leitores de sempre, que também são fail-closed.
 */
export function lerEdicaoDeVenda(corpo: unknown): EdicaoDoDocumentoDeVenda | null {
  if (!ehObjeto(corpo)) return null;
  const podeEditar = propria(corpo, "podeEditar");
  if (typeof podeEditar !== "boolean") return null;
  const motivoCru = propria(corpo, "motivo");
  const motivo = motivoCru === null || motivoCru === undefined ? null : ehTexto(motivoCru) ? motivoCru : undefined;
  if (motivo === undefined || (!podeEditar && !motivo?.trim())) return null;
  const version = versaoCanonica(propria(corpo, "version"));
  if (version === null) return null;
  const limites = lerLimitesDaEdicaoDeVenda(propria(corpo, "limites"));
  if (!limites) return null;
  const regras = propria(corpo, "regras");
  if (!ehObjeto(regras)) return null;
  const regrasGerais = lerRegrasGeraisDaEdicao(propria(regras, "regrasGerais"));
  if (!regrasGerais) return null;
  const cp = propria(corpo, "condicoesPermitidas");
  if (cp !== null && !(Array.isArray(cp) && cp.every((x) => ehTexto(x) && FORMA_UUID_PADRAO.test(x)))) return null;
  // o MESMO valor das duas chaves (o servidor manda a mesma referência): divergência é resposta fora do contrato
  if (JSON.stringify(cp) !== JSON.stringify(propria(regras, "condicoesPermitidas") ?? null)) return null;
  const layout = propria(corpo, "layout");
  if (!ehObjeto(layout) || !ehObjeto(propria(layout, "estrutura"))) return null;
  return {
    podeEditar, motivo: podeEditar ? null : motivo, version, limites, regras, regrasGerais,
    condicoesPermitidas: cp === null ? null : [...(cp as string[])], layout, situacaoCliente: propria(corpo, "situacaoCliente")
  };
}

/* ═════════════════════════════════════ O DOCUMENTO E A GUARDA DE VERSÃO ═════════════════════════════════════ */

/**
 * O documento do `GET :id` que a edição abre: um registro com `id`, `version` canônica, `kind` texto e `items` lista de
 * registros com `id` UUID. Fora disso ⇒ `null`.
 */
export function lerDocumentoDaEdicaoDeVenda(v: unknown): Row | null {
  if (!ehObjeto(v)) return null;
  if (!ehTexto(propria(v, "id")) || versaoCanonica(propria(v, "version")) === null || !ehTexto(propria(v, "kind"))) return null;
  const itens = propria(v, "items");
  if (!Array.isArray(itens) || !itens.every((i) => ehObjeto(i) && ehTexto(i["id"]) && FORMA_UUID_PADRAO.test(i["id"]))) return null;
  return v;
}

/**
 * A GUARDA DE VERSÃO da abertura: o documento lido e o `/edicao` lido descrevem a MESMA versão. Diferentes (outra aba
 * salvou entre as duas leituras) ⇒ a tela RELÊ as duas — nunca mostra uma versão e manda outra.
 */
export function versaoConfere(documento: Row, edicao: EdicaoDoDocumentoDeVenda): boolean {
  const v = versaoCanonica(documento["version"]);
  return v !== null && BigInt(v) === BigInt(edicao.version);
}

/** Quantas vezes a abertura relê as duas leituras quando as versões divergem, antes de desistir. */
export const RELEITURAS_DA_ABERTURA = 3;

/**
 * O QUE A ABERTURA FAZ com as duas leituras (conta pura; o formulário a chama a cada resposta):
 *   fora-do-contrato   → uma das duas fora da forma: "indisponível";
 *   recusada           → `podeEditar` falso: a recusa do servidor (a MESMA da PATCH);
 *   versoes-diferentes → as duas versões não batem: reler;
 *   pronta             → abre o formulário com o documento e o `/edicao` desta versão.
 */
export type DecisaoDaAbertura =
  | { situacao: "fora-do-contrato" }
  | { situacao: "recusada"; motivo: string }
  | { situacao: "versoes-diferentes" }
  | { situacao: "pronta"; documento: Row; edicao: EdicaoDoDocumentoDeVenda };

export function decidirAbertura(documentoCru: unknown, edicaoCru: unknown): DecisaoDaAbertura {
  const edicao = lerEdicaoDeVenda(edicaoCru);
  if (!edicao) return { situacao: "fora-do-contrato" };
  if (!edicao.podeEditar) return { situacao: "recusada", motivo: edicao.motivo ?? "" };
  const documento = lerDocumentoDaEdicaoDeVenda(documentoCru);
  if (!documento) return { situacao: "fora-do-contrato" };
  if (!versaoConfere(documento, edicao)) return { situacao: "versoes-diferentes" };
  return { situacao: "pronta", documento, edicao };
}

/* ═════════════════════════════════════ O ERRO DO SALVAR ═════════════════════════════════════ */

/** O que a tela lê de um erro da API (a forma do `ApiError`, conferida pela estrutura — nunca pelo texto). */
export interface ErroDaApiNaEdicao { status: number; code: string; message: string; details?: unknown }
export function lerErroDaApiNaEdicao(e: unknown): ErroDaApiNaEdicao | null {
  if (!ehObjeto(e)) return null;
  const { status, code, message } = e as { status?: unknown; code?: unknown; message?: unknown };
  if (typeof status !== "number" || !ehTexto(code) || !ehTexto(message)) return null;
  return { status, code, message, details: (e as { details?: unknown }).details };
}

/** A mensagem do conflito de versão quando o servidor não a manda (a dele, espelhada; quem decide é o servidor). */
export const MSG_DOCUMENTO_DE_VENDA_MUDOU = "Este documento mudou desde que você o abriu. Recarregue antes de salvar.";

/**
 * O CONFLITO DE VERSÃO da PATCH: 409 `CONCURRENCY_CONFLICT` (o documento mudou desde a abertura). A tela mostra a
 * mensagem do servidor e OFERECE recarregar — nunca sobrescreve, e o rascunho só sai se a pessoa aceitar. Qualquer outro
 * erro: `null` (a recusa vai ao lugar de sempre: o campo, a linha do item, o aviso).
 */
export function conflitoDaEdicaoDeVenda(e: unknown): string | null {
  const x = lerErroDaApiNaEdicao(e);
  if (!x || x.status !== 409 || x.code !== "CONCURRENCY_CONFLICT") return null;
  return x.message.trim() || MSG_DOCUMENTO_DE_VENDA_MUDOU;
}

/**
 * A CHAVE DE IDEMPOTÊNCIA DA PATCH: a MESMA até o servidor RECUSAR (4xx). A recusa desfaz a transação inteira (a chave
 * inclusive): a próxima tentativa é OUTRA operação, com chave nova. `CONCURRENCY_CONFLICT` mantém (pode ser "operação em
 * andamento para esta chave": a primeira ainda pode gravar). Rede, 5xx e resposta sem forma também mantêm: não se sabe
 * se o servidor gravou, e o reenvio com a MESMA chave recebe a resposta gravada (nunca uma segunda gravação).
 */
export function trocaAChaveDaEdicao(e: unknown): boolean {
  const x = lerErroDaApiNaEdicao(e);
  return x !== null && x.status >= 400 && x.status < 500 && x.code !== "CONCURRENCY_CONFLICT";
}

/** A porta da edição não existe neste servidor (a API anterior): 404 de ROTA, não de documento. */
export const MSG_EDICAO_DE_VENDA_INDISPONIVEL = "A edição de documento de venda ainda não está disponível neste servidor.";
export function edicaoDeVendaIndisponivel(e: unknown): boolean {
  const x = lerErroDaApiNaEdicao(e);
  return x !== null && x.status === 404 && x.message === "Rota não encontrada";
}
