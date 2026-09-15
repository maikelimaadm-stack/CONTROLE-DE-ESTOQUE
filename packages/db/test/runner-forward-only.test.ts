import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPool, type Db } from "../src/pool.js";
import { migrate, resetSchema, listMigrations } from "../src/migrate.js";
import { TEST_URL } from "./setup.js";

/**
 * O RUNNER DE MIGRATIONS É FORWARD-ONLY, E CONTINUA AVANÇANDO DEPOIS DE UMA DIVERGÊNCIA (PRE-BASE2-05C-G2).
 *
 * A pergunta mais cara do preflight destrutivo era "um rollback reexecuta o pre-deploy?". Nenhuma página
 * oficial do Railway afirma nem nega. A pergunta estava errada: o que importa não é SE ele reexecuta, é o
 * que acontece QUANDO reexecuta.
 *
 * O cenário é este: a 05C-1 aplica a purga, o deploy vai mal por qualquer motivo, e o Railway volta para a
 * imagem ANTERIOR — cujo diretório de migrations NÃO contém a migration que já está no ledger. Duas coisas
 * precisam ser verdade, e são DUAS, não uma:
 *
 *   1. o runner não tenta "reconciliar" a divergência — senão um rollback de CÓDIGO viraria downgrade de
 *      BANCO, e a fatia destrutiva ficaria sem caminho de volta;
 *   2. o runner CONTINUA APLICANDO o que for novo — senão o banco fica preso no estado divergente e o
 *      caminho para a frente some junto, que é o modo de falha mais silencioso dos dois.
 *
 * Provar só (1) não basta, e é fácil se enganar aqui: um runner que simplesmente PARA diante de um ledger
 * desconhecido satisfaz (1) perfeitamente. Por isso o último caso deste arquivo obriga uma migration nova
 * a ser aplicada COM a divergência presente.
 *
 * `migrate()` itera sobre o DIRETÓRIO e usa o ledger apenas para PULAR. Não existe `down` e não existe
 * comparação ledger × diretório. O que remove schema é `resetSchema`, e é preciso dizer com precisão o que
 * protege o quê: a trava `ALLOW_DB_RESET=1` está no comando `reset` do cli, NÃO na função — que é exportada
 * e chamável por qualquer importador de `@agro/db`, inclusive o `beforeAll` deste arquivo. A separação é de
 * caminho de execução, não de permissão.
 *
 * A divergência é montada do jeito que ela realmente aparece — uma LINHA NO LEDGER cujo arquivo o binário
 * corrente não tem — em vez de trocar `MIGRATIONS_DIR` do módulo principal, que é lido uma vez na carga e
 * não representaria o binário anterior de forma honesta.
 *
 * O QUE ESTE ARQUIVO NÃO PROVA, e por isso está escrito aqui:
 * - que o BINÁRIO anterior funciona contra o schema pós-purga. É outra pergunta: a auditoria estática do
 *   runtime não achou consulta dependente dos objetos removidos, mas a prova de execução é o gate G-U5,
 *   que nasce com a própria 05C-1 (ver docs/PRE-BASE2-05C-1-PREFLIGHT.md);
 * - que `seedPermissions` sobrevive ao schema pós-purga. Este arquivo nunca o chama. Aquele número saiu de
 *   um experimento manual do preflight e continua sendo experimento manual — não vire teste por citação;
 * - que o pre-deploy tem teto de tempo. Não tem: `preDeployTimeoutSeconds` é nulo (U4 do preflight);
 * - que duas execuções SIMULTÂNEAS de `migrate()` são seguras. Não há advisory lock nem trava equivalente:
 *   dois pre-deploys sobrepostos (retentativa por restart policy, redeploy em cima de outro) não estão
 *   cobertos por teste nenhum, aqui nem em lugar algum do repositório;
 * - que o ledger detecta mudança de CONTEÚDO de um arquivo já aplicado. A chave é só o NOME: um arquivo com
 *   o mesmo nome e SQL diferente é pulado em silêncio.
 *
 * Em uma frase: aqui se prova que um rollback de código não degrada o banco e não trava o caminho para a
 * frente. "Rollback seguro" é maior do que isso, e o que falta está nomeado acima.
 */
let db: Db;
/** Quantas tabelas o schema tem logo depois do `migrate` inicial — âncora exata, não piso frouxo. */
let tabelasNoInicio = 0;

