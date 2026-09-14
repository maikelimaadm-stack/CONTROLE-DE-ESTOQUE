#!/usr/bin/env node
/**
 * PROIBIÇÃO DETERMINÍSTICA DE COMANDO (DEVEX-01).
 *
 * Regra em CLAUDE.md é CONTEXTO: o modelo a lê, pondera e pode ser convencido do contrário por um
 * prompt, por um documento ou por pressa. Hook é MECANISMO: roda antes da ferramenta, não negocia e
 * não depende de o modelo ter lido nada. Por isso aqui mora só o que NUNCA pode acontecer neste
 * repositório — escrever em `main`, mesclar, marcar PR como pronta, reescrever histórico, apagar ref
 * remota, mutar o GitHub pela API, mutar banco direto e implantar/destruir produção —, e não
 * julgamento arquitetural, que é papel das rules e da revisão.
 *
 * PARSING POR TOKENS, NÃO POR REGEX NA LINHA INTEIRA. `echo "git push --force"` não empurra nada, e
 * um auditor que bloqueia a MENÇÃO do comando treina o operador a contornar o guarda — que é
 * exatamente o oposto do objetivo. O comando é quebrado em segmentos (`;`, `&&`, `||`, `|`, `&`,
 * nova linha, subshell e substituição de comando), cada segmento vira argv, e a decisão olha o
 * PROGRAMA e seus argumentos. Texto dentro de aspas é argumento, não comando.
 *
 * SHELL ANINHADO É REAVALIADO. `bash -c '<payload>'` executa o payload: ele volta para a mesma
 * análise, com profundidade limitada. Sem isso, todo o resto deste arquivo seria contornável com
 * cinco caracteres.
 *
 * NUNCA IMPRIME O COMANDO, O PAYLOAD OU A LINHA. O motivo da recusa cita só o programa e o
 * subcomando reconhecidos: a linha pode conter cabeçalho de autorização, token ou DSN com senha, e
 * mensagem de hook vai para o transcript.
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
 * `cat > doc.md <<'EOF'` seguido de um texto que MENCIONA um comando proibido não executa nada — e
 * foi exatamente assim que este guarda bloqueou a redação da documentação que o descreve. Bloquear a
 * menção ensina o operador a driblar o guarda, que é o oposto do objetivo. O corpo é removido antes
 * da tokenização; o que vier DEPOIS do delimitador continua sendo comando e continua sendo auditado.
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

/**
 * Duplicação de descritor (`2>&1`, `>&2`, `2>&-`) não é comando nem escrita de arquivo: é o jeito
 * normal de juntar stderr à saída de um gate. Sem removê-la antes de tokenizar, o `&` viraria
 * separador de segmento e o `1` viraria um "programa" — inofensivo no guarda de comandos perigosos,
 * que só casa programas conhecidos, mas fatal no guarda de auditor, que é fail closed.
 */
export function removerDuplicacaoDeDescritor(entrada) {
  let saida = "";
  let aspas = null;
  for (let i = 0; i < entrada.length; i++) {
    const c = entrada[i];
    if (aspas) { saida += c; if (c === "\\" && aspas === '"' && i + 1 < entrada.length) saida += entrada[++i]; else if (c === aspas) aspas = null; continue; }
    if (c === "\\") { saida += c; if (i + 1 < entrada.length) saida += entrada[++i]; continue; }
    if (c === "'" || c === '"') { aspas = c; saida += c; continue; }
    const m = /^(\d*)>&(\d+|-)/.exec(entrada.slice(i));
    if (m) { saida = saida.replace(/\d+$/, ""); i += m[0].length - 1; continue; }
    saida += c;
  }
  return saida;
}

/** Quebra a linha em segmentos de comando; cada segmento é uma lista de tokens já sem aspas. */
export function segmentar(entrada) {
  const linha = removerDuplicacaoDeDescritor(removerCorpoDeHeredoc(entrada));
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

/**
 * Esqueleto SEM ASPAS de cada comando lógico.
 *
 * A tokenização normal quebra em `$(` e `{` para poder auditar substituição de comando — e é isso
 * que faz `git push origin $(git rev-parse HEAD):main` perder o refspec pelo caminho: sobra
 * `git push origin`, que parece inofensivo. Aqui o texto é lido cru, ignorando o que está entre
 * aspas, só para responder "este comando lógico constrói o destino em tempo de execução?".
 */
export function comandosLogicosSemAspas(entrada) {
  const linha = removerCorpoDeHeredoc(entrada);
  const saida = [];
  let atual = "";
  let aspas = null;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (aspas) { if (c === "\\" && aspas === '"') i++; else if (c === aspas) aspas = null; continue; }
    if (c === "\\") { i++; continue; }
    if (c === "'" || c === '"') { aspas = c; continue; }
    if (c === ";" || c === "\n" || c === "|" || c === "&") {
      if ((c === "&" || c === "|") && linha[i + 1] === c) i++;
      saida.push(atual); atual = ""; continue;
    }
    atual += c;
  }
  saida.push(atual);
  return saida.filter((x) => x.trim());
}

