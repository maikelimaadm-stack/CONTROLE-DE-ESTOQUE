/**
 * A CONFIGURAÇÃO OPERACIONAL DA TOP — DECLARATIVA, VERSIONADA, IMUTÁVEL (TOP-CONFIG-03).
 *
 * ┌─ O QUE ESTE ARQUIVO É, E O QUE ELE DELIBERADAMENTE NÃO É ──────────────────────────────────────────┐
 * │ ELE É   o contrato tipado do que uma TOP DECLARA sobre a operação: se atualiza estoque e em que    │
 * │         direção, se gera efeito financeiro, se é relevante para o fiscal, se exige aprovação, e    │
 * │         quais preenchimentos são obrigatórios.                                                     │
 * │                                                                                                     │
 * │ ELE NÃO É  um motor. Não há função, expressão, SQL, fórmula, callback nem DSL aqui — e isso é      │
 * │            decisão, não omissão. Um campo que aceita expressão transforma cadastro em programação: │
 * │            passa a exigir sandbox, versionamento de linguagem, depurador e auditoria de execução,  │
 * │            e o "administrador" vira alguém que pode derrubar o ERP com uma vírgula. Enum fechado e │
 * │            booleano são a fronteira que mantém isto configurável por gente de negócio.             │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ CONFIGURAR ≠ EXECUTAR — E A ÚNICA PORTA ENTRE OS DOIS (TOP-CONFIG-04A) ────────────────────────────┐
 * │ Nada aqui move estoque, gera título, calcula imposto ou aprova documento. A TOP-CONFIG-03 ensinou  │
 * │ o sistema a GUARDAR e VERSIONAR a intenção; a TOP-CONFIG-04A abriu UMA porta de execução, e ela é  │
 * │ EXPLÍCITA: o bloco `execucao` do formato 2 (`estoque`/`financeiro`: `legado` | `configurada`).     │
 * │                                                                                                     │
 * │ A PRESENÇA DE CONFIGURAÇÃO NÃO AUTORIZA EXECUÇÃO. As versões do formato 1 foram gravadas quando os │
 * │ campos eram só declaração: `estoque.atualizacao = "nenhuma"` numa versão v1 NÃO quer dizer "esta   │
 * │ venda não baixa estoque" — quer dizer "ninguém decidiu nada, porque nada executava". Por isso o    │
 * │ formato 1 é LEGADO PARA SEMPRE, e a leitura da execução mora numa função só (`execucaoDeclaradaTop`)│
 * │ para que nenhum consumidor deduza execução da família, do sentido declarado ou do tipo de documento.│
 * │                                                                                                     │
 * │ Quem decide se uma combinação configurada É executável é `tipo-operacao-execucao.ts` (a matriz de  │
 * │ suporte); quem executa é o serviço dono do documento. Este arquivo continua sendo só o contrato.    │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POR QUE VERSIONADA, E POR QUE IMUTÁVEL ───────────────────────────────────────────────────────────┐
 * │ A configuração é a REGRA que explica o efeito de um documento. Editá-la no lugar faria todo        │
 * │ documento passado passar a ser lido sob uma regra que não vigorava quando ele foi emitido: o       │
 * │ histórico vira inexplicável e a auditoria, impossível. Então editar CRIA a versão N+1, e a versão  │
 * │ N nunca é tocada — a mesma razão pela qual `erp.tipos_operacao_versoes` é TABELA e não coluna.     │
 * │ Nome, descrição e configuração viajam juntos na MESMA versão porque juntos são um retrato: o       │
 * │ documento que cita a versão 3 precisa ver o nome da versão 3 ao lado da regra da versão 3.         │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POR QUE NÃO HÁ UUID DE ARMAZÉM / CENTRO / NATUREZA AQUI ──────────────────────────────────────────┐
 * │ Só EXIGÊNCIAS (`exigeArmazem: true`), nunca o alvo concreto. Guardar um UUID dentro do JSON abriria │
 * │ três buracos de uma vez: ele não é validado por chave estrangeira (é JSON), pode apontar para outro │
 * │ tenant, e pode ser excluído depois — deixando uma versão IMUTÁVEL com um ponteiro morto que nunca   │
 * │ poderá ser corrigido, porque versão não se edita. Referência concreta exige validação de tenant,    │
 * │ existência e estado, mais uma política de estabilidade histórica; é arquitetura própria, e fica     │
 * │ declarada como dívida no contrato em vez de improvisada aqui.                                       │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/**
 * O FORMATO 1 — o da TOP-CONFIG-03, o do neutro e o do `DEFAULT` da migration 0022.
 *
 * Continua sendo o valor desta constante, e não o formato mais novo, por três motivos que não mudam com a
 * TOP-CONFIG-04A: o `DEFAULT` da 0022 (que serve binário anterior e é histórico aplicado, nunca editado) é
 * o formato 1; o cliente anterior compara a capacidade do servidor com ESTE número para decidir se edita a
 * configuração; e o formato 1 é, por definição, legado — o neutro que uma TOP recebe sem decisão nenhuma.
 */
