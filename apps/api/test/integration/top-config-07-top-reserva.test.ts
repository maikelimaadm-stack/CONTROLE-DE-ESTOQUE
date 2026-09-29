import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * TOP-CONFIG-07 — "RESERVAR ESTOQUE" NA VERSÃO DA TOP, PELA PORTA DA API (contrato §3 A3).
 *
 * O que precisa ser provado:
 *   1. RE-10 — a caixa é gravada POR VERSÃO: POST com `true` → versão 1 `true`; PUT sem o campo (só o nome)
 *      → versão 2 continua `true` (AUSENTE PRESERVA); PUT com `false` → versão 3 `false`; PUT com o mesmo
 *      valor e nada mais → nenhuma versão nova (no-op, nem revisão);
 *   2. `true` fora da família do pedido (venda, orçamento, estoque) → 422 VALIDATION_ERROR no campo, e
 *      nenhuma TOP nem versão nasce; `false` é aceito em qualquer família;
 *   3. a capability declara `reservaEstoque: 1` sem mexer em `contractVersion`;
 *   4. detalhe e histórico devolvem o booleano DAQUELA versão; o histórico marca `estoque` quando a caixa muda;
 *   5. a trilha do update registra o antes e o depois quando muda, e só então.
 *
 * TESTEMUNHA FORA DA ROTA: a coluna é lida direto da tabela (conexão de observação), nunca só pelo que a
 * rota conta. Prefixo de código de TOP: 373.
 */
let h: Harness;
let admin: Db;
beforeAll(async () => { h = await harness(); admin = createPool(TEST_URL, { max: 2 }); });
afterAll(async () => { await h.app.close(); await h.db.end(); await admin.end(); });

const PEDIDO = "vendas.pedido";
const MENSAGEM = "Só a operação de pedido reserva estoque.";

const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown>;
const erro = (r: { json: () => unknown }) => (r.json() as { error: { code: string; message: string; details: unknown } }).error;

let seq = 0;
const codigo = () => `373${String(++seq).padStart(2, "0")}`;

const criar = (codigoBase: string, nome: string, extra: Record<string, unknown> = {}) =>
  h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: codigo(), codigoBase, nome, ...extra } });
async function criarTop(codigoBase: string, nome: string, extra: Record<string, unknown> = {}) {
  const r = await criar(codigoBase, nome, extra);
  expect(r.statusCode, r.body).toBe(201);
  return (j(r) as { id: string }).id;
}
const detalhe = async (id: string) => {
  const r = await h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${id}`, headers: h.headers() });
  expect(r.statusCode, r.body).toBe(200);
  return j(r);
};
const editar = (id: string, corpo: Record<string, unknown>) =>
  h.app.inject({ method: "PUT", url: `/api/admin/tipos-operacao/${id}`, headers: h.headers(), payload: corpo });
type ItemHistorico = { versao: number; nome: string; reservaEstoque: boolean; secoesAlteradas: string[] | null };
const historico = async (id: string) => {
  const r = await h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${id}/versoes`, headers: h.headers() });
  expect(r.statusCode, r.body).toBe(200);
  return j(r).items as ItemHistorico[];
};

/** TODAS as versões da TOP como o BANCO as guarda — testemunha fora da rota. */
async function versoesNoBanco(id: string) {
  return (await admin.query<{ versao: number; reserva_estoque: boolean }>(
    "select versao, reserva_estoque from erp.tipos_operacao_versoes where tipo_operacao_id = $1 order by versao", [id])).rows;
}
/** A versão corrente e a revisão, lidas da TABELA do pai. */
async function paiNoBanco(id: string) {
  const r = await admin.query<{ versao_atual: number; revisao: number }>(
    "select versao_atual, revisao from erp.tipos_operacao where id = $1", [id]);
  expect(r.rows, "o pai existe").toHaveLength(1);
  return r.rows[0]!;
}
async function trilha(id: string) {
  return (await admin.query<{ action: string; metadata: Record<string, unknown> | null }>(
    "select action, metadata from erp.audit_logs where entity='tipos_operacao' and entity_id=$1 order by created_at, id", [id])).rows;
}
const contarTopsDoCodigo = async (cod: string) => Number((await admin.query<{ n: string }>(
  "select count(*) n from erp.tipos_operacao where organization_id = $1 and codigo = $2", [h.demo.orgId, cod])).rows[0]!.n);

