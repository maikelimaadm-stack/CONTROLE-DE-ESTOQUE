import type { Locator, Page, Request, Response } from "@playwright/test";
import { login, api, uniq, empresaAtiva, pickRef, adicionarItemNaCentral, escolherPrimeiroProdutoDaLinha, preencherClassificacaoFinanceira } from "./helpers";
import { cfg4, cabecalhosDaSessao, type RegrasGeraisE2E } from "./top-config-08-comum";
import { test, expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed } from "./central-compras-fixtures";
import { mundoDoWebDaBase, premissaDaApiDestaFase, regrasGeraisDoCorpo, vigiar, type Mundo, type RegrasGeraisNoFio } from "./operacoes-01-f2-skew-comum";

/**
 * OPERACOES-01 · F2 (decisão 279) · K-2, SENTIDO 2 — O WEB DA BASE CONTRA A API DESTE HEAD (a janela "API antes do web"
 * da DEPLOYMENT, e a reversão só do web).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 2 roda em `playwright.skew-web-anterior.config.ts`, cujo `testMatch` é
 * `/skew-web-anterior\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o `playwright.config.ts` comum
 * ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (lá o web seria o deste HEAD, e o caso não mediria
 * o cliente anterior). O caso não foi acrescentado em `skew-web-anterior.spec.ts` porque aquele arquivo é compartilhado
 * com as fases que correm em paralelo: o arquivo próprio não colide com nenhuma. A identidade do bundle da base é a do
 * caso IDENTIDADE de `skew-web-anterior.spec.ts`, na MESMA execução.
 *
 * O QUE SE MEDE. A API desta fase só ACRESCENTA: `regrasGerais` como última chave das regras da operação, e a rota de
 * leitura `GET /api/aprovacoes/<área>/:id`, que o web da base nunca chama. Os corpos de entrada e as respostas dos POST
 * não mudam. O navegador roda o bundle EXATO da base, e:
 *   · o web da base recebe a chave a mais nas regras da operação e a IGNORA: o Salvar continua "Salvar" (exato) mesmo
 *     com a TOP Automática; o POST leva as chaves de HOJE (a lista de W4, `central-vendas-workspace.spec.ts`, e a de
 *     CC-7, `central-compras-desenho-b.spec.ts`); a API nova responde 201 e confirma (a TOP Automática já executava
 *     desde a decisão 277); a consulta abre confirmada;
 *   · DECLARADO (observado e registrado, comportamento da base, sem defeito de contrato): o web da base diz "Salvo com
 *     sucesso" depois do POST que confirmou — ele não lê `confirmacaoAutomatica`; e, com a TOP que permite documento sem
 *     itens, ele ainda pede ao menos um item (ZERO POST), embora a API declare que aceitaria;
 *   · nenhuma requisição morre e nenhuma resposta da página é 404, 422 ou 5xx (`semErroDeContrato`).
 *
 * O MUNDO, NESTE SENTIDO, É O DO WEB DA BASE (`mundoDoWebDaBase`, em `operacoes-01-f2-skew-comum.ts`): a ÁRVORE da base em
 * `.api-anterior` conhece o rótulo "Salvar e confirmar"? Não → legado (a base de hoje): o descrito acima. Sim → novo (a
 * base já com a F2): "Salvar e confirmar", o aviso "Salvo e confirmado." e o documento sem itens salvo. A API deste HEAD
 * entra como PREMISSA (`premissaDaApiDestaFase`): ela declara `regrasGerais` e serve a situação da aprovação — é ela que
 * está sendo julgada. As TOPs e os cadastros nascem pela API deste HEAD, pelas portas de `central-compras-fixtures` (a
 * exclusão lógica roda no fim do caso, passou ou falhou); a venda que termina aberta é cancelada no fim.
 */

const PV = "central-vendas";
const PC = "central-compras";
const caminho = (r: Request | Response) => new URL(r.url()).pathname;
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

/**
 * AS CHAVES DO POST DE HOJE, conjunto EXATO (igualdade, não "contém": uma chave nova passaria despercebida num "contém").
 * Venda: a lista de W4 (`central-vendas-workspace.spec.ts`), o corpo da Central com a classificação financeira — sem
 * condição de pagamento (a TOP do caso não tem padrão). Compra: a lista de CC-7 (`central-compras-desenho-b.spec.ts`), o
 * cabeçalho preenchido e o item com produto, local de estoque, quantidade e valor.
 */
