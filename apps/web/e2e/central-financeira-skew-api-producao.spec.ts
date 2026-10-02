import { test, expect, type Page, type Request } from "@playwright/test";
import { login, api, empresaAtiva } from "./helpers";

/**
 * OPERACOES-01 F8 · K-1, SENTIDO 1 — O WEB DESTE HEAD CONTRA A API DA BASE (decisão 285; a janela "web antes da API").
 *
 * POR QUE ESTE NOME. O version skew roda em `playwright.skew.config.ts`, cujo `testMatch` é `/skew-api-producao\.spec\.ts/`
 * (sem âncora): este arquivo entra pelo fim do nome, e o `playwright.config.ts` comum o ignora pelo mesmo padrão (lá a
 * API seria a deste HEAD e o caso ficaria verde por vacuidade). Arquivo PRÓPRIO: o `skew-api-producao.spec.ts` é
 * compartilhado entre PRs (PRE-PR-02).
 *
 * O MUNDO É PERGUNTADO À BASE NA HORA, pela própria porta da capacidade: `GET /api/financeiro/capacidades`. 404 (a rota
 * não existe naquele binário) → MUNDO LEGADO; 200 com `{ centralFinanceira: 1 }` → MUNDO CENTRAL. Outro status, ou um
 * 200 com outra forma, é defeito — não skew. Os dois ramos cobram prova POSITIVA, e nenhum só passa:
 *   · LEGADO (a base de hoje, 622f194): `/financeiro` é o de hoje (Contas, Caixa e Bancos; nada de Títulos) e NENHUM
 *     pedido sai para `/api/financeiro/*` além da capacidade — contado no fio; o lançamento é o de hoje (rateio por %);
 *     e no detalhe o diálogo de baixa é o de hoje (sem Tarifa), com o corpo do POST `/settle` sem `tarifa`, `excedente`
 *     nem `adiantamento_id` — e a baixa acontece (o título fica pago pela API da base).
 *   · CENTRAL (a base já com esta fase, depois do merge): `/financeiro` abre em Títulos com os cartões; o lançamento é o
 *     avulso com o rateio em R$; o diálogo de baixa é o novo (com Tarifa) e a baixa acontece.
 * Não há mock: o servidor é o binário da base, servindo o banco migrado e semeado por este HEAD.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
type Mundo = "legado" | "central";

async function cabecalhosDaSessao(page: Page): Promise<Record<string, string>> {
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token?: string; orgId?: string });
  return { authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}) };
}

/**
 * Vigia do navegador: CORS morto não vira exceção nem resposta HTTP (o Chromium aborta antes), e sem o coletor a tela
 * renderiza vazia e o teste passa. Também anota CADA pedido a `/api/financeiro/*` — no mundo legado, o único permitido
 * é a capacidade (o 404 dela é RESPOSTA, que a tela lê para decidir).
 */
