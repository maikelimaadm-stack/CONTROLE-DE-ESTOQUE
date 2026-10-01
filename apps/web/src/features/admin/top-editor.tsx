"use client";
import { LinhaLayoutDocumentoTop } from "./tipos-operacao";
import { CondicoesPermitidasTop } from "./top-condicoes-permitidas";
import { FiscalFormato3 } from "./top-fiscal-formato3";
import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { COPY } from "@/lib/copy";
import { cn } from "@/lib/utils";
import {
  Badge, Button, ConfirmDialog, Dialog, ErrorState, Field, Input, LoadingState, NativeSelect, Textarea
} from "@/components/ui";
import {
  ATUALIZACOES_ESTOQUE, ATUALIZACOES_FINANCEIRO, CALCULOS_TRIBUTARIOS, ENUM_LABELS, MENSAGEM_FAMILIA_SEM_EXECUCAO_TOP,
  LIMITE_CONDICOES_PERMITIDAS, MODOS_CONFIRMACAO, MODOS_EXECUCAO_TOP, MODOS_FINANCEIRO, MOMENTOS_APROVACAO, MOMENTOS_EFEITO,
  POLITICAS_ALTERACAO, POLITICAS_APROVACAO, POLITICAS_CLIENTE_EM_ATRASO, POLITICAS_DOCUMENTO_SEM_ITENS, POLITICAS_SALDO_NEGATIVO,
  TOLERANCIA_ATRASO_MAXIMA_DIAS,
  configuracaoNeutraTopV4, configuracaoTopParaEdicao, efeitosAtivadosTop, ehFamiliaDeDocumentoEstoque, exigenciasGeraisDaFamiliaTop, exigenciasQuePassamAValer, familiaAceitaExecucaoConfiguradaTop, familiaOperacionalDeDocumentoVenda,
  normalizarConfiguracaoTop, normalizarRegrasGeraisDaFamiliaTop, regrasGeraisDaFamiliaTop, regrasGeraisQuePassamAValer, restricoesExecutamTop, tipoOperacao,
  recusasFiscaisDaFamiliaTop, validarExecucaoTop,
  type ConfiguracaoComRestricoesTop, type ConfiguracaoTipoOperacaoV2, type EfeitoExecucaoTop, type ItemMatrizRegrasGeraisTop, type ModoExecucaoTop,
  type RecusaExecucaoTop, type RegraDaFamiliaTop, type RegraGeralQueVoltaTop
} from "@agro/domain";
import {
  CAMINHO_ERRO_RESERVA_ESTOQUE, MensagemCapacidadesTop, ROTULOS_TOP, aplicarNoFormato3, assinaturaRascunho, capacidadesDeExecucao, configuracaoDoRascunhoParaEnvio,
  configuracaoIlegivelNoEditor, configuracaoInicial, configuracaoInicialV3, configuracaoInicialV4, ehConflitoDeConcorrencia, errosDeCampoDoServidor, lerDetalheTop, limiteDeDestinos,
  matrizRegrasGerais, podeConfigurar, podeConfigurarDestinos, podeConfigurarEmPartes, podeConfigurarRegrasGerais, podeConfigurarReservaEstoque,
  podeConfigurarRestricoes, useCapacidadesTop, useDestinosPossiveis, valorMinimoAceitavel,
  type CapacidadesExecucaoTop, type DestinoEmEdicao, type EstadoCapacidadesTop, type RascunhoTop
} from "./top-contrato";

/**
 * O EDITOR DE TIPO DE OPERAÇÃO — OITO SEÇÕES, UMA GRAVAÇÃO (TOP-CONFIG-03; Execução na TOP-CONFIG-04A).
 *
 * ┌─ O QUE ESTA TELA DECIDE, E O QUE ELA DELIBERADAMENTE NÃO DECIDE ───────────────────────────────────┐
 * │ Ela COLETA a intenção declarada de uma operação e a envia inteira, uma vez, quando o usuário manda  │
 * │ salvar. Ela NÃO normaliza por autoridade própria, NÃO autoriza nada e NÃO executa efeito nenhum.    │
 * │ As dependências entre campos (estoque desligado zera o resto, aprovação sem política zera o valor)  │
 * │ são aplicadas aqui apenas para o administrador não digitar o que será ignorado — a normalização de  │
 * │ verdade mora no domínio e acontece de novo no servidor, para qualquer cliente, inclusive `curl`.    │
 * │                                                                                                      │
 * │ A aba Execução (TOP-CONFIG-04A) segue a mesma régua: ela MOSTRA o que o servidor declarou executável │
 * │ (a matriz e o gate vêm das capacidades) e bloqueia o que ele recusaria, para o administrador saber   │
 * │ por quê antes de salvar. Quem decide continua sendo o servidor, na gravação e na confirmação.        │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ SEM SALVAMENTO AUTOMÁTICO, E O PORQUÊ ────────────────────────────────────────────────────────────┐
 * │ Cada gravação cria uma VERSÃO imutável. Salvar sozinho a cada tecla encheria o histórico de versões │
 * │ intermediárias que ninguém quis declarar, e o histórico é justamente o que explica, anos depois, a  │
 * │ regra sob a qual um documento nasceu. Então: um Salvar explícito, e confirmação ao fechar com       │
 * │ alteração pendente.                                                                                 │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ CÓDIGO E FAMÍLIA SÃO IMUTÁVEIS NA EDIÇÃO ─────────────────────────────────────────────────────────┐
 * │ Trocá-los reclassificaria retroativamente tudo o que já citou este tipo de operação. O servidor     │
 * │ recusa a troca e o banco também; a tela apenas não oferece o caminho, e diz por quê.                │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

export interface FamiliaTop { codigo: string; rotulo: string; modulo: string | null }

/**
 * TOP-CONFIG-07 — a ÚNICA família que pode reservar estoque: a do PEDIDO, perguntada ao registry do domínio (SSOT),
 * nunca escrita aqui. `undefined` (registry sem a variante) esconde a caixa — fail-closed. O servidor recusa com 422
 * a reserva em outra família de qualquer jeito, e o banco também.
 */
const FAMILIA_DO_PEDIDO = familiaOperacionalDeDocumentoVenda("order");

/**
 * COMPRAS-01 (decisão 267) — o movimento é de VENDAS? Perguntado ao registry (o módulo dono da família), nunca a
 * uma lista daqui. Decide duas coisas de APRESENTAÇÃO: o bloco "Cliente em atraso" (regra que só existe na venda; a
 * API recusa outro valor nas famílias de compra) e as frases da aba Execução, que falam de "vendas" só quando o
 * movimento é de vendas. Família vazia ou desconhecida não é venda: o texto fica neutro, e o bloco some.
 * COMPRAS-03: exportada porque a listagem (`tipos-operacao.tsx`) entrega ao histórico de versões, com a MESMA chave, se
 * uma versão sem política declarada seguia a ponte de vendas (`comPonte`). O histórico não tem regra própria para isso.
 */
export const ehMovimentoDeVendas = (codigoBase: string): boolean => !!codigoBase && tipoOperacao(codigoBase)?.modulo === "vendas";

/**
 * ESTOQUE-01 (decisão 274) — as seções que NÃO se aplicam ao documento de estoque (as quatro famílias de
 * `erp.documentos_estoque`, perguntadas ao registry por `ehFamiliaDeDocumentoEstoque`). O documento de estoque não
 * tem financeiro, fiscal, aprovação nem próxima operação: o movimento é o da ESPÉCIE, e a TOP dá ao documento o nome
 * da operação, a TOP padrão da espécie, a versão congelada e a exigência de observação. Seção que aparece e não
 * decide nada é pior que seção ausente — o administrador marcaria uma regra que nenhum lançamento cobra.
 * Identificação, Geral (só a observação), Estoque (o aviso da espécie) e Execução (onde o servidor diz que a
 * execução configurada não vale para estas famílias) continuam.
 */
const ABAS_FORA_DO_DOCUMENTO_ESTOQUE: ReadonlySet<string> = new Set(["destinos", "financeiro", "fiscal", "aprovacao"]);

/**
 * TOP-CONFIG-08 (decisão 277) — as mesmas seções, COM o bloco `regrasGerais` declarado pelo servidor: a Aprovação
 * volta para o documento de estoque, porque no formato 4 ela EXECUTA ali ("Sempre"; a matriz da família diz o resto).
 * Sem o bloco vale a lista de cima, letra por letra: o servidor anterior grava o 3, e lá a aprovação não decide nada.
 */
const ABAS_FORA_DO_DOCUMENTO_ESTOQUE_COM_REGRAS_GERAIS: ReadonlySet<string> = new Set(["destinos", "financeiro", "fiscal"]);

/**
 * TOP-CONFIG-08 — o neutro das quatro regras gerais (Manual, Proibido, Bloqueada, Sem aprovação), perguntado ao
 * domínio (um dono só). Regra que a família só aceita no neutro não tem o que decidir, e o campo dela some.
 */
const NEUTRO_V4 = configuracaoNeutraTopV4();

/**
 * TOP-CONFIG-08 — o nome de cada regra geral no `data-testid` do motivo (`top-regra-motivo-<campo>`) e no editor.
 * São os nomes da linha da matriz (`ItemMatrizRegrasGeraisTop`), para o teste e a matriz falarem a mesma língua.
 */
type CampoRegraGeral = "confirmacao" | "documentoSemItens" | "alteracaoAposConfirmacao" | "aprovacao";

/**
 * Uma mudança nas chaves do formato 3 que PRESERVA o formato de quem entra (TOP-CONFIG-08): o 3 sai 3 e o 4 sai 4.
 * Genérica de propósito — uma mudança escrita para o 3 que devolvesse o 3 rebaixaria o 4 sem o compilador ver.
 */
type MudancaComRestricoes = <C extends ConfiguracaoComRestricoesTop>(c: C) => C;

/** As oito seções, na ordem em que a tela as mostra. */
const ABAS = [
  { chave: "identificacao", rotulo: "Identificação" },
  { chave: "geral", rotulo: "Geral" },
  { chave: "destinos", rotulo: "Próximas operações" },
  { chave: "estoque", rotulo: "Estoque" },
  { chave: "financeiro", rotulo: "Financeiro" },
  { chave: "fiscal", rotulo: "Fiscal" },
  { chave: "aprovacao", rotulo: "Aprovação" },
  { chave: "execucao", rotulo: "Execução" }
] as const;
type ChaveAba = (typeof ABAS)[number]["chave"];

/** O texto de ajuda de cada seção. Um por aba, cada um explicando o que AQUELA seção decide. */
const AJUDA: Record<ChaveAba, string> = {
  identificacao:
    "Como esta operação é reconhecida: o código que o operador digita, o nome que ele lê e o movimento do produto que define de que operação se trata. O código e o movimento são escolhidos na criação e não mudam depois.",
  geral:
    "As regras de preenchimento e de ciclo de vida do documento: quem confirma, o que é obrigatório informar e o que ainda pode ser alterado depois da confirmação. Confirmação e alteração após confirmar ficam registradas nesta versão, mas ainda não são executadas: a confirmação automática, por exemplo, não confirma documento nenhum. As exigências de preenchimento só são cobradas no lançamento em versões gravadas com as restrições da operação.",
  destinos:
    "Para quais operações um documento deste tipo pode ser encaminhado. A lista de opções vem do servidor, já limitada ao que o produto sabe executar; habilitar um caminho aqui não concede permissão a ninguém. Enquanto esta operação não declarar a política, a conversão continua seguindo o caminho anterior do produto.",
  estoque:
    "Se esta operação declara movimentação de estoque e em que sentido, além do que ela exige do operador e do que fazer quando o saldo ficaria negativo. Esta seção só é executada quando a aba Execução entrega o estoque à configuração da TOP.",
  financeiro:
    "Se esta operação declara efeito financeiro, se ele nasce como título firme ou como previsão, e quais dados de cobrança passam a ser obrigatórios. Esta seção só é executada quando a aba Execução entrega o financeiro à configuração da TOP.",
  fiscal:
    "Se esta operação é relevante para o fiscal e quais informações fiscais o documento passa a exigir. Configuração preparada, ainda não executada: nenhum imposto é calculado e nenhum documento fiscal é gerado por ela.",
  aprovacao:
    "Se o documento precisa passar por aprovação antes de ser confirmado e, quando o critério for por valor, a partir de que valor a exigência começa. Configuração preparada, ainda não executada: nenhum documento é retido por aprovação.",
  execucao:
    "Quem decide o estoque e o financeiro de um documento desta operação: o comportamento legado do produto ou a configuração desta TOP. Cada efeito é decidido separadamente, e só o que o servidor declara executável pode ser ativado."
};

/**
 * COMPRAS-03 (item 0 f) — a ajuda da aba "Próximas operações" FORA de vendas. O texto de `AJUDA.destinos` é o de vendas,
 * o de antes da COMPRAS-02, sem mudar uma letra: só em vendas existe a ponte para o caminho anterior (havia acervo
 * convertendo por ela — decisão 268). Nos demais movimentos (compras, ou movimento ainda não escolhido) a política não
 * declarada quer dizer "sem próxima operação", e é isso que a ajuda diz. A chave é `ehMovimentoDeVendas`, a mesma do
 * aviso da aba (`EstadoDaPolitica`) e do histórico de versões.
 */
