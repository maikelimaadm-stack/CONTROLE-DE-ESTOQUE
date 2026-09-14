import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * CONTRATO DE EMPRESA NA BORDA DA API — CANÔNICO (PRE-BASE2-05B).
 *
 * Este arquivo substitui a prova da ponte (`compat-empresa.test.ts`), que certificava a TRADUÇÃO do nome
 * anterior. A tradução acabou; o que precisa de prova agora é o contrato único, e ele tem dois lados:
 *
 *   POSITIVO  o canônico funciona ponta a ponta — cabeçalho, corpo, filtro, nome de coluna como dado,
 *             recurso, entidade de anexo e escopo administrativo;
 *   NEGATIVO  o contrato anterior é RECUSADO, com erro de validação — nunca traduzido, e nunca ignorado.
 *
 * O lado negativo é o que exige requisição real. Um teste de unidade sobre o guard provaria que a função
 * recusa; só a requisição inteira prova que nada ANTES dela promove o nome antigo e nada DEPOIS o descarta
 * em silêncio — e é o descarte silencioso, não a tradução, que mudaria a empresa da operação sem avisar.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
type Hdr = Record<string, string>;
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { items?: Record<string, unknown>[]; error?: { code: string; message: string }; id?: string };

beforeAll(async () => { h = await harness(); I = await ids(h); admin = createPool(TEST_URL, { max: 2 }); }, 180_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

const comCabecalhos = (extra: Hdr) => ({ authorization: `Bearer ${h.token}`, "x-org-id": h.demo.orgId, ...extra });
const listar = (extra: Hdr = {}) => h.app.inject({ method: "GET", url: "/api/resources/warehouses", headers: comCabecalhos(extra) });
const url = (u: string) => h.app.inject({ method: "GET", url: u, headers: comCabecalhos({}) });
const recusa = (r: { statusCode: number; json: () => unknown }, onde: string) => {
  expect(r.statusCode, onde).toBe(422);
  expect(j(r).error?.code, onde).toBe("VALIDATION_ERROR");
};

describe("cabeçalho de empresa selecionada", () => {
  it("X-Empresa-Id é o cabeçalho da empresa selecionada", async () => {
    expect((await listar({ "x-empresa-id": I.empresa })).statusCode).toBe(200);
  });

  /**
   * O cabeçalho anterior não é ignorado, é RECUSADO — e a diferença importa justamente porque ignorar
   * PARECE seguro. Sem cabeçalho de empresa a leitura abre para todas as empresas permitidas no módulo:
   * um cliente que pedisse o recorte da empresa A receberia silenciosamente A + B + C. Ler um pedido de
   * recorte como ausência de recorte é ampliar escopo sem ninguém perceber.
   *
   * No navegador o CORS já barra o cabeçalho. Esta guarda é para quem não passa por CORS: script, curl,
   * integração.
   */
  it("o cabeçalho ANTERIOR é recusado, e nenhuma consulta de negócio roda", async () => {
    const r = await listar({ "x-farm-id": I.empresa });
    recusa(r, "x-farm-id");
    expect(j(r).error?.message).toContain("X-Empresa-Id");
    expect(j(r).items, "nada de negócio foi respondido").toBeUndefined();
  });

  it("o cabeçalho anterior é recusado MESMO acompanhado do canônico com o mesmo valor", async () => {
    // Não existe mais "os dois iguais passam": havia UM contrato bilíngue, agora há um contrato só.
    recusa(await listar({ "x-empresa-id": I.empresa, "x-farm-id": I.empresa }), "canônico + anterior");
  });

  it("identificador malformado é 422 do cliente, não 500 do servidor", async () => {
    // Antes seguia até o PostgreSQL e voltava como "invalid input syntax for uuid" dentro de um 500 —
    // erro de servidor para o que é erro de requisição, com mensagem interna no corpo. Correção canônica.
    const r = await listar({ "x-empresa-id": "nao-e-um-uuid" });
    recusa(r, "malformado");
    expect(j(r).error?.message).not.toContain("invalid input syntax");
  });

  it("empresa fora do escopo continua sendo 403 (seleção explícita do cliente)", async () => {
    const outra = await admin.query<{ id: string }>("insert into erp.organizations(name,slug) values ('[TEST] Contrato','contrato-org') returning id");
    const emp = await admin.query<{ id: string }>("insert into erp.empresas(organization_id,code,name) values ($1,7,'De outro tenant') returning id", [outra.rows[0]!.id]);
    expect((await listar({ "x-empresa-id": emp.rows[0]!.id })).statusCode).toBe(403);
  });
});

describe("corpo do lançamento", () => {
  // Solicitação de compra: lançamento real, com empresa obrigatória e sem dependência de saldo de estoque
  // (o que aqui se testa é o CONTRATO da empresa, não a regra do módulo).
  const criar = (corpo: Record<string, unknown>) =>
    h.app.inject({ method: "POST", url: "/api/supply/requests", headers: comCabecalhos({}), payload: {
      request_date: "2026-09-10", request_type: "product", description: "contrato", justification: "contrato",
      items: [{ description: "item", quantity: "1", reference_value: "1" }], ...corpo } });

  it("empresa_id é aceito e gravado", async () => {
    const r = await criar({ empresa_id: I.empresa });
    expect(r.statusCode, r.body).toBe(201);
    const linha = await admin.query<{ empresa_id: string }>("select empresa_id from erp.purchase_requests where id=$1", [j(r).id]);
    expect(linha.rows[0]!.empresa_id).toBe(I.empresa);
  });

  /**
   * ESTE é o teste que justifica a lápide existir. Os schemas de entrada são `z.object`, que DESCARTA chave
   * desconhecida: sem a recusa, `farm_id: <empresa B>` sumiria e a solicitação seria criada na empresa do
   * CONTEXTO. O cliente pediu B, o servidor gravaria em A, e nada apareceria — até o relatório.
   */
  it("campo de empresa do contrato ANTERIOR é recusado, e NADA é gravado", async () => {
    const antes = await admin.query<{ n: string }>("select count(*) n from erp.purchase_requests where organization_id=$1", [h.demo.orgId]);
    const r = await criar({ farm_id: I.empresa2 });
    recusa(r, "farm_id no corpo");
    expect(j(r).error?.message).toContain("farm_id");
    const depois = await admin.query<{ n: string }>("select count(*) n from erp.purchase_requests where organization_id=$1", [h.demo.orgId]);
    expect(depois.rows[0]!.n, "a recusa acontece antes de qualquer escrita").toBe(antes.rows[0]!.n);
  });

  it("campo anterior enviado JUNTO do canônico também é recusado — não é 'o canônico vence'", async () => {
    recusa(await criar({ empresa_id: I.empresa, farm_id: I.empresa }), "canônico + anterior");
  });

  it("os nomes de origem/destino do contrato anterior também são recusados", async () => {
    for (const campo of ["origin_farm_id", "destination_farm_id"]) {
      recusa(await criar({ empresa_id: I.empresa, [campo]: I.empresa2 }), campo);
    }
  });

  /**
   * O limite é deliberado: a lápide olha só o NÍVEL DE CIMA. `extra` é jsonb livre do usuário — um
   * `farm_id` lá dentro é DADO dele, não pedido de empresa, e recusá-lo seria a API opinando sobre o
   * conteúdo de um campo que ela prometeu não interpretar.
   */
  it("nome antigo DENTRO de valor opaco do usuário não é recusado nem tocado", async () => {
    const r = await criar({ empresa_id: I.empresa, items: [{ description: "item", quantity: "1", reference_value: "1", extra: { farm_id: "valor-do-usuario" } }] });
    expect(r.statusCode, r.body).toBe(201);
    const det = await url(`/api/supply/requests/${j(r).id}`);
    const item = ((j(det).items ?? [])[0] ?? {}) as Record<string, unknown>;
    expect(((item["extra"] ?? {}) as Record<string, unknown>)["farm_id"]).toBe("valor-do-usuario");
  });
});

describe("query: filtro, campo e ordenação", () => {
  it("o canônico funciona nas três formas", async () => {
    expect((await url(`/api/resources/warehouses?empresa_id__eq=${I.empresa}`)).statusCode).toBe(200);
    expect((await url("/api/resources/warehouses/distinct?field=empresa_id")).statusCode).toBe(200);
    expect((await url("/api/resources/warehouses?sort=empresa_id")).statusCode).toBe(200);
  });

  /**
   * Três formas de o nome viajar na query, e as três são recusadas. A do meio é a mais perigosa: um
   * `farm_id__eq` descartado em silêncio devolveria a lista SEM o recorte pedido — mais linhas do que o
   * cliente pediu, o que é ampliação de escopo disfarçada de resposta normal.
   */
  it("o contrato anterior é recusado como chave de filtro, como campo e como ordenação", async () => {
    recusa(await url(`/api/resources/warehouses?farm_id__eq=${I.empresa}`), "farm_id__eq");
    recusa(await url("/api/resources/warehouses/distinct?field=farm_id"), "field=farm_id");
    recusa(await url("/api/resources/warehouses?sort=farm_id"), "sort=farm_id");
  });

  it("o filtro canônico realmente filtra — a recusa acima não é 'tudo dá erro'", async () => {
    const tudo = await url("/api/resources/warehouses");
    const so = await url(`/api/resources/warehouses?empresa_id__eq=${I.empresa}`);
    expect(so.statusCode).toBe(200);
    expect(Number(j(so).total)).toBeLessThanOrEqual(Number(j(tudo).total));
  });
});

describe("resposta canônica", () => {
  it("/auth/context devolve `empresas` e NÃO devolve o apelido anterior", async () => {
    const c = j(await url("/api/auth/context")) as unknown as { empresas: { id: string }[]; farms?: unknown };
    expect(c.empresas.length).toBeGreaterThan(0);
    expect(c.farms, "o apelido de resposta saiu com o aliasador").toBeUndefined();
  });

  it("linhas de listagem trazem só o nome canônico, inclusive no rótulo", async () => {
    const linha = (j(await listar()).items ?? [])[0]!;
    expect(linha["empresa_id"]).toBeTruthy();
    expect(linha["farm_id"], "nenhum apelido é acrescentado na saída").toBeUndefined();
    expect(linha["farm_id_label"]).toBeUndefined();
  });
});

describe("recurso e entidade de anexo", () => {
  it("o recurso canônico `empresas` resolve", async () => {
    expect((await url("/api/resources/empresas/definition")).statusCode).toBe(200);
  });

  it("a chave de recurso anterior NÃO resolve mais (404, não um segundo recurso)", async () => {
    const r = await url("/api/resources/farms/definition");
    expect(r.statusCode, r.body).toBe(404);
  });

  it("anexo: entidade canônica é aceita; a anterior é recusada, não traduzida", async () => {
    const empresa = (await admin.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code limit 1", [h.demo.orgId])).rows[0]!.id;
    const corpo = (entity: string) => ({ entity, entity_id: empresa, file_name: `${entity}.txt`, mime_type: "text/plain", data_base64: Buffer.from("ok").toString("base64") });
    const canonico = await h.app.inject({ method: "POST", url: "/api/attachments", headers: comCabecalhos({}), payload: corpo("empresas") });
    expect(canonico.statusCode, canonico.body).toBe(201);
    const anterior = await h.app.inject({ method: "POST", url: "/api/attachments", headers: comCabecalhos({}), payload: corpo("farms") });
    recusa(anterior, "entity=farms");
    expect(j(anterior).error?.message).toContain("anexos");
  });
});

/**
 * CADASTRO DE EMPRESA — o cadastro que a própria renomeação quebrou.
 *
 * `erp.empresas.code` é `int not null` e não vem do cliente (campo `readOnly`). Quem o gerava era um caso
 * especial em `createOne` comparando a chave do recurso; a renomeação trocou a chave e a comparação virou
 * letra morta EM SILÊNCIO, com o INSERT violando o NOT NULL. Nenhum teste cobria a criação da empresa, e a
 * suíte seguiu verde. A cobertura fica — a rota anterior é que saiu.
 */
describe("cadastro de Empresa", () => {
  const criar = (nome: string) => h.app.inject({
    method: "POST", url: "/api/resources/empresas", headers: comCabecalhos({ "content-type": "application/json" }),
    payload: { name: nome, is_active: true }
  });

  it("cria a empresa e gera o código", async () => {
    const r = await criar("[TEST] Empresa Canônica");
    expect(r.statusCode, JSON.stringify(j(r))).toBe(201);
    expect(j(r).id, "a empresa foi persistida").toBeTruthy();
    expect(Number(j(r)["code"]), "o código foi gerado pela sequência").toBeGreaterThan(0);
  });

  it("consegue RELER o que acabou de criar", async () => {
    const criada = j(await criar("[TEST] Empresa Releitura"));
    const r = await url(`/api/resources/empresas/${criada.id}`);
    expect(r.statusCode).toBe(200);
    expect(j(r)["name"]).toBe("[TEST] Empresa Releitura");
  });

  /**
   * A SEQUÊNCIA não foi reiniciada por PRE-BASE2-05B. A chave persistida continua sendo a antiga
   * (`lib/sequencia-empresa.ts`) exatamente para isto: trocá-la sem migrar a linha de `erp.code_sequences`
   * faria o contador recomeçar do zero e dar a uma empresa nova o código de uma que já existe. A troca é
   * atômica com o `update`, na PRE-BASE2-05C.
   */
  it("a numeração CONTINUA de onde estava: o próximo código é maior que o último existente", async () => {
    const maiorAntes = Number((await admin.query<{ m: string | null }>(
      "select max(code)::text m from erp.empresas where organization_id=$1", [h.demo.orgId])).rows[0]!.m ?? 0);
    const a = Number(j(await criar("[TEST] Seq A"))["code"]);
    const b = Number(j(await criar("[TEST] Seq B"))["code"]);
    expect(a, "sequência reiniciada daria um código já usado").toBeGreaterThan(maiorAntes);
    expect(b).toBeGreaterThan(a);
  });
});

/**
 * QUEM PODE CRIAR EMPRESA — e por que a pergunta precisa ser feita ANTES do INSERT.
 *
 * `erp.empresas` é o único cadastro cuja RLS de LEITURA depende do escopo de empresa do próprio membro, e a
 * empresa recém-criada não está no escopo de ninguém. Sem uma regra explícita, um membro de escopo PARCIAL
 * inseria a linha (o `with check` da política é só de tenant), o `getOne` do create não a encontrava, a rota
 * respondia 404 e a transação voltava atrás: o cadastro "não salvava" sem nenhuma mensagem que explicasse.
 */
describe("criar Empresa exige alcance de organização", () => {
  const senha = "Demo@12345";
  let parcial = ""; let total = "";

  beforeAll(async () => {
    const hash = (await admin.query<{ password_hash: string }>("select password_hash from erp.users where email='operador@demo.local'")).rows[0]!.password_hash;
    const papel = (await admin.query<{ id: string }>("insert into erp.roles(organization_id,name) values ($1,'[TEST] Cadastra Empresa') returning id", [h.demo.orgId])).rows[0]!.id;
    // As CHAVES DE PERMISSÃO do servidor não foram renomeadas em 05B: são contrato próprio, com perfis já
    // gravados no banco de cada cliente. Renomeá-las junto com o fio quebraria a autorização de quem já tem
    // perfil salvo — é decisão separada, e não é desta fase.
    await admin.query("insert into erp.role_permissions(role_id,permission_key) values ($1,'farms.create'),($1,'farms.view'),($1,'farms.edit')", [papel]);
    const criar = async (email: string, modo: string) => {
      const u = (await admin.query<{ id: string }>("insert into erp.users(email,name,password_hash) values ($1,$2,$3) returning id", [email, email, hash])).rows[0]!.id;
      const m = (await admin.query<{ id: string }>("insert into erp.organization_members(organization_id,user_id,role_id,is_owner,is_active) values ($1,$2,$3,false,true) returning id", [h.demo.orgId, u, papel])).rows[0]!.id;
      await admin.query("insert into erp.membro_escopos_empresa(organization_id,membro_id,modulo,modo) values ($1,$2,'estoque',$3)", [h.demo.orgId, m, modo]);
      if (modo === "selecionadas") await admin.query("insert into erp.membro_empresas(organization_id,membro_id,modulo,modo,empresa_id) values ($1,$2,'estoque','selecionadas',$3)", [h.demo.orgId, m, I.empresa]);
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
