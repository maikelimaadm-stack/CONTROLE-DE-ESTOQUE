import { describe, it, expect, beforeAll, afterAll, vi, type MockInstance } from "vitest";
import { createPool, type Db } from "@agro/db";
import { addDays, money, sum } from "@agro/shared";
import { escoposDeTodosOsModulos, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * CENTRAL FINANCEIRA — TÍTULOS (OPERACOES-01 F8, decisão 285): `GET /api/financeiro/titulos` (cartões, totais, filtros
 * e página no servidor; "Todos" pela porta dinâmica), a exportação, alterar vencimento em lote, o lote de baixa
 * (consulta e recibo) e a 404 uniforme. Datas relativas ao `current_date` do BANCO. Cada caso afirma a premissa e a
 * conclusão; os títulos de cada caso têm um prefixo próprio no número, e a busca isola o caso.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db; let hoje: string;
type Hdr = Record<string, string>;
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { error?: { code: string; message: string } };
const linha = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await admin.query<T>(sql, p)).rows[0]!;
type Linha = { id: string; direcao: string; numero: string; situacao: string; saldo: string; liquido: string; pago: string; origem: { grupo: string }; bloqueado_pela_origem: boolean; conta_prevista: { id: string; descricao: string | null } | null; id_global: number | null };
type Lista = { items: Linha[]; total: number; direcoes: string[]; totais: Record<string, { valor: string; pago: string; saldo: string } | undefined>; cartoes: Record<string, { quantidade: number; valor: string; de?: string | null; ate?: string | null; disponivel?: boolean }> };