/**
 * Redirecionamento que ESCREVE arquivo, fora de aspas. Duplicação de descritor (`2>&1`) não escreve
 * nada e continua liberada: é o jeito normal de juntar stderr à saída de um gate.
 */
export function redirecionamentoDeEscrita(entrada) {
  const linha = removerCorpoDeHeredoc(entrada);
  let aspas = null;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (aspas) { if (c === "\\" && aspas === '"') i++; else if (c === aspas) aspas = null; continue; }
    if (c === "\\") { i++; continue; }
    if (c === "'" || c === '"') { aspas = c; continue; }
    if (c !== ">") continue;
    let j = i + 1;
    if (linha[j] === ">") j++;                       // >>
    while (linha[j] === " ") j++;
    if (linha[j] === "&" && /\d|-/.test(linha[j + 1] ?? "")) { i = j + 1; continue; }  // 2>&1, >&-
    return true;
  }
  return false;
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
  "-R", "--repo", "-m", "--message", "-F", "--file", "-b", "--branch", "--cwd", "-p", "--project",
  "-X", "--method", "--filter", "--hostname", "--jq", "-q", "--template", "-t",
  "--dir", "--prefix", "-w", "--workspace"
]);

/** Posicionais na ordem: descarta flags e o valor das que consomem o token seguinte. */
export const posicionais = (args) => {
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

/** Valor de uma opção, na forma `--opcao valor` ou `--opcao=valor`. */
export const valorDeOpcao = (args, ...nomes) => {
  for (let i = 0; i < args.length; i++) {
    for (const n of nomes) {
      if (args[i] === n) return args[i + 1];
      if (args[i].startsWith(`${n}=`)) return args[i].slice(n.length + 1);
    }
  }
  return undefined;
};

// -------------------------------------------------------------------------------------------------
// 2. REFSPEC DE PUSH
// -------------------------------------------------------------------------------------------------

/**
 * `git push [<remoto>] [<refspec>...]`. Os refspecs são os posicionais depois de `push` e do remoto.
 * Sem destino explícito (`git push` puro) não há o que julgar: resolver o upstream exigiria ler a
 * configuração do repositório, e um guarda que depende de estado externo decide diferente em
 * máquinas diferentes.
 */
const refspecsDePush = (args) => posicionais(args).slice(2);

/**
 * Destino de um refspec: o lado DEPOIS dos dois-pontos, ou o próprio nome quando não há `:`.
 * `+` (force) é removido aqui porque o force tem regra própria; o que importa nesta função é o ALVO.
 */
export const destinoDeRefspec = (refspec) => {
  const semForce = refspec.replace(/^\+/, "");
  const i = semForce.indexOf(":");
  const destino = i < 0 ? semForce : semForce.slice(i + 1);
  return destino.replace(/^refs\/heads\//, "");
};

/** Refspec que APAGA a ref remota: origem vazia (`:branch`). */
const refspecApaga = (refspec) => /^\+?:/.test(refspec);

const BRANCHES_PROTEGIDAS = new Set(["main", "master"]);

// -------------------------------------------------------------------------------------------------
// 3. O QUE NUNCA PODE ACONTECER
// -------------------------------------------------------------------------------------------------

const METODOS_MUTANTES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const FLAGS_DE_CORPO = ["-f", "--raw-field", "-F", "--field", "--input"];
/**
 * Scripts que mutam banco pela conexão herdada do ambiente.
 *
 * `migrate`/`seed`/`reset` puros entram aqui porque `packages/db` os declara com esses nomes: a
 * partir de qualquer diretório, `pnpm reset` é o reset do banco. Julgar pelo diretório de trabalho
 * seria julgar por um estado que o guarda não controla — `-C`, `--dir`, `--cwd` e `--prefix` mudam
 * o alvo sem mudar o texto do script.
 */
const SCRIPTS_DB_DIRETO = new Set(["db:migrate", "db:seed", "db:reset", "migrate", "seed", "reset"]);
const SUBCOMANDOS_DB_DIRETO = new Set(["migrate", "seed", "reset"]);
/** O cli de banco, seja qual for o lançador (pnpm, npx, node, tsx ou caminho direto). */
const CLI_DE_BANCO = /(^|\/)db\/(src|dist)\/cli\.(ts|js|mjs)$/;
/** O comando operacional de ID Global: escreve em erp.registros_globais por conexão operacional. */
const CLI_DE_BACKFILL = /(^|\/)id-global-backfill\.(ts|js|mjs)$/;
const SCRIPT_DE_BACKFILL = "id-global:backfill";
/**
 * As DUAS grafias que o próprio cli reconhece como não-escrita (`argv.includes`). Escrever o guarda
 * com a mesma comparação exata é o que o mantém alinhado: uma variante errada (`--dryrun`) não casa
 * aqui E não casaria lá — a diferença é que aqui ela recusa, enquanto lá ela executaria o backfill
 * inteiro achando que era um ensaio.
 */
const LEITURA_DO_BACKFILL = ["--verify-only", "--dry-run"];

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
    id: "push-para-main",
    motivo: "toda mudança entra em main por PR com merge humano; escrever direto na branch pula revisão e CI",
    casa: (p, a) => p === "git" && sub(a, 0) === "push" &&
      refspecsDePush(a).some((r) => !refspecApaga(r) && BRANCHES_PROTEGIDAS.has(destinoDeRefspec(r)))
  },
  {
    id: "exclusao-de-ref-remota",
    motivo: "apagar branch no remoto é configuração do repositório, e isso é ação humana",
    casa: (p, a) => p === "git" && sub(a, 0) === "push" &&
      (flagLonga(a, "delete") || flagCurta(a, "d") || refspecsDePush(a).some(refspecApaga))
  },
  {
    id: "push-em-lote",
    motivo: "`--all`, `--mirror` e `--prune` mexem em várias refs de uma vez, inclusive na branch protegida",
    casa: (p, a) => p === "git" && sub(a, 0) === "push" && flagLonga(a, "all", "mirror", "prune", "tags")
  },
  {
    id: "push-com-refspec-dinamico",
    motivo: "o destino do push só se resolve em tempo de execução, então não há refspec para auditar antes",
    casa: (p, a, linha) => p === "git" && sub(a, 0) === "push" &&
      comandosLogicosSemAspas(linha ?? "").some((c) => /\bgit\b/.test(c) && /\bpush\b/.test(c) && /\$\(|\$\{|`/.test(c))
  },
  {
    id: "push-forcado",
    motivo: "force push reescreve histórico publicado e invalida o checkout de quem já baixou a branch",
    casa: (p, a) => p === "git" && sub(a, 0) === "push" &&
      (flagLonga(a, "force", "force-with-lease", "force-if-includes") || flagCurta(a, "f") ||
       refspecsDePush(a).some((r) => r.startsWith("+")))
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
    id: "mutacao-pela-api-do-github",
    motivo: "mutar pelo GitHub por API contorna as recusas especializadas (merge, ready, configuração)",
    casa: (p, a) => {
      if (p !== "gh" || sub(a, 0) !== "api") return false;
      if (sub(a, 1) === "graphql") return true;                       // GraphQL não distingue leitura de mutação na forma
      const metodo = (valorDeOpcao(a, "-X", "--method") ?? "").toUpperCase();
      if (METODOS_MUTANTES.has(metodo)) return true;
      const temCorpo = a.some((t) => FLAGS_DE_CORPO.includes(t) || /^(--raw-field|--field|--input)=/.test(t));
      return temCorpo && metodo !== "GET";                            // corpo sem GET inequívoco = mutação
    }
  },
  {
    id: "configuracao-do-repositorio",
    motivo: "configuração do repositório (branch padrão, visibilidade, exclusão) é ação humana",
    casa: (p, a) => p === "gh" && sub(a, 0) === "repo" && ["edit", "delete", "archive", "rename"].includes(sub(a, 1))
  },
  {
    id: "mutacao-direta-de-banco",
    motivo: "migration, seed e reset mudam o banco da conexão herdada do ambiente; produção muda por pipeline",
    casa: (p, a) => {
      const pos = posicionais(a);
      // a) script de gerenciador de pacote, em qualquer diretório e com qualquer forma de apontá-lo
      if (["pnpm", "npm", "yarn", "npx"].includes(p) && pos.some((t) => SCRIPTS_DB_DIRETO.has(t))) return true;
      // b) cli do pacote de banco chamado direto — o lançador é irrelevante
      const cli = pos.findIndex((t) => CLI_DE_BANCO.test(t));
      return cli >= 0 && pos.slice(cli + 1).some((t) => SUBCOMANDOS_DB_DIRETO.has(t));
    }
  },
  {
    id: "backfill-operacional",
    motivo: "o backfill escreve o índice de ID Global por conexão operacional, sem RLS, em todas as organizações",
    casa: (p, a) => {
      const pos = posicionais(a);
      const alvo = pos.some((t) => t === SCRIPT_DE_BACKFILL) || pos.some((t) => CLI_DE_BACKFILL.test(t));
      if (!alvo) return false;
      return !a.some((t) => LEITURA_DO_BACKFILL.includes(t));         // só as grafias que o cli reconhece
    }
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
// 4. SHELL ANINHADO
// -------------------------------------------------------------------------------------------------

/** Programa → como ele recebe o payload que VAI EXECUTAR. */
const WRAPPERS = new Map([
  ["bash", "posix"], ["sh", "posix"], ["zsh", "posix"], ["dash", "posix"], ["ksh", "posix"],
  ["pwsh", "powershell"], ["pwsh.exe", "powershell"],
  ["powershell", "powershell"], ["powershell.exe", "powershell"],
  ["cmd", "cmd"], ["cmd.exe", "cmd"]
]);
export const PROFUNDIDADE_MAXIMA = 3;

/** Payload que o wrapper executa, ou undefined quando não há. */
const payloadDoWrapper = (estilo, args) => {
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    const casa = estilo === "posix" ? /^-[A-Za-z]*c$/.test(t)          // -c, -lc, -ic
      : estilo === "powershell" ? /^-c/i.test(t)                        // -c, -Command, -command
      : /^\/[ckCK]$/.test(t);                                           // cmd /c, /k
    if (casa) return args.slice(i + 1).join(" ");
  }
  return undefined;
};

/** Payload que não dá para analisar porque só se resolve em tempo de execução. */
const indeterminado = (payload) => /^\s*[`$]/.test(payload) || /^\s*\$\{/.test(payload);

// -------------------------------------------------------------------------------------------------
// 5. DECISÃO
// -------------------------------------------------------------------------------------------------

/** @returns {{id:string, motivo:string, comando:string}|null} */
export function avaliar(linha, profundidade = 0) {
  for (const tokens of segmentar(linha)) {
    const pa = programaEArgumentos(tokens);
    if (!pa) continue;
    const [programa, ...args] = pa;

    for (const r of REGRAS) {
      let bateu = false;
      try { bateu = r.casa(programa, args, linha); } catch { bateu = false; }
      // O comando devolvido é só programa + subcomando: a linha inteira pode carregar segredo.
      if (bateu) return { id: r.id, motivo: r.motivo, comando: [programa, sub(args, 0), sub(args, 1)].filter(Boolean).join(" ") };
    }

    // `bash -c '<payload>'` executa o payload: ele é comando e volta para a mesma análise.
    const estilo = WRAPPERS.get(programa);
    if (!estilo) continue;
    const payload = payloadDoWrapper(estilo, args);
    if (payload === undefined || !payload.trim()) continue;           // wrapper sem payload não executa nada
    if (profundidade + 1 > PROFUNDIDADE_MAXIMA) {
      return { id: "shell-aninhado-profundo", comando: programa,
        motivo: `shell aninhado além de ${PROFUNDIDADE_MAXIMA} níveis não é analisável com segurança` };
    }
    if (indeterminado(payload)) {
      return { id: "payload-indeterminado", comando: programa,
        motivo: "o comando a executar só se resolve em tempo de execução, então não há o que auditar antes" };
    }
    const interno = avaliar(payload, profundidade + 1);
    if (interno) return interno;
  }
  return null;
}

// -------------------------------------------------------------------------------------------------
// 6. AUTOTESTE (fixtures — nenhum comando é executado)
// -------------------------------------------------------------------------------------------------

export const FIXTURES = {
  negar: [
    ["gh pr merge 30", "merge-de-pr"],
    ["gh pr merge --squash --delete-branch 30", "merge-de-pr"],
    ["gh pr ready 30", "merge-de-pr"],
    ["gh pr merge --auto 30", "merge-de-pr"],
    ["gh pr edit 30 --ready", "pr-pronta-para-revisao"],
    // escrever direto na branch protegida, em qualquer grafia de refspec
    ["git push origin HEAD:main", "push-para-main"],
    ["git push origin HEAD:refs/heads/main", "push-para-main"],
    ["git push origin main", "push-para-main"],
    ["git -C . push origin HEAD:main", "push-para-main"],
    ["env FOO=bar git push origin HEAD:main", "push-para-main"],
    ["git push origin claude/x:main", "push-para-main"],
    ["git push origin HEAD:master", "push-para-main"],
    // apagar ref remota
    ["git push origin --delete alguma-branch", "exclusao-de-ref-remota"],
    ["git push origin -d alguma-branch", "exclusao-de-ref-remota"],
    ["git push origin :alguma-branch", "exclusao-de-ref-remota"],
    ["git push origin :refs/heads/alguma-branch", "exclusao-de-ref-remota"],
    ["git push --force origin x", "push-forcado"],
    ["git push -f origin x", "push-forcado"],
    ["git push --force-with-lease", "push-forcado"],
    ["git push origin +claude/x", "push-forcado"],
    ["git -C /repo push --force", "push-forcado"],
    ["git reset --hard HEAD~1", "reset-destrutivo"],
    ["git clean -fd", "limpeza-destrutiva"],
    ["git clean -fdx", "limpeza-destrutiva"],
    ["git branch -D claude/x", "exclusao-de-branch"],
    // mutação pela API do GitHub
    ["gh api -X PUT repos/o/r/pulls/31/merge", "mutacao-pela-api-do-github"],
    ["gh api --method PATCH repos/o/r", "mutacao-pela-api-do-github"],
    ["gh api --method=DELETE repos/o/r/git/refs/heads/x", "mutacao-pela-api-do-github"],
    ["gh api graphql -f query='mutation { qualquerCoisa }'", "mutacao-pela-api-do-github"],
    ["gh api repos/o/r/pulls/31/merge -f merge_method=squash", "mutacao-pela-api-do-github"],
    ["gh repo edit --default-branch develop", "configuracao-do-repositorio"],
    ["gh repo delete o/r", "configuracao-do-repositorio"],
    // mutação direta de banco
    ["pnpm db:migrate", "mutacao-direta-de-banco"],
    ["pnpm db:seed", "mutacao-direta-de-banco"],
    ["pnpm db:reset", "mutacao-direta-de-banco"],
    ["ALLOW_DB_RESET=1 pnpm db:reset", "mutacao-direta-de-banco"],
    ["pnpm run db:migrate", "mutacao-direta-de-banco"],
    ["pnpm --filter @agro/db migrate", "mutacao-direta-de-banco"],
    ["pnpm --filter @agro/db seed", "mutacao-direta-de-banco"],
    ["pnpm --filter @agro/db reset", "mutacao-direta-de-banco"],
    ["pnpm --filter @agro/db exec tsx src/cli.ts migrate", "mutacao-direta-de-banco"],
    ["npx tsx packages/db/src/cli.ts seed", "mutacao-direta-de-banco"],
    // diretório de trabalho não é proteção: o script do pacote de banco se chama migrate/seed/reset
    ["cd packages/db && pnpm reset", "mutacao-direta-de-banco"],
    ["cd packages/db && pnpm migrate", "mutacao-direta-de-banco"],
    ["pnpm -C packages/db reset", "mutacao-direta-de-banco"],
    ["yarn --cwd packages/db seed", "mutacao-direta-de-banco"],
    ["npm --prefix packages/db run migrate", "mutacao-direta-de-banco"],
    ["tsx packages/db/src/cli.ts reset", "mutacao-direta-de-banco"],
    ["node packages/db/dist/cli.js migrate", "mutacao-direta-de-banco"],
    // comando operacional de ID Global: escreve sem RLS, em todas as organizações
    ["pnpm id-global:backfill", "backfill-operacional"],
    ["pnpm --filter @agro/api id-global:backfill", "backfill-operacional"],
    ["node apps/api/dist/cli/id-global-backfill.js", "backfill-operacional"],
    ["tsx apps/api/src/cli/id-global-backfill.ts --batch-size 500", "backfill-operacional"],
    ["node dist/cli/id-global-backfill.js --dryrun", "backfill-operacional"],
    // push em lote mexe em várias refs sem citar nenhuma
    ["git push origin --all", "push-em-lote"],
    ["git push --all origin", "push-em-lote"],
    ["git push --mirror origin", "push-em-lote"],
    ["git push origin --mirror", "push-em-lote"],
    ["git push --prune origin", "push-em-lote"],
    ["git push origin --prune", "push-em-lote"],
    // destino construído em tempo de execução: não há refspec para auditar
    ["git push origin $(git rev-parse HEAD):main", "push-com-refspec-dinamico"],
    ["git push origin ${REF}:main", "push-com-refspec-dinamico"],
    ["git push origin `echo main`", "push-com-refspec-dinamico"],
    ["vercel --prod", "implantacao-de-producao"],
    ["vercel deploy --prod", "implantacao-de-producao"],
    ["railway redeploy", "implantacao-de-producao"],
    ["supabase db push", "schema-remoto-direto"],
    ["supabase db reset --linked", "schema-remoto-direto"],
    // shell aninhado executa de verdade: o payload volta para a mesma análise
    ["bash -c 'gh pr merge 31'", "merge-de-pr"],
    ["sh -c 'git push origin HEAD:main'", "push-para-main"],
    ["zsh -c 'git push --force origin x'", "push-forcado"],
    ["pwsh -Command 'gh pr ready 31'", "merge-de-pr"],
    ["powershell -Command 'git push origin HEAD:main'", "push-para-main"],
    ["bash -lc 'pnpm db:reset'", "mutacao-direta-de-banco"],
    ["bash -c \"sh -c 'gh pr merge 31'\"", "merge-de-pr"],
    ["bash -c '$CMD'", "payload-indeterminado"],
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
    "git push",
    "git push -u origin claude/devex-01-claude-code-engineering-harness",
    "git push origin claude/minha-fatia",
    "git push origin HEAD:claude/minha-fatia",
    "git checkout -b claude/nova",
    "git branch -d claude/mesclada",
    "git clean -n",
    "gh pr view 31",
    "gh pr list",
    "gh run view 123",
    "gh api --method GET repos/o/r/pulls/31",
    "gh api -X GET repos/o/r/actions/runs/123",
    "gh api repos/o/r/pulls/31",
    "gh repo view o/r",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm test",
    "pnpm test:integration",
    "pnpm e2e",
    "pnpm build",
    "pnpm parity:check",
    "pnpm db:seed:e2e",
    "pnpm id-global:verify",
    "node apps/api/dist/cli/id-global-backfill.js --verify-only",
    "tsx apps/api/src/cli/id-global-backfill.ts --dry-run",
    "pnpm --filter @agro/db test:integration",
    "pnpm --filter @agro/api test:integration",
    "pnpm --filter @agro/web e2e",
    "node scripts/claude-harness-audit.mjs",
    "vercel ls",
    "vercel logs",
    "railway logs",
    "supabase migration list",
    "cat apps/api/src/index.ts",
    "tail -n 100 /tmp/servidor.log",
    "bash -c 'git status'",
    "sh -c 'pnpm lint'",
    "bash -c 'pnpm test:integration'",
    // menção não é execução: o guarda não pode bloquear texto
    "echo 'git push --force'",
    'echo "gh pr merge 30"',
    "echo \"gh api -X PUT repos/o/r/pulls/31/merge\"",
    "echo \"bash -c 'gh pr merge 31'\"",
    "grep -rn 'git push --force' docs/",
    "git commit -m 'explica por que git push --force é proibido'",
    "# gh pr merge 30",
    // corpo de here-document é documentação, não execução
    "cat > doc.md <<'FIM'\no hook recusa gh pr merge e git push origin HEAD:main\nFIM",
    "cat > doc.md <<\"FIM\"\nvercel --prod nunca roda aqui\nFIM",
    "python3 - <<PY\nprint('git reset --hard')\nPY"
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
  console.log(`guard-dangerous-command: autoteste OK (${FIXTURES.negar.length} negados, ${FIXTURES.permitir.length} permitidos, ${REGRAS.length} regras, shell aninhado até ${PROFUNDIDADE_MAXIMA} níveis)`);
}

// -------------------------------------------------------------------------------------------------
// 7. ENTRADA
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
