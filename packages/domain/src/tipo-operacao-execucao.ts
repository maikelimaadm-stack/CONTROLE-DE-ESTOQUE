/**
 * A EXECUÇÃO CONFIGURADA DA TOP — MATRIZ DE SUPORTE E POLÍTICA EFETIVA DA VENDA (TOP-CONFIG-04A).
 *
 * ┌─ O QUE ESTE ARQUIVO É ─────────────────────────────────────────────────────────────────────────────┐
 * │ Duas respostas, as duas PURAS (sem banco, sem ambiente, sem relógio):                              │
 * │                                                                                                     │
 * │ 1. A MATRIZ DE SUPORTE responde uma pergunta só: "esta combinação configurada já é executável      │
 * │    nesta versão do produto?". Ela NÃO executa, NÃO é handler e NÃO substitui o registry de         │
 * │    famílias — é uma tabela de valores aceitos, lida por um validador.                              │
 * │                                                                                                     │
 * │ 2. A POLÍTICA EFETIVA DA VENDA traduz a versão congelada do documento numa decisão tipada          │
 * │    (legado / nenhum / saída; legado / nenhum / receber) que o SERVIÇO DE VENDAS executa.           │
 * │    A TOP diz a política; a venda executa a venda.                                                   │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ O QUE ELE DELIBERADAMENTE NÃO É ──────────────────────────────────────────────────────────────────┐
 * │ Não há `executar(top, documento)`, callback, SQL, expressão nem despacho por família aqui. Um motor│
 * │ genérico transformaria a configuração em programação e cada família nova em risco de regressão das │
 * │ outras. A próxima família que ganhar execução configurada ganha UMA entrada na matriz e UM         │
 * │ resolvedor tipado para o SEU serviço — o contrato (formato 2, matriz, recusa) é o mesmo.            │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POR QUE A MATRIZ RECUSA O QUE RECUSA (confirmado contra o código real) ───────────────────────────┐
 * │ saldo negativo "Permitir"  o gatilho `erp.apply_stock_movement` recusa TODA saída sem saldo         │
 * │                            (INSUFFICIENT_STOCK). Não existe caminho honesto para permitir, e       │
 * │                            contornar o gatilho seria desligar a invariante do estoque.             │
 * │ modo "Previsão"            `erp.financial_titles` não tem estado de previsão; o título nasce firme. │
 * │ exigir centro de resultado a venda não tem campo de centro: a exigência não teria como ser cumprida,│
 * │                            e inventar um centro padrão seria decidir pelo usuário.                 │
 * │ entrada / transferência    a confirmação de venda só sabe dar SAÍDA.                                │
 * │ "A pagar"                  venda gera conta a RECEBER; o sentido oposto não tem executor aqui.      │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import { familiaOperacionalDeDocumentoCompra, familiaOperacionalDeDocumentoVenda } from "./tipo-operacao-configurado.js";
import {
  ATUALIZACOES_ESTOQUE,
  ATUALIZACOES_FINANCEIRO,
  MODOS_FINANCEIRO,
  MOMENTOS_EFEITO,
  POLITICAS_SALDO_NEGATIVO,
  VERSAO_SCHEMA_CONFIGURACAO_TOP,
  VERSAO_SCHEMA_CONFIGURACAO_TOP_V2,
  configuracaoNeutraTopV2,
  configuracaoTopParaEdicao,
  execucaoDeclaradaTop,
  lerConfiguracaoTop,
  normalizarConfiguracaoTop,
  secoesAlteradasTop,
  versaoSchemaDaConfiguracaoTop,
  type ConfiguracaoEstoqueV1,
  type ConfiguracaoFinanceiroV1,
  type ConfiguracaoTipoOperacao,
  type VersaoSchemaConfiguracaoTop,
} from "./tipo-operacao-configuracao.js";

/** Os efeitos que a execução configurada pode assumir. Fiscal e aprovação continuam só declarados. */
export const EFEITOS_EXECUCAO_TOP = ["estoque", "financeiro"] as const;
export type EfeitoExecucaoTop = (typeof EFEITOS_EXECUCAO_TOP)[number];

// ---------------------------------------------------------------------------------------------------
// 1. A MATRIZ DE SUPORTE
// ---------------------------------------------------------------------------------------------------

