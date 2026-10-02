/**
 * OPERACOES-01 F9 (decisão 286) — OS PADRÕES FINANCEIROS DA TOP.
 *
 * A TOP gravada no formato 5 pode trazer os PADRÕES do lançamento financeiro: natureza, centro de resultado, tipo de
 * título, forma de pagamento e conta. Os ALVOS concretos (UUIDs) moram numa TABELA da versão,
 * `erp.tipos_operacao_versao_financeiro` (0045, regra 4 do ponto de extensão: nada de UUID no JSON); as REGRAS moram
 * na seção `financeiroPadrao` (`tipo-operacao-secao-financeiro-padrao.ts`): se o documento pode trocar os padrões e o
 * que acontece quando nem o documento nem a TOP dizem a natureza e o centro.
 *
 * ESTE ARQUIVO É A REGRA PURA, sem banco:
 *   · o PERFIL de cada família — quais padrões ela usa, se provisiona, se a regra "sem natureza e centro" vale nela e
 *     que tipo de natureza ela aceita;
 *   · a TROCA: quais campos o documento informou DIFERENTES do padrão que a TOP tem (`documentoTroca` desligado
 *     recusa) e a mensagem;
 *   · a CLASSIFICAÇÃO (natureza e centro) de um lançamento: documento → padrão da TOP → "exigir" recusa → o padrão
 *     legado de hoje (a 1ª natureza e o 1º centro por código), que continua intacto quando a TOP não declara nada.
 *
 * As famílias são PERGUNTADAS ao registry (`tipo-operacao.ts`) pela tabela e pela variante — nenhum código de família
 * escrito aqui (`familia-operacional-ssot-audit`). Família que o registry não declara não tem perfil (fail-closed).
 */
import { resolverTipoOperacao } from "./tipo-operacao.js";
import { familiaOperacionalDeDocumentoVenda } from "./tipo-operacao-configurado.js";
import { provisaoExecutavelNaFamilia } from "./financeiro-provisao.js";

/** Os padrões que uma TOP pode ter, na ordem fixa (a das recusas e da tela). */
export const CAMPOS_PADRAO_FINANCEIRO = ["natureza", "centro", "tipoTitulo", "formaPagamento", "conta"] as const;
export type CampoPadraoFinanceiro = (typeof CAMPOS_PADRAO_FINANCEIRO)[number];

/** O nome de cada padrão no meio da frase ("Esta operação não deixa trocar a natureza…"). */
export const ROTULOS_CAMPO_PADRAO_FINANCEIRO: Readonly<Record<CampoPadraoFinanceiro, string>> = Object.freeze({
  natureza: "a natureza",
  centro: "o centro de resultado",
  tipoTitulo: "o tipo de título",
  formaPagamento: "a forma de pagamento",
  conta: "a conta",
});

/** Os padrões de UMA versão de TOP (os ids da tabela da versão); `null` = sem padrão naquele campo. */
export interface PadroesFinanceirosTop {
  naturezaId: string | null;
  centroCustoId: string | null;
  tipoTituloId: string | null;
  formaPagamentoId: string | null;
  contaBancariaId: string | null;
}

/** Nenhum padrão — o que vale para toda versão sem linha na tabela (e para toda versão nos formatos 1 a 4). */
export const padroesFinanceirosVazios = (): PadroesFinanceirosTop => ({
  naturezaId: null,
  centroCustoId: null,
  tipoTituloId: null,
  formaPagamentoId: null,
  contaBancariaId: null,
});

/** O tipo da natureza, como o banco o grava (`financial_categories.nature`). */
export type TipoDeNaturezaFinanceira = "income" | "expense" | "both";

