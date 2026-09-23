import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import bcrypt from "bcryptjs";
import type { Db } from "../src/pool.js";
import { seedDemo } from "../src/seed.js";
import {
  seedOrganizacaoLimpa, lerConfiguracaoOrganizacaoLimpa, semearNoDeploy, resolverSeedDoDeploy,
  SENHAS_DO_REPOSITORIO, OrganizacaoLimpaRecusada,
} from "../src/organizacao-limpa.js";
import { DEMO_LEGADO_RAZAO_SOCIAL, DEMO_LEGADO_DOCUMENTO } from "../src/origem-organizacao.js";
import { freshDb } from "./setup.js";

/**
 * GO-LIVE-01 — organização limpa e blindagem do seed demo.
 *
 * O banco é o mesmo do seed demo (como em produção: a demo continua lá como sandbox). Cada prova de
 * recusa mede o banco INTEIRO antes e depois — "nada foi gravado" é uma contagem, não uma promessa.
 */
const SENHA = "Senha-Forte-Go-Live-2026";
const ENV = { ORGANIZACAO_LIMPA_ON_DEPLOY: "1", ORG_NAME: "Agro Real", ORG_SLUG: "agro-real", ADMIN_NAME: "Maike", ADMIN_EMAIL: "dono@real.example", ADMIN_PASSWORD: SENHA };
const cfg = (over: Record<string, string> = {}) => lerConfiguracaoOrganizacaoLimpa({ ...ENV, ...over });

let db: Db;
let demoOrgId: string;
let nomeDemo: string;

/** Contagem de linhas de TODAS as tabelas do schema erp (mais o ledger): a fotografia do "nada foi gravado". */
async function fotografia(): Promise<Record<string, number>> {
  const t = await db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema='erp' and table_type='BASE TABLE' order by 1");
  const out: Record<string, number> = {};
  for (const { table_name } of t.rows) out[table_name] = Number((await db.query<{ n: string }>(`select count(*) n from erp."${table_name}"`)).rows[0]!.n);
  expect(Object.keys(out).length).toBeGreaterThan(50);
  return out;
}

async function limparOrgsDoTeste() {
  // Remove só o que ESTE arquivo cria (slug/e-mail de teste), na ordem das FKs.
  const orgs = (await db.query<{ id: string }>("select id from erp.organizations where slug like 'agro-real%' or slug like 'go-live-%'")).rows.map((r) => r.id);
  for (const id of orgs) {
    await db.query("delete from erp.membro_escopos_empresa where organization_id=$1", [id]);
    await db.query("delete from erp.organization_members where organization_id=$1", [id]);
    await db.query("delete from erp.role_permissions where role_id in (select id from erp.roles where organization_id=$1)", [id]);
    await db.query("delete from erp.roles where organization_id=$1", [id]);
    await db.query("delete from erp.organizations where id=$1", [id]);
  }
  await db.query("delete from erp.users u where (email like '%@real.example' or email like '%@go-live.example') and not exists (select 1 from erp.organization_members m where m.user_id=u.id)");
}

beforeAll(async () => { const f = await freshDb(); db = f.db; demoOrgId = f.demo.orgId; nomeDemo = (await db.query<{ name: string }>("select name from erp.organizations where id=$1", [demoOrgId])).rows[0]!.name; });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await limparOrgsDoTeste(); });

