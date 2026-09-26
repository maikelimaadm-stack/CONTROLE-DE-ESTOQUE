import { test, expect } from "@playwright/test";
import { login, uniq } from "./helpers";
import { aba, conferirPartes, criarParceiro, editar, opcoes, painel, rotulosEmOrdem, salvarFicha, sql } from "./aj02-comum";

/**
 * AJUSTES 02 · 16 — conta adicional (cartão): Banco e Código do banco em campos SEPARADOS; busca por "260" acha o
 * Nubank (referência oficial REAL, 0026); grava e reabre.
 */
const NU = "NU PAGAMENTOS S.A. - INSTITUIÇÃO DE PAGAMENTO";

test("AJ02-16 — Incluir conta; \"260\" → Banco (só o nome) e Código do banco 260 separados; grava e reabre", async ({ page }) => {
  await login(page);
  const p = await criarParceiro(page, { name: uniq("AJ02-16 parceiro") });
  await page.goto(`/cadastros/people/${p.id}`);
  await editar(page);
  await expect(page.getByRole("button", { name: "Salvar" }), "premissa: em edição").toBeVisible();
  await aba(page, "Financeiro").click();

  const grade = page.getByTestId("grade-contas");
  await expect(grade.getByTestId(/^linha-contas-\d+$/), "premissa: nenhuma conta").toHaveCount(0);
  await expect(page.getByTestId("incluir-contas")).toHaveText(/Incluir conta/);
  await page.getByTestId("incluir-contas").click();
  const cartao = page.getByTestId("linha-contas-1");
  await expect(cartao).toBeVisible();
  await expect(grade.getByTestId(/^linha-contas-\d+$/)).toHaveCount(1);
  expect(await rotulosEmOrdem(cartao), "cartão da conta: Titular; corpo do principal").toEqual(["Titular", "Banco", "Código do banco", "Tipo de conta", "Agência", "Conta", "Tipo de chave Pix", "Chave Pix"]);

  const titular = uniq("Titular");
  await cartao.getByLabel("Titular", { exact: true }).fill(titular);
  await cartao.getByTestId("ref-bancos-busca").click();
  await painel(page).getByLabel("Pesquisar opção").fill("260");
  const nu = opcoes(page).filter({ hasText: NU });
  await expect(nu, "a busca por 260 acha o Nubank (uma opção)").toHaveCount(1);
  await nu.click();
  await conferirPartes(cartao.getByTestId("ref-bancos-busca"), cartao.getByTestId("ref-bancos-codigo"), NU, "260");
  await cartao.getByLabel("Agência", { exact: true }).fill("0001");
  await cartao.getByLabel("Conta", { exact: true }).fill("123456-7");

  await salvarFicha(page, "people", p.id);
  expect(sql(`select concat_ws('|', titular, bank_code, agencia, conta) from erp.parceiro_contas where person_id = '${p.id}' and deleted_at is null`), "gravado: uma conta, com o CÓDIGO oficial")
    .toBe(`${titular}|260|0001|123456-7`);

  await page.goto(`/cadastros/people/${p.id}?view=1`);
  await aba(page, "Financeiro").click();
  const reaberto = page.getByTestId("linha-contas-1");
  await expect(reaberto).toBeVisible();
  await expect(page.getByTestId("grade-contas").getByTestId(/^linha-contas-\d+$/)).toHaveCount(1);
  await expect(reaberto.getByLabel("Titular", { exact: true })).toHaveValue(titular);
  await conferirPartes(reaberto.getByTestId("ref-bancos-busca"), reaberto.getByTestId("ref-bancos-codigo"), NU, "260");
});
