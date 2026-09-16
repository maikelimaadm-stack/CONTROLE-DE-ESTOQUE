import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "../src/pool.js";
import { resetSchema, migrate } from "../src/migrate.js";
import { TEST_URL } from "./setup.js";
import {
  ALVO, CANONICA, LEGADA, subirAte0017, aplicarCutover, fotoDoContador, linhasDaEntidade,
  empresaComCodigo, contador, proximoCodigo,
} from "./cutover-0018-ajuda.js";

/**
 * 0017 → 0018 COM ACERVO — PRE-BASE2-05C-2.
 *
 * `cutover-0018-fresh.test.ts` prova que a migration aplica num banco zero. Ele não pode provar o que
 * mais importa aqui: que o VALOR atravessou. Banco zero não tem contador, e um `update` que não casa
 * nenhuma linha executa sem reclamar — uma migration que perdesse o acervo do contador passaria inteira
 * naquele arquivo.
 *
 * Aqui o banco é montado só até a 0017 — exatamente o estado que produção tem hoje — e recebe um acervo
 * de contador propositalmente desconfortável: três organizações, valores diferentes, uma com LACUNA
 * (contador muito à frente do maior código, que é o que uma transação abortada deixa), uma sem Empresa
 * nenhuma, e contadores de OUTRAS entidades no meio para provar que o cutover não os arrasta.
 *
 * A prova central não é "a migration rodou": é a comparação do mapa organização -> valor antes e depois,
 * mais a continuidade medida pela porta real (`erp.next_code`), que é a única coisa que o usuário vê.
 */
let db: Db;

const ORG_A = "c0c0a000-0000-4000-8000-00000000000a";
const ORG_B = "c0c0a000-0000-4000-8000-00000000000b";
const ORG_C = "c0c0a000-0000-4000-8000-00000000000c";

/** Valores escolhidos para não serem redondos nem iguais entre si: coincidência não vira prova. */
const VALOR_A = 7;      // org A: 3 empresas, contador à frente por lacuna
const VALOR_B = 2;      // org B: 2 empresas, contador exatamente no maior código
const VALOR_C = 41;     // org C: NENHUMA empresa, contador mesmo assim — tem de atravessar
/** Contadores de outras entidades. `farm_transfer` é o caso que um `like 'farm%'` destruiria. */
const OUTROS: [string, number][] = [["farm_transfer", 13], ["product", 99], ["person", 5]];

let antes: Record<string, string>;

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 6 });
  await resetSchema(db);
  await subirAte0017(db);

  // Estado de produção pós-05C-1: a chave legada de pé, o canônico ausente.
  expect(await linhasDaEntidade(db, CANONICA), "antes do cutover não existe contador canônico").toBe(0);

  for (const [org, nome] of [[ORG_A, "[TEST] cutover A"], [ORG_B, "[TEST] cutover B"], [ORG_C, "[TEST] cutover C"]] as const) {
    await db.query("insert into erp.organizations (id, name) values ($1,$2)", [org, nome]);
  }
  // Acervo numerado, com códigos NÃO contíguos na org A (lacuna é normal e não é defeito).
  await empresaComCodigo(db, ORG_A, 1, "[TEST] A1");
  await empresaComCodigo(db, ORG_A, 2, "[TEST] A2");
  await empresaComCodigo(db, ORG_A, 5, "[TEST] A5");
  await empresaComCodigo(db, ORG_B, 1, "[TEST] B1");
  await empresaComCodigo(db, ORG_B, 2, "[TEST] B2");

  await contador(db, ORG_A, LEGADA, VALOR_A);
  await contador(db, ORG_B, LEGADA, VALOR_B);
  await contador(db, ORG_C, LEGADA, VALOR_C);
  for (const [entidade, valor] of OUTROS) await contador(db, ORG_A, entidade, valor);

  antes = await fotoDoContador(db);
}, 240_000);

afterAll(async () => { await db?.end(); });

