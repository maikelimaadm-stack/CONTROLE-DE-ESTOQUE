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
const HOOKS = ["guard-dangerous-command.mjs"];
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
console.log(`claude-harness-audit: OK (${REGRAS.length} regras, ${SKILLS.length} skills, ${AGENTES.length} subagentes sem ferramenta de escrita, ${HOOKS.length} hook com autoteste, ${(settings?.permissions?.deny ?? []).length} negações de leitura, conectores só por modelo)`);
