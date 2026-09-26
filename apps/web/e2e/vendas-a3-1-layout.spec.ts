import { test, expect, type Page } from "@playwright/test";
import { login, api, uniq, pickRef, abrirLancamentoDeVendas, escolherTopEContinuar, escolherPrimeiroProdutoDaLinha, preencherClassificacaoFinanceira } from "./helpers";

/**
 * VENDAS-A3-1 — LAYOUT DO DOCUMENTO POR TOP, PELA TELA (API e banco REAIS; nada mockado).
 *
 * O domínio prova a conta (validar, resolver, cobrar) e a integração prova a gravação. Aqui se mede o que a TELA
 * promete: o cadastro monta o layout (W1), a Central obedece a ele (W2), a ordem de escolha ligado → padrão da
 * família → sistema chega à tela (W3), e o editor da TOP diz qual layout vale (W4).
 *
 * Anti-vacuidade: toda ausência (campo fora do layout) vem depois de uma presença positiva do mesmo tipo de alvo.
 */

const ROTA_LAYOUTS = "/configuracoes?tab=operacoes&sub=layouts-documento";
const BASE = "/api/admin/layouts-documento";
/** Data de hoje (local) no formato do valor do controle de data da Central (ISO). */
const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const campo = (page: Page, chave: string) => page.locator(`[data-campo="${chave}"]`).first();

type Linha = { id: string; nome: string; padrao: boolean; is_active: boolean };
type Detalhe = { id: string; nome: string; estrutura: { cabecalho: { campo: string; rotulo?: string; obrigatorio: boolean; editavel: boolean; valorPadrao?: unknown }[]; rodape: { aba: string; campos: { campo: string; rotulo?: string; obrigatorio: boolean; editavel: boolean }[] }[] }; tops: { id: string }[] };

