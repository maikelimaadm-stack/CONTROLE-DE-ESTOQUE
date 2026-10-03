import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  f9, iniciarF9a, encerrarF9a, j, erro, DATA, linha, linhas, unico, contar, criarTopNo5, criarTopNo4, padroesNaVersao, usuario, type Hdr, type TopCriada
} from "./f9a-ajuda.js";

/**
 * OPERACOES-01 F9a (decisão 286) — O LANÇAMENTO AVULSO E O MOVIMENTO BANCÁRIO COM A TOP FINANCEIRA PRIMEIRO.
 *   · LT-1 `GET /financeiro/tops`: a família certa, só as ativas, a versão corrente, a padrão primeiro, a seção e os
 *          padrões com os nomes (só no formato 5); 403 sem a capacidade de lançar; 422 na query;
 *   · LT-2 o POST com TOP: tipo de título e conta prevista da TOP onde o corpo não informou (o corpo vence), TOP e versão
 *          em TODAS as parcelas e recorrências, a trilha;
 *   · LT-3 `documentoTroca` desligado: o corpo diferente dos padrões → 422 com os campos; igual ou vazio → 201;
 *   · LT-4 TOP de outra família, inativa, de outra organização, inexistente → a MESMA 422, nada gravado;
 *   · LT-5 o movimento com a TOP da família do movimento (e o título do "gera obrigação" com ela); a troca recusada; o
 *          PUT não troca a TOP;
 *   · LT-6 o PUT do título não troca a TOP (mantendo → 200);
 *   · LT-7 sem `tipo_operacao_id`: o lançamento de hoje (resposta, colunas e trilha).
 * Os padrões das TOPs são FIXTURE (superusuário na tabela da versão; a gravação pela API é provada no P3).
 */
beforeAll(iniciarF9a, 240_000);
afterAll(encerrarF9a);

const PAGAR = "financeiro.conta_a_pagar";
const RECEBER = "financeiro.conta_a_receber";
const MOVIMENTO = "financeiro.movimento_bancario";
const MSG_INDISPONIVEL = "Tipo de operação indisponível para este lançamento";
const troca = (oQue: string) => `Esta operação não deixa trocar ${oQue}: use o padrão da TOP.`;

const api = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown, headers: Hdr = f9.h.headers()) =>
  f9.h.app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });

/** Os cadastros dos padrões (todos do seed, conferidos). */
const P = { N1: "", N2: "", C1: "", C2: "", T1: "", T2: "", B1: "", B2: "" };
const nomes = {
  natureza: async (id: string) => linha<{ codigo: string; nome: string }>("select code as codigo, name as nome from erp.financial_categories where id=$1", [id]),
  centro: async (id: string) => linha<{ codigo: string; nome: string }>("select code as codigo, name as nome from erp.cost_centers where id=$1", [id]),
  tipo: async (id: string) => linha<{ nome: string }>("select name as nome from erp.title_types where id=$1", [id]),
  conta: async (id: string) => linha<{ codigo: string; descricao: string }>("select code as codigo, description as descricao from erp.bank_accounts where id=$1", [id])
};

const corpoPagar = (extra: Record<string, unknown> = {}) => ({
  empresa_id: f9.I.empresa, number: `LT-${unico()}`, person_id: f9.I.provider, amount: "300.00", emission_date: DATA, due_date: DATA, note: "Lançamento com TOP",
  apportionment: [{ financial_category_id: P.N1, cost_center_id: P.C1, percentage: "100" }], ...extra
});
const tituloNoBanco = (id: string) => linha<{ tipo_operacao_id: string | null; tipo_operacao_versao_id: string | null; title_type_id: string | null; conta_prevista_id: string | null; note: string }>(
  "select tipo_operacao_id::text as tipo_operacao_id, tipo_operacao_versao_id::text as tipo_operacao_versao_id, title_type_id::text as title_type_id, conta_prevista_id::text as conta_prevista_id, note from erp.financial_titles where id=$1", [id]);
const trilhaDoCreate = (id: string) => linha<{ metadata: Record<string, unknown> }>("select metadata from erp.audit_logs where entity='financial_titles' and entity_id=$1 and action='create' order by id desc limit 1", [id]);

