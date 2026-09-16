import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createPool, type Db } from "../src/pool.js";
import { resetSchema } from "../src/migrate.js";
import { TEST_URL } from "./setup.js";
import {
  CANONICA, LEGADA, subirAte0017, aplicarCutover, linhasDaEntidade, empresaComCodigo, contador, orgDescartavel,
} from "./cutover-0018-ajuda.js";

/**
 * O QUE SOBRA NO BANCO DEPOIS DO COMMIT/ROLLBACK — PRE-BASE2-05C-2.
 *
 * O cadastro de Empresa NÃO é uma sequência de queries soltas. `createOne` passa o MESMO `ctx.tx` para
 * `nextCode(...)` e para o `insert` de `erp.empresas` (`apps/api/src/routes/resources.ts`), e `runService`
 * roda dentro de `withTx`, que é `begin` → serviço → `commit`, com `rollback` em erro
 * (`packages/db/src/pool.ts`). Esta suíte reproduz exatamente esse envelope.
 *
 * POR QUE ISSO MERECE SUÍTE PRÓPRIA, e não só o `pnpm gate:05c2`:
 *
 *   1. o gate se DESATIVA sozinho quando a constante do contador é igual nos dois lados — ou seja, em
 *      TODA PR depois que a 05C-2 estiver em `main`. Se as provas transacionais vivessem só lá, elas
 *      desapareceriam exatamente quando o cutover virasse história e ninguém mais lembrasse do detalhe;
 *   2. aqui a pergunta não é "esta execução atravessa o cutover?", e sim "o que o `commit` decide?" —
 *      que é semântica de banco, verdadeira para sempre, independente de base e HEAD.
 *
 * E a distinção que a fatia inteira depende de acertar:
 *
 *   • o número emitido COLIDE  → o `insert` bate na unicidade, a transação volta atrás INTEIRA, e a linha
 *     de contador criada pela tentativa NÃO persiste. Barulhento (o usuário vê erro) e sem sequela;
 *   • o número NÃO colide      → o cadastro COMITA, e a chave ERRADA fica gravada. Silencioso e com
 *     sequela — é este caso que obriga a janela single-version.
 *
 * E o discriminador NÃO é "tem acervo / não tem" — esta foi a SEGUNDA modelagem errada desta fatia, achada
 * por red team independente. Uma organização cuja numeração não começa em 1 tem acervo e mesmo assim não
 * colide (T5): lá as duas chaves convivem para sempre e NADA levanta erro em momento nenhum.
 *
 * Modelar isso em autocommit (como o gate fazia antes) erra nos DOIS sentidos: inventa uma "ressurreição"
 * persistida no primeiro caso e descreve mal o que sobra no segundo.
 */
let db: Db;

const ORG = "c0a70001-0000-4000-8000-000000000001";

beforeEach(async () => {
  await db?.end();
  db = createPool(TEST_URL, { max: 4 });
  await resetSchema(db);
  await subirAte0017(db);
  await db.query("insert into erp.organizations (id, name) values ($1,$2)", [ORG, "[TEST] transacao 05C-2"]);
}, 240_000);

afterAll(async () => { await db?.end(); });

/**
 * O CADASTRO COMO A API O FAZ: uma transação, uma conexão. Devolve o número que `next_code` emitiu DENTRO
 * da transação (que pode ter sido desfeito) e se o `commit` chegou a acontecer.
 */
async function cadastrar(orgId: string, entidade: string, nome: string):
Promise<{ numero: number | null; comitou: boolean; erro: string | null }> {
  const c = await db.connect();
  let numero: number | null = null;
  try {
    await c.query("begin");
    numero = Number((await c.query<{ n: string }>(
      "select erp.next_code($1,$2)::text n", [orgId, entidade])).rows[0]!.n);
    await c.query("insert into erp.empresas (organization_id, code, name) values ($1,$2,$3)", [orgId, numero, nome]);
    await c.query("commit");
    return { numero, comitou: true, erro: null };
  } catch (e) {
    await c.query("rollback").catch(() => { /* a transação já pode ter morrido */ });
    return { numero, comitou: false, erro: (e as Error).message };
  } finally {
    c.release();
  }
}

