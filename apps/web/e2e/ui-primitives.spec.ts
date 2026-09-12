import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * UI-02 — primitives oficiais (docs/UI-STANDARD.md › Primitives visuais): teste estrutural, sem regra de negócio.
 * PageHeader, StatusBadge traduzido, ConfirmDialog (ESC, botão fechar, foco devolvido), Drawer, EmptyState, ErrorState
 * com "Tentar novamente", DetailShell nos pilotos e responsividade 1920 / 1366 / 1024.
 */
async function apiCall<T = Record<string, unknown>>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";
  return page.evaluate(async ({ method, path, body, api }) => {
    const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string | null; farmId: string | null };
    const res = await fetch(`${api}${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}), ...(s.farmId ? { "x-farm-id": s.farmId } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text(); const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 200)}`);
    return data as T;
  }, { method, path, body, api });
}
const VIEWPORTS = [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1024, height: 768 }];
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test.describe("UI-02 primitives oficiais", () => {
  test("PageHeader nas telas piloto: Financeiro, Estoque e Configurações", async ({ page }) => {
    await login(page);
    await page.goto("/financeiro/contas-a-pagar");
    const fin = page.getByTestId("page-header").filter({ hasText: "Contas a Pagar" }); await expect(fin).toBeVisible(); await expect(fin.getByRole("heading", { name: "Contas a Pagar" })).toBeVisible();
    await page.goto("/estoque/saldo");
    const est = page.getByTestId("page-header").filter({ hasText: "Saldo de Estoque" }); await expect(est).toBeVisible(); await expect(est.getByRole("button", { name: "Exportar" })).toBeVisible();
    await page.goto("/admin/perfis");
    const cfg = page.getByTestId("page-header").filter({ hasText: "Perfis de Acesso" }); await expect(cfg).toBeVisible(); await expect(cfg.getByRole("link", { name: "Novo perfil" })).toBeVisible();
  });

  test("DetailShell + StatusBadge + ConfirmDialog no abastecimento (1920 / 1366 / 1024)", async ({ page }) => {
    await login(page);
    const eq = await apiCall<{ items: { id: string; farm_id: string }[] }>(page, "GET", "/api/resources/equipments?pageSize=1"); const e = eq.items[0]; if (!e) throw new Error("sem equipamentos no seed e2e");
    const prods = await apiCall<{ id: string }[]>(page, "GET", "/api/resources/products/options?search=Diesel"); const p = prods[0]; if (!p) throw new Error("sem produto Diesel no seed e2e");
    const fs = await apiCall<{ id: string; code: string }>(page, "POST", "/api/fleet/fuel-supplies", { farm_id: e.farm_id, supply_date: "2026-09-10", equipment_id: e.id, product_id: p.id, quantity: "12.5", unit_value: "6.2", note: "e2e primitives" });
    await page.goto(`/frota/abastecimentos/${fs.id}`);
    const shell = page.getByTestId("detail-shell"); await expect(shell).toBeVisible();
    await expect(shell.getByRole("heading", { name: `Abastecimento ${fs.code}` })).toBeVisible();
    await expect(shell.getByRole("navigation", { name: "Trilha da tela" }).getByRole("link", { name: "Abastecimentos" })).toHaveAttribute("href", /frota/);
    await expect(shell.getByRole("link", { name: "Voltar" })).toHaveAttribute("href", /\/frota\?tab=abastecimentos/);
    const badge = shell.locator("[data-status='confirmed']"); await expect(badge).toHaveText("Confirmado"); await expect(badge).toHaveAttribute("data-tone", "positive");
    await expect(page.getByText("e2e primitives")).toBeVisible();
    // ConfirmDialog: abre, ESC fecha e devolve o foco; reabre, botão fechar fecha e devolve o foco
    const trigger = shell.getByRole("button", { name: "Cancelar abastecimento" }); await trigger.click();
    const dlg = page.getByTestId("confirm-dialog"); await expect(dlg).toBeVisible(); await expect(dlg).toHaveAttribute("role", "dialog");
    await expect(dlg.getByRole("heading", { name: "Cancelar abastecimento" })).toBeVisible(); await expect(dlg.locator(".mg-dialog__footer").getByRole("button", { name: "Fechar" })).toBeVisible(); await expect(dlg.getByTestId("confirm-dialog-confirm")).toHaveText("Confirmar");
    await page.keyboard.press("Escape"); await expect(dlg).toBeHidden(); await expect(trigger).toBeFocused();
    await trigger.click(); await expect(dlg).toBeVisible(); await dlg.getByTestId("dialog-close").click(); await expect(dlg).toBeHidden(); await expect(trigger).toBeFocused();
    // responsividade: cabeçalho, situação e ações visíveis sem rolagem horizontal
    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp);
      await expect(shell.getByRole("heading", { name: `Abastecimento ${fs.code}` })).toBeVisible(); await expect(badge).toBeVisible(); await expect(trigger).toBeVisible();
      expect(await noHorizontalScroll(page), `sem rolagem horizontal em ${vp.width}`).toBe(true);
    }
  });

  test("DetailShell nos pilotos de manejo e pesagem (trilha, Voltar com filtro)", async ({ page }) => {
    await login(page);
    const animals = await apiCall<{ items: { id: string; farm_id: string; batch_id: string | null }[] }>(page, "GET", "/api/livestock/animals?pageSize=1"); const a = animals.items[0]; if (!a) throw new Error("sem animais no seed e2e");
    const batches = await apiCall<{ items: { id: string }[] }>(page, "GET", "/api/resources/batches?pageSize=1"); const batchId = a.batch_id ?? batches.items[0]?.id ?? null;
    const h = await apiCall<{ id: string; code: string }>(page, "POST", "/api/livestock/handlings", { farm_id: a.farm_id, handling_type: "sanitary", handling_date: "2026-09-10", batch_id: batchId, dose: "1", note: "e2e primitives manejo", items: [{ animal_id: a.id, quantity: "1" }] });
    await page.goto(`/pecuaria/manejo/sanitary/${h.id}`);
    let shell = page.getByTestId("detail-shell"); await expect(shell.getByRole("heading", { name: `Sanitário ${h.code}` })).toBeVisible();
    await expect(shell.getByRole("navigation", { name: "Trilha da tela" }).getByRole("link", { name: "Manejos" })).toHaveAttribute("href", /type=sanitary/);
    await expect(shell.getByRole("link", { name: "Voltar" })).toHaveAttribute("href", /tab=manejos&type=sanitary/);
    const w = await apiCall<{ id: string; code: string }>(page, "POST", "/api/livestock/weighings", { farm_id: a.farm_id, weighing_date: "2026-09-10", batch_id: batchId, items: [{ animal_id: a.id, weight: "305" }] });
    await page.goto(`/pecuaria/pesagens/${w.id}`);
    shell = page.getByTestId("detail-shell"); await expect(shell.getByRole("heading", { name: `Pesagem ${w.code}` })).toBeVisible();
    await expect(shell.getByRole("navigation", { name: "Trilha da tela" }).getByRole("link", { name: "Pesagens" })).toHaveAttribute("href", /type=weighing/);
    await expect(page.getByRole("cell", { name: "305,0" })).toBeVisible();
  });

  test("Drawer (Auditoria › detalhe do evento) e EmptyState", async ({ page }) => {
    await login(page);
    await page.goto("/admin/auditoria");
    const row = page.getByTestId("b1-row").first(); await expect(row).toBeVisible(); await row.dblclick();
    const drawer = page.getByTestId("drawer"); await expect(drawer).toBeVisible(); await expect(drawer).toHaveAttribute("role", "dialog"); await expect(drawer).toHaveAttribute("data-side", "right");
    await expect(drawer.getByRole("heading", { name: "Detalhe do evento" })).toBeVisible(); await expect(drawer.getByText("Depois / metadados")).toBeVisible();
    await page.keyboard.press("Escape"); await expect(drawer).toBeHidden();
    await row.dblclick(); await expect(drawer).toBeVisible(); await drawer.getByTestId("drawer-close").click(); await expect(drawer).toBeHidden();
    await page.getByRole("textbox", { name: "Entidade" }).fill("zzz-entidade-inexistente"); await page.getByRole("button", { name: "Filtrar" }).click();
    const empty = page.getByTestId("empty-state"); await expect(empty).toBeVisible(); await expect(empty).toContainText("Nenhum registro encontrado.");
  });

  test("ErrorState: mensagem segura e Tentar novamente", async ({ page }) => {
    await login(page);
    await page.goto("/frota/abastecimentos/00000000-0000-0000-0000-000000000000");
    const err = page.getByTestId("error-state"); await expect(err).toBeVisible(); await expect(err).toHaveAttribute("role", "alert");
    const retry = err.getByRole("button", { name: "Tentar novamente" }); await expect(retry).toBeVisible(); await retry.click(); await expect(err).toBeVisible();
    await page.goto("/relatorios/relatorio-inexistente");
    await expect(page.getByTestId("error-state")).toContainText("Relatório não encontrado ou sem permissão.");
  });
});
