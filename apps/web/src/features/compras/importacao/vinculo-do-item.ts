import { D } from "@agro/shared";
import { enumLabel, hasEnumLabel, type ConferenciaDaImportacaoNfe, type FatorDoItemDaNota, type TipoFator, type VinculoDoItemDaNota } from "@agro/domain";
import type { DecisaoDoItemNaTela } from "./estado";

/**
 * O VÍNCULO DE UM ITEM DA NOTA NA TELA (XML-02, decisão 314) — leituras PURAS, sem React e sem rede (a aba de itens e o
 * estado da conferência só as chamam; o teste de unidade as prova uma a uma). A regra: IDENTIDADE primeiro, semelhança
 * depois. O lembrado e o sugerido pelo código do fornecedor ou pelo código de barras vêm escolhidos, como sempre; o
 * sugerido pela REFERÊNCIA do produto e pela DESCRIÇÃO semelhante também vêm escolhidos, mas são PALPITE na tela.
 * A referência é palpite por decisão do dono (decisão 314): na produção, quase toda referência é um número sem o
 * fornecedor, e nas compras já geradas por nota ela teria escolhido o produto errado em 3 de 8 itens.
 *
 *   · RÓTULO (`rotuloDoVinculo`): a situação e, no sugerido, a origem — as duas pelos rótulos do domínio (`enumLabel`),
 *     nunca o valor técnico. Origem que a tela não conhece (uma API mais nova) ⇒ só "Sugerido", sem o parêntese.
 *   · LEMBRAR (`lembrarDoVinculo`): "Lembrar este vínculo" nasce MARCADO, como sempre — menos no sugerido que não é por
 *     identidade (a descrição semelhante e, fail-closed, a origem desconhecida): o palpite só vira vínculo lembrado com a
 *     marcação da pessoa. Refeito o vínculo (troca de fornecedor), o que a pessoa mudou fica e o resto segue o vínculo
 *     novo; o palpite volta desmarcado (o vínculo lembrado é do fornecedor: marcar com outro fornecedor não vale para este).
 *   · TROCA DE PRODUTO (`lembrarAoTrocarProduto`): no palpite, a pessoa que troca o produto por outro decidiu — o
 *     "Lembrar" passa a marcado; voltando ao produto do palpite, desmarcado.
 *   · DECISÃO (`decisaoDoVinculo`): a decisão do item com que a tela nasce (e que a troca de fornecedor refaz) — o
 *     produto e o fator do lembrado e de todo sugerido (também o pela descrição, que vem escolhido) e o "Lembrar" acima.
 *   · DE ONDE VEIO O FATOR (XML-04, decisão 318 — `fatorPelaNotaDoVinculo`): lido por PROPRIEDADE PRÓPRIA do vínculo;
 *     a API anterior não o manda e a decisão é a de antes. Com a PERGUNTA, o fator nasce VAZIO (nunca o "1" que o
 *     servidor ainda manda por compatibilidade): o item é pendência até a pessoa informar o fator.
 */

/**
 * As origens do sugerido que a TELA trata como identidade (caminhos 2 e 3 da decisão 314). Fora daqui, o sugerido é
 * palpite: a referência do produto (o 4º caminho — identidade no servidor, palpite na tela, decisão do dono), a
 * descrição semelhante e qualquer origem que a tela não conhece (fail-closed).
 */
const ORIGENS_DE_IDENTIDADE: ReadonlySet<string> = new Set(["codigo_fornecedor", "codigo_barras"]);

/** O sugerido pela DESCRIÇÃO semelhante (o 5º caminho): o palpite que a tela pede para conferir. */
type SugeridoPelaDescricao = Extract<VinculoDoItemDaNota, { origem: "descricao" }>;
export const sugeridoPelaDescricao = (v: VinculoDoItemDaNota | undefined): v is SugeridoPelaDescricao => v?.situacao === "sugerido" && v.origem === "descricao";

/** O sugerido que a tela trata como palpite — a referência, a descrição semelhante, ou uma origem desconhecida (fail-closed). */
export const sugeridoPorPalpite = (v: VinculoDoItemDaNota | undefined): boolean => v?.situacao === "sugerido" && !ORIGENS_DE_IDENTIDADE.has(v.origem);

/** "Sugerido (descrição semelhante)", "Vínculo lembrado"…: pelos rótulos do domínio; a origem desconhecida não aparece. */
export function rotuloDoVinculo(v: VinculoDoItemDaNota): string {
  const situacao = enumLabel("vinculo_item_nfe", v.situacao);
  return v.situacao === "sugerido" && hasEnumLabel("origem_vinculo_item_nfe", v.origem) ? `${situacao} (${enumLabel("origem_vinculo_item_nfe", v.origem)})` : situacao;
}

