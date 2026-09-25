import { test, expect, type Page } from "@playwright/test";
import { login, api, uniq, empresaAtiva } from "./helpers";

/**
 * R1-1 c (revisão do R1) — DEVOLUÇÃO A PARTIR DA REQUISIÇÃO, com a saída feita pela escolha automática de lote.
 *
 * Na saída sem lote a API escolhe o lote pela validade e pode DIVIDIR o item entre lotes; o lote escolhido fica só
 * no MOVIMENTO (o item da requisição não tem lote). A devolução pré-preenchida pelo ITEM vinha sem lote — produto com
 * controle recebia 422 ao salvar — e com uma linha só para uma saída de dois lotes.
 *
 * LT-W1  Requisição de 5 sem lote sobre LTW-CEDO (3, validade 10/01/2099) e LTW-TARDE (10, validade 10/06/2099):
 *        o detalhe mostra o lote de cada movimento; "Devolver itens" abre a devolução com UMA LINHA POR LOTE, com
 *        quantidade, lote e validade de cada parte; salvar devolve cada lote ao saldo de antes.
 */
async function armazemDaEmpresa(page: Page, empresaId: string): Promise<string> {
  const r = await api<{ items: { id: string; empresa_id?: string }[] }>(page, "GET", "/api/resources/warehouses?pageSize=100");
  const id = (r.items ?? []).find((w) => w.empresa_id === empresaId)?.id;
  expect(id, "a empresa ativa precisa de um armazém para esta fixture").toBeTruthy();
  return id!;
}

test("LT-W1 — devolução da requisição dividida em 2 lotes: uma linha por lote, com lote e validade; o detalhe mostra o lote de cada movimento", async ({ page }) => {
  await login(page);
  await page.goto("/estoque");
  const empresaId = await empresaAtiva(page);
  const armazem = await armazemDaEmpresa(page, empresaId);
  const unidades = await api<{ id: string; label: string }[]>(page, "GET", "/api/resources/measurement_units/options");
  const un = unidades.find((u) => u.label.toUpperCase() === "UN")!;
  const grupos = await api<{ id: string }[]>(page, "GET", "/api/resources/product_groups/options?kind=analytic");
  const naturezas = await api<{ id: string }[]>(page, "GET", "/api/resources/financial_categories/options?kind=analytic&nature=expense");
  const produto = await api<{ id: string }>(page, "POST", "/api/resources/products", { description: uniq("LT-W1 produto com lote"), group_id: grupos[0]!.id, measurement_id: un.id, financial_category_id: naturezas[0]!.id, controle_lote: "lote_validade" });

  for (const [lote, validade, quantidade] of [["LTW-CEDO", "2099-01-10", "3"], ["LTW-TARDE", "2099-06-10", "10"]] as const) {
    await api(page, "POST", "/api/stock/opening-balances", { empresa_id: empresaId, warehouse_id: armazem, product_id: produto.id, quantity: quantidade, unit_value: "5", provider_lot: lote, expiration_date: validade });
  }
  // saída SEM lote: a escolha automática esgota o LTW-CEDO (3) e tira 2 do LTW-TARDE
  const requisicao = await api<{ id: string }>(page, "POST", "/api/stock/requisitions", { empresa_id: empresaId, requisition_date: "2026-09-22", items: [{ warehouse_id: armazem, product_id: produto.id, quantity: "5" }] });

  await page.goto(`/estoque/requisicoes/${requisicao.id}`);
  const ledger = page.locator('[data-testid="base2-section"][data-secao="Movimentações de estoque (ledger)"]');
  await expect(ledger).toBeVisible();
  await expect(ledger).toContainText("LTW-CEDO");
  await expect(ledger).toContainText("LTW-TARDE");

  await page.getByRole("link", { name: "Devolver itens" }).click();
  await expect(page).toHaveURL(new RegExp(`/estoque/devolucoes/new\\?requisition_id=${requisicao.id}`));
  const linhas = page.locator("table tbody tr");
  await expect(linhas).toHaveCount(2);
  // cada linha do editor: [quantidade, valor unitário, lote, validade]
  const valores = await linhas.evaluateAll((trs) => trs.map((tr) => Array.from(tr.querySelectorAll("input")).map((i) => (i as HTMLInputElement).value)));
  expect(valores.map((v) => [v[2], v[3], v[0]]).sort()).toEqual([["LTW-CEDO", "2099-01-10", "3.0000"], ["LTW-TARDE", "2099-06-10", "2.0000"]]);

  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page).toHaveURL(/\/estoque\?tab=operacoes&sub=devolucoes/);
  // cada lote voltou ao saldo de antes da requisição — nenhum 422, nenhum lote novo
  const saldo = await api<{ lots: { provider_lot: string; quantity: string }[] }>(page, "GET", `/api/stock/balances/${armazem}/${produto.id}`);
  expect(saldo.lots.map((l) => [l.provider_lot, l.quantity]).sort()).toEqual([["LTW-CEDO", "3.0000"], ["LTW-TARDE", "10.0000"]]);
});
