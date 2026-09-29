import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { createPool, type Db } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";
import { SQL_TRAVA_PRODUTOS } from "../../src/routes/vendas-reserva-estoque.js";

/**
 * TOP-CONFIG-07 (decisão 266) — A1: O PEDIDO QUE RESERVA ESTOQUE AO SALVAR, pela porta da API de vendas.
 *
 * A versão com "Reservar estoque" é montada por SQL (superusuário de teste) numa versão NOVA da TOP de pedido: esta
 * suíte prova a ROTA DE VENDAS (POST/PUT/GET e `/regras-da-operacao`), não o editor da TOP (outra suíte). Toda prova
 * decisiva do estado é lida no BANCO por conexão própria — físico em `erp.stock_balances`, reservado pela própria
 * conta do banco (`erp.reserva_estoque_nucleo`), quantidades gravadas — e não só na resposta.
 *
 * Estoque: Sal Mineral 10 no Almoxarifado (empresa 1) e 5 no Silo (empresa 1); Ração 0 no Almoxarifado. Cada caso
 * devolve o reservado a zero no fim (cancela o que criou), e o começo do caso seguinte PROVA isso antes de contar.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
let topReserva: string; let topSemReserva: string; let topOrcamento: string;
let SAL: string; let RACAO: string; let ALM: string; let SILO: string;

type Resposta = { statusCode: number; body: string; json: () => unknown };
type Erro = { code: string; message: string; details?: { path: string; message: string }[] };
const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: Erro };

const umValor = async (sql: string, p: unknown[]) => String(Object.values((await admin.query(sql, p)).rows[0] as Record<string, unknown>)[0]);
/** Físico do par: soma de todos os lotes, lida no banco. */
const fisico = (w: string, p: string) => umValor("select coalesce(sum(quantity),0)::numeric(18,4)::text from erp.stock_balances where organization_id=$1 and warehouse_id=$2 and product_id=$3", [h.demo.orgId, w, p]);
/** Reservado do par pela conta do banco (a mesma que a API e o gatilho usam). */
const reservado = (w: string, p: string, excluir: string | null = null) => umValor(
  "select reservado::text from erp.reserva_estoque_nucleo($1, array[$2]::uuid[], array[$3]::uuid[], $4)", [h.demo.orgId, w, p, excluir]);
const contar = async (kind: string) => Number(await umValor("select count(*) from erp.sales_documents where organization_id=$1 and kind=$2", [h.demo.orgId, kind]));
const quantidades = async (id: string) => (await admin.query<{ q: string }>("select quantity::text q from erp.sales_document_items where document_id=$1 order by position", [id])).rows.map((x) => x.q);

let seq = 0;
async function criarTop(codigoBase: string, nome: string): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: `371${String(++seq).padStart(2, "0")}`, codigoBase, nome } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
/**
 * HELPER ISOLADO (troca quando a API administrativa gravar `reservaEstoque`, A3): versão N+1 da TOP, igual à atual e
 * com `reserva_estoque` dado. A versão é imutável (0020), por isso a versão é nova — o mesmo que a API faz. Copia
 * `destinos_configurados` (a TOP criada sem destinos segue a ponte legada da conversão).
 */
async function versaoNova(topId: string, reserva: boolean): Promise<string> {
  const v = (await admin.query<{ id: string }>(
    `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, configuracao, configuracao_schema_version, destinos_configurados, reserva_estoque)
     select v.organization_id, v.tipo_operacao_id, v.versao + 1, v.nome, v.configuracao, v.configuracao_schema_version, v.destinos_configurados, $2
       from erp.tipos_operacao_versoes v join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.versao_atual = v.versao
      where t.id = $1 returning id`, [topId, reserva])).rows[0]!.id;
  expect((await admin.query("update erp.tipos_operacao set versao_atual = versao_atual + 1 where id = $1", [topId])).rowCount).toBe(1);
  return v;
}

