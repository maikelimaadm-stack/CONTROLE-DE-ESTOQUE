import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import {
  CAPACIDADE_SALDO_INICIAL_ESTOQUE, TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE, entendeSaldoInicialEstoque, saldoInicialPelaTop,
  type EspecieEstoque,
} from "@agro/domain";
import {
  c, iniciar, encerrar, produto, j, topV5, familia, segmento, lancarDoc, lancadoDoc, confirmarDoc, confirmadoDoc, cancelarDoc, forma, saldo,
  type Item, type Resposta,
} from "./f5a-ajuda.js";
import { movimentos, movimentosDoProduto, emParaleloComBarreira, doc } from "./estoque-01-ajuda.js";

/**
 * OPERACOES-01 F11 (decisão 288) — O SALDO INICIAL PELA TOP DE ENTRADA (o I-2 da F5a).
 *
 *   · `GET /api/estoque/entradas/operation-types` declara `capacidades.saldoInicial: 1` NO FIM e cada item diz se a TOP
 *     lança o saldo inicial (`saldoInicial: boolean`); as outras seis espécies respondem como antes (SI-0);
 *   · a entrada confirmada com a TOP marcada (seção `implantacao.saldoInicial = true`) grava `opening_balance`; a
 *     mesma entrada com a TOP no neutro grava `entry` (SI-1);
 *   · o segundo saldo inicial VIVO do mesmo produto/local de estoque/lote é recusado com 409 DUPLICATE_DOCUMENT e a
 *     mensagem da tela antiga, sem nenhum movimento, com o documento ABERTO; lote diferente passa; duas linhas iguais
 *     no mesmo documento são recusadas; cancelar o primeiro libera (SI-2);
 *   · a regra é UMA para as duas portas: a tela antiga (`/api/stock/opening-balances`) recusa o saldo inicial que veio
 *     do documento, o documento recusa o que veio da tela antiga, e o estorno antigo libera (SI-3);
 *   · duas confirmações simultâneas da mesma chave: exatamente uma confirma (SI-4);
 *   · NÚMERO FIXO de consultas: a trava e a conferência são UMA consulta cada, com 2 ou com 8 produtos (SI-6);
 *   · "Salvar e confirmar" (confirmação automática): a recusa chega como as outras recusas de confirmação — o documento
 *     fica salvo e ABERTO com `recusada` e o MESMO corpo de erro do `/confirmar` (SI-5).
 * As provas de efeito são lidas no banco (superusuário, sem RLS), pela origem do razão.
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

const MENSAGEM = "Já existe estoque inicial confirmado para este produto/local de estoque/lote";

/** A TOP de entrada no FORMATO 5 que LANÇA o saldo inicial (opcionalmente com a Confirmação Automática). */
const topMarcada = (automatica = false) => topV5("entrada", (x) => {
  x.implantacao.saldoInicial = true;
  if (automatica) x.geral.confirmacao = "automatica";
});
/** A TOP de entrada no FORMATO 5 NEUTRO (a seção `implantacao` no padrão: `saldoInicial: false`). */
const topNeutra5 = () => topV5("entrada", () => {});

const item = (produtoId: string, quantidade: string, extra: Record<string, unknown> = {}): Item => ({ produto_id: produtoId, quantidade, custo_unitario: "10", ...extra });

/** Uma entrada lançada (aberta) com a TOP dada. */
const entrada = (top: string, itens: Item[]) => lancadoDoc("entrada", itens, { tipo_operacao_id: top });

/** Os tipos de movimento do documento no razão, na ordem do ajudante. */
const tipos = async (id: string) => (await movimentos(id)).map((m) => [m.movement_type, m.direction, m.provider_lot]);

/** O saldo inicial pela TELA ANTIGA (`POST /api/stock/opening-balances`), sem conferir o status. */
const saldoInicialAntigo = (produtoId: string, quantidade: string, lote?: string): Promise<Resposta> =>
  c.h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: c.h.headers(),
    payload: { empresa_id: c.I.empresa, warehouse_id: c.I.warehouse, product_id: produtoId, quantity: quantidade, unit_value: "7", ...(lote ? { provider_lot: lote } : {}) } });

/** O corpo da recusa de duplicidade, inteiro (status, código, mensagem e os detalhes por item). */
const recusaDeDuplicidade = (posicoes: number[]) => [409, "DUPLICATE_DOCUMENT", MENSAGEM,
  JSON.stringify(posicoes.map((i) => ({ path: `itens.${i}.produto_id`, message: MENSAGEM })))];

