"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueries, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA, ERRO_EXIGENCIA_NAO_ATENDIDA, LAYOUT_DO_SISTEMA, camposObrigatoriosFaltando, catalogoDaFamilia,
  chavePadraoDeCadastro, mensagemCampoObrigatorio, type CampoDoLayout, type EstruturaLayout
} from "@agro/domain";
import { api, ApiError, newIdem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { useTradutor } from "@/lib/i18n";
import { todayISO } from "@/lib/utils";
import { enumLabel } from "@/lib/copy";
import { useDirtyTab } from "@/lib/workspace-tabs";
import type { BuscaDeOpcoes, Option } from "@/components/ui/ref-select";
import { defaultPlan, totalDaLinhaExibido, useDoc, useEmpresaPadrao, type ColunaDoEditorDeItens, type ColunaDoLayoutNoEditor, type ItemRow, type Plan, type Row } from "@/features/docs/shared";
import { entendeLayoutDocumento, podeLancar, type EstadoTop, type TopOperacional } from "@/features/sales/tipo-operacao-select";
import { topSelecionada } from "@/features/sales/lancador-tipo-operacao";
import type { AdaptadorDaCentral, CopiaEmMemoria, DepoisDeSalvar, Pendencia } from "@/features/central/contrato";
import { descartarCopia, espiarCopia } from "@/features/central/duplicar-memoria";
import { consumirSalvo, descartarSalvo, entregarSalvo } from "@/features/central/salvo";
import { useTopsDaEspecie, varianteDeCompra, type VarianteDeCompra } from "../variantes";
import { useRecebimentoDoPedido, type EstadoDoRecebimento } from "../receber-pedido";
import { acompanharDescontoDaOrigem, cabecalhoDoPedido, linhasDoRecebimento, temRecebimentoDeclarado } from "../recebimento-linhas";
import { rotaDoDocumento } from "../documentos-compra-list";
import { comprasGeradasDoPedido, pedidoTemSaldo, useProximosPassosDoPedido, type CompraGerada, type EstadoProximosPassosDoPedido } from "../proximos-passos-pedido";
import {
  SEM_PADROES, camposExigidosPelaRegra, colunasDoEditor, estruturaComExigidos, estruturaDaResposta, layoutQueVale, lerRegras, padroesDaResposta,
  valorDoPadrao, zonasDaCentral, type LayoutQueVale, type PadraoDeCadastro, type PadroesDaResposta, type RegrasDaCompra, type ZonasDaCentral
} from "../layout-da-central";
import { adaptadorDaCentralDeCompras, chaveDaCopiaDeCompra, chaveDepoisDeSalvarDeCompra, corpoDoCancelamento } from "./adaptador";

/**
 * O ESTADO DA CENTRAL DE COMPRAS (VISUAL-UX-04, decisão 276) — a lógica de `central-compras.tsx` e `consulta-compra.tsx`
 * extraída, sem JSX, para as peças da Central montada sobre o motor (`@/features/central`). As peças só DESENHAM: o que
 * vai no corpo do POST, quando o Salvar trava, o que é pendência, o que conta como "alterado" e o que cada ação
 * pode fazer moram aqui, iguais ao que já valia (mesmas portas, mesmas chaves, mesmos `.ts` de `features/compras/`).
 *
 *   useEntradaDaCentral  — criação: lançador × formulário × receber (a TOP da URL é PEDIDO; a trava da sessão).
 *   useEstadoDaCriacao   — o formulário (lançar ou receber): cabeçalho, itens, layout, regras, pendências, salvar.
 *   useEstadoDaConsulta  — o documento salvo: capacidades, confirmar, cancelar (motivo opcional), encerrar saldo.
 */

/* ═════════════════════════════════════ Tipos ═════════════════════════════════════ */

export type Cabecalho = {
  empresa_id: string; fornecedor_id: string; transportadora_id: string; data_documento: string; data_entrada: string;
  data_vencimento: string; numero_nota: string; serie_nota: string; categoria_financeira_id: string; centro_custo_id: string;
  condicao_pagamento_id: string; forma_pagamento_id: string; frete: string; outras_despesas: string; desconto: string; observacao: string;
};
export type ChaveDoCabecalho = keyof Cabecalho;
export type ModoDaCentral = "criacao" | "receber" | "consulta";
export type CopiaDeCompra = CopiaEmMemoria<Partial<Cabecalho>>;

export const cabecalhoVazio = (): Cabecalho => ({
  empresa_id: "", fornecedor_id: "", transportadora_id: "", data_documento: todayISO(), data_entrada: "", data_vencimento: "",
  numero_nota: "", serie_nota: "", categoria_financeira_id: "", centro_custo_id: "", condicao_pagamento_id: "", forma_pagamento_id: "",
  frete: "0", outras_despesas: "0", desconto: "0", observacao: ""
});

const vazio = (v: string) => v.trim() === "";
const opcional = (v: string) => (vazio(v) ? undefined : v.trim());
const ehObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Os erros de campo do servidor por caminho (validação, exigências da TOP, condição não permitida). */
export function errosDoServidor(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError)) return {};
  if (e.code === ERRO_EXIGENCIA_NAO_ATENDIDA && ehObj(e.details) && Array.isArray(e.details.exigencias)) {
    const out: Record<string, string> = {};
    for (const x of e.details.exigencias as unknown[]) if (ehObj(x) && typeof x.caminho === "string" && typeof x.mensagem === "string") out[x.caminho] = x.mensagem;
    return out;
  }
  if (e.code === ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA) return { [ehObj(e.details) && typeof e.details.campo === "string" ? e.details.campo : "condicao_pagamento_id"]: e.message };
  if (!Array.isArray(e.details)) return {};
  const out: Record<string, string> = {};
  for (const d of e.details as unknown[]) if (ehObj(d) && typeof d.path === "string" && typeof d.message === "string") out[d.path] = d.message;
  return out;
}

