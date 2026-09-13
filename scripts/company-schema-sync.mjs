#!/usr/bin/env node
/**
 * PAR CANÔNICO ↔ LEGADO: as duas colunas existem juntas e concordam (PRE-BASE2-03).
 *
 * Enquanto a ponte existir, cada coluna de empresa tem duas grafias no schema. Elas precisam ser
 * INDISTINGUÍVEIS: mesma obrigatoriedade, mesmo par em toda tabela. Um par meio-criado é pior que nenhum —
 * o runtime novo grava `empresa_id` e a versão anterior lê `farm_id` vazio, sem erro, até alguém reparar
 * num relatório.
 *
 * Este gate lê o TEXTO das migrations (não precisa de banco: roda no job de qualidade). A existência dos
 * GATILHOS de sincronização é conferida contra o banco em `apps/api/test/integration/rls-matriz.test.ts` —
 * "a migration diz" não é o mesmo que "o banco faz".
 */
import { readSchema } from "./lib/schema.mjs";

const PARES = [["empresa_id", "farm_id"], ["empresa_origem_id", "origin_farm_id"], ["empresa_destino_id", "destination_farm_id"]];
const schema = readSchema();
const problemas = [];
let pares = 0;

for (const [nome, t] of schema) {
  for (const [canonico, legado] of PARES) {
    const c = t.columns.get(canonico);
    const l = t.columns.get(legado);
    if (!c && !l) continue;
    // Coluna canônica SEM espelho legado é o estado correto de quem NASCEU canônico (erp.notifications,
    // erp.registros_globais, erp.membro_empresas: criadas em 0010–0012 já com `empresa_id`). Não há nome
    // antigo a ser compatível ali — a versão anterior da API também escreve `empresa_id` nessas tabelas.
    if (c && !l) { pares++; continue; }
    if (l && !c) { problemas.push(`${nome}.${legado} existe sem a coluna canônica ${canonico} — o runtime novo não encontraria a coluna`); continue; }
    if (Boolean(c.notNull) !== Boolean(l.notNull)) {
      problemas.push(`${nome}: ${canonico} é ${c.notNull ? "NOT NULL" : "anulável"} mas ${legado} é ${l.notNull ? "NOT NULL" : "anulável"} — as duas grafias precisam aceitar exatamente o mesmo`);
    }
    pares++;
  }
}

if (problemas.length) {
  console.error("company-schema-sync: par canônico/legado inconsistente:");
  for (const p of problemas) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`company-schema-sync: OK (${pares} pares de coluna coerentes)`);
