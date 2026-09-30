import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, seedDemo, type Db } from "@agro/db";
import { escoposDeTodosOsModulos, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * ANEXOS-PESQUISA-01 (decisão 271) — item 2.1: documentos de VENDA e de COMPRA como registro-pai de anexo.
 *
 *   AX-1  orçamento, pedido e venda: listar, enviar, baixar e excluir com a permissão da ESPÉCIE; quem tem
 *         sales.view sem budgets.view recebe 403 no anexo do orçamento (a porta é a da linha, não a da tabela);
 *   AX-2  pedido de compra e compra, com pedidos_compra.view e compras.view — e a espécie errada não serve;
 *   AX-3  a MESMA 404, corpo idêntico: inexistente, outra organização, empresa fora do escopo, venda excluída;
 *   AX-4  cancelado e confirmado aceitam anexo (sem regra por situação); o histórico do documento mostra
 *         attachment_added e attachment_removed;
 *   AX-5  entidade fora da whitelist → 422.
 *
 * Os documentos nascem pelas portas oficiais (POST de vendas e de compras); só a exclusão lógica da venda é
 * marcada por conexão própria, porque a porta de venda não exclui — cancela.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
type Hdr = Record<string, string>;
type Resposta = { statusCode: number; body: string; json: () => unknown };
const j = (r: Resposta) => r.json() as Record<string, unknown> & { items?: Record<string, unknown>[]; error?: { code: string } };

const PDF = Buffer.from("%PDF-1.4\n% anexo de teste\n%%EOF\n");
const ANEXOS = ["attachments.view", "attachments.create", "attachments.delete"];
const NAO_ACHADO = "00000000-0000-4000-8000-000000000000";

let orcamento = ""; let pedidoVenda = ""; let venda = ""; let vendaEmpresa2 = ""; let vendaExcluida = "";
let pedidoCompra = ""; let compra = "";
let outraOrg: Hdr;

async function membro(nome: string, email: string, perms: string[], empresas: string[] = [I.empresa]): Promise<Hdr> {
  const role = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome}`, permissions: perms } });
  expect(role.statusCode, role.body).toBe(201);
  const mem = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Anexo@12345", role_id: j(role).id, escopos_empresas: escoposDeTodosOsModulos(empresas) } });
  expect(mem.statusCode, mem.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Anexo@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${j(login).token as string}`, "x-org-id": h.demo.orgId };
}

const listar = (entity: string, id: string, hd: Hdr) => h.app.inject({ method: "GET", url: `/api/attachments?entity=${entity}&entity_id=${id}`, headers: hd });
const enviar = (entity: string, id: string, hd: Hdr, nome = "comprovante.pdf") =>
  h.app.inject({ method: "POST", url: "/api/attachments", headers: hd, payload: { entity, entity_id: id, file_name: nome, mime_type: "application/pdf", data_base64: PDF.toString("base64") } });
const baixar = (attId: string, hd: Hdr) => h.app.inject({ method: "GET", url: `/api/attachments/${attId}/content?download=1`, headers: hd });
const excluir = (attId: string, hd: Hdr) => h.app.inject({ method: "DELETE", url: `/api/attachments/${attId}`, headers: hd });

const ROTA_VENDA = { budget: "budgets", order: "orders", sale: "sales" } as const;
async function docVenda(kind: keyof typeof ROTA_VENDA, empresaId = I.empresa): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: `/api/sales/${ROTA_VENDA[kind]}`, headers: h.headers(),
    payload: { empresa_id: empresaId, document_date: "2026-09-10", client_id: I.client, items: [{ product_id: I.product, warehouse_id: null, quantity: "1", unit_price: "5.00" }] } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
let seq = 0;
async function top(codigoBase: string): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: `AX${String(++seq).padStart(2, "0")}`, codigoBase, nome: `TOP anexos ${codigoBase}` } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
async function docCompra(segmento: "pedidos" | "compras", topId: string): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: `/api/compras/${segmento}`, headers: h.headers(),
    payload: { empresa_id: I.empresa, tipo_operacao_id: topId, fornecedor_id: I.provider, data_documento: "2026-09-10",
      categoria_financeira_id: I.category, centro_custo_id: I.costCenter, ...(segmento === "compras" ? { numero_nota: `AX-${++seq}` } : {}),
      itens: [{ produto_id: I.product2!, armazem_id: I.warehouse!, quantidade: "1", valor_unitario: "10.00" }] } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}

