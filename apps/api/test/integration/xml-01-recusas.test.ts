import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { c, iniciar, encerrar, j, produto, usuario, escopos, unico, type Resposta } from "./top-config-08-ajuda.js";
import { notaSintetica, importada, fornecedorComDocumento, gerar, descartar, codigoDaCompra } from "./f7-ajuda.js";
import {
  prepararXml01, x, notaImportada, conferenciaLida, vinculoDo, preenchimentoDo, itemNota, eanNovo, emitenteNovo, criarProdutos, corpoLote, criados,
  recusa, caminhos, fotografia, comConsultas, insercoesDeProduto, produtosNoBanco, produtosComDescricao, situacaoDaImportacao, unidadeDaOrganizacao,
  unidadesQueCasam, outraOrganizacao, NCM_VIGENTE, type ItemDoCorpo,
} from "./xml-01-ajuda.js";

/**
 * XML-01 (decisão 312) — 4.3 A ROTA `POST /compras/importacoes/:id/criar-produtos`: O QUE ELA RECUSA, e a TRANSAÇÃO.
 *
 * Toda recusa aqui é provada por `semGravar`: a FOTOGRAFIA do banco (produtos, contador do código, ID Global, trilha de
 * produtos, trilha do lote, chaves de idempotência) é a MESMA antes e depois, E nenhum INSERT em `erp.products` saiu da
 * requisição (o espião das consultas) — a recusa vem ANTES de gravar, não só desfeita depois. E cada recusa tem a
 * PREMISSA ao lado: o mesmo cenário, do lado certo, cria.
 *
 *   XML-I30 PERMISSÃO: `compras.create` sem `products.create` ⇒ 403; `products.create` sem `compras.create` ⇒ 403;
 *           as duas ⇒ 201 (CAPACIDADE ∧ CAPACIDADE);
 *   XML-I31 VÍNCULO (C2): item lembrado, sugerido ou ambíguo na lista ⇒ 422 no item, nada criado (nem o item `nenhum`
 *           que ia junto);
 *   XML-I32 item fora da nota ⇒ 422; `n_item` repetido ⇒ 422 em `itens[i].n_item`;
 *   XML-I33 corpo ESTRITO: chave desconhecida (raiz e item), itens vazio, 991 itens, sem Grupo, uuid malformado ⇒ 422;
 *           a recusa da PORTA no Grupo e na Natureza (sintéticos) fica no campo do corpo;
 *   XML-I34 UNIDADE não resolvida (C1: nenhuma, ou duas da organização) ⇒ 422 no item, nada criado;
 *   XML-I35 NCM não vigente (D3: vencida, de nível 4, fora da tabela) ⇒ 422 no item, ANTES de gravar;
 *   XML-I36 TRANSAÇÃO: a falha no ÚLTIMO produto (gatilho de teste) desfaz os anteriores — os INSERTs saíram, zero ficou;
 *   XML-I37 IDEMPOTÊNCIA: mesma chave e mesmo autor ⇒ a mesma resposta e nenhum produto a mais; corpo diferente ou
 *           outro autor com a mesma chave ⇒ 409, nada criado;
 *   XML-I38 a MESMA 404 (malformado, inexistente, fora do escopo de empresa, outro tenant), ANTES do `idempotent`: com
 *           uma chave já usada, a resposta é a 404, não o 409 da chave;
 *   XML-I39 importação GERADA ⇒ 409 (a compra dita); DESCARTADA ⇒ 409; nada criado;
 *   XML-I40 `fornecedor_id` (C5): os vínculos são os do fornecedor escolhido — com o que lembra o item ⇒ 422; com outro
 *           candidato ⇒ 201; fora dos candidatos ⇒ 422 em `fornecedor_id`.
 */

beforeAll(async () => { await iniciar(); await prepararXml01(); }, 240_000);
afterAll(encerrar);

