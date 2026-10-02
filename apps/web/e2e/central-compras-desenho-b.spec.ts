import { test, expect, type Locator, type Page, type Request } from "@playwright/test";
import { login, api, uniq, empresaAtiva } from "./helpers";

/**
 * CENTRAL DE COMPRAS NO MOTOR — COMPORTAMENTO (VISUAL-UX-04, decisão 276) · CC-6 a CC-10.
 *
 * Este arquivo prova o que a Central de Compras FAZ no modelo da venda: as pendências (clique = zero POST), o "Salvo",
 * o Confirmar na criação, o Cancelar com motivo, o receber pedido na grade do motor e o Encerrar saldo. As medidas
 * (CC-1) e a barra (CC-2..5) moram nos arquivos -a e -c.
 *
 * Cada caso monta os PRÓPRIOS dados pela API (TOPs, fornecedor, armazém, produtos, pedido) — nenhum é "o primeiro da
 * lista": nenhuma conta depende do que outro spec deixou no banco. O que vai no fio é contado no fio (`request`), nunca
 * deduzido da tela.
 */

const P = "central-compras";
type Opcao = { id: string; label: string };
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
/** Código de TOP único por execução (tempo + sorteio), como nos arquivos -a e -c — 5 dígitos sorteados colidiam no banco. */
const codigoTop = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const UUID_INEXISTENTE = "00000000-0000-4000-8000-000000000000";

/** Escolhe no RefSelect da Central pelo rótulo do campo (nome escapado: nomes do seed têm colchetes). */
async function escolher(page: Page, rotulo: string, nome: string) {
  const campo = page.getByTestId("compras-central").locator("label", { hasText: rotulo }).first().locator("..");
  await campo.locator("button").first().click();
  const painel = page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nome.slice(0, 20));
  await painel.getByRole("option", { name: literal(nome.slice(0, 20)) }).first().click();
}

/**
 * Escolhe na pesquisa do motor ancorada à célula (produto ou armazém) da linha — pelo NOME INTEIRO. Cortado em 20
 * caracteres, "CC-B produto A <tempo>" de dois casos seguidos (menos de ~46 s entre eles) casava os dois, e o `.first()`
 * levava o produto do caso ANTERIOR: o CC-7 salvava outro produto sem ninguém ver.
 */
async function escolherNaCelula(page: Page, celula: Locator, nome: string) {
  await celula.click();
  const pesquisa = page.getByTestId(`${P}-pesquisa`);
  await expect(pesquisa).toBeVisible();
  await pesquisa.getByPlaceholder("Pesquisar pela descrição").fill(nome);
  await pesquisa.getByRole("option", { name: literal(nome) }).first().click();
  await expect(pesquisa).toHaveCount(0);
}

/** Registra os POST que casam com `filtro` (pathname) enquanto o teste corre. */
function gravarPosts(page: Page, filtro: (caminho: string) => boolean) {
  const posts: Request[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && filtro(new URL(r.url()).pathname)) posts.push(r); });
  return posts;
}

/** Abre o leque de Ações rápidas (se fechado) e devolve o item. */
async function itemDoLeque(page: Page, testId: string) {
  const leque = page.getByTestId(`${P}-acoes-rapidas`);
  if ((await leque.getAttribute("aria-expanded")) !== "true") await leque.click();
  await expect(leque).toHaveAttribute("aria-expanded", "true");
  const item = page.getByTestId(testId);
  await expect(item).toBeVisible();
  return item;
}

