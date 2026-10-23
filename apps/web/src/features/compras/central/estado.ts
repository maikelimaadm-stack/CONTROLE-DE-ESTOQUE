"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueries, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA, ERRO_EXIGENCIA_NAO_ATENDIDA, FORMA_UUID_PADRAO, LAYOUT_DO_SISTEMA, MSG_FINALIZAR_SO_PEDIDO_ABERTO, MSG_PEDIDO_JA_TEM_VENCEDOR,
  MSG_PEDIDO_SEM_TOP_DE_ORCAMENTO, camposObrigatoriosFaltando, catalogoDaFamilia, chavePadraoDeCadastro, mensagemCampoObrigatorio,
  type CampoDoLayout, type EstruturaLayout
} from "@agro/domain";
import { D } from "@agro/shared";
import { api, ApiError } from "@/lib/api";
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
import type { AdaptadorDaCentral, CopiaEmMemoria, DepoisDeSalvar, LocalDeEstoque, Pendencia, TravasDaLinha } from "@/features/central/contrato";
import { useLocalDoCabecalho } from "@/features/central/local-padrao";
import { descartarCopia, espiarCopia } from "@/features/central/duplicar-memoria";
import { abreConfirmarNaChegada, confirmarPodeAbrir, consumirSalvo, descartarSalvo, entregarSalvo } from "@/features/central/salvo";
import { avisarSalvo, type RespostaDoSalvar } from "@/features/central/salvar";
import { exigeAoMenosUmItem, rotuloDoSalvar } from "@/features/central/regras-gerais";
import { useTopsDaEspecie, varianteDeCompra, type VarianteDeCompra } from "../variantes";
import { useRecebimentoDoPedido, type EstadoDoRecebimento } from "../receber-pedido";
import { acompanharDescontoDaOrigem, cabecalhoDoPedido, linhasDoRecebimento, temRecebimentoDeclarado } from "../recebimento-linhas";
import { rotaDoDocumento } from "../documentos-compra-list";
import { comprasGeradasDoPedido, pedidoTemSaldo, useProximosPassosDoPedido, type CompraGerada, type EstadoProximosPassosDoPedido } from "../proximos-passos-pedido";
import {
  SITUACOES_DO_PEDIDO_EM_ANDAMENTO, aprovadoParaOrcamento, finalizacaoDoPedido, invalidarLeiturasDeCompras, orcamentosDoPedido, rotaDoNovoOrcamento,
  useChaveDeIdempotencia, useFinalizacaoEOrcamento, useLequeDeOrcamentosDoPedido, type EstadoDaCapacidade, type EstadoDoLequeDeOrcamentos,
  type TopDoLequeDeOrcamento
} from "../pedido-e-orcamento";
import {
  SEM_PADROES, camposExigidosPelaRegra, colunasDoEditor, estruturaComExigidos, estruturaDaResposta, layoutQueVale, lerRegras, padroesDaResposta,
  valorDoPadrao, zonasDaCentral, type LayoutQueVale, type PadraoDeCadastro, type PadroesDaResposta, type RegrasDaCompra, type ZonasDaCentral
} from "../layout-da-central";
import { useImportacaoXml } from "../importacao/capacidade";
import { adaptadorDaCentralDeCompras, chaveDaCopiaDeCompra, chaveDepoisDeSalvarDeCompra, corpoDoCancelamento } from "./adaptador";
import {
  MSG_EDICAO_INDISPONIVEL, chaveDaEdicao, conflitoDaEdicao, edicaoIndisponivel, lerEdicao, portaDaEdicao, portaDoDocumento,
  type EdicaoDoDocumentoDeCompra
} from "./edicao-api";
import {
  aberturaDoDocumento, acaoEditar, campoTravadoNaEdicao, corpoDaEdicao, itensNaEdicao, motivoDaTravaNaEdicao, mudouAlgo, travasDaLinhaNaTela, type AcaoEditar
} from "./edicao";
import { cabeNoDocumento, linhasDoProdutoCruzado } from "./rateio-independente";
import {
  dicaDaTop, localConfirmadoNaEmpresa, localDasLinhasNovasNoPortao, localDoCadastroDoProduto, mesmoId, omissaoDoCorpo, padraoDaTopInvalido,
  padroesDaTopAplicam, planoDaSemeadura, podeTrocarOsPadroes, portaoDoLocalDoProduto, travadoPelaTop, type CampoDoPadraoDaTop,
  type CobrancaNoCorpo, type Semeadura
} from "./padroes-da-top";

/**
 * O ESTADO DA CENTRAL DE COMPRAS (VISUAL-UX-04, decisão 276) — a lógica de `central-compras.tsx` e `consulta-compra.tsx`
 * extraída, sem JSX, para as peças da Central montada sobre o motor (`@/features/central`). As peças só DESENHAM: o que
 * vai no corpo do POST, quando o Salvar trava, o que é pendência, o que conta como "alterado" e o que cada ação
 * pode fazer moram aqui, iguais ao que já valia (mesmas portas, mesmas chaves, mesmos `.ts` de `features/compras/`).
 *
 *   useEntradaDaCentral  — criação: lançador × formulário × receber (a TOP da URL é PEDIDO; a trava da sessão).
 *   useEstadoDaCriacao   — o formulário (lançar ou receber): cabeçalho, itens, layout, regras, pendências, salvar.
 *   useEstadoDaConsulta  — o documento salvo: capacidades, confirmar, cancelar (motivo opcional), encerrar saldo; no
 *                          pedido, com a capacidade da F6 (decisão 283), finalizar, aprovar para orçamento e o novo orçamento.
 *
 * A CHAVE DE IDEMPOTÊNCIA de cada escrita (Salvar, Confirmar, Cancelar, Encerrar saldo, Finalizar, Aprovar para orçamento)
 * só é trocada quando o servidor RESPONDEU com recusa (`trocaAChaveDeIdempotencia`): na queda de rede, no 5xx ou na
 * resposta perdida o reenvio leva a MESMA chave e recebe a resposta gravada — nunca um segundo documento. A chave mora
 * em `useChaveDeIdempotencia`, que também troca o texto técnico do reenvio com outros dados pelo aviso em português.
 *
 * OPERACOES-01 F7 (decisão 284): na criação da COMPRA, com a capacidade `importacaoXml` "sim", os DADOS FISCAIS do
 * cabeçalho (chave de acesso, UF, tipo de documento, IPI, ICMS-ST, seguro, tipo de título, classificação) — estado
 * próprio (`fiscal`), no corpo SÓ quando preenchidos e no total exibido (IPI + ICMS-ST + seguro). Sem a capacidade (a API
 * anterior), o corpo é o de hoje, byte a byte.
 *
 * EDITAR-02 (decisão 313): o MESMO formulário em MODO EDIÇÃO (`edicao` nas props; sem rota nova — a consulta troca no
 * lugar, como o orçamento), aberto pelo `GET /edicao` (o documento gravado, a versão, os limites, as regras da versão
 * CONGELADA e o layout de hoje — `edicao-api.ts`). Nada é semeado (nem o padrão do layout, nem os padrões da TOP da
 * 311); o que a PATCH não aceita fica em leitura; o Salvar manda `PATCH { version, ...só o que mudou }` (`edicao.ts`).
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

/**
 * OPERACOES-01 F7 (decisão 284) — OS DADOS FISCAIS DA COMPRA MANUAL: o que a nota antiga tinha no cabeçalho e a compra
 * passou a ter. Só na CRIAÇÃO da espécie compra e só com a capacidade `importacaoXml` "sim" (a API que os aceita). Estado
 * PRÓPRIO, fora do `Cabecalho`: não entram no layout, nos padrões, na cópia do Duplicar (a chave de acesso não se repete)
 * nem no `/convert` do receber. No corpo, cada chave SÓ quando preenchida — vazio = a compra de hoje.
 */
export type DadosFiscais = {
  chave_acesso: string; uf_nota: string; tipo_documento_fiscal: string; valor_ipi: string; valor_icms_st: string; seguro: string;
  tipo_titulo_id: string; classificacao_gasto: string;
};
export type ChaveDosDadosFiscais = keyof DadosFiscais;
export const CAMPOS_DOS_DADOS_FISCAIS: readonly ChaveDosDadosFiscais[] = [
  "chave_acesso", "uf_nota", "tipo_documento_fiscal", "valor_ipi", "valor_icms_st", "seguro", "tipo_titulo_id", "classificacao_gasto"
];
export const dadosFiscaisVazios = (): DadosFiscais => ({
  chave_acesso: "", uf_nota: "", tipo_documento_fiscal: "", valor_ipi: "", valor_icms_st: "", seguro: "", tipo_titulo_id: "", classificacao_gasto: ""
});

/** A chave de acesso como a pessoa a digita (com espaços, como no DANFE) vai SEM os espaços; o resto é do servidor. */
export const chaveDeAcessoDoCorpo = (v: string) => v.replace(/\s+/g, "");

/**
 * As chaves fiscais do corpo: SÓ as preenchidas (aparadas; a UF em maiúsculas; os valores como TEXTO decimal, nunca
 * número). "Não classificado" é a ausência da classificação.
 */
export function corpoDosDadosFiscais(f: DadosFiscais): Record<string, string> {
  const out: Record<string, string> = {};
  const chave = chaveDeAcessoDoCorpo(f.chave_acesso);
  if (chave) out.chave_acesso = chave;
  if (f.uf_nota.trim()) out.uf_nota = f.uf_nota.trim().toUpperCase();
  for (const c of ["tipo_documento_fiscal", "valor_ipi", "valor_icms_st", "seguro", "tipo_titulo_id"] as const) if (f[c].trim()) out[c] = f[c].trim();
  if (f.classificacao_gasto === "capex" || f.classificacao_gasto === "opex") out.classificacao_gasto = f.classificacao_gasto;
  return out;
}

/** IPI + ICMS-ST + seguro digitados, para o total EXIBIDO (decimal; o que não é número conta zero — o servidor recusa). */
export function impostosDosDadosFiscais(f: DadosFiscais): string {
  const valor = (v: string) => { try { return v.trim() ? D(v.trim()) : D(0); } catch { return D(0); } };
  return valor(f.valor_ipi).plus(valor(f.valor_icms_st)).plus(valor(f.seguro)).toFixed(2);
}

/**
 * Total da compra na tela — UMA fonte de impostos por vez.
 * Criação com capacidade F7: soma IPI/ICMS-ST/seguro digitados.
 * Edição/consulta: soma só os gravados (nunca os dois — evita duplicar na edição ABERTA).
 */
export function totalExibidoDaCompra(p: {
  totalItens: number; frete: number; outras: number; desconto: number;
  impostosDigitados: string; impostosGravados: string; incluirDigitados: boolean;
}): number {
  const impostos = Number(p.incluirDigitados ? p.impostosDigitados : p.impostosGravados);
  return p.totalItens + p.frete + p.outras - p.desconto + (Number.isFinite(impostos) ? impostos : 0);
}

/**
 * OPERACOES-01 F7 (decisão 284) — O RATEIO E A CLASSIFICAÇÃO DOS ITENS NA COMPRA MANUAL (o que a nota antiga tinha e a
 * conferência do XML já faz): rateio do documento (o de hoje: natureza e centro do cabeçalho), por valor (linhas com
 * natureza, centro, conta contábil, safra e percentual, somando 100%) ou por produto (natureza e centro em cada item);
 * por item, "gera estoque" e "imobilizado". Mesmas regras da criação com dados fiscais: só na compra, só com a
 * capacidade; no corpo, SÓ o que foge do padrão — padrão = a compra de hoje, byte a byte.
 */
export type TipoDoRateioDaCompra = "documento" | "por_valor" | "por_produto";
export interface LinhaDoRateioDaCompra { categoriaId: string; centroId: string; contaId: string; safraId: string; percentual: string }
export interface RateioDaCompraNaTela { tipo: TipoDoRateioDaCompra; linhas: LinhaDoRateioDaCompra[] }
export const linhaDoRateioVazia = (): LinhaDoRateioDaCompra => ({ categoriaId: "", centroId: "", contaId: "", safraId: "", percentual: "" });
export const rateioDoDocumento = (): RateioDaCompraNaTela => ({ tipo: "documento", linhas: [linhaDoRateioVazia()] });

/**
 * As chaves da LINHA da grade que guardam a classificação do item. Ficam na própria linha (o motor da grade preserva as
 * chaves que não desenha), para andar junto quando a linha é duplicada, removida ou reordenada — nunca num índice paralelo.
 */
