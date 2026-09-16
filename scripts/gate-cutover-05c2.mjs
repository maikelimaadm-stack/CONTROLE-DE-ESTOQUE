#!/usr/bin/env node
/**
 * GATE DA PRE-BASE2-05C-2 — a matriz de version skew do cutover do contador, provada, não argumentada.
 *
 *   pnpm gate:05c2
 *
 * O QUE ELE PROVA
 * ---------------
 * Quatro combinações de (runtime, banco). Duas são o funcionamento normal de cada lado; as outras duas
 * são os estados PROIBIDOS que obrigam a janela single-version — e são elas que dão sentido ao runbook.
 *
 *   Q1  runtime BASE  + banco PRÉ-0018   → COMPATÍVEL   (o mundo de hoje, antes do merge)
 *   Q2  runtime HEAD  + banco PÓS-0018   → COMPATÍVEL   (o mundo de amanhã, depois do cutover)
 *   Q3  runtime BASE  + banco PÓS-0018   → PROIBIDO     (a migration passou, o binário não trocou)
 *   Q4  runtime HEAD  + banco PRÉ-0018   → PROIBIDO     (o binário trocou, a migration não passou)
 *
 * Em Q3 e Q4 o sintoma é o MESMO e é silencioso, que é o que o torna perigoso: `erp.next_code` faz
 * `insert ... on conflict do update`, então uma chave que não existe não produz erro — ela devolve 1. O
 * gate não se contenta em ver o 1: ele tenta GRAVAR a Empresa com o número devolvido e mostra a colisão
 * no `unique (organization_id, code)`. É a diferença entre "o contador reiniciou" e "o usuário levou um
 * erro no cadastro", e é a segunda que descreve o que acontece em produção.
 *
 * COMO ELE EXPIRA SOZINHO
 * -----------------------
 * O runtime de cada lado NÃO é digitado aqui: é lido de `apps/api/src/lib/sequencia-empresa.ts` na base e
 * no HEAD (`scripts/lib/cutover-contador.mjs`). Se as duas constantes forem iguais, esta execução não
 * atravessa o cutover, o gate diz isso e passa — sem simular nada. Depois que a 05C-2 estiver em `main`,
 * é o que acontece em toda PR nova, para sempre.
 *
 * O QUE ELE NÃO É
 * ---------------
 * Não fala com produção, não pede credencial e não sobe binário: o que ele exercita é o CONTRATO DE BANCO
 * do contador, que é onde a incompatibilidade mora. A prova com os binários REAIS dos dois lados é o job
 * de version skew do CI, que roda a API da base de verdade — os dois se complementam e nenhum substitui
 * o outro.
 */
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE_DE_ORIGEM, MIGRATION_CUTOVER, constanteNaArvore, constanteNoCommit, decidir,
} from "./lib/cutover-contador.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A raiz do monorepo não declara dependências — `pg` mora em `packages/db`. Resolver a partir de lá é o
 * que deixa `pnpm gate:05c2` rodar da raiz sem instalar nada novo e sem duplicar a dependência.
 */
const pg = createRequire(join(RAIZ, "packages/db/package.json"))("pg");
const MIGRATIONS = join(RAIZ, "supabase/migrations");
const URL_BANCO = process.env.GATE_DATABASE_URL ?? process.env.TEST_DATABASE_URL
  ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_test";

const ok = (m) => console.log(`  ✓ ${m}`);
const passo = (m) => console.log(`\n${m}`);
const falhas = [];
const exigir = (cond, m) => { if (cond) ok(m); else { falhas.push(m); console.log(`  ✗ ${m}`); } };

/** A base desta execução: a do CI quando existe, senão a fusão com `origin/main`, senão a de origem. */
function baseDaExecucao() {
  const doCi = (process.env.SKEW_BASE_COMMIT ?? "").trim();
  if (doCi) return doCi;
  try {
    return execFileSync("git", ["merge-base", "HEAD", "origin/main"], { cwd: RAIZ, encoding: "utf8" }).trim();
  } catch {
    return BASE_DE_ORIGEM;
  }
}

const migrations = () => readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

/** Monta o banco aplicando as migrations até (e sem incluir) `ate`. Mesma ordem e transação do runner. */
async function montar(c, ate) {
  await c.query("drop schema if exists erp cascade; drop table if exists public.erp_migrations;");
  await c.query("create table public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const nome of migrations()) {
    if (ate && nome >= ate) break;
    await c.query("begin");
    await c.query(readFileSync(join(MIGRATIONS, nome), "utf8"));
    await c.query("insert into public.erp_migrations(name) values ($1)", [nome]);
    await c.query("commit");
  }
}

async function aplicarCutover(c) {
  await c.query("begin");
  await c.query(readFileSync(join(MIGRATIONS, MIGRATION_CUTOVER), "utf8"));
  await c.query("insert into public.erp_migrations(name) values ($1)", [MIGRATION_CUTOVER]);
  await c.query("commit");
}

/** O cenário: uma organização com acervo numerado e o contador em dia. É o estado de produção. */
async function semear(c, entidade) {
  const org = (await c.query("insert into erp.organizations (name) values ('[GATE] 05C-2') returning id")).rows[0].id;
  for (const code of [1, 2, 3]) {
    await c.query("insert into erp.empresas (organization_id, code, name) values ($1,$2,$3)",
      [org, code, `[GATE] empresa ${code}`]);
  }
  await c.query("insert into erp.code_sequences (organization_id, entity, last_value) values ($1,$2,3)", [org, entidade]);
  return org;
}

