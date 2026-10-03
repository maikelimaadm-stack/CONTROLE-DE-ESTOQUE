"use client";
import * as React from "react";
import { useQueries } from "@tanstack/react-query";
import { D, money } from "@agro/shared";
import {
  conferirTotalDaNota, linhasDoItemDaNota, parcelasDaNota, quantidadeInterna, totaisDaCompra, unitarioInterno,
  type ConferenciaDaImportacaoNfe, type ControleDeLoteDoProduto, type GerarCompraDaNota, type ItemDaNota, type LinhaDaCompraDaNota,
  type MotivoDaRecusaDaLinha, type ParcelasDaNota, type ProdutoDoVinculo, type TipoFator
} from "@agro/domain";
import { api, type ApiError } from "@/lib/api";
import type { RecusaNoCampo } from "./api";

/**
 * O ESTADO DA CONFERÊNCIA DO XML (OPERACOES-01 F7, decisão 284) — sem JSX. As abas só DESENHAM; o que vai no corpo do
 * "Gerar compra", o que é pendência, as contas da tela e para que aba vai cada recusa do servidor moram aqui.
 *
 *   · O corpo (`GerarCompraDaNota`) leva só DECISÕES: TOP, fornecedor, produto/fator/local de cada item da nota, pedido,
 *     financeiro. Os VALORES (quantidades, preços, impostos, lotes do rastro, duplicatas) o servidor relê do XML
 *     guardado — a tela nunca os manda. Decimais sempre em TEXTO (fator e percentual), nunca número JSON.
 *   · As contas da tela (quantidade e unitário internos, linhas por lote, total contra o vNF, parcelas da nota) são as
 *     MESMAS funções do domínio que o servidor usa (`@agro/domain`, nfe-compra): o que a tela mostra é o que a compra
 *     terá. Mesmo assim, quem decide é o servidor — a recusa dele (422) volta para o campo e para a aba do `path`.
 *   · Pendência que BLOQUEIA o "Gerar compra": a divergência do servidor que a tela não resolve (parceiro, valor que a
 *     compra não representa, nota já lançada, DF-e em andamento) e o que a tela sabe que falta (TOP, produto de cada
 *     item, fator, lote, total que não bate, parcelas da nota que não conferem, item sem o item do pedido).
 */

export type AbaDaConferencia = "cabecalho" | "itens" | "pedido" | "financeiro" | "divergencias";
export const ABAS_DA_CONFERENCIA: readonly AbaDaConferencia[] = ["cabecalho", "itens", "pedido", "financeiro", "divergencias"];

/** As divergências do servidor que a tela RESOLVE com as decisões (ela recalcula com as mesmas contas do domínio). */
const RESOLVIDAS_NA_TELA: ReadonlySet<string> = new Set(["item_sem_vinculo", "item_ambiguo", "rastro_diferente_da_quantidade", "quantidade_invalida", "total_diferente", "lote_sem_rastro"]);

/** A decisão de UM item da nota, como a tela a guarda (texto nos campos digitáveis). */
export interface DecisaoDoItemNaTela {
  nItem: number;
  produtoId: string;
  /** A pessoa escolheu o produto (não veio do vínculo): uma troca de fornecedor não o desfaz. */
  produtoManual: boolean;
  fator: string;
  tipoFator: TipoFator;
  armazemId: string;
  geraEstoque: boolean;
  imobilizado: boolean;
  lembrar: boolean;
  lote: string;
  validade: string;
  itemOrigemId: string;
  categoriaId: string;
  centroId: string;
}

export interface LinhaDoRateioNaTela { categoriaId: string; centroId: string; contaId: string; safraId: string; percentual: string }

export interface FinanceiroNaTela {
  parcelas: "nota" | "condicao";
  condicaoId: string;
  vencimento: string;
  formaId: string;
  tipoTituloId: string;
  classificacao: "" | "capex" | "opex";
  rateioTipo: "documento" | "por_valor" | "por_produto";
  categoriaId: string;
  centroId: string;
  linhas: LinhaDoRateioNaTela[];
}

export interface CabecalhoNaTela { topId: string; dataEntrada: string; observacao: string; transportadoraId: string; pedidoId: string }

