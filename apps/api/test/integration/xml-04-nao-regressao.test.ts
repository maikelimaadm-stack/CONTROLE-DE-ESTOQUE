import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { DivergenciaDaImportacaoNfe, VinculoDoItemDaNota } from "@agro/domain";
import { c, iniciar, encerrar, unico } from "./top-config-08-ajuda.js";
import { notaSintetica, importada, fornecedorComDocumento, type ItemSintetico } from "./f7-ajuda.js";
import { prepararXml01, conferenciaLida, vinculoDo, eanNovo, emitenteNovo, unidadesQueCasam, x, type Conferencia } from "./xml-01-ajuda.js";

/**
 * XML-04 (decisão 318) — A NÃO-REGRESSÃO DO FATOR (o ponto 1 do cético): toda nota cujo fator a MAIN já acertava
 * continua com o MESMO fator — o mesmo número, o mesmo tipo, a mesma quantidade e o mesmo unitário internos.
 *
 * A main tirava o fator do CÓDIGO NO FORNECEDOR da unidade de compra da FICHA do fornecedor
 * (`produto_fornecedores.measurement_id`), o do CÓDIGO DE BARRAS da unidade DONA do código e o do LEMBRADO do vínculo; a
 * XML-04 tira os dois primeiros SÓ do uCom DA NOTA pelo cadastro (`produto_unidades`, só a linha VIVA e DE COMPRA, pela
 * régua de unidade da 312) e mantém o do vínculo — a regra 3.1 à letra (decisão do Maike): o código de barras só ACHA o
 * produto, nunca dá fator nem o põe em dúvida. Onde a ficha e a nota dizem a MESMA unidade, a linha é de compra e o uCom
 * é uma unidade do cadastro, o número não pode mudar — diga o cEAN da nota a unidade que disser:
 *
 *   XML4-NR1 o MESMO fator da main: o produto em KG com a alternativa SC = 50 (multiplica), pelo código no fornecedor
 *            (ficha em SC), pelo código de barras da SC e pelo vínculo lembrado (50); a principal (KG) pelo código no
 *            fornecedor e pelo código de barras do produto (1); uma alternativa que DIVIDE (CX = 4); e o cEAN de OUTRA
 *            unidade com a ficha e a nota na mesma (B18 e B20 do cético: 50 e 1) — as unidades do SEED (do sistema),
 *            o mundo real;
 *   XML4-NR2 o que MUDA, de propósito, com o número da main escrito ao lado — e em nenhum caso a fatia dá um número
 *            ERRADO: ou segue a nota pelo cadastro, ou PERGUNTA:
 *              (a) a ficha (ou o código de barras) diz uma unidade e a nota diz outra — a main seguia a ficha (ou a
 *                  unidade dona do código), a XML-04 segue o uCom da nota pelo cadastro (B11, B10, B12 e B5 do cético);
 *              (b) a main dava o número certo e a XML-04 PERGUNTA de propósito (os casos B1, B4, B2 e B7 do cético):
 *                  a linha da unidade é SÓ DE VENDA (pela ficha e pelo código de barras — a 3.1 só aceita linha de
 *                  compra; o cEAN não entra); o uCom não é unidade do cadastro ("SACO" — a 3.1 exige que o uCom case);
 *                  a unidade da ORGANIZAÇÃO tem o mesmo símbolo da do SISTEMA em que estão a linha e a ficha (a 3.3: a
 *                  da organização vence, fail-closed — e a pergunta diz esse porquê, `unidade_homonima_da_organizacao`).
 *
 * "O mesmo da main" não é suposição: as tabelas `NA_MAIN_*` foram OBTIDAS rodando ESTE cenário (o arquivo sem as
 * asserções de `fatorPelaNota` e das divergências do fator, que a main não tem) contra o código de `origin/main`
 * (33291879, migrations até a 0063), no mesmo banco de teste. Aqui o código desta fatia tem de dar a MESMA tabela do
 * NR1, e no NR2 a tabela da main fica escrita ao lado da nova. A testemunha do cenário é o banco (superusuário).
 */

