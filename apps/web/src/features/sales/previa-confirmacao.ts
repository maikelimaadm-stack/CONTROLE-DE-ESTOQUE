"use client";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";

/**
 * A PRÉVIA DA CONFIRMAÇÃO DA VENDA — O QUE A CONFIRMAÇÃO FARIA AGORA, DITO PELO SERVIDOR (VENDAS-A5-1).
 *
 * A tela não adivinha efeito. Antes desta fatia o diálogo dizia, para toda venda, "baixa o estoque e gera as
 * contas a receber" — uma frase fixa que a execução configurada da TOP (fase 2 da 04A) pode desmentir: a
 * versão pode não mexer no estoque, não gerar título, ou exigir um dado que o documento não tem. Quem sabe o
 * que vai acontecer é o servidor, com a MESMA função que executa a confirmação (`planejarConfirmacao`).
 *
 * A PRÉVIA É APRESENTAÇÃO; A CONFIRMAÇÃO É A AUTORIDADE. O botão desabilitado por uma recusa prevista evita
 * um clique que o servidor recusaria agora; ele não substitui a recusa do servidor, que continua existindo.
 *
 * ┌─ CAPABILITY: ROLLING DEPLOY ───────────────────────────────────────────────────────────────────┐
 * │ Contra a API anterior a rota não existe: o nó `${base}/:id` casa o segmento como id e a resposta  │
 * │ é 404 ou 500. Um 200 de forma desconhecida PARECE sucesso — por isso `contractVersion` e a forma  │
 * │ são conferidos antes de qualquer leitura. Não confirmado ⇒ o diálogo mostra um texto NEUTRO, que  │
 * │ é verdadeiro para qualquer servidor, e o botão fica habilitado: quem recusa é o servidor.         │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/** A ÚNICA versão de contrato que esta tela sabe ler. O servidor a declara na própria resposta. */
export const CONTRATO_PREVIA_CONFIRMACAO = 1 as const;

export interface RecusaPrevista { code: string; message: string; details?: unknown }
export interface ItemDaClassificacao { id: string; codigo: string; nome: string }
export interface PreviaDaConfirmacao {
  contractVersion: typeof CONTRATO_PREVIA_CONFIRMACAO;
  podeConfirmar: boolean;
  recusas: RecusaPrevista[];
  estoque: { efeito: "baixa" | "nenhum" | null; itensQueBaixam: number; itensSemArmazem: number };
  financeiro: {
    efeito: "receber" | "nenhum" | null;
    valor: string | null;
    primeiroVencimento: string | null;
    classificacao: { origem: "documento" | "padrão legado"; categoria: ItemDaClassificacao; centro: ItemDaClassificacao } | null;
  };
}

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ehTexto = (v: unknown): v is string => typeof v === "string";
const ehContagem = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
/** Dinheiro vem da API como texto decimal (`numeric` do banco), nunca número: "97.35", "-1.00". */
const ehDecimal = (v: unknown): v is string => ehTexto(v) && /^-?\d+(\.\d+)?$/.test(v);
const ehDataIso = (v: unknown): v is string => ehTexto(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);
const ehItem = (v: unknown): v is ItemDaClassificacao => ehObjeto(v) && ehTexto(v.id) && ehTexto(v.codigo) && ehTexto(v.nome);
const ehRecusa = (v: unknown): v is RecusaPrevista => ehObjeto(v) && ehTexto(v.code) && ehTexto(v.message);

/**
 * O corpo só vira contrato INTEIRO. Campo pela metade viraria frase com buraco ("Gera contas a receber de
 * R$ undefined") — e frase com buraco sobre dinheiro é pior do que o texto neutro. Por isso, além da forma,
 * as COERÊNCIAS que o servidor garante são conferidas: corpo que as quebra não é deste contrato.
 */
export const ehPreviaDaConfirmacao = (v: unknown): v is PreviaDaConfirmacao => {
  if (!ehObjeto(v) || v.contractVersion !== CONTRATO_PREVIA_CONFIRMACAO || typeof v.podeConfirmar !== "boolean") return false;
  if (!Array.isArray(v.recusas) || !v.recusas.every(ehRecusa)) return false;
  // A autorização da tela sai do corpo inteiro: "pode" com recusa, ou "não pode" sem nenhuma, é contradição.
  if (v.podeConfirmar !== (v.recusas.length === 0)) return false;
  const e = v.estoque; const f = v.financeiro;
  if (!ehObjeto(e) || !(e.efeito === "baixa" || e.efeito === "nenhum" || e.efeito === null) || !ehContagem(e.itensQueBaixam) || !ehContagem(e.itensSemArmazem)) return false;
  if (!ehObjeto(f) || !(f.efeito === "receber" || f.efeito === "nenhum" || f.efeito === null) || !(f.primeiroVencimento === null || ehDataIso(f.primeiroVencimento))) return false;
  // Valor existe EXATAMENTE quando há conta a receber, e é decimal em texto.
  if (f.efeito === "receber" ? !ehDecimal(f.valor) : f.valor !== null) return false;
  // "Pode confirmar" sem política (efeitos nulos) é contradição: a política é a primeira coisa decidida.
  if (v.podeConfirmar && (e.efeito === null || f.efeito === null)) return false;
  const c = f.classificacao;
  return c === null || (ehObjeto(c) && (c.origem === "documento" || c.origem === "padrão legado") && ehItem(c.categoria) && ehItem(c.centro));
};

