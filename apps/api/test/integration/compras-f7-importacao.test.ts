import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  c, iniciar, encerrar, j, erro, produto, top, itemCompra, corpoCompra, compraLancada, confirmarCompra, lerCompra,
  usuario, escopos, type Resposta,
} from "./top-config-08-ajuda.js";
import {
  cnpjComDv, notaSintetica, fornecedorComDocumento, codigoDaCompra, topCompraAutomatica, importar, importada, conferencia, gerar, descartar,
  importarDaDfe, registrarDfe, zipDeArquivos, compraNoBanco, titulosDaCompra, ITEM_PADRAO, type ItemSintetico,
} from "./f7-ajuda.js";

/**
 * OPERACOES-01 F7 (decisão 284) — A IMPORTAÇÃO DO XML NA CENTRAL DE COMPRAS (`routes/compras-importacao.ts`).
 *
 * Os XMLs são SINTÉTICOS (`f7-ajuda.ts`: CNPJ e chave inventados, DV calculado lá); cada cenário usa o SEU emitente
 * (CNPJ novo, DV calculado aqui) — a identidade do parceiro não vaza de um caso para outro. A testemunha é o banco, lido
 * por superusuário (sem RLS). Cada caso afirma a PREMISSA junto da conclusão:
 *   (1) importar → (descartar e reimportar o MESMO conteúdo em ZIP: o mesmo XML guardado) → gerar numa TOP com
 *       confirmação AUTOMÁTICA → a compra nasce ABERTA; quantidade = qCom × fator; unitário = vProd ÷ quantidade;
 *       total = vNF; dados fiscais e duplicatas gravados; confirmada à mão, os títulos são as duplicatas;
 *   (2) a mesma nota de novo → 409 dizendo a Compra; a importação pendente da mesma chave → 409 com o id dela;
 *   (3) parceiro AMBÍGUO (o cadastro com o CNPJ e a filial de outro fornecedor com o mesmo CNPJ) → candidatos; o
 *       fornecedor fora dos candidatos é recusado; um candidato gera;
 *   (4) o VÍNCULO LEMBRADO: a 2ª nota do mesmo fornecedor/código/unidade já vem com o produto e o fator da 1ª;
 *   (5) com PEDIDO (xPed/nItemPed): referenciado; a entrega PARCIAL numa TOP "em partes" mantém o saldo do pedido;
 *   (6) 404 uniforme; destinatário ambíguo; a DF-e; a solicitação antiga aceita a compra gerada.
 */

let seqEmitente = 0;
/** Um CNPJ de emitente NOVO (base fictícia com o DV calculado em `cnpjComDv`). */
const emitenteNovo = (): string => cnpjComDv(`9${String((Date.now() % 1e9) * 10 + (++seqEmitente % 10)).padStart(11, "0").slice(-11)}`);
const rateioDocumento = () => ({ tipo: "documento", categoria_financeira_id: c.I.category, centro_custo_id: c.I.costCenter });
const corpoGerar = (topId: string, fornecedorId: string, itens: Record<string, unknown>[], financeiro: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  tipo_operacao_id: topId, fornecedor_id: fornecedorId, data_entrada: "2026-09-10",
  financeiro: { parcelas: "condicao", rateio: rateioDocumento(), ...financeiro }, itens, ...extra,
});
type Conferencia = Record<string, unknown> & {
  id: string; situacao: string; fornecedorEscolhido: string | null;
  parceiro: { situacao: string; id?: string; candidatos?: { id: string; origem: string }[] };
  itens: { nItem: number; vinculo: { situacao: string; produto?: { id: string }; fator?: string; tipoFator?: string }; quantidadeInterna: string | null; itemDoPedido: { pedidoId: string; itemId: string; posicao: number } | null }[];
  pedidos: { referenciados: { xPed: string; pedido: { id: string } | null }[] };
  financeiro: { parcelas: { situacao: string } };
  divergencias: { codigo: string; bloqueia: boolean }[];
};
const comoConferencia = (r: Resposta) => j(r) as unknown as Conferencia;
function recusa(r: Resposta, status: number, codigo: string): { code: string; message: string; details?: unknown } {
  expect(r.statusCode, r.body).toBe(status);
  const e = erro(r);
  expect(e.code).toBe(codigo);
  return e;
}
const importacaoNoBanco = async (id: string) => (await c.admin.query<{ situacao: string; documento_compra_id: string | null; xml_id: string; origem: string; dfe_id: string | null }>(
  "select situacao, documento_compra_id::text, xml_id::text, origem, dfe_id::text from erp.importacoes_nfe_compra where id = $1", [id])).rows[0]!;

