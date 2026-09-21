#!/usr/bin/env node
/**
 * DÍVIDA DECLARADA TEM DE CONTINUAR EXECUTÁVEL.
 *
 * POR QUE ESTE GATE EXISTE. `docs/UI-SUPPORT-MATRIX.md` tira mobile do gate obrigatório. Isso é uma
 * decisão de produto legítima — e é também a porta exata por onde "não é escopo agora" vira "ninguém
 * nunca mais viu". A diferença entre ADIAR e ESQUECER não está no documento: está em o teste continuar
 * existindo, marcado, e falhando alto quando alguém o roda.
 *
 * Sem este gate, TRÊS caminhos silenciosos ficariam abertos, e nenhum deles quebraria nada:
 *   - apagar o teste da suíte mobile — a dívida some do repositório e o documento continua afirmando
 *     que ela é "reproduzível";
 *   - marcar `.skip`/`.fixme` — `pnpm e2e:mobile` fica VERDE, e verde vazio lê-se como resolvido;
 *   - afrouxar a asserção, inflar timeout ou usar `force: true` — o teste passa sem o defeito ter
 *     sido consertado, que é a forma mais cara de mentira porque parece prova.
 *
 * O QUE ELE CONFERE, para cada débito declarado na tabela do documento:
 *   1. o arquivo existe;
 *   2. o débito aparece lá dentro, com a etiqueta declarada;
 *   3. não está pulado (`.skip`, `.fixme`, `test.fail`) nem condicionalmente pulado;
 *   4. não tem os afrouxamentos típicos de quem quer esconder o vermelho;
 *   5. a suíte obrigatória EXCLUI a etiqueta e a suíte da dívida a INCLUI — senão a separação existe
 *      só no texto, e o gate obrigatório voltaria a carregar (ou a perder) a dívida sem ninguém notar.
 *
 * O QUE ELE NÃO FAZ. Não roda teste e não julga se o defeito ainda existe: isso é papel de
 * `pnpm e2e:mobile`. Aqui se confere que a dívida continua VERSIONADA, MARCADA e EXECUTÁVEL.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MATRIZ = "docs/UI-SUPPORT-MATRIX.md";

/** Afrouxamentos que transformam um vermelho honesto num verde sem lastro. */
const AFROUXAMENTOS = [
  { re: /\.(skip|fixme)\s*\(/, nome: "`.skip`/`.fixme`" },
  { re: /test\.fail\s*\(/, nome: "`test.fail`" },
  { re: /\bforce:\s*true/, nome: "`force: true`" },
  { re: /\btimeout:\s*\d{6,}/, nome: "timeout inflado (≥ 100000ms)" }
];

/**
 * Comentário não é código. Um bloco que EXPLICA "aqui não há `.skip` nem `force: true`" seria acusado
 * pela própria explicação — e o conserto seria apagar a explicação, que é o oposto do que se quer.
 * Não é um parser: o erro possível é para o lado seguro (deixar de ver), e a forma que importa
 * (uma chamada real) não mora dentro de comentário.
 */
export function semComentarios(texto) {
  return texto.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/** Lê a tabela entre os marcadores. Fora deles o documento é prosa, e prosa não é contrato. */
export function debitosDeclarados(markdown) {
  const bloco = markdown.split("<!-- DEBITOS:INICIO -->")[1]?.split("<!-- DEBITOS:FIM -->")[0];
  if (bloco === undefined) return null;                        // marcadores ausentes = contrato ilegível
  const linhas = bloco.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("|"));
  const saida = [];
  for (const linha of linhas) {
    const c = linha.split("|").slice(1, -1).map((s) => s.trim().replace(/^`|`$/g, ""));
    if (c.length < 4) continue;
    if (/^-+$/.test(c[0]) || c[0] === "Débito") continue;      // cabeçalho e separador
    saida.push({ debito: c[0], arquivo: c[1], etiqueta: c[2] });
  }
  return saida;
}

/** As ofensas de UM débito. Devolve lista para o autoteste poder contar. */
export function ofensasDoDebito(deb, bruto) {
  const o = [];
  if (bruto === null) { o.push(`${deb.debito}: arquivo ${deb.arquivo} não existe — a dívida deixou de ser executável`); return o; }
  const conteudo = semComentarios(bruto);
  if (!conteudo.includes(deb.debito)) o.push(`${deb.debito}: não aparece em ${deb.arquivo} — foi removido, e dívida removida vira esquecimento`);
  if (!conteudo.includes(deb.etiqueta)) o.push(`${deb.debito}: sem a etiqueta ${deb.etiqueta} em ${deb.arquivo} — sai da suíte da dívida sem entrar em nenhuma outra`);
  for (const a of AFROUXAMENTOS) if (a.re.test(conteudo)) o.push(`${deb.debito}: ${a.nome} em ${deb.arquivo} — o vermelho da dívida não se esconde, se conserta`);
  return o;
}

/** A separação das suítes tem de existir nos SCRIPTS, não só no texto do documento. */
export function ofensasDosScripts(scriptsWeb, etiquetas) {
  const o = [];
  const obrig = scriptsWeb.e2e ?? "";
  const divida = scriptsWeb["e2e:mobile"] ?? "";
  if (!divida) o.push("script `e2e:mobile` ausente — a dívida não teria como ser executada");
  for (const et of etiquetas) {
    if (!obrig.includes(`--grep-invert`) || !obrig.includes(et)) o.push(`script \`e2e\` não exclui ${et} — a dívida voltaria a bloquear a entrega do escopo suportado`);
    if (divida && !(divida.includes("--grep") && divida.includes(et))) o.push(`script \`e2e:mobile\` não seleciona ${et} — a suíte da dívida rodaria outra coisa`);
  }
  return o;
}

// ---------- autoteste: quebre, veja reprovar; restaure, veja passar ----------
const DEB = { debito: "UX15", arquivo: "x.spec.ts", etiqueta: "@mobile" };
const OK = `test.describe("UX15 — celular", { tag: "@mobile" }, () => {});`;
const AMOSTRAS = [
  ["íntegro", () => ofensasDoDebito(DEB, OK), 0],
  ["arquivo sumiu", () => ofensasDoDebito(DEB, null), 1],
  ["débito removido do arquivo", () => ofensasDoDebito(DEB, `test.describe("outro", { tag: "@mobile" }, () => {});`), 1],
  ["etiqueta removida", () => ofensasDoDebito(DEB, `test.describe("UX15 — celular", () => {});`), 1],
  ["marcado skip", () => ofensasDoDebito(DEB, OK.replace("test.describe(", "test.describe.skip(")), 1],
  ["marcado fixme", () => ofensasDoDebito(DEB, OK + "\ntest.fixme(true);"), 1],
  ["test.fail", () => ofensasDoDebito(DEB, OK + "\ntest.fail();"), 1],
  ["force click", () => ofensasDoDebito(DEB, OK + "\nawait b.click({ force: true });"), 1],
  ["timeout inflado", () => ofensasDoDebito(DEB, OK + "\ntest.setTimeout({ timeout: 999999 });"), 1],
  ["scripts íntegros", () => ofensasDosScripts({ e2e: "playwright test --grep-invert @mobile", "e2e:mobile": "playwright test --grep @mobile" }, ["@mobile"]), 0],
  ["obrigatória não exclui", () => ofensasDosScripts({ e2e: "playwright test", "e2e:mobile": "playwright test --grep @mobile" }, ["@mobile"]), 1],
  // UMA ofensa, não duas: sem o script não há o que auditar dentro dele, e repetir a mesma causa em
  // duas linhas faz o relatório parecer dois problemas independentes.
  ["suíte da dívida ausente", () => ofensasDosScripts({ e2e: "playwright test --grep-invert @mobile" }, ["@mobile"]), 1],
  ["tabela sem marcadores", () => (debitosDeclarados("# sem marcadores") === null ? ["x"] : []), 1],
  ["tabela lida", () => (debitosDeclarados(`<!-- DEBITOS:INICIO -->\n| Débito | Arquivo | Etiqueta | Estado |\n|---|---|---|---|\n| \`UX15\` | \`a.ts\` | \`@mobile\` | x |\n<!-- DEBITOS:FIM -->`).length === 1 ? [] : ["x"]), 0]
];
for (const [nome, fn, esperado] of AMOSTRAS) {
  const n = fn().length;
  if (n !== esperado) {
    console.error(`ui-support-matrix-audit: AUTOTESTE FALHOU — "${nome}": esperava ${esperado} ofensa(s), obteve ${n}.`);
    process.exit(2);
  }
}

// ---------- auditoria real ----------
const caminhoMatriz = path.join(raiz, MATRIZ);
if (!fs.existsSync(caminhoMatriz)) {
  console.error(`ui-support-matrix-audit: ${MATRIZ} não existe.\n\nA matriz de suporte é o DONO da decisão de quais formatos bloqueiam entrega.`);
  console.error("Sem ela, 'mobile está fora do gate' não é contrato: é hábito.");
  process.exit(1);
}
const debitos = debitosDeclarados(fs.readFileSync(caminhoMatriz, "utf8"));
if (debitos === null) {
  console.error(`ui-support-matrix-audit: marcadores DEBITOS:INICIO/FIM ausentes em ${MATRIZ}.`);
  process.exit(1);
}

const ofensas = [];
for (const d of debitos) {
  const p = path.join(raiz, d.arquivo);
  ofensas.push(...ofensasDoDebito(d, fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null));
}
const scriptsWeb = JSON.parse(fs.readFileSync(path.join(raiz, "apps/web/package.json"), "utf8")).scripts ?? {};
ofensas.push(...ofensasDosScripts(scriptsWeb, [...new Set(debitos.map((d) => d.etiqueta))]));

if (ofensas.length) {
  console.error("ui-support-matrix-audit: dívida declarada deixou de ser executável\n");
  for (const o of ofensas) console.error("  - " + o);
  console.error(`\nUm formato DEFERRED em ${MATRIZ} continua com dívida VERSIONADA, MARCADA e EXECUTÁVEL.`);
  console.error("Adiar é decisão de produto; apagar a evidência não é adiar, é esquecer.");
  console.error("Para encerrar uma dívida: conserte o defeito e remova a linha da tabela — nessa ordem.");
  process.exit(1);
}
console.log(`ui-support-matrix-audit: OK (autoteste ${AMOSTRAS.length}/${AMOSTRAS.length}; ${debitos.length} débito(s) DEFERRED declarado(s), versionado(s), etiquetado(s) e fora do gate obrigatório)`);
