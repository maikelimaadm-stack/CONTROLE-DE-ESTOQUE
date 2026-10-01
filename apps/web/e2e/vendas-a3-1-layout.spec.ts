import { test, expect, type Page } from "@playwright/test";
import { login, adicionarItemNaCentral, api, uniq, pickRef, abrirLancamentoDeVendas, escolherTopEContinuar, escolherPrimeiroProdutoDaLinha, preencherClassificacaoFinanceira } from "./helpers";

/**
 * VENDAS-A3-1 — LAYOUT DO DOCUMENTO POR TOP, PELA TELA (API e banco REAIS; nada mockado).
 *
 * O domínio prova a conta (validar, resolver, cobrar) e a integração prova a gravação. Aqui se mede o que a TELA
 * promete: o cadastro monta o layout (W1), a Central obedece a ele (W2), a ordem de escolha ligado → padrão do
 * movimento → sistema chega à tela (W3), e o editor da TOP diz qual layout vale (W4).
 *
 * A3-1c (decisão 261): o editor virou a PÁGINA /configuracoes/layouts-documento/<id> (testids config-*) e o texto ao
 * usuário diz "movimento" onde dizia "família" da TOP. Os passos de UI foram migrados sem perder asserção; os
 * identificadores de código (`familia`, `padrao_da_familia`) não mudam.
 *
 * A3-1d (decisão 262): TELA ÚNICA — a grade de layouts em cima (com a barra: Novo, Visualizar TOPs, Exportar…) e, ao
 * clicar na linha, a área do layout logo abaixo, já no rascunho (não há mais "Editar"). Novo é um assistente de 3 passos
 * que SELECIONA o criado; Salvar só liga com mudança e, depois de salvar, a área continua editável; as TOPs ligadas saíram
 * do fim da página para o diálogo "Visualizar TOPs". Só os passos de UI mudaram; toda asserção de regra ficou.
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

/**
 * Cria o layout PELA TELA e devolve o id (lido da resposta do POST que a tela disparou).
 * A3-1d (decisão 262): "Novo" da barra da grade abre o ASSISTENTE de 3 passos (antes: botão "Novo layout" e um diálogo
 * só). Modelo = layout do sistema (o inicial: o POST é o da raiz, sem duplicar); sem padrão e sem TOP no passo 3 — a TOP
 * é ligada depois, pelo "Visualizar TOPs", como antes.
 */
async function criarLayoutPelaTela(page: Page, familia: string, nome: string): Promise<string> {
  await page.goto(ROTA_LAYOUTS);
  await expect(page.getByTestId("layouts-documento")).toBeVisible();
  await page.getByTestId("layouts-barra").getByTestId("layouts-novo").click();
  const dialogo = page.getByTestId("layout-novo");
  await dialogo.getByTestId("layout-novo-familia").selectOption(familia);
  await dialogo.getByTestId("layout-novo-nome").fill(nome);
  await dialogo.getByTestId("layout-novo-avancar").click();
  await expect(dialogo.getByTestId("layout-novo-origem"), "passo 2: o modelo").toBeVisible();
  await dialogo.getByTestId("layout-novo-avancar").click();
  await expect(dialogo.getByTestId("layout-novo-padrao"), "passo 3: onde usar").toBeVisible();
  const resposta = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === BASE);
  await dialogo.getByTestId("layout-novo-criar").click();
  const r = await resposta;
  expect(r.status(), "o layout foi criado").toBe(201);
  const { id, code } = (await r.json()) as { id: string; code: string };
  // A3-1d (decisão 262): ao criar, a tela SELECIONA o novo na grade e abre a área dele (antes: navegava para
  // /configuracoes/layouts-documento/<id> — asserção de URL trocada pela linha selecionada + código/nome na área).
  await expect(dialogo).toHaveCount(0);
  await expect(page.getByTestId(`layout-linha-${id}`)).toHaveAttribute("data-selecionado", "true");
  const area = page.getByTestId("config-layout-pagina");
  await expect(area.getByTestId("config-codigo")).toHaveText(code);
  await expect(area.getByTestId("config-nome")).toHaveValue(nome);
  return id;
}