beforeAll(iniciar, 240_000);
afterAll(encerrar);

// ─────────────── (1) importar → gerar (aberta, fator, vNF, duplicatas) ───────────────

describe("(1) importar e gerar a compra", () => {
  it("o mesmo conteúdo em ZIP reaproveita o XML guardado; a compra nasce ABERTA mesmo com a TOP automática, com fator, vNF e duplicatas", async () => {
    const emitente = emitenteNovo();
    const fornecedor = await fornecedorComDocumento(emitente, { mascarado: true });
    const p = await produto();
    const item: ItemSintetico = { ...ITEM_PADRAO, codigo: "F7-A1", quantidade: "10.0000", valorUnitario: "100.00", valorProdutos: "1000.00",
      desconto: "10.00", frete: "15.00", seguro: "5.00", ipi: "50.00", icmsSt: "20.00" };
    const nota = notaSintetica({ emitenteCnpj: emitente, itens: [item],
      duplicatas: [{ numero: "001", vencimento: "2026-10-08", valor: "540.00" }, { numero: "002", vencimento: "2026-11-07", valor: "540.00" }] });
    expect(nota.vNF, "premissa: vNF = 1000 − 10 + 15 + 5 + 50 + 20").toBe("1080.00");

    // Importar, descartar e importar o MESMO conteúdo num ZIP: a 2ª importação nasce, com o MESMO XML guardado.
    const primeira = await importada(nota.xml, { empresaId: c.I.empresa });
    const desc = await descartar(primeira.id);
    expect(desc.statusCode, desc.body).toBe(200);
    expect(j(desc)).toEqual({ id: primeira.id, situacao: "descartada" });
    expect(recusa(await descartar(primeira.id), 409, "CONFLICT").message).toBe("Esta importação foi descartada.");
    const zip = zipDeArquivos([{ nome: "danfe.pdf", conteudo: "%PDF sintético" }, { nome: `NFe${nota.chave}.xml`, conteudo: nota.xml, comprimir: true }]);
    const conf = comoConferencia(await importar(zip, { empresaId: c.I.empresa }).then((r) => { expect(r.statusCode, r.body).toBe(201); return r; }));
    expect(conf.id).not.toBe(primeira.id);
    expect((await importacaoNoBanco(conf.id)).xml_id, "o mesmo conteúdo é o mesmo XML guardado").toBe((await importacaoNoBanco(primeira.id)).xml_id);
    // A conferência: o parceiro achado pelo CNPJ normalizado (o cadastro guarda COM máscara), o item sem vínculo.
    expect(conf.parceiro).toMatchObject({ situacao: "encontrado", id: fornecedor });
    expect(conf.fornecedorEscolhido).toBe(fornecedor);
    expect(conf.itens).toEqual([expect.objectContaining({ nItem: 1, vinculo: expect.objectContaining({ situacao: "nenhum" }), quantidadeInterna: null })]);
    expect(conf.divergencias).toContainEqual(expect.objectContaining({ codigo: "item_sem_vinculo", bloqueia: true }));
    expect(conf.financeiro.parcelas.situacao).toBe("conferem");

    // Premissa: a TOP confirma SOZINHA a compra lançada pelo POST de sempre.
    const topAuto = await topCompraAutomatica();
    const manual = await compraLancada("compra", corpoCompra([itemCompra(p.id, "1", "10.00")], { tipo_operacao_id: topAuto }));
    expect(manual.situacao, "premissa: a TOP é de confirmação automática").toBe("confirmado");

    const r = await gerar(conf.id, corpoGerar(topAuto, fornecedor,
      [{ n_item: 1, produto_id: p.id, fator: "12", tipo_fator: "multiply", armazem_id: c.I.warehouse }], { parcelas: "nota" }));
    expect(r.statusCode, r.body).toBe(201);
    const g = j(r) as { id: string; codigo: string; situacao: string; valor_total: string; importacao_id: string };
    expect(g).toMatchObject({ situacao: "aberto", especie: "compra", valor_total: "1080.00", importacao_id: conf.id });
    expect(g).not.toHaveProperty("confirmacaoAutomatica");
    const banco = await compraNoBanco(g.id);
    expect(banco).toMatchObject({ situacao: "aberto", empresa_id: c.I.empresa, valor_total: "1080.00", chave_acesso: nota.chave, uf_nota: "GO",
      tipo_documento_fiscal: "nfe", valor_ipi: "50.00", valor_icms_st: "20.00", seguro: "5.00", data_vencimento: "2026-10-08" });
    expect(JSON.parse(banco.parcelas_nota!)).toEqual([{ numero: "001", vencimento: "2026-10-08", valor: "540.00" }, { numero: "002", vencimento: "2026-11-07", valor: "540.00" }]);
    const itens = (await c.admin.query<Record<string, string | number>>(
      `select quantidade::text, valor_unitario::text, desconto::text, valor_ipi::text, valor_icms_st::text, n_item_nota, codigo_produto_nota, unidade_nota,
              quantidade_nota::text, fator_conversao::text, tipo_fator_conversao from erp.documentos_compra_itens where documento_id = $1`, [g.id])).rows;
    // 1000,00 ÷ 120 = 8,3333…: o unitário arredonda PARA CIMA e a linha fecha o vProd (120 × 8,333334 = 1000,00008 → 1000,00)
    expect(itens).toEqual([{ quantidade: "120.0000", valor_unitario: "8.333334", desconto: "10.00", valor_ipi: "50.00", valor_icms_st: "20.00", n_item_nota: 1,
      codigo_produto_nota: "F7-A1", unidade_nota: "CX", quantidade_nota: "10.0000", fator_conversao: "12.000000", tipo_fator_conversao: "multiply" }]);
    expect(await importacaoNoBanco(conf.id)).toMatchObject({ situacao: "gerada", documento_compra_id: g.id });
    expect(await titulosDaCompra(g.id), "aberta: nenhum título antes da confirmação").toEqual([]);

    // Gerada, a importação não gera de novo (409 dizendo a compra) nem é descartada.
    expect(recusa(await gerar(conf.id, corpoGerar(topAuto, fornecedor, [{ n_item: 1, produto_id: p.id, fator: "12", tipo_fator: "multiply" }])), 409, "CONFLICT").message)
      .toBe(`Esta importação já gerou a Compra ${g.codigo}.`);

    // Confirmada À MÃO: os títulos são as duplicatas da nota.
    const conf2 = await confirmarCompra(g.id);
    expect(conf2.statusCode, conf2.body).toBe(200);
    expect((await titulosDaCompra(g.id)).map((t) => [t.due_date, t.amount])).toEqual([["2026-10-08", "540.00"], ["2026-11-07", "540.00"]]);
  });
});

