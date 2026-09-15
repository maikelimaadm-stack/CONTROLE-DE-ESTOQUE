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
 * Idempotente: rodar duas vezes não refaz nada — desde que a BASE não tenha mudado (ver abaixo). Uso:
 *
 *   node scripts/api-anterior.mjs                 # prepara e imprime o diretório
 *   node scripts/api-anterior.mjs --dir           # imprime só o diretório (para script de shell)
 *   node scripts/api-anterior.mjs --base=<sha>    # força a base (investigação, reexecução local)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A BASE É RESOLVIDA, NUNCA DIGITADA (PRE-BASE2-05C-0).
 *
 * Até aqui esta constante era um SHA fixo no arquivo. Isso funcionou enquanto alguém se lembrou de trocá-lo
 * a cada fatia — e parou de funcionar em silêncio quando ninguém trocou: o job de skew continuava VERDE
 * comparando este HEAD com um commit de várias fatias atrás. O teste não falhava; ele mudava de assunto.
 * É o modo de falha que esta fatia inteira existe para eliminar, e o mais caro dos três: a prova continua
 * rodando, continua verde, e deixou de medir o cenário de produção.
 *
 * A base passa a sair, nesta ordem, de uma fonte que se MOVE junto com a PR:
 *   1. `--base=<sha|ref>` ou `SKEW_BASE_COMMIT`  — controle explícito (reexecução local, investigação);
 *   2. `GITHUB_BASE_REF`                          — no CI de PR, a ponta do ramo de destino: o que está no ar;
 *   3. ponta de `origin/<RAMO_PADRAO>`            — em qualquer outro lugar;
 *   4. primeiro pai do HEAD                       — quando a base resolvida É o HEAD (push no próprio ramo
 *                                                   padrão), porque ali "o que está no ar" é o commit anterior.
 *
 * E é FAIL-CLOSED em todas as pontas: se a base não resolve, se o objeto não existe, se não é commit, ou se
 * é igual ao HEAD, o script ABORTA. Nunca há queda para um SHA embutido — um valor de reserva aqui seria
 * exatamente o defeito acima, com outro nome. Um job de skew que não sabe contra o que está comparando não
 * tem resultado melhor do que nenhum; tem um resultado PIOR, porque parece um.
 *
 * O SHA resolvido e a fonte dele são IMPRESSOS. Quem lê o log do CI precisa poder responder "comparado com
 * o quê?" sem abrir o script.
 */
const RAMO_PADRAO = "main";
const VAR_BASE = "SKEW_BASE_COMMIT";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Fora de `apps/`, para que nenhum tsconfig/eslint/next do repositório enxergue esta árvore. */
export const DIR_ANTERIOR = join(RAIZ, ".api-anterior");

