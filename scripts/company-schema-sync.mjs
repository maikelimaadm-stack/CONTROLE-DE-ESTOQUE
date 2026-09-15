#!/usr/bin/env node
/**
 * PAR CANÔNICO ↔ LEGADO: as duas colunas existem juntas e concordam (PRE-BASE2-03).
 *
 * Enquanto o espelho existir, cada coluna de empresa tem duas grafias no schema. Elas precisam ser
 * INDISTINGUÍVEIS: mesma obrigatoriedade, mesmo par em toda tabela. Um par meio-criado é pior que nenhum —
 * o runtime novo grava `empresa_id` e a versão anterior lê `farm_id` vazio, sem erro, até alguém reparar
 * num relatório.
 *
 * Este gate lê o TEXTO das migrations (não precisa de banco: roda no job de qualidade). A existência dos
 * GATILHOS de sincronização é conferida contra o banco em `apps/api/test/integration/rls-matriz.test.ts` —
 * "a migration diz" não é o mesmo que "o banco faz".
 *
 * A REGRA mora em `scripts/lib/espelho-empresa.mjs`, pura e testada por
 * `apps/api/test/unit/espelho-empresa-fases.test.ts`. Aqui fica só a borda de linha de comando: ler o schema,
 * ler a fase declarada e imprimir. Foi essa separação que tornou possível provar o contrato POR PAR, com
 * migrations de mentira, em vez de depender de uma sabotagem manual no schema real.
 */
import { readSchema } from "./lib/schema.mjs";
import { FASE_ESPELHO } from "./lib/empresa-compat-surface.mjs";
import { conferirEspelho } from "./lib/espelho-empresa.mjs";

const r = conferirEspelho(readSchema(), FASE_ESPELHO);

if (r.problemas.length) {
  console.error("company-schema-sync: contrato do espelho canônico/legado violado:");
  for (const p of r.problemas) console.error(`  - ${p}`);
  console.error(`\nFase declarada: "${FASE_ESPELHO}" (scripts/lib/empresa-compat-surface.mjs).`);
  console.error("A cobrança é POR PAR HISTÓRICO — um par que existiu na ponte física continua sendo cobrado");
  console.error("depois da purga. Contagem global não distingue \"nunca teve espelho\" de \"perdeu o espelho\".");
  process.exit(1);
}
console.log(`company-schema-sync: OK (fase ${FASE_ESPELHO}; ${r.paresHistoricos} pares HISTÓRICOS em ${r.tabelasHistoricas} tabelas, ${r.legadasVivas} com o espelho vivo; ${r.canonicasDeNascenca} canônicas de nascença, que a purga não toca)`);
