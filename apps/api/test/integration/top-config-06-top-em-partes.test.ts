import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * TOP-CONFIG-06 — "EM PARTES" NA ARESTA DA TOP, PELA PORTA DA API.
 *
 * O que precisa ser provado:
 *   1. "Em partes" é gravado POR ARESTA e devolvido como booleano no detalhe e no histórico (FP-11);
 *   2. AUSENTE PRESERVA: o editor anterior manda `{ tipoOperacaoId, ordem }` sem `emPartes`, e isso não
 *      pode desligar em silêncio o que o editor novo ligou — nem criar versão falsa;
 *   3. mudar SÓ a caixa é conteúdo novo (versão N+1);
 *   4. aresta nova sem `emPartes` nasce `false`;
 *   5. valor não booleano é 422;
 *   6. a capability declara `destinos.emPartes = 1` sem mexer em `contractVersion`.
 */
let h: Harness;
let admin: Db;
beforeAll(async () => { h = await harness(); admin = createPool(TEST_URL, { max: 2 }); });
afterAll(async () => { await h.app.close(); await h.db.end(); await admin.end(); });

const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown>;

let seq = 0;
const codigo = () => `26${String(++seq).padStart(2, "0")}`;

async function criarTop(codigoBase: string, nome: string, extra: Record<string, unknown> = {}) {
  const r = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: codigo(), codigoBase, nome, ...extra } });
  expect(r.statusCode, r.body).toBe(201);
  return (j(r) as { id: string }).id;
}
const detalhe = (id: string) => h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${id}`, headers: h.headers() });
const editar = (id: string, corpo: Record<string, unknown>) =>
  h.app.inject({ method: "PUT", url: `/api/admin/tipos-operacao/${id}`, headers: h.headers(), payload: corpo });
const versoes = (id: string) =>
  h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${id}/versoes`, headers: h.headers() });

type Aresta = { tipoOperacaoId: string; emPartes: boolean };
const arestas = async (id: string) => (j(await detalhe(id)).destinos as Aresta[]);

/** A coluna como o BANCO a guarda, na versão corrente — testemunha fora da rota. */
async function emPartesNoBanco(origem: string) {
  const r = await admin.query<{ destino: string; em_partes: boolean }>(
    `select d.destino_tipo_operacao_id as destino, d.em_partes
       from erp.tipos_operacao_versao_destinos d
       join erp.tipos_operacao_versoes v on v.id = d.origem_versao_id
       join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.versao_atual = v.versao
      where t.id = $1 order by d.ordem`, [origem]);
  return r.rows;
}

describe("TOP-CONFIG-06 — capability", () => {
  it("destinos declara emPartes = 1 e contractVersion continua 1", async () => {
    const d = j(await h.app.inject({ method: "GET", url: "/api/admin/tipos-operacao/capabilities", headers: h.headers() }));
    expect(d.contractVersion).toBe(1);
    expect(d.destinos).toMatchObject({ suportado: true, emPartes: 1 });
  });
});

