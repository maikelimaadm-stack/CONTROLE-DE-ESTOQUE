#!/usr/bin/env node
/**
 * AUDITOR NÃO VIRA COAUTOR (DEVEX-01).
 *
 * Os seis subagentes de auditoria recebem `tools: Read, Grep, Glob, Bash`. A lista branca tira
 * Write/Edit, mas NÃO os torna somente-leitura: `>`, `tee`, `sed -i`, `rm`, `mv`, um script Python
 * de uma linha — qualquer um desses escreve pelo Bash. Dizer no prompt "você não tem ferramenta de
 * escrita" era, portanto, uma afirmação falsa sobre o mecanismo; o texto pedia uma coisa e a
 * ferramenta permitia outra.
 *
 * Isso importa porque certificador que conserta o que encontrou deixa de certificar: ele passa a
 * revisar o próprio trabalho, e o revisor humano recebe um diff que ninguém auditou.
 *
 * Aqui a regra é FAIL CLOSED e vale SÓ para os auditores (`agent_type`): o executor principal não é
 * afetado. Comando que não estiver inequivocamente classificado como leitura ou gate conhecido é
 * negado — inclusive comando novo e inofensivo, que é o preço de não precisar prever o perigoso.
 *
 * O parser é o MESMO do guarda de comandos perigosos (importado, não copiado): duas cópias da
 * tokenização divergiriam na primeira correção feita só de um lado.
 *
 * Autoteste (não executa comando algum):
 *   node .claude/hooks/guard-auditor-command.mjs --autoteste
 */
import {
  segmentar, programaEArgumentos, posicionais, redirecionamentoDeEscrita,
  bancoDeTesteNaoProvadoLocal
} from "./guard-dangerous-command.mjs";

// -------------------------------------------------------------------------------------------------
// 1. QUEM É AUDITOR
// -------------------------------------------------------------------------------------------------

/** Precisa casar exatamente os arquivos de `.claude/agents/`. O gate do harness confere. */
export const AUDITORES = new Set([
  "security-rls-auditor",
  "migration-auditor",
  "test-gate-verifier",
  "frontend-regression-reviewer",
  "performance-reviewer",
  "pr-certifier"
]);

// -------------------------------------------------------------------------------------------------
// 2. O QUE UM AUDITOR PODE RODAR
// -------------------------------------------------------------------------------------------------

/**
 * Programas que leem com QUALQUER argumento — e só estes.
 *
 * "Binário X é leitura" é premissa falsa para boa parte das ferramentas de linha de comando:
 * `sort -o`, `tree -o`, `yq -i`, `file -C` e `date -s` escrevem arquivo ou mudam o sistema. Quem
 * tem modo mutante sai desta lista e ganha validador próprio abaixo — a classificação é do MODO,
 * não do nome do programa.
 */
const LEITURA_PURA = new Set([
  "cat", "head", "tail", "wc", "grep", "rg", "egrep", "fgrep", "uniq", "cut", "tr", "nl",
  "comm", "diff", "stat", "du", "df", "basename", "dirname", "realpath",
  "readlink", "ls", "pwd", "echo", "printf", "true", "false", "cd", "which", "type", "column",
  "strings", "od", "seq", "test"
]);

/** Programa → opções que o tiram do modo de leitura. Fail closed por opção, não por nome. */
const MODO_MUTANTE = new Map([
  ["sort", ["-o", "--output"]],
  ["tree", ["-o", "--outfile"]],
  ["yq", ["-i", "--inplace", "--in-place"]],
  ["file", ["-C", "--compile"]],
  ["date", ["-s", "--set"]],
  ["jq", []]
]);

/** Subcomandos de leitura do git. Fora desta lista, o git do auditor não roda. */
const GIT_LEITURA = new Set([
  "status", "diff", "show", "log", "grep", "ls-files", "ls-tree", "cat-file", "rev-parse",
  "rev-list", "describe", "blame", "shortlog", "diff-tree", "name-rev", "merge-base",
  "symbolic-ref", "count-objects", "check-ignore", "whatchanged", "fetch", "branch", "remote",
  "tag", "stash", "worktree", "config"
]);

