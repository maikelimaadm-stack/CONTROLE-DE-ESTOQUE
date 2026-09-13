import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { harness, ids, type Harness } from "./setup.js";

/**
 * MATRIZ A/B DOS RELATÓRIOS E PAINÉIS (PRE-BASE2-02 §17, §20).
 *
 * Cada empresa recebe um valor SENTINELA reconhecível. O usuário enxerga apenas a empresa B (Financeiro e
 * Compras). A prova não é "a lista veio menor": é que NENHUM valor exclusivo de A aparece — nem em linha,
 * nem em total, nem em acumulado. Contagem de linhas não basta quando o que pode vazar é dinheiro.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>;
type Hdr = Record<string, string>;
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { id?: string; rows?: Record<string, unknown>[]; error?: { code: string } };
let USUARIO: Hdr; let A = ""; let B = "";

// sentinelas: valores que só existem na empresa A / na empresa B
const SENT_A = "1111.11"; const SENT_B = "2222.22";
const SENT_A_BANCO = "3333.33"; const SENT_B_BANCO = "4444.44";
const SENT_A_ESTOQUE = "77"; const SENT_B_ESTOQUE = "88";

const get = (url: string, headers: Hdr) => h.app.inject({ method: "GET", url, headers });
const criar = async (url: string, payload: Record<string, unknown>) => {
  const r = await h.app.inject({ method: "POST", url, headers: h.headers(), payload });
  expect(r.statusCode, `${url}: ${r.body}`).toBe(201); return j(r).id as string;
};
/** Texto do relatório inteiro (linhas + totais): é nele que o valor da empresa A não pode aparecer. */
const textoDoRelatorio = async (key: string, headers: Hdr, query = "") => {
  const r = await get(`/api/reports/${key}${query}`, headers);
  expect(r.statusCode, `${key}: ${r.body}`).toBe(200);
  return r.body;
};

beforeAll(async () => {
  h = await harness(); I = await ids(h); A = I.farm; B = I.farm2;

  const titulo = (farm: string, valor: string, numero: string) => ({
    farm_id: farm, number: numero, person_id: I.provider, amount: valor, emission_date: "2026-09-01", due_date: "2026-04-10", note: "Sentinela",
    apportionment: [{ financial_category_id: I.category, cost_center_id: I.costCenter, percentage: "100" }]
  });
  await criar("/api/financial/payables", titulo(A, SENT_A, "SENT-A"));
  await criar("/api/financial/payables", titulo(B, SENT_B, "SENT-B"));

  const movimento = (farm: string, valor: string) => ({
    farm_id: farm, bank_account_id: I.bankAccount, movement_date: "2026-09-02", type: "in", category_type: "in", amount: valor, note: "Sentinela",
    apportionment: [{ financial_category_id: I.incomeCategory, cost_center_id: I.costCenter, percentage: "100" }]
  });
  await criar("/api/financial/bank-movements", movimento(A, SENT_A_BANCO));
  await criar("/api/financial/bank-movements", movimento(B, SENT_B_BANCO));

  const entrada = (farm: string, wh: string, valor: string) => ({
    farm_id: farm, entry_date: "2026-09-01",
    items: [{ product_id: I.product, quantity: "1", unit_value: valor, warehouse_id: wh, financial_category_id: I.category, cost_center_id: I.costCenter }]
  });
  await criar("/api/stock/input-entries", entrada(A, I.warehouse!, SENT_A_ESTOQUE));
  await criar("/api/stock/input-entries", entrada(B, I.warehouseFarm2!, SENT_B_ESTOQUE));

  const solicitacao = (farm: string, marca: string, valor: string) => ({
    farm_id: farm, request_date: "2026-09-01", request_type: "product", description: marca, justification: marca,
    items: [{ product_id: I.product, description: marca, quantity: "1", estimated_value: valor }]
  });
  await criar("/api/supply/requests", solicitacao(A, "Sentinela A", SENT_A));
  await criar("/api/supply/requests", solicitacao(B, "Sentinela B", SENT_B));

  const PERMS = [
    "report.ledger.view", "report.cash_flow_category.view", "report.account_reconciliation.view",
    "report.cost_centers_unified.view", "report.payables.view", "report.financial_movement.view",
    "report.bank_statement.view", "report.supply_sla.view", "report.supplies.view", "report.cost_calculation.view",
    "report.accumulated_income_statement.view", "report.stock_movement.view",
    "dashboard.financial.view", "dashboard.home.view", "dashboard.supply.view", "dashboard.cash_book.view", "bank_movements.view", "payables.view", "purchase_requests.view"
  ];
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: "Perfil sentinela", permissions: PERMS } });
  expect(papel.statusCode, papel.body).toBe(201);
  const membro = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: {
    name: "Sentinela", email: "sentinela@demo.local", password: "Sent@12345", role_id: j(papel).id,
    escopos_empresas: [
      { modulo: "financeiro", modo: "selecionadas", empresas: [B] },
      { modulo: "compras", modo: "selecionadas", empresas: [B] },
      { modulo: "estoque", modo: "selecionadas", empresas: [B] },
      { modulo: "fiscal", modo: "selecionadas", empresas: [B] }
    ]
  } });
  expect(membro.statusCode, membro.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "sentinela@demo.local", password: "Sent@12345" } });
  USUARIO = { authorization: `Bearer ${j(login).token}`, "x-org-id": h.demo.orgId };
}, 180_000);
afterAll(async () => { await h.app.close(); await h.db.end(); });