export const VERSAO_SCHEMA_CONFIGURACAO_TOP = 1 as const;

/**
 * O FORMATO 2 (TOP-CONFIG-04A): as mesmas cinco seções mais o bloco `execucao`, que diz, POR EFEITO, se a
 * venda segue o comportamento legado ou a configuração desta versão.
 */
export const VERSAO_SCHEMA_CONFIGURACAO_TOP_V2 = 2 as const;

/** Os formatos que este código sabe LER. Qualquer outro é recusado — nunca lido "parecido". */
export const VERSOES_SCHEMA_CONFIGURACAO_TOP = [VERSAO_SCHEMA_CONFIGURACAO_TOP, VERSAO_SCHEMA_CONFIGURACAO_TOP_V2] as const;
export type VersaoSchemaConfiguracaoTop = (typeof VERSOES_SCHEMA_CONFIGURACAO_TOP)[number];

// ---------------------------------------------------------------------------------------------------
// 1. OS ENUMS — fechados, em português, sem valor "outro"
// ---------------------------------------------------------------------------------------------------

/** Quem dispara a confirmação do documento. `automatica` é INTENÇÃO declarada; ninguém a executa ainda. */
export const MODOS_CONFIRMACAO = ["manual", "automatica"] as const;
export type ModoConfirmacao = (typeof MODOS_CONFIRMACAO)[number];

/** O documento pode ser alterado depois de confirmado? */
export const POLITICAS_ALTERACAO = ["bloqueada", "permitida"] as const;
export type PoliticaAlteracao = (typeof POLITICAS_ALTERACAO)[number];

/** Documento sem nenhum item é aceitável para esta operação? */
export const POLITICAS_DOCUMENTO_SEM_ITENS = ["proibido", "permitido"] as const;
export type PoliticaDocumentoSemItens = (typeof POLITICAS_DOCUMENTO_SEM_ITENS)[number];

/** O sentido do efeito de estoque. `nenhuma` é o neutro e desliga a seção inteira. */
export const ATUALIZACOES_ESTOQUE = ["nenhuma", "entrada", "saida", "transferencia"] as const;
export type AtualizacaoEstoque = (typeof ATUALIZACOES_ESTOQUE)[number];

/** O sentido do efeito financeiro. `nenhuma` é o neutro e desliga a seção inteira. */
export const ATUALIZACOES_FINANCEIRO = ["nenhuma", "receber", "pagar"] as const;
export type AtualizacaoFinanceiro = (typeof ATUALIZACOES_FINANCEIRO)[number];

/** Título firme ou previsão que não compõe saldo realizado. */
export const MODOS_FINANCEIRO = ["incluir", "provisionar"] as const;
export type ModoFinanceiro = (typeof MODOS_FINANCEIRO)[number];

/**
 * O momento pretendido do efeito.
 *
 * UM VALOR SÓ, E ISSO É PROPOSITAL. O produto contempla hoje apenas o efeito na confirmação, e um enum de
 * um elemento diz exatamente isso — em vez de oferecer `expedicao`/`faturamento` que nada consumiria e que
 * um administrador escolheria acreditando ter mudado alguma coisa. Quando a TOP-CONFIG-04 implementar outro
 * momento, o valor entra aqui junto com o código que o executa, não antes.
 */
export const MOMENTOS_EFEITO = ["confirmacao"] as const;
export type MomentoEfeito = (typeof MOMENTOS_EFEITO)[number];

/** O que fazer quando a operação levaria o saldo abaixo de zero. */
export const POLITICAS_SALDO_NEGATIVO = ["bloquear", "permitir"] as const;
export type PoliticaSaldoNegativo = (typeof POLITICAS_SALDO_NEGATIVO)[number];

/** Há cálculo de tributo? `preparado` declara a intenção sem que exista motor para executá-la. */
export const CALCULOS_TRIBUTARIOS = ["nao_aplicar", "preparado"] as const;
export type CalculoTributario = (typeof CALCULOS_TRIBUTARIOS)[number];

/** Quando o documento precisa passar por aprovação. */
export const POLITICAS_APROVACAO = ["nenhuma", "sempre", "por_valor"] as const;
export type PoliticaAprovacao = (typeof POLITICAS_APROVACAO)[number];

/** Em que ponto a aprovação trava o documento. Um valor só, pelo mesmo motivo de `MOMENTOS_EFEITO`. */
export const MOMENTOS_APROVACAO = ["antes_da_confirmacao"] as const;
export type MomentoAprovacao = (typeof MOMENTOS_APROVACAO)[number];

/**
 * QUEM TEM AUTORIDADE SOBRE UM EFEITO (formato 2).
 *
 * `legado`      o serviço faz exatamente o que fazia antes desta configuração existir.
 * `configurada` o serviço obedece à seção correspondente DESTA versão.
 *
 * Enum POR EFEITO, e não um booleano "ativo": um booleano não diria QUAL efeito foi entregue à
 * configuração, e amarraria estoque e financeiro num corte único — o contrário do cutover separado.
 */
