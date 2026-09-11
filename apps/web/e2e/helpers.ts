import { expect, type Page } from "@playwright/test";
export const ADMIN = { email: process.env.E2E_ADMIN_EMAIL ?? "admin@demo.local", password: process.env.E2E_ADMIN_PASSWORD ?? "Demo@12345" };
export async function login(page: Page, u = ADMIN) {
  await page.goto("/login"); await page.fill("#email", u.email); await page.fill("#password", u.password); await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("Painel de Controle").first()).toBeVisible();
}
/** Seleciona uma opção em um RefSelect (popover com busca). */
export async function pickRef(page: Page, fieldLabel: string, search: string) {
  const field = page.locator("label", { hasText: fieldLabel }).first().locator("..");
  await field.locator("button").first().click();
  const input = page.getByPlaceholder("Pesquisar..."); await input.fill(search);
  await page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last().getByRole("option", { name: new RegExp(search.slice(0, 12), "i") }).first().click();
}
export const uniq = (p: string) => `${p} ${Date.now().toString(36)}`;