describe("0017 → 0018: o contador muda de nome sem mudar de valor", () => {
  it("a migration aplica e entra no ledger uma única vez", async () => {
    const r = await aplicarCutover(db);
    expect(r.ok ? "aplicou" : r.erro).toBe("aplicou");
    const n = Number((await db.query<{ n: string }>(
      "select count(*)::text n from public.erp_migrations where name = $1", [ALVO])).rows[0]!.n);
    expect(n, "uma linha no ledger").toBe(1);
  });

  it("a chave legada não existe mais, e a canônica tem exatamente as mesmas organizações e valores", async () => {
    expect(await linhasDaEntidade(db, LEGADA), "zero linhas entity='farm'").toBe(0);

    const esperado = Object.fromEntries(
      Object.entries(antes)
        .filter(([k]) => k.endsWith(`|${LEGADA}`))
        .map(([k, v]) => [k.replace(`|${LEGADA}`, `|${CANONICA}`), v]));
    const depois = await fotoDoContador(db);
    const canonicos = Object.fromEntries(Object.entries(depois).filter(([k]) => k.endsWith(`|${CANONICA}`)));

    // Mapa contra mapa: prova de uma vez o CONJUNTO de organizações, cada VALOR, e que nada foi criado
    // ou perdido. Comparar só a contagem deixaria passar uma troca de valores entre duas organizações.
    expect(canonicos, "organização por organização, o valor é o mesmo de antes").toEqual(esperado);
    expect(Object.keys(canonicos), "as três organizações atravessaram — inclusive a que não tem Empresa").toHaveLength(3);
  });

  it("os contadores de OUTRAS entidades não foram tocados — inclusive farm_transfer", async () => {
    const depois = await fotoDoContador(db);
    for (const [entidade, valor] of OUTROS) {
      expect(depois[`${ORG_A}|${entidade}`], `${entidade} intacto: um like 'farm%' teria levado farm_transfer junto`)
        .toBe(String(valor));
    }
  });

  it("CONTINUIDADE: o próximo código é last_value + 1 pela porta real, em cada organização", async () => {
    expect(await proximoCodigo(db, ORG_A, CANONICA), "org A continua de onde parou").toBe(VALOR_A + 1);
    expect(await proximoCodigo(db, ORG_B, CANONICA), "org B continua de onde parou").toBe(VALOR_B + 1);
    expect(await proximoCodigo(db, ORG_C, CANONICA), "org C continua de onde parou, mesmo sem Empresa").toBe(VALOR_C + 1);
  });

  it("duas chamadas consecutivas andam — N+1 e N+2, sem repetir", async () => {
    const a = await proximoCodigo(db, ORG_B, CANONICA);
    const b = await proximoCodigo(db, ORG_B, CANONICA);
    expect([a, b], "o contador só sobe").toEqual([VALOR_B + 2, VALOR_B + 3]);
  });

  it("o código alocado é MAIOR que todo o acervo — é isso que a colisão quebraria", async () => {
    const maior = Number((await db.query<{ n: string }>(
      "select coalesce(max(code),0)::text n from erp.empresas where organization_id = $1", [ORG_A])).rows[0]!.n);
    const alocado = await proximoCodigo(db, ORG_A, CANONICA);
    expect(alocado, `${alocado} tem de ser maior que o maior código existente (${maior})`).toBeGreaterThan(maior);
  });

  it("o espaço (organização, código) continua único — a gravação com o código alocado passa, a repetida não", async () => {
    const alocado = await proximoCodigo(db, ORG_B, CANONICA);
    await empresaComCodigo(db, ORG_B, alocado, "[TEST] B nova pelo contador");
    await expect(
      empresaComCodigo(db, ORG_B, alocado, "[TEST] B repetida"),
      "o segundo cadastro com o MESMO código não passa").rejects.toThrow(/unique|duplicate|duplicada/i);
  });

  it("REGRESSÃO: o runner completo em cima de um banco já migrado não reaplica nada", async () => {
    const aplicadas = await migrate(db, () => {});
    expect(aplicadas, "ledger é a autoridade: nada pendente").toEqual([]);
    expect(await linhasDaEntidade(db, LEGADA), "e a chave legada continua sem existir").toBe(0);
  });
});