/** A requisição não grava NADA: a fotografia igual e nenhum INSERT em erp.products. */
async function semGravar(pedir: () => Promise<Resposta>): Promise<Resposta> {
  const antes = await fotografia();
  const { r, sqls } = await comConsultas(pedir);
  expect(await fotografia(), `nada criado — ${r.body}`).toEqual(antes);
  expect(insercoesDeProduto(sqls), "nenhum INSERT em erp.products").toEqual([]);
  return r;
}
/** A 422 de um item: o caminho começa no item `i` do corpo. */
function recusaNoItem(r: Resposta, i: number): void {
  const e = recusa(r, 422, "VALIDATION_ERROR");
  expect(caminhos(e).some((p) => p.startsWith(`itens[${i}]`)), `a recusa aponta itens[${i}]: ${JSON.stringify(e)}`).toBe(true);
}

// ─────────────── permissão ───────────────

describe("permissão: compras.create ∧ products.create", () => {
  it("XML-I30 compras.create sem products.create ⇒ 403; products.create sem compras.create ⇒ 403; as duas ⇒ 201", async () => {
    const n = await notaImportada([itemNota("P-1", "CX")]);
    const corpo = corpoLote([{ n_item: 1 }]);
    const soCompras = await usuario("XML01 só compras", ["compras.create"]);
    const soProdutos = await usuario("XML01 só produtos", ["products.create"]);
    const asDuas = await usuario("XML01 as duas", ["compras.create", "products.create"]);
    expect((await conferenciaLida(n.id, { headers: soCompras })).id, "premissa: quem só tem compras enxerga a importação (a 403 não é uma 404)").toBe(n.id);

    expect(recusa(await semGravar(() => criarProdutos(n.id, corpo, { headers: soCompras })), 403, "PERMISSION_DENIED").message).toBe("Sem permissão: products.create");
    expect(recusa(await semGravar(() => criarProdutos(n.id, corpo, { headers: soProdutos })), 403, "PERMISSION_DENIED").message).toBe("Sem permissão: compras.create");

    const b = await criados(criarProdutos(n.id, corpo, { headers: asDuas }));
    expect(b.produtos).toHaveLength(1);
    const autor = (await c.admin.query<{ id: string }>("select created_by::text id from erp.products where id=$1", [b.produtos[0]!.id])).rows[0]!.id;
    expect(autor, "o produto é de quem pediu").not.toBe(x.adminId);
  });
});

// ─────────────── vínculo (C2) ───────────────

describe("vínculo: só o item sem vínculo entra no lote (C2)", () => {
  it("XML-I31 lembrado, sugerido ou ambíguo na lista ⇒ 422 no item e nada criado (nem o item sem vínculo que ia junto)", async () => {
    const eSug = eanNovo(); const eAmb = eanNovo();
    const n = await notaImportada([itemNota("V-L", "CX"), itemNota("V-S", "CX", { ean: eSug }), itemNota("V-A", "CX", { ean: eAmb }), itemNota("V-N", "CX")]);
    const lembrado = await produto(); const sugerido = await produto(); const amb1 = await produto(); const amb2 = await produto();
    await c.admin.query("update erp.products set barcode=$2 where id=$1", [sugerido.id, eSug]);
    await c.admin.query("update erp.products set barcode=$2 where id = any($1::uuid[])", [[amb1.id, amb2.id], eAmb]);
    await c.admin.query(
      `insert into erp.produto_fornecedor_vinculos (organization_id, fornecedor_id, codigo_fornecedor, unidade_fornecedor, produto_id, tipo_fator, fator, criado_por)
       values ($1, $2, 'V-L', 'CX', $3, 'multiply', 1, $4)`, [c.h.demo.orgId, n.fornecedor, lembrado.id, x.adminId]);
    const conf = await conferenciaLida(n.id);
    expect([1, 2, 3, 4].map((k) => vinculoDo(conf, k).situacao), "premissa: as quatro situações").toEqual(["lembrado", "sugerido", "ambiguo", "nenhum"]);
    expect(preenchimentoDo(conf, 4).measurement_id, "premissa: o item sem vínculo tem a unidade").toEqual(expect.any(String));

    for (const k of [1, 2, 3]) recusaNoItem(await semGravar(() => criarProdutos(n.id, corpoLote([{ n_item: 4 }, { n_item: k }]))), 1);
    // Premissa: o item sem vínculo, sozinho, cria.
    const b = await criados(criarProdutos(n.id, corpoLote([{ n_item: 4 }])));
    expect(b.itens.map((i) => i.nItem)).toEqual([4]);
  });
});