/** O que um campo aceita sob execução configurada e, quando recusa, a explicação para quem configura. */
export interface RegraCampoExecucaoTop<T> {
  aceitos: readonly T[];
  /** Obrigatória quando `aceitos` não cobre o domínio inteiro do campo (coberto por teste). */
  motivo?: string;
}

/** Uma regra por CAMPO da seção — o tipo obriga a matriz a declarar todos, sem campo esquecido. */
export type RegrasSecaoExecucaoTop<S> = { readonly [K in keyof S]: RegraCampoExecucaoTop<S[K]> };

export interface SuporteExecucaoFamiliaTop {
  familia: string;
  estoque: RegrasSecaoExecucaoTop<ConfiguracaoEstoqueV1>;
  financeiro: RegrasSecaoExecucaoTop<ConfiguracaoFinanceiroV1>;
}

/** A mensagem de família sem consumidor. Uma só, dita igual na API e na tela. */
export const MENSAGEM_FAMILIA_SEM_EXECUCAO_TOP = "Execução configurada ainda não disponível para este movimento.";

const MENSAGEM_CAMPO_SEM_REGRA = "Este campo ainda não tem execução configurada nesta versão do produto.";

/**
 * A família dos documentos que `confirmSale` confirma — perguntada ao registry pela variante, nunca
 * escrita aqui (`familia-operacional-ssot-audit`). Se o registry deixar de declarar a variante, a matriz
 * fica vazia e toda ativação é recusada: fail-closed.
 */
const FAMILIA_DA_VENDA = familiaOperacionalDeDocumentoVenda("sale");

const SUPORTE_DA_VENDA = (familia: string): SuporteExecucaoFamiliaTop => ({
  familia,
  estoque: {
    atualizacao: {
      aceitos: ["nenhuma", "saida"],
      motivo: "Na venda, o estoque configurado só executa \"Saída\" ou \"Não movimenta estoque\": a confirmação da venda não sabe dar entrada nem transferir.",
    },
    momento: { aceitos: MOMENTOS_EFEITO },
    exigeArmazem: { aceitos: [false, true] },
    saldoNegativo: {
      aceitos: ["bloquear"],
      motivo: "Saldo negativo \"Permitir\" não tem execução real: o estoque recusa toda saída sem saldo, e a configuração não pode prometer o contrário.",
    },
  },
  financeiro: {
    atualizacao: {
      aceitos: ["nenhuma", "receber"],
      motivo: "Na venda, o financeiro configurado só executa \"A receber\" ou \"Não gera efeito financeiro\": venda não gera conta a pagar.",
    },
    modo: {
      aceitos: ["incluir"],
      motivo: "O modo \"Previsão\" não tem execução real: o financeiro só gera título firme.",
    },
    momento: { aceitos: MOMENTOS_EFEITO },
    exigeFormaPagamento: { aceitos: [false, true] },
    exigeVencimento: { aceitos: [false, true] },
    exigeCentroResultado: {
      aceitos: [false],
      motivo: "A venda não tem campo de centro de resultado, então exigir o centro não teria como ser cumprido.",
    },
  },
});

/**
 * COMPRAS-01 (decisão 267): a família da Compra — a espécie que a confirmação de compra confirma. O pedido
 * de compra NÃO entra na matriz: ele não confirma nada, e a intenção declarada nele continua só declarada.
 */
const FAMILIA_DA_COMPRA = familiaOperacionalDeDocumentoCompra("compra");

const SUPORTE_DA_COMPRA = (familia: string): SuporteExecucaoFamiliaTop => ({
  familia,
  estoque: {
    atualizacao: {
      aceitos: ["nenhuma", "entrada"],
      motivo: "Na compra, o estoque configurado só executa \"Entrada\" ou \"Não movimenta estoque\": a confirmação da compra não sabe dar saída nem transferir.",
    },
    momento: { aceitos: MOMENTOS_EFEITO },
    exigeArmazem: { aceitos: [false, true] },
    saldoNegativo: {
      aceitos: ["bloquear"],
      motivo: "Saldo negativo \"Permitir\" não tem execução real: o estoque recusa toda saída sem saldo, e a configuração não pode prometer o contrário.",
    },
  },
  financeiro: {
    atualizacao: {
      aceitos: ["nenhuma", "pagar"],
      motivo: "Na compra, o financeiro configurado só executa \"A pagar\" ou \"Não gera efeito financeiro\": compra não gera conta a receber.",
    },
    modo: {
      aceitos: ["incluir"],
      motivo: "O modo \"Previsão\" não tem execução real: o financeiro só gera título firme.",
    },
    momento: { aceitos: MOMENTOS_EFEITO },
    exigeFormaPagamento: { aceitos: [false, true] },
    exigeVencimento: { aceitos: [false, true] },
    exigeCentroResultado: { aceitos: [false, true] },
  },
});

