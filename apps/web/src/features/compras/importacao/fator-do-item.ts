import { D } from "@agro/shared";
import { enumLabel, type TipoFator, type VinculoDoItemDaNota } from "@agro/domain";
import { num } from "@/lib/utils";
import type { DecisaoDoItemNaTela } from "./estado";
import { fatorPelaNotaDoVinculo, fatorValido } from "./vinculo-do-item";

/**
 * DE ONDE VEIO O FATOR DO ITEM, NA TELA (XML-04, decisão 318: "o fator vem do cadastro") — leituras PURAS, sem React e
 * sem rede (a aba de itens e o estado da conferência só as chamam; o teste de unidade as prova uma a uma).
 *
 * O servidor diz a origem (`vinculo.fatorPelaNota`, lido por propriedade própria em `fatorPelaNotaDoVinculo`); a tela a
 * diz PERTO DO CAMPO e enquanto o campo mostra o fator dessa origem, para o produto do vínculo:
 *   · `unidade_principal` / `unidade_do_produto` — do cadastro, pela unidade da nota;
 *   · `vinculo` — do vínculo lembrado; o cadastro que diz OUTRO fator para a unidade vira AVISO com os dois números
 *     (vale o do vínculo: a pessoa confere);
 *   · `pergunta` — o campo nasce VAZIO (`fatorInicialDoVinculo`) e a pergunta diz por quê; o item é pendência (a de
 *     sempre, o fator inválido) até a pessoa digitar um fator válido.
 * O fator continua EDITÁVEL: a pessoa sempre ganha. O fator que ela mudou (outro número ou outra conversão; na pergunta,
 * o primeiro fator válido) é "informado na tela" — sem aviso e sem pergunta. Outro produto no item ⇒ nenhuma origem (a
 * do servidor é do produto do vínculo). Sem `fatorPelaNota` (a API anterior) ⇒ `null`: a aba de antes.
 */

export type OrigemDoFatorNaTela = "unidade_principal" | "unidade_do_produto" | "vinculo" | "pergunta" | "informado";

export interface FatorNaTela {
  origem: OrigemDoFatorNaTela;
  /** A linha neutra: de onde veio o fator do campo. */
  texto: string | null;
  /** O vínculo lembrado contra o cadastro: os dois números. */
  aviso: string | null;
  /** O fator a informar: o porquê. */
  pergunta: string | null;
}

/** O fator como número da tela ("12", "0,5", "1.000"), com as casas que ele tem. */
const numeroDoFator = (f: string) => { const d = D(f); return num(d.toFixed(), d.decimalPlaces()); };
const conversao = (t: TipoFator) => enumLabel("tipo_fator_conversao", t);

/** A pergunta do fator, pelo motivo (motivo desconhecido ⇒ a pergunta sem o porquê). */
function perguntaDoFator(unidade: string, motivo: "unidade_fora_do_cadastro" | "codigo_de_barras_de_outra_unidade" | null): string {
  if (motivo === "codigo_de_barras_de_outra_unidade") return "O código de barras da nota é de outra unidade do produto: informe o fator.";
  if (motivo === "unidade_fora_do_cadastro") {
    return unidade ? `A unidade ${unidade} da nota não está no cadastro do produto: informe o fator.` : "A nota não traz a unidade do item: informe o fator.";
  }
  return "O cadastro do produto não diz o fator desta unidade da nota: informe o fator.";
}

/** A origem do fator que o campo mostra, para o item com a decisão `d` (`null`: a tela não diz origem nenhuma). */
export function fatorNaTela(v: VinculoDoItemDaNota | undefined, d: Pick<DecisaoDoItemNaTela, "produtoId" | "fator" | "tipoFator">): FatorNaTela | null {
  const f = fatorPelaNotaDoVinculo(v);
  if (!f || !v || (v.situacao !== "lembrado" && v.situacao !== "sugerido") || d.produtoId !== v.produto.id) return null;
  const informado: FatorNaTela = { origem: "informado", texto: "Fator informado na tela.", aviso: null, pergunta: null };
  if (f.origem === "pergunta") {
    return fatorValido(d.fator) ? informado : { origem: "pergunta", texto: null, aviso: null, pergunta: perguntaDoFator(f.unidadeDaNota, f.motivo) };
  }
  const oDoServidor = fatorValido(d.fator) && D(d.fator).eq(D(v.fator)) && d.tipoFator === v.tipoFator;
  if (!oDoServidor) return informado;
  const u = f.unidadeDaNota;
  switch (f.origem) {
    case "unidade_principal":
      return { origem: f.origem, texto: `Fator do cadastro: unidade principal do produto${u ? ` (${u})` : ""}.`, aviso: null, pergunta: null };
    case "unidade_do_produto":
      return { origem: f.origem, texto: `Fator do cadastro: unidade ${u} do produto.`, aviso: null, pergunta: null };
    case "vinculo":
      return {
        origem: "vinculo", texto: "Fator do vínculo lembrado.", pergunta: null,
        aviso: f.cadastro
          ? `O vínculo lembrado usa o fator ${numeroDoFator(v.fator)} (${conversao(v.tipoFator)}) e o cadastro do produto diz ${numeroDoFator(f.cadastro.fator)} (${conversao(f.cadastro.tipoFator)}) para a unidade ${u}: vale o do vínculo; confira.`
          : null
      };
  }
}