// ─────────────── (2) nota repetida ───────────────

describe("(2) a nota repetida", () => {
  it("a nota já numa compra → 409 dizendo a Compra; a importação pendente da mesma chave → 409 com o id dela", async () => {
    const emitente = emitenteNovo();
    // O cadastro com OUTRA IE (o único candidato do documento): achado, com o AVISO da IE — não bloqueia.
    const fornecedor = await fornecedorComDocumento(emitente, { ie: "555.666.777" });
    const p = await produto();
    const nota = notaSintetica({ emitenteCnpj: emitente });
    const conf = await importada(nota.xml, { empresaId: c.I.empresa });
    const daIe = comoConferencia(await conferencia(conf.id));
    expect(daIe.parceiro, "premissa: um candidato só, achado pelo documento").toMatchObject({ situacao: "encontrado", id: fornecedor });
    expect(daIe.divergencias.filter((x) => x.codigo === "parceiro_ie_diferente")).toEqual([expect.objectContaining({ bloqueia: false })]);
    const pendente = recusa(await importar(nota.xml, { empresaId: c.I.empresa }), 409, "DUPLICATE_DOCUMENT");
    expect(pendente).toMatchObject({ message: "Esta nota já tem uma importação pendente.", details: { onde: "importacao", id: conf.id } });
    const r = await gerar(conf.id, corpoGerar(c.tops.compra, fornecedor, [{ n_item: 1, produto_id: p.id, fator: "1", tipo_fator: "multiply", armazem_id: c.I.warehouse }]));
    expect(r.statusCode, `premissa: a compra é gerada — ${r.body}`).toBe(201);
    const codigo = await codigoDaCompra((j(r) as { id: string }).id);
    const repetida = recusa(await importar(nota.xml, { empresaId: c.I.empresa }), 409, "DUPLICATE_DOCUMENT");
    expect(repetida.details).toEqual({ onde: "compra", codigo });
    expect(repetida.message).toContain(`já está na Compra ${codigo}`);
  });
});

