import type { Locator, Page, Request, Response } from "@playwright/test";
import { login, api, uniq, pickRef, preencherClassificacaoFinanceira } from "./helpers";
import { cabecalhosDaSessao } from "./top-config-08-comum";
import { test, expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed } from "./central-compras-fixtures";
import {
  CAPACIDADE_DECLARADA, MSG_ROTA_NAO_ENCONTRADA, PORTA_DA_PESQUISA, PORTA_DA_PESQUISA_DE_HOJE, PORTA_DAS_CAPACIDADES_DA_PESQUISA,
  cenarioDaPesquisa, mundoDaPesquisaNaBase, vigiar, type CenarioDaPesquisa, type Mundo
} from "./operacoes-01-f3b-skew-comum";

/**
 * OPERACOES-01 · F3b (decisão 280) · K-1, SENTIDO 1 — O WEB DESTE HEAD CONTRA A API DA BASE (a janela "web antes da
 * API" da DEPLOYMENT, e a reversão só da API).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 1 roda em `playwright.skew.config.ts`, cujo `testMatch` é
 * `/skew-api-producao\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o `playwright.config.ts` comum
 * ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (lá a API seria a deste HEAD e o caso ficaria
 * verde por vacuidade). O caso não foi acrescentado em `skew-api-producao.spec.ts` porque aquele arquivo é
 * compartilhado com as fases que correm em paralelo: o arquivo próprio não colide com nenhuma. Sem `scripts/lib` e sem
 * passo no CI: o arquivo entra pelo nome. A prova de que cada config o enxerga do jeito certo é o `--list` de cada uma
 * (relatório da fase), e a identidade da árvore da base é a do caso IDENTIDADE de `skew-api-producao.spec.ts`.
 *
 * O MUNDO É PERGUNTADO À BASE NA HORA (`mundoDaPesquisaNaBase`, em `operacoes-01-f3b-skew-comum.ts`): a declaração
 * `GET /api/produtos/pesquisa/capacidades` e o parâmetro `pagina` da pesquisa — as duas portas da F3b, que nascem no
 * MESMO binário (uma sem a outra reprova). Os dois ramos cobram prova POSITIVA; nenhum deles só passa:
 *   · MUNDO LEGADO (a base de hoje, sem a F3b): a pergunta da capacidade que a PRÓPRIA tela faz recebe, no fio, a 404 de
 *     rota, e a pesquisa de produto é a de HOJE — `data-fonte="opcoes"`, Código | Descrição, sem a coluna Estoque e sem
 *     "Só com saldo neste local"; no fio, ao menos um pedido a `/api/resources/products/options` e NENHUM a
 *     `/api/produtos/pesquisa` (nem parâmetro novo, que a base recusaria com 422); o produto sem saldo APARECE (a
 *     pesquisa de hoje não filtra). A ordem das colunas é a do layout que a BASE manda (Produto antes do Local de
 *     estoque): o web não impõe a ordem nova sobre o layout. O "Local de estoque" do cabeçalho existe (é só da tela; a
 *     base serve os locais da empresa), a linha nova nasce com ele, e o POST leva as chaves de HOJE, chave por chave —
 *     a base grava (201);
 *   · MUNDO NOVO (a base já com a F3b, depois do merge): `data-fonte="pesquisa"`, o pedido com o local DA LINHA e — na
 *     venda — `com_saldo=true` (o produto sem saldo some); na compra, tudo, com o saldo; e ZERO pedido à pesquisa de hoje.
 * Em todos, nenhuma requisição morre no navegador (`semBloqueio`). Não há mock: o servidor é o binário da base,
 * servindo o banco migrado e semeado por este HEAD. As TOPs, os cadastros e o saldo nascem PELA API DA BASE (as portas
 * de `central-compras-fixtures`, com a exclusão lógica no fim do caso, passou ou falhou; o estoque inicial por
 * `POST /api/stock/opening-balances`); a venda que termina aberta é cancelada no fim. Os documentos ficam (o ledger é
 * imutável). A TOP nasce SEM configuração (o neutro do binário que a grava): nenhuma forma deste HEAD vai à base.
 */

const PV = "central-vendas";
const PC = "central-compras";
const caminho = (r: Request | Response) => new URL(r.url()).pathname;
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

