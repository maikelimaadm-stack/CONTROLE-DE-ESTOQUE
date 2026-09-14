import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { TEST_URL } from "./setup.js";

/**
 * UPGRADE COM ACERVO REAL (PRE-BASE2-04 — hotfix da 0014).
 *
 * A CI de migrations valida banco NOVO e VAZIO. Isso mascara uma classe inteira de defeito: gatilho
 * `for each row` só dispara quando há linha. Foi exatamente assim que a 0014 passou em toda a CI e abortou
 * no primeiro upgrade de produção — `erp.stock_movements` é append-only desde a 0003
 * (`trg_stock_movement_immutable` → LEDGER_IMMUTABLE) e o backfill de `empresa_id` faz UPDATE nela.
 * Com 0 linhas, o UPDATE não dispara nada; com 5, a migration inteira cai.
 *
 * Este teste sobe o banco até a 0013, escreve ACERVO HISTÓRICO no vocabulário LEGADO (`farm_id`, como a API
 * antiga gravava) em vários domínios, e só então aplica 0014 → 0015 → 0016. O ledger é populado por INSERT,
 * que é o que o contrato append-only permite — nenhum gatilho é desligado para montar o cenário.
 */
let db: Db;
const ORG = "cccccccc-0000-4000-8000-000000000001";
const FAZ_A = "cccccccc-0000-4000-8000-00000000000a";
const FAZ_B = "cccccccc-0000-4000-8000-00000000000b";
const USER = "cccccccc-0000-4000-8000-000000000100";
const LEDGER = 5;

/** Fotografia dos campos de NEGÓCIO do ledger: nenhum deles pode mudar durante uma migração estrutural. */
type FotoLedger = { id: string; farm_id: string; warehouse_id: string; product_id: string; movement_type: string; direction: number; quantity: string; unit_cost: string; movement_date: string; source_type: string; source_id: string };
const fotografar = async (): Promise<FotoLedger[]> =>
  (await db.query<FotoLedger>(
    `select id, farm_id::text, warehouse_id::text, product_id::text, movement_type, direction, quantity::text, unit_cost::text,
            movement_date::text, source_type, source_id::text
       from erp.stock_movements order by id`)).rows;