/**
 * A3-1d (decisão 262): TELA ÚNICA — clicar na linha da grade SELECIONA e abre a área do layout logo abaixo, já no
 * rascunho: não há mais menu "⋯ Editar" (a asserção de URL virou a linha selecionada) nem o passo `config-editar`.
 * Sem mudança, Salvar fica desligado. Antes (A3-1c): menu Editar → página → "Editar" da barra.
 */
async function abrirEditor(page: Page, id: string) {
  await page.goto(ROTA_LAYOUTS);
  await expect(page.getByTestId("layouts-documento")).toBeVisible();
  const linha = page.locator("tr", { has: page.getByTestId(`layout-linha-${id}`) });
  await expect(linha).toHaveCount(1);
  await page.getByTestId(`layout-linha-${id}`).click();
  await expect(page.getByTestId(`layout-linha-${id}`)).toHaveAttribute("data-selecionado", "true");
  await expect(page.getByTestId("config-layout-pagina")).toBeVisible();
  await expect(page.getByTestId("config-salvar")).toBeVisible();
  await expect(page.getByTestId("config-salvar"), "sem mudança, Salvar desligado").toBeDisabled();
}

/**
 * A prévia mostra UMA aba do rodapé por vez: um campo do rodapé só está na tela com a aba dele ativa. A aba vem do
 * layout GRAVADO (o rascunho só muda no que o próprio teste mexe) — premissa conferida, nunca suposta.
 */
async function mostrarCampo(page: Page, id: string, chave: string) {
  const e = (await api<Detalhe>(page, "GET", `${BASE}/${id}`)).estrutura;
  if (e.cabecalho.some((c) => c.campo === chave)) return;
  const aba = e.rodape.findIndex((a) => a.campos.some((c) => c.campo === chave));
  expect(aba, `premissa: ${chave} está no layout`).toBeGreaterThanOrEqual(0);
  await page.getByTestId(`config-aba-${aba}`).click();
}

/** Seleciona o campo na prévia e abre "Configurar campo" pela barra de ações (antes: botão "Configurar campo" na linha `layout-campo-<k>`). */
async function abrirConfigurar(page: Page, id: string, chave: string) {
  await mostrarCampo(page, id, chave);
  await page.getByTestId(`config-campo-${chave}`).click();
  await expect(page.getByTestId(`config-campo-${chave}`)).toHaveAttribute("data-selecionado", "true");
  await page.getByTestId("config-acoes").getByTestId("config-acao-configurar").click();
}

async function configurar(page: Page, id: string, chave: string, f: (d: ReturnType<Page["getByTestId"]>) => Promise<void>) {
  await abrirConfigurar(page, id, chave);
  const d = page.getByTestId("layout-configurar-campo");
  await expect(d).toBeVisible();
  await f(d);
  await d.getByTestId("layout-configurar-aplicar").click();
  await expect(d).toHaveCount(0);
}

/**
 * Liga a TOP pela lista dupla (antes: caixa na lista `layout-tops-ligadas` + `layout-tops-salvar`/`layout-tops-salvo`).
 * A3-1d (decisão 262): a lista dupla saiu do fim da página para o diálogo "Visualizar TOPs" (barra da grade, age sobre a
 * linha selecionada); mesmos testids `config-tops-*`, e Salvar desligado enquanto nada muda.
 */
async function ligarTop(page: Page, topId: string) {
  await page.getByTestId("layouts-barra").getByTestId("layouts-visualizar-tops").click();
  const tops = page.getByTestId("config-tops-dialogo");
  await expect(tops).toBeVisible();
  await expect(tops.getByTestId("config-tops-salvar"), "sem mudança, Salvar das TOPs desligado").toBeDisabled();
  await tops.getByTestId("config-tops-disponiveis").getByTestId(`config-top-${topId}`).click();
  await tops.getByTestId("config-tops-mover").click();
  await expect(tops.getByTestId("config-tops-ligadas").getByTestId(`config-top-${topId}`)).toHaveCount(1);
  await tops.getByTestId("config-tops-salvar").click();
  await expect(tops.getByTestId("config-tops-salvo")).toBeVisible();
}

