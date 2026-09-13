import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * UI-STAB-01 — estabilidade dimensional dos overlays: o frame nasce no tamanho final (perfil), LoadingState → conteúdo
 * não muda a altura, header/footer fixos com corpo rolável, ConfirmDialog compacto, Drawer estável, viewports.
 */
/**
 * Tolerância de arredondamento: o frame é centralizado com `clamp()` sobre a viewport, então altura e topo
 * podem variar em frações de pixel entre versões de navegador. O que o teste protege é o SALTO visível do
 * frame (dezenas de pixels) ao sair do carregamento — não a igualdade exata de subpixel.
 */
const SUBPIXEL = 4;

const box = async (page: Page, testId: string) => { const b = await page.getByTestId(testId).boundingBox(); if (!b) throw new Error(`sem boundingBox de ${testId}`); return b; };

test.describe("overlays: perfis e estabilidade", () => {
  test("dialog grande assíncrono (Histórico): frame fixo durante o carregamento e após o conteúdo; corpo rola, header/footer visíveis", async ({ page }) => {
    await login(page);
    await page.goto("/cadastros/products"); const row = page.getByTestId("b1-row").first(); await expect(row).toBeVisible(); await row.click();
    await page.getByLabel("Mais opções").first().click(); await page.getByRole("menuitem", { name: /Histórico/ }).click();
    const dlg = page.getByTestId("dialog"); await expect(dlg).toBeVisible(); await expect(dlg).toHaveAttribute("data-profile", "large");
    const before = await box(page, "dialog");
    await expect(dlg.getByTestId("loading-state")).toHaveCount(0, { timeout: 15_000 }); // conteúdo (ou vazio) chegou
    const after = await box(page, "dialog");
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(SUBPIXEL); expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(SUBPIXEL);
    expect(after.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await expect(dlg.locator(".mg-dialog__header")).toBeVisible();
    expect(await dlg.locator(".mg-dialog__body").evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
    await page.keyboard.press("Escape"); await expect(dlg).toBeHidden();
  });

  test("ConfirmDialog é compacto e não muda de altura ao entrar em carregamento", async ({ page }) => {
    await login(page);
    await page.goto("/cadastros/products/new"); await page.locator("main input:not([type=hidden]):not([readonly])").first().fill("x");
    await page.getByTestId("workspace-tab").filter({ hasText: /Novo/ }).getByRole("button", { name: /Fechar aba/ }).click();
    const dlg = page.getByTestId("confirm-dialog"); await expect(dlg).toBeVisible(); await expect(dlg).toHaveAttribute("data-profile", "compact");
    const b = await box(page, "confirm-dialog"); expect(b.height).toBeLessThan(320); expect(b.width).toBeLessThanOrEqual(460);
    await dlg.locator(".mg-dialog__footer").getByRole("button", { name: "Fechar", exact: true }).click(); await expect(dlg).toBeHidden();
  });

  test("Drawer: altura estável desde a abertura até o conteúdo; ESC fecha e devolve o foco", async ({ page }) => {
    await login(page);
    await page.goto("/admin/auditoria"); const row = page.getByTestId("b1-row").first(); await expect(row).toBeVisible();
    await page.getByTestId("row-view").first().click(); // "Visualizar" explícito da DataTable
    const drawer = page.getByTestId("drawer"); await expect(drawer).toBeVisible();
    const b1 = await box(page, "drawer"); await page.waitForTimeout(300); const b2 = await box(page, "drawer");
    expect(Math.abs(b1.height - b2.height)).toBeLessThanOrEqual(SUBPIXEL); expect(b2.height).toBeGreaterThanOrEqual(page.viewportSize()!.height - SUBPIXEL);
    expect(await drawer.locator(".mg-drawer__body").evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
    await page.keyboard.press("Escape"); await expect(drawer).toBeHidden(); await expect(page.getByTestId("row-view").first()).toBeFocused();
  });

  test("workspace (Localizar animal) e large em 1024×768: dentro da viewport, rodapé/cabeçalho acessíveis", async ({ page }) => {
    await login(page); await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/pecuaria?tab=rebanho&sub=animais&locate=1");
    const dlg = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Localizar animal" }) }); await expect(dlg).toBeVisible();
    await expect(dlg).toHaveAttribute("data-profile", "workspace");
    const b = await dlg.boundingBox(); expect(b!.height).toBeLessThanOrEqual(768); expect(b!.width).toBeLessThanOrEqual(1024); expect(b!.y).toBeGreaterThanOrEqual(0);
    await expect(dlg.locator(".mg-dialog__header")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto("/cadastros/products"); await page.getByTestId("b1-row").first().click(); await page.getByLabel("Mais opções").first().click(); await page.getByRole("menuitem", { name: /Histórico/ }).click();
    const big = page.getByTestId("dialog"); await expect(big).toBeVisible(); const bb = await big.boundingBox(); expect(bb!.height).toBeLessThanOrEqual(768 - 40); expect(bb!.y + bb!.height).toBeLessThanOrEqual(768);
  });
});
