import { test, expect, type Page, type Request } from "@playwright/test";
import { login, api, uniq, pickRef, abrirLancamentoDeVendas, escolherTopEContinuar, escolherPrimeiroProdutoDaLinha, preencherClassificacaoFinanceira, abrirAbaDoLancamento } from "./helpers";
import { sql } from "./aj02-comum";

/**
 * VENDAS-A4 — A CONDIÇÃO DE PAGAMENTO, PELA TELA (API e banco REAIS; nada mockado).
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PROVA ──────────────────────────────────────────────────────────────────┐
 * │ A conta (planoDaCondicao) é do domínio e a gravação é da integração. Aqui se mede o que a TELA   │
 * │ promete: o cadastro em Configurações › Financeiro mostra os campos condicionais só quando valem; │
 * │ escolher a condição na aba Financeiro da Central preenche o plano e esconde o "Parcelamento"; o   │
 * │ corpo SEM ajuste viaja com installment_plan null (quem deriva é o servidor) e COM ajuste leva o   │
 * │ plano; a confirmação gera exatamente os títulos do plano; e a consulta diz "código · nome" e     │
 * │ "(parcelas ajustadas)" quando o usuário mexeu.                                                   │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Anti-vacuidade: toda ausência (campo escondido, plano nulo, marcador ausente) vem depois de uma presença
 * positiva do mesmo alvo — senão um seletor errado deixaria o teste verde.
 */

const WORKSPACE = "central-vendas";
const DATA_DOC = "2026-09-01";
/** "2026-09-01" → "01/09/2026" (a caixa de data da Central é digitada em dd/mm/aaaa) */
/** "01/10/2026" → "2026-10-01" (o que a tela mostra, no formato gravado) */
const isoDeBr = (br: string) => `${br.slice(6, 10)}-${br.slice(3, 5)}-${br.slice(0, 2)}`;
const brData = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Soma dias a uma data ISO (UTC) — só para escrever o esperado; a conta de verdade é do domínio. */
const maisDias = (iso: string, dias: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); };

type Condicao = { id: string; code: string; nome: string };

/** A condição criada pela API oficial do cadastro genérico — a UI do cadastro é medida só no CP-W1. */
async function criarCondicao(page: Page, extra: Record<string, unknown> = {}): Promise<Condicao> {
  const nome = uniq("30/60/90 A4");
  const criada = await api<{ id: string }>(page, "POST", "/api/resources/condicoes_pagamento", {
    nome, parcelas: 3, dias_primeira_parcela: 30, modo: "intervalo", intervalo_dias: 30, entrada: false, is_active: true, ...extra
  });
  const lida = await api<{ id: string; code: string | null; nome: string }>(page, "GET", `/api/resources/condicoes_pagamento/${criada.id}`);
  expect(lida.code, "premissa: o servidor gerou o código da condição").toBeTruthy();
  return { id: lida.id, code: String(lida.code), nome: lida.nome };
}