const AJUDA_DESTINOS_SEM_PONTE =
  "Para quais operações um documento deste tipo pode ser encaminhado. A lista de opções vem do servidor, já limitada ao que o produto sabe executar; habilitar um caminho aqui não concede permissão a ninguém. Enquanto esta operação não declarar a política, um documento deste tipo não oferece próxima operação.";

/** ESTOQUE-01 — a ajuda da Geral no documento de estoque: só a observação se aplica (`EXIGENCIAS_GERAIS_ESTOQUE_TOP`). */
const AJUDA_GERAL_DOCUMENTO_ESTOQUE =
  "O que é obrigatório informar no documento de estoque. Só a observação se aplica: o documento de estoque não tem parceiro, centro de resultado nem transportadora. A exigência só é cobrada no lançamento em versões gravadas com as restrições da operação.";

/** ESTOQUE-01 — a ajuda da seção Estoque no documento de estoque: a TOP não decide a movimentação, a espécie decide. */
const AJUDA_ESTOQUE_DOCUMENTO_ESTOQUE =
  "O movimento é definido pela espécie do documento, e não por esta seção.";

/**
 * TOP-CONFIG-08 (decisão 277) — OS TEXTOS DO EDITOR QUE GRAVA O FORMATO 4, que só valem com o bloco `regrasGerais`
 * declarado pelo servidor. No formato 4 a confirmação automática, o documento sem itens e a aprovação EXECUTAM; dizer
 * "registrado, ainda não executado" aqui seria mentir sobre a versão que o administrador está gravando. Sem o bloco
 * ficam os textos de cima, letra por letra: o servidor anterior grava o formato 3, e lá nada disso executa.
 */
const AJUDA_COM_REGRAS_GERAIS: Readonly<Record<"geral" | "aprovacao", string>> = {
  geral:
    "Confirmação automática: o documento é confirmado ao ser salvo, por quem salvou e com a mesma conferência da confirmação manual. Se a confirmação recusar, o documento fica salvo e aberto, com o motivo. Documento sem itens: o documento pode ser salvo e confirmado sem item. As exigências de preenchimento são cobradas no lançamento.",
  aprovacao:
    "Com aprovação, o documento só é confirmado depois de aprovado em Aprovações, por quem tem a permissão Aprovar. Alterar a venda depois de aprovada pede uma aprovação nova."
};

/** TOP-CONFIG-08 — a ajuda da Geral no documento de estoque com o bloco: a confirmação automática também vale ali. */
const AJUDA_GERAL_DOCUMENTO_ESTOQUE_COM_REGRAS_GERAIS =
  "No documento de estoque valem a confirmação automática e a observação obrigatória.";

// ---------------------------------------------------------------------------------------------------
// Campos
// ---------------------------------------------------------------------------------------------------

function CampoEnum<T extends string>({ rotulo, ajuda, valor, opcoes, rotulos, onChange, desabilitado, opcoesDesabilitadas, motivo, testId, span = 4 }: {
  rotulo: string; ajuda?: string; valor: T; opcoes: readonly T[]; rotulos: Record<T, string>;
  onChange: (v: T) => void; desabilitado?: boolean;
  /**
   * Opções que aparecem mas não podem ser escolhidas AGORA ("aplicável, porém indisponível"). A opção que
   * já é o valor atual nunca é desabilitada: ela precisa continuar sendo exibida como selecionada.
   */
  opcoesDesabilitadas?: readonly T[];
  /**
   * TOP-CONFIG-08 — POR QUE as opções desabilitadas não podem ser escolhidas, dito AO LADO do campo (o motivo da
   * matriz que o servidor declarou). Desabilitar sem dizer por quê deixaria o administrador procurando o defeito na
   * tela. Fica FORA do `Field` de propósito: o `Field` só liga o rótulo ao controle quando o filho é único. `campo`
   * compõe o `data-testid` (`top-regra-motivo-<campo>`). Ausente = o campo de hoje, sem texto nenhum.
   */
  motivo?: { campo: CampoRegraGeral; texto: string } | null;
  testId: string; span?: number;
}) {
  const campo = <Field label={rotulo} help={ajuda} span={span}>
    <NativeSelect data-testid={testId} value={valor} disabled={desabilitado} onChange={(e) => onChange(e.target.value as T)}>
      {opcoes.map((o) => <option key={o} value={o} disabled={o !== valor && !!opcoesDesabilitadas?.includes(o)}>{rotulos[o]}</option>)}
    </NativeSelect>
  </Field>;
  if (!motivo) return campo;
  return <>
    {campo}
    <p data-testid={`top-regra-motivo-${motivo.campo}`} className="col-span-12 self-center text-[11.5px] leading-relaxed text-slate-500 md:col-span-8">{motivo.texto}</p>
  </>;
}

/**
 * TOP-CONFIG-08 — a regra aparece no editor? Só quando a família aceita alguma opção ALÉM do neutro. A que só aceita
 * o neutro não tem o que decidir: o campo some, como as seções que não se aplicam ao documento de estoque — campo que
 * aparece e não decide nada é pior que campo ausente.
 */
const regraAparece = <T extends string>(r: RegraDaFamiliaTop<T>, neutro: T): boolean => r.aceitos.some((v) => v !== neutro);

/**
 * TOP-CONFIG-08 — as props de uma regra geral pela matriz da família: a opção que a família não aceita aparece
 * DESABILITADA, com o motivo da matriz ao lado ("aplicável, porém indisponível"). Sem a regra (sem o bloco
 * `regrasGerais`), nada: o campo de hoje, com todas as opções e sem texto.
 */
function pelaFamilia<T extends string>(opcoes: readonly T[], r: RegraDaFamiliaTop<T> | undefined, campo: CampoRegraGeral): {
  opcoesDesabilitadas?: readonly T[]; motivo?: { campo: CampoRegraGeral; texto: string } | null;
} {
  if (!r) return {};
  const fora = opcoes.filter((o) => !r.aceitos.includes(o));
  return { opcoesDesabilitadas: fora, motivo: fora.length > 0 && r.motivo ? { campo, texto: r.motivo } : null };
}

/** Booleano como escolha explícita de duas opções: "Sim/Não" é menos ambíguo que uma caixa marcada. */
function CampoSimNao({ rotulo, ajuda, valor, onChange, desabilitado, testId, span = 4 }: {
  rotulo: string; ajuda?: string; valor: boolean; onChange: (v: boolean) => void;
  desabilitado?: boolean; testId: string; span?: number;
}) {
  return <Field label={rotulo} help={ajuda} span={span}>
    <NativeSelect data-testid={testId} value={valor ? "true" : "false"} disabled={desabilitado} onChange={(e) => onChange(e.target.value === "true")}>
      <option value="false">Não</option>
      <option value="true">Sim</option>
    </NativeSelect>
  </Field>;
}

/**
 * Cabeçalho de seção com a ajuda própria daquela aba — nunca um texto genérico reaproveitado. `ajuda` troca o texto
 * quando a mesma aba diz coisas diferentes por movimento (hoje, só "Próximas operações": com ou sem a ponte de vendas).
 */
const Secao = ({ chave, ajuda, children }: { chave: ChaveAba; ajuda?: string; children: React.ReactNode }) => <div>
  <p className="mb-3 text-[12px] leading-relaxed text-slate-500">{ajuda ?? AJUDA[chave]}</p>
  <div className="grid grid-cols-12 gap-3">{children}</div>
</div>;

/**
 * Dito uma vez, em toda abertura do editor: configurar não é, por si, ligar o efeito.
 *
 * TOP-CONFIG-08: com o bloco `regrasGerais` (o editor grava o formato 4) muda SÓ a última frase — a aprovação e as
 * regras da Geral executam no formato 4, e só o fiscal continua declarado. Sem o bloco, o texto de hoje, letra por letra.
 */
const AvisoDeVersionamento = ({ regrasGerais }: { regrasGerais: boolean }) => <p data-testid="top-aviso-versionamento" className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[11.5px] leading-relaxed text-slate-600">
  O que você definir aqui é guardado e versionado: cada gravação cria uma versão nova e as anteriores
  continuam legíveis no histórico. Estoque e financeiro só seguem esta configuração quando a aba Execução
  diz &quot;Usar configuração da TOP&quot;, e isso vale para os documentos criados a partir da versão salva.
  {regrasGerais
    ? " O fiscal continua registrando a intenção da operação, sem executá-la."
    : " Fiscal, aprovação e as regras da aba Geral continuam registrando a intenção da operação, sem executá-la."}
</p>;

// ---------------------------------------------------------------------------------------------------
// O editor
// ---------------------------------------------------------------------------------------------------

export function EditorTipoOperacao({ id, revisaoConhecida, familias, onFechar, onPronto }: {
  /** Ausente = criação. */
  id?: string;
  /** A revisão que a listagem viu. Vai na gravação para o servidor recusar escrita sobre versão vencida. */
  revisaoConhecida?: number;
  familias: FamiliaTop[];
  onFechar: () => void;
  onPronto: () => void;
}) {
  const edicao = !!id;
  const capacidades = useCapacidadesTop();

  // Na edição o editor precisa do DETALHE (configuração e destinos), que a listagem não traz.
  const detalhe = useQuery<unknown, ApiError>({
    queryKey: ["tipos-operacao", id, "detalhe"],
    queryFn: () => api<unknown>(`/api/admin/tipos-operacao/${id}`),
    enabled: edicao,
    retry: false
  });
  const lido = React.useMemo(() => (detalhe.data === undefined ? null : lerDetalheTop(detalhe.data)), [detalhe.data]);

  if (edicao && detalhe.isPending) {
    return <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }} title="Editar tipo de operação" size="xl" testId="form-tipo-operacao">
      <LoadingState />
    </Dialog>;
  }
  if (edicao && (detalhe.isError || !lido)) {
    return <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }} title="Editar tipo de operação" size="xl" testId="form-tipo-operacao">
      <ErrorState
        error={detalhe.error}
        message={detalhe.error ? undefined : "Este servidor respondeu o tipo de operação em um formato que esta tela não reconhece. A edição está bloqueada para não gravar sobre dados que não foram lidos."}
      />
    </Dialog>;
  }

  return <CorpoDoEditor
    key={id ?? "novo"}
    id={id}
    revisao={lido?.revisao ?? revisaoConhecida}
    detalhe={lido}
    familias={familias}
    capacidades={capacidades}
    onFechar={onFechar}
    onPronto={onPronto}
  />;
}

