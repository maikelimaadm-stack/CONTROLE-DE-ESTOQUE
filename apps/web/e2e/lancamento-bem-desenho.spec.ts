/**
 * VISUAL-UX-04 — Lançamento de bem/equipamento igual ao desenho (só apresentação).
 *
 * Create e edit: chrome do desenho, densidade padrão = rótulo DENTRO (grade lado a lado),
 * troca para rótulo à frente (coluna), abas e mesmos rótulos do registry.
 */
import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

const FORM = '[data-testid="b1-form"][data-lancamento-bem]';

async function apiCall<T>(page: Page, method: string, path: string): Promise<T> {
  const api = process.env.NEXT_PUBLIC_API_URL
    ?? (process.env.E2E_API_PORT ? `http://127.0.0.1:${process.env.E2E_API_PORT}` : "http://127.0.0.1:3333");
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

  test("VB-1 chrome + densidade compacta (rótulo dentro) com grade lado a lado", async ({ page }) => {
    await abrirNovo(page);
    const form = page.locator(FORM);
    await expect(form).toHaveAttribute("data-densidade", "compacto");
    await expect(page.getByTestId("lancamento-bem-salvar")).toBeVisible();
    await expect(page.getByTestId("lancamento-bem-descartar")).toBeVisible();
    await expect(page.getByTestId("lancamento-bem-novo")).toBeVisible();
    await expect(page.getByTestId("lancamento-bem-posicao-rotulo")).toBeVisible();
    await expect(page.getByTestId("lancamento-bem-acoes-rapidas")).toBeVisible();
    await expect(form.getByRole("tab", { name: "Principal" })).toBeVisible();
    await expect(form.getByRole("tab", { name: "Depreciação" })).toBeVisible();
    await expect(form.getByRole("tab", { name: "Outros" })).toBeVisible();
    await expect(page.getByTestId("lancamento-bem-cartao").filter({ hasText: "Dados" }).first()).toBeVisible();
    await expect(page.getByTestId("lancamento-bem-cartao").filter({ hasText: "Veículo" }).first()).toBeVisible();
    // grade 12 colunas: pelo menos 2 campos na mesma linha horizontal (Descrição e Empresa, span 6+6)
    const grade = page.getByTestId("lancamento-bem-grade").first();
    const campos = grade.locator('[data-testid^="campo-"]');
    await expect(campos.nth(0)).toBeVisible();
    await expect(campos.nth(1)).toBeVisible();
    const ladoALado = await Promise.all([campos.nth(0), campos.nth(1)].map(async (c) => {
      const b = await c.boundingBox();
      return b!;
    }));
    expect(Math.abs(ladoALado[0]!.y - ladoALado[1]!.y), "primeiro e segundo campo na mesma linha").toBeLessThan(8);
    expect(ladoALado[1]!.x, "segundo campo à direita do primeiro").toBeGreaterThan(ladoALado[0]!.x + 40);
  });

  test("VB-2 troca de densidade é só de tela (compacto ↔ frente)", async ({ page }) => {
    await abrirNovo(page);
    const form = page.locator(FORM);
    await expect(form).toHaveAttribute("data-densidade", "compacto");
    await page.getByRole("button", { name: "Rótulo antes do campo" }).click();
    await expect(form).toHaveAttribute("data-densidade", "rotulo-a-frente");
    // content-box 196px (variável --dz-rotulo-raiz da moldura)
    const rotulo = form.locator('[data-parte="rotulo"]').first();
    const w = await rotulo.evaluate((el) => Math.round(parseFloat(getComputedStyle(el).width)));
    expect(w, "rótulo à frente = 196px (content-box)").toBe(196);
    // em frente a grade vira coluna: segundo campo abaixo do primeiro
    const grade = page.getByTestId("lancamento-bem-grade").first();
    const a = await grade.locator('[data-testid^="campo-"]').nth(0).boundingBox();
    const b = await grade.locator('[data-testid^="campo-"]').nth(1).boundingBox();
    expect(b!.y, "rótulo à frente empilha os campos").toBeGreaterThan(a!.y + 10);
    await page.getByRole("button", { name: "Rótulo dentro do campo" }).click();
    await expect(form).toHaveAttribute("data-densidade", "compacto");
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
    await expect(form).toHaveAttribute("data-densidade", "compacto");
    await expect(page.getByTestId("lancamento-bem-posicao-rotulo")).toBeVisible();
    await expect(page.getByTestId("lancamento-bem-cartao").first()).toBeVisible();
    await expect(page.getByTestId("lancamento-bem-salvar").or(page.getByTestId("lancamento-bem-editar"))).toBeVisible();
    await expect(form.getByText("Descrição", { exact: false }).first()).toBeVisible();
  });
});
