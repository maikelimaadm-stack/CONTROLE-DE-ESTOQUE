import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import {
  c, iniciar, encerrar, j, erro, produto, itemCompra, corpoCompra, lancarCompra, compraLancada, confirmarCompra, previaCompra, lerCompra,
  auditoriaDe, usuario, escopos, type Produto, type Resposta,
} from "./top-config-08-ajuda.js";
import { cadastroDespesa, centro, umTipoDeTitulo } from "./f9b-ajuda.js";
import { parcelasDoTitulo } from "../../src/services/financial-core.js";
import { DomainError } from "@agro/shared";
import {
  chaveNova, chaveSintetica, cnpjComDv, cnpjMascarado, notaSintetica, fornecedorComDocumento, codigoDaCompra, lancarNotaAntiga, corpoNotaAntiga,
  registrarDfe, aprovarRascunho, compraNoBanco, titulosDaCompra, rateioDosTitulos, numeroNovo,
} from "./f7-ajuda.js";

/**
 * OPERACOES-01 F7 (decisão 284) — A COMPRA GANHA O QUE A NOTA ANTIGA TINHA; A CHAVE BARRADA; A DF-e COM O XML.
 *
 * Cinco cenários, cada um com a PREMISSA ao lado da conclusão (a testemunha é o banco, lido por superusuário):
 *   (1) dados fiscais e os efeitos da confirmação: total com IPI, ICMS-ST e seguro; item que não gera estoque fica fora
 *       da entrada; o imobilizado vira bem (com ID Global e o valor de entrada rateado pelo peso com IPI/ST); o título
 *       com tipo de título, CAPEX e tipo de documento; o estorno baixa o bem;
 *   (2) rateio por valor (60/40 com conta e safra) e por produto (a diferença na última linha), a prévia com
 *       `financeiro.rateio` e a classificação nula;
 *   (3) a chave de acesso nos dois sentidos (compra × nota antiga), entre compras, a compra cancelada libera e a compra
 *       de outra empresa (invisível) recusa sem dizer onde;
 *   (4) a DF-e com o XML: destinatário ambíguo é pendência, o XML guardado e ligado, o perfil pelo documento
 *       NORMALIZADO (cadastro com máscara), a aprovação na empresa DA DF-e e a DF-e sem empresa recusada;
 *   (5) o corpo de hoje → a resposta de hoje, chave por chave; o pedido recusa os campos fiscais; a capacidade.
 */

const MSG = {
  pedidoSemFiscais: "O pedido de compra não tem dados fiscais: este campo é da compra",
  chaveInvalida: "Chave de acesso inválida: confira os 44 dígitos",
  semLocal: "Item que não gera estoque não tem local de estoque",
  rateioComNatureza: "Com rateio, a natureza e o centro ficam nas linhas do rateio",
  naturezaPorItem: "Natureza por item só com rateio por produto",
  invisivel: "Esta nota já foi lançada nesta organização.",
  dfeSemEmpresa: "A DF-e não tem empresa: registre-a de novo na fila de DF-e, com a empresa ou com o XML, antes de aprovar.",
  destinoAmbiguo: "O destinatário corresponde a mais de uma empresa: escolha a empresa da compra.",
} as const;

let tipoTitulo = "";
let natureza1 = ""; let centro1 = ""; let natureza2 = ""; let centro2 = "";
let conta = ""; let safra = "";

beforeAll(async () => {
  await iniciar();
  tipoTitulo = await umTipoDeTitulo();
  natureza1 = await cadastroDespesa("Despesa F7 um"); centro1 = await centro("Centro F7 um");
  natureza2 = await cadastroDespesa("Despesa F7 dois"); centro2 = await centro("Centro F7 dois");
  conta = (await c.admin.query<{ id: string }>("select id::text as id from erp.chart_accounts where organization_id = $1 and code = '3.2.01'", [c.h.demo.orgId])).rows[0]!.id;
  safra = (await c.admin.query<{ id: string }>("select id::text as id from erp.harvests where organization_id = $1 and description = 'Safra 2026/2027'", [c.h.demo.orgId])).rows[0]!.id;
}, 240_000);
afterAll(encerrar);

