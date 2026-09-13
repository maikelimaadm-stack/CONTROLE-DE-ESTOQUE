import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * MIGRAÇÃO FÍSICA FAZENDA → EMPRESA: O QUE O BANCO GARANTE (PRE-BASE2-03).
 *
 * Três coisas que nenhum teste de API alcança:
 *   1. a view de compatibilidade devolve o MESMO conjunto que a tabela canônica, sob o papel da aplicação —
 *      e não o conjunto do DONO, que é o que aconteceria sem `security_invoker`;
 *   2. o par legado/canônico é impossível de divergir, e a divergência é RECUSADA em vez de resolvida;
 *   3. a migração sobre um banco REALISTA (não fresh) preserva identificadores, contagens e valores.
 */
const migrations = listMigrations();
const ate0013 = migrations.filter((m) => m.name < "0014");
const daPreBase203 = migrations.filter((m) => m.name >= "0014");

let db: Db; let app: Db; let ORG = ""; let EMPRESA = ""; let EMPRESA2 = ""; let EMPRESA3 = ""; let ADMIN = "";

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 4 });
  await resetSchema(db);
  for (const m of migrations) await db.query(m.sql);
  await seedReference(db, () => {});
  const demo = await seedDemo(db, {}, () => {});
  ORG = demo.orgId; EMPRESA = demo.empresaIds[0]!; EMPRESA2 = demo.empresaIds[1]!; ADMIN = demo.adminUserId;
  // uma terceira empresa: é preciso três valores distintos para montar um UPDATE de verdade CONTRADITÓRIO
  EMPRESA3 = (await db.query<{ id: string }>("insert into erp.empresas(organization_id,code,name) values ($1,3,'Empresa 3') returning id", [ORG])).rows[0]!.id;
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_compat') then create role erp_app_compat login password 'c' in role erp_app; end if; end $$;");
  // A URL de teste é `postgresql://postgres:postgres@…`: trocar o texto "postgres@" acertaria a SENHA e
  // deixaria o usuário como `postgres`, que é SUPERUSUÁRIO e ignora RLS — o teste passaria a medir nada.
  // Reescrever o userinfo pela API de URL é o que garante que a conexão seja mesmo a do papel da aplicação.
  const url = new URL(TEST_URL); url.username = "erp_app_compat"; url.password = "c";
  app = createPool(url.toString(), { max: 2 });
}, 240_000);
afterAll(async () => { await app?.end(); await db?.end(); });

describe("view de compatibilidade erp.farms", () => {
  const comoApp = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => {
    const c = await app.connect();
    try {
      await c.query("begin");
      // com o usuário REAL: é assim que a API fala com o banco, e é o que faz a RLS ter o que decidir
      await c.query("select set_config('app.org_id',$1,true), set_config('app.user_id',$2,true)", [ORG, ADMIN]);
      const r = await c.query<T>(sql, params);
      await c.query("commit");
      return r;
    } finally { c.release(); }
  };

  it("devolve exatamente as mesmas linhas que erp.empresas sob o papel da aplicação", async () => {
    // Sem `security_invoker = true`, a view rodaria com a RLS do DONO. Onde o dono é superusuário (migração
    // local, Supabase), não há RLS nenhuma: o nome antigo viraria uma porta dos fundos para o banco inteiro.
    const canonica = await comoApp<{ id: string }>("select id from erp.empresas order by id");
    const legada = await comoApp<{ id: string }>("select id from erp.farms order by id");
    expect(legada.rows.map((r) => r.id)).toEqual(canonica.rows.map((r) => r.id));
    expect(canonica.rows.length).toBeGreaterThan(0);
  });

  it("não enxerga empresa de outra organização pelo nome legado", async () => {
    const outra = await db.query<{ id: string }>("insert into erp.organizations(name,slug) values ('[TEST] Compat DB','compat-db') returning id");
    await db.query("insert into erp.empresas(organization_id,code,name) values ($1,42,'Invisivel')", [outra.rows[0]!.id]);
    const r = await comoApp<{ n: string; org: string | null; tv: boolean; esc: boolean }>(
      `select count(*)::text n,
              max(organization_id::text) org,
              bool_or(erp.tenant_visible(organization_id)) tv,
              bool_or(erp.empresa_no_escopo(id, null)) esc
         from erp.farms where name='Invisivel'`);
    expect(r.rows[0]!.n, `org=${r.rows[0]!.org} tenant_visible=${r.rows[0]!.tv} escopo=${r.rows[0]!.esc}`).toBe("0");
  });

  it("escrita pelo nome legado chega à tabela canônica", async () => {
    await db.query("insert into erp.farms(organization_id,code,name) values ($1,77,'Criada pela view')", [ORG]);
    const r = await db.query<{ n: string }>("select count(*) n from erp.empresas where organization_id=$1 and code=77", [ORG]);
    expect(r.rows[0]!.n, "view simples sobre uma tabela é automaticamente atualizável").toBe("1");
  });
});

