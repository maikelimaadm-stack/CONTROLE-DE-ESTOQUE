import {
  CAPACIDADE_CRIAR_PRODUTOS_DA_NOTA, chaveDoProdutoDaNota,
  type ConferenciaDaImportacaoNfe, type CriarProdutosDaNota, type ItemDaConferenciaNfe, type ItemDaNota, type PreenchimentoDoProduto,
  type ProdutoDoVinculo, type ProdutosCriadosDaNota
} from "@agro/domain";
import type { RecusaNoCampo } from "./api";
import type { DecisaoDoItemNaTela } from "./estado";

/**
 * O CADASTRO EM LOTE DOS PRODUTOS DA NOTA (XML-01, decisão 312) — contas PURAS, sem React e sem rede (a aba de itens
 * só as chama; o teste de unidade as prova uma a uma).
 *
 * A regra do dono: o produto que nasce de uma nota nasce com o que a NOTA já disse (descrição, NCM, código de barras,
 * unidade) e com o que a IMPORTAÇÃO já decidiu (o Local de estoque do item). Só o Grupo e a Natureza de custo são
 * pergunta — UMA vez para a nota. Quem cria é o SERVIDOR (`POST /compras/importacoes/:id/criar-produtos`): aqui moram
 * só a LISTA que a tela oferece, o CORPO que ela manda e a LEITURA ESTRITA do que a API declara e responde.
 *
 *   · CAPACIDADE (`declaraCriarProdutosDaNota`): a conferência declara `capacidades.criarProdutosDaNota === 1`, em
 *     propriedade PRÓPRIA (nunca herdada). Sem a declaração (a API anterior) não há lote: a aba fica como era.
 *   · CANDIDATO (`planoDoLote`): item com vínculo `nenhum` E sem produto escolhido na tela. Com a unidade resolvida
 *     pelo servidor (`preenchimento.measurement_id`) ⇒ entra na lista; sem ⇒ fica de fora (crie pelo item).
 *   · CONTAGEM (`quantidadeDeProdutos`): por PRODUTO, não por item — dois itens com o mesmo código do fornecedor e a
 *     mesma unidade são UM produto (`chaveDoProdutoDaNota`, a mesma chave do servidor).
 *   · CORPO (`corpoDoLote`): só DECISÕES — o Grupo, a Natureza, o fornecedor escolhido na conferência (quando houver)
 *     e, por item MARCADO, o Local de estoque (só quando o item gera estoque). Os dados do produto vêm do XML guardado.
 *   · RESPOSTA (`lerProdutosCriadosDaNota`): conferida antes de mudar a tela; fora da forma ⇒ `null` (erro), nunca
 *     uma tela meio atualizada em nome do servidor.
 */

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ehTexto = (v: unknown): v is string => typeof v === "string";
const propria = (o: Record<string, unknown>, chave: string): unknown => (Object.hasOwn(o, chave) ? o[chave] : undefined);

/** A conferência declara a rota do lote (`capacidades.criarProdutosDaNota === CAPACIDADE_CRIAR_PRODUTOS_DA_NOTA`, própria)? */
export function declaraCriarProdutosDaNota(conf: unknown): boolean {
  if (!ehObjeto(conf)) return false;
  const capacidades = propria(conf, "capacidades");
  return ehObjeto(capacidades) && propria(capacidades, "criarProdutosDaNota") === CAPACIDADE_CRIAR_PRODUTOS_DA_NOTA;
}

/** A unidade do cadastro que o servidor resolveu pelo uCom (`measurement_id`, própria e não vazia); senão `null`. */
export function unidadeDoPreenchimento(p: PreenchimentoDoProduto): string | null {
  const id = propria(p as unknown as Record<string, unknown>, "measurement_id");
  return ehTexto(id) && id.trim() !== "" ? id : null;
}