async function acervoLegado() {
  const q = (sql: string, p: unknown[] = []) => db.query(sql, p);
  await q("insert into erp.organizations(id,name,slug) values ($1,'[TEST] Upgrade','upgrade')", [ORG]);
  await q("insert into erp.farms(id,organization_id,code,name) values ($1,$2,1,'Fazenda A'), ($3,$2,2,'Fazenda B')", [FAZ_A, ORG, FAZ_B]);
  await q("insert into erp.users(id,email,name,password_hash) values ($1,'upgrade@t.local','Upgrade','x')", [USER]);
  await q("insert into erp.organization_members(id,organization_id,user_id,is_owner) values ($1,$2,$1,true)", [USER, ORG]);

  const um = (await q("insert into erp.measurement_units(symbol,name) values ('KG','Quilograma') returning id")).rows[0] as { id: string };
  const grupo = (await q("insert into erp.product_groups(organization_id,name) values ($1,'Insumos') returning id", [ORG])).rows[0] as { id: string };
  const cat = (await q("insert into erp.product_categories(organization_id,group_id,name) values ($1,$2,'Nutrição') returning id", [ORG, grupo.id])).rows[0] as { id: string };
  const tipo = (await q("insert into erp.product_kinds(organization_id,category_id,name) values ($1,$2,'Sal') returning id", [ORG, cat.id])).rows[0] as { id: string };
  const fin = (await q("insert into erp.financial_categories(organization_id,code,name,nature) values ($1,'2.01','Insumos','expense') returning id", [ORG])).rows[0] as { id: string };
  await q("insert into erp.cost_centers(organization_id,code,name) values ($1,'1','Geral')", [ORG]);
  const prod = (await q(
    "insert into erp.products(organization_id,code,description,measurement_id,group_id,category_id,kind_id,control_stock,financial_category_id) values ($1,'00001','Sal Mineral',$2,$3,$4,$5,true,$6) returning id",
    [ORG, um.id, grupo.id, cat.id, tipo.id, fin.id])).rows[0] as { id: string };
  const arm = (await q("insert into erp.warehouses(organization_id,farm_id,initials,description) values ($1,$2,'ALM','Almoxarifado') returning id", [ORG, FAZ_A])).rows[0] as { id: string };
  const pessoa = (await q("insert into erp.people(organization_id,code,name,is_provider,is_client) values ($1,'00001','Fornecedor Teste',true,true) returning id", [ORG])).rows[0] as { id: string };
  const esp = (await q("insert into erp.animal_species(name) values ('Bovino') returning id")).rows[0] as { id: string };
  const catAnimal = (await q("insert into erp.animal_categories(species_id,name) values ($1,'Garrote') returning id", [esp.id])).rows[0] as { id: string };

  // LEDGER: só INSERT — é o que o contrato append-only permite. Duas empresas, para provar a cópia por linha.
  for (let i = 0; i < LEDGER; i++) {
    await q(
      `insert into erp.stock_movements(organization_id,farm_id,warehouse_id,product_id,movement_type,direction,quantity,unit_cost,source_type,source_id,movement_date,created_by)
       values ($1,$2,$3,$4,'entry',1,$5,$6,'input_entry',gen_random_uuid(),current_date - $7::int,$8)`,
      [ORG, i % 2 === 0 ? FAZ_A : FAZ_B, arm.id, prod.id, String(10 + i), String(2 + i), String(i), USER]);
  }

  // Demais domínios que o laço da 0014 também percorre — banco vazio esconde gatilho e constraint.
  await q("insert into erp.input_entries(organization_id,farm_id,code,entry_date) values ($1,$2,'00001',current_date)", [ORG, FAZ_A]);
  await q("insert into erp.financial_titles(organization_id,farm_id,code,direction,number,amount,emission_date,due_date,person_id) values ($1,$2,'00001','payable','NF-1','100',current_date,current_date,$3)", [ORG, FAZ_A, pessoa.id]);
  await q("insert into erp.purchase_requests(organization_id,farm_id,code,request_date,request_type,requester_user_id,description,justification) values ($1,$2,'00001',current_date,'product',$3,'Compra','Reposição')", [ORG, FAZ_B, USER]);
  await q("insert into erp.sales_documents(organization_id,farm_id,kind,code,document_date,client_id) values ($1,$2,'sale','00001',current_date,$3)", [ORG, FAZ_A, pessoa.id]);
  await q("insert into erp.animals(organization_id,farm_id,species_id,category_id,entry_date,sex) values ($1,$2,$3,$4,current_date,'M')", [ORG, FAZ_B, esp.id, catAnimal.id]);
  await q("insert into erp.equipments(organization_id,farm_id,code,description) values ($1,$2,'0001','Trator')", [ORG, FAZ_A]);
  await q("insert into erp.service_orders(organization_id,farm_id,code,order_date) values ($1,$2,'00001',current_date)", [ORG, FAZ_A]);
  await q("insert into erp.warehouses(organization_id,farm_id,initials,description) values ($1,$2,'SILO','Silo')", [ORG, FAZ_B]);
  await q("insert into erp.cost_centers(organization_id,code,name) values ($1,'2','Segundo')", [ORG]);
}

const aplicar = async (prefixo: string) => {
  const m = listMigrations().find((x) => x.name.startsWith(prefixo));
  expect(m, `migration ${prefixo} precisa existir`).toBeTruthy();
  const c = await db.connect();
  try {
    await c.query("begin"); await c.query(m!.sql);
    await c.query("insert into public.erp_migrations(name) values ($1)", [m!.name]);
    await c.query("commit");
  } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
};

let antes: FotoLedger[] = [];

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 4 });
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of listMigrations().filter((x) => x.name < "0014")) {
    await db.query(m.sql);
    await db.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
  }
  await acervoLegado();
  antes = await fotografar();
  expect(antes.length, "o ledger precisa ter acervo, senão o teste não prova nada").toBe(LEDGER);
}, 240_000);
afterAll(async () => { await db.end(); });

describe("0014 sobre acervo histórico (ledger não vazio)", () => {
  it("aplica sem esbarrar no LEDGER_IMMUTABLE", async () => {
    await aplicar("0014");
    const r = await db.query<{ n: string }>("select count(*)::text n from public.erp_migrations where name like '0014%'");
    expect(Number(r.rows[0]!.n)).toBe(1);
  }, 120_000);

  it("copia empresa_id = farm_id em TODAS as linhas do ledger", async () => {
    const r = await db.query<{ total: string; iguais: string; nulos: string }>(
      `select count(*)::text total,
              count(*) filter (where empresa_id = farm_id)::text iguais,
              count(*) filter (where empresa_id is null)::text nulos
         from erp.stock_movements`);
    expect(Number(r.rows[0]!.total)).toBe(LEDGER);
    expect(Number(r.rows[0]!.iguais)).toBe(LEDGER);
    expect(Number(r.rows[0]!.nulos)).toBe(0);
  });

  it("preserva contagem e TODOS os campos de negócio — nada além de empresa_id muda", async () => {
    const depois = await fotografar();
    expect(depois.length, "nenhum movimento inventado nem excluído").toBe(antes.length);
    expect(depois).toEqual(antes);
  });

  it("a empresa copiada é da mesma organização do movimento", async () => {
    const r = await db.query<{ n: string }>(
      `select count(*)::text n from erp.stock_movements sm
         join erp.empresas e on e.id = sm.empresa_id
        where e.organization_id <> sm.organization_id`);
    expect(Number(r.rows[0]!.n)).toBe(0);
  });
});

