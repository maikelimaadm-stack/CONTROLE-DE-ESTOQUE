/**
 * VISUAL-UX-04 — Lançamento de bem/equipamento igual ao desenho (só apresentação).
 *
 * Create e edit: chrome do desenho. O HTML abre em rótulo À FRENTE (coluna, 640px).
 * O outro botão põe o rótulo DENTRO e a grade do desenho (Empresa 6, Chassi 2, Usa fiscal 4).
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

  test("VB-1 chrome do HTML: abre em rótulo à frente e o compacto usa a grade do desenho", async ({ page }) => {
    await abrirNovo(page);
    const form = page.locator(FORM);
    await expect(form).toHaveAttribute("data-densidade", "rotulo-a-frente");
    await expect(page.getByTestId("lancamento-bem-salvar")).toBeVisible();
    await expect(page.getByTestId("lancamento-bem-descartar")).toHaveCount(0);
    await expect(page.getByTestId("lancamento-bem-novo")).toBeVisible();
    await expect(page.getByTestId("lancamento-bem-posicao-rotulo")).toBeVisible();
    await expect(page.getByTestId("lancamento-bem-acoes-rapidas")).toBeVisible();
    await expect(form.getByRole("tab", { name: "Principal" })).toBeVisible();
    await expect(form.getByRole("tab", { name: "Depreciação" })).toBeVisible();
    await expect(form.getByRole("tab", { name: "Outros" })).toBeVisible();
    await expect(page.getByTestId("lancamento-bem-cartao").filter({ hasText: "Dados" }).first()).toBeVisible();
    await expect(page.getByTestId("lancamento-bem-cartao").filter({ hasText: "Veículo" }).first()).toBeVisible();
    await expect(page.getByTestId("campo-code")).toHaveCount(0);
    await expect(page.locator(".mg-crumbs")).toHaveCount(0);
    const empilhado = async (a: string, b: string) => {
      const ba = await page.getByTestId(a).boundingBox();
      const bb = await page.getByTestId(b).boundingBox();
      expect(bb!.y, `${b} abaixo de ${a} no rótulo à frente`).toBeGreaterThan(ba!.y + 10);
    };
    await empilhado("campo-description", "campo-empresa_id");
    await expect(page.getByTestId("campo-vehicle").locator("textarea")).toHaveValue("");
    await page.getByRole("button", { name: "Rótulo dentro do campo" }).click();
    await expect(form).toHaveAttribute("data-densidade", "compacto");
    const mesmaLinha = async (a: string, b: string) => {
      const ba = await page.getByTestId(a).boundingBox();
      const bb = await page.getByTestId(b).boundingBox();
      expect(Math.abs(ba!.y - bb!.y), `${a} e ${b} na mesma linha`).toBeLessThan(8);
      expect(bb!.x, `${b} à direita de ${a}`).toBeGreaterThan(ba!.x + 40);
    };
    await mesmaLinha("campo-description", "campo-empresa_id");
    await mesmaLinha("campo-family_id", "campo-status");
    await mesmaLinha("campo-chassis", "campo-color");
    await form.getByRole("tab", { name: "Depreciação" }).click();
    await mesmaLinha("campo-has_depreciation", "campo-depreciation_type");
    await mesmaLinha("campo-residual_percent", "campo-depreciated_value");
    await form.getByRole("tab", { name: "Outros" }).click();
    await mesmaLinha("campo-provider_id", "campo-use_fiscal");
    await expect(page.getByTestId("campo-features").getByRole("combobox")).toBeVisible();
    await expect(page.getByTestId("campo-features").getByRole("checkbox")).toHaveCount(0);
  });

  test("VB-2 troca de densidade é só de tela (compacto ↔ frente)", async ({ page }) => {
    await abrirNovo(page);
    const form = page.locator(FORM);
    await expect(form).toHaveAttribute("data-densidade", "rotulo-a-frente");
    await page.getByRole("button", { name: "Rótulo dentro do campo" }).click();
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
    await expect(form).toHaveAttribute("data-densidade", "rotulo-a-frente");
    await page.getByRole("button", { name: "Rótulo dentro do campo" }).click();
    await expect(form).toHaveAttribute("data-densidade", "compacto");
    // a troca de densidade anima o padding; medir no meio do trajeto não é a geometria do desenho
    await expect(page.getByTestId("campo-empresa_id").locator(".cmd-display")).toHaveCSS("padding-top", "13px");
    await expect(page.getByTestId("lancamento-bem-posicao-rotulo")).toBeVisible();
    await expect(page.getByTestId("lancamento-bem-cartao").first()).toBeVisible();
    await expect(page.getByTestId("lancamento-bem-salvar").or(page.getByTestId("lancamento-bem-editar"))).toBeVisible();
    await expect(form.getByText("Descrição", { exact: false }).first()).toBeVisible();

    // Geometria exata de `.dens-compacto .fld.has` / `.fc` / `.fic` no HTML de referência.
    // Não basta o campo ter 32px: uma borda interna ou um botão de limpar desloca o valor e volta a
    // sobrepor rótulo/ícone, mesmo com o padding nominal correto.
    const geometria = await page.getByTestId("campo-empresa_id").evaluate((campo) => {
      const linha = campo.querySelector<HTMLElement>('[data-parte="caixa"]')?.parentElement;
      const caixa = campo.querySelector<HTMLElement>('[data-parte="caixa"]');
      const rotulo = campo.querySelector<HTMLElement>('[data-parte="rotulo"]');
      const controle = campo.querySelector<HTMLElement>(".cmd-display");
      const icone = campo.querySelector<HTMLElement>('[data-parte="icone"]');
      const limpar = campo.querySelector<HTMLElement>(".cmd-clear");
      if (!linha || !caixa || !rotulo || !controle || !icone) throw new Error("campo Empresa incompleto");
      const raiz = linha.getBoundingClientRect();
      const relativo = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return { x: r.x - raiz.x, y: r.y - raiz.y, w: r.width, h: r.height };
      };
      const css = getComputedStyle(controle);
      return {
        linha: relativo(linha), caixa: relativo(caixa), rotulo: relativo(rotulo),
        controle: relativo(controle), icone: relativo(icone),
        padding: css.padding, borda: css.borderTopWidth, display: css.display,
        limpar: limpar ? { display: getComputedStyle(limpar).display, opacity: getComputedStyle(limpar).opacity } : null,
      };
    });
    expect(geometria).toEqual({
      linha: { x: 0, y: 0, w: geometria.linha.w, h: 32 },
      caixa: { x: 0, y: 0, w: geometria.linha.w, h: 32 },
      rotulo: { x: 1, y: 4, w: 83, h: 8.5 },
      controle: { x: 1, y: 1, w: geometria.linha.w - 2, h: 30 },
      icone: { x: 11, y: 14, w: 14, h: 14 },
      padding: "13px 10px 3px 32px",
      borda: "0px",
      display: "flex",
      limpar: { display: "block", opacity: "0" },
    });

    const empresa = page.getByTestId("campo-empresa_id");
    await empresa.hover();
    const limpar = empresa.locator(".cmd-clear");
    await expect(limpar).toHaveCSS("opacity", "1");
    await limpar.click();
    await expect(empresa.locator(".cmd-display")).toHaveClass(/is-empty/);
  });
});