// ─────────────── (3) parceiro ambíguo ───────────────

describe("(3) o parceiro ambíguo", () => {
  it("cadastro e filial de outro fornecedor com o mesmo CNPJ → candidatos; fora deles é recusado; um candidato gera", async () => {
    const emitente = emitenteNovo();
    const doCadastro = await fornecedorComDocumento(emitente);
    const daFilial = await fornecedorComDocumento(emitenteNovo());
    await c.admin.query("insert into erp.provider_branches (person_id, name, document) values ($1, 'Filial sintética F7', $2)", [daFilial, emitente]);
    const p = await produto();
    const nota = notaSintetica({ emitenteCnpj: emitente });
    const conf = comoConferencia(await importar(nota.xml, { empresaId: c.I.empresa }));
    expect(conf.parceiro.situacao).toBe("ambiguo");
    expect(conf.parceiro.candidatos!.map((x) => [x.id, x.origem]).sort()).toEqual([[doCadastro, "cadastro"], [daFilial, "filial"]].sort());
    expect(conf.fornecedorEscolhido, "ambíguo: nunca 'o primeiro'").toBeNull();
    expect(conf.divergencias).toContainEqual(expect.objectContaining({ codigo: "parceiro_ambiguo", bloqueia: true }));

    const escolhida = await conferencia(conf.id, { fornecedorId: daFilial });
    expect(escolhida.statusCode, escolhida.body).toBe(200);
    expect(comoConferencia(escolhida).fornecedorEscolhido).toBe(daFilial);
    expect(recusa(await conferencia(conf.id, { fornecedorId: c.I.provider }), 422, "VALIDATION_ERROR").details)
      .toEqual([expect.objectContaining({ path: "fornecedor_id", message: "O fornecedor escolhido não é o emitente desta nota." })]);

    const item = [{ n_item: 1, produto_id: p.id, fator: "1", tipo_fator: "multiply", armazem_id: c.I.warehouse }];
    const fora = recusa(await gerar(conf.id, corpoGerar(c.tops.compra, c.I.provider, item)), 422, "VALIDATION_ERROR");
    expect(fora.details).toEqual([expect.objectContaining({ path: "fornecedor_id", message: "O fornecedor escolhido não é o emitente desta nota." })]);
    expect((await importacaoNoBanco(conf.id)).situacao, "recusada, a importação continua pendente").toBe("pendente");
    const r = await gerar(conf.id, corpoGerar(c.tops.compra, daFilial, item));
    expect(r.statusCode, r.body).toBe(201);
    expect((await compraNoBanco((j(r) as { id: string }).id)).situacao).toBe("aberto");
  });
});

// ─────────────── (4) vínculo lembrado ───────────────

