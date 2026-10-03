/**
 * OPERACOES-01 F7 (decisão 284) — A CONTA DA COMPRA A PARTIR DA NOTA, e o CONTRATO da importação do XML.
 *
 * As contas que a API (importação e "Gerar compra") e a web (conferência) fazem IGUAIS moram aqui:
 *
 *   · quantidade interna = qCom × fator (ou ÷ fator), 4 casas; unitário interno = vProd ÷ quantidade interna, 6 casas
 *     (ROUND_HALF_EVEN, a regra da casa — mesma conta de `convertToPrimary`) — o unitário que a conferência MOSTRA;
 *   · um item com rastro vira UMA LINHA POR LOTE (produto com controle de lote): quantidade, vProd, desconto, IPI e
 *     ICMS-ST repartidos na proporção de qLote ÷ qCom; as linhas antes da última levam o PISO da parte e a ÚLTIMA fecha
 *     a soma (nunca negativa);
 *   · A LINHA FECHA O vProd (`valoresDaLinhaDaNota`): o unitário de 6 casas não reproduz qualquer vProd (150 000 kg a
 *     R$ 51 234,56 daria 0,341564 × 150 000 = 51 234,60). O unitário da LINHA é vProd da linha ÷ quantidade, arredondado
 *     PARA CIMA, e a sobra (no máximo quantidade × 0,000001) entra no desconto da linha — assim quantidade × unitário −
 *     desconto é EXATAMENTE vProd − vDesc da linha, a conta de hoje (`itemTotal`) continua a do servidor e da edição;
 *   · total da compra = itens − descontos + frete + outras − desconto + IPI + ICMS-ST + seguro; confere com o vNF na
 *     tolerância de R$ 0,01;
 *   · parcelas: as duplicatas só valem quando somam o líquido (o da fatura, ou o vNF) E o líquido é o total da compra,
 *     ambos com R$ 0,01 de tolerância; a última parcela absorve o centavo para a soma ser EXATAMENTE o total.
 *
 * Os TIPOS `ConferenciaDaImportacaoNfe` (a resposta da API) e `GerarCompraDaNota` (o corpo do "Gerar compra") são o
 * contrato que a API responde e a web lê — um lugar só. FUNÇÕES PURAS: dinheiro em string decimal, conta em decimal.js.
 */
import { D, DomainError, Decimal, money, qty, unitCost, type DecimalString } from "@agro/shared";
import { itemTotal } from "./sales.js";
import type { ItemDaNota, NotaFiscalLida, ParcelaDaNota } from "./nfe-leitura.js";

/** Capacidade declarada em `GET /compras/<segmento>/operation-types` (`capacidades.importacaoXml`). */
export const CAPACIDADE_IMPORTACAO_XML_COMPRA = 1;
/** Versão do contrato da conferência (`ConferenciaDaImportacaoNfe.contractVersion`). */
export const CONTRATO_CONFERENCIA_IMPORTACAO_NFE = 1;
/** Diferença máxima aceita entre o total calculado e o da nota (e entre parcelas e líquido). */
export const TOLERANCIA_TOTAL_DA_NOTA = "0.01";

export type TipoFator = "multiply" | "divide";
export type ControleDeLoteDoProduto = "nenhum" | "lote" | "lote_validade";

/** Unidade da nota para o vínculo: maiúsculas, sem espaço nas pontas, até 6 posições (o uCom da NF-e). */
export function normalizarUnidadeDaNota(u: string): string {
  return String(u ?? "").trim().toUpperCase().slice(0, 6);
}

function conferirFator(fator: string): Decimal {
  const f = D(fator);
  if (!f.isFinite() || !f.gt(0)) throw new RangeError("o fator de conversão precisa ser maior que zero");
  return f;
}

/** qCom convertido para a unidade do produto: × fator (multiply) ou ÷ fator (divide); 4 casas, ROUND_HALF_EVEN. */
export function quantidadeInterna(qCom: string, fator: string, tipo: TipoFator): string {
  const f = conferirFator(fator);
  if (tipo !== "multiply" && tipo !== "divide") throw new RangeError("tipo de fator desconhecido");
  return qty(tipo === "multiply" ? D(qCom).mul(f) : D(qCom).div(f));
}

/** Unitário na unidade do produto: vProd ÷ quantidade interna; 6 casas. */
export function unitarioInterno(valorProdutos: string, qInterna: string): string {
  if (!D(qInterna).gt(0)) throw new RangeError("a quantidade interna precisa ser maior que zero");
  return unitCost(D(valorProdutos).div(D(qInterna)));
}

