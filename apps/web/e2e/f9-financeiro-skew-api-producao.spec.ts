import { test, expect, type Page, type Request } from "@playwright/test";
import { api, login } from "./helpers";

/**
 * OPERACOES-01 F9 · K-1, SENTIDO 1 — O WEB DESTE HEAD CONTRA A API DA BASE (decisão 286; a janela "web antes da API").
 *
 * POR QUE ESTE NOME. O version skew roda em `playwright.skew.config.ts`, cujo `testMatch` é `/skew-api-producao\.spec\.ts/`
 * (sem âncora): este arquivo entra pelo fim do nome, e o `playwright.config.ts` comum o ignora pelo mesmo padrão (lá a
 * API seria a deste HEAD e o caso ficaria verde por vacuidade). Arquivo PRÓPRIO: o `skew-api-producao.spec.ts` é
 * compartilhado entre PRs (PRE-PR-02).
 *
 * O MUNDO É PERGUNTADO À BASE NA HORA, pelas DUAS portas que nascem juntas na F9: `financeiroPelaTop` em
 * `GET /api/financeiro/capacidades` (404 = a rota nem existe naquele binário) e `capacidades.lcdpr` em
 * `GET /api/auth/context`. As duas respostas têm de descrever o MESMO binário — uma sem a outra é defeito, não skew —,
 * e a resposta decide o ramo. Os dois ramos cobram prova POSITIVA, e nenhum só passa:
 *   · LEGADO (a base de hoje, 622f194 — ou uma base só com a Central da F8): o "Novo movimento bancário" é o de hoje (sem
 *     a TOP e sem o imóvel) e o corpo do POST tem EXATAMENTE as chaves de hoje — e a base o aceita (201); o Livro Caixa é
 *     só o painel, sem a conferência do LCDPR; a natureza não tem "Tipo no LCDPR"; e NENHUM pedido sai para
 *     `/api/financeiro/tops`, `/api/financeiro/imoveis-rurais` ou `/api/financeiro/lcdpr` — contado no fio.
 *   · NOVO (a base já com a F9, depois do merge): as provas inversas — o movimento com a TOP e o imóvel (e a chave
 *     `imovel_rural_id` no corpo), a conferência no Livro Caixa (pedida ao servidor) e o "Tipo no LCDPR" na natureza.
 * Não há mock: o servidor é o binário da base, servindo o banco migrado e semeado por este HEAD.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
type Mundo = "legado" | "novo";
/** As rotas que a F9 cria: no mundo legado, o web deste HEAD não pode pedir nenhuma delas. */
const ROTAS_DA_F9 = ["/api/financeiro/tops", "/api/financeiro/imoveis-rurais", "/api/financeiro/lcdpr"];
/**
 * As chaves do corpo de HOJE do "Novo movimento bancário" (entrada ou saída, com rateio) — as do formulário da base:
 * o estado do formulário mais o rateio. Nenhuma a mais, nenhuma a menos.
 */
const CHAVES_DO_MOVIMENTO_DE_HOJE = [
  "amount", "apportionment", "bank_account_id", "category_type", "destination_account_id", "document", "empresa_id", "generates_obligation",
  "harvest_id", "interest", "is_deductible", "movement_date", "note", "person_id", "proprietary_id", "type"
];

async function cabecalhosDaSessao(page: Page): Promise<Record<string, string>> {
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token?: string; orgId?: string });
  return { authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}) };
}

/**
 * Vigia do navegador: CORS morto não vira exceção nem resposta HTTP (o Chromium aborta antes), e sem o coletor a tela
 * renderiza vazia e o teste passa. Também anota CADA pedido às rotas da F9.
 */
