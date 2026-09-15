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
 * DUAS CORREÇÕES DA PRE-BASE2-05C-0
 * ---------------------------------
 * 1. A CONTA ESTAVA MISTURADA. O gate imprimia "56 pares" e esse número virou a medida do trabalho da 05C
 *    em documento e em conversa. Mas ele somava coisas diferentes: 52 pares ESPELHADOS de verdade (canônica
 *    + legada, que é o que a purga remove) com 4 colunas canônicas de nascença (`erp.notifications`,
 *    `erp.registros_globais`, `erp.membro_empresas`, `erp.legado_escopo_empresa_v0`), que não têm nome antigo
 *    e das quais a 05C não tira nada. Planejar a remoção por 56 é planejar por um número que não existe;
 *    agora os dois são contados e impressos SEPARADAMENTE.
 *
 * 2. O GATE FICARIA VERDE SEM TER O QUE MEDIR. Quando a 05C-1 dropar as colunas legadas, o laço abaixo não
 *    encontra nenhum par espelhado — e, com a lógica anterior, simplesmente imprimiria OK. No momento mais
 *    perigoso da migração, o instrumento pararia de medir sem avisar. Por isso ele passa a exigir uma FASE
 *    declarada (`FASE_ESPELHO`, em `scripts/lib/empresa-compat-surface.mjs`), e cada fase tem uma exigência
 *    POSITIVA: em `dual` tem de HAVER espelho; em `canonica` NÃO pode haver nenhum. Esquecer de virar a fase
 *    reprova dos dois lados.
 */
import { readSchema } from "./lib/schema.mjs";
import { FASE_ESPELHO } from "./lib/empresa-compat-surface.mjs";

const PARES = [["empresa_id", "farm_id"], ["empresa_origem_id", "origin_farm_id"], ["empresa_destino_id", "destination_farm_id"]];
const FASES = ["dual", "canonica"];

const schema = readSchema();
const problemas = [];
/** Canônica COM espelho legado: é o que a purga da 05C-1 remove. */
let espelhados = 0;
/** Canônica SEM espelho: nasceu canônica (0010–0012). A 05C não tira nada daqui. */
let canonicasDeNascenca = 0;
const tabelasEspelhadas = new Set();

if (!FASES.includes(FASE_ESPELHO)) {
  console.error(`company-schema-sync: FASE_ESPELHO inválida (${FASE_ESPELHO}). Esperado: ${FASES.join(" | ")}.`);
  process.exit(1);
}

for (const [nome, t] of schema) {
  for (const [canonico, legado] of PARES) {
    const c = t.columns.get(canonico);
    const l = t.columns.get(legado);
    if (!c && !l) continue;
    if (c && !l) { canonicasDeNascenca++; continue; }
    if (l && !c) { problemas.push(`${nome}.${legado} existe sem a coluna canônica ${canonico} — o runtime novo não encontraria a coluna`); continue; }
    if (FASE_ESPELHO === "canonica") {
      problemas.push(`${nome}.${legado} sobreviveu à purga: a fase declarada é "canonica" e o nome antigo não pode mais existir`);
      continue;
    }
    if (Boolean(c.notNull) !== Boolean(l.notNull)) {
      problemas.push(`${nome}: ${canonico} é ${c.notNull ? "NOT NULL" : "anulável"} mas ${legado} é ${l.notNull ? "NOT NULL" : "anulável"} — as duas grafias precisam aceitar exatamente o mesmo`);
    }
    espelhados++;
    tabelasEspelhadas.add(nome);
  }
}

// A EXIGÊNCIA POSITIVA DE CADA FASE — é ela que impede o verde sem medição.
if (FASE_ESPELHO === "dual" && espelhados === 0) {
  problemas.push('a fase declarada é "dual", mas não há NENHUM par espelhado no schema: ou a purga já rodou e FASE_ESPELHO não foi virada para "canonica", ou o leitor de migrations parou de enxergar as colunas. Nos dois casos este gate deixou de medir o que diz medir.');
}
if (FASE_ESPELHO === "canonica" && canonicasDeNascenca === 0) {
  problemas.push('a fase declarada é "canonica", mas o gate não encontrou NENHUMA coluna canônica de empresa — não há o que conferir, e um gate sem objeto é um carimbo.');
}

if (problemas.length) {
  console.error("company-schema-sync: par canônico/legado inconsistente:");
  for (const p of problemas) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`company-schema-sync: OK (fase ${FASE_ESPELHO}; ${espelhados} colunas ESPELHADAS em ${tabelasEspelhadas.size} tabelas — o que a purga remove; ${canonicasDeNascenca} canônicas de nascença, que ela não toca)`);