let topPagar: TopCriada; let topPagar4: TopCriada; let topInativa: TopCriada; let topReceber: TopCriada; let topMovimento: TopCriada;

beforeAll(async () => {
  const outra = async (tabela: "financial_categories" | "cost_centers", base: string, extra: string) => (await linha<{ id: string }>(
    `select id::text as id from erp.${tabela} where organization_id=$1 and kind='analytic' and is_active and deleted_at is null and id<>$2${extra} order by code limit 1`, [f9.h.demo.orgId, base])).id;
  P.N1 = f9.I.category; P.N2 = await outra("financial_categories", P.N1, " and nature='expense'");
  P.C1 = f9.I.costCenter; P.C2 = await outra("cost_centers", P.C1, "");
  P.T1 = (await linha<{ id: string }>("select id::text as id from erp.title_types where organization_id is null and name='Boleto'")).id;
  P.T2 = (await linha<{ id: string }>("select id::text as id from erp.title_types where organization_id is null and name='Duplicata'")).id;
  P.B1 = f9.I.bankAccount; P.B2 = f9.I.cashAccount;
  topPagar = await criarTopNo5(PAGAR, { padrao: true, padroes: { naturezaId: P.N1, centroCustoId: P.C1, tipoTituloId: P.T1, contaBancariaId: P.B1 } });
  topPagar4 = await criarTopNo4(PAGAR);
  // Uma linha de padrões na versão do formato 4 (fixture): ela NÃO executa — só o formato 5 lê os padrões.
  await padroesNaVersao(topPagar4.id, topPagar4.versaoId, { naturezaId: P.N2, tipoTituloId: P.T2 });
  topInativa = await criarTopNo5(PAGAR);
  const inat = await f9.admin.query("update erp.tipos_operacao set ativo=false where id=$1", [topInativa.id]);
  expect(inat.rowCount, "premissa: a TOP foi inativada").toBe(1);
  topReceber = await criarTopNo5(RECEBER);
  topMovimento = await criarTopNo5(MOVIMENTO);
}, 120_000);

