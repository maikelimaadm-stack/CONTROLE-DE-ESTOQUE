"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  LAYOUT_DO_SISTEMA, MENSAGEM_CONDICAO_NAO_PERMITIDA, MSG_ORCAMENTO_FORNECEDOR_REPETIDO, MSG_ORCAMENTO_SO_PEDIDO_ABERTO,
  MSG_ORCAMENTO_VALIDADE_ANTES_DA_DATA, MSG_PEDIDO_JA_TEM_VENCEDOR, MSG_PEDIDO_NAO_APROVADO_PARA_ORCAMENTO, MSG_PEDIDO_SEM_TOP_DE_ORCAMENTO,
  camposObrigatoriosFaltando, catalogoDaFamilia, mensagemCampoObrigatorio, type CampoDoLayout, type ColunaDoLayout, type EstruturaLayout
} from "@agro/domain";
import { D, type Decimal } from "@agro/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { todayISO } from "@/lib/utils";
import { useDirtyTab } from "@/lib/workspace-tabs";
import { useTradutor } from "@/lib/i18n";
import { useDoc, type ItemRow, type Row } from "@/features/docs/shared";
import { entendeLayoutDocumento, type EstadoTop } from "@/features/sales/tipo-operacao-select";
import type { Pendencia } from "@/features/central/contrato";
import { consumirSalvo, descartarSalvo, entregarSalvo } from "@/features/central/salvo";
import { useTopsDaEspecie, varianteDeCompra, type VarianteDeCompra } from "../variantes";
import {
  SEM_PADROES, camposExigidosPelaRegra, estruturaComExigidos, estruturaDaResposta, layoutQueVale, lerRegras, padroesDaResposta, valorDoPadrao,
  zonasDaCentral, type LayoutQueVale, type RegrasDaCompra, type ZonasDaCentral
} from "../layout-da-central";
import {
  aprovadoParaOrcamento, invalidarLeiturasDeCompras, orcamentosDoPedido, rotaDoNovoOrcamento, useChaveDeIdempotencia,
  useFinalizacaoEOrcamento, useLequeDeOrcamentosDoPedido, type OrcamentoDoPedido, type TopDoLequeDeOrcamento
} from "../pedido-e-orcamento";
import { chaveDepoisDeSalvarDeCompra, corpoDoCancelamento } from "../central/adaptador";
import { errosDoServidor } from "../central/estado";

/**
 * OPERACOES-01 F6b (decisão 283) — O ESTADO DO ORÇAMENTO DE COMPRA NA CENTRAL DE COMPRAS, sem JSX.
 *
 * A F6a pôs o orçamento de compra (espécie `orcamento`) na API; aqui mora a lógica das TELAS dele — as peças
 * (`central-orcamento.tsx`, `consulta-orcamento.tsx`, `aba-orcamentos.tsx`) só desenham:
 *
 *   useEntradaDoOrcamento         — a criação em `/compras/<seg>/new?tipo_operacao_id=…&pedido=…`: as recusas, NA ORDEM
 *                                    do plano (sem pedido → sem permissão → sem a capacidade → o pedido → o leque), e a
 *                                    escolha da TOP quando o leque tem mais de uma.
 *   useEstadoDoFormularioDoOrcamento — o formulário (criação e edição no lugar): layout e regras da TOP de orçamento,
 *                                    padrões, pendências, o corpo EXATO do POST/PUT e a chave de idempotência.
 *   useEstadoDaConsultaDoOrcamento — o orçamento salvo: a leitura, o "Salvo", editar e cancelar.
 *   menoresTotais / menoresPrecosDoItem — a comparação dos orçamentos do pedido, em DECIMAL (nunca ponto flutuante).
 *
 * O orçamento nasce SÓ do pedido aprovado para orçamento: a rota de criar é do pedido
 * (`POST /api/compras/pedidos/:id/orcamentos`) e não há porta de orçamento avulso. Os itens e as quantidades são os do
 * pedido (travados); o que se digita é o preço de cada item, a condição, o prazo de entrega, a validade e a observação.
 * Não mexe em estoque nem em financeiro. Tudo aqui é APRESENTAÇÃO: quem decide é o servidor (a porta, a guarda da 0044,
 * as regras da versão congelada da TOP). A tela só não esconde o que vai ser cobrado, e cobra antes o que já sabe.
 */

/* ═════════════════════════════════════ Tipos e contas puras ═════════════════════════════════════ */

export type ModoDoOrcamento = "criacao" | "edicao";

/** O cabeçalho que se digita no orçamento. A empresa é a do pedido e nunca vai no corpo (o servidor a copia). */
export interface CabecalhoDoOrcamento {
  fornecedor_id: string; data_documento: string; condicao_pagamento_id: string;
  prazo_entrega_dias: string; validade_orcamento: string; observacao: string;
}
export type ChaveDoCabecalhoDoOrcamento = keyof CabecalhoDoOrcamento;

export const cabecalhoVazioDoOrcamento = (): CabecalhoDoOrcamento => ({
  fornecedor_id: "", data_documento: todayISO(), condicao_pagamento_id: "", prazo_entrega_dias: "", validade_orcamento: "", observacao: ""
});

/** O prazo de entrega que o contrato aceita: inteiro de 0 a 3650 dias (o `prazoEntrega` da API). */
export const PRAZO_MAXIMO_DE_ENTREGA_DIAS = 3650;
export const MSG_PRAZO_DE_ENTREGA = "Informe o prazo de entrega em dias inteiros, de 0 a 3650.";

const texto = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const vazio = (v: string) => v.trim() === "";

/** Decimal de um texto da tela ou da API; vazio é zero; o que não é número é `null` (nunca NaN em conta de dinheiro). */
export function decimalOuNulo(v: unknown): Decimal | null {
  const t = texto(v).trim();
  if (t === "") return D(0);
  try { const d = D(t); return d.isFinite() ? d : null; } catch { return null; }
}

/** O item do pedido de uma linha da grade (a chave que o corpo do POST leva). */
export const itemPedidoDaLinha = (l: ItemRow): string => texto(l["item_pedido_id"]);
/** O id da linha do orçamento (só na edição; a chave que o corpo do PUT leva). */
export const idDaLinha = (l: ItemRow): string => texto(l["id"]);

