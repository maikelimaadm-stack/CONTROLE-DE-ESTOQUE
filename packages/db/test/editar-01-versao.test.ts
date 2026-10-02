import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, withTx, type Db, type Tx, type TenantContext } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * A 0039 (EDITAR-01, decisão 272, item 1.1), PROVADA CONTRA O BANCO — SOBRE ACERVO, COMO O RUNNER APLICA.
 *
 * O que ela promete:
 *   · `erp.sales_documents.version` bigint not null default 0, acrescentada SEM regravar a tabela (o acervo lê 0);
 *   · TODO update, de qualquer caminho e por qualquer papel, soma 1 — inclusive o que não muda nada, o de várias
 *     linhas (cada uma +1) e o que manda um valor explícito (vira old+1); o insert nasce 0;
 *   · o gatilho é o ÚLTIMO BEFORE UPDATE por nome, depois das duas guardas da 0023/0024;
 *   · o papel da aplicação existe e não desliga o gatilho (não é dono, não é superusuário, não troca
 *     session_replication_role, não tem TRIGGER na tabela, não é MEMBRO — nem sem herdar — de papel que faça
 *     alguma dessas coisas, e nenhum ajuste guardado liga `replica` na sessão dele);
 *   · a pré-condição da porta do atraso é o md5 do corpo INTEIRO da 0033, e a pós-condição deixa o EXECUTE dela
 *     só com o dono e o erp_app;
 *   · a porta do atraso (`erp.situacao_atraso_cliente`, 0033) responde também a quem só EDITA venda
 *     (budgets/orders/sales .edit) — antes, zero linhas = falso "em dia" —, com o mesmo corpo e os mesmos privilégios;
 *     quem não tem nenhuma das seis capacidades continua com zero linhas.
 *
 * Banco NOVO esconde a prova: sem documento gravado, "o acervo lê 0 sem regravar" seria verdade sobre conjunto
 * vazio. Este arquivo sobe o banco até a 0038, grava documentos de venda pelo caminho de antes e só então aplica a
 * 0039 como o runner aplica (uma transação), provando antes as recusas dela: a trava (2026,73), o lock_timeout de
 * 2s, a REVERSA de cada pré-condição e a reaplicação.
 *
 * Duas conexões: `db` (superusuário: monta o cenário e lê o catálogo) e `app` (papel da aplicação, SEM bypass de
 * RLS, com as GUCs da transação — o caminho que a API percorre). Papéis de ensaio têm o sufixo _b1 e nascem só
 * dentro de transações desfeitas.
 */
let db: Db; let app: Db; let demo: DemoOrg;
let empresa: string; let cliente: string;
let filenodeAntes: number;
const acervo: string[] = [];
/** A porta do atraso ANTES da 0039 (o corpo da 0033), e os usuários de ensaio por capacidade. */
let fonteAtrasoAntes: string;
const usuarios: Record<string, string> = {};
let vencidoHa10: string;

const ALVO = "0039_versao_do_documento_de_venda.sql";
const GUARDAS = ["trg_sales_documents_classificacao_financeira", "trg_sales_documents_execucao_configurada"];

const ctx = (): TenantContext => ({ orgId: demo.orgId, userId: demo.adminUserId, modulo: "vendas" });
const naApp = <T>(fn: (tx: Tx) => Promise<T>) => withTx(app, ctx(), fn);

async function aplicar(): Promise<void> {
  const m = listMigrations().find((x) => x.name === ALVO);
  expect(m, `${ALVO} precisa existir`).toBeTruthy();
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query(m!.sql);
    await c.query("insert into public.erp_migrations(name) values ($1)", [m!.name]);
    await c.query("commit");
  } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
}
/** Roda a 0039 numa transação DESFEITA no fim (depois de `antes`), e devolve o erro — ou falha, se ela aplicou. */
async function recusaDa0039(antes?: (c: Tx) => Promise<unknown>): Promise<string> {
  const m = listMigrations().find((x) => x.name === ALVO)!;
  const c = await db.connect();
  try {
    await c.query("begin");
    if (antes) await antes(c);
    await c.query(m.sql);
  } catch (e) { return (e as Error).message; } finally { await c.query("rollback").catch(() => {}); c.release(); }
  throw new Error("esperava a 0039 recusar, e ela aplicou");
}
async function erroDe(p: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try { await p; } catch (e) { return e as { code?: string; message: string }; }
  throw new Error("esperava recusa, e o banco aceitou");
}

const noLedger = async () => (await db.query("select 1 from public.erp_migrations where name=$1", [ALVO])).rowCount === 1;
const temColuna = async () => (await db.query(
  "select 1 from pg_attribute where attrelid='erp.sales_documents'::regclass and attname='version' and not attisdropped")).rowCount === 1;
const temFuncao = async () => (await db.query<{ f: string | null }>("select to_regprocedure('erp.sales_documents_versao()')::text f")).rows[0]!.f !== null;
/** Os BEFORE UPDATE por linha da tabela, na ordem em que o PostgreSQL os dispara (nome, collation "C"). */
const beforeUpdate = async () => (await db.query<{ tgname: string }>(
  `select tgname from pg_trigger where tgrelid='erp.sales_documents'::regclass and not tgisinternal
      and (tgtype & 1) = 1 and (tgtype & 2) = 2 and (tgtype & 16) = 16 order by tgname collate "C"`)).rows.map((r) => r.tgname);
/** O acervo, linha a linha, sem a coluna nova (to_jsonb da linha inteira: nenhuma outra coluna pode mudar). */
const retrato = async () => (await db.query<{ id: string; linha: Record<string, unknown> }>(
  "select id, to_jsonb(d) - 'version' linha from erp.sales_documents d where id = any($1) order by id", [acervo])).rows;
