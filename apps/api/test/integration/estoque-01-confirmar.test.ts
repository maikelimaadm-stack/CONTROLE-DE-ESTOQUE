import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { configuracaoNeutraTopV3 } from "@agro/domain";
import {
  c, iniciar, encerrar, top, produto, armazem, saldoInicial, lancado, confirmar, confirmado, ler, doc, itens, movimentos, movimentosDoProduto,
  saldo, custoMedio, recusadoNoCampo, j, DATA,
} from "./estoque-01-ajuda.js";

/**
 * ESTOQUE-01 (decisão 274) — CONFIRMAR ENTRADA, SAÍDA E TRANSFERÊNCIA. ES-2, ES-3, ES-4, ES-8 e a parte de
 * confirmação da ES-9. (O ajuste é `estoque-01-ajuste.test.ts`.)
 *
 * O saldo muda na CONFIRMAÇÃO, com os tipos de movimento que o ledger já conhece: entrada → `entry`; saída →
 * `writeoff`; transferência → `transfer_out` + `transfer_in`. Cada efeito é lido NO BANCO (ledger, saldo e custo
 * médio do balde) por conexão própria. Toda recusa vem com "nada gravado" provado (movimentos do produto, situação
 * do documento, itens intocados) e com a premissa corrigida ao lado.
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

// ---------------------------------------------------------------------------------------------------------
// ES-2 — entrada
// ---------------------------------------------------------------------------------------------------------
describe("ES-2 — confirmar ENTRADA → 'entry' com custo, lote e validade; saldo e custo médio", () => {
  it("ES-2a produto sem lote: entry pelo custo INFORMADO, na data do documento; o custo médio pondera com o saldo anterior", async () => {
    const p = await produto();
    await saldoInicial(p.id, "10", { custo: "10" });
    const id = await lancado("entrada", [{ produto_id: p.id, quantidade: "10", custo_unitario: "12.5" }], { data_documento: "2026-09-12" });
    expect(await movimentos(id), "premissa: lançado, nada se moveu").toEqual([]);
    const r = await confirmado("entrada", id);
    expect(r).toEqual({ id, situacao: "confirmado", movimentos: 1 });
    const d = await doc(id);
    expect([d.situacao, d.confirmado_por]).toEqual(["confirmado", c.h.demo.adminUserId]);
    expect((await movimentos(id)).map((m) => [m.movement_type, m.direction, m.quantity, m.unit_cost, m.warehouse_id, m.movement_date, m.note]))
      .toEqual([["entry", 1, "10.0000", "12.500000", c.I.warehouse, "2026-09-12", `Documento de estoque ${d.codigo}`]]);
    expect(await saldo(c.I.warehouse, p.id)).toBe("20.0000");
    // (10 × 10 + 10 × 12,50) ÷ 20 = 11,25
    expect(await custoMedio(c.I.warehouse, p.id)).toBe("11.250000");
    // A leitura do documento mostra o movimento.
    const lida = j(await ler("entrada", id)) as { situacao: string; movimentos: { movement_type: string; quantity: string }[] };
    expect([lida.situacao, lida.movimentos.map((m) => [m.movement_type, m.quantity])]).toEqual(["confirmado", [["entry", "10.0000"]]]);
  });

  it("ES-2b produto com lote e validade: o lote e a validade do item vão para o movimento e para o balde; dois itens, dois movimentos", async () => {
    const p = await produto({ lote: "lote_validade" });
    const id = await lancado("entrada", [
      { produto_id: p.id, quantidade: "4", custo_unitario: "3.123456", lote: "L-ES2", validade: "2027-06-30" },
      { produto_id: p.id, quantidade: "1.5", custo_unitario: "2", lote: "L-ES2B", validade: "2027-01-31" },
    ]);
    expect((await confirmado("entrada", id)).movimentos).toBe(2);
    expect((await movimentos(id)).map((m) => [m.movement_type, m.quantity, m.unit_cost, m.provider_lot, m.expiration_date])).toEqual([
      ["entry", "4.0000", "3.123456", "L-ES2", "2027-06-30"],
      ["entry", "1.5000", "2.000000", "L-ES2B", "2027-01-31"],
    ]);
    expect([await saldo(c.I.warehouse, p.id, "L-ES2"), await saldo(c.I.warehouse, p.id, "L-ES2B")]).toEqual(["4.0000", "1.5000"]);
    const balde = (await c.admin.query<{ v: string }>("select to_char(expiration_date,'YYYY-MM-DD') v from erp.stock_balances where warehouse_id=$1 and product_id=$2 and provider_lot='L-ES2'", [c.I.warehouse, p.id])).rows[0]!.v;
    expect(balde).toBe("2027-06-30");
  });

  it("ES-2c confirmar de novo → 409 sem efeito; cancelado → 409 ALREADY_CANCELLED", async () => {
    const p = await produto();
    const id = await lancado("entrada", [{ produto_id: p.id, quantidade: "2", custo_unitario: "1" }]);
    await confirmado("entrada", id);
    const de_novo = await confirmar("entrada", id);
    expect(de_novo.statusCode, de_novo.body).toBe(409);
    expect((await movimentos(id)).length).toBe(1);
    expect(await saldo(c.I.warehouse, p.id)).toBe("2.0000");
    const outro = await lancado("entrada", [{ produto_id: p.id, quantidade: "2", custo_unitario: "1" }]);
    expect((await c.h.app.inject({ method: "POST", url: `/api/estoque/entradas/${outro}/cancelar`, headers: c.h.headers(), payload: {} })).statusCode).toBe(200);
    const cancelado = await confirmar("entrada", outro);
    expect([cancelado.statusCode, j(cancelado).error?.code]).toEqual([409, "ALREADY_CANCELLED"]);
    expect(await movimentos(outro)).toEqual([]);
    // contrato estrito também na confirmação
    const extra = await c.h.app.inject({ method: "POST", url: `/api/estoque/entradas/${outro}/confirmar`, headers: c.h.headers(), payload: { forcar: true } });
    expect(extra.statusCode).toBe(422);
  });
});

// ---------------------------------------------------------------------------------------------------------
// ES-3 — saída
// ---------------------------------------------------------------------------------------------------------
describe("ES-3 — confirmar SAÍDA → 'writeoff' pelo custo médio; insuficiente → 422 e NADA gravado; lote por validade", () => {
  it("ES-3a writeoff pelo custo MÉDIO do balde; o item guarda o custo usado", async () => {
    const p = await produto();
    await saldoInicial(p.id, "10", { custo: "10" });
    const e = await lancado("entrada", [{ produto_id: p.id, quantidade: "10", custo_unitario: "20" }]);
    await confirmado("entrada", e);
    expect(await custoMedio(c.I.warehouse, p.id), "premissa: médio 15").toBe("15.000000");
    const id = await lancado("saida", [{ produto_id: p.id, quantidade: "4" }]);
    expect((await confirmado("saida", id)).movimentos).toBe(1);
    expect((await movimentos(id)).map((m) => [m.movement_type, m.direction, m.quantity, m.unit_cost, m.movement_date])).toEqual([["writeoff", -1, "4.0000", "15.000000", DATA]]);
    expect((await itens(id)).map((x) => x.custo_unitario)).toEqual(["15.000000"]);
    expect(await saldo(c.I.warehouse, p.id)).toBe("16.0000");
    expect(await custoMedio(c.I.warehouse, p.id), "a saída não muda o médio").toBe("15.000000");
  });

  it("ES-3b saldo insuficiente → 422 em itens.<i>.quantidade e NADA gravado (nem o item bom); corrigido, confirma", async () => {
    const a = await produto(); const b = await produto();
    await saldoInicial(a.id, "10"); await saldoInicial(b.id, "10");
    const id = await lancado("saida", [{ produto_id: a.id, quantidade: "3" }, { produto_id: b.id, quantidade: "10.0001" }]);
    const r = await confirmar("saida", id);
    recusadoNoCampo(r, "itens.1.quantidade");
    expect(j(r).error!.code).toBe("VALIDATION_ERROR");
    expect(j(r).error!.message).toMatch(/Saldo insuficiente/);
    expect(j(r).error!.message).toContain(b.nome);
    expect(await movimentos(id), "nada gravado — nem o item que cabia").toEqual([]);
    expect([await saldo(c.I.warehouse, a.id), await saldo(c.I.warehouse, b.id)]).toEqual(["10.0000", "10.0000"]);
    expect((await doc(id)).situacao).toBe("aberto");
    expect((await itens(id)).map((x) => x.custo_unitario)).toEqual([null, null]);
    // dois itens do MESMO produto disputam o mesmo saldo: o segundo enxerga o que o primeiro deixou
    const dois = await lancado("saida", [{ produto_id: a.id, quantidade: "6" }, { produto_id: a.id, quantidade: "6" }]);
    recusadoNoCampo(await confirmar("saida", dois), "itens.1.quantidade");
    expect(await movimentos(dois)).toEqual([]);
    // PREMISSA: o que cabe confirma.
    const certo = await lancado("saida", [{ produto_id: a.id, quantidade: "5" }, { produto_id: a.id, quantidade: "5" }, { produto_id: b.id, quantidade: "10" }]);
    expect((await confirmado("saida", certo)).movimentos).toBe(3);
    expect([await saldo(c.I.warehouse, a.id), await saldo(c.I.warehouse, b.id)]).toEqual(["0.0000", "0.0000"]);
  });

  it("ES-3c sem lote informado, a saída escolhe pela VALIDADE (mais próxima primeiro); VENCIDO só sai informado (decisão 254)", async () => {
    const p = await produto({ lote: "lote_validade" });
    await saldoInicial(p.id, "3", { lote: "L-LONGE", validade: "2027-06-30" });
    await saldoInicial(p.id, "3", { lote: "L-PERTO", validade: "2026-12-31" });
    await saldoInicial(p.id, "5", { lote: "L-VENCIDO", validade: "2026-08-31" }); // vencido na data do documento (2026-09-10)
    const id = await lancado("saida", [{ produto_id: p.id, quantidade: "4" }]);
    expect((await confirmado("saida", id)).movimentos, "uma saída, dois lotes").toBe(2);
    expect((await movimentos(id)).map((m) => [m.movement_type, m.provider_lot, m.quantity, m.expiration_date])).toEqual([
      ["writeoff", "L-LONGE", "1.0000", "2027-06-30"],
      ["writeoff", "L-PERTO", "3.0000", "2026-12-31"],
    ]);
    expect([await saldo(c.I.warehouse, p.id, "L-PERTO"), await saldo(c.I.warehouse, p.id, "L-LONGE"), await saldo(c.I.warehouse, p.id, "L-VENCIDO")]).toEqual(["0.0000", "2.0000", "5.0000"]);

    // Há 2 válidos e 5 vencidos: pedir 3 SEM lote é recusado — o vencido não entra na escolha — e nada é gravado.
    // A recusa é o "saldo insuficiente" de sempre (422 no item), já na prévia: o vencido não conta como saldo da escolha.
    const antes = await movimentosDoProduto(p.id);
    const semLote = await lancado("saida", [{ produto_id: p.id, quantidade: "3" }]);
    recusadoNoCampo(await confirmar("saida", semLote), "itens.0.quantidade");
    expect(await movimentosDoProduto(p.id), "nada gravado").toBe(antes);
    expect((await doc(semLote)).situacao).toBe("aberto");
    expect(await saldo(c.I.warehouse, p.id, "L-VENCIDO")).toBe("5.0000");
    // PREMISSA: com o lote vencido INFORMADO, sai.
    const informado = await lancado("saida", [{ produto_id: p.id, quantidade: "3", lote: "L-VENCIDO" }]);
    await confirmado("saida", informado);
    expect((await movimentos(informado)).map((m) => [m.movement_type, m.provider_lot, m.quantity])).toEqual([["writeoff", "L-VENCIDO", "3.0000"]]);
    expect(await saldo(c.I.warehouse, p.id, "L-VENCIDO")).toBe("2.0000");
  });

  it("ES-3d lote informado sem saldo naquele lote → 422 no item (o saldo do OUTRO lote não conta)", async () => {
    const p = await produto({ lote: "lote" });
    await saldoInicial(p.id, "10", { lote: "L-TEM" });
    const id = await lancado("saida", [{ produto_id: p.id, quantidade: "1", lote: "L-NAO-TEM" }]);
    recusadoNoCampo(await confirmar("saida", id), "itens.0.quantidade");
    expect(await movimentos(id)).toEqual([]);
    const certo = await lancado("saida", [{ produto_id: p.id, quantidade: "1", lote: "L-TEM" }]);
    await confirmado("saida", certo);
    expect(await saldo(c.I.warehouse, p.id, "L-TEM")).toBe("9.0000");
  });
});

// ---------------------------------------------------------------------------------------------------------
// ES-4 — transferência
// ---------------------------------------------------------------------------------------------------------
describe("ES-4 — TRANSFERÊNCIA: transfer_out + transfer_in com o MESMO custo e lote", () => {
  it("ES-4a sem lote: sai da origem pelo médio e entra no destino pelo MESMO custo", async () => {
    const p = await produto();
    await saldoInicial(p.id, "10", { custo: "10" });
    const e = await lancado("entrada", [{ produto_id: p.id, quantidade: "10", custo_unitario: "20" }]);
    await confirmado("entrada", e);
    const destino = await armazem();
    const id = await lancado("transferencia", [{ produto_id: p.id, quantidade: "4" }], { armazem_destino_id: destino });
    expect((await confirmado("transferencia", id)).movimentos).toBe(2);
    expect((await movimentos(id)).map((m) => [m.movement_type, m.direction, m.warehouse_id, m.quantity, m.unit_cost])).toEqual([
      ["transfer_out", -1, c.I.warehouse, "4.0000", "15.000000"],
      ["transfer_in", 1, destino, "4.0000", "15.000000"],
    ]);
    expect([await saldo(c.I.warehouse, p.id), await saldo(destino, p.id)]).toEqual(["16.0000", "4.0000"]);
    expect(await custoMedio(destino, p.id), "o destino recebe o custo da origem").toBe("15.000000");
    expect((await itens(id)).map((x) => x.custo_unitario)).toEqual(["15.000000"]);
  });

  it("ES-4b com lote e validade escolhidos pela validade: o destino recebe os MESMOS lotes, validades, quantidades e custos", async () => {
    const p = await produto({ lote: "lote_validade" });
    await saldoInicial(p.id, "3", { lote: "T-LONGE", validade: "2027-06-30", custo: "8" });
    await saldoInicial(p.id, "3", { lote: "T-PERTO", validade: "2026-12-31", custo: "6" });
    const destino = await armazem();
    const id = await lancado("transferencia", [{ produto_id: p.id, quantidade: "5" }], { armazem_destino_id: destino });
    expect((await confirmado("transferencia", id)).movimentos).toBe(4);
    const ms = await movimentos(id);
    const lado = (tipo: string) => ms.filter((m) => m.movement_type === tipo).map((m) => [m.provider_lot, m.expiration_date, m.quantity, m.unit_cost]);
    expect(lado("transfer_out")).toEqual([["T-LONGE", "2027-06-30", "2.0000", "8.000000"], ["T-PERTO", "2026-12-31", "3.0000", "6.000000"]]);
    expect(lado("transfer_in"), "entrada espelha a saída parte por parte").toEqual(lado("transfer_out"));
    expect(ms.filter((m) => m.movement_type === "transfer_in").every((m) => m.warehouse_id === destino)).toBe(true);
    expect([await saldo(destino, p.id, "T-PERTO"), await saldo(destino, p.id, "T-LONGE"), await saldo(c.I.warehouse, p.id)]).toEqual(["3.0000", "2.0000", "1.0000"]);
    const validadeNoDestino = (await c.admin.query<{ v: string }>("select to_char(expiration_date,'YYYY-MM-DD') v from erp.stock_balances where warehouse_id=$1 and product_id=$2 and provider_lot='T-PERTO'", [destino, p.id])).rows[0]!.v;
    expect(validadeNoDestino).toBe("2026-12-31");
  });

  it("ES-4c insuficiente na origem → 422 no item e nada gravado; destino inativado depois do lançamento → 422 no campo", async () => {
    const p = await produto();
    await saldoInicial(p.id, "2");
    const destino = await armazem();
    const id = await lancado("transferencia", [{ produto_id: p.id, quantidade: "3" }], { armazem_destino_id: destino });
    recusadoNoCampo(await confirmar("transferencia", id), "itens.0.quantidade");
    expect(await movimentos(id)).toEqual([]);
    const ok = await lancado("transferencia", [{ produto_id: p.id, quantidade: "2" }], { armazem_destino_id: destino });
    await c.admin.query("update erp.warehouses set is_active=false where id=$1", [destino]);
    recusadoNoCampo(await confirmar("transferencia", ok), "armazem_destino_id");
    expect(await movimentos(ok)).toEqual([]);
    await c.admin.query("update erp.warehouses set is_active=true where id=$1", [destino]);
    await confirmado("transferencia", ok);
    expect([await saldo(c.I.warehouse, p.id), await saldo(destino, p.id)]).toEqual(["0.0000", "2.0000"]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// ES-8 — reserva de estoque (TOP-CONFIG-07)
// ---------------------------------------------------------------------------------------------------------
describe("ES-8 — reserva: saída e transferência respeitam a reserva de um pedido; o ajuste para baixo NÃO (declarado, 0035)", () => {
  /** Reservado do par pela conta da 0035, no banco. */
  const reservado = async (produtoId: string) => (await c.admin.query<{ r: string }>(
    "select coalesce(sum(n.reservado),0)::numeric(18,4)::text r from erp.reserva_estoque_nucleo($1, array[$2]::uuid[], array[$3]::uuid[], null::uuid) n",
    [c.h.demo.orgId, c.I.warehouse, produtoId])).rows[0]!.r;

  it("ES-8 pedido reserva 8 de 10: saída de 5 → recusada sem efeito; saída de 2 → confirma; transferência de 1 → recusada; ajuste para 5 → ACEITO", async () => {
    const topVenda = await top("vendas.venda", { configuracao: configuracaoNeutraTopV3() });
    const topPedido = await top("vendas.pedido", { reservaEstoque: true, destinos: [{ tipoOperacaoId: topVenda, ordem: 0 }] });
    const p = await produto();
    await saldoInicial(p.id, "10");
    const ped = await c.h.app.inject({ method: "POST", url: "/api/sales/orders", headers: c.h.headers(),
      payload: { empresa_id: c.I.empresa, document_date: DATA, client_id: c.I.client, tipo_operacao_id: topPedido,
        items: [{ product_id: p.id, warehouse_id: c.I.warehouse, quantity: "8", unit_price: "5.00" }] } });
    expect(ped.statusCode, `premissa: o pedido com reserva é gravado — ${ped.body}`).toBe(201);
    expect(await reservado(p.id), "premissa: 8 reservados").toBe("8.0000");

    const antes = await movimentosDoProduto(p.id);
    const fere = await lancado("saida", [{ produto_id: p.id, quantidade: "5" }]);
    const r = await confirmar("saida", fere);
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.code).toBe("INSUFFICIENT_STOCK");
    expect(await movimentosDoProduto(p.id), "a recusa não gravou nada").toBe(antes);
    expect([(await doc(fere)).situacao, await saldo(c.I.warehouse, p.id)]).toEqual(["aberto", "10.0000"]);

    // PREMISSA: o que não fere a reserva sai (10 − 2 = 8 = reservado).
    const cabe = await lancado("saida", [{ produto_id: p.id, quantidade: "2" }]);
    await confirmado("saida", cabe);
    expect(await saldo(c.I.warehouse, p.id)).toBe("8.0000");

    // A transferência também passa pela guarda (transfer_out).
    const tr = await lancado("transferencia", [{ produto_id: p.id, quantidade: "1" }]);
    const rt = await confirmar("transferencia", tr);
    expect([rt.statusCode, j(rt).error?.code]).toEqual([409, "INSUFFICIENT_STOCK"]);
    expect(await movimentos(tr)).toEqual([]);

    // O AJUSTE PARA BAIXO NÃO passa pela guarda (0035, por desenho): o inventário registra o que existe, mesmo abaixo do reservado.
    const aj = await lancado("ajuste", [{ produto_id: p.id, quantidade_contada: "5" }]);
    const ra = await confirmar("ajuste", aj);
    expect(ra.statusCode, ra.body).toBe(200);
    expect((await movimentos(aj)).map((m) => [m.movement_type, m.quantity])).toEqual([["correction_out", "3.0000"]]);
    expect([await saldo(c.I.warehouse, p.id), await reservado(p.id)], "físico abaixo do reservado — declarado").toEqual(["5.0000", "8.0000"]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// ES-9 — na confirmação
// ---------------------------------------------------------------------------------------------------------
describe("ES-9 — na confirmação: período fechado, produto inativo ou sem controle, armazém inativo → 422 no campo, nada gravado", () => {
  it("ES-9b período congelado pela data do DOCUMENTO → 422 em data_documento; o congelamento de outra empresa não bloqueia; descongelado, confirma", async () => {
    const p = await produto();
    const id = await lancado("entrada", [{ produto_id: p.id, quantidade: "1", custo_unitario: "1" }], { data_documento: "2025-02-15" });
    // Congelamento da OUTRA empresa: não é o deste documento.
    await c.admin.query("insert into erp.financial_freezes(organization_id, empresa_id, year, month, is_frozen) values ($1,$2,2025,2,true)", [c.h.demo.orgId, c.I.empresa2]);
    const congelado = (await c.admin.query<{ id: string }>(
      "insert into erp.financial_freezes(organization_id, empresa_id, year, month, is_frozen) values ($1,$2,2025,2,true) returning id", [c.h.demo.orgId, c.I.empresa])).rows[0]!.id;
    const r = await confirmar("entrada", id);
    recusadoNoCampo(r, "data_documento");
    expect(j(r).error!.message).toMatch(/congelado/);
    expect([await movimentos(id), (await doc(id)).situacao]).toEqual([[], "aberto"]);
    expect(await saldo(c.I.warehouse, p.id)).toBe("0.0000");
    await c.admin.query("update erp.financial_freezes set is_frozen=false where id=$1", [congelado]);
    await confirmado("entrada", id);
    expect(await saldo(c.I.warehouse, p.id)).toBe("1.0000");
  });

  it("ES-9c produto inativado, produto que deixou de controlar estoque e armazém inativado DEPOIS do lançamento → 422 no campo; reativado, confirma", async () => {
    const p = await produto();
    await saldoInicial(p.id, "5");
    const sai = await lancado("saida", [{ produto_id: p.id, quantidade: "1" }]);
    await c.admin.query("update erp.products set is_active=false where id=$1", [p.id]);
    recusadoNoCampo(await confirmar("saida", sai), "itens.0.produto_id");
    await c.admin.query("update erp.products set is_active=true where id=$1", [p.id]);

    const q = await produto();
    const ent = await lancado("entrada", [{ produto_id: q.id, quantidade: "1", custo_unitario: "1" }]);
    await c.admin.query("update erp.products set control_stock=false where id=$1", [q.id]);
    const r = await confirmar("entrada", ent);
    recusadoNoCampo(r, "itens.0.produto_id");
    expect(r.statusCode, "nunca 500").toBe(422);
    await c.admin.query("update erp.products set control_stock=true where id=$1", [q.id]);

    const w = await armazem();
    await saldoInicial(p.id, "5", { armazem: w });
    const naoAtivo = await lancado("saida", [{ produto_id: p.id, quantidade: "1" }], { armazem_id: w });
    await c.admin.query("update erp.warehouses set is_active=false where id=$1", [w]);
    recusadoNoCampo(await confirmar("saida", naoAtivo), "armazem_id");
    expect([await movimentos(sai), await movimentos(ent), await movimentos(naoAtivo)], "nenhuma recusa gravou").toEqual([[], [], []]);
    await c.admin.query("update erp.warehouses set is_active=true where id=$1", [w]);

    // PREMISSAS: corrigido o cadastro, os três confirmam.
    await confirmado("saida", sai); await confirmado("entrada", ent); await confirmado("saida", naoAtivo);
    expect([await saldo(c.I.warehouse, p.id), await saldo(c.I.warehouse, q.id), await saldo(w, p.id)]).toEqual(["4.0000", "1.0000", "4.0000"]);
  });
});