const ROTULO_DO_CAMPO_DO_ITEM: Record<string, string> = {
  produto_id: "produto", item_origem_id: "item do pedido", armazem_id: "armazém", quantidade: "quantidade", valor_unitario: "valor unitário",
  desconto: "desconto", desconto_percentual: "desconto %", lote: "lote", validade: "validade"
};
/** `itens.0.lote` / `itens[0].lote` → "Item 1 · lote". */
export function descreverCaminhoDeItem(caminho: string): string {
  const m = /^itens(?:\.|\[)(\d+)\]?(?:\.([a-z_]+))?$/.exec(caminho);
  if (!m) return "Itens";
  const n = Number(m[1]) + 1;
  return m[2] ? `Item ${n} · ${ROTULO_DO_CAMPO_DO_ITEM[m[2]] ?? m[2]}` : `Item ${n}`;
}

/** Natureza de DESPESA para compra: analítica, despesa OU receita e despesa (a régua da API). */
export const opcoesDeNaturezaDeDespesa: BuscaDeOpcoes = {
  chave: "compras-natureza-despesa",
  buscar: async (search) => {
    const uma = (nature: string) => api<Option[]>(`/api/resources/financial_categories/options?${new URLSearchParams({ kind: "analytic", nature, ...(search ? { search } : {}) }).toString()}`);
    const [despesa, ambas] = await Promise.all([uma("expense"), uma("both")]);
    return [...despesa, ...ambas].sort((a, b) => String(a.code ?? a.label).localeCompare(String(b.code ?? b.label), "pt-BR", { numeric: true }));
  }
};

/** Regras da operação (`lerRegras`). `pendente`: a pergunta saiu e a resposta não chegou. */
function useRegrasDaCompra(segmento: string, top: string, ativo: boolean): { regras: RegrasDaCompra | null; pendente: boolean; falhou: boolean } {
  const q = useQuery<unknown, ApiError>({
    queryKey: ["compras-regras-da-operacao", segmento, top],
    queryFn: () => api<unknown>(`/api/compras/${segmento}/regras-da-operacao?tipo_operacao_id=${encodeURIComponent(top)}`),
    enabled: ativo && Boolean(top), retry: false
  });
  const regras = React.useMemo(() => (ativo && q.data !== undefined ? lerRegras(q.data) : null), [ativo, q.data]);
  return { regras, pendente: ativo && Boolean(top) && q.isPending, falhou: ativo && Boolean(top) && q.isError };
}

