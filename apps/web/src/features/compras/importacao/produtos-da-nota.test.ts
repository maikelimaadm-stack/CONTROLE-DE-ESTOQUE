import { describe, expect, it } from "vitest";
import { CAPACIDADE_CRIAR_PRODUTOS_DA_NOTA, type ItemDaConferenciaNfe, type ProdutoDoVinculo, type VinculoDoItemDaNota } from "@agro/domain";
import {
  corpoDoLote, declaraCriarProdutosDaNota, itensSemLocalGravado, lerProdutosCriadosDaNota, mensagensDaRecusaDoLote, planoDoLote,
  quantidadeDeProdutos, rotuloDoLote, unidadeDoPreenchimento, fornecedorResolvidoParaOLote
} from "./produtos-da-nota";

/**
 * XML-01 (decisão 312) — as contas PURAS do cadastro em lote dos produtos da nota: quem entra na lista, quem fica de
 * fora, a contagem por PRODUTO (`chaveDoProdutoDaNota`), a leitura estrita da capacidade e da resposta 201, e o corpo.
 */

const UN = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCAL = "aaaaaaaa-0000-4000-8000-000000000002";
const GRUPO = "aaaaaaaa-0000-4000-8000-000000000003";
const NATUREZA = "aaaaaaaa-0000-4000-8000-000000000004";
const FORNECEDOR = "aaaaaaaa-0000-4000-8000-000000000005";
const IMPORTACAO = "aaaaaaaa-0000-4000-8000-000000000006";
const P1 = "bbbbbbbb-0000-4000-8000-000000000001";
const P2 = "bbbbbbbb-0000-4000-8000-000000000002";

const produto = (id: string, extra: Partial<ProdutoDoVinculo> = {}): ProdutoDoVinculo =>
  ({ id, codigo: "PRD-1", descricao: "Produto", unidade: "KG", controleLote: "nenhum", controlaEstoque: true, ...extra });
const nenhum = (comUnidade = true): VinculoDoItemDaNota =>
  ({ situacao: "nenhum", preenchimento: { description: "Adubo", ncm_code: "31010000", barcode: null, ...(comUnidade ? { measurement_id: UN } : {}) } });
const itemDaNota = (nItem: number, codigo: string, unidade: string) => ({ nItem, codigo, descricao: `Descrição ${nItem}`, unidade });
const decisao = (nItem: number, extra: { produtoId?: string; geraEstoque?: boolean; armazemId?: string } = {}) =>
  ({ nItem, produtoId: "", geraEstoque: true, armazemId: "", ...extra });

/**
 * A nota de exemplo: 1 e 2 têm o MESMO código e a MESMA unidade (um produto só); 3 sem unidade resolvida (fica de
 * fora); 4 lembrado (não é candidato); 5 ambíguo (não é candidato); 6 sem vínculo, com unidade.
 */
const conf = (vinculos: Record<number, VinculoDoItemDaNota> = {}) => {
  const notaItens = [itemDaNota(1, "ABC", "KG"), itemDaNota(2, "ABC", " kg "), itemDaNota(3, "XYZ", "CX"), itemDaNota(4, "LEM", "UN"), itemDaNota(5, "AMB", "UN"), itemDaNota(6, "DEF", "L")];
  const padrao: Record<number, VinculoDoItemDaNota> = {
    1: nenhum(), 2: nenhum(), 3: nenhum(false),
    4: { situacao: "lembrado", produto: produto(P1), fator: "1", tipoFator: "multiply" },
    5: { situacao: "ambiguo", candidatos: [produto(P1), produto(P2)] },
    6: nenhum()
  };
  const itens: ItemDaConferenciaNfe[] = notaItens.map((i) => ({ nItem: i.nItem, vinculo: vinculos[i.nItem] ?? padrao[i.nItem]!, quantidadeInterna: null, valorUnitarioInterno: null, itemDoPedido: null }));
  return { nota: { itens: notaItens }, itens };
};
const todasAsDecisoes = () => [1, 2, 3, 4, 5, 6].map((n) => decisao(n));