describe("sincronização empresa_id ↔ farm_id", () => {
  const inserir = (cols: string, vals: string, params: unknown[]) =>
    db.query(`insert into erp.purchase_requests(organization_id,code,request_date,request_type,requester_user_id,status,status_changed_at,description,justification,${cols})
              values ($1,$2,current_date,'product',(select id from erp.users where email='admin@demo.local'),'request',now(),'x','x',${vals})`, params);

  it("INSERT só com o legado preenche o canônico", async () => {
    await inserir("farm_id", "$3", [ORG, "SYNC-1", EMPRESA]);
    const r = await db.query<{ e: string }>("select empresa_id e from erp.purchase_requests where code='SYNC-1'");
    expect(r.rows[0]!.e).toBe(EMPRESA);
  });
  it("INSERT só com o canônico preenche o legado", async () => {
    await inserir("empresa_id", "$3", [ORG, "SYNC-2", EMPRESA]);
    const r = await db.query<{ f: string }>("select farm_id f from erp.purchase_requests where code='SYNC-2'");
    expect(r.rows[0]!.f).toBe(EMPRESA);
  });
  it("INSERT com os dois IGUAIS é aceito", async () => {
    await expect(inserir("empresa_id,farm_id", "$3,$3", [ORG, "SYNC-3", EMPRESA])).resolves.toBeTruthy();
  });
  it("INSERT com os dois DIFERENTES é RECUSADO, não resolvido por escolha", async () => {
    // Escolher um dos dois em silêncio gravaria a empresa que o cliente NÃO pediu, e o erro só apareceria
    // num relatório meses depois — quando ninguém mais liga a causa ao efeito.
    await expect(inserir("empresa_id,farm_id", "$3,$4", [ORG, "SYNC-4", EMPRESA, EMPRESA2]))
      .rejects.toThrow(/divergentes/);
  });
  it("UPDATE do canônico move o legado", async () => {
    await db.query("update erp.purchase_requests set empresa_id=$1 where code='SYNC-1'", [EMPRESA2]);
    const r = await db.query<{ f: string }>("select farm_id f from erp.purchase_requests where code='SYNC-1'");
    expect(r.rows[0]!.f).toBe(EMPRESA2);
  });
  it("UPDATE do legado move o canônico", async () => {
    await db.query("update erp.purchase_requests set farm_id=$1 where code='SYNC-2'", [EMPRESA2]);
    const r = await db.query<{ e: string }>("select empresa_id e from erp.purchase_requests where code='SYNC-2'");
    expect(r.rows[0]!.e).toBe(EMPRESA2);
  });
  it("UPDATE contraditório (os dois mudando para valores diferentes) é RECUSADO", async () => {
    // SYNC-3 está em EMPRESA; mudar um lado para EMPRESA2 e o outro para EMPRESA3 é o único caso em que os
    // DOIS mudam. Se só um muda, o outro o acompanha — e é isso que mantém o par sempre igual.
    await expect(db.query("update erp.purchase_requests set empresa_id=$1, farm_id=$2 where code='SYNC-3'", [EMPRESA2, EMPRESA3]))
      .rejects.toThrow(/divergentes/);
  });
  it("coluna ANULÁVEL aceita nulo nos dois lados e continua significando 'da organização'", async () => {
    await db.query("insert into erp.financial_freezes(organization_id,empresa_id,year,month,is_frozen) values ($1,null,2035,3,true)", [ORG]);
    const r = await db.query<{ e: string | null; f: string | null }>("select empresa_id e, farm_id f from erp.financial_freezes where year=2035 and month=3");
    expect(r.rows[0]!.e).toBeNull(); expect(r.rows[0]!.f).toBeNull();
  });
  it("nenhuma linha do banco tem o par divergente", async () => {
    const r = await db.query<{ tabela: string }>(`
      select c.table_name as tabela from information_schema.columns c
       where c.table_schema='erp' and c.column_name='empresa_id'
         and exists (select 1 from information_schema.columns l where l.table_schema='erp' and l.table_name=c.table_name and l.column_name='farm_id')`);
    for (const { tabela } of r.rows) {
      const d = await db.query<{ n: string }>(`select count(*) n from erp.${tabela} where empresa_id is distinct from farm_id`);
      expect(d.rows[0]!.n, `erp.${tabela}`).toBe("0");
    }
    expect(r.rows.length).toBeGreaterThan(40);
  });
});