export interface ControleDeLote {
  daLinha: (produtoId: string) => { lote: boolean; validade: boolean };
  pede: (produtoId: string, campo: "lote" | "validade") => boolean;
}
/** Controle de lote de cada produto (cadastro). Desconhecido = aberto (o servidor é quem recusa). */
function useControleDeLote(produtos: string[]): ControleDeLote {
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

const COLUNAS_DE_HOJE_DA_COMPRA: ColunaDoEditorDeItens[] = ["warehouse", "product", "quantity", "unit_value", "discount", "discount_percent", "lot", "expiration"];
const COLUNAS_DE_HOJE_DO_PEDIDO: ColunaDoEditorDeItens[] = ["warehouse", "product", "quantity", "unit_value", "discount", "discount_percent"];

/* ═════════════════════════════ ENTRADA DA CRIAÇÃO ═════════════════════════════ */

/**
 * Lançador × formulário × receber — a mesma decisão de `CentralDeCompras`. `chaveDoFormulario` é a `key` do formulário
 * (trocar a TOP pela URL nunca herda o digitado). Sem `formulario`, a página mostra o lançador.
 */
export interface EntradaDaCentral {
  variante: VarianteDeCompra;
  adaptador: AdaptadorDaCentral;
  estado: EstadoTop;
  podeCriar: boolean;
  pedidaNaUrl: string;
  formulario: null | { chave: string; props: PropsDoEstadoDaCriacao };
  /** Para o lançador: a TOP pedida que a lista não confirma. */
  rotuloDaEspecie: string;
  voltarALista: () => void;
  escolherTop: (t: TopOperacional) => void;
}

export function useEntradaDaCentral(variante: VarianteDeCompra): EntradaDaCentral {
  const router = useRouter(); const sp = useSearchParams(); const tr = useTradutor(); const { can } = useAuth();
  const rotulo = tr(variante.chaveI18n);
  const adaptador = React.useMemo(() => adaptadorDaCentralDeCompras(variante, rotulo), [variante, rotulo]);
  const pedidaNaUrl = sp.get("tipo_operacao_id") ?? "";
  const pedidoId = variante.variante === "compra" ? sp.get("pedido") ?? "" : "";
  const podeCriar = can(`${variante.perm}.create`);
  const estado = useTopsDaEspecie(variante.segmento, podeCriar);
  const topAtual = pedidoId ? null : topSelecionada(estado, pedidaNaUrl);
  const chave = !pedidoId && pedidaNaUrl ? `${variante.segmento}:${pedidaNaUrl}` : null;
  const trava = React.useRef<{ chave: string; top: TopOperacional } | null>(null);
  React.useLayoutEffect(() => {
    if (!chave) { trava.current = null; return; }
    if (topAtual) trava.current = { chave, top: topAtual };
  });
  const base = { variante, adaptador, estado, podeCriar, pedidaNaUrl, rotuloDaEspecie: rotulo,
    voltarALista: () => router.push(adaptador.rotas.lista),
    escolherTop: (t: TopOperacional) => router.replace(`/compras/${variante.segmento}/new?tipo_operacao_id=${encodeURIComponent(t.id)}`) };
  if (pedidoId) {
    return { ...base, formulario: { chave: `receber:${pedidoId}:${pedidaNaUrl}`, props: { variante, adaptador, estado, podeCriar, pedidoId, topDaUrl: pedidaNaUrl, top: null, escritaTopConfirmada: false } } };
  }
  const topDaSessao = chave && trava.current?.chave === chave ? trava.current.top : null;
  const topEfetiva = topAtual ?? topDaSessao;
  if (topEfetiva) {
    return { ...base, formulario: { chave: `lancar:${topEfetiva.id}`, props: { variante, adaptador, estado, podeCriar, pedidoId: "", topDaUrl: pedidaNaUrl, top: topEfetiva, escritaTopConfirmada: podeLancar(estado) && topAtual !== null } } };
  }
  return { ...base, formulario: null };
}

/* ═════════════════════════════ ESTADO DA CRIAÇÃO ═════════════════════════════ */

export interface PropsDoEstadoDaCriacao {
  variante: VarianteDeCompra;
  adaptador: AdaptadorDaCentral;
  estado: EstadoTop;
  podeCriar: boolean;
  /** Vazio = lançamento comum. */
  pedidoId: string;
  topDaUrl: string;
  top: TopOperacional | null;
  escritaTopConfirmada: boolean;
}

/** Por que o Salvar está DESABILITADO por estado (não por pendência). null: habilitado. */
export type TravaDoSalvar = null | "top-nao-confirmada" | "pedido-carregando" | "pedido-recusado" | "layout-carregando" | "layout-falhou"
  | "regras-carregando" | "regras-falharam" | "capacidade-carregando" | "salvando";

export interface EstadoDaCriacao {
  modo: "criacao" | "receber";
  variante: VarianteDeCompra;
  adaptador: AdaptadorDaCentral;
  ehCompra: boolean;
  familia: string;
  /** Estado ATUAL da descoberta de TOPs da espécie. */
  estadoTop: EstadoTop;
  escritaTopConfirmada: boolean;
  /** A TOP travada (id) e o rótulo que a tela mostra ("código — nome") e o movimento. */
  top: { id: string; codigo: string; nome: string; movimento: string } | null;
  titulo: string;

  /* receber */
  pedidoId: string;
  recebimento: EstadoDoRecebimento;
  recebendo: Extract<EstadoDoRecebimento, { situacao: "pronto" }> | null;
  emPartes: boolean;
  rotuloDoPedido: string;
  codigoDoPedido: string;
  rotaDoPedido: string;
  mostrarFormulario: boolean;

  /* documento */
  cabecalho: Cabecalho;
  mudar: (p: Partial<Cabecalho>) => void;
  itens: ItemRow[];
  setItens: (novos: ItemRow[]) => void;
  ajustarParcelas: boolean;
  setAjustarParcelas: (v: boolean) => void;
  plano: Plan;
  setPlano: (p: Plan) => void;
  totalItens: number;
  totalExibido: number;
  lote: ControleDeLote;

  /* layout e regras */
  layoutAtivo: boolean;
  layout: EstruturaLayout | null;
  layoutQ: UseQueryResult<unknown, ApiError>;
  layoutPendente: boolean;
  /** O layout falhou (erro ou resposta sem estrutura): "layout não carregado". */
  layoutNaoCarregado: boolean;
  layoutVale: LayoutQueVale | null;
  padroes: PadroesDaResposta;
  regras: RegrasDaCompra | null;
  regrasPendente: boolean;
  exigidosPelaRegra: ReadonlySet<string>;
  condicoesPermitidas: readonly string[] | null;
  zonas: ZonasDaCentral;
  forcados: ReadonlySet<string>;
  /** Configuração do campo no layout (só com layout). */
  cfg: ReadonlyMap<string, CampoDoLayout>;
  rotulo: (campo: string, hoje: string) => string;
  obrigatorio: (campo: string) => boolean;
  travado: (campo: string) => boolean;
  padraoDoCampo: (campo: string) => PadraoDeCadastro | null;
  padraoInvalido: (campo: string) => boolean;
  /** Rótulo do padrão de cadastro enquanto o valor for o do padrão (dica ao RefSelect). */
  dica: (campo: ChaveDoCabecalho) => string | undefined;
  /** O campo veio do pedido com valor (no receber). */
  doPedido: (campo: string) => boolean;
  armazemPadrao: string | null;
  colunasDoLayout: ColunaDoLayoutNoEditor[] | undefined;
  fieldsDosItens: ColunaDoEditorDeItens[];

  /* erros e pendências */
  erro: (campo: string) => string | undefined;
  errosDaTela: Readonly<Record<string, string>>;
  errosDeItens: [string, string][];
  pendencias: Pendencia[];
  pendenciasAbertas: boolean;
  setPendenciasAbertas: (v: boolean) => void;

  /* salvar */
  travaDoSalvar: TravaDoSalvar;
  /** Desabilitado POR ESTADO (pendência não desabilita: o clique abre a pílula, zero POST). */
  salvarDesabilitado: boolean;
  salvando: boolean;
  /** Salva; com `confirmar` (só compra) entrega à consulta o pedido de abrir o diálogo de Confirmar. */
  salvar: (opcoes?: { confirmar?: boolean }) => void;
  podeConfirmarNaCriacao: boolean;
  corpo: () => Record<string, unknown>;

  /* alterado, descartar, alterar operação */
  alterado: boolean;
  descartar: () => void;
  alterarOperacao: () => void;
  voltarAoLancador: () => void;
  confirmarTroca: boolean;
  setConfirmarTroca: (v: boolean) => void;
  voltar: () => void;
  /** A cópia (Duplicar) que abriu este formulário. */
  copiaAplicada: boolean;
}

export function useEstadoDaCriacao({ variante, adaptador, estado, podeCriar, pedidoId, topDaUrl, top: topDoLancamento, escritaTopConfirmada }: PropsDoEstadoDaCriacao): EstadoDaCriacao {
  const router = useRouter(); const tr = useTradutor(); const qc = useQueryClient();
  const ehCompra = variante.variante === "compra";
  const familia = variante.familia;
  const empresaPadrao = useEmpresaPadrao();
  const recebimento = useRecebimentoDoPedido(pedidoId, topDaUrl, variante.variante);
  const modoReceber = recebimento.situacao !== "inativo";
  const recebendo = recebimento.situacao === "pronto" ? recebimento : null;
  const [topDoPasso, setTopDoPasso] = React.useState("");
  const top = modoReceber ? topDoPasso : topDoLancamento?.id ?? "";
  const [movimento] = React.useState(() => (estado.situacao === "pronto" ? estado.dados.family.label : ""));

  /* A CÓPIA (Duplicar) — lida UMA vez, da memória; só vale para esta espécie e esta TOP. */
  const [copia] = React.useState<CopiaDeCompra | null>(() =>
    (!modoReceber && topDoLancamento ? espiarCopia<Partial<Cabecalho>>(chaveDaCopiaDeCompra, variante.segmento, topDoLancamento.id) : null));
  React.useEffect(() => { if (copia) descartarCopia(chaveDaCopiaDeCompra, variante.segmento); }, [copia, variante.segmento]);

  const [h, setH] = React.useState<Cabecalho>(() => ({ ...cabecalhoVazio(), ...(copia?.cabecalho ?? {}), data_documento: todayISO() }));
  /** O estado INICIAL ("intocado"): a abertura (sem a cópia: a cópia é alteração), o pedido e os padrões aplicados. */
  const inicial = React.useRef<Cabecalho>(cabecalhoVazio());
  const abertura = React.useRef<{ h: Cabecalho; itens: ItemRow[] } | null>(null);
  React.useEffect(() => { setH((o) => ({ ...o, empresa_id: o.empresa_id || empresaPadrao })); }, [empresaPadrao]);
  const mudar = React.useCallback((p: Partial<Cabecalho>) => setH((o) => ({ ...o, ...p })), []);
  const [itens, setItensCru] = React.useState<ItemRow[]>(() => copia?.itens ?? []);
  const setItens = (novos: ItemRow[]) => setItensCru((antes) => (modoReceber ? acompanharDescontoDaOrigem(antes, novos) : novos));
  const [ajustarParcelas, setAjustarParcelas] = React.useState(false);
  const [plano, setPlano] = React.useState<Plan>(defaultPlan());
  const [erros, setErros] = React.useState<Record<string, string>>({});
  const [confirmarTroca, setConfirmarTroca] = React.useState(false);
  const [pendenciasAbertas, setPendenciasAbertas] = React.useState(false);

  /* O PEDIDO PREENCHE A CENTRAL UMA VEZ (pedido + passo). */
  const preenchidoDe = React.useRef("");
  const doPedido = React.useRef<ReadonlySet<string>>(new Set());
  const [preenchimento, setPreenchimento] = React.useState("");
  React.useEffect(() => {
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
  /** O corpo do POST — as MESMAS chaves de hoje (lançar e `/convert`). */
  const corpo = (): Record<string, unknown> => (modoReceber
    ? { ...cabecalhoDoCorpo(), itens: itens.map((i) => ({ item_origem_id: String(i["item_origem_id"] ?? ""), ...camposDoItem(i) })) }
    : { empresa_id: h.empresa_id, fornecedor_id: h.fornecedor_id, ...cabecalhoDoCorpo(), itens: itens.map((i) => ({ produto_id: i.product_id, ...camposDoItem(i) })) });
  const documentoConferido = (): Record<string, unknown> => (recebendo
    ? { ...cabecalhoDoCorpo(), empresa_id: String(recebendo.pedido["empresa_id"] ?? ""), fornecedor_id: String(recebendo.pedido["fornecedor_id"] ?? ""),
      itens: itens.map((i) => ({ produto_id: i.product_id, ...camposDoItem(i) })) }
    : corpo());

  const segmentoDoPedido = varianteDeCompra("pedido")?.segmento ?? "";
  const porta = modoReceber ? `/api/compras/${segmentoDoPedido}/${pedidoId}/convert` : `/api/compras/${variante.segmento}`;

  const chave = React.useRef(newIdem());
  const depoisDeSalvar = React.useRef<DepoisDeSalvar>({ confirmar: false });
  const salvarM = useMutation({
    mutationFn: () => api<{ id: string }>(porta, { method: "POST", body: corpo(), idempotencyKey: chave.current }),
    onSuccess: (r) => {
      toast.success("Salvo com sucesso");
      void qc.invalidateQueries();
      // O "Salvo ✓" (e o pedido de abrir o Confirmar) vão à consulta pela memória, nunca pela URL.
      entregarSalvo(chaveDepoisDeSalvarDeCompra, r.id, depoisDeSalvar.current);
      router.push(adaptador.rotas.registro(r.id));
    },
    onError: (e) => { chave.current = newIdem(); setErros(errosDoServidor(e)); toast.error((e as Error).message); }
  });

  const { regras, pendente: regrasPendente, falhou: regrasFalharam } = useRegrasDaCompra(variante.segmento, top, modoReceber ? Boolean(recebendo) && !!top : podeLancar(estado) && !!top);
  const exigidosPelaRegra = React.useMemo<ReadonlySet<string>>(() => new Set(camposExigidosPelaRegra(regras, ehCompra)), [regras, ehCompra]);
  const lote = useControleDeLote(ehCompra ? itens.map((i) => i.product_id) : []);
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

  /* ── LAYOUT (COMPRAS-03): só com a capacidade; sem ela, LAYOUT_DO_SISTEMA. ── */
  const layoutAtivo = entendeLayoutDocumento(estado);
  const layoutQ = useQuery<unknown, ApiError>({
    queryKey: ["layout-efetivo", "compras", variante.segmento, top],
    queryFn: () => api<unknown>(`/api/compras/${variante.segmento}/layout-efetivo?tipo_operacao_id=${encodeURIComponent(top)}`),
    enabled: layoutAtivo && Boolean(top),
    retry: false
  });
  const layoutRecebido = layoutQ.data;
  const layout = React.useMemo(() => (layoutAtivo ? estruturaDaResposta(layoutRecebido) : null), [layoutAtivo, layoutRecebido]);
  const layoutPendente = layoutAtivo && !layout;
  const layoutNaoCarregado = layoutPendente && (layoutQ.isError || (layoutQ.isSuccess && !layout));
  const capacidadePendente = modoReceber && podeCriar && estado.situacao === "carregando";
  const layoutVale = React.useMemo(() => (layout ? layoutQueVale(layoutRecebido) : null), [layout, layoutRecebido]);
  const padroes = React.useMemo(() => (layout ? padroesDaResposta(layoutRecebido) : SEM_PADROES), [layout, layoutRecebido]);
  const cfg = React.useMemo(() => new Map<string, CampoDoLayout>(layout ? [...layout.cabecalho, ...layout.rodape.flatMap((a) => a.campos)].map((x) => [x.campo, x]) : []), [layout]);
  const catalogo = React.useMemo(() => catalogoDaFamilia(familia), [familia]);
  const doSistema = React.useMemo(() => new Set(catalogo.filter((c) => c.parte !== "itens" && c.sistema).map((c) => c.chave)), [catalogo]);
  const camposDeCadastro = React.useMemo(() => new Set(catalogo.filter((c) => c.parte !== "itens" && c.referencia).map((c) => c.chave)), [catalogo]);
  const doLayoutComCadastro = (c: string) => Boolean(layout) && camposDeCadastro.has(c) && cfg.has(c);
  const condicoesPermitidas = regras?.condicoesPermitidas ?? null;
  const condicaoNaoPermitida = (id: string) => condicoesPermitidas !== null && id !== "" && !condicoesPermitidas.some((x) => x.toLowerCase() === id.toLowerCase());
  const padraoNaoPermitido = (c: string) => c === "condicao_pagamento_id" && condicaoNaoPermitida(padroes.validos.get(c)?.id ?? "");
  const padraoDoCampo = (c: string) => (doLayoutComCadastro(c) && !padraoNaoPermitido(c) ? padroes.validos.get(c) ?? null : null);
  const padraoInvalido = (c: string) => doLayoutComCadastro(c) && (padroes.invalidos.has(c) || padraoNaoPermitido(c));

  const padraoArmazem = layout && layout.itens.some((c) => c.campo === "armazem_id") ? padroes.validos.get(chavePadraoDeCadastro("itens", "armazem_id")) : undefined;
  const armazemPadrao = padraoArmazem && padraoArmazem.empresaId && padraoArmazem.empresaId === h.empresa_id ? padraoArmazem.id : null;

  /* PADRÕES DO LAYOUT: uma vez por resposta, só em campo intocado, nunca no que o pedido trouxe. */
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
      setH((o) => {
        const r = { ...o };
        for (const k of chaves) if (o[k] === antes[k] || (k === "empresa_id" && o[k] === empresaPadrao)) r[k] = novos[k]!;
        return r;
      });
    }
    if (modoReceber && armazemPadrao) setItensCru((ls) => ls.map((l) => (l.warehouse_id ? l : { ...l, warehouse_id: armazemPadrao })));
  }, [layout, layoutRecebido, regrasPendente, modoReceber, preenchimento, empresaPadrao, padroes, padraoDoCampo, armazemPadrao]);

  const colunasForcadas = [
    ...(regras?.exigeArmazem ? ["armazem_id"] : []),
    ...(ehCompra ? (["lote", "validade"] as const).filter((c) => itens.some((it) => lote.pede(it.product_id, c))) : [])
  ];
  const colunasDoLayout = layout ? colunasDoEditor(familia, layout.itens, { forcadas: colunasForcadas, obrigatoriasPelaRegra: new Set(regras?.exigeArmazem ? ["armazem_id"] : []) }) : undefined;
  const fieldsDosItens: ColunaDoEditorDeItens[] = colunasDoLayout ? colunasDoLayout.map((c) => c.coluna) : ehCompra ? COLUNAS_DE_HOJE_DA_COMPRA : COLUNAS_DE_HOJE_DO_PEDIDO;

  /* OBRIGATÓRIOS: a MESMA função do domínio que a API usa. */
  const [tentouSalvar, setTentouSalvar] = React.useState(false);
  const faltando = () => (layout ? camposObrigatoriosFaltando(familia, layout, documentoConferido(), { classificacao: true, condicao: true }) : []);
  const listaFaltando = faltando();
  const errosLocais: Record<string, string> = layout && tentouSalvar ? Object.fromEntries(listaFaltando.map((f) => [f.caminho, mensagemCampoObrigatorio(f.rotulo)])) : {};
  const errosDaTela: Record<string, string> = { ...erros, ...errosLocais };
  const erro = (c: string) => errosDaTela[c];
  const errosDeItens = Object.entries(errosDaTela).filter(([c]) => c.startsWith("itens"));

  /** PENDÊNCIAS: sem itens + o que o layout cobra (a pílula vermelha "N pendências"). */
  const pendencias: Pendencia[] = [
    ...(itens.length ? [] : [{ caminho: "itens", rotulo: "Itens", mensagem: "Inclua ao menos um item." }]),
    ...listaFaltando.map((f) => ({ caminho: f.caminho, rotulo: f.caminho.startsWith("itens") ? descreverCaminhoDeItem(f.caminho) : f.rotulo, mensagem: mensagemCampoObrigatorio(f.rotulo) }))
  ];

  const aparecerSempre = [...exigidosPelaRegra, ...Object.keys(errosDaTela), ...(condicaoNaoPermitida(h.condicao_pagamento_id) ? ["condicao_pagamento_id"] : [])];
  const chaveDoAparecer = [...new Set(aparecerSempre)].sort().join("|");
  const desenho = React.useMemo(() => (layout ? estruturaComExigidos(familia, layout, chaveDoAparecer ? chaveDoAparecer.split("|") : []) : null), [layout, familia, chaveDoAparecer]);
  const zonas = React.useMemo(() => zonasDaCentral(familia, desenho?.estrutura ?? LAYOUT_DO_SISTEMA(familia)), [familia, desenho]);

  const travaDoSalvar: TravaDoSalvar =
    salvarM.isPending ? "salvando"
      : modoReceber && recebimento.situacao === "carregando" ? "pedido-carregando"
        : modoReceber && !recebendo ? "pedido-recusado"
          : !modoReceber && !escritaTopConfirmada ? "top-nao-confirmada"
            : !top ? "top-nao-confirmada"
              : capacidadePendente ? "capacidade-carregando"
                : layoutNaoCarregado ? "layout-falhou"
                  : layoutPendente ? "layout-carregando"
                    : regrasPendente ? "regras-carregando"
                      : regrasFalharam ? "regras-falharam"
                        : null;

  const salvar = (opcoes?: { confirmar?: boolean }) => {
    // A defesa no handler: `disabled` é apresentação.
    if (travaDoSalvar) return;
    setErros({});
    setTentouSalvar(true);
    if (pendencias.length) { setPendenciasAbertas(true); return; } // zero POST
    depoisDeSalvar.current = { confirmar: ehCompra && Boolean(opcoes?.confirmar) };
    salvarM.mutate();
  };

  /* ALTERADO: contra o estado inicial, sem a empresa (preenchida por efeito). A cópia conta como alteração. */
  const semEmpresa = ({ empresa_id: _empresa, ...resto }: Cabecalho) => resto;
  const alterado = (itens.length > 0 && (!modoReceber || JSON.stringify(itens) !== JSON.stringify(abertura.current?.itens ?? [])))
    || ajustarParcelas || JSON.stringify(semEmpresa(h)) !== JSON.stringify(semEmpresa(inicial.current));
  useDirtyTab(alterado && !salvarM.isSuccess);
  React.useEffect(() => {
    if (modoReceber && preenchimento && !abertura.current) abertura.current = { h: inicial.current, itens: linhasDoRecebimento(recebendo?.pedido.itens ?? []) };
  }, [modoReceber, preenchimento, recebendo]);

  const voltarAoLancador = () => router.replace(adaptador.rotas.nova);
  const alterarOperacao = () => { if (alterado) setConfirmarTroca(true); else voltarAoLancador(); };
  const rotaDoPedido = rotaDoDocumento({ id: pedidoId, especie: "pedido" });
  /** DESCARTAR: zero escrita. Criação → volta à abertura; receber → volta ao pedido. */
  const descartar = () => {
    if (modoReceber) { router.push(rotaDoPedido); return; }
    setH({ ...inicial.current, empresa_id: inicial.current.empresa_id || empresaPadrao });
    setItensCru([]); setAjustarParcelas(false); setPlano(defaultPlan()); setErros({}); setTentouSalvar(false); setPendenciasAbertas(false);
  };

  const rotuloDoPedido = enumLabel("especie_documento_compra", "pedido");
  const codigoDoPedido = recebendo ? String(recebendo.pedido["codigo"] ?? "") : "";
  const titulo = modoReceber ? `Receber ${rotuloDoPedido.toLowerCase()} ${codigoDoPedido}`.trim() : `Novo documento · ${tr(variante.chaveI18n)}`;

  const travadoDoLayout = (c: string) => Boolean(layout) && cfg.get(c)?.editavel === false && !padraoInvalido(c)
    && !(exigidosPelaRegra.has(c) && !(Boolean(cfg.get(c)?.valorPadrao) || Boolean(padraoDoCampo(c))) && !(modoReceber && doPedido.current.has(c)));

  const topInfo = recebendo
    ? { id: top, codigo: recebendo.passo.codigo, nome: recebendo.passo.nome, movimento: recebendo.passo.familiaRotulo }
    : topDoLancamento ? { id: topDoLancamento.id, codigo: topDoLancamento.code, nome: topDoLancamento.name, movimento } : null;

  return {
    modo: modoReceber ? "receber" : "criacao", variante, adaptador, ehCompra, familia, estadoTop: estado, escritaTopConfirmada, top: topInfo, titulo,
    pedidoId, recebimento, recebendo, emPartes: recebendo?.passo.emPartes === true, rotuloDoPedido, codigoDoPedido, rotaDoPedido,
    mostrarFormulario: !modoReceber || Boolean(recebendo),
    cabecalho: h, mudar, itens, setItens, ajustarParcelas, setAjustarParcelas, plano, setPlano, totalItens, totalExibido, lote,
    layoutAtivo, layout, layoutQ, layoutPendente, layoutNaoCarregado, layoutVale, padroes, regras, regrasPendente, exigidosPelaRegra, condicoesPermitidas,
    zonas, forcados: desenho?.forcados ?? new Set<string>(), cfg,
    rotulo: (c, hoje) => cfg.get(c)?.rotulo || hoje,
    obrigatorio: (c) => (layout ? Boolean(cfg.get(c)?.obrigatorio) : doSistema.has(c)) || exigidosPelaRegra.has(c),
    travado: travadoDoLayout,
    padraoDoCampo, padraoInvalido,
    dica: (c) => { const p = padraoDoCampo(c); return p && h[c] === p.id ? p.rotulo : undefined; },
    doPedido: (c) => modoReceber && doPedido.current.has(c),
    armazemPadrao, colunasDoLayout, fieldsDosItens,
    erro, errosDaTela, errosDeItens, pendencias, pendenciasAbertas, setPendenciasAbertas,
    travaDoSalvar, salvarDesabilitado: travaDoSalvar !== null, salvando: salvarM.isPending, salvar,
    podeConfirmarNaCriacao: ehCompra && !modoReceber,
    corpo,
    alterado, descartar, alterarOperacao, voltarAoLancador, confirmarTroca, setConfirmarTroca,
    voltar: () => router.push(modoReceber ? rotaDoPedido : adaptador.rotas.lista),
    copiaAplicada: copia !== null
  };
}

