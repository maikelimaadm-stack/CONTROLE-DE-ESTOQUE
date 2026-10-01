#!/usr/bin/env node
/**
 * MAPA DE COLISÃO (PRE-PR-02, decisão 273), montado pela MÁQUINA em vez da memória da sessão.
 *
 * A lei mora em `CLAUDE.md` e `.claude/rules/workflow.md`; este script não a redefine, ele a APLICA:
 * lista as PRs abertas, lê o diff de cada uma e compara com o desta branch (ou com os arquivos que a
 * fatia PRETENDE tocar, antes de editar). A saída é a tabela do workflow, pronta para o corpo da PR.
 *
 *   node scripts/mapa-colisao.mjs                         esta branch × cada PR aberta
 *   node scripts/mapa-colisao.mjs --faixa F2              idem, e confere a fronteira da faixa
 *   node scripts/mapa-colisao.mjs --planejado a.tsx,b.md  antes de editar: os arquivos que a fatia vai tocar
 *   node scripts/mapa-colisao.mjs --entre-abertas         as PRs abertas, par a par, entre si
 *   node scripts/mapa-colisao.mjs --so-commitado          ignora o que ainda não foi commitado
 *   node scripts/mapa-colisao.mjs --autoteste             só as fixtures do classificador (sem rede)
 *
 * Saída: 0 = sem colisão · 1 = COLISÃO (ou fora da faixa) · 3 = sem colisão de arquivo/número, mas
 * banco ou contrato exigem ler o diff · 2 = não deu para listar as PRs (sem mapa, sem PR: fail closed).
 *
 * POR QUE FORA DO `pnpm lint`. Ele fala com o GitHub (`gh`, só leitura). O lint não fala com a rede
 * (workflow.md); um gate que dependesse de token mediria a rede, não o contrato.
 *
 * ATÉ ONDE ELE VAI. Arquivo e número (migration e decisão) ele PROVA. Banco e contrato não aparecem
 * no nome do arquivo: quando um dos lados toca banco, API ou domínio, a coluna diz "LER O DIFF" e a
 * saída é 3 — nunca "nenhum". Verde aqui não dispensa a leitura que ele mandou fazer.
 */
import { execFileSync } from "node:child_process";

