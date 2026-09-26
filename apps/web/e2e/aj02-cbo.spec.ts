import { test, expect, type Page } from "@playwright/test";
import { api, login, uniq } from "./helpers";
import { conferirPartes, opcoes, painel } from "./aj02-comum";

/**
 * AJUSTES 02 · 17 — Funções: Ocupação (CBO) e Código CBO em campos SEPARADOS. A CBO oficial é REAL (0026:
 * ('621005','Trabalhador agropecuário em geral')); busca por código e por nome sem acento.
 */
const NOME = "Trabalhador agropecuário em geral";

async function escolher(page: Page, termo: string) {
  await page.goto("/cadastros/job_functions/new");
  for (const r of ["Ocupação (CBO)", "Código CBO"]) await expect(page.locator("label").filter({ hasText: new RegExp(`^${r.replace(/[()]/g, "\\$&")}( \\*)?$`) }), r).toHaveCount(1);
  await page.getByTestId("ref-cbo-busca").click();
  await painel(page).getByLabel("Pesquisar opção").fill(termo);
  const alvo = opcoes(page).filter({ hasText: NOME });
  await expect(alvo, `"${termo}" acha a ocupação 621005 (uma opção)`).toHaveCount(1);
  await alvo.click();
  await conferirPartes(page.getByTestId("ref-cbo-busca"), page.getByTestId("ref-cbo-codigo"), NOME, "621005");
}

test("AJ02-17a — CBO por código \"621005\": Ocupação (CBO) só com o nome e Código CBO separado", async ({ page }) => {
  await login(page);
  const ref = await api<{ codigo: string; nome: string }>(page, "GET", "/api/referencias/cbo/621005");
  expect(ref.nome, "premissa: a referência real tem o 621005").toBe(NOME);
  await escolher(page, "621005");
});

test("AJ02-17b — CBO por nome sem acento \"agropecuario em geral\": as mesmas partes", async ({ page }) => {
  await login(page);
  await escolher(page, "agropecuario em geral");
});

test("AJ02-17c — função gravada com cbo_code 621005 reabre com as partes separadas", async ({ page }) => {
  await login(page);
  const f = await api<{ id: string }>(page, "POST", "/api/resources/job_functions", { name: uniq("AJ02-17 função"), cbo_code: "621005", base_salary: "2000.00", monthly_hours: 220, hour_value: "9.09", description: "E2E AJ02-17" });
  await page.goto(`/cadastros/job_functions/${f.id}?view=1`);
  await conferirPartes(page.getByTestId("ref-cbo-busca"), page.getByTestId("ref-cbo-codigo"), NOME, "621005");
});