export const MODOS_EXECUCAO_TOP = ["legado", "configurada"] as const;
export type ModoExecucaoTop = (typeof MODOS_EXECUCAO_TOP)[number];

// ---------------------------------------------------------------------------------------------------
// 2. O ENVELOPE
// ---------------------------------------------------------------------------------------------------

export interface ConfiguracaoGeralV1 {
  confirmacao: ModoConfirmacao;
  exigeParceiro: boolean;
  exigeCentroResultado: boolean;
  exigeObservacao: boolean;
  alteracaoAposConfirmacao: PoliticaAlteracao;
  documentoSemItens: PoliticaDocumentoSemItens;
}

export interface ConfiguracaoEstoqueV1 {
  atualizacao: AtualizacaoEstoque;
  momento: MomentoEfeito;
  exigeArmazem: boolean;
  saldoNegativo: PoliticaSaldoNegativo;
}

export interface ConfiguracaoFinanceiroV1 {
  atualizacao: AtualizacaoFinanceiro;
  modo: ModoFinanceiro;
  momento: MomentoEfeito;
  exigeFormaPagamento: boolean;
  exigeVencimento: boolean;
  exigeCentroResultado: boolean;
}

export interface ConfiguracaoFiscalV1 {
  habilitado: boolean;
  exigeDocumentoFiscal: boolean;
  exigeNaturezaOperacao: boolean;
  exigeRegraTributaria: boolean;
  calculoTributario: CalculoTributario;
}

export interface ConfiguracaoAprovacaoV1 {
  politica: PoliticaAprovacao;
  /**
   * Limite monetário, em STRING decimal — `numeric` no banco, `decimal.js` no código, string na API
   * (`CLAUDE.md`). Ponto flutuante aqui transformaria "10000.10" em aprovação que às vezes dispara e às
   * vezes não, por causa do último bit. `null` sempre que a política não for `por_valor`.
   */
  valorMinimo: string | null;
  momento: MomentoAprovacao;
}

export interface ConfiguracaoTipoOperacaoV1 {
  versaoSchema: typeof VERSAO_SCHEMA_CONFIGURACAO_TOP;
  geral: ConfiguracaoGeralV1;
  estoque: ConfiguracaoEstoqueV1;
  financeiro: ConfiguracaoFinanceiroV1;
  fiscal: ConfiguracaoFiscalV1;
  aprovacao: ConfiguracaoAprovacaoV1;
}

/** As seções, na ordem em que a tela as mostra. Usada pela auditoria e pelo editor — uma lista só. */
export const SECOES_CONFIGURACAO_TOP = ["geral", "estoque", "financeiro", "fiscal", "aprovacao"] as const;
export type SecaoConfiguracaoTop = (typeof SECOES_CONFIGURACAO_TOP)[number];

/** O bloco de execução do formato 2: um modo por efeito, e só os dois efeitos que a TOP-CONFIG-04A liga. */
export interface ConfiguracaoExecucaoTop {
  estoque: ModoExecucaoTop;
  financeiro: ModoExecucaoTop;
}

/** O formato 2: as mesmas seções do formato 1 — nenhuma muda de significado — mais `execucao`. */
export interface ConfiguracaoTipoOperacaoV2 extends Omit<ConfiguracaoTipoOperacaoV1, "versaoSchema"> {
  versaoSchema: typeof VERSAO_SCHEMA_CONFIGURACAO_TOP_V2;
  execucao: ConfiguracaoExecucaoTop;
}

/** Qualquer configuração que este código sabe ler. Quem precisa distinguir pergunta às funções abaixo. */
export type ConfiguracaoTipoOperacao = ConfiguracaoTipoOperacaoV1 | ConfiguracaoTipoOperacaoV2;

/**
 * As seções que a auditoria e o histórico comparam no formato 2. É a lista do formato 1 mais `execucao`,
 * DERIVADA dela — e a do formato 1 não muda, porque o cliente anterior a lê pela capacidade do servidor.
 */
export const SECOES_CONFIGURACAO_TOP_V2 = [...SECOES_CONFIGURACAO_TOP, "execucao"] as const;
export type SecaoConfiguracaoTopV2 = (typeof SECOES_CONFIGURACAO_TOP_V2)[number];

// ---------------------------------------------------------------------------------------------------
// 3. O NEUTRO — UM DONO SÓ
// ---------------------------------------------------------------------------------------------------

/**
 * A configuração NEUTRA v1: tudo desligado, nada exigido, nenhum efeito declarado.
 *
 * É o que uma TOP recém-criada recebe quando ninguém configurou nada, e é o que a migration 0022 dá às
 * versões que já existiam. Neutro é a única escolha honesta para o acervo: inventar "esta TOP de venda
 * certamente baixava estoque" seria atribuir a documentos antigos uma intenção que ninguém declarou.
 *
 * FUNÇÃO, E NÃO CONSTANTE EXPORTADA, de propósito: uma constante compartilhada é um objeto único que
 * qualquer consumidor pode mutar sem querer, e a mutação vazaria para todos os outros. Cada chamada
 * devolve um objeto novo.
 *
 * Este é o ÚNICO lugar do código que sabe qual é o neutro. A migration precisa de um literal SQL
 * equivalente — essa fronteira está declarada no cabeçalho da 0022 e coberta por teste de igualdade.
 */
