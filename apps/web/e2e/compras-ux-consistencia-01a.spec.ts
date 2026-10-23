import type { Page, Request, Response } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { api, empresaAtiva, login, uniq, abrirObservacaoDaCompra, abrirAbaDoPainelDeCompras } from "./helpers";
import { hojeISO } from "./estoque-01-comum";
import { test, expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed } from "./central-compras-fixtures";
import { base64DaNota, cnpjDeEmitenteSintetico, notaSintetica } from "./compras-f7-nfe-sintetica";

/**
 * COMPRAS-UX-CONSISTENCIA-01 Slice A (F2, decisão 320) — paridade observável criação → salva ABERTA →
 * consulta → edição → consulta; plano com entrada; XML ABERTA; classificação/rateio sem duplicar.
 *
 * O servidor é o árbitro (GET :id / PATCH). A tela é conferida por testid e abas. Fixtures efêmeras
 * (`central-compras-fixtures`). Sem produção, sem autoconfirmação. Screenshots em EVIDENCIA_DIR ou
 * `test-results/compras-ux-01a` (fora do Git).
 */

test.use({ viewport: { width: 1440, height: 900 } });

const P = "central-compras";
const caminho = (r: Request | Response) => new URL(r.url()).pathname;

interface Cenario {
  empresa: string; natureza: string; centro: string; naturezaLabel: string; centroLabel: string;
  local: { id: string; nome: string }; produto: { id: string; nome: string }; fornecedor: string; topCompra: string;
}

async function cenario(page: Page, rotulo: string): Promise<Cenario> {
  const ref = await referenciasDoSeed(page);
  const empresa = await empresaAtiva(page);
  const produtoNome = uniq(`UX1 ${rotulo} prod`);
  const produto = await criarCadastro(page, "products", {
    description: produtoNome, group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id
  });
  const fornecedor = (await criarCadastro(page, "people", { name: uniq(`UX1 ${rotulo} forn`), person_type: "legal", is_provider: true })).id;
  const l = await criarCadastro(page, "warehouses", {
    empresa_id: empresa, initials: `U${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    description: uniq(`UX1 ${rotulo} local`), type: "inputs"
  });
  const local = { id: l.id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${l.id}`))["description"]) };
  const topCompra = (await criarTop(page, { codigo: codigoTop("UXc"), codigoBase: "compras.compra", nome: uniq(`UX1 ${rotulo} compra`) })).id;
  return {
    empresa, natureza: ref.natureza.id, centro: ref.centro.id,
    naturezaLabel: ref.natureza.label, centroLabel: ref.centro.label,
    local, produto: { id: produto.id, nome: produtoNome }, fornecedor, topCompra
  };
}

type DocLido = {
  id: string; codigo: string; situacao: string; version?: string; observacao: string | null; valor_total: string;
  plano_parcelas?: Record<string, unknown> | null; parcelas_nota?: unknown; chave_acesso?: string | null;
  categoria_financeira_id?: string | null; centro_custo_id?: string | null; rateio?: unknown;
  valor_ipi?: string | null; frete?: string | null;
};

const ler = (page: Page, id: string) => api<DocLido>(page, "GET", `/api/compras/compras/${id}`);

async function abrirConsulta(page: Page, doc: DocLido, situacao = "aberto") {
  await page.goto(`/compras/compras/${doc.id}`);
  await expect(page.getByTestId(`${P}-identidade-nome`), "consulta deste documento").toHaveText(doc.codigo);
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", situacao);
}

