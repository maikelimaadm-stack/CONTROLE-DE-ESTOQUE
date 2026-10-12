import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { c, iniciar, encerrar, j } from "./top-config-08-ajuda.js";
import {
  prepararXml01, x, notaImportada, conferenciaLida, preenchimentoDo, itemNota, eanNovo, criarProdutos, corpoLote, criados, recusa, fotografia,
  contadorDoProduto, codigoDoContador, produtosNoBanco, produtoSemIdentidade, produtosComDescricao, idsGlobais, trilhaDe, situacaoDaImportacao,
  NCM_VIGENTE,
} from "./xml-01-ajuda.js";

/**
 * XML-01 (decisão 312) — 4.3 A ROTA `POST /compras/importacoes/:id/criar-produtos`: O QUE ELA CRIA.
 *
 * O lote cria, pela MESMA porta de `POST /api/resources/products` (`createOne`), um produto por PRODUTO pedido pelos
 * itens confirmados: código do contador, ID Global, auditoria pelo gatilho; os valores vêm da NOTA (descrição, NCM,
 * código de barras, unidade do uCom) e da IMPORTAÇÃO (o local), e só o Grupo e a Natureza vêm do corpo.
 *
 *   XML-I20 201 na forma do contrato (`ProdutosCriadosDaNota`): `itens` = um por item CONFIRMADO, na ordem da nota (o
 *           corpo em outra ordem, o id em maiúsculas); o item não confirmado não vira produto; os códigos são os
 *           próximos do contador, consecutivos; o ID Global de cada um; UMA linha 'create' na trilha por produto (o
 *           gatilho, com o autor) e UMA 'criar_produtos' da importação, com os produtos; a importação continua pendente;
 *   XML-I21 o produto do lote é IDÊNTICO ao de `POST /api/resources/products` com os mesmos valores (todas as colunas,
 *           menos id, code, created_at, updated_at e created_by) — e o code de cada um saiu do contador;
 *   XML-I22 os VALORES vêm da nota: description (cortada em 120, como o diálogo), NCM, código de barras e a unidade do
 *           uCom; o corpo não tem como mandá-los (chave desconhecida na raiz e no item ⇒ 422, nada criado);
 *   XML-I23 dois itens com o MESMO código e a MESMA unidade (caixa diferente no XML) = UM produto, e os dois itens o
 *           recebem; o mesmo código noutra unidade e outro código são produtos à parte.
 *
 * A testemunha é o banco (`c.admin`, sem RLS): o produto, o contador (`erp.code_sequences`), `erp.registros_globais`,
 * `erp.audit_logs` e a importação. Toda contagem é feita ANTES e DEPOIS.
 */

beforeAll(async () => { await iniciar(); await prepararXml01(); }, 240_000);
afterAll(encerrar);

const doSistema = async (simbolo: string): Promise<string> =>
  (await c.admin.query<{ id: string }>("select id::text as id from erp.measurement_units where organization_id is null and symbol=$1", [simbolo])).rows[0]!.id;