/** O que a família usa da seção `financeiroPadrao` e da tabela dos padrões. */
export interface PerfilDosPadroesFinanceiros {
  /** A família provisiona (a caixa "Provisionar" aparece e pode ser ligada)? */
  readonly provisao: boolean;
  /**
   * A regra "sem natureza e centro" vale nela? Só onde o documento pode chegar SEM natureza e centro (a venda, o
   * pedido, a solicitação). O lançamento avulso e o movimento sempre os informam (o rateio é obrigatório).
   */
  readonly semClassificacao: boolean;
  /**
   * O documento da família INFORMA algum dos padrões (a regra "o documento pode trocar os padrões" tem efeito nela)?
   * A solicitação de compra não informa nenhum (a natureza, o centro, o tipo e a conta saem só da TOP padrão): a
   * caixa não aparece no editor a não ser desmarcada, para poder ser marcada de volta.
   */
  readonly trocaPeloDocumento: boolean;
  /** Os padrões que a família usa, na ordem de `CAMPOS_PADRAO_FINANCEIRO`. */
  readonly campos: readonly CampoPadraoFinanceiro[];
  /** Os tipos de natureza aceitos como padrão (a natureza de despesa numa TOP de venda é recusada). */
  readonly naturezas: readonly TipoDeNaturezaFinanceira[];
}

const TODOS: readonly CampoPadraoFinanceiro[] = CAMPOS_PADRAO_FINANCEIRO;
/** O título avulso não tem forma de pagamento: o tipo de título e a conta prevista, sim. */
const DO_TITULO: readonly CampoPadraoFinanceiro[] = Object.freeze(["natureza", "centro", "tipoTitulo", "conta"] as const);
/** O movimento bancário não tem tipo de título nem forma: a natureza, o centro (o rateio) e a conta. */
const DO_MOVIMENTO: readonly CampoPadraoFinanceiro[] = Object.freeze(["natureza", "centro", "conta"] as const);
const RECEITA: readonly TipoDeNaturezaFinanceira[] = Object.freeze(["income", "both"] as const);
const DESPESA: readonly TipoDeNaturezaFinanceira[] = Object.freeze(["expense", "both"] as const);
const QUALQUER: readonly TipoDeNaturezaFinanceira[] = Object.freeze(["income", "expense", "both"] as const);

/** Uma linha da matriz: a família (perguntada ao registry) e o que ela usa. Família ausente = linha ignorada. */
interface LinhaDoPerfil {
  readonly familia: string | undefined;
  readonly semClassificacao: boolean;
  readonly trocaPeloDocumento: boolean;
  readonly campos: readonly CampoPadraoFinanceiro[];
  readonly naturezas: readonly TipoDeNaturezaFinanceira[];
}

/**
 * A MATRIZ DOS PADRÕES, por família (a provisão sai de `provisaoExecutavelNaFamilia`, a fonte única das regras de
 * provisão):
 *
 *   família                 | sem natureza e centro | o documento troca | padrões                                   | naturezas
 *   pedido de venda         | sim                   | sim               | os cinco                                  | receita
 *   venda                   | sim                   | sim               | os cinco                                  | receita
 *   conta a receber         | não                   | sim               | natureza, centro, tipo de título, conta   | receita
 *   conta a pagar           | não                   | sim               | natureza, centro, tipo de título, conta   | despesa
 *   movimento bancário      | não                   | sim               | natureza, centro, conta                   | qualquer
 *   solicitação de compra   | sim                   | não               | natureza, centro, tipo de título, conta   | despesa
 *
 * ("receita" e "despesa" aceitam também a natureza "Receita e despesa".) As outras famílias não usam a seção — entre
 * elas o pedido de compra e a compra, que a F9b liga junto com a provisão do pedido de compra finalizado.
 */