describe("TOP-CONFIG-07 — capability", () => {
  it("declara reservaEstoque = 1 na raiz e contractVersion continua 1", async () => {
    const r = await h.app.inject({ method: "GET", url: "/api/admin/tipos-operacao/capabilities", headers: h.headers() });
    expect(r.statusCode, r.body).toBe(200);
    const d = j(r);
    expect(d.reservaEstoque).toBe(1);
    expect(d.contractVersion).toBe(1);
    // Os blocos anteriores continuam lá (aditivo, não substituto).
    expect(d.destinos).toMatchObject({ suportado: true, emPartes: 1 });
    expect(d.restricoes).toEqual({ suportado: true, versaoSchema: 3 });
  });
});

describe("TOP-CONFIG-07 — RE-10: 'Reservar estoque' gravado por versão", () => {
  it("RE-10 POST true → v1 true; PUT sem o campo → v2 true; PUT false → v3 false; mesmo valor → sem versão nova", async () => {
    const id = await criarTop(PEDIDO, "Pedido que reserva", { reservaEstoque: true });

    // v1: a rota e o banco dizem a mesma coisa.
    const v1 = await detalhe(id);
    expect([v1.versao, v1.reservaEstoque]).toEqual([1, true]);
    expect(await versoesNoBanco(id)).toEqual([{ versao: 1, reserva_estoque: true }]);

    // v2: o editor ANTERIOR (sem a chave) muda só o nome — AUSENTE PRESERVA.
    const r2 = await editar(id, { nome: "Pedido que reserva (renomeado)", revisao: v1.revisao });
    expect(r2.statusCode, r2.body).toBe(200);
    const v2 = await detalhe(id);
    expect([v2.versao, v2.reservaEstoque], "ausente não é 'desligue'").toEqual([2, true]);
    expect(await versoesNoBanco(id)).toEqual([
      { versao: 1, reserva_estoque: true }, { versao: 2, reserva_estoque: true }]);

    // v3: PRESENTE declara — mudar SÓ a caixa é conteúdo novo.
    const r3 = await editar(id, { reservaEstoque: false, revisao: v2.revisao });
    expect(r3.statusCode, r3.body).toBe(200);
    const v3 = await detalhe(id);
    expect([v3.versao, v3.reservaEstoque, v3.nome]).toEqual([3, false, "Pedido que reserva (renomeado)"]);
    expect(await versoesNoBanco(id)).toEqual([
      { versao: 1, reserva_estoque: true }, { versao: 2, reserva_estoque: true }, { versao: 3, reserva_estoque: false }]);

    // Mesmo valor, nada mais: no-op — nem versão, nem revisão, nem evento.
    const eventos = (await trilha(id)).length;
    const pai = await paiNoBanco(id);
    const r4 = await editar(id, { reservaEstoque: false, revisao: v3.revisao });
    expect(r4.statusCode, r4.body).toBe(200);
    expect(j(r4)).toMatchObject({ versao: 3, revisao: v3.revisao });
    expect(await paiNoBanco(id), "nem versão, nem revisão").toEqual(pai);
    expect(await versoesNoBanco(id)).toHaveLength(3);
    expect((await trilha(id)).length, "nenhum evento novo na trilha").toBe(eventos);

    // Religar pela caixa também cria versão (false → true).
    const r5 = await editar(id, { reservaEstoque: true, revisao: v3.revisao });
    expect(r5.statusCode, r5.body).toBe(200);
    expect((await detalhe(id)).versao).toBe(4);
    expect((await versoesNoBanco(id)).at(-1)).toEqual({ versao: 4, reserva_estoque: true });
  });

  it("histórico: cada versão devolve o SEU valor, e a mudança da caixa marca a seção 'estoque'", async () => {
    const id = await criarTop(PEDIDO, "Pedido histórico", { reservaEstoque: true });
    expect((await editar(id, { nome: "Pedido histórico 2", revisao: (await detalhe(id)).revisao })).statusCode).toBe(200);
    expect((await editar(id, { reservaEstoque: false, revisao: (await detalhe(id)).revisao })).statusCode).toBe(200);

    const itens = await historico(id);
    expect(itens.map((x) => [x.versao, x.reservaEstoque])).toEqual([[3, false], [2, true], [1, true]]);
    expect(itens.map((x) => typeof x.reservaEstoque)).toEqual(["boolean", "boolean", "boolean"]);
    expect(itens[0]!.secoesAlteradas, "só a caixa mudou: a seção é estoque").toEqual(["estoque"]);
    expect(itens[1]!.secoesAlteradas, "só o nome mudou: nenhuma seção").toEqual([]);
    expect(itens[2]!.secoesAlteradas, "a primeira versão não tem com o que comparar").toBeNull();
  });

  it("trilha do update: antes e depois quando a caixa muda; nada quando não muda", async () => {
    const id = await criarTop(PEDIDO, "Pedido trilha", { reservaEstoque: true });
    const create = (await trilha(id)).find((x) => x.action === "create");
    expect(create?.metadata?.reservaEstoque).toBe(true);

    expect((await editar(id, { nome: "Pedido trilha 2", revisao: (await detalhe(id)).revisao })).statusCode).toBe(200);
    expect((await editar(id, { reservaEstoque: false, revisao: (await detalhe(id)).revisao })).statusCode).toBe(200);

    const updates = (await trilha(id)).filter((x) => x.action === "update");
    expect(updates).toHaveLength(2);
    expect(updates[0]!.metadata, "renomear não fala da reserva").not.toHaveProperty("reservaEstoque");
    expect(updates[0]!.metadata!.secoesAlteradas).toEqual([]);
    expect(updates[1]!.metadata!.reservaEstoque).toEqual({ antes: true, depois: false });
    expect(updates[1]!.metadata!.secoesAlteradas).toEqual(["estoque"]);
  });

  it("POST sem o campo nasce false (a web anterior não manda a chave)", async () => {
    const id = await criarTop(PEDIDO, "Pedido sem a chave");
    expect((await detalhe(id)).reservaEstoque).toBe(false);
    expect(await versoesNoBanco(id)).toEqual([{ versao: 1, reserva_estoque: false }]);
  });

  it("valor não booleano é 422 e nada muda", async () => {
    const id = await criarTop(PEDIDO, "Pedido recusa tipo", { reservaEstoque: true });
    const antes = await paiNoBanco(id);
    for (const reservaEstoque of ["true", 1, null, {}]) {
      const r = await editar(id, { reservaEstoque, revisao: antes.revisao });
      expect(r.statusCode, JSON.stringify(reservaEstoque)).toBe(422);
      expect(erro(r).code).toBe("VALIDATION_ERROR");
    }
    expect(await paiNoBanco(id)).toEqual(antes);
    expect(await versoesNoBanco(id)).toEqual([{ versao: 1, reserva_estoque: true }]);
  });
});