type Item = { product_id: string; warehouse_id?: string | null; quantity: string; unit_price: string };
const item = (quantity: string, w: string | null = ALM, p: string = SAL): Item => ({ product_id: p, ...(w === null ? {} : { warehouse_id: w }), quantity, unit_price: "5.00" });
const corpo = (topId: string | null, items: Item[]) => ({ empresa_id: I.empresa, document_date: "2026-09-20", client_id: I.client, items, ...(topId ? { tipo_operacao_id: topId } : {}) });
type Rota = "orders" | "budgets" | "sales";
const criar = (rota: Rota, topId: string | null, items: Item[]) => h.app.inject({ method: "POST", url: `/api/sales/${rota}`, headers: h.headers(), payload: corpo(topId, items) });
const editar = (rota: Rota, id: string, topId: string | null, items: Item[]) => h.app.inject({ method: "PUT", url: `/api/sales/${rota}/${id}`, headers: h.headers(), payload: corpo(topId, items) });
async function criado(rota: Rota, topId: string | null, items: Item[]): Promise<string> {
  const r = await criar(rota, topId, items);
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
const ler = async (rota: Rota, id: string) => {
  const r = await h.app.inject({ method: "GET", url: `/api/sales/${rota}/${id}`, headers: h.headers() });
  expect(r.statusCode, r.body).toBe(200);
  return j(r) as Record<string, unknown> & { reserva_estoque: boolean; items: (Record<string, unknown> & { quantity: string })[] };
};
async function cancelar(rota: Rota, id: string) {
  const r = await h.app.inject({ method: "POST", url: `/api/sales/${rota}/${id}/cancel`, headers: h.headers(), payload: {} });
  expect(r.statusCode, r.body).toBe(200);
}
const regras = async (rota: Rota, topId: string) => {
  const r = await h.app.inject({ method: "GET", url: `/api/sales/${rota}/regras-da-operacao?tipo_operacao_id=${topId}`, headers: h.headers() });
  expect(r.statusCode, r.body).toBe(200);
  return j(r);
};
/** O 422 de validação, conferido por inteiro: código, mensagem e cada linha em `details`. */
function recusa(r: Resposta, message: string, details: { path: string; message: string }[]) {
  expect(r.statusCode, r.body).toBe(422);
  expect(j(r).error).toEqual(expect.objectContaining({ code: "VALIDATION_ERROR", message, details }));
}
let nomeSal: string; let nomeRacao: string; let nomeAlm: string; let nomeSilo: string;
const linha = (produto: string, armazem: string, disponivel: string, pedido: string) => `${produto} no armazém ${armazem}: disponível ${disponivel}, pedido ${pedido}.`;
/** PREMISSA de cada caso: nada reservado nos pares que ele usa (o caso anterior limpou). */
async function semReserva() {
  expect([await reservado(ALM, SAL), await reservado(SILO, SAL), await reservado(ALM, RACAO)]).toEqual(["0.0000", "0.0000", "0.0000"]);
}

beforeAll(async () => {
  h = await harness();
  I = await ids(h);
  admin = createPool(TEST_URL, { max: 2 });
  SAL = I.product!; RACAO = I.product2!; ALM = I.warehouse!; SILO = I.warehouse2!;
  // PREMISSA: o demo não traz estoque — os pares começam zerados, e o que a suíte conta é só o que ela lança.
  expect([await fisico(ALM, SAL), await fisico(SILO, SAL), await fisico(ALM, RACAO)]).toEqual(["0.0000", "0.0000", "0.0000"]);
  for (const [w, q] of [[ALM, "10"], [SILO, "5"]] as const) {
    const r = await h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: h.headers(),
      payload: { empresa_id: I.empresa, warehouse_id: w, product_id: SAL, quantity: q, unit_value: "10" } });
    expect(r.statusCode, r.body).toBe(201);
  }
  expect([await fisico(ALM, SAL), await fisico(SILO, SAL), await fisico(ALM, RACAO)]).toEqual(["10.0000", "5.0000", "0.0000"]);
  const nome = async (tabela: "products" | "warehouses", id: string) => umValor(`select description from erp.${tabela} where id=$1`, [id]);
  [nomeSal, nomeRacao, nomeAlm, nomeSilo] = [await nome("products", SAL), await nome("products", RACAO), await nome("warehouses", ALM), await nome("warehouses", SILO)];
  // PREMISSA: o armazém "de outra empresa" é mesmo de outra empresa.
  expect(await umValor("select empresa_id::text from erp.warehouses where id=$1", [I.warehouseEmpresa2])).not.toBe(I.empresa);

  topReserva = await criarTop("vendas.pedido", "Pedido com reserva");
  await versaoNova(topReserva, true);
  topSemReserva = await criarTop("vendas.pedido", "Pedido sem reserva");
  topOrcamento = await criarTop("vendas.orcamento", "Orçamento qualquer");
  // PREMISSA: só a versão ATUAL da TOP de reserva reserva.
  const flags = (await admin.query<{ id: string; r: boolean }>(
    "select t.id, v.reserva_estoque r from erp.tipos_operacao t join erp.tipos_operacao_versoes v on v.tipo_operacao_id=t.id and v.versao=t.versao_atual where t.id = any($1::uuid[])",
    [[topReserva, topSemReserva, topOrcamento]])).rows;
  expect(Object.fromEntries(flags.map((f) => [f.id, f.r]))).toEqual({ [topReserva]: true, [topSemReserva]: false, [topOrcamento]: false });
}, 240_000);
afterAll(async () => { await h.app.close(); await h.db.end(); await admin.end(); });

