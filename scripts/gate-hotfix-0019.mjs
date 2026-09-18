#!/usr/bin/env node
/**
 * GATE DO HOTFIX PRÉ-BASE2-03 — a matriz de version skew da numeração de transferências, provada.
 *
 *   pnpm gate:0019
 *
 * É O GATE MAIS IMPORTANTE DESTA FATIA, e a razão é a ordem real do deploy: o pre-deploy da Railway
 * aplica a migration ANTES de o container antigo ser drenado. Durante a janela de rolling deploy o
 * binário BASE continua no ar contra um banco JÁ pós-0019. Se essa combinação não for correta, o hotfix
 * estraga em produção o que ele existe para consertar — e estraga silenciosamente, porque
 * `erp.next_code` é `insert ... on conflict do update`: linha AUSENTE não é erro, é REINÍCIO EM 1.
 *
 * O QUE ELE PROVA — combinações de (runtime, banco), com a criação executada como a rota a executa:
 * UMA transação (`begin` → `next_code` → `insert` → `commit`/`rollback`), que é o que `runService`/`withTx`
 * fazem em produção. O que decide se o estrago PERSISTE é o `commit`, então modelar em autocommit
 * responderia outra pergunta.
 *
 *   Q0   runtime BASE  + banco PRÉ-0019   → a SEGUNDA variante COLIDE (409). É o defeito, medido.
 *   Q1   runtime HEAD  + banco PRÉ-0019   → PROIBIDO: a API nova antes da migration colide com o acervo.
 *   Q1b  idem, acervo começando em M > 1  → JANELA SILENCIOSA: comita 1..M-1 e só então falha em M.
 *   Q2   runtime HEAD  + banco PÓS-0019   → COMPATÍVEL (o mundo de amanhã).
 *   Q3   runtime BASE  + banco PÓS-0019   → COMPATÍVEL — o quadrante que esta fatia COMPRA com o alias.
 *   Q4   BASE e HEAD ALTERNANDO, pós-0019 → COMPATÍVEL: o rolling deploy inteiro, sem colisão nem lacuna.
 *   Q5   rollback de binário (HEAD→BASE)  → COMPATÍVEL: voltar não exige tocar no banco.
 *   C    CORRIDA CROSS-VERSION, com DUAS transações abertas ao mesmo tempo — o quadrante que a auditoria
 *        externa exigiu. Prova que BASE e HEAD, servindo A MESMA ROTA DE REBANHO simultaneamente,
 *        SERIALIZAM na linha do contador em vez de emitir o mesmo número. Inclui a REPRODUÇÃO da corrida
 *        da arquitetura abandonada (dois contadores), para que o quadrante tenha dentes.
 *
 * Q3 É O CONTRÁRIO DA 05C-2, E DE PROPÓSITO. Lá o quadrante equivalente era PROIBIDO — a chave mudava de
 * nome, o banco não tinha como servir os dois binários, e a fatia precisou de janela single-version. Aqui
 * a compatibilidade mora no BANCO: `erp.next_code` canonicaliza `farm_transfer` para `warehouse_transfer`
 * antes do `insert`. O binário BASE pede a chave antiga e recebe número do contador canônico, sem criar
 * linha legada. É isso que torna o AUTODEPLOY NORMAL seguro aqui, e é por isso que o alias NÃO sai nesta
 * fatia: ele é o caminho de rollback.
 *
 * Q1 É O QUE CONTINUA PROIBIDO, e vale dizer por quê ele não é um risco desta fatia: a ordem BANCO → API
 * é a do pre-deploy, e um pre-deploy que falha aborta o deploy. O quadrante existe na matriz para que a
 * ordem esteja PROVADA como necessária, em vez de confiada — e para que a janela silenciosa de Q1b, que é
 * o caso em que ninguém reclama no dia, esteja escrita.
 *
 * COMO ELE EXPIRA SOZINHO
 * -----------------------
 * A forma da alocação de cada lado NÃO é digitada aqui: é lida de `apps/api/src/routes/stock.ts` na base e
 * no HEAD (`scripts/lib/hotfix-0019.mjs`). Iguais nas duas pontas, esta execução não atravessa o hotfix, o
 * gate diz isso e passa — sem simular nada. Com o hotfix JÁ em `main` (`ca74c56`), é o que acontece em toda
 * PR nova, para sempre.
 *
 * O QUE ELE NÃO É
 * ---------------
 * Não fala com produção, não pede credencial e não sobe binário: o que ele exercita é o CONTRATO DE BANCO
 * da numeração, que é onde a (in)compatibilidade mora. A prova com os binários REAIS dos dois lados é o
 * job de version skew do CI. Os dois se complementam e nenhum substitui o outro.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { shaDoRef } from "./lib/cutover-contador.mjs";
import {
  CAMINHO_ROTA, CANONICA, CANONICA_REBANHO, LEGADA, MIGRATION_HOTFIX, decidir, formaNaArvore, formaNoCommit,
} from "./lib/hotfix-0019.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** A raiz do monorepo não declara dependências — `pg` mora em `packages/db`. */
const pg = createRequire(join(RAIZ, "packages/db/package.json"))("pg");
const MIGRATIONS = join(RAIZ, "supabase/migrations");
const URL_BANCO = process.env.GATE_DATABASE_URL ?? process.env.TEST_DATABASE_URL
  ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_test";

