#!/usr/bin/env node
/**
 * O HARNESS DE ENGENHARIA PRECISA CONTINUAR EXISTINDO E CONTINUAR VÁLIDO (DEVEX-01).
 *
 * Configuração de IA falha do pior jeito possível: em SILÊNCIO. Campo escrito errado é ignorado,
 * arquivo renomeado deixa de ser carregado, frontmatter com um espaço a mais vira texto solto — e
 * nada disso quebra build, teste ou tipo. A sessão seguinte simplesmente passa a trabalhar sem a
 * regra, e ninguém descobre até um erro que a regra existia para impedir.
 *
 * Este auditor transforma esse silêncio em falha de CI. Ele não reimplementa o Claude Code: procura
 * DERIVA ÓBVIA — arquivo esperado que sumiu, JSON que não parseia, frontmatter ausente, auditor que
 * perdeu a proteção contra escrita, segredo literal, referência a documento inexistente.
 *
 *   node scripts/claude-harness-audit.mjs      (gate; roda dentro de `pnpm lint`)
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const RAIZ = path.resolve(new URL("..", import.meta.url).pathname);
const problemas = [];
const erro = (m) => problemas.push(m);
const CONTAGEM_E2E = { total: 0, semBanco: 0 };
const caminho = (p) => path.join(RAIZ, p);
const existe = (p) => existsSync(caminho(p));
const ler = (p) => readFileSync(caminho(p), "utf8");

// -------------------------------------------------------------------------------------------------
// DECLARAÇÃO DO QUE O HARNESS TEM DE TER
// Acrescentou peça nova? Declare aqui. É esta lista que faz a remoção silenciosa reprovar.
// -------------------------------------------------------------------------------------------------
const RAIZ_ESPERADA = ["CLAUDE.md", "REVIEW.md", ".claude/settings.json", ".mcp.json.example"];
const REGRAS = ["workflow", "architecture", "security", "backend-api", "frontend-web", "database-migrations", "testing-gates"];
const SKILLS = ["implement-slice", "certify-pr", "migration-safety", "production-smoke", "multi-company-contract", "id-global-contract", "pre-base2-checkpoint"];
const AGENTES = ["security-rls-auditor", "migration-auditor", "test-gate-verifier", "frontend-regression-reviewer", "performance-reviewer", "pr-certifier"];
const HOOKS = ["guard-dangerous-command.mjs", "guard-auditor-command.mjs"];
const DOCS = ["docs/CLAUDE-CODE-ENGINEERING-HARNESS.md", "docs/CLAUDE-CODE-CONNECTORS.md"];
/** Skills que só o usuário pode disparar (tocar produção não pode ser decisão do modelo). */
const SKILLS_SEM_INVOCACAO_AUTOMATICA = ["production-smoke"];
/** Ferramentas que tiram de um auditor a condição de auditor. */
const FERRAMENTAS_DE_ESCRITA = ["Write", "Edit", "NotebookEdit"];

// -------------------------------------------------------------------------------------------------
// 1. ARQUIVOS DE RAIZ
// -------------------------------------------------------------------------------------------------
for (const f of RAIZ_ESPERADA) if (!existe(f)) erro(`falta ${f}`);

if (existe("CLAUDE.md")) {
  const linhas = ler("CLAUDE.md").split("\n").length;
  // Não é estética: a documentação oficial recomenda manter o arquivo curto, e um CLAUDE.md que
  // vira manual deixa de ser lido com atenção — as leis se perdem no meio da prosa.
  if (linhas > 220) erro(`CLAUDE.md tem ${linhas} linhas: leis permanentes cabem em ~200; o resto é rule ou skill`);
  if (linhas < 20) erro(`CLAUDE.md tem só ${linhas} linhas — parece esvaziado`);
}