/** testid de cada linha da grade do orçamento: o item do PEDIDO que ela cota (o mesmo na criação e na edição). */
export const testIdDaLinhaDoOrcamento = (l: ItemRow): string => `compras-orcamento-item-${itemPedidoDaLinha(l)}`;

/** As linhas da criação: TODOS os itens do pedido, na ordem dele (posição), com o preço vazio. */
export function linhasDoPedido(itens: unknown): ItemRow[] {
  return (Array.isArray(itens) ? (itens as Row[]) : []).map((it) => ({
    product_id: texto(it["produto_id"]), product_code: texto(it["produto_codigo"]), product_name: texto(it["produto_nome"]),
    quantity: texto(it["quantidade"]), unit_value: "", item_pedido_id: texto(it["id"])
  }));
}

/** As linhas da edição: as do orçamento gravado, com o preço atual e o vínculo ao item do pedido. */
export function linhasDoOrcamento(itens: unknown): ItemRow[] {
  return (Array.isArray(itens) ? (itens as Row[]) : []).map((it) => ({
    id: texto(it["id"]), product_id: texto(it["produto_id"]), product_code: texto(it["produto_codigo"]), product_name: texto(it["produto_nome"]),
    quantity: texto(it["quantidade"]), unit_value: texto(it["valor_unitario"]), item_pedido_id: texto(it["item_pedido_orcado_id"])
  }));
}

/** Σ quantidade × preço (sem desconto: o orçamento não tem), em decimal. `null` se algum número não se lê. */
export function totalDasLinhas(linhas: readonly ItemRow[]): Decimal | null {
  let total = D(0);
  for (const l of linhas) {
    const q = decimalOuNulo(l.quantity); const p = decimalOuNulo(l.unit_value);
    if (!q || !p) return null;
    total = total.plus(q.times(p));
  }
  return total;
}

/**
 * Os orçamentos de MENOR total entre os não cancelados (comparação decimal; empate marca todos). Total ilegível não
 * entra na conta (nunca vira zero).
 */
export function menoresTotais(orcamentos: readonly OrcamentoDoPedido[]): ReadonlySet<string> {
  const vivos = orcamentos.filter((o) => o.situacao !== "cancelado")
    .flatMap((o) => { const v = decimalOuNulo(o.valorTotal); return v ? [{ id: o.id, v }] : []; });
  if (!vivos.length) return new Set();
  const menor = vivos.reduce((m, x) => (x.v.lt(m) ? x.v : m), vivos[0]!.v);
  return new Set(vivos.filter((x) => x.v.eq(menor)).map((x) => x.id));
}

/** O preço de um item do pedido num orçamento (A3), ou `null` quando o orçamento não tem a linha. */
export const precoNoOrcamento = (o: OrcamentoDoPedido, itemPedidoId: string): string | null =>
  o.itens?.find((i) => i.itemPedidoId === itemPedidoId)?.valorUnitario ?? null;

/** Os orçamentos com o MENOR preço unitário de um item do pedido (decimal; empate marca todos; sem linha não entra). */
export function menoresPrecosDoItem(orcamentos: readonly OrcamentoDoPedido[], itemPedidoId: string): ReadonlySet<string> {
  const precos = orcamentos.flatMap((o) => {
    const p = precoNoOrcamento(o, itemPedidoId);
    const v = p === null ? null : decimalOuNulo(p);
    return v ? [{ id: o.id, v }] : [];
  });
  if (!precos.length) return new Set();
  const menor = precos.reduce((m, x) => (x.v.lt(m) ? x.v : m), precos[0]!.v);
  return new Set(precos.filter((x) => x.v.eq(menor)).map((x) => x.id));
}

/* ═════════════════════════════════════ ENTRADA DA CRIAÇÃO ═════════════════════════════════════ */

/** Por que a criação não abre o formulário (cada um com a sua mensagem; nenhum POST). */
export type MotivoDaRecusaDoOrcamento =
  | "sem-pedido" | "sem-permissao" | "indisponivel" | "pedido-erro" | "pedido-nao-aberto" | "pedido-nao-aprovado"
  | "pedido-com-vencedor" | "leque-indisponivel" | "leque-erro" | "sem-top";

export const MSG_ORCAMENTO_SEM_PEDIDO = "O orçamento de compra nasce do pedido: abra um pedido aprovado para orçamento e use “Novo orçamento”.";
export const MSG_ORCAMENTO_SEM_PERMISSAO = "Você não tem permissão para lançar orçamento de compra.";
export const MSG_ORCAMENTO_INDISPONIVEL = "O orçamento de compra está indisponível nesta versão do servidor.";
export const MSG_LEQUE_INDISPONIVEL = "As operações de orçamento estão indisponíveis nesta versão do servidor.";

/** O testid da mensagem de cada recusa (as três primeiras têm o próprio; as do pedido e do leque, o comum). */
export const TESTID_DA_RECUSA: Readonly<Record<MotivoDaRecusaDoOrcamento, string>> = {
  "sem-pedido": "compras-orcamento-sem-pedido",
  "sem-permissao": "compras-orcamento-sem-permissao",
  indisponivel: "compras-orcamento-indisponivel",
  "pedido-erro": "compras-orcamento-recusado-mensagem",
  "pedido-nao-aberto": "compras-orcamento-recusado-mensagem",
  "pedido-nao-aprovado": "compras-orcamento-recusado-mensagem",
  "pedido-com-vencedor": "compras-orcamento-recusado-mensagem",
  "leque-indisponivel": "compras-orcamento-recusado-mensagem",
  "leque-erro": "compras-orcamento-recusado-mensagem",
  "sem-top": "compras-orcamento-recusado-mensagem"
};

/** O pedido de compra que o orçamento cota, como a leitura do servidor o traz (só o que a tela usa). */
export interface PedidoDoOrcamento { id: string; codigo: string; empresaId: string; empresaNome: string }