let antes: Awaited<ReturnType<typeof retrato>>;
/** A porta do atraso pelo papel da aplicação, com a GUC do usuário dado (tolerância 3 dias). */
const atraso = (userId: string, tolerancia = 3) => withTx(app, { orgId: demo.orgId, userId, modulo: null }, async (tx) => (await tx.query<{ titulos: number; total: string; vencimento_mais_antigo: string | null }>(
  "select titulos, total::text total, vencimento_mais_antigo::text vencimento_mais_antigo from erp.situacao_atraso_cliente($1, $2)", [cliente, tolerancia])).rows);
/** Quem tem EXECUTE na porta do atraso, pela ACL (aclexplode), com o dono incluído. */
const execucaoDaPorta = async () => (await db.query<{ g: string }>(
  `select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end g
     from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'erp.situacao_atraso_cliente(uuid,integer)'::regprocedure and a.privilege_type = 'EXECUTE'`)).rows.map((r) => r.g).sort();
const fonteAtraso = async () => (await db.query<{ src: string }>("select prosrc src from pg_proc where oid = 'erp.situacao_atraso_cliente(uuid,integer)'::regprocedure")).rows[0]!.src;
async function usuarioComPapel(nome: string, permissoes: string[]): Promise<string> {
  const papel = (await db.query<{ id: string }>("insert into erp.roles(organization_id,name) values ($1,$2) returning id", [demo.orgId, `[TEST] E01 ${nome}`])).rows[0]!.id;
  for (const k of permissoes) await db.query("insert into erp.role_permissions(role_id,permission_key) values ($1,$2)", [papel, k]);
  const u = (await db.query<{ id: string }>("insert into erp.users(email,name) values ($1,$2) returning id", [`e01-${nome}@demo.local`, `E01 ${nome}`])).rows[0]!.id;
  await db.query("insert into erp.organization_members(organization_id,user_id,role_id,is_owner,is_active) values ($1,$2,$3,false,true)", [demo.orgId, u, papel]);
  return u;
}
const SEIS = ["budgets.create", "orders.create", "sales.create", "budgets.edit", "orders.edit", "sales.edit"];
/** md5 do prosrc INTEIRO da porta do atraso da 0033 — a pré-condição da 0039 compara com ele (conferido na produção, só leitura). */
const MD5_0033 = "d55df1291552c3fdd19b7c0eecf4d22c";
/** Papéis ACIMA do erp_app (ele é membro, de qualquer forma) que são superusuário, trocam session_replication_role ou têm TRIGGER na tabela. */
const papeisPerigososDoApp = async (q: Tx | Db = db) => (await q.query<{ rolname: string }>(
  `select r.rolname from pg_roles r, pg_roles app where app.rolname = 'erp_app' and r.oid <> app.oid and pg_has_role(app.oid, r.oid, 'MEMBER')
      and (r.rolsuper or has_parameter_privilege(r.oid, 'session_replication_role', 'SET') or has_table_privilege(r.oid, 'erp.sales_documents', 'TRIGGER'))`)).rows.map((r) => r.rolname);
/** Ajustes guardados de session_replication_role que alcançam a sessão do erp_app (o papel dele, ou todos os papéis). */
const ajusteReplica = async () => (await db.query<{ ajuste: string }>(
  `select c.ajuste from pg_db_role_setting s cross join lateral unnest(s.setconfig) c(ajuste)
    where s.setrole in (0, (select oid from pg_roles where rolname = 'erp_app')) and c.ajuste ilike 'session_replication_role=%'`)).rows.map((r) => r.ajuste);

const versao = async (id: string) => (await db.query<{ v: string }>("select version::text v from erp.sales_documents where id=$1", [id])).rows[0]!.v;

let seq = 0;
/** Documento de venda gravado por `q` (superusuário no acervo; papel da aplicação depois da 0039). */
async function documento(q: Tx | Db, kind: "budget" | "order" | "sale" = "order", extra: { categoria?: string; centro?: string } = {}): Promise<string> {
  seq += 1;
  return (await q.query<{ id: string }>(
    `insert into erp.sales_documents (organization_id, empresa_id, kind, code, document_date, client_id, note, categoria_financeira_id, centro_custo_id)
     values ($1,$2,$3,$4,'2026-09-30',$5,$6,$7,$8) returning id`,
    [demo.orgId, empresa, kind, `E01-${seq}`, cliente, `nota ${seq}`, extra.categoria ?? null, extra.centro ?? null])).rows[0]!.id;
}

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 5 });
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of listMigrations().filter((x) => x.name < "0039")) {
    await db.query(m.sql);
    await db.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
  }
  await seedReference(db, () => {});
  demo = await seedDemo(db, {}, () => {});
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@"), { max: 3 });
  empresa = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code limit 1", [demo.orgId])).rows[0]!.id;
  cliente = (await db.query<{ id: string }>("select id from erp.people where organization_id=$1 and is_client order by code limit 1", [demo.orgId])).rows[0]!.id;
  // O ACERVO: um documento de cada espécie, gravado antes da 0039; um deles já passou por UPDATE.
  for (const k of ["budget", "order", "sale"] as const) acervo.push(await documento(db, k));
  await db.query("update erp.sales_documents set note='editado antes da 0039', updated_at=now() where id=$1", [acervo[1]]);
  filenodeAntes = (await db.query<{ f: number }>("select pg_relation_filenode('erp.sales_documents')::int f")).rows[0]!.f;
  antes = await retrato();
  // A PORTA DO ATRASO: o cliente deve um título a receber vencido há 10 dias (conta com tolerância 3). Um usuário
  // por capacidade de editar, um que lança (a premissa de que o dado existe) e um sem nenhuma das seis (só ver).
  await db.query(
    `insert into erp.financial_titles (organization_id, empresa_id, code, direction, number, person_id, amount, status, emission_date, due_date)
     values ($1,$2,'E01-T1','receivable','E01-1',$3,100.10,'open',current_date - 30,current_date - 10)`, [demo.orgId, empresa, cliente]);
  vencidoHa10 = (await db.query<{ d: string }>("select (current_date - 10)::text d")).rows[0]!.d;
  for (const k of ["budgets.edit", "orders.edit", "sales.edit", "orders.create"]) usuarios[k] = await usuarioComPapel(k.replace(".", "-"), [k]);
  usuarios.nenhuma = await usuarioComPapel("so-ver", ["budgets.view", "orders.view", "sales.view"]);
  fonteAtrasoAntes = await fonteAtraso();
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

