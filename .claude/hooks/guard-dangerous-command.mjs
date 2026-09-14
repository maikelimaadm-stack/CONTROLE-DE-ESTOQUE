#!/usr/bin/env node
/**
 * PROIBIÇÃO DETERMINÍSTICA DE COMANDO (DEVEX-01).
 *
 * Regra em CLAUDE.md é CONTEXTO: o modelo a lê, pondera e pode ser convencido do contrário por um
 * prompt, por um documento ou por pressa. Hook é MECANISMO: roda antes da ferramenta, não negocia e
 * não depende de o modelo ter lido nada. Por isso aqui mora só o que NUNCA pode acontecer neste
 * repositório — merge, marcação de ready, reescrita de histórico e implantação/destruição direta de
 * produção —, e não julgamento arquitetural, que é papel das rules e da revisão.
 *
 * PARSING POR TOKENS, NÃO POR REGEX NA LINHA INTEIRA. `echo "git push --force"` não empurra nada, e
 * um auditor que bloqueia a MENÇÃO do comando treina o operador a contornar o guarda — que é
 * exatamente o oposto do objetivo. O comando é quebrado em segmentos (`;`, `&&`, `||`, `|`, `&`,
 * nova linha, subshell e substituição de comando), cada segmento vira argv, e a decisão olha o
 * PROGRAMA e seus argumentos. Texto dentro de aspas é argumento, não comando.
 *
 * NUNCA IMPRIME O COMANDO. O motivo da recusa cita só o programa e o subcomando reconhecidos: a
 * linha pode conter cabeçalho de autorização, token ou DSN com senha, e mensagem de hook vai para o
 * transcript.
 *
 * Contrato: https://code.claude.com/docs/en/hooks — stdin recebe JSON com `tool_name` e
 * `tool_input.command`; a recusa sai em `hookSpecificOutput.permissionDecision = "deny"` com
 * `hookEventName`, e o processo termina com 0 (a saída é a decisão, não um erro do hook).
 *
 * Autoteste por fixtures, sem executar nada:  node .claude/hooks/guard-dangerous-command.mjs --autoteste
 */

// -------------------------------------------------------------------------------------------------
// 1. TOKENIZAÇÃO
// -------------------------------------------------------------------------------------------------

/**
 * Corpo de here-document é DADO, não comando.
 *
 * `cat > doc.md <<\'EOF\'` seguido de um texto que MENCIONA um comando proibido não executa nada —
 * e foi exatamente assim que este guarda bloqueou a redação da documentação que o descreve. Bloquear a
 * menção ensina o operador a driblar o guarda, que é o oposto do objetivo. O corpo é removido antes da
 * tokenização; o que vier DEPOIS do delimitador continua sendo comando e continua sendo auditado.
 *
 * `<<<` (here-string) fica de fora de propósito: é uma linha só, sem corpo a pular.
 */
export function removerCorpoDeHeredoc(linha) {
  const linhas = linha.split("\n");
  const saida = [];
  const abridor = /(?<!<)<<(?!<)-?\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/g;
  for (let i = 0; i < linhas.length; i++) {
    saida.push(linhas[i]);
    const delimitadores = [];
    let m;
    abridor.lastIndex = 0;
    while ((m = abridor.exec(linhas[i]))) delimitadores.push(m[1] ?? m[2] ?? m[3]);
    for (const d of delimitadores) {
      i++;
      while (i < linhas.length && linhas[i].trim() !== d) i++;
    }
  }
  return saida.join("\n");
}