export function configuracaoNeutraTop(): ConfiguracaoTipoOperacaoV1 {
  return {
    versaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP,
    geral: {
      confirmacao: "manual",
      exigeParceiro: false,
      exigeCentroResultado: false,
      exigeObservacao: false,
      alteracaoAposConfirmacao: "bloqueada",
      documentoSemItens: "proibido",
    },
    estoque: { atualizacao: "nenhuma", momento: "confirmacao", exigeArmazem: false, saldoNegativo: "bloquear" },
    financeiro: {
      atualizacao: "nenhuma",
      modo: "incluir",
      momento: "confirmacao",
      exigeFormaPagamento: false,
      exigeVencimento: false,
      exigeCentroResultado: false,
    },
    fiscal: {
      habilitado: false,
      exigeDocumentoFiscal: false,
      exigeNaturezaOperacao: false,
      exigeRegraTributaria: false,
      calculoTributario: "nao_aplicar",
    },
    aprovacao: { politica: "nenhuma", valorMinimo: null, momento: "antes_da_confirmacao" },
  };
}

/** A execução de quem não decidiu nada: os dois efeitos no comportamento legado. */
const execucaoLegada = (): ConfiguracaoExecucaoTop => ({ estoque: "legado", financeiro: "legado" });

/**
 * O NEUTRO DO FORMATO 2 — o que uma TOP nasce tendo quando ninguém configurou nada (TOP-CONFIG-04A).
 *
 * Derivado do neutro do formato 1, e não um segundo literal: o neutro continua tendo um dono só. Os dois
 * efeitos nascem `legado` — nenhuma TOP começa executando configuração sem uma decisão explícita.
 */
export function configuracaoNeutraTopV2(): ConfiguracaoTipoOperacaoV2 {
  return { ...configuracaoNeutraTop(), versaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP_V2, execucao: execucaoLegada() };
}

// ---------------------------------------------------------------------------------------------------
// 4. A RECUSA
// ---------------------------------------------------------------------------------------------------

/**
 * Por que um candidato a configuração foi recusado.
 *
 * `caminho` é a coordenada do problema (`"aprovacao.valorMinimo"`) para a tela poder apontar o campo. Ele
 * nomeia a FORMA do payload, nunca dado de outra organização — não há superfície de vazamento aqui.
 */
export interface RecusaConfiguracaoTop {
  motivo: "schema_nao_suportado" | "campo_desconhecido" | "tipo_invalido" | "valor_invalido";
  caminho: string;
}

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Chaves presentes no candidato que o contrato não conhece. Ordenadas para a recusa ser determinística. */
function chavesDesconhecidas(candidato: Record<string, unknown>, esperadas: readonly string[]): string[] {
  return Object.keys(candidato).filter((k) => !esperadas.includes(k)).sort();
}

/**
 * Valor decimal positivo em string. Aceita apenas dígitos com até duas casas — nada de notação científica,
 * sinal, espaço ou `Infinity`, que é como um "número" vira um valor que o `numeric` do banco recusa depois.
 */
const FORMA_VALOR_MINIMO = /^\d{1,13}(\.\d{1,2})?$/;
const valorMinimoValido = (v: string): boolean => FORMA_VALOR_MINIMO.test(v) && Number(v) > 0;

// ---------------------------------------------------------------------------------------------------
// 5. PARSE — ESTRITO, FAIL-CLOSED, SEM MUTAR A ENTRADA
// ---------------------------------------------------------------------------------------------------

export type ResultadoConfiguracaoTop =
  | { ok: true; valor: ConfiguracaoTipoOperacao }
  | { ok: false; recusas: RecusaConfiguracaoTop[] };

/** Lê uma seção objeto, acumulando recusa se ela faltar ou não for objeto. */
function secao(
  raiz: Record<string, unknown>,
  nome: SecaoConfiguracaoTopV2,
  recusas: RecusaConfiguracaoTop[],
): Record<string, unknown> | null {
  const v = raiz[nome];
  if (!ehObjeto(v)) {
    recusas.push({ motivo: "tipo_invalido", caminho: nome });
    return null;
  }
  return v;
}

function booleano(
  s: Record<string, unknown> | null,
  secaoNome: string,
  campo: string,
  recusas: RecusaConfiguracaoTop[],
): boolean {
  if (!s) return false;
  const v = s[campo];
  if (typeof v !== "boolean") {
    recusas.push({ motivo: "tipo_invalido", caminho: `${secaoNome}.${campo}` });
    return false;
  }
  return v;
}