function CorpoDoEditor({ id, revisao, detalhe, familias, capacidades, onFechar, onPronto }: {
  id?: string;
  revisao?: number;
  detalhe: ReturnType<typeof lerDetalheTop>;
  familias: FamiliaTop[];
  capacidades: EstadoCapacidadesTop;
  onFechar: () => void;
  onPronto: () => void;
}) {
  const edicao = !!id;
  const configuravel = podeConfigurar(capacidades);
  const destinosConfiguraveis = podeConfigurarDestinos(capacidades);
  const limite = limiteDeDestinos(capacidades);
  const emPartesConfiguravel = podeConfigurarEmPartes(capacidades);
  const execucao = capacidadesDeExecucao(capacidades);
  /**
   * TOP-CONFIG-05 — o servidor grava o formato 3? Só então o rascunho carrega `configuracaoV3`, os campos
   * novos aparecem e `condicoesPermitidas` pode ir no corpo. Sem isso o editor é o de hoje, byte a byte.
   */
  const restricoes = podeConfigurarRestricoes(capacidades);
  /** TOP-CONFIG-07 — o servidor grava a reserva de estoque na versão (`capabilities.reservaEstoque === 1`). */
  const reservaConfiguravel = podeConfigurarReservaEstoque(capacidades);
  const idDicaReserva = React.useId();
  /**
   * TOP-CONFIG-08 (decisão 277) — o servidor declarou o bloco `regrasGerais` (legível, formato 4)? Só então o rascunho
   * carrega `configuracaoV4` (a verdade da configuração), a gravação sai no formato 4 e os campos das quatro regras
   * gerais seguem a MATRIZ DA FAMÍLIA que ele publicou. Sem o bloco, `matriz` é `null` e o editor é o de hoje: o
   * formato 3, os textos de hoje e as abas de hoje.
   */
  const matriz = matrizRegrasGerais(capacidades);
  const regrasGerais = podeConfigurarRegrasGerais(capacidades) && matriz !== null;
  /**
   * A versão vigente já está no formato 3 ou 4 (as restrições executam) — sem restrições no servidor, a configuração
   * não tem envio honesto. TOP-CONFIG-08: perguntado ao domínio (`restricoesExecutamTop`), nunca ao número 3: uma
   * vigente no formato 4 lida como "não é 3" deixaria um servidor sem restrições receber o formato 2 por cima dela.
   */
  const vigenteNoFormato3 = edicao && !!detalhe?.configuracao && detalhe.configuracao.suportada
    && restricoesExecutamTop(detalhe.configuracao.valor);
  /** A lista de condições não foi lida (API anterior): não é reescrita, e a tela a bloqueia. */
  const condicoesIlegiveis = edicao && !!detalhe && restricoes && detalhe.condicoesPermitidas === null;

  /**
   * A configuração de partida.
   *
   * Numa API que confirmou o contrato mas devolveu `suportada: false`, o editor avançado fica BLOQUEADO em
   * vez de abrir no neutro: abrir no neutro convidaria a salvar por cima de uma regra que ninguém leu, e o
   * salvar gravaria "nada declarado" onde havia alguma coisa.
   *
   * TOP-CONFIG-08: a mesma régua para uma vigente no formato 4 diante do editor SEM o bloco `regrasGerais` (servidor
   * mais novo que a tela, ou bloco que ela não lê) — `configuracaoIlegivelNoEditor`, de `top-contrato`. Os textos desse
   * editor dizem que as regras gerais não executam, e no 4 elas executam: editar ali seria gravar sobre o que não se leu.
   */
  const configuracaoIlegivel = edicao && !!detalhe && configuracaoIlegivelNoEditor(detalhe.configuracao, capacidades);
  const liberado = configuravel && !configuracaoIlegivel;

  /**
   * A LISTA DE DESTINOS NÃO FOI LIDA — e por isso não pode ser reescrita.
   *
   * O servidor declarou que sustenta próximas operações (`capabilities.destinos.suportado`), mas o detalhe
   * não trouxe a lista numa forma reconhecível. Abrir a aba assim mostraria uma lista VAZIA que não é a
   * política — e a gravação seguinte enviaria `[]`, apagando arestas que ninguém viu. É o mesmo erro de
   * ler ausência como vazio que esta correção existe para desfazer, só que do lado do cliente.
   */
  const destinosIlegiveis = edicao && !!detalhe && destinosConfiguraveis && detalhe.destinos === null;

  const inicial = React.useMemo<RascunhoTop>(() => ({
    nome: detalhe?.nome ?? "",
    descricao: detalhe?.descricao ?? "",
    ativo: detalhe?.ativo ?? true,
    padrao: detalhe?.padrao ?? false,
    codigo: detalhe?.codigo ?? "",
    codigoBase: detalhe?.familia.codigo ?? "",
    configuracao: configuracaoInicial(detalhe?.configuracao ?? null),
    destinos: (detalhe?.destinos ?? []).map((d) => ({
      tipoOperacaoId: d.tipoOperacaoId, codigo: d.codigo, nome: d.nome, familiaRotulo: d.familiaRotulo, disponivel: d.disponivel, emPartes: d.emPartes === true
    })),
    /**
     * SÓ `true` COMEÇA DECLARADO. `false` (legado) e `null` (servidor que não informou) começam como NÃO
     * declarado — e a gravação então OMITE `destinos`, que é o contrato de "preserve o que está lá".
     *
     * O caminho oposto seria começar sempre declarado "porque o editor sabe editar destinos": aí qualquer
     * gravação de nome ou de configuração converteria, de carona, todo registro legado em "declarado sem
     * nenhuma próxima operação" — e a conversão daquela operação pararia de funcionar sem que ninguém
     * tivesse pedido isso, na edição de um campo que nada tem a ver com o assunto.
     */
    destinosDeclarados: detalhe?.destinosConfigurados === true,
    /**
     * TOP-CONFIG-07 — na edição, o valor que o detalhe LEU (ausente quando ele não informou: a caixa fica bloqueada
     * e a chave não vai no corpo); na criação, `false`. Não depende das capacidades, que chegam depois: quem decide
     * se a chave É ENVIADA é a gravação.
     */
    ...(detalhe ? (detalhe.reservaEstoque !== null ? { reservaEstoque: detalhe.reservaEstoque } : {}) : { reservaEstoque: false }),
    ...camposDeRestricoes(restricoes, regrasGerais, detalhe)
  }), [detalhe, restricoes, regrasGerais]);

  const [rascunho, setRascunho] = React.useState<RascunhoTop>(inicial);
  const [abaEscolhida, setAba] = React.useState<ChaveAba>("identificacao");
  /** ESTOQUE-01 — o movimento é uma das famílias do documento de estoque? Perguntado ao registry, nunca a uma lista daqui. */
  const documentoEstoque = ehFamiliaDeDocumentoEstoque(rascunho.codigoBase);
  /**
   * TOP-CONFIG-08 — o que a FAMÍLIA aceita em cada regra geral, pela matriz que o SERVIDOR declarou (nunca uma cópia
   * daqui). Família ainda não escolhida, ou fora da matriz, cai no padrão do domínio "sem documento", que só aceita o
   * neutro: os campos somem. `null` = sem o bloco, e nenhum campo depende da família (o editor de hoje).
   *
   * Exige também o rascunho NO FORMATO 4: a tela só diz "executa" sobre o que ela vai de fato gravar no 4. No instante
   * entre as capacidades chegarem e o rascunho ganhar `configuracaoV4` (o efeito abaixo), ela continua a de hoje.
   */
  const regrasDaFamilia: ItemMatrizRegrasGeraisTop | null = regrasGerais && matriz && rascunho.configuracaoV4
    ? regrasGeraisDaFamiliaTop(rascunho.codigoBase, matriz) : null;
  /** Cada regra geral aparece? Sem o bloco, sempre (como hoje); com ele, só quando a família aceita algo além do neutro. */
  const regraVisivel: Readonly<Record<CampoRegraGeral, boolean>> = {
    confirmacao: !regrasDaFamilia || regraAparece(regrasDaFamilia.confirmacao, NEUTRO_V4.geral.confirmacao),
    documentoSemItens: !regrasDaFamilia || regraAparece(regrasDaFamilia.documentoSemItens, NEUTRO_V4.geral.documentoSemItens),
    alteracaoAposConfirmacao: !regrasDaFamilia || regraAparece(regrasDaFamilia.alteracaoAposConfirmacao, NEUTRO_V4.geral.alteracaoAposConfirmacao),
    aprovacao: !regrasDaFamilia || regraAparece(regrasDaFamilia.aprovacao, NEUTRO_V4.aprovacao.politica)
  };
  const abasForaDoEstoque = regrasDaFamilia ? ABAS_FORA_DO_DOCUMENTO_ESTOQUE_COM_REGRAS_GERAIS : ABAS_FORA_DO_DOCUMENTO_ESTOQUE;
  const abasVisiveis = ABAS.filter((a) => (!documentoEstoque || !abasForaDoEstoque.has(a.chave))
    // TOP-CONFIG-08: com o bloco, a aba Aprovação inteira some onde a família só aceita "Sem aprovação" (orçamento,
    // pedidos e as famílias sem documento) — é a regra do campo que some, aplicada à aba que só tem esse campo.
    && (a.chave !== "aprovacao" || regraVisivel.aprovacao));
  // Uma aba escondida nunca fica ativa (um erro do servidor pode apontar para ela): cai na identificação.
  const aba: ChaveAba = abasVisiveis.some((a) => a.chave === abaEscolhida) ? abaEscolhida : "identificacao";
  const [confirmandoDescarte, setConfirmandoDescarte] = React.useState(false);
  const [erro, setErro] = React.useState<unknown>(null);
  const [conflito, setConflito] = React.useState(false);
  /** Erros de campo (caminho → mensagem): do domínio antes de enviar, ou do 422 do servidor. */
  const [errosCampo, setErrosCampo] = React.useState<Record<string, string>>({});

  /**
   * As capacidades chegam DEPOIS da montagem. Quando o servidor confirma as restrições, o rascunho ganha o
   * formato 3 da versão carregada (as seções de configuração só abrem nesse mesmo instante, então não há
   * edição de configuração a preservar); os campos de identificação digitados enquanto isso ficam.
   */
  React.useEffect(() => {
    if (!restricoes) return;
    setRascunho((r) => (r.configuracaoV3 || r.configuracaoV4 ? r : { ...r, ...camposDeRestricoes(true, regrasGerais, detalhe) }));
  }, [restricoes, regrasGerais, detalhe]);

  const assinaturaInicial = React.useMemo(() => assinaturaRascunho(inicial), [inicial]);
  const alterado = assinaturaRascunho(rascunho) !== assinaturaInicial;

  const mudar = React.useCallback((p: Partial<RascunhoTop>) => setRascunho((r) => ({ ...r, ...p })), []);
  /**
   * Toda mudança de configuração passa pela normalização do domínio: o rascunho nunca guarda campo pendurado.
   *
   * O FORMATO QUE ENTRA É O FORMATO QUE SAI (TOP-CONFIG-08). Com o bloco `regrasGerais`, o formato 4 é a verdade; com
   * só as restrições, o 3. Normalizar a cada edição rebaixando o 4 para 3 faria a gravação seguinte desligar, em
   * silêncio, as regras gerais e a aprovação — por isso `aplicarNoFormato3` e a normalização do domínio preservam o número.
   */
  const mudarConfig = React.useCallback((f: (c: ConfiguracaoTipoOperacaoV2) => ConfiguracaoTipoOperacaoV2) => {
    setRascunho((r) => {
      if (r.configuracaoV4) {
        const v4 = normalizarConfiguracaoTop(aplicarNoFormato3(r.configuracaoV4, f));
        return { ...r, configuracaoV4: v4, configuracao: configuracaoTopParaEdicao(v4) };
      }
      if (!r.configuracaoV3) return { ...r, configuracao: normalizarConfiguracaoTop(f(r.configuracao)) };
      // Com restrições, o formato 3 é a verdade; a vista formato 2 é sempre DERIVADA dele (uma verdade só).
      const v3 = normalizarConfiguracaoTop(aplicarNoFormato3(r.configuracaoV3, f));
      return { ...r, configuracaoV3: v3, configuracao: configuracaoTopParaEdicao(v3) };
    });
  }, []);
  /** As chaves novas do formato 3 (iguais no 4). Sem restrições não há `configuracaoV3` nem `configuracaoV4`, e nada muda. */
  const mudarConfigV3 = React.useCallback((f: MudancaComRestricoes) => {
    setRascunho((r) => {
      if (r.configuracaoV4) {
        const v4 = normalizarConfiguracaoTop(f(r.configuracaoV4));
        return { ...r, configuracaoV4: v4, configuracao: configuracaoTopParaEdicao(v4) };
      }
      if (!r.configuracaoV3) return r;
      const v3 = normalizarConfiguracaoTop(f(r.configuracaoV3));
      return { ...r, configuracaoV3: v3, configuracao: configuracaoTopParaEdicao(v3) };
    });
  }, []);
  /** O rascunho com as chaves do formato 3 — o 4 (com o bloco) ou o 3 (só restrições). Ausente = o editor de hoje. */
  const comRestricoes: ConfiguracaoComRestricoesTop | undefined = rascunho.configuracaoV4 ?? rascunho.configuracaoV3;

  /**
   * A EXECUÇÃO PEDIDA PODE SER GRAVADA? A mesma pergunta que o servidor faz, contra a matriz QUE ELE
   * declarou — só para o administrador saber antes. Duas razões de bloqueio, cada uma com a sua frase:
   * a combinação não é executável para esta família, ou ela ATIVA execução com o gate desligado.
   */
  const recusasExecucao = liberado && execucao.suportado && rascunho.codigoBase
    ? validarExecucaoTop(rascunho.codigoBase, rascunho.configuracao, execucao.matriz) : [];
  const ativacaoSemRuntime = liberado && execucao.suportado && !execucao.runtimeHabilitado
    ? efeitosAtivadosTop(edicao ? inicial.configuracao : null, rascunho.configuracao) : [];
  /**
   * TOP-CONFIG-08 — O FORMATO 4 VAI COM AS REGRAS GERAIS QUE A FAMÍLIA NÃO EXECUTA DE VOLTA AO PADRÃO, pela régua do
   * domínio (`normalizarRegrasGeraisDaFamiliaTop`, contra a matriz que o servidor declarou). É o caso do pedido de
   * compra de produção (formato 3 com Automática, Permitido e Permitida): no formato 4 o pedido só aceita o neutro, e
   * mandar o que ele tinha seria um 422 garantido. A volta NUNCA é silenciosa: na edição, o diálogo "Estas regras
   * passam a valer" a lista antes de gravar (`voltaram`), e só "Salvar assim mesmo" segue; na criação os campos da
   * família já não oferecem o que ela não aceita, e trocar a família volta tudo ao neutro do formato 4.
   */
  const regrasNormalizadas = liberado && rascunho.configuracaoV4 && matriz
    ? normalizarRegrasGeraisDaFamiliaTop(rascunho.codigoBase, rascunho.configuracaoV4, matriz) : null;
  const envio = configuracaoDoRascunhoParaEnvio(
    regrasNormalizadas ? { ...rascunho, configuracaoV4: regrasNormalizadas.configuracao } : rascunho,
    execucao.suportado,
    vigenteNoFormato3
  );
  /**
   * TOP-CONFIG-07 — a caixa da reserva existe? Capacidade declarada E família do pedido. Ela NÃO depende da
   * movimentação declarada nem da aba Execução: a reserva vale para o pedido salvo mesmo com "Não movimenta estoque".
   * `reservaIlegivel`: o detalhe não informou o valor — a caixa fica bloqueada e nada sobre ela é enviado.
   */
  const reservaOferecida = reservaConfiguravel && !!FAMILIA_DO_PEDIDO && rascunho.codigoBase === FAMILIA_DO_PEDIDO;
  const reservaIlegivel = reservaOferecida && rascunho.reservaEstoque === undefined;
  const bloqueioDaSecao = (efeito: EfeitoExecucaoTop): BloqueioDaSecao =>
    recusasExecucao.some((r) => r.caminho === `execucao.${efeito}` || r.caminho.startsWith(`${efeito}.`)) ? "combinacao_recusada"
      : execucao.suportado && !execucao.runtimeHabilitado ? "execucao_desligada" : null;
  const salvar = useMutation({
    mutationFn: () => {
      const base: Record<string, unknown> = {
        nome: rascunho.nome,
        descricao: rascunho.descricao || null,
        ativo: rascunho.ativo,
        padrao: rascunho.padrao
      };
      // NUNCA ÀS CEGAS: sem contrato confirmado, `configuracao` e `destinos` simplesmente não vão no corpo —
      // e a tela já avisou que essas seções estão bloqueadas, então ninguém lê "salvo" sobre elas. E vai no
      // FORMATO que este servidor grava: o 2 quando ele declara execução, o 1 quando não (ver
      // `configuracaoParaEnvio`; o botão já fica bloqueado quando não há envio honesto).
      if (liberado && envio) base.configuracao = envio;
      /**
       * A PRESENÇA DA CHAVE `destinos` É A DECLARAÇÃO — no servidor e, portanto, aqui.
       *
       *   ausente  preserve o que já estava (arestas E o estado da política). É o que sai daqui quando o
       *            usuário não declarou nada, e é o que mantém intacto o registro legado.
       *   presente declare. `[]` é uma declaração legítima e VAI como `[]`: "esta operação não gera
       *            próxima operação" é uma decisão, não a falta de uma.
       *
       * Por isso a condição é `destinosDeclarados`, e não `destinos.length` — a lista vazia aparece nos
       * dois estados, e é justamente o que ela NÃO consegue distinguir.
       */
      if (liberado && destinosConfiguraveis && !destinosIlegiveis && rascunho.destinosDeclarados) {
        // `emPartes` só viaja quando a API o declara: servidor anterior recusaria a chave desconhecida.
        base.destinos = rascunho.destinos.map((d, i) => ({ tipoOperacaoId: d.tipoOperacaoId, ordem: i + 1, ...(emPartesConfiguravel ? { emPartes: d.emPartes } : {}) }));
      }
      /**
       * TOP-CONFIG-05 — a PRESENÇA DA CHAVE `condicoesPermitidas` também é a declaração (ausente = preservar).
       * Só vai com a configuração no formato 3 (ou 4, TOP-CONFIG-08) no mesmo corpo (o servidor recusa a lista sem
       * ele) e só quando o usuário mexeu na lista (`condicoesDeclaradas`, régua em `RascunhoTop`).
       */
      if (liberado && restricoes && base.configuracao !== undefined && comRestricoes
        && rascunho.condicoesPermitidas && rascunho.condicoesDeclaradas && !condicoesIlegiveis) {
        base.condicoesPermitidas = rascunho.condicoesPermitidas.map((c) => c.id);
      }
      /**
       * TOP-CONFIG-07 — `reservaEstoque` só viaja com a capacidade declarada e na família do pedido (servidor anterior
       * recusaria a chave; outra família é 422). No PUT o servidor lê AUSENTE como "preserve", então valor não lido
       * (`reservaIlegivel`) simplesmente não vai.
       */
      if (liberado && reservaOferecida && rascunho.reservaEstoque !== undefined) base.reservaEstoque = rascunho.reservaEstoque;
      if (edicao) return api(`/api/admin/tipos-operacao/${id}`, { method: "PUT", body: { ...base, revisao } });
      return api("/api/admin/tipos-operacao", {
        method: "POST",
        body: { ...base, codigo: rascunho.codigo, codigoBase: rascunho.codigoBase }
      });
    },
    onSuccess: onPronto,
    onError: (e) => {
      // Conflito otimista NÃO reenvia e NÃO sobrescreve: o servidor já tem uma versão que esta tela não viu.
      if (ehConflitoDeConcorrencia(e)) { setConflito(true); setErro(null); return; }
      setConflito(false);
      setErro(e);
      // 422 de configuração/condições: o erro vai também para o CAMPO (e a aba dele abre).
      const doServidor = errosDeCampoDoServidor(e);
      setErrosCampo(doServidor);
      const primeiro = Object.keys(doServidor)[0];
      if (primeiro) setAba(abaDoCaminho(primeiro));
    }
  });

  const porValor = rascunho.configuracao.aprovacao.politica === "por_valor";
  const valorMinimo = rascunho.configuracao.aprovacao.valorMinimo ?? "";
  const valorMinimoOk = !porValor || valorMinimoAceitavel(valorMinimo);
  const execucaoOk = !liberado || (envio !== null && recusasExecucao.length === 0 && ativacaoSemRuntime.length === 0);
  const valido = rascunho.nome.trim().length > 0
    && (edicao || (rascunho.codigo.trim().length > 0 && rascunho.codigoBase.length > 0))
    && valorMinimoOk && execucaoOk;

  const fechar = () => { if (alterado) setConfirmandoDescarte(true); else onFechar(); };

  /**
   * ANTES DE ENVIAR, a mesma pergunta que o servidor fará (TOP-CONFIG-05): CFOP no sentido da família e a
   * tolerância no intervalo. Havendo recusa, o erro vai para o campo, a aba dele abre e NADA é enviado.
   * O servidor continua sendo a autoridade — ele recusa de novo com 422, para qualquer cliente.
   */
  const [perguntas, setPerguntas] = React.useState<PerguntasAntesDeGravar | null>(null);
  const tentarSalvar = () => {
    const locais: Record<string, string> = {};
    // TOP-CONFIG-08: as chaves do formato 3 vivem no 4 também — as mesmas conferências, o mesmo envio.
    const v3 = liberado ? comRestricoes : undefined;
    if (v3) {
      if (rascunho.codigoBase) {
        for (const r of recusasFiscaisDaFamiliaTop(v3, rascunho.codigoBase)) {
          if (!(r.caminho in locais)) locais[r.caminho] = r.mensagem;
        }
      }
      const t = v3.financeiro.toleranciaAtrasoDias;
      if (!Number.isInteger(t) || t < 0 || t > TOLERANCIA_ATRASO_MAXIMA_DIAS) {
        locais["financeiro.toleranciaAtrasoDias"] = `Informe de 0 a ${TOLERANCIA_ATRASO_MAXIMA_DIAS} dias.`;
      }
    }
    setErrosCampo(locais);
    const primeiro = Object.keys(locais)[0];
    if (primeiro) { setAba(abaDoCaminho(primeiro)); return; }
    /**
     * TOP-CONFIG-05_R1 — gravar leva a TOP do formato 1/2 ao 3 e alguma exigência da Geral estava marcada: a
     * partir desta versão ela passa a ser COBRADA no lançamento. Pergunta ANTES de qualquer PUT. A lista vem
     * do domínio (uma fonte); a tela não tem a sua.
     */
    const aValer = edicao && v3 && detalhe?.configuracao?.suportada
      ? exigenciasQuePassamAValer(detalhe.configuracao.valor, v3, exigenciasGeraisDaFamiliaTop(detalhe.familia.codigo)) : [];
    /**
     * TOP-CONFIG-08 — gravar no formato 4 LIGA as regras gerais e a aprovação que a versão vigente só declarava, e
     * VOLTA AO PADRÃO o que a família não executa. As duas listas vêm do DOMÍNIO (`regrasGeraisQuePassamAValer` e o
     * `voltaram` de `normalizarRegrasGeraisDaFamiliaTop`), nunca de uma régua desta tela. Só na EDIÇÃO de uma TOP que
     * já existe: na criação não há o que passaria a valer, e os campos já mostram o que a família aceita.
     */
    const regras: RegrasQuePassamAValer | null = edicao && regrasNormalizadas && detalhe?.configuracao?.suportada
      ? { passam: regrasGeraisQuePassamAValer(detalhe.configuracao.valor, regrasNormalizadas.configuracao), voltaram: regrasNormalizadas.voltaram }
      : null;
    const perguntarRegras = regras && (regras.passam.length > 0 || regras.voltaram.length > 0) ? regras : null;
    // Quando as duas valem, a das exigências vem primeiro e a das regras depois (`depoisDasExigencias`).
    if (aValer.length > 0 || perguntarRegras) {
      setPerguntas({ exigencias: aValer.length > 0 ? aValer : null, regras: perguntarRegras });
      return;
    }
    salvar.mutate();
  };
  /** "Salvar assim mesmo" no diálogo das exigências: a pergunta das regras, se houver, ainda vem antes de gravar. */
  const depoisDasExigencias = () => {
    if (perguntas?.regras) { setPerguntas({ exigencias: null, regras: perguntas.regras }); return; }
    setPerguntas(null);
    salvar.mutate();
  };

  /**
   * TOP-CONFIG-08 — as três regras de `geral`, na ordem de hoje (Confirmação, Alteração após confirmar, Documento sem
   * itens). Sem o bloco: as três, com todas as opções e sem texto (o editor de hoje). Com ele, cada uma pela matriz da
   * família: a que só aceita o neutro some; a opção que a família não aceita fica desabilitada, com o motivo ao lado.
   */
  const regrasDoGeral = <>
    {regraVisivel.confirmacao && <CampoEnum rotulo="Confirmação" testId="top-campo-geral-confirmacao" valor={rascunho.configuracao.geral.confirmacao}
      opcoes={MODOS_CONFIRMACAO} rotulos={ROTULOS_TOP.confirmacao}
      ajuda="Quem dispara a confirmação do documento."
      {...pelaFamilia(MODOS_CONFIRMACAO, regrasDaFamilia?.confirmacao, "confirmacao")}
      onChange={(v) => mudarConfig((c) => ({ ...c, geral: { ...c.geral, confirmacao: v } }))} />}
    {regraVisivel.alteracaoAposConfirmacao && <CampoEnum rotulo="Alteração após confirmar" testId="top-campo-geral-alteracao" valor={rascunho.configuracao.geral.alteracaoAposConfirmacao}
      opcoes={POLITICAS_ALTERACAO} rotulos={ROTULOS_TOP.alteracao}
      ajuda="Se o documento ainda pode ser alterado depois de confirmado."
      {...pelaFamilia(POLITICAS_ALTERACAO, regrasDaFamilia?.alteracaoAposConfirmacao, "alteracaoAposConfirmacao")}
      onChange={(v) => mudarConfig((c) => ({ ...c, geral: { ...c.geral, alteracaoAposConfirmacao: v } }))} />}
    {regraVisivel.documentoSemItens && <CampoEnum rotulo="Documento sem itens" testId="top-campo-geral-sem-itens" valor={rascunho.configuracao.geral.documentoSemItens}
      opcoes={POLITICAS_DOCUMENTO_SEM_ITENS} rotulos={ROTULOS_TOP.documentoSemItens}
      ajuda="Se um documento desta operação pode existir sem nenhum item."
      {...pelaFamilia(POLITICAS_DOCUMENTO_SEM_ITENS, regrasDaFamilia?.documentoSemItens, "documentoSemItens")}
      onChange={(v) => mudarConfig((c) => ({ ...c, geral: { ...c.geral, documentoSemItens: v } }))} />}
  </>;

  return <>
    <Dialog
      open
      onOpenChange={(o) => { if (!o) fechar(); }}
      title={edicao ? `Editar tipo de operação ${rascunho.codigo}` : "Novo tipo de operação"}
      description="As alterações são gravadas de uma vez, ao salvar, e criam uma versão nova."
      size="xl"
      testId="form-tipo-operacao"
      footer={<>
        <Button variant="ghost" data-testid="top-cancelar" onClick={fechar}>{COPY.cancelar}</Button>
        <Button data-testid="top-salvar" onClick={tentarSalvar} disabled={!valido} loading={salvar.isPending}>{COPY.salvar}</Button>
      </>}
    >
      {edicao && id && detalhe ? <div className="mb-2"><LinhaLayoutDocumentoTop tipoOperacaoId={id} familia={detalhe.familia.codigo} /></div> : null}
      <div role="tablist" aria-label="Seções do tipo de operação" className="mb-3 flex flex-wrap gap-1 border-b">
        {abasVisiveis.map((a) => <button
          key={a.chave}
          type="button"
          role="tab"
          aria-selected={aba === a.chave}
          data-testid={`top-aba-${a.chave}`}
          onClick={() => setAba(a.chave)}
          className={cn(
            "border-b-2 px-3 py-1.5 text-xs font-medium",
            aba === a.chave ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-700"
          )}
        >{a.rotulo}</button>)}
      </div>

      {aba !== "identificacao" && !liberado
        ? <BloqueioDeConfiguracao estado={capacidades} ilegivel={configuracaoIlegivel} />
        : null}

      {aba === "identificacao" && <Secao chave="identificacao">
        <Field label="Código" required span={3} help="Identifica a operação para quem lança. Escolhido na criação e permanente depois dela.">
          <Input data-testid="top-campo-codigo" value={rascunho.codigo} readOnly={edicao} disabled={edicao}
            onChange={(e) => mudar({ codigo: e.target.value })} placeholder="2103" />
        </Field>
        <Field label="Nome" required span={9}>
          <Input data-testid="top-campo-nome" value={rascunho.nome} onChange={(e) => mudar({ nome: e.target.value })} placeholder="Venda de gado a prazo" />
        </Field>
        <Field label="Movimento" required span={6} help="Define qual operação do produto este tipo representa. Não muda depois da criação.">
          {edicao
            ? <Input data-testid="top-campo-familia" value={detalhe ? `${detalhe.familia.rotulo} (${detalhe.familia.codigo})` : ""} readOnly disabled />
            : <NativeSelect data-testid="top-campo-familia" value={rascunho.codigoBase} onChange={(e) => {
                const codigoBase = e.target.value;
                mudar({ codigoBase, destinos: [], reservaEstoque: false });
                /**
                 * TOP-CONFIG-08: com o bloco `regrasGerais`, TROCAR A FAMÍLIA VOLTA TUDO AO NEUTRO DO FORMATO 4. Cada
                 * família aceita regras gerais diferentes (a matriz), e uma regra marcada para a família anterior que
                 * a nova não executa ficaria escondida no rascunho, indo na gravação sem ninguém ver. O neutro do 4 já
                 * tem "Cliente em atraso" em "não valida" e as seções do estoque no neutro: as duas regras abaixo, de
                 * hoje, ficam cobertas.
                 */
                if (regrasDaFamilia) { mudar({ configuracao: configuracaoInicial(null), ...camposDeRestricoes(restricoes, true, null) }); return; }
                // "Cliente em atraso" só existe na venda: fora dela volta para "não valida" (a API recusa outro valor).
                if (!ehMovimentoDeVendas(codigoBase)) mudarConfigV3((c) => ({ ...c, financeiro: { ...c.financeiro, clienteEmAtraso: "nao_valida" } }));
                // ESTOQUE-01: no documento de estoque as seções que não se aplicam somem — e o que tinha sido marcado
                // nelas antes da escolha do movimento volta ao neutro, para nenhuma regra escondida ir na gravação.
                if (ehFamiliaDeDocumentoEstoque(codigoBase)) mudar({ configuracao: configuracaoInicial(null), ...camposDeRestricoes(restricoes, regrasGerais, null) });
              }}>
                <option value="">Selecione…</option>
                {familias.map((f) => <option key={f.codigo} value={f.codigo}>{f.rotulo} — {f.codigo}</option>)}
              </NativeSelect>}
        </Field>
        <CampoSimNao rotulo={COPY.situacao} span={3} testId="top-campo-situacao" valor={rascunho.ativo}
          ajuda="Um tipo inativo continua no histórico, mas deixa de ser oferecido em lançamentos novos."
          onChange={(v) => mudar({ ativo: v, padrao: v ? rascunho.padrao : false })} />
        <CampoSimNao rotulo="Padrão do movimento" span={3} testId="top-campo-padrao" valor={rascunho.padrao} desabilitado={!rascunho.ativo}
          ajuda="No máximo um tipo padrão por movimento. Ao marcar este, o anterior deixa de ser o padrão."
          onChange={(v) => mudar({ padrao: v })} />
        <Field label="Descrição" span={12}>
          <Textarea data-testid="top-campo-descricao" rows={3} value={rascunho.descricao} onChange={(e) => mudar({ descricao: e.target.value })} />
        </Field>
      </Secao>}

      {aba === "geral" && liberado && documentoEstoque && <Secao chave="geral" ajuda={regrasDaFamilia ? AJUDA_GERAL_DOCUMENTO_ESTOQUE_COM_REGRAS_GERAIS : AJUDA_GERAL_DOCUMENTO_ESTOQUE}>
        {/* TOP-CONFIG-08: só com o bloco — sem ele o documento de estoque continua só com a observação, como hoje. */}
        {regrasDaFamilia && regrasDoGeral}
        <CampoSimNao rotulo="Exigir observação" testId="top-campo-geral-observacao" valor={rascunho.configuracao.geral.exigeObservacao}
          onChange={(v) => mudarConfig((c) => ({ ...c, geral: { ...c.geral, exigeObservacao: v } }))} />
        <ErrosDeCampo erros={errosCampo} prefixos={["geral"]} />
      </Secao>}

      {aba === "geral" && liberado && !documentoEstoque && <Secao chave="geral" ajuda={regrasDaFamilia ? AJUDA_COM_REGRAS_GERAIS.geral : undefined}>
        {regrasDoGeral}
        <CampoSimNao rotulo="Exigir parceiro" testId="top-campo-geral-parceiro" valor={rascunho.configuracao.geral.exigeParceiro}
          onChange={(v) => mudarConfig((c) => ({ ...c, geral: { ...c.geral, exigeParceiro: v } }))} />
        <CampoSimNao rotulo="Exigir centro de resultado" testId="top-campo-geral-centro" valor={rascunho.configuracao.geral.exigeCentroResultado}
          onChange={(v) => mudarConfig((c) => ({ ...c, geral: { ...c.geral, exigeCentroResultado: v } }))} />
        <CampoSimNao rotulo="Exigir observação" testId="top-campo-geral-observacao" valor={rascunho.configuracao.geral.exigeObservacao}
          onChange={(v) => mudarConfig((c) => ({ ...c, geral: { ...c.geral, exigeObservacao: v } }))} />
        {comRestricoes && <Field label="Exigir transportadora" span={4}>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" data-testid="top-geral-exige-transportadora"
              checked={comRestricoes.geral.exigeTransportadora}
              onChange={(e) => {
                const marcado = e.target.checked;
                mudarConfigV3((c) => ({ ...c, geral: { ...c.geral, exigeTransportadora: marcado } }));
              }} />
            Exige transportadora
          </label>
        </Field>}
        <ErrosDeCampo erros={errosCampo} prefixos={["geral"]} />
      </Secao>}

      {aba === "destinos" && liberado && <Secao chave="destinos" ajuda={ehMovimentoDeVendas(rascunho.codigoBase) ? undefined : AJUDA_DESTINOS_SEM_PONTE}>
        <div className="col-span-12">
          <AbaDestinos
            codigoBase={rascunho.codigoBase}
            destinos={rascunho.destinos}
            limite={limite}
            habilitado={destinosConfiguraveis}
            emPartesConfiguravel={emPartesConfiguravel}
            ilegivel={destinosIlegiveis}
            declarado={rascunho.destinosDeclarados}
            estadoNoServidor={edicao ? detalhe?.destinosConfigurados ?? null : false}
            // MEXER NA LISTA É DECLARAR. Incluir, remover ou reordenar são a mesma decisão vista de três
            // ângulos: a partir daí existe uma política escrita por alguém, e ela vai no corpo da gravação.
            onChange={(d) => mudar({ destinos: d, destinosDeclarados: true })}
            onDeclarar={() => mudar({ destinosDeclarados: true })}
          />
        </div>
      </Secao>}

      {aba === "estoque" && liberado && documentoEstoque && <Secao chave="estoque" ajuda={AJUDA_ESTOQUE_DOCUMENTO_ESTOQUE}>
        <p data-testid="top-estoque-definido-pela-especie" className="col-span-12 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-700">
          O movimento é definido pela espécie: a entrada põe a quantidade no armazém pelo custo informado, a saída a tira
          pelo custo médio, a transferência a tira da origem e a põe no destino com o mesmo custo, e o ajuste leva o saldo
          à quantidade contada. O saldo só muda quando o documento é confirmado. Esta operação dá ao documento o nome, a
          operação padrão da espécie e a versão congelada; ela não decide a movimentação.
        </p>
      </Secao>}

      {aba === "estoque" && liberado && !documentoEstoque && <Secao chave="estoque">
        <CampoEnum rotulo="Movimentação" testId="top-campo-estoque-atualizacao" valor={rascunho.configuracao.estoque.atualizacao}
          opcoes={ATUALIZACOES_ESTOQUE} rotulos={ROTULOS_TOP.estoqueAtualizacao}
          ajuda="O sentido do efeito declarado. Sem movimentação, os demais campos desta seção não decidem nada."
          onChange={(v) => mudarConfig((c) => ({ ...c, estoque: { ...c.estoque, atualizacao: v } }))} />
        <CampoEnum rotulo="Momento do efeito" testId="top-campo-estoque-momento" valor={rascunho.configuracao.estoque.momento}
          opcoes={MOMENTOS_EFEITO} rotulos={ROTULOS_TOP.momentoEfeito}
          desabilitado={rascunho.configuracao.estoque.atualizacao === "nenhuma"}
          onChange={(v) => mudarConfig((c) => ({ ...c, estoque: { ...c.estoque, momento: v } }))} />
        <CampoSimNao rotulo="Exigir armazém" testId="top-campo-estoque-armazem" valor={rascunho.configuracao.estoque.exigeArmazem}
          desabilitado={rascunho.configuracao.estoque.atualizacao === "nenhuma"}
          onChange={(v) => mudarConfig((c) => ({ ...c, estoque: { ...c.estoque, exigeArmazem: v } }))} />
        <CampoEnum rotulo="Saldo negativo" testId="top-campo-estoque-saldo" valor={rascunho.configuracao.estoque.saldoNegativo}
          opcoes={POLITICAS_SALDO_NEGATIVO} rotulos={ROTULOS_TOP.saldoNegativo}
          desabilitado={rascunho.configuracao.estoque.atualizacao === "nenhuma"}
          ajuda="O que fazer quando a operação levaria o saldo abaixo de zero."
          onChange={(v) => mudarConfig((c) => ({ ...c, estoque: { ...c.estoque, saldoNegativo: v } }))} />
        {rascunho.configuracao.estoque.atualizacao === "nenhuma" && <AvisoDeSecaoDesligada texto="Sem movimentação declarada, os demais campos de estoque ficam no estado neutro e não são gravados como exigência." />}
        <AvisoDeAutoridade efeito="estoque" modo={rascunho.configuracao.execucao.estoque} bloqueio={bloqueioDaSecao("estoque")} venda={ehMovimentoDeVendas(rascunho.codigoBase)} />
        {/* TOP-CONFIG-07: fora da configuração (coluna da versão) e fora do "desligado" da movimentação — por isso
            nunca é desabilitada por "Não movimenta estoque". */}
        {reservaOferecida && <div className="col-span-12 border-t border-slate-200 pt-3" data-testid="top-reserva-estoque-secao">
          {reservaIlegivel
            ? <p data-testid="top-reserva-estoque-ilegivel" className="text-[12px] text-amber-700">
                Este servidor não informou se esta versão reserva estoque. A opção fica bloqueada e nada sobre ela é
                enviado ao salvar, para não substituir um valor que não foi lido.
              </p>
            : <label className="flex items-start gap-2 text-[12.5px] text-slate-700">
                <input type="checkbox" data-testid="top-reserva-estoque" className="mt-0.5" aria-describedby={idDicaReserva}
                  checked={rascunho.reservaEstoque === true}
                  onChange={(e) => { const marcado = e.target.checked; mudar({ reservaEstoque: marcado }); }} />
                <span>
                  <span className="font-medium">Reservar estoque ao salvar o pedido</span>
                  <span id={idDicaReserva} className="mt-0.5 block text-[11.5px] leading-relaxed text-slate-500">
                    O pedido separa as quantidades no armazém de cada item. Outro documento não usa o que está reservado, e a venda gerada do pedido consome a reserva.
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-relaxed text-slate-500">
                    Vale para os pedidos lançados a partir da versão salva e não depende da movimentação nem da aba Execução.
                  </span>
                </span>
              </label>}
          <ErrosDeCampo erros={errosCampo} prefixos={[CAMINHO_ERRO_RESERVA_ESTOQUE]} />
        </div>}
      </Secao>}

      {aba === "financeiro" && liberado && <Secao chave="financeiro">
        <CampoEnum rotulo="Efeito financeiro" testId="top-campo-financeiro-atualizacao" valor={rascunho.configuracao.financeiro.atualizacao}
          opcoes={ATUALIZACOES_FINANCEIRO} rotulos={ROTULOS_TOP.financeiroAtualizacao}
          ajuda="O sentido do efeito declarado. Sem efeito, os demais campos desta seção não decidem nada."
          onChange={(v) => mudarConfig((c) => ({ ...c, financeiro: { ...c.financeiro, atualizacao: v } }))} />
        <CampoEnum rotulo="Forma do lançamento" testId="top-campo-financeiro-modo" valor={rascunho.configuracao.financeiro.modo}
          opcoes={MODOS_FINANCEIRO} rotulos={ROTULOS_TOP.financeiroModo}
          desabilitado={rascunho.configuracao.financeiro.atualizacao === "nenhuma"}
          ajuda="Título firme compõe o saldo realizado; previsão não."
          onChange={(v) => mudarConfig((c) => ({ ...c, financeiro: { ...c.financeiro, modo: v } }))} />
        <CampoEnum rotulo="Momento do efeito" testId="top-campo-financeiro-momento" valor={rascunho.configuracao.financeiro.momento}
          opcoes={MOMENTOS_EFEITO} rotulos={ROTULOS_TOP.momentoEfeito}
          desabilitado={rascunho.configuracao.financeiro.atualizacao === "nenhuma"}
          onChange={(v) => mudarConfig((c) => ({ ...c, financeiro: { ...c.financeiro, momento: v } }))} />
        <CampoSimNao rotulo="Exigir forma de pagamento" testId="top-campo-financeiro-forma" valor={rascunho.configuracao.financeiro.exigeFormaPagamento}
          desabilitado={rascunho.configuracao.financeiro.atualizacao === "nenhuma"}
          onChange={(v) => mudarConfig((c) => ({ ...c, financeiro: { ...c.financeiro, exigeFormaPagamento: v } }))} />
        <CampoSimNao rotulo="Exigir vencimento" testId="top-campo-financeiro-vencimento" valor={rascunho.configuracao.financeiro.exigeVencimento}
          desabilitado={rascunho.configuracao.financeiro.atualizacao === "nenhuma"}
          onChange={(v) => mudarConfig((c) => ({ ...c, financeiro: { ...c.financeiro, exigeVencimento: v } }))} />
        <CampoSimNao rotulo="Exigir centro de resultado" testId="top-campo-financeiro-centro" valor={rascunho.configuracao.financeiro.exigeCentroResultado}
          desabilitado={rascunho.configuracao.financeiro.atualizacao === "nenhuma"}
          onChange={(v) => mudarConfig((c) => ({ ...c, financeiro: { ...c.financeiro, exigeCentroResultado: v } }))} />
        {comRestricoes && <>
          {/* INDEPENDE do efeito financeiro (decisão 263): por isso não é desabilitado com "nenhuma".
              COMPRAS-01: só nos movimentos de vendas — fora deles o valor fica o que está ("não valida"). */}
          {ehMovimentoDeVendas(rascunho.codigoBase) && <><CampoEnum rotulo="Cliente em atraso" testId="top-financeiro-cliente-em-atraso" valor={comRestricoes.financeiro.clienteEmAtraso}
            opcoes={POLITICAS_CLIENTE_EM_ATRASO} rotulos={ROTULOS_TOP.clienteEmAtraso}
            ajuda="O que fazer quando o cliente tem título vencido ao lançar um documento desta operação."
            onChange={(v) => mudarConfigV3((c) => ({ ...c, financeiro: { ...c.financeiro, clienteEmAtraso: v } }))} />
          <Field label="Tolerância (dias)" span={4}
            help="Dias de atraso tolerados antes de o título contar como vencido para esta regra.">
            <Input data-testid="top-financeiro-tolerancia-atraso" type="number" inputMode="numeric"
              min={0} max={TOLERANCIA_ATRASO_MAXIMA_DIAS} step={1}
              value={String(comRestricoes.financeiro.toleranciaAtrasoDias)}
              disabled={comRestricoes.financeiro.clienteEmAtraso === "nao_valida"}
              onChange={(e) => {
                // Vazio vira 0; fora do intervalo NÃO é corrigido em silêncio — a conferência antes de salvar recusa.
                const n = e.target.value.trim() === "" ? 0 : Number(e.target.value);
                mudarConfigV3((c) => ({ ...c, financeiro: { ...c.financeiro, toleranciaAtrasoDias: Number.isFinite(n) ? n : 0 } }));
              }} />
          </Field></>}
          <div className="col-span-12">
            <CondicoesPermitidasTop
              valor={rascunho.condicoesPermitidas ?? []}
              limite={LIMITE_CONDICOES_PERMITIDAS}
              desabilitado={condicoesIlegiveis}
              // MEXER NA LISTA É DECLARAR — a mesma régua dos destinos.
              onChange={(v) => mudar({ condicoesPermitidas: v, condicoesDeclaradas: true })}
            />
          </div>
        </>}
        <ErrosDeCampo erros={errosCampo} prefixos={["financeiro", "condicoesPermitidas"]} />
        {rascunho.configuracao.financeiro.atualizacao === "nenhuma" && <AvisoDeSecaoDesligada texto="Sem efeito financeiro declarado, os demais campos desta seção ficam no estado neutro e não são gravados como exigência." />}
        <AvisoDeAutoridade efeito="financeiro" modo={rascunho.configuracao.execucao.financeiro} bloqueio={bloqueioDaSecao("financeiro")} venda={ehMovimentoDeVendas(rascunho.codigoBase)} />
      </Secao>}

      {aba === "fiscal" && liberado && <Secao chave="fiscal">
        <CampoSimNao rotulo="Relevante para o fiscal" testId="top-campo-fiscal-habilitado" valor={rascunho.configuracao.fiscal.habilitado}
          ajuda="Desligado, os demais campos desta seção não decidem nada."
          onChange={(v) => mudarConfig((c) => ({ ...c, fiscal: { ...c.fiscal, habilitado: v } }))} />
        <CampoSimNao rotulo="Exigir documento fiscal" testId="top-campo-fiscal-documento" valor={rascunho.configuracao.fiscal.exigeDocumentoFiscal}
          desabilitado={!rascunho.configuracao.fiscal.habilitado}
          onChange={(v) => mudarConfig((c) => ({ ...c, fiscal: { ...c.fiscal, exigeDocumentoFiscal: v } }))} />
        <CampoSimNao rotulo="Exigir natureza da operação" testId="top-campo-fiscal-natureza" valor={rascunho.configuracao.fiscal.exigeNaturezaOperacao}
          desabilitado={!rascunho.configuracao.fiscal.habilitado}
          onChange={(v) => mudarConfig((c) => ({ ...c, fiscal: { ...c.fiscal, exigeNaturezaOperacao: v } }))} />
        <CampoSimNao rotulo="Exigir regra tributária" testId="top-campo-fiscal-regra" valor={rascunho.configuracao.fiscal.exigeRegraTributaria}
          desabilitado={!rascunho.configuracao.fiscal.habilitado}
          onChange={(v) => mudarConfig((c) => ({ ...c, fiscal: { ...c.fiscal, exigeRegraTributaria: v } }))} />
        <CampoEnum rotulo="Cálculo de tributos" testId="top-campo-fiscal-calculo" valor={rascunho.configuracao.fiscal.calculoTributario}
          opcoes={CALCULOS_TRIBUTARIOS} rotulos={ROTULOS_TOP.calculoTributario}
          desabilitado={!rascunho.configuracao.fiscal.habilitado}
          ajuda="Declara a intenção. Nenhum tributo é calculado por esta configuração."
          onChange={(v) => mudarConfig((c) => ({ ...c, fiscal: { ...c.fiscal, calculoTributario: v } }))} />
        {/* Só com o fiscal ligado: desligado, a normalização do domínio zera também as chaves novas. */}
        {comRestricoes && comRestricoes.fiscal.habilitado && <div className="col-span-12">
          <FiscalFormato3
            fiscal={comRestricoes.fiscal}
            familia={rascunho.codigoBase}
            erros={errosCampo}
            onChange={(f) => mudarConfigV3((c) => ({ ...c, fiscal: f }))}
          />
        </div>}
        {!rascunho.configuracao.fiscal.habilitado && <AvisoDeSecaoDesligada texto="Com o fiscal desligado, os demais campos desta seção ficam no estado neutro e não são gravados como exigência." />}
      </Secao>}

      {aba === "aprovacao" && liberado && <Secao chave="aprovacao" ajuda={regrasDaFamilia ? AJUDA_COM_REGRAS_GERAIS.aprovacao : undefined}>
        <CampoEnum rotulo="Critério de aprovação" testId="top-campo-aprovacao-politica" valor={rascunho.configuracao.aprovacao.politica}
          opcoes={POLITICAS_APROVACAO} rotulos={ROTULOS_TOP.aprovacaoPolitica}
          ajuda="Quando o documento precisa passar por aprovação."
          {...pelaFamilia(POLITICAS_APROVACAO, regrasDaFamilia?.aprovacao, "aprovacao")}
          onChange={(v) => mudarConfig((c) => ({
            ...c,
            // Ao passar para "a partir de um valor", o campo nasce vazio e obrigatório: herdar um valor
            // antigo faria a regra entrar em vigor com um limite que ninguém confirmou nesta edição.
            aprovacao: { ...c.aprovacao, politica: v, valorMinimo: v === "por_valor" ? (c.aprovacao.valorMinimo ?? "") : null }
          }))} />
        <Field label="Valor mínimo" required={porValor} span={4}
          help="Valor a partir do qual a aprovação passa a ser exigida. Use ponto como separador decimal."
          error={porValor && valorMinimo.length > 0 && !valorMinimoAceitavel(valorMinimo) ? "Informe um valor maior que zero, com até duas casas decimais." : undefined}>
          <Input data-testid="top-campo-aprovacao-valor" inputMode="decimal" placeholder="0.00"
            value={valorMinimo} disabled={!porValor}
            onChange={(e) => mudarConfig((c) => ({ ...c, aprovacao: { ...c.aprovacao, valorMinimo: e.target.value } }))} />
        </Field>
        <CampoEnum rotulo="Momento da aprovação" testId="top-campo-aprovacao-momento" valor={rascunho.configuracao.aprovacao.momento}
          opcoes={MOMENTOS_APROVACAO} rotulos={ROTULOS_TOP.momentoAprovacao}
          desabilitado={rascunho.configuracao.aprovacao.politica === "nenhuma"}
          onChange={(v) => mudarConfig((c) => ({ ...c, aprovacao: { ...c.aprovacao, momento: v } }))} />
        {rascunho.configuracao.aprovacao.politica === "nenhuma" && <AvisoDeSecaoDesligada texto="Sem critério de aprovação, o valor mínimo fica zerado e não é gravado." />}
        {/* TOP-CONFIG-08: o 422 em `aprovacao.*` (a matriz da família, no servidor) abre esta aba e aparece aqui. */}
        <ErrosDeCampo erros={errosCampo} prefixos={["aprovacao"]} />
      </Secao>}

      {aba === "execucao" && liberado && <Secao chave="execucao">
        <div className="col-span-12">
          <AbaExecucao
            execucao={execucao}
            codigoBase={rascunho.codigoBase}
            configuracao={rascunho.configuracao}
            salva={edicao ? inicial.configuracao : null}
            recusas={recusasExecucao}
            ativacaoSemRuntime={ativacaoSemRuntime}
            regrasGerais={!!regrasDaFamilia}
            onChange={(efeito, modo) => mudarConfig((c) => ({ ...c, execucao: { ...c.execucao, [efeito]: modo } }))}
          />
        </div>
      </Secao>}

      {conflito && <p data-testid="top-conflito" className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
        Este tipo de operação foi alterado por outra pessoa enquanto você editava. Nada foi gravado, para
        não apagar o trabalho de ninguém. Feche esta janela, abra o registro de novo e refaça as alterações
        sobre a versão atual.
      </p>}
      {erro ? <div className="mt-3"><ErrorState error={erro} /></div> : null}

      <AvisoDeVersionamento regrasGerais={!!regrasDaFamilia} />
    </Dialog>

    <Dialog
      open={!!perguntas?.exigencias}
      onOpenChange={(o) => { if (!o) setPerguntas(null); }}
      testId="top-exigencias-passam-a-valer"
      title="Estas exigências passam a valer"
      footer={<>
        <Button variant="outline" data-testid="top-exigencias-voltar" onClick={() => setPerguntas(null)}>Voltar e revisar</Button>
        <Button data-testid="top-exigencias-salvar" onClick={depoisDasExigencias}>Salvar assim mesmo</Button>
      </>}
    >
      <p className="text-sm text-slate-600">
        A partir desta versão, o lançamento vai exigir: {(perguntas?.exigencias ?? []).join(", ")}. Até hoje essas marcas
        estavam só registradas e não eram cobradas.
      </p>
    </Dialog>

    {/* TOP-CONFIG-08 — o gêmeo do diálogo das exigências, com o mesmo componente e os mesmos botões. Abre DEPOIS
        dele quando os dois valem; "Salvar assim mesmo" grava o formato 4 com as regras da família já no padrão. */}
    <Dialog
      open={!!perguntas && !perguntas.exigencias && !!perguntas.regras}
      onOpenChange={(o) => { if (!o) setPerguntas(null); }}
      testId="top-regras-passam-a-valer"
      title="Estas regras passam a valer"
      footer={<>
        <Button variant="outline" data-testid="top-regras-voltar" onClick={() => setPerguntas(null)}>Voltar e revisar</Button>
        <Button data-testid="top-regras-salvar" onClick={() => { setPerguntas(null); salvar.mutate(); }}>Salvar assim mesmo</Button>
      </>}
    >
      {perguntas?.regras ? <ListaDasRegrasQuePassamAValer regras={perguntas.regras} /> : null}
    </Dialog>

    <ConfirmDialog
      open={confirmandoDescarte}
      onOpenChange={setConfirmandoDescarte}
      title="Descartar alterações"
      confirmLabel="Descartar"
      danger
      onConfirm={() => { setConfirmandoDescarte(false); onFechar(); }}
    >
      <p data-testid="top-descartar-confirmacao" className="text-sm text-slate-600">
        Há alterações que ainda não foram salvas neste tipo de operação. Ao fechar, elas são perdidas e
        nenhuma versão nova é criada.
      </p>
    </ConfirmDialog>
  </>;
}