const operacoes = (especie: EspecieEstoque) =>
  c.h.app.inject({ method: "GET", url: `/api/estoque/${segmento(especie)}/operation-types`, headers: c.h.headers() });

describe("SI-0 — a capacidade: só a entrada declara `saldoInicial`, no fim, e cada item diz se a TOP lança o saldo inicial", () => {
  it("SI-0 entrada: cinco capacidades (saldoInicial por último) e o item marcado `true`, o neutro `false`; as outras seis, nada", async () => {
    expect(CAPACIDADE_SALDO_INICIAL_ESTOQUE, "premissa: a constante vale 1").toBe(1);
    const marcada = await topMarcada();
    const neutra = await topNeutra5();
    const r = await operacoes("entrada");
    expect(r.statusCode, r.body).toBe(200);
    const corpo = j(r) as { contractVersion: number; capacidades: Record<string, unknown>; items: Record<string, unknown>[] };
    expect(corpo.contractVersion).toBe(1);
    expect(Object.entries(corpo.capacidades), "chave a chave, na ordem").toEqual([
      ["documentoEstoque", 1], ["movimentacaoInterna", 1], ["layoutDocumento", 1], ["regrasDaOperacao", 1], ["saldoInicial", 1],
    ]);
    expect(entendeSaldoInicialEstoque(corpo.capacidades)).toBe(true);
    const porId = new Map(corpo.items.map((x) => [x["id"], x]));
    expect(porId.get(marcada)?.["saldoInicial"], "a TOP marcada lança o saldo inicial").toBe(true);
    expect(porId.get(neutra)?.["saldoInicial"], "a TOP no neutro do 5 não lança").toBe(false);
    expect(porId.get(c.tops.entrada)?.["saldoInicial"], "a TOP no formato 1 não lança").toBe(false);
    // Todo item da entrada traz o campo, booleano, igual ao que o domínio decide da configuração do banco.
    const configuracoes = await c.admin.query<{ id: string; configuracao: unknown }>(
      `select t.id, v.configuracao from erp.tipos_operacao t
         join erp.tipos_operacao_versoes v on v.tipo_operacao_id = t.id and v.versao = t.versao_atual
        where t.id = any($1::uuid[])`, [corpo.items.map((x) => x["id"])]);
    expect(configuracoes.rowCount, "premissa: cada item da lista tem a versão atual no banco").toBe(corpo.items.length);
    for (const linha of configuracoes.rows) {
      expect(porId.get(linha.id)?.["saldoInicial"], linha.id).toBe(saldoInicialPelaTop(familia("entrada"), linha.configuracao));
    }

    for (const especie of TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE.filter((e) => e !== "entrada")) {
      const o = await operacoes(especie);
      expect(o.statusCode, `${especie}: ${o.body}`).toBe(200);
      const x = j(o) as { capacidades: Record<string, unknown>; items: Record<string, unknown>[] };
      expect(Object.keys(x.capacidades), `${especie}: as quatro de antes`).toEqual(["documentoEstoque", "movimentacaoInterna", "layoutDocumento", "regrasDaOperacao"]);
      expect(x.items.length, `premissa: ${especie} tem TOP na lista`).toBeGreaterThan(0);
      for (const it of x.items) expect(Object.keys(it), `${especie}: o item de antes`).toEqual(["id", "code", "name", "version", "isDefault"]);
    }
  });
});

describe("SI-1 — a TOP marcada grava `opening_balance`; a neutra, `entry`", () => {
  it("SI-1 a mesma entrada: neutra → entry; marcada → opening_balance; o saldo sobe nas duas", async () => {
    const p = await produto();
    const neutra = await entrada(await topNeutra5(), [item(p.id, "3")]);
    await confirmadoDoc("entrada", neutra);
    expect(await tipos(neutra), "premissa: a TOP no neutro grava a entrada comum").toEqual([["entry", 1, null]]);
    expect(await saldo(c.I.warehouse, p.id)).toBe("3.0000");

    const q = await produto();
    const marcada = await entrada(await topMarcada(), [item(q.id, "5")]);
    const r = await confirmadoDoc("entrada", marcada);
    expect(r.movimentos).toBe(1);
    expect(await tipos(marcada), "a TOP marcada grava o Estoque inicial").toEqual([["opening_balance", 1, null]]);
    expect(await saldo(c.I.warehouse, q.id), "o saldo sobe").toBe("5.0000");
    expect((await doc(marcada)).situacao).toBe("confirmado");
  });
});