/** TOP própria (prefixo 3 — A3 —, para não colidir com os specs vizinhos). */
async function criarTop(page: Page, familia: string, nome: string): Promise<string> {
  const codigo = `3${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return (await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase: familia, nome: uniq(nome) })).id;
}

async function abrirCentral(page: Page, variante: string, topId: string) {
  await abrirLancamentoDeVendas(page, variante);
  await escolherTopEContinuar(page, topId);
  await expect(page.getByTestId("central-vendas")).toBeVisible();
}

/** Cria o layout PELA TELA e devolve o id (lido da resposta do POST que a tela disparou). */
async function criarLayoutPelaTela(page: Page, familia: string, nome: string): Promise<string> {
  await page.goto(ROTA_LAYOUTS);
  await expect(page.getByTestId("layouts-documento")).toBeVisible();
  await page.getByRole("button", { name: "Novo layout" }).click();
  const dialogo = page.getByTestId("layout-novo");
  await dialogo.getByTestId("layout-novo-familia").selectOption(familia);
  await dialogo.getByTestId("layout-novo-nome").fill(nome);
  const resposta = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === BASE);
  await dialogo.getByTestId("layout-novo-criar").click();
  const r = await resposta;
  expect(r.status(), "o layout foi criado").toBe(201);
  return ((await r.json()) as { id: string }).id;
}

async function abrirEditor(page: Page, id: string) {
  const linha = page.locator("tr", { has: page.getByTestId(`layout-linha-${id}`) });
  await expect(linha).toHaveCount(1);
  await linha.getByRole("button", { name: "Mais opções" }).click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  await expect(page.getByTestId("layout-editor")).toBeVisible();
}

async function configurar(page: Page, chave: string, f: (d: ReturnType<Page["getByTestId"]>) => Promise<void>) {
  await page.getByTestId(`layout-campo-${chave}`).getByRole("button", { name: "Configurar campo" }).click();
  const d = page.getByTestId("layout-configurar-campo");
  await expect(d).toBeVisible();
  await f(d);
  await d.getByTestId("layout-configurar-aplicar").click();
  await expect(d).toHaveCount(0);
}

/** Desliga os padrões da família deixados por uma execução anterior deste arquivo (o banco de e2e é compartilhado). */
async function limparPadroesW3(page: Page, familia: string) {
  const lista = await api<{ items: Linha[] }>(page, "GET", `${BASE}?familia=${familia}`);
  for (const l of lista.items) if (l.padrao && l.nome.startsWith("LD-W3")) await api(page, "POST", `${BASE}/${l.id}/ativo`, { ativo: false });
}

test.describe.configure({ mode: "serial" });

let layoutW1 = "";
let topW1 = "";
const NOME_W1 = uniq("LD-W1 Venda");

test("LD-W1 — cria o layout de venda a partir do sistema: tira ICMS frete, Transp. obrigatória, Data de saída = hoje e não editável; liga à TOP", async ({ page }) => {
  await login(page);
  topW1 = await criarTop(page, "vendas.venda", "Layout W1");
  layoutW1 = await criarLayoutPelaTela(page, "vendas.venda", NOME_W1);
  await abrirEditor(page, layoutW1);

  // Remover ICMS frete
  await expect(page.getByTestId("layout-campo-freight_icms"), "premissa: a cópia do sistema traz o ICMS frete").toHaveCount(1);
  await page.getByTestId("layout-campo-freight_icms").getByRole("button", { name: /^Remover/ }).click();
  await expect(page.getByTestId("layout-campo-freight_icms")).toHaveCount(0);

  // Transportadora → "Transp.", obrigatória
  await configurar(page, "transporter_id", async (d) => {
    await d.getByTestId("layout-cfg-rotulo").fill("Transp.");
    await d.getByTestId("layout-cfg-obrigatorio").selectOption("true");
  });
  // R1: Parcelamento sempre tem valor → o seletor Obrigatório nasce desabilitado
  await page.getByTestId("layout-campo-installment_plan").getByRole("button", { name: "Configurar campo" }).click();
  const cfgParcelamento = page.getByTestId("layout-configurar-campo");
  await expect(cfgParcelamento.getByTestId("layout-cfg-rotulo"), "premissa: o diálogo abriu").toBeVisible();
  await expect(cfgParcelamento.getByTestId("layout-cfg-obrigatorio")).toBeDisabled();
  await expect(cfgParcelamento.locator(`[title="Sempre tem valor"]`), "a dica do campo (title, padrão do Field)").toHaveCount(1);
  await cfgParcelamento.getByRole("button", { name: "Fechar", exact: true }).last().click();
  await expect(cfgParcelamento).toHaveCount(0);

  // Data de saída: padrão data de hoje, não editável
  await configurar(page, "shipping_date", async (d) => {
    await d.getByTestId("layout-cfg-editavel").selectOption("false");
    await d.getByTestId("layout-cfg-padrao-modo").selectOption("variavel");
  });

  const put = page.waitForResponse((r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `${BASE}/${layoutW1}`);
  await page.getByTestId("layout-salvar").click();
  expect((await put).status(), "o layout foi gravado").toBe(200);
  await expect(page.getByTestId("layout-salvo")).toBeVisible();

  // Liga à TOP
  const topas = page.getByTestId("layout-tops-ligadas");
  await topas.getByTestId(`layout-top-${topW1}`).getByRole("checkbox").check();
  await topas.getByTestId("layout-tops-salvar").click();
  await expect(page.getByTestId("layout-tops-salvo")).toBeVisible();

  // O que a tela gravou, lido do servidor
  const d = await api<Detalhe>(page, "GET", `${BASE}/${layoutW1}`);
  const todos = [...d.estrutura.cabecalho, ...d.estrutura.rodape.flatMap((a) => a.campos)];
  expect(todos.some((c) => c.campo === "transporter_id"), "premissa: o campo existe").toBe(true);
  expect(todos.some((c) => c.campo === "freight_icms"), "ICMS frete saiu").toBe(false);
  expect(todos.find((c) => c.campo === "transporter_id")).toMatchObject({ rotulo: "Transp.", obrigatorio: true });
  expect(todos.find((c) => c.campo === "shipping_date")).toMatchObject({ editavel: false, valorPadrao: { tipo: "variavel", variavel: "data_atual" } });
  expect(d.tops.map((t) => t.id)).toEqual([topW1]);
});

test("LD-W2 — a Central obedece ao layout: sem transportadora, erro no campo; com ela, salva", async ({ page }) => {
  expect(layoutW1, "depende do LD-W1").not.toBe("");
  await login(page);
  const transportadora = uniq("Transp W2");
  await api(page, "POST", "/api/resources/people", { name: transportadora, person_type: "legal", is_client: false, is_provider: false, is_employee: false, is_proprietary: false, is_transporter: true, is_active: true });
  await abrirCentral(page, "sales", topW1);

  // Presença positiva antes da ausência: na aba Frete e transporte, o frete continua; o ICMS frete não existe.
  await page.getByRole("tab", { name: "Frete e transporte" }).click();
  await expect(campo(page, "freight")).toBeVisible();
  await expect(page.locator('[data-campo="freight_icms"]')).toHaveCount(0);
  // Data de saída: hoje, não editável
  const saida = campo(page, "shipping_date");
  await expect(saida.locator("input").first()).toHaveValue(hojeIso());
  await expect(page.locator('fieldset[data-editavel="false"] [data-campo="shipping_date"]')).toHaveCount(1);
  await expect(saida.locator("input").first()).toBeDisabled();

  await pickRef(page, "Cliente", "DEMO");
  await page.getByRole("button", { name: /Adicionar item/ }).click();
  await escolherPrimeiroProdutoDaLinha(page);
  const linha = page.getByTestId("central-vendas-linha").first();
  await linha.getByLabel("Quantidade").fill("1");
  await linha.getByLabel("Valor unitário").fill("100");
  await preencherClassificacaoFinanceira(page);

  // Sem transportadora: a tela cobra ANTES do POST, com a mensagem do domínio, no campo.
  let posts = 0;
  page.on("request", (r) => { if (r.method() === "POST" && /\/api\/sales\/sales$/.test(new URL(r.url()).pathname)) posts++; });
  await page.getByRole("button", { name: "Salvar" }).click();
  await page.getByRole("tab", { name: "Frete e transporte" }).click();
  const transp = campo(page, "transporter_id");
  await expect(transp).toContainText("Transp. *");
  await expect(transp).toContainText("O campo 'Transp.' é obrigatório nesta operação.");
  expect(posts, "nenhum POST saiu").toBe(0);

  await pickRef(page, "Transp.", transportadora);
  const resposta = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/sales\/sales$/.test(new URL(r.url()).pathname));
  await page.getByRole("button", { name: "Salvar" }).click();
  const r = await resposta;
  expect(r.status(), "com a transportadora, a venda é criada").toBe(201);
  const corpo = r.request().postDataJSON() as Record<string, unknown>;
  expect(corpo["transporter_id"]).toBeTruthy();
});

test("LD-W3 — TOP sem layout: sem padrão, a Central de hoje; com padrão da família, o padrão", async ({ page }) => {
  await login(page);
  const familia = "vendas.pedido";
  await limparPadroesW3(page, familia);
  const lista = await api<{ items: Linha[] }>(page, "GET", `${BASE}?familia=${familia}`);
  expect(lista.items.filter((l) => l.padrao && l.is_active), "premissa: a família não tem padrão").toHaveLength(0);
  const top = await criarTop(page, familia, "Layout W3");

  // Sem padrão → layout do sistema: o rótulo de hoje e o ICMS frete presente.
  await abrirCentral(page, "orders", top);
  await expect(campo(page, "shipping_date")).toContainText("Data de saída");
  await page.getByRole("tab", { name: "Frete e transporte" }).click();
  await expect(page.locator('[data-campo="freight_icms"]')).toHaveCount(1);

  // Padrão da família, com um rótulo que só ele tem.
  const criado = await api<{ id: string }>(page, "POST", BASE, { familia, nome: uniq("LD-W3 Padrão") });
  try {
    const d = await api<Detalhe>(page, "GET", `${BASE}/${criado.id}`);
    const estrutura = { ...d.estrutura, cabecalho: d.estrutura.cabecalho.map((c) => c.campo === "shipping_date" ? { ...c, rotulo: "Saída (padrão)" } : c) };
    await api(page, "PUT", `${BASE}/${criado.id}`, { estrutura });
    await api(page, "POST", `${BASE}/${criado.id}/padrao`, {});

    await abrirCentral(page, "orders", top);
    await expect(campo(page, "shipping_date")).toContainText("Saída (padrão)");
    const efetivo = await api<{ origem: string; id: string }>(page, "GET", `/api/sales/orders/layout-efetivo?tipo_operacao_id=${top}`);
    expect(efetivo).toMatchObject({ origem: "padrao_da_familia", id: criado.id });
  } finally {
    await api(page, "POST", `${BASE}/${criado.id}/ativo`, { ativo: false });
  }
});

test("LD-W4 — o editor da TOP diz qual layout vale (ligado · do sistema)", async ({ page }) => {
  expect(layoutW1, "depende do LD-W1").not.toBe("");
  await login(page);
  const semLayout = await criarTop(page, "vendas.orcamento", "Layout W4");
  const codigoDe = async (id: string) => (await api<{ codigo: string }>(page, "GET", `/api/admin/tipos-operacao/${id}`)).codigo;

  // R1: a linha lê a porta de Configurações — conferido no fio; nenhuma chamada a /api/sales/
  const pedidos: string[] = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) pedidos.push(`${u.pathname}${u.search}`); });

  for (const [id, esperado, origem] of [[topW1, `Layout do documento: ${NOME_W1} (ligado)`, "ligado"], [semLayout, "Layout do documento: Layout do sistema (do sistema)", "sistema"]] as const) {
    const codigo = await codigoDe(id);
    await page.goto("/configuracoes?tab=operacoes&sub=tipos-operacao");
    await page.getByLabel("Buscar tipo de operação").fill(codigo);
    const linha = page.getByRole("row").filter({ hasText: codigo });
    await expect(linha).toHaveCount(1);
    await linha.getByRole("button", { name: "Mais opções" }).click();
    await page.getByRole("menuitem", { name: "Editar" }).click();
    const linhaLayout = page.getByTestId("form-tipo-operacao").getByTestId("top-layout-documento");
    await expect(linhaLayout).toHaveAttribute("data-origem", origem);
    await expect(linhaLayout).toHaveText(esperado);
    expect(pedidos, "a linha pediu a rota nova com a TOP").toContain(`/api/admin/layouts-documento/efetivo?tipoOperacaoId=${id}`);
  }
  expect(pedidos.filter((u) => u.startsWith("/api/sales/")), "nenhuma chamada à porta de vendas").toEqual([]);
});
