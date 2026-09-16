import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createPool, type Db } from "../src/pool.js";
import { resetSchema } from "../src/migrate.js";
import { TEST_URL } from "./setup.js";
import {
  CANONICA, LEGADA, subirAte0017, aplicarCutover, fotoDoContador, linhasDaEntidade,
  empresaComCodigo, contador,
} from "./cutover-0018-ajuda.js";

/**
 * A 0018 RECUSA ESTADO IMPOSSÍVEL — PRE-BASE2-05C-2.
 *
 * Esta é a suíte que decide se a migration é fail-closed de verdade ou só de intenção. Cada caso monta um
 * estado que NÃO PODE atravessar, aplica a 0018 e cobra três coisas ao mesmo tempo:
 *
 *   1. a migration ABORTA (não "corrige", não "ignora", não "escolhe o maior");
 *   2. a mensagem NOMEIA o problema — um erro genérico manda o operador adivinhar às 3 da manhã;
 *   3. o estado do banco fica INTACTO, byte a byte na foto do contador. Uma migration destrutiva que
 *      falha pela metade é pior do que uma que não roda.
 *
 * O item 3 é o que separa esta suíte de um `expect(...).rejects`: a transação do runner tem de ter voltado
 * atrás inteira, e é isso que a comparação da foto prova.
 *
 * Por que `beforeEach` e não `beforeAll`: cada caso precisa de um banco em 0017 limpo. Reaproveitar o
 * banco entre casos faria o estado sujo de um vazar no seguinte, e um teste fail-closed que passa por
 * causa do lixo do teste anterior não prova nada.
 */
let db: Db;

const ORG = "fa1c1050-0000-4000-8000-000000000001";
const ORG2 = "fa1c1050-0000-4000-8000-000000000002";

beforeEach(async () => {
  await db?.end();
  db = createPool(TEST_URL, { max: 4 });
  await resetSchema(db);
  await subirAte0017(db);
  await db.query("insert into erp.organizations (id, name) values ($1,$2), ($3,$4)",
    [ORG, "[TEST] fail-closed 1", ORG2, "[TEST] fail-closed 2"]);
}, 240_000);

afterAll(async () => { await db?.end(); });

/** Aplica o cutover esperando RECUSA, e devolve a mensagem para a asserção de conteúdo. */
async function recusa(): Promise<string> {
  const foto = await fotoDoContador(db);
  const r = await aplicarCutover(db);
  expect(r.ok, "a migration tinha de ABORTAR e não abortou").toBe(false);
  const erro = r.ok ? "" : r.erro;

  // O rollback é metade da prova: nada pode ter sobrado do caminho percorrido antes do `raise`.
  expect(await fotoDoContador(db), `o estado tem de voltar inteiro. Erro: ${erro}`).toEqual(foto);
  const n = Number((await db.query<{ n: string }>(
    "select count(*)::text n from public.erp_migrations where name like '0018%'")).rows[0]!.n);
  expect(n, "e nada pode ter entrado no ledger").toBe(0);
  return erro;
}

