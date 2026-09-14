#!/usr/bin/env node
/**
 * SOBE A VERSÃO QUE ESTÁ NO AR, DE VERDADE (prova do version skew nos DOIS sentidos).
 *
 * O rollout não é atômico: o web (Vercel) e a API (Railway) trocam de versão em momentos diferentes. Existe,
 * portanto, uma janela em que o navegador roda o HEAD NOVO e o servidor ainda é o da BASE. Esse é o cenário
 * que nenhum teste com mock prova, porque o que quebra ali não é a aplicação — é o FIO: CORS, nome de
 * recurso, campo de corpo e chave de query. Um mock permissivo responde "ok" a tudo e não prova nada.
 *
 * A MATRIZ MUDOU NA PRE-BASE2-05B, E OS DOIS SENTIDOS PASSAM A IMPORTAR
 *
 * Na 05A só um sentido era real: o cliente virava canônico, então o risco era o web à frente da API. Na 05B
 * quem vira é o SERVIDOR, e a API canônica pode subir ANTES ou DEPOIS do web desta PR. Então a prova é
 * dupla, e é isto que a ordem de implantação exige:
 *
 *   SENTIDO 1  web 05B  × API 05A (base)  → `playwright.skew.config.ts`
 *   SENTIDO 2  web 05A (base) × API 05B   → `playwright.skew-web-anterior.config.ts`
 *
 * Só o sentido 2 prova o que esta fase realmente arrisca: que o web JÁ PUBLICADO continua funcionando
 * inteiro contra uma API que deixou de entender o idioma antigo. Se o cliente em produção dependesse de
 * qualquer resquício legado, é aqui que apareceria — antes de aparecer no navegador do usuário.
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
 * BASE DA PR PRE-BASE2-05B: o merge da PR #28 (cliente canônico), que é o commit em produção enquanto esta
 * PR não sobe. Não é "o commit anterior" genérico — é o ponto exato a partir do qual esta PR diverge.
 * Trocar este valor troca o significado do teste, e é por isso que ele fica fixado por SHA, não por ref.
 */
export const COMMIT_ANTERIOR = "76e669d2244244097c44f10095d0fe65d3db2fe4";

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

/**
 * Constrói o WEB da base (sentido 2). Separado da API porque custa um `next build` inteiro e só o sentido 2
 * precisa dele — o sentido 1 usa o web do HEAD, que o Playwright já constrói.
 */
export function prepararWebAnterior() {
  prepararApiAnterior();
  if (!existsSync(join(DIR_ANTERIOR, "apps/web/.next/BUILD_ID"))) {
    rodar("pnpm", ["--filter", "@agro/web", "build"], DIR_ANTERIOR);
  }
  return DIR_ANTERIOR;
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
  const comWeb = process.argv.includes("--web");
  if (soDiretorio && !comWeb && existsSync(join(DIR_ANTERIOR, "packages/db/dist/index.js"))) { console.log(DIR_ANTERIOR); process.exit(0); }
  const dir = comWeb ? prepararWebAnterior() : prepararApiAnterior();
  console.log(soDiretorio ? dir : `API do commit ${COMMIT_ANTERIOR.slice(0, 8)} pronta em ${dir}`);
}
