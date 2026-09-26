import { test, expect } from "@playwright/test";
import { login, uniq } from "./helpers";
import { aba, blocoPrincipal, CORPO_ENDERECO, criarParceiro, editar, estaTravada, mockCep, rotulosEmOrdem, salvarFicha, sql, textoVisto } from "./aj02-comum";

/**
 * AJUSTES 02 · 15 — endereço adicional é um CARTÃO com o MESMO corpo do bloco principal (rótulos e ordem),
 * mais Tipo · Descrição no topo e IE da propriedade · Ativo no fim. CEP + Tab no cartão preenche e trava; grava e
 * reabre com os valores.
 */
test("AJ02-15 — cartão de endereço = corpo do principal (sem Caixa postal) + Tipo/Descrição/IE da propriedade/Ativo; CEP no cartão; grava e reabre", async ({ page }) => {
  await login(page);
  const chamadas = await mockCep(page);
  const p = await criarParceiro(page, { name: uniq("AJ02-15 parceiro") });
  await page.goto(`/cadastros/people/${p.id}`);
  await editar(page);
  await expect(page.getByRole("button", { name: "Salvar" }), "premissa: em edição").toBeVisible();
  await aba(page, "Endereço").click();

  // corpo do principal: a sequência inteira do contrato (prova que a extração não está vazia)
  const principal = await rotulosEmOrdem(blocoPrincipal(page));
  expect(principal, "bloco principal: CEP · Endereço · Número · Complemento · Bairro · Cidade · Código IBGE · UF · Caixa postal · Latitude · Longitude").toEqual(CORPO_ENDERECO);

  const grade = page.getByTestId("grade-enderecos");
  await expect(grade.getByTestId(/^linha-enderecos-/), "premissa: nenhum cartão").toHaveCount(0);
  const incluir = page.getByTestId("incluir-enderecos");
  await expect(incluir).toHaveText(/Incluir endereço/);
  await incluir.click();
  const cartao = page.getByTestId("linha-enderecos-1");
  await expect(cartao).toBeVisible();
  await expect(grade.getByTestId(/^linha-enderecos-\d+$/)).toHaveCount(1);
  await expect(cartao.getByRole("button", { name: "Remover endereço 1" })).toBeVisible();

  const doCartao = await rotulosEmOrdem(cartao);
  const corpoSemCaixa = principal.filter((r) => r !== "Caixa postal");
  expect(corpoSemCaixa, "premissa: só Caixa postal sai").toHaveLength(principal.length - 1);
  expect(doCartao, "cartão = Tipo · Descrição · <corpo do principal sem Caixa postal> · IE da propriedade · Ativo").toEqual(["Tipo", "Descrição", ...corpoSemCaixa, "IE da propriedade", "Ativo"]);

  // CEP + Tab no cartão: preenche e trava
  await cartao.getByLabel("Tipo", { exact: true }).selectOption("entrega");
  const descricao = uniq("Depósito");
  await cartao.getByLabel("Descrição", { exact: true }).fill(descricao);
  const cep = cartao.getByLabel("CEP", { exact: true });
  await cep.fill("78250000");
  await cep.press("Tab");
  await expect.poll(() => chamadas, { message: "premissa: a consulta do cartão saiu" }).toContain("78250000");
  await expect(cartao.getByLabel("Endereço", { exact: true })).toHaveValue("Avenida Marechal Rondon");
  await expect(cartao.getByLabel("Bairro", { exact: true })).toHaveValue("Centro");
  await expect(cartao.getByTestId("cidade-ibge")).toHaveValue("5106752");
  await expect(cartao.getByTestId("cidade-uf")).toHaveValue("MT");
  await expect.poll(() => textoVisto(cartao.getByTestId("cidade-busca"))).toContain("Pontes e Lacerda");
  await expect(cartao.getByTestId("cidade-pelo-cep")).toBeVisible();
  expect(await estaTravada(cartao.getByTestId("cidade-busca")), "travada pelo CEP no cartão").toBe(true);
  // o principal não foi tocado pela consulta do cartão
  await expect(blocoPrincipal(page).getByTestId("cidade-ibge")).toHaveValue("");
  await cartao.getByLabel("Número", { exact: true }).fill("123");
  await cartao.getByLabel("IE da propriedade", { exact: true }).fill("ISENTO");

  await salvarFicha(page, "people", p.id);
  expect(sql(`select concat_ws('|', tipo, descricao, cep, logradouro, numero, bairro, city_id::text, inscricao_estadual) from erp.parceiro_enderecos where person_id = '${p.id}' and deleted_at is null`), "gravado: exatamente uma linha")
    .toBe(`entrega|${descricao}|78250000|Avenida Marechal Rondon|123|Centro|5106752|ISENTO`);

  // reabre
  await page.goto(`/cadastros/people/${p.id}?view=1`);
  await aba(page, "Endereço").click();
  const reaberto = page.getByTestId("linha-enderecos-1");
  await expect(reaberto).toBeVisible();
  await expect(page.getByTestId("grade-enderecos").getByTestId(/^linha-enderecos-\d+$/)).toHaveCount(1);
  await expect(reaberto.getByLabel("Descrição", { exact: true })).toHaveValue(descricao);
  await expect(reaberto.getByLabel("CEP", { exact: true })).toHaveValue("78250-000");
  await expect(reaberto.getByLabel("Endereço", { exact: true })).toHaveValue("Avenida Marechal Rondon");
  await expect(reaberto.getByLabel("Número", { exact: true })).toHaveValue("123");
  await expect(reaberto.getByTestId("cidade-ibge")).toHaveValue("5106752");
  await expect(reaberto.getByTestId("cidade-uf")).toHaveValue("MT");
  await expect.poll(() => textoVisto(reaberto.getByTestId("cidade-busca"))).toContain("Pontes e Lacerda");
  await expect(reaberto.getByLabel("IE da propriedade", { exact: true })).toHaveValue("ISENTO");
});