describe("4.3 a rota: o que ela cria", () => {
  it("XML-I20 201 na forma do contrato; códigos do contador; ID Global; a trilha por produto e a do lote; a importação continua pendente", async () => {
    const itens = [itemNota("R20-1", "CX", { ean: eanNovo() }), itemNota("R20-2", "UN"), itemNota("R20-3", "SC")];
    const n = await notaImportada(itens);
    const conf = await conferenciaLida(n.id);
    const unidades = [await doSistema("cx"), await doSistema("un"), await doSistema("sc")];
    expect([1, 2, 3].map((k) => preenchimentoDo(conf, k).measurement_id), "premissa: os três sem vínculo, com a unidade resolvida").toEqual(unidades);
    const antes = await fotografia();

    // O corpo em OUTRA ordem (3, 1) e o id em MAIÚSCULAS: a resposta segue a nota, o id volta em minúsculas.
    const b = await criados(criarProdutos(n.id.toUpperCase(), corpoLote([{ n_item: 3, armazem_id: c.I.warehouse }, { n_item: 1, armazem_id: c.I.warehouse }])));
    expect(Object.keys(b).sort(), "as chaves do contrato").toEqual(["importacao_id", "itens", "produtos"]);
    expect(b.importacao_id).toBe(n.id);
    expect(b.itens.map((i) => i.nItem), "um por item CONFIRMADO, na ordem da nota").toEqual([1, 3]);
    expect(b.produtos, "um produto por item (códigos distintos)").toHaveLength(2);
    for (const p of b.produtos) expect(Object.keys(p).sort()).toEqual(["codigo", "descricao", "id"]);
    for (const i of b.itens) {
      expect(Object.keys(i).sort()).toEqual(["localPadrao", "nItem", "produto"]);
      expect(Object.keys(i.produto).sort()).toEqual(["codigo", "controlaEstoque", "controleLote", "descricao", "id", "unidade"]);
    }

    // Os códigos: os próximos do contador lido ANTES, consecutivos, na ordem da nota; o contador andou exatamente 2.
    expect(b.produtos.map((p) => p.codigo)).toEqual([codigoDoContador(antes.contador + 1), codigoDoContador(antes.contador + 2)]);
    const depois = await fotografia();
    expect(depois).toEqual({ ...antes, produtos: antes.produtos + 2, contador: antes.contador + 2, indicesGlobais: antes.indicesGlobais + 2,
      trilhaDeProdutos: antes.trilhaDeProdutos + 2, trilhaDoLote: antes.trilhaDoLote + 1 });

    // Cada produto no banco: o da nota (item 1 e item 3), o Grupo e a Natureza do corpo, o local, o autor.
    const ids = b.produtos.map((p) => p.id);
    const banco = await produtosNoBanco(ids);
    expect(banco.map((p) => [p.code, p.description, p.measurement_id, p.barcode, p.ncm_code, p.group_id, p.financial_category_id, p.default_warehouse_id, p.created_by, p.deleted_at])).toEqual([
      [b.produtos[0]!.codigo, itens[0]!.descricao, unidades[0], itens[0]!.ean, NCM_VIGENTE, x.grupo, c.I.category, c.I.warehouse, x.adminId, null],
      [b.produtos[1]!.codigo, itens[2]!.descricao, unidades[2], null, NCM_VIGENTE, x.grupo, c.I.category, c.I.warehouse, x.adminId, null],
    ]);
    expect(b.produtos).toEqual(banco.map((p) => ({ id: p.id, codigo: p.code, descricao: p.description })));
    expect(b.itens.map((i) => i.produto)).toEqual([
      { id: banco[0]!.id, codigo: banco[0]!.code, descricao: banco[0]!.description, unidade: "cx", controleLote: "nenhum", controlaEstoque: true },
      { id: banco[1]!.id, codigo: banco[1]!.code, descricao: banco[1]!.description, unidade: "sc", controleLote: "nenhum", controlaEstoque: true },
    ]);
    expect(b.itens.map((i) => i.localPadrao)).toEqual([c.I.warehouse, c.I.warehouse]);
    expect(await produtosComDescricao(itens[1]!.descricao), "o item NÃO confirmado não virou produto").toBe(0);

    // O ID Global: um número para cada produto, distintos e crescentes na ordem da nota.
    const globais = await idsGlobais(ids);
    expect(globais.every((g) => typeof g === "number" && g > 0), `cada produto tem ID Global: ${JSON.stringify(globais)}`).toBe(true);
    expect(globais[1]! > globais[0]!, "crescentes na ordem de criação").toBe(true);

    // A trilha: UMA 'create' por produto (o gatilho), com o autor; e UMA 'criar_produtos' da importação, com os produtos.
    const trilha = await trilhaDe("products", ids);
    expect(trilha.filter((t) => t.action === "create").map((t) => [t.entity_id, t.user_id])).toEqual(ids.map((id) => [id, x.adminId]));
    const doLote = (await trilhaDe("importacoes_nfe_compra", [n.id])).filter((t) => t.action === "criar_produtos");
    expect(doLote, "uma linha da decisão do lote").toHaveLength(1);
    expect(doLote[0]!.user_id).toBe(x.adminId);
    for (const id of ids) expect(JSON.stringify(doLote[0]!.metadata?.produtos ?? null), `a trilha do lote cita o produto ${id}`).toContain(id);

    expect(await situacaoDaImportacao(n.id), "criar produtos não decide a importação").toBe("pendente");
  });

  it("XML-I21 o produto do lote é IDÊNTICO ao do POST /api/resources/products com os mesmos valores; o code de cada um saiu do contador", async () => {
    const ean = eanNovo();
    const item = itemNota("R21-1", "CX", { ean });
    const n = await notaImportada([item]);
    const p = preenchimentoDo(await conferenciaLida(n.id), 1);
    expect(p.measurement_id, "premissa: a unidade resolvida").toBe(await doSistema("cx"));

    const c0 = await contadorDoProduto();
    const b = await criados(criarProdutos(n.id, corpoLote([{ n_item: 1, armazem_id: c.I.warehouse }])));
    expect(b.produtos.map((x0) => x0.codigo), "o code do lote é o próximo do contador").toEqual([codigoDoContador(c0 + 1)]);
    expect(await contadorDoProduto()).toBe(c0 + 1);

    // O MESMO produto pela porta do cadastro, com os MESMOS valores (o que o diálogo de um item mandaria).
    const r = await c.ligada.inject({ method: "POST", url: "/api/resources/products", headers: c.h.headers(), payload: {
      description: p.description.slice(0, 120), ncm_code: p.ncm_code, barcode: p.barcode, measurement_id: p.measurement_id,
      group_id: x.grupo, financial_category_id: c.I.category, default_warehouse_id: c.I.warehouse,
    } });
    expect(r.statusCode, r.body).toBe(201);
    const porta = j(r) as { id: string; code: string };
    expect(porta.code, "o code da porta é o seguinte do contador").toBe(codigoDoContador(c0 + 2));
    expect(await contadorDoProduto()).toBe(c0 + 2);

    const doLote = await produtoSemIdentidade(b.produtos[0]!.id);
    const daPorta = await produtoSemIdentidade(porta.id);
    expect(Object.keys(doLote).length, "premissa: a comparação cobre a linha inteira").toBeGreaterThan(25);
    expect(doLote, "premissa: a linha comparada tem o que a nota disse").toMatchObject({ description: item.descricao, ncm_code: NCM_VIGENTE, barcode: ean,
      measurement_id: p.measurement_id, group_id: x.grupo, financial_category_id: c.I.category, default_warehouse_id: c.I.warehouse, deleted_at: null });
    expect(doLote, "o lote = a porta, coluna a coluna").toEqual(daPorta);
    // As duas linhas na trilha pelo MESMO gatilho.
    expect((await trilhaDe("products", [b.produtos[0]!.id, porta.id])).map((t) => t.action)).toEqual(["create", "create"]);
  });

  it("XML-I22 os VALORES vêm da nota (descrição cortada em 120, NCM, código de barras, unidade); o corpo não tem como mandá-los", async () => {
    const ean = eanNovo();
    const longa = `Produto XML-01 de descrição longa ${"x".repeat(120)}`;
    expect(longa.length, "premissa: a descrição da nota passa de 120").toBeGreaterThan(120);
    const item = itemNota("R22-1", "UN", { ean, descricao: longa, ncm: "31054000" });
    const n = await notaImportada([item]);
    const p = preenchimentoDo(await conferenciaLida(n.id), 1);
    expect(p.description, "premissa: a conferência traz a descrição inteira da nota").toBe(longa);

    // O corpo tentando mandar valores do produto: chave desconhecida, na raiz e no item ⇒ 422, nada criado.
    const tentativas: Record<string, unknown>[] = [
      corpoLote([{ n_item: 1 }], { description: "Outra descrição" }),
      corpoLote([{ n_item: 1 }], { ncm_code: "31052000" }),
      corpoLote([{ n_item: 1 }], { measurement_id: await doSistema("kg") }),
      corpoLote([{ n_item: 1 }], { code: "99999" }),
      corpoLote([{ n_item: 1, description: "Outra descrição" }]),
      corpoLote([{ n_item: 1, barcode: "7890000000000" }]),
      corpoLote([{ n_item: 1, measurement_id: await doSistema("kg") }]),
      corpoLote([{ n_item: 1, ncm_code: "31052000" }]),
    ];
    const antes = await fotografia();
    for (const corpo of tentativas) recusa(await criarProdutos(n.id, corpo), 422, "VALIDATION_ERROR");
    expect(await fotografia(), "nada criado").toEqual(antes);

    const b = await criados(criarProdutos(n.id, corpoLote([{ n_item: 1 }])));
    const [banco] = await produtosNoBanco([b.produtos[0]!.id]);
    expect(banco).toMatchObject({ description: longa.slice(0, 120), ncm_code: "31054000", barcode: ean, measurement_id: await doSistema("un") });
    expect(b.produtos[0]!.descricao).toBe(longa.slice(0, 120));
  });

  it("XML-I23 o MESMO código e a MESMA unidade em dois itens = UM produto, e os dois o recebem; outra unidade ou outro código = outro produto", async () => {
    const descricao = `Produto XML-01 repetido ${Date.now()}`;
    // O 2º item tem a unidade em minúsculas no XML: o leitor normaliza ("cx" → "CX"), a chave do produto é a mesma.
    const itens = [itemNota("R23-A", "CX", { descricao }), itemNota("R23-A", "cx", { descricao }), itemNota("R23-A", "UN"), itemNota("R23-B", "CX")];
    const n = await notaImportada(itens);
    const conf = await conferenciaLida(n.id);
    expect(conf.nota.itens.map((i) => [i.codigo, i.unidade]), "premissa: dois itens com a mesma chave").toEqual([["R23-A", "CX"], ["R23-A", "CX"], ["R23-A", "UN"], ["R23-B", "CX"]]);
    for (const k of [1, 2, 3, 4]) expect(preenchimentoDo(conf, k).measurement_id, "premissa: a unidade resolvida").toEqual(expect.any(String));
    const antes = await fotografia();
    const b = await criados(criarProdutos(n.id, corpoLote([1, 2, 3, 4].map((k) => ({ n_item: k, armazem_id: c.I.warehouse })))));
    expect(b.produtos, "três produtos: A/CX, A/UN e B/CX").toHaveLength(3);
    expect((await fotografia()).produtos - antes.produtos, "três linhas novas no banco").toBe(3);
    expect(b.itens.map((i) => i.nItem)).toEqual([1, 2, 3, 4]);
    const [i1, i2, i3, i4] = b.itens;
    expect(i2!.produto, "os dois itens da mesma chave recebem o MESMO produto").toEqual(i1!.produto);
    expect(new Set([i1!.produto.id, i3!.produto.id, i4!.produto.id]).size, "outra unidade e outro código são produtos à parte").toBe(3);
    expect(await produtosComDescricao(descricao), "UMA linha para os dois itens").toBe(1);
    expect(b.produtos.map((p) => p.id), "os produtos na ordem da nota").toEqual([i1!.produto.id, i3!.produto.id, i4!.produto.id]);
  });
});
