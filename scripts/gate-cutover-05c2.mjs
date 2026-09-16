#!/usr/bin/env node
/**
 * GATE DA PRE-BASE2-05C-2 — a matriz de version skew do cutover do contador, provada, não argumentada.
 *
 *   pnpm gate:05c2
 *
 * O QUE ELE PROVA
 * ---------------
 * Combinações de (runtime, banco), com o cadastro executado como a API o executa: UMA transação.
 *
 *   Q1  runtime BASE  + banco PRÉ-0018                  → COMPATÍVEL  (o mundo de hoje)
 *   Q2  runtime HEAD  + banco PÓS-0018                  → COMPATÍVEL  (o mundo de amanhã)
 *   Q3  runtime BASE  + banco PÓS-0018, COM acervo      → a operação legítima FALHA (rollback protege)
 *   Q3b runtime BASE  + banco PÓS-0018, SEM Empresa     → COMITA a chave ERRADA (dano persiste, silencioso)
 *   Q4  runtime HEAD  + banco PRÉ-0018, COM acervo      → a operação legítima FALHA (rollback protege)
 *   Q4b runtime HEAD  + banco PRÉ-0018, SEM Empresa     → COMITA a canônica antes da migration, e a 0018
 *                                                          passa a ter de RECUSAR aquele banco
 *
 * A raiz é sempre a mesma: `erp.next_code` faz `insert ... on conflict do update`, então uma chave que não
 * existe não produz erro — ela é CRIADA e devolve 1. O gate não se contenta em ver o 1: ele tenta GRAVAR a
 * Empresa, porque é a gravação que descreve o que o usuário vive.
 *
 * O QUE DECIDE O ESTRAGO É O `commit`, E POR ISSO O MODELO TEM DE SER TRANSACIONAL. `createOne` usa o
 * MESMO `ctx.tx` para `nextCode` e para o `insert`, dentro do `withTx` (`begin` → serviço → `commit`, com
 * `rollback` em erro). Logo:
 *
 *   • COM acervo (Q3, Q4) o `insert` colide, a transação volta atrás INTEIRA, e a linha de contador que a
 *     tentativa criou NÃO persiste. O sintoma é barulhento e sem sequela: o usuário leva um erro;
 *   • SEM acervo (Q3b, Q4b) não há com o que colidir: o `insert` passa, a transação COMITA, e a chave
 *     ERRADA fica gravada. É o caminho em que o dano persiste, e ele é silencioso.
 *
 * Um gate que modelasse isso em autocommit — como este fazia — erraria nos dois sentidos: inventaria uma
 * "ressurreição" persistida em Q3/Q4, que o rollback desfaz, e descreveria mal o que sobra em Q3b/Q4b.
 *
 * A CONCLUSÃO NÃO MUDA: rollout normal continua PROIBIDO. Muda o motivo, e o motivo correto é mais forte,
 * porque não depende de o usuário ter sorte de ver um erro — o caso sem acervo não levanta nenhum.
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

/**
 * O CADASTRO COMO A API O FAZ DE VERDADE: UMA TRANSAÇÃO, UMA CONEXÃO.
 *
 * A versão anterior deste gate mandava `next_code` e o `insert` como duas queries AUTOCOMMIT separadas, e
 * isso não é o que roda em produção. `createOne` (`apps/api/src/routes/resources.ts:232-233`) passa o MESMO
 * `ctx.tx` para `nextCode(...)` e para o `insert` de `erp.empresas`; `runService` executa dentro de
 * `withTx`, que é `begin` → serviço → `commit`, com `rollback` em erro (`packages/db/src/pool.ts:33-49`).
 *
 * A diferença MUDA O RESULTADO, e não só a forma: em autocommit, a linha que `next_code` cria fica gravada
 * mesmo quando o `insert` seguinte falha — foi daí que saiu a afirmação, agora corrigida, de que o binário
 * antigo "ressuscitava" a chave legada em toda tentativa. Numa transação real ela é DESFEITA junto com o
 * `insert`. Modelar errado exagerava o estrago num caso e escondia a forma real do outro.
 *
 * O que NÃO muda é a conclusão da fatia: o rollout normal continua PROIBIDO. Muda o motivo, e o motivo
 * correto é mais preciso — está escrito no bloco de cada quadrante.
 */
async function cadastrarEmpresa(c, org, entidade, rotulo) {
  await c.query("begin");
  let numero = null;
  try {
    numero = Number((await c.query("select erp.next_code($1,$2)::text n", [org, entidade])).rows[0].n);
    await c.query("insert into erp.empresas (organization_id, code, name) values ($1,$2,$3)", [org, numero, rotulo]);
    await c.query("commit");
    return { numero, gravou: true, erro: null };
  } catch (e) {
    // Exatamente o que `withTx` faz quando o serviço lança: a transação inteira volta atrás, inclusive a
    // linha de contador que `next_code` acabou de criar.
    await c.query("rollback").catch(() => { /* a transação já pode ter morrido */ });
    return { numero, gravou: false, erro: e.message };
  }
}

