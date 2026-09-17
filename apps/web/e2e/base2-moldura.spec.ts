import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";
import { ptBR } from "@erp/plataforma";

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

test("moldura Base 2: identidade da operação presente e sem rolagem horizontal em viewport menor", async ({ page }) => {
  await login(page);
  await criarEntradaEAbrir(page);

  // Até a BASE2-01 este teste exigia a AUSÊNCIA de "Tipo de Operação", porque a TOP estava congelada.
  // A BASE2-02 a implementou: a asserção vira o seu oposto exato, e o campo passa a ser identidade
  // obrigatória da tela — com o rótulo e o valor vindos do catálogo, nunca de literal na tela.
  const campoTop = page.locator(CAMPO_TOP);
  await expect(campoTop, "a entrada de insumos precisa exibir a sua operação").toBeVisible();
  await expect(campoTop).toContainText("Entrada manual de estoque");

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
/**
 * Empresa efetiva para criar lançamento, pela MESMA regra do app (`useEmpresaPadrao`, features/docs/shared):
 * a empresa da sessão, ou a primeira do contexto. No harness a sessão começa em "Todas as empresas", e
 * `session.empresaId` é `null` — foi isso que reprovou a primeira versão destes testes com 422.
 */
async function empresaAtiva(page: Page): Promise<string> {
  const daSessao = await page.evaluate(() => (JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { empresaId: string | null }).empresaId);
  if (daSessao) return daSessao;
  const ctx = await api<{ empresas?: { id: string }[] }>(page, "GET", "/api/auth/context");
  const id = ctx.empresas?.[0]?.id;
  expect(id, "o contexto precisa expor ao menos uma empresa visível").toBeTruthy();
  return id!;
}

/** Primeiro id de um recurso, pela listagem oficial. */
async function primeiroId(page: Page, path: string): Promise<string> {
  const r = await api<{ items: { id: string }[] }>(page, "GET", path);
  const id = r.items?.[0]?.id;
  expect(id, `sem registro em ${path} para montar a fixture`).toBeTruthy();
  return id!;
}

/**
 * Armazéns DA EMPRESA informada. `warehouses` é empresa-scoped: pegar os dois primeiros da listagem
 * geral mistura empresas, e o servidor recusa com WAREHOUSE_FARM_MISMATCH (422) — foi o que reprovou a
 * primeira versão da fixture de transferência.
 */
async function armazensDaEmpresa(page: Page, empresaId: string, minimo: number): Promise<string[]> {
  const r = await api<{ items: { id: string; empresa_id?: string }[] }>(page, "GET", "/api/resources/warehouses?pageSize=100");
  const ids = (r.items ?? []).filter((w) => w.empresa_id === empresaId).map((w) => w.id);
  expect(ids.length, `a empresa precisa de ao menos ${minimo} armazém(ns) para esta fixture`).toBeGreaterThanOrEqual(minimo);
  return ids;
}

test("moldura Base 2 — NOTA FISCAL: total do documento diverge da soma das linhas sem a tela mentir", async ({ page }) => {
  await login(page);
  await page.goto("/estoque");
  const empresaId = await empresaAtiva(page);
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const armazem = (await armazensDaEmpresa(page, empresaId, 1))[0]!;
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
  const empresaId = await empresaAtiva(page);
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const armazens = await armazensDaEmpresa(page, empresaId, 2);

  const tr = await api<{ id: string }>(page, "POST", "/api/stock/transfers", {
    kind: "warehouse", transfer_date: "2026-09-22", empresa_origem_id: empresaId,
    origin_warehouse_id: armazens[0]!, destination_warehouse_id: armazens[1]!,
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
  const empresaId = await empresaAtiva(page);
  const produtos = await api<{ items: { id: string }[] }>(page, "GET", "/api/resources/products?pageSize=2");
  const insumo = produtos.items[0]!.id;
  // o produto ACABADO é obrigatório na formulação (`stock.ts`: "Formulação sem produto acabado vinculado")
  // e precisa ser diferente do insumo, senão a batida consome e produz a mesma linha de estoque
  const acabado = produtos.items[1]?.id ?? insumo;
  const armazens = await armazensDaEmpresa(page, empresaId, 1);
  const origem = armazens[0]!; const destino = armazens[1] ?? armazens[0]!;
  // o seed não cria fórmula nenhuma: sem criar aqui, o teste passaria por ausência de dado — que é
  // exatamente o "verde que não prova nada" proibido por .claude/rules/testing-gates.md
  const formula = await api<{ id: string }>(page, "POST", "/api/stock/feed-formulas", {
    name: `Fórmula R3 ${Date.now().toString(36)}`, product_id: acabado, items: [{ product_id: insumo, quantity: "10" }]
  });
  // saldo para a batida consumir: a produção dá baixa no armazém de origem
  await api(page, "POST", "/api/stock/input-entries", {
    empresa_id: empresaId, entry_date: "2026-09-22",
    items: [{ product_id: insumo, warehouse_id: origem, quantity: "50", unit_value: "2.00", generate_stock: true }]
  });

  const batida = await api<{ id: string }>(page, "POST", "/api/stock/feed-batches", {
    empresa_id: empresaId, batch_date: "2026-09-22", formula_id: formula.id,
    origin_warehouse_id: origem, destination_warehouse_id: destino,
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

  // ANEXAR DE VERDADE. Abrir o diálogo não prova nada do servidor: com `input_entries` fora da whitelist
  // o `GET /api/attachments` devolve 422, o react-query fica sem dados e a tabela mostra "Nenhum arquivo
  // anexado." — sem toast, sem erro visível. O único fato que distingue whitelist ligada de desligada é
  // um anexo que sobe (201) e volta na listagem (200).
  await dialogo.getByLabel("Nome do anexo").fill("Conferência da entrada");
  await dialogo.locator('input[aria-label="Selecionar arquivos"]').setInputFiles({
    name: "conferencia.txt", mimeType: "text/plain", buffer: Buffer.from("nota de conferencia da entrada")
  });
  const linha = dialogo.getByTestId("b1-attachment");
  await expect(linha, "sem `input_entries` em ATTACHMENT_PARENTS o envio falha e a lista fica vazia").toHaveCount(1);
  await expect(linha).toContainText("conferencia.txt");
  await page.keyboard.press("Escape");

  expect(urlEntrada).toContain("/estoque/entradas/");

  // as demais entidades NÃO estão na whitelist: nenhum botão, em vez de um botão que abriria com 422.
  // A nota fiscal é CRIADA aqui de propósito: depender de "se houver registro no seed" deixaria esta
  // metade do teste condicional, e um teste que pode não rodar não prova nada.
  const empresaId = await empresaAtiva(page);
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const armazem = (await armazensDaEmpresa(page, empresaId, 1))[0]!;
  const fornecedor = await primeiroId(page, "/api/resources/people?pageSize=1&is_provider=true");
  const nf = await api<{ id: string }>(page, "POST", "/api/stock/invoices", {
    empresa_id: empresaId, number: `AX${Date.now().toString().slice(-6)}`, series: "1", provider_id: fornecedor,
    emission_date: "2026-09-22", generate_financial: false,
    items: [{ product_id: produto, warehouse_id: armazem, quantity: "1", unit_value: "1.00" }]
  });
  await page.goto(`/estoque/documentos-fiscais/${nf.id}`);
  await expect(page.getByTestId("base2-shell")).toBeVisible();
  await expect(page.getByTestId("base2-anexos"), "invoices não está em ATTACHMENT_PARENTS: sem botão").toHaveCount(0);
  // e o histórico, que não depende de whitelist, continua lá — prova que a ausência acima é da whitelist
  await expect(page.getByTestId("base2-historico")).toBeVisible();
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * TIPO DE OPERAÇÃO — AS SETE ROTAS DO PILOTO (BASE2-02)
 *
 * A BASE2-02 classifica; ela não executa. Este teste prova as duas metades:
 *  (a) cada uma das sete rotas exibe a SUA operação, com o rótulo do catálogo — e a transferência prova
 *      a variante, porque `kind` decide entre duas operações na MESMA tabela e na MESMA rota;
 *  (b) nada mais mudou: o deep link continua o mesmo, o endpoint chamado continua o original, e não
 *      existe porta nova de TOP (`/api/top`, `/api/tipos-operacao`, `/api/base2`).
 *
 * As fixtures são criadas pela própria API, como o usuário faria. Requisição, baixa e transferência
 * CONSOMEM estoque, então uma entrada farta é semeada antes — sem saldo elas falhariam por motivo que
 * nada tem a ver com a TOP, e um teste que falha pelo motivo errado não prova o que diz provar.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Rótulos e seletor DERIVADOS do catálogo oficial, nunca copiados.
 *
 * Copiar o texto criaria um segundo lugar com o mesmo rótulo, e — pior — usar o rótulo TRADUZIDO como
 * seletor (`data-campo` é o `label` do campo) faz uma renomeação de copy falhar como "o campo sumiu da
 * tela". Lendo do catálogo, renomear o rótulo move teste e tela juntos; o que o teste continua provando
 * é que a tela mostra o rótulo daquela operação, que é o ponto.
 */
const rotuloTop = (codigo: string) => {
  const r = ptBR.mensagens[`top.${codigo}`];
  if (!r) throw new Error(`catálogo sem rótulo para top.${codigo}`);
  return r;
};
const CAMPO_TOP = `[data-testid="base2-field"][data-campo="${ptBR.mensagens["termos.tipo_operacao"]}"]`;

const OPERACAO = {
  entrada: rotuloTop("estoque.entrada_manual"),
  notaFiscal: rotuloTop("estoque.documento_fiscal"),
  requisicao: rotuloTop("estoque.requisicao"),
  baixa: rotuloTop("estoque.baixa"),
  devolucao: rotuloTop("estoque.devolucao"),
  transferenciaArmazens: rotuloTop("estoque.transferencia_entre_armazens"),
  transferenciaEmpresas: rotuloTop("estoque.transferencia_entre_empresas"),
  batida: rotuloTop("estoque.producao_de_racao")
} as const;

/** Abre a rota e confere QUAL operação a tela afirma ser. Falha se o campo não existir. */
async function conferirOperacao(page: Page, url: string, esperado: string) {
  await page.goto(url);
  await expect(page.getByTestId("base2-shell"), `${url}: a tela precisa abrir`).toBeVisible();
  const campo = page.locator(CAMPO_TOP);
  await expect(campo, `${url}: sem o campo de Tipo de operação`).toBeVisible();
  await expect(campo, `${url}: operação errada`).toContainText(esperado);
}

test("moldura Base 2 — TIPO DE OPERAÇÃO: as sete rotas do piloto, cada uma com a sua operação", async ({ page }) => {
  await login(page);
  await page.goto("/estoque");
  const empresaId = await empresaAtiva(page);
  const armazens = await armazensDaEmpresa(page, empresaId, 1);
  const origem = armazens[0]!; const destino = armazens[1] ?? armazens[0]!;
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const fornecedor = await primeiroId(page, "/api/resources/people?pageSize=1&is_provider=true");

  // saldo para o que consome (requisição, baixa, transferência)
  const entrada = await api<{ id: string }>(page, "POST", "/api/stock/input-entries", {
    empresa_id: empresaId, entry_date: "2026-09-22",
    items: [{ product_id: produto, warehouse_id: origem, quantity: "200", unit_value: "3.00", generate_stock: true }]
  });

  const nf = await api<{ id: string }>(page, "POST", "/api/stock/invoices", {
    empresa_id: empresaId, number: `TOP${Date.now().toString().slice(-6)}`, series: "1", provider_id: fornecedor,
    emission_date: "2026-09-22", generate_financial: false,
    items: [{ product_id: produto, warehouse_id: origem, quantity: "1", unit_value: "1.00" }]
  });

  const requisicao = await api<{ id: string }>(page, "POST", "/api/stock/requisitions", {
    empresa_id: empresaId, requisition_date: "2026-09-22",
    items: [{ warehouse_id: origem, product_id: produto, quantity: "1" }]
  });

  const baixa = await api<{ id: string }>(page, "POST", "/api/stock/writeoffs", {
    empresa_id: empresaId, writeoff_date: "2026-09-22", warehouse_id: origem,
    reason: "loss", justification: "Perda registrada pelo teste de contrato da BASE2-02",
    items: [{ product_id: produto, quantity: "1" }]
  });

  const devolucao = await api<{ id: string }>(page, "POST", "/api/stock/devolutions", {
    empresa_id: empresaId, devolution_date: "2026-09-22",
    items: [{ warehouse_id: origem, product_id: produto, quantity: "1", unit_value: "3.00" }]
  });

  const transferencia = await api<{ id: string }>(page, "POST", "/api/stock/transfers", {
    kind: "warehouse", transfer_date: "2026-09-22", empresa_origem_id: empresaId,
    origin_warehouse_id: origem, destination_warehouse_id: destino,
    items: [{ product_id: produto, quantity: "1" }]
  });

  const produtos = await api<{ items: { id: string }[] }>(page, "GET", "/api/resources/products?pageSize=2");
  const acabado = produtos.items[1]?.id ?? produto;
  const formula = await api<{ id: string }>(page, "POST", "/api/stock/feed-formulas", {
    name: `Fórmula TOP ${Date.now().toString(36)}`, product_id: acabado, items: [{ product_id: produto, quantity: "10" }]
  });
  const batida = await api<{ id: string }>(page, "POST", "/api/stock/feed-batches", {
    empresa_id: empresaId, batch_date: "2026-09-22", formula_id: formula.id,
    origin_warehouse_id: origem, destination_warehouse_id: destino, quantity_produced: "10"
  });

  // as sete rotas, uma a uma, pela rota canônica de sempre
  await conferirOperacao(page, `/estoque/entradas/${entrada.id}`, OPERACAO.entrada);
  await conferirOperacao(page, `/estoque/documentos-fiscais/${nf.id}`, OPERACAO.notaFiscal);
  await conferirOperacao(page, `/estoque/requisicoes/${requisicao.id}`, OPERACAO.requisicao);
  await conferirOperacao(page, `/estoque/baixas/${baixa.id}`, OPERACAO.baixa);
  await conferirOperacao(page, `/estoque/devolucoes/${devolucao.id}`, OPERACAO.devolucao);
  await conferirOperacao(page, `/estoque/transferencias/${transferencia.id}`, OPERACAO.transferenciaArmazens);
  await conferirOperacao(page, `/estoque/batidas/${batida.id}`, OPERACAO.batida);

  // A VARIANTE, e por que o outro lado NÃO é provado aqui.
  //
  // `erp.warehouse_transfers` é o caso que sustenta o eixo próprio da TOP: UMA tabela, UMA rota de
  // detalhe, UM título de tela, e DUAS operações (`kind in ('warehouse','farm')`). A asserção acima já
  // é POSITIVA para a variante `warehouse` — a tela AFIRMA "Transferência entre armazéns", não apenas
  // deixa de afirmar a outra (uma asserção só negativa passaria até com o campo ausente).
  //
  // A variante `farm` não é criada por este teste. Existe um DEFEITO EXTERNO, anterior à BASE2-02, no
  // caminho de escrita (numeração de `warehouse_transfers` por dois contadores independentes para uma
  // coluna de código única), documentado em docs/TIPO-OPERACAO-CONTRACT.md e em docs/DECISIONS.md.
  // Esse defeito NÃO é comportamento esperado e NÃO é exigido por nenhum teste: uma suíte que exigisse
  // a recusa transformaria um bug em contrato, e o dia da correção chegaria como "teste quebrado" em
  // vez de "teste que passou a poder ser escrito". A cobertura da variante `farm` mora no teste de
  // contrato do registry (`kind:"farm"` → `estoque.transferencia_entre_empresas`), que não depende do
  // caminho de escrita, e a prova de UI entra na PR do hotfix de numeração.
  //
  // O que AINDA se prova aqui sem o segundo documento: o título da tela não carrega variante nenhuma.
  // Ele é o literal "Transferência" (app/(app)/estoque/transferencias/[id]/page.tsx), idêntico nos dois
  // casos. Logo a operação exibida NÃO pode ter vindo do título — que é o ponto da separação entre
  // variante de ROTA e variante de OPERAÇÃO.
  await page.goto(`/estoque/transferencias/${transferencia.id}`);
  await expect(page.locator(CAMPO_TOP), "o documento entre armazéns afirma a SUA operação").toContainText(OPERACAO.transferenciaArmazens);
  const titulo = (await page.getByRole("heading", { level: 1 }).first().textContent()) ?? "";
  expect(titulo, "o título precisa ter sido lido").not.toBe("");
  for (const rotulo of [OPERACAO.transferenciaArmazens, OPERACAO.transferenciaEmpresas]) {
    expect(titulo, `o título da tela não pode conter a operação ("${rotulo}") — senão a TOP seria derivável dele`).not.toContain(rotulo);
  }
});

test("moldura Base 2 — TIPO DE OPERAÇÃO: classifica sem executar (mesma rota, mesmo endpoint, nenhuma porta nova)", async ({ page }) => {
  await login(page);

  // Tudo o que a tela pede ao servidor, do login em diante. A TOP é resolvida no cliente, a partir de
  // um registry estático: se alguma porta de TOP tivesse nascido, ela apareceria aqui.
  const chamadas: string[] = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) chamadas.push(u.pathname); });

  const url = await criarEntradaEAbrir(page);
  await expect(page.locator(CAMPO_TOP)).toBeVisible();

  expect(chamadas.length, "o teste precisa ter observado requisições").toBeGreaterThan(0);
  for (const proibida of ["/api/top", "/api/tipos-operacao", "/api/tipo-operacao", "/api/base2"]) {
    expect(chamadas.some((c) => c.startsWith(proibida)), `nasceu uma porta de TOP: ${proibida}`).toBe(false);
  }
  // O endpoint do documento continua sendo o original do módulo.
  expect(chamadas.some((c) => c.startsWith("/api/stock/input-entries")), "a tela precisa continuar lendo o endpoint de sempre").toBe(true);

  // Deep link inalterado: a rota canônica é a mesma de antes da TOP, e recarregar reabre a mesma tela.
  expect(url).toMatch(/\/estoque\/entradas\/[0-9a-f-]{36}$/);
  await page.reload();
  await expect(page.locator(CAMPO_TOP)).toBeVisible();

  // E a TOP não inventou ação: a barra de ações continua com o que o módulo já oferecia.
  await expect(page.getByRole("button", { name: /Tipo de opera/i }), "a TOP não é um botão").toHaveCount(0);
});
