import { test, expect, type Page } from "@playwright/test";
import { login, uniq } from "./helpers";
import { aba, blocoPrincipal, criarParceiro, editar, estaTravada, mockCep, painel, salvarFicha, sql, textoVisto } from "./aj02-comum";

/**
 * AJUSTES 02 · R1 — CEP GRAVADO conferido ao REABRIR em edição, SEM preencher nem sujar o formulário:
 *  achado e mesma cidade → trava "pelo CEP"; achado e outra cidade → trava na gravada + aviso + "Usar a cidade do CEP";
 *  não achado → Cidade livre + "CEP não encontrado."; em ?view=1 nenhuma consulta. O mesmo nos cartões de endereço.
 *  Filiais: CEP digitado na busca da Cidade vai para a coluna CEP da linha. Erro de cartão prefixado "Endereço N:".
 * Só `/api/consultas/cep` é mockado (78250-000 → Pontes e Lacerda - MT; outro → 404).
 */
const PONTES = 5106752;
const CUIABA = 5103403;

const orgDe = (id: string) => sql(`select organization_id from erp.people where id = '${id}'`);

/** Grava o endereço principal direto no banco (premissa conferida: exatamente uma linha). */
function gravarPrincipal(id: string, cep: string, cidade: number) {
  sql(`update erp.people set zip_code = '${cep}', city_id = ${cidade} where id = '${id}'`);
  expect(sql(`select concat_ws('|', zip_code, city_id::text) from erp.people where id = '${id}'`), "premissa: principal gravado").toBe(`${cep}|${cidade}`);
}

/** Grava um cartão de endereço direto no banco (premissa conferida: exatamente um cartão vivo). */
function gravarCartao(id: string, cep: string, cidade: number) {
  sql(`insert into erp.parceiro_enderecos (organization_id, person_id, tipo, descricao, cep, city_id) values ('${orgDe(id)}', '${id}', 'entrega', 'R1 cartão', '${cep}', ${cidade})`);
  expect(sql(`select concat_ws('|', cep, city_id::text) from erp.parceiro_enderecos where person_id = '${id}' and deleted_at is null`), "premissa: um cartão gravado").toBe(`${cep}|${cidade}`);
}

/** Nenhuma aba do espaço de trabalho está marcada com alterações não salvas. */
async function semAlteracoes(page: Page) {
  await expect(page.getByTestId("workspace-tab").first(), "premissa: há aba de trabalho para medir").toBeVisible();
  await expect(page.locator("[data-testid='workspace-tab'][data-dirty='true']"), "a conferência do CEP não suja o formulário").toHaveCount(0);
}

async function abrirEmEdicao(page: Page, id: string, abaNome = "Endereço") {
  await page.goto(`/cadastros/people/${id}`);
  await editar(page);
  await expect(page.getByRole("button", { name: "Salvar" }), "premissa: em edição").toBeVisible();
  await aba(page, abaNome).click();
}

test("AJ02-R1-W1 — reabrir com CEP 78250-000 + Pontes e Lacerda: trava \"pelo CEP\" sem sujar", async ({ page }) => {
  await login(page);
  const chamadas = await mockCep(page);
  const p = await criarParceiro(page, { name: uniq("R1-W1 parceiro") });
  gravarPrincipal(p.id, "78250000", PONTES);
  await abrirEmEdicao(page, p.id);
  const bloco = blocoPrincipal(page);
  await expect.poll(() => chamadas, { message: "premissa: a conferência do CEP gravado saiu" }).toContain("78250000");
  await expect(bloco.getByTestId("cidade-pelo-cep")).toBeVisible();
  await expect(bloco.getByTestId("cidade-pelo-cep")).toContainText(/pelo CEP/i);
  expect(await estaTravada(bloco.getByTestId("cidade-busca")), "travada pelo CEP").toBe(true);
  await expect(bloco.getByTestId("cidade-ibge")).toHaveValue(String(PONTES));
  await expect(bloco.getByTestId("cidade-aviso-cep")).toHaveCount(0);
  await expect(bloco.getByLabel("CEP", { exact: true })).toHaveValue("78250-000");
  await expect(bloco.getByLabel("Endereço", { exact: true }), "conferir não preenche o logradouro").toHaveValue("");
  await semAlteracoes(page);
});