describe("referência composta prova o tenant", () => {
  it("empresa de OUTRA organização é recusada pela chave estrangeira", async () => {
    const outra = await db.query<{ id: string }>("insert into erp.organizations(name,slug) values ('[TEST] FK','fk-org') returning id");
    const alheia = await db.query<{ id: string }>("insert into erp.empresas(organization_id,code,name) values ($1,1,'Alheia') returning id", [outra.rows[0]!.id]);
    await expect(db.query(
      `insert into erp.purchase_requests(organization_id,empresa_id,code,request_date,request_type,requester_user_id,status,status_changed_at,description,justification)
       values ($1,$2,'FK-1',current_date,'product',(select id from erp.users where email='admin@demo.local'),'request',now(),'x','x')`,
      [ORG, alheia.rows[0]!.id])).rejects.toThrow(/foreign key|violates/i);
  });
});

describe("UPGRADE sobre banco realista (não fresh)", () => {
  const antes: { tabela: string; n: string }[] = []; let idsAntes: string[] = [];
  let upgrade: Db;

  beforeAll(async () => {
    upgrade = createPool(TEST_URL, { max: 3 });
    await resetSchema(upgrade);
    for (const m of ate0013) await upgrade.query(m.sql);
    await seedReference(upgrade, () => {});
    await seedDemoLegado(upgrade);
    const tabelas = ["purchase_requests", "warehouses", "financial_titles", "animals", "batches", "equipments", "documents", "notifications", "registros_globais", "member_farms"];
    for (const t of tabelas) {
      const r = await upgrade.query<{ n: string }>(`select count(*) n from erp.${t}`);
      antes.push({ tabela: t, n: r.rows[0]!.n });
    }
    idsAntes = (await upgrade.query<{ id: string }>("select id from erp.purchase_requests order by id")).rows.map((r) => r.id);
    for (const m of daPreBase203) await upgrade.query(m.sql);
  }, 240_000);
  afterAll(async () => { await upgrade?.end(); });

  it("as contagens sobrevivem (member_farms vira arquivo morto, não sumiço)", async () => {
    for (const { tabela, n } of antes) {
      const alvo = tabela === "member_farms" ? "legado_escopo_empresa_v0" : tabela;
      const r = await upgrade.query<{ n: string }>(`select count(*) n from erp.${alvo}`);
      expect(r.rows[0]!.n, `erp.${alvo}`).toBe(n);
    }
  });
  it("os identificadores são os mesmos — nada foi recriado nem renumerado", async () => {
    const depois = (await upgrade.query<{ id: string }>("select id from erp.purchase_requests order by id")).rows.map((r) => r.id);
    expect(depois).toEqual(idsAntes);
  });
  it("empresa_id recebeu exatamente o valor legado, linha a linha", async () => {
    const r = await upgrade.query<{ n: string }>("select count(*) n from erp.purchase_requests where empresa_id is distinct from farm_id");
    expect(r.rows[0]!.n).toBe("0");
  });
  it("erp.member_farms saiu do schema ativo e o arquivo morto carrega a organização", async () => {
    const viva = await upgrade.query<{ n: string }>("select count(*) n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='erp' and c.relname='member_farms'");
    expect(viva.rows[0]!.n).toBe("0");
    const semOrg = await upgrade.query<{ n: string }>("select count(*) n from erp.legado_escopo_empresa_v0 where organization_id is null");
    expect(semOrg.rows[0]!.n).toBe("0");
  });
  it("nenhuma autorização foi ampliada nem perdida: o escopo por módulo continua idêntico", async () => {
    const r = await upgrade.query<{ n: string }>("select count(*) n from erp.membro_empresas");
    const e = await upgrade.query<{ n: string }>("select count(*) n from erp.membro_escopos_empresa");
    expect(Number(r.rows[0]!.n) + Number(e.rows[0]!.n)).toBeGreaterThan(0);
  });
});