describe("a 0018 é fail-closed", () => {
  it("RECUSA quando já existe linha entity='empresa' — o cutover não sobrescreve contador canônico", async () => {
    await empresaComCodigo(db, ORG, 1, "[TEST] E1");
    await contador(db, ORG, LEGADA, 4);
    await contador(db, ORG, CANONICA, 900);           // o estado proibido
    const erro = await recusa();
    expect(erro, "a mensagem nomeia o caso").toMatch(/entity='empresa'|linha\(s\) entity/i);
    expect(erro, "e mostra o valor encontrado, para o operador decidir").toContain("900");
  });

  it("RECUSA farm + empresa simultâneos na MESMA organização — é o estado da cópia, o mais perigoso", async () => {
    await empresaComCodigo(db, ORG, 3, "[TEST] E3");
    await contador(db, ORG, LEGADA, 3);
    await contador(db, ORG, CANONICA, 3);             // as duas linhas de pé: os dois lados emitiriam 4
    const erro = await recusa();
    expect(erro).toMatch(/entity='empresa'/i);
  });

  it("RECUSA organização com Empresa numerada e SEM contador legado — mover nada reiniciaria em 1", async () => {
    await empresaComCodigo(db, ORG, 1, "[TEST] E1");
    await empresaComCodigo(db, ORG, 2, "[TEST] E2");
    // de propósito: nenhuma linha em code_sequences para ORG
    const erro = await recusa();
    expect(erro, "a mensagem diz qual organização").toContain(ORG);
    expect(erro).toMatch(/SEM contador|reiniciar em 1/i);
  });

  it("RECUSA contador legado ATRÁS do maior código já usado — o próximo emitido colidiria", async () => {
    await empresaComCodigo(db, ORG, 10, "[TEST] E10");
    await contador(db, ORG, LEGADA, 4);               // 4 < 10: o próximo seria 5, que não resolve nada
    const erro = await recusa();
    expect(erro).toMatch(/abaixo do maior codigo/i);
    expect(erro, "mostra os dois números que não fecham").toMatch(/last_value=4.*max\(code\)=10/);
  });

  it("RECUSA last_value negativo — isso não é contador, é lixo que viraria numeração", async () => {
    await contador(db, ORG, LEGADA, -1);
    const erro = await recusa();
    expect(erro).toMatch(/negativo/i);
  });

  it("RECUSA se a PK de code_sequences deixar de ser (organization_id, entity)", async () => {
    await contador(db, ORG, LEGADA, 2);
    // A aritmética inteira da fatia se apoia nessa chave. Se ela mudar, "mover a chave" significa outra coisa.
    await db.query("alter table erp.code_sequences drop constraint code_sequences_pkey");
    await db.query("alter table erp.code_sequences add primary key (organization_id, entity, last_value)");
    const erro = await recusa();
    expect(erro).toMatch(/PK de erp\.code_sequences/i);
  });

  it("RECUSA se a ponte física ainda estiver de pé — coluna legada presente significa 0017 incompleta", async () => {
    // A conferência da ordem do roteiro é ESTRUTURAL, e este é o único caso que a cobre. Conferir o ledger
    // seria mais fácil e pior: o ledger é escrituração do runner, não estado do schema — acoplaria a
    // migration ao runner (quebrando todo harness que aplica os arquivos direto) e ainda assim deixaria
    // passar um banco onde a linha existe mas a purga não terminou.
    await contador(db, ORG, LEGADA, 2);
    // Reintroduz UMA coluna da ponte: o predicado da 0018 é estrutural, não depende do ledger.
    await db.query("alter table erp.warehouses add column farm_id uuid");
    const erro = await recusa();
    expect(erro).toMatch(/coluna\(s\) legada\(s\) da ponte fisica/i);
  });

  it("RECUSA se erp.code_sequences não existir", async () => {
    await db.query("drop table erp.code_sequences cascade");
    const r = await aplicarCutover(db);
    expect(r.ok).toBe(false);
    // Aqui não dá para comparar a foto (a tabela sumiu); o que se cobra é a recusa nomeada.
    expect(r.ok ? "" : r.erro).toMatch(/code_sequences/i);
  });

  it("RECUSA quando o papel que aplica NÃO tem bypass de RLS — senão ela atravessa VAZIA e mente no ledger", async () => {
    // O DEFEITO QUE ESTE CASO TRANCA, medido antes da guarda existir: aplicada por um papel sem bypass,
    // a 0018 COMMITAVA `{ok:true}`, o ledger registrava `0018`, e `farm=3` continuava de pé. Nada se
    // movia e nada reclamava — e depois disso o binário HEAD reiniciaria a numeração em 1 sobre o acervo.
    //
    // Por que NENHUM outro caso desta suíte pega isso: `setup.ts` conecta como `postgres`, que é
    // superusuário e portanto ignora RLS. As outras nove provas rodam num mundo onde o defeito é
    // invisível por construção. É preciso um papel de verdade, sem bypass, para que ele apareça.
    //
    // O mecanismo: `0007_rls.sql:62` aplica `force row level security` em toda tabela de `erp` (vale até
    // para o DONO da tabela), e `tenant_isolation` é `to erp_app, authenticated`. Um papel fora dessas
    // roles e sem bypass lê ZERO linha — e com zero linha toda conferência da migration passa vazia.
    const PAPEL = "mig_sem_bypass_0018";
    const SENHA = "mig_sem_bypass_0018";
    await db.query(`drop owned by ${PAPEL} cascade`).catch(() => {});
    await db.query(`drop role if exists ${PAPEL}`).catch(() => {});
    await db.query(`create role ${PAPEL} login nosuperuser nobypassrls password '${SENHA}'`);
    // De propósito GENEROSO nos privilégios: assim o único motivo possível de recusa é a guarda de
    // visibilidade. Um teste que passasse por "permission denied" provaria outra coisa.
    await db.query(`grant usage on schema erp to ${PAPEL}`);
    await db.query(`grant all on all tables in schema erp to ${PAPEL}`);
    await db.query(`grant execute on all functions in schema erp to ${PAPEL}`);
    await db.query(`grant all on public.erp_migrations to ${PAPEL}`);

    await empresaComCodigo(db, ORG, 1, "[TEST] rls1");
    await empresaComCodigo(db, ORG, 2, "[TEST] rls2");
    await contador(db, ORG, LEGADA, 2);
    const foto = await fotoDoContador(db);

    const url = new URL(TEST_URL);
    url.username = PAPEL;
    url.password = SENHA;
    const fraco = createPool(url.toString(), { max: 2 });
    try {
      // A premissa do caso, provada e não suposta: este papel realmente não enxerga o acervo.
      const visiveis = Number((await fraco.query<{ n: string }>(
        "select count(*)::text n from erp.code_sequences")).rows[0]!.n);
      expect(visiveis, "o papel fraco tem de estar CEGO — sem isso o caso não prova nada").toBe(0);

      const r = await aplicarCutover(fraco);
      expect(r.ok, "a migration tinha de ABORTAR para um papel que não enxerga o acervo").toBe(false);
      const erro = r.ok ? "" : r.erro;
      expect(erro, "e a mensagem NOMEIA o papel e o motivo").toMatch(/bypass de RLS/i);
      expect(erro, "publicar o NOME do papel é o que o operador precisa").toContain(PAPEL);
    } finally {
      await fraco.end();
    }

    // As duas metades que transformam "abortou" em "não fez estrago": estado intacto e ledger limpo.
    expect(await fotoDoContador(db), "o contador não pode ter se mexido").toEqual(foto);
    expect(await linhasDaEntidade(db, LEGADA), "a chave legada continua exatamente onde estava").toBe(1);
    const ledger = Number((await db.query<{ n: string }>(
      "select count(*)::text n from public.erp_migrations where name like '0018%'")).rows[0]!.n);
    expect(ledger, "e o ledger NÃO pode registrar um cutover que não aconteceu").toBe(0);

    await db.query(`drop owned by ${PAPEL} cascade`).catch(() => {});
    await db.query(`drop role if exists ${PAPEL}`).catch(() => {});
  });

  it("ACEITA o caminho feliz — a premissa de todos os casos acima", async () => {
    // Sem este caso, um erro qualquer na montagem faria os oito testes acima "passarem" por motivo errado.
    await empresaComCodigo(db, ORG, 1, "[TEST] ok1");
    await empresaComCodigo(db, ORG, 2, "[TEST] ok2");
    await contador(db, ORG, LEGADA, 2);
    await contador(db, ORG2, LEGADA, 77);
    const r = await aplicarCutover(db);
    expect(r.ok ? "aplicou" : r.erro).toBe("aplicou");
    expect(await linhasDaEntidade(db, LEGADA)).toBe(0);
    expect(await linhasDaEntidade(db, CANONICA)).toBe(2);
  });
});
