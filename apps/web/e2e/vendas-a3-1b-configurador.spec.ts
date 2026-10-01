import { test, expect, type Page, type Locator } from "@playwright/test";
import { login, adicionarItemNaCentral, api, uniq, empresaAtiva, abrirLancamentoDeVendas, escolherTopEContinuar, abrirAbaDoLancamento } from "./helpers";

/**
 * VENDAS-A3-1b — PADRÃO DE CADASTRO NO LAYOUT E EXPORTAR/IMPORTAR, PELA TELA (API e banco REAIS; nada mockado).
 *
 * A integração prova a conferência e as respostas. Aqui se mede o que a TELA promete: o editor põe o padrão de
 * cadastro (W1), a Central o aplica — travado quando não editável, na linha nova de item, com o plano da condição —,
 * o padrão que morreu no cadastro destrava o campo com o aviso (W2), e Exportar → Importar pela lista (W3).
 *
 * A3-1c (decisão 261): o editor virou a PÁGINA /configuracoes/layouts-documento/<id> (testids config-*); os passos
 * de UI foram migrados sem perder asserção.
 *
 * A3-1d (decisão 262): TELA ÚNICA — grade em cima com a barra (Novo, Visualizar TOPs, Exportar, Importar…) e a área do
 * layout selecionado logo abaixo, já no rascunho (sem "Editar", sem menu "⋯" na linha). Novo é o assistente de 3 passos;
 * depois de salvar a área continua editável; TOPs pelo diálogo "Visualizar TOPs"; Exportar pela barra, com a linha
 * selecionada. Só os passos de UI mudaram; toda asserção de regra ficou.
 *
 * O spec cria o que inativa (a natureza é dele) e, no fim, inativa os layouts e reativa a natureza.
 */

const ROTA_LAYOUTS = "/configuracoes?tab=operacoes&sub=layouts-documento";
const BASE = "/api/admin/layouts-documento";
const FAM = "vendas.pedido";
const AVISO_CENTRAL = "O valor padrão deste campo não vale mais no cadastro. Ajuste o layout.";
const campo = (page: Page, chave: string) => page.locator(`[data-campo="${chave}"]`).first();

type Detalhe = { id: string; nome: string; code: string; estrutura: { cabecalho: { campo: string; editavel: boolean; valorPadrao?: unknown }[]; rodape: { aba: string; campos: { campo: string; editavel: boolean; valorPadrao?: unknown }[] }[]; itens: { campo: string; valorPadrao?: unknown }[] }; padroesDeCadastro: Record<string, { id: string; rotulo: string; empresaId?: string | null }>; padroesInvalidos: string[] };

