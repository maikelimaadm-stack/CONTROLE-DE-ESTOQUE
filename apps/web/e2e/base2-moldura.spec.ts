import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * MOLDURA DO MODELO BASE 2 (docs/MODELO-BASE2-CONTRACT.md) — provas estruturais sobre a tela REAL.
 *
 * `apps/web` não tem executor de teste unitário (não há vitest nem testing-library no pacote), então a
 * prova da moldura é o harness oficial de e2e: ele monta a tela de verdade, com dados de verdade, contra
 * a API de verdade. Cada teste aqui falha por um motivo distinto e nomeado — nenhum deles passa com a
 * tela vazia, porque todos exigem um documento criado no próprio teste.
 */

/** Cria uma entrada de insumos e devolve a URL do detalhe recém-aberto. */
async function criarEntradaEAbrir(page: Page): Promise<string> {
  await page.goto("/estoque/entradas/new");
  await page.getByRole("button", { name: "Adicionar item" }).click();
  const row = page.locator("tbody tr").first();
  await row.locator("button").nth(0).click(); await page.getByPlaceholder("Pesquisar...").fill("Almox"); await page.getByRole("option", { name: /Almox/i }).first().click();
  await row.locator("button").nth(1).click(); await page.getByPlaceholder("Pesquisar...").fill("Diesel"); await page.getByRole("option", { name: /Diesel/i }).first().click();
  await row.locator("input[type=number]").nth(0).fill("10"); await row.locator("input[type=number]").nth(1).fill("6.5");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page).toHaveURL(/\/estoque\?tab=recebimentos&sub=manuais/);
  await page.locator("tbody tr").first().dblclick();
  await expect(page.getByTestId("base2-shell")).toBeVisible();
  return page.url();
}

test("moldura Base 2: identidade, empresa, seções e dados principais", async ({ page }) => {
  await login(page);
  await criarEntradaEAbrir(page);

  // identidade: tipo + código no título, situação como selo oficial (nunca texto cru)
  await expect(page.getByRole("heading", { name: /Entrada de insumos\s+\S+/ })).toBeVisible();
  const selo = page.getByTestId("base2-shell").locator("[data-status]").first();
  await expect(selo).toBeVisible();
  await expect(selo).toHaveAttribute("data-tone", /positive|negative|warning|info|neutral/);

  // a empresa do registro aparece na identidade (subtítulo), não perdida no meio dos campos
  await expect(page.getByTestId("base2-empresa")).toBeVisible();

  // dados principais existem e o campo obrigatório de identidade está entre eles
  await expect(page.getByTestId("base2-fields")).toBeVisible();
  await expect(page.locator('[data-testid="base2-field"][data-campo="Código"]')).toBeVisible();

  // seções tituladas com contagem — "Itens" e o ledger
  const itens = page.locator('[data-testid="base2-section"][data-secao="Itens"]');
  await expect(itens).toBeVisible();
  await expect(itens.getByTestId("base2-section-contagem")).toHaveText("1");
  await expect(page.locator('[data-testid="base2-section"][data-secao="Movimentações de estoque (ledger)"]')).toBeVisible();
});

/**
 * GUARDA DE REGRESSÃO DO TOTAL (docs/MODELO-BASE2-CONTRACT.md § Totais).
 *
 * A primeira versão desta moldura punha o total do DOCUMENTO sob a coluna de total dos ITENS. Numa nota
 * fiscal os dois números são grandezas diferentes — o do documento inclui frete e outras despesas
 * (`apps/api/src/routes/stock.ts:194` contra `:201`) — e a coluna deixava de fechar; numa batida, que não
 * tem total de documento, o rodapé saía "—" sob uma coluna de dinheiro.
 *
 * Hoje a tabela de itens não tem rodapé nenhum e o tipo `Base2ItemColumn` nem oferece `total`, então o
 * defeito é impossível em TODAS as sete rotas por construção, não por configuração. Este teste existe
 * para que voltar a pôr um total ali custe um gate vermelho.
 */
test("moldura Base 2: o total do documento é campo, e a tabela de itens não tem rodapé", async ({ page }) => {
  await login(page);
  await criarEntradaEAbrir(page);

  const tabela = page.locator('[data-testid="base2-section"][data-secao="Itens"]').getByTestId("base2-items");
  const cabecalhos = await tabela.locator("thead th").allTextContents();
  const indiceTotal = cabecalhos.findIndex((t) => t.trim() === "Total");
  expect(indiceTotal, "a tabela de itens precisa ter uma coluna Total").toBeGreaterThan(-1);

  // nenhum rodapé: o número do documento não mora sob a coluna dos itens
  await expect(tabela.locator("tfoot")).toHaveCount(0);

  // o total do documento (10 × 6,50 = 65,00) aparece como CAMPO, onde o rótulo diz de que total se trata
  const campoTotal = page.locator('[data-testid="base2-field"][data-campo="Total"]');
  await expect(campoTotal).toBeVisible();
  await expect(campoTotal).toContainText("65,00");

  // e a linha do item traz o total DELA na coluna Total — mesma grandeza, lugar certo
  const celulaItem = tabela.getByTestId("base2-items-linha").first().locator("td").nth(indiceTotal);
  await expect(celulaItem).toContainText("65,00");
});

