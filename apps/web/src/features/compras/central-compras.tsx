"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AVISO_PADRAO_INVALIDO_CENTRAL, ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA, ERRO_EXIGENCIA_NAO_ATENDIDA, LAYOUT_DO_SISTEMA, camposObrigatoriosFaltando,
  catalogoDaFamilia, chavePadraoDeCadastro, mensagemCampoObrigatorio, type CampoDoLayout
} from "@agro/domain";
import { api, ApiError, newIdem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { useTradutor } from "@/lib/i18n";
import { brl, todayISO } from "@/lib/utils";
import { enumLabel } from "@/lib/copy";
import { Button, Card, CardBody, CardHeader, Confirm, Field, Input, LoadingState, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect, type BuscaDeOpcoes, type Option } from "@/components/ui/ref-select";
import { ItemsEditor, PlanEditor, defaultPlan, totalDaLinhaExibido, useEmpresaPadrao, type ColunaDoEditorDeItens, type ItemRow, type Plan } from "@/features/docs/shared";
import { MensagemTop, entendeLayoutDocumento, podeLancar, type EstadoTop, type TopOperacional } from "@/features/sales/tipo-operacao-select";
import { LancadorDeTipoOperacao, pedidoImpossivel, topSelecionada } from "@/features/sales/lancador-tipo-operacao";
import { useTopsDaEspecie, varianteDeCompra, type VarianteDeCompra } from "./variantes";
import { useRecebimentoDoPedido } from "./receber-pedido";
import { acompanharDescontoDaOrigem, cabecalhoDoPedido, linhasDoRecebimento } from "./recebimento-linhas";
import { rotaDoDocumento } from "./documentos-compra-list";
import {
  SEM_PADROES, camposExigidosPelaRegra, colunasDoEditor, estruturaComExigidos, estruturaDaResposta, hrefDoConfigurador, layoutQueVale, lerRegras,
  padroesDaResposta, textoDoLayoutQueVale, valorDoPadrao, zonasDaCentral, type RegrasDaCompra
} from "./layout-da-central";

/**
 * A CENTRAL DE COMPRAS — o lançamento de um Pedido de compra ou de uma Compra (COMPRAS-01, decisão 267).
 *
 * ┌─ O QUE FOI COPIADO E O QUE FOI REUSADO ────────────────────────────────────────────────────────┐
 * │ A Central de Vendas (`app/(app)/vendas/[kind]/new`) é presa à venda em cada campo (cliente,      │
 * │ `/api/sales`, layout do documento, cliente em atraso, reserva). Parametrizá-la mudaria vendas;   │
 * │ por isso esta Central é PRÓPRIA, no formato simples dos documentos de estoque, e reusa só as     │
 * │ peças genéricas que não mudam: o editor de itens e o de parcelas (`features/docs/shared`), o    │
 * │ lançador e a descoberta de TOP (`features/sales/…`, que não conhecem a porta).                   │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * A TOP da URL é PEDIDO: vale só se estiver na lista que o servidor devolve para AQUELA espécie. Totais,
 * código e número são do servidor; o total aqui é apresentação. O contrato do POST é estrito (chave
 * desconhecida → 422): o corpo leva só as chaves do contrato, e campo vazio não viaja.
 *
 * ┌─ MODO RECEBER PEDIDO (COMPRAS-02, decisão 268) ────────────────────────────────────────────────────────┐
 * │ `/compras/compras/new?tipo_operacao_id=…&pedido=…` — a MESMA Central, aberta pelos Próximos passos do     │
 * │ pedido. Receber é lançar uma compra COM ORIGEM, e a API tem uma porta própria para isso                  │
 * │ (`POST /api/compras/pedidos/:id/convert`) que chama a MESMA função de lançar compra. O que muda aqui:    │
 * │ a TOP é a do passo escolhido (conferida contra o leque do pedido, não contra a lista de TOPs da espécie); │
 * │ fornecedor, empresa e produto vêm do pedido, travados (o corpo nem os leva); os itens são os do pedido    │
 * │ com saldo, e a quantidade vai até o saldo — travada quando a aresta não é "Em partes". O resto do         │
 * │ formulário é o de sempre: nota, série, data de entrada, armazém, lote e validade a pessoa informa.        │
 * │ Pedido que não pode ser recebido agora (fechado, TOP fora do leque, API anterior) não vira formulário:   │
 * │ a Central diz por quê, e o Salvar não aparece habilitado.                                               │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ LAYOUT DO DOCUMENTO (COMPRAS-03, decisão 269) — o mecanismo de Vendas, sem desenho novo ──────────────┐
 * │ SÓ com `capacidades.layoutDocumento` EXATA em operation-types. Sem ela nenhuma pergunta a              │
 * │ `/layout-efetivo` sai e a Central é a de hoje (o desenho segue `LAYOUT_DO_SISTEMA`, que É a Central de  │
 * │ hoje, sem `data-campo`, sem cobrança nova). Com ela, o Salvar trava enquanto o layout não chega        │
 * │ conferido, e o layout governa: visibilidade e ordem DENTRO do grid de hoje (larguras de hoje), rótulo,  │
 * │ "*", campo não editável (travado) e padrões (literal, variável e de cadastro) só em campo intocado.     │
 * │ "Dados adicionais" e as abas aparecem EM SEQUÊNCIA depois dos campos principais, com o mesmo grid.     │
 * │ O que a REGRA exige aparece mesmo que o layout o esconda (esconder o que o servidor vai cobrar faria o │
 * │ Salvar recusar algo invisível): as exigências da TOP, natureza e centro quando gera título, forma de    │
 * │ pagamento, vencimento e armazém quando a política exige, e lote/validade de produto com controle de    │
 * │ lote. A conferência do obrigatório é a MESMA função do domínio que a API usa, sobre o documento inteiro │
 * │ que o servidor vai ver (no receber, com empresa, fornecedor e produto do pedido); o 422 cai no campo.   │
 * │ No RECEBER, o pedido vence o padrão: o padrão só preenche o que o pedido deixou vazio, e o "não         │
 * │ editável" trava mostrando o valor do pedido.                                                            │
 * │ A TOP fica TRAVADA na Central, como em Vendas: trocar de operação é voltar ao lançador.                 │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
type Cabecalho = {
  empresa_id: string; fornecedor_id: string; transportadora_id: string; data_documento: string; data_entrada: string;
  data_vencimento: string; numero_nota: string; serie_nota: string; categoria_financeira_id: string; centro_custo_id: string;
  condicao_pagamento_id: string; forma_pagamento_id: string; frete: string; outras_despesas: string; desconto: string; observacao: string;
};

const vazio = (v: string) => v.trim() === "";
const opcional = (v: string) => (vazio(v) ? undefined : v.trim());

const ehObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Os erros de campo que o servidor devolveu, por caminho: `details: [{ path, message }]` (validação e, na COMPRAS-03,
 * obrigatório do layout — `itens[i].campo` inclusive), `details.exigencias: [{ caminho, mensagem }]` (regras da
 * operação) e `details.campo` (condição não permitida).
 */
function errosDoServidor(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError)) return {};
  if (e.code === ERRO_EXIGENCIA_NAO_ATENDIDA && ehObj(e.details) && Array.isArray(e.details.exigencias)) {
    const out: Record<string, string> = {};
    for (const x of e.details.exigencias as unknown[]) if (ehObj(x) && typeof x.caminho === "string" && typeof x.mensagem === "string") out[x.caminho] = x.mensagem;
    return out;
  }
  if (e.code === ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA) return { [ehObj(e.details) && typeof e.details.campo === "string" ? e.details.campo : "condicao_pagamento_id"]: e.message };
  if (!Array.isArray(e.details)) return {};
  const out: Record<string, string> = {};
  for (const d of e.details as unknown[]) {
    if (typeof d === "object" && d !== null && typeof (d as { path?: unknown }).path === "string" && typeof (d as { message?: unknown }).message === "string") {
      out[(d as { path: string }).path] = (d as { message: string }).message;
    }
  }
  return out;
}