/** O cadastro de base: TOP de Compra e de Pedido (Pedido → Compra, em partes), dois produtos, armazém e fornecedor CRIADOS aqui, natureza, centro. */
async function cenario(page: Page) {
  const topCompra = { codigo: `4${codigoTop()}`, id: "" };
  topCompra.id = (await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo: topCompra.codigo, codigoBase: "compras.compra", nome: uniq("Compra CC-B") })).id;
  const topPedido = { codigo: `3${codigoTop()}`, id: "" };
  topPedido.id = (await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", {
    codigo: topPedido.codigo, codigoBase: "compras.pedido", nome: uniq("Pedido CC-B"),
    destinos: [{ tipoOperacaoId: topCompra.id, ordem: 0, emPartes: true }]
  })).id;
  const unidades = await api<Opcao[]>(page, "GET", "/api/resources/measurement_units/options");
  const un = unidades.find((u) => u.label.toUpperCase() === "UN");
  expect(un, "premissa: o seed tem a unidade UN").toBeTruthy();
  const grupos = await api<Opcao[]>(page, "GET", "/api/resources/product_groups/options?kind=analytic");
  const naturezas = await api<Opcao[]>(page, "GET", "/api/resources/financial_categories/options?kind=analytic&nature=expense");
  expect(naturezas.length, "premissa: há natureza de despesa analítica").toBeGreaterThan(0);
  const centros = await api<Opcao[]>(page, "GET", "/api/resources/cost_centers/options?kind=analytic");
  expect(centros.length, "premissa: há centro analítico").toBeGreaterThan(0);
  const produto = async (nome: string) => {
    const p = await api<{ id: string }>(page, "POST", "/api/resources/products", { description: uniq(nome), group_id: grupos[0]!.id, measurement_id: un!.id, financial_category_id: naturezas[0]!.id });
    return { id: p.id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${p.id}`))["description"]) };
  };
  const a = await produto("CC-B produto A");
  const b = await produto("CC-B produto B");
  const empresa = await empresaAtiva(page);
  const armazem = (await api<{ id: string }>(page, "POST", "/api/resources/warehouses", {
    empresa_id: empresa, initials: `B${Date.now().toString(36).slice(-4).toUpperCase()}`, description: uniq("CC-B arm"), type: "inputs"
  })).id;
  const nomeArmazem = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${armazem}`))["description"]);
  const fornecedor = (await api<{ id: string }>(page, "POST", "/api/resources/people", { name: uniq("CC-B forn"), person_type: "legal", is_provider: true })).id;
  const nomeFornecedor = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${fornecedor}`))["name"]);
  return { topCompra, topPedido, a, b, empresa, armazem, nomeArmazem, fornecedor, nomeFornecedor, natureza: naturezas[0]!, centro: centros[0]! };
}
type Cenario = Awaited<ReturnType<typeof cenario>>;

/** Uma compra aberta, pela API (a mesma porta da tela). */
async function compraAberta(page: Page, c: Cenario) {
  const r = await api<{ id: string }>(page, "POST", "/api/compras/compras", {
    empresa_id: c.empresa, tipo_operacao_id: c.topCompra.id, fornecedor_id: c.fornecedor, data_documento: "2026-09-01",
    categoria_financeira_id: c.natureza.id, centro_custo_id: c.centro.id,
    itens: [{ produto_id: c.a.id, armazem_id: c.armazem, quantidade: "2", valor_unitario: "10.00" }]
  });
  return { id: r.id, codigo: String((await api<Record<string, unknown>>(page, "GET", `/api/compras/compras/${r.id}`))["codigo"]) };
}

type ItemDoPedido = { id: string; produto_id: string; recebido?: string; saldo?: string };
/** Um pedido aberto: A 10 × 20,00 e B 2 × 5,00. */
async function pedidoAberto(page: Page, c: Cenario) {
  const r = await api<{ id: string }>(page, "POST", "/api/compras/pedidos", {
    empresa_id: c.empresa, tipo_operacao_id: c.topPedido.id, fornecedor_id: c.fornecedor, data_documento: "2026-09-01",
    categoria_financeira_id: c.natureza.id, centro_custo_id: c.centro.id,
    itens: [{ produto_id: c.a.id, quantidade: "10", valor_unitario: "20.00" }, { produto_id: c.b.id, quantidade: "2", valor_unitario: "5.00" }]
  });
  const lido = await api<{ codigo: string; itens: ItemDoPedido[] }>(page, "GET", `/api/compras/pedidos/${r.id}`);
  const itemA = lido.itens.find((i) => i.produto_id === c.a.id)!;
  const itemB = lido.itens.find((i) => i.produto_id === c.b.id)!;
  expect(itemA && itemB, "premissa: o pedido tem os dois itens").toBeTruthy();
  return { id: r.id, codigo: lido.codigo, itemA, itemB };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("CC-6 — pendências: compra sem itens não salva (zero POST, a pílula, a lista leva ao campo); estado da operação e do pedido continua desabilitando o Salvar", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const posts = gravarPosts(page, (p) => p.startsWith("/api/compras/") && !p.endsWith("/regras-da-operacao") && !p.endsWith("/layout-efetivo"));

  // (1) A PENDÊNCIA É SEMPRE CALCULADA: sem itens, o clique não envia nada, a pílula aparece com a lista.
  await page.goto(`/compras/compras/new?tipo_operacao_id=${c.topCompra.id}`);
  const central = page.getByTestId("compras-central");
  await expect(central).toHaveAttribute("data-especie", "compra");
  await escolher(page, "Fornecedor", c.nomeFornecedor);
  const salvar = page.getByTestId("compras-salvar");
  await expect(salvar, "pendência de campo não desabilita o Salvar").toBeEnabled();
  await expect(page.getByTestId(`${P}-pendencias`), "a pílula só aparece depois do clique").toHaveCount(0);
  await salvar.click();
  const pilula = page.getByTestId(`${P}-pendencias`);
  await expect(pilula).toBeVisible();
  await expect(pilula).toHaveText(/^\d+ pendências?$/);
  const lista = page.getByTestId(`${P}-pendencias-lista`);
  if (!(await lista.isVisible())) await pilula.click();
  await expect(lista).toBeVisible();
  const semItens = lista.locator(`[data-testid="${P}-pendencia"][data-caminho="itens"]`);
  await expect(semItens, "sem itens é pendência").toHaveCount(1);
  await expect(semItens).toContainText("Itens");
  // ZERO POST até aqui — sem espera cega: o registro do fio vale o caso inteiro, e o FIM do caso (depois de três
  // navegações completas, que entregam todo evento de rede pendente da página anterior) confere de novo a lista vazia.
  // Um POST que o clique com pendência tivesse disparado estaria nela.
  expect(posts.map((r) => r.url()), "ZERO POST com pendência").toEqual([]);

  // (2) A LISTA LEVA AO LUGAR: o foco vai à região dos itens.
  await semItens.click();
  await expect.poll(() => page.evaluate((t) => Boolean(document.activeElement?.closest(`[data-testid="${t}"]`)), `${P}-itens`),
    "a pendência de itens leva o foco à grade").toBe(true);

  // (3) ESTADO NÃO É PENDÊNCIA: regras da operação que falham DESABILITAM o Salvar, com o motivo na dica.
  await page.route("**/api/compras/compras/regras-da-operacao*", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "ERROR", message: "falha simulada" } }) }));
  await page.goto(`/compras/compras/new?tipo_operacao_id=${c.topCompra.id}`);
  await expect(page.getByTestId("compras-central")).toBeVisible();
  await expect(salvar, "regras que falham travam o Salvar").toBeDisabled();
  await expect(salvar).toHaveAttribute("data-dica", "As regras da operação não carregaram");
  await page.unroute("**/api/compras/compras/regras-da-operacao*");

  // (4) LAYOUT NÃO CARREGADO: aviso visível e Salvar desabilitado com o motivo.
  await page.route("**/api/compras/compras/layout-efetivo*", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "ERROR", message: "falha simulada" } }) }));
  await page.goto(`/compras/compras/new?tipo_operacao_id=${c.topCompra.id}`);
  await expect(page.getByTestId("compras-central")).toBeVisible();
  await expect(page.getByTestId("compras-layout-nao-carregado"), "o aviso do layout ausente é visível").toBeVisible();
  await expect(salvar, "layout que falha trava o Salvar").toBeDisabled();
  await expect(salvar).toHaveAttribute("data-dica", "Layout não carregado");
  await page.unroute("**/api/compras/compras/layout-efetivo*");

  // (5) PEDIDO RECUSADO NO MODO RECEBER: a faixa diz o motivo e o Salvar fica desabilitado.
  await page.goto(`/compras/compras/new?tipo_operacao_id=${c.topCompra.id}&pedido=${UUID_INEXISTENTE}`);
  await expect(page.getByTestId("compras-central")).toHaveAttribute("data-modo", "receber");
  await expect(page.getByTestId("compras-receber-recusado")).toBeVisible();
  await expect(salvar).toBeDisabled();
  await expect(salvar).toHaveAttribute("data-dica", "O pedido não pode ser recebido");
  expect(posts.map((r) => r.url()), "nem o clique com pendência, nem os estados escreveram nada").toEqual([]);
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * O corpo do POST de lançar que `preencherCompraPelaTela` produz — as chaves de hoje (a Central anterior montava o MESMO
 * corpo: os opcionais vazios saem como `undefined` e não vão no JSON; frete, outras despesas e desconto nascem "0").
 */
const CHAVES_DO_POST_PELA_TELA = ["categoria_financeira_id", "centro_custo_id", "data_documento", "desconto", "empresa_id", "fornecedor_id", "frete", "itens", "outras_despesas", "tipo_operacao_id"];
const CHAVES_DO_ITEM_PELA_TELA = ["armazem_id", "produto_id", "quantidade", "valor_unitario"];

async function preencherCompraPelaTela(page: Page, c: Cenario) {
  await page.goto(`/compras/compras/new?tipo_operacao_id=${c.topCompra.id}`);
  await expect(page.getByTestId("compras-central")).toHaveAttribute("data-especie", "compra");
  await escolher(page, "Fornecedor", c.nomeFornecedor);
  await escolher(page, "Natureza de despesa", c.natureza.label);
  await escolher(page, "Centro de resultado", c.centro.label);
  await page.getByTestId(`${P}-adicionar-item`).click();
  const linha = page.getByTestId(`${P}-linha`).first();
  await escolherNaCelula(page, linha.getByTestId(`${P}-produto`), c.a.nome);
  await escolherNaCelula(page, linha.getByTestId(`${P}-armazem`), c.nomeArmazem);
  await linha.getByLabel("Quantidade do item 1").fill("5");
  await linha.getByLabel("Valor unitário do item 1").fill("20");
  await expect(page.getByTestId(`${P}-subtotal`)).toContainText("100,00");
}

test("CC-7 — Salvo aparece e some; Confirmar compra na criação salva, abre a compra com o diálogo e a prévia; fechar deixa Aberta", async ({ page }) => {
  await login(page);
  const c = await cenario(page);

  // (1) SALVAR: o POST de sempre; abre a compra salva com "Salvo" por 2,4 s, sem URL e sem diálogo.
  await preencherCompraPelaTela(page, c);
  const lancar = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/compras/compras");
  await page.getByTestId("compras-salvar").click();
  const corpo = (await lancar).postDataJSON() as Record<string, unknown> & { itens: Record<string, unknown>[] };
  // AS MESMAS CHAVES DO POST DE HOJE, conjunto EXATO (não um subconjunto): o cabeçalho que a tela preencheu (os opcionais
  // vazios não vão) e o item com produto, armazém, quantidade e valor — sem chave nova, sem chave a menos.
  expect(Object.keys(corpo).sort(), "as MESMAS chaves do POST de hoje").toEqual(CHAVES_DO_POST_PELA_TELA);
  expect(corpo, "os valores que a tela mostrou").toMatchObject({
    empresa_id: c.empresa, fornecedor_id: c.fornecedor, tipo_operacao_id: c.topCompra.id, categoria_financeira_id: c.natureza.id, centro_custo_id: c.centro.id
  });
  expect(corpo.itens.map((i) => Object.keys(i).sort()), "as MESMAS chaves do item").toEqual([CHAVES_DO_ITEM_PELA_TELA]);
  expect(corpo.itens[0], "o item que a tela mostrou").toMatchObject({ produto_id: c.a.id, armazem_id: c.armazem });
  expect([Number(corpo.itens[0]!["quantidade"]), Number(corpo.itens[0]!["valor_unitario"])]).toEqual([5, 20]);
  await expect(page).toHaveURL(/\/compras\/compras\/[0-9a-f-]{36}$/);
  expect(new URL(page.url()).search, "nada do Salvo na URL").toBe("");
  const salvo = page.getByTestId(`${P}-salvo`);
  await expect(salvo).toBeVisible();
  await expect(salvo).toHaveText(/Salvo/);
  await expect(page.getByTestId("confirm-dialog"), "Salvar não abre o Confirmar").toHaveCount(0);
  await expect(salvo, "o Salvo some sozinho").toHaveCount(0, { timeout: 6_000 });
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");

  // (2) CONFIRMAR NA CRIAÇÃO: o mesmo Salvar; a compra abre JÁ com o diálogo e a prévia; nenhuma confirmação sem prévia.
  await preencherCompraPelaTela(page, c);
  const confirms = gravarPosts(page, (p) => p.endsWith("/confirm"));
  await page.getByTestId(`${P}-confirmar`).click();
  await expect(page).toHaveURL(/\/compras\/compras\/[0-9a-f-]{36}$/);
  const id = /\/compras\/compras\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
  const dialogo = page.getByTestId("confirm-dialog");
  await expect(dialogo).toBeVisible();
  await expect(dialogo).toContainText(/Confirmar compra \S+\?/);
  await expect(page.getByTestId("compras-previa")).toHaveAttribute("data-situacao", "pronta");
  await expect(dialogo.getByRole("button", { name: "Voltar" })).toBeVisible();
  await dialogo.getByRole("button", { name: "Voltar" }).click();
  await expect(dialogo).toHaveCount(0);
  await expect(page.getByTestId("compras-consulta-corpo"), "fechar deixa a compra Aberta").toHaveAttribute("data-situacao", "aberto");
  expect(confirms, "nenhum /confirm sem o clique no diálogo").toEqual([]);
  const srv = await api<{ situacao: string }>(page, "GET", `/api/compras/compras/${id}`);
  expect(srv.situacao).toBe("aberto");
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("CC-8 — Cancelar com motivo: {motivo} aparado, vazio sem motivo, Idempotency-Key; pedido com compra viva trava o Cancelar com a dica; a corrida (409) mostra a mensagem do servidor", async ({ page }) => {
  await login(page);
  const c = await cenario(page);

  // (1) COMPRA, MOTIVO DIGITADO: o corpo é { motivo } aparado, com Idempotency-Key.
  const com = await compraAberta(page, c);
  await page.goto(`/compras/compras/${com.id}`);
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");
  await (await itemDoLeque(page, "compras-cancelar")).click();
  const dialogo = page.getByTestId("confirm-dialog");
  await expect(dialogo).toContainText(`Cancelar compra ${com.codigo}?`);
  await expect(dialogo.getByText("Motivo (opcional)")).toBeVisible();
  const motivo = page.getByTestId(`${P}-cancelar-motivo`);
  await expect(motivo).toHaveAttribute("placeholder", "Registrado no cancelamento");
  await motivo.fill("  Nota devolvida ao fornecedor  ");
  const req1 = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/compras/compras/${com.id}/cancel`);
  await dialogo.getByRole("button", { name: "Cancelar compra" }).click();
  const resp1 = await req1;
  expect(resp1.status(), "o cancelamento responde 2xx").toBeLessThan(300);
  const r1 = resp1.request();
  expect(r1.postDataJSON(), "a chave da COMPRA é motivo, aparado").toEqual({ motivo: "Nota devolvida ao fornecedor" });
  expect(r1.headers()["idempotency-key"], "com Idempotency-Key").toBeTruthy();
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "cancelado");

  // (2) COMPRA, MOTIVO VAZIO: o corpo vai SEM motivo.
  const sem = await compraAberta(page, c);
  await page.goto(`/compras/compras/${sem.id}`);
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");
  await (await itemDoLeque(page, "compras-cancelar")).click();
  await expect(page.getByTestId(`${P}-cancelar-motivo`)).toHaveValue("");
  const req2 = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/compras/compras/${sem.id}/cancel`);
  await page.getByTestId("confirm-dialog").getByRole("button", { name: "Cancelar compra" }).click();
  const resp2 = await req2;
  expect(resp2.status(), "o cancelamento responde 2xx").toBeLessThan(300);
  const r2 = resp2.request();
  expect(r2.postDataJSON(), "motivo vazio: corpo sem motivo").toEqual({});
  expect(r2.headers()["idempotency-key"]).toBeTruthy();
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "cancelado");

  // (3) PEDIDO COM COMPRA VIVA: Cancelar fica no leque, DESABILITADO, com a dica de hoje.
  const pedido = await pedidoAberto(page, c);
  await api(page, "POST", `/api/compras/pedidos/${pedido.id}/convert`, {
    tipo_operacao_id: c.topCompra.id, data_documento: "2026-09-02", categoria_financeira_id: c.natureza.id, centro_custo_id: c.centro.id,
    itens: [{ item_origem_id: pedido.itemA.id, quantidade: "4", valor_unitario: "20.00", armazem_id: c.armazem }]
  });
  await page.goto(`/compras/pedidos/${pedido.id}`);
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");
  const travado = await itemDoLeque(page, "compras-cancelar");
  await expect(travado).toBeDisabled();
  await expect(travado).toHaveAttribute("aria-label", "O pedido tem compra não cancelada: cancele a compra antes de cancelar o pedido.");
  await page.keyboard.press("Escape");

  // (4) A CORRIDA: pedido sem compra na abertura; a compra nasce depois — o 409 do servidor aparece com a mensagem dele.
  const corrida = await pedidoAberto(page, c);
  const MSG = "Este pedido tem compra não cancelada e não é cancelado.";
  let chamadas = 0;
  await page.route(`**/api/compras/pedidos/${corrida.id}/cancel`, (r) => {
    chamadas += 1;
    return r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "CONFLICT", message: MSG } }) });
  });
  await page.goto(`/compras/pedidos/${corrida.id}`);
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");
  const livre = await itemDoLeque(page, "compras-cancelar");
  await expect(livre, "sem compra viva na abertura, Cancelar fica habilitado").toBeEnabled();
  await livre.click();
  await page.getByTestId("confirm-dialog").getByRole("button", { name: "Cancelar pedido de compra" }).click();
  await expect(page.getByText(MSG).first(), "a mensagem do servidor").toBeVisible();
  expect(chamadas).toBe(1);
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");
  await page.unroute(`**/api/compras/pedidos/${corrida.id}/cancel`);
  expect((await api<{ situacao: string }>(page, "GET", `/api/compras/pedidos/${corrida.id}`)).situacao).toBe("aberto");
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("CC-9 — receber pedido no modelo: travas, sem Adicionar produto e sem Duplicar item, Remover item, quantidade até o saldo, coluna do saldo; salva pelo /convert", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const pedido = await pedidoAberto(page, c);

  // (1) A PÍLULA "Receber…" (um passo) abre a Central em modo receber.
  await page.goto(`/compras/pedidos/${pedido.id}`);
  const passos = page.getByTestId("compras-proximos-passos");
  await expect(passos).toHaveAttribute("data-situacao", "pronto");
  const passo = page.getByTestId(`compras-proximo-passo-${c.topCompra.codigo}`);
  await expect(passo).toHaveText(/Receber…/);
  await expect(passo).toHaveAttribute("data-em-partes", "true");
  await passo.click();
  await expect(page).toHaveURL(new RegExp(`/compras/compras/new\\?.*pedido=${pedido.id}`));
  const central = page.getByTestId("compras-central");
  await expect(central).toHaveAttribute("data-modo", "receber");
  await expect(page.getByTestId("compras-central-receber")).toHaveAttribute("data-situacao", "pronto");

  // (2) TRAVAS: fornecedor e empresa do pedido; produto travado na linha.
  await expect(central.locator("label", { hasText: "Fornecedor" }).first().locator("..").locator("button").first()).toBeDisabled();
  await expect(central.locator("label", { hasText: "Empresa" }).first().locator("..").locator("button").first()).toBeDisabled();
  const linhaA = page.getByTestId(`compras-receber-item-${pedido.itemA.id}`);
  const linhaB = page.getByTestId(`compras-receber-item-${pedido.itemB.id}`);
  await expect(linhaA).toBeVisible();
  await expect(linhaB).toBeVisible();
  await expect(linhaA.getByTestId(`${P}-produto`)).toHaveAttribute("data-travado", "");

  // (3) A GRADE DO MOTOR NO RECEBER: coluna do saldo; sem Adicionar produto e sem Duplicar item.
  await expect(page.getByTestId(`${P}-grade`).getByRole("columnheader", { name: "Saldo do pedido" })).toBeVisible();
  await expect(linhaA.getByTestId(`${P}-saldo-da-origem`)).toHaveText("10,0000");
  await expect(linhaB.getByTestId(`${P}-saldo-da-origem`)).toHaveText("2,0000");
  await expect(page.getByTestId(`${P}-adicionar-item`)).toHaveCount(0);
  await expect(page.getByTestId(`${P}-adicionar-vazio`)).toHaveCount(0);
  await expect(page.getByTestId(`${P}-duplicar-item`)).toHaveCount(0);

  // (4) REMOVER ITEM: marca a linha B e remove (em partes).
  await linhaB.getByTestId(`${P}-selecionar-item`).click();
  await page.getByTestId(`${P}-remover-item`).click();
  await expect(linhaB).toHaveCount(0);

  // (5) QUANTIDADE ATÉ O SALDO, armazém, total.
  const circuloA = linhaA.getByTestId(`${P}-selecionar-item`);
  if ((await circuloA.getAttribute("aria-checked")) !== "true") await circuloA.click();
  await expect(circuloA).toHaveAttribute("aria-checked", "true");
  const quantidade = linhaA.getByLabel("Quantidade do item 1");
  await expect(quantidade).toHaveAttribute("max", /^10(\.0+)?$/);
  await quantidade.fill("4");
  await escolherNaCelula(page, linhaA.getByTestId(`${P}-armazem`), c.nomeArmazem);

  // (6) SALVA PELO /convert, com as MESMAS chaves (item_origem_id; sem empresa, fornecedor nem produto).
  const convert = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === `/api/compras/pedidos/${pedido.id}/convert`);
  await page.getByTestId("compras-salvar").click();
  const corpo = (await convert).postDataJSON() as { itens: Record<string, unknown>[] } & Record<string, unknown>;
  expect(corpo["empresa_id"]).toBeUndefined();
  expect(corpo["fornecedor_id"]).toBeUndefined();
  expect(corpo.itens.length).toBe(1);
  expect(corpo.itens[0]).toMatchObject({ item_origem_id: pedido.itemA.id, armazem_id: c.armazem });
  expect(Number(corpo.itens[0]!["quantidade"])).toBe(4);
  expect(corpo.itens[0]!["produto_id"]).toBeUndefined();
  await expect(page).toHaveURL(/\/compras\/compras\/[0-9a-f-]{36}$/);
  const compraId = /\/compras\/compras\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
  const compra = await api<{ origem_documento_id: string; itens: { origem_item_id: string; quantidade: string }[] }>(page, "GET", `/api/compras/compras/${compraId}`);
  expect(compra.origem_documento_id).toBe(pedido.id);
  expect(compra.itens.map((i) => [i.origem_item_id, i.quantidade])).toEqual([[pedido.itemA.id, "4.0000"]]);
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("CC-10 — Encerrar saldo: pílula do pedido, motivo obrigatório, corpo { motivo } com Idempotency-Key; o pedido passa a convertido", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const pedido = await pedidoAberto(page, c);
  await api(page, "POST", `/api/compras/pedidos/${pedido.id}/convert`, {
    tipo_operacao_id: c.topCompra.id, data_documento: "2026-09-02", categoria_financeira_id: c.natureza.id, centro_custo_id: c.centro.id,
    itens: [{ item_origem_id: pedido.itemA.id, quantidade: "4", valor_unitario: "20.00", armazem_id: c.armazem }]
  });

  await page.goto(`/compras/pedidos/${pedido.id}`);
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");
  const pilula = page.getByTestId("compras-encerrar-saldo");
  await expect(pilula).toBeVisible();
  await expect(pilula).toHaveText(/Encerrar saldo/);
  await pilula.click();
  const dialogo = page.getByTestId("dialog-encerrar-saldo");
  await expect(dialogo).toBeVisible();
  const confirmar = page.getByTestId("encerrar-saldo-confirmar");
  const motivo = page.getByTestId("encerrar-saldo-motivo");
  await expect(confirmar, "sem motivo, não encerra").toBeDisabled();
  await motivo.fill("   ");
  await expect(confirmar, "só espaços não é motivo").toBeDisabled();
  await motivo.fill("  O fornecedor não entrega o restante  ");
  await expect(confirmar).toBeEnabled();
  const req = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/compras/pedidos/${pedido.id}/encerrar-saldo`);
  await confirmar.click();
  const resp = await req;
  expect(resp.status(), "o encerramento responde 2xx").toBeLessThan(300);
  const r = resp.request();
  expect(r.postDataJSON()).toEqual({ motivo: "O fornecedor não entrega o restante" });
  expect(r.headers()["idempotency-key"]).toBeTruthy();
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "convertido");
  await expect(page.getByTestId("compras-encerrar-saldo"), "sem saldo aberto, a pílula sai").toHaveCount(0);
  const srv = await api<{ situacao: string; saldo_encerrado_motivo?: string }>(page, "GET", `/api/compras/pedidos/${pedido.id}`);
  expect(srv.situacao).toBe("convertido");
});
