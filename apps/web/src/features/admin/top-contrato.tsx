"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import {
  VERSAO_SCHEMA_CONFIGURACAO_TOP,
  configuracaoNeutraTop,
  lerConfiguracaoTop,
  type AtualizacaoEstoque,
  type AtualizacaoFinanceiro,
  type CalculoTributario,
  type ConfiguracaoTipoOperacaoV1,
  type ModoConfirmacao,
  type ModoFinanceiro,
  type MomentoAprovacao,
  type MomentoEfeito,
  type PoliticaAlteracao,
  type PoliticaAprovacao,
  type PoliticaDocumentoSemItens,
  type PoliticaSaldoNegativo,
  type SecaoConfiguracaoTop
} from "@agro/domain";

/**
 * O CONTRATO DE CONFIGURAÇÃO DE TOP VISTO DO LADO DO NAVEGADOR (TOP-CONFIG-03).
 *
 * ┌─ POR QUE ESTE ARQUIVO EXISTE, SE O DOMÍNIO JÁ TEM O CONTRATO ──────────────────────────────────────┐
 * │ O domínio (`packages/domain/src/tipo-operacao-configuracao.ts`) é a verdade sobre a FORMA da        │
 * │ configuração, e este arquivo NÃO a repete: ele importa os tipos, o neutro e o leitor estrito de lá. │
 * │ O que mora aqui é a outra pergunta — "esta API, agora, sabe guardar configuração?" — que o domínio  │
 * │ não pode responder porque não conhece o fio.                                                        │
 * │                                                                                                      │
 * │ Durante um rolling deploy a web NOVA conversa com a API ANTIGA por alguns minutos. Mandar            │
 * │ `configuracao` às cegas nesse intervalo tem dois desfechos, e os dois são ruins: ou a API antiga     │
 * │ recusa com 422 (ruído), ou — pior — a aceita e descarta, e a tela diz "salvo" sobre uma regra que    │
 * │ nunca foi gravada. Então a tela PERGUNTA antes, e só oferece o editor avançado quando a resposta     │
 * │ confirma o contrato. Sem confirmação, o cadastro básico continua funcionando e a configuração fica   │
 * │ explicitamente BLOQUEADA — nunca silenciosamente ignorada.                                           │
 * │                                                                                                      │
 * │ A forma é a mesma de `features/sales/tipo-operacao-select.tsx`, que mediu o comportamento da API     │
 * │ anterior: estados `carregando` / `nao-confirmado` / `pronto` / `erro`, com componente de mensagem    │
 * │ único por estado. Fail-closed em tudo que não for `pronto`.                                          │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ UM 200 TAMBÉM É CONFERIDO ────────────────────────────────────────────────────────────────────────┐
 * │ `api<T>()` é uma ASSERÇÃO de tipo, não uma prova: em runtime o corpo é `unknown` e o TypeScript já  │
 * │ terminou o trabalho dele. Uma API MAIS NOVA (contrato 2, campos com outro significado) chegaria ao  │
 * │ estado "pronto" sem conferência e o PUT sairia contra um contrato que ninguém leu. Por isso todo    │
 * │ corpo passa por um leitor explícito aqui, e o que não se reconhece NEGA.                            │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/** A ÚNICA versão de contrato de capacidades que esta tela sabe ler. O servidor a declara em `/capabilities`. */
export const CONTRATO_CAPACIDADES_TOP = 1 as const;

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const ehTexto = (v: unknown): v is string => typeof v === "string";
const ehInteiroPositivo = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0;

// ---------------------------------------------------------------------------------------------------
// 1. CAPACIDADES
// ---------------------------------------------------------------------------------------------------

export interface CapacidadesDestinosTop {
  suportado: boolean;
  limite: number;
}

export interface CapacidadesTop {
  contractVersion: typeof CONTRATO_CAPACIDADES_TOP;
  configuracao: { versaoSchema: number; secoes: string[] };
  destinos: CapacidadesDestinosTop;
}

/**
 * Lê o corpo de `/capabilities`, ou devolve `null` — que é o mesmo que "não confirmado".
 *
 * O BLOCO `destinos` É TRATADO COMO OPCIONAL, E ISSO É DELIBERADO. Uma API que declara o contrato 1 e
 * guarda configuração pode ainda não servir o grafo de próximas operações; recusar o corpo inteiro por
 * causa disso bloquearia também a configuração, que ela sabe guardar. Ausente vira `suportado: false`, o
 * mesmo que a tela usa para bloquear a aba de destinos — degradação por PARTE, nunca por adivinhação.
 * Presente e malformado, ao contrário, é contrato desconhecido e NEGA o corpo inteiro.
 */