/** Opções que transformam um subcomando "de leitura" do git em escrita de referência. */
const GIT_MUTANTE = new Map([
  ["branch", ["-d", "-D", "-m", "-M", "-c", "-C", "-f", "-u", "--delete", "--move", "--copy",
              "--force", "--set-upstream", "--set-upstream-to", "--unset-upstream", "--edit-description"]],
  ["tag", ["-a", "-s", "-d", "-f", "-m", "--annotate", "--sign", "--delete", "--force"]],
  ["symbolic-ref", ["-d", "--delete", "-m"]],
  ["fetch", ["--prune", "-p", "--force", "-f", "--update-head-ok", "--tags", "-t", "--all", "--multiple"]]
]);
/** Quantos posicionais um subcomando de leitura pode ter (incluindo o próprio subcomando). */
const GIT_POSICIONAIS_MAXIMOS = new Map([
  ["branch", 1],          // `git branch <nome>` CRIA referência
  ["tag", 1],             // `git tag <nome>` CRIA tag
  ["symbolic-ref", 2],    // ler é `symbolic-ref HEAD`; com destino, escreve
  ["fetch", 2]            // `fetch <remoto>`; com refspec, escreve ref local arbitrária
]);
/** Com estas opções de listagem, um posicional extra é PADRÃO de busca, não criação. */
const GIT_LISTAGEM = ["--list", "-l", "--contains", "--points-at", "--merged", "--no-merged"];

/** Scripts de gate do repositório. `audit:*` é conferido contra o package.json pelo gate do harness. */
export const SCRIPTS_DE_GATE = new Set([
  "lint", "typecheck", "test", "test:integration", "e2e", "build", "parity", "parity:check",
  "audit:naming", "audit:member-farms", "audit:notifications", "audit:responsavel",
  "audit:empresa", "audit:farm", "audit:dictionary", "audit:id-global", "audit:claude-harness",
  // Leitura pura: confere que a dívida DEFERRED da matriz de suporte continua versionada e
  // executável. Não roda teste, não toca banco, não escreve nada.
  "audit:ui-support", "e2e:mobile"
]);

const flagPresente = (args, ...nomes) =>
  args.some((a) => nomes.some((n) => a === n || a.startsWith(`${n}=`)));

/** @returns {string|null} motivo da recusa, ou null quando o comando é aceitável para um auditor. */
function julgarSegmento(programa, args, linha) {
  if (LEITURA_PURA.has(programa)) return null;

  if (MODO_MUTANTE.has(programa)) {
    const mutantes = MODO_MUTANTE.get(programa).filter((o) => flagPresente(args, o));
    return mutantes.length ? `\`${programa}\` em modo de escrita (${mutantes[0]})` : null;
  }
  if (programa === "find") {
    return flagPresente(args, "-delete", "-exec", "-execdir", "-ok", "-okdir", "-fls", "-fprint", "-fprintf")
      ? "`find` com execução ou remoção" : null;
  }
  if (programa === "sed") {
    return flagPresente(args, "-i", "--in-place") || args.some((a) => /^-[a-zA-Z]*i/.test(a))
      ? "`sed` reescrevendo o arquivo no lugar" : null;
  }

  if (programa === "git") {
    const pos = posicionais(args);
    const sub = pos[0];
    if (!sub || !GIT_LEITURA.has(sub)) return `\`git ${sub ?? ""}\`.trim() não é subcomando de leitura`;
    const mutantes = (GIT_MUTANTE.get(sub) ?? []).filter((o) => flagPresente(args, o));
    if (mutantes.length) return `\`git ${sub}\` em modo de escrita (${mutantes[0]})`;
    const maximo = GIT_POSICIONAIS_MAXIMOS.get(sub);
    if (maximo !== undefined) {
      // com opção de listagem, um posicional extra é PADRÃO de busca — não criação de referência
      const folga = flagPresente(args, ...GIT_LISTAGEM) ? 1 : 0;
      if (pos.length > maximo + folga) return `\`git ${sub}\` com argumento que escreve referência`;
    }
    if (sub === "remote" && pos[1] && !["show", "get-url"].includes(pos[1])) return "`git remote` alterando configuração";
    if (sub === "stash" && pos[1] !== "list") return "`git stash` mexe na árvore de trabalho";
    if (sub === "worktree" && pos[1] !== "list") return "`git worktree` cria ou remove árvore";
    if (sub === "config" && !flagPresente(args, "--get", "--get-all", "--list", "-l")) return "`git config` gravando";
    return null;
  }

  if (["pnpm", "npm", "yarn"].includes(programa)) {
    /**
     * FORMA EXATA: `<gerenciador> [--filter <pacote>] [run] <script>` e mais nada.
     * O nome do script não basta — `pnpm lint -- --fix` reescreve código, `pnpm test -- -u` e
     * `pnpm e2e --update-snapshots` regravam snapshots. Um argumento extra transforma verificação
     * em escrita, então argumento extra nenhum passa.
     */
    const restante = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "--filter") { i++; continue; }
      if (a.startsWith("--filter=")) continue;
      if (a === "run") continue;
      restante.push(a);
    }
    if (restante.length !== 1) return "forma não é `<gerenciador> [--filter pacote] <script>` sem argumento extra";
    const script = restante[0];
    if (!SCRIPTS_DE_GATE.has(script)) return `script "${script}" não é gate conhecido`;
    // gates que resetam banco de teste só rodam contra alvo comprovadamente local
    const banco = bancoDeTesteNaoProvadoLocal(programa, args, linha);
    if (banco) return banco;
    return null;
  }

  return `"${programa}" não está na lista de leitura do auditor`;
}