const corpoDe = (r: Resposta) => j(r);
async function confirmada(id: string): Promise<void> {
  const r = await confirmarCompra(id);
  expect(r.statusCode, `premissa: a compra é confirmada — ${r.body}`).toBe(200);
}
async function cancelar(id: string): Promise<Resposta> {
  return c.ligada.inject({ method: "POST", url: `/api/compras/compras/${id}/cancel`, headers: c.h.headers(), payload: {} });
}
function recusa422(r: Resposta, path: string, message: string): void {
  expect(r.statusCode, r.body).toBe(422);
  const e = erro(r);
  expect(e.code).toBe("VALIDATION_ERROR");
  expect(e.details).toEqual([expect.objectContaining({ path, message })]);
}
async function produtoQueControla(): Promise<Produto> {
  const p = await produto();
  const r = await c.admin.query<{ control_stock: boolean }>("select control_stock from erp.products where id = $1", [p.id]);
  expect(r.rows[0]!.control_stock, "premissa: o produto controla estoque (sem a regra nova, ele daria entrada)").toBe(true);
  return p;
}

// ─────────────── (1) dados fiscais e os efeitos da confirmação ───────────────

describe("(1) a compra com dados fiscais: total, gera estoque, imobilizado, título e estorno", () => {
  it("grava os dados fiscais, confirma sem entrada do item que não gera estoque, cria o bem e o título fiscal, e o estorno baixa o bem", async () => {
    const naoGera = await produtoQueControla();
    const bemProd = await produtoQueControla();
    const chave = chaveNova();
    const corpo = corpoCompra([
      { produto_id: naoGera.id, quantidade: "2", valor_unitario: "100.00", gera_estoque: false },
      itemCompra(bemProd.id, "1", "1000.00", { imobilizado: true, valor_ipi: "50.00", valor_icms_st: "20.00" }),
    ], { chave_acesso: chave, uf_nota: "GO", tipo_documento_fiscal: "nfe", valor_ipi: "50.00", valor_icms_st: "20.00", seguro: "10.00",
      tipo_titulo_id: tipoTitulo, classificacao_gasto: "capex" });
    const doc = await compraLancada("compra", corpo);
    // O total soma IPI, ICMS-ST e seguro (1200 + 80); sem eles seria 1200.
    expect([doc.valor_itens, doc.valor_total]).toEqual(["1200.00", "1280.00"]);
    expect(await compraNoBanco(doc.id)).toMatchObject({ situacao: "aberto", valor_total: "1280.00", chave_acesso: chave, uf_nota: "GO", tipo_documento_fiscal: "nfe",
      valor_ipi: "50.00", valor_icms_st: "20.00", seguro: "10.00", tipo_titulo_id: tipoTitulo, classificacao_gasto: "capex", rateio_tipo: null });
    const itensGravados = (await c.admin.query<{ produto_id: string; gera_estoque: boolean | null; imobilizado: boolean | null; valor_ipi: string | null; armazem_id: string | null }>(
      "select produto_id::text, gera_estoque, imobilizado, valor_ipi::text, armazem_id::text from erp.documentos_compra_itens where documento_id = $1 order by posicao", [doc.id])).rows;
    expect(itensGravados).toEqual([
      { produto_id: naoGera.id, gera_estoque: false, imobilizado: null, valor_ipi: null, armazem_id: null },
      { produto_id: bemProd.id, gera_estoque: null, imobilizado: true, valor_ipi: "50.00", armazem_id: c.I.warehouse },
    ]);

    // A prévia: um item fora da entrada (o que não gera estoque) e a entrada do outro com o custo rateado pelo peso com IPI/ST.
    const previa = corpoDe(await previaCompra(doc.id)) as { podeConfirmar: boolean; estoque: { itens: { produto_id: string; valorEntrada: string }[]; itensForaDaEntrada: number } };
    expect(previa.podeConfirmar).toBe(true);
    expect(previa.estoque.itensForaDaEntrada).toBe(1);
    // Peso: 200 (A) e 1000 + 50 + 20 (B) sobre 1280 → B = 1078,43 (sem o peso dos impostos do item seria 1066,67).
    expect(previa.estoque.itens.map((i) => [i.produto_id, i.valorEntrada])).toEqual([[bemProd.id, "1078.43"]]);

    await confirmada(doc.id);
    const movs = (await c.admin.query<{ product_id: string; quantity: string; unit_cost: string }>(
      "select product_id::text, quantity::text, unit_cost::text from erp.stock_movements where source_type = 'documentos_compra' and source_id = $1 order by created_at", [doc.id])).rows;
    expect(movs).toEqual([{ product_id: bemProd.id, quantity: "1.0000", unit_cost: "1078.430000" }]);

    // O bem: um, do item imobilizado, com o valor de entrada rateado, o fornecedor, a empresa e o ID Global.
    const item = (await c.admin.query<{ bem_id: string | null }>("select bem_id::text from erp.documentos_compra_itens where documento_id = $1 and produto_id = $2", [doc.id, bemProd.id])).rows[0]!;
    expect(item.bem_id, "o item imobilizado ganhou o bem").toEqual(expect.any(String));
    const bem = (await c.admin.query<{ code: string; acquisition_value: string; status: string; product_id: string; provider_id: string; empresa_id: string; acquisition_date: string; has_depreciation: boolean }>(
      `select code, acquisition_value::text, status, product_id::text, provider_id::text, empresa_id::text, to_char(acquisition_date, 'YYYY-MM-DD') as acquisition_date, has_depreciation
         from erp.equipments where id = $1`, [item.bem_id])).rows[0]!;
    expect(bem).toMatchObject({ acquisition_value: "1078.43", status: "active", product_id: bemProd.id, provider_id: c.I.provider, empresa_id: c.I.empresa,
      acquisition_date: "2026-09-10", has_depreciation: true });
    const idGlobal = await c.admin.query("select 1 from erp.registros_globais where tipo_entidade = 'equipments' and id_entidade = $1", [item.bem_id]);
    expect(idGlobal.rowCount, "o bem ganhou o ID Global").toBe(1);
    const semBem = await c.admin.query("select 1 from erp.documentos_compra_itens where documento_id = $1 and bem_id is not null", [doc.id]);
    expect(semBem.rowCount, "só o item imobilizado cria bem").toBe(1);

    // O título: o total, com o tipo de título, a classificação CAPEX e o tipo de documento fiscal da compra.
    expect(await titulosDaCompra(doc.id)).toEqual([expect.objectContaining({ empresa_id: c.I.empresa, status: "open", amount: "1280.00", title_type_id: tipoTitulo,
      classification: "capex", document_type: "nfe" })]);
    const confirm = (await auditoriaDe("documentos_compra", doc.id, "confirm")).find((a) => a.metadata)!.metadata!;
    expect(confirm.bens).toEqual([item.bem_id]);

    // A consulta mostra o código do bem só no item que o tem.
    const lida = corpoDe(await lerCompra("compra", doc.id)) as { itens: Record<string, unknown>[]; tipo_titulo_nome?: string };
    expect(lida.itens.map((i) => i.bem_codigo ?? null)).toEqual([null, bem.code]);
    expect("bem_codigo" in lida.itens[0]!).toBe(false);
    expect(lida.tipo_titulo_nome).toEqual(expect.any(String));

    // O estorno baixa o bem e cancela o título.
    const cancelada = await cancelar(doc.id);
    expect(cancelada.statusCode, cancelada.body).toBe(200);
    expect((await c.admin.query<{ status: string }>("select status from erp.equipments where id = $1", [item.bem_id])).rows[0]!.status).toBe("written_off");
    expect((await titulosDaCompra(doc.id)).map((t) => t.status)).toEqual(["cancelled"]);
  });

  it("recusa no campo: item que não gera estoque com local e chave com DV errado", async () => {
    const p = await produtoQueControla();
    const ok = await lancarCompra("compra", corpoCompra([itemCompra(p.id, "1", "10.00")], { chave_acesso: chaveNova() }));
    expect(ok.statusCode, `premissa: o mesmo corpo com chave válida e item com local é aceito — ${ok.body}`).toBe(201);
    recusa422(await lancarCompra("compra", corpoCompra([itemCompra(p.id, "1", "10.00", { gera_estoque: false })])), "itens[0].armazem_id", MSG.semLocal);
    const chave = chaveNova();
    const dvErrado = chave.slice(0, 43) + String((Number(chave[43]) + 1) % 10);
    recusa422(await lancarCompra("compra", corpoCompra([itemCompra(p.id, "1", "10.00")], { chave_acesso: dvErrado })), "chave_acesso", MSG.chaveInvalida);
  });
});