describe("SI-2 — a duplicidade no documento", () => {
  it("SI-2a o segundo saldo inicial da mesma chave: 409 com a mensagem, zero movimento, documento aberto; lote diferente passa", async () => {
    const t = await topMarcada();
    const p = await produto({ lote: "lote" });
    const primeiro = await entrada(t, [item(p.id, "4", { lote: "L1" })]);
    await confirmadoDoc("entrada", primeiro);
    expect(await tipos(primeiro), "premissa: o primeiro é o saldo inicial do lote L1").toEqual([["opening_balance", 1, "L1"]]);

    const segundo = await entrada(t, [item(p.id, "2", { lote: "L1" })]);
    const antes = await movimentosDoProduto(p.id);
    const r = await confirmarDoc("entrada", segundo);
    expect(forma(r)).toEqual(recusaDeDuplicidade([0]));
    expect(await movimentosDoProduto(p.id), "nenhum movimento novo").toBe(antes);
    expect((await doc(segundo)).situacao, "o documento continua aberto").toBe("aberto");
    expect(await saldo(c.I.warehouse, p.id, "L1")).toBe("4.0000");

    // O lote é parte da chave: outro lote do mesmo produto no mesmo local é outro saldo inicial.
    const outroLote = await entrada(t, [item(p.id, "6", { lote: "L2" })]);
    await confirmadoDoc("entrada", outroLote);
    expect(await tipos(outroLote)).toEqual([["opening_balance", 1, "L2"]]);
  });

  it("SI-2b duas linhas da MESMA chave no mesmo documento: 409 na segunda, nada gravado; a premissa — em documentos separados, a primeira confirmaria", async () => {
    const t = await topMarcada();
    const p = await produto({ lote: "lote" });
    const duplo = await entrada(t, [item(p.id, "1", { lote: "X" }), item(p.id, "2", { lote: "Y" }), item(p.id, "3", { lote: "X" })]);
    const r = await confirmarDoc("entrada", duplo);
    expect(forma(r), "só a TERCEIRA linha (a segunda com a chave X) é recusada").toEqual(recusaDeDuplicidade([2]));
    expect(await movimentosDoProduto(p.id), "nada gravado").toBe(0);
    expect((await doc(duplo)).situacao).toBe("aberto");
    // Premissa: sem a linha repetida, o mesmo documento confirma — a recusa era a repetição, não o produto.
    const unico = await entrada(t, [item(p.id, "1", { lote: "X" }), item(p.id, "2", { lote: "Y" })]);
    await confirmadoDoc("entrada", unico);
    expect(await tipos(unico)).toEqual([["opening_balance", 1, "X"], ["opening_balance", 1, "Y"]]);
  });

  it("SI-2c cancelar o primeiro libera a chave: o novo saldo inicial confirma", async () => {
    const t = await topMarcada();
    const p = await produto();
    const primeiro = await entrada(t, [item(p.id, "4")]);
    await confirmadoDoc("entrada", primeiro);
    const segundo = await entrada(t, [item(p.id, "9")]);
    expect(forma(await confirmarDoc("entrada", segundo)), "premissa: com o primeiro vivo, o segundo é recusado").toEqual(recusaDeDuplicidade([0]));

    const cancelado = await cancelarDoc("entrada", primeiro);
    expect(cancelado.statusCode, cancelado.body).toBe(200);
    expect(await tipos(primeiro), "o cancelamento estorna o saldo inicial").toEqual([["opening_balance", 1, null], ["reversal", -1, null]]);
    await confirmadoDoc("entrada", segundo);
    expect(await tipos(segundo)).toEqual([["opening_balance", 1, null]]);
    expect(await saldo(c.I.warehouse, p.id)).toBe("9.0000");
  });
});

