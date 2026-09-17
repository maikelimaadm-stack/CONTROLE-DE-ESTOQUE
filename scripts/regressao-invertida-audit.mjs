#!/usr/bin/env node
/**
 * ANTI-REGRESSÃO INVERTIDA — nenhum teste pode EXIGIR que um defeito continue existindo.
 *
 * POR QUE ESTE GATE EXISTE. Na BASE2-02, o E2E da variante de transferência esbarrou num defeito real
 * do caminho de escrita (numeração de `erp.warehouse_transfers` por dois contadores independentes para
 * uma coluna de código única) e passou a AFIRMAR a recusa 409, pelo nome da constraint, como
 * comportamento esperado. A intenção era registrar o bloqueio; o efeito era pior que o bloqueio:
 *
 *   · o defeito virava CONTRATO — a suíte verde passava a significar "o bug está lá, como combinado";
 *   · o dia da correção chegaria como "teste quebrado", e não como "teste que enfim pode ser escrito",
 *     empurrando quem consertasse a discutir com a própria suíte;
 *   · e a cobertura real da variante ficava ausente sem que nada ficasse vermelho.
 *
 * Bug conhecido se documenta e se corrige. O que NÃO se faz é escrevê-lo como asserção.
 *
 * O que este auditor recusa, nos testes: esperar um código de erro de servidor (409/422/500) ou o nome
 * de uma constraint do banco em conjunto com vocabulário que revela a intenção de congelar o defeito
 * ("defeito", "bug", "enquanto existir", "quando for corrigido", "reprova quando").
 *
 * Autoteste embutido: o gate se prova contra amostras sintéticas antes de auditar o repositório, para
 * que um gate quebrado não passe por gate satisfeito.
 */
import fs from "node:fs";
import path from "node:path";

const raiz = path.resolve(new URL(".", import.meta.url).pathname, "..");

/** Nome de constraint do banco citado literalmente num teste. */
const CONSTRAINT = /\b[a-z][a-z0-9_]*_(key|pkey|fkey|check)\b/;
/**
 * Código de erro de servidor afirmado como esperado. Precisa estar ANCORADO em `status` ou ser o valor
 * inteiro esperado de uma asserção — solto no texto, `\b500\b` casaria com o dinheiro "10.500,00" de um
 * teste de totais, e um gate que acusa o inocente é desligado na primeira semana.
 */
const STATUS = /status[^\n]{0,20}\b(409|422|500)\b|\b(?:toBe|toEqual)\((409|422|500)\)/;
/** Vocabulário que só aparece quando alguém está congelando um defeito conhecido. */
/**
 * Vocabulário que revela a intenção de congelar um defeito. Deliberadamente ESTREITO: "defeito" e
 * "bug" sozinhos são o idioma normal de comentário desta base ("o defeito real que este caso pega"),
 * e um gate que acusa o inocente é desligado na primeira semana. Por isso a intenção exige a FORMA
 * "enquanto/até o defeito existir" ou "quando for corrigido, reprova" — quem escreve isso está
 * dizendo que o teste depende da permanência do bug.
 */
const INTENCAO = /(enquanto|at[ée])\s+(o\s+)?(defeito|bug|blo(queio|cker))[^.\n]{0,40}(existir|viver|estiver)|quando\s+for\s+corrigid|assim\s+que\s+(o\s+)?(defeito|bug)[^.\n]{0,30}for\s+corrigid|(este|esse)\s+teste\s+(o\s+)?exige|deve\s+reprovar\s+quando|reprova\s+quando\s+(o\s+)?(defeito|bug)/i;