function enumerado<T extends string>(
  s: Record<string, unknown> | null,
  secaoNome: string,
  campo: string,
  aceitos: readonly T[],
  recusas: RecusaConfiguracaoTop[],
): T {
  if (!s) return aceitos[0]!;
  const v = s[campo];
  if (typeof v !== "string") {
    recusas.push({ motivo: "tipo_invalido", caminho: `${secaoNome}.${campo}` });
    return aceitos[0]!;
  }
  if (!(aceitos as readonly string[]).includes(v)) {
    // Valor desconhecido NEGA; não cai no vizinho nem no padrão (`.claude/rules/security.md`).
    recusas.push({ motivo: "valor_invalido", caminho: `${secaoNome}.${campo}` });
    return aceitos[0]!;
  }
  return v as T;
}

/**
 * Confere as chaves de uma seção contra o contrato. Chave desconhecida é RECUSA, nunca descarte: `z.object`
 * sem `.strict()` apagaria `exigeArmazen` (com erro de digitação) em silêncio, e o administrador leria
 * "salvo" sobre uma configuração que não foi salva.
 */
function conferirChaves(
  s: Record<string, unknown> | null,
  nome: string,
  esperadas: readonly string[],
  recusas: RecusaConfiguracaoTop[],
): void {
  if (!s) return;
  for (const k of chavesDesconhecidas(s, esperadas)) {
    recusas.push({ motivo: "campo_desconhecido", caminho: `${nome}.${k}` });
  }
}

// Uma lista de chaves de raiz POR FORMATO. Uma lista só aceitaria `execucao` num payload do formato 1 —
// e um v1 com `execucao` é exatamente o payload ambíguo que o formato 1 nunca pôde carregar.
const CHAVES_RAIZ = ["versaoSchema", ...SECOES_CONFIGURACAO_TOP] as const;
const CHAVES_RAIZ_V2 = ["versaoSchema", ...SECOES_CONFIGURACAO_TOP_V2] as const;
const CHAVES_EXECUCAO = ["estoque", "financeiro"] as const;
const CHAVES_GERAL = ["confirmacao", "exigeParceiro", "exigeCentroResultado", "exigeObservacao", "alteracaoAposConfirmacao", "documentoSemItens"] as const;
const CHAVES_ESTOQUE = ["atualizacao", "momento", "exigeArmazem", "saldoNegativo"] as const;
const CHAVES_FINANCEIRO = ["atualizacao", "modo", "momento", "exigeFormaPagamento", "exigeVencimento", "exigeCentroResultado"] as const;
const CHAVES_FISCAL = ["habilitado", "exigeDocumentoFiscal", "exigeNaturezaOperacao", "exigeRegraTributaria", "calculoTributario"] as const;
const CHAVES_APROVACAO = ["politica", "valorMinimo", "momento"] as const;

/**
 * O formato que o candidato DECLARA, se for um que este código conhece — e nada além disso.
 *
 * É a fronteira que identifica a versão. Nenhum outro lugar compara `versaoSchema` com número: quem
 * precisa saber o que o formato significa pergunta a `execucaoDeclaradaTop`, e não ao número.
 */
export function versaoSchemaDaConfiguracaoTop(bruto: unknown): VersaoSchemaConfiguracaoTop | null {
  if (!ehObjeto(bruto)) return null;
  const v = bruto.versaoSchema;
  return (VERSOES_SCHEMA_CONFIGURACAO_TOP as readonly unknown[]).includes(v) ? (v as VersaoSchemaConfiguracaoTop) : null;
}

/**
 * Transforma `unknown` em configuração PROVADA (formato 1 ou 2), ou devolve as recusas.
 *
 * O corpo que chega do cliente — e o que volta do banco — é `unknown` até aqui. Uma asserção de tipo
 * (`as ConfiguracaoTipoOperacaoV1`) seria uma promessa do TypeScript que o runtime não cumpre: o
 * compilador já terminou o trabalho dele quando o JSON chega.
 *
 * OS DOIS FORMATOS SÃO ESTRITOS DO MESMO JEITO: chave desconhecida é recusa, formato futuro é recusa, e o
 * formato 2 EXIGE `execucao` — ele não é "o formato 1 com um campo opcional". Um v2 sem `execucao` seria
 * um payload cuja decisão de execução ninguém tomou, e tratá-lo como legado seria adivinhar.
 *
 * NÃO MUTA a entrada e NÃO devolve referência a ela: o resultado é construído campo a campo, então quem
 * chamou pode continuar usando o objeto original sem descobrir que ele mudou de forma.
 */
