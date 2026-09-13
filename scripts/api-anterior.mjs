#!/usr/bin/env node
/**
 * SOBE A API DO COMMIT ANTERIOR, DE VERDADE (PRE-BASE2-03 — prova do version skew B).
 *
 * O rollout não é atômico: o web (Vercel) e a API (Railway) trocam de versão em momentos diferentes. Existe,
 * portanto, uma janela em que o navegador roda o HEAD NOVO e o servidor ainda é o ANTERIOR. Esse é o cenário
 * que nenhum teste com mock prova, porque o que quebra ali não é a aplicação — é o FIO:
 *
 *   · o CORS da API anterior não declara `X-Empresa-Id`: o PREFLIGHT falha e a tela nem chega a pedir dados;
 *   · `/auth/context` devolve `farms`, não `empresas`;
 *   · `/api/resources/empresas` não existe (404) — o recurso se chama `farms`;
 *   · um corpo com `empresa_id` é 422 num schema `.strict()`;
 *   · `empresa_id__eq` na query é IGNORADO em silêncio — o filtro não erra, ele mente.
 *
 * Um mock permissivo responde "ok" às cinco coisas e não prova nenhuma. Por isso este script monta a API
 * EXATA daquele commit, a partir do próprio repositório, e a entrega para o Playwright subir no lugar da
 * atual. O banco é o MESMO banco já migrado pelo HEAD novo (0014, 0015 e as correções desta rodada): é a
 * combinação real de produção na janela de rollout, não uma reconstrução dela.
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
 * BASE DA PR #25. Não é "o commit anterior" genérico: é o ponto exato a partir do qual esta PR diverge, ou
 * seja, o código que está no ar enquanto a PR não sobe. Trocar este valor troca o significado do teste.
 */
export const COMMIT_ANTERIOR = "6c734a2e95107ebf393f2b4e5a1c286f5f0d3270";

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
