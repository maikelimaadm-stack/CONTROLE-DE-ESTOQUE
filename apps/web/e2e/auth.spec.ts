import { test, expect } from "@playwright/test";
import { login } from "./helpers";
test("login inválido é rejeitado e login válido abre o painel", async ({ page }) => {
  await page.goto("/login"); await page.fill("#email", "ninguem@demo.local"); await page.fill("#password", "senha-errada"); await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.locator("text=/inválid|incorret|não autorizado|credenciais/i").first()).toBeVisible();
  await login(page);
  await expect(page.getByText("Receitas realizadas")).toBeVisible();
});
test("rota protegida sem sessão redireciona para login", async ({ page }) => {
  await page.goto("/financeiro/contas-a-pagar"); await expect(page).toHaveURL(/login/);
});