/**
 * AS CHAVES DO POST DE HOJE, conjunto EXATO (igualdade, não "contém": uma chave nova — o local do cabeçalho, por
 * exemplo — passaria despercebida num "contém"). Venda: a lista de W4 (`central-vendas-workspace.spec.ts`), com a
 * classificação financeira e sem condição de pagamento (a TOP do caso não tem padrão). Compra: a lista de CC-7
 * (`central-compras-desenho-b.spec.ts`).
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

type Venda = { id: string; status: string; items: { product_id: string; warehouse_id: string | null }[] };
type PaginaNoFio = { itens: { id: string; estoque: string | null }[]; estoqueDoArmazem: boolean; filtradoPorSaldo: boolean };

/** Os pedidos (GET) às três portas da pesquisa de produto, pelo caminho EXATO, enquanto o caso corre. */
function ouvirPesquisas(page: Page) {
  const fio = { nova: [] as URL[], deHoje: [] as URL[], capacidades: [] as URL[] };
  page.on("request", (r) => {
    if (r.method() !== "GET") return;
    const u = new URL(r.url());
    if (u.pathname === PORTA_DA_PESQUISA) fio.nova.push(u);
    else if (u.pathname === PORTA_DA_PESQUISA_DE_HOJE) fio.deHoje.push(u);
    else if (u.pathname === PORTA_DAS_CAPACIDADES_DA_PESQUISA) fio.capacidades.push(u);
  });
  return fio;
}

/** A resposta à pergunta da capacidade que a PRÓPRIA tela faz (o ouvinte nasce antes da navegação). */
const capacidadeNoFio = (page: Page) => page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === PORTA_DAS_CAPACIDADES_DA_PESQUISA);
/** O layout efetivo que a tela pede para a TOP (o ouvinte nasce antes da navegação). */
const layoutNoFio = (page: Page, porta: string, top: string) => page.waitForResponse((r) => r.request().method() === "GET"
  && caminho(r) === porta && new URL(r.url()).searchParams.get("tipo_operacao_id") === top);

/** A pergunta da capacidade, no fio, conferida contra o mundo: a 404 de rota no legado, a declaração no novo. */
async function conferirCapacidadeNoFio(r: Response, mundo: Mundo) {
  const corpo = await r.json() as Record<string, unknown> & { error?: unknown };
  if (mundo === "legado") {
    expect([r.status(), corpo.error], "a tela perguntou a capacidade e a base respondeu a 404 de ROTA (chegou no fio, não morreu)")
      .toEqual([404, { code: "NOT_FOUND", message: MSG_ROTA_NAO_ENCONTRADA }]);
  } else {
    expect([r.status(), corpo], "a tela perguntou a capacidade e a base a declarou").toEqual([200, CAPACIDADE_DECLARADA]);
  }
}

/** Os campos de `estrutura.itens` que a base mandou em `layout-efetivo`. */
async function camposDoLayoutDaBase(r: Response): Promise<string[]> {
  expect(r.status(), "a base respondeu o layout efetivo da TOP").toBe(200);
  const corpo = await r.json() as { estrutura?: { itens?: { campo: string }[] } };
  const campos = (corpo.estrutura?.itens ?? []).map((c) => c.campo);
  expect(campos.length, "premissa: a base mandou os itens do layout").toBeGreaterThan(0);
  return campos;
}

/** Escolhe num RefSelect (o invólucro do campo) pelo nome — o painel do Radix, o último aberto. */
async function escolherNoCampo(page: Page, campo: Locator, nome: string) {
  await campo.locator("button").first().click();
  const painel = page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nome.slice(0, 20));
  await painel.getByRole("option", { name: literal(nome.slice(0, 20)) }).first().click();
  await expect(campo, "o campo mostra a escolha").toContainText(nome);
}

/** As descrições das opções do painel, na ordem da tela (pela coluna, não pela posição). */
const descricoes = (painel: Locator) => painel.getByRole("option").locator('[data-coluna="descricao"]').allInnerTexts();
/** Os avisos (toasts) na tela. */
const avisos = (page: Page) => page.locator("[data-sonner-toast]");

/**
 * A pesquisa de produto da LINHA, aberta e com o TAG digitado, conferida contra o mundo e o sentido da Central. Devolve
 * o painel aberto (quem chama escolhe o produto). Legado: a de HOJE (`/options`), os três produtos (sem filtro de
 * saldo), Código | Descrição, sem Estoque e sem o controle. Novo: a pesquisa nova pelo local da linha — na SAÍDA com
 * `com_saldo=true` (P2, sem saldo, some); na ENTRADA tudo, com o saldo.
 */
