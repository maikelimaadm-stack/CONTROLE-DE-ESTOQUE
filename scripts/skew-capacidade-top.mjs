#!/usr/bin/env node
/**
 * DECIDE, PARA O JOB DE VERSION SKEW, SE A API DA BASE JÁ TEM A DESCOBERTA DE CAPACIDADE DA TOP.
 *
 *   node scripts/skew-capacidade-top.mjs              # imprime a decisão e o motivo
 *   node scripts/skew-capacidade-top.mjs --github-env # e exporta SKEW_BASE_TEM_TOP para os passos seguintes
 *
 * A decisão inteira mora em `scripts/lib/capacidade-top.mjs` e é uma MEDIÇÃO da árvore da base. Este
 * arquivo é só a casca de linha de comando: ele não decide nada, para que exista UM lugar onde a regra
 * pode ser lida e mudada.
 *
 * Gêmeo de `scripts/skew-cutover-contador.mjs`, e de propósito: os dois resolvem a base do mesmo jeito,
 * gravam artefato do mesmo jeito e falham fechado do mesmo jeito. Quem entende um entende o outro.
 *
 * DE ONDE VEM A BASE, E POR QUE NÃO DA ÁRVORE MONTADA
 * ---------------------------------------------------
 * A contagem da base é lida do COMMIT, nunca dos arquivos de `.api-anterior`: a worktree é um diretório de
 * trabalho que pode ter sobrado de uma execução anterior — já aconteceu neste repositório, três fatias
 * atrás do que a execução declarava. Ler do commit é imune a isso.
 *
 * A ordem é `SKEW_BASE_COMMIT` (o SHA que a PR declarou para ESTA execução) e, na falta dele,
 * `.api-anterior.base` (o SHA que quem montou a árvore registrou). Quando os dois existem e DIVERGEM, o
 * binário que vai ser servido não é o da base declarada — não há decisão a tomar, há um harness
 * inconsistente: o script REPROVA.
 *
 * FALHA FECHADO: sem conseguir ler a base, este script REPROVA em vez de supor um dos mundos. Supor
 * "legado" deixaria o sentido 1 cobrando um bloqueio que não pode acontecer (e o job ficaria vermelho por
 * um motivo que ninguém entende); supor "atual" deixaria de cobrar a prova que a #47 conquistou.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ARQUIVO_DECISAO, decidir, ocorrenciasNoCommit } from "./lib/capacidade-top.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARQUIVO_BASE = join(RAIZ, ".api-anterior.base");

function shaDaBase() {
  const declarado = (process.env.SKEW_BASE_COMMIT ?? "").trim();
  const montado = existsSync(ARQUIVO_BASE) ? readFileSync(ARQUIVO_BASE, "utf8").trim() : "";

  if (declarado && montado && declarado !== montado) {
    throw new Error(
      `a execução declarou a base ${declarado}, mas a árvore servida foi montada em ${montado}. `
      + "O binário do teste não é o da base declarada — decidir sobre a capacidade aqui seria decidir sobre "
      + "o commit errado.");
  }
  const sha = declarado || montado;
  if (!sha) {
    throw new Error(
      "não há SKEW_BASE_COMMIT nem .api-anterior.base. Sem a base não dá para medir, e supor um dos dois "
      + "mundos certificaria um cenário que pode não ser o desta execução.");
  }
  return { sha, origem: declarado ? "SKEW_BASE_COMMIT (declarado pela execução)" : ".api-anterior.base (registrado por quem montou a árvore)" };
}

try {
  const { sha, origem } = shaDaBase();
  const d = decidir({ ocorrencias: ocorrenciasNoCommit(sha, RAIZ) });

  console.log(`[skew/top] base ......... ${sha} — ${origem}`);
  console.log(`[skew/top] ocorrências .. ${d.ocorrencias} (registro da rota de descoberta na árvore da base)`);
  console.log(`[skew/top] decisão ...... a base ${d.capaz ? "TEM" : "NÃO tem"} a descoberta de capacidade`);
  console.log(`[skew/top] motivo ....... ${d.motivo}`);

  // O ARTEFATO DA DECISÃO — e por que a variável de ambiente não basta.
  //
  // `SKEW_BASE_TEM_TOP` é o que o e2e leria, e é uma STRING MUTÁVEL: um `env:` de workflow prevalece sobre
  // o que este passo escreveu em `$GITHUB_ENV`. Fixá-la por fora trocaria o ramo enquanto este log
  // continuaria dizendo o contrário — o "interruptor genérico" que o cutover do contador já levou de red
  // team. Por isso a decisão também sai em ARQUIVO, com o insumo que a produziu: o e2e RECALCULA a partir
  // dele e usa a variável só como CONFERÊNCIA, de modo que divergência REPROVA em vez de escolher um ramo.
  writeFileSync(join(RAIZ, ARQUIVO_DECISAO),
    `${JSON.stringify({ baseSha: sha, ocorrencias: d.ocorrencias, capaz: d.capaz }, null, 2)}\n`);
  console.log(`[skew/top] decisão gravada em ${ARQUIVO_DECISAO}`);

  if (process.argv.includes("--github-env") && process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_ENV, `SKEW_BASE_TEM_TOP=${d.capaz ? "1" : "0"}\n`);
    console.log(`[skew/top] exportado SKEW_BASE_TEM_TOP=${d.capaz ? "1" : "0"}`);
  }
} catch (e) {
  console.error(`[skew/top] REPROVADO: ${e.message}`);
  process.exit(1);
}
