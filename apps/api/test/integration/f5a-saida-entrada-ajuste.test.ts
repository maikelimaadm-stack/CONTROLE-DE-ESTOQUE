import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { D } from "@agro/shared";
import { ESPECIES_DOCUMENTO_ESTOQUE, MOTIVOS_SAIDA_ESTOQUE } from "@agro/domain";
import {
  c, iniciar, encerrar, produto, saldoInicial, j, recusadoNoCampo, contarDocumentos, lancarDoc, lancadoDoc, lido, previaDoc,
  confirmarDoc, confirmadoDoc, cancelarDoc, detalhes, cabecalho, itensNoBanco, razao, type Item,
} from "./f5a-ajuda.js";

/**
 * OPERACOES-01 F5a (decisão 282) — O QUE A SAÍDA, A ENTRADA E O AJUSTE GANHARAM DA TELA ANTIGA, sem mudar o de antes.
 *
 *   · SAÍDA: o motivo (os 13 da baixa antiga) e a justificativa, em PAR e OPCIONAIS (o web anterior lança sem eles).
 *     TRANSITÓRIO: o pedido diz "justificativa obrigatória", e o servidor é a autoridade — o par passa a ser obrigatório
 *     no servidor na primeira PR depois que o web anterior sair de produção (pendência da decisão 282, F5a; ver
 *     `recusasDaFormaDaMovimentacaoInterna`). Nesse dia, a saída do SEA-4 (sem o par) passa a ser recusada;
 *   · ENTRADA: pode vir sem custo — a confirmação usa o custo médio do produto (`products.average_cost`, "como na
 *     devolução antiga") e o grava no item;
 *   · AJUSTE: aceita o custo informado (a correção pelo custo dado, como a correção antiga);
 *   · O CORPO DE ANTES (sem nenhum campo novo) nas quatro espécies: 201 com as MESMAS chaves, e a prévia, a confirmação
 *     e o cancelamento com as chaves de hoje (sem `baseDoSaldo`).
 *
 * O QUE CONTA COMO PROVA: as colunas e os movimentos lidos no banco (superusuário), com a premissa ao lado.
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

const item = (produtoId: string, quantidade: string, extra: Record<string, unknown> = {}): Item => ({ produto_id: produtoId, quantidade, ...extra });
const chaves = (v: unknown) => Object.keys(v as Record<string, unknown>).sort();

describe("SEA-1 — saída com motivo e justificativa", () => {
  it("SEA-1a motivo e justificativa são gravados e lidos; a saída confirma como sempre", async () => {
    const p = await produto(); await saldoInicial(p.id, "5");
    const id = await lancadoDoc("saida", [item(p.id, "2")], { motivo_saida: "damage", justificativa: "  Embalagem rasgada no transporte  " });
    expect(await cabecalho(id)).toMatchObject({ motivo_saida: "damage", justificativa: "Embalagem rasgada no transporte" });
    expect(await lido("saida", id)).toMatchObject({ motivo_saida: "damage", justificativa: "Embalagem rasgada no transporte" });
    await confirmadoDoc("saida", id);
    expect((await razao(id)).map((m) => [m.movement_type, m.quantity])).toEqual([["writeoff", "2.0000"]]);
  });

  it("SEA-1b o par: motivo sem justificativa, justificativa sem motivo, motivo fora dos 13, motivo na entrada → 422 no campo; nada gravado", async () => {
    const p = await produto();
    const antes = await contarDocumentos();
    expect(MOTIVOS_SAIDA_ESTOQUE, "premissa: os 13 motivos da baixa antiga").toHaveLength(13);
    const semJustificativa = await lancarDoc("saida", [item(p.id, "1")], { motivo_saida: "loss" });
    expect(detalhes(semJustificativa)).toEqual([["justificativa", "Informe a justificativa da saída"]]);
    const soEspacos = await lancarDoc("saida", [item(p.id, "1")], { motivo_saida: "loss", justificativa: "   " });
    expect(detalhes(soEspacos), "justificativa só com espaços é justificativa nenhuma").toEqual([["justificativa", "Informe a justificativa da saída"]]);
    const semMotivo = await lancarDoc("saida", [item(p.id, "1")], { justificativa: "sem motivo" });
    expect(detalhes(semMotivo)).toEqual([["motivo_saida", "Informe o motivo da saída"]]);
    recusadoNoCampo(await lancarDoc("saida", [item(p.id, "1")], { motivo_saida: "sumiu", justificativa: "x" }), "motivo_saida");
    const naEntrada = await lancarDoc("entrada", [item(p.id, "1", { custo_unitario: "1" })], { motivo_saida: "loss", justificativa: "x" });
    expect(detalhes(naEntrada)).toEqual([["motivo_saida", "O motivo é só da saída"], ["justificativa", "A justificativa é só da saída"]]);
    expect(await contarDocumentos(), "nenhuma recusa gravou").toBe(antes);
    // PREMISSA: cada um dos 13, com a justificativa, salva.
    for (const motivo of MOTIVOS_SAIDA_ESTOQUE) {
      const id = await lancadoDoc("saida", [item(p.id, "1")], { motivo_saida: motivo, justificativa: `Motivo ${motivo}` });
      expect((await cabecalho(id)).motivo_saida).toBe(motivo);
    }
  });
});

describe("SEA-2 — entrada sem custo: o custo médio do produto", () => {
  it("SEA-2 a entrada sem custo confirma pelo custo médio consolidado do produto e o grava no item; com custo, o informado", async () => {
    const p = await produto();
    // Custo médio consolidado 8 (saldo de partida no OUTRO local de estoque, para o ALM começar sem saldo).
    await saldoInicial(p.id, "4", { armazem: c.I.warehouse2, custo: "8" });
    const medio = (await c.admin.query<{ c: string }>("select average_cost::text c from erp.products where id = $1", [p.id])).rows[0]!.c;
    expect(medio, "premissa: o custo médio do produto antes da entrada").toBe("8.000000");

    const semCusto = await lancadoDoc("entrada", [item(p.id, "2")]);
    expect((await itensNoBanco(semCusto)).map((x) => x.custo_unitario), "lançada sem custo").toEqual([null]);
    await confirmadoDoc("entrada", semCusto);
    expect((await razao(semCusto)).map((m) => [m.movement_type, m.direction, m.quantity, m.unit_cost])).toEqual([["entry", 1, "2.0000", "8.000000"]]);
    expect((await itensNoBanco(semCusto)).map((x) => x.custo_unitario), "o custo usado fica no item").toEqual(["8.000000"]);

    const comCusto = await lancadoDoc("entrada", [item(p.id, "1", { custo_unitario: "11.5" })]);
    await confirmadoDoc("entrada", comCusto);
    expect((await razao(comCusto)).map((m) => m.unit_cost)).toEqual(["11.500000"]);
    expect((await itensNoBanco(comCusto)).map((x) => x.custo_unitario), "o custo informado não muda").toEqual(["11.500000"]);
  });
});

describe("SEA-3 — ajuste com custo informado", () => {
  it("SEA-3 contou MAIS com custo → `correction_in` pelo informado; contou MENOS com custo → `correction_out` pelo informado; sem custo, como antes", async () => {
    const p = await produto(); await saldoInicial(p.id, "5", { custo: "10" });
    const mais = await lancadoDoc("ajuste", [{ produto_id: p.id, quantidade_contada: "8", custo_unitario: "12.5" }]);
    await confirmadoDoc("ajuste", mais);
    expect((await razao(mais)).map((m) => [m.movement_type, m.direction, m.quantity, m.unit_cost])).toEqual([["correction_in", 1, "3.0000", "12.500000"]]);
    expect((await itensNoBanco(mais)).map((x) => x.custo_unitario)).toEqual(["12.500000"]);

    const menos = await lancadoDoc("ajuste", [{ produto_id: p.id, quantidade_contada: "2", custo_unitario: "7" }]);
    await confirmadoDoc("ajuste", menos);
    expect((await razao(menos)).map((m) => [m.movement_type, m.direction, m.quantity, m.unit_cost])).toEqual([["correction_out", -1, "6.0000", "7.000000"]]);

    const igual = await lancadoDoc("ajuste", [{ produto_id: p.id, quantidade_contada: "2", custo_unitario: "9" }]);
    await confirmadoDoc("ajuste", igual);
    expect(await razao(igual), "diferença zero não move nada").toEqual([]);
    expect((await itensNoBanco(igual)).map((x) => x.custo_unitario), "e guarda o custo informado").toEqual(["9.000000"]);

    // PREMISSA (o de antes): sem custo, o ajuste para cima usa o médio do balde (valor ÷ quantidade, como sempre).
    const semCusto = await lancadoDoc("ajuste", [{ produto_id: p.id, quantidade_contada: "3" }]);
    const b = (await c.admin.query<{ v: string; q: string }>("select total_value::text v, quantity::text q from erp.stock_balances where warehouse_id = $1 and product_id = $2 and provider_lot = ''", [c.I.warehouse, p.id])).rows[0]!;
    const custoDoBalde = D(b.v).div(b.q).toFixed(6);
    expect(custoDoBalde, "premissa: o médio do balde não é nenhum dos custos informados").not.toBe("9.000000");
    await confirmadoDoc("ajuste", semCusto);
    expect((await razao(semCusto)).map((m) => [m.movement_type, m.quantity, m.unit_cost])).toEqual([["correction_in", "1.0000", custoDoBalde]]);
  });
});

describe("SEA-4 — o corpo de ANTES nas quatro espécies: as mesmas chaves", () => {
  it("SEA-4 lançar, prévia, confirmar e cancelar com o corpo do web anterior → as chaves de hoje (sem `baseDoSaldo`, sem campo novo exigido)", async () => {
    const p = await produto(); await saldoInicial(p.id, "10");
    const corpoDeAntes: Record<(typeof ESPECIES_DOCUMENTO_ESTOQUE)[number], Item[]> = {
      // A saída SEM motivo e justificativa: o corpo do web anterior (o par é opcional só enquanto ele existir — ver o cabeçalho).
      entrada: [item(p.id, "2", { custo_unitario: "3" })], saida: [item(p.id, "1")], transferencia: [item(p.id, "1")],
      ajuste: [{ produto_id: p.id, quantidade_contada: "9" }],
    };
    for (const especie of ESPECIES_DOCUMENTO_ESTOQUE) {
      const r = await lancarDoc(especie, corpoDeAntes[especie]);
      expect(r.statusCode, `${especie}: ${r.body}`).toBe(201);
      expect(chaves(j(r)), especie).toEqual(["codigo", "especie", "id", "situacao"]);
      const id = (j(r) as { id: string }).id;
      expect(await cabecalho(id), "nenhum campo novo gravado").toMatchObject({ origem_documento_id: null, centro_custo_id: null, motivo_saida: null, justificativa: null });
      const pv = await previaDoc(especie, id);
      expect(pv.statusCode, pv.body).toBe(200);
      expect(chaves(j(pv)), `${especie}: a prévia de hoje`).toEqual(["contractVersion", "documento", "itens", "podeConfirmar"]);
      const cf = await confirmarDoc(especie, id);
      expect(cf.statusCode, cf.body).toBe(200);
      expect(chaves(j(cf)), especie).toEqual(["id", "movimentos", "situacao"]);
      const cn = await cancelarDoc(especie, id);
      expect(cn.statusCode, cn.body).toBe(200);
      expect(chaves(j(cn)), especie).toEqual(["estornos", "id", "situacao"]);
    }
  });
});
