import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { TEST_URL } from "./setup.js";

/**
 * A JANELA DE SUSPENSÃO DO LEDGER (PRE-BASE2-04 — hotfix da 0014).
 *
 * A 0014 suspende `trg_stock_movement_immutable` em volta de UM update estrutural. Isso só é aceitável se
 * três coisas forem verdade, e nenhuma delas pode ser assumida:
 *
 *   1. o ledger chega PROTEGIDO — a migration suspende uma guarda que reconhece, e nunca "conserta" de
 *      passagem uma que encontrou quebrada (precondição fail-closed);
 *   2. uma falha DENTRO da janela — depois do DISABLE e do UPDATE, ANTES do ENABLE — devolve o gatilho
 *      habilitado. É o cenário crítico: o `enable` NÃO executa, e a proteção depende exclusivamente do
 *      rollback da transação da migration;
 *   3. uma falha DEPOIS da janela (qualquer guarda posterior da própria 0014) também reverte tudo.
 *
 * Os dois cenários de falha são testados, porque provam coisas diferentes. O (2) é o que garante que uma
 * migration interrompida não deixa produção com o ledger editável enquanto a API antiga serve tráfego.
 * Nenhum teste altera o arquivo 0014 em disco: a falha é injetada numa CÓPIA EM MEMÓRIA da migration REAL.
 */
let db: Db;
const ORG = "dddddddd-0000-4000-8000-000000000001";
const FAZ = "dddddddd-0000-4000-8000-00000000000a";
const USER = "dddddddd-0000-4000-8000-000000000100";
const LEDGER = 5;

const zero14 = () => {
  const m = listMigrations().find((x) => x.name.startsWith("0014"));
  if (!m) throw new Error("migration 0014 precisa existir");
  return m;
};

/**
 * Ponto-alvo da instrumentação: a linha que DEVOLVE o gatilho. Injetar imediatamente ANTES dela é o que
 * reproduz "falhou com a janela aberta".
 */
const ALVO_ENABLE = "      execute format('alter table erp.%I enable trigger %I', r.tabela, imutavel);";

/**
 * Instrumenta uma cópia da migration REAL — e exige UM único ponto-alvo.
 *
 * Zero ocorrências (a migration mudou de forma) ou mais de uma (o ponto deixou de ser único) FALHAM aqui,
 * em vez de produzir um teste que passa sem exercitar nada. É o que impede este teste de virar falso-verde
 * numa futura alteração da 0014.
 */
function instrumentar(sql: string, injecao: string, posicao: "antes" | "depois" = "antes"): string {
  const n = sql.split(ALVO_ENABLE).length - 1;
  if (n !== 1) throw new Error(`instrumentação inválida: esperado exatamente 1 ponto-alvo, encontrado ${n}`);
  return sql.replace(ALVO_ENABLE, posicao === "antes" ? `${injecao}\n${ALVO_ENABLE}` : `${ALVO_ENABLE}\n${injecao}`);
}

/**
 * A falha carrega, na própria mensagem, o estado do momento: o gatilho e quantas linhas já receberam
 * `empresa_id`. É assim que o teste PROVA que parou com a janela aberta e o backfill já feito, em vez de
 * confiar na posição do texto.
 */
const RAISE_NA_JANELA = `      if r.tabela = 'stock_movements' then
        raise exception 'FALHA_DENTRO_DA_JANELA tgenabled=% preenchidos=%',
          (select t.tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid
            where c.relname = 'stock_movements' and t.tgname = 'trg_stock_movement_immutable'),
          (select count(*) from erp.stock_movements where empresa_id is not null);
      end if;`;

/** Executa um SQL como a migration faria (transação própria) e devolve a mensagem de erro, se houver. */
async function tentarMigration(sql: string, nome = zero14().name): Promise<string> {
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query(sql);
    await c.query("insert into public.erp_migrations(name) values ($1)", [nome]);
    await c.query("commit");
    return "";
  } catch (e) { await c.query("rollback"); return (e as Error).message; } finally { c.release(); }
}

/** Estado observável DEPOIS do rollback, sempre por nova consulta (conexão do pool, transação nova). */
async function estado() {
  const r = await db.query<{ migr: string; col: boolean; tg: string | null; linhas: string }>(
    `select (select count(*)::text from public.erp_migrations where name like '0014%') migr,
            exists(select 1 from information_schema.columns where table_schema='erp' and table_name='stock_movements' and column_name='empresa_id') col,
            (select tgenabled from pg_trigger where tgrelid='erp.stock_movements'::regclass and tgname='trg_stock_movement_immutable') tg,
            (select count(*)::text from erp.stock_movements) linhas`);
  return r.rows[0]!;
}

