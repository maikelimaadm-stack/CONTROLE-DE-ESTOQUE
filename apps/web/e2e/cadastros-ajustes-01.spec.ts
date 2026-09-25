import { test, expect, type Page, type Route } from "@playwright/test";
import { login } from "./helpers";

/**
 * CADASTROS — AJUSTES 01 · E2E da seção 8 (UI-1..UI-11).
 *
 * API e banco REAIS (0026 carregada pelo seed). `/api/referencias/*` NUNCA é mockado — foi exatamente a busca
 * real, aberta sem texto, que quebrou em produção (500) sem nenhum E2E ter aberto um desses campos. A única
 * exceção é o UI-11, que simula a falha de propósito. Só `/api/consultas/*` (CEP e CNPJ, fontes externas) é
 * mockado, por `page.route`.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
const painel = (page: Page) => page.locator("[data-radix-popper-content-wrapper]").last();
const opcoes = (page: Page) => painel(page).getByRole("option");

/** Vigia das buscas de referência: toda resposta de /api/referencias/* registrada com status e query. */
function vigiarReferencias(page: Page) {
  const respostas: { url: string; status: number }[] = [];
  page.on("response", (r) => { if (r.url().includes("/api/referencias/")) respostas.push({ url: r.url(), status: r.status() }); });
  return {
    respostas,
    semErro: () => expect(respostas.filter((r) => r.status >= 400), "nenhuma busca de referência pode falhar").toEqual([]),
    abriuSemTexto: (chave: string) => expect(respostas.some((r) => { const u = new URL(r.url); return u.pathname === `/api/referencias/${chave}` && !u.searchParams.get("search") && r.status === 200; }), `GET /api/referencias/${chave} SEM texto respondeu 200`).toBe(true)
  };
}

/** Abre o campo de referência pelo rótulo e espera a lista (sem digitar nada). */
async function abrirSemDigitar(page: Page, rotulo: string) {
  await page.getByLabel(rotulo, { exact: true }).click();
  await expect(opcoes(page).first(), `${rotulo}: a lista aparece sem digitar`).toBeVisible();
  expect(await opcoes(page).count()).toBeGreaterThan(3);
}

// ───────────────────────────── UI-8 ─────────────────────────────
test("UI-8 — Banco, NCM e CBO abertos SEM digitar mostram a lista (API real); \"nubank\" acha o 260", async ({ page }) => {
  const v = vigiarReferencias(page);
  await login(page);

  await page.goto("/cadastros/products/new");
  await page.getByRole("tab", { name: "Fiscal" }).click();
  await abrirSemDigitar(page, "NCM");
  v.abriuSemTexto("ncm");
  await page.keyboard.press("Escape");

  await page.goto("/cadastros/job_functions/new");
  await abrirSemDigitar(page, "CBO");
  v.abriuSemTexto("cbo");
  await page.keyboard.press("Escape");

  await page.goto("/cadastros/people/new");
  await page.getByTestId("ficha-em-abas").getByRole("tab", { name: "Financeiro" }).click();
  await abrirSemDigitar(page, "Banco");
  v.abriuSemTexto("bancos");
  await painel(page).getByLabel("Pesquisar opção").fill("nubank");
  await expect(opcoes(page).first()).toHaveText(/^260 · /);
  await opcoes(page).first().click();
  await expect(page.getByLabel("Banco", { exact: true })).toContainText("260");
  v.semErro();
});

// ───────────────────────────── UI-11 ─────────────────────────────
test("UI-11 — busca falhando (500 simulado SÓ aqui) → \"Tentar de novo\"; texto livre nunca vira valor", async ({ page }) => {
  await login(page);
  let falhas = 0; const pedidosPorCodigo: string[] = [];
  // a busca falha 2x (a tentativa + a tentativa automática do B-1); a partir daí, a API REAL responde
  await page.route(/\/api\/referencias\/bancos(\?|$)/, async (route: Route) => {
    if (falhas < 2) { falhas++; await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Erro interno" } }) }); return; }
    await route.continue();
  });
  page.on("request", (r) => { if (/\/api\/referencias\/bancos\/[^?]/.test(r.url())) pedidosPorCodigo.push(r.url()); });
  await page.goto("/cadastros/people/new");
  await page.getByTestId("ficha-em-abas").getByRole("tab", { name: "Financeiro" }).click();
  const campo = page.getByLabel("Banco", { exact: true });
  await campo.click();
  await expect(painel(page)).toContainText("Não foi possível carregar a lista.");
  const tentar = page.getByTestId("referencia-tentar-de-novo");
  await expect(tentar).toHaveText(/Tentar de novo/);
  expect(falhas, "uma tentativa automática antes de mostrar o erro").toBe(2);
  await expect(page.getByTestId("referencia-codigo"), "a falha 500 não cai em \"digite o código\"").toHaveCount(0);
  // Tentar de novo → a API real responde
  await tentar.click();
  await expect(opcoes(page).first()).toBeVisible();
  expect(await opcoes(page).count()).toBeGreaterThan(3);
  expect(falhas).toBe(2);
  // texto livre digitado NÃO vira valor e não dispara GET por código
  await painel(page).getByLabel("Pesquisar opção").fill("meu banco");
  await page.keyboard.press("Escape");
  await expect(campo).not.toContainText("meu banco");
  await expect(campo).toContainText(/Buscar banco/i);
  expect(pedidosPorCodigo, "nenhum GET /api/referencias/bancos/<texto>").toEqual([]);
});
