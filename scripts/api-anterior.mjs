#!/usr/bin/env node
/**
 * SOBE A API QUE ESTÁ NO AR, DE VERDADE (prova do version skew "web à frente da API").
 *
 * O rollout não é atômico: o web (Vercel) e a API (Railway) trocam de versão em momentos diferentes. Existe,
 * portanto, uma janela em que o navegador roda o HEAD NOVO e o servidor ainda é o da BASE. Esse é o cenário
 * que nenhum teste com mock prova, porque o que quebra ali não é a aplicação — é o FIO: CORS, nome de
 * recurso, campo de corpo e chave de query. Um mock permissivo responde "ok" a tudo e não prova nada.
 *
 * O QUE ESTE HARNESS MEDE MUDOU NA PRE-BASE2-05A, E DE PROPÓSITO
 *
 * Até a PRE-BASE2-04 ele apontava para o commit anterior à PRE-BASE2-03 — uma API que NÃO declarava
 * `X-Empresa-Id` no CORS. Naquele mundo o cliente tinha de falar o idioma legado no fio, e o teste provava
 * exatamente isso. A PRE-BASE2-05A vira o cliente para o canônico, e com isso aquela combinação deixa de
 * ser um cenário de produção: ela é impossível por ordem de implantação, porque a API canônica já está em
 * produção desde a PRE-BASE2-03 e não volta atrás.
 *
 * Apagar o teste seria perder a prova; mantê-lo apontado para lá seria certificar um cenário que não
 * existe. Então ele foi RECLASSIFICADO: passa a medir o skew que de fato existe depois do cutover — web
 * desta PR contra a API da BASE da PR, que é o binário no ar. O contrato provado é o da PRE-BASE2-05A:
 * o cliente canônico só pode subir sobre uma API que já entende o canônico.
 *
 * Idempotente: rodar duas vezes não refaz nada. Uso:
 *
 *   node scripts/api-anterior.mjs           # prepara e imprime o diretório
 *   node scripts/api-anterior.mjs --dir     # imprime só o diretório (para script de shell)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * BASE DA PR PRE-BASE2-05A: o merge da PR #27, que é o commit em produção enquanto esta PR não sobe.
 * Não é "o commit anterior" genérico — é o ponto exato a partir do qual esta PR diverge. Trocar este valor
 * troca o significado do teste, e é por isso que ele fica fixado por SHA e não por ref móvel.
 */
export const COMMIT_ANTERIOR = "2e187ae2b5858c0de9dea110c2a7e2e1fc389e98";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Fora de `apps/`, para que nenhum tsconfig/eslint/next do repositório enxergue esta árvore. */
export const DIR_ANTERIOR = join(RAIZ, ".api-anterior");

const git = (...args) => execFileSync("git", args, { cwd: RAIZ, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const rodar = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

function garantirCommit() {
  try { git("cat-file", "-e", `${COMMIT_ANTERIOR}^{commit}`); return; } catch { /* clone raso: falta o objeto */ }
  // `actions/checkout` traz um commit só. Buscar a base pelo SHA é mais barato e mais determinístico do que
  // pedir `fetch-depth: 0` — não depende do tamanho do histórico do repositório.
  rodar("git", ["fetch", "--depth=1", "origin", COMMIT_ANTERIOR], RAIZ);
}

function garantirWorktree() {
  if (existsSync(join(DIR_ANTERIOR, "apps/api/src/main.ts"))) return false;
  mkdirSync(dirname(DIR_ANTERIOR), { recursive: true });
  // `--detach`: sem branch, porque esta árvore é só leitura de um ponto do passado. Nada é commitado dela.
  rodar("git", ["worktree", "add", "--detach", DIR_ANTERIOR, COMMIT_ANTERIOR], RAIZ);
  return true;
}

function garantirDependencias(novo) {
  // A API anterior importa `@agro/shared`, `@erp/plataforma`, `@agro/domain` e `@agro/db` pelos `dist/`
  // DAQUELE commit. Reaproveitar os `dist/` do HEAD novo destruiria o teste: a API deixaria de ser a anterior.
  if (!novo && existsSync(join(DIR_ANTERIOR, "packages/db/dist/index.js"))) return;
  rodar("pnpm", ["install", "--frozen-lockfile"], DIR_ANTERIOR);
  for (const p of ["@agro/shared", "@erp/plataforma", "@agro/domain", "@agro/db"]) {
    rodar("pnpm", ["--filter", p, "build"], DIR_ANTERIOR);
  }
}

export function prepararApiAnterior() {
  garantirCommit();
  garantirDependencias(garantirWorktree());
  return DIR_ANTERIOR;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const soDiretorio = process.argv.includes("--dir");
  if (soDiretorio && existsSync(join(DIR_ANTERIOR, "packages/db/dist/index.js"))) { console.log(DIR_ANTERIOR); process.exit(0); }
  const dir = prepararApiAnterior();
  console.log(soDiretorio ? dir : `API do commit ${COMMIT_ANTERIOR.slice(0, 8)} pronta em ${dir}`);
}