// ─────────────── (2) rateio por valor e por produto ───────────────

describe("(2) rateio por valor e por produto", () => {
  it("por valor 60/40 com conta e safra: grava as linhas, a prévia mostra o rateio (classificação nula) e o título leva as linhas", async () => {
    const p = await produtoQueControla();
    const corpo = corpoCompra([itemCompra(p.id, "1", "500.00")], {
      categoria_financeira_id: null, centro_custo_id: null,
      rateio: { tipo: "por_valor", linhas: [
        { categoria_financeira_id: natureza1, centro_custo_id: centro1, conta_contabil_id: conta, safra_id: safra, percentual: "60" },
        { categoria_financeira_id: natureza2, centro_custo_id: centro2, percentual: "40" },
      ] },
    });
    // Premissa das recusas: soma ≠ 100 e natureza no cabeçalho junto do rateio.
    recusa422(await lancarCompra("compra", { ...corpo, rateio: { tipo: "por_valor", linhas: [{ categoria_financeira_id: natureza1, centro_custo_id: centro1, percentual: "90" }] } }),
      "rateio", "O rateio por valor precisa somar 100% (soma: 90%)");
    recusa422(await lancarCompra("compra", { ...corpo, categoria_financeira_id: c.I.category, centro_custo_id: c.I.costCenter }), "categoria_financeira_id", MSG.rateioComNatureza);

    const doc = await compraLancada("compra", corpo);
    expect(await compraNoBanco(doc.id)).toMatchObject({ rateio_tipo: "por_valor" });
    const lida = corpoDe(await lerCompra("compra", doc.id)) as { rateio: Record<string, unknown>[]; categoria_financeira_id: string | null };
    expect(lida.categoria_financeira_id).toBeNull();
    expect(lida.rateio.map((l) => [l.categoria_financeira_id, l.centro_custo_id, l.conta_contabil_id, l.safra_id, l.percentual, l.conta_contabil_codigo, l.safra_nome])).toEqual([
      [natureza1, centro1, conta, safra, "60.0000", "3.2.01", "Safra 2026/2027"],
      [natureza2, centro2, null, null, "40.0000", null, null],
    ]);

    const previa = corpoDe(await previaCompra(doc.id)) as { podeConfirmar: boolean; financeiro: { classificacao: unknown; rateio: Record<string, unknown>[]; valor: string } };
    expect(previa.podeConfirmar).toBe(true);
    expect(previa.financeiro.classificacao).toBeNull();
    expect(previa.financeiro.rateio).toEqual([
      expect.objectContaining({ categoria: expect.objectContaining({ id: natureza1, nome: "Despesa F7 um" }), centro: expect.objectContaining({ id: centro1 }),
        conta: { id: conta, codigo: "3.2.01", nome: "Despesas" }, safra: { id: safra, nome: "Safra 2026/2027" }, percentual: "60.0000", valor: "300.00" }),
      expect.objectContaining({ categoria: expect.objectContaining({ id: natureza2 }), centro: expect.objectContaining({ id: centro2 }), conta: null, safra: null, percentual: "40.0000", valor: "200.00" }),
    ]);

    await confirmada(doc.id);
    expect(await rateioDosTitulos(doc.id)).toEqual([
      { financial_category_id: natureza1, cost_center_id: centro1, chart_account_id: conta, harvest_id: safra, percentage: "60.0000", amount: "300.00" },
      { financial_category_id: natureza2, cost_center_id: centro2, chart_account_id: null, harvest_id: null, percentage: "40.0000", amount: "200.00" },
    ]);
  });

  it("por produto: uma linha por par natureza/centro, com a diferença (frete) na última", async () => {
    const [a, b, d] = [await produtoQueControla(), await produtoQueControla(), await produtoQueControla()];
    const semRateio = corpoCompra([itemCompra(a.id, "1", "100.00", { categoria_financeira_id: natureza1, centro_custo_id: centro1 })]);
    recusa422(await lancarCompra("compra", semRateio), "itens[0].categoria_financeira_id", MSG.naturezaPorItem);
    const doc = await compraLancada("compra", corpoCompra([
      itemCompra(a.id, "1", "100.00", { categoria_financeira_id: natureza1, centro_custo_id: centro1 }),
      itemCompra(b.id, "1", "200.00", { categoria_financeira_id: natureza2, centro_custo_id: centro2 }),
      itemCompra(d.id, "1", "50.00", { categoria_financeira_id: natureza1, centro_custo_id: centro1 }),
    ], { categoria_financeira_id: null, centro_custo_id: null, frete: "30.00", rateio: { tipo: "por_produto" } }));
    expect(doc.valor_total).toBe("380.00");
    const previa = corpoDe(await previaCompra(doc.id)) as { financeiro: { classificacao: unknown; rateio: { valor: string; percentual: string }[] } };
    expect(previa.financeiro.classificacao).toBeNull();
    expect(previa.financeiro.rateio.map((l) => [l.valor, l.percentual])).toEqual([["150.00", "39.4737"], ["230.00", "60.5263"]]);
    await confirmada(doc.id);
    // Do maior percentual para o menor: a última linha (natureza 2) levou o frete (200 + 30).
    expect((await rateioDosTitulos(doc.id)).map((l) => [l.financial_category_id, l.cost_center_id, l.amount, l.percentage])).toEqual([
      [natureza2, centro2, "230.00", "60.5263"], [natureza1, centro1, "150.00", "39.4737"],
    ]);
  });
});