/** Ciclo completo com o usuário dado: envia, lista (e acha), baixa (bytes iguais), exclui, lista (sumiu). */
async function ciclo(entity: string, id: string, hd: Hdr): Promise<void> {
  const env = await enviar(entity, id, hd);
  expect(env.statusCode, `${entity}: ${env.body}`).toBe(201);
  const attId = j(env).id as string;
  const lst = await listar(entity, id, hd);
  expect(lst.statusCode, lst.body).toBe(200);
  expect((j(lst).items as { id: string }[]).map((x) => x.id)).toContain(attId);
  const b = await baixar(attId, hd);
  expect(b.statusCode, b.body).toBe(200);
  expect(b.rawPayload.equals(PDF), "o arquivo baixado é o enviado").toBe(true);
  expect((await excluir(attId, hd)).statusCode).toBe(200);
  const depois = await listar(entity, id, hd);
  expect((j(depois).items as { id: string }[]).map((x) => x.id)).not.toContain(attId);
}

beforeAll(async () => {
  h = await harness(); I = await ids(h);
  admin = createPool(TEST_URL, { max: 2 });
  orcamento = await docVenda("budget");
  pedidoVenda = await docVenda("order");
  venda = await docVenda("sale");
  vendaEmpresa2 = await docVenda("sale", I.empresa2);
  vendaExcluida = await docVenda("sale");
  await admin.query("update erp.sales_documents set deleted_at=now() where id=$1", [vendaExcluida]);
  pedidoCompra = await docCompra("pedidos", await top("compras.pedido"));
  compra = await docCompra("compras", await top("compras.compra"));
  const o2 = await seedDemo(h.db, { orgName: "Org Anexos AP01", slug: `org-anexos-ap01-${Date.now().toString(36)}` });
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: o2.adminEmail, password: "Demo@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  outraOrg = { authorization: `Bearer ${j(login).token as string}`, "x-org-id": o2.orgId };
}, 240_000);
afterAll(async () => { await admin?.end(); await h?.app.close(); await h?.db.end(); });

describe("AX-1 — documentos de venda: a porta é a da espécie", () => {
  it("orçamento, pedido e venda: ciclo completo com a permissão da própria espécie", async () => {
    await ciclo("sales_documents", orcamento, await membro("AX1 orçamento", "ax1-budget@demo.local", [...ANEXOS, "budgets.view"]));
    await ciclo("sales_documents", pedidoVenda, await membro("AX1 pedido", "ax1-order@demo.local", [...ANEXOS, "orders.view"]));
    await ciclo("sales_documents", venda, await membro("AX1 venda", "ax1-sale@demo.local", [...ANEXOS, "sales.view"]));
  });

  it("com sales.view e sem budgets.view: anexo do orçamento → 403 (e o da venda continua aberto)", async () => {
    const soVenda = await membro("AX1 só venda", "ax1-so-venda@demo.local", [...ANEXOS, "sales.view"]);
    expect((await listar("sales_documents", venda, soVenda)).statusCode).toBe(200);
    const r = await listar("sales_documents", orcamento, soVenda);
    expect(r.statusCode, r.body).toBe(403);
    expect((await enviar("sales_documents", orcamento, soVenda)).statusCode).toBe(403);
    expect((await listar("sales_documents", pedidoVenda, soVenda)).statusCode).toBe(403);
    // o anexo que JÁ existe no orçamento também não sai por download nem por exclusão
    const env = await enviar("sales_documents", orcamento, h.headers());
    expect(env.statusCode, env.body).toBe(201);
    const attId = j(env).id as string;
    expect((await baixar(attId, soVenda)).statusCode).toBe(403);
    expect((await excluir(attId, soVenda)).statusCode).toBe(403);
    expect((await excluir(attId, h.headers())).statusCode).toBe(200);
  });
});

describe("AX-2 — documentos de compra: pedido e compra", () => {
  it("pedido de compra com pedidos_compra.view e compra com compras.view", async () => {
    const soPedido = await membro("AX2 pedido", "ax2-pedido@demo.local", [...ANEXOS, "pedidos_compra.view"]);
    const soCompra = await membro("AX2 compra", "ax2-compra@demo.local", [...ANEXOS, "compras.view"]);
    await ciclo("documentos_compra", pedidoCompra, soPedido);
    await ciclo("documentos_compra", compra, soCompra);
    // a espécie errada não serve: cada porta abre só a própria
    expect((await listar("documentos_compra", compra, soPedido)).statusCode).toBe(403);
    expect((await listar("documentos_compra", pedidoCompra, soCompra)).statusCode).toBe(403);
  });
});

