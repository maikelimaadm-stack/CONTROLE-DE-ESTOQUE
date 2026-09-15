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
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A BASE É A DA PR, NÃO A PONTA DE HOJE (PRE-BASE2-05C-0).
 *
 * Duas versões deste arquivo erraram o mesmo alvo por caminhos diferentes, e vale registrar as duas porque
 * a segunda parecia a correção da primeira:
 *
 *   1. um SHA DIGITADO no arquivo. Funcionou enquanto alguém lembrou de trocá-lo; quando ninguém trocou, o
 *      job seguiu VERDE comparando este HEAD com um commit de várias fatias atrás;
 *   2. `origin/main`. Resolve sozinho e nunca envelhece — mas é a PONTA DE HOJE. Se outra PR entrar na main
 *      entre a abertura desta e a execução do job, o skew passa a comparar com um binário que NÃO é a base
 *      desta PR. É o mesmo modo de falha, com outra roupa: verde medindo o commit errado.
 *
 * A autoridade de uma PR sobre qual é a sua base é o PRÓPRIO EVENTO: `pull_request.base.sha`, um SHA
 * imutável. O workflow o injeta em `SKEW_BASE_COMMIT`, e o script também sabe lê-lo do payload
 * (`$GITHUB_EVENT_PATH`) quando a variável não vier. A ponta de `origin/main` só entra onde não existe PR.
 *
 * ORDEM, e o que cada degrau significa:
 *   1. `--base=<sha|ref>`            EXIGIDO  controle explícito (reprodução local, investigação)
 *   2. `SKEW_BASE_COMMIT` não-vazio  EXIGIDO  o que o workflow injeta em PR
 *   3. `pull_request.base.sha`       EXIGIDO  o evento, quando a variável não veio
 *   4. `GITHUB_BASE_REF`             EXIGIDO  CI de PR sem payload legível
 *   5. ponta de `origin/<padrão>`     —       fora de PR
 *   6. primeiro pai do HEAD           —       quando a base resolvida É o HEAD (push no ramo padrão)
 *
 * EXIGIDO quer dizer: se aquele degrau existe e não resolve, o script ABORTA. Não cai para o seguinte —
 * cair seria trocar a base da PR por outra coisa em silêncio, que é exatamente o defeito. Uma variável
 * VAZIA não é um degrau: o workflow injeta a expressão sempre, e num evento de push ela vem vazia por não
 * haver PR. Vazio = ausente; preenchido e irresolvível = aborta.
 *
 * Nunca há queda para um SHA embutido. Um valor de reserva aqui seria o defeito nº 1 com outro nome.
 */
const RAMO_PADRAO = "main";
const VAR_BASE = "SKEW_BASE_COMMIT";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Fora de `apps/`, para que nenhum tsconfig/eslint/next do repositório enxergue esta árvore. */
export const DIR_ANTERIOR = join(RAIZ, ".api-anterior");
/**
 * A BASE RESOLVIDA, GRAVADA — resolução UMA VEZ por execução do job.
 *
 * Os testes de skew precisam saber contra qual SHA conferir a árvore. Recalcular a resolução dentro do
 * teste parecia inofensivo e não é: num evento de `push` (o CI roda em `branches: ["**"]`) não há PR, a
 * resolução cai na ponta de `origin/main` e, em clone raso, cada chamada refaz o `fetch` — duas chamadas
 * podem obter pontas diferentes se a main mexer no meio do job. O teste ficaria VERMELHO sem defeito
 * nenhum, e a "prova de igualdade" passaria a depender de REDE dentro de um e2e.
 *
 * Então quem monta a árvore grava o SHA aqui, e quem confere LÊ. Uma resolução, um valor, sem rede.
 */
export const ARQUIVO_BASE = join(RAIZ, ".api-anterior.base");
/** O SHA que esta execução usou; `null` se a árvore ainda não foi montada. */
export const baseGravada = () => { try { const x = readFileSync(ARQUIVO_BASE, "utf8").trim(); return /^[0-9a-f]{40}$/.test(x) ? x : null; } catch { return null; } };