// ─────────────── (3) a chave de acesso ───────────────

describe("(3) a nota repetida pela chave: compra × nota antiga, entre compras e invisível", () => {
  it("compra e depois nota antiga → 409 dizendo a Compra; nota antiga e depois compra → 409 dizendo o Documento fiscal; cancelada libera", async () => {
    const p = await produtoQueControla();
    const corpoChave = (chave: string) => corpoCompra([{ produto_id: p.id, quantidade: "1", valor_unitario: "10.00" }], { chave_acesso: chave });

    // Compra primeiro.
    const k1 = chaveNova();
    const compra = await compraLancada("compra", corpoChave(k1));
    const codigo = await codigoDaCompra(compra.id);
    const premissa = await lancarNotaAntiga(corpoNotaAntiga(c.I.provider, p.id, { access_key: chaveNova() }));
    expect(premissa.statusCode, `premissa: a nota antiga com outra chave entra — ${premissa.body}`).toBe(201);
    const nota = await lancarNotaAntiga(corpoNotaAntiga(c.I.provider, p.id, { access_key: k1 }));
    expect(nota.statusCode, nota.body).toBe(409);
    expect(erro(nota)).toMatchObject({ code: "DUPLICATE_DOCUMENT", details: { onde: "compra", codigo } });
    expect(erro(nota).message).toContain(`Compra ${codigo}`);
    // Entre compras vivas: a segunda com a mesma chave também é 409.
    const segunda = await lancarCompra("compra", corpoChave(k1));
    expect(segunda.statusCode, segunda.body).toBe(409);
    expect(erro(segunda)).toMatchObject({ code: "DUPLICATE_DOCUMENT", details: { onde: "compra", codigo } });

    // Nota antiga primeiro.
    const k2 = chaveNova();
    const antiga = await lancarNotaAntiga(corpoNotaAntiga(c.I.provider, p.id, { access_key: k2 }));
    expect(antiga.statusCode, antiga.body).toBe(201);
    const code = (j(antiga) as { code: string }).code;
    const depois = await lancarCompra("compra", corpoChave(k2));
    expect(depois.statusCode, depois.body).toBe(409);
    expect(erro(depois)).toMatchObject({ code: "DUPLICATE_DOCUMENT", details: { onde: "documento_fiscal_estoque", codigo: code } });
    expect(erro(depois).message).toContain(`Documento fiscal de Estoque ${code}`);

    // A compra cancelada libera a chave.
    const cancelada = await cancelar(compra.id);
    expect(cancelada.statusCode, cancelada.body).toBe(200);
    const denovo = await lancarCompra("compra", corpoChave(k1));
    expect(denovo.statusCode, denovo.body).toBe(201);
  });

  it("a compra de outra empresa (fora do escopo) com a mesma chave: 409 sem dizer onde", async () => {
    const p = await produtoQueControla();
    const k3 = chaveNova();
    const restrito = await usuario("Comprador F7", ["compras.view", "compras.create"], escopos({ compras: [c.I.empresa] }));
    const corpo = (empresa: string, chave: string) => corpoCompra([{ produto_id: p.id, quantidade: "1", valor_unitario: "10.00" }], { empresa_id: empresa, chave_acesso: chave });
    const premissa = await lancarCompra("compra", corpo(c.I.empresa, chaveNova()), restrito);
    expect(premissa.statusCode, `premissa: o restrito lança compra na empresa dele — ${premissa.body}`).toBe(201);
    await compraLancada("compra", corpo(c.I.empresa2, k3));
    const r = await lancarCompra("compra", corpo(c.I.empresa, k3), restrito);
    expect(r.statusCode, r.body).toBe(409);
    expect(erro(r)).toEqual({ code: "DUPLICATE_DOCUMENT", message: MSG.invisivel });
  });
});

