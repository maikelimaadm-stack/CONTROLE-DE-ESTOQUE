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

/**
 * CADASTRO DE EMPRESA — o cadastro que a própria renomeação quebrou.
 *
 * `erp.empresas.code` é `int not null` e não vem do cliente (campo `readOnly`). Quem o gerava era um caso
 * especial em `createOne` comparando `def.key === "farms"`. A renomeação trocou a chave do recurso para
 * `empresas` e a comparação virou letra morta EM SILÊNCIO: o INSERT passou a sair sem `code` e a violar o
 * NOT NULL. Nenhum teste cobria a criação da empresa, então a suíte seguiu verde.
 */
describe("cadastro de Empresa", () => {
  const criar = (url: string, nome: string) => h.app.inject({
    method: "POST", url, headers: comCabecalhos({ "content-type": "application/json" }),
    payload: { name: nome, is_active: true }
  });

  it("POST na rota CANÔNICA cria a empresa e gera o código", async () => {
    const r = await criar("/api/resources/empresas", "[TEST] Empresa Canônica");
    expect(r.statusCode, JSON.stringify(j(r))).toBe(201);
    const b = j(r);
    expect(b.id, "a empresa foi persistida").toBeTruthy();
    expect(Number(b["code"]), "o código foi gerado pela sequência").toBeGreaterThan(0);
  });

  it("POST na rota LEGADA cria do mesmo jeito — é a mesma tela e o mesmo registro", async () => {
    const r = await criar("/api/resources/farms", "[TEST] Empresa Legada");
    expect(r.statusCode, JSON.stringify(j(r))).toBe(201);
    expect(Number(j(r)["code"])).toBeGreaterThan(0);
  });

  it("a rota canônica consegue RELER o que acabou de criar", async () => {
    const criada = j(await criar("/api/resources/empresas", "[TEST] Empresa Releitura"));
    const r = await h.app.inject({ method: "GET", url: `/api/resources/empresas/${criada.id}`, headers: comCabecalhos({}) });
    expect(r.statusCode).toBe(200);
    expect(j(r)["name"]).toBe("[TEST] Empresa Releitura");
  });

  it("as duas rotas usam UMA sequência: os códigos não se repetem", async () => {
    const a = Number(j(await criar("/api/resources/empresas", "[TEST] Seq A"))["code"]);
    const b = Number(j(await criar("/api/resources/farms", "[TEST] Seq B"))["code"]);
    expect(b, "numerar por duas chaves daria o mesmo código a empresas diferentes").not.toBe(a);
  });
});

/**
 * QUEM PODE CRIAR EMPRESA — e por que a pergunta precisa ser feita ANTES do INSERT.
 *
 * `erp.empresas` é o único cadastro cuja RLS de LEITURA depende do escopo de empresa do próprio membro, e a
 * empresa recém-criada não está no escopo de ninguém. Sem uma regra explícita, um membro de escopo PARCIAL
 * inseria a linha (o `with check` da política é só de tenant), o `getOne` do create não a encontrava, a rota
 * respondia 404 e a transação voltava atrás: o cadastro "não salvava" sem nenhuma mensagem que explicasse.
 *
 * A regra é a MESMA pergunta que o `using` da política faz (`erp.escopo_empresa_total(null)`): escopo total
 * em ALGUM módulo. Quem passa nela cria e consegue reler; quem não passa recebe uma recusa explícita. Nada
 * de auto-concessão de escopo — ninguém passa a enxergar empresa que não enxergava.
 */
describe("criar Empresa exige alcance de organização", () => {
  const senha = "Demo@12345";
  let parcial = ""; let total = "";

  beforeAll(async () => {
    const hash = (await admin.query<{ password_hash: string }>("select password_hash from erp.users where email='operador@demo.local'")).rows[0]!.password_hash;
    const papel = (await admin.query<{ id: string }>("insert into erp.roles(organization_id,name) values ($1,'[TEST] Cadastra Empresa') returning id", [h.demo.orgId])).rows[0]!.id;
    await admin.query("insert into erp.role_permissions(role_id,permission_key) values ($1,'farms.create'),($1,'farms.view'),($1,'farms.edit')", [papel]);
    const criar = async (email: string, modo: string) => {
      const u = (await admin.query<{ id: string }>("insert into erp.users(email,name,password_hash) values ($1,$2,$3) returning id", [email, email, hash])).rows[0]!.id;
      const m = (await admin.query<{ id: string }>("insert into erp.organization_members(organization_id,user_id,role_id,is_owner,is_active) values ($1,$2,$3,false,true) returning id", [h.demo.orgId, u, papel])).rows[0]!.id;
      await admin.query("insert into erp.membro_escopos_empresa(organization_id,membro_id,modulo,modo) values ($1,$2,'estoque',$3)", [h.demo.orgId, m, modo]);
      if (modo === "selecionadas") await admin.query("insert into erp.membro_empresas(organization_id,membro_id,modulo,modo,empresa_id) values ($1,$2,'estoque','selecionadas',$3)", [h.demo.orgId, m, I.farm]);
      const r = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: senha } });
      return (r.json() as { token: string }).token;
    };
    parcial = await criar("parcial-empresa@demo.local", "selecionadas");
    total = await criar("total-empresa@demo.local", "todas");
  }, 60_000);

  const post = (token: string, nome: string) => h.app.inject({
    method: "POST", url: "/api/resources/empresas",
    headers: { authorization: `Bearer ${token}`, "x-org-id": h.demo.orgId, "content-type": "application/json" },
    payload: { name: nome, is_active: true }
  });

  it("membro com escopo PARCIAL é recusado com mensagem, não com 404 depois de inserir", async () => {
    const r = await post(parcial, "[TEST] Nao deveria existir");
    expect(r.statusCode, JSON.stringify(j(r))).toBe(422);
    expect(j(r).error?.message).toContain("organização inteira");
    const sobrou = await admin.query("select 1 from erp.empresas where name='[TEST] Nao deveria existir'");
    expect(sobrou.rowCount, "nada pode ter ficado no banco").toBe(0);
  });

  it("membro com escopo TOTAL em algum módulo cria e consegue reler", async () => {
    const r = await post(total, "[TEST] Empresa por nao-owner");
    expect(r.statusCode, JSON.stringify(j(r))).toBe(201);
    expect(Number(j(r)["code"])).toBeGreaterThan(0);
  });
});
