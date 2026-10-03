import type { Page } from "@playwright/test";
import { login, api, uniq, empresaAtiva, abrirLancamentoDeVendas, escolherTopEContinuar } from "./helpers";
import { test, expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed } from "./central-compras-fixtures";

/**
 * O MOTOR DA CENTRAL NA F5b — AS OUTRAS CENTRAIS NÃO MUDAM (OPERACOES-01 F5b, decisão 282) · F5B-M1 e F5B-M2.
 *
 * ┌─ O QUE ESTE ARQUIVO PROVA ─────────────────────────────────────────────────────────────────────┐
 * │ A F5b acrescentou ao motor (`features/central/itens.tsx` e `itens-salvos.tsx`) o que a Central  │
 * │ de Estoque precisa: na criação, `linhaNovaEmBranco`, `subtotal` e `casasDaQuantidade`; na       │
 * │ consulta, `subtotal: null`, `rotulos`, `colunasExtras` e `formularioPelasColunas`. Todos        │
 * │ OPCIONAIS, com o padrão de HOJE (o formulário de leitura com a lista fixa de sempre).           │
 * │ Aqui se prova, nas duas Centrais que NÃO os passam, que o padrão é mesmo o de hoje:             │
 * │ F5B-M1 Central de Vendas — na consulta de uma venda salva pela API, o subtotal é o DO SERVIDOR, │
 * │        a quantidade em 2 casas, e a grade, o formulário de leitura e o "Configurar colunas"     │
 * │        têm os rótulos fixos de sempre, sem coluna a mais; na criação, a linha nova nasce com    │
 * │        quantidade "1" e unitário "0", o rodapé soma a linha e a célula não ativa mostra a       │
 * │        quantidade em 2 casas.                                                                    │
 * │ F5B-M2 Central de Compras — o mesmo, com o prefixo da compra (a consulta da compra em 4 casas,  │
 * │        como já era: ela passa `casasDaQuantidade={4}` ao `ItensSalvos`).                        │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 * O lado do estoque (a linha em branco, o rodapé sem subtotal, "Custo unitário", as colunas extras) é provado pelos
 * specs da Central de Estoque (ES-W1 de `estoque-01-documento.spec.ts`; MI-W1 de `f5b-movimentacao-interna.spec.ts`).
 *
 * ┌─ A REGRA ANTI-VACUIDADE ───────────────────────────────────────────────────────────────────────┐
 * │ "Sem coluna a mais" é IGUALDADE EXATA da lista inteira, lida depois de a grade ter a linha do    │
 * │ servidor. O subtotal do servidor é LIDO antes de ser comparado (premissa: 2,5 × 12,40 = 31,00 na │
 * │ venda; 3 × 4,50 = 13,50 na compra). Na criação, o rodapé é afirmado "R$ 0,00" ANTES do item (o  │
 * │ rodapé existe e soma), e a linha nova é afirmada existente e MARCADA antes de ler os seus campos.│
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Cada caso monta os PRÓPRIOS cadastros pela API (cliente ou fornecedor, local de estoque, produto, TOP); a referência
 * do seed (unidade, grupo, natureza, centro) vem pelo NOME. Os cadastros saem no fim, passou ou falhou
 * (`central-compras-fixtures.ts`); os documentos ficam (o ledger é imutável).
 */

/** A grade da consulta, na ordem do adaptador de cada espécie — os rótulos fixos do motor. */
const COLUNAS_DA_CONSULTA_DE_VENDA = ["Local de estoque", "Código", "Produto", "Estoque", "Quantidade", "Valor unitário", "Desconto", "Desconto %", "Total"];
const COLUNAS_DA_CONSULTA_DE_COMPRA = ["Local de estoque", "Código", "Produto", "Quantidade", "Valor unitário", "Desconto", "Desconto %", "Total", "Lote", "Validade"];
/** O formulário de leitura do motor (a lista dele, a mesma nas duas espécies); a compra acrescenta Lote e Validade. */
const CAMPOS_DA_CONSULTA_DE_VENDA = ["Local de estoque", "Produto", "Estoque", "Unidade", "Quantidade", "Valor unitário", "Desconto", "Desconto %", "Total"];
const CAMPOS_DA_CONSULTA_DE_COMPRA = [...CAMPOS_DA_CONSULTA_DE_VENDA, "Lote", "Validade"];
/** As caixas do "Configurar colunas": "Mostrar <rótulo>", na ordem da lista. */
const caixas = (rotulos: readonly string[]) => rotulos.map((r) => `Mostrar ${r}`);

