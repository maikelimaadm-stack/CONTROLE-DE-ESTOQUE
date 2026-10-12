import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { c, iniciar, encerrar } from "./top-config-08-ajuda.js";
import {
  prepararXml01, notaImportada, conferenciaLida, preenchimentoDo, itemNota, criarProdutos, corpoLote, criados, produtosNoBanco, localNovo, localNoBanco,
  outraOrganizacao, type ItemDoCorpo, type Criados, type ProdutoNoBanco,
} from "./xml-01-ajuda.js";

/**
 * XML-01 (decisão 312, D2) — 4.2 O LOCAL DE ESTOQUE PADRÃO do produto que nasce da nota.
 *
 * O local é DECISÃO que vem no corpo, por item (`armazem_id`, o mesmo do "Gerar compra"). O servidor confere: da
 * EMPRESA DA IMPORTAÇÃO, ativo, vivo, da organização, sob a RLS. Fora disso (outra empresa, inativo, excluído,
 * inexistente, outro tenant) ou sem local ⇒ `default_warehouse_id` NÃO vem no produto (nulo no banco) e a resposta diz
 * `localPadrao: null` para o item — fail-closed, nunca silencioso para a tela.
 *
 *   XML-I12 local da empresa da importação, ativo ⇒ gravado; `localPadrao` = o gravado;
 *   XML-I13 local de OUTRA empresa ⇒ nulo (os dois ids de empresa no teste); e o espelho: importação da empresa 2 com o
 *           local da empresa 2 ⇒ gravado, com o da empresa 1 ⇒ nulo;
 *   XML-I14 local inativo ⇒ nulo;
 *   XML-I15 local excluído ⇒ nulo;
 *   XML-I16 sem local (chave ausente e `null`) ⇒ nulo;
 *   XML-I17 local inexistente e local de OUTRA organização ⇒ nulo;
 *   XML-I18 num lote só, cada item com o seu local: `localPadrao` de cada item da resposta = o `default_warehouse_id`
 *           gravado no produto dele.
 *
 * Cada recusa do local vem com a PREMISSA no MESMO lote: o item 1 leva um local válido e é gravado — senão "nulo"
 * poderia ser só um campo que a rota nunca grava.
 */

beforeAll(async () => { await iniciar(); await prepararXml01(); }, 240_000);
afterAll(encerrar);

/**
 * Um lote de N itens (códigos distintos, unidade CX — a do sistema), um por local pedido (`undefined` = sem a chave
 * `armazem_id`), na empresa dada. Devolve a resposta e os produtos do banco, na ordem dos itens.
 */
async function loteComLocais(locais: (string | null | undefined)[], empresaId: string = c.I.empresa): Promise<{ b: Criados; produtos: ProdutoNoBanco[]; empresaDaImportacao: string }> {
  const n = await notaImportada(locais.map((_, k) => itemNota(`L-${k + 1}`, "CX")), { empresaId });
  const conf = await conferenciaLida(n.id);
  expect(conf.empresa.id, "premissa: a importação é da empresa pedida").toBe(empresaId);
  for (const k of locais.keys()) expect(preenchimentoDo(conf, k + 1).measurement_id, "premissa: a unidade resolvida").toEqual(expect.any(String));
  const itens: ItemDoCorpo[] = locais.map((l, k) => (l === undefined ? { n_item: k + 1 } : { n_item: k + 1, armazem_id: l }));
  const b = await criados(criarProdutos(n.id, corpoLote(itens)));
  expect(b.itens.map((i) => i.nItem), "um item por item confirmado, na ordem da nota").toEqual(locais.map((_, k) => k + 1));
  expect(b.produtos, "um produto por item (códigos distintos)").toHaveLength(locais.length);
  const produtos = await produtosNoBanco(b.itens.map((i) => i.produto.id));
  // localPadrao da resposta = o gravado, item a item (o caso pode exigir mais).
  expect(b.itens.map((i) => i.localPadrao), "localPadrao = o default_warehouse_id gravado").toEqual(produtos.map((p) => p.default_warehouse_id));
  return { b, produtos, empresaDaImportacao: conf.empresa.id };
}

