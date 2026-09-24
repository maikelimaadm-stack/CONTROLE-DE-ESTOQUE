import { test, expect, type Page } from "@playwright/test";
import { login, logout, api, uniq, abrirLancamentoDeVendas, escolherTopEContinuar } from "./helpers";

/**
 * CADASTROS-ESTRUTURA (decisão 250) na tela.
 *
 * CE-W1  Configurações › Financeiro: Naturezas · Centros de Resultado · Plano de Contas, nessa ordem; os nomes
 *        antigos não são título de nada; a busca pelos nomes antigos acha as telas novas; o endereço antigo de
 *        Centros de Custo (aba Empresa) abre a tela; perfil só com `cost_centers.view` vê Financeiro.
 * CE-W2  Central de Vendas: os campos da A1 chamam "Natureza" e "Centro de resultado".
 * CE-W3  Produto: sem Categoria/Classe; o lookup de Grupo só oferece grupos ANALÍTICOS.
 * CE-4   Natureza filha nasce com o Tipo do superior pré-preenchido.
 *
 * Só o RÓTULO mudou: chave de registry, permissão e URL continuam as mesmas (a prova do endereço antigo é
 * exatamente isso).
 */

const ORDEM_FINANCEIRO = ["Naturezas", "Centros de Resultado", "Plano de Contas"];

async function nomesDasAbas(page: Page) {
  return (await page.locator("main").getByRole("tab").allInnerTexts()).map((t) => t.trim());
}

test("CE-W1 — Configurações › Financeiro: Naturezas, Centros de Resultado, Plano de Contas; nomes antigos só como palavra-chave; endereço antigo abre", async ({ page }) => {
  await login(page);
  await page.goto("/configuracoes?tab=financeiro&sub=financial-categories");
  await expect(page.locator("main").getByRole("tab", { name: "Naturezas", exact: true })).toBeVisible();
  const abas = await nomesDasAbas(page);
  const pos = ORDEM_FINANCEIRO.map((n) => abas.indexOf(n));
  expect(pos.every((p) => p >= 0), `as três abas existem: ${abas.join(" | ")}`).toBe(true);
  expect(pos, "nesta ordem e juntas").toEqual([pos[0]!, pos[0]! + 1, pos[0]! + 2]);
  for (const antigo of ["Categorias Financeiras", "Centros de Custo", "Conta do Plano"]) expect(abas, `"${antigo}" não é título`).not.toContain(antigo);

  // Centros de Resultado saiu da aba Empresa
  await page.goto("/configuracoes?tab=empresa&sub=empresas");
  await expect(page.locator("main").getByRole("tab", { name: "Empresas", exact: true })).toBeVisible();
  expect(await nomesDasAbas(page)).not.toContain("Centros de Resultado");

  // ENDEREÇO ANTIGO: aba Empresa › cost-centers é canonicalizado para Financeiro › cost-centers
  await page.goto("/configuracoes?tab=empresa&sub=cost-centers");
  await expect(page).toHaveURL(/\/configuracoes\?tab=financeiro&sub=cost-centers/);
  await expect(page.locator("main").getByRole("tab", { name: "Centros de Resultado", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("table").first()).toBeVisible();
  // a lista do cadastro (mesma chave de sempre) também continua abrindo, com o título novo
  await page.goto("/cadastros/cost_centers");
  await expect(page.getByText("Centros de Resultado").first()).toBeVisible();
  await expect(page.getByText("Centros de Custo", { exact: true })).toHaveCount(0);

  // BUSCA pelos nomes antigos acha as telas novas — na busca de Configurações e na busca global
  await page.goto("/configuracoes");
  const busca = page.getByLabel("Buscar configuração");
  const resultados = page.getByTestId("config-search-results");
  await busca.fill("centro de custo");
  await expect(resultados.getByRole("option", { name: /Centros de Resultado/ })).toBeVisible();
  await busca.fill("categoria financeira");
  await expect(resultados.getByRole("option", { name: /Naturezas/ })).toBeVisible();
  await busca.fill("conta do plano");
  await expect(resultados.getByRole("option", { name: /Plano de Contas/ })).toBeVisible();
  await busca.fill("");
  const global = page.getByLabel("Buscar funcionalidade");
  await global.fill("centros de custo");
  await page.getByTestId("nav-search-results").getByRole("option", { name: /Centros de Resultado/ }).first().click();
  await expect(page).toHaveURL(/\/configuracoes\?tab=financeiro&sub=cost-centers/);
});

test("CE-W1 — perfil só com cost_centers.view vê Configurações › Financeiro com Centros de Resultado (e mais nada do Financeiro)", async ({ page }) => {
  await login(page);
  const papel = await api<{ id: string }>(page, "POST", "/api/admin/roles", { name: uniq("Só Centros E2E"), permissions: ["cost_centers.view"] });
  const leitor = { email: `e2e-so-centros-${Date.now()}@demo.local`, password: "Centros@12345" };
  await api(page, "POST", "/api/admin/members", { name: "Leitor E2E de Centros", email: leitor.email, password: leitor.password, role_id: papel.id, escopos_empresas: [] });
  await logout(page);
  await login(page, leitor);
  await page.goto("/configuracoes");
  const financeiro = page.locator("main").getByRole("tab", { name: "Financeiro", exact: true });
  await expect(financeiro, "a área Financeiro aparece para quem só tem cost_centers.view").toBeVisible();
  await expect(page.locator("main").getByRole("tab", { name: /^Empresa/ }), "a aba Empresa não é mais a porta dos centros").toHaveCount(0);
  await financeiro.click();
  await expect(page.locator("main").getByRole("tab", { name: "Centros de Resultado", exact: true })).toBeVisible();
  const abas = await nomesDasAbas(page);
  expect(abas, "sem permissão, Naturezas e Plano de Contas não aparecem").not.toContain("Naturezas");
  expect(abas).not.toContain("Plano de Contas");
  await page.goto("/configuracoes?tab=empresa&sub=cost-centers");
  await expect(page).toHaveURL(/\/configuracoes\?tab=financeiro&sub=cost-centers/);
  await expect(page.locator("table").first()).toBeVisible();
});

test("CE-W2 — Central de Vendas: 'Natureza' e 'Centro de resultado' (e não os nomes antigos)", async ({ page }) => {
  await login(page);
  const top = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo: `6${Date.now().toString(36)}ce`, codigoBase: "vendas.venda", nome: uniq("CE-W2") });
  await abrirLancamentoDeVendas(page, "sales");
  await escolherTopEContinuar(page, top.id);
  const dados = page.getByTestId("central-vendas").getByRole("region", { name: "Dados principais" });
  await expect(dados.locator("label", { hasText: /^Natureza/ })).toBeVisible();
  await expect(dados.locator("label", { hasText: /^Centro de resultado/ })).toBeVisible();
  await expect(dados.locator("label", { hasText: "Categoria financeira" })).toHaveCount(0);
  await expect(dados.locator("label", { hasText: "Centro de custo" })).toHaveCount(0);
});