describe("RE-3 — o pedido reserva, e o segundo pedido só leva o que sobrou", () => {
  it("pedido de 8 (estoque 10) salva e reserva 8; segundo pedido de 3 → 422 'disponível 2, pedido 3' sem gravar; de 2 → salva", async () => {
    await semReserva();
    const p8 = await criado("orders", topReserva, [item("8")]);
    expect(await reservado(ALM, SAL)).toBe("8.0000");
    const antes = await contar("order");
    recusa(await criar("orders", topReserva, [item("3")]), linha(nomeSal, nomeAlm, "2", "3"), [{ path: "items", message: linha(nomeSal, nomeAlm, "2", "3") }]);
    expect(await contar("order"), "sem reserva parcial: nada gravado").toBe(antes);
    expect(await reservado(ALM, SAL)).toBe("8.0000");
    // o limite exato cabe (≤)
    const p2 = await criado("orders", topReserva, [item("2")]);
    expect(await reservado(ALM, SAL)).toBe("10.0000");
    // e o físico não mudou: reservar não é baixar
    expect(await fisico(ALM, SAL)).toBe("10.0000");
    await cancelar("orders", p8); await cancelar("orders", p2);
  });

  it("a quantidade soma por (armazém, produto); cada par que não cabe é uma linha; número PT-BR sem zeros à direita", async () => {
    await semReserva();
    const antes = await contar("order");
    // dois itens do mesmo par somam 11 > 10
    recusa(await criar("orders", topReserva, [item("6"), item("5")]), linha(nomeSal, nomeAlm, "10", "11"), [{ path: "items", message: linha(nomeSal, nomeAlm, "10", "11") }]);
    // decimal: vírgula, sem zeros
    recusa(await criar("orders", topReserva, [item("10.5000")]), linha(nomeSal, nomeAlm, "10", "10,5"), [{ path: "items", message: linha(nomeSal, nomeAlm, "10", "10,5") }]);
    // dois pares sem saldo: duas linhas, na ordem dos itens, unidas por quebra de linha; o par que cabe (Silo) não aparece
    const l1 = linha(nomeSal, nomeAlm, "10", "11"); const l2 = linha(nomeRacao, nomeAlm, "0", "1");
    recusa(await criar("orders", topReserva, [item("11"), item("5", SILO), item("1", ALM, RACAO)]), `${l1}\n${l2}`, [{ path: "items", message: l1 }, { path: "items", message: l2 }]);
    expect(await contar("order")).toBe(antes);
    // o mesmo produto em armazéns diferentes é outro par: 10 no Almoxarifado e 5 no Silo cabem juntos
    const id = await criado("orders", topReserva, [item("10"), item("5", SILO)]);
    expect([await reservado(ALM, SAL), await reservado(SILO, SAL)]).toEqual(["10.0000", "5.0000"]);
    await cancelar("orders", id);
  });
});