async function abrirEdicao(page: Page, doc: DocLido) {
  /* Prefetch + cache do /edicao: o 2º Editar pode não ir ao fio — a UI basta. */
  const doFio = page.waitForResponse(
    (r) => r.request().method() === "GET" && caminho(r) === `/api/compras/compras/${doc.id}/edicao`,
    { timeout: 8_000 }
  ).catch(() => null);
  await expect(page.getByTestId("compras-editar")).toBeEnabled();
  await page.getByTestId("compras-editar").click();
  const fio = await doFio;
  if (fio) expect(fio.status()).toBe(200);
  await expect(page.getByTestId("compras-central")).toHaveAttribute("data-modo", "edicao");
  await expect(page.getByTestId("compras-central")).toHaveAttribute("data-documento-id", doc.id);
  await expect(page.getByTestId("compras-salvar")).toBeEnabled();
}

async function abrirAbaConsulta(page: Page, nome: string) {
  const aba = page.getByTestId(`${P}-painel`).getByRole("tab", { name: new RegExp(`^${nome}`) });
  await expect(aba, `aba consulta "${nome}"`).toBeVisible();
  await aba.click();
  await expect(aba).toHaveAttribute("aria-selected", "true");
}

function rotulosDasAbas(page: Page) {
  return page.getByTestId(`${P}-painel`).getByRole("tab").allTextContents();
}

async function foto(page: Page, pasta: string, nome: string) {
  fs.mkdirSync(pasta, { recursive: true });
  const arquivo = path.join(pasta, `${nome}.png`);
  await page.screenshot({ path: arquivo, fullPage: false });
  expect(fs.statSync(arquivo).size, `${nome} gravada`).toBeGreaterThan(5_000);
}

const pastaEvidencia = () => process.env.EVIDENCIA_DIR ?? path.resolve("test-results", "compras-ux-01a");

/* ═════════════════════════════════ UX1-1 — paridade salva → consulta → edição ═════════════════════════════════ */

