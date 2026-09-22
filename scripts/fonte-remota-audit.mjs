#!/usr/bin/env node
/**
 * TODA BUSCA REMOTA EM TEMPO DE BUILD TEM DE ESTAR DECLARADA — E A CONTA SÓ DIMINUI.
 *
 * POR QUE ESTE GATE EXISTE. Um `next build` que busca na internet deixa de ser determinístico, e a
 * dependência é INVISÍVEL enquanto o terceiro responde sempre igual. Em 2026-09-22 o Google Fonts
 * respondeu diferente (≈3% das vezes ele devolve a URL na forma `…/l/font?kit=…&skey=…&v=…`, cujos
 * `&` o Turbopack não consegue reabrir) e o CI acusou "Version skew — FAILURE", afirmando uma
 * reprovação de compatibilidade que nunca aconteceu. A medição inteira mora em
 * `docs/BUILD-DEPENDENCIA-REMOTA.md`; este arquivo não a recopia.
 *
 * O QUE ELE CONFERE — duas direções, porque uma só deixa metade do buraco aberto:
 *   1. toda família importada de `next/font/google` no código está DECLARADA na tabela do documento;
 *      sem isso, a segunda fonte entraria amanhã e o raio de exposição documentado envelheceria em
 *      silêncio — que é como uma dívida medida vira uma dívida esquecida;
 *   2. toda família DECLARADA ainda existe no código; sem isso, a tabela viraria um cemitério, e o
 *      dia em que a dívida for encerrada de verdade ficaria indistinguível de mais um dia com ela.
 *
 * A CATRACA. A contagem aparece na linha verde e só pode DIMINUIR. Ela chega a zero quando
 * `FONTE-LOCAL-01` servir a fonte do próprio projeto — e aí o gate passa a provar, todo dia, que
 * nenhum build deste repositório precisa da rede.
 *
 * O QUE ELE NÃO FAZ, e não adianta esperar que faça:
 *   - não constrói nada e não fala com o Google: ele lê arquivo;
 *   - não detecta busca remota escrita à mão (um `fetch()` dentro de `next.config.ts`, um script de
 *     `postinstall` que baixa algo). Ele conhece UMA forma: o import de `next/font/google`. Ampliar
 *     para "qualquer rede em qualquer lugar" exigiria entender o programa, e um gate que promete
 *     isso e não entrega é pior do que não existir — porque ninguém mais olha;
 *   - não julga se a dívida vale a pena. Isso é decisão de produto, e está escrita no documento.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { semComentarios } from "./lib/sem-comentarios.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOC = "docs/BUILD-DEPENDENCIA-REMOTA.md";
const ORIGEM = "apps/web/src";

/**
 * As famílias importadas de `next/font/google`, fora de comentário.
 *
 * `semComentarios` não é zelo: este próprio repositório tem documentação que CITA `next/font/google`
 * em prosa (o documento do §1, o diagnóstico, os comentários deste arquivo). Um auditor que acusasse
 * a própria documentação ensinaria a apagar a documentação — já custou uma reprovação boba antes.
 *
 * @returns {Array<{ familia: string, arquivo: string }>}
 */
export function familiasImportadas(arquivos) {
  const achados = [];
  for (const { arquivo, conteudo } of arquivos) {
    const codigo = semComentarios(conteudo);
    // `import { DM_Sans, Inter } from "next/font/google"` — aspas simples ou duplas, uma ou mais famílias.
    const re = /import\s*\{([^}]+)\}\s*from\s*["']next\/font\/google["']/g;
    for (const m of codigo.matchAll(re)) {
      for (const bruto of m[1].split(",")) {
        // `DM_Sans as Fonte` → a família é o nome de ORIGEM; o apelido local não identifica nada.
        const familia = bruto.trim().split(/\s+as\s+/)[0].trim();
        if (familia) achados.push({ familia, arquivo });
      }
    }
  }
  return achados;
}