describe("organização limpa — criação", () => {
  it("L1: cria só organização, dono, perfil Administrador completo, vínculo e escopo 'todas'; zero cadastro e zero transação", async () => {
    const logs: string[] = [];
    const r = await seedOrganizacaoLimpa(db, cfg(), (m) => logs.push(m));
    expect(r.situacao).toBe("criada");
    // Toda tabela do schema erp com organization_id: só as três estruturais têm linha da organização nova.
    const cols = await db.query<{ table_name: string }>("select c.table_name from information_schema.columns c join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name and t.table_type='BASE TABLE' where c.table_schema='erp' and c.column_name='organization_id' order by 1");
    expect(cols.rows.length).toBeGreaterThan(50);
    const comLinha: Record<string, number> = {};
    for (const { table_name } of cols.rows) {
      const n = Number((await db.query<{ n: string }>(`select count(*) n from erp."${table_name}" where organization_id=$1`, [r.orgId])).rows[0]!.n);
      if (n) comLinha[table_name] = n;
    }
    const modulos = Number((await db.query<{ n: string }>("select count(*) n from erp.modulos_escopo_empresa")).rows[0]!.n);
    expect(modulos).toBeGreaterThan(0);
    expect(comLinha).toEqual({ organization_members: 1, roles: 1, membro_escopos_empresa: modulos });
    // Nomeadas explicitamente, para a mensagem de falha dizer QUAL cadastro apareceu.
    for (const t of ["empresas", "people", "products", "warehouses", "bank_accounts", "cost_centers", "financial_categories", "chart_accounts", "harvests", "equipments", "animals", "batches", "tipos_operacao", "sales_documents", "stock_movements", "financial_titles", "purchase_requests", "authorizers", "supply_status_sla", "code_sequences"]) expect(comLinha[t], t).toBeUndefined();

    const dono = await db.query<{ is_active: boolean; is_owner: boolean; m_ativo: boolean; name: string; perfil: string; is_system: boolean }>("select u.is_active, m.is_owner, m.is_active as m_ativo, u.name, r.name as perfil, r.is_system from erp.users u join erp.organization_members m on m.user_id=u.id join erp.roles r on r.id=m.role_id where u.email=$1 and m.organization_id=$2", [ENV.ADMIN_EMAIL, r.orgId]);
    expect(dono.rows).toEqual([{ is_active: true, is_owner: true, m_ativo: true, name: "Maike", perfil: "Administrador", is_system: true }]);
    const perms = await db.query<{ faltando: string; total: string }>("select (select count(*) from erp.permissions p where not exists (select 1 from erp.role_permissions rp join erp.roles r on r.id=rp.role_id where r.organization_id=$1 and rp.permission_key=p.key)) faltando, (select count(*) from erp.permissions) total", [r.orgId]);
    expect(Number(perms.rows[0]!.total)).toBeGreaterThan(100);
    expect(perms.rows[0]!.faltando).toBe("0");
    const escopo = await db.query<{ modo: string; n: string }>("select modo, count(*) n from erp.membro_escopos_empresa where organization_id=$1 group by modo", [r.orgId]);
    expect(escopo.rows).toEqual([{ modo: "todas", n: String(modulos) }]);
    const org = await db.query<{ name: string; parameters: unknown; legal_name: string | null }>("select name, parameters, legal_name from erp.organizations where id=$1", [r.orgId]);
    expect(org.rows[0]).toEqual({ name: "Agro Real", parameters: { origem_seed: "organizacao_limpa" }, legal_name: null });
    expect(logs).toEqual([`organização limpa criada: id=${r.orgId} slug=agro-real admin=dono@real.example`]);
  });

  it("L4: slug existente de outro dono → recusa; nada gravado", async () => {
    await seedOrganizacaoLimpa(db, cfg({ ADMIN_EMAIL: "outro@real.example" }), () => {});
    const antes = await fotografia();
    await expect(seedOrganizacaoLimpa(db, cfg({ ADMIN_EMAIL: "dono2@real.example" }), () => {})).rejects.toThrow(/slug "agro-real" já existe/);
    // O slug da demo, que não foi criada por este mecanismo, também é recusado.
    await expect(seedOrganizacaoLimpa(db, cfg({ ORG_SLUG: "demo", ADMIN_EMAIL: "dono3@real.example" }), () => {})).rejects.toThrow(/slug "demo" já existe/);
    expect(await fotografia()).toEqual(antes);
    const nome = await db.query("select name from erp.organizations where slug='demo'");
    expect(nome.rows[0]).toEqual({ name: nomeDemo });
  });

  it("L5: e-mail existente → recusa; hash, nome e vínculos do usuário intactos", async () => {
    const antesU = (await db.query("select id, name, password_hash, is_active, updated_at from erp.users where email='admin@demo.local'")).rows[0];
    const antesM = (await db.query("select m.* from erp.organization_members m join erp.users u on u.id=m.user_id where u.email='admin@demo.local' order by m.id")).rows;
    const antes = await fotografia();
    await expect(seedOrganizacaoLimpa(db, cfg({ ADMIN_EMAIL: "admin@demo.local" }), () => {})).rejects.toThrow(/admin@demo\.local já está cadastrado.*não foram alterados/);
    expect(await fotografia()).toEqual(antes);
    expect((await db.query("select id, name, password_hash, is_active, updated_at from erp.users where email='admin@demo.local'")).rows[0]).toEqual(antesU);
    expect((await db.query("select m.* from erp.organization_members m join erp.users u on u.id=m.user_id where u.email='admin@demo.local' order by m.id")).rows).toEqual(antesM);
    expect(await bcrypt.compare("Demo@12345", (antesU as { password_hash: string }).password_hash)).toBe(true);
  });

  it("L6: senha curta ou presente no repositório → recusa, sem ecoar a senha", () => {
    for (const senha of ["Curta@1234", "Demo@12345", "demo@12345", "Vendedor@12345"]) {
      let erro: unknown;
      try { cfg({ ADMIN_PASSWORD: senha }); } catch (e) { erro = e; }
      expect(erro, senha).toBeInstanceOf(OrganizacaoLimpaRecusada);
      expect(String((erro as Error).message)).not.toContain(senha);
    }
    expect(cfg().adminPassword).toBe(SENHA);
  });

  it("L6b: a lista de senhas conhecidas cobre toda senha de fixture do repositório", () => {
    const raiz = resolve(__dirname, "../../..");
    const saida = execFileSync("git", ["grep", "-hoE", "[A-Za-z]+@12345[A-Za-z0-9!]*", "--", ".", ":!docs/reference"], { cwd: raiz, encoding: "utf8" });
    const achadas = [...new Set(saida.split("\n").filter(Boolean))];
    expect(achadas.length).toBeGreaterThan(10);
    const conhecidas = new Set(SENHAS_DO_REPOSITORIO.map((s) => s.toLowerCase()));
    expect(achadas.filter((s) => !conhecidas.has(s.toLowerCase()))).toEqual([]);
  });

  it("L7: variável obrigatória ausente → recusa pelo pre-deploy; nada gravado", async () => {
    const antes = await fotografia();
    for (const k of ["ORG_NAME", "ORG_SLUG", "ADMIN_NAME", "ADMIN_EMAIL", "ADMIN_PASSWORD"]) {
      const env: Record<string, string | undefined> = { ...ENV, [k]: undefined };
      await expect(semearNoDeploy(db, env, () => {}), k).rejects.toThrow(new RegExp(`variável obrigatória ausente: ${k}`));
      await expect(semearNoDeploy(db, { ...ENV, [k]: "   " }, () => {}), k).rejects.toThrow(/variável obrigatória ausente/);
    }
    expect(await fotografia()).toEqual(antes);
  });

  it("L8: reexecução idêntica → no-op sem escrita, com o aviso para remover a flag e ADMIN_PASSWORD", async () => {
    const r1 = await seedOrganizacaoLimpa(db, cfg(), () => {});
    const antes = await fotografia();
    const hashAntes = (await db.query("select password_hash, updated_at from erp.users where email=$1", [ENV.ADMIN_EMAIL])).rows[0];
    const xmin = (await db.query("select xmin::text from erp.organizations where id=$1", [r1.orgId])).rows[0];
    const logs: string[] = [];
    // Mesmo com outra senha no ambiente: a senha que vale é a da tela, e o no-op não a toca.
    const r2 = await semearNoDeploy(db, { ...ENV, ADMIN_PASSWORD: "Outra-Senha-Forte-2026" }, (m) => logs.push(m));
    expect(r2).toBe("organizacao_limpa");
    expect(await fotografia()).toEqual(antes);
    expect((await db.query("select password_hash, updated_at from erp.users where email=$1", [ENV.ADMIN_EMAIL])).rows[0]).toEqual(hashAntes);
    expect((await db.query("select xmin::text from erp.organizations where id=$1", [r1.orgId])).rows[0]).toEqual(xmin);
    expect(logs).toEqual([`organização já criada; remova a flag e ADMIN_PASSWORD (id=${r1.orgId} slug=agro-real admin=dono@real.example)`]);
  });

  it("L9: as duas flags juntas → recusa antes de qualquer escrita", async () => {
    const antes = await fotografia();
    expect(() => resolverSeedDoDeploy({ SEED_ON_DEPLOY: "1", ORGANIZACAO_LIMPA_ON_DEPLOY: "1" })).toThrow(/ao mesmo tempo/);
    await expect(semearNoDeploy(db, { ...ENV, SEED_ON_DEPLOY: "1" }, () => {})).rejects.toThrow(/ao mesmo tempo/);
    expect(await fotografia()).toEqual(antes);
    expect(resolverSeedDoDeploy({})).toBe("nenhum");
    expect(resolverSeedDoDeploy({ SEED_ON_DEPLOY: "0", ORGANIZACAO_LIMPA_ON_DEPLOY: "0" })).toBe("nenhum");
  });

  it("L10: nenhum log e nenhuma recusa contém a senha ou o hash", async () => {
    const logs: string[] = [];
    const capturar = (m: string) => logs.push(m);
    await semearNoDeploy(db, ENV, capturar);
    await semearNoDeploy(db, ENV, capturar);
    for (const over of [{ ADMIN_EMAIL: "admin@demo.local", ORG_SLUG: "go-live-x" }, { ADMIN_EMAIL: "novo@go-live.example" }]) {
      try { await semearNoDeploy(db, { ...ENV, ...over }, capturar); } catch (e) { logs.push((e as Error).message); }
    }
    const hash = (await db.query<{ password_hash: string }>("select password_hash from erp.users where email=$1", [ENV.ADMIN_EMAIL])).rows[0]!.password_hash;
    expect(logs.length).toBe(4);
    for (const l of logs) { expect(l).not.toContain(SENHA); expect(l).not.toContain(hash); expect(l).not.toMatch(/\$2[aby]\$/); }
  });

  it("recusa atômica: falha no meio da criação não deixa rastro", async () => {
    const antes = await fotografia();
    // Outra transação cadastra o mesmo e-mail sem confirmar: a checagem não o vê, a organização e o papel
    // já foram inseridos quando o insert do usuário colide. A colisão tem de desfazer TUDO.
    const cli = await db.connect();
    try {
      await cli.query("begin");
      await cli.query("insert into erp.users(email,name) values ('corrida@real.example','Corrida')");
      const p = seedOrganizacaoLimpa(db, cfg({ ADMIN_EMAIL: "corrida@real.example" }), () => {});
      await new Promise((r) => setTimeout(r, 300));
      await cli.query("commit");
      await expect(p).rejects.toThrow();
    } finally { cli.release(); }
    await db.query("delete from erp.users where email='corrida@real.example'");
    expect(await fotografia()).toEqual(antes);
  });
});