test("UX1-1 — compra ABERTA com plano (entrada + 2 parcelas + obs): consultar → Editar → consultar; mesmas datas/valores/obs; abas Totais/Financeiro/Rateio/Fiscal; PATCH de observação não muda plano/fiscal/rateio", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  const c = await cenario(page, "UX1-1");
  const pasta = pastaEvidencia();

  const plano = {
    installments: 2,
    first_due_date: "2026-08-01",
    mode: "interval" as const,
    interval_days: 30,
    has_down_payment: true,
    down_payment_value: "100.00",
    down_payment_date: "2026-07-15",
    parcelas: [
      { vencimento: "2026-07-15", valor: "100.00", observacao: "entrada UX1" },
      { vencimento: "2026-08-01", valor: "200.00", observacao: "parcela 1 UX1" },
      { vencimento: "2026-08-31", valor: "200.00", observacao: "parcela 2 UX1" }
    ]
  };

  const { id } = await api<{ id: string }>(page, "POST", "/api/compras/compras", {
    empresa_id: c.empresa, tipo_operacao_id: c.topCompra, fornecedor_id: c.fornecedor, data_documento: hojeISO(),
    categoria_financeira_id: c.natureza, centro_custo_id: c.centro, observacao: "obs inicial UX1",
    plano_parcelas: plano,
    itens: [{ produto_id: c.produto.id, armazem_id: c.local.id, quantidade: "5", valor_unitario: "100.00" }]
  });
  const doc = await ler(page, id);
  expect(doc.situacao, "premissa: nasce ABERTA").toBe("aberto");
  expect(doc.valor_total).toBe("500.00");
  expect(doc.plano_parcelas, "plano gravado com parcelas[]").toMatchObject({
    has_down_payment: true, installments: 2,
    parcelas: [
      expect.objectContaining({ vencimento: "2026-07-15", valor: "100.00", observacao: "entrada UX1" }),
      expect.objectContaining({ vencimento: "2026-08-01", valor: "200.00", observacao: "parcela 1 UX1" }),
      expect.objectContaining({ vencimento: "2026-08-31", valor: "200.00", observacao: "parcela 2 UX1" })
    ]
  });

  // CONSULTA
  await abrirConsulta(page, doc);
  const abasConsulta1 = await rotulosDasAbas(page);
  expect(abasConsulta1.join(" | ")).toMatch(/Totais/);
  expect(abasConsulta1.join(" | ")).toMatch(/Financeiro/);
  expect(abasConsulta1.join(" | ")).toMatch(/Rateio e classificação/);
  await abrirAbaConsulta(page, "Financeiro");
  const gradeConsulta = page.getByTestId("compras-consulta-parcelas");
  await expect(gradeConsulta.getByTestId("compras-consulta-parcela")).toHaveCount(3);
  await expect(gradeConsulta.getByTestId("compras-consulta-parcela").nth(0)).toHaveAttribute("data-entrada", "sim");
  await expect(gradeConsulta.getByTestId("compras-consulta-parcela").nth(0)).toContainText("100,00");
  await expect(gradeConsulta.getByTestId("compras-consulta-parcela").nth(0)).toContainText("entrada UX1");
  await expect(gradeConsulta.getByTestId("compras-consulta-parcela").nth(1)).toContainText("200,00");
  await expect(gradeConsulta.getByTestId("compras-consulta-parcela").nth(1)).toContainText("parcela 1 UX1");
  await expect(gradeConsulta.getByTestId("compras-consulta-parcela").nth(2)).toContainText("parcela 2 UX1");
  // Cronograma em CampoLeitura: 3× "Vencimento" nas linhas; sem o campo solto do cabeçalho (data_vencimento).
  await expect(gradeConsulta.locator('[data-campo="Vencimento"]')).toHaveCount(3);
  await expect(page.getByTestId(`${P}-painel`).locator('[data-campo="data_vencimento"]')).toHaveCount(0);
  await abrirAbaConsulta(page, "Totais");
  await expect(page.getByTestId("compras-consulta-total")).toContainText("500,00");
  await abrirAbaConsulta(page, "Rateio e classificação");
  await expect(page.getByTestId(`${P}-painel`).getByRole("tabpanel")).toContainText(/Nutrição Animal|Adm Geral|natureza|centro/i);
  await foto(page, pasta, "ux1-1-consulta-1440x900");

  await page.setViewportSize({ width: 1280, height: 720 });
  await foto(page, pasta, "ux1-1-consulta-1280x720");
  await page.setViewportSize({ width: 1440, height: 900 });

  // EDIÇÃO — grade com mesmas 3 linhas; alterar só observação permitida
  await abrirEdicao(page, doc);
  await abrirAbaDoPainelDeCompras(page, "Financeiro");
  await expect(page.getByTestId("compras-parcelas-lista").getByTestId("compras-parcela")).toHaveCount(3);
  await expect(page.getByTestId("compras-parcela-observacao-0")).toHaveValue("entrada UX1");
  await expect(page.getByTestId("compras-parcela-observacao-1")).toHaveValue("parcela 1 UX1");
  await expect(page.getByTestId("compras-parcela-valor-0")).toHaveValue(/100/);
  await expect(page.getByTestId("compras-parcela-valor-1")).toHaveValue(/200/);
  await abrirAbaDoPainelDeCompras(page, "Rateio e classificação");
  // `compras-rateio` é filho de `compras-rateio-e-itens` — `.or()` resolve 2 nós e quebra o strict mode.
  await expect(page.getByTestId("compras-rateio-e-itens")).toBeVisible();
  // Dados principais NÃO duplicam rateio
  await expect(page.getByTestId(`${P}-dados`).locator('[data-testid^="compras-rateio-linha-"]')).toHaveCount(0);
  await foto(page, pasta, "ux1-1-edicao-1440x900");

  await abrirObservacaoDaCompra(page);
  await page.getByTestId("compras-observacao").fill("obs editada UX1-1");
  const patch = page.waitForResponse((r) => r.request().method() === "PATCH" && caminho(r) === `/api/compras/compras/${doc.id}`);
  await page.getByTestId("compras-salvar").click();
  const r = await patch;
  expect(r.status()).toBe(200);
  const corpo = r.request().postDataJSON() as Record<string, unknown>;
  expect(corpo["version"]).toBe("0");
  expect(corpo["observacao"]).toBe("obs editada UX1-1");
  for (const k of ["plano_parcelas", "rateio", "chave_acesso", "valor_ipi", "numero_nota", "itens", "frete"]) {
    expect(Object.hasOwn(corpo, k), `${k} não viaja na PATCH só de observação`).toBe(false);
  }

  // CONSULTA de novo — mesmas parcelas; observação nova
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");
  const depois = await ler(page, id);
  expect(depois.version).toBe("1");
  expect(depois.observacao).toBe("obs editada UX1-1");
  expect(depois.plano_parcelas).toMatchObject({
    parcelas: [
      expect.objectContaining({ vencimento: "2026-07-15", valor: "100.00", observacao: "entrada UX1" }),
      expect.objectContaining({ vencimento: "2026-08-01", valor: "200.00", observacao: "parcela 1 UX1" }),
      expect.objectContaining({ vencimento: "2026-08-31", valor: "200.00", observacao: "parcela 2 UX1" })
    ]
  });
  expect(depois.categoria_financeira_id).toBe(c.natureza);
  expect(depois.centro_custo_id).toBe(c.centro);

  await abrirAbaConsulta(page, "Financeiro");
  await expect(page.getByTestId("compras-consulta-parcelas").getByTestId("compras-consulta-parcela")).toHaveCount(3);
  await expect(page.getByTestId("compras-consulta-parcelas").getByTestId("compras-consulta-parcela").nth(0)).toContainText("entrada UX1");

  // Reabrir edição: grade intacta
  await abrirEdicao(page, depois);
  await abrirAbaDoPainelDeCompras(page, "Financeiro");
  await expect(page.getByTestId("compras-parcelas-lista").getByTestId("compras-parcela")).toHaveCount(3);
  await expect(page.getByTestId("compras-parcela-observacao-2")).toHaveValue("parcela 2 UX1");
});