function ofensas(texto, arquivo) {
  const achados = [];
  const linhas = texto.split("\n");

  // Casamento por BLOCO, não por linha. Um `expect(...)` quebrado em várias linhas — que qualquer
  // formatador produz quando a linha estoura — tem o token de asserção numa linha e a constraint em
  // outra, e um gate linha-a-linha o deixaria passar inteiro. O bloco vai do `expect(` até o `;` que
  // o fecha, contando parênteses.
  for (let i = 0; i < linhas.length; i++) {
    if (!/\bexpect\s*\(/.test(linhas[i])) continue;
    // O bloco vai até o fim da INSTRUÇÃO, não do primeiro parêntese. `expect(x, "msg")` fecha os
    // parênteses na própria linha e continua com `.toContain(...)` na linha de baixo — parar no saldo
    // zero deixaria a constraint de fora, e foi assim que a primeira versão deste gate não pegou o
    // caso que o originou (verificação reversa contra o spec de 70b4c33).
    let saldo = 0, fim = i;
    for (let j = i; j < Math.min(linhas.length, i + 20); j++) {
      for (const ch of linhas[j]) { if (ch === "(") saldo++; else if (ch === ")") saldo--; }
      fim = j;
      const terminou = saldo <= 0 && /;\s*$/.test(linhas[j].replace(/\/\/.*$/, "").trimEnd());
      if (terminou) break;
      // encadeamento pendente (`)` seguido de `.algo` na próxima linha) mantém o bloco aberto
      if (saldo <= 0 && !/^\s*\./.test(linhas[j + 1] ?? "")) break;
    }
    const bloco = linhas.slice(i, fim + 1).join("\n");
    if (!(CONSTRAINT.test(bloco) || STATUS.test(bloco))) continue;

    // A intenção pode estar no bloco ou no comentário que o antecede. A janela é generosa (30 linhas)
    // porque o comentário que explica "por que este teste exige o defeito" costuma ser um parágrafo
    // inteiro acima da asserção — foi exatamente o caso que originou este gate.
    const vizinhanca = linhas.slice(Math.max(0, i - 30), fim + 1).join("\n");
    if (INTENCAO.test(vizinhanca)) achados.push(`${arquivo}:${i + 1}: ${linhas[i].trim().slice(0, 110)}`);
    i = fim;
  }
  return achados;
}

// ---------- autoteste: quebre, veja reprovar; restaure, veja passar ----------
// As amostras cobrem a FORMA REAL do defeito que originou o gate, não só o caso fácil de uma linha:
// comentário longe da asserção, e asserção quebrada em várias linhas pelo formatador.
const AMOSTRAS = [
  ["comentário 14 linhas acima + asserção de uma linha", 1, `
  // A VARIANTE, e por que o outro lado fica de fora.
  //
  // Existe um defeito no caminho de escrita: dois contadores independentes para uma coluna única.
  // Enquanto o defeito existir, este teste o exige pelo nome da constraint; no dia em que for
  // corrigido, ele reprova e obriga a troca pela prova positiva.
  //
  // (mais prosa)
  // (mais prosa)
  // (mais prosa)
  // (mais prosa)
  // (mais prosa)
  // (mais prosa)
  const recusa = await criar().then(() => null, (e) => e.message);
  expect(recusa).toContain("warehouse_transfers_organization_id_code_key");
`],
  ["mensagem fecha os parênteses e .toContain vem na linha seguinte (a forma que escapou)", 1, `
  // O bloqueio fica MECÂNICO em vez de virar um TODO em prosa: enquanto o defeito existir este teste
  // o EXIGE; no dia em que for corrigido, ele reprova, e quem corrigir troca esta asserção.
  expect(recusa, "a transferência precisa ter sido TENTADA de verdade").toBeTruthy();
  expect(recusa, "bloqueio declarado: numeração duplicada por dois contadores independentes")
    .toContain("warehouse_transfers_organization_id_code_key");
`],
  ["asserção multilinha, constraint em outra linha", 1, `
  // enquanto o bug existir este teste o exige
  expect(recusa).toContain(
    "warehouse_transfers_organization_id_code_key"
  );
`],
  ["status esperado legítimo: contrato manda recusar entrada não canônica", 0, `
  // o servidor recusa contrato legado explicitamente
  expect(resposta.status).toBe(422);
`],
  ["constraint citada em teste legítimo de invariante", 0, `
  // a purga não pode deixar o check cair
  expect(constraints).toContain("equipment_transfers_empresa_origem_destino_check");
`],
  ["dinheiro que parece status", 0, `
  // o defeito real que este caso pega: o rodapé mentia o total
  await expect(campoTotal).toContainText("10.500,00");
`]
];
for (const [nome, esperado, amostra] of AMOSTRAS) {
  const n = ofensas(amostra, "autoteste").length;
  if (n !== esperado) {
    console.error(`regressao-invertida-audit: AUTOTESTE FALHOU — "${nome}": esperava ${esperado} ofensa(s), obteve ${n}.`);
    process.exit(1);
  }
}

// ---------- auditoria ----------
const alvos = [];
const varrer = (dir) => {
  for (const nome of fs.readdirSync(dir, { withFileTypes: true })) {
    if (nome.name === "node_modules" || nome.name.startsWith(".")) continue;
    const p = path.join(dir, nome.name);
    if (nome.isDirectory()) varrer(p);
    else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(nome.name)) alvos.push(p);
  }
};
const BASES = ["apps", "packages", "scripts"];
for (const base of BASES) {
  const d = path.join(raiz, base);
  if (!fs.existsSync(d)) {
    console.error(`regressao-invertida-audit: diretório "${base}" não encontrado a partir de ${raiz}.`);
    console.error("Gate que não acha o que auditar não está satisfeito — está desligado.");
    process.exit(1);
  }
  varrer(d);
}