export interface DecisaoDoItem {
  produtoId: string;
  fator: string;
  tipoFator: TipoFator;
  controlaLote: ControleDeLoteDoProduto;
  lote?: string | null;
  validade?: string | null;
}

export interface LinhaDaCompraDaNota {
  nItemNota: number;
  /** Na unidade do produto. */
  quantidade: string;
  valorUnitario: string;
  desconto: string;
  lote: string | null;
  validade: string | null;
  ipi: string;
  icmsSt: string;
  /** Na unidade da nota (qCom, ou qLote da linha). */
  quantidadeNota: string;
}

export type MotivoDaRecusaDaLinha = "rastro_diferente_da_quantidade" | "lote_obrigatorio" | "lote_com_rastro" | "quantidade_invalida";

/** Reparte `total` (casas dadas) na proporção `pesos`: PISO nas primeiras, a última fecha a soma (≥ a sua parte exata). */
function repartir(total: string, pesos: Decimal[], casas: number): string[] {
  const t = D(total);
  const soma = pesos.reduce((a, p) => a.plus(p), D(0));
  const partes = pesos.slice(0, -1).map((p) => t.mul(p).div(soma).toDecimalPlaces(casas, Decimal.ROUND_DOWN));
  const usado = partes.reduce((a, p) => a.plus(p), D(0));
  return [...partes, t.minus(usado)].map((p) => p.toFixed(casas));
}

const vazio = (v: string | null | undefined) => v === null || v === undefined || v.trim() === "";

/**
 * O UNITÁRIO E O DESCONTO de uma linha para que `itemTotal` (quantidade × unitário − desconto, em 2 casas) seja
 * EXATAMENTE `valorBruto − desconto`. Unitário = valorBruto ÷ quantidade arredondado PARA CIMA (6 casas), logo
 * quantidade × unitário ≥ valorBruto; a sobra vai para o desconto (2 casas, piso ou teto — o que fecha). Empate exato
 * no meio centavo que nenhum dos dois fecha (arredondamento bancário): o unitário sobe 0,000001 — com quantidade de 4
 * casas o empate não se repete. `desconto` e `valorBruto` em 2 casas; quantidade > 0.
 */
export function valoresDaLinhaDaNota(quantidade: string, valorBruto: string, desconto: string): { valorUnitario: string; desconto: string } {
  const q = D(quantidade); const v = D(money(valorBruto)); const d = D(money(desconto));
  if (!q.gt(0)) throw new RangeError("a quantidade precisa ser maior que zero");
  const alvo = v.minus(d);
  if (alvo.isNegative()) throw new DomainError("VALIDATION_ERROR", "Desconto maior que o valor do item");
  let u = v.div(q).toDecimalPlaces(6, Decimal.ROUND_UP);
  for (let tentativa = 0; tentativa < 3; tentativa++, u = u.plus("0.000001")) {
    const sobra = q.mul(u).minus(v);
    for (const a of [sobra.toDecimalPlaces(2, Decimal.ROUND_DOWN), sobra.toDecimalPlaces(2, Decimal.ROUND_UP)]) {
      const desc = d.plus(a);
      const total = q.mul(u).minus(desc);
      if (!total.isNegative() && D(money(total)).eq(alvo)) return { valorUnitario: u.toFixed(6), desconto: desc.toFixed(2) };
    }
  }
  // Inalcançável (ver acima): nunca devolve uma linha que não feche.
  throw new RangeError("a linha da nota não fecha o valor dos produtos");
}

/**
 * As linhas da compra de UM item da nota. Produto sem controle de lote: uma linha, rastro ignorado. Com controle: uma
 * linha por lote do rastro (lote/validade do corpo junto com rastro → `lote_com_rastro`; Σ qLote ≠ qCom →
 * `rastro_diferente_da_quantidade`); sem rastro, o lote do corpo é obrigatório (`lote_obrigatorio`). Linha que ficaria
 * com quantidade zero → `quantidade_invalida`.
 */