/** @returns {{motivo:string}|null} */
export function avaliarAuditor(linha) {
  if (redirecionamentoDeEscrita(linha)) return { motivo: "redirecionamento que escreve arquivo" };
  for (const tokens of segmentar(linha)) {
    const pa = programaEArgumentos(tokens);
    if (!pa) continue;
    const [programa, ...args] = pa;
    const motivo = julgarSegmento(programa, args, linha);
    if (motivo) return { motivo };
  }
  return null;
}

// -------------------------------------------------------------------------------------------------
// 3. AUTOTESTE (fixtures — nenhum comando é executado)
// -------------------------------------------------------------------------------------------------

/** Nome montado de propósito: escrito por extenso, casaria o secret scan do CI. Host inexistente. */
const V_TESTE = `TEST_${"DATABASE_URL"}`;
const DSN_LOCAL = "postgresql://postgres@127.0.0.1:5433/agro_erp_test";
const DSN_REMOTO = "postgresql://postgres@db.exemplo.invalido:5432/prod";

export const FIXTURES = {
  negar: [
    "echo x > arquivo.ts",
    "echo x >> arquivo.ts",
    "cat a.ts > b.ts",
    "echo x | tee arquivo.ts",
    "sed -i 's/a/b/' arquivo.ts",
    "perl -pi -e 's/a/b/' arquivo.ts",
    "rm arquivo.ts",
    "mv a.ts b.ts",
    "cp a.ts b.ts",
    "touch novo.ts",
    "mkdir pasta",
    "git add -A",
    "git commit -m 'x'",
    "git push origin claude/x",
    "git checkout -b claude/nova",
    "git switch -c claude/nova",
    "git restore --staged .",
    "git stash",
    "git branch -D claude/x",
    "git config user.name x",
    "git fetch --prune origin",
    "python3 script.py",
    "node script.mjs",
    "tsx script.ts",
    "bash -c 'git status'",
    "sh -c 'pnpm lint'",
    "pwsh -Command 'ls'",
    "xargs rm",
    "awk '{print > \"saida.txt\"}' entrada.txt",
    "find . -name '*.ts' -delete",
    "find . -name '*.ts' -exec rm {} ;",
    "pnpm db:seed:e2e",
    "pnpm id-global:verify",
    "pnpm docs:generate",
    "pnpm --dir packages/db lint",
    "npx tsx qualquer.ts",
    "curl https://exemplo.com",
    // modo mutante de programa que, pelo nome, pareceria leitura
    "sort -o saida.txt entrada.txt",
    "tree -o arvore.txt .",
    "yq -i '.x=1' config.yml",
    "file -C",
    "date -s '2026-01-01'",
    // git de leitura com argumento que escreve referência
    "git branch nova",
    "git branch --set-upstream-to=origin/x",
    "git branch --unset-upstream",
    "git tag v1",
    "git symbolic-ref HEAD refs/heads/outra",
    "git fetch origin main:refs/heads/outra",
    "git fetch --tags origin",
    // argumento extra transforma o gate em escrita
    "pnpm lint -- --fix",
    "pnpm --filter @agro/api lint -- --fix",
    "pnpm test -- -u",
    "pnpm e2e -- --update-snapshots",
    "pnpm e2e --update-snapshots",
    "pnpm build --write",
    // gate que reseta banco de teste com alvo não provado local
    `${V_TESTE}=${DSN_REMOTO} pnpm test:integration`
  ],
  permitir: [
    "git status",
    "git diff origin/main...HEAD",
    "git show HEAD",
    "git log --oneline -20",
    "git grep -n 'runService'",
    "git ls-files apps/api",
    "git fetch origin",
    "git branch",
    "git remote -v",
    "git config --get remote.origin.url",
    "grep -rn 'empresa_id' apps/api/src",
    "rg --files-with-matches 'runService'",
    "find . -name '*.sql'",
    "cat apps/api/src/index.ts",
    "head -50 CLAUDE.md",
    "tail -n 100 docs/DECISIONS.md",
    "wc -l scripts/claude-harness-audit.mjs",
    "ls -la .claude/agents",
    "sed -n '1,40p' apps/api/src/index.ts",
    "jq '.scripts' package.json",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm test",
    "pnpm test:integration",
    "pnpm e2e",
    "pnpm build",
    "pnpm parity:check",
    "pnpm audit:claude-harness",
    "pnpm audit:id-global",
    "pnpm --filter @agro/api test",
    "pnpm lint 2>&1",
    "sort entrada.txt",
    "tree .",
    "yq '.x' config.yml",
    "file arquivo.txt",
    "date",
    "git branch --show-current",
    "git branch -a",
    "git branch --list 'claude/*'",
    "git tag",
    "git tag --list 'v*'",
    "git symbolic-ref --short HEAD",
    "git remote show origin",
    `${V_TESTE}=${DSN_LOCAL} pnpm test:integration`,
    "grep -c erro relatorio.log 2>&1"
  ]
};