test("CE-W3 — produto: sem Categoria/Classe; o lookup de Grupo só oferece grupos analíticos", async ({ page }) => {
  await login(page);
  // premissa: a demo tem o sintético "Pecuária" e o analítico "Rações e Suplementos" abaixo dele
  const grupos = await api<{ items: { name: string; kind: string }[] }>(page, "GET", "/api/resources/product_groups?pageSize=100");
  expect(grupos.items.find((g) => g.name === "Pecuária")?.kind, "premissa: Pecuária é sintético").toBe("synthetic");
  expect(grupos.items.find((g) => g.name === "Rações e Suplementos")?.kind, "premissa: Rações é analítico").toBe("analytic");

  await page.goto("/cadastros/products/new");
  const form = page.locator("form").first();
  await expect(form.locator("label", { hasText: /^Grupo/ }).first()).toBeVisible();
  await expect(form.locator("label", { hasText: /^Categoria( \*)?$/ })).toHaveCount(0);
  await expect(form.locator("label", { hasText: /^Classe( \*)?$/ })).toHaveCount(0);

  const resposta = (busca: string) => page.waitForResponse((r) => { const u = new URL(r.url()); return u.pathname.endsWith("/api/resources/product_groups/options") && u.searchParams.get("search") === busca; });
  await form.locator("label", { hasText: /^Grupo/ }).first().locator("..").locator("button").first().click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  const r1 = resposta("Pecu"); await page.getByPlaceholder("Pesquisar...").fill("Pecu"); await r1;
  await expect(painel.getByRole("option", { name: /Pecuária/ }), "o sintético não é oferecido").toHaveCount(0);
  const r2 = resposta("Rações"); await page.getByPlaceholder("Pesquisar...").fill("Rações"); await r2;
  await expect(painel.getByRole("option", { name: /Rações e Suplementos/ }).first(), "o analítico é oferecido").toBeVisible();
});

test("CE-4 — natureza filha nasce com o Tipo do superior pré-preenchido (editável)", async ({ page }) => {
  await login(page);
  const r = await api<{ items: { id: string; code: string; nature: string }[] }>(page, "GET", "/api/resources/financial_categories?code=2.02");
  const pai = r.items.find((x) => x.code === "2.02");
  expect(pai?.nature, "premissa: 2.02 Custos da Pecuária é de Despesa").toBe("expense");
  await page.goto(`/cadastros/financial_categories/new?parent_id=${pai!.id}`);
  await expect(page.getByLabel(/^Tipo/).first(), "o Tipo vem do superior").toContainText("Despesa");

  // superior "Receita e despesa" também pré-preenche (e ali o filho pode divergir; a regra é da API)
  const { codigo } = await api<{ codigo: string }>(page, "GET", "/api/resources/financial_categories/proximo-codigo");
  const raiz = await api<{ id: string }>(page, "POST", "/api/resources/financial_categories", { code: codigo, name: uniq("CE4 Ambos"), nature: "both", kind: "synthetic" });
  await page.goto(`/cadastros/financial_categories/new?parent_id=${raiz.id}`);
  await expect(page.getByLabel(/^Tipo/).first()).toContainText("Receita e despesa");
});