/**
 * Os campos de restrições do rascunho (TOP-CONFIG-05), ou nenhum. Sem restrições devolve `{}` — o rascunho
 * fica EXATAMENTE o de hoje (sem `configuracaoV3`, sem condições), e a assinatura também.
 *
 * TOP-CONFIG-08: com o bloco `regrasGerais`, o rascunho carrega `configuracaoV4` NO LUGAR de `configuracaoV3` (uma
 * verdade só: a vigente no 1, 2 ou 3 é LIDA como 4, e a no 4 continua 4). Ler não regrava nada — a versão gravada
 * fica no formato dela até alguém salvar.
 */
function camposDeRestricoes(
  restricoes: boolean,
  regrasGerais: boolean,
  detalhe: ReturnType<typeof lerDetalheTop>
): Partial<RascunhoTop> {
  if (!restricoes) return {};
  const lidas = detalhe?.condicoesPermitidas ?? null;
  const condicoes = {
    condicoesPermitidas: lidas ?? [],
    // Nasce NÃO declarada: lista intocada não vai no corpo (régua em `RascunhoTop.condicoesDeclaradas`).
    condicoesDeclaradas: false
  };
  if (regrasGerais) {
    const v4 = configuracaoInicialV4(detalhe?.configuracao ?? null);
    return { configuracaoV4: v4, configuracao: configuracaoTopParaEdicao(v4), ...condicoes };
  }
  const v3 = configuracaoInicialV3(detalhe?.configuracao ?? null);
  return { configuracaoV3: v3, configuracao: configuracaoTopParaEdicao(v3), ...condicoes };
}

