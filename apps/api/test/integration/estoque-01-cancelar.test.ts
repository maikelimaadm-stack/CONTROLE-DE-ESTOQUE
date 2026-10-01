import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  c, iniciar, encerrar, produto, armazem, saldoInicial, lancado, confirmar, confirmado, cancelar, doc, movimentos, movimentosDoProduto,
  saldo, recusadoNoCampo, j, unico,
} from "./estoque-01-ajuda.js";

/**
 * ESTOQUE-01 (decisão 274) — CANCELAR, e a IDEMPOTÊNCIA de confirmar e cancelar. ES-6.
 *
 * Aberto → cancelado SEM efeito. Confirmado → `reverseStock` de TODOS os movimentos do documento (um `reversal` por
 * movimento), depois de conferir que o que o documento deu de ENTRADA ainda está no saldo: consumido → 422 no item,
 * NADA gravado. Cancelado é final: de novo → 409. O efeito é lido no banco: estornos por origem, saldo, situação,
 * quem cancelou e o motivo.
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

const estornos = async (id: string) => (await movimentos(id)).filter((m) => m.movement_type === "reversal");

describe("ES-6 — cancelar aberto (sem efeito) e confirmado (estorno completo)", () => {
  it("ES-6a ABERTO → cancelado sem nenhum movimento; sem motivo grava o motivo padrão; com motivo, o motivo aparado", async () => {
    const p = await produto();
    await saldoInicial(p.id, "5");
    const antes = await movimentosDoProduto(p.id);
    const a = await lancado("saida", [{ produto_id: p.id, quantidade: "1" }]);
    const r = await cancelar("saida", a);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ id: a, situacao: "cancelado", estornos: 0 });
    const d = await doc(a);
    expect([d.situacao, d.cancelado_por, d.motivo_cancelamento]).toEqual(["cancelado", c.h.demo.adminUserId, "Cancelado sem motivo informado"]);
    expect(await movimentosDoProduto(p.id), "cancelar aberto não move nada").toBe(antes);
    expect(await saldo(c.I.warehouse, p.id)).toBe("5.0000");

    const b = await lancado("ajuste", [{ produto_id: p.id, quantidade_contada: "0" }]);
    expect((await cancelar("ajuste", b, { motivo: "   contagem refeita  " })).statusCode).toBe(200);
    expect((await doc(b)).motivo_cancelamento).toBe("contagem refeita");
    // corpo estrito: chave desconhecida e motivo longo demais → 422, nada muda
    const c1 = await lancado("entrada", [{ produto_id: p.id, quantidade: "1", custo_unitario: "1" }]);
    expect((await cancelar("entrada", c1, { motivo: "x", forcar: true })).statusCode).toBe(422);
    expect((await cancelar("entrada", c1, { motivo: "x".repeat(501) })).statusCode).toBe(422);
    expect((await doc(c1)).situacao).toBe("aberto");
  });

  it("ES-6b CONFIRMADO → um estorno por movimento, o saldo volta ao de antes — nas quatro espécies", async () => {
    const p = await produto();
    await saldoInicial(p.id, "10", { custo: "2" });
    const destino = await armazem();
    const partida = [await saldo(c.I.warehouse, p.id), await saldo(destino, p.id)];

    const ent = await lancado("entrada", [{ produto_id: p.id, quantidade: "3", custo_unitario: "2" }]);
    const sai = await lancado("saida", [{ produto_id: p.id, quantidade: "2" }]);
    const tra = await lancado("transferencia", [{ produto_id: p.id, quantidade: "4" }], { armazem_destino_id: destino });
    const aju = await lancado("ajuste", [{ produto_id: p.id, quantidade_contada: "5" }]);
    for (const [e, id] of [["entrada", ent], ["saida", sai], ["transferencia", tra], ["ajuste", aju]] as const) await confirmado(e, id);
    // 10 + 3 − 2 − 4 = 7 na origem; ajuste conta 5 → −2
    expect([await saldo(c.I.warehouse, p.id), await saldo(destino, p.id)], "premissa: os quatro confirmados").toEqual(["5.0000", "4.0000"]);

    // Cancela na ordem inversa: cada estorno devolve o que o documento fez, movimento por movimento.
    for (const [e, id, n] of [["ajuste", aju, 1], ["transferencia", tra, 2], ["saida", sai, 1], ["entrada", ent, 1]] as const) {
      const originais = (await movimentos(id)).filter((m) => m.movement_type !== "reversal");
      expect(originais.length, `premissa: ${e} tem ${n} movimento(s)`).toBe(n);
      const r = await cancelar(e, id, { motivo: `cancelar ${e}` });
      expect(r.statusCode, `${e}: ${r.body}`).toBe(200);
      expect(j(r)).toEqual({ id, situacao: "cancelado", estornos: n });
      const rev = await estornos(id);
      expect(rev.length, `${e}: um estorno por movimento`).toBe(n);
      // cada estorno é o inverso de um original: mesmo armazém, mesma quantidade, direção oposta
      const chave = (m: { warehouse_id: string; quantity: string; direction: number }) => `${m.warehouse_id}|${m.quantity}|${m.direction}`;
      expect(rev.map(chave).sort()).toEqual(originais.map((m) => chave({ ...m, direction: -m.direction })).sort());
      expect((await doc(id)).situacao).toBe("cancelado");
    }
    expect([await saldo(c.I.warehouse, p.id), await saldo(destino, p.id)], "tudo estornado: o saldo de partida").toEqual(partida);
  });

  it("ES-6c cancelar de novo → 409 ALREADY_CANCELLED, sem estorno a mais", async () => {
    const p = await produto();
    const id = await lancado("entrada", [{ produto_id: p.id, quantidade: "2", custo_unitario: "1" }]);
    await confirmado("entrada", id);
    expect((await cancelar("entrada", id)).statusCode).toBe(200);
    const de_novo = await cancelar("entrada", id);
    expect([de_novo.statusCode, j(de_novo).error?.code]).toEqual([409, "ALREADY_CANCELLED"]);
    expect((await estornos(id)).length).toBe(1);
    expect(await saldo(c.I.warehouse, p.id)).toBe("0.0000");
  });
});

describe("ES-6 — entrada já CONSUMIDA → 422 com a mensagem do item, NADA gravado", () => {
  it("ES-6d entrada consumida por uma saída → 422 em itens.<i>.quantidade dizendo produto e armazém; desfeito o consumo, cancela", async () => {
    const outro = await produto(); const p = await produto();
    const ent = await lancado("entrada", [
      { produto_id: outro.id, quantidade: "1", custo_unitario: "1" },
      { produto_id: p.id, quantidade: "3", custo_unitario: "4" },
    ]);
    await confirmado("entrada", ent);
    const sai = await lancado("saida", [{ produto_id: p.id, quantidade: "2" }]);
    await confirmado("saida", sai);
    expect(await saldo(c.I.warehouse, p.id), "premissa: 2 das 3 consumidas").toBe("1.0000");
    const antes = await movimentosDoProduto(p.id);
    const r = await cancelar("entrada", ent);
    recusadoNoCampo(r, "itens.1.quantidade");
    const nomeArmazem = (await c.admin.query<{ d: string }>("select description d from erp.warehouses where id=$1", [c.I.warehouse])).rows[0]!.d;
    expect(j(r).error!.message).toMatch(/consumido/);
    expect(j(r).error!.message).toContain(p.nome);
    expect(j(r).error!.message).toContain(nomeArmazem);
    expect(await movimentosDoProduto(p.id), "nada gravado").toBe(antes);
    expect([(await doc(ent)).situacao, (await estornos(ent)).length, await saldo(c.I.warehouse, outro.id)]).toEqual(["confirmado", 0, "1.0000"]);
    // PREMISSA: cancelada a saída, a entrada volta a estar inteira e cancela.
    expect((await cancelar("saida", sai)).statusCode).toBe(200);
    expect((await cancelar("entrada", ent)).statusCode).toBe(200);
    expect([await saldo(c.I.warehouse, p.id), await saldo(c.I.warehouse, outro.id)]).toEqual(["0.0000", "0.0000"]);
  });

  it("ES-6e o DESTINO da transferência consumido, e o ajuste para cima consumido → 422; nada gravado", async () => {
    const p = await produto();
    await saldoInicial(p.id, "5");
    const destino = await armazem();
    const tra = await lancado("transferencia", [{ produto_id: p.id, quantidade: "3" }], { armazem_destino_id: destino });
    await confirmado("transferencia", tra);
    const consome = await lancado("saida", [{ produto_id: p.id, quantidade: "2" }], { armazem_id: destino });
    await confirmado("saida", consome);
    recusadoNoCampo(await cancelar("transferencia", tra), "itens.0.quantidade");
    expect([(await doc(tra)).situacao, (await estornos(tra)).length, await saldo(c.I.warehouse, p.id), await saldo(destino, p.id)]).toEqual(["confirmado", 0, "2.0000", "1.0000"]);

    const q = await produto();
    const aju = await lancado("ajuste", [{ produto_id: q.id, quantidade_contada: "4" }]);
    await confirmado("ajuste", aju);
    await confirmado("saida", await lancado("saida", [{ produto_id: q.id, quantidade: "1" }]));
    recusadoNoCampo(await cancelar("ajuste", aju), "itens.0.quantidade");
    expect([(await doc(aju)).situacao, (await estornos(aju)).length, await saldo(c.I.warehouse, q.id)]).toEqual(["confirmado", 0, "3.0000"]);
    // PREMISSA: o ajuste para BAIXO não deu entrada a nada, e cancela mesmo com o saldo mexido depois.
    const baixo = await lancado("ajuste", [{ produto_id: q.id, quantidade_contada: "1" }]);
    await confirmado("ajuste", baixo);
    expect((await cancelar("ajuste", baixo)).statusCode).toBe(200);
    expect(await saldo(c.I.warehouse, q.id)).toBe("3.0000");
  });
});

describe("ES-6 — idempotência e concorrência de confirmar e cancelar", () => {
  it("ES-6f a MESMA Idempotency-Key na confirmação: a mesma resposta e um só conjunto de efeitos", async () => {
    const p = await produto();
    const id = await lancado("entrada", [{ produto_id: p.id, quantidade: "2", custo_unitario: "1" }]);
    const chave = `es6f-${unico()}`;
    const a = await confirmar("entrada", id, { chave }); const b = await confirmar("entrada", id, { chave });
    expect([a.statusCode, b.statusCode], `${a.body} | ${b.body}`).toEqual([200, 200]);
    expect(j(b)).toEqual(j(a));
    expect((await movimentos(id)).length).toBe(1);
    expect(await saldo(c.I.warehouse, p.id)).toBe("2.0000");
    // outra chave depois de confirmado: 409, sem efeito
    expect((await confirmar("entrada", id, { chave: `es6f-${unico()}` })).statusCode).toBe(409);
    expect((await movimentos(id)).length).toBe(1);
  });

  it("ES-6g a MESMA Idempotency-Key no cancelamento: a mesma resposta e um só estorno", async () => {
    const p = await produto();
    const id = await lancado("entrada", [{ produto_id: p.id, quantidade: "2", custo_unitario: "1" }]);
    await confirmado("entrada", id);
    const chave = `es6g-${unico()}`;
    const a = await cancelar("entrada", id, { motivo: "duplo clique" }, { chave });
    const b = await cancelar("entrada", id, { motivo: "duplo clique" }, { chave });
    expect([a.statusCode, b.statusCode], `${a.body} | ${b.body}`).toEqual([200, 200]);
    expect(j(b)).toEqual(j(a));
    expect((await estornos(id)).length).toBe(1);
    expect(await saldo(c.I.warehouse, p.id)).toBe("0.0000");
  });

  it("ES-6h duas confirmações SIMULTÂNEAS do mesmo documento (sem chave e com chaves diferentes): uma 200, uma 409, um conjunto de efeitos", async () => {
    for (const chaves of [[undefined, undefined], [`es6h-${unico()}`, `es6h-${unico()}`]] as const) {
      const p = await produto();
      await saldoInicial(p.id, "10");
      const id = await lancado("saida", [{ produto_id: p.id, quantidade: "4" }]);
      const rs = await Promise.all([confirmar("saida", id, { chave: chaves[0] }), confirmar("saida", id, { chave: chaves[1] })]);
      expect(rs.map((r) => r.statusCode).sort(), rs.map((r) => r.body).join(" | ")).toEqual([200, 409]);
      expect([(await movimentos(id)).length, await saldo(c.I.warehouse, p.id)]).toEqual([1, "6.0000"]);
    }
  });

  it("ES-6i cancelar e confirmar AO MESMO TEMPO o mesmo documento aberto: termina coerente (confirmado com movimento, ou cancelado sem)", async () => {
    const p = await produto();
    await saldoInicial(p.id, "10");
    const id = await lancado("saida", [{ produto_id: p.id, quantidade: "3" }]);
    const [rc, rx] = await Promise.all([confirmar("saida", id), cancelar("saida", id)]);
    expect([rc.statusCode, rx.statusCode], `${rc.body} | ${rx.body}`).toContain(200);
    const d = await doc(id);
    const ms = await movimentos(id);
    if (d.situacao === "cancelado") {
      // cancelado: ou nunca confirmou (zero movimento), ou confirmou antes e o cancelamento estornou tudo
      const liquido = ms.reduce((a, m) => a + Number(m.quantity) * m.direction, 0);
      expect(liquido, JSON.stringify(ms)).toBe(0);
      expect(await saldo(c.I.warehouse, p.id)).toBe("10.0000");
    } else {
      expect([d.situacao, ms.length, await saldo(c.I.warehouse, p.id)]).toEqual(["confirmado", 1, "7.0000"]);
    }
  });
});
