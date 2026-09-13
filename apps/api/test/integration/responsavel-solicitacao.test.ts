import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * RESPONSÁVEL DA SOLICITAÇÃO DE COMPRA: MEMBRO + CAPACIDADE + EMPRESA (PRE-BASE2-02).
 *
 * `POST /supply/requests/:id/transfer` recebia um UUID e gravava. A única prova exigida era a chave
 * estrangeira para `erp.users` — a tabela GLOBAL de identidades: ela diz que o UUID é alguém, não que é
 * alguém DESTA organização. E a leitura da solicitação devolve `current_responsible_name` num
 * `left join erp.users` igualmente sem filtro de organização, então o nome do usuário escolhido voltava no
 * corpo da resposta. Junto, isso é um ORÁCULO DE IDENTIDADE entre tenants: quem tem uma solicitação e um
 * UUID descobre o NOME do dono daquele UUID em qualquer outra empresa do sistema.
 *
 * A sentinela existe para provar isso de forma não-circular: o nome só pode aparecer se tiver VAZADO, e o
 * teste confere antes que ele realmente existe no banco — senão "não encontrei o nome" não provaria nada.
 */
const SENTINELA = "SENTINELA-USUARIO-OUTRO-TENANT";
const ORG2 = "eeeeeeee-0000-4000-8000-000000000002";
const USUARIO_OUTRO_TENANT = "eeeeeeee-0000-4000-8000-000000000012";
const FANTASMA = "eeeeeeee-0000-4000-8000-0000000000ff";

type Hdr = Record<string, string>;
const j = (r: { json: () => unknown }) => r.json() as Record<string, string>;