export type EntradaDoOrcamento =
  | { situacao: "carregando"; rotulo: string }
  | { situacao: "recusado"; motivo: MotivoDaRecusaDoOrcamento; mensagem: string }
  /** O leque tem mais de uma TOP e a URL não escolheu: os botões "Orçamento em {codigo} — {nome}". */
  | { situacao: "escolher-top"; pedido: PedidoDoOrcamento; tops: TopDoLequeDeOrcamento[]; escolher: (t: TopDoLequeDeOrcamento) => void }
  | { situacao: "formulario"; chave: string; props: PropsDoFormularioDoOrcamento };

const carregando = (rotulo: string): EntradaDoOrcamento => ({ situacao: "carregando", rotulo });
const recusado = (motivo: MotivoDaRecusaDoOrcamento, mensagem: string): EntradaDoOrcamento => ({ situacao: "recusado", motivo, mensagem });

/**
 * A CRIAÇÃO — as verificações vêm NA ORDEM do plano, e cada pergunta ao servidor só sai depois das anteriores passarem
 * (sem pedido na URL, sem permissão ou sem a capacidade: nenhuma rota do orçamento é perguntada, nenhum POST).
 */
export function useEntradaDoOrcamento(variante: VarianteDeCompra): EntradaDoOrcamento {
  const sp = useSearchParams(); const router = useRouter(); const { can, loading } = useAuth();
  const pedidoNaUrl = sp.get("pedido") ?? "";
  const topNaUrl = sp.get("tipo_operacao_id") ?? "";
  const podeCriar = can(`${variante.perm}.create`);
  const capacidade = useFinalizacaoEOrcamento();
  const segmentoDoPedido = varianteDeCompra("pedido")?.segmento ?? "";
  const pedidoAtivo = Boolean(pedidoNaUrl) && !loading && podeCriar && capacidade === "sim" && Boolean(segmentoDoPedido);
  // O id da URL é PEDIDO do usuário: vai codificado; quem diz se existe (e se ele vê) é o servidor (a MESMA 404).
  const pedidoQ = useDoc<Row>(`/api/compras/${segmentoDoPedido}/${encodeURIComponent(pedidoNaUrl)}`, pedidoAtivo);
  const d = pedidoAtivo ? pedidoQ.data : undefined;
  const situacaoDoPedido = d ? texto(d["situacao"]) : "";
  const orcamentos = orcamentosDoPedido(d);
  const comVencedor = (orcamentos ?? []).some((o) => o.situacao === "escolhido");
  const pedidoPronto = Boolean(d) && situacaoDoPedido === "aberto" && aprovadoParaOrcamento(d) !== null && !comVencedor;
  // O leque pelo id que o SERVIDOR devolveu (nunca o texto cru da URL num caminho de rota).
  const pedidoId = d ? texto(d["id"]) : "";
  const leque = useLequeDeOrcamentosDoPedido(pedidoId, pedidoPronto);
  const estadoTop = useTopsDaEspecie(variante.segmento, pedidoAtivo && pedidoPronto);

  const resultado = ((): EntradaDoOrcamento => {
    if (!pedidoNaUrl) return recusado("sem-pedido", MSG_ORCAMENTO_SEM_PEDIDO);
    if (loading) return carregando("Carregando…");
    if (!podeCriar) return recusado("sem-permissao", MSG_ORCAMENTO_SEM_PERMISSAO);
    if (capacidade === "carregando") return carregando("Carregando…");
    if (capacidade !== "sim") return recusado("indisponivel", MSG_ORCAMENTO_INDISPONIVEL);
    if (!segmentoDoPedido) return recusado("indisponivel", MSG_ORCAMENTO_INDISPONIVEL);
    if (pedidoQ.isPending) return carregando("Carregando o pedido de compra…");
    if (pedidoQ.error || !d) return recusado("pedido-erro", pedidoQ.error instanceof Error ? pedidoQ.error.message : "Documento não encontrado");
    if (situacaoDoPedido !== "aberto") return recusado("pedido-nao-aberto", MSG_ORCAMENTO_SO_PEDIDO_ABERTO);
    if (!aprovadoParaOrcamento(d)) return recusado("pedido-nao-aprovado", MSG_PEDIDO_NAO_APROVADO_PARA_ORCAMENTO);
    if (comVencedor) return recusado("pedido-com-vencedor", MSG_PEDIDO_JA_TEM_VENCEDOR);
    if (leque.situacao === "carregando") return carregando("Carregando as operações de orçamento…");
    if (leque.situacao === "indisponivel") return recusado("leque-indisponivel", MSG_LEQUE_INDISPONIVEL);
    if (leque.situacao === "erro") return recusado("leque-erro", leque.mensagem);
    if (!leque.tops.length) return recusado("sem-top", MSG_PEDIDO_SEM_TOP_DE_ORCAMENTO);

    const pedido: PedidoDoOrcamento = { id: pedidoId, codigo: texto(d["codigo"]), empresaId: texto(d["empresa_id"]), empresaNome: texto(d["empresa_nome"]) };
    const top = topNaUrl ? leque.tops.find((t) => t.tipoOperacaoId === topNaUrl) : leque.tops.length === 1 ? leque.tops[0] : undefined;
    if (!top) {
      if (topNaUrl) return recusado("sem-top", MSG_PEDIDO_SEM_TOP_DE_ORCAMENTO);
      return {
        situacao: "escolher-top", pedido, tops: leque.tops,
        escolher: (t) => { const rota = rotaDoNovoOrcamento(pedido.id, t.tipoOperacaoId); if (rota) router.replace(rota); }
      };
    }
    // A capacidade do LAYOUT vem das TOPs da espécie (o mesmo cache): esperar evita o desenho do sistema piscar no da TOP.
    if (estadoTop.situacao === "carregando") return carregando("Carregando as operações de orçamento…");
    return {
      situacao: "formulario",
      chave: `criacao:${pedido.id}:${top.tipoOperacaoId}`,
      props: {
        modo: "criacao", variante, estadoTop, pedido, orcamento: null,
        top: { id: top.tipoOperacaoId, codigo: top.codigo, nome: top.nome },
        abertura: cabecalhoVazioDoOrcamento(),
        linhas: linhasDoPedido(d["itens"])
      }
    };
  })();

  /* A TRAVA DA SESSÃO (o molde da Central de Compras): aberto o formulário, uma releitura do pedido ou do leque (uma
     falha passageira, outra aba que gravou) não o desmonta nem apaga o que foi digitado. A URL mudou (outro pedido ou
     outra TOP): a trava cai. O servidor continua conferindo tudo no Salvar (o pedido que deixou de aceitar orçamento
     é recusado com a mensagem dele). */
  const sessao = `${variante.segmento}|${pedidoNaUrl}|${topNaUrl}`;
  const trava = React.useRef<{ sessao: string; entrada: Extract<EntradaDoOrcamento, { situacao: "formulario" }> } | null>(null);
  React.useLayoutEffect(() => {
    if (resultado.situacao === "formulario") trava.current = { sessao, entrada: resultado };
    else if (trava.current && trava.current.sessao !== sessao) trava.current = null;
  });
  if (resultado.situacao !== "formulario" && trava.current?.sessao === sessao) return trava.current.entrada;
  return resultado;
}