/**
 * A MATRIZ. A venda (primeiro consumidor real, SEMPRE a primeira entrada) e a compra (COMPRAS-01). Qualquer
 * família fora daqui não pode ativar execução configurada, e isso inclui orçamento, pedido de venda e pedido
 * de compra: a intenção declarada neles continua só declarada.
 */
export const MATRIZ_EXECUCAO_TOP: readonly SuporteExecucaoFamiliaTop[] = Object.freeze([
  ...(FAMILIA_DA_VENDA ? [SUPORTE_DA_VENDA(FAMILIA_DA_VENDA)] : []),
  ...(FAMILIA_DA_COMPRA ? [SUPORTE_DA_COMPRA(FAMILIA_DA_COMPRA)] : []),
]);

/** A família aceita execução configurada em algum efeito? */
export const familiaAceitaExecucaoConfiguradaTop = (
  codigoBase: string,
  matriz: readonly SuporteExecucaoFamiliaTop[] = MATRIZ_EXECUCAO_TOP,
): boolean => matriz.some((m) => m.familia === codigoBase);

// ---------------------------------------------------------------------------------------------------
// 2. A VALIDAÇÃO DA ATIVAÇÃO
// ---------------------------------------------------------------------------------------------------

export interface RecusaExecucaoTop {
  motivo: "familia_sem_execucao_configurada" | "combinacao_nao_suportada";
  /** A coordenada do problema, para a tela apontar o campo (`"estoque.saldoNegativo"`). */
  caminho: string;
  /** Em português, sem valor técnico cru. */
  mensagem: string;
}

/**
 * A configuração, como está, pode ser EXECUTADA? Devolve TODAS as recusas, determinísticas e na ordem das
 * seções, ou `[]`.
 *
 * Só olha os efeitos em `configurada`. Um efeito em `legado` não promete nada da seção dele — a seção
 * continua sendo declaração —, então recusá-la por uma combinação que ninguém vai executar seria bloquear
 * a edição de TOPs que nunca pediram execução.
 *
 * `matriz` é parâmetro para a tela poder avaliar contra a matriz QUE O SERVIDOR DECLAROU (a autoridade),
 * e não contra a que veio no pacote dela — as duas podem divergir no meio de uma implantação.
 */
/**
 * TOP-CONFIG-05 (decisão 263): chaves do formato 3 que moram na seção do efeito mas NÃO são parte do efeito —
 * são RESTRIÇÕES do lançamento (cliente em atraso), executadas por `cobrarRegrasDaOperacao`, e valem com o efeito
 * em legado ou configurado. Lista FECHADA e explícita: qualquer outro campo sem regra continua recusado (fail-closed).
 */
const CAMPOS_DE_RESTRICAO_FORA_DO_EFEITO: Readonly<Partial<Record<string, readonly string[]>>> = Object.freeze({
  financeiro: ["clienteEmAtraso", "toleranciaAtrasoDias"],
});

export function validarExecucaoTop(
  codigoBase: string,
  configuracao: ConfiguracaoTipoOperacao,
  matriz: readonly SuporteExecucaoFamiliaTop[] = MATRIZ_EXECUCAO_TOP,
): RecusaExecucaoTop[] {
  const c = normalizarConfiguracaoTop(configuracao);
  const execucao = execucaoDeclaradaTop(c);
  const configurados = EFEITOS_EXECUCAO_TOP.filter((e) => execucao[e] === "configurada");
  if (!configurados.length) return [];

  const suporte = matriz.find((m) => m.familia === codigoBase);
  if (!suporte) {
    return configurados.map((e) => ({ motivo: "familia_sem_execucao_configurada", caminho: `execucao.${e}`, mensagem: MENSAGEM_FAMILIA_SEM_EXECUCAO_TOP }));
  }

  const recusas: RecusaExecucaoTop[] = [];
  for (const efeito of configurados) {
    const foraDoEfeito: readonly string[] = CAMPOS_DE_RESTRICAO_FORA_DO_EFEITO[efeito] ?? [];
    const secao = c[efeito] as unknown as Record<string, unknown>;
    const regras = suporte[efeito] as unknown as Record<string, RegraCampoExecucaoTop<unknown> | undefined>;
    // Percorre os campos da SEÇÃO, não os da regra: campo sem regra é recusado (fail-closed), nunca
    // aceito por omissão.
    for (const campo of Object.keys(secao)) {
      if (foraDoEfeito.includes(campo)) continue;
      const regra = regras[campo];
      if (regra && regra.aceitos.includes(secao[campo])) continue;
      recusas.push({ motivo: "combinacao_nao_suportada", caminho: `${efeito}.${campo}`, mensagem: regra?.motivo ?? MENSAGEM_CAMPO_SEM_REGRA });
    }
  }
  return recusas;
}

