"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { todayISO } from "@/lib/utils";
import { useDirtyTab } from "@/lib/workspace-tabs";
import { Confirm, EntradaNumero, Field, Input, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { defaultPlan, useEmpresaPadrao, type ItemRow, type Plan } from "@/features/docs/shared";
import { useQuery } from "@tanstack/react-query";
import { AVISO_PADRAO_INVALIDO_CENTRAL, CAMPOS_SO_NO_RODAPE, camposAdicionaisDoCabecalho, ERRO_EXIGENCIA_NAO_ATENDIDA, ERRO_LAYOUT_CAMPO_OBRIGATORIO, exigenciasFaltandoPorCampos, FORMA_UUID_PADRAO, LAYOUT_DO_SISTEMA, camposObrigatoriosFaltando, chavePadraoDeCadastro, catalogoDaFamilia, documentTotals, mensagemCampoObrigatorio, normalizarCondicaoPagamento, planoDaCondicao, validarCondicaoPagamento, type CampoDoLayout, type CondicaoPagamento, type EstruturaLayout, type OrigemDoLayout, type ValorPadraoLayout } from "@agro/domain";
import { api, ApiError } from "@/lib/api";
import { MensagemTop, entendeClassificacaoFinanceira, entendeCondicaoPagamento, entendeLayoutDocumento, type EstadoTop, type TopOperacional } from "@/features/sales/tipo-operacao-select";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { CentralVendasWorkspace } from "@/features/sales/central-vendas-workspace";
import { ItensDaCentral } from "@/features/sales/central-vendas-itens";
import { CampoDaCentral, ChaveSimNao, ColunaDeCampos, DadosAdicionais, DataDaCentral, type IconeDoCampo } from "@/features/sales/central-vendas-campo";
import { PainelColuna, PainelLargo, PainelRepartido, PlanoDaCentral, TitulosDoDocumento } from "@/features/sales/central-vendas-painel";
/* VISUAL-UX-02 W1: barra da criação (Descartar, Salvar com pendências, Confirmar venda), leque, cópia do Duplicar */
import { AcoesRapidas, BotaoDaBarra, ConjuntoDaBarra, ConjuntoDireito, IconeAlterarOperacao, IconeConfirmar, IconeDescartar, IconeHistorico, IconeImprimir, IconeSalvar, PendenciasDoDocumento, PilulaDaBarra, PosicaoDoRotulo, chaveDepoisDeSalvar, type DepoisDeSalvar, type ItemRapido, type Pendencia, type PosicaoDoRotuloValor } from "@/features/sales/central-vendas-barra";
import { DialogoDescartar } from "@/features/sales/central-vendas-dialogos";
import { chaveDaCopia, copiaValePara, type CopiaDoDocumento } from "@/features/sales/central-vendas-duplicar";
import { descartarEntrega, entregarEmMemoria, espiarEntrega } from "@/lib/entrega-em-memoria";
import { toast } from "@/lib/toast";
/* TOP-CONFIG-05 exigências: as regras da operação (só com `capacidades.regrasDaOperacao` exata). */
import { entendeRegrasDaOperacao, useRegrasDaOperacao, useSituacaoCliente } from "@/features/sales/regras-da-operacao";
/* OPERACOES-01 F2 (decisão 279): o Salvar do motor (aviso pela resposta) e as regras gerais da TOP (rótulo, sem itens). */
import { useCriarDocumento, type RespostaDoSalvar } from "@/features/central/salvar";
import { REGRAS_GERAIS_NEUTRAS, exigeAoMenosUmItem, rotuloDoSalvar } from "@/features/central/regras-gerais";
import estilosCv from "@/features/central/moldura.module.css";
/* TOP-CONFIG-05 atraso — faixa do cliente em atraso (só com `capacidades.regrasDaOperacao` exata). */
import { ERRO_CLIENTE_EM_ATRASO } from "@agro/domain";
import { FaixaAtrasoCliente, bloqueiaSalvar } from "@/features/sales/faixa-atraso-cliente";
/* TOP-CONFIG-07 — reserva de estoque (só com `regras.reservaEstoque === true`, na família do pedido). */
import { familiaOperacionalDeDocumentoVenda, type ColunaDoLayout } from "@agro/domain";
import { CAMPOS_DO_ITEM_EXIGIDOS_PELA_RESERVA, ehCaminhoDeItemDaReserva } from "@/features/sales/regras-da-operacao";
/* OPERACOES-01 F3b (decisão 280): o "Local de estoque" do cabeçalho, para as linhas novas (estado da tela). */
import { CampoDoLocalPadrao, useLocalDoCabecalho } from "@/features/central/local-padrao";
import type { LocalDeEstoque } from "@/features/central/contrato";
import { PREFIXO_CENTRAL_VENDAS } from "@/features/sales/central-vendas-adaptador";
/* EDITAR-03 (decisão 315): o RAMO de edição do documento salvo — o adaptador do `/edicao`, as contas puras e o que a
   edição reusa (o PATCH com a chave de idempotência, o aviso do Salvar do motor, a prévia da confirmação). */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { newIdem } from "@/lib/api";
import { useTradutor } from "@/lib/i18n";
import type { Row } from "@/features/docs/shared";
import { avisarSalvo } from "@/features/central/salvar";
import { ROTULO_SALVAR_E_CONFIRMAR } from "@/features/central/regras-gerais";
import { lerRegrasDaOperacao, lerSituacaoCliente } from "@/features/sales/regras-da-operacao";
import { usePreviaDaConfirmacao, type EstadoDaPrevia } from "@/features/sales/previa-confirmacao";
import { varianteDeVenda } from "@/features/sales/variantes";
import {
  RELEITURAS_DA_ABERTURA, MSG_DOCUMENTO_DE_VENDA_MUDOU, MSG_EDICAO_DE_VENDA_INDISPONIVEL, chaveDaEdicaoDeVenda, chaveDoDocumentoEmEdicaoDeVenda,
  conflitoDaEdicaoDeVenda, decidirAbertura, edicaoDeVendaIndisponivel, lerEdicaoDeVenda, portaDaEdicaoDeVenda, portaDoDocumentoDeVenda,
  trocaAChaveDaEdicao, type EdicaoDoDocumentoDeVenda
} from "@/features/sales/central-vendas-edicao-api";
import {
  MOTIVO_EMPRESA_NA_EDICAO, MSG_EDICAO_SEM_MUDANCA, aberturaDaVenda, aceitaLinhaNovaNaEdicao, avisaAntesDeSalvar, corpoDaEdicaoDeVenda,
  itensNaEdicaoDeVenda, mudouAlgo, numerosDaPreviaValem, recalculaPlanoDaCondicao, semeiaNaAbertura, situacaoDoAtrasoNaEdicao,
  topGravadaDaVenda, travasDaLinhaDaVenda, type ModoDoFormularioDeVenda
} from "@/features/sales/central-vendas-edicao";

/**
 * A CENTRAL DE VENDAS — O FORMULÁRIO (EDITAR-03, decisão 315: MOVIDO de `app/(app)/vendas/[kind]/new/page.tsx`).
 *
 * POR QUE MORA AQUI: o estado da Central de Vendas (cabeçalho, itens, plano, layout, regras da TOP, pendências, Salvar)
 * morava no componente `Formulario` DENTRO do arquivo de página do Next — e uma página do Next não exporta nomes além do
 * `default` (o build recusa). A edição do documento salvo é um RAMO deste MESMO estado, aberto pela consulta; para a
 * consulta montá-lo, ele tem de ser importável. Então o `Formulario` e os leitores do layout que ele usa vieram para cá
 * SEM reescrita: o JSX, os handlers, os efeitos e o corpo do POST da criação são os de antes, linha a linha, e
 * `new/page.tsx` monta o MESMO componente com as MESMAS props.
 */

const T: Record<string, string> = { budgets: "Novo Orçamento", orders: "Novo Pedido de Venda", sales: "Nova Venda" };
/** VISUAL-UX-02 Fase B: as mensagens das pendências de natureza e centro (no campo e na lista "N pendências"). */
const PENDENCIA_NATUREZA = "Selecione a natureza.";
const PENDENCIA_CENTRO = "Selecione o centro de resultado.";

/**
 * LAYOUT DO DOCUMENTO (VENDAS-A3-1) — o que `/layout-efetivo` devolve, CONFERIDO antes de governar a tela (mesma
 * postura de `ehTopsDaVariante`: o corpo é `unknown` até provar a forma; o que não se reconhece não vale).
 */
const ehObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ehCampoDoLayout = (v: unknown) => ehObj(v) && typeof v.campo === "string" && typeof v.obrigatorio === "boolean" && typeof v.editavel === "boolean" && (v.rotulo === undefined || v.rotulo === null || typeof v.rotulo === "string");
function ehEstruturaLayout(v: unknown): v is EstruturaLayout {
  return ehObj(v) && v.versaoSchema === 1
    && Array.isArray(v.cabecalho) && v.cabecalho.every(ehCampoDoLayout)
    && Array.isArray(v.rodape) && v.rodape.every((a) => ehObj(a) && typeof a.aba === "string" && Array.isArray(a.campos) && a.campos.every(ehCampoDoLayout))
    && Array.isArray(v.itens) && v.itens.every((c) => ehObj(c) && typeof c.campo === "string" && typeof c.obrigatorio === "boolean");
}

/** Valor padrão do layout → valor do estado do formulário. `null` = não se aplica (o validador do domínio já recusa esses). */
function valorDoPadrao(v: ValorPadraoLayout, empresa: string): string | boolean | null {
  if (v.tipo === "variavel") return v.variavel === "data_atual" ? todayISO() : empresa || null;
  // VENDAS-A3-1b: o padrão registro nunca chega pela `estrutura` (a API o tira dela); vem em `padroesDeCadastro`.
  if (v.tipo === "registro") return null;
  return typeof v.valor === "boolean" ? v.valor : String(v.valor);
}

/**
 * PADRÃO DE CADASTRO (VENDAS-A3-1b) — dois campos OPCIONAIS da resposta de `/layout-efetivo`:
 * `padroesDeCadastro` ({ [chave]: { id, rotulo, empresaId? } }, só os que valem AGORA) e `padroesInvalidos` (as chaves
 * dos que morreram). A API anterior não os manda: ausentes = {} e [], e a Central é a da A3-1. Forma errada de um deles
 * → ele é IGNORADO por inteiro (o que não se reconhece não vale) — nunca bloqueia o Salvar, que depende só da estrutura.
 * Chave nas duas listas → não se aplica (vale o aviso).
 */
interface PadraoDeCadastro { id: string; rotulo: string; empresaId: string | null }
interface PadroesDaResposta { validos: ReadonlyMap<string, PadraoDeCadastro>; invalidos: ReadonlySet<string> }
const SEM_PADROES: PadroesDaResposta = { validos: new Map(), invalidos: new Set() };
const ehPadraoDeCadastro = (v: unknown): v is { id: string; rotulo: string; empresaId?: string | null } =>
  ehObj(v) && typeof v.id === "string" && FORMA_UUID_PADRAO.test(v.id) && typeof v.rotulo === "string"
  && (v.empresaId === undefined || v.empresaId === null || typeof v.empresaId === "string");
function padroesDaResposta(r: unknown): PadroesDaResposta {
  if (!ehObj(r)) return SEM_PADROES;
  let validos = new Map<string, PadraoDeCadastro>();
  if (ehObj(r.padroesDeCadastro)) {
    for (const [chave, v] of Object.entries(r.padroesDeCadastro)) {
      if (!ehPadraoDeCadastro(v)) { validos = new Map(); break; }
      validos.set(chave, { id: v.id, rotulo: v.rotulo, empresaId: typeof v.empresaId === "string" ? v.empresaId : null });
    }
  }
  const lista = r.padroesInvalidos;
  const invalidos = new Set<string>(Array.isArray(lista) && lista.every((x): x is string => typeof x === "string") ? lista : []);
  for (const chave of invalidos) validos.delete(chave);
  return validos.size || invalidos.size ? { validos, invalidos } : SEM_PADROES;
}

/**
 * QUAL LAYOUT VALE (VENDAS-A3-1d) — `origem`/`nome`/`id` da MESMA resposta de `/layout-efetivo`, lidos com a mesma
 * postura tolerante: origem que não se reconhece NÃO vira "do sistema" (seria afirmar o que não se sabe) — a linha
 * simplesmente não aparece. Nome vazio ou ausente → "do sistema". O `id` só vale com forma de UUID: ele vai para o
 * endereço do configurador, e texto cru da resposta não monta URL. É só INFORMAÇÃO: não governa campo, cobrança nem Salvar.
 */
interface LayoutQueVale { origem: OrigemDoLayout; nome: string | null; id: string | null }
function layoutQueVale(r: unknown): LayoutQueVale | null {
  if (!ehObj(r)) return null;
  const origem = r.origem === "ligado" || r.origem === "padrao_da_familia" || r.origem === "sistema" ? r.origem : null;
  if (!origem) return null;
  return {
    origem,
    nome: typeof r.nome === "string" && r.nome.trim() ? r.nome : null,
    id: typeof r.id === "string" && FORMA_UUID_PADRAO.test(r.id) ? r.id : null
  };
}
function textoDoLayoutQueVale(l: LayoutQueVale): string {
  if (l.origem === "sistema" || !l.nome) return "Layout: do sistema";
  return l.origem === "ligado" ? `Layout: ${l.nome} (ligado à TOP)` : `Layout: ${l.nome} (padrão do movimento)`;
}
/** "Configurar": o layout que vale, ou — no do sistema / sem id — a lista de layouts em Configurações. */
const hrefDoConfigurador = (l: LayoutQueVale) => (l.origem !== "sistema" && l.id
  ? `/configuracoes/layouts-documento/${l.id}`
  : "/configuracoes?tab=operacoes&sub=layouts-documento");

/**
 * TOP-CONFIG-07 — A RESERVA VENCE O LAYOUT NOS ITENS (a mesma régua de "a exigência da TOP vence o layout" no
 * cabeçalho): a coluna que a reserva exige e o layout não desenha entra mesmo assim, logo antes do Código/Produto (onde
 * o layout do sistema a põe — OPERACOES-01 F3b, decisão 280: o local antes do produto; a mesma régua do `armazemForcado`
 * do motor; sem nenhum dos dois, no início) — sem ela o operador não teria onde escolher o local que o servidor cobra.
 * Só o DESENHO: a cobrança do layout continua lendo `layout`, e o "*" vem da reserva (`ItensDaCentral`), não daqui.
 */
function comColunasDaReserva(itens: readonly ColunaDoLayout[]): readonly ColunaDoLayout[] {
  const faltam = CAMPOS_DO_ITEM_EXIGIDOS_PELA_RESERVA.filter((c) => !itens.some((x) => x.campo === c));
  if (!faltam.length) return itens;
  const lista = [...itens];
  const ancoras = lista.map((x, i) => (x.campo === "codigo" || x.campo === "product_id" ? i : -1)).filter((i) => i >= 0);
  lista.splice(ancoras.length ? Math.min(...ancoras) : 0, 0, ...faltam.map((campo): ColunaDoLayout => ({ campo, obrigatorio: false })));
  return lista;
}

/** Detalhe do 422 LAYOUT_CAMPO_OBRIGATORIO → { caminho: mensagem }. Aceita lista direta ou embrulhada. */
function errosDoServidor(details: unknown): Record<string, string> {
  const lista: unknown[] = Array.isArray(details) ? details
    : ehObj(details) ? (Array.isArray(details.campos) ? details.campos : Array.isArray(details.fields) ? details.fields : Array.isArray(details.erros) ? details.erros : []) : [];
  const out: Record<string, string> = {};
  for (const d of lista) {
    if (!ehObj(d)) continue;
    const caminho = typeof d.caminho === "string" ? d.caminho : typeof d.path === "string" ? d.path : typeof d.campo === "string" ? d.campo : null;
    if (!caminho) continue;
    const msg = typeof d.mensagem === "string" ? d.mensagem : typeof d.message === "string" ? d.message : typeof d.rotulo === "string" ? mensagemCampoObrigatorio(d.rotulo) : "Campo obrigatório.";
    out[caminho] = msg;
  }
  return out;
}

/* ═════════════════════════════ EDITAR-03 — A INTERFACE DO RAMO DE EDIÇÃO ═════════════════════════════ */

/**
 * O documento salvo aberto em EDIÇÃO (`useAberturaDaEdicaoDeVenda` monta): o `GET :id` e o `/edicao` da MESMA versão,
 * e as duas saídas. Ausente (`null`) = a criação de hoje, byte a byte.
 */
export interface EdicaoAbertaDeVenda {
  /** O documento GRAVADO (o `GET <base>/:id`, o mesmo objeto da consulta). */
  documento: Row;
  /** A resposta do `GET <base>/:id/edicao` conferida (a versão, os limites, as regras da versão CONGELADA, o layout). */
  dados: EdicaoDoDocumentoDeVenda;
  /** Volta à consulta; `salvou` = a PATCH gravou. */
  onFechar: (salvou: boolean) => void;
  /** Lê de novo o documento e o `/edicao` e remonta o formulário: o rascunho sai, a chave de idempotência é nova. */
  recarregar: () => void;
}

/**
 * O AVISO DO SALVAR QUE CONFIRMA (item 2 da EDITAR-03): pendente quando o Salvar foi clicado numa venda cuja versão
 * congelada confirma ao salvar (`avisaAntesDeSalvar`) — a PATCH ainda NÃO saiu. O conteúdo é do servidor: o rótulo da
 * ação ("Salvar e confirmar"), o código do documento e a PRÉVIA da confirmação (`/previa-confirmacao`, `sales.view`).
 */
export interface AvisoDaConfirmacaoNaEdicao {
  rotulo: string;
  codigo: string;
  /** A prévia do servidor — da venda GRAVADA. Recusa prevista NÃO impede salvar (a edição pode ser a correção dela). */
  previa: EstadoDaPrevia;
  /** Os números da prévia valem para ESTA PATCH? Falso quando ela toca o que a prévia lê (itens, valores, plano, datas…). */
  numerosDaPreviaValem: boolean;
}

/**
 * O QUE A TELA DA EDIÇÃO PRECISA DO ESTADO (o render prop `renderDialogosDaEdicao` recebe isto): o conflito de versão,
 * o aviso do Salvar que confirma e o que a barra mostra. Nada aqui chama a API por conta própria: `confirmarAviso` é a
 * ÚNICA porta que manda a PATCH que confirma, e `recarregar` só pede a releitura.
 */
export interface EstadoDaEdicaoDeVenda {
  /** O código do documento (do servidor). */
  codigo: string;
  /** A variante do registro (`sale` | `order` | `budget`, o `kind` do servidor). */
  variante: string;
  /** A PATCH em andamento. */
  salvando: boolean;
  /** A PATCH mudaria alguma coisa (a MESMA conta do corpo, contra o gravado). */
  alterado: boolean;
  /** O conflito de versão (409 `CONCURRENCY_CONFLICT`): a mensagem do servidor; `null` sem conflito. Nunca sobrescreve. */
  conflito: string | null;
  /** "Recarregar o documento": relê e remonta (o rascunho sai). */
  recarregar: () => void;
  /** "Continuar editando": fecha o conflito e mantém o rascunho (a PATCH seguinte leva a MESMA versão e volta a 409). */
  continuarEditando: () => void;
  /** O aviso pendente; `null` quando não há. */
  aviso: AvisoDaConfirmacaoNaEdicao | null;
  /** O botão do diálogo: manda a PATCH (que confirma). */
  confirmarAviso: () => void;
  /** "Voltar" do diálogo: fecha sem mandar nada. */
  cancelarAviso: () => void;
  /** O que a barra da edição mostra (montada pelo formulário): Salvar (rótulo do servidor), o ✕ e o Voltar à consulta. */
  barra: { rotuloDoSalvar: string; rotuloDoDescartar: "Descartar alterações" | "Voltar à consulta" };
  /** Volta à consulta sem gravar nada (o ✕ sem alteração; o Descartar confirmado). */
  voltarAConsulta: () => void;
}

/** As props do formulário da Central de Vendas. Sem `edicao`: a criação (a página `new`), exatamente como antes. */
export interface PropsDoFormularioDeVenda {
  kind: string;
  top: TopOperacional;
  familia: string;
  /** O estado ATUAL da descoberta — o que reabilita o Salvar quando a capability volta. */
  estadoTop: EstadoTop;
  /** A descoberta de AGORA confirma esta TOP? Só isso autoriza o POST. */
  escritaTopConfirmada: boolean;
  /** VISUAL-UX-02 W1: a posição do rótulo (estado da página) e o Descartar (a página remonta o formulário). */
  densidade: PosicaoDoRotuloValor; onDensidade: (v: PosicaoDoRotuloValor) => void; onDescartar: () => void;
  /** EDITAR-03: o documento salvo em EDIÇÃO (o RAMO). Ausente/null: a criação. */
  edicao?: EdicaoAbertaDeVenda | null;
  /** EDITAR-03: os diálogos da edição (o conflito de versão, o aviso do Salvar que confirma), desenhados pela consulta. */
  renderDialogosDaEdicao?: (e: EstadoDaEdicaoDeVenda) => React.ReactNode;
}

function Formulario({ kind, top, familia, estadoTop, escritaTopConfirmada, densidade, onDensidade, onDescartar, edicao = null, renderDialogosDaEdicao }: PropsDoFormularioDeVenda) {
  const router = useRouter(); const empresa = useEmpresaPadrao();
  /*
   * EDITAR-03 (decisão 315) — O RAMO DE EDIÇÃO. Com `edicao`, este MESMO formulário abre o documento GRAVADO
   * (`aberturaDaVenda`, a versão que o `/edicao` conferiu), sem semear NADA (`semeiaNaAbertura`, guarda a guarda), com o
   * que a PATCH recusa em leitura (a empresa; a TOP já é contexto travado; as travas de linha do `/edicao`), e o Salvar
   * manda `PATCH { version, ...só o que mudou }`. As portas de apoio que pedem `.create` (`/layout-efetivo`,
   * `/regras-da-operacao`, `/situacao-cliente`) NÃO são chamadas: a edição usa o que o `/edicao` traz.
   */
  const modo: ModoDoFormularioDeVenda = edicao ? "edicao" : "criacao";
  const modoEdicao = edicao !== null;
  const limites = edicao?.dados.limites ?? null;
  const [aberturaDaEdicao] = React.useState(() => (edicao ? aberturaDaVenda(edicao.documento, defaultPlan) : null));
  /* VISUAL-UX-02 W1 — DUPLICAR: a cópia entregue em memória pela consulta, consumida UMA vez ao montar (espia aqui,
     descarta no efeito) e só para ESTA espécie e ESTA TOP. Ela entra como VALOR, não como abertura: `branco` (a
     abertura) continua sendo o estado inicial de `inicial` — a cópia conta como alteração, o ponto acende — e nenhum
     padrão de layout ou de cadastro a sobrescreve. Salvar a cópia é o POST de sempre, com as mesmas chaves.
     EDITAR-03: a edição nem espia nem descarta — a cópia é de uma criação, talvez aberta em outra aba. */
  const [copia] = React.useState(() => { if (!semeiaNaAbertura(modo, "copiaDoDuplicar")) return null; const c = espiarEntrega<CopiaDoDocumento>(chaveDaCopia(kind)); return copiaValePara(c, kind, top.id) ? c : null; });
  const copiaAvisada = React.useRef(false);
  React.useEffect(() => {
    if (!semeiaNaAbertura(modo, "copiaDoDuplicar")) return;
    descartarEntrega(chaveDaCopia(kind));
    if (copia && !copiaAvisada.current) { copiaAvisada.current = true; toast.info("Cópia aberta como rascunho"); }
  }, [kind, copia, modo]);
  const [branco] = React.useState(() => ({ empresa_id: "", document_date: todayISO(), shipping_date: "", due_date: "", client_id: "", transporter_id: "", proprietary_id: "", driver_name: "", payment_method_id: "", freight: "0", freight_icms: "0", other_values: "0", discount: "0", note: "", is_deductible: false, installments: false, categoria_financeira_id: "", centro_custo_id: "", condicao_pagamento_id: "" }));
  const [h, setH] = React.useState<typeof branco>(() => (aberturaDaEdicao ? { ...aberturaDaEdicao.cabecalho } : copia ? { ...branco, ...copia.cabecalho } : branco));
  const [items, setItemsDoEstado] = React.useState<ItemRow[]>(() => (aberturaDaEdicao ? [...aberturaDaEdicao.itens] : copia?.itens ?? [])); const [plan, setPlan] = React.useState<Plan>(() => (aberturaDaEdicao ? { ...aberturaDaEdicao.plano } : copia?.plano ?? defaultPlan()));
  /* EDITAR-03: na edição, a DEFESA do handler (`itensNaEdicaoDeVenda`): o que a PATCH recusa nos itens volta ao anterior
     (a parte gerada não remove nem acrescenta; o campo travado não muda; a cópia de um item salvo é item novo). */
  const setItems = limites ? (novos: ItemRow[]) => setItemsDoEstado((antes) => itensNaEdicaoDeVenda(antes, novos, limites)) : setItemsDoEstado;
  const [confirmarTroca, setConfirmarTroca] = React.useState(false);
  React.useEffect(() => { if (!semeiaNaAbertura(modo, "empresaPadrao")) return; setH((o) => ({ ...o, empresa_id: o.empresa_id || empresa })); }, [empresa, modo]);

  /**
   * LAYOUT DO DOCUMENTO (VENDAS-A3-1): SÓ com `capacidades.layoutDocumento` EXATA. Sem ela nenhuma pergunta sai e a
   * tela é a de hoje (a estrutura usada para desenhar é `LAYOUT_DO_SISTEMA`, que É a tela de hoje, e nenhum
   * `data-campo` nem cobrança nova aparece). Com ela, a TOP escolhida (trocar a TOP remonta este formulário, então a
   * chave é `top.id`) pergunta o layout efetivo; enquanto ele não chega, ou se não chega conferido, o Salvar trava:
   * gravar sem saber o que é obrigatório seria descobrir no 422.
   */
  /* A família vem do SERVIDOR (`family.code` de `/operation-types`) — o cliente não enumera famílias. Guardada ao
     montar: um refetch adverso não pode desmontar a estrutura da tela. */
  const familiaAgora = estadoTop.situacao === "pronto" ? estadoTop.dados.family.code : "";
  /* EDITAR-03: na edição a família é a do REGISTRO (`kind` do servidor), pela MESMA função que o `/edicao` usa para o
     layout (`familiaOperacionalDeDocumentoVenda`) — `/operation-types` pede `.create` e não é perguntado. */
  const [familiaLayout, setFamiliaLayout] = React.useState(() => (edicao ? familiaOperacionalDeDocumentoVenda(String(edicao.documento["kind"] ?? "")) ?? "" : familiaAgora));
  React.useEffect(() => { if (familiaAgora && familiaAgora !== familiaLayout) setFamiliaLayout(familiaAgora); }, [familiaAgora, familiaLayout]);
  /* EDITAR-03: na edição o layout (o de HOJE da TOP do documento, o que a PATCH cobra) vem no `/edicao` — nenhuma
     pergunta a `/layout-efetivo`, que pede `.create`. */
  const layoutAtivo = modoEdicao || entendeLayoutDocumento(estadoTop);
  const layoutQ = useQuery<unknown, ApiError>({
    queryKey: ["layout-efetivo", kind, top.id],
    queryFn: () => api<unknown>(`/api/sales/${kind}/layout-efetivo?tipo_operacao_id=${encodeURIComponent(top.id)}`),
    enabled: layoutAtivo && !modoEdicao,
    retry: false
  });
  const layoutRecebido = edicao ? edicao.dados.layout : layoutQ.data;
  const layout: EstruturaLayout | null = React.useMemo(() => {
    if (!layoutAtivo || !ehObj(layoutRecebido)) return null;
    return ehEstruturaLayout(layoutRecebido.estrutura) ? layoutRecebido.estrutura : null;
  }, [layoutAtivo, layoutRecebido]);
  const layoutPendente = layoutAtivo && !layout;
  /**
   * TOP-CONFIG-05 exigências — AS REGRAS DA OPERAÇÃO (decisão 263). SÓ com `capacidades.regrasDaOperacao` EXATA; sem ela
   * `regrasAtivo` é falso, nenhuma pergunta sai, `regras` é null, `exigidos` é vazio e a Central é a de hoje, idêntica.
   * Com ela, enquanto as regras não chegam conferidas o Salvar trava (como com `layoutPendente`). `regras` e
   * `regrasPendente` ficam neste escopo para a condição (W5) e a faixa de atraso (W6).
   */
  /* EDITAR-03: na edição as regras são as da versão CONGELADA, no `/edicao` (a MESMA forma de `/regras-da-operacao`,
     lida pelo MESMO leitor) — nenhuma pergunta à porta do lançamento, que pede `.create` e responde pela versão ATUAL.
     Fora da forma: as regras "pendentes" para sempre, e o Salvar trava (a abertura já recusa essa resposta antes). */
  const regrasAtivo = modoEdicao || entendeRegrasDaOperacao(estadoTop);
  const daCriacao = useRegrasDaOperacao(kind, top.id, regrasAtivo && !modoEdicao);
  const regrasCruasDaEdicao = edicao?.dados.regras;
  const regrasDaEdicao = React.useMemo(() => (regrasCruasDaEdicao !== undefined ? lerRegrasDaOperacao(regrasCruasDaEdicao) : null), [regrasCruasDaEdicao]);
  const { regras, pendente: regrasPendente } = modoEdicao ? { regras: regrasDaEdicao, pendente: regrasDaEdicao === null } : daCriacao;
  /* OPERACOES-01 F2 (decisão 279): as regras gerais da versão atual da TOP, como o servidor as declarou. Sem a
     capacidade, sem resposta ainda, ou API anterior (bloco ausente): o neutro — "Salvar" e "ao menos um item", os de antes. */
  const regrasGerais = regras?.regrasGerais ?? REGRAS_GERAIS_NEUTRAS;
  /* TOP-CONFIG-05 condição: a lista permitida da versão atual (null = sem restrição). Declarada aqui, antes de qualquer
     leitura de padrão de cadastro, para `padraoNaoPermitido` nunca ler antes da inicialização. */
  const condicoesPermitidas = regras?.condicoesPermitidas ?? null;
  const exigidos = React.useMemo(() => new Set<string>(regras?.exigencias ?? []), [regras]);
  /**
   * TOP-CONFIG-07 — A RESERVA DE ESTOQUE da versão atual da TOP. Só com as regras conferidas (`reservaEstoque === true`;
   * ausente = API anterior = a Central de hoje) E na família do PEDIDO, perguntada ao SSOT do domínio contra a família
   * que o SERVIDOR declarou para esta TOP. Com ela: o armazém do item ganha "*" (coluna e formulário), a célula Estoque
   * mostra o disponível do armazém, e o 422 da reserva cai no item. Apresentação — quem recusa é o servidor.
   */
  const reservaAtiva = regras?.reservaEstoque === true && familiaLayout !== "" && familiaLayout === familiaOperacionalDeDocumentoVenda("order");
  const reservaDosItens = React.useMemo(() => (reservaAtiva ? { obrigatorias: CAMPOS_DO_ITEM_EXIGIDOS_PELA_RESERVA } : null), [reservaAtiva]);
  /**
   * VENDAS-A3-1d: a linha "Layout: …" no topo de Dados principais. Só com a capacidade do layout E a resposta conferida
   * (`layout` só existe assim) — sem a capacidade, nada: a Central de hoje, idêntica. `can` só decide se o atalho
   * "Configurar" aparece (apresentação); quem nega o configurador é a rota.
   */
  const { can } = useAuth();
  const layoutVale = React.useMemo(() => (layout ? layoutQueVale(layoutRecebido) : null), [layout, layoutRecebido]);
  const estrutura = React.useMemo(() => layout ?? LAYOUT_DO_SISTEMA(familiaLayout), [layout, familiaLayout]);
  /**
   * TOP-CONFIG-05 exigências — A EXIGÊNCIA DA TOP VENCE O LAYOUT. Campo exigido que o layout vigente não desenha
   * (nem no cabeçalho nem em aba alguma) entra mesmo assim, EDITÁVEL, na zona onde `LAYOUT_DO_SISTEMA` o põe: cabeçalho
   * → fim de Dados principais (sem `grupo`, para não mudar a zona dos outros campos); rodapé → a aba de mesmo nome do
   * sistema (criada no fim, se o layout não a tem). Não entra em `cfg`: rótulo de hoje, sem padrão, sem trava. Só governa
   * o DESENHO — a cobrança do layout continua lendo `layout`. Sem exigências, é `estrutura`, o mesmo objeto.
   */
  const estruturaDesenhada = React.useMemo((): EstruturaLayout => {
    if (!exigidos.size) return estrutura;
    const desenhados = new Set([...estrutura.cabecalho.map((x) => x.campo), ...estrutura.rodape.flatMap((a) => a.campos.map((x) => x.campo))]);
    const faltam = [...exigidos].filter((c) => !desenhados.has(c));
    if (!faltam.length) return estrutura;
    const sistema = LAYOUT_DO_SISTEMA(familiaLayout);
    const cabecalho = [...estrutura.cabecalho];
    const rodape = estrutura.rodape.map((a) => ({ ...a, campos: [...a.campos] }));
    for (const c of faltam) {
      const sintetico: CampoDoLayout = { campo: c, obrigatorio: false, editavel: true };
      if (sistema.cabecalho.some((x) => x.campo === c)) { cabecalho.push(sintetico); continue; }
      const abaDoSistema = sistema.rodape.find((a) => a.campos.some((x) => x.campo === c));
      if (!abaDoSistema) continue;
      const aba = rodape.find((a) => a.aba === abaDoSistema.aba);
      if (aba) aba.campos.push(sintetico); else rodape.push({ aba: abaDoSistema.aba, campos: [sintetico] });
    }
    return { ...estrutura, cabecalho, rodape };
  }, [estrutura, exigidos, familiaLayout]);
  /** VENDAS-A3-1c: os campos de "Dados adicionais" segundo o layout — abre o grupo quando um deles tem erro. */
  const adicionaisDoLayout = React.useMemo(() => new Set(camposAdicionaisDoCabecalho(estrutura)), [estrutura]);
  /** Configuração do layout por chave (cabeçalho e rodapé) — só com layout de verdade. */
  const cfg = React.useMemo(() => new Map<string, CampoDoLayout>(layout ? [...layout.cabecalho, ...layout.rodape.flatMap((a) => a.campos)].map((x) => [x.campo, x]) : []), [layout]);
  const rotuloDoCatalogo = React.useMemo(() => new Map(catalogoDaFamilia(familiaLayout).filter((c) => c.parte !== "itens").map((c) => [c.chave, c.rotulo])), [familiaLayout]);
  /**
   * PADRÃO DE CADASTRO (VENDAS-A3-1b): só com layout de verdade, e só em campo de cabeçalho/rodapé que o CATÁLOGO declara
   * de referência (dono único: `referencia` em `@agro/domain`) e que o layout desenha. Chave de outro campo não vale.
   */
  /* EDITAR-03: na edição, padrão de cadastro nenhum vale (nem é aplicado, nem vira "padrão inválido"): o gravado fica. */
  const padroes = React.useMemo(() => (layout && semeiaNaAbertura(modo, "padraoDeCadastro") ? padroesDaResposta(layoutRecebido) : SEM_PADROES), [layout, layoutRecebido, modo]);
  const camposDeCadastro = React.useMemo(() => new Set(catalogoDaFamilia(familiaLayout).filter((c) => c.parte !== "itens" && c.referencia).map((c) => chavePadraoDeCadastro(c.parte, c.chave))), [familiaLayout]);
  const doLayoutComCadastro = (chave: string) => Boolean(layout) && camposDeCadastro.has(chave) && cfg.has(chave);
  /** O padrão que vale agora para o campo (null: nenhum). */
  const padraoDoCampo = (chave: string) => (doLayoutComCadastro(chave) && !padraoNaoPermitido(chave) ? padroes.validos.get(chave) ?? null : null); // TOP-CONFIG-05 condição: padrão não permitido não vale
  /** O padrão do campo morreu no cadastro: nada é aplicado, o aviso aparece e o campo fica editável nesta abertura. */
  const padraoInvalido = (chave: string) => doLayoutComCadastro(chave) && (padroes.invalidos.has(chave) || padraoNaoPermitido(chave)); // TOP-CONFIG-05 condição: não permitido = padrão inválido

  /**
   * O QUE CONTA COMO "TEM COISA DIGITADA".
   *
   * A comparação é com o estado INICIAL, capturado no primeiro render — não com uma lista de campos
   * escrita à mão, que envelheceria calada no dia em que o formulário ganhasse um campo novo.
   *
   * `empresa_id` fica FORA da comparação porque não é digitação: ele é preenchido por efeito, com a
   * empresa padrão do usuário, milissegundos depois da montagem. Incluí-lo faria todo formulário
   * nascer "sujo" e transformaria o aviso de perda de dados em ruído que se aprende a ignorar — que é
   * como um aviso deixa de proteger.
   */
  const inicial = React.useRef(branco); // VISUAL-UX-02 W1: a abertura, nunca a cópia do Duplicar
  const semEmpresa = ({ empresa_id: _, ...resto }: typeof h) => resto;
  const sujo = items.length > 0 || JSON.stringify(semEmpresa(h)) !== JSON.stringify(semEmpresa(inicial.current));
  /* EDITAR-03: o `useDirtyTab` desceu para depois do corpo da PATCH — na edição, "tem coisa digitada" é a PATCH mudar
     alguma coisa (`alterado`, a MESMA conta do corpo); na criação, `alterado` é este `sujo`, o de sempre. */

  /**
   * VALOR PADRÃO DO LAYOUT, aplicado ao ABRIR (quando o layout chega), só a campo ainda intocado — o valor digitado
   * nunca é sobrescrito. O estado inicial acompanha, para o padrão não contar como "tem coisa digitada".
   */
  const padroesAplicados = React.useRef<EstruturaLayout | null>(null);
  React.useEffect(() => {
    if (!semeiaNaAbertura(modo, "padraoDoLayout")) return; /* EDITAR-03: a edição abre o gravado — padrão nenhum */
    if (!layout || padroesAplicados.current === layout) return;
    padroesAplicados.current = layout;
    if (copia) return; /* VISUAL-UX-02 W1: padrão de layout nenhum sobrescreve a cópia do Duplicar */
    const novos: Partial<typeof h> = {};
    for (const x of [...layout.cabecalho, ...layout.rodape.flatMap((a) => a.campos)]) {
      if (!x.valorPadrao || !(x.campo in inicial.current)) continue;
      const v = valorDoPadrao(x.valorPadrao, empresa);
      if (v === null) continue;
      Object.assign(novos, { [x.campo]: v });
    }
    if (!Object.keys(novos).length) return;
    const antes = inicial.current;
    inicial.current = { ...antes, ...novos };
    setH((o) => {
      const r = { ...o };
      for (const [k, v] of Object.entries(novos)) if (JSON.stringify(o[k as keyof typeof o]) === JSON.stringify(antes[k as keyof typeof antes]) || k === "empresa_id") Object.assign(r, { [k]: v });
      return r;
    });
  }, [layout, empresa, copia, modo]);

  /* VISUAL-UX-02 W1: depois do POST abre o documento salvo, como sempre, deixando em memória o "Salvo" e — quando o
     clique foi "Confirmar venda" — o pedido de abrir o diálogo de Confirmar venda (com a prévia do servidor).
     OPERACOES-01 F2 (decisão 279): o POST é o do motor (`useCriarDocumento`) — a mesma chave de idempotência e o mesmo
     erro de antes, e o aviso lido da RESPOSTA (`confirmacaoAutomatica`): "Salvo e confirmado.", aguardando aprovação,
     sem permissão, recusada — ou, sem a chave, o "Salvo com sucesso" de antes. Um aviso por Salvar. */
  const confirmarDepois = React.useRef(false);
  const create = useCriarDocumento<RespostaDoSalvar>(`/api/sales/${kind}`, (r) => { const depois: DepoisDeSalvar = { confirmar: confirmarDepois.current }; entregarEmMemoria(chaveDepoisDeSalvar(r.id), depois); router.push(`/vendas/${kind}/${r.id}`); });
  /**
   * CLASSIFICAÇÃO FINANCEIRA (VENDAS-A1): só existe na tela quando a API DECLARA que a entende. Obrigatória
   * nas TRÊS variantes: documento salvo não tem edição aqui e a conversão só copia — pedido sem
   * classificação viraria venda sem classificação, sem conserto.
   */
  /* EDITAR-03: na edição, a capacidade é a do REGISTRO — o documento do servidor traz a coluna (`/operation-types`, que a
     declararia, pede `.create`). O mesmo para a condição de pagamento, abaixo. */
  const classificacaoAtiva = edicao ? Object.hasOwn(edicao.documento, "categoria_financeira_id") : entendeClassificacaoFinanceira(estadoTop);
  /**
   * CONDIÇÃO DE PAGAMENTO (VENDAS-A4): só existe na tela quando a API DECLARA que a entende. Escolhida, o plano
   * mostrado é o de `planoDaCondicao` (a MESMA conta da API) sobre a data e o total do documento (`documentTotals`,
   * o MESMO total da API). Enquanto o usuário não mexe no plano, o corpo leva `installment_plan: null` e o servidor
   * deriva; mexeu em qualquer campo do plano → AJUSTE: o corpo leva o plano e a tela para de recalcular.
   */
  const condicaoAtiva = edicao ? Object.hasOwn(edicao.documento, "condicao_pagamento_id") : entendeCondicaoPagamento(estadoTop);
  const condicaoId = condicaoAtiva ? h.condicao_pagamento_id : "";
  const [ajustado, setAjustado] = React.useState(() => aberturaDaEdicao?.ajustado ?? false); // EDITAR-03: o gravado (`parcelas_ajustadas`)
  const condicao = useQuery({
    queryKey: ["condicao-pagamento", condicaoId],
    queryFn: () => api<Record<string, unknown>>(`/api/resources/condicoes_pagamento/${encodeURIComponent(condicaoId)}`),
    enabled: Boolean(condicaoId)
  });
  const planoCalculado = React.useMemo(() => {
    const r = condicao.data;
    if (!condicaoId || !r) return null;
    const c = normalizarCondicaoPagamento({
      parcelas: Number(r["parcelas"]), dias_primeira_parcela: Number(r["dias_primeira_parcela"]), modo: r["modo"] as CondicaoPagamento["modo"],
      intervalo_dias: Number(r["intervalo_dias"]), dia_vencimento: r["dia_vencimento"] === null || r["dia_vencimento"] === undefined ? null : Number(r["dia_vencimento"]),
      entrada: r["entrada"] === true, entrada_percentual: (r["entrada_percentual"] ?? null) as CondicaoPagamento["entrada_percentual"]
    });
    if (validarCondicaoPagamento(c).length) return null;
    try {
      const { total } = documentTotals(items.map((i) => ({ quantity: i.quantity, unitPrice: i.unit_value ?? "0", discount: i.discount || "0", discountPercent: i.discount_percent || "0" })), { freight: h.freight || "0", freightIcms: h.freight_icms || "0", otherValues: h.other_values || "0", discount: h.discount || "0" });
      return planoDaCondicao(c, { dataDocumento: h.document_date, total }) as Plan;
    } catch { return null; }
  }, [condicaoId, condicao.data, items, h.freight, h.freight_icms, h.other_values, h.discount, h.document_date]);
  /** Sem ajuste, a data ou o total mudou → o plano mostrado acompanha. Ajustado, a tela não recalcula mais.
   *  EDITAR-03: na edição, só quando a PATCH também refaria o plano (`recalculaPlanoDaCondicao`); senão fica o GRAVADO. */
  const recalculaPlano = recalculaPlanoDaCondicao(modo, aberturaDaEdicao, { cabecalho: h, itens: items, plano: plan, ajustado });
  React.useEffect(() => { if (planoCalculado && !ajustado && recalculaPlano) setPlan(planoCalculado); }, [planoCalculado, ajustado, recalculaPlano]);
  const escolherCondicao = (v: string | null) => {
    setH((o) => ({ ...o, condicao_pagamento_id: v ?? "" }));
    setAjustado(false);
    if (!v) setPlan(defaultPlan());
  };
  const ajustarPlano = (p: Plan) => { setPlan(p); setAjustado(true); };

  /* ── TOP-CONFIG-05 condição (W5) ──────────────────────────────────────────────────────────────────────────────
   * CONDIÇÕES PERMITIDAS (decisão 263): SÓ com `capacidades.regrasDaOperacao` EXATA (`entendeRegrasDaOperacao`); sem
   * ela `regras` é null, nenhuma pergunta sai e a condição é a de hoje. Com a lista NÃO nula da versão atual da TOP:
   * o RefSelect só oferece as permitidas (`somenteIds`); o PADRÃO de cadastro da condição fora da lista não é aplicado
   * e aparece como padrão inválido (`padraoDoCampo`/`padraoInvalido` acima); e o valor escolhido que deixa de ser
   * permitido (as regras chegaram ou mudaram) é limpo pelo MESMO caminho da escolha manual (`escolherCondicao`).
   * Apresentação — quem recusa é o servidor (`CONDICAO_PAGAMENTO_NAO_PERMITIDA`). */
  // `regras` vem do bloco "TOP-CONFIG-05 exigências" (uma pergunta só por TOP); `condicoesPermitidas` é lida lá em cima.
  const condicaoNaoPermitida = (id: string) => condicoesPermitidas !== null && id !== "" && !condicoesPermitidas.some((x) => x.toLowerCase() === id.toLowerCase());
  function padraoNaoPermitido(chave: string): boolean {
    return chave === "condicao_pagamento_id" && condicaoNaoPermitida(padroes.validos.get(chave)?.id ?? "");
  }
  React.useEffect(() => {
    if (!semeiaNaAbertura(modo, "limpezaDaCondicao")) return; /* EDITAR-03: a edição não limpa a condição gravada */
    if (!condicaoNaoPermitida(h.condicao_pagamento_id)) return;
    // o padrão aplicado ao abrir (antes de as regras chegarem) sai também do estado inicial: retirá-lo não é digitação
    if (inicial.current.condicao_pagamento_id === h.condicao_pagamento_id) inicial.current = { ...inicial.current, condicao_pagamento_id: "" };
    escolherCondicao(null);
  }, [h.condicao_pagamento_id, condicaoNaoPermitida, escolherCondicao, modo]);
  /* ── fim TOP-CONFIG-05 condição ── */
  /* VISUAL-UX-02 Fase B (decisão 270 (5)): natureza e centro deixam de DESABILITAR o Salvar e viram PENDÊNCIA DE CLIQUE —
     a mesma checagem de antes (só com a classificação ativa), agora campo a campo, conferida no `submit`. */
  const semNatureza = classificacaoAtiva && !h.categoria_financeira_id;
  const semCentro = classificacaoAtiva && !h.centro_custo_id;
  /*
   * TOP-CONFIG-05 atraso — SÓ com `capacidades.regrasDaOperacao` EXATA (`entendeRegrasDaOperacao`). Sem ela o hook
   * fica desligado (nenhum `/situacao-cliente` sai), a faixa não existe e o Salvar é o de hoje. "bloqueia" com atraso
   * trava o Salvar (no botão E no `submit`); trocar para cliente em dia destrava. O 422 `CLIENTE_EM_ATRASO` do
   * servidor (a autoridade) aparece no campo Cliente até o cliente mudar.
   */
  // `regrasAtivo`/`regras` vêm do bloco "TOP-CONFIG-05 exigências". Só pergunta quando a política da versão atual valida.
  const { situacao: situacaoDaPorta } = useSituacaoCliente(kind, h.client_id, top.id, !modoEdicao && regrasAtivo && regras !== null && regras.clienteEmAtraso.politica !== "nao_valida");
  /* EDITAR-03: na edição nenhuma pergunta sai (`/situacao-cliente` pede `.create`); a situação é a do cliente GRAVADO, do
     `/edicao`, e só o "avisa" aparece com ele — a PATCH só confere o atraso quando o cliente MUDA
     (`situacaoDoAtrasoNaEdicao`). Com o cliente trocado, o 422 `CLIENTE_EM_ATRASO` cai no campo (`aoRecusarAtraso`). */
  const situacaoCruaDaEdicao = edicao?.dados.situacaoCliente;
  const situacaoDaEdicao = React.useMemo(() => (edicao ? lerSituacaoCliente(situacaoCruaDaEdicao) : null), [edicao, situacaoCruaDaEdicao]);
  const situacaoAtraso = edicao ? situacaoDoAtrasoNaEdicao(situacaoDaEdicao, String(edicao.documento["client_id"] ?? ""), h.client_id) : situacaoDaPorta;
  const atrasoTravaSalvar = regrasAtivo && bloqueiaSalvar(situacaoAtraso);
  const [erroAtraso, setErroAtraso] = React.useState<{ cliente: string; mensagem: string } | null>(null);
  const erroAtrasoDoCliente = erroAtraso && erroAtraso.cliente === h.client_id ? erroAtraso.mensagem : undefined;
  const aoRecusarAtraso = (e: unknown) => { if (regrasAtivo && e instanceof ApiError && e.code === ERRO_CLIENTE_EM_ATRASO) setErroAtraso({ cliente: h.client_id, mensagem: e.message }); };
  /* fim TOP-CONFIG-05 atraso */
  /** O corpo do POST — o MESMO objeto que a cobrança do layout confere antes de sair. */
  const corpo = () => ({ empresa_id: h.empresa_id, document_date: h.document_date, shipping_date: h.shipping_date || null, due_date: h.due_date || null, client_id: h.client_id, transporter_id: h.transporter_id || null, proprietary_id: h.proprietary_id || null, driver_name: h.driver_name || null, payment_method_id: h.payment_method_id || null, freight: h.freight || "0", freight_icms: h.freight_icms || "0", other_values: h.other_values || "0", discount: h.discount || "0", note: h.note || null, is_deductible: h.is_deductible, installment_plan: condicaoId ? (ajustado ? plan : null) : (h.installments ? plan : null), items: items.map((i) => ({ product_id: i.product_id, warehouse_id: i.warehouse_id || null, quantity: i.quantity, unit_price: i.unit_value ?? "0", discount: i.discount || "0", discount_percent: i.discount_percent || "0", note: typeof i["note"] === "string" && i["note"] ? i["note"] : null })), tipo_operacao_id: top.id, ...(classificacaoAtiva ? { categoria_financeira_id: h.categoria_financeira_id, centro_custo_id: h.centro_custo_id } : {}), ...(condicaoId ? { condicao_pagamento_id: condicaoId } : {}) });

  /**
   * EDITAR-03 — O CORPO DA PATCH: `{ version, ...só o que mudou }` contra a ABERTURA (`corpoDaEdicaoDeVenda`), com a
   * versão que o `/edicao` conferiu. As conferências da tela (pendências, obrigatórios do layout, exigências da TOP)
   * continuam sobre `corpo()` — o documento COMO FICARÁ —, que é o que o servidor confere também.
   */
  const corpoDaPatch = (): Record<string, unknown> => (edicao && aberturaDaEdicao
    ? corpoDaEdicaoDeVenda({ version: edicao.dados.version, abertura: aberturaDaEdicao, atual: { cabecalho: h, itens: items, plano: plan, ajustado }, campos: { classificacao: classificacaoAtiva, condicao: condicaoAtiva } })
    : {});
  /* Na edição, "tem coisa digitada" = a PATCH mudaria alguma coisa; na criação, o `sujo` de sempre. */
  const alterado = modoEdicao ? mudouAlgo(corpoDaPatch()) : sujo;
  useDirtyTab(alterado);

  /**
   * OBRIGATÓRIOS DO LAYOUT: a MESMA função do domínio que a API usa (`camposObrigatoriosFaltando`), sobre o MESMO
   * corpo. Depois da primeira tentativa de salvar, os erros acompanham a digitação; os do servidor (422
   * LAYOUT_CAMPO_OBRIGATORIO) ficam até a próxima tentativa.
   */
  const [tentouSalvar, setTentouSalvar] = React.useState(false);
  const [errosServidor, setErrosServidor] = React.useState<Record<string, string>>({});
  const faltando = () => (layout ? camposObrigatoriosFaltando(familiaLayout, layout, corpo(), { classificacao: classificacaoAtiva, condicao: condicaoAtiva }) : []);
  const errosLocais: Record<string, string> = layout && tentouSalvar ? Object.fromEntries(faltando().map((f) => [f.caminho, mensagemCampoObrigatorio(f.rotulo)])) : {};
  /**
   * TOP-CONFIG-05 exigências: a MESMA régua da API (`exigenciasFaltandoPorCampos`) sobre o MESMO corpo do POST. Sem
   * `regras` (sem a capacidade) nada é conferido e `erros` é exatamente o de antes. A mensagem da exigência vence a do
   * layout no mesmo campo (é a regra mais estrita que a API cobra primeiro).
   */
  const exigenciasFaltando = () => (regras ? exigenciasFaltandoPorCampos(regras.exigencias, corpo()) : []);
  const errosExigencia: Record<string, string> = regras && tentouSalvar ? Object.fromEntries(exigenciasFaltando().map((f) => [f.caminho, `${f.rotulo} é obrigatório nesta operação.`])) : {};
  /* VISUAL-UX-02 W1: a pendência de Cliente marca o campo mesmo sem layout (o clique com pendência não envia nada).
     Fase B: natureza e centro (com a classificação ativa) também. */
  const errosDePendencia: Record<string, string> = tentouSalvar ? {
    ...(!h.client_id ? { client_id: "Selecione um cliente." } : {}),
    ...(semNatureza ? { categoria_financeira_id: PENDENCIA_NATUREZA } : {}),
    ...(semCentro ? { centro_custo_id: PENDENCIA_CENTRO } : {})
  } : {};
  const erros: Record<string, string> = layout || regras ? { ...errosDePendencia, ...errosServidor, ...errosLocais, ...errosExigencia } : errosDePendencia;
  const [maisDados, setMaisDados] = React.useState(false);
  /** TOP-CONFIG-05 exigências: 422 TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA (`details.exigencias` [{caminho, mensagem}]) → erro no campo. */
  const errouExigencia = (e: unknown): boolean => {
    if (!(e instanceof ApiError) || e.code !== ERRO_EXIGENCIA_NAO_ATENDIDA) return false;
    const m = errosDoServidor(ehObj(e.details) ? e.details.exigencias : undefined);
    setErrosServidor(m);
    if (Object.keys(m).some((k) => adicionaisDoLayout.has(k))) setMaisDados(true);
    return true;
  };
  /**
   * TOP-CONFIG-07 — 422 `VALIDATION_ERROR` da reserva (`details [{path: "items[i].warehouse_id", message}]`) → erro no
   * item. SÓ os caminhos de item da reserva; outro VALIDATION_ERROR (e o de disponível insuficiente, `path: "items"`)
   * segue no aviso geral, com a mensagem do servidor. Vale mesmo que a reserva tenha sido ligada depois de a Central
   * abrir: o servidor confere a versão ATUAL no POST.
   */
  const errouReserva = (e: unknown): boolean => {
    if (!(e instanceof ApiError) || e.code !== "VALIDATION_ERROR") return false;
    const m = Object.fromEntries(Object.entries(errosDoServidor(e.details)).filter(([caminho]) => ehCaminhoDeItemDaReserva(caminho)));
    if (!Object.keys(m).length) return false;
    setErrosServidor(m);
    return true;
  };
  /* ── EDITAR-03 — O SALVAR DA EDIÇÃO: a PATCH, o 409, o 422 e o aviso do Salvar que confirma ───────────────────────────
   * A PATCH leva a chave de idempotência da edição: a MESMA até o servidor RECUSAR (`trocaAChaveDaEdicao`); "Recarregar"
   * remonta o formulário, e a chave é nova. 409 `CONCURRENCY_CONFLICT` ⇒ o conflito, com a oferta de recarregar: nada é
   * sobrescrito, e o rascunho fica até a pessoa escolher. Outra recusa ⇒ a mensagem do servidor no campo (o caminho de
   * `details`, o MESMO mapa da criação: `items[k].<chave>` na linha, o resto no campo do cabeçalho) e no aviso. Gravou ⇒
   * o aviso do motor pela RESPOSTA (`avisarSalvo`: "Salvo e confirmado.", aprovação pendente, recusada, ou "Salvo com
   * sucesso") e a volta à consulta, relida. */
  const qc = useQueryClient();
  const chaveDaPatch = React.useRef(newIdem());
  const [conflito, setConflito] = React.useState<string | null>(null);
  const [avisoAberto, setAvisoAberto] = React.useState(false);
  const [aberturasDoAviso, setAberturasDoAviso] = React.useState(0);
  const idEmEdicao = edicao ? String(edicao.documento["id"] ?? "") : "";
  const varianteEmEdicao = edicao ? String(edicao.documento["kind"] ?? "") : "";
  const codigoEmEdicao = edicao ? String(edicao.documento["code"] ?? "") : "";
  const patch = useMutation<RespostaDoSalvar, Error, Record<string, unknown>>({
    mutationFn: (c) => api<RespostaDoSalvar>(portaDoDocumentoDeVenda(kind, idEmEdicao), { method: "PATCH", body: c, idempotencyKey: chaveDaPatch.current }),
    onSuccess: (r) => { setAvisoAberto(false); avisarSalvo(r); void qc.invalidateQueries(); edicao?.onFechar(true); },
    onError: (e) => {
      setAvisoAberto(false);
      if (trocaAChaveDaEdicao(e)) chaveDaPatch.current = newIdem();
      const mudou = conflitoDaEdicaoDeVenda(e);
      if (mudou) { setErrosServidor({}); setConflito(mudou); return; }
      aoRecusarAtraso(e);
      if (!errouExigencia(e) && e instanceof ApiError) {
        const m = errosDoServidor(e.details);
        setErrosServidor(m);
        if (Object.keys(m).some((k) => adicionaisDoLayout.has(k))) setMaisDados(true);
      }
      toast.error(e.message);
    }
  });
  const enviarPatch = () => { if (edicao && !patch.isPending) patch.mutate(corpoDaPatch()); };
  /* ITEM 2 (A0: avisar antes): a PATCH desta venda CONFIRMA — o Salvar abre o aviso e NÃO manda nada; só `confirmarAviso`
     manda. O corpo do diálogo é a PRÉVIA do servidor (`sales.view`), perguntada de novo a cada abertura. */
  const avisaAntes = avisaAntesDeSalvar({ modo, variante: varianteEmEdicao, regrasGerais, corpo: corpoDaPatch() });
  const previaDoAviso = usePreviaDaConfirmacao(idEmEdicao, avisoAberto && varianteEmEdicao === "sale", aberturasDoAviso);
  const salvarAEdicao = () => {
    if (avisaAntes) { setAberturasDoAviso((n) => n + 1); setAvisoAberto(true); return; }
    enviarPatch();
  };
  /* ── VISUAL-UX-02 W1 — SALVAR COM PENDÊNCIAS ───────────────────────────────────────────────────────────────────
   * Clique com pendência de CAMPO não envia NADA: marca os campos (o mesmo `tentouSalvar` de antes) e mostra a pílula
   * "N pendências" com a lista, que leva a cada campo. As checagens são as de antes — cliente, itens, produto do item,
   * exigências da TOP, obrigatórios do layout — e a guarda mora no HANDLER (`submit`), não no `disabled`. O que NÃO é
   * pendência de campo continua DESABILITANDO o botão: TOP não confirmada, layout ou regras carregando/com falha,
   * cliente em atraso que bloqueia. Fase B: natureza e centro (com a classificação ativa) saíram do `disabled` e são
   * pendência de campo, como o Cliente — a guarda é a deste handler; o layout que também os cobra não repete a linha
   * (a lista é por caminho). */
  const [pendenciasAbertas, setPendenciasAbertas] = React.useState(false);
  const pendenciasDoSalvar = (): Pendencia[] => {
    const lista = new Map<string, Pendencia>();
    const anotar = (caminho: string, rotulo: string, mensagem: string) => { if (!lista.has(caminho)) lista.set(caminho, { caminho, rotulo, mensagem }); };
    if (!h.client_id) anotar("client_id", cfg.get("client_id")?.rotulo || "Cliente", "Selecione um cliente.");
    if (semNatureza) anotar("categoria_financeira_id", cfg.get("categoria_financeira_id")?.rotulo || "Natureza", PENDENCIA_NATUREZA);
    if (semCentro) anotar("centro_custo_id", cfg.get("centro_custo_id")?.rotulo || "Centro de resultado", PENDENCIA_CENTRO);
    /* OPERACOES-01 F2: "ao menos um item" só não vale quando o servidor declarou que esta TOP aceita documento sem
       itens; o produto vazio numa linha que existe continua pendência (abaixo). */
    if (!items.length && exigeAoMenosUmItem(regrasGerais)) anotar("items", "Itens", "Adicione ao menos um item.");
    items.forEach((it, i) => { if (!it.product_id) anotar(`items[${i}].product_id`, `Item ${i + 1}`, "Selecione o produto."); });
    for (const f of exigenciasFaltando()) anotar(f.caminho, f.rotulo, `${f.rotulo} é obrigatório nesta operação.`);
    for (const f of faltando()) anotar(f.caminho, f.rotulo, mensagemCampoObrigatorio(f.rotulo));
    return [...lista.values()];
  };
  /** A lista leva ao campo: item → a região Itens (a marcação da linha é da Fase B); campo de aba → abre a aba; campo
   *  de "Dados adicionais" → abre o grupo; e o foco vai ao controle do campo. Só DOM da própria Central, pelo rótulo. */
  const irParaPendencia = (p: Pendencia) => {
    const central = document.querySelector<HTMLElement>('[data-testid="central-vendas"]');
    if (!central) return;
    const controle = (raiz: Element | null | undefined) => raiz?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)") ?? null;
    const focar = (el: HTMLElement | null) => { if (!el) return; el.scrollIntoView({ block: "nearest" }); el.focus(); };
    if (p.caminho.startsWith("items")) {
      const regiao = central.querySelector<HTMLElement>('[data-testid="central-vendas-itens"]');
      const i = /^items\[(\d+)\]/.exec(p.caminho)?.[1];
      const linha = i === undefined ? null : central.querySelectorAll('[data-testid="central-vendas-linha"]')[Number(i)];
      focar(controle(linha) ?? controle(regiao));
      return;
    }
    const chave = p.caminho.split(/[.[]/)[0]!;
    const semMarca = (t: string) => t.replace(/[*:]/g, "").replace(/\s+/g, " ").trim();
    const achar = () => controle(central.querySelector(`[data-campo="${chave}"]`))
      ?? controle([...central.querySelectorAll("label")].find((l) => semMarca(l.textContent ?? "") === semMarca(p.rotulo))?.parentElement);
    const aba = estruturaDesenhada.rodape.find((a) => a.campos.some((c) => c.campo === chave));
    if (aba) {
      const guia = [...central.querySelectorAll<HTMLElement>('[data-testid="central-vendas-painel"] [role="tab"]')].find((t) => (t.textContent ?? "").trim().startsWith(aba.aba));
      if (guia && guia.getAttribute("aria-selected") !== "true") guia.click();
    } else if (adicionaisDoLayout.has(chave)) setMaisDados(true);
    requestAnimationFrame(() => focar(achar()));
  };

  /** O UUID que vai no corpo é o da TOP VALIDADA contra a lista — nunca o texto cru da URL. */
  const submit = () => {
    /**
     * A DEFESA NO HANDLER, e não só no `disabled` do botão.
     *
     * `disabled` é apresentação: some com uma linha removida por engano, com um clique programático,
     * ou com qualquer caminho que chame `submit` sem passar pelo botão. A regra que impede a gravação
     * de um documento cuja operação não está confirmada tem de estar onde a gravação acontece.
     */
    if (!escritaTopConfirmada) return;
    if (atrasoTravaSalvar) return; /* TOP-CONFIG-05 atraso: a trava também no handler */
    /* TOP-CONFIG-05 exigências: regras pendentes travam; exigência faltando → erro no campo e NADA sai. Sem a
       capacidade `regrasPendente` é falso e `regras` é null: o caminho abaixo é o de antes, linha a linha. */
    if (regrasPendente) return;
    if (layoutPendente) return;
    /* EDITAR-03: nada mudou ⇒ ZERO PATCH — a edição volta à consulta, que continua a mesma (o molde da 313). */
    if (edicao && !mudouAlgo(corpoDaPatch())) { setConflito(null); toast.info(MSG_EDICAO_SEM_MUDANCA); edicao.onFechar(false); return; }
    /* VISUAL-UX-02 W1: pendência de CAMPO = ZERO POST — marca os campos e abre a lista "N pendências". */
    const pendentes = pendenciasDoSalvar();
    if (pendentes.length) {
      setTentouSalvar(true); setErrosServidor({}); setPendenciasAbertas(true);
      if (pendentes.some((x) => adicionaisDoLayout.has(x.caminho))) setMaisDados(true);
      return;
    }
    if (regras) {
      setTentouSalvar(true); setErrosServidor({});
      const fe = exigenciasFaltando();
      if (fe.length) { if ([...fe, ...faltando()].some((x) => adicionaisDoLayout.has(x.caminho))) setMaisDados(true); return; }
    }
    if (!layoutAtivo) { if (regras) create.mutate(corpo(), { onError: (e) => { aoRecusarAtraso(e); if (!errouExigencia(e)) errouReserva(e); } }); else create.mutate(corpo(), regrasAtivo ? { onError: aoRecusarAtraso } : undefined); return; }
    if (!layout) return;
    setTentouSalvar(true); setErrosServidor({});
    const f = faltando();
    if (f.length) { if (f.some((x) => adicionaisDoLayout.has(x.caminho))) setMaisDados(true); return; }
    if (edicao) { setConflito(null); salvarAEdicao(); return; } /* EDITAR-03: a PATCH (ou o aviso), nunca o POST */
    create.mutate(corpo(), {
      onError: (e) => { aoRecusarAtraso(e); /* TOP-CONFIG-05 atraso */ if (regras && errouExigencia(e)) return; if (regras && errouReserva(e)) return; /* TOP-CONFIG-07 */ if (e instanceof ApiError && e.code === ERRO_LAYOUT_CAMPO_OBRIGATORIO) { const m = errosDoServidor(e.details); setErrosServidor(m); if (Object.keys(m).some((k) => adicionaisDoLayout.has(k))) setMaisDados(true); } }
    });
  };

  const voltarAoLancador = () => router.replace(`/vendas/${kind}/new`);
  const alterarOperacao = () => { if (sujo) setConfirmarTroca(true); else voltarAoLancador(); };

  /**
   * A MOLDURA É VISUAL; O CONTRATO CONTINUA AQUI (VISUAL-UX-01, fidelidade na R1).
   *
   * `CentralVendasWorkspace` e `ItensDaCentral` recebem o estado desta função e só o apresentam. Nada de
   * regra saiu daqui — `escritaTopConfirmada`, o guard dentro de `submit`, `podeLancar`, a trava da
   * sessão, o rascunho (`sujo`/`useDirtyTab`) e o payload são os mesmos, linha a linha. O que mudou é
   * ONDE e COMO cada campo aparece:
   *
   *   Dados principais → Cliente, Empresa, Tipo de Operação (travado), Data, Vencimento, Forma de
   *                      pagamento, Data de saída; Proprietário em "Dados adicionais"
   *   Itens            → grade, formulário ou os dois, sobre o MESMO `items`
   *   Totais           → Desconto, Outros valores
   *   Financeiro       → Parcelamento e plano de parcelas
   *   Frete e transporte → Transportadora, Motorista, Frete, ICMS do frete
   *   Fiscal           → Dedutível
   *   Observações      → Observação
   *
   * A BARRA (VISUAL-UX-02, decisão 270): Descartar alterações, Salvar (com pendências) e — só na venda —
   * Confirmar venda (= Salvar + o diálogo de Confirmar venda com a prévia, na consulta que abre); à
   * direita N pendências, Posição do rótulo e o leque de Ações rápidas (Alterar operação, Imprimir e
   * Histórico desabilitados, Documentos abertos). "Editar" e "Anexos" continuam fora (sem contrato).
   */

  /*
    A OPERAÇÃO É CONTEXTO, NÃO IDENTIDADE. Ela aparece como campo travado em Dados principais — o design
    mostra o Tipo de Operação assim —, e nunca no lugar do número do documento: em criação o documento
    ainda NÃO tem número, e exibir o código da TOP ali faria parecer que tem.
    A VERSÃO não aparece de propósito: o que esta tela conhece é a versão CORRENTE no momento da
    escolha, e quem congela a versão do documento é o servidor, no POST. Exibi-la antes de salvar
    prometeria um snapshot que ainda não existe — a versão congelada é mostrada no DETALHE.
  */
  /* VISUAL-UX-02: travado, "<código> · <nome>", como no desenho; o movimento (família) fica na dica do campo. */
  const contextoOperacional = <CampoDaCentral rotulo="Tipo de Operação" estado="travado" testId="top-contexto" dica={familia ? `Movimento: ${familia}` : undefined}>
    <span className={estilosCv.codigo}>{top.code}</span><span className={estilosCv.separador}>·</span><span>{top.name}</span>
  </CampoDaCentral>;

  /*
    POR QUE A ESCRITA ESTÁ BLOQUEADA — dentro do formulário, que continua inteiro.

    A operação da SESSÃO segue no campo travado de Dados principais: ela não é trocada, não é apagada e
    não vira outra. O que some é o direito de gravar, e a razão aparece aqui.

    `MensagemTop` cobre os estados que ela já explica (servidor não confirmado, erro, nenhuma TOP
    cadastrada) — a mesma frase da etapa de escolha, sem segunda redação do mesmo diagnóstico.
    Sobra UM caso que ela não cobre, e que é novo aqui: o servidor está COMPATÍVEL (contrato 1,
    lista válida) e ainda assim a TOP desta sessão não está mais em `items`. Não é falha de
    servidor nem configuração ausente; é a operação escolhida que saiu de circulação. A frase é a
    mesma da recusa do lançador, e continua sem revelar a causa.
  */
  const avisoDeLayout = layoutPendente && (modoEdicao || layoutQ.isError || (layoutQ.isSuccess && !layout)) && <div className="rounded-md bg-amber-50 p-3">
    <p data-testid="layout-nao-carregado" className="text-sm text-amber-700">Não foi possível carregar o layout deste Tipo de Operação. O lançamento está bloqueado até ele ser carregado.</p>
  </div>;
  /* O texto fica sozinho no <p> (o E2E confere o texto exato); o atalho "Configurar" vai ao lado, fora dele. */
  const linhaDoLayout = layoutVale && <div className="flex flex-wrap items-baseline gap-x-2">
    <p data-testid="central-layout-efetivo" data-origem={layoutVale.origem} data-layout-id={layoutVale.id ?? ""} className="text-[11.5px] text-slate-500">{textoDoLayoutQueVale(layoutVale)}</p>
    {can("tipos_operacao.edit") && <Link data-testid="central-layout-configurar" href={hrefDoConfigurador(layoutVale)} className="text-[11.5px] font-medium text-emerald-700 hover:underline">Configurar</Link>}
  </div>;
  const avisoDeEscrita = !escritaTopConfirmada && <div className="space-y-1 rounded-md bg-amber-50 p-3">
    <MensagemTop estado={estadoTop} />
    {estadoTop.situacao === "pronto" && <p data-testid="top-indisponivel" className="text-sm text-amber-800">
      O Tipo de Operação selecionado não está disponível para este lançamento.
    </p>}
    <p className="text-xs text-amber-700">
      O que já foi preenchido continua aqui. Use “Alterar operação” para escolher outra.
    </p>
  </div>;

  /**
   * CADA CAMPO DESENHADO PELA ESTRUTURA (VENDAS-A3-1). Sem layout (sem a capacidade) a estrutura é `LAYOUT_DO_SISTEMA`
   * — a ordem, os rótulos e as abas de hoje — e nada muda no DOM: sem `data-campo`, sem erro, sem obrigatório novo.
   * Com layout: rótulo e obrigatório do layout, `data-campo="<chave>"` no invólucro, erro no próprio campo, e o campo
   * não editável aparece travado (fieldset desabilitado) mostrando o valor (o padrão aplicado ao abrir).
   */
  /* TOP-CONFIG-05 exigências: campo exigido pela TOP ganha `data-exigido-top="1"` e `data-testid="central-campo-<caminho>"`
     no invólucro (nenhum destes invólucros tem testid hoje). Sem `regras`, `exigidos` é vazio e nada muda no DOM. */
  const dc = (chave: string) => ({
    ...(layout ? { "data-campo": chave } : {}),
    ...(exigidos.has(chave) ? { "data-exigido-top": "1", "data-testid": `central-campo-${chave}` } : {})
  });
  const rot = (chave: string, hoje: string) => cfg.get(chave)?.rotulo || hoje;
  /* TOP-CONFIG-05 exigências: o "*" soma o obrigatório do layout (ou o de hoje) com a exigência da TOP. */
  const req = (chave: string, hoje: boolean) => (layout ? Boolean(cfg.get(chave)?.obrigatorio) : hoje) || exigidos.has(chave);
  const err = (chave: string) => erros[chave];
  /** VENDAS-A3-1b: o rótulo do padrão de cadastro vai ao RefSelect enquanto o valor for o do padrão (sem consulta). */
  const dica = (chave: keyof typeof h) => { const p = padraoDoCampo(chave); return p && h[chave] === p.id ? p.rotulo : undefined; };
  /** VENDAS-A3-1b: aviso do padrão morto, dentro do invólucro `data-campo` do campo. Sem padrão inválido, nada. */
  const avisoDoPadrao = (chave?: string) => (chave && padraoInvalido(chave) ? <p data-testid="padrao-invalido-aviso" className="mt-0.5 text-[11px] text-amber-700">{AVISO_PADRAO_INVALIDO_CENTRAL}</p> : null);
  const pesquisa = (conteudo: React.ReactNode, chave?: string) => <div className={cn(estilosCv.campo, estilosCv.campoPesquisa)} {...(chave ? dc(chave) : {})}>{conteudo}{avisoDoPadrao(chave)}<span className={estilosCv.adorno} aria-hidden><Search /></span></div>;
  const larguraFixa = { maxWidth: 330 };
  /**
   * VISUAL-UX-02: o campo do DESENHO (`CampoDaCentral`, nas duas densidades). Rótulo, "*", erro e `data-campo` saem dos
   * MESMOS helpers de antes (`rot`/`req`/`err`/`dc`); o controle e o valor são os de antes. (`pesquisa` acima
   * fica para o caso que ainda o usa.)
   */
  /* EDITAR-03: `dica` (o `title` que o `CampoDaCentral` já tem) leva o motivo do campo que a edição trava; na criação, nenhum. */
  const cc = (chave: string, hoje: string, o: { obrigatorio?: boolean; icone?: IconeDoCampo; preenchido: boolean; erro?: string; multilinha?: boolean; dica?: string }, controle: React.ReactElement) =>
    <CampoDaCentral rotulo={rot(chave, hoje)} obrigatorio={req(chave, o.obrigatorio ?? false)} erro={o.erro ?? err(chave)} icone={o.icone ?? null} preenchido={o.preenchido} multilinha={o.multilinha} abaixo={avisoDoPadrao(chave)} dica={o.dica} {...dc(chave)}>{controle}</CampoDaCentral>;
  /**
   * EDITAR-03 — OS IMUTÁVEIS DA EDIÇÃO: a empresa (a PATCH a recusa, `MSG_EDICAO_EMPRESA`) fica em leitura com o motivo —
   * o MESMO `fieldset` travado do layout. A TOP já é contexto travado (abaixo), na edição a GRAVADA. Na criação, nenhum.
   */
  const motivoNaEdicao = (chave: string): string | undefined => (modoEdicao && chave === "empresa_id" ? MOTIVO_EMPRESA_NA_EDICAO : undefined);
  /** Responsável: só leitura, o nome de quem lança (o servidor grava quem faz o POST). Não é campo do layout: sem `data-campo`.
   *  EDITAR-03: na edição, o do documento gravado (a PATCH não o troca). */
  const nomeDeQuemLanca = useAuth().ctx?.user.name ?? "";
  const responsavel = <CampoDaCentral rotulo="Responsável" estado="travado">{edicao ? String(edicao.documento["responsible_name"] ?? "") : nomeDeQuemLanca}</CampoDaCentral>;

  const desenhar = (chave: string): React.ReactNode => {
    switch (chave) {
      /* TOP-CONFIG-05 atraso: erro do 422 no campo Cliente e a faixa LOGO ABAIXO dele (fora do invólucro, sem espaço reservado quando não há faixa). */
      case "client_id": return <>{cc(chave, "Cliente", { obrigatorio: true, icone: "pesquisa", preenchido: Boolean(h.client_id), erro: err(chave) ?? erroAtrasoDoCliente }, <RefSelect resource="people" value={h.client_id} onChange={(v) => setH({ ...h, client_id: v ?? "" })} filter={{ is_client: "true" }} labelHint={dica("client_id")} />)}{regrasAtivo && <FaixaAtrasoCliente situacao={situacaoAtraso} />}</>;
      case "empresa_id": return cc(chave, "Empresa", { obrigatorio: true, icone: "pesquisa", preenchido: Boolean(h.empresa_id), dica: motivoNaEdicao(chave) }, <RefSelect resource="empresas" value={h.empresa_id} onChange={(v) => setH({ ...h, empresa_id: v ?? "" })} />);
      case "document_date": return cc(chave, "Data", { obrigatorio: true, icone: "data", preenchido: Boolean(h.document_date) }, <DataDaCentral rotulo={rot(chave, "Data")} value={h.document_date} onChange={(v) => setH({ ...h, document_date: v })} />);
      case "due_date": return cc(chave, "Vencimento", { icone: "data", preenchido: Boolean(h.due_date) }, <DataDaCentral rotulo={rot(chave, "Vencimento")} value={h.due_date} onChange={(v) => setH({ ...h, due_date: v })} />);
      case "payment_method_id": return cc(chave, "Forma de pagamento", { icone: "pesquisa", preenchido: Boolean(h.payment_method_id) }, <RefSelect resource="payment_methods" value={h.payment_method_id} onChange={(v) => setH({ ...h, payment_method_id: v ?? "" })} labelHint={dica("payment_method_id")} />);
      case "categoria_financeira_id": return classificacaoAtiva && cc(chave, "Natureza", { obrigatorio: true, icone: "pesquisa", preenchido: Boolean(h.categoria_financeira_id) }, <RefSelect resource="financial_categories" value={h.categoria_financeira_id} onChange={(v) => setH({ ...h, categoria_financeira_id: v ?? "" })} filter={{ kind: "analytic", nature: "income" }} labelHint={dica("categoria_financeira_id")} />);
      case "centro_custo_id": return classificacaoAtiva && cc(chave, "Centro de resultado", { obrigatorio: true, icone: "pesquisa", preenchido: Boolean(h.centro_custo_id) }, <RefSelect resource="cost_centers" value={h.centro_custo_id} onChange={(v) => setH({ ...h, centro_custo_id: v ?? "" })} filter={{ kind: "analytic" }} labelHint={dica("centro_custo_id")} />);
      case "shipping_date": return cc(chave, "Data de saída", { icone: "data", preenchido: Boolean(h.shipping_date) }, <DataDaCentral rotulo={rot(chave, "Data de saída")} value={h.shipping_date} onChange={(v) => setH({ ...h, shipping_date: v })} />);
      case "proprietary_id": return cc(chave, "Proprietário", { icone: "pesquisa", preenchido: Boolean(h.proprietary_id) }, <RefSelect resource="people" value={h.proprietary_id} onChange={(v) => setH({ ...h, proprietary_id: v ?? "" })} filter={{ is_proprietary: "true" }} labelHint={dica("proprietary_id")} />);
      case "discount": return cc(chave, "Desconto", { preenchido: h.discount !== "" }, <EntradaNumero casas={2} value={h.discount} onChange={(v) => setH({ ...h, discount: v })} />);
      case "other_values": return cc(chave, "Outros valores", { preenchido: h.other_values !== "" }, <EntradaNumero casas={2} value={h.other_values} onChange={(v) => setH({ ...h, other_values: v })} />);
      case "condicao_pagamento_id": return condicaoAtiva && <div style={larguraFixa} data-testid="condicao-pagamento">{pesquisa(<Field label={rot(chave, "Condição de pagamento")} required={req(chave, false)} error={err(chave)} span={12}><RefSelect resource="condicoes_pagamento" value={h.condicao_pagamento_id} onChange={escolherCondicao} labelHint={dica("condicao_pagamento_id")} somenteIds={condicoesPermitidas} /></Field>, chave)}</div>;
      /* VISUAL-UX-02 Fase B: o Financeiro da criação no desenho — um campo abaixo do outro, na densidade da Central, na
         ordem da consulta. Parcelamento é o `cc` de sempre; o plano é o `PlanEditor` com o desenho da Central
         (`PlanoDaCentral`). Valores, `plan` e o corpo (`installment_plan`) são os de antes. */
      case "installment_plan": return <>
        {!condicaoId && cc(chave, "Parcelamento", { icone: "selecao", preenchido: true }, <NativeSelect value={h.installments ? "1" : "0"} onChange={(e) => setH({ ...h, installments: e.target.value === "1" })}><option value="0">À vista</option><option value="1">Parcelado</option></NativeSelect>)}
        {!condicaoId && h.installments && <PlanoDaCentral plano={plan} onChange={setPlan} />}
        {condicaoId && planoCalculado && <PlanoDaCentral plano={plan} onChange={ajustarPlano} />}
      </>;
      case "transporter_id": return cc(chave, "Transportadora", { icone: "pesquisa", preenchido: Boolean(h.transporter_id) }, <RefSelect resource="people" value={h.transporter_id} onChange={(v) => setH({ ...h, transporter_id: v ?? "" })} filter={{ is_transporter: "true" }} labelHint={dica("transporter_id")} />);
      case "driver_name": return cc(chave, "Motorista", { preenchido: Boolean(h.driver_name) }, <Input value={h.driver_name} onChange={(e) => setH({ ...h, driver_name: e.target.value })} />);
      case "freight": return cc(chave, "Frete", { preenchido: h.freight !== "" }, <EntradaNumero casas={2} value={h.freight} onChange={(v) => setH({ ...h, freight: v })} />);
      case "freight_icms": return cc(chave, "ICMS frete", { preenchido: h.freight_icms !== "" }, <EntradaNumero casas={2} value={h.freight_icms} onChange={(v) => setH({ ...h, freight_icms: v })} />);
      /* chave sim/não do desenho; o valor e o payload (`is_deductible`) são os de antes */
      case "is_deductible": return <ChaveSimNao rotulo={rot(chave, "Dedutível")} valor={h.is_deductible} onChange={(v) => setH({ ...h, is_deductible: v })} {...dc(chave)} />;
      case "note": return cc(chave, "Observação", { preenchido: Boolean(h.note), multilinha: true }, <Textarea value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} />);
      default: return null;
    }
  };
  /** Campo com gate de capacidade que a API não declara não existe — nem conta para montar aba. */
  const existe = (chave: string) => rotuloDoCatalogo.has(chave)
    && !((chave === "categoria_financeira_id" || chave === "centro_custo_id") && !classificacaoAtiva)
    && !(chave === "condicao_pagamento_id" && !condicaoAtiva);

  /**
   * PADRÃO DE CADASTRO (VENDAS-A3-1b), aplicado ao ABRIR (quando a resposta do layout chega), só a campo que EXISTE na tela
   * e ainda está intocado — o valor escolhido nunca é sobrescrito — e pelo MESMO caminho da escolha manual: `setH` do
   * campo (o rótulo vai ao RefSelect por `labelHint`, sem consulta) e, na condição de pagamento, `escolherCondicao`, para
   * o plano ser calculado como se o usuário a tivesse escolhido. O estado inicial acompanha, como no padrão literal, para
   * o padrão não contar como "tem coisa digitada". O efeito lê o `h` do render em que a resposta chegou; a guarda por
   * resposta impede reaplicar a cada render.
   */
  const padroesDeCadastroAplicados = React.useRef<PadroesDaResposta | null>(null);
  React.useEffect(() => {
    if (!semeiaNaAbertura(modo, "padraoDeCadastro")) return; /* EDITAR-03: a edição abre o gravado — padrão nenhum */
    if (!layout || padroesDeCadastroAplicados.current === padroes) return;
    padroesDeCadastroAplicados.current = padroes;
    if (copia) return; /* VISUAL-UX-02 W1: padrão de cadastro nenhum sobrescreve a cópia do Duplicar */
    const antes = inicial.current;
    const novos: Partial<typeof h> = {};
    let condicaoPadrao: string | null = null;
    for (const [chave, p] of padroes.validos) {
      if (!padraoDoCampo(chave) || !existe(chave) || !(chave in antes)) continue;
      const k = chave as keyof typeof h;
      if (JSON.stringify(h[k]) !== JSON.stringify(antes[k])) continue;
      if (k === "condicao_pagamento_id") condicaoPadrao = p.id;
      else Object.assign(novos, { [k]: p.id });
    }
    if (Object.keys(novos).length) {
      inicial.current = { ...antes, ...novos };
      setH((o) => {
        const r = { ...o };
        for (const [k, v] of Object.entries(novos)) if (JSON.stringify(o[k as keyof typeof o]) === JSON.stringify(antes[k as keyof typeof antes])) Object.assign(r, { [k]: v });
        return r;
      });
    }
    if (condicaoPadrao !== null) {
      inicial.current = { ...inicial.current, condicao_pagamento_id: condicaoPadrao };
      escolherCondicao(condicaoPadrao);
    }
  }, [layout, padroes, h, padraoDoCampo, existe, escolherCondicao, copia, modo]);

  /** O campo, com a chave do React e — só com layout e `editavel: false` — travado. Padrão de cadastro morto destrava. */
  const render = (chave: string) => {
    const n = desenhar(chave);
    const travado = layout && cfg.get(chave)?.editavel === false && !padraoInvalido(chave);
    /* EDITAR-03: o imutável da edição — o MESMO `fieldset` travado, marcado com o motivo (`data-motivo`). */
    const motivo = motivoNaEdicao(chave);
    if (motivo) return <React.Fragment key={chave}><fieldset disabled data-editavel="false" data-travado-na-edicao="true" data-motivo={motivo} style={{ display: "contents" }}>{n}</fieldset></React.Fragment>;
    return <React.Fragment key={chave}>{travado ? <fieldset disabled data-editavel="false" style={{ display: "contents" }}>{n}</fieldset> : n}</React.Fragment>;
  };

  /* Dados principais: ordem do layout; a Operação logo depois da Empresa (ou depois dos dois primeiros). "Dados
     adicionais" = os campos que o LAYOUT põe lá (VENDAS-A3-1c, dono: `camposAdicionaisDoCabecalho`; sem layout é o
     LAYOUT_DO_SISTEMA → o Proprietário, como hoje). Bloco largo (plano de parcelas) nunca no cabeçalho. */
  /* TOP-CONFIG-05 exigências: desenha a partir de `estruturaDesenhada` (= `estrutura` sem exigido faltante). */
  const cabecalho = estruturaDesenhada.cabecalho.map((x) => x.campo).filter(existe).filter((c) => !CAMPOS_SO_NO_RODAPE.includes(c));
  const principais = cabecalho.filter((c) => !adicionaisDoLayout.has(c));
  const adicionais = cabecalho.filter((c) => adicionaisDoLayout.has(c));
  const posEmpresa = principais.indexOf("empresa_id");
  const posTop = posEmpresa >= 0 ? posEmpresa + 1 : Math.min(2, principais.length);
  const posSaida = principais.indexOf("shipping_date");
  const posResponsavel = posSaida >= posTop ? posSaida : principais.length;

  /* Rodapé: as abas do layout, na ordem, com os campos dele — na geometria do desenho (VISUAL-UX-02): uma coluna de
     330px; a aba do plano (Financeiro) ganha, à direita, os títulos (na criação ainda não há nenhum); Observação
     sozinha usa a área larga. */
  /* EDITAR-03: na edição, os títulos do documento gravado (os do servidor); na criação ainda não há nenhum. */
  const titulosDoDocumento: Row[] = edicao && Array.isArray(edicao.documento["titles"]) ? (edicao.documento["titles"] as Row[]) : [];
  const VALOR_DA_ABA: Record<string, string> = { "Totais": "totais", "Financeiro": "financeiro", "Frete e transporte": "frete", "Fiscal": "fiscal", "Observações": "observacoes" };
  const usados = new Set<string>();
  const abas = estruturaDesenhada.rodape.flatMap((a, i) => {
    const campos = a.campos.map((x) => x.campo).filter(existe);
    if (!campos.length) return [];
    const preferido = VALOR_DA_ABA[a.aba];
    const value = preferido && !usados.has(preferido) ? preferido : `aba-${i}`;
    usados.add(value);
    const especial = (c: string) => c === "installment_plan" || c === "condicao_pagamento_id";
    let content: React.ReactNode;
    if (campos.length === 1 && campos[0] === "note") content = <PainelLargo>{render("note")}</PainelLargo>;
    else if (campos.some(especial)) content = <PainelRepartido lado={<TitulosDoDocumento legenda="Contas a receber do documento" titulos={titulosDoDocumento} />}>{campos.map(render)}</PainelRepartido>;
    else if (value === "totais") content = <PainelRepartido>{campos.map(render)}</PainelRepartido>; /* Totais: a grade do desenho, sem lado */
    else content = <PainelColuna>{campos.map(render)}</PainelColuna>;
    return [{ value, label: a.aba, content }];
  });
  /* TOP-CONFIG-07: com a reserva, a coluna do armazém entra mesmo que o layout não a desenhe (`comColunasDaReserva`). */
  const layoutDosItens = React.useMemo(() => (layout ? { colunas: reservaAtiva ? comColunasDaReserva(layout.itens) : layout.itens } : null), [layout, reservaAtiva]);
  /**
   * O PADRÃO DO LOCAL (VENDAS-A3-1b): o padrão de cadastro da coluna do local vale SÓ para a empresa do documento de
   * AGORA (`empresaId` da resposta === `h.empresa_id`); de outra empresa, ou sem empresa na resposta, nenhum.
   */
  const padraoArmazem = layout && layout.itens.some((c) => c.campo === "warehouse_id") ? padroes.validos.get(chavePadraoDeCadastro("itens", "warehouse_id")) : undefined;
  const padraoDoLocal = React.useMemo(
    (): LocalDeEstoque | null => (padraoArmazem && padraoArmazem.empresaId && padraoArmazem.empresaId === h.empresa_id ? { id: padraoArmazem.id, rotulo: padraoArmazem.rotulo } : null),
    [padraoArmazem, h.empresa_id]
  );
  /**
   * O "LOCAL DE ESTOQUE" DO CABEÇALHO (OPERACOES-01 F3b, decisão 280): começa no padrão do local e o usuário o troca nos
   * Dados principais; cada linha NOVA nasce com ele, e a linha troca o seu na própria célula. É estado da TELA: fora de
   * `h`, então fora do corpo do POST, do `sujo`, da cópia do Duplicar e das pendências do Salvar (o W4 confere o corpo
   * exato). Trocar a empresa volta ao padrão da empresa nova; o Descartar remonta o formulário e volta ao padrão.
   * Só existe quando a coluna do local está na grade (sem layout, o motor a desenha; com layout, ele a desenha ou a
   * reserva a força): com o local escondido pelo layout, a linha nasce sem local, como antes.
   */
  const local = useLocalDoCabecalho(padraoDoLocal, h.empresa_id);
  /* EDITAR-03: na edição o "Local de estoque" do cabeçalho não existe — a linha nova nasce sem local, e cada linha mostra o
     seu (o gravado); semear o local das linhas novas é coisa da criação (`semeiaNaAbertura`). */
  const localNaGrade = semeiaNaAbertura(modo, "localDoCabecalho") && (!layoutDosItens || layoutDosItens.colunas.some((c) => c.campo === "warehouse_id"));

  /* ── VISUAL-UX-02 W1 — a barra da criação ── */
  const [perguntaDescartar, setPerguntaDescartar] = React.useState(false);
  const pendencias = tentouSalvar ? pendenciasDoSalvar() : [];
  React.useEffect(() => { if (!pendencias.length) setPendenciasAbertas(false); }, [pendencias.length]);
  const salvarDesabilitado = !escritaTopConfirmada || layoutPendente || regrasPendente || atrasoTravaSalvar || !sujo;
  /* "Confirmar venda" só na venda — perguntado ao SSOT da família (o mesmo caminho da reserva, acima). */
  const ehVenda = familiaLayout !== "" && familiaLayout === familiaOperacionalDeDocumentoVenda("sale");
  /* O leque da criação, de baixo para cima: Alterar operação, Imprimir e Histórico (desabilitados: o documento ainda
     não existe) e "N documentos abertos" (o próprio leque o põe). Histórico só com a capacidade — `can` só esconde. */
  const rapidas: ItemRapido[] = [
    { chave: "alterar", rotulo: "Alterar operação", testId: "top-alterar", icone: <IconeAlterarOperacao />, onSelect: alterarOperacao },
    { chave: "imprimir", rotulo: "Imprimir", testId: "central-vendas-imprimir", icone: <IconeImprimir />, desabilitado: true, onSelect: () => undefined },
    ...(can("audit_logs.view") ? [{ chave: "historico", rotulo: "Histórico de alterações", testId: "central-vendas-historico", icone: <IconeHistorico />, desabilitado: true, onSelect: () => undefined }] : [])
  ];

  /* ── EDITAR-03 — a barra da EDIÇÃO (o molde da 313): [✕] [Salvar]. O ✕ é "Voltar à consulta" sem alteração (volta
     direto, nada a perder) e "Descartar alterações" com ela (pergunta antes, depois volta à consulta — zero escrita).
     O Salvar tem o rótulo que o servidor declarou ("Salvar e confirmar" na venda cuja versão congelada confirma ao salvar)
     e NÃO desabilita sem alteração: o clique sem mudança é o "Nada mudou", zero PATCH. Sem "Confirmar venda" (a PATCH
     confirma sozinha, avisando antes; a manual é a da consulta), sem "Alterar operação" (a TOP do documento salvo não
     troca) e sem Duplicar. Imprimir e Histórico, como na criação: o documento salvo é o da consulta. ── */
  const salvando = patch.isPending;
  const rotuloDoSalvarAgora = rotuloDoSalvar(regrasGerais, can("sales.edit"));
  const rotuloDoDescartar: "Descartar alterações" | "Voltar à consulta" = alterado ? "Descartar alterações" : "Voltar à consulta";
  const voltarAConsulta = () => { edicao?.onFechar(false); };
  const salvarDesabilitadoNaEdicao = !escritaTopConfirmada || layoutPendente || regrasPendente || atrasoTravaSalvar || salvando;
  const acoesDaEdicao = <ConjuntoDaBarra>
    <BotaoDaBarra rotulo={rotuloDoDescartar} disabled={salvando} data-testid="central-vendas-descartar" onClick={() => { if (alterado) setPerguntaDescartar(true); else voltarAConsulta(); }}><IconeDescartar /></BotaoDaBarra>
    <BotaoDaBarra rotulo={rotuloDoSalvarAgora} dica={salvando ? "Salvando…" : rotuloDoSalvarAgora} ocupado={salvando} disabled={salvarDesabilitadoNaEdicao} data-testid="central-vendas-salvar"
      onClick={() => { confirmarDepois.current = false; submit(); }}><IconeSalvar /></BotaoDaBarra>
  </ConjuntoDaBarra>;
  const rapidasDaEdicao = rapidas.filter((r) => r.chave !== "alterar");
  const tituloDaEdicao = `Editar ${familia.toLowerCase()} ${codigoEmEdicao}`.trim();
  /* O que a tela da edição (a consulta) desenha por cima: o conflito de versão e o aviso do Salvar que confirma. */
  const estadoDaEdicao: EstadoDaEdicaoDeVenda = {
    codigo: codigoEmEdicao, variante: varianteEmEdicao, salvando, alterado,
    conflito, recarregar: () => { setConflito(null); edicao?.recarregar(); }, continuarEditando: () => setConflito(null),
    aviso: avisoAberto ? { rotulo: ROTULO_SALVAR_E_CONFIRMAR, codigo: codigoEmEdicao, previa: previaDoAviso, numerosDaPreviaValem: numerosDaPreviaValem(corpoDaPatch()) } : null,
    confirmarAviso: () => { if (avisoAberto) enviarPatch(); },
    cancelarAviso: () => { if (!salvando) setAvisoAberto(false); },
    barra: { rotuloDoSalvar: rotuloDoSalvarAgora, rotuloDoDescartar },
    voltarAConsulta
  };

  return <>
    <CentralVendasWorkspace
      titulo={edicao ? tituloDaEdicao : T[kind] ?? "Novo"}
      identidade={{ nome: edicao ? tituloDaEdicao : T[kind] ?? "Novo documento", alterado, dica: kind === "sales" ? "O que a confirmação faz no estoque e no financeiro depende do Tipo de Operação e é mostrado antes de confirmar." : "Documento comercial sem efeito em estoque/financeiro até ser convertido em venda confirmada." }}
      densidade={densidade}
      acoes={edicao ? acoesDaEdicao : <ConjuntoDaBarra>
        {/* VISUAL-UX-02 W1 — criação: [Descartar alterações ✕] [Salvar] [Confirmar venda (só venda)]. Sem "Voltar":
            navegar é a barra de abas. Salvar e Confirmar venda desabilitam só por ESTADO (TOP, layout/regras, atraso)
            ou sem alteração; pendência de campo (natureza e centro inclusive, Fase B) é o clique que não envia nada. */}
        <BotaoDaBarra rotulo="Descartar alterações" disabled={!sujo || create.isPending} data-testid="central-vendas-descartar" onClick={() => setPerguntaDescartar(true)}><IconeDescartar /></BotaoDaBarra>
        {/* OPERACOES-01 F2: com a Confirmação Automática declarada pelo servidor, o Salvar se chama "Salvar e confirmar" —
            para quem pode confirmar a venda (`sales.edit`, a capacidade que a confirmação automática confere). */}
        <BotaoDaBarra rotulo={rotuloDoSalvar(regrasGerais, can("sales.edit"))} dica={create.isPending ? "Salvando…" : rotuloDoSalvar(regrasGerais, can("sales.edit"))} ocupado={create.isPending} disabled={salvarDesabilitado} data-testid="central-vendas-salvar"
          onClick={() => { confirmarDepois.current = false; submit(); }}><IconeSalvar /></BotaoDaBarra>
        {ehVenda && can("sales.edit") && <PilulaDaBarra icone={<IconeConfirmar />} dica="Confirmar venda" disabled={salvarDesabilitado || create.isPending} data-testid="central-vendas-confirmar"
          onClick={() => { confirmarDepois.current = true; submit(); }}>Confirmar venda</PilulaDaBarra>}
      </ConjuntoDaBarra>}
      acoesDireita={<ConjuntoDireito>
        {/* [N pendências] [Posição do rótulo] [Ações rápidas] */}
        {tentouSalvar && <PendenciasDoDocumento pendencias={pendencias} aberta={pendenciasAbertas} onAbertaChange={setPendenciasAbertas} onIr={irParaPendencia} />}
        <PosicaoDoRotulo valor={densidade} onChange={onDensidade} />
        <AcoesRapidas antes={edicao ? rapidasDaEdicao : rapidas} desabilitado={edicao ? salvando : create.isPending} />
      </ConjuntoDireito>}
      aviso={avisoDeLayout ? <>{avisoDeEscrita}{avisoDeLayout}</> : avisoDeEscrita}
      dados={<>
        {linhaDoLayout}
        {/* VISUAL-UX-02: a coluna do desenho; o Responsável (só leitura) entra antes da Data de saída, como no desenho */}
        <ColunaDeCampos>
          {principais.slice(0, posTop).map(render)}
          {contextoOperacional}
          {localNaGrade && <CampoDoLocalPadrao prefixoTestid={PREFIXO_CENTRAL_VENDAS} empresaId={h.empresa_id} valor={local.local} onChange={local.escolher} />}
          {principais.slice(posTop, posResponsavel).map(render)}
          {responsavel}
          {principais.slice(posResponsavel).map(render)}
        </ColunaDeCampos>
        <DadosAdicionais quantidade={adicionais.length} aberto={maisDados} onAlternar={() => setMaisDados((m) => !m)}>
          {adicionais.map(render)}
        </DadosAdicionais>
      </>}
      itens={<ItensDaCentral items={items} onChange={setItems} layout={layoutDosItens} erros={layout || regras ? erros : undefined} armazemPadrao={localNaGrade ? local.local : null} reservaEstoque={reservaDosItens}
        travasDaLinha={limites ? travasDaLinhaDaVenda(limites) : undefined} aceitaLinhaNova={limites ? aceitaLinhaNovaNaEdicao(limites) : undefined} />}
      abas={abas}
    />

    {/* VISUAL-UX-02 W1: Descartar pergunta antes; confirmar remonta o formulário na abertura (nada é escrito). */}
    <DialogoDescartar aberto={perguntaDescartar} onFechar={() => setPerguntaDescartar(false)} onDescartar={() => { setPerguntaDescartar(false); onDescartar(); }} />
    {/* Trocar a operação descarta o que foi digitado — então pergunta antes, em vez de descobrir depois. */}
    <Confirm open={confirmarTroca} onOpenChange={setConfirmarTroca} title="Alterar o Tipo de Operação?"
      text="Os dados já preenchidos neste lançamento serão descartados." danger
      onConfirm={() => { setConfirmarTroca(false); voltarAoLancador(); }} />
    {/* EDITAR-03: os diálogos da edição (o conflito de versão, o aviso do Salvar que confirma), desenhados pela consulta. */}
    {edicao && renderDialogosDaEdicao?.(estadoDaEdicao)}
  </>;
}

