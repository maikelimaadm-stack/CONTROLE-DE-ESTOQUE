import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { TEST_URL } from "./setup.js";

/**
 * PROD-FIX-0043 (decisão do Maike, 03/10/2026) — a pré-condição 2.3 da 0043 e a apply_stock_movement de PRODUÇÃO.
 *
 * Em produção a função é o corpo da 0003 SEM duas linhas de comentário (código idêntico; md5 lido do catálogo de
 * produção). A 0043 comparava o texto com os comentários e parou todo deploy da API desde a #90. Aqui, sobre o banco
 * até a 0042 e cada caso numa transação DESFEITA, como o runner aplica:
 *   · o corpo da 0003 passa (como sempre);
 *   · o corpo de produção passa — e sai da 0043 com a MESMA função que o caminho da 0003;
 *   · um corpo com mudança de CÓDIGO continua recusado ("schema divergente").
 */
let db: Db;
const ALVO = "0043_movimentacao_interna_estoque.sql";
const SQL_0043 = listMigrations().find((m) => m.name === ALVO)!.sql;
const DIVERGENTE = "OPERACOES-01 F5: a definicao vigente de erp.apply_stock_movement nao e a da 0003; schema divergente.";
const MD5_0003 = "4ae47891e483c1ccbdcdc1030959a79c";
const MD5_PRODUCAO = "9bc3083dd02d4a0429b59f7a59f5719f";
const COMENTARIOS_AUSENTES_EM_PRODUCAO = [
  "    -- saída sempre a custo médio corrente (regra de custo médio ponderado)\n",
  "  -- cache no produto: custo médio consolidado\n"
];

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 2 });
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of listMigrations().filter((x) => x.name < "0043")) {
    await db.query(m.sql);
    await db.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
  }
}, 300_000);
afterAll(async () => { await db?.end(); });

const md5Atual = async (q: { query: Db["query"] }) =>
  (await q.query<{ h: string }>("select md5(prosrc) h from pg_proc where oid = 'erp.apply_stock_movement()'::regprocedure")).rows[0]!.h;

/**
 * Numa transação desfeita: troca o corpo (função `trocar` recebe a definição vigente e devolve a nova; null mantém),
 * confere o md5 de partida, aplica a 0043 e devolve a mensagem da recusa (ou null) e o md5 depois da 0043.
 */
async function aplicar0043(trocar: ((def: string) => string) | null, md5Esperado: string | null) {
  const c = await db.connect();
  try {
    await c.query("begin");
    if (trocar) {
      const def = (await c.query<{ d: string }>("select pg_get_functiondef('erp.apply_stock_movement()'::regprocedure) d")).rows[0]!.d;
      const nova = trocar(def);
      expect(nova, "a troca mudou a definição").not.toBe(def);
      await c.query(nova);
    }
    const partida = await md5Atual(c);
    if (md5Esperado) expect(partida, "md5 de partida").toBe(md5Esperado);
    else expect([MD5_0003, MD5_PRODUCAO], "o corpo de partida não é nenhum dos dois aceitos").not.toContain(partida);
    let recusa: string | null = null;
    try { await c.query(SQL_0043); } catch (e) { recusa = (e as Error).message; }
    const depois = recusa ? null : await md5Atual(c);
    await c.query("rollback");
    return { recusa, depois };
  } finally { c.release(); }
}

const semComentarios = (def: string) => COMENTARIOS_AUSENTES_EM_PRODUCAO.reduce((d, linha) => {
  expect(d.includes(linha), `a linha de comentário existe no corpo da 0003: ${linha.trim()}`).toBe(true);
  return d.replace(linha, "");
}, def);

describe("PROD-FIX-0043 — a pré-condição 2.3 aceita a função de produção e só ela", () => {
  it("PREMISSA: sob a 0042 o corpo é o da 0003; tirar as duas linhas de comentário dá EXATAMENTE o md5 de produção", async () => {
    expect(await md5Atual(db)).toBe(MD5_0003);
    const c = await db.connect();
    try {
      await c.query("begin");
      const def = (await c.query<{ d: string }>("select pg_get_functiondef('erp.apply_stock_movement()'::regprocedure) d")).rows[0]!.d;
      await c.query(semComentarios(def));
      expect(await md5Atual(c)).toBe(MD5_PRODUCAO);
      await c.query("rollback");
    } finally { c.release(); }
  });

  it("o corpo da 0003 passa, e o de produção passa com o MESMO resultado (a 0043 troca as duas pela versão dela)", async () => {
    const pela0003 = await aplicar0043(null, MD5_0003);
    expect(pela0003.recusa).toBeNull();
    const pelaProducao = await aplicar0043(semComentarios, MD5_PRODUCAO);
    expect(pelaProducao.recusa).toBeNull();
    expect(pelaProducao.depois).toBe(pela0003.depois);
    expect([MD5_0003, MD5_PRODUCAO]).not.toContain(pela0003.depois);
  });

  it("corpo com mudança de CÓDIGO (sem o 'for update' do saldo) continua recusado como schema divergente", async () => {
    const semTrava = (def: string) => {
      expect(def.includes("   for update;"), "o corpo da 0003 trava o saldo").toBe(true);
      return def.replace("   for update;", "   ;");
    };
    const r = await aplicar0043(semTrava, null);
    expect(r.recusa).toBe(DIVERGENTE);
  });

  it("a variante de produção SEM a correção seria recusada (a prova de que o teste mede a mudança)", async () => {
    const original = SQL_0043.replace(
      "\n     and (select md5(p.prosrc) from pg_proc p where p.oid = 'erp.apply_stock_movement()'::regprocedure) <> '9bc3083dd02d4a0429b59f7a59f5719f' then",
      " then"
    );
    expect(original, "o texto da condição corrigida existe na 0043").not.toBe(SQL_0043);
    const c = await db.connect();
    try {
      await c.query("begin");
      const def = (await c.query<{ d: string }>("select pg_get_functiondef('erp.apply_stock_movement()'::regprocedure) d")).rows[0]!.d;
      await c.query(semComentarios(def));
      let recusa: string | null = null;
      try { await c.query(original); } catch (e) { recusa = (e as Error).message; }
      await c.query("rollback");
      expect(recusa).toBe(DIVERGENTE);
    } finally { c.release(); }
  });
});