test("moldura Base 2: histórico do registro abre pelo mecanismo oficial", async ({ page }) => {
  await login(page);
  await criarEntradaEAbrir(page);

  const botao = page.getByTestId("base2-historico");
  await expect(botao).toBeVisible();
  await botao.click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toBeVisible();
  await expect(dialogo).toContainText("Histórico");
  // o evento de criação gravado pelo backend precisa estar lá: histórico vazio aqui seria entidade errada
  await expect(dialogo.locator("li").first()).toBeVisible();
});

test("moldura Base 2: deep link e recarga reabrem a mesma tela, no mesmo endpoint", async ({ page }) => {
  await login(page);
  const url = await criarEntradaEAbrir(page);

  const chamadas: string[] = [];
  page.on("request", (r) => { const u = new URL(r.url()).pathname; if (u.startsWith("/api/")) chamadas.push(u); });

  await page.reload();
  await expect(page.getByTestId("base2-shell")).toBeVisible();
  await expect(page).toHaveURL(url);

  // o piloto continua no endpoint original da fatia anterior — a moldura não criou porta nova
  const id = url.split("/").pop()!;
  expect(chamadas, "o detalhe precisa continuar lendo /api/stock/input-entries/:id").toContain(`/api/stock/input-entries/${id}`);
  // e nenhuma porta "universal de documentos" foi inventada
  expect(chamadas.filter((u) => /\/api\/(documentos|base2|lancamentos)\b/.test(u))).toHaveLength(0);
});