const CHAVES_DO_POST_DA_VENDA = [
  "categoria_financeira_id", "centro_custo_id",
  "client_id", "discount", "document_date", "driver_name", "due_date", "empresa_id", "freight", "freight_icms",
  "installment_plan", "is_deductible", "items", "note", "other_values", "payment_method_id", "proprietary_id",
  "shipping_date", "tipo_operacao_id", "transporter_id"
];
const CHAVES_DO_ITEM_DA_VENDA = ["discount", "discount_percent", "note", "product_id", "quantity", "unit_price", "warehouse_id"];
const CHAVES_DO_POST_DA_COMPRA = ["categoria_financeira_id", "centro_custo_id", "data_documento", "desconto", "empresa_id", "fornecedor_id", "frete", "itens", "outras_despesas", "tipo_operacao_id"];
const CHAVES_DO_ITEM_DA_COMPRA = ["armazem_id", "produto_id", "quantidade", "valor_unitario"];

const AUTOMATICA: RegrasGeraisNoFio = { confirmacaoAutomatica: true, aceitaSemItens: false };
const PERMITIDO: RegrasGeraisNoFio = { confirmacaoAutomatica: false, aceitaSemItens: true };

type CorpoDoLancar = Record<string, unknown> & { id: string; confirmacaoAutomatica?: unknown };
type Venda = { id: string; status: string; items: unknown[] };

/** O aviso do TIPO dado, pela descrição; `avisos` conta todos. */
const aviso = (page: Page, tipo: "success" | "info" | "warning") =>
  page.locator(`[data-sonner-toast] .erp-toast-panel--${tipo} .erp-toast-panel__description`);
const avisos = (page: Page) => page.locator("[data-sonner-toast]");

/** O rótulo do Salvar e o aviso do POST que confirmou, em cada mundo do web da base. */
const rotuloComAutomatica = (mundo: Mundo) => (mundo === "novo" ? "Salvar e confirmar" : "Salvar");
const avisoDoPostQueConfirmou = (mundo: Mundo) => (mundo === "novo" ? "Salvo e confirmado." : "Salvo com sucesso");

/** Registra o comportamento DECLARADO da base (no log e na anotação do relatório). */
function declarar(texto: string) {
  console.log(`[skew] OPERACOES-01 F2 · K-2 · DECLARADO: ${texto}`);
  test.info().annotations.push({ type: "declarado", description: texto });
}

/** Uma TOP nova PELA API DESTE HEAD (limpeza automática), com as regras gerais pedidas sobre o neutro do domínio. */
async function topNova(page: Page, codigoBase: "vendas.venda" | "compras.compra", r: RegrasGeraisE2E): Promise<string> {
  const { id } = await criarTop(page, { codigo: codigoTop("f2k2"), codigoBase, nome: uniq(`F2 K-2 ${codigoBase}`), configuracao: cfg4(r) });
  return id;
}

/** O corpo das regras da operação que o web da base pede para a TOP (o ouvinte nasce antes da navegação). */
const regrasNoFio = (page: Page, porta: string, top: string) => page.waitForResponse((r) => r.request().method() === "GET"
  && caminho(r) === porta && new URL(r.url()).searchParams.get("tipo_operacao_id") === top);

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K-2a · A CENTRAL DE VENDAS DA BASE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Abre a criação da venda no web da base com a TOP e escolhe um cliente novo. Confere que a API nova MANDOU o bloco ao
 * web da base, igual ao esperado (a chave a mais chega a ele; o que se mede depois é que ela não muda nada).
 */
async function abrirCriacaoDeVenda(page: Page, top: string, esperado: RegrasGeraisNoFio): Promise<void> {
  const cliente = uniq("Cliente F2K2");
  await criarCadastro(page, "people", { name: cliente, person_type: "legal", is_client: true });
  const regras = regrasNoFio(page, "/api/sales/sales/regras-da-operacao", top);
  await page.goto(`/vendas/sales/new?tipo_operacao_id=${top}`);
  await expect(page.getByTestId("top-contexto"), "o web da base abriu o formulário desta TOP").toBeVisible();
  const r = await regras;
  expect(r.status(), "o web da base perguntou as regras da operação").toBe(200);
  expect(regrasGeraisDoCorpo(await r.json() as Record<string, unknown>, "venda"), "a API nova mandou o bloco ao web da base").toEqual(esperado);
  await pickRef(page, "Cliente", cliente);
}