/* ═════════════════════════════════════ O FORMULÁRIO (criação e edição) ═════════════════════════════════════ */

export interface PropsDoFormularioDoOrcamento {
  modo: ModoDoOrcamento;
  variante: VarianteDeCompra;
  /** As TOPs da espécie orçamento (a capacidade do layout). */
  estadoTop: EstadoTop;
  /** A TOP do orçamento: a escolhida no leque do pedido (criação) ou a gravada (edição). */
  top: { id: string; codigo: string; nome: string };
  pedido: PedidoDoOrcamento;
  /** Só na edição: o orçamento gravado. Fornecedor, empresa e data ficam em LEITURA (o PUT não os aceita). */
  orcamento: { id: string; codigo: string; fornecedorNome: string } | null;
  /** Os valores de abertura: na criação, o cabeçalho vazio com a data de hoje; na edição, o gravado. */
  abertura: CabecalhoDoOrcamento;
  /** As linhas de abertura (o pedido na criação; o orçamento na edição). */
  linhas: ItemRow[];
  /** Só na edição: volta à leitura (`salvou` = o PUT gravou). */
  onFechar?: (salvou: boolean) => void;
}

/** Por que o Salvar está desabilitado POR ESTADO (pendência não desabilita: o clique abre a pílula, zero POST). */
export type TravaDoSalvarDoOrcamento = null | "salvando" | "layout-carregando" | "layout-falhou" | "regras-carregando" | "regras-falharam";

export function dicaDaTravaDoOrcamento(trava: TravaDoSalvarDoOrcamento): string | null {
  switch (trava) {
    case null: return null;
    case "salvando": return "Salvando…";
    case "layout-carregando": return "Carregando o layout…";
    case "layout-falhou": return "Layout não carregado";
    case "regras-carregando": return "Carregando as regras da operação…";
    case "regras-falharam": return "As regras da operação não carregaram";
  }
}

const ROTULO_DO_CAMPO_DO_ITEM: Readonly<Record<string, string>> = {
  valor_unitario: "valor unitário", item_pedido_id: "item do pedido", id: "item do orçamento", produto_id: "produto", quantidade: "quantidade"
};
/** `itens[0].valor_unitario` / `itens.0.valor_unitario` → "Item 1 · valor unitário"; `itens` → "Itens". */
export function descreverCaminhoDoItemDoOrcamento(caminho: string): string {
  const m = /^itens(?:\.|\[)(\d+)\]?(?:\.([a-z_]+))?$/.exec(caminho);
  if (!m) return "Itens";
  const n = Number(m[1]) + 1;
  return m[2] ? `Item ${n} · ${ROTULO_DO_CAMPO_DO_ITEM[m[2]] ?? m[2]}` : `Item ${n}`;
}
/** `itens[0].valor_unitario` → `items[0].valor_unitario` (o caminho que o motor lê). */
function caminhoNoMotor(caminho: string): string | null {
  const m = /^itens(?:\.(\d+)|\[(\d+)\])\.(.+)$/.exec(caminho);
  return m ? `items[${m[1] ?? m[2]}].${m[3]}` : null;
}

/** Os campos do cabeçalho que recebem o VALOR PADRÃO do layout na criação (a empresa é a do pedido; o fornecedor não tem padrão). */
const ACEITAM_PADRAO_DO_LAYOUT: readonly ChaveDoCabecalhoDoOrcamento[] = ["data_documento", "prazo_entrega_dias", "validade_orcamento", "observacao"];
/** Os rótulos de hoje dos campos do cabeçalho (o catálogo do orçamento); o layout pode renomeá-los. */
export const ROTULO_DE_HOJE_DO_ORCAMENTO: Readonly<Record<string, string>> = {
  empresa_id: "Empresa", fornecedor_id: "Fornecedor", data_documento: "Data do documento", condicao_pagamento_id: "Condição de pagamento",
  prazo_entrega_dias: "Prazo de entrega (dias)", validade_orcamento: "Validade do orçamento", observacao: "Observação"
};
const ehChaveDoCabecalho = (c: string): c is ChaveDoCabecalhoDoOrcamento => c in ROTULO_DE_HOJE_DO_ORCAMENTO && c !== "empresa_id";

/** O padrão de CADASTRO só na condição de pagamento (o plano: um por fornecedor — fornecedor padrão não faz sentido). */
const CAMPO_COM_PADRAO_DE_CADASTRO = "condicao_pagamento_id";

export interface EstadoDoFormularioDoOrcamento {
  modo: ModoDoOrcamento;
  variante: VarianteDeCompra;
  familia: string;
  top: PropsDoFormularioDoOrcamento["top"];
  pedido: PedidoDoOrcamento;
  orcamento: PropsDoFormularioDoOrcamento["orcamento"];
  /** "Movimento: …" da TOP (a família), quando as TOPs da espécie chegaram. */
  movimento: string;

  cabecalho: CabecalhoDoOrcamento;
  mudar: (p: Partial<CabecalhoDoOrcamento>) => void;
  itens: ItemRow[];
  /** Do motor: SÓ o preço de cada linha é aceito (produto, quantidade e as linhas são as do pedido). */
  setItens: (novos: ItemRow[]) => void;
  /** Σ quantidade × preço, em decimal com 2 casas (texto); `null` com número ilegível. Só apresentação. */
  totalDosItens: string | null;