beforeAll(async () => { await iniciar(); await prepararXml01(); }, 240_000);
afterAll(encerrar);

// ─────────────── o cadastro (superusuário) ───────────────

/** A unidade do SEED (do sistema) — premissa: o uCom casa com ela e SÓ com ela (nenhuma da organização). */
async function unidadeDoSeed(simbolo: string): Promise<string> {
  const casam = await unidadesQueCasam(simbolo);
  expect(casam, `premissa: ${simbolo} casa com UMA unidade, a do sistema (seed)`).toEqual({ organizacao: [], sistema: [expect.any(String)] });
  return casam.sistema[0]!;
}

interface Produto { id: string; codigo: string }
/** Um produto NOVO (no molde de um do seed) com a unidade PRINCIPAL e o código de barras dados. */
async function produtoNovo(principal: string, barcode: string | null = null): Promise<Produto> {
  const m = (await c.admin.query<Record<string, string>>("select group_id, category_id, kind_id, financial_category_id from erp.products where id=$1", [c.I.product2])).rows[0]!;
  const r = await c.admin.query<{ id: string; code: string; measurement_id: string; barcode: string | null }>(
    `insert into erp.products (organization_id, code, description, measurement_id, group_id, category_id, kind_id, financial_category_id,
                               control_stock, controle_lote, has_lot, is_active, barcode)
     values ($1, $2, $3, $4, $5, $6, $7, $8, true, 'nenhum', false, true, $9) returning id::text as id, code, measurement_id::text, barcode`,
    [c.h.demo.orgId, `NR${unico()}`, `NAO REGRESSAO ${unico()} ${unico()} ${unico()}`, principal, m.group_id, m.category_id, m.kind_id, m.financial_category_id, barcode]);
  expect([r.rows[0]!.measurement_id, r.rows[0]!.barcode], "premissa: a unidade principal e o código de barras são os pedidos").toEqual([principal, barcode]);
  return { id: r.rows[0]!.id, codigo: r.rows[0]!.code };
}

/** Uma unidade ALTERNATIVA do produto (`erp.produto_unidades`): viva e de venda; de compra também, a menos que `soDeVenda`. */
async function alternativa(produtoId: string, measurementId: string, fator: string, tipo: "multiply" | "divide", codigoBarras: string | null = null,
  o: { soDeVenda?: boolean } = {}): Promise<void> {
  const compra = !o.soDeVenda;
  const r = await c.admin.query<{ fator: string; tipo_fator: string; uso_compra: boolean; uso_venda: boolean }>(
    `insert into erp.produto_unidades (organization_id, product_id, measurement_id, tipo_fator, fator, codigo_barras, uso_compra, uso_venda)
     values ($1, $2, $3, $4, $5::numeric, $6, $7, true) returning fator::text, tipo_fator, uso_compra, uso_venda`,
    [c.h.demo.orgId, produtoId, measurementId, tipo, fator, codigoBarras, compra]);
  expect([r.rows[0]!.tipo_fator, r.rows[0]!.uso_compra, r.rows[0]!.uso_venda], "premissa: a alternativa nasceu com o tipo e o uso pedidos").toEqual([tipo, compra, true]);
}

/**
 * O MESMO símbolo NOVO (6 posições, o máximo do uCom normalizado) numa unidade do SISTEMA e numa da ORGANIZAÇÃO da demo.
 * Devolve as duas; premissa: antes, o símbolo não casava com nada, e depois casa com exatamente essas duas.
 */
