import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { familiaOperacionalDeDocumentoVenda } from "@agro/domain";
import { freshDb, TEST_URL } from "./setup.js";
import { createPool, withTx, type Db, type Tx, type TenantContext } from "../src/pool.js";
import type { DemoOrg } from "../src/seed.js";

/**
 * O QUE A 0035 PROMETEU, PROVADO CONTRA O BANCO (TOP-CONFIG-07, decisão 266).
 *
 * O reservado é CONTA (erp.reserva_estoque_nucleo), lida pela porta exposta (erp.reserva_estoque) e pelo gatilho
 * de saída (trg_stock_movement_reserva). Documentos, versões e movimentos são gravados aqui pelo PAPEL DA
 * APLICAÇÃO (sem bypass de RLS), com as GUCs da transação — é o caminho que a API percorre, e é a rede que pega
 * quem pulou a conferência da API. Cada teste usa um ARMAZÉM NOVO: o par (armazém, produto) de um teste nunca
 * carrega reserva de outro.
 */
let db: Db; let app: Db; let demo: DemoOrg;
let empresa: string; let cliente: string; let produtoA: string; let produtoB: string; let produtoLote: string;
let pedidoComReserva: Top; let pedidoSemReserva: Top;

const FAMILIA_PEDIDO = familiaOperacionalDeDocumentoVenda("order")!;
const FAMILIA_ORCAMENTO = familiaOperacionalDeDocumentoVenda("budget")!;
const FAMILIA_VENDA = familiaOperacionalDeDocumentoVenda("sale")!;

interface Top { top: string; versao: string }
interface Par { w: string; p: string }
type Linha = { warehouse_id: string; product_id: string; reservado: string };

const ctxVendas = (userId?: string): TenantContext => ({ orgId: demo.orgId, userId: userId ?? demo.adminUserId, modulo: "vendas" });
const ctxEstoque = (): TenantContext => ({ orgId: demo.orgId, userId: demo.adminUserId, modulo: "estoque" });