  layout: EstruturaLayout | null;
  layoutVale: LayoutQueVale | null;
  layoutNaoCarregado: boolean;
  zonas: ZonasDaCentral;
  forcados: ReadonlySet<string>;
  /** A coluna do valor unitário com o rótulo e o obrigatório do layout (sem layout, a do sistema). */
  colunaDoUnitario: ColunaDoLayout;
  rotulo: (campo: string, hoje: string) => string;
  obrigatorio: (campo: string) => boolean;
  travado: (campo: string) => boolean;
  padraoInvalido: (campo: string) => boolean;
  /** Rótulo do padrão de cadastro enquanto o valor for o do padrão (dica ao RefSelect). */
  dica: (campo: ChaveDoCabecalhoDoOrcamento) => string | undefined;
  condicoesPermitidas: readonly string[] | null;

  erro: (campo: string) => string | undefined;
  /** Os erros dos itens no caminho que o motor lê (`items[k].valor_unitario`). */
  errosNoMotor: Record<string, string>;
  /** Os erros dos itens (inclusive os sem linha, como `itens`), descritos para a lista abaixo da grade. */
  errosDeItens: [string, string][];
  pendencias: Pendencia[];
  pendenciasAbertas: boolean;
  setPendenciasAbertas: (v: boolean) => void;

  travaDoSalvar: TravaDoSalvarDoOrcamento;
  salvarDesabilitado: boolean;
  salvando: boolean;
  salvar: () => void;
  /** O corpo EXATO do POST (criação) ou do PUT (edição). */
  corpo: () => Record<string, unknown>;

  alterado: boolean;
  /** Criação: volta à abertura (zero escrita). Edição: volta à leitura. */
  descartar: () => void;
}