/** Clica no Salvar do web da base e devolve o POST (o corpo enviado e o devolvido) — o ouvinte nasce antes do clique. */
async function salvarVenda(page: Page, vendas: string[]) {
  const post = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === "/api/sales/sales");
  await page.getByTestId(`${PV}-salvar`).click();
  const r = await post;
  expect(r.status(), "a API nova aceitou o corpo do web da base").toBe(201);
  const corpo = await r.json() as CorpoDoLancar;
  vendas.push(corpo.id);
  await expect(page, "depois do POST o web da base abre a consulta do documento salvo").toHaveURL(new RegExp(`/vendas/sales/${corpo.id}$`));
  return { corpo, enviado: r.request().postDataJSON() as Record<string, unknown> & { items: Record<string, unknown>[] } };
}

const situacaoDaVenda = (page: Page) => page.getByTestId(`${PV}-situacao`).locator("[data-status]");
const vendaNoServidor = (page: Page, id: string) => api<Venda>(page, "GET", `/api/sales/sales/${id}`);

async function cancelarAbertas(page: Page, vendas: string[]) {
  for (const id of vendas) {
    const v = await vendaNoServidor(page, id).catch(() => null);
    if (v && ["open", "approved"].includes(v.status)) await api(page, "POST", `/api/sales/sales/${id}/cancel`, {}).catch(() => undefined);
  }
}

