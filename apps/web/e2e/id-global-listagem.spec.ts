import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * PRE-BASE2-05B.1 — O `#N` NA LISTAGEM.
 *
 * O que estes testes protegem, e que nem a API nem os testes de unidade pegam:
 *  - a coluna aparece MESMO para quem já configurou as colunas daquela tela. A preferência de colunas guarda
 *    uma lista fechada, e uma coluna criada depois jamais estaria nela: se a identidade dependesse dessa
 *    preferência, justamente os usuários antigos — os que têm registros para localizar — ficariam sem o
 *    número. Por isso o caso abaixo salva uma configuração de colunas e confere que o `#N` continua lá;
 *  - o número da LINHA é o mesmo da tela de detalhe e o mesmo que a busca `#N` resolve — uma identidade só;
 *  - a linha continua abrindo pelo UUID. Se alguém "simplificar" a navegação usando o número, `#N` vira uma
 *    segunda identidade permanente, que resolve sem passar pela autorização daquele registro.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";

/** Cria uma OS pela API, com a sessão do navegador, e devolve o `#N` que o backend deu a ela. */
async function criarOrdemDeServico(page: Page): Promise<{ id: string; idGlobal: number; descricao: string }> {
  return page.evaluate(async (base: string) => {
    const sessao = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string };
    const cab = { "content-type": "application/json", authorization: `Bearer ${sessao.token}`, "x-org-id": sessao.orgId };
    const ctx = await (await fetch(`${base}/api/auth/context`, { headers: cab })).json();
    const descricao = `OS listagem ${Date.now()}`;
    const os = await (await fetch(`${base}/api/service-orders`, { method: "POST", headers: cab,
      body: JSON.stringify({ empresa_id: ctx.empresas[0].id, order_date: "2031-06-01", description: descricao, lines: [] }) })).json();
    const reg = await (await fetch(`${base}/api/registros-globais/entidade/service_orders/${os.id}`, { headers: cab })).json();
    if (!os?.id) throw new Error(`falha ao criar a OS de teste: ${JSON.stringify(os)}`);
    return { id: os.id as string, idGlobal: reg.idGlobal as number, descricao };
  }, API);
}

/** Cria um produto pela API (a porta que aloca o número) copiando as referências obrigatórias de um já existente. */
async function criarProduto(page: Page): Promise<{ id: string; idGlobal: number; descricao: string }> {
  return page.evaluate(async (base: string) => {
    const sessao = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string };
    const cab = { "content-type": "application/json", authorization: `Bearer ${sessao.token}`, "x-org-id": sessao.orgId };
    const lista = await (await fetch(`${base}/api/resources/products?pageSize=1`, { headers: cab })).json();
    // o detalhe traz também os campos que não são colunas da listagem (1ª unidade de medida, por exemplo)
    const modelo = await (await fetch(`${base}/api/resources/products/${lista.items[0].id}`, { headers: cab })).json() as Record<string, unknown>;
    const descricao = `Produto listagem ${Date.now()}`;
    const novo = await (await fetch(`${base}/api/resources/products`, { method: "POST", headers: cab,
      // `control_stock: false` evita depender da categoria financeira do produto-modelo (obrigatória só para quem controla estoque)
      body: JSON.stringify({ description: descricao, measurement_id: modelo.measurement_id, group_id: modelo.group_id, category_id: modelo.category_id, kind_id: modelo.kind_id, control_stock: false }) })).json();
    const reg = await (await fetch(`${base}/api/registros-globais/entidade/products/${novo.id}`, { headers: cab })).json();
    if (!novo?.id) throw new Error(`falha ao criar o produto de teste: ${JSON.stringify(novo)}`);
    return { id: novo.id as string, idGlobal: reg.idGlobal as number, descricao };
  }, API);
}

test.describe("ID Global na listagem", () => {
  test("cadastro genérico: a coluna existe e o registro criado pela porta real traz o #N", async ({ page }) => {
    await login(page);
    const produto = await criarProduto(page);
    await page.goto("/cadastros/products");
    await expect(page.getByRole("columnheader", { name: "ID Global" })).toBeVisible();
    const linha = page.getByTestId("b1-row").filter({ hasText: produto.descricao }).first();
    await expect(linha).toBeVisible();
    await expect(linha.getByTestId("id-global-celula").first()).toHaveText(`#${produto.idGlobal}`);
  });

  test("lançamento: o #N da linha é o mesmo do registro aberto, e a URL continua sendo o UUID", async ({ page }) => {
    await login(page);
    const os = await criarOrdemDeServico(page);
    await page.goto("/os");
    const linha = page.getByTestId("b1-row").filter({ hasText: os.descricao }).first();
    await expect(linha).toBeVisible();
    await expect(linha.getByTestId("id-global-celula").first(), "a linha mostra a identidade global do registro").toHaveText(`#${os.idGlobal}`);

    await linha.dblclick();
    await expect(page).toHaveURL(new RegExp(`/os/${os.id}`));
    expect(page.url(), "o ID Global é localizador; o endereço continua sendo o UUID").not.toContain(`/os/${os.idGlobal}`);
    await expect(page.getByTestId("id-global-registro"), "listagem e detalhe falam do mesmo número").toContainText(`#${os.idGlobal}`);
  });

  test("a coluna sobrevive a uma configuração de colunas salva pelo usuário", async ({ page }) => {
    await login(page);
    await page.goto("/cadastros/products");
    await expect(page.getByTestId("b1-row").first()).toBeVisible();

    // o usuário reduz as colunas em uso: a identidade NÃO é uma delas e não pode desaparecer com a escolha
    await page.getByLabel("Mais opções").first().click();
    await page.getByRole("menuitem", { name: "Configurações" }).click();
    await expect(page.getByText("Configuração de colunas")).toBeVisible();
    await page.getByRole("button", { name: "Remover todas (mantém a primeira)" }).click();
    await page.getByRole("button", { name: "OK" }).click();

    await expect(page.getByRole("columnheader", { name: "ID Global" }), "a coluna de identidade não é uma preferência do usuário").toBeVisible();

    // e continua lá depois de recarregar a tela (a preferência salva não a apaga)
    await page.reload();
    await expect(page.getByRole("columnheader", { name: "ID Global" })).toBeVisible();
  });

  test("o número da listagem é o mesmo que a busca global resolve", async ({ page }) => {
    await login(page);
    const os = await criarOrdemDeServico(page);
    await page.goto("/os");
    const linha = page.getByTestId("b1-row").filter({ hasText: os.descricao }).first();
    const texto = (await linha.getByTestId("id-global-celula").first().innerText()).trim();
    expect(texto).toBe(`#${os.idGlobal}`);

    await page.keyboard.press("Control+k");
    await page.getByTestId("global-search").fill(texto);
    const resultado = page.getByTestId("nav-search-id-global-item");
    await expect(resultado).toBeVisible();
    await resultado.click();
    await expect(page).toHaveURL(new RegExp(`/os/${os.id}`));
  });
});
