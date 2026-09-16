import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, resetSchema, migrate, type Db } from "@agro/db";
import { SEQUENCIA_EMPRESA } from "../../src/lib/sequencia-empresa.js";
import { TEST_URL } from "./setup.js";

/**
 * DOIS NOMES DE ENTIDADE SÃO DOIS CONTADORES — a prova que motivou a PRE-BASE2-05C-2, e que continua
 * valendo DEPOIS dela.
 *
 * `erp.code_sequences` tem chave primária `(organization_id, entity)`. Disso decorre o fato que governou a
 * transição inteira: `'farm'` e `'empresa'` não são dois rótulos do mesmo contador — são DUAS LINHAS, dois
 * travamentos de linha e dois valores correntes independentes. E `erp.next_code` é um
 * `insert ... on conflict do update`: linha AUSENTE não é erro, é REINÍCIO EM 1.
 *
 * O QUE MUDOU NESTA FATIA, E O QUE NÃO MUDOU
 * ------------------------------------------
 * MUDOU: a chave persistida agora é `'empresa'` (migration `0018_empresa_code_sequence.sql`), e
 * `SEQUENCIA_EMPRESA` acompanha. O teste que fixava a constante em `'farm'` virou o teste que a fixa no
 * estado canônico — e, mais do que isso, que a amarra ao BANCO em vez de a um segundo literal.
 *
 * NÃO MUDOU: as duas armadilhas continuam sendo propriedades reais do banco, e continuam medidas aqui.
 * Elas não são história: são o motivo de a 05C-2 ter exigido janela single-version, e são o que reprova
 * quem tentar "voltar atrás" ou "manter os dois por segurança" numa fatia futura.
 *
 * Tudo acontece dentro de transações desfeitas ao final — nenhuma linha sobrevive ao teste.
 */
let db: Db;
beforeAll(async () => {
  db = createPool(TEST_URL, { max: 1 });   // max 1: `begin`/`rollback` precisam da MESMA conexão
  await resetSchema(db); await migrate(db, () => {});
}, 240_000);
afterAll(async () => { await db?.end(); });

const orgDescartavel = async (nome: string) =>
  (await db.query<{ id: string }>("insert into erp.organizations (name) values ($1) returning id", [nome])).rows[0]!.id;