/**
 * A aba onde mora o campo de um caminho de erro. TOP-CONFIG-08: `aprovacao.*` abre a Aprovação (antes, uma 422 em
 * `aprovacao.politica` — a matriz da família — abria a Identificação, onde o campo não está).
 */
function abaDoCaminho(caminho: string): ChaveAba {
  if (caminho === CAMINHO_ERRO_RESERVA_ESTOQUE) return "estoque";
  if (caminho.startsWith("fiscal.")) return "fiscal";
  if (caminho.startsWith("financeiro.") || caminho === "condicoesPermitidas" || caminho.startsWith("condicoesPermitidas.")) return "financeiro";
  if (caminho.startsWith("geral.")) return "geral";
  if (caminho.startsWith("aprovacao.")) return "aprovacao";
  return "identificacao";
}

// ---------------------------------------------------------------------------------------------------
// As perguntas antes de gravar (TOP-CONFIG-05_R1 e TOP-CONFIG-08)
// ---------------------------------------------------------------------------------------------------

/**
 * O que a gravação no formato 4 muda na EXECUÇÃO, montado pelo domínio: as regras que passam a executar
 * (`regrasGeraisQuePassamAValer`) e as que voltam ao padrão porque a família não as executa (`voltaram`).
 */
interface RegrasQuePassamAValer { passam: string[]; voltaram: RegraGeralQueVoltaTop[] }

