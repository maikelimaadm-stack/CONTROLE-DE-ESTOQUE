import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { D } from "@agro/shared";
import {
  f9, iniciarF9a, encerrarF9a, j, erro, DATA, linha, linhas, unico, contar, imovel, usuario, escopos, movimentosDaBaixa, type Hdr
} from "./f9a-ajuda.js";

/**
 * OPERACOES-01 F9a (decisão 286) — O LCDPR: o imóvel rural nos lançamentos de caixa e a conferência do livro.
 *   · LC-1 a baixa sem imóvel leva o PADRÃO da empresa — na baixa, no movimento principal, nos componentes (juros,
 *          tarifa), na tarifa do lote, no movimento único do lote e no crédito do excedente; empresa sem padrão → nenhum;
 *   · LC-2 imóvel de outra empresa, inexistente, de outra organização, inativo ou excluído → a MESMA 422; `null` →
 *          nenhum; a compensação não leva imóvel; o lote confere o imóvel contra a empresa de cada título;
 *   · LC-3 a conferência (as colunas, os tipos 1/2/3, a transferência, o saldo inicial e o "fora" fora, as pendências,
 *          os filtros, a paginação, o período, o escopo de UMA empresa, a permissão, o ID Global; os JUROS do movimento
 *          com rateio distribuídos pelas linhas — a soma é o caixa —; o movimento sem empresa em "sem empresa");
 *   · LC-4 as opções de imóvel (a capacidade, a empresa fora do escopo → 404, o padrão primeiro);
 *   · LC-5 o movimento: imóvel na transferência → 422; o padrão da empresa; o PUT não troca o imóvel;
 *   · LC-6 o cadastro genérico do imóvel e o "Tipo no LCDPR" da natureza (as recusas chegam certas); a capacidade.
 * Toda conclusão é lida no banco pela testemunha; "nada gravado" é a contagem antes e depois.
 */
beforeAll(iniciarF9a, 240_000);
afterAll(encerrarF9a);

const MSG_IMOVEL = "Imóvel rural inválido para a empresa do lançamento.";
const MSG_COMPENSACAO = "A compensação não movimenta caixa: não leva imóvel rural.";
const MSG_TRANSFERENCIA = "Transferência entre contas não leva imóvel rural (fica fora do LCDPR).";

const api = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown, headers: Hdr = f9.h.headers()) =>
  f9.h.app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });

let E1 = ""; let E2 = "";
/** Imóveis: A é o PADRÃO da 1ª empresa; B é outro da 1ª; C é da 2ª (que não tem padrão). */
const IM = { A: "", B: "", C: "" };

