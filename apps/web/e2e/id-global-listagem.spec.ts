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

/** Cria um perfil de acesso pela API (porta que aloca o número) e devolve o `#N` dele. */
async function criarPerfil(page: Page): Promise<{ id: string; idGlobal: number; nome: string }> {
  return page.evaluate(async (base: string) => {
    const sessao = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string };
    const cab = { "content-type": "application/json", authorization: `Bearer ${sessao.token}`, "x-org-id": sessao.orgId };
    const nome = `Perfil listagem ${Date.now()}`;
    const novo = await (await fetch(`${base}/api/admin/roles`, { method: "POST", headers: cab,
      body: JSON.stringify({ name: nome, description: "criado pelo e2e de ID Global", permissions: ["products.view"] }) })).json();
    if (!novo?.id) throw new Error(`falha ao criar o perfil de teste: ${JSON.stringify(novo)}`);
    const reg = await (await fetch(`${base}/api/registros-globais/entidade/roles/${novo.id}`, { headers: cab })).json();
    return { id: novo.id as string, idGlobal: reg.idGlobal as number, nome };
  }, API);
}

/**
 * TELAS QUE NÃO PASSAM PELO MODELO BASE1 (PRE-BASE2-05B.1).
 *
 * Quatro listagens montam a grade por conta própria com DataTable e por isso receberam a coluna
 * explicitamente. Sem estes casos, apagar `colunaIdGlobalTabela(...)` de qualquer uma delas passaria por
 * catálogo, enriquecimento da API, matriz das 23 entidades e N+1 sem acender nenhuma luz — o número
 * simplesmente sumiria da tela, que é exatamente o que esta fatia existe para impedir.
 */
const CUSTOM: { nome: string; rota: string }[] = [
  { nome: "títulos financeiros (contas a pagar)", rota: "/financeiro/contas-a-pagar" },
  { nome: "animais", rota: "/pecuaria/animais" },
  { nome: "importações OFX", rota: "/financeiro/ofx" },
  { nome: "perfis de acesso", rota: "/admin/perfis" }
];

