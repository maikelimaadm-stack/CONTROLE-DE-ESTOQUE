import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, seedDemo, type Db } from "@agro/db";
import { LAYOUT_DO_SISTEMA } from "@agro/domain";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * VENDAS-A3-1 · cadastro do LAYOUT DO DOCUMENTO (LD-A1..A4) — /api/admin/layouts-documento, com a validação da
 * estrutura do domínio antes do banco e as garantias da 0032 (padrão único por família, família da TOP, RLS) como rede.
 */
let h: Harness; let admin: Db;
type Resp = { statusCode: number; body: string };
const j = (r: Resp) => JSON.parse(r.body);
const hdr = () => h.headers({ "content-type": "application/json" });
const URL_ = "/api/admin/layouts-documento";
const req = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) =>
  h.app.inject({ method, url, headers: payload === undefined ? h.headers() : hdr(), ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
const criar = (payload: Record<string, unknown>) => req("POST", URL_, payload);
const detalhes = (r: Resp) => (j(r).error?.details ?? []) as { path: string; message: string }[];
const linha = async (id: string) => (await admin.query("select * from erp.layouts_documento where id=$1", [id])).rows[0] as Record<string, unknown>;
let seq = 0;
const nomeUnico = (p: string) => `${p} ${++seq}`;
let topSeq = 60;
let orgB: { orgId: string; headers: Record<string, string> } | null = null;
/** Segunda organização REAL (seed + login), para criar TOP dela pela API. */
async function outraOrg() {
  if (orgB) return orgB;
  const o = await seedDemo(admin, { orgName: "[TEST] Org Layout", adminEmail: "admin-layout@demo.local", adminPassword: "Demo@12345", slug: "orglayout" }, () => {});
  const tok = j(await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin-layout@demo.local", password: "Demo@12345" } })).token as string;
  orgB = { orgId: o.orgId, headers: { authorization: `Bearer ${tok}`, "x-org-id": o.orgId } };
  return orgB;
}
async function criarTop(codigoBase: string, headers = h.headers()): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers, payload: { codigo: `L${++topSeq}`, codigoBase, nome: `TOP ${codigoBase} ${topSeq}` } });
  if (r.statusCode !== 201) throw new Error(r.body);
  return j(r).id as string;
}
const trilha = async (id: string) => (await admin.query<{ action: string; metadata: Record<string, unknown> | null }>(
  "select action, metadata from erp.audit_logs where entity='layouts_documento' and entity_id=$1 order by created_at, id", [id])).rows;