const git = (...args) => execFileSync("git", args, { cwd: RAIZ, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const rodar = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
const abortar = (msg) => { throw new Error(`[skew] BASE NÃO RESOLVIDA — ${msg}. O job de skew não roda sem saber contra qual commit compara.`); };

/**
 * A ESCOLHA DA FONTE, PURA — sem git, sem arquivo, sem rede.
 *
 * Separada de propósito: é ela que carrega a regra "a base da PR vence a ponta da branch", e uma regra que
 * só pudesse ser exercitada mexendo na `main` de verdade não teria como ser provada. Recebe o ambiente e os
 * argumentos já lidos; devolve o ref a resolver, de onde ele veio, e se aquele degrau é EXIGIDO.
 *
 * @param {{ env?: Record<string,string|undefined>, argv?: string[], baseDoEvento?: string|null }} entrada
 * @returns {{ ref: string, origem: string, exigido: boolean }}
 */
export function escolherFonteDaBase({ env = {}, argv = [], baseDoEvento = null } = {}) {
  const arg = argv.find((a) => a.startsWith("--base="));
  if (arg && arg.slice("--base=".length)) return { ref: arg.slice("--base=".length), origem: "--base=", exigido: true };

  // Vazio é AUSENTE: o workflow injeta `${{ github.event.pull_request.base.sha }}` sempre, e num push não há PR.
  const daVar = (env[VAR_BASE] ?? "").trim();
  if (daVar) return { ref: daVar, origem: `$${VAR_BASE}`, exigido: true };

  if (baseDoEvento) return { ref: baseDoEvento, origem: "pull_request.base.sha", exigido: true };

  const baseRef = (env.GITHUB_BASE_REF ?? "").trim();
  if (baseRef) return { ref: `origin/${baseRef}`, origem: `GITHUB_BASE_REF=${baseRef}`, exigido: true };

  return { ref: `origin/${RAMO_PADRAO}`, origem: `ponta de origin/${RAMO_PADRAO}`, exigido: false };
}

/** `pull_request.base.sha` do payload do evento, quando houver. Devolve null em qualquer outro caso. */
export function baseDoEventoDePR(env = process.env, lerArquivo = (f) => readFileSync(f, "utf8")) {
  if (env.GITHUB_EVENT_NAME !== "pull_request" || !env.GITHUB_EVENT_PATH) return null;
  try {
    const sha = JSON.parse(lerArquivo(env.GITHUB_EVENT_PATH))?.pull_request?.base?.sha;
    return typeof sha === "string" && sha ? sha : null;
  } catch { return null; }   // payload ausente ou ilegível: o degrau seguinte decide
}

/**
 * O arquivo cuja presença indica "a árvore já foi montada". `raiz` e `dir` são parâmetros para que o teste
 * de R16 possa exercitar a função num repositório temporário PRÓPRIO: no CI o checkout é raso
 * (`fetch-depth: 1`) e `HEAD~1` não existe, então um teste que dependesse de dois commits do repositório
 * real passaria na máquina e reprovaria no CI — verde local e vermelho remoto pelo mesmo código.
 */
export const MARCA_DE_ARVORE = "apps/api/src/main.ts";

/**
 * O NOME QUE O REMOTO CONHECE. `origin/main` é o ref de RASTREIO local; no remoto ele se chama `main`.
 * `git fetch origin origin/main` responde `couldn't find remote ref` — e num clone raso, onde o ref de
 * rastreio não existe localmente, essa era a única tentativa: a resolução falhava e o script abortava num
 * evento de `push`, que é justamente onde não há PR para declarar a base.
 */
export const refRemoto = (ref) => String(ref).replace(/^origin\//, "");

/** `<ref>` -> SHA, buscando do remoto quando o clone é raso. `null` quando o ref não existe. */
function shaDoRef(ref) {
  try { return git("rev-parse", "--verify", `${ref}^{commit}`); } catch { /* clone raso ou ref de rastreio ausente */ }
  try { rodar("git", ["fetch", "--depth=1", "origin", refRemoto(ref)], RAIZ); return git("rev-parse", "--verify", "FETCH_HEAD^{commit}"); } catch { return null; }
}

/**
 * A base efetiva, já validada. Exportada como FUNÇÃO de propósito: uma constante de módulo seria avaliada na
 * importação, e o erro de resolução apareceria longe de quem o causou.
 */
export function commitAnterior() {
  const cabeca = git("rev-parse", "HEAD");
  const fonte = escolherFonteDaBase({ env: process.env, argv: process.argv, baseDoEvento: baseDoEventoDePR() });
  let sha = shaDoRef(fonte.ref);
  let origem = fonte.origem;
  if (!sha) {
    // EXIGIDO não cai para o degrau seguinte: trocar a base da PR por outra coisa em silêncio É o defeito.
    if (fonte.exigido) abortar(`\`${fonte.ref}\` (${fonte.origem}) não é um commit alcançável`);
    abortar(`\`${fonte.ref}\` não foi alcançado`);
  }
  if (sha === cabeca) {
    // Acontece ao empurrar no próprio ramo padrão: a ponta da base É este commit. Comparar o HEAD com ele
    // mesmo passaria sempre e não provaria nada — então a base vira o commit ANTERIOR, que é o que estava
    // no ar até este push. Só vale para o degrau NÃO exigido: se a PR declarou a base, ela manda.
    if (fonte.exigido) abortar(`a base declarada (${origem}) é o próprio HEAD ${cabeca.slice(0, 8)} — não há skew a medir`);
    try { rodar("git", ["fetch", "--depth=2", "origin", cabeca], RAIZ); } catch { /* histórico já local */ }
    let pai = null;
    try { pai = git("rev-parse", "--verify", `${cabeca}^^{commit}`); } catch { /* raiz ou clone raso demais */ }
    if (!pai) abortar(`a base resolvida (${origem}) é o próprio HEAD e o commit anterior não está disponível`);
    sha = pai; origem = `${origem} → primeiro pai do HEAD`;
  }
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
export function garantirWorktree(sha, dir = DIR_ANTERIOR, raiz = RAIZ) {
  if (existsSync(join(dir, MARCA_DE_ARVORE))) {
    let atual = null;
    try { atual = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] }).toString().trim(); } catch { /* árvore quebrada */ }
    if (atual === sha) return false;
    console.log(`[skew] árvore anterior está em ${atual ?? "estado desconhecido"} e a base é ${sha.slice(0, 8)} — refazendo`);
    try { rodar("git", ["worktree", "remove", "--force", dir], raiz); } catch { rmSync(dir, { recursive: true, force: true }); rodar("git", ["worktree", "prune"], raiz); }
  }
  mkdirSync(dirname(dir), { recursive: true });
  // `--detach`: sem branch, porque esta árvore é só leitura de um ponto do passado. Nada é commitado dela.
  rodar("git", ["worktree", "add", "--detach", dir, sha], raiz);
  const conferido = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
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
  garantirCommit(sha);
  writeFileSync(ARQUIVO_BASE, `${sha}\n`, "utf8");
  garantirDependencias(garantirWorktree(sha));
  // O BLOCO DE IDENTIDADE, no log do job. Quem lê o CI precisa poder responder "comparado com o quê?" sem
  // abrir o script — e precisa ver a IGUALDADE, não só o SHA pretendido.
  const arvore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: DIR_ANTERIOR, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
  console.log(`[skew] HEAD da PR ......... ${cabeca}`);
  console.log(`[skew] BASE esperada ...... ${sha}`);
  console.log(`[skew] fonte da base ...... ${origem}`);
  console.log(`[skew] HEAD da .api-anterior ${arvore}`);
  console.log(`[skew] igualdade .......... ${arvore === sha ? "OK" : "DIVERGENTE"}`);
  if (arvore !== sha) abortar(`a árvore ficou em ${arvore} e a base esperada é ${sha}`);
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