/** Nenhum destes existe em supabase/migrations — é justamente esse o ponto. */
const FUTURA = "9017_purga_que_o_binario_anterior_nao_conhece.sql";
/** ORDENA ABAIXO de FUTURA de proposito: ver o comentario do caso do roll-forward. */
const NOVA = "0016b_hotfix_que_ordena_abaixo_da_divergente.sql";
const INVALIDA = "0016c_migration_que_falha_de_proposito.sql";
const MARCA = "public.marca_purga_ficticia";
const MARCA_NOVA = "public.marca_roll_forward";
const MARCA_FALHA = "public.marca_que_nunca_deveria_existir";

async function contarTabelasErp(): Promise<number> {
  const r = await db.query<{ n: string }>(
    "select count(*)::text n from information_schema.tables where table_schema='erp' and table_type='BASE TABLE'");
  return Number(r.rows[0]!.n);
}

/**
 * Monta o estado de rollback e é idempotente de propósito: cada `it` que precisa dele o chama, em vez de
 * herdar do `it` anterior. Teste que só passa na ordem em que foi escrito passa a reprovar quando alguém
 * roda um caso isolado com `-t`, e aí a leitura errada é "o teste é instável".
 */
async function montarDivergencia() {
  await db.query(`create table if not exists ${MARCA}(id int primary key)`);
  await db.query(`insert into ${MARCA} values (1) on conflict (id) do nothing`);
  await db.query("insert into public.erp_migrations(name) values ($1) on conflict (name) do nothing", [FUTURA]);
}

async function limpar() {
  await db.query(`drop table if exists ${MARCA}`);
  await db.query(`drop table if exists ${MARCA_NOVA}`);
  await db.query(`drop table if exists ${MARCA_FALHA}`);
  await db.query("delete from public.erp_migrations where name = any($1::text[])", [[FUTURA, NOVA, INVALIDA]]);
}

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 2 });
  await resetSchema(db);
  await migrate(db, () => {});
  await limpar();
  tabelasNoInicio = await contarTabelasErp();
  expect(tabelasNoInicio, "o schema do produto subiu inteiro antes de qualquer caso").toBeGreaterThan(100);
}, 240_000);

afterAll(async () => {
  try {
    await limpar();
  } finally {
    // sem o finally, uma falha na limpeza (banco fora do ar, por exemplo) vaza o pool e esconde a causa raiz
    // atrás de um segundo erro.
    await db?.end();
  }
});

