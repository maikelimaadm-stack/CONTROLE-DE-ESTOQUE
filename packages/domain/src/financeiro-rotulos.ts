import { NOT_INFORMED, UNKNOWN_VALUE } from "./labels.js";
import type { SituacaoTitulo } from "./financeiro-situacao.js";
import { OPCOES_TIPO_EXPLORACAO, OPCOES_TIPO_LCDPR, type TipoExploracaoImovel, type TipoLcdpr } from "./financeiro-lcdpr.js";

/**
 * Os rótulos do LCDPR (F9, decisão 286) saem das MESMAS opções do cadastro (`financeiro-lcdpr.ts`): o tipo da natureza
 * e o tipo de exploração do imóvel têm um texto só — o da ficha é o da conferência.
 */
const rotulosDasOpcoes = <K extends string>(opcoes: readonly (readonly [K, string])[]): Readonly<Record<K, string>> =>
  Object.freeze(Object.fromEntries(opcoes) as Record<K, string>);
const ROTULOS_TIPO_LCDPR: Readonly<Record<TipoLcdpr, string>> = rotulosDasOpcoes(OPCOES_TIPO_LCDPR);
const ROTULOS_TIPO_EXPLORACAO: Readonly<Record<TipoExploracaoImovel, string>> = rotulosDasOpcoes(OPCOES_TIPO_EXPLORACAO);

/**
 * Rótulos PT-BR da Central Financeira (decisão 285). Moram aqui, e não em `labels.ts`, porque são do financeiro novo
 * e aquele catálogo tem outro dono nesta onda; a regra de exibição é a mesma do `enumLabel`.
 */
export const ROTULOS_FINANCEIRO = {
  situacao_titulo: { a_vencer: "A vencer", vencido: "Vencido", parcial: "Baixa parcial", baixado: "Baixado", previsto: "Previsto", cancelado: "Cancelado" },
  cartao_titulo: { vencidos: "Vencidos", vence_hoje: "Vencem hoje", a_vencer: "A vencer", pagos_no_periodo: "Baixados no período", previstos: "Previstos" },
  origem_titulo: { avulso: "Avulso", venda: "Venda", compra: "Compra", nota: "Nota fiscal", folha: "Folha", movimento: "Movimento bancário", pecuaria: "Pecuária", transferencia: "Transferência", credito: "Crédito de baixa", outros: "Outros" },
  componente_baixa: { juros: "Juros", multa: "Multa", acrescimo: "Acréscimo", tarifa: "Tarifa bancária", desconto: "Desconto" },
  tipo_transferencia: { transferencia: "Transferência entre contas", deposito: "Depósito", saque: "Saque", aplicacao: "Aplicação", resgate: "Resgate" },
  sugestao_conciliacao: { encontrado: "Encontrado", sugestao: "Sugestão", soma: "Soma de vários", nenhuma: "Sem sugestão" },
  situacao_conciliacao: { pending: "Pendente", matched: "Conciliada", ignored: "Ignorada" },
  grupo_dre: { receitas: "Receitas", deducoes: "Deduções", custos: "Custos", despesas: "Despesas", investimentos: "Investimentos" },
  campo_periodo: { vencimento: "Vencimento", emissao: "Emissão", competencia: "Competência", baixa: "Baixa" },
  motivo_lote: {
    nao_encontrado: "Não encontrado",
    ja_cancelado: "Já cancelado",
    com_baixa: "Tem baixa confirmada: estorne a baixa antes",
    origem: "Gerado por outro documento: altere pela origem",
    periodo_congelado: "Período congelado",
    situacao: "A situação do título não permite",
    sem_baixa: "Sem baixa confirmada",
    movimento_compartilhado: "Baixa em lote com movimento único: estorne o lote",
    movimento_conciliado: "Movimento conciliado: desfaça a conciliação antes",
    credito_usado: "O crédito gerado já foi usado: estorne a compensação antes",
    // OPERACOES-01 F9 (decisão 286): o previsto da provisão sai do lote — muda só pelo documento de origem.
    previsto: "Título previsto: muda pelo documento de origem"
  },
  regime_dre: { competencia: "Competência", caixa: "Caixa" },
  // OPERACOES-01 F9 (decisão 286): o LCDPR — o tipo da natureza, o tipo de exploração do imóvel e a situação da conferência.
  tipo_lcdpr: ROTULOS_TIPO_LCDPR,
  tipo_exploracao: ROTULOS_TIPO_EXPLORACAO,
  situacao_conferencia_lcdpr: { conferidas: "Conferidas", pendentes: "Pendentes" }
} as const satisfies Record<string, Record<string, string>>;

/** Rótulo PT-BR de um valor do financeiro. Vazio/nulo → "Não informado"; fora do domínio → "Desconhecido" (nunca o valor cru). */
export function rotuloFinanceiro(dominio: keyof typeof ROTULOS_FINANCEIRO, valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return NOT_INFORMED;
  const mapa = ROTULOS_FINANCEIRO[dominio] as Record<string, string>;
  const chave = String(valor);
  return Object.prototype.hasOwnProperty.call(mapa, chave) ? mapa[chave]! : UNKNOWN_VALUE;
}

/** Rótulo do cartão "baixados no período" conforme a aba: a pagar, a receber ou todos. */
export function rotuloDoCartaoBaixados(direcao: "payable" | "receivable" | "todos"): string {
  if (direcao === "payable") return "Pagos no período";
  if (direcao === "receivable") return "Recebidos no período";
  return "Baixados no período";
}

/** Tom CENTRAL da situação do título (a web passa como `tone` do `StatusBadge`; nada de tom local por tela). */
export const TOM_DA_SITUACAO_TITULO: Readonly<Record<SituacaoTitulo, "positive" | "negative" | "warning" | "info" | "neutral">> = {
  a_vencer: "info",
  vencido: "negative",
  parcial: "warning",
  baixado: "positive",
  previsto: "neutral",
  cancelado: "neutral"
};