describe("RE-4 — o armazém é obrigatório e tem de ser da empresa do documento", () => {
  it("sem armazém → 422 no campo do item; armazém de outra empresa → 422 no campo do item; nada gravado", async () => {
    await semReserva();
    const antes = await contar("order");
    const obrigatorio = "Informe o armazém: esta operação reserva estoque.";
    recusa(await criar("orders", topReserva, [item("1", null)]), obrigatorio, [{ path: "items[0].warehouse_id", message: obrigatorio }]);
    recusa(await criar("orders", topReserva, [{ ...item("1"), warehouse_id: null }]), obrigatorio, [{ path: "items[0].warehouse_id", message: obrigatorio }]);
    recusa(await criar("orders", topReserva, [item("1"), item("1", null), item("1", null, RACAO)]), obrigatorio,
      [{ path: "items[1].warehouse_id", message: obrigatorio }, { path: "items[2].warehouse_id", message: obrigatorio }]);
    const outra = "O armazém não é da empresa do documento.";
    recusa(await criar("orders", topReserva, [item("1"), item("1", I.warehouseEmpresa2)]), outra, [{ path: "items[1].warehouse_id", message: outra }]);
    expect(await contar("order")).toBe(antes);
    // PREMISSA: o MESMO corpo sem armazém, com a TOP que não reserva, salva — a recusa acima é da reserva.
    const id = await criado("orders", topSemReserva, [item("1", null)]);
    // e o PUT que troca para a TOP que reserva confere pela versão NOVA
    recusa(await editar("orders", id, topReserva, [item("1", null)]), obrigatorio, [{ path: "items[0].warehouse_id", message: obrigatorio }]);
    recusa(await editar("orders", id, topReserva, [item("1", I.warehouseEmpresa2)]), outra, [{ path: "items[0].warehouse_id", message: outra }]);
    expect(await quantidades(id)).toEqual(["1.0000"]);
    await cancelar("orders", id);
  });
});

describe("PUT do pedido com reserva — o próprio pedido não conta contra si", () => {
  it("pedido de 8 → PUT para 10 salva; PUT para 11 → 422 'disponível 10, pedido 11' e o gravado fica; tirar o armazém → 422", async () => {
    await semReserva();
    const id = await criado("orders", topReserva, [item("8")]);
    const r10 = await editar("orders", id, null, [item("10")]);
    expect(r10.statusCode, r10.body).toBe(200);
    expect([await quantidades(id), await reservado(ALM, SAL)]).toEqual([["10.0000"], "10.0000"]);
    recusa(await editar("orders", id, null, [item("11")]), linha(nomeSal, nomeAlm, "10", "11"), [{ path: "items", message: linha(nomeSal, nomeAlm, "10", "11") }]);
    const obrigatorio = "Informe o armazém: esta operação reserva estoque.";
    recusa(await editar("orders", id, null, [item("10", null)]), obrigatorio, [{ path: "items[0].warehouse_id", message: obrigatorio }]);
    expect([await quantidades(id), await reservado(ALM, SAL)]).toEqual([["10.0000"], "10.0000"]);
    // com o pedido reservando 10, outro pedido não leva nada
    recusa(await criar("orders", topReserva, [item("1")]), linha(nomeSal, nomeAlm, "0", "1"), [{ path: "items", message: linha(nomeSal, nomeAlm, "0", "1") }]);
    // PUT que troca para a TOP SEM reserva: não confere nada (e solta a reserva)
    const sem = await editar("orders", id, topSemReserva, [item("999", null)]);
    expect(sem.statusCode, sem.body).toBe(200);
    expect([await quantidades(id), await reservado(ALM, SAL)]).toEqual([["999.0000"], "0.0000"]);
    await cancelar("orders", id);
  });
});

describe("Orçamento e pedido sem reserva — nada muda", () => {
  it("orçamento com TOP (qualquer) não exige armazém nem confere estoque; pedido sem reserva também não", async () => {
    await semReserva();
    const orc = await criado("budgets", topOrcamento, [item("999", null)]);
    const e = await editar("budgets", orc, null, [item("1000", null)]);
    expect(e.statusCode, e.body).toBe(200);
    const doc = await ler("budgets", orc);
    expect(doc.reserva_estoque).toBe(false);
    expect(doc.items[0]).not.toHaveProperty("reservado");
    const ped = await criado("orders", topSemReserva, [item("999")]);
    expect(await reservado(ALM, SAL), "pedido sem reserva não reserva").toBe("0.0000");
    const legado = await criado("orders", null, [item("999", null)]);
    await cancelar("budgets", orc); await cancelar("orders", ped); await cancelar("orders", legado);
  });
});