export function lerConfiguracaoTop(bruto: unknown): ResultadoConfiguracaoTop {
  const recusas: RecusaConfiguracaoTop[] = [];

  if (!ehObjeto(bruto)) return { ok: false, recusas: [{ motivo: "tipo_invalido", caminho: "" }] };

  // O SCHEMA PRIMEIRO. Ler os campos de um payload cuja versão não se conhece seria interpretar bytes com
  // o dicionário errado — e é assim que um "3" vira "2" em silêncio.
  const versao = versaoSchemaDaConfiguracaoTop(bruto);
  if (versao === null) {
    return { ok: false, recusas: [{ motivo: "schema_nao_suportado", caminho: "versaoSchema" }] };
  }

  for (const k of chavesDesconhecidas(bruto, versao === VERSAO_SCHEMA_CONFIGURACAO_TOP_V2 ? CHAVES_RAIZ_V2 : CHAVES_RAIZ)) {
    recusas.push({ motivo: "campo_desconhecido", caminho: k });
  }

  const g = secao(bruto, "geral", recusas);
  const e = secao(bruto, "estoque", recusas);
  const f = secao(bruto, "financeiro", recusas);
  const fi = secao(bruto, "fiscal", recusas);
  const a = secao(bruto, "aprovacao", recusas);

  conferirChaves(g, "geral", CHAVES_GERAL, recusas);
  conferirChaves(e, "estoque", CHAVES_ESTOQUE, recusas);
  conferirChaves(f, "financeiro", CHAVES_FINANCEIRO, recusas);
  conferirChaves(fi, "fiscal", CHAVES_FISCAL, recusas);
  conferirChaves(a, "aprovacao", CHAVES_APROVACAO, recusas);

  const politica = enumerado(a, "aprovacao", "politica", POLITICAS_APROVACAO, recusas);
  const valorBruto = a?.valorMinimo;
  let valorMinimo: string | null = null;
  // No formato 2 a chave é OBRIGATÓRIA: só `null` explícito ou um valor passam — ausência traduzida para
  // `null` seria aceitar um corpo que o contrato não descreve. O formato 1 mantém a leitura de sempre: é
  // legado para sempre, e versões antigas gravadas sem a chave continuam legíveis.
  if (versao === VERSAO_SCHEMA_CONFIGURACAO_TOP_V2 && a && !("valorMinimo" in a)) {
    recusas.push({ motivo: "tipo_invalido", caminho: "aprovacao.valorMinimo" });
  } else if (valorBruto !== null && valorBruto !== undefined) {
    if (typeof valorBruto !== "string") recusas.push({ motivo: "tipo_invalido", caminho: "aprovacao.valorMinimo" });
    else if (!valorMinimoValido(valorBruto)) recusas.push({ motivo: "valor_invalido", caminho: "aprovacao.valorMinimo" });
    else valorMinimo = valorBruto;
  }
  // "Por valor" sem valor é uma regra que não decide nada: aceitar seria guardar uma aprovação que nunca
  // dispararia, com a tela afirmando que dispara.
  if (politica === "por_valor" && valorMinimo === null) {
    recusas.push({ motivo: "valor_invalido", caminho: "aprovacao.valorMinimo" });
  }

  const secoes: Omit<ConfiguracaoTipoOperacaoV1, "versaoSchema"> = {
    geral: {
      confirmacao: enumerado(g, "geral", "confirmacao", MODOS_CONFIRMACAO, recusas),
      exigeParceiro: booleano(g, "geral", "exigeParceiro", recusas),
      exigeCentroResultado: booleano(g, "geral", "exigeCentroResultado", recusas),
      exigeObservacao: booleano(g, "geral", "exigeObservacao", recusas),
      alteracaoAposConfirmacao: enumerado(g, "geral", "alteracaoAposConfirmacao", POLITICAS_ALTERACAO, recusas),
      documentoSemItens: enumerado(g, "geral", "documentoSemItens", POLITICAS_DOCUMENTO_SEM_ITENS, recusas),
    },
    estoque: {
      atualizacao: enumerado(e, "estoque", "atualizacao", ATUALIZACOES_ESTOQUE, recusas),
      momento: enumerado(e, "estoque", "momento", MOMENTOS_EFEITO, recusas),
      exigeArmazem: booleano(e, "estoque", "exigeArmazem", recusas),
      saldoNegativo: enumerado(e, "estoque", "saldoNegativo", POLITICAS_SALDO_NEGATIVO, recusas),
    },
    financeiro: {
      atualizacao: enumerado(f, "financeiro", "atualizacao", ATUALIZACOES_FINANCEIRO, recusas),
      modo: enumerado(f, "financeiro", "modo", MODOS_FINANCEIRO, recusas),
      momento: enumerado(f, "financeiro", "momento", MOMENTOS_EFEITO, recusas),
      exigeFormaPagamento: booleano(f, "financeiro", "exigeFormaPagamento", recusas),
      exigeVencimento: booleano(f, "financeiro", "exigeVencimento", recusas),
      exigeCentroResultado: booleano(f, "financeiro", "exigeCentroResultado", recusas),
    },
    fiscal: {
      habilitado: booleano(fi, "fiscal", "habilitado", recusas),
      exigeDocumentoFiscal: booleano(fi, "fiscal", "exigeDocumentoFiscal", recusas),
      exigeNaturezaOperacao: booleano(fi, "fiscal", "exigeNaturezaOperacao", recusas),
      exigeRegraTributaria: booleano(fi, "fiscal", "exigeRegraTributaria", recusas),
      calculoTributario: enumerado(fi, "fiscal", "calculoTributario", CALCULOS_TRIBUTARIOS, recusas),
    },
    aprovacao: { politica, valorMinimo, momento: enumerado(a, "aprovacao", "momento", MOMENTOS_APROVACAO, recusas) },
  };

  if (versao === VERSAO_SCHEMA_CONFIGURACAO_TOP) {
    if (recusas.length) return { ok: false, recusas };
    return { ok: true, valor: normalizarConfiguracaoTop({ versaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP, ...secoes }) };
  }

  const x = secao(bruto, "execucao", recusas);
  conferirChaves(x, "execucao", CHAVES_EXECUCAO, recusas);
  const execucao: ConfiguracaoExecucaoTop = {
    estoque: enumerado(x, "execucao", "estoque", MODOS_EXECUCAO_TOP, recusas),
    financeiro: enumerado(x, "execucao", "financeiro", MODOS_EXECUCAO_TOP, recusas),
  };
  // Só depois de TODAS as recusas: `enumerado` devolve um valor de preenchimento quando recusa, e esse
  // valor não pode escapar daqui como se fosse a decisão do administrador.
  if (recusas.length) return { ok: false, recusas };
  return { ok: true, valor: normalizarConfiguracaoTop({ versaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP_V2, ...secoes, execucao }) };
}