async function baseAte0013() {
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of listMigrations().filter((x) => x.name < "0014")) {
    await db.query(m.sql);
    await db.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
  }
  await db.query("insert into erp.organizations(id,name,slug) values ($1,'[TEST] Rollback','rollback')", [ORG]);
  await db.query("insert into erp.farms(id,organization_id,code,name) values ($1,$2,1,'Fazenda')", [FAZ, ORG]);
  await db.query("insert into erp.users(id,email,name,password_hash) values ($1,'rollback@t.local','Rollback','x')", [USER]);
  await db.query("insert into erp.organization_members(id,organization_id,user_id,is_owner) values ($1,$2,$1,true)", [USER, ORG]);
  const um = (await db.query<{ id: string }>("insert into erp.measurement_units(symbol,name) values ('KG','Quilograma') returning id")).rows[0]!;
  const g = (await db.query<{ id: string }>("insert into erp.product_groups(organization_id,name) values ($1,'G') returning id", [ORG])).rows[0]!;
  const c = (await db.query<{ id: string }>("insert into erp.product_categories(organization_id,group_id,name) values ($1,$2,'C') returning id", [ORG, g.id])).rows[0]!;
  const k = (await db.query<{ id: string }>("insert into erp.product_kinds(organization_id,category_id,name) values ($1,$2,'K') returning id", [ORG, c.id])).rows[0]!;
  const fc = (await db.query<{ id: string }>("insert into erp.financial_categories(organization_id,code,name,nature) values ($1,'2.01','F','expense') returning id", [ORG])).rows[0]!;
  const p = (await db.query<{ id: string }>(
    "insert into erp.products(organization_id,code,description,measurement_id,group_id,category_id,kind_id,control_stock,financial_category_id) values ($1,'00001','Produto',$2,$3,$4,$5,true,$6) returning id",
    [ORG, um.id, g.id, c.id, k.id, fc.id])).rows[0]!;
  const w = (await db.query<{ id: string }>("insert into erp.warehouses(organization_id,farm_id,initials,description) values ($1,$2,'ALM','Almox') returning id", [ORG, FAZ])).rows[0]!;
  // O ledger é populado por INSERT — o que o contrato append-only permite. Nenhum gatilho é desligado aqui.
  for (let i = 0; i < LEDGER; i++) {
    await db.query(
      `insert into erp.stock_movements(organization_id,farm_id,warehouse_id,product_id,movement_type,direction,quantity,unit_cost,source_type,source_id,movement_date,created_by)
       values ($1,$2,$3,$4,'entry',1,'10','2','input_entry',gen_random_uuid(),current_date,$5)`, [ORG, FAZ, w.id, p.id, USER]);
  }
}

beforeAll(async () => { db = createPool(TEST_URL, { max: 4 }); }, 240_000);
afterAll(async () => { await db.end(); });

describe("falha DENTRO da janela — depois do DISABLE+UPDATE e ANTES do ENABLE", () => {
  let erro = "";
  beforeAll(async () => {
    await baseAte0013();
    erro = await tentarMigration(instrumentar(zero14().sql, RAISE_NA_JANELA, "antes"));
  }, 240_000);

  it("a migration abortou com a janela ABERTA e o backfill JÁ FEITO", () => {
    expect(erro, "a migration precisa ter abortado — senão o teste não prova rollback").toMatch(/FALHA_DENTRO_DA_JANELA/);
    // 'D' = disabled: prova que o DISABLE já havia acontecido e o ENABLE ainda NÃO — a janela estava aberta.
    expect(erro, "no momento da falha o gatilho tinha de estar suspenso").toMatch(/tgenabled=D/);
    // E o UPDATE estrutural já havia rodado dentro dela.
    expect(erro, "o backfill do ledger já tinha acontecido quando a falha ocorreu").toMatch(new RegExp(`preenchidos=${LEDGER}`));
  });

  it("o ENABLE não chegou a executar — e mesmo assim o rollback devolve o gatilho HABILITADO", async () => {
    const e = await estado();
    expect(e.tg, "'O' = origin (habilitado); 'D' seria o ledger desprotegido em produção").toBe("O");
  });

  it("UPDATE de campo de negócio volta a ser recusado", async () => {
    await expect(db.query("update erp.stock_movements set quantity = quantity + 1")).rejects.toThrow(/LEDGER_IMMUTABLE/);
  });

  it("DELETE volta a ser recusado", async () => {
    await expect(db.query("delete from erp.stock_movements")).rejects.toThrow(/LEDGER_IMMUTABLE/);
  });

  it("nenhum efeito estrutural sobreviveu e a 0014 não consta aplicada", async () => {
    const e = await estado();
    expect(e.col, "a coluna empresa_id da 0014 não pode ter sobrado").toBe(false);
    expect(Number(e.migr), "0014 não pode constar como aplicada").toBe(0);
    expect(Number(e.linhas), "o acervo continua íntegro").toBe(LEDGER);
  });
});