// ─────────────── itens e corpo ───────────────

describe("os itens e o corpo estrito", () => {
  it("XML-I32 item fora da nota ⇒ 422 no item; n_item repetido ⇒ 422 em itens[i].n_item; n_item fora da forma ⇒ 422", async () => {
    const n = await notaImportada([itemNota("I32-1", "CX"), itemNota("I32-2", "CX")]);
    recusaNoItem(await semGravar(() => criarProdutos(n.id, corpoLote([{ n_item: 1 }, { n_item: 3 }]))), 1);
    recusaNoItem(await semGravar(() => criarProdutos(n.id, corpoLote([{ n_item: 1 }, { n_item: 99 }]))), 1);
    const repetido = recusa(await semGravar(() => criarProdutos(n.id, corpoLote([{ n_item: 2 }, { n_item: 1 }, { n_item: 2 }]))), 422, "VALIDATION_ERROR");
    expect(caminhos(repetido), JSON.stringify(repetido)).toContain("itens[2].n_item");
    for (const ruim of [0, -1, 1.5, "1", null]) recusa(await semGravar(() => criarProdutos(n.id, corpoLote([{ n_item: ruim as number }]))), 422, "VALIDATION_ERROR");
    // Premissa: os dois itens da nota, uma vez cada, criam.
    expect((await criados(criarProdutos(n.id, corpoLote([{ n_item: 1 }, { n_item: 2 }])))).itens.map((i) => i.nItem)).toEqual([1, 2]);
  });

  it("XML-I33 chave desconhecida (raiz e item), itens vazio, 991 itens, sem Grupo/Natureza, uuid malformado ⇒ 422; a recusa da porta no Grupo e na Natureza fica no campo do corpo", async () => {
    const n = await notaImportada([itemNota("I33-1", "CX")]);
    const ok = corpoLote([{ n_item: 1 }]);
    const sem = (chave: string) => Object.fromEntries(Object.entries(ok).filter(([k]) => k !== chave));
    const ruins: [string, Record<string, unknown>][] = [
      ["chave desconhecida na raiz", { ...ok, empresa_id: c.I.empresa }],
      ["chave desconhecida no item", corpoLote([{ n_item: 1, produto_id: randomUUID() }])],
      ["itens vazio", corpoLote([])],
      ["991 itens", corpoLote(Array.from({ length: 991 }, (_, k) => ({ n_item: k + 1 })))],
      ["sem itens", sem("itens")],
      ["sem Grupo", sem("group_id")],
      ["sem Natureza", sem("financial_category_id")],
      ["Grupo malformado", { ...ok, group_id: "nao-e-uuid" }],
      ["Natureza malformada", { ...ok, financial_category_id: "nao-e-uuid" }],
      ["fornecedor malformado", { ...ok, fornecedor_id: "nao-e-uuid" }],
      ["local malformado", corpoLote([{ n_item: 1, armazem_id: "nao-e-uuid" }])],
      ["itens não é lista", { ...ok, itens: { n_item: 1 } }],
    ];
    for (const [nome, corpo] of ruins) {
      const r = await semGravar(() => criarProdutos(n.id, corpo));
      expect([r.statusCode, (j(r).error ?? {}).code], `${nome}: ${r.body}`).toEqual([422, "VALIDATION_ERROR"]);
    }
    // A recusa da PORTA do cadastro num campo do CORPO: fica no campo do corpo (não vira caminho de item).
    const grupo = recusa(await semGravar(() => criarProdutos(n.id, { ...ok, group_id: x.grupoSintetico })), 422, "VALIDATION_ERROR");
    expect(caminhos(grupo), JSON.stringify(grupo)).toEqual(["group_id"]);
    const natureza = recusa(await semGravar(() => criarProdutos(n.id, { ...ok, financial_category_id: x.naturezaSintetica })), 422, "VALIDATION_ERROR");
    expect(caminhos(natureza), JSON.stringify(natureza)).toEqual(["financial_category_id"]);
    // Premissa: o corpo certo cria.
    expect((await criados(criarProdutos(n.id, ok))).produtos).toHaveLength(1);
  });
});