// ---------------------------------------------------------------------------------------------------
// 6. NORMALIZAÇÃO — AS DEPENDÊNCIAS ENTRE CAMPOS, DECIDIDAS NO DOMÍNIO
// ---------------------------------------------------------------------------------------------------

/**
 * Zera o que não pode significar nada, dado o que foi escolhido acima.
 *
 * POR QUE NO DOMÍNIO, E NÃO SÓ NA TELA. A tela desabilita "exigir armazém" quando o estoque está em
 * `nenhuma`, e isso é apresentação — some com um `curl`. Se o campo pendurado chegasse ao banco, duas
 * versões semanticamente idênticas teriam bytes diferentes, o "no-op" pararia de ser detectado e o
 * histórico ganharia versões que não mudaram nada. Normalizar aqui é o que torna a comparação confiável.
 *
 * PRESERVA O FORMATO. Um v2 sai v2, com o `execucao` intocado; um v1 sai v1. Normalizar nunca rebaixa nem
 * promove formato — rebaixar um v2 para v1 apagaria a decisão de execução em silêncio, e promover um v1
 * reescreveria o histórico. `execucao` também não é "normalizada" pela seção: `configurada` com
 * `atualizacao = "nenhuma"` é uma decisão legítima (a venda não movimenta), não um campo pendurado.
 *
 * IDEMPOTENTE: normalizar duas vezes dá o mesmo resultado. Não muta a entrada.
 */
export function normalizarConfiguracaoTop(c: ConfiguracaoTipoOperacaoV1): ConfiguracaoTipoOperacaoV1;
export function normalizarConfiguracaoTop(c: ConfiguracaoTipoOperacaoV2): ConfiguracaoTipoOperacaoV2;
export function normalizarConfiguracaoTop(c: ConfiguracaoTipoOperacao): ConfiguracaoTipoOperacao;
export function normalizarConfiguracaoTop(c: ConfiguracaoTipoOperacao): ConfiguracaoTipoOperacao {
  const neutro = configuracaoNeutraTop();
  const estoqueLigado = c.estoque.atualizacao !== "nenhuma";
  const financeiroLigado = c.financeiro.atualizacao !== "nenhuma";
  const fiscalLigado = c.fiscal.habilitado;
  const porValor = c.aprovacao.politica === "por_valor";

  const secoes: Omit<ConfiguracaoTipoOperacaoV1, "versaoSchema"> = {
    geral: { ...c.geral },
    estoque: estoqueLigado
      ? { ...c.estoque }
      : { ...neutro.estoque, atualizacao: "nenhuma" },
    financeiro: financeiroLigado
      ? { ...c.financeiro }
      : { ...neutro.financeiro, atualizacao: "nenhuma" },
    fiscal: fiscalLigado
      ? { ...c.fiscal }
      : { ...neutro.fiscal, habilitado: false },
    aprovacao: {
      politica: c.aprovacao.politica,
      valorMinimo: porValor ? c.aprovacao.valorMinimo : null,
      momento: c.aprovacao.momento,
    },
  };
  return c.versaoSchema === VERSAO_SCHEMA_CONFIGURACAO_TOP_V2
    ? { versaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP_V2, ...secoes, execucao: { estoque: c.execucao.estoque, financeiro: c.execucao.financeiro } }
    : { versaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP, ...secoes };
}

// ---------------------------------------------------------------------------------------------------
// 6b. A EXECUÇÃO — A ÚNICA LEITURA DE "QUEM TEM AUTORIDADE SOBRE O EFEITO"
// ---------------------------------------------------------------------------------------------------