describe("4.2 o local de estoque padrão (D2)", () => {
  it("XML-I12 local da empresa da importação, ativo e vivo ⇒ default_warehouse_id gravado e localPadrao igual", async () => {
    const l = await localNoBanco(c.I.warehouse);
    expect(l, "premissa: o ALM é da empresa 1, ativo e vivo").toMatchObject({ organization_id: c.h.demo.orgId, empresa_id: c.I.empresa, is_active: true, excluido: false });
    const { b, produtos } = await loteComLocais([c.I.warehouse]);
    expect(produtos[0]!.default_warehouse_id).toBe(c.I.warehouse);
    expect(b.itens[0]!.localPadrao).toBe(c.I.warehouse);
  });

  it("XML-I13 local de OUTRA empresa ⇒ nulo (e o espelho na empresa 2)", async () => {
    const daEmpresa2 = await localNoBanco(c.I.warehouseEmpresa2);
    expect(daEmpresa2!.empresa_id, "premissa: o local é da empresa 2").toBe(c.I.empresa2);
    expect(daEmpresa2).toMatchObject({ organization_id: c.h.demo.orgId, is_active: true, excluido: false });
    const na1 = await loteComLocais([c.I.warehouse, c.I.warehouseEmpresa2]);
    expect([na1.empresaDaImportacao, daEmpresa2!.empresa_id], "os dois ids: a empresa da importação e a do local").toEqual([c.I.empresa, c.I.empresa2]);
    expect(na1.produtos.map((p) => p.default_warehouse_id), "premissa: o local da empresa 1 é gravado; o da 2, não").toEqual([c.I.warehouse, null]);
    expect(na1.b.itens.map((i) => i.localPadrao)).toEqual([c.I.warehouse, null]);
    // O espelho: a importação da empresa 2 grava o local da empresa 2 e recusa o da 1 — é a empresa DA IMPORTAÇÃO.
    const na2 = await loteComLocais([c.I.warehouseEmpresa2, c.I.warehouse], c.I.empresa2);
    expect(na2.empresaDaImportacao).toBe(c.I.empresa2);
    expect(na2.produtos.map((p) => p.default_warehouse_id)).toEqual([c.I.warehouseEmpresa2, null]);
    expect(na2.b.itens.map((i) => i.localPadrao)).toEqual([c.I.warehouseEmpresa2, null]);
  });

  it("XML-I14 local INATIVO da empresa da importação ⇒ nulo", async () => {
    const inativo = await localNovo(c.I.empresa, { ativo: false });
    expect(await localNoBanco(inativo)).toMatchObject({ empresa_id: c.I.empresa, is_active: false, excluido: false });
    const { produtos } = await loteComLocais([c.I.warehouse, inativo]);
    expect(produtos.map((p) => p.default_warehouse_id)).toEqual([c.I.warehouse, null]);
  });

  it("XML-I15 local EXCLUÍDO da empresa da importação ⇒ nulo", async () => {
    const excluido = await localNovo(c.I.empresa, { excluido: true });
    expect(await localNoBanco(excluido)).toMatchObject({ empresa_id: c.I.empresa, is_active: true, excluido: true });
    const { produtos } = await loteComLocais([c.I.warehouse, excluido]);
    expect(produtos.map((p) => p.default_warehouse_id)).toEqual([c.I.warehouse, null]);
  });

  it("XML-I16 sem local (sem a chave, e com null) ⇒ nulo", async () => {
    const { b, produtos } = await loteComLocais([c.I.warehouse, undefined, null]);
    expect(produtos.map((p) => p.default_warehouse_id)).toEqual([c.I.warehouse, null, null]);
    expect(b.itens.map((i) => i.localPadrao)).toEqual([c.I.warehouse, null, null]);
  });

  it("XML-I17 local INEXISTENTE e local de OUTRA ORGANIZAÇÃO ⇒ nulo", async () => {
    const inexistente = randomUUID();
    expect(await localNoBanco(inexistente), "premissa: o id não existe").toBeNull();
    const outra = await outraOrganizacao();
    const alheio = await localNovo(outra.empresaId, { orgId: outra.orgId });
    expect(await localNoBanco(alheio), "premissa: o local é de outra organização, ativo e vivo").toMatchObject({ organization_id: outra.orgId, is_active: true, excluido: false });
    const { produtos } = await loteComLocais([c.I.warehouse, inexistente, alheio]);
    expect(produtos.map((p) => p.default_warehouse_id)).toEqual([c.I.warehouse, null, null]);
  });

  it("XML-I18 num lote só, cada item com o seu local: localPadrao de cada item = o default_warehouse_id do produto dele", async () => {
    const silo = c.I.warehouse2;
    expect(await localNoBanco(silo), "premissa: o SILO é da empresa 1, ativo").toMatchObject({ empresa_id: c.I.empresa, is_active: true, excluido: false });
    const inativo = await localNovo(c.I.empresa, { ativo: false });
    const { b, produtos } = await loteComLocais([c.I.warehouse, silo, c.I.warehouseEmpresa2, inativo, undefined, c.I.warehouse]);
    expect(produtos.map((p) => p.default_warehouse_id)).toEqual([c.I.warehouse, silo, null, null, null, c.I.warehouse]);
    expect(b.itens.map((i) => [i.nItem, i.localPadrao])).toEqual([[1, c.I.warehouse], [2, silo], [3, null], [4, null], [5, null], [6, c.I.warehouse]]);
  });
});