/**
 * Quais efeitos esta gravação ATIVA — o que o gate operacional desligado proíbe.
 *
 * Ativar é pôr execução configurada NOVA em circulação: um efeito passar para `configurada`, ou continuar
 * `configurada` com a seção dele alterada (mudar o que a configuração executa). NÃO é ativação voltar para
 * `legado`, renomear, nem mexer numa seção que nenhum efeito configurado executa — com o gate desligado,
 * reduzir o risco tem de continuar possível. `vigente` nulo é a criação: parte do neutro.
 */
export function efeitosAtivadosTop(
  vigente: ConfiguracaoTipoOperacao | null,
  pedida: ConfiguracaoTipoOperacao,
): EfeitoExecucaoTop[] {
  const antes = configuracaoTopParaEdicao(vigente ?? configuracaoNeutraTopV2());
  const depois = configuracaoTopParaEdicao(pedida);
  const alteradas = secoesAlteradasTop(antes, depois);
  return EFEITOS_EXECUCAO_TOP.filter((e) => depois.execucao[e] === "configurada"
    && (antes.execucao[e] !== "configurada" || alteradas.includes(e)));
}

// ---------------------------------------------------------------------------------------------------
// 3. A MATRIZ COMO CONTRATO (o servidor declara; a tela lê)
// ---------------------------------------------------------------------------------------------------

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** O domínio de cada campo, para a leitura estrita da matriz declarada pelo servidor. */
const DOMINIO_ESTOQUE: { readonly [K in keyof ConfiguracaoEstoqueV1]: readonly unknown[] } = {
  atualizacao: ATUALIZACOES_ESTOQUE,
  momento: MOMENTOS_EFEITO,
  exigeArmazem: [false, true],
  saldoNegativo: POLITICAS_SALDO_NEGATIVO,
};
const DOMINIO_FINANCEIRO: { readonly [K in keyof ConfiguracaoFinanceiroV1]: readonly unknown[] } = {
  atualizacao: ATUALIZACOES_FINANCEIRO,
  modo: MODOS_FINANCEIRO,
  momento: MOMENTOS_EFEITO,
  exigeFormaPagamento: [false, true],
  exigeVencimento: [false, true],
  exigeCentroResultado: [false, true],
};

function lerRegras<S>(bruto: unknown, dominio: { readonly [K in keyof S]: readonly unknown[] }): RegrasSecaoExecucaoTop<S> | null {
  if (!ehObjeto(bruto)) return null;
  const campos = Object.keys(dominio);
  if (Object.keys(bruto).length !== campos.length) return null;
  const regras: Record<string, RegraCampoExecucaoTop<unknown>> = {};
  for (const campo of campos) {
    const r = bruto[campo];
    if (!ehObjeto(r) || !Array.isArray(r.aceitos)) return null;
    if (Object.keys(r).some((k) => k !== "aceitos" && k !== "motivo")) return null;
    const permitidos = (dominio as Record<string, readonly unknown[]>)[campo]!;
    if (!r.aceitos.every((v) => permitidos.includes(v))) return null;
    if (r.motivo !== undefined && typeof r.motivo !== "string") return null;
    regras[campo] = r.motivo === undefined ? { aceitos: [...r.aceitos] } : { aceitos: [...r.aceitos], motivo: r.motivo };
  }
  return regras as unknown as RegrasSecaoExecucaoTop<S>;
}

/**
 * Lê ESTRITAMENTE a matriz que o servidor declarou. Qualquer desvio devolve `null` — a tela então trata a
 * execução como não suportada, em vez de adivinhar um pedaço da matriz.
 */