/* ═════════════════════════════ EDITAR-03 — A ABERTURA DA EDIÇÃO (para a consulta) ═════════════════════════════ */

/** As props que a abertura monta; a consulta acrescenta a posição do rótulo e os diálogos da edição. */
export type PropsDaEdicaoDeVenda = Omit<PropsDoFormularioDeVenda, "densidade" | "onDensidade" | "renderDialogosDaEdicao" | "edicao"> & { edicao: EdicaoAbertaDeVenda };

/**
 * O QUE A CONSULTA RECEBE para trocar, NO LUGAR, para o formulário em edição:
 *   carregando   → as duas leituras ainda não chegaram (ou a abertura está relendo por versões diferentes);
 *   recusada     → `podeEditar` falso: o `motivo` do SERVIDOR (o MESMO da PATCH) — a consulta o mostra e fica;
 *   indisponivel → erro de uma das leituras (a mensagem do servidor; a porta ausente na API anterior, a frase de
 *                  "ainda não está disponível"), resposta fora do contrato, ou as versões que não param de mudar;
 *   pronta       → as props do formulário em modo edição e a `chave` dele — que só muda quando a pessoa RECARREGA.
 */
export type AberturaDaEdicaoDeVenda =
  | { situacao: "carregando" }
  | { situacao: "recusada"; motivo: string }
  | { situacao: "indisponivel"; mensagem: string }
  | { situacao: "pronta"; chave: string; props: PropsDaEdicaoDeVenda };