async function pesquisarProdutoDaLinha(page: Page, prefixo: string, celula: Locator, c: CenarioDaPesquisa, mundo: Mundo, sentido: "saida" | "entrada") {
  await celula.click();
  const painel = page.getByTestId(`${prefixo}-pesquisa`);
  await expect(painel).toBeVisible();
  await expect(painel, `mundo ${mundo}: a fonte da pesquisa de produto`).toHaveAttribute("data-fonte", mundo === "novo" ? "pesquisa" : "opcoes");
  const resposta = page.waitForResponse((r) => {
    const u = new URL(r.url());
    if (r.request().method() !== "GET") return false;
    return mundo === "novo" ? u.pathname === PORTA_DA_PESQUISA && u.searchParams.get("busca") === c.tag
      : u.pathname === PORTA_DA_PESQUISA_DE_HOJE && u.searchParams.get("search") === c.tag;
  });
  await painel.getByRole("combobox").fill(c.tag);
  const r = await resposta;
  expect(r.status(), "a base respondeu a pesquisa").toBe(200);
  const controle = page.getByTestId(`${prefixo}-pesquisa-so-com-saldo`);
  if (mundo === "legado") {
    const opcoes = await r.json() as { id: string }[];
    expect(opcoes.map((o) => o.id), "a pesquisa de hoje não filtra por saldo: os três, P2 (sem saldo) também").toEqual([c.p1.id, c.p2.id, c.p3.id]);
    await expect.poll(() => descricoes(painel), { message: "a tela mostra o que a base respondeu" }).toEqual([c.p1.nome, c.p2.nome, c.p3.nome]);
    await expect(painel.locator("[aria-hidden] > [data-coluna]"), "o cabeçalho de hoje: Código | Descrição").toHaveText(["Código", "Descrição"]);
    await expect(painel.locator('[data-coluna="estoque"]'), "sem a coluna Estoque").toHaveCount(0);
    await expect(controle, "sem 'Só com saldo neste local'").toHaveCount(0);
  } else {
    const pagina = await r.json() as PaginaNoFio;
    const pedido = new URL(r.url()).searchParams;
    expect(pedido.get("armazem_id"), "a pesquisa nova vai pelo local DA LINHA").toBe(c.l1.id);
    if (sentido === "saida") {
      expect([pedido.get("com_saldo"), pagina.filtradoPorSaldo], "a saída pede e recebe o filtro").toEqual(["true", true]);
      expect(pagina.itens.map((i) => i.id), "só com saldo no local (e o que não controla estoque)").toEqual([c.p1.id, c.p3.id]);
      await expect.poll(() => descricoes(painel)).toEqual([c.p1.nome, c.p3.nome]);
      await expect(controle.getByRole("checkbox"), "'Só com saldo neste local' marcado").toBeChecked();
    } else {
      expect([pedido.has("com_saldo"), pagina.filtradoPorSaldo], "a entrada não pede o filtro").toEqual([false, false]);
      expect(pagina.itens.map((i) => [i.id, i.estoque]), "tudo, com o saldo do local").toEqual([[c.p1.id, "5.0000"], [c.p2.id, "0.0000"], [c.p3.id, "0.0000"]]);
      await expect.poll(() => descricoes(painel)).toEqual([c.p1.nome, c.p2.nome, c.p3.nome]);
      await expect(controle, "a entrada não tem 'Só com saldo neste local'").toHaveCount(0);
    }
    await expect(painel.locator("[aria-hidden] > [data-coluna]"), "o cabeçalho com a coluna Estoque").toHaveText(["Código", "Descrição", "Estoque"]);
  }
  return painel;
}

