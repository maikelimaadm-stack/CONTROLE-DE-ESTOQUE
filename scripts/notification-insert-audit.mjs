#!/usr/bin/env node
/**
 * GATE: `insert into erp.notifications` em runtime só pelo helper oficial.
 *
 * A notificação nasce com escopo (tipo, módulo, empresa) e capacidade. Um insert solto numa rota não
 * carrega nada disso — foi exatamente assim que o processamento de animais e a transferência de lote
 * criaram avisos sem empresa, que chegavam a quem não enxerga a empresa de origem. Revisão humana não
 * pega isso de forma confiável: uma linha no meio de um handler de 400 colunas passa batido.
 *
 * Migrations e seed ficam de fora: lá o insert é dado, não decisão de runtime.
 */
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");
const HELPER = path.join("apps", "api", "src", "lib", "notificacao.ts");
const DIRS = [path.join("apps", "api", "src"), path.join("packages", "domain", "src"), path.join("packages", "plataforma", "src")];
const PADRAO = /insert\s+into\s+erp\.notifications\b/i;

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

const infratores = [];
for (const rel of arquivos) {
  if (rel === HELPER) continue;                       // o helper é a porta oficial
  const texto = fs.readFileSync(path.join(RAIZ, rel), "utf8");
  texto.split("\n").forEach((linha, i) => {
    if (PADRAO.test(linha)) infratores.push(`${rel}:${i + 1}`);
  });
}

if (infratores.length) {
  console.error("notification-insert-audit: insert direto em erp.notifications fora do helper oficial:");
  for (const x of infratores) console.error(`  - ${x}`);
  console.error(`\nUse criarNotificacao() de ${HELPER}: ele exige tipo conhecido, escopo, módulo, empresa e`);
  console.error("capacidade, e é o que impede o aviso de uma empresa chegar a quem não a enxerga.");
  process.exit(1);
}
console.log(`notification-insert-audit: OK (${arquivos.length} arquivos; criação só por criarNotificacao)`);