/* ═════════════════════════════ ESTADO DA CONSULTA ═════════════════════════════ */

export type DocumentoDeCompra = Row & { itens?: Row[]; titulos?: Row[]; movimentos?: Row[] };

export interface EstadoDaConsulta {
  modo: "consulta";
  variante: VarianteDeCompra;
  adaptador: AdaptadorDaCentral;
  id: string;
  porta: string;
  q: UseQueryResult<DocumentoDeCompra>;
  documento: DocumentoDeCompra | undefined;
  situacao: string;
  ehCompra: boolean;
  ehPedido: boolean;
  titulo: string;
  itens: Row[];
  top: { codigo?: string; nome?: string; versao?: number; id?: string } | null;
  tipoOperacaoId: string;

  /* pedido */
  comprasGeradas: CompraGerada[] | null;
  comCompraViva: boolean;
  recebimentoDeclarado: boolean;
  podeReceber: boolean;
  passos: EstadoProximosPassosDoPedido;
  saldoEncerradoEm: string;
  /* compra gerada */
  origemId: string;
  rotaDaOrigem: string;
  rotuloDoPedido: string;

  /* ações (can() só esconde; quem recusa é o servidor) */
  podeConfirmar: boolean;
  podeEncerrarSaldo: boolean;
  /** Mostrar Cancelar (capacidade e situação). */
  podeCancelar: boolean;
  /** Pedido com compra viva: Cancelar aparece DESABILITADO com esta dica. */
  dicaCancelarDesabilitado: string | null;
  podeVerHistorico: boolean;
  /** Duplicar: null = habilitado; texto = dica do desabilitado. */
  dicaDuplicarDesabilitado: string | null;
  podeDuplicar: boolean;