/**
 * AS PERGUNTAS, EM FILA: primeiro "Estas exigências passam a valer" (TOP-CONFIG-05_R1), depois "Estas regras passam
 * a valer" (TOP-CONFIG-08). `null` em uma delas = essa não tem o que perguntar. "Voltar e revisar" em qualquer uma
 * desfaz a fila inteira: nada é gravado sem o administrador ter visto TUDO o que muda.
 */
interface PerguntasAntesDeGravar { exigencias: string[] | null; regras: RegrasQuePassamAValer | null }

/**
 * "Confirmação: Automática → Manual" — cada regra que volta ao padrão, com o nome do campo do editor e os rótulos
 * de `ROTULOS_TOP` (a tradução de hoje; valor técnico nunca aparece). A união discriminada do domínio liga cada
 * caminho ao SEU enum, então um rótulo trocado de lugar não compila.
 */
function rotuloDaRegraQueVolta(v: RegraGeralQueVoltaTop): string {
  switch (v.caminho) {
    case "geral.confirmacao":
      return `Confirmação: ${ROTULOS_TOP.confirmacao[v.de]} → ${ROTULOS_TOP.confirmacao[v.para]}`;
    case "geral.documentoSemItens":
      return `Documento sem itens: ${ROTULOS_TOP.documentoSemItens[v.de]} → ${ROTULOS_TOP.documentoSemItens[v.para]}`;
    case "geral.alteracaoAposConfirmacao":
      return `Alteração após confirmar: ${ROTULOS_TOP.alteracao[v.de]} → ${ROTULOS_TOP.alteracao[v.para]}`;
    case "aprovacao.politica":
      return `Aprovação: ${ROTULOS_TOP.aprovacaoPolitica[v.de]} → ${ROTULOS_TOP.aprovacaoPolitica[v.para]}`;
  }
}