export function lerMatrizExecucaoTop(bruto: unknown): SuporteExecucaoFamiliaTop[] | null {
  if (!Array.isArray(bruto)) return null;
  const matriz: SuporteExecucaoFamiliaTop[] = [];
  for (const item of bruto) {
    if (!ehObjeto(item) || typeof item.familia !== "string" || Object.keys(item).length !== 3) return null;
    const estoque = lerRegras<ConfiguracaoEstoqueV1>(item.estoque, DOMINIO_ESTOQUE);
    const financeiro = lerRegras<ConfiguracaoFinanceiroV1>(item.financeiro, DOMINIO_FINANCEIRO);
    if (!estoque || !financeiro) return null;
    matriz.push({ familia: item.familia, estoque, financeiro });
  }
  return matriz;
}

// ---------------------------------------------------------------------------------------------------
// 4. A POLÍTICA EFETIVA DA VENDA — resolvida UMA vez, executada pelo serviço de vendas
// ---------------------------------------------------------------------------------------------------

/** Estoque da confirmação da venda. */
export type PoliticaEstoqueDaVenda =
  | { autoridade: "legado" }
  | { autoridade: "configurada"; efeito: "nenhum" }
  | { autoridade: "configurada"; efeito: "saida"; exigeArmazem: boolean };

/** Financeiro da confirmação da venda. */
export type PoliticaFinanceiroDaVenda =
  | { autoridade: "legado" }
  | { autoridade: "configurada"; efeito: "nenhum" }
  | { autoridade: "configurada"; efeito: "receber"; exigeFormaPagamento: boolean; exigeVencimento: boolean };

export interface PoliticaEfetivaDaVenda {
  /** De onde a decisão veio: documento sem TOP, ou o formato da versão congelada. */
  origem: "sem_top" | VersaoSchemaConfiguracaoTop;
  estoque: PoliticaEstoqueDaVenda;
  financeiro: PoliticaFinanceiroDaVenda;
}

/**
 * Por que a política NÃO pôde ser resolvida. Em qualquer um destes casos a confirmação PARA antes do
 * primeiro efeito — nunca cai para o legado.
 *
 * `configuracao_ilegivel`  a versão congelada tem um formato que este código não lê, ou um formato 2
 *                          malformado: ninguém sabe o que ela decidiu.
 * `execucao_desligada`     a versão declara execução configurada e esta instância não a executa.
 * `execucao_nao_suportada` a versão declara uma combinação fora da matriz (só alcançável por linha
 *                          escrita fora da API, porque a ativação já recusa).
 */
export type ResultadoPoliticaDaVenda =
  | { ok: true; politica: PoliticaEfetivaDaVenda }
  | { ok: false; motivo: "configuracao_ilegivel" | "execucao_desligada" | "execucao_nao_suportada"; recusas: RecusaExecucaoTop[] };

export interface EntradaPoliticaDaVenda {
  /** A versão que o DOCUMENTO cita (`tipo_operacao_versao_id`) — nunca a versão corrente da TOP. `null` = sem TOP. */
  versaoCongelada: { codigoBase: string; configuracao: unknown } | null;
  /** O gate operacional desta instância. Parâmetro, e não leitura de ambiente: o domínio não faz E/S. */
  execucaoConfiguradaHabilitada: boolean;
  /** A matriz vigente. Parâmetro só para teste; em produção é sempre a do produto. */
  matriz?: readonly SuporteExecucaoFamiliaTop[];
}

const LEGADO: Pick<PoliticaEfetivaDaVenda, "estoque" | "financeiro"> = Object.freeze({
  estoque: Object.freeze({ autoridade: "legado" as const }),
  financeiro: Object.freeze({ autoridade: "legado" as const }),
});

/**
 * A política de estoque e financeiro que a confirmação DESTA venda executa.
 *
 * A ordem das perguntas é a regra:
 *   1. sem versão congelada          → legado (acervo e cliente anterior à TOP);
 *   2. formato 1                     → legado, SEM LER AS SEÇÕES (a regra histórica da TOP-CONFIG-04A);
 *   3. formato desconhecido/ilegível → recusa;
 *   4. formato 2 sem nada configurado → legado;
 *   5. algo configurado e gate desligado → recusa (nunca legado);
 *   6. combinação fora da matriz     → recusa;
 *   7. o resto vira decisão tipada, efeito a efeito.
 */
