import { test, expect, type Page, type Locator } from "@playwright/test";
import { login, api, uniq, abrirLancamentoDeVendas, escolherTopEContinuar, CLASSIFICACAO_DO_SEED } from "./helpers";

/**
 * SELETOR-01 (decisão 309) — CÓDIGO ANTES DO NOME NOS CADASTROS EM ÁRVORE.
 *
 * A porta de opções (`GET /api/resources/:key/options`) já manda `code`, `label` e — só nas árvores com código —
 * `caminho` ("1 RECEITAS › 1.01 Receitas da Pecuária › 1.01.001 Venda de Boi Gordo"). O seletor genérico (RefSelect)
 * passa a mostrar, na árvore, o CHIP do código (`cmd-option__code`, o mesmo de sempre) e o NOME; a cadeia sai da linha
 * e vai para o `title` (dica nativa) da opção e da caixa fechada. Fora da árvore, NADA muda — e isso também se prova
 * aqui (SEL-4a), porque o RefSelect é componente genérico.
 *
 * Seed: Natureza "1.01.001 Venda de Boi Gordo" sob "1.01 Receitas da Pecuária" sob "1 RECEITAS"; Centro de resultado
 * "1.01.001 Adm Geral" sob "1.01 Administração" (raiz). Telas REAIS: a venda (Central de Vendas — Natureza, Centro de
 * resultado, Cliente, Forma de pagamento) e a ficha Novo dos cadastros (o campo do superior; o seletor fixo "Analítica").
 *
 * SEL-1a Natureza: chip 1.01.001 + nome; a cadeia NÃO aparece no texto visível.
 * SEL-1b Natureza: a cadeia completa e exata no `title` da opção.
 * SEL-1c Centro de resultado: o mesmo (chip + nome; cadeia no `title`).
 * SEL-2a a caixa FECHADA, depois de escolher: chip + nome, sem a cadeia no texto; a cadeia no `title` da caixa.
 * SEL-3a nó RAIZ (sem ancestral): código + nome, nenhum "›" sobrando; `title` = "CÓD NOME".
 * SEL-3b opção com código nulo/vazio/só de espaços: só o nome, sem chip vazio — (a) Tipos de Documento (árvore SEM
 *        coluna de código: a porta manda `code` nulo e nenhum `caminho`); (b) Grupo de Produtos (a única árvore com
 *        `code` anulável — só no acervo, a API não cria nó sem código), pela resposta INTERCEPTADA da porta de opções
 *        (um nó com `code` nulo, um com `code` vazio e um com `code` só de espaços, com o `caminho` que o servidor
 *        calcularia), na lista e na caixa fechada.
 * SEL-4a NÃO-REGRESSÃO: seletor SEM árvore idêntico ao da main — Cliente (com código: chip + nome, sem `title`) e Forma
 *        de pagamento (sem código: só o nome); caixa fechada = SÓ o texto do nome, sem chip e sem `title`; o seletor de
 *        opções fixas (MgSelect) não ganhou `title`.
 * SEL-4b NÃO-REGRESSÃO da busca: em Natureza, "1.01" filtra pelo código (prefixo) — a resposta e a tela conferem.
 * SEL-5a dois nós de NOMES IGUAIS em pais diferentes: o chip (código) e o `title` os distinguem.
 *
 * Reversas da fatia: R1 voltar `code: o.caminho ? undefined : o.code` → SEL-1a vermelho; R2 voltar `label: o.caminho ||
 * o.label` → SEL-1a vermelho; R3 tirar o `title` da opção → SEL-1b vermelho; R4 tirar o `trim` do código da lista
 * (`code: o.code`) → SEL-3b vermelho (chip de espaços na lista); R5 tirar o `trim` da caixa → SEL-3b vermelho.
 */

type Opcao = { id: string; label: string; code: string | null; caminho?: string | null; kind?: string | null };

