import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  c, iniciar, encerrar, produto, saldoInicial, lancado, confirmar, confirmado, itens, movimentos, movimentosDoProduto, saldo, custoMedio,
  recusadoNoCampo, emParaleloComBarreira, lancar,
} from "./estoque-01-ajuda.js";

/**
 * ESTOQUE-01 (decisão 274) — O AJUSTE (INVENTÁRIO). ES-5.
 *
 * O ajuste informa a quantidade CONTADA; a confirmação trava o balde (armazém × produto × lote), lê o saldo SOB a
 * trava e grava a diferença: > 0 `correction_in` pelo custo médio, < 0 `correction_out`, 0 nenhum movimento. O item
 * guarda o saldo lido e a diferença.
 *
 * O CASO QUE ESTE ARQUIVO EXISTE PARA PROVAR (e que a reversa R10 deixa vermelho): DOIS AJUSTES SIMULTÂNEOS do
 * mesmo balde terminam na contagem do ÚLTIMO confirmado — nunca na soma das duas diferenças calculadas sobre o
 * mesmo saldo velho. "Simultâneo" aqui é de verdade, e determinístico: duas confirmações em paralelo (duas
 * transações, duas conexões do pool da API) e uma BARREIRA (conexão própria) que só as solta quando as duas estão
 * esperando trava no banco — ver `emParaleloComBarreira`.
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

describe("ES-5 — ajuste: diferença sob trava; zero → sem movimento; lote obrigatório", () => {
  it("ES-5a para BAIXO → correction_out; para CIMA → correction_in pelo custo médio; IGUAL → nenhum movimento — o item guarda saldo e diferença", async () => {
    const p = await produto();
    await saldoInicial(p.id, "10", { custo: "4" });

    const baixo = await lancado("ajuste", [{ produto_id: p.id, quantidade_contada: "7" }]);
    expect(await movimentos(baixo), "premissa: lançar não move").toEqual([]);
    expect((await confirmado("ajuste", baixo)).movimentos).toBe(1);
    expect((await movimentos(baixo)).map((m) => [m.movement_type, m.direction, m.quantity, m.unit_cost])).toEqual([["correction_out", -1, "3.0000", "4.000000"]]);
    expect((await itens(baixo)).map((x) => [x.saldo_na_confirmacao, x.diferenca, x.custo_unitario])).toEqual([["10.0000", "-3.0000", "4.000000"]]);
    expect(await saldo(c.I.warehouse, p.id)).toBe("7.0000");

    const cima = await lancado("ajuste", [{ produto_id: p.id, quantidade_contada: "12.5" }]);
    expect((await confirmado("ajuste", cima)).movimentos).toBe(1);
    expect((await movimentos(cima)).map((m) => [m.movement_type, m.direction, m.quantity, m.unit_cost])).toEqual([["correction_in", 1, "5.5000", "4.000000"]]);
    expect((await itens(cima)).map((x) => [x.saldo_na_confirmacao, x.diferenca, x.custo_unitario])).toEqual([["7.0000", "5.5000", "4.000000"]]);
    expect(await saldo(c.I.warehouse, p.id)).toBe("12.5000");
    expect(await custoMedio(c.I.warehouse, p.id), "a correção para cima entra pelo médio: o médio não muda").toBe("4.000000");

    const antes = await movimentosDoProduto(p.id);
    const igual = await lancado("ajuste", [{ produto_id: p.id, quantidade_contada: "12.5000" }]);
    expect(await confirmado("ajuste", igual)).toMatchObject({ situacao: "confirmado", movimentos: 0 });
    expect(await movimentos(igual)).toEqual([]);
    expect(await movimentosDoProduto(p.id), "contagem igual ao saldo: nenhum movimento").toBe(antes);
    expect((await itens(igual)).map((x) => [x.saldo_na_confirmacao, x.diferenca, x.custo_unitario])).toEqual([["12.5000", "0.0000", null]]);

    // Contagem ZERO zera o balde.
    const zera = await lancado("ajuste", [{ produto_id: p.id, quantidade_contada: "0" }]);
    await confirmado("ajuste", zera);
    expect(await saldo(c.I.warehouse, p.id)).toBe("0.0000");
    expect((await itens(zera))[0]!.diferenca).toBe("-12.5000");
  });

  it("ES-5b produto COM lote: lote obrigatório no lançamento; o ajuste mexe SÓ no balde do lote; lote novo nasce pelo médio do produto no armazém", async () => {
    const p = await produto({ lote: "lote" });
    await saldoInicial(p.id, "6", { lote: "A-1", custo: "5" });
    await saldoInicial(p.id, "4", { lote: "A-2", custo: "5" });
    recusadoNoCampo(await lancar("ajuste", [{ produto_id: p.id, quantidade_contada: "3" }]), "itens.0.lote");

    const id = await lancado("ajuste", [{ produto_id: p.id, quantidade_contada: "2", lote: "A-1" }, { produto_id: p.id, quantidade_contada: "3", lote: "NOVO" }]);
    expect((await confirmado("ajuste", id)).movimentos).toBe(2);
    expect((await movimentos(id)).map((m) => [m.movement_type, m.provider_lot, m.quantity, m.unit_cost])).toEqual([
      ["correction_out", "A-1", "4.0000", "5.000000"],
      ["correction_in", "NOVO", "3.0000", "5.000000"],
    ]);
    expect([await saldo(c.I.warehouse, p.id, "A-1"), await saldo(c.I.warehouse, p.id, "A-2"), await saldo(c.I.warehouse, p.id, "NOVO")]).toEqual(["2.0000", "4.0000", "3.0000"]);
    expect((await itens(id)).map((x) => [x.lote, x.saldo_na_confirmacao, x.diferenca])).toEqual([["A-1", "6.0000", "-4.0000"], ["NOVO", "0.0000", "3.0000"]]);
  });

  it("ES-5c lote e validade: contagem a MAIS de lote novo sem validade → 422 no item, nada gravado; com validade, confirma", async () => {
    const p = await produto({ lote: "lote_validade" });
    const sem = await lancado("ajuste", [{ produto_id: p.id, quantidade_contada: "2", lote: "V-NOVO" }]);
    recusadoNoCampo(await confirmar("ajuste", sem), "itens.0.validade");
    expect(await movimentos(sem)).toEqual([]);
    const com = await lancado("ajuste", [{ produto_id: p.id, quantidade_contada: "2", lote: "V-NOVO", validade: "2027-03-31" }]);
    await confirmado("ajuste", com);
    expect((await movimentos(com)).map((m) => [m.movement_type, m.provider_lot, m.expiration_date])).toEqual([["correction_in", "V-NOVO", "2027-03-31"]]);
  });
});

describe("ES-5 — DOIS AJUSTES SIMULTÂNEOS no mesmo saldo → o resultado é a contagem do ÚLTIMO (a reversa R10 deixa este vermelho)", () => {
  type ItemLido = Awaited<ReturnType<typeof itens>>[number];
  /**
   * O que prova que terminaram certos, sem depender de quem ganhou a corrida:
   *   · os dois confirmaram;
   *   · o PRIMEIRO leu o saldo de partida; o ÚLTIMO leu a contagem do primeiro (esperou a trava e releu);
   *   · o saldo final é a contagem do último, e o ledger fecha: partida + Σ diferenças = final.
   * Sem a trava, os dois leem o saldo de partida e o final é partida + as duas diferenças — nenhuma das contagens.
   */
  async function conferir(partida: string, a: string, b: string, contadaA: string, contadaB: string, armazemId: string, produtoId: string, lote: string) {
    const [ia, ib] = [(await itens(a))[0]!, (await itens(b))[0]!] as [ItemLido, ItemLido];
    const final = await saldo(armazemId, produtoId, lote);
    const ultimo = ia.saldo_na_confirmacao === contadaB ? "a" : ib.saldo_na_confirmacao === contadaA ? "b" : null;
    const resumo = JSON.stringify({ partida, a: [ia.saldo_na_confirmacao, ia.diferenca], b: [ib.saldo_na_confirmacao, ib.diferenca], final });
    expect(ultimo, `o último a confirmar leu a contagem do primeiro: ${resumo}`).not.toBeNull();
    const [primeiro, segundo] = ultimo === "a" ? [ib, ia] : [ia, ib];
    expect(primeiro.saldo_na_confirmacao, `o primeiro leu o saldo de partida: ${resumo}`).toBe(partida);
    expect(final, `o saldo final é a contagem do último: ${resumo}`).toBe(segundo.quantidade_contada);
    return { ultimo };
  }

  it("ES-5d balde EXISTENTE (sem lote): partida 10, contagens 7 e 4 em paralelo → termina em 7 ou 4, a do último — nunca 1", async () => {
    const p = await produto();
    await saldoInicial(p.id, "10", { custo: "3" });
    const a = await lancado("ajuste", [{ produto_id: p.id, quantidade_contada: "7" }]);
    const b = await lancado("ajuste", [{ produto_id: p.id, quantidade_contada: "4" }]);
    // A barreira trava a LINHA DO SALDO: as duas confirmações a pedem só ao gravar o movimento (gatilho da 0003),
    // depois de ler o saldo. Sem a trava do ajuste, as duas chegam lá com a mesma leitura velha.
    const { respostas, esperando } = await emParaleloComBarreira(
      "select 1 from erp.stock_balances where warehouse_id=$1 and product_id=$2 and provider_lot='' for update", [c.I.warehouse, p.id],
      () => confirmar("ajuste", a), () => confirmar("ajuste", b));
    expect(esperando, "premissa: as duas confirmações estavam em paralelo, esperando trava no banco").toBe(2);
    expect(respostas.map((r) => r.statusCode), respostas.map((r) => r.body).join(" | ")).toEqual([200, 200]);
    await conferir("10.0000", a, b, "7.0000", "4.0000", c.I.warehouse, p.id, "");
    const ledger = (await c.admin.query<{ q: string }>("select sum(quantity*direction)::numeric(18,4)::text q from erp.stock_movements where product_id=$1", [p.id])).rows[0]!.q;
    expect(ledger, "o ledger fecha com o saldo").toBe(await saldo(c.I.warehouse, p.id, ""));
  });

  it("ES-5e balde que AINDA NÃO EXISTE (lote novo): contagens 5 e 8 em paralelo → termina em 5 ou 8 — nunca 13", async () => {
    const p = await produto({ lote: "lote" });
    const lote = "INV-NOVO";
    const a = await lancado("ajuste", [{ produto_id: p.id, quantidade_contada: "5", lote }]);
    const b = await lancado("ajuste", [{ produto_id: p.id, quantidade_contada: "8", lote }]);
    // Não há linha de saldo para travar: a barreira trava a linha do PRODUTO, que o gatilho do movimento atualiza
    // (custo médio) depois de gravar o saldo — de novo, depois de as duas lerem.
    const { respostas, esperando } = await emParaleloComBarreira(
      "select 1 from erp.products where id=$1 for update", [p.id],
      () => confirmar("ajuste", a), () => confirmar("ajuste", b));
    expect(esperando, "premissa: as duas confirmações estavam em paralelo, esperando trava no banco").toBe(2);
    expect(respostas.map((r) => r.statusCode), respostas.map((r) => r.body).join(" | ")).toEqual([200, 200]);
    await conferir("0.0000", a, b, "5.0000", "8.0000", c.I.warehouse, p.id, lote);
  });

  it("ES-5f sem barreira, cinco rodadas de dois ajustes disparados juntos: sempre a contagem do último", async () => {
    const p = await produto();
    await saldoInicial(p.id, "20");
    for (let rodada = 0; rodada < 5; rodada++) {
      const partida = await saldo(c.I.warehouse, p.id, "");
      // Contagens novas a cada rodada: nenhuma pode coincidir com a partida (a contagem do último da rodada anterior),
      // senão "quem leu a contagem do outro" ficaria ambíguo.
      const [qa, qb] = [30 + 2 * rodada, 31 + 2 * rodada];
      const a = await lancado("ajuste", [{ produto_id: p.id, quantidade_contada: String(qa) }]);
      const b = await lancado("ajuste", [{ produto_id: p.id, quantidade_contada: String(qb) }]);
      const rs = await Promise.all([confirmar("ajuste", a), confirmar("ajuste", b)]);
      expect(rs.map((r) => r.statusCode), rs.map((r) => r.body).join(" | ")).toEqual([200, 200]);
      await conferir(partida, a, b, `${qa}.0000`, `${qb}.0000`, c.I.warehouse, p.id, "");
    }
  });
});