/** Lê a tabela entre os marcadores. Fora deles o documento é prosa, e prosa não é contrato. */
export function dependenciasDeclaradas(markdown) {
  const bloco = markdown.split("<!-- DEPENDENCIAS:INICIO -->")[1]?.split("<!-- DEPENDENCIAS:FIM -->")[0];
  if (bloco === undefined) return null;                        // marcadores ausentes = contrato ilegível
  const saida = [];
  for (const linha of bloco.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("|"))) {
    const c = linha.split("|").slice(1, -1).map((s) => s.trim().replace(/^`|`$/g, ""));
    if (c.length < 4) continue;
    if (c[0] === "Família" || /^-+$/.test(c[0])) continue;      // cabeçalho e separador da tabela
    saida.push({ familia: c[0], arquivo: c[1], servico: c[2], fatia: c[3] });
  }
  return saida;
}

/**
 * A comparação, PURA — é ela que carrega a regra "os dois sentidos", e uma regra que só pudesse ser
 * exercitada acrescentando uma fonte de verdade ao produto não teria como ser provada por teste.
 */
export function ofensas(importadas, declaradas) {
  const o = [];
  const decl = new Map(declaradas.map((d) => [d.familia, d]));
  const imp = new Map(importadas.map((i) => [i.familia, i]));

  for (const i of importadas) {
    const d = decl.get(i.familia);
    if (!d) { o.push(`\`${i.familia}\` é buscada em tempo de build (${i.arquivo}) e NÃO está declarada em ${DOC}`); continue; }
    if (d.arquivo !== i.arquivo) o.push(`\`${i.familia}\`: ${DOC} diz \`${d.arquivo}\`, o código a importa em \`${i.arquivo}\``);
    if (!d.fatia) o.push(`\`${i.familia}\` está declarada sem a fatia que a encerra — dívida sem condição de saída não é dívida, é estado`);
  }
  for (const d of declaradas) {
    if (!imp.has(d.familia)) o.push(`${DOC} declara \`${d.familia}\`, que não é mais importada de \`next/font/google\` — se a dívida foi encerrada, remova a linha da tabela`);
  }
  return o;
}

function arquivosDeCodigo(dir) {
  const saida = [];
  const andar = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { andar(p); continue; }
      if (!/\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) continue;
      saida.push({ arquivo: path.relative(raiz, p), conteudo: fs.readFileSync(p, "utf8") });
    }
  };
  andar(dir);
  return saida;
}

// -------------------------------------------------------------------------------------------------
// AUTOTESTE — o gate nasce provando que REPROVA.
//
// Sem isto, um auditor que sempre passa é indistinguível de um auditor quebrado; e como o caso feliz
// deste gate é "uma família, declarada, tudo certo", ele passaria igualzinho com a comparação
// invertida, com o laço vazio ou com `ofensas` devolvendo `[]` sempre.
// -------------------------------------------------------------------------------------------------
const AMOSTRAS = [
  { nome: "declarada e importada: sem ofensa",
    imp: [{ familia: "DM_Sans", arquivo: "apps/web/src/app/layout.tsx" }],
    dec: [{ familia: "DM_Sans", arquivo: "apps/web/src/app/layout.tsx", servico: "x", fatia: "FONTE-LOCAL-01" }], esperado: 0 },
  { nome: "fonte NOVA sem declaração: o raio de exposição envelheceria em silêncio",
    imp: [{ familia: "DM_Sans", arquivo: "a.tsx" }, { familia: "Inter", arquivo: "b.tsx" }],
    dec: [{ familia: "DM_Sans", arquivo: "a.tsx", servico: "x", fatia: "FONTE-LOCAL-01" }], esperado: 1 },
  { nome: "declarada e já removida do código: tabela vira cemitério",
    imp: [], dec: [{ familia: "DM_Sans", arquivo: "a.tsx", servico: "x", fatia: "FONTE-LOCAL-01" }], esperado: 1 },
  { nome: "arquivo divergente entre documento e código",
    imp: [{ familia: "DM_Sans", arquivo: "novo.tsx" }],
    dec: [{ familia: "DM_Sans", arquivo: "antigo.tsx", servico: "x", fatia: "FONTE-LOCAL-01" }], esperado: 1 },
  { nome: "declarada sem fatia de encerramento",
    imp: [{ familia: "DM_Sans", arquivo: "a.tsx" }],
    dec: [{ familia: "DM_Sans", arquivo: "a.tsx", servico: "x", fatia: "" }], esperado: 1 },
  { nome: "dívida ENCERRADA: zero dos dois lados é o estado de chegada, não ofensa",
    imp: [], dec: [], esperado: 0 }
];