/**
 * O que a configuração decide sobre a execução de cada efeito.
 *
 * FORMATO 1 = LEGADO, SEMPRE, SEJA QUAL FOR O CONTEÚDO. É a regra histórica da TOP-CONFIG-04A: as
 * versões do formato 1 foram gravadas quando os campos eram só declaração, e ler `estoque.atualizacao`
 * delas como decisão atribuiria a documentos antigos uma intenção que ninguém tomou. Esta função NÃO olha
 * as seções do formato 1 — e é por isso que ela é a única que qualquer consumidor pode chamar.
 */
export function execucaoDeclaradaTop(c: ConfiguracaoTipoOperacao): ConfiguracaoExecucaoTop {
  return c.versaoSchema === VERSAO_SCHEMA_CONFIGURACAO_TOP_V2
    ? { estoque: c.execucao.estoque, financeiro: c.execucao.financeiro }
    : execucaoLegada();
}

/** O efeito de ESTOQUE está sob a autoridade desta configuração? */
export const estoqueSobConfiguracaoTop = (c: ConfiguracaoTipoOperacao): boolean =>
  execucaoDeclaradaTop(c).estoque === "configurada";

/** O efeito FINANCEIRO está sob a autoridade desta configuração? */
export const financeiroSobConfiguracaoTop = (c: ConfiguracaoTipoOperacao): boolean =>
  execucaoDeclaradaTop(c).financeiro === "configurada";

/** Algum efeito está sob a autoridade desta configuração? */
export const declaraExecucaoConfiguradaTop = (c: ConfiguracaoTipoOperacao): boolean =>
  estoqueSobConfiguracaoTop(c) || financeiroSobConfiguracaoTop(c);

/**
 * A configuração no formato 2, PARA EXIBIR E EDITAR — nunca para gravar por conta própria.
 *
 * O formato 1 vira o formato 2 com os dois efeitos em `legado`, que é exatamente o que ele significa. Esta
 * leitura não regrava nada: a versão v1 continua v1 no banco, e só uma edição DE VERDADE (nome, descrição,
 * configuração ou execução) cria a versão seguinte, já no formato 2. Não muta a entrada.
 */
export function configuracaoTopParaEdicao(c: ConfiguracaoTipoOperacao): ConfiguracaoTipoOperacaoV2 {
  const n = normalizarConfiguracaoTop(c);
  return n.versaoSchema === VERSAO_SCHEMA_CONFIGURACAO_TOP_V2
    ? n
    : { ...n, versaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP_V2, execucao: execucaoLegada() };
}

// ---------------------------------------------------------------------------------------------------
// 7. IGUALDADE SEMÂNTICA E DIFERENÇA POR SEÇÃO
// ---------------------------------------------------------------------------------------------------

/**
 * Serializa com as chaves em ORDEM CANÔNICA.
 *
 * `JSON.stringify` preserva a ordem de inserção, então `{a:1,b:2}` e `{b:2,a:1}` geram strings diferentes
 * para o mesmo significado. Sem isto, salvar sem mexer em nada criaria uma versão nova só porque o cliente
 * montou o objeto noutra ordem — e o histórico encheria de versões idênticas.
 */
function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/**
 * Duas configurações significam a mesma coisa? Compara DEPOIS de normalizar as duas, e no formato 2.
 *
 * NO FORMATO 2 DE PROPÓSITO: um v1 e um v2 com os dois efeitos em `legado` e as mesmas seções SIGNIFICAM a
 * mesma coisa. Compará-los como diferentes faria o editor novo, ao salvar sem mexer numa TOP v1, criar a
 * versão N+1 só para trocar o formato — e "salvar sem alterar não é escrita" deixaria de valer.
 */
export const configuracoesTopIguais = (a: ConfiguracaoTipoOperacao, b: ConfiguracaoTipoOperacao): boolean =>
  canonico(configuracaoTopParaEdicao(a)) === canonico(configuracaoTopParaEdicao(b));

/**
 * Quais seções mudaram, para a auditoria.
 *
 * Diferença de ALTO NÍVEL de propósito: registrar o payload inteiro a cada edição encheria a auditoria de
 * ruído e transformaria o log numa segunda cópia da configuração — que envelhece em silêncio e diverge da
 * versão, que é a verdade. `["estoque","fiscal"]` responde a pergunta que se faz numa investigação ("o que
 * mexeram?") e manda o leitor à versão para o detalhe exato. `execucao` aparece quando um efeito trocou de
 * autoridade (legado ↔ configurada) — é a linha que identifica o cutover no histórico.
 */
export function secoesAlteradasTop(
  antes: ConfiguracaoTipoOperacao,
  depois: ConfiguracaoTipoOperacao,
): SecaoConfiguracaoTopV2[] {
  const a = configuracaoTopParaEdicao(antes);
  const b = configuracaoTopParaEdicao(depois);
  return SECOES_CONFIGURACAO_TOP_V2.filter((s) => canonico(a[s]) !== canonico(b[s]));
}

/** A configuração está no neutro? Usado pela tela para dizer "nada configurado" sem repetir o literal. */
export const configuracaoTopEhNeutra = (c: ConfiguracaoTipoOperacao): boolean =>
  configuracoesTopIguais(c, configuracaoNeutraTop());