/** O que a API faz ao cadastrar uma Empresa: pede o número ao contador e grava. */
async function cadastrarEmpresa(c, org, entidade, rotulo) {
  const n = Number((await c.query("select erp.next_code($1,$2)::text n", [org, entidade])).rows[0].n);
  try {
    await c.query("insert into erp.empresas (organization_id, code, name) values ($1,$2,$3)", [org, n, rotulo]);
    return { numero: n, gravou: true, erro: null };
  } catch (e) {
    return { numero: n, gravou: false, erro: e.message };
  }
}

async function main() {
  const base = baseDaExecucao();
  let constanteBase;
  try {
    constanteBase = constanteNoCommit(base, RAIZ);
  } catch (e) {
    console.error(`\nNão consegui ler a constante do contador na base ${base}: ${e.message}`);
    console.error("Sem a base não há matriz: o gate REPROVA em vez de supor compatibilidade.");
    process.exit(1);
  }
  const constanteHead = constanteNaArvore(RAIZ);
  const d = decidir({ base: constanteBase, head: constanteHead });

  console.log("PRE-BASE2-05C-2 · gate da matriz de version skew do contador");
  console.log(`base            ${base}`);
  console.log(`contador BASE   '${d.base}'`);
  console.log(`contador HEAD   '${d.head}'`);
  console.log(`decisão         ${d.motivo}`);

  if (!d.atravessa) {
    console.log("\nAPROVADO (inativo): esta execução não atravessa o cutover do contador.");
    console.log("O version skew normal do CI é a autoridade aqui, e continua obrigatório.");
    return;
  }

  const c = new pg.Client({ connectionString: URL_BANCO });
  await c.connect();
  try {
    passo("Q1 · runtime BASE + banco PRÉ-0018 — o mundo de hoje tem de funcionar");
    await montar(c, MIGRATION_CUTOVER);
    let org = await semear(c, d.base);
    let r = await cadastrarEmpresa(c, org, d.base, "[GATE] Q1");
    exigir(r.gravou && r.numero === 4, `a API da base aloca ${r.numero} e grava — o contador continua de onde parou`);

    passo("Q2 · a 0018 preserva o contador, e o runtime HEAD continua a numeração");
    const antes = (await c.query("select organization_id::text o, last_value::text v from erp.code_sequences where entity=$1 order by 1", [d.base])).rows;
    await aplicarCutover(c);
    const depois = (await c.query("select organization_id::text o, last_value::text v from erp.code_sequences where entity=$1 order by 1", [d.head])).rows;
    exigir(JSON.stringify(antes) === JSON.stringify(depois), `o valor atravessou idêntico (${JSON.stringify(antes)})`);
    const sobrouLegado = Number((await c.query("select count(*)::text n from erp.code_sequences where entity=$1", [d.base])).rows[0].n);
    exigir(sobrouLegado === 0, `a chave '${d.base}' não existe mais`);

    r = await cadastrarEmpresa(c, org, d.head, "[GATE] Q2");
    exigir(r.gravou && r.numero === 5, `a API nova aloca ${r.numero} e grava — monotônico, sem repetir`);

    passo("Q3 · runtime BASE + banco PÓS-0018 — PROIBIDO, e o gate mostra por quê");
    r = await cadastrarEmpresa(c, org, d.base, "[GATE] Q3 proibido");
    exigir(r.numero === 1, `a chave '${d.base}' não existe e o contador REINICIA em ${r.numero} — sem erro nenhum`);
    exigir(!r.gravou && /duplicat|unique/i.test(r.erro ?? ""),
      "e o cadastro morre na unicidade (organization_id, code) — é o erro que o usuário veria");
    const ressuscitou = Number((await c.query("select count(*)::text n from erp.code_sequences where entity=$1", [d.base])).rows[0].n);
    exigir(ressuscitou === 1, `pior: a chave '${d.base}' foi RESSUSCITADA no banco pelo binário antigo`);

    passo("Q4 · runtime HEAD + banco PRÉ-0018 — PROIBIDO pelo mesmo motivo, no sentido inverso");
    await montar(c, MIGRATION_CUTOVER);
    org = await semear(c, d.base);
    r = await cadastrarEmpresa(c, org, d.head, "[GATE] Q4 proibido");
    exigir(r.numero === 1, `a chave '${d.head}' ainda não existe e o contador REINICIA em ${r.numero}`);
    exigir(!r.gravou && /duplicat|unique/i.test(r.erro ?? ""), "e o cadastro morre na mesma unicidade");

    passo("Regressão · depois do cutover a chave legada não volta sozinha");
    await montar(c, MIGRATION_CUTOVER);
    org = await semear(c, d.base);
    await aplicarCutover(c);
    await cadastrarEmpresa(c, org, d.head, "[GATE] regressao");
    const legado = Number((await c.query("select count(*)::text n from erp.code_sequences where entity=$1", [d.base])).rows[0].n);
    exigir(legado === 0, `uso normal pelo runtime HEAD não recria '${d.base}'`);
  } finally {
    await c.end();
  }

  console.log("");
  if (falhas.length) {
    console.log(`REPROVADO — ${falhas.length} verificação(ões) falharam:`);
    for (const f of falhas) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("APROVADO — a matriz fecha: dois quadrantes compatíveis, dois PROIBIDOS e demonstrados.");
  console.log("Os dois proibidos são a razão de o cutover exigir janela single-version");
  console.log("(docs/PRE-BASE2-05C-2-CUTOVER.md). Nenhum deles é degradação: os dois corrompem numeração.");
}

main().catch((e) => { console.error(e); process.exit(1); });