describe("Conversão orçamento → pedido cuja TOP destino reserva — a mesma conferência do POST", () => {
  it("11 com físico 10 → 422 sem gerar pedido; orçamento sem armazém → 422 no campo; 4 → gera o pedido e reserva 4", async () => {
    await semReserva();
    const converter = (id: string) => h.app.inject({ method: "POST", url: `/api/sales/budgets/${id}/convert`, headers: h.headers(), payload: { tipo_operacao_id: topReserva } });
    const pedidosAntes = await contar("order");
    // PREMISSA: o orçamento salva sem conferir nada (orçamento nunca reserva).
    const alto = await criado("budgets", topOrcamento, [item("11")]);
    recusa(await converter(alto), linha(nomeSal, nomeAlm, "10", "11"), [{ path: "items", message: linha(nomeSal, nomeAlm, "10", "11") }]);
    const semArmazem = await criado("budgets", topOrcamento, [item("1", null)]);
    recusa(await converter(semArmazem), "Informe o armazém: esta operação reserva estoque.", [{ path: "items[0].warehouse_id", message: "Informe o armazém: esta operação reserva estoque." }]);
    expect(await contar("order"), "nenhuma recusa gerou pedido").toBe(pedidosAntes);
    expect([(await ler("budgets", alto)).status, (await ler("budgets", semArmazem)).status], "a origem fica aberta").toEqual(["open", "open"]);
    const cabe = await criado("budgets", topOrcamento, [item("4")]);
    const r = await converter(cabe);
    expect(r.statusCode, r.body).toBe(201);
    expect(await reservado(ALM, SAL), "o pedido gerado reserva pela versão da TOP destino").toBe("4.0000");
    await cancelar("orders", j(r).id as string);
    await cancelar("budgets", alto); await cancelar("budgets", semArmazem);
    await semReserva();
  });
});

describe("GET do documento — reserva_estoque e reservado por item", () => {
  it("pedido com reserva: reserva_estoque true e reservado = saldo a faturar; cancelado: 0.0000; sem reserva: sem o campo", async () => {
    await semReserva();
    const id = await criado("orders", topReserva, [item("3"), item("2", SILO)]);
    const d = await ler("orders", id);
    expect(d.reserva_estoque).toBe(true);
    expect(d.items.map((i) => [i.quantity, i["reservado"]])).toEqual([["3.0000", "3.0000"], ["2.0000", "2.0000"]]);
    // o que a tela diz é o que o banco conta
    expect([await reservado(ALM, SAL), await reservado(SILO, SAL)]).toEqual(["3.0000", "2.0000"]);
    await cancelar("orders", id);
    const c = await ler("orders", id);
    expect([c.reserva_estoque, c.items.map((i) => i["reservado"])]).toEqual([true, ["0.0000", "0.0000"]]);
    const sem = await ler("orders", await criado("orders", topSemReserva, [item("1")]));
    expect(sem.reserva_estoque).toBe(false);
    expect(sem.items[0]).not.toHaveProperty("reservado");
    await cancelar("orders", sem.id as string);
  });
});

describe("/regras-da-operacao — reservaEstoque (aditivo)", () => {
  it("pedido com reserva → true; pedido sem reserva → false; orçamento → false; o resto da resposta não muda", async () => {
    const r = await regras("orders", topReserva);
    expect(r).toEqual({ formato: expect.any(Number), exigencias: [], condicoesPermitidas: null, clienteEmAtraso: { politica: "nao_valida", toleranciaDias: 0 }, reservaEstoque: true });
    expect((await regras("orders", topSemReserva)).reservaEstoque).toBe(false);
    expect((await regras("budgets", topOrcamento)).reservaEstoque).toBe(false);
  });
});

