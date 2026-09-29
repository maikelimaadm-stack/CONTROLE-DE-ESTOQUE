import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { configuracaoNeutraTopV3 } from "@agro/domain";
import { harness, ids, TEST_URL, escoposDeTodosOsModulos, type Harness } from "./setup.js";

/**
 * COMPRAS-01 (decisão 267) — A1: LANÇAR, LISTAR, CONSULTAR e CANCELAR o documento de compra ABERTO, e as recusas
 * do lançamento. A confirmação e o estorno são de outra suíte. As provas decisivas são lidas no BANCO por conexão
 * própria (documento, itens, ID Global, trilha), não só na resposta.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
let topCompra: string; let topPedido: string; let topVenda: string; let categoriaDespesa: string; let transportadora: string;

type Resposta = { statusCode: number; body: string; json: () => unknown };
type Erro = { code: string; message: string; details?: { path: string; message: string }[] | Record<string, unknown> };
const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: Erro };

let seq = 0;
async function criarTop(codigoBase: string, nome: string): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: `CA1${String(++seq).padStart(2, "0")}`, codigoBase, nome } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}

const base = (o: Record<string, unknown> = {}) => ({
  empresa_id: I.empresa, tipo_operacao_id: topCompra, fornecedor_id: I.provider, data_documento: "2026-09-10",
  frete: "10", outras_despesas: "5", desconto: "2",
  itens: [{ produto_id: I.product, armazem_id: I.warehouse, quantidade: "4", valor_unitario: "12.5", desconto: "1" }],
  ...o,
});
const lancar = (segmento: "compras" | "pedidos", payload: unknown, headers: Record<string, string> = h.headers()) =>
  h.app.inject({ method: "POST", url: `/api/compras/${segmento}`, headers, payload: payload as Record<string, unknown> });

beforeAll(async () => {
  h = await harness();
  I = await ids(h);
  admin = createPool(TEST_URL, { max: 2 });
  topCompra = await criarTop("compras.compra", "Compra A1");
  topPedido = await criarTop("compras.pedido", "Pedido de compra A1");
  topVenda = await criarTop("vendas.venda", "Venda A1");
  categoriaDespesa = I.category!;
  transportadora = (await admin.query<{ id: string }>("update erp.people set is_transporter=true where id=(select id from erp.people where organization_id=$1 and is_provider order by code desc limit 1) returning id", [h.demo.orgId])).rows[0]!.id;
}, 180_000);
afterAll(async () => { await admin?.end(); await h.app.close(); await h.db.end(); });

describe("lançar", () => {
  it("compra: 201, TOP e versão congeladas, número, ID Global, totais do servidor, trilha", async () => {
    const r = await lancar("compras", base({ numero_nota: "A1-100", serie_nota: "", categoria_financeira_id: categoriaDespesa, centro_custo_id: I.costCenter, transportadora_id: transportadora }), h.headers({ "idempotency-key": "a1-lancar-1" }));
    expect(r.statusCode, r.body).toBe(201);
    const b = j(r);
    // 4 × 12,50 − 1 = 49; + 10 + 5 − 2 = 62
    expect(b).toMatchObject({ especie: "compra", situacao: "aberto", valor_itens: "49.00", valor_total: "62.00" });
    const d = (await admin.query("select d.*, v.versao from erp.documentos_compra d join erp.tipos_operacao_versoes v on v.id=d.tipo_operacao_versao_id where d.id=$1", [b.id])).rows[0] as Record<string, unknown>;
    expect(d).toMatchObject({ tipo_operacao_id: topCompra, codigo: b.codigo, valor_total: "62.00", situacao: "aberto", serie_nota: null, numero_nota: "A1-100" });
    const idg = await admin.query("select 1 from erp.registros_globais where tipo_entidade='documentos_compra' and id_entidade=$1", [b.id]);
    expect(idg.rowCount).toBe(1);
    // a trilha do serviço (com a TOP congelada); o gatilho erp.audit_row grava linhas próprias, sem metadata
    const aud = await admin.query("select action, metadata from erp.audit_logs where entity='documentos_compra' and entity_id=$1 and metadata is not null", [b.id]);
    expect(aud.rows.map((x) => x.action)).toEqual(["create"]);
    expect(aud.rows[0]!.metadata).toMatchObject({ especie: "compra", tipoOperacaoId: topCompra });
    // replay idempotente: mesma resposta, nenhum documento a mais
    const antes = Number((await admin.query("select count(*) n from erp.documentos_compra")).rows[0]!.n);
    const r2 = await lancar("compras", base({ numero_nota: "A1-100", serie_nota: "", categoria_financeira_id: categoriaDespesa, centro_custo_id: I.costCenter, transportadora_id: transportadora }), h.headers({ "idempotency-key": "a1-lancar-1" }));
    expect(r2.statusCode).toBe(201); expect(j(r2).id).toBe(b.id);
    expect(Number((await admin.query("select count(*) n from erp.documentos_compra")).rows[0]!.n)).toBe(antes);
  });

  it("pedido: 201 com a TOP do pedido; TOP de outra família → 422", async () => {
    const r = await lancar("pedidos", base({ tipo_operacao_id: topPedido }));
    expect(r.statusCode, r.body).toBe(201);
    expect(j(r).especie).toBe("pedido");
    for (const [seg, top] of [["pedidos", topCompra], ["compras", topPedido], ["compras", topVenda]] as const) {
      const x = await lancar(seg, base({ tipo_operacao_id: top }));
      expect(x.statusCode, x.body).toBe(422);
      expect(j(x).error!.code).toBe("TIPO_OPERACAO_INDISPONIVEL");
    }
  });

  it("recusas no campo (422)", async () => {
    const casos: [string, Record<string, unknown>, string][] = [
      ["compras", { fornecedor_id: I.client }, "fornecedor_id"],
      ["compras", { transportadora_id: I.client }, "transportadora_id"],
      ["compras", { categoria_financeira_id: I.incomeCategory, centro_custo_id: I.costCenter }, "categoria_financeira_id"],
      ["compras", { categoria_financeira_id: categoriaDespesa }, "centro_custo_id"],
      ["compras", { itens: [{ produto_id: I.product, armazem_id: I.warehouseEmpresa2, quantidade: "1", valor_unitario: "1" }] }, "itens[0].armazem_id"],
      ["compras", { itens: [{ produto_id: I.productLot, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "1" }] }, "itens[0].lote"],
      ["pedidos", { tipo_operacao_id: topPedido, numero_nota: "9" }, "numero_nota"],
      ["pedidos", { tipo_operacao_id: topPedido, itens: [{ produto_id: I.product, quantidade: "1", valor_unitario: "1", lote: "L1" }] }, "itens[0].lote"],
    ];
    for (const [seg, o, campo] of casos) {
      const r = await lancar(seg as "compras", base(o));
      expect(r.statusCode, `${campo}: ${r.body}`).toBe(422);
      const det = j(r).error!.details as { path: string }[];
      expect(det[0]!.path, r.body).toBe(campo);
    }
    // chave desconhecida → 422 (contrato estrito), no cabeçalho e no item
    expect((await lancar("compras", base({ nota: "1" }))).statusCode).toBe(422);
    expect((await lancar("compras", base({ itens: [{ produto_id: I.product, quantidade: "1", valor_unitario: "1", preco: "1" }] }))).statusCode).toBe(422);
    // produto com lote e lote informado → passa; sem armazém (não entra no estoque) → passa
    expect((await lancar("compras", base({ itens: [{ produto_id: I.productLot, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "1", lote: "L-A1", validade: "2027-01-01" }] }))).statusCode).toBe(201);
    expect((await lancar("compras", base({ itens: [{ produto_id: I.productLot, quantidade: "1", valor_unitario: "1" }] }))).statusCode).toBe(201);
  });

  it("nota duplicada → 409 dizendo a Compra", async () => {
    const a = await lancar("compras", base({ numero_nota: "A1-DUP", serie_nota: "1" }));
    expect(a.statusCode, a.body).toBe(201);
    const b = await lancar("compras", base({ numero_nota: " A1-DUP", serie_nota: "" }));
    expect(b.statusCode, b.body).toBe(409);
    expect(j(b).error!.code).toBe("DUPLICATE_DOCUMENT");
    expect(j(b).error!.message).toContain(`Compra ${j(a).codigo as string}`);
  });
});

describe("consultar, listar, cancelar", () => {
  it("GET :id amarrado à espécie; outra espécie, malformado e outra organização → mesma 404", async () => {
    const c = j(await lancar("compras", base()));
    const g = await h.app.inject({ method: "GET", url: `/api/compras/compras/${c.id as string}`, headers: h.headers() });
    expect(g.statusCode, g.body).toBe(200);
    const d = j(g) as Record<string, unknown> & { itens: Record<string, unknown>[]; tipo_operacao: Record<string, unknown> };
    expect(d).toMatchObject({ id: c.id, especie: "compra", situacao: "aberto", titulos: [], movimentos: [] });
    expect(d.fornecedor_nome).toBeTruthy(); expect(d.empresa_nome).toBeTruthy();
    expect(d.tipo_operacao).toMatchObject({ id: topCompra, codigoBase: "compras.compra", versao: 1 });
    expect(d.itens[0]).toMatchObject({ valor_total: "49.00", posicao: 0 });
    expect(d.itens[0]!.produto_nome).toBeTruthy(); expect(d.itens[0]!.armazem_nome).toBeTruthy();
    for (const url of [`/api/compras/pedidos/${c.id as string}`, "/api/compras/compras/nao-e-uuid", "/api/compras/compras/00000000-0000-4000-8000-000000000000"]) {
      const x = await h.app.inject({ method: "GET", url, headers: h.headers() });
      expect(x.statusCode, url).toBe(404);
    }
  });

  it("lista por espécie e lista única: filtros, totais e ID Global", async () => {
    const l = await h.app.inject({ method: "GET", url: "/api/compras/compras?pageSize=100", headers: h.headers() });
    expect(l.statusCode, l.body).toBe(200);
    const lb = j(l) as { items: { especie: string }[]; total: number; totals: { valor_total: string }; idGlobal: unknown };
    expect(lb.items.length).toBeGreaterThan(0);
    expect(lb.items.every((x) => x.especie === "compra")).toBe(true);
    expect(lb.idGlobal).toMatchObject({ tipoEntidade: "documentos_compra" });
    const u = j(await h.app.inject({ method: "GET", url: "/api/compras/documentos?pageSize=100", headers: h.headers() })) as { items: { especie: string; id_global?: unknown }[]; total: number };
    expect(new Set(u.items.map((x) => x.especie))).toEqual(new Set(["compra", "pedido"]));
    const soPedidos = j(await h.app.inject({ method: "GET", url: "/api/compras/documentos?especie=pedido", headers: h.headers() })) as { items: { especie: string }[] };
    expect(soPedidos.items.length).toBeGreaterThan(0);
    expect(soPedidos.items.every((x) => x.especie === "pedido")).toBe(true);
    const um = j(await h.app.inject({ method: "GET", url: "/api/compras/documentos?limit=1&start_date=2026-09-01&end_date=2026-09-30", headers: h.headers() })) as { items: unknown[]; total: number };
    expect(um.items.length).toBe(1); expect(um.total).toBeGreaterThan(1);
    const nada = j(await h.app.inject({ method: "GET", url: "/api/compras/documentos?especie=venda&fornecedor_id=xyz", headers: h.headers() })) as { total: number };
    expect(nada.total).toBe(0);
  });

  it("lista única: só pedidos_compra.view → só pedidos; nenhuma capacidade → 403", async () => {
    const perfil = async (perms: string[]) => {
      const email = `a1-compras-${perms.join("-") || "nada"}@demo.local`.replace(/[^a-z0-9@.-]/g, "");
      const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `A1 ${email}`, permissions: perms } });
      expect(papel.statusCode, papel.body).toBeLessThan(300);
      const u = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: email, email, password: "Restrito@12345", role_id: j(papel).id, escopos_empresas: escoposDeTodosOsModulos([]) } });
      expect(u.statusCode, u.body).toBeLessThan(300);
      const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Restrito@12345" } });
      expect(login.statusCode, login.body).toBe(200);
      return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
    };
    const soPedido = await perfil(["pedidos_compra.view"]);
    const r = await h.app.inject({ method: "GET", url: "/api/compras/documentos?pageSize=100", headers: soPedido });
    expect(r.statusCode, r.body).toBe(200);
    const b = j(r) as { items: { especie: string }[]; total: number };
    const pedidosNoBanco = Number((await admin.query("select count(*) n from erp.documentos_compra where organization_id=$1 and especie='pedido'", [h.demo.orgId])).rows[0]!.n);
    expect(b.total).toBe(pedidosNoBanco);
    expect(b.items.length).toBe(pedidosNoBanco);
    expect(b.items.every((x) => x.especie === "pedido")).toBe(true);
    // pedir compra explicitamente não alarga
    const pedido = j(await h.app.inject({ method: "GET", url: "/api/compras/documentos?especie=compra", headers: soPedido })) as { total: number };
    expect(pedido.total).toBe(0);
    const nenhum = await perfil(["products.view"]);
    const n = await h.app.inject({ method: "GET", url: "/api/compras/documentos", headers: nenhum });
    expect(n.statusCode, n.body).toBe(403);
  });

  it("cancelar aberto: 200, idempotente, trilha; de novo → 409; motivo com chave desconhecida → 422", async () => {
    const c = j(await lancar("pedidos", base({ tipo_operacao_id: topPedido })));
    const url = `/api/compras/pedidos/${c.id as string}/cancel`;
    expect((await h.app.inject({ method: "POST", url, headers: h.headers(), payload: { razao: "x" } })).statusCode).toBe(422);
    const r = await h.app.inject({ method: "POST", url, headers: h.headers({ "idempotency-key": "a1-cancel-1" }), payload: { motivo: "desistência" } });
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toMatchObject({ id: c.id, situacao: "cancelado" });
    const r2 = await h.app.inject({ method: "POST", url, headers: h.headers({ "idempotency-key": "a1-cancel-1" }), payload: { motivo: "desistência" } });
    expect(r2.statusCode).toBe(200);
    const r3 = await h.app.inject({ method: "POST", url, headers: h.headers() });
    expect(r3.statusCode, r3.body).toBe(409);
    const d = (await admin.query("select situacao from erp.documentos_compra where id=$1", [c.id])).rows[0]!;
    expect(d.situacao).toBe("cancelado");
    const aud = await admin.query("select action, metadata from erp.audit_logs where entity='documentos_compra' and entity_id=$1 and action='cancel'", [c.id]);
    expect(aud.rowCount).toBe(1);
    expect(aud.rows[0]!.metadata).toMatchObject({ motivo: "desistência" });
    // cancelar pela porta da outra espécie → 404
    expect((await h.app.inject({ method: "POST", url: `/api/compras/compras/${c.id as string}/cancel`, headers: h.headers(), payload: {} })).statusCode).toBe(404);
  });

  it("operation-types e regras-da-operacao por espécie (contractVersion 1)", async () => {
    const o = j(await h.app.inject({ method: "GET", url: "/api/compras/compras/operation-types", headers: h.headers() })) as { contractVersion: number; items: { id: string }[]; family: { code: string } };
    expect(o.contractVersion).toBe(1); expect(o.family.code).toBe("compras.compra");
    expect(o.items.map((x) => x.id)).toContain(topCompra); expect(o.items.map((x) => x.id)).not.toContain(topPedido);
    const rg = await h.app.inject({ method: "GET", url: `/api/compras/compras/regras-da-operacao?tipo_operacao_id=${topCompra}`, headers: h.headers() });
    expect(rg.statusCode, rg.body).toBe(200);
    expect(j(rg)).toMatchObject({ contractVersion: 1, exigencias: [], condicoesPermitidas: null });
    expect((await h.app.inject({ method: "GET", url: `/api/compras/pedidos/regras-da-operacao?tipo_operacao_id=${topCompra}`, headers: h.headers() })).statusCode).toBe(404);
  });
});

describe("TOP da compra: cliente em atraso", () => {
  it("≠ \"não valida\" nas famílias de compra → 422 em financeiro.clienteEmAtraso; na venda continua aceito", async () => {
    const cfg = configuracaoNeutraTopV3();
    const bloqueia = { ...cfg, financeiro: { ...cfg.financeiro, clienteEmAtraso: "bloqueia" as const } };
    for (const familia of ["compras.compra", "compras.pedido"]) {
      const r = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(), payload: { codigo: `CA1X${++seq}`, codigoBase: familia, nome: "Atraso", configuracao: bloqueia } });
      expect(r.statusCode, r.body).toBe(422);
      expect(JSON.stringify(j(r).error!.details)).toContain("financeiro.clienteEmAtraso");
      const ok = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(), payload: { codigo: `CA1Y${++seq}`, codigoBase: familia, nome: "Sem atraso", configuracao: cfg } });
      expect(ok.statusCode, ok.body).toBe(201);
    }
    const venda = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(), payload: { codigo: `CA1Z${++seq}`, codigoBase: "vendas.venda", nome: "Venda atraso", configuracao: bloqueia } });
    expect(venda.statusCode, venda.body).toBe(201);
  });
});
