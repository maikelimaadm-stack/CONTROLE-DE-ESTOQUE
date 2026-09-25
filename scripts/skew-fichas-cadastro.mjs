#!/usr/bin/env node
/**
 * DECIDE, PARA O JOB DE VERSION SKEW, SE A BASE JÁ TEM A ESTRUTURA E AS FICHAS DE CADASTRO DA #62.
 *
 *   node scripts/skew-fichas-cadastro.mjs              # imprime a decisão e o motivo
 *   node scripts/skew-fichas-cadastro.mjs --github-env # e exporta SKEW_BASE_FICHAS_CADASTRO
 *
 * Gêmeo de `scripts/skew-previa-confirmacao.mjs` (e de `skew-capacidade-top.mjs`): a base vem de
 * `SKEW_BASE_COMMIT` (declarada pela execução) ou de `.api-anterior.base` (registrada por quem montou a árvore);
 * divergência entre as duas REPROVA; a lista é lida do COMMIT, nunca da worktree; e a decisão sai também em
 * ARQUIVO, porque a variável de ambiente é mutável por fora e só serve de CONFERÊNCIA. A regra inteira mora em
 * `lib/fichas-cadastro.mjs`.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ARQUIVO_DECISAO, FATIAS, VARIAVEL, decidir, migrationsNaArvore, migrationsNoCommit, valorDaVariavel } from "./lib/fichas-cadastro.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARQUIVO_BASE = join(RAIZ, ".api-anterior.base");

function shaDaBase() {
  const declarado = (process.env.SKEW_BASE_COMMIT ?? "").trim();
  const montado = existsSync(ARQUIVO_BASE) ? readFileSync(ARQUIVO_BASE, "utf8").trim() : "";
  if (declarado && montado && declarado !== montado) {
    throw new Error(`a execução declarou a base ${declarado}, mas a árvore servida foi montada em ${montado}. `
      + "O binário do teste não é o da base declarada — decidir aqui seria decidir sobre o commit errado.");
  }
  const sha = declarado || montado;
  if (!sha) {
    throw new Error("não há SKEW_BASE_COMMIT nem .api-anterior.base. Sem a base não dá para medir, e supor um dos "
      + "dois mundos certificaria um cenário que pode não ser o desta execução.");
  }
  return { sha, origem: declarado ? "SKEW_BASE_COMMIT (declarado pela execução)" : ".api-anterior.base (registrado por quem montou a árvore)" };
}

try {
  const { sha, origem } = shaDaBase();
  const daBase = migrationsNoCommit(sha, RAIZ);
  const d = decidir({ daBase, doHead: migrationsNaArvore(RAIZ) });
  console.log(`[skew/fichas] base ......... ${sha} — ${origem}`);
  for (const [chave, { migration, oQue }] of Object.entries(FATIAS)) {
    console.log(`[skew/fichas] ${chave.padEnd(14)} ${d.fatias[chave] ? "TEM   " : "NÃO tem"} ${migration} (${oQue})`);
  }
  console.log(`[skew/fichas] motivo ....... ${d.motivo}`);
  // O ARTEFATO carrega o INSUMO (a lista da base) junto com a decisão: o e2e RECALCULA a partir dele, e a
  // variável de ambiente é só CONFERÊNCIA — divergência REPROVA em vez de escolher um ramo.
  const fatias = Object.fromEntries(Object.entries(FATIAS).map(([k, { migration }]) => [k, { migration, presente: d.fatias[k] }]));
  writeFileSync(join(RAIZ, ARQUIVO_DECISAO), `${JSON.stringify({ baseSha: sha, migrationsDaBase: daBase, fatias }, null, 2)}\n`);
  console.log(`[skew/fichas] decisão gravada em ${ARQUIVO_DECISAO}`);
  if (process.argv.includes("--github-env") && process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_ENV, `${VARIAVEL}=${valorDaVariavel(d.fatias)}\n`);
    console.log(`[skew/fichas] exportado ${VARIAVEL}=${valorDaVariavel(d.fatias)}`);
  }
} catch (e) {
  console.error(`[skew/fichas] REPROVADO: ${e.message}`);
  process.exit(1);
}