export function lerCapacidadesTop(bruto: unknown): CapacidadesTop | null {
  if (!ehObjeto(bruto)) return null;
  if (bruto.contractVersion !== CONTRATO_CAPACIDADES_TOP) return null;

  const c = bruto.configuracao;
  if (!ehObjeto(c) || !ehInteiroPositivo(c.versaoSchema)) return null;
  if (!Array.isArray(c.secoes) || !c.secoes.every(ehTexto)) return null;

  let destinos: CapacidadesDestinosTop = { suportado: false, limite: 0 };
  if (bruto.destinos !== undefined) {
    const d = bruto.destinos;
    if (!ehObjeto(d) || typeof d.suportado !== "boolean") return null;
    if (d.suportado && !ehInteiroPositivo(d.limite)) return null;
    destinos = { suportado: d.suportado, limite: ehInteiroPositivo(d.limite) ? d.limite : 0 };
  }

  return {
    contractVersion: CONTRATO_CAPACIDADES_TOP,
    configuracao: { versaoSchema: c.versaoSchema, secoes: c.secoes as string[] },
    destinos
  };
}

/** O que a tela precisa decidir antes de oferecer o editor avançado. */
export type EstadoCapacidadesTop =
  /** Ainda perguntando. */
  | { situacao: "carregando" }
  /**
   * A API não confirmou o contrato: rota ausente (404, API anterior a esta fatia), servidor com defeito
   * (5xx) ou 200 com corpo que não é este contrato. Os três chegam indistinguíveis o bastante, e nos três
   * a resposta certa é a mesma — bloquear a escrita de configuração. Em 200 inválido o `status` fica
   * AUSENTE de propósito: anotar 200 aqui enganaria quem lesse.
   */
  | { situacao: "nao-confirmado"; status?: number }
  /** A API guarda configuração num schema que esta versão da tela não escreve. Causa DIFERENTE, texto diferente. */
  | { situacao: "schema-divergente"; versaoSchema: number }
  /** Falha que o servidor EXPLICOU (403, rede): bloqueia e repete a causa que ele deu. */
  | { situacao: "erro"; mensagem: string }
  /** A API confirmou o contrato 1 e o schema que esta tela escreve. */
  | { situacao: "pronto"; capacidades: CapacidadesTop };

/**
 * Pergunta à API o que ela sabe fazer com configuração de TOP.
 *
 * `retry: false` é deliberado: 404 aqui é RESPOSTA (a API não tem a rota), não falha transitória.
 */
export function useCapacidadesTop(habilitado = true): EstadoCapacidadesTop {
  // `unknown` DE PROPÓSITO: o corpo só vira `CapacidadesTop` depois de CONFERIDO, nunca por asserção.
  const q = useQuery<unknown, ApiError>({
    queryKey: ["tipos-operacao", "capabilities"],
    queryFn: () => api<unknown>("/api/admin/tipos-operacao/capabilities"),
    enabled: habilitado,
    retry: false
  });

  if (!habilitado || q.isPending) return { situacao: "carregando" };
  if (q.error) {
    if (q.error.status === 404 || q.error.status >= 500) return { situacao: "nao-confirmado", status: q.error.status };
    return { situacao: "erro", mensagem: q.error.message };
  }
  const lidas = lerCapacidadesTop(q.data);
  if (!lidas) return { situacao: "nao-confirmado" };
  // Contrato certo, DICIONÁRIO errado: escrever v1 numa API que guarda v2 gravaria bytes que ela leria com
  // outro significado. Bloquear é a única leitura honesta.
  if (lidas.configuracao.versaoSchema !== VERSAO_SCHEMA_CONFIGURACAO_TOP) {
    return { situacao: "schema-divergente", versaoSchema: lidas.configuracao.versaoSchema };
  }
  return { situacao: "pronto", capacidades: lidas };
}

/** A configuração pode ser ENVIADA? Só com contrato confirmado. Fail-closed em todos os outros estados. */
export const podeConfigurar = (
  e: EstadoCapacidadesTop
): e is Extract<EstadoCapacidadesTop, { situacao: "pronto" }> => e.situacao === "pronto";

/** Os destinos podem ser ENVIADOS? Exige contrato confirmado E o bloco de destinos declarado pela API. */
export const podeConfigurarDestinos = (e: EstadoCapacidadesTop): boolean =>
  podeConfigurar(e) && e.capacidades.destinos.suportado;

