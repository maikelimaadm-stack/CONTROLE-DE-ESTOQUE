import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";
import { aba, blocoPrincipal, estaTravada, mockCep, textoVisto } from "./aj02-comum";

/**
 * AJUSTES 02 · 14 — Cidade em três campos (Cidade · Código IBGE · UF) e a trava "pelo CEP", no bloco principal
 * "Endereço" da ficha do parceiro. Só `/api/consultas/cep` é mockado (78250-000 → Pontes e Lacerda; outro → 404).
 */
async function abrirEndereco(page: Page) {
  await page.goto("/cadastros/people/new");
  await aba(page, "Endereço").click();
  const bloco = blocoPrincipal(page);
  await expect(bloco.getByTestId("cidade-busca"), "premissa: a Cidade do bloco principal está na tela").toHaveCount(1);
  return bloco;
}

test("AJ02-14a — CEP 78250-000 + Tab: Cidade \"Pontes e Lacerda\", Código IBGE 5106752, UF MT, travada \"pelo CEP\"; limpar o CEP destrava", async ({ page }) => {
  await login(page);
  const chamadas = await mockCep(page);
  const bloco = await abrirEndereco(page);
  // rótulos das três partes, na ordem
  for (const r of ["Cidade", "Código IBGE", "UF"]) await expect(bloco.locator("label").filter({ hasText: new RegExp(`^${r}( \\*)?$`) }), r).toHaveCount(1);
  await expect(bloco.getByTestId("cidade-pelo-cep"), "sem CEP não há a marca").toHaveCount(0);
  expect(await estaTravada(bloco.getByTestId("cidade-busca")), "sem CEP a Cidade é livre").toBe(false);

  const cep = bloco.getByLabel("CEP", { exact: true });
  await cep.fill("78250000");
  await cep.press("Tab");
  await expect.poll(() => chamadas, { message: "premissa: a consulta saiu uma vez" }).toEqual(["78250000"]);
  await expect.poll(() => textoVisto(bloco.getByTestId("cidade-busca"))).toContain("Pontes e Lacerda");
  expect(await textoVisto(bloco.getByTestId("cidade-busca")), "a busca mostra só o nome").not.toContain("5106752");
  await expect(bloco.getByTestId("cidade-ibge")).toHaveValue("5106752");
  await expect(bloco.getByTestId("cidade-uf")).toHaveValue("MT");
  expect(await estaTravada(bloco.getByTestId("cidade-ibge")), "Código IBGE só leitura").toBe(true);
  expect(await estaTravada(bloco.getByTestId("cidade-uf")), "UF só leitura").toBe(true);
  await expect(bloco.getByTestId("cidade-pelo-cep")).toBeVisible();
  await expect(bloco.getByTestId("cidade-pelo-cep")).toContainText(/pelo CEP/i);
  expect(await estaTravada(bloco.getByTestId("cidade-busca")), "travada pelo CEP").toBe(true);

  // limpar o CEP destrava (a cidade escolhida pode continuar; a marca some)
  await cep.fill("");
  await cep.press("Tab");
  await expect(bloco.getByTestId("cidade-pelo-cep")).toHaveCount(0);
  expect(await estaTravada(bloco.getByTestId("cidade-busca")), "sem CEP volta a ser livre").toBe(false);
});

test("AJ02-14b — CEP desconhecido: aviso, e a Cidade fica livre", async ({ page }) => {
  await login(page);
  const chamadas = await mockCep(page);
  const bloco = await abrirEndereco(page);
  const cep = bloco.getByLabel("CEP", { exact: true });
  await cep.fill("01001000");
  await cep.press("Tab");
  await expect.poll(() => chamadas, { message: "premissa: a consulta do CEP desconhecido saiu (404)" }).toEqual(["01001000"]);
  await expect(page.getByText(/CEP não encontrado/i).first()).toBeVisible();
  await expect(bloco.getByTestId("cidade-pelo-cep")).toHaveCount(0);
  expect(await estaTravada(bloco.getByTestId("cidade-busca")), "CEP desconhecido não trava a Cidade").toBe(false);
  await expect(bloco.getByTestId("cidade-ibge")).toHaveValue("");
});

test("AJ02-14c — CEP digitado na busca da Cidade vai para o campo CEP e preenche (e trava)", async ({ page }) => {
  await login(page);
  const chamadas = await mockCep(page);
  const bloco = await abrirEndereco(page);
  const cep = bloco.getByLabel("CEP", { exact: true });
  await expect(cep, "premissa: CEP vazio").toHaveValue("");
  await bloco.getByTestId("cidade-busca").click();
  // o foco está na busca (caixa própria ou a pesquisa do painel): digita como o usuário
  await page.keyboard.type("78250000");
  await expect(cep, "o CEP digitado na Cidade foi para o campo CEP").toHaveValue("78250-000");
  await expect.poll(() => chamadas, { message: "e a consulta do CEP saiu" }).toContain("78250000");
  await page.keyboard.press("Escape").catch(() => undefined);
  await expect(bloco.getByTestId("cidade-ibge")).toHaveValue("5106752");
  await expect(bloco.getByTestId("cidade-uf")).toHaveValue("MT");
  await expect.poll(() => textoVisto(bloco.getByTestId("cidade-busca"))).toContain("Pontes e Lacerda");
  await expect(bloco.getByLabel("Endereço", { exact: true }), "o fluxo completo do CEP (logradouro)").toHaveValue("Avenida Marechal Rondon");
  await expect(bloco.getByTestId("cidade-pelo-cep")).toBeVisible();
});