beforeAll(async () => { h = await harness(); admin = createPool(TEST_URL, { max: 2 }); }, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("LD-A1 CRUD, código gerado, duplicar, recusas", () => {
  it("cria sem estrutura (= layout do sistema), lê, edita, desativa, exclui (lógico) — auditando cada escrita", async () => {
    const r = await criar({ nome: nomeUnico("Venda balcão"), familia: "vendas.venda" });
    expect(r.statusCode, r.body).toBe(201);
    const id = j(r).id as string;
    const l = await linha(id);
    expect(l).toMatchObject({ organization_id: h.demo.orgId, familia: "vendas.venda", padrao: false, is_active: true, deleted_at: null });
    expect(String(l["code"])).toMatch(/^\d+$/);
    expect(l["estrutura"]).toEqual(LAYOUT_DO_SISTEMA("vendas.venda"));

    const g = await req("GET", `${URL_}/${id}`);
    expect(g.statusCode, g.body).toBe(200);
    expect(j(g)).toMatchObject({ id, code: l["code"], familia: "vendas.venda", estrutura: LAYOUT_DO_SISTEMA("vendas.venda"), tops: [] });

    const est = LAYOUT_DO_SISTEMA("vendas.venda");
    est.cabecalho[0] = { ...est.cabecalho[0]!, rotulo: "Rótulo novo" };
    const e = await req("PUT", `${URL_}/${id}`, { nome: "Venda balcão editada", estrutura: est });
    expect(e.statusCode, e.body).toBe(200);
    expect(await linha(id)).toMatchObject({ nome: "Venda balcão editada", estrutura: est, code: l["code"] });

    const lista = await req("GET", `${URL_}?familia=vendas.venda`);
    expect(lista.statusCode, lista.body).toBe(200);
    expect(j(lista).items).toContainEqual(expect.objectContaining({ id, nome: "Venda balcão editada", qtdTops: 0 }));
    expect((j(lista).items as { familia: string }[]).every((x) => x.familia === "vendas.venda")).toBe(true);
    expect((await req("GET", `${URL_}?familia=estoque.baixa`)).statusCode).toBe(422);

    expect((await req("POST", `${URL_}/${id}/ativo`, { ativo: false })).statusCode).toBe(200);
    expect((await linha(id))["is_active"]).toBe(false);
    const d = await req("DELETE", `${URL_}/${id}`);
    expect(d.statusCode, d.body).toBe(200);
    expect((await linha(id))["deleted_at"]).not.toBeNull();
    expect((await req("GET", `${URL_}/${id}`)).statusCode).toBe(404);
    expect((await req("PUT", `${URL_}/${id}`, { nome: "x" })).statusCode).toBe(404);
    expect((await trilha(id)).map((x) => x.action)).toEqual(["create", "update", "deactivate", "delete"]);
  });

  it("id malformado e id inexistente → a mesma 404", async () => {
    const a = await req("GET", `${URL_}/nao-e-uuid`);
    const b = await req("GET", `${URL_}/00000000-0000-4000-8000-000000000000`);
    expect([a.statusCode, b.statusCode]).toEqual([404, 404]);
    expect(j(a).error).toEqual(j(b).error);
  });

  it("código gerado e sequencial; corpo com code → 422; chave desconhecida → 422", async () => {
    const a = j(await criar({ nome: nomeUnico("Seq"), familia: "vendas.pedido" }));
    const b = j(await criar({ nome: nomeUnico("Seq"), familia: "vendas.pedido" }));
    expect(Number(b.code)).toBe(Number(a.code) + 1);
    const c = await criar({ code: "999", nome: nomeUnico("Com código"), familia: "vendas.pedido" });
    expect(c.statusCode, c.body).toBe(422);
    expect(detalhes(c).map((d) => d.path)).toEqual(["code"]);
    const x = await criar({ nome: nomeUnico("Extra"), familia: "vendas.pedido", padrao: true });
    expect(x.statusCode, x.body).toBe(422);
  });

  it("nome duplicado entre vivos → 409; excluído libera o nome", async () => {
    const nome = nomeUnico("Duplicado");
    const a = await criar({ nome, familia: "vendas.orcamento" });
    expect(a.statusCode, a.body).toBe(201);
    const b = await criar({ nome: nome.toUpperCase(), familia: "vendas.venda" });
    expect(b.statusCode, b.body).toBe(409);
    await req("DELETE", `${URL_}/${j(a).id}`);
    expect((await criar({ nome, familia: "vendas.orcamento" })).statusCode).toBe(201);
  });

  it("estrutura inválida → 422 VALIDATION_ERROR no caminho (regra do domínio e forma)", async () => {
    const est = LAYOUT_DO_SISTEMA("vendas.venda");
    est.cabecalho.push({ campo: "campo_que_nao_existe", obrigatorio: false, editavel: true });
    const r = await criar({ nome: nomeUnico("Inválido"), familia: "vendas.venda", estrutura: est });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error.code).toBe("VALIDATION_ERROR");
    expect(detalhes(r)).toEqual([expect.objectContaining({ path: `cabecalho[${est.cabecalho.length - 1}].campo` })]);
    const forma = await criar({ nome: nomeUnico("Forma"), familia: "vendas.venda", estrutura: { versaoSchema: 1, cabecalho: "x", rodape: [], itens: [] } });
    expect(forma.statusCode, forma.body).toBe(422);
    expect(detalhes(forma).map((d) => d.path)).toEqual(["estrutura.cabecalho"]);
  });

  it("duplicar: código novo, nome '(cópia)' único, não padrão, sem TOPs", async () => {
    const nome = nomeUnico("Original");
    const o = j(await criar({ nome, familia: "vendas.orcamento" }));
    expect((await req("POST", `${URL_}/${o.id}/padrao`)).statusCode).toBe(200);
    const top = await criarTop("vendas.orcamento");
    expect((await req("PUT", `${URL_}/${o.id}/tops`, { tipoOperacaoIds: [top] })).statusCode).toBe(200);
    const c1 = await req("POST", `${URL_}/${o.id}/duplicar`);
    expect(c1.statusCode, c1.body).toBe(201);
    const c2 = j(await req("POST", `${URL_}/${o.id}/duplicar`));
    expect(j(c1).nome).toBe(`${nome} (cópia)`);
    expect(c2.nome).toBe(`${nome} (cópia 2)`);
    const l = await linha(j(c1).id);
    expect(l).toMatchObject({ padrao: false, familia: "vendas.orcamento", estrutura: (await linha(o.id))["estrutura"] });
    expect(l["code"]).not.toBe(o.code);
    expect(j(await req("GET", `${URL_}/${j(c1).id}`)).tops).toEqual([]);
    expect((await trilha(j(c1).id)).map((x) => x.action)).toEqual(["duplicate"]);
  });
});