describe("o ledger continua imutável DEPOIS da migração", () => {
  it("o gatilho existe e está HABILITADO", async () => {
    const r = await db.query<{ tgenabled: string }>(
      "select tgenabled from pg_trigger where tgrelid='erp.stock_movements'::regclass and tgname='trg_stock_movement_immutable'");
    expect(r.rows.length, "o gatilho não pode ter sumido").toBe(1);
    expect(r.rows[0]!.tgenabled, "'O' = origin (habilitado); 'D' seria desabilitado").toBe("O");
  });

  it("UPDATE de campo de negócio continua recusado", async () => {
    await expect(db.query("update erp.stock_movements set quantity = quantity + 1")).rejects.toThrow(/LEDGER_IMMUTABLE/);
  });

  it("UPDATE do próprio empresa_id também é recusado (a janela era só da migração)", async () => {
    await expect(db.query("update erp.stock_movements set empresa_id = farm_id")).rejects.toThrow(/LEDGER_IMMUTABLE/);
  });

  it("DELETE continua recusado", async () => {
    await expect(db.query("delete from erp.stock_movements")).rejects.toThrow(/LEDGER_IMMUTABLE/);
  });
});

describe("compatibilidade de INSERT depois da 0014 (a API antiga pode continuar viva)", () => {
  const inserir = async (colunas: string, valores: string, params: unknown[]) =>
    (await db.query<{ id: string; empresa_id: string | null; farm_id: string | null }>(
      `insert into erp.stock_movements(organization_id,warehouse_id,product_id,movement_type,direction,quantity,unit_cost,source_type,source_id,movement_date,${colunas})
       values ($1,$2,$3,'entry',1,'7','1','input_entry',gen_random_uuid(),current_date,${valores})
       returning id, empresa_id::text, farm_id::text`, params)).rows[0]!;

  it("INSERT legado (só farm_id) preenche empresa_id", async () => {
    const w = (await db.query<{ id: string }>("select id from erp.warehouses where initials='ALM'")).rows[0]!;
    const p = (await db.query<{ id: string }>("select id from erp.products limit 1")).rows[0]!;
    const linha = await inserir("farm_id", "$4", [ORG, w.id, p.id, FAZ_A]);
    expect(linha.empresa_id).toBe(FAZ_A);
    expect(linha.farm_id).toBe(FAZ_A);
  });

  it("INSERT canônico (só empresa_id) preenche o espelho legado", async () => {
    const w = (await db.query<{ id: string }>("select id from erp.warehouses where initials='ALM'")).rows[0]!;
    const p = (await db.query<{ id: string }>("select id from erp.products limit 1")).rows[0]!;
    const linha = await inserir("empresa_id", "$4", [ORG, w.id, p.id, FAZ_B]);
    expect(linha.farm_id, "o espelho legado acompanha — é o que mantém a API antiga viva").toBe(FAZ_B);
    expect(linha.empresa_id).toBe(FAZ_B);
  });
});

describe("a sequência continua depois da 0014, com o mesmo acervo", () => {
  it("0015 aplica", async () => {
    await aplicar("0015");
    const r = await db.query<{ n: string }>("select count(*)::text n from public.erp_migrations where name like '0015%'");
    expect(Number(r.rows[0]!.n)).toBe(1);
  }, 120_000);

  it("0016 aplica e entrega a infraestrutura do ID Global", async () => {
    await aplicar("0016");
    const r = await db.query<{ fn: boolean; c: boolean; i: boolean }>(
      `select to_regprocedure('erp.reservar_ids_globais(uuid,integer)') is not null fn,
              exists(select 1 from pg_constraint where conname='registros_globais_id_positivo') c,
              exists(select 1 from pg_class where relname='registros_globais_entidade_idx') i`);
    expect(r.rows[0]).toEqual({ fn: true, c: true, i: true });
  }, 120_000);

  it("e o ledger segue intacto e imutável no fim da sequência", async () => {
    const r = await db.query<{ n: string; tg: string }>(
      `select (select count(*)::text from erp.stock_movements where empresa_id is null) n,
              (select tgenabled from pg_trigger where tgrelid='erp.stock_movements'::regclass and tgname='trg_stock_movement_immutable') tg`);
    expect(Number(r.rows[0]!.n)).toBe(0);
    expect(r.rows[0]!.tg).toBe("O");
    await expect(db.query("update erp.stock_movements set quantity = quantity + 1")).rejects.toThrow(/LEDGER_IMMUTABLE/);
  });
});