export function useEstadoDoFormularioDoOrcamento(props: PropsDoFormularioDoOrcamento): EstadoDoFormularioDoOrcamento {
  const { modo, variante, estadoTop, top, pedido, orcamento, abertura, linhas: linhasDeAbertura, onFechar } = props;
  const router = useRouter(); const qc = useQueryClient(); const { can } = useAuth();
  const familia = variante.familia;
  const edicao = modo === "edicao";

  const [h, setH] = React.useState<CabecalhoDoOrcamento>(abertura);
  /** O estado INICIAL ("intocado"): a abertura com os padrões do layout aplicados. */
  const inicial = React.useRef<CabecalhoDoOrcamento>(abertura);
  const mudar = React.useCallback((p: Partial<CabecalhoDoOrcamento>) => setH((o) => ({ ...o, ...p })), []);
  const [itens, setItensCru] = React.useState<ItemRow[]>(linhasDeAbertura);
  /* Do motor só se aceita o PREÇO de cada linha: produto, quantidade e as linhas são as do pedido (o corpo do POST e do
     PUT leva todas, uma vez cada) — nenhuma coluna que o motor ponha ou tire muda o contrato. */
  const setItens = React.useCallback((novos: ItemRow[]) => setItensCru((antes) =>
    antes.map((l, i) => { const n = novos[i]; return n && n.unit_value !== l.unit_value ? { ...l, unit_value: texto(n.unit_value) } : l; })), []);
  const [erros, setErros] = React.useState<Record<string, string>>({});
  const [tentouSalvar, setTentouSalvar] = React.useState(false);
  const [pendenciasAbertas, setPendenciasAbertas] = React.useState(false);

  /* ── LAYOUT e REGRAS da TOP de orçamento: as portas exigem `.create`. Sem ela (edição de quem só edita), o layout do
     sistema e nenhuma regra — o servidor cobra a versão congelada. ── */
  const portasDaTop = can(`${variante.perm}.create`);
  const layoutAtivo = portasDaTop && entendeLayoutDocumento(estadoTop);
  const layoutQ = useQuery<unknown, ApiError>({
    queryKey: ["layout-efetivo", "compras", variante.segmento, top.id],
    queryFn: () => api<unknown>(`/api/compras/${variante.segmento}/layout-efetivo?tipo_operacao_id=${encodeURIComponent(top.id)}`),
    enabled: layoutAtivo && Boolean(top.id),
    retry: false
  });
  const layoutRecebido = layoutQ.data;
  const layoutLido = React.useMemo(() => (layoutAtivo ? estruturaDaResposta(layoutRecebido) : null), [layoutAtivo, layoutRecebido]);
  const layoutTerminou = layoutQ.isError || layoutQ.isSuccess;
  const layoutPendente = layoutAtivo && !layoutLido && !layoutTerminou;
  /* Criação: layout que não carrega BLOQUEIA (a Central de Compras de hoje). Edição: o orçamento já existe e a TOP pode
     ter saído (a porta responde 404): vale o layout do sistema, e o servidor cobra a versão congelada. */
  const layoutNaoCarregado = !edicao && layoutAtivo && !layoutLido && layoutTerminou;
  const layout = layoutLido;
  const layoutVale = React.useMemo(() => (layout ? layoutQueVale(layoutRecebido) : null), [layout, layoutRecebido]);
  const padroes = React.useMemo(() => (layout && !edicao ? padroesDaResposta(layoutRecebido) : SEM_PADROES), [layout, edicao, layoutRecebido]);

  const regrasQ = useQuery<unknown, ApiError>({
    queryKey: ["compras-regras-da-operacao", variante.segmento, top.id],
    queryFn: () => api<unknown>(`/api/compras/${variante.segmento}/regras-da-operacao?tipo_operacao_id=${encodeURIComponent(top.id)}`),
    enabled: portasDaTop && Boolean(top.id),
    retry: false
  });
  const regras: RegrasDaCompra | null = React.useMemo(() => (portasDaTop && regrasQ.data !== undefined ? lerRegras(regrasQ.data) : null), [portasDaTop, regrasQ.data]);
  const regrasPendente = portasDaTop && Boolean(top.id) && regrasQ.isPending;
  const regrasFalharam = !edicao && portasDaTop && regrasQ.isError;
  const exigidosPelaRegra = React.useMemo<ReadonlySet<string>>(() => new Set(camposExigidosPelaRegra(regras, false)), [regras]);
  const condicoesPermitidas = regras?.condicoesPermitidas ?? null;
  const condicaoNaoPermitida = (id: string) => condicoesPermitidas !== null && id !== "" && !condicoesPermitidas.some((x) => x.toLowerCase() === id.toLowerCase());

  const cfg = React.useMemo(() => new Map<string, CampoDoLayout>(layout ? [...layout.cabecalho, ...layout.rodape.flatMap((a) => a.campos)].map((x) => [x.campo, x]) : []), [layout]);
  const catalogo = React.useMemo(() => catalogoDaFamilia(familia), [familia]);
  const doSistema = React.useMemo(() => new Set(catalogo.filter((c) => c.parte !== "itens" && c.sistema).map((c) => c.chave)), [catalogo]);
  const doLayoutComCadastro = (c: string) => Boolean(layout) && c === CAMPO_COM_PADRAO_DE_CADASTRO && cfg.has(c);
  const padraoNaoPermitido = (c: string) => condicaoNaoPermitida(padroes.validos.get(c)?.id ?? "");
  const padraoDoCampo = (c: string) => (doLayoutComCadastro(c) && !padraoNaoPermitido(c) ? padroes.validos.get(c) ?? null : null);
  const padraoInvalido = (c: string) => doLayoutComCadastro(c) && (padroes.invalidos.has(c) || padraoNaoPermitido(c));

  /* PADRÕES DO LAYOUT (só na criação): uma vez por resposta, só em campo intocado. */
  const padroesAplicados = React.useRef<unknown>(null);
  React.useEffect(() => {
    if (edicao || !layout || regrasPendente || padroesAplicados.current === layoutRecebido) return;
    padroesAplicados.current = layoutRecebido;
    const antes = inicial.current;
    const novos: [ChaveDoCabecalhoDoOrcamento, string][] = [];
    for (const x of [...layout.cabecalho, ...layout.rodape.flatMap((a) => a.campos)]) {
      const campo = ACEITAM_PADRAO_DO_LAYOUT.find((c) => c === x.campo);
      if (!campo || !x.valorPadrao) continue;
      const v = valorDoPadrao(x.valorPadrao, pedido.empresaId);
      if (v !== null) novos.push([campo, v]);
    }
    const daCondicao = padraoDoCampo(CAMPO_COM_PADRAO_DE_CADASTRO);
    if (daCondicao) novos.push(["condicao_pagamento_id", daCondicao.id]);
    if (!novos.length) return;
    const comPadroes = { ...antes };
    for (const [k, v] of novos) comPadroes[k] = v;
    inicial.current = comPadroes;
    setH((o) => { const r = { ...o }; for (const [k, v] of novos) if (o[k] === antes[k]) r[k] = v; return r; });
  }, [edicao, layout, layoutRecebido, regrasPendente, pedido.empresaId, padraoDoCampo]);

  /* O DOCUMENTO COMO SERÁ GRAVADO — o que o servidor confere (layout e regras), com o preço vazio = "0" (o contrato). */
  const prazoTexto = h.prazo_entrega_dias.trim();
  const prazoValido = prazoTexto === "" || (/^\d+$/.test(prazoTexto) && Number(prazoTexto) <= PRAZO_MAXIMO_DE_ENTREGA_DIAS);
  const comoSeraGravado = (): Record<string, unknown> => ({
    empresa_id: pedido.empresaId, fornecedor_id: h.fornecedor_id, data_documento: h.data_documento,
    condicao_pagamento_id: h.condicao_pagamento_id || null, prazo_entrega_dias: prazoTexto === "" ? null : Number(prazoTexto),
    validade_orcamento: h.validade_orcamento || null, observacao: h.observacao.trim() || null,
    itens: itens.map((l) => ({ produto_id: l.product_id, quantidade: l.quantity, valor_unitario: l.unit_value || "0" }))
  });

  const rotulo = (c: string, hoje: string) => cfg.get(c)?.rotulo || hoje;
  const rotuloDe = (c: string) => rotulo(c, ROTULO_DE_HOJE_DO_ORCAMENTO[c] ?? c);

  /* PENDÊNCIAS — o que o servidor vai recusar e a tela já sabe (a pílula "N pendências"). */
  const pendencias: Pendencia[] = [];
  const jaListado = new Set<string>();
  const pendente = (caminho: string, mensagem: string, r?: string) => {
    if (jaListado.has(caminho)) return;
    jaListado.add(caminho);
    pendencias.push({ caminho, rotulo: r ?? (caminho.startsWith("itens") ? descreverCaminhoDoItemDoOrcamento(caminho) : rotuloDe(caminho)), mensagem });
  };
  if (!edicao && vazio(h.fornecedor_id)) pendente("fornecedor_id", "Informe o fornecedor.");
  if (!edicao && vazio(h.data_documento)) pendente("data_documento", "Informe a data do documento.");
  if (layout) for (const f of camposObrigatoriosFaltando(familia, layout, comoSeraGravado(), { classificacao: true, condicao: true })) pendente(f.caminho, mensagemCampoObrigatorio(f.rotulo), f.caminho.startsWith("itens") ? undefined : f.rotulo);
  for (const c of exigidosPelaRegra) if (ehChaveDoCabecalho(c) && vazio(h[c])) pendente(c, `${rotuloDe(c)} é obrigatório nesta operação.`);
  if (condicaoNaoPermitida(h.condicao_pagamento_id)) pendente("condicao_pagamento_id", MENSAGEM_CONDICAO_NAO_PERMITIDA);
  if (!prazoValido) pendente("prazo_entrega_dias", MSG_PRAZO_DE_ENTREGA);
  if (h.validade_orcamento && h.data_documento && h.validade_orcamento < h.data_documento) pendente("validade_orcamento", MSG_ORCAMENTO_VALIDADE_ANTES_DA_DATA);

  /* Os erros da tela: as pendências depois do primeiro Salvar; a condição fora das permitidas pela TOP, já (a opção vem
     do padrão do layout ou da gravação anterior — a lista só oferece as permitidas). */
  const errosLocais: Record<string, string> = {
    ...(condicaoNaoPermitida(h.condicao_pagamento_id) ? { condicao_pagamento_id: MENSAGEM_CONDICAO_NAO_PERMITIDA } : {}),
    ...(tentouSalvar ? Object.fromEntries(pendencias.map((p) => [p.caminho, p.mensagem])) : {})
  };
  const errosDaTela: Record<string, string> = { ...erros, ...errosLocais };
  const errosDeItens = Object.entries(errosDaTela).filter(([c]) => c.startsWith("itens"));
  const errosNoMotor: Record<string, string> = {};
  for (const [c, m] of errosDeItens) { const k = caminhoNoMotor(c); if (k) errosNoMotor[k] = m; }

  /* O DESENHO: o layout (ou o do sistema) mais os campos que a regra exige e o layout esconde. */
  const aparecerSempre = [...exigidosPelaRegra, ...Object.keys(errosDaTela).filter((c) => !c.startsWith("itens")),
    ...(condicaoNaoPermitida(h.condicao_pagamento_id) ? ["condicao_pagamento_id"] : [])];
  const chaveDoAparecer = [...new Set(aparecerSempre)].sort().join("|");
  const desenho = React.useMemo(() => estruturaComExigidos(familia, layout ?? LAYOUT_DO_SISTEMA(familia), chaveDoAparecer ? chaveDoAparecer.split("|") : []),
    [layout, familia, chaveDoAparecer]);
  const zonas = React.useMemo(() => zonasDaCentral(familia, desenho.estrutura), [familia, desenho]);
  const colunaDoUnitario = React.useMemo<ColunaDoLayout>(() => {
    const doLayout = layout?.itens.find((c) => c.campo === "valor_unitario");
    return { campo: "valor_unitario", obrigatorio: doLayout?.obrigatorio ?? true, ...(doLayout?.rotulo ? { rotulo: doLayout.rotulo } : {}) };
  }, [layout]);

  /* SALVAR — POST (criação) ou PUT (edição), com a chave de idempotência da instância. */
  const segmentoDoPedido = varianteDeCompra("pedido")?.segmento ?? "pedidos";
  const corpo = (): Record<string, unknown> => {
    if (edicao) {
      return {
        condicao_pagamento_id: h.condicao_pagamento_id || null,
        prazo_entrega_dias: prazoTexto === "" ? null : Number(prazoTexto),
        validade_orcamento: h.validade_orcamento || null,
        observacao: h.observacao.trim() || null,
        itens: itens.map((l) => ({ id: idDaLinha(l), valor_unitario: l.unit_value || "0" }))
      };
    }
    return {
      tipo_operacao_id: top.id, fornecedor_id: h.fornecedor_id, data_documento: h.data_documento,
      ...(h.condicao_pagamento_id ? { condicao_pagamento_id: h.condicao_pagamento_id } : {}),
      ...(prazoTexto !== "" ? { prazo_entrega_dias: Number(prazoTexto) } : {}),
      ...(h.validade_orcamento ? { validade_orcamento: h.validade_orcamento } : {}),
      ...(h.observacao.trim() ? { observacao: h.observacao.trim() } : {}),
      itens: itens.map((l) => ({ item_pedido_id: itemPedidoDaLinha(l), valor_unitario: l.unit_value || "0" }))
    };
  };
  /* A regra ÚNICA da chave (W0): troca só quando o servidor RESPONDEU com recusa; na queda de rede ou 5xx o reenvio leva
     a MESMA chave e recebe a resposta gravada — nunca um segundo orçamento. */
  const chave = useChaveDeIdempotencia();
  const salvarM = useMutation({
    mutationFn: () => {
      const c = corpo();
      return edicao && orcamento
        ? api<{ id: string }>(`/api/compras/${variante.segmento}/${encodeURIComponent(orcamento.id)}`, { method: "PUT", body: c, idempotencyKey: chave.doEnvio(c) })
        : api<{ id: string }>(`/api/compras/${segmentoDoPedido}/${encodeURIComponent(pedido.id)}/orcamentos`, { method: "POST", body: c, idempotencyKey: chave.doEnvio(c) });
    },
    onSuccess: (r) => {
      toast.success("Orçamento salvo");
      void invalidarLeiturasDeCompras(qc);
      if (edicao) { onFechar?.(true); return; }
      // O "Salvo ✓" vai à consulta pela memória, nunca pela URL (como a compra).
      entregarSalvo(chaveDepoisDeSalvarDeCompra, r.id, { confirmar: false });
      router.push(`/compras/${variante.segmento}/${r.id}`);
    },
    onError: (e) => {
      const aviso = chave.depoisDoErro(e);
      const doServidor = errosDoServidor(e);
      // "Um por fornecedor": a recusa (409 CONFLICT, sem campo) aponta o Fornecedor, além do aviso. O 409 não traz o
      // campo; a mensagem é a constante do domínio que a API e esta tela importam do MESMO lugar (`@agro/domain`).
      if (e instanceof ApiError && e.status === 409 && e.code === "CONFLICT" && e.message === MSG_ORCAMENTO_FORNECEDOR_REPETIDO) doServidor["fornecedor_id"] = e.message;
      setErros(doServidor);
      toast.error(aviso);
    }
  });

  const travaDoSalvar: TravaDoSalvarDoOrcamento =
    salvarM.isPending ? "salvando"
      : layoutNaoCarregado ? "layout-falhou"
        : layoutPendente ? "layout-carregando"
          : regrasPendente ? "regras-carregando"
            : regrasFalharam ? "regras-falharam"
              : null;

  const salvar = () => {
    // A defesa no handler: `disabled` é apresentação.
    if (travaDoSalvar) return;
    setErros({});
    setTentouSalvar(true);
    if (pendencias.length) { setPendenciasAbertas(true); return; } // zero POST/PUT
    salvarM.mutate();
  };

  const alterado = JSON.stringify(h) !== JSON.stringify(inicial.current)
    || itens.some((l, i) => texto(l.unit_value) !== texto(linhasDeAbertura[i]?.unit_value));
  useDirtyTab(alterado && !salvarM.isSuccess);

  const descartar = () => {
    if (edicao) { onFechar?.(false); return; }
    setH(inicial.current); setItensCru(linhasDeAbertura); setErros({}); setTentouSalvar(false); setPendenciasAbertas(false);
  };

  const travado = (c: string) => Boolean(layout) && cfg.get(c)?.editavel === false && !padraoInvalido(c)
    && !(exigidosPelaRegra.has(c) && !(Boolean(cfg.get(c)?.valorPadrao) || Boolean(padraoDoCampo(c))));

  const total = totalDasLinhas(itens);
  return {
    modo, variante, familia, top, pedido, orcamento,
    movimento: estadoTop.situacao === "pronto" ? estadoTop.dados.family.label : "",
    cabecalho: h, mudar, itens, setItens, totalDosItens: total ? total.toFixed(2) : null,
    layout, layoutVale, layoutNaoCarregado, zonas, forcados: desenho.forcados, colunaDoUnitario,
    rotulo, obrigatorio: (c) => (layout ? Boolean(cfg.get(c)?.obrigatorio) : doSistema.has(c)) || exigidosPelaRegra.has(c),
    travado, padraoInvalido,
    dica: (c) => { const p = padraoDoCampo(c); return p && h[c] === p.id ? p.rotulo : undefined; },
    condicoesPermitidas,
    erro: (c) => errosDaTela[c], errosNoMotor, errosDeItens: errosDeItens.map(([c, m]) => [descreverCaminhoDoItemDoOrcamento(c), m]),
    pendencias, pendenciasAbertas, setPendenciasAbertas,
    travaDoSalvar, salvarDesabilitado: travaDoSalvar !== null, salvando: salvarM.isPending, salvar, corpo,
    alterado, descartar
  };
}

