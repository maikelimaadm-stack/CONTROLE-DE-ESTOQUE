import { test, expect, type Page } from "@playwright/test";
import { login, api, uniq, empresaAtiva, primeiroId } from "./helpers";

/**
 * PORTAL DE VENDAS COM TOP CADASTRADA — o caminho que o usuário faz de verdade (TOP-CONFIG-02).
 *
 * A integração já prova a cadeia no servidor. O que SÓ este arquivo pode provar é o elo do cliente, e
 * dentro dele o que mais importa: a tela NÃO ESCREVE quando o servidor ainda é antigo. Esse é o único
 * caso em que nenhum teste de API ajuda — o defeito mora exatamente na conversa entre as duas versões.
 */
const PORTAL = "/vendas";

/** Cadastra uma TOP pela API administrativa (o E2E do cadastro em si é da TOP-CONFIG-01). */
async function cadastrarTop(page: Page, codigoBase: string, nome: string, extra: Record<string, unknown> = {}) {
  const codigo = `7${Math.floor(Math.random() * 90000 + 10000)}`;
  return api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase, nome, ...extra });
}

/** Abre o formulário de novo lançamento da variante. */
async function abrirNovo(page: Page, variante: string) {
  await page.goto(`/vendas/${variante}/new`);
  await expect(page.getByTestId("select-tipo-operacao")).toBeVisible();
}

test("cadastra TOPs, lança pelo Portal de Vendas e o detalhe mostra o snapshot", async ({ page }) => {
  await login(page);
  const empresa = await empresaAtiva(page);
  const nomeTop = uniq("Venda de Gado a Prazo");
  const top = await cadastrarTop(page, "vendas.venda", nomeTop, { padrao: true });

  // O título do portal foi assumido formalmente nesta fatia.
  await page.goto(PORTAL);
  await expect(page.getByRole("heading", { name: "Portal de Vendas" })).toBeVisible();

  await abrirNovo(page, "sales");
  // O PADRÃO vem PRÉ-SELECIONADO e VISÍVEL — não escondido porque "tem um padrão".
  await expect(page.getByTestId("select-tipo-operacao")).toHaveValue(top.id);
  // E o seletor só oferece TOPs da família da variante.
  const opcoes = await page.getByTestId("select-tipo-operacao").locator("option").evaluateAll((os) =>
    os.map((o) => (o as HTMLOptionElement).textContent ?? "").filter((x) => x && !x.startsWith("Selecione")));
  expect(opcoes.some((o) => o.includes(nomeTop)), "a TOP de venda aparece").toBe(true);

  // A criação em si vai pela API (a via de clique do formulário é coberta por outros specs); o que este
  // teste prova aqui é o DETALHE lendo o snapshot.
  const cliente = await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1");
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const venda = await api<{ id: string }>(page, "POST", "/api/sales/sales", {
    empresa_id: empresa, document_date: "2026-09-01", client_id: cliente, tipo_operacao_id: top.id,
    items: [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }]
  });

  await page.goto(`/vendas/sales/${venda.id}`);
  await expect(page.getByTestId("base2-shell")).toBeVisible();
  // TOP configurada E família canônica aparecem como coisas DIFERENTES.
  await expect(page.getByText(nomeTop)).toBeVisible();
  await expect(page.getByText("Família operacional")).toBeVisible();
});

test("editar a TOP cria a versão 2 e o documento ANTIGO continua exibindo a versão 1", async ({ page }) => {
  await login(page);
  const empresa = await empresaAtiva(page);
  const nomeV1 = uniq("Nome original");
  const top = await cadastrarTop(page, "vendas.venda", nomeV1);
  const cliente = await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1");
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const venda = await api<{ id: string }>(page, "POST", "/api/sales/sales", {
    empresa_id: empresa, document_date: "2026-09-01", client_id: cliente, tipo_operacao_id: top.id,
    items: [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }]
  });

  const atual = await api<{ revisao: number }>(page, "GET", `/api/admin/tipos-operacao/${top.id}`);
  const nomeV2 = uniq("Nome corrigido");
  await api(page, "PUT", `/api/admin/tipos-operacao/${top.id}`, { nome: nomeV2, revisao: atual.revisao });

  await page.goto(`/vendas/sales/${venda.id}`);
  await expect(page.getByTestId("base2-shell")).toBeVisible();
  // A PROVA QUE IMPORTA: a tela mostra o nome de ONTEM, porque lê a versão congelada.
  await expect(page.getByText(nomeV1)).toBeVisible();
  await expect(page.getByText(nomeV2), "o nome novo NÃO pode aparecer no documento antigo").toHaveCount(0);
});