const ok = (m) => console.log(`  ✓ ${m}`);
const passo = (m) => console.log(`\n${m}`);
const falhas = [];
const exigir = (cond, m) => { if (cond) ok(m); else { falhas.push(m); console.log(`  ✗ ${m}`); } };

/**
 * A BASE DESTA EXECUÇÃO — resolvida de verdade, nunca um SHA literal.
 * Mesma postura e mesma ordem do gate da 05C-2: um gate ancorado em literal congelado mede o passado, não
 * a PR. Sem base não há matriz, e supor "não atravessa" certificaria um cenário que pode ser impossível.
 */
function baseDaExecucao() {
  const doCi = (process.env.SKEW_BASE_COMMIT ?? "").trim();
  if (doCi) return { sha: doCi, origem: "SKEW_BASE_COMMIT (fixado por esta execução)" };
  const daMain = shaDoRef("origin/main", RAIZ);
  if (daMain) return { sha: daMain, origem: "origin/main (ponta atual)" };
  throw new Error(
    "não consegui resolver a base: não há SKEW_BASE_COMMIT e `origin/main` não é alcançável. "
    + "Sem base não há matriz, e cair num SHA literal faria o gate medir o passado em vez desta execução.");
}

const migrations = () => readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

/** Monta o banco aplicando as migrations até (e sem incluir) `ate`. Mesma ordem e transação do runner. */
async function montar(c, ate) {
  await c.query("drop schema if exists erp cascade; drop table if exists public.erp_migrations;");
  await c.query("create table public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const nome of migrations()) {
    if (ate && nome >= ate) break;
    await c.query("begin");
    await c.query(readFileSync(join(MIGRATIONS, nome), "utf8"));
    await c.query("insert into public.erp_migrations(name) values ($1)", [nome]);
    await c.query("commit");
  }
}

async function aplicarHotfix(c) {
  await c.query("begin");
  await c.query(readFileSync(join(MIGRATIONS, MIGRATION_HOTFIX), "utf8"));
  await c.query("insert into public.erp_migrations(name) values ($1)", [MIGRATION_HOTFIX]);
  await c.query("commit");
}

/**
 * A CHAVE QUE CADA RUNTIME PEDE — a tradução da forma da rota em comportamento observável.
 *
 * BASE numera POR VARIANTE: `kind='farm'` pede a legada, `kind='warehouse'` pede a canônica.
 * HEAD pede SEMPRE a canônica, seja qual for o `kind`.
 *
 * É a única diferença entre os dois binários no que diz respeito a este hotfix, e é ela que a matriz
 * inteira exercita.
 */
const chaveDoRuntime = (runtime, kind) =>
  runtime === "BASE" && kind === "farm" ? LEGADA : CANONICA;

/**
 * O cenário de produção: uma organização com DUAS empresas, dois armazéns e acervo de transferências já
 * numerado. Os códigos entram como texto zero-padded, exatamente como o runtime os grava.
 */