/** O produto como a tela o conhece: do vínculo do servidor, do cadastro rápido ou da leitura do cadastro. */
export interface ProdutoNaTela { id: string; codigo: string; descricao: string; controleLote: ControleDeLoteDoProduto; controlaEstoque: boolean }

/** Uma pendência ou divergência na tela: de onde veio, se bloqueia e em que aba se resolve. */
export interface DivergenciaNaTela { codigo: string; mensagem: string; nItem: number | null; bloqueia: boolean; aba: AbaDaConferencia; origem: "servidor" | "tela" }

/** A conta de UM item com a decisão: as linhas da compra (uma por lote) ou o motivo de não haver. */
export type ContaDoItem =
  | { situacao: "sem_produto" }
  | { situacao: "carregando" }
  | { situacao: "fator_invalido" }
  | { situacao: "recusa"; motivo: MotivoDaRecusaDaLinha | "validade_obrigatoria" }
  | { situacao: "pronta"; quantidadeInterna: string; unitarioInterno: string; linhas: LinhaDaCompraDaNota[] };

/* ═════════════════════════════════════ textos decimais ═════════════════════════════════════ */

/** Vírgula vira ponto e o resto fica como digitado (a forma é conferida em `fatorValido`/`percentualValido`). */
export const decimalDigitado = (v: string) => v.replace(/\s+/g, "").replace(",", ".");
export const fatorValido = (v: string) => /^\d{1,12}(\.\d{1,6})?$/.test(v) && D(v).gt(0);
export const percentualValido = (v: string) => /^\d{1,3}(\.\d{1,4})?$/.test(v) && D(v).gt(0) && D(v).lte(100);

/* ═════════════════════════════════════ caminho → aba ═════════════════════════════════════ */

/** A aba de um `path` de recusa do servidor (o corpo do gerar). Desconhecido → Divergências. */
export function abaDoCaminho(path: string): AbaDaConferencia {
  if (/^itens\[\d+\]\.item_origem_id$/.test(path) || path === "pedido_id") return "pedido";
  if (path === "itens" || path.startsWith("itens[")) return "itens";
  if (path.startsWith("financeiro")) return "financeiro";
  if (["tipo_operacao_id", "fornecedor_id", "data_entrada", "observacao", "transportadora_id", "solicitacao_compra_id", "empresa_id"].includes(path)) return "cabecalho";
  return "divergencias";
}

const MSG_DA_LINHA: Record<MotivoDaRecusaDaLinha | "validade_obrigatoria", string> = {
  rastro_diferente_da_quantidade: "A soma dos lotes do rastro não é a quantidade do item na nota.",
  lote_obrigatorio: "Este produto controla lote e a nota não traz o rastro: informe o lote.",
  lote_com_rastro: "A nota traz o rastro (lotes) deste item: o lote e a validade vêm da nota.",
  quantidade_invalida: "A conversão pelo fator deixa a quantidade zerada: confira o fator.",
  validade_obrigatoria: "Este produto controla lote e validade: informe a validade."
};

/** A conta de um item pela decisão (as funções do domínio, como o servidor) — `null` em `produto` = ainda não conhecido. */
export function contaDoItem(item: ItemDaNota, d: DecisaoDoItemNaTela, produto: ProdutoNaTela | null | undefined): ContaDoItem {
  if (!d.produtoId) return { situacao: "sem_produto" };
  if (!produto) return { situacao: "carregando" };
  if (!fatorValido(d.fator)) return { situacao: "fator_invalido" };
  const semEntrada = !d.geraEstoque || !produto.controlaEstoque;
  const controle: ControleDeLoteDoProduto = semEntrada && item.rastro.length === 0 ? "nenhum" : produto.controleLote;
  let q: string; let u: string;
  try {
    q = quantidadeInterna(item.quantidade, d.fator, d.tipoFator);
    if (!D(q).gt(0)) return { situacao: "recusa", motivo: "quantidade_invalida" };
    u = unitarioInterno(item.valorProdutos, q);
  } catch {
    return { situacao: "recusa", motivo: "quantidade_invalida" };
  }
  const r = linhasDoItemDaNota(item, { produtoId: produto.id, fator: d.fator, tipoFator: d.tipoFator, controlaLote: controle,
    lote: controle === "nenhum" ? null : d.lote.trim() || null, validade: controle === "nenhum" ? null : d.validade || null });
  if (!r.ok) return { situacao: "recusa", motivo: r.motivo };
  if (controle === "lote_validade" && item.rastro.length === 0 && !d.validade) return { situacao: "recusa", motivo: "validade_obrigatoria" };
  // O unitário MOSTRADO é o que a compra terá: o da linha quando o item é uma linha só (o domínio arredonda para cima e
  // fecha o vProd no desconto — `valoresDaLinhaDaNota`); com lotes, cada linha tem o seu e a tela mostra o do item.
  return { situacao: "pronta", quantidadeInterna: q, unitarioInterno: r.linhas.length === 1 ? r.linhas[0]!.valorUnitario : u, linhas: r.linhas };
}

