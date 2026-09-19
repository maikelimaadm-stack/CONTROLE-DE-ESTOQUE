/**
 * Leitor do SCHEMA REAL a partir das migrations (supabase/migrations/*.sql).
 *
 * É a fonte técnica do dicionário de dados e do inventário: nada aqui é digitado à mão, de modo que a
 * documentação não possa divergir do banco.
 *
 * GRAMÁTICA SUPORTADA — deliberadamente a do repositório, não SQL universal:
 *   create table · alter table … add column · alter column set/drop not null ·
 *   alter table … rename to · drop table · alter table … DROP COLUMN
 *
 * POR QUE `drop column` ENTRA AGORA (PRE-BASE2-05C-0, antes de existir a migration que o usa).
 * Até aqui o repositório só tinha migrations aditivas, e um leitor que ignorasse remoção dizia a verdade
 * por acidente. A PRE-BASE2-05C-1 vai remover 52 colunas; se este leitor continuasse cego, o dicionário de
 * dados, o `company-schema-sync`, a matriz de RLS e o inventário passariam a afirmar que a coluna legada
 * ainda existe — e afirmariam isso VERDES. Um gate que descreve um schema que não existe mais é pior do que
 * gate nenhum: ele dá confiança onde não há. O suporte nasce nesta fatia, com teste, para que a fatia
 * destrutiva encontre o instrumento já calibrado.
 *
 * AS ALTERAÇÕES SÃO APLICADAS NA ORDEM EM QUE APARECEM NO ARQUIVO.
 * Antes, cada tipo de alteração era uma varredura separada: todos os `add column`, depois todos os
 * `set not null`, depois os `rename`. Enquanto tudo era aditivo isso dava no mesmo. Com remoção deixa de
 * dar: `drop column x` seguido de `add column x` no MESMO arquivo tem resultado oposto ao da ordem inversa,
 * e uma varredura por tipo não sabe qual veio antes. Agora as alterações são coletadas com a posição no
 * texto e aplicadas em ordem — que é o que o PostgreSQL faz.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");

const CONSTRAINT_START = /^(primary\s+key|unique|foreign\s+key|check|constraint|exclude)\b/i;

/** Divide por vírgulas de nível 0 (ignora vírgulas dentro de parênteses e de literais). */
function splitTopLevel(body) {
  const parts = []; let depth = 0, current = "", quote = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) { current += ch; if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; current += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(current); current = ""; continue; }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Corpo entre o parêntese de abertura em `from` e seu fechamento correspondente. */
function balanced(sql, from) {
  let depth = 0;
  for (let i = from; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") { depth--; if (depth === 0) return { body: sql.slice(from + 1, i), end: i }; }
  }
  return null;
}

const stripSqlComments = (sql) => sql.replace(/--[^\n]*/g, "");

/** Conteúdo do `check (...)` inline da coluna, quando houver. */
function inlineCheck(rest) {
  const i = rest.toLowerCase().indexOf("check");
  if (i < 0) return null;
  const open = rest.indexOf("(", i);
  if (open < 0) return null;
  const block = balanced(rest, open);
  return block ? block.body.replace(/\s+/g, " ").trim() : null;
}

function parseColumn(def) {
  const m = /^([a-z_][a-z0-9_]*)\s+([\s\S]+)$/i.exec(def);
  if (!m) return null;
  const [, name, rest] = m;
  const typeMatch = /^([a-z][a-z0-9_ ]*?(?:\([^)]*\))?(?:\s*\[\])?)(?=\s|$)/i.exec(rest.trim());
  const ref = /references\s+([a-z_]+\.[a-z_]+)/i.exec(rest);
  const def_ = /\bdefault\s+([^,]+?)(?=\s+(?:not\s+null|references|check|unique|primary)\b|$)/i.exec(rest);
  return {
    name,
    type: (typeMatch?.[1] ?? rest.split(/\s+/)[0] ?? "").trim().toLowerCase(),
    notNull: /\bnot\s+null\b/i.test(rest),
    primaryKey: /\bprimary\s+key\b/i.test(rest),
    references: ref ? ref[1].toLowerCase() : null,
    check: inlineCheck(rest),
    default: def_ ? def_[1].trim() : null
  };
}

/**
 * Coleta as alterações de um arquivo COM A POSIÇÃO no texto, para que possam ser aplicadas em ordem.
 * Cada entrada é `{ pos, tipo, ... }`; quem aplica é `aplicar`.
 */