/** Os códigos realmente gravados, que é o que o usuário enxerga. */
async function codigos(orgId: string): Promise<number[]> {
  const r = await db.query<{ code: number }>(
    "select code from erp.empresas where organization_id=$1 order by code", [orgId]);
  return r.rows.map((l) => Number(l.code));
}

/** Os contadores realmente persistidos para a organização. */
async function contadores(orgId: string): Promise<string[]> {
  const r = await db.query<{ entity: string; v: string }>(
    "select entity, last_value::text v from erp.code_sequences where organization_id=$1 order by entity", [orgId]);
  return r.rows.map((l) => `${l.entity}=${l.v}`);
}

describe("o commit decide o estrago — estado persistente após o cutover", () => {
  it("T1 · COM acervo, o binário ANTIGO falha e o rollback NÃO deixa a chave legada para trás", async () => {
    await empresaComCodigo(db, ORG, 1, "[TEST] e1");
    await empresaComCodigo(db, ORG, 2, "[TEST] e2");
    await contador(db, ORG, LEGADA, 2);
    expect((await aplicarCutover(db)).ok, "premissa: o cutover aplicou").toBe(true);

    const r = await cadastrar(ORG, LEGADA, "[TEST] tentativa antiga");

    expect(r.numero, "dentro da transação, next_code cria a chave ausente e devolve 1").toBe(1);
    expect(r.comitou, "mas o insert colide e a transação NÃO comita").toBe(false);
    expect(r.erro ?? "", "a colisão é a unicidade de código").toMatch(/duplicat|unique/i);

    // O CORAÇÃO DESTE CASO: a linha que `next_code` criou morreu junto com a transação.
    expect(await linhasDaEntidade(db, LEGADA),
      "a chave legada NÃO persiste — não existe ressurreição aqui").toBe(0);
    expect(await contadores(ORG), "só o contador canônico sobrou").toEqual([`${CANONICA}=2`]);
    expect(await codigos(ORG), "e o acervo ficou intacto").toEqual([1, 2]);
  });

  it("T2 · SEM Empresa, o binário ANTIGO COMITA a chave legada — e o dano PERSISTE, em silêncio", async () => {
    await empresaComCodigo(db, ORG, 1, "[TEST] outra org tem acervo");
    await contador(db, ORG, LEGADA, 1);
    expect((await aplicarCutover(db)).ok).toBe(true);

    // A organização do caso: recém-criada, ainda sem Empresa nenhuma.
    const vazia = await orgDescartavel(db, "[TEST] sem acervo");

    const antigo = await cadastrar(vazia, LEGADA, "[TEST] primeira pelo binário antigo");
    expect(antigo.numero, "recebe 1").toBe(1);
    expect(antigo.comitou, "e COMITA — nenhum erro é levantado, que é o que torna este caso pior").toBe(true);
    expect(await contadores(vazia), "a chave legada fica gravada DEPOIS do cutover").toEqual([`${LEGADA}=1`]);
    expect(await codigos(vazia)).toEqual([1]);

    // O preço aparece no próximo cadastro canônico — e a tentativa dele REVERTE.
    const canonico = await cadastrar(vazia, CANONICA, "[TEST] pelo binário novo");
    expect(canonico.numero, "o canônico emite o MESMO 1").toBe(1);
    expect(canonico.comitou, "e morre na unicidade").toBe(false);
    expect(await contadores(vazia),
      "não ficam DOIS contadores: a tentativa canônica reverteu, sobra só a legada").toEqual([`${LEGADA}=1`]);
    expect(await codigos(vazia), "e o código 1 continua sendo o único").toEqual([1]);
  });

  it("T3 · PRÉ-0018 com acervo, o binário NOVO falha e a chave canônica NÃO persiste", async () => {
    await empresaComCodigo(db, ORG, 1, "[TEST] e1");
    await empresaComCodigo(db, ORG, 2, "[TEST] e2");
    await contador(db, ORG, LEGADA, 2);
    // de propósito SEM aplicar a 0018: é o sentido inverso da janela

    const r = await cadastrar(ORG, CANONICA, "[TEST] tentativa nova");

    expect(r.numero, "o canônico também recebe 1, porque a chave ainda não existe").toBe(1);
    expect(r.comitou, "e colide").toBe(false);
    expect(r.erro ?? "", "pela mesma unicidade de código de T1").toMatch(/duplicat|unique/i);
    expect(await linhasDaEntidade(db, CANONICA),
      "a chave canônica criada na tentativa NÃO persiste").toBe(0);
    expect(await contadores(ORG), "o contador legado seguiu intacto").toEqual([`${LEGADA}=2`]);
    expect(await codigos(ORG)).toEqual([1, 2]);
  });

  it("T4 · PRÉ-0018 e SEM Empresa, o binário NOVO comita a canônica — e a 0018 passa a RECUSAR o banco", async () => {
    await empresaComCodigo(db, ORG, 1, "[TEST] org com acervo");
    await contador(db, ORG, LEGADA, 1);

    const vazia = await orgDescartavel(db, "[TEST] Q4b sem acervo");
    const novo = await cadastrar(vazia, CANONICA, "[TEST] primeira pelo binário novo");
    expect(novo.numero).toBe(1);
    expect(novo.comitou, "sem colisão, COMITA — ainda pré-0018").toBe(true);
    expect(await contadores(vazia), "a canônica existe ANTES da migration").toEqual([`${CANONICA}=1`]);

    // E agora o banco está no estado da CÓPIA: as duas chaves de pé, em organizações diferentes.
    const r = await aplicarCutover(db);
    expect(r.ok, "a 0018 tem de RECUSAR — escolher entre as duas é decisão humana").toBe(false);
    expect(r.ok ? "" : r.erro, "e a recusa NOMEIA o caso").toMatch(/entity='empresa'|linha\(s\) entity/i);

    // Sem transição parcial: o que existia antes continua exatamente como estava.
    expect(await linhasDaEntidade(db, LEGADA), "a legada segue de pé").toBe(1);
    expect(await contadores(vazia), "e a canônica da organização vazia também").toEqual([`${CANONICA}=1`]);
    const ledger = Number((await db.query<{ n: string }>(
      "select count(*)::text n from public.erp_migrations where name like '0018%'")).rows[0]!.n);
    expect(ledger, "o ledger não registra um cutover que não aconteceu").toBe(0);
  });

  it("T5 · acervo LACUNAR: tem Empresas, não colide, e NADA nunca denuncia o estado", async () => {
    // Acervo que não começa em 1 — códigos 5 e 6. É o caso que desmonta "com acervo = barulhento".
    await empresaComCodigo(db, ORG, 5, "[TEST] e5");
    await empresaComCodigo(db, ORG, 6, "[TEST] e6");
    await contador(db, ORG, LEGADA, 6);
    expect((await aplicarCutover(db)).ok, "premissa: o cutover aplicou").toBe(true);

    // O binário ANTIGO serve três cadastros. A chave ressuscitada emite 1, 2, 3 — todos LIVRES.
    for (const esperado of [1, 2, 3]) {
      const r = await cadastrar(ORG, LEGADA, `[TEST] antigo ${esperado}`);
      expect(r.numero, "a chave legada ressuscitada emite o próximo livre").toBe(esperado);
      expect(r.comitou, "e COMITA — não há com o que colidir, então nenhum erro é levantado").toBe(true);
    }

    // E o cadastro canônico seguinte TAMBÉM passa: a chave canônica ficou intacta em 6 e emite 7.
    // É isto que torna este caso pior que T2, onde o canônico seguinte pelo menos morria.
    const canonico = await cadastrar(ORG, CANONICA, "[TEST] canônico depois");
    expect(canonico.numero, "a canônica seguiu do acervo real").toBe(7);
    expect(canonico.comitou, "e também COMITA — nada denuncia o estado").toBe(true);

    expect(await contadores(ORG), "duas chaves convivendo na MESMA organização, indefinidamente")
      .toEqual([`${CANONICA}=7`, `${LEGADA}=3`]);
    expect(await codigos(ORG), "e a numeração de Empresa ficou embaralhada, sem nenhum erro pelo caminho")
      .toEqual([1, 2, 3, 5, 6, 7]);
  });
});
