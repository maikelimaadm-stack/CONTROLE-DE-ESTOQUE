import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/** Regras do modelo base (MG): seleção, modo Registro, histórico/anexos por registro, congelar colunas. */
test.describe("modelo base: seleção, registro, anexos", () => {
  test("clique seleciona um só; Ctrl acumula; histórico e anexos exigem exatamente um registro", async ({ page }) => {
    await login(page); await page.goto("/cadastros/farms");
    const rows = page.getByTestId("b1-row"); await expect(rows.nth(1)).toBeVisible();
    await rows.nth(0).click(); await expect(page.getByText("Selecionados: 1")).toBeVisible();
    await rows.nth(1).click(); await expect(page.getByText("Selecionados: 1")).toBeVisible(); await expect(rows.nth(1)).toHaveClass(/selected/); await expect(rows.nth(0)).not.toHaveClass(/selected/);
    await expect(page.getByTestId("b1-attach")).toBeEnabled();
    await rows.nth(0).click({ modifiers: ["Control"] }); await expect(page.getByText("Selecionados: 2")).toBeVisible();
    await expect(page.getByTestId("b1-attach")).toBeDisabled();
    await page.getByLabel("Mais opções").click(); await expect(page.getByRole("menuitem", { name: /Histórico/ })).toBeDisabled(); await page.keyboard.press("Escape");
    await rows.nth(1).click(); await rows.nth(1).click(); await expect(page.getByText("Selecionados: 0")).toBeVisible();
    // cards: mesma semântica
    await page.getByLabel("Cards", { exact: true }).click(); const cards = page.getByTestId("b1-card"); await expect(cards.nth(1)).toBeVisible();
    await cards.nth(0).click(); await cards.nth(1).click(); await expect(page.getByText("Selecionados: 1")).toBeVisible(); await expect(cards.nth(1)).toHaveClass(/is-selected/);
    await page.getByLabel("Tabela", { exact: true }).click();
  });

  test("modo registro: abre o selecionado, navega, volta com o registro selecionado; edição só Salvar; novo sem navegação", async ({ page }) => {
    await login(page); await page.goto("/cadastros/farms");
    const rows = page.getByTestId("b1-row"); await expect(rows.nth(1)).toBeVisible();
    await rows.nth(1).click(); await page.getByLabel("Registro", { exact: true }).click();
    const form = page.getByTestId("b1-form"); await expect(form).toBeVisible(); await expect(form.getByText("2/2")).toBeVisible();
    await page.getByLabel("Anterior").click(); await expect(form.getByText("1/2")).toBeVisible();
    // volta para a tabela: o registro aberto (1º) fica selecionado
    await page.getByLabel("Tabela", { exact: true }).click(); await expect(rows.nth(0)).toHaveClass(/selected/); await expect(page.getByText("Selecionados: 1")).toBeVisible();
    // edição: só Salvar/Cancelar, sem Novo, sem alternância de modo, navegação bloqueada
    await page.getByLabel("Registro", { exact: true }).click(); await page.getByRole("button", { name: /^Editar/ }).click();
    await expect(page.getByRole("button", { name: /^Salvar/ })).toBeVisible(); await expect(page.getByRole("button", { name: /^Novo/ })).toHaveCount(0);
    await expect(page.getByLabel("Tabela", { exact: true })).toHaveCount(0); await expect(page.getByLabel("Próximo")).toBeDisabled();
    await page.getByRole("button", { name: /^Cancelar/ }).click(); await expect(page.getByRole("button", { name: /^Editar/ })).toBeVisible();
    // novo: sem Anterior/Próximo, com Salvar/Cancelar
    await page.getByRole("button", { name: /^Novo/ }).click(); await expect(page.getByRole("button", { name: /^Salvar/ })).toBeVisible(); await expect(page.getByLabel("Próximo")).toHaveCount(0); await expect(page.getByLabel("Anterior")).toHaveCount(0);
    await page.getByRole("button", { name: /^Cancelar/ }).click();
  });

  test("anexos: envia, mostra prévia, baixa e exclui; congelar colunas", async ({ page }) => {
    await login(page); await page.goto("/cadastros/farms");
    const rows = page.getByTestId("b1-row"); await expect(rows.nth(0)).toBeVisible(); await rows.nth(0).click();
    await page.getByTestId("b1-attach").click(); const dlg = page.getByRole("dialog"); await expect(dlg.getByRole("heading", { name: /Anexos —/ })).toBeVisible();
    await dlg.getByLabel("Nome do anexo").fill("Laudo E2E");
    await dlg.getByLabel("Selecionar arquivos").setInputFiles({ name: "laudo e2e.txt", mimeType: "text/plain", buffer: Buffer.from("conteudo do laudo e2e") });
    const item = page.getByTestId("b1-attachment").filter({ hasText: "laudo_e2e.txt" }); await expect(item).toBeVisible(); await expect(item).toContainText("Laudo E2E");
    await item.getByLabel(/^Prévia de/).click(); await expect(page.getByTestId("b1-attachment-preview")).toContainText("conteudo do laudo e2e");
    const dl = page.waitForEvent("download"); await item.getByLabel(/^Baixar/).click(); expect((await dl).suggestedFilename()).toBe("laudo_e2e.txt");
    await item.getByLabel(/^Excluir/).click(); await page.getByRole("button", { name: "Confirmar" }).click(); await expect(item).toHaveCount(0);
    await page.keyboard.press("Escape");
    // congelar até a 2ª coluna congela as duas; o menu da âncora descongela todas
    const ths = page.locator(".mg-grid thead th.is-frozen");
    await page.getByLabel(/^Abrir menu da coluna/).nth(1).click(); await page.getByRole("menuitem", { name: "Congelar coluna" }).click(); await expect(ths).toHaveCount(2);
    await page.getByLabel(/^Abrir menu da coluna/).nth(1).click(); await page.getByRole("menuitem", { name: "Descongelar colunas" }).click(); await expect(ths).toHaveCount(0);
  });
});