function alteracoesNaOrdemDoArquivo(sql) {
  const ops = [];
  const varrer = (re, montar) => { for (let m = re.exec(sql); m; m = re.exec(sql)) { const op = montar(m); if (op) ops.push({ pos: m.index, ...op }); } };

  varrer(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_]+\.[a-z_][a-z0-9_]*)\s*\(/gi, (m) => {
    const block = balanced(sql, m.index + m[0].length - 1);
    return block ? { tipo: "criarTabela", tabela: m[1].toLowerCase(), corpo: block.body } : null;
  });
  varrer(/alter\s+table\s+(?:if\s+exists\s+)?([a-z_]+\.[a-z_][a-z0-9_]*)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([\s\S]*?);/gi,
    (m) => ({ tipo: "adicionarColuna", tabela: m[1].toLowerCase(), definicao: m[2].trim() }));
  // `drop column a`, `drop column if exists a`, `drop column a cascade` e a forma com várias ações numa
  // instrução só (`drop column a, drop column b;`).
  varrer(/alter\s+table\s+(?:if\s+exists\s+)?([a-z_]+\.[a-z_][a-z0-9_]*)\s+(drop\s+column\b[^;]*);/gi, (m) => {
    const nomes = [...m[2].matchAll(/drop\s+column\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)].map((x) => x[1].toLowerCase());
    return nomes.length ? { tipo: "removerColuna", tabela: m[1].toLowerCase(), colunas: nomes } : null;
  });
  varrer(/alter\s+table\s+(?:if\s+exists\s+)?([a-z_]+\.[a-z_][a-z0-9_]*)\s+alter\s+column\s+([a-z_][a-z0-9_]*)\s+set\s+not\s+null\s*;/gi,
    (m) => ({ tipo: "obrigatoriedade", tabela: m[1].toLowerCase(), coluna: m[2].toLowerCase(), notNull: true }));
  varrer(/alter\s+table\s+(?:if\s+exists\s+)?([a-z_]+\.[a-z_][a-z0-9_]*)\s+alter\s+column\s+([a-z_][a-z0-9_]*)\s+drop\s+not\s+null\s*;/gi,
    (m) => ({ tipo: "obrigatoriedade", tabela: m[1].toLowerCase(), coluna: m[2].toLowerCase(), notNull: false }));
  varrer(/alter\s+table\s+(?:if\s+exists\s+)?([a-z_]+\.[a-z_][a-z0-9_]*)\s+rename\s+to\s+([a-z_][a-z0-9_]*)\s*;/gi,
    (m) => ({ tipo: "renomearTabela", tabela: m[1].toLowerCase(), novo: m[2].toLowerCase() }));
  varrer(/drop\s+table\s+(?:if\s+exists\s+)?([a-z_]+\.[a-z_][a-z0-9_]*)\s*(?:cascade|restrict)?\s*;/gi,
    (m) => ({ tipo: "removerTabela", tabela: m[1].toLowerCase() }));

  return ops.sort((a, b) => a.pos - b.pos);
}

/**
 * FORMAS QUE ESTE LEITOR RECUSA — EM VOZ ALTA (PRE-BASE2-05C-0).
 *
 * Tolerar em silêncio o que não se entende é aceitável enquanto o silêncio ERRA PARA O LADO SEGURO. Com
 * migrations aditivas era o caso: uma cláusula não reconhecida só deixava de acrescentar alguma coisa. Com
 * remoção deixa de ser, e duas formas fazem o modelo divergir do PostgreSQL SEM NENHUM SINAL:
 *
 *   • `alter table t drop column a, add column b …` — o leitor via o `drop` e engolia o `add`: a coluna `b`
 *     simplesmente não existia no modelo, e o dicionário de dados, a matriz e o inventário descreveriam uma
 *     tabela que o banco não tem;
 *   • `alter table t rename column a to b` — ignorado por inteiro: o modelo mantinha `a` e nunca conhecia
 *     `b`. Para a PRE-BASE2-05C-1 esta é a pior das duas — uma migration que RENOMEIE em vez de dropar faria
 *     todos os gates afirmarem, verdes, que a coluna legada continua existindo.
 *
 * O comentário anterior dizia que a forma mista "não é suportada de propósito" porque aceitá-la pela metade
 * seria pior do que recusá-la. Estava certo no princípio e errado no fato: ela era aceita pela metade,
 * porque não havia recusa nenhuma. Agora há. O leitor PARA, dizendo arquivo e instrução.
 *
 * As demais cláusulas de `alter table` (constraint, default, tipo, `enable row level security`) continuam
 * ignoradas de propósito: elas não mudam o CONJUNTO de colunas, que é o que este modelo afirma.
 */