// -------------------------------------------------------------------------------------------------
// 2. SETTINGS: JSON VÁLIDO E CHAVES CRÍTICAS
// -------------------------------------------------------------------------------------------------
let settings = null;
if (existe(".claude/settings.json")) {
  try { settings = JSON.parse(ler(".claude/settings.json")); }
  catch (e) { erro(`.claude/settings.json não é JSON válido: ${e.message}`); }
}
if (settings) {
  const negadas = settings.permissions?.deny ?? [];
  if (!Array.isArray(negadas) || !negadas.length) erro(".claude/settings.json: permissions.deny sumiu — os segredos ficariam legíveis");
  for (const alvo of ["**/.env", "secrets/**"]) {
    if (!negadas.includes(`Read(${alvo})`)) erro(`.claude/settings.json: falta a negação Read(${alvo})`);
  }
  // `.env.example` é público por contrato e documenta as variáveis: negá-lo quebraria o onboarding.
  const casa = (padrao, alvo) => new RegExp("^" + padrao.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "(?:.*/)?").replace(/\*/g, "[^/]*") + "$").test(alvo);
  for (const r of negadas) {
    const p = /^Read\((.*)\)$/.exec(r)?.[1];
    if (p && casa(p, ".env.example")) erro(`.claude/settings.json: a regra ${r} bloqueia .env.example, que é público por contrato`);
  }
  // Toda variante real de .env presente na árvore tem de estar coberta. Sem isso, um `.env.novo`
  // criado amanhã ficaria legível e a negação daria falsa sensação de proteção.
  for (const nome of readdirSync(RAIZ).filter((n) => n.startsWith(".env") && n !== ".env.example")) {
    const coberto = negadas.some((r) => { const p = /^Read\((.*)\)$/.exec(r)?.[1]; return p && casa(p, nome); });
    if (!coberto) erro(`${nome} existe na árvore e nenhuma regra de permissions.deny o cobre`);
  }
  if (JSON.stringify(settings).includes("bypassPermissions")) erro(".claude/settings.json: bypassPermissions não é o padrão deste projeto");

  const pre = settings.hooks?.PreToolUse;
  if (!Array.isArray(pre) || !pre.length) erro(".claude/settings.json: hooks.PreToolUse sumiu — o guarda de comandos não seria chamado");
  else {
    const texto = JSON.stringify(pre);
    for (const h of HOOKS) if (!texto.includes(h)) erro(`.claude/settings.json: PreToolUse não chama ${h}`);
    if (!texto.includes("${CLAUDE_PROJECT_DIR}")) erro(".claude/settings.json: o hook precisa de caminho por ${CLAUDE_PROJECT_DIR}, não relativo ao shell");
    if (!pre.some((g) => /Bash/.test(g.matcher ?? ""))) erro(".claude/settings.json: nenhum grupo PreToolUse casa a ferramenta Bash");
  }
}