/** Um item da nota que o lote cria: o que a nota diz dele e a chave do PRODUTO que ele pede. */
export interface ItemDoLote { nItem: number; codigo: string; descricao: string; unidade: string; chave: string }
/** Um item sem vínculo que NÃO entra no lote (a unidade da nota não corresponde a uma unidade do cadastro). */
export interface ItemForaDoLote { nItem: number; codigo: string; descricao: string; unidade: string; motivo: "unidade_nao_resolvida" }
export interface PlanoDoLote { lista: ItemDoLote[]; fora: ItemForaDoLote[] }

/** Quem entra no lote e quem fica de fora, na ordem da nota. Item com produto escolhido na tela não é candidato. */
export function planoDoLote(
  conf: { nota: { itens: readonly Pick<ItemDaNota, "nItem" | "codigo" | "descricao" | "unidade">[] }; itens: readonly Pick<ItemDaConferenciaNfe, "nItem" | "vinculo">[] },
  decisoes: readonly Pick<DecisaoDoItemNaTela, "nItem" | "produtoId">[]
): PlanoDoLote {
  const lista: ItemDoLote[] = [];
  const fora: ItemForaDoLote[] = [];
  for (const item of conf.nota.itens) {
    const v = conf.itens.find((x) => x.nItem === item.nItem)?.vinculo;
    const d = decisoes.find((x) => x.nItem === item.nItem);
    if (!v || v.situacao !== "nenhum" || !d || d.produtoId) continue;
    const base = { nItem: item.nItem, codigo: item.codigo, descricao: item.descricao, unidade: item.unidade };
    if (unidadeDoPreenchimento(v.preenchimento)) lista.push({ ...base, chave: chaveDoProdutoDaNota(item) });
    else fora.push({ ...base, motivo: "unidade_nao_resolvida" });
  }
  return { lista, fora };
}

/** Quantos PRODUTOS o lote cria: as chaves distintas dos itens (só os marcados, quando `marcados` vem). */
export function quantidadeDeProdutos(lista: readonly ItemDoLote[], marcados?: ReadonlySet<number>): number {
  return new Set(lista.filter((i) => !marcados || marcados.has(i.nItem)).map((i) => i.chave)).size;
}

/** O texto do botão do lote: "Criar 1 produto da nota" / "Criar 6 produtos da nota". */
export const rotuloDoLote = (n: number) => `Criar ${n} ${n === 1 ? "produto" : "produtos"} da nota`;

/**
 * O corpo do `POST …/criar-produtos`: os itens MARCADOS da lista (na ordem da nota), o Local de estoque do item só
 * quando ele gera estoque, e o fornecedor escolhido na conferência só quando há um. Sem Grupo, sem Natureza ou sem
 * item marcado ⇒ `null` (não há o que mandar).
 */
export function corpoDoLote(
  conf: Pick<ConferenciaDaImportacaoNfe, "fornecedorEscolhido">,
  lista: readonly ItemDoLote[],
  decisoes: readonly Pick<DecisaoDoItemNaTela, "nItem" | "geraEstoque" | "armazemId">[],
  marcados: ReadonlySet<number>,
  grupoId: string,
  naturezaId: string
): CriarProdutosDaNota | null {
  if (!grupoId || !naturezaId) return null;
  const itens = lista.filter((i) => marcados.has(i.nItem)).map((i) => {
    const d = decisoes.find((x) => x.nItem === i.nItem);
    return { n_item: i.nItem, armazem_id: d?.geraEstoque ? d.armazemId || null : null };
  });
  if (itens.length === 0) return null;
  return { group_id: grupoId, financial_category_id: naturezaId, ...(conf.fornecedorEscolhido ? { fornecedor_id: conf.fornecedorEscolhido } : {}), itens };
}

const CONTROLES = new Set(["nenhum", "lote", "lote_validade"]);

function lerProdutoDoVinculo(v: unknown): ProdutoDoVinculo | null {
  if (!ehObjeto(v)) return null;
  const id = propria(v, "id"); const codigo = propria(v, "codigo"); const descricao = propria(v, "descricao");
  const unidade = propria(v, "unidade"); const controleLote = propria(v, "controleLote"); const controlaEstoque = propria(v, "controlaEstoque");
  if (!ehTexto(id) || !id || !ehTexto(codigo) || !ehTexto(descricao)) return null;
  if (!(unidade === null || ehTexto(unidade))) return null;
  if (!ehTexto(controleLote) || !CONTROLES.has(controleLote) || typeof controlaEstoque !== "boolean") return null;
  return { id, codigo, descricao, unidade, controleLote: controleLote as ProdutoDoVinculo["controleLote"], controlaEstoque };
}

