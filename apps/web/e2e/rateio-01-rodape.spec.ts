import type { Locator, Page, Response } from "@playwright/test";
import { login, api, uniq, empresaAtiva } from "./helpers";
import { test, expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed, type Opcao } from "./central-compras-fixtures";

/**
 * RATEIO-01 (decisão 316) — O RATEIO SAI DOS DADOS E VAI PARA O RODAPÉ · R01-1 a R01-4.
 *
 * ┌─ O QUE ESTE ARQUIVO PROVA ─────────────────────────────────────────────────────────────────────┐
 * │ R01-1 com a capacidade `importacaoXml`, a criação da COMPRA tem a aba "Rateio e classificação"   │
 * │       no painel, depois do Financeiro; os fiscais moram na aba Fiscal (fora dos Dados).          │
 * │ R01-2 a recusa do rateio ABRE a aba "Rateio e classificação", marca pendência e leva ao controle.│
 * │ R01-3 o CORPO do POST com fiscais, rateio e item imobilizado é BYTE A BYTE o de referência.      │
 * │ R01-4 SEM a capacidade: nenhuma aba de rateio/fiscal, e o corpo de hoje byte a byte.             │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Cada caso cria os PRÓPRIOS cadastros (fornecedor, local de estoque, produto, TOP) pela API, limpos no fim pela fixture;
 * as compras ficam (ledger; decisão 247). Natureza e centro do rateio vêm do seed pelo nome. O que vai no fio é lido no fio.
 */

const P = "central-compras";
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const caminho = (r: Response) => new URL(r.url()).pathname;
/** Os testids do rateio e da classificação dos itens (o que mudou de lugar). */
const DO_RATEIO = ["compras-rateio-e-itens", "compras-rateio", "compras-rateio-tipo", "compras-itens-classificacao", "compras-item-classificacao-0", "compras-item-0-gera-estoque", "compras-item-0-imobilizado"];
/** Testids fiscais (aba Fiscal + faixa de totais + Dados principais para tipo de documento). */
const FISCAIS_NO_PAINEL = ["compras-chave-acesso", "compras-uf-nota", "compras-valor-ipi", "compras-valor-icms-st"];
const ABA_RATEIO = "Rateio e classificação";

/* ═════════════════════════════════ fixtures ═════════════════════════════════ */