/**
 * O CORPO DO DIÁLOGO "Estas regras passam a valer": o que passa a executar (os textos do domínio, como vieram) e,
 * quando houver, o que volta ao padrão. Cada item com o seu `data-testid`, para o teste ler item por item.
 */
const ListaDasRegrasQuePassamAValer = ({ regras }: { regras: RegrasQuePassamAValer }) => <div className="space-y-2 text-sm text-slate-600">
  {regras.passam.length > 0 && <ul className="list-disc pl-5">
    {regras.passam.map((t) => <li key={t} data-testid="top-regra-passa-a-valer">{t}</li>)}
  </ul>}
  {regras.voltaram.length > 0 && <>
    <p>Estas opções voltam ao padrão, porque esta operação não as executa:</p>
    <ul className="list-disc pl-5">
      {regras.voltaram.map((v) => <li key={v.caminho} data-testid="top-regra-volta-ao-padrao" data-caminho={v.caminho}>{rotuloDaRegraQueVolta(v)}</li>)}
    </ul>
  </>}
</div>;

/** Erros de campo das seções Geral/Financeiro (o Fiscal os recebe em `FiscalFormato3`). */
const ErrosDeCampo = ({ erros, prefixos }: { erros: Readonly<Record<string, string>>; prefixos: readonly string[] }) => <>
  {Object.entries(erros)
    .filter(([caminho]) => prefixos.some((p) => caminho === p || caminho.startsWith(`${p}.`)))
    .map(([caminho, mensagem]) => <p key={caminho} data-testid={`top-erro-${caminho}`} className="col-span-12 text-[11.5px] text-red-700">{mensagem}</p>)}
</>;

const AvisoDeSecaoDesligada = ({ texto }: { texto: string }) => <p className="col-span-12 text-[11.5px] text-slate-500">{texto}</p>;

/**
 * Quem decide ESTA seção no rascunho: a frase muda com a aba Execução, para ninguém ler uma pela outra.
 *
 * "É executado" só é dito quando é verdade. Uma combinação sem executor (a matriz a recusa) e um ambiente
 * com a execução desligada têm cada um a sua frase AQUI, na aba em que o administrador está mexendo — o
 * motivo detalhado continua na aba Execução, mas esta aba nunca afirma o contrário dele.
 */
type BloqueioDaSecao = "combinacao_recusada" | "execucao_desligada" | null;
const AvisoDeAutoridade = ({ efeito, modo, bloqueio, venda }: { efeito: EfeitoExecucaoTop; modo: ModoExecucaoTop; bloqueio: BloqueioDaSecao; /** o movimento é de vendas (texto de vendas igual ao de antes) */ venda: boolean }) =>
  <p data-testid={`top-secao-autoridade-${efeito}`} data-modo={modo} data-bloqueio={modo === "configurada" ? bloqueio ?? "" : ""}
    className={`col-span-12 text-[11.5px] ${modo === "configurada" && bloqueio ? "text-amber-800" : "text-slate-500"}`}>
    {modo !== "configurada"
      ? "Este efeito segue o comportamento legado do produto: o que está nesta seção fica registrado, mas não é executado."
      : bloqueio === "combinacao_recusada"
        ? "A aba Execução entrega este efeito à configuração da TOP, mas esta combinação não tem execução e não pode ser salva; o motivo está na aba Execução."
        : bloqueio === "execucao_desligada"
          ? `A aba Execução entrega este efeito à configuração da TOP, mas este ambiente ainda não a executa: a confirmação ${venda ? "de vendas" : "de documentos"} desta versão é recusada até a execução ser habilitada.`
          : `A aba Execução entrega este efeito à configuração da TOP: o que está nesta seção é executado na confirmação ${venda ? "da venda" : "do documento"}.`}
  </p>;

// ---------------------------------------------------------------------------------------------------
// Execução (TOP-CONFIG-04A)
// ---------------------------------------------------------------------------------------------------

const ROTULO_EFEITO: Record<EfeitoExecucaoTop, string> = { estoque: "Estoque", financeiro: "Financeiro" };

/**
 * A ÁREA DE EXECUÇÃO — o que é executável, e por que o resto não é.
 *
 * Cada causa de bloqueio tem a SUA frase e o seu identificador, porque cada uma pede uma ação diferente de
 * quem lê: servidor sem o recurso (esperar a atualização), família sem consumidor (nada a fazer nesta
 * família), gate desligado (esperar a segunda fase da implantação), combinação sem executor (mudar a seção)
 * e versão já configurada num ambiente que não a executa (as vendas dela serão recusadas até ligar, ou
 * voltar ao legado). Uma mensagem genérica esconderia qual delas é.
 */
function AbaExecucao({ execucao, codigoBase, configuracao, salva, recusas, ativacaoSemRuntime, regrasGerais, onChange }: {
  execucao: CapacidadesExecucaoTop;
  codigoBase: string;
  configuracao: ConfiguracaoTipoOperacaoV2;
  /** A configuração da versão GRAVADA (formato 2 para edição), ou `null` na criação. */
  salva: ConfiguracaoTipoOperacaoV2 | null;
  recusas: RecusaExecucaoTop[];
  ativacaoSemRuntime: EfeitoExecucaoTop[];
  /** TOP-CONFIG-08: o editor grava o formato 4 (bloco `regrasGerais`)? Muda só a frase do que continua declarado. */
  regrasGerais: boolean;
  onChange: (efeito: EfeitoExecucaoTop, modo: ModoExecucaoTop) => void;
}) {
  if (!execucao.suportado) {
    return <p data-testid="top-execucao-nao-suportado" className="text-[12px] text-amber-700">
      Este servidor ainda não oferece execução configurada. Estoque e financeiro seguem o comportamento
      legado, e nada desta seção é enviado ao salvar; as demais seções continuam funcionando.
    </p>;
  }
  if (!codigoBase) {
    return <p className="text-[12px] text-slate-500">Escolha o movimento na aba de identificação para ver o que ele pode executar.</p>;
  }

  const familiaAceita = familiaAceitaExecucaoConfiguradaTop(codigoBase, execucao.matriz);
  const salvaConfigurada = !!salva && (salva.execucao.estoque === "configurada" || salva.execucao.financeiro === "configurada");
  const declarado: Record<EfeitoExecucaoTop, string> = {
    estoque: ROTULOS_TOP.estoqueAtualizacao[configuracao.estoque.atualizacao],
    financeiro: ROTULOS_TOP.financeiroAtualizacao[configuracao.financeiro.atualizacao]
  };

  return <div data-testid="top-execucao" className="space-y-3">
    {!familiaAceita && <p data-testid="top-execucao-familia-nao-suportada" className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-700">
      {MENSAGEM_FAMILIA_SEM_EXECUCAO_TOP} Estoque e financeiro desta operação seguem o comportamento legado do produto.
    </p>}
    {familiaAceita && !execucao.runtimeHabilitado && <p data-testid="top-execucao-runtime-desligado" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
      A execução configurada ainda não está habilitada neste ambiente. Você pode manter ou voltar ao
      comportamento legado; ativar a configuração da TOP fica disponível quando a implantação for concluída.
    </p>}
    {salvaConfigurada && !execucao.runtimeHabilitado && <p data-testid="top-execucao-configurada-sem-execucao" className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
      A versão salva desta operação usa a configuração da TOP, mas este ambiente ainda não a executa: a
      confirmação {ehMovimentoDeVendas(codigoBase) ? "de vendas criadas" : "de documentos criados"} sob essa versão é recusada até a execução ser habilitada. Voltar ao
      comportamento legado continua possível.
    </p>}

    <div className="grid grid-cols-12 gap-3">
      {(["estoque", "financeiro"] as const).map((efeito) => {
        const atual = configuracao.execucao[efeito];
        // Voltar ao valor SALVO não é ativação (o servidor aceita: `efeitosAtivadosTop` só conta o que passa a
        // ser configurado, ou o configurado cuja seção mudou — e esse caso tem a sua frase logo abaixo).
        const salvaNesteEfeito = salva?.execucao[efeito] === "configurada";
        const configuradaIndisponivel = (!familiaAceita || !execucao.runtimeHabilitado) && !salvaNesteEfeito;
        return <React.Fragment key={efeito}>
          <CampoEnum rotulo={ROTULO_EFEITO[efeito]} testId={`top-campo-execucao-${efeito}`} span={6}
            valor={atual} opcoes={MODOS_EXECUCAO_TOP} rotulos={ENUM_LABELS.top_execucao}
            desabilitado={!familiaAceita && atual === "legado"}
            opcoesDesabilitadas={configuradaIndisponivel ? ["configurada"] : []}
            onChange={(v) => onChange(efeito, v)} />
          <p data-testid={`top-execucao-declara-${efeito}`} className="col-span-6 self-end pb-2 text-[12px] text-slate-600">
            <span className="text-slate-400">A seção {ROTULO_EFEITO[efeito]} declara: </span>{declarado[efeito]}
          </p>
        </React.Fragment>;
      })}
    </div>

    {recusas.length > 0 && <div data-testid="top-execucao-recusas" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
      <p className="font-medium">Esta combinação ainda não pode ser executada, e por isso não pode ser salva:</p>
      <ul className="mt-1 list-disc pl-5">
        {recusas.map((r) => <li key={r.caminho} data-testid="top-execucao-recusa" data-caminho={r.caminho}>{r.mensagem}</li>)}
      </ul>
    </div>}
    {recusas.length === 0 && ativacaoSemRuntime.length > 0 && <div data-testid="top-execucao-ativacao-bloqueada" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
      <p>Com a execução configurada desligada neste ambiente, esta alteração não pode ser salva:</p>
      <ul className="mt-1 list-disc pl-5">
        {ativacaoSemRuntime.map((e) => <li key={e} data-testid="top-execucao-ativacao-motivo" data-efeito={e}
          data-causa={salva?.execucao[e] === "configurada" ? "secao_alterada" : "ativacao"}>
          {salva?.execucao[e] === "configurada"
            ? `${ROTULO_EFEITO[e]} já segue a configuração da TOP, e mudar a seção ${ROTULO_EFEITO[e]} mudaria o que é executado. Desfaça a mudança nessa seção, ou volte ${ROTULO_EFEITO[e]} ao comportamento legado.`
            : `${ROTULO_EFEITO[e]} passaria a seguir a configuração da TOP. Mantenha ${ROTULO_EFEITO[e]} no comportamento legado.`}
        </li>)}
      </ul>
    </div>}

    <p data-testid="top-execucao-versao-congelada" className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-600">
      A escolha vale para os documentos criados a partir da versão que esta gravação cria. Documentos já
      lançados continuam seguindo a versão que registraram, e o cancelamento estorna apenas o que de fato
      aconteceu na confirmação.
    </p>
    {/* TOP-CONFIG-08: no formato 4 a aprovação, a confirmação automática e as exigências executam, e a alteração após
        confirmar só aceita "Bloqueada" — sobra o fiscal. Sem o bloco, o texto de hoje, letra por letra. */}
    <p data-testid="top-execucao-declarativo" className="text-[11.5px] leading-relaxed text-slate-500">
      {regrasGerais
        ? "Preparado, ainda não executado: o fiscal. Ele fica registrado nesta versão, mas nada o executa nesta etapa do produto."
        : <>
          Preparadas, ainda não executadas: fiscal, aprovação, confirmação automática e alteração após confirmar.
          Elas ficam registradas nesta versão, mas nada as executa nesta etapa do produto. As exigências da aba Geral
          só são cobradas no lançamento em versões gravadas com as restrições da operação.
        </>}
    </p>
  </div>;
}