test("OP01-F2 · K-2a (sentido 2) — a Central de Vendas do web da base contra a API deste HEAD: 'Salvar' exato com a TOP Automática, o POST com as chaves de hoje, 201 confirmado e a consulta confirmada; DECLARADO: 'Salvo com sucesso' e o item ainda exigido com a TOP que permite (ou, com a base já na F2, 'Salvar e confirmar')", async ({ page }) => {
  const mundo = mundoDoWebDaBase();
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const vendas: string[] = [];
  try {
    const automatica = await topNova(page, "vendas.venda", { confirmacao: "automatica" });
    const permitido = await topNova(page, "vendas.venda", { confirmacao: "manual", documentoSemItens: "permitido" });
    expect(await premissaDaApiDestaFase(page, cab, "vendas", [automatica, permitido]), "premissa: a API deste HEAD declara as regras gerais de cada TOP")
      .toEqual([AUTOMATICA, PERMITIDO]);
    const v = vigiar(page);

    // (1) TOP AUTOMÁTICA: o web da base ignora a chave a mais; o corpo é o de hoje; a API nova confirma.
    await abrirCriacaoDeVenda(page, automatica, AUTOMATICA);
    await adicionarItemNaCentral(page);
    await escolherPrimeiroProdutoDaLinha(page);
    const linha = page.getByTestId(`${PV}-linha`).first();
    await linha.getByLabel("Quantidade").fill("1");
    await linha.getByLabel("Valor unitário").fill("40");
    await preencherClassificacaoFinanceira(page);
    const salvar = page.getByTestId(`${PV}-salvar`);
    await expect(salvar, "habilitado: as regras chegaram").toBeEnabled();
    await expect(salvar, `mundo ${mundo}: o nome acessível do Salvar do web da base com a TOP Automática, exato`).toHaveAttribute("aria-label", rotuloComAutomatica(mundo));
    const confirmada = await salvarVenda(page, vendas);
    expect(Object.keys(confirmada.enviado).sort(), "o POST do web da base leva as chaves de HOJE (a lista de W4)").toEqual(CHAVES_DO_POST_DA_VENDA);
    expect(confirmada.enviado.items.map((i) => Object.keys(i).sort()), "e o item, as de hoje").toEqual([CHAVES_DO_ITEM_DA_VENDA]);
    expect(confirmada.enviado["tipo_operacao_id"], "com a TOP Automática").toBe(automatica);
    expect(confirmada.corpo.confirmacaoAutomatica, "a API nova confirmou no fim do POST (a TOP Automática executa desde a 277)").toEqual({ confirmado: true });
    await expect(aviso(page, "success"), `mundo ${mundo}: o aviso do web da base depois do POST que confirmou`).toHaveText([avisoDoPostQueConfirmou(mundo)]);
    await expect(avisos(page), "um aviso só").toHaveCount(1);
    if (mundo === "legado") declarar("o web da base diz \"Salvo com sucesso\" depois do POST que CONFIRMOU a venda (ele não lê `confirmacaoAutomatica`); a consulta, que lê o documento, mostra a venda confirmada");
    await expect(situacaoDaVenda(page), "a consulta do web da base mostra a venda confirmada").toHaveAttribute("data-status", "confirmed");
    expect((await vendaNoServidor(page, confirmada.corpo.id)).status, "no servidor também").toBe("confirmed");

    // (2) TOP QUE PERMITE DOCUMENTO SEM ITENS: a API declara que aceitaria; o web da base decide pelo que conhece.
    const posts: string[] = [];
    const contar = (r: Request) => { if (r.method() === "POST" && caminho(r) === "/api/sales/sales") posts.push(r.url()); };
    page.on("request", contar);
    await abrirCriacaoDeVenda(page, permitido, PERMITIDO);
    await preencherClassificacaoFinanceira(page);
    await expect(page.getByTestId(`${PV}-linha`), "premissa: nenhum item na grade").toHaveCount(0);
    await expect(salvar, "habilitado: as regras chegaram").toBeEnabled();
    await expect(salvar, "TOP Manual: 'Salvar' nos dois mundos").toHaveAttribute("aria-label", "Salvar");
    if (mundo === "legado") {
      await salvar.click();
      await expect(page.getByTestId(`${PV}-pendencias`), "o clique sem item mostra UMA pendência").toHaveText(/1 pendência/);
      const daLista = page.getByTestId(`${PV}-pendencias-lista`).getByTestId(`${PV}-pendencia`);
      await expect(daLista, "só o item falta").toHaveCount(1);
      await expect(daLista, "é a pendência dos itens, a de hoje").toHaveAttribute("data-caminho", "items");
      await expect(daLista).toContainText("Adicione ao menos um item.");
      expect(posts, "ZERO POST: o web da base não envia documento sem itens").toEqual([]);
      declarar("com a TOP que permite documento sem itens (a API deste HEAD declara `aceitaSemItens: true` e aceitaria), a Central de Vendas da base ainda pede ao menos um item e não envia nada");
    } else {
      const semItens = await salvarVenda(page, vendas);
      expect(semItens.enviado.items, "o POST levou a venda sem itens").toEqual([]);
      expect(posts, "um POST, o desta venda").toHaveLength(1);
      await expect(situacaoDaVenda(page), "a consulta mostra a venda aberta").toHaveAttribute("data-status", "open");
      expect((await vendaNoServidor(page, semItens.corpo.id)).items, "no servidor: a venda gravada sem itens").toEqual([]);
    }
    page.off("request", contar);
    v.semBloqueio();
    v.semErroDeContrato();
  } finally {
    await cancelarAbertas(page, vendas);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K-2b · A CENTRAL DE COMPRAS DA BASE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

/** Escolhe no RefSelect da Central de Compras pelo rótulo do campo (nome escapado: nomes do seed têm colchetes). */
async function escolher(page: Page, rotulo: string, nome: string) {
  const campo = page.getByTestId("compras-central").locator("label", { hasText: rotulo }).first().locator("..");
  await campo.locator("button").first().click();
  const painel = page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nome.slice(0, 20));
  await painel.getByRole("option", { name: literal(nome.slice(0, 20)) }).first().click();
}

/** Escolhe na pesquisa do motor ancorada à célula (produto ou local de estoque) da linha — pelo NOME INTEIRO. */
async function escolherNaCelula(page: Page, celula: Locator, nome: string) {
  await celula.click();
  const pesquisa = page.getByTestId(`${PC}-pesquisa`);
  await expect(pesquisa).toBeVisible();
  await pesquisa.getByPlaceholder("Pesquisar pela descrição").fill(nome);
  await pesquisa.getByRole("option", { name: literal(nome) }).first().click();
  await expect(pesquisa).toHaveCount(0);
}

/** O cadastro do caso PELA API DESTE HEAD: fornecedor, local de estoque e produto; natureza e centro do seed, pelo nome. */
async function cenarioDaCompra(page: Page) {
  const ref = await referenciasDoSeed(page);
  const p = await criarCadastro(page, "products", { description: uniq("F2K2 produto"), group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id });
  const nomeProduto = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${p.id}`))["description"]);
  const empresa = await empresaAtiva(page);
  const armazem = (await criarCadastro(page, "warehouses", {
    empresa_id: empresa, initials: `Q${Date.now().toString(36).slice(-4).toUpperCase()}`, description: uniq("F2K2 local"), type: "inputs"
  })).id;
  const nomeArmazem = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${armazem}`))["description"]);
  const fornecedor = (await criarCadastro(page, "people", { name: uniq("F2K2 forn"), person_type: "legal", is_provider: true })).id;
  const nomeFornecedor = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${fornecedor}`))["name"]);
  return { produto: p.id, nomeProduto, armazem, nomeArmazem, nomeFornecedor, natureza: ref.natureza, centro: ref.centro };
}
type CenarioDaCompra = Awaited<ReturnType<typeof cenarioDaCompra>>;

/** Abre a criação da compra no web da base com a TOP e o cabeçalho preenchido; confere o bloco que a API nova mandou. */
async function abrirCriacaoDeCompra(page: Page, top: string, c: CenarioDaCompra, esperado: RegrasGeraisNoFio) {
  const regras = regrasNoFio(page, "/api/compras/compras/regras-da-operacao", top);
  await page.goto(`/compras/compras/new?tipo_operacao_id=${top}`);
  const r = await regras;
  expect(r.status(), "o web da base perguntou as regras da operação").toBe(200);
  expect(regrasGeraisDoCorpo(await r.json() as Record<string, unknown>, "compra"), "a API nova mandou o bloco ao web da base").toEqual(esperado);
  await expect(page.getByTestId("compras-central")).toHaveAttribute("data-especie", "compra");
  await expect(page.getByTestId("compras-salvar"), "o Salvar saiu da trava: as regras chegaram").toBeEnabled();
  await escolher(page, "Fornecedor", c.nomeFornecedor);
  await escolher(page, "Natureza de despesa", c.natureza.label);
  await escolher(page, "Centro de resultado", c.centro.label);
}

/** Clica no Salvar do web da base e devolve o POST (o corpo enviado e o devolvido) — o ouvinte nasce antes do clique. */
async function salvarCompra(page: Page) {
  const post = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === "/api/compras/compras");
  await page.getByTestId("compras-salvar").click();
  const r = await post;
  expect(r.status(), "a API nova aceitou o corpo do web da base").toBe(201);
  const corpo = await r.json() as CorpoDoLancar;
  await expect(page, "depois do POST o web da base abre a consulta da compra salva").toHaveURL(new RegExp(`/compras/compras/${corpo.id}$`));
  return { corpo, enviado: r.request().postDataJSON() as Record<string, unknown> & { itens: Record<string, unknown>[] } };
}

test("OP01-F2 · K-2b (sentido 2) — a Central de Compras do web da base contra a API deste HEAD: 'Salvar' exato com a TOP Automática, o POST com as chaves de hoje, 201 confirmado e a consulta confirmada; DECLARADO: 'Salvo com sucesso' e o item ainda exigido com a TOP que permite (ou, com a base já na F2, 'Salvar e confirmar')", async ({ page }) => {
  const mundo = mundoDoWebDaBase();
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const c = await cenarioDaCompra(page);
  const automatica = await topNova(page, "compras.compra", { confirmacao: "automatica" });
  const permitido = await topNova(page, "compras.compra", { confirmacao: "manual", documentoSemItens: "permitido" });
  expect(await premissaDaApiDestaFase(page, cab, "compras", [automatica, permitido]), "premissa: a API deste HEAD declara as regras gerais de cada TOP")
    .toEqual([AUTOMATICA, PERMITIDO]);
  const v = vigiar(page);
  const salvar = page.getByTestId("compras-salvar");
  const consulta = page.getByTestId("compras-consulta-corpo");

  // (1) TOP AUTOMÁTICA: o web da base ignora a chave a mais; o corpo é o de hoje; a API nova confirma.
  await abrirCriacaoDeCompra(page, automatica, c, AUTOMATICA);
  await expect(salvar, `mundo ${mundo}: o nome acessível do Salvar do web da base com a TOP Automática, exato`).toHaveAttribute("aria-label", rotuloComAutomatica(mundo));
  await page.getByTestId(`${PC}-adicionar-item`).click();
  const linha = page.getByTestId(`${PC}-linha`).first();
  await escolherNaCelula(page, linha.getByTestId(`${PC}-produto`), c.nomeProduto);
  await escolherNaCelula(page, linha.getByTestId(`${PC}-armazem`), c.nomeArmazem);
  await linha.getByLabel("Quantidade do item 1").fill("5");
  await linha.getByLabel("Valor unitário do item 1").fill("20");
  await expect(page.getByTestId(`${PC}-subtotal`)).toContainText("100,00");
  const confirmada = await salvarCompra(page);
  expect(Object.keys(confirmada.enviado).sort(), "o POST do web da base leva as chaves de HOJE (a lista de CC-7)").toEqual(CHAVES_DO_POST_DA_COMPRA);
  expect(confirmada.enviado.itens.map((i) => Object.keys(i).sort()), "e o item, as de hoje").toEqual([CHAVES_DO_ITEM_DA_COMPRA]);
  expect(confirmada.enviado, "os valores que a tela mostrou").toMatchObject({ tipo_operacao_id: automatica, categoria_financeira_id: c.natureza.id, centro_custo_id: c.centro.id });
  expect(confirmada.enviado.itens[0], "o item que a tela mostrou").toMatchObject({ produto_id: c.produto, armazem_id: c.armazem });
  expect([confirmada.corpo["situacao"], confirmada.corpo.confirmacaoAutomatica], "a API nova confirmou no fim do POST").toEqual(["confirmado", { confirmado: true }]);
  await expect(aviso(page, "success"), `mundo ${mundo}: o aviso do web da base depois do POST que confirmou`).toHaveText([avisoDoPostQueConfirmou(mundo)]);
  await expect(avisos(page), "um aviso só").toHaveCount(1);
  if (mundo === "legado") declarar("o web da base diz \"Salvo com sucesso\" depois do POST que CONFIRMOU a compra (ele não lê `confirmacaoAutomatica`); a consulta, que lê o documento, mostra a compra confirmada");
  await expect(consulta, "a consulta do web da base mostra a compra confirmada").toHaveAttribute("data-situacao", "confirmado");
  expect((await api<{ situacao: string }>(page, "GET", `/api/compras/compras/${confirmada.corpo.id}`)).situacao, "no servidor também").toBe("confirmado");

  // (2) TOP QUE PERMITE DOCUMENTO SEM ITENS: a API declara que aceitaria; o web da base decide pelo que conhece.
  const posts: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && caminho(r) === "/api/compras/compras") posts.push(r.url()); });
  await abrirCriacaoDeCompra(page, permitido, c, PERMITIDO);
  await expect(page.getByTestId(`${PC}-linha`), "premissa: nenhuma linha de item").toHaveCount(0);
  await expect(salvar, "TOP Manual: 'Salvar' nos dois mundos").toHaveAttribute("aria-label", "Salvar");
  if (mundo === "legado") {
    await salvar.click();
    const pilula = page.getByTestId(`${PC}-pendencias`);
    await expect(pilula, "o clique sem item mostra a pílula de pendências").toBeVisible();
    const lista = page.getByTestId(`${PC}-pendencias-lista`);
    if (!(await lista.isVisible())) await pilula.click();
    await expect(lista).toBeVisible();
    const semItens = lista.locator(`[data-testid="${PC}-pendencia"][data-caminho="itens"]`);
    await expect(semItens, "o web da base ainda pede item").toHaveCount(1);
    await expect(semItens).toContainText("Inclua ao menos um item.");
    await expect(page, "o clique com pendência não sai da criação").toHaveURL(/\/compras\/compras\/new\?/);
    expect(posts, "ZERO POST: o web da base não envia compra sem itens").toEqual([]);
    declarar("com a TOP que permite documento sem itens (a API deste HEAD declara `aceitaSemItens: true` e aceitaria), a Central de Compras da base ainda pede ao menos um item e não envia nada");
  } else {
    const vazia = await salvarCompra(page);
    expect(vazia.enviado.itens, "o POST levou a compra sem itens").toEqual([]);
    expect(posts, "um POST, o desta compra").toHaveLength(1);
    await expect(consulta, "a consulta mostra a compra aberta").toHaveAttribute("data-situacao", "aberto");
    expect((await api<{ itens: unknown[] }>(page, "GET", `/api/compras/compras/${vazia.corpo.id}`)).itens, "no servidor: sem itens").toEqual([]);
  }
  v.semBloqueio();
  v.semErroDeContrato();
});