function vigiar(page: Page) {
  const falhas: string[] = []; const daF9: string[] = [];
  page.on("requestfailed", (r) => { if (r.url().includes(API)) falhas.push(`${r.url()} → ${r.failure()?.errorText ?? "?"}`); });
  page.on("console", (m) => { if (m.type() === "error" && /CORS|preflight|Access-Control/i.test(m.text())) falhas.push(`console: ${m.text()}`); });
  page.on("request", (r: Request) => { const u = new URL(r.url()); if (ROTAS_DA_F9.some((p) => u.pathname.startsWith(p))) daF9.push(`${r.method()} ${u.pathname}`); });
  return {
    semBloqueio: () => expect(falhas, "nenhuma requisição pode morrer no navegador (CORS/preflight)").toEqual([]),
    semRotasDaF9: () => expect(daF9, "no legado, nenhum pedido sai para as rotas da F9").toEqual([]),
    pedidosDaF9: () => [...daF9]
  };
}

async function perguntarABase(page: Page): Promise<Mundo> {
  const cab = await cabecalhosDaSessao(page);
  const cap = await page.request.get(`${API}/api/financeiro/capacidades`, { headers: cab });
  expect([200, 404], "a base ou declara a capacidade ou não conhece a rota — outro código é defeito, não skew").toContain(cap.status());
  const financeiro = cap.status() === 200 ? await cap.json() as Record<string, unknown> : null;
  const ctx = await page.request.get(`${API}/api/auth/context`, { headers: cab });
  expect(ctx.status(), "premissa: a base serve o contexto da sessão").toBe(200);
  const capacidades = (await ctx.json() as { capacidades?: Record<string, unknown> }).capacidades ?? {};
  const pelaTop = financeiro?.["financeiroPelaTop"] === 1; const lcdpr = capacidades["lcdpr"] === 1;
  expect(lcdpr, "`financeiroPelaTop` e `capacidades.lcdpr` nascem no MESMO binário: uma sem a outra é defeito").toBe(pelaTop);
  if (financeiro) expect(financeiro["centralFinanceira"], "a capacidade do financeiro só existe com a Central").toBe(1);
  if (pelaTop) expect(financeiro, "a base declara o financeiro pela TOP na forma e versão exatas").toEqual({ centralFinanceira: 1, financeiroPelaTop: 1 });
  const mundo: Mundo = pelaTop ? "novo" : "legado";
  console.log(`[skew] OPERACOES-01 F9 · K-1 · a base responde ${cap.status()} a GET /api/financeiro/capacidades (financeiroPelaTop ${pelaTop ? "1" : "ausente"}) e lcdpr ${lcdpr ? "1" : "ausente"} no /auth/context → mundo ${mundo}`);
  return mundo;
}

