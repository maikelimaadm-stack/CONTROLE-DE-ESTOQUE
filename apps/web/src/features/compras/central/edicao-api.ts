import { FORMA_UUID_PADRAO } from "@agro/domain";
import type { Row } from "@/features/docs/shared";

/**
 * EDITAR-02 (decisão 313) — O CONTRATO DA EDIÇÃO DO PEDIDO DE COMPRA E DA COMPRA, num lugar só (o ADAPTADOR): as
 * portas, a forma da resposta de `GET /edicao` conferida antes de virar tela e a leitura do erro do salvar. Contas
 * PURAS, sem React e sem rede (o estado, `estado.ts`, faz as perguntas; o teste de unidade prova a leitura). Se o
 * contrato do servidor mudar, a troca é AQUI.
 *
 *   GET   /api/compras/{pedidos|compras}/:id/edicao   { podeEditar, motivo, version, limites, regras, layout, documento }
 *   PATCH /api/compras/{pedidos|compras}/:id          { version, ...só o que mudou }  (Idempotency-Key)
 *
 * `documento` é o MESMO objeto do `GET :id`; `regras` tem a forma de `/regras-da-operacao` pela versão CONGELADA da TOP
 * (lida por `lerRegras`, como na criação); `layout` é o de `/layout-efetivo` de HOJE (lido por `estruturaDaResposta`).
 * `limites` diz o que uma edição permitida pode tocar — a tela trava exatamente o que a gravação recusa, e quem decide
 * continua sendo o servidor (a PATCH confere tudo de novo).
 *
 * FAIL-CLOSED: resposta fora da forma ⇒ `null` — a tela diz "indisponível" e não entra em edição (nunca um formulário
 * meio desenhado, nunca um limite inventado em nome do servidor).
 */

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ehTexto = (v: unknown): v is string => typeof v === "string";
/** Propriedade PRÓPRIA (nunca herdada do protótipo): um corpo que não a declara não a tem. */
const propria = (o: Record<string, unknown>, chave: string): unknown => (Object.hasOwn(o, chave) ? o[chave] : undefined);
const booleano = (o: Record<string, unknown>, chave: string): boolean | null => {
  const v = propria(o, chave);
  return typeof v === "boolean" ? v : null;
};

/* ═════════════════════════════════════ AS PORTAS ═════════════════════════════════════ */

/** `GET` da edição: o que a tela precisa para abrir o documento salvo em edição (uma ida só). */
export const portaDaEdicao = (segmento: string, id: string) => `/api/compras/${segmento}/${encodeURIComponent(id)}/edicao`;
/** `PATCH` do documento (a MESMA porta do `GET :id`). */
export const portaDoDocumento = (segmento: string, id: string) => `/api/compras/${segmento}/${encodeURIComponent(id)}`;
/** A chave do React Query da edição (a oferta de recarregar a pergunta de novo). */
export const chaveDaEdicao = (segmento: string, id: string) => ["compras-edicao", segmento, id] as const;

/* ═════════════════════════════════════ A RESPOSTA DO GET /edicao ═════════════════════════════════════ */

/**
 * O que a edição permitida NÃO pode tocar num item salvo (por `id`): `campos` = campo do item travado → por quê (o
 * ausente é livre — `produto_id`, `quantidade`, `valor_unitario`, `desconto`, `desconto_percentual`, `valor_ipi`,
 * `valor_icms_st`); `quantidadeMaxima` = o teto da quantidade (a compra gerada de pedido: o saldo do item do pedido), ou
 * `null`.
 */
export interface LimiteDoItemNaEdicao {
  id: string;
  campos: Readonly<Record<string, string>>;
  quantidadeMaxima: string | null;
}

/**
 * OS LIMITES DE UMA EDIÇÃO PERMITIDA, como o servidor os declara (`limitesDaEdicaoDeCompra`, a MESMA função da PATCH):
 *   campos   → campo do cabeçalho travado → por quê (o fornecedor da compra gerada de pedido e do pedido que gerou
 *              compra; frete, outras despesas, desconto, condição, vencimento e plano da compra com as duplicatas da nota);
 *   itemNovo → `null` = pode incluir item; texto = por que não (a compra gerada de pedido; a compra da nota);
 *   itens[]  → um por item gravado.
 */
export interface LimitesDaEdicaoDeCompra {
  campos: Readonly<Record<string, string>>;
  itemNovo: string | null;
  itens: readonly LimiteDoItemNaEdicao[];
}

const VERSAO = /^\d{1,19}$/;

/** `{ campo: motivo }` — só textos; outra forma ⇒ `null`. Cópia própria (nunca o objeto do servidor). */
function lerMotivos(v: unknown): Record<string, string> | null {
  if (!ehObjeto(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, m] of Object.entries(v)) { if (!ehTexto(m)) return null; out[k] = m; }
  return out;
}

/** Um limite de item: `{ id: <uuid>, campos: { campo: motivo }, quantidadeMaxima: texto | null }`. Fora da forma ⇒ `null`. */
function lerLimiteDoItem(v: unknown): LimiteDoItemNaEdicao | null {
  if (!ehObjeto(v)) return null;
  const id = propria(v, "id");
  if (!ehTexto(id) || !FORMA_UUID_PADRAO.test(id)) return null;
  const campos = lerMotivos(propria(v, "campos"));
  if (!campos) return null;
  const q = propria(v, "quantidadeMaxima");
  if (q !== undefined && q !== null && !ehTexto(q)) return null;
  return { id: id.toLowerCase(), campos, quantidadeMaxima: ehTexto(q) ? q : null };
}

