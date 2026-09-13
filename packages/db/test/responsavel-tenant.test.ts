import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { TEST_URL } from "./setup.js";

/**
 * INTEGRIDADE DE TENANT DO RESPONSÁVEL (PRE-BASE2-02, migration 0013).
 *
 * O banco aceitava, sem reclamar, uma solicitação de compra da organização A com
 * `current_responsible_user_id` de um usuário da organização B: a chave estrangeira apontava para
 * `erp.users`, que é a tabela GLOBAL de identidades. Existir nela prova que o UUID é um usuário; não prova
 * de QUEM ele é. A 0013 troca essa prova pela que importa — vínculo na MESMA organização.
 *
 * Duas coisas são provadas aqui, e a segunda é a que costuma faltar: a constraint recusa o dado novo, E a
 * migration RECUSA-SE a rodar sobre dado antigo inconsistente em vez de "consertar" em silêncio. Uma
 * migration que limpa sozinha transforma um incidente (alguém de outro tenant respondendo por um processo)
 * num registro apagado sem rastro, e ninguém investiga o que nunca apareceu.
 */
const ORG_A = "dddddddd-0000-4000-8000-000000000001";
const ORG_B = "dddddddd-0000-4000-8000-000000000002";
const EMPRESA_A = "dddddddd-0000-4000-8000-00000000000a";
const USUARIO_A = "dddddddd-0000-4000-8000-000000000011";
const USUARIO_B = "dddddddd-0000-4000-8000-000000000012";
const FANTASMA = "dddddddd-0000-4000-8000-0000000000ff";

const migrations = listMigrations();
const ate0012 = migrations.filter((m) => m.name < "0013");
const zero13 = migrations.find((m) => m.name.startsWith("0013"));

/** Mundo mínimo: duas organizações reais, uma empresa na A, um usuário membro de cada. */
async function mundo(db: Db): Promise<void> {
  await db.query("insert into erp.organizations(id,name,slug) values ($1,'[TEST] Org A','resp-a'),($2,'[TEST] Org B','resp-b')", [ORG_A, ORG_B]);
  await db.query("insert into erp.farms(id,organization_id,code,name) values ($1,$2,1,'Empresa A')", [EMPRESA_A, ORG_A]);
  for (const [id, org, email] of [[USUARIO_A, ORG_A, "resp-a@t.local"], [USUARIO_B, ORG_B, "resp-b@t.local"]] as const) {
    await db.query("insert into erp.users(id,email,name,password_hash) values ($1,$2,$3,'x')", [id, email, email]);
    await db.query("insert into erp.organization_members(organization_id,user_id,is_owner,is_active) values ($1,$2,false,true)", [org, id]);
  }
}

/** Insere uma solicitação da ORG A com o responsável pedido. Devolve a mensagem de erro, ou null se passou. */
async function inserirSolicitacao(db: Db, codigo: string, responsavel: string | null): Promise<string | null> {
  try {
    await db.query(
      `insert into erp.purchase_requests(organization_id,farm_id,code,request_date,request_type,requester_user_id,
         status,status_changed_at,description,justification,current_responsible_user_id)
       values ($1,$2,$3,current_date,'product',$4,'request',now(),'t','t',$5)`,
      [ORG_A, EMPRESA_A, codigo, USUARIO_A, responsavel]);
    return null;
  } catch (e) { return String((e as { message?: string }).message ?? e); }
}