export function resolverPoliticaEfetivaDaVenda(entrada: EntradaPoliticaDaVenda): ResultadoPoliticaDaVenda {
  const { versaoCongelada, execucaoConfiguradaHabilitada } = entrada;
  const matriz = entrada.matriz ?? MATRIZ_EXECUCAO_TOP;
  if (!versaoCongelada) return { ok: true, politica: { origem: "sem_top", ...LEGADO } };

  const formato = versaoSchemaDaConfiguracaoTop(versaoCongelada.configuracao);
  if (formato === VERSAO_SCHEMA_CONFIGURACAO_TOP) return { ok: true, politica: { origem: formato, ...LEGADO } };
  if (formato === null) return { ok: false, motivo: "configuracao_ilegivel", recusas: [] };

  const lida = lerConfiguracaoTop(versaoCongelada.configuracao);
  if (!lida.ok) return { ok: false, motivo: "configuracao_ilegivel", recusas: [] };
  const c = lida.valor;
  const execucao = execucaoDeclaradaTop(c);
  if (execucao.estoque === "legado" && execucao.financeiro === "legado") return { ok: true, politica: { origem: formato, ...LEGADO } };

  if (!execucaoConfiguradaHabilitada) return { ok: false, motivo: "execucao_desligada", recusas: [] };

  // A família tem de ser a da venda: esta política é da VENDA, e a entrada de outra família na matriz
  // (quando existir) não autoriza a confirmação de venda a executar nada.
  if (!FAMILIA_DA_VENDA || versaoCongelada.codigoBase !== FAMILIA_DA_VENDA) {
    return {
      ok: false, motivo: "execucao_nao_suportada",
      recusas: EFEITOS_EXECUCAO_TOP.filter((e) => execucao[e] === "configurada")
        .map((e) => ({ motivo: "familia_sem_execucao_configurada", caminho: `execucao.${e}`, mensagem: MENSAGEM_FAMILIA_SEM_EXECUCAO_TOP })),
    };
  }
  const recusas = validarExecucaoTop(versaoCongelada.codigoBase, c, matriz);
  if (recusas.length) return { ok: false, motivo: "execucao_nao_suportada", recusas };

  let estoque: PoliticaEstoqueDaVenda = LEGADO.estoque;
  if (execucao.estoque === "configurada") {
    if (c.estoque.atualizacao === "nenhuma") estoque = { autoridade: "configurada", efeito: "nenhum" };
    else if (c.estoque.atualizacao === "saida") estoque = { autoridade: "configurada", efeito: "saida", exigeArmazem: c.estoque.exigeArmazem };
    else return { ok: false, motivo: "execucao_nao_suportada", recusas: [{ motivo: "combinacao_nao_suportada", caminho: "estoque.atualizacao", mensagem: MENSAGEM_CAMPO_SEM_REGRA }] };
  }
  let financeiro: PoliticaFinanceiroDaVenda = LEGADO.financeiro;
  if (execucao.financeiro === "configurada") {
    if (c.financeiro.atualizacao === "nenhuma") financeiro = { autoridade: "configurada", efeito: "nenhum" };
    else if (c.financeiro.atualizacao === "receber") {
      financeiro = { autoridade: "configurada", efeito: "receber", exigeFormaPagamento: c.financeiro.exigeFormaPagamento, exigeVencimento: c.financeiro.exigeVencimento };
    } else return { ok: false, motivo: "execucao_nao_suportada", recusas: [{ motivo: "combinacao_nao_suportada", caminho: "financeiro.atualizacao", mensagem: MENSAGEM_CAMPO_SEM_REGRA }] };
  }
  return { ok: true, politica: { origem: formato, estoque, financeiro } };
}

/**
 * A confirmação desta venda precisa gravar a marca `app.venda_execucao_configurada`? (TOP-CONFIG-05_R2)
 *
 * ESPELHO DA GUARDA DA 0023 (`erp.venda_execucao_configurada_guarda`). A marca significa "o binário que
 * conhece o formato desta versão resolveu a política" — não "algum efeito é configurado". A guarda só
 * dispensa a marca em dois casos, e esta função diz NÃO exatamente nesses dois:
 *   · sem TOP                          → não (a guarda nem olha);
 *   · formato 1                        → não (legado para sempre);
 *   · formato 2 com legado/legado      → não (legado declarado);
 *   · qualquer outro caso              → SIM: formato 2 com algo configurado, formato 3, 4 ou 5 com QUALQUER
 *                                         execução (inclusive o neutro legado/legado) e formato futuro.
 * Sem a marca no formato 3, a guarda recusa ("formato que este banco ainda não conhece") — e a primeira
 * TOP de venda salva no editor novo não confirmava. O formato 4 (TOP-CONFIG-08) e o 5 (OPERACOES-01 F4, decisão
 * 281) confirmam pela marca, como o 3.
 */