/** Por que as seções de operação estão bloqueadas. Cada causa tem a sua frase — nunca uma genérica. */
function BloqueioDeConfiguracao({ estado, ilegivel }: { estado: EstadoCapacidadesTop; ilegivel: boolean }) {
  if (estado.situacao === "carregando") return <LoadingState variant="compact" />;
  if (ilegivel && estado.situacao === "pronto") {
    return <p data-testid="top-config-ilegivel" className="text-[12px] text-amber-700">
      A versão atual deste tipo de operação foi gravada em um formato que esta tela não sabe interpretar.
      As seções de operação estão bloqueadas para não substituir a regra existente por valores que não
      foram lidos. O nome, a situação e a descrição continuam editáveis na aba de identificação.
    </p>;
  }
  return <MensagemCapacidadesTop estado={estado} />;
}

// ---------------------------------------------------------------------------------------------------
// Próximas operações
// ---------------------------------------------------------------------------------------------------

/**
 * O grafo de destinos desta versão.
 *
 * A LISTA DE OPÇÕES VEM DO SERVIDOR, sempre. Ele já recorta por tenant, situação, exclusão e compatibilidade
 * de família; refazer esse recorte aqui seria uma segunda cópia das regras do grafo, que envelheceria em
 * silêncio na primeira família nova — e uma tela que decide compatibilidade vira autoridade de coisa que
 * não é dela.
 *
 * ┌─ DOIS ESTADOS QUE A LISTA VAZIA NÃO DISTINGUE (correção R1) ───────────────────────────────────────┐
 * │ "Nenhum destino" é a mesma tela para duas realidades OPOSTAS:                                      │
 * │                                                                                                     │
 * │   POLÍTICA NÃO DECLARADA  ninguém respondeu à pergunta. A conversão segue o caminho anterior do     │
 * │                           produto, e é isso que o operador vê acontecer no documento.               │
 * │   POLÍTICA DECLARADA VAZIA alguém respondeu "esta operação não gera nada". A conversão é recusada.  │
 * │                                                                                                     │
 * │ São frases diferentes porque quem lê precisa decidir coisas diferentes: no primeiro caso falta      │
 * │ configurar; no segundo, está configurado. Uma frase só para os dois faria o administrador "corrigir"│
 * │ uma decisão que já estava certa — ou deixar sem política uma operação que ele achou configurada.    │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
function AbaDestinos({ codigoBase, destinos, limite, habilitado, emPartesConfiguravel, ilegivel, declarado, estadoNoServidor, onChange, onDeclarar }: {
  codigoBase: string;
  destinos: DestinoEmEdicao[];
  /** A API aceita `emPartes` (capabilities.destinos.emPartes === 1)? Sem isso, a caixa não aparece. */
  emPartesConfiguravel: boolean;
  limite: number;
  habilitado: boolean;
  /** O servidor sustenta destinos, mas o detalhe não trouxe a lista de forma legível: bloqueia. */
  ilegivel: boolean;
  /** Este RASCUNHO declara a política? É o que decide se `destinos` vai no corpo da gravação. */
  declarado: boolean;
  /** O que a versão GRAVADA diz: `true`/`false` declarados pelo servidor, `null` quando ele não informou. */
  estadoNoServidor: boolean | null;
  onChange: (d: DestinoEmEdicao[]) => void;
  onDeclarar: () => void;
}) {
  const { itens, carregando, erro } = useDestinosPossiveis(codigoBase, habilitado && !ilegivel);
  const [escolhido, setEscolhido] = React.useState("");

  if (!habilitado) {
    return <p data-testid="top-destinos-nao-suportado" className="text-[12px] text-amber-700">
      Este servidor não confirmou o recurso de próximas operações. A seção está bloqueada e nenhuma
      alteração de encadeamento é enviada ao salvar; as demais seções continuam funcionando.
    </p>;
  }
  if (ilegivel) {
    return <p data-testid="top-destinos-ilegiveis" className="text-[12px] text-amber-700">
      Este servidor não devolveu as próximas operações desta versão em um formato que esta tela reconhece.
      A seção está bloqueada e nada de encadeamento é enviado ao salvar, para não apagar caminhos que não
      chegaram a ser lidos. As demais seções continuam funcionando.
    </p>;
  }
  if (!codigoBase) {
    return <p className="text-[12px] text-slate-500">Escolha o movimento na aba de identificação para ver os destinos possíveis.</p>;
  }
  if (carregando) return <LoadingState variant="compact" />;
  if (erro) return <ErrorState error={erro} />;
  if (itens === null) {
    return <p data-testid="top-destinos-nao-confirmado" className="text-[12px] text-amber-700">
      Este servidor respondeu a lista de destinos em um formato que esta tela não reconhece. A seção está
      bloqueada para não gravar um encadeamento que não foi lido.
    </p>;
  }

  const jaEscolhidos = new Set(destinos.map((d) => d.tipoOperacaoId));
  const disponiveis = itens.filter((i) => !jaEscolhidos.has(i.id));
  const noLimite = destinos.length >= limite;

  const adicionar = () => {
    const alvo = itens.find((i) => i.id === escolhido);
    if (!alvo || jaEscolhidos.has(alvo.id) || noLimite) return;
    onChange([...destinos, { tipoOperacaoId: alvo.id, codigo: alvo.codigo, nome: alvo.nome, familiaRotulo: alvo.familiaRotulo, emPartes: false }]);
    setEscolhido("");
  };
  const remover = (idAlvo: string) => onChange(destinos.filter((d) => d.tipoOperacaoId !== idAlvo));
  const mover = (i: number, passo: number) => {
    const j = i + passo;
    if (j < 0 || j >= destinos.length) return;
    const copia = [...destinos];
    const [item] = copia.splice(i, 1);
    if (item) copia.splice(j, 0, item);
    onChange(copia);
  };

  return <div data-testid="top-destinos">
    <EstadoDaPolitica declarado={declarado} estadoNoServidor={estadoNoServidor} vazio={destinos.length === 0} onDeclarar={onDeclarar} comPonte={ehMovimentoDeVendas(codigoBase)} />

    <div className="mb-3 flex flex-wrap items-center gap-2">
      <NativeSelect aria-label="Operação de destino" className="w-80" data-testid="top-destino-escolha"
        value={escolhido} disabled={disponiveis.length === 0 || noLimite} onChange={(e) => setEscolhido(e.target.value)}>
        <option value="">Selecione…</option>
        {disponiveis.map((i) => <option key={i.id} value={i.id}>{i.codigo} — {i.nome} ({i.familiaRotulo})</option>)}
      </NativeSelect>
      <Button size="sm" variant="outline" data-testid="top-destino-adicionar" disabled={!escolhido || noLimite} onClick={adicionar}>
        Adicionar destino
      </Button>
      <span className="text-[11px] text-slate-500">{destinos.length} de {limite}</span>
    </div>

    {/* A LISTA SÓ APARECE QUANDO EXISTE. O que "nenhum destino" significa é decidido acima, por
        `EstadoDaPolitica` — e não por esta ausência de linhas, que é igual nos dois estados. */}
    {destinos.length > 0
      && <ul className="divide-y rounded border">
          {destinos.map((d, i) => <li key={d.tipoOperacaoId} data-testid="top-destino-linha" className="flex items-center gap-2 px-2 py-1.5 text-[12.5px]">
            <span className="w-6 text-right tabular-nums text-slate-400">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{d.codigo} — {d.nome}</span>
              <span className="ml-2 text-[11px] text-slate-400">{d.familiaRotulo}</span>
            </span>
            {d.disponivel === false && <Badge tone="amber">Indisponível hoje</Badge>}
            {emPartesConfiguravel && <label className="flex items-center gap-1.5 text-[12px] text-slate-700" title="O documento pode ser convertido várias vezes, escolhendo itens e quantidades.">
              <input type="checkbox" data-testid={`top-destino-${d.tipoOperacaoId}-em-partes`} checked={d.emPartes}
                onChange={(e) => onChange(destinos.map((x) => x.tipoOperacaoId === d.tipoOperacaoId ? { ...x, emPartes: e.target.checked } : x))} />
              Em partes
            </label>}
            <Button size="sm" variant="ghost" aria-label="Subir" disabled={i === 0} onClick={() => mover(i, -1)}>↑</Button>
            <Button size="sm" variant="ghost" aria-label="Descer" disabled={i === destinos.length - 1} onClick={() => mover(i, 1)}>↓</Button>
            <Button size="sm" variant="ghost" data-testid="top-destino-remover" aria-label={COPY.remover} onClick={() => remover(d.tipoOperacaoId)}>✕</Button>
          </li>)}
        </ul>}

    <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500">
      Um destino marcado como indisponível continua gravado nesta versão, mas o produto não o oferece hoje —
      normalmente porque o tipo de operação de destino foi desativado. Habilitar um destino aqui não dá
      permissão a ninguém: quem pode criar o documento seguinte continua sendo decidido pelas permissões.
    </p>
    {emPartesConfiguravel && <p data-testid="top-destinos-em-partes-dica" className="mt-1 text-[11.5px] leading-relaxed text-slate-500">
      Em partes: o documento pode ser convertido várias vezes, escolhendo itens e quantidades.
    </p>}
  </div>;
}

/**
 * O ESTADO DA POLÍTICA, DITO COM TODAS AS LETRAS — nunca deduzido do tamanho da lista.
 *
 * Três saídas, e a terceira é o silêncio: com política declarada E destinos na tela, a própria lista já
 * responde a pergunta e uma frase extra seria ruído. As duas primeiras existem justamente porque a lista
 * vazia não responde nada sozinha.
 */
function EstadoDaPolitica({ declarado, estadoNoServidor, vazio, onDeclarar, comPonte }: {
  declarado: boolean;
  estadoNoServidor: boolean | null;
  vazio: boolean;
  onDeclarar: () => void;
  /**
   * COMPRAS-02 (decisão 268): a ponte para o caminho anterior só existe em VENDAS (havia acervo convertendo por
   * ela). Em compras não há ponte — o pedido cuja TOP não declarou política não tem próximo passo —, e dizer ao
   * administrador que "continua pelo caminho anterior" seria descrever um comportamento que o servidor não tem.
   */
  comPonte: boolean;
}) {
  // O SERVIDOR NÃO DISSE, ENTÃO A TELA NÃO AFIRMA. Dizer "ainda não declarou" aqui seria inventar uma
  // resposta em nome de quem não respondeu — o mesmo defeito, do lado do cliente.
  if (!declarado && estadoNoServidor === null) {
    return <p data-testid="top-destinos-estado-desconhecido" className="mb-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-600">
      Este servidor não informou se esta operação já declarou uma política de próximas operações. A lista
      abaixo é o que ele devolveu; enquanto nada for alterado nesta aba, a gravação não toca no encadeamento.
    </p>;
  }
  if (!declarado) {
    return <div data-testid="top-destinos-politica-nao-declarada" className="mb-3 space-y-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
      {comPonte
        ? <p>
          Esta operação ainda não declarou uma política de próximas operações. Por compatibilidade, um
          documento deste tipo continua sendo encaminhado pelo caminho anterior do produto — comportamento
          herdado, e não uma decisão registrada aqui.
        </p>
        : <p>
          Esta operação ainda não declarou uma política de próximas operações: enquanto ela não for declarada,
          um documento deste tipo não oferece próxima operação.
        </p>}
      <p>
        Adicione um destino abaixo para dizer para onde esta operação encaminha, ou registre que ela não
        encaminha para lugar nenhum.
      </p>
      <Button size="sm" variant="outline" data-testid="top-destinos-declarar" onClick={onDeclarar}>
        Declarar que não há próxima operação
      </Button>
    </div>;
  }
  if (vazio) {
    return <p data-testid="top-destinos-politica-vazia" className="mb-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-700">
      Política declarada: esta operação não gera nenhuma próxima operação. Ao salvar, um documento deste
      tipo deixa de oferecer conversão, e uma conversão pedida fora desta tela é recusada pelo servidor.
    </p>;
  }
  return null;
}
