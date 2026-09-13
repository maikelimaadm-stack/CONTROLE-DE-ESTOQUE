#!/usr/bin/env node
/**
 * GATE: escrever `current_responsible_user_id` exige provar que o responsável PODE ser responsável.
 *
 * A coluna referencia identidade, e identidade é global: qualquer porta que gravasse um UUID vindo do
 * cliente estava escolhendo um usuário de QUALQUER organização — e a leitura da solicitação devolve o NOME
 * do responsável num join sem filtro de organização, então o nome voltava no corpo da resposta. A
 * invariante (membro ativo + `purchase_requests.view` + acesso ao módulo `compras` na empresa da
 * solicitação) mora num helper só; este gate existe para que ninguém abra uma porta NOVA sem passar por
 * ele — uma linha de `update` no meio de um handler não se pega em revisão de forma confiável.
 *
 * Duas regras, as duas sobre RUNTIME (migrations e seed ficam de fora: lá a coluna é dado, não decisão):
 *   1. só `apps/api/src/routes/supply.ts` escreve a coluna;
 *   2. dentro dele, toda escrita tem o helper de elegibilidade logo acima (ou na própria linha).
 */
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");
const DONO = path.join("apps", "api", "src", "routes", "supply.ts");
const DIRS = [path.join("apps", "api", "src"), path.join("packages", "domain", "src"), path.join("packages", "plataforma", "src")];
const HELPER = /[Rr]esponsavelElegivel\s*\(/;   // casa com responsavelElegivel( e exigirResponsavelElegivel(
const JANELA = 5;                              // linhas anteriores em que a prova ainda conta como "logo acima"
// escrita = a coluna recebendo valor (update ... col=$n) ou aparecendo na lista de colunas de um insert
const ESCRITA = /current_responsible_user_id\s*=|insert\s+into\s+erp\.purchase_requests\s*\([^)]*current_responsible_user_id/i;
// leitura de filtro (`where r.current_responsible_user_id=$3`) não é escrita
const FILTRO = /where[\s\S]*current_responsible_user_id\s*=|current_responsible_user_id\s*=\s*\$\{/i;

const arquivos = [];
const varrer = (dir) => {
  const abs = path.join(RAIZ, dir);
  if (!fs.existsSync(abs)) return;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) varrer(rel);
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) arquivos.push(rel);
  }
};
DIRS.forEach(varrer);

const foraDoDono = [];
const semProva = [];
for (const rel of arquivos) {
  const linhas = fs.readFileSync(path.join(RAIZ, rel), "utf8").split("\n");
  linhas.forEach((linha, i) => {
    if (!ESCRITA.test(linha) || FILTRO.test(linha)) return;
    if (rel !== DONO) { foraDoDono.push(`${rel}:${i + 1}`); return; }
    const contexto = linhas.slice(Math.max(0, i - JANELA), i + 1).join("\n");
    if (!HELPER.test(contexto)) semProva.push(`${rel}:${i + 1}`);
  });
}

if (foraDoDono.length || semProva.length) {
  console.error("purchase-responsible-audit: escrita de current_responsible_user_id sem a invariante do responsável.");
  if (foraDoDono.length) {
    console.error(`\n  Fora de ${DONO} (porta nova):`);
    for (const x of foraDoDono) console.error(`    - ${x}`);
  }
  if (semProva.length) {
    console.error(`\n  Sem responsavelElegivel(...) nas ${JANELA} linhas anteriores:`);
    for (const x of semProva) console.error(`    - ${x}`);
  }
  console.error(`\nAntes de gravar, prove a elegibilidade com a empresa DA SOLICITAÇÃO (nunca a do cliente):`);
  console.error("  exigirResponsavelElegivel(ctx, r.farm_id, alvo)  → recusa genérica (422) para valor vindo do cliente;");
  console.error("  responsavelElegivel(ctx, r.farm_id, alvo)        → descarta candidato DERIVADO de cadastro.");
  process.exit(1);
}
console.log(`purchase-responsible-audit: ok (escritas só em ${DONO}, todas com prova de elegibilidade)`);