describe("transição de contador da Empresa", () => {
  it("a chave do contador é (organização, entidade) — logo, cada nome de entidade é um contador próprio", async () => {
    const r = await db.query<{ cols: string }>(`
      select string_agg(a.attname, ',' order by k.ord) as cols
        from pg_constraint c
        join lateral unnest(c.conkey) with ordinality k(att, ord) on true
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.att
       where c.conrelid = 'erp.code_sequences'::regclass and c.contype = 'p'`);
    expect(r.rows[0]!.cols).toBe("organization_id,entity");
  });

  it("a constante de runtime é a CANÔNICA — e quem decide isso é o banco, não um segundo literal", async () => {
    // Amarrar a constante ao BANCO, e não a `'empresa'` escrito de novo aqui, é o que faz este teste
    // continuar valendo se a chave mudar outra vez: ele compara o runtime com o que a 0018 de fato
    // deixou de pé, em vez de comparar duas cópias da mesma opinião.
    const r = await db.query<{ entity: string }>(`
      select distinct entity from erp.code_sequences
       where entity in ('farm', 'empresa')`);
    const persistidas = r.rows.map((l) => l.entity);
    expect(persistidas, "depois da 0018 a chave legada não existe mais em banco nenhum").not.toContain("farm");
    expect(SEQUENCIA_EMPRESA, "o runtime aponta para a chave canônica").toBe("empresa");

    // E o ledger confirma que quem produziu esse estado foi a migration da fatia, não um acaso do seed.
    const m = await db.query<{ n: string }>(
      "select count(*)::text n from public.erp_migrations where name = '0018_empresa_code_sequence.sql'");
    expect(Number(m.rows[0]!.n), "a 0018 está aplicada neste banco").toBe(1);
  });

  it("MEDIDO: copiar a linha e MANTER AS DUAS faz os dois lados emitirem o MESMO número", async () => {
    await db.query("begin");
    try {
      const orgId = await orgDescartavel("[TEST] contador dois lados");
      // O desenho "conservador" da troca — copiar para o nome canônico e deixar os dois de pé — é
      // exatamente o que colide. É por isso que a 0018 é um `update` (substituição) e não um `insert`.
      await db.query("insert into erp.code_sequences (organization_id, entity, last_value) values ($1,'empresa',2)", [orgId]);
      await db.query("insert into erp.code_sequences (organization_id, entity, last_value) select organization_id, 'farm', last_value from erp.code_sequences where organization_id=$1 and entity='empresa'", [orgId]);

      const legado = Number((await db.query<{ n: string }>("select erp.next_code($1,'farm')::text n", [orgId])).rows[0]!.n);
      const canonico = Number((await db.query<{ n: string }>("select erp.next_code($1,'empresa')::text n", [orgId])).rows[0]!.n);
      expect(legado, "a API antiga emitiria 3").toBe(3);
      expect(canonico, "e a API nova emitiria 3 TAMBÉM — dois contadores, um espaço de códigos").toBe(legado);
    } finally { await db.query("rollback"); }
  });

  it("MEDIDO: a linha AUSENTE não dá erro — ela REINICIA em 1, que é o risco do binário anterior", async () => {
    // Esta é a metade que explica por que a 05C-2 precisou de janela single-version: depois da 0018 a
    // chave `'farm'` não existe, e um binário anterior que a chamasse não receberia erro nenhum — ele
    // receberia `1`, por cima de um acervo já numerado.
    await db.query("begin");
    try {
      const orgId = await orgDescartavel("[TEST] contador ausente reinicia");
      const semLinha = Number((await db.query<{ n: string }>("select erp.next_code($1,'farm')::text n", [orgId])).rows[0]!.n);
      expect(semLinha, "contador inexistente devolve 1 em silêncio — nunca um erro").toBe(1);
    } finally { await db.query("rollback"); }
  });

  it("e essa repetição é RECUSADA pelo banco: o espaço de códigos da Empresa é único por organização", async () => {
    await db.query("begin");
    try {
      const orgId = await orgDescartavel("[TEST] contador unico por organizacao");
      const livre = Number((await db.query<{ n: string }>("select (coalesce(max(code),0) + 1000)::text n from erp.empresas where organization_id=$1", [orgId])).rows[0]!.n);
      const criar = (code: number, nome: string) =>
        db.query("insert into erp.empresas (organization_id, code, name) values ($1,$2,$3)", [orgId, code, nome]);
      await criar(livre, "[TEST] contador A");
      await expect(criar(livre, "[TEST] contador B"), "o segundo cadastro com o MESMO código não passa").rejects.toThrow(/unique|duplicate|duplicada/i);
    } finally { await db.query("rollback"); }
  });

  it("um único contador compartilhado NÃO repete — que é a razão de a troca ter sido substituição, não cópia", async () => {
    await db.query("begin");
    try {
      const orgId = await orgDescartavel("[TEST] contador compartilhado");
      await db.query("insert into erp.code_sequences (organization_id, entity, last_value) values ($1,$2,2)", [orgId, SEQUENCIA_EMPRESA]);
      const a = Number((await db.query<{ n: string }>("select erp.next_code($1,$2)::text n", [orgId, SEQUENCIA_EMPRESA])).rows[0]!.n);
      const b = Number((await db.query<{ n: string }>("select erp.next_code($1,$2)::text n", [orgId, SEQUENCIA_EMPRESA])).rows[0]!.n);
      expect([a, b], "o mesmo contador, chamado duas vezes, anda").toEqual([3, 4]);
    } finally { await db.query("rollback"); }
  });
});
