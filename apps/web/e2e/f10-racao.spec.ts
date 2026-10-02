import { test, expect } from "@playwright/test";
import { api, login, pickRef, uniq } from "./helpers";
import { corpoDoPost, criarTopDoModulo, excluirTopDoModulo, sqlE2e, tiposDoModulo } from "./f10-comum";
import { empresaELocal, produtoComSaldo, produtoNovo } from "./f10-pecuaria-comum";

/**
 * OPERACOES-01 F10 (decisão 287) · A CENTRAL DA PRODUÇÃO DE RAÇÃO — `/estoque/batidas/new` no motor da Central.
 *
 * F10-R1, contra a API deste HEAD: uma formulação NOVA (2 de A + 3 de B, acabado C) × multiplicador 2 deriva a grade
 * (4 e 6, "Pela fórmula", quantidade travada) com o local das matérias-primas — escolhido pelos MESMOS rótulos que o
 * LT-K1 usa ("Formulação", "Local de estoque das matérias-primas", "Local de estoque do produto acabado", "Quantidade
 * produzida"); a prévia é 18,00 e 3,60 por unidade; com uma TOP da família escolhida no campo, o POST leva
 * `tipo_operacao_id` (a capacidade está declarada) e as chaves de hoje; o servidor grava a TOP com a versão congelada,
 * baixa 4 e 6 e dá entrada em 5 de C a 3,60.
 */
const P = "central-racao";
const CHAVES_DO_POST = ["batch_date", "destination_warehouse_id", "empresa_id", "formula_id", "multiplier", "origin_warehouse_id", "quantity_produced", "tipo_operacao_id", "validade"];

test("F10-R1 — fórmula × multiplicador 2: itens derivados ('Pela fórmula'), prévia 18,00 / 3,60, POST com a TOP escolhida e as chaves de hoje, 201", async ({ page }) => {
  await login(page);
  const { empresa, local } = await empresaELocal(page, "racao R1");
  const a = await produtoComSaldo(page, { empresa, local: local.id, rotulo: "milho R1", quantidade: "10", custo: "1.5" });
  const b = await produtoComSaldo(page, { empresa, local: local.id, rotulo: "farelo R1", quantidade: "10", custo: "2" });
  const acabado = await produtoNovo(page, "ração acabada R1");
  const formula = await api<{ id: string }>(page, "POST", "/api/stock/feed-formulas", {
    name: uniq("F10 formulação R1"), product_id: acabado.id, items: [{ product_id: a.id, quantity: "2" }, { product_id: b.id, quantity: "3" }]
  });
  const top = await criarTopDoModulo(page, "producao_racao");
  try {
    const capacidade = await tiposDoModulo(page, "producao_racao");
    expect(capacidade.status, "premissa: a API deste HEAD declara a capacidade da produção de ração").toBe(200);
    expect(capacidade.corpo.items.map((t) => t.id), "premissa: a TOP do caso está entre as da família").toContain(top.id);

    await page.goto("/estoque/batidas/new");
    await expect(page.getByTestId(`${P}-identidade-nome`)).toHaveText("Nova produção de ração");
    await page.getByTestId(`${P}-top`).selectOption(top.id);
    await page.getByLabel("Formulação").selectOption(formula.id);
    await page.getByLabel("Multiplicador da receita").fill("2");
    await pickRef(page, "Local de estoque das matérias-primas", local.nome);
    await pickRef(page, "Local de estoque do produto acabado", local.nome);
    await page.getByLabel("Quantidade produzida").fill("5");
    await expect(page.getByTestId(`${P}-produto-acabado`), "o produto acabado é o da formulação").toContainText(acabado.nome);

    await expect(page.getByTestId(`${P}-linha`), "uma linha por matéria-prima").toHaveCount(2);
    // a ordem das linhas é a dos itens da formulação (a lista da API não a fixa): confere-se o conjunto
    await expect.poll(async () => (await page.getByTestId(`${P}-saldo-da-origem`).allInnerTexts()).sort(), { message: "quantidade da fórmula × 2" }).toEqual(["4,0000", "6,0000"]);
    await expect(page.getByTestId(`${P}-grade`).getByRole("columnheader", { name: "Pela fórmula" })).toBeVisible();
    await expect(page.getByTestId(`${P}-adicionar-item`), "itens derivados: sem Adicionar produto").toHaveCount(0);
    await expect(page.getByTestId(`${P}-resumo-custo`), "a prévia: 4 × 1,50 + 6 × 2,00").toContainText(/R\$\s18,00/);
    await expect(page.getByTestId(`${P}-resumo-custo-unitario`), "÷ 5 produzidos").toContainText(/R\$\s3,60/);

    const escrita = corpoDoPost(page, "/api/stock/feed-batches");
    await page.getByTestId(`${P}-salvar`).click();
    const { corpo, status, resposta } = await escrita;
    expect(status, JSON.stringify(resposta)).toBe(201);
    expect(Object.keys(corpo).sort(), "as chaves de hoje (a validade com `loteNaEntrada`) mais a TOP").toEqual(CHAVES_DO_POST);
    expect([corpo["tipo_operacao_id"], corpo["formula_id"], corpo["origin_warehouse_id"], corpo["destination_warehouse_id"], corpo["quantity_produced"], corpo["multiplier"], corpo["validade"]])
      .toEqual([top.id, formula.id, local.id, local.id, "5", "2", null]);
    expect([resposta["production_cost"], resposta["unit_cost"]], "o custo do servidor").toEqual(["18.00", "3.600000"]);
    await expect(page).toHaveURL(/\/estoque\?tab=fabrica&sub=producoes$/);

    const id = String(resposta["id"]);
    expect(sqlE2e(`select (b.tipo_operacao_id = '${top.id}' and v.tipo_operacao_id = b.tipo_operacao_id)::text from erp.feed_batches b join erp.tipos_operacao_versoes v on v.id = b.tipo_operacao_versao_id where b.id = '${id}'`),
      "o servidor gravou a TOP com a versão congelada").toBe("true");
    expect(sqlE2e(`select string_agg(movement_type || ':' || product_id || ':' || quantity::text, ',' order by movement_type, quantity) from erp.stock_movements where source_type = 'feed_batches' and source_id = '${id}'`),
      "baixa 4 de A e 6 de B; entrada de 5 do acabado").toBe(`production_in:${acabado.id}:5.0000,production_out:${a.id}:4.0000,production_out:${b.id}:6.0000`);
  } finally {
    await excluirTopDoModulo(page, top.id);
  }
});