describe("relatórios financeiros não mostram valor da empresa não autorizada", () => {
  const financeiros = ["ledger", "cash_flow_category", "account_reconciliation", "cost_centers_unified", "payables", "financial_movement", "cost_calculation", "accumulated_income_statement"];
  it.each(financeiros)("%s: nenhum valor exclusivo da empresa A", async (key) => {
    const texto = await textoDoRelatorio(key, USUARIO, key === "accumulated_income_statement" ? "?year=2026" : "");
    for (const sentinela of [SENT_A, SENT_A_BANCO]) {
      expect(texto.includes(sentinela), `${key} vazou o valor ${sentinela} da empresa A`).toBe(false);
    }
  });
  it("o proprietário, que enxerga tudo, soma as DUAS empresas — o recorte é do escopo, não do relatório", async () => {
    // o razão agrupa por conta e categoria: os dois movimentos caem na mesma linha, então a prova é a SOMA
    const texto = await textoDoRelatorio("ledger", h.headers());
    expect(texto, "proprietário precisa ver a soma das duas empresas").toContain("7777.77");
    const doUsuario = await textoDoRelatorio("ledger", USUARIO);
    expect(doUsuario, "usuário restrito não pode ver a soma que inclui a empresa A").not.toContain("7777.77");
    expect(doUsuario).toContain(SENT_B_BANCO);
  });
  it("os valores da empresa autorizada continuam aparecendo", async () => {
    expect(await textoDoRelatorio("payables", USUARIO)).toContain(SENT_B);
    expect(await textoDoRelatorio("ledger", USUARIO)).toContain(SENT_B_BANCO);
  });
});

describe("relatórios de compras e estoque", () => {
  it("supply_sla e supplies não mostram a solicitação da empresa A", async () => {
    for (const key of ["supply_sla", "supplies"]) {
      const texto = await textoDoRelatorio(key, USUARIO);
      expect(texto.includes("Sentinela A"), `${key} vazou a solicitação da empresa A`).toBe(false);
    }
  });
  it("stock_movement não mostra o custo da empresa A", async () => {
    const texto = await textoDoRelatorio("stock_movement", USUARIO);
    expect(texto.includes(`"${SENT_A_ESTOQUE}.0000"`)).toBe(false);
  });
});

describe("extrato bancário é documento da CONTA: exige capacidade de organização", () => {
  it("sem bank_accounts.view o relatório é negado (403), em vez de devolver um extrato da organização inteira", async () => {
    const r = await get(`/api/reports/bank_statement?bank_account_id=${I.bankAccount}`, USUARIO);
    expect(r.statusCode).toBe(403);
    expect(j(r).error?.code).toBe("PERMISSION_DENIED");
  });
  it("o proprietário (capacidade de organização) continua abrindo o extrato completo", async () => {
    const r = await get(`/api/reports/bank_statement?bank_account_id=${I.bankAccount}`, h.headers());
    expect(r.statusCode, r.body).toBe(200);
  });
});

describe("painéis não somam empresa não autorizada", () => {
  it("painel financeiro: nenhum valor da empresa A e bloco de bancos restrito", async () => {
    const r = await get("/api/dashboards/financial", USUARIO);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.body.includes(SENT_A), "painel financeiro vazou valor da empresa A").toBe(false);
    const corpo = j(r) as { bank_balances: unknown[]; banks_escopo: string };
    expect(corpo.bank_balances, "saldo bancário é da organização: sem a capacidade, o bloco não vem").toEqual([]);
    expect(corpo.banks_escopo).toBe("restrito");
  });
  it("painel inicial: os blocos aplicam o módulo da própria fonte", async () => {
    const r = await get("/api/dashboards/home", USUARIO);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.body.includes(SENT_A), "painel inicial vazou valor da empresa A").toBe(false);
  });
  it.each(["/api/dashboards/financial", "/api/dashboards/home", "/api/dashboards/supply", "/api/dashboards/cash-book"])(
    "%s: varredura — nenhum valor sentinela da empresa A em bloco algum", async (url) => {
      const r = await get(url, USUARIO);
      expect(r.statusCode, `${url}: ${r.body}`).toBe(200);
      for (const sentinela of [SENT_A, SENT_A_BANCO, "Sentinela A"]) {
        expect(r.body.includes(sentinela), `${url} vazou ${sentinela}`).toBe(false);
      }
    });

  it("o proprietário vê o bloco de bancos como agregado da organização", async () => {
    const r = await get("/api/dashboards/financial", h.headers());
    const corpo = j(r) as { bank_balances: unknown[]; banks_escopo: string };
    expect(corpo.banks_escopo).toBe("organizacao");
    expect(corpo.bank_balances.length).toBeGreaterThan(0);
  });
});