function autoteste() {
  const falhas = [];
  for (const linha of FIXTURES.negar) if (!avaliarAuditor(linha)) falhas.push(`DEVERIA NEGAR e permitiu: ${linha}`);
  for (const linha of FIXTURES.permitir) {
    const r = avaliarAuditor(linha);
    if (r) falhas.push(`DEVERIA PERMITIR e negou (${r.motivo}): ${linha}`);
  }
  if (falhas.length) {
    console.error("guard-auditor-command: AUTOTESTE FALHOU");
    for (const f of falhas) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`guard-auditor-command: autoteste OK (${FIXTURES.negar.length} negados, ${FIXTURES.permitir.length} permitidos, ${AUDITORES.size} auditores protegidos)`);
}

// -------------------------------------------------------------------------------------------------
// 4. ENTRADA
// -------------------------------------------------------------------------------------------------

const ehPrincipal = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (ehPrincipal) {
  if (process.argv.includes("--autoteste")) { autoteste(); }
  else {
    const partes = [];
    process.stdin.on("data", (c) => partes.push(c));
    process.stdin.on("end", () => {
      let entrada;
      try { entrada = JSON.parse(Buffer.concat(partes).toString("utf8") || "{}"); } catch { process.exit(0); }
      if (!AUDITORES.has(entrada.agent_type)) process.exit(0);          // executor principal não é afetado
      if (!["Bash", "PowerShell"].includes(entrada.tool_name)) process.exit(0);
      const linha = entrada.tool_input?.command;
      if (typeof linha !== "string" || !linha.trim()) process.exit(0);
      const r = avaliarAuditor(linha);
      if (!r) process.exit(0);
      // O motivo cita a classificação, nunca a linha: ela pode carregar caminho, token ou segredo.
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `Auditor "${entrada.agent_type}" só executa leitura e gates conhecidos — recusado: ${r.motivo}. Relate o achado; a correção é do executor da fatia.`
        }
      }));
      process.exit(0);
    });
  }
}