// ---------------------------------------------------------------------------------------------------------------
describe("LT-1 — GET /financeiro/tops", () => {
  type Item = { id: string; codigo: string; nome: string; versao: number; versaoId: string; padrao: boolean; secao: Record<string, unknown>; padroes: Record<string, unknown> };
  const lista = async (direcao: string, headers?: Hdr) => {
    const r = await api("GET", `/api/financeiro/tops?direcao=${direcao}`, undefined, headers);
    expect(r.statusCode, r.body).toBe(200);
    return j(r) as { capacidades: unknown; itens: Item[] };
  };

  it("pagar: só as ATIVAS da família, a padrão primeiro, depois pelo código; padrões com os nomes; a do formato 4 neutra e sem padrões", async () => {
    const l = await lista("pagar");
    expect(l.capacidades).toEqual({ financeiroPelaTop: 1 });
    expect(l.itens.map((x) => x.id).sort(), "nem a inativa, nem a de receber, nem a de movimento").toEqual([topPagar.id, topPagar4.id].sort());
    expect(l.itens[0]!.id, "a padrão primeiro").toBe(topPagar.id);
    const n1 = await nomes.natureza(P.N1); const c1 = await nomes.centro(P.C1); const b1 = await nomes.conta(P.B1);
    expect(l.itens[0]).toEqual({
      id: topPagar.id, codigo: topPagar.codigo, nome: topPagar.nome, versao: 1, versaoId: topPagar.versaoId, padrao: true,
      secao: { provisao: false, documentoTroca: true, semClassificacao: "padrao_legado" },
      padroes: { natureza: { id: P.N1, ...n1 }, centro: { id: P.C1, ...c1 }, tipoTitulo: { id: P.T1, nome: "Boleto" }, formaPagamento: null, conta: { id: P.B1, ...b1 } }
    });
    const quatro = l.itens.find((x) => x.id === topPagar4.id)!;
    const linhaNoBanco = await linha<{ n: string }>("select count(*)::text as n from erp.tipos_operacao_versao_financeiro where origem_versao_id=$1", [topPagar4.versaoId]);
    expect(linhaNoBanco.n, "premissa: a versão do 4 TEM linha de padrões no banco").toBe("1");
    expect(quatro).toMatchObject({ padrao: false, secao: { provisao: false, documentoTroca: true, semClassificacao: "padrao_legado" }, padroes: { natureza: null, centro: null, tipoTitulo: null, formaPagamento: null, conta: null } });
    expect((await lista("receber")).itens.map((x) => x.id)).toEqual([topReceber.id]);
    expect((await lista("movimento")).itens.map((x) => x.id)).toEqual([topMovimento.id]);
  });

  it("a versão CORRENTE: uma versão nova (nome novo) aparece no lugar da v1", async () => {
    const t = await criarTopNo5(RECEBER);
    const v2 = await linha<{ id: string }>(
      `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, configuracao, configuracao_schema_version)
       select organization_id, tipo_operacao_id, 2, 'Recebimento v2', configuracao, configuracao_schema_version from erp.tipos_operacao_versoes where id=$1 returning id::text as id`, [t.versaoId]);
    await f9.admin.query("update erp.tipos_operacao set versao_atual=2 where id=$1", [t.id]);
    const item = (await lista("receber")).itens.find((x) => x.id === t.id)!;
    expect([item.versao, item.versaoId, item.nome]).toEqual([2, v2.id, "Recebimento v2"]);
  });

  it("sem a capacidade de lançar → 403 (a direção decide qual); query fora do contrato → 422", async () => {
    const soVer = await usuario("LT1 só ver", ["payables.view", "receivables.view"]);
    const r = await api("GET", "/api/financeiro/tops?direcao=pagar", undefined, soVer);
    expect(r.statusCode).toBe(403);
    expect(erro(r).code).toBe("PERMISSION_DENIED");
    const receber = await usuario("LT1 receber", ["receivables.create"]);
    expect((await api("GET", "/api/financeiro/tops?direcao=pagar", undefined, receber)).statusCode).toBe(403);
    expect((await lista("receber", receber)).itens.length, "premissa: a capacidade certa vê a lista").toBeGreaterThan(0);
    for (const qs of ["direcao=outra", "", "direcao=pagar&extra=1"]) expect((await api("GET", `/api/financeiro/tops?${qs}`)).statusCode, qs).toBe(422);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("LT-2 — o POST a pagar com a TOP", () => {
  it("parcelado sem tipo de título nem conta: os da TOP em TODAS as parcelas, com a TOP e a versão; a trilha; o detalhe", async () => {
    const r = await api("POST", "/api/financial/payables", corpoPagar({ tipo_operacao_id: topPagar.id, plan: { installments: 3, first_due_date: DATA, interval_days: 30 } }));
    expect(r.statusCode, r.body).toBe(201);
    const ids = j(r).ids as string[];
    expect(ids).toHaveLength(3);
    for (const id of ids) expect(await tituloNoBanco(id)).toMatchObject({ tipo_operacao_id: topPagar.id, tipo_operacao_versao_id: topPagar.versaoId, title_type_id: P.T1, conta_prevista_id: P.B1 });
    expect((await trilhaDoCreate(ids[0]!)).metadata).toEqual({ count: 3, tipoOperacaoId: topPagar.id, tipoOperacaoVersaoId: topPagar.versaoId });
    const d = await api("GET", `/api/financial/payables/${ids[0]}`);
    expect(j(d)).toMatchObject({ tipo_operacao: { id: topPagar.id, codigo: topPagar.codigo, nome: topPagar.nome, versao: 1 }, title_type_id: P.T1, conta_prevista_id: P.B1, origem_nome: "Avulso" });
  });

  it("o CORPO vence o padrão (troca liberada): tipo de título e conta do corpo", async () => {
    const r = await api("POST", "/api/financial/payables", corpoPagar({ tipo_operacao_id: topPagar.id, title_type_id: P.T2, conta_prevista_id: P.B2 }));
    expect(r.statusCode, r.body).toBe(201);
    expect(await tituloNoBanco(j(r).id as string)).toMatchObject({ tipo_operacao_id: topPagar.id, title_type_id: P.T2, conta_prevista_id: P.B2 });
  });

  it("recorrente: a TOP em todas as recorrências", async () => {
    const r = await api("POST", "/api/financial/payables", corpoPagar({ tipo_operacao_id: topPagar.id, payment_type: "recurring", recurrence_type: "monthly", recurrence_count: 2 }));
    expect(r.statusCode, r.body).toBe(201);
    const ids = j(r).ids as string[];
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(await tituloNoBanco(id)).toMatchObject({ tipo_operacao_id: topPagar.id, tipo_operacao_versao_id: topPagar.versaoId, title_type_id: P.T1 });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("LT-3 — `documentoTroca` desligado", () => {
  let trava: TopCriada;
  beforeAll(async () => { trava = await criarTopNo5(PAGAR, { secao: { documentoTroca: false }, padroes: { naturezaId: P.N1, centroCustoId: P.C1, tipoTituloId: P.T1, contaBancariaId: P.B1 } }); });

  it("natureza e centro diferentes → 422 com os dois campos; tipo de título → o campo; conta → o campo; nada gravado", async () => {
    const antes = await contar("financial_titles");
    const r = await api("POST", "/api/financial/payables", corpoPagar({ tipo_operacao_id: trava.id, apportionment: [{ financial_category_id: P.N2, cost_center_id: P.C2, percentage: "100" }] }));
    expect(r.statusCode).toBe(422);
    const m = troca("a natureza e o centro de resultado");
    expect(erro(r)).toEqual({ code: "VALIDATION_ERROR", message: m, details: [{ path: ["natureza"], message: m }, { path: ["centro"], message: m }] });
    const t = await api("POST", "/api/financial/payables", corpoPagar({ tipo_operacao_id: trava.id, title_type_id: P.T2 }));
    expect(erro(t)).toMatchObject({ code: "VALIDATION_ERROR", message: troca("o tipo de título") });
    const c = await api("POST", "/api/financial/payables", corpoPagar({ tipo_operacao_id: trava.id, conta_prevista_id: P.B2 }));
    expect(erro(c)).toMatchObject({ code: "VALIDATION_ERROR", message: troca("a conta") });
    expect(await contar("financial_titles")).toBe(antes);
  });

  it("os MESMOS valores, ou vazios, passam (vazio não é troca: o padrão vale)", async () => {
    const iguais = await api("POST", "/api/financial/payables", corpoPagar({ tipo_operacao_id: trava.id, title_type_id: P.T1.toUpperCase(), conta_prevista_id: P.B1 }));
    expect(iguais.statusCode, iguais.body).toBe(201);
    const vazios = await api("POST", "/api/financial/payables", corpoPagar({ tipo_operacao_id: trava.id }));
    expect(vazios.statusCode, vazios.body).toBe(201);
    expect(await tituloNoBanco(j(vazios).id as string)).toMatchObject({ tipo_operacao_id: trava.id, title_type_id: P.T1, conta_prevista_id: P.B1 });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("LT-4 — a TOP indisponível é a MESMA 422", () => {
  it("de receber num a pagar, inativa, de outra organização e inexistente → TIPO_OPERACAO_INDISPONIVEL; nada gravado", async () => {
    const outraOrg = (await linha<{ id: string }>("insert into erp.organizations(name,slug) values ($1,$2) returning id::text as id", [`[F9a] Outra ${unico()}`, `f9a-outra-${unico()}`])).id;
    const alheia = (await linha<{ id: string }>(
      `with t as (insert into erp.tipos_operacao (organization_id, codigo, codigo_base) values ($1, $2, $3) returning id, organization_id),
            v as (insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome) select organization_id, id, 1, 'Alheia' from t returning tipo_operacao_id)
       select tipo_operacao_id::text as id from v`, [outraOrg, `A${unico()}`.slice(0, 20), PAGAR])).id;
    const antes = await contar("financial_titles");
    const premissa = await api("POST", "/api/financial/payables", corpoPagar({ tipo_operacao_id: topPagar.id }));
    expect(premissa.statusCode, `premissa: a TOP certa lança — ${premissa.body}`).toBe(201);
    for (const id of [topReceber.id, topInativa.id, alheia, "00000000-0000-4000-8000-000000000000"]) {
      const r = await api("POST", "/api/financial/payables", corpoPagar({ tipo_operacao_id: id }));
      expect(r.statusCode, id).toBe(422);
      expect(erro(r), id).toMatchObject({ code: "TIPO_OPERACAO_INDISPONIVEL", message: MSG_INDISPONIVEL });
    }
    expect(await contar("financial_titles")).toBe(antes + 1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("LT-5 — o movimento bancário com a TOP do movimento", () => {
  let trava: TopCriada;
  const corpoMov = (extra: Record<string, unknown> = {}) => ({
    empresa_id: f9.I.empresa, bank_account_id: P.B1, movement_date: DATA, type: "out", category_type: "out", amount: "45.00", note: "Movimento com TOP",
    apportionment: [{ financial_category_id: P.N1, cost_center_id: P.C1, percentage: "100" }], ...extra
  });
  const movNoBanco = (id: string) => linha<{ tipo_operacao_id: string | null; tipo_operacao_versao_id: string | null; note: string | null }>(
    "select tipo_operacao_id::text as tipo_operacao_id, tipo_operacao_versao_id::text as tipo_operacao_versao_id, note from erp.bank_movements where id=$1", [id]);
  beforeAll(async () => { trava = await criarTopNo5(MOVIMENTO, { secao: { documentoTroca: false }, padroes: { naturezaId: P.N1, centroCustoId: P.C1, contaBancariaId: P.B1 } }); });

  it("grava a TOP e a versão; a natureza ou a conta diferentes dos padrões → 422; a TOP de outra família → a 422 de indisponível", async () => {
    const r = await api("POST", "/api/financial/bank-movements", corpoMov({ tipo_operacao_id: trava.id }));
    expect(r.statusCode, r.body).toBe(201);
    expect(await movNoBanco(j(r).id as string)).toMatchObject({ tipo_operacao_id: trava.id, tipo_operacao_versao_id: trava.versaoId });
    const antes = await contar("bank_movements");
    const n = await api("POST", "/api/financial/bank-movements", corpoMov({ tipo_operacao_id: trava.id, apportionment: [{ financial_category_id: P.N2, cost_center_id: P.C1, percentage: "100" }] }));
    expect(erro(n)).toMatchObject({ code: "VALIDATION_ERROR", message: troca("a natureza") });
    const c = await api("POST", "/api/financial/bank-movements", corpoMov({ tipo_operacao_id: trava.id, bank_account_id: P.B2 }));
    expect(erro(c)).toMatchObject({ code: "VALIDATION_ERROR", message: troca("a conta") });
    const f = await api("POST", "/api/financial/bank-movements", corpoMov({ tipo_operacao_id: topPagar.id }));
    expect(erro(f)).toMatchObject({ code: "TIPO_OPERACAO_INDISPONIVEL", message: MSG_INDISPONIVEL });
    expect(await contar("bank_movements")).toBe(antes);
  });

  it("'gera obrigação': o título gerado leva a TOP do movimento", async () => {
    const r = await api("POST", "/api/financial/bank-movements", corpoMov({ tipo_operacao_id: topMovimento.id, generates_obligation: true, person_id: f9.I.provider, document: `LT5-${unico()}` }));
    expect(r.statusCode, r.body).toBe(201);
    const t = await linha<{ id: string; status: string }>("select id::text as id, status from erp.financial_titles where source_type='bank_movements' and source_id=$1", [j(r).id]);
    expect(t.status, "premissa: o título do movimento nasceu baixado").toBe("paid");
    expect(await tituloNoBanco(t.id)).toMatchObject({ tipo_operacao_id: topMovimento.id, tipo_operacao_versao_id: topMovimento.versaoId });
  });

  it("o PUT não troca a TOP do movimento confirmado (409); mantendo, a observação muda (200)", async () => {
    const r = await api("POST", "/api/financial/bank-movements", corpoMov({ tipo_operacao_id: topMovimento.id }));
    const id = j(r).id as string;
    const trocar = await api("PUT", `/api/financial/bank-movements/${id}`, { tipo_operacao_id: trava.id, note: "Outra" });
    expect(trocar.statusCode).toBe(409);
    expect(erro(trocar).message).toBe("Movimento bancário confirmado não se altera: estorne e lance outro.");
    const tirar = await api("PUT", `/api/financial/bank-movements/${id}`, { tipo_operacao_id: null });
    expect(tirar.statusCode, "tirar a TOP também é trocar").toBe(409);
    const manter = await api("PUT", `/api/financial/bank-movements/${id}`, { tipo_operacao_id: topMovimento.id.toUpperCase(), note: "Mantida" });
    expect(manter.statusCode, manter.body).toBe(200);
    expect(await movNoBanco(id)).toMatchObject({ tipo_operacao_id: topMovimento.id, note: "Mantida" });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("LT-6 — o PUT do título não troca a TOP", () => {
  it("outra TOP ou nula → 422; a mesma → 200; num título sem TOP, pôr uma → 422 e nula → 200", async () => {
    const r = await api("POST", "/api/financial/payables", corpoPagar({ tipo_operacao_id: topPagar.id }));
    const id = j(r).id as string;
    const msg = "A operação do título não muda na edição.";
    for (const tipo of [topPagar4.id, null]) {
      const t = await api("PUT", `/api/financial/payables/${id}`, { tipo_operacao_id: tipo, note: "Trocada" });
      expect(t.statusCode, String(tipo)).toBe(422);
      expect(erro(t)).toEqual({ code: "VALIDATION_ERROR", message: msg, details: [{ path: ["tipo_operacao_id"], message: msg }] });
    }
    expect((await tituloNoBanco(id)).note, "nada mudou").toBe("Lançamento com TOP");
    const mesma = await api("PUT", `/api/financial/payables/${id}`, { tipo_operacao_id: topPagar.id, note: "Mesma TOP" });
    expect(mesma.statusCode, mesma.body).toBe(200);
    expect(await tituloNoBanco(id)).toMatchObject({ tipo_operacao_id: topPagar.id, note: "Mesma TOP" });
    const sem = j(await api("POST", "/api/financial/payables", corpoPagar())).id as string;
    expect((await api("PUT", `/api/financial/payables/${sem}`, { tipo_operacao_id: topPagar.id })).statusCode).toBe(422);
    expect((await api("PUT", `/api/financial/payables/${sem}`, { tipo_operacao_id: null, note: "Sem TOP" })).statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("LT-7 — sem `tipo_operacao_id`: o lançamento de hoje", () => {
  it("a resposta `{ ids, id }`, nenhuma TOP gravada, a trilha `{ count }` de sempre; o movimento sem TOP", async () => {
    const r = await api("POST", "/api/financial/payables", corpoPagar({ conta_prevista_id: P.B2 }));
    expect(r.statusCode, r.body).toBe(201);
    const corpo = j(r);
    expect(Object.keys(corpo).sort()).toEqual(["id", "ids"]);
    expect(await tituloNoBanco(corpo.id as string)).toMatchObject({ tipo_operacao_id: null, tipo_operacao_versao_id: null, title_type_id: null, conta_prevista_id: P.B2 });
    expect((await trilhaDoCreate(corpo.id as string)).metadata).toEqual({ count: 1 });
    const m = await api("POST", "/api/financial/bank-movements", { empresa_id: f9.I.empresa, bank_account_id: P.B1, movement_date: DATA, type: "in", category_type: "in", amount: "5.00", apportionment: [{ financial_category_id: f9.I.incomeCategory, cost_center_id: P.C1, percentage: "100" }] });
    expect(m.statusCode, m.body).toBe(201);
    expect(Object.keys(j(m))).toEqual(["id"]);
    const mov = await linhas<{ tipo_operacao_id: string | null }>("select tipo_operacao_id::text as tipo_operacao_id from erp.bank_movements where id=$1", [j(m).id]);
    expect(mov).toEqual([{ tipo_operacao_id: null }]);
  });
});
