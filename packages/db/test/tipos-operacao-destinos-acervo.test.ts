import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { TEST_URL } from "./setup.js";

/**
 * O BACKFILL DE `destinos_configurados` SOBRE ACERVO REAL (0022).
 *
 * Banco NOVO E VAZIO esconde esta prova por inteiro. Num banco fresco não existe versão anterior à 0022, e
 * então "o acervo nasceu `false`" é verdade sobre CONJUNTO VAZIO — inclusive a asserção que a própria
 * migration faz no fim dela. O único jeito de provar é ter linhas ANTES: este arquivo sobe o banco até a
 * 0021, escreve versões de TOP pelo caminho do binário ANTIGO, e só então aplica a 0022.
 *
 * E há um segundo motivo, específico desta tabela: `erp.tipos_operacao_versoes` RECUSA `UPDATE` desde a
 * 0020. O preenchimento das linhas existentes não pode vir de `update ... set destinos_configurados`; ele
 * só pode vir do `ADD COLUMN ... DEFAULT`, que é DDL. Este arquivo prova as duas metades do argumento na
 * mesma execução: que o UPDATE era mesmo impossível, e que mesmo assim as linhas antigas saíram preenchidas.
 */
let db: Db;
const ORG = "dddddddd-0000-4000-8000-000000000001";
const USER = "dddddddd-0000-4000-8000-000000000100";
const TOP = "dddddddd-0000-4000-8000-0000000000a0";
const VERSOES_DO_ACERVO = 2;

/** Aplica UMA migration pelo prefixo do nome, do mesmo jeito que o runner aplica: transação e registro. */
async function aplicar(prefixo: string) {
  const m = listMigrations().find((x) => x.name.startsWith(prefixo));
  expect(m, `migration ${prefixo} precisa existir`).toBeTruthy();
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query(m!.sql);
    await c.query("insert into public.erp_migrations(name) values ($1)", [m!.name]);
    await c.query("commit");
  } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
}

/** Retrato do acervo montado sob a 0021 — o vocabulário do binário antigo, sem nenhuma coluna da 0022. */
async function acervoSob0021() {
  await db.query(`insert into erp.organizations(id,name,legal_name,document,slug)
                  values ($1,'[TEST] Acervo TOP','[TEST] Acervo TOP Ltda','00000000000353','acervotop')`, [ORG]);
  await db.query(`insert into erp.users(id,email,name,password_hash) values ($1,'acervo.top@t.local','Acervo','x')`, [USER]);
  await db.query(`insert into erp.organization_members(id,organization_id,user_id,is_owner) values ($1,$2,$1,true)`, [USER, ORG]);
  // TOP e versões na MESMA transação: a FK da versão corrente é `deferrable initially deferred`, e é a
  // ordem natural da escrita (pai antes do filho) que ela existe para aceitar.
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query(`insert into erp.tipos_operacao (id,organization_id,codigo,codigo_base,versao_atual,criado_por)
                   values ($1,$2,'A001','vendas.orcamento',$3,$4)`, [TOP, ORG, VERSOES_DO_ACERVO, USER]);
    for (let v = 1; v <= VERSOES_DO_ACERVO; v++) {
      await c.query(
        `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, criado_por)
         values ($1,$2,$3,$4,$5)`, [ORG, TOP, v, `Orcamento v${v}`, USER]);
    }
    await c.query("commit");
  } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
}

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 4 });
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of listMigrations().filter((x) => x.name < "0022")) {
    await db.query(m.sql);
    await db.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
  }
  await acervoSob0021();
}, 240_000);
afterAll(async () => { await db.end(); });

describe("0022 — `destinos_configurados` sobre acervo que já existia", () => {
  it("PREMISSA: sob a 0021 há versões e a coluna ainda NÃO existe", async () => {
    const linhas = await db.query<{ n: string }>(`select count(*)::text n from erp.tipos_operacao_versoes`);
    expect(Number(linhas.rows[0]!.n), "sem acervo, tudo abaixo seria verdade sobre conjunto vazio").toBe(VERSOES_DO_ACERVO);
    // Antes de afirmar que a coluna apareceu, é preciso afirmar que ela não estava lá.
    const col = await db.query(
      `select 1 from information_schema.columns
        where table_schema='erp' and table_name='tipos_operacao_versoes' and column_name='destinos_configurados'`);
    expect(col.rowCount, "a coluna é da 0022, não pode existir sob a 0021").toBe(0);
  });

  it("PREMISSA: sob a 0021 a tabela JÁ recusa UPDATE — o backfill não podia ser um UPDATE", async () => {
    // É esta recusa que torna `ADD COLUMN ... DEFAULT` a única forma possível de preencher as linhas
    // antigas. Desligar o gatilho para contornar seria abrir, por conveniência de migration, exatamente a
    // porta que ele existe para trancar.
    await expect(db.query(`update erp.tipos_operacao_versoes set nome = 'reescrito' where tipo_operacao_id = $1`, [TOP]))
      .rejects.toThrow(/TIPO_OPERACAO_VERSAO_IMUTAVEL/);
  });

  it("a 0022 aplica sobre o acervo sem abortar", async () => {
    // A própria 0022 termina com asserções que levantam exceção; se alguma delas reprovasse, a migration
    // inteira faria rollback e não estaria registrada aqui.
    await aplicar("0022");
    const r = await db.query<{ n: string }>(`select count(*)::text n from public.erp_migrations where name like '0022%'`);
    expect(Number(r.rows[0]!.n)).toBe(1);
  }, 120_000);

  it("TODA versão do acervo saiu preenchida com `false` — e nenhuma virou declarada", async () => {
    const r = await db.query<{ total: string; nulas: string; declaradas: string }>(
      `select count(*)::text as total,
              count(*) filter (where destinos_configurados is null)::text as nulas,
              count(*) filter (where destinos_configurados)::text as declaradas
         from erp.tipos_operacao_versoes`);
    // As três contagens juntas: o acervo continua inteiro, tem valor em toda linha, e o valor é o legado.
    expect(Number(r.rows[0]!.total), "nenhuma versão pode ter sumido na migração").toBe(VERSOES_DO_ACERVO);
    expect(Number(r.rows[0]!.nulas)).toBe(0);
    // `true` aqui seria política que ninguém escreveu — e o efeito dela é RECUSAR conversão no acervo inteiro.
    expect(Number(r.rows[0]!.declaradas)).toBe(0);
  });

  it("o resto da versão antiga continua intacto: preencher a coluna nova não reescreveu nada", async () => {
    const r = await db.query<{ versao: number; nome: string }>(
      `select versao, nome from erp.tipos_operacao_versoes where tipo_operacao_id=$1 order by versao`, [TOP]);
    expect(r.rows.map((x) => [x.versao, x.nome])).toEqual([[1, "Orcamento v1"], [2, "Orcamento v2"]]);
  });

  it("depois da 0022 o acervo continua imutável: a coluna nova não abriu porta de edição", async () => {
    await expect(db.query(
      `update erp.tipos_operacao_versoes set destinos_configurados = true where tipo_operacao_id = $1`, [TOP]))
      .rejects.toThrow(/TIPO_OPERACAO_VERSAO_IMUTAVEL/);
    const r = await db.query<{ n: string }>(
      `select count(*) filter (where destinos_configurados)::text n from erp.tipos_operacao_versoes`);
    expect(Number(r.rows[0]!.n), "a recusa não pode ter deixado efeito parcial").toBe(0);
  });
});
