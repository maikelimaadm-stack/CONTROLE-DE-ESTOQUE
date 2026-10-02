import { test, expect } from "@playwright/test";
import { login } from "./helpers";
import { corpoDoPost, saldoInicial, sqlE2e, tiposDoModulo } from "./f10-comum";
import { dietaDoSeed, empresaELocal, escolherNoCampo } from "./f10-pecuaria-comum";

/**
 * OPERACOES-01 F10 (decisão 287) · A CENTRAL DA BATELADA — a rota nova `/confinamento/bateladas/new`.
 *
 * F10-B1, contra a API deste HEAD (que declara `topNoModulo`): a aba Hoje › Produção leva à Central pelo botão "Nova
 * batelada"; a dieta do seed (60/40) com 100 kg num local NOVO com saldo dos dois ingredientes (custo 2,00 e 5,00) deriva
 * a grade — 60 e 40, a coluna "Pela dieta (kg)", a quantidade travada, sem "Adicionar produto" — pela rota dos
 * ingredientes; a prévia é 320,00 e 3,20/kg; o POST leva as chaves de hoje mais a TOP; o razão baixa 60 e 40 do local; a
 * lista mostra a batelada com o R$/kg do servidor.
 */
const P = "central-batelada";
const CHAVES_DO_POST = ["batch_date", "diet_id", "empresa_id", "equipment_id", "quantity_kg", "tipo_operacao_id", "warehouse_id"];

test("F10-B1 — dieta 60/40 × 100 kg: itens derivados travados ('Pela dieta (kg)'), prévia 3,20/kg, 201 e o R$/kg do servidor na lista", async ({ page }) => {
  await login(page);
  const dieta = dietaDoSeed();
  const { empresa, local } = await empresaELocal(page, "batelada B1");
  const [racao, sal] = dieta.ingredientes;
  // um local NOVO: o saldo dos dois ingredientes é só deste caso (o custo médio é o lançado)
  await saldoInicial(page, { empresa, local: local.id, produto: racao!.produto, quantidade: "100", custo: "2" });
  await saldoInicial(page, { empresa, local: local.id, produto: sal!.produto, quantidade: "100", custo: "5" });
  const capacidade = await tiposDoModulo(page, "batelada");
  expect(capacidade.status, "premissa: a API deste HEAD declara a capacidade da batelada").toBe(200);

  await page.goto("/confinamento?tab=hoje&sub=producao");
  await page.getByTestId("confinamento-nova-batelada").click();
  await expect(page).toHaveURL(/\/confinamento\/bateladas\/new$/);
  await expect(page.getByTestId(`${P}-identidade-nome`)).toHaveText("Nova batelada");

  const ingredientes = page.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname === `/api/modulos/batelada/dietas/${dieta.id}/ingredientes`);
  await escolherNoCampo(page, page.getByTestId(`${P}-campo-dieta`), dieta.nome);
  expect((await ingredientes).status(), "com a capacidade, a Central lê os ingredientes da dieta").toBe(200);
  await escolherNoCampo(page, page.getByTestId(`${P}-campo-local`), local.nome);
  await page.getByTestId(`${P}-campo-quantidade`).locator("input").fill("100");

  await expect(page.getByTestId(`${P}-linha`), "uma linha por ingrediente").toHaveCount(2);
  await expect(page.getByTestId(`${P}-saldo-da-origem`), "kg × percentual da dieta").toHaveText(["60,0000", "40,0000"]);
  await expect(page.getByTestId(`${P}-grade`).getByRole("columnheader", { name: "Pela dieta (kg)" })).toBeVisible();
  await expect(page.getByTestId(`${P}-adicionar-item`), "itens derivados: sem Adicionar produto").toHaveCount(0);
  await page.getByTestId(`${P}-selecionar-item`).first().click();
  await expect(page.getByTestId(`${P}-grade`).getByRole("spinbutton", { name: "Quantidade do item 1" }), "a quantidade é travada").toHaveCount(0);
  await expect(page.getByTestId(`${P}-remover-item`), "nem Remover").toHaveCount(0);
  await expect(page.getByTestId(`${P}-resumo-custo`), "a prévia: 60 × 2,00 + 40 × 5,00").toContainText(/R\$\s320,00/);
  await expect(page.getByTestId(`${P}-resumo-custo-kg`), "e o custo por kg").toContainText(/R\$\s3,20/);

  const escrita = corpoDoPost(page, "/api/feedlot/diet-batches");
  await page.getByTestId(`${P}-salvar`).click();
  const { corpo, status, resposta } = await escrita;
  expect(status, JSON.stringify(resposta)).toBe(201);
  expect(Object.keys(corpo).sort(), "as chaves de hoje, mais a TOP (a capacidade está declarada)").toEqual(CHAVES_DO_POST);
  expect([corpo["empresa_id"], corpo["diet_id"], corpo["warehouse_id"], corpo["equipment_id"], corpo["quantity_kg"], corpo["tipo_operacao_id"]])
    .toEqual([empresa, dieta.id, local.id, null, "100", capacidade.corpo.defaultId]);
  expect(Object.keys(resposta).sort(), "a resposta de hoje").toEqual(["code", "cost_per_kg", "id", "total_cost"]);
  expect([resposta["total_cost"], resposta["cost_per_kg"]], "o custo do servidor").toEqual(["320.00", "3.200000"]);
  const id = String(resposta["id"]);
  expect(sqlE2e(`select string_agg(product_id || ':' || quantity::text, ',' order by quantity desc) from erp.stock_movements where source_type = 'diet_batches' and source_id = '${id}' and warehouse_id = '${local.id}'`),
    "o razão baixou 60 e 40 do local do cabeçalho").toBe(`${racao!.produto}:60.0000,${sal!.produto}:40.0000`);

  await expect(page).toHaveURL(/\/confinamento\?tab=hoje&sub=producao$/);
  const linha = page.getByRole("row").filter({ hasText: String(resposta["code"]) });
  await expect(linha, "a lista mostra a batelada com o R$/kg do servidor").toContainText(/R\$\s3,20/);
  await expect(linha).toContainText(/R\$\s320,00/);
});