describe("PUT da venda aberta gerada de pedido com reserva (parte B)", () => {
  it("a venda não conta contra si; não cresce além do disponível, não perde nem troca de empresa o armazém; venda sem origem não confere", async () => {
    await semReserva();
    const ped = await criado("orders", topReserva, [item("4")]);
    const conv = await h.app.inject({ method: "POST", url: `/api/sales/orders/${ped}/convert`, headers: h.headers(), payload: {} });
    expect(conv.statusCode, conv.body).toBe(201);
    const venda = j(conv).id as string;
    // PREMISSA: a reserva passou do pedido (convertido) para a venda aberta, sem mudar o total
    expect([await umValor("select status from erp.sales_documents where id=$1", [ped]), await reservado(ALM, SAL), await reservado(ALM, SAL, venda)]).toEqual(["converted", "4.0000", "0.0000"]);
    expect((await ler("sales", venda)).reserva_estoque, "venda nunca é a dona da marca").toBe(false);
    for (const q of ["4", "10"]) {
      const r = await editar("sales", venda, null, [item(q)]);
      expect(r.statusCode, r.body).toBe(200);
    }
    expect(await reservado(ALM, SAL)).toBe("10.0000");
    recusa(await editar("sales", venda, null, [item("11")]), linha(nomeSal, nomeAlm, "10", "11"), [{ path: "items", message: linha(nomeSal, nomeAlm, "10", "11") }]);
    const obrigatorio = "Informe o armazém: esta operação reserva estoque.";
    recusa(await editar("sales", venda, null, [item("10", null)]), obrigatorio, [{ path: "items[0].warehouse_id", message: obrigatorio }]);
    const outra = "O armazém não é da empresa do documento.";
    recusa(await editar("sales", venda, null, [item("1", I.warehouseEmpresa2)]), outra, [{ path: "items[0].warehouse_id", message: outra }]);
    // trocar de armazém só se couber no outro: o Silo tem 5
    recusa(await editar("sales", venda, null, [item("6", SILO)]), linha(nomeSal, nomeSilo, "5", "6"), [{ path: "items", message: linha(nomeSal, nomeSilo, "5", "6") }]);
    expect(await quantidades(venda)).toEqual(["10.0000"]);
    // a parte B da venda conta contra os outros
    recusa(await criar("orders", topReserva, [item("1")]), linha(nomeSal, nomeAlm, "0", "1"), [{ path: "items", message: linha(nomeSal, nomeAlm, "0", "1") }]);
    await cancelar("sales", venda);
    expect(await reservado(ALM, SAL)).toBe("0.0000");
    // venda SEM origem: nenhuma conferência
    const avulsa = await criado("sales", null, [item("999", null)]);
    const e = await editar("sales", avulsa, null, [item("1000", null)]);
    expect(e.statusCode, e.body).toBe(200);
    await cancelar("sales", avulsa);
  });
});