describe("LD-A2 um padrão por família", () => {
  it("marcar outro troca o padrão na mesma transação; inativo não pode ser padrão (422)", async () => {
    const a = j(await criar({ nome: nomeUnico("Padrão A"), familia: "vendas.pedido" })).id as string;
    const b = j(await criar({ nome: nomeUnico("Padrão B"), familia: "vendas.pedido" })).id as string;
    expect((await req("POST", `${URL_}/${a}/padrao`)).statusCode).toBe(200);
    expect((await req("POST", `${URL_}/${b}/padrao`)).statusCode).toBe(200);
    expect((await linha(a))["padrao"]).toBe(false);
    expect((await linha(b))["padrao"]).toBe(true);
    expect((await trilha(a)).map((x) => x.action)).toContain("unset_default");
    const n = await admin.query("select count(*)::int n from erp.layouts_documento where organization_id=$1 and familia='vendas.pedido' and padrao and is_active and deleted_at is null", [h.demo.orgId]);
    expect(n.rows[0].n).toBe(1);

    const c = j(await criar({ nome: nomeUnico("Inativo"), familia: "vendas.pedido" })).id as string;
    await req("POST", `${URL_}/${c}/ativo`, { ativo: false });
    const r = await req("POST", `${URL_}/${c}/padrao`);
    expect(r.statusCode, r.body).toBe(422);
    expect((await linha(b))["padrao"]).toBe(true);
  });

  it("o índice único do banco recusa um segundo padrão por INSERT direto", async () => {
    const org = h.demo.orgId;
    await admin.query("update erp.layouts_documento set padrao=false where organization_id=$1 and familia='vendas.venda'", [org]);
    await admin.query("insert into erp.layouts_documento (organization_id, code, nome, familia, padrao, estrutura) values ($1, 'D1', 'Direto 1', 'vendas.venda', true, '{}')", [org]);
    await expect(admin.query("insert into erp.layouts_documento (organization_id, code, nome, familia, padrao, estrutura) values ($1, 'D2', 'Direto 2', 'vendas.venda', true, '{}')", [org]))
      .rejects.toMatchObject({ code: "23505", constraint: "ux_layouts_documento_padrao" });
    await expect(admin.query("insert into erp.layouts_documento (organization_id, code, nome, familia, estrutura) values ($1, 'D3', 'Direto 3', 'vendas.venda', '[]')", [org]))
      .rejects.toMatchObject({ code: "23514", constraint: "chk_layouts_documento_estrutura" });
  });
});