// PISO. Sem isto, um `raiz` resolvido errado (caminho com espaço ou acento, script movido de pasta)
// produziria "OK (0 arquivos de teste)" e CI verde com o gate inerte — o "verde que não prova nada"
// que este repositório trata como REPROVAÇÃO. O piso é folgado de propósito: trava a falha
// catastrófica de varredura sem quebrar a cada teste removido.
const PISO = 50;
if (alvos.length < PISO) {
  console.error(`regressao-invertida-audit: só ${alvos.length} arquivo(s) de teste encontrado(s), piso é ${PISO}.`);
  console.error("Varredura vazia ou quase vazia indica raiz errada, não repositório sem testes.");
  process.exit(1);
}

// ---------- byte de controle cru no fonte ----------
/**
 * NUL cru num arquivo de código faz `grep`/`ripgrep` classificarem o fonte como BINÁRIO e pularem o
 * arquivo inteiro. Aconteceu de verdade nesta fatia: o SSOT do Tipo de Operação usava um NUL literal
 * como separador de chave de índice e, por isso, ficou invisível para toda busca textual — humana ou
 * de agente — enquanto o diff mostrava o separador como se fosse um espaço comum.
 * O separador continua sendo NUL (nome de tabela não contém NUL); o que se exige é que seja ESCRITO
 * como escape (`\u0000`), visível no fonte e no diff.
 */
const FONTES = [];
const varrerFonte = (dir) => {
  for (const nome of fs.readdirSync(dir, { withFileTypes: true })) {
    if (nome.name === "node_modules" || nome.name === "dist" || nome.name.startsWith(".")) continue;
    const q = path.join(dir, nome.name);
    if (nome.isDirectory()) varrerFonte(q);
    else if (/\.([cm]?[jt]sx?|json|md|sql)$/.test(nome.name)) FONTES.push(q);
  }
};
for (const base of BASES.concat(["docs", "supabase"])) {
  const d = path.join(raiz, base);
  if (fs.existsSync(d)) varrerFonte(d);
}
const comNul = FONTES.filter((f) => fs.readFileSync(f).includes(0)).map((f) => path.relative(raiz, f));
if (comNul.length) {
  console.error("regressao-invertida-audit: byte NUL cru em arquivo de código\n");
  for (const f of comNul) console.error("  - " + f);
  console.error("\ngrep e ripgrep tratam o arquivo como binário e o PULAM inteiro: o arquivo fica");
  console.error("invisível para toda busca textual. Escreva o caractere como escape (\\u0000).");
  process.exit(1);
}

const todas = alvos.flatMap((p) => ofensas(fs.readFileSync(p, "utf8"), path.relative(raiz, p)));
if (todas.length) {
  console.error("regressao-invertida-audit: teste EXIGINDO a permanência de um defeito\n");
  for (const o of todas) console.error("  - " + o);
  console.error("\nBug conhecido se documenta e se corrige; nunca vira asserção. Remova a expectativa,");
  console.error("mantenha a cobertura positiva do que funciona e registre o defeito na documentação.");
  process.exit(1);
}
console.log(`regressao-invertida-audit: OK (autoteste ${AMOSTRAS.length}/${AMOSTRAS.length}; ${alvos.length} arquivos de teste, nenhuma asserção exigindo defeito; ${FONTES.length} fontes sem byte de controle cru)`);
