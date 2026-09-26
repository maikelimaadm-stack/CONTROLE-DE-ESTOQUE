import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Db } from "../src/pool.js";
import { SQL_ORGANIZACAO_DEMO } from "../src/origem-organizacao.js";
import { freshDb } from "./setup.js";

/**
 * GO-LIVE-01 — o inventário de produção é SÓ leitura.
 * S1 é estático (o arquivo não tem comando de escrita); S2 roda o arquivo inteiro numa transação
 * READ ONLY no banco de teste, onde o próprio Postgres recusaria qualquer escrita.
 */
const ARQUIVO = resolve(__dirname, "../../../docs/sql/inventario-go-live.sql");
const sql = readFileSync(ARQUIVO, "utf8");
/** Sem comentários e sem literais: o que sobra é o que o banco executa como comando. */
const semComentarios = (s: string) => s.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
const semComentariosNemLiterais = (s: string) => semComentarios(s).replace(/'(?:[^']|'')*'/g, "''");
const PROIBIDAS = ["insert", "update", "delete", "merge", "alter", "drop", "create", "grant", "revoke", "truncate", "copy", "call", "do", "execute", "set", "reset", "lock", "vacuum", "analyze", "comment", "refresh", "cluster", "reindex", "listen", "notify", "prepare", "begin", "commit", "rollback", "savepoint"];

export function comandosDeEscrita(texto: string): string[] {
  const codigo = semComentariosNemLiterais(texto).toLowerCase();
  return PROIBIDAS.filter((p) => new RegExp(`\\b${p}\\b`).test(codigo));
}
export function comandos(texto: string): string[] {
  // O arquivo não tem `;` dentro de literal (S1 confere que cada pedaço começa com SELECT).
  return semComentarios(texto).split(";").map((c) => c.trim()).filter(Boolean);
}

describe("inventário go-live", () => {
  it("S1: o arquivo só tem SELECT", () => {
    const cmds = comandos(sql);
    expect(cmds.length).toBe(7);
    for (const c of cmds) expect(c.toLowerCase()).toMatch(/^select\b/);
    expect(comandosDeEscrita(sql)).toEqual([]);
    // O detector reprova cada palavra proibida (prova de que a varredura não passa vazia).
    for (const p of ["insert into x values (1)", "UPDATE erp.users set name='x'", "delete from erp.users", "alter table x", "drop table x", "create table x()", "grant all on x to y", "truncate x", "copy x to stdout", "call f()", "do $$ begin end $$", "select 1; set role postgres"]) {
      expect(comandosDeEscrita(p), p).not.toEqual([]);
    }
    // Palavra dentro de literal ou comentário não conta; `updated_at` e `deleted_at` não são `update`/`delete`.
    expect(comandosDeEscrita("select 'drop table x' as t, deleted_at, updated_at from y -- insert")).toEqual([]);
  });

  it("S1b: o critério de demo do inventário é o mesmo do seed", () => {
    const normal = (s: string) => s.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim();
    expect(normal(sql)).toContain(normal(SQL_ORGANIZACAO_DEMO).slice(1, -1));
  });

  describe("S2: roda numa transação READ ONLY", () => {
    let db: Db;
    beforeAll(async () => { db = (await freshDb()).db; });
    afterAll(async () => { await db.end(); });

    it("todos os blocos devolvem linhas coerentes, sem escrever", async () => {
      const cli = await db.connect();
      try {
        await cli.query("begin transaction read only");
        const res: { rows: Record<string, unknown>[] }[] = [];
        for (const c of comandos(sql)) res.push(await cli.query(c));
        // Prova de que a transação é mesmo READ ONLY: uma escrita dentro dela é recusada pelo banco.
        await expect(cli.query("insert into erp.organizations(name) values ('x')")).rejects.toThrow(/read-only transaction/);
        await cli.query("rollback");
        const [orgs, users, membros, volume, ledger, gatilho, versoes] = res.map((r) => r.rows);
        expect(orgs).toHaveLength(1);
        expect(orgs![0]).toMatchObject({ slug: "demo", origem_seed: "demo", e_demo: true });
        expect(users!.map((u) => u.email).sort()).toEqual(["admin@demo.local", "operador@demo.local"]);
        expect(users!.every((u) => u.e_demo_local === true)).toBe(true);
        for (const u of users!) expect(Object.keys(u).sort()).toEqual(["e_demo_local", "email", "is_active", "last_login_at", "organizacoes", "organizacoes_ativas"]);
        expect(membros).toHaveLength(2);
        expect(Number(volume![0]!.empresas)).toBe(2);
        expect(Number(volume![0]!.animais)).toBe(20);
        expect(ledger![0]).toMatchObject({ migrations: "31", ultima: "0031_vendas_condicao_pagamento.sql" });
        expect(gatilho).toEqual([{ tgname: "trg_sales_documents_execucao_configurada", clausula_r1: true }]);
        expect(versoes).toEqual([{ versoes_com_execucao_configurada: "0" }]);
      } finally { await cli.query("rollback").catch(() => {}); cli.release(); }
    });

    it("sem a marca, a organização do seed antigo continua 'demo' no inventário", async () => {
      await db.query("update erp.organizations set parameters = parameters - 'origem_seed' where slug='demo'");
      const cli = await db.connect();
      try {
        await cli.query("begin transaction read only");
        const r = await cli.query(comandos(sql)[0]!);
        await cli.query("rollback");
        expect(r.rows[0]).toMatchObject({ slug: "demo", origem_seed: null, e_demo: true });
      } finally { await cli.query("rollback").catch(() => {}); cli.release(); }
    });
  });
});
