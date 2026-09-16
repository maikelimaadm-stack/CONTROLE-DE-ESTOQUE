import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createPool, type Db } from "../src/pool.js";
import { resetSchema } from "../src/migrate.js";
import { TEST_URL } from "./setup.js";
import {
  ALVO, CANONICA, LEGADA, subirAte0017, aplicarCutover, sqlDoCutover, fotoDoContador,
  linhasDaEntidade, empresaComCodigo, contador, proximoCodigo,
} from "./cutover-0018-ajuda.js";

/**
 * A 0018 SOB CONCORRÊNCIA REAL — PRE-BASE2-05C-2.
 *
 * Nada aqui é simulado: cada cenário abre CONEXÕES DE VERDADE e as deixa disputando a mesma tabela,
 * porque a propriedade em jogo — "o contador não é lido, movido ou recriado por duas partes ao mesmo
 * tempo" — não existe fora de um banco com duas sessões.
 *
 * O que se cobra em todos os casos é o mesmo par: a migration falha BARATO (sem ficar pendurada segurando
 * lock) e o estado volta INTEIRO. `lock table ... nowait` e `set local lock_timeout = '2s'` são os dois
 * instrumentos, e cada um cobre um tipo de espera diferente — o NOWAIT enxerga lock de RELAÇÃO, o
 * `lock_timeout` cobre as esperas que o NOWAIT não pré-adquire.
 */
let db: Db;

const ORG = "c04c0111-0000-4000-8000-000000000001";
const VALOR = 9;

beforeEach(async () => {
  await db?.end();
  db = createPool(TEST_URL, { max: 8 });
  await resetSchema(db);
  await subirAte0017(db);
  await db.query("insert into erp.organizations (id, name) values ($1,$2)", [ORG, "[TEST] concorrencia"]);
  await empresaComCodigo(db, ORG, 1, "[TEST] C1");
  await empresaComCodigo(db, ORG, 2, "[TEST] C2");
  await contador(db, ORG, LEGADA, VALOR);
}, 240_000);

afterAll(async () => { await db?.end(); });

/** Segura uma transação aberta com um lock sobre a tabela e devolve como soltá-la. */
async function seguraLock(sql: string): Promise<() => Promise<void>> {
  const c = await db.connect();
  await c.query("begin");
  await c.query(sql);
  return async () => { await c.query("rollback").catch(() => {}); c.release(); };
}