const NATUREZA = { ...CLASSIFICACAO_DO_SEED.categoria, caminho: "1 RECEITAS › 1.01 Receitas da Pecuária › 1.01.001 Venda de Boi Gordo" } as const;
const CENTRO = { ...CLASSIFICACAO_DO_SEED.centro, caminho: "1.01 Administração › 1.01.001 Adm Geral" } as const;
const PAINEL = "[data-radix-popper-content-wrapper]";

const escapar = (texto: string) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Texto como sai no `innerHTML` de um nó de texto (o que o React escreve para um rótulo). */
const comoHtml = (texto: string) => texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ /g, "&nbsp;");
/** O mesmo `concat_ws(' ', code, nome)` do servidor (caminhosNaArvore): pula só o NULO — o vazio entra. */
const comoConcatWs = (code: string | null, nome: string) => [code, nome].filter((x) => x !== null).join(" ");

/** O campo (rótulo + controle) pelo texto EXATO do rótulo — o " *" de obrigatório pode vir junto. */
const campo = (page: Page, rotulo: string) => page.locator("label").filter({ hasText: new RegExp(`^${escapar(rotulo)}( \\*)?$`) }).first().locator("..");
/** A caixa fechada do seletor (o botão `role="combobox"` do CmdDisplay). */
const caixa = (c: Locator) => c.getByRole("combobox").first();
/** A opção cujo NOME (o `span.truncate`) é exatamente `nome`. */
const opcaoPeloNome = (page: Page, painel: Locator, nome: string) => painel.getByRole("option").filter({ has: page.locator(".truncate", { hasText: new RegExp(`^${escapar(nome)}$`) }) });
/** A opção cujo CHIP de código é exatamente `codigo`. */
const opcaoPeloCodigo = (page: Page, painel: Locator, codigo: string) => painel.getByRole("option").filter({ has: page.locator(".cmd-option__code", { hasText: new RegExp(`^${escapar(codigo)}$`) }) });