/** Quebra a linha em segmentos de comando; cada segmento é uma lista de tokens já sem aspas. */
export function segmentar(entrada) {
  const linha = removerCorpoDeHeredoc(entrada);
  const segmentos = [];
  let tokens = [];
  let atual = "";
  let temToken = false;
  let aspas = null; // "'" | '"' | null
  const fecharToken = () => { if (temToken) { tokens.push(atual); atual = ""; temToken = false; } };
  const fecharSegmento = () => { fecharToken(); if (tokens.length) segmentos.push(tokens); tokens = []; };

  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];

    if (aspas) {
      if (c === "\\" && aspas === '"' && i + 1 < linha.length) { atual += linha[++i]; continue; }
      if (c === aspas) { aspas = null; continue; }
      atual += c; temToken = true; continue;
    }
    if (c === "\\") { if (i + 1 < linha.length) { atual += linha[++i]; temToken = true; } continue; }
    if (c === "'" || c === '"') { aspas = c; temToken = true; continue; }

    // comentário: só quando `#` inicia uma palavra (senão é parte de um argumento, ex.: `--tag=a#b`)
    if (c === "#" && !temToken) { while (i < linha.length && linha[i] !== "\n") i++; fecharSegmento(); continue; }

    // substituição de comando: o que está dentro TAMBÉM é comando e é auditado como segmento próprio
    if (c === "$" && linha[i + 1] === "(") { fecharSegmento(); i++; continue; }
    if (c === "`") { fecharSegmento(); continue; }

    if (c === ";" || c === "\n" || c === "&" || c === "|" || c === "(" || c === ")" || c === "{" || c === "}") {
      fecharSegmento();
      if ((c === "&" || c === "|") && linha[i + 1] === c) i++; // && e ||
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") { fecharToken(); continue; }

    // redirecionamento: separa o alvo do comando sem virar token de programa
    if (c === ">" || c === "<") { fecharToken(); continue; }

    atual += c; temToken = true;
  }
  fecharSegmento();
  return segmentos;
}

/** Envoltórios que não são o comando de verdade: o programa real vem depois deles. */
const ENVOLTORIOS = new Set(["sudo", "env", "command", "nohup", "time", "nice", "doas", "exec", "builtin"]);