const MATRIZ: readonly LinhaDoPerfil[] = [
  { familia: familiaOperacionalDeDocumentoVenda("order"), semClassificacao: true, trocaPeloDocumento: true, campos: TODOS, naturezas: RECEITA },
  { familia: familiaOperacionalDeDocumentoVenda("sale"), semClassificacao: true, trocaPeloDocumento: true, campos: TODOS, naturezas: RECEITA },
  { familia: resolverTipoOperacao("erp.financial_titles", "receivable")?.codigo, semClassificacao: false, trocaPeloDocumento: true, campos: DO_TITULO, naturezas: RECEITA },
  { familia: resolverTipoOperacao("erp.financial_titles", "payable")?.codigo, semClassificacao: false, trocaPeloDocumento: true, campos: DO_TITULO, naturezas: DESPESA },
  { familia: resolverTipoOperacao("erp.bank_movements")?.codigo, semClassificacao: false, trocaPeloDocumento: true, campos: DO_MOVIMENTO, naturezas: QUALQUER },
  { familia: resolverTipoOperacao("erp.purchase_requests")?.codigo, semClassificacao: true, trocaPeloDocumento: false, campos: DO_TITULO, naturezas: DESPESA },
];

const PERFIS: ReadonlyMap<string, PerfilDosPadroesFinanceiros> = new Map(
  MATRIZ.filter((l): l is LinhaDoPerfil & { familia: string } => typeof l.familia === "string").map((l) => [
    l.familia,
    Object.freeze({
      provisao: provisaoExecutavelNaFamilia(l.familia),
      semClassificacao: l.semClassificacao,
      trocaPeloDocumento: l.trocaPeloDocumento,
      campos: l.campos,
      naturezas: l.naturezas,
    }),
  ]),
);

/** O perfil dos padrões da família, ou `null` (a família não usa a seção — quem chama NEGA, nunca usa um vizinho). */
export function perfilDosPadroesFinanceiros(familia: string): PerfilDosPadroesFinanceiros | null {
  return PERFIS.get(familia) ?? null;
}

/** A família usa a seção `financeiroPadrao` (a aba aparece no editor e a seção é aceita fora do neutro)? */
export const familiaUsaPadroesFinanceiros = (familia: string): boolean => PERFIS.has(familia);

/** Texto com conteúdo, em minúsculas e sem espaço nas pontas; vazio/nulo → `null`. */
const idNormal = (v: string | null | undefined): string | null => {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  return t === "" ? null : t;
};

/** O documento informou algo DIFERENTE do padrão? Padrão ausente nunca é troca; valor vazio no documento também não. */
const trocou = (padrao: string | null, informados: readonly (string | null | undefined)[]): boolean => {
  const p = idNormal(padrao);
  if (p === null) return false;
  return informados.some((v) => {
    const i = idNormal(v);
    return i !== null && i !== p;
  });
};

/** O que o documento informa, campo a campo. A natureza e o centro são LISTAS (uma por linha do rateio). */
export interface CamposInformadosNoDocumento {
  naturezaIds?: readonly (string | null | undefined)[];
  centroCustoIds?: readonly (string | null | undefined)[];
  tipoTituloId?: string | null;
  formaPagamentoId?: string | null;
  contaBancariaId?: string | null;
}

/**
 * Os campos em que o documento INFORMA algo diferente do padrão que a TOP TEM, na ordem de `CAMPOS_PADRAO_FINANCEIRO`.
 * Vazio no documento não é troca (o padrão vale); padrão ausente na TOP também não (o documento decide). Ids
 * comparados em minúsculas. Com `documentoTroca` desligado, a lista não vazia é a recusa (`mensagemDosPadroesTrocados`).
 */
export function camposTrocadosDosPadroes(p: PadroesFinanceirosTop, doc: CamposInformadosNoDocumento): CampoPadraoFinanceiro[] {
  const trocados: Record<CampoPadraoFinanceiro, boolean> = {
    natureza: trocou(p.naturezaId, doc.naturezaIds ?? []),
    centro: trocou(p.centroCustoId, doc.centroCustoIds ?? []),
    tipoTitulo: trocou(p.tipoTituloId, [doc.tipoTituloId]),
    formaPagamento: trocou(p.formaPagamentoId, [doc.formaPagamentoId]),
    conta: trocou(p.contaBancariaId, [doc.contaBancariaId]),
  };
  return CAMPOS_PADRAO_FINANCEIRO.filter((c) => trocados[c]);
}