export type EstadoDaPrevia =
  /** Perguntando — o botão Confirmar fica desabilitado até a resposta. */
  | { situacao: "carregando" }
  /** Rota ausente, servidor com defeito ou corpo fora do contrato 1: texto neutro, botão habilitado. */
  | { situacao: "nao-confirmado" }
  | { situacao: "pronto"; previa: PreviaDaConfirmacao };

/**
 * Busca a prévia. `chave` é o contador de ABERTURAS do diálogo: cada vez que ele abre, a pergunta é feita de
 * novo — uma resposta de minutos atrás (antes de alguém inativar a categoria, por exemplo) não pode decidir o
 * botão. `retry: false`: 404/500 aqui são resposta (API anterior), não falha transitória.
 */
export function usePreviaDaConfirmacao(id: string, habilitado: boolean, chave: string | number): EstadoDaPrevia {
  const q = useQuery<unknown, ApiError>({
    queryKey: ["sales-previa-confirmacao", id, chave],
    queryFn: () => api<unknown>(`/api/sales/sales/${id}/previa-confirmacao`),
    enabled: habilitado && Boolean(id),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  if (!habilitado || q.isPending || q.isFetching) return { situacao: "carregando" };
  if (q.error || !ehPreviaDaConfirmacao(q.data)) return { situacao: "nao-confirmado" };
  return { situacao: "pronto", previa: q.data };
}

/** O texto NEUTRO — verdadeiro para qualquer servidor, sem prometer efeito nenhum. */
export const TEXTO_SEM_PREVIA = "A confirmação aplica o Tipo de Operação desta venda. Não foi possível carregar a prévia dos efeitos; o servidor recusa o que não puder executar.";

const itens = (n: number) => `${n} ${n === 1 ? "item" : "itens"}`;
const rotulo = (x: ItemDaClassificacao) => `${x.codigo} · ${x.nome}`;

/** A linha de estoque da prévia. `null` quando a recusa veio antes da política (não há o que dizer). */
export function linhaDeEstoque(p: PreviaDaConfirmacao): string | null {
  const { efeito, itensQueBaixam, itensSemArmazem } = p.estoque;
  if (efeito === "nenhum") return "Não movimenta estoque.";
  if (efeito !== "baixa") return null;
  // A operação baixa, mas NENHUM item tem armazém: a confirmação não gera movimento — "baixa o estoque de 0
  // itens" seria anunciar um efeito que não acontece.
  if (itensQueBaixam === 0) return itensSemArmazem > 0 ? `Não movimenta estoque: ${itensSemArmazem === 1 ? "o item não tem" : `os ${itensSemArmazem} itens não têm`} armazém.` : "Não movimenta estoque.";
  const fora = itensSemArmazem > 0 ? ` ${itens(itensSemArmazem)} sem armazém ${itensSemArmazem === 1 ? "fica" : "ficam"} de fora.` : "";
  return `Baixa o estoque de ${itens(itensQueBaixam)}.${fora}`;
}

/** A linha financeira da prévia, com valor e datas já formatados por quem chama (a tela tem os formatadores). */
export function linhaFinanceira(p: PreviaDaConfirmacao, fmt: { dinheiro: (v: string) => string; data: (v: string) => string }): string | null {
  const f = p.financeiro;
  if (f.efeito === "nenhum") return "Não gera conta a receber.";
  if (f.efeito !== "receber" || f.valor === null) return null;
  const partes = [`Gera contas a receber de ${fmt.dinheiro(f.valor)}`];
  if (f.primeiroVencimento) partes.push(`primeiro vencimento ${fmt.data(f.primeiroVencimento)}`);
  if (f.classificacao) partes.push(`natureza ${rotulo(f.classificacao.categoria)} · centro de resultado ${rotulo(f.classificacao.centro)}${f.classificacao.origem === "padrão legado" ? " (padrão automático)" : ""}`);
  return `${partes.join(", ")}.`;
}

/**
 * O par do padrão automático que a confirmação VAI usar — só quando ela vai gerar título pelo recuo E pode
 * acontecer. Com recusa prevista (período congelado, exigência da versão) "ao confirmar, usará" seria dizer
 * o que uma confirmação que o servidor recusa faria.
 */
export function padraoAutomaticoPrevisto(p: PreviaDaConfirmacao): string | null {
  const c = p.financeiro.classificacao;
  if (!p.podeConfirmar || p.financeiro.efeito !== "receber" || !c || c.origem !== "padrão legado") return null;
  return `natureza ${rotulo(c.categoria)} · centro de resultado ${rotulo(c.centro)}`;
}