describe("TOP-CONFIG-07 — só a família do pedido reserva", () => {
  for (const familia of ["vendas.venda", "vendas.orcamento", "estoque.baixa"]) {
    it(`POST true em ${familia} → 422 no campo, e nenhuma TOP nem versão nasce`, async () => {
      const versoesAntes = Number((await admin.query<{ n: string }>(
        "select count(*) n from erp.tipos_operacao_versoes where organization_id = $1", [h.demo.orgId])).rows[0]!.n);
      const cod = codigo();
      const r = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
        payload: { codigo: cod, codigoBase: familia, nome: `Recusada ${familia}`, reservaEstoque: true } });
      expect(r.statusCode, r.body).toBe(422);
      expect(erro(r)).toEqual({ code: "VALIDATION_ERROR", message: MENSAGEM, details: [{ path: "reservaEstoque", message: MENSAGEM }] });
      expect(await contarTopsDoCodigo(cod), "nenhuma TOP nasceu").toBe(0);
      expect(Number((await admin.query<{ n: string }>(
        "select count(*) n from erp.tipos_operacao_versoes where organization_id = $1", [h.demo.orgId])).rows[0]!.n),
        "nenhuma versão nasceu").toBe(versoesAntes);
    });

    it(`PUT true em ${familia} → 422 no campo, e nenhuma versão nova; false é aceito (no-op)`, async () => {
      const id = await criarTop(familia, `TOP ${familia}`, { reservaEstoque: false });
      const antes = await paiNoBanco(id);
      const eventos = (await trilha(id)).length;

      const r = await editar(id, { reservaEstoque: true, revisao: antes.revisao });
      expect(r.statusCode, r.body).toBe(422);
      expect(erro(r)).toEqual({ code: "VALIDATION_ERROR", message: MENSAGEM, details: [{ path: "reservaEstoque", message: MENSAGEM }] });
      // Junto com uma mudança legítima também: a recusa é do pedido inteiro.
      const r2 = await editar(id, { nome: "Renomeada junto", reservaEstoque: true, revisao: antes.revisao });
      expect(r2.statusCode, r2.body).toBe(422);
      expect(await paiNoBanco(id), "nem versão, nem revisão").toEqual(antes);
      expect(await versoesNoBanco(id)).toEqual([{ versao: 1, reserva_estoque: false }]);
      expect((await trilha(id)).length).toBe(eventos);

      // `false` explícito fora do pedido é o padrão: aceito, e sem mudança é no-op.
      const ok = await editar(id, { reservaEstoque: false, revisao: antes.revisao });
      expect(ok.statusCode, ok.body).toBe(200);
      expect(await paiNoBanco(id)).toEqual(antes);
      expect((await detalhe(id)).reservaEstoque).toBe(false);
    });
  }
});