export function linhasDoItemDaNota(item: ItemDaNota, d: DecisaoDoItem):
  { ok: true; linhas: LinhaDaCompraDaNota[] } | { ok: false; motivo: MotivoDaRecusaDaLinha } {
  const qTotal = quantidadeInterna(item.quantidade, d.fator, d.tipoFator);
  if (!D(qTotal).gt(0)) return { ok: false, motivo: "quantidade_invalida" };
  const linhaInteira = () => ({ nItemNota: item.nItem, quantidade: qTotal, ...valoresDaLinhaDaNota(qTotal, item.valorProdutos, item.desconto) });

  if (d.controlaLote === "nenhum") {
    return { ok: true, linhas: [{ ...linhaInteira(), lote: null, validade: null,
      ipi: money(item.ipi), icmsSt: money(item.icmsSt), quantidadeNota: qty(item.quantidade) }] };
  }

  if (item.rastro.length === 0) {
    if (vazio(d.lote)) return { ok: false, motivo: "lote_obrigatorio" };
    return { ok: true, linhas: [{ ...linhaInteira(), lote: d.lote!.trim(),
      validade: vazio(d.validade) ? null : d.validade!, ipi: money(item.ipi), icmsSt: money(item.icmsSt), quantidadeNota: qty(item.quantidade) }] };
  }

  if (!vazio(d.lote) || !vazio(d.validade)) return { ok: false, motivo: "lote_com_rastro" };
  const pesos = item.rastro.map((r) => D(r.quantidade));
  if (!pesos.reduce((a, p) => a.plus(p), D(0)).eq(D(item.quantidade))) return { ok: false, motivo: "rastro_diferente_da_quantidade" };
  const quantidades = repartir(qTotal, pesos, 4);
  if (quantidades.some((q) => !D(q).gt(0))) return { ok: false, motivo: "quantidade_invalida" };
  const brutos = repartir(money(item.valorProdutos), pesos, 2);
  const descontos = repartir(money(item.desconto), pesos, 2);
  const ipis = repartir(money(item.ipi), pesos, 2);
  const sts = repartir(money(item.icmsSt), pesos, 2);
  return {
    ok: true,
    linhas: item.rastro.map((r, k) => ({
      nItemNota: item.nItem, quantidade: quantidades[k]!, ...valoresDaLinhaDaNota(quantidades[k]!, brutos[k]!, descontos[k]!),
      lote: r.lote, validade: r.validade, ipi: ipis[k]!, icmsSt: sts[k]!, quantidadeNota: qty(r.quantidade)
    }))
  };
}

export interface ItemParaTotalDaCompra { quantidade: string; valorUnitario: string; desconto: string; descontoPercentual?: string | null }
export interface CabecalhoParaTotalDaCompra { frete: string; outras: string; desconto: string; ipi: string; icmsSt: string; seguro: string }

/**
 * Totais da compra: itens (quantidade × unitário − desconto − desconto %, cada um em 2 casas — `itemTotal`, a conta de
 * hoje) + frete + outras − desconto + IPI + ICMS-ST + seguro. Sem IPI/ST/seguro (zeros), é o total de hoje.
 */
export function totaisDaCompra(itens: readonly ItemParaTotalDaCompra[], h: CabecalhoParaTotalDaCompra): { valorItens: DecimalString; total: DecimalString } {
  const valorItens = itens.reduce((a, i) => a.plus(D(itemTotal({
    quantity: i.quantidade, unitPrice: i.valorUnitario, discount: i.desconto, discountPercent: i.descontoPercentual ?? undefined
  }))), D(0));
  for (const v of [h.frete, h.outras, h.desconto, h.ipi, h.icmsSt, h.seguro]) {
    if (D(v).isNegative()) throw new DomainError("VALIDATION_ERROR", "Valor do cabeçalho negativo");
  }
  const total = valorItens.plus(D(h.frete)).plus(D(h.outras)).minus(D(h.desconto)).plus(D(h.ipi)).plus(D(h.icmsSt)).plus(D(h.seguro));
  if (total.lt(0)) throw new DomainError("VALIDATION_ERROR", "Total negativo");
  return { valorItens: money(valorItens), total: money(total) };
}

/** Total calculado × vNF: `diferenca` = calculado − nota (com sinal); confere dentro de TOLERANCIA_TOTAL_DA_NOTA. */
export function conferirTotalDaNota(totalCalculado: string, vNF: string): { confere: boolean; diferenca: string } {
  const diferenca = D(totalCalculado).minus(D(vNF));
  return { confere: diferenca.abs().lte(D(TOLERANCIA_TOTAL_DA_NOTA)), diferenca: money(diferenca) };
}

export type ParcelasDaNota =
  | { situacao: "sem_duplicatas" }
  | { situacao: "conferem"; parcelas: ParcelaDaNota[] }
  | { situacao: "nao_conferem"; soma: string; liquido: string };