/** O valor em reais como o motor o escreve (`brl`): "R$ 31,00". */
const reais = (v: string | number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v));

/** O produto (unidade, grupo e natureza do seed, pelo nome) e o local de estoque da empresa ativa — do caso. */
async function produtoELocal(page: Page, rotulo: string) {
  const ref = await referenciasDoSeed(page);
  const empresa = await empresaAtiva(page);
  const produto = await criarCadastro(page, "products", {
    description: uniq(`${rotulo} produto`), group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id
  });
  const local = await criarCadastro(page, "warehouses", {
    empresa_id: empresa, initials: `M${Date.now().toString(36).slice(-4).toUpperCase()}`, description: uniq(`${rotulo} local`), type: "inputs"
  });
  return { ref, empresa, produto: produto.id, local: local.id };
}

/** As caixas do "Configurar colunas" da visão atual (aberto e fechado por Esc), na ordem da lista. */
async function caixasDoConfigurar(page: Page, p: string) {
  await page.getByTestId(`${p}-configurar`).click();
  const config = page.getByTestId(`${p}-configuracao`);
  await expect(config, "o Configurar colunas abriu").toBeVisible();
  const nomes = await config.getByRole("list").getByRole("checkbox").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  await page.keyboard.press("Escape");
  await expect(config).toHaveCount(0);
  return nomes;
}

/**
 * O que a CONSULTA desenha com os rótulos do motor: o cabeçalho da grade, as caixas do "Configurar colunas" da grade, os
 * campos do formulário de leitura (`data-campo` = o rótulo) e as caixas do "Configurar colunas" do formulário. Volta à
 * Grade no fim. Premissa de cada leitura: a visão é a medida (o formulário mostra o item 1 de 1).
 */
async function rotulosDaConsulta(page: Page, p: string) {
  const barraDosItens = page.getByRole("toolbar", { name: "Itens" });
  const colunas = (await page.getByTestId(`${p}-grade`).locator("thead th").allInnerTexts()).map((t) => t.trim());
  const configurarColunas = await caixasDoConfigurar(page, p);
  await barraDosItens.getByRole("button", { name: "Formulário", exact: true }).click();
  const formulario = page.getByTestId(`${p}-item-form`);
  await expect(formulario.getByTestId(`${p}-item-posicao`), "premissa: o formulário mostra o item do servidor").toHaveText("Item 1 de 1");
  const campos = await formulario.locator("[data-campo]").evaluateAll((els) => els.map((e) => e.getAttribute("data-campo")));
  const configurarCampos = await caixasDoConfigurar(page, p);
  await barraDosItens.getByRole("button", { name: "Grade", exact: true }).click();
  await expect(page.getByTestId(`${p}-grade`)).toBeVisible();
  return { colunas, configurarColunas, campos, configurarCampos };
}

/**
 * A CRIAÇÃO, medida no motor: o rodapé antes do item, a linha nova ("1" e "0"), o subtotal da linha e a quantidade da
 * célula não ativa (2 casas, o padrão de `casasDaQuantidade`). Os campos editáveis moram na linha MARCADA.
 */
