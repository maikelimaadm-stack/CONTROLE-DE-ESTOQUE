#!/usr/bin/env node
/**
 * A SEQUÊNCIA ACOMPANHA O NAMESPACE DE UNICIDADE DA TABELA — nunca a variante funcional.
 *
 * POR QUE ESTE GATE EXISTE. `erp.warehouse_transfers` tem `unique (organization_id, code)` — sem `kind`
 * — e mesmo assim numerava com DOIS contadores (`warehouse_transfer` e `farm_transfer`). Como
 * `erp.code_sequences` tem PK `(organization_id, entity)`, duas chaves são duas linhas com dois
 * `last_value` independentes: os dois emitiam `0001` para a mesma coluna com unicidade compartilhada, e
 * a segunda variante criada numa organização morria com 409. O hotfix 0019 unificou.
 *
 * O ponto que este auditor trava não é o caso corrigido — é a REGRA que o explica, porque ela não é
 * óbvia e o repositório tem contraexemplos legítimos ao lado:
 *
 *   erp.financial_titles   unique (organization_id, direction, code)   title_payable / title_receivable
 *   erp.sales_documents    unique (organization_id, kind, code)        sales_budget / sales_order / sales_sale
 *
 * Nesses dois, numerar por variante é CORRETO: o discriminador está DENTRO da chave única, então cada
 * variante tem o seu próprio namespace. Quem olhar `title_${direction}` e concluir "numerar por variante
 * é o padrão da casa" reintroduz o defeito na próxima tabela. A regra é: contador por variante exige o
 * discriminador na unicidade. Sempre.
 *
 * COMO FUNCIONA. Duas metades, e nenhuma sozinha basta:
 *
 *  (1) toda chamada de `nextCode` cujo NOME DE ENTIDADE é derivado de variante (template com `${}` ou
 *      ternário) precisa estar DECLARADA abaixo, com a tabela que numera e a coluna discriminadora;
 *  (2) para cada entrada declarada, a UNIQUE daquela tabela — lida das migrations, não de uma cópia —
 *      precisa conter o discriminador.
 *
 * Sem (1), uma tabela nova numera por variante e ninguém percebe. Sem (2), a declaração vira prosa: se
 * alguém DERRUBAR o discriminador da UNIQUE de `financial_titles`, aquela numeração passa a colidir
 * exatamente como a de transferências colidia, e nada reprovaria.
 *
 * Autoteste embutido: o gate se prova contra amostras sintéticas antes de auditar o repositório.
 */
import fs from "node:fs";
import path from "node:path";
import { readSchema, REPO_ROOT } from "./lib/schema.mjs";

/**
 * NUMERAÇÃO POR VARIANTE DECLARADA — cada entrada precisa do discriminador dentro da UNIQUE.
 * Acrescentar uma entrada aqui é uma decisão: significa afirmar que aquela tabela tem um namespace de
 * código POR VARIANTE, e a metade (2) do gate vai cobrar a prova no schema.
 */
const POR_VARIANTE = {
  "title_${...}": { tabela: "erp.financial_titles", discriminador: "direction" },
  "sales_${...}": { tabela: "erp.sales_documents", discriminador: "kind" },
};

/** Normaliza o argumento de entidade para a forma declarada, ou null se não for derivado de variante. */
function formaDerivada(arg) {
  const t = arg.trim();
  // template literal com interpolação: `title_${x}` -> "title_${...}"
  if (t.startsWith("`") && t.includes("${")) return t.replace(/\$\{[^}]*\}/g, "${...}").replace(/`/g, "");
  // ternário: foi assim que warehouse_transfers numerava
  if (/\?[^:]*:/.test(t) && /["'`]/.test(t)) return `ternario:${t.replace(/\s+/g, " ").slice(0, 60)}`;
  return null;
}