/**
 * As parcelas da nota para a compra. Líquido = `fatura.liquido` quando há fatura com líquido, senão o vNF. Usa as
 * duplicatas quando Σ vDup = líquido (±0,01) E líquido = total da compra (±0,01); a última parcela absorve a diferença
 * para a soma ser EXATAMENTE o total. Sem duplicatas → `sem_duplicatas` (a condição de pagamento); senão `nao_conferem`.
 */
export function parcelasDaNota(nota: NotaFiscalLida, valorTotalDaCompra: string): ParcelasDaNota {
  if (nota.duplicatas.length === 0) return { situacao: "sem_duplicatas" };
  const liquido = D(nota.fatura?.liquido ?? nota.totais.nota);
  const soma = nota.duplicatas.reduce((a, p) => a.plus(D(p.valor)), D(0));
  const total = D(valorTotalDaCompra);
  const tolerancia = D(TOLERANCIA_TOTAL_DA_NOTA);
  const naoConferem = { situacao: "nao_conferem" as const, soma: money(soma), liquido: money(liquido) };
  if (soma.minus(liquido).abs().gt(tolerancia) || liquido.minus(total).abs().gt(tolerancia)) return naoConferem;
  const parcelas = nota.duplicatas.map((p) => ({ ...p, valor: money(p.valor) }));
  const ultima = parcelas[parcelas.length - 1]!;
  const antes = parcelas.slice(0, -1).reduce((a, p) => a.plus(D(p.valor)), D(0));
  const valorDaUltima = total.minus(antes);
  if (!valorDaUltima.gt(0)) return naoConferem;
  ultima.valor = money(valorDaUltima);
  return { situacao: "conferem", parcelas };
}

export type ValorNaoSuportadoDaNota = "ii" | "icms_desonerado" | "ipi_devolvido";

/** Valores que a compra não representa (II, ICMS desonerado, IPI devolvido diferentes de zero): cada um bloqueia. */
export function valoresNaoSuportadosDaNota(nota: NotaFiscalLida): ValorNaoSuportadoDaNota[] {
  const fora: ValorNaoSuportadoDaNota[] = [];
  if (!D(nota.totais.ii).isZero()) fora.push("ii");
  if (!D(nota.totais.icmsDesonerado).isZero()) fora.push("icms_desonerado");
  if (!D(nota.totais.ipiDevolvido).isZero()) fora.push("ipi_devolvido");
  return fora;
}