async function semear(c, rotulo, { codigos = [], kindDoAcervo = "warehouse", contadores = {} } = {}) {
  const org = (await c.query(
    "insert into erp.organizations (name) values ($1) returning id", [`[GATE 0019] ${rotulo}`])).rows[0].id;
  const emp = async (code, nome) => (await c.query(
    "insert into erp.empresas (organization_id, code, name) values ($1,$2,$3) returning id",
    [org, code, `[GATE 0019] ${nome}`])).rows[0].id;
  const e1 = await emp(1, `${rotulo} E1`);
  const e2 = await emp(2, `${rotulo} E2`);
  const arm = async (empresa, iniciais) => (await c.query(
    "insert into erp.warehouses (organization_id, empresa_id, initials, description) values ($1,$2,$3,$4) returning id",
    [org, empresa, iniciais, `${rotulo} ${iniciais}`])).rows[0].id;
  const a1 = await arm(e1, "GA");
  const a2 = await arm(e1, "GB");
  const b1 = await arm(e2, "GC");

  for (const code of codigos) {
    await c.query(
      `insert into erp.warehouse_transfers
         (organization_id, code, transfer_date, kind, empresa_origem_id, origin_warehouse_id, empresa_destino_id, destination_warehouse_id)
       values ($1,$2,'2026-01-01',$3,$4,$5,$6,$7)`,
      [org, String(code).padStart(4, "0"), kindDoAcervo, e1, a1, kindDoAcervo === "farm" ? e2 : e1, kindDoAcervo === "farm" ? b1 : a2]);
  }
  for (const [entidade, valor] of Object.entries(contadores)) {
    await c.query(
      `insert into erp.code_sequences (organization_id, entity, last_value) values ($1,$2,$3)
       on conflict (organization_id, entity) do update set last_value = excluded.last_value`,
      [org, entidade, valor]);
  }
  return { org, e1, e2, a1, a2, b1 };
}

/**
 * A CRIAÇÃO COMO A ROTA A FAZ: UMA TRANSAÇÃO, UMA CONEXÃO.
 *
 * `POST /api/stock/transfers` chama `nextCode(ctx.tx, ...)` e o `insert` com o MESMO `ctx.tx`, dentro do
 * `withTx` (`begin` → serviço → `commit`, `rollback` em erro). A diferença MUDA O RESULTADO: em
 * autocommit a linha de contador que a tentativa cria fica gravada mesmo quando o `insert` falha; numa
 * transação real ela é DESFEITA junto. É o que separa "operação barulhenta sem sequela" de "dano
 * silencioso persistido", e essa distinção é metade do que esta matriz mede.
 */
async function criarTransferencia(c, cen, runtime, kind, rotulo) {
  const entidade = chaveDoRuntime(runtime, kind);
  await c.query("begin");
  let numero = null;
  try {
    numero = Number((await c.query("select erp.next_code($1,$2)::text n", [cen.org, entidade])).rows[0].n);
    await c.query(
      `insert into erp.warehouse_transfers
         (organization_id, code, transfer_date, kind, empresa_origem_id, origin_warehouse_id, empresa_destino_id, destination_warehouse_id)
       values ($1,$2,'2026-06-01',$3,$4,$5,$6,$7)`,
      [cen.org, String(numero).padStart(4, "0"), kind, cen.e1, cen.a1,
        kind === "farm" ? cen.e2 : cen.e1, kind === "farm" ? cen.b1 : cen.a2]);
    await c.query("commit");
    return { entidade, numero, gravou: true, erro: null, rotulo };
  } catch (e) {
    await c.query("rollback").catch(() => { /* a transação já pode ter morrido */ });
    return { entidade, numero, gravou: false, erro: e.message, rotulo };
  }
}

/** O ESTADO QUE SOBROU — é isto que o commit/rollback decide, e é isto que o gate cobra. */
async function estado(c, org) {
  const contadores = (await c.query(
    "select entity, last_value::text v from erp.code_sequences where organization_id=$1 order by entity",
    [org])).rows.map((l) => `${l.entity}=${l.v}`);
  const codigos = (await c.query(
    "select code from erp.warehouse_transfers where organization_id=$1 order by code", [org])).rows.map((l) => Number(l.code));
  return { contadores, codigos };
}

const colidiu = (r) => !r.gravou && /duplicat|unique/i.test(r.erro ?? "");