describe("falha DEPOIS da janela (guarda posterior da própria 0014)", () => {
  let erro = "";
  beforeAll(async () => {
    await baseAte0013();
    erro = await tentarMigration(`${zero14().sql}\ndo $$ begin raise exception 'FALHA_CONTROLADA_DE_TESTE'; end $$;`);
  }, 240_000);

  it("o rollback devolve o ledger protegido e não registra a 0014", async () => {
    expect(erro).toMatch(/FALHA_CONTROLADA_DE_TESTE/);
    const e = await estado();
    expect(Number(e.migr)).toBe(0);
    expect(e.col).toBe(false);
    expect(e.tg).toBe("O");
  });

  it("e o ledger continua recusando UPDATE e DELETE", async () => {
    await expect(db.query("update erp.stock_movements set quantity = quantity + 1")).rejects.toThrow(/LEDGER_IMMUTABLE/);
    await expect(db.query("delete from erp.stock_movements")).rejects.toThrow(/LEDGER_IMMUTABLE/);
  });

  it("o acervo continua íntegro", async () => {
    expect(Number((await estado()).linhas)).toBe(LEDGER);
  });
});

describe("precondição: a 0014 recusa um ledger que chega sem a proteção esperada", () => {
  beforeAll(async () => { await baseAte0013(); }, 240_000);

  /** Prepara um estado alterado do gatilho e roda a 0014 na MESMA transação, sempre revertida no fim. */
  async function comGatilho(preparo: string): Promise<string> {
    const c = await db.connect();
    try {
      await c.query("begin");
      await c.query(preparo);
      await c.query(zero14().sql);
      return "";
    } catch (e) { return (e as Error).message; } finally { await c.query("rollback"); c.release(); }
  }

  it("gatilho AUSENTE: a migration para em vez de 'instalar' segurança que o banco não tinha", async () => {
    const erro = await comGatilho("drop trigger trg_stock_movement_immutable on erp.stock_movements");
    expect(erro).toMatch(/exatamente 1 gatilho trg_stock_movement_immutable/);
    expect(erro).toMatch(/encontrado\(s\): 0/);
  });

  it("gatilho DESABILITADO: a migration para em vez de consertar de passagem um ledger desprotegido", async () => {
    const erro = await comGatilho("alter table erp.stock_movements disable trigger trg_stock_movement_immutable");
    expect(erro).toMatch(/não está habilitado/);
    expect(erro).toMatch(/tgenabled=D/);
  });

  it("gatilho de OUTRA função com o mesmo nome: também é recusado", async () => {
    const erro = await comGatilho(
      `drop trigger trg_stock_movement_immutable on erp.stock_movements;
       create or replace function erp.impostor() returns trigger language plpgsql as $f$ begin return new; end $f$;
       create trigger trg_stock_movement_immutable before update or delete on erp.stock_movements for each row execute function erp.impostor()`);
    expect(erro).toMatch(/exatamente 1 gatilho trg_stock_movement_immutable/);
  });

  it("gatilho correto e habilitado: a migration segue normalmente", async () => {
    const erro = await comGatilho("select 1");
    expect(erro, "com o estado esperado a 0014 não pode ser barrada pela precondição").toBe("");
  });

  it("e depois de aplicar a 0014 de verdade o gatilho continua habilitado", async () => {
    const erro = await tentarMigration(zero14().sql);
    expect(erro).toBe("");
    const e = await estado();
    expect(e.tg).toBe("O");
    expect(Number(e.migr)).toBe(1);
  }, 120_000);
});
