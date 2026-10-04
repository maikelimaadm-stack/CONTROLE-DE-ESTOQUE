import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, withTx, type Db, type Queryable, type Tx, type TenantContext } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * A 0040 (ESTOQUE-01, decisão 274), PROVADA CONTRA O BANCO — COMO O RUNNER APLICA.
 *
 * O que ela promete:
 *   · erp.documentos_estoque (entrada, saída, transferência e ajuste) e erp.documentos_estoque_itens, com as colunas
 *     e os tipos do contrato; CHECKs por ESPÉCIE no item (a espécie copiada do cabeçalho pela FK de três colunas);
 *   · gatilho de família (TOP estoque.<espécie>), armazém e destino da empresa do documento, TOP/versão/espécie/empresa
 *     imutáveis, transições (aberto→confirmado, aberto→cancelado, confirmado→cancelado; nada volta), item só com o
 *     documento aberto (FOR SHARE no cabeçalho);
 *   · RLS de empresa no cabeçalho (módulo estoque) e api_child no item; sem DELETE para o papel da aplicação;
 *     erp.audit_row no cabeçalho.
 *
 * Antes de aplicar, as recusas dela: a trava (2026,74) ocupada, o lock_timeout de 2s e CADA pré-condição quebrada
 * numa transação desfeita, cada uma com a SUA mensagem "ESTOQUE-01: …". Depois, a reaplicação.
 *
 * Duas conexões: `db` (superusuário: monta o cenário e lê o catálogo) e `app` (papel da aplicação, SEM bypass de
 * RLS, com as GUCs da transação — o caminho que a API percorre).
 */
let db: Db; let app: Db; let demo: DemoOrg;
let A: string; let B: string;
let armazemA: string; let armazemA2: string; let armazemB: string; let armazemExcluido: string;
let produto: string; let produtoSemControle: string; let produtoExcluido: string;
let outraOrg: string; let empresaOutraOrg: string; let armazemOutraOrg: string; let produtoOutraOrg: string; let topOutraOrg: Top;
let usuarioEscopoA: string;

type Especie = "entrada" | "saida" | "transferencia" | "ajuste";
const ESPECIES: Especie[] = ["entrada", "saida", "transferencia", "ajuste"];
interface Top { top: string; versao: string }
const tops: Record<string, Top> = {};

const ALVO = "0040_documento_de_estoque.sql";

let seq = 0;
const id1 = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0]!.id;

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
/** Roda a 0040 numa transação DESFEITA no fim (depois de `antes`), e devolve o erro — ou falha, se ela aplicou. */
async function recusaDa0040(antes?: (c: Tx) => Promise<unknown>): Promise<string> {
  const m = listMigrations().find((x) => x.name === ALVO)!;
  const c = await db.connect();
  try {
    await c.query("begin");
    if (antes) await antes(c);
    await c.query(m.sql);
  } catch (e) { return (e as Error).message; } finally { await c.query("rollback").catch(() => {}); c.release(); }
  throw new Error("esperava a 0040 recusar, e ela aplicou");
}
async function erroDe(p: Promise<unknown>): Promise<{ code?: string; constraint?: string; message: string }> {
  try { await p; } catch (e) { return e as { code?: string; constraint?: string; message: string }; }
  throw new Error("esperava recusa, e o banco aceitou");
}
const noLedger = async () => (await db.query("select 1 from public.erp_migrations where name=$1", [ALVO])).rowCount === 1;
const tabelasExistem = async () => (await db.query<{ a: string | null; b: string | null }>(
  "select to_regclass('erp.documentos_estoque')::text a, to_regclass('erp.documentos_estoque_itens')::text b")).rows[0]!;

async function criarTop(org: string, codigoBase: string): Promise<Top> {
  seq += 1;
  // TOP e versão na MESMA transação: a FK da versão atual é adiada até o commit.
  return withTx(db, { orgId: org, userId: null }, async (tx) => {
    const top = (await tx.query<{ id: string }>("insert into erp.tipos_operacao (organization_id, codigo, codigo_base) values ($1,$2,$3) returning id",
      [org, `ES${seq}`, codigoBase])).rows[0]!.id;
    const versao = (await tx.query<{ id: string }>("insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome) values ($1,$2,1,$3) returning id",
      [org, top, `TOP estoque ${codigoBase} ${seq}`])).rows[0]!.id;
    return { top, versao };
  });
}
async function armazem(org: string, empresa: string, excluido = false): Promise<string> {
  seq += 1;
  return id1("insert into erp.warehouses (organization_id, empresa_id, initials, description, deleted_at) values ($1,$2,$3,$4,$5) returning id",
    [org, empresa, `E${seq}`, `[TEST] Armazem estoque ${seq}`, excluido ? new Date() : null]);
}
async function produtoNovo(org: string, o: { controla: boolean; excluido?: boolean }): Promise<string> {
  seq += 1;
  return id1(`insert into erp.products (organization_id, code, description, measurement_id, group_id, category_id, kind_id, financial_category_id, control_stock, deleted_at)
              select $1, $2, $3, measurement_id, group_id, category_id, kind_id, financial_category_id, $4, $5 from erp.products where id=$6 returning id`,
    [org, `ES-P${seq}`, `[TEST] Produto estoque ${seq}`, o.controla, o.excluido ? new Date() : null, produto]);
}

type Cab = Partial<{ org: string; empresa: string; especie: Especie; situacao: string; top: Top; armazem: string; destino: string | null;
  confirmadoEm: Date | null; confirmadoPor: string | null; canceladoEm: Date | null; canceladoPor: string | null; motivo: string | null }>;

/** INSERT do cabeçalho (via `q`: superusuário ou tx da aplicação). Na transferência o destino padrão é o 2º armazém de A. */
async function inserirCab(q: Queryable, o: Cab = {}): Promise<string> {
  seq += 1;
  const especie = o.especie ?? "entrada";
  const r = await q.query<{ id: string }>(
    `insert into erp.documentos_estoque (organization_id, empresa_id, especie, codigo, situacao, tipo_operacao_id, tipo_operacao_versao_id,
       armazem_id, armazem_destino_id, data_documento, confirmado_em, confirmado_por, cancelado_em, cancelado_por, motivo_cancelamento)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'2026-10-01',$10,$11,$12,$13,$14) returning id`,
    [o.org ?? demo.orgId, o.empresa ?? A, especie, `E${seq}`, o.situacao ?? "aberto", (o.top ?? tops[especie]!).top, (o.top ?? tops[especie]!).versao,
     o.armazem ?? armazemA, o.destino !== undefined ? o.destino : (especie === "transferencia" ? armazemA2 : null),
     o.confirmadoEm ?? null, o.confirmadoPor ?? null, o.canceladoEm ?? null, o.canceladoPor ?? null, o.motivo ?? null]);
  return r.rows[0]!.id;
}
const doc = (o: Cab = {}) => inserirCab(db, o);

type Item = Partial<{ org: string; especie: Especie; produto: string; posicao: number; quantidade: string | null; contada: string | null;
  custo: string | null; saldo: string | null; diferenca: string | null; lote: string | null; validade: string | null }>;