  /* diálogos */
  confirmando: boolean; setConfirmando: (v: boolean) => void;
  cancelando: boolean; setCancelando: (v: boolean) => void;
  encerrando: boolean; setEncerrando: (v: boolean) => void;
  confirmar: () => void; confirmarOcupado: boolean;
  /** Motivo opcional: aparado 1–500; vazio → corpo sem motivo. */
  cancelar: (motivo: string) => void; cancelarOcupado: boolean;
  encerrar: (motivo: string) => void; encerrarOcupado: boolean;
  textoDoCancelamento: string;

  /* "Salvo ✓" entregue pela criação */
  salvoAgora: boolean;
  recarregar: () => void;
}

const DICA_PEDIDO_COM_COMPRA = "O pedido tem compra não cancelada: cancele a compra antes de cancelar o pedido.";
const DICA_DUPLICAR_COM_ORIGEM = "Compra gerada de um pedido não se duplica: receba o pedido de novo pelos Próximos passos.";
const DICA_DUPLICAR_SEM_TOP = "Documento sem Tipo de Operação não se duplica.";

export function useEstadoDaConsulta({ variante, id }: { variante: VarianteDeCompra; id: string }): EstadoDaConsulta {
  const { can } = useAuth(); const tr = useTradutor(); const qc = useQueryClient();
  const rotulo = tr(variante.chaveI18n);
  const adaptador = React.useMemo(() => adaptadorDaCentralDeCompras(variante, rotulo), [variante, rotulo]);
  const porta = adaptador.rotas.porta(id);
  const q = useDoc<DocumentoDeCompra>(porta);

  /* O "Salvo" e o pedido de Confirmar vindos da criação: lidos uma vez, da memória. */
  const [salvo] = React.useState(() => consumirSalvo(chaveDepoisDeSalvarDeCompra, id));
  React.useEffect(() => { if (salvo) descartarSalvo(chaveDepoisDeSalvarDeCompra, id); }, [salvo, id]);
  const [confirmando, setConfirmando] = React.useState(Boolean(salvo?.confirmar) && variante.variante === "compra");
  const [cancelando, setCancelando] = React.useState(false);
  const [encerrando, setEncerrando] = React.useState(false);
  const chaveConfirmar = React.useRef(newIdem());
  const chaveCancelar = React.useRef(newIdem());
  const chaveEncerrar = React.useRef(newIdem());
  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: ["docone", porta] });
    void qc.invalidateQueries({ queryKey: ["compras-previa-confirmacao", id] });
    void qc.invalidateQueries({ queryKey: ["compras-proximos-passos", variante.segmento, id] });
  };

  const confirmarM = useMutation({
    mutationFn: () => api(`/api/compras/compras/${id}/confirm`, { method: "POST", idempotencyKey: chaveConfirmar.current }),
    onSuccess: () => { toast.success("Compra confirmada"); setConfirmando(false); recarregar(); },
    onError: (e) => { chaveConfirmar.current = newIdem(); toast.error((e as Error).message); recarregar(); }
  });
  const cancelarM = useMutation({
    mutationFn: (motivo: string) => api(`/api/compras/${variante.segmento}/${id}/cancel`, { method: "POST", body: corpoDoCancelamento(motivo), idempotencyKey: chaveCancelar.current }),
    onSuccess: () => { toast.success("Documento cancelado"); setCancelando(false); recarregar(); },
    onError: (e) => { chaveCancelar.current = newIdem(); toast.error((e as Error).message); }
  });
  const encerrarM = useMutation({
    mutationFn: (motivo: string) => api(`/api/compras/${variante.segmento}/${id}/encerrar-saldo`, { method: "POST", body: { motivo }, idempotencyKey: chaveEncerrar.current }),
    onSuccess: () => { toast.success("Saldo encerrado"); setEncerrando(false); recarregar(); },
    onError: (e) => { chaveEncerrar.current = newIdem(); toast.error((e as Error).message); }
  });

  const d = q.data;
  const situacao = d ? String(d["situacao"] ?? "") : "";
  const ehCompra = variante.variante === "compra";
  const ehPedido = variante.variante === "pedido";
  const itens = d?.itens ?? [];
  const comprasGeradas = ehPedido ? comprasGeradasDoPedido(d) : null;
  const comCompraViva = (comprasGeradas ?? []).some((c) => c.situacao !== "cancelado");
  const recebimentoDeclarado = ehPedido && temRecebimentoDeclarado(itens);
  const varianteDaCompra = varianteDeCompra("compra");
  const podeReceber = ehPedido && situacao === "aberto" && can(`${variante.perm}.edit`) && Boolean(varianteDaCompra) && can(`${varianteDaCompra?.perm ?? ""}.create`);
  const passos = useProximosPassosDoPedido(variante.segmento, id, podeReceber);
  const podeEncerrarSaldo = ehPedido && situacao === "aberto" && recebimentoDeclarado && comCompraViva && pedidoTemSaldo(itens) && can(`${variante.perm}.edit`);
  const podeConfirmar = ehCompra && situacao === "aberto" && can("compras.edit");
  const podeCancelar = (situacao === "aberto" || situacao === "confirmado") && can(`${variante.perm}.delete`);
  const origemId = ehCompra && d && typeof d["origem_documento_id"] === "string" ? d["origem_documento_id"] : "";
  const saldoEncerradoEm = ehPedido && d && typeof d["saldo_encerrado_em"] === "string" ? d["saldo_encerrado_em"] : "";
  const top = (d?.["tipo_operacao"] as { codigo?: string; nome?: string; versao?: number; id?: string } | null | undefined) ?? null;
  const tipoOperacaoId = d ? String(d["tipo_operacao_id"] ?? top?.id ?? "") : "";
  const dicaDuplicarDesabilitado = origemId ? DICA_DUPLICAR_COM_ORIGEM : d && !tipoOperacaoId ? DICA_DUPLICAR_SEM_TOP : null;

  return {
    modo: "consulta", variante, adaptador, id, porta, q, documento: d, situacao, ehCompra, ehPedido,
    titulo: d ? `${rotulo} ${d["codigo"] ? String(d["codigo"]) : "—"}` : rotulo,
    itens, top, tipoOperacaoId,
    comprasGeradas, comCompraViva, recebimentoDeclarado, podeReceber, passos, saldoEncerradoEm,
    origemId, rotaDaOrigem: origemId ? rotaDoDocumento({ id: origemId, especie: "pedido" }) : "", rotuloDoPedido: enumLabel("especie_documento_compra", "pedido"),
    podeConfirmar, podeEncerrarSaldo, podeCancelar,
    dicaCancelarDesabilitado: ehPedido && comCompraViva ? DICA_PEDIDO_COM_COMPRA : null,
    podeVerHistorico: can("audit_logs.view"),
    dicaDuplicarDesabilitado,
    podeDuplicar: Boolean(d) && dicaDuplicarDesabilitado === null && can(`${variante.perm}.create`),
    confirmando, setConfirmando, cancelando, setCancelando, encerrando, setEncerrando,
    confirmar: () => confirmarM.mutate(), confirmarOcupado: confirmarM.isPending,
    cancelar: (motivo) => cancelarM.mutate(motivo), cancelarOcupado: cancelarM.isPending,
    encerrar: (motivo) => encerrarM.mutate(motivo), encerrarOcupado: encerrarM.isPending,
    textoDoCancelamento: situacao === "confirmado"
      ? "A compra confirmada é estornada: a entrada sai do estoque e as contas a pagar são canceladas. Conta com baixa precisa ter a baixa cancelada antes."
      : "O documento passa a cancelado e não pode mais ser confirmado.",
    salvoAgora: salvo !== null,
    recarregar
  };
}