export function confirmacaoExigeMarcaDaGuarda(p: Pick<PoliticaEfetivaDaVenda, "origem" | "estoque" | "financeiro">): boolean {
  if (p.origem === "sem_top" || p.origem === VERSAO_SCHEMA_CONFIGURACAO_TOP) return false;
  if (p.origem === VERSAO_SCHEMA_CONFIGURACAO_TOP_V2 && p.estoque.autoridade === "legado" && p.financeiro.autoridade === "legado") return false;
  return true;
}

/**
 * O resumo da política para a EVIDÊNCIA do documento (auditoria da confirmação): qual autoridade valeu e
 * qual efeito ela pediu, efeito a efeito. Texto estável, para ser comparado por teste e lido numa
 * investigação sem precisar reabrir a versão.
 */
export function resumoDaPoliticaDaVenda(p: PoliticaEfetivaDaVenda): { estoque: string; financeiro: string } {
  return {
    estoque: p.estoque.autoridade === "legado" ? "legado" : `configurada:${p.estoque.efeito}`,
    financeiro: p.financeiro.autoridade === "legado" ? "legado" : `configurada:${p.financeiro.efeito}`,
  };
}

// ---------------------------------------------------------------------------------------------------
// 5. A POLÍTICA EFETIVA DA COMPRA (COMPRAS-01, decisão 267) — gêmea da venda, executada pelo serviço de compras
// ---------------------------------------------------------------------------------------------------

/**
 * Estoque da confirmação da compra. `padrao` é o "legado" da compra: a compra não tem acervo anterior à
 * TOP, então o que vale sem configuração é o PADRÃO — entrada dos itens com armazém.
 */
export type PoliticaEstoqueDaCompra =
  | { autoridade: "padrao" }
  | { autoridade: "configurada"; efeito: "nenhum" }
  | { autoridade: "configurada"; efeito: "entrada"; exigeArmazem: boolean };

/** Financeiro da confirmação da compra. `padrao` = conta a pagar do total. */
export type PoliticaFinanceiroDaCompra =
  | { autoridade: "padrao" }
  | { autoridade: "configurada"; efeito: "nenhum" }
  | { autoridade: "configurada"; efeito: "pagar"; exigeFormaPagamento: boolean; exigeVencimento: boolean; exigeCentroResultado: boolean };

export interface PoliticaEfetivaDaCompra {
  origem: "sem_top" | VersaoSchemaConfiguracaoTop;
  estoque: PoliticaEstoqueDaCompra;
  financeiro: PoliticaFinanceiroDaCompra;
}

export type ResultadoPoliticaDaCompra =
  | { ok: true; politica: PoliticaEfetivaDaCompra }
  | { ok: false; motivo: "configuracao_ilegivel" | "execucao_desligada" | "execucao_nao_suportada"; recusas: RecusaExecucaoTop[] };

/** Mesma entrada da venda: a versão congelada do documento, o gate operacional e (só em teste) a matriz. */
export type EntradaPoliticaDaCompra = EntradaPoliticaDaVenda;

const PADRAO_DA_COMPRA: Pick<PoliticaEfetivaDaCompra, "estoque" | "financeiro"> = Object.freeze({
  estoque: Object.freeze({ autoridade: "padrao" as const }),
  financeiro: Object.freeze({ autoridade: "padrao" as const }),
});

/**
 * A política de estoque e financeiro que a confirmação DESTA compra executa. MESMA ordem de perguntas e
 * MESMAS recusas de `resolverPoliticaEfetivaDaVenda`; só muda o que "legado" significa (aqui: o padrão da
 * compra — entrada dos itens com armazém e conta a pagar do total) e os efeitos aceitos (entrada / pagar).
 *   1. sem versão congelada          → padrão;
 *   2. formato 1                     → padrão, sem ler as seções;
 *   3. formato desconhecido/ilegível → recusa;
 *   4. formato 2 a 5 sem nada configurado → padrão;
 *   5. algo configurado e gate desligado → recusa (nunca padrão);
 *   6. família que não é a da compra, ou combinação fora da matriz → recusa;
 *   7. o resto vira decisão tipada, efeito a efeito.
 */
