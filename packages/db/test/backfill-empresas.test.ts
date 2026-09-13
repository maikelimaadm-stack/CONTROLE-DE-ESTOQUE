import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { TEST_URL } from "./setup.js";

/**
 * EQUIVALÊNCIA DO BACKFILL (PRE-BASE2-02 §9): ninguém ganha nem perde acesso na migração.
 *
 * O teste reconstrói a situação REAL do banco antes da migração — membros com vínculos em `erp.member_farms`
 * — aplicando as migrations até a 0010, inserindo os vínculos legados e só então aplicando a 0011. A regra a
 * provar é a que o sistema usava: SEM vínculo = todas as empresas; COM vínculos = exatamente aquelas.
 * Em seguida, `erp.tem_acesso_empresa` (a autoridade nova) tem de responder o mesmo que a regra antiga, para
 * TODAS as combinações membro × empresa × módulo.
 */
let db: Db;
const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const EMPRESA_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const EMPRESA_B = "aaaaaaaa-0000-4000-8000-00000000000b";
const SEM_VINCULO = "aaaaaaaa-0000-4000-8000-000000000010"; // legado: nenhuma linha = todas
const SO_A = "aaaaaaaa-0000-4000-8000-000000000011";
const A_E_B = "aaaaaaaa-0000-4000-8000-000000000012";
const PROPRIETARIO = "aaaaaaaa-0000-4000-8000-000000000013";

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 4 });
  await resetSchema(db);
  const migrations = listMigrations();
  const ate0010 = migrations.filter((m) => m.name < "0011");
  const zero11 = migrations.find((m) => m.name.startsWith("0011"));
  expect(zero11, "migration 0011 precisa existir").toBeTruthy();
  for (const m of ate0010) await db.query(m.sql);

  await db.query("insert into erp.organizations(id,name,slug) values ($1,'[TEST] Backfill','backfill')", [ORG]);
  await db.query("insert into erp.farms(id,organization_id,code,name) values ($1,$2,1,'Empresa A'), ($3,$2,2,'Empresa B')", [EMPRESA_A, ORG, EMPRESA_B]);
  const membros: [string, string, boolean, string[]][] = [
    [SEM_VINCULO, "sem-vinculo@t.local", false, []],
    [SO_A, "so-a@t.local", false, [EMPRESA_A]],
    [A_E_B, "a-e-b@t.local", false, [EMPRESA_A, EMPRESA_B]],
    [PROPRIETARIO, "dono@t.local", true, []]
  ];
  for (const [id, email, owner, empresas] of membros) {
    await db.query("insert into erp.users(id,email,name,password_hash) values ($1,$2,$3,'x')", [id, email, email]);
    await db.query("insert into erp.organization_members(id,organization_id,user_id,is_owner,is_active) values ($1,$2,$1,$3,true)", [id, ORG, owner]);
    for (const e of empresas) await db.query("insert into erp.member_farms(member_id,farm_id) values ($1,$2)", [id, e]);
  }
  await db.query(zero11!.sql);
}, 180_000);
afterAll(async () => { await db.end(); });

/** Regra LEGADA, escrita aqui como referência independente da implementação nova. */
const acessoLegado = (membro: string, empresa: string): boolean => {
  if (membro === PROPRIETARIO || membro === SEM_VINCULO) return true;
  if (membro === SO_A) return empresa === EMPRESA_A;
  return true; // A_E_B
};

describe("backfill de acesso por empresa", () => {
  it("traduz vínculo vazio em \"todas\" e vínculo preenchido em \"selecionadas\" com as mesmas empresas", async () => {
    const r = await db.query<{ membro_id: string; modo: string; empresas: string[] | null }>(
      `select e.membro_id, e.modo,
              (select array_agg(me.empresa_id order by me.empresa_id) from erp.membro_empresas me
                where me.membro_id=e.membro_id and me.modulo=e.modulo) as empresas
         from erp.membro_escopos_empresa e where e.modulo='estoque' order by e.membro_id`);
    const porMembro = new Map(r.rows.map((x) => [x.membro_id, x]));
    expect(porMembro.get(SEM_VINCULO)?.modo).toBe("todas");
    expect(porMembro.get(SO_A)?.modo).toBe("selecionadas");
    expect(porMembro.get(SO_A)?.empresas).toEqual([EMPRESA_A]);
    expect(porMembro.get(A_E_B)?.modo).toBe("selecionadas");
    expect(porMembro.get(A_E_B)?.empresas?.sort()).toEqual([EMPRESA_A, EMPRESA_B].sort());
  });

  it("cobre TODOS os módulos canônicos — nenhum membro fica sem configuração e, portanto, sem acesso", async () => {
    const modulos = (await db.query<{ chave: string }>("select chave from erp.modulos_escopo_empresa")).rows.map((x) => x.chave);
    expect(modulos.length).toBeGreaterThanOrEqual(10);
    for (const membro of [SEM_VINCULO, SO_A, A_E_B]) {
      const n = await db.query<{ n: string }>("select count(*) n from erp.membro_escopos_empresa where membro_id=$1", [membro]);
      expect(Number(n.rows[0]!.n), membro).toBe(modulos.length);
    }
  });

  it("a autoridade NOVA responde exatamente o que a regra ANTIGA respondia, em toda a matriz", async () => {
    const modulos = (await db.query<{ chave: string }>("select chave from erp.modulos_escopo_empresa")).rows.map((x) => x.chave);
    const divergencias: string[] = [];
    for (const membro of [SEM_VINCULO, SO_A, A_E_B, PROPRIETARIO]) {
      for (const empresa of [EMPRESA_A, EMPRESA_B]) {
        for (const modulo of modulos) {
          const r = await db.query<{ ok: boolean }>("select erp.tem_acesso_empresa($1,$2,$3,$4) ok", [ORG, membro, modulo, empresa]);
          const esperado = acessoLegado(membro, empresa);
          if (Boolean(r.rows[0]!.ok) !== esperado) divergencias.push(`${membro}/${empresa}/${modulo}: novo=${r.rows[0]!.ok} legado=${esperado}`);
        }
      }
    }
    expect(divergencias).toEqual([]);
  });

  it("um MÓDULO NOVO criado depois é fail-closed para quem já existia — não vira acesso automático", async () => {
    await db.query("insert into erp.modulos_escopo_empresa(chave,nome,ordem) values ('modulo_novo','Módulo Novo',99) on conflict do nothing");
    for (const membro of [SEM_VINCULO, SO_A, A_E_B]) {
      const r = await db.query<{ ok: boolean }>("select erp.tem_acesso_empresa($1,$2,'modulo_novo',$3) ok", [ORG, membro, EMPRESA_A]);
      expect(r.rows[0]!.ok, membro).toBe(false);
    }
    // o proprietário continua enxergando tudo, inclusive o que ainda não existia
    const dono = await db.query<{ ok: boolean }>("select erp.tem_acesso_empresa($1,$2,'modulo_novo',$3) ok", [ORG, PROPRIETARIO, EMPRESA_A]);
    expect(dono.rows[0]!.ok).toBe(true);
  });
});