// ─────────────── unidade (C1) e NCM (D3) ───────────────

describe("o que a nota não resolve: a unidade (C1) e a NCM (D3)", () => {
  it("XML-I34 unidade não resolvida (nenhuma, ou duas da organização) num item confirmado ⇒ 422 no item, nada criado", async () => {
    const a = await unidadeDaOrganizacao("XRA"); const b = await unidadeDaOrganizacao(" xra");
    expect((await unidadesQueCasam("XRA")).organizacao.sort(), "premissa: XRA ambígua").toEqual([a, b].sort());
    expect(await unidadesQueCasam("ZZNADA"), "premissa: ZZNADA não casa").toEqual({ organizacao: [], sistema: [] });
    const n = await notaImportada([itemNota("C1-1", "CX"), itemNota("C1-2", "ZZNADA"), itemNota("C1-3", "XRA")]);
    const conf = await conferenciaLida(n.id);
    expect([1, 2, 3].map((k) => Object.hasOwn(preenchimentoDo(conf, k), "measurement_id")), "premissa: só o item 1 tem a unidade").toEqual([true, false, false]);
    recusaNoItem(await semGravar(() => criarProdutos(n.id, corpoLote([{ n_item: 1 }, { n_item: 2 }]))), 1);
    recusaNoItem(await semGravar(() => criarProdutos(n.id, corpoLote([{ n_item: 1 }, { n_item: 3 }]))), 1);
    // Premissa: o item de unidade resolvida, sozinho, cria.
    expect((await criados(criarProdutos(n.id, corpoLote([{ n_item: 1 }])))).itens.map((i) => i.nItem)).toEqual([1]);
  });

  it("XML-I35 NCM da nota não vigente (vencida, de nível 4, fora da tabela) ⇒ 422 no item ANTES de gravar qualquer coisa", async () => {
    const ncm = new Map((await c.admin.query<{ code: string; nivel: number; vigente: boolean }>(
      "select code, nivel, (vigencia_inicio <= current_date and vigencia_fim >= current_date) as vigente from erp.ncm where code = any($1::text[])",
      [[NCM_VIGENTE, "39139050", "3105", "99999999"]])).rows.map((r) => [r.code, r]));
    expect(ncm.get(NCM_VIGENTE), "premissa: a NCM do item 1 é de 8 dígitos e vigente").toMatchObject({ nivel: 8, vigente: true });
    expect(ncm.get("39139050"), "premissa: 39139050 é de 8 dígitos e VENCIDA").toMatchObject({ nivel: 8, vigente: false });
    expect(ncm.get("3105"), "premissa: 3105 é de nível 4").toMatchObject({ nivel: 4 });
    expect(ncm.has("99999999"), "premissa: 99999999 não está na tabela").toBe(false);
    const n = await notaImportada([itemNota("D3-1", "CX"), itemNota("D3-2", "CX", { ncm: "39139050" }), itemNota("D3-3", "CX", { ncm: "3105" }), itemNota("D3-4", "CX", { ncm: "99999999" })]);
    const conf = await conferenciaLida(n.id);
    expect([2, 3, 4].map((k) => preenchimentoDo(conf, k).ncm_code), "premissa: a conferência traz a NCM da nota").toEqual(["39139050", "3105", "99999999"]);
    for (const k of [2, 3, 4]) recusaNoItem(await semGravar(() => criarProdutos(n.id, corpoLote([{ n_item: 1 }, { n_item: k }]))), 1);
    // Premissa: o item de NCM vigente, sozinho, cria.
    const b = await criados(criarProdutos(n.id, corpoLote([{ n_item: 1 }])));
    expect((await produtosNoBanco([b.produtos[0]!.id]))[0]!.ncm_code).toBe(NCM_VIGENTE);
  });
});

// ─────────────── transação ───────────────