async function mesmoSimboloNoSistemaENaOrganizacao(): Promise<{ simbolo: string; doSistema: string; daOrganizacao: string }> {
  const simbolo = `Z${unico().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5)}`;
  expect(await unidadesQueCasam(simbolo), `premissa: o símbolo ${simbolo} é novo`).toEqual({ organizacao: [], sistema: [] });
  const nova = async (orgId: string | null) => (await c.admin.query<{ id: string }>(
    "insert into erp.measurement_units (organization_id, symbol, name, decimals) values ($1, $2, $3, 2) returning id::text as id",
    [orgId, simbolo, `NAO REGRESSAO ${unico()}`])).rows[0]!.id;
  const doSistema = await nova(null);
  const daOrganizacao = await nova(c.h.demo.orgId);
  expect(await unidadesQueCasam(simbolo), "premissa: o símbolo casa com UMA da organização e UMA do sistema").toEqual({ organizacao: [daOrganizacao], sistema: [doSistema] });
  return { simbolo, doSistema, daOrganizacao };
}

/** A FICHA do produto no fornecedor (`produto_fornecedores`): o código no fornecedor e a unidade de compra (ou nenhuma). */
async function fichaDoFornecedor(produtoId: string, fornecedorId: string, codigo: string, unidadeDeCompra: string | null): Promise<void> {
  await c.admin.query("insert into erp.produto_fornecedores (organization_id, product_id, person_id, codigo_no_fornecedor, measurement_id) values ($1, $2, $3, $4, $5)",
    [c.h.demo.orgId, produtoId, fornecedorId, codigo, unidadeDeCompra]);
}

/** O vínculo LEMBRADO (fornecedor + código + unidade → produto e fator), gravado como o "Gerar compra" grava. */
async function lembrar(fornecedorId: string, codigo: string, unidadeDaNota: string, produtoId: string, fator: string): Promise<void> {
  await c.admin.query(
    `insert into erp.produto_fornecedor_vinculos (organization_id, fornecedor_id, codigo_fornecedor, unidade_fornecedor, produto_id, tipo_fator, fator, criado_por)
     values ($1, $2, $3, $4, $5, 'multiply', $6::numeric, $7)`, [c.h.demo.orgId, fornecedorId, codigo, unidadeDaNota, produtoId, fator, x.adminId]);
}

// ─────────────── a nota e a leitura ───────────────

/** Um item: 2 na unidade dada, 10,00 cada (vProd 20,00); sem GTIN, a menos que o caso dê um. */
const item = (codigo: string, unidadeDaNota: string, ean = "SEM GTIN"): ItemSintetico => ({
  codigo, descricao: `ITEM NAO REGRESSAO ${unico()} ${unico()} ${unico()} ${unico()}`, unidade: unidadeDaNota, quantidade: "2.0000",
  valorUnitario: "10.0000000000", valorProdutos: "20.00", ean,
});

/** Uma nota NOVA (emitente novo, com cadastro de fornecedor) importada na 1ª empresa do seed. */
async function notaImportada(itens: ItemSintetico[]): Promise<{ id: string; fornecedor: string }> {
  const emitente = emitenteNovo();
  const fornecedor = await fornecedorComDocumento(emitente);
  const imp = await importada(notaSintetica({ emitenteCnpj: emitente, itens }).xml, { empresaId: c.I.empresa });
  return { id: imp.id, fornecedor };
}

type ComProduto = Extract<VinculoDoItemDaNota, { situacao: "lembrado" | "sugerido" }>;
/** O vínculo do item com produto (premissa: lembrado ou sugerido). */
function comProduto(conf: Conferencia, nItem: number): ComProduto {
  const v = vinculoDo(conf, nItem);
  expect(["lembrado", "sugerido"], `premissa: o item ${nItem} tem produto — ${JSON.stringify(v)}`).toContain(v.situacao);
  return v as ComProduto;
}
/** O FATOR do item como a main e a XML-04 o entregam: caminho, produto, fator, tipo, quantidade e unitário internos. */
function fatorNaConferencia(conf: Conferencia, nItem: number) {
  const v = comProduto(conf, nItem);
  const i = conf.itens.find((x0) => x0.nItem === nItem)!;
  return {
    caminho: v.situacao === "lembrado" ? "lembrado" : v.origem, produto: v.produto.id, fator: v.fator, tipoFator: v.tipoFator,
    quantidadeInterna: i.quantidadeInterna, valorUnitarioInterno: i.valorUnitarioInterno,
  };
}
/** As divergências do FATOR de um item (as duas da XML-04). */
const doFator = (conf: Conferencia, nItem: number): DivergenciaDaImportacaoNfe[] =>
  conf.divergencias.filter((d) => d.nItem === nItem && d.codigo.startsWith("fator_"));

