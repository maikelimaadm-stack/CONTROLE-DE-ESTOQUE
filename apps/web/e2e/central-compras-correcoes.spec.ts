import { test, expect, type Locator, type Page, type Response } from "@playwright/test";
import { login, api, uniq, empresaAtiva, abrirLancamentoDeVendas, escolherTopEContinuar } from "./helpers";

/**
 * CENTRAL DE COMPRAS — AS CORREÇÕES DA VISUAL-UX-04b (regressões da VISUAL-UX-04, já em produção) · CX-1 a CX-5.
 *
 * ┌─ O QUE ESTE ARQUIVO PROVA ─────────────────────────────────────────────────────────────────────┐
 * │ CX-1 lançamento da COMPRA: o valor unitário "0" continua "0" depois de escolher produto e       │
 * │      armazém com custo médio > 0 — e o POST leva 0 (a compra FORMA o custo, não o lê).           │
 * │ CX-2 o mesmo no RECEBER pedido: o `/convert` leva 0.                                           │
 * │ CX-3 a VENDA não muda: o unitário vazio continua preenchido pelo custo médio do armazém.         │
 * │ CX-4 saldo de 4 casas: 0,0040 aparece "0,0040" na consulta (e Receber/Encerrar coerentes).       │
 * │ CX-5 "Recebido de pedido" quando o item tem `origem_item_id` (a chave que a leitura devolve).    │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Cada caso cria os PRÓPRIOS dados pela API (fornecedor, armazém, produto, TOPs, pedido, entrada de estoque) e lê de
 * volta a PREMISSA que torna a asserção capaz de falhar — sem ela, "o 0 continua 0" seria verde por vacuidade (sem
 * custo médio no armazém, nada teria o que escrever). Os dados de referência do seed (unidade, grupo, natureza e centro)
 * são escolhidos pelo NOME, nunca pela posição na lista. O que vai no fio é lido no fio (`waitForResponse` +
 * `postDataJSON`), e o servidor confere o que gravou.
 */

const P = "central-compras";
type Opcao = { id: string; label: string };
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
/** Código de TOP único por execução (tempo + sorteio), como nos specs do desenho: nada de 5 dígitos que colidem. */
const codigoTop = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const caminho = (r: Response) => new URL(r.url()).pathname;

/* ═════════════════════════════════════════════ fixtures ═════════════════════════════════════════════ */

/** Um item de referência do seed pelo NOME (a premissa diz qual faltou). */
async function doSeed(page: Page, rota: string, nome: string): Promise<Opcao> {
  const opcoes = await api<Opcao[]>(page, "GET", rota);
  const achada = opcoes.find((o) => o.label.includes(nome));
  expect(achada, `premissa: o seed tem "${nome}" em ${rota}`).toBeTruthy();
  return achada!;
}