export function resolverPoliticaEfetivaDaCompra(entrada: EntradaPoliticaDaCompra): ResultadoPoliticaDaCompra {
  const { versaoCongelada, execucaoConfiguradaHabilitada } = entrada;
  const matriz = entrada.matriz ?? MATRIZ_EXECUCAO_TOP;
  if (!versaoCongelada) return { ok: true, politica: { origem: "sem_top", ...PADRAO_DA_COMPRA } };

  const formato = versaoSchemaDaConfiguracaoTop(versaoCongelada.configuracao);
  if (formato === VERSAO_SCHEMA_CONFIGURACAO_TOP) return { ok: true, politica: { origem: formato, ...PADRAO_DA_COMPRA } };
  if (formato === null) return { ok: false, motivo: "configuracao_ilegivel", recusas: [] };

  const lida = lerConfiguracaoTop(versaoCongelada.configuracao);
  if (!lida.ok) return { ok: false, motivo: "configuracao_ilegivel", recusas: [] };
  const c = lida.valor;
  const execucao = execucaoDeclaradaTop(c);
  if (execucao.estoque === "legado" && execucao.financeiro === "legado") return { ok: true, politica: { origem: formato, ...PADRAO_DA_COMPRA } };

  if (!execucaoConfiguradaHabilitada) return { ok: false, motivo: "execucao_desligada", recusas: [] };

  if (!FAMILIA_DA_COMPRA || versaoCongelada.codigoBase !== FAMILIA_DA_COMPRA) {
    return {
      ok: false, motivo: "execucao_nao_suportada",
      recusas: EFEITOS_EXECUCAO_TOP.filter((e) => execucao[e] === "configurada")
        .map((e) => ({ motivo: "familia_sem_execucao_configurada", caminho: `execucao.${e}`, mensagem: MENSAGEM_FAMILIA_SEM_EXECUCAO_TOP })),
    };
  }
  const recusas = validarExecucaoTop(versaoCongelada.codigoBase, c, matriz);
  if (recusas.length) return { ok: false, motivo: "execucao_nao_suportada", recusas };

  let estoque: PoliticaEstoqueDaCompra = PADRAO_DA_COMPRA.estoque;
  if (execucao.estoque === "configurada") {
    if (c.estoque.atualizacao === "nenhuma") estoque = { autoridade: "configurada", efeito: "nenhum" };
    else if (c.estoque.atualizacao === "entrada") estoque = { autoridade: "configurada", efeito: "entrada", exigeArmazem: c.estoque.exigeArmazem };
    else return { ok: false, motivo: "execucao_nao_suportada", recusas: [{ motivo: "combinacao_nao_suportada", caminho: "estoque.atualizacao", mensagem: MENSAGEM_CAMPO_SEM_REGRA }] };
  }
  let financeiro: PoliticaFinanceiroDaCompra = PADRAO_DA_COMPRA.financeiro;
  if (execucao.financeiro === "configurada") {
    if (c.financeiro.atualizacao === "nenhuma") financeiro = { autoridade: "configurada", efeito: "nenhum" };
    else if (c.financeiro.atualizacao === "pagar") {
      financeiro = {
        autoridade: "configurada", efeito: "pagar",
        exigeFormaPagamento: c.financeiro.exigeFormaPagamento, exigeVencimento: c.financeiro.exigeVencimento, exigeCentroResultado: c.financeiro.exigeCentroResultado,
      };
    } else return { ok: false, motivo: "execucao_nao_suportada", recusas: [{ motivo: "combinacao_nao_suportada", caminho: "financeiro.atualizacao", mensagem: MENSAGEM_CAMPO_SEM_REGRA }] };
  }
  return { ok: true, politica: { origem: formato, estoque, financeiro } };
}

/** O resumo da política da compra para a auditoria da confirmação (texto estável). */
export function resumoDaPoliticaDaCompra(p: PoliticaEfetivaDaCompra): { estoque: string; financeiro: string } {
  return {
    estoque: p.estoque.autoridade === "padrao" ? "padrao" : `configurada:${p.estoque.efeito}`,
    financeiro: p.financeiro.autoridade === "padrao" ? "padrao" : `configurada:${p.financeiro.efeito}`,
  };
}