// ─────────────── (4) a DF-e com o XML ───────────────

describe("(4) a DF-e: XML guardado, destinatário, perfil normalizado e aprovação na empresa da DF-e", () => {
  it("guarda o XML na empresa do destinatário, acha o perfil pelo documento normalizado e aprova na empresa DA DF-e; sem empresa → 422", async () => {
    const emitente = cnpjComDv("482937160001");
    const fornecedor = await fornecedorComDocumento(emitente, { mascarado: true, nome: "Fornecedor F7 da DF-e" });
    expect(cnpjMascarado(emitente)).not.toBe(emitente);
    const perfil = (await c.admin.query<{ id: string }>(
      "insert into erp.provider_launch_profiles (organization_id, provider_id, default_destination) values ($1, $2, 'expense_invoice') returning id::text as id",
      [c.h.demo.orgId, fornecedor])).rows[0]!.id;
    await c.admin.query("insert into erp.provider_launch_profile_items (profile_id, financial_category_id, cost_center_id, percentage) values ($1, $2, $3, 100)",
      [perfil, c.I.category, c.I.costCenter]);
    const nota = notaSintetica({ emitenteCnpj: emitente });

    // O destinatário (o CNPJ das duas empresas do seed) é ambíguo: pendência com as duas candidatas, nada gravado.
    const ambiguo = await registrarDfe({ xml: nota.xml });
    expect(ambiguo.statusCode, ambiguo.body).toBe(422);
    const det = (erro(ambiguo).details as { path: string; message: string; candidatos: { id: string }[] }[])[0]!;
    expect([det.path, det.message]).toEqual(["empresa_id", MSG.destinoAmbiguo]);
    expect(det.candidatos.map((x) => x.id).sort()).toEqual([c.I.empresa, c.I.empresa2].sort());
    expect((await c.admin.query("select 1 from erp.dfe_documents where access_key = $1", [nota.chave])).rowCount).toBe(0);
    // O corpo que diverge da nota é recusado no campo.
    recusa422(await registrarDfe({ xml: nota.xml, empresa_id: c.I.empresa2, total: "1.00" }), "total", "O total não é o da nota do XML.");

    const r = await registrarDfe({ xml: nota.xml, empresa_id: c.I.empresa2 });
    expect(r.statusCode, r.body).toBe(201);
    const { id: dfeId, xml_id: xmlId } = j(r) as { id: string; xml_id: string };
    const dfe = (await c.admin.query<{ empresa_id: string; xml_id: string; number: string; issuer_document: string; total: string; launch_status: string }>(
      "select empresa_id::text, xml_id::text, number, issuer_document, total::text, launch_status from erp.dfe_documents where id = $1", [dfeId])).rows[0]!;
    expect(dfe).toEqual({ empresa_id: c.I.empresa2, xml_id: xmlId, number: nota.numero, issuer_document: emitente, total: nota.vNF, launch_status: "draft" });
    const xml = (await c.admin.query<{ empresa_id: string; chave_acesso: string; xml_original: string; xml_sha256: string }>(
      "select empresa_id::text, chave_acesso, xml_original, xml_sha256 from erp.notas_fiscais_xml where id = $1", [xmlId])).rows[0]!;
    expect(xml).toEqual({ empresa_id: c.I.empresa2, chave_acesso: nota.chave, xml_original: nota.xml, xml_sha256: createHash("sha256").update(nota.xml, "utf8").digest("hex") });

    // O perfil foi achado pelo documento normalizado (o cadastro guarda com máscara): o rascunho é do fornecedor.
    const rascunho = (await c.admin.query<{ id: string; status: string; provider_id: string }>(
      "select id::text, status, proposed->>'provider_id' as provider_id from erp.dfe_drafts where dfe_id = $1", [dfeId])).rows;
    expect(rascunho.map((x) => [x.status, x.provider_id])).toEqual([["pending", fornecedor]]);

    // A aprovação lança o título na empresa DA DF-e — não na "primeira disponível" (a 1ª empresa, sem seleção na sessão).
    expect(c.h.headers()["x-empresa-id"], "premissa: nenhuma empresa selecionada na sessão").toBeUndefined();
    const ap = await aprovarRascunho(rascunho[0]!.id);
    expect(ap.statusCode, ap.body).toBe(200);
    const titulos = (await c.admin.query<{ empresa_id: string; amount: string }>(
      "select empresa_id::text, amount::text from erp.financial_titles where source_type = 'dfe_documents' and source_id = $1", [dfeId])).rows;
    expect(titulos).toEqual([{ empresa_id: c.I.empresa2, amount: nota.vNF }]);
    expect(c.I.empresa2).not.toBe(c.I.empresa);
    expect((await c.admin.query<{ launch_status: string }>("select launch_status from erp.dfe_documents where id = $1", [dfeId])).rows[0]!.launch_status).toBe("launched");

    // DF-e sem empresa (sem XML, sem empresa): o rascunho nasce pelo perfil, mas a aprovação recusa — nada lançado.
    const { nNF, cNF } = numeroNovo();
    const semEmpresa = await registrarDfe({ access_key: chaveSintetica({ cnpj: emitente, nNF, cNF }), issuer_document: emitente, number: nNF, total: "100.00", emission_date: "2026-09-10" });
    expect(semEmpresa.statusCode, semEmpresa.body).toBe(201);
    const idSem = (j(semEmpresa) as { id: string }).id;
    const rasc2 = (await c.admin.query<{ id: string }>("select id::text from erp.dfe_drafts where dfe_id = $1 and status = 'pending'", [idSem])).rows;
    expect(rasc2, "premissa: o perfil gerou o rascunho da DF-e sem empresa").toHaveLength(1);
    recusa422(await aprovarRascunho(rasc2[0]!.id), "empresa_id", MSG.dfeSemEmpresa);
    expect((await c.admin.query("select 1 from erp.financial_titles where source_type = 'dfe_documents' and source_id = $1", [idSem])).rowCount).toBe(0);
    expect((await c.admin.query<{ status: string }>("select status from erp.dfe_drafts where id = $1", [rasc2[0]!.id])).rows[0]!.status).toBe("pending");

    // A porta que a mensagem promete: registrar de novo a MESMA chave com a empresa preenche a DF-e sem empresa — sem
    // um segundo rascunho —, e a aprovação passa na empresa dela.
    const deNovo = await registrarDfe({ access_key: chaveSintetica({ cnpj: emitente, nNF, cNF }), issuer_document: emitente, number: nNF, total: "100.00", emission_date: "2026-09-10", empresa_id: c.I.empresa2 });
    expect(deNovo.statusCode, deNovo.body).toBe(201);
    expect((j(deNovo) as { id: string }).id, "premissa: a mesma DF-e (upsert pela chave)").toBe(idSem);
    expect((await c.admin.query<{ empresa_id: string }>("select empresa_id::text from erp.dfe_documents where id = $1", [idSem])).rows[0]!.empresa_id).toBe(c.I.empresa2);
    expect((await c.admin.query("select 1 from erp.dfe_drafts where dfe_id = $1", [idSem])).rowCount, "um rascunho só").toBe(1);
    const ap2 = await aprovarRascunho(rasc2[0]!.id);
    expect(ap2.statusCode, ap2.body).toBe(200);
    expect((await c.admin.query<{ empresa_id: string }>("select empresa_id::text from erp.financial_titles where source_type = 'dfe_documents' and source_id = $1", [idSem])).rows)
      .toEqual([{ empresa_id: c.I.empresa2 }]);
    // Lançada, registrar de novo não a devolve a "rascunho" nem cria outro rascunho.
    expect((await registrarDfe({ access_key: chaveSintetica({ cnpj: emitente, nNF, cNF }), issuer_document: emitente })).statusCode).toBe(201);
    expect((await c.admin.query<{ launch_status: string }>("select launch_status from erp.dfe_documents where id = $1", [idSem])).rows[0]!.launch_status).toBe("launched");
    expect((await c.admin.query("select 1 from erp.dfe_drafts where dfe_id = $1", [idSem])).rowCount).toBe(1);
  });
});