async function cenario(page: Page) {
  const empresa = await empresaAtiva(page);
  const un = (await api<Opcao[]>(page, "GET", "/api/resources/measurement_units/options")).find((u) => u.label.toUpperCase() === "UN");
  expect(un, "premissa: o seed tem a unidade UN").toBeTruthy();
  const grupo = await doSeed(page, "/api/resources/product_groups/options?kind=analytic", "Fertilizantes");
  const natureza = await doSeed(page, "/api/resources/financial_categories/options?kind=analytic&nature=expense", "Nutrição Animal");
  const centro = await doSeed(page, "/api/resources/cost_centers/options?kind=analytic", "Adm Geral");

  const forn = await api<{ id: string }>(page, "POST", "/api/resources/people", { name: uniq("CX forn"), person_type: "legal", is_provider: true });
  const fornecedor = { id: forn.id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${forn.id}`))["name"]) };
  const arm = await api<{ id: string }>(page, "POST", "/api/resources/warehouses", {
    empresa_id: empresa, initials: `X${Date.now().toString(36).slice(-4).toUpperCase()}`, description: uniq("CX arm"), type: "inputs"
  });
  const armazem = { id: arm.id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${arm.id}`))["description"]) };
  const prod = await api<{ id: string }>(page, "POST", "/api/resources/products", { description: uniq("CX prod"), group_id: grupo.id, measurement_id: un!.id, financial_category_id: natureza.id });
  const produto = { id: prod.id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${prod.id}`))["description"]) };

  const topCompra = { codigo: codigoTop("7"), id: "" };
  topCompra.id = (await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo: topCompra.codigo, codigoBase: "compras.compra", nome: uniq("Compra CX") })).id;
  const topPedido = { codigo: codigoTop("5"), id: "" };
  topPedido.id = (await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", {
    codigo: topPedido.codigo, codigoBase: "compras.pedido", nome: uniq("Pedido CX"), destinos: [{ tipoOperacaoId: topCompra.id, ordem: 0, emPartes: true }]
  })).id;
  const regras = await api<{ exigeArmazem: boolean }>(page, "GET", `/api/compras/compras/regras-da-operacao?tipo_operacao_id=${topCompra.id}`);
  expect(regras.exigeArmazem, "premissa: a TOP de compra desta execução não força a coluna de armazém").toBe(false);
  return { empresa, natureza, centro, fornecedor, armazem, produto, topCompra, topPedido };
}
type Cenario = Awaited<ReturnType<typeof cenario>>;

/**
 * PREMISSA DO CX-1/2/3: o produto tem custo médio > 0 NESTE armazém — uma entrada de estoque com valor (a mesma porta
 * do W29 da venda), lida de volta pela MESMA leitura que a célula de estoque da grade usa.
 */
async function custoMedioNoArmazem(page: Page, c: Cenario): Promise<string> {
  await api(page, "POST", "/api/stock/input-entries", {
    empresa_id: c.empresa, entry_date: "2026-09-10", note: "CX custo médio",
    items: [{ product_id: c.produto.id, quantity: "5", unit_value: "7.50", generate_stock: true, warehouse_id: c.armazem.id }]
  });
  const saldo = await api<{ quantity: string; averageCost: string }>(page, "GET", `/api/stock/balances/${c.armazem.id}/${c.produto.id}`);
  expect(Number(saldo.averageCost), "PREMISSA: o custo médio do produto neste armazém é > 0").toBeGreaterThan(0);
  return saldo.averageCost;
}

/** Um pedido aberto com UM item do produto do cenário, sem armazém (quem recebe informa onde entrou). */
async function pedidoAberto(page: Page, c: Cenario, quantidade: string, valor: string) {
  const { id } = await api<{ id: string }>(page, "POST", "/api/compras/pedidos", {
    empresa_id: c.empresa, tipo_operacao_id: c.topPedido.id, fornecedor_id: c.fornecedor.id, data_documento: "2026-09-01",
    categoria_financeira_id: c.natureza.id, centro_custo_id: c.centro.id,
    itens: [{ produto_id: c.produto.id, quantidade, valor_unitario: valor }]
  });
  const lido = await api<{ codigo: string; itens: { id: string; produto_id: string }[] }>(page, "GET", `/api/compras/pedidos/${id}`);
  expect(lido.itens.map((i) => i.produto_id), "premissa: o pedido tem o item").toEqual([c.produto.id]);
  return { id, codigo: lido.codigo, itemId: lido.itens[0]!.id };
}

/** Recebe pela API (a mesma porta do Salvar no modo receber) e devolve a compra gerada. */
async function receberPelaApi(page: Page, c: Cenario, pedido: { id: string; itemId: string }, quantidade: string) {
  const { id } = await api<{ id: string }>(page, "POST", `/api/compras/pedidos/${pedido.id}/convert`, {
    tipo_operacao_id: c.topCompra.id, data_documento: "2026-09-02", categoria_financeira_id: c.natureza.id, centro_custo_id: c.centro.id,
    itens: [{ item_origem_id: pedido.itemId, armazem_id: c.armazem.id, quantidade, valor_unitario: "1.00" }]
  });
  return id;
}

/* ═════════════════════════════════════════════ tela ═════════════════════════════════════════════ */

/** RefSelect da Central pelo rótulo do campo (nome escapado). */
async function escolher(page: Page, rotulo: string, nome: string) {
  const campo = page.getByTestId("compras-central").locator("label", { hasText: rotulo }).first().locator("..");
  await campo.locator("button").first().click();
  const painel = page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nome.slice(0, 20));
  await painel.getByRole("option", { name: literal(nome.slice(0, 20)) }).first().click();
}

/** Pesquisa do motor ancorada à célula (produto ou armazém) da linha. */
async function escolherNaCelula(page: Page, prefixo: string, celula: Locator, nome: string) {
  await celula.click();
  const pesquisa = page.getByTestId(`${prefixo}-pesquisa`);
  await expect(pesquisa).toBeVisible();
  await pesquisa.getByRole("combobox").fill(nome);
  await pesquisa.getByRole("option").filter({ hasText: nome }).first().click();
  await expect(pesquisa).toHaveCount(0);
}

/** Marca a linha pelo círculo (os campos editáveis moram na linha MARCADA), sem desmarcar se já estiver. */
async function marcar(linha: Locator) {
  const circulo = linha.getByTestId(`${P}-selecionar-item`);
  if ((await circulo.getAttribute("aria-checked")) !== "true") await circulo.click();
  await expect(circulo).toHaveAttribute("aria-checked", "true");
}

/**
 * O saldo do par chegou à LINHA: a leitura de `/api/stock/balances/<armazém>/<produto>` respondeu com o custo médio
 * da premissa, e a célula de estoque montada fora da vista o desenhou ("custo médio R$ …"). Depois disto o efeito que
 * escreveria o custo no unitário JÁ teve a chance de rodar — é o que dá dente ao "continua 0".
 */
async function saldoChegouALinha(page: Page, escopo: Locator, leitura: Promise<Response>, custo: string) {
  const r = await leitura;
  expect(Number(((await r.json()) as { averageCost: string }).averageCost), "PREMISSA: a tela leu o custo médio > 0 deste par").toBe(Number(custo));
  const reais = Number(custo).toFixed(2).replace(".", ",");
  await expect(escopo.locator("[hidden] span[title^='custo médio']").first(), "PREMISSA: a célula de estoque da linha desenhou o custo médio")
    .toHaveAttribute("title", new RegExp(`^custo médio R\\$\\s${reais}$`));
}

const leituraDoSaldo = (page: Page, c: Cenario) =>
  page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === `/api/stock/balances/${c.armazem.id}/${c.produto.id}` && r.ok());

/* ═════════════════════════════════════════════ CX-1 ═════════════════════════════════════════════ */

test("CX-1 — lançamento da COMPRA: o valor unitário '0' continua '0' depois de escolher produto e armazém com custo médio > 0; o POST leva 0", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const custo = await custoMedioNoArmazem(page, c);

  await page.goto(`/compras/compras/new?tipo_operacao_id=${c.topCompra.id}`);
  await expect(page.getByTestId("compras-central")).toHaveAttribute("data-especie", "compra");
  await escolher(page, "Fornecedor", c.fornecedor.nome);
  await escolher(page, "Natureza de despesa", c.natureza.label);
  await escolher(page, "Centro de resultado", c.centro.label);
  await page.getByTestId(`${P}-adicionar-item`).click();
  const linha = page.getByTestId(`${P}-linha`).first();
  const unitario = linha.getByLabel("Valor unitário do item 1");
  await unitario.fill("0");
  await escolherNaCelula(page, P, linha.getByTestId(`${P}-produto`), c.produto.nome);
  const leitura = leituraDoSaldo(page, c);
  await escolherNaCelula(page, P, linha.getByTestId(`${P}-armazem`), c.armazem.nome);
  await saldoChegouALinha(page, page.getByTestId("compras-itens"), leitura, custo);
  await expect(unitario, "o '0' digitado continua '0' — o custo médio do armazém não é o preço do fornecedor").toHaveValue("0");
  await linha.getByLabel("Quantidade do item 1").fill("3");

  // NO FIO: o corpo do POST leva o 0
  const post = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === "/api/compras/compras");
  await page.getByTestId("compras-salvar").click();
  const resposta = await post;
  expect(resposta.status(), "o lançamento foi aceito").toBe(201);
  const corpo = resposta.request().postDataJSON() as { itens: Record<string, unknown>[] };
  expect(corpo.itens, "um item").toHaveLength(1);
  expect(corpo.itens[0], "o POST leva o valor unitário 0, com o produto e o armazém escolhidos").toMatchObject({ produto_id: c.produto.id, armazem_id: c.armazem.id, valor_unitario: "0" });
  expect(Number(corpo.itens[0]!["quantidade"])).toBe(3);

  // NO SERVIDOR: a compra foi gravada com 0
  await expect(page).toHaveURL(/\/compras\/compras\/[0-9a-f-]{36}$/);
  const id = /\/compras\/compras\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
  const gravada = await api<{ itens: { valor_unitario: string }[] }>(page, "GET", `/api/compras/compras/${id}`);
  expect(gravada.itens.map((i) => Number(i.valor_unitario)), "o servidor gravou 0").toEqual([0]);
});

/* ═════════════════════════════════════════════ CX-2 ═════════════════════════════════════════════ */

test("CX-2 — RECEBER pedido: o valor unitário '0' continua '0' depois de escolher o armazém com custo médio > 0; o /convert leva 0", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const custo = await custoMedioNoArmazem(page, c);
  const pedido = await pedidoAberto(page, c, "10", "20.00");

  await page.goto(`/compras/pedidos/${pedido.id}`);
  await expect(page.getByTestId("compras-proximos-passos")).toHaveAttribute("data-situacao", "pronto");
  await page.getByTestId(`compras-proximo-passo-${c.topCompra.codigo}`).click();
  await expect(page.getByTestId("compras-central")).toHaveAttribute("data-modo", "receber");
  await expect(page.getByTestId("compras-central-receber")).toHaveAttribute("data-situacao", "pronto");

  const linha = page.getByTestId(`compras-receber-item-${pedido.itemId}`);
  await marcar(linha);
  const unitario = linha.getByLabel("Valor unitário do item 1");
  await expect(unitario, "premissa: o unitário vem do pedido").toHaveValue(/^20/);
  await unitario.fill("0");
  await linha.getByLabel("Quantidade do item 1").fill("4");
  const leitura = leituraDoSaldo(page, c);
  await escolherNaCelula(page, P, linha.getByTestId(`${P}-armazem`), c.armazem.nome);
  await saldoChegouALinha(page, page.getByTestId("compras-itens"), leitura, custo);
  await expect(unitario, "o '0' digitado continua '0' no receber").toHaveValue("0");

  // NO FIO: o corpo do /convert leva o 0
  const convert = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/compras/pedidos/${pedido.id}/convert`);
  await page.getByTestId("compras-salvar").click();
  const resposta = await convert;
  expect(resposta.status(), "o recebimento foi aceito").toBe(201);
  const corpo = resposta.request().postDataJSON() as { itens: Record<string, unknown>[] };
  expect(corpo.itens, "um item").toHaveLength(1);
  expect(corpo.itens[0], "o /convert leva o valor unitário 0, com o item do pedido e o armazém escolhido").toMatchObject({ item_origem_id: pedido.itemId, armazem_id: c.armazem.id, valor_unitario: "0" });

  await expect(page).toHaveURL(/\/compras\/compras\/[0-9a-f-]{36}$/);
  const id = /\/compras\/compras\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
  const gerada = await api<{ itens: { origem_item_id: string; valor_unitario: string }[] }>(page, "GET", `/api/compras/compras/${id}`);
  expect(gerada.itens.map((i) => [i.origem_item_id, Number(i.valor_unitario)]), "o servidor gravou 0 no item recebido").toEqual([[pedido.itemId, 0]]);
});