/** O ESTADO QUE SOBROU — é isto que o commit/rollback decide, e é isto que o gate cobra. */
async function estado(c, org) {
  const contadores = (await c.query(
    "select entity, last_value::text v from erp.code_sequences where organization_id=$1 order by entity",
    [org])).rows.map((l) => `${l.entity}=${l.v}`);
  const codigos = (await c.query(
    "select code from erp.empresas where organization_id=$1 order by code", [org])).rows.map((l) => Number(l.code));
  return { contadores, codigos };
}

/** A 0018 aplicada esperando RECUSA: devolve o erro em vez de lançá-lo. */
async function tentarCutover(c) {
  try { await aplicarCutover(c); return { ok: true }; }
  catch (e) { await c.query("rollback").catch(() => { /* ignore */ }); return { ok: false, erro: e.message }; }
}

const noLedger = async (c) => Number((await c.query(
  "select count(*)::text n from public.erp_migrations where name like '0018%'")).rows[0].n);

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
  console.log("modelo          cadastro em UMA transação (begin → next_code → insert → commit/rollback),");
  console.log("                como runService/withTx fazem em produção");

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
    exigir(r.gravou && r.numero === 4, `a API da base aloca ${r.numero} e COMITA — o contador continua de onde parou`);
    let e = await estado(c, org);
    exigir(e.contadores.join() === `${d.base}=4` && e.codigos.join() === "1,2,3,4",
      `estado persistente: contador [${e.contadores}] · códigos [${e.codigos}]`);

    passo("Q2 · a 0018 preserva o contador, e o runtime HEAD continua a numeração");
    const antes = (await c.query("select organization_id::text o, last_value::text v from erp.code_sequences where entity=$1 order by 1", [d.base])).rows;
    await aplicarCutover(c);
    const depois = (await c.query("select organization_id::text o, last_value::text v from erp.code_sequences where entity=$1 order by 1", [d.head])).rows;
    exigir(JSON.stringify(antes) === JSON.stringify(depois), `o valor atravessou idêntico (${JSON.stringify(antes)})`);
    const sobrouLegado = Number((await c.query("select count(*)::text n from erp.code_sequences where entity=$1", [d.base])).rows[0].n);
    exigir(sobrouLegado === 0, `a chave '${d.base}' não existe mais`);

    r = await cadastrarEmpresa(c, org, d.head, "[GATE] Q2");
    exigir(r.gravou && r.numero === 5, `a API nova aloca ${r.numero} e COMITA — monotônico, sem repetir`);
    e = await estado(c, org);
    exigir(e.contadores.join() === `${d.head}=5` && e.codigos.join() === "1,2,3,4,5",
      `estado persistente: contador [${e.contadores}] · códigos [${e.codigos}]`);

    // Q3 — COM ACERVO, A OPERAÇÃO LEGÍTIMA FALHA E O ROLLBACK PROTEGE O QUE JÁ EXISTE.
    // O que o binário antigo faz é pedir uma chave que a 0018 aposentou. `next_code` não dá erro: ele
    // CRIA a linha e devolve 1. O `insert` então bate na unicidade, e a transação inteira volta atrás —
    // inclusive a linha de contador recém-criada. Ou seja: não há ressurreição persistida aqui; há uma
    // operação de usuário que MORRE. É incompatibilidade de verdade, só que barulhenta e sem sequela.
    passo("Q3 · runtime BASE + banco PÓS-0018, COM acervo — a operação legítima FALHA");
    const antesQ3 = await estado(c, org);
    r = await cadastrarEmpresa(c, org, d.base, "[GATE] Q3 proibido");
    exigir(r.numero === 1, `a chave '${d.base}' não existe e o contador tenta ${r.numero} dentro da transação`);
    exigir(!r.gravou && /duplicat|unique/i.test(r.erro ?? ""),
      "o cadastro morre na unicidade (organization_id, code) — é o erro que o usuário veria");
    const q3 = await estado(c, org);
    exigir(q3.contadores.join() === antesQ3.contadores.join() && q3.codigos.join() === antesQ3.codigos.join(),
      `e o ROLLBACK devolve tudo: contador [${q3.contadores}] · códigos [${q3.codigos}] — a linha '${d.base}' da tentativa NÃO persiste`);

    // Q3b — SEM ACERVO, O MESMO BINÁRIO ANTIGO COMITA, E É ISSO QUE ASSUSTA.
    // Sem nenhuma Empresa não há com o que colidir: o `insert` passa, a transação COMITA, e a chave
    // legada fica gravada DEPOIS do cutover. É o único caminho em que o estrago persiste, e é silencioso.
    passo("Q3b · runtime BASE + banco PÓS-0018, SEM Empresa — o cadastro COMITA e o dano PERSISTE");
    const orgNova = (await c.query(
      "insert into erp.organizations (name) values ('[GATE] 05C-2 sem acervo') returning id")).rows[0].id;
    const s = await cadastrarEmpresa(c, orgNova, d.base, "[GATE] Q3b primeira");
    exigir(s.gravou && s.numero === 1, `o binário antigo aloca ${s.numero} e COMITA — nenhum erro é levantado`);
    let eb = await estado(c, orgNova);
    exigir(eb.contadores.join() === `${d.base}=1` && eb.codigos.join() === "1",
      `estado persistente já pós-cutover: contador [${eb.contadores}] · códigos [${eb.codigos}] — a chave legada voltou a existir`);
    // E o preço disso aparece no próximo cadastro canônico: ele pede 'empresa', recebe 1 e colide.
    const canonicoQ3b = await cadastrarEmpresa(c, orgNova, d.head, "[GATE] Q3b canônico");
    exigir(canonicoQ3b.numero === 1 && !canonicoQ3b.gravou,
      "o runtime canônico pede a chave canônica, recebe o mesmo 1 e o cadastro morre");
    eb = await estado(c, orgNova);
    exigir(eb.contadores.join() === `${d.base}=1` && eb.codigos.join() === "1",
      `e a tentativa canônica REVERTEU: sobra só [${eb.contadores}] · códigos [${eb.codigos}] — não ficam dois contadores`);

    passo("Q4 · runtime HEAD + banco PRÉ-0018, COM acervo — falha e o rollback protege");
    await montar(c, MIGRATION_CUTOVER);
    org = await semear(c, d.base);
    const antesQ4 = await estado(c, org);
    r = await cadastrarEmpresa(c, org, d.head, "[GATE] Q4 proibido");
    exigir(r.numero === 1, `a chave '${d.head}' ainda não existe e o contador tenta ${r.numero} dentro da transação`);
    exigir(!r.gravou && /duplicat|unique/i.test(r.erro ?? ""), "e o cadastro morre na mesma unicidade");
    const q4 = await estado(c, org);
    exigir(q4.contadores.join() === antesQ4.contadores.join() && q4.codigos.join() === antesQ4.codigos.join(),
      `ROLLBACK: contador [${q4.contadores}] · códigos [${q4.codigos}] — a linha '${d.head}' da tentativa NÃO persiste`);

    // Q4b — O ESPELHO DO Q3b, E O QUE ELE DEIXA É UM BANCO QUE A 0018 PRECISA RECUSAR.
    // HEAD contra banco PRÉ-0018, numa organização sem Empresa: nada com que colidir, então o binário
    // novo COMITA a chave canônica ANTES da migration. Depois disso a 0018 encontra 'empresa' já de pé —
    // o estado da cópia — e tem de RECUSAR, porque escolher entre as duas linhas é decisão humana.
    passo("Q4b · runtime HEAD + banco PRÉ-0018, SEM Empresa — comita a chave canônica antes da migration");
    const orgQ4b = (await c.query(
      "insert into erp.organizations (name) values ('[GATE] 05C-2 Q4b sem acervo') returning id")).rows[0].id;
    const t = await cadastrarEmpresa(c, orgQ4b, d.head, "[GATE] Q4b primeira");
    exigir(t.gravou && t.numero === 1, `o binário novo aloca ${t.numero} e COMITA, ainda pré-0018`);
    const e4b = await estado(c, orgQ4b);
    exigir(e4b.contadores.join() === `${d.head}=1` && e4b.codigos.join() === "1",
      `estado persistente antes da migration: contador [${e4b.contadores}] · códigos [${e4b.codigos}]`);
    const recusa = await tentarCutover(c);
    exigir(!recusa.ok, "e a 0018 RECUSA este banco — não escolhe entre as duas chaves");
    exigir(/entity='empresa'|linha\(s\) entity/i.test(recusa.erro ?? ""),
      `a recusa NOMEIA o caso: ${(recusa.erro ?? "").split("\n")[0].slice(0, 120)}`);
    const legadoQ4b = Number((await c.query("select count(*)::text n from erp.code_sequences where entity=$1", [d.base])).rows[0].n);
    exigir(legadoQ4b > 0 && await noLedger(c) === 0,
      `sem transição parcial: '${d.base}' segue de pé em ${legadoQ4b} organização(ões) e o ledger não registra 0018`);

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
  console.log("APROVADO — a matriz fecha: 2 quadrantes compatíveis e 4 incompatíveis, em DUAS formas.");
  console.log("  COM acervo (Q3, Q4): a operação legítima FALHA e o rollback protege o que já existe.");
  console.log("  SEM Empresa (Q3b, Q4b): o cadastro COMITA a chave ERRADA — sem erro, e o dano fica.");
  console.log("É a segunda forma que obriga a janela single-version (docs/PRE-BASE2-05C-2-CUTOVER.md):");
  console.log("ela não depende de alguém ver um erro, porque não levanta nenhum.");
}

main().catch((e) => { console.error(e); process.exit(1); });
