#!/usr/bin/env node
/**
 * MATRIZ DE RLS EMPRESARIAL — gerador e catraca (PRE-BASE2-03).
 *
 * Cruza o SCHEMA REAL (lido do texto das migrations) com a classificação de
 * `packages/domain/empresa-rls.mjs` e escreve `docs/COMPANY-RLS-MATRIX.md`.
 *
 * `--check` falha o CI quando o documento está desatualizado OU quando aparece uma tabela com coluna
 * canônica de empresa sem classificação. É o guarda que o §50 da missão pede: uma tabela nova com
 * `empresa_id` criada amanhã não passa despercebida — ela precisa de uma decisão registrada, não do silêncio
 * de uma lista manual que ninguém lembrou de atualizar.
 *
 * A existência REAL da política no banco é conferida por `apps/api/test/integration/rls-matriz.test.ts`:
 * este gate roda sem banco (no job de qualidade), e "a matriz diz" não é o mesmo que "o banco faz".
 */
import fs from "node:fs";
import path from "node:path";
import { readSchema, CANONICAL_COMPANY_COLUMNS, REPO_ROOT } from "./lib/schema.mjs";
import { CATEGORIAS, EXCECOES_RLS_EMPRESA, classificarTabela, politicaEsperada , politicasEsperadas} from "../packages/domain/empresa-rls.mjs";

const DOC = path.join(REPO_ROOT, "docs", "COMPANY-RLS-MATRIX.md");
const MODULO_POR_TABELA = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "scripts", "company-rls-modules.json"), "utf8"));

const schema = readSchema();
const linhas = [];
const semClassificacao = [];

for (const [nome, t] of [...schema].sort(([a], [b]) => a.localeCompare(b))) {
  const tabela = nome.replace(/^erp\./, "");
  // `erp.empresas` não tem coluna de empresa: a empresa dela é o próprio `id`. É a categoria D, e deixá-la
  // fora da matriz esconderia justamente a tabela que alimenta o seletor de contexto de trabalho.
  const colunas = tabela === "empresas" ? ["id"] : CANONICAL_COMPANY_COLUMNS.filter((c) => t.columns.has(c));
  if (!colunas.length) continue;
  const unica = t.columns.get("empresa_id");
  const anulavel = Boolean(unica && !unica.notNull);
  const categoria = classificarTabela(tabela, colunas, anulavel);
  const excecao = EXCECOES_RLS_EMPRESA[tabela];
  const modulo = MODULO_POR_TABELA[tabela];
  if (!modulo && !excecao && categoria !== "D") semClassificacao.push(`${tabela}: sem módulo declarado em scripts/company-rls-modules.json`);
  linhas.push({
    tabela, colunas, categoria, anulavel,
    modulo: modulo ?? (categoria === "D" ? "(seletor: união dos módulos)" : "—"),
    politica: politicaEsperada(categoria),
    porComando: (() => {
      const e = politicasEsperadas(categoria);
      if (!e) return "— (a proteção é outra; ver justificativa)";
      const rot = { leitura: "leitura", escrita: "**escrita**", tenant: "tenant" };
      return Object.values(e).map((f) =>
        f.cmd === "ALL" ? `ALL: using=${rot[f.using]} · check=${rot[f.check]}`
        : `${f.cmd}: ${f.using ? `using=${rot[f.using]}` : ""}${f.using && f.check ? " · " : ""}${f.check ? `check=${rot[f.check]}` : ""}`
      ).join("<br>");
    })(),
    leitura: categoria === "C" ? "qualquer ponta no escopo"
      : categoria === "D" ? "empresa visível em ALGUM módulo (união)"
      : categoria === "B" ? "empresa no escopo do módulo; registro SEM empresa continua visível"
      : categoria === "A" ? "empresa no escopo do módulo"
      : "regra própria (ver justificativa)",
    escrita: categoria === "C" ? "criar e APAGAR respondem pela ORIGEM; alterar vale por qualquer ponta (o destinatário aceita/cancela), e mudar as PONTAS exige a origem — gatilho `trg_travar_pontas`"
      : categoria === "D" ? "tenant (criar empresa é ato de organização)"
      : categoria === "B" ? "empresa no escopo; SEM empresa exige escopo total do módulo"
      : categoria === "A" ? "empresa no escopo do módulo"
      : "regra própria (ver justificativa)",
    justificativa: excecao ? `${excecao.motivo} Protegida por: ${excecao.protegidaPor}` : ""
  });
}

const contagem = Object.fromEntries(Object.keys(CATEGORIAS).map((c) => [c, linhas.filter((l) => l.categoria === c).length]));