// ─────────────── (5) o corpo de hoje ───────────────

describe("(5) o corpo de hoje, a resposta de hoje; o pedido recusa os campos fiscais; a capacidade", () => {
  it("compra sem as chaves novas: resposta, consulta, prévia e auditoria de hoje, chave por chave", async () => {
    const p = await produtoQueControla();
    const r = await lancarCompra("compra", corpoCompra([itemCompra(p.id, "2", "10.00")]));
    expect(r.statusCode, r.body).toBe(201);
    const doc = j(r) as Record<string, unknown> & { id: string };
    expect(Object.keys(doc)).toEqual(["id", "codigo", "especie", "situacao", "valor_itens", "valor_total"]);
    expect([doc.situacao, doc.valor_itens, doc.valor_total]).toEqual(["aberto", "20.00", "20.00"]);
    expect(await compraNoBanco(doc.id)).toMatchObject({ chave_acesso: null, uf_nota: null, tipo_documento_fiscal: null, valor_ipi: null, valor_icms_st: null,
      seguro: null, tipo_titulo_id: null, classificacao_gasto: null, rateio_tipo: null, parcelas_nota: null, dfe_id: null, solicitacao_compra_id: null });

    const lida = corpoDe(await lerCompra("compra", doc.id)) as Record<string, unknown> & { itens: Record<string, unknown>[] };
    for (const chave of ["tipo_titulo_nome", "importacao_id", "dfe", "rateio"]) expect(chave in lida, `a consulta de hoje não tem ${chave}`).toBe(false);
    expect("bem_codigo" in lida.itens[0]!).toBe(false);
    expect([lida.itens[0]!.gera_estoque, lida.itens[0]!.imobilizado, lida.itens[0]!.n_item_nota]).toEqual([null, null, null]);

    const previa = corpoDe(await previaCompra(doc.id)) as { financeiro: Record<string, unknown> };
    expect(Object.keys(previa.financeiro)).toEqual(["efeito", "valor", "numero", "parcelas", "primeiroVencimento", "classificacao"]);
    expect(previa.financeiro.classificacao).toEqual(expect.objectContaining({ categoria: expect.objectContaining({ id: c.I.category }) }));

    // A trilha "create" do serviço (a do gatilho genérico não tem metadata).
    const create = (await auditoriaDe("documentos_compra", doc.id, "create")).find((a) => a.metadata)!.metadata!;
    expect(Object.keys(create).sort()).toEqual(["codigo", "especie", "tipoOperacaoCodigo", "tipoOperacaoId", "tipoOperacaoVersao", "tipoOperacaoVersaoId"]);
    await confirmada(doc.id);
    const confirm = (await auditoriaDe("documentos_compra", doc.id, "confirm")).find((a) => a.metadata)!.metadata!;
    for (const chave of ["bens", "rateio"]) expect(chave in confirm).toBe(false);
    expect(await titulosDaCompra(doc.id)).toEqual([expect.objectContaining({ amount: "20.00", classification: "unclassified", document_type: null, title_type_id: null })]);
  });

  it("o pedido recusa os campos fiscais (cabeçalho e item); operation-types declara importacaoXml no fim", async () => {
    const p = await produtoQueControla();
    const pedido = (extra: Record<string, unknown>, item: Record<string, unknown> = {}) =>
      corpoCompra([itemCompra(p.id, "1", "10.00", item)], extra, "pedido");
    const ok = await lancarCompra("pedido", pedido({}));
    expect(ok.statusCode, `premissa: o pedido sem os campos fiscais é aceito — ${ok.body}`).toBe(201);
    recusa422(await lancarCompra("pedido", pedido({ chave_acesso: chaveNova() })), "chave_acesso", MSG.pedidoSemFiscais);
    recusa422(await lancarCompra("pedido", pedido({ seguro: "1.00" })), "seguro", MSG.pedidoSemFiscais);
    recusa422(await lancarCompra("pedido", pedido({}, { gera_estoque: false })), "itens[0].gera_estoque", MSG.pedidoSemFiscais);

    for (const segmento of ["compras", "pedidos"]) {
      const r = await c.ligada.inject({ method: "GET", url: `/api/compras/${segmento}/operation-types`, headers: c.h.headers() });
      expect(r.statusCode, r.body).toBe(200);
      const capacidades = (j(r) as { capacidades: Record<string, number> }).capacidades;
      expect(Object.keys(capacidades)).toEqual(["classificacaoFinanceira", "condicaoPagamento", "layoutDocumento", "regrasDaOperacao", "finalizacaoEOrcamento", "importacaoXml"]);
      expect(capacidades.importacaoXml).toBe(1);
    }
  });
});