/* ═════════════════════════════════════ as decisões iniciais ═════════════════════════════════════ */

const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

const produtoDoVinculo = (p: ProdutoDoVinculo): ProdutoNaTela => ({ id: p.id, codigo: p.codigo, descricao: p.descricao, controleLote: p.controleLote, controlaEstoque: p.controlaEstoque });

/** A decisão de um item pelo vínculo do servidor (lembrado/sugerido traz produto e fator; o resto, vazio e fator 1). */
function decisaoDoVinculo(conf: ConferenciaDaImportacaoNfe, nItem: number, base?: DecisaoDoItemNaTela): DecisaoDoItemNaTela {
  const i = conf.itens.find((x) => x.nItem === nItem);
  const v = i?.vinculo;
  const comVinculo = v && (v.situacao === "lembrado" || v.situacao === "sugerido") ? v : null;
  return {
    nItem,
    produtoId: comVinculo ? comVinculo.produto.id : "",
    produtoManual: false,
    fator: comVinculo ? D(comVinculo.fator).toFixed() : "1",
    tipoFator: comVinculo ? comVinculo.tipoFator : "multiply",
    armazemId: base?.armazemId ?? "",
    geraEstoque: base?.geraEstoque ?? true,
    imobilizado: base?.imobilizado ?? false,
    lembrar: base?.lembrar ?? true,
    lote: base?.lote ?? "",
    validade: base?.validade ?? "",
    itemOrigemId: base?.itemOrigemId ?? "",
    categoriaId: base?.categoriaId ?? "",
    centroId: base?.centroId ?? ""
  };
}

/** O pedido pré-escolhido: o único pedido que os itens da nota apontam (xPed/nItemPed), quando é um dos candidatos. */
function pedidoReferenciado(conf: ConferenciaDaImportacaoNfe): string {
  const apontados = new Set(conf.itens.map((i) => i.itemDoPedido?.pedidoId).filter((x): x is string => Boolean(x)));
  if (apontados.size !== 1) return "";
  const [id] = [...apontados];
  return conf.pedidos.candidatos.some((p) => p.id === id) ? id! : "";
}

/** O item do pedido de cada item da nota: o que a nota aponta (nItemPed), senão o ÚNICO item do pedido com o mesmo produto. */
function itemDoPedidoPara(conf: ConferenciaDaImportacaoNfe, pedidoId: string, nItem: number, produtoId: string): string {
  if (!pedidoId) return "";
  const apontado = conf.itens.find((x) => x.nItem === nItem)?.itemDoPedido;
  if (apontado && apontado.pedidoId === pedidoId) return apontado.itemId;
  const pedido = conf.pedidos.candidatos.find((p) => p.id === pedidoId);
  const mesmos = (pedido?.itens ?? []).filter((x) => produtoId && x.produtoId === produtoId);
  return mesmos.length === 1 ? mesmos[0]!.id : "";
}

/* ═════════════════════════════════════ o hook ═════════════════════════════════════ */

export interface OpcoesDoEstado {
  /** A TOP padrão da espécie compra (quando o servidor declara uma). */
  topPadrao: string | null;
  /** A pessoa pode receber pedido (`pedidos_compra.edit`): sem isso, nenhum pedido é pré-escolhido. */
  podeReceberPedido: boolean;
  solicitacaoId: string | null;
}