/**
 * Salva o rascunho (PUT) — `config-salvar`, sem recusa.
 * A3-1d (decisão 262): depois de salvar a área CONTINUA editável (não volta a `config-editar`, que não existe mais):
 * "Layout salvo." (`layout-salvo`) e Salvar desliga — nada pendente.
 */
async function salvarLayout(page: Page, id: string) {
  const put = page.waitForResponse((r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `${BASE}/${id}`);
  await page.getByTestId("config-salvar").click();
  expect((await put).status(), "o layout foi gravado").toBe(200);
  await expect(page.getByTestId("layout-salvo"), "gravado: a confirmação").toContainText("Layout salvo.");
  await expect(page.getByTestId("config-salvar"), "gravado: nada pendente, Salvar desliga").toBeDisabled();
  await expect(page.getByTestId("config-nome"), "gravado: a área continua editável").toBeEditable();
  await expect(page.getByTestId("config-aviso")).toHaveCount(0);
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

  // Remover ICMS frete (A3-1c: seleciona na prévia → "Remover" da barra de ações; antes: botão "Remover" na linha).
  await mostrarCampo(page, layoutW1, "freight_icms");
  await expect(page.getByTestId("config-campo-freight_icms"), "premissa: a cópia do sistema traz o ICMS frete").toHaveCount(1);
  await page.getByTestId("config-campo-freight_icms").click();
  await page.getByTestId("config-acoes").getByTestId("config-acao-remover").click();
  await expect(page.getByTestId("config-campo-freight_icms")).toHaveCount(0);

  // Transportadora → "Transp.", obrigatória
  await configurar(page, layoutW1, "transporter_id", async (d) => {
    await d.getByTestId("layout-cfg-rotulo").fill("Transp.");
    await d.getByTestId("layout-cfg-obrigatorio").selectOption("true");
  });
  // R1: Parcelamento sempre tem valor → o seletor Obrigatório nasce desabilitado
  await abrirConfigurar(page, layoutW1, "installment_plan");
  const cfgParcelamento = page.getByTestId("layout-configurar-campo");
  await expect(cfgParcelamento.getByTestId("layout-cfg-rotulo"), "premissa: o diálogo abriu").toBeVisible();
  await expect(cfgParcelamento.getByTestId("layout-cfg-obrigatorio")).toBeDisabled();
  await expect(cfgParcelamento.locator(`[title="Sempre tem valor"]`), "a dica do campo (title, padrão do Field)").toHaveCount(1);
  // A3-1d (decisão 262): o Fechar do rodapé tem testid próprio; nada mudou no formulário → fecha direto, sem pergunta.
  await cfgParcelamento.getByTestId("layout-cfg-fechar").click();
  await expect(cfgParcelamento).toHaveCount(0);

  // Data de saída: padrão data de hoje, não editável
  await configurar(page, layoutW1, "shipping_date", async (d) => {
    await d.getByTestId("layout-cfg-editavel").selectOption("false");
    await d.getByTestId("layout-cfg-padrao-modo").selectOption("variavel");
  });

  await salvarLayout(page, layoutW1);

  // Liga à TOP
  await ligarTop(page, topW1);

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
  await adicionarItemNaCentral(page);
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

test("LD-W3 — TOP sem layout: sem padrão, a Central de hoje; com padrão do movimento, o padrão", async ({ page }) => {
  await login(page);
  const familia = "vendas.pedido";
  await limparPadroesW3(page, familia);
  const lista = await api<{ items: Linha[] }>(page, "GET", `${BASE}?familia=${familia}`);
  expect(lista.items.filter((l) => l.padrao && l.is_active), "premissa: o movimento não tem padrão").toHaveLength(0);
  const top = await criarTop(page, familia, "Layout W3");

  // Sem padrão → layout do sistema: o rótulo de hoje e o ICMS frete presente.
  await abrirCentral(page, "orders", top);
  await expect(campo(page, "shipping_date")).toContainText("Data de saída");
  await page.getByRole("tab", { name: "Frete e transporte" }).click();
  await expect(page.locator('[data-campo="freight_icms"]')).toHaveCount(1);

  // Padrão do movimento (A3-1c: antes "da família"), com um rótulo que só ele tem.
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