describe("seed demo — blindagem", () => {
  it("D1: recusa escrever em organização que não é demo (slug de organização limpa)", async () => {
    const r = await seedOrganizacaoLimpa(db, cfg(), () => {});
    const antes = await fotografia();
    await expect(seedDemo(db, { slug: "agro-real", adminEmail: "novo@go-live.example" }, () => {})).rejects.toThrow(/slug "agro-real" pertence a uma organização que não é demo/);
    expect(await fotografia()).toEqual(antes);
    expect((await db.query("select name from erp.organizations where id=$1", [r.orgId])).rows[0]).toEqual({ name: "Agro Real" });
    // Organização sem marca e sem a assinatura do seed antigo (criada por outro caminho) também é recusada.
    await db.query("insert into erp.organizations(name,slug) values ('Outra','go-live-sem-marca')");
    await expect(seedDemo(db, { slug: "go-live-sem-marca", adminEmail: "novo@go-live.example" }, () => {})).rejects.toThrow(/não é demo/);
    // Marca forjada com valor desconhecido: na dúvida, recusa.
    await db.query("insert into erp.organizations(name,legal_name,document,slug,parameters) values ('X',$1,$2,'go-live-marca-estranha','{\"origem_seed\":\"outra\"}')", [DEMO_LEGADO_RAZAO_SOCIAL, DEMO_LEGADO_DOCUMENTO]);
    await expect(seedDemo(db, { slug: "go-live-marca-estranha", adminEmail: "novo@go-live.example" }, () => {})).rejects.toThrow(/não é demo/);
  });

  it("D2: recusa alterar usuário vinculado a organização não demo; senha e nome intactos", async () => {
    await seedOrganizacaoLimpa(db, cfg(), () => {});
    const antesU = (await db.query("select name, password_hash, updated_at from erp.users where email=$1", [ENV.ADMIN_EMAIL])).rows[0];
    const antes = await fotografia();
    await expect(seedDemo(db, { slug: "go-live-demo2", adminEmail: ENV.ADMIN_EMAIL, adminPassword: "Demo@12345" }, () => {})).rejects.toThrow(/dono@real\.example já pertence a um usuário que não é exclusivamente demo/);
    // Usuário demo que ganhou vínculo com a organização real também fica intocável.
    const orgReal = (await db.query<{ id: string }>("select id from erp.organizations where slug='agro-real'")).rows[0]!.id;
    const op = (await db.query<{ id: string; name: string; password_hash: string }>("select id, name, password_hash from erp.users where email='operador@demo.local'")).rows[0]!;
    await db.query("insert into erp.organization_members(organization_id,user_id) values ($1,$2)", [orgReal, op.id]);
    const antes2 = await fotografia();
    await expect(seedDemo(db, {}, () => {})).rejects.toThrow(/operador@demo\.local já pertence/);
    expect(await fotografia()).toEqual(antes2);
    expect((await db.query("select name, password_hash from erp.users where id=$1", [op.id])).rows[0]).toEqual({ name: op.name, password_hash: op.password_hash });
    await db.query("delete from erp.organization_members where organization_id=$1 and user_id=$2", [orgReal, op.id]);
    expect((await db.query("select name, password_hash, updated_at from erp.users where email=$1", [ENV.ADMIN_EMAIL])).rows[0]).toEqual(antesU);
    expect(Object.keys(antes).length).toBeGreaterThan(50);
    // Usuário existente sem vínculo nenhum: não há como provar que é demo → recusa.
    await db.query("insert into erp.users(email,name) values ('solto@go-live.example','Solto')");
    await expect(seedDemo(db, { slug: "go-live-demo3", adminEmail: "solto@go-live.example" }, () => {})).rejects.toThrow(/solto@go-live\.example já pertence/);
    await db.query("delete from erp.users where email='solto@go-live.example'");
  });

  it("D3: a organização do seed demo ANTIGO (sem marca) continua reconhecida; a nova nasce marcada", async () => {
    // Simula o acervo de produção: remove a marca da organização demo, como o seed antigo a deixava.
    await db.query("update erp.organizations set parameters = parameters - 'origem_seed', name='Nome Qualquer do ORG_NAME' where id=$1", [demoOrgId]);
    const antes = (await db.query("select parameters from erp.organizations where id=$1", [demoOrgId])).rows[0] as { parameters: Record<string, unknown> };
    expect(antes.parameters).not.toHaveProperty("origem_seed");
    const d = await seedDemo(db, { orgName: "Nome Qualquer do ORG_NAME" }, () => {});
    expect(d.orgId).toBe(demoOrgId);
    // Nova organização demo (slug novo) nasce com a marca.
    const nova = await seedDemo(db, { slug: "go-live-demo-nova", adminEmail: "admin2@go-live.example" }, () => {});
    expect((await db.query("select parameters->>'origem_seed' o from erp.organizations where id=$1", [nova.orgId])).rows[0]).toEqual({ o: "demo" });
    await db.query("update erp.organizations set name=$2 where id=$1", [demoOrgId, nomeDemo]);
  });
});