const AMOSTRAS_DE_LEITURA = [
  { nome: "import simples", codigo: 'import { DM_Sans } from "next/font/google";', esperado: ["DM_Sans"] },
  { nome: "duas famílias no mesmo import", codigo: "import { DM_Sans, Inter } from 'next/font/google';", esperado: ["DM_Sans", "Inter"] },
  { nome: "apelido local não muda a família", codigo: 'import { DM_Sans as Fonte } from "next/font/google";', esperado: ["DM_Sans"] },
  { nome: "citação em COMENTÁRIO não é uso", codigo: '// import { Inter } from "next/font/google";\nconst x = 1;', esperado: [] },
  { nome: "next/font/local não busca na rede", codigo: 'import localFont from "next/font/local";', esperado: [] }
];

for (const a of AMOSTRAS) {
  const n = ofensas(a.imp, a.dec).length;
  if (n !== a.esperado) {
    console.error(`fonte-remota-audit: AUTOTESTE FALHOU — "${a.nome}": esperava ${a.esperado} ofensa(s), obteve ${n}.`);
    process.exit(2);
  }
}
for (const a of AMOSTRAS_DE_LEITURA) {
  const obtido = familiasImportadas([{ arquivo: "amostra.tsx", conteudo: a.codigo }]).map((x) => x.familia);
  if (JSON.stringify(obtido) !== JSON.stringify(a.esperado)) {
    console.error(`fonte-remota-audit: AUTOTESTE FALHOU — "${a.nome}": esperava ${JSON.stringify(a.esperado)}, obteve ${JSON.stringify(obtido)}.`);
    process.exit(2);
  }
}

// ---------- auditoria real ----------
const caminhoDoc = path.join(raiz, DOC);
if (!fs.existsSync(caminhoDoc)) {
  console.error(`fonte-remota-audit: ${DOC} não existe.`);
  console.error("Ele é o DONO do que este build busca na rede. Sem ele, a dependência volta a ser invisível.");
  process.exit(1);
}
const declaradas = dependenciasDeclaradas(fs.readFileSync(caminhoDoc, "utf8"));
if (declaradas === null) {
  console.error(`fonte-remota-audit: marcadores DEPENDENCIAS:INICIO/FIM ausentes em ${DOC}.`);
  process.exit(1);
}
const importadas = familiasImportadas(arquivosDeCodigo(path.join(raiz, ORIGEM)));
const problemas = ofensas(importadas, declaradas);

if (problemas.length) {
  console.error("fonte-remota-audit: dependência remota de build fora de contrato\n");
  for (const p of problemas) console.error("  - " + p);
  console.error(`\nUm build que busca na internet depende de um terceiro que ninguém aqui versiona.`);
  console.error(`Enquanto essa dependência existir, ela fica DECLARADA em ${DOC}, com raio de exposição e condição de saída.`);
  console.error("Para encerrar: sirva a fonte do próprio projeto e SÓ ENTÃO remova a linha da tabela — nessa ordem.");
  process.exit(1);
}
const total = AMOSTRAS.length + AMOSTRAS_DE_LEITURA.length;
console.log(`fonte-remota-audit: OK (autoteste ${total}/${total}; ${declaradas.length} busca(s) remota(s) em tempo de build, todas declaradas — a conta só diminui)`);
