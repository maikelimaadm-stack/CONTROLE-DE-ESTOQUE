import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { appCom } from "./setup.js";
import { c, iniciar, encerrar, j, cfg4, top, usuario, type Hdr, type Resposta } from "./top-config-08-ajuda.js";
import { COMPRA, ORCAMENTO_DE_COMPRA, topCompraNo5, topPedidoNo5, cadastroDespesa, centro, type TopNo5 } from "./f9b-ajuda.js";

/**
 * LANCAMENTO-01, emenda R2 da decisão 311 — A CHAVE `COMPRAS_LOCAL_DO_PRODUTO_ENABLED` NA RESPOSTA DE
 * `GET /api/compras/{compras|pedidos}/regras-da-operacao`: `localDoProdutoNaLinha`, a capacidade do local padrão do produto
 * na linha nova da Central de Compras. A chave nasce DESLIGADA (decisão 240 item 4: ligada, a confirmação dá entrada de
 * estoque onde antes não dava); o contrato da chave no startup está em `test/unit/lancamento-01-r2-chave.test.ts`.
 *
 *   LANC-K5  o contrato: SEM a variável (as duas instâncias do harness — o gate da TOP desligado e o ligado, o de
 *            produção) ⇒ `localDoProdutoNaLinha: false` na compra E no pedido; COM a chave (`appCom(…, "1")`) ⇒ `true`;
 *            a chave fica logo depois de `padroes` e ANTES de `regrasGerais`, que continua a ÚLTIMA; o resto da resposta
 *            é IDÊNTICO entre as instâncias; o orçamento de compra (rota que não muda) não a tem em nenhuma;
 *   LANC-K6  o custo: as consultas do handler são as MESMAS, texto a texto e em ordem, com e sem a chave (compra no 5,
 *            compra no 4, pedido no 5) — a chave vem da configuração do processo;
 *   LANC-K7  a 404 e a autorização: outra família, inativa, inexistente, malformado e ausente ⇒ a MESMA 404, corpo
 *            idêntico nas duas instâncias e com as mesmas consultas, sem a chave no corpo; sem `<recurso>.create` ⇒ o
 *            MESMO 403 nas duas, sem tocar a TOP.
 *
 * O QUE CONTA COMO PROVA: os valores são `toBe(false)`/`toBe(true)` (nunca "falsy"); toda igualdade entre as instâncias
 * vem com a premissa de que a diferença existe onde deve (a chave muda de valor) e de que o espião mede (N > 0).
 */

let comChave: FastifyInstance;
let compra5: TopNo5; let compra4: string; let pedido5: TopNo5;

beforeAll(async () => {
  await iniciar();
  // A instância COM a chave: a de produção (o gate da TOP ligado) + a chave. A ÚNICA diferença para `c.ligada` é a chave.
  comChave = await appCom(c.h, { TOP_EFFECTS_RUNTIME_V1_ENABLED: "1", COMPRAS_LOCAL_DO_PRODUTO_ENABLED: "1" });
  const natureza = await cadastroDespesa("Natureza LANC-K"); const centroK = await centro("Centro LANC-K");
  compra5 = await topCompraNo5({ secao: { documentoTroca: false }, padroes: { naturezaId: natureza, centroCustoId: centroK } });
  compra4 = await top(COMPRA, { configuracao: cfg4() });
  pedido5 = await topPedidoNo5(compra5.id, { secao: { provisao: true }, padroes: { naturezaId: natureza, centroCustoId: centroK } });
}, 240_000);
afterAll(async () => { await comChave?.close(); await encerrar(); });

type Seg = "compras" | "pedidos";
/** As chaves de `/regras-da-operacao` de compras, NA ORDEM: a chave nova logo antes de `regrasGerais`, a ÚLTIMA. */
const CHAVES = ["contractVersion", "formato", "exigencias", "condicoesPermitidas", "geraTitulos", "exigeFormaPagamento", "exigeVencimento", "exigeArmazem",
  "secao", "padroes", "localDoProdutoNaLinha", "regrasGerais"];
const CHAVES_DO_ORCAMENTO = ["contractVersion", "formato", "exigencias", "condicoesPermitidas", "geraTitulos", "exigeFormaPagamento", "exigeVencimento", "exigeArmazem"];
const NAO_ACHADA = { error: { code: "NOT_FOUND", message: "Tipo de operação não encontrado" } };