/** Escolhe a opção num seletor de referência já aberto (o painel da busca). */
async function escolherNoPainel(page: Page, busca: string) {
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(busca);
  await painel.getByRole("option", { name: new RegExp(busca.slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).first().click();
}

test("OPERACOES-01 F9 · K-1 (sentido 1) — Novo movimento bancário: com a API da base, a tela e o corpo de HOJE, aceitos; com a F9, a TOP e o imóvel", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const mundo = await perguntarABase(page);
  const um = async (caminho: string) => { const r = await api<{ items: { id: string; name: string }[] }>(page, "GET", caminho); expect(r.items[0], `premissa: ${caminho}`).toBeTruthy(); return r.items[0]!; };
  const natureza = await um("/api/resources/financial_categories?kind=analytic&nature=expense&pageSize=1");
  const centro = await um("/api/resources/cost_centers?kind=analytic&pageSize=1");

  await page.goto("/financeiro/movimentos/new");
  await expect(page.getByRole("heading", { name: "Novo movimento bancário" })).toBeVisible();
  await expect(page.getByLabel(/^Valor\b/).first()).toBeVisible();
  if (mundo === "legado") {
    await expect(page.getByTestId("fin-movimento-operacao"), "sem a capacidade, nada da TOP").toHaveCount(0);
    await expect(page.getByTestId("fin-movimento-top")).toHaveCount(0);
    await expect(page.getByTestId("fin-movimento-imovel"), "sem a capacidade, nada do imóvel").toHaveCount(0);
  } else {
    await expect(page.getByTestId("fin-movimento-operacao"), "com a F9, a TOP primeiro (o seletor, ou o aviso de família sem TOP)").toBeVisible();
    await expect(page.getByTestId("fin-movimento-imovel"), "e o imóvel do livro caixa na saída da empresa").toBeEnabled();
  }

  await page.locator("label", { hasText: "Conta bancária" }).first().locator("..").getByRole("combobox").click();
  await escolherNoPainel(page, "Banco do Brasil");
  await page.getByLabel(/^Valor\b/).first().fill("12.34");
  const linha = page.locator("table").last().locator("tbody tr").first();
  await linha.getByRole("combobox").nth(0).click();
  await escolherNoPainel(page, natureza.name);
  await linha.getByRole("combobox").nth(1).click();
  await escolherNoPainel(page, centro.name);

  const corpos: Record<string, unknown>[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/financial/bank-movements") corpos.push(r.postDataJSON() as Record<string, unknown>); });
  const resposta = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/financial/bank-movements");
  await page.getByRole("button", { name: "Salvar" }).click();
  const r = await resposta;
  expect(r.status(), "a API da base aceita o movimento que este web manda").toBe(201);
  expect(corpos, "um pedido de criação no fio").toHaveLength(1);
  const chaves = Object.keys(corpos[0]!).sort();
  if (mundo === "legado") {
    expect(chaves, "o corpo de HOJE, chave por chave").toEqual([...CHAVES_DO_MOVIMENTO_DE_HOJE].sort());
    v.semRotasDaF9();
  } else {
    expect(chaves, "com a F9, o imóvel decidido vai no corpo").toContain("imovel_rural_id");
    expect(chaves, "sem TOP escolhida, a chave da TOP não vai").not.toContain("tipo_operacao_id");
    expect(v.pedidosDaF9().some((p) => p.startsWith("GET /api/financeiro/imoveis-rurais/opcoes")), "o web pediu as opções de imóvel").toBe(true);
  }
  const { id } = await r.json() as { id: string };
  const salvo = await api<{ amount: string; type: string }>(page, "GET", `/api/financial/bank-movements/${id}`);
  expect([salvo.type, salvo.amount], "conclusão: o movimento existe na base, como foi pedido").toEqual(["out", "12.34"]);
  v.semBloqueio();
});

test("OPERACOES-01 F9 · K-1 (sentido 1) — Fiscal › Livro Caixa: com a API da base, só o painel de hoje; com a F9, a conferência do LCDPR", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const mundo = await perguntarABase(page);
  const painel = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/dashboards/cash-book");
  const conferencia = mundo === "novo" ? page.waitForResponse((r) => new URL(r.url()).pathname === "/api/financeiro/lcdpr/conferencia") : null;
  await page.goto("/fiscal?tab=livro-caixa");
  expect((await painel).status(), "o painel de hoje carrega nos dois mundos").toBe(200);
  await expect(page.getByRole("heading", { name: "Livro Caixa (LCDPR)" })).toBeVisible();
  if (mundo === "legado") {
    await expect(page.getByTestId("lcdpr-conferencia"), "sem a capacidade, nada da conferência").toHaveCount(0);
    await expect(page.getByText("Conferência do LCDPR")).toHaveCount(0);
    v.semRotasDaF9();
  } else {
    await expect(page.getByTestId("lcdpr-conferencia")).toBeVisible();
    expect((await conferencia!).status(), "a conferência é pedida ao servidor").toBe(200);
  }
  v.semBloqueio();
});

test("OPERACOES-01 F9 · K-1 (sentido 1) — natureza: com a API da base, sem \"Tipo no LCDPR\"; com a F9, com ele", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const mundo = await perguntarABase(page);
  await page.goto("/cadastros/financial_categories/new");
  await expect(page.getByLabel("Descrição *", { exact: true }), "o formulário da natureza abriu").toBeVisible();
  const campo = page.locator("label", { hasText: "Tipo no LCDPR" });
  if (mundo === "legado") {
    await expect(campo, "sem a capacidade, o campo não aparece (nem vai no corpo)").toHaveCount(0);
    v.semRotasDaF9();
  } else {
    await expect(campo.first()).toBeVisible();
  }
  v.semBloqueio();
});