describe("TOP-CONFIG-06 — Em partes por aresta", () => {
  it("FP-11 — 'Em partes' é gravado por aresta e o GET o devolve booleano", async () => {
    const pedido = await criarTop("vendas.pedido", "Pedido em partes");
    const venda = await criarTop("vendas.venda", "Venda inteira");
    const orc = await criarTop("vendas.orcamento", "Orçamento misto", { destinos: [
      { tipoOperacaoId: pedido, ordem: 0, emPartes: true },
      { tipoOperacaoId: venda, ordem: 1 }
    ] });
    expect((await arestas(orc)).map((a) => [a.tipoOperacaoId, a.emPartes])).toEqual([[pedido, true], [venda, false]]);
    expect(await emPartesNoBanco(orc)).toEqual([{ destino: pedido, em_partes: true }, { destino: venda, em_partes: false }]);
    const hist = j(await versoes(orc)).items as { destinos: Aresta[] }[];
    expect(hist[0]!.destinos.map((a) => a.emPartes)).toEqual([true, false]);
  });

  it("AUSENTE PRESERVA — PUT do editor anterior (sem emPartes) mantém true e NÃO cria versão", async () => {
    const pedido = await criarTop("vendas.pedido", "Pedido preservado");
    const orc = await criarTop("vendas.orcamento", "Orçamento web novo",
      { destinos: [{ tipoOperacaoId: pedido, ordem: 0, emPartes: true }] });
    const antes = j(await detalhe(orc));
    const r = await editar(orc, { destinos: [{ tipoOperacaoId: pedido, ordem: 0 }], revisao: antes.revisao });
    expect(r.statusCode, r.body).toBe(200);
    const depois = j(await detalhe(orc));
    expect([depois.versao, depois.revisao], "nem versão, nem revisão").toEqual([antes.versao, antes.revisao]);
    expect((depois.destinos as Aresta[])[0]!.emPartes, "ausente não é 'desligue'").toBe(true);
    expect(await emPartesNoBanco(orc)).toEqual([{ destino: pedido, em_partes: true }]);

    // Mudança de NOME pelo editor anterior, com a lista sem emPartes: versão nova, e a caixa continua ligada.
    const r2 = await editar(orc, { nome: "Renomeado", destinos: [{ tipoOperacaoId: pedido, ordem: 0 }], revisao: antes.revisao });
    expect(r2.statusCode, r2.body).toBe(200);
    expect(j(await detalhe(orc)).versao).toBe((antes.versao as number) + 1);
    expect(await emPartesNoBanco(orc)).toEqual([{ destino: pedido, em_partes: true }]);

    // `destinos` ausente inteiro: as arestas preservadas mantêm o valor.
    const r3 = await editar(orc, { nome: "Renomeado de novo", revisao: j(await detalhe(orc)).revisao });
    expect(r3.statusCode, r3.body).toBe(200);
    expect(await emPartesNoBanco(orc)).toEqual([{ destino: pedido, em_partes: true }]);
  });

  it("mudar SÓ a caixa cria versão N+1; reenviar o mesmo valor explícito é no-op", async () => {
    const pedido = await criarTop("vendas.pedido", "Pedido caixa");
    const orc = await criarTop("vendas.orcamento", "Orçamento caixa", { destinos: [{ tipoOperacaoId: pedido, ordem: 0 }] });
    const v1 = j(await detalhe(orc));
    const liga = await editar(orc, { destinos: [{ tipoOperacaoId: pedido, ordem: 0, emPartes: true }], revisao: v1.revisao });
    expect(liga.statusCode, liga.body).toBe(200);
    const v2 = j(await detalhe(orc));
    expect(v2.versao).toBe((v1.versao as number) + 1);
    expect((v2.destinos as Aresta[])[0]!.emPartes).toBe(true);

    const igual = await editar(orc, { destinos: [{ tipoOperacaoId: pedido, ordem: 0, emPartes: true }], revisao: v2.revisao });
    expect(igual.statusCode, igual.body).toBe(200);
    const aposIgual = j(await detalhe(orc));
    expect([aposIgual.versao, aposIgual.revisao]).toEqual([v2.versao, v2.revisao]);

    const desliga = await editar(orc, { destinos: [{ tipoOperacaoId: pedido, ordem: 0, emPartes: false }], revisao: v2.revisao });
    expect(desliga.statusCode, desliga.body).toBe(200);
    const v3 = j(await detalhe(orc));
    expect(v3.versao).toBe((v2.versao as number) + 1);
    expect((v3.destinos as Aresta[])[0]!.emPartes).toBe(false);
  });

  it("aresta NOVA sem emPartes nasce false, mesmo com outra aresta ligada", async () => {
    const pedido = await criarTop("vendas.pedido", "Pedido ligado");
    const venda = await criarTop("vendas.venda", "Venda nova");
    const orc = await criarTop("vendas.orcamento", "Orçamento cresce",
      { destinos: [{ tipoOperacaoId: pedido, ordem: 0, emPartes: true }] });
    const r = await editar(orc, { destinos: [{ tipoOperacaoId: pedido, ordem: 0 }, { tipoOperacaoId: venda, ordem: 1 }],
      revisao: j(await detalhe(orc)).revisao });
    expect(r.statusCode, r.body).toBe(200);
    expect(await emPartesNoBanco(orc)).toEqual([{ destino: pedido, em_partes: true }, { destino: venda, em_partes: false }]);
  });

  it("emPartes não booleano é 422 e nada muda", async () => {
    const pedido = await criarTop("vendas.pedido", "Pedido recusa");
    const orc = await criarTop("vendas.orcamento", "Orçamento recusa", { destinos: [{ tipoOperacaoId: pedido, ordem: 0 }] });
    const antes = j(await detalhe(orc));
    for (const emPartes of ["true", 1, null, {}]) {
      const r = await editar(orc, { destinos: [{ tipoOperacaoId: pedido, ordem: 0, emPartes }], revisao: antes.revisao });
      expect(r.statusCode, JSON.stringify(emPartes)).toBe(422);
      expect((j(r).error as { code: string }).code).toBe("TIPO_OPERACAO_DESTINO_INVALIDO");
    }
    const depois = j(await detalhe(orc));
    expect([depois.versao, depois.revisao]).toEqual([antes.versao, antes.revisao]);
    expect(await emPartesNoBanco(orc)).toEqual([{ destino: pedido, em_partes: false }]);
  });
});
