"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CAMPOS_DESTINO_ESTOQUE, LAYOUT_DO_SISTEMA, LIMITE_CUSTO_ESTOQUE, LIMITE_QUANTIDADE_ESTOQUE, RECURSO_DA_ESPECIE_ESTOQUE, catalogoDaFamilia,
  entendeMovimentacaoInterna, recusasDoDestinoPelaTop, recusasDoFluxoDoConsumo,
  type CampoDoLayout, type ColunaDestinoEstoque, type ColunaDoLayout, type DimensaoDestinoEstoque, type EspecieEstoque, type EstruturaLayout,
  type RegrasDaOperacaoDoEstoque
} from "@agro/domain";
import { D } from "@agro/shared";
import { api, newIdem } from "@/lib/api";
import { empresasDoContexto, useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { useTradutor } from "@/lib/i18n";
import { todayISO } from "@/lib/utils";
import { useDirtyTab } from "@/lib/workspace-tabs";
import { useEmpresaPadrao, type ItemRow } from "@/features/docs/shared";
import { entendeLayoutDocumento, podeLancar, type EstadoTop, type TopOperacional } from "@/features/sales/tipo-operacao-select";
import { entendeRegrasDaOperacao } from "@/features/sales/regras-da-operacao";
import { topSelecionada } from "@/features/sales/lancador-tipo-operacao";
import type { AdaptadorDaCentral, CopiaEmMemoria, DepoisDeSalvar, LocalDeEstoque, Pendencia } from "@/features/central/contrato";
import { descartarCopia, espiarCopia } from "@/features/central/duplicar-memoria";
import { entregarSalvo } from "@/features/central/salvo";
import { avisarSalvo, type RespostaDoSalvar } from "@/features/central/salvar";
import { rotuloDoSalvar } from "@/features/central/regras-gerais";
import { valorDoPadrao, type LayoutQueVale } from "@/features/compras/layout-da-central";
import {
  CHAVES_DO_PREENCHIMENTO_DE_ESTOQUE, preenchimentoDaUrlDeEstoque, rotaDeLancamentoDeEstoque, useTopsDaEspecieEstoque,
  type PreenchimentoDoLancamentoDeEstoque, type VarianteDeEstoque
} from "../movimentacoes-variantes";
import { descreverCaminhoDeItem, errosDoServidor, numeroDoCampo, rotuloDoErro } from "../central-estoque-campos";
import { adaptadorDaCentralDeEstoque, chaveDaCopiaDeEstoque, chaveDepoisDeSalvarDeEstoque, colunasDoLayoutDoEstoque } from "./adaptador";
import { formaDaEspecieNaCentral, type FormaDaEspecieNaCentral } from "./forma";
import { useControleDeLote, type ControleDeLote } from "./lote";
import { useLayoutDoEstoque, useRegrasDaOperacaoDoEstoque } from "./regras";
import {
  destinoDaOrigem, linhasDaOrigem, rotuloDoCampoDaOrigem, rotuloDoDocumentoDeOrigem, useOrigemDoEstoque, type DocumentoDeOrigem, type EstadoDaOrigem
} from "./origem";
import type { DimensaoDoDestinoNaTela } from "./destino";

/**
 * O ESTADO DA CRIAÇÃO NA CENTRAL DE ESTOQUE (OPERACOES-01 F5b, decisão 282) — sem JSX. As peças da Central montada sobre
 * o motor (`@/features/central`) só DESENHAM: o que vai no corpo do POST, quando o Salvar trava, o que é pendência, o
 * que conta como "alterado", a origem, o destino e o layout moram aqui. O molde é `features/compras/central/estado.ts`.
 *
 *   useEntradaDaCentralDeEstoque — lançador × formulário (a TOP da URL é PEDIDO; a trava da sessão; a cópia do Duplicar).
 *   useEstadoDaCriacaoDeEstoque  — o formulário: cabeçalho, itens, layout, regras, origem, destino, pendências, salvar.
 *   conferirLancamentoDeEstoque  — PURA: as pendências (as mesmas regras do servidor) e o corpo do POST.
 *
 * O servidor é a autoridade: a tela só não oferece o que o contrato recusaria e cobra antes o que ele cobraria, pelas
 * MESMAS funções do domínio (`conferirNumeroEstoque` via `numeroDoCampo`, `recusasDoDestinoPelaTop`,
 * `recusasDoFluxoDoConsumo`) e com as MESMAS mensagens da API. O 422 cai no campo que o servidor apontou.
 */

/* ═════════════════════════════════════ Tipos ═════════════════════════════════════ */

export type CabecalhoDeEstoque = {
  empresa_id: string; armazem_id: string; armazem_destino_id: string; data_documento: string; observacao: string;
  origem_documento_id: string; motivo_saida: string; justificativa: string;
} & Record<ColunaDestinoEstoque, string>;

/** O cabeçalho vazio: a data de hoje; nenhuma dimensão do destino. */
export function cabecalhoVazio(): CabecalhoDeEstoque {
  const destino = Object.fromEntries(CAMPOS_DESTINO_ESTOQUE.map((c) => [c.coluna, ""])) as Record<ColunaDestinoEstoque, string>;
  return { empresa_id: "", armazem_id: "", armazem_destino_id: "", data_documento: todayISO(), observacao: "", origem_documento_id: "", motivo_saida: "", justificativa: "", ...destino };
}

/** O que a cópia do Duplicar leva: os valores do cabeçalho e os rótulos das escolhas (nada é relido para mostrar). */
export interface CabecalhoCopiadoDeEstoque { valores: Partial<CabecalhoDeEstoque>; rotulos: Record<string, string> }
export type CopiaDeEstoque = CopiaEmMemoria<CabecalhoCopiadoDeEstoque>;

/** Por que o Salvar está DESABILITADO por estado (não por pendência). null: habilitado. */
export type TravaDoSalvar = null | "salvando" | "top-nao-confirmada" | "layout-carregando" | "layout-falhou" | "regras-carregando" | "regras-falharam" | "origem-carregando";

/** As capacidades que a API declarou no `operation-types` da espécie — lidas UMA vez, ao montar o formulário. */
interface CapacidadesDaSessao { mi: boolean; layout: boolean; regras: boolean }

function capacidadesDaSessao(estado: EstadoTop): CapacidadesDaSessao {
  const capacidades = estado.situacao === "pronto" && "capacidades" in estado.dados ? estado.dados.capacidades : undefined;
  return { mi: entendeMovimentacaoInterna(capacidades), layout: entendeLayoutDocumento(estado), regras: entendeRegrasDaOperacao(estado) };
}

/* ═════════════════════════════ CONFERÊNCIA (pura) ═════════════════════════════ */

/** O destino herdado da origem, por coluna (o consumo herda o da requisição): o id e o nome lido. */
export type DestinoHerdado = Partial<Record<ColunaDestinoEstoque, { id: string; nome: string }>>;

export interface EntradaDaConferencia {
  forma: FormaDaEspecieNaCentral;
  topId: string;
  cabecalho: CabecalhoDeEstoque;
  itens: readonly ItemRow[];
  lote: ControleDeLote;
  /** As regras da TOP lidas (null: sem a capacidade — o neutro, o comportamento de antes). */
  regras: RegrasDaOperacaoDoEstoque | null;
  /** A origem APLICADA (o documento), ou null. */
  origem: DocumentoDeOrigem | null;
  herdados: DestinoHerdado;
  /** O rótulo de um campo do cabeçalho na tela (o do layout ou o do catálogo). */
  rotuloDoCampo: (campo: string) => string;
}

const texto = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
/** Um decimal de texto canônico, ou `null` (texto que não é número não entra em conta nenhuma). */
const decimalOuNulo = (v: string) => (/^\d+(\.\d+)?$/.test(v) ? D(v) : null);

/**
 * AS PENDÊNCIAS E O CORPO DO POST — a mesma conferência para o clique (zero POST com pendência) e para o envio.
 *
 * Pendências, cada uma com o caminho do campo (o que o 422 do servidor usaria), o rótulo e a mensagem — a da API onde
 * ela tem mensagem: itens; empresa; local(is) de estoque; data; por item o produto, a quantidade (a contada no ajuste) e
 * o custo (`numeroDoCampo`: a MESMA conferência do domínio que a API usa); a origem (a devolução sempre; o consumo
 * quando a seção Fluxo exige — `recusasDoFluxoDoConsumo`); o destino pela seção Destino (`recusasDoDestinoPelaTop`);
 * motivo e justificativa da saída (com a capacidade: a tela os exige, o servidor ainda não — I-1 da F5a); a observação
 * que a TOP exige.
 *
 * O corpo: campo vazio NÃO viaja (o contrato é estrito); números no texto canônico; sem a capacidade da movimentação
 * interna, exatamente as chaves de antes. O destino HERDADO não viaja (o servidor herda); o local de estoque das linhas
 * é estado da tela e nunca vai por item.
 */
export function conferirLancamentoDeEstoque(x: EntradaDaConferencia): { pendencias: Pendencia[]; corpo: Record<string, unknown> } {
  const { forma: f, cabecalho: h } = x;
  const pendencias: Pendencia[] = [];
  const falta = (caminho: string, mensagem: string, rotulo = x.rotuloDoCampo(caminho)) => {
    if (!pendencias.some((p) => p.caminho === caminho)) pendencias.push({ caminho, rotulo, mensagem });
  };
  if (!x.itens.length) falta("itens", "Inclua ao menos um item.", "Itens");
  if (!h.empresa_id) falta("empresa_id", "Informe a empresa");
  if (!h.armazem_id) falta("armazem_id", f.localDeDestino ? "Informe o local de estoque de origem" : "Informe o local de estoque");
  if (f.localDeDestino) {
    if (!h.armazem_destino_id) falta("armazem_destino_id", "Informe o local de estoque de destino da transferência");
    else if (h.armazem_destino_id === h.armazem_id) falta("armazem_destino_id", "O local de estoque de destino tem de ser diferente do local de estoque de origem");
  }
  if (!h.data_documento) falta("data_documento", "Informe a data do documento");

  // A ORIGEM: obrigatória na devolução de consumo; no consumo, a seção Fluxo da TOP decide (o neutro: lançar direto).
  const temOrigem = x.origem !== null;
  if (f.origemObrigatoria && !temOrigem && f.origem) falta("origem_documento_id", `Informe o ${rotuloDoCampoDaOrigem(f.origem).toLowerCase()}`);
  if (f.especie === "consumo" && x.regras?.fluxo) {
    const levado = new Map<string, ReturnType<typeof D>>();
    x.itens.forEach((it) => {
      const origemItem = texto(it["origem_item_id"]);
      const q = decimalOuNulo(texto(it.quantity));
      if (origemItem && q) levado.set(origemItem, (levado.get(origemItem) ?? D(0)).plus(q));
    });
    const atendeTudo = x.origem !== null && x.origem.itens.every((it) => {
      const saldo = decimalOuNulo(texto(it.saldo_pendente));
      return !saldo || !saldo.gt(0) || (levado.get(it.id) ?? D(0)).eq(saldo);
    });
    for (const r of recusasDoFluxoDoConsumo(x.regras.fluxo, { temOrigem, ligados: x.itens.map((it) => Boolean(texto(it["origem_item_id"]))), atendeTudo })) {
      falta(r.caminho, r.mensagem, r.caminho.startsWith("itens") ? descreverCaminhoDeItem(r.caminho) : x.rotuloDoCampo(r.caminho));
    }
  }

  // O DESTINO pela seção Destino da TOP: o valor FINAL de cada dimensão (o herdado ou o informado) e as informadas.
  const informadas = new Set<DimensaoDestinoEstoque>();
  const destinoDoCorpo: Partial<Record<ColunaDestinoEstoque, string>> = {};
  if (f.destinoInformado) {
    const finais = {} as Record<DimensaoDestinoEstoque, string | null>;
    for (const c of CAMPOS_DESTINO_ESTOQUE) {
      const herdado = x.herdados[c.coluna]?.id ?? null;
      const valor = h[c.coluna];
      if (valor && !herdado) { informadas.add(c.chave); destinoDoCorpo[c.coluna] = valor; }
      finais[c.chave] = herdado ?? (valor || null);
    }
    if (x.regras?.destino) {
      for (const r of recusasDoDestinoPelaTop(x.regras.destino, finais, informadas)) {
        falta(r.coluna, r.mensagem, CAMPOS_DESTINO_ESTOQUE.find((c) => c.coluna === r.coluna)?.rotulo);
      }
    }
  }

  // MOTIVO E JUSTIFICATIVA DA SAÍDA: a tela os exige (decisão D6).
  const justificativa = h.justificativa.trim();
  if (f.motivoDaSaida) {
    if (!h.motivo_saida) falta("motivo_saida", "Informe o motivo da saída", "Motivo");
    if (!justificativa) falta("justificativa", "Informe a justificativa da saída", "Justificativa");
  }
  // A OBSERVAÇÃO que a TOP exige (Exigir observação) — o texto do servidor.
  const observacao = h.observacao.trim();
  if (x.regras?.exigencias.includes("observacao") && !observacao) falta("observacao", "Observação é obrigatório nesta operação.", "Observação");

  const itens = x.itens.map((l, i) => {
    const caminho = (campo: string) => `itens.${i}.${campo}`;
    const noItem = (campo: string, mensagem: string) => falta(caminho(campo), mensagem, descreverCaminhoDeItem(caminho(campo)));
    const item: Record<string, string> = { produto_id: l.product_id };
    if (!l.product_id) noItem("produto_id", "Informe o produto");
    const q = numeroDoCampo(texto(l.quantity), LIMITE_QUANTIDADE_ESTOQUE, f.minimoDaQuantidade, f.faltaQuantidade);
    if (q.ok) item[f.campoDaQuantidade] = q.valor; else noItem(f.campoDaQuantidade, q.mensagem);
    const custo = texto(l.unit_value);
    // O custo vazio só é pendência na entrada SEM a capacidade (o contrato de antes); com ela, vazio é o custo médio.
    if (f.custo === "obrigatorio" || (f.custo === "opcional" && custo.trim() !== "")) {
      const c = numeroDoCampo(custo, LIMITE_CUSTO_ESTOQUE, "naoNegativo", "Informe o custo unitário da entrada");
      if (c.ok) item["custo_unitario"] = c.valor; else noItem("custo_unitario", c.mensagem);
    }
    // Lote e validade só viajam quando a espécie os tem e o produto os controla: o contrato recusa o lote de produto sem lote.
    const controle = x.lote.daLinha(l.product_id);
    const lote = texto(l.provider_lot).trim();
    if (f.lote && controle.lote && lote) item["lote"] = lote;
    const validade = texto(l.expiration_date);
    if (f.validade && controle.validade && validade) item["validade"] = validade;
    const origemItem = texto(l["origem_item_id"]);
    if (temOrigem && origemItem) item["origem_item_id"] = origemItem;
    return item;
  });

  const corpo: Record<string, unknown> = {
    empresa_id: h.empresa_id,
    tipo_operacao_id: x.topId,
    armazem_id: h.armazem_id,
    ...(f.localDeDestino ? { armazem_destino_id: h.armazem_destino_id } : {}),
    data_documento: h.data_documento,
    ...(observacao ? { observacao } : {}),
    ...(temOrigem && x.origem ? { origem_documento_id: x.origem.id } : {}),
    ...destinoDoCorpo,
    ...(f.motivoDaSaida ? { motivo_saida: h.motivo_saida, justificativa } : {}),
    itens
  };
  return { pendencias, corpo };
}

/* ═════════════════════════════ ENTRADA DA CRIAÇÃO ═════════════════════════════ */

export interface PropsDoEstadoDaCriacao {
  variante: VarianteDeEstoque;
  adaptador: AdaptadorDaCentral;
  estado: EstadoTop;
  top: TopOperacional;
  /** A lista de AGORA confirma a TOP? Só isso autoriza o POST. */
  escritaTopConfirmada: boolean;
  /** O preenchimento pela URL (origem, empresa, Local de estoque, produto, lote): PEDIDO. */
  preenchimento: PreenchimentoDoLancamentoDeEstoque;
}

export interface EntradaDaCentralDeEstoque {
  variante: VarianteDeEstoque;
  estado: EstadoTop;
  pedidaNaUrl: string;
  rotuloDaEspecie: string;
  /** Sem `formulario`, a página mostra o lançador. `chave` é a `key` do formulário: trocar a TOP nunca herda o digitado. */
  formulario: null | { chave: string; props: PropsDoEstadoDaCriacao };
  voltarALista: () => void;
  escolherTop: (t: TopOperacional) => void;
}

/** O preenchimento como texto estável (a `key` do formulário e a dependência de memo). */
const preenchimentoComoTexto = (p: PreenchimentoDoLancamentoDeEstoque) => CHAVES_DO_PREENCHIMENTO_DE_ESTOQUE.map((k) => p[k] ?? "").join("|");

/**
 * TOP PRIMEIRO, FORMULÁRIO DEPOIS (o desenho das Centrais de Vendas e de Compras):
 *   sem `?tipo_operacao_id`, ou com uma que a lista da espécie não confirma → o LANÇADOR (o "Continuar" preserva o
 *   preenchimento da URL: a origem, a empresa, o Local de estoque, o produto e o lote);
 *   com a TOP que a lista confirma → o FORMULÁRIO, com a TOP travada.
 * A TRAVA DA SESSÃO: uma nova leitura da lista que deixe de confirmar a TOP não desmonta o que foi digitado — o
 * formulário continua, mas a ESCRITA só é autorizada pela lista de AGORA. A cópia do Duplicar cuja TOP não abre o
 * formulário é DESCARTADA (não reaparece numa criação aberta depois).
 */
export function useEntradaDaCentralDeEstoque(variante: VarianteDeEstoque): EntradaDaCentralDeEstoque {
  const router = useRouter(); const sp = useSearchParams(); const tr = useTradutor(); const { can } = useAuth();
  const rotulo = tr(variante.chaveI18n);
  const adaptador = React.useMemo(() => adaptadorDaCentralDeEstoque(variante, rotulo), [variante, rotulo]);
  const pedidaNaUrl = sp.get("tipo_operacao_id") ?? "";
  const textoDoPreenchimento = preenchimentoComoTexto(preenchimentoDaUrlDeEstoque(sp));
  const preenchimento = React.useMemo(() => {
    const valores = textoDoPreenchimento.split("|");
    const p: PreenchimentoDoLancamentoDeEstoque = {};
    CHAVES_DO_PREENCHIMENTO_DE_ESTOQUE.forEach((k, i) => { if (valores[i]) p[k] = valores[i]; });
    return p;
  }, [textoDoPreenchimento]);
  const podeCriar = can(`${variante.perm}.create`);
  const estado = useTopsDaEspecieEstoque(variante.segmento, podeCriar);
  const topAtual = topSelecionada(estado, pedidaNaUrl);
  const chave = pedidaNaUrl ? `${variante.segmento}:${pedidaNaUrl}` : null;
  const trava = React.useRef<{ chave: string; top: TopOperacional } | null>(null);
  React.useLayoutEffect(() => {
    if (!chave) { trava.current = null; return; }
    if (topAtual) trava.current = { chave, top: topAtual };
  });
  const topDaSessao = chave && trava.current?.chave === chave ? trava.current.top : null;
  const topEfetiva = topAtual ?? topDaSessao;
  const copiaSemFormulario = Boolean(pedidaNaUrl) && !topEfetiva && estado.situacao !== "carregando";
  React.useEffect(() => { if (copiaSemFormulario) descartarCopia(chaveDaCopiaDeEstoque, variante.segmento); }, [copiaSemFormulario, variante.segmento]);
  const base = {
    variante, estado, pedidaNaUrl, rotuloDaEspecie: rotulo,
    voltarALista: () => router.push(adaptador.rotas.lista),
    // `replace`: o lançador e o formulário são duas caras da MESMA etapa de criação (o Voltar do navegador sai dela)
    escolherTop: (t: TopOperacional) => router.replace(rotaDeLancamentoDeEstoque({ segmento: variante.segmento, id: t.id }, preenchimento))
  };
  if (!topEfetiva) return { ...base, formulario: null };
  return {
    ...base,
    formulario: {
      chave: `${topEfetiva.id}|${textoDoPreenchimento}`,
      props: { variante, adaptador, estado, top: topEfetiva, escritaTopConfirmada: podeLancar(estado) && topAtual !== null, preenchimento }
    }
  };
}

/* ═════════════════════════════ ESTADO DA CRIAÇÃO ═════════════════════════════ */

export interface EstadoDaCriacaoDeEstoque {
  variante: VarianteDeEstoque;
  adaptador: AdaptadorDaCentral;
  especie: EspecieEstoque;
  familia: string;
  forma: FormaDaEspecieNaCentral;
  /** A API declarou a movimentação interna (lido ao montar). */
  comMovimentacaoInterna: boolean;
  rotuloDaEspecie: string;
  titulo: string;
  estadoTop: EstadoTop;
  escritaTopConfirmada: boolean;
  top: { id: string; codigo: string; nome: string; movimento: string };

  /* documento */
  cabecalho: CabecalhoDeEstoque;
  /** O rótulo de cada escolha de referência (local, destino, origem) — apresentação, fora do corpo. */
  rotulos: Readonly<Record<string, string>>;
  mudar: (p: Partial<Pick<CabecalhoDeEstoque, "data_documento" | "observacao" | "motivo_saida" | "justificativa">>) => void;
  escolherEmpresa: (id: string) => void;
  escolherLocal: (campo: "armazem_id" | "armazem_destino_id", id: string, rotulo: string) => void;
  escolherOrigem: (id: string, rotulo: string) => void;
  escolherDestino: (coluna: ColunaDestinoEstoque, id: string, rotulo: string) => void;
  itens: ItemRow[];
  setItens: (novos: ItemRow[]) => void;
  lote: ControleDeLote;
  /** O local das linhas (o do cabeçalho): toda linha nasce e fica nele. */
  localDasLinhas: LocalDeEstoque | null;

  /* layout e regras */
  layoutAtivo: boolean;
  layoutVale: LayoutQueVale | null;
  layoutNaoCarregado: boolean;
  /** As colunas dos itens que o motor desenha (sempre um layout: o da TOP ou o do sistema). */
  colunasDosItens: ColunaDoLayout[];
  regras: RegrasDaOperacaoDoEstoque | null;
  rotuloDoCampo: (campo: string) => string;
  obrigatorio: (campo: string) => boolean;
  /** O layout trava o campo (não editável, com padrão válido). */
  travadoPeloLayout: (campo: string) => boolean;
  padraoInvalido: (campo: string) => boolean;

  /* origem */
  origem: EstadoDaOrigem;
  /** A origem aplicada (empresa, local e itens vieram dela, travados); null sem origem. */
  origemAplicada: DocumentoDeOrigem | null;
  avisoDaOrigem: string | null;
  /** O campo da origem aparece? (a espécie tem origem e o usuário lê a espécie dela). */
  mostrarOrigem: boolean;

  /* destino */
  dimensoesDoDestino: DimensaoDoDestinoNaTela[];

  /* erros e pendências */
  erro: (campo: string) => string | undefined;
  /** Os erros dos itens, no caminho que o motor lê (`items[<i>].<campo>`). */
  errosDoMotor: Record<string, string>;
  /** Os erros sem um campo à vista onde cair (a lista sob os itens). */
  errosSemCampo: [string, string][];
  pendencias: Pendencia[];
  pendenciasAbertas: boolean;
  setPendenciasAbertas: (v: boolean) => void;

  /* salvar */
  rotuloDoSalvar: string;
  travaDoSalvar: TravaDoSalvar;
  salvarDesabilitado: boolean;
  salvando: boolean;
  salvar: (opcoes?: { confirmar?: boolean }) => void;
  podeConfirmarNaCriacao: boolean;

  /* alterado, descartar, alterar operação */
  alterado: boolean;
  descartar: () => void;
  alterarOperacao: () => void;
  voltarAoLancador: () => void;
  confirmarTroca: boolean;
  setConfirmarTroca: (v: boolean) => void;
  copiaAplicada: boolean;
}

/** Os campos do cabeçalho que aceitam valor padrão LITERAL ou variável do layout. */
const CAMPOS_COM_PADRAO_DE_VALOR = ["empresa_id", "data_documento", "observacao"] as const;
/** Os campos do cabeçalho que aceitam o padrão de CADASTRO (o Local de estoque da empresa do documento). */
const CAMPOS_COM_PADRAO_DE_CADASTRO = ["armazem_id", "armazem_destino_id"] as const;
type CampoComPadrao = (typeof CAMPOS_COM_PADRAO_DE_VALOR)[number] | (typeof CAMPOS_COM_PADRAO_DE_CADASTRO)[number];

/** `itens.0.lote` / `itens[0].lote` → `items[0].lote` (o caminho que o motor lê). */
function caminhoDoMotor(caminho: string): string | null {
  const m = /^itens(?:\.(\d+)|\[(\d+)\])\.(.+)$/.exec(caminho);
  return m ? `items[${m[1] ?? m[2]}].${m[3]}` : null;
}

export function useEstadoDaCriacaoDeEstoque({ variante, adaptador, estado, top: topDoLancamento, escritaTopConfirmada, preenchimento }: PropsDoEstadoDaCriacao): EstadoDaCriacaoDeEstoque {
  const router = useRouter(); const tr = useTradutor(); const qc = useQueryClient(); const { can, ctx } = useAuth();
  const especie = variante.variante as EspecieEstoque;
  const familia = variante.familia;
  const rotuloDaEspecie = tr(variante.chaveI18n);
  const empresaPadrao = useEmpresaPadrao();
  const [capacidades] = React.useState(() => capacidadesDaSessao(estado));
  const forma = React.useMemo(() => formaDaEspecieNaCentral(especie, capacidades.mi), [especie, capacidades.mi]);
  // O nome da família, guardado ao montar: uma nova leitura da lista não apaga o contexto da tela.
  const [movimento] = React.useState(() => (estado.situacao === "pronto" ? estado.dados.family.label : ""));

  /* A CÓPIA (Duplicar) — lida UMA vez, da memória; só vale para esta espécie e esta TOP. O formulário que monta encerra
     a entrega mesmo quando ela não vale para ele: a cópia de outra TOP não fica para uma criação seguinte. */
  const [copia] = React.useState<CopiaDeEstoque | null>(() => espiarCopia<CabecalhoCopiadoDeEstoque>(chaveDaCopiaDeEstoque, variante.segmento, topDoLancamento.id));
  const avisouCopia = React.useRef(false);
  React.useEffect(() => {
    descartarCopia(chaveDaCopiaDeEstoque, variante.segmento);
    if (copia && !avisouCopia.current) { avisouCopia.current = true; toast.info("Cópia aberta como rascunho"); }
  }, [copia, variante.segmento]);

  /* A ABERTURA — o cabeçalho e os itens "intocados": o preenchimento da URL (PEDIDO; a empresa só se estiver no contexto
     do usuário) e, depois, a origem da URL e os padrões do layout. A cópia NÃO é abertura: é alteração. */
  const [abertura] = React.useState(() => {
    const h = cabecalhoVazio();
    const empresaDaUrl = preenchimento.empresa_id && empresasDoContexto(ctx).some((e) => e.id === preenchimento.empresa_id) ? preenchimento.empresa_id : "";
    h.empresa_id = empresaDaUrl || empresaPadrao;
    if (preenchimento.armazem_id) h.armazem_id = preenchimento.armazem_id;
    if (preenchimento.origem && forma.origem) h.origem_documento_id = preenchimento.origem;
    const itens: ItemRow[] = preenchimento.produto_id
      ? [{ product_id: preenchimento.produto_id, quantity: "", unit_value: "", generate_stock: true, ...(h.armazem_id ? { warehouse_id: h.armazem_id } : {}), ...(preenchimento.lote ? { provider_lot: preenchimento.lote } : {}) }]
      : [];
    const tocadosPelaUrl = new Set<string>([...(empresaDaUrl ? ["empresa_id"] : []), ...(preenchimento.armazem_id ? ["armazem_id"] : [])]);
    return { h, itens, tocadosPelaUrl };
  });
  const inicial = React.useRef<CabecalhoDeEstoque>(abertura.h);
  const itensIniciais = React.useRef<ItemRow[]>(abertura.itens);
  const rotulosIniciais = React.useRef<Record<string, string>>({});

  const [h, setH] = React.useState<CabecalhoDeEstoque>(() => ({ ...abertura.h, ...(copia?.cabecalho.valores ?? {}), data_documento: todayISO() }));
  const [rotulos, setRotulos] = React.useState<Record<string, string>>(() => ({ ...(copia?.cabecalho.rotulos ?? {}) }));
  const [itens, setItensCru] = React.useState<ItemRow[]>(() => copia?.itens ?? abertura.itens);
  const [erros, setErros] = React.useState<Record<string, string>>({});
  const [tentouSalvar, setTentouSalvar] = React.useState(false);
  const [pendenciasAbertas, setPendenciasAbertas] = React.useState(false);
  const [confirmarTroca, setConfirmarTroca] = React.useState(false);
  const [avisoDaOrigem, setAvisoDaOrigem] = React.useState<string | null>(null);
  const [origemAplicadaId, setOrigemAplicadaId] = React.useState("");
  // A empresa padrão pode chegar depois da primeira renderização: preenche o campo que ainda está vazio.
  React.useEffect(() => { if (empresaPadrao) setH((o) => (o.empresa_id ? o : { ...o, empresa_id: empresaPadrao })); }, [empresaPadrao]);

  const setItens = React.useCallback((novos: ItemRow[]) => setItensCru(novos), []);
  const mudar = React.useCallback((p: Partial<CabecalhoDeEstoque>) => setH((o) => ({ ...o, ...p })), []);
  const rotular = (campo: string, rotulo: string) => setRotulos((r) => ({ ...r, [campo]: rotulo }));

  /* ── as regras e o layout da TOP (só com a capacidade de cada um) ── */
  const regrasDaTop = useRegrasDaOperacaoDoEstoque(variante.segmento, topDoLancamento.id, capacidades.regras);
  const regras = regrasDaTop.regras;
  const layoutDaTop = useLayoutDoEstoque(variante.segmento, topDoLancamento.id, capacidades.layout);
  const estrutura: EstruturaLayout = React.useMemo(() => layoutDaTop.layout ?? LAYOUT_DO_SISTEMA(familia), [layoutDaTop.layout, familia]);
  const cfg = React.useMemo(() => new Map<string, CampoDoLayout>(layoutDaTop.layout ? layoutDaTop.layout.cabecalho.map((x) => [x.campo, x]) : []), [layoutDaTop.layout]);
  const catalogo = React.useMemo(() => new Map(catalogoDaFamilia(familia).map((c) => [c.chave, c])), [familia]);
  const rotuloDoCampo = React.useCallback((campo: string) => {
    if (campo === "origem_documento_id" && forma.origem) return rotuloDoCampoDaOrigem(forma.origem);
    return cfg.get(campo)?.rotulo || catalogo.get(campo)?.rotulo || rotuloDoErro(campo);
  }, [cfg, catalogo, forma.origem]);

  /* ── a origem ── */
  const origem = useOrigemDoEstoque(forma.origem, h.origem_documento_id);
  const documentoDaOrigem = origem.situacao === "pronta" ? origem.documento : null;
  /** O id PEDIDO da origem pronta (o do cabeçalho): é ele que marca a origem aplicada. */
  const idDaOrigemPronta = origem.situacao === "pronta" ? origem.id : "";
  const recusaDaOrigem = origem.situacao === "recusada" ? origem.mensagem : null;
  React.useEffect(() => {
    if (recusaDaOrigem === null) return;
    // A origem recusada não é aplicada e é LIMPA; o aviso diz por quê (sem revelar o que existe noutro escopo).
    const recusada = h.origem_documento_id;
    setAvisoDaOrigem(recusaDaOrigem);
    setH((o) => (o.origem_documento_id === recusada ? { ...o, origem_documento_id: "" } : o));
    if (inicial.current.origem_documento_id === recusada) inicial.current = { ...inicial.current, origem_documento_id: "" };
  }, [recusaDaOrigem, h.origem_documento_id]);
  React.useEffect(() => {
    if (!documentoDaOrigem || !forma.origem || !idDaOrigemPronta || origemAplicadaId === idDaOrigemPronta || h.origem_documento_id !== idDaOrigemPronta) return;
    // A ORIGEM VÁLIDA: empresa e Local de estoque passam a ser os dela (travados), os itens vêm dela, e o destino que
    // ela tem é herdado (o informado nessas dimensões sai: o servidor recusaria um destino diferente do da requisição).
    const doc = documentoDaOrigem;
    const linhas = linhasDaOrigem(forma.origem, doc);
    const herdadas = forma.destinoHerdado ? destinoDaOrigem(doc) : {};
    const vindos: Partial<CabecalhoDeEstoque> = { empresa_id: doc.empresa_id, armazem_id: doc.armazem_id };
    for (const c of CAMPOS_DESTINO_ESTOQUE) if (herdadas[c.coluna]) vindos[c.coluna] = "";
    const rotulosVindos = { armazem_id: doc.armazem_nome ?? "", origem_documento_id: rotuloDoDocumentoDeOrigem(doc) };
    setAvisoDaOrigem(null);
    setH((o) => ({ ...o, ...vindos }));
    setRotulos((r) => ({ ...r, ...rotulosVindos }));
    setItensCru(linhas);
    setOrigemAplicadaId(idDaOrigemPronta);
    // A origem da URL é ABERTURA: o que ela preencheu não conta como alteração (e o Descartar volta a ela).
    if (inicial.current.origem_documento_id === idDaOrigemPronta) {
      inicial.current = { ...inicial.current, ...vindos };
      itensIniciais.current = linhas;
      rotulosIniciais.current = { ...rotulosIniciais.current, ...rotulosVindos };
    }
  }, [documentoDaOrigem, idDaOrigemPronta, forma.origem, forma.destinoHerdado, origemAplicadaId, h.origem_documento_id]);
  const origemAplicada = documentoDaOrigem && idDaOrigemPronta && origemAplicadaId === idDaOrigemPronta && h.origem_documento_id === idDaOrigemPronta ? documentoDaOrigem : null;
  const herdados: DestinoHerdado = React.useMemo(() => (origemAplicada && forma.destinoHerdado ? destinoDaOrigem(origemAplicada) : {}), [origemAplicada, forma.destinoHerdado]);
  const origemCarregando = origem.situacao === "carregando" || (origem.situacao === "pronta" && origemAplicada === null);

  /* ── o controle de lote: lote e validade só onde a espécie os tem e o produto os controla ── */
  const lote = useControleDeLote(itens.map((i) => i.product_id));
  React.useEffect(() => {
    if (!forma.lote) return;
    let mudou = false;
    const novos = itens.map((it) => {
      const c = lote.daLinha(it.product_id);
      const l = c.lote ? it.provider_lot : ""; const validade = forma.validade && c.validade ? it.expiration_date : "";
      if ((it.provider_lot ?? "") !== (l ?? "") || (it.expiration_date ?? "") !== (validade ?? "")) { mudou = true; return { ...it, provider_lot: l, expiration_date: validade }; }
      return it;
    });
    if (mudou) setItensCru(novos);
  });

  /* ── os padrões do layout: UMA vez por resposta, só em campo intocado (nem o preenchido pela URL) ── */
  const padroesAplicados = React.useRef<unknown>(undefined);
  const padraoDeCadastroValido = React.useCallback((campo: string, empresa: string) => {
    if (!layoutDaTop.layout || !cfg.has(campo)) return null;
    const p = layoutDaTop.padroes.validos.get(campo);
    return p && p.empresaId && p.empresaId === empresa ? p : null;
  }, [layoutDaTop.layout, layoutDaTop.padroes, cfg]);
  React.useEffect(() => {
    if (!layoutDaTop.layout || padroesAplicados.current === layoutDaTop.resposta) return;
    padroesAplicados.current = layoutDaTop.resposta;
    const antes = inicial.current;
    const novos: Partial<Record<CampoComPadrao, string>> = {};
    const novosRotulos: Record<string, string> = {};
    for (const campo of CAMPOS_COM_PADRAO_DE_VALOR) {
      const x = cfg.get(campo);
      if (!x?.valorPadrao || abertura.tocadosPelaUrl.has(campo)) continue;
      const v = valorDoPadrao(x.valorPadrao, empresaPadrao);
      if (v !== null) novos[campo] = v;
    }
    const empresa = novos.empresa_id ?? antes.empresa_id;
    for (const campo of CAMPOS_COM_PADRAO_DE_CADASTRO) {
      if (abertura.tocadosPelaUrl.has(campo) || (campo === "armazem_destino_id" && !forma.localDeDestino)) continue;
      const p = padraoDeCadastroValido(campo, empresa);
      if (p) { novos[campo] = p.id; novosRotulos[campo] = p.rotulo; }
    }
    const chaves = Object.keys(novos) as CampoComPadrao[];
    if (!chaves.length) return;
    inicial.current = { ...antes, ...novos };
    rotulosIniciais.current = { ...rotulosIniciais.current, ...novosRotulos };
    setH((o) => {
      const r = { ...o };
      for (const k of chaves) if (o[k] === antes[k] || (k === "empresa_id" && o[k] === empresaPadrao)) r[k] = novos[k] ?? r[k];
      return r;
    });
    // o rótulo do padrão só vale onde não há escolha (a de quem digitou antes da resposta fica)
    setRotulos((r) => ({ ...novosRotulos, ...r }));
  }, [layoutDaTop.layout, layoutDaTop.resposta, cfg, empresaPadrao, abertura.tocadosPelaUrl, forma.localDeDestino, padraoDeCadastroValido]);

  /** O valor padrão que o layout dá ao campo vale AGORA? (literal/variável aplicável, ou o cadastro da empresa do documento) */
  const temPadraoValido = (campo: string) => {
    if ((CAMPOS_COM_PADRAO_DE_CADASTRO as readonly string[]).includes(campo)) return Boolean(padraoDeCadastroValido(campo, h.empresa_id));
    const v = cfg.get(campo)?.valorPadrao;
    return Boolean(v && valorDoPadrao(v, empresaPadrao) !== null);
  };
  const padraoInvalido = (campo: string) => Boolean(layoutDaTop.layout) && layoutDaTop.padroes.invalidos.has(campo);
  const travadoPeloLayout = (campo: string) => Boolean(layoutDaTop.layout) && cfg.get(campo)?.editavel === false && !padraoInvalido(campo) && temPadraoValido(campo);
  const doSistema = React.useMemo(() => new Set(catalogoDaFamilia(familia).filter((c) => c.parte !== "itens" && c.sistema).map((c) => c.chave)), [familia]);
  const obrigatorio = (campo: string) => doSistema.has(campo)
    || (campo === "observacao" && Boolean(regras?.exigencias.includes("observacao")))
    || (campo === "origem_documento_id" && (forma.origemObrigatoria || (regras?.fluxo?.exigeRequisicao ?? "nao") !== "nao"))
    || ((campo === "motivo_saida" || campo === "justificativa") && forma.motivoDaSaida);

  /* ── as escolhas do cabeçalho ── */
  const limparDestino = () => Object.fromEntries(CAMPOS_DESTINO_ESTOQUE.map((c) => [c.coluna, ""])) as Record<ColunaDestinoEstoque, string>;
  /** Trocar a empresa limpa os locais, a origem (e os itens que vieram dela) e o destino — tudo é da empresa do documento. */
  const escolherEmpresa = (id: string) => {
    setH((o) => ({ ...o, empresa_id: id, armazem_id: "", armazem_destino_id: "", origem_documento_id: "", ...limparDestino() }));
    setItensCru((ls) => ls.filter((l) => !texto(l["origem_item_id"])).map((l) => ({ ...l, warehouse_id: undefined })));
    setOrigemAplicadaId("");
    setAvisoDaOrigem(null);
  };
  /** O Local de estoque é o do DOCUMENTO: trocar o do cabeçalho reescreve o de todas as linhas (estado da tela). */
  const escolherLocal = (campo: "armazem_id" | "armazem_destino_id", id: string, rotulo: string) => {
    mudar({ [campo]: id });
    rotular(campo, rotulo);
    if (campo === "armazem_id") setItensCru((ls) => ls.map((l) => ({ ...l, warehouse_id: id || undefined })));
  };
  /** A origem escolhida no campo; vazia tira as linhas que vieram da anterior. */
  const escolherOrigem = (id: string, rotulo: string) => {
    setAvisoDaOrigem(null);
    mudar({ origem_documento_id: id });
    rotular("origem_documento_id", rotulo);
    if (origemAplicadaId) { setItensCru((ls) => ls.filter((l) => !texto(l["origem_item_id"]))); setOrigemAplicadaId(""); }
  };
  const escolherDestino = (coluna: ColunaDestinoEstoque, id: string, rotulo: string) => { mudar({ [coluna]: id }); rotular(coluna, rotulo); };

  /* ── o destino na tela ── */
  const dimensoesDoDestino = React.useMemo<DimensaoDoDestinoNaTela[]>(() => {
    if (!forma.destinoInformado || !regras?.destino) return [];
    const secao = regras.destino;
    return CAMPOS_DESTINO_ESTOQUE.flatMap((c): DimensaoDoDestinoNaTela[] => {
      const herdado = herdados[c.coluna];
      if (herdado) return [{ campo: c, exigencia: "herdada", valor: herdado.id, rotuloDoValor: herdado.nome }];
      const valor = h[c.coluna];
      // a dimensão que a TOP não usa some — a não ser que traga valor (a cópia): ela aparece, para poder ser limpa
      if (secao[c.chave] === "nao_usada" && !valor) return [];
      return [{ campo: c, exigencia: secao[c.chave], valor, rotuloDoValor: rotulos[c.coluna] ?? "" }];
    });
  }, [forma.destinoInformado, regras, herdados, h, rotulos]);

  /* ── as colunas dos itens ── */
  const forcadas = (["lote", "validade"] as const).filter((c) => itens.some((it) => lote.pede(it.product_id, c)));
  const chaveDasForcadas = forcadas.join("|");
  const colunasDosItens = React.useMemo(
    () => colunasDoLayoutDoEstoque(familia, forma, estrutura.itens, chaveDasForcadas ? (chaveDasForcadas.split("|") as ("lote" | "validade")[]) : []),
    [familia, forma, estrutura.itens, chaveDasForcadas]);
  const localDasLinhas = React.useMemo<LocalDeEstoque | null>(() => (h.armazem_id ? { id: h.armazem_id, rotulo: rotulos["armazem_id"] ?? "" } : null), [h.armazem_id, rotulos]);

  /* ── a conferência ── */
  const conferencia = conferirLancamentoDeEstoque({
    forma, topId: topDoLancamento.id, cabecalho: h, itens, lote, regras, origem: origemAplicada, herdados, rotuloDoCampo
  });
  const pendencias = conferencia.pendencias;
  const errosLocais: Record<string, string> = tentouSalvar ? Object.fromEntries(pendencias.map((p) => [p.caminho, p.mensagem])) : {};
  const errosDaTela: Record<string, string> = { ...erros, ...errosLocais };
  const erro = (campo: string) => errosDaTela[campo];
  const errosDoMotor: Record<string, string> = {};
  const errosSemCampo: [string, string][] = [];
  const cabecalhoAVista = new Set<string>([
    "empresa_id", "armazem_id", "data_documento", "observacao", ...(forma.localDeDestino ? ["armazem_destino_id"] : []),
    ...(forma.origem ? ["origem_documento_id"] : []), ...(forma.motivoDaSaida ? ["motivo_saida", "justificativa"] : []),
    ...dimensoesDoDestino.filter((d) => d.exigencia !== "herdada").map((d) => d.campo.coluna)
  ]);
  // Todo erro de item vai ao motor (ele o marca na célula e o lista sob a grade); o do cabeçalho sem campo à vista, e o
  // "itens" sem linha, caem na lista da Central.
  for (const [caminho, mensagem] of Object.entries(errosDaTela)) {
    const doMotor = caminhoDoMotor(caminho);
    if (doMotor) errosDoMotor[doMotor] = mensagem;
    else if (!cabecalhoAVista.has(caminho)) errosSemCampo.push([caminho, mensagem]);
  }

  /* ── salvar ── */
  const chave = React.useRef(newIdem());
  const depoisDeSalvar = React.useRef<DepoisDeSalvar>({ confirmar: false });
  const salvarM = useMutation({
    mutationFn: (corpo: Record<string, unknown>) => api<RespostaDoSalvar>(`/api/estoque/${variante.segmento}`, { method: "POST", body: corpo, idempotencyKey: chave.current }),
    onSuccess: (r) => {
      // O aviso sai da RESPOSTA (`confirmacaoAutomatica`), pelo motor (W-5b/W-5c): um por Salvar.
      avisarSalvo(r);
      void qc.invalidateQueries();
      // O "Salvo ✓" (e o pedido de abrir a prévia) vão à consulta pela memória, nunca pela URL.
      entregarSalvo(chaveDepoisDeSalvarDeEstoque, r.id, depoisDeSalvar.current);
      router.push(adaptador.rotas.registro(r.id));
    },
    onError: (e) => { chave.current = newIdem(); setErros(errosDoServidor(e)); toast.error((e as Error).message); }
  });
  const travaDoSalvar: TravaDoSalvar =
    salvarM.isPending ? "salvando"
      : !escritaTopConfirmada ? "top-nao-confirmada"
        : layoutDaTop.naoCarregado ? "layout-falhou"
          : layoutDaTop.pendente ? "layout-carregando"
            : regrasDaTop.pendente ? "regras-carregando"
              : regrasDaTop.falhou ? "regras-falharam"
                : origemCarregando ? "origem-carregando"
                  : null;
  const salvar = (opcoes?: { confirmar?: boolean }) => {
    // A defesa no handler, e não só no `disabled` do botão: `disabled` é apresentação.
    if (travaDoSalvar) return;
    setErros({});
    setTentouSalvar(true);
    if (pendencias.length) { setPendenciasAbertas(true); return; } // zero POST
    depoisDeSalvar.current = { confirmar: Boolean(opcoes?.confirmar) };
    salvarM.mutate(conferencia.corpo);
  };

  /* ── alterado: contra a abertura, sem a empresa (preenchida por efeito, não por digitação) ── */
  const semEmpresa = ({ empresa_id: _empresa, ...resto }: CabecalhoDeEstoque) => resto;
  const alterado = JSON.stringify(semEmpresa(h)) !== JSON.stringify(semEmpresa(inicial.current)) || JSON.stringify(itens) !== JSON.stringify(itensIniciais.current);
  useDirtyTab(alterado && !salvarM.isSuccess);

  const parametrosDoPreenchimento = new URLSearchParams(
    Object.entries(preenchimento).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "")).toString();
  const voltarAoLancador = () => router.replace(`${adaptador.rotas.nova}${parametrosDoPreenchimento ? `?${parametrosDoPreenchimento}` : ""}`);
  const alterarOperacao = () => { if (alterado) setConfirmarTroca(true); else voltarAoLancador(); };
  /** DESCARTAR: zero escrita — volta à abertura (o preenchimento e a origem da URL, os padrões do layout). */
  const descartar = () => {
    setH({ ...inicial.current, empresa_id: inicial.current.empresa_id || empresaPadrao });
    setItensCru(itensIniciais.current);
    setRotulos(rotulosIniciais.current);
    setOrigemAplicadaId(inicial.current.origem_documento_id && origemAplicadaId === inicial.current.origem_documento_id ? origemAplicadaId : "");
    setErros({}); setTentouSalvar(false); setPendenciasAbertas(false); setAvisoDaOrigem(null);
  };

  // O campo da origem só aparece para quem LÊ a espécie dela (a lista e o GET exigem a `.view` dela).
  const podeLerOrigem = forma.origem !== null && can(`${RECURSO_DA_ESPECIE_ESTOQUE[forma.origem]}.view`);

  return {
    variante, adaptador, especie, familia, forma, comMovimentacaoInterna: capacidades.mi, rotuloDaEspecie,
    titulo: `Novo documento · ${rotuloDaEspecie}`,
    estadoTop: estado, escritaTopConfirmada,
    top: { id: topDoLancamento.id, codigo: topDoLancamento.code, nome: topDoLancamento.name, movimento },
    cabecalho: h, rotulos, mudar, escolherEmpresa, escolherLocal, escolherOrigem, escolherDestino,
    itens, setItens, lote, localDasLinhas,
    layoutAtivo: capacidades.layout, layoutVale: layoutDaTop.vale, layoutNaoCarregado: layoutDaTop.naoCarregado, colunasDosItens, regras,
    rotuloDoCampo, obrigatorio, travadoPeloLayout, padraoInvalido,
    origem, origemAplicada, avisoDaOrigem, mostrarOrigem: podeLerOrigem,
    dimensoesDoDestino,
    erro, errosDoMotor, errosSemCampo, pendencias, pendenciasAbertas, setPendenciasAbertas,
    rotuloDoSalvar: rotuloDoSalvar(regras?.regrasGerais, can(`${variante.perm}.edit`)),
    travaDoSalvar, salvarDesabilitado: travaDoSalvar !== null, salvando: salvarM.isPending, salvar,
    podeConfirmarNaCriacao: can(`${variante.perm}.edit`),
    alterado, descartar, alterarOperacao, voltarAoLancador, confirmarTroca, setConfirmarTroca,
    copiaAplicada: copia !== null
  };
}