async function cenario(page: Page) {
  const empresa = await empresaAtiva(page);
  const { unidade: un, grupo, natureza, centro } = await referenciasDoSeed(page);
  const forn = await criarCadastro(page, "people", { name: uniq("R01 forn"), person_type: "legal", is_provider: true });
  const fornecedor = { id: forn.id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${forn.id}`))["name"]) };
  const arm = await criarCadastro(page, "warehouses", {
    empresa_id: empresa, initials: `R${Date.now().toString(36).slice(-4).toUpperCase()}`, description: uniq("R01 local"), type: "inputs"
  });
  const armazem = { id: arm.id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${arm.id}`))["description"]) };
  const prod = await criarCadastro(page, "products", { description: uniq("R01 prod"), group_id: grupo.id, measurement_id: un.id, financial_category_id: natureza.id });
  const produto = { id: prod.id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${prod.id}`))["description"]) };
  const topCompra = (await criarTop(page, { codigo: codigoTop("7"), codigoBase: "compras.compra", nome: uniq("Compra R01") })).id;
  return { empresa, natureza, centro, fornecedor, armazem, produto, topCompra };
}
type Cenario = Awaited<ReturnType<typeof cenario>>;

/**
 * RefSelect pelo rótulo, DENTRO de `raiz` (a central, uma linha do rateio). O controle mora DENTRO do rótulo (as linhas
 * do rateio) ou ao lado dele (o campo da Central, como no FC-1).
 */
async function escolherEm(page: Page, raiz: Locator, rotulo: string, nome: string) {
  const r = raiz.locator("label", { hasText: rotulo }).first();
  const dentro = r.locator("button");
  await ((await dentro.count()) > 0 ? dentro.first() : r.locator("..").locator("button").first()).click();
  const painel = page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nome.slice(0, 20));
  await painel.getByRole("option", { name: literal(nome.slice(0, 20)) }).first().click();
}

/** Seletor PADRÃO de lista fixa (MgSelect, sem cadastro): abre a caixa e escolhe a opção pelo rótulo. */
async function escolherNaLista(page: Page, gatilho: Locator, rotulo: string) {
  await gatilho.click();
  const painel = page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last();
  await painel.getByRole("option", { name: literal(rotulo) }).first().click();
}

/** Pesquisa do motor ancorada à célula (produto ou local de estoque) da linha. */
async function escolherNaCelula(page: Page, celula: Locator, nome: string) {
  await celula.click();
  const pesquisa = page.getByTestId(`${P}-pesquisa`);
  await expect(pesquisa).toBeVisible();
  await pesquisa.getByRole("combobox").fill(nome);
  await pesquisa.getByRole("option").filter({ hasText: nome }).first().click();
  await expect(pesquisa).toHaveCount(0);
}

/** A criação da compra com o fornecedor e um item de 2 × 50 (o cabeçalho sem natureza e centro: o rateio classifica). */
async function compraNaCentral(page: Page, c: Cenario) {
  await page.goto(`/compras/compras/new?tipo_operacao_id=${c.topCompra}`);
  const central = page.getByTestId("compras-central");
  await expect(central).toHaveAttribute("data-especie", "compra");
  await escolherEm(page, central, "Fornecedor", c.fornecedor.nome);
  await escolherEm(page, central, "Local de estoque", c.armazem.nome);
  await page.getByTestId(`${P}-adicionar-item`).click();
  const linha = page.getByTestId(`${P}-linha`).first();
  await escolherNaCelula(page, linha.getByTestId(`${P}-produto`), c.produto.nome);
  await linha.getByLabel("Quantidade do item 1").fill("2");
  await linha.getByLabel("Valor unitário do item 1").fill("50");
  await expect(page.getByTestId("compras-total"), "premissa: o total dos itens").toContainText("100,00");
}

const painel = (page: Page) => page.getByTestId(`${P}-painel`);
const dados = (page: Page) => page.getByTestId(`${P}-dados`);
const botaoDosAdicionais = (page: Page) => dados(page).getByRole("button", { name: /^Dados adicionais/ });
const nomesDasAbas = async (page: Page) => (await painel(page).getByRole("tab").allInnerTexts()).map((n) => n.replace(/\d+/g, "").trim());

/** A aba pelo rótulo — o nome acessível ganha " Com pendência" quando a aba leva o ponto. */
const aba = (page: Page, nome: string) => painel(page).getByRole("tab", { name: new RegExp(`^${nome}( Com pendência)?$`) });

async function abrirAba(page: Page, nome: string) {
  const alvo = aba(page, nome);
  await alvo.click();
  await expect(alvo).toHaveAttribute("aria-selected", "true");
}

/** A aba "Rateio e classificação" aberta; devolve o bloco do rateio (dentro do painel). */
async function abaDoRateio(page: Page): Promise<Locator> {
  await abrirAba(page, ABA_RATEIO);
  const bloco = painel(page).getByTestId("compras-rateio-e-itens");
  await expect(bloco, "o rateio está no painel, na aba Rateio e classificação").toBeVisible();
  return bloco;
}

const postDaCompra = (page: Page) => page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === "/api/compras/compras");
/** A data do documento que a Central semeia (`todayISO`: a data UTC). */
const hojeIso = () => new Date().toISOString().slice(0, 10);

/* ═════════════════════════════════ R01-1 ═════════════════════════════════ */

test("R01-1 — com importacaoXml, rateio na aba Rateio e classificação; fiscais na aba Fiscal (fora dos Dados)", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const portas = await api<{ capacidades?: Record<string, unknown> }>(page, "GET", "/api/compras/compras/operation-types");
  expect(portas.capacidades?.["importacaoXml"], "premissa: a API declara capacidades.importacaoXml = 1").toBe(1);
  await compraNaCentral(page, c);

  await expect.poll(() => nomesDasAbas(page), { message: "as abas da criação da compra" }).toEqual(
    expect.arrayContaining(["Financeiro", ABA_RATEIO, "Fiscal"])
  );
  await expect(botaoDosAdicionais(page), "sem acordeão Dados adicionais").toHaveCount(0);
  await expect(dados(page).getByTestId("compras-dados-fiscais"), "fiscais fora dos Dados principais").toHaveCount(0);
  for (const t of DO_RATEIO) await expect(dados(page).getByTestId(t), `${t}: nada do rateio nos Dados`).toHaveCount(0);
  await expect(dados(page).getByText("Rateio e itens"), "nem o título antigo do rateio").toHaveCount(0);

  const rateio = await abaDoRateio(page);
  for (const t of DO_RATEIO.slice(1)) await expect(rateio.getByTestId(t), `${t} na aba Rateio e classificação`).toHaveCount(1);
  for (const t of DO_RATEIO) await expect(page.getByTestId(t), `${t}: uma vez só na tela`).toHaveCount(1);
  await expect(rateio.getByTestId("compras-rateio-tipo"), "o rateio nasce o do documento").toContainText("Classificação única (documento)");
  await expect(rateio.getByTestId("compras-item-0-gera-estoque"), "o item nasce gerando estoque").toBeChecked();

  await abrirAba(page, "Fiscal");
  const fiscais = painel(page).getByTestId("compras-dados-fiscais");
  await expect(fiscais, "o bloco fiscal mora na aba Fiscal").toBeVisible();
  for (const t of FISCAIS_NO_PAINEL) await expect(fiscais.getByTestId(t), `${t} na aba Fiscal`).toHaveCount(1);
  await abrirAba(page, "Totais");
  await expect(page.getByTestId("compras-seguro"), "seguro nos Totais, junto do que compõe o valor").toHaveCount(1);
  await expect(dados(page).getByTestId("compras-tipo-documento-fiscal"), "tipo de documento nos Dados principais").toHaveCount(1);

  await abrirAba(page, ABA_RATEIO);
  await escolherNaLista(page, rateio.getByTestId("compras-rateio-tipo"), "Por valor");
  await expect(rateio.getByTestId("compras-rateio-linha-0")).toBeVisible();
  await rateio.getByTestId("compras-rateio-adicionar").click();
  await expect(rateio.getByTestId("compras-rateio-linha-1")).toBeVisible();
  await rateio.getByTestId("compras-rateio-linha-0-percentual").fill("60");
  await rateio.getByTestId("compras-rateio-linha-1-percentual").fill("40");
  await expect(rateio.getByTestId("compras-rateio-soma")).toHaveText("Soma: 100%");
  await expect(dados(page).locator('[data-testid^="compras-rateio-linha-"]'), "nenhuma linha do rateio nos Dados").toHaveCount(0);
  await escolherNaLista(page, rateio.getByTestId("compras-rateio-tipo"), "Por produto");
  const item = rateio.getByTestId("compras-item-classificacao-0");
  await expect(item.locator("label", { hasText: "Natureza de despesa do item" })).toBeVisible();
  await expect(item.locator("label", { hasText: "Centro de resultado do item" })).toBeVisible();
  await expect(dados(page).getByText("Natureza de despesa do item"), "a classificação do item nunca nos Dados").toHaveCount(0);
});

/* ═════════════════════════════════ R01-2 ═════════════════════════════════ */

test("R01-2 — a recusa do rateio ABRE a aba Rateio e classificação, com o painel recolhido, e leva ao controle", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  await compraNaCentral(page, c);

  let rateio = await abaDoRateio(page);
  await escolherNaLista(page, rateio.getByTestId("compras-rateio-tipo"), "Por valor");
  const linha = rateio.getByTestId("compras-rateio-linha-0");
  await escolherEm(page, linha, "Natureza", c.natureza.label);
  await escolherEm(page, linha, "Centro de resultado", c.centro.label);
  await linha.getByTestId("compras-rateio-linha-0-percentual").fill("90");
  await abrirAba(page, "Financeiro");
  await page.getByTestId(`${P}-recolher`).click();
  await expect(painel(page), "premissa: o painel recolhido").toHaveAttribute("data-recolhido", "true");
  await expect(botaoDosAdicionais(page), "premissa: sem acordeão Dados adicionais").toHaveCount(0);

  let post = postDaCompra(page);
  await page.getByTestId("compras-salvar").click();
  let resposta = await post;
  expect(resposta.status(), "o servidor recusa").toBe(422);
  let erro = ((await resposta.json()) as { error: { details?: { path: string; message: string }[] } }).error;
  expect(erro.details?.map((d) => d.path), "a recusa é no caminho do rateio").toEqual(["rateio"]);

  const abaRateio = aba(page, ABA_RATEIO);
  await expect(painel(page), "o painel EXPANDE").toHaveAttribute("data-recolhido", "false");
  await expect(abaRateio, "a aba Rateio e classificação ABRE sozinha").toHaveAttribute("aria-selected", "true");
  await expect(abaRateio.getByRole("img", { name: "Com pendência" }), "a aba leva o ponto da pendência").toHaveCount(1);
  rateio = painel(page).getByTestId("compras-rateio-e-itens");
  await expect(rateio.getByTestId("compras-rateio").locator('[data-parte="erro"]'), "a mensagem no Rateio").toContainText("precisa somar 100%");
  await expect(rateio.getByTestId("compras-rateio-tipo"), "o foco vai ao controle do Rateio").toBeFocused();
  await expect(botaoDosAdicionais(page), "continua sem acordeão (nada do rateio nos Dados)").toHaveCount(0);
  await expect(page).toHaveURL(/\/compras\/compras\/new\?/);

  await escolherNaLista(page, rateio.getByTestId("compras-rateio-tipo"), "Por produto");
  await abrirAba(page, "Financeiro");
  await page.getByTestId(`${P}-recolher`).click();
  await expect(painel(page), "premissa: o painel recolhido de novo").toHaveAttribute("data-recolhido", "true");
  post = postDaCompra(page);
  await page.getByTestId("compras-salvar").click();
  resposta = await post;
  expect(resposta.status(), "o servidor recusa").toBe(422);
  erro = ((await resposta.json()) as { error: { details?: { path: string; message: string }[] } }).error;
  expect(erro.details?.map((d) => d.path), "a recusa é na classificação do item 1").toEqual(["itens[0].categoria_financeira_id"]);
  await expect(painel(page), "o painel EXPANDE").toHaveAttribute("data-recolhido", "false");
  await expect(abaRateio, "a aba Rateio e classificação ABRE sozinha").toHaveAttribute("aria-selected", "true");
  const item = painel(page).getByTestId("compras-item-classificacao-0");
  await expect(item, "a mensagem na linha do item, na aba").toContainText("informe a natureza e o centro de resultado de cada item");
  await expect(item.getByTestId("compras-item-0-gera-estoque"), "o foco vai à linha do item, na aba").toBeFocused();
  await expect(botaoDosAdicionais(page), "continua sem acordeão").toHaveCount(0);
  const lista = await api<{ items: unknown[] }>(page, "GET", `/api/compras/compras?fornecedor_id=${c.fornecedor.id}`);
  expect(lista.items, "nada gravado").toHaveLength(0);
});

/* ═════════════════════════════════ R01-3 ═════════════════════════════════ */

/** Natureza e centro do seed como o servidor os devolve (id). */
const idDe = (o: Opcao) => o.id;

test("R01-3 — o corpo do POST com fiscais, rateio por valor e item imobilizado pela aba é BYTE A BYTE o de referência; o servidor grava o rateio e o item", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  await compraNaCentral(page, c);
  await abrirAba(page, "Fiscal");
  await expect(page.getByTestId("compras-dados-fiscais")).toBeVisible();
  await page.getByTestId("compras-uf-nota").fill("sp");
  await page.getByTestId("compras-valor-ipi").fill("10.00");
  const rateio = await abaDoRateio(page);
  await rateio.getByTestId("compras-item-0-imobilizado").check();
  await escolherNaLista(page, rateio.getByTestId("compras-rateio-tipo"), "Por valor");
  const linha = rateio.getByTestId("compras-rateio-linha-0");
  await escolherEm(page, linha, "Natureza", c.natureza.label);
  await escolherEm(page, linha, "Centro de resultado", c.centro.label);
  await linha.getByTestId("compras-rateio-linha-0-percentual").fill("100");

  // A REFERÊNCIA: a forma do corpo do estado (`corpoDoLancamento`), montada à mão do mesmo cenário, na mesma ordem — o
  // cabeçalho de hoje (sem as chaves vazias), os itens (com a classificação que foge do padrão), os fiscais preenchidos e
  // o rateio (percentual em TEXTO). `JSON.stringify` é o que o cliente da API manda.
  const referencia = {
    empresa_id: c.empresa, fornecedor_id: c.fornecedor.id, tipo_operacao_id: c.topCompra, data_documento: hojeIso(),
    frete: "0", outras_despesas: "0", desconto: "0",
    itens: [{ produto_id: c.produto.id, armazem_id: c.armazem.id, quantidade: "2", valor_unitario: "50", imobilizado: true }],
    uf_nota: "SP", valor_ipi: "10.00",
    rateio: { tipo: "por_valor", linhas: [{ categoria_financeira_id: idDe(c.natureza), centro_custo_id: idDe(c.centro), conta_contabil_id: null, safra_id: null, percentual: "100" }] }
  };
  const post = postDaCompra(page);
  await page.getByTestId("compras-salvar").click();
  const resposta = await post;
  const enviado = resposta.request().postData();
  expect(JSON.parse(enviado ?? "null"), "o corpo, chave a chave").toEqual(referencia);
  expect(enviado, "o corpo, BYTE A BYTE (a ordem das chaves inclusive)").toBe(JSON.stringify(referencia));
  expect(resposta.status(), "o lançamento foi aceito").toBe(201);

  // NO SERVIDOR: o rateio por valor gravado, o item imobilizado e os fiscais.
  await expect(page).toHaveURL(/\/compras\/compras\/[0-9a-f-]{36}$/);
  const id = /\/compras\/compras\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
  const gravada = await api<Record<string, unknown>>(page, "GET", `/api/compras/compras/${id}`);
  expect(gravada, "a compra gravada").toMatchObject({ situacao: "aberto", rateio_tipo: "por_valor", uf_nota: "SP", valor_ipi: "10.00", valor_itens: "100.00", valor_total: "110.00" });
  const linhas = (gravada["rateio"] as Record<string, unknown>[]).map((l) => [l["categoria_financeira_id"], l["centro_custo_id"], Number(l["percentual"])]);
  expect(linhas, "a linha do rateio gravada").toEqual([[c.natureza.id, c.centro.id, 100]]);
  expect((gravada["itens"] as Record<string, unknown>[]).map((i) => i["imobilizado"]), "o item imobilizado gravado").toEqual([true]);
});

/* ═════════════════════════════════ R01-4 ═════════════════════════════════ */

test("R01-4 — SEM a capacidade importacaoXml: nenhuma aba de rateio/fiscal, nada da F7 na tela, e o corpo de hoje byte a byte", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const declaradasPelaApi: unknown[] = [];
  await page.route("**/api/compras/compras/operation-types", async (r) => {
    const real = await r.fetch();
    const corpo = await real.json() as { capacidades?: Record<string, unknown> };
    const { importacaoXml, ...capacidades } = corpo.capacidades ?? {};
    declaradasPelaApi.push(importacaoXml);
    await r.fulfill({ response: real, json: { ...corpo, capacidades } });
  });
  await compraNaCentral(page, c);
  expect(declaradasPelaApi.length, "premissa: a tela perguntou a capacidade (e recebeu sem ela)").toBeGreaterThan(0);
  expect(declaradasPelaApi.every((v) => v === 1), "premissa: a API real declara a capacidade — só a resposta à tela a perdeu").toBe(true);

  await page.waitForLoadState("networkidle");
  const abasSemF7 = await nomesDasAbas(page);
  expect(abasSemF7.includes("Fiscal"), "sem F7: sem aba Fiscal").toBe(false);
  // Natureza/centro do layout podem estar na aba Rateio e classificação (sem o bloco F7 de rateio).
  if (abasSemF7.includes(ABA_RATEIO)) await abrirAba(page, ABA_RATEIO);
  await escolherEm(page, page.getByTestId("compras-central"), "Natureza de despesa", c.natureza.label);
  await escolherEm(page, page.getByTestId("compras-central"), "Centro de resultado", c.centro.label);
  await expect(botaoDosAdicionais(page), "sem campo a recolher, sem Dados adicionais (como hoje)").toHaveCount(0);
  for (const t of [...DO_RATEIO, "compras-dados-fiscais", ...FISCAIS_NO_PAINEL, "compras-seguro", "compras-tipo-titulo", "compras-classificacao-gasto"]) {
    await expect(page.getByTestId(t), `${t}: nada da F7 na tela`).toHaveCount(0);
  }

  const referencia = {
    empresa_id: c.empresa, fornecedor_id: c.fornecedor.id, tipo_operacao_id: c.topCompra, data_documento: hojeIso(),
    categoria_financeira_id: c.natureza.id, centro_custo_id: c.centro.id,
    frete: "0", outras_despesas: "0", desconto: "0",
    itens: [{ produto_id: c.produto.id, armazem_id: c.armazem.id, quantidade: "2", valor_unitario: "50" }]
  };
  const post = postDaCompra(page);
  await page.getByTestId("compras-salvar").click();
  const resposta = await post;
  const enviado = resposta.request().postData();
  expect(JSON.parse(enviado ?? "null"), "o corpo de hoje, chave a chave").toEqual(referencia);
  expect(enviado, "o corpo de hoje, BYTE A BYTE").toBe(JSON.stringify(referencia));
  expect(resposta.status(), "o lançamento de hoje é aceito").toBe(201);
});