// ═════════════════════════════════════ XML4-NR1 o mesmo fator da main ═════════════════════════════════════

/**
 * O fator que a MAIN entrega no cenário do NR1 (obtido em `origin/main`), sem o produto (que é do caso). Os dois últimos
 * (B18 e B20 do cético) entraram com a decisão do Maike ("a 3.1 à letra") e foram OBTIDOS do mesmo jeito: o cenário
 * rodado contra o código da main.
 */
const NA_MAIN_NR1 = [
  { caminho: "codigo_fornecedor", fator: "50.000000", tipoFator: "multiply", quantidadeInterna: "100.0000", valorUnitarioInterno: "0.200000" },
  { caminho: "codigo_barras", fator: "50.000000", tipoFator: "multiply", quantidadeInterna: "100.0000", valorUnitarioInterno: "0.200000" },
  { caminho: "lembrado", fator: "50.000000", tipoFator: "multiply", quantidadeInterna: "100.0000", valorUnitarioInterno: "0.200000" },
  { caminho: "codigo_fornecedor", fator: "1", tipoFator: "multiply", quantidadeInterna: "2.0000", valorUnitarioInterno: "10.000000" },
  { caminho: "codigo_barras", fator: "1", tipoFator: "multiply", quantidadeInterna: "2.0000", valorUnitarioInterno: "10.000000" },
  { caminho: "codigo_fornecedor", fator: "4.000000", tipoFator: "divide", quantidadeInterna: "0.5000", valorUnitarioInterno: "40.000000" },
  { caminho: "codigo_fornecedor", fator: "50.000000", tipoFator: "multiply", quantidadeInterna: "100.0000", valorUnitarioInterno: "0.200000" },
  { caminho: "codigo_fornecedor", fator: "1", tipoFator: "multiply", quantidadeInterna: "2.0000", valorUnitarioInterno: "10.000000" },
] as const;