// -------------------------------------------------------------------------------------------------
// EXCEÇÕES DE ARQUIVO — espelho de `.claude/rules/workflow.md` § "O que é colisão". Mudou lá, muda aqui.
// -------------------------------------------------------------------------------------------------
const SECAO_PROPRIA = new Set(["docs/DECISIONS.md", "docs/DEPLOYMENT.md", "docs/TESTING.md"]);
const GERADOS = [
  /^docs\/DATA-DICTIONARY\.md$/, /^docs\/COMPANY-RLS-MATRIX\.md$/, /^docs\/NOTIFICATION-SCOPE-MATRIX\.md$/,
  /^docs\/FARM-DEPENDENCY-INVENTORY\.md$/, /^docs\/parity\//, /^pnpm-lock\.yaml$/
];
const CONTAGEM = [/\.baseline\.json$/];
/** Contagem de migrations mora espalhada nos testes do pacote de banco: o nome do arquivo não prova nada. */
const CONTAGEM_A_CONFERIR = [/^packages\/db\/test\//];

const BANCO = [/^supabase\//, /^packages\/db\/src\//];
const CONTRATO = [/^apps\/api\//, /^packages\/(domain|plataforma|validation|shared)\/src\//];

/** Fronteira de cada faixa (CLAUDE.md § Fluxo). F1 e F3 não têm fronteira de CAMINHO: a delas é de assunto. */
const FRONTEIRA = {
  F2: { permitido: [/^apps\/web\//, /^docs\//, /^[^/]+\.md$/], proibido: [/^supabase\//, /^apps\/api\//, /^packages\//] }
};

/**
 * Arquivos que várias telas compartilham. Tocar um deles não é colisão por si — mas é onde a PR visual
 * seguinte vai colidir, e componente genérico alterado exige E2E das OUTRAS telas (frontend-web.md).
 */
const HOTSPOTS = [
  [/^apps\/web\/src\/components\/ui\//, "primitive do barrel: muda todas as telas (UI-STANDARD.md)"],
  [/^apps\/web\/src\/components\/layout\//, "shell, menu, abas: aparece em toda tela (UI-SHELL-MATRIX.md)"],
  [/^apps\/web\/src\/app\/globals\.css$/, "tokens e classes mg-*: identidade visual de todas as telas"],
  [/^apps\/web\/src\/app\/layout\.tsx$/, "layout raiz"],
  [/^apps\/web\/nav\.registry\.mjs$/, "fonte única da navegação: contrato de rota e permissão"],
  [/^apps\/web\/redirects\.mjs$/, "redirects de rota: contrato"],
  [/^apps\/web\/src\/lib\/(utils|copy|api|nav|i18n|workspace-tabs|mega-menu|preferences)\.tsx?$/, "biblioteca compartilhada da web"],
  [/^apps\/web\/src\/components\/workspace\.tsx$/, "abas internas, chips e NewChooser de todos os módulos (UX-ARCHITECTURE.md)"],
  [/^apps\/web\/src\/features\/(base1|base2)\//, "motor de listagem/lançamento: comportamento é do motor, não da tela"],
  [/^apps\/web\/src\/features\/docs\/shared\.tsx$/, "DocList e editores compartilhados dos documentos"],
  [/^apps\/web\/src\/features\/admin\/layout-configurador\//, "layout de documento por TOP: contrato de layout"],
  [/^apps\/web\/src\/features\/resources\/(form-layout|resource-form|resource-list)\.tsx$/, "motor dos cadastros declarativos"],
  [/^apps\/web\/e2e\/helpers\.ts$/, "helpers de todos os specs (e do skew contra o web da base)"],
  [/^apps\/web\/playwright[^/]*\.config\.ts$/, "configuração da suíte: viewport do gate desktop"],
  [/^docs\/UI-(SHELL|RECORD-OPEN)-MATRIX\.md$/, "derivada do nav.registry, mas FORA da lista de gerados isentos: em comum é colisão"],
  [/^apps\/web\/scripts\//, "auditorias do lint da web"]
];

/** Área da web: duas PRs na mesma rota ou feature podem colidir por CONTRATO (rota, layout, permissão) sem arquivo em comum. */
const areaDaWeb = (p) => {
  const rota = /^apps\/web\/src\/app\/\(app\)\/([^/]+)\//.exec(p)?.[1];
  if (rota) return `rota /${rota}`;
  const feature = /^apps\/web\/src\/features\/([^/]+)\//.exec(p)?.[1];
  return feature ? `features/${feature}` : null;
};
const areasDe = (lado) => new Set([...lado.arquivos.keys()].map(areaDaWeb).filter(Boolean));

// -------------------------------------------------------------------------------------------------
// ANÁLISE DE DIFF — funções puras, cobertas pelo autoteste
// -------------------------------------------------------------------------------------------------
/** Diff unificado → { arquivos: Map<caminho, {adicoes, remocoes}>, decisoes: Set<número> }. */
export function analisarDiff(texto) {
  const arquivos = new Map();
  const decisoes = new Set();
  let atual = null;
  for (const linha of texto.split("\n")) {
    const cab = /^diff --git a\/(.+?) b\/(.+)$/.exec(linha);
    if (cab) {
      atual = cab[2];
      if (!arquivos.has(atual)) arquivos.set(atual, { adicoes: 0, remocoes: 0 });
      continue;
    }
    if (!atual || linha.startsWith("+++") || linha.startsWith("---")) continue;
    if (linha.startsWith("+")) {
      arquivos.get(atual).adicoes++;
      if (atual === "docs/DECISIONS.md") {
        const n = /^\+\|\s*(\d+)\s*\|/.exec(linha)?.[1];
        if (n) decisoes.add(Number(n));
      }
    } else if (linha.startsWith("-")) arquivos.get(atual).remocoes++;
  }
  return { arquivos, decisoes };
}

export const faixaDoTitulo = (titulo) => /^\s*\[(F[123])\]/.exec(titulo ?? "")?.[1] ?? null;

export function migracoesDe(arquivos) {
  const s = new Set();
  for (const f of arquivos.keys()) {
    const n = /^supabase\/migrations\/(\d{4})_/.exec(f)?.[1];
    if (n) s.add(n);
  }
  return s;
}

const casa = (lista, f) => lista.some((re) => re.test(f));
const toca = (lado, lista) => [...lado.arquivos.keys()].some((f) => casa(lista, f));

/** Um arquivo que os dois lados mudam: colide ou cai numa exceção do workflow? */
export function classificarArquivoComum(f, a, b) {
  const da = a.arquivos.get(f), db = b.arquivos.get(f);
  if (casa(GERADOS, f)) return { colide: false, nota: `${f} (gerado: quem entra depois regera)` };
  if (casa(CONTAGEM, f)) return { colide: false, nota: `${f} (contagem: quem entra depois refaz)` };
  if (SECAO_PROPRIA.has(f)) {
    const alterou = da.remocoes > 0 || db.remocoes > 0;
    return { colide: false, verificar: alterou, nota: alterou ? `${f} (seção própria, MAS há linha removida/alterada: confira que é só a própria)` : `${f} (só a própria linha/seção)` };
  }
  if (casa(CONTAGEM_A_CONFERIR, f)) return { colide: false, verificar: true, nota: `${f} (só vale como exceção se for apenas a contagem de migrations: LER O DIFF)` };
  if (/^docs\/.+\.md$/.test(f) && da.remocoes === 0 && db.remocoes === 0) {
    return { colide: false, verificar: true, nota: `${f} (as duas só acrescentam: exceção da seção própria nova, se forem seções distintas)` };
  }
  return { colide: true, nota: f };
}

/** Compara dois lados ({id, faixa, arquivos, decisoes}) e devolve a linha do mapa. */
export function compararPar(a, b) {
  const motivos = [];
  const comuns = [...a.arquivos.keys()].filter((f) => b.arquivos.has(f)).sort();
  const notas = [];
  let verificar = false;
  for (const f of comuns) {
    const c = classificarArquivoComum(f, a, b);
    notas.push(c.colide ? `**${c.nota}**` : c.nota);
    if (c.colide) motivos.push(`arquivo ${f}`);
    if (c.verificar) verificar = true;
  }
  if (!a.faixa) motivos.push(`${a.id} sem faixa no título colide com todas`);
  if (!b.faixa) motivos.push(`${b.id} sem faixa no título colide com todas`);

  const ma = migracoesDe(a.arquivos), mb = migracoesDe(b.arquivos);
  const migComuns = [...ma].filter((n) => mb.has(n));
  const decComuns = [...a.decisoes].filter((n) => b.decisoes.has(n));
  for (const n of migComuns) motivos.push(`migration ${n}`);
  for (const n of decComuns) motivos.push(`decisão ${n}`);
  const numeros = [...migComuns.map((n) => `migration ${n}`), ...decComuns.map((n) => `decisão ${n}`)];

  const bancoA = toca(a, BANCO), bancoB = toca(b, BANCO);
  const contA = toca(a, CONTRATO), contB = toca(b, CONTRATO);
  const banco = bancoA && bancoB ? "LER O DIFF (as duas tocam banco)" : bancoA || bancoB ? `nenhum por caminho (só ${bancoA ? a.id : b.id} toca banco; confira pré-condição de migration)` : "nenhum (nenhuma toca banco)";
  // Contrato também se toca pela web: uma tela que CONSOME a rota que a outra muda, ou duas fatias de tela na
  // mesma rota/feature mudando o mesmo layout ou a mesma permissão de área sem nenhum arquivo em comum.
  const areasB = areasDe(b);
  const areasComuns = [...areasDe(a)].filter((x) => areasB.has(x)).sort();
  const contrato = contA || contB ? "LER O DIFF (há API/domínio de um lado)"
    : areasComuns.length ? `LER O DIFF (as duas mexem em ${areasComuns.join(", ")}: mesma rota, layout ou permissão?)`
    : "nenhum por caminho (nenhuma toca API/domínio nem a mesma rota/feature da web)";
  if (bancoA || bancoB || contA || contB || areasComuns.length) verificar = true;

  let ordem = "indiferente";
  if (ma.size && mb.size && !migComuns.length) {
    const menorA = [...ma].sort()[0], menorB = [...mb].sort()[0];
    ordem = menorA < menorB ? `${b.id} entra depois de ${a.id} (migration ${menorA} < ${menorB})` : `${a.id} entra depois de ${b.id} (migration ${menorB} < ${menorA})`;
  }

  return {
    colide: motivos.length > 0,
    verificar,
    motivos,
    linha: { pr: b.id, faixa: b.faixa ?? "SEM FAIXA", arquivos: notas.length ? notas.join("; ") : "nenhum", numeros: numeros.length ? `**${numeros.join(", ")}**` : "nenhum", banco, contrato, ordem }
  };
}

export function foraDaFaixa(faixa, arquivos) {
  const f = FRONTEIRA[faixa];
  if (!f) return [];
  return [...arquivos.keys()].filter((p) => casa(f.proibido, p) || !casa(f.permitido, p));
}

export const hotspotsDe = (arquivos) => [...arquivos.keys()].flatMap((p) => HOTSPOTS.filter(([re]) => re.test(p)).map(([, motivo]) => `${p} — ${motivo}`));

// -------------------------------------------------------------------------------------------------
// AUTOTESTE — nas duas direções: o que colide acusa, o que a lei libera passa.
// -------------------------------------------------------------------------------------------------
function autoteste() {
  const diff = (arquivos) => arquivos.map(([f, linhas]) => `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -1 +1 @@\n${linhas.join("\n")}`).join("\n");
  const lado = (id, titulo, arquivos) => ({ id, faixa: faixaDoTitulo(titulo), ...analisarDiff(diff(arquivos)) });
  const tela = (f) => [f, ["+x", "-y"]];
  const casos = [
    ["arquivos disjuntos, as duas F2", lado("esta", "[F2] a", [tela("apps/web/src/a.tsx")]), lado("#2", "[F2] b", [tela("apps/web/src/b.tsx")]), false],
    ["mesmo arquivo de tela", lado("esta", "[F2] a", [tela("apps/web/src/a.tsx")]), lado("#2", "[F2] b", [tela("apps/web/src/a.tsx")]), true],
    ["PR aberta sem faixa colide com tudo", lado("esta", "[F2] a", [tela("apps/web/src/a.tsx")]), lado("#2", "Ajuste", [tela("docs/X.md")]), true],
    ["DECISIONS com linhas próprias não colide", lado("esta", "[F2] a", [["docs/DECISIONS.md", ["+| 280 | A |"]]]), lado("#2", "[F1] b", [["docs/DECISIONS.md", ["+| 281 | B |"]]]), false],
    ["DECISIONS com a própria linha editada não colide (é a exceção, não a regra geral de docs)", lado("esta", "[F2] a", [["docs/DECISIONS.md", ["+| 280 | A2 |", "-| 280 | A |"]]]), lado("#2", "[F1] b", [["docs/DECISIONS.md", ["+| 281 | B2 |", "-| 281 | B |"]]]), false],
    ["mesmo número de decisão colide", lado("esta", "[F2] a", [["docs/DECISIONS.md", ["+| 280 | A |"]]]), lado("#2", "[F2] b", [["docs/DECISIONS.md", ["+| 280 | B |"]]]), true],
    ["mesmo número de migration colide", lado("esta", "[F1] a", [["supabase/migrations/0041_a.sql", ["+a"]]]), lado("#2", "[F1] b", [["supabase/migrations/0041_b.sql", ["+b"]]]), true],
    ["baseline em comum não colide", lado("esta", "[F2] a", [tela("apps/web/scripts/ui-audit.baseline.json")]), lado("#2", "[F2] b", [tela("apps/web/scripts/ui-audit.baseline.json")]), false],
    ["gerado em comum não colide", lado("esta", "[F2] a", [tela("docs/DATA-DICTIONARY.md")]), lado("#2", "[F1] b", [tela("docs/DATA-DICTIONARY.md")]), false],
    ["doc em que as duas só acrescentam não colide", lado("esta", "[F2] a", [["docs/UI-STANDARD.md", ["+## A"]]]), lado("#2", "[F2] b", [["docs/UI-STANDARD.md", ["+## B"]]]), false],
    ["doc com texto existente editado colide", lado("esta", "[F2] a", [["docs/UI-STANDARD.md", ["+a", "-b"]]]), lado("#2", "[F2] b", [["docs/UI-STANDARD.md", ["+c"]]]), true],
    ["globals.css nas duas colide", lado("esta", "[F2] a", [tela("apps/web/src/app/globals.css")]), lado("#2", "[F2] b", [tela("apps/web/src/app/globals.css")]), true]
  ];
  const falhas = [];
  for (const [nome, a, b, esperado] of casos) {
    const r = compararPar(a, b);
    if (r.colide !== esperado) falhas.push(`${nome}: esperava colide=${esperado}, obteve ${r.colide} (${r.motivos.join("; ")})`);
  }
  // A coluna banco/contrato nunca pode dizer "nenhum" quando um lado toca API: tem de mandar ler o diff.
  const api = compararPar(lado("esta", "[F2] a", [tela("apps/web/src/a.tsx")]), lado("#2", "[F1] b", [tela("apps/api/src/routes/x.ts")]));
  if (!api.verificar || !/LER O DIFF/.test(api.linha.contrato)) falhas.push("PR com API do outro lado não mandou ler o diff do contrato");
  const area = compararPar(lado("esta", "[F2] a", [tela("apps/web/src/features/sales/a.tsx")]), lado("#2", "[F2] b", [tela("apps/web/src/features/sales/b.tsx")]));
  if (area.colide || !area.verificar || !/features\/sales/.test(area.linha.contrato)) falhas.push("duas F2 na mesma feature sem arquivo em comum não mandaram ler o contrato");
  const longe = compararPar(lado("esta", "[F2] a", [tela("apps/web/src/features/sales/a.tsx")]), lado("#2", "[F2] b", [tela("apps/web/src/features/compras/b.tsx")]));
  if (longe.verificar) falhas.push("duas F2 em features diferentes foram mandadas ler o diff sem motivo");
  const ord = compararPar(lado("esta", "[F1] a", [["supabase/migrations/0042_a.sql", ["+a"]]]), lado("#2", "[F1] b", [["supabase/migrations/0041_b.sql", ["+b"]]]));
  if (!/esta entra depois de #2/.test(ord.linha.ordem)) falhas.push(`ordem de migration errada: ${ord.linha.ordem}`);
  const f2 = analisarDiff(diff([tela("apps/web/src/a.tsx"), tela("apps/api/src/x.ts"), tela("docs/A.md"), tela("scripts/x.mjs")]));
  const fora = foraDaFaixa("F2", f2.arquivos);
  if (fora.join() !== "apps/api/src/x.ts,scripts/x.mjs") falhas.push(`fronteira F2 errada: ${fora.join()}`);
  if (faixaDoTitulo("[F3] x") !== "F3" || faixaDoTitulo("F2 sem colchete") !== null) falhas.push("leitura de faixa do título errada");
  if (falhas.length) {
    console.error("mapa-colisao --autoteste: REPROVOU");
    for (const f of falhas) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`mapa-colisao --autoteste: OK (${casos.length} pares + banco/contrato, ordem, fronteira F2 e faixa)`);
}

// -------------------------------------------------------------------------------------------------
// LEITURA DO MUNDO — git local e `gh` (só leitura)
// -------------------------------------------------------------------------------------------------
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

function ladoLocal({ soCommitado, planejado, faixa }) {
  if (planejado) {
    // Antes de editar não há diff: supõe-se edição de texto existente, exceto onde a lei só admite a própria linha.
    const arquivos = new Map(planejado.map((f) => [f, { adicoes: 1, remocoes: SECAO_PROPRIA.has(f) ? 0 : 1 }]));
    return { id: "esta fatia (planejada)", faixa, arquivos, decisoes: new Set() };
  }
  const base = sh("git", ["merge-base", "HEAD", "origin/main"]).trim();
  const r = analisarDiff(soCommitado ? sh("git", ["diff", `${base}...HEAD`]) : sh("git", ["diff", base]));
  if (!soCommitado) {
    for (const f of sh("git", ["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean)) {
      if (!r.arquivos.has(f)) r.arquivos.set(f, { adicoes: 1, remocoes: 0 });
    }
  }
  return { id: "esta branch", faixa, ...r };
}

function prsAbertas() {
  const lista = JSON.parse(sh("gh", ["pr", "list", "--state", "open", "--limit", "200", "--json", "number,title,headRefName"]));
  return lista.map((p) => ({ id: `#${p.number}`, numero: p.number, titulo: p.title, branch: p.headRefName, faixa: faixaDoTitulo(p.title), ...analisarDiff(sh("gh", ["pr", "diff", String(p.number)])) }));
}

function tabela(linhas) {
  const out = ["| PR | faixa | arquivos em comum | números | banco | contrato | ordem de merge |", "|---|---|---|---|---|---|---|"];
  for (const l of linhas) out.push(`| ${l.pr} | ${l.faixa} | ${l.arquivos} | ${l.numeros} | ${l.banco} | ${l.contrato} | ${l.ordem} |`);
  return out.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--autoteste")) return autoteste();
  const valor = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const faixa = valor("--faixa")?.toUpperCase() ?? null;
  if (faixa && !/^F[123]$/.test(faixa)) { console.error("--faixa aceita F1, F2 ou F3 (a faixa vem do PROMPT da fatia)"); process.exit(2); }
  const planejado = valor("--planejado")?.split(",").map((s) => s.trim()).filter(Boolean);

  let abertas;
  try { abertas = prsAbertas(); }
  catch (e) {
    console.error(`mapa-colisao: não foi possível listar as PRs abertas (${String(e.stderr || e.message).split("\n")[0]}).`);
    console.error("Sem mapa, sem PR: confira `gh auth status` e rode de novo.");
    process.exit(2);
  }

  if (args.includes("--entre-abertas")) {
    let pior = 0;
    console.log(`## Colisão entre as ${abertas.length} PR(s) abertas\n`);
    if (abertas.length < 2) console.log("Menos de duas PRs abertas: nada a cruzar.");
    for (let i = 0; i < abertas.length; i++) {
      for (let j = i + 1; j < abertas.length; j++) {
        const r = compararPar(abertas[i], abertas[j]);
        const estado = r.colide ? "COLISÃO" : r.verificar ? "LER O DIFF" : "limpo";
        console.log(`- ${abertas[i].id} × ${abertas[j].id}: **${estado}**${r.motivos.length ? ` — ${r.motivos.join("; ")}` : ""}`);
        pior = Math.max(pior, r.colide ? 2 : r.verificar ? 1 : 0);
      }
    }
    process.exit([0, 3, 1][pior]);
  }

  const atual = sh("git", ["branch", "--show-current"]).trim();
  const minha = ladoLocal({ soCommitado: args.includes("--so-commitado"), planejado, faixa });
  const outras = abertas.filter((p) => p.branch !== atual);
  const propria = abertas.find((p) => p.branch === atual);

  console.log(`## MAPA DE COLISÃO (PRE-PR-02) — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC\n`);
  console.log(`Lado comparado: ${minha.id}${propria ? ` (PR ${propria.id})` : ""}, ${minha.arquivos.size} arquivo(s). PRs abertas além desta: ${outras.length}.\n`);
  const resultados = outras.map((p) => compararPar(minha, p));
  if (!outras.length) console.log(tabela([{ pr: "nenhuma PR aberta além desta", faixa: "—", arquivos: "—", numeros: "—", banco: "—", contrato: "—", ordem: "—" }]));
  else console.log(tabela(resultados.map((r) => r.linha)));

  const fora = faixa ? foraDaFaixa(faixa, minha.arquivos) : [];
  const quentes = hotspotsDe(minha.arquivos);
  const colisoes = resultados.filter((r) => r.colide);
  console.log("");
  if (!faixa) console.log("- Faixa não informada (`--faixa`): a fronteira não foi conferida. A faixa vem do prompt; sem ela, pare e pergunte.");
  if (fora.length) console.log(`- **FORA DA FAIXA ${faixa}:** ${fora.join(", ")}`);
  if (quentes.length) {
    console.log("- Arquivos compartilhados nesta fatia (onde a próxima PR visual vai colidir; componente genérico pede E2E das outras telas):");
    for (const q of quentes) console.log(`  - ${q}`);
  }
  for (const r of colisoes) console.log(`- **COLISÃO com ${r.linha.pr}:** ${r.motivos.join("; ")}. Não abra a PR: diga com qual e em quê, e pare.`);
  if (colisoes.length || fora.length) process.exit(1);
  if (resultados.some((r) => r.verificar)) { console.log("- Sem colisão de arquivo ou número. Há banco/contrato/seção a conferir no diff (coluna LER O DIFF) antes de declarar o mapa limpo."); process.exit(3); }
  console.log("- Sem colisão de arquivo, número, banco ou contrato contra as PRs abertas agora. Refaça antes de cada relatório.");
}

main();