beforeAll(async () => {
  h = await harness(); I = await ids(h);
  admin = createPool(TEST_URL, { max: 2 });
  hoje = (await linha<{ d: string }>("select current_date::text as d")).d;
}, 120_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

async function membro(nome: string, email: string, perms: string[], empresas: string[] = []): Promise<Hdr> {
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome}`, permissions: perms } });
  expect(papel.statusCode, papel.body).toBe(201);
  const v = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Central@12345", role_id: j(papel).id, escopos_empresas: escoposDeTodosOsModulos(empresas) } });
  expect(v.statusCode, v.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Central@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}

async function titulo(dir: "payable" | "receivable", numero: string, valor: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: `/api/financial/${dir}s`, headers: h.headers(), payload: {
    empresa_id: I.empresa, number: numero, person_id: dir === "payable" ? I.provider : I.client, amount: valor, emission_date: hoje, due_date: addDays(hoje, 30), note: `Central ${numero}`,
    apportionment: [{ financial_category_id: dir === "payable" ? I.category : I.incomeCategory, cost_center_id: I.costCenter, percentage: "100" }], ...extra
  } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
const listar = (query: string, headers: Hdr = h.headers()) => h.app.inject({ method: "GET", url: `/api/financeiro/titulos?${query}`, headers });
const lista = async (query: string, headers?: Hdr) => { const r = await listar(query, headers); expect(r.statusCode, r.body).toBe(200); return j(r) as unknown as Lista; };

describe("capacidade", () => {
  it("GET /financeiro/capacidades declara a Central na forma e versão exatas (e, desde a F9, o financeiro pela TOP)", async () => {
    const r = await h.app.inject({ method: "GET", url: "/api/financeiro/capacidades", headers: h.headers() });
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ centralFinanceira: 1, financeiroPelaTop: 1 });
  });
});

describe("lista por direção e Todos (porta dinâmica)", () => {
  it("cada direção vê a sua; Todos vê as duas; quem só vê receber não vê pagar em Todos; sem nenhuma → 403", async () => {
    await titulo("payable", "DIRX-P1", "10.00"); await titulo("receivable", "DIRX-R1", "20.00");
    const pagar = await lista("direcao=payable&busca=DIRX-");
    expect(pagar.items.map((x) => x.numero)).toEqual(["DIRX-P1"]);
    const todos = await lista("direcao=todos&busca=DIRX-&sort=numero");
    expect(todos.items.map((x) => [x.numero, x.direcao])).toEqual([["DIRX-P1", "payable"], ["DIRX-R1", "receivable"]]);
    expect(todos.direcoes).toEqual(["payable", "receivable"]);
    const soReceber = await membro("Só receber", "central.receber@demo.local", ["receivables.view"]);
    const visto = await lista("direcao=todos&busca=DIRX-", soReceber);
    expect(visto.items.map((x) => x.numero), "o pagável existe (premissa acima) e não aparece").toEqual(["DIRX-R1"]);
    expect([visto.direcoes, visto.totais.payable]).toEqual([["receivable"], undefined]);
    expect((await listar("direcao=payable&busca=DIRX-", soReceber)).statusCode).toBe(403);
    const semNada = await membro("Sem financeiro", "central.nada@demo.local", ["products.view"]);
    const r = await listar("direcao=todos", semNada);
    expect(r.statusCode).toBe(403);
    expect(j(r).error!.code).toBe("PERMISSION_DENIED");
  });

  it("query com chave desconhecida → 422; valor inválido → 422", async () => {
    expect((await listar("direcao=payable&inventada=1")).statusCode).toBe(422);
    expect((await listar("direcao=payable&cartao=quase")).statusCode).toBe(422);
    expect((await listar("direcao=payable&valor_de=1,5")).statusCode).toBe(422);
    expect((await listar("direcao=payable&periodo_de=2026-09-10&periodo_ate=2026-09-01")).statusCode).toBe(422);
  });
});

describe("cartões e totais com as datas do banco", () => {
  it("vencido, vence hoje, a vencer e baixado no período — cada cartão conta e soma o saldo; o cartão também filtra", async () => {
    const venc = await titulo("payable", "CART-V", "100.00", { emission_date: addDays(hoje, -40), due_date: addDays(hoje, -5) });
    const hj = await titulo("payable", "CART-H", "200.00", { due_date: hoje });
    const aVencer = await titulo("payable", "CART-A", "300.00", { due_date: addDays(hoje, 10) });
    const pago = await titulo("payable", "CART-P", "400.00", { due_date: addDays(hoje, 3) });
    const b = await h.app.inject({ method: "POST", url: `/api/financial/payables/${pago}/settle`, headers: h.headers(), payload: { settlement_date: hoje, bank_account_id: I.bankAccount, amount: "150" } });
    expect(b.statusCode, b.body).toBe(201);
    expect(await linha("select status, balance::text as balance from erp.financial_titles where id=$1", [pago]), "premissa: baixa parcial hoje").toEqual({ status: "partially_paid", balance: "250.00" });
    const r = await lista("direcao=payable&busca=CART-");
    expect(r.cartoes.vencidos).toEqual({ quantidade: 1, valor: "100.00" });
    expect(r.cartoes.vence_hoje).toEqual({ quantidade: 1, valor: "200.00" });
    expect(r.cartoes.a_vencer, "o parcial que vence em 3 dias também é 'a vencer' (saldo 250)").toEqual({ quantidade: 2, valor: "550.00" });
    expect(r.cartoes.pagos_no_periodo).toMatchObject({ quantidade: 1, valor: "150.00" });
    expect(r.cartoes.pagos_no_periodo!.de! <= hoje && hoje <= r.cartoes.pagos_no_periodo!.ate!, "o período padrão é o mês corrente do banco").toBe(true);
    // F9 (decisão 286): o cartão dos previstos está disponível; nenhum previsto neste recorte.
    expect(r.cartoes.previstos).toEqual({ quantidade: 0, valor: "0.00", disponivel: true });
    expect(Object.fromEntries(r.items.map((x) => [x.numero, x.situacao]))).toEqual({ "CART-V": "vencido", "CART-H": "a_vencer", "CART-A": "a_vencer", "CART-P": "parcial" });
    // totais = soma das linhas
    expect(r.totais.payable).toEqual({ valor: money(sum(r.items.map((x) => x.liquido))), pago: money(sum(r.items.map((x) => x.pago))), saldo: money(sum(r.items.map((x) => x.saldo))) });
    expect(r.totais.payable).toEqual({ valor: "1000.00", pago: "150.00", saldo: "850.00" });
    const soVencidos = await lista("direcao=payable&busca=CART-&cartao=vencidos");
    expect([soVencidos.total, soVencidos.items.map((x) => x.id)]).toEqual([1, [venc]]);
    expect(soVencidos.cartoes.a_vencer!.quantidade, "os cartões não levam o filtro do cartão").toBe(2);
    expect((await lista("direcao=payable&busca=CART-&cartao=vence_hoje")).items.map((x) => x.id)).toEqual([hj]);
    expect((await lista("direcao=payable&busca=CART-&cartao=pagos_no_periodo")).items.map((x) => x.id)).toEqual([pago]);
    expect((await lista("direcao=payable&busca=CART-&situacao=a_vencer")).items.map((x) => x.id).sort()).toEqual([hj, aVencer].sort());
  });
});

describe("filtros no servidor", () => {
  it("origem, natureza com descendente, safra, conta prevista, TOP do documento de venda, busca, valor e ids", async () => {
    const pai = (await linha<{ parent_id: string }>("select parent_id::text as parent_id from erp.financial_categories where id=$1", [I.incomeCategory])).parent_id;
    const safra = (await linha<{ id: string }>("select id::text as id from erp.harvests where organization_id=$1 and deleted_at is null order by start_date limit 1", [h.demo.orgId])).id;
    const avulso = await titulo("receivable", "FILT-AV", "11.00", { harvest_id: safra, conta_prevista_id: I.cashAccount });
    // Venda com TOP (formato 1 = legado): a confirmação gera o título a receber com origem `sales_documents`.
    const top = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(), payload: { codigo: "9851", codigoBase: "vendas.venda", nome: "Venda F8 filtro" } });
    expect(top.statusCode, top.body).toBe(201);
    const est = await h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: h.headers(), payload: { empresa_id: I.empresa, warehouse_id: I.warehouse, product_id: I.product2, quantity: "50", unit_value: "10" } });
    expect(est.statusCode, est.body).toBe(201);
    const venda = await h.app.inject({ method: "POST", url: "/api/sales/sales", headers: h.headers(), payload: { empresa_id: I.empresa, document_date: hoje, client_id: I.client, tipo_operacao_id: j(top).id, items: [{ product_id: I.product2, warehouse_id: I.warehouse, quantity: "1", unit_price: "77.00" }] } });
    expect(venda.statusCode, venda.body).toBe(201);
    const conf = await h.app.inject({ method: "POST", url: `/api/sales/sales/${j(venda).id}/confirm`, headers: h.headers() });
    expect(conf.statusCode, conf.body).toBe(200);
    const deVenda = (j(conf).title_ids as string[])[0]!;
    expect(await linha("select source_type from erp.financial_titles where id=$1", [deVenda]), "premissa: título de venda").toEqual({ source_type: "sales_documents" });
    // O título da venda recebe um prefixo de busca próprio (a venda numera "VND-…").
    await admin.query("update erp.financial_titles set note='FILT-VENDA' where id=$1", [deVenda]);

    const ids = (r: Lista) => r.items.map((x) => x.id).sort();
    expect(ids(await lista("direcao=receivable&busca=FILT-&origem=avulso")), "avulso").toEqual([avulso]);
    expect(ids(await lista("direcao=receivable&busca=FILT-&origem=venda")), "venda").toEqual([deVenda]);
    const daVenda = (await lista("direcao=receivable&busca=FILT-&origem=venda")).items[0]!;
    expect([daVenda.origem.grupo, daVenda.bloqueado_pela_origem]).toEqual(["venda", true]);
    expect(ids(await lista(`direcao=receivable&busca=FILT-&natureza_id=${pai}`)), "a natureza SINTÉTICA pai encontra os dois pelos descendentes").toEqual([avulso, deVenda].sort());
    expect(ids(await lista(`direcao=receivable&busca=FILT-&safra_id=${safra}`))).toEqual([avulso]);
    const comConta = await lista(`direcao=receivable&busca=FILT-&conta_id=${I.cashAccount}`);
    expect(comConta.items.map((x) => [x.id, x.conta_prevista?.id])).toEqual([[avulso, I.cashAccount]]);
    // A descrição vem do cadastro da conta (lida no banco: o teste não fixa o texto do seed).
    const descricaoDoCaixa = (await linha<{ d: string }>("select description as d from erp.bank_accounts where id=$1", [I.cashAccount])).d;
    expect(descricaoDoCaixa, "premissa: a conta prevista tem descrição").toBeTruthy();
    expect(comConta.items[0]!.conta_prevista!.descricao).toBe(descricaoDoCaixa);
    expect(ids(await lista(`direcao=receivable&busca=FILT-&tipo_operacao_id=${j(top).id}`)), "TOP do documento de origem").toEqual([deVenda]);
    expect(ids(await lista("direcao=receivable&busca=FILT-AV"))).toEqual([avulso]);
    expect(ids(await lista("direcao=receivable&busca=FILT-&valor_de=50&valor_ate=100"))).toEqual([deVenda]);
    expect(ids(await lista(`direcao=receivable&ids=${avulso}`))).toEqual([avulso]);
  });
});

describe("escopo de empresa", () => {
  it("usuário da empresa A não vê a B — nem na lista, nem nos cartões, nem nos totais", async () => {
    await titulo("payable", "ESC-A", "10.00", { due_date: addDays(hoje, -1) });
    await titulo("payable", "ESC-B", "90.00", { empresa_id: I.empresa2, due_date: addDays(hoje, -1) });
    const adm = await lista("direcao=payable&busca=ESC-");
    expect(adm.items.length, "premissa: o administrador vê os dois").toBe(2);
    const soA = await membro("Financeiro A", "central.a@demo.local", ["payables.view"], [I.empresa]);
    const r = await lista("direcao=payable&busca=ESC-", soA);
    expect(r.items.map((x) => x.numero)).toEqual(["ESC-A"]);
    expect(r.cartoes.vencidos).toEqual({ quantidade: 1, valor: "10.00" });
    expect(r.totais.payable).toEqual({ valor: "10.00", pago: "0.00", saldo: "10.00" });
  });
});

describe("sem N+1", () => {
  it("a página de 1 e a de 50 fazem o MESMO número de consultas", async () => {
    for (let i = 0; i < 4; i++) await titulo("payable", `N1-${i}`, "5.00");
    const espioes = new Map<object, MockInstance>();
    const contar = (cliente: object & { query: unknown }) => { if (!espioes.has(cliente)) espioes.set(cliente, vi.spyOn(cliente as { query: (...a: unknown[]) => unknown }, "query")); };
    h.db.on("acquire", contar);
    const total = () => [...espioes.values()].reduce((s, e) => s + e.mock.calls.length, 0);
    try {
      await lista("direcao=payable&busca=N1-&pageSize=1"); // aquece (pool e login)
      const a0 = total(); const um = await lista("direcao=payable&busca=N1-&pageSize=1"); const a1 = total();
      const cinquenta = await lista("direcao=payable&busca=N1-&pageSize=50"); const a2 = total();
      expect([um.items.length, cinquenta.items.length], "premissa: 1 linha × 4 linhas").toEqual([1, 4]);
      expect(a1 - a0, "premissa: o contador enxerga as consultas (contagem+cartões, página, enriquecimento, ID Global)").toBeGreaterThanOrEqual(4);
      expect(a2 - a1, "consultas da página de 50 = da página de 1").toBe(a1 - a0);
    } finally {
      h.db.off("acquire", contar);
      for (const e of espioes.values()) e.mockRestore();
    }
  });
});

describe("exportação", () => {
  it("CSV: cabeçalho, uma linha por título do recorte, dinheiro em texto; sem `export` → 403", async () => {
    await titulo("payable", "EXP-1", "1234.56"); await titulo("payable", "EXP-2", "0.10");
    const total = (await lista("direcao=payable&busca=EXP-")).total;
    const r = await h.app.inject({ method: "GET", url: "/api/financeiro/titulos/exportar?direcao=payable&busca=EXP-&formato=csv&sort=numero", headers: h.headers() });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers["content-type"]).toContain("text/csv");
    expect(r.headers["content-disposition"]).toBe("attachment; filename=\"titulos.csv\"");
    const linhasCsv = r.body.replace(/^﻿/, "").split("\r\n");
    expect(linhasCsv[0]).toBe("Código;Nº do documento;Direção;Empresa;Parceiro;Emissão;Competência;Vencimento;Parcela;Valor;Pago;Saldo;Situação;Origem;Conta prevista;Observação");
    expect(linhasCsv.length - 1, "linhas = total da lista").toBe(total);
    expect(linhasCsv[1]!.split(";").slice(1, 3)).toEqual(["EXP-1", "A pagar"]);
    expect(linhasCsv[1]!.split(";").slice(9, 12), "dinheiro como texto decimal, sem ponto flutuante").toEqual(["1234.56", "0.00", "1234.56"]);
    expect(linhasCsv[2]!.split(";")[9]).toBe("0.10");
    const xlsx = await h.app.inject({ method: "GET", url: "/api/financeiro/titulos/exportar?direcao=payable&busca=EXP-&formato=xlsx", headers: h.headers() });
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers["content-type"]).toContain("spreadsheetml");
    const soVer = await membro("Só ver pagar", "central.ver@demo.local", ["payables.view"]);
    expect((await h.app.inject({ method: "GET", url: "/api/financeiro/titulos/exportar?direcao=payable&formato=csv", headers: soVer })).statusCode).toBe(403);
  });

  it("CSV: observação e número que começam com '=', '+', '-' ou '@' saem com apóstrofo (não viram fórmula); o dinheiro continua número", async () => {
    await titulo("payable", "=FORM-1", "10.00", { note: "=HYPERLINK(\"http://x\";\"clique\")" });
    await titulo("payable", "@FORM-2", "20.00", { note: "-2+3" });
    const r = await h.app.inject({ method: "GET", url: "/api/financeiro/titulos/exportar?direcao=payable&busca=FORM-&formato=csv&sort=valor", headers: h.headers() });
    expect(r.statusCode, r.body).toBe(200);
    const linhasCsv = r.body.replace(/^\uFEFF/, "").split("\r\n").slice(1);
    expect(linhasCsv.length, "premissa: os 2 títulos do caso").toBe(2);
    expect(linhasCsv[0]!.split(";")[1]).toBe("'=FORM-1");
    expect(linhasCsv[0]!.endsWith(';"\'=HYPERLINK(""http://x"";""clique"")"'), linhasCsv[0]).toBe(true);
    expect(linhasCsv[1]!.split(";")[1]).toBe("'@FORM-2");
    expect(linhasCsv[1]!.split(";").at(-1)).toBe("'-2+3");
    expect(linhasCsv[1]!.split(";")[9], "o dinheiro não ganha apóstrofo").toBe("20.00");
  });
});

describe("ordenação e dinheiro vazio", () => {
  it("ordenar por Valor usa o LÍQUIDO que a coluna mostra (não o bruto); totais e cartões sem linhas saem '0.00'", async () => {
    await titulo("payable", "ORDV-A", "100.00", { discount: "60.00" });
    await titulo("payable", "ORDV-B", "50.00");
    const l = await lista("direcao=payable&busca=ORDV-&sort=valor&dir=asc");
    expect(l.items.map((x) => [x.numero, x.liquido]), "premissa: A tem bruto 100 e líquido 40; B, 50 e 50").toEqual([["ORDV-A", "40.00"], ["ORDV-B", "50.00"]]);
    const vazia = await lista("direcao=todos&busca=NENHUM-TITULO-ASSIM");
    expect(vazia.total, "premissa: nenhuma linha").toBe(0);
    expect([vazia.totais.payable, vazia.totais.receivable]).toEqual([{ valor: "0.00", pago: "0.00", saldo: "0.00" }, { valor: "0.00", pago: "0.00", saldo: "0.00" }]);
    expect(["vencidos", "vence_hoje", "a_vencer", "pagos_no_periodo", "previstos"].map((c) => vazia.cartoes[c]!.valor)).toEqual(["0.00", "0.00", "0.00", "0.00", "0.00"]);
  });
});

describe("alterar vencimento em lote", () => {
  it("título de documento muda; congelado é pulado; sem `edit` → 403; o motivo vai para a trilha", async () => {
    const deVenda = (await linha<{ id: string }>("select id::text as id from erp.financial_titles where source_type='sales_documents' and organization_id=$1 and status='open' limit 1", [h.demo.orgId])).id;
    const livre = await titulo("payable", "VENC-1", "10.00");
    const congelado = await titulo("payable", "VENC-2", "10.00", { emission_date: "2025-03-10", due_date: "2025-04-10" });
    const freeze = (await linha<{ id: string }>("insert into erp.financial_freezes(organization_id,empresa_id,year,month,is_frozen) values ($1,$2,2025,3,true) returning id::text as id", [h.demo.orgId, I.empresa])).id;
    try {
      const semEdit = await membro("Só ver tudo", "central.semedit@demo.local", ["payables.view", "receivables.view"]);
      const negado = await h.app.inject({ method: "POST", url: "/api/financeiro/titulos/alterar-vencimento", headers: semEdit, payload: { ids: [livre], vencimento: addDays(hoje, 60), motivo: "tentativa" } });
      expect(negado.statusCode).toBe(403);
      const novo = addDays(hoje, 45);
      const r = await h.app.inject({ method: "POST", url: "/api/financeiro/titulos/alterar-vencimento", headers: h.headers({ "idempotency-key": `venc-${novo}` }), payload: { ids: [deVenda, livre, congelado, "00000000-0000-4000-8000-000000000001"], vencimento: novo, motivo: "renegociado com o cliente" } });
      expect(r.statusCode, r.body).toBe(200);
      expect(j(r)).toEqual({ alterados: 2, itens: [
        { id: deVenda, resultado: "alterado" }, { id: livre, resultado: "alterado" },
        { id: congelado, resultado: "pulado", motivo: "periodo_congelado" }, { id: "00000000-0000-4000-8000-000000000001", resultado: "pulado", motivo: "nao_encontrado" }] });
      expect((await linha("select due_date from erp.financial_titles where id=$1", [deVenda])).due_date, "título de venda: vencimento muda").toBe(novo);
      expect((await linha("select due_date from erp.financial_titles where id=$1", [congelado])).due_date).toBe("2025-04-10");
      const trilha = await linha<{ metadata: { motivo: string; campo: string }; before: { due_date: string }; after: { due_date: string } }>("select metadata, before, after from erp.audit_logs where entity='financial_titles' and entity_id::text=$1 and action='update' and metadata ? 'motivo' order by created_at desc limit 1", [livre]);
      expect(trilha.metadata).toEqual({ motivo: "renegociado com o cliente", campo: "vencimento" });
      expect(trilha.after.due_date).toBe(novo);
    } finally { await admin.query("delete from erp.financial_freezes where id=$1", [freeze]); }
  });
});

describe("lotes por título: a direção sem capacidade é inexistente; o congelado é pulado", () => {
  const baixarHoje = (dir: "payable" | "receivable", id: string, data = hoje) => h.app.inject({ method: "POST", url: `/api/financial/${dir}s/${id}/settle`, headers: h.headers(), payload: { settlement_date: data, bank_account_id: I.bankAccount, amount: "10" } });
  const statusDasBaixas = async (id: string) => (await admin.query<{ status: string }>("select status from erp.title_settlements where title_id=$1 order by created_at", [id])).rows.map((x) => x.status);

  it("quem só tem a pagar: o UUID de um título a RECEBER sai 'nao_encontrado', igual ao inexistente — sem 403 que revele a variante", async () => {
    const soPagar = await membro("Só pagar", "central.sopagar@demo.local", ["payables.view", "payables.edit", "payables.cancel_settlement"]);
    const r = await titulo("receivable", "VAR-R1", "10.00");
    const inexistente = "00000000-0000-4000-8000-000000000077";
    expect((await baixarHoje("receivable", r)).statusCode, "premissa: o a receber tem baixa confirmada").toBe(201);
    const vencimentoAntes = (await linha<{ due_date: string }>("select due_date from erp.financial_titles where id=$1", [r])).due_date;
    expect((await h.app.inject({ method: "GET", url: `/api/financial/payables/${r}`, headers: soPagar })).statusCode, "premissa: pela rota da variante, o mesmo UUID é 404").toBe(404);

    const venc = await h.app.inject({ method: "POST", url: "/api/financeiro/titulos/alterar-vencimento", headers: soPagar, payload: { ids: [r, inexistente], vencimento: addDays(hoje, 90), motivo: "sondagem" } });
    expect(venc.statusCode, venc.body).toBe(200);
    expect(j(venc)).toEqual({ alterados: 0, itens: [{ id: r, resultado: "pulado", motivo: "nao_encontrado" }, { id: inexistente, resultado: "pulado", motivo: "nao_encontrado" }] });
    const est = await h.app.inject({ method: "POST", url: "/api/financeiro/titulos/estornar-baixas", headers: soPagar, payload: { ids: [r, inexistente], motivo: "sondagem" } });
    expect(est.statusCode, est.body).toBe(200);
    expect(j(est)).toEqual({ estornados: 0, itens: [{ id: r, resultado: "pulado", motivo: "nao_encontrado", baixas: 0 }, { id: inexistente, resultado: "pulado", motivo: "nao_encontrado", baixas: 0 }] });
    expect((await linha<{ due_date: string }>("select due_date from erp.financial_titles where id=$1", [r])).due_date, "nada mudou").toBe(vencimentoAntes);
    expect(await statusDasBaixas(r)).toEqual(["confirmed"]);
  });

  it("estornar-baixas: a baixa em mês congelado é PULADA com o motivo e as outras são estornadas (antes o lote inteiro abortava)", async () => {
    const velho = await titulo("payable", "CONG-1", "10.00", { emission_date: "2025-05-10", due_date: "2025-05-20" });
    const novo = await titulo("payable", "CONG-2", "10.00");
    expect((await baixarHoje("payable", velho, "2025-05-15")).statusCode, "premissa: baixado em maio/2025, antes do congelamento").toBe(201);
    expect((await baixarHoje("payable", novo)).statusCode).toBe(201);
    const freeze = (await linha<{ id: string }>("insert into erp.financial_freezes(organization_id,empresa_id,year,month,is_frozen) values ($1,$2,2025,5,true) returning id::text as id", [h.demo.orgId, I.empresa])).id;
    try {
      const r = await h.app.inject({ method: "POST", url: "/api/financeiro/titulos/estornar-baixas", headers: h.headers(), payload: { ids: [velho, novo], motivo: "estorno com um congelado" } });
      expect(r.statusCode, r.body).toBe(200);
      expect(j(r)).toEqual({ estornados: 1, itens: [{ id: velho, resultado: "pulado", motivo: "periodo_congelado", baixas: 0 }, { id: novo, resultado: "estornado", baixas: 1 }] });
      expect([await statusDasBaixas(velho), await statusDasBaixas(novo)]).toEqual([["confirmed"], ["cancelled"]]);
    } finally { await admin.query("delete from erp.financial_freezes where id=$1", [freeze]); }
  });
});

describe("lote de baixa: consulta e recibo; 404 uniforme", () => {
  it("GET do lote e o recibo; id malformado e inexistente dão a MESMA 404", async () => {
    const a = await titulo("payable", "LOTE-1", "40.00"); const b = await titulo("payable", "LOTE-2", "60.00");
    const r = await h.app.inject({ method: "POST", url: "/api/financial/payables/settle-batch", headers: h.headers(), payload: { ids: [a, b], settlement_date: hoje, bank_account_id: I.bankAccount, movement_mode: "single" } });
    expect(r.statusCode, r.body).toBe(201);
    const lote = j(r).lote_id as string;
    const v = await h.app.inject({ method: "GET", url: `/api/financeiro/lotes-baixa/${lote}`, headers: h.headers() });
    expect(v.statusCode, v.body).toBe(200);
    const d = j(v) as { direcao: string; data: string; situacao: string; total: string; conta: { id: string }; baixas: { titulo_id: string; numero: string }[]; movimentos: { valor: string; componente: string | null }[] };
    expect([d.direcao, d.data, d.situacao, d.total, d.conta.id]).toEqual(["payable", hoje, "confirmado", "100.00", I.bankAccount]);
    expect(d.baixas.map((x) => x.numero).sort()).toEqual(["LOTE-1", "LOTE-2"]);
    expect(d.movimentos.map((m) => [m.valor, m.componente])).toEqual([["100.00", null]]);
    const recibo = await h.app.inject({ method: "GET", url: `/api/financeiro/lotes-baixa/${lote}/recibo`, headers: h.headers() });
    expect(recibo.statusCode, recibo.body).toBe(200);
    const texto = String(j(recibo).recibo);
    for (const trecho of ["RECIBO DE BAIXA EM LOTE", "LOTE-1", "LOTE-2", "Total: R$ 100.00", "Tarifa: R$ 0.00"]) expect(texto).toContain(trecho);
    const malformado = await h.app.inject({ method: "GET", url: "/api/financeiro/lotes-baixa/nao-e-uuid", headers: h.headers() });
    const inexistente = await h.app.inject({ method: "GET", url: "/api/financeiro/lotes-baixa/00000000-0000-4000-8000-000000000002", headers: h.headers() });
    expect([malformado.statusCode, inexistente.statusCode]).toEqual([404, 404]);
    expect(j(malformado).error).toEqual(j(inexistente).error);
    // Quem só vê RECEBER: o lote (a pagar) não existe para ele — a mesma 404.
    const soReceber = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "central.receber@demo.local", password: "Central@12345" } });
    const hr = { authorization: `Bearer ${(soReceber.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
    const outraDirecao = await h.app.inject({ method: "GET", url: `/api/financeiro/lotes-baixa/${lote}`, headers: hr });
    expect([outraDirecao.statusCode, j(outraDirecao).error]).toEqual([404, j(inexistente).error]);
  });
});