function vigiar(page: Page) {
  const falhas: string[] = []; const financeiro: string[] = [];
  page.on("requestfailed", (r) => { if (r.url().includes(API)) falhas.push(`${r.url()} → ${r.failure()?.errorText ?? "?"}`); });
  page.on("console", (m) => { if (m.type() === "error" && /CORS|preflight|Access-Control/i.test(m.text())) falhas.push(`console: ${m.text()}`); });
  page.on("request", (r: Request) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/financeiro/")) financeiro.push(`${r.method()} ${u.pathname}`); });
  return {
    semBloqueio: () => expect(falhas, "nenhuma requisição pode morrer no navegador (CORS/preflight)").toEqual([]),
    pedidosAoFinanceiroNovo: () => [...financeiro]
  };
}

async function perguntarABase(page: Page): Promise<Mundo> {
  const r = await page.request.get(`${API}/api/financeiro/capacidades`, { headers: await cabecalhosDaSessao(page) });
  expect([200, 404], "a base ou declara a capacidade ou não conhece a rota — outro código é defeito, não skew").toContain(r.status());
  let mundo: Mundo = "legado";
  if (r.status() === 200) {
    // OPERACOES-01 F9 (decisão 286): a base que já tem a F9 declara também `financeiroPelaTop: 1` na MESMA resposta —
    // as duas formas exatas, e nenhuma outra.
    expect([{ centralFinanceira: 1 }, { centralFinanceira: 1, financeiroPelaTop: 1 }], "a base declara a Central na forma e versão exatas").toContainEqual(await r.json());
    mundo = "central";
  }
  console.log(`[skew] OPERACOES-01 F8 · K-1 · a base responde ${r.status()} a GET /api/financeiro/capacidades → mundo ${mundo}`);
  return mundo;
}

/** No mundo legado, o fio só pode ter levado a capacidade a `/api/financeiro/*` — e ela tem de ter sido perguntada. */
function soACapacidade(pedidos: string[]) {
  expect(pedidos.length, "a tela perguntou a capacidade (sem pergunta, o ramo legado seria vacuidade)").toBeGreaterThan(0);
  expect(pedidos.filter((p) => p !== "GET /api/financeiro/capacidades"), "no legado, nenhum outro pedido sai para /api/financeiro/*").toEqual([]);
}

test("OPERACOES-01 F8 · K-1 (sentido 1) — /financeiro: com a API da base sem a capacidade, é a tela de hoje e só a capacidade vai ao fio; com ela, a Central abre em Títulos", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const mundo = await perguntarABase(page);
  await page.goto("/financeiro");
  if (mundo === "legado") {
    await expect(page.getByRole("tab", { name: "Contas", exact: true }), "as abas de hoje").toBeVisible();
    await expect(page.getByRole("tab", { name: "Caixa e Bancos" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Títulos" }), "nada da Central sem a capacidade").toHaveCount(0);
    await expect(page.getByTestId("fin-titulos")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "A Pagar" }), "a lista de hoje abre (Contas › A Pagar)").toBeVisible();
    soACapacidade(v.pedidosAoFinanceiroNovo());
  } else {
    await expect(page.getByRole("tab", { name: "Títulos" })).toBeVisible();
    await expect(page.getByTestId("fin-titulos")).toBeVisible();
    await expect(page.getByTestId("fin-cartao-a_vencer")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Contas", exact: true }), "as áreas antigas só aparecem quando a URL as pede").toHaveCount(0);
    expect(v.pedidosAoFinanceiroNovo().some((p) => p.startsWith("GET /api/financeiro/titulos")), "a Central lista pelo servidor").toBe(true);
  }
  v.semBloqueio();
});

test("OPERACOES-01 F8 · K-1 (sentido 1) — lançamento: com a API da base, o formulário de hoje (rateio por %); com a Central, o lançamento avulso com rateio em R$", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const mundo = await perguntarABase(page);
  await page.goto("/financeiro/contas-a-pagar/new");
  await expect(page.getByLabel(/^Nº do documento/)).toBeVisible();
  if (mundo === "legado") {
    await expect(page.getByText("Rateio (natureza / centro de resultado)"), "o rateio de hoje").toBeVisible();
    await expect(page.getByText(/Total: 100,00%/), "rateio por percentual, como hoje").toBeVisible();
    await expect(page.getByTestId("fin-rateio-diferenca"), "nada do rateio em R$ sem a capacidade").toHaveCount(0);
    await expect(page.getByTestId("fin-lancamento")).toHaveCount(0);
    soACapacidade(v.pedidosAoFinanceiroNovo());
  } else {
    await expect(page.getByTestId("fin-lancamento")).toBeVisible();
    await expect(page.getByTestId("fin-rateio-diferenca")).toBeVisible();
  }
  v.semBloqueio();
});

test("OPERACOES-01 F8 · K-1 (sentido 1) — baixa no detalhe: com a API da base, o diálogo de hoje (sem Tarifa) e o corpo de hoje no fio; a baixa acontece nos dois mundos", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const mundo = await perguntarABase(page);

  // O título nasce pela API DA BASE, com o corpo de hoje (que os dois binários aceitam).
  const um = async (caminho: string) => { const r = await api<{ items: { id: string }[] }>(page, "GET", caminho); expect(r.items[0], `premissa: ${caminho}`).toBeTruthy(); return r.items[0]!.id; };
  const numero = `K1F8-${Date.now().toString(36)}`.toUpperCase();
  const criado = await api<{ id: string }>(page, "POST", "/api/financial/payables", {
    empresa_id: await empresaAtiva(page), number: numero, person_id: await um("/api/resources/people?is_provider=true&pageSize=1"), amount: "321.00",
    emission_date: "2026-01-10", due_date: "2031-05-20", note: `K-1 F8 ${numero}`,
    apportionment: [{ financial_category_id: await um("/api/resources/financial_categories?kind=analytic&nature=expense&pageSize=1"), cost_center_id: await um("/api/resources/cost_centers?kind=analytic&pageSize=1"), percentage: "100" }]
  });
  const antes = await api<{ status: string; balance: string }>(page, "GET", `/api/financial/payables/${criado.id}`);
  expect(antes.status, "premissa: o título nasce em aberto").toBe("open");

  const corpos: Record<string, unknown>[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith(`/api/financial/payables/${criado.id}/settle`)) corpos.push(r.postDataJSON() as Record<string, unknown>); });
  await page.goto(`/financeiro/contas-a-pagar/${criado.id}`);
  await expect(page.getByTestId("base2-shell")).toBeVisible();
  await page.getByRole("button", { name: "Baixar", exact: true }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toBeVisible();
  if (mundo === "legado") {
    await expect(page.getByTestId("fin-dialogo-baixa"), "o diálogo novo não aparece sem a capacidade").toHaveCount(0);
    await expect(dialogo.locator("label", { hasText: "Tarifa" }), "o diálogo de hoje não tem Tarifa").toHaveCount(0);
  } else {
    await expect(page.getByTestId("fin-dialogo-baixa")).toBeVisible();
    await expect(dialogo.locator("label", { hasText: "Tarifa" })).toHaveCount(1);
  }
  await dialogo.locator("label", { hasText: "Conta bancária" }).first().locator("..").locator("button").first().click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill("Banco do Brasil");
  await painel.getByRole("option", { name: /Banco do Brasil/i }).first().click();
  const resposta = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/api/financial/payables/${criado.id}/settle`));
  await dialogo.getByRole("button", { name: "Confirmar baixa" }).click();
  expect((await resposta).status(), "a API da base aceita a baixa que este web manda").toBe(201);

  expect(corpos, "um pedido de baixa no fio").toHaveLength(1);
  const corpo = corpos[0]!;
  expect(corpo["amount"], "a baixa pelo saldo").toBe(antes.balance);
  for (const chave of ["excedente", "adiantamento_id"]) expect(Object.keys(corpo), `sem ${chave} numa baixa simples`).not.toContain(chave);
  if (mundo === "legado") {
    expect(Object.keys(corpo), "o corpo de hoje não tem tarifa").not.toContain("tarifa");
    soACapacidade(v.pedidosAoFinanceiroNovo());
  }
  const depois = await api<{ status: string }>(page, "GET", `/api/financial/payables/${criado.id}`);
  expect(depois.status, "a baixa aconteceu na API da base").toBe("paid");
  v.semBloqueio();
});