const regras = (app: FastifyInstance, seg: Seg | "orcamentos", q: string, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  app.inject({ method: "GET", url: `/api/compras/${seg}/regras-da-operacao${q}`, headers });
async function ok(r: Promise<Resposta>): Promise<Record<string, unknown>> {
  const x = await r;
  expect(x.statusCode, x.body).toBe(200);
  return j(x);
}
/** As consultas SQL que a requisição dispara: o texto de cada uma, em ordem (o molde do RG-8 e do LANC-I4). */
async function comConsultas<T>(f: () => Promise<T>): Promise<{ r: T; sqls: string[] }> {
  const espiao = vi.spyOn(pg.Client.prototype, "query");
  try {
    const r = await f();
    const sqls = espiao.mock.calls.map((x) => x[0] as unknown).map((x) => (typeof x === "string" ? x : (x as { text?: unknown } | null)?.text))
      .filter((x): x is string => typeof x === "string");
    return { r, sqls };
  } finally { espiao.mockRestore(); }
}
const tocaATop = (sqls: string[]) => sqls.filter((s) => /\berp\.tipos_operacao/.test(s));

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// LANC-K5
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("LANC-K5 o contrato: a capacidade nasce desligada, liga só com a chave, e regrasGerais continua a última", () => {
  it("LANC-K5a sem a variável ⇒ false na compra e no pedido (nas duas instâncias do harness); com a chave ⇒ true; a ordem das chaves; o resto idêntico", async () => {
    expect(process.env.COMPRAS_LOCAL_DO_PRODUTO_ENABLED, "premissa: o processo dos testes não define a chave").toBeUndefined();
    expect([c.h.app.config.COMPRAS_LOCAL_DO_PRODUTO_ENABLED, c.ligada.config.COMPRAS_LOCAL_DO_PRODUTO_ENABLED, comChave.config.COMPRAS_LOCAL_DO_PRODUTO_ENABLED],
      "premissa: as duas instâncias sem a variável estão desligadas; a terceira, ligada").toEqual([false, false, true]);
    expect([c.ligada.config.TOP_EFFECTS_RUNTIME_V1_ENABLED, comChave.config.TOP_EFFECTS_RUNTIME_V1_ENABLED], "premissa: a única diferença entre `ligada` e `comChave` é a chave").toEqual([true, true]);

    let provados = 0;
    for (const [seg, id] of [["compras", compra5.id], ["compras", compra4], ["pedidos", pedido5.id]] as const) {
      const q = `?tipo_operacao_id=${id}`;
      const harness = await ok(regras(c.h.app, seg, q));
      const desligada = await ok(regras(c.ligada, seg, q));
      const ligada = await ok(regras(comChave, seg, q));
      for (const [nome, b] of [["harness", harness], ["ligada (sem a chave)", desligada], ["com a chave", ligada]] as const) {
        expect(Object.keys(b), `${seg} ${id} · ${nome}: a chave logo antes de regrasGerais, que continua a ÚLTIMA`).toEqual(CHAVES);
        expect(Object.keys(b).at(-1), `${seg} · ${nome}`).toBe("regrasGerais");
      }
      expect([harness.localDoProdutoNaLinha, desligada.localDoProdutoNaLinha, ligada.localDoProdutoNaLinha], `${seg} ${id}`).toEqual([false, false, true]);
      // O resto da resposta não depende da chave: a mesma TOP, as mesmas chaves e os mesmos valores.
      expect({ ...ligada, localDoProdutoNaLinha: false }, `${seg} ${id}: só a capacidade muda`).toEqual(desligada);
      provados++;
    }
    expect(provados, "compra no 5, compra no 4 e pedido no 5").toBe(3);
  });

  it("LANC-K5b o orçamento de compra (a rota não muda) não tem a chave — nem com ela ligada", async () => {
    const orc = await top(ORCAMENTO_DE_COMPRA, { configuracao: cfg4() });
    let provados = 0;
    for (const app of [c.ligada, comChave]) {
      const r = await regras(app, "orcamentos", `?tipo_operacao_id=${orc}`);
      expect(r.statusCode, r.body).toBe(200);
      expect(Object.keys(j(r)), "o contrato de hoje do orçamento").toEqual(CHAVES_DO_ORCAMENTO);
      expect(r.body.includes("localDoProdutoNaLinha")).toBe(false);
      provados++;
    }
    expect(provados).toBe(2);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// LANC-K6
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("LANC-K6 a chave não custa consulta", () => {
  it("LANC-K6 as consultas do handler, com e sem a chave, são as MESMAS, texto a texto e em ordem (compra 5, compra 4, pedido 5)", async () => {
    const casos = [["compras", compra5.id, 5], ["compras", compra4, 4], ["pedidos", pedido5.id, 4]] as const;
    // Aquecimento: a primeira requisição de cada instância pode carregar o que as seguintes reaproveitam.
    for (const [seg, id] of casos) { await ok(regras(c.ligada, seg, `?tipo_operacao_id=${id}`)); await ok(regras(comChave, seg, `?tipo_operacao_id=${id}`)); }
    let provados = 0;
    for (const [seg, id, daTop] of casos) {
      const sem = await comConsultas(() => ok(regras(c.ligada, seg, `?tipo_operacao_id=${id}`)));
      const com = await comConsultas(() => ok(regras(comChave, seg, `?tipo_operacao_id=${id}`)));
      expect([sem.r.localDoProdutoNaLinha, com.r.localDoProdutoNaLinha], `premissa (${seg}): a chave muda a resposta`).toEqual([false, true]);
      expect(sem.sqls.length, `${seg}: N > 0, o espião mede`).toBeGreaterThan(0);
      expect(tocaATop(sem.sqls), `premissa (${seg}): as consultas da TOP de hoje (LANC-I4)`).toHaveLength(daTop);
      expect(com.sqls, `${seg} ${id}: as mesmas consultas, na mesma ordem`).toEqual(sem.sqls);
      provados++;
    }
    expect(provados).toBe(3);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// LANC-K7
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("LANC-K7 a 404 e a autorização são as de hoje nas duas instâncias", () => {
  it("LANC-K7a outra família, inativa, inexistente, malformado e ausente ⇒ a MESMA 404 nas duas, corpo idêntico, as mesmas consultas, sem a chave no corpo", async () => {
    const inativa = await top(COMPRA, { configuracao: cfg4() });
    expect((await ok(regras(comChave, "compras", `?tipo_operacao_id=${inativa}`))).localDoProdutoNaLinha, "premissa: antes de inativar, responde (e ligada)").toBe(true);
    expect((await c.admin.query("update erp.tipos_operacao set ativo=false where id=$1", [inativa])).rowCount, "premissa: inativada").toBe(1);
    const casos: [string, Seg, string][] = [];
    for (const seg of ["compras", "pedidos"] as const) {
      casos.push([`${seg}: inexistente`, seg, `?tipo_operacao_id=${randomUUID()}`], [`${seg}: malformado`, seg, "?tipo_operacao_id=nao-e-uuid"], [`${seg}: ausente`, seg, ""]);
    }
    casos.push(["compras: inativa", "compras", `?tipo_operacao_id=${inativa}`],
      ["compras: outra família (pedido de compra)", "compras", `?tipo_operacao_id=${pedido5.id}`],
      ["pedidos: outra família (compra)", "pedidos", `?tipo_operacao_id=${compra5.id}`]);
    const corpos = new Set<string>();
    for (const [nome, seg, q] of casos) {
      const sem = await comConsultas(() => regras(c.ligada, seg, q));
      const com = await comConsultas(() => regras(comChave, seg, q));
      for (const [lado, x] of [["sem a chave", sem], ["com a chave", com]] as const) {
        expect(x.r.statusCode, `${nome} · ${lado} → ${x.r.body}`).toBe(404);
        expect(JSON.parse(x.r.body), `${nome} · ${lado}`).toEqual(NAO_ACHADA);
        expect(x.r.body.includes("localDoProdutoNaLinha"), `${nome} · ${lado}: nada da capacidade na recusa`).toBe(false);
        corpos.add(x.r.body);
      }
      expect(sem.sqls.length, `${nome}: N > 0, o espião mede`).toBeGreaterThan(0);
      expect(com.sqls, `${nome}: as mesmas consultas nas duas instâncias`).toEqual(sem.sqls);
    }
    expect(casos).toHaveLength(9);
    expect(corpos.size, "um corpo só, byte a byte, nas duas instâncias").toBe(1);
  });

  it("LANC-K7b sem a porta operacional ⇒ o MESMO 403 nas duas, sem tocar a TOP; com a porta ⇒ 200 nas duas, e só a capacidade difere", async () => {
    const soVer = await usuario("LANC K7 só ver", ["compras.view", "pedidos_compra.view"]);
    const comprador = await usuario("LANC K7 comprador", ["compras.view", "compras.create", "pedidos_compra.view", "pedidos_compra.create"]);
    let provados = 0;
    for (const [seg, id, permissao] of [["compras", compra5.id, "compras.create"], ["pedidos", pedido5.id, "pedidos_compra.create"]] as const) {
      const q = `?tipo_operacao_id=${id}`;
      const sem = await comConsultas(() => regras(c.ligada, seg, q, soVer));
      const com = await comConsultas(() => regras(comChave, seg, q, soVer));
      for (const x of [sem, com]) {
        expect(x.r.statusCode, x.r.body).toBe(403);
        expect(JSON.parse(x.r.body)).toEqual({ error: { code: "PERMISSION_DENIED", message: `Sem permissão: ${permissao}` } });
        expect(tocaATop(x.sqls), `${seg}: a recusa vem antes de qualquer leitura da TOP`).toEqual([]);
      }
      expect(com.r.body, `${seg}: o mesmo 403, byte a byte`).toBe(sem.r.body);
      const b0 = await ok(regras(c.ligada, seg, q, comprador)); const b1 = await ok(regras(comChave, seg, q, comprador));
      expect([b0.localDoProdutoNaLinha, b1.localDoProdutoNaLinha], `${seg}: o comprador (nenhuma capacidade nova) lê a capacidade`).toEqual([false, true]);
      provados++;
    }
    expect(provados).toBe(2);
  });
});