/** Regras da operação da TOP escolhida (`lerRegras`). `pendente`: a pergunta saiu e a resposta ainda não chegou. */
function useRegrasDaCompra(segmento: string, top: string, ativo: boolean): { regras: RegrasDaCompra | null; pendente: boolean } {
  const q = useQuery<unknown, ApiError>({
    queryKey: ["compras-regras-da-operacao", segmento, top],
    queryFn: () => api<unknown>(`/api/compras/${segmento}/regras-da-operacao?tipo_operacao_id=${encodeURIComponent(top)}`),
    enabled: ativo && Boolean(top), retry: false
  });
  const regras = React.useMemo(() => (ativo && q.data !== undefined ? lerRegras(q.data) : null), [ativo, q.data]);
  return { regras, pendente: ativo && Boolean(top) && q.isPending };
}

/** Natureza de DESPESA para compra: analítica, do tipo despesa OU receita e despesa (a mesma régua da API). */
const opcoesDeNaturezaDeDespesa: BuscaDeOpcoes = {
  chave: "compras-natureza-despesa",
  buscar: async (search) => {
    const uma = (nature: string) => api<Option[]>(`/api/resources/financial_categories/options?${new URLSearchParams({ kind: "analytic", nature, ...(search ? { search } : {}) }).toString()}`);
    const [despesa, ambas] = await Promise.all([uma("expense"), uma("both")]);
    return [...despesa, ...ambas].sort((a, b) => String(a.code ?? a.label).localeCompare(String(b.code ?? b.label), "pt-BR", { numeric: true }));
  }
};

/**
 * Controle de lote de cada produto (cadastro). `daLinha`: desconhecido = campos abertos (o servidor é quem recusa).
 * `pede` (COMPRAS-03): a coluna Lote/Validade tem de aparecer mesmo que o layout a esconda? Só com produto escolhido —
 * controle lido que pede, ou controle que não se conseguiu ler (a pessoa precisa de onde digitar o que o servidor
 * pode cobrar). Enquanto a leitura não chega, não força: a coluna não pisca a cada produto escolhido.
 */
function useControleDeLote(produtos: string[]): { daLinha: (produtoId: string) => { lote: boolean; validade: boolean }; pede: (produtoId: string, campo: "lote" | "validade") => boolean } {
  const unicos = Array.from(new Set(produtos.filter(Boolean)));
  const qs = useQueries({ queries: unicos.map((id) => ({ queryKey: ["compras-produto-lote", id], queryFn: () => api<Record<string, unknown>>(`/api/resources/products/${id}`), staleTime: 60_000, retry: false })) });
  const mapa = new Map<string, string>(); const ilegivel = new Set<string>();
  unicos.forEach((id, i) => {
    const q = qs[i]; const c = q?.data?.["controle_lote"];
    if (typeof c === "string") mapa.set(id, c); else if (q && !q.isPending) ilegivel.add(id);
  });
  return {
    daLinha: (produtoId) => {
      const c = mapa.get(produtoId);
      if (c === undefined) return { lote: true, validade: true };
      return { lote: c !== "nenhum", validade: c === "lote_validade" };
    },
    pede: (produtoId, campo) => {
      if (!produtoId) return false;
      const c = mapa.get(produtoId);
      if (c === undefined) return ilegivel.has(produtoId);
      return campo === "lote" ? c !== "nenhum" : c === "lote_validade";
    }
  };
}

/** As colunas do editor de itens da Central de hoje (sem layout) — o layout do sistema tem exatamente estas, nesta ordem. */
const COLUNAS_DE_HOJE_DA_COMPRA: ColunaDoEditorDeItens[] = ["warehouse", "product", "quantity", "unit_value", "discount", "discount_percent", "lot", "expiration"];
const COLUNAS_DE_HOJE_DO_PEDIDO: ColunaDoEditorDeItens[] = ["warehouse", "product", "quantity", "unit_value", "discount", "discount_percent"];

/**
 * A CENTRAL — TOP PRIMEIRO, FORMULÁRIO DEPOIS (COMPRAS-03, como a Central de Vendas).
 *
 *   sem `?tipo_operacao_id`, ou com uma que a lista da espécie não confirma → LANÇADOR (o de Vendas, que não conhece
 *                                                                              porta): o formulário não existe na árvore;
 *   com a TOP que a lista confirma                                          → FORMULÁRIO, com a TOP travada;
 *   com `?pedido` (receber, só na compra)                                   → FORMULÁRIO do recebimento: a TOP é a do
 *                                                                              passo, conferida contra o leque do pedido.
 *
 * O formulário mora num componente SEPARADO, com `key` pela TOP (ou pelo pedido e passo): sem TOP válida não existe
 * estado de formulário nem Salvar, e trocar a TOP pela URL nunca herda o que foi digitado para outra operação.
 *
 * A TRAVA DA SESSÃO (a mesma de Vendas): uma nova leitura da lista que deixe de confirmar a TOP não desmonta o que a
 * pessoa digitou — o formulário continua montado, mas a ESCRITA só é autorizada pela lista de AGORA
 * (`escritaTopConfirmada`). A chave é espécie + TOP pedida: outra espécie nunca herda a trava.
 */