describe("XML-01 U1 a lista: só vínculo `nenhum`, sem produto escolhido na tela; sem unidade ⇒ fica de fora", () => {
  it("entram 1, 2 e 6 (na ordem da nota); 3 fica de fora pela unidade; lembrado e ambíguo não entram", () => {
    const p = planoDoLote(conf(), todasAsDecisoes());
    expect(p.lista.map((i) => i.nItem)).toEqual([1, 2, 6]);
    expect(p.fora).toEqual([{ nItem: 3, codigo: "XYZ", descricao: "Descrição 3", unidade: "CX", motivo: "unidade_nao_resolvida" }]);
  });
  it("o item com produto escolhido na tela não é candidato (nem na lista, nem de fora)", () => {
    const decisoes = todasAsDecisoes().map((d) => (d.nItem === 1 || d.nItem === 3 ? { ...d, produtoId: P2 } : d));
    const p = planoDoLote(conf(), decisoes);
    expect(p.lista.map((i) => i.nItem)).toEqual([2, 6]);
    expect(p.fora).toEqual([]);
  });
  it("measurement_id herdado ou vazio não é unidade resolvida (leitura própria)", () => {
    const herdado = Object.create({ measurement_id: UN }) as { description: string; ncm_code: null; barcode: null };
    Object.assign(herdado, { description: "x", ncm_code: null, barcode: null });
    expect(unidadeDoPreenchimento(herdado)).toBeNull();
    expect(unidadeDoPreenchimento({ description: "x", ncm_code: null, barcode: null, measurement_id: "" })).toBeNull();
    expect(unidadeDoPreenchimento({ description: "x", ncm_code: null, barcode: null, measurement_id: UN })).toBe(UN);
    const p = planoDoLote(conf({ 6: { situacao: "nenhum", preenchimento: herdado } }), todasAsDecisoes());
    expect(p.lista.map((i) => i.nItem)).toEqual([1, 2]);
    expect(p.fora.map((i) => i.nItem)).toEqual([3, 6]);
  });
});

describe("XML-01 U2 a contagem é por PRODUTO (código do fornecedor + unidade), não por item", () => {
  it("1 e 2 (ABC/KG e ABC/' kg ') são um produto; com o 6, dois produtos para três itens", () => {
    const p = planoDoLote(conf(), todasAsDecisoes());
    expect(quantidadeDeProdutos(p.lista)).toBe(2);
    expect(rotuloDoLote(quantidadeDeProdutos(p.lista))).toBe("Criar 2 produtos da nota");
    expect(rotuloDoLote(1)).toBe("Criar 1 produto da nota");
  });
  it("só os marcados contam; mesma unidade com outro código é outro produto", () => {
    const p = planoDoLote(conf(), todasAsDecisoes());
    expect(quantidadeDeProdutos(p.lista, new Set([1, 2]))).toBe(1);
    expect(quantidadeDeProdutos(p.lista, new Set([2, 6]))).toBe(2);
    expect(quantidadeDeProdutos(p.lista, new Set())).toBe(0);
  });
  it("item sem código é sozinho (dois itens sem código = dois produtos)", () => {
    const c = conf();
    c.nota.itens[0] = itemDaNota(1, "", "KG"); c.nota.itens[1] = itemDaNota(2, "  ", "KG");
    expect(quantidadeDeProdutos(planoDoLote(c, todasAsDecisoes()).lista)).toBe(3);
  });
});

describe("XML-01 U3 a capacidade: só `capacidades.criarProdutosDaNota === 1` em propriedade PRÓPRIA", () => {
  it("declarada ⇒ sim (premissa: o leitor não é sempre falso)", () => {
    expect(declaraCriarProdutosDaNota({ capacidades: { criarProdutosDaNota: CAPACIDADE_CRIAR_PRODUTOS_DA_NOTA } })).toBe(true);
  });
  it("sem a chave, herdada, valor 2, valor texto ou forma errada ⇒ não", () => {
    expect(declaraCriarProdutosDaNota({})).toBe(false);
    expect(declaraCriarProdutosDaNota({ capacidades: {} })).toBe(false);
    expect(declaraCriarProdutosDaNota(Object.create({ capacidades: { criarProdutosDaNota: 1 } }))).toBe(false);
    expect(declaraCriarProdutosDaNota({ capacidades: Object.create({ criarProdutosDaNota: 1 }) })).toBe(false);
    expect(declaraCriarProdutosDaNota({ capacidades: { criarProdutosDaNota: 2 } })).toBe(false);
    expect(declaraCriarProdutosDaNota({ capacidades: { criarProdutosDaNota: "1" } })).toBe(false);
    expect(declaraCriarProdutosDaNota({ capacidades: [1] })).toBe(false);
    expect(declaraCriarProdutosDaNota(null)).toBe(false);
  });
});