test.describe("ID Global nas listagens que montam a grade por conta própria", () => {
  for (const tela of CUSTOM) {
    test(`${tela.nome} — a coluna existe e toda célula é #N ou ausência explícita`, async ({ page }) => {
      await login(page);
      await page.goto(tela.rota);
      await expect(page.getByRole("columnheader", { name: "ID Global" })).toBeVisible();
      const celulas = page.getByTestId("b1-row").locator('[data-testid="id-global-celula"]');
      for (let i = 0; i < await celulas.count(); i++) {
        await expect(celulas.nth(i)).toHaveText(/^#\d+$/);
      }
    });
  }

  test("perfis de acesso: o #N da linha é o mesmo que o backend deu ao registro", async ({ page }) => {
    await login(page);
    const perfil = await criarPerfil(page);
    await page.goto("/admin/perfis");
    const linha = page.getByTestId("b1-row").filter({ hasText: perfil.nome }).first();
    await expect(linha).toBeVisible();
    await expect(linha.getByTestId("id-global-celula").first()).toHaveText(`#${perfil.idGlobal}`);
    // a linha continua abrindo pelo UUID
    await linha.dblclick();
    await expect(page).toHaveURL(new RegExp(`/admin/perfis/${perfil.id}`));
  });
});

/**
 * RODAPÉ DE TOTAIS — alinhamento geométrico, não contagem de células.
 *
 * O defeito real que este caso pega: a coluna de identidade entra à esquerda e o `colSpan` do rodapé não
 * acompanha, então o total de Peso aparece embaixo de Entrada. Nenhum teste de contagem de colunas pegaria
 * isso; a única pergunta que importa é "o total está sob a SUA coluna?", e ela se responde comparando as
 * posições que o navegador realmente calculou.
 */
async function alinhamentoDeTotal(page: Page, rotuloDaColuna: string, indiceDoTotal: number) {
  // O cabeçalho é localizado pelo `title` do botão da coluna: o nome acessível do <th> inclui o menu e a
  // alça de redimensionar, então casá-lo por texto exato é frágil.
  const th = page.locator(`thead th:has(button[title="${rotuloDaColuna}"])`).first();
  const td = page.locator("tfoot td.num").nth(indiceDoTotal);
  await expect(th).toBeVisible();
  await expect(td).toBeVisible();
  const [a, b] = [await th.boundingBox(), await td.boundingBox()];
  expect(a, "cabeçalho medido").toBeTruthy();
  expect(b, "célula de total medida").toBeTruthy();
  return Math.abs(a!.x - b!.x);
}

test.describe("rodapé de totais alinhado mesmo com a coluna de identidade", () => {
  test("animais: o total de Peso fica sob a coluna Peso, e o de Valor sob Valor", async ({ page }) => {
    await login(page);
    await page.goto("/pecuaria/animais");
    await expect(page.getByRole("columnheader", { name: "ID Global" })).toBeVisible();
    expect(await alinhamentoDeTotal(page, "Peso (kg)", 0), "total de Peso desalinhado da coluna Peso").toBeLessThan(2);
    expect(await alinhamentoDeTotal(page, "Valor", 1), "total de Valor desalinhado da coluna Valor").toBeLessThan(2);
  });

  test("vendas (Modelo Base1): o total fica sob a coluna Total — a compensação central também é cobrada", async ({ page }) => {
    await login(page);
    await page.goto("/vendas/sales");
    await expect(page.getByRole("columnheader", { name: "ID Global" })).toBeVisible();
    expect(await alinhamentoDeTotal(page, "Total", 0), "total desalinhado da coluna Total").toBeLessThan(2);
  });

  test("contas a pagar: os totais ficam sob Valor e Saldo", async ({ page }) => {
    await login(page);
    await page.goto("/financeiro/contas-a-pagar");
    await expect(page.getByRole("columnheader", { name: "ID Global" })).toBeVisible();
    expect(await alinhamentoDeTotal(page, "Valor", 0), "total de Valor desalinhado").toBeLessThan(2);
    expect(await alinhamentoDeTotal(page, "Saldo", 1), "total de Saldo desalinhado").toBeLessThan(2);
  });
});

/**
 * A COLUNA FIXA NÃO PODE OFERECER CONTROLE QUE NÃO FUNCIONA.
 *
 * "Ocultar" que não oculta, "Auto ajustar" que volta ao mesmo tamanho e arraste que se desfaz ao soltar são
 * piores do que a ausência do controle: o usuário não sabe se o sistema o ignorou ou se ele errou. As
 * capacidades são declaradas na COLUNA (`hideable`/`resizable`/`freezable`/`autoFit`), então a grade
 * continua genérica e a próxima coluna travada nasce correta.
 */
test.describe("capacidades da coluna de identidade", () => {
  test("ID Global não oferece menu de coluna nem alça de redimensionar; uma coluna normal continua oferecendo", async ({ page }) => {
    await login(page);
    await page.goto("/cadastros/products");
    await expect(page.getByRole("columnheader", { name: "ID Global" })).toBeVisible();

    await expect(page.getByLabel("Abrir menu da coluna ID Global"), "coluna de identidade não tem menu").toHaveCount(0);
    await expect(page.getByLabel("Redimensionar ID Global"), "coluna de identidade não tem alça de arraste").toHaveCount(0);

    // controle de coluna comum permanece intacto — a capacidade é por coluna, não um bloqueio global
    await expect(page.getByLabel("Abrir menu da coluna Descrição")).toHaveCount(1);
    await expect(page.getByLabel("Redimensionar Descrição")).toHaveCount(1);
    await page.getByLabel("Abrir menu da coluna Descrição").click();
    await expect(page.getByRole("menuitem", { name: "Ocultar coluna" })).toBeEnabled();
    await expect(page.getByRole("menuitem", { name: "Auto ajustar coluna" })).toBeEnabled();
    await page.keyboard.press("Escape");
  });

  test("ID Global permanece a primeira coluna e congelada", async ({ page }) => {
    await login(page);
    await page.goto("/cadastros/products");
    const primeiro = page.locator("thead th").nth(1); // 0 = célula de seleção
    await expect(primeiro).toContainText("ID Global");
    await expect(primeiro).toHaveClass(/is-frozen/);
  });
});
