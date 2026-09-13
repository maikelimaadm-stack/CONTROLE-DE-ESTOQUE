#!/usr/bin/env node
/**
 * O COMANDO DOCUMENTADO PRECISA EXISTIR DENTRO DA IMAGEM (PRE-BASE2-04).
 *
 * O runbook do backfill é executado UMA vez, no pós-merge, com o sistema já em produção. Se o comando que
 * está escrito na documentação não existir no artefato real, a descoberta acontece no pior momento possível
 * — com a migration aplicada, a API nova no ar e o acervo histórico ainda sem número.
 *
 * E a diferença entre "existe no repositório" e "existe na imagem" é grande: a imagem da API é
 * `pnpm --filter @agro/api deploy --prod --legacy /out`, ou seja, o pacote @agro/api COM SUAS DEPENDÊNCIAS
 * DE PRODUÇÃO — não um checkout do monorepo. Nela não há `package.json` da raiz (logo, nenhum script
 * `pnpm id-global:*`) e não há `tsx` (devDependency cortada pelo `--prod`).
 *
 * Este auditor prova ESTATICAMENTE o contrato; `--compilado` executa o artefato de verdade.
 */
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const problemas = [];
const erro = (m) => problemas.push(m);
const ler = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const raiz = new URL("..", import.meta.url).pathname;

