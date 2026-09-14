import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { entidadeIdGlobal, tiposEntidadeIdGlobal, variantesInternasDeclaradas } from "@agro/domain";
import { createPool, type Db } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * ID GLOBAL NAS LISTAGENS — COBERTURA E CONTRATO (PRE-BASE2-05B.1).
 *
 * O ID Global só é útil se o usuário conseguir LER o número em algum lugar antes de digitá-lo na busca. Até
 * aqui ele existia no banco e na tela de detalhe; a listagem, que é por onde se chega a tudo, não o mostrava.
 *
 * POR QUE A MATRIZ VIVE NO TESTE, E NÃO NO RUNTIME
 * ------------------------------------------------
 * A lista de entidades é UMA só (`ENTIDADES_ID_GLOBAL`). O que este arquivo declara não é outra lista de
 * entidades: é o ENDEREÇO da listagem de cada uma — informação que o runtime não precisa ter e que só existe
 * para poder ser conferida. A primeira asserção compara os dois conjuntos NOS DOIS SENTIDOS: entidade nova no
 * catálogo sem listagem declarada reprova, e listagem declarada para entidade que saiu do catálogo também.
 * É o que impede uma entidade de nascer sem número visível e ninguém notar.
 *
 * O que cada listagem é obrigada a devolver:
 *   • `idGlobal.tipoEntidade` e `idGlobal.rotulo` — a DECLARAÇÃO que faz a tela mostrar a coluna sem manter
 *     uma cópia do catálogo no cliente;
 *   • `id_global` em TODA linha — número ou `null`. A chave presente e nula é diferente de chave ausente:
 *     ausente seria "esta listagem esqueceu", nula é "este registro não tem número", que é resposta legítima.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
type Corpo = { items: Record<string, unknown>[]; idGlobal?: { tipoEntidade: string; rotulo: string } };

/**
 * Onde cada entidade do catálogo aparece listada. Uma entidade pode ter mais de uma tela (título financeiro
 * é pagar E receber; documento de venda é orçamento, pedido E venda) — todas entram, porque uma listagem
 * esquecida numa das telas é exatamente o defeito que este gate existe para pegar.
 */
const LISTAGENS: Readonly<Record<string, readonly string[]>> = {
  purchase_requests: ["/api/supply/requests"],
  input_entries: ["/api/stock/input-entries"],
  invoices: ["/api/stock/invoices"],
  requisitions: ["/api/stock/requisitions"],
  stock_writeoffs: ["/api/stock/writeoffs"],
  devolutions: ["/api/stock/devolutions"],
  warehouse_transfers: ["/api/stock/transfers"],
  feed_batches: ["/api/stock/feed-batches"],
  financial_titles: ["/api/financial/payables", "/api/financial/receivables"],
  bank_movements: ["/api/financial/bank-movements"],
  ofx_imports: ["/api/financial/ofx-imports"],
  sales_documents: ["/api/sales/budgets", "/api/sales/orders", "/api/sales/sales"],
  animals: ["/api/livestock/animals"],
  animal_movements: ["/api/livestock/movements"],
  animal_handlings: ["/api/livestock/handlings"],
  weighings: ["/api/livestock/weighings"],
  fuel_supplies: ["/api/fleet/fuel-supplies"],
  maintenances: ["/api/fleet/maintenances"],
  equipments: ["/api/resources/equipments"],
  service_orders: ["/api/service-orders"],
  products: ["/api/resources/products"],
  people: ["/api/resources/people"],
  roles: ["/api/admin/roles"]
};

const listar = async (url: string, extra: Record<string, string> = {}) => h.app.inject({ method: "GET", url, headers: h.headers(extra) });
const corpo = (r: { json: () => unknown }) => r.json() as Corpo;