export function CentralDeCompras({ variante }: { variante: VarianteDeCompra }) {
  const router = useRouter(); const sp = useSearchParams(); const tr = useTradutor();
  const { can } = useAuth();
  const pedidaNaUrl = sp.get("tipo_operacao_id") ?? "";
  // RECEBER PEDIDO só existe na COMPRA: `pedido` na URL de outra espécie não muda nada (é o lançamento de sempre).
  const pedidoId = variante.variante === "compra" ? sp.get("pedido") ?? "" : "";
  const podeCriar = can(`${variante.perm}.create`);
  // No recebimento a lista de TOPs da espécie é perguntada SÓ pela capacidade (layout): a TOP é a do passo.
  const estado = useTopsDaEspecie(variante.segmento, podeCriar);
  const topAtual = pedidoId ? null : topSelecionada(estado, pedidaNaUrl);
  const chave = !pedidoId && pedidaNaUrl ? `${variante.segmento}:${pedidaNaUrl}` : null;
  const trava = React.useRef<{ chave: string; top: TopOperacional } | null>(null);
  React.useLayoutEffect(() => {
    if (!chave) { trava.current = null; return; }
    if (topAtual) trava.current = { chave, top: topAtual };
  });

  if (pedidoId) {
    return <FormularioDeCompra key={`receber:${pedidoId}:${pedidaNaUrl}`} variante={variante} estado={estado} podeCriar={podeCriar}
      pedidoId={pedidoId} topDaUrl={pedidaNaUrl} top={null} escritaTopConfirmada={false} />;
  }
  const topDaSessao = chave && trava.current?.chave === chave ? trava.current.top : null;
  const topEfetiva = topAtual ?? topDaSessao;
  if (topEfetiva) {
    return <FormularioDeCompra key={`lancar:${topEfetiva.id}`} variante={variante} estado={estado} podeCriar={podeCriar}
      pedidoId="" topDaUrl={pedidaNaUrl} top={topEfetiva} escritaTopConfirmada={podeLancar(estado) && topAtual !== null} />;
  }
  return <LancadorDeTipoOperacao
    estado={estado}
    titulo={`Novo documento · ${tr(variante.chaveI18n)}`}
    indisponivel={pedidoImpossivel(estado, pedidaNaUrl)}
    onCancelar={() => router.push("/compras?tab=documentos")}
    // `replace`: o lançador e o formulário são duas caras da MESMA etapa de criação (o Voltar do navegador sai dela)
    onContinuar={(t) => router.replace(`/compras/${variante.segmento}/new?tipo_operacao_id=${encodeURIComponent(t.id)}`)}
  />;
}

