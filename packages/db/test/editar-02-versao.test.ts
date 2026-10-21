import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, withTx, type Db, type Queryable, type Tx, type TenantContext } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * A 0063 (EDITAR-02, decisão 313), PROVADA CONTRA O BANCO — SOBRE ACERVO, COMO O RUNNER APLICA. O molde é a parte de
 * versão da 0039 (editar-01-versao.test.ts), em erp.documentos_compra.
 *
 * O que ela promete:
 *   · `erp.documentos_compra.version` bigint not null default 0, acrescentada SEM regravar a tabela (o acervo lê 0),
 *     legível pelo papel da aplicação pelo grant de tabela;
 *   · TODO update do cabeçalho, de qualquer caminho e por qualquer papel, soma 1 — inclusive o que não muda nada, o de
 *     várias linhas (cada uma +1) e o que manda um valor explícito (vira old+1 no aberto; fora do aberto a conferência
 *     v3 o recusa); o insert nasce 0; escrita SÓ em item não soma, e item + cabeçalho na mesma transação soma 1;
 *   · o gatilho é o ÚLTIMO BEFORE UPDATE por nome, depois das cinco guardas (0041, 0044, 0047) — e precisa ser: a
 *     conferência v3 congela a LINHA INTEIRA fora do aberto, e as transições de documento fora do aberto (cancelar a
 *     compra confirmada, converter, reabrir, cancelar o pedido finalizado) só passam porque a soma vem depois dela;
 *   · o papel da aplicação existe e não desliga o gatilho (não é dono, não é superusuário, não troca
 *     session_replication_role, não tem TRIGGER na tabela, não é MEMBRO — nem sem herdar — de papel que faça
 *     alguma dessas coisas, e nenhum ajuste guardado liga `replica` na sessão dele);
 *   · nada de vendas muda: a coluna, a função e os gatilhos da 0039 são os mesmos, e a venda continua somando 1.
 *
 * Banco NOVO esconde a prova: sem documento gravado, "o acervo lê 0 sem regravar" seria verdade sobre conjunto
 * vazio. Este arquivo sobe o banco até a 0062, grava documentos de compra das três espécies pelo caminho de antes (e
 * uma venda) e só então aplica a 0063 como o runner aplica (uma transação), provando antes as recusas dela: a trava
 * (2026,97), o lock_timeout de 2s, a REVERSA de cada pré-condição e a reaplicação; e depois cada pós-condição
 * quebrada com a sua mensagem.
 *
 * Duas conexões: `db` (superusuário: monta o cenário e lê o catálogo) e `app` (papel da aplicação, SEM bypass de
 * RLS, com as GUCs da transação e o módulo compras — o caminho que a API percorre). Papéis de ensaio têm o prefixo
 * e02r_ e nascem só dentro de transações desfeitas.
 */
let db: Db; let app: Db; let demo: DemoOrg;
let empresa: string; let fornecedor: string; let fornecedor2: string; let cliente: string;
let produtoX: string; let produtoY: string;
let filenodeAntes: number;
const tops = {} as Record<"pedido" | "compra" | "orcamento", { top: string; versao: string }>;
const acervo = {} as { pedidoAberto: Doc; compraAberta: Doc; compraConfirmada: Doc; pedidoFinalizado: Doc; pedidoCancelado: Doc; pedidoOrcado: Doc; orcamento: Doc };
let vendaAcervo: string;

const ALVO = "0063_versao_do_documento_de_compra.sql";
const M = "EDITAR-02: ";
/** Os cinco BEFORE UPDATE por linha de hoje, na ordem de disparo (nome, collation "C"). */
const GUARDAS = ["trg_documentos_compra_aprovacao", "trg_documentos_compra_conferir", "trg_documentos_compra_finalizacao",
  "trg_documentos_compra_nota", "trg_documentos_compra_transicao"];

interface Doc { id: string; itens: string[] }
const ctx = (): TenantContext => ({ orgId: demo.orgId, userId: demo.adminUserId, modulo: "compras" });
const naApp = <T>(fn: (tx: Tx) => Promise<T>) => withTx(app, ctx(), fn);

const sqlDaAlvo = () => {
  const m = listMigrations().find((x) => x.name === ALVO);
  expect(m, `${ALVO} precisa existir`).toBeTruthy();
  return m!.sql;
};
async function aplicar(): Promise<void> {
  const sql = sqlDaAlvo();
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query(sql);
    await c.query("insert into public.erp_migrations(name) values ($1)", [ALVO]);
    await c.query("commit");
  } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
}
/** Roda `sql` (a 0063, ou um trecho dela) numa transação DESFEITA no fim (depois de `antes`), e devolve o erro — ou falha, se aplicou. */
async function recusaDe(sql: string, antes?: (c: Tx) => Promise<unknown>): Promise<string> {
  const c = await db.connect();
  try {
    await c.query("begin");
    if (antes) await antes(c);
    await c.query(sql);
  } catch (e) { return (e as Error).message; } finally { await c.query("rollback").catch(() => {}); c.release(); }
  throw new Error("esperava a 0063 recusar, e ela aplicou");
}
const recusaDa0063 = (antes?: (c: Tx) => Promise<unknown>) => recusaDe(sqlDaAlvo(), antes);
async function erroDe(p: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try { await p; } catch (e) { return e as { code?: string; message: string }; }
  throw new Error("esperava recusa, e o banco aceitou");
}

const noLedger = async () => (await db.query("select 1 from public.erp_migrations where name=$1", [ALVO])).rowCount === 1;
const temColuna = async () => (await db.query(
  "select 1 from pg_attribute where attrelid='erp.documentos_compra'::regclass and attname='version' and not attisdropped")).rowCount === 1;
const temFuncao = async () => (await db.query<{ f: string | null }>("select to_regprocedure('erp.documentos_compra_versao()')::text f")).rows[0]!.f !== null;
/** Os BEFORE UPDATE por linha do cabeçalho, na ordem em que o PostgreSQL os dispara (nome, collation "C"). */
const beforeUpdate = async () => (await db.query<{ tgname: string }>(
  `select tgname from pg_trigger where tgrelid='erp.documentos_compra'::regclass and not tgisinternal
      and (tgtype & 1) = 1 and (tgtype & 2) = 2 and (tgtype & 16) = 16 order by tgname collate "C"`)).rows.map((r) => r.tgname);
/**
 * Os gatilhos de COMPRAS (cabeçalho e itens) e de VENDAS (cabeçalho e itens) que já existiam, pela definição inteira
 * e pelo md5 do corpo da função: a 0063 não troca nem reescreve nenhum deles (o da versão da compra fica de fora).
 */
const gatilhosDeAntes = async () => (await db.query<{ g: string }>(
  `select g from (
     select c.relname || '.' || t.tgname || ' :: ' || pg_get_triggerdef(t.oid) || ' :: ' || t.tgenabled::text || ' :: ' || md5(p.prosrc) g
       from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
      where c.oid in ('erp.documentos_compra'::regclass, 'erp.documentos_compra_itens'::regclass, 'erp.sales_documents'::regclass, 'erp.sales_document_items'::regclass)
        and not t.tgisinternal and t.tgname <> 'trg_documentos_compra_versao') x
    order by g collate "C"`)).rows.map((r) => r.g);