const FORMAS_RECUSADAS = [
  { re: /alter\s+table\s+(?:if\s+exists\s+)?[a-z_]+\.[a-z_][a-z0-9_]*\s+(?=[^;]*\bdrop\s+column\b)(?=[^;]*\badd\s+column\b)[^;]*;/gi,
    porque: "mistura `drop column` e `add column` na MESMA instrução; separe em duas instruções, na ordem em que devem valer" },
  { re: /alter\s+table\s+(?:if\s+exists\s+)?[a-z_]+\.[a-z_][a-z0-9_]*\s+rename\s+column\b[^;]*;/gi,
    porque: "`rename column` não é modelado; use `add column` + backfill + `drop column`, que é o que a migração de empresa já faz" },
  // A purga de 52 colunas pede um laço, e um laço com `execute format` é invisível para este leitor: o
  // modelo diria que as 52 continuam lá e o gate acusaria 52 sobreviventes que não existem — vermelho pelo
  // motivo errado, com o autor caçando o defeito no lugar errado. A recusa é ESTREITA de propósito: só o
  // DDL dinâmico que mexe no CONJUNTO DE COLUNAS. `format('alter table … enable row level security')` e
  // `format('alter table … add constraint …')` continuam aceitos e ignorados — as migrations 0007 e 0014
  // usam os dois, e nenhum deles muda a lista de colunas que este modelo afirma.
  { re: /execute\s+format\s*\(\s*'[^']*\b(?:drop|add)\s+column\b/gi,
    porque: "DDL de coluna por SQL dinâmico não é modelável a partir do texto; escreva as instruções `alter table … drop column` literais, uma por linha" }
];

function recusarFormaNaoModelada(sql, file) {
  for (const { re, porque } of FORMAS_RECUSADAS) {
    re.lastIndex = 0;
    const m = re.exec(sql);
    if (m) {
      throw new Error(`schema.mjs: ${file} usa uma forma que este leitor NÃO modela — ${porque}.\n  ${m[0].replace(/\s+/g, " ").trim()}\nAceitar pela metade faria o dicionário de dados, a matriz de RLS e o inventário descreverem um schema que não existe — e VERDES.`);
    }
  }
}

function aplicar(tables, op, file) {
  if (op.tipo === "criarTabela") {
    const entry = tables.get(op.tabela) ?? { table: op.tabela, file, columns: new Map(), constraints: [], historico: new Set() };
    for (const def of splitTopLevel(op.corpo)) {
      if (CONSTRAINT_START.test(def)) { entry.constraints.push(def.replace(/\s+/g, " ")); continue; }
      const col = parseColumn(def);
      if (col) { entry.columns.set(col.name, col); entry.historico.add(col.name); }
    }
    // chave primária declarada como constraint de tabela
    for (const c of entry.constraints) {
      const pk = /^primary\s+key\s*\(([^)]*)\)/i.exec(c);
      if (pk) for (const name of pk[1].split(",").map((s) => s.trim())) { const col = entry.columns.get(name); if (col) col.primaryKey = true; }
    }
    tables.set(op.tabela, entry);
    return;
  }
  const entry = tables.get(op.tabela);
  if (!entry) return;
  if (op.tipo === "adicionarColuna") {
    const col = parseColumn(op.definicao);
    if (col) { entry.columns.set(col.name, { ...col, addedIn: file }); entry.historico.add(col.name); }
    return;
  }
  if (op.tipo === "removerColuna") {
    // A coluna some do modelo, e a constraint de tabela que a citava some junto — é o que o PostgreSQL faz
    // com índices e constraints dependentes da coluna removida. Sem isto, `company-schema-sync` e a matriz
    // continuariam lendo uma FK composta que não existe mais.
    for (const nome of op.colunas) {
      // `historico` NAO perde o nome: e exatamente o que permite ao gate de espelho saber, depois da purga,
      // que aquele par EXISTIU e portanto ainda deve ser cobrado (ver o bloco de doc de `historico`).
      entry.columns.delete(nome);
      entry.constraints = entry.constraints.filter((c) => !new RegExp(`\\b${nome}\\b`, "i").test(c));
    }
    entry.droppedIn = file;
    return;
  }
  if (op.tipo === "obrigatoriedade") {
    const col = entry.columns.get(op.coluna);
    if (col) col.notNull = op.notNull;
    return;
  }
  if (op.tipo === "renomearTabela") {
    const novo = `${op.tabela.split(".")[0]}.${op.novo}`;
    tables.delete(op.tabela);
    // O spread leva `historico` junto: a historia e da TABELA, e ela nao comeca do zero por ter mudado de nome.
    tables.set(novo, { ...entry, table: novo, renamedFrom: op.tabela, renamedIn: file });
    return;
  }
  if (op.tipo === "removerTabela") {
    // LÁPIDE, não esquecimento. Apagar a entrada faria a tabela — e a história dela — sumirem juntas, e um
    // gate que conta pares históricos veria 51 onde havia 52 sem nada a reclamar: o mesmo verde de limiar
    // global que esta fatia existe para eliminar, só que deslocado de coluna para TABELA.
    tables.removidas?.set(op.tabela, { ...entry, removidaEm: file });
    tables.delete(op.tabela);
  }
}