/** Os limites: `campos` (motivos), `itemNovo` (texto ou `null`) e `itens` (lista). Tipo errado ⇒ `null` (a resposta cai). */
export function lerLimites(v: unknown): LimitesDaEdicaoDeCompra | null {
  if (!ehObjeto(v)) return null;
  const campos = lerMotivos(propria(v, "campos"));
  const itemNovo = propria(v, "itemNovo");
  const itens = propria(v, "itens");
  if (!campos || !(itemNovo === null || ehTexto(itemNovo)) || !Array.isArray(itens)) return null;
  const lidos = itens.map(lerLimiteDoItem);
  if (lidos.some((x) => x === null)) return null;
  return { campos, itemNovo, itens: lidos as LimiteDoItemNaEdicao[] };
}

/** A resposta de `GET /edicao` conferida. */
export interface EdicaoDoDocumentoDeCompra {
  podeEditar: boolean;
  /** A recusa do servidor quando `podeEditar` é falso (a MESMA da PATCH); `null` quando pode. */
  motivo: string | null;
  /** A versão do documento lida (texto de dígitos): a PATCH a manda de volta. */
  version: string;
  limites: LimitesDaEdicaoDeCompra;
  /** A forma de `/regras-da-operacao` pela versão CONGELADA — lida por `lerRegras`. */
  regras: unknown;
  /** A forma de `/layout-efetivo` (o de HOJE da TOP) — lida por `estruturaDaResposta`. */
  layout: unknown;
  /** O MESMO objeto do `GET :id`. */
  documento: Row;
}

/**
 * A resposta de `GET /edicao`, FAIL-CLOSED: `podeEditar` booleano; `motivo` texto (ou `null` quando pode); `version`
 * texto de dígitos (o número que sai como número também vale, inteiro e seguro); `limites` pela forma; `documento` um
 * registro com o `id`. `regras` e `layout` passam como vieram: quem os lê são os leitores de sempre (`lerRegras`,
 * `estruturaDaResposta`), que já são fail-closed.
 */
export function lerEdicao(corpo: unknown): EdicaoDoDocumentoDeCompra | null {
  if (!ehObjeto(corpo)) return null;
  const podeEditar = booleano(corpo, "podeEditar");
  if (podeEditar === null) return null;
  const motivoCru = propria(corpo, "motivo");
  const motivo = motivoCru === null || motivoCru === undefined ? null : ehTexto(motivoCru) ? motivoCru : undefined;
  if (motivo === undefined) return null;
  if (!podeEditar && !motivo) return null;
  const v = propria(corpo, "version");
  const version = ehTexto(v) && VERSAO.test(v) ? v : typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? String(v) : null;
  if (version === null) return null;
  const limites = lerLimites(propria(corpo, "limites"));
  if (!limites) return null;
  const documento = propria(corpo, "documento");
  if (!ehObjeto(documento) || !ehTexto(documento["id"])) return null;
  return { podeEditar, motivo: podeEditar ? null : motivo, version, limites, regras: propria(corpo, "regras"), layout: propria(corpo, "layout"), documento };
}

/* ═════════════════════════════════════ O ERRO DO SALVAR ═════════════════════════════════════ */

/** O que a tela lê de um erro da API (a forma do `ApiError`, conferida pela estrutura — nunca pelo texto). */
export interface ErroDaApi { status: number; code: string; message: string; details?: unknown }
export function lerErroDaApi(e: unknown): ErroDaApi | null {
  if (!ehObjeto(e)) return null;
  const { status, code, message } = e as { status?: unknown; code?: unknown; message?: unknown };
  if (typeof status !== "number" || !ehTexto(code) || !ehTexto(message)) return null;
  return { status, code, message, details: (e as { details?: unknown }).details };
}

/** A mensagem do conflito de versão quando o servidor não a manda (a dele, espelhada; quem decide é o servidor). */
export const MSG_DOCUMENTO_MUDOU_NA_EDICAO = "Este documento mudou desde que você o abriu. Recarregue antes de salvar.";

/**
 * O CONFLITO DE VERSÃO da PATCH: 409 `CONCURRENCY_CONFLICT` (o documento mudou desde o `GET /edicao`; também a corrida
 * que o banco desfez). A tela mostra a mensagem do servidor e OFERECE recarregar — o rascunho só é descartado se a
 * pessoa aceitar. Qualquer outro erro: `null` (a recusa vai ao lugar de sempre: o campo, a lista dos itens, o aviso).
 */
export function conflitoDaEdicao(e: unknown): string | null {
  const x = lerErroDaApi(e);
  if (!x || x.status !== 409 || x.code !== "CONCURRENCY_CONFLICT") return null;
  return x.message.trim() || MSG_DOCUMENTO_MUDOU_NA_EDICAO;
}

/** A porta da edição não existe neste servidor (a API anterior): 404 de ROTA, não de documento. */
export const MSG_EDICAO_INDISPONIVEL = "A edição de documento de compra ainda não está disponível neste servidor.";
export function edicaoIndisponivel(e: unknown): boolean {
  const x = lerErroDaApi(e);
  return x !== null && x.status === 404 && x.message === "Rota não encontrada";
}
