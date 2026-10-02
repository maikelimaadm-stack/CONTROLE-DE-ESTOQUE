import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * MAPA-01 (decisão 279) — fumaça do módulo Mapa de Manejo: a página do 15º módulo abre, mostra o cabeçalho, o
 * botão "Nova área" e a lista de áreas (vazia no banco de e2e). Não exercita o desenho no canvas (depende de
 * WebGL e da chave do Google, ausentes no e2e); o CRUD e a validação são provados na integração da API.
 */
test("o módulo Mapa de Manejo abre e lista as áreas", async ({ page }) => {
  await login(page);
  await page.goto("/mapa-de-manejo");
  await expect(page.getByRole("heading", { name: "Mapa de Manejo" })).toBeVisible();
  await expect(page.getByTestId("mapa-nova-area")).toBeVisible();
  await expect(page.getByText("Nenhuma área cadastrada")).toBeVisible();
});
