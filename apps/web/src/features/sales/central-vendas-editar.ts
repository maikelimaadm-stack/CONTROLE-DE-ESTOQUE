import { MSG_EDICAO_DE_VENDA_INDISPONIVEL, edicaoDeVendaIndisponivel, lerEdicaoDeVenda, lerErroDaApiNaEdicao } from "./central-vendas-edicao-api";
import type { EstadoDaPrevia } from "./previa-confirmacao";

/**
 * EDITAR-03 (decisão 315) — A AÇÃO "EDITAR" NA CONSULTA DO DOCUMENTO DE VENDA E O TEXTO DO AVISO DO SALVAR QUE CONFIRMA.
 * Contas PURAS (sem React e sem rede): a consulta (`app/(app)/vendas/[kind]/[id]/page.tsx`) faz a pergunta e desenha; o
 * teste de unidade prova a regra. O molde é a ação Editar de compras (decisão 313, `acaoEditar`) com UMA diferença pedida
 * pelo dono: em compras a dica é regra local espelhada; aqui o motivo vem SÓ do servidor (`GET <base>/:id/edicao`, a MESMA
 * recusa da PATCH) — a tela não escreve regra de editável.
 *
 *   some        sem `<variante>.edit` OU sem `<variante>.view` (as MESMAS da PATCH e do `/edicao`; `can()` é apresentação)
 *   desabilitada com o texto do ESTADO enquanto a pergunta não volta, com a mensagem do erro (a porta ausente na API
 *               anterior: "ainda não está disponível neste servidor"), com a frase de indisponível para a resposta fora
 *               do contrato, e com o `motivo` do `/edicao` quando ele recusa (`podeEditar` falso)
 *   habilitada  só quando o `/edicao` respondeu `podeEditar: true`, na forma inteira (`lerEdicaoDeVenda`, fail-closed)
 */

/** O texto do estado enquanto a consulta pergunta ao servidor se o documento pode ser editado. */
export const MSG_CONFERINDO_A_EDICAO_DE_VENDA = "Conferindo se o documento pode ser editado…";

/** O que a consulta sabe da pergunta ao `/edicao` (a forma do React Query, reduzida ao que decide a ação). */
export type LeituraDaEdicaoNaConsulta =
  | { situacao: "carregando" }
  | { situacao: "erro"; erro: unknown }
  | { situacao: "lida"; corpo: unknown };

/** A ação Editar: `visivel` (a capacidade) e `dicaDesabilitada` — `null` = habilitada; texto = desabilitada com o motivo. */
export interface AcaoEditarDaVenda { visivel: boolean; dicaDesabilitada: string | null }

/** A dica que a leitura do `/edicao` dá; `null` só para `podeEditar: true` na forma do contrato. */
export function dicaDaLeituraDaEdicao(l: LeituraDaEdicaoNaConsulta): string | null {
  if (l.situacao === "carregando") return MSG_CONFERINDO_A_EDICAO_DE_VENDA;
  if (l.situacao === "erro") {
    if (edicaoDeVendaIndisponivel(l.erro)) return MSG_EDICAO_DE_VENDA_INDISPONIVEL;
    const mensagem = lerErroDaApiNaEdicao(l.erro)?.message ?? (l.erro instanceof Error ? l.erro.message : "");
    return mensagem.trim() || MSG_EDICAO_DE_VENDA_INDISPONIVEL;
  }
  const lida = lerEdicaoDeVenda(l.corpo);
  if (!lida) return MSG_EDICAO_DE_VENDA_INDISPONIVEL;
  return lida.podeEditar ? null : (lida.motivo ?? MSG_EDICAO_DE_VENDA_INDISPONIVEL);
}

/**
 * A AÇÃO "Editar" do documento de venda. `perm` é a família de capacidade da VARIANTE DO REGISTRO (`budgets`, `orders`,
 * `sales`); `null` = variante desconhecida, sem ação. `recusaDaAbertura` é o que o clique acabou de ouvir do servidor (a
 * abertura relê o `/edicao` e o documento: recusa, ou leitura indisponível) — vale até a consulta ler o `/edicao` de novo.
 */
export function acaoEditarDaVenda(p: {
  can: (permissao: string) => boolean; perm: string | null; carregado: boolean;
  leitura: LeituraDaEdicaoNaConsulta; recusaDaAbertura: string | null;
}): AcaoEditarDaVenda {
  const visivel = p.carregado && Boolean(p.perm) && p.can(`${p.perm}.edit`) && p.can(`${p.perm}.view`);
  if (!visivel) return { visivel: false, dicaDesabilitada: null };
  return { visivel, dicaDesabilitada: p.recusaDaAbertura ?? dicaDaLeituraDaEdicao(p.leitura) };
}

/* ═════════════════════════════ O AVISO DO SALVAR QUE CONFIRMA (item 2.3 do dono, A0 "avisar_antes") ═════════════════════════════ */

/**
 * O botão do aviso fica desabilitado SÓ enquanto a prévia carrega: a pessoa confirma depois de ler o que vai acontecer.
 * Recusa prevista NÃO desabilita (A0, diferença 1 para o Confirmar manual): a prévia é da venda GRAVADA, a edição pode ser
 * a correção dela, e a confirmação recusada deixa a venda salva e aberta, sem efeito. Sem prévia (API anterior, erro,
 * corpo fora do contrato): o texto neutro e o botão habilitado — quem recusa é o servidor.
 */
export const confirmarDoAvisoDesabilitado = (previa: EstadoDaPrevia): boolean => previa.situacao === "carregando";

/*
 * Os textos abaixo são a PROPOSTA do A3 para o "ponto de texto" que o A0 deixou ao coordenador. Nenhum afirma efeito que
 * o servidor não declarou: a política (baixa/nenhum, receber/nenhum) é a da prévia, que vale para a edição porque a PATCH
 * não troca a TOP (A0); os NÚMEROS da prévia são da venda gravada e não aparecem quando a PATCH muda o que ela lê.
 */

/** Recusa prevista na prévia, com o botão habilitado: o que o Salvar faz então (o SAVEPOINT da PATCH, medido pelo A0). */
export const TEXTO_SALVAR_COM_RECUSA_PREVISTA = "Ao salvar, as alterações são gravadas e a confirmação é tentada; se ela for recusada, a venda fica salva e aberta, sem movimentar estoque nem gerar conta a receber.";
/** A PATCH muda o que a prévia lê: só a política aparece, e esta frase diz de onde saem os números. */
export const TEXTO_NUMEROS_NA_EDICAO = "Quantidades, valores e vencimentos da confirmação saem do documento com as suas alterações, calculados pelo servidor ao salvar.";
/** A política de estoque "baixa", sem a contagem da venda gravada. */
export const TEXTO_BAIXA_SEM_NUMEROS = "Baixa o estoque dos itens com local de estoque.";
/** A política financeira "receber", sem o valor nem o vencimento da venda gravada. */
export const TEXTO_RECEBER_SEM_NUMEROS = "Gera contas a receber do total da venda.";