test("AJ02-R1-W2 — CEP gravado de outra cidade: trava na gravada, avisa e \"Usar a cidade do CEP\" troca e grava", async ({ page }) => {
  await login(page);
  const chamadas = await mockCep(page);
  const p = await criarParceiro(page, { name: uniq("R1-W2 parceiro") });
  gravarPrincipal(p.id, "78250000", CUIABA);
  await abrirEmEdicao(page, p.id);
  const bloco = blocoPrincipal(page);
  await expect.poll(() => chamadas, { message: "premissa: a conferência saiu" }).toContain("78250000");
  const aviso = bloco.getByTestId("cidade-aviso-cep");
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText("O CEP 78250-000 é de Pontes e Lacerda - MT; a cidade gravada é Cuiabá - MT.");
  await expect.poll(() => textoVisto(bloco.getByTestId("cidade-busca"))).toContain("Cuiabá");
  await expect(bloco.getByTestId("cidade-ibge")).toHaveValue(String(CUIABA));
  expect(await estaTravada(bloco.getByTestId("cidade-busca")), "travada na cidade gravada").toBe(true);
  await semAlteracoes(page);

  const usar = bloco.getByTestId("cidade-usar-do-cep");
  await expect(usar).toHaveText(/Usar a cidade do CEP/);
  await usar.click();
  await expect.poll(() => textoVisto(bloco.getByTestId("cidade-busca"))).toContain("Pontes e Lacerda");
  await expect(bloco.getByTestId("cidade-ibge")).toHaveValue(String(PONTES));
  await expect(bloco.getByTestId("cidade-uf")).toHaveValue("MT");
  await expect(page.locator("[data-testid='workspace-tab'][data-dirty='true']"), "trocar a cidade suja o formulário").toHaveCount(1);
  await salvarFicha(page, "people", p.id);
  expect(sql(`select city_id::text from erp.people where id = '${p.id}'`)).toBe(String(PONTES));
});

test("AJ02-R1-W3 — CEP gravado desconhecido: Cidade livre e \"CEP não encontrado.\"", async ({ page }) => {
  await login(page);
  const chamadas = await mockCep(page);
  const p = await criarParceiro(page, { name: uniq("R1-W3 parceiro") });
  gravarPrincipal(p.id, "01001000", CUIABA);
  await abrirEmEdicao(page, p.id);
  const bloco = blocoPrincipal(page);
  await expect.poll(() => chamadas, { message: "premissa: a conferência (404) saiu" }).toContain("01001000");
  await expect(page.getByText(/CEP não encontrado/i).first()).toBeVisible();
  await expect(bloco.getByTestId("cidade-pelo-cep")).toHaveCount(0);
  expect(await estaTravada(bloco.getByTestId("cidade-busca")), "CEP desconhecido não trava").toBe(false);
  await expect(bloco.getByTestId("cidade-ibge"), "a cidade gravada continua").toHaveValue(String(CUIABA));
  await semAlteracoes(page);
});

test("AJ02-R1-W4 — ?view=1 não consulta o CEP gravado", async ({ page }) => {
  await login(page);
  const chamadas = await mockCep(page);
  const p = await criarParceiro(page, { name: uniq("R1-W4 parceiro") });
  gravarPrincipal(p.id, "78250000", PONTES);
  gravarCartao(p.id, "78250000", PONTES);
  await page.goto(`/cadastros/people/${p.id}?view=1`);
  await aba(page, "Endereço").click();
  await expect(blocoPrincipal(page).getByLabel("CEP", { exact: true }), "premissa: a ficha carregou o CEP gravado").toHaveValue("78250-000");
  await expect(page.getByTestId("linha-enderecos-1"), "premissa: o cartão está na tela").toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
  expect(chamadas, "em visualização, nenhuma consulta de CEP").toEqual([]);
});

test("AJ02-R1-W5 — cartão gravado com CEP 78250-000 + Pontes e Lacerda: trava \"pelo CEP\" no cartão, sem sujar", async ({ page }) => {
  await login(page);
  const chamadas = await mockCep(page);
  const p = await criarParceiro(page, { name: uniq("R1-W5 parceiro") });
  gravarCartao(p.id, "78250000", PONTES);
  await abrirEmEdicao(page, p.id);
  const cartao = page.getByTestId("linha-enderecos-1");
  await expect(cartao).toBeVisible();
  await expect(page.getByTestId("grade-enderecos").getByTestId(/^linha-enderecos-\d+$/), "premissa: um cartão").toHaveCount(1);
  await expect.poll(() => chamadas, { message: "premissa: a conferência do cartão saiu" }).toContain("78250000");
  await expect(cartao.getByTestId("cidade-pelo-cep")).toBeVisible();
  expect(await estaTravada(cartao.getByTestId("cidade-busca")), "cartão travado pelo CEP").toBe(true);
  await expect(cartao.getByTestId("cidade-aviso-cep")).toHaveCount(0);
  await expect(blocoPrincipal(page).getByTestId("cidade-pelo-cep"), "o principal (sem CEP) não é tocado").toHaveCount(0);
  await semAlteracoes(page);
});