/** INSERT do item, com os padrões da espécie (quantidade fora do ajuste, contada no ajuste, custo na entrada). */
async function inserirItem(q: Queryable, documento: string, o: Item = {}): Promise<string> {
  seq += 1;
  const especie = o.especie ?? "entrada";
  const r = await q.query<{ id: string }>(
    `insert into erp.documentos_estoque_itens (organization_id, documento_id, especie, posicao, produto_id, quantidade, quantidade_contada, custo_unitario,
       saldo_na_confirmacao, diferenca, lote, validade)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [o.org ?? demo.orgId, documento, especie, o.posicao ?? seq, o.produto ?? produto,
     o.quantidade !== undefined ? o.quantidade : (especie === "ajuste" ? null : "2"),
     o.contada !== undefined ? o.contada : (especie === "ajuste" ? "5" : null),
     o.custo !== undefined ? o.custo : (especie === "entrada" ? "10" : null),
     o.saldo ?? null, o.diferenca ?? null, o.lote ?? null, o.validade ?? null]);
  return r.rows[0]!.id;
}
const item = (documento: string, o: Item = {}) => inserirItem(db, documento, o);

/** Muda a situação como a API muda: com os carimbos que o CHECK exige junto. */
function situacao(id: string, s: "aberto" | "confirmado" | "cancelado") {
  if (s === "confirmado") return db.query("update erp.documentos_estoque set situacao='confirmado', confirmado_em=now(), confirmado_por=$2 where id=$1", [id, demo.adminUserId]);
  if (s === "cancelado") return db.query("update erp.documentos_estoque set situacao='cancelado', cancelado_em=now(), cancelado_por=$2, motivo_cancelamento='teste' where id=$1", [id, demo.adminUserId]);
  return db.query("update erp.documentos_estoque set situacao='aberto', confirmado_em=null, confirmado_por=null, cancelado_em=null, cancelado_por=null, motivo_cancelamento=null where id=$1", [id]);
}

/**
 * Cenário com os gatilhos DO USUÁRIO desligados, numa transação desfeita no fim: prova o CHECK e a FK sozinhos.
 * `disable trigger user` não desliga os gatilhos internos de integridade referencial (a FK continua valendo).
 */
async function semGatilhos<T>(fn: (q: Tx) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query("alter table erp.documentos_estoque disable trigger user");
    await c.query("alter table erp.documentos_estoque_itens disable trigger user");
    return await fn(c);
  } finally { await c.query("rollback").catch(() => {}); c.release(); }
}

const ctxEstoque = (userId?: string, modulo = "estoque"): TenantContext => ({ orgId: demo.orgId, userId: userId ?? demo.adminUserId, modulo });

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 6 });
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of listMigrations().filter((x) => x.name < "0040")) {
    await db.query(m.sql);
    await db.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
  }
  await seedReference(db, () => {});
  demo = await seedDemo(db, {}, () => {});
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@"), { max: 3 });

  const empresas = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code", [demo.orgId])).rows;
  A = empresas[0]!.id; B = empresas[1]!.id;
  armazemA = await armazem(demo.orgId, A);
  armazemA2 = await armazem(demo.orgId, A);
  armazemB = await armazem(demo.orgId, B);
  armazemExcluido = await armazem(demo.orgId, A, true);
  produto = await id1("select id from erp.products where organization_id=$1 and controle_lote='nenhum' and control_stock and deleted_at is null order by code limit 1", [demo.orgId]);
  produtoSemControle = await produtoNovo(demo.orgId, { controla: false });
  produtoExcluido = await produtoNovo(demo.orgId, { controla: true, excluido: true });
  for (const f of ["estoque.entrada", "estoque.saida", "estoque.transferencia", "estoque.ajuste", "compras.compra", "vendas.venda", "estoque.baixa"]) {
    tops[f.startsWith("estoque.") && ESPECIES.includes(f.slice(8) as Especie) ? f.slice(8) : f] = await criarTop(demo.orgId, f);
  }

  outraOrg = await id1("insert into erp.organizations (name, slug) values ('[TEST] Outra estoque','outra-estoque') returning id");
  empresaOutraOrg = await id1("insert into erp.empresas (organization_id, code, name) values ($1, 92, '[TEST] Empresa outra org estoque') returning id", [outraOrg]);
  armazemOutraOrg = await armazem(outraOrg, empresaOutraOrg);
  produtoOutraOrg = await produtoNovo(outraOrg, { controla: true });
  topOutraOrg = await criarTop(outraOrg, "estoque.entrada");

  // Membro com escopo SELECIONADAS = [A] no módulo estoque (e nada nos outros módulos: fail-closed).
  usuarioEscopoA = await id1("insert into erp.users (email, name, password_hash) values ('estoque-a@demo.local','Estoque A','x') returning id");
  const membro = await id1("insert into erp.organization_members (organization_id, user_id, is_owner, is_active) values ($1,$2,false,true) returning id", [demo.orgId, usuarioEscopoA]);
  await db.query("insert into erp.membro_escopos_empresa (organization_id, membro_id, modulo, modo) values ($1,$2,'estoque','selecionadas')", [demo.orgId, membro]);
  await db.query("insert into erp.membro_empresas (organization_id, membro_id, modulo, modo, empresa_id) values ($1,$2,'estoque','selecionadas',$3)", [demo.orgId, membro, A]);
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

describe("0040 — sobre o banco até a 0039, como o runner aplica", () => {
  it("EB1 PREMISSA: sob a 0039 as tabelas não existem; o ledger tem 39 e a 0040 não está nele; o cenário tem duas empresas e as TOPs", async () => {
    expect(await noLedger()).toBe(false);
    expect((await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0])
      .toEqual({ n: 39, ultima: "0039_versao_do_documento_de_venda.sql" });
    expect(await tabelasExistem()).toEqual({ a: null, b: null });
    expect(A).not.toBe(B);
    const w = (await db.query<{ id: string; empresa_id: string; excl: boolean }>(
      "select id, empresa_id, deleted_at is not null excl from erp.warehouses where id = any($1)", [[armazemA, armazemA2, armazemB, armazemExcluido]])).rows;
    const por = new Map(w.map((x) => [x.id, x]));
    expect([por.get(armazemA)?.empresa_id, por.get(armazemA2)?.empresa_id, por.get(armazemB)?.empresa_id, por.get(armazemExcluido)?.excl]).toEqual([A, A, B, true]);
    const p = (await db.query<{ id: string; control_stock: boolean; excl: boolean }>(
      "select id, control_stock, deleted_at is not null excl from erp.products where id = any($1)", [[produto, produtoSemControle, produtoExcluido]])).rows;
    const pp = new Map(p.map((x) => [x.id, x]));
    expect([pp.get(produto), pp.get(produtoSemControle), pp.get(produtoExcluido)].map((x) => [x?.control_stock, x?.excl]))
      .toEqual([[true, false], [false, false], [true, true]]);
    const t = (await db.query<{ codigo_base: string }>("select codigo_base from erp.tipos_operacao where id = any($1) order by codigo_base",
      [ESPECIES.map((e) => tops[e]!.top)])).rows.map((x) => x.codigo_base);
    expect(t).toEqual(["estoque.ajuste", "estoque.entrada", "estoque.saida", "estoque.transferencia"]);
  });

  it("EB2 trava (2026,74) em uso por outra sessão: a 0040 recusa antes de tudo, sem efeito", async () => {
    const outra = await db.connect();
    try {
      await outra.query("select pg_advisory_lock(2026, 74)");
      await expect(aplicar()).rejects.toThrow("ESTOQUE-01: outra transacao ja detem a trava desta migration (2026,74). Nada foi aplicado.");
    } finally { await outra.query("select pg_advisory_unlock(2026, 74)"); outra.release(); }
    expect(await noLedger()).toBe(false);
    expect(await tabelasExistem()).toEqual({ a: null, b: null });
  });

  it("EB3 lock_timeout 2s: uma escrita aberta em erp.warehouses (alvo das FKs) faz a 0040 desistir em ~2s, sem efeito", async () => {
    const escritor = await db.connect();
    try {
      await escritor.query("begin");
      // RowExclusive em armazéns: a FK nova precisa de ShareRowExclusive no alvo, e as duas não convivem.
      await escritor.query("update erp.warehouses set description = description where id is null");
      const t0 = Date.now();
      await expect(aplicar()).rejects.toThrow(/lock timeout/);
      const ms = Date.now() - t0;
      expect(ms, "desistiu pelo lock_timeout, não por outro motivo imediato").toBeGreaterThanOrEqual(1900);
      expect(ms, "e não ficou pendurada").toBeLessThan(10_000);
    } finally { await escritor.query("rollback"); escritor.release(); }
    expect(await noLedger()).toBe(false);
    expect(await tabelasExistem()).toEqual({ a: null, b: null });
  });

  it("EB4 reversas: cada pré-condição quebrada recusa a 0040 com a SUA mensagem, sem efeito", async () => {
    // "Já aplicada" (tabela), mesmo com as funções ausentes.
    expect(await recusaDa0040((c) => c.query("create table erp.documentos_estoque_itens (id uuid)")))
      .toBe("ESTOQUE-01: erp.documentos_estoque/erp.documentos_estoque_itens ja existe; a 0040 ja foi aplicada ou ha schema divergente.");
    // "Já aplicada" (função de gatilho sobrando).
    expect(await recusaDa0040((c) => c.query("create function erp.documentos_estoque_transicao() returns trigger language plpgsql as 'begin return new; end'")))
      .toBe("ESTOQUE-01: funcoes do documento de estoque ja existem; a 0040 ja foi aplicada ou ha schema divergente.");
    // Quem aplica não atravessa RLS (o papel da aplicação).
    expect(await recusaDa0040((c) => c.query("set local role erp_app")))
      .toBe("ESTOQUE-01: o papel que aplica a migration (dono das funcoes SECURITY DEFINER) nao atravessa RLS; as conferencias dos gatilhos nao veriam o cadastro da organizacao.");
    // Sem o papel da aplicação, os grants não teriam destinatário.
    expect(await recusaDa0040((c) => c.query("alter role erp_app rename to erp_app_e01")))
      .toBe("ESTOQUE-01: papel erp_app ausente (0007); os privilegios das tabelas novas nao teriam destinatario.");
    // A chave de armazéns da 0036: ausente, ou com as colunas em outra ordem.
    const ARMAZEM = "ESTOQUE-01: chave uq_warehouses_tenant (id, organization_id) de erp.warehouses ausente; a 0036 nao esta aplicada ou ha schema divergente.";
    expect(await recusaDa0040((c) => c.query("alter table erp.warehouses rename constraint uq_warehouses_tenant to uq_warehouses_e01"))).toBe(ARMAZEM);
    expect(await recusaDa0040(async (c) => {
      await c.query("alter table erp.warehouses drop constraint uq_warehouses_tenant cascade");
      await c.query("alter table erp.warehouses add constraint uq_warehouses_tenant unique (organization_id, id)");
    })).toBe(ARMAZEM);
    // A chave de produtos da 0029.
    expect(await recusaDa0040((c) => c.query("alter table erp.products rename constraint uq_products_tenant to uq_products_e01")))
      .toBe("ESTOQUE-01: chave uq_products_tenant (id, organization_id) de erp.products ausente (0029).");
    // As chaves da TOP e da versão (0020/0021), uma de cada vez.
    const TOP = "ESTOQUE-01: chave candidata da TOP ou da versao ausente (0020/0021).";
    expect(await recusaDa0040((c) => c.query("alter table erp.tipos_operacao rename constraint uq_tipos_operacao_tenant to uq_tipos_operacao_e01"))).toBe(TOP);
    expect(await recusaDa0040((c) => c.query("alter table erp.tipos_operacao_versoes rename constraint uq_tipos_operacao_versoes_tenant to uq_tipos_operacao_versoes_e01"))).toBe(TOP);
    // A chave (organization_id, id) de empresas: toda chave com essas duas colunas some.
    expect(await recusaDa0040(async (c) => {
      const nomes = (await c.query<{ conname: string }>(
        `select c.conname from pg_constraint c where c.conrelid='erp.empresas'::regclass and c.contype in ('u','p')
            and (select array_agg(a.attname::text order by a.attname) from pg_attribute a where a.attrelid=c.conrelid and a.attnum = any (c.conkey)) = array['id','organization_id']`)).rows;
      expect(nomes.length, "a chave existe antes da sabotagem").toBeGreaterThan(0);
      for (const n of nomes) await c.query(`alter table erp.empresas drop constraint "${n.conname}" cascade`);
    })).toBe("ESTOQUE-01: chave (organization_id, id) de erp.empresas ausente; a FK composta da empresa nao teria alvo.");
    // Cada coluna lida pelos gatilhos.
    for (const [tabela, coluna] of [["warehouses", "empresa_id"], ["warehouses", "deleted_at"], ["products", "control_stock"], ["products", "deleted_at"], ["tipos_operacao", "codigo_base"]]) {
      expect([tabela, coluna, await recusaDa0040((c) => c.query(`alter table erp.${tabela} rename column ${coluna} to ${coluna}_e01`))]).toEqual([tabela, coluna,
        "ESTOQUE-01: coluna lida pelos gatilhos ausente (warehouses.empresa_id/deleted_at, products.control_stock/deleted_at, tipos_operacao.codigo_base); a cadeia de migrations esta fora de ordem."]);
    }
    // Cada função de auditoria/RLS.
    for (const fn of ["audit_row()", "tenant_visible(uuid)", "escopo_empresa_total(text)", "empresas_do_membro(text)", "modulo_empresa_atual()"]) {
      expect([fn, await recusaDa0040((c) => c.query(`alter function erp.${fn} rename to e01_renomeada`))])
        .toEqual([fn, "ESTOQUE-01: funcoes de auditoria/RLS (0001/0007/0015) ausentes."]);
    }
    // O módulo de escopo estoque (as FKs de quem o cita são desligadas só nesta transação desfeita).
    expect(await recusaDa0040(async (c) => {
      await c.query("set local session_replication_role = replica");
      await c.query("delete from erp.modulos_escopo_empresa where chave='estoque'");
      await c.query("set local session_replication_role = origin");
    })).toBe("ESTOQUE-01: modulo de escopo empresarial estoque ausente (0011).");
    // Nada ficou: o ledger, as tabelas, as chaves e o papel são os de antes.
    expect(await noLedger()).toBe(false);
    expect(await tabelasExistem()).toEqual({ a: null, b: null });
    expect((await db.query("select 1 from pg_roles where rolname='erp_app'")).rowCount).toBe(1);
    expect((await db.query("select 1 from pg_constraint where conname in ('uq_warehouses_tenant','uq_products_tenant','uq_tipos_operacao_tenant','uq_tipos_operacao_versoes_tenant')")).rowCount).toBe(4);
  });

  it("EB5 aplica: ledger com 40 (a 0040 por último), tabelas, funções e trava liberada", async () => {
    await aplicar();
    const ledger = (await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0]!;
    expect(ledger).toEqual({ n: 40, ultima: ALVO });
    const noDisco = listMigrations().map((m) => m.name);
    expect(noDisco.length, "53 migrations no repositório (0001..0053; a 0041 TOP-CONFIG-08, OPERACOES-01 0042–0048, MAPA-01 0049, CADASTRO-AREAS-01 0050, CADASTRO-AREAS-02 0051, SAT-01 0052 e SAT-02 0053 vêm depois)").toBe(53);
    expect(noDisco[39]).toBe(ALVO);
    expect(await tabelasExistem()).toEqual({ a: "erp.documentos_estoque", b: "erp.documentos_estoque_itens" });
    // A trava é de transação: depois do commit, outra sessão a obtém.
    const outra = await db.connect();
    try { expect((await outra.query<{ ok: boolean }>("select pg_try_advisory_xact_lock(2026, 74) ok")).rows[0]!.ok).toBe(true); } finally { outra.release(); }
  });

  it("EB6 reaplicar é recusado pela pré-condição 'já aplicada', sem efeito", async () => {
    expect(await recusaDa0040()).toBe("ESTOQUE-01: erp.documentos_estoque/erp.documentos_estoque_itens ja existe; a 0040 ja foi aplicada ou ha schema divergente.");
    expect((await db.query<{ n: number }>("select count(*)::int n from public.erp_migrations where name=$1", [ALVO])).rows[0]!.n).toBe(1);
  });
});

describe("schema: colunas, tipos, chaves, RLS, gatilhos e privilégios", () => {
  const colunas = async (tabela: string) => (await db.query<{ c: string }>(
    `select column_name || ':' || case when data_type = 'numeric' then 'numeric(' || numeric_precision || ',' || numeric_scale || ')' else data_type end
            || ':' || is_nullable c
       from information_schema.columns where table_schema='erp' and table_name=$1 order by ordinal_position`, [tabela])).rows.map((x) => x.c);

  it("S1 cabeçalho: colunas e tipos do contrato, na ordem", async () => {
    expect(await colunas("documentos_estoque")).toEqual([
      "id:uuid:NO", "organization_id:uuid:NO", "empresa_id:uuid:NO", "especie:text:NO", "codigo:text:NO", "situacao:text:NO",
      "tipo_operacao_id:uuid:NO", "tipo_operacao_versao_id:uuid:NO", "armazem_id:uuid:NO", "armazem_destino_id:uuid:YES",
      "data_documento:date:NO", "observacao:text:YES", "criado_por:uuid:YES", "confirmado_em:timestamp with time zone:YES",
      "confirmado_por:uuid:YES", "cancelado_em:timestamp with time zone:YES", "cancelado_por:uuid:YES", "motivo_cancelamento:text:YES",
      "created_at:timestamp with time zone:NO", "atualizado_em:timestamp with time zone:NO"
    ]);
    const def = (await db.query<{ column_name: string; column_default: string }>(
      "select column_name, column_default from information_schema.columns where table_schema='erp' and table_name='documentos_estoque' and column_default is not null order by column_name")).rows;
    expect(def).toEqual([
      { column_name: "atualizado_em", column_default: "now()" }, { column_name: "created_at", column_default: "now()" },
      { column_name: "id", column_default: "gen_random_uuid()" }, { column_name: "situacao", column_default: "'aberto'::text" }
    ]);
  });

  it("S2 itens: colunas e tipos do contrato (quantidades 18,4; custo 18,6), na ordem", async () => {
    expect(await colunas("documentos_estoque_itens")).toEqual([
      "id:uuid:NO", "organization_id:uuid:NO", "documento_id:uuid:NO", "especie:text:NO", "posicao:integer:NO", "produto_id:uuid:NO",
      "lote:text:YES", "validade:date:YES", "quantidade:numeric(18,4):YES", "quantidade_contada:numeric(18,4):YES",
      "custo_unitario:numeric(18,6):YES", "saldo_na_confirmacao:numeric(18,4):YES", "diferenca:numeric(18,4):YES",
      "observacao:text:YES", "created_at:timestamp with time zone:NO"
    ]);
  });

  it("S3 toda tabela e coluna nova tem comentário (o dicionário de dados é gerado deles)", async () => {
    const sem = (await db.query<{ c: string }>(
      `select c.relname || '.' || coalesce(a.attname, '(tabela)') c
         from pg_class c
         left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        where c.oid in ('erp.documentos_estoque'::regclass, 'erp.documentos_estoque_itens'::regclass)
          and (case when a.attname is null then obj_description(c.oid, 'pg_class') else col_description(c.oid, a.attnum) end) is null`)).rows;
    expect(sem).toEqual([]);
    expect((await db.query<{ n: number }>(
      "select count(*)::int n from pg_attribute where attrelid in ('erp.documentos_estoque'::regclass, 'erp.documentos_estoque_itens'::regclass) and attnum > 0 and not attisdropped")).rows[0]!.n,
      "a conta acima varreu as 35 colunas").toBe(35);
  });

  it("S4 chaves únicas e FKs compostas (sem cascata) com as colunas do contrato", async () => {
    const r = (await db.query<{ conname: string; contype: string; cols: string; alvo: string | null; cascata: boolean }>(
      `select c.conname, c.contype,
              (select string_agg(a.attname, ',' order by k.ord) from unnest(c.conkey) with ordinality k(n, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n) cols,
              case when c.contype = 'f' then c.confrelid::regclass::text || '(' ||
                (select string_agg(a.attname, ',' order by k.ord) from unnest(c.confkey) with ordinality k(n, ord) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n) || ')' end alvo,
              (c.contype = 'f' and (c.confdeltype <> 'a' or c.confupdtype <> 'a')) cascata
         from pg_constraint c
        where c.conrelid in ('erp.documentos_estoque'::regclass, 'erp.documentos_estoque_itens'::regclass) and c.contype in ('u','f')
          and c.conname not like '%organization_id_fkey' and c.conname not like '%_por_fkey'
        order by c.conname`)).rows;
    expect(r).toEqual([
      { conname: "fk_documentos_estoque_armazem", contype: "f", cols: "armazem_id,organization_id", alvo: "erp.warehouses(id,organization_id)", cascata: false },
      { conname: "fk_documentos_estoque_armazem_destino", contype: "f", cols: "armazem_destino_id,organization_id", alvo: "erp.warehouses(id,organization_id)", cascata: false },
      { conname: "fk_documentos_estoque_empresa", contype: "f", cols: "organization_id,empresa_id", alvo: "erp.empresas(organization_id,id)", cascata: false },
      { conname: "fk_documentos_estoque_itens_documento", contype: "f", cols: "documento_id,organization_id,especie", alvo: "erp.documentos_estoque(id,organization_id,especie)", cascata: false },
      { conname: "fk_documentos_estoque_itens_produto", contype: "f", cols: "produto_id,organization_id", alvo: "erp.products(id,organization_id)", cascata: false },
      { conname: "fk_documentos_estoque_tipo_operacao", contype: "f", cols: "tipo_operacao_id,organization_id", alvo: "erp.tipos_operacao(id,organization_id)", cascata: false },
      { conname: "fk_documentos_estoque_tipo_operacao_versao", contype: "f", cols: "tipo_operacao_versao_id,tipo_operacao_id,organization_id", alvo: "erp.tipos_operacao_versoes(id,tipo_operacao_id,organization_id)", cascata: false },
      { conname: "uq_documentos_estoque_codigo", contype: "u", cols: "organization_id,especie,codigo", alvo: null, cascata: false },
      { conname: "uq_documentos_estoque_especie", contype: "u", cols: "id,organization_id,especie", alvo: null, cascata: false },
      { conname: "uq_documentos_estoque_itens_posicao", contype: "u", cols: "documento_id,posicao", alvo: null, cascata: false },
      { conname: "uq_documentos_estoque_tenant", contype: "u", cols: "id,organization_id", alvo: null, cascata: false }
    ]);
    const idx = (await db.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname='erp' and tablename in ('documentos_estoque','documentos_estoque_itens') and indexname like 'ix_%' order by indexname")).rows.map((x) => x.indexdef.replace(/ USING btree/, ""));
    expect(idx).toEqual([
      "CREATE INDEX ix_documentos_estoque_armazem ON erp.documentos_estoque (organization_id, armazem_id)",
      "CREATE INDEX ix_documentos_estoque_armazem_destino ON erp.documentos_estoque (organization_id, armazem_destino_id) WHERE (armazem_destino_id IS NOT NULL)",
      "CREATE INDEX ix_documentos_estoque_empresa ON erp.documentos_estoque (organization_id, empresa_id, data_documento)",
      "CREATE INDEX ix_documentos_estoque_itens_produto ON erp.documentos_estoque_itens (organization_id, produto_id)",
      "CREATE INDEX ix_documentos_estoque_situacao ON erp.documentos_estoque (organization_id, especie, situacao)",
      "CREATE INDEX ix_documentos_estoque_tipo_operacao ON erp.documentos_estoque (organization_id, tipo_operacao_id)"
    ]);
  });

  it("S5 RLS forçada, políticas tenant_e_empresa (cabeçalho) e api_child (itens), gatilhos ligados, definer com search_path fixo e EXECUTE só do dono", async () => {
    const rls = (await db.query<{ relname: string; r: boolean; f: boolean }>(
      "select relname, relrowsecurity r, relforcerowsecurity f from pg_class where oid in ('erp.documentos_estoque'::regclass, 'erp.documentos_estoque_itens'::regclass) order by relname")).rows;
    expect(rls).toEqual([{ relname: "documentos_estoque", r: true, f: true }, { relname: "documentos_estoque_itens", r: true, f: true }]);
    const pol = (await db.query<{ tablename: string; policyname: string; cmd: string; qual: string }>(
      "select tablename, policyname, cmd, qual from pg_policies where schemaname='erp' and tablename like 'documentos_estoque%' order by tablename")).rows;
    expect(pol.map((p) => [p.tablename, p.policyname, p.cmd])).toEqual([["documentos_estoque", "tenant_e_empresa", "ALL"], ["documentos_estoque_itens", "api_child", "ALL"]]);
    expect(pol[0]!.qual, "o cabeçalho recorta pela empresa do módulo").toMatch(/empresas_do_membro\(erp\.modulo_empresa_atual\(\)\)/);
    expect(pol[1]!.qual, "o item passa pela RLS do cabeçalho").toMatch(/documentos_estoque p/);
    const trg = (await db.query<{ def: string }>(
      "select pg_get_triggerdef(oid) def from pg_trigger where tgrelid in ('erp.documentos_estoque'::regclass, 'erp.documentos_estoque_itens'::regclass) and not tgisinternal and tgenabled='O' order by tgname")).rows.map((x) => x.def);
    expect(trg).toEqual([
      "CREATE TRIGGER trg_documentos_estoque_audit AFTER INSERT OR DELETE OR UPDATE ON erp.documentos_estoque FOR EACH ROW EXECUTE FUNCTION erp.audit_row()",
      "CREATE TRIGGER trg_documentos_estoque_conferir BEFORE INSERT OR UPDATE ON erp.documentos_estoque FOR EACH ROW EXECUTE FUNCTION erp.documentos_estoque_conferir()",
      "CREATE TRIGGER trg_documentos_estoque_itens_documento_aberto BEFORE INSERT OR DELETE OR UPDATE ON erp.documentos_estoque_itens FOR EACH ROW EXECUTE FUNCTION erp.documentos_estoque_itens_documento_aberto()",
      "CREATE TRIGGER trg_documentos_estoque_transicao BEFORE UPDATE OF situacao ON erp.documentos_estoque FOR EACH ROW EXECUTE FUNCTION erp.documentos_estoque_transicao()"
    ]);
    const fns = (await db.query<{ fn: string; definer: boolean; cfg: string[]; app: boolean; publico: boolean }>(
      `select p.proname fn, p.prosecdef definer, p.proconfig cfg, has_function_privilege('erp_app', p.oid, 'execute') app,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0) publico
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='erp' and p.proname like 'documentos\\_estoque%' order by 1`)).rows;
    expect(fns).toEqual([
      { fn: "documentos_estoque_conferir", definer: true, cfg: ["search_path=erp, pg_temp"], app: false, publico: false },
      { fn: "documentos_estoque_itens_documento_aberto", definer: true, cfg: ["search_path=erp, pg_temp"], app: false, publico: false },
      { fn: "documentos_estoque_transicao", definer: false, cfg: ["search_path=erp, pg_temp"], app: false, publico: false }
    ]);
    const dono = (await db.query<{ ok: boolean }>(
      `select bool_and(r.rolsuper or r.rolbypassrls) ok from pg_proc p join pg_roles r on r.oid = p.proowner
        where p.oid in ('erp.documentos_estoque_conferir()'::regprocedure, 'erp.documentos_estoque_itens_documento_aberto()'::regprocedure)`)).rows[0]!.ok;
    expect(dono, "o dono das definer atravessa a RLS (enxerga o cadastro da organização)").toBe(true);
  });

  it("S6 privilégios do papel da aplicação: select/insert/update, sem delete nem truncate, nas duas tabelas", async () => {
    const priv = (await db.query<{ s: boolean; i: boolean; u: boolean; d: boolean; t: boolean }>(
      `select bool_and(has_table_privilege('erp_app', t, 'select')) s, bool_and(has_table_privilege('erp_app', t, 'insert')) i,
              bool_and(has_table_privilege('erp_app', t, 'update')) u, bool_or(has_table_privilege('erp_app', t, 'delete')) d,
              bool_or(has_table_privilege('erp_app', t, 'truncate')) t
         from unnest(array['erp.documentos_estoque','erp.documentos_estoque_itens']) t`)).rows[0];
    expect(priv).toEqual({ s: true, i: true, u: true, d: false, t: false });
  });
});

describe("CHECKs do cabeçalho (gatilhos desligados: o CHECK sozinho)", () => {
  const check = async (o: Cab) => (await erroDe(semGatilhos((q) => inserirCab(q, o)))).constraint;
  it("contraprova: as quatro espécies válidas passam com os gatilhos LIGADOS", async () => {
    for (const especie of ESPECIES) await expect(doc({ especie })).resolves.toBeTruthy();
  });
  it("espécie e situação fora do domínio", async () => {
    expect(await check({ especie: "inventario" as Especie, top: tops.ajuste })).toBe("chk_documentos_estoque_especie");
    // 'rascunho' fere também o par situação × carimbo; o domínio da coluna é lido do catálogo.
    expect(["chk_documentos_estoque_situacao", "chk_documentos_estoque_confirmacao_situacao"]).toContain(await check({ situacao: "rascunho" }));
    const def = (await db.query<{ def: string }>(
      "select pg_get_constraintdef(oid) def from pg_constraint where conrelid='erp.documentos_estoque'::regclass and conname='chk_documentos_estoque_situacao'")).rows[0]!.def;
    expect([...def.matchAll(/'([^']*)'/g)].map((m) => m[1])).toEqual(["aberto", "confirmado", "cancelado"]);
    const esp = (await db.query<{ def: string }>(
      "select pg_get_constraintdef(oid) def from pg_constraint where conrelid='erp.documentos_estoque_itens'::regclass and conname='chk_documentos_estoque_itens_especie'")).rows[0]!.def;
    expect([...esp.matchAll(/'([^']*)'/g)].map((m) => m[1]), "o item aceita as mesmas quatro espécies").toEqual(ESPECIES);
  });
  it("destino só na transferência, e diferente da origem", async () => {
    expect(await check({ especie: "entrada", destino: armazemA2 })).toBe("chk_documentos_estoque_destino");
    expect(await check({ especie: "saida", destino: armazemA2 })).toBe("chk_documentos_estoque_destino");
    expect(await check({ especie: "ajuste", destino: armazemA2 })).toBe("chk_documentos_estoque_destino");
    expect(await check({ especie: "transferencia", destino: null })).toBe("chk_documentos_estoque_destino");
    expect(await check({ especie: "transferencia", armazem: armazemA, destino: armazemA })).toBe("chk_documentos_estoque_destino_distinto");
  });
  it("carimbos de confirmação e de cancelamento em par com a situação", async () => {
    const agora = new Date();
    expect(await check({ confirmadoEm: agora })).toBe("chk_documentos_estoque_confirmacao");
    expect(await check({ situacao: "confirmado" })).toBe("chk_documentos_estoque_confirmacao_situacao");
    expect(await check({ confirmadoEm: agora, confirmadoPor: demo.adminUserId })).toBe("chk_documentos_estoque_confirmacao_situacao");
    expect(await check({ situacao: "cancelado" })).toBe("chk_documentos_estoque_cancelamento");
    expect(await check({ canceladoEm: agora })).toBe("chk_documentos_estoque_cancelamento");
    expect(await check({ motivo: "x" })).toBe("chk_documentos_estoque_cancelamento_campos");
    expect(await check({ canceladoPor: demo.adminUserId })).toBe("chk_documentos_estoque_cancelamento_campos");
    // contraprova: confirmado com o par e cancelado com o carimbo passam no CHECK
    await expect(semGatilhos((q) => inserirCab(q, { situacao: "confirmado", confirmadoEm: agora, confirmadoPor: demo.adminUserId }))).resolves.toBeTruthy();
    await expect(semGatilhos((q) => inserirCab(q, { situacao: "cancelado", canceladoEm: agora, canceladoPor: demo.adminUserId, motivo: "x" }))).resolves.toBeTruthy();
  });
  it("código único por (organização, espécie): o mesmo código em outra espécie passa", async () => {
    const ins = (especie: Especie) => db.query(
      `insert into erp.documentos_estoque (organization_id, empresa_id, especie, codigo, tipo_operacao_id, tipo_operacao_versao_id, armazem_id, armazem_destino_id, data_documento)
       values ($1,$2,$3,'E-UNICO',$4,$5,$6,$7,'2026-10-01')`, [demo.orgId, A, especie, tops[especie]!.top, tops[especie]!.versao, armazemA, especie === "transferencia" ? armazemA2 : null]);
    await ins("entrada");
    expect((await erroDe(ins("entrada"))).constraint).toBe("uq_documentos_estoque_codigo");
    await expect(ins("saida")).resolves.toMatchObject({ rowCount: 1 });
  });
});

describe("CHECKs do item por espécie (com os gatilhos ligados: documento aberto, produto válido)", () => {
  const docs: Partial<Record<Especie, string>> = {};
  beforeAll(async () => { for (const e of ESPECIES) docs[e] = await doc({ especie: e }); });
  const chk = async (especie: Especie, o: Item) => (await erroDe(item(docs[especie]!, { especie, ...o }))).constraint;

  it("contraprova: o item válido de cada espécie passa, e os números voltam exatos (sem float)", async () => {
    for (const e of ESPECIES) await expect(item(docs[e]!, { especie: e })).resolves.toBeTruthy();
    const i = await item(docs.entrada!, { especie: "entrada", quantidade: "12345678901234.5678", custo: "123456789012.123456" });
    expect((await db.query("select quantidade::text q, custo_unitario::text c from erp.documentos_estoque_itens where id=$1", [i])).rows[0])
      .toEqual({ q: "12345678901234.5678", c: "123456789012.123456" });
    expect((await erroDe(item(docs.entrada!, { especie: "entrada", quantidade: "123456789012345" }))).code, "15 dígitos inteiros estouram numeric(18,4)").toBe("22003");
  });
  it("ajuste com quantidade, ajuste sem contada, e contada fora do ajuste → recusa", async () => {
    expect(await chk("ajuste", { quantidade: "1" })).toBe("chk_documentos_estoque_itens_quantidades");
    expect(await chk("ajuste", { contada: null })).toBe("chk_documentos_estoque_itens_quantidades");
    for (const e of ["entrada", "saida", "transferencia"] as Especie[]) {
      expect([e, await chk(e, { contada: "1" })]).toEqual([e, "chk_documentos_estoque_itens_quantidades"]);
      expect([e, await chk(e, { quantidade: null })]).toEqual([e, "chk_documentos_estoque_itens_quantidades"]);
    }
    // a contagem zero é válida (inventário que encontrou o balde vazio)
    await expect(item(docs.ajuste!, { especie: "ajuste", contada: "0" })).resolves.toBeTruthy();
  });
  it("entrada sem custo → recusa; nas outras espécies o custo nasce vazio (a confirmação grava)", async () => {
    expect(await chk("entrada", { custo: null })).toBe("chk_documentos_estoque_itens_custo_entrada");
    for (const e of ["saida", "transferencia", "ajuste"] as Especie[]) await expect(item(docs[e]!, { especie: e, custo: null })).resolves.toBeTruthy();
  });
  it("saldo na confirmação e diferença fora do ajuste → recusa; no ajuste, em par e com diferença = contada − saldo", async () => {
    for (const e of ["entrada", "saida", "transferencia"] as Especie[]) {
      expect([e, await chk(e, { saldo: "1" })]).toEqual([e, "chk_documentos_estoque_itens_ajuste"]);
      expect([e, await chk(e, { diferenca: "1" })]).toEqual([e, "chk_documentos_estoque_itens_ajuste"]);
    }
    expect(await chk("ajuste", { contada: "5", saldo: "3" })).toBe("chk_documentos_estoque_itens_diferenca");
    expect(await chk("ajuste", { contada: "5", diferenca: "2" })).toBe("chk_documentos_estoque_itens_diferenca");
    expect(await chk("ajuste", { contada: "5", saldo: "3", diferenca: "1" })).toBe("chk_documentos_estoque_itens_diferenca");
    await expect(item(docs.ajuste!, { especie: "ajuste", contada: "5", saldo: "7.5", diferenca: "-2.5" })).resolves.toBeTruthy();
  });
  it("quantidade ≤ 0, contada < 0, custo < 0, posição < 0 e lote em branco/com espaço → recusa", async () => {
    expect(await chk("saida", { quantidade: "0" })).toBe("chk_documentos_estoque_itens_quantidade");
    expect(await chk("saida", { quantidade: "-1" })).toBe("chk_documentos_estoque_itens_quantidade");
    expect(await chk("ajuste", { contada: "-0.0001" })).toBe("chk_documentos_estoque_itens_quantidade_contada");
    expect(await chk("entrada", { custo: "-0.000001" })).toBe("chk_documentos_estoque_itens_custo_unitario");
    expect(await chk("entrada", { posicao: -1 })).toBe("chk_documentos_estoque_itens_posicao");
    for (const lote of ["", "  ", " L1", "L1 "]) expect([lote, await chk("entrada", { lote })]).toEqual([lote, "chk_documentos_estoque_itens_lote"]);
    await expect(item(docs.entrada!, { especie: "entrada", lote: "L 1", validade: "2027-01-31" })).resolves.toBeTruthy();
  });
  it("posição única no documento; espécie do item diferente da do cabeçalho → a FK de três colunas recusa", async () => {
    const d = await doc({ especie: "saida" });
    await item(d, { especie: "saida", posicao: 0 });
    expect((await erroDe(item(d, { especie: "saida", posicao: 0 }))).constraint).toBe("uq_documentos_estoque_itens_posicao");
    // a espécie do item como entrada (custo informado) num documento de saída
    expect((await erroDe(item(d, { especie: "entrada", posicao: 1 }))).constraint).toBe("fk_documentos_estoque_itens_documento");
  });
});

describe("FKs compostas: referência de OUTRA organização é recusada (gatilhos desligados: é a FK que recusa)", () => {
  it("empresa, TOP, versão de outra TOP, armazém e destino de outra organização", async () => {
    expect((await erroDe(semGatilhos((q) => inserirCab(q, { empresa: empresaOutraOrg })))).constraint).toBe("fk_documentos_estoque_empresa");
    expect((await erroDe(semGatilhos((q) => inserirCab(q, { top: topOutraOrg })))).constraint).toBe("fk_documentos_estoque_tipo_operacao");
    expect((await erroDe(semGatilhos((q) => inserirCab(q, { top: { top: tops.entrada!.top, versao: tops.saida!.versao } })))).constraint).toBe("fk_documentos_estoque_tipo_operacao_versao");
    expect((await erroDe(semGatilhos((q) => inserirCab(q, { armazem: armazemOutraOrg })))).constraint).toBe("fk_documentos_estoque_armazem");
    expect((await erroDe(semGatilhos((q) => inserirCab(q, { especie: "transferencia", destino: armazemOutraOrg })))).constraint).toBe("fk_documentos_estoque_armazem_destino");
  });
  it("item com produto de outra organização, e item com organização diferente da do documento", async () => {
    const d = await doc();
    expect((await erroDe(semGatilhos((q) => inserirItem(q, d, { produto: produtoOutraOrg })))).constraint).toBe("fk_documentos_estoque_itens_produto");
    expect((await erroDe(semGatilhos((q) => inserirItem(q, d, { org: outraOrg, produto: produtoOutraOrg })))).constraint).toBe("fk_documentos_estoque_itens_documento");
  });
});

describe("gatilho do cabeçalho: família da TOP, armazéns da empresa, nascimento aberto, imutáveis", () => {
  it("a TOP precisa ser da família da espécie: compras, venda, outra família de estoque e a TOP de outra espécie → recusa", async () => {
    for (const especie of ESPECIES) {
      for (const outra of ["compras.compra", "vendas.venda", "estoque.baixa", ...ESPECIES.filter((e) => e !== especie)]) {
        const e = await erroDe(doc({ especie, top: tops[outra]! }));
        expect([especie, outra, e.message]).toEqual([especie, outra, `VALIDATION_ERROR: O tipo de operação não é da família do documento (estoque.${especie}).`]);
      }
    }
  });
  it("armazém de OUTRA EMPRESA (origem ou destino) e armazém excluído → recusa", async () => {
    expect((await erroDe(doc({ armazem: armazemB }))).message).toBe("VALIDATION_ERROR: O armazém precisa existir e ser da empresa do documento.");
    expect((await erroDe(doc({ armazem: armazemExcluido }))).message).toBe("VALIDATION_ERROR: O armazém precisa existir e ser da empresa do documento.");
    expect((await erroDe(doc({ especie: "transferencia", destino: armazemB }))).message).toBe("VALIDATION_ERROR: O armazém de destino precisa existir e ser da empresa do documento.");
    expect((await erroDe(doc({ especie: "transferencia", destino: armazemExcluido }))).message).toBe("VALIDATION_ERROR: O armazém de destino precisa existir e ser da empresa do documento.");
    // contraprova: documento da empresa B com o armazém de B
    await expect(doc({ empresa: B, armazem: armazemB })).resolves.toBeTruthy();
    // e trocar, no aberto, para armazém de outra empresa também é recusado; para outro da mesma empresa, passa
    const d = await doc();
    expect((await erroDe(db.query("update erp.documentos_estoque set armazem_id=$2 where id=$1", [d, armazemB]))).message).toMatch(/empresa do documento/);
    await expect(db.query("update erp.documentos_estoque set armazem_id=$2 where id=$1", [d, armazemA2])).resolves.toMatchObject({ rowCount: 1 });
  });
  it("o armazém excluído DEPOIS do lançamento não trava a confirmação nem o cancelamento", async () => {
    const w = await armazem(demo.orgId, A);
    const d = await doc({ armazem: w });
    await db.query("update erp.warehouses set deleted_at=now() where id=$1", [w]);
    await expect(situacao(d, "confirmado")).resolves.toMatchObject({ rowCount: 1 });
    await expect(situacao(d, "cancelado")).resolves.toMatchObject({ rowCount: 1 });
  });
  it("nasce aberto, sem carimbo de confirmação nem de cancelamento", async () => {
    const NASCE = "VALIDATION_ERROR: O documento de estoque nasce aberto; a confirmação e o cancelamento são transições.";
    expect((await erroDe(doc({ situacao: "confirmado", confirmadoEm: new Date(), confirmadoPor: demo.adminUserId }))).message).toBe(NASCE);
    expect((await erroDe(doc({ situacao: "cancelado", canceladoEm: new Date() }))).message).toBe(NASCE);
    expect((await erroDe(doc({ motivo: "x" }))).message).toBe(NASCE);
  });
  it("organização, empresa, espécie e código não mudam; TOP e versão não mudam nem com o documento aberto", async () => {
    const upd = (id: string, set: string, p: unknown[] = []) => db.query(`update erp.documentos_estoque set ${set} where id=$1`, [id, ...p]);
    const d = await doc({ especie: "entrada" });
    for (const [set, p] of [["empresa_id=$2", [B]], ["codigo='OUTRO'", []], ["especie='saida'", []], ["organization_id=$2", [outraOrg]]] as [string, unknown[]][]) {
      expect([set, (await erroDe(upd(d, set, p))).message]).toEqual([set, "VALIDATION_ERROR: Organização, empresa, espécie e código do documento de estoque não mudam."]);
    }
    const outra = await criarTop(demo.orgId, "estoque.entrada");
    const IMUTAVEL = "VALIDATION_ERROR: O tipo de operação e a versão congelada do documento de estoque não mudam depois do lançamento.";
    expect((await erroDe(upd(d, "tipo_operacao_id=$2, tipo_operacao_versao_id=$3", [outra.top, outra.versao]))).message).toBe(IMUTAVEL);
    const v2 = await withTx(db, { orgId: demo.orgId, userId: null }, async (tx) => (await tx.query<{ id: string }>(
      "insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome) values ($1,$2,2,'TOP estoque v2') returning id", [demo.orgId, tops.entrada!.top])).rows[0]!.id);
    expect((await erroDe(upd(d, "tipo_operacao_versao_id=$2", [v2]))).message).toBe(IMUTAVEL);
    // contraprova: aberto, observação e data mudam, e o carimbo anda
    const antes = (await db.query<{ t: Date }>("select atualizado_em t from erp.documentos_estoque where id=$1", [d])).rows[0]!.t;
    await expect(upd(d, "observacao='x', data_documento='2026-10-02'")).resolves.toMatchObject({ rowCount: 1 });
    const depois = (await db.query<{ t: Date; v: string }>("select atualizado_em t, tipo_operacao_versao_id v from erp.documentos_estoque where id=$1", [d])).rows[0]!;
    expect(depois.t.getTime()).toBeGreaterThan(antes.getTime());
    expect(depois.v, "a versão congelada continua a do lançamento").toBe(tops.entrada!.versao);
  });
});

describe("transições de situação — a matriz inteira, e o cabeçalho congelado fora do aberto", () => {
  const casos: [string[], "aberto" | "confirmado" | "cancelado", boolean][] = [
    [[], "confirmado", true],
    [[], "cancelado", true],
    [["confirmado"], "cancelado", true],
    [["confirmado"], "aberto", false],
    [["cancelado"], "aberto", false],
    [["cancelado"], "confirmado", false],
    [["confirmado", "cancelado"], "confirmado", false],
    [["confirmado", "cancelado"], "aberto", false]
  ];
  for (const especie of ESPECIES) {
    for (const [caminho, destino, ok] of casos) {
      it(`${especie}: ${["aberto", ...caminho].join("→")} → ${destino} ${ok ? "PERMITIDA" : "RECUSADA"}`, async () => {
        const d = await doc({ especie });
        for (const s of caminho) await situacao(d, s as "confirmado" | "cancelado");
        if (ok) {
          await situacao(d, destino);
          expect((await db.query<{ situacao: string }>("select situacao from erp.documentos_estoque where id=$1", [d])).rows[0]!.situacao).toBe(destino);
        } else {
          expect((await erroDe(situacao(d, destino))).message).toMatch(/^CONFLICT: /);
        }
      });
    }
  }
  it("a transição sozinha: confirmado → aberto mudando SÓ a situação (a conferência não vê outra mudança) é recusada pelo gatilho de transição", async () => {
    const d = await doc();
    await situacao(d, "confirmado");
    expect((await erroDe(db.query("update erp.documentos_estoque set situacao='aberto' where id=$1", [d]))).message)
      .toBe("CONFLICT: Transição de situação inválida no documento de estoque (confirmado para aberto).");
    expect((await db.query<{ situacao: string }>("select situacao from erp.documentos_estoque where id=$1", [d])).rows[0]!.situacao).toBe("confirmado");
  });
  it("só a situação, sem os carimbos, não passa (CHECK); aberto não se cancela 'como confirmado'", async () => {
    const d = await doc();
    expect((await erroDe(db.query("update erp.documentos_estoque set situacao='confirmado' where id=$1", [d]))).constraint).toBe("chk_documentos_estoque_confirmacao_situacao");
    expect((await erroDe(db.query("update erp.documentos_estoque set situacao='cancelado' where id=$1", [d]))).constraint).toBe("chk_documentos_estoque_cancelamento");
    expect((await erroDe(db.query("update erp.documentos_estoque set situacao='cancelado', cancelado_em=now(), confirmado_em=now(), confirmado_por=$2 where id=$1", [d, demo.adminUserId]))).message)
      .toBe("CONFLICT: Documento de estoque aberto não é cancelado como confirmado.");
  });
  it("confirmado: armazém, data, observação e os carimbos da confirmação não mudam; o cancelamento passa", async () => {
    const d = await doc({ especie: "transferencia" });
    await situacao(d, "confirmado");
    for (const [set, p] of [["observacao='x'", []], ["data_documento='2026-10-05'", []], ["armazem_id=$2", [armazemB]], ["armazem_destino_id=$2", [armazemB]],
      ["confirmado_em=now() - interval '1 day'", []], ["situacao='confirmado', observacao='y'", []]] as [string, unknown[]][]) {
      expect([set, (await erroDe(db.query(`update erp.documentos_estoque set ${set} where id=$1`, [d, ...p]))).message])
        .toEqual([set, "CONFLICT: O documento de estoque está confirmado; só o cancelamento muda."]);
    }
    await expect(situacao(d, "cancelado")).resolves.toMatchObject({ rowCount: 1 });
  });
  it("cancelado: nada muda — nem o motivo", async () => {
    const d = await doc();
    await situacao(d, "cancelado");
    for (const set of ["motivo_cancelamento='outro'", "observacao='x'", "cancelado_em=now()"]) {
      expect([set, (await erroDe(db.query(`update erp.documentos_estoque set ${set} where id=$1`, [d]))).message])
        .toEqual([set, "CONFLICT: O documento de estoque está cancelado; o cancelamento é final."]);
    }
  });
});

describe("gatilho do item: só com o documento aberto; produto que controla estoque", () => {
  it("inclui e altera no aberto (inclusive o que a confirmação grava); recusa incluir/alterar/apagar no confirmado e no cancelado", async () => {
    const d = await doc({ especie: "ajuste" });
    const i = await item(d, { especie: "ajuste", contada: "5" });
    // O que a confirmação grava, ANTES de virar o cabeçalho: saldo lido, diferença e custo usado.
    await expect(db.query("update erp.documentos_estoque_itens set saldo_na_confirmacao=3, diferenca=2, custo_unitario=1.5 where id=$1", [i])).resolves.toMatchObject({ rowCount: 1 });
    await situacao(d, "confirmado");
    expect((await erroDe(item(d, { especie: "ajuste" }))).message).toBe("CONFLICT: Os itens só mudam com o documento de estoque aberto (situação: confirmado).");
    expect((await erroDe(db.query("update erp.documentos_estoque_itens set observacao='x' where id=$1", [i]))).message).toMatch(/^CONFLICT: Os itens só mudam/);
    expect((await erroDe(db.query("delete from erp.documentos_estoque_itens where id=$1", [i]))).message).toMatch(/^CONFLICT: Os itens só mudam/);
    const c = await doc({ especie: "saida" });
    await situacao(c, "cancelado");
    expect((await erroDe(item(c, { especie: "saida" }))).message).toBe("CONFLICT: Os itens só mudam com o documento de estoque aberto (situação: cancelado).");
  });
  it("o item não muda de documento (nem de espécie)", async () => {
    const d = await doc(); const i = await item(d); const outro = await doc();
    expect((await erroDe(db.query("update erp.documentos_estoque_itens set documento_id=$2 where id=$1", [i, outro]))).message).toBe("VALIDATION_ERROR: O item não muda de documento.");
    expect((await erroDe(db.query("update erp.documentos_estoque_itens set especie='saida' where id=$1", [i]))).message).toBe("VALIDATION_ERROR: O item não muda de documento.");
  });
  it("produto sem controle de estoque ou excluído → recusa, em toda espécie e também na troca de produto", async () => {
    for (const especie of ESPECIES) {
      const d = await doc({ especie });
      for (const p of [produtoSemControle, produtoExcluido]) {
        expect([especie, (await erroDe(item(d, { especie, produto: p }))).message]).toEqual([especie, "VALIDATION_ERROR: O produto do item precisa existir e controlar estoque."]);
      }
    }
    const d = await doc(); const i = await item(d);
    expect((await erroDe(db.query("update erp.documentos_estoque_itens set produto_id=$2 where id=$1", [i, produtoSemControle]))).message).toMatch(/controlar estoque/);
  });
  it("FOR SHARE no cabeçalho: o item espera a confirmação concorrente terminar e lê a situação NOVA", async () => {
    const d = await doc({ especie: "saida" });
    const confirmador = await db.connect();
    try {
      await confirmador.query("begin");
      await confirmador.query("select 1 from erp.documentos_estoque where id=$1 for update", [d]);
      await confirmador.query("update erp.documentos_estoque set situacao='confirmado', confirmado_em=now(), confirmado_por=$2 where id=$1", [d, demo.adminUserId]);
      const pendente = erroDe(item(d, { especie: "saida" }));
      // O INSERT do item fica esperando a trava do cabeçalho (prova de que ele não leu o 'aberto' de antes).
      let esperando = 0;
      for (let t = 0; t < 100 && esperando === 0; t++) {
        esperando = (await db.query<{ n: number }>(
          "select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like 'insert into erp.documentos_estoque_itens%'")).rows[0]!.n;
        if (esperando === 0) await new Promise((r) => setTimeout(r, 50));
      }
      expect(esperando, "o item ficou esperando a confirmação").toBe(1);
      await confirmador.query("commit");
      expect((await pendente).message).toBe("CONFLICT: Os itens só mudam com o documento de estoque aberto (situação: confirmado).");
    } finally { await confirmador.query("rollback").catch(() => {}); confirmador.release(); }
    expect((await db.query("select 1 from erp.documentos_estoque_itens where documento_id=$1", [d])).rowCount).toBe(0);
  });
});

describe("RLS e privilégios sob o papel da aplicação (módulo estoque)", () => {
  let docA: string; let docB: string; let itemA: string; let itemB: string; let docOutraOrg: string;
  beforeAll(async () => {
    docA = await doc({ empresa: A, armazem: armazemA }); itemA = await item(docA);
    docB = await doc({ empresa: B, armazem: armazemB }); itemB = await item(docB);
    docOutraOrg = await withTx(db, { orgId: outraOrg, userId: null }, async (tx) => {
      const t = topOutraOrg;
      return (await tx.query<{ id: string }>(
        `insert into erp.documentos_estoque (organization_id, empresa_id, especie, codigo, tipo_operacao_id, tipo_operacao_versao_id, armazem_id, data_documento)
         values ($1,$2,'entrada','OUTRA-1',$3,$4,$5,'2026-10-01') returning id`, [outraOrg, empresaOutraOrg, t.top, t.versao, armazemOutraOrg])).rows[0]!.id;
    });
  });
  const ler = (ctx: TenantContext) => withTx(app, ctx, async (tx) => ({
    docs: (await tx.query<{ id: string }>("select id from erp.documentos_estoque where id = any($1)", [[docA, docB, docOutraOrg]])).rows.map((r) => r.id).sort(),
    itens: (await tx.query<{ id: string }>("select id from erp.documentos_estoque_itens where id = any($1)", [[itemA, itemB]])).rows.map((r) => r.id).sort()
  }));
  it("o proprietário, no módulo estoque, vê as duas empresas da organização — e nunca a outra organização", async () => {
    expect(await ler(ctxEstoque())).toEqual({ docs: [docA, docB].sort(), itens: [itemA, itemB].sort() });
  });
  it("o membro com escopo [A] em estoque vê só o documento de A, e o item HERDA o recorte", async () => {
    expect(await ler(ctxEstoque(usuarioEscopoA))).toEqual({ docs: [docA], itens: [itemA] });
  });
  it("o mesmo membro em outro módulo (compras, sem configuração) não vê nada — fail-closed; sem organização na GUC, nada", async () => {
    expect(await ler(ctxEstoque(usuarioEscopoA, "compras"))).toEqual({ docs: [], itens: [] });
    expect(await ler({ orgId: null, userId: demo.adminUserId, modulo: "estoque" })).toEqual({ docs: [], itens: [] });
  });
  it("o membro [A] não grava documento em B nem item em documento de B; UPDATE fora do escopo afeta zero linhas", async () => {
    expect((await erroDe(withTx(app, ctxEstoque(usuarioEscopoA), (tx) => inserirCab(tx, { empresa: B, armazem: armazemB })))).code).toBe("42501");
    await expect(withTx(app, ctxEstoque(usuarioEscopoA), (tx) => inserirCab(tx, { empresa: A }))).resolves.toBeTruthy();
    expect((await erroDe(withTx(app, ctxEstoque(usuarioEscopoA), (tx) => inserirItem(tx, docB)))).code).toBe("42501");
    const n = await withTx(app, ctxEstoque(usuarioEscopoA), (tx) => tx.query("update erp.documentos_estoque set observacao='x' where id=$1", [docB]));
    expect(n.rowCount, "UPDATE fora do escopo afeta zero linhas").toBe(0);
    expect((await db.query<{ o: string | null }>("select observacao o from erp.documentos_estoque where id=$1", [docB])).rows[0]!.o).toBeNull();
  });
  it("as conferências dos gatilhos (definer) enxergam o cadastro mesmo pelo papel da aplicação: família e armazém recusados", async () => {
    expect((await erroDe(withTx(app, ctxEstoque(), (tx) => inserirCab(tx, { especie: "saida", top: tops.entrada })))).message).toMatch(/família do documento \(estoque\.saida\)/);
    expect((await erroDe(withTx(app, ctxEstoque(), (tx) => inserirCab(tx, { armazem: armazemB })))).message).toMatch(/empresa do documento/);
    expect((await erroDe(withTx(app, ctxEstoque(), (tx) => inserirItem(tx, docA, { produto: produtoSemControle })))).message).toMatch(/controlar estoque/);
  });
  it("sem DELETE para o papel da aplicação, nas duas tabelas (nem com o documento aberto)", async () => {
    expect((await erroDe(withTx(app, ctxEstoque(), (tx) => tx.query("delete from erp.documentos_estoque where id=$1", [docA])))).code).toBe("42501");
    expect((await erroDe(withTx(app, ctxEstoque(), (tx) => tx.query("delete from erp.documentos_estoque_itens where id=$1", [itemA])))).code).toBe("42501");
    expect((await db.query("select 1 from erp.documentos_estoque_itens where id=$1", [itemA])).rowCount).toBe(1);
  });
});

describe("auditoria por erp.audit_row no cabeçalho", () => {
  it("criar, confirmar e cancelar gravam create e update em erp.audit_logs, com o usuário da GUC", async () => {
    const d = await withTx(app, ctxEstoque(), (tx) => inserirCab(tx, { especie: "saida" }));
    await withTx(app, ctxEstoque(), (tx) => tx.query("update erp.documentos_estoque set situacao='confirmado', confirmado_em=now(), confirmado_por=$2 where id=$1", [d, demo.adminUserId]));
    await withTx(app, ctxEstoque(), (tx) => tx.query("update erp.documentos_estoque set situacao='cancelado', cancelado_em=now(), cancelado_por=$2, motivo_cancelamento='x' where id=$1", [d, demo.adminUserId]));
    const r = (await db.query<{ action: string; user_id: string; depois: string | null }>(
      "select action, user_id, after->>'situacao' depois from erp.audit_logs where entity='documentos_estoque' and entity_id=$1 order by id", [d])).rows;
    expect(r).toEqual([
      { action: "create", user_id: demo.adminUserId, depois: "aberto" },
      { action: "update", user_id: demo.adminUserId, depois: "confirmado" },
      { action: "update", user_id: demo.adminUserId, depois: "cancelado" }
    ]);
  });
});