describe("preflight fail-closed", () => {
  it("acervo com empresa de OUTRA organização faz a migração PARAR, sem corrigir nada", async () => {
    const pre = createPool(TEST_URL, { max: 2 });
    try {
      await resetSchema(pre);
      for (const m of ate0013) await pre.query(m.sql);
      const o1 = await pre.query<{ id: string }>("insert into erp.organizations(name,slug) values ('O1','pf-o1') returning id");
      const o2 = await pre.query<{ id: string }>("insert into erp.organizations(name,slug) values ('O2','pf-o2') returning id");
      const alheia = await pre.query<{ id: string }>("insert into erp.farms(organization_id,code,name) values ($1,1,'De O2') returning id", [o2.rows[0]!.id]);
      const u = await pre.query<{ id: string }>("insert into erp.users(email,name,password_hash) values ('pf@t.local','PF','x') returning id");
      // possível até a 0013: a chave estrangeira de coluna única não carrega a organização
      await pre.query(
        `insert into erp.purchase_requests(organization_id,farm_id,code,request_date,request_type,requester_user_id,status,status_changed_at,description,justification)
         values ($1,$2,'CROSS-1',current_date,'product',$3,'request',now(),'x','x')`,
        [o1.rows[0]!.id, alheia.rows[0]!.id, u.rows[0]!.id]);

      let msg = "";
      try { for (const m of daPreBase203) await pre.query(m.sql); } catch (e) { msg = String((e as { message?: string }).message ?? e); }
      expect(msg).toContain("PRE-BASE2-03");
      expect(msg).toContain("OUTRA organizacao");
      expect(msg, "a mensagem entrega a consulta de diagnóstico").toContain("select x.id");

      // e o dado continua lá: nem anulado, nem reatribuído
      const linha = await pre.query<{ farm_id: string }>("select farm_id from erp.purchase_requests where code='CROSS-1'");
      expect(linha.rows[0]!.farm_id).toBe(alheia.rows[0]!.id);
      const constraintCriada = await pre.query<{ n: string }>("select count(*) n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='erp' and c.relname='empresas' and c.relkind='r'");
      expect(constraintCriada.rows[0]!.n, "a renomeação não pode ter acontecido").toBe("0");
    } finally { await pre.end(); }
  }, 240_000);
});

/** Seed reduzido, escrito com os nomes LEGADOS — é o que existe num banco anterior à PRE-BASE2-03. */
async function seedDemoLegado(d: Db): Promise<void> {
  const org = (await d.query<{ id: string }>("insert into erp.organizations(name,slug) values ('[TEST] Upgrade','upgrade') returning id")).rows[0]!.id;
  const u = (await d.query<{ id: string }>("insert into erp.users(email,name,password_hash) values ('admin@demo.local','Admin','x') returning id")).rows[0]!.id;
  const m = (await d.query<{ id: string }>("insert into erp.organization_members(organization_id,user_id,is_owner,is_active) values ($1,$2,true,true) returning id", [org, u])).rows[0]!.id;
  const f1 = (await d.query<{ id: string }>("insert into erp.farms(organization_id,code,name) values ($1,1,'Empresa 1') returning id", [org])).rows[0]!.id;
  const f2 = (await d.query<{ id: string }>("insert into erp.farms(organization_id,code,name) values ($1,2,'Empresa 2') returning id", [org])).rows[0]!.id;
  await d.query("insert into erp.member_farms(member_id,farm_id) values ($1,$2),($1,$3)", [m, f1, f2]);
  await d.query("insert into erp.membro_escopos_empresa(organization_id,membro_id,modulo,modo) select $1,$2,chave,'todas' from erp.modulos_escopo_empresa", [org, m]);
  for (const [i, f] of [f1, f2].entries()) {
    await d.query("insert into erp.warehouses(organization_id,farm_id,initials,description,type) values ($1,$2,$3,'Armazem','inputs')", [org, f, `U${i}`]);
    await d.query(`insert into erp.purchase_requests(organization_id,farm_id,code,request_date,request_type,requester_user_id,status,status_changed_at,description,justification)
                   values ($1,$2,$3,current_date,'product',$4,'request',now(),'x','x')`, [org, f, `UP-${i}`, u]);
    await d.query(`insert into erp.financial_titles(organization_id,farm_id,code,direction,number,emission_date,due_date,amount,status,created_by)
                   values ($1,$2,$3,'payable',$4,current_date,current_date,10,'open',$5)`, [org, f, `T-${i}`, `NF-${i}`, u]);
  }
}