describe("AX-3 — negar não revela existência", () => {
  it("inexistente, outra organização, empresa fora do escopo e venda excluída: a MESMA 404", async () => {
    const usuario = await membro("AX3 vendas", "ax3-vendas@demo.local", [...ANEXOS, "sales.view"]);
    const casos: [string, () => Promise<Resposta>][] = [
      ["inexistente", () => listar("sales_documents", NAO_ACHADO, usuario)],
      ["outra organização", () => listar("sales_documents", venda, outraOrg)],
      ["empresa fora do escopo", () => listar("sales_documents", vendaEmpresa2, usuario)],
      ["venda excluída", () => listar("sales_documents", vendaExcluida, usuario)],
    ];
    const corpos: string[] = [];
    for (const [nome, chamar] of casos) {
      const r = await chamar();
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(404);
      corpos.push(r.body);
      // envio também é 404 — nada é gravado contra um pai invisível
      const env = nome === "outra organização" ? await enviar("sales_documents", venda, outraOrg) : await enviar("sales_documents", nome === "inexistente" ? NAO_ACHADO : nome === "venda excluída" ? vendaExcluida : vendaEmpresa2, usuario);
      expect(env.statusCode, `${nome} (envio): ${env.body}`).toBe(404);
    }
    expect(new Set(corpos).size, `corpos distintos: ${corpos.join(" | ")}`).toBe(1);
    // premissa: o mesmo usuário vê a venda da própria empresa (os 404 acima são recorte, não rota quebrada)
    expect((await listar("sales_documents", venda, usuario)).statusCode).toBe(200);
    // e o dono da organização enxerga a venda da empresa 2 — ela existe
    expect((await listar("sales_documents", vendaEmpresa2, h.headers())).statusCode).toBe(200);
    const gravados = await admin.query("select count(*)::int n from erp.attachments where entity_id = any($1::uuid[])", [[NAO_ACHADO, vendaEmpresa2, vendaExcluida]]);
    expect(gravados.rows[0].n).toBe(0);
  });
});

describe("AX-4 — sem regra por situação; histórico no documento", () => {
  it("venda confirmada, venda cancelada, compra confirmada e compra cancelada aceitam anexo", async () => {
    const confirmada = await docVenda("sale");
    let r = await h.app.inject({ method: "POST", url: `/api/sales/sales/${confirmada}/confirm`, headers: h.headers() });
    expect(r.statusCode, r.body).toBe(200);
    const cancelada = await docVenda("sale");
    r = await h.app.inject({ method: "POST", url: `/api/sales/sales/${cancelada}/cancel`, headers: h.headers(), payload: {} });
    expect(r.statusCode, r.body).toBe(200);
    const topCompra = await top("compras.compra");
    const compraConfirmada = await docCompra("compras", topCompra);
    r = await h.app.inject({ method: "POST", url: `/api/compras/compras/${compraConfirmada}/confirm`, headers: h.headers() });
    expect(r.statusCode, r.body).toBe(200);
    const compraCancelada = await docCompra("compras", topCompra);
    r = await h.app.inject({ method: "POST", url: `/api/compras/compras/${compraCancelada}/cancel`, headers: h.headers(), payload: {} });
    expect(r.statusCode, r.body).toBe(200);

    const situacoes = await admin.query<{ id: string; s: string }>(
      "select id, status s from erp.sales_documents where id = any($1::uuid[]) union all select id, situacao from erp.documentos_compra where id = any($1::uuid[])",
      [[confirmada, cancelada, compraConfirmada, compraCancelada]]);
    expect(Object.fromEntries(situacoes.rows.map((x) => [x.id, x.s]))).toEqual({ [confirmada]: "confirmed", [cancelada]: "cancelled", [compraConfirmada]: "confirmado", [compraCancelada]: "cancelado" });

    for (const [entity, id] of [["sales_documents", confirmada], ["sales_documents", cancelada], ["documentos_compra", compraConfirmada], ["documentos_compra", compraCancelada]] as const) {
      await ciclo(entity, id, h.headers());
      const hist = await h.app.inject({ method: "GET", url: `/api/admin/audit?entity=${entity}&entity_id=${id}`, headers: h.headers() });
      expect(hist.statusCode, hist.body).toBe(200);
      const acoes = (j(hist).items as { action: string }[]).map((x) => x.action);
      expect(acoes, `${entity} ${id}`).toContain("attachment_added");
      expect(acoes, `${entity} ${id}`).toContain("attachment_removed");
    }
  });
});

describe("AX-5 — fora da whitelist", () => {
  it("entidade não anexável → 422, não 404", async () => {
    for (const entidade of ["sales_document_items", "itens_documento_compra", "nao_existe"]) {
      const r = await listar(entidade, venda, h.headers());
      expect(r.statusCode, `${entidade}: ${r.body}`).toBe(422);
      expect((await enviar(entidade, venda, h.headers())).statusCode).toBe(422);
    }
  });
});