describe("Contagem de consultas por salvamento", () => {
  const padroes = {
    flag: /select reserva_estoque from erp\.tipos_operacao_versoes/,
    armazens: /from erp\.warehouses where organization_id = \$1 and empresa_id = \$2 and id = any/,
    trava: /from erp\.products where organization_id = \$1 and id = any\(\$2::uuid\[\]\) order by id for no key update/,
    reservado: /from erp\.reserva_estoque\(/,
    fisico: /from unnest\(\$2::uuid\[\], \$3::uuid\[\]\)/,
  };
  async function medir(fazer: () => Promise<Resposta>): Promise<{ r: Resposta; n: Record<keyof typeof padroes, number> }> {
    const espiao = vi.spyOn(pg.Client.prototype, "query");
    try {
      const r = await fazer();
      const textos = espiao.mock.calls.map((c) => (typeof c[0] === "string" ? c[0] : ""));
      const n = Object.fromEntries(Object.entries(padroes).map(([k, re]) => [k, textos.filter((t) => re.test(t)).length])) as Record<keyof typeof padroes, number>;
      return { r, n };
    } finally { espiao.mockRestore(); }
  }
  it("pedido com reserva (3 itens, 2 pares): 1 flag + 1 armazéns + 1 trava + 1 físico + 1 reservado — por documento, não por item", async () => {
    await semReserva();
    const post = await medir(() => criar("orders", topReserva, [item("1"), item("1"), item("1", SILO)]));
    expect(post.r.statusCode, post.r.body).toBe(201);
    expect(post.n).toEqual({ flag: 1, armazens: 1, trava: 1, reservado: 1, fisico: 1 });
    const id = j(post.r).id as string;
    // PUT sem trocar a TOP: a marca vem do getDoc (zero consulta de flag)
    const put = await medir(() => editar("orders", id, null, [item("2"), item("1", SILO)]));
    expect(put.r.statusCode, put.r.body).toBe(200);
    expect(put.n).toEqual({ flag: 0, armazens: 1, trava: 1, reservado: 1, fisico: 1 });
    await cancelar("orders", id);
  });
  it("pedido sem reserva: só a leitura da marca; orçamento e pedido sem TOP: nenhuma", async () => {
    const sem = await medir(() => criar("orders", topSemReserva, [item("1")]));
    expect(sem.r.statusCode, sem.r.body).toBe(201);
    expect(sem.n).toEqual({ flag: 1, armazens: 0, trava: 0, reservado: 0, fisico: 0 });
    const orc = await medir(() => criar("budgets", topOrcamento, [item("1")]));
    expect(orc.r.statusCode, orc.r.body).toBe(201);
    expect(orc.n).toEqual({ flag: 0, armazens: 0, trava: 0, reservado: 0, fisico: 0 });
    const legado = await medir(() => criar("orders", null, [item("1")]));
    expect(legado.r.statusCode, legado.r.body).toBe(201);
    expect(legado.n).toEqual({ flag: 0, armazens: 0, trava: 0, reservado: 0, fisico: 0 });
    for (const [rota, r] of [["orders", sem.r], ["budgets", orc.r], ["orders", legado.r]] as const) await cancelar(rota, j(r).id as string);
  });
});

describe("A trava do salvamento — o modo (a instrução REAL do módulo)", () => {
  it("segura o `update erp.products` do gatilho de saldo e outro salvamento com reserva; NÃO segura a FK de item/movimento que cita o produto", async () => {
    const pool = createPool(TEST_URL, { max: 2 });
    const c1 = await pool.connect(); const c2 = await pool.connect();
    const tentar = async (sql: string, p: unknown[]) => {
      await c2.query("begin"); await c2.query("set local lock_timeout = '300ms'");
      try { return await c2.query(sql, p); } finally { await c2.query("rollback"); }
    };
    try {
      await c1.query("begin");
      expect((await c1.query(SQL_TRAVA_PRODUTOS, [h.demo.orgId, [SAL]])).rowCount, "premissa: a trava achou o produto").toBe(1);
      // o gatilho de saldo da 0003 (`update erp.products set average_cost = …`, NO KEY UPDATE) espera o pedido
      await expect(tentar("update erp.products set average_cost = average_cost where id = $1", [SAL])).rejects.toMatchObject({ code: "55P03" });
      // outro salvamento com reserva do mesmo produto espera
      await expect(tentar(SQL_TRAVA_PRODUTOS, [h.demo.orgId, [SAL]])).rejects.toMatchObject({ code: "55P03" });
      // a verificação de FK de um INSERT que cita o produto (a mesma instrução que o PostgreSQL usa) passa direto
      expect((await tentar("select 1 from only erp.products x where x.id = $1 for key share of x", [SAL])).rowCount).toBe(1);
    } finally { await c1.query("rollback"); c1.release(); c2.release(); await pool.end(); }
  });
});

describe("Vale a versão CONGELADA no pedido (por último: muda a TOP da suíte)", () => {
  it("a TOP ganha versão sem reserva: o pedido antigo continua conferindo no PUT; o novo não confere; /regras-da-operacao passa a false", async () => {
    await semReserva();
    const antigo = await criado("orders", topReserva, [item("8")]);
    await versaoNova(topReserva, false);
    expect((await regras("orders", topReserva)).reservaEstoque).toBe(false);
    // o pedido novo nasce na versão sem reserva: sem armazém e acima do disponível, salva
    const novo = await criado("orders", topReserva, [item("50", null)]);
    expect((await ler("orders", novo)).reserva_estoque).toBe(false);
    // o antigo mantém a versão dele (reserva 8) e o PUT continua conferindo
    expect((await ler("orders", antigo)).reserva_estoque).toBe(true);
    recusa(await editar("orders", antigo, null, [item("11")]), linha(nomeSal, nomeAlm, "10", "11"), [{ path: "items", message: linha(nomeSal, nomeAlm, "10", "11") }]);
    expect(await reservado(ALM, SAL)).toBe("8.0000");
    await cancelar("orders", antigo); await cancelar("orders", novo);
  });
});