/* ═════════════════════════════════ UX1-2 — XML gera ABERTA, fiscal travado na revisão ═════════════════════════════════ */

test("UX1-2 — XML: gerar compra ABERTA → consulta com parcelas_nota → Editar sem autoconfirmar; dados fiscais da NF em leitura", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  const empresa = await empresaAtiva(page);
  const ref = await referenciasDoSeed(page);
  const portas = await api<{ capacidades?: Record<string, unknown> }>(page, "GET", "/api/compras/compras/operation-types");
  expect(portas.capacidades?.["importacaoXml"], "premissa: capacidade importacaoXml").toBe(1);

  const emitente = cnpjDeEmitenteSintetico();
  const forn = await criarCadastro(page, "people", {
    name: uniq("UX1-2 forn"), person_type: "legal", is_provider: true, document: emitente
  });
  const prod = await criarCadastro(page, "products", {
    description: uniq("UX1-2 prod"), group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id
  });
  const arm = await criarCadastro(page, "warehouses", {
    empresa_id: empresa, initials: `U${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    description: uniq("UX1-2 local"), type: "inputs"
  });
  const top = (await criarTop(page, { codigo: codigoTop("UXx"), codigoBase: "compras.compra", nome: uniq("UX1-2 compra") })).id;
  const nota = notaSintetica({ emitenteCnpj: emitente, emitenteNome: `Emitente UX1-2 ${uniq("x")}` });
  const pasta = pastaEvidencia();

  const conf = await api<{ id: string }>(page, "POST", "/api/compras/importacoes", {
    nome_arquivo: "ux1-2.xml", arquivo_base64: base64DaNota(nota), empresa_id: empresa
  });
  const compra = await api<{ id: string; codigo: string; situacao: string }>(page, "POST", `/api/compras/importacoes/${conf.id}/gerar-compra`, {
    tipo_operacao_id: top, fornecedor_id: forn.id,
    financeiro: { parcelas: "nota", rateio: { tipo: "documento", categoria_financeira_id: ref.natureza.id, centro_custo_id: ref.centro.id } },
    itens: [{ n_item: 1, produto_id: prod.id, fator: "12", tipo_fator: "multiply", armazem_id: arm.id }]
  });
  expect(compra.situacao, "XML gera ABERTA — nunca confirmada sozinha").toBe("aberto");

  const doc = await ler(page, compra.id);
  expect(doc).toMatchObject({
    situacao: "aberto", chave_acesso: nota.chave, valor_total: "1080.00", valor_ipi: "50.00", frete: "30.00"
  });
  expect(doc.parcelas_nota).toEqual(nota.duplicatas);

  await abrirConsulta(page, doc);
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");
  await abrirAbaConsulta(page, "Financeiro");
  await expect(page.getByTestId("compras-consulta-parcelas").getByTestId("compras-consulta-parcela")).toHaveCount(2);
  await expect(page.getByTestId("compras-consulta-parcelas").getByTestId("compras-consulta-parcela").nth(0)).toHaveAttribute("data-origem", "nota");
  await expect(page.getByTestId("compras-consulta-parcelas").getByTestId("compras-consulta-parcela").nth(0)).toContainText("540,00");
  await abrirAbaConsulta(page, "Fiscal");
  await expect(page.getByTestId("compras-consulta-dados-fiscais")).toBeVisible();
  // Painel fiscal mostra chave formatada (e UF/tipo); número da NF mora em Dados/Nota quando o layout o traz.
  await expect(page.getByTestId("compras-consulta-chave")).toBeVisible();
  await expect(page.getByTestId("compras-consulta-dados-fiscais")).toContainText(/chave|NF-e|GO/i);
  await foto(page, pasta, "ux1-2-xml-consulta-1440x900");

  await abrirEdicao(page, doc);
  await expect(page.getByTestId("compras-central")).toHaveAttribute("data-modo", "edicao");
  await expect(page.getByTestId(`${P}-confirmar`), "edição não autoconfirma").toHaveCount(0);
  await expect(page.getByTestId("compras-salvar")).toHaveAttribute("aria-label", "Salvar");
  const abaFiscal = page.getByTestId("central-compras-painel").getByRole("tab", { name: /^Fiscal/ });
  await expect(abaFiscal, "compra XML abre Fiscal na edição (dados da NF)").toBeVisible();
  await abaFiscal.click();
  await expect(page.getByTestId("central-compras-painel").getByRole("tabpanel")).toContainText(/chave|nota|NFe|fiscal/i);
  await foto(page, pasta, "ux1-2-xml-edicao-1440x900");

  const ainda = await ler(page, compra.id);
  expect(ainda.situacao).toBe("aberto");
  expect(ainda.chave_acesso).toBe(nota.chave);
});

/* ═════════════════════════════════ UX1-3 — rateio por valor: conta opcional; sem duplicar nos Dados ═════════════════════════════════ */

test("UX1-3 — rateio: grade no painel; Conta Contábil e Safra sempre à vista; Dados sem linhas de rateio", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const portas = await api<{ capacidades?: Record<string, unknown> }>(page, "GET", "/api/compras/compras/operation-types");
  expect(portas.capacidades?.["importacaoXml"], "premissa: importacaoXml (rateio no painel)").toBe(1);

  const empresa = await empresaAtiva(page);
  const ref = await referenciasDoSeed(page);
  const forn = await criarCadastro(page, "people", { name: uniq("UX1-3 forn"), person_type: "legal", is_provider: true });
  const fornNome = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${forn.id}`))["name"]);
  const prod = await criarCadastro(page, "products", {
    description: uniq("UX1-3 prod"), group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id
  });
  const prodNome = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${prod.id}`))["description"]);
  const arm = await criarCadastro(page, "warehouses", {
    empresa_id: empresa, initials: `R${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    description: uniq("UX1-3 local"), type: "inputs"
  });
  const armNome = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${arm.id}`))["description"]);
  const top = (await criarTop(page, { codigo: codigoTop("UXr"), codigoBase: "compras.compra", nome: uniq("UX1-3 compra") })).id;
  const pasta = pastaEvidencia();

  await page.goto(`/compras/compras/new?tipo_operacao_id=${top}`);
  const central = page.getByTestId("compras-central");
  await expect(central).toHaveAttribute("data-especie", "compra");

  const escolherEm = async (rotulo: string, nome: string) => {
    const r = central.locator("label", { hasText: rotulo }).first();
    const dentro = r.locator("button");
    await ((await dentro.count()) > 0 ? dentro.first() : r.locator("..").locator("button").first()).click();
    const pop = page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last();
    await pop.getByPlaceholder(/^Pesquisar/).first().fill(nome.slice(0, 20));
    await pop.getByRole("option", { name: new RegExp(nome.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).first().click();
  };
  await escolherEm("Fornecedor", fornNome);
  await page.getByTestId(`${P}-adicionar-item`).click();
  const linha = page.getByTestId(`${P}-linha`).first();
  // Local POR LINHA (decisão 319): sem campo de cabeçalho — escolhe na célula da grade.
  await linha.getByTestId(`${P}-armazem`).click();
  const pesquisaLocal = page.getByTestId(`${P}-pesquisa`);
  await pesquisaLocal.getByRole("combobox").fill(armNome);
  await pesquisaLocal.getByRole("option").filter({ hasText: armNome }).first().click();
  await expect(pesquisaLocal).toHaveCount(0);
  await linha.getByTestId(`${P}-produto`).click();
  const pesquisa = page.getByTestId(`${P}-pesquisa`);
  await pesquisa.getByRole("combobox").fill(prodNome);
  await pesquisa.getByRole("option").filter({ hasText: prodNome }).first().click();
  await linha.getByLabel("Quantidade do item 1").fill("2");
  await linha.getByLabel("Valor unitário do item 1").fill("50");

  await abrirAbaDoPainelDeCompras(page, "Rateio e classificação");
  const rateio = page.getByTestId("compras-rateio-e-itens");
  await expect(rateio).toBeVisible();
  await expect(page.getByTestId(`${P}-dados`).locator('[data-testid^="compras-rateio-linha-"]')).toHaveCount(0);
  await expect(page.getByTestId(`${P}-dados`).getByTestId("compras-rateio-tipo")).toHaveCount(0);
  await expect(rateio.getByTestId("compras-rateio-tipo"), "sem seletor Como classificar").toHaveCount(0);
  await expect(rateio.getByTestId("compras-classificacao-unica")).toBeVisible();
  await expect(rateio.getByTestId("compras-rateio-natureza-linha-0")).toBeVisible();
  await expect(rateio.getByTestId("compras-rateio-centro-linha-0")).toBeVisible();
  // Conta Contábil na aba; Safra nos Dados — sem Detalhes contábeis / dependência
  await expect(rateio.getByTestId("compras-rateio-conta")).toBeVisible();
  await expect(rateio.getByTestId("compras-safra")).toHaveCount(0);
  await expect(page.getByTestId(`${P}-dados`).getByTestId("compras-safra")).toBeVisible();
  await expect(rateio.getByTestId("compras-rateio-linha-0-detalhes")).toHaveCount(0);
  await expect(rateio.getByTestId("compras-classificacao-gasto")).toBeVisible();
  await foto(page, pasta, "ux1-3-rateio-por-valor-1440x900");

  // Mobile: inspeção visual (UI-SUPPORT-MATRIX DEFERRED) — não certifica suporte móvel
  await page.setViewportSize({ width: 390, height: 844 });
  await foto(page, pasta, "ux1-3-rateio-mobile-inspecao-nao-gate");
  await page.setViewportSize({ width: 1440, height: 900 });
});