describe("XML4-NR1 o fator que a main já acertava continua o MESMO", () => {
  it("KG com SC = 50: código no fornecedor (ficha SC, nota SC), código de barras da SC (nota SC) e vínculo 50 → 50; KG pela ficha e pelo código de barras do produto → 1; CX = 4 que divide → 4; o cEAN de OUTRA unidade com a ficha e a nota na mesma (B18 → 50, B20 → 1)", async () => {
    const u = unico().toUpperCase();
    const [kg, sc, cx] = [await unidadeDoSeed("KG"), await unidadeDoSeed("SC"), await unidadeDoSeed("CX")];
    const [eanDaSaca, eanDoProduto, eanDoProdutoB18, eanDaSacaB20] = [eanNovo(), eanNovo(), eanNovo(), eanNovo()];
    const saco = await produtoNovo(kg);
    await alternativa(saco.id, sc, "50", "multiply", eanDaSaca);
    const quilo = await produtoNovo(kg, eanDoProduto);
    const caixa = await produtoNovo(kg);
    await alternativa(caixa.id, cx, "4", "divide");
    // B18: a ficha, o cadastro e a nota dizem SC (50); o cEAN da nota é o `products.barcode` — o da principal KG.
    const b18 = await produtoNovo(kg, eanDoProdutoB18);
    await alternativa(b18.id, sc, "50", "multiply");
    // B20: a ficha e a nota dizem KG (a principal, 1); o cEAN da nota é o da linha SC.
    const b20 = await produtoNovo(kg);
    await alternativa(b20.id, sc, "50", "multiply", eanDaSacaB20);
    const n = await notaImportada([
      item(`NR-CF-${u}`, "SC"), item(`NR-EAN-${u}`, "SC", eanDaSaca), item(`NR-L-${u}`, "SC"),
      item(`NR-CF1-${u}`, "KG"), item(`NR-E1-${u}`, "KG", eanDoProduto), item(`NR-CFD-${u}`, "CX"),
      item(`NR-B18-${u}`, "SC", eanDoProdutoB18), item(`NR-B20-${u}`, "KG", eanDaSacaB20),
    ]);
    await fichaDoFornecedor(saco.id, n.fornecedor, `NR-CF-${u}`, sc);
    await lembrar(n.fornecedor, `NR-L-${u}`, "SC", saco.id, "50");
    await fichaDoFornecedor(quilo.id, n.fornecedor, `NR-CF1-${u}`, kg);
    await fichaDoFornecedor(caixa.id, n.fornecedor, `NR-CFD-${u}`, cx);
    await fichaDoFornecedor(b18.id, n.fornecedor, `NR-B18-${u}`, sc);
    await fichaDoFornecedor(b20.id, n.fornecedor, `NR-B20-${u}`, kg);
    const conf = await conferenciaLida(n.id);
    expect(conf.fornecedorEscolhido, "premissa: o fornecedor das fichas e do vínculo é o escolhido").toBe(n.fornecedor);
    expect(conf.nota.itens.slice(6).map((i) => i.ean), "premissa: o B18 e o B20 trazem o cEAN de OUTRA unidade do produto").toEqual([eanDoProdutoB18, eanDaSacaB20]);

    const itens = [1, 2, 3, 4, 5, 6, 7, 8];
    const lido = itens.map((k) => fatorNaConferencia(conf, k));
    console.log(`XML4-NR1 FATOR ${JSON.stringify(lido.map((f) => [f.caminho, f.fator, f.tipoFator, f.quantidadeInterna, f.valorUnitarioInterno]))}`);
    const produtos = [saco, saco, saco, quilo, quilo, caixa, b18, b20].map((p) => p.id);
    expect(lido, "o MESMO fator, tipo, quantidade e unitário internos da main").toEqual(NA_MAIN_NR1.map((f, k) => ({ ...f, produto: produtos[k] })));

    // Só a XML-04: DE ONDE o fator veio — do cadastro pelo uCom (nunca da ficha nem do código), e o vínculo sem aviso.
    expect(itens.map((k) => comProduto(conf, k).fatorPelaNota)).toEqual([
      { origem: "unidade_do_produto", unidadeDaNota: "SC" }, { origem: "unidade_do_produto", unidadeDaNota: "SC" },
      { origem: "vinculo", unidadeDaNota: "SC", cadastro: null },
      { origem: "unidade_principal", unidadeDaNota: "KG" }, { origem: "unidade_principal", unidadeDaNota: "KG" },
      { origem: "unidade_do_produto", unidadeDaNota: "CX" },
      { origem: "unidade_do_produto", unidadeDaNota: "SC" }, { origem: "unidade_principal", unidadeDaNota: "KG" },
    ]);
    expect(itens.flatMap((k) => doFator(conf, k)), "nada a perguntar nem a conferir").toEqual([]);
  });
});

// ═════════════════════════════════════ XML4-NR2 o que muda, de propósito ═════════════════════════════════════

/**
 * O fator que a MAIN entrega no cenário do NR2 (a) (obtido em `origin/main`): a ficha ou a unidade DONA do código de
 * barras mandava. O quarto (B5 do cético: o cEAN da principal com a nota na SC) entrou com a decisão do Maike ("a 3.1 à
 * letra") e foi OBTIDO do mesmo jeito.
 */
