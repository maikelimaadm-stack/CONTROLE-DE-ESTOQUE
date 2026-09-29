import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { familiaOperacionalDeDocumentoVenda } from "@agro/domain";
import { createPool, withTx, type Db } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * A 0035 SOBRE ACERVO QUE JÁ EXISTIA (TOP-CONFIG-07, decisão 266).
 *
 * Banco NOVO esconde a prova: o seed não grava TOP nenhuma, então "nenhuma versão nasce reservando" seria verdade
 * sobre conjunto vazio — inclusive a pós-condição da própria migration. Este arquivo sobe o banco até a 0034,
 * grava versões das três famílias de venda, um pedido aberto e saldo em estoque (com e sem lote) pelo caminho de
 * antes, e só então aplica a 0035 como o runner aplica (uma transação). E prova as recusas da migration: a trava
 * (2026,69) e o lock_timeout de 2s param SEM efeito; reaplicar é recusado pela pré-condição.
 */
let db: Db; let demo: DemoOrg;
let empresa: string; let armazem: string; let produto: string; let produtoLote: string; let pedidoAberto: string;
const FAMILIAS = ["order", "budget", "sale"].map((k) => familiaOperacionalDeDocumentoVenda(k)!);

async function aplicar(prefixo: string): Promise<void> {
  const m = listMigrations().find((x) => x.name.startsWith(prefixo));
  expect(m, `migration ${prefixo} precisa existir`).toBeTruthy();
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query(m!.sql);
    await c.query("insert into public.erp_migrations(name) values ($1)", [m!.name]);
    await c.query("commit");
  } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
}
const num = async (sql: string, params: unknown[] = []) => Number((await db.query<{ n: string }>(sql, params)).rows[0]!.n);
const colunaExiste = async () => (await db.query("select 1 from information_schema.columns where table_schema='erp' and table_name='tipos_operacao_versoes' and column_name='reserva_estoque'")).rowCount === 1;
const naLedger = async () => (await db.query("select 1 from public.erp_migrations where name like '0035%'")).rowCount === 1;

/** O que a 0035 NÃO pode tocar, linha a linha (sem a coluna nova). */
async function retrato() {
  return {
    versoes: (await db.query("select id, organization_id, tipo_operacao_id, versao, nome, configuracao, configuracao_schema_version, destinos_configurados from erp.tipos_operacao_versoes order by id")).rows,
    saldos: (await db.query("select organization_id, warehouse_id, product_id, provider_lot, quantity, average_cost, total_value, version from erp.stock_balances order by 1,2,3,4")).rows,
    movimentos: await num("select count(*)::text n from erp.stock_movements"),
    documentos: (await db.query("select id, status, tipo_operacao_versao_id from erp.sales_documents order by id")).rows,
    itens: (await db.query("select id, document_id, product_id, warehouse_id, quantity from erp.sales_document_items order by id")).rows,
  };
}
let antes: Awaited<ReturnType<typeof retrato>>;

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 4 });
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of listMigrations().filter((x) => x.name < "0035")) {
    await db.query(m.sql);
    await db.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
  }
  await seedReference(db, () => {});
  demo = await seedDemo(db, {}, () => {});
  empresa = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code limit 1", [demo.orgId])).rows[0]!.id;
  armazem = (await db.query<{ id: string }>("select id from erp.warehouses where organization_id=$1 and empresa_id=$2 order by initials limit 1", [demo.orgId, empresa])).rows[0]!.id;
  produto = (await db.query<{ id: string }>("select id from erp.products where organization_id=$1 and controle_lote='nenhum' order by code limit 1", [demo.orgId])).rows[0]!.id;
  produtoLote = (await db.query<{ id: string }>("select id from erp.products where organization_id=$1 and controle_lote='lote' order by code limit 1", [demo.orgId])).rows[0]!.id;
  const cliente = (await db.query<{ id: string }>("select id from erp.people where organization_id=$1 and is_client limit 1", [demo.orgId])).rows[0]!.id;
  pedidoAberto = await withTx(db, { orgId: demo.orgId, userId: demo.adminUserId, modulo: "vendas" }, async (tx) => {
    const versaoDoPedido: string[] = [];
    let n = 0;
    for (const familia of FAMILIAS) {
      const top = (await tx.query<{ id: string }>("insert into erp.tipos_operacao (organization_id, codigo, codigo_base, versao_atual) values ($1,$2,$3,2) returning id",
        [demo.orgId, `UP${++n}`, familia])).rows[0]!.id;
      for (const v of [1, 2]) {
        const id = (await tx.query<{ id: string }>("insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome) values ($1,$2,$3,$4) returning id",
          [demo.orgId, top, v, `Acervo ${familia} v${v}`])).rows[0]!.id;
        if (familia === FAMILIAS[0] && v === 2) versaoDoPedido.push(top, id);
      }
    }
    const doc = (await tx.query<{ id: string }>(
      `insert into erp.sales_documents (organization_id, empresa_id, kind, code, document_date, client_id, status, tipo_operacao_id, tipo_operacao_versao_id)
       values ($1,$2,'order','UP-1','2026-09-01',$3,'open',$4,$5) returning id`, [demo.orgId, empresa, cliente, versaoDoPedido[0], versaoDoPedido[1]])).rows[0]!.id;
    await tx.query("insert into erp.sales_document_items (document_id, product_id, warehouse_id, quantity, unit_price, total, position) values ($1,$2,$3,4,10,40,0)", [doc, produto, armazem]);
    const mov = `insert into erp.stock_movements (organization_id, empresa_id, warehouse_id, product_id, movement_type, direction, quantity, unit_cost, provider_lot, source_type, source_id, movement_date)
                 values ($1,$2,$3,$4,$5,$6,$7,2,$8,$9,$10,'2026-09-01')`;
    await tx.query(mov, [demo.orgId, empresa, armazem, produto, "opening_balance", 1, "10", null, "opening_balances", randomUUID()]);
    await tx.query(mov, [demo.orgId, empresa, armazem, produto, "requisition", -1, "3", null, "requisitions", randomUUID()]);
    await tx.query(mov, [demo.orgId, empresa, armazem, produtoLote, "opening_balance", 1, "5", "L1", "opening_balances", randomUUID()]);
    return doc;
  });
  antes = await retrato();
}, 300_000);
afterAll(async () => { await db?.end(); });