describe("SI-3 — UMA regra para as duas portas (a tela antiga e o documento)", () => {
  it("SI-3a o saldo inicial do DOCUMENTO barra a tela antiga: 409 com a mesma mensagem, nada gravado; outro lote passa", async () => {
    const p = await produto({ lote: "lote" });
    const d = await entrada(await topMarcada(), [item(p.id, "4", { lote: "A1" })]);
    await confirmadoDoc("entrada", d);
    const antes = await movimentosDoProduto(p.id);
    const r = await saldoInicialAntigo(p.id, "1", "A1");
    expect([r.statusCode, j(r).error?.code, j(r).error?.message]).toEqual([409, "DUPLICATE_DOCUMENT", MENSAGEM]);
    expect(j(r).error?.details, "o corpo de erro da tela antiga é o de sempre (sem detalhes)").toBeUndefined();
    expect(await movimentosDoProduto(p.id)).toBe(antes);
    const outro = await saldoInicialAntigo(p.id, "1", "A2");
    expect(outro.statusCode, `premissa: a tela antiga grava outro lote — ${outro.body}`).toBe(201);
  });

  it("SI-3b o saldo inicial da TELA ANTIGA barra o documento (sem lote: nulo e vazio são a mesma chave); o estorno antigo libera", async () => {
    const p = await produto();
    const antigo = await saldoInicialAntigo(p.id, "5");
    expect(antigo.statusCode, `premissa: a tela antiga grava — ${antigo.body}`).toBe(201);
    const idAntigo = (j(antigo) as { id: string }).id;

    const d = await entrada(await topMarcada(), [item(p.id, "2")]);
    const antes = await movimentosDoProduto(p.id);
    expect(forma(await confirmarDoc("entrada", d))).toEqual(recusaDeDuplicidade([0]));
    expect(await movimentosDoProduto(p.id)).toBe(antes);
    expect((await doc(d)).situacao).toBe("aberto");

    const estorno = await c.h.app.inject({ method: "DELETE", url: `/api/stock/opening-balances/${idAntigo}`, headers: c.h.headers() });
    expect(estorno.statusCode, estorno.body).toBe(200);
    await confirmadoDoc("entrada", d);
    expect(await tipos(d)).toEqual([["opening_balance", 1, null]]);
    expect(await saldo(c.I.warehouse, p.id), "5 − 5 (estorno) + 2").toBe("2.0000");
    // E a tela antiga, agora, recusa por causa do documento: a regra vale nos dois sentidos.
    const deNovo = await saldoInicialAntigo(p.id, "1");
    expect([deNovo.statusCode, j(deNovo).error?.message]).toEqual([409, MENSAGEM]);
  });
});

describe("SI-4 — concorrência: duas confirmações da mesma chave ao mesmo tempo", () => {
  it("SI-4 as duas chegam à trava da chave juntas; exatamente uma confirma, a outra recebe o 409 e fica aberta", async () => {
    const t = await topMarcada();
    const p = await produto({ lote: "lote" });
    const a = await entrada(t, [item(p.id, "1", { lote: "C1" })]);
    const b = await entrada(t, [item(p.id, "2", { lote: "C1" })]);
    expect([(await doc(a)).situacao, (await doc(b)).situacao], "premissa: as duas estão abertas").toEqual(["aberto", "aberto"]);
    // A barreira segura a MESMA trava consultiva da chave (organização, local, produto, lote): as duas confirmações
    // passam da trava do cabeçalho (documentos diferentes) e param nela, antes de ler o razão.
    const { respostas, esperando } = await emParaleloComBarreira(
      "select pg_advisory_xact_lock(hashtextextended('estoque-saldo-inicial:' || $1::text || ':' || $2::text || ':' || $3::text || ':' || $4::text, 0))",
      [c.h.demo.orgId, c.I.warehouse, p.id, "C1"],
      () => confirmarDoc("entrada", a), () => confirmarDoc("entrada", b));
    expect(esperando, "premissa: as duas confirmações esperavam a trava da chave ao mesmo tempo").toBeGreaterThanOrEqual(2);
    const status = respostas.map((r) => r.statusCode).sort();
    expect(status, respostas.map((r) => r.body).join(" | ")).toEqual([200, 409]);
    const perdedora = respostas.find((r) => r.statusCode === 409)!;
    expect(forma(perdedora)).toEqual(recusaDeDuplicidade([0]));
    const situacoes = [(await doc(a)).situacao, (await doc(b)).situacao].sort();
    expect(situacoes).toEqual(["aberto", "confirmado"]);
    const vivos = await c.admin.query<{ n: string }>(
      "select count(*)::text n from erp.stock_movements where product_id = $1 and movement_type = 'opening_balance'", [p.id]);
    expect(vivos.rows[0]!.n, "um saldo inicial só no razão").toBe("1");
  });
});

