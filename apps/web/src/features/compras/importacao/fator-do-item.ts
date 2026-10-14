import { D } from "@agro/shared";
import { enumLabel, type TipoFator, type VinculoDoItemDaNota } from "@agro/domain";
import { num } from "@/lib/utils";
import type { DecisaoDoItemNaTela } from "./estado";
import { fatorPelaNotaDoVinculo, fatorValido, mostraOFatorDoVinculo, type FatorPelaNotaLido } from "./vinculo-do-item";

/**
 * DE ONDE VEIO O FATOR DO ITEM, NA TELA (XML-04, decisão 318: "o fator vem do cadastro") — leituras PURAS, sem React e
 * sem rede (a aba de itens e o estado da conferência só as chamam; o teste de unidade as prova uma a uma).
 *
 * O servidor diz a origem (`vinculo.fatorPelaNota`, lido por propriedade própria em `fatorPelaNotaDoVinculo`); a tela a
 * diz PERTO DO CAMPO e enquanto o campo mostra o fator dessa origem, para o produto do vínculo:
 *   · `unidade_principal` / `unidade_do_produto` — do cadastro, pela unidade da nota;
 *   · `vinculo` — do vínculo lembrado; o cadastro que diz OUTRO fator para a unidade vira AVISO com os dois números
 *     (vale o do vínculo);
 *   · `pergunta` — o campo nasce VAZIO (`fatorInicialDoVinculo`) e a pergunta diz por quê (a unidade da nota fora do
 *     cadastro do produto; ou a unidade da nota que, pela régua das unidades, é a da ORGANIZAÇÃO, com o produto
 *     cadastrado na do SISTEMA de mesmo símbolo); o item é pendência (a de sempre, o fator inválido) até a pessoa
 *     digitar um fator válido. O código de barras só acha o produto: nunca dá fator nem põe o fator em dúvida.
 * O fator continua EDITÁVEL: a pessoa sempre ganha. O fator que ela mudou (outro número ou outra conversão; na pergunta,
 * o primeiro fator válido) é "informado na tela" — sem aviso e sem pergunta. OUTRO produto no item (a origem do servidor
 * é do produto do vínculo): o campo sem fator válido (a troca o esvaziou, `fatorAoTrocarProduto`) é a pergunta do
 * produto trocado; com fator, nenhuma origem; sem produto, nada (a pendência é o produto). Sem `fatorPelaNota` (a API
 * anterior) ⇒ `null`: a aba de antes.
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

/** A pergunta do produto trocado: o fator do servidor era do produto do vínculo, e a troca esvaziou o campo. */
const PERGUNTA_DO_PRODUTO_TROCADO = "O produto foi trocado: informe o fator do produto escolhido.";

/**
 * A pergunta do fator, pelo motivo (motivo desconhecido ⇒ a pergunta sem o porquê). A unidade homônima diz as duas
 * unidades de mesmo símbolo — a da organização (a da nota, pela régua) e a do sistema (a do cadastro do produto); sem a
 * unidade da nota (o servidor não manda esse motivo assim), a tela não afirma o homônimo: o texto genérico.
 */
function perguntaDoFator(f: Extract<FatorPelaNotaLido, { origem: "pergunta" }>): string {
  const u = f.unidadeDaNota;
  if (f.motivo === "unidade_homonima_da_organizacao" && u) {
    return `A unidade ${u} da nota é a da organização, e o produto está cadastrado na ${u} do sistema: informe o fator.`;
  }
  if (f.motivo === "unidade_fora_do_cadastro") {
    return u ? `A unidade ${u} da nota não está no cadastro do produto: informe o fator.` : "A nota não traz a unidade do item: informe o fator.";
  }
  return "O cadastro do produto não diz o fator desta unidade da nota: informe o fator.";
}

/** A origem do fator que o campo mostra, para o item com a decisão `d` (`null`: a tela não diz origem nenhuma). */
export function fatorNaTela(v: VinculoDoItemDaNota | undefined, d: Pick<DecisaoDoItemNaTela, "produtoId" | "fator" | "tipoFator">): FatorNaTela | null {
  const f = fatorPelaNotaDoVinculo(v);
  if (!f || !v || (v.situacao !== "lembrado" && v.situacao !== "sugerido")) return null;
  if (d.produtoId !== v.produto.id) {
    return d.produtoId !== "" && !fatorValido(d.fator) ? { origem: "pergunta", texto: null, aviso: null, pergunta: PERGUNTA_DO_PRODUTO_TROCADO } : null;
  }
  const informado: FatorNaTela = { origem: "informado", texto: "Fator informado na tela.", aviso: null, pergunta: null };
  if (f.origem === "pergunta") {
    return fatorValido(d.fator) ? informado : { origem: "pergunta", texto: null, aviso: null, pergunta: perguntaDoFator(f) };
  }
  if (!mostraOFatorDoVinculo(v, d)) return informado;
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
          ? `O vínculo lembrado usa o fator ${numeroDoFator(v.fator)} (${conversao(v.tipoFator)}) e o cadastro do produto diz ${numeroDoFator(f.cadastro.fator)} (${conversao(f.cadastro.tipoFator)}) para a unidade ${u}: vale o do vínculo.`
          : null
      };
  }
}