describe("0035 — upgrade sobre acervo", () => {
  it("BU1 PREMISSA: sob a 0034 há versões das três famílias, pedido aberto e saldo — e a coluna ainda não existe", async () => {
    expect(antes.versoes.length, "sem acervo, 'nenhuma versão nasce reservando' seria verdade sobre conjunto vazio").toBe(6);
    expect(antes.saldos.length).toBe(2);
    expect(antes.saldos.map((s) => s.quantity).sort()).toEqual(["5.0000", "7.0000"]);
    expect(antes.itens.length).toBe(1);
    expect(await colunaExiste(), "a coluna é da 0035").toBe(false);
    expect(await naLedger()).toBe(false);
  });

  it("BU2 lock_timeout 2s: uma leitura aberta na tabela das versões faz a 0035 desistir em ~2s, sem efeito", async () => {
    const leitor = await db.connect();
    try {
      await leitor.query("begin");
      await leitor.query("select 1 from erp.tipos_operacao_versoes limit 1");      // AccessShare: o add column precisa de AccessExclusive
      const t0 = Date.now();
      await expect(aplicar("0035")).rejects.toThrow(/lock timeout/);
      const ms = Date.now() - t0;
      expect(ms, "desistiu pelo lock_timeout, não por outro motivo imediato").toBeGreaterThanOrEqual(1900);
      expect(ms, "e não ficou pendurada").toBeLessThan(10_000);
    } finally { await leitor.query("rollback"); leitor.release(); }
    expect(await colunaExiste()).toBe(false);
    expect(await naLedger()).toBe(false);
  });

  it("BU3 trava (2026,69) em uso por outra sessão: a 0035 recusa antes de tudo, sem efeito", async () => {
    const outra = await db.connect();
    try {
      await outra.query("select pg_advisory_lock(2026, 69)");
      await expect(aplicar("0035")).rejects.toThrow("TOP-CONFIG-07: outra transacao ja detem a trava desta migration (2026,69). Nada foi aplicado.");
    } finally { await outra.query("select pg_advisory_unlock(2026, 69)"); outra.release(); }
    expect(await colunaExiste()).toBe(false);
  });

  it("BU4 aplica: coluna nasce false em TODA versão; versões, saldos, movimentos, documentos e itens idênticos; gatilho no lugar", async () => {
    await aplicar("0035");
    expect(await naLedger()).toBe(true);
    expect(await num("select count(*)::text n from erp.tipos_operacao_versoes")).toBe(6);
    expect(await num("select count(*)::text n from erp.tipos_operacao_versoes where reserva_estoque")).toBe(0);
    expect(await retrato()).toEqual(antes);
    expect(await num("select count(*)::text n from pg_trigger where tgrelid='erp.stock_movements'::regclass and tgname='trg_stock_movement_reserva'")).toBe(1);
  });

  it("BU5 reaplicar é recusado pela pré-condição, sem efeito", async () => {
    const c = await db.connect();
    const m = listMigrations().find((x) => x.name.startsWith("0035"))!;
    try {
      await c.query("begin");
      await expect(c.query(m.sql)).rejects.toThrow("TOP-CONFIG-07: reserva_estoque ja existe; a 0035 ja foi aplicada ou ha schema divergente.");
    } finally { await c.query("rollback"); c.release(); }
    expect(await retrato()).toEqual(antes);
  });

  it("BU6 janela de deploy: sem versão que reserve, o gatilho não recusa nada — o pedido aberto do acervo não trava a saída", async () => {
    expect(await num("select count(*)::text n from erp.sales_document_items i join erp.sales_documents d on d.id=i.document_id where d.id=$1 and d.status='open' and i.warehouse_id=$2 and i.product_id=$3",
      [pedidoAberto, armazem, produto]), "PREMISSA: há pedido aberto com item no par").toBe(1);
    await withTx(db, { orgId: demo.orgId, userId: demo.adminUserId, modulo: "estoque" }, (tx) => tx.query(
      `insert into erp.stock_movements (organization_id, empresa_id, warehouse_id, product_id, movement_type, direction, quantity, unit_cost, source_type, source_id, movement_date)
       values ($1,$2,$3,$4,'requisition',-1,7,2,'requisitions',$5,'2026-09-02')`, [demo.orgId, empresa, armazem, produto, randomUUID()]));
    expect(await num("select coalesce(sum(quantity),0)::text n from erp.stock_balances where warehouse_id=$1 and product_id=$2", [armazem, produto])).toBe(0);
  });
});
