#!/usr/bin/env node
/**
 * NENHUM BUILD DESTE REPOSITÓRIO BUSCA FONTE NA REDE. ESTE GATE PROVA ISSO TODO DIA.
 *
 * POR QUE ELE EXISTE. `next/font/google` busca a folha de estilo em fonts.googleapis.com em TEMPO DE
 * BUILD. Um build que depende de terceiro não é determinístico, e a dependência fica INVISÍVEL
 * enquanto o terceiro responde sempre igual. Em 2026-09-22 o Google respondeu diferente — devolveu as
 * URLs na forma `…/l/font?kit=…&skey=…&v=…`, cujos dois `&` quebram o round-trip de query do
 * Turbopack — e o `next build` morreu com "next/font/google queries have exactly one entry". O CI
 * exibiu "Version skew · FAILURE", afirmando uma reprovação de compatibilidade que nunca aconteceu.
 * E ficar SEM rede também reprova: em `next build` a falha de fetch é erro, não aviso.
 *
 * A dívida foi FECHADA em `FONTE-LOCAL-01`: a DM Sans passou a ser servida do próprio projeto, a
 * partir de `@fontsource-variable/dm-sans` (OFL-1.1, congelado no lockfile), via `next/font/local`.
 * O histórico do incidente mora em `docs/BUILD-DEPENDENCIA-REMOTA.md`; este arquivo não o recopia.
 *
 * O QUE ELE CONFERE, e é uma coisa só: ZERO import de `next/font/google` em `apps/web/src`.
 * A afirmação é pequena de propósito. Um gate que prometesse "nenhuma rede em lugar nenhum"
 * precisaria entender o programa inteiro, e gate que promete o que não entrega é pior que gate
 * nenhum — ninguém mais olha para ele.
 *
 * O QUE ELE NÃO FAZ: não constrói nada, não fala com o Google, não detecta busca remota escrita à
 * mão (um `fetch()` em `next.config.ts`, um `postinstall` que baixa algo). Ele conhece UMA forma, a
 * que causou o incidente, e diz isso em voz alta em vez de fingir cobertura.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { semComentarios } from "./lib/sem-comentarios.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGEM = "apps/web/src";

/**
 * As formas de trazer `next/font/google` para dentro de um módulo. Três, porque uma só deixaria as
 * outras duas passando — e quem reintroduz a dependência raramente escolhe a forma que o gate conhece.
 */
export const FORMAS_DE_IMPORTAR = [
  /from\s*["'`]next\/font\/google["'`]/,
  /require\(\s*["'`]next\/font\/google["'`]\s*\)/,
  /import\(\s*["'`]next\/font\/google["'`]\s*\)/
];

/**
 * Os arquivos que importam a fonte remota.
 *
 * `semComentarios` não é zelo: este repositório DOCUMENTA em prosa exatamente o que proíbe — o
 * cabeçalho acima cita `next/font/google` quatro vezes, e o comentário de `layout.tsx` explica por
 * que a dependência saiu. Um auditor que acusasse a própria documentação ensinaria a apagá-la, e
 * isso já custou uma reprovação boba nesta mesma fatia.
 */
export function arquivosComFonteRemota(textoPorArquivo) {
  return Object.entries(textoPorArquivo)
    .filter(([, texto]) => FORMAS_DE_IMPORTAR.some((forma) => forma.test(semComentarios(texto))))
    .map(([arquivo]) => arquivo)
    .sort();
}

function varrer(dir, achados = {}) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) varrer(completo, achados);
    else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(entrada.name)) achados[path.relative(raiz, completo)] = fs.readFileSync(completo, "utf8");
  }
  return achados;
}

/**
 * AUTOTESTE — o gate nasce provando que RECUSA, nas duas direções.
 *
 * Sem o caso vermelho, um auditor que nunca acusasse nada seria indistinguível de um auditor
 * correto: a tela verde seria a mesma. Sem o caso verde, bastaria um falso positivo para o gate
 * virar ruído e ser desligado na primeira semana.
 */
const AMOSTRAS = [
  { nome: "import estático", texto: 'import { DM_Sans } from "next/font/google";', esperado: true },
  { nome: "import com aspas simples", texto: "import {Inter} from 'next/font/google'", esperado: true },
  { nome: "require", texto: 'const f = require("next/font/google");', esperado: true },
  { nome: "import dinâmico", texto: 'await import("next/font/google")', esperado: true },
  { nome: "next/font/local (a solução)", texto: 'import localFont from "next/font/local";', esperado: false },
  { nome: "citação em comentário de linha", texto: '// era next/font/google antes de FONTE-LOCAL-01', esperado: false },
  { nome: "citação em bloco de comentário", texto: '/* from "next/font/google" — histórico */', esperado: false },
  { nome: "arquivo sem fonte nenhuma", texto: 'export const x = 1;', esperado: false }
];

function autoteste() {
  const falhas = AMOSTRAS.filter((a) => (arquivosComFonteRemota({ "amostra.ts": a.texto }).length > 0) !== a.esperado);
  if (falhas.length) {
    console.error(`fonte-remota-audit: AUTOTESTE FALHOU em ${falhas.map((f) => f.nome).join(", ")}`);
    process.exit(1);
  }
  return AMOSTRAS.length;
}

const amostras = autoteste();
const ofensas = arquivosComFonteRemota(varrer(path.join(raiz, ORIGEM)));

if (ofensas.length) {
  console.error("fonte-remota-audit: BUSCA DE FONTE NA REDE EM TEMPO DE BUILD\n");
  for (const arquivo of ofensas) console.error(`  ${arquivo} importa next/font/google`);
  console.error(`
  Isso faz o \`next build\` depender de fonts.googleapis.com. A dependência é invisível enquanto o
  Google responde igual, e derruba o build quando ele responde na forma dinâmica — ou quando a rede
  oscila, porque em \`next build\` a falha de fetch é ERRO, não aviso.

  A solução já está no repositório: \`next/font/local\` sobre um pacote de fonte congelado no
  lockfile (ver \`apps/web/src/app/layout.tsx\`). Se precisar de uma família nova, acrescente o
  pacote dela — não volte para a busca remota.

  Histórico e medição: docs/BUILD-DEPENDENCIA-REMOTA.md`);
  process.exit(1);
}

console.log(`fonte-remota-audit: OK (autoteste ${amostras}/${amostras}; REMOTE_FONT_BUILD_DEPENDENCIES = 0 em ${ORIGEM})`);