describe("uma transação", () => {
  it("XML-I36 a falha no ÚLTIMO produto (gatilho de teste) desfaz os anteriores: os três INSERTs saíram, zero produto ficou", async () => {
    const sabotada = `XML01-SABOTAGEM-${unico()}`;
    const itens = [itemNota("T-1", "CX"), itemNota("T-2", "UN"), itemNota("T-3", "SC", { descricao: sabotada })];
    const n = await notaImportada(itens);
    const corpo = corpoLote([{ n_item: 1, armazem_id: c.I.warehouse }, { n_item: 2, armazem_id: c.I.warehouse }, { n_item: 3, armazem_id: c.I.warehouse }]);
    await c.admin.query(`create or replace function erp.xml01_teste_sabotagem() returns trigger language plpgsql as $f$
      begin if new.description like 'XML01-SABOTAGEM-%' then raise exception 'CONFLICT: XML-01 sabotagem do último produto'; end if; return new; end $f$`);
    await c.admin.query("create trigger trg_xml01_teste_sabotagem before insert on erp.products for each row execute function erp.xml01_teste_sabotagem()");
    try {
      const antes = await fotografia();
      const { r, sqls } = await comConsultas(() => criarProdutos(n.id, corpo));
      const e = recusa(r, 409, "CONFLICT");
      expect(e.message, "a falha é a do gatilho, no último produto").toContain("XML-01 sabotagem do último produto");
      expect(insercoesDeProduto(sqls), "premissa: os TRÊS INSERTs saíram (os dois primeiros entraram antes da falha)").toHaveLength(3);
      expect(await fotografia(), "ZERO: nenhum produto, contador, ID Global ou trilha ficou").toEqual(antes);
      for (const i of itens) expect(await produtosComDescricao(i.descricao), `nada do item ${i.codigo}`).toBe(0);
      expect(await situacaoDaImportacao(n.id)).toBe("pendente");
    } finally {
      await c.admin.query("drop trigger if exists trg_xml01_teste_sabotagem on erp.products");
      await c.admin.query("drop function if exists erp.xml01_teste_sabotagem()");
    }
    expect((await c.admin.query("select 1 from pg_trigger where tgname = 'trg_xml01_teste_sabotagem'")).rowCount, "o gatilho de teste saiu").toBe(0);
    // Premissa: sem a sabotagem, o MESMO corpo cria os três.
    const antes = await fotografia();
    expect((await criados(criarProdutos(n.id, corpo))).produtos).toHaveLength(3);
    expect((await fotografia()).produtos).toBe(antes.produtos + 3);
  });
});

// ─────────────── idempotência ───────────────

describe("idempotência", () => {
  it("XML-I37 mesma chave e mesmo autor ⇒ a mesma resposta, nenhum produto a mais; corpo diferente ou outro autor com a mesma chave ⇒ 409, nada criado", async () => {
    const n = await notaImportada([itemNota("ID-1", "CX"), itemNota("ID-2", "UN")]);
    const corpo = corpoLote([{ n_item: 1 }, { n_item: 2 }]);
    const chave = `xml01-idem-${unico()}`;
    const antes = await fotografia();
    const r1 = await criarProdutos(n.id, corpo, { chave });
    const b1 = await criados(r1);
    expect(b1.produtos).toHaveLength(2);
    const meio = await fotografia();
    expect([meio.produtos, meio.idempotencia], "premissa: a 1ª criou os dois e guardou a chave").toEqual([antes.produtos + 2, antes.idempotencia + 1]);

    const r2 = await criarProdutos(n.id, corpo, { chave });
    expect(r2.statusCode, r2.body).toBe(201);
    expect(j(r2), "a MESMA resposta").toEqual(j(r1));
    expect(await fotografia(), "nenhum produto a mais").toEqual(meio);

    const outroCorpo = recusa(await semGravar(() => criarProdutos(n.id, corpoLote([{ n_item: 1 }]), { chave })), 409, "CONFLICT");
    expect(outroCorpo.message).toBe("Idempotency-Key reutilizada com corpo diferente");
    const outro = await usuario("XML01 outro autor", ["compras.create", "products.create"]);
    recusa(await semGravar(() => criarProdutos(n.id, corpo, { chave, headers: outro })), 409, "CONFLICT");
  });
});

// ─────────────── 404 e 409 ───────────────