async function pagar(empresa: string, valor: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await api("POST", "/api/financial/payables", {
    empresa_id: empresa, number: `LC-${unico()}`, person_id: f9.I.provider, amount: valor, emission_date: DATA, due_date: DATA, note: "LCDPR",
    apportionment: [{ financial_category_id: f9.I.category, cost_center_id: f9.I.costCenter, percentage: "100" }], ...extra
  });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
const baixar = (titulo: string, corpo: Record<string, unknown>) =>
  api("POST", `/api/financial/payables/${titulo}/settle`, { settlement_date: DATA, bank_account_id: f9.I.bankAccount, ...corpo });
const imovelDaBaixa = async (baixa: string) => (await linha<{ i: string | null }>("select imovel_rural_id::text as i from erp.title_settlements where id=$1", [baixa])).i;

beforeAll(async () => {
  E1 = f9.I.empresa; E2 = f9.I.empresa2;
  IM.A = await imovel(E1, { padrao: true, nome: "Imóvel A", cib: "12345678" });
  IM.B = await imovel(E1, { nome: "Imóvel B" });
  IM.C = await imovel(E2, { nome: "Imóvel C" });
  // Juros e tarifa em lançamentos separados (as naturezas padrão da baixa): os componentes viram movimentos próprios.
  const n = await api("PUT", "/api/financeiro/configuracoes/naturezas-padrao", { juros_pagos_id: f9.I.category, tarifa_bancaria_id: f9.I.category });
  expect(n.statusCode, n.body).toBe(200);
}, 120_000);

// ---------------------------------------------------------------------------------------------------------------
describe("LC-1 — a baixa sem imóvel leva o padrão da empresa", () => {
  it("baixa com juros e tarifa: o padrão na baixa, no principal e nos dois componentes", async () => {
    const t = await pagar(E1, "100.00");
    const r = await baixar(t, { amount: "100.00", interest: "5.00", tarifa: "2.00" });
    expect(r.statusCode, r.body).toBe(201);
    const sid = j(r).settlement_id as string;
    expect(await imovelDaBaixa(sid)).toBe(IM.A);
    const movs = await movimentosDaBaixa(sid);
    expect(movs.map((m) => [m.papel, m.componente, m.amount]), "premissa: principal, juros e tarifa em movimentos próprios").toEqual([["principal", null, "100.00"], ["componente", "juros", "5.00"], ["componente", "tarifa", "2.00"]]);
    expect(movs.map((m) => m.imovel_rural_id)).toEqual([IM.A, IM.A, IM.A]);
  });

  it("empresa SEM imóvel padrão: nenhum (o imóvel dela existe, mas não é o padrão)", async () => {
    const t = await pagar(E2, "60.00");
    const r = await baixar(t, { amount: "60.00" });
    expect(r.statusCode, r.body).toBe(201);
    expect(await imovelDaBaixa(j(r).settlement_id as string)).toBeNull();
    expect((await movimentosDaBaixa(j(r).settlement_id as string)).map((m) => m.imovel_rural_id)).toEqual([null]);
  });

  it("o imóvel informado (outro da mesma empresa) vence o padrão", async () => {
    const t = await pagar(E1, "30.00");
    const r = await baixar(t, { amount: "30.00", imovel_rural_id: IM.B });
    expect(r.statusCode, r.body).toBe(201);
    expect(await imovelDaBaixa(j(r).settlement_id as string)).toBe(IM.B);
    expect((await movimentosDaBaixa(j(r).settlement_id as string)).map((m) => m.imovel_rural_id)).toEqual([IM.B]);
  });

  it("o EXCEDENTE vira crédito: a baixa do crédito leva o mesmo imóvel", async () => {
    const t = await pagar(E1, "80.00");
    const r = await baixar(t, { amount: "100.00", excedente: "credito" });
    expect(r.statusCode, r.body).toBe(201);
    const credito = (j(r).credito as { titulo_id: string; valor: string });
    expect(credito.valor, "premissa: o excedente de 20 virou crédito").toBe("20.00");
    const baixaDoCredito = await linha<{ i: string | null }>("select imovel_rural_id::text as i from erp.title_settlements where title_id=$1", [credito.titulo_id]);
    expect([await imovelDaBaixa(j(r).settlement_id as string), baixaDoCredito.i]).toEqual([IM.A, IM.A]);
  });

  it("lote SEPARADO com tarifa: cada baixa e a tarifa do lote com o padrão; lote ÚNICO: o movimento único com o padrão", async () => {
    const [a, b] = [await pagar(E1, "10.00"), await pagar(E1, "20.00")];
    const r = await api("POST", "/api/financial/payables/settle-batch", { ids: [a, b], settlement_date: DATA, bank_account_id: f9.I.bankAccount, tarifa: "3.00" });
    expect(r.statusCode, r.body).toBe(201);
    const lote = j(r) as { settled: number; items: { settlement_id: string }[]; tarifa_movimento_id: string };
    expect(lote.settled).toBe(2);
    for (const it of lote.items) expect(await imovelDaBaixa(it.settlement_id)).toBe(IM.A);
    const tarifa = await linha<{ i: string | null; componente: string }>("select imovel_rural_id::text as i, componente_baixa as componente from erp.bank_movements where id=$1", [lote.tarifa_movimento_id]);
    expect(tarifa).toEqual({ i: IM.A, componente: "tarifa" });
    const [c, d] = [await pagar(E1, "11.00"), await pagar(E1, "22.00")];
    const u = await api("POST", "/api/financial/payables/settle-batch", { ids: [c, d], settlement_date: DATA, bank_account_id: f9.I.bankAccount, movement_mode: "single" });
    expect(u.statusCode, u.body).toBe(201);
    const unicoMov = (j(u) as { items: { bank_movement_id: string; settlement_id: string }[] }).items;
    expect(new Set(unicoMov.map((x) => x.bank_movement_id)).size, "premissa: um movimento só").toBe(1);
    expect((await linha<{ i: string | null }>("select imovel_rural_id::text as i from erp.bank_movements where id=$1", [unicoMov[0]!.bank_movement_id])).i).toBe(IM.A);
    for (const it of unicoMov) expect(await imovelDaBaixa(it.settlement_id)).toBe(IM.A);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("LC-2 — as recusas do imóvel e o `null`", () => {
  it("de outra empresa, inexistente, de outra organização, inativo e excluído → a MESMA 422; nada gravado", async () => {
    const inativo = await imovel(E1, { nome: "Imóvel Inativo" });
    const excluido = await imovel(E1, { nome: "Imóvel Excluído" });
    await f9.admin.query("update erp.imoveis_rurais set is_active=false where id=$1", [inativo]);
    await f9.admin.query("update erp.imoveis_rurais set deleted_at=now() where id=$1", [excluido]);
    const outraOrg = (await linha<{ id: string }>("insert into erp.organizations(name,slug) values ($1,$2) returning id::text as id", [`[F9a] LC ${unico()}`, `f9a-lc-${unico()}`])).id;
    const outraEmpresa = (await linha<{ id: string }>("insert into erp.empresas(organization_id,code,name) values ($1,1,'Empresa alheia') returning id::text as id", [outraOrg])).id;
    const alheio = (await linha<{ id: string }>("insert into erp.imoveis_rurais(organization_id,empresa_id,nome) values ($1,$2,'Imóvel alheio') returning id::text as id", [outraOrg, outraEmpresa])).id;
    const t = await pagar(E1, "40.00");
    const antes = [await contar("title_settlements"), await contar("bank_movements")];
    for (const id of [IM.C, "00000000-0000-4000-8000-000000000000", alheio, inativo, excluido]) {
      const r = await baixar(t, { amount: "40.00", imovel_rural_id: id });
      expect(r.statusCode, id).toBe(422);
      expect(erro(r), id).toEqual({ code: "VALIDATION_ERROR", message: MSG_IMOVEL, details: [{ path: ["imovel_rural_id"], message: MSG_IMOVEL }] });
    }
    expect([await contar("title_settlements"), await contar("bank_movements")]).toEqual(antes);
    const ok = await baixar(t, { amount: "40.00", imovel_rural_id: IM.B });
    expect(ok.statusCode, `premissa: o imóvel válido passa no mesmo título — ${ok.body}`).toBe(201);
  });

  it("`null` explícito: nenhum imóvel, mesmo com o padrão da empresa", async () => {
    const t = await pagar(E1, "25.00");
    const r = await baixar(t, { amount: "25.00", imovel_rural_id: null });
    expect(r.statusCode, r.body).toBe(201);
    expect(await imovelDaBaixa(j(r).settlement_id as string)).toBeNull();
    expect((await movimentosDaBaixa(j(r).settlement_id as string)).map((m) => m.imovel_rural_id)).toEqual([null]);
  });

  it("a compensação (cruzada) com imóvel → 422 e nada gravado; sem imóvel, compensa (premissa)", async () => {
    const t = await pagar(E1, "50.00");
    const rec = await api("POST", "/api/financial/receivables", {
      empresa_id: E1, number: `LC2-R-${unico()}`, person_id: f9.I.client, amount: "50.00", emission_date: DATA, due_date: DATA, note: "Contrário",
      apportionment: [{ financial_category_id: f9.I.incomeCategory, cost_center_id: f9.I.costCenter, percentage: "100" }]
    });
    const contrario = j(rec).id as string;
    const antes = await contar("title_settlements");
    const r = await baixar(t, { amount: "20.00", settlement_kind: "cross_settlement", cross_title_id: contrario, imovel_rural_id: IM.A });
    expect(r.statusCode).toBe(422);
    expect(erro(r)).toEqual({ code: "VALIDATION_ERROR", message: MSG_COMPENSACAO, details: [{ path: ["imovel_rural_id"], message: MSG_COMPENSACAO }] });
    expect(await contar("title_settlements")).toBe(antes);
    const ok = await baixar(t, { amount: "20.00", settlement_kind: "cross_settlement", cross_title_id: contrario });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(await imovelDaBaixa(j(ok).settlement_id as string)).toBeNull();
  });

  it("lote com o imóvel de OUTRA empresa → 422 antes de gravar; com o da empresa, cada baixa o leva", async () => {
    const [a, b] = [await pagar(E1, "12.00"), await pagar(E1, "13.00")];
    const antes = [await contar("title_settlements"), await contar("bank_movements")];
    const r = await api("POST", "/api/financial/payables/settle-batch", { ids: [a, b], settlement_date: DATA, bank_account_id: f9.I.bankAccount, imovel_rural_id: IM.C });
    expect(r.statusCode).toBe(422);
    expect(erro(r).message).toBe(MSG_IMOVEL);
    expect([await contar("title_settlements"), await contar("bank_movements")]).toEqual(antes);
    const ok = await api("POST", "/api/financial/payables/settle-batch", { ids: [a, b], settlement_date: DATA, bank_account_id: f9.I.bankAccount, imovel_rural_id: IM.B });
    expect(ok.statusCode, ok.body).toBe(201);
    for (const it of (j(ok) as { items: { settlement_id: string }[] }).items) expect(await imovelDaBaixa(it.settlement_id)).toBe(IM.B);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("LC-3 — a conferência do LCDPR (janeiro/2037)", () => {
  const N = { R: "", C: "", A: "", F: "", S: "" };
  const MOV: Record<string, string> = {};
  type Item = { id: string; id_global: number | null; movimento_id: string; data: string; imovel: { id: string; nome: string; cib: string | null } | null; sem_empresa: boolean; conta: { id: string; codigo: string; descricao: string }; documento: string; participante: { nome: string; documento: string | null } | null; tipo: string | null; tipo_codigo: number | null; natureza: { id: string; codigo: string; nome: string } | null; entrada: string; saida: string; historico: string | null };
  type Conferencia = { de: string; ate: string; situacao: string; itens: Item[]; total: number; page: number; pageSize: number; totais: Record<string, { entradas: string; saidas: string }>; pendencias: Record<string, { quantidade: number; valor: string }>; idGlobal: { tipoEntidade: string } };
  const conferenciaDe = async (de: string, ate: string, qs: string, headers?: Hdr) => {
    const r = await api("GET", `/api/financeiro/lcdpr/conferencia?de=${de}&ate=${ate}${qs}`, undefined, headers);
    expect(r.statusCode, r.body).toBe(200);
    return j(r) as Conferencia;
  };
  const conferencia = (qs: string, headers?: Hdr) => conferenciaDe("2037-01-01", "2037-01-31", qs, headers);
  const mov = async (chave: string, corpo: Record<string, unknown>) => {
    const r = await api("POST", "/api/financial/bank-movements", { empresa_id: E1, bank_account_id: f9.I.bankAccount, type: "in", category_type: "in", ...corpo });
    expect(r.statusCode, `${chave}: ${r.body}`).toBe(201);
    MOV[chave] = j(r).id as string;
  };
  const rateio = (natureza: string) => [{ financial_category_id: natureza, cost_center_id: f9.I.costCenter, percentage: "100" }];

  beforeAll(async () => {
    const nat = async (tipo: string | null, nature: "income" | "expense") => (await linha<{ id: string }>(
      "insert into erp.financial_categories(organization_id,code,name,nature,kind,classification,tipo_lcdpr) values ($1,$2,$3,$4,'analytic','unclassified',$5) returning id::text as id",
      [f9.h.demo.orgId, `LC3${unico()}`, `Natureza LC3 ${tipo ?? "sem tipo"}`, nature, tipo])).id;
    N.R = await nat("receita", "income"); N.C = await nat("custeio_investimento", "expense"); N.A = await nat("produto_adiantado", "income");
    N.F = await nat("fora", "expense"); N.S = await nat(null, "expense");
    await mov("a", { movement_date: "2037-01-05", amount: "1000.00", document: "NF-100", person_id: f9.I.client, note: "Venda de grãos", apportionment: rateio(N.R) });
    await mov("b", { movement_date: "2037-01-06", type: "out", category_type: "out", amount: "200.00", person_id: f9.I.provider, apportionment: rateio(N.C) });
    await mov("c", { movement_date: "2037-01-07", amount: "50.00", apportionment: rateio(N.A) });
    await mov("d", { movement_date: "2037-01-08", type: "out", category_type: "out", amount: "70.00", apportionment: rateio(N.F) });
    await mov("e", { movement_date: "2037-01-09", type: "out", category_type: "out", amount: "30.00", apportionment: rateio(N.S) });
    await mov("f", { movement_date: "2037-01-10", type: "out", category_type: "out", amount: "40.00", imovel_rural_id: null, apportionment: rateio(N.C) });
    await mov("g", { movement_date: "2037-01-11", type: "out", category_type: "internal_transfer", destination_account_id: f9.I.cashAccount, amount: "500.00" });
    const abertura = await linha<{ id: string }>(
      "insert into erp.bank_movements(organization_id,empresa_id,code,bank_account_id,movement_date,type,category_type,amount) values ($1,$2,$3,$4,'2037-01-12','in','opening_balance',999) returning id::text as id",
      [f9.h.demo.orgId, E1, `LC3AB${unico()}`, f9.I.cashAccount]);
    await f9.admin.query("insert into erp.bank_movement_apportionments(movement_id,financial_category_id,cost_center_id,percentage,amount) values ($1,$2,$3,100,999)", [abertura.id, N.R, f9.I.costCenter]);
    await mov("i", { movement_date: "2037-01-13", amount: "100.00", apportionment: [{ financial_category_id: N.R, cost_center_id: f9.I.costCenter, percentage: "60" }, { financial_category_id: N.C, cost_center_id: f9.I.costCenter, percentage: "40" }] });
    // Lote ÚNICO de dois títulos a receber do cliente: o movimento não tem documento nem pessoa — a conferência mostra os
    // números dos títulos e o cliente (a pessoa única deles).
    const receber = async (numero: string, valor: string) => {
      const r = await api("POST", "/api/financial/receivables", { empresa_id: E1, number: numero, person_id: f9.I.client, amount: valor, emission_date: "2037-01-02", due_date: "2037-01-14", note: "LC3", apportionment: rateio(N.R) });
      expect(r.statusCode, r.body).toBe(201);
      return j(r).id as string;
    };
    const lote = await api("POST", "/api/financial/receivables/settle-batch", { ids: [await receber("LC3-A", "300.00"), await receber("LC3-B", "200.00")], settlement_date: "2037-01-14", bank_account_id: f9.I.bankAccount, movement_mode: "single" });
    expect(lote.statusCode, lote.body).toBe(201);
    MOV.j = (j(lote) as { items: { bank_movement_id: string }[] }).items[0]!.bank_movement_id;
    await mov("k", { empresa_id: E2, movement_date: "2037-01-15", amount: "80.00", apportionment: rateio(N.R) });
  }, 120_000);

  it("CONFERIDAS: as colunas da linha (data, imóvel, conta, documento, participante, tipo, natureza, valor) e o ID Global", async () => {
    const c = await conferencia("");
    expect([c.de, c.ate, c.situacao, c.total, c.idGlobal.tipoEntidade]).toEqual(["2037-01-01", "2037-01-31", "conferidas", 6, "bank_movements"]);
    expect(c.itens.map((x) => x.movimento_id), "a, b, c, as duas linhas do rateio de i e o lote j — nem d (fora), e/f (pendentes), g (transferência), a abertura nem k").toEqual([MOV.a, MOV.b, MOV.c, MOV.i, MOV.i, MOV.j]);
    const conta = await linha<{ codigo: string; descricao: string }>("select code as codigo, description as descricao from erp.bank_accounts where id=$1", [f9.I.bankAccount]);
    const cliente = await linha<{ nome: string; documento: string | null }>("select name as nome, document as documento from erp.people where id=$1", [f9.I.client]);
    const natR = await linha<{ codigo: string; nome: string }>("select code as codigo, name as nome from erp.financial_categories where id=$1", [N.R]);
    const idGlobal = await linha<{ n: string }>("select id_global::text as n from erp.registros_globais where tipo_entidade='bank_movements' and id_entidade=$1", [MOV.a]);
    expect(c.itens[0]).toEqual({
      id: expect.any(String), id_global: Number(idGlobal.n), movimento_id: MOV.a, data: "2037-01-05", imovel: { id: IM.A, nome: "Imóvel A", cib: "12345678" }, sem_empresa: false,
      conta: { id: f9.I.bankAccount, ...conta }, documento: "NF-100", participante: cliente, tipo: "receita", tipo_codigo: 1,
      natureza: { id: N.R, ...natR }, entrada: "1000.00", saida: "0.00", historico: "Venda de grãos"
    });
    const t = c.itens.map((x) => [x.tipo, x.tipo_codigo, x.entrada, x.saida]);
    expect([t[0], t[1], t[2], t[5]]).toEqual([["receita", 1, "1000.00", "0.00"], ["custeio_investimento", 2, "0.00", "200.00"], ["produto_adiantado", 3, "50.00", "0.00"], ["receita", 1, "500.00", "0.00"]]);
    expect([t[3], t[4]].sort(), "o rateio de i: uma linha por natureza").toEqual([["custeio_investimento", 2, "40.00", "0.00"], ["receita", 1, "60.00", "0.00"]]);
    expect(c.itens[5]).toMatchObject({ documento: "LC3-A, LC3-B", participante: cliente, imovel: { id: IM.A } });
    expect(c.itens[1]!.participante?.nome, "a pessoa do movimento").toBe((await linha<{ n: string }>("select name as n from erp.people where id=$1", [f9.I.provider])).n);
    expect(c.totais).toEqual({ receita: { entradas: "1560.00", saidas: "0.00" }, custeio_investimento: { entradas: "40.00", saidas: "200.00" }, produto_adiantado: { entradas: "50.00", saidas: "0.00" } });
    expect(c.pendencias).toEqual({ sem_imovel: { quantidade: 2, valor: "120.00" }, sem_tipo: { quantidade: 1, valor: "30.00" }, sem_empresa: { quantidade: 0, valor: "0.00" } });
  });

  it("PENDENTES: sem tipo e sem imóvel (o da 2ª empresa, sem padrão, também); o 'fora' nunca", async () => {
    const p = await conferencia("&situacao=pendentes");
    expect(p.itens.map((x) => x.movimento_id)).toEqual([MOV.e, MOV.f, MOV.k]);
    expect(p.itens.map((x) => [x.tipo, x.imovel?.id ?? null])).toEqual([[null, IM.A], ["custeio_investimento", null], ["receita", null]]);
    const fora = await linhas<{ n: string }>("select count(*)::text as n from erp.bank_movements where id=$1 and status='confirmed'", [MOV.d]);
    expect(fora, "premissa: o movimento da natureza 'fora' existe, confirmado").toEqual([{ n: "1" }]);
  });

  it("filtros (tipo, imóvel, empresa) e paginação no servidor", async () => {
    const custeio = await conferencia("&tipo=custeio_investimento");
    expect(custeio.itens.map((x) => [x.movimento_id, x.saida, x.entrada])).toEqual([[MOV.b, "200.00", "0.00"], [MOV.i, "0.00", "40.00"]]);
    expect(custeio.totais.receita, "os totais seguem o filtro").toEqual({ entradas: "0.00", saidas: "0.00" });
    expect((await conferencia(`&imovel_rural_id=${IM.B}`)).total).toBe(0);
    expect((await conferencia(`&empresa_id=${E2}&situacao=pendentes`)).itens.map((x) => x.movimento_id)).toEqual([MOV.k]);
    const p1 = await conferencia("&pageSize=2&page=1"); const p3 = await conferencia("&pageSize=2&page=3");
    expect([p1.total, p1.itens.map((x) => x.movimento_id), p3.itens.map((x) => x.movimento_id)]).toEqual([6, [MOV.a, MOV.b], [MOV.i, MOV.j]]);
  });

  it("período: de > até, mais de 366 dias, faltando e chave desconhecida → 422; 366 dias exatos → 200", async () => {
    for (const qs of ["de=2037-02-01&ate=2037-01-31", "de=2037-01-01&ate=2038-01-02", "ate=2037-01-31", "de=2037-01-01&ate=2037-01-31&inventada=1", "de=2037-01-01&ate=2037-01-31&situacao=todas"]) {
      expect((await api("GET", `/api/financeiro/lcdpr/conferencia?${qs}`)).statusCode, qs).toBe(422);
    }
    expect((await api("GET", "/api/financeiro/lcdpr/conferencia?de=2037-01-01&ate=2038-01-01")).statusCode).toBe(200);
  });

  it("JUROS com rateio: cada linha leva a sua parte (pelo percentual, a sobra na última) e a soma é o caixa; o movimento SEM empresa vai para \"sem empresa\", não para \"sem imóvel\" (fevereiro/2037)", async () => {
    const saida = async (data: string, valor: string, juros: string, rateio: { financial_category_id: string; cost_center_id: string; percentage: string }[]) => {
      const r = await api("POST", "/api/financial/bank-movements", { empresa_id: E1, bank_account_id: f9.I.bankAccount, type: "out", category_type: "out", movement_date: data, amount: valor, interest: juros, apportionment: rateio });
      expect(r.statusCode, r.body).toBe(201);
      return j(r).id as string;
    };
    const linhaDe = (natureza: string, percentual: string) => ({ financial_category_id: natureza, cost_center_id: f9.I.costCenter, percentage: percentual });
    // h1: 100 + 5 de juros, 60% custeio (tipo 2) e 40% sem tipo; h2: 90 + 1 de juros em três terços de custeio.
    const h1 = await saida("2037-02-03", "100.00", "5.00", [linhaDe(N.C, "60"), linhaDe(N.S, "40")]);
    const h2 = await saida("2037-02-04", "90.00", "1.00", [linhaDe(N.C, "33.3333"), linhaDe(N.C, "33.3333"), linhaDe(N.C, "33.3334")]);
    // PREMISSA: o rateio é gravado SEM os juros (soma = valor), e o caixa é valor + juros.
    const gravado = await linhas<{ id: string; rateio: string; caixa: string; n: string }>(
      `select m.id::text as id, sum(a.amount)::text as rateio, (m.amount + m.interest)::text as caixa, count(*)::text as n
         from erp.bank_movements m join erp.bank_movement_apportionments a on a.movement_id = m.id where m.id = any($1::uuid[]) group by m.id, m.amount, m.interest order by m.movement_date`, [[h1, h2]]);
    expect(gravado.map((x) => [x.id, x.rateio, x.caixa, x.n])).toEqual([[h1, "100.00", "105.00", "2"], [h2, "90.00", "91.00", "3"]]);
    // h3: SEM empresa (fixture do superusuário: a API põe a empresa selecionada quando o corpo não traz), entrada de 70 de receita.
    const h3 = (await linha<{ id: string }>(
      "insert into erp.bank_movements(organization_id,empresa_id,code,bank_account_id,movement_date,type,category_type,amount) values ($1,null,$2,$3,'2037-02-05','in','in',70) returning id::text as id",
      [f9.h.demo.orgId, `LC3SE${unico()}`, f9.I.bankAccount])).id;
    await f9.admin.query("insert into erp.bank_movement_apportionments(movement_id,financial_category_id,cost_center_id,percentage,amount) values ($1,$2,$3,100,70)", [h3, N.R, f9.I.costCenter]);

    const conferidas = await conferenciaDe("2037-02-01", "2037-02-28", "");
    const pendentes = await conferenciaDe("2037-02-01", "2037-02-28", "&situacao=pendentes");
    const valores = (c: Conferencia, mov: string) => c.itens.filter((x) => x.movimento_id === mov).map((x) => x.saida).sort();
    expect(valores(conferidas, h1), "h1: a linha de custeio com 60% dos juros (60 + 3)").toEqual(["63.00"]);
    expect(valores(pendentes, h1), "h1: a linha sem tipo com 40% dos juros (40 + 2)").toEqual(["42.00"]);
    expect(valores(conferidas, h2), "h2: 0,33 + 0,33 e a sobra de 0,34 na última").toEqual(["30.33", "30.33", "30.34"]);
    // A SOMA DAS LINHAS DE CADA MOVIMENTO É O CAIXA (o que o fluxo e o saldo contam).
    const soma = (mov: string) => [...conferidas.itens, ...pendentes.itens].filter((x) => x.movimento_id === mov).reduce((a, x) => a.plus(x.saida), D(0)).toFixed(2);
    expect([soma(h1), soma(h2)]).toEqual(["105.00", "91.00"]);
    expect(conferidas.totais.custeio_investimento, "o total do custeio: 63 + 91").toEqual({ entradas: "0.00", saidas: "154.00" });
    // O movimento SEM empresa: pendente com "sem empresa", fora de "sem imóvel" (ele nunca poderá ter imóvel).
    expect(pendentes.itens.filter((x) => x.movimento_id === h3).map((x) => [x.imovel, x.sem_empresa, x.tipo, x.entrada])).toEqual([[null, true, "receita", "70.00"]]);
    expect(pendentes.pendencias).toEqual({ sem_imovel: { quantidade: 0, valor: "0.00" }, sem_tipo: { quantidade: 1, valor: "42.00" }, sem_empresa: { quantidade: 1, valor: "70.00" } });
    expect(pendentes.itens.filter((x) => x.movimento_id !== h3).every((x) => x.sem_empresa === false), "premissa: os outros têm empresa").toBe(true);
  });

  it("escopo: quem vê só a 2ª empresa no Fiscal vê só a linha dela; sem `report.cash_book.view` → 403", async () => {
    const soE2 = await usuario("LC3 fiscal E2", ["report.cash_book.view"], escopos({ fiscal: [E2] }));
    expect((await conferencia("", soE2)).total, "nenhuma conferida da 1ª empresa").toBe(0);
    expect((await conferencia("&situacao=pendentes", soE2)).itens.map((x) => x.movimento_id)).toEqual([MOV.k]);
    const semPermissao = await usuario("LC3 sem livro", ["bank_movements.view"]);
    const r = await api("GET", "/api/financeiro/lcdpr/conferencia?de=2037-01-01&ate=2037-01-31", undefined, semPermissao);
    expect(r.statusCode).toBe(403);
    expect(erro(r).code).toBe("PERMISSION_DENIED");
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("LC-4 — as opções de imóvel da empresa", () => {
  it("o padrão primeiro e depois pelo nome; inativo e excluído fora", async () => {
    const r = await api("GET", `/api/financeiro/imoveis-rurais/opcoes?empresa_id=${E1}`);
    expect(r.statusCode, r.body).toBe(200);
    const fora = await linhas<{ nome: string }>("select nome from erp.imoveis_rurais where empresa_id=$1 and (not is_active or deleted_at is not null) order by nome", [E1]);
    expect(fora.map((x) => x.nome), "premissa: há inativo e excluído na empresa").toEqual(["Imóvel Excluído", "Imóvel Inativo"]);
    expect((j(r) as { itens: unknown[] }).itens).toEqual([{ id: IM.A, nome: "Imóvel A", cib: "12345678", padrao: true }, { id: IM.B, nome: "Imóvel B", cib: null, padrao: false }]);
  });

  it("sem baixar nem lançar movimento → 403; empresa fora do escopo ou inexistente → a MESMA 404; query fora do contrato → 422", async () => {
    const soVer = await usuario("LC4 só ver", ["payables.view", "bank_movements.view"]);
    expect((await api("GET", `/api/financeiro/imoveis-rurais/opcoes?empresa_id=${E1}`, undefined, soVer)).statusCode).toBe(403);
    const baixaE2 = await usuario("LC4 baixa E2", ["receivables.settle"], escopos({ financeiro: [E2] }));
    const ok = await api("GET", `/api/financeiro/imoveis-rurais/opcoes?empresa_id=${E2}`, undefined, baixaE2);
    expect(ok.statusCode, ok.body).toBe(200);
    expect((j(ok) as { itens: { id: string }[] }).itens.map((x) => x.id)).toEqual([IM.C]);
    for (const empresa of [E1, "00000000-0000-4000-8000-000000000000"]) {
      const r = await api("GET", `/api/financeiro/imoveis-rurais/opcoes?empresa_id=${empresa}`, undefined, baixaE2);
      expect(r.statusCode, empresa).toBe(404);
      expect(erro(r)).toMatchObject({ code: "NOT_FOUND", message: "Empresa não encontrada" });
    }
    for (const qs of ["empresa_id=nao-e-uuid", "", `empresa_id=${E1}&extra=1`]) expect((await api("GET", `/api/financeiro/imoveis-rurais/opcoes?${qs}`)).statusCode, qs).toBe(422);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("LC-5 — o movimento bancário e o imóvel", () => {
  const corpo = (extra: Record<string, unknown> = {}) => ({ empresa_id: E1, bank_account_id: f9.I.bankAccount, movement_date: DATA, type: "out", category_type: "out", amount: "15.00", apportionment: [{ financial_category_id: f9.I.category, cost_center_id: f9.I.costCenter, percentage: "100" }], ...extra });
  const imovelDoMovimento = async (id: string) => (await linha<{ i: string | null }>("select imovel_rural_id::text as i from erp.bank_movements where id=$1", [id])).i;

  it("transferência com imóvel → 422; imóvel de outra empresa → 422; nada gravado. Sem imóvel: o padrão; informado: ele", async () => {
    const antes = await contar("bank_movements");
    const t = await api("POST", "/api/financial/bank-movements", { empresa_id: E1, bank_account_id: f9.I.bankAccount, movement_date: DATA, type: "out", category_type: "internal_transfer", destination_account_id: f9.I.cashAccount, amount: "15.00", imovel_rural_id: IM.A });
    expect(t.statusCode).toBe(422);
    expect(erro(t)).toEqual({ code: "VALIDATION_ERROR", message: MSG_TRANSFERENCIA, details: [{ path: ["imovel_rural_id"], message: MSG_TRANSFERENCIA }] });
    const o = await api("POST", "/api/financial/bank-movements", corpo({ imovel_rural_id: IM.C }));
    expect(erro(o)).toMatchObject({ code: "VALIDATION_ERROR", message: MSG_IMOVEL });
    expect(await contar("bank_movements")).toBe(antes);
    const padrao = await api("POST", "/api/financial/bank-movements", corpo());
    expect(padrao.statusCode, padrao.body).toBe(201);
    expect(await imovelDoMovimento(j(padrao).id as string)).toBe(IM.A);
    const informado = await api("POST", "/api/financial/bank-movements", corpo({ imovel_rural_id: IM.B }));
    expect(await imovelDoMovimento(j(informado).id as string)).toBe(IM.B);
    const transf = await api("POST", "/api/financial/bank-movements", { empresa_id: E1, bank_account_id: f9.I.bankAccount, movement_date: DATA, type: "out", category_type: "internal_transfer", destination_account_id: f9.I.cashAccount, amount: "15.00" });
    expect(transf.statusCode, transf.body).toBe(201);
    const pontas = await linhas<{ i: string | null }>("select imovel_rural_id::text as i from erp.bank_movements where id=$1 or transfer_pair_id=$1", [j(transf).id]);
    expect(pontas, "a transferência e o par, sem imóvel (fora do LCDPR)").toEqual([{ i: null }, { i: null }]);
  });

  it("o PUT do movimento confirmado não troca o imóvel (409); o mesmo passa", async () => {
    const r = await api("POST", "/api/financial/bank-movements", corpo());
    const id = j(r).id as string;
    const trocar = await api("PUT", `/api/financial/bank-movements/${id}`, { imovel_rural_id: IM.B });
    expect(trocar.statusCode).toBe(409);
    const tirar = await api("PUT", `/api/financial/bank-movements/${id}`, { imovel_rural_id: null });
    expect(tirar.statusCode).toBe(409);
    expect(await imovelDoMovimento(id)).toBe(IM.A);
    const manter = await api("PUT", `/api/financial/bank-movements/${id}`, { imovel_rural_id: IM.A, note: "Mesmo imóvel" });
    expect(manter.statusCode, manter.body).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("LC-6 — o cadastro do imóvel e o tipo LCDPR da natureza", () => {
  const novo = (extra: Record<string, unknown>) => api("POST", "/api/resources/imoveis_rurais", { empresa_id: E2, nome: `Imóvel ${unico()}`, tipo_exploracao: "parceria", participacao: "50", ...extra });

  it("CIB e CAEPF fora do formato → 422 com a mensagem do cadastro; participação 0 → 422 pela restrição do banco; nada gravado", async () => {
    const antes = await contar("imoveis_rurais");
    const cib = await novo({ cib: "123" });
    expect(cib.statusCode).toBe(422);
    expect(erro(cib).details).toEqual([{ path: "cib", message: "Informe os 8 dígitos do CIB (NIRF do ITR), só números." }]);
    const caepf = await novo({ caepf: "12" });
    expect(erro(caepf).details).toEqual([{ path: "caepf", message: "Informe os 14 dígitos do CAEPF (só números)." }]);
    const zero = await novo({ participacao: "0" });
    expect(zero.statusCode).toBe(422);
    expect(erro(zero)).toMatchObject({ code: "VALIDATION_ERROR", message: "Valor inválido para o campo", details: { constraint: "chk_imoveis_rurais_participacao" } });
    expect(await contar("imoveis_rurais")).toBe(antes);
    const ok = await novo({ cib: "87654321", caepf: "12345678901234" });
    expect(ok.statusCode, `premissa: o cadastro válido entra — ${ok.body}`).toBe(201);
  });

  it("um segundo imóvel PADRÃO na mesma empresa → 409; nada gravado", async () => {
    const antes = await contar("imoveis_rurais");
    const r = await api("POST", "/api/resources/imoveis_rurais", { empresa_id: E1, nome: "Outro padrão", tipo_exploracao: "individual", participacao: "100", padrao: true });
    expect(r.statusCode).toBe(409);
    expect(erro(r).code).toBe("CONFLICT");
    expect(await contar("imoveis_rurais")).toBe(antes);
  });

  it("o 'Tipo no LCDPR' da natureza: valor fora da lista → 422; válido → 200 e gravado", async () => {
    const id = (await linha<{ id: string }>("insert into erp.financial_categories(organization_id,code,name,nature,kind,classification) values ($1,$2,'Natureza LC6','income','analytic','unclassified') returning id::text as id", [f9.h.demo.orgId, `LC6${unico()}`])).id;
    const ruim = await api("PUT", `/api/resources/financial_categories/${id}`, { tipo_lcdpr: "quatro" });
    expect(ruim.statusCode).toBe(422);
    expect((await linha<{ t: string | null }>("select tipo_lcdpr as t from erp.financial_categories where id=$1", [id])).t).toBeNull();
    const bom = await api("PUT", `/api/resources/financial_categories/${id}`, { tipo_lcdpr: "receita" });
    expect(bom.statusCode, bom.body).toBe(200);
    expect((await linha<{ t: string | null }>("select tipo_lcdpr as t from erp.financial_categories where id=$1", [id])).t).toBe("receita");
  });

  it("`/auth/context` declara `capacidades.lcdpr: 1`", async () => {
    const r = await api("GET", "/api/auth/context");
    expect((j(r) as { capacidades: { lcdpr?: unknown } }).capacidades.lcdpr).toBe(1);
  });
});
