import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "../src/pool.js";
import { migrate, resetSchema, listMigrations } from "../src/migrate.js";
import { TEST_URL } from "./setup.js";

/**
 * O RUNNER É FORWARD-ONLY — E É ISSO QUE TORNA O ROLLBACK DO RAILWAY SEGURO (PRE-BASE2-05C-G2).
 *
 * A pergunta mais cara do preflight destrutivo era "um rollback reexecuta o pre-deploy?". Nenhuma página
 * oficial do Railway afirma nem nega, e o gate ficou BLOCKED por isso. A pergunta estava errada: o que
 * importa não é SE ele reexecuta, é o que acontece QUANDO reexecuta.
 *
 * O cenário é este: a 05C-1 aplica a purga, o deploy vai mal por qualquer motivo, e o Railway volta para a
 * imagem ANTERIOR — cujo diretório de migrations NÃO contém a migration que já está no ledger. Se o runner
 * tentasse "reconciliar" essa divergência, um rollback de CÓDIGO viraria downgrade de BANCO, e a fatia
 * destrutiva ficaria sem caminho de volta.
 *
 * Ele não tenta. `migrate()` itera sobre o DIRETÓRIO e usa o ledger apenas para PULAR o que já foi
 * aplicado. Não existe `down`, não existe comparação ledger × diretório, e o único caminho que remove
 * schema é `resetSchema` — função separada, alcançável só pelo comando `reset` do cli, que ainda exige
 * `ALLOW_DB_RESET=1`.
 *
 * Este teste prende essa propriedade: se alguém acrescentar reconciliação de ledger ao runner, o caminho de
 * volta da 05C-1 deixa de existir em silêncio, e é este arquivo que reprova.
 *
 * A divergência é montada do jeito que ela realmente aparece — uma LINHA NO LEDGER cujo arquivo o binário
 * corrente não tem — em vez de trocar `MIGRATIONS_DIR`, que é lido uma vez na carga do módulo e não
 * representaria o binário anterior de forma honesta.
 *
 * O que este teste NÃO prova, e por isso está escrito aqui: que o BINÁRIO anterior funciona contra o schema
 * pós-purga. É outra pergunta — a auditoria estática do runtime não achou nenhuma consulta que dependa dos
 * objetos removidos, mas a prova de execução é o gate G-U5, que nasce com a própria 05C-1
 * (ver docs/PRE-BASE2-05C-1-PREFLIGHT.md).
 */
let db: Db;

/** O nome não existe em supabase/migrations — é justamente esse o ponto. */
const FUTURA = "0017_purga_que_o_binario_anterior_nao_conhece.sql";

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 2 });
  await resetSchema(db);
  await migrate(db, () => {});
}, 240_000);

afterAll(async () => {
  await db?.query("drop table if exists public.marca_purga_ficticia");
  await db?.query("delete from public.erp_migrations where name = $1", [FUTURA]);
  await db?.end();
});

describe("o runner de migrations é forward-only", () => {
  it("parte de um ledger completo e coerente com o diretório", async () => {
    const noDisco = listMigrations().map((m) => m.name);
    const ledger = await db.query<{ name: string }>("select name from public.erp_migrations order by name");
    // A premissa junto com a conclusão: sem migrations no disco, todo o resto passaria por vacuidade.
    expect(noDisco.length, "há migrations reais no diretório").toBeGreaterThanOrEqual(16);
    expect(ledger.rows.map((r) => r.name)).toEqual(noDisco);
    expect(noDisco, "a migration fictícia não existe no repositório").not.toContain(FUTURA);
  });

  it("uma entrada no ledger que o diretório NÃO conhece não é desfeita, e não faz o runner falhar", async () => {
    // Estado de rollback: a migration futura já correu (ledger + efeito no schema) e o binário atual não a tem.
    await db.query("create table public.marca_purga_ficticia(id int primary key)");
    await db.query("insert into public.marca_purga_ficticia values (1)");
    await db.query("insert into public.erp_migrations(name) values ($1)", [FUTURA]);

    const feitas = await migrate(db, () => {});

    expect(feitas, "nada a aplicar: o diretório não tem novidade").toEqual([]);
    const ledger = await db.query<{ n: string }>("select count(*)::text n from public.erp_migrations where name = $1", [FUTURA]);
    expect(ledger.rows[0]!.n, "a entrada desconhecida continua no ledger — o runner não a remove").toBe("1");
    const marca = await db.query<{ n: string }>("select count(*)::text n from public.marca_purga_ficticia");
    expect(marca.rows[0]!.n, "o efeito da migration futura sobreviveu intacto").toBe("1");
  });

  it("e continua assim na execução seguinte — idempotente, nunca reconciliador", async () => {
    const feitas = await migrate(db, () => {});
    expect(feitas).toEqual([]);
    const ainda = await db.query<{ n: string }>("select count(*)::text n from public.erp_migrations where name = $1", [FUTURA]);
    expect(ainda.rows[0]!.n).toBe("1");
  });

  it("o schema do produto continua de pé depois de tudo isso", async () => {
    const t = await db.query<{ n: string }>(
      "select count(*)::text n from information_schema.tables where table_schema='erp' and table_type='BASE TABLE'");
    expect(Number(t.rows[0]!.n), "o runner não derrubou nada do schema erp").toBeGreaterThan(100);
  });
});
