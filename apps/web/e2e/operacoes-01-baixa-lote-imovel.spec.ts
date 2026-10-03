import { test, expect, type Locator, type Page } from "@playwright/test";
import { login, api, uniq } from "./helpers";

/**
 * OPERACOES-01 (decisão 286) — O IMÓVEL RURAL NA BAIXA EM LOTE DA CENTRAL FINANCEIRA (LCDPR), o mesmo campo da baixa de um
 * título: as opções da EMPRESA dos títulos, o PADRÃO dela já escolhido, e o imóvel escolhido vai no corpo e é gravado em
 * cada baixa e no movimento. Dados novos pela API (uma empresa só deste caso, com dois imóveis: A padrão e B); a premissa
 * (a API declara o LCDPR, as opções da empresa) é conferida antes da tela, e a conclusão é lida na API depois.
 */
type Conta = { id: string; code: string; description: string };
async function primeiroId(page: Page, caminho: string, oQue: string): Promise<string> {
  const r = await api<{ items: { id: string }[] }>(page, "GET", caminho);
  expect(r.items?.[0]?.id, `premissa: o seed tem ${oQue}`).toBeTruthy();
  return r.items[0]!.id;
}
const linhaDo = (central: Locator, numero: string) => central.locator("tbody tr").filter({ hasText: numero });

test("Baixa em lote com o imóvel rural: o padrão da empresa vem escolhido, escolher outro manda o id, e as duas baixas e o movimento o gravam", async ({ page }) => {
  await login(page);
  const ctx = await api<{ capacidades?: Record<string, unknown> }>(page, "GET", "/api/auth/context");
  expect(ctx.capacidades?.["lcdpr"], "premissa: a API declara o LCDPR").toBe(1);

  // A empresa do caso, com o imóvel A (padrão) e o B; os títulos a pagar dela.
  const empresa = await api<{ id: string }>(page, "POST", "/api/resources/empresas", { name: uniq("BL Empresa"), is_active: true });
  const nomeA = uniq("BL Sítio A"); const nomeB = uniq("BL Sítio B");
  const a = await api<{ id: string }>(page, "POST", "/api/resources/imoveis_rurais", { empresa_id: empresa.id, nome: nomeA, tipo_exploracao: "individual", participacao: "100", padrao: true });
  const b = await api<{ id: string }>(page, "POST", "/api/resources/imoveis_rurais", { empresa_id: empresa.id, nome: nomeB, tipo_exploracao: "individual", participacao: "100", padrao: false });
  const opcoes = await api<{ itens: { id: string; padrao: boolean }[] }>(page, "GET", `/api/financeiro/imoveis-rurais/opcoes?empresa_id=${empresa.id}`);
  expect(opcoes.itens.map((i) => [i.id, i.padrao]), "premissa: as opções da empresa, o padrão primeiro").toEqual([[a.id, true], [b.id, false]]);
  const contas = await api<{ items: Conta[] }>(page, "GET", "/api/financial/bank-accounts/balances");
  const bb = contas.items.find((c) => c.code === "BB");
  expect(bb, "premissa: a conta BB do seed").toBeTruthy();
  const fornecedor = await primeiroId(page, "/api/resources/people?is_provider=true&pageSize=1", "um fornecedor");
  const despesa = await primeiroId(page, "/api/resources/financial_categories?kind=analytic&nature=expense&pageSize=1", "uma natureza de despesa analítica");
  const centro = await primeiroId(page, "/api/resources/cost_centers?kind=analytic&pageSize=1", "um centro analítico");
  const prefixo = `BLI${Date.now().toString(36)}`.toUpperCase();
  const ids: string[] = [];
  for (const [sufixo, valor] of [["A", "70.00"], ["B", "30.00"]] as const) {
    const t = await api<{ id: string }>(page, "POST", "/api/financial/payables", {
      empresa_id: empresa.id, number: `${prefixo}-${sufixo}`, person_id: fornecedor, amount: valor, emission_date: "2026-01-10", due_date: "2031-03-10",
      note: `Lote imóvel ${prefixo}`, apportionment: [{ financial_category_id: despesa, cost_center_id: centro, percentage: "100" }]
    });
    ids.push(t.id);
  }

  // A TELA: a busca recorta os dois, seleciona e abre a baixa em lote.
  await page.goto("/financeiro?tab=titulos&sub=pagar");
  const central = page.getByTestId("fin-titulos");
  await expect(central).toBeVisible();
  await central.getByLabel("Busca").fill(prefixo);
  await central.getByRole("button", { name: "Filtrar" }).click();
  await expect(linhaDo(central, prefixo), "a busca recorta os dois títulos do caso").toHaveCount(2);
  for (const s of ["A", "B"]) await linhaDo(central, `${prefixo}-${s}`).getByLabel("Selecionar linha").click();
  await page.getByTestId("fin-lote-baixar").click();
  const dialogo = page.getByTestId("fin-dialogo-baixa-lote");
  await expect(dialogo.getByTestId("fin-baixa-lote-linha")).toHaveCount(2);

  // O CAMPO: as opções da empresa, com o padrão (A) já escolhido; escolhe o B.
  const campo = dialogo.getByTestId("fin-baixa-lote-imovel");
  await expect(campo, "o padrão da empresa vem escolhido").toHaveValue(a.id);
  await expect(campo.locator("option"), "as opções: Sem imóvel, A e B").toHaveText(["Sem imóvel", nomeA, nomeB]);
  await campo.selectOption(b.id);
  await dialogo.locator("label", { hasText: "Conta bancária" }).first().locator("..").locator("button").first().click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(bb!.description);
  await painel.getByRole("option", { name: bb!.description }).first().click();
  const pedido = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/financial/payables/settle-batch");
  await dialogo.getByRole("button", { name: "Confirmar baixa" }).click();
  expect(((await pedido).postDataJSON() as Record<string, unknown>)["imovel_rural_id"], "o corpo leva o imóvel escolhido").toBe(b.id);
  await expect(page.getByTestId("fin-resultado-lote").getByTestId("fin-resultado-resumo")).toHaveText("2 baixado(s) · 0 pulado(s)");

  // A CONCLUSÃO (API): cada título pago, a baixa e o movimento com o imóvel B.
  for (const id of ids) {
    const t = await api<{ status: string; settlements: { imovel_rural_id: string | null; bank_movement_id: string }[] }>(page, "GET", `/api/financial/payables/${id}`);
    expect([t.status, t.settlements.map((s) => s.imovel_rural_id)], "pago, a baixa com o imóvel B").toEqual(["paid", [b.id]]);
    const mov = await api<{ imovel_rural_id: string | null }>(page, "GET", `/api/financial/bank-movements/${t.settlements[0]!.bank_movement_id}`);
    expect(mov.imovel_rural_id, "o movimento da baixa com o imóvel B").toBe(b.id);
  }
});
