#!/usr/bin/env node
/**
 * DECIDE, PARA O JOB DE VERSION SKEW, SE A API DA BASE JÁ DECLARA A EXECUÇÃO CONFIGURADA DA TOP.
 *
 *   node scripts/skew-execucao-top.mjs              # imprime a decisão e o motivo
 *   node scripts/skew-execucao-top.mjs --github-env # e exporta SKEW_BASE_TEM_EXECUCAO_TOP
 *
 * Gêmeo de `scripts/skew-capacidade-top.mjs`: a base vem de `SKEW_BASE_COMMIT` (declarada pela execução)
 * ou de `.api-anterior.base` (registrada por quem montou a árvore); divergência entre as duas REPROVA; a
 * contagem é lida do COMMIT, nunca da worktree; e a decisão sai também em ARQUIVO, porque a variável de
 * ambiente é mutável por fora e só serve de CONFERÊNCIA. A regra inteira mora em `lib/execucao-top.mjs`.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ARQUIVO_DECISAO, decidir, ocorrenciasNoCommit } from "./lib/execucao-top.mjs";

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
  const d = decidir({ ocorrencias: ocorrenciasNoCommit(sha, RAIZ) });
  console.log(`[skew/execucao] base ......... ${sha} — ${origem}`);
  console.log(`[skew/execucao] ocorrências .. ${d.ocorrencias} (declaração do bloco \`execucao\` na árvore da base)`);
  console.log(`[skew/execucao] decisão ...... a base ${d.declara ? "DECLARA" : "NÃO declara"} a execução configurada`);
  console.log(`[skew/execucao] motivo ....... ${d.motivo}`);
  writeFileSync(join(RAIZ, ARQUIVO_DECISAO),
    `${JSON.stringify({ baseSha: sha, ocorrencias: d.ocorrencias, declara: d.declara }, null, 2)}\n`);
  console.log(`[skew/execucao] decisão gravada em ${ARQUIVO_DECISAO}`);
  if (process.argv.includes("--github-env") && process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_ENV, `SKEW_BASE_TEM_EXECUCAO_TOP=${d.declara ? "1" : "0"}\n`);
    console.log(`[skew/execucao] exportado SKEW_BASE_TEM_EXECUCAO_TOP=${d.declara ? "1" : "0"}`);
  }
} catch (e) {
  console.error(`[skew/execucao] REPROVADO: ${e.message}`);
  process.exit(1);
}