/** Venda nova (Central de Vendas) com uma TOP própria, como o AR-3. */
async function abrirVenda(page: Page) {
  const codigo = `5${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const top = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase: "vendas.venda", nome: uniq("SEL Venda") });
  await abrirLancamentoDeVendas(page, "sales");
  await escolherTopEContinuar(page, top.id);
}

/**
 * Abre o seletor do campo e pesquisa `termo`. Devolve o painel e o corpo da MESMA resposta que a tela recebeu
 * (`/api/resources/<recurso>/options?search=<termo>`) — a tela é conferida contra o que o servidor mandou.
 */
async function pesquisar(page: Page, c: Locator, recurso: string, termo: string) {
  await caixa(c).click();
  const painel = page.locator(PAINEL).last();
  const entrada = painel.getByPlaceholder(/^Pesquisar/).first();
  await expect(entrada, "o painel de pesquisa abriu").toBeVisible();
  const resposta = page.waitForResponse((r) => {
    const u = new URL(r.url());
    return r.request().method() === "GET" && u.pathname === `/api/resources/${recurso}/options` && u.searchParams.get("search") === termo;
  });
  await entrada.fill(termo);
  const r = await resposta;
  expect(r.status(), `GET /api/resources/${recurso}/options?search=${termo}`).toBe(200);
  return { painel, corpo: (await r.json()) as Opcao[], url: new URL(r.url()) };
}

/** Os nomes de classe dos filhos, na ordem do DOM: prova que o chip vem ANTES do nome (e que não há outro filho). */
const filhos = (l: Locator) => l.evaluate((e) => Array.from(e.children).map((c) => c.className));

test("SEL-1a — Natureza (venda): a opção mostra o chip 1.01.001 e o nome, sem a cadeia de ancestrais no texto", async ({ page }) => {
  await login(page);
  await abrirVenda(page);
  const { painel, corpo } = await pesquisar(page, campo(page, "Natureza"), "financial_categories", "Boi Gordo");
  // premissa: a porta manda código, nome e caminho SEPARADOS (nada mudou no servidor), e há um só resultado
  expect(corpo.map((o) => [o.code, o.label, o.caminho]), "premissa: a resposta da porta de opções").toEqual([[NATUREZA.codigo, NATUREZA.nome, NATUREZA.caminho]]);
  const opcoes = painel.getByRole("option");
  await expect(opcoes).toHaveCount(1);
  const opcao = opcoes.first();
  const chip = opcao.locator(".cmd-option__code");
  await expect(chip, "o chip do código existe na árvore").toHaveCount(1);
  await expect(chip).toHaveText(NATUREZA.codigo);
  await expect(opcao.locator(".truncate"), "o nome — não a cadeia").toHaveText(NATUREZA.nome);
  await expect(opcao, "o texto visível é chip + nome, exatamente").toHaveText(`${NATUREZA.codigo}${NATUREZA.nome}`);
  for (const pedaco of ["›", "1 RECEITAS", "Receitas da Pecuária"]) await expect(opcao, `a cadeia não aparece no texto: "${pedaco}"`).not.toContainText(pedaco);
  expect(await filhos(opcao), "o chip vem ANTES do nome").toEqual(["cmd-option__code", "truncate"]);
});

test("SEL-1b — Natureza (venda): a cadeia completa e exata está no title da opção", async ({ page }) => {
  await login(page);
  await abrirVenda(page);
  const { painel, corpo } = await pesquisar(page, campo(page, "Natureza"), "financial_categories", "Boi Gordo");
  expect(corpo.map((o) => o.caminho), "premissa: a porta manda a cadeia").toEqual([NATUREZA.caminho]);
  const opcoes = painel.getByRole("option");
  await expect(opcoes).toHaveCount(1);
  await expect(opcoes.first(), "a hierarquia continua consultável: a cadeia inteira no title").toHaveAttribute("title", NATUREZA.caminho);
});

test("SEL-1c — Centro de resultado (venda): chip 1.01.001 e o nome; a cadeia só no title", async ({ page }) => {
  await login(page);
  await abrirVenda(page);
  const { painel, corpo } = await pesquisar(page, campo(page, "Centro de resultado"), "cost_centers", CENTRO.nome);
  expect(corpo.map((o) => [o.code, o.label, o.caminho]), "premissa: a resposta da porta de opções").toEqual([[CENTRO.codigo, CENTRO.nome, CENTRO.caminho]]);
  const opcoes = painel.getByRole("option");
  await expect(opcoes).toHaveCount(1);
  const opcao = opcoes.first();
  await expect(opcao.locator(".cmd-option__code")).toHaveText(CENTRO.codigo);
  await expect(opcao.locator(".truncate")).toHaveText(CENTRO.nome);
  await expect(opcao).toHaveText(`${CENTRO.codigo}${CENTRO.nome}`);
  for (const pedaco of ["›", "Administração"]) await expect(opcao, `a cadeia não aparece no texto: "${pedaco}"`).not.toContainText(pedaco);
  expect(await filhos(opcao)).toEqual(["cmd-option__code", "truncate"]);
  await expect(opcao).toHaveAttribute("title", CENTRO.caminho);
});

test("SEL-2a — caixa FECHADA depois de escolher: chip + nome, sem a cadeia no texto; a cadeia no title da caixa", async ({ page }) => {
  await login(page);
  await abrirVenda(page);
  const casos = [
    { rotulo: "Natureza", recurso: "financial_categories", termo: "Boi Gordo", alvo: NATUREZA },
    { rotulo: "Centro de resultado", recurso: "cost_centers", termo: CENTRO.nome, alvo: CENTRO }
  ] as const;
  for (const { rotulo, recurso, termo, alvo } of casos) {
    const c = campo(page, rotulo);
    const { painel } = await pesquisar(page, c, recurso, termo);
    await opcaoPeloNome(page, painel, alvo.nome).click();
    await expect(painel.getByRole("listbox"), `${rotulo}: a lista fechou`).toBeHidden();
    const cx = caixa(c);
    await expect(cx.locator(".cmd-option__code"), `${rotulo}: o chip na caixa fechada`).toHaveText(alvo.codigo);
    await expect(cx.locator(".truncate"), `${rotulo}: o nome na caixa fechada`).toHaveText(alvo.nome);
    await expect(cx, `${rotulo}: a caixa mostra chip + nome, exatamente`).toHaveText(`${alvo.codigo}${alvo.nome}`);
    await expect(cx, `${rotulo}: a cadeia não está no texto da caixa`).not.toContainText("›");
    expect(await filhos(cx), `${rotulo}: o chip vem antes do nome`).toEqual([expect.stringMatching(/^cmd-option__code\b/), "truncate"]);
    await expect(cx, `${rotulo}: a cadeia no title da caixa`).toHaveAttribute("title", alvo.caminho);
  }
});

test("SEL-3a — nó RAIZ (sem ancestral): código + nome, nenhum separador sobrando; title = \"CÓD NOME\"", async ({ page }) => {
  await login(page);
  await page.goto("/cadastros/financial_categories/new");
  const c = campo(page, "Natureza superior");
  const { painel, corpo } = await pesquisar(page, c, "financial_categories", "RECEITAS");
  const raiz = corpo.find((o) => o.code === "1");
  // premissa: RECEITAS é RAIZ — a porta manda o caminho de UM nó só ("1 RECEITAS"), sem "›"
  expect(raiz && [raiz.label, raiz.caminho], "premissa: a raiz RECEITAS do seed e o seu caminho de um nó").toEqual(["RECEITAS", "1 RECEITAS"]);
  const opcao = opcaoPeloNome(page, painel, "RECEITAS");
  await expect(opcao).toHaveCount(1);
  await expect(opcao.locator(".cmd-option__code")).toHaveText("1");
  await expect(opcao, "código + nome, nada mais").toHaveText("1RECEITAS");
  await expect(opcao, "nenhum separador sobrando").not.toContainText("›");
  expect(await filhos(opcao)).toEqual(["cmd-option__code", "truncate"]);
  await expect(opcao, "o title da raiz é \"CÓD NOME\"").toHaveAttribute("title", "1 RECEITAS");
  // e a caixa fechada da raiz, depois de escolher
  await opcao.click();
  await expect(painel.getByRole("listbox")).toBeHidden();
  const cx = caixa(c);
  await expect(cx.locator(".cmd-option__code")).toHaveText("1");
  await expect(cx).toHaveText("1RECEITAS");
  await expect(cx).not.toContainText("›");
  await expect(cx).toHaveAttribute("title", "1 RECEITAS");
});

test("SEL-3b — opção com código nulo, vazio ou só de espaços: só o nome, SEM chip vazio", async ({ page }) => {
  await login(page);
  // (a) Tipos de Documento: árvore (parent_id) SEM coluna de código — a porta manda `code` nulo e nenhum `caminho`
  const pai = await api<{ id: string }>(page, "POST", "/api/resources/document_types", { name: uniq("Pasta SEL-3b"), position: 0 });
  const nomeFilho = uniq("Tipo filho SEL-3b");
  const filho = await api<{ id: string }>(page, "POST", "/api/resources/document_types", { name: nomeFilho, position: 0, parent_id: pai.id });
  await page.goto("/cadastros/document_types/new");
  const tipos = await pesquisar(page, campo(page, "Tipo superior"), "document_types", nomeFilho);
  const doFilho = tipos.corpo.find((o) => o.id === filho.id);
  expect(doFilho && { code: doFilho.code, label: doFilho.label, temCaminho: "caminho" in doFilho }, "premissa: code nulo e nenhum caminho na resposta")
    .toEqual({ code: null, label: nomeFilho, temCaminho: false });
  const opcaoTipo = opcaoPeloNome(page, tipos.painel, nomeFilho);
  await expect(opcaoTipo).toHaveCount(1);
  await expect(opcaoTipo.locator(".cmd-option__code"), "sem chip vazio").toHaveCount(0);
  await expect(opcaoTipo, "só o nome").toHaveText(nomeFilho);
  expect(await filhos(opcaoTipo)).toEqual(["truncate"]);
  expect(await opcaoTipo.getAttribute("title"), "sem caminho na resposta, sem title").toBeNull();
  await page.keyboard.press("Escape");

  // (b) Grupo de Produtos: a única árvore com `code` anulável (acervo, migration 0025) — a API não cria nó sem código,
  // então a resposta REAL da porta é interceptada: dois nós raiz ganham `code` nulo e `code` vazio, e um analítico
  // ganha `code` só de espaços (código em branco = sem código, como no `rotuloDaOpcao`), cada um com o `caminho` que o
  // servidor calcularia (`concat_ws(' ', code, nome)` no último elo da cadeia). O nó é achado pelo nome E pelo código
  // do seed: se a troca não acontecer, o chip do seed aparece e o teste reprova — não passa em vazio.
  const alterados = [
    { nome: "Insumos", doSeed: "1", code: null, pai: "" },
    { nome: "Produção", doSeed: "3", code: "", pai: "" },
    { nome: "Sanidade Animal", doSeed: "2.02", code: "   ", pai: "2 Pecuária › " }
  ].map((a) => ({ ...a, caminho: a.pai + comoConcatWs(a.code, a.nome) }));
  let interceptadas = 0;
  await page.route(/\/api\/resources\/product_groups\/options(\?|$)/, async (route) => {
    if (route.request().method() !== "GET") { await route.continue(); return; }
    const resposta = await route.fetch();
    const corpo = (await resposta.json()) as Opcao[];
    interceptadas += 1;
    await route.fulfill({ response: resposta, json: corpo.map((o) => { const a = alterados.find((x) => x.nome === o.label && x.doSeed === o.code); return a ? { ...o, code: a.code, caminho: a.caminho } : o; }) });
  });
  await page.goto("/cadastros/product_groups/new");
  const cGrupo = campo(page, "Grupo superior");
  await caixa(cGrupo).click();
  const painel = page.locator(PAINEL).last();
  await expect(opcaoPeloNome(page, painel, "Insumos")).toHaveCount(1);
  expect(interceptadas, "premissa: a lista veio da resposta interceptada").toBeGreaterThan(0);
  // premissa anti-vácuo: na MESMA lista, um nó com código continua com o chip
  await expect(opcaoPeloNome(page, painel, "Pecuária").locator(".cmd-option__code"), "nó com código: chip").toHaveText("2");
  for (const { nome, code, caminho } of alterados) {
    const opcao = opcaoPeloNome(page, painel, nome);
    await expect(opcao).toHaveCount(1);
    await expect(opcao.locator(".cmd-option__code"), `${nome} (code ${JSON.stringify(code)}): sem chip vazio`).toHaveCount(0);
    await expect(opcao, `${nome}: só o nome`).toHaveText(nome);
    expect(await filhos(opcao)).toEqual(["truncate"]);
    await expect(opcao, `${nome}: o caminho continua no title`).toHaveAttribute("title", caminho);
  }
  // a caixa fechada do nó sem código (nulo, vazio, só de espaços): só o nome, sem chip; o caminho no title
  const cx = caixa(cGrupo);
  for (const { nome, caminho } of alterados) {
    if (!(await painel.getByRole("listbox").isVisible())) await cx.click();
    await opcaoPeloNome(page, painel, nome).click();
    await expect(painel.getByRole("listbox")).toBeHidden();
    await expect(cx).toHaveText(nome);
    await expect(cx.locator(".cmd-option__code"), `caixa fechada de ${nome}: sem chip vazio`).toHaveCount(0);
    await expect(cx).toHaveAttribute("title", caminho);
  }
});

test("SEL-4a — NÃO-REGRESSÃO: seletor sem árvore idêntico ao da main (opção e caixa fechada); MgSelect sem title", async ({ page }) => {
  await login(page);
  // MgSelect (opções fixas): nenhum atributo novo na opção, o mesmo HTML de sempre
  await page.goto("/cadastros/financial_categories/new");
  await caixa(campo(page, "Analítica")).click();
  const fixas = page.locator(PAINEL).last().getByRole("option");
  await expect(fixas).toHaveCount(2);
  for (const rotulo of ["Sim", "Não"]) {
    const opcao = fixas.filter({ hasText: new RegExp(`^${rotulo}$`) });
    await expect(opcao).toHaveJSProperty("innerHTML", `<span class="truncate">${rotulo}</span>`);
    expect((await opcao.evaluate((e) => e.getAttributeNames())).sort(), `MgSelect "${rotulo}": sem title`).toEqual(["aria-selected", "class", "role", "type"]);
  }
  await page.keyboard.press("Escape");

  await abrirVenda(page);
  /**
   * O ESPERADO DA MAIN (CmdPanel/RefSelect em origin/main): opção = `<span class="cmd-option__code">CÓD</span>` só
   * quando há código, seguido de `<span class="truncate">NOME</span>`, e nenhum `title`; caixa fechada = o texto do
   * nome e nada mais (sem chip, sem `title`). Cliente (Parceiros) TEM código; Forma de pagamento NÃO tem a coluna.
   */
  const casos = [
    { rotulo: "Cliente", recurso: "people", termo: "Frigorífico", nome: "[DEMO] Frigorífico Boi Bom S.A.", comCodigo: true },
    { rotulo: "Forma de pagamento", recurso: "payment_methods", termo: "Pix", nome: "Pix", comCodigo: false }
  ] as const;
  for (const { rotulo, recurso, termo, nome, comCodigo } of casos) {
    const c = campo(page, rotulo);
    const { painel, corpo } = await pesquisar(page, c, recurso, termo);
    const daPorta = corpo.find((o) => o.label === nome);
    expect(daPorta, `premissa: ${rotulo} "${nome}" na resposta`).toBeTruthy();
    expect("caminho" in daPorta!, `premissa: ${rotulo} não é árvore (sem caminho)`).toBe(false);
    expect(Boolean(daPorta!.code), `premissa: ${rotulo} ${comCodigo ? "com" : "sem"} código`).toBe(comCodigo);
    const opcao = opcaoPeloNome(page, painel, nome);
    await expect(opcao).toHaveCount(1);
    const esperadoNaLista = `${comCodigo ? `<span class="cmd-option__code">${comoHtml(daPorta!.code!)}</span>` : ""}<span class="truncate">${comoHtml(nome)}</span>`;
    await expect(opcao, `${rotulo}: a opção é a da main`).toHaveJSProperty("innerHTML", esperadoNaLista);
    expect((await opcao.evaluate((e) => e.getAttributeNames())).sort(), `${rotulo}: a opção não ganhou title`).toEqual(["aria-selected", "class", "role", "type"]);
    await opcao.click();
    await expect(painel.getByRole("listbox")).toBeHidden();
    const cx = caixa(c);
    await expect(cx, `${rotulo}: a caixa fechada é SÓ o texto do nome (como na main)`).toHaveJSProperty("innerHTML", comoHtml(nome));
    await expect(cx).toHaveText(nome);
    await expect(cx.locator(".cmd-option__code"), `${rotulo}: sem chip na caixa fechada`).toHaveCount(0);
    expect(await cx.getAttribute("title"), `${rotulo}: a caixa fechada não ganhou title`).toBeNull();
  }
});

test("SEL-4b — NÃO-REGRESSÃO da busca: em Natureza, \"1.01\" filtra pelo código", async ({ page }) => {
  await login(page);
  await abrirVenda(page);
  const c = campo(page, "Natureza");
  // premissa anti-vácuo: sem busca, a lista oferece também o que NÃO começa por 1.01 (1.02.001 Venda de Soja)
  const semBusca = page.waitForResponse((r) => { const u = new URL(r.url()); return r.request().method() === "GET" && u.pathname === "/api/resources/financial_categories/options" && !u.searchParams.has("search"); });
  await caixa(c).click();
  const inicial = (await (await semBusca).json()) as Opcao[];
  expect(inicial.map((o) => o.code), "premissa: sem busca vem 1.02.001").toContain("1.02.001");
  const painel = page.locator(PAINEL).last();
  await expect(opcaoPeloCodigo(page, painel, "1.02.001")).toHaveCount(1);
  await page.keyboard.press("Escape");

  const { painel: filtrado, corpo, url } = await pesquisar(page, c, "financial_categories", "1.01");
  expect(url.searchParams.get("kind"), "o recorte do campo continua").toBe("analytic");
  expect(url.searchParams.get("nature")).toBe("income");
  const codigos = corpo.map((o) => o.code ?? "");
  expect(codigos, "a busca acha pelo código: 1.01.001 e 1.01.002 do seed").toEqual(expect.arrayContaining(["1.01.001", "1.01.002"]));
  expect(codigos.filter((x) => !x.startsWith("1.01")), "só volta código que começa por 1.01").toEqual([]);
  const opcoes = filtrado.getByRole("option");
  await expect(opcoes, "a tela mostra exatamente o que a busca devolveu").toHaveCount(corpo.length);
  expect((await filtrado.locator(".cmd-option__code").allTextContents()).sort(), "os chips na tela são os códigos devolvidos").toEqual([...codigos].sort());
  await expect(opcaoPeloCodigo(page, filtrado, "1.02.001"), "1.02.001 saiu da lista").toHaveCount(0);
});

test("SEL-5a — dois nós de NOMES IGUAIS em pais diferentes: o código (chip) e o title os distinguem", async ({ page }) => {
  await login(page);
  const nos = (await api<{ items: { id: string; code: string; name: string }[] }>(page, "GET", "/api/resources/financial_categories?pageSize=1000")).items;
  const pecuaria = nos.find((x) => x.code === "1.01"); const agricola = nos.find((x) => x.code === "1.02");
  expect(pecuaria && agricola && [pecuaria.name, agricola.name], "premissa: 1.01 e 1.02 do seed").toEqual(["Receitas da Pecuária", "Receitas Agrícolas"]);
  const nome = uniq("Gêmea SEL-5a");
  // o servidor gera o código (AJUSTES 01, D-1): o corpo vai sem `code`
  const a = await api<{ id: string; code: string }>(page, "POST", "/api/resources/financial_categories", { name: nome, nature: "income", kind: "analytic", parent_id: pecuaria!.id });
  const b = await api<{ id: string; code: string }>(page, "POST", "/api/resources/financial_categories", { name: nome, nature: "income", kind: "analytic", parent_id: agricola!.id });
  expect(a.code.startsWith("1.01.") && b.code.startsWith("1.02.") && a.code !== b.code, `premissa: códigos distintos (${a.code}, ${b.code})`).toBe(true);
  const esperado = new Map([
    [a.code, `1 RECEITAS › 1.01 Receitas da Pecuária › ${a.code} ${nome}`],
    [b.code, `1 RECEITAS › 1.02 Receitas Agrícolas › ${b.code} ${nome}`]
  ]);

  await abrirVenda(page);
  const { painel, corpo } = await pesquisar(page, campo(page, "Natureza"), "financial_categories", nome);
  expect(corpo.map((o) => [o.code, o.label, o.caminho]).sort(), "premissa: a porta devolve os dois, com o mesmo nome").toEqual([...esperado].map(([code, caminho]) => [code, nome, caminho]).sort());
  await expect(opcaoPeloNome(page, painel, nome), "os dois aparecem, com o MESMO nome visível").toHaveCount(2);
  for (const [codigo, caminho] of esperado) {
    const opcao = opcaoPeloCodigo(page, painel, codigo);
    await expect(opcao, `o chip ${codigo} distingue um deles`).toHaveCount(1);
    await expect(opcao).toHaveText(`${codigo}${nome}`);
    await expect(opcao, "a cadeia (pai diferente) no title").toHaveAttribute("title", caminho);
  }
});