async function linhaNovaESubtotal(page: Page, p: string) {
  const subtotal = page.getByTestId(`${p}-subtotal`);
  await expect(page.getByTestId(`${p}-linha`), "premissa: a criação abre sem itens").toHaveCount(0);
  await expect(subtotal, "premissa: o rodapé da criação tem o subtotal — zero, sem itens").toHaveText(reais(0));
  await expect(page.getByTestId(`${p}-itens-rodape`)).toContainText("Subtotal dos itens");

  await page.getByTestId(`${p}-adicionar-item`).click();
  const linha = page.getByTestId(`${p}-linha`);
  await expect(linha, "premissa: a linha nova existe").toHaveCount(1);
  await expect(linha, "premissa: e nasce marcada (os campos editáveis moram nela)").toHaveAttribute("aria-selected", "true");
  const quantidade = linha.getByLabel("Quantidade do item 1", { exact: true });
  const unitario = linha.getByLabel("Valor unitário do item 1", { exact: true });
  await expect(quantidade, "a linha nova nasce com a quantidade de sempre: 1").toHaveValue("1");
  await expect(unitario, "e com o unitário de sempre: 0").toHaveValue("0");
  await expect(page.getByTestId(`${p}-itens-contagem`)).toHaveText("(1)");
  await expect(subtotal, "o rodapé soma a linha nova: 1 × 0").toHaveText(reais(0));

  await quantidade.fill("2.5");
  await unitario.fill("12.4");
  await expect(subtotal, "o rodapé mostra o total da linha: 2,5 × 12,40").toHaveText(reais(31));

  // desmarcada, a célula deixa de ser campo e mostra a quantidade formatada
  await linha.getByTestId(`${p}-selecionar-item`).click();
  await expect(linha, "a linha foi desmarcada").toHaveAttribute("aria-selected", "false");
  await expect(linha.getByTestId(`${p}-quantidade`), "a célula não ativa mostra a quantidade em 2 casas").toHaveText("2,50");
  await expect(subtotal, "desmarcar não muda o subtotal").toHaveText(reais(31));
}

/* ═════════════════════════════════════════════ F5B-M1 ═════════════════════════════════════════════ */

test("F5B-M1 — Central de Vendas: o subtotal do servidor e os rótulos de sempre na consulta; a linha nova com '1' e '0' e o subtotal no rodapé da criação", async ({ page }) => {
  await login(page);
  const c = await produtoELocal(page, "F5B-M1");
  const cliente = await criarCadastro(page, "people", { name: uniq("F5B-M1 cliente"), person_type: "legal", is_client: true });
  const top = await criarTop(page, { codigo: codigoTop("5"), codigoBase: "vendas.venda", nome: uniq("Venda F5B-M1") });

  // ── CONSULTA: uma venda salva pela API, lida de volta pela porta da tela
  const { id } = await api<{ id: string }>(page, "POST", "/api/sales/sales", {
    empresa_id: c.empresa, document_date: "2026-09-01", client_id: cliente.id,
    items: [{ product_id: c.produto, warehouse_id: c.local, quantity: "2.5", unit_price: "12.40" }]
  });
  const lida = await api<{ subtotal: string; items: { quantity: string }[] }>(page, "GET", `/api/sales/sales/${id}`);
  expect(Number(lida.subtotal), "premissa: o servidor gravou o subtotal 2,5 × 12,40").toBe(31);
  expect(lida.items.map((i) => Number(i.quantity)), "premissa: um item, de quantidade 2,5").toEqual([2.5]);

  await page.goto(`/vendas/sales/${id}`);
  await expect(page.getByTestId("central-vendas")).toBeVisible();
  await expect(page.getByTestId("central-vendas-linha"), "a grade tem o item do servidor").toHaveCount(1);
  await expect(page.getByTestId("central-vendas-itens-rodape"), "o rodapé da consulta tem a linha do subtotal").toContainText("Subtotal dos itens");
  await expect(page.getByTestId("central-vendas-subtotal"), "o subtotal é o do servidor").toHaveText(reais(lida.subtotal));
  await expect(page.getByTestId("central-vendas-quantidade"), "a quantidade em 2 casas, como sempre na venda").toHaveText("2,50");
  const r = await rotulosDaConsulta(page, "central-vendas");
  expect(r.colunas, "a grade: as colunas de sempre, com os rótulos fixos, nenhuma a mais").toEqual(COLUNAS_DA_CONSULTA_DE_VENDA);
  expect(r.configurarColunas, "o Configurar colunas da grade: os mesmos rótulos").toEqual(caixas(COLUNAS_DA_CONSULTA_DE_VENDA));
  expect(r.campos, "o formulário de leitura: os campos de sempre, nenhum a mais").toEqual(CAMPOS_DA_CONSULTA_DE_VENDA);
  expect(r.configurarCampos, "o Configurar colunas do formulário: os mesmos rótulos").toEqual(caixas(CAMPOS_DA_CONSULTA_DE_VENDA));

  // ── CRIAÇÃO: a linha nova e o rodapé
  await abrirLancamentoDeVendas(page, "sales");
  await escolherTopEContinuar(page, top.id);
  await expect(page.getByTestId("central-vendas")).toBeVisible();
  await linhaNovaESubtotal(page, "central-vendas");
});