/** Uma importação de OUTRA organização (a mesma estrutura, gravada por superusuário). */
async function importacaoAlheia(): Promise<string> {
  const outra = await outraOrganizacao();
  const emitente = emitenteNovo();
  const nota = notaSintetica({ emitenteCnpj: emitente, itens: [itemNota("A-1", "CX")] });
  const xml = (await c.admin.query<{ id: string }>(
    `insert into erp.notas_fiscais_xml (organization_id, empresa_id, chave_acesso, xml_original, xml_sha256, tamanho_bytes, recebido_por)
     values ($1, $2, $3, $4, encode(sha256(convert_to($4, 'UTF8')), 'hex'), octet_length($4), $5) returning id::text as id`,
    [outra.orgId, outra.empresaId, nota.chave, nota.xml, x.adminId])).rows[0]!.id;
  return (await c.admin.query<{ id: string }>(
    `insert into erp.importacoes_nfe_compra (organization_id, empresa_id, xml_id, chave_acesso, numero, serie, data_emissao, emitente_documento, emitente_nome, valor_total, origem, criado_por)
     values ($1, $2, $3, $4, $5, '1', '2026-09-08', $6, 'Emitente', $7, 'arquivo', $8) returning id::text as id`,
    [outra.orgId, outra.empresaId, xml, nota.chave, nota.numero, emitente, nota.vNF, x.adminId])).rows[0]!.id;
}

describe("a 404 e a 409", () => {
  it("XML-I38 a MESMA 404 (malformado, inexistente, fora do escopo de empresa, outro tenant), e ANTES do idempotent: com uma chave já usada vem a 404, não o 409 da chave", async () => {
    const daEmpresa2 = await notaImportada([itemNota("N-1", "CX")], { empresaId: c.I.empresa2 });
    const daEmpresa1 = await notaImportada([itemNota("N-2", "CX")]);
    const alheia = await importacaoAlheia();
    expect((await c.admin.query<{ o: string }>("select organization_id::text o from erp.importacoes_nfe_compra where id=$1", [alheia])).rows[0]!.o, "premissa: a alheia é de outra organização").not.toBe(c.h.demo.orgId);
    const soEmpresa1 = await usuario("XML01 escopo empresa 1", ["compras.create", "products.create"], escopos({ compras: [c.I.empresa] }));
    expect((await conferenciaLida(daEmpresa2.id)).empresa.id, "premissa: o administrador vê a importação da empresa 2").toBe(c.I.empresa2);
    expect((await criados(criarProdutos(daEmpresa1.id, corpoLote([{ n_item: 1 }]), { headers: soEmpresa1 }))).produtos,
      "premissa: quem só vê a empresa 1 tem as duas capacidades e cria na empresa 1").toHaveLength(1);

    // A chave JÁ USADA (pelo administrador, na importação da empresa 2): se o idempotent viesse antes, a resposta seria o 409.
    const chave = `xml01-404-${unico()}`;
    expect((await criados(criarProdutos(daEmpresa2.id, corpoLote([{ n_item: 1 }]), { chave }))).produtos).toHaveLength(1);
    const corpo = corpoLote([{ n_item: 1 }]);
    const respostas = [
      await semGravar(() => criarProdutos("nao-e-uuid", corpo, { chave })),
      await semGravar(() => criarProdutos(randomUUID(), corpo, { chave })),
      await semGravar(() => criarProdutos(daEmpresa2.id, corpo, { chave, headers: soEmpresa1 })),
      await semGravar(() => criarProdutos(alheia, corpo, { chave })),
      await semGravar(() => criarProdutos(alheia, corpo)),
    ];
    for (const r of respostas) expect([r.statusCode, JSON.parse(r.body)], r.body).toEqual([404, { error: { code: "NOT_FOUND", message: "Importação não encontrada" } }]);
    expect(new Set(respostas.map((r) => r.body)).size, "o corpo é o MESMO nas cinco").toBe(1);
  });

  it("XML-I39 importação GERADA ⇒ 409 dizendo a compra; DESCARTADA ⇒ 409; nada criado", async () => {
    // O fluxo da tela: cria o produto da nota, gera a compra com ele; depois disso, o lote recusa.
    const n = await notaImportada([itemNota("G-1", "CX"), itemNota("G-2", "UN")]);
    const b = await criados(criarProdutos(n.id, corpoLote([{ n_item: 1 }])));
    const outro = await produto();
    const g = await gerar(n.id, { tipo_operacao_id: c.tops.compra, fornecedor_id: n.fornecedor, data_entrada: "2026-09-10",
      financeiro: { parcelas: "condicao", rateio: { tipo: "documento", categoria_financeira_id: c.I.category, centro_custo_id: c.I.costCenter } },
      itens: [{ n_item: 1, produto_id: b.produtos[0]!.id, fator: "1", tipo_fator: "multiply", armazem_id: c.I.warehouse },
        { n_item: 2, produto_id: outro.id, fator: "1", tipo_fator: "multiply", armazem_id: c.I.warehouse }] });
    expect(g.statusCode, `premissa: a compra é gerada com o produto do lote — ${g.body}`).toBe(201);
    const codigo = await codigoDaCompra((j(g) as { id: string }).id);
    expect(await situacaoDaImportacao(n.id)).toBe("gerada");
    expect(recusa(await semGravar(() => criarProdutos(n.id, corpoLote([{ n_item: 2 }]))), 409, "CONFLICT").message).toBe(`Esta importação já gerou a Compra ${codigo}.`);

    const d = await notaImportada([itemNota("G-3", "CX")]);
    expect((await descartar(d.id)).statusCode, "premissa: descartada").toBe(200);
    expect(await situacaoDaImportacao(d.id)).toBe("descartada");
    expect(recusa(await semGravar(() => criarProdutos(d.id, corpoLote([{ n_item: 1 }]))), 409, "CONFLICT").message).toBe("Esta importação foi descartada.");
  });
});