const md = `<!-- GERADO por scripts/company-rls-matrix.mjs — não edite à mão. -->
# Matriz de RLS empresarial

> Documento **gerado**: \`node scripts/company-rls-matrix.mjs\`. Conferido no \`lint\` (\`--check\`) contra o
> schema real, e conferido contra o BANCO por \`apps/api/test/integration/rls-matriz.test.ts\`.

Desde a PRE-BASE2-03 a autoridade efetiva de um registro é **TENANT (RLS) ∧ ESCOPO DE EMPRESA (RLS) ∧
CAPACIDADE (API)**. A capacidade continua na aplicação de propósito: ela é por ROTA, e o banco não sabe qual
rota está rodando.

**O erro que a migration evita.** Políticas \`PERMISSIVE\` do PostgreSQL combinam com **OR**. Acrescentar uma
política de empresa ao lado da \`tenant_isolation\` existente não restringiria nada — a antiga sozinha
continuaria liberando a organização inteira. Por isso cada política tenant-only foi **substituída**, nunca
somada, e há um teste que reintroduz a política antiga de propósito e exige que o vazamento reapareça.

**Módulo indefinido.** Rota de organização e porta de permissão dinâmica abrem a transação sem módulo. Nesse
caso o predicado vale a **união** das empresas visíveis em algum módulo — nunca "todas", nunca "nada".

**Uma política POR COMANDO onde leitura ≠ escrita.** O PostgreSQL aplica \`using\` no SELECT, no UPDATE da
linha ANTIGA e no DELETE; e \`with check\` no INSERT e no UPDATE da linha NOVA. Uma política \`for all\`
tem um \`using\` só — então, quando a regra de escrita é mais restrita que a de leitura, ela passa a dizer
que **poder ler é poder apagar**, e que uma linha legível pode ser TRANSFORMADA em qualquer linha que passe
no \`with check\`. Isso vale para dois casos desta matriz:

- **B (empresa anulável)** — nulo é "da ORGANIZAÇÃO". Quem enxerga uma empresa lê a linha global, mas não
  pode apagá-la nem convertê-la numa linha da empresa dele.
- **C (transferência)** — lê-se por qualquer ponta; APAGAR e ALTERAR respondem pela ORIGEM. Receber não é
  poder desfazer o envio.

Onde leitura = escrita (**A**, empresa obrigatória), a política \`for all\` continua: dividir ali repetiria
a mesma expressão quatro vezes. A coluna "Semântica POR COMANDO" diz qual predicado cada comando usa, e
\`apps/api/test/integration/rls-matriz.test.ts\` confere isso contra \`pg_policies\` (cmd, qual, with_check
e nenhuma segunda política PERMISSIVE no mesmo comando).

**Forma do predicado (e por que ela importa).** O predicado de leitura é escrito INLINE na política:

\`\`\`sql
(empresa_id is null
 or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))          -- InitPlan: 1×
 or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))  -- hashed SubPlan: 1×
\`\`\`

Chamar \`erp.empresa_no_escopo(empresa_id)\` diria a mesma coisa, mas é um predicado POR LINHA: o executor
o chama uma vez para cada linha lida, e cada chamada roda dois \`exists\`. Medido em base com volume
(200 mil movimentações, 100 mil títulos, 30 empresas, membro com 10 delas no escopo), pelo papel da
aplicação, com \`EXPLAIN (analyze)\`:

| Caminho | Predicado por linha | Predicado resolvido 1× | Ganho |
| --- | ---: | ---: | ---: |
| Financeiro — títulos em aberto (janela de 50) | 34 393 ms | **55 ms** | 625× |
| Financeiro — painel, agregado por direção | 30 039 ms | **58 ms** | 518× |
| Relatório — movimentações × armazém (junção de duas tabelas de empresa) | 20 623 ms | **107 ms** | 193× |
| Estoque — listagem de movimentações (janela de 50) | 4 081 ms | **13 ms** | 314× |
| Estoque — contagem em janela (1 000) | 1 017 ms | **2 ms** | 509× |
| Estoque — listagem com empresa selecionada | 28 ms | **10 ms** | 2,8× |
| Seletor de empresa (módulo indefinido = união) | 10 ms | **1 ms** | 10× |

O recorte é idêntico nas duas formas (10 de 30 empresas: 66 669 de 200 000 movimentações, 33 339 de 100 000
títulos, 10 empresas no seletor) — muda o PLANO, não a autorização. Só a leitura precisa dessa forma:
\`with check\` roda por linha escrita, onde uma chamada é uma chamada.

## Categorias

${Object.entries(CATEGORIAS).map(([k, v]) => `- **${k}** — ${v} (${contagem[k]} tabela${contagem[k] === 1 ? "" : "s"})`).join("\n")}

## Tabelas (${linhas.length})

| Tabela | Coluna(s) canônica(s) | Módulo | Cat. | Nulo? | Leitura | Escrita | Semântica POR COMANDO |
| --- | --- | --- | :---: | :---: | --- | --- | --- |
${linhas.map((l) => `| \`erp.${l.tabela}\` | ${l.colunas.map((c) => `\`${c}\``).join(" + ")} | ${l.modulo} | ${l.categoria} | ${l.anulavel ? "sim" : "não"} | ${l.leitura} | ${l.escrita} | ${l.porComando} |`).join("\n")}

## Exceções — por que a RLS empresarial genérica não se aplica

Nenhuma linha aqui significa "sem proteção": significa "protegida por outra regra", e a regra está nomeada.

| Tabela | Cat. | Justificativa |
| --- | :---: | --- |
${linhas.filter((l) => l.justificativa).map((l) => `| \`erp.${l.tabela}\` | ${l.categoria} | ${l.justificativa} |`).join("\n")}
`;

if (semClassificacao.length) {
  console.error("company-rls-matrix: tabela com coluna de empresa sem classificação:");
  for (const p of semClassificacao) console.error(`  - ${p}`);
  console.error("\nDeclare o módulo em scripts/company-rls-modules.json ou registre a exceção com motivo em");
  console.error("packages/domain/empresa-rls.mjs. Tabela com empresa e sem decisão registrada é a forma mais");
  console.error("silenciosa de um vazamento novo entrar: ninguém escolheu deixá-la de fora.");
  process.exit(1);
}

const atual = fs.existsSync(DOC) ? fs.readFileSync(DOC, "utf8") : "";
if (process.argv.includes("--check")) {
  if (atual !== md) { console.error("company-rls-matrix: docs/COMPANY-RLS-MATRIX.md desatualizado — rode `node scripts/company-rls-matrix.mjs`."); process.exit(1); }
  console.log(`company-rls-matrix: OK (${linhas.length} tabelas classificadas)`);
} else {
  fs.writeFileSync(DOC, md);
  console.log(`company-rls-matrix: docs/COMPANY-RLS-MATRIX.md gerado (${linhas.length} tabelas)`);
}