/* ═════════════════════════════════════════════ CX-3 ═════════════════════════════════════════════ */

test("CX-3 — a VENDA não muda: na Central de Vendas o unitário vazio continua preenchido pelo custo médio do armazém", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const custo = await custoMedioNoArmazem(page, c);
  const topVenda = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo: codigoTop("8"), codigoBase: "vendas.venda", nome: uniq("Venda CX") });

  await abrirLancamentoDeVendas(page, "sales");
  await escolherTopEContinuar(page, topVenda.id);
  await expect(page.getByTestId("central-vendas")).toBeVisible();
  await page.getByTestId("central-vendas-adicionar-item").click();
  const linha = page.getByTestId("central-vendas-linha").first();
  const unitario = linha.getByLabel("Valor unitário do item 1");
  await escolherNaCelula(page, "central-vendas", linha.getByTestId("central-vendas-produto"), c.produto.nome);
  await expect(unitario, "premissa: sem armazém não há saldo, e o unitário segue vazio (0)").toHaveValue("0");
  const leitura = leituraDoSaldo(page, c);
  await escolherNaCelula(page, "central-vendas", linha.getByTestId("central-vendas-armazem"), c.armazem.nome);
  await saldoChegouALinha(page, page.getByTestId("central-vendas"), leitura, custo);
  // O PREENCHIMENTO ACONTECE: o unitário vazio vira o custo médio do armazém (o comportamento de antes, na venda)
  await expect.poll(async () => Number(await unitario.inputValue()), { message: "o unitário vazio da venda é preenchido pelo custo médio" }).toBe(Number(custo));
});