export const CLASSIFICACAO_DO_ITEM = {
  geraEstoque: "compra_gera_estoque", imobilizado: "compra_imobilizado", natureza: "compra_natureza_id", centro: "compra_centro_id"
} as const;
export const itemGeraEstoque = (i: ItemRow) => i[CLASSIFICACAO_DO_ITEM.geraEstoque] !== false;
export const itemImobilizado = (i: ItemRow) => i[CLASSIFICACAO_DO_ITEM.imobilizado] === true;
const textoDaLinha = (i: ItemRow, k: string) => (typeof i[k] === "string" ? (i[k] as string) : "");
export const naturezaDoItem = (i: ItemRow) => textoDaLinha(i, CLASSIFICACAO_DO_ITEM.natureza);
export const centroDoItem = (i: ItemRow) => textoDaLinha(i, CLASSIFICACAO_DO_ITEM.centro);

/** As chaves de classificação de UM item no corpo: só o que foge do padrão; natureza e centro só com rateio por produto. */
export function corpoDaClassificacaoDoItem(i: ItemRow, tipo: TipoDoRateioDaCompra): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!itemGeraEstoque(i)) out.gera_estoque = false;
  if (itemImobilizado(i)) out.imobilizado = true;
  if (tipo === "por_produto") {
    out.categoria_financeira_id = naturezaDoItem(i) || null;
    out.centro_custo_id = centroDoItem(i) || null;
  }
  return out;
}

/** O `rateio` do corpo: nenhum no rateio do documento (o de hoje); os percentuais como TEXTO decimal, nunca número. */
export function corpoDoRateio(r: RateioDaCompraNaTela): Record<string, unknown> {
  if (r.tipo === "documento") return {};
  if (r.tipo === "por_produto") return { rateio: { tipo: "por_produto" } };
  return {
    rateio: {
      tipo: "por_valor",
      linhas: r.linhas.map((l) => ({
        categoria_financeira_id: l.categoriaId, centro_custo_id: l.centroId,
        conta_contabil_id: l.contaId || null, safra_id: l.safraId || null, percentual: l.percentual.trim()
      }))
    }
  };
}

/** Soma dos percentuais digitados do rateio por valor (o que não é número conta zero — o servidor recusa). */
export function somaDoRateio(r: RateioDaCompraNaTela): string {
  return r.linhas.reduce((a, l) => { try { return l.percentual.trim() ? a.plus(D(l.percentual.trim())) : a; } catch { return a; } }, D(0)).toFixed();
}

/**
 * Valor (R$) derivado do percentual sobre a base do documento — `D`/decimal; nunca `Number` para dinheiro.
 * Persistência continua sendo o percentual; R$ é a outra forma de editar a mesma distribuição.
 */
export function valorDoPercentualDoRateio(base: string, percentual: string): string {
  try {
    if (!percentual.trim()) return "";
    return D(base || "0").times(D(percentual.trim())).div(100).toFixed(2);
  } catch { return ""; }
}

/** Percentual canônico (até 4 casas) a partir do Valor (R$) e da base do documento. */
export function percentualDoValorDoRateio(base: string, valor: string): string {
  try {
    const b = D(base || "0");
    if (b.lte(0) || !valor.trim()) return "";
    return D(valor.trim()).times(100).div(b).toFixed(4);
  } catch { return ""; }
}

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
  produto_id: "produto", item_origem_id: "item do pedido", armazem_id: "local de estoque", quantidade: "quantidade", valor_unitario: "valor unitário",
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
/**
 * A leitura do CADASTRO do produto da linha — uma por produto DISTINTO, a mesma chave de cache para quem a usar (o
 * controle de lote e, LANCAMENTO-01, o local padrão do produto): dois leitores, um pedido só.
 */
