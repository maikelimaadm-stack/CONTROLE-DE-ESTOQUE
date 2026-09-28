import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { freshDb, TEST_URL } from "./setup.js";
import { createPool, withTx, type Db } from "../src/pool.js";
import type { DemoOrg } from "../src/seed.js";

/**
 * O QUE A 0034 PROMETEU, PROVADO CONTRA O BANCO (TOP-CONFIG-06, decisão 265).
 *
 * A invariante do saldo mora no gatilho `trg_sales_document_items_origem_guarda`: um item com origem só entra se
 * o item de origem for do documento de origem, com o mesmo produto, e se a soma ligada em documentos NÃO
 * cancelados não passar da quantidade de origem. As inserções aqui são do PAPEL DA APLICAÇÃO (sem bypass de
 * RLS) — é a rede que pega um caminho que tenha pulado a conferência da API.
 */
let db: Db; let app: Db; let demo: DemoOrg;
let empresa: string; let cliente: string; let produtoA: string; let produtoB: string;
beforeAll(async () => {
  ({ db, demo } = await freshDb());
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@"), { max: 3 });
  empresa = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code limit 1", [demo.orgId])).rows[0]!.id;
  cliente = (await db.query<{ id: string }>("select id from erp.people where organization_id=$1 and is_client limit 1", [demo.orgId])).rows[0]!.id;
  const prods = (await db.query<{ id: string }>("select id from erp.products where organization_id=$1 order by code limit 2", [demo.orgId])).rows;
  produtoA = prods[0]!.id; produtoB = prods[1]!.id;
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

let seq = 0;
const ctx = () => ({ orgId: demo.orgId, userId: demo.adminUserId, modulo: "vendas" as const });

async function documento(kind: string, origem: string | null, status = "open"): Promise<string> {
  seq += 1;
  return withTx(app, ctx(), async (tx) => (await tx.query<{ id: string }>(
    `insert into erp.sales_documents (organization_id, empresa_id, kind, code, document_date, client_id, origin_document_id, status)
     values ($1,$2,$3,$4,'2026-09-01',$5,$6,$7) returning id`,
    [demo.orgId, empresa, kind, `FP-${seq}`, cliente, origem, status])).rows[0]!.id);
}
async function item(doc: string, produto: string, qtd: string, origem: string | null = null, pos = 0): Promise<string> {
  return withTx(app, ctx(), async (tx) => (await tx.query<{ id: string }>(
    `insert into erp.sales_document_items (document_id, product_id, quantity, unit_price, total, position, origem_item_id)
     values ($1,$2,$3,10,0,$4,$5) returning id`, [doc, produto, qtd, pos, origem])).rows[0]!.id);
}
const recusa = (p: Promise<unknown>) => expect(p).rejects.toThrow(/VALIDATION_ERROR/);

describe("0034 — colunas, índices e gatilho", () => {
  it("B1 aresta nasce sem 'Em partes'; colunas novas nulas; gatilho e índices presentes", async () => {
    const col = await db.query<{ column_default: string; is_nullable: string }>(
      "select column_default, is_nullable from information_schema.columns where table_schema='erp' and table_name='tipos_operacao_versao_destinos' and column_name='em_partes'");
    expect(col.rows).toEqual([{ column_default: "false", is_nullable: "NO" }]);
    const t = await db.query("select 1 from pg_trigger where tgrelid='erp.sales_document_items'::regclass and tgname='trg_sales_document_items_origem_guarda' and tgenabled='O'");
    expect(t.rowCount).toBe(1);
    const i = await db.query("select to_regclass('erp.ix_sales_documents_origin_document') a, to_regclass('erp.ix_sales_document_items_origem_item') b");
    expect(i.rows[0]).toEqual({ a: "erp.ix_sales_documents_origin_document", b: "erp.ix_sales_document_items_origem_item" });
  });

  it("B2 saldo encerrado: os três nulos, ou 'em' e 'por' juntos — metade é recusada", async () => {
    const d = await documento("order", null);
    await expect(db.query("update erp.sales_documents set saldo_encerrado_em=now() where id=$1", [d])).rejects.toThrow(/ck_sales_documents_saldo_encerrado/);
    await db.query("update erp.sales_documents set saldo_encerrado_em=now(), saldo_encerrado_por=$2, saldo_encerrado_motivo='teste' where id=$1", [d, demo.adminUserId]);
  });
});

describe("0034 — a invariante do saldo (papel da aplicação)", () => {
  it("B3 dentro do saldo passa; a soma acima do saldo é recusada; parte cancelada devolve o saldo", async () => {
    const pedido = await documento("order", null);
    const orig = await item(pedido, produtoA, "10");
    const v1 = await documento("sale", pedido);
    await item(v1, produtoA, "4", orig);
    const v2 = await documento("sale", pedido);
    await recusa(item(v2, produtoA, "7", orig));          // 4 + 7 > 10
    await item(v2, produtoA, "6", orig);                  // 4 + 6 = 10: no limite
    const v3 = await documento("sale", pedido);
    await recusa(item(v3, produtoA, "0.0001", orig));     // saldo zero
    await db.query("update erp.sales_documents set status='cancelled' where id=$1", [v1]);
    await item(v3, produtoA, "4", orig);                  // o cancelamento devolveu 4
  });

  it("B4 item de origem de OUTRO documento, e produto diferente, são recusados", async () => {
    const pedido = await documento("order", null);
    const orig = await item(pedido, produtoA, "5");
    const outro = await documento("order", null);
    const venda = await documento("sale", outro);         // aponta outro pedido
    await recusa(item(venda, produtoA, "1", orig));
    const certa = await documento("sale", pedido);
    await recusa(item(certa, produtoB, "1", orig));
  });

  it("B5 UPDATE de quantidade também passa pelo gatilho", async () => {
    const pedido = await documento("order", null);
    const orig = await item(pedido, produtoA, "3");
    const venda = await documento("sale", pedido);
    const parte = await item(venda, produtoA, "2", orig);
    await recusa(withTx(app, ctx(), (tx) => tx.query("update erp.sales_document_items set quantity=4 where id=$1", [parte])));
    await withTx(app, ctx(), (tx) => tx.query("update erp.sales_document_items set quantity=3 where id=$1", [parte]));
  });

  it("B6 item referenciado por parte não pode ser apagado (on delete restrict)", async () => {
    const pedido = await documento("order", null);
    const orig = await item(pedido, produtoA, "3");
    const venda = await documento("sale", pedido);
    await item(venda, produtoA, "1", orig);
    await expect(db.query("delete from erp.sales_document_items where id=$1", [orig])).rejects.toThrow(/fk_sales_document_items_origem_item/);
  });
});
