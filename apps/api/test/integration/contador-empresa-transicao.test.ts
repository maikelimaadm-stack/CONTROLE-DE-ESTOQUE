import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, resetSchema, migrate, type Db } from "@agro/db";
import { SEQUENCIA_EMPRESA } from "../../src/lib/sequencia-empresa.js";
import { TEST_URL } from "./setup.js";

/**
 * DOIS NOMES DE ENTIDADE SÃO DOIS CONTADORES — P0 DA TRANSIÇÃO farm → empresa (PRE-BASE2-05C-0).
 *
 * `erp.code_sequences` tem chave primária `(organization_id, entity)`. Disso decorre um fato que o desenho
 * "conservador" da troca de contador contradiz sem perceber: `'farm'` e `'empresa'` não são dois rótulos do
 * mesmo contador — são DUAS LINHAS, dois travamentos de linha e dois valores correntes independentes.
 *
 * O plano que parece mais seguro — COPIAR a linha de `'farm'` para `'empresa'` e MANTER AS DUAS durante o
 * rollout, para que nenhuma versão fique sem contador — é justamente o que colide. Durante a janela em que
 * as duas APIs estão no ar (Railway e Vercel não trocam de versão juntos), a antiga incrementa `'farm'`, a
 * nova incrementa `'empresa'`, e as duas devolvem O MESMO próximo número. O segundo cadastro morre no
 * `unique (organization_id, code)` de `erp.empresas` — em produção, no meio do rollout, para o usuário.
 *
 * Este teste NÃO troca o contador (a constante segue `'farm'` nesta fatia, e nenhuma DDL roda aqui): ele
 * MEDE a propriedade do banco que torna a troca perigosa, para que a fatia destrutiva encontre o fato já
 * estabelecido em vez de descobri-lo em produção. Tudo acontece dentro de uma transação desfeita ao final —
 * nenhuma linha sobrevive ao teste.
 */
let db: Db;
beforeAll(async () => {
  db = createPool(TEST_URL, { max: 1 });   // max 1: `begin`/`rollback` precisam da MESMA conexão
  await resetSchema(db); await migrate(db, () => {});
}, 240_000);
afterAll(async () => { await db?.end(); });

/**
 * Organização própria, criada DENTRO da transação que será desfeita. Reaproveitar a organização semeada
 * amarraria este teste ao estado do seed — e mexer no contador de uma organização real deixaria efeito
 * colateral em quem rodasse depois. Aqui o cenário é inteiro e descartável.
 */
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

  it("a constante desta fatia ainda é a LEGADA — a troca é de outra fatia, com o dado junto", () => {
    // Fixado de propósito: se alguém trocar a constante sem a migration que move a linha, este teste
    // reprova ANTES de o contador zerar em produção (`last_value` de uma linha inexistente começa em 1).
    expect(SEQUENCIA_EMPRESA, "trocar isto sem mover a linha de erp.code_sequences zera o contador").toBe("farm");
  });

  it("copiar a linha e MANTER AS DUAS faz os dois lados emitirem o MESMO número", async () => {
    await db.query("begin");
    try {
      const orgId = await orgDescartavel("[TEST] contador dois lados");
      // Estado de partida realista: o contador legado já numerou empresas.
      await db.query("insert into erp.code_sequences (organization_id, entity, last_value) values ($1,'farm',2)", [orgId]);
      // O desenho "conservador" da 05C-1: copiar para o nome canônico e deixar os dois de pé.
      await db.query("insert into erp.code_sequences (organization_id, entity, last_value) select organization_id, 'empresa', last_value from erp.code_sequences where organization_id=$1 and entity='farm'", [orgId]);

      const legado = Number((await db.query<{ n: string }>("select erp.next_code($1,'farm')::text n", [orgId])).rows[0]!.n);
      const canonico = Number((await db.query<{ n: string }>("select erp.next_code($1,'empresa')::text n", [orgId])).rows[0]!.n);
      expect(legado, "a API antiga emitiria 3").toBe(3);
      expect(canonico, "e a API nova emitiria 3 TAMBÉM — dois contadores, um espaço de códigos").toBe(legado);
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

  it("um único contador compartilhado NÃO repete — que é a razão de a troca ter de ser uma substituição, não uma cópia", async () => {
    await db.query("begin");
    try {
      const orgId = await orgDescartavel("[TEST] contador compartilhado");
      await db.query("insert into erp.code_sequences (organization_id, entity, last_value) values ($1,'farm',2)", [orgId]);
      const a = Number((await db.query<{ n: string }>("select erp.next_code($1,'farm')::text n", [orgId])).rows[0]!.n);
      const b = Number((await db.query<{ n: string }>("select erp.next_code($1,'farm')::text n", [orgId])).rows[0]!.n);
      expect([a, b], "o mesmo contador, chamado duas vezes, anda").toEqual([3, 4]);
    } finally { await db.query("rollback"); }
  });
});