/** Extrai o 3º argumento de cada `nextCode(...)` de um texto, contando parênteses e ignorando vírgulas aninhadas. */
function entidadesDeNextCode(texto) {
  const achados = [];
  const re = /\bnextCode\s*\(/g;
  let m;
  while ((m = re.exec(texto)) !== null) {
    let i = m.index + m[0].length, prof = 1, arg = 0, atual = "";
    const args = [];
    while (i < texto.length && prof > 0) {
      const c = texto[i];
      if (c === "(" || c === "[" || c === "{") prof++;
      else if (c === ")" || c === "]" || c === "}") { prof--; if (prof === 0) break; }
      if (c === "," && prof === 1) { args.push(atual); atual = ""; arg++; i++; continue; }
      atual += c;
      i++;
    }
    args.push(atual);
    if (args.length >= 3) achados.push({ entidade: args[2], linha: texto.slice(0, m.index).split("\n").length });
  }
  return achados;
}

// ---------- autoteste ----------
const AMOSTRAS = [
  ["ternário por variante é PEGO", 1, 'const code = await nextCode(ctx.tx, ctx.orgId, d.kind === "farm" ? "farm_transfer" : "warehouse_transfer");'],
  ["template com interpolação é PEGO", 1, "const code = await nextCode(ctx.tx, ctx.orgId, `title_${input.direction}`, 4);"],
  ["literal fixo NÃO é derivado", 0, 'const code = await nextCode(ctx.tx, ctx.orgId, "input_entry");'],
  ["constante nomeada NÃO é derivada", 0, "const code = await nextCode(ctx.tx, ctx.orgId, SEQUENCIA_WAREHOUSE_TRANSFER);"],
  ["variável genérica NÃO é derivada", 0, "const code = await nextCode(ctx.tx, ctx.orgId, def.codeEntity, 4);"],
];
/** Amostras da metade 3: a chave legada é proibida no runtime, em qualquer grafia de literal. */
const AMOSTRAS_LEGADA = [
  ["literal simples é PEGO", 1, `const code = await nextCode(ctx.tx, ctx.orgId, 'farm_transfer');`],
  ["literal duplo é PEGO", 1, 'const code = await nextCode(ctx.tx, ctx.orgId, "farm_transfer", 5);'],
  ["dentro de ternário é PEGO", 1, 'const code = await nextCode(ctx.tx, ctx.orgId, k === "farm" ? "farm_transfer" : "warehouse_transfer");'],
  ["a canônica do rebanho NÃO é pega", 0, "const code = await nextCode(ctx.tx, ctx.orgId, SEQUENCIA_ANIMAL_FARM_TRANSFER, 5);"],
  ["o TIPO DE MOVIMENTO farm_transfer não é chave de contador", 0, 'const code = await nextCode(ctx.tx, ctx.orgId, "animal_farm_transfer", 5);'],
];
for (const [nome, esperado, amostra] of AMOSTRAS_LEGADA) {
  const n = entidadesDeNextCode(amostra).filter((a) => /["\'`]farm_transfer["\'`]/.test(a.entidade)).length;
  if (n !== esperado) {
    console.error(`sequencia-namespace-audit: AUTOTESTE (legada) FALHOU — "${nome}": esperava ${esperado}, obteve ${n}.`);
    process.exit(1);
  }
}
for (const [nome, esperado, amostra] of AMOSTRAS) {
  const n = entidadesDeNextCode(amostra).filter((a) => formaDerivada(a.entidade) !== null).length;
  if (n !== esperado) {
    console.error(`sequencia-namespace-audit: AUTOTESTE FALHOU — "${nome}": esperava ${esperado}, obteve ${n}.`);
    process.exit(1);
  }
}

// ---------- metade 1: nenhuma numeração por variante fora da declaração ----------
const SRC = path.join(REPO_ROOT, "apps/api/src");
if (!fs.existsSync(SRC)) {
  console.error(`sequencia-namespace-audit: ${SRC} nao existe. Gate que nao acha o que auditar esta desligado, nao satisfeito.`);
  process.exit(1);
}
const arquivos = [];
const varrer = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) varrer(p);
    else if (/\.ts$/.test(e.name)) arquivos.push(p);
  }
};
varrer(SRC);

let chamadas = 0;
const naoDeclaradas = [];
for (const f of arquivos) {
  for (const { entidade, linha } of entidadesDeNextCode(fs.readFileSync(f, "utf8"))) {
    chamadas++;
    const forma = formaDerivada(entidade);
    if (forma && !POR_VARIANTE[forma]) {
      naoDeclaradas.push(`${path.relative(REPO_ROOT, f)}:${linha}: numera por VARIANTE (${forma}) e nao esta declarada`);
    }
  }
}
if (chamadas < 10) {
  console.error(`sequencia-namespace-audit: so ${chamadas} chamada(s) de nextCode encontrada(s). Varredura vazia indica raiz errada.`);
  process.exit(1);
}
if (naoDeclaradas.length) {
  console.error("sequencia-namespace-audit: numeracao por variante NAO declarada\n");
  for (const o of naoDeclaradas) console.error("  - " + o);
  console.error("\nContador por variante so e correto quando o discriminador esta DENTRO da UNIQUE da tabela.");
  console.error("Se estiver, declare em POR_VARIANTE. Se nao estiver, use UM contador para a tabela inteira");
  console.error("(foi o defeito de erp.warehouse_transfers, corrigido pelo hotfix 0019).");
  process.exit(1);
}