// ─────────────── fornecedor (C5) ───────────────

describe("o fornecedor escolhido (C5)", () => {
  it("XML-I40 os vínculos são os do fornecedor do corpo: com o que lembra o item ⇒ 422; com o outro candidato ⇒ 201; fora dos candidatos ⇒ 422 em fornecedor_id", async () => {
    const emitente = emitenteNovo();
    const doCadastro = await fornecedorComDocumento(emitente);
    const daFilial = await fornecedorComDocumento(emitenteNovo());
    await c.admin.query("insert into erp.provider_branches (person_id, name, document) values ($1, 'Filial sintética XML-01', $2)", [daFilial, emitente]);
    const nota = notaSintetica({ emitenteCnpj: emitente, itens: [itemNota("F-1", "CX")] });
    const imp = await importada(nota.xml, { empresaId: c.I.empresa });
    const lembrado = await produto();
    await c.admin.query(
      `insert into erp.produto_fornecedor_vinculos (organization_id, fornecedor_id, codigo_fornecedor, unidade_fornecedor, produto_id, tipo_fator, fator, criado_por)
       values ($1, $2, 'F-1', 'CX', $3, 'multiply', 1, $4)`, [c.h.demo.orgId, doCadastro, lembrado.id, x.adminId]);
    const comCadastro = await conferenciaLida(imp.id, { fornecedorId: doCadastro });
    const comFilial = await conferenciaLida(imp.id, { fornecedorId: daFilial });
    expect(comCadastro.parceiro.situacao, "premissa: o parceiro é ambíguo").toBe("ambiguo");
    expect([vinculoDo(comCadastro, 1).situacao, vinculoDo(comFilial, 1).situacao], "premissa: o vínculo depende do fornecedor").toEqual(["lembrado", "nenhum"]);

    const itens: ItemDoCorpo[] = [{ n_item: 1 }];
    recusaNoItem(await semGravar(() => criarProdutos(imp.id, corpoLote(itens, { fornecedor_id: doCadastro }))), 0);
    const fora = recusa(await semGravar(() => criarProdutos(imp.id, corpoLote(itens, { fornecedor_id: c.I.provider }))), 422, "VALIDATION_ERROR");
    expect(caminhos(fora), JSON.stringify(fora)).toEqual(["fornecedor_id"]);
    expect(fora.message).toBe("O fornecedor escolhido não é o emitente desta nota.");
    const b = await criados(criarProdutos(imp.id, corpoLote(itens, { fornecedor_id: daFilial })));
    expect(b.itens.map((i) => i.nItem)).toEqual([1]);
    expect(b.itens[0]!.produto.id, "o produto criado não é o lembrado do outro fornecedor").not.toBe(lembrado.id);
  });
});
