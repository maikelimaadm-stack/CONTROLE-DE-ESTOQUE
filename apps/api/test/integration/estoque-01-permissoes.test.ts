import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ESPECIES_DOCUMENTO_ESTOQUE, RECURSO_DA_ESPECIE_ESTOQUE, type EspecieEstoque } from "@agro/domain";
import {
  c, iniciar, encerrar, produto, saldoInicial, lancar, lancado, ler, previa, confirmar, cancelar, doc, movimentos, contarDocumentos,
  membro, escopos, seg, j, type Hdr, type Item, type Resposta,
} from "./estoque-01-ajuda.js";

/**
 * ESTOQUE-01 (decisão 274) — PERMISSÕES POR ESPÉCIE E ESCOPO DE EMPRESA. ES-7.
 *
 * Um recurso por espécie (`entradas_estoque`, `saidas_estoque`, `transferencias_estoque`, `ajustes_estoque`), com
 * `.view` (ler, prévia, lista), `.create` (lançar, operações) e `.edit` (confirmar, cancelar). Autorização é
 * CAPACIDADE × ESCOPO, com AND: falta de capacidade → 403; documento fora do escopo de empresa do módulo estoque →
 * a MESMA 404 de inexistente; empresa do corpo fora do escopo → 422 (é pedido, nunca autorização).
 *
 * Toda recusa de escrita é conferida no banco (situação, movimentos, contagem de documentos), e cada membro tem a
 * premissa do que ele PODE fazer — senão um 403 universal passaria por "permissão certa".
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

const item = (especie: EspecieEstoque, produtoId: string): Item =>
  especie === "ajuste" ? { produto_id: produtoId, quantidade_contada: "1" }
    : especie === "entrada" ? { produto_id: produtoId, quantidade: "1", custo_unitario: "1" }
      : { produto_id: produtoId, quantidade: "1" };
const listar = (headers: Hdr, q = "") => c.h.app.inject({ method: "GET", url: `/api/estoque/documentos?pageSize=200${q}`, headers });
const linhas = (r: Resposta) => (j(r).items ?? []) as { id: string; especie: string; empresa_id: string }[];
const operacoes = (especie: EspecieEstoque, headers: Hdr) => c.h.app.inject({ method: "GET", url: `/api/estoque/${seg(especie)}/operation-types`, headers });

describe("ES-7 — capacidade por espécie: .view / .create / .edit; 403 e 404 certas", () => {
  it("ES-7a só saidas_estoque.view: lê a saída, a prévia e a lista só de saídas; não lança, não confirma, não cancela (403); a entrada é 403", async () => {
    const p = await produto(); await saldoInicial(p.id, "10");
    const docs = Object.fromEntries(await Promise.all(ESPECIES_DOCUMENTO_ESTOQUE.map(async (e) => [e, await lancado(e, [item(e, p.id)])] as const))) as Record<EspecieEstoque, string>;
    const so = await membro("So Saidas", ["saidas_estoque.view"]);

    // PODE: ler a saída, a prévia dela e a lista (só saídas).
    expect((await ler("saida", docs.saida, so)).statusCode).toBe(200);
    expect((await previa("saida", docs.saida, so)).statusCode).toBe(200);
    const l = await listar(so);
    expect(l.statusCode, l.body).toBe(200);
    expect(linhas(l).map((x) => x.id), "premissa: a saída aparece").toContain(docs.saida);
    expect(linhas(l).every((x) => x.especie === "saida"), "nenhuma outra espécie vaza").toBe(true);
    // O filtro de espécie só INTERSECTA: pedir entradas não amplia.
    const pede = await listar(so, "&especie=entrada,ajuste");
    expect(pede.statusCode).toBe(200);
    expect(linhas(pede)).toEqual([]);

    // NÃO PODE: lançar, ver as operações (é da porta de lançamento), confirmar e cancelar.
    const antes = await contarDocumentos();
    expect((await lancar("saida", [item("saida", p.id)], {}, so)).statusCode).toBe(403);
    expect((await operacoes("saida", so)).statusCode).toBe(403);
    expect((await confirmar("saida", docs.saida, { headers: so })).statusCode).toBe(403);
    expect((await cancelar("saida", docs.saida, {}, { headers: so })).statusCode).toBe(403);
    expect(await contarDocumentos()).toBe(antes);
    expect([(await doc(docs.saida)).situacao, await movimentos(docs.saida)]).toEqual(["aberto", []]);

    // As outras espécies: sem a capacidade → 403 (não é "invisível", é "não pode").
    for (const e of ["entrada", "transferencia", "ajuste"] as const) {
      expect((await ler(e, docs[e], so)).statusCode, e).toBe(403);
      expect((await lancar(e, [item(e, p.id)], {}, so)).statusCode, e).toBe(403);
    }
    // A entrada pela porta da saída é OUTRA espécie: a mesma 404 de inexistente.
    const viaSaida = await ler("saida", docs.entrada, so);
    const inexistente = await ler("saida", "00000000-0000-4000-8000-000000000000", so);
    expect([viaSaida.statusCode, j(viaSaida).error?.message]).toEqual([404, j(inexistente).error?.message]);
  });

  it("ES-7b .create sem .edit: lança e vê as operações, mas não confirma nem cancela; com .edit, confirma e cancela", async () => {
    const p = await produto();
    const lanca = await membro("Lanca Entradas", ["entradas_estoque.view", "entradas_estoque.create"]);
    const ops = await operacoes("entrada", lanca);
    expect(ops.statusCode, ops.body).toBe(200);
    expect(j(ops)).toMatchObject({ contractVersion: 1, capacidades: { documentoEstoque: 1 }, family: { code: "estoque.entrada" } });
    expect((j(ops).items as { id: string }[]).map((x) => x.id)).toContain(c.tops.entrada);
    expect((j(ops).items as { id: string }[]).map((x) => x.id), "só TOPs da família").not.toContain(c.tops.saida);
    const id = await lancado("entrada", [item("entrada", p.id)], {}, lanca);
    expect((await confirmar("entrada", id, { headers: lanca })).statusCode).toBe(403);
    expect((await cancelar("entrada", id, {}, { headers: lanca })).statusCode).toBe(403);
    expect([(await doc(id)).situacao, await movimentos(id)]).toEqual(["aberto", []]);

    const edita = await membro("Edita Entradas", ["entradas_estoque.view", "entradas_estoque.edit"]);
    expect((await lancar("entrada", [item("entrada", p.id)], {}, edita)).statusCode, "edit não é create").toBe(403);
    const r = await confirmar("entrada", id, { headers: edita });
    expect(r.statusCode, r.body).toBe(200);
    expect((await doc(id)).situacao).toBe("confirmado");
    expect((await cancelar("entrada", id, {}, { headers: edita })).statusCode).toBe(200);
    expect((await doc(id)).situacao).toBe("cancelado");
    // A capacidade é POR ESPÉCIE: .edit de entrada não confirma ajuste.
    const aj = await lancado("ajuste", [item("ajuste", p.id)]);
    expect((await confirmar("ajuste", aj, { headers: edita })).statusCode).toBe(403);
    expect((await doc(aj)).situacao).toBe("aberto");
  });

  it("ES-7c nenhuma capacidade de estoque nova → a lista é 403 (lista vazia nunca é \"todas\"); a permissão antiga de estoque não abre o documento novo", async () => {
    const antiga = await membro("Estoque Antigo", ["stocks.view", "stock_writeoffs.view"]);
    expect((await listar(antiga)).statusCode).toBe(403);
    const p = await produto();
    const id = await lancado("saida", [item("saida", p.id)]);
    expect((await ler("saida", id, antiga)).statusCode).toBe(403);
  });
});

describe("ES-7 — escopo de empresa do módulo estoque (AND com a capacidade)", () => {
  it("ES-7d todas as capacidades, mas o estoque só na 2ª empresa: o documento da 1ª é a MESMA 404 de inexistente; a lista não o mostra; lançar na 1ª → 422", async () => {
    const p = await produto();
    const da1 = await lancado("entrada", [item("entrada", p.id)]);
    const perms = ESPECIES_DOCUMENTO_ESTOQUE.flatMap((e) => ["view", "create", "edit"].map((a) => `${RECURSO_DA_ESPECIE_ESTOQUE[e]}.${a}`));
    const so2 = await membro("Estoque Empresa 2", perms, escopos([c.I.empresa2]));

    const forma = (r: Resposta) => [r.statusCode, j(r).error?.code, j(r).error?.message];
    const inexistente = await ler("entrada", "00000000-0000-4000-8000-000000000000", so2);
    expect(inexistente.statusCode).toBe(404);
    expect(forma(await ler("entrada", da1, so2)), "fora do escopo = inexistente").toEqual(forma(inexistente));
    expect(forma(await previa("entrada", da1, so2))).toEqual(forma(inexistente));
    expect(forma(await confirmar("entrada", da1, { headers: so2 }))).toEqual(forma(inexistente));
    expect(forma(await cancelar("entrada", da1, {}, { headers: so2 }))).toEqual(forma(inexistente));
    expect([(await doc(da1)).situacao, await movimentos(da1)], "nada aconteceu com o documento fora do escopo").toEqual(["aberto", []]);

    // Lançar na empresa fora do escopo: a empresa do corpo é PEDIDO → 422, nada gravado.
    const antes = await contarDocumentos();
    const r = await lancar("entrada", [item("entrada", p.id)], {}, so2);
    expect(r.statusCode, r.body).toBe(422);
    expect(await contarDocumentos()).toBe(antes);
    // PREMISSA: na 2ª empresa, com o armazém dela, lança, lê, confirma — e a lista mostra só o da 2ª.
    const da2 = await lancado("entrada", [item("entrada", p.id)], { empresa_id: c.I.empresa2, armazem_id: c.I.warehouseEmpresa2 }, so2);
    expect((await ler("entrada", da2, so2)).statusCode).toBe(200);
    expect((await confirmar("entrada", da2, { headers: so2 })).statusCode).toBe(200);
    const l = await listar(so2);
    expect(l.statusCode, l.body).toBe(200);
    expect(linhas(l).map((x) => x.id)).toContain(da2);
    expect(linhas(l).map((x) => x.id)).not.toContain(da1);
    expect(linhas(l).every((x) => x.empresa_id === c.I.empresa2), "nenhum documento da 1ª empresa vaza").toBe(true);
    // O filtro de empresa é PEDIDO: pedir a 1ª não amplia.
    expect(linhas(await listar(so2, `&empresa_id=${c.I.empresa}`))).toEqual([]);
    // E o administrador (todas as empresas) vê os dois.
    expect(linhas(await listar(c.h.headers())).map((x) => x.id)).toEqual(expect.arrayContaining([da1, da2]));
  });
});
