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
 * XML-04 tira os dois primeiros do uCom DA NOTA pelo cadastro (`produto_unidades`) e mantém o do vínculo. Onde a
 * ficha, o código de barras e a nota dizem a MESMA unidade, o número não pode mudar:
 *
 *   XML4-NR1 o MESMO fator da main: o produto em KG com a alternativa SC = 50 (multiplica), pelo código no fornecedor
 *            (ficha em SC), pelo código de barras da SC e pelo vínculo lembrado (50); a principal (KG) pelo código no
 *            fornecedor e pelo código de barras do produto (1); e uma alternativa que DIVIDE (CX = 4) — as unidades do
 *            SEED (do sistema), o mundo real;
 *   XML4-NR2 o que MUDA, de propósito, e SÓ onde a main errava: a ficha (ou o código de barras) diz uma unidade e a nota
 *            diz outra — a main seguia a ficha (ou o código), a XML-04 segue a nota pelo cadastro (ou pergunta).
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

/** Uma unidade ALTERNATIVA do produto (`erp.produto_unidades`): viva, de compra e de venda. */
async function alternativa(produtoId: string, measurementId: string, fator: string, tipo: "multiply" | "divide", codigoBarras: string | null = null): Promise<void> {
  const r = await c.admin.query<{ fator: string; tipo_fator: string }>(
    `insert into erp.produto_unidades (organization_id, product_id, measurement_id, tipo_fator, fator, codigo_barras, uso_compra, uso_venda)
     values ($1, $2, $3, $4, $5::numeric, $6, true, true) returning fator::text, tipo_fator`, [c.h.demo.orgId, produtoId, measurementId, tipo, fator, codigoBarras]);
  expect(r.rows[0]!.tipo_fator, "premissa: a alternativa nasceu com o tipo pedido").toBe(tipo);
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

/** O fator que a MAIN entrega no cenário do NR1 (obtido em `origin/main`), sem o produto (que é do caso). */
const NA_MAIN_NR1 = [
  { caminho: "codigo_fornecedor", fator: "50.000000", tipoFator: "multiply", quantidadeInterna: "100.0000", valorUnitarioInterno: "0.200000" },
  { caminho: "codigo_barras", fator: "50.000000", tipoFator: "multiply", quantidadeInterna: "100.0000", valorUnitarioInterno: "0.200000" },
  { caminho: "lembrado", fator: "50.000000", tipoFator: "multiply", quantidadeInterna: "100.0000", valorUnitarioInterno: "0.200000" },
  { caminho: "codigo_fornecedor", fator: "1", tipoFator: "multiply", quantidadeInterna: "2.0000", valorUnitarioInterno: "10.000000" },
  { caminho: "codigo_barras", fator: "1", tipoFator: "multiply", quantidadeInterna: "2.0000", valorUnitarioInterno: "10.000000" },
  { caminho: "codigo_fornecedor", fator: "4.000000", tipoFator: "divide", quantidadeInterna: "0.5000", valorUnitarioInterno: "40.000000" },
] as const;

describe("XML4-NR1 o fator que a main já acertava continua o MESMO", () => {
  it("KG com SC = 50: código no fornecedor (ficha SC, nota SC), código de barras da SC (nota SC) e vínculo 50 → 50; KG pela ficha e pelo código de barras do produto → 1; CX = 4 que divide → 4", async () => {
    const u = unico().toUpperCase();
    const [kg, sc, cx] = [await unidadeDoSeed("KG"), await unidadeDoSeed("SC"), await unidadeDoSeed("CX")];
    const [eanDaSaca, eanDoProduto] = [eanNovo(), eanNovo()];
    const saco = await produtoNovo(kg);
    await alternativa(saco.id, sc, "50", "multiply", eanDaSaca);
    const quilo = await produtoNovo(kg, eanDoProduto);
    const caixa = await produtoNovo(kg);
    await alternativa(caixa.id, cx, "4", "divide");
    const n = await notaImportada([
      item(`NR-CF-${u}`, "SC"), item(`NR-EAN-${u}`, "SC", eanDaSaca), item(`NR-L-${u}`, "SC"),
      item(`NR-CF1-${u}`, "KG"), item(`NR-E1-${u}`, "KG", eanDoProduto), item(`NR-CFD-${u}`, "CX"),
    ]);
    await fichaDoFornecedor(saco.id, n.fornecedor, `NR-CF-${u}`, sc);
    await lembrar(n.fornecedor, `NR-L-${u}`, "SC", saco.id, "50");
    await fichaDoFornecedor(quilo.id, n.fornecedor, `NR-CF1-${u}`, kg);
    await fichaDoFornecedor(caixa.id, n.fornecedor, `NR-CFD-${u}`, cx);
    const conf = await conferenciaLida(n.id);
    expect(conf.fornecedorEscolhido, "premissa: o fornecedor das fichas e do vínculo é o escolhido").toBe(n.fornecedor);

    const lido = [1, 2, 3, 4, 5, 6].map((k) => fatorNaConferencia(conf, k));
    console.log(`XML4-NR1 FATOR ${JSON.stringify(lido.map((f) => [f.caminho, f.fator, f.tipoFator, f.quantidadeInterna, f.valorUnitarioInterno]))}`);
    const produtos = [saco, saco, saco, quilo, quilo, caixa].map((p) => p.id);
    expect(lido, "o MESMO fator, tipo, quantidade e unitário internos da main").toEqual(NA_MAIN_NR1.map((f, k) => ({ ...f, produto: produtos[k] })));

    // Só a XML-04: DE ONDE o fator veio — do cadastro pelo uCom (nunca da ficha nem do código), e o vínculo sem aviso.
    expect([1, 2, 3, 4, 5, 6].map((k) => comProduto(conf, k).fatorPelaNota)).toEqual([
      { origem: "unidade_do_produto", unidadeDaNota: "SC" }, { origem: "unidade_do_produto", unidadeDaNota: "SC" },
      { origem: "vinculo", unidadeDaNota: "SC", cadastro: null },
      { origem: "unidade_principal", unidadeDaNota: "KG" }, { origem: "unidade_principal", unidadeDaNota: "KG" },
      { origem: "unidade_do_produto", unidadeDaNota: "CX" },
    ]);
    expect([1, 2, 3, 4, 5, 6].flatMap((k) => doFator(conf, k)), "nada a perguntar nem a conferir").toEqual([]);
  });
});

// ═════════════════════════════════════ XML4-NR2 o que muda, de propósito ═════════════════════════════════════

/** O fator que a MAIN entrega no cenário do NR2 (obtido em `origin/main`): a ficha ou o código de barras mandava. */
const NA_MAIN_NR2 = [
  { caminho: "codigo_fornecedor", fator: "50.000000", tipoFator: "multiply", quantidadeInterna: "100.0000", valorUnitarioInterno: "0.200000" },
  { caminho: "codigo_fornecedor", fator: "1", tipoFator: "multiply", quantidadeInterna: "2.0000", valorUnitarioInterno: "10.000000" },
  { caminho: "codigo_barras", fator: "50.000000", tipoFator: "multiply", quantidadeInterna: "100.0000", valorUnitarioInterno: "0.200000" },
] as const;

describe("XML4-NR2 o que MUDA, de propósito, é só onde a ficha ou o código de barras contradiz a nota", () => {
  it("ficha em SC e nota em KG → 1 (a nota); ficha sem unidade e nota em SC → 50 (o cadastro); código de barras da SC e nota em KG → pergunta", async () => {
    const u = unico().toUpperCase();
    const [kg, sc] = [await unidadeDoSeed("KG"), await unidadeDoSeed("SC")];
    const eanDaSaca = eanNovo();
    const [fichaSaca, fichaSemUnidade, barrasDaSaca] = [await produtoNovo(kg), await produtoNovo(kg), await produtoNovo(kg)];
    await alternativa(fichaSaca.id, sc, "50", "multiply");
    await alternativa(fichaSemUnidade.id, sc, "50", "multiply");
    await alternativa(barrasDaSaca.id, sc, "50", "multiply", eanDaSaca);
    const n = await notaImportada([item(`NR-MA-${u}`, "KG"), item(`NR-MB-${u}`, "SC"), item(`NR-MC-${u}`, "KG", eanDaSaca)]);
    await fichaDoFornecedor(fichaSaca.id, n.fornecedor, `NR-MA-${u}`, sc);
    await fichaDoFornecedor(fichaSemUnidade.id, n.fornecedor, `NR-MB-${u}`, null);
    const conf = await conferenciaLida(n.id);

    const lido = [1, 2, 3].map((k) => fatorNaConferencia(conf, k));
    console.log(`XML4-NR2 FATOR ${JSON.stringify(lido.map((f) => [f.caminho, f.fator, f.tipoFator, f.quantidadeInterna, f.valorUnitarioInterno]))}`);
    const produtos = [fichaSaca, fichaSemUnidade, barrasDaSaca].map((p) => p.id);
    expect(lido.map((f) => f.produto), "premissa: cada item achou o produto do caso").toEqual(produtos);
    const daXml04 = [
      { caminho: "codigo_fornecedor", fator: "1", tipoFator: "multiply", quantidadeInterna: "2.0000", valorUnitarioInterno: "10.000000" },
      { caminho: "codigo_fornecedor", fator: "50.000000", tipoFator: "multiply", quantidadeInterna: "100.0000", valorUnitarioInterno: "0.200000" },
      { caminho: "codigo_barras", fator: "1", tipoFator: "multiply", quantidadeInterna: "2.0000", valorUnitarioInterno: "10.000000" },
    ];
    expect(lido, "o fator pela NOTA (a main dava o da ficha ou o do código de barras: `NA_MAIN_NR2`)").toEqual(daXml04.map((f, k) => ({ ...f, produto: produtos[k] })));
    expect(lido.map((f, k) => f.fator === NA_MAIN_NR2[k]!.fator), "os três são os que MUDAM em relação à main").toEqual([false, false, false]);
    expect([1, 2, 3].map((k) => comProduto(conf, k).fatorPelaNota)).toEqual([
      { origem: "unidade_principal", unidadeDaNota: "KG" }, { origem: "unidade_do_produto", unidadeDaNota: "SC" },
      { origem: "pergunta", unidadeDaNota: "KG", motivo: "codigo_de_barras_de_outra_unidade" },
    ]);
    expect([1, 2, 3].map((k) => doFator(conf, k).map((d) => d.codigo)), "o código de barras de outra unidade PERGUNTA (com aviso)").toEqual([[], [], ["fator_a_informar"]]);
  });
});