/** O fio da pesquisa no fim do caso, conferido contra o mundo (a tela só fala com a fonte que o mundo lhe dá). */
function conferirFio(fio: ReturnType<typeof ouvirPesquisas>, c: CenarioDaPesquisa, mundo: Mundo) {
  expect(fio.capacidades.length, "a tela perguntou a capacidade à API no ar").toBeGreaterThan(0);
  if (mundo === "legado") {
    expect(fio.deHoje.some((u) => u.searchParams.get("search") === c.tag), "ao menos um pedido à pesquisa de HOJE, com a busca digitada").toBe(true);
    expect(fio.nova.map(String), "NENHUM pedido a /api/produtos/pesquisa (a base recusaria os parâmetros novos)").toEqual([]);
  } else {
    expect(fio.nova.length, "a pesquisa nova foi pedida").toBeGreaterThan(0);
    expect(fio.deHoje.map(String), "ZERO pedido à pesquisa de hoje").toEqual([]);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K-1a · A CENTRAL DE VENDAS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

const vendaNoServidor = (page: Page, id: string) => api<Venda>(page, "GET", `/api/sales/sales/${id}`);

/** A venda que ficou aberta é cancelada no fim (fora da fila de quem roda depois). */
async function cancelarAbertas(page: Page, vendas: string[]) {
  for (const id of vendas) {
    const v = await vendaNoServidor(page, id).catch(() => null);
    if (v && ["open", "approved"].includes(v.status)) await api(page, "POST", `/api/sales/sales/${id}/cancel`, {}).catch(() => undefined);
  }
}

test("OP01-F3b · K-1a (sentido 1) — a Central de Vendas deste web sobre a API da base: sem a capacidade, a pesquisa de produto de HOJE (404 de rota no fio, `/options`, sem Estoque nem filtro, ZERO pedido à rota nova), a grade na ordem do layout da BASE, o Local de estoque do cabeçalho na linha nova e o POST de hoje (201); com a capacidade, a pesquisa nova só com saldo", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const vendas: string[] = [];
  try {
    const mundo = await mundoDaPesquisaNaBase(page, cab);
    const c = await cenarioDaPesquisa(page, "K1a");
    const { id: top } = await criarTop(page, { codigo: codigoTop("f3k1"), codigoBase: "vendas.venda", nome: uniq("F3b K-1 venda") });
    const cliente = uniq("Cliente F3bK1");
    await criarCadastro(page, "people", { name: cliente, person_type: "legal", is_client: true });

    const fio = ouvirPesquisas(page);
    const capacidade = capacidadeNoFio(page);
    const layout = layoutNoFio(page, "/api/sales/sales/layout-efetivo", top);
    await page.goto(`/vendas/sales/new?tipo_operacao_id=${top}`);
    await expect(page.getByTestId("top-contexto"), "a Central abriu o formulário desta TOP").toBeVisible();
    await conferirCapacidadeNoFio(await capacidade, mundo);

    // A ORDEM DAS COLUNAS é a do layout que a BASE mandou — no legado, Produto antes do Local de estoque (a ordem nova
    // do motor não passa por cima do layout)
    const camposDaBase = await camposDoLayoutDaBase(await layout);
    const [iProduto, iLocal] = [camposDaBase.indexOf("product_id"), camposDaBase.indexOf("warehouse_id")];
    expect([iProduto >= 0, iLocal >= 0], "premissa: o layout da base desenha o Produto e o Local de estoque").toEqual([true, true]);
    expect(iLocal < iProduto, `mundo ${mundo}: o layout do sistema da base põe o Local ${mundo === "novo" ? "antes" : "depois"} do Produto`).toBe(mundo === "novo");
    const desenhadas = () => page.getByTestId(`${PV}-grade`).locator("thead th[data-campo]").evaluateAll((ths) => ths.map((th) => th.getAttribute("data-campo")));
    await expect.poll(desenhadas, { message: "a grade desenha exatamente os itens do layout da base, na ordem dele" }).toEqual(camposDaBase);

    // O LOCAL DE ESTOQUE DO CABEÇALHO: existe (estado da tela), a base serve os locais da empresa, a linha nova nasce com ele
    const localPadrao = page.getByTestId(`${PV}-local-padrao`);
    await expect(localPadrao).toContainText("Local de estoque");
    await escolherNoCampo(page, localPadrao, c.l1.nome);
    await page.getByTestId(`${PV}-adicionar-item`).click();
    const linha = page.getByTestId(`${PV}-linha`).first();
    await expect(page.getByTestId(`${PV}-linha`)).toHaveCount(1);
    await expect(linha.getByTestId(`${PV}-armazem`), "a linha nova nasceu com o Local de estoque do cabeçalho").toContainText(c.l1.nome);

    // A PESQUISA DE PRODUTO da linha (saída)
    const painel = await pesquisarProdutoDaLinha(page, PV, linha.getByTestId(`${PV}-produto`), c, mundo, "saida");
    await painel.getByRole("option").filter({ hasText: c.p1.nome }).click();
    await expect(painel).toHaveCount(0);
    await expect(linha.getByTestId(`${PV}-produto`)).toContainText(c.p1.nome);
    await expect(avisos(page), "nenhum aviso pela pergunta que a base não conhece").toHaveCount(0);
    conferirFio(fio, c, mundo);

    await linha.getByLabel("Quantidade do item 1").fill("1");
    await linha.getByLabel("Valor unitário do item 1").fill("10");
    await pickRef(page, "Cliente", cliente);
    await preencherClassificacaoFinanceira(page);

    // O POST: as chaves de HOJE, chave por chave; o local do cabeçalho só aparece DENTRO do item; a base grava (201)
    const post = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === "/api/sales/sales");
    await page.getByTestId(`${PV}-salvar`).click();
    const r = await post;
    expect(r.status(), "a base criou a venda").toBe(201);
    const { id } = await r.json() as { id: string };
    vendas.push(id);
    const enviado = r.request().postDataJSON() as Record<string, unknown> & { items: Record<string, unknown>[] };
    expect(Object.keys(enviado).sort(), "o POST leva as chaves de HOJE (a lista de W4): nenhuma chave de local no cabeçalho").toEqual(CHAVES_DO_POST_DA_VENDA);
    expect(enviado.items.map((i) => Object.keys(i).sort()), "e o item, as de hoje").toEqual([CHAVES_DO_ITEM_DA_VENDA]);
    expect(enviado.items[0], "o item: o produto escolhido e o local que a linha recebeu do cabeçalho").toMatchObject({ product_id: c.p1.id, warehouse_id: c.l1.id });
    expect(JSON.stringify(enviado).split(c.l1.id).length - 1, "o id do local aparece UMA vez no corpo: no item").toBe(1);
    await expect(page, "depois do POST a Central abre a consulta do documento salvo").toHaveURL(new RegExp(`/vendas/sales/${id}$`));
    expect((await vendaNoServidor(page, id)).items.map((i) => [i.product_id, i.warehouse_id]), "a base gravou o item com o local da linha").toEqual([[c.p1.id, c.l1.id]]);
    v.semBloqueio();
  } finally {
    await cancelarAbertas(page, vendas);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K-1b · A CENTRAL DE COMPRAS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

/** O campo dos Dados principais pelo rótulo (nome escapado: nomes do seed têm colchetes). */
const campoPeloRotulo = (page: Page, rotulo: string) => page.getByTestId("compras-central").locator("label", { hasText: rotulo }).first().locator("..");

test("OP01-F3b · K-1b (sentido 1) — a Central de Compras deste web sobre a API da base: sem a capacidade, a pesquisa de produto de HOJE (404 de rota no fio, `/options`, sem Estoque, ZERO pedido à rota nova), a grade na ordem do layout da base, o Local de estoque do cabeçalho na linha nova e o POST de hoje (201); com a capacidade, a pesquisa nova com tudo e o saldo", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const mundo = await mundoDaPesquisaNaBase(page, cab);
  const c = await cenarioDaPesquisa(page, "K1b");
  const ref = await referenciasDoSeed(page);
  const { id: top } = await criarTop(page, { codigo: codigoTop("f3k1"), codigoBase: "compras.compra", nome: uniq("F3b K-1 compra") });
  const forn = await criarCadastro(page, "people", { name: uniq("F3bK1 forn"), person_type: "legal", is_provider: true });
  const fornecedor = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${forn.id}`))["name"]);

  const fio = ouvirPesquisas(page);
  const capacidade = capacidadeNoFio(page);
  const layout = layoutNoFio(page, "/api/compras/compras/layout-efetivo", top);
  await page.goto(`/compras/compras/new?tipo_operacao_id=${top}`);
  await expect(page.getByTestId("compras-central")).toHaveAttribute("data-especie", "compra");
  await expect(page.getByTestId("compras-salvar"), "o Salvar saiu da trava: as regras chegaram").toBeEnabled();
  await conferirCapacidadeNoFio(await capacidade, mundo);

  // A ORDEM DAS COLUNAS: as que o layout da base cita aparecem na ordem dele (o motor só acrescenta as que o catálogo
  // da compra não cita, na posição de sempre)
  const camposDaBase = await camposDoLayoutDaBase(await layout);
  expect(camposDaBase.indexOf("armazem_id") >= 0 && camposDaBase.indexOf("produto_id") >= 0, "premissa: o layout da base desenha o Local de estoque e o Produto").toBe(true);
  const lerDesenhadas = () => page.getByTestId("compras-itens").locator("thead th[data-campo]").evaluateAll((ths) => ths.map((th) => th.getAttribute("data-campo") ?? ""));
  await expect.poll(lerDesenhadas, { message: "premissa: a grade desenha o Local de estoque e o Produto" }).toEqual(expect.arrayContaining(["armazem_id", "produto_id"]));
  const desenhadas = await lerDesenhadas();
  expect(desenhadas.filter((x) => camposDaBase.includes(x)), "as colunas do layout da base, na ordem dele").toEqual(camposDaBase.filter((x) => desenhadas.includes(x)));

  // O LOCAL DE ESTOQUE DO CABEÇALHO e o cabeçalho do documento
  const localPadrao = page.getByTestId(`${PC}-local-padrao`);
  await expect(localPadrao).toContainText("Local de estoque");
  await escolherNoCampo(page, localPadrao, c.l1.nome);
  await escolherNoCampo(page, campoPeloRotulo(page, "Fornecedor"), fornecedor);
  await escolherNoCampo(page, campoPeloRotulo(page, "Natureza de despesa"), ref.natureza.label);
  await escolherNoCampo(page, campoPeloRotulo(page, "Centro de resultado"), ref.centro.label);
  await page.getByTestId(`${PC}-adicionar-item`).click();
  const linha = page.getByTestId(`${PC}-linha`).first();
  await expect(page.getByTestId(`${PC}-linha`)).toHaveCount(1);
  await expect(linha.getByTestId(`${PC}-armazem`), "a linha nova nasceu com o Local de estoque do cabeçalho").toContainText(c.l1.nome);

  // A PESQUISA DE PRODUTO da linha (entrada): P2, sem saldo
  const painel = await pesquisarProdutoDaLinha(page, PC, linha.getByTestId(`${PC}-produto`), c, mundo, "entrada");
  await painel.getByRole("option").filter({ hasText: c.p2.nome }).click();
  await expect(painel).toHaveCount(0);
  await expect(linha.getByTestId(`${PC}-produto`)).toContainText(c.p2.nome);
  await expect(avisos(page), "nenhum aviso pela pergunta que a base não conhece").toHaveCount(0);
  conferirFio(fio, c, mundo);
  await linha.getByLabel("Quantidade do item 1").fill("2");
  await linha.getByLabel("Valor unitário do item 1").fill("7");
  await expect(page.getByTestId(`${PC}-subtotal`)).toContainText("14,00");

  // O POST: as chaves de HOJE; o local do cabeçalho só DENTRO do item; a base grava (201)
  const post = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === "/api/compras/compras");
  await page.getByTestId("compras-salvar").click();
  const r = await post;
  expect(r.status(), "a base criou a compra").toBe(201);
  const { id } = await r.json() as { id: string };
  const enviado = r.request().postDataJSON() as Record<string, unknown> & { itens: Record<string, unknown>[] };
  expect(Object.keys(enviado).sort(), "o POST leva as chaves de HOJE (a lista de CC-7): nenhuma chave de local no cabeçalho").toEqual(CHAVES_DO_POST_DA_COMPRA);
  expect(enviado.itens.map((i) => Object.keys(i).sort()), "e o item, as de hoje").toEqual([CHAVES_DO_ITEM_DA_COMPRA]);
  expect(enviado.itens[0], "o item: o produto escolhido e o local que a linha recebeu do cabeçalho").toMatchObject({ produto_id: c.p2.id, armazem_id: c.l1.id });
  expect(JSON.stringify(enviado).split(c.l1.id).length - 1, "o id do local aparece UMA vez no corpo: no item").toBe(1);
  await expect(page, "depois do POST a Central abre a consulta da compra salva").toHaveURL(new RegExp(`/compras/compras/${id}$`));
  const gravada = await api<{ itens: { produto_id: string; armazem_id: string }[] }>(page, "GET", `/api/compras/compras/${id}`);
  expect(gravada.itens.map((i) => [i.produto_id, i.armazem_id]), "a base gravou o item com o local da linha").toEqual([[c.p2.id, c.l1.id]]);
  v.semBloqueio();
});