describe("0039 — sobre o acervo de documentos de venda, como o runner aplica", () => {
  it("V1 PREMISSA: sob a 0038 há acervo, não há coluna/função/gatilho da versão, e os BEFORE UPDATE são as duas guardas", async () => {
    expect(antes.length, "sem acervo, 'o acervo lê 0 sem regravar' seria verdade sobre conjunto vazio").toBe(3);
    expect(await noLedger()).toBe(false);
    expect((await db.query<{ n: number }>("select count(*)::int n from public.erp_migrations")).rows[0]!.n).toBe(38);
    expect(await temColuna()).toBe(false);
    expect(await temFuncao()).toBe(false);
    expect(await beforeUpdate()).toEqual(GUARDAS);
    // O papel da aplicação já não é dono, nem superusuário, nem troca session_replication_role, nem tem TRIGGER.
    const papel = (await db.query(
      `select pg_has_role('erp_app', c.relowner, 'MEMBER') dono, r.rolsuper su, has_parameter_privilege('erp_app','session_replication_role','SET') srr,
              has_table_privilege('erp_app','erp.sales_documents','TRIGGER') trig
         from pg_class c, pg_roles r where c.oid='erp.sales_documents'::regclass and r.rolname='erp_app'`)).rows;
    expect(papel).toEqual([{ dono: false, su: false, srr: false, trig: false }]);
    // Nem por SET ROLE: o erp_app não é membro de papel nenhum que seja superusuário, troque session_replication_role
    // ou tenha TRIGGER na tabela, e nenhum ajuste guardado liga `replica` na sessão dele. A DIREÇÃO importa: o
    // erp_app_test (login do teste) é membro DO erp_app — está abaixo dele, e não conta.
    expect(await papeisPerigososDoApp()).toEqual([]);
    expect((await db.query<{ m: boolean }>("select pg_has_role('erp_app_test','erp_app','MEMBER') m")).rows[0]!.m, "a contraprova da direção existe").toBe(true);
    expect(await ajusteReplica()).toEqual([]);
    // O corpo da 0033 APLICADA tem o md5 que a pré-condição da 0039 exige (o mesmo conferido na produção).
    expect((await db.query<{ h: string }>("select md5(prosrc) h from pg_proc where oid = 'erp.situacao_atraso_cliente(uuid,integer)'::regprocedure")).rows[0]!.h)
      .toBe(MD5_0033);
    // A porta do atraso sob a 0033: quem LANÇA vê o título (o dado existe); quem só EDITA recebe zero linhas —
    // o falso "em dia" que a 0039 fecha —, e quem não tem nenhuma das seis também.
    const devedor = [{ titulos: 1, total: "100.10", vencimento_mais_antigo: vencidoHa10 }];
    expect(await atraso(usuarios["orders.create"]!)).toEqual(devedor);
    for (const k of ["budgets.edit", "orders.edit", "sales.edit", "nenhuma"]) expect([k, await atraso(usuarios[k]!)]).toEqual([k, []]);
    expect(fonteAtrasoAntes).not.toMatch(/\.edit/);
  });

  it("V2 trava (2026,73) em uso por outra sessão: a 0039 recusa antes de tudo, sem efeito", async () => {
    const outra = await db.connect();
    try {
      await outra.query("select pg_advisory_lock(2026, 73)");
      await expect(aplicar()).rejects.toThrow("EDITAR-01: outra transacao ja detem a trava desta migration (2026,73). Nada foi aplicado.");
    } finally { await outra.query("select pg_advisory_unlock(2026, 73)"); outra.release(); }
    expect(await noLedger()).toBe(false);
    expect(await temColuna()).toBe(false);
  });

  it("V3 lock_timeout 2s: uma leitura aberta em erp.sales_documents faz a 0039 desistir em ~2s, sem efeito", async () => {
    const leitor = await db.connect();
    try {
      await leitor.query("begin");
      await leitor.query("select 1 from erp.sales_documents limit 1");      // AccessShare: o ALTER TABLE precisa de AccessExclusive
      const t0 = Date.now();
      await expect(aplicar()).rejects.toThrow(/lock timeout/);
      const ms = Date.now() - t0;
      expect(ms, "desistiu pelo lock_timeout, não por outro motivo imediato").toBeGreaterThanOrEqual(1900);
      expect(ms, "e não ficou pendurada").toBeLessThan(10_000);
    } finally { await leitor.query("rollback"); leitor.release(); }
    expect(await noLedger()).toBe(false);
    expect(await temColuna()).toBe(false);
    expect(await temFuncao()).toBe(false);
  });

  it("V4 reversas: cada pré-condição quebrada recusa a 0039 com a SUA mensagem, sem efeito", async () => {
    const imitacao = (c: Tx) => c.query("create function erp.e01_imitacao_b1() returns trigger language plpgsql as 'begin return new; end'");
    // A tabela ausente (a cadeia fora de ordem): a primeira pergunta, antes de qualquer outra sobre ela.
    expect(await recusaDa0039((c) => c.query("alter table erp.sales_documents rename to sales_documents_e01r_b1")))
      .toBe("EDITAR-01: erp.sales_documents ausente; a cadeia de migrations esta fora de ordem.");
    // Coluna já existe (a 0039 aplicada, ou schema divergente) — a mensagem de "já aplicada" vem ANTES das outras.
    expect(await recusaDa0039((c) => c.query("alter table erp.sales_documents add column version int")))
      .toBe("EDITAR-01: erp.sales_documents.version ja existe; a 0039 ja foi aplicada ou ha schema divergente.");
    // Função já existe.
    expect(await recusaDa0039((c) => c.query("create function erp.sales_documents_versao() returns trigger language plpgsql as 'begin return new; end'")))
      .toBe("EDITAR-01: a funcao erp.sales_documents_versao() ja existe; schema divergente.");
    // Gatilho já existe (com o nome da 0039, apontando para outra função).
    expect(await recusaDa0039(async (c) => {
      await imitacao(c);
      await c.query("create trigger trg_sales_documents_versao before update on erp.sales_documents for each row execute function erp.e01_imitacao_b1()");
    })).toBe("EDITAR-01: o gatilho trg_sales_documents_versao ja existe em erp.sales_documents; schema divergente.");
    // O conjunto dos BEFORE UPDATE por linha: um a mais, um a menos, e o mesmo nome em outra função.
    const CONJUNTO = /^EDITAR-01: gatilhos BEFORE UPDATE por linha de erp\.sales_documents diferentes dos dois esperados .*: /;
    const aMais = await recusaDa0039(async (c) => {
      await imitacao(c);
      await c.query("create trigger trg_sales_documents_a_mais before update on erp.sales_documents for each row execute function erp.e01_imitacao_b1()");
    });
    expect(aMais).toMatch(CONJUNTO);
    expect(aMais).toContain("trg_sales_documents_a_mais -> erp.e01_imitacao_b1");
    expect(await recusaDa0039((c) => c.query("drop trigger trg_sales_documents_classificacao_financeira on erp.sales_documents"))).toMatch(CONJUNTO);
    const outraFuncao = await recusaDa0039(async (c) => {
      await imitacao(c);
      await c.query("drop trigger trg_sales_documents_execucao_configurada on erp.sales_documents");
      await c.query("create trigger trg_sales_documents_execucao_configurada before update of status on erp.sales_documents for each row execute function erp.e01_imitacao_b1()");
    });
    expect(outraFuncao).toMatch(CONJUNTO);
    expect(outraFuncao).toContain("trg_sales_documents_execucao_configurada -> erp.e01_imitacao_b1");
    // Contraprova: AFTER UPDATE, BEFORE INSERT e BEFORE UPDATE por COMANDO não entram na ordem dos BEFORE UPDATE por linha.
    await expect(recusaDa0039(async (c) => {
      await imitacao(c);
      await c.query("create trigger trg_sales_documents_zz_depois after update on erp.sales_documents for each row execute function erp.e01_imitacao_b1()");
      await c.query("create trigger trg_sales_documents_zz_insert before insert on erp.sales_documents for each row execute function erp.e01_imitacao_b1()");
      await c.query("create trigger trg_sales_documents_zz_comando before update on erp.sales_documents for each statement execute function erp.e01_imitacao_b1()");
    })).rejects.toThrow("esperava a 0039 recusar, e ela aplicou");
    // Quem aplica não é dono da tabela (o papel da aplicação).
    expect(await recusaDa0039((c) => c.query("set local role erp_app")))
      .toBe("EDITAR-01: o papel que aplica a migration nao e dono de erp.sales_documents; o ALTER TABLE e o CREATE TRIGGER seriam recusados.");
    // Quem aplica é dono da tabela, mas não cria objetos no schema erp.
    expect(await recusaDa0039(async (c) => {
      await c.query("create role e01r_aplicador_b1 nologin");
      await c.query("grant usage on schema erp to e01r_aplicador_b1");
      await c.query("alter table erp.sales_documents owner to e01r_aplicador_b1");
      await c.query("set local role e01r_aplicador_b1");
    })).toBe("EDITAR-01: o papel que aplica a migration nao cria objetos no schema erp; o CREATE FUNCTION seria recusado.");
    // O papel da aplicação não existe: a PRIMEIRA pergunta sobre ele, com o motivo nomeado (e não o "role does not
    // exist" genérico do primeiro pg_has_role). O nome é fixo na migration; o rename desfeito é a ausência dele.
    expect(await recusaDa0039((c) => c.query("alter role erp_app rename to e01r_app_ausente_b1")))
      .toBe("EDITAR-01: o papel erp_app nao existe; a 0007 nao esta aplicada ou ha schema divergente (a porta do atraso ficaria sem quem a execute).");
    // O papel da aplicação é membro do dono da tabela — mesmo sem herdar (o erp_app é NOINHERIT), faria SET ROLE para ele.
    const MEMBRO = "EDITAR-01: o papel da aplicacao (erp_app) e dono de erp.sales_documents ou membro do papel dono; poderia desligar o gatilho da versao.";
    expect(await recusaDa0039(async (c) => {
      await c.query("create role e01r_dono_b1 nologin");
      await c.query("alter table erp.sales_documents owner to e01r_dono_b1");
      await c.query("grant e01r_dono_b1 to erp_app");
    })).toBe(MEMBRO);
    expect(await recusaDa0039(async (c) => {
      await c.query("create role e01r_dono_b1 nologin");
      await c.query("alter table erp.sales_documents owner to e01r_dono_b1");
      await c.query("grant e01r_dono_b1 to erp_app with inherit false, set true");
      // Contraprova do motivo: sem herdar, o erp_app não "usa" o dono — mas é membro, e o SET ROLE basta.
      const r = (await c.query<{ usage: boolean; set: boolean }>(
        "select pg_has_role('erp_app','e01r_dono_b1','USAGE') usage, pg_has_role('erp_app','e01r_dono_b1','SET') set")).rows[0]!;
      expect(r).toEqual({ usage: false, set: true });
    })).toBe(MEMBRO);
    // O papel da aplicação é superusuário, ou pode trocar session_replication_role.
    const REPLICA = "EDITAR-01: o papel da aplicacao (erp_app) e superusuario ou pode trocar session_replication_role; poderia desligar o gatilho da versao.";
    expect(await recusaDa0039((c) => c.query("alter role erp_app superuser"))).toBe(REPLICA);
    expect(await recusaDa0039((c) => c.query("grant set on parameter session_replication_role to erp_app"))).toBe(REPLICA);
    // O papel da aplicação tem TRIGGER na tabela.
    expect(await recusaDa0039((c) => c.query("grant trigger on erp.sales_documents to erp_app")))
      .toBe("EDITAR-01: o papel da aplicacao (erp_app) tem TRIGGER em erp.sales_documents; poderia criar um gatilho depois do da versao.");
    // O papel da aplicação é MEMBRO — sem herdar, direto ou em cadeia — de um papel que desligaria o gatilho: a pergunta
    // direta (has_*_privilege do erp_app) responde não, e o SET ROLE responde sim.
    const acima = (papeis: string) => `EDITAR-01: o papel da aplicacao (erp_app) e membro (com ou sem heranca) de papel superusuario, com SET em session_replication_role ou com TRIGGER em erp.sales_documents: {${papeis}}; faria SET ROLE e poderia desligar o gatilho da versao.`;
    expect(await recusaDa0039(async (c) => {
      await c.query("create role e01r_gatilho_b1 nologin");
      await c.query("grant trigger on erp.sales_documents to e01r_gatilho_b1");
      await c.query("grant e01r_gatilho_b1 to erp_app with inherit false, set true");
      const r = (await c.query<{ trig: boolean; set: boolean }>(
        "select has_table_privilege('erp_app','erp.sales_documents','TRIGGER') trig, pg_has_role('erp_app','e01r_gatilho_b1','SET') set")).rows[0]!;
      expect(r, "contraprova: a pergunta direta não vê o TRIGGER; o SET ROLE alcança").toEqual({ trig: false, set: true });
    })).toBe(acima("e01r_gatilho_b1"));
    expect(await recusaDa0039(async (c) => {
      await c.query("create role e01r_replica_b1 nologin");
      await c.query("grant set on parameter session_replication_role to e01r_replica_b1");
      await c.query("grant e01r_replica_b1 to erp_app with inherit false, set true");
      const r = (await c.query<{ srr: boolean }>("select has_parameter_privilege('erp_app','session_replication_role','SET') srr")).rows[0]!;
      expect(r, "contraprova: a pergunta direta não vê o SET").toEqual({ srr: false });
    })).toBe(acima("e01r_replica_b1"));
    // Em CADEIA e sem SET na primeira aresta: erp_app → e01r_meio_b1 (sem herdar, sem SET) → e01r_su_b1 (superusuário).
    // Fail closed: MEMBER é qualquer forma de pertencer, e só o papel perigoso aparece no motivo.
    expect(await recusaDa0039(async (c) => {
      await c.query("create role e01r_su_b1 nologin superuser");
      await c.query("create role e01r_meio_b1 nologin");
      await c.query("grant e01r_su_b1 to e01r_meio_b1");
      await c.query("grant e01r_meio_b1 to erp_app with inherit false, set false");
    })).toBe(acima("e01r_su_b1"));
    // Ajuste guardado que liga `replica` na sessão do erp_app: do papel (neste banco ou em outro) e de todos os papéis.
    const AJUSTE = "EDITAR-01: ha session_replication_role em pg_db_role_setting para o erp_app (ALTER ROLE erp_app SET, ALTER ROLE ALL SET ou ALTER DATABASE SET); a sessao dele nasceria com o gatilho da versao desligado.";
    expect(await recusaDa0039((c) => c.query("alter role erp_app set session_replication_role = replica"))).toBe(AJUSTE);
    expect(await recusaDa0039((c) => c.query("alter role erp_app in database template1 set session_replication_role = replica"))).toBe(AJUSTE);
    expect(await recusaDa0039((c) => c.query("do $d$ begin execute format('alter database %I set session_replication_role = replica', current_database()); end $d$"))).toBe(AJUSTE);
    // Contraprova da direção: um ajuste de OUTRO papel (aqui, um papel de ensaio) não alcança a sessão do erp_app.
    await expect(recusaDa0039(async (c) => {
      await c.query("create role e01r_outro_b1 nologin");
      await c.query("alter role e01r_outro_b1 set session_replication_role = replica");
    })).rejects.toThrow("esperava a 0039 recusar, e ela aplicou");
    // A porta do atraso: ausente, sem SECURITY DEFINER, com corpo que já não é o da 0033, dono sem bypass de RLS,
    // e quem aplica não é dono dela.
    const AUSENTE = "EDITAR-01: erp.situacao_atraso_cliente(uuid, integer) ausente ou sem SECURITY DEFINER; a 0033 nao esta aplicada ou ha schema divergente.";
    expect(await recusaDa0039((c) => c.query("drop function erp.situacao_atraso_cliente(uuid, int)"))).toBe(AUSENTE);
    expect(await recusaDa0039((c) => c.query("alter function erp.situacao_atraso_cliente(uuid, int) security invoker"))).toBe(AUSENTE);
    const CORPO = `EDITAR-01: o corpo de erp.situacao_atraso_cliente nao e o da 0033 (md5 do corpo inteiro diferente de ${MD5_0033}); a 0039 ja foi aplicada ou ha schema divergente.`;
    const substituir = (c: Tx, corpo: string) => c.query(
      `create or replace function erp.situacao_atraso_cliente(p_cliente uuid, p_tolerancia int) returns table (titulos int, total numeric, vencimento_mais_antigo date)
       language plpgsql stable security definer set search_path = erp, pg_temp as $f$${corpo}$f$`);
    // Contraprova do instrumento: substituir pelo MESMO corpo conserva o md5, e a 0039 aplica (desfeita no fim).
    await expect(recusaDa0039((c) => substituir(c, fonteAtrasoAntes))).rejects.toThrow("esperava a 0039 recusar, e ela aplicou");
    // (a) já aplicada: o corpo cita uma .edit; (b) divergente: falta uma das três .create.
    expect(await recusaDa0039((c) => substituir(c, fonteAtrasoAntes.replace("'sales.create')", "'sales.create') or erp.has_permission(v_org, v_user, 'orders.edit')")))).toBe(CORPO);
    expect(await recusaDa0039((c) => substituir(c, fonteAtrasoAntes.replace("'budgets.create'", "'budgets.view'")))).toBe(CORPO);
    // (c) divergente FORA da lista de capacidades: a tolerância máxima 365 → 366. As três .create continuam e nenhuma
    // .edit aparece — a heurística de trecho antiga aceitaria este corpo; o md5 do corpo inteiro recusa.
    const tolerancia366 = fonteAtrasoAntes.replace("p_tolerancia > 365", "p_tolerancia > 366");
    expect(tolerancia366, "a sabotagem mudou o corpo").not.toBe(fonteAtrasoAntes);
    for (const k of ["budgets.create", "orders.create", "sales.create"]) expect(tolerancia366).toContain(`'${k}'`);
    expect(tolerancia366).not.toMatch(/\.edit/);
    expect(await recusaDa0039((c) => substituir(c, tolerancia366))).toBe(CORPO);
    // (d) um espaço a mais no fim do corpo: o corpo é o da 0033 ou não é — não há "quase".
    expect(await recusaDa0039((c) => substituir(c, `${fonteAtrasoAntes} `))).toBe(CORPO);
    expect(await recusaDa0039(async (c) => {
      await c.query("create role e01r_dono_atraso_b1 nologin");
      await c.query("alter function erp.situacao_atraso_cliente(uuid, int) owner to e01r_dono_atraso_b1");
    })).toBe("EDITAR-01: o dono de erp.situacao_atraso_cliente nao atravessa RLS; a porta veria so o recorte de quem chama.");
    expect(await recusaDa0039(async (c) => {
      // Dono da tabela e com CREATE no schema (passa o resto), mas não é o dono da porta (o superusuário).
      await c.query("create role e01r_aplicador_tabela_b1 nologin");
      await c.query("grant usage, create on schema erp to e01r_aplicador_tabela_b1");
      await c.query("alter table erp.sales_documents owner to e01r_aplicador_tabela_b1");
      await c.query("set local role e01r_aplicador_tabela_b1");
    })).toBe("EDITAR-01: o papel que aplica a migration nao e dono de erp.situacao_atraso_cliente; o CREATE OR REPLACE seria recusado.");
    // PÓS-CONDIÇÃO da porta: um grant antigo de EXECUTE a outro papel passa pelas pré-condições e sobrevive ao CREATE OR
    // REPLACE (que conserva a ACL); a pós-condição recusa — a porta, agora maior, não abre para mais ninguém.
    expect(await recusaDa0039(async (c) => {
      await c.query("create role e01r_intruso_b1 nologin");
      await c.query("grant execute on function erp.situacao_atraso_cliente(uuid, int) to e01r_intruso_b1");
    })).toBe("EDITAR-01: EXECUTE de erp.situacao_atraso_cliente concedido alem do dono e do erp_app: {e01r_intruso_b1}");
    // Nada ficou: o ledger, a coluna, a função, os gatilhos, o dono, os privilégios e os papéis de ensaio são os de antes.
    expect(await noLedger()).toBe(false);
    expect(await temColuna()).toBe(false);
    expect(await temFuncao()).toBe(false);
    expect(await beforeUpdate()).toEqual(GUARDAS);
    const estado = (await db.query(
      `select c.relowner::regrole::text dono, r.rolsuper su, has_parameter_privilege('erp_app','session_replication_role','SET') srr,
              has_table_privilege('erp_app','erp.sales_documents','TRIGGER') trig
         from pg_class c, pg_roles r where c.oid='erp.sales_documents'::regclass and r.rolname='erp_app'`)).rows;
    expect(estado).toEqual([{ dono: "postgres", su: false, srr: false, trig: false }]);
    expect((await db.query("select 1 from pg_roles where rolname like 'e01r\\_%'")).rowCount).toBe(0);
    expect((await db.query("select 1 from pg_roles where rolname = 'erp_app'")).rowCount, "o rename do erp_app foi desfeito").toBe(1);
    expect(await papeisPerigososDoApp()).toEqual([]);
    expect(await ajusteReplica()).toEqual([]);
    expect(await execucaoDaPorta()).toEqual(["erp_app", "postgres"]);
    expect(await retrato()).toEqual(antes);
    expect(await fonteAtraso(), "a porta do atraso continua a da 0033").toBe(fonteAtrasoAntes);
  });

  it("V5 aplica: ledger com 39 (a 0039 por último), tabela NÃO regravada, acervo idêntico e lendo 0, objetos no catálogo", async () => {
    await aplicar();
    const ledger = (await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0]!;
    expect(ledger).toEqual({ n: 39, ultima: ALVO });
    const noDisco = listMigrations().map((m) => m.name);
    expect(noDisco.length, "45 migrations no repositório (a 0040, ESTOQUE-01, a 0041, TOP-CONFIG-08, e da 0042 à 0045, OPERACOES-01 F8, F5a, F6a e F9, vêm depois)").toBe(45);
    expect(noDisco[38]).toBe(ALVO);
    // ADD COLUMN com default constante é só metadado: o arquivo físico é o mesmo, e o 0 vem do catálogo.
    expect((await db.query<{ f: number }>("select pg_relation_filenode('erp.sales_documents')::int f")).rows[0]!.f, "a tabela não foi regravada").toBe(filenodeAntes);
    expect((await db.query<{ m: boolean }>("select atthasmissing m from pg_attribute where attrelid='erp.sales_documents'::regclass and attname='version'")).rows[0]!.m).toBe(true);
    expect(await retrato(), "nenhuma outra coluna do acervo muda").toEqual(antes);
    for (const id of acervo) expect(await versao(id), "SEM BACKFILL: o acervo lê o default").toBe("0");

    const coluna = (await db.query(
      "select data_type, is_nullable, column_default from information_schema.columns where table_schema='erp' and table_name='sales_documents' and column_name='version'")).rows;
    expect(coluna).toEqual([{ data_type: "bigint", is_nullable: "NO", column_default: "0" }]);
    const funcao = (await db.query(
      `select p.prosecdef definer, p.proconfig cfg, l.lanname lang, has_function_privilege('erp_app', p.oid, 'execute') app,
              has_function_privilege('public', p.oid, 'execute') publico
         from pg_proc p join pg_language l on l.oid = p.prolang where p.oid='erp.sales_documents_versao()'::regprocedure`)).rows;
    expect(funcao).toEqual([{ definer: false, cfg: ["search_path=erp, pg_temp"], lang: "plpgsql", app: false, publico: false }]);
    const gatilho = (await db.query(
      `select pg_get_triggerdef(t.oid) def, t.tgenabled ligado from pg_trigger t
        where t.tgrelid='erp.sales_documents'::regclass and t.tgname='trg_sales_documents_versao'`)).rows;
    expect(gatilho).toEqual([{
      def: "CREATE TRIGGER trg_sales_documents_versao BEFORE UPDATE ON erp.sales_documents FOR EACH ROW EXECUTE FUNCTION erp.sales_documents_versao()",
      ligado: "O"
    }]);
    // A ORDEM: a versão é o último BEFORE UPDATE por linha, depois das duas guardas.
    expect(await beforeUpdate()).toEqual([...GUARDAS, "trg_sales_documents_versao"]);
    // A porta do atraso: o MESMO corpo da 0033, só com as três .edit na reconferência de capacidade.
    const fonte = await fonteAtraso();
    for (const k of SEIS) expect(fonte, `o corpo cita '${k}'`).toContain(`'${k}'`);
    expect(fonte.replace(/\n\s+or erp\.has_permission\(v_org, v_user, '(?:budgets|orders|sales)\.edit'\)/g, ""), "tirando as três .edit, é o corpo da 0033")
      .toBe(fonteAtrasoAntes);
    const porta = (await db.query(
      `select p.prosecdef definer, p.provolatile vol, p.proconfig cfg, pg_get_function_result(p.oid) retorno, r.rolsuper or r.rolbypassrls atravessa,
              has_function_privilege('public', p.oid, 'execute') publico, has_function_privilege('erp_app', p.oid, 'execute') app,
              obj_description(p.oid, 'pg_proc') like '%.create ou .edit%' comentario
         from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = 'erp.situacao_atraso_cliente(uuid,integer)'::regprocedure`)).rows;
    expect(porta).toEqual([{ definer: true, vol: "s", cfg: ["search_path=erp, pg_temp"], retorno: "TABLE(titulos integer, total numeric, vencimento_mais_antigo date)",
      atravessa: true, publico: false, app: true, comentario: true }]);
    // EXECUTE da porta SÓ do dono e do erp_app (a pós-condição da 0039, lida pela ACL).
    expect(await execucaoDaPorta()).toEqual(["erp_app", "postgres"]);
  });

  it("V6 reaplicar é recusado pela pré-condição de 'já aplicada', sem efeito", async () => {
    expect(await recusaDa0039()).toBe("EDITAR-01: erp.sales_documents.version ja existe; a 0039 ja foi aplicada ou ha schema divergente.");
    for (const id of acervo) expect(await versao(id)).toBe("0");
    expect(await beforeUpdate()).toEqual([...GUARDAS, "trg_sales_documents_versao"]);
  });
});

