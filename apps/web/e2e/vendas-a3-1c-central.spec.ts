import { test, expect, type Page } from "@playwright/test";
import { login, api, uniq, abrirLancamentoDeVendas, escolherTopEContinuar, abrirAbaDoLancamento } from "./helpers";

/**
 * VENDAS-A3-1c — A CENTRAL OBEDECE ÀS ZONAS DO LAYOUT (decisão 261; API e banco REAIS; nada mockado).
 *
 * O configurador (página) é medido em `vendas-a3-1c-configurador.spec.ts`. Aqui o layout é montado PELA API (PUT com a
 * estrutura) e se mede só o que a Central promete: um campo do documento vale em qualquer zona (Vencimento na aba
 * Financeiro), o grupo do cabeçalho decide Dados principais × Dados adicionais (sem campo adicional, o botão some) e
 * as colunas dos itens seguem a ordem do layout.
 *
 * Anti-vacuidade: toda ausência vem depois de uma presença positiva do mesmo alvo (o campo aparece ONDE deve antes de
 * se conferir que não está onde não deve).
 */

const BASE = "/api/admin/layouts-documento";
const FAM = "vendas.pedido";

type Campo = { campo: string; obrigatorio: boolean; editavel: boolean; grupo?: "principal" | "adicionais" };
type Estrutura = { versaoSchema: number; cabecalho: Campo[]; rodape: { aba: string; campos: Campo[] }[]; itens: { campo: string; obrigatorio: boolean }[] };
type Detalhe = { id: string; estrutura: Estrutura };

async function criarTop(page: Page, nome: string): Promise<string> {
  const codigo = `3c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  return (await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase: FAM, nome: uniq(nome) })).id;
}

let criado = "";

test.afterAll(async ({ browser }) => {
  if (!criado) return;
  const page = await browser.newPage();
  try {
    await login(page);
    await api(page, "POST", `${BASE}/${criado}/ativo`, { ativo: false });
  } finally {
    await page.close();
  }
});

test("LC-W3 — Vencimento na aba Financeiro, Proprietário em Dados principais (sem Dados adicionais) e colunas na ordem do layout", async ({ page }) => {
  await login(page);
  const top = await criarTop(page, "LC-W3");
  criado = (await api<{ id: string }>(page, "POST", BASE, { familia: FAM, nome: uniq("LC-W3 Pedido") })).id;
  const d = await api<Detalhe>(page, "GET", `${BASE}/${criado}`);
  const e = d.estrutura;

  // Premissas sobre a cópia do sistema (se mudarem, o teste diria nada)
  const venc = e.cabecalho.find((c) => c.campo === "due_date");
  expect(venc, "premissa: Vencimento nasce no cabeçalho").toBeTruthy();
  expect(e.cabecalho.find((c) => c.campo === "proprietary_id")?.grupo, "premissa: Proprietário nasce em Dados adicionais").toBe("adicionais");
  const iFin = e.rodape.findIndex((a) => a.aba === "Financeiro");
  expect(iFin, "premissa: há a aba Financeiro").toBeGreaterThanOrEqual(0);
  const iProd = e.itens.findIndex((c) => c.campo === "product_id");
  const iArm = e.itens.findIndex((c) => c.campo === "warehouse_id");
  expect(iProd >= 0 && iArm > iProd, "premissa: no sistema, Produto vem antes de Armazém").toBe(true);

  // A estrutura nova: Vencimento → aba Financeiro; Proprietário → "principal"; Armazém antes de Produto.
  const arm = e.itens[iArm]!;
  const itens = e.itens.filter((c) => c.campo !== "warehouse_id");
  itens.splice(itens.findIndex((c) => c.campo === "product_id"), 0, arm);
  const estrutura: Estrutura = {
    ...e,
    cabecalho: e.cabecalho.filter((c) => c.campo !== "due_date").map((c) => (c.campo === "proprietary_id" ? { ...c, grupo: "principal" as const } : c)),
    rodape: e.rodape.map((a, i) => (i === iFin ? { ...a, campos: [...a.campos, { campo: "due_date", obrigatorio: venc!.obrigatorio, editavel: venc!.editavel }] } : a)),
    itens
  };
  await api(page, "PUT", `${BASE}/${criado}`, { estrutura });
  await api(page, "PUT", `${BASE}/${criado}/tops`, { tipoOperacaoIds: [top] });

  // O servidor gravou o que foi pedido (o layout efetivo da TOP é este)
  const efetivo = await api<{ origem: string; id: string }>(page, "GET", `/api/sales/orders/layout-efetivo?tipo_operacao_id=${top}`);
  expect(efetivo).toMatchObject({ origem: "ligado", id: criado });

  await abrirLancamentoDeVendas(page, "orders");
  await escolherTopEContinuar(page, top);
  await expect(page.getByTestId("central-vendas")).toBeVisible();
  const dados = page.getByTestId("central-vendas-dados");

  // Proprietário em Dados principais — visível sem abrir nada — e o botão "Dados adicionais" não existe
  await expect(dados.locator('[data-campo="proprietary_id"]')).toBeVisible();
  await expect(dados.locator('[data-campo="proprietary_id"]')).toContainText("Proprietário");
  await expect(dados.locator('[data-campo="client_id"]'), "presença: o botão ficaria depois dos principais").toBeVisible();
  await expect(dados.getByRole("button", { name: /Dados adicionais/ })).toHaveCount(0);

  // Vencimento: PRESENÇA na aba Financeiro, antes da AUSÊNCIA no cabeçalho
  await abrirAbaDoLancamento(page, "Financeiro");
  const painel = page.getByTestId("central-vendas-painel").getByRole("tabpanel");
  await expect(painel.locator('[data-campo="due_date"]')).toBeVisible();
  await expect(painel.locator('[data-campo="due_date"]')).toContainText("Vencimento");
  await expect(dados.locator('[data-campo="due_date"]')).toHaveCount(0);
  await expect(page.locator('[data-campo="due_date"]'), "um só Vencimento na tela").toHaveCount(1);

  // Colunas dos itens na ordem do layout: Armazém antes de Produto
  const grade = page.getByTestId("central-vendas-itens");
  await expect(grade.locator('th[data-campo="product_id"]')).toBeVisible();
  await expect(grade.locator('th[data-campo="warehouse_id"]')).toBeVisible();
  const ordem = await grade.locator("th[data-campo]").evaluateAll((ths) => ths.map((t) => t.getAttribute("data-campo")));
  expect(ordem.indexOf("warehouse_id"), "Armazém antes de Produto").toBeLessThan(ordem.indexOf("product_id"));
  expect(ordem.indexOf("warehouse_id")).toBeGreaterThanOrEqual(0);
});