/** Remove atribuições de ambiente e envoltórios; devolve [programa, ...argumentos]. */
export function programaEArgumentos(tokens) {
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) { i++; continue; }          // FOO=bar git push ...
    if (ENVOLTORIOS.has(t.replace(/^.*\//, ""))) { i++; continue; }     // sudo git push ...
    break;
  }
  if (i >= tokens.length) return null;
  return [tokens[i].replace(/^.*\//, ""), ...tokens.slice(i + 1)];
}

const flagLonga = (args, ...nomes) => args.some((a) => nomes.some((n) => a === `--${n}` || a.startsWith(`--${n}=`)));
/** `-f`, `-fd`, `-fdx`: uma letra pode vir agrupada com outras. Ignora `--longas`. */
const flagCurta = (args, letra) => args.some((a) => /^-[A-Za-z]+$/.test(a) && a.includes(letra));

/**
 * Opções que CONSOMEM o token seguinte. Sem isso, `git -C /repo push --force` teria `/repo` como
 * subcomando e o push forçado passaria batido — o caminho não começa com `-`, então um filtro
 * ingênuo de flags o trata como posicional.
 */
const VALOR_SEGUINTE = new Set([
  "-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix",
  "-R", "--repo", "-m", "--message", "-F", "--file", "-b", "--branch", "--cwd", "-p", "--project"
]);

/** Posicionais na ordem: descarta flags e o valor das que consomem o token seguinte. */
const posicionais = (args) => {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (VALOR_SEGUINTE.has(a)) { i++; continue; }
    if (a.startsWith("-")) continue;
    out.push(a);
  }
  return out;
};
const sub = (args, n) => posicionais(args)[n];

// -------------------------------------------------------------------------------------------------
// 2. O QUE NUNCA PODE ACONTECER
// -------------------------------------------------------------------------------------------------

export const REGRAS = [
  {
    id: "merge-de-pr",
    motivo: "o merge é manual, do responsável pelo repositório — nenhuma sessão automatizada mescla PR",
    casa: (p, a) => p === "gh" && sub(a, 0) === "pr" && ["merge", "ready"].includes(sub(a, 1))
  },
  {
    id: "auto-merge",
    motivo: "habilitar auto-merge é mesclar com atraso; a decisão continua sendo humana",
    casa: (p, a) => p === "gh" && sub(a, 0) === "pr" && flagLonga(a, "auto") && sub(a, 1) !== "view"
  },
  {
    id: "pr-pronta-para-revisao",
    motivo: "marcar a PR como ready é ato do responsável; a PR nasce e permanece DRAFT",
    casa: (p, a) => p === "gh" && sub(a, 0) === "pr" && sub(a, 1) === "edit" && flagLonga(a, "ready")
  },
  {
    id: "push-forcado",
    motivo: "force push reescreve histórico publicado e invalida o checkout de quem já baixou a branch",
    casa: (p, a) => p === "git" && sub(a, 0) === "push" &&
      (flagLonga(a, "force", "force-with-lease", "force-if-includes") || flagCurta(a, "f") ||
       posicionais(a).slice(1).some((r) => r.startsWith("+")))
  },
  {
    id: "reset-destrutivo",
    motivo: "`reset --hard` descarta trabalho não commitado sem possibilidade de recuperação",
    casa: (p, a) => p === "git" && sub(a, 0) === "reset" && flagLonga(a, "hard")
  },
  {
    id: "limpeza-destrutiva",
    motivo: "`git clean -fd` apaga arquivo não rastreado, que por definição não está em nenhum commit",
    casa: (p, a) => p === "git" && sub(a, 0) === "clean" && flagCurta(a, "f") && (flagCurta(a, "d") || flagCurta(a, "x"))
  },
  {
    id: "exclusao-de-branch",
    motivo: "`branch -D` descarta commits não mesclados sem aviso",
    casa: (p, a) => p === "git" && sub(a, 0) === "branch" &&
      (a.includes("-D") || (flagLonga(a, "delete") && (flagLonga(a, "force") || flagCurta(a, "D"))))
  },
  {
    id: "historico-reescrito",
    motivo: "reescrever histórico publicado é proibido neste repositório",
    casa: (p, a) => p === "git" && ["filter-branch", "filter-repo"].includes(sub(a, 0))
  },
  {
    id: "implantacao-de-producao",
    motivo: "produção sobe pelo pipeline, nunca por comando de sessão",
    casa: (p, a) =>
      (p === "vercel" && (flagLonga(a, "prod", "production") || sub(a, 0) === "promote")) ||
      (p === "railway" && ["up", "redeploy", "deploy"].includes(sub(a, 0)))
  },
  {
    id: "schema-remoto-direto",
    motivo: "schema de projeto remoto muda por migration no pipeline; aqui seria alteração fora de registro",
    casa: (p, a) => p === "supabase" && sub(a, 0) === "db" &&
      (["push", "reset", "dump"].includes(sub(a, 1)) && (flagLonga(a, "linked", "db-url", "project-ref") || sub(a, 1) === "push"))
  },
  {
    id: "projeto-remoto-destruido",
    motivo: "apagar ou despausar projeto remoto é ação de infraestrutura, sempre humana",
    casa: (p, a) => (p === "supabase" && ["delete", "destroy"].includes(sub(a, 1))) ||
      (p === "railway" && ["delete", "down"].includes(sub(a, 0)))
  },
  {
    id: "banco-remoto-destruido",
    motivo: "DROP/TRUNCATE por linha de comando contra banco remoto não tem volta nem registro",
    casa: (p, a) => (p === "psql" || p === "pg_dump" || p === "dropdb") &&
      a.some((t) => /\b(drop\s+(database|schema|table)|truncate\s+table)\b/i.test(t)) &&
      a.some((t) => /^(postgres(ql)?:\/\/|--host|-h)/.test(t))
  }
];

// -------------------------------------------------------------------------------------------------
// 3. DECISÃO
// -------------------------------------------------------------------------------------------------

/** @returns {{id:string, motivo:string, comando:string}|null} */
export function avaliar(linha) {
  for (const tokens of segmentar(linha)) {
    const pa = programaEArgumentos(tokens);
    if (!pa) continue;
    const [programa, ...args] = pa;
    for (const r of REGRAS) {
      let bateu = false;
      try { bateu = r.casa(programa, args); } catch { bateu = false; }
      // O comando devolvido é só programa + subcomando: a linha inteira pode carregar segredo.
      if (bateu) return { id: r.id, motivo: r.motivo, comando: [programa, sub(args, 0), sub(args, 1)].filter(Boolean).join(" ") };
    }
  }
  return null;
}

// -------------------------------------------------------------------------------------------------
// 4. AUTOTESTE (fixtures — nenhum comando é executado)
// -------------------------------------------------------------------------------------------------

export const FIXTURES = {
  negar: [
    ["gh pr merge 30", "merge-de-pr"],
    ["gh pr merge --squash --delete-branch 30", "merge-de-pr"],
    ["gh pr ready 30", "merge-de-pr"],
    ["gh pr merge --auto 30", "merge-de-pr"],
    ["gh pr edit 30 --ready", "pr-pronta-para-revisao"],
    ["git push --force origin x", "push-forcado"],
    ["git push -f origin x", "push-forcado"],
    ["git push --force-with-lease", "push-forcado"],
    ["git push origin +main", "push-forcado"],
    ["git -C /repo push --force", "push-forcado"],
    ["git reset --hard HEAD~1", "reset-destrutivo"],
    ["git clean -fd", "limpeza-destrutiva"],
    ["git clean -fdx", "limpeza-destrutiva"],
    ["git branch -D claude/x", "exclusao-de-branch"],
    ["vercel --prod", "implantacao-de-producao"],
    ["vercel deploy --prod", "implantacao-de-producao"],
    ["railway redeploy", "implantacao-de-producao"],
    ["supabase db push", "schema-remoto-direto"],
    ["supabase db reset --linked", "schema-remoto-direto"],
    // o perigo continua perigoso depois de um separador, dentro de substituição ou com envoltório
    ["pnpm lint && git push --force", "push-forcado"],
    ["sudo git reset --hard", "reset-destrutivo"],
    ["CI=1 git push -f", "push-forcado"],
    ["echo a; gh pr merge 30", "merge-de-pr"],
    ["$(gh pr merge 30)", "merge-de-pr"],
    // depois do delimitador o texto volta a ser comando
    ["cat > d.md <<'FIM'\nmenciona gh pr merge\nFIM\ngit push --force", "push-forcado"]
  ],
  permitir: [
    "git status",
    "git diff origin/main...HEAD",
    "git fetch origin",
    "git log --oneline -5",
    "git add -A",
    "git commit -m 'feat: x'",
    "git push -u origin claude/devex-01-claude-code-engineering-harness",
    "git checkout -b claude/nova",
    "git branch -d claude/mesclada",
    "git clean -n",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm test",
    "pnpm e2e",
    "pnpm build",
    "pnpm db:migrate",
    "pnpm db:seed:e2e",
    "pnpm db:reset",
    "pnpm parity:check",
    "node scripts/claude-harness-audit.mjs",
    "vercel ls",
    "vercel logs",
    "railway logs",
    "supabase migration list",
    "cat apps/api/src/index.ts",
    "tail -n 100 /tmp/servidor.log",
    // menção não é execução: o guarda não pode bloquear texto
    "echo 'git push --force'",
    'echo "gh pr merge 30"',
    "grep -rn 'git push --force' docs/",
    // corpo de here-document é documentação, não execução
    "cat > doc.md <<'FIM'\no hook recusa gh pr merge e git push --force\nFIM",
    "cat > doc.md <<\"FIM\"\nvercel --prod nunca roda aqui\nFIM",
    "python3 - <<PY\nprint('git reset --hard')\nPY",
    "git commit -m 'explica por que git push --force é proibido'",
    "# gh pr merge 30"
  ]
};

function autoteste() {
  const falhas = [];
  for (const [linha, esperado] of FIXTURES.negar) {
    const r = avaliar(linha);
    if (!r) falhas.push(`DEVERIA NEGAR e permitiu: ${linha}`);
    else if (r.id !== esperado) falhas.push(`negou por "${r.id}", esperado "${esperado}": ${linha}`);
  }
  for (const linha of FIXTURES.permitir) {
    const r = avaliar(linha);
    if (r) falhas.push(`DEVERIA PERMITIR e negou por "${r.id}": ${linha}`);
  }
  if (falhas.length) {
    console.error("guard-dangerous-command: AUTOTESTE FALHOU");
    for (const f of falhas) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`guard-dangerous-command: autoteste OK (${FIXTURES.negar.length} negados, ${FIXTURES.permitir.length} permitidos, ${REGRAS.length} regras)`);
}

// -------------------------------------------------------------------------------------------------
// 5. ENTRADA
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
      if (!["Bash", "PowerShell"].includes(entrada.tool_name)) process.exit(0);
      const linha = entrada.tool_input?.command;
      if (typeof linha !== "string" || !linha.trim()) process.exit(0);
      const r = avaliar(linha);
      if (!r) process.exit(0); // sem decisão: o fluxo normal de permissão continua
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `Bloqueado pelo harness do repositório (${r.id}): \`${r.comando}\` — ${r.motivo}. Ver CLAUDE.md e .claude/rules/workflow.md.`
        }
      }));
      process.exit(0);
    });
  }
}