/** "a natureza", "a natureza e o centro de resultado", "a natureza, o centro de resultado e a conta". */
function listaNaFrase(itens: readonly string[]): string {
  if (itens.length <= 1) return itens[0] ?? "";
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/**
 * A recusa da troca: "Esta operação não deixa trocar a natureza e o centro de resultado: use o padrão da TOP." Os
 * campos na ordem recebida; lista vazia (quem chama não deveria) → "os padrões".
 */
export function mensagemDosPadroesTrocados(campos: readonly CampoPadraoFinanceiro[]): string {
  const alvo = campos.length > 0 ? listaNaFrase(campos.map((c) => ROTULOS_CAMPO_PADRAO_FINANCEIRO[c])) : "os padrões";
  return `Esta operação não deixa trocar ${alvo}: use o padrão da TOP.`;
}

/**
 * A regra da TOP quando nem o documento nem os padrões dão a natureza e o centro (o campo `semClassificacao` da seção
 * `financeiroPadrao`): o padrão legado de hoje (a 1ª natureza e o 1º centro por código) ou EXIGIR (recusa).
 */
export const SEM_CLASSIFICACAO_TOP = ["padrao_legado", "exigir"] as const;
export type SemClassificacaoTop = (typeof SEM_CLASSIFICACAO_TOP)[number];

/** A classificação (natureza e centro) de um lançamento, decidida antes de gravar. */
export type PlanoDaClassificacao =
  | { tipo: "pronta"; naturezaId: string; centroCustoId: string; origem: "documento" | "padrão da TOP" }
  | { tipo: "exigir"; faltam: readonly ("natureza" | "centro")[] }
  /** `null` num campo = o legado daquele campo (a 1ª natureza / o 1º centro por código, a consulta de hoje). */
  | { tipo: "legado"; naturezaId: string | null; centroCustoId: string | null };

/** A recusa de `exigir`: nem o documento nem a TOP deram a natureza e o centro. */
export const MENSAGEM_EXIGE_CLASSIFICACAO =
  "A operação exige natureza e centro de resultado: informe no documento ou configure os padrões da TOP.";

/**
 * A ORDEM DA CLASSIFICAÇÃO, sempre por PAR (natureza E centro — um sem o outro não classifica):
 *   1. o documento com os DOIS → o do documento (origem "documento");
 *   2. a TOP com os DOIS padrões → o padrão da TOP (origem "padrão da TOP");
 *   3. `semClassificacao = "exigir"` → recusa, dizendo o que falta NA TOP;
 *   4. senão → o LEGADO de hoje, completando com o que a TOP tiver (o campo nulo é o "1º por código" de hoje).
 * Documento parcial (só a natureza ou só o centro) vale como sem documento. Ids devolvidos em minúsculas.
 * `padrao` nulo = a versão não tem padrões (formato 1 a 4, ou sem linha na tabela).
 */
export function planoDaClassificacao(p: {
  documento: { naturezaId: string | null; centroCustoId: string | null };
  padrao: { naturezaId: string | null; centroCustoId: string | null } | null;
  semClassificacao: SemClassificacaoTop;
}): PlanoDaClassificacao {
  const docNatureza = idNormal(p.documento.naturezaId);
  const docCentro = idNormal(p.documento.centroCustoId);
  if (docNatureza !== null && docCentro !== null) {
    return { tipo: "pronta", naturezaId: docNatureza, centroCustoId: docCentro, origem: "documento" };
  }
  const topNatureza = idNormal(p.padrao?.naturezaId);
  const topCentro = idNormal(p.padrao?.centroCustoId);
  if (topNatureza !== null && topCentro !== null) {
    return { tipo: "pronta", naturezaId: topNatureza, centroCustoId: topCentro, origem: "padrão da TOP" };
  }
  if (p.semClassificacao === "exigir") {
    const faltam: ("natureza" | "centro")[] = [];
    if (topNatureza === null) faltam.push("natureza");
    if (topCentro === null) faltam.push("centro");
    return { tipo: "exigir", faltam };
  }
  return { tipo: "legado", naturezaId: topNatureza, centroCustoId: topCentro };
}