/**
 * A HISTORIA DO PAR, E NAO SO O ESTADO FINAL (PRE-BASE2-05C-0).
 *
 * `columns` responde "o que existe agora". Para a fatia destrutiva isso nao basta, e o buraco tem forma
 * exata: depois que a 05C-1 dropar `farm_id` de uma tabela, um leitor que so enxerga o presente nao
 * consegue distinguir
 *   (A) coluna canonica que NASCEU sozinha, sem espelho legado nenhum (erp.notifications e mais tres), de
 *   (B) coluna canonica cujo espelho legado EXISTIA e sumiu.
 * Sao estados opostos — um e correto por construcao, o outro e perda silenciosa —, e sem a historia os dois
 * se parecem. Foi assim que o gate de espelho podia ficar VERDE com 51 dos 52 espelhos: o 52o virava, aos
 * olhos dele, "canonica de nascenca".
 *
 * Por isso cada tabela carrega `historico`: TODA coluna que existiu nela em algum momento da sequencia de
 * migrations. O conjunto so CRESCE — `drop column` tira de `columns` e NAO tira daqui —, atravessa
 * `rename to` junto com a tabela, e desaparece apenas com `drop table`, que e quando a propria tabela deixa
 * de ter historia a contar.
 *
 * A fonte continua sendo uma so: a sequencia de migrations. Nao existe lista paralela de "pares que
 * existiram" para envelhecer em silencio.
 */
export const jaTeveColuna = (t, coluna) => Boolean(t?.historico?.has(coluna));

/** Map<"erp.tabela", { table, file, columns: Map<coluna, coluna>, constraints: string[], historico: Set<coluna> }> */
export function readSchema(dir = MIGRATIONS_DIR) {
  const tables = new Map();
  // Propriedade do Map, não uma entrada: `for…of` e `.size` continuam vendo só as tabelas VIVAS, e nenhum
  // consumidor precisa mudar para ganhar a lápide.
  tables.removidas = new Map();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = stripSqlComments(fs.readFileSync(path.join(dir, file), "utf8"));
    recusarFormaNaoModelada(sql, file);
    for (const op of alteracoesNaOrdemDoArquivo(sql)) aplicar(tables, op, file);
  }
  return tables;
}

/**
 * Colunas que amarram um registro à EMPRESA. As CANÔNICAS vêm primeiro (PRE-BASE2-03); as legadas continuam
 * listadas porque ainda existem como espelho de compatibilidade e uma tabela pode ter as duas.
 */
export const COMPANY_COLUMNS = ["empresa_id", "empresa_origem_id", "empresa_destino_id", "farm_id", "origin_farm_id", "destination_farm_id"];
/** Só as canônicas — o que o runtime novo pode ler e o que os gates de escopo exigem recortar. */
export const CANONICAL_COMPANY_COLUMNS = ["empresa_id", "empresa_origem_id", "empresa_destino_id"];
export const canonicalCompanyColumnsOf = (t) => CANONICAL_COMPANY_COLUMNS.filter((c) => t.columns.has(c));
export const companyColumnsOf = (t) => COMPANY_COLUMNS.filter((c) => t.columns.has(c));
export const isOrgScoped = (t) => t.columns.has("organization_id");
/**
 * Exclusão lógica nas DUAS grafias. `deleted_at` é o acervo; `excluido_em` é a nomenclatura de destino
 * (`docs/DOMAIN-NAMING-STANDARD.md` §1.6), estreada por `erp.tipos_operacao`. Reconhecer só a primeira faria
 * o dicionário declarar "não" para uma tabela que É soft-deletable — documento gerado dizendo o contrário do
 * schema, que é o defeito que este gerador existe para impedir.
 */
export const isSoftDeletable = (t) => t.columns.has("deleted_at") || t.columns.has("excluido_em");