/** TOP própria da família venda (prefixo 4 — A4 —, para não colidir com os specs vizinhos 5/6/7). */
async function abrirCriacaoDeVenda(page: Page) {
  const codigo = `4${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const top = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase: "vendas.venda", nome: uniq("Condição A4") });
  await abrirLancamentoDeVendas(page, "sales");
  await escolherTopEContinuar(page, top.id);
  await expect(page.getByTestId(WORKSPACE)).toBeVisible();
  await page.getByLabel("Data *", { exact: true }).fill(brData(DATA_DOC));
  await pickRef(page, "Cliente", "DEMO");
  await page.getByRole("button", { name: /Adicionar item/ }).click();
  await escolherPrimeiroProdutoDaLinha(page);
  // total POSITIVO: o plano (entrada, parcelas) e os títulos dependem dele — 1 × 100,00
  const linha = page.getByTestId("central-vendas-linha").first();
  await linha.getByLabel("Quantidade").fill("1");
  await linha.getByLabel("Valor unitário").fill("100");
  await preencherClassificacaoFinanceira(page);
  await abrirAbaDoLancamento(page, "Financeiro");
}

const wrapperCondicao = (page: Page) => page.getByTestId("condicao-pagamento");

async function escolherCondicao(page: Page, c: Condicao) {
  await wrapperCondicao(page).locator("button").first().click();
  await page.getByPlaceholder("Pesquisar...").fill(c.nome);
  await page.locator("[data-radix-popper-content-wrapper]").last().getByRole("option", { name: new RegExp(c.nome.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")) }).first().click();
  await expect(wrapperCondicao(page)).toContainText(c.nome);
}

const plano = (page: Page) => ({
  parcelas: page.getByLabel("Nº de parcelas", { exact: true }),
  primeiro: page.getByLabel("1º vencimento", { exact: true }),
  intervalo: page.getByLabel("Intervalo entre parcelas (dias)", { exact: true }),
  entrada: page.getByLabel("Valor entrada", { exact: true })
});

/** Salva pela Central e devolve o corpo que viajou e o id criado. */
async function salvar(page: Page): Promise<{ corpo: Record<string, unknown>; id: string }> {
  const resposta = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/sales\/sales$/.test(new URL(r.url()).pathname));
  await page.getByRole("button", { name: "Salvar" }).click();
  const r = await resposta;
  expect(r.status(), "a venda foi criada").toBe(201);
  const corpo = (r.request() as Request).postDataJSON() as Record<string, unknown>;
  const { id } = await r.json() as { id: string };
  return { corpo, id };
}

type PlanoGravado = { installments: number; first_due_date: string; mode: string; interval_days: number; has_down_payment: boolean; down_payment_value?: string; down_payment_date?: string };
const planoGravado = (id: string) => JSON.parse(sql(`select installment_plan::text from erp.sales_documents where id = '${id}'`)) as PlanoGravado;

test("CP-W1 — Configurações › Financeiro › Condições de pagamento: código gerado; Dia do vencimento só no Dia fixo; Entrada (%) só com Entrada", async ({ page }) => {
  await login(page);
  await page.goto("/configuracoes?tab=financeiro");
  const abaCondicoes = page.locator("main").getByRole("tab", { name: "Condições de Pagamento", exact: true });
  await expect(abaCondicoes, "a aba existe em Configurações › Financeiro").toBeVisible();
  await abaCondicoes.click();
  await page.locator("main").getByRole("button", { name: /^Novo/ }).first().click();

  const nome = uniq("30/60/90");
  await page.getByLabel(/^Nome( \*)?$/).fill(nome);
  await page.getByLabel(/^Parcelas( \*)?$/).fill("3");
  await page.getByLabel(/^Dias\ até\ a\ 1ª\ parcela( \*)?$/).fill("30");
  await page.getByLabel("Intervalo (dias)", { exact: true }).fill("30");

  // Vencimentos: com "Intervalo em dias" (o padrão) o Dia do vencimento não existe; no "Dia fixo" aparece.
  const vencimentos = page.getByLabel(/^Vencimentos( \*)?$/);
  const diaVencimento = page.getByLabel(/^Dia\ do\ vencimento( \*)?$/);
  await expect(vencimentos, "premissa: o modo nasce Intervalo em dias").toContainText("Intervalo em dias");
  await expect(diaVencimento, "no intervalo, sem Dia do vencimento").toHaveCount(0);
  const escolher = async (campo: ReturnType<Page["getByLabel"]>, opcao: string) => {
    await campo.click();
    await page.locator("[data-radix-popper-content-wrapper], .cmd-panel").last().getByRole("option", { name: opcao, exact: true }).click();
    await expect(campo).toContainText(opcao);
  };
  await escolher(vencimentos, "Dia fixo do mês");
  await expect(diaVencimento, "no Dia fixo, o Dia do vencimento aparece").toBeVisible();
  await escolher(vencimentos, "Intervalo em dias");
  await expect(diaVencimento, "de volta ao intervalo, some de novo").toHaveCount(0);

  // Entrada: sem entrada, sem percentual; com entrada, o percentual aparece.
  const entrada = page.getByLabel("Entrada", { exact: true });
  const percentual = page.getByLabel(/^Entrada\ \(%\)( \*)?$/);
  await expect(entrada, "premissa: o booleano Entrada existe").toBeVisible();
  await expect(percentual, "sem entrada, sem percentual").toHaveCount(0);
  await escolher(entrada, "Sim");
  await expect(percentual, "com entrada, o percentual aparece").toBeVisible();
  await escolher(entrada, "Não");
  await expect(percentual).toHaveCount(0);

  const resposta = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/api/resources/condicoes_pagamento"));
  await page.getByRole("button", { name: /^Salvar/ }).click();
  const r = await resposta;
  expect(r.status(), "a condição foi gravada").toBeLessThan(300);
  const enviado = r.request().postDataJSON() as Record<string, unknown>;
  expect(enviado["code"] ?? null, "o código não é digitado: é o servidor quem gera").toBeNull();
  const { id } = await r.json() as { id: string };
  const lida = await api<Record<string, unknown>>(page, "GET", `/api/resources/condicoes_pagamento/${id}`);
  expect(lida["code"], "o código foi gerado pelo servidor").toBeTruthy();
  expect([lida["nome"], lida["parcelas"], lida["dias_primeira_parcela"], lida["modo"], lida["intervalo_dias"], lida["dia_vencimento"], lida["entrada"], lida["entrada_percentual"]])
    .toEqual([nome, 3, 30, "intervalo", 30, null, false, null]);
});

test("CP-W2 + CP-W5 — escolher a condição preenche o plano; sem ajuste o corpo vai sem plano; a confirmação gera os títulos do plano; a consulta mostra código · nome", async ({ page }) => {
  await login(page);
  const c = await criarCondicao(page);
  await abrirCriacaoDeVenda(page);
  await escolherCondicao(page, c);

  const p = plano(page);
  const primeiro = maisDias(DATA_DOC, 30);
  await expect(p.parcelas).toHaveValue("3");
  await expect(p.primeiro, "1º vencimento = data do documento + 30").toHaveValue(brData(primeiro));
  await expect(p.intervalo).toHaveValue("30");

  const { corpo, id } = await salvar(page);
  expect(corpo["condicao_pagamento_id"], "a condição viaja no corpo").toBe(c.id);
  expect("installment_plan" in corpo, "premissa: a chave do plano existe no corpo").toBe(true);
  expect(corpo["installment_plan"], "sem ajuste, quem deriva o plano é o servidor").toBeNull();

  const lido = await api<Record<string, unknown>>(page, "GET", `/api/sales/sales/${id}`);
  expect([lido["condicao_pagamento_id"], lido["condicao_pagamento_codigo"], lido["condicao_pagamento_nome"], lido["parcelas_ajustadas"]]).toEqual([c.id, c.code, c.nome, false]);
  const gravado = planoGravado(id);
  expect([gravado.installments, gravado.first_due_date, gravado.mode, gravado.interval_days, gravado.has_down_payment], "o plano gravado é o que a tela mostrou")
    .toEqual([3, primeiro, "interval", 30, false]);

  // CP-W5: a consulta em leitura.
  await page.goto(`/vendas/sales/${id}`);
  await expect(page.getByTestId(WORKSPACE)).toBeVisible();
  const consulta = page.getByTestId("consulta-condicao-pagamento");
  await expect(consulta).toContainText(`${c.code} · ${c.nome}`);
  await expect(consulta, "sem ajuste, sem o marcador").not.toContainText("(parcelas ajustadas)");

  // CP-W2: confirmar gera EXATAMENTE as parcelas do plano.
  await api(page, "POST", `/api/sales/sales/${id}/confirm`, {});
  const titulos = sql(`select installment_number || '|' || due_date::text from erp.financial_titles where source_type = 'sales_documents' and source_id = '${id}' and status <> 'cancelled' order by due_date`).split("\n").filter(Boolean);
  expect(titulos, "três títulos, nos vencimentos do plano").toEqual([`1|${primeiro}`, `2|${maisDias(primeiro, 30)}`, `3|${maisDias(primeiro, 60)}`]);
  const soma = sql(`select sum(amount)::text = (select total::text from erp.sales_documents where id = '${id}') from erp.financial_titles where source_type = 'sales_documents' and source_id = '${id}' and status <> 'cancelled'`);
  expect(soma, "a soma dos títulos é o total da venda").toBe("t");
});

test("CP-W3 — ajustar o plano depois de escolher: o corpo leva installment_plan e a consulta diz (parcelas ajustadas)", async ({ page }) => {
  await login(page);
  const c = await criarCondicao(page);
  await abrirCriacaoDeVenda(page);
  await escolherCondicao(page, c);
  const p = plano(page);
  await expect(p.parcelas, "premissa: a condição preencheu 3").toHaveValue("3");
  await p.parcelas.fill("4");

  const { corpo, id } = await salvar(page);
  expect(corpo["condicao_pagamento_id"]).toBe(c.id);
  const enviado = corpo["installment_plan"] as PlanoGravado | null;
  expect(enviado, "com ajuste, o plano viaja").not.toBeNull();
  expect([enviado!.installments, enviado!.first_due_date, enviado!.interval_days]).toEqual([4, maisDias(DATA_DOC, 30), 30]);

  const lido = await api<Record<string, unknown>>(page, "GET", `/api/sales/sales/${id}`);
  expect(lido["parcelas_ajustadas"], "o servidor marcou o ajuste").toBe(true);
  expect(planoGravado(id).installments, "gravou o plano do corpo").toBe(4);

  await page.goto(`/vendas/sales/${id}`);
  const consulta = page.getByTestId("consulta-condicao-pagamento");
  await expect(consulta).toContainText(`${c.code} · ${c.nome}`);
  await expect(consulta).toContainText("(parcelas ajustadas)");
});

test("CP-W4 — mudar a data e a quantidade depois de escolher (sem ajuste): a tela recalcula, o corpo vai sem plano e o gravado é o mostrado", async ({ page }) => {
  await login(page);
  // Com entrada de 10%: o valor da entrada depende do total, então a quantidade TEM efeito visível no plano.
  const c = await criarCondicao(page, { entrada: true, entrada_percentual: "10" });
  await abrirCriacaoDeVenda(page);
  await escolherCondicao(page, c);
  const p = plano(page);
  await expect(p.primeiro, "premissa: 1º vencimento a partir da data inicial").toHaveValue(brData(maisDias(DATA_DOC, 30)));
  await expect(p.entrada, "premissa: a condição com entrada mostra o valor").toBeVisible();
  const entradaAntes = await p.entrada.inputValue();

  const novaData = "2026-09-15";
  await page.getByLabel("Data *", { exact: true }).fill(brData(novaData));
  await page.getByRole("button", { name: "Formulário", exact: true }).click();
  await page.getByTestId("central-vendas-item-form").getByLabel("Quantidade").fill("7");
  await abrirAbaDoLancamento(page, "Financeiro");

  await expect(p.primeiro, "o 1º vencimento acompanhou a data").toHaveValue(brData(maisDias(novaData, 30)));
  await expect(p.parcelas).toHaveValue("3");
  await expect(p.intervalo).toHaveValue("30");
  await expect(p.entrada, "o valor da entrada acompanhou o total").not.toHaveValue(entradaAntes);
  const mostrado = { primeiro: await p.primeiro.inputValue(), entrada: await p.entrada.inputValue() };
  await expect(page.getByLabel("Parcelamento", { exact: true }), "a condição continua escolhida").toHaveCount(0);

  const { corpo, id } = await salvar(page);
  expect(corpo["condicao_pagamento_id"]).toBe(c.id);
  expect(corpo["installment_plan"] ?? null, "recalcular não é ajustar: sem plano no corpo").toBeNull();
  const lido = await api<Record<string, unknown>>(page, "GET", `/api/sales/sales/${id}`);
  expect(lido["parcelas_ajustadas"]).toBe(false);
  const gravado = planoGravado(id);
  expect(gravado.first_due_date, "o servidor derivou o mesmo 1º vencimento").toBe(isoDeBr(mostrado.primeiro));
  expect(Number(gravado.down_payment_value), "e a mesma entrada").toBe(Number(mostrado.entrada));
  expect([gravado.installments, gravado.interval_days, gravado.has_down_payment]).toEqual([3, 30, true]);
});

test("CP-W6 — limpar a condição devolve o Parcelamento À vista/Parcelado", async ({ page }) => {
  await login(page);
  const c = await criarCondicao(page);
  await abrirCriacaoDeVenda(page);
  const parcelamento = page.getByLabel("Parcelamento", { exact: true });
  await expect(wrapperCondicao(page), "o campo da condição existe na aba").toBeVisible();
  await expect(parcelamento, "sem condição, o Parcelamento aparece").toBeVisible();

  await escolherCondicao(page, c);
  await expect(plano(page).parcelas, "a condição abriu o plano").toBeVisible();
  await expect(parcelamento, "com condição, o Parcelamento some").toHaveCount(0);

  await wrapperCondicao(page).getByRole("button", { name: "Limpar" }).click();
  await expect(wrapperCondicao(page)).not.toContainText(c.nome);
  await expect(parcelamento, "limpa a condição, o Parcelamento volta").toBeVisible();
  await expect(parcelamento.locator("option")).toHaveText(["À vista", "Parcelado"]);
});