/* ═════════════════════════════════════════════ F5B-M2 ═════════════════════════════════════════════ */

test("F5B-M2 — Central de Compras: o subtotal do servidor e os rótulos de sempre na consulta; a linha nova com '1' e '0' e o subtotal no rodapé da criação", async ({ page }) => {
  await login(page);
  const c = await produtoELocal(page, "F5B-M2");
  const fornecedor = await criarCadastro(page, "people", { name: uniq("F5B-M2 forn"), person_type: "legal", is_provider: true });
  const top = await criarTop(page, { codigo: codigoTop("7"), codigoBase: "compras.compra", nome: uniq("Compra F5B-M2") });

  // ── CONSULTA: uma compra salva pela API, lida de volta pela porta da tela
  const { id } = await api<{ id: string }>(page, "POST", "/api/compras/compras", {
    empresa_id: c.empresa, tipo_operacao_id: top.id, fornecedor_id: fornecedor.id, data_documento: "2026-09-01",
    categoria_financeira_id: c.ref.natureza.id, centro_custo_id: c.ref.centro.id,
    itens: [{ produto_id: c.produto, armazem_id: c.local, quantidade: "3", valor_unitario: "4.50" }]
  });
  const lida = await api<{ valor_itens: string; itens: { quantidade: string }[] }>(page, "GET", `/api/compras/compras/${id}`);
  expect(Number(lida.valor_itens), "premissa: o servidor gravou o valor dos itens 3 × 4,50").toBe(13.5);
  expect(lida.itens.map((i) => Number(i.quantidade)), "premissa: um item, de quantidade 3").toEqual([3]);

  await page.goto(`/compras/compras/${id}`);
  await expect(page.getByTestId("central-compras-linha"), "a grade tem o item do servidor").toHaveCount(1);
  await expect(page.getByTestId("central-compras-itens-rodape"), "o rodapé da consulta tem a linha do subtotal").toContainText("Subtotal dos itens");
  await expect(page.getByTestId("central-compras-subtotal"), "o subtotal é o do servidor").toHaveText(reais(lida.valor_itens));
  await expect(page.getByTestId("central-compras-quantidade"), "a quantidade em 4 casas, como já era na compra").toHaveText("3,0000");
  const r = await rotulosDaConsulta(page, "central-compras");
  expect(r.colunas, "a grade: as colunas de sempre, com os rótulos fixos, nenhuma a mais").toEqual(COLUNAS_DA_CONSULTA_DE_COMPRA);
  expect(r.configurarColunas, "o Configurar colunas da grade: os mesmos rótulos").toEqual(caixas(COLUNAS_DA_CONSULTA_DE_COMPRA));
  expect(r.campos, "o formulário de leitura: os campos de sempre, nenhum a mais").toEqual(CAMPOS_DA_CONSULTA_DE_COMPRA);
  expect(r.configurarCampos, "o Configurar colunas do formulário: os mesmos rótulos").toEqual(caixas(CAMPOS_DA_CONSULTA_DE_COMPRA));

  // ── CRIAÇÃO: a linha nova e o rodapé (a compra passa `custoMedioNoUnitario={false}`: nada escreve no "0")
  await page.goto(`/compras/compras/new?tipo_operacao_id=${top.id}`);
  await expect(page.getByTestId("compras-central")).toHaveAttribute("data-especie", "compra");
  await linhaNovaESubtotal(page, "central-compras");
});