async function main() {
  let base;
  let formaBase;
  try {
    base = baseDaExecucao();
    formaBase = formaNoCommit(base.sha, RAIZ).modo;
  } catch (e) {
    console.error(`\nNão consegui ler a forma da alocação na base: ${e.message}`);
    console.error("Sem a base não há matriz: o gate REPROVA em vez de supor compatibilidade.");
    process.exit(1);
  }
  const head = formaNaArvore(RAIZ);
  const d = decidir({ base: formaBase, head: head.modo });

  // O SENTIDO INVERTIDO, NOMEADO — em vez de um stack de Postgres três passos adiante.
  // Voltar a rota para o ternário deixa head='por-variante', a matriz rodaria ao contrário e morreria lá
  // na frente num erro de banco cru. Vermelho é o desfecho certo, mas um gate que promete nomear o defeito
  // e entrega um erro de driver convida à leitura errada ("o gate está quebrado") — que é o primeiro passo
  // para afrouxá-lo.
  if (head.modo !== "canonico") {
    console.error(`\nREPROVADO: a alocação canônica é UMA chave para a tabela; este HEAD numera por VARIANTE.`);
    console.error(`  ${CAMINHO_ROTA}: ${head.argumento}`);
    console.error("`erp.warehouse_transfers` tem `unique (organization_id, code)` — sem `kind` —, então as");
    console.error("duas variantes compartilham o namespace e dois contadores colidem. Foi exatamente o");
    console.error("defeito que este hotfix fecha.");
    process.exit(1);
  }

  console.log("HOTFIX PRÉ-BASE2-03 · gate da matriz de version skew da numeração de transferências");
  console.log(`base            ${base.sha} (${base.origem})`);
  console.log(`alocação BASE   '${d.base}'`);
  console.log(`alocação HEAD   '${d.head}'`);
  console.log(`decisão         ${d.motivo}`);
  console.log("modelo          criação em UMA transação (begin → next_code → insert → commit/rollback),");
  console.log("                como runService/withTx fazem em produção");

  if (!d.atravessa) {
    console.log("\nAPROVADO (inativo): esta execução não atravessa o hotfix da numeração.");
    console.log("O version skew normal do CI é a autoridade aqui, e continua obrigatório.");
    return;
  }

  const c = new pg.Client({ connectionString: URL_BANCO });
  await c.connect();
  try {
    // ---------------------------------------------------------------------------------------------
    passo("Q0 · runtime BASE + banco PRÉ-0019 — O DEFEITO, medido em vez de narrado");
    // A premissa de tudo. Se este quadrante NÃO colidisse, a fatia estaria corrigindo algo que não existe,
    // e todos os outros quadrantes estariam medindo outra coisa.
    await montar(c, MIGRATION_HOTFIX);
    let cen = await semear(c, "Q0 defeito");
    let r1 = await criarTransferencia(c, cen, "BASE", "warehouse", "Q0 primeira (armazéns)");
    let r2 = await criarTransferencia(c, cen, "BASE", "farm", "Q0 segunda (empresas)");
    exigir(r1.gravou && r1.numero === 1 && r1.entidade === CANONICA,
      `a variante 'warehouse' nasce com ${r1.numero} pela chave '${r1.entidade}'`);
    exigir(r2.entidade === LEGADA && r2.numero === 1,
      `a variante 'farm' pede '${r2.entidade}', contador próprio, e recebe ${r2.numero} — o MESMO número`);
    exigir(colidiu(r2),
      "e a criação MORRE na unicidade (organization_id, code): é o 409 que o usuário via, na transferência ENTRE EMPRESAS");
    let e = await estado(c, cen.org);
    exigir(e.codigos.join() === "1",
      `o rollback protege o acervo: códigos [${e.codigos}] — o documento da segunda variante não existe`);

    // ---------------------------------------------------------------------------------------------
    passo("Q1 · runtime HEAD + banco PRÉ-0019 — PROIBIDO: a API nova ANTES da migration");
    // Por que ele não é risco desta fatia: a ordem BANCO → API é a do pre-deploy da Railway, e um
    // pre-deploy que falha aborta o deploy. O quadrante existe para que a ordem esteja PROVADA como
    // necessária em vez de confiada.
    cen = await semear(c, "Q1 api antes", { codigos: [1, 2, 3], kindDoAcervo: "farm", contadores: { [LEGADA]: 3 } });
    const antesQ1 = await estado(c, cen.org);
    exigir(antesQ1.contadores.join() === `${LEGADA}=3` && antesQ1.codigos.join() === "1,2,3",
      `premissa: acervo 'farm' numerado 1..3 pelo contador legado [${antesQ1.contadores}]`);
    r1 = await criarTransferencia(c, cen, "HEAD", "farm", "Q1 proibido");
    exigir(r1.entidade === CANONICA && r1.numero === 1,
      `a API nova pede '${r1.entidade}', a linha não existe no banco pré-0019, e next_code REINICIA em ${r1.numero}`);
    exigir(colidiu(r1), "e colide com o acervo que o contador legado já emitiu — falha barulhenta");
    e = await estado(c, cen.org);
    exigir(e.contadores.join() === antesQ1.contadores.join() && e.codigos.join() === antesQ1.codigos.join(),
      `o ROLLBACK devolve tudo: contador [${e.contadores}] · códigos [${e.codigos}] — o acervo fica intacto`);
    // E o que o rollback NÃO resolve, medido: como ele desfaz o incremento junto, a tentativa seguinte
    // aloca EXATAMENTE o mesmo número. Não é ruído, é TRAVAMENTO, e nenhuma retentativa sai dele — é por
    // isso que a ordem BANCO → API é obrigatória, e não uma preferência de rollout. Uma versão anterior
    // deste gate dizia "sem sequela" aqui, e subestimava.
    const deNovo = await criarTransferencia(c, cen, "HEAD", "farm", "Q1 segunda tentativa");
    exigir(colidiu(deNovo) && deNovo.numero === r1.numero,
      `a tentativa SEGUINTE aloca o mesmo ${deNovo.numero} e colide igual: a operação fica travada, não apenas barulhenta`);

    // ---------------------------------------------------------------------------------------------
    passo("Q1b · o mesmo, com acervo começando em M > 1 — JANELA SILENCIOSA antes da colisão");
    // O caso em que ninguém reclama no dia. A chave ressuscitada começa em 1 e sobe de um em um: ela
    // COMITA enquanto os números estiverem livres e só COLIDE ao alcançar o menor código ocupado.
    cen = await semear(c, "Q1b janela", { codigos: [5, 6], kindDoAcervo: "farm", contadores: { [LEGADA]: 6 } });
    const emitidos = [];
    for (let i = 0; i < 6 && (emitidos.length === 0 || emitidos.at(-1).gravou); i++) {
      emitidos.push(await criarTransferencia(c, cen, "HEAD", "farm", `Q1b tentativa ${i + 1}`));
    }
    const comitados = emitidos.filter((x) => x.gravou).map((x) => x.numero);
    exigir(comitados.join() === "1,2,3,4",
      `comitou ${comitados.length} documento(s) [${comitados}] ANTES de qualquer erro — dano já persistido`);
    exigir(colidiu(emitidos.at(-1)) && emitidos.at(-1).numero === 5,
      `e só falhou ao alcançar o menor código ocupado (${emitidos.at(-1).numero})`);
    e = await estado(c, cen.org);
    exigir(e.codigos.join() === "1,2,3,4,5,6",
      `o acervo ficou misturado: [${e.codigos}] — é por isso que a ordem BANCO → API não é preferência`);

    // ---------------------------------------------------------------------------------------------
    passo("Q2 · a 0019 aplica, e o runtime HEAD continua a numeração sem lacuna nem colisão");
    await montar(c, MIGRATION_HOTFIX);
    cen = await semear(c, "Q2 mundo novo", { codigos: [1, 2, 3], kindDoAcervo: "warehouse", contadores: { [CANONICA]: 3 } });
    await aplicarHotfix(c);
    r1 = await criarTransferencia(c, cen, "HEAD", "warehouse", "Q2 armazéns");
    r2 = await criarTransferencia(c, cen, "HEAD", "farm", "Q2 empresas");
    exigir(r1.gravou && r1.numero === 4, `a API nova aloca ${r1.numero} — continua de onde o acervo parou`);
    exigir(r2.gravou && r2.numero === 5 && r2.entidade === CANONICA,
      `e a variante 'farm' aloca ${r2.numero} pela MESMA chave '${r2.entidade}' — 201 nas duas, sem 409`);
    e = await estado(c, cen.org);
    exigir(e.contadores.join() === `${CANONICA}=5` && e.codigos.join() === "1,2,3,4,5",
      `estado persistente: contador [${e.contadores}] · códigos [${e.codigos}]`);

    // ---------------------------------------------------------------------------------------------
    passo("Q3 · runtime BASE + banco PÓS-0019 — O QUADRANTE QUE ESTA FATIA COMPRA");
    // A janela de rolling deploy: o container antigo ainda no ar contra o banco já migrado. Sem o alias,
    // `next_code(org,'farm_transfer')` recriaria a chave legada começando em 1 sobre um acervo já
    // numerado — o modo de falhar que a 0018 documentou. Com o alias, o mesmo pedido cai no contador
    // canônico e o binário antigo fica CORRETO.
    r1 = await criarTransferencia(c, cen, "BASE", "farm", "Q3 binário antigo, banco novo");
    exigir(r1.entidade === LEGADA, `o binário BASE pede a chave legada '${r1.entidade}' — é o que ele sabe fazer`);
    exigir(r1.gravou && r1.numero === 6,
      `e recebe ${r1.numero} do contador CANÔNICO: o alias reescreveu a chave antes do insert`);
    const legadas = Number((await c.query(
      "select count(*)::text n from erp.code_sequences where organization_id=$1 and entity=$2",
      [cen.org, LEGADA])).rows[0].n);
    exigir(legadas === 0, "e NENHUMA linha legada foi recriada — o alias troca a chave, não a ressuscita");
    r2 = await criarTransferencia(c, cen, "BASE", "warehouse", "Q3 binário antigo, outra variante");
    exigir(r2.gravou && r2.numero === 7, `a outra variante do mesmo binário antigo aloca ${r2.numero} — sem colisão`);

    // ---------------------------------------------------------------------------------------------
    passo("Q4 · ROLLING DEPLOY — BASE e HEAD servindo ALTERNADAMENTE ao mesmo banco pós-0019");
    // A janela real não é "um binário e depois o outro": é os dois atendendo requisições intercaladas.
    const roteiro = [["BASE", "farm"], ["HEAD", "farm"], ["BASE", "warehouse"], ["HEAD", "warehouse"],
      ["BASE", "farm"], ["HEAD", "warehouse"]];
    const daJanela = [];
    for (const [runtime, kind] of roteiro) {
      daJanela.push(await criarTransferencia(c, cen, runtime, kind, `Q4 ${runtime}/${kind}`));
    }
    exigir(daJanela.every((x) => x.gravou), `as ${daJanela.length} criações da janela nascem — nenhuma 409`);
    const numeros = daJanela.map((x) => x.numero);
    exigir(new Set(numeros).size === numeros.length, `códigos distintos: [${numeros}]`);
    exigir(numeros.join() === Array.from({ length: numeros.length }, (_, i) => numeros[0] + i).join(),
      "e CONTÍGUOS — a sequência é da tabela, não do binário que atendeu");
    e = await estado(c, cen.org);
    exigir(e.contadores.length === 1 && e.contadores[0].startsWith(`${CANONICA}=`),
      `e a organização continua com UM contador só: [${e.contadores}]`);

    // ---------------------------------------------------------------------------------------------
    passo("Q5 · ROLLBACK DE BINÁRIO — voltar para BASE depois do HEAD, sem tocar no banco");
    // O caminho de volta do deploy: se o HEAD falhar por qualquer motivo, o redeploy da versão anterior
    // tem de ser correto contra o banco já migrado. É por isso que o alias NÃO sai nesta fatia.
    const antesDoRollback = (await estado(c, cen.org)).codigos.length;
    const voltou = await criarTransferencia(c, cen, "BASE", "farm", "Q5 depois do rollback");
    exigir(voltou.gravou, "o binário anterior volta a atender contra o banco pós-0019 e a criação nasce");
    e = await estado(c, cen.org);
    exigir(e.codigos.length === antesDoRollback + 1 && new Set(e.codigos).size === e.codigos.length,
      `acervo consistente depois do rollback: ${e.codigos.length} documentos, todos distintos`);
    exigir(Number(e.contadores[0].split("=")[1]) >= Math.max(...e.codigos),
      `e o contador [${e.contadores}] continua cobrindo o maior código emitido (${Math.max(...e.codigos)})`);
    // ---------------------------------------------------------------------------------------------
    // ---------------------------------------------------------------------------------------------
    passo("C · CORRIDA CROSS-VERSION — duas transações ABERTAS ao mesmo tempo, na rota de REBANHO");
    // Este quadrante existe porque a auditoria externa derrubou a arquitetura anterior desta fatia. Ela
    // dava ao rebanho um contador PRÓPRIO durante a vida do alias, e isso criava uma corrida:
    //
    //   binário BASE -> next_code(org,'farm_transfer') -> alias -> warehouse_transfer     -> B+1
    //   binário HEAD -> next_code(org,'animal_farm_transfer')                             -> B+1
    //
    // Duas LINHAS de `erp.code_sequences`: sem trava em comum, sem enxergar a transação do outro, as duas
    // chegam ao `insert` de `erp.animal_movements` com o MESMO código. Um `select` de "já existe?" não
    // fecha isso — é TOCTOU. E como os dois contadores nascem no mesmo baseline, a colisão acontece no
    // PRIMEIRO par concorrente, não num caso raro.
    //
    // A arquitetura atual faz as DUAS rotas pedirem a MESMA chave enquanto o alias existir. Aqui isso é
    // medido com duas conexões de verdade e barreiras explícitas — nunca `Promise.all` sobre um cliente só,
    // que serializaria por acidente do driver e provaria nada.
    {
      const a = new pg.Client({ connectionString: URL_BANCO });
      const b = new pg.Client({ connectionString: URL_BANCO });
      await a.connect(); await b.connect();
      try {
        const alocar = (cli, org, chave) =>
          cli.query("select erp.next_code($1,$2)::text n", [org, chave]).then((r) => Number(r.rows[0].n));
        const gravarRebanho = (cli, cen, numero) => cli.query(
          `insert into erp.animal_movements
             (organization_id, empresa_id, code, movement_type, movement_date, status)
           values ($1,$2,$3,'farm_transfer','2026-07-01','pending')`,
          [cen.org, cen.e1, String(numero).padStart(5, "0")]);
        /** true se a promessa AINDA não resolveu depois de `ms` — é assim que se prova bloqueio. */
        const aindaBloqueada = (pr, ms) => {
          const marca = Symbol("pendente");
          return Promise.race([pr.then(() => false, () => false),
            new Promise((r) => setTimeout(() => r(marca), ms))]).then((x) => x === marca);
        };

        // C-REPRO · a corrida da arquitetura ABANDONADA, reproduzida.
        await montar(c, MIGRATION_HOTFIX);
        cen = await semear(c, "C repro dois contadores");
        await aplicarHotfix(c);
        // o estado que a arquitetura abandonada produzia: os dois contadores no MESMO baseline
        await c.query(
          `insert into erp.code_sequences (organization_id, entity, last_value)
           select $1, 'animal_farm_transfer', coalesce(
             (select last_value from erp.code_sequences where organization_id=$1 and entity=$2), 0)`,
          [cen.org, CANONICA]);

        await a.query("begin");
        const rA = await alocar(a, cen.org, LEGADA);            // BASE: chave legada, aliasada
        await gravarRebanho(a, cen, rA);                        // grava, NÃO commita

        await b.query("begin");
        const rB = await alocar(b, cen.org, CANONICA_REBANHO);  // HEAD antigo: contador PRÓPRIO
        exigir(rB === rA, `os dois contadores emitem o MESMO numero (${rA} e ${rB}) — nao ha trava em comum`);

        const inserirB = gravarRebanho(b, cen, rB);             // bloqueia no indice unico
        exigir(await aindaBloqueada(inserirB, 300),
          "e o segundo insert fica BLOQUEADO no indice unico enquanto a primeira transacao nao decide");
        await a.query("commit");
        let erroRepro = "";
        try { await inserirB; } catch (e) { erroRepro = e.message; }
        await b.query("rollback").catch(() => {});
        exigir(/duplicat|unique/i.test(erroRepro),
          "quando a primeira comita, a segunda MORRE na unicidade: e a corrida, reproduzida");

        // C1..C8 · a arquitetura ATUAL: as duas rotas pedem a MESMA chave.
        await montar(c, MIGRATION_HOTFIX);
        cen = await semear(c, "C atual chave unica");
        await aplicarHotfix(c);
        // Sem linha de contador — o estado REAL de producao medido no preflight. Se nem o `on conflict`
        // de criacao serializar, a corrida existiria ja no primeiro par.
        const antesDaCorrida = (await c.query(
          "select count(*)::text n from erp.code_sequences where organization_id=$1 and entity=$2",
          [cen.org, CANONICA])).rows[0].n;
        exigir(antesDaCorrida === "0", "premissa: a organizacao comeca SEM linha de contador, como producao hoje");

        await a.query("begin");
        const cA = await alocar(a, cen.org, LEGADA);            // BASE
        await gravarRebanho(a, cen, cA);                        // grava, NAO commita

        await b.query("begin");
        const pB = alocar(b, cen.org, LEGADA);                  // HEAD: MESMA chave
        exigir(await aindaBloqueada(pB, 300),
          "C1 · a alocacao do segundo binario BLOQUEIA na linha do contador — serializacao real, nao sorte");
        await a.query("commit");
        const cB = await pB;
        await gravarRebanho(b, cen, cB);
        await b.query("commit");

        exigir(cB === cA + 1, `C2/C4 · o segundo recebe ${cB}, um a mais que ${cA} — sem 409 e sem repetir`);
        const doisDocs = (await c.query(
          "select count(*)::text n, count(distinct code)::text d from erp.animal_movements where organization_id=$1 and movement_type='farm_transfer'",
          [cen.org])).rows[0];
        exigir(doisDocs.n === "2" && doisDocs.d === "2", `C3 · os DOIS documentos persistem, com codigos distintos`);

        // C8 · ordem invertida
        await b.query("begin");
        const iB = await alocar(b, cen.org, LEGADA);
        await gravarRebanho(b, cen, iB);
        await a.query("begin");
        const pA2 = alocar(a, cen.org, LEGADA);
        exigir(await aindaBloqueada(pA2, 300), "C8 · com a ordem invertida, quem chega depois tambem bloqueia");
        await b.query("commit");
        const iA = await pA2;
        await gravarRebanho(a, cen, iA);
        await a.query("commit");
        exigir(iA === iB + 1, `C8 · e recebe ${iA}, um a mais que ${iB}`);

        // C7 · repetir nao depende de sorte
        const rodadas = [];
        for (let i = 0; i < 5; i++) {
          await a.query("begin");
          const x = await alocar(a, cen.org, LEGADA);
          await gravarRebanho(a, cen, x);
          await b.query("begin");
          const py = alocar(b, cen.org, LEGADA);
          const bloqueou = await aindaBloqueada(py, 150);
          await a.query("commit");
          const y = await py;
          await gravarRebanho(b, cen, y);
          await b.query("commit");
          rodadas.push({ bloqueou, ok: y === x + 1 });
        }
        exigir(rodadas.every((r) => r.bloqueou && r.ok),
          `C7 · 5 rodadas seguidas, todas bloqueando e todas contiguas — nao e timing`);

        // C6 · rollback de uma das transacoes nao corrompe o contador
        const antesRb = Number((await c.query(
          "select last_value::text v from erp.code_sequences where organization_id=$1 and entity=$2",
          [cen.org, CANONICA])).rows[0].v);
        await a.query("begin");
        await alocar(a, cen.org, LEGADA);
        await a.query("rollback");
        const depoisRb = Number((await c.query(
          "select last_value::text v from erp.code_sequences where organization_id=$1 and entity=$2",
          [cen.org, CANONICA])).rows[0].v);
        exigir(depoisRb === antesRb, `C6 · o rollback devolve o contador a ${antesRb} — numero nao consumido`);
        const depoisDoRb = await alocar(c, cen.org, LEGADA);
        exigir(depoisDoRb === antesRb + 1, `C6 · e a alocacao seguinte recebe ${depoisDoRb}, sem lacuna nem repeticao`);

        // C5 · a chave legada nao volta a existir como LINHA
        const legadaViva = Number((await c.query(
          "select count(*)::text n from erp.code_sequences where entity=$1", [LEGADA])).rows[0].n);
        exigir(legadaViva === 0, "C5 · nenhuma linha 'farm_transfer' reapareceu — o alias reescreve antes do insert");

        // E o acervo das DUAS tabelas continua sem duplicidade no namespace real de cada uma.
        const dupRebanho = Number((await c.query(
          `select count(*)::text n from (select organization_id, code from erp.animal_movements
             where movement_type='farm_transfer' group by 1,2 having count(*) > 1) d`)).rows[0].n);
        const dupEstoque = Number((await c.query(
          `select count(*)::text n from (select organization_id, code from erp.warehouse_transfers
             group by 1,2 having count(*) > 1) d`)).rows[0].n);
        exigir(dupRebanho === 0 && dupEstoque === 0, "e nenhuma duplicidade nos dois namespaces");
      } finally {
        await a.end().catch(() => {}); await b.end().catch(() => {});
      }
    }
  } finally {
    await c.end();
  }

  console.log("");
  if (falhas.length) {
    console.error(`REPROVADO: ${falhas.length} afirmação(ões) da matriz não se sustentaram.`);
    for (const f of falhas) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("APROVADO: a matriz de version skew do hotfix 0019 está provada.");
  console.log("  · Q3/Q4/Q5 compatíveis  → rolling deploy e rollback de binário são SEGUROS com o alias;");
  console.log("  · Q1/Q1b proibidos      → a ordem BANCO → API é necessária, e o pre-deploy a garante;");
  console.log("  · o alias NÃO sai nesta fatia: ele é o que sustenta Q3, Q4, Q5 e C;");
  console.log("  · C                     → BASE e HEAD concorrentes na rota de REBANHO SERIALIZAM na linha");
  console.log("                            do contador; a corrida da arquitetura abandonada foi reproduzida");
  console.log("                            no mesmo quadrante, para que ele tenha dentes.");
}

main().catch((e) => { console.error(`\nREPROVADO (erro): ${e.message}`); process.exit(1); });
