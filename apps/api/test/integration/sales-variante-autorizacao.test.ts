import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool } from "@agro/db";
import { escoposDeTodosOsModulos, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * FRONTEIRA DE VARIANTE DE `erp.sales_documents` — CAPACIDADE DA ROTA × `kind` DO REGISTRO (BASE2-03C).
 *
 * `sales_documents` é UMA tabela com TRÊS variantes (`kind`), e cada variante tem a sua própria família
 * de capacidades: `budgets.*` × `orders.*` × `sales.*`. As rotas são variantes (`/sales/budgets/...`,
 * `/sales/orders/...`, `/sales/sales/...`) e autorizam pela capacidade DA ROTA.
 *
 * O defeito que esta matriz existe para travar: as portas carregavam o documento por id + organização +
 * exclusão + escopo de empresa, SEM amarrar `kind` à rota. Quem tivesse `budgets.view` lia um PEDIDO ou
 * uma VENDA pedindo o UUID pela rota de orçamentos; `budgets.delete` CANCELAVA documento de outra
 * variante; e o `confirm` respondia 422 ("Somente vendas são confirmadas") para um orçamento — um erro
 * que distingue "existe na variante vizinha" de "não existe", que é justamente o que a superfície de
 * recusa não pode revelar.
 *
 * O contrato provado aqui:
 *   capacidade da rota ∧ registro.kind == variante da rota ∧ tenant ∧ escopo de empresa
 * combinados com AND. Variante errada é INEXISTENTE PARA AQUELA ROTA: 404, nunca 200, nunca 422, nunca
 * redirect.
 *
 * O caso B (ADMIN com TODAS as capacidades) é o que dá valor à matriz: sem ele, um 404 poderia estar
 * vindo da falta de permissão em vez do `kind` do registro, e o teste passaria sem provar nada.
 *
 * A CONVERSÃO é auditada à parte porque é operação COMPOSTA: muta a fonte e cria o destino. Ela exige as
 * DUAS capacidades (`source.edit` ∧ `target.create`), e faltar metade tem de recusar ANTES da primeira
 * mutação — 403, porque falta de capacidade fala do chamador, não da existência do registro.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>;
type Hdr = Record<string, string>;
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { error?: { code: string } };

/** As três variantes, com a rota e a família de capacidades de cada uma. */
const VARIANTES = [
  { kind: "budget", rota: "budgets", perm: "budgets" },
  { kind: "order", rota: "orders", perm: "orders" },
  { kind: "sale", rota: "sales", perm: "sales" }
] as const;
type Variante = (typeof VARIANTES)[number]["kind"];
const rotaDe = (k: Variante) => VARIANTES.find((v) => v.kind === k)!.rota;

const ACOES = ["view", "create", "edit", "delete"] as const;
const todasAsCapacidades = () => VARIANTES.flatMap((v) => ACOES.map((a) => `${v.perm}.${a}`));

async function membro(nome: string, email: string, perms: string[], empresas: string[] = []): Promise<Hdr> {
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome}`, permissions: perms } });
  expect(papel.statusCode, papel.body).toBe(201);
  const vinculo = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Variante@12345", role_id: j(papel).id, escopos_empresas: escoposDeTodosOsModulos(empresas) } });
  expect(vinculo.statusCode, vinculo.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Variante@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}

/** Cria um documento da variante pedida, pela rota da PRÓPRIA variante, com o usuário administrador. */
async function criar(kind: Variante, empresaId?: string): Promise<string> {
  const r = await h.app.inject({
    method: "POST", url: `/api/sales/${rotaDe(kind)}`, headers: h.headers(),
    payload: {
      empresa_id: empresaId ?? I.empresa, document_date: "2026-09-01", client_id: I.client,
      items: [{ product_id: I.product, warehouse_id: I.warehouse, quantity: "2", unit_price: "50.00" }]
    }
  });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}

/**
 * Leitura DIRETA do estado persistido — o teste não pergunta à rota se a rota mudou alguma coisa.
 * Uma recusa que já tivesse gravado metade responderia 404 com o mesmo corpo de uma recusa limpa.
 */
async function estado(id: string): Promise<{ status: string; itens: number; derivados: number; movimentos: number; titulos: number }> {
  const c = createPool(TEST_URL, { max: 1 });
  try {
    const d = (await c.query<{ status: string }>("select status from erp.sales_documents where id=$1", [id])).rows[0]!;
    const n = async (sql: string) => Number((await c.query<{ n: string }>(sql, [id])).rows[0]!.n);
    return {
      status: d.status,
      itens: await n("select count(*)::text n from erp.sales_document_items where document_id=$1"),
      derivados: await n("select count(*)::text n from erp.sales_documents where origin_document_id=$1"),
      movimentos: await n("select count(*)::text n from erp.stock_movements where source_type='sales_documents' and source_id=$1"),
      titulos: await n("select count(*)::text n from erp.financial_titles where source_type='sales_documents' and source_id=$1")
    };
  } finally { await c.end(); }
}

beforeAll(async () => { h = await harness(); I = await ids(h); }, 120_000);
afterAll(async () => { await h.app.close(); await h.db.end(); });

describe("fronteira de variante de sales_documents", () => {
  it("A — matriz 3×3: cada capacidade só enxerga a PRÓPRIA variante; rota errada é 404", async () => {
    const docs: Record<Variante, string> = { budget: await criar("budget"), order: await criar("order"), sale: await criar("sale") };
    // Um usuário por família de capacidade, com APENAS o `view` daquela família.
    const users: Record<Variante, Hdr> = {
      budget: await membro("Só orçamentos", "so.orcamentos@teste.com", ["budgets.view"]),
      order: await membro("Só pedidos", "so.pedidos@teste.com", ["orders.view"]),
      sale: await membro("Só vendas", "so.vendas@teste.com", ["sales.view"])
    };
    let proprias = 0, cruzadas = 0;
    for (const dono of VARIANTES) {
      for (const porta of VARIANTES) {
        const r = await h.app.inject({ method: "GET", url: `/api/sales/${porta.rota}/${docs[dono.kind]}`, headers: users[porta.kind] });
        if (dono.kind === porta.kind) {
          expect(r.statusCode, `${porta.rota} lendo o próprio ${dono.kind}: ${r.body}`).toBe(200);
          expect(j(r).kind).toBe(dono.kind);
          proprias++;
        } else {
          expect(r.statusCode, `${porta.rota} lendo um ${dono.kind}: ${r.body}`).toBe(404);
          cruzadas++;
        }
      }
    }
    // NÃO-VACUIDADE: 9 combinações, 3 legítimas e 6 cruzadas. Sem esta contagem, uma matriz que
    // deixasse de iterar passaria verde sem ter exercido nada.
    expect([proprias, cruzadas]).toEqual([3, 6]);
  }, 120_000);

  it("B — ADMIN com TODAS as capacidades continua 404 na rota errada: o 404 é identidade de variante, não falta de permissão", async () => {
    const budget = await criar("budget"); const sale = await criar("sale");
    const admin = await membro("Vendas completo", "vendas.completo@teste.com", todasAsCapacidades());
    // A prova de que ele REALMENTE tem as duas capacidades: as rotas próprias respondem 200.
    expect((await h.app.inject({ method: "GET", url: `/api/sales/budgets/${budget}`, headers: admin })).statusCode).toBe(200);
    expect((await h.app.inject({ method: "GET", url: `/api/sales/sales/${sale}`, headers: admin })).statusCode).toBe(200);
    // E ainda assim a rota errada não serve o registro.
    expect((await h.app.inject({ method: "GET", url: `/api/sales/budgets/${sale}`, headers: admin })).statusCode).toBe(404);
    expect((await h.app.inject({ method: "GET", url: `/api/sales/sales/${budget}`, headers: admin })).statusCode).toBe(404);
    expect((await h.app.inject({ method: "GET", url: `/api/sales/orders/${budget}`, headers: admin })).statusCode).toBe(404);
  }, 120_000);

  it("C — CANCEL pela rota errada não muta: `budgets.delete` não cancela pedido nem venda", async () => {
    const order = await criar("order"); const sale = await criar("sale");
    const u = await membro("Cancela orçamento", "cancela.orcamento@teste.com", ["budgets.view", "budgets.delete"]);
    for (const id of [order, sale]) {
      const antes = await estado(id);
      const r = await h.app.inject({ method: "POST", url: `/api/sales/budgets/${id}/cancel`, headers: u });
      expect(r.statusCode, r.body).toBe(404);
      expect(await estado(id), "cancelamento recusado não pode deixar efeito").toEqual(antes);
      expect(antes.status).toBe("open");
    }
  }, 120_000);

  it("D — PUT pela rota errada não altera documento nem itens", async () => {
    const order = await criar("order");
    const antes = await estado(order);
    const u = await membro("Edita orçamento", "edita.orcamento@teste.com", ["budgets.view", "budgets.edit"]);
    const r = await h.app.inject({
      method: "PUT", url: `/api/sales/budgets/${order}`, headers: u,
      payload: { empresa_id: I.empresa, document_date: "2026-09-02", client_id: I.client, items: [{ product_id: I.product2, warehouse_id: I.warehouse, quantity: "99", unit_price: "1.00" }] }
    });
    expect(r.statusCode, r.body).toBe(404);
    expect(await estado(order)).toEqual(antes);
    const c = createPool(TEST_URL, { max: 1 });
    try {
      const it = (await c.query<{ quantity: string; product_id: string }>("select quantity, product_id from erp.sales_document_items where document_id=$1", [order])).rows;
      expect(it).toHaveLength(1);
      expect(it[0]!.product_id, "o item continua o original — o PUT não substituiu nada").toBe(I.product);
    } finally { await c.end(); }
  }, 120_000);

  it("E — CONFIRM de orçamento/pedido pela rota de vendas é 404 (não 422) e sem efeito de estoque ou financeiro", async () => {
    const budget = await criar("budget"); const order = await criar("order");
    const u = await membro("Confirma venda", "confirma.venda@teste.com", ["sales.view", "sales.edit"]);
    for (const id of [budget, order]) {
      const antes = await estado(id);
      const r = await h.app.inject({ method: "POST", url: `/api/sales/sales/${id}/confirm`, headers: u });
      // 404 e não 422: um 422 "Somente vendas são confirmadas" responderia que o UUID EXISTE e é de
      // outra variante — classificação que quem está fora da variante não pode obter.
      expect(r.statusCode, r.body).toBe(404);
      expect(j(r).error?.code).not.toBe("VALIDATION_ERROR");
      const depois = await estado(id);
      expect(depois).toEqual(antes);
      expect([depois.status, depois.movimentos, depois.titulos]).toEqual(["open", 0, 0]);
    }
  }, 120_000);

  for (const [fonte, destino] of [["budget", "order"], ["order", "sale"]] as const) {
    it(`F — CONVERT ${fonte}→${destino} exige ${fonte === "budget" ? "budgets" : "orders"}.edit ∧ ${destino === "order" ? "orders" : "sales"}.create`, async () => {
      const permFonte = fonte === "budget" ? "budgets" : "orders";
      const permDestino = destino === "order" ? "orders" : "sales";
      const rota = rotaDe(fonte);

      // 1. tem a CRIAÇÃO do destino, não tem a EDIÇÃO da fonte → 403, fonte intacta, zero derivado.
      const soDestino = await membro(`Cria ${destino} ${fonte}`, `cria.${destino}.de.${fonte}@teste.com`, [`${permFonte}.view`, `${permDestino}.create`]);
      const a = await criar(fonte); const antesA = await estado(a);
      const r1 = await h.app.inject({ method: "POST", url: `/api/sales/${rota}/${a}/convert`, headers: soDestino });
      expect(r1.statusCode, r1.body).toBe(403);
      expect(await estado(a)).toEqual({ ...antesA, status: "open", derivados: 0 });

      // 2. tem a EDIÇÃO da fonte, não tem a CRIAÇÃO do destino → 403, fonte intacta, zero derivado.
      const soFonte = await membro(`Edita ${fonte} sem ${destino}`, `edita.${fonte}.sem.${destino}@teste.com`, [`${permFonte}.view`, `${permFonte}.edit`]);
      const b = await criar(fonte); const antesB = await estado(b);
      const r2 = await h.app.inject({ method: "POST", url: `/api/sales/${rota}/${b}/convert`, headers: soFonte });
      expect(r2.statusCode, r2.body).toBe(403);
      expect(await estado(b)).toEqual({ ...antesB, status: "open", derivados: 0 });

      // 3. tem AS DUAS → 201, fonte convertida, destino criado com o kind e a origem corretos.
      const ambas = await membro(`Converte ${fonte}`, `converte.${fonte}@teste.com`, [`${permFonte}.view`, `${permFonte}.edit`, `${permDestino}.create`, `${permDestino}.view`]);
      const c = await criar(fonte);
      const r3 = await h.app.inject({ method: "POST", url: `/api/sales/${rota}/${c}/convert`, headers: ambas });
      expect(r3.statusCode, r3.body).toBe(201);
      const novo = j(r3).id as string;
      expect(j(r3).kind).toBe(destino);
      const depois = await estado(c);
      expect([depois.status, depois.derivados]).toEqual(["converted", 1]);
      const pool = createPool(TEST_URL, { max: 1 });
      try {
        const d = (await pool.query<{ kind: string; origin_document_id: string }>("select kind, origin_document_id from erp.sales_documents where id=$1", [novo])).rows[0]!;
        expect([d.kind, d.origin_document_id]).toEqual([destino, c]);
      } finally { await pool.end(); }
    }, 180_000);
  }

  it("G — o escopo de empresa continua valendo dentro da variante certa", async () => {
    const daEmpresa1 = await criar("budget", I.empresa);
    // Usuário com a capacidade da variante CERTA, mas com escopo restrito à outra empresa.
    const u = await membro("Orçamento empresa 2", "orcamento.empresa2@teste.com", ["budgets.view"], [I.empresa2]);
    const r = await h.app.inject({ method: "GET", url: `/api/sales/budgets/${daEmpresa1}`, headers: u });
    // Mesma 404 da variante errada: fora do escopo é indistinguível de inexistente.
    expect(r.statusCode, r.body).toBe(404);
    // E a premissa: o MESMO usuário lê um orçamento da empresa dele — sem isso o 404 acima poderia vir
    // de capacidade ausente e o teste não provaria escopo nenhum.
    const daEmpresa2 = await criar("budget", I.empresa2);
    expect((await h.app.inject({ method: "GET", url: `/api/sales/budgets/${daEmpresa2}`, headers: u })).statusCode).toBe(200);
  }, 120_000);
});