// ---------- metade 2: cada declaração tem o discriminador na UNIQUE ----------
const schema = readSchema();
const semDiscriminador = [];
for (const [forma, { tabela, discriminador }] of Object.entries(POR_VARIANTE)) {
  const t = schema.get(tabela);
  if (!t) { semDiscriminador.push(`${forma}: tabela ${tabela} nao existe no schema`); continue; }
  const uniques = t.constraints.filter((c) => /^unique\b/i.test(c));
  const cobre = uniques.some((u) => {
    const cols = (u.match(/\(([^)]*)\)/)?.[1] ?? "").split(",").map((s) => s.trim());
    return cols.includes("code") && cols.includes(discriminador);
  });
  if (!cobre) {
    semDiscriminador.push(
      `${forma}: ${tabela} numera por "${discriminador}" mas nenhuma UNIQUE tem (… ${discriminador} … code). ` +
      `UNIQUEs encontradas: ${uniques.join(" | ") || "<nenhuma>"}`
    );
  }
}
if (semDiscriminador.length) {
  console.error("sequencia-namespace-audit: numeracao por variante SEM o discriminador na unicidade\n");
  for (const o of semDiscriminador) console.error("  - " + o);
  console.error("\nSem o discriminador na UNIQUE, as variantes compartilham namespace e os contadores colidem.");
  process.exit(1);
}

// ---------- metade 3: a chave legada e SO alias — nenhum runtime pode voltar a pedi-la ----------
// POR QUE ESTA METADE EXISTE. `farm_transfer` era uma chave SOBRECARREGADA: duas tabelas com namespaces
// de unicidade DIFERENTES pediam o mesmo contador —
//
//   erp.warehouse_transfers   unique (organization_id, code)                 POST /stock/transfers
//   erp.animal_movements      unique (organization_id, movement_type, code)  POST /livestock/transfers/to-farm
//
// A 0019 dividiu o historico e transformou a chave em ALIAS dentro de `erp.next_code`, para o binario
// anterior continuar correto durante o rolling deploy. Um alias nao sabe quem chamou: qualquer runtime
// que volte a pedi-la sera desviado para o contador de ESTOQUE, seja qual for a tabela que ele numera.
//
// Por isso a chave e proibida no codigo NOVO. Ela existe apenas no banco, e com data para sair.
const legadas = [];
for (const f of arquivos) {
  const texto = fs.readFileSync(f, "utf8");
  for (const { entidade, linha } of entidadesDeNextCode(texto)) {
    if (/["'`]farm_transfer["'`]/.test(entidade)) {
      legadas.push(`${path.relative(REPO_ROOT, f)}:${linha}: pede a chave LEGADA 'farm_transfer' (${entidade.trim()})`);
    }
  }
}
if (legadas.length) {
  console.error("sequencia-namespace-audit: runtime pedindo a chave LEGADA de transferencia\n");
  for (const o of legadas) console.error("  - " + o);
  console.error("\n'farm_transfer' e ALIAS de compatibilidade da migration 0019, nao chave de runtime: ela");
  console.error("cai no contador de erp.warehouse_transfers, seja qual for a tabela que voce esta numerando.");
  console.error("Use a chave canonica do SEU namespace (SEQUENCIA_WAREHOUSE_TRANSFER para estoque,");
  console.error("SEQUENCIA_ANIMAL_FARM_TRANSFER para movimentacao de rebanho).");
  process.exit(1);
}

// ---------- metade 4: a tabela do hotfix continua com namespace unico ----------
// Ancorada de propósito: se alguém acrescentar `kind` à UNIQUE de warehouse_transfers, o contador único
// deixa de ser a resposta certa e este arquivo precisa ser reconsiderado junto.
const wt = schema.get("erp.warehouse_transfers");
if (!wt) {
  console.error("sequencia-namespace-audit: erp.warehouse_transfers nao existe no schema.");
  process.exit(1);
}
const uniquesWt = wt.constraints.filter((c) => /^unique\b/i.test(c));
const namespaceUnico = uniquesWt.some((u) => {
  const cols = (u.match(/\(([^)]*)\)/)?.[1] ?? "").split(",").map((s) => s.trim());
  return cols.length === 2 && cols.includes("organization_id") && cols.includes("code");
});
if (!namespaceUnico) {
  console.error("sequencia-namespace-audit: erp.warehouse_transfers nao tem mais UNIQUE (organization_id, code).");
  console.error(`UNIQUEs encontradas: ${uniquesWt.join(" | ") || "<nenhuma>"}`);
  console.error("O contador unico do hotfix 0019 supoe esse namespace. Reconsidere os dois juntos.");
  process.exit(1);
}

console.log(
  `sequencia-namespace-audit: OK (autoteste ${AMOSTRAS.length + AMOSTRAS_LEGADA.length}/${AMOSTRAS.length + AMOSTRAS_LEGADA.length}; ` +
  `${chamadas} chamadas de nextCode, ${Object.keys(POR_VARIANTE).length} numeracoes por variante declaradas e ` +
  `provadas na unicidade, chave legada 'farm_transfer' ausente do runtime)`
);