const git = (...args) => execFileSync("git", args, { cwd: RAIZ, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const rodar = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
const abortar = (msg) => { throw new Error(`[skew] BASE NÃO RESOLVIDA — ${msg}. O job de skew não roda sem saber contra qual commit compara.`); };

/** `<ref>` -> SHA, buscando do remoto quando o clone é raso. `null` quando o ref não existe. */
function shaDoRef(ref) {
  try { return git("rev-parse", "--verify", `${ref}^{commit}`); } catch { /* clone raso ou ref remoto ausente */ }
  try { rodar("git", ["fetch", "--depth=1", "origin", ref], RAIZ); return git("rev-parse", "--verify", "FETCH_HEAD^{commit}"); } catch { return null; }
}

/** De onde veio a base, para o log e para a mensagem de erro. */
function resolverBase() {
  const arg = process.argv.find((a) => a.startsWith("--base="));
  const explicito = arg ? arg.slice("--base=".length) : process.env[VAR_BASE];
  if (explicito) {
    const sha = shaDoRef(explicito);
    if (!sha) abortar(`\`${explicito}\` (${arg ? "--base=" : `$${VAR_BASE}`}) não é um commit alcançável`);
    return { sha, origem: arg ? "--base=" : `$${VAR_BASE}` };
  }
  // No CI de PR, o destino da PR é o que está em produção enquanto ela não sobe.
  if (process.env.GITHUB_BASE_REF) {
    const sha = shaDoRef(`origin/${process.env.GITHUB_BASE_REF}`) ?? shaDoRef(process.env.GITHUB_BASE_REF);
    if (!sha) abortar(`o ramo de destino da PR (\`${process.env.GITHUB_BASE_REF}\`) não foi alcançado`);
    return { sha, origem: `GITHUB_BASE_REF=${process.env.GITHUB_BASE_REF}` };
  }
  const sha = shaDoRef(`origin/${RAMO_PADRAO}`) ?? shaDoRef(RAMO_PADRAO);
  if (!sha) abortar(`\`origin/${RAMO_PADRAO}\` não foi alcançado`);
  return { sha, origem: `origin/${RAMO_PADRAO}` };
}

/**
 * A base efetiva, já validada. Exportada como FUNÇÃO de propósito: uma constante de módulo seria avaliada na
 * importação, e o erro de resolução apareceria longe de quem o causou.
 */
export function commitAnterior() {
  const cabeca = git("rev-parse", "HEAD");
  let { sha, origem } = resolverBase();
  if (sha === cabeca) {
    // Acontece ao empurrar no próprio ramo padrão: a ponta da base É este commit. Comparar o HEAD com ele
    // mesmo passaria sempre e não provaria nada — então a base vira o commit ANTERIOR, que é o que estava
    // no ar até este push.
    try { rodar("git", ["fetch", "--depth=2", "origin", cabeca], RAIZ); } catch { /* histórico já local */ }
    let pai = null;
    try { pai = git("rev-parse", "--verify", `${cabeca}^^{commit}`); } catch { /* raiz ou clone raso demais */ }
    if (!pai) abortar(`a base resolvida (${origem}) é o próprio HEAD e o commit anterior não está disponível`);
    sha = pai; origem = `${origem} → primeiro pai do HEAD`;
  }
  // `rev-parse` já garantiu que é um commit; esta linha garante que ele está NESTE repositório depois do
  // fetch, que é o que a árvore de trabalho vai precisar.
  try { git("cat-file", "-e", `${sha}^{commit}`); } catch { abortar(`o objeto ${sha} não está no repositório`); }
  return { sha, origem, cabeca };
}

function garantirCommit(sha) {
  try { git("cat-file", "-e", `${sha}^{commit}`); return; } catch { /* clone raso: falta o objeto */ }
  // `actions/checkout` traz um commit só. Buscar a base pelo SHA é mais barato e mais determinístico do que
  // pedir `fetch-depth: 0` — não depende do tamanho do histórico do repositório.
  rodar("git", ["fetch", "--depth=1", "origin", sha], RAIZ);
}

/**
 * A ÁRVORE REAPROVEITADA TEM DE SER A DA BASE ATUAL.
 *
 * Antes bastava o arquivo existir para a árvore ser considerada boa. Com a base fixa isso era inofensivo;
 * com a base resolvida por PR, uma `.api-anterior` deixada por uma execução anterior faria o skew rodar
 * contra o commit ERRADO — de novo verde, de novo medindo outra coisa. Então a árvore é conferida pelo HEAD
 * dela e refeita quando não confere.
 */
function garantirWorktree(sha) {
  if (existsSync(join(DIR_ANTERIOR, "apps/api/src/main.ts"))) {
    let atual = null;
    try { atual = execFileSync("git", ["rev-parse", "HEAD"], { cwd: DIR_ANTERIOR, stdio: ["ignore", "pipe", "pipe"] }).toString().trim(); } catch { /* árvore quebrada */ }
    if (atual === sha) return false;
    console.log(`[skew] árvore anterior está em ${atual ?? "estado desconhecido"} e a base é ${sha.slice(0, 8)} — refazendo`);
    try { rodar("git", ["worktree", "remove", "--force", DIR_ANTERIOR], RAIZ); } catch { rmSync(DIR_ANTERIOR, { recursive: true, force: true }); rodar("git", ["worktree", "prune"], RAIZ); }
  }
  mkdirSync(dirname(DIR_ANTERIOR), { recursive: true });
  // `--detach`: sem branch, porque esta árvore é só leitura de um ponto do passado. Nada é commitado dela.
  rodar("git", ["worktree", "add", "--detach", DIR_ANTERIOR, sha], RAIZ);
  const conferido = execFileSync("git", ["rev-parse", "HEAD"], { cwd: DIR_ANTERIOR, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
  if (conferido !== sha) abortar(`a árvore de trabalho ficou em ${conferido}, e a base é ${sha}`);
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
  const { sha, origem, cabeca } = commitAnterior();
  console.log(`[skew] base ${sha.slice(0, 8)} (${origem}) × HEAD ${cabeca.slice(0, 8)}`);
  garantirCommit(sha);
  garantirDependencias(garantirWorktree(sha));
  return DIR_ANTERIOR;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const soDiretorio = process.argv.includes("--dir");
  const comWeb = process.argv.includes("--web");
  // O atalho de `--dir` só vale se a árvore existente for a da base ATUAL: imprimir um diretório obsoleto
  // faria o Playwright subir o binário errado sem que nada reclamasse.
  const base = commitAnterior();
  if (soDiretorio && !comWeb && existsSync(join(DIR_ANTERIOR, "packages/db/dist/index.js")) && !garantirWorktree(base.sha)) { console.log(DIR_ANTERIOR); process.exit(0); }
  const dir = comWeb ? prepararWebAnterior() : prepararApiAnterior();
  console.log(soDiretorio ? dir : `API do commit ${base.sha.slice(0, 8)} pronta em ${dir}`);
}