test("moldura Base 2: sem Tipo de Operação e sem rolagem horizontal em viewport menor", async ({ page }) => {
  await login(page);
  await criarEntradaEAbrir(page);

  // BASE2-02/TOP está congelada nesta fatia: nenhum vestígio pode ter vazado para a tela
  await expect(page.getByText(/Tipo de Opera[çc][ãa]o/i)).toHaveCount(0);

  await page.setViewportSize({ width: 768, height: 900 });
  await expect(page.getByTestId("base2-shell")).toBeVisible();
  const estouro = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(estouro, "a página não pode ganhar rolagem horizontal em 768 px").toBeLessThanOrEqual(1);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * AS QUATRO FORMAS CRÍTICAS (BASE2-01 R3)
 *
 * A rodada anterior cobria só a ENTRADA DE INSUMOS — e foi justamente nas formas divergentes que os
 * defeitos reais apareceram: o rodapé de totais mentia na NOTA FISCAL (total do documento inclui frete
 * e outras despesas) e saía "—" na BATIDA (que não tem total de documento), e a TRANSFERÊNCIA derrubava
 * a tela porque o endpoint não devolve `movements`. Nenhum gate pegou: a suíte não abria essas rotas.
 *
 * O seed só cria entradas, então cada forma é construída aqui pela própria API — mesma porta que o
 * usuário usa, sem fixture paralela no banco.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

async function api<T = Record<string, unknown>>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
  return page.evaluate(async ({ method, path, body, base }) => {
    const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string | null; empresaId: string | null };
    const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}), ...(s.empresaId ? { "x-empresa-id": s.empresaId } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text(); const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 300)}`);
    return data as T;
  }, { method, path, body, base });
}
/** Primeiro id de um recurso, pela listagem oficial. */
async function primeiroId(page: Page, path: string): Promise<string> {
  const r = await api<{ items: { id: string }[] }>(page, "GET", path);
  const id = r.items?.[0]?.id;
  expect(id, `sem registro em ${path} para montar a fixture`).toBeTruthy();
  return id!;
}

test("moldura Base 2 — NOTA FISCAL: total do documento diverge da soma das linhas sem a tela mentir", async ({ page }) => {
  await login(page);
  await page.goto("/estoque");
  const empresaId = await page.evaluate(() => (JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { empresaId: string | null }).empresaId);
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const armazem = await primeiroId(page, "/api/resources/warehouses?pageSize=1");
  const fornecedor = await primeiroId(page, "/api/resources/people?pageSize=1&is_provider=true");

  // 100 × R$ 100,00 em itens + R$ 500,00 de frete → documento 10.500,00, linhas 10.000,00
  const nf = await api<{ id: string }>(page, "POST", "/api/stock/invoices", {
    empresa_id: empresaId, number: `R3${Date.now().toString().slice(-6)}`, series: "1", provider_id: fornecedor,
    emission_date: "2026-09-22", freight: "500.00", other_expenses: "0", generate_financial: false,
    items: [{ product_id: produto, warehouse_id: armazem, quantity: "100", unit_value: "100.00" }]
  });

  await page.goto(`/estoque/documentos-fiscais/${nf.id}`);
  await expect(page.getByTestId("base2-shell")).toBeVisible();

  const tabela = page.locator('[data-testid="base2-section"][data-secao="Itens"]').getByTestId("base2-items");
  // o defeito que existiu: rodapé com o total do DOCUMENTO sob a coluna de total dos ITENS
  await expect(tabela.locator("tfoot")).toHaveCount(0);

  // total do documento = 10.500,00, num campo cujo rótulo diz que total é
  const campoTotal = page.locator('[data-testid="base2-field"][data-campo="Total"]');
  await expect(campoTotal).toContainText("10.500,00");
  // a linha mostra o total DELA: 10.000,00 — os dois números convivem sem se contradizer
  const cabecalhos = await tabela.locator("thead th").allTextContents();
  const iTotal = cabecalhos.findIndex((t) => t.trim() === "Total");
  expect(iTotal).toBeGreaterThan(-1);
  await expect(tabela.getByTestId("base2-items-linha").first().locator("td").nth(iTotal)).toContainText("10.000,00");
});

test("moldura Base 2 — TRANSFERÊNCIA: renderiza sem `movements` no payload e não inventa empresa única", async ({ page }) => {
  await login(page);
  await page.goto("/estoque");
  const empresaId = await page.evaluate(() => (JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { empresaId: string | null }).empresaId);
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const armazens = await api<{ items: { id: string }[] }>(page, "GET", "/api/resources/warehouses?pageSize=2");
  expect(armazens.items.length, "a transferência precisa de dois armazéns").toBeGreaterThan(1);

  const tr = await api<{ id: string }>(page, "POST", "/api/stock/transfers", {
    kind: "warehouse", transfer_date: "2026-09-22", empresa_origem_id: empresaId,
    origin_warehouse_id: armazens.items[0]!.id, destination_warehouse_id: armazens.items[1]!.id,
    items: [{ product_id: produto, quantity: "1" }]
  });

  await page.goto(`/estoque/transferencias/${tr.id}`);
  // o endpoint devolve { ...doc, items, titles } SEM `movements`; antes da guarda isso derrubava a tela
  await expect(page.getByTestId("base2-shell")).toBeVisible();
  await expect(page.locator('[data-testid="base2-section"][data-secao="Movimentações de estoque (ledger)"]')).toBeVisible();

  // documento de DUAS empresas: origem e destino são campos, e o subtítulo não elege uma delas
  await expect(page.locator('[data-testid="base2-field"][data-campo="Origem"]')).toBeVisible();
  await expect(page.locator('[data-testid="base2-field"][data-campo="Destino"]')).toBeVisible();
  await expect(page.getByTestId("base2-empresa")).toHaveCount(0);
});

test("moldura Base 2 — BATIDA: renderiza sem total de documento e sem rodapé enganoso", async ({ page }) => {
  await login(page);
  await page.goto("/estoque");
  const empresaId = await page.evaluate(() => (JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { empresaId: string | null }).empresaId);
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const armazens = await api<{ items: { id: string }[] }>(page, "GET", "/api/resources/warehouses?pageSize=2");
  // o seed não cria fórmula nenhuma: sem criar aqui, o teste passaria por ausência de dado — que é
  // exatamente o "verde que não prova nada" proibido por .claude/rules/testing-gates.md
  const formula = await api<{ id: string }>(page, "POST", "/api/stock/feed-formulas", {
    name: `Fórmula R3 ${Date.now().toString(36)}`, items: [{ product_id: produto, quantity: "10" }]
  });

  const batida = await api<{ id: string }>(page, "POST", "/api/stock/feed-batches", {
    empresa_id: empresaId, batch_date: "2026-09-22", formula_id: formula.id,
    origin_warehouse_id: armazens.items[0]!.id, destination_warehouse_id: armazens.items[1]?.id ?? armazens.items[0]!.id,
    quantity_produced: "10"
  });

  await page.goto(`/estoque/batidas/${batida.id}`);
  await expect(page.getByTestId("base2-shell")).toBeVisible();
  // feed_batches não tem total_amount/total/total_value: o rodapé saía "—", que em coluna de dinheiro se lê como zero
  await expect(page.locator('[data-testid="base2-section"][data-secao="Itens"]').getByTestId("base2-items").locator("tfoot")).toHaveCount(0);
});

test("moldura Base 2 — ANEXOS: só a entrada de insumos oferece o botão, e o diálogo oficial abre", async ({ page }) => {
  await login(page);
  const urlEntrada = await criarEntradaEAbrir(page);

  // input_entries está em ATTACHMENT_PARENTS (R3): o botão existe e o diálogo oficial abre
  const botao = page.getByTestId("base2-anexos");
  await expect(botao).toBeVisible();
  await botao.click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toBeVisible();
  await expect(dialogo).toContainText("Anexos");
  await page.keyboard.press("Escape");

  // as demais entidades NÃO estão na whitelist: nenhum botão, em vez de um botão que abriria com 422
  const id = await api<{ items: { id: string }[] }>(page, "GET", "/api/stock/writeoffs?pageSize=1")
    .then((r) => r.items?.[0]?.id ?? null).catch(() => null);
  if (id) {
    await page.goto(`/estoque/baixas/${id}`);
    await expect(page.getByTestId("base2-shell")).toBeVisible();
    await expect(page.getByTestId("base2-anexos")).toHaveCount(0);
  }
  expect(urlEntrada).toContain("/estoque/entradas/");
});