describe("o runner de migrations é forward-only", () => {
  it("parte de um ledger que cobre exatamente o diretório", async () => {
    const noDisco = listMigrations().map((m) => m.name);
    const ledger = await db.query<{ name: string }>("select name from public.erp_migrations order by name");
    const fabricadas = new Set([FUTURA, NOVA, INVALIDA]);
    // A premissa junto com a conclusão: sem migrations no disco, todo o resto passaria por vacuidade.
    expect(noDisco.length, "há migrations reais no diretório").toBeGreaterThanOrEqual(16);
    for (const f of fabricadas) expect(noDisco, "as fictícias não existem no repositório").not.toContain(f);
    // Descontar o que ESTE arquivo fabrica torna o caso independente da ordem de execução.
    expect(ledger.rows.map((r) => r.name).filter((n) => !fabricadas.has(n))).toEqual(noDisco);
  });

  it("uma entrada no ledger que o diretório NÃO conhece não é desfeita, e não faz o runner falhar", async () => {
    await montarDivergencia();

    const feitas = await migrate(db, () => {});

    expect(feitas, "nada a aplicar: o diretório não tem novidade").toEqual([]);
    const ledger = await db.query<{ n: string }>("select count(*)::text n from public.erp_migrations where name = $1", [FUTURA]);
    expect(ledger.rows[0]!.n, "a entrada desconhecida continua no ledger — o runner não a remove").toBe("1");
    const marca = await db.query<{ n: string }>(`select count(*)::text n from ${MARCA}`);
    expect(marca.rows[0]!.n, "o efeito da migration futura sobreviveu intacto").toBe("1");
  });

  it("e continua assim na execução seguinte — idempotente, nunca reconciliador", async () => {
    await montarDivergencia();

    const feitas = await migrate(db, () => {});

    expect(feitas).toEqual([]);
    const ainda = await db.query<{ n: string }>("select count(*)::text n from public.erp_migrations where name = $1", [FUTURA]);
    expect(ainda.rows[0]!.n).toBe("1");
  });

  it("COM a divergência presente, uma migration nova ainda é aplicada — o caminho para a frente não trava", async () => {
    await montarDivergencia();

    // Um diretório temporário com UMA migration inédita. É a única forma honesta de exercer o avanço: o
    // diretório real não tem pendência nenhuma depois do beforeAll, então `done = []` ali é verdadeiro para
    // QUALQUER implementação — inclusive uma que tenha desistido de aplicar seja o que for.
    //
    // O NOME importa, e é contraintuitivo: a migration nova ordena ABAIXO da divergente. Um runner que
    // decidisse por "marca d'água" — pular tudo que ordena antes do maior nome já no ledger, em vez de
    // consultar o ledger nome a nome — passaria batido se a nova ordenasse depois. É o cenário real de um
    // hotfix numerado entre duas migrations enquanto o ledger já tem algo maior.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-roll-forward-"));
    const anterior = process.env.MIGRATIONS_DIR;
    try {
      fs.writeFileSync(path.join(dir, NOVA),
        `create table ${MARCA_NOVA}(id int primary key);\ninsert into ${MARCA_NOVA} values (1);\n`);

      // MIGRATIONS_DIR é lido na CARGA do módulo; recarregar é o que dá um runner apontado para o diretório
      // novo sem mexer no módulo que os outros casos usam.
      process.env.MIGRATIONS_DIR = dir;
      vi.resetModules();
      const outro = await import("../src/migrate.js");
      expect(outro.MIGRATIONS_DIR, "o módulo recarregado enxerga o diretório temporário").toBe(dir);

      const feitas = await outro.migrate(db, () => {});

      expect(feitas, "a migration nova FOI aplicada, apesar do ledger divergente").toEqual([NOVA]);
      const efeito = await db.query<{ n: string }>(`select count(*)::text n from ${MARCA_NOVA}`);
      expect(efeito.rows[0]!.n, "e o efeito dela está no banco").toBe("1");
      const registrada = await db.query<{ n: string }>(
        "select count(*)::text n from public.erp_migrations where name = $1", [NOVA]);
      expect(registrada.rows[0]!.n, "e ficou registrada no ledger").toBe("1");
      const intacta = await db.query<{ n: string }>(
        "select count(*)::text n from public.erp_migrations where name = $1", [FUTURA]);
      expect(intacta.rows[0]!.n, "sem tocar na entrada divergente").toBe("1");
    } finally {
      if (anterior === undefined) delete process.env.MIGRATIONS_DIR;
      else process.env.MIGRATIONS_DIR = anterior;
      vi.resetModules();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("migration que falha ABORTA: nada aplicado, nada no ledger, exceção propagada", async () => {
    // Sem este caso, um runner que engolisse o erro (try/catch silencioso, `continue` no lugar do `throw`)
    // passaria em todos os outros: eles só olham para o caminho feliz. Aqui o arquivo é SQL inválido de
    // propósito, e o que se exige é o contrário do verde: exceção, ledger limpo, efeito nenhum.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-falha-"));
    const anterior = process.env.MIGRATIONS_DIR;
    try {
      fs.writeFileSync(path.join(dir, INVALIDA),
        `create table ${MARCA_FALHA}(id int primary key);\nisto nao e sql valido;\n`);

      process.env.MIGRATIONS_DIR = dir;
      vi.resetModules();
      const outro = await import("../src/migrate.js");

      await expect(outro.migrate(db, () => {}), "o erro sobe, não é engolido").rejects.toThrow(/failed/);

      const registrada = await db.query<{ n: string }>(
        "select count(*)::text n from public.erp_migrations where name = $1", [INVALIDA]);
      expect(registrada.rows[0]!.n, "migration que falhou NÃO entra no ledger").toBe("0");
      const efeito = await db.query<{ n: string }>(
        "select count(*)::text n from information_schema.tables where table_schema='public' and table_name=$1",
        [MARCA_FALHA.replace("public.", "")]);
      expect(efeito.rows[0]!.n, "e o que ela chegou a criar foi desfeito pelo rollback").toBe("0");
    } finally {
      if (anterior === undefined) delete process.env.MIGRATIONS_DIR;
      else process.env.MIGRATIONS_DIR = anterior;
      vi.resetModules();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("o schema do produto continua de pé depois de tudo isso", async () => {
    // Igualdade exata contra a contagem medida logo após o migrate inicial: um piso como "> 100" toleraria
    // a queda de dezenas de tabelas sem reprovar.
    expect(await contarTabelasErp(), "o runner não derrubou nada do schema erp").toBe(tabelasNoInicio);
  });
});