describe("a 0018 sob concorrência", () => {
  it("DOIS runners simultâneos: um aplica, o outro morre — e o ledger fica com UMA linha", async () => {
    // A trava da fatia é `pg_try_advisory_xact_lock(2026, 52)`, transacional. O segundo runner não espera:
    // ele descobre que a transição já está em curso e aborta sem tocar em nada.
    const [a, b] = await Promise.all([aplicarCutover(db), aplicarCutover(db)]);
    const ok = [a, b].filter((r) => r.ok).length;
    const falhou = [a, b].filter((r) => !r.ok) as { ok: false; erro: string }[];

    expect(ok, "exatamente um dos dois aplicou").toBe(1);
    expect(falhou, "e exatamente um foi recusado").toHaveLength(1);
    // A recusa é a trava OU a pré-condição canônica — as duas são fail-closed e as duas são corretas,
    // porque dependem de qual transação chegou primeiro ao `commit`.
    expect(falhou[0]!.erro, `recusa esperada da fatia: ${falhou[0]!.erro}`)
      .toMatch(/trava do cutover do contador|entity='empresa'/i);

    const n = Number((await db.query<{ n: string }>(
      "select count(*)::text n from public.erp_migrations where name = $1", [ALVO])).rows[0]!.n);
    expect(n, "uma única linha no ledger").toBe(1);
    expect(await linhasDaEntidade(db, LEGADA), "e a transição aconteceu uma vez só").toBe(0);
    expect(await linhasDaEntidade(db, CANONICA)).toBe(1);
  });

  it("ESCRITOR no contador em curso: a migration falha BARATO em vez de ficar pendurada", async () => {
    const foto = await fotoDoContador(db);
    // Uma sessão que já alocou um código e ainda não fechou a transação — o caso real da API servindo.
    const soltar = await seguraLock(`select erp.next_code('${ORG}','${LEGADA}')`);
    try {
      const t0 = Date.now();
      const r = await aplicarCutover(db);
      const ms = Date.now() - t0;
      expect(r.ok, "a migration não pode atravessar um escritor em curso").toBe(false);
      // `lock table ... nowait` sobre code_sequences: a recusa é imediata, não uma espera de 2 s.
      expect(ms, `a recusa é barata (${ms} ms) — nada de segurar ACCESS EXCLUSIVE esperando`).toBeLessThan(2000);
      expect(r.ok ? "" : r.erro).toMatch(/lock|55P03|could not obtain/i);
    } finally { await soltar(); }
    expect(await fotoDoContador(db), "o estado voltou inteiro").toEqual(foto);
  });

  it("CRIAÇÃO de Empresa em curso: a migration também não atravessa", async () => {
    const foto = await fotoDoContador(db);
    // `erp.empresas` é travada em SHARE justamente para isto: a pré-condição compara `last_value` com
    // `max(code)`, e a comparação não vale se alguém estiver inserindo Empresa com código explícito.
    const soltar = await seguraLock(
      `insert into erp.empresas (organization_id, code, name) values ('${ORG}', 500, '[TEST] em voo')`);
    try {
      const r = await aplicarCutover(db);
      expect(r.ok, "não se move o contador com cadastro de Empresa em voo").toBe(false);
      expect(r.ok ? "" : r.erro).toMatch(/lock|55P03|could not obtain/i);
    } finally { await soltar(); }
    expect(await fotoDoContador(db), "o estado voltou inteiro").toEqual(foto);
  });

  it("depois que o escritor SOLTA, a migration aplica normalmente — a recusa era temporária, não um defeito", async () => {
    const soltar = await seguraLock(`select erp.next_code('${ORG}','${LEGADA}')`);
    const bloqueada = await aplicarCutover(db);
    expect(bloqueada.ok).toBe(false);
    await soltar();

    const r = await aplicarCutover(db);
    expect(r.ok ? "aplicou" : r.erro).toBe("aplicou");
    expect(await linhasDaEntidade(db, LEGADA)).toBe(0);
  });

  it("enquanto a migration roda, o contador fica INACESSÍVEL — não existe janela de leitura suja", async () => {
    // A transição abre a transação, trava a tabela e só então move a chave. Uma sessão que chegue no meio
    // não pode ver "nem farm nem empresa": ela espera, e quando entra o estado já é o novo. É isso que
    // impede a API antiga de recriar `'farm'` em 1 DURANTE a janela.
    const c = await db.connect();
    try {
      await c.query("begin");
      await c.query(sqlDoCutover());   // a transação da migration, ainda NÃO commitada

      // Uma segunda sessão tentando alocar: tem de esperar (não pode enxergar a tabela vazia).
      const outra = await db.connect();
      try {
        await outra.query("set lock_timeout = '300ms'");
        await expect(
          outra.query(`select erp.next_code('${ORG}','${CANONICA}')`),
          "com a migration em voo, alocar espera pelo lock — nunca lê um contador pela metade"
        ).rejects.toThrow(/lock timeout|canceling statement/i);
      } finally { outra.release(); }

      await c.query("rollback");
    } finally { c.release(); }

    // Rollback: nada aconteceu.
    expect(await linhasDaEntidade(db, LEGADA), "a chave legada continua lá depois do rollback").toBe(1);
    expect(await linhasDaEntidade(db, CANONICA), "e a canônica não nasceu").toBe(0);
  });

  it("ROLLBACK por falha de pré-condição preserva o estado integral, mesmo com o lock adquirido", async () => {
    // Estado que faz a migration abortar DEPOIS de ter travado as tabelas: o caminho mais longo até o
    // `raise`. Se o rollback fosse parcial, seria aqui que apareceria.
    await contador(db, ORG, CANONICA, 123);
    const foto = await fotoDoContador(db);

    const r = await aplicarCutover(db);
    expect(r.ok).toBe(false);
    expect(await fotoDoContador(db), "as duas linhas continuam exatamente como estavam").toEqual(foto);

    // E o contador legado continua funcionando: o banco não ficou num estado intermediário.
    expect(await proximoCodigo(db, ORG, LEGADA), "a chave legada segue alocando normalmente").toBe(VALOR + 1);
  });
});