describe("LD-A3 ligação de TOPs", () => {
  it("TOP de outra família → 422 próprio; TOP de outra org / inexistente / excluída → a mesma recusa", async () => {
    const l = j(await criar({ nome: nomeUnico("Ligação"), familia: "vendas.venda" })).id as string;
    const outraFamilia = await criarTop("estoque.baixa");
    const r = await req("PUT", `${URL_}/${l}/tops`, { tipoOperacaoIds: [outraFamilia] });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error.message).toBe("TOP de outra família");

    const topOutraOrg = await criarTop("vendas.venda", (await outraOrg()).headers);
    const excluida = await criarTop("vendas.venda");
    await admin.query("update erp.tipos_operacao set excluido_em=now() where id=$1", [excluida]);
    const respostas = [];
    for (const t of [topOutraOrg, "00000000-0000-4000-8000-000000000000", excluida]) {
      const x = await req("PUT", `${URL_}/${l}/tops`, { tipoOperacaoIds: [t] });
      expect(x.statusCode, x.body).toBe(422);
      respostas.push(j(x).error);
    }
    expect(respostas[0]).toEqual(respostas[1]);
    expect(respostas[2]).toEqual(respostas[1]);
    expect(respostas[0].message).toBe("TOP inválida para este layout");
    expect((await admin.query("select count(*)::int n from erp.layout_documento_tops where layout_id=$1", [l])).rows[0].n).toBe(0);
  });

  it("substitui a lista inteira; ligar TOP de outro layout MOVE (e audita o de-onde)", async () => {
    const a = j(await criar({ nome: nomeUnico("Mover A"), familia: "vendas.venda" })).id as string;
    const b = j(await criar({ nome: nomeUnico("Mover B"), familia: "vendas.venda" })).id as string;
    const t1 = await criarTop("vendas.venda"); const t2 = await criarTop("vendas.venda");
    const r1 = await req("PUT", `${URL_}/${a}/tops`, { tipoOperacaoIds: [t1, t2] });
    expect(r1.statusCode, r1.body).toBe(200);
    expect((j(r1).tops as { id: string }[]).map((x) => x.id).sort()).toEqual([t1, t2].sort());
    expect(j(await req("GET", `${URL_}?familia=vendas.venda`)).items).toContainEqual(expect.objectContaining({ id: a, qtdTops: 2 }));

    const r2 = await req("PUT", `${URL_}/${b}/tops`, { tipoOperacaoIds: [t2] });
    expect(r2.statusCode, r2.body).toBe(200);
    const ligs = (await admin.query("select tipo_operacao_id, layout_id from erp.layout_documento_tops where tipo_operacao_id = any($1::uuid[])", [[t1, t2]])).rows;
    expect(ligs).toEqual(expect.arrayContaining([{ tipo_operacao_id: t1, layout_id: a }, { tipo_operacao_id: t2, layout_id: b }]));
    const set = (await trilha(b)).find((x) => x.action === "set_tops")!;
    expect(set.metadata!["movidas"]).toEqual([{ tipoOperacaoId: t2, deLayoutId: a }]);

    expect((await req("PUT", `${URL_}/${a}/tops`, { tipoOperacaoIds: [] })).statusCode).toBe(200);
    expect((await admin.query("select count(*)::int n from erp.layout_documento_tops where layout_id=$1", [a])).rows[0].n).toBe(0);

    // excluir o layout desliga as TOPs
    expect((await req("DELETE", `${URL_}/${b}`)).statusCode).toBe(200);
    expect((await admin.query("select count(*)::int n from erp.layout_documento_tops where tipo_operacao_id=$1", [t2])).rows[0].n).toBe(0);
  });

  it("trigger do banco recusa família divergente em INSERT direto", async () => {
    const l = j(await criar({ nome: nomeUnico("Trigger"), familia: "vendas.pedido" })).id as string;
    const t = await criarTop("vendas.venda");
    await expect(admin.query("insert into erp.layout_documento_tops (organization_id, layout_id, tipo_operacao_id) values ($1,$2,$3)", [h.demo.orgId, l, t]))
      .rejects.toMatchObject({ code: "23514" });
    const ok = await criarTop("vendas.pedido");
    await admin.query("insert into erp.layout_documento_tops (organization_id, layout_id, tipo_operacao_id) values ($1,$2,$3)", [h.demo.orgId, l, ok]);
    // TOP de outra organização: a FK composta (e a trigger) recusam, mesmo sem RLS (superusuário)
    const b = await outraOrg();
    const topB = await criarTop("vendas.pedido", b.headers);
    await expect(admin.query("insert into erp.layout_documento_tops (organization_id, layout_id, tipo_operacao_id) values ($1,$2,$3)", [h.demo.orgId, l, topB]))
      .rejects.toMatchObject({ code: "23514" });
    await expect(admin.query("insert into erp.layout_documento_tops (organization_id, layout_id, tipo_operacao_id) values ($1,$2,$3)", [b.orgId, l, topB]))
      .rejects.toMatchObject({ code: expect.stringMatching(/^(23503|23514)$/) });
  });
});

describe("LD-A4 RLS (conexão erp_app)", () => {
  it("outra organização não lê nem escreve; erp_app não apaga layout (exclusão lógica)", async () => {
    const id = j(await criar({ nome: nomeUnico("Só da demo"), familia: "vendas.venda" })).id as string;
    const t = await criarTop("vendas.venda");
    expect((await req("PUT", `${URL_}/${id}/tops`, { tipoOperacaoIds: [t] })).statusCode).toBe(200);
    const outra = (await admin.query<{ id: string }>("insert into erp.organizations (name) values ('Outra RLS A3-1') returning id")).rows[0]!.id;
    const cli = await h.db.connect();
    try {
      await cli.query("begin");
      await cli.query("select set_config('app.org_id',$1,true)", [outra]);
      expect((await cli.query("select id from erp.layouts_documento where id=$1", [id])).rowCount).toBe(0);
      expect((await cli.query("select 1 from erp.layout_documento_tops where layout_id=$1", [id])).rowCount).toBe(0);
      expect((await cli.query("update erp.layouts_documento set nome='roubado' where id=$1", [id])).rowCount).toBe(0);
      expect((await cli.query("delete from erp.layout_documento_tops where layout_id=$1", [id])).rowCount).toBe(0);
      await expect(cli.query("insert into erp.layouts_documento (organization_id, code, nome, familia, estrutura) values ($1, 'Z1', 'Invasor', 'vendas.venda', '{}')", [h.demo.orgId])).rejects.toMatchObject({ code: "42501" });
      await cli.query("rollback");
      await cli.query("begin");
      await cli.query("select set_config('app.org_id',$1,true)", [h.demo.orgId]);
      expect((await cli.query("select id from erp.layouts_documento where id=$1", [id])).rowCount, "premissa: a própria org vê").toBe(1);
      await expect(cli.query("delete from erp.layouts_documento where id=$1", [id])).rejects.toMatchObject({ code: "42501" });
      await cli.query("rollback");
    } finally { cli.release(); }
    expect((await linha(id))["nome"]).toMatch(/^Só da demo/);
    expect((await admin.query("select count(*)::int n from erp.layout_documento_tops where layout_id=$1", [id])).rows[0].n).toBe(1);
  });
});
