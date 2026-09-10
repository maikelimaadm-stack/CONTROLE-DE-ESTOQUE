import { test, expect } from "@playwright/test";
import { login } from "./helpers";
/** Usuário "Operador de Estoque" do seed demo: sem permissões financeiras. */
test("menu e rotas respeitam permissões do perfil (operador não vê financeiro)", async ({ page }) => {
  await login(page, { email: "operador@demo.local", password: "Demo@12345" });
  await expect(page.locator("aside, nav").getByText("Contas a Pagar")).toHaveCount(0);
  // acesso direto é negado pelo servidor (403 PERMISSION_DENIED), não apenas escondido no menu
  await page.goto("/financeiro/contas-a-pagar");
  await expect(page.getByText(/Sem permissão|Acesso negado/i).first()).toBeVisible();
});
