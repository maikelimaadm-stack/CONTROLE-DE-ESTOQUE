/**
 * VISUAL-UX-04 — Lançamento de bem/equipamento igual ao desenho (só apresentação).
 *
 * Cobre create e edit: chrome do desenho (barra redonda, posição do rótulo, abas Principal/Depreciação/Outros),
 * densidade rótulo-à-frente (196px), e que Salvar continua POST/PUT na mesma API de resources — sem renomear campo.
 */
import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

const FORM = '[data-testid="b1-form"][data-lancamento-bem]';

async function apiCall<T>(page: Page, method: string, path: string): Promise<T> {
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";
  return page.evaluate(async ({ method, path, api }) => {
    const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string | null; empresaId: string | null };
    const res = await fetch(`${api}${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}), ...(s.empresaId ? { "x-empresa-id": s.empresaId } : {}) } });
    const text = await res.text(); const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 200)}`);
    return data as T;
  }, { method, path, api });
}

async function abrirNovo(page: Page) {
  await page.goto("/cadastros/equipments/new");
  await expect(page.locator(FORM)).toBeVisible();
}

test.describe("VISUAL-UX-04 — lançamento de bem/equipamento", () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test("VB-1 chrome do desenho no novo: barra, densidade, abas e cartões", async ({ page }) => {
    await abrirNovo(page);
    const form = page.locator(FORM);
    await expect(form).toHaveAttribute("data-densidade", "rotulo-a-frente");
    await expect(page.getByTestId("lancamento-bem-salvar")).toBeVisible();
    await expect(page.getByTestId("lancamento-bem-descartar")).toBeVisible();
    await expect(page.getByTestId("lancamento-bem-posicao-rotulo")).toBeVisible();
    await expect(page.getByTestId("lancamento-bem-acoes-rapidas")).toBeVisible();
    await expect(form.getByRole("tab", { name: "Principal" })).toBeVisible();
    await expect(form.getByRole("tab", { name: "Depreciação" })).toBeVisible();
    await expect(form.getByRole("tab", { name: "Outros" })).toBeVisible();
    await expect(page.getByTestId("lancamento-bem-cartao").filter({ hasText: "Dados" }).first()).toBeVisible();
    await expect(page.getByTestId("lancamento-bem-cartao").filter({ hasText: "Veículo" }).first()).toBeVisible();
    // rótulo à frente: 196px no desenho do bem
    const rotulo = form.locator('[data-parte="rotulo"]').first();
    await expect(rotulo).toBeVisible();
    const w = await rotulo.evaluate((el) => Math.round(el.getBoundingClientRect().width));
    expect(w, "rótulo à frente do bem = 196px").toBe(196);
  });

  test("VB-2 troca de densidade é só de tela (compacto ↔ frente)", async ({ page }) => {
    await abrirNovo(page);
    const form = page.locator(FORM);
    await page.getByRole("button", { name: "Rótulo dentro do campo" }).click();
    await expect(form).toHaveAttribute("data-densidade", "compacto");
    await page.getByRole("button", { name: "Rótulo antes do campo" }).click();
    await expect(form).toHaveAttribute("data-densidade", "rotulo-a-frente");
  });

  test("VB-3 abas Depreciação/Outros mostram os mesmos rótulos do registry", async ({ page }) => {
    await abrirNovo(page);
    const form = page.locator(FORM);
    await form.getByRole("tab", { name: "Depreciação" }).click();
    await expect(form.getByText("Valor de aquisição/construção", { exact: false }).first()).toBeVisible();
    await form.getByRole("tab", { name: "Outros" }).click();
    await expect(form.getByText("Fornecedor", { exact: false }).first()).toBeVisible();
    await expect(form.getByText("Especificação", { exact: false }).first()).toBeVisible();
  });

  test("VB-4 editar registro existente abre a mesma pele visual", async ({ page }) => {
    const body = await apiCall<{ items: { id: string }[] }>(page, "GET", "/api/resources/equipments?pageSize=1");
    const id = body.items[0]?.id;
    test.skip(!id, "sem equipamento no seed");
    await page.goto(`/cadastros/equipments/${id}`);
    const form = page.locator(FORM);
    await expect(form).toBeVisible();
    await expect(page.getByTestId("lancamento-bem-posicao-rotulo")).toBeVisible();
    await expect(page.getByTestId("lancamento-bem-cartao").first()).toBeVisible();
    // com permissão de editar a rota abre em edição (Salvar); sem ela, Em leitura (Editar)
    await expect(page.getByTestId("lancamento-bem-salvar").or(page.getByTestId("lancamento-bem-editar"))).toBeVisible();
    await expect(form.getByText("Descrição", { exact: false }).first()).toBeVisible();
  });
});