const LEITURA_DA_ABERTURA = { retry: false, staleTime: Infinity, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false } as const;

/**
 * As duas leituras de MESMA versão abrem o formulário? A variante do registro é a da rota (`varianteDeVenda`, o catálogo),
 * o documento tem a TOP gravada, e as regras e a estrutura do layout passam pelos leitores de sempre. Senão, "indisponível".
 */
function abrivel(documento: Row, e: EdicaoDoDocumentoDeVenda, segmento: string): boolean {
  return varianteDeVenda(String(documento["kind"] ?? ""))?.segmento === segmento && topGravadaDaVenda(documento) !== null
    && lerRegrasDaOperacao(e.regras) !== null && ehEstruturaLayout(e.layout["estrutura"]);
}

/**
 * EDITAR-03 (decisão 315) — A ABERTURA DA EDIÇÃO DO DOCUMENTO DE VENDA: `GET <base>/:id` + `GET <base>/:id/edicao` (o
 * `/edicao` de vendas NÃO traz o documento), com a GUARDA DE VERSÃO (`versaoConfere`): versões diferentes (outra aba
 * salvou entre as duas leituras) ⇒ relê as duas, até `RELEITURAS_DA_ABERTURA` vezes — nunca mostra uma versão e manda
 * outra. FAIL-CLOSED: o `/edicao` pelo adaptador (`lerEdicaoDeVenda`), as regras pelo leitor de sempre
 * (`lerRegrasDaOperacao`), a estrutura do layout pelo de sempre (`ehEstruturaLayout`), a variante do registro pelo
 * catálogo (`varianteDeVenda`, contra o segmento da rota) e a TOP gravada (`topGravadaDaVenda`); qualquer um fora ⇒
 * "indisponível". As leituras abertas ficam CONGELADAS no formulário: uma releitura em segundo plano nunca troca a versão
 * debaixo do rascunho — só `recarregar` faz isso, e descarta o rascunho de propósito (chave nova ⇒ formulário novo ⇒
 * chave de idempotência nova). Nenhuma porta que pede `.create` é chamada aqui.
 */
