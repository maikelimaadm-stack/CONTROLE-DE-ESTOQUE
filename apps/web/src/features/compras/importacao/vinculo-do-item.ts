import { D } from "@agro/shared";
import { enumLabel, hasEnumLabel, type ConferenciaDaImportacaoNfe, type VinculoDoItemDaNota } from "@agro/domain";
import type { DecisaoDoItemNaTela } from "./estado";

/**
 * O VÍNCULO DE UM ITEM DA NOTA NA TELA (XML-02, decisão 314) — leituras PURAS, sem React e sem rede (a aba de itens e o
 * estado da conferência só as chamam; o teste de unidade as prova uma a uma). A regra: IDENTIDADE primeiro, semelhança
 * depois. O lembrado e o sugerido por identidade (código do fornecedor, código de barras, referência do produto) vêm
 * escolhidos, como sempre; o sugerido pela DESCRIÇÃO semelhante também vem escolhido, mas é PALPITE, e a tela o trata assim.
 *
 *   · RÓTULO (`rotuloDoVinculo`): a situação e, no sugerido, a origem — as duas pelos rótulos do domínio (`enumLabel`),
 *     nunca o valor técnico. Origem que a tela não conhece (uma API mais nova) ⇒ só "Sugerido", sem o parêntese.
 *   · LEMBRAR (`lembrarDoVinculo`): "Lembrar este vínculo" nasce MARCADO, como sempre — menos no sugerido que não é por
 *     identidade (a descrição semelhante e, fail-closed, a origem desconhecida): o palpite só vira vínculo lembrado com a
 *     marcação da pessoa. Refeito o vínculo (troca de fornecedor), o que a pessoa mudou fica e o resto segue o vínculo
 *     novo; o palpite volta desmarcado (o vínculo lembrado é do fornecedor: marcar com outro fornecedor não vale para este).
 *   · DECISÃO (`decisaoDoVinculo`): a decisão do item com que a tela nasce (e que a troca de fornecedor refaz) — o
 *     produto e o fator do lembrado e de todo sugerido (também o pela descrição, que vem escolhido) e o "Lembrar" acima.
 */

/** As origens do sugerido que são IDENTIDADE (caminhos 2 a 4 da decisão 314). Fora daqui, o sugerido é palpite. */
const ORIGENS_DE_IDENTIDADE: ReadonlySet<string> = new Set(["codigo_fornecedor", "codigo_barras", "reference"]);

/** O sugerido pela DESCRIÇÃO semelhante (o 5º caminho): o palpite que a tela pede para conferir. */
type SugeridoPelaDescricao = Extract<VinculoDoItemDaNota, { origem: "descricao" }>;
export const sugeridoPelaDescricao = (v: VinculoDoItemDaNota | undefined): v is SugeridoPelaDescricao => v?.situacao === "sugerido" && v.origem === "descricao";

/** O sugerido que NÃO é por identidade — a descrição semelhante, ou uma origem que a tela não conhece (fail-closed). */
export const sugeridoPorPalpite = (v: VinculoDoItemDaNota | undefined): boolean => v?.situacao === "sugerido" && !ORIGENS_DE_IDENTIDADE.has(v.origem);

/** "Sugerido (descrição semelhante)", "Vínculo lembrado"…: pelos rótulos do domínio; a origem desconhecida não aparece. */
export function rotuloDoVinculo(v: VinculoDoItemDaNota): string {
  const situacao = enumLabel("vinculo_item_nfe", v.situacao);
  return v.situacao === "sugerido" && hasEnumLabel("origem_vinculo_item_nfe", v.origem) ? `${situacao} (${enumLabel("origem_vinculo_item_nfe", v.origem)})` : situacao;
}

/** O "Lembrar este vínculo" PADRÃO de um vínculo: marcado, menos no palpite. */
export const lembrarPorPadrao = (v: VinculoDoItemDaNota | undefined): boolean => !sugeridoPorPalpite(v);

/**
 * O "Lembrar" de um item quando o vínculo nasce (`anterior` ausente ⇒ o padrão) ou é REFEITO pela troca de fornecedor
 * (`anterior`: a marcação na tela e o vínculo em que ela nasceu). O palpite ⇒ desmarcado, sempre. Senão, a marcação que
 * a pessoa MUDOU (diferente do padrão do vínculo anterior) fica; a que ela não mudou segue o padrão do vínculo novo.
 */
export function lembrarDoVinculo(v: VinculoDoItemDaNota | undefined, anterior?: { lembrar: boolean; vinculo: VinculoDoItemDaNota | undefined }): boolean {
  const padrao = lembrarPorPadrao(v);
  if (!padrao || !anterior) return padrao;
  return anterior.lembrar === lembrarPorPadrao(anterior.vinculo) ? padrao : anterior.lembrar;
}

/**
 * A decisão de um item pelo vínculo do servidor (lembrado/sugerido traz produto e fator; o resto, vazio e fator 1).
 * `base` é a decisão anterior do item e `vinculoAnterior` o vínculo em que ela nasceu (a troca de fornecedor): o que a
 * pessoa já decidiu no item (local, estoque, lote, pedido, natureza) fica; o "Lembrar" segue `lembrarDoVinculo`.
 */
export function decisaoDoVinculo(conf: Pick<ConferenciaDaImportacaoNfe, "itens">, nItem: number, base?: DecisaoDoItemNaTela, vinculoAnterior?: VinculoDoItemDaNota): DecisaoDoItemNaTela {
  const i = conf.itens.find((x) => x.nItem === nItem);
  const v = i?.vinculo;
  const comVinculo = v && (v.situacao === "lembrado" || v.situacao === "sugerido") ? v : null;
  return {
    nItem,
    produtoId: comVinculo ? comVinculo.produto.id : "",
    produtoManual: false,
    fator: comVinculo ? D(comVinculo.fator).toFixed() : "1",
    tipoFator: comVinculo ? comVinculo.tipoFator : "multiply",
    armazemId: base?.armazemId ?? "",
    geraEstoque: base?.geraEstoque ?? true,
    imobilizado: base?.imobilizado ?? false,
    lembrar: lembrarDoVinculo(v, base ? { lembrar: base.lembrar, vinculo: vinculoAnterior } : undefined),
    lote: base?.lote ?? "",
    validade: base?.validade ?? "",
    itemOrigemId: base?.itemOrigemId ?? "",
    categoriaId: base?.categoriaId ?? "",
    centroId: base?.centroId ?? ""
  };
}
