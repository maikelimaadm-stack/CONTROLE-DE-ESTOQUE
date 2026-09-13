import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * COMPATIBILIDADE FAZENDA → EMPRESA NA BORDA (PRE-BASE2-03, docs/DEPLOYMENT.md).
 *
 * Banco, API (Railway) e web (Vercel) sobem em momentos diferentes. Enquanto a janela de rollout estiver
 * aberta, as duas combinações abaixo precisam funcionar, e é isso que este arquivo prova com requisições
 * reais — não com uma leitura do adaptador:
 *
 *   CENÁRIO A  API nova + web ANTIGO  → cabeçalho, corpo e query legados continuam sendo aceitos, e a
 *                                        resposta continua trazendo os campos legados.
 *   CENÁRIO B  API ANTERIOR + web novo → o web envia os dois cabeçalhos com o mesmo valor e lê
 *                                        `empresas ?? farms`; aqui provamos o lado que a API nova controla.
 *
 * A regra de conflito é a mesma nos três pontos: só canônico passa, só legado passa, os dois IGUAIS passam,
 * os dois DIFERENTES são recusados. Escolher um em silêncio gravaria a empresa que o cliente não pediu.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
type Hdr = Record<string, string>;
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { items?: Record<string, unknown>[]; error?: { code: string; message: string }; id?: string };

beforeAll(async () => { h = await harness(); I = await ids(h); admin = createPool(TEST_URL, { max: 2 }); }, 180_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

const comCabecalhos = (extra: Hdr) => ({ authorization: `Bearer ${h.token}`, "x-org-id": h.demo.orgId, ...extra });
const listar = (extra: Hdr = {}) => h.app.inject({ method: "GET", url: "/api/resources/warehouses", headers: comCabecalhos(extra) });

describe("cabeçalho de empresa selecionada", () => {
  it("X-Empresa-Id sozinho funciona", async () => { expect((await listar({ "x-empresa-id": I.farm })).statusCode).toBe(200); });
  it("X-Farm-Id sozinho continua funcionando (cliente da versão anterior)", async () => { expect((await listar({ "x-farm-id": I.farm })).statusCode).toBe(200); });
  it("os dois com o MESMO valor funcionam — é o que o web novo envia", async () => {
    expect((await listar({ "x-empresa-id": I.farm, "x-farm-id": I.farm })).statusCode).toBe(200);
  });
  it("os dois com valores DIFERENTES são recusados com 422, sem escolher um deles", async () => {
    const r = await listar({ "x-empresa-id": I.farm, "x-farm-id": I.farm2 });
    expect(r.statusCode).toBe(422);
    expect(j(r).error?.code).toBe("VALIDATION_ERROR");
    expect(j(r).error?.message).toContain("X-Empresa-Id");
  });
  it("identificador malformado é 422 do cliente, não 500 do servidor", async () => {
    // Antes seguia até o PostgreSQL e voltava como "invalid input syntax for uuid" dentro de um 500 —
    // erro de servidor para o que é erro de requisição, com mensagem interna no corpo.
    for (const cabecalho of ["x-empresa-id", "x-farm-id"]) {
      const r = await listar({ [cabecalho]: "nao-e-um-uuid" });
      expect(r.statusCode, cabecalho).toBe(422);
      expect(j(r).error?.message, cabecalho).not.toContain("invalid input syntax");
    }
  });
  it("empresa fora do escopo continua sendo 403 (seleção explícita do cliente)", async () => {
    const outra = await admin.query<{ id: string }>("insert into erp.organizations(name,slug) values ('[TEST] Compat','compat-org') returning id");
    const emp = await admin.query<{ id: string }>("insert into erp.empresas(organization_id,code,name) values ($1,7,'De outro tenant') returning id", [outra.rows[0]!.id]);
    const r = await listar({ "x-empresa-id": emp.rows[0]!.id });
    expect(r.statusCode).toBe(403);
  });
});

describe("corpo do lançamento nos dois idiomas", () => {
  // Solicitação de compra: lançamento real, com empresa obrigatória e sem dependência de saldo de estoque
  // (o que aqui se testa é o CONTRATO da empresa, não a regra do módulo).
  const criar = (corpo: Record<string, unknown>) =>
    h.app.inject({ method: "POST", url: "/api/supply/requests", headers: comCabecalhos({}), payload: {
      request_date: "2026-09-10", request_type: "product", description: "compat", justification: "compat",
      items: [{ description: "item", quantity: "1", reference_value: "1" }], ...corpo } });

  it("empresa_id sozinho", async () => { const r = await criar({ empresa_id: I.farm }); expect(r.statusCode, r.body).toBe(201); });
  it("farm_id sozinho (cliente da versão anterior)", async () => { const r = await criar({ farm_id: I.farm }); expect(r.statusCode, r.body).toBe(201); });
  it("os dois iguais", async () => { const r = await criar({ empresa_id: I.farm, farm_id: I.farm }); expect(r.statusCode, r.body).toBe(201); });
  it("os dois DIFERENTES: 422, e nada é gravado", async () => {
    const antes = await admin.query<{ n: string }>("select count(*) n from erp.purchase_requests where organization_id=$1", [h.demo.orgId]);
    const r = await criar({ empresa_id: I.farm, farm_id: I.farm2 });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error?.message).toContain("empresa_id");
    const depois = await admin.query<{ n: string }>("select count(*) n from erp.purchase_requests where organization_id=$1", [h.demo.orgId]);
    expect(depois.rows[0]!.n).toBe(antes.rows[0]!.n);
  });
  it("o valor gravado é o mesmo pelos dois caminhos, e as duas colunas ficam iguais no banco", async () => {
    const r = await criar({ farm_id: I.farm2 });
    expect(r.statusCode, r.body).toBe(201);
    const linha = await admin.query<{ empresa_id: string; farm_id: string }>(
      "select empresa_id, farm_id from erp.purchase_requests where id=$1", [j(r).id]);
    expect(linha.rows[0]!.empresa_id).toBe(I.farm2);
    expect(linha.rows[0]!.farm_id, "o espelho de compatibilidade acompanha").toBe(I.farm2);
  });
});