export function useAberturaDaEdicaoDeVenda(kind: string, id: string, onFechar: (salvou: boolean) => void): AberturaDaEdicaoDeVenda {
  const tr = useTradutor(); const qc = useQueryClient();
  /** O número da leitura pedida: a releitura (versões diferentes) e o "Recarregar" pedem outra — nunca a do cache. */
  const [leitura, setLeitura] = React.useState(0);
  const releituras = React.useRef(0);
  const docQ = useQuery<unknown, ApiError>({ queryKey: chaveDoDocumentoEmEdicaoDeVenda(kind, id, leitura), queryFn: () => api<unknown>(portaDoDocumentoDeVenda(kind, id)), ...LEITURA_DA_ABERTURA });
  const edQ = useQuery<unknown, ApiError>({ queryKey: chaveDaEdicaoDeVenda(kind, id, leitura), queryFn: () => api<unknown>(portaDaEdicaoDeVenda(kind, id)), ...LEITURA_DA_ABERTURA });
  const decisao = React.useMemo(() => (docQ.data !== undefined && edQ.data !== undefined ? decidirAbertura(docQ.data, edQ.data) : null), [docQ.data, edQ.data]);
  const releia = decisao?.situacao === "versoes-diferentes" && releituras.current < RELEITURAS_DA_ABERTURA;
  React.useEffect(() => {
    if (!releia) return;
    releituras.current += 1;
    setLeitura((n) => n + 1);
  }, [releia, decisao]);
  /* A saída é a de quem abriu (a consulta), lida na hora do clique: o objeto da edição não muda a cada render dela. */
  const fechar = React.useRef(onFechar);
  React.useEffect(() => { fechar.current = onFechar; }, [onFechar]);
  const recarregar = React.useCallback(() => {
    releituras.current = 0;
    // a consulta embaixo também é relida (é ela que aparece ao voltar); as leituras da abertura, pela leitura nova
    void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "sales-edicao" && q.queryKey[0] !== "sales-edicao-documento" });
    setLeitura((n) => n + 1);
  }, [qc]);
  /* A LEITURA QUE ABRIU O FORMULÁRIO FICA CONGELADA nele (por leitura): uma releitura em segundo plano — o
     `invalidateQueries()` de outra aba que salvou, por exemplo — nunca troca o documento nem a versão debaixo do rascunho,
     nem o derruba por um erro novo. A PATCH com a versão aberta é que descobre que mudou (409, "Recarregar"). */
  const qual = `${kind}:${id}:${leitura}`;
  const [aberta, setAberta] = React.useState<{ qual: string; leitura: number; documento: Row; dados: EdicaoDoDocumentoDeVenda; props: Omit<PropsDaEdicaoDeVenda, "edicao"> } | null>(null);
  React.useEffect(() => {
    if (decisao?.situacao !== "pronta" || aberta?.qual === qual) return;
    const variante = varianteDeVenda(String(decisao.documento["kind"] ?? ""));
    const top = topGravadaDaVenda(decisao.documento);
    if (!variante || !top || !abrivel(decisao.documento, decisao.edicao, kind)) return;
    setAberta({
      qual, leitura, documento: decisao.documento, dados: decisao.edicao,
      props: {
        kind, top, familia: tr(variante.chaveI18n),
        // a descoberta de TOPs pede `.create` e não é perguntada: a TOP é a GRAVADA, que o `/edicao` já conferiu
        estadoTop: { situacao: "carregando" }, escritaTopConfirmada: true,
        onDescartar: () => fechar.current(false)
      }
    });
  }, [decisao, qual, leitura, aberta, kind, tr]);
  const edicao = React.useMemo<EdicaoAbertaDeVenda | null>(() => (aberta
    ? { documento: aberta.documento, dados: aberta.dados, onFechar: (salvou) => fechar.current(salvou), recarregar }
    : null), [aberta, recarregar]);
  if (aberta && edicao && aberta.qual === qual) return { situacao: "pronta", chave: `edicao:${id}:${aberta.leitura}`, props: { ...aberta.props, edicao } };

  const mensagemDoErro = (e: ApiError) => (edicaoDeVendaIndisponivel(e) ? MSG_EDICAO_DE_VENDA_INDISPONIVEL : e.message);
  const indisponivel = (mensagem: string): AberturaDaEdicaoDeVenda => ({ situacao: "indisponivel", mensagem });
  if (edQ.isError) return indisponivel(mensagemDoErro(edQ.error));
  if (edQ.data !== undefined) {
    // a recusa do servidor vem antes do documento: ela é a resposta, e o documento não é preciso para dizê-la
    const lida = lerEdicaoDeVenda(edQ.data);
    if (!lida) return indisponivel(MSG_EDICAO_DE_VENDA_INDISPONIVEL);
    if (!lida.podeEditar) return { situacao: "recusada", motivo: lida.motivo ?? MSG_EDICAO_DE_VENDA_INDISPONIVEL };
  }
  if (docQ.isError) return indisponivel(mensagemDoErro(docQ.error));
  if (!decisao || releia) return { situacao: "carregando" };
  if (decisao.situacao === "versoes-diferentes") return indisponivel(MSG_DOCUMENTO_DE_VENDA_MUDOU);
  if (decisao.situacao === "recusada") return { situacao: "recusada", motivo: decisao.motivo };
  if (decisao.situacao === "fora-do-contrato") return indisponivel(MSG_EDICAO_DE_VENDA_INDISPONIVEL);
  // pronta pelas duas leituras: a variante do registro contra a rota, a TOP gravada, as regras e o layout pelos leitores
  // de sempre — o efeito acima a congela; aqui só se decide se ela PODE ser congelada
  if (!abrivel(decisao.documento, decisao.edicao, kind)) return indisponivel(MSG_EDICAO_DE_VENDA_INDISPONIVEL);
  return { situacao: "carregando" };
}

export { Formulario as FormularioDaCentralDeVendas, T as TITULOS_DA_CRIACAO_DE_VENDA };