describe("responsável da solicitação de compra é membro da própria organização (0013)", () => {
  let db: Db;
  beforeAll(async () => {
    expect(zero13, "migration 0013 precisa existir").toBeTruthy();
    db = createPool(TEST_URL, { max: 2 });
    await resetSchema(db);
    for (const m of migrations) await db.query(m.sql);
    await mundo(db);
  }, 240_000);
  afterAll(async () => { await db.end(); });

  // A — o caso legítimo continua legítimo: a restrição não pode custar a operação normal
  it("aceita responsável que é membro da MESMA organização", async () => {
    expect(await inserirSolicitacao(db, "RESP-A-OK", USUARIO_A)).toBeNull();
  });

  // B — o vetor: usuário REAL, existe em erp.users, mas é de outro tenant
  it("recusa responsável que é membro de OUTRA organização", async () => {
    const erro = await inserirSolicitacao(db, "RESP-A-CROSS", USUARIO_B);
    expect(erro, "usuário de outro tenant deveria violar a chave estrangeira composta").toContain("purchase_requests_responsible_membro_fkey");
  });

  // C — UUID que não é usuário nenhum. Aqui quem recusa primeiro é a referência ANTIGA a `erp.users`, que a
  // 0013 manteve de propósito: ela continua provando "isto é uma identidade", e a nova prova "desta
  // organização". O que o teste garante é a RECUSA — qual das duas barreiras pegou é detalhe de ordem.
  it("recusa responsável inexistente", async () => {
    const erro = await inserirSolicitacao(db, "RESP-A-FANTASMA", FANTASMA);
    expect(erro).toContain("violates foreign key constraint");
    expect(erro).toMatch(/purchase_requests_(responsible_membro|current_responsible_user_id)_fkey/);
  });

  // D — a coluna continua opcional: MATCH SIMPLE não verifica par com nulo, e é isso que se quer
  it("aceita solicitação SEM responsável", async () => {
    expect(await inserirSolicitacao(db, "RESP-A-NULO", null)).toBeNull();
  });

  // E — remover fisicamente um membro que ainda responde por um processo é recusado, não cascateado
  it("recusa apagar o vínculo de membro que ainda é responsável (delete restrict, sem cascade destrutivo)", async () => {
    let msg: string | null = null;
    try { await db.query("delete from erp.organization_members where organization_id=$1 and user_id=$2", [ORG_A, USUARIO_A]); }
    catch (e) { msg = String((e as { message?: string }).message ?? e); }
    expect(msg, "o delete deveria ser recusado para não apagar o responsável de um processo em andamento").toContain("purchase_requests_responsible_membro_fkey");
    const ainda = await db.query<{ n: string }>("select count(*) n from erp.purchase_requests where organization_id=$1 and code='RESP-A-OK'", [ORG_A]);
    expect(ainda.rows[0]!.n, "a solicitação não pode ter sumido junto").toBe("1");
  });
});

describe("a 0013 sobre acervo legado", () => {
  let db: Db;
  beforeAll(async () => { db = createPool(TEST_URL, { max: 2 }); }, 60_000);
  afterAll(async () => { await db.end(); });

  /** Reconstrói o banco no estado ANTERIOR à 0013, com o acervo pedido. */
  async function bancoAte0012(responsavel: string | null): Promise<void> {
    await resetSchema(db);
    for (const m of ate0012) await db.query(m.sql);
    await mundo(db);
    if (responsavel) await inserirSolicitacao(db, "LEGADO-001", responsavel);
  }

  // F1 — dado íntegro: a migration aplica normalmente
  it("aplica sobre acervo íntegro", async () => {
    await bancoAte0012(USUARIO_A);
    await expect(db.query(zero13!.sql)).resolves.toBeTruthy();
    const c = await db.query<{ n: string }>("select count(*) n from pg_constraint where conname='purchase_requests_responsible_membro_fkey'");
    expect(c.rows[0]!.n).toBe("1");
  }, 240_000);

  // F2 — dado cross-tenant legado: FALHA, com mensagem que nomeia o problema e a consulta de diagnóstico
  it("FALHA com mensagem explícita sobre acervo cross-tenant — e não corrige nada em silêncio", async () => {
    await bancoAte0012(USUARIO_B); // possível porque até a 0012 a FK só apontava para erp.users
    const antes = await db.query<{ n: string }>("select count(*) n from erp.purchase_requests where code='LEGADO-001'");
    expect(antes.rows[0]!.n, "o acervo inconsistente precisa existir para o teste valer").toBe("1");

    let msg = "";
    try { await db.query(zero13!.sql); } catch (e) { msg = String((e as { message?: string }).message ?? e); }
    expect(msg).toContain("PRE-BASE2-02");
    expect(msg).toContain("NAO e membro da propria organizacao");
    expect(msg, "a mensagem precisa dizer como listar os casos").toContain("select r.id, r.organization_id, r.code");

    // e o dado continua lá: nem apagado, nem anulado
    const depois = await db.query<{ resp: string | null }>("select current_responsible_user_id resp from erp.purchase_requests where code='LEGADO-001'");
    expect(depois.rows.length).toBe(1);
    expect(depois.rows[0]!.resp).toBe(USUARIO_B);
    const c = await db.query<{ n: string }>("select count(*) n from pg_constraint where conname='purchase_requests_responsible_membro_fkey'");
    expect(c.rows[0]!.n, "a constraint não pode ter sido criada").toBe("0");
  }, 240_000);
});
