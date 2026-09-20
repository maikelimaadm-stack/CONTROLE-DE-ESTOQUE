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
 * ┌─ CONFIGURAR ≠ EXECUTAR (a fronteira desta fatia) ───────────────────────────────────────────────────┐
 * │ Nada aqui move estoque, gera título, calcula imposto ou aprova documento. A TOP-CONFIG-03 ensina o │
 * │ sistema a GUARDAR e VERSIONAR a intenção; ligar os efeitos é a TOP-CONFIG-04, e ela terá contrato  │
 * │ de cutover próprio. Por isso `estoque.atualizacao = "saida"` hoje não baixa nada: é uma declaração │
 * │ sem consumidor, e está escrito assim em `docs/TIPO-OPERACAO-CONTRACT.md` para que ninguém leia a    │
 * │ presença do campo como promessa de comportamento.                                                   │
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

/** A ÚNICA versão de schema que este código sabe ler e escrever. */
export const VERSAO_SCHEMA_CONFIGURACAO_TOP = 1 as const;

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
  | { ok: true; valor: ConfiguracaoTipoOperacaoV1 }
  | { ok: false; recusas: RecusaConfiguracaoTop[] };

/** Lê uma seção objeto, acumulando recusa se ela faltar ou não for objeto. */
function secao(
  raiz: Record<string, unknown>,
  nome: SecaoConfiguracaoTop,
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

const CHAVES_RAIZ = ["versaoSchema", ...SECOES_CONFIGURACAO_TOP] as const;
const CHAVES_GERAL = ["confirmacao", "exigeParceiro", "exigeCentroResultado", "exigeObservacao", "alteracaoAposConfirmacao", "documentoSemItens"] as const;
const CHAVES_ESTOQUE = ["atualizacao", "momento", "exigeArmazem", "saldoNegativo"] as const;
const CHAVES_FINANCEIRO = ["atualizacao", "modo", "momento", "exigeFormaPagamento", "exigeVencimento", "exigeCentroResultado"] as const;
const CHAVES_FISCAL = ["habilitado", "exigeDocumentoFiscal", "exigeNaturezaOperacao", "exigeRegraTributaria", "calculoTributario"] as const;
const CHAVES_APROVACAO = ["politica", "valorMinimo", "momento"] as const;

/**
 * Transforma `unknown` em configuração v1 PROVADA, ou devolve as recusas.
 *
 * O corpo que chega do cliente — e o que volta do banco — é `unknown` até aqui. Uma asserção de tipo
 * (`as ConfiguracaoTipoOperacaoV1`) seria uma promessa do TypeScript que o runtime não cumpre: o
 * compilador já terminou o trabalho dele quando o JSON chega.
 *
 * NÃO MUTA a entrada e NÃO devolve referência a ela: o resultado é construído campo a campo, então quem
 * chamou pode continuar usando o objeto original sem descobrir que ele mudou de forma.
 */
export function lerConfiguracaoTop(bruto: unknown): ResultadoConfiguracaoTop {
  const recusas: RecusaConfiguracaoTop[] = [];

  if (!ehObjeto(bruto)) return { ok: false, recusas: [{ motivo: "tipo_invalido", caminho: "" }] };

  // O SCHEMA PRIMEIRO. Ler os campos de um payload cuja versão não se conhece seria interpretar bytes com
  // o dicionário errado — e é assim que um "2" vira "1" em silêncio.
  if (bruto.versaoSchema !== VERSAO_SCHEMA_CONFIGURACAO_TOP) {
    return { ok: false, recusas: [{ motivo: "schema_nao_suportado", caminho: "versaoSchema" }] };
  }

  for (const k of chavesDesconhecidas(bruto, CHAVES_RAIZ)) {
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
  if (valorBruto !== null && valorBruto !== undefined) {
    if (typeof valorBruto !== "string") recusas.push({ motivo: "tipo_invalido", caminho: "aprovacao.valorMinimo" });
    else if (!valorMinimoValido(valorBruto)) recusas.push({ motivo: "valor_invalido", caminho: "aprovacao.valorMinimo" });
    else valorMinimo = valorBruto;
  }
  // "Por valor" sem valor é uma regra que não decide nada: aceitar seria guardar uma aprovação que nunca
  // dispararia, com a tela afirmando que dispara.
  if (politica === "por_valor" && valorMinimo === null) {
    recusas.push({ motivo: "valor_invalido", caminho: "aprovacao.valorMinimo" });
  }

  const candidato: ConfiguracaoTipoOperacaoV1 = {
    versaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP,
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

  if (recusas.length) return { ok: false, recusas };
  return { ok: true, valor: normalizarConfiguracaoTop(candidato) };
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
 * IDEMPOTENTE: normalizar duas vezes dá o mesmo resultado. Não muta a entrada.
 */
export function normalizarConfiguracaoTop(c: ConfiguracaoTipoOperacaoV1): ConfiguracaoTipoOperacaoV1 {
  const neutro = configuracaoNeutraTop();
  const estoqueLigado = c.estoque.atualizacao !== "nenhuma";
  const financeiroLigado = c.financeiro.atualizacao !== "nenhuma";
  const fiscalLigado = c.fiscal.habilitado;
  const porValor = c.aprovacao.politica === "por_valor";

  return {
    versaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP,
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

/** Duas configurações significam a mesma coisa? Compara DEPOIS de normalizar as duas. */
export const configuracoesTopIguais = (a: ConfiguracaoTipoOperacaoV1, b: ConfiguracaoTipoOperacaoV1): boolean =>
  canonico(normalizarConfiguracaoTop(a)) === canonico(normalizarConfiguracaoTop(b));

/**
 * Quais seções mudaram, para a auditoria.
 *
 * Diferença de ALTO NÍVEL de propósito: registrar o payload inteiro a cada edição encheria a auditoria de
 * ruído e transformaria o log numa segunda cópia da configuração — que envelhece em silêncio e diverge da
 * versão, que é a verdade. `["estoque","fiscal"]` responde a pergunta que se faz numa investigação ("o que
 * mexeram?") e manda o leitor à versão para o detalhe exato.
 */
export function secoesAlteradasTop(
  antes: ConfiguracaoTipoOperacaoV1,
  depois: ConfiguracaoTipoOperacaoV1,
): SecaoConfiguracaoTop[] {
  const a = normalizarConfiguracaoTop(antes);
  const b = normalizarConfiguracaoTop(depois);
  return SECOES_CONFIGURACAO_TOP.filter((s) => canonico(a[s]) !== canonico(b[s]));
}

/** A configuração está no neutro? Usado pela tela para dizer "nada configurado" sem repetir o literal. */
export const configuracaoTopEhNeutra = (c: ConfiguracaoTipoOperacaoV1): boolean =>
  configuracoesTopIguais(c, configuracaoNeutraTop());
