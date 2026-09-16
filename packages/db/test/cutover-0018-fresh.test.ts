import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "../src/pool.js";
import { resetSchema, migrate } from "../src/migrate.js";
import { seedReference, seedDemo } from "../src/seed.js";
import { TEST_URL } from "./setup.js";
import { ALVO, CANONICA, LEGADA, linhasDaEntidade, orgDescartavel, proximoCodigo } from "./cutover-0018-ajuda.js";

/**
 * BANCO NOVO JÁ NASCE CANÔNICO — PRE-BASE2-05C-2.
 *
 * Um banco criado do zero depois desta fatia nunca viu a chave `'farm'` no contador, e não deve passar a
 * ver. Duas coisas separadas são cobradas aqui, e a segunda é a que quase escapou:
 *
 *   1. a sequência 0001..0018 aplica limpa, e a numeração de Empresa funciona pela chave canônica;
 *   2. o SEED não ressuscita a chave legada.
 *
 * O item 2 não é hipotético. Até esta fatia, `packages/db/src/seed.ts` alinhava o contador com o acervo
 * gravando `entity = 'farm'` — o mesmo nome que a 0018 acabara de aposentar. Num banco semeado depois da
 * migration passariam a existir AS DUAS linhas, que é exatamente o estado que a fatia inteira existe para
 * tornar impossível (e que a própria 0018 recusa na pré-condição 5.1). Em produção `SEED_ON_DEPLOY=0`,
 * então o estrago ficaria confinado ao CI e ao e2e — só que é ali que as provas do cutover rodam, e um
 * instrumento que corrompe o próprio cenário não reprova: ele mente.
 */
let db: Db;

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 5 });
  await resetSchema(db);
  const aplicadas = await migrate(db, () => {});
  expect(aplicadas, "a sequência inteira aplicou num banco zero").toContain(ALVO);
}, 240_000);

afterAll(async () => { await db?.end(); });

describe("banco novo: 0001..0018", () => {
  it("nenhuma linha de contador é obrigatória — o banco nasce sem contador de Empresa", async () => {
    expect(await linhasDaEntidade(db, LEGADA), "sem a chave legada").toBe(0);
    expect(await linhasDaEntidade(db, CANONICA), "e sem a canônica: ela nasce na primeira alocação").toBe(0);
  });

  it("a primeira Empresa de uma organização nova é numerada pela chave CANÔNICA", async () => {
    const org = await orgDescartavel(db, "[TEST] fresh org nova");
    const primeiro = await proximoCodigo(db, org, CANONICA);
    expect(primeiro, "a primeira alocação de um contador inexistente é 1").toBe(1);
    await db.query("insert into erp.empresas (organization_id, code, name) values ($1,$2,$3)",
      [org, primeiro, "[TEST] fresh primeira"]);

    const segundo = await proximoCodigo(db, org, CANONICA);
    expect(segundo, "e a seguinte anda").toBe(2);
    expect(await linhasDaEntidade(db, LEGADA), "nenhuma linha 'farm' foi criada no caminho").toBe(0);
  });

  it("o SEED não ressuscita a chave legada — alinha o contador pelo nome canônico", async () => {
    await seedReference(db, () => {});
    await seedDemo(db, {}, () => {});

    expect(await linhasDaEntidade(db, LEGADA),
      "o seed gravava 'farm' até a 05C-2; se voltar a gravar, o cutover é desfeito a cada semeadura").toBe(0);

    const canonicos = await db.query<{ organization_id: string; last_value: string }>(
      "select organization_id::text, last_value::text from erp.code_sequences where entity = $1", [CANONICA]);
    expect(canonicos.rowCount, "o seed alinhou o contador canônico da organização demo").toBeGreaterThan(0);

    // E alinhou com o ACERVO: o seed grava as empresas com código 1 e 2 escritos à mão. Se o contador
    // ficasse em zero, o primeiro cadastro pela tela pediria 1 e colidiria com a empresa 1 que já existe.
    for (const linha of canonicos.rows) {
      const maior = Number((await db.query<{ n: string }>(
        "select coalesce(max(code),0)::text n from erp.empresas where organization_id = $1",
        [linha.organization_id])).rows[0]!.n);
      expect(Number(linha.last_value),
        `o contador da organização ${linha.organization_id} tem de estar em dia com o acervo`).toBeGreaterThanOrEqual(maior);
    }
  });

  it("depois do seed, a alocação canônica continua à frente do acervo", async () => {
    const org = (await db.query<{ id: string }>(
      "select organization_id::text as id from erp.empresas group by organization_id limit 1")).rows[0]!.id;
    const maior = Number((await db.query<{ n: string }>(
      "select max(code)::text n from erp.empresas where organization_id = $1", [org])).rows[0]!.n);
    const alocado = await proximoCodigo(db, org, CANONICA);
    expect(alocado, `${alocado} tem de ser maior que ${maior} — senão o cadastro colide`).toBeGreaterThan(maior);
  });
});