/** Quantos destinos esta API aceita. Zero quando ela não os suporta — e zero bloqueia a inclusão. */
export const limiteDeDestinos = (e: EstadoCapacidadesTop): number =>
  podeConfigurar(e) ? e.capacidades.destinos.limite : 0;

/**
 * Mensagem única por estado. Quem lê precisa saber se o problema é o servidor, o contrato ou a permissão —
 * e, acima de tudo, precisa saber que a configuração NÃO foi salva.
 */
export function MensagemCapacidadesTop({ estado }: { estado: EstadoCapacidadesTop }) {
  if (estado.situacao === "nao-confirmado") {
    return <p data-testid="top-config-nao-confirmada" className="text-[12px] text-amber-700">
      Este servidor não confirmou o recurso de configuração dos tipos de operação. As seções de operação
      ficam bloqueadas para não gravar uma configuração que seria descartada sem aviso. O cadastro de
      identificação continua disponível. Tente novamente em alguns instantes.
    </p>;
  }
  if (estado.situacao === "schema-divergente") {
    return <p data-testid="top-config-schema-divergente" className="text-[12px] text-amber-700">
      Este servidor guarda a configuração em um formato mais recente do que esta tela sabe escrever
      (formato {estado.versaoSchema}). As seções de operação ficam bloqueadas para não sobrescrever a
      regra existente. Atualize a página; se continuar, procure o responsável pela atualização do sistema.
    </p>;
  }
  if (estado.situacao === "erro") {
    return <p data-testid="top-config-erro" className="text-[12px] text-red-700">{estado.mensagem}</p>;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------
// 2. O DETALHE DA TOP
// ---------------------------------------------------------------------------------------------------

/**
 * A configuração como o servidor a entrega: ou legível, ou declaradamente não legível.
 *
 * `suportada: false` é ESTADO, não erro. Uma versão gravada num schema futuro continua existindo e
 * continua tendo de aparecer no histórico — com a verdade ("não sabemos ler isto") em vez de valores
 * inventados a partir do neutro, que seriam indistinguíveis de uma configuração real.
 */
export type ConfiguracaoDoServidor =
  | { suportada: true; versaoSchema: number; valor: ConfiguracaoTipoOperacaoV1 }
  | { suportada: false; versaoSchema: number };

export function lerConfiguracaoDoServidor(bruto: unknown): ConfiguracaoDoServidor | null {
  if (!ehObjeto(bruto)) return null;
  if (!ehInteiroPositivo(bruto.versaoSchema)) return null;
  if (bruto.suportada === false) return { suportada: false, versaoSchema: bruto.versaoSchema };
  if (bruto.suportada !== true) return null;
  // O `valor` passa pelo LEITOR DO DOMÍNIO, não por asserção: é o mesmo código que a API usa, então a tela
  // nunca aceita uma forma que o servidor recusaria — e nunca mostra campo que não existe no contrato.
  const r = lerConfiguracaoTop(bruto.valor);
  if (!r.ok) return { suportada: false, versaoSchema: bruto.versaoSchema };
  return { suportada: true, versaoSchema: bruto.versaoSchema, valor: r.valor };
}

/** Uma aresta origem → destino como o servidor a entrega no detalhe. */
export interface DestinoConfigurado {
  tipoOperacaoId: string;
  ordem: number;
  codigo: string;
  nome: string;
  codigoBase: string;
  familiaRotulo: string;
  ativo: boolean;
  /** O destino serve HOJE? Avaliado pelo servidor no estado atual, nunca congelado. */
  disponivel: boolean;
}

const ehDestinoConfigurado = (v: unknown): v is DestinoConfigurado =>
  ehObjeto(v) && ehTexto(v.tipoOperacaoId) && typeof v.ordem === "number" && Number.isInteger(v.ordem)
  && ehTexto(v.codigo) && ehTexto(v.nome) && ehTexto(v.codigoBase) && ehTexto(v.familiaRotulo)
  && typeof v.ativo === "boolean" && typeof v.disponivel === "boolean";

/**
 * Lê a lista de destinos. `null` = a API não entregou a lista nesta forma (bloqueia a aba).
 *
 * Item inválido NÃO é filtrado: esconder do administrador uma aresta que o servidor declarou seria o mesmo
 * descarte silencioso que esta tela existe para impedir, só que do lado de cá. A lista inteira NEGA.
 */
export function lerDestinosConfigurados(bruto: unknown): DestinoConfigurado[] | null {
  if (!Array.isArray(bruto) || !bruto.every(ehDestinoConfigurado)) return null;
  return [...(bruto as DestinoConfigurado[])].sort((a, b) => a.ordem - b.ordem);
}

/** O detalhe da TOP, já conferido. `configuracao`/`destinos` podem faltar numa API anterior. */
export interface DetalheTop {
  id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  familia: { codigo: string; rotulo: string; modulo: string | null };
  ativo: boolean;
  padrao: boolean;
  versao: number;
  revisao: number;
  configuracao: ConfiguracaoDoServidor | null;
  destinos: DestinoConfigurado[] | null;
  /**
   * A POLÍTICA DE PRÓXIMAS OPERAÇÕES JÁ FOI DECLARADA NESTA VERSÃO?
   *
   * TRÊS valores, porque são três situações e nenhuma responde pela outra:
   *   `true`   declarada. A lista de destinos É a política — inclusive quando está vazia.
   *   `false`  nunca declarada. Estado legado: a conversão segue a cadeia anterior.
   *   `null`   o servidor não informou (API anterior a esta correção). NÃO é `false`: afirmar "ninguém
   *            declarou" por causa de um campo ausente é exatamente o erro que esta coluna veio corrigir.
   *
   * `destinos.length` NÃO responde isto. Zero destinos é o mesmo número nos dois primeiros casos, e a
   * diferença entre eles decide se um documento converte ou não.
   */
  destinosConfigurados: boolean | null;
}

export function lerDetalheTop(bruto: unknown): DetalheTop | null {
  if (!ehObjeto(bruto)) return null;
  const f = bruto.familia;
  if (!ehTexto(bruto.id) || !ehTexto(bruto.codigo) || !ehTexto(bruto.nome)) return null;
  if (!ehObjeto(f) || !ehTexto(f.codigo) || !ehTexto(f.rotulo)) return null;
  if (typeof bruto.ativo !== "boolean" || typeof bruto.padrao !== "boolean") return null;
  if (!ehInteiroPositivo(bruto.versao) || typeof bruto.revisao !== "number") return null;
  // AUSENTE é tolerado (API anterior) e vira `null`; PRESENTE com outro tipo é contrato desconhecido e
  // NEGA o corpo inteiro — a mesma régua do bloco `destinos` das capacidades.
  if (bruto.destinosConfigurados !== undefined && typeof bruto.destinosConfigurados !== "boolean") return null;
  return {
    id: bruto.id,
    codigo: bruto.codigo,
    nome: bruto.nome,
    descricao: ehTexto(bruto.descricao) ? bruto.descricao : null,
    familia: { codigo: f.codigo, rotulo: f.rotulo, modulo: ehTexto(f.modulo) ? f.modulo : null },
    ativo: bruto.ativo,
    padrao: bruto.padrao,
    versao: bruto.versao,
    revisao: bruto.revisao,
    configuracao: bruto.configuracao === undefined ? null : lerConfiguracaoDoServidor(bruto.configuracao),
    destinos: bruto.destinos === undefined ? null : lerDestinosConfigurados(bruto.destinos),
    destinosConfigurados: bruto.destinosConfigurados === undefined ? null : bruto.destinosConfigurados
  };
}

/** Uma TOP oferecida como destino possível. A lista é MONTADA PELO SERVIDOR — nunca filtrada aqui. */
export interface DestinoPossivel {
  id: string;
  codigo: string;
  nome: string;
  codigoBase: string;
  familiaRotulo: string;
}

const ehDestinoPossivel = (v: unknown): v is DestinoPossivel =>
  ehObjeto(v) && ehTexto(v.id) && ehTexto(v.codigo) && ehTexto(v.nome)
  && ehTexto(v.codigoBase) && ehTexto(v.familiaRotulo);

/**
 * Os destinos que o produto admite para esta origem.
 *
 * A COMPATIBILIDADE É DECIDIDA NO SERVIDOR (tenant, exclusão, situação e família de destino). Montar esta
 * lista no cliente exigiria uma segunda cópia das regras do grafo, que envelheceria em silêncio na primeira
 * família nova — e, pior, uma tela que decide o que é compatível vira autoridade de coisa que não é dela.
 */
export function useDestinosPossiveis(codigoBase: string, habilitado: boolean) {
  const q = useQuery<unknown, ApiError>({
    queryKey: ["tipos-operacao", "destinos-possiveis", codigoBase],
    queryFn: () => api<unknown>(`/api/admin/tipos-operacao/destinos-possiveis?codigoBase=${encodeURIComponent(codigoBase)}`),
    enabled: habilitado && codigoBase.length > 0,
    retry: false
  });
  const itens = React.useMemo(() => {
    const d = q.data;
    if (!ehObjeto(d) || !Array.isArray(d.items) || !d.items.every(ehDestinoPossivel)) return null;
    return d.items as DestinoPossivel[];
  }, [q.data]);
  return { itens, carregando: q.isPending && habilitado, erro: q.error ?? null };
}

// ---------------------------------------------------------------------------------------------------
// 3. RÓTULOS
// ---------------------------------------------------------------------------------------------------

/**
 * RÓTULOS DOS ENUMS DA CONFIGURAÇÃO — DÍVIDA DECLARADA, A SER MOVIDA PARA O DOMÍNIO.
 *
 * O dono de rótulo de enum é `packages/domain/src/labels.ts` (`ENUM_LABELS` / `enumLabel`), e nenhuma
 * destas chaves existe lá hoje. Criar um segundo registry de rótulos no web seria a segunda lista que o
 * contrato proíbe — ela não fica desatualizada com barulho, envelhece em silêncio. Então isto aqui é
 * EXPLICITAMENTE PROVISÓRIO: o destino é `ENUM_LABELS` (domínios `top_confirmacao`, `top_alteracao`,
 * `top_documento_sem_itens`, `top_estoque_atualizacao`, `top_financeiro_atualizacao`, `top_financeiro_modo`,
 * `top_momento_efeito`, `top_saldo_negativo`, `top_calculo_tributario`, `top_aprovacao_politica`,
 * `top_momento_aprovacao`), e esta constante sai daqui na mesma fatia que os criar.
 *
 * Os VALORES continuam vindo do domínio (as listas `MODOS_CONFIRMACAO` e companhia): o que está duplicado é
 * só a tradução, nunca o conjunto de opções.
 */
export const ROTULOS_TOP = {
  confirmacao: { manual: "Manual", automatica: "Automática" } satisfies Record<ModoConfirmacao, string>,
  alteracao: { bloqueada: "Bloqueada", permitida: "Permitida" } satisfies Record<PoliticaAlteracao, string>,
  documentoSemItens: { proibido: "Proibido", permitido: "Permitido" } satisfies Record<PoliticaDocumentoSemItens, string>,
  estoqueAtualizacao: {
    nenhuma: "Não movimenta estoque",
    entrada: "Entrada",
    saida: "Saída",
    transferencia: "Transferência"
  } satisfies Record<AtualizacaoEstoque, string>,
  financeiroAtualizacao: {
    nenhuma: "Não gera efeito financeiro",
    receber: "A receber",
    pagar: "A pagar"
  } satisfies Record<AtualizacaoFinanceiro, string>,
  financeiroModo: { incluir: "Título firme", provisionar: "Previsão" } satisfies Record<ModoFinanceiro, string>,
  momentoEfeito: { confirmacao: "Na confirmação do documento" } satisfies Record<MomentoEfeito, string>,
  saldoNegativo: { bloquear: "Bloquear", permitir: "Permitir" } satisfies Record<PoliticaSaldoNegativo, string>,
  calculoTributario: { nao_aplicar: "Não aplicar", preparado: "Preparado" } satisfies Record<CalculoTributario, string>,
  aprovacaoPolitica: {
    nenhuma: "Sem aprovação",
    sempre: "Sempre",
    por_valor: "A partir de um valor"
  } satisfies Record<PoliticaAprovacao, string>,
  momentoAprovacao: { antes_da_confirmacao: "Antes da confirmação" } satisfies Record<MomentoAprovacao, string>
} as const;

/** Rótulo de seção para o resumo do histórico. Mesma dívida, mesmo destino. */
export const ROTULOS_SECAO_TOP: Record<SecaoConfiguracaoTop, string> = {
  geral: "Geral",
  estoque: "Estoque",
  financeiro: "Financeiro",
  fiscal: "Fiscal",
  aprovacao: "Aprovação"
};

// ---------------------------------------------------------------------------------------------------
// 4. O RASCUNHO EM EDIÇÃO
// ---------------------------------------------------------------------------------------------------

/** Uma aresta enquanto está sendo editada: identidade + a ordem que o usuário arrumou. */
export interface DestinoEmEdicao {
  tipoOperacaoId: string;
  codigo: string;
  nome: string;
  familiaRotulo: string;
  /** O destino continua servindo? Só o servidor sabe; `undefined` num destino recém-escolhido. */
  disponivel?: boolean;
}

/** Tudo o que o editor mantém em memória. Comparar este objeto inteiro é o que detecta alteração pendente. */
export interface RascunhoTop {
  nome: string;
  descricao: string;
  ativo: boolean;
  padrao: boolean;
  codigo: string;
  codigoBase: string;
  configuracao: ConfiguracaoTipoOperacaoV1;
  destinos: DestinoEmEdicao[];
  /**
   * ESTA EDIÇÃO DECLARA A POLÍTICA DE PRÓXIMAS OPERAÇÕES?
   *
   * É o que decide se `destinos` VAI NO CORPO da gravação. O contrato do servidor é a PRESENÇA DA CHAVE:
   * ausente = preservar o que já estava (arestas e estado); presente, mesmo como lista vazia = declarar.
   *
   * Nasce `true` quando a versão carregada já declarava — aí toda gravação re-declara o que já vale, e o
   * administrador não perde a política por editar o nome. Nasce `false` no cadastro novo e no registro
   * legado: enquanto o usuário não adicionar um destino nem declarar explicitamente que não há próxima
   * operação, o silêncio dele continua sendo silêncio, e não uma decisão que ninguém tomou.
   */
  destinosDeclarados: boolean;
}

/**
 * A configuração inicial do editor.
 *
 * NEUTRO quando o servidor não entregou configuração legível — e isso NÃO é "inventar valores": o neutro é
 * o que o próprio domínio define como "nada declarado", e o editor nesse caso está desabilitado ou criando
 * um registro novo. O que jamais acontece é mostrar o neutro dizendo que ele é a configuração salva de uma
 * versão que não sabemos ler; essa distinção é feita por quem chama, pelo estado `suportada: false`.
 */
export function configuracaoInicial(c: ConfiguracaoDoServidor | null): ConfiguracaoTipoOperacaoV1 {
  return c && c.suportada ? c.valor : configuracaoNeutraTop();
}

/**
 * Serialização canônica para detectar alteração pendente.
 *
 * Chaves ORDENADAS: `JSON.stringify` preserva ordem de inserção, e sem isto um objeto remontado na mesma
 * forma pareceria "alterado" só por ter sido construído noutra ordem — e o aviso de descarte apareceria
 * para quem não mexeu em nada, treinando o usuário a ignorá-lo.
 */
export function assinaturaRascunho(r: RascunhoTop): string {
  const canonico = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`).join(",")}}`;
    }
    return JSON.stringify(v) ?? "null";
  };
  return canonico({
    nome: r.nome,
    descricao: r.descricao,
    ativo: r.ativo,
    padrao: r.padrao,
    codigo: r.codigo,
    codigoBase: r.codigoBase,
    configuracao: r.configuracao,
    // Só identidade e ORDEM viajam na assinatura: código e nome do destino são apresentação e podem mudar
    // no servidor sem que o rascunho do usuário tenha mudado.
    destinos: r.destinos.map((d) => d.tipoOperacaoId),
    // DECLARAR É CONTEÚDO, e por isso entra aqui. Sair da tela depois de declarar "esta operação não gera
    // próxima operação" — sem nenhum destino na lista — é sair com alteração pendente: a lista continua
    // vazia, mas o significado dela mudou, e é justamente essa mudança que a gravação registra.
    destinosDeclarados: r.destinosDeclarados
  });
}

/**
 * O limite monetário aceitável.
 *
 * ESPELHA a regra do domínio (`FORMA_VALOR_MINIMO`), que é a autoridade e recusa com 422 de qualquer jeito.
 * Repetido aqui só para o usuário ver o problema antes de enviar; a tela nunca é a autoridade. Dinheiro é
 * STRING decimal ponta a ponta — ponto flutuante faria "10000.10" às vezes disparar e às vezes não.
 */
const FORMA_VALOR_MINIMO = /^\d{1,13}(\.\d{1,2})?$/;
export const valorMinimoAceitavel = (v: string): boolean => FORMA_VALOR_MINIMO.test(v) && Number(v) > 0;

/** A mensagem de conflito otimista. O 409 do servidor NUNCA é sobrescrito com um novo envio automático. */
export const ehConflitoDeConcorrencia = (e: unknown): boolean =>
  e instanceof ApiError && (e.status === 409 || e.code === "CONCURRENCY_CONFLICT");
