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
  // `animalCode(ctx, \`animal_${d.movement_type}\`)` em `apps/api/src/routes/livestock.ts`. Só ficou
  // visível quando o auditor passou a enxergar os invólucros — e é LEGÍTIMO: `movement_type` está dentro
  // da UNIQUE de `erp.animal_movements`, então cada tipo de movimentação tem namespace próprio. A metade
  // (2) cobra essa prova no schema, e é ela que impede a declaração de virar carimbo.
  "animal_${...}": { tabela: "erp.animal_movements", discriminador: "movement_type" },
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

/**
 * AS PORTAS DE ALOCAÇÃO, e o índice do argumento que carrega a ENTIDADE.
 *
 * `nextCode` é a porta crua; `animalCode` é o invólucro de `apps/api/src/routes/livestock.ts`
 * (`nextCode(ctx.tx, ctx.orgId, entity, 5)`), e `uniqueCode` é o invólucro com laço da mesma rota.
 *
 * ISTO NÃO É ZELO: a primeira versão deste auditor só conhecia `nextCode`, e por isso era CEGO
 * exatamente ao módulo de onde o defeito da chave sobrecarregada veio — `livestock.ts` nunca chama
 * `nextCode` diretamente. Um auditor que não enxerga o invólucro audita o arquivo errado.
 */
const PORTAS = [
  { nome: "nextCode", arg: 2 },   // nextCode(tx, orgId, entity, width?)
  { nome: "animalCode", arg: 1 }, // animalCode(ctx, entity)
  { nome: "uniqueCode", arg: 2 }, // uniqueCode(ctx, table, entity)
];

/** Extrai o argumento de ENTIDADE de cada porta de alocação, contando parênteses e ignorando vírgulas aninhadas. */
function entidadesDeNextCode(texto) {
  const achados = [];
  const re = new RegExp(`\\b(${PORTAS.map((p) => p.nome).join("|")})\\s*\\(`, "g");
  let m;
  while ((m = re.exec(texto)) !== null) {
    const porta = PORTAS.find((p) => p.nome === m[1]);
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
    if (args.length > porta.arg) {
      achados.push({ entidade: args[porta.arg], porta: porta.nome, linha: texto.slice(0, m.index).split("\n").length });
    }
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
  ["ternário dentro do invólucro animalCode é PEGO", 1, 'const code = await animalCode(ctx, k === "farm" ? "farm_transfer" : "outro");'],
];
/** Amostras da metade 3: a chave legada é proibida no runtime, em qualquer grafia de literal. */
const AMOSTRAS_LEGADA = [
  ["literal simples é PEGO", 1, `const code = await nextCode(ctx.tx, ctx.orgId, 'farm_transfer');`],
  ["literal duplo é PEGO", 1, 'const code = await nextCode(ctx.tx, ctx.orgId, "farm_transfer", 5);'],
  ["pelo invólucro animalCode é PEGO", 1, 'const code = await animalCode(ctx, "farm_transfer");'],
  ["pelo invólucro uniqueCode é PEGO", 1, 'const c = await uniqueCode(ctx, "animal_handlings", "farm_transfer");'],
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

// ---------- metade 3: o uso da chave LEGADA e permitido, mas so DECLARADO ----------
// POR QUE ESTA METADE MUDOU DE FORMA. A primeira versao PROIBIA `farm_transfer` no runtime, sob a tese de
// que a 0019 a tornava alias-only. A auditoria externa mostrou que a tese custava caro demais: dar ao
// rebanho um contador proprio DURANTE a vida do alias cria uma corrida entre o binario anterior (que pede
// a chave legada, aliasada para o contador de estoque) e o novo (que pediria o contador proprio). Duas
// LINHAS de `erp.code_sequences`, sem trava em comum, emitindo o mesmo numero para
// `erp.animal_movements` — e um `select` de "ja existe?" e TOCTOU, nao solucao.
//
// Enquanto o alias existir, o caminho seguro e os DOIS binarios pedirem a MESMA chave: `erp.next_code` e
// `insert ... on conflict do update`, entao a linha do contador serializa as transacoes.
//
// Logo a chave legada NAO e proibida — ela e COMPATIBILIDADE, e compatibilidade sem prazo vira folclore.
// Cada uso precisa estar declarado aqui, com o motivo e a condicao de saida. Um uso NOVO e nao declarado
// reprova, que e o que impede a chave de se espalhar por conveniencia.
const POR_COMPATIBILIDADE = {
  "apps/api/src/routes/livestock.ts": {
    motivo: "erp.animal_movements divide a chave legada com erp.warehouse_transfers; separar agora criaria "
          + "corrida entre o binario anterior (aliasado) e o novo durante o rolling deploy",
    sai_quando: "a fatia que REMOVER o alias de erp.next_code separar a numeracao do rebanho",
  },
};

const legadas = [];
for (const f of arquivos) {
  const rel = path.relative(REPO_ROOT, f);
  const texto = fs.readFileSync(f, "utf8");
  for (const { entidade, linha } of entidadesDeNextCode(texto)) {
    if (!/["'`]farm_transfer["'`]/.test(entidade)) continue;
    if (!POR_COMPATIBILIDADE[rel]) {
      legadas.push(`${rel}:${linha}: pede a chave LEGADA 'farm_transfer' (${entidade.trim()}) e nao esta declarada`);
    }
  }
}
if (legadas.length) {
  console.error("sequencia-namespace-audit: uso NAO DECLARADO da chave legada de transferencia\n");
  for (const o of legadas) console.error("  - " + o);
  console.error("\n'farm_transfer' e ALIAS de compatibilidade da migration 0019: ela cai no contador de");
  console.error("erp.warehouse_transfers, seja qual for a tabela que voce esta numerando. Se o seu caminho");
  console.error("PRECISA dela para nao criar contador concorrente durante o rolling deploy, declare o");
  console.error("arquivo em POR_COMPATIBILIDADE com motivo e condicao de saida. Se nao precisa, use a chave");
  console.error("canonica do SEU namespace (SEQUENCIA_WAREHOUSE_TRANSFER para estoque).");
  process.exit(1);
}

// E a declaracao nao pode envelhecer em silencio: arquivo declarado que DEIXOU de usar a chave vira
// declaracao morta, e declaracao morta e o comeco de uma allowlist que ninguem revisa.
const declaracoesMortas = [];
for (const rel of Object.keys(POR_COMPATIBILIDADE)) {
  const abs = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(abs)) { declaracoesMortas.push(`${rel}: declarado em POR_COMPATIBILIDADE e nao existe`); continue; }
  const usa = entidadesDeNextCode(fs.readFileSync(abs, "utf8"))
    .some((a) => /["'`]farm_transfer["'`]/.test(a.entidade));
  if (!usa) declaracoesMortas.push(`${rel}: declarado em POR_COMPATIBILIDADE mas nao pede mais a chave legada`);
}
if (declaracoesMortas.length) {
  console.error("sequencia-namespace-audit: declaracao de compatibilidade MORTA\n");
  for (const o of declaracoesMortas) console.error("  - " + o);
  console.error("\nRemova a entrada de POR_COMPATIBILIDADE: compatibilidade que ninguem usa mais e allowlist.");
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
  `provadas na unicidade, ${Object.keys(POR_COMPATIBILIDADE).length} uso(s) da chave legada declarado(s) e vivo(s))`
);