describe("a porta do atraso responde também a quem edita (item 3 da 0039)", () => {
  it("AT1 pelo papel da aplicação: quem só tem budgets/orders/sales .edit vê os agregados do devedor; quem não tem nenhuma das seis, zero linhas", async () => {
    const devedor = [{ titulos: 1, total: "100.10", vencimento_mais_antigo: vencidoHa10 }];
    for (const k of ["budgets.edit", "orders.edit", "sales.edit", "orders.create"]) expect([k, await atraso(usuarios[k]!)]).toEqual([k, devedor]);
    expect(await atraso(usuarios.nenhuma!), "sem nenhuma das seis: zero linhas, como antes").toEqual([]);
    // O resto da porta não mudou: tolerância fora de 0..365 continua sem ampliar nada, e 365 não vê o título.
    expect(await atraso(usuarios["orders.edit"]!, 366)).toEqual([]);
    expect(await atraso(usuarios["orders.edit"]!, -1)).toEqual([]);
    expect(await atraso(usuarios["orders.edit"]!, 365)).toEqual([{ titulos: 0, total: "0", vencimento_mais_antigo: null }]);
  });
});

describe("a versão pelo papel da aplicação (RLS, GUC da transação) e por qualquer caminho", () => {
  it("VA1 insert nasce 0; todo update soma 1 — que muda, que não muda nada, que manda valor explícito ou nulo", async () => {
    const id = await naApp((tx) => documento(tx));
    expect(await versao(id)).toBe("0");
    const upd = (sql: string) => naApp((tx) => tx.query(`update erp.sales_documents set ${sql} where id=$1`, [id]));
    await expect(upd("note='editado'")).resolves.toMatchObject({ rowCount: 1 });
    expect(await versao(id)).toBe("1");
    await expect(upd("note=note")).resolves.toMatchObject({ rowCount: 1 });
    expect(await versao(id), "update que não muda nada também soma").toBe("2");
    await expect(upd("version=999")).resolves.toMatchObject({ rowCount: 1 });
    expect(await versao(id), "SET version = 999 vira old+1").toBe("3");
    await expect(upd("version=version-10, note='de volta'")).resolves.toMatchObject({ rowCount: 1 });
    expect(await versao(id), "voltar a versão também vira old+1").toBe("4");
    await expect(upd("version=null")).resolves.toMatchObject({ rowCount: 1 });
    expect(await versao(id), "o NOT NULL é conferido depois do BEFORE: nulo vira old+1").toBe("5");
    // Update desfeito não deixa rastro na versão.
    await expect(naApp(async (tx) => { await tx.query("update erp.sales_documents set note='desfeito' where id=$1", [id]); throw new Error("desfaz"); }))
      .rejects.toThrow("desfaz");
    expect(await versao(id)).toBe("5");
  });

  it("VA2 update de várias linhas: cada uma soma 1 a partir da PRÓPRIA versão", async () => {
    const ids = [await naApp((tx) => documento(tx)), await naApp((tx) => documento(tx)), await naApp((tx) => documento(tx))];
    await naApp((tx) => tx.query("update erp.sales_documents set note='um' where id=$1", [ids[2]]));
    await naApp((tx) => tx.query("update erp.sales_documents set note='dois' where id=$1", [ids[2]]));
    const r = await naApp((tx) => tx.query("update erp.sales_documents set note='lote', version=0 where id = any($1)", [ids]));
    expect(r.rowCount).toBe(3);
    expect([await versao(ids[0]!), await versao(ids[1]!), await versao(ids[2]!)]).toEqual(["1", "1", "3"]);
  });

  it("VA3 outros caminhos: o acervo pelo papel da aplicação, a mudança de situação e o script de suporte (superusuário)", async () => {
    await naApp((tx) => tx.query("update erp.sales_documents set status='cancelled', updated_at=now() where id=$1", [acervo[0]]));
    expect(await versao(acervo[0]!)).toBe("1");
    await db.query("update erp.sales_documents set note='suporte' where id=$1", [acervo[1]]);
    expect(await versao(acervo[1]!), "o superusuário também passa pelo gatilho").toBe("1");
  });

  it("VA4 com as guardas da 0024: a confirmação recusada não soma; a aceita soma UMA vez", async () => {
    seq += 1;
    const categoria = (await db.query<{ id: string }>(
      "insert into erp.financial_categories(organization_id,code,name,nature,kind) values ($1,$2,$3,'income','analytic') returning id",
      [demo.orgId, `E01C${seq}`, `Cat E01 ${seq}`])).rows[0]!.id;
    const centro = (await db.query<{ id: string }>(
      "insert into erp.cost_centers(organization_id,code,name,kind) values ($1,$2,$3,'analytic') returning id",
      [demo.orgId, `E01CC${seq}`, `CC E01 ${seq}`])).rows[0]!.id;
    const id = await naApp((tx) => documento(tx, "sale", { categoria, centro }));
    const confirmar = (marca: string | null) => naApp(async (tx) => {
      if (marca !== null) await tx.query("select set_config('app.venda_classificacao_financeira', $1, true)", [marca]);
      return tx.query("update erp.sales_documents set status='confirmed' where id=$1", [id]);
    });
    const r = await erroDe(confirmar(null));
    expect(r.message).toBe("VALIDATION_ERROR: esta venda tem classificacao financeira, que este servidor nao aplica; a venda nao foi confirmada");
    expect(await versao(id), "a guarda recusou: a transação inteira desfeita, a versão também").toBe("0");
    await expect(confirmar(id)).resolves.toMatchObject({ rowCount: 1 });
    expect(await versao(id), "um UPDATE, uma soma — com as guardas no caminho").toBe("1");
  });

  it("VA5 a ORDEM, observada: um BEFORE que ordena antes da versão vê o NEW do comando; um que ordena depois vê old+1", async () => {
    const id = await naApp((tx) => documento(tx));
    await naApp((tx) => tx.query("update erp.sales_documents set note='um' where id=$1", [id]));        // versão 1
    const espiar = async (nome: string) => {
      const c = await db.connect();
      try {
        await c.query("begin");
        await c.query(`create function erp.e01_espia_b1() returns trigger language plpgsql as $f$
          begin raise exception 'ESPIA old=% new=%', old.version, new.version; end $f$`);
        await c.query(`create trigger ${nome} before update on erp.sales_documents for each row execute function erp.e01_espia_b1()`);
        await c.query("update erp.sales_documents set version=777 where id=$1", [id]);
      } catch (e) { return (e as Error).message; } finally { await c.query("rollback").catch(() => {}); c.release(); }
      throw new Error("a espia não disparou");
    };
    // 'trg_sales_documents_a_espia' < guardas < 'trg_sales_documents_versao' < 'trg_sales_documents_zz_espia' (collation "C").
    expect(await espiar("trg_sales_documents_a_espia")).toBe("ESPIA old=1 new=777");
    expect(await espiar("trg_sales_documents_zz_espia")).toBe("ESPIA old=1 new=2");
    expect(await versao(id)).toBe("1");
    expect(await beforeUpdate()).toEqual([...GUARDAS, "trg_sales_documents_versao"]);
  });

  it("VA6 o papel da aplicação não desliga, não derruba, não troca nem contorna o gatilho", async () => {
    const recusa = async (sql: string) => {
      const r = await erroDe(naApp((tx) => tx.query(sql)));
      return [sql, r.code, r.message];
    };
    expect(await recusa("alter table erp.sales_documents disable trigger trg_sales_documents_versao"))
      .toEqual([expect.any(String), "42501", "must be owner of table sales_documents"]);
    expect(await recusa("alter table erp.sales_documents disable trigger all"))
      .toEqual([expect.any(String), "42501", "must be owner of table sales_documents"]);
    expect(await recusa("drop trigger trg_sales_documents_versao on erp.sales_documents"))
      .toEqual([expect.any(String), "42501", "must be owner of relation sales_documents"]);
    expect(await recusa("set local session_replication_role = replica"))
      .toEqual([expect.any(String), "42501", "permission denied to set parameter \"session_replication_role\""]);
    expect(await recusa("set session_replication_role = replica"))
      .toEqual([expect.any(String), "42501", "permission denied to set parameter \"session_replication_role\""]);
    expect(await recusa("create trigger trg_sales_documents_zz before update on erp.sales_documents for each row execute function erp.sales_documents_versao()"))
      .toEqual([expect.any(String), "42501", "permission denied for table sales_documents"]);
    expect(await recusa("create or replace function erp.sales_documents_versao() returns trigger language plpgsql as 'begin return new; end'"))
      .toEqual([expect.any(String), "42501", "permission denied for schema erp"]);
    // E o gatilho continua lá, ligado, somando.
    const id = await naApp((tx) => documento(tx));
    await naApp((tx) => tx.query("update erp.sales_documents set version=0, note='depois das recusas' where id=$1", [id]));
    expect(await versao(id)).toBe("1");
    expect((await db.query("select tgenabled from pg_trigger where tgrelid='erp.sales_documents'::regclass and tgname='trg_sales_documents_versao'")).rows)
      .toEqual([{ tgenabled: "O" }]);
  });
});