/** Peso do item no rateio do custo de entrada: valor do item + IPI + ICMS-ST do item (sem eles, o valor de hoje). */
export function pesoDoCustoDeEntrada(item: { valorTotal: string; ipi: string | null; icmsSt: string | null }): string {
  return money(D(item.valorTotal).plus(D(item.ipi ?? 0)).plus(D(item.icmsSt ?? 0)));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// CONTRATO DA IMPORTAÇÃO (a API responde, a web lê). Decimais em string; datas AAAA-MM-DD; instantes em ISO 8601.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type SituacaoImportacaoNfe = "pendente" | "gerada" | "descartada";
export type OrigemImportacaoNfe = "arquivo" | "dfe";

export interface ProdutoDoVinculo {
  id: string;
  codigo: string;
  descricao: string;
  unidade: string | null;
  controleLote: ControleDeLoteDoProduto;
  controlaEstoque: boolean;
}

export type VinculoDoItemDaNota =
  | { situacao: "lembrado"; produto: ProdutoDoVinculo; fator: string; tipoFator: TipoFator }
  | { situacao: "sugerido"; origem: "codigo_fornecedor" | "codigo_barras"; produto: ProdutoDoVinculo; fator: string; tipoFator: TipoFator }
  | { situacao: "ambiguo"; candidatos: ProdutoDoVinculo[] }
  | { situacao: "nenhum"; preenchimento: { description: string; ncm_code: string | null; barcode: string | null } };

/** Pré-preenchimento do cadastro de parceiro (chaves do recurso `people`); a pessoa confirma antes de criar. */
export interface PreenchimentoDoFornecedor {
  name: string;
  legal_name: string;
  person_type: "legal" | "natural";
  document: string;
  state_registration: string | null;
  is_provider: true;
  zip_code: string | null;
  address: string | null;
  address_number: string | null;
  district: string | null;
  /** Código IBGE do município do emitente (`erp.cities.id`). */
  city_id: number | null;
  phone: string | null;
}

export type ParceiroDaImportacaoNfe =
  | { situacao: "encontrado"; id: string; nome: string; documento: string }
  | { situacao: "ambiguo"; candidatos: { id: string; nome: string; documento: string; origem: "cadastro" | "filial"; ie: string | null }[] }
  | { situacao: "nao_fornecedor"; id: string; nome: string }
  | { situacao: "nenhum"; preenchimento: PreenchimentoDoFornecedor };

export interface ItemDaConferenciaNfe {
  nItem: number;
  vinculo: VinculoDoItemDaNota;
  /** Com o vínculo lembrado/sugerido; `null` sem vínculo. */
  quantidadeInterna: string | null;
  valorUnitarioInterno: string | null;
  /** Por xPed/nItemPed. */
  itemDoPedido: { pedidoId: string; itemId: string; posicao: number } | null;
}

export interface PedidoCandidatoDaNota {
  id: string;
  codigo: string;
  situacao: string;
  dataDocumento: string;
  valorTotal: string;
  condicaoPagamentoId: string | null;
  itens: { id: string; posicao: number; produtoId: string; produtoDescricao: string; quantidade: string; saldo: string; valorUnitario: string }[];
}

export interface DivergenciaDaImportacaoNfe { codigo: string; mensagem: string; nItem: number | null; bloqueia: boolean }

export interface ConferenciaDaImportacaoNfe {
  contractVersion: typeof CONTRATO_CONFERENCIA_IMPORTACAO_NFE;
  id: string;
  situacao: SituacaoImportacaoNfe;
  origem: OrigemImportacaoNfe;
  dfeId: string | null;
  criadoEm: string;
  criadoPorNome: string | null;
  empresa: { id: string; nome: string };
  documentoCompra: { id: string; codigo: string; situacao: string } | null;
  /** A nota lida do XML guardado (o XML não volta na resposta). */
  nota: NotaFiscalLida;
  /** O `?fornecedor_id` aceito, ou o único encontrado. */
  fornecedorEscolhido: string | null;
  parceiro: ParceiroDaImportacaoNfe;
  itens: ItemDaConferenciaNfe[];
  pedidos: {
    /** xPed do cabeçalho e dos itens. */
    referenciados: { xPed: string; pedido: { id: string; codigo: string; situacao: string } | null }[];
    /** Até 20, do fornecedor, da empresa, aberto|finalizado, com saldo. */
    candidatos: PedidoCandidatoDaNota[];
  };
  financeiro: { parcelas: ParcelasDaNota & { origem: "nota" } };
  divergencias: DivergenciaDaImportacaoNfe[];
  /** Nota já lançada (visível). */
  duplicidade: { onde: "compra" | "documento_fiscal_estoque"; codigo: string } | null;
}

export type RateioDoGerarCompra =
  | { tipo: "documento"; categoria_financeira_id?: string | null; centro_custo_id?: string | null }
  | { tipo: "por_valor"; linhas: { categoria_financeira_id: string; centro_custo_id: string; conta_contabil_id?: string | null; safra_id?: string | null; percentual: string }[] }
  | { tipo: "por_produto" };

export interface ItemDoGerarCompra {
  n_item: number;
  produto_id: string;
  fator: string;
  tipo_fator: TipoFator;
  /** Padrão true. */
  lembrar_vinculo?: boolean;
  armazem_id?: string | null;
  /** Padrão true. */
  gera_estoque?: boolean;
  /** Padrão false. */
  imobilizado?: boolean;
  item_origem_id?: string | null;
  categoria_financeira_id?: string | null;
  centro_custo_id?: string | null;
  lote?: string | null;
  validade?: string | null;
}

/** Corpo do `POST /compras/importacoes/:id/gerar-compra`: só DECISÕES — os valores vêm sempre da nota guardada. */
export interface GerarCompraDaNota {
  tipo_operacao_id: string;
  fornecedor_id: string;
  data_entrada?: string | null;
  observacao?: string | null;
  transportadora_id?: string | null;
  pedido_id?: string | null;
  solicitacao_compra_id?: string | null;
  financeiro: {
    parcelas: "nota" | "condicao";
    condicao_pagamento_id?: string | null;
    data_vencimento?: string | null;
    forma_pagamento_id?: string | null;
    tipo_titulo_id?: string | null;
    classificacao_gasto?: "capex" | "opex" | null;
    rateio: RateioDoGerarCompra;
  };
  itens: ItemDoGerarCompra[];
}

/** Resposta 201 do "Gerar compra": a compra nasce ABERTA (nunca se confirma sozinha). */
export interface CompraGeradaDaNota {
  id: string;
  codigo: string;
  especie: "compra";
  situacao: "aberto";
  valor_itens: string;
  valor_total: string;
  importacao_id: string;
}