/** O "Lembrar este vínculo" PADRÃO de um vínculo: marcado, menos no palpite (a referência, a descrição, a origem desconhecida). */
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
 * O "Lembrar" quando a PESSOA troca o produto de um item (o seletor, o candidato, "Criar produto", o lote). No palpite,
 * a troca é a escolha da pessoa: OUTRO produto ⇒ marcado, como a escolha à mão no item sem vínculo (o que ela corrigiu
 * fica lembrado para a próxima nota); de volta ao produto do palpite ⇒ desmarcado; sem produto ⇒ fica como está. Fora do
 * palpite, `undefined`: o "Lembrar" fica como está (a regra de antes). A pessoa sempre pode mudar a marcação depois.
 */
export function lembrarAoTrocarProduto(v: VinculoDoItemDaNota | undefined, produtoId: string): boolean | undefined {
  if (v?.situacao !== "sugerido" || !sugeridoPorPalpite(v) || produtoId === "") return undefined;
  return produtoId !== v.produto.id;
}

/** O `fatorPelaNota` lido: a pergunta com um motivo que a tela não conhece continua pergunta (`motivo: null`). */
export type FatorPelaNotaLido =
  | Exclude<FatorDoItemDaNota, { origem: "pergunta" | "vinculo" }>
  | { origem: "vinculo"; unidadeDaNota: string; cadastro: { fator: string; tipoFator: TipoFator } | null }
  | { origem: "pergunta"; unidadeDaNota: string; motivo: Extract<FatorDoItemDaNota, { origem: "pergunta" }>["motivo"] | null };

/** O fator que a tela aceita no campo: texto decimal (ponto), até 12 inteiros e 6 casas, maior que zero. */
export const fatorValido = (v: string) => /^\d{1,12}(\.\d{1,6})?$/.test(v) && D(v).gt(0);

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ehTipoFator = (v: unknown): v is TipoFator => v === "multiply" || v === "divide";
const fatorDecimal = (v: unknown): v is string => typeof v === "string" && /^\d+(\.\d+)?$/.test(v) && D(v).gt(0);

/**
 * XML-04 (decisão 318): DE ONDE VEIO O FATOR do item, por PROPRIEDADE PRÓPRIA do vínculo lembrado ou sugerido (a API
 * anterior não o manda ⇒ `null`, a tela de antes). FAIL-CLOSED: forma estranha ou origem que a tela não conhece (uma API
 * mais nova) ⇒ `null`; o cadastro do vínculo fora da forma ⇒ sem cadastro (a tela não afirma um número que não leu).
 */
export function fatorPelaNotaDoVinculo(v: VinculoDoItemDaNota | undefined): FatorPelaNotaLido | null {
  if (!v || (v.situacao !== "lembrado" && v.situacao !== "sugerido") || !Object.hasOwn(v, "fatorPelaNota")) return null;
  const f: unknown = v.fatorPelaNota;
  if (!ehObjeto(f) || typeof f.unidadeDaNota !== "string") return null;
  const unidadeDaNota = f.unidadeDaNota;
  switch (f.origem) {
    case "unidade_principal": case "unidade_do_produto": return { origem: f.origem, unidadeDaNota };
    case "vinculo": {
      const c = f.cadastro;
      return { origem: "vinculo", unidadeDaNota, cadastro: ehObjeto(c) && fatorDecimal(c.fator) && ehTipoFator(c.tipoFator) ? { fator: c.fator, tipoFator: c.tipoFator } : null };
    }
    case "pergunta":
      return { origem: "pergunta", unidadeDaNota, motivo: f.motivo === "unidade_fora_do_cadastro" || f.motivo === "codigo_de_barras_de_outra_unidade" ? f.motivo : null };
    default: return null;
  }
}

/** O fator com que o item NASCE pelo vínculo: o do servidor, ou VAZIO quando o fator é pergunta (XML-04). */
export const fatorInicialDoVinculo = (v: Extract<VinculoDoItemDaNota, { situacao: "lembrado" | "sugerido" }>): string =>
  (fatorPelaNotaDoVinculo(v)?.origem === "pergunta" ? "" : D(v.fator).toFixed());

/**
 * A decisão de um item pelo vínculo do servidor (lembrado/sugerido traz produto e fator — VAZIO quando o fator é
 * pergunta, XML-04; o resto, vazio e fator 1).
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
    fator: comVinculo ? fatorInicialDoVinculo(comVinculo) : "1",
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

/**
 * A linha que pede a conferência do palpite CONHECIDO (a referência do produto e a descrição semelhante), com o testid
 * de cada um; a origem desconhecida não tem linha (o rótulo já é só "Sugerido" e o "Lembrar" vem desmarcado).
 */
export function conferenciaDoPalpite(v: VinculoDoItemDaNota | undefined): { sufixoDoTestid: "sugestao-descricao" | "sugestao-referencia"; texto: string } | null {
  if (v?.situacao !== "sugerido") return null;
  if (v.origem === "descricao") return { sufixoDoTestid: "sugestao-descricao", texto: `Produto sugerido pela ${enumLabel("origem_vinculo_item_nfe", "descricao")}: confira antes de gerar.` };
  if (v.origem === "reference") return { sufixoDoTestid: "sugestao-referencia", texto: `Produto sugerido pela ${enumLabel("origem_vinculo_item_nfe", "reference")}: confira antes de gerar.` };
  return null;
}