// -------------------------------------------------------------------------------------------------
// 3. RULES
// -------------------------------------------------------------------------------------------------
const frontmatter = (texto) => {
  if (!texto.startsWith("---\n")) return null;          // o `---` tem de ser a PRIMEIRA linha
  const fim = texto.indexOf("\n---", 3);
  return fim < 0 ? null : texto.slice(4, fim);
};
for (const r of REGRAS) {
  const p = `.claude/rules/${r}.md`;
  if (!existe(p)) { erro(`falta a regra ${p}`); continue; }
  const t = ler(p);
  if (t.trim().length < 200) erro(`${p}: praticamente vazia`);
  const fm = frontmatter(t);
  if (fm !== null) {
    // O ÚNICO campo documentado em rules é `paths`. Campo inventado é ignorado em silêncio —
    // a regra passaria a valer sempre (ou nunca) sem ninguém notar.
    for (const linha of fm.split("\n")) {
      const campo = /^([a-zA-Z_-]+):/.exec(linha)?.[1];
      if (campo && campo !== "paths") erro(`${p}: campo de frontmatter "${campo}" não existe em rules; o único documentado é "paths"`);
    }
    if (/^paths:/m.test(fm)) {
      const globs = fm.split("\n").filter((l) => /^\s*-\s/.test(l)).map((l) => l.replace(/^\s*-\s*/, "").trim());
      if (!globs.length) erro(`${p}: "paths" declarado sem nenhum glob`);
      for (const g of globs) {
        // YAML: `*` inicia alias e `{` inicia mapa. Glob sem aspas quebra o parser e a regra não carrega.
        if (!/^["'].*["']$/.test(g)) erro(`${p}: o glob ${g} precisa de aspas (YAML trata * e { como sintaxe)`);
      }
    }
  }
}

// -------------------------------------------------------------------------------------------------
// 3b. A LEI DE UMA PR ABERTA POR VEZ (PRE-PR-01) CONTINUA ESCRITA NOS DOIS DONOS
//
// POR QUE ISTO É UM GATE. A lei que mais custa quando falha é a que ninguém percebe ter sumido.
// Uma linha apagada de `CLAUDE.md` não quebra build, tipo nem teste: a sessão seguinte simplesmente
// não a carrega, abre a segunda PR e o defeito só aparece na revisão, quando a resposta a um
// comentário está numa PR e o código correspondente está na outra.
//
// O QUE ELE PROVA, e é uma coisa só: que as CLÁUSULAS da lei continuam presentes nos dois donos.
// Não prova que a lei foi obedecida — isso é comportamento da sessão, não estado do repositório.
// Dizer o contrário seria gate que promete o que não entrega.
//
// POR QUE ESTÁTICO. Contar PR aberta exigiria falar com a API do GitHub, e este gate roda dentro de
// `pnpm lint`. Um lint que precisa de token fica vermelho offline, vermelho no fork e vermelho
// quando o GitHub oscila — e o que ele passaria a medir seria a rede, não o contrato. Quem conta PR
// aberta é a sessão, na hora de abrir, com uma listagem de leitura.
//
// COMENTÁRIO DE HTML NÃO CONTA. `<!-- … -->` não é lido pelo modelo como instrução ativa: comentar
// a lei é apagá-la com o texto ainda no arquivo, e seria a forma mais barata de passar por aqui.
// -------------------------------------------------------------------------------------------------
/** Texto sem comentário de HTML e com espaço normalizado — a lei quebra linha, o casamento não pode depender disso. */
const textoDaLei = (t) => t.replace(/<!--[\s\S]*?-->/g, " ").replace(/\s+/g, " ");

const LEI_PRE_PR_01 = [
  { arquivo: "CLAUDE.md", garante: "o identificador da lei", re: /PRE-PR-01/ },
  { arquivo: "CLAUDE.md", garante: "a fórmula da proibição", re: /PRs abertas\s*>\s*0\s*⇒\s*PR nova\s*=\s*PROIBIDA/i },
  { arquivo: "CLAUDE.md", garante: "que corrigir é atualizar a MESMA PR", re: /a mesma branch e a mesma PR/i },
  { arquivo: "CLAUDE.md", garante: "que fechar a PR aberta não libera caminho", re: /fechar, mesclar, marcar \*ready\*, criar branch concorrente ou abrir PR "temporária"/i },
  { arquivo: "CLAUDE.md", garante: "que a lei vence a instrução de sessão", re: /PRE-PR-01 vence o pedido/i },

  { arquivo: ".claude/rules/workflow.md", garante: "o identificador da lei", re: /PRE-PR-01/ },
  { arquivo: ".claude/rules/workflow.md", garante: "a fórmula da proibição", re: /PRs abertas\s*>\s*0\s*⇒\s*PR nova\s*=\s*PROIBIDA/i },
  { arquivo: ".claude/rules/workflow.md", garante: "a checagem por listagem antes de abrir", re: /LISTE as abertas/i },
  { arquivo: ".claude/rules/workflow.md", garante: "que fechar a PR aberta não libera caminho", re: /fechar a PR aberta para liberar o caminho/i },
  { arquivo: ".claude/rules/workflow.md", garante: "que mesclar não libera caminho", re: /mesclar a PR aberta/i },
  { arquivo: ".claude/rules/workflow.md", garante: "que branch concorrente é a mesma violação", re: /branch concorrente/i },
  { arquivo: ".claude/rules/workflow.md", garante: 'que PR "temporária" é a mesma violação', re: /PR "tempor[áa]ria"/i },
  { arquivo: ".claude/rules/workflow.md", garante: "que a lei vence a instrução de sessão", re: /a lei vence o pedido/i },
  { arquivo: ".claude/rules/workflow.md", garante: "que o gate é estático e o lint não fala com a rede", re: /`pnpm lint` não fala com a rede/i }
];

/** As cláusulas ausentes de um texto. Função pura, para o autoteste poder exercê-la sem tocar a árvore. */
const clausulasAusentes = (texto, clausulas) => clausulas.filter((c) => !c.re.test(textoDaLei(texto)));

// AUTOTESTE — nas duas direções, porque um verificador que nunca acusa é indistinguível de um
// verificador correto: a tela verde é a mesma. Inclui o caso do comentário, que é a burla barata.
{
  const doArquivo = (f) => LEI_PRE_PR_01.filter((c) => c.arquivo === f);
  const CLAUDE = doArquivo("CLAUDE.md");
  const COMPLETO = 'PRE-PR-01: PRs abertas > 0 ⇒ PR nova = PROIBIDA. Corrigir é atualizar a mesma branch e a mesma PR. '
    + 'Nunca fechar, mesclar, marcar *ready*, criar branch concorrente ou abrir PR "temporária" para liberar caminho. '
    + 'Havendo uma aberta, PRE-PR-01 vence o pedido.';
  const AMOSTRAS = [
    { nome: "lei inteira", texto: COMPLETO, ausentes: 0 },
    { nome: "lei quebrada em linhas", texto: COMPLETO.replace(/ /g, "\n"), ausentes: 0 },
    { nome: "fórmula apagada", texto: COMPLETO.replace("PRs abertas > 0 ⇒ PR nova = PROIBIDA", "evite abrir duas PRs"), ausentes: 1 },
    { nome: "precedência apagada", texto: COMPLETO.replace("PRE-PR-01 vence o pedido", "use o bom senso"), ausentes: 1 },
    { nome: "lei inteira comentada em HTML", texto: `<!-- ${COMPLETO} -->`, ausentes: CLAUDE.length },
    { nome: "arquivo sem a lei", texto: "# Fluxo\n\nBranch, commit, push.", ausentes: CLAUDE.length }
  ];
  for (const a of AMOSTRAS) {
    const obtido = clausulasAusentes(a.texto, CLAUDE).length;
    if (obtido !== a.ausentes) erro(`autoteste de PRE-PR-01: amostra "${a.nome}" devia acusar ${a.ausentes} cláusula(s) ausente(s) e acusou ${obtido}`);
  }
}

for (const f of [...new Set(LEI_PRE_PR_01.map((c) => c.arquivo))]) {
  if (!existe(f)) continue;                                  // a ausência do arquivo já é acusada acima
  for (const c of clausulasAusentes(ler(f), LEI_PRE_PR_01.filter((x) => x.arquivo === f))) {
    erro(`${f}: a lei PRE-PR-01 perdeu ${c.garante} — uma PR aberta deixaria de impedir a segunda, e nada quebraria`);
  }
}

// -------------------------------------------------------------------------------------------------
// 4. SKILLS
// -------------------------------------------------------------------------------------------------
for (const s of SKILLS) {
  const p = `.claude/skills/${s}/SKILL.md`;
  if (!existe(p)) { erro(`falta a skill ${p}`); continue; }
  const t = ler(p);
  const fm = frontmatter(t);
  if (fm === null) { erro(`${p}: sem frontmatter na primeira linha — o arquivo inteiro viraria conteúdo`); continue; }
  const campo = (k) => new RegExp(`^${k}:\\s*(.+)$`, "m").exec(fm)?.[1]?.trim();
  const nome = campo("name");
  if (!nome) erro(`${p}: falta "name"`);
  else if (nome !== s) erro(`${p}: name "${nome}" difere do diretório "${s}" — o comando vem do diretório`);
  const descricao = campo("description");
  if (!descricao) erro(`${p}: falta "description" — sem ela o gatilho vira a primeira linha do markdown`);
  // description + when_to_use são truncados juntos na listagem: o que passa do corte não influencia nada.
  const orcamento = (descricao ?? "").length + (campo("when_to_use") ?? "").length;
  if (orcamento > 1536) erro(`${p}: description + when_to_use somam ${orcamento} caracteres e são cortados em 1536`);
  const efeito = campo("effort");
  if (efeito && !["low", "medium", "high", "xhigh", "max"].includes(efeito)) erro(`${p}: effort "${efeito}" não é um nível válido`);
  if (t.split("\n").length > 500) erro(`${p}: passa de 500 linhas; mova referência longa para arquivo separado`);
}
for (const s of SKILLS_SEM_INVOCACAO_AUTOMATICA) {
  const p = `.claude/skills/${s}/SKILL.md`;
  if (existe(p) && !/^disable-model-invocation:\s*true\s*$/m.test(frontmatter(ler(p)) ?? "")) {
    erro(`${p}: precisa de "disable-model-invocation: true" — tocar produção não pode partir do modelo`);
  }
}

// -------------------------------------------------------------------------------------------------
// 5. SUBAGENTES
// -------------------------------------------------------------------------------------------------
const MODELOS = ["opus", "sonnet", "haiku", "fable", "inherit"];
for (const a of AGENTES) {
  const p = `.claude/agents/${a}.md`;
  if (!existe(p)) { erro(`falta o subagente ${p}`); continue; }
  const fm = frontmatter(ler(p));
  if (fm === null) { erro(`${p}: sem frontmatter na primeira linha`); continue; }
  const campo = (k) => new RegExp(`^${k}:\\s*(.+)$`, "m").exec(fm)?.[1]?.trim();
  const nome = campo("name");
  if (!nome) erro(`${p}: falta "name"`);
  else {
    if (nome !== a) erro(`${p}: name "${nome}" difere do arquivo`);
    if (!/^[a-z][a-z0-9-]*$/.test(nome)) erro(`${p}: name "${nome}" precisa ser minúsculas e hífens`);
    if (nome.includes(":")) erro(`${p}: name com ":" não é carregado`);
  }
  if (!campo("description")) erro(`${p}: falta "description" — sem ela o subagente nunca é escolhido`);
  const modelo = campo("model");
  if (modelo && !MODELOS.includes(modelo) && !/^claude-/.test(modelo)) erro(`${p}: model "${modelo}" não é apelido válido nem identificador completo`);
  const efeito = campo("effort");
  if (efeito && !["low", "medium", "high", "xhigh", "max"].includes(efeito)) erro(`${p}: effort "${efeito}" inválido`);
  const ferramentas = (campo("tools") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!ferramentas.length) erro(`${p}: "tools" vazio — auditor sem lista branca herda tudo, inclusive escrita`);
  // Auditor que conserta o que encontrou deixa de auditar: passa a revisar o próprio trabalho.
  const escrita = ferramentas.filter((f) => FERRAMENTAS_DE_ESCRITA.includes(f));
  if (escrita.length) erro(`${p}: subagente de auditoria não pode ter ${escrita.join(", ")}`);
  if (/^tools:\s*$/m.test(fm)) erro(`${p}: "tools" é string separada por vírgula, não lista YAML`);
}

// -------------------------------------------------------------------------------------------------
// 6. HOOKS E SEU AUTOTESTE
// -------------------------------------------------------------------------------------------------
for (const h of HOOKS) {
  const p = `.claude/hooks/${h}`;
  if (!existe(p)) { erro(`falta o hook ${p}`); continue; }
  try {
    execFileSync(process.execPath, [caminho(p), "--autoteste"], { stdio: "pipe", timeout: 60_000 });
  } catch (e) {
    const saida = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim().split("\n").slice(-6).join(" | ");
    erro(`${p}: autoteste reprovou — ${saida || e.message}`);
  }
}

// -------------------------------------------------------------------------------------------------
// 6b. O LIMITE DO AUDITOR É MECÂNICO, NÃO UMA FRASE NO PROMPT
//
// Os seis subagentes recebem Bash, que escreve arquivo. A garantia de que eles não viram coautores
// vem do hook por `agent_type` — então o gate prova três coisas: que todo agente declarado está
// coberto, que um Bash mutante DELE é recusado, e que leitura e gate continuam passando. Sem a
// terceira, endurecer o guarda a ponto de travar o auditor passaria despercebido.
// -------------------------------------------------------------------------------------------------
const GUARDA_AUDITOR = ".claude/hooks/guard-auditor-command.mjs";
if (existe(GUARDA_AUDITOR)) {
  const { AUDITORES, SCRIPTS_DE_GATE } = await import(new URL(`../${GUARDA_AUDITOR}`, import.meta.url));

  for (const a of AGENTES) if (!AUDITORES.has(a)) erro(`${GUARDA_AUDITOR}: o subagente "${a}" não está protegido pelo limite de auditor`);
  for (const a of AUDITORES) if (!AGENTES.includes(a)) erro(`${GUARDA_AUDITOR}: protege "${a}", que não existe em .claude/agents/`);

  // `audit:*` da lista branca tem de existir de fato; script novo exige inclusão consciente.
  const scripts = Object.keys(JSON.parse(ler("package.json")).scripts ?? {});
  for (const g of SCRIPTS_DE_GATE) if (g.startsWith("audit:") && !scripts.includes(g)) erro(`${GUARDA_AUDITOR}: libera "${g}", que não existe no package.json`);
  for (const g of scripts) if (g.startsWith("audit:") && !SCRIPTS_DE_GATE.has(g)) erro(`package.json tem "${g}" e o limite do auditor não o conhece — declare-o ou ele fica recusado`);

  // Prova real pelo hook, com entrada sintética. Nenhum comando é executado.
  const decisao = (agente, comando) => {
    const entrada = JSON.stringify({ tool_name: "Bash", hook_event_name: "PreToolUse", agent_type: agente, tool_input: { command: comando } });
    const saida = execFileSync(process.execPath, [caminho(GUARDA_AUDITOR)], { input: entrada, encoding: "utf8", timeout: 20_000 });
    return saida.trim() ? "deny" : "allow";
  };
  // Modo mutante de programa que, pelo NOME, pareceria leitura — é a classe que reabriu o buraco.
  const MUTANTES = [
    "echo x > apps/api/src/index.ts", "sed -i 's/a/b/' CLAUDE.md", "git commit -m x", "rm REVIEW.md",
    "sort -o saida.txt entrada.txt", "git tag v1", "git branch nova", "pnpm lint -- --fix", "pnpm test -- -u"
  ];
  const LEITURAS = [
    "git diff origin/main...HEAD", "pnpm lint", "grep -rn runService apps/api/src", "cat CLAUDE.md",
    "git tag --list", "sort entrada.txt", "git branch --show-current"
  ];
  for (const c of MUTANTES) if (decisao("pr-certifier", c) !== "deny") erro(`${GUARDA_AUDITOR}: auditor conseguiria executar comando que escreve (classe: ${c.split(" ").slice(0, 2).join(" ")})`);
  for (const c of LEITURAS) if (decisao("pr-certifier", c) !== "allow") erro(`${GUARDA_AUDITOR}: auditor ficou sem poder rodar leitura/gate (classe: ${c.split(" ").slice(0, 2).join(" ")})`);
  // O executor principal não é auditor e não pode ser afetado por este hook.
  if (decisao("", "git commit -m x") !== "allow") erro(`${GUARDA_AUDITOR}: está afetando o executor principal, que não é auditor`);
}

// -------------------------------------------------------------------------------------------------
// 6c. O GUARDA DE COMANDOS PERIGOSOS, PELO HOOK REAL
//
// Duas classes que só se provam de ponta a ponta: destino de push que o shell resolve depois, e
// gate de teste apontado para um banco que não é local. A segunda também prova o SILÊNCIO: a
// recusa não pode citar host, usuário nem a URL, porque a mensagem vai para o transcript.
// -------------------------------------------------------------------------------------------------
const GUARDA_PERIGOSO = ".claude/hooks/guard-dangerous-command.mjs";

// -------------------------------------------------------------------------------------------------
// TODO SCRIPT DE E2E TEM ALVO DE BANCO DECLARADO.
//
// POR QUE ESTA REGRA EXISTE. `bancoDeTesteNaoProvadoLocal` casa o gate por TOKEN EXATO. Isso
// significa que `e2e` é protegido e `e2e:mobile` NÃO era — o mesmo Playwright, o mesmo reset de
// banco, e a proteção perdida só por o script ter outro nome. Aconteceu três vezes em silêncio
// (`e2e:mobile`, `e2e:skew`, `e2e:skew:web-anterior`) e nenhum gate reclamou, porque não havia
// gate: a lista era uma enumeração que ninguém confrontava com os scripts que existem de fato.
//
// O NOME DO SCRIPT É O GATILHO DA OBRIGAÇÃO DE DECLARAR, NÃO A AFIRMAÇÃO SOBRE O COMPORTAMENTO.
// Um `e2e*` pode legitimamente não abrir banco (um `e2e:report` que só abre HTML). Forçá-lo para
// dentro do mapa de alvos seria escrever mentira no SSOT — e pior, passaria a recusá-lo sempre que
// a variável estivesse remota no shell. Gate que acusa o inocente é desligado na primeira semana.
// Por isso a saída honesta tem duas portas, e exatamente uma delas: ou o script declara alvo de
// banco, ou declara, com motivo escrito, que não tem alvo.
//
// O QUE ELA NÃO FAZ, para a cobertura não ser confundida com garantia: ela casa NOME DE SCRIPT.
// Não alcança `pnpm exec playwright test`, `npx playwright test` nem um script que rode Playwright
// com outro nome (`smoke`, `teste-visual`). Também não cobre `gate:05c2`/`gate:0019`, que resetam
// schema por caminho próprio. Fechar o eixo do PROGRAMA é fatia própria, declarada na PR.
// -------------------------------------------------------------------------------------------------
if (existe(GUARDA_PERIGOSO)) {
  const { ALVO_DE_BANCO_POR_GATE, SEM_ALVO_DE_BANCO_DECLARADO } = await import(new URL(`../${GUARDA_PERIGOSO}`, import.meta.url));

  // O workspace inteiro, não só a raiz: `e2e:skew` e `e2e:skew:web-anterior` só existem em
  // `apps/web/package.json`. Uma regra lida só da raiz não os enxergaria — verde que não prova nada.
  const pacotes = ["package.json"];
  for (const base of ["apps", "packages"]) {
    if (!existe(base)) continue;
    for (const nome of readdirSync(caminho(base))) {
      if (nome.startsWith(".")) continue;                       // `.api-anterior` é árvore de build
      const pj = `${base}/${nome}/package.json`;
      if (existe(pj)) pacotes.push(pj);
    }
  }

  const scriptsE2E = new Map();                                 // nome → pacote onde foi declarado
  for (const pj of pacotes) {
    for (const nome of Object.keys(JSON.parse(ler(pj)).scripts ?? {})) {
      if (nome === "e2e" || nome.startsWith("e2e:")) if (!scriptsE2E.has(nome)) scriptsE2E.set(nome, pj);
    }
  }

  for (const [nome, pj] of scriptsE2E) {
    const temAlvo = ALVO_DE_BANCO_POR_GATE.has(nome);
    const semAlvo = SEM_ALVO_DE_BANCO_DECLARADO.has(nome);
    if (temAlvo && semAlvo) erro(`${pj}: "${nome}" está nas DUAS listas do ${GUARDA_PERIGOSO} — decida qual, porque elas se contradizem`);
    if (!temAlvo && !semAlvo) erro(`${pj}: "${nome}" é script de E2E sem alvo de banco declarado — acrescente-o a ALVO_DE_BANCO_POR_GATE (e o guarda prova o host) ou a SEM_ALVO_DE_BANCO_DECLARADO com o motivo escrito`);
    if (semAlvo && !String(SEM_ALVO_DE_BANCO_DECLARADO.get(nome) ?? "").trim()) erro(`${GUARDA_PERIGOSO}: "${nome}" está declarado sem alvo de banco e sem motivo — declaração sem motivo é carimbo`);
  }
  // Os dois sentidos: declaração órfã sai junto com o script, senão a lista vira ficção.
  for (const nome of ALVO_DE_BANCO_POR_GATE.keys()) {
    if ((nome === "e2e" || nome.startsWith("e2e:")) && !scriptsE2E.has(nome)) erro(`${GUARDA_PERIGOSO}: ALVO_DE_BANCO_POR_GATE declara "${nome}", que não existe em package.json nenhum — a declaração precisa sair junto`);
  }
  for (const nome of SEM_ALVO_DE_BANCO_DECLARADO.keys()) {
    if (!scriptsE2E.has(nome)) erro(`${GUARDA_PERIGOSO}: SEM_ALVO_DE_BANCO_DECLARADO declara "${nome}", que não existe em package.json nenhum — a declaração precisa sair junto`);
  }
  CONTAGEM_E2E.total = scriptsE2E.size;
  CONTAGEM_E2E.semBanco = SEM_ALVO_DE_BANCO_DECLARADO.size;

  const responder = (comando) => {
    const entrada = JSON.stringify({ tool_name: "Bash", hook_event_name: "PreToolUse", tool_input: { command: comando } });
    return execFileSync(process.execPath, [caminho(GUARDA_PERIGOSO)], { input: entrada, encoding: "utf8", timeout: 20_000 });
  };
  // nome montado: escrito por extenso casaria o secret scan do CI; host inexistente
  const VAR_TESTE = `TEST_${"DATABASE_URL"}`;
  const HOST_REMOTO = "db.exemplo.invalid";
  const ASPA = String.fromCharCode(39);
  const REMOTO = `postgresql://postgres@${HOST_REMOTO}:5432/prod`;
  const LOCAL = "postgresql://postgres@127.0.0.1:5433/agro_erp_test";
  const NEGAR = [
    "git push origin $REF",
    'git push origin "$REF"',
    "git push origin --follow-tags claude/x",
    // o alvo do banco pode chegar ao processo por caminhos que o process.env do hook não mostra
    `${VAR_TESTE}=${REMOTO} pnpm test:integration`,
    `${VAR_TESTE}=${ASPA}${REMOTO}${ASPA} pnpm test:integration`,
    `${VAR_TESTE}="${REMOTO}" pnpm test:integration`,
    `env ${VAR_TESTE}=${ASPA}${REMOTO}${ASPA} pnpm test:integration`,
    `export ${VAR_TESTE}=${ASPA}${REMOTO}${ASPA}; pnpm test:integration`,
    "source ./algum-env && pnpm test:integration",
    `${VAR_TESTE}=nao-e-uma-url pnpm test:integration`
  ];
  const PERMITIR = [
    "git push -u origin claude/minha-fatia",
    "git push origin HEAD:claude/minha-fatia",
    "echo 'git push origin $REF'",
    `${VAR_TESTE}=${LOCAL} pnpm test:integration`,
    `${VAR_TESTE}=${ASPA}${LOCAL}${ASPA} pnpm test:integration`,
    `${VAR_TESTE}="${LOCAL}" pnpm test:integration`
  ];
  for (const c of NEGAR) {
    const saida = responder(c);
    if (!saida.trim()) { erro(`${GUARDA_PERIGOSO}: deveria negar e permitiu (classe: ${c.split(" ").slice(0, 2).join(" ")})`); continue; }
    // o motivo não pode conter o alvo: nem host, nem esquema de conexão
    if (new RegExp(`${HOST_REMOTO}|postgres|127\\.0\\.0\\.1`).test(saida)) erro(`${GUARDA_PERIGOSO}: a recusa vazou o alvo do banco no motivo`);
  }
  for (const c of PERMITIR) if (responder(c).trim()) erro(`${GUARDA_PERIGOSO}: recusou comando legítimo (classe: ${c.split(" ").slice(0, 2).join(" ")})`);

  // O auditor tem de herdar a MESMA decisão — se divergir, existem dois contratos e um deles mente.
  if (existe(GUARDA_AUDITOR)) {
    const comoAuditor = (comando) => {
      const entrada = JSON.stringify({ tool_name: "Bash", hook_event_name: "PreToolUse", agent_type: "pr-certifier", tool_input: { command: comando } });
      return execFileSync(process.execPath, [caminho(GUARDA_AUDITOR)], { input: entrada, encoding: "utf8", timeout: 20_000 });
    };
    if (!comoAuditor(`${VAR_TESTE}=${ASPA}${REMOTO}${ASPA} pnpm test:integration`).trim()) {
      erro(`${GUARDA_AUDITOR}: auditor rodaria gate de banco com alvo não provado local`);
    }
    if (comoAuditor(`${VAR_TESTE}=${ASPA}${LOCAL}${ASPA} pnpm test:integration`).trim()) {
      erro(`${GUARDA_AUDITOR}: auditor ficou sem poder rodar o gate contra alvo local`);
    }
  }
}

// -------------------------------------------------------------------------------------------------
// 7. DOCUMENTAÇÃO
// -------------------------------------------------------------------------------------------------
for (const d of DOCS) if (!existe(d)) erro(`falta ${d}`);

// -------------------------------------------------------------------------------------------------
// 8. SEGREDOS E CONECTORES
// -------------------------------------------------------------------------------------------------
const arquivosDoHarness = () => {
  const saida = [...RAIZ_ESPERADA, ...DOCS, "scripts/claude-harness-audit.mjs"];
  const anda = (dir) => {
    if (!existe(dir)) return;
    for (const nome of readdirSync(caminho(dir))) {
      const rel = `${dir}/${nome}`;
      if (statSync(caminho(rel)).isDirectory()) anda(rel);
      else saida.push(rel);
    }
  };
  anda(".claude");
  return [...new Set(saida)].filter(existe);
};

/** Formatos de credencial que ninguém escreve por acidente. Placeholder não casa. */
const SEGREDOS = [
  { id: "token de acesso Supabase", re: /\bsbp_[A-Za-z0-9]{20,}/ },
  { id: "token do GitHub", re: /\b(ghp|gho|ghs|ghu)_[A-Za-z0-9]{20,}/ },
  { id: "token de usuário do GitHub", re: /\bgithub_pat_[A-Za-z0-9_]{30,}/ },
  { id: "JSON Web Token", re: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/ },
  { id: "chave privada", re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: "credencial em DSN", re: /\bpostgres(?:ql)?:\/\/[^\s"'${}]*:[^\s"'@${}]+@/ }
];
for (const f of arquivosDoHarness()) {
  const t = ler(f);
  for (const s of SEGREDOS) if (s.re.test(t)) erro(`${f}: parece conter ${s.id} literal`);
}

if (existe(".env")) erro(".env está presente na árvore do repositório e nunca deve ser versionado");
try {
  const versionados = execFileSync("git", ["ls-files", ".env", ".env.*", "secrets"], { cwd: RAIZ, encoding: "utf8" })
    .split("\n").map((l) => l.trim()).filter((l) => l && l !== ".env.example");
  for (const v of versionados) erro(`${v} está versionado — arquivo de ambiente/segredo nunca entra no git`);
} catch { /* fora de um checkout git: as demais checagens continuam valendo */ }

if (existe(".mcp.json")) {
  // Escopo de projeto é carregado SEM aprovação em sessões não interativas (`-p`, SDK, nuvem).
  erro(".mcp.json existe: este repositório usa apenas .mcp.json.example (ver docs/CLAUDE-CODE-CONNECTORS.md)");
}
if (existe(".mcp.json.example")) {
  let exemplo = null;
  try { exemplo = JSON.parse(ler(".mcp.json.example")); }
  catch (e) { erro(`.mcp.json.example não é JSON válido: ${e.message}`); }
  if (exemplo) {
    const t = ler(".mcp.json.example");
    if (!exemplo.mcpServers) erro(".mcp.json.example: falta a chave mcpServers");
    // O documento manda COPIAR este arquivo para .mcp.json. Chave decorativa a mais vira
    // configuração inválida no destino, e o sintoma seria "servidor não conecta" — não
    // "arquivo errado". O template tem de ser válido como está.
    const extras = Object.keys(exemplo).filter((k) => k !== "mcpServers");
    if (extras.length) erro(`.mcp.json.example: chave(s) de topo fora do shape oficial: ${extras.join(", ")} (o destino é um .mcp.json real)`);
    if (!/\$\{[A-Z_]+\}/.test(t)) erro(".mcp.json.example: precisa usar placeholder ${VARIAVEL}, nunca valor real");
    for (const [nome, cfg] of Object.entries(exemplo.mcpServers ?? {})) {
      if (cfg.url && cfg.type !== "http") erro(`.mcp.json.example: servidor "${nome}" tem url sem "type": "http" — seria lido como processo local`);
      if (cfg.headers) erro(`.mcp.json.example: servidor "${nome}" traz headers; autenticação é por OAuth ou ambiente, nunca no arquivo`);
      if (/supabase/i.test(nome) && !/read_only=true/.test(cfg.url ?? "")) erro(`.mcp.json.example: "${nome}" precisa de read_only=true`);
    }
  }
}

// -------------------------------------------------------------------------------------------------
// 9. REFERÊNCIAS INTERNAS APONTAM PARA ARQUIVOS REAIS
// Documento que cita caminho inexistente manda a próxima sessão procurar o que não existe.
// -------------------------------------------------------------------------------------------------
const REFERENCIA = /`([A-Za-z0-9._][A-Za-z0-9._/-]*\.(?:md|mjs|ts|tsx|json|sql))`/g;
/** Ausência DELIBERADA: o documento cita o arquivo para explicar por que ele não existe. */
const AUSENTES_POR_CONTRATO = new Map([
  [".mcp.json", "escopo de projeto carrega sem aprovação em sessão não interativa; o repositório versiona só o modelo"]
]);
for (const f of arquivosDoHarness()) {
  if (!/\.(md|json)$/.test(f)) continue;
  const t = ler(f);
  const dir = path.dirname(f);
  for (const m of t.matchAll(REFERENCIA)) {
    const alvo = m[1];
    if (alvo.includes("*") || alvo.startsWith("000N")) continue;        // glob e exemplo genérico
    if (AUSENTES_POR_CONTRATO.has(alvo)) continue;
    // Uma rule cita a irmã pelo nome (`security.md`): resolver só da raiz acusaria falso positivo.
    if (existe(alvo) || existe(path.posix.join(dir, alvo))) continue;
    erro(`${f}: cita \`${alvo}\`, que não existe nem na raiz nem em ${dir}/`);
  }
}

// -------------------------------------------------------------------------------------------------
if (problemas.length) {
  console.error("claude-harness-audit: o harness de engenharia está fora de contrato:");
  for (const p of problemas) console.error(`  - ${p}`);
  process.exit(1);
}
// A contagem de E2E vai na linha verde de propósito: um escaneamento que achasse ZERO scripts
// também passaria calado, e "0 script de E2E auditado" é visivelmente errado num repositório que
// tem quatro. Verde que não prova nada é reprovação — então o verde diz o que contou.
console.log(`claude-harness-audit: OK (${REGRAS.length} regras, ${SKILLS.length} skills, ${AGENTES.length} subagentes com limite de leitura mecânico, ${HOOKS.length} hooks com autoteste, ${LEI_PRE_PR_01.length} cláusulas de PRE-PR-01 presentes nos 2 donos, ${(settings?.permissions?.deny ?? []).length} negações de leitura, ${CONTAGEM_E2E.total} script(s) de E2E com alvo de banco declarado (${CONTAGEM_E2E.semBanco} declarado(s) sem banco), conectores só por modelo)`);