/* ═════════════════════════════════════════════ CX-4 ═════════════════════════════════════════════ */

test("CX-4 — saldo de 4 casas: 0,0040 aparece '0,0040' na consulta do pedido (e a quantidade da compra em 4 casas); Receber e Encerrar saldo coerentes com ele", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const pedido = await pedidoAberto(page, c, "2.0040", "1.00");
  const compraId = await receberPelaApi(page, c, pedido, "2");
  const srv = await api<{ situacao: string; itens: { id: string; quantidade: string; recebido: string; saldo: string }[] }>(page, "GET", `/api/compras/pedidos/${pedido.id}`);
  expect(srv.situacao, "PREMISSA: com saldo, o pedido continua aberto").toBe("aberto");
  expect(srv.itens.map((i) => [i.quantidade, i.recebido, i.saldo]), "PREMISSA: o servidor declara saldo 0.0040").toEqual([["2.0040", "2.0000", "0.0040"]]);

  // A CONSULTA DO PEDIDO: quantidade, Recebido e Saldo na escala da compra (4 casas) — o saldo não vira "0,00"
  await page.goto(`/compras/pedidos/${pedido.id}`);
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");
  await expect(page.getByTestId("doc-item-saldo"), "o saldo 0,0040 aparece inteiro").toHaveText(["0,0040"]);
  await expect(page.getByTestId("doc-item-faturado"), "o Recebido em 4 casas").toHaveText(["2,0000"]);
  await expect(page.getByTestId(`${P}-quantidade`), "a quantidade em 4 casas").toHaveText(["2,0040"]);
  // COERENTE com o saldo à vista: Encerrar saldo e Receber continuam oferecidos
  await expect(page.getByTestId("compras-encerrar-saldo"), "há saldo: Encerrar saldo é oferecido").toBeVisible();
  const passo = page.getByTestId(`compras-proximo-passo-${c.topCompra.codigo}`);
  await expect(passo, "há saldo: Receber continua oferecido").toBeVisible();
  await passo.click();
  await expect(page.getByTestId("compras-central")).toHaveAttribute("data-modo", "receber");
  await expect(page.getByTestId("compras-central-receber")).toHaveAttribute("data-situacao", "pronto");
  const linha = page.getByTestId(`compras-receber-item-${pedido.itemId}`);
  await expect(linha.getByTestId(`${P}-saldo-da-origem`), "o Receber mostra o MESMO saldo").toHaveText("0,0040");
  await marcar(linha);
  await expect.poll(async () => Number(await linha.getByLabel("Quantidade do item 1").inputValue()), { message: "em partes, a quantidade começa no saldo" }).toBe(0.004);

  // A CONSULTA DA COMPRA GERADA: a quantidade recebida em 4 casas
  await page.goto(`/compras/compras/${compraId}`);
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");
  await expect(page.getByTestId(`${P}-quantidade`), "a quantidade da compra em 4 casas").toHaveText(["2,0000"]);
});

