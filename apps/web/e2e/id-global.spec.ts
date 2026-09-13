import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * PRE-BASE2-04 — ID GLOBAL na interface: busca `#N` (Ctrl+K) e identidade `#N` na tela do registro.
 *
 * O que estes testes protegem, e que nenhum teste de API pega:
 *  - a URL que o usuário acaba vendo é a ROTA CANÔNICA com o UUID. Se alguém "otimizar" a busca montando
 *    `/registro/55`, o `#N` vira uma segunda identidade permanente — e uma que resolve SEM a autorização
 *    daquele registro. Por isso o teste afirma explicitamente que a URL NÃO contém o número;
 *  - o `#N` aparece na tela do registro para quem abriu por navegação normal, não só para quem veio da busca.
 */

/** Cria um registro pela API, com a sessão do navegador, e devolve o `#N` que o backend deu a ele. */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
async function criarComIdGlobal(page: Page): Promise<{ id: string; idGlobal: number; rota: string }> {
  return page.evaluate(async (base: string) => {
    const sessao = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string };
    const cab = { "content-type": "application/json", authorization: `Bearer ${sessao.token}`, "x-org-id": sessao.orgId };
    const ctx = await (await fetch(`${base}/api/auth/context`, { headers: cab })).json();
    const empresa = ctx.empresas[0].id;
    const os = await (await fetch(`${base}/api/service-orders`, { method: "POST", headers: cab,
      body: JSON.stringify({ empresa_id: empresa, order_date: "2031-05-01", description: `OS ID Global ${Date.now()}`, lines: [] }) })).json();
    const reg = await (await fetch(`${base}/api/registros-globais/entidade/service_orders/${os.id}`, { headers: cab })).json();
    return { id: os.id as string, idGlobal: reg.idGlobal as number, rota: reg.rota as string };
  }, API);
}

test.describe("ID Global — busca e identidade", () => {
  test("Ctrl+K → `#N` → abre a ROTA CANÔNICA, e a URL tem o UUID, não o número", async ({ page }) => {
    await login(page);
    const alvo = await criarComIdGlobal(page);

    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("global-search")).toBeFocused();
    await page.getByTestId("global-search").fill(`#${alvo.idGlobal}`);

    const resultado = page.getByTestId("nav-search-id-global-item");
    await expect(resultado).toBeVisible();
    await expect(resultado).toContainText(`#${alvo.idGlobal}`);
    await expect(resultado, "o resultado diz QUE COISA é, não só o número").toContainText("Ordem de Serviço");

    await resultado.click();
    await expect(page).toHaveURL(new RegExp(`/os/${alvo.id}`));
    expect(page.url(), "o ID Global é localizador; a identidade da URL continua sendo o UUID").not.toContain(`/os/${alvo.idGlobal}`);
    await expect(page.getByTestId("id-global-registro"), "o registro aberto mostra a própria identidade").toContainText(`#${alvo.idGlobal}`);
  });

  test("`ID N` (com espaço) funciona e Enter abre o registro", async ({ page }) => {
    await login(page);
    const alvo = await criarComIdGlobal(page);
    await page.keyboard.press("Control+k");
    await page.getByTestId("global-search").fill(`ID ${alvo.idGlobal}`);
    await expect(page.getByTestId("nav-search-id-global-item")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/os/${alvo.id}`));
  });

  test("número que não existe não vira navegação nem some com a busca de telas", async ({ page }) => {
    await login(page);
    await page.keyboard.press("Control+k");
    await page.getByTestId("global-search").fill("#999999");
    await expect(page.getByTestId("nav-search-id-global-item")).toHaveCount(0);
    // e a busca por texto continua funcionando exatamente como antes
    await page.getByTestId("global-search").fill("Estoque");
    await expect(page.getByTestId("nav-search-results")).toBeVisible();
  });

  test("o `#N` aparece ao abrir o registro por navegação normal, em módulos diferentes", async ({ page }) => {
    await login(page);
    const alvo = await criarComIdGlobal(page);
    await page.goto(`/os/${alvo.id}`);
    await expect(page.getByTestId("id-global-registro")).toContainText(`#${alvo.idGlobal}`);

    // Cadastro compartilhado (Produto): abre em CONSULTA e também mostra a identidade. O produto é CRIADO
    // aqui de propósito — os do seed são acervo histórico e só ganham número depois do backfill, e é
    // justamente esse o estado em que a tela precisa não quebrar (o badge some, a tela fica inteira).
    const produto = await page.evaluate(async (base: string) => {
      const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string };
      const cab = { "content-type": "application/json", authorization: `Bearer ${s.token}`, "x-org-id": s.orgId };
      const um = async (r: string) => (await (await fetch(`${base}/api/resources/${r}/options`, { headers: cab })).json())[0].id;
      const cat = await (await fetch(`${base}/api/resources/financial_categories?pageSize=1&kind=analytic`, { headers: cab })).json();
      const novo = await (await fetch(`${base}/api/resources/products`, { method: "POST", headers: cab, body: JSON.stringify({
        description: `Produto ID Global ${Date.now()}`, measurement_id: await um("measurement_units"), group_id: await um("product_groups"),
        category_id: await um("product_categories"), kind_id: await um("product_kinds"), control_stock: true,
        financial_category_id: cat.items[0].id }) })).json();
      return novo.id as string;
    }, API);
    await page.goto(`/cadastros/products/${produto}?view=1`);
    await expect(page.getByTestId("id-global-registro")).toBeVisible();
  });

  test("tela que não é registro não mostra identidade nenhuma", async ({ page }) => {
    await login(page);
    await page.goto("/os");
    await expect(page.getByTestId("id-global-registro")).toHaveCount(0);
  });
});