/** A coluna, a função e a ACL da versão da VENDA (0039): a 0063 não as toca. */
const versaoDaVenda = async () => (await db.query(
  `select format_type(a.atttypid, a.atttypmod) tipo, a.attnotnull nn, pg_get_expr(d.adbin, d.adrelid) def, md5(p.prosrc) corpo, p.proconfig cfg, p.proacl::text acl
     from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum, pg_proc p
    where a.attrelid = 'erp.sales_documents'::regclass and a.attname = 'version' and p.oid = 'erp.sales_documents_versao()'::regprocedure`)).rows;
/** O acervo de compras, linha a linha, sem a coluna nova (to_jsonb da linha inteira: nenhuma outra coluna pode mudar), e os itens inteiros. */
const retrato = async () => ({
  documentos: (await db.query<{ l: unknown }>("select to_jsonb(d) - 'version' l from erp.documentos_compra d order by id")).rows.map((r) => r.l),
  itens: (await db.query<{ l: unknown }>("select to_jsonb(i) l from erp.documentos_compra_itens i order by id")).rows.map((r) => r.l),
  vendas: (await db.query<{ l: unknown }>("select to_jsonb(s) l from erp.sales_documents s order by id")).rows.map((r) => r.l)
});
let antes: Awaited<ReturnType<typeof retrato>>;
let gatilhosAntes: string[];
let vendaAntes: unknown[];
/** Papéis ACIMA do erp_app (ele é membro, de qualquer forma) que são superusuário, trocam session_replication_role ou têm TRIGGER na tabela. */
const papeisPerigososDoApp = async () => (await db.query<{ rolname: string }>(
  `select r.rolname from pg_roles r, pg_roles app where app.rolname = 'erp_app' and r.oid <> app.oid and pg_has_role(app.oid, r.oid, 'MEMBER')
      and (r.rolsuper or has_parameter_privilege(r.oid, 'session_replication_role', 'SET') or has_table_privilege(r.oid, 'erp.documentos_compra', 'TRIGGER'))`)).rows.map((r) => r.rolname);
/** Ajustes guardados de session_replication_role que alcançam a sessão do erp_app (o papel dele, ou todos os papéis). */
const ajusteReplica = async () => (await db.query<{ ajuste: string }>(
  `select c.ajuste from pg_db_role_setting s cross join lateral unnest(s.setconfig) c(ajuste)
    where s.setrole in (0, (select oid from pg_roles where rolname = 'erp_app')) and c.ajuste ilike 'session_replication_role=%'`)).rows.map((r) => r.ajuste);

const versao = async (id: string) => (await db.query<{ v: string }>("select version::text v from erp.documentos_compra where id=$1", [id])).rows[0]!.v;
const situacaoDe = async (id: string) => (await db.query<{ s: string }>("select situacao s from erp.documentos_compra where id=$1", [id])).rows[0]!.s;
const versaoDaVendaDe = async (id: string) => (await db.query<{ v: string }>("select version::text v from erp.sales_documents where id=$1", [id])).rows[0]!.v;

let seq = 0;
const id1 = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0]!.id;
/** TOP e versão 1 da família (na MESMA transação: a FK da versão atual é adiada até o commit), configuração padrão. */
async function criarTop(codigoBase: string): Promise<{ top: string; versao: string }> {
  seq += 1;
  return withTx(db, { orgId: demo.orgId, userId: null }, async (tx) => {
    const top = (await tx.query<{ id: string }>("insert into erp.tipos_operacao (organization_id, codigo, codigo_base) values ($1,$2,$3) returning id",
      [demo.orgId, `E02T${seq}`, codigoBase])).rows[0]!.id;
    const v = (await tx.query<{ id: string }>("insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome) values ($1,$2,1,$3) returning id",
      [demo.orgId, top, `TOP E02 ${codigoBase} ${seq}`])).rows[0]!.id;
    return { top, versao: v };
  });
}
type Especie = "pedido" | "compra" | "orcamento";
interface Linha { produto?: string; qtd?: string; unitario?: string; origem?: string; orcado?: string }
/** INSERT do cabeçalho por `q` (só as colunas que toda rota grava; nunca `version`). valor_total = valor_itens (CHECK da 0036). */
async function inserirCabecalho(q: Queryable, especie: Especie, extra: Record<string, unknown> = {}): Promise<string> {
  seq += 1;
  const v: Record<string, unknown> = {
    organization_id: demo.orgId, empresa_id: empresa, especie, codigo: `E02-${seq}`, tipo_operacao_id: tops[especie].top,
    tipo_operacao_versao_id: tops[especie].versao, fornecedor_id: fornecedor, data_documento: "2026-10-01", valor_itens: "0.00", valor_total: "0.00",
    observacao: `nota ${seq}`, ...extra
  };
  const cols = Object.keys(v);
  return (await q.query<{ id: string }>(
    `insert into erp.documentos_compra (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, Object.values(v))).rows[0]!.id;
}
async function inserirItem(q: Queryable, documento: string, l: Linha = {}, posicao = 0): Promise<string> {
  const v: Record<string, unknown> = {
    organization_id: demo.orgId, documento_id: documento, produto_id: l.produto ?? produtoX, quantidade: l.qtd ?? "1",
    valor_unitario: l.unitario ?? "10", valor_total: "0", posicao,
    ...(l.origem ? { origem_item_id: l.origem } : {}), ...(l.orcado ? { item_pedido_orcado_id: l.orcado } : {})
  };
  const cols = Object.keys(v);
  return (await q.query<{ id: string }>(
    `insert into erp.documentos_compra_itens (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, Object.values(v))).rows[0]!.id;
}
/** Documento de compra pelo papel da aplicação: cabeçalho e itens na MESMA transação, como a API grava. */
const documento = (especie: Especie, linhas: Linha[] = [{}], extra: Record<string, unknown> = {}): Promise<Doc> => naApp(async (tx) => {
  const id = await inserirCabecalho(tx, especie, extra);
  const itens: string[] = [];
  for (const [i, l] of linhas.entries()) itens.push(await inserirItem(tx, id, l, i));
  return { id, itens };
});
/** UPDATE do cabeçalho pelo papel da aplicação (a resposta traz o ROW COUNT). */
const upd = (id: string, set: string, p: unknown[] = []) =>
  naApp((tx) => tx.query(`update erp.documentos_compra set ${set} where id=$1`, [id, ...p]));
const situacao = (id: string, s: string) => upd(id, "situacao=$2", [s]);
const finalizar = (id: string) => upd(id, "situacao='finalizado', finalizado_em=now(), finalizado_por=$2", [demo.adminUserId]);
const aprovarParaOrcamento = (id: string) => upd(id, "aprovado_orcamento_em=now(), aprovado_orcamento_por=$2", [demo.adminUserId]);

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 5 });
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of listMigrations().filter((x) => x.name < ALVO)) {
    await db.query(m.sql);
    await db.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
  }
  await seedReference(db, () => {});
  demo = await seedDemo(db, {}, () => {});
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@"), { max: 3 });
  empresa = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code limit 1", [demo.orgId])).rows[0]!.id;
  cliente = (await db.query<{ id: string }>("select id from erp.people where organization_id=$1 and is_client order by code limit 1", [demo.orgId])).rows[0]!.id;
  fornecedor = await id1("insert into erp.people (organization_id, code, name, is_provider) values ($1,'E02-F1','[TEST] Fornecedor E02 1',true) returning id", [demo.orgId]);
  fornecedor2 = await id1("insert into erp.people (organization_id, code, name, is_provider) values ($1,'E02-F2','[TEST] Fornecedor E02 2',true) returning id", [demo.orgId]);
  const produtos = (await db.query<{ id: string }>("select id from erp.products where organization_id=$1 and controle_lote='nenhum' order by code limit 2", [demo.orgId])).rows;
  produtoX = produtos[0]!.id; produtoY = produtos[1]!.id;
  tops.pedido = await criarTop("compras.pedido");
  tops.compra = await criarTop("compras.compra");
  tops.orcamento = await criarTop("compras.orcamento");

  // O ACERVO, pelo caminho de antes (papel da aplicação, gatilhos da 0036–0047): as três espécies, aberto e fora dele.
  acervo.pedidoAberto = await documento("pedido", [{ qtd: "10" }]);
  await upd(acervo.pedidoAberto.id, "observacao='editado antes da 0063'");
  acervo.compraAberta = await documento("compra", [{ qtd: "2" }]);
  acervo.compraConfirmada = await documento("compra");
  await situacao(acervo.compraConfirmada.id, "confirmado");
  acervo.pedidoFinalizado = await documento("pedido");
  await finalizar(acervo.pedidoFinalizado.id);
  acervo.pedidoCancelado = await documento("pedido");
  await situacao(acervo.pedidoCancelado.id, "cancelado");
  acervo.pedidoOrcado = await documento("pedido", [{ qtd: "3", produto: produtoY }]);
  await aprovarParaOrcamento(acervo.pedidoOrcado.id);
  acervo.orcamento = await documento("orcamento", [{ qtd: "3", produto: produtoY, orcado: acervo.pedidoOrcado.itens[0]!, unitario: "9.5" }],
    { fornecedor_id: fornecedor2, pedido_orcado_id: acervo.pedidoOrcado.id });
  // Uma VENDA de antes (a 0039 já aplicada): a 0063 não a toca.
  vendaAcervo = await id1(
    `insert into erp.sales_documents (organization_id, empresa_id, kind, code, document_date, client_id, note) values ($1,$2,'order','E02-V1','2026-10-01',$3,'venda de antes') returning id`,
    [demo.orgId, empresa, cliente]);
  await db.query("update erp.sales_documents set note='venda editada antes da 0063' where id=$1", [vendaAcervo]);
  filenodeAntes = (await db.query<{ f: number }>("select pg_relation_filenode('erp.documentos_compra')::int f")).rows[0]!.f;
  antes = await retrato();
  gatilhosAntes = await gatilhosDeAntes();
  vendaAntes = await versaoDaVenda();
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

