import { test, expect } from "@playwright/test";
import { api, login, uniq } from "./helpers";
import { ExcelJS, abrirImportacao, abrirProdutos, caminhoAscii, criarProduto, escolherArquivo, excluirProduto, gravarPlanilha, lerProduto, primeiroDaLista, semOLocal, titulos } from "./importar-01-comum";

/**
 * IMPORTAR-01 (decisão 317) — ATUALIZAR CADASTRO POR PLANILHA, NA TELA, contra a API deste HEAD.
 *
 * A pessoa escolhe "Atualizar registros existentes (pelo código)", baixa o modelo do ATUALIZAR (com a coluna Código),
 * deixa só as colunas que mudam, escolhe o arquivo, vê a PRÉVIA (quantas casaram, quantas não, e QUAIS colunas mudam
 * em cada uma) e confirma. O servidor é o árbitro: o que vai no fio é lido no fio, e o gravado pela API (`GET` da ficha).
 * O produto do caso nasce pela porta da tela e é excluído logicamente no fim.
 */

test("IMP01-E1 — escolhe ATUALIZAR, baixa o modelo com o Código, vê a prévia com as colunas que mudam, confirma: o servidor grava só o que mudou", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  const p = await criarProduto(page, uniq("IMP01 E2E Produto"));
  const antes = await lerProduto(page, p.id);
  try {
    await abrirProdutos(page);
    const dialogo = await abrirImportacao(page);
    const acao = dialogo.getByTestId("importar-acao");
    await expect(acao, "a escolha começa no CRIAR (o de sempre)").toHaveValue("criar");
    await expect(dialogo.getByTestId("importar-modelo-atualizar"), "o modelo do ATUALIZAR só aparece com a ação escolhida").toHaveCount(0);
    await acao.selectOption("atualizar");

    // o MODELO do ATUALIZAR: a coluna Código primeiro (a chave)
    const [baixado] = await Promise.all([page.waitForEvent("download"), dialogo.getByTestId("importar-modelo-atualizar").click()]);
    expect(baixado.suggestedFilename()).toBe("modelo-products-atualizar.xlsx");
    const destino = caminhoAscii("modelo-atualizar.xlsx"); await baixado.saveAs(destino);
    const modelo = new ExcelJS.Workbook(); await modelo.xlsx.readFile(destino);
    const cab = titulos(modelo);
    expect(cab[0]).toBe("Código *");
    expect(cab).toContain("Marca"); expect(cab).toContain("Local de estoque padrão");
    const local = primeiroDaLista(modelo, "Local de estoque padrão");

    // a pessoa deixa só o Código, a Marca (igual à de hoje) e o Local (novo): só o Local muda
    const caminho = await gravarPlanilha([cab[0]!, "Marca", "Local de estoque padrão"], [[p.code, "Marca IMP01", local]], "atualizar.xlsx");
    const pedidos: string[] = [];
    page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/imports/products") pedidos.push(new URL(r.url()).search); });
    await escolherArquivo(page, caminho);
    const previa = dialogo.getByTestId("importar-previa");
    await expect(previa.getByTestId("importar-casaram")).toHaveText("1 casaram pelo código");
    await expect(previa.getByTestId("importar-nao-casaram")).toHaveText("0 não casaram");
    await expect(previa.getByTestId("importar-mudam")).toHaveText("1 mudam");
    const linhas = previa.getByTestId("importar-alteracoes").locator("tbody tr");
    await expect(linhas).toHaveCount(1);
    await expect(linhas.first().locator("td")).toHaveText(["2", p.code, "Local de estoque padrão"]);
    expect(await lerProduto(page, p.id), "a prévia não gravou").toEqual(antes);

    const confirmar = dialogo.getByTestId("importar-confirmar");
    await expect(confirmar).toHaveText("Atualizar 1 registro(s)");
    const [resposta] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/imports/products" && new URL(r.url()).searchParams.get("simular") === "0"),
      confirmar.click(),
    ]);
    expect(resposta.status()).toBe(200);
    expect(await resposta.json()).toMatchObject({ acao: "atualizar", gravadas: 1, erros: [], alteracoes: [{ linha: 2, codigo: p.code, colunas: ["Local de estoque padrão"] }] });
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "1 registro(s) atualizado(s)" })).toBeVisible();
    await expect(dialogo).toBeHidden();
    expect(pedidos, "a prévia e a gravação, as duas com acao=atualizar").toEqual(["?simular=1&acao=atualizar", "?simular=0&acao=atualizar"]);

    // o SERVIDOR gravou só o que mudou: o local preenchido, todo o resto igual
    const depois = await lerProduto(page, p.id);
    expect(depois["default_warehouse_id"], "o local de estoque padrão foi gravado").toBeTruthy();
    const locais = await api<{ items: { id: string; initials: string; description: string }[] }>(page, "GET", "/api/resources/warehouses?pageSize=200");
    const daLista = locais.items.filter((w) => local.startsWith(`${w.initials} - ${w.description}`)).map((w) => w.id);
    expect(daLista, "o local gravado é o escolhido da lista do modelo").toContain(depois["default_warehouse_id"]);
    expect(semOLocal(depois), "nenhum outro campo mudou").toEqual(semOLocal(antes));
  } finally {
    await excluirProduto(page, p.id);
  }
});

test("IMP01-E2 — código que não existe: a prévia diz que não casou e não oferece gravar; nada é criado", async ({ page }) => {
  await login(page);
  await abrirProdutos(page);
  const dialogo = await abrirImportacao(page);
  await dialogo.getByTestId("importar-acao").selectOption("atualizar");
  const caminho = await gravarPlanilha(["Código", "Marca"], [["99999", "Marca Fantasma"]], "inexistente.xlsx");
  await escolherArquivo(page, caminho);
  const previa = dialogo.getByTestId("importar-previa");
  await expect(previa.getByTestId("importar-casaram")).toHaveText("0 casaram pelo código");
  await expect(previa.getByTestId("importar-nao-casaram")).toHaveText("1 não casaram");
  await expect(previa).toContainText('"99999" não encontrado em Produtos. Atualizar não cria registro');
  await expect(dialogo.getByTestId("importar-confirmar"), "nada a gravar").toHaveCount(0);
  await expect(dialogo.getByTestId("importar-parcial")).toHaveCount(0);
});

test("IMP01-E3 — cadastro sem código (Unidades de Medida) não oferece o ATUALIZAR; o CRIAR continua igual", async ({ page }) => {
  await login(page);
  await page.goto("/cadastros/measurement_units");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  const dialogo = await abrirImportacao(page);
  await expect(dialogo.getByTestId("importar-arquivo")).toBeAttached();
  await expect(dialogo.getByTestId("importar-acao")).toHaveCount(0);
});