describe("integridade cross-tenant do responsável de solicitação de compra", () => {
  let h: Harness;
  let I: Awaited<ReturnType<typeof ids>>;
  let valido = "", semCapacidade = "", semEscopo = "", inativo = "";
  let solA = "", solA2 = "", solB = "";

  /** Cria papel + membro na organização DEMO e devolve o id do USUÁRIO. */
  const criarMembro = async (nome: string, email: string, perms: string[], empresas: string[], ativo = true) => {
    const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: nome, permissions: perms } });
    expect(papel.statusCode, papel.body).toBe(201);
    const membro = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: {
      name: nome, email, password: "Resp@12345", role_id: j(papel).id, is_active: ativo,
      escopos_empresas: [{ modulo: "compras", modo: "selecionadas", empresas }] } });
    expect(membro.statusCode, membro.body).toBe(201);
    const id = j(membro).id; expect(id, membro.body).toBeTruthy();
    return id!;
  };

  /** Solicitação de compra na empresa pedida, criada pelo administrador. */
  const criarSolicitacao = async (empresa: string, descricao: string) => {
    const r = await h.app.inject({ method: "POST", url: "/api/supply/requests", headers: h.headers(), payload: {
      farm_id: empresa, request_date: new Date().toISOString().slice(0, 10), request_type: "product",
      description: descricao, justification: descricao, items: [{ description: "Item", quantity: "1", reference_value: "10" }] } });
    expect(r.statusCode, r.body).toBe(201);
    const id = j(r).id; expect(id, r.body).toBeTruthy();
    return id!;
  };

  const responsavelNoBanco = async (id: string) => {
    const c = createPool(TEST_URL, { max: 1 });
    const r = await c.query<{ resp: string | null; v: number }>("select current_responsible_user_id resp, version v from erp.purchase_requests where id=$1", [id]);
    await c.end();
    return r.rows[0]!;
  };

  const transferir = (id: string, responsavel: string, hdr: Hdr = h.headers()) =>
    h.app.inject({ method: "POST", url: `/api/supply/requests/${id}/transfer`, headers: hdr, payload: { responsible_user_id: responsavel, justification: "transferência" } });

  beforeAll(async () => {
    h = await harness(); I = await ids(h);

    // OUTRO TENANT: organização real, usuário real, vínculo ativo — tudo válido, só que lá.
    const c = createPool(TEST_URL, { max: 1 });
    await c.query("insert into erp.organizations(id,name,slug) values ($1,'[TEST] Outro Tenant','outro-tenant')", [ORG2]);
    await c.query("insert into erp.users(id,email,name,password_hash) values ($1,'sentinela@outro.local',$2,'x')", [USUARIO_OUTRO_TENANT, SENTINELA]);
    await c.query("insert into erp.organization_members(organization_id,user_id,is_owner,is_active) values ($1,$2,true,true)", [ORG2, USUARIO_OUTRO_TENANT]);
    await c.end();

    valido = await criarMembro("Resp válido", "resp-valido@demo.local", ["purchase_requests.view"], [I.farm]);
    semCapacidade = await criarMembro("Resp sem capacidade", "resp-sem-cap@demo.local", ["stocks.view"], [I.farm]);
    semEscopo = await criarMembro("Resp sem escopo", "resp-sem-escopo@demo.local", ["purchase_requests.view"], [I.farm2]);
    inativo = await criarMembro("Resp inativo", "resp-inativo@demo.local", ["purchase_requests.view"], [I.farm], false);

    solA = await criarSolicitacao(I.farm, "Solicitação Empresa A");
    solA2 = await criarSolicitacao(I.farm, "Solicitação Empresa A (lote)");
    solB = await criarSolicitacao(I.farm2, "Solicitação Empresa B");
  }, 180_000);

  afterAll(async () => { await h.app.close(); await h.db.end(); });

  it("a sentinela EXISTE no banco — senão 'o nome não apareceu' não provaria nada", async () => {
    const c = createPool(TEST_URL, { max: 1 });
    const r = await c.query<{ name: string }>("select name from erp.users where id=$1", [USUARIO_OUTRO_TENANT]);
    await c.end();
    expect(r.rows[0]?.name).toBe(SENTINELA);
  });

  // §16 — o vetor principal
  it("recusa transferir para usuário de OUTRA organização, sem alterar o registro", async () => {
    const antes = await responsavelNoBanco(solA);
    const r = await transferir(solA, USUARIO_OUTRO_TENANT);
    expect(r.statusCode, r.body).toBe(422);
    const depois = await responsavelNoBanco(solA);
    expect(depois.resp).toBe(antes.resp);
    expect(depois.v, "sem UPDATE significa sem incremento de versão").toBe(antes.v);
  });

  it("a transferência recusada não registra evento", async () => {
    const c = createPool(TEST_URL, { max: 1 });
    const r = await c.query<{ n: string }>("select count(*) n from erp.purchase_request_events where request_id=$1 and action='transfer'", [solA]);
    await c.end();
    expect(r.rows[0]!.n).toBe("0");
  });

  // §21 — o oráculo de nome, fechado
  it("o nome do usuário do outro tenant NÃO aparece em resposta nenhuma", async () => {
    const recusa = await transferir(solA, USUARIO_OUTRO_TENANT);
    const detalhe = await h.app.inject({ method: "GET", url: `/api/supply/requests/${solA}`, headers: h.headers() });
    const lista = await h.app.inject({ method: "GET", url: "/api/supply/requests", headers: h.headers() });
    expect(detalhe.statusCode).toBe(200); expect(lista.statusCode).toBe(200);
    for (const corpo of [recusa.body, detalhe.body, lista.body]) expect(corpo).not.toContain(SENTINELA);
  });

  // §17 — anti-enumeração: cinco motivos diferentes, uma resposta só
  it("UUID inexistente, outro tenant, membro inativo, sem capacidade e sem escopo respondem IGUAL", async () => {
    const casos: [string, string][] = [
      ["UUID inexistente", FANTASMA],
      ["usuário de outro tenant", USUARIO_OUTRO_TENANT],
      ["membro inativo", inativo],
      ["membro sem purchase_requests.view", semCapacidade],
      ["membro sem acesso à empresa em Compras", semEscopo]
    ];
    const respostas: { caso: string; status: number; code: string; message: string }[] = [];
    for (const [caso, alvo] of casos) {
      const r = await transferir(solA, alvo);
      const b = r.json() as { error?: { code?: string; message?: string } };
      respostas.push({ caso, status: r.statusCode, code: b.error?.code ?? "", message: b.error?.message ?? "" });
    }
    const primeira = respostas[0]!;
    expect(primeira.status).toBe(422);
    expect(primeira.code).toBe("VALIDATION_ERROR");
    expect(primeira.message).toBe("Responsável não pode ser atribuído a esta solicitação.");
    for (const r of respostas) {
      expect(r.status, `status diferente em: ${r.caso}`).toBe(primeira.status);
      expect(r.code, `código diferente em: ${r.caso}`).toBe(primeira.code);
      expect(r.message, `mensagem diferente em: ${r.caso}`).toBe(primeira.message);
    }
  });

  // §18 — o caso legítimo continua funcionando (senão a guarda seria só uma porta fechada)
  it("transfere para membro ativo, com capacidade e com acesso à empresa", async () => {
    const r = await transferir(solA, valido);
    expect(r.statusCode, r.body).toBe(200);
    expect((await responsavelNoBanco(solA)).resp).toBe(valido);
    const detalhe = await h.app.inject({ method: "GET", url: `/api/supply/requests/${solA}`, headers: h.headers() });
    const d = detalhe.json() as { current_responsible_user_id: string; current_responsible_name: string; events: { action: string }[] };
    expect(d.current_responsible_user_id).toBe(valido);
    expect(d.current_responsible_name).toBe("Resp válido");
    expect(d.events.some((e) => e.action === "transfer")).toBe(true);
  });

  // §19 — lote é tudo ou nada
  it("lote com uma solicitação inelegível não transfere NENHUMA", async () => {
    const antesA = await responsavelNoBanco(solA2);
    const antesB = await responsavelNoBanco(solB);
    // `valido` enxerga a Empresa A em Compras, mas não a Empresa B: o lote inteiro tem de cair.
    const r = await h.app.inject({ method: "POST", url: "/api/supply/requests/transfer-batch", headers: h.headers(),
      payload: { ids: [solA2, solB], responsible_user_id: valido, justification: "lote" } });
    expect(r.statusCode, r.body).toBe(422);
    expect((await responsavelNoBanco(solA2)).resp, "a primeira do lote não pode ter sido transferida").toBe(antesA.resp);
    expect((await responsavelNoBanco(solB)).resp).toBe(antesB.resp);
    const c = createPool(TEST_URL, { max: 1 });
    const ev = await c.query<{ n: string }>("select count(*) n from erp.purchase_request_events where request_id = any($1) and action='transfer'", [[solA2, solB]]);
    await c.end();
    expect(ev.rows[0]!.n, "nenhum evento de transferência pode ter sobrevivido ao rollback").toBe("0");
  });

  it("lote com todas as solicitações elegíveis transfere todas", async () => {
    const r = await h.app.inject({ method: "POST", url: "/api/supply/requests/transfer-batch", headers: h.headers(),
      payload: { ids: [solA, solA2], responsible_user_id: valido, justification: "lote ok" } });
    expect(r.statusCode, r.body).toBe(200);
    expect((await responsavelNoBanco(solA)).resp).toBe(valido);
    expect((await responsavelNoBanco(solA2)).resp).toBe(valido);
  });

  // §20 — a porta de AÇÃO também aceita responsible_user_id, e também é uma escrita
  it("a ação do workflow recusa responsible_user_id de outro tenant e não muda a situação", async () => {
    const c = createPool(TEST_URL, { max: 1 });
    const antes = (await c.query<{ status: string }>("select status from erp.purchase_requests where id=$1", [solB])).rows[0]!.status;
    await c.end();
    const r = await h.app.inject({ method: "POST", url: `/api/supply/requests/${solB}/actions/submit`, headers: h.headers(),
      payload: { justification: "encaminhar", responsible_user_id: USUARIO_OUTRO_TENANT } });
    expect(r.statusCode, r.body).toBe(422);
    expect(r.body).not.toContain(SENTINELA);
    const c2 = createPool(TEST_URL, { max: 1 });
    const depois = (await c2.query<{ status: string; resp: string | null }>("select status, current_responsible_user_id resp from erp.purchase_requests where id=$1", [solB])).rows[0]!;
    await c2.end();
    expect(depois.status, "transição recusada não pode ter mudado a situação").toBe(antes);
    expect(depois.resp).not.toBe(USUARIO_OUTRO_TENANT);
  });

  it("a ação do workflow aceita responsible_user_id elegível", async () => {
    const r = await h.app.inject({ method: "POST", url: `/api/supply/requests/${solA}/actions/submit`, headers: h.headers(),
      payload: { justification: "encaminhar", responsible_user_id: valido } });
    expect(r.statusCode, r.body).toBe(200);
    expect((await responsavelNoBanco(solA)).resp).toBe(valido);
  });
});