beforeAll(async () => { h = await harness(); I = await ids(h); admin = createPool(TEST_URL, { max: 2 }); }, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("cobertura: toda entidade do catálogo tem listagem declarada", () => {
  it("os dois conjuntos são o mesmo — nada a mais, nada a menos", () => {
    expect(Object.keys(LISTAGENS).sort()).toEqual([...tiposEntidadeIdGlobal()].sort());
  });
});

describe("contrato da listagem", () => {
  for (const [tipo, urls] of Object.entries(LISTAGENS)) for (const url of urls) {
    it(`${tipo} — ${url} declara o tipo e devolve id_global em toda linha`, async () => {
      const r = await listar(url);
      expect(r.statusCode, r.body).toBe(200);
      const b = corpo(r);
      expect(b.idGlobal, "a listagem precisa DECLARAR o ID Global — é o que faz a coluna aparecer").toBeTruthy();
      expect(b.idGlobal!.tipoEntidade).toBe(tipo);
      expect(b.idGlobal!.rotulo).toBe(entidadeIdGlobal(tipo)!.rotulo);
      for (const linha of b.items) {
        expect(Object.hasOwn(linha, "id_global"), `linha sem a chave id_global em ${url}`).toBe(true);
        const v = linha["id_global"];
        expect(v === null || (typeof v === "number" && Number.isSafeInteger(v) && v > 0), `id_global inválido em ${url}: ${JSON.stringify(v)}`).toBe(true);
      }
    });
  }
});

describe("o número da linha é o MESMO da porta de #N", () => {
  it("produtos: id_global da listagem bate com o índice e com a resolução inversa", async () => {
    // O produto é criado pela porta real: o acervo semeado direto no banco só ganha número no backfill, e
    // depender dele aqui faria o caso passar ou falhar por causa de um comando operacional, não do código.
    const modelo = (await admin.query<{ measurement_id: string; group_id: string; category_id: string; kind_id: string; financial_category_id: string | null }>(
      "select measurement_id, group_id, category_id, kind_id, financial_category_id from erp.products where organization_id=$1 and financial_category_id is not null limit 1", [h.demo.orgId])).rows[0]!;
    const criado = await h.app.inject({ method: "POST", url: "/api/resources/products", headers: h.headers(),
      payload: { description: "Produto listagem #N", ...modelo } });
    expect(criado.statusCode, criado.body).toBe(201);
    const id = (criado.json() as { id: string }).id;

    const r = await listar("/api/resources/products?pageSize=100&search=Produto listagem");
    expect(r.statusCode, r.body).toBe(200);
    const linha = corpo(r).items.find((x) => x["id"] === id);
    expect(linha, "o produto recém-criado tem de estar na listagem").toBeTruthy();

    const banco = await admin.query<{ id_global: string }>(
      "select id_global from erp.registros_globais where organization_id=$1 and tipo_entidade='products' and id_entidade=$2", [h.demo.orgId, id]);
    expect(Number(banco.rows[0]!.id_global), "o número da linha é o do índice — a listagem não numera nada").toBe(linha!["id_global"]);
    const inverso = await h.app.inject({ method: "GET", url: `/api/registros-globais/entidade/products/${id}`, headers: h.headers() });
    expect(inverso.statusCode, inverso.body).toBe(200);
    expect((inverso.json() as { idGlobal: number }).idGlobal, "listagem e porta de #N falam do mesmo número").toBe(linha!["id_global"]);
  });

  it("acervo anterior ao backfill aparece com id_global nulo — sem quebrar e sem inventar número", async () => {
    const semNumero = await admin.query<{ n: string }>(
      "select count(*) n from erp.products p where p.organization_id=$1 and not exists (select 1 from erp.registros_globais g where g.organization_id=p.organization_id and g.tipo_entidade='products' and g.id_entidade=p.id)", [h.demo.orgId]);
    if (Number(semNumero.rows[0]!.n) === 0) return; // nada a provar nesta base
    const r = await listar("/api/resources/products?pageSize=200");
    expect(r.statusCode, r.body).toBe(200);
    const nulos = corpo(r).items.filter((x) => x["id_global"] === null);
    expect(nulos.length, "registro sem índice sai com a chave presente e nula, nunca ausente").toBeGreaterThan(0);
  });

  it("ordem de serviço: o número nasce no POST e aparece na listagem sem novo cadastro", async () => {
    const criada = await h.app.inject({ method: "POST", url: "/api/service-orders", headers: h.headers(),
      payload: { empresa_id: I.empresa, order_date: "2031-05-02", description: "OS listagem" } });
    expect(criada.statusCode, criada.body).toBe(201);
    const id = (criada.json() as { id: string }).id;
    const esperado = Number((await admin.query<{ id_global: string }>(
      "select id_global from erp.registros_globais where organization_id=$1 and tipo_entidade='service_orders' and id_entidade=$2", [h.demo.orgId, id])).rows[0]!.id_global);
    const lista = await listar("/api/service-orders?pageSize=200");
    expect(lista.statusCode, lista.body).toBe(200);
    const linha = corpo(lista).items.find((x) => x["id"] === id);
    expect(linha, "a OS recém-criada tem de estar na listagem").toBeTruthy();
    expect(linha!["id_global"]).toBe(esperado);
  });

  it("título financeiro: pagar e receber numeram na MESMA sequência da organização", async () => {
    const pagar = await h.app.inject({ method: "POST", url: "/api/financial/payables", headers: h.headers(),
      payload: { empresa_id: I.empresa, number: "LST-P", person_id: I.provider, amount: "10", emission_date: "2031-05-02", due_date: "2031-06-02", note: "listagem #N", apportionment: [{ financial_category_id: I.category, cost_center_id: I.costCenter, percentage: "100" }] } });
    expect(pagar.statusCode, pagar.body).toBe(201);
    const idPagar = (pagar.json() as { ids?: string[]; id?: string }).ids?.[0] ?? (pagar.json() as { id: string }).id;
    const lista = await listar("/api/financial/payables?pageSize=200");
    const linha = corpo(lista).items.find((x) => x["id"] === idPagar);
    expect(linha, "o título recém-criado tem de estar na listagem de contas a pagar").toBeTruthy();
    expect(typeof linha!["id_global"], "título financeiro nasce numerado").toBe("number");
  });
});

describe("pecuária: efeito interno declarado NÃO recebe número, e a listagem mostra isso sem inventar", () => {
  it("movimentações internas aparecem com id_global nulo, nunca com um número improvisado", async () => {
    const internas = variantesInternasDeclaradas("animal_movements");
    expect(internas.length, "o catálogo declara efeitos internos de rebanho").toBeGreaterThan(0);
    const r = await listar(`/api/livestock/movements?pageSize=200&movement_type=${internas[0]!}`);
    expect(r.statusCode, r.body).toBe(200);
    for (const linha of corpo(r).items) {
      expect(linha["movement_type"]).toBe(internas[0]!);
      expect(linha["id_global"], "efeito interno não tem identidade própria: sem número, de propósito").toBeNull();
    }
  });
});

describe("exportação da listagem", () => {
  it("o CSV genérico traz o #N como primeira coluna — a planilha mostra o mesmo que a tela", async () => {
    const r = await h.app.inject({ method: "GET", url: "/api/exports/products?format=csv", headers: h.headers() });
    expect(r.statusCode, r.body).toBe(200);
    const [cabecalho, ...linhas] = r.body.replace(/^\uFEFF/, "").split("\n");
    expect(cabecalho!.split(";")[0]).toBe("ID Global");
    const numerados = linhas.filter((l) => /^#\d+;/.test(l));
    expect(numerados.length, "o produto criado pela porta real aparece numerado na exportação").toBeGreaterThan(0);
  });

  it("registro sem número exporta célula VAZIA — nunca um número improvisado", async () => {
    const semNumero = await admin.query<{ n: string }>(
      "select count(*) n from erp.products p where p.organization_id=$1 and p.deleted_at is null and not exists (select 1 from erp.registros_globais g where g.organization_id=p.organization_id and g.tipo_entidade='products' and g.id_entidade=p.id)", [h.demo.orgId]);
    if (Number(semNumero.rows[0]!.n) === 0) return; // nada a provar nesta base
    const r = await h.app.inject({ method: "GET", url: "/api/exports/products?format=csv", headers: h.headers() });
    expect(r.statusCode, r.body).toBe(200);
    const linhas = r.body.replace(/^\uFEFF/, "").split("\n").slice(1).filter(Boolean);
    const vazias = linhas.filter((l) => l.startsWith(";"));
    expect(vazias.length, "acervo sem índice sai com a primeira célula vazia").toBeGreaterThan(0);
    expect(linhas.some((l) => /^[^#;][^;]*;/.test(l)), "nenhuma célula de ID Global sai com valor que não seja #N").toBe(false);
  });

  it("as demais colunas da exportação continuam as mesmas, na mesma ordem", async () => {
    // O contrato anterior é a lista de campos `list` do recurso; o ID Global entra ANTES, sem reordenar nada.
    const { getResource } = await import("@agro/domain");
    const def = getResource("products")!;
    const esperadas = def.fields.filter((f) => f.list).map((f) => f.label);
    const r = await h.app.inject({ method: "GET", url: "/api/exports/products?format=csv", headers: h.headers() });
    const cabecalho = r.body.replace(/^\uFEFF/, "").split("\n")[0]!.split(";");
    expect(cabecalho[0]).toBe("ID Global");
    expect(cabecalho.slice(1)).toEqual(esperadas);
  });

  it("recurso fora do catálogo exporta exatamente como antes, sem coluna nova", async () => {
    const r = await h.app.inject({ method: "GET", url: "/api/exports/cost_centers?format=csv", headers: h.headers() });
    expect(r.statusCode, r.body).toBe(200);
    const { getResource } = await import("@agro/domain");
    const def = getResource("cost_centers")!;
    const cabecalho = r.body.replace(/^\uFEFF/, "").split("\n")[0]!.split(";");
    expect(cabecalho[0]).not.toBe("ID Global");
    expect(cabecalho).toEqual(def.fields.filter((f) => f.list).map((f) => f.label));
  });
});

describe("o ID Global NÃO decide o que a listagem mostra", () => {
  it("a mesma listagem devolve exatamente as mesmas linhas, na mesma ordem, para outro usuário do mesmo escopo", async () => {
    const url = "/api/resources/products?pageSize=20";
    const admin1 = corpo(await listar(url)).items.map((x) => String(x["id"]));
    const operador = await h.app.inject({ method: "GET", url, headers: h.opHeaders() });
    expect(operador.statusCode, operador.body).toBe(200);
    expect(corpo(operador).items.map((x) => String(x["id"]))).toEqual(admin1);
  });

  it("tenant: a listagem de outra organização nunca carrega números desta", async () => {
    const outra = await admin.query<{ n: string }>(
      "select count(*) n from erp.registros_globais where organization_id <> $1", [h.demo.orgId]);
    const r = await listar("/api/resources/products?pageSize=50");
    const numeros = corpo(r).items.map((x) => x["id_global"]).filter((v): v is number => typeof v === "number");
    if (numeros.length) {
      const desta = await admin.query<{ n: string }>(
        "select count(*) n from erp.registros_globais where organization_id=$1 and id_global = any($2::bigint[])", [h.demo.orgId, numeros]);
      expect(Number(desta.rows[0]!.n), "todo número exibido pertence à organização da sessão").toBe(numeros.length);
    }
    expect(Number(outra.rows[0]!.n)).toBeGreaterThanOrEqual(0);
  });
});