beforeAll(async () => {
  ({ db, demo } = await freshDb());
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@"), { max: 4 });
  empresa = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code limit 1", [demo.orgId])).rows[0]!.id;
  cliente = (await db.query<{ id: string }>("select id from erp.people where organization_id=$1 and is_client limit 1", [demo.orgId])).rows[0]!.id;
  const semLote = (await db.query<{ id: string }>("select id from erp.products where organization_id=$1 and controle_lote='nenhum' and control_stock order by code limit 2", [demo.orgId])).rows;
  produtoA = semLote[0]!.id; produtoB = semLote[1]!.id;
  produtoLote = (await db.query<{ id: string }>("select id from erp.products where organization_id=$1 and controle_lote='lote' and control_stock order by code limit 1", [demo.orgId])).rows[0]!.id;
  pedidoComReserva = await criarTop(FAMILIA_PEDIDO, true);
  pedidoSemReserva = await criarTop(FAMILIA_PEDIDO, false);
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

let seq = 0;
async function criarTop(codigoBase: string, reserva: boolean): Promise<Top> {
  seq += 1;
  return withTx(app, ctxVendas(), async (tx) => {
    const top = (await tx.query<{ id: string }>("insert into erp.tipos_operacao (organization_id, codigo, codigo_base) values ($1,$2,$3) returning id",
      [demo.orgId, `RE${seq}`, codigoBase])).rows[0]!.id;
    const versao = (await tx.query<{ id: string }>(
      "insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, reserva_estoque) values ($1,$2,1,$3,$4) returning id",
      [demo.orgId, top, `Reserva ${seq}`, reserva])).rows[0]!.id;
    return { top, versao };
  });
}
/** Um armazém NOVO da empresa: o par do teste começa sem saldo e sem reserva de ninguém. */
async function novoPar(produto: string = produtoA): Promise<Par> {
  seq += 1;
  const w = (await db.query<{ id: string }>("insert into erp.warehouses (organization_id, empresa_id, initials, description) values ($1,$2,$3,$4) returning id",
    [demo.orgId, empresa, `RE${seq}`, `Armazem reserva ${seq}`])).rows[0]!.id;
  return { w, p: produto };
}
async function documento(kind: "budget" | "order" | "sale", o: { status?: string; origem?: string | null; top?: Top | null } = {}): Promise<string> {
  seq += 1;
  return withTx(app, ctxVendas(), async (tx) => (await tx.query<{ id: string }>(
    `insert into erp.sales_documents (organization_id, empresa_id, kind, code, document_date, client_id, origin_document_id, status, tipo_operacao_id, tipo_operacao_versao_id)
     values ($1,$2,$3,$4,'2026-09-01',$5,$6,$7,$8,$9) returning id`,
    [demo.orgId, empresa, kind, `RE-${seq}`, cliente, o.origem ?? null, o.status ?? "open", o.top?.top ?? null, o.top?.versao ?? null])).rows[0]!.id);
}
async function item(doc: string, par: Par, qtd: string, origem: string | null = null): Promise<string> {
  return withTx(app, ctxVendas(), async (tx) => (await tx.query<{ id: string }>(
    `insert into erp.sales_document_items (document_id, product_id, warehouse_id, quantity, unit_price, total, position, origem_item_id)
     values ($1,$2,$3,$4,10,0,0,$5) returning id`, [doc, par.p, par.w, qtd, origem])).rows[0]!.id);
}
/** Produto SEM controle de estoque (serviço), cópia do produto A na organização do demo. chk_product_fin_cat só exige
 * a categoria financeira de quem controla estoque; grupo, unidade e classificação vêm do produto A. */
async function produtoSemControle(): Promise<string> {
  seq += 1;
  return (await db.query<{ id: string }>(
    `insert into erp.products (organization_id, code, description, group_id, measurement_id, category_id, kind_id, control_stock)
     select organization_id, $2, $3, group_id, measurement_id, category_id, kind_id, false from erp.products where id=$1 returning id`,
    [produtoA, `RS${seq}`, `Servico reserva ${seq}`])).rows[0]!.id;
}
/** Pedido com UM item no par, na TOP dada. */
async function pedido(par: Par, qtd: string, top: Top = pedidoComReserva, status = "open"): Promise<{ id: string; item: string }> {
  const id = await documento("order", { top, status });
  return { id, item: await item(id, par, qtd) };
}
const situacao = (doc: string, status: string) => db.query("update erp.sales_documents set status=$2 where id=$1", [doc, status]);

const MOVIMENTO = `insert into erp.stock_movements (organization_id, empresa_id, warehouse_id, product_id, movement_type, direction, quantity, unit_cost,
                     provider_lot, source_type, source_id, movement_date, created_by)
                   values ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,'2026-09-01',$11)`;
interface Mov { tipo?: string; direcao?: 1 | -1; lote?: string | null; origemTipo?: string; origemId?: string }
const paramsMov = (par: Par, qtd: string, m: Mov) =>
  [demo.orgId, empresa, par.w, par.p, m.tipo ?? "requisition", m.direcao ?? -1, qtd, m.lote ?? null, m.origemTipo ?? "requisitions", m.origemId ?? randomUUID(), demo.adminUserId];
async function movimento(par: Par, qtd: string, m: Mov = {}): Promise<void> {
  await withTx(app, ctxEstoque(), (tx) => tx.query(MOVIMENTO, paramsMov(par, qtd, m)));
}
const entrada = (par: Par, qtd: string, lote: string | null = null) => movimento(par, qtd, { tipo: "opening_balance", direcao: 1, lote, origemTipo: "opening_balances" });
const saida = (par: Par, qtd: string, m: Mov = {}) => movimento(par, qtd, { direcao: -1, ...m });
const fisico = async (par: Par) => (await db.query<{ q: string }>(
  "select coalesce(sum(quantity),0)::text q from erp.stock_balances where organization_id=$1 and warehouse_id=$2 and product_id=$3", [demo.orgId, par.w, par.p])).rows[0]!.q;

/** A porta exposta, pelo papel da aplicação. */
async function porta(pares: { w: string | null; p: string | null }[], excluir: string | null = null, ctx: TenantContext = ctxVendas()): Promise<Linha[]> {
  return withTx(app, ctx, async (tx) => (await tx.query<Linha>(
    "select warehouse_id, product_id, reservado from erp.reserva_estoque($1::uuid[], $2::uuid[], $3::uuid) order by warehouse_id, product_id",
    [pares.map((x) => x.w), pares.map((x) => x.p), excluir])).rows);
}
async function reservado(par: Par, excluir: string | null = null): Promise<string> {
  const r = await porta([par], excluir);
  expect(r, "quem tem capacidade recebe UMA linha por par").toHaveLength(1);
  expect(r[0]).toMatchObject({ warehouse_id: par.w, product_id: par.p });
  return r[0]!.reservado;
}
const INSUFICIENTE = (d: string, q: string, r: string) => `INSUFFICIENT_STOCK: disponível ${d} < solicitado ${q} (${r} reservado para pedidos)`;

describe("BR1 — a versão declara a reserva; só a família pedido", () => {
  it("BR1 coluna boolean not null default false; índices e gatilho de família presentes; versão sem a coluna nasce false", async () => {
    const col = await db.query<{ data_type: string; column_default: string; is_nullable: string }>(
      "select data_type, column_default, is_nullable from information_schema.columns where table_schema='erp' and table_name='tipos_operacao_versoes' and column_name='reserva_estoque'");
    expect(col.rows).toEqual([{ data_type: "boolean", column_default: "false", is_nullable: "NO" }]);
    const idx = await db.query("select to_regclass('erp.ix_sales_document_items_reserva') a, to_regclass('erp.ix_sales_document_items_documento') b, to_regclass('erp.ix_tipos_operacao_versoes_reserva') c");
    expect(idx.rows[0]).toEqual({ a: "erp.ix_sales_document_items_reserva", b: "erp.ix_sales_document_items_documento", c: "erp.ix_tipos_operacao_versoes_reserva" });
    const g = await db.query("select 1 from pg_trigger where tgrelid='erp.tipos_operacao_versoes'::regclass and tgname='trg_tipos_operacao_versoes_reserva_familia' and tgenabled='O'");
    expect(g.rowCount).toBe(1);
    // Versão gravada SEM citar a coluna (o binário anterior) nasce sem reserva.
    const legado = await withTx(app, ctxVendas(), async (tx) => {
      seq += 1;
      const top = (await tx.query<{ id: string }>("insert into erp.tipos_operacao (organization_id, codigo, codigo_base) values ($1,$2,$3) returning id", [demo.orgId, `RE${seq}`, FAMILIA_PEDIDO])).rows[0]!.id;
      return (await tx.query<{ reserva_estoque: boolean }>("insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome) values ($1,$2,1,'Legado') returning reserva_estoque", [demo.orgId, top])).rows[0]!.reserva_estoque;
    });
    expect(legado).toBe(false);
  });

  it("BR1 gatilho de família (papel da aplicação): true fora do pedido é recusado sem efeito; pedido aceita", async () => {
    const antes = Number((await db.query<{ n: string }>("select count(*)::text n from erp.tipos_operacao where organization_id=$1", [demo.orgId])).rows[0]!.n);
    await expect(criarTop(FAMILIA_ORCAMENTO, true)).rejects.toThrow("VALIDATION_ERROR: so a familia pedido pode reservar estoque");
    await expect(criarTop(FAMILIA_VENDA, true)).rejects.toThrow("VALIDATION_ERROR: so a familia pedido pode reservar estoque");
    // A recusa não deixou TOP nem versão: a transação inteira voltou.
    expect(Number((await db.query<{ n: string }>("select count(*)::text n from erp.tipos_operacao where organization_id=$1", [demo.orgId])).rows[0]!.n)).toBe(antes);
    // PREMISSA: as mesmas famílias SEM reserva passam — a recusa acima é da reserva, não da TOP.
    await criarTop(FAMILIA_ORCAMENTO, false);
    await criarTop(FAMILIA_VENDA, false);
    const ok = await criarTop(FAMILIA_PEDIDO, true);
    expect((await db.query("select reserva_estoque from erp.tipos_operacao_versoes where id=$1", [ok.versao])).rows).toEqual([{ reserva_estoque: true }]);
    // A versão é imutável (0020): não há como ligar a reserva depois, por UPDATE, numa família errada.
    await expect(db.query("update erp.tipos_operacao_versoes set reserva_estoque=false where id=$1", [ok.versao])).rejects.toThrow(/TIPO_OPERACAO_VERSAO_IMUTAVEL/);
  });
});

describe("BR2 — a conta (A + B) pela porta exposta", () => {
  it("BR2 pedido com reserva: 10 → 10; o mesmo pedido excluído → 0; pedido SEM reserva e orçamento com a versão que reserva → 0", async () => {
    const par = await novoPar();
    expect(await reservado(par), "par novo começa sem reserva").toBe("0.0000");
    const p = await pedido(par, "10");
    expect(await reservado(par)).toBe("10.0000");
    expect(await reservado(par, p.id), "o pedido que salva não conta a parte A dele").toBe("0.0000");

    const par2 = await novoPar();
    await pedido(par2, "7", pedidoSemReserva);
    expect(await reservado(par2), "pedido de versão sem reserva não reserva").toBe("0.0000");
    // Orçamento que cita a MESMA versão que reserva (a FK não impede) nunca reserva: a conta é só de pedido.
    const orc = await documento("budget", { top: pedidoComReserva });
    await item(orc, par2, "5");
    expect(await reservado(par2)).toBe("0.0000");
    // PREMISSA: o mesmo par passa a reservar com um pedido da versão que reserva — o zero acima não é do par.
    await pedido(par2, "2");
    expect(await reservado(par2)).toBe("2.0000");
  });

  it("BR2 partes: A 6 + B 4 = 10; venda confirmada sai de B; venda cancelada volta a A; excluir a venda tira a B dela", async () => {
    const par = await novoPar();
    const p = await pedido(par, "10");
    const v1 = await documento("sale", { origem: p.id });
    await item(v1, par, "4", p.item);
    expect(await reservado(par), "converter move de A para B sem mudar o total").toBe("10.0000");
    expect(await reservado(par, v1), "sem a B da própria venda: só A (10 − 4)").toBe("6.0000");
    expect(await reservado(par, p.id), "sem a A do pedido: só a B da parte").toBe("4.0000");

    await situacao(v1, "confirmed");
    expect(await reservado(par), "venda confirmada: a parte saiu de B e não volta a A").toBe("6.0000");

    const v2 = await documento("sale", { origem: p.id });
    await item(v2, par, "3", p.item);
    expect(await reservado(par)).toBe("6.0000");
    expect(await reservado(par, v2)).toBe("3.0000");
    await situacao(v2, "cancelled");
    expect(await reservado(par), "venda cancelada: a parte volta a A (pedido aberto)").toBe("6.0000");
    expect(await reservado(par, v2), "e já não é B de ninguém").toBe("6.0000");
  });

  it("BR2 conversão inteira: pedido 'converted' sai de A, a venda aberta gerada dele é B; confirmada → 0; 'invoiced' também não conta", async () => {
    const par = await novoPar();
    const p = await pedido(par, "10", pedidoComReserva, "converted");
    expect(await reservado(par), "pedido convertido não é A").toBe("0.0000");
    const v = await documento("sale", { origem: p.id });
    await item(v, par, "10");                     // conversão inteira: sem ligação de item
    expect(await reservado(par)).toBe("10.0000");
    await situacao(v, "approved");
    expect(await reservado(par), "'approved' é aberta").toBe("10.0000");
    await situacao(v, "invoiced");
    expect(await reservado(par)).toBe("0.0000");
    await situacao(v, "confirmed");
    expect(await reservado(par)).toBe("0.0000");
  });

  it("BR2 venda aberta gerada de pedido SEM reserva não conta; pedido 'approved' conta; cancelado e saldo encerrado tiram A (a B aberta fica)", async () => {
    const par = await novoPar();
    const semReserva = await pedido(par, "9", pedidoSemReserva, "converted");
    const v = await documento("sale", { origem: semReserva.id });
    await item(v, par, "9");
    expect(await reservado(par)).toBe("0.0000");

    const aprovado = await pedido(par, "5", pedidoComReserva, "approved");
    expect(await reservado(par)).toBe("5.0000");
    await situacao(aprovado.id, "cancelled");
    expect(await reservado(par), "pedido cancelado não reserva").toBe("0.0000");

    const p = await pedido(par, "8");
    const parte = await documento("sale", { origem: p.id });
    await item(parte, par, "3", p.item);
    expect(await reservado(par)).toBe("8.0000");
    await db.query("update erp.sales_documents set saldo_encerrado_em=now(), saldo_encerrado_por=$2, saldo_encerrado_motivo='teste' where id=$1", [p.id, demo.adminUserId]);
    expect(await reservado(par), "saldo encerrado tira A (5); a parte aberta continua B (3)").toBe("3.0000");
  });

  it("BR2 documento excluído (deleted_at) não conta — nem pedido, nem venda aberta", async () => {
    const par = await novoPar();
    const p = await pedido(par, "10");
    const v = await documento("sale", { origem: p.id });
    await item(v, par, "4", p.item);
    expect(await reservado(par)).toBe("10.0000");
    await db.query("update erp.sales_documents set deleted_at=now() where id=$1", [v]);
    expect(await reservado(par), "a venda excluída não é B; a parte dela continua fora de A (a 0034 conta por situação)").toBe("6.0000");
    await db.query("update erp.sales_documents set deleted_at=now() where id=$1", [p.id]);
    expect(await reservado(par)).toBe("0.0000");
  });

  it("BR2 produto SEM controle de estoque fica fora de A e de B; o controlado do MESMO pedido e armazém conta cheio", async () => {
    const servico = await produtoSemControle();
    expect((await db.query("select control_stock from erp.products where id=$1 and organization_id=$2", [servico, demo.orgId])).rows,
      "PREMISSA: o produto é da organização e não controla estoque").toEqual([{ control_stock: false }]);
    const controlado = await novoPar(produtoA);
    const semControle: Par = { w: controlado.w, p: servico };   // COM armazém, o mesmo do controlado
    const o = await documento("order", { top: pedidoComReserva });
    const itemControlado = await item(o, controlado, "10");
    const itemServico = await item(o, semControle, "5");
    // PREMISSA: o pedido reserva — o par do controlado recebe a quantidade cheia; o zero do serviço é do produto.
    expect(await reservado(controlado)).toBe("10.0000");
    expect(await reservado(semControle), "A: produto sem controle não reserva").toBe("0.0000");

    // Parte B: venda aberta gerada do pedido, com os dois itens.
    const v = await documento("sale", { origem: o });
    await item(v, controlado, "4", itemControlado);
    await item(v, semControle, "2", itemServico);
    expect(await reservado(controlado), "A 6 + B 4").toBe("10.0000");
    expect(await reservado(controlado, o), "PREMISSA: sem a A do pedido, a B do controlado conta").toBe("4.0000");
    expect(await reservado(semControle, o), "B: item sem controle da venda aberta não reserva").toBe("0.0000");
    expect(await reservado(semControle)).toBe("0.0000");
    // O núcleo (o que o gatilho de saída lê) responde o mesmo, os dois pares numa chamada.
    const n = await db.query<{ product_id: string; reservado: string }>(
      "select product_id, reservado from erp.reserva_estoque_nucleo($1, $2::uuid[], $3::uuid[], null) order by reservado desc",
      [demo.orgId, [controlado.w, semControle.w], [controlado.p, semControle.p]]);
    expect(n.rows).toEqual([{ product_id: controlado.p, reservado: "10.0000" }, { product_id: servico, reservado: "0.0000" }]);
  });

  it("BR2 o par é armazém E produto; a organização vem de quem pergunta", async () => {
    const par = await novoPar(produtoA);
    await pedido(par, "4");
    expect(await reservado({ w: par.w, p: produtoB }), "outro produto no mesmo armazém").toBe("0.0000");
    const outroArmazem = await novoPar(produtoA);
    expect(await reservado(outroArmazem), "o mesmo produto em outro armazém").toBe("0.0000");
    // O núcleo (só o dono chama) com OUTRA organização não enxerga a reserva desta.
    const nucleo = (org: string) => db.query<{ reservado: string }>("select reservado from erp.reserva_estoque_nucleo($1, array[$2]::uuid[], array[$3]::uuid[], null)", [org, par.w, par.p]);
    expect((await nucleo(demo.orgId)).rows).toEqual([{ reservado: "4.0000" }]);
    expect((await nucleo(randomUUID())).rows).toEqual([{ reservado: "0.0000" }]);
  });
});

describe("BR3 — a porta exposta é estreita", () => {
  async function usuarioComPapel(nome: string, chaves: string[]): Promise<string> {
    const papel = (await db.query<{ id: string }>("insert into erp.roles (organization_id, name) values ($1,$2) returning id", [demo.orgId, nome])).rows[0]!.id;
    for (const k of chaves) await db.query("insert into erp.role_permissions (role_id, permission_key) values ($1,$2)", [papel, k]);
    const u = (await db.query<{ id: string }>("insert into erp.users (email, name, password_hash) values ($1,$2,'x') returning id", [`${randomUUID()}@reserva.local`, nome])).rows[0]!.id;
    await db.query("insert into erp.organization_members (organization_id, user_id, role_id, is_owner) values ($1,$2,$3,false)", [demo.orgId, u, papel]);
    return u;
  }

  it("BR3 sem capacidade de estoque nem de venda → zero linhas; com qualquer uma delas → uma linha", async () => {
    const par = await novoPar();
    await pedido(par, "5");
    const semCapacidade = await usuarioComPapel("Reserva sem capacidade", ["products.view"]);
    const soVenda = await usuarioComPapel("Reserva so venda", ["sales.view"]);
    const soPedido = await usuarioComPapel("Reserva so pedido", ["orders.create"]);
    // PREMISSA: quem tem capacidade enxerga a reserva do par — o zero abaixo é da capacidade, não do par.
    expect(await porta([par])).toEqual([{ warehouse_id: par.w, product_id: par.p, reservado: "5.0000" }]);
    expect(await porta([par], null, ctxVendas(semCapacidade))).toEqual([]);
    expect(await porta([par], null, ctxVendas(soVenda))).toEqual([{ warehouse_id: par.w, product_id: par.p, reservado: "5.0000" }]);
    expect(await porta([par], null, ctxVendas(soPedido))).toEqual([{ warehouse_id: par.w, product_id: par.p, reservado: "5.0000" }]);
    // Usuário que não é membro da organização da GUC, e transação sem organização: zero.
    expect(await porta([par], null, ctxVendas(randomUUID()))).toEqual([]);
    expect(await porta([par], null, { orgId: null, userId: demo.adminUserId, modulo: "vendas" })).toEqual([]);
  });

  it("BR3 uma linha por par distinto e não nulo; tamanhos diferentes, mais de 1000 pares ou nulo → zero linhas", async () => {
    const a = await novoPar(produtoA);
    const b = { w: a.w, p: produtoB };
    await pedido(a, "3");
    const r = await porta([a, a, b, { w: null, p: produtoA }, { w: a.w, p: null }]);
    expect(r).toEqual([a, b].map((x) => ({ warehouse_id: x.w, product_id: x.p, reservado: x === a ? "3.0000" : "0.0000" }))
      .sort((x, y) => (x.product_id < y.product_id ? -1 : 1)));
    const desiguais = await withTx(app, ctxVendas(), async (tx) => (await tx.query("select * from erp.reserva_estoque($1::uuid[], $2::uuid[])", [[a.w, a.w], [a.p]])).rows);
    expect(desiguais).toEqual([]);
    const mil = Array.from({ length: 1001 }, () => a);
    expect(await porta(mil)).toEqual([]);
    expect((await porta(mil.slice(0, 1000))).length, "PREMISSA: 1000 pares iguais ainda respondem (um par distinto)").toBe(1);
    const nulos = await withTx(app, ctxVendas(), async (tx) => (await tx.query("select * from erp.reserva_estoque(null, null)")).rows);
    expect(nulos).toEqual([]);
  });

  it("BR3 o papel da aplicação NÃO executa o núcleo nem a guarda; só a porta; ninguém além do dono executa o resto", async () => {
    const par = await novoPar();
    await expect(withTx(app, ctxVendas(), (tx) => tx.query("select * from erp.reserva_estoque_nucleo($1, array[$2]::uuid[], array[$3]::uuid[], null)", [demo.orgId, par.w, par.p])))
      .rejects.toThrow(/permission denied for function reserva_estoque_nucleo/);
    await expect(withTx(app, ctxVendas(), (tx) => tx.query("select erp.stock_movement_reserva_guarda()")))
      .rejects.toThrow(/permission denied for function stock_movement_reserva_guarda/);
    // PREMISSA: o mesmo papel executa a porta.
    expect(await porta([par])).toHaveLength(1);
    const acl = await db.query<{ proname: string; grantees: string[] }>(
      `select p.proname, array_agg(case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end order by x.grantee) grantees
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
        where n.nspname='erp' and x.privilege_type='EXECUTE' and x.grantee <> p.proowner
          and p.proname in ('reserva_estoque','reserva_estoque_nucleo','stock_movement_reserva_guarda','tipos_operacao_versao_reserva_familia')
        group by p.proname order by p.proname`);
    expect(acl.rows).toEqual([{ proname: "reserva_estoque", grantees: ["erp_app"] }]);
    const def = await db.query<{ proname: string; prosecdef: boolean; config: string }>(
      `select p.proname, p.prosecdef, array_to_string(p.proconfig, ';') config from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='erp' and p.proname in ('reserva_estoque','reserva_estoque_nucleo','stock_movement_reserva_guarda') order by 1`);
    expect(def.rows.every((x) => x.prosecdef && /search_path=erp, pg_temp/.test(x.config))).toBe(true);
    expect(def.rowCount).toBe(3);
  });
});

describe("BR4 — a invariante na saída (gatilho)", () => {
  it("BR4 saída que invade a reserva é recusada com a mensagem; dentro do disponível passa; nada muda na recusa", async () => {
    const par = await novoPar();
    await entrada(par, "10");
    await pedido(par, "6");
    await expect(saida(par, "5")).rejects.toThrow(INSUFICIENTE("4", "5", "6"));
    expect(await fisico(par), "a recusa desfez a baixa").toBe("10.0000");
    await saida(par, "4");                                   // sobra 6 = reservado: passa
    expect(await fisico(par)).toBe("6.0000");
    await expect(saida(par, "0.5")).rejects.toThrow(INSUFICIENTE("0", "0,5", "6"));
    await expect(saida(par, "1", { tipo: "writeoff", origemTipo: "stock_writeoffs" })).rejects.toThrow(INSUFICIENTE("0", "1", "6"));
    await expect(saida(par, "1", { tipo: "transfer_out", origemTipo: "warehouse_transfers" })).rejects.toThrow(INSUFICIENTE("0", "1", "6"));
    expect(await fisico(par)).toBe("6.0000");
    // ENTRADA nunca é conferida: repõe e libera.
    await entrada(par, "2");
    await saida(par, "2");
    expect(await fisico(par)).toBe("6.0000");
  });

  it("BR4 acerto de inventário (correction_out) e estorno (reversal) passam mesmo invadindo; depois nenhuma saída comum passa", async () => {
    const par = await novoPar();
    await entrada(par, "10");
    await pedido(par, "8");
    await saida(par, "3", { tipo: "correction_out", origemTipo: "stock_corrections" });
    expect(await fisico(par), "disponível pode ficar negativo (7 − 8)").toBe("7.0000");
    await saida(par, "1", { tipo: "reversal", origemTipo: "stock_movements" });
    expect(await fisico(par)).toBe("6.0000");
    await expect(saida(par, "0.0001")).rejects.toThrow(INSUFICIENTE("-2", "0,0001", "8"));
  });

  it("BR4 saída da VENDA não conta a parte B dela; source_id de outro documento (ou de pedido) não exclui nada", async () => {
    const par = await novoPar();
    await entrada(par, "10");
    const p = await pedido(par, "10", pedidoComReserva, "converted");
    const v = await documento("sale", { origem: p.id });
    await item(v, par, "10");
    expect(await reservado(par)).toBe("10.0000");
    await expect(saida(par, "1", { tipo: "sale", origemTipo: "sales_documents", origemId: randomUUID() })).rejects.toThrow(INSUFICIENTE("0", "1", "10"));
    await expect(saida(par, "1", { tipo: "sale", origemTipo: "sales_documents", origemId: p.id })).rejects.toThrow(INSUFICIENTE("0", "1", "10"));
    await expect(saida(par, "1", { tipo: "requisition", origemTipo: "requisitions", origemId: v })).rejects.toThrow(INSUFICIENTE("0", "1", "10"));
    await saida(par, "10", { tipo: "sale", origemTipo: "sales_documents", origemId: v });
    expect(await fisico(par)).toBe("0.0000");

    // Pedido ABERTO (a reserva é A dele): uma saída com source_id = o PEDIDO não tira a reserva dele da conta — só
    // a venda que sai exclui a própria B. (Com a exclusão por qualquer source_id, esta saída passaria.)
    const par2 = await novoPar();
    await entrada(par2, "10");
    const aberto = await pedido(par2, "10");
    expect(await reservado(par2, aberto.id), "PREMISSA: excluir o pedido zeraria a conta").toBe("0.0000");
    await expect(saida(par2, "1", { tipo: "sale", origemTipo: "sales_documents", origemId: aberto.id })).rejects.toThrow(INSUFICIENTE("0", "1", "10"));
    expect(await fisico(par2)).toBe("10.0000");
  });

  it("BR4 a venda que é PARTE: sai a parte dela, o resto do pedido (A) continua protegido", async () => {
    const par = await novoPar();
    await entrada(par, "10");
    const p = await pedido(par, "10");
    const v = await documento("sale", { origem: p.id });
    await item(v, par, "4", p.item);
    await saida(par, "4", { tipo: "sale", origemTipo: "sales_documents", origemId: v });
    expect(await fisico(par)).toBe("6.0000");
    await expect(saida(par, "0.0001", { tipo: "sale", origemTipo: "sales_documents", origemId: v })).rejects.toThrow(INSUFICIENTE("0", "0,0001", "6"));
  });

  it("BR4 produto com lote: o físico é a soma de TODOS os lotes do armazém, nunca o do lote que sai", async () => {
    const par = await novoPar(produtoLote);
    await entrada(par, "6", "L1");
    await entrada(par, "4", "L2");
    await pedido(par, "7");
    await saida(par, "3", { lote: "L1" });                    // L1 fica 3 (< 7), mas o armazém fica 7 = reservado
    expect(await fisico(par)).toBe("7.0000");
    await expect(saida(par, "0.5", { lote: "L2" })).rejects.toThrow(INSUFICIENTE("0", "0,5", "7"));
    expect((await db.query("select provider_lot, quantity from erp.stock_balances where warehouse_id=$1 and product_id=$2 order by 1", [par.w, par.p])).rows)
      .toEqual([{ provider_lot: "L1", quantity: "3.0000" }, { provider_lot: "L2", quantity: "4.0000" }]);
  });
});

describe("BR5 — ordem dos gatilhos em erp.stock_movements", () => {
  it("BR5 trg_stock_movement_apply é BEFORE INSERT ROW; trg_stock_movement_reserva é AFTER INSERT ROW (roda depois de todo BEFORE)", async () => {
    const r = await db.query<{ tgname: string; antes: boolean; linha: boolean; insercao: boolean; ligado: string; funcao: string }>(
      `select tgname, (tgtype & 2) = 2 antes, (tgtype & 1) = 1 linha, (tgtype & 4) = 4 insercao, tgenabled ligado, tgfoid::regprocedure::text funcao
         from pg_trigger where tgrelid='erp.stock_movements'::regclass and tgname in ('trg_stock_movement_apply','trg_stock_movement_reserva') order by tgname`);
    expect(r.rows).toEqual([
      { tgname: "trg_stock_movement_apply", antes: true, linha: true, insercao: true, ligado: "O", funcao: "erp.apply_stock_movement()" },
      { tgname: "trg_stock_movement_reserva", antes: false, linha: true, insercao: true, ligado: "O", funcao: "erp.stock_movement_reserva_guarda()" },
    ]);
    const def = (await db.query<{ def: string }>("select pg_get_triggerdef(oid) def from pg_trigger where tgrelid='erp.stock_movements'::regclass and tgname='trg_stock_movement_reserva'")).rows[0]!.def;
    expect(def).toContain("WHEN (((new.direction = '-1'::integer) AND (new.movement_type <> ALL (ARRAY['correction_out'::text, 'reversal'::text]))))");
    // A guarda é VOLÁTIL: foto nova por instrução (com `stable`, BR4 e BR6 ficam vermelhos — verificação reversa).
    expect((await db.query("select provolatile from pg_proc where oid='erp.stock_movement_reserva_guarda()'::regprocedure")).rows).toEqual([{ provolatile: "v" }]);
  });
});

describe("BR6 — concorrência: pedido × saída do mesmo produto (READ COMMITTED)", () => {
  async function abrir(ctx: TenantContext): Promise<{ c: Tx; pid: number }> {
    const c = await app.connect();
    await c.query("begin");
    await c.query("select set_config('app.org_id',$1,true), set_config('app.user_id',$2,true), set_config('app.modulo_empresa',$3,true)", [ctx.orgId, ctx.userId, ctx.modulo]);
    const pid = (await c.query<{ pid: number }>("select pg_backend_pid() pid")).rows[0]!.pid;
    return { c, pid };
  }
  async function esperaPor(bloqueado: number, quem: number): Promise<void> {
    for (let i = 0; i < 250; i++) {
      const r = await db.query<{ b: number[] }>("select pg_blocking_pids($1) b", [bloqueado]);
      if (r.rows[0]!.b.includes(quem)) return;
      await new Promise((ok) => setTimeout(ok, 20));
    }
    throw new Error(`o processo ${bloqueado} não chegou a esperar ${quem}`);
  }
  const TRAVA_PRODUTO = "select id from erp.products where organization_id=$1 and id = any($2::uuid[]) order by id for update";

  it("BR6 a saída que esperou a trava do produto enxerga o pedido que comitou nesse meio-tempo — e sem o commit, passa", async () => {
    for (const commitDoPedido of [false, true]) {
      const par = await novoPar();
      await entrada(par, "10");
      const P = await abrir(ctxVendas());
      const M = await abrir(ctxEstoque());
      try {
        await P.c.query(TRAVA_PRODUTO, [demo.orgId, [par.p]]);
        expect(await reservado(par), "quando a saída começa, nada está reservado").toBe("0.0000");
        const baixa = M.c.query(MOVIMENTO, paramsMov(par, "5", { direcao: -1 })).then(() => null, (e: Error) => e);
        await esperaPor(M.pid, P.pid);                        // a saída está parada na linha do produto que o pedido travou
        const doc = (await P.c.query<{ id: string }>(
          `insert into erp.sales_documents (organization_id, empresa_id, kind, code, document_date, client_id, status, tipo_operacao_id, tipo_operacao_versao_id)
           values ($1,$2,'order',$3,'2026-09-01',$4,'open',$5,$6) returning id`,
          [demo.orgId, empresa, `RE-C-${++seq}`, cliente, pedidoComReserva.top, pedidoComReserva.versao])).rows[0]!.id;
        await P.c.query("insert into erp.sales_document_items (document_id, product_id, warehouse_id, quantity, unit_price, total, position) values ($1,$2,$3,8,10,0,0)", [doc, par.p, par.w]);
        await P.c.query(commitDoPedido ? "commit" : "rollback");
        const erro = await baixa;
        if (commitDoPedido) {
          expect(erro?.message, "a conta da guarda tirou foto DEPOIS da espera").toBe(INSUFICIENTE("2", "5", "8"));
          await M.c.query("rollback");
          expect(await fisico(par)).toBe("10.0000");
          expect(await reservado(par)).toBe("8.0000");
        } else {
          expect(erro, "PREMISSA: sem o pedido comitado a mesma saída passa").toBeNull();
          await M.c.query("commit");
          expect(await fisico(par)).toBe("5.0000");
        }
      } finally {
        await P.c.query("rollback").catch(() => {}); await M.c.query("rollback").catch(() => {});
        P.c.release(); M.c.release();
      }
    }
  });

  it("BR6 o pedido que esperou a trava do produto lê o físico DEPOIS da saída comitada", async () => {
    const par = await novoPar();
    await entrada(par, "10");
    const M = await abrir(ctxEstoque());
    const P = await abrir(ctxVendas());
    try {
      await M.c.query(MOVIMENTO, paramsMov(par, "5", { direcao: -1 }));   // a saída segura a linha do produto
      const trava = P.c.query(TRAVA_PRODUTO, [demo.orgId, [par.p]]).then(() => null, (e: Error) => e);
      await esperaPor(P.pid, M.pid);
      await M.c.query("commit");
      expect(await trava).toBeNull();
      const lido = (await P.c.query<{ q: string }>("select coalesce(sum(quantity),0)::text q from erp.stock_balances where organization_id=$1 and warehouse_id=$2 and product_id=$3",
        [demo.orgId, par.w, par.p])).rows[0]!.q;
      expect(lido, "a instrução depois da trava tira foto nova").toBe("5.0000");
    } finally {
      await P.c.query("rollback").catch(() => {}); await M.c.query("rollback").catch(() => {});
      P.c.release(); M.c.release();
    }
  });
});