const leituraDoProduto = (id: string) => ({
  queryKey: ["compras-produto-lote", id], queryFn: () => api<Record<string, unknown>>(`/api/resources/products/${id}`), staleTime: 60_000, retry: false
});
/** Controle de lote de cada produto (cadastro). Desconhecido = aberto (o servidor é quem recusa). */
function useControleDeLote(produtos: string[]): ControleDeLote {
  const unicos = Array.from(new Set(produtos.filter(Boolean)));
  const qs = useQueries({ queries: unicos.map(leituraDoProduto) });
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

/**
 * LANCAMENTO-01 (decisão 311; L1/L2) — O LOCAL PADRÃO DO PRODUTO, CONFERIDO NA EMPRESA DO DOCUMENTO. A fonte é o cadastro
 * (`default_warehouse_id`), pela MESMA leitura do controle de lote (`leituraDoProduto`: na compra, nenhum pedido a mais;
 * no PEDIDO de compra é leitura NOVA, uma por produto distinto, só com a coluna do local na grade). Quem não tem
 * `products.view` recebe 403: sem local do produto (fica o do cabeçalho, o de hoje). O local só vale se for da empresa
 * do documento e ativo: `/api/resources/warehouses/options?empresa_id=…&id=…`, UMA pergunta por par (empresa, local)
 * distinto; `[]`, erro ou forma estranha ⇒ IGNORADO. Devolve o local conferido do produto, ou `null`.
 * Emenda R2: quem chama passa os produtos pelo PORTÃO (`portaoDoLocalDoProduto`) — com a capacidade desligada, a lista
 * vazia: nenhuma leitura sai daqui.
 */
function useLocaisDosProdutos(produtos: string[], empresaId: string): (produtoId: string) => string | null {
  const unicos = Array.from(new Set(produtos.filter(Boolean)));
  const qs = useQueries({ queries: unicos.map(leituraDoProduto) });
  const localDe = new Map<string, string>();
  unicos.forEach((id, i) => { const l = localDoCadastroDoProduto(qs[i]?.data); if (l) localDe.set(id, l); });
  const locais = FORMA_UUID_PADRAO.test(empresaId) ? Array.from(new Set(localDe.values())) : [];
  const confirmacoes = useQueries({ queries: locais.map((local) => ({
    queryKey: ["compras-local-do-produto", empresaId, local],
    queryFn: () => api<unknown>(`/api/resources/warehouses/options?${new URLSearchParams({ empresa_id: empresaId, id: local }).toString()}`),
    staleTime: 60_000, retry: false
  })) });
  const conferidos = new Set(locais.filter((local, i) => localConfirmadoNaEmpresa(confirmacoes[i]?.data, local)));
  return (produtoId) => { const l = localDe.get(produtoId); return l && conferidos.has(l) ? l : null; };
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
  const topDaSessao = chave && trava.current?.chave === chave ? trava.current.top : null;
  const topEfetiva = topAtual ?? topDaSessao;
  /* DUPLICAR (como na venda): a TOP do original que não abre o formulário (indisponível, inativa, servidor sem a lista)
     dá o lançador de hoje — e a cópia em memória é DESCARTADA, para não reaparecer numa criação aberta depois. */
  const copiaSemFormulario = !pedidoId && Boolean(pedidaNaUrl) && !topEfetiva && estado.situacao !== "carregando";
  React.useEffect(() => { if (copiaSemFormulario) descartarCopia(chaveDaCopiaDeCompra, variante.segmento); }, [copiaSemFormulario, variante.segmento]);
  const base = { variante, adaptador, estado, podeCriar, pedidaNaUrl, rotuloDaEspecie: rotulo,
    voltarALista: () => router.push(adaptador.rotas.lista),
    escolherTop: (t: TopOperacional) => router.replace(`/compras/${variante.segmento}/new?tipo_operacao_id=${encodeURIComponent(t.id)}`) };
  if (pedidoId) {
    return { ...base, formulario: { chave: `receber:${pedidoId}:${pedidaNaUrl}`, props: { variante, adaptador, estado, podeCriar, pedidoId, topDaUrl: pedidaNaUrl, top: null, escritaTopConfirmada: false } } };
  }
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
  /** EDITAR-02 (decisão 313): o documento salvo aberto em EDIÇÃO (só pela consulta). Ausente: criação ou receber. */
  edicao?: EdicaoAberta | null;
}

/** EDITAR-02: o que a consulta entrega ao formulário em modo edição. */
export interface EdicaoAberta {
  /** A resposta do `GET /edicao`, conferida e com `podeEditar` (a consulta não abre o formulário sem ela). */
  dados: EdicaoDoDocumentoDeCompra;
  /** Volta à consulta; `salvou` = a PATCH gravou. */
  onFechar: (salvou: boolean) => void;
  /** A oferta do conflito de versão: pergunta o `GET /edicao` de novo e descarta o rascunho. */
  recarregar: () => void;
}

/** O que não mudou nada não vai ao servidor: a edição volta à consulta com este aviso. */
export const MSG_EDICAO_SEM_MUDANCA = "Nada mudou: o documento continua como estava.";

/** Por que o Salvar está DESABILITADO por estado (não por pendência). null: habilitado. */
export type TravaDoSalvar = null | "top-nao-confirmada" | "pedido-carregando" | "pedido-recusado" | "layout-carregando" | "layout-falhou"
  | "regras-carregando" | "regras-falharam" | "capacidade-carregando" | "salvando";

export interface EstadoDaCriacao {
  modo: "criacao" | "receber" | "edicao";
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
  /** Itens + frete + outras − desconto e, com os dados fiscais, + IPI + ICMS-ST + seguro (a conta do total da 0047). */
  totalExibido: number;
  lote: ControleDeLote;

  /* os dados fiscais da compra manual (OPERACOES-01 F7, decisão 284) */
  /**
   * COMPRAS-UX-CONSISTENCIA-01: separar MOSTRAR × EDITAR.
   *   · `mostrarFiscal` / `mostrarRateio` — abas Fiscal e Classificação no painel (criação e edição).
   *   · `editarFiscal` / `editarRateio` — controles editáveis e chaves no corpo do POST (só criação com capacidade).
   *   · `dadosFiscaisAtivos` — alias de `editarFiscal` (compatível com o corpo/semeadura de antes).
   */
  mostrarFiscal: boolean;
  editarFiscal: boolean;
  mostrarRateio: boolean;
  editarRateio: boolean;
  /** @deprecated Preferir `editarFiscal`; mantido = corpo/semeadura da criação. */
  dadosFiscaisAtivos: boolean;
  fiscal: DadosFiscais;
  mudarFiscal: (p: Partial<DadosFiscais>) => void;
  /** O rateio da compra: classificação única (documento) ou por valor; por_produto só legados. */
  rateio: RateioDaCompraNaTela;
  mudarTipoDoRateio: (t: TipoDoRateioDaCompra) => void;
  mudarLinhaDoRateio: (k: number, p: Partial<LinhaDoRateioDaCompra>) => void;
  adicionarLinhaDoRateio: () => void;
  removerLinhaDoRateio: (k: number) => void;
  /** UX: classificação única → linhas por valor (preserva o par na 1ª linha). */
  ativarRateioPorValor: (patch?: Partial<LinhaDoRateioDaCompra>, extra?: LinhaDoRateioDaCompra) => void;
  /** UX: linhas por valor → classificação única (1ª linha vira o par do documento). */
  usarClassificacaoUnica: () => void;
  /**
   * UX (decisão 325): aplica a vista independente Natureza × Centro → linhas do corpo.
   * `forcarPorValor` (ex.: “+” numa tabela) impede voltar ao modo documento nesta edição.
   */
  aplicarRateioIndependente: (
    naturezas: { id: string; percentual: string }[],
    centros: { id: string; percentual: string }[],
    contaId: string,
    safraId: string,
    opts?: { forcarPorValor?: boolean },
  ) => void;
  /** A classificação de UM item: gera estoque / imobilizado (natureza/centro do item só em legado por_produto). */
  mudarClassificacaoDoItem: (k: number, p: { geraEstoque?: boolean; imobilizado?: boolean; natureza?: string; centro?: string }) => void;

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
  /** Trava pelo layout (não editável) OU pela TOP que não deixa trocar os padrões (LANCAMENTO-01, `travadoPelaTop`). */
  travado: (campo: string) => boolean;
  padraoDoCampo: (campo: string) => PadraoDeCadastro | null;
  /** O padrão de cadastro do layout é inválido OU (LANCAMENTO-01) o padrão da TOP veio sem o rótulo: o aviso de hoje. */
  padraoInvalido: (campo: string) => boolean;
  /**
   * Rótulo do padrão enquanto o valor for o do padrão (dica ao RefSelect): o de cadastro do layout primeiro; senão
   * (LANCAMENTO-01) o da TOP — "código · nome" na natureza e no centro, o nome na forma e no tipo de título.
   */
  dica: (campo: ChaveDoCabecalho | "tipo_titulo_id") => string | undefined;
  /**
   * LANCAMENTO-01 (decisão 311): o valor do campo é o que o padrão da TOP semeou (o invólucro leva
   * `data-padrao-top="semeado"`). Falso sempre que a TOP não vale (`padroesDaTopAplicam`: API anterior, receber, compra
   * que não gera título, pedido sem provisão) — e aí nada é semeado, travado ou omitido.
   */
  semeadoPelaTop: (campo: string) => boolean;
  /** A TOP trava o campo (o `fieldset` leva `data-travado-pela-top="true"`); `travado` já o inclui. */
  travadoPelaTop: (campo: string) => boolean;
  /** O campo veio do pedido com valor (no receber). */
  doPedido: (campo: string) => boolean;
  colunasDoLayout: ColunaDoLayoutNoEditor[] | undefined;
  fieldsDosItens: ColunaDoEditorDeItens[];

  /* o "Local de estoque" do cabeçalho (OPERACOES-01 F3b, decisão 280) */
  /**
   * A coluna do local está na grade da CRIAÇÃO (o layout a desenha, a regra a força, ou sem layout): só com ela o campo
   * do cabeçalho aparece. No receber, nunca (as linhas vêm do pedido; o padrão do layout preenche as sem local).
   */
  localNaGrade: boolean;
  /**
   * O local das linhas NOVAS: começa no padrão de cadastro do layout para a empresa do documento e muda pelo campo do
   * cabeçalho; cada linha troca o seu. Estado da TELA: nunca vai no corpo, não conta como alteração, não entra na cópia
   * do Duplicar. `null` sem `localNaGrade`.
   * LANCAMENTO-01 (decisão 311): a linha nova que ganha produto passa ao local padrão do PRODUTO (conferido na empresa)
   * — a não ser que o operador tenha ajustado a célula ou ESCOLHIDO o local do cabeçalho (`localDasLinhasNovas`). Só com
   * a capacidade `localDoProdutoNaLinha` (emenda R2; desligada, o local do cabeçalho, como antes).
   */
  localDoCabecalho: LocalDeEstoque | null;
  /** A escolha do operador no campo do cabeçalho (conta como resposta dele para as linhas que nascem depois). */
  escolherLocal: (local: LocalDeEstoque | null) => void;

  /* erros e pendências */
  erro: (campo: string) => string | undefined;
  errosDaTela: Readonly<Record<string, string>>;
  errosDeItens: [string, string][];
  pendencias: Pendencia[];
  pendenciasAbertas: boolean;
  setPendenciasAbertas: (v: boolean) => void;

  /* salvar */
  /**
   * O rótulo (e a dica) do Salvar, pelas regras gerais da TOP que o servidor declarou: "Salvar e confirmar" quando a
   * TOP desta compra confirma sozinha e quem salva pode confirmar a compra (`compras.edit`, a capacidade que a
   * confirmação automática confere) — também no receber, porque o `/convert` confirma a compra gerada pela TOP dela.
   * Sem a declaração (API anterior), ou sem a capacidade, "Salvar", como antes.
   */
  rotuloDoSalvar: string;
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

  /* EDITAR-02 (decisão 313): o modo edição */
  /** O documento gravado (o `documento` do `GET /edicao`); `null` fora da edição. Os dados fiscais dele, em leitura. */
  documentoEmEdicao: Row | null;
  /** O campo do cabeçalho que a edição trava (a empresa; o resto pelos limites do servidor). `travado` já o inclui. */
  travadoNaEdicao: (campo: string) => boolean;
  /** O motivo do servidor para a trava do campo na edição (`data-motivo` do invólucro); `null` = livre. */
  motivoNaEdicao: (campo: string) => string | null;
  /** As travas de cada linha da grade (o item salvo não sai; os limites dele). `null` fora da edição. */
  travasDaLinha: ((linha: ItemRow) => TravasDaLinha) | null;
  /** A grade aceita item novo (fora da edição, sempre; na edição, conforme os limites). */
  aceitaLinhaNova: boolean;
  /** O conflito de versão da PATCH: a mensagem do servidor, com a oferta de recarregar. `null` sem conflito. */
  conflito: string | null;
  fecharConflito: () => void;
  /** Recarrega a edição (o `GET /edicao` de novo) e descarta o rascunho. */
  recarregarEdicao: () => void;
}

export function useEstadoDaCriacao({ variante, adaptador, estado, podeCriar, pedidoId, topDaUrl, top: topDoLancamento, escritaTopConfirmada: escritaDaCriacao, edicao = null }: PropsDoEstadoDaCriacao): EstadoDaCriacao {
  const router = useRouter(); const tr = useTradutor(); const qc = useQueryClient(); const { can } = useAuth();
  const ehCompra = variante.variante === "compra";
  const familia = variante.familia;
  const empresaPadrao = useEmpresaPadrao();
  const recebimento = useRecebimentoDoPedido(pedidoId, topDaUrl, variante.variante);
  const modoReceber = recebimento.situacao !== "inativo";
  const recebendo = recebimento.situacao === "pronto" ? recebimento : null;
  /* EDITAR-02 (decisão 313): o documento salvo em EDIÇÃO — a TOP é a GRAVADA (já conferida pelo servidor no `/edicao`). */
  const modoEdicao = edicao !== null && !modoReceber;
  const documentoEmEdicao = modoEdicao ? edicao.dados.documento : null;
  const limites = modoEdicao ? edicao.dados.limites : null;
  const escritaTopConfirmada = modoEdicao || escritaDaCriacao;
  const [topDoPasso, setTopDoPasso] = React.useState("");
  const top = modoReceber ? topDoPasso : documentoEmEdicao ? String(documentoEmEdicao["tipo_operacao_id"] ?? "") : topDoLancamento?.id ?? "";
  const [movimento] = React.useState(() => (modoEdicao ? tr(variante.chaveI18n) : estado.situacao === "pronto" ? estado.dados.family.label : ""));
  /** A ABERTURA da edição: o documento gravado nas chaves da Central, lida UMA vez (o rascunho é estado do formulário). */
  const [aberturaDaEdicao] = React.useState(() => (documentoEmEdicao ? aberturaDoDocumento(documentoEmEdicao, defaultPlan) : null));

  /* A CÓPIA (Duplicar) — lida UMA vez, da memória; só vale para esta espécie e esta TOP. Como na venda, o formulário que
     monta encerra a entrega mesmo quando ela não vale para ele: a cópia de outra TOP não fica para uma criação seguinte.
     A EDIÇÃO não é criação: não lê nem encerra a cópia (ela é de uma criação desta espécie, que ainda vai abrir). */
  const [copia] = React.useState<CopiaDeCompra | null>(() =>
    (!modoReceber && !modoEdicao && topDoLancamento ? espiarCopia<Partial<Cabecalho>>(chaveDaCopiaDeCompra, variante.segmento, topDoLancamento.id) : null));
  const avisouCopia = React.useRef(false);
  React.useEffect(() => {
    if (modoEdicao) return;
    descartarCopia(chaveDaCopiaDeCompra, variante.segmento);
    if (copia && !avisouCopia.current) { avisouCopia.current = true; toast.info("Cópia aberta como rascunho"); }
  }, [copia, variante.segmento, modoEdicao]);

  const [h, setH] = React.useState<Cabecalho>(() => (aberturaDaEdicao ? { ...aberturaDaEdicao.cabecalho }
    : { ...cabecalhoVazio(), ...(copia?.cabecalho ?? {}), data_documento: todayISO() }));
  /** O estado INICIAL ("intocado"): a abertura (sem a cópia: a cópia é alteração), o pedido e os padrões aplicados. */
  const inicial = React.useRef<Cabecalho>(aberturaDaEdicao ? { ...aberturaDaEdicao.cabecalho } : cabecalhoVazio());
  const abertura = React.useRef<{ h: Cabecalho; itens: ItemRow[] } | null>(null);
  React.useEffect(() => { setH((o) => ({ ...o, empresa_id: o.empresa_id || empresaPadrao })); }, [empresaPadrao]);
  const mudar = React.useCallback((p: Partial<Cabecalho>) => setH((o) => ({ ...o, ...p })), []);
  const [itens, setItensCru] = React.useState<ItemRow[]>(() => aberturaDaEdicao?.itens ?? copia?.itens ?? []);
  /* Na EDIÇÃO, a defesa do handler (`itensNaEdicao`): o item salvo não sai, a cópia de um item salvo é item novo, o
     item novo só onde a edição o aceita e o campo travado volta ao valor anterior. */
  const setItens = (novos: ItemRow[]) => setItensCru((antes) => (modoReceber ? acompanharDescontoDaOrigem(antes, novos)
    : limites ? itensNaEdicao(antes, novos, limites) : novos));
  const [ajustarParcelas, setAjustarParcelas] = React.useState(aberturaDaEdicao?.ajustarParcelas ?? false);
  const [plano, setPlano] = React.useState<Plan>(() => (aberturaDaEdicao ? { ...aberturaDaEdicao.plano } : defaultPlan()));
  /* DADOS FISCAIS (F7): fato fiscal (chave/UF/impostos) só na criação. EDITAR-02B: classificação/rateio também na edição ABERTA. */
  const capacidadeFiscal = useImportacaoXml(ehCompra && !modoReceber);
  const editarFiscal = ehCompra && !modoReceber && !modoEdicao && capacidadeFiscal === "sim";
  /* Edição: aba Fiscal só se há capacidade F7 OU dados fiscais/importação gravados — evita aba vazia em legado. */
  const docEdicaoTemFiscal = Boolean(documentoEmEdicao && (
    ["chave_acesso", "uf_nota", "tipo_documento_fiscal", "valor_ipi", "valor_icms_st", "seguro", "tipo_titulo_id", "classificacao_gasto", "rateio_tipo", "importacao_id"]
      .some((c) => documentoEmEdicao[c] !== null && documentoEmEdicao[c] !== undefined && documentoEmEdicao[c] !== "")
    || (typeof documentoEmEdicao["dfe"] === "object" && documentoEmEdicao["dfe"] !== null)
  ));
  const mostrarFiscal = ehCompra && !modoReceber && (
    editarFiscal || (modoEdicao && (capacidadeFiscal === "sim" || docEdicaoTemFiscal))
  );
  /* Classificação/rateio editáveis na criação (F7) e na edição ABERTA da compra — distinto de editar fato fiscal. */
  const editarRateio = ehCompra && !modoReceber && (editarFiscal || modoEdicao);
  const mostrarRateio = editarRateio || (modoEdicao && ehCompra && !modoReceber);
  /* Alias histórico = só criação com capacidade: corpo POST fiscal + impostos digitados no total. Nunca edição. */
  const dadosFiscaisAtivos = editarFiscal;
  const fiscalDaAbertura = (): DadosFiscais => {
    if (!aberturaDaEdicao) return dadosFiscaisVazios();
    return {
      ...dadosFiscaisVazios(),
      tipo_titulo_id: aberturaDaEdicao.tipoTituloId,
      classificacao_gasto: aberturaDaEdicao.classificacaoGasto,
      valor_ipi: String(documentoEmEdicao?.["valor_ipi"] ?? ""),
      valor_icms_st: String(documentoEmEdicao?.["valor_icms_st"] ?? ""),
      seguro: String(documentoEmEdicao?.["seguro"] ?? ""),
      chave_acesso: String(documentoEmEdicao?.["chave_acesso"] ?? ""),
      uf_nota: String(documentoEmEdicao?.["uf_nota"] ?? ""),
      tipo_documento_fiscal: String(documentoEmEdicao?.["tipo_documento_fiscal"] ?? ""),
    };
  };
  const rateioDaAbertura = (): RateioDaCompraNaTela => {
    if (!aberturaDaEdicao) return rateioDoDocumento();
    return { tipo: aberturaDaEdicao.rateioTipo, linhas: aberturaDaEdicao.rateioLinhas.map((l) => ({ ...l })) };
  };
  const [fiscal, setFiscal] = React.useState<DadosFiscais>(() => fiscalDaAbertura());
  /* LANCAMENTO-01 (decisão 311): o INICIAL dos dados fiscais — vazio, ou com o tipo de título que a TOP semeou (não conta
     como alteração, e o Descartar volta a ele). Sem semeadura, vazio: o "alterado" de hoje, byte a byte. */
  const fiscalInicial = React.useRef<DadosFiscais>(fiscalDaAbertura());
  /* O QUE A TOP SEMEOU (registrado pelo efeito dos padrões, nunca pela tela): a REGRA do corpo (`omissaoDoCorpo`) o consulta. */
  const semeadura = React.useRef<Semeadura>({});
  const mudarFiscal = React.useCallback((p: Partial<DadosFiscais>) => setFiscal((o) => ({ ...o, ...p })), []);
  const [rateio, setRateio] = React.useState<RateioDaCompraNaTela>(() => rateioDaAbertura());
  const rateioInicial = React.useRef<RateioDaCompraNaTela>(rateioDaAbertura());
  const mudarTipoDoRateio = (tipo: TipoDoRateioDaCompra) => setRateio((r) => ({ ...r, tipo }));
  const mudarLinhaDoRateio = (k: number, p: Partial<LinhaDoRateioDaCompra>) => setRateio((r) => ({ ...r, linhas: r.linhas.map((l, i) => (i === k ? { ...l, ...p } : l)) }));
  const adicionarLinhaDoRateio = () => setRateio((r) => (r.linhas.length >= 50 ? r : { ...r, linhas: [...r.linhas, linhaDoRateioVazia()] }));
  const removerLinhaDoRateio = (k: number) => setRateio((r) => (r.linhas.length <= 1 ? r : { ...r, linhas: r.linhas.filter((_, i) => i !== k) }));
  /**
   * Classificação única → rateio por valor: preserva o par do documento como 1ª linha a 100%,
   * limpa o cabeçalho (CHECK 0047: com por_valor o par do documento fica nulo).
   * `patch` / `extra` permitem Conta Contábil, Safra, % ou 2ª linha na mesma transição (sem esconder campo).
   */
  const ativarRateioPorValor = (patch?: Partial<LinhaDoRateioDaCompra>, extra?: LinhaDoRateioDaCompra) => {
    const primeira: LinhaDoRateioDaCompra = {
      categoriaId: h.categoria_financeira_id,
      centroId: h.centro_custo_id,
      contaId: "", safraId: "", percentual: "100",
      ...patch,
    };
    setRateio({ tipo: "por_valor", linhas: extra ? [primeira, extra] : [primeira] });
    setH((o) => ({ ...o, categoria_financeira_id: "", centro_custo_id: "" }));
  };
  /** Volta à classificação única a partir da 1ª linha (ou vazia) — mantido para compat; a UI nova não oferece o atalho. */
  const usarClassificacaoUnica = () => {
    const primeira = rateio.linhas[0];
    setRateio(rateioDoDocumento());
    setH((o) => ({
      ...o,
      categoria_financeira_id: primeira?.categoriaId ?? "",
      centro_custo_id: primeira?.centroId ?? "",
    }));
  };
  const aplicarRateioIndependente = (
    naturezas: { id: string; percentual: string }[],
    centros: { id: string; percentual: string }[],
    contaId: string,
    safraId: string,
    opts?: { forcarPorValor?: boolean },
  ) => {
    const n = naturezas.length ? naturezas : [{ id: "", percentual: "100" }];
    const c = centros.length ? centros : [{ id: "", percentual: "100" }];
    const documento = rateio.tipo !== "por_valor"
      && !opts?.forcarPorValor
      && cabeNoDocumento(n, c, contaId, safraId);
    if (documento) {
      setRateio(rateioDoDocumento());
      setH((o) => ({ ...o, categoria_financeira_id: n[0]!.id, centro_custo_id: c[0]!.id }));
      return;
    }
    setRateio({ tipo: "por_valor", linhas: linhasDoProdutoCruzado(n, c, contaId, safraId) });
    setH((o) => ({ ...o, categoria_financeira_id: "", centro_custo_id: "" }));
  };
  /* A classificação mora na LINHA (a mesma lista que a grade edita). Item que deixa de gerar estoque perde o local:
     "não gera estoque" com local seria dois sinais contraditórios (o servidor recusa). */
  const mudarClassificacaoDoItem = (k: number, p: { geraEstoque?: boolean; imobilizado?: boolean; natureza?: string; centro?: string }) =>
    setItensCru((ls) => ls.map((l, i) => {
      if (i !== k) return l;
      const nova: ItemRow = { ...l };
      if (p.geraEstoque !== undefined) { nova[CLASSIFICACAO_DO_ITEM.geraEstoque] = p.geraEstoque; if (!p.geraEstoque) nova.warehouse_id = ""; }
      if (p.imobilizado !== undefined) nova[CLASSIFICACAO_DO_ITEM.imobilizado] = p.imobilizado;
      if (p.natureza !== undefined) nova[CLASSIFICACAO_DO_ITEM.natureza] = p.natureza;
      if (p.centro !== undefined) nova[CLASSIFICACAO_DO_ITEM.centro] = p.centro;
      return nova;
    }));
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
  /* EDITAR-02: na edição, IPI/ICMS-ST/seguro GRAVADOS entram uma vez. Na criação F7, entram os digitados — nunca os dois. */
  const [impostosGravados] = React.useState(() => (documentoEmEdicao ? impostosDosDadosFiscais({
    ...dadosFiscaisVazios(), valor_ipi: String(documentoEmEdicao["valor_ipi"] ?? ""), valor_icms_st: String(documentoEmEdicao["valor_icms_st"] ?? ""),
    seguro: String(documentoEmEdicao["seguro"] ?? "")
  }) : "0"));
  const totalExibido = totalExibidoDaCompra({
    totalItens,
    frete: Number(h.frete || 0),
    outras: Number(h.outras_despesas || 0),
    desconto: Number(h.desconto || 0),
    impostosDigitados: impostosDosDadosFiscais(fiscal),
    impostosGravados,
    incluirDigitados: editarFiscal,
  });

  /* LANCAMENTO-01 (decisão 311) — A REGRA DO CORPO (`omissaoDoCorpo`): fora do corpo, o PAR natureza+centro que a TOP
     semeou e o operador não mexeu (o salvar da compra que gera título e o do pedido que provisiona aplicam o mesmo par da
     TOP; a compra de total zero não gera título e não usa nem cobra o par — fora do corpo grava o de hoje, sem par) e o
     tipo de título semeado (a confirmação usa o da TOP). Nunca sai o campo que o servidor COBRA SOBRE O CORPO antes de
     olhar a TOP (`cobradoNoCorpo`). Sem `aplica`, nada sai: o corpo de hoje. A regra é do corpo, não estado escondido:
     `documentoConferido` (as pendências) deriva dele, e o omitido nunca é obrigatório do layout, então nunca vira
     pendência. */
  const omissao = () => omissaoDoCorpo({
    aplica: aplicaATop, padroes: padroesTop, semeado: semeadura.current,
    natureza: h.categoria_financeira_id, centro: h.centro_custo_id, tipoTitulo: fiscal.tipo_titulo_id, cobrancaNoCorpo
  });
  const cabecalhoDoCorpo = () => ({
    tipo_operacao_id: top,
    transportadora_id: opcional(h.transportadora_id),
    data_documento: h.data_documento,
    data_vencimento: opcional(h.data_vencimento),
    ...(ehCompra ? { data_entrada: opcional(h.data_entrada), numero_nota: opcional(h.numero_nota), serie_nota: opcional(h.serie_nota) } : {}),
    categoria_financeira_id: omissao().classificacao ? undefined : opcional(h.categoria_financeira_id),
    centro_custo_id: omissao().classificacao ? undefined : opcional(h.centro_custo_id),
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
  const corpoDoLancamento = (): Record<string, unknown> => (modoReceber
    ? { ...cabecalhoDoCorpo(), itens: itens.map((i) => ({ item_origem_id: String(i["item_origem_id"] ?? ""), ...camposDoItem(i) })) }
    : { empresa_id: h.empresa_id, fornecedor_id: h.fornecedor_id, ...cabecalhoDoCorpo(),
      itens: itens.map((i) => ({ produto_id: i.product_id, ...camposDoItem(i), ...(dadosFiscaisAtivos ? corpoDaClassificacaoDoItem(i, rateio.tipo) : {}) })),
      // F7: DEPOIS das chaves de hoje, e só as preenchidas — sem a capacidade (ou nada preenchido), o corpo de hoje.
      // LANCAMENTO-01: o tipo de título que a TOP semeou não vai (`omissaoDoCorpo`).
      ...(dadosFiscaisAtivos ? { ...corpoDosDadosFiscais(omissao().tipoTitulo ? { ...fiscal, tipo_titulo_id: "" } : fiscal), ...corpoDoRateio(rateio) } : {}) });
  /**
   * EDITAR-02 (decisão 313): o corpo da PATCH — `{ version, ...só o que mudou }` contra a abertura (`corpoDaEdicao`).
   * Nada semeado: o que vai é só o que o operador mudou.
   */
  const corpoDaPatch = (): Record<string, unknown> => (modoEdicao && aberturaDaEdicao
    ? corpoDaEdicao({
      version: edicao.dados.version, ehCompra,
      abertura: {
        cabecalho: aberturaDaEdicao.cabecalho, itens: aberturaDaEdicao.itens,
        ajustarParcelas: aberturaDaEdicao.ajustarParcelas, plano: aberturaDaEdicao.plano,
        tipoTituloId: aberturaDaEdicao.tipoTituloId, classificacaoGasto: aberturaDaEdicao.classificacaoGasto,
        rateioTipo: aberturaDaEdicao.rateioTipo, rateioLinhas: aberturaDaEdicao.rateioLinhas,
      },
      atual: {
        cabecalho: h, itens, ajustarParcelas, plano,
        tipoTituloId: fiscal.tipo_titulo_id, classificacaoGasto: fiscal.classificacao_gasto,
        rateioTipo: rateio.tipo, rateioLinhas: rateio.linhas,
      },
    })
    : {});
  const corpo = (): Record<string, unknown> => (modoEdicao ? corpoDaPatch() : corpoDoLancamento());
  /* O que as pendências conferem: o documento COMO FICARÁ (na edição, o gravado com o que mudou — a forma do lançamento,
     sem nenhuma omissão: na edição a TOP não semeia nada). */
  const documentoConferido = (): Record<string, unknown> => (recebendo
    ? { ...cabecalhoDoCorpo(), empresa_id: String(recebendo.pedido["empresa_id"] ?? ""), fornecedor_id: String(recebendo.pedido["fornecedor_id"] ?? ""),
      itens: itens.map((i) => ({ produto_id: i.product_id, ...camposDoItem(i) })) }
    : corpoDoLancamento());

  const segmentoDoPedido = varianteDeCompra("pedido")?.segmento ?? "";
  const idEmEdicao = documentoEmEdicao ? String(documentoEmEdicao["id"] ?? "") : "";
  const porta = modoReceber ? `/api/compras/${segmentoDoPedido}/${pedidoId}/convert`
    : modoEdicao ? portaDoDocumento(variante.segmento, idEmEdicao) : `/api/compras/${variante.segmento}`;

  // A chave do Salvar: a MESMA até o servidor RECUSAR (4xx). Rede, 5xx ou resposta perdida: o reenvio repete a chave e
  // recebe a resposta gravada (o documento que a 1ª tentativa já criou), nunca um segundo documento.
  const chave = useChaveDeIdempotencia();
  const depoisDeSalvar = React.useRef<DepoisDeSalvar>({ confirmar: false });
  /* EDITAR-02: o conflito de versão da PATCH (409 CONCURRENCY_CONFLICT) — a mensagem do servidor e a oferta de recarregar. */
  const [conflito, setConflito] = React.useState<string | null>(null);
  const salvarM = useMutation({
    mutationFn: () => {
      const c = corpo();
      // EDITAR-02: a PATCH leva a MESMA regra da chave do POST (a MESMA até o servidor recusar).
      return api<RespostaDoSalvar>(porta, { method: modoEdicao ? "PATCH" : "POST", body: c, idempotencyKey: chave.doEnvio(c) });
    },
    onSuccess: (r) => {
      if (modoEdicao) {
        // A PATCH não confirma (P4 da 313): o aviso é só o do salvar; a consulta volta atualizada.
        toast.success("Alterações salvas");
        void invalidarLeiturasDeCompras(qc);
        void qc.invalidateQueries({ queryKey: chaveDaEdicao(variante.segmento, idEmEdicao) });
        edicao.onFechar(true);
        return;
      }
      // O aviso sai da RESPOSTA (`confirmacaoAutomatica`), pelo motor — um por Salvar, lançar ou receber; sem a chave,
      // o "Salvo com sucesso" de antes.
      avisarSalvo(r);
      void qc.invalidateQueries();
      // O "Salvo ✓" (e o pedido de abrir o Confirmar) vão à consulta pela memória, nunca pela URL.
      entregarSalvo(chaveDepoisDeSalvarDeCompra, r.id, depoisDeSalvar.current);
      router.push(adaptador.rotas.registro(r.id));
    },
    onError: (e) => {
      const aviso = chave.depoisDoErro(e);
      // EDITAR-02: o documento mudou desde o `/edicao` — a mensagem do servidor, com a oferta de recarregar (o rascunho
      // só sai se a pessoa aceitar). As outras recusas (409 de situação, 422) vão ao lugar de sempre.
      const mudou = modoEdicao ? conflitoDaEdicao(e) : null;
      if (mudou) { setErros({}); setConflito(mudou); return; }
      setErros(errosDoServidor(e)); toast.error(aviso);
    }
  });

  const daCriacao = useRegrasDaCompra(variante.segmento, top, modoEdicao ? false : modoReceber ? Boolean(recebendo) && !!top : podeLancar(estado) && !!top);
  /* EDITAR-02: as regras da versão CONGELADA vêm no `/edicao` (as portas do lançamento pedem `.create` e respondem pela
     versão ATUAL) — o MESMO leitor; fora da forma, "as regras não carregaram" (o Salvar trava, como na criação). */
  const regrasCruasDaEdicao = modoEdicao ? edicao.dados.regras : undefined;
  const regrasDaEdicao = React.useMemo(() => (modoEdicao ? lerRegras(regrasCruasDaEdicao) : null), [modoEdicao, regrasCruasDaEdicao]);
  const regras = modoEdicao ? regrasDaEdicao : daCriacao.regras;
  const regrasPendente = modoEdicao ? false : daCriacao.pendente;
  const regrasFalharam = modoEdicao ? regrasDaEdicao === null : daCriacao.falhou;
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
  /* EDITAR-02: na edição o layout de HOJE da TOP vem no `/edicao` (nenhuma pergunta a mais); fora da forma, "layout não
     carregado" (o Salvar trava, como na criação). Os PADRÕES do layout não valem na edição: o documento tem os seus. */
  const layoutAtivo = modoEdicao || entendeLayoutDocumento(estado);
  const layoutQ = useQuery<unknown, ApiError>({
    queryKey: ["layout-efetivo", "compras", variante.segmento, top],
    queryFn: () => api<unknown>(`/api/compras/${variante.segmento}/layout-efetivo?tipo_operacao_id=${encodeURIComponent(top)}`),
    enabled: !modoEdicao && layoutAtivo && Boolean(top),
    retry: false
  });
  const layoutRecebido = modoEdicao ? edicao.dados.layout : layoutQ.data;
  const layout = React.useMemo(() => (layoutAtivo ? estruturaDaResposta(layoutRecebido) : null), [layoutAtivo, layoutRecebido]);
  const layoutPendente = !modoEdicao && layoutAtivo && !layout;
  const layoutNaoCarregado = modoEdicao ? !layout : layoutPendente && (layoutQ.isError || (layoutQ.isSuccess && !layout));
  const capacidadePendente = modoReceber && podeCriar && estado.situacao === "carregando";
  const layoutVale = React.useMemo(() => (layout ? layoutQueVale(layoutRecebido) : null), [layout, layoutRecebido]);
  const padroes = React.useMemo(() => (layout && !modoEdicao ? padroesDaResposta(layoutRecebido) : SEM_PADROES), [layout, modoEdicao, layoutRecebido]);
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
  /** O obrigatório do LAYOUT configurado (o que o servidor cobra sobre o corpo, `cobrarLayoutDaCompra`) — sem a regra. */
  const obrigatorioNoLayout = (c: string) => Boolean(layout) && cfg.get(c)?.obrigatorio === true;
  /**
   * O que o servidor COBRA SOBRE O CORPO no salvar, ANTES de olhar os padrões da TOP (`cobradoNoCorpo`): o obrigatório do
   * layout (`cobrarLayoutDaCompra`) e as exigências gerais da TOP (`cobrarRegrasDaCompra` → `exigenciasGeraisFaltando`,
   * que roda antes de `padroesDaTopNoSalvarDaCompra` e não sabe da TOP — omitir ali o centro exigido seria o 422 "Centro
   * de resultado é obrigatório nesta operação." para sempre). As exigências gerais são o MESMO `regras.exigencias` que
   * alimenta `camposExigidosPelaRegra` (não uma segunda lista). Campo cobrado assim nunca sai do corpo (`omissaoDoCorpo`).
   */
  const cobrancaNoCorpo: CobrancaNoCorpo = { obrigatorioNoLayout, exigenciasGerais: regras?.exigencias ?? [] };

  /* ── LANCAMENTO-01 (decisão 311): os padrões financeiros da TOP (`padroes-da-top.ts`). ── */
  const padroesDaTop = regras?.padroesDaTop ?? null;
  const padroesTop = padroesDaTop?.padroes ?? null;
  // EDITAR-02: na edição, NUNCA (decisão 311 item 2: só na criação) — nada semeado, travado ou omitido pela TOP.
  const aplicaATop = padroesDaTopAplicam({ modo: modoReceber ? "receber" : modoEdicao ? "edicao" : "criacao", ehCompra, lidos: padroesDaTop, geraTitulos: regras?.geraTitulos ?? null });
  /* `podeTrocar` (AND, o perfil da família no domínio). Sem a seção, nada a travar: a trava só existe com `aplica`. */
  const podeTrocar = padroesDaTop ? podeTrocarOsPadroes(padroesDaTop.secao, familia) : true;
  /* A forma só se semeia COBRADA: a regra da TOP a exige, ou o layout a marca obrigatória. */
  const formaCobrada = regras?.exigeFormaPagamento === true || obrigatorioNoLayout("forma_pagamento_id");
  /** O valor que a tela mostra no campo que a TOP pode preencher (o tipo de título mora nos dados fiscais). */
  const valorNaTela = (c: string): string => (c === "tipo_titulo_id"
    ? ((editarFiscal || (modoEdicao && editarRateio)) ? fiscal.tipo_titulo_id : "")
    : c in h ? h[c as ChaveDoCabecalho] : "");
  const travadoPelaTopNaTela = (c: string) => travadoPelaTop({ aplica: aplicaATop, podeTrocar, padroes: padroesTop, campo: c, valor: valorNaTela(c) });
  const semeadoPelaTopNaTela = (c: string) => {
    const s = semeadura.current[c as CampoDoPadraoDaTop];
    return aplicaATop && s !== undefined && mesmoId(valorNaTela(c), s);
  };

  const padraoArmazem = layout && layout.itens.some((c) => c.campo === "armazem_id") ? padroes.validos.get(chavePadraoDeCadastro("itens", "armazem_id")) : undefined;
  const armazemPadrao = padraoArmazem && padraoArmazem.empresaId && padraoArmazem.empresaId === h.empresa_id ? padraoArmazem.id : null;
  /* O "Local de estoque" do cabeçalho (F3b) começa no MESMO padrão — o de cadastro do layout, só para a empresa do
     documento — com o rótulo que o servidor mandou; trocar a empresa volta ao padrão dela. O `armazemPadrao` (o id)
     continua sendo o que preenche as linhas sem local no receber. */
  const padraoDoLocal = React.useMemo<LocalDeEstoque | null>(
    () => (padraoArmazem && padraoArmazem.empresaId && padraoArmazem.empresaId === h.empresa_id ? { id: padraoArmazem.id, rotulo: padraoArmazem.rotulo } : null),
    [padraoArmazem, h.empresa_id]);
  const local = useLocalDoCabecalho(padraoDoLocal, h.empresa_id);

  /* PADRÕES DO LAYOUT: uma vez por resposta, só em campo intocado, nunca no que o pedido trouxe.
     LANCAMENTO-01 (decisão 311; S2): no MESMO efeito e DEPOIS deles, os padrões financeiros da TOP — a ordem é a da
     precedência (o padrão de cadastro do layout vem antes e nunca é sobrescrito). Só com `aplica`, só em campo que
     continuou VAZIO depois do layout e da cópia, e só no que o operador não tocou (`planoDaSemeadura`). Os semeados
     entram no `inicial` (não contam como alteração; o Descartar volta a eles) e ficam em `semeadura` para a regra do
     corpo. Uma vez por resposta das regras (o mesmo objeto enquanto o servidor responde o mesmo) e por bloco fiscal. */
  const padroesAplicados = React.useRef<{ resposta: unknown; preenchimento: string } | null>(null);
  const semeaduraFeita = React.useRef<{ regras: RegrasDaCompra | null; fiscais: boolean } | null>(null);
  React.useEffect(() => {
    // EDITAR-02: o documento salvo não recebe padrão nenhum (nem o do layout, nem o da TOP): a abertura é o gravado.
    if (modoEdicao || !layout || regrasPendente || (modoReceber && !preenchimento)) return;
    const marca = padroesAplicados.current;
    const antes = inicial.current;
    const novos: Partial<Cabecalho> = {};
    if (!marca || marca.resposta !== layoutRecebido || marca.preenchimento !== preenchimento) {
      padroesAplicados.current = { resposta: layoutRecebido, preenchimento };
      const aceita = (c: string): c is keyof Cabecalho => c in antes && !doPedido.current.has(c);
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
    }

    /* (2) A TOP, DEPOIS do layout. */
    const feita = semeaduraFeita.current;
    if (feita && feita.regras === regras && feita.fiscais === dadosFiscaisAtivos) return;
    semeaduraFeita.current = { regras, fiscais: dadosFiscaisAtivos };
    if (!aplicaATop || !padroesTop) return;
    const depoisDoLayout = inicial.current;
    // o que a tela vai mostrar: o padrão do layout no campo intocado (o MESMO critério do `setH` acima), senão o de agora
    // (a cópia do Duplicar, o que o operador já digitou)
    const naTela = (k: ChaveDoCabecalho) => (novos[k] !== undefined && h[k] === antes[k] ? novos[k]! : h[k]);
    const plano = planoDaSemeadura(padroesTop, {
      natureza: naTela("categoria_financeira_id"), centro: naTela("centro_custo_id"), formaPagamento: naTela("forma_pagamento_id"),
      tipoTitulo: dadosFiscaisAtivos ? fiscal.tipo_titulo_id : null
    }, {
      formaCobrada,
      // o campo que o operador tocou (≠ do inicial, o que a abertura e o layout deram) não é semeado
      livre: (c) => (c === "tipo_titulo_id" ? fiscal.tipo_titulo_id === fiscalInicial.current.tipo_titulo_id : naTela(c) === depoisDoLayout[c])
    });
    const { tipo_titulo_id: tipoTitulo, ...doCabecalho } = plano;
    const chavesDaTop = Object.keys(doCabecalho) as Exclude<CampoDoPadraoDaTop, "tipo_titulo_id">[];
    if (chavesDaTop.length) {
      inicial.current = { ...depoisDoLayout, ...doCabecalho };
      setH((o) => {
        const r = { ...o };
        for (const k of chavesDaTop) if (o[k] === depoisDoLayout[k]) r[k] = doCabecalho[k]!;
        return r;
      });
    }
    if (tipoTitulo) {
      fiscalInicial.current = { ...fiscalInicial.current, tipo_titulo_id: tipoTitulo };
      setFiscal((o) => (o.tipo_titulo_id === "" ? { ...o, tipo_titulo_id: tipoTitulo } : o));
    }
    if (Object.keys(plano).length) semeadura.current = { ...semeadura.current, ...plano };
  }, [modoEdicao, layout, layoutRecebido, regrasPendente, modoReceber, preenchimento, empresaPadrao, padroes, padraoDoCampo, armazemPadrao,
    regras, aplicaATop, padroesTop, dadosFiscaisAtivos, formaCobrada, h, fiscal]);

  const colunasForcadas = [
    ...(regras?.exigeArmazem ? ["armazem_id"] : []),
    ...(ehCompra ? (["lote", "validade"] as const).filter((c) => itens.some((it) => lote.pede(it.product_id, c))) : [])
  ];
  const colunasDoLayout = layout ? colunasDoEditor(familia, layout.itens, { forcadas: colunasForcadas, obrigatoriasPelaRegra: new Set(regras?.exigeArmazem ? ["armazem_id"] : []) }) : undefined;
  const fieldsDosItens: ColunaDoEditorDeItens[] = colunasDoLayout ? colunasDoLayout.map((c) => c.coluna) : ehCompra ? COLUNAS_DE_HOJE_DA_COMPRA : COLUNAS_DE_HOJE_DO_PEDIDO;
  /* Com o local escondido pelo layout (e não exigido pela regra) a linha nasce sem local, como antes: preencher um campo
     que o usuário não vê nem troca seria o contrário de "o item pode trocar o local". */
  /* EDITAR-02: na edição, também não — o "Local de estoque" do cabeçalho e o local padrão do produto (311) são da criação;
     o item novo da edição nasce sem local, e cada linha escolhe o seu. */
  const localNaGrade = !modoReceber && !modoEdicao && fieldsDosItens.includes("warehouse");

  /* LANCAMENTO-01 (decisão 311; L1–L4) — O LOCAL DA LINHA NOVA: o local padrão do PRODUTO, conferido na empresa do
     documento (`useLocaisDosProdutos`), acima do local do cabeçalho que é só padrão (o do layout) ou vazio, e abaixo da
     resposta do operador — o ajuste na célula, ou o local do cabeçalho que ele ESCOLHEU (`escolherLocal`). Só na
     criação e só com a coluna do local na grade (escondida, a linha continua sem local, como antes). A marca de quem é
     o local mora na LINHA (`LOCAL_DA_LINHA`): o motor genérico de itens não muda. O `armazem_id` da linha continua sendo
     valor do documento (nenhum código do servidor o resolve) e vai no corpo, como hoje.
     EMENDA R2 — O PORTÃO (`portaoDoLocalDoProduto`): tudo isto só com a capacidade `localDoProdutoNaLinha` que o servidor
     declara (`regras.localDoProdutoNaLinha`; a chave dele nasce desligada — decisão 240 item 4). Desligada, ausente (a
     API anterior) ou com as regras ainda chegando: nenhum produto a ler para o local (nem `products/:id` no pedido, nem
     `warehouses/options`) e o efeito NÃO roda — a linha nasce com o local do cabeçalho e fica com ele, sem a marca, como
     antes da 311. */
  const [localEscolhidoEm, setLocalEscolhidoEm] = React.useState<string | null>(null);
  // a escolha vale para a empresa em que foi feita — a MESMA regra de `useLocalDoCabecalho` (trocar a empresa a limpa)
  React.useEffect(() => { if (localEscolhidoEm !== null && localEscolhidoEm !== h.empresa_id) setLocalEscolhidoEm(null); }, [h.empresa_id, localEscolhidoEm]);
  const cabecalhoEscolhido = localEscolhidoEm !== null && localEscolhidoEm === h.empresa_id && local.local !== null;
  const escolherLocal = (l: LocalDeEstoque | null) => { local.escolher(l); setLocalEscolhidoEm(l ? h.empresa_id : null); };
  const portaoDoLocal = portaoDoLocalDoProduto({ ligado: regras?.localDoProdutoNaLinha === true, localNaGrade, produtos: itens.map((i) => i.product_id) });
  const localDoProduto = useLocaisDosProdutos(portaoDoLocal.produtos, h.empresa_id);
  React.useEffect(() => {
    const ctx = { cabecalhoEscolhido, localDoProduto, geraEstoque: itemGeraEstoque };
    // portão fechado ⇒ as MESMAS linhas: nenhum `setItensCru`, nenhuma marca
    const novas = localDasLinhasNovasNoPortao(portaoDoLocal, itens, ctx);
    // só quando muda; sobre o estado MAIS RECENTE (o efeito do lote pode ter acabado de mexer nas mesmas linhas)
    if (novas !== itens) setItensCru((ls) => (ls === itens ? novas : localDasLinhasNovasNoPortao(portaoDoLocal, ls, ctx)));
  });

  /* OBRIGATÓRIOS: a MESMA função do domínio que a API usa. */
  const [tentouSalvar, setTentouSalvar] = React.useState(false);
  const faltando = () => (layout ? camposObrigatoriosFaltando(familia, layout, documentoConferido(), { classificacao: true, condicao: true }) : []);
  const listaFaltando = faltando();
  const errosLocais: Record<string, string> = layout && tentouSalvar ? Object.fromEntries(listaFaltando.map((f) => [f.caminho, mensagemCampoObrigatorio(f.rotulo)])) : {};
  const errosDaTela: Record<string, string> = { ...erros, ...errosLocais };
  const erro = (c: string) => errosDaTela[c];
  const errosDeItens = Object.entries(errosDaTela).filter(([c]) => c.startsWith("itens"));

  /* SEM ITENS (OPERACOES-01 F2): só quando o servidor declarou que a TOP aceita a compra sem itens — e NUNCA no receber
     do pedido: o `/convert` sempre exige item (o recebimento é dos itens do pedido). */
  const aceitaSemItensAqui = !modoReceber && !exigeAoMenosUmItem(regras?.regrasGerais);
  /** PENDÊNCIAS: sem itens (a não ser que a TOP aceite) + o que o layout cobra (a pílula vermelha "N pendências"). */
  const pendencias: Pendencia[] = [
    ...(itens.length || aceitaSemItensAqui ? [] : [{ caminho: "itens", rotulo: "Itens", mensagem: "Inclua ao menos um item." }]),
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
    setConflito(null);
    // EDITAR-02: nada mudou ⇒ nada vai ao servidor (zero PATCH) — a edição volta à consulta, que continua a mesma.
    if (modoEdicao && !mudouAlgo(corpoDaPatch())) { toast.info(MSG_EDICAO_SEM_MUDANCA); edicao.onFechar(false); return; }
    setTentouSalvar(true);
    if (pendencias.length) { setPendenciasAbertas(true); return; } // zero POST
    // A PATCH não confirma (P4 da 313): o pedido de abrir o Confirmar é só da criação.
    depoisDeSalvar.current = { confirmar: ehCompra && !modoEdicao && Boolean(opcoes?.confirmar) };
    salvarM.mutate();
  };

  /* ALTERADO: contra o estado inicial, sem a empresa (preenchida por efeito). A cópia conta como alteração. Os dados
     fiscais contra o inicial deles (vazio; com o tipo de título que a TOP semeou, LANCAMENTO-01 — semeado não é alteração).
     EDITAR-02: na edição, alterado = a PATCH mudaria alguma coisa (a MESMA conta do corpo, contra o gravado). */
  const semEmpresa = ({ empresa_id: _empresa, ...resto }: Cabecalho) => resto;
  const alterado = modoEdicao ? mudouAlgo(corpoDaPatch()) : (itens.length > 0 && (!modoReceber || JSON.stringify(itens) !== JSON.stringify(abertura.current?.itens ?? [])))
    || ajustarParcelas || JSON.stringify(semEmpresa(h)) !== JSON.stringify(semEmpresa(inicial.current))
    || (dadosFiscaisAtivos && (CAMPOS_DOS_DADOS_FISCAIS.some((c) => fiscal[c] !== fiscalInicial.current[c])
      || JSON.stringify(rateio) !== JSON.stringify(rateioInicial.current)));
  useDirtyTab(alterado && !salvarM.isSuccess);
  React.useEffect(() => {
    if (modoReceber && preenchimento && !abertura.current) abertura.current = { h: inicial.current, itens: linhasDoRecebimento(recebendo?.pedido.itens ?? []) };
  }, [modoReceber, preenchimento, recebendo]);

  const voltarAoLancador = () => router.replace(adaptador.rotas.nova);
  const alterarOperacao = () => { if (alterado) setConfirmarTroca(true); else voltarAoLancador(); };
  const rotaDoPedido = rotaDoDocumento({ id: pedidoId, especie: "pedido" });
  /** DESCARTAR: zero escrita. Criação → volta à abertura; receber → volta ao pedido; edição → volta à consulta. */
  const descartar = () => {
    if (modoReceber) { router.push(rotaDoPedido); return; }
    if (modoEdicao) { edicao.onFechar(false); return; }
    setH({ ...inicial.current, empresa_id: inicial.current.empresa_id || empresaPadrao });
    setItensCru([]); setAjustarParcelas(false); setPlano(defaultPlan()); setFiscal({ ...fiscalInicial.current }); setRateio({ ...rateioInicial.current, linhas: rateioInicial.current.linhas.map((l) => ({ ...l })) }); setErros({}); setTentouSalvar(false); setPendenciasAbertas(false);
    local.descartar(); setLocalEscolhidoEm(null); // o local do cabeçalho volta ao padrão (e deixa de ser escolha do operador)
  };

  const rotuloDoPedido = enumLabel("especie_documento_compra", "pedido");
  const codigoDoPedido = recebendo ? String(recebendo.pedido["codigo"] ?? "") : "";
  const codigoEmEdicao = documentoEmEdicao ? String(documentoEmEdicao["codigo"] ?? "") : "";
  const titulo = modoReceber ? `Receber ${rotuloDoPedido.toLowerCase()} ${codigoDoPedido}`.trim()
    : modoEdicao ? `Editar ${tr(variante.chaveI18n).toLowerCase()} ${codigoEmEdicao}`.trim() : `Novo documento · ${tr(variante.chaveI18n)}`;

  const travadoDoLayout = (c: string) => Boolean(layout) && cfg.get(c)?.editavel === false && !padraoInvalido(c)
    && !(exigidosPelaRegra.has(c) && !(Boolean(cfg.get(c)?.valorPadrao) || Boolean(padraoDoCampo(c))) && !(modoReceber && doPedido.current.has(c)));

  const topGravada = documentoEmEdicao && typeof documentoEmEdicao["tipo_operacao"] === "object" && documentoEmEdicao["tipo_operacao"] !== null
    ? documentoEmEdicao["tipo_operacao"] as { codigo?: unknown; nome?: unknown } : null;
  const topInfo = recebendo
    ? { id: top, codigo: recebendo.passo.codigo, nome: recebendo.passo.nome, movimento: recebendo.passo.familiaRotulo }
    : modoEdicao ? { id: top, codigo: String(topGravada?.codigo ?? ""), nome: String(topGravada?.nome ?? ""), movimento }
      : topDoLancamento ? { id: topDoLancamento.id, codigo: topDoLancamento.code, nome: topDoLancamento.name, movimento } : null;
  /* EDITAR-02: o que a edição trava — no cabeçalho (`campoTravadoNaEdicao`) e em cada linha (`travasDoItem`). */
  const travadoNaEdicao = (c: string) => limites !== null && campoTravadoNaEdicao(limites, c);
  const travasDaLinha = React.useMemo(() => travasDaLinhaNaTela(limites), [limites]);

  return {
    modo: modoReceber ? "receber" : modoEdicao ? "edicao" : "criacao", variante, adaptador, ehCompra, familia, estadoTop: estado, escritaTopConfirmada, top: topInfo, titulo,
    pedidoId, recebimento, recebendo, emPartes: recebendo?.passo.emPartes === true, rotuloDoPedido, codigoDoPedido, rotaDoPedido,
    mostrarFormulario: !modoReceber || Boolean(recebendo),
    cabecalho: h, mudar, itens, setItens, ajustarParcelas, setAjustarParcelas, plano, setPlano, totalItens, totalExibido, lote,
    mostrarFiscal, editarFiscal, mostrarRateio, editarRateio, dadosFiscaisAtivos, fiscal, mudarFiscal,
    rateio, mudarTipoDoRateio, mudarLinhaDoRateio, adicionarLinhaDoRateio, removerLinhaDoRateio,
    ativarRateioPorValor, usarClassificacaoUnica, aplicarRateioIndependente, mudarClassificacaoDoItem,
    layoutAtivo, layout, layoutQ, layoutPendente, layoutNaoCarregado, layoutVale, padroes, regras, regrasPendente, exigidosPelaRegra, condicoesPermitidas,
    zonas, forcados: desenho?.forcados ?? new Set<string>(), cfg,
    rotulo: (c, hoje) => cfg.get(c)?.rotulo || hoje,
    obrigatorio: (c) => (layout ? Boolean(cfg.get(c)?.obrigatorio) : doSistema.has(c)) || exigidosPelaRegra.has(c),
    // LANCAMENTO-01: OR com a TOP que não deixa trocar (o layout continua decidindo a trava dele, intacta)
    // EDITAR-02: OR com o que a edição trava (a empresa; o resto pelos limites do servidor)
    travado: (c) => travadoDoLayout(c) || travadoPelaTopNaTela(c) || travadoNaEdicao(c),
    padraoDoCampo,
    padraoInvalido: (c) => padraoInvalido(c) || padraoDaTopInvalido(aplicaATop, padroesDaTop, c),
    dica: (c) => {
      // o padrão de cadastro do layout tem prioridade enquanto o valor é o dele; senão, o da TOP enquanto é o dela
      if (c !== "tipo_titulo_id") { const p = padraoDoCampo(c); if (p && h[c] === p.id) return p.rotulo; }
      return dicaDaTop({ aplica: aplicaATop, padroes: padroesTop, campo: c, valor: valorNaTela(c) });
    },
    semeadoPelaTop: semeadoPelaTopNaTela, travadoPelaTop: travadoPelaTopNaTela,
    doPedido: (c) => modoReceber && doPedido.current.has(c),
    colunasDoLayout, fieldsDosItens,
    localNaGrade, localDoCabecalho: localNaGrade ? local.local : null, escolherLocal,
    erro, errosDaTela, errosDeItens, pendencias, pendenciasAbertas, setPendenciasAbertas,
    // EDITAR-02: a PATCH não confirma (P4 da 313) — na edição, "Salvar", nunca "Salvar e confirmar".
    rotuloDoSalvar: rotuloDoSalvar(regras?.regrasGerais, can("compras.edit") && !modoEdicao),
    travaDoSalvar, salvarDesabilitado: travaDoSalvar !== null, salvando: salvarM.isPending, salvar,
    podeConfirmarNaCriacao: ehCompra && !modoReceber && !modoEdicao,
    corpo,
    alterado, descartar, alterarOperacao, voltarAoLancador, confirmarTroca, setConfirmarTroca,
    voltar: () => { if (modoEdicao) { edicao.onFechar(false); return; } router.push(modoReceber ? rotaDoPedido : adaptador.rotas.lista); },
    copiaAplicada: copia !== null,
    documentoEmEdicao, travadoNaEdicao, travasDaLinha, aceitaLinhaNova: limites === null || limites.itemNovo === null,
    motivoNaEdicao: (c) => (limites !== null ? motivoDaTravaNaEdicao(limites, c) : null),
    conflito, fecharConflito: () => setConflito(null),
    recarregarEdicao: () => { setConflito(null); if (modoEdicao) edicao.recarregar(); }
  };
}

/* ═════════════════════════════ A ABERTURA DA EDIÇÃO ═════════════════════════════ */

/**
 * EDITAR-02 (decisão 313) — o que a consulta precisa para trocar, NO LUGAR, para o formulário de edição: o `GET /edicao`
 * (uma ida só: o documento, a versão, os limites, as regras da versão CONGELADA e o layout de hoje).
 *   · a resposta conferida (`lerEdicao`) e com `podeEditar` ⇒ "pronta": as props do formulário (`useEstadoDaCriacao` em
 *     modo edição) e a `chave` dele — que só muda quando a pessoa RECARREGA (a oferta do conflito de versão);
 *   · `podeEditar` falso ⇒ `onRecusada(motivo)` (a consulta mostra a recusa do servidor e não entra em edição);
 *   · erro, ou resposta fora da forma ⇒ o aviso e `onFechar(false)` (a API anterior: "ainda não está disponível").
 * A leitura que abriu o formulário fica CONGELADA nele: uma releitura em segundo plano (outra aba que salvou) nunca troca
 * a versão debaixo do rascunho — só o "Recarregar" faz isso, e descarta o rascunho de propósito.
 */
export type AberturaDaEdicaoNaConsulta =
  | { situacao: "carregando" }
  | { situacao: "pronta"; chave: string; props: PropsDoEstadoDaCriacao };

/** Lê o `/edicao` do cache do React Query (mesmo key da abertura) — evita tela "Carregando…" ao clicar Editar. */
function edicaoProntaDoCache(qc: ReturnType<typeof useQueryClient>, segmento: string, id: string, leitura: number): EdicaoDoDocumentoDeCompra | null {
  const cru = qc.getQueryData([...chaveDaEdicao(segmento, id), leitura]);
  if (cru === undefined) return null;
  const lida = lerEdicao(cru);
  return lida && lida.podeEditar ? lida : null;
}

export function useAberturaDaEdicao({ variante, id, onFechar, onRecusada }: {
  variante: VarianteDeCompra; id: string; onFechar: (salvou: boolean) => void; onRecusada: (motivo: string) => void;
}): AberturaDaEdicaoNaConsulta {
  const tr = useTradutor(); const { can } = useAuth(); const qc = useQueryClient();
  const rotulo = tr(variante.chaveI18n);
  const adaptador = React.useMemo(() => adaptadorDaCentralDeCompras(variante, rotulo), [variante, rotulo]);
  /** O número da leitura pedida: o "Recarregar" pede outra (chave nova ⇒ pergunta nova, nunca a do cache). */
  const [leitura, setLeitura] = React.useState(0);
  const q = useQuery<unknown, ApiError>({
    queryKey: [...chaveDaEdicao(variante.segmento, id), leitura],
    queryFn: () => api<unknown>(portaDaEdicao(variante.segmento, id)),
    /* gcTime > 0: o prefetch do "Editar" precisa sobreviver até este hook montar (gcTime 0 apagava o cache). */
    retry: false, staleTime: Infinity, gcTime: 60_000, refetchOnWindowFocus: false, refetchOnReconnect: false
  });
  /* Prefetch do "Editar" deixa o cache quente: a 1ª pintura já abre o formulário, sem moldura vazia. */
  const [aberta, setAberta] = React.useState<{ dados: EdicaoDoDocumentoDeCompra; leitura: number } | null>(() => {
    const doCache = edicaoProntaDoCache(qc, variante.segmento, id, 0);
    return doCache ? { dados: doCache, leitura: 0 } : null;
  });
  const tratada = React.useRef<unknown>(aberta ? qc.getQueryData([...chaveDaEdicao(variante.segmento, id), 0]) ?? null : null);
  React.useEffect(() => {
    if (q.isError) {
      if (tratada.current === q.error) return;
      tratada.current = q.error;
      toast.error(edicaoIndisponivel(q.error) ? MSG_EDICAO_INDISPONIVEL : q.error.message);
      onFechar(false);
      return;
    }
    if (q.data === undefined || tratada.current === q.data) return;
    tratada.current = q.data;
    const lida = lerEdicao(q.data);
    if (!lida) { toast.error(MSG_EDICAO_INDISPONIVEL); onFechar(false); return; }
    if (!lida.podeEditar) { toast.warning(lida.motivo ?? MSG_EDICAO_INDISPONIVEL); onRecusada(lida.motivo ?? MSG_EDICAO_INDISPONIVEL); return; }
    setAberta({ dados: lida, leitura });
  }, [q.isError, q.error, q.data, leitura, onFechar, onRecusada]);
  const recarregar = React.useCallback(() => {
    // a consulta embaixo também é relida (ela é o que aparece ao voltar)
    void invalidarLeiturasDeCompras(qc);
    setLeitura((n) => n + 1);
  }, [qc]);
  if (!aberta || aberta.leitura !== leitura) return { situacao: "carregando" };
  return {
    situacao: "pronta",
    chave: `edicao:${id}:${aberta.leitura}`,
    props: {
      variante, adaptador, estado: { situacao: "carregando" }, podeCriar: can(`${variante.perm}.create`), pedidoId: "", topDaUrl: "", top: null,
      escritaTopConfirmada: true, edicao: { dados: aberta.dados, onFechar, recarregar }
    }
  };
}

/* ═════════════════════════════ ESTADO DA CONSULTA ═════════════════════════════ */

export type DocumentoDeCompra = Row & { itens?: Row[]; titulos?: Row[]; movimentos?: Row[] };

/** Quem fez e quando (a data como o servidor a manda; o nome vazio quando ele não o declara). */
export interface QuemEQuando { em: string; porNome: string }

/**
 * Uma ação do PEDIDO com diálogo (OPERACOES-01 F6b, decisão 283): Finalizar e Aprovar para orçamento. `can()` e a
 * situação só decidem o que a tela OFERECE; quem recusa é o servidor (a porta, a guarda da 0044).
 */
export interface AcaoDoPedido {
  /** A pílula aparece (a capacidade "sim", a espécie, a permissão e, conforme a ação, a situação). */
  visivel: boolean;
  /** null = habilitada; texto = a dica da pílula desabilitada. */
  dicaDesabilitada: string | null;
  /** O diálogo está aberto. */
  aberto: boolean;
  /** Abre o diálogo — só com a pílula habilitada (a MESMA regra do `disabled`, conferida no handler). */
  abrir: () => void;
  fechar: () => void;
  /** O POST (corpo vazio, Idempotency-Key). */
  executar: () => void;
  ocupado: boolean;
}

/** Uma TOP do leque de orçamento do pedido, com a rota da criação do orçamento (só as que a tela sabe endereçar). */
export interface OpcaoDeNovoOrcamento { top: TopDoLequeDeOrcamento; rota: string }

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

  /*
   * OPERACOES-01 F6b (decisão 283) — o pedido finalizado, o aprovado para orçamento e o orçamento. Tudo o que é novo
   * depende da capacidade "sim" (a API declara `finalizacaoEOrcamento`); "carregando" e "nao" mostram a consulta de
   * hoje, e nenhuma rota nova é perguntada. Aceitar o pedido `finalizado` (receber, encerrar o saldo, cancelar) e ler
   * `exigeFinalizar` valem sempre: a API anterior nunca os manda.
   */
  /** A capacidade `finalizacaoEOrcamento` declarada pela API de compras. */
  capacidade: EstadoDaCapacidade;
  /** O pedido está aberto ou finalizado: recebe, encerra o saldo e se cancela. */
  pedidoEmAndamento: boolean;
  /** A TOP do pedido só deixa receber o pedido finalizado (`exigeFinalizar` dos próximos passos; ausente = false). */
  exigeFinalizar: boolean;
  /** Quem finalizou o pedido e quando — null sem a data ou sem a capacidade. */
  finalizacao: QuemEQuando | null;
  /** Quem aprovou o pedido para orçamento e quando — null sem a data ou sem a capacidade. */
  aprovadoOrcamento: QuemEQuando | null;
  /** FINALIZAR: com `pedidos_compra.edit`; habilitado só no pedido aberto. O diálogo mostra a prévia do servidor. */
  finalizar: AcaoDoPedido;
  /** APROVAR PARA ORÇAMENTO: com `compras.edit` e a leitura do pedido, no pedido aberto ainda não aprovado. */
  aprovarParaOrcamento: AcaoDoPedido;
  /**
   * NOVO ORÇAMENTO: com `orcamentos_compra.create`, no pedido aberto e aprovado para orçamento. Habilitado com o leque
   * de TOPs de orçamento pronto e sem orçamento vencedor; `opcoes` são as TOPs do leque com a rota da criação.
   */
  novoOrcamento: { visivel: boolean; dicaDesabilitada: string | null; opcoes: OpcaoDeNovoOrcamento[] };

  /*
   * EDITAR-02 (decisão 313) — EDITAR o pedido e a compra: a Central de criação em modo edição, NO LUGAR (sem rota nova).
   * A ação aparece com `<recurso>.edit` E `<recurso>.view`; desabilitada com o motivo no que a consulta já sabe
   * (`acaoEditar`). Quem decide é o servidor: o `GET /edicao` responde `podeEditar`/`motivo` (a MESMA pergunta da PATCH).
   */
  editar: AcaoEditar & {
    /** O formulário de edição está aberto (no lugar da consulta). */
    editando: boolean;
    /** Abre a edição — só com a ação habilitada (a MESMA regra do `disabled`, conferida no handler). */
    abrir: () => void;
    /** Volta à consulta; `salvou` = a PATCH gravou (a consulta mostra o "Salvo ✓"). */
    fechar: (salvou: boolean) => void;
    /** O `GET /edicao` recusou (`podeEditar` falso): volta à consulta, e a ação fica desabilitada com o motivo dele. */
    recusada: (motivo: string) => void;
  };
  /** A PATCH acabou de gravar (o "Salvo ✓" da consulta, como o que vem da criação). */
  salvoNaEdicao: boolean;
}

const DICA_PEDIDO_COM_COMPRA = "O pedido tem compra não cancelada: cancele a compra antes de cancelar o pedido.";
const DICA_DUPLICAR_COM_ORIGEM = "Compra gerada de um pedido não se duplica: receba o pedido de novo pelos Próximos passos.";
const DICA_DUPLICAR_SEM_TOP = "Documento sem Tipo de Operação não se duplica.";

/** Os textos do Novo orçamento desabilitado enquanto o leque não está pronto. */
const DICA_LEQUE_CARREGANDO = "Carregando as operações de orçamento…";
const DICA_LEQUE_INDISPONIVEL = "As operações de orçamento estão indisponíveis nesta versão do servidor.";

/**
 * A dica do Novo orçamento desabilitado (null = habilitado). O vencedor primeiro (o pedido já foi decidido, qualquer
 * que seja o leque); depois o leque, na ordem em que ele chega.
 */
function dicaDoNovoOrcamento(temVencedor: boolean, leque: EstadoDoLequeDeOrcamentos, opcoes: OpcaoDeNovoOrcamento[]): string | null {
  if (temVencedor) return MSG_PEDIDO_JA_TEM_VENCEDOR;
  switch (leque.situacao) {
    case "carregando": return DICA_LEQUE_CARREGANDO;
    case "indisponivel": return DICA_LEQUE_INDISPONIVEL;
    case "erro": return leque.mensagem;
    case "pronto": return opcoes.length ? null : MSG_PEDIDO_SEM_TOP_DE_ORCAMENTO;
  }
}

export function useEstadoDaConsulta({ variante, id }: { variante: VarianteDeCompra; id: string }): EstadoDaConsulta {
  const { can } = useAuth(); const tr = useTradutor(); const qc = useQueryClient();
  // Só o PEDIDO usa a capacidade da F6: a consulta da compra não pergunta as portas por ela.
  const capacidade = useFinalizacaoEOrcamento(variante.variante === "pedido");
  const rotulo = tr(variante.chaveI18n);
  const adaptador = React.useMemo(() => adaptadorDaCentralDeCompras(variante, rotulo), [variante, rotulo]);
  const porta = adaptador.rotas.porta(id);
  const q = useDoc<DocumentoDeCompra>(porta);

  /* O "Salvo" e o pedido de Confirmar vindos da criação: lidos uma vez, da memória. O diálogo NÃO nasce aberto: o pedido
     só é atendido depois do documento carregado (efeito abaixo), com a mesma conferência da pílula. */
  const [salvo] = React.useState(() => consumirSalvo(chaveDepoisDeSalvarDeCompra, id));
  React.useEffect(() => { if (salvo) descartarSalvo(chaveDepoisDeSalvarDeCompra, id); }, [salvo, id]);
  const [confirmando, setConfirmando] = React.useState(false);
  const [cancelando, setCancelando] = React.useState(false);
  const [encerrando, setEncerrando] = React.useState(false);
  const [finalizando, setFinalizando] = React.useState(false);
  const [aprovandoParaOrcamento, setAprovandoParaOrcamento] = React.useState(false);
  /* EDITAR-02: a edição no lugar e a recusa que o `/edicao` deu (vale até o documento ser lido de novo). */
  const [editando, setEditando] = React.useState(false);
  const [recusaDaEdicao, setRecusaDaEdicao] = React.useState<{ motivo: string; leitura: number } | null>(null);
  const [salvoNaEdicao, setSalvoNaEdicao] = React.useState(false);
  // Uma chave por ação, a MESMA até o servidor RECUSAR (`trocaAChaveDeIdempotencia`): na queda de rede o reenvio repete
  // a chave e recebe a resposta gravada — a ação nunca acontece duas vezes.
  const chaveConfirmar = useChaveDeIdempotencia();
  const chaveCancelar = useChaveDeIdempotencia();
  const chaveEncerrar = useChaveDeIdempotencia();
  const chaveFinalizar = useChaveDeIdempotencia();
  const chaveAprovarParaOrcamento = useChaveDeIdempotencia();
  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: ["docone", porta] });
    void qc.invalidateQueries({ queryKey: ["compras-previa-confirmacao", id] });
    void qc.invalidateQueries({ queryKey: ["compras-proximos-passos", variante.segmento, id] });
  };

  const confirmarM = useMutation({
    mutationFn: () => api(`/api/compras/compras/${id}/confirm`, { method: "POST", idempotencyKey: chaveConfirmar.doEnvio(undefined) }),
    onSuccess: () => { toast.success("Compra confirmada"); setConfirmando(false); recarregar(); },
    onError: (e) => { toast.error(chaveConfirmar.depoisDoErro(e)); recarregar(); }
  });
  const cancelarM = useMutation({
    mutationFn: (motivo: string) => { const c = corpoDoCancelamento(motivo); return api(`/api/compras/${variante.segmento}/${id}/cancel`, { method: "POST", body: c, idempotencyKey: chaveCancelar.doEnvio(c) }); },
    onSuccess: () => { toast.success("Documento cancelado"); setCancelando(false); recarregar(); },
    onError: (e) => { toast.error(chaveCancelar.depoisDoErro(e)); }
  });
  const encerrarM = useMutation({
    mutationFn: (motivo: string) => { const c = { motivo }; return api(`/api/compras/${variante.segmento}/${id}/encerrar-saldo`, { method: "POST", body: c, idempotencyKey: chaveEncerrar.doEnvio(c) }); },
    onSuccess: () => { toast.success("Saldo encerrado"); setEncerrando(false); recarregar(); },
    onError: (e) => { toast.error(chaveEncerrar.depoisDoErro(e)); }
  });
  /* FINALIZAR e APROVAR PARA ORÇAMENTO (F6b): corpo vazio, a chave da ação, e o que é de documento de compra perguntado
     de novo depois (`invalidarLeiturasDeCompras`) — a situação, a aprovação, a prévia, os próximos passos e o leque
     mudam juntos. No erro o diálogo de Finalizar fica aberto, e a prévia recarregada diz o porquê. */
  const finalizarM = useMutation({
    mutationFn: () => api(`/api/compras/pedidos/${id}/finalizar`, { method: "POST", body: {}, idempotencyKey: chaveFinalizar.doEnvio({}) }),
    onSuccess: () => { toast.success("Pedido finalizado"); setFinalizando(false); void invalidarLeiturasDeCompras(qc); },
    onError: (e) => { toast.error(chaveFinalizar.depoisDoErro(e)); void invalidarLeiturasDeCompras(qc); }
  });
  const aprovarParaOrcamentoM = useMutation({
    mutationFn: () => api(`/api/compras/pedidos/${id}/aprovar-para-orcamento`, { method: "POST", body: {}, idempotencyKey: chaveAprovarParaOrcamento.doEnvio({}) }),
    onSuccess: () => { toast.success("Pedido aprovado para orçamento"); setAprovandoParaOrcamento(false); void invalidarLeiturasDeCompras(qc); },
    onError: (e) => { toast.error(chaveAprovarParaOrcamento.depoisDoErro(e)); void invalidarLeiturasDeCompras(qc); }
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
  // O pedido ABERTO ou FINALIZADO (F6a) recebe, encerra o saldo e se cancela; a API anterior nunca manda o finalizado.
  const pedidoEmAndamento = ehPedido && SITUACOES_DO_PEDIDO_EM_ANDAMENTO.includes(situacao);
  const podeReceber = pedidoEmAndamento && can(`${variante.perm}.edit`) && Boolean(varianteDaCompra) && can(`${varianteDaCompra?.perm ?? ""}.create`);
  const passos = useProximosPassosDoPedido(variante.segmento, id, podeReceber);
  const exigeFinalizar = passos.situacao === "pronto" && passos.exigeFinalizar;
  const podeEncerrarSaldo = pedidoEmAndamento && recebimentoDeclarado && comCompraViva && pedidoTemSaldo(itens) && can(`${variante.perm}.edit`);
  /* O DIÁLOGO DE CONFIRMAR só abre em documento ABERTO e para quem pode confirmar — a regra ÚNICA do motor
     (`confirmarPodeAbrir`), para a pílula e para a chegada da criação. */
  const documentoAberto = situacao === "aberto";
  const confirmaPelaCapacidade = ehCompra && can("compras.edit");
  const podeConfirmar = confirmarPodeAbrir(documentoAberto, confirmaPelaCapacidade);
  /* CONFIRMAR PEDIDO NA CRIAÇÃO (como na venda): atendido UMA vez, com o documento carregado, e só se a compra AINDA
     pode ser confirmada (situação "aberto" e `compras.edit`). Chegou confirmada (ou noutra situação — inclusive pelo
     "Salvar e confirmar" da TOP de Confirmação Automática): o diálogo não abre. */
  const pedidoDeConfirmarTratado = React.useRef(false);
  React.useEffect(() => {
    if (!d || pedidoDeConfirmarTratado.current) return;
    pedidoDeConfirmarTratado.current = true;
    if (abreConfirmarNaChegada(salvo, documentoAberto, confirmaPelaCapacidade)) setConfirmando(true);
  }, [d, salvo, documentoAberto, confirmaPelaCapacidade]);
  const podeCancelar = (situacao === "aberto" || situacao === "confirmado" || (ehPedido && situacao === "finalizado")) && can(`${variante.perm}.delete`);
  const origemId = ehCompra && d && typeof d["origem_documento_id"] === "string" ? d["origem_documento_id"] : "";
  const saldoEncerradoEm = ehPedido && d && typeof d["saldo_encerrado_em"] === "string" ? d["saldo_encerrado_em"] : "";
  const top = (d?.["tipo_operacao"] as { codigo?: string; nome?: string; versao?: number; id?: string } | null | undefined) ?? null;
  const tipoOperacaoId = d ? String(d["tipo_operacao_id"] ?? top?.id ?? "") : "";
  const dicaDuplicarDesabilitado = origemId ? DICA_DUPLICAR_COM_ORIGEM : d && !tipoOperacaoId ? DICA_DUPLICAR_SEM_TOP : null;

  /* ── O PEDIDO COM A CAPACIDADE DA F6 (decisão 283): nada disto existe sem "sim". ── */
  const comCapacidade = ehPedido && capacidade === "sim";
  const finalizacao = comCapacidade ? finalizacaoDoPedido(d) : null;
  const aprovadoOrcamento = comCapacidade ? aprovadoParaOrcamento(d) : null;
  const pedidoAberto = situacao === "aberto";
  const finalizarVisivel = comCapacidade && can(`${variante.perm}.edit`);
  const dicaFinalizar = pedidoAberto ? null : MSG_FINALIZAR_SO_PEDIDO_ABERTO;
  const aprovarParaOrcamentoVisivel = comCapacidade && can("compras.edit") && can(`${variante.perm}.view`) && pedidoAberto && aprovadoOrcamento === null;
  const varianteDoOrcamento = varianteDeCompra("orcamento");
  const novoOrcamentoVisivel = comCapacidade && Boolean(varianteDoOrcamento) && can(`${varianteDoOrcamento?.perm ?? ""}.create`) && pedidoAberto && aprovadoOrcamento !== null;
  const leque = useLequeDeOrcamentosDoPedido(id, novoOrcamentoVisivel);
  const opcoesDeOrcamento: OpcaoDeNovoOrcamento[] = leque.situacao === "pronto"
    ? leque.tops.flatMap((t) => { const rota = rotaDoNovoOrcamento(id, t.tipoOperacaoId); return rota ? [{ top: t, rota }] : []; })
    : [];
  // Sem a lista de orçamentos na leitura (sem `orcamentos_compra.view`) a tela não sabe do vencedor: o servidor recusa.
  const temVencedor = (orcamentosDoPedido(d) ?? []).some((o) => o.situacao === "escolhido");
  const finalizar: AcaoDoPedido = {
    visivel: finalizarVisivel, dicaDesabilitada: dicaFinalizar, aberto: finalizando,
    abrir: () => { if (finalizarVisivel && dicaFinalizar === null && !finalizarM.isPending) setFinalizando(true); },
    fechar: () => setFinalizando(false),
    executar: () => { if (finalizarVisivel && dicaFinalizar === null) finalizarM.mutate(); },
    ocupado: finalizarM.isPending
  };
  const aprovarParaOrcamento: AcaoDoPedido = {
    visivel: aprovarParaOrcamentoVisivel, dicaDesabilitada: null, aberto: aprovandoParaOrcamento,
    abrir: () => { if (aprovarParaOrcamentoVisivel && !aprovarParaOrcamentoM.isPending) setAprovandoParaOrcamento(true); },
    fechar: () => setAprovandoParaOrcamento(false),
    executar: () => { if (aprovarParaOrcamentoVisivel) aprovarParaOrcamentoM.mutate(); },
    ocupado: aprovarParaOrcamentoM.isPending
  };

  /* ── EDITAR-02 (decisão 313): o "Editar" do pedido e da compra. ── */
  // a recusa do `/edicao` vale para a LEITURA em que foi dada: o documento relido (outra aba, um cancelamento) a apaga
  const recusaVigente = recusaDaEdicao && recusaDaEdicao.leitura === q.dataUpdatedAt ? recusaDaEdicao.motivo : null;
  const acao = acaoEditar({
    can, perm: variante.perm, carregado: Boolean(d), situacao, ehPedido, comprasGeradas, recusaDoServidor: recusaVigente
  });
  /** Prefetch do `/edicao` ANTES de trocar a árvore — a consulta fica na tela; sem moldura "Carregando…". */
  const [abrindoEdicao, setAbrindoEdicao] = React.useState(false);
  const editar: EstadoDaConsulta["editar"] = {
    ...acao,
    dicaDesabilitada: abrindoEdicao ? "Abrindo a edição…" : acao.dicaDesabilitada,
    editando,
    abrir: () => {
      if (!(acao.visivel && acao.dicaDesabilitada === null) || abrindoEdicao) return;
      setSalvoNaEdicao(false);
      setAbrindoEdicao(true);
      void qc.fetchQuery({
        queryKey: [...chaveDaEdicao(variante.segmento, id), 0],
        queryFn: () => api<unknown>(portaDaEdicao(variante.segmento, id)),
        staleTime: Infinity, gcTime: 60_000,
      }).then((data) => {
        const lida = lerEdicao(data);
        if (!lida) { toast.error(MSG_EDICAO_INDISPONIVEL); return; }
        if (!lida.podeEditar) {
          toast.warning(lida.motivo ?? MSG_EDICAO_INDISPONIVEL);
          setRecusaDaEdicao({ motivo: lida.motivo ?? MSG_EDICAO_INDISPONIVEL, leitura: q.dataUpdatedAt });
          return;
        }
        setEditando(true);
      }).catch((err: unknown) => {
        const e = err as ApiError;
        toast.error(edicaoIndisponivel(e) ? MSG_EDICAO_INDISPONIVEL : (e?.message || MSG_EDICAO_INDISPONIVEL));
      }).finally(() => { setAbrindoEdicao(false); });
    },
    fechar: (salvou) => { setEditando(false); setSalvoNaEdicao(salvou); if (salvou) recarregar(); },
    recusada: (motivo) => { setEditando(false); setRecusaDaEdicao({ motivo, leitura: q.dataUpdatedAt }); }
  };

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
      // O pedido FINALIZADO (F6a) já foi confirmado: cancelá-lo impede o recebimento.
      : ehPedido && situacao === "finalizado"
        ? "O pedido finalizado passa a cancelado e não pode mais ser recebido."
        : "O documento passa a cancelado e não pode mais ser confirmado.",
    salvoAgora: salvo !== null,
    recarregar,
    capacidade, pedidoEmAndamento, exigeFinalizar, finalizacao, aprovadoOrcamento, finalizar, aprovarParaOrcamento,
    novoOrcamento: { visivel: novoOrcamentoVisivel, dicaDesabilitada: dicaDoNovoOrcamento(temVencedor, leque, opcoesDeOrcamento), opcoes: opcoesDeOrcamento },
    editar, salvoNaEdicao
  };
}