/**
 * A resposta 201 do lote conferida ANTES de mudar a tela: a importação pedida, os produtos criados e UM item por item
 * enviado (nem a mais, nem a menos, sem repetir), cada um com o produto (que é um dos criados) e o local gravado
 * (texto ou `null`). Fora da forma ⇒ `null`: a tela trata como erro e não inventa nada em nome do servidor.
 */
export function lerProdutosCriadosDaNota(corpo: unknown, esperado: { importacaoId: string; nItens: readonly number[] }): ProdutosCriadosDaNota | null {
  if (!ehObjeto(corpo)) return null;
  const importacaoId = propria(corpo, "importacao_id"); const produtosBrutos = propria(corpo, "produtos"); const itensBrutos = propria(corpo, "itens");
  if (!ehTexto(importacaoId) || importacaoId.toLowerCase() !== esperado.importacaoId.toLowerCase()) return null;
  if (!Array.isArray(produtosBrutos) || !Array.isArray(itensBrutos)) return null;
  const produtos: ProdutosCriadosDaNota["produtos"] = [];
  for (const p of produtosBrutos as unknown[]) {
    if (!ehObjeto(p)) return null;
    const id = propria(p, "id"); const codigo = propria(p, "codigo"); const descricao = propria(p, "descricao");
    if (!ehTexto(id) || !id || !ehTexto(codigo) || !ehTexto(descricao)) return null;
    produtos.push({ id, codigo, descricao });
  }
  const criados = new Set(produtos.map((p) => p.id.toLowerCase()));
  const enviados = new Set(esperado.nItens);
  const vistos = new Set<number>();
  const itens: ProdutosCriadosDaNota["itens"] = [];
  for (const i of itensBrutos as unknown[]) {
    if (!ehObjeto(i)) return null;
    const nItem = propria(i, "nItem"); const localPadrao = propria(i, "localPadrao");
    if (typeof nItem !== "number" || !enviados.has(nItem) || vistos.has(nItem)) return null;
    if (!(localPadrao === null || ehTexto(localPadrao))) return null;
    const produto = lerProdutoDoVinculo(propria(i, "produto"));
    if (!produto || !criados.has(produto.id.toLowerCase())) return null;
    vistos.add(nItem);
    itens.push({ nItem, produto, localPadrao });
  }
  if (vistos.size !== enviados.size) return null;
  return { importacao_id: importacaoId, produtos, itens };
}

/** Os itens que pediram um Local de estoque (o corpo) e cujo produto nasceu sem ele (`localPadrao: null` na resposta). */
export function itensSemLocalGravado(corpo: CriarProdutosDaNota, resposta: ProdutosCriadosDaNota): number[] {
  const pedido = new Set(corpo.itens.filter((i) => i.armazem_id).map((i) => i.n_item));
  return resposta.itens.filter((i) => pedido.has(i.nItem) && i.localPadrao === null).map((i) => i.nItem);
}

/**
 * As mensagens de uma recusa 422 no diálogo do lote. O caminho `itens[i]…` é o i-ésimo item do CORPO enviado: a
 * mensagem ganha o número do item da nota ("Item 5: …"). Outro caminho (Grupo, Natureza, fornecedor), a mensagem como veio.
 */
export function mensagensDaRecusaDoLote(recusas: readonly RecusaNoCampo[], corpo: CriarProdutosDaNota): string[] {
  return recusas.map((r) => {
    const m = /^itens\[(\d+)\]/.exec(r.path);
    const item = m ? corpo.itens[Number(m[1])] : undefined;
    return item ? `Item ${item.n_item}: ${r.message}` : r.message;
  });
}