const NA_MAIN_NR2 = [
  { caminho: "codigo_fornecedor", fator: "50.000000", tipoFator: "multiply", quantidadeInterna: "100.0000", valorUnitarioInterno: "0.200000" },
  { caminho: "codigo_fornecedor", fator: "1", tipoFator: "multiply", quantidadeInterna: "2.0000", valorUnitarioInterno: "10.000000" },
  { caminho: "codigo_barras", fator: "50.000000", tipoFator: "multiply", quantidadeInterna: "100.0000", valorUnitarioInterno: "0.200000" },
  { caminho: "codigo_barras", fator: "1", tipoFator: "multiply", quantidadeInterna: "2.0000", valorUnitarioInterno: "10.000000" },
] as const;

/**
 * O fator que a MAIN entrega no cenário do NR2 (b) — os casos B1, B4, B2 e B7 do cético, na ordem dos itens —, OBTIDO
 * rodando este cenário contra `origin/main` (33291879) no mesmo banco de teste: a main dava o número (50, 50, 50, 10),
 * certo para quem tinha o cadastro em mente; a XML-04 PERGUNTA de propósito, porque a regra só aceita a linha de compra
 * (3.1), o uCom que casa com uma unidade (3.1) e a unidade da organização antes da do sistema (3.3).
 */
const NA_MAIN_NR2_PERGUNTA = [
  { caminho: "codigo_fornecedor", fator: "50.000000", tipoFator: "multiply", quantidadeInterna: "100.0000", valorUnitarioInterno: "0.200000" },
  { caminho: "codigo_barras", fator: "50.000000", tipoFator: "multiply", quantidadeInterna: "100.0000", valorUnitarioInterno: "0.200000" },
  { caminho: "codigo_fornecedor", fator: "50.000000", tipoFator: "multiply", quantidadeInterna: "100.0000", valorUnitarioInterno: "0.200000" },
  { caminho: "codigo_fornecedor", fator: "10.000000", tipoFator: "multiply", quantidadeInterna: "20.0000", valorUnitarioInterno: "1.000000" },
] as const;

