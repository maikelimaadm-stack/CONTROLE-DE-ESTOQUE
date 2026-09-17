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
const INTENCAO = /defeito|\bbug\b|enquanto (o )?(defeito|bug)|quando for corrigido|reprova quando|deve reprovar/i;

function ofensas(texto, arquivo) {
  const achados = [];
  const linhas = texto.split("\n");
  linhas.forEach((linha, i) => {
    const assercao = /expect\(|toContain|toBe\(|toMatch/.test(linha);
    if (!assercao) return;
    if (!(CONSTRAINT.test(linha) || STATUS.test(linha))) return;
    // A intenção pode estar na própria linha ou no comentário imediatamente acima (até 12 linhas).
    const vizinhanca = linhas.slice(Math.max(0, i - 12), i + 1).join("\n");
    if (INTENCAO.test(vizinhanca)) achados.push(`${arquivo}:${i + 1}: ${linha.trim().slice(0, 120)}`);
  });
  return achados;
}

// ---------- autoteste: quebre, veja reprovar; restaure, veja passar ----------
const DEVE_PEGAR = `
  // enquanto o defeito existir este teste o exige
  expect(recusa).toContain("warehouse_transfers_organization_id_code_key");
`;
const DEVE_PASSAR = `
  // o servidor recusa mistura de empresas, e a tela precisa mostrar o erro
  expect(resposta.status).toBe(422);
`;
if (ofensas(DEVE_PEGAR, "autoteste").length !== 1) {
  console.error("regressao-invertida-audit: AUTOTESTE FALHOU — a amostra que deveria ser pega passou.");
  process.exit(1);
}
if (ofensas(DEVE_PASSAR, "autoteste").length !== 0) {
  console.error("regressao-invertida-audit: AUTOTESTE FALHOU — a amostra legítima foi acusada.");
  process.exit(1);
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
for (const base of ["apps", "packages", "scripts"]) {
  const d = path.join(raiz, base);
  if (fs.existsSync(d)) varrer(d);
}

const todas = alvos.flatMap((p) => ofensas(fs.readFileSync(p, "utf8"), path.relative(raiz, p)));
if (todas.length) {
  console.error("regressao-invertida-audit: teste EXIGINDO a permanência de um defeito\n");
  for (const o of todas) console.error("  - " + o);
  console.error("\nBug conhecido se documenta e se corrige; nunca vira asserção. Remova a expectativa,");
  console.error("mantenha a cobertura positiva do que funciona e registre o defeito na documentação.");
  process.exit(1);
}
console.log(`regressao-invertida-audit: OK (autoteste 2/2; ${alvos.length} arquivos de teste, nenhuma asserção exigindo defeito)`);