export function useEstadoDaConferencia(conf: ConferenciaDaImportacaoNfe, o: OpcoesDoEstado) {
  const itensDaNota = conf.nota.itens;
  // O pedido pré-escolhido e o item do pedido de cada item da nota nascem JUNTOS (um cálculo só, na montagem).
  const [inicio] = React.useState(() => {
    const pedidoId = o.podeReceberPedido ? pedidoReferenciado(conf) : "";
    const decisoes = itensDaNota.map((i) => { const d = decisaoDoVinculo(conf, i.nItem); return { ...d, itemOrigemId: itemDoPedidoPara(conf, pedidoId, i.nItem, d.produtoId) }; });
    return { pedidoId, decisoes };
  });
  const [itens, setItens] = React.useState<DecisaoDoItemNaTela[]>(inicio.decisoes);
  const [cab, setCab] = React.useState<CabecalhoNaTela>(() => ({ topId: o.topPadrao ?? "", dataEntrada: hoje(), observacao: "", transportadoraId: "", pedidoId: inicio.pedidoId }));
  const [fin, setFin] = React.useState<FinanceiroNaTela>(() => ({
    parcelas: conf.financeiro.parcelas.situacao === "conferem" ? "nota" : "condicao", condicaoId: "", vencimento: "", formaId: "", tipoTituloId: "",
    classificacao: "", rateioTipo: "documento", categoriaId: "", centroId: "", linhas: [{ categoriaId: "", centroId: "", contaId: "", safraId: "", percentual: "100" }]
  }));
  const [recusas, setRecusas] = React.useState<RecusaNoCampo[]>([]);
  const [conhecidos, setConhecidos] = React.useState<Record<string, ProdutoNaTela>>({});

  // A TOP padrão chega depois da conferência (outra pergunta): entra só se a pessoa ainda não escolheu.
  React.useEffect(() => { if (o.topPadrao) setCab((c) => (c.topId ? c : { ...c, topId: o.topPadrao! })); }, [o.topPadrao]);

  // O FORNECEDOR MUDOU (escolhido entre os candidatos, ou cadastrado): o servidor manda os vínculos e os pedidos DELE.
  // O item cuja pessoa escolheu o produto fica como está; os outros seguem o vínculo novo. O pedido é refeito.
  const fornecedorAnterior = React.useRef(conf.fornecedorEscolhido);
  React.useEffect(() => {
    if (fornecedorAnterior.current === conf.fornecedorEscolhido) return;
    fornecedorAnterior.current = conf.fornecedorEscolhido;
    const pedidoId = o.podeReceberPedido ? pedidoReferenciado(conf) : "";
    setCab((c) => ({ ...c, pedidoId }));
    setItens((atuais) => atuais.map((d) => {
      const nova = d.produtoManual ? d : decisaoDoVinculo(conf, d.nItem, d);
      return { ...nova, itemOrigemId: itemDoPedidoPara(conf, pedidoId, d.nItem, nova.produtoId) };
    }));
  }, [conf, o.podeReceberPedido]);

  /* ── os produtos que a tela conhece: os do vínculo, os cadastrados agora, e os escolhidos lidos do cadastro ── */
  const doVinculo = React.useMemo(() => {
    const m: Record<string, ProdutoNaTela> = {};
    for (const i of conf.itens) {
      const v = i.vinculo;
      if (v.situacao === "lembrado" || v.situacao === "sugerido") m[v.produto.id] = produtoDoVinculo(v.produto);
      if (v.situacao === "ambiguo") for (const c of v.candidatos) m[c.id] = produtoDoVinculo(c);
    }
    return m;
  }, [conf]);
  const aLer = [...new Set(itens.map((d) => d.produtoId).filter((id) => id && !doVinculo[id] && !conhecidos[id]))];
  const lidos = useQueries({
    queries: aLer.map((id) => ({
      queryKey: ["compras-importacao-produto", id],
      queryFn: () => api<Record<string, unknown>>(`/api/resources/products/${encodeURIComponent(id)}`),
      staleTime: 60_000,
      retry: false
    }))
  });
  const produtos: Record<string, ProdutoNaTela> = { ...doVinculo, ...conhecidos };
  aLer.forEach((id, k) => {
    const r = lidos[k]?.data;
    if (!r) return;
    const controle = r["controle_lote"];
    produtos[id] = {
      id, codigo: String(r["code"] ?? ""), descricao: String(r["description"] ?? ""), controlaEstoque: r["control_stock"] !== false,
      controleLote: controle === "lote" || controle === "lote_validade" ? controle : "nenhum"
    };
  });
  const erroDeProduto = aLer.some((_, k) => Boolean(lidos[k]?.error as ApiError | null));

  /** Um produto criado agora pelo cadastro rápido (a linha que o servidor devolveu). */
  const conhecerProduto = React.useCallback((row: Record<string, unknown>) => {
    const id = String(row["id"] ?? ""); if (!id) return;
    const controle = row["controle_lote"];
    setConhecidos((c) => ({ ...c, [id]: { id, codigo: String(row["code"] ?? ""), descricao: String(row["description"] ?? ""), controlaEstoque: row["control_stock"] !== false,
      controleLote: controle === "lote" || controle === "lote_validade" ? controle : "nenhum" } }));
  }, []);

  /* ── mudanças ── */
  const mudarCab = (p: Partial<CabecalhoNaTela>) => setCab((c) => ({ ...c, ...p }));
  const mudarFin = (p: Partial<FinanceiroNaTela>) => setFin((f) => ({ ...f, ...p }));
  const mudarItem = (nItem: number, p: Partial<DecisaoDoItemNaTela>) => setItens((atuais) => atuais.map((d) => {
    if (d.nItem !== nItem) return d;
    const nova = { ...d, ...p };
    if (p.geraEstoque === false) nova.armazemId = "";
    if (p.produtoId !== undefined && p.produtoId !== d.produtoId) nova.itemOrigemId = itemDoPedidoPara(conf, cab.pedidoId, nItem, nova.produtoId);
    return nova;
  }));
  const mudarPedido = (pedidoId: string) => {
    setCab((c) => ({ ...c, pedidoId }));
    setItens((atuais) => atuais.map((d) => ({ ...d, itemOrigemId: itemDoPedidoPara(conf, pedidoId, d.nItem, d.produtoId) })));
    // Sem condição escolhida, a do pedido é a padrão do servidor; a tela não a copia (o servidor decide).
  };
  const mudarLinhaDoRateio = (k: number, p: Partial<LinhaDoRateioNaTela>) => setFin((f) => ({ ...f, linhas: f.linhas.map((l, i) => (i === k ? { ...l, ...p } : l)) }));
  const adicionarLinhaDoRateio = () => setFin((f) => (f.linhas.length >= 50 ? f : { ...f, linhas: [...f.linhas, { categoriaId: "", centroId: "", contaId: "", safraId: "", percentual: "" }] }));
  const removerLinhaDoRateio = (k: number) => setFin((f) => (f.linhas.length <= 1 ? f : { ...f, linhas: f.linhas.filter((_, i) => i !== k) }));

  /* ── as contas ── */
  const contas = new Map<number, ContaDoItem>();
  for (const item of itensDaNota) {
    const d = itens.find((x) => x.nItem === item.nItem)!;
    contas.set(item.nItem, contaDoItem(item, d, d.produtoId ? produtos[d.produtoId] : null));
  }
  const todasProntas = [...contas.values()].every((c) => c.situacao === "pronta");
  const totais = conf.nota.totais;
  const cabecalhoDaNota = { frete: money(totais.frete), outras: money(totais.outras), desconto: "0.00", ipi: money(totais.ipi), icmsSt: money(totais.icmsSt), seguro: money(totais.seguro) };
  let total: { valorItens: string; total: string; confere: boolean; diferenca: string } | null = null;
  if (todasProntas) {
    const linhas = [...contas.values()].flatMap((c) => (c.situacao === "pronta" ? c.linhas : []));
    try {
      const t = totaisDaCompra(linhas.map((l) => ({ quantidade: l.quantidade, valorUnitario: l.valorUnitario, desconto: l.desconto })), cabecalhoDaNota);
      const c = conferirTotalDaNota(t.total, totais.nota);
      total = { valorItens: t.valorItens, total: t.total, confere: c.confere, diferenca: c.diferenca };
    } catch { total = null; }
  }
  const parcelas: ParcelasDaNota = total?.confere ? parcelasDaNota(conf.nota, total.total) : conf.financeiro.parcelas;

  /* ── divergências e pendências ── */
  const divergencias: DivergenciaNaTela[] = [];
  for (const dv of conf.divergencias) {
    if (RESOLVIDAS_NA_TELA.has(dv.codigo)) continue;
    const aba: AbaDaConferencia = dv.codigo.startsWith("parceiro_") ? "cabecalho" : dv.codigo === "parcelas_nao_conferem" ? "financeiro"
      : dv.codigo === "preco_diferente_do_pedido" ? "pedido" : "divergencias";
    divergencias.push({ ...dv, aba, origem: "servidor" });
  }
  const pendente = conf.situacao === "pendente";
  if (pendente) {
    if (!cab.topId) divergencias.push({ codigo: "top", mensagem: "Escolha a TOP de compra.", nItem: null, bloqueia: true, aba: "cabecalho", origem: "tela" });
    for (const item of itensDaNota) {
      const c = contas.get(item.nItem)!;
      const n = item.nItem;
      if (c.situacao === "sem_produto") divergencias.push({ codigo: "item_sem_produto", mensagem: `Item ${n}: associe um produto (ou crie o produto).`, nItem: n, bloqueia: true, aba: "itens", origem: "tela" });
      else if (c.situacao === "carregando") divergencias.push({ codigo: "item_produto_carregando", mensagem: `Item ${n}: lendo o cadastro do produto escolhido.`, nItem: n, bloqueia: true, aba: "itens", origem: "tela" });
      else if (c.situacao === "fator_invalido") divergencias.push({ codigo: "item_fator_invalido", mensagem: `Item ${n}: informe o fator (maior que zero, até 6 casas).`, nItem: n, bloqueia: true, aba: "itens", origem: "tela" });
      else if (c.situacao === "recusa") divergencias.push({ codigo: `item_${c.motivo}`, mensagem: `Item ${n}: ${MSG_DA_LINHA[c.motivo]}`, nItem: n, bloqueia: true, aba: "itens", origem: "tela" });
      const d = itens.find((x) => x.nItem === n)!;
      if (cab.pedidoId && !d.itemOrigemId) divergencias.push({ codigo: "item_sem_item_do_pedido", mensagem: `Item ${n}: ligue o item da nota a um item do pedido.`, nItem: n, bloqueia: true, aba: "pedido", origem: "tela" });
      if (fin.rateioTipo === "por_produto" && (!d.categoriaId || !d.centroId)) divergencias.push({ codigo: "item_sem_natureza", mensagem: `Item ${n}: com o rateio por produto, informe a natureza e o centro do item.`, nItem: n, bloqueia: true, aba: "itens", origem: "tela" });
    }
    if (total && !total.confere) {
      divergencias.push({ codigo: "total_diferente", mensagem: `O total calculado (${total.total}) não bate com o total da nota (${money(totais.nota)}).`, nItem: null, bloqueia: true, aba: "divergencias", origem: "tela" });
    }
    if (fin.parcelas === "nota" && parcelas.situacao !== "conferem") {
      divergencias.push({ codigo: "parcelas_da_nota", mensagem: parcelas.situacao === "sem_duplicatas" ? "A nota não traz duplicatas: use a condição de pagamento." : "As duplicatas da nota não conferem com o total: use a condição de pagamento.", nItem: null, bloqueia: true, aba: "financeiro", origem: "tela" });
    }
    if (fin.rateioTipo === "por_valor") {
      const ruins = fin.linhas.some((l) => !l.categoriaId || !l.centroId || !percentualValido(l.percentual));
      const soma = fin.linhas.reduce((a, l) => (percentualValido(l.percentual) ? a.plus(D(l.percentual)) : a), D(0));
      if (ruins || !soma.eq(100)) divergencias.push({ codigo: "rateio_por_valor", mensagem: `O rateio por valor precisa de natureza, centro e percentual em cada linha, somando 100% (soma: ${soma.toFixed()}%).`, nItem: null, bloqueia: true, aba: "financeiro", origem: "tela" });
    }
  }
  const bloqueios = divergencias.filter((x) => x.bloqueia);

  /* ── o corpo ── */
  const corpo = (): GerarCompraDaNota | null => {
    if (!pendente || bloqueios.length > 0 || !conf.fornecedorEscolhido || !cab.topId) return null;
    const rateio: GerarCompraDaNota["financeiro"]["rateio"] = fin.rateioTipo === "por_valor"
      ? { tipo: "por_valor", linhas: fin.linhas.map((l) => ({ categoria_financeira_id: l.categoriaId, centro_custo_id: l.centroId, conta_contabil_id: l.contaId || null, safra_id: l.safraId || null, percentual: l.percentual })) }
      : fin.rateioTipo === "por_produto" ? { tipo: "por_produto" }
        : { tipo: "documento", categoria_financeira_id: fin.categoriaId || null, centro_custo_id: fin.centroId || null };
    return {
      tipo_operacao_id: cab.topId,
      fornecedor_id: conf.fornecedorEscolhido,
      data_entrada: cab.dataEntrada || null,
      observacao: cab.observacao.trim() || null,
      transportadora_id: cab.transportadoraId || null,
      pedido_id: cab.pedidoId || null,
      solicitacao_compra_id: o.solicitacaoId || null,
      financeiro: {
        parcelas: fin.parcelas,
        ...(fin.parcelas === "condicao" ? { condicao_pagamento_id: fin.condicaoId || null, data_vencimento: fin.vencimento || null } : {}),
        forma_pagamento_id: fin.formaId || null,
        tipo_titulo_id: fin.tipoTituloId || null,
        classificacao_gasto: fin.classificacao || null,
        rateio
      },
      itens: itensDaNota.map((item) => {
        const d = itens.find((x) => x.nItem === item.nItem)!;
        return {
          n_item: item.nItem, produto_id: d.produtoId, fator: d.fator, tipo_fator: d.tipoFator, lembrar_vinculo: d.lembrar,
          armazem_id: d.geraEstoque ? d.armazemId || null : null, gera_estoque: d.geraEstoque, imobilizado: d.imobilizado,
          item_origem_id: cab.pedidoId ? d.itemOrigemId || null : null,
          categoria_financeira_id: fin.rateioTipo === "por_produto" ? d.categoriaId || null : null,
          centro_custo_id: fin.rateioTipo === "por_produto" ? d.centroId || null : null,
          ...(item.rastro.length === 0 && d.lote.trim() ? { lote: d.lote.trim() } : {}),
          ...(item.rastro.length === 0 && d.validade ? { validade: d.validade } : {})
        };
      })
    };
  };

  /* ── as recusas do servidor: por campo e por aba ── */
  /** O `path` de um campo de item (`itens[i].campo`) para o item da nota de número `nItem`. */
  const caminhoDoItem = (nItem: number, campo: string) => `itens[${itensDaNota.findIndex((i) => i.nItem === nItem)}].${campo}`;
  const erroEm = (path: string): string | undefined => recusas.find((r) => r.path === path)?.message;
  const erroDoItem = (nItem: number, campo: string) => erroEm(caminhoDoItem(nItem, campo));
  const recusasPorAba = (aba: AbaDaConferencia) => recusas.filter((r) => abaDoCaminho(r.path) === aba).length;

  return {
    conf, itens, cab, fin, produtos, erroDeProduto, contas, total, parcelas, divergencias, bloqueios, recusas, pendente,
    mudarCab, mudarFin, mudarItem, mudarPedido, mudarLinhaDoRateio, adicionarLinhaDoRateio, removerLinhaDoRateio, conhecerProduto,
    corpo, setRecusas, erroEm, erroDoItem, recusasPorAba
  };
}

export type EstadoDaConferencia = ReturnType<typeof useEstadoDaConferencia>;