describe("filtros e nomes de coluna que viajam como DADO", () => {
  it("distinct aceita o nome legado do campo (link salvo, cliente anterior)", async () => {
    const legado = await h.app.inject({ method: "GET", url: "/api/resources/warehouses/distinct?field=farm_id", headers: comCabecalhos({}) });
    const canonico = await h.app.inject({ method: "GET", url: "/api/resources/warehouses/distinct?field=empresa_id", headers: comCabecalhos({}) });
    expect(legado.statusCode, legado.body).toBe(200);
    expect(canonico.statusCode).toBe(200);
    expect(legado.body).toBe(canonico.body);
  });
  it("filtro por coluna aceita a chave legada `farm_id__eq`", async () => {
    const legado = await h.app.inject({ method: "GET", url: `/api/resources/warehouses?farm_id__eq=${I.farm}`, headers: comCabecalhos({}) });
    const canonico = await h.app.inject({ method: "GET", url: `/api/resources/warehouses?empresa_id__eq=${I.farm}`, headers: comCabecalhos({}) });
    expect(legado.statusCode, legado.body).toBe(200);
    expect(j(legado).total).toBe(j(canonico).total);
  });
});

describe("resposta: o cliente antigo continua encontrando o que procura", () => {
  it("/auth/context devolve `empresas` (canônico) e `farms` (legado) com a MESMA lista", async () => {
    const r = await h.app.inject({ method: "GET", url: "/api/auth/context", headers: comCabecalhos({}) });
    const c = j(r) as unknown as { empresas: { id: string }[]; farms: { id: string }[] };
    expect(c.empresas.length).toBeGreaterThan(0);
    expect(c.farms.map((f) => f.id)).toEqual(c.empresas.map((f) => f.id));
  });
  it("linhas de listagem trazem empresa_id E farm_id, com o mesmo valor", async () => {
    const r = await listar();
    const linha = (j(r).items ?? [])[0]!;
    expect(linha["empresa_id"]).toBeTruthy();
    expect(linha["farm_id"], "apelido legado ao lado do canônico").toBe(linha["empresa_id"]);
    expect(linha["empresa_name"] ?? null, "o rótulo também tem os dois nomes").toBe(linha["farm_name"] ?? null);
  });
  it("o aliasador NÃO entra em valor opaco do usuário", async () => {
    // `extra` é jsonb livre do usuário. Um `empresa_id` lá dentro é dado dele, não pedido de empresa:
    // acrescentar um irmão `farm_id` seria a API decidindo o conteúdo de um campo livre.
    const sol = await h.app.inject({ method: "POST", url: "/api/supply/requests", headers: comCabecalhos({}), payload: {
      empresa_id: I.farm, request_date: "2026-09-10", request_type: "product", description: "op", justification: "op",
      items: [{ description: "item", quantity: "1", reference_value: "1", extra: { empresa_id: "valor-do-usuario" } }] } });
    expect(sol.statusCode, sol.body).toBe(201);
    const det = await h.app.inject({ method: "GET", url: `/api/supply/requests/${j(sol).id}`, headers: comCabecalhos({}) });
    const item = ((j(det).items ?? [])[0] ?? {}) as Record<string, unknown>;
    const extra = (item["extra"] ?? {}) as Record<string, unknown>;
    expect(extra["empresa_id"]).toBe("valor-do-usuario");
    expect(extra["farm_id"], "nada foi acrescentado dentro do jsonb do usuário").toBeUndefined();
  });
});

describe("nome legado de tabela/entidade", () => {
  it("anexo enviado com entity legado chega ao mesmo registro", async () => {
    const empresa = (await admin.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code limit 1", [h.demo.orgId])).rows[0]!.id;
    const corpo = (entity: string) => ({ entity, entity_id: empresa, file_name: `${entity}.txt`, mime_type: "text/plain", data_base64: Buffer.from("ok").toString("base64") });
    const legado = await h.app.inject({ method: "POST", url: "/api/attachments", headers: comCabecalhos({}), payload: corpo("farms") });
    const canonico = await h.app.inject({ method: "POST", url: "/api/attachments", headers: comCabecalhos({}), payload: corpo("empresas") });
    expect(legado.statusCode, legado.body).toBe(201);
    expect(canonico.statusCode, canonico.body).toBe(201);
  });
});
