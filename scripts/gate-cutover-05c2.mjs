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
 *   Q3b o MESMO Q3 numa organização SEM Empresa → PROIBIDO E SILENCIOSO
 *   Q4  runtime HEAD  + banco PRÉ-0018   → PROIBIDO     (o binário trocou, a migration não passou)
 *
 * A raiz dos dois proibidos é a mesma: `erp.next_code` faz `insert ... on conflict do update`, então uma
 * chave que não existe não produz erro — ela devolve 1. O gate não se contenta em ver o 1: ele tenta
 * GRAVAR a Empresa com o número devolvido, porque é a gravação que descreve o que o usuário vive.
 *
 * MAS O SINTOMA NÃO É SEMPRE O MESMO, e é por isso que Q3b existe separado. Com acervo, o reinício em 1
 * esbarra no `unique (organization_id, code)` e ALGUÉM VÊ um erro. Numa organização que ainda não tem
 * Empresa nenhuma não há com o que colidir: o binário antigo grava o 1 COM SUCESSO e ressuscita a chave
 * legada — sem erro, sem log, sem sintoma —, e o estrago só aparece adiante, com os dois contadores já
 * divergidos. Contar só a metade barulhenta seria contar a metade que dá menos medo: a variante muda o
 * argumento do runbook de "apareceria um erro" para "pode não aparecer nada".
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
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MIGRATION_CUTOVER, constanteNaArvore, constanteNoCommit, decidir, shaDoRef,
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

/**
 * A BASE DESTA EXECUÇÃO — e por que ela NUNCA cai num SHA literal.
 *
 * A versão anterior terminava em `catch { return BASE_DE_ORIGEM }`, e isso era fail-OPEN no caso exato
 * que mais importa. `BASE_DE_ORIGEM` (602cda3) tem `SEQUENCIA_EMPRESA = 'farm'` para sempre. Logo:
 *
 *   • no CI, onde `origin/main` não existe em clone raso, TODA execução caía no literal e comparava a PR
 *     com o passado congelado — de modo que a "expiração automática" que esta fatia vende nunca
 *     aconteceria, e o gate simularia a matriz para sempre sem ninguém notar, porque continua verde;
 *   • pior, se alguém um dia REVERTER `SEQUENCIA_EMPRESA` para `'farm'`, base (literal = 'farm') e head
 *     ('farm') ficariam IGUAIS, `atravessa` viraria false e o gate imprimiria "APROVADO (inativo)"
 *     exatamente na PR que reintroduz o defeito que ele existe para pegar.
 *
 * Um gate ancorado em literal congelado não mede a PR: mede o passado. Então a base é resolvida de
 * verdade — `SKEW_BASE_COMMIT` quando a execução a fixa (PR), senão a ponta real de `origin/main` — e,
 * não havendo nenhuma das duas, ABORTA. É a mesma postura do irmão `skew-cutover-contador.mjs`, que já
 * se recusa a decidir sem base: supor "não atravessa" certifica um cenário que pode ser impossível.
 *
 * `BASE_DE_ORIGEM` continua existindo no módulo como PROVENIÊNCIA — e agora é só isso, de fato e não só
 * na documentação.
 */
function baseDaExecucao() {
  const doCi = (process.env.SKEW_BASE_COMMIT ?? "").trim();
  if (doCi) return { sha: doCi, origem: "SKEW_BASE_COMMIT (fixado por esta execução)" };
  // Sem merge-base de propósito: ele exige o GRAFO, que o clone raso do CI não tem. A ponta de
  // `origin/main` é resolvível com um fetch de profundidade 1 e responde a pergunta certa — "este HEAD
  // difere do que está em main agora?".
  const daMain = shaDoRef("origin/main", RAIZ);
  if (daMain) return { sha: daMain, origem: "origin/main (ponta atual)" };
  throw new Error(
    "não consegui resolver a base: não há SKEW_BASE_COMMIT e `origin/main` não é alcançável. "
    + "Sem base não há matriz, e cair num SHA literal faria o gate medir o passado em vez desta execução.");
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
  let base;
  let constanteBase;
  try {
    base = baseDaExecucao();
    constanteBase = constanteNoCommit(base.sha, RAIZ);
  } catch (e) {
    console.error(`\nNão consegui ler a constante do contador na base: ${e.message}`);
    console.error("Sem a base não há matriz: o gate REPROVA em vez de supor compatibilidade.");
    process.exit(1);
  }
  const constanteHead = constanteNaArvore(RAIZ);
  const d = decidir({ base: constanteBase, head: constanteHead });

  console.log("PRE-BASE2-05C-2 · gate da matriz de version skew do contador");
  console.log(`base            ${base.sha} (${base.origem})`);
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

    // A VARIANTE SILENCIOSA DO Q3 — e é ela que desmonta o consolo de "o erro apareceria".
    // Acima, a organização tinha acervo (códigos 1,2,3), então o reinício em 1 esbarra na unicidade e
    // ALGUÉM VÊ. Numa organização que ainda não tem Empresa nenhuma não há com o que colidir: o binário
    // antigo pede o número, recebe 1, GRAVA COM SUCESSO e ressuscita a chave legada — sem erro, sem log,
    // sem sintoma. O estrago só aparece depois, quando os dois contadores já divergiram.
    //
    // Sem este caso o gate contaria só a metade barulhenta da história, e a metade barulhenta é a que dá
    // menos medo. Organização recém-criada durante a janela é exatamente o cenário desta variante.
    passo("Q3b · a MESMA proibição sem colisão: organização ainda sem Empresa — o dano é SILENCIOSO");
    const orgNova = (await c.query(
      "insert into erp.organizations (name) values ('[GATE] 05C-2 sem acervo') returning id")).rows[0].id;
    const s = await cadastrarEmpresa(c, orgNova, d.base, "[GATE] Q3b primeira");
    exigir(s.numero === 1, `o contador devolve ${s.numero} para uma organização sem acervo`);
    exigir(s.gravou, "e o cadastro GRAVA — nenhum erro é levantado, que é o que torna este caso pior");
    const legadaNova = Number((await c.query(
      "select count(*)::text n from erp.code_sequences where organization_id=$1 and entity=$2",
      [orgNova, d.base])).rows[0].n);
    exigir(legadaNova === 1, `e a chave '${d.base}' nasce de novo nesta organização, já pós-cutover`);
    // E a prova de que isso é dano, não inocuidade: o runtime HEAD agora emite o MESMO 1 e colide.
    const canonicoQ3b = await cadastrarEmpresa(c, orgNova, d.head, "[GATE] Q3b canônico");
    exigir(canonicoQ3b.numero === 1 && !canonicoQ3b.gravou,
      "o runtime canônico emite o mesmo 1 e o cadastro morre — os dois contadores divergiram em silêncio");

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