function FormularioDeCompra({ variante, estado, podeCriar, pedidoId, topDaUrl, top: topDoLancamento, escritaTopConfirmada }: {
  variante: VarianteDeCompra;
  /** O estado ATUAL da descoberta de TOPs da espécie (e da capacidade do layout). */
  estado: EstadoTop;
  podeCriar: boolean;
  /** Vazio = lançamento comum. */
  pedidoId: string;
  topDaUrl: string;
  /** A TOP do lançamento comum (validada contra a lista da espécie); `null` no recebimento. */
  top: TopOperacional | null;
  /** A lista de AGORA confirma a TOP do lançamento? Só isso autoriza o POST do lançamento comum. */
  escritaTopConfirmada: boolean;
}) {
  const router = useRouter(); const tr = useTradutor(); const qc = useQueryClient();
  const { can } = useAuth();
  const ehCompra = variante.variante === "compra";
  const familia = variante.familia;
  const empresaPadrao = useEmpresaPadrao();
  const recebimento = useRecebimentoDoPedido(pedidoId, topDaUrl, variante.variante);
  const modoReceber = recebimento.situacao !== "inativo";
  const recebendo = recebimento.situacao === "pronto" ? recebimento : null;
  // No recebimento a TOP é a do passo (fixada quando o pedido preenche a Central); no lançamento, a travada.
  const [topDoPasso, setTopDoPasso] = React.useState("");
  const top = modoReceber ? topDoPasso : topDoLancamento?.id ?? "";
  // O movimento da TOP travada, guardado ao montar: uma nova leitura da lista não apaga o contexto da tela.
  const [movimento] = React.useState(() => (estado.situacao === "pronto" ? estado.dados.family.label : ""));

  const [h, setH] = React.useState<Cabecalho>({
    empresa_id: "", fornecedor_id: "", transportadora_id: "", data_documento: todayISO(), data_entrada: "", data_vencimento: "",
    numero_nota: "", serie_nota: "", categoria_financeira_id: "", centro_custo_id: "", condicao_pagamento_id: "", forma_pagamento_id: "",
    frete: "0", outras_despesas: "0", desconto: "0", observacao: ""
  });
  /**
   * O ESTADO INICIAL do cabeçalho — o que conta como "intocado". Acompanha o que não é digitação: o pedido (no receber)
   * e os padrões do layout aplicados. O padrão só entra em campo intocado; e "tem coisa digitada" (a confirmação de
   * "Alterar operação") compara com ele — sem a empresa, que o efeito abaixo preenche sozinho.
   */
  const inicial = React.useRef<Cabecalho>(h);
  React.useEffect(() => { setH((o) => ({ ...o, empresa_id: o.empresa_id || empresaPadrao })); }, [empresaPadrao]);
  const mudar = (p: Partial<Cabecalho>) => setH((o) => ({ ...o, ...p }));
  const [itens, setItensCru] = React.useState<ItemRow[]>([]);
  // No modo receber, o desconto em valor acompanha a quantidade (na proporção do pedido) até a pessoa mexer nele.
  const setItens = (novos: ItemRow[]) => setItensCru((antes) => (modoReceber ? acompanharDescontoDaOrigem(antes, novos) : novos));
  const [ajustarParcelas, setAjustarParcelas] = React.useState(false);
  const [plano, setPlano] = React.useState<Plan>(defaultPlan());
  const [erros, setErros] = React.useState<Record<string, string>>({});
  const [confirmarTroca, setConfirmarTroca] = React.useState(false);

  /**
   * O PEDIDO PREENCHE A CENTRAL UMA VEZ, quando fica pronto. Depois disso o formulário é da pessoa: uma nova leitura
   * do pedido (foco na janela, invalidação) não pode apagar o que ela já digitou. COMPRAS-03: o que o pedido trouxe
   * com valor fica marcado (`doPedido`) — o padrão do layout nunca o substitui.
   */
  const preenchidoDe = React.useRef("");
  const doPedido = React.useRef<ReadonlySet<string>>(new Set());
  const [preenchimento, setPreenchimento] = React.useState("");
  React.useEffect(() => {
    // A chave é o PEDIDO e o PASSO: outro passo do mesmo pedido (outra TOP, outra regra de partes) preenche de novo.
    const chaveDoPreenchimento = recebendo ? `${pedidoId}|${recebendo.passo.tipoOperacaoId}` : "";
    if (!recebendo || preenchidoDe.current === chaveDoPreenchimento) return;
    preenchidoDe.current = chaveDoPreenchimento;
    const p = recebendo.pedido;
    const vindos: Partial<Cabecalho> = { empresa_id: String(p["empresa_id"] ?? ""), fornecedor_id: String(p["fornecedor_id"] ?? ""), ...cabecalhoDoPedido(p) };
    doPedido.current = new Set(Object.entries(vindos).filter(([, v]) => typeof v === "string" && !vazio(v)).map(([k]) => k));
    inicial.current = { ...inicial.current, ...vindos };
    setTopDoPasso(recebendo.passo.tipoOperacaoId);
    setH((o) => ({ ...o, ...vindos }));
    setItensCru(linhasDoRecebimento(p.itens));
    setPreenchimento(chaveDoPreenchimento);
  }, [recebendo, pedidoId]);

  const totalItens = itens.reduce((a, it) => a + totalDaLinhaExibido(it), 0);
  const totalExibido = totalItens + Number(h.frete || 0) + Number(h.outras_despesas || 0) - Number(h.desconto || 0);

  /** O que o lançamento comum e o recebimento têm em comum: tudo, menos empresa, fornecedor e produto. */
  const cabecalhoDoCorpo = () => ({
    tipo_operacao_id: top,
    transportadora_id: opcional(h.transportadora_id),
    data_documento: h.data_documento,
    data_vencimento: opcional(h.data_vencimento),
    ...(ehCompra ? { data_entrada: opcional(h.data_entrada), numero_nota: opcional(h.numero_nota), serie_nota: opcional(h.serie_nota) } : {}),
    categoria_financeira_id: opcional(h.categoria_financeira_id),
    centro_custo_id: opcional(h.centro_custo_id),
    condicao_pagamento_id: opcional(h.condicao_pagamento_id),
    ...(ajustarParcelas ? { plano_parcelas: plano } : {}),
    forma_pagamento_id: opcional(h.forma_pagamento_id),
    frete: opcional(h.frete),
    outras_despesas: opcional(h.outras_despesas),
    desconto: opcional(h.desconto),
    observacao: opcional(h.observacao)
  });
  const camposDoItem = (i: ItemRow) => ({
    armazem_id: opcional(i.warehouse_id ?? ""),
    quantidade: i.quantity,
    valor_unitario: i.unit_value || "0",
    desconto: opcional(i.discount ?? ""),
    desconto_percentual: opcional(i.discount_percent ?? ""),
    ...(ehCompra ? { lote: opcional(i.provider_lot ?? ""), validade: opcional(i.expiration_date ?? "") } : {})
  });
  /**
   * O corpo do POST. No recebimento é o contrato do `/convert`: SEM empresa e SEM fornecedor (vêm do pedido), e cada
   * item com `item_origem_id` no lugar de `produto_id` (o produto vem do item do pedido). Mandar as chaves do
   * lançamento comum ali seria 422 — o contrato é estrito, e ainda bem.
   */
  const corpo = () => (modoReceber
    ? { ...cabecalhoDoCorpo(), itens: itens.map((i) => ({ item_origem_id: String(i["item_origem_id"] ?? ""), ...camposDoItem(i) })) }
    : { empresa_id: h.empresa_id, fornecedor_id: h.fornecedor_id, ...cabecalhoDoCorpo(), itens: itens.map((i) => ({ produto_id: i.product_id, ...camposDoItem(i) })) });
  /**
   * O DOCUMENTO QUE O SERVIDOR VAI CONFERIR (COMPRAS-03): no lançamento, o próprio corpo; no recebimento, o corpo com
   * empresa e fornecedor do PEDIDO e o produto de cada item do pedido — é o que `lancar` confere na compra de destino.
   */
  const documentoConferido = (): Record<string, unknown> => (recebendo
    ? { ...cabecalhoDoCorpo(), empresa_id: String(recebendo.pedido["empresa_id"] ?? ""), fornecedor_id: String(recebendo.pedido["fornecedor_id"] ?? ""),
      itens: itens.map((i) => ({ produto_id: i.product_id, ...camposDoItem(i) })) }
    : corpo());

  /** A porta do POST: a da espécie, ou a do recebimento do pedido. O retorno das duas é o documento criado (`id`). */
  const segmentoDoPedido = varianteDeCompra("pedido")?.segmento ?? "";
  const porta = modoReceber ? `/api/compras/${segmentoDoPedido}/${pedidoId}/convert` : `/api/compras/${variante.segmento}`;

  // Uma chave de idempotência por TENTATIVA de lançamento; renovada só depois de uma recusa.
  const chave = React.useRef(newIdem());
  const salvar = useMutation({
    mutationFn: () => api<{ id: string }>(porta, { method: "POST", body: corpo(), idempotencyKey: chave.current }),
    onSuccess: (r) => { toast.success("Salvo com sucesso"); void qc.invalidateQueries(); router.push(`/compras/${variante.segmento}/${r.id}`); },
    onError: (e) => { chave.current = newIdem(); setErros(errosDoServidor(e)); toast.error((e as Error).message); }
  });

  const { regras, pendente: regrasPendente } = useRegrasDaCompra(variante.segmento, top, modoReceber ? Boolean(recebendo) && !!top : podeLancar(estado) && !!top);
  /**
   * O QUE A REGRA EXIGE (dono: `camposExigidosPelaRegra`) — "*" e, com layout, o campo aparece mesmo escondido. Sem
   * as flags da COMPRAS-03 (API anterior) é exatamente o de antes: as exigências da TOP, e natureza e centro quando a
   * compra gera contas a pagar (a API recusa no campo); pedido não gera título.
   */
  const exigidosPelaRegra = React.useMemo(() => new Set(camposExigidosPelaRegra(regras, ehCompra)), [regras, ehCompra]);
  const lote = useControleDeLote(ehCompra ? itens.map((i) => i.product_id) : []);
  // Produto que deixou de controlar lote/validade não leva o valor digitado antes (evita a recusa do item).
  React.useEffect(() => {
    if (!ehCompra) return;
    let mudou = false;
    const novos = itens.map((it) => {
      const c = lote.daLinha(it.product_id);
      const l = c.lote ? it.provider_lot : ""; const validade = c.validade ? it.expiration_date : "";
      if ((it.provider_lot ?? "") !== (l ?? "") || (it.expiration_date ?? "") !== (validade ?? "")) { mudou = true; return { ...it, provider_lot: l, expiration_date: validade }; }
      return it;
    });
    if (mudou) setItens(novos);
  });

  /* ── LAYOUT DO DOCUMENTO (COMPRAS-03) ─────────────────────────────────────────────────────────────────────────── */
  const layoutAtivo = entendeLayoutDocumento(estado);
  const layoutQ = useQuery<unknown, ApiError>({
    queryKey: ["layout-efetivo", "compras", variante.segmento, top],
    queryFn: () => api<unknown>(`/api/compras/${variante.segmento}/layout-efetivo?tipo_operacao_id=${encodeURIComponent(top)}`),
    enabled: layoutAtivo && Boolean(top),
    retry: false
  });
  const layoutRecebido = layoutQ.data;
  const layout = React.useMemo(() => (layoutAtivo ? estruturaDaResposta(layoutRecebido) : null), [layoutAtivo, layoutRecebido]);
  // Gravar sem saber o que é obrigatório seria descobrir no 422: com a capacidade, sem layout conferido, o Salvar trava.
  const layoutPendente = layoutAtivo && !layout;
  // No recebimento a capacidade chega pela lista da espécie; enquanto ela não responde, não se sabe se há layout.
  const capacidadePendente = modoReceber && podeCriar && estado.situacao === "carregando";
  const layoutVale = React.useMemo(() => (layout ? layoutQueVale(layoutRecebido) : null), [layout, layoutRecebido]);
  const padroes = React.useMemo(() => (layout ? padroesDaResposta(layoutRecebido) : SEM_PADROES), [layout, layoutRecebido]);
  /** Configuração do layout por chave (cabeçalho e abas) — só com layout de verdade. Campo forçado pela regra não está aqui. */
  const cfg = React.useMemo(() => new Map<string, CampoDoLayout>(layout ? [...layout.cabecalho, ...layout.rodape.flatMap((a) => a.campos)].map((x) => [x.campo, x]) : []), [layout]);
  const catalogo = React.useMemo(() => catalogoDaFamilia(familia), [familia]);
  /** Obrigatórios de hoje (sem layout): os "do sistema" do catálogo — Empresa, Fornecedor e Data do documento. */
  const doSistema = React.useMemo(() => new Set(catalogo.filter((c) => c.parte !== "itens" && c.sistema).map((c) => c.chave)), [catalogo]);
  /** Padrão de cadastro só em campo de referência que o CATÁLOGO declara (dono: `referencia`) e que o layout desenha. */
  const camposDeCadastro = React.useMemo(() => new Set(catalogo.filter((c) => c.parte !== "itens" && c.referencia).map((c) => c.chave)), [catalogo]);
  const doLayoutComCadastro = (c: string) => Boolean(layout) && camposDeCadastro.has(c) && cfg.has(c);
  // Condição de pagamento padrão fora das permitidas da TOP não vale (vira aviso de padrão inválido), como em Vendas.
  const condicoesPermitidas = regras?.condicoesPermitidas ?? null;
  const condicaoNaoPermitida = (id: string) => condicoesPermitidas !== null && id !== "" && !condicoesPermitidas.some((x) => x.toLowerCase() === id.toLowerCase());
  const padraoNaoPermitido = (c: string) => c === "condicao_pagamento_id" && condicaoNaoPermitida(padroes.validos.get(c)?.id ?? "");
  /** O padrão de cadastro que vale agora para o campo (null: nenhum). */
  const padraoDoCampo = (c: string) => (doLayoutComCadastro(c) && !padraoNaoPermitido(c) ? padroes.validos.get(c) ?? null : null);
  /** O padrão do campo morreu no cadastro: nada é aplicado, o aviso aparece e o campo fica editável nesta abertura. */
  const padraoInvalido = (c: string) => doLayoutComCadastro(c) && (padroes.invalidos.has(c) || padraoNaoPermitido(c));

  /**
   * ARMAZÉM PADRÃO: o padrão da coluna Armazém vale SÓ para a empresa do documento de agora (`empresaId` da resposta
   * === a empresa do cabeçalho); de outra empresa, ou sem empresa na resposta, nenhum. No lançamento, só a linha NOVA
   * o recebe; no recebimento, só a linha do pedido que veio SEM armazém (o pedido vence o padrão).
   */
  const padraoArmazem = layout && layout.itens.some((c) => c.campo === "armazem_id") ? padroes.validos.get(chavePadraoDeCadastro("itens", "armazem_id")) : undefined;
  const armazemPadrao = padraoArmazem && padraoArmazem.empresaId && padraoArmazem.empresaId === h.empresa_id ? padraoArmazem.id : null;

  /**
   * VALOR PADRÃO DO LAYOUT, aplicado UMA vez por resposta (e, no recebimento, depois de o pedido preencher), só a campo
   * ainda intocado — o valor digitado nunca é sobrescrito — e nunca a campo que o pedido trouxe com valor. Espera as
   * regras chegarem: a condição padrão que a TOP não permite não é aplicada (vira aviso). O estado inicial acompanha,
   * para o padrão não contar como "tem coisa digitada".
   */
  const padroesAplicados = React.useRef<{ resposta: unknown; preenchimento: string } | null>(null);
  React.useEffect(() => {
    if (!layout || regrasPendente || (modoReceber && !preenchimento)) return;
    const marca = padroesAplicados.current;
    if (marca && marca.resposta === layoutRecebido && marca.preenchimento === preenchimento) return;
    padroesAplicados.current = { resposta: layoutRecebido, preenchimento };
    const antes = inicial.current;
    const aceita = (c: string): c is keyof Cabecalho => c in antes && !doPedido.current.has(c);
    const novos: Partial<Cabecalho> = {};
    for (const x of [...layout.cabecalho, ...layout.rodape.flatMap((a) => a.campos)]) {
      if (!x.valorPadrao || !aceita(x.campo)) continue;
      const v = valorDoPadrao(x.valorPadrao, empresaPadrao);
      if (v !== null) novos[x.campo] = v;
    }
    for (const [c, p] of padroes.validos) if (aceita(c) && padraoDoCampo(c)) novos[c] = p.id;
    const chaves = Object.keys(novos) as (keyof Cabecalho)[];
    if (chaves.length) {
      inicial.current = { ...antes, ...novos };
      // intocado = igual ao inicial; a empresa também quando é a que o efeito de abertura pôs (não é digitação)
      setH((o) => {
        const r = { ...o };
        for (const k of chaves) if (o[k] === antes[k] || (k === "empresa_id" && o[k] === empresaPadrao)) r[k] = novos[k]!;
        return r;
      });
    }
    if (modoReceber && armazemPadrao) setItensCru((ls) => ls.map((l) => (l.warehouse_id ? l : { ...l, warehouse_id: armazemPadrao })));
  }, [layout, layoutRecebido, regrasPendente, modoReceber, preenchimento, empresaPadrao, padroes, padraoDoCampo, armazemPadrao]);

  /** As colunas dos itens: as do layout (com a regra: armazém exigido, lote/validade de produto com controle) ou as de hoje. */
  const colunasForcadas = [
    ...(regras?.exigeArmazem ? ["armazem_id"] : []),
    ...(ehCompra ? (["lote", "validade"] as const).filter((c) => itens.some((it) => lote.pede(it.product_id, c))) : [])
  ];
  const colunasDoLayout = layout ? colunasDoEditor(familia, layout.itens, { forcadas: colunasForcadas, obrigatoriasPelaRegra: new Set(regras?.exigeArmazem ? ["armazem_id"] : []) }) : undefined;
  const fieldsDosItens: ColunaDoEditorDeItens[] = colunasDoLayout ? colunasDoLayout.map((c) => c.coluna) : ehCompra ? COLUNAS_DE_HOJE_DA_COMPRA : COLUNAS_DE_HOJE_DO_PEDIDO;

  /**
   * OBRIGATÓRIOS DO LAYOUT: a MESMA função do domínio que a API usa (`camposObrigatoriosFaltando`), sobre o documento
   * que o servidor vai ver. Depois da primeira tentativa de salvar, os erros acompanham a digitação; os do servidor
   * ficam até a próxima tentativa.
   */
  const [tentouSalvar, setTentouSalvar] = React.useState(false);
  const faltando = () => (layout ? camposObrigatoriosFaltando(familia, layout, documentoConferido(), { classificacao: true, condicao: true }) : []);
  const errosLocais: Record<string, string> = layout && tentouSalvar ? Object.fromEntries(faltando().map((f) => [f.caminho, mensagemCampoObrigatorio(f.rotulo)])) : {};
  const errosDaTela: Record<string, string> = { ...erros, ...errosLocais };
  const erro = (c: string) => errosDaTela[c];
  const errosDeItens = Object.entries(errosDaTela).filter(([c]) => c.startsWith("itens"));

  /**
   * O desenho: o layout + o que ele esconde e a tela não pode esconder. Sem layout, o LAYOUT DO SISTEMA — a Central de
   * hoje. Além do que a REGRA exige, aparece todo campo do cabeçalho com ERRO (422 do servidor ou conferência local: um
   * erro num campo invisível não teria onde ser corrigido) e a condição de pagamento que a TOP não permite (o servidor a
   * recusa, e escondida ela nunca sairia do documento). `estruturaComExigidos` só desenha chaves do catálogo do
   * cabeçalho — caminhos de item (`itens[0].x`) não entram.
   */
  const aparecerSempre = [...exigidosPelaRegra, ...Object.keys(errosDaTela), ...(condicaoNaoPermitida(h.condicao_pagamento_id) ? ["condicao_pagamento_id"] : [])];
  const chaveDoAparecer = [...new Set(aparecerSempre)].sort().join("|");
  const desenho = React.useMemo(() => (layout ? estruturaComExigidos(familia, layout, chaveDoAparecer ? chaveDoAparecer.split("|") : []) : null), [layout, familia, chaveDoAparecer]);
  const zonas = React.useMemo(() => zonasDaCentral(familia, desenho?.estrutura ?? LAYOUT_DO_SISTEMA(familia)), [familia, desenho]);

  const pronto = modoReceber ? Boolean(recebendo) && !!top : escritaTopConfirmada;
  const salvarBloqueado = !pronto || !itens.length || salvar.isPending || layoutPendente || capacidadePendente || regrasPendente;
  const submit = () => {
    // A defesa no handler, e não só no `disabled` do botão: `disabled` é apresentação.
    if (salvarBloqueado) return;
    setErros({});
    if (layout) {
      setTentouSalvar(true);
      if (faltando().length) return;
    }
    salvar.mutate();
  };

  /* "Tem coisa digitada?" — contra o estado inicial, sem a empresa (preenchida por efeito, não por digitação). */
  const semEmpresa = ({ empresa_id: _empresa, ...resto }: Cabecalho) => resto;
  const sujo = itens.length > 0 || ajustarParcelas || JSON.stringify(semEmpresa(h)) !== JSON.stringify(semEmpresa(inicial.current));
  const voltarAoLancador = () => router.replace(`/compras/${variante.segmento}/new`);
  const alterarOperacao = () => { if (sujo) setConfirmarTroca(true); else voltarAoLancador(); };

  const rotuloDoPedido = enumLabel("especie_documento_compra", "pedido");
  const codigoDoPedido = recebendo ? String(recebendo.pedido["codigo"] ?? "") : "";
  const titulo = modoReceber ? `Receber ${rotuloDoPedido.toLowerCase()} ${codigoDoPedido}`.trim() : `Novo documento · ${tr(variante.chaveI18n)}`;
  // Sem o pedido pronto não há formulário a mostrar: só a faixa do recebimento, dizendo o que falta.
  const mostrarFormulario = !modoReceber || Boolean(recebendo);
  const emPartes = recebendo?.passo.emPartes === true;

  /* ── CADA CAMPO ────────────────────────────────────────────────────────────────────────────────────────────────
   * Sem layout (sem a capacidade) nada muda no DOM: o campo é o de hoje, sem invólucro. Com layout: rótulo e "*" do
   * layout (somados à exigência da regra), `data-campo`/`data-obrigatorio` num invólucro que não ocupa lugar no grid
   * (`display: contents` — as larguras são as de hoje), erro no próprio campo, e o não editável travado mostrando o
   * valor. Campo forçado pela regra: rótulo de hoje, sem padrão, sem trava. */
  const rot = (c: string, hoje: string) => cfg.get(c)?.rotulo || hoje;
  const req = (c: string) => (layout ? Boolean(cfg.get(c)?.obrigatorio) : doSistema.has(c)) || exigidosPelaRegra.has(c);
  /** O rótulo do padrão de cadastro vai ao RefSelect enquanto o valor for o do padrão (sem consulta). */
  const dica = (c: keyof Cabecalho) => { const p = padraoDoCampo(c); return p && h[c] === p.id ? p.rotulo : undefined; };
  /**
   * O aviso do padrão morto, AO LADO do campo (logo depois do `Field`, numa linha inteira do grid), nunca dentro dele: o
   * `Field` liga o rótulo ao controle injetando o id no filho ÚNICO — com o aviso como segundo filho, o rótulo perderia
   * o campo. Sem padrão inválido, o `Field` sozinho — o de hoje.
   */
  const comAviso = (c: string, campo: React.ReactElement): React.ReactNode => (padraoInvalido(c)
    ? <>{campo}<p data-testid="padrao-invalido-aviso" className="col-span-12 -mt-2 text-[11px] text-amber-700">{AVISO_PADRAO_INVALIDO_CENTRAL}</p></>
    : campo);
  const desenhar = (c: string): React.ReactNode => {
    switch (c) {
      case "empresa_id": return <Field label={rot(c, "Empresa")} required={req(c)} span={4} error={erro(c)}><RefSelect resource="empresas" value={h.empresa_id} disabled={modoReceber || undefined} allowEmpty={!modoReceber}
        labelHint={recebendo ? String(recebendo.pedido["empresa_nome"] ?? "") || null : undefined} onChange={(v) => mudar({ empresa_id: v ?? "" })} /></Field>;
      case "fornecedor_id": return comAviso(c, <Field label={rot(c, "Fornecedor")} required={req(c)} span={4} error={erro(c)}><RefSelect resource="people" value={h.fornecedor_id} disabled={modoReceber || undefined} allowEmpty={!modoReceber}
        labelHint={recebendo ? String(recebendo.pedido["fornecedor_nome"] ?? "") || null : dica("fornecedor_id")} onChange={(v) => mudar({ fornecedor_id: v ?? "" })} filter={{ is_provider: "true" }} /></Field>);
      case "data_documento": return <Field label={rot(c, "Data do documento")} required={req(c)} span={2} error={erro(c)}><Input data-testid="compras-data-documento" type="date" value={h.data_documento} onChange={(e) => mudar({ data_documento: e.target.value })} /></Field>;
      case "data_entrada": return <Field label={rot(c, "Data de entrada")} required={req(c)} span={2} error={erro(c)}><Input data-testid="compras-data-entrada" type="date" value={h.data_entrada} onChange={(e) => mudar({ data_entrada: e.target.value })} /></Field>;
      case "data_vencimento": return <Field label={rot(c, "Vencimento")} required={req(c)} span={2} error={erro(c)}><Input data-testid="compras-data-vencimento" type="date" value={h.data_vencimento} onChange={(e) => mudar({ data_vencimento: e.target.value })} /></Field>;
      case "numero_nota": return <Field label={rot(c, "Número da nota")} required={req(c)} span={2} error={erro(c)}><Input data-testid="compras-numero-nota" value={h.numero_nota} onChange={(e) => mudar({ numero_nota: e.target.value })} /></Field>;
      case "serie_nota": return <Field label={rot(c, "Série")} required={req(c)} span={1} error={erro(c)}><Input data-testid="compras-serie-nota" value={h.serie_nota} onChange={(e) => mudar({ serie_nota: e.target.value })} /></Field>;
      case "transportadora_id": return comAviso(c, <Field label={rot(c, "Transportadora")} required={req(c)} span={3} error={erro(c)}><RefSelect resource="people" value={h.transportadora_id} onChange={(v) => mudar({ transportadora_id: v ?? "" })} filter={{ is_transporter: "true" }} labelHint={dica("transportadora_id")} /></Field>);
      case "categoria_financeira_id": return <Field label={rot(c, "Natureza de despesa")} required={req(c)} span={3} error={erro(c)}><RefSelect resource="financial_categories" value={h.categoria_financeira_id} onChange={(v) => mudar({ categoria_financeira_id: v ?? "" })} buscarOpcoes={opcoesDeNaturezaDeDespesa} /></Field>;
      case "centro_custo_id": return comAviso(c, <Field label={rot(c, "Centro de resultado")} required={req(c)} span={3} error={erro(c)}><RefSelect resource="cost_centers" value={h.centro_custo_id} onChange={(v) => mudar({ centro_custo_id: v ?? "" })} filter={{ kind: "analytic" }} labelHint={dica("centro_custo_id")} /></Field>);
      case "condicao_pagamento_id": return comAviso(c, <Field label={rot(c, "Condição de pagamento")} required={req(c)} span={3} error={erro(c)}><RefSelect resource="condicoes_pagamento" somenteIds={condicoesPermitidas} value={h.condicao_pagamento_id} onChange={(v) => mudar({ condicao_pagamento_id: v ?? "" })} labelHint={dica("condicao_pagamento_id")} /></Field>);
      case "forma_pagamento_id": return comAviso(c, <Field label={rot(c, "Forma de pagamento")} required={req(c)} span={3} error={erro(c)}><RefSelect resource="payment_methods" value={h.forma_pagamento_id} onChange={(v) => mudar({ forma_pagamento_id: v ?? "" })} labelHint={dica("forma_pagamento_id")} /></Field>);
      case "frete": return <Field label={rot(c, "Frete")} required={req(c)} span={2} error={erro(c)}><Input data-testid="compras-frete" type="number" step="0.01" min="0" value={h.frete} onChange={(e) => mudar({ frete: e.target.value })} /></Field>;
      case "outras_despesas": return <Field label={rot(c, "Outras despesas")} required={req(c)} span={2} error={erro(c)}><Input data-testid="compras-outras-despesas" type="number" step="0.01" min="0" value={h.outras_despesas} onChange={(e) => mudar({ outras_despesas: e.target.value })} /></Field>;
      case "desconto": return <Field label={rot(c, "Desconto")} required={req(c)} span={2} error={erro(c)}><Input data-testid="compras-desconto" type="number" step="0.01" min="0" value={h.desconto} onChange={(e) => mudar({ desconto: e.target.value })} /></Field>;
      case "plano_parcelas": return <Field label={rot(c, "Parcelas")} required={req(c)} span={3} error={erro(c)}>
        <NativeSelect data-testid="compras-parcelas" value={ajustarParcelas ? "ajustar" : "padrao"} onChange={(e) => setAjustarParcelas(e.target.value === "ajustar")}>
          <option value="padrao">Pela condição (ou à vista)</option>
          <option value="ajustar">Ajustar parcelas</option>
        </NativeSelect>
      </Field>;
      case "observacao": return <Field label={rot(c, "Observação")} required={req(c)} span={12} error={erro(c)}><Textarea data-testid="compras-observacao" value={h.observacao} onChange={(e) => mudar({ observacao: e.target.value })} /></Field>;
      default: return null;
    }
  };
  /**
   * Não editável do layout TRAVA — salvo com o padrão de cadastro morto (fica editável nesta abertura) e salvo quando a
   * REGRA exige o campo e ele ficaria travado VAZIO (o documento nunca seria salvo): sem valor padrão do layout e, no
   * RECEBER, sem valor vindo do pedido — com o valor do pedido o campo continua travado, mostrando esse valor.
   */
  const temPadrao = (c: string) => Boolean(cfg.get(c)?.valorPadrao) || Boolean(padraoDoCampo(c));
  const render = (c: string) => {
    const n = desenhar(c);
    if (!layout) return <React.Fragment key={c}>{n}</React.Fragment>;
    const travado = cfg.get(c)?.editavel === false && !padraoInvalido(c) && !(exigidosPelaRegra.has(c) && !temPadrao(c) && !(modoReceber && doPedido.current.has(c)));
    return <div key={c} style={{ display: "contents" }} data-campo={c} data-obrigatorio={String(req(c))} {...(desenho?.forcados.has(c) ? { "data-forcado": "true" } : {})}>
      {travado ? <fieldset disabled data-editavel="false" style={{ display: "contents" }}>{n}</fieldset> : n}
    </div>;
  };

  /* A TOP TRAVADA: contexto do lançamento, não campo. Trocar é "Alterar operação" (volta ao lançador); no recebimento, é
     escolher outro passo no pedido (o Voltar leva a ele). */
  const campoDaTop = (codigo: string, nome: string, movimentoDaTop: string) => <Field label="Tipo de Operação" required span={4}>
    <Input data-testid="compras-top-travada" data-tipo-operacao-id={top} readOnly disabled value={`${codigo} — ${nome}`} />
    {movimentoDaTop && <span className="mt-1 block text-xs text-slate-500">Movimento: {movimentoDaTop}</span>}
  </Field>;

  /* Só com a capacidade do layout E a resposta conferida — sem a capacidade, nada: a Central de hoje. `can` só decide
     se o atalho "Configurar" aparece (apresentação); quem nega o configurador é a rota. */
  const linhaDoLayout = layoutVale && <div className="flex flex-wrap items-baseline gap-x-2">
    <p data-testid="compras-layout-efetivo" data-origem={layoutVale.origem} data-layout-id={layoutVale.id ?? ""} className="text-[11.5px] text-slate-500">{textoDoLayoutQueVale(layoutVale)}</p>
    {can("tipos_operacao.edit") && <Link data-testid="compras-layout-configurar" href={hrefDoConfigurador(layoutVale)} className="text-[11.5px] font-medium text-emerald-700 hover:underline">Configurar</Link>}
  </div>;

  return <>
    <Card data-testid="compras-central" data-especie={variante.variante} data-modo={modoReceber ? "receber" : "lancar"}>
      <CardHeader title={titulo} actions={<>
        {/* No recebimento, voltar é voltar ao PEDIDO: foi de lá que a pessoa veio, pelos Próximos passos. */}
        <Button variant="outline" size="sm" onClick={() => router.push(modoReceber ? rotaDoDocumento({ id: pedidoId, especie: "pedido" }) : "/compras?tab=documentos")}>Voltar</Button>
        {!modoReceber && <Button variant="outline" size="sm" data-testid="compras-alterar-operacao" onClick={alterarOperacao}>Alterar operação</Button>}
        <Button size="sm" data-testid="compras-salvar" loading={salvar.isPending} disabled={salvarBloqueado} onClick={submit}>Salvar</Button>
      </>} />
      <CardBody className="space-y-4">
        {/* A lista de AGORA não confirma mais a TOP desta sessão: o formulário continua, a escrita não. */}
        {!modoReceber && !escritaTopConfirmada && <div className="space-y-1 rounded-md bg-amber-50 p-3">
          <MensagemTop estado={estado} />
          {estado.situacao === "pronto" && <p data-testid="top-indisponivel" className="text-sm text-amber-800">O Tipo de Operação selecionado não está disponível para este lançamento.</p>}
          <p className="text-xs text-amber-700">O que já foi preenchido continua aqui. Use “Alterar operação” para escolher outra.</p>
        </div>}
        {layoutPendente && (layoutQ.isError || (layoutQ.isSuccess && !layout)) && <div className="rounded-md bg-amber-50 p-3">
          <p data-testid="compras-layout-nao-carregado" className="text-sm text-amber-700">Não foi possível carregar o layout deste Tipo de Operação. O lançamento está bloqueado até ele ser carregado.</p>
        </div>}
        {modoReceber && <div data-testid="compras-central-receber" data-pedido-id={pedidoId} data-situacao={recebimento.situacao} data-em-partes={recebendo ? String(emPartes) : undefined} className="space-y-1 text-[12.5px] text-slate-700">
          {recebimento.situacao === "carregando" && <LoadingState variant="compact" label="Carregando o pedido de compra…" />}
          {recebimento.situacao === "recusado" && <p data-testid="compras-receber-recusado" className="text-sm text-amber-700">{recebimento.mensagem}</p>}
          {recebendo && <>
            <p>
              Recebendo o <Link className="text-brand-700 underline" data-testid="compras-receber-pedido" href={rotaDoDocumento({ id: pedidoId, especie: "pedido" })}>{rotuloDoPedido.toLowerCase()} {codigoDoPedido}</Link>
              {" "}pela operação <span className="font-mono font-semibold">{recebendo.passo.codigo}</span> — {recebendo.passo.nome}.
            </p>
            <p className="text-slate-500" data-testid="compras-receber-regra">
              {emPartes
                ? "Em partes: escolha os itens e as quantidades desta compra, cada uma até o saldo do item."
                : "Esta operação recebe o pedido inteiro: cada item com o saldo, sem mudar a quantidade."}
              {" "}Fornecedor, empresa e produto vêm do pedido. Valor unitário e descontos também, e podem mudar: valem os da nota.
            </p>
          </>}
        </div>}
        {mostrarFormulario && <>
        {linhaDoLayout}
        <div className="grid grid-cols-12 gap-3">
          {recebendo
            ? campoDaTop(recebendo.passo.codigo, recebendo.passo.nome, recebendo.passo.familiaRotulo)
            : topDoLancamento && campoDaTop(topDoLancamento.code, topDoLancamento.name, movimento)}
          {zonas.principais.map(render)}
        </div>
        {/* As zonas do layout, EM SEQUÊNCIA e com o grid de hoje (sem recolher, sem abas de verdade: isso é da faixa F2). */}
        {zonas.adicionais.length > 0 && <div data-testid="compras-zona-adicionais" className="space-y-2">
          <p className="text-[11px] font-semibold uppercase text-slate-500">Dados adicionais</p>
          <div className="grid grid-cols-12 gap-3">{zonas.adicionais.map(render)}</div>
        </div>}
        {zonas.abas.map((a) => <div key={a.indice} data-testid={`compras-zona-aba-${a.indice}`} className="space-y-2">
          <p className="text-[11px] font-semibold uppercase text-slate-500">{a.aba}</p>
          <div className="grid grid-cols-12 gap-3">{a.campos.map(render)}</div>
        </div>)}
        {ajustarParcelas && <div data-testid="compras-plano"><PlanEditor plan={plano} onChange={setPlano} /></div>}
        <div data-testid="compras-itens">
          <ItemsEditor items={itens} onChange={setItens} loteDaLinha={ehCompra ? (it) => lote.daLinha(it.product_id) : undefined}
            daOrigem={modoReceber ? { saldo: (it) => String(it["saldo"] ?? "0"), quantidadeTravada: !emPartes, testIdDaLinha: (it) => `compras-receber-item-${String(it["item_origem_id"] ?? "")}` } : undefined}
            fields={fieldsDosItens} colunasDoLayout={colunasDoLayout} defaults={armazemPadrao && !modoReceber ? { warehouse_id: armazemPadrao } : undefined} />
          {errosDeItens.length > 0 && <ul data-testid="compras-erros-itens" className="mt-2 space-y-0.5 text-[12px] text-red-700">
            {errosDeItens.map(([c, m]) => <li key={c}>{descreverCaminhoDeItem(c)}: {m}</li>)}
          </ul>}
        </div>
        <div className="text-right text-sm font-semibold" data-testid="compras-total">Total do documento: {brl(totalExibido)}</div>
        </>}
      </CardBody>
    </Card>

    {/* Trocar a operação descarta o que foi digitado — então pergunta antes, em vez de descobrir depois. */}
    <Confirm open={confirmarTroca} onOpenChange={setConfirmarTroca} title="Alterar o Tipo de Operação?"
      text="Os dados já preenchidos neste lançamento serão descartados." danger
      onConfirm={() => { setConfirmarTroca(false); voltarAoLancador(); }} />
  </>;
}

const ROTULO_DO_CAMPO_DO_ITEM: Record<string, string> = {
  produto_id: "produto", item_origem_id: "item do pedido", armazem_id: "armazém", quantidade: "quantidade", valor_unitario: "valor unitário",
  desconto: "desconto", desconto_percentual: "desconto %", lote: "lote", validade: "validade"
};

/** `itens.0.lote` / `itens[0].lote` → "Item 1 · lote". */
function descreverCaminhoDeItem(caminho: string): string {
  const m = /^itens(?:\.|\[)(\d+)\]?(?:\.([a-z_]+))?$/.exec(caminho);
  if (!m) return "Itens";
  const n = Number(m[1]) + 1;
  return m[2] ? `Item ${n} · ${ROTULO_DO_CAMPO_DO_ITEM[m[2]] ?? m[2]}` : `Item ${n}`;
}