/* ═════════════════════════════════════ A CONSULTA DO ORÇAMENTO ═════════════════════════════════════ */

/** O efeito do cancelamento, dito no diálogo (o orçamento não mexe em estoque nem em financeiro). */
export const TEXTO_DO_CANCELAMENTO_DO_ORCAMENTO = "O orçamento passa a cancelado e libera o fornecedor para um orçamento novo neste pedido.";
/** O nome da espécie no diálogo de cancelar ("Cancelar orçamento de compra {codigo}?"). */
export const ESPECIE_NO_CANCELAMENTO = "orçamento de compra";

export interface EstadoDaConsultaDoOrcamento {
  variante: VarianteDeCompra;
  id: string;
  porta: string;
  q: UseQueryResult<Row>;
  documento: Row | undefined;
  situacao: string;
  codigo: string;
  titulo: string;
  /** "Editar orçamento": aparece com `orcamentos_compra.edit`; habilitada só com o orçamento aberto. */
  podeEditar: boolean;
  editarHabilitado: boolean;
  editando: boolean;
  setEditando: (v: boolean) => void;
  /** "Cancelar orçamento de compra…": `orcamentos_compra.delete` ∧ aberto. */
  podeCancelar: boolean;
  cancelando: boolean;
  setCancelando: (v: boolean) => void;
  cancelar: (motivo: string) => void;
  cancelarOcupado: boolean;
  podeVerHistorico: boolean;
  /** O "Salvo ✓" vindo da criação (a consulta mostra o do PUT da edição por conta própria). */
  salvoAgora: boolean;
}

