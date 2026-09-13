import { test, expect } from "@playwright/test";
import { login, logout } from "./helpers";

/**
 * UI-STAB-01 — AppShell: TopNavigation (módulos do nav.registry + "Mais"), mega-menu por módulo, busca global
 * (Ctrl+K), seletor de fazenda, menus de notificações/usuário, acessibilidade por teclado e responsividade.
 */
const MODULES = ["Compras", "Estoque", "Financeiro", "Vendas", "Pecuária", "Confinamento", "Frota e Ativos", "Pessoas e RH", "Ordens de Serviço", "Fiscal", "Relatórios", "Configurações"];

test.describe("shell: menu superior e mega-menu", () => {
  test("módulo → mega-menu → destino: aba criada e URL canônica", async ({ page }) => {
    await login(page);
    const nav = page.getByRole("navigation", { name: "Menu principal" });
    await expect(nav.getByTestId("nav-module").first()).toBeVisible();
    await nav.getByTestId("nav-module").filter({ hasText: "Estoque" }).hover();
    const mega = page.getByTestId("mega-menu"); await expect(mega).toBeVisible();
    await expect(mega.getByText("Recebimentos", { exact: true })).toBeVisible(); await expect(mega.getByText("Ações", { exact: true })).toBeVisible();
    await mega.getByTestId("mega-item").filter({ hasText: "Movimentações" }).first().click();
    await expect(page).toHaveURL(/\/estoque\?tab=estoque&sub=ledger/);
    await expect(page.getByTestId("workspace-tab").filter({ hasText: "Estoque" })).toHaveCount(1);
    await expect(page.getByTestId("workspace-tabs").getByRole("tab", { name: "Estoque" })).toHaveAttribute("aria-selected", "true");
    await expect(mega).toBeHidden();
  });

  test("teclado: Enter/seta abrem o mega-menu, seta entra nos itens, Escape fecha e devolve o foco", async ({ page }) => {
    await login(page);
    const btn = page.getByTestId("nav-module").filter({ hasText: "Financeiro" });
    await btn.focus(); await expect(page.getByTestId("mega-menu")).toHaveCount(0);
    await page.keyboard.press("Enter"); await expect(page.getByTestId("mega-menu")).toBeVisible();
    await page.keyboard.press("ArrowDown"); await expect(page.getByTestId("mega-item").first()).toBeFocused();
    await page.keyboard.press("Escape"); await expect(page.getByTestId("mega-menu")).toBeHidden(); await expect(btn).toBeFocused();
    await page.keyboard.press("ArrowDown"); await expect(page.getByTestId("mega-menu")).toBeVisible(); await expect(page.getByTestId("mega-item").first()).toBeFocused();
  });

  test("busca global: Ctrl+K foca, Enter abre a rota canônica; '+' da barra de abas também foca a busca", async ({ page }) => {
    await login(page);
    await page.keyboard.press("Control+k"); const box = page.getByTestId("global-search"); await expect(box).toBeFocused();
    await box.fill("plano de contas"); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/configuracoes\?tab=financeiro&sub=chart-accounts/);
    await expect(page.getByTestId("workspace-tabs").getByRole("tab", { name: "Configurações" })).toHaveAttribute("aria-selected", "true");
    await page.getByTestId("workspace-tabs-new").click(); await expect(box).toBeFocused();
  });

  test("todos os módulos permanecem acessíveis em 1920 / 1440 / 1366 / 1024 (barra + 'Mais'), sem rolagem horizontal", async ({ page }) => {
    await login(page);
    for (const width of [1920, 1440, 1366, 1024]) {
      await page.setViewportSize({ width, height: 800 }); await page.waitForTimeout(150);
      const nav = page.getByRole("navigation", { name: "Menu principal" });
      const more = nav.getByTestId("nav-more"); if (await more.count()) await more.click();
      for (const m of MODULES) await expect(nav.getByTestId("nav-module").filter({ hasText: m }).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `sem rolagem horizontal em ${width}`).toBe(true);
      await page.keyboard.press("Escape");
    }
  });

  test("fazenda, notificações e usuário: contexto na barra; Perfil navega; Sair volta ao login", async ({ page }) => {
    await login(page);
    const farm = page.getByLabel("Fazenda ativa"); const options = await farm.locator("option").allTextContents(); expect(options.length).toBeGreaterThan(1);
    await farm.selectOption({ index: 1 }); await expect(farm).not.toHaveValue(""); await expect(page).toHaveURL(/\/$/);
    await page.getByLabel("Notificações").click(); await expect(page.getByRole("menuitem", { name: "Ver todas" })).toBeVisible(); await page.keyboard.press("Escape");
    await page.getByLabel("Usuário").click(); await page.getByRole("menuitem", { name: "Perfil" }).click(); await expect(page).toHaveURL(/\/admin\/perfil/);
    await logout(page);
  });

  /**
   * O BADGE segue o contador VIVO da caixa, não o contexto congelado.
   *
   * A caixa e pollada (refetchInterval); o /auth/context so e recarregado em mount, evento de sessao ou
   * refresh() explicito. Lendo o contexto, o badge ficava parado em 2 enquanto a caixa ja mostrava 3.
   *
   * A prova precisa separar as duas fontes, entao elas respondem numeros DIFERENTES de proposito: o
   * contexto diz 2, a caixa diz 7 com apenas 3 itens. O badge tem de mostrar 7 — nem 2 (contexto
   * congelado), nem 3 (derivado da lista truncada, que e o anti-padrao proibido: a caixa para em 50).
   */
  test("badge de não lidas vem do contador da caixa, não do contexto nem do tamanho da lista", async ({ page }) => {
    await page.route("**/api/auth/context", async (route) => {
      const resposta = await route.fetch();
      const corpo = await resposta.json();
      await route.fulfill({ response: resposta, json: { ...corpo, unreadNotifications: 2 } });
    });
    await page.route("**/api/admin/notifications", async (route) => {
      const resposta = await route.fetch();
      const corpo = await resposta.json();
      const itens = (corpo.items ?? []).slice(0, 3);
      await route.fulfill({ response: resposta, json: { items: itens, unread: 7 } });
    });
    await login(page);
    const badge = page.getByTestId("nao-lidas");
    await expect(badge).toHaveText("7");
    await logout(page);
  });

  test("permissões: operador não vê Financeiro no menu nem na busca; deep link continua bloqueado", async ({ page }) => {
    await login(page, { email: "operador@demo.local", password: "Demo@12345" });
    const nav = page.getByRole("navigation", { name: "Menu principal" }); const more = nav.getByTestId("nav-more"); if (await more.count()) await more.click();
    await expect(nav.getByTestId("nav-module").filter({ hasText: "Financeiro" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByTestId("global-search").fill("contas a pagar"); await expect(page.getByTestId("nav-search-results")).toHaveCount(0);
    await page.goto("/financeiro?tab=contas"); await expect(page.getByText(/Sem permissão/)).toBeVisible();
  });
});