describe("XML-01 U4 o corpo: só os marcados, o local só com gera estoque, o fornecedor quando há", () => {
  const lista = () => planoDoLote(conf(), todasAsDecisoes()).lista;
  it("os marcados na ordem da nota; local do item que gera estoque; null para o que não gera ou não tem local", () => {
    const decisoes = [decisao(1, { armazemId: LOCAL }), decisao(2, { geraEstoque: false, armazemId: LOCAL }), decisao(6)];
    expect(corpoDoLote({ fornecedorEscolhido: FORNECEDOR }, lista(), decisoes, new Set([6, 1, 2]), GRUPO, NATUREZA)).toEqual({
      group_id: GRUPO, financial_category_id: NATUREZA, fornecedor_id: FORNECEDOR,
      itens: [{ n_item: 1, armazem_id: LOCAL }, { n_item: 2, armazem_id: null }, { n_item: 6, armazem_id: null }]
    });
  });
  it("desmarcado não vai; sem fornecedor escolhido a chave não vai", () => {
    const corpo = corpoDoLote({ fornecedorEscolhido: null }, lista(), todasAsDecisoes(), new Set([2]), GRUPO, NATUREZA);
    expect(corpo).toEqual({ group_id: GRUPO, financial_category_id: NATUREZA, itens: [{ n_item: 2, armazem_id: null }] });
    expect(corpo && Object.hasOwn(corpo, "fornecedor_id")).toBe(false);
  });
  it("sem Grupo, sem Natureza ou sem item marcado ⇒ nada a mandar; marca fora da lista não entra", () => {
    expect(corpoDoLote({ fornecedorEscolhido: null }, lista(), todasAsDecisoes(), new Set([1]), "", NATUREZA)).toBeNull();
    expect(corpoDoLote({ fornecedorEscolhido: null }, lista(), todasAsDecisoes(), new Set([1]), GRUPO, "")).toBeNull();
    expect(corpoDoLote({ fornecedorEscolhido: null }, lista(), todasAsDecisoes(), new Set(), GRUPO, NATUREZA)).toBeNull();
    expect(corpoDoLote({ fornecedorEscolhido: null }, lista(), todasAsDecisoes(), new Set([3, 4]), GRUPO, NATUREZA)).toBeNull();
  });
});