test("AJ02-R1-W6 — Filiais: CEP digitado na busca da Cidade vai para a coluna CEP da linha", async ({ page }) => {
  await login(page);
  const chamadas = await mockCep(page);
  const p = await criarParceiro(page, { name: uniq("R1-W6 fornecedor"), is_provider: true });
  await abrirEmEdicao(page, p.id, "Fornecedor");
  const filiais = page.getByTestId("grade-filiais");
  await filiais.getByRole("button", { name: "Incluir linha" }).click();
  const filial = page.getByTestId("linha-filiais-1");
  await expect(filial).toBeVisible();
  const cep = filial.getByLabel("CEP", { exact: true });
  await expect(cep, "premissa: CEP da linha vazio").toHaveValue("");
  await filial.getByTestId("cidade-busca").click();
  const pesquisa = painel(page).getByLabel("Pesquisar opção");
  if (await pesquisa.count()) await pesquisa.fill("78250000"); else await page.keyboard.type("78250000");
  await expect(cep, "o CEP digitado na Cidade foi para a coluna CEP").toHaveValue("78250-000");
  await expect.poll(() => chamadas, { message: "e a consulta do CEP saiu" }).toContain("78250000");
  await page.keyboard.press("Escape").catch(() => undefined);
  await expect(filial.getByTestId("cidade-ibge")).toHaveValue(String(PONTES));
  await expect.poll(() => textoVisto(filial.getByTestId("cidade-busca"))).toContain("Pontes e Lacerda");
});

test("AJ02-R1-W7 — cartão com CEP×cidade divergentes: o servidor recusa e a mensagem vem prefixada \"Endereço 1:\"", async ({ page }) => {
  await login(page);
  // o servidor confere pelo cache: 78250000 → Pontes e Lacerda
  sql(`insert into erp.consulta_cep_cache (cep, dados, fonte, consultado_em) values ('78250000', '${JSON.stringify({ cep: "78250000", logradouro: "Avenida Marechal Rondon", complemento: null, bairro: "Centro", municipioIbge: PONTES, municipioNome: "Pontes e Lacerda", uf: "MT" })}'::jsonb, 'viacep', now()) on conflict (cep) do update set dados = excluded.dados, fonte = excluded.fonte, consultado_em = now()`);
  expect(sql("select dados->>'municipioIbge' from erp.consulta_cep_cache where cep = '78250000'"), "premissa: cache aponta Pontes e Lacerda").toBe(String(PONTES));
  // na tela o CEP é "desconhecido" (404) para a Cidade ficar livre e aceitar Cuiabá
  const chamadas: string[] = [];
  await page.route(/\/api\/consultas\/cep\//, async (route) => {
    chamadas.push(new URL(route.request().url()).pathname.split("/").pop()!.replace(/\D/g, ""));
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_FOUND", message: "CEP não encontrado" } }) });
  });
  const p = await criarParceiro(page, { name: uniq("R1-W7 parceiro") });
  await abrirEmEdicao(page, p.id);
  await page.getByTestId("incluir-enderecos").click();
  const cartao = page.getByTestId("linha-enderecos-1");
  await expect(cartao).toBeVisible();
  await cartao.getByLabel("Tipo", { exact: true }).selectOption("entrega");
  const cep = cartao.getByLabel("CEP", { exact: true });
  await cep.fill("78250000");
  await cep.press("Tab");
  await expect.poll(() => chamadas, { message: "premissa: a consulta (404) saiu" }).toContain("78250000");
  expect(await estaTravada(cartao.getByTestId("cidade-busca")), "premissa: Cidade livre").toBe(false);
  await cartao.getByTestId("cidade-busca").click();
  const pesquisa = painel(page).getByLabel("Pesquisar opção");
  if (await pesquisa.count()) await pesquisa.fill("Cuiabá"); else await page.keyboard.type("Cuiabá");
  await painel(page).getByRole("option").filter({ hasText: "Cuiabá" }).first().click();
  await expect(cartao.getByTestId("cidade-ibge"), "premissa: Cuiabá escolhida").toHaveValue(String(CUIABA));

  const resposta = page.waitForResponse((r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `/api/resources/people/${p.id}`);
  await page.getByRole("button", { name: "Salvar" }).click();
  expect((await resposta).status(), "o servidor recusa a divergência").toBe(422);
  await expect(page.getByText(/Endereço 1: .*O CEP 78250-000 é de Pontes e Lacerda - MT/).first()).toBeVisible();
  expect(sql(`select count(*) from erp.parceiro_enderecos where person_id = '${p.id}'`), "nada gravado").toBe("0");
});