describe("0063 — sobre o acervo de documentos de compra, como o runner aplica", () => {
  it("V1 PREMISSA: sob a 0062 há acervo das três espécies, não há coluna/função/gatilho da versão, e os BEFORE UPDATE são as cinco guardas", async () => {
    expect(antes.documentos.length, "sem acervo, 'o acervo lê 0 sem regravar' seria verdade sobre conjunto vazio").toBe(7);
    const especies = (await db.query<{ e: string }>("select especie || ':' || situacao e from erp.documentos_compra order by 1")).rows.map((r) => r.e);
    expect(especies).toEqual(["compra:aberto", "compra:confirmado", "orcamento:aberto", "pedido:aberto", "pedido:aberto", "pedido:cancelado", "pedido:finalizado"]);
    expect(antes.itens.length).toBe(7);
    expect(await noLedger()).toBe(false);
    expect((await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0])
      .toEqual({ n: 62, ultima: "0062_icones_identificador_e_fuso.sql" });
    expect(await temColuna()).toBe(false);
    expect(await temFuncao()).toBe(false);
    expect(await beforeUpdate()).toEqual(GUARDAS);
    // A venda tem a versão da 0039 (que a 0063 não toca), e a venda do acervo já está em 1.
    expect(vendaAntes).toHaveLength(1);
    expect(await versaoDaVendaDe(vendaAcervo)).toBe("1");
    // O papel da aplicação já não é dono, nem superusuário, nem troca session_replication_role, nem tem TRIGGER.
    const papel = (await db.query(
      `select pg_has_role('erp_app', c.relowner, 'MEMBER') dono, r.rolsuper su, has_parameter_privilege('erp_app','session_replication_role','SET') srr,
              has_table_privilege('erp_app','erp.documentos_compra','TRIGGER') trig
         from pg_class c, pg_roles r where c.oid='erp.documentos_compra'::regclass and r.rolname='erp_app'`)).rows;
    expect(papel).toEqual([{ dono: false, su: false, srr: false, trig: false }]);
    // Nem por SET ROLE: a DIREÇÃO importa — o erp_app_test (login do teste) é membro DO erp_app, está abaixo dele, e não conta.
    expect(await papeisPerigososDoApp()).toEqual([]);
    expect((await db.query<{ m: boolean }>("select pg_has_role('erp_app_test','erp_app','MEMBER') m")).rows[0]!.m, "a contraprova da direção existe").toBe(true);
    expect(await ajusteReplica()).toEqual([]);
    // O grant de TABELA da 0036 (não por coluna): é ele que fará a coluna nova legível pelo erp_app.
    const grants = (await db.query<{ p: string }>(
      `select privilege_type p from information_schema.role_table_grants where table_schema='erp' and table_name='documentos_compra' and grantee='erp_app' order by 1`)).rows.map((r) => r.p);
    expect(grants).toEqual(["INSERT", "SELECT", "UPDATE"]);
  });

  it("V2 trava (2026,97) em uso por outra sessão: a 0063 recusa antes de tudo, sem efeito", async () => {
    const outra = await db.connect();
    try {
      await outra.query("select pg_advisory_lock(2026, 97)");
      await expect(aplicar()).rejects.toThrow(`${M}outra transacao ja detem a trava desta migration (2026,97). Nada foi aplicado.`);
    } finally { await outra.query("select pg_advisory_unlock(2026, 97)"); outra.release(); }
    expect(await noLedger()).toBe(false);
    expect(await temColuna()).toBe(false);
    // Contraprova do número: a trava da 0039 (2026,73) em uso NÃO segura a 0063 (desfeita no fim).
    const outra73 = await db.connect();
    try {
      await outra73.query("select pg_advisory_lock(2026, 73)");
      await expect(recusaDa0063()).rejects.toThrow("esperava a 0063 recusar, e ela aplicou");
    } finally { await outra73.query("select pg_advisory_unlock(2026, 73)"); outra73.release(); }
    expect(await temColuna()).toBe(false);
  });

  it("V3 lock_timeout 2s: uma leitura aberta em erp.documentos_compra faz a 0063 desistir em ~2s, sem efeito", async () => {
    const leitor = await db.connect();
    try {
      await leitor.query("begin");
      await leitor.query("select 1 from erp.documentos_compra limit 1");      // AccessShare: o ALTER TABLE precisa de AccessExclusive
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

  it("V4 reversas: cada pré-condição quebrada recusa a 0063 com a SUA mensagem, sem efeito", async () => {
    const imitacao = (c: Tx) => c.query("create function erp.e02_imitacao_b1() returns trigger language plpgsql as 'begin return new; end'");
    const JA_APLICADA = `${M}erp.documentos_compra.version ja existe; a 0063 ja foi aplicada ou ha schema divergente.`;
    // "Já aplicada" é a PRIMEIRA: com a coluna E outras pré-condições quebradas juntas (a função, o gatilho, o TRIGGER do
    // erp_app), o motivo é o de "já aplicada".
    expect(await recusaDa0063((c) => c.query("alter table erp.documentos_compra add column version int"))).toBe(JA_APLICADA);
    expect(await recusaDa0063(async (c) => {
      await c.query("alter table erp.documentos_compra add column version bigint not null default 0");
      await c.query("create function erp.documentos_compra_versao() returns trigger language plpgsql as 'begin return new; end'");
      await c.query("create trigger trg_documentos_compra_versao before update on erp.documentos_compra for each row execute function erp.documentos_compra_versao()");
      await c.query("grant trigger on erp.documentos_compra to erp_app");
    })).toBe(JA_APLICADA);
    // A tabela ausente (a cadeia fora de ordem).
    expect(await recusaDa0063((c) => c.query("alter table erp.documentos_compra rename to documentos_compra_e02r_b1")))
      .toBe(`${M}erp.documentos_compra ausente; a cadeia de migrations esta fora de ordem.`);
    // Função já existe.
    expect(await recusaDa0063((c) => c.query("create function erp.documentos_compra_versao() returns trigger language plpgsql as 'begin return new; end'")))
      .toBe(`${M}a funcao erp.documentos_compra_versao() ja existe; schema divergente.`);
    // Gatilho já existe (com o nome da 0063, apontando para outra função).
    expect(await recusaDa0063(async (c) => {
      await imitacao(c);
      await c.query("create trigger trg_documentos_compra_versao before update on erp.documentos_compra for each row execute function erp.e02_imitacao_b1()");
    })).toBe(`${M}o gatilho trg_documentos_compra_versao ja existe em erp.documentos_compra; schema divergente.`);
    // O conjunto dos BEFORE UPDATE por linha: um a mais, um a menos, e o mesmo nome em outra função.
    const CONJUNTO = /^EDITAR-02: gatilhos BEFORE UPDATE por linha de erp\.documentos_compra diferentes dos cinco esperados .*: /;
    const aMais = await recusaDa0063(async (c) => {
      await imitacao(c);
      await c.query("create trigger trg_documentos_compra_a_mais before update on erp.documentos_compra for each row execute function erp.e02_imitacao_b1()");
    });
    expect(aMais).toMatch(CONJUNTO);
    expect(aMais).toContain("trg_documentos_compra_a_mais -> erp.e02_imitacao_b1");
    expect(await recusaDa0063((c) => c.query("drop trigger trg_documentos_compra_nota on erp.documentos_compra"))).toMatch(CONJUNTO);
    const outraFuncao = await recusaDa0063(async (c) => {
      await imitacao(c);
      await c.query("drop trigger trg_documentos_compra_conferir on erp.documentos_compra");
      await c.query("create trigger trg_documentos_compra_conferir before insert or update on erp.documentos_compra for each row execute function erp.e02_imitacao_b1()");
    });
    expect(outraFuncao).toMatch(CONJUNTO);
    expect(outraFuncao).toContain("trg_documentos_compra_conferir -> erp.e02_imitacao_b1");
    // Contraprova: AFTER UPDATE, BEFORE INSERT, BEFORE UPDATE por COMANDO e gatilho de ITEM não entram na ordem dos BEFORE UPDATE por linha.
    await expect(recusaDa0063(async (c) => {
      await imitacao(c);
      await c.query("create trigger trg_documentos_compra_zz_depois after update on erp.documentos_compra for each row execute function erp.e02_imitacao_b1()");
      await c.query("create trigger trg_documentos_compra_zz_insert before insert on erp.documentos_compra for each row execute function erp.e02_imitacao_b1()");
      await c.query("create trigger trg_documentos_compra_zz_comando before update on erp.documentos_compra for each statement execute function erp.e02_imitacao_b1()");
      await c.query("create trigger trg_documentos_compra_itens_zz before update on erp.documentos_compra_itens for each row execute function erp.e02_imitacao_b1()");
    })).rejects.toThrow("esperava a 0063 recusar, e ela aplicou");
    // Quem aplica não é dono da tabela (o papel da aplicação).
    expect(await recusaDa0063((c) => c.query("set local role erp_app")))
      .toBe(`${M}o papel que aplica a migration nao e dono de erp.documentos_compra; o ALTER TABLE e o CREATE TRIGGER seriam recusados.`);
    // Quem aplica é dono da tabela, mas não cria objetos no schema erp.
    expect(await recusaDa0063(async (c) => {
      await c.query("create role e02r_aplicador_b1 nologin");
      await c.query("grant usage on schema erp to e02r_aplicador_b1");
      await c.query("alter table erp.documentos_compra owner to e02r_aplicador_b1");
      await c.query("set local role e02r_aplicador_b1");
    })).toBe(`${M}o papel que aplica a migration nao cria objetos no schema erp; o CREATE FUNCTION seria recusado.`);
    // O papel da aplicação não existe: a PRIMEIRA pergunta sobre ele, com o motivo nomeado.
    expect(await recusaDa0063((c) => c.query("alter role erp_app rename to e02r_app_ausente_b1")))
      .toBe(`${M}o papel erp_app nao existe; a 0007 nao esta aplicada ou ha schema divergente.`);
    // O papel da aplicação é membro do dono da tabela — mesmo sem herdar (o erp_app é NOINHERIT), faria SET ROLE para ele.
    const MEMBRO = `${M}o papel da aplicacao (erp_app) e dono de erp.documentos_compra ou membro do papel dono; poderia desligar o gatilho da versao.`;
    expect(await recusaDa0063(async (c) => {
      await c.query("create role e02r_dono_b1 nologin");
      await c.query("alter table erp.documentos_compra owner to e02r_dono_b1");
      await c.query("grant e02r_dono_b1 to erp_app");
    })).toBe(MEMBRO);
    expect(await recusaDa0063(async (c) => {
      await c.query("create role e02r_dono_b1 nologin");
      await c.query("alter table erp.documentos_compra owner to e02r_dono_b1");
      await c.query("grant e02r_dono_b1 to erp_app with inherit false, set true");
      const r = (await c.query<{ usage: boolean; set: boolean }>(
        "select pg_has_role('erp_app','e02r_dono_b1','USAGE') usage, pg_has_role('erp_app','e02r_dono_b1','SET') set")).rows[0]!;
      expect(r, "contraprova do motivo: sem herdar, o erp_app não usa o dono, mas é membro e o SET ROLE basta").toEqual({ usage: false, set: true });
    })).toBe(MEMBRO);
    // O papel da aplicação é superusuário, ou pode trocar session_replication_role.
    const REPLICA = `${M}o papel da aplicacao (erp_app) e superusuario ou pode trocar session_replication_role; poderia desligar o gatilho da versao.`;
    expect(await recusaDa0063((c) => c.query("alter role erp_app superuser"))).toBe(REPLICA);
    expect(await recusaDa0063((c) => c.query("grant set on parameter session_replication_role to erp_app"))).toBe(REPLICA);
    // O papel da aplicação tem TRIGGER na tabela.
    expect(await recusaDa0063((c) => c.query("grant trigger on erp.documentos_compra to erp_app")))
      .toBe(`${M}o papel da aplicacao (erp_app) tem TRIGGER em erp.documentos_compra; poderia criar um gatilho depois do da versao.`);
    // Contraprova da tabela: TRIGGER em erp.sales_documents (a da 0039) não é pergunta da 0063.
    await expect(recusaDa0063((c) => c.query("grant trigger on erp.sales_documents to erp_app"))).rejects.toThrow("esperava a 0063 recusar, e ela aplicou");
    // O papel da aplicação é MEMBRO — sem herdar, direto ou em cadeia — de um papel que desligaria o gatilho.
    const acima = (papeis: string) => `${M}o papel da aplicacao (erp_app) e membro (com ou sem heranca) de papel superusuario, com SET em session_replication_role ou com TRIGGER em erp.documentos_compra: {${papeis}}; faria SET ROLE e poderia desligar o gatilho da versao.`;
    expect(await recusaDa0063(async (c) => {
      await c.query("create role e02r_gatilho_b1 nologin");
      await c.query("grant trigger on erp.documentos_compra to e02r_gatilho_b1");
      await c.query("grant e02r_gatilho_b1 to erp_app with inherit false, set true");
      const r = (await c.query<{ trig: boolean; set: boolean }>(
        "select has_table_privilege('erp_app','erp.documentos_compra','TRIGGER') trig, pg_has_role('erp_app','e02r_gatilho_b1','SET') set")).rows[0]!;
      expect(r, "contraprova: a pergunta direta não vê o TRIGGER; o SET ROLE alcança").toEqual({ trig: false, set: true });
    })).toBe(acima("e02r_gatilho_b1"));
    expect(await recusaDa0063(async (c) => {
      await c.query("create role e02r_replica_b1 nologin");
      await c.query("grant set on parameter session_replication_role to e02r_replica_b1");
      await c.query("grant e02r_replica_b1 to erp_app with inherit false, set true");
    })).toBe(acima("e02r_replica_b1"));
    // Em CADEIA e sem SET na primeira aresta: erp_app → e02r_meio_b1 (sem herdar, sem SET) → e02r_su_b1 (superusuário).
    expect(await recusaDa0063(async (c) => {
      await c.query("create role e02r_su_b1 nologin superuser");
      await c.query("create role e02r_meio_b1 nologin");
      await c.query("grant e02r_su_b1 to e02r_meio_b1");
      await c.query("grant e02r_meio_b1 to erp_app with inherit false, set false");
    })).toBe(acima("e02r_su_b1"));
    // Ajuste guardado que liga `replica` na sessão do erp_app: do papel (neste banco ou em outro) e de todos os papéis.
    const AJUSTE = `${M}ha session_replication_role em pg_db_role_setting para o erp_app (ALTER ROLE erp_app SET, ALTER ROLE ALL SET ou ALTER DATABASE SET); a sessao dele nasceria com o gatilho da versao desligado.`;
    expect(await recusaDa0063((c) => c.query("alter role erp_app set session_replication_role = replica"))).toBe(AJUSTE);
    expect(await recusaDa0063((c) => c.query("alter role erp_app in database template1 set session_replication_role = replica"))).toBe(AJUSTE);
    expect(await recusaDa0063((c) => c.query("do $d$ begin execute format('alter database %I set session_replication_role = replica', current_database()); end $d$"))).toBe(AJUSTE);
    // Contraprova da direção: um ajuste de OUTRO papel não alcança a sessão do erp_app.
    await expect(recusaDa0063(async (c) => {
      await c.query("create role e02r_outro_b1 nologin");
      await c.query("alter role e02r_outro_b1 set session_replication_role = replica");
    })).rejects.toThrow("esperava a 0063 recusar, e ela aplicou");
    // Nada ficou: o ledger, a coluna, a função, os gatilhos, o dono, os privilégios, os papéis de ensaio e o acervo são os de antes.
    expect(await noLedger()).toBe(false);
    expect(await temColuna()).toBe(false);
    expect(await temFuncao()).toBe(false);
    expect(await beforeUpdate()).toEqual(GUARDAS);
    const estado = (await db.query(
      `select c.relowner::regrole::text dono, r.rolsuper su, has_parameter_privilege('erp_app','session_replication_role','SET') srr,
              has_table_privilege('erp_app','erp.documentos_compra','TRIGGER') trig
         from pg_class c, pg_roles r where c.oid='erp.documentos_compra'::regclass and r.rolname='erp_app'`)).rows;
    expect(estado).toEqual([{ dono: "postgres", su: false, srr: false, trig: false }]);
    expect((await db.query("select 1 from pg_roles where rolname like 'e02r\\_%'")).rowCount).toBe(0);
    expect((await db.query("select 1 from pg_roles where rolname = 'erp_app'")).rowCount, "o rename do erp_app foi desfeito").toBe(1);
    expect(await papeisPerigososDoApp()).toEqual([]);
    expect(await ajusteReplica()).toEqual([]);
    expect(await retrato()).toEqual(antes);
    expect(await gatilhosDeAntes()).toEqual(gatilhosAntes);
  });

  it("V5 aplica: ledger com 63 (a 0063 por último), tabela NÃO regravada, acervo idêntico e lendo 0, objetos no catálogo, vendas intacta", async () => {
    await aplicar();
    const ledger = (await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0]!;
    expect(ledger).toEqual({ n: 63, ultima: ALVO });
    const noDisco = listMigrations().map((m) => m.name);
    expect(noDisco.length, "65 migrations no repositório (0001..0065; a 0065 é da EDITAR-02B)").toBe(65);
    expect(noDisco[62]).toBe(ALVO);
    // ADD COLUMN com default constante é só metadado: o arquivo físico é o mesmo, e o 0 vem do catálogo.
    expect((await db.query<{ f: number }>("select pg_relation_filenode('erp.documentos_compra')::int f")).rows[0]!.f, "a tabela não foi regravada").toBe(filenodeAntes);
    expect((await db.query<{ m: boolean }>("select atthasmissing m from pg_attribute where attrelid='erp.documentos_compra'::regclass and attname='version'")).rows[0]!.m).toBe(true);
    expect(await retrato(), "nenhuma outra coluna do acervo muda (nem itens, nem vendas)").toEqual(antes);
    const versoes = (await db.query<{ v: string }>("select distinct version::text v from erp.documentos_compra")).rows.map((r) => r.v);
    expect(versoes, "SEM BACKFILL: o acervo inteiro (sete documentos) lê o default").toEqual(["0"]);

    const coluna = (await db.query(
      "select data_type, is_nullable, column_default from information_schema.columns where table_schema='erp' and table_name='documentos_compra' and column_name='version'")).rows;
    expect(coluna).toEqual([{ data_type: "bigint", is_nullable: "NO", column_default: "0" }]);
    // O papel da aplicação lê a coluna pelo grant de TABELA (nenhum grant por coluna nasceu).
    const leitura = (await db.query(
      `select has_column_privilege('erp_app','erp.documentos_compra','version','SELECT') le, has_column_privilege('erp_app','erp.documentos_compra','version','UPDATE') grava,
              (select a.attacl is null from pg_attribute a where a.attrelid='erp.documentos_compra'::regclass and a.attname='version') sem_grant_por_coluna,
              has_table_privilege('erp_app','erp.documentos_compra','DELETE') apaga`)).rows;
    expect(leitura, "UPDATE da coluna existe pelo grant de tabela — e o gatilho o sobrescreve (VA1)").toEqual([{ le: true, grava: true, sem_grant_por_coluna: true, apaga: false }]);
    const funcao = (await db.query(
      `select p.prosecdef definer, p.proconfig cfg, l.lanname lang, has_function_privilege('erp_app', p.oid, 'execute') app,
              has_function_privilege('public', p.oid, 'execute') publico, p.proowner::regrole::text dono
         from pg_proc p join pg_language l on l.oid = p.prolang where p.oid='erp.documentos_compra_versao()'::regprocedure`)).rows;
    expect(funcao).toEqual([{ definer: false, cfg: ["search_path=erp, pg_temp"], lang: "plpgsql", app: false, publico: false, dono: "postgres" }]);
    const gatilho = (await db.query(
      `select pg_get_triggerdef(t.oid) def, t.tgenabled ligado from pg_trigger t
        where t.tgrelid='erp.documentos_compra'::regclass and t.tgname='trg_documentos_compra_versao'`)).rows;
    expect(gatilho).toEqual([{
      def: "CREATE TRIGGER trg_documentos_compra_versao BEFORE UPDATE ON erp.documentos_compra FOR EACH ROW EXECUTE FUNCTION erp.documentos_compra_versao()",
      ligado: "O"
    }]);
    // A ORDEM: a versão é o último BEFORE UPDATE por linha, depois das cinco guardas.
    expect(await beforeUpdate()).toEqual([...GUARDAS, "trg_documentos_compra_versao"]);
    // Nenhum gatilho de antes (compras e vendas, cabeçalho e itens) mudou de definição, de estado ou de corpo; nada nos itens.
    expect(await gatilhosDeAntes()).toEqual(gatilhosAntes);
    expect((await db.query("select 1 from pg_trigger where tgrelid='erp.documentos_compra_itens'::regclass and tgname like '%versao%'")).rowCount).toBe(0);
    // VENDAS: a coluna, a função e a ACL da 0039 são as mesmas; a venda de antes continua em 1 e soma 1 por UPDATE.
    expect(await versaoDaVenda()).toEqual(vendaAntes);
    expect(await versaoDaVendaDe(vendaAcervo)).toBe("1");
    await db.query("update erp.sales_documents set note='venda depois da 0063' where id=$1", [vendaAcervo]);
    expect(await versaoDaVendaDe(vendaAcervo), "a venda soma 1 pelo gatilho dela, e só").toBe("2");
  });

  it("V6 reaplicar é recusado pela pré-condição de 'já aplicada', sem efeito", async () => {
    expect(await recusaDa0063()).toBe(`${M}erp.documentos_compra.version ja existe; a 0063 ja foi aplicada ou ha schema divergente.`);
    expect(await beforeUpdate()).toEqual([...GUARDAS, "trg_documentos_compra_versao"]);
    expect((await db.query<{ n: number }>("select count(*)::int n from erp.documentos_compra where version <> 0")).rows[0]!.n).toBe(0);
  });

  it("V7 pós-condições: só de catálogo, passam no banco aplicado, e cada uma, quebrada, recusa com a sua mensagem", async () => {
    const sql = sqlDaAlvo();
    const inicio = sql.indexOf("-- ---------- 5) pós-condições");
    expect(inicio, "o trecho 5) existe").toBeGreaterThan(0);
    const pos = sql.slice(inicio);
    expect(pos).toMatch(/^-- [^\n]*\ndo \$\$/);
    expect(pos.match(/\b(from|join)\s+erp\.\w+/gi), "nenhuma leitura de tabela do erp nas pós-condições").toBeNull();
    const c = await db.connect();
    try { await c.query("begin"); await expect(c.query(pos)).resolves.toBeTruthy(); } finally { await c.query("rollback"); c.release(); }

    const COLUNA = `${M}erp.documentos_compra.version nao e bigint not null default 0 (sem identity, sem generated).`;
    const LEITURA = `${M}o papel da aplicacao (erp_app) nao le erp.documentos_compra.version; a edicao nao conferiria a versao.`;
    const FUNCAO = `${M}erp.documentos_compra_versao() nao e plpgsql, retornando trigger, SECURITY INVOKER, com search_path "erp, pg_temp".`;
    const EXECUTE = `${M}EXECUTE de erp.documentos_compra_versao() concedido alem do dono.`;
    const GATILHO = `${M}gatilho trg_documentos_compra_versao ausente, desligado, de outro tipo (antes de UPDATE, por linha, sem coluna e sem WHEN) ou fora de erp.documentos_compra_versao().`;
    const ORDEM = /^EDITAR-02: o gatilho da versao nao e o ultimo BEFORE UPDATE por linha de erp\.documentos_compra \(ordem por nome\): /;
    const recriar = (def: string) => `drop trigger trg_documentos_compra_versao on erp.documentos_compra; create trigger trg_documentos_compra_versao ${def}`;
    const casos: [string, string, string | RegExp][] = [
      ["default 1", "alter table erp.documentos_compra alter column version set default 1", COLUNA],
      ["anulável", "alter table erp.documentos_compra alter column version drop not null", COLUNA],
      ["identity", "alter table erp.documentos_compra alter column version drop default, alter column version add generated always as identity", COLUNA],
      ["erp_app sem SELECT da coluna (grant só por coluna, sem ela)", "revoke select on erp.documentos_compra from erp_app; grant select (id, situacao) on erp.documentos_compra to erp_app", LEITURA],
      ["SECURITY DEFINER", "alter function erp.documentos_compra_versao() security definer", FUNCAO],
      ["sem search_path", "alter function erp.documentos_compra_versao() reset search_path", FUNCAO],
      ["outro search_path", "alter function erp.documentos_compra_versao() set search_path = erp, public", FUNCAO],
      ["EXECUTE do erp_app", "grant execute on function erp.documentos_compra_versao() to erp_app", EXECUTE],
      ["EXECUTE de PUBLIC", "grant execute on function erp.documentos_compra_versao() to public", EXECUTE],
      ["gatilho desligado", "alter table erp.documentos_compra disable trigger trg_documentos_compra_versao", GATILHO],
      ["gatilho só em réplica", "alter table erp.documentos_compra enable replica trigger trg_documentos_compra_versao", GATILHO],
      ["gatilho com lista de colunas", recriar("before update of observacao on erp.documentos_compra for each row execute function erp.documentos_compra_versao()"), GATILHO],
      ["gatilho com WHEN", recriar("before update on erp.documentos_compra for each row when (old.* is distinct from new.*) execute function erp.documentos_compra_versao()"), GATILHO],
      ["gatilho também no INSERT", recriar("before insert or update on erp.documentos_compra for each row execute function erp.documentos_compra_versao()"), GATILHO],
      ["gatilho AFTER", recriar("after update on erp.documentos_compra for each row execute function erp.documentos_compra_versao()"), GATILHO],
      ["um BEFORE UPDATE depois da versão", "create trigger trg_documentos_compra_zz before update on erp.documentos_compra for each row execute function erp.documentos_compra_versao()", ORDEM]
    ];
    for (const [nome, sabotagem, mensagem] of casos) {
      expect([nome, await recusaDe(pos, (t) => t.query(sabotagem))]).toEqual([nome, typeof mensagem === "string" ? mensagem : expect.stringMatching(mensagem)]);
    }
    // Contraprova da ordem: um AFTER UPDATE que ordena depois por nome não é BEFORE e não conta.
    const c2 = await db.connect();
    try {
      await c2.query("begin");
      await c2.query("create trigger trg_documentos_compra_zz after update on erp.documentos_compra for each row execute function erp.audit_row()");
      await expect(c2.query(pos)).resolves.toBeTruthy();
    } finally { await c2.query("rollback"); c2.release(); }
    // Nada ficou.
    expect(await beforeUpdate()).toEqual([...GUARDAS, "trg_documentos_compra_versao"]);
    expect((await db.query<{ x: boolean }>("select has_function_privilege('erp_app', 'erp.documentos_compra_versao()', 'execute') x")).rows[0]!.x).toBe(false);
  });
});

describe("a versão pelo papel da aplicação (RLS, GUC da transação, módulo compras) e por qualquer caminho", () => {
  it("VA1 insert nasce 0; todo update soma 1 — que muda, que não muda nada, que manda valor explícito ou nulo; o desfeito não deixa rastro", async () => {
    const { id } = await documento("compra");
    expect(await versao(id)).toBe("0");
    await expect(upd(id, "observacao='editado'")).resolves.toMatchObject({ rowCount: 1 });
    expect(await versao(id)).toBe("1");
    await expect(upd(id, "observacao=observacao")).resolves.toMatchObject({ rowCount: 1 });
    expect(await versao(id), "update que não muda nada também soma").toBe("2");
    await expect(upd(id, "version=999")).resolves.toMatchObject({ rowCount: 1 });
    expect(await versao(id), "SET version = 999 vira old+1").toBe("3");
    await expect(upd(id, "version=version-10, observacao='de volta'")).resolves.toMatchObject({ rowCount: 1 });
    expect(await versao(id), "voltar a versão também vira old+1").toBe("4");
    await expect(upd(id, "version=null")).resolves.toMatchObject({ rowCount: 1 });
    expect(await versao(id), "o NOT NULL é conferido depois do BEFORE: nulo vira old+1").toBe("5");
    await expect(naApp(async (tx) => { await tx.query("update erp.documentos_compra set observacao='desfeito' where id=$1", [id]); throw new Error("desfaz"); }))
      .rejects.toThrow("desfaz");
    expect(await versao(id)).toBe("5");
    // A trava otimista como a edição a usa: o UPDATE condicionado à versão lida grava UMA vez; o segundo, com a versão velha, zero linhas.
    const r1 = await naApp((tx) => tx.query<{ version: string }>("update erp.documentos_compra set observacao='quem leu 5' where id=$1 and version=$2 returning version::text", [id, "5"]));
    expect([r1.rowCount, r1.rows[0]?.version], "RETURNING devolve a versão já somada pelo gatilho").toEqual([1, "6"]);
    const r2 = await naApp((tx) => tx.query("update erp.documentos_compra set observacao='quem também leu 5' where id=$1 and version=$2", [id, "5"]));
    expect(r2.rowCount, "a versão velha não grava").toBe(0);
    expect(await versao(id)).toBe("6");
  });

  it("VA2 update de várias linhas: cada uma soma 1 a partir da PRÓPRIA versão", async () => {
    const ids = [(await documento("pedido")).id, (await documento("compra")).id, (await documento("pedido")).id];
    await upd(ids[2]!, "observacao='um'");
    await upd(ids[2]!, "observacao='dois'");
    const r = await naApp((tx) => tx.query("update erp.documentos_compra set observacao='lote', version=0 where id = any($1)", [ids]));
    expect(r.rowCount).toBe(3);
    expect([await versao(ids[0]!), await versao(ids[1]!), await versao(ids[2]!)]).toEqual(["1", "1", "3"]);
  });

  it("VA3 a versão é do CABEÇALHO: item sozinho não soma; item + cabeçalho na MESMA transação (como a API grava) soma 1", async () => {
    const d = await documento("compra", [{ qtd: "2" }]);
    expect(await versao(d.id)).toBe("0");
    await naApp((tx) => inserirItem(tx, d.id, { produto: produtoY, qtd: "1" }, 1));
    await naApp((tx) => tx.query("update erp.documentos_compra_itens set quantidade = 3 where id=$1", [d.itens[0]]));
    expect(await versao(d.id), "escrita só em item não soma (a 0039 faz igual)").toBe("0");
    // A edição: itens e totais do cabeçalho na mesma transação — um UPDATE do cabeçalho, uma soma.
    await naApp(async (tx) => {
      await tx.query("update erp.documentos_compra_itens set quantidade = 4, valor_total = 40 where id=$1", [d.itens[0]]);
      await inserirItem(tx, d.id, { produto: produtoY, qtd: "2" }, 2);
      const u = await tx.query("update erp.documentos_compra set valor_itens = 40, valor_total = 40 where id=$1", [d.id]);
      expect(u.rowCount).toBe(1);
    });
    expect(await versao(d.id), "item + cabeçalho: +1").toBe("1");
    // Dois UPDATEs do cabeçalho na mesma transação são duas somas (a rota devolve a versão da última linha).
    const r = await naApp(async (tx) => {
      await tx.query("update erp.documentos_compra set observacao='parte 1' where id=$1", [d.id]);
      return (await tx.query<{ v: string }>("update erp.documentos_compra set observacao='parte 2' where id=$1 returning version::text v", [d.id])).rows[0]!.v;
    });
    expect([r, await versao(d.id)]).toEqual(["3", "3"]);
  });

  it("VA4 o acervo pelo papel da aplicação: o primeiro UPDATE depois da 0063 leva cada espécie de 0 a 1, aberto ou fora dele", async () => {
    await upd(acervo.pedidoAberto.id, "observacao='editado depois da 0063'");
    await upd(acervo.compraAberta.id, "observacao='editado depois da 0063'");
    await situacao(acervo.compraConfirmada.id, "cancelado");        // confirmado → cancelado: fora do aberto
    await situacao(acervo.pedidoFinalizado.id, "cancelado");        // finalizado → cancelado: fora do aberto
    await situacao(acervo.orcamento.id, "nao_escolhido");           // orçamento aberto → não escolhido
    for (const id of [acervo.pedidoAberto.id, acervo.compraAberta.id, acervo.compraConfirmada.id, acervo.pedidoFinalizado.id, acervo.orcamento.id]) {
      expect([id, await versao(id)]).toEqual([id, "1"]);
    }
    expect(await situacaoDe(acervo.compraConfirmada.id)).toBe("cancelado");
    // O script de suporte (superusuário) também passa pelo gatilho — aqui num documento CANCELADO (congelado: só um UPDATE que
    // não muda coluna nenhuma passa pela conferência v3), e mesmo assim soma.
    const congelado = await erroDe(db.query("update erp.documentos_compra set observacao='suporte' where id=$1", [acervo.pedidoCancelado.id]));
    expect(congelado.message).toBe("CONFLICT: O documento de compra está cancelado; só a situação muda.");
    expect(await versao(acervo.pedidoCancelado.id)).toBe("0");
    await expect(db.query("update erp.documentos_compra set situacao = situacao where id=$1", [acervo.pedidoCancelado.id])).resolves.toMatchObject({ rowCount: 1 });
    expect(await versao(acervo.pedidoCancelado.id), "o UPDATE que não muda nada, fora do aberto, também soma").toBe("1");
  });

  it("VA5 a ORDEM com a conferência v3: as transições FORA do aberto passam e somam 1 cada; o valor explícito fora do aberto é RECUSADO por ela; a recusa não soma", async () => {
    // COMPRA: aberto → confirmado → cancelado.
    const compra = (await documento("compra")).id;
    await situacao(compra, "confirmado");
    expect(await versao(compra)).toBe("1");
    const forjada = await erroDe(upd(compra, "version=999"));
    expect(forjada.message, "fora do aberto, a conferência v3 (que roda ANTES da soma) vê o valor mandado e recusa").toBe("CONFLICT: O documento de compra está confirmado; só a situação muda.");
    expect(await versao(compra)).toBe("1");
    await expect(situacao(compra, "cancelado")).resolves.toMatchObject({ rowCount: 1 });
    expect(await versao(compra), "cancelar a compra confirmada passa pelo congelamento da linha inteira — só porque a soma vem depois").toBe("2");
    const final = await erroDe(situacao(compra, "aberto"));
    expect(final.message).toBe("CONFLICT: O documento de compra está cancelado; o cancelamento é final.");
    expect(await versao(compra), "a transição recusada desfaz a transação inteira, a versão também").toBe("2");
    // Contraprova da ORDEM: com o gatilho da versão renomeado para ordenar ANTES da conferência v3 (transação desfeita), a
    // MESMA transição fora do aberto é recusada pelo congelamento da linha inteira — é por isso que a versão tem de ser a última.
    const outra = (await documento("compra")).id;
    await situacao(outra, "confirmado");
    const c = await db.connect();
    try {
      await c.query("begin");
      await c.query("alter trigger trg_documentos_compra_versao on erp.documentos_compra rename to trg_documentos_compra_0_versao");
      const antesDaConferencia = await erroDe(c.query("update erp.documentos_compra set situacao='cancelado' where id=$1", [outra]));
      expect(antesDaConferencia.message).toBe("CONFLICT: O documento de compra está confirmado; só a situação muda.");
    } finally { await c.query("rollback").catch(() => {}); c.release(); }
    expect(await beforeUpdate()).toEqual([...GUARDAS, "trg_documentos_compra_versao"]);
    await expect(situacao(outra, "cancelado")).resolves.toMatchObject({ rowCount: 1 });
    expect(await versao(outra), "com a ordem da migration, a mesma transição passa e soma").toBe("2");
    // PEDIDO: aberto → aprovado para orçamento → finalizado → convertido → (reabre) finalizado → cancelado.
    const pedido = (await documento("pedido")).id;
    await aprovarParaOrcamento(pedido);
    expect(await versao(pedido)).toBe("1");
    await finalizar(pedido);
    expect(await versao(pedido)).toBe("2");
    await situacao(pedido, "convertido");
    expect(await versao(pedido), "finalizado → convertido, fora do aberto").toBe("3");
    await situacao(pedido, "finalizado");
    expect(await versao(pedido), "convertido → finalizado (a reabertura), fora do aberto").toBe("4");
    await situacao(pedido, "cancelado");
    expect([await situacaoDe(pedido), await versao(pedido)], "finalizado → cancelado, fora do aberto").toEqual(["cancelado", "5"]);
  });

  it("VA6 RECEBER O PEDIDO: a compra gerada nasce 0 e só TRAVA o pedido (a versão dele fica parada); virar convertido e reabrir são UPDATEs e somam", async () => {
    const pedido = await documento("pedido", [{ qtd: "10" }]);
    expect(await versao(pedido.id)).toBe("0");
    const compra = await documento("compra", [{ qtd: "4", origem: pedido.itens[0]! }], { origem_documento_id: pedido.id });
    expect(await versao(compra.id)).toBe("0");
    expect(await versao(pedido.id), "a compra que não zera o saldo só trava o pedido (FOR SHARE), e trava não dispara gatilho").toBe("0");
    expect((await db.query<{ n: number }>("select count(*)::int n from erp.documentos_compra where origem_documento_id=$1 and situacao <> 'cancelado'", [pedido.id])).rows[0]!.n,
      "premissa: agora existe compra viva do pedido").toBe(1);
    await situacao(pedido.id, "convertido");
    expect(await versao(pedido.id)).toBe("1");
    await situacao(compra.id, "cancelado");
    expect(await versao(compra.id)).toBe("1");
    await situacao(pedido.id, "aberto");
    expect([await situacaoDe(pedido.id), await versao(pedido.id)], "convertido → aberto (reabre sem finalização), fora do aberto").toEqual(["aberto", "2"]);
  });

  it("VA7 a ORDEM, observada: um BEFORE que ordena antes de todas as guardas vê o NEW do comando; um que ordena depois da versão vê old+1", async () => {
    const { id } = await documento("pedido");
    await upd(id, "observacao='um'");                                  // versão 1
    const espiar = async (nome: string) => {
      const c = await db.connect();
      try {
        await c.query("begin");
        await c.query(`create function erp.e02_espia_b1() returns trigger language plpgsql as $f$
          begin raise exception 'ESPIA old=% new=%', old.version, new.version; end $f$`);
        await c.query(`create trigger ${nome} before update on erp.documentos_compra for each row execute function erp.e02_espia_b1()`);
        await c.query("update erp.documentos_compra set version=777 where id=$1", [id]);
      } catch (e) { return (e as Error).message; } finally { await c.query("rollback").catch(() => {}); c.release(); }
      throw new Error("a espia não disparou");
    };
    // 'trg_documentos_compra_a_espia' < 'trg_documentos_compra_aprovacao' < … < 'trg_documentos_compra_versao' < 'trg_documentos_compra_zz_espia' (collation "C").
    expect(await espiar("trg_documentos_compra_a_espia")).toBe("ESPIA old=1 new=777");
    expect(await espiar("trg_documentos_compra_zz_espia")).toBe("ESPIA old=1 new=2");
    expect(await versao(id)).toBe("1");
    expect(await beforeUpdate()).toEqual([...GUARDAS, "trg_documentos_compra_versao"]);
  });

  it("VA8 o papel da aplicação não desliga, não derruba, não troca nem contorna o gatilho", async () => {
    const recusa = async (sql: string) => {
      const r = await erroDe(naApp((tx) => tx.query(sql)));
      return [sql, r.code, r.message];
    };
    expect(await recusa("alter table erp.documentos_compra disable trigger trg_documentos_compra_versao"))
      .toEqual([expect.any(String), "42501", "must be owner of table documentos_compra"]);
    expect(await recusa("alter table erp.documentos_compra disable trigger all"))
      .toEqual([expect.any(String), "42501", "must be owner of table documentos_compra"]);
    expect(await recusa("drop trigger trg_documentos_compra_versao on erp.documentos_compra"))
      .toEqual([expect.any(String), "42501", "must be owner of relation documentos_compra"]);
    expect(await recusa("set local session_replication_role = replica"))
      .toEqual([expect.any(String), "42501", "permission denied to set parameter \"session_replication_role\""]);
    expect(await recusa("set session_replication_role = replica"))
      .toEqual([expect.any(String), "42501", "permission denied to set parameter \"session_replication_role\""]);
    expect(await recusa("create trigger trg_documentos_compra_zz before update on erp.documentos_compra for each row execute function erp.documentos_compra_versao()"))
      .toEqual([expect.any(String), "42501", "permission denied for table documentos_compra"]);
    expect(await recusa("create or replace function erp.documentos_compra_versao() returns trigger language plpgsql as 'begin return new; end'"))
      .toEqual([expect.any(String), "42501", "permission denied for schema erp"]);
    // E o gatilho continua lá, ligado, somando.
    const { id } = await documento("compra");
    await upd(id, "version=0, observacao='depois das recusas'");
    expect(await versao(id)).toBe("1");
    expect((await db.query("select tgenabled from pg_trigger where tgrelid='erp.documentos_compra'::regclass and tgname='trg_documentos_compra_versao'")).rows)
      .toEqual([{ tgenabled: "O" }]);
  });
});