/* ═════════════════════════════════════════════ CX-5 ═════════════════════════════════════════════ */

/**
 * O estado "itens com origem, cabeçalho sem origem" não é gravável hoje (a 0037 exige a origem do cabeçalho em quem liga
 * item a item de pedido), por isso só o CABEÇALHO é simulado na LEITURA do detalhe (como o "sem TOP" do CC-4b): os
 * ITENS são os que o servidor devolveu, com a chave que ele devolve — `origem_item_id`. É ela que a consulta tem de ler;
 * `item_origem_id` é só a chave do CORPO do `/convert` e nunca volta.
 */
test("CX-5 — 'Recebido de pedido' aparece quando o item tem origem_item_id (a chave da leitura), e 'Lançamento direto' quando não tem", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const pedido = await pedidoAberto(page, c, "10", "20.00");
  const recebidaId = await receberPelaApi(page, c, pedido, "4");
  const lida = await api<{ codigo: string; origem_documento_id: string | null; itens: Record<string, unknown>[] }>(page, "GET", `/api/compras/compras/${recebidaId}`);
  expect(lida.origem_documento_id, "premissa: a compra recebida aponta o pedido").toBe(pedido.id);
  expect(lida.itens.map((i) => i["origem_item_id"]), "PREMISSA: a leitura devolve o item de origem em `origem_item_id`").toEqual([pedido.itemId]);
  expect(lida.itens.every((i) => !("item_origem_id" in i)), "PREMISSA: e NÃO em `item_origem_id` (chave só do corpo do /convert)").toBe(true);

  const dados = page.getByTestId(`${P}-dados`);
  const origem = dados.locator('[data-campo="Origem"]');
  const abrirConsulta = async (id: string, codigo: string) => {
    await page.goto(`/compras/compras/${id}`);
    await expect(page.getByTestId(`${P}-identidade-nome`), "premissa: a tela desenhou ESTE documento").toHaveText(codigo);
    const grupo = dados.getByRole("button", { name: /^Dados adicionais/ });
    if ((await grupo.getAttribute("aria-expanded")) !== "true") await grupo.click();
    await expect(grupo).toHaveAttribute("aria-expanded", "true");
  };

  // (1) Cabeçalho SEM origem, itens COM `origem_item_id` (os do servidor) → "Recebido de pedido"
  const rota = `**/api/compras/compras/${recebidaId}`;
  await page.route(rota, async (r) => {
    if (r.request().method() !== "GET") return r.fallback();
    const resposta = await r.fetch();
    const corpo = await resposta.json() as Record<string, unknown>;
    await r.fulfill({ response: resposta, json: { ...corpo, origem_documento_id: null } });
  });
  await abrirConsulta(recebidaId, lida.codigo);
  await expect(origem, "itens com origem: 'Recebido de pedido'").toContainText("Recebido de pedido");
  await expect(origem).not.toContainText("Lançamento direto");
  await expect(page.getByTestId("compras-origem"), "sem a origem no cabeçalho, não há link").toHaveCount(0);
  await page.unroute(rota);

  // (2) A leitura de verdade: com a origem no cabeçalho, o link para o pedido
  await abrirConsulta(recebidaId, lida.codigo);
  await expect(page.getByTestId("compras-origem")).toHaveAttribute("href", new RegExp(`/compras/pedidos/${pedido.id}$`));

  // (3) CONTRAPROVA: uma compra lançada direto (itens sem origem) → "Lançamento direto"
  const { id: diretaId } = await api<{ id: string }>(page, "POST", "/api/compras/compras", {
    empresa_id: c.empresa, tipo_operacao_id: c.topCompra.id, fornecedor_id: c.fornecedor.id, data_documento: "2026-09-01",
    categoria_financeira_id: c.natureza.id, centro_custo_id: c.centro.id,
    itens: [{ produto_id: c.produto.id, armazem_id: c.armazem.id, quantidade: "1", valor_unitario: "3.00" }]
  });
  const direta = await api<{ codigo: string; itens: Record<string, unknown>[] }>(page, "GET", `/api/compras/compras/${diretaId}`);
  expect(direta.itens.map((i) => i["origem_item_id"] ?? null), "premissa: a compra direta não tem item de origem").toEqual([null]);
  await abrirConsulta(diretaId, direta.codigo);
  await expect(origem, "sem origem nenhuma: 'Lançamento direto'").toContainText("Lançamento direto");
  await expect(origem).not.toContainText("Recebido de pedido");
});