export function useEstadoDaConsultaDoOrcamento({ variante, id }: { variante: VarianteDeCompra; id: string }): EstadoDaConsultaDoOrcamento {
  const { can } = useAuth(); const qc = useQueryClient(); const tr = useTradutor();
  const porta = `/api/compras/${variante.segmento}/${encodeURIComponent(id)}`;
  const q = useDoc<Row>(porta);
  /* O "Salvo" vindo da criação: lido uma vez, da memória (o mesmo molde da consulta de compras). */
  const [salvo] = React.useState(() => consumirSalvo(chaveDepoisDeSalvarDeCompra, id));
  React.useEffect(() => { if (salvo) descartarSalvo(chaveDepoisDeSalvarDeCompra, id); }, [salvo, id]);
  const [editando, setEditando] = React.useState(false);
  const [cancelando, setCancelando] = React.useState(false);
  const chaveCancelar = useChaveDeIdempotencia();
  const cancelarM = useMutation({
    mutationFn: (motivo: string) => { const c = corpoDoCancelamento(motivo); return api(`${porta}/cancel`, { method: "POST", body: c, idempotencyKey: chaveCancelar.doEnvio(c) }); },
    onSuccess: () => { toast.success("Orçamento cancelado"); setCancelando(false); void invalidarLeiturasDeCompras(qc); },
    onError: (e) => { toast.error(chaveCancelar.depoisDoErro(e)); void invalidarLeiturasDeCompras(qc); }
  });
  const d = q.data;
  const situacao = d ? texto(d["situacao"]) : "";
  const codigo = d ? texto(d["codigo"]) : "";
  const aberto = situacao === "aberto";
  return {
    variante, id, porta, q, documento: d, situacao, codigo,
    titulo: `${tr(variante.chaveI18n)} ${codigo || "—"}`,
    podeEditar: can(`${variante.perm}.edit`), editarHabilitado: aberto, editando, setEditando,
    podeCancelar: can(`${variante.perm}.delete`) && aberto, cancelando, setCancelando,
    cancelar: (motivo) => cancelarM.mutate(motivo), cancelarOcupado: cancelarM.isPending,
    podeVerHistorico: can("audit_logs.view"),
    salvoAgora: salvo !== null
  };
}

/** O cabeçalho do orçamento gravado, como a edição o abre. */
export function cabecalhoDoOrcamentoGravado(d: Row): CabecalhoDoOrcamento {
  const prazo = d["prazo_entrega_dias"];
  return {
    fornecedor_id: texto(d["fornecedor_id"]), data_documento: texto(d["data_documento"]).slice(0, 10),
    condicao_pagamento_id: texto(d["condicao_pagamento_id"]),
    prazo_entrega_dias: typeof prazo === "number" ? String(prazo) : texto(prazo),
    validade_orcamento: texto(d["validade_orcamento"]).slice(0, 10), observacao: texto(d["observacao"])
  };
}

/** A TOP gravada no orçamento (id, código, nome), pela leitura do servidor. */
export function topDoOrcamentoGravado(d: Row): { id: string; codigo: string; nome: string } {
  const t = d["tipo_operacao"];
  const top = typeof t === "object" && t !== null && !Array.isArray(t) ? (t as Record<string, unknown>) : {};
  return { id: texto(d["tipo_operacao_id"] ?? top["id"]), codigo: texto(top["codigo"]), nome: texto(top["nome"]) };
}