describe("XML4-NR2 o que MUDA, de propósito: onde a ficha ou o código de barras contradiz a nota, onde a linha não é de compra, onde o uCom não é unidade do cadastro e onde a unidade da organização vence a do sistema — e em todos esses a fatia segue a nota ou PERGUNTA, nunca um número errado", () => {
  it("(a) ficha em SC e nota em KG → 1 (a nota); ficha sem unidade e nota em SC → 50 (o cadastro); código de barras da SC e nota em KG → 1 (o uCom: a principal); código de barras da principal KG e nota em SC → 50 (o uCom: a SC)", async () => {
    const u = unico().toUpperCase();
    const [kg, sc] = [await unidadeDoSeed("KG"), await unidadeDoSeed("SC")];
    const [eanDaSaca, eanDaPrincipal] = [eanNovo(), eanNovo()];
    const [fichaSaca, fichaSemUnidade, barrasDaSaca, barrasDaPrincipal] = [await produtoNovo(kg), await produtoNovo(kg), await produtoNovo(kg), await produtoNovo(kg, eanDaPrincipal)];
    await alternativa(fichaSaca.id, sc, "50", "multiply");
    await alternativa(fichaSemUnidade.id, sc, "50", "multiply");
    await alternativa(barrasDaSaca.id, sc, "50", "multiply", eanDaSaca);
    await alternativa(barrasDaPrincipal.id, sc, "50", "multiply");
    const n = await notaImportada([item(`NR-MA-${u}`, "KG"), item(`NR-MB-${u}`, "SC"), item(`NR-MC-${u}`, "KG", eanDaSaca), item(`NR-MD-${u}`, "SC", eanDaPrincipal)]);
    await fichaDoFornecedor(fichaSaca.id, n.fornecedor, `NR-MA-${u}`, sc);
    await fichaDoFornecedor(fichaSemUnidade.id, n.fornecedor, `NR-MB-${u}`, null);
    const conf = await conferenciaLida(n.id);

    const lido = [1, 2, 3, 4].map((k) => fatorNaConferencia(conf, k));
    console.log(`XML4-NR2 FATOR ${JSON.stringify(lido.map((f) => [f.caminho, f.fator, f.tipoFator, f.quantidadeInterna, f.valorUnitarioInterno]))}`);
    const produtos = [fichaSaca, fichaSemUnidade, barrasDaSaca, barrasDaPrincipal].map((p) => p.id);
    expect(lido.map((f) => f.produto), "premissa: cada item achou o produto do caso").toEqual(produtos);
    const daXml04 = [
      { caminho: "codigo_fornecedor", fator: "1", tipoFator: "multiply", quantidadeInterna: "2.0000", valorUnitarioInterno: "10.000000" },
      { caminho: "codigo_fornecedor", fator: "50.000000", tipoFator: "multiply", quantidadeInterna: "100.0000", valorUnitarioInterno: "0.200000" },
      { caminho: "codigo_barras", fator: "1", tipoFator: "multiply", quantidadeInterna: "2.0000", valorUnitarioInterno: "10.000000" },
      { caminho: "codigo_barras", fator: "50.000000", tipoFator: "multiply", quantidadeInterna: "100.0000", valorUnitarioInterno: "0.200000" },
    ];
    expect(lido, "o fator pelo uCom da NOTA (a main dava o da ficha ou o da unidade dona do código de barras: `NA_MAIN_NR2`)").toEqual(daXml04.map((f, k) => ({ ...f, produto: produtos[k] })));
    expect(lido.map((f, k) => f.fator === NA_MAIN_NR2[k]!.fator), "os quatro são os que MUDAM em relação à main").toEqual([false, false, false, false]);
    expect([1, 2, 3, 4].map((k) => comProduto(conf, k).fatorPelaNota), "o fator saiu do uCom: o código de barras só achou o produto").toEqual([
      { origem: "unidade_principal", unidadeDaNota: "KG" }, { origem: "unidade_do_produto", unidadeDaNota: "SC" },
      { origem: "unidade_principal", unidadeDaNota: "KG" }, { origem: "unidade_do_produto", unidadeDaNota: "SC" },
    ]);
    expect([1, 2, 3, 4].flatMap((k) => doFator(conf, k)), "nada a perguntar: o cadastro respalda o uCom, diga o cEAN o que disser").toEqual([]);
  });

  it("(b) a main dava o número e a fatia PERGUNTA: linha SC = 50 só de VENDA pela ficha (B1) e pelo código de barras (B4) → main 50; ficha SC e nota \"SACO\" (B2) → main 50; linha e ficha na unidade do SISTEMA com o símbolo de uma da ORGANIZAÇÃO (B7, a pergunta da homônima) → main 10", async () => {
    const u = unico().toUpperCase();
    const [kg, sc] = [await unidadeDoSeed("KG"), await unidadeDoSeed("SC")];
    expect(await unidadesQueCasam("SACO"), "premissa: SACO não é símbolo de unidade nenhuma").toEqual({ organizacao: [], sistema: [] });
    const z = await mesmoSimboloNoSistemaENaOrganizacao();
    const eanSoDeVenda = eanNovo();
    const [b1, b4, b2, b7] = [await produtoNovo(kg), await produtoNovo(kg), await produtoNovo(kg), await produtoNovo(kg)];
    await alternativa(b1.id, sc, "50", "multiply", null, { soDeVenda: true });
    await alternativa(b4.id, sc, "50", "multiply", eanSoDeVenda, { soDeVenda: true });
    await alternativa(b2.id, sc, "50", "multiply");
    await alternativa(b7.id, z.doSistema, "10", "multiply");
    const n = await notaImportada([item(`NR-B1-${u}`, "SC"), item(`NR-B4-${u}`, "SC", eanSoDeVenda), item(`NR-B2-${u}`, "SACO"), item(`NR-B7-${u}`, z.simbolo)]);
    await fichaDoFornecedor(b1.id, n.fornecedor, `NR-B1-${u}`, sc);
    await fichaDoFornecedor(b2.id, n.fornecedor, `NR-B2-${u}`, sc);
    await fichaDoFornecedor(b7.id, n.fornecedor, `NR-B7-${u}`, z.doSistema);
    const conf = await conferenciaLida(n.id);
    expect(conf.fornecedorEscolhido, "premissa: o fornecedor das fichas é o escolhido").toBe(n.fornecedor);

    const lido = [1, 2, 3, 4].map((k) => fatorNaConferencia(conf, k));
    console.log(`XML4-NR2 PERGUNTA ${JSON.stringify(lido.map((f) => [f.caminho, f.fator, f.tipoFator, f.quantidadeInterna, f.valorUnitarioInterno]))}`);
    const produtos = [b1, b4, b2, b7];
    expect(lido.map((f) => [f.caminho, f.produto]), "premissa: cada item achou o produto do caso pelo MESMO caminho da main")
      .toEqual(NA_MAIN_NR2_PERGUNTA.map((f, k) => [f.caminho, produtos[k]!.id]));
    // A fatia: o fator de compatibilidade (1, só para a web anterior) e a PERGUNTA com a unidade da nota — nunca 50 nem 10
    // sem o cadastro respaldar, e nunca um número errado.
    const pergunta = { fator: "1", tipoFator: "multiply", quantidadeInterna: "2.0000", valorUnitarioInterno: "10.000000" };
    expect(lido, "a fatia PERGUNTA (a main dava `NA_MAIN_NR2_PERGUNTA`)").toEqual(NA_MAIN_NR2_PERGUNTA.map((f, k) => ({ caminho: f.caminho, produto: produtos[k]!.id, ...pergunta })));
    expect(lido.map((f, k) => f.fator === NA_MAIN_NR2_PERGUNTA[k]!.fator), "os quatro MUDAM em relação à main").toEqual([false, false, false, false]);
    const unidadesDaNota = ["SC", "SC", "SACO", z.simbolo];
    const motivos = ["unidade_fora_do_cadastro", "unidade_fora_do_cadastro", "unidade_fora_do_cadastro", "unidade_homonima_da_organizacao"];
    expect([1, 2, 3, 4].map((k) => comProduto(conf, k).fatorPelaNota), "a PERGUNTA, com a unidade que a nota trouxe e o porquê")
      .toEqual(unidadesDaNota.map((unidadeDaNota, k) => ({ origem: "pergunta", unidadeDaNota, motivo: motivos[k] })));
    // B4 (o cEAN da linha só de venda acha o produto) pergunta EXATAMENTE como B1 (a ficha, sem cEAN): a pergunta vem da
    // 3.1 (a linha não é de compra), não do código de barras.
    expect(comProduto(conf, 2).fatorPelaNota, "B4 = B1: o cEAN não entra").toEqual(comProduto(conf, 1).fatorPelaNota);
    expect([1, 2, 3, 4].map((k) => doFator(conf, k).map((d) => [d.codigo, d.bloqueia, d.mensagem])), "o aviso diz a unidade, o produto e o porquê; não bloqueia no servidor")
      .toEqual([
        ...unidadesDaNota.slice(0, 3).map((unidadeDaNota, k) => [["fator_a_informar", false,
          `Item ${k + 1}: a unidade ${unidadeDaNota} da nota não é unidade de compra do produto ${produtos[k]!.codigo} no cadastro: informe o fator.`]]),
        [["fator_a_informar", false,
          `Item 4: a unidade ${z.simbolo} da nota é a da organização, e o produto ${b7.codigo} está cadastrado na ${z.simbolo} do sistema: informe o fator.`]],
      ]);
  });
});