// ─────────────── as parcelas explícitas do título (as duplicatas da nota) ───────────────

describe("as parcelas explícitas do título (TitleInput.parcelas)", () => {
  it("valem como vieram quando somam o valor; não somando, 422; junto de um plano, erro de programação; ausentes, a conta de hoje", () => {
    const parcelas = [{ dueDate: "2026-10-15", amount: "770.00" }, { dueDate: "2026-11-15", amount: "770.00" }];
    expect(parcelasDoTitulo({ amount: "1540.00", dueDate: "2026-09-10", plan: null, parcelas })).toEqual([
      { number: 1, dueDate: "2026-10-15", amount: "770.00", isDownPayment: false },
      { number: 2, dueDate: "2026-11-15", amount: "770.00", isDownPayment: false },
    ]);
    // Premissa: sem parcelas, a conta de hoje (uma parcela no vencimento).
    expect(parcelasDoTitulo({ amount: "1540.00", dueDate: "2026-09-10", plan: null })).toEqual([{ number: 1, dueDate: "2026-09-10", amount: "1540.00", isDownPayment: false }]);
    let recusa: unknown = null;
    try { parcelasDoTitulo({ amount: "1540.01", dueDate: "2026-09-10", plan: null, parcelas }); } catch (e) { recusa = e; }
    expect(recusa).toBeInstanceOf(DomainError);
    expect((recusa as DomainError).code).toBe("VALIDATION_ERROR");
    expect(() => parcelasDoTitulo({ amount: "1540.00", dueDate: "2026-09-10", parcelas,
      plan: { installments: 2, first_due_date: "2026-10-15", mode: "interval", interval_days: 30, has_down_payment: false } })).toThrow(/parcelas explícitas e plano/);
  });
});