describe("SI-5 — \"Salvar e confirmar\" (Confirmação Automática): a recusa chega como as outras", () => {
  it("SI-5 a segunda entrada salva e fica ABERTA com `recusada` e o MESMO corpo do /confirmar; nenhum movimento", async () => {
    const t = await topMarcada(true);
    const p = await produto();
    const primeiro = await lancarDoc("entrada", [item(p.id, "3")], { tipo_operacao_id: t });
    expect(primeiro.statusCode, primeiro.body).toBe(201);
    const corpo1 = j(primeiro) as { id: string; situacao: string; confirmacaoAutomatica?: unknown };
    expect([corpo1.situacao, corpo1.confirmacaoAutomatica], "premissa: a automática confirma o primeiro").toEqual(["confirmado", { confirmado: true }]);
    expect(await tipos(corpo1.id)).toEqual([["opening_balance", 1, null]]);

    const antes = await movimentosDoProduto(p.id);
    const segundo = await lancarDoc("entrada", [item(p.id, "4")], { tipo_operacao_id: t });
    expect(segundo.statusCode, `o documento é SALVO — ${segundo.body}`).toBe(201);
    const corpo2 = j(segundo) as { id: string; situacao: string; confirmacaoAutomatica?: unknown };
    expect(corpo2.situacao).toBe("aberto");
    expect(corpo2.confirmacaoAutomatica).toEqual({ confirmado: false, motivo: "recusada",
      erro: { code: "DUPLICATE_DOCUMENT", message: MENSAGEM, details: [{ path: "itens.0.produto_id", message: MENSAGEM }] } });
    expect(await movimentosDoProduto(p.id), "nenhum movimento").toBe(antes);
    expect((await doc(corpo2.id)).situacao).toBe("aberto");
    // O mesmo corpo do /confirmar manual: uma recusa só.
    const manual = await confirmarDoc("entrada", corpo2.id);
    expect(manual.statusCode).toBe(409);
    expect(j(manual).error).toEqual((corpo2.confirmacaoAutomatica as { erro: unknown }).erro);
  });
});

describe("SI-6 — número fixo de consultas: a trava e a conferência não crescem com os itens (nunca N+1)", () => {
  it("SI-6 com 2 e com 8 produtos distintos: UMA consulta de trava e UMA de conferência; os itens vivos (3º e 7º) são os recusados", async () => {
    const t = await topMarcada();
    const ps = [];
    for (let i = 0; i < 10; i++) ps.push(await produto());
    // Dois produtos com saldo inicial VIVO pela tela antiga — os itens 2 e 6 do documento de oito.
    for (const k of [2, 6]) {
      const r = await saldoInicialAntigo(ps[k]!.id, "1");
      expect(r.statusCode, `premissa: a tela antiga grava o saldo inicial do produto ${k} — ${r.body}`).toBe(201);
    }
    async function contar(itens: Item[]): Promise<{ resposta: Resposta; travas: number; conferencias: number }> {
      const d = await entrada(t, itens);
      const espiao = vi.spyOn(pg.Client.prototype, "query");
      try {
        const resposta = await confirmarDoc("entrada", d);
        const sqls = espiao.mock.calls.map((x) => (typeof x[0] === "string" ? x[0] : (x[0] as { text?: unknown } | undefined)?.text)).filter((x): x is string => typeof x === "string");
        return {
          resposta,
          travas: sqls.filter((s) => s.includes("'estoque-saldo-inicial:'")).length,
          conferencias: sqls.filter((s) => /from erp\.opening_balances o\b/.test(s)).length,
        };
      } finally { espiao.mockRestore(); }
    }
    const oito = await contar(ps.slice(0, 8).map((p) => item(p.id, "1")));
    expect(forma(oito.resposta), "premissa: só os dois produtos vivos são recusados (a conferência enxergou os oito)").toEqual(recusaDeDuplicidade([2, 6]));
    const dois = await contar(ps.slice(8, 10).map((p) => item(p.id, "1")));
    expect(dois.resposta.statusCode, `premissa: o documento de dois confirma — ${dois.resposta.body}`).toBe(200);
    expect([oito.travas, oito.conferencias], "oito produtos: uma trava e uma conferência").toEqual([1, 1]);
    expect([dois.travas, dois.conferencias], "dois produtos: as MESMAS consultas").toEqual([1, 1]);
  });
});