async function criarTop(page: Page, nome: string): Promise<string> {
  const codigo = `3b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  return (await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase: FAM, nome: uniq(nome) })).id;
}

async function abrirCentral(page: Page, topId: string) {
  await abrirLancamentoDeVendas(page, "orders");
  await escolherTopEContinuar(page, topId);
  await expect(page.getByTestId("central-vendas")).toBeVisible();
}

/**
 * A3-1d (decisão 262): "Novo" da barra da grade abre o ASSISTENTE de 3 passos (antes: botão "Novo layout" e um diálogo
 * só). Modelo = layout do sistema (o inicial: o POST é o da raiz); sem padrão e sem TOP — a TOP é ligada depois.
 */
async function criarLayoutPelaTela(page: Page, nome: string): Promise<string> {
  await page.goto(ROTA_LAYOUTS);
  await expect(page.getByTestId("layouts-documento")).toBeVisible();
  await page.getByTestId("layouts-barra").getByTestId("layouts-novo").click();
  const dialogo = page.getByTestId("layout-novo");
  await dialogo.getByTestId("layout-novo-familia").selectOption(FAM);
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

const linhaDaLista = (page: Page, id: string) => page.locator("tr", { has: page.getByTestId(`layout-linha-${id}`) });

/**
 * A3-1d (decisão 262): TELA ÚNICA — clicar na linha da grade SELECIONA e abre a área do layout logo abaixo, já no
 * rascunho: não há mais menu "⋯ Editar" (a asserção de URL virou a linha selecionada) nem o passo `config-editar` — por
 * isso saiu o parâmetro `editar`. Sem mudança, Salvar fica desligado. Antes (A3-1c): menu Editar → página → "Editar".
 */
async function abrirEditor(page: Page, id: string) {
  await page.goto(ROTA_LAYOUTS);
  await expect(page.getByTestId("layouts-documento")).toBeVisible();
  const linha = linhaDaLista(page, id);
  await expect(linha).toHaveCount(1);
  await page.getByTestId(`layout-linha-${id}`).click();
  await expect(page.getByTestId(`layout-linha-${id}`)).toHaveAttribute("data-selecionado", "true");
  await expect(page.getByTestId("config-layout-pagina")).toBeVisible();
  await expect(page.getByTestId("config-salvar")).toBeVisible();
  await expect(page.getByTestId("config-salvar"), "sem mudança, Salvar desligado").toBeDisabled();
}

/** Um campo do rodapé só está na prévia com a aba dele ativa: abre a aba (lida do layout gravado; premissa conferida). */
async function mostrarCampo(page: Page, id: string, chave: string) {
  const e = (await api<Detalhe>(page, "GET", `${BASE}/${id}`)).estrutura;
  const aba = e.rodape.findIndex((a) => a.campos.some((c) => c.campo === chave));
  if (aba >= 0) await page.getByTestId(`config-aba-${aba}`).click();
}

/** Escolhe o registro no RefSelect do "Valor padrão: Registro do cadastro" do diálogo Configurar campo. */
async function escolherRegistro(page: Page, d: Locator, busca: string) {
  await d.getByTestId("layout-cfg-padrao-modo").selectOption("registro");
  const alvo = d.getByTestId("layout-cfg-padrao-registro");
  await expect(alvo).toBeVisible();
  await alvo.getByRole("combobox").click();
  await page.getByPlaceholder("Pesquisar...").fill(busca);
  await page.locator(".cmd-panel").getByRole("option", { name: new RegExp(busca.slice(0, 12), "i") }).first().click();
  await expect(alvo).toContainText(busca);
}

/**
 * Seleciona o campo na prévia e abre "Configurar campo" pela barra de ações (antes: botão "Configurar campo" na linha
 * `layout-campo-<k>`). `chave` é a do contrato: documento = a chave; coluna de item = "itens.<campo>".
 */
async function configurar(page: Page, id: string, chave: string, f: (d: Locator) => Promise<void>) {
  await mostrarCampo(page, id, chave);
  await page.getByTestId(`config-campo-${chave}`).click();
  await expect(page.getByTestId(`config-campo-${chave}`)).toHaveAttribute("data-selecionado", "true");
  await page.getByTestId("config-acoes").getByTestId("config-acao-configurar").click();
  const d = page.getByTestId("layout-configurar-campo");
  await expect(d).toBeVisible();
  await f(d);
  await d.getByTestId("layout-configurar-aplicar").click();
  await expect(d).toHaveCount(0);
}

test.describe.configure({ mode: "serial" });

const NOME_LAYOUT = uniq("LB-W1 Pedido");
let layout = "";
let top = "";
const natureza = { id: "", nome: "" };
const condicao = { id: "", nome: "" };
let armazem = { id: "", rotulo: "" };
const criados: string[] = [];
let naturezaInativada = false;

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  try {
    await login(page);
    for (const id of criados) await api(page, "POST", `${BASE}/${id}/ativo`, { ativo: false });
    if (naturezaInativada && natureza.id) await api(page, "PUT", `/api/resources/financial_categories/${natureza.id}`, { is_active: true });
  } finally {
    await page.close();
  }
});

test("LB-W1 — pelo editor: Natureza padrão não editável, Condição e Armazém; a Central aplica (travado, plano e linha nova)", async ({ page }) => {
  await login(page);
  // Cadastros do spec: a natureza (W2 a inativa), a condição com duas parcelas e o armazém da empresa do documento.
  const pai = (await api<{ items: { id: string }[] }>(page, "GET", "/api/resources/financial_categories?kind=synthetic&nature=income&pageSize=5")).items[0]?.id;
  expect(pai, "premissa: há natureza sintética de receita").toBeTruthy();
  natureza.nome = uniq("LB Natureza");
  natureza.id = (await api<{ id: string }>(page, "POST", "/api/resources/financial_categories", { name: natureza.nome, nature: "income", kind: "analytic", parent_id: pai })).id;
  condicao.nome = uniq("LB 30-60");
  condicao.id = (await api<{ id: string }>(page, "POST", "/api/resources/condicoes_pagamento", { nome: condicao.nome, parcelas: 2, dias_primeira_parcela: 30, modo: "intervalo", intervalo_dias: 30 })).id;
  const empresa = await empresaAtiva(page);
  const armazens = await api<{ items: { id: string; description: string; empresa_id: string }[] }>(page, "GET", "/api/resources/warehouses?pageSize=100");
  const doc = armazens.items.find((w) => w.empresa_id === empresa);
  expect(doc, "premissa: a empresa do documento tem armazém").toBeTruthy();
  armazem = { id: doc!.id, rotulo: doc!.description };

  top = await criarTop(page, "LB-W1");
  layout = await criarLayoutPelaTela(page, NOME_LAYOUT);
  criados.push(layout);
  await abrirEditor(page, layout);

  await configurar(page, layout, "categoria_financeira_id", async (d) => {
    await d.getByTestId("layout-cfg-editavel").selectOption("false");
    await escolherRegistro(page, d, natureza.nome);
  });
  await configurar(page, layout, "condicao_pagamento_id", async (d) => { await escolherRegistro(page, d, condicao.nome); });
  await configurar(page, layout, "itens.warehouse_id", async (d) => { await escolherRegistro(page, d, armazem.rotulo); });

  // A3-1c: `config-salvar` (antes `layout-salvar`); "salvo" = PUT 200 e sem recusa.
  // A3-1d (decisão 262): depois de salvar a área CONTINUA editável (não volta a `config-editar`, que não existe mais):
  // "Layout salvo." (`layout-salvo`) e Salvar desliga — nada pendente.
  const put = page.waitForResponse((r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `${BASE}/${layout}`);
  await page.getByTestId("config-salvar").click();
  expect((await put).status(), "o layout foi gravado").toBe(200);
  await expect(page.getByTestId("layout-salvo"), "gravado: a confirmação").toContainText("Layout salvo.");
  await expect(page.getByTestId("config-salvar"), "gravado: nada pendente, Salvar desliga").toBeDisabled();
  await expect(page.getByTestId("config-nome"), "gravado: a área continua editável").toBeEditable();
  await expect(page.getByTestId("config-aviso")).toHaveCount(0);
  // A3-1c: lista dupla Disponíveis × Ligadas (antes: caixa na lista `layout-tops-ligadas`).
  // A3-1d (decisão 262): a lista dupla está no diálogo "Visualizar TOPs", aberto pelo status de uso da área
  // (`config-status-visualizar-tops`; o outro caminho, o da barra da grade, é o do vendas-a3-1-layout); mesmos testids e
  // Salvar desligado enquanto nada muda.
  await page.getByTestId("config-status").getByTestId("config-status-visualizar-tops").click();
  const tops = page.getByTestId("config-tops-dialogo");
  await expect(tops).toBeVisible();
  await expect(tops.getByTestId("config-tops-salvar"), "sem mudança, Salvar das TOPs desligado").toBeDisabled();
  await tops.getByTestId("config-tops-disponiveis").getByTestId(`config-top-${top}`).click();
  await tops.getByTestId("config-tops-mover").click();
  await expect(tops.getByTestId("config-tops-ligadas").getByTestId(`config-top-${top}`)).toHaveCount(1);
  await tops.getByTestId("config-tops-salvar").click();
  await expect(tops.getByTestId("config-tops-salvo")).toBeVisible();

  // O que a tela gravou, lido do servidor
  const d = await api<Detalhe>(page, "GET", `${BASE}/${layout}`);
  expect(d.estrutura.cabecalho.find((c) => c.campo === "categoria_financeira_id")).toMatchObject({ editavel: false, valorPadrao: { tipo: "registro", id: natureza.id } });
  expect(d.estrutura.rodape.flatMap((a) => a.campos).find((c) => c.campo === "condicao_pagamento_id")).toMatchObject({ valorPadrao: { tipo: "registro", id: condicao.id } });
  expect(d.estrutura.itens.find((c) => c.campo === "warehouse_id")).toMatchObject({ valorPadrao: { tipo: "registro", id: armazem.id } });
  expect(Object.keys(d.padroesDeCadastro).sort()).toEqual(["categoria_financeira_id", "condicao_pagamento_id", "itens.warehouse_id"]);

  // Central: Natureza preenchida e TRAVADA
  await abrirCentral(page, top);
  const nat = campo(page, "categoria_financeira_id");
  await expect(nat).toContainText(natureza.nome);
  await expect(page.locator('fieldset[data-editavel="false"] [data-campo="categoria_financeira_id"]')).toHaveCount(1);
  await expect(nat.locator("button.cmd-display")).toBeDisabled();
  await expect(nat.getByTestId("padrao-invalido-aviso")).toHaveCount(0);

  // Linha NOVA de item nasce com o armazém padrão (empresa do documento)
  await adicionarItemNaCentral(page);
  await expect(page.getByTestId("central-vendas-linha").last().getByTestId("central-vendas-armazem")).toContainText(armazem.rotulo);

  // Condição padrão pelo caminho da escolha manual: o plano é calculado (duas parcelas)
  await abrirAbaDoLancamento(page, "Financeiro");
  await expect(page.getByTestId("condicao-pagamento").locator('[data-campo="condicao_pagamento_id"]')).toContainText(condicao.nome);
  // VISUAL-UX-02 (decisão 270): o desenho não tem o subtítulo "Plano de parcelas"; a prova é o plano calculado na coluna.
  await expect(page.getByLabel("Nº de parcelas", { exact: true }), "o plano calculado pela condição padrão: duas parcelas").toHaveValue("2");
});

test("LB-W2 — natureza inativada: a Central abre o campo EDITÁVEL, vazio, com o aviso", async ({ page }) => {
  expect(layout && natureza.id, "depende do LB-W1").toBeTruthy();
  await login(page);
  await api(page, "PUT", `/api/resources/financial_categories/${natureza.id}`, { is_active: false });
  naturezaInativada = true;
  const d = await api<Detalhe>(page, "GET", `${BASE}/${layout}`);
  expect(d.padroesInvalidos, "premissa: o servidor já a vê como inválida").toEqual(["categoria_financeira_id"]);

  await abrirCentral(page, top);
  const nat = campo(page, "categoria_financeira_id");
  await expect(nat, "o campo continua na tela").toBeVisible();
  await expect(nat.getByTestId("padrao-invalido-aviso")).toHaveText(AVISO_CENTRAL);
  await expect(page.locator('fieldset[data-editavel="false"] [data-campo="categoria_financeira_id"]'), "não travado").toHaveCount(0);
  await expect(nat.locator("button.cmd-display")).toBeEnabled();
  await expect(nat).not.toContainText(natureza.nome);

  // O editor aponta o padrão morto (A3-1c: na prévia da página, selo `config-marca-padrao-invalido` no campo;
  // antes: linha `layout-campo-<k>` do diálogo). A3-1d (decisão 262): não há passo "Editar" — só olhar a prévia, sem
  // mexer em nada (abrirEditor confere que nada ficou pendente: Salvar desligado).
  await abrirEditor(page, layout);
  await expect(page.getByTestId("config-campo-categoria_financeira_id")).toContainText("Padrão inválido");
  await expect(page.getByTestId("config-campo-categoria_financeira_id").getByTestId("config-marca-padrao-invalido")).toHaveCount(1);
});

test("LB-W3 — Exportar → Importar pela tela: \"(importado)\" aparece na lista", async ({ page }, testInfo) => {
  expect(layout, "depende do LB-W1").toBeTruthy();
  await login(page);
  // Reativa a natureza do W2: inativa, ela seria REMOVIDA na importação e a Natureza (obrigatória, não editável) reprovaria
  if (naturezaInativada) { await api(page, "PUT", `/api/resources/financial_categories/${natureza.id}`, { is_active: true }); naturezaInativada = false; }
  const d = await api<Detalhe>(page, "GET", `${BASE}/${layout}`);
  expect(d.padroesInvalidos, "premissa: nenhum padrão morto").toEqual([]);
  await page.goto(ROTA_LAYOUTS);
  await expect(page.getByTestId("layouts-documento")).toBeVisible();

  // A3-1d (decisão 262): Exportar saiu do menu "⋯" da linha (e da área) para a barra da grade — age sobre a linha
  // SELECIONADA: clicar na linha, conferir a seleção, Exportar.
  const linha = linhaDaLista(page, layout);
  await expect(linha).toHaveCount(1);
  await page.getByTestId(`layout-linha-${layout}`).click();
  await expect(page.getByTestId(`layout-linha-${layout}`)).toHaveAttribute("data-selecionado", "true");
  const baixando = page.waitForEvent("download");
  await page.getByTestId("layouts-barra").getByTestId("layouts-exportar").click();
  const download = await baixando;
  expect(download.suggestedFilename()).toBe(`layout-${d.code}.json`);
  const arquivo = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(arquivo);

  const importar = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `${BASE}/importar`);
  await page.getByTestId("layouts-importar-arquivo").setInputFiles(arquivo);
  const r = await importar;
  expect(r.status(), "importado").toBe(201);
  const corpo = (await r.json()) as { id: string; code: string; nome: string; removidos: unknown[] };
  criados.push(corpo.id);
  expect(corpo.nome).toBe(`${NOME_LAYOUT} (importado)`);
  expect(corpo.removidos, "mesma organização: nada removido").toEqual([]);
  const resultado = page.getByTestId("layouts-importar-resultado");
  await expect(resultado).toContainText(`${NOME_LAYOUT} (importado)`);
  await resultado.getByRole("button", { name: "Fechar", exact: true }).last().click();
  await expect(linhaDaLista(page, corpo.id)).toContainText(`${NOME_LAYOUT} (importado)`);
  // A3-1d (decisão 262): importado com sucesso, a grade SELECIONA o layout importado (a área abre nele).
  await expect(page.getByTestId(`layout-linha-${corpo.id}`)).toHaveAttribute("data-selecionado", "true");
});
