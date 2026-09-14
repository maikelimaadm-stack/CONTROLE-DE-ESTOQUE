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
  segmentar, programaEArgumentos, posicionais, valorDeOpcao, redirecionamentoDeEscrita
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

/** Programas que só leem, com qualquer argumento. Escrita por redirecionamento é barrada à parte. */
const LEITURA_PURA = new Set([
  "cat", "head", "tail", "wc", "grep", "rg", "egrep", "fgrep", "sort", "uniq", "cut", "tr", "nl",
  "comm", "diff", "file", "stat", "du", "df", "tree", "jq", "yq", "basename", "dirname", "realpath",
  "readlink", "ls", "pwd", "echo", "printf", "true", "false", "cd", "which", "type", "column",
  "strings", "od", "date", "env", "seq", "test"
]);

/** Subcomandos de leitura do git. Fora desta lista, o git do auditor não roda. */
const GIT_LEITURA = new Set([
  "status", "diff", "show", "log", "grep", "ls-files", "ls-tree", "cat-file", "rev-parse",
  "rev-list", "describe", "blame", "shortlog", "diff-tree", "name-rev", "merge-base",
  "symbolic-ref", "count-objects", "check-ignore", "whatchanged", "fetch", "branch", "remote",
  "tag", "stash", "worktree", "config"
]);

/** Scripts de gate do repositório. `audit:*` é conferido contra o package.json pelo gate do harness. */
export const SCRIPTS_DE_GATE = new Set([
  "lint", "typecheck", "test", "test:integration", "e2e", "build", "parity", "parity:check",
  "audit:naming", "audit:member-farms", "audit:notifications", "audit:responsavel",
  "audit:empresa", "audit:farm", "audit:dictionary", "audit:id-global", "audit:claude-harness"
]);

const flagPresente = (args, ...nomes) =>
  args.some((a) => nomes.some((n) => a === n || a.startsWith(`${n}=`)));

/** @returns {string|null} motivo da recusa, ou null quando o comando é aceitável para um auditor. */
function julgarSegmento(programa, args) {
  if (LEITURA_PURA.has(programa)) {
    // `find -delete` e `find -exec` executam e apagam; `sed -i` reescreve o arquivo no lugar.
    return null;
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
    const sub = posicionais(args)[0];
    if (!sub || !GIT_LEITURA.has(sub)) return `git ${sub ?? ""}`.trim() + " não é subcomando de leitura";
    if (sub === "fetch" && flagPresente(args, "--prune", "-p")) return "`git fetch --prune` apaga referências locais";
    if (sub === "branch" && args.some((a) => /^-[dDmMcC]$/.test(a) || ["--delete", "--move", "--copy", "--force"].includes(a)))
      return "`git branch` alterando referência";
    if (sub === "tag" && args.some((a) => /^-[adfs]$/.test(a) || ["--delete", "--force"].includes(a)))
      return "`git tag` alterando referência";
    if (sub === "remote" && posicionais(args)[1] && !["show", "get-url", "-v"].includes(posicionais(args)[1]))
      return "`git remote` alterando configuração";
    if (sub === "stash" && posicionais(args)[1] !== "list") return "`git stash` mexe na árvore de trabalho";
    if (sub === "worktree" && posicionais(args)[1] !== "list") return "`git worktree` cria ou remove árvore";
    if (sub === "config" && !flagPresente(args, "--get", "--get-all", "--list", "-l")) return "`git config` gravando";
    return null;
  }
  if (["pnpm", "npm", "yarn"].includes(programa)) {
    const pos = posicionais(args).filter((t) => t !== "run" && t !== "exec");
    const script = pos.find((t) => !t.startsWith("@") && !t.includes("/"));
    if (!script) return "comando de pacote sem script reconhecido";
    if (!SCRIPTS_DE_GATE.has(script)) return `script "${script}" não é gate conhecido`;
    // `--filter` só escolhe o pacote; o script já foi validado acima.
    if (valorDeOpcao(args, "--dir", "--prefix", "--cwd", "-C") !== undefined) return "gate apontado para outro diretório";
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
    const motivo = julgarSegmento(programa, args);
    if (motivo) return { motivo };
  }
  return null;
}

// -------------------------------------------------------------------------------------------------
// 3. AUTOTESTE (fixtures — nenhum comando é executado)
// -------------------------------------------------------------------------------------------------

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
    "curl https://exemplo.com"
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