describe("XML-01 U5 a resposta 201 lida ESTRITAMENTE (fora da forma ⇒ null)", () => {
  const resposta = () => ({
    importacao_id: IMPORTACAO,
    produtos: [{ id: P1, codigo: "PRD-10", descricao: "Adubo" }],
    itens: [
      { nItem: 1, produto: produto(P1, { codigo: "PRD-10", descricao: "Adubo" }), localPadrao: LOCAL },
      { nItem: 2, produto: produto(P1, { codigo: "PRD-10", descricao: "Adubo" }), localPadrao: null }
    ]
  });
  const esperado = { importacaoId: IMPORTACAO.toUpperCase(), nItens: [1, 2] };
  it("a resposta do contrato é lida inteira (premissa: o leitor não é sempre null)", () => {
    expect(lerProdutosCriadosDaNota(resposta(), esperado)).toEqual(resposta());
  });
  it("outra importação, item a mais, a menos ou repetido ⇒ null", () => {
    expect(lerProdutosCriadosDaNota({ ...resposta(), importacao_id: P2 }, esperado)).toBeNull();
    expect(lerProdutosCriadosDaNota(resposta(), { ...esperado, nItens: [1, 2, 6] })).toBeNull();
    expect(lerProdutosCriadosDaNota(resposta(), { ...esperado, nItens: [1] })).toBeNull();
    const r = resposta(); r.itens[1] = { ...r.itens[1]!, nItem: 1 };
    expect(lerProdutosCriadosDaNota(r, esperado)).toBeNull();
  });
  it("produto do item que não é um dos criados, ou fora da forma do vínculo ⇒ null", () => {
    const outro = resposta(); outro.itens[0] = { ...outro.itens[0]!, produto: produto(P2) };
    expect(lerProdutosCriadosDaNota(outro, esperado)).toBeNull();
    const comProduto = (p: unknown) => ({ ...resposta(), itens: [{ ...resposta().itens[0]!, produto: p }, resposta().itens[1]!] });
    expect(lerProdutosCriadosDaNota(comProduto({ ...produto(P1), controleLote: "talvez" }), esperado)).toBeNull();
    expect(lerProdutosCriadosDaNota(comProduto({ ...produto(P1), controlaEstoque: "sim" }), esperado)).toBeNull();
    const { unidade: _u, ...semUnidade } = produto(P1);
    expect(lerProdutosCriadosDaNota(comProduto(semUnidade), esperado)).toBeNull();
    expect(lerProdutosCriadosDaNota(comProduto(Object.create(produto(P1))), esperado)).toBeNull();
  });
  it("localPadrao ausente ou que não é texto/null, chave herdada, produtos que não são lista ⇒ null", () => {
    const { localPadrao: _l, ...semLocal } = resposta().itens[0]!;
    expect(lerProdutosCriadosDaNota({ ...resposta(), itens: [semLocal, resposta().itens[1]] }, esperado)).toBeNull();
    expect(lerProdutosCriadosDaNota({ ...resposta(), itens: [{ ...resposta().itens[0], localPadrao: 7 }, resposta().itens[1]] }, esperado)).toBeNull();
    expect(lerProdutosCriadosDaNota(Object.assign(Object.create(resposta()), {}), esperado)).toBeNull();
    expect(lerProdutosCriadosDaNota({ ...resposta(), produtos: {} }, esperado)).toBeNull();
    expect(lerProdutosCriadosDaNota(null, esperado)).toBeNull();
  });
  it("o local pedido que o produto não gravou é dito (não é silencioso para a tela)", () => {
    const corpo = { group_id: GRUPO, financial_category_id: NATUREZA, itens: [{ n_item: 1, armazem_id: LOCAL }, { n_item: 2, armazem_id: LOCAL }] };
    const lida = lerProdutosCriadosDaNota(resposta(), esperado)!;
    expect(itensSemLocalGravado(corpo, lida)).toEqual([2]);
    expect(itensSemLocalGravado({ ...corpo, itens: [{ n_item: 1, armazem_id: LOCAL }, { n_item: 2, armazem_id: null }] }, lida)).toEqual([]);
  });
});

describe("XML-01 U6 a recusa 422 no diálogo: o caminho do item do CORPO ganha o número do item da nota", () => {
  it("itens[1].ncm_code ⇒ Item 6; group_id como veio", () => {
    const corpo = { group_id: GRUPO, financial_category_id: NATUREZA, itens: [{ n_item: 2, armazem_id: null }, { n_item: 6, armazem_id: null }] };
    expect(mensagensDaRecusaDoLote([{ path: "itens[1].ncm_code", message: "NCM não vigente" }, { path: "group_id", message: "Grupo sintético" }, { path: "itens[9]", message: "fora" }], corpo))
      .toEqual(["Item 6: NCM não vigente", "Grupo sintético", "fora"]);
  });
});

describe("XML-01 U7 o fornecedor resolvido para o lote: escolhido, ou a nota sem candidatos (achado A5-1 do cético)", () => {
  it("escolhido ⇒ sim; sem candidatos (`nenhum`) ⇒ sim", () => {
    expect(fornecedorResolvidoParaOLote({ fornecedorEscolhido: "f1", parceiro: { situacao: "encontrado", id: "f1", nome: "F", documento: "1" } })).toBe(true);
    expect(fornecedorResolvidoParaOLote({ fornecedorEscolhido: "f2", parceiro: { situacao: "ambiguo", candidatos: [] } })).toBe(true);
    expect(fornecedorResolvidoParaOLote({ fornecedorEscolhido: null, parceiro: { situacao: "nenhum", preenchimento: {} as never } })).toBe(true);
  });
  it("ambíguo sem escolha, ou o cadastro que não é Fornecedor ⇒ não (os vínculos do fornecedor não foram perguntados)", () => {
    expect(fornecedorResolvidoParaOLote({ fornecedorEscolhido: null, parceiro: { situacao: "ambiguo", candidatos: [] } })).toBe(false);
    expect(fornecedorResolvidoParaOLote({ fornecedorEscolhido: "", parceiro: { situacao: "ambiguo", candidatos: [] } })).toBe(false);
    expect(fornecedorResolvidoParaOLote({ fornecedorEscolhido: null, parceiro: { situacao: "nao_fornecedor", id: "p", nome: "P" } })).toBe(false);
  });
});
