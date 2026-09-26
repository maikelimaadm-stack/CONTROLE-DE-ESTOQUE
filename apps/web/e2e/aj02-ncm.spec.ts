import { test, expect, type Page } from "@playwright/test";
import { api, login, uniq } from "./helpers";
import { aba, conferirPartes, opcoes, painel, sql } from "./aj02-comum";

/**
 * AJUSTES 02 · 18 — Produto (aba Fiscal): Descrição do NCM e NCM em campos SEPARADOS. NCM REAL da 0026:
 * 01022110 (nível 8, escolhível). O nome esperado vem da PRÓPRIA API de referência (nunca inventado aqui).
 */
const NCM = "01022110";
const NCM_FMT = "0102.21.10";

async function nomeDoNcm(page: Page) {
  const ref = await api<{ codigo: string; nome: string; escolhivel: boolean }>(page, "GET", `/api/referencias/ncm/${NCM}`);
  expect(ref.escolhivel, "premissa: NCM de 8 dígitos escolhível").toBe(true);
  expect(ref.nome?.trim().length ?? 0, "premissa: o NCM tem descrição").toBeGreaterThan(3);
  return ref.nome.trim();
}

test("AJ02-18a — produto novo: busca \"01022110\" → Descrição do NCM (só o nome) e NCM separados", async ({ page }) => {
  await login(page);
  const nome = await nomeDoNcm(page);
  await page.goto("/cadastros/products/new");
  await aba(page, "Fiscal").click();
  for (const r of ["Descrição do NCM", "NCM"]) await expect(page.locator("label").filter({ hasText: new RegExp(`^${r}( \\*)?$`) }), r).toHaveCount(1);
  await page.getByTestId("ref-ncm-busca").click();
  await painel(page).getByLabel("Pesquisar opção").fill(NCM);
  const alvo = opcoes(page).filter({ hasText: nome });
  await expect(alvo.first(), "a busca acha o NCM").toBeVisible();
  await alvo.first().click();
  await conferirPartes(page.getByTestId("ref-ncm-busca"), page.getByTestId("ref-ncm-codigo"), nome, NCM_FMT);
});

test("AJ02-18b — produto gravado com ncm_code 01022110 reabre com Descrição do NCM e NCM separados", async ({ page }) => {
  await login(page);
  const nome = await nomeDoNcm(page);
  const unidades = await api<{ id: string; label: string }[]>(page, "GET", "/api/resources/measurement_units/options");
  const un = unidades.find((u) => u.label.toUpperCase() === "UN");
  expect(un, "premissa: unidade UN no seed").toBeTruthy();
  const grupos = await api<{ id: string }[]>(page, "GET", "/api/resources/product_groups/options?kind=analytic");
  const naturezas = await api<{ id: string }[]>(page, "GET", "/api/resources/financial_categories/options?kind=analytic&nature=expense");
  expect(grupos.length * naturezas.length, "premissa: grupo e natureza analíticos no seed").toBeGreaterThan(0);
  const p = await api<{ id: string }>(page, "POST", "/api/resources/products", { description: uniq("AJ02-18 produto"), group_id: grupos[0]!.id, measurement_id: un!.id, financial_category_id: naturezas[0]!.id, reference_price: "10.00", ncm_code: NCM });
  expect(sql(`select ncm_code from erp.products where id = '${p.id}'`), "premissa: gravado o código").toBe(NCM);
  await page.goto(`/cadastros/products/${p.id}?view=1`);
  await aba(page, "Fiscal").click();
  await conferirPartes(page.getByTestId("ref-ncm-busca"), page.getByTestId("ref-ncm-codigo"), nome, NCM_FMT);
});
