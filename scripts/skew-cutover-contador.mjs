#!/usr/bin/env node
/**
 * DECIDE, PARA O JOB DE VERSION SKEW, SE ESTA EXECUÇÃO ATRAVESSA O CUTOVER DO CONTADOR (PRE-BASE2-05C-2).
 *
 *   node scripts/skew-cutover-contador.mjs              # imprime a decisão e o motivo
 *   node scripts/skew-cutover-contador.mjs --github-env # e exporta SKEW_CUTOVER_CONTADOR para os passos seguintes
 *
 * A decisão inteira mora em `scripts/lib/cutover-contador.mjs` e é uma comparação entre a constante do
 * contador na BASE e neste HEAD. Este arquivo é só a casca de linha de comando: ele não decide nada, para
 * que exista UM lugar onde a regra pode ser lida e mudada.
 *
 * DE ONDE VEM A BASE, E POR QUE NÃO DA ÁRVORE MONTADA
 * ---------------------------------------------------
 * A constante da base é lida do COMMIT, nunca dos arquivos de `.api-anterior`. A diferença importa: a
 * árvore é um diretório de trabalho que pode estar velho de uma execução anterior, e medido — numa sessão
 * local ela estava três fatias atrás do que a execução declarava. Ler do commit é imune a isso.
 *
 * A ordem é: `SKEW_BASE_COMMIT` (o SHA que a PR declarou para ESTA execução) e, na falta dele,
 * `.api-anterior.base` (o SHA que quem montou a árvore registrou). Quando os dois existem e DIVERGEM, o
 * binário que vai ser servido não é o da base declarada — e aí não há decisão a tomar, há um harness
 * inconsistente: o script REPROVA.
 *
 * FALHA FECHADO: sem conseguir ler a constante da base, este script REPROVA em vez de assumir que a
 * execução não atravessa o cutover. Assumir "não atravessa" deixaria o sentido 1 cobrando compatibilidade
 * num cenário onde ela é impossível — o job ficaria vermelho por um motivo que ninguém entenderia, ou,
 * pior, verde por acidente.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { constanteNaArvore, constanteNoCommit, decidir } from "./lib/cutover-contador.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARQUIVO_BASE = join(RAIZ, ".api-anterior.base");

function shaDaBase() {
  const declarado = (process.env.SKEW_BASE_COMMIT ?? "").trim();
  const montado = existsSync(ARQUIVO_BASE) ? readFileSync(ARQUIVO_BASE, "utf8").trim() : "";

  if (declarado && montado && declarado !== montado) {
    throw new Error(
      `a execução declarou a base ${declarado}, mas a árvore servida foi montada em ${montado}. `
      + "O binário do teste não é o da base declarada — decidir sobre o cutover aqui seria decidir sobre "
      + "o commit errado.");
  }
  const sha = declarado || montado;
  if (!sha) {
    throw new Error(
      "não há SKEW_BASE_COMMIT nem .api-anterior.base. Sem a base não dá para decidir, e supor "
      + "'não atravessa' certificaria um cenário que pode ser impossível.");
  }
  return { sha, origem: declarado ? "SKEW_BASE_COMMIT (declarado pela execução)" : ".api-anterior.base (registrado por quem montou a árvore)" };
}

try {
  const { sha, origem } = shaDaBase();
  const base = { valor: constanteNoCommit(sha, RAIZ), origem: `${sha} — ${origem}` };
  const head = constanteNaArvore(RAIZ);
  const d = decidir({ base: base.valor, head });

  console.log(`[skew/contador] base ...... '${d.base}' (de ${base.origem})`);
  console.log(`[skew/contador] head ...... '${d.head}'`);
  console.log(`[skew/contador] decisão ... ${d.atravessa ? "ATRAVESSA o cutover" : "não atravessa"}`);
  console.log(`[skew/contador] motivo .... ${d.motivo}`);

  if (process.argv.includes("--github-env") && process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_ENV, `SKEW_CUTOVER_CONTADOR=${d.atravessa ? "1" : "0"}\n`);
    console.log(`[skew/contador] exportado SKEW_CUTOVER_CONTADOR=${d.atravessa ? "1" : "0"}`);
  }
} catch (e) {
  console.error(`[skew/contador] REPROVADO: ${e.message}`);
  process.exit(1);
}