describe("(4) o vínculo lembrado", () => {
  it("a 2ª nota do mesmo fornecedor, código e unidade já vem com o produto e o fator da 1ª", async () => {
    const emitente = emitenteNovo();
    const fornecedor = await fornecedorComDocumento(emitente);
    const p = await produto();
    const item: ItemSintetico = { ...ITEM_PADRAO, codigo: "F7-V1", unidade: "cx", quantidade: "4.0000", valorUnitario: "60.00", valorProdutos: "240.00" };
    const primeira = comoConferencia(await importar(notaSintetica({ emitenteCnpj: emitente, itens: [item] }).xml, { empresaId: c.I.empresa }));
    expect(primeira.itens[0]!.vinculo.situacao, "premissa: na 1ª nota o item não tem vínculo").toBe("nenhum");
    const r = await gerar(primeira.id, corpoGerar(c.tops.compra, fornecedor, [{ n_item: 1, produto_id: p.id, fator: "6", tipo_fator: "multiply", armazem_id: c.I.warehouse }]));
    expect(r.statusCode, r.body).toBe(201);
    const lembrado = (await c.admin.query<{ produto_id: string; fator: string; tipo_fator: string; unidade_fornecedor: string }>(
      "select produto_id::text, fator::text, tipo_fator, unidade_fornecedor from erp.produto_fornecedor_vinculos where fornecedor_id = $1 and codigo_fornecedor = 'F7-V1'", [fornecedor])).rows;
    expect(lembrado).toEqual([{ produto_id: p.id, fator: "6.000000", tipo_fator: "multiply", unidade_fornecedor: "CX" }]);

    const segunda = comoConferencia(await importar(notaSintetica({ emitenteCnpj: emitente, itens: [{ ...item, quantidade: "2.0000", valorProdutos: "120.00" }] }).xml, { empresaId: c.I.empresa }));
    expect(segunda.itens[0]).toMatchObject({ vinculo: { situacao: "lembrado", produto: { id: p.id }, fator: "6.000000", tipoFator: "multiply" }, quantidadeInterna: "12.0000" });
    expect(segunda.divergencias.filter((x) => x.bloqueia), "com o vínculo lembrado, nada bloqueia").toEqual([]);
  });
});

// ─────────────── (5) pedido parcial ───────────────

describe("(5) a nota com pedido", () => {
  it("xPed/nItemPed acham o pedido e o item; a entrega PARCIAL numa TOP 'em partes' mantém o saldo do pedido", async () => {
    const emitente = emitenteNovo();
    const fornecedor = await fornecedorComDocumento(emitente);
    const p = await produto();
    const topCompra = await top("compras.compra");
    const topPedido = await top("compras.pedido", { destinos: [{ tipoOperacaoId: topCompra, ordem: 0, emPartes: true }] });
    const pedido = await compraLancada("pedido", corpoCompra([itemCompra(p.id, "100", "8.00")], { tipo_operacao_id: topPedido, fornecedor_id: fornecedor }, "pedido"));
    const lido = j(await lerCompra("pedido", pedido.id)) as { codigo: string; itens: { id: string; saldo: string }[] };
    expect(lido.itens[0]!.saldo, "premissa: o pedido tem 100 de saldo").toBe("100.0000");
    const nota = notaSintetica({ emitenteCnpj: emitente, itens: [{ ...ITEM_PADRAO, codigo: "F7-P1", unidade: "UN", quantidade: "40.0000", valorUnitario: "8.00",
      valorProdutos: "320.00", xPed: lido.codigo, nItemPed: "1" }] });
    const conf = comoConferencia(await importar(nota.xml, { empresaId: c.I.empresa }));
    expect(conf.pedidos.referenciados).toEqual([{ xPed: lido.codigo, pedido: expect.objectContaining({ id: pedido.id }) }]);
    expect(conf.itens[0]!.itemDoPedido).toEqual({ pedidoId: pedido.id, itemId: lido.itens[0]!.id, posicao: 0 });

    const r = await gerar(conf.id, corpoGerar(topCompra, fornecedor,
      [{ n_item: 1, produto_id: p.id, fator: "1", tipo_fator: "multiply", armazem_id: c.I.warehouse, item_origem_id: lido.itens[0]!.id }], {}, { pedido_id: pedido.id }));
    expect(r.statusCode, r.body).toBe(201);
    const compra = (j(r) as { id: string }).id;
    expect((await c.admin.query<{ origem: string; situacao: string }>("select origem_documento_id::text as origem, situacao from erp.documentos_compra where id = $1", [compra])).rows[0])
      .toEqual({ origem: pedido.id, situacao: "aberto" });
    const depois = j(await lerCompra("pedido", pedido.id)) as { situacao: string; itens: { saldo: string }[] };
    expect(depois.situacao, "entrega parcial: o pedido não é convertido").toBe("aberto");
    expect(depois.itens[0]!.saldo, "o saldo fica").toBe("60.0000");
  });
});

// ─────────────── (6) 404, destinatário, DF-e, solicitação ───────────────