// ---------------------------------------------------------------------------------------------
// 1. CONTRATO DO PACOTE QUE VAI PARA A IMAGEM
// ---------------------------------------------------------------------------------------------
const pkg = JSON.parse(ler("apps/api/package.json"));
const COMANDOS = ["id-global:backfill", "id-global:verify"];
for (const nome of COMANDOS) {
  const cmd = pkg.scripts?.[nome];
  if (!cmd) { erro(`apps/api/package.json: falta o script "${nome}" — o runbook de produção não teria o que executar`); continue; }
  if (!cmd.startsWith("node dist/")) erro(`apps/api/package.json["${nome}"]: precisa executar o COMPILADO (node dist/...), e não ${cmd}`);
  if (/\btsx\b|\bts-node\b|\bsrc\//.test(cmd)) erro(`apps/api/package.json["${nome}"]: depende de ferramenta de desenvolvimento ou de src/ — a imagem é --prod e não tem nenhum dos dois`);
}
const devDeps = Object.keys(pkg.devDependencies ?? {});
for (const nome of COMANDOS) {
  const cmd = pkg.scripts?.[nome] ?? "";
  for (const d of devDeps) if (new RegExp(`(^|[\\s"'])${d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([\\s"']|$)`).test(cmd)) {
    erro(`apps/api/package.json["${nome}"]: usa a devDependency "${d}", que não existe na imagem`);
  }
}

// ---------------------------------------------------------------------------------------------
// 2. O FONTE DO CLI EXISTE E É COMPILADO PELO BUILD DO PACOTE
// ---------------------------------------------------------------------------------------------
if (!existsSync(new URL("../apps/api/src/cli/id-global-backfill.ts", import.meta.url))) {
  erro("apps/api/src/cli/id-global-backfill.ts não existe");
}
const tsconfig = JSON.parse(ler("apps/api/tsconfig.build.json").replace(/^\s*\/\/.*$/gm, ""));
if (!(tsconfig.include ?? []).includes("src")) erro("apps/api/tsconfig.build.json não compila src/ — o CLI não entraria em dist/");
if (tsconfig.compilerOptions?.outDir !== "dist") erro("apps/api/tsconfig.build.json: outDir precisa ser dist/");

// ---------------------------------------------------------------------------------------------
// 3. A IMAGEM LEVA O PACOTE COMPLETO (dist + package.json) PARA O ESTÁGIO DE RUNTIME
// ---------------------------------------------------------------------------------------------
const dockerfile = ler("apps/api/Dockerfile");
if (!/pnpm --filter @agro\/api deploy --prod/.test(dockerfile)) erro("apps/api/Dockerfile: o deploy --prod do pacote mudou — reveja o que vai para a imagem");
if (!/COPY --from=build \/out \.\//.test(dockerfile)) erro("apps/api/Dockerfile: o estágio de runtime precisa copiar /out (pacote + dist + package.json)");
if (!/pnpm --filter @agro\/api build/.test(dockerfile)) erro("apps/api/Dockerfile: o build do pacote @agro/api precisa acontecer antes do deploy --prod");

// ---------------------------------------------------------------------------------------------
// 4. O RUNBOOK DOCUMENTA O COMANDO DO ARTEFATO, NÃO O DO REPOSITÓRIO
// ---------------------------------------------------------------------------------------------
const deploy = ler("docs/DEPLOYMENT.md");
for (const oficial of ["npm run id-global:backfill", "npm run id-global:verify"]) {
  if (!deploy.includes(oficial)) erro(`docs/DEPLOYMENT.md: o runbook de produção precisa usar "${oficial}" (o comando que existe na imagem)`);
}
if (!/MIGRATE_DATABASE_URL/.test(deploy)) erro("docs/DEPLOYMENT.md: o runbook precisa nomear a conexão operacional (MIGRATE_DATABASE_URL)");

// ---------------------------------------------------------------------------------------------
// 5. --compilado: executa o ARTEFATO de verdade (exige `pnpm --filter @agro/api build` antes)
// ---------------------------------------------------------------------------------------------
const PROIBIDO = [/MODULE_NOT_FOUND/i, /Cannot find module/i, /tsx: (not found|command not found)/i, /Missing script/i, /ERR_MODULE_NOT_FOUND/i];
function executar(cmd, args, opts = {}) {
  // Ambiente SEM conexão operacional: o comando tem de recusar por esse motivo, e não por falta de arquivo.
  const env = { ...process.env, PATH: process.env.PATH, NODE_ENV: "production" };
  delete env.MIGRATE_DATABASE_URL; delete env.ID_GLOBAL_DATABASE_URL;
  env.DATABASE_URL = "postgresql://nao-deve-ser-usada@127.0.0.1:1/x"; // se cair para cá, o teste pega
  try {
    const saida = execFileSync(cmd, args, { cwd: raiz, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
    return { status: 0, saida };
  } catch (e) {
    return { status: e.status ?? 1, saida: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}
if (process.argv.includes("--compilado")) {
  const artefato = "apps/api/dist/cli/id-global-backfill.js";
  if (!existsSync(new URL(`../${artefato}`, import.meta.url))) {
    erro(`${artefato} não existe depois do build — o comando do runbook não estaria na imagem`);
  } else {
    for (const [rotulo, cmd, args] of [
      ["node dist/cli/id-global-backfill.js", "node", [artefato, "--verify-only"]],
      ["npm run id-global:verify", "npm", ["--prefix", "apps/api", "run", "id-global:verify"]]
    ]) {
      const r = executar(cmd, args);
      if (r.status === 0) erro(`${rotulo}: deveria RECUSAR sem conexão operacional, e terminou com sucesso`);
      if (!/MIGRATE_DATABASE_URL não definida/.test(r.saida)) {
        erro(`${rotulo}: recusou pelo motivo errado — esperado "MIGRATE_DATABASE_URL não definida". Saída: ${r.saida.trim().split("\n").slice(-3).join(" | ")}`);
      }
      for (const p of PROIBIDO) if (p.test(r.saida)) erro(`${rotulo}: falhou por artefato ausente (${p}) — o comando não está na imagem`);
      if (/nao-deve-ser-usada/.test(r.saida)) erro(`${rotulo}: caiu para DATABASE_URL`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 6. --deploy: monta o pacote EXATAMENTE como o Dockerfile (pnpm deploy --prod) e roda de dentro dele
// ---------------------------------------------------------------------------------------------
if (process.argv.includes("--deploy")) {
  const destino = mkdtempSync(join(tmpdir(), "out-api-"));
  try {
    execFileSync("pnpm", ["--filter", "@agro/api", "deploy", "--prod", "--legacy", destino], { cwd: raiz, stdio: "pipe" });
    if (!existsSync(join(destino, "dist/cli/id-global-backfill.js"))) erro("pacote --prod: dist/cli/id-global-backfill.js não foi para o artefato");
    if (!existsSync(join(destino, "package.json"))) erro("pacote --prod: package.json não foi para o artefato");
    if (existsSync(join(destino, "node_modules/.bin/tsx"))) erro("pacote --prod: tsx está presente — o comando não pode depender disso");
    const r = executar("npm", ["run", "id-global:verify"], { cwd: destino });
    if (r.status === 0) erro("pacote --prod: o comando deveria recusar sem conexão operacional");
    if (!/MIGRATE_DATABASE_URL não definida/.test(r.saida)) erro(`pacote --prod: recusou pelo motivo errado: ${r.saida.trim().split("\n").slice(-2).join(" | ")}`);
    for (const p of PROIBIDO) if (p.test(r.saida)) erro(`pacote --prod: ${p} — o artefato está incompleto`);
  } catch (e) {
    erro(`pacote --prod: não foi possível montar ou executar o artefato (${(e.stderr ?? e.message ?? "").toString().trim().split("\n").slice(-2).join(" | ")})`);
  } finally { rmSync(destino, { recursive: true, force: true }); }
}

if (problemas.length) {
  console.error("artefato-operacional: o comando documentado NÃO é o comando da imagem:");
  for (const p of problemas) console.error(`  - ${p}`);
  process.exit(1);
}
const modo = [process.argv.includes("--compilado") && "artefato compilado executado", process.argv.includes("--deploy") && "pacote --prod montado e executado"].filter(Boolean).join(" + ") || "estático";
console.log(`artefato-operacional: OK (${modo}; 2 comandos de produção em node dist/, sem devDependency)`);