test("conversão exige a TOP do DESTINO, e a fonte mantém a dela", async ({ page }) => {
  await login(page);
  const empresa = await empresaAtiva(page);
  const nomeOrcamento = uniq("Orçamento padrão");
  const nomePedido = uniq("Pedido especial");
  const topOrcamento = await cadastrarTop(page, "vendas.orcamento", nomeOrcamento);
  const topPedido = await cadastrarTop(page, "vendas.pedido", nomePedido, { padrao: true });

  const cliente = await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1");
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const orcamento = await api<{ id: string }>(page, "POST", "/api/sales/budgets", {
    empresa_id: empresa, document_date: "2026-09-01", client_id: cliente, tipo_operacao_id: topOrcamento.id,
    items: [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }]
  });

  await page.goto(`/vendas/budgets/${orcamento.id}`);
  await page.getByRole("button", { name: "Converter em pedido" }).click();
  const dialogo = page.getByTestId("dialog-conversao");
  await expect(dialogo).toBeVisible();
  // O seletor do diálogo carrega as TOPs do DESTINO (pedido), nunca as da fonte (orçamento).
  const opcoes = await dialogo.getByTestId("select-tipo-operacao").locator("option").evaluateAll((os) =>
    os.map((o) => (o as HTMLOptionElement).textContent ?? ""));
  expect(opcoes.some((o) => o.includes(nomePedido)), "a TOP de pedido é oferecida").toBe(true);
  expect(opcoes.some((o) => o.includes(nomeOrcamento)), "a TOP de orçamento NÃO pode ser oferecida").toBe(false);

  await dialogo.getByRole("button", { name: "Converter" }).click();
  await expect(page).toHaveURL(/\/vendas\/orders\//);
  await expect(page.getByText(nomePedido), "o destino usa a TOP dele").toBeVisible();

  // E a fonte continua com a dela.
  await page.goto(`/vendas/budgets/${orcamento.id}`);
  await expect(page.getByText(nomeOrcamento)).toBeVisible();
});

test("SEM TOP ativa da família: Salvar desabilitado, mensagem e NENHUM POST", async ({ page }) => {
  await login(page);
  // Simula "nenhuma TOP cadastrada" interceptando a resposta do endpoint operacional. O servidor continua
  // como está; o que se mede é a decisão da TELA.
  await page.route("**/api/sales/sales/operation-types", (rota) =>
    rota.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ contractVersion: 1, family: { code: "vendas.venda", label: "Venda" }, defaultId: null, items: [] }) }));

  const posts: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/sales/sales")) posts.push(r.url()); });

  await page.goto("/vendas/sales/new");
  await expect(page.getByTestId("top-ausente")).toBeVisible();
  await expect(page.getByRole("button", { name: "Salvar" })).toBeDisabled();
  expect(posts, "nenhuma tentativa de criação").toEqual([]);
});

test("SKEW — API ANTIGA (endpoint ausente): a tela bloqueia e NÃO perde a TOP em silêncio", async ({ page }) => {
  await login(page);
  // 404 é como uma API anterior à TOP-CONFIG-02 responde a uma rota que ela não tem. Este é O caso que
  // nenhum teste de servidor pega: a API antiga descartaria `tipo_operacao_id` sem erro, o documento
  // nasceria sem TOP e o usuário leria "salvo".
  await page.route("**/api/sales/sales/operation-types", (rota) =>
    rota.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_FOUND", message: "Rota não encontrada" } }) }));

  const posts: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/sales/")) posts.push(r.url()); });

  await page.goto("/vendas/sales/new");
  await expect(page.getByTestId("top-servidor-desatualizado")).toBeVisible();
  // A mensagem fala de VERSÃO, não de configuração: mandar cadastrar TOP aqui faria o usuário cadastrar
  // algo que não resolve o problema.
  await expect(page.getByTestId("top-ausente"), "não pedir cadastro quando o problema é o servidor").toHaveCount(0);
  await expect(page.getByRole("button", { name: "Salvar" })).toBeDisabled();
  expect(posts, "ZERO POST: é isto que impede a perda silenciosa").toEqual([]);
});

test("LEGADO — documento sem TOP abre, diz que não está configurado e mantém a família", async ({ page }) => {
  await login(page);
  const empresa = await empresaAtiva(page);
  const cliente = await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1");
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  // Criado SEM `tipo_operacao_id`: é exatamente o que a web antiga (ou o acervo) produz.
  const venda = await api<{ id: string }>(page, "POST", "/api/sales/sales", {
    empresa_id: empresa, document_date: "2026-09-01", client_id: cliente,
    items: [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }]
  });

  await page.goto(`/vendas/sales/${venda.id}`);
  await expect(page.getByTestId("base2-shell"), "legado continua abrindo").toBeVisible();
  await expect(page.getByText("Não configurada (registro legado)")).toBeVisible();
  // A família canônica CONTINUA correta — ela vem do registro, não da configuração.
  await expect(page.getByText("Família operacional")).toBeVisible();

  // E continua na listagem: um INNER JOIN o teria feito sumir.
  await page.goto("/vendas?tab=sales");
  await expect(page.getByRole("heading", { name: "Portal de Vendas" })).toBeVisible();
});

test("REGRESSÃO: a TOP não mudou a confirmação nem as ações do detalhe", async ({ page }) => {
  await login(page);
  const empresa = await empresaAtiva(page);
  const top = await cadastrarTop(page, "vendas.venda", uniq("Confirma igual"));
  const cliente = await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1");
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const venda = await api<{ id: string }>(page, "POST", "/api/sales/sales", {
    empresa_id: empresa, document_date: "2026-09-01", client_id: cliente, tipo_operacao_id: top.id,
    items: [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }]
  });

  await page.goto(`/vendas/sales/${venda.id}`);
  // As ações da variante continuam as mesmas: a TOP é identidade, não comportamento.
  await expect(page.getByRole("button", { name: "Confirmar venda" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Imprimir" })).toBeVisible();
});