describe("(6) recusas e vínculos", () => {
  it("404 uniforme: malformado, inexistente, fora do escopo de empresa e de outro tenant", async () => {
    const emitente = emitenteNovo();
    await fornecedorComDocumento(emitente);
    const daEmpresa2 = await importada(notaSintetica({ emitenteCnpj: emitente }).xml, { empresaId: c.I.empresa2 });
    const soEmpresa1 = await usuario("F7 escopo empresa 1", ["compras.create", "compras.view"], escopos({ compras: [c.I.empresa] }));
    const visivel = await conferencia(daEmpresa2.id);
    expect(visivel.statusCode, `premissa: o administrador vê a importação da empresa 2 — ${visivel.body}`).toBe(200);
    // Outro tenant: a mesma estrutura gravada por superusuário noutra organização.
    const org = (await c.admin.query<{ id: string }>("insert into erp.organizations(name, slug) values ('F7 outra', $1) returning id::text as id", [`f7-outra-${Date.now()}`])).rows[0]!.id;
    const emp = (await c.admin.query<{ id: string }>("insert into erp.empresas(organization_id, code, name, document) values ($1, 1, 'Empresa F7 outra', '00000000000191') returning id::text as id", [org])).rows[0]!.id;
    const admin = (await c.admin.query<{ id: string }>("select id::text as id from erp.users where email = $1", [c.h.demo.adminEmail])).rows[0]!.id;
    const n = notaSintetica({ emitenteCnpj: emitente });
    const xml = (await c.admin.query<{ id: string }>(
      `insert into erp.notas_fiscais_xml (organization_id, empresa_id, chave_acesso, xml_original, xml_sha256, tamanho_bytes, recebido_por)
       values ($1, $2, $3, $4, encode(sha256(convert_to($4, 'UTF8')), 'hex'), octet_length($4), $5) returning id::text as id`, [org, emp, n.chave, n.xml, admin])).rows[0]!.id;
    const alheia = (await c.admin.query<{ id: string }>(
      `insert into erp.importacoes_nfe_compra (organization_id, empresa_id, xml_id, chave_acesso, numero, serie, data_emissao, emitente_documento, emitente_nome, valor_total, origem, criado_por)
       values ($1, $2, $3, $4, $5, '1', '2026-09-08', $6, 'Emitente', $7, 'arquivo', $8) returning id::text as id`, [org, emp, xml, n.chave, n.numero, emitente, n.vNF, admin])).rows[0]!.id;
    const respostas = [
      await conferencia("nao-e-uuid"),
      await conferencia("00000000-0000-4000-8000-000000000000"),
      await conferencia(daEmpresa2.id, { headers: soEmpresa1 }),
      await descartar(daEmpresa2.id, { headers: soEmpresa1 }),
      await gerar(daEmpresa2.id, corpoGerar(c.tops.compra, c.I.provider, [{ n_item: 1, produto_id: c.I.product2, fator: "1", tipo_fator: "multiply" }]), { headers: soEmpresa1 }),
      await conferencia(alheia),
    ];
    for (const r of respostas) expect([r.statusCode, erro(r).message], r.body).toEqual([404, "Importação não encontrada"]);
    expect((await importacaoNoBanco(daEmpresa2.id)).situacao, "a recusa não mudou nada").toBe("pendente");
  });

  it("destinatário ambíguo (duas empresas com o mesmo CNPJ) → 422 com os candidatos; com a empresa escolhida, 201", async () => {
    const nota = notaSintetica({ emitenteCnpj: emitenteNovo() });
    const e = recusa(await importar(nota.xml), 422, "VALIDATION_ERROR");
    expect(e.details).toEqual([expect.objectContaining({ path: "empresa_id", message: "O destinatário corresponde a mais de uma empresa: escolha a empresa da compra." })]);
    const candidatos = (e.details as { candidatos: { id: string }[] }[])[0]!.candidatos.map((x) => x.id).sort();
    expect(candidatos).toEqual([c.I.empresa, c.I.empresa2].sort());
    const ok = await importar(nota.xml, { empresaId: c.I.empresa2 });
    expect(ok.statusCode, ok.body).toBe(201);
    expect((j(ok) as { empresa: { id: string } }).empresa.id).toBe(c.I.empresa2);
    // A leitura recusada: o XML de homologação, com o motivo.
    const homologacao = recusa(await importar(notaSintetica({ emitenteCnpj: emitenteNovo(), tpAmb: "2" }).xml, { empresaId: c.I.empresa }), 422, "VALIDATION_ERROR");
    expect(homologacao.details).toContainEqual(expect.objectContaining({ path: "arquivo", motivo: "ambiente_homologacao" }));
  });

  it("o 'Lançar' da DF-e: importa o XML guardado, gera e a DF-e fica lançada; DF-e sem XML → 422", async () => {
    const emitente = emitenteNovo();
    const fornecedor = await fornecedorComDocumento(emitente);
    const p = await produto();
    const nota = notaSintetica({ emitenteCnpj: emitente });
    const dfe = await registrarDfe({ xml: nota.xml, empresa_id: c.I.empresa });
    expect(dfe.statusCode, `premissa: a DF-e é registrada com o XML — ${dfe.body}`).toBe(201);
    const dfeId = (j(dfe) as { id: string }).id;
    const r = await importarDaDfe(dfeId);
    expect(r.statusCode, r.body).toBe(201);
    const conf = comoConferencia(r);
    expect(conf).toMatchObject({ origem: "dfe", dfeId });
    const g = await gerar(conf.id, corpoGerar(c.tops.compra, fornecedor, [{ n_item: 1, produto_id: p.id, fator: "1", tipo_fator: "multiply", armazem_id: c.I.warehouse }]));
    expect(g.statusCode, g.body).toBe(201);
    expect((await compraNoBanco((j(g) as { id: string }).id)).dfe_id).toBe(dfeId);
    expect((await c.admin.query<{ launch_status: string }>("select launch_status from erp.dfe_documents where id = $1", [dfeId])).rows[0]!.launch_status).toBe("launched");
    expect(recusa(await importarDaDfe(dfeId), 409, "CONFLICT").message).toBe("Esta DF-e já foi lançada.");
    const semXml = await registrarDfe({ access_key: notaSintetica({ emitenteCnpj: emitente }).chave, empresa_id: c.I.empresa, issuer_name: "Sem XML" });
    expect(semXml.statusCode, semXml.body).toBe(201);
    const e = recusa(await importarDaDfe((j(semXml) as { id: string }).id), 422, "VALIDATION_ERROR");
    expect(e.details).toEqual([{ path: "dfe", message: "Esta DF-e foi registrada sem o XML: importe o arquivo na Central de Compras." }]);
  });

  it("a solicitação de compra antiga: sem documento, o recebimento recusa; com a compra gerada da nota ligada, passa", async () => {
    const emitente = emitenteNovo();
    const fornecedor = await fornecedorComDocumento(emitente);
    const p = await produto();
    const sol = await c.h.app.inject({ method: "POST", url: "/api/supply/requests", headers: c.h.headers(), payload: {
      empresa_id: c.I.empresa, request_date: "2026-09-10", request_type: "product", description: "Solicitação F7", justification: "Teste F7",
      items: [{ product_id: p.id, description: "Insumo", quantity: "10", reference_value: "100" }] } });
    expect(sol.statusCode, sol.body).toBe(201);
    const solId = (j(sol) as { id: string }).id;
    await c.admin.query("update erp.purchase_requests set status = 'purchase_done' where id = $1", [solId]);
    const receber = () => c.h.app.inject({ method: "POST", url: `/api/supply/requests/${solId}/actions/mark_received`, headers: c.h.headers(), payload: { justification: "Recebido" } });
    expect(recusa(await receber(), 422, "VALIDATION_ERROR").message, "premissa: sem documento, o recebimento recusa")
      .toBe("Lance o documento fiscal de entrada ou gere a compra pela importação do XML antes de confirmar o recebimento");
    const conf = await importada(notaSintetica({ emitenteCnpj: emitente }).xml, { empresaId: c.I.empresa });
    const g = await gerar(conf.id, corpoGerar(c.tops.compra, fornecedor, [{ n_item: 1, produto_id: p.id, fator: "1", tipo_fator: "multiply", armazem_id: c.I.warehouse }],
      {}, { solicitacao_compra_id: solId }));
    expect(g.statusCode, g.body).toBe(201);
    expect((await compraNoBanco((j(g) as { id: string }).id)).solicitacao_compra_id).toBe(solId);
    const ok = await receber();
    expect(ok.statusCode, ok.body).toBe(200);
    expect((j(ok) as { status: string }).status).toBe("purchase_received");
  });
});
