import { test, expect, type Locator, type Page } from "@playwright/test";
import type { Workbook, Worksheet } from "exceljs";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { login, uniq } from "./helpers";

/**
 * `exceljs` é dependência de `@agro/api` (quem gera e lê o modelo), não de `@agro/web`. Com o pnpm estrito, o spec
 * não a resolve pelo próprio pacote: resolve pelo pacote da API — a MESMA biblioteca e versão que o servidor usa
 * para ler o arquivo que este teste escreve.
 */
const ExcelJS = createRequire(path.resolve(__dirname, "../../api/package.json"))("exceljs") as typeof import("exceljs");

/**
 * Importação na tela: o menu "Mais opções" do cadastro traz "Baixar modelo de importação" (baixa o XLSX)
 * e "Importar planilha" (abre o diálogo com a prévia). O processamento é coberto pela integração da API.
 */
test("M1 — o cadastro oferece baixar o modelo e importar planilha", async ({ page }) => {
  await login(page);
  await page.goto("/cadastros/financial_categories");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await page.getByRole("button", { name: "Mais opções" }).first().click();
  const [arquivo] = await Promise.all([page.waitForEvent("download"), page.getByText("Baixar modelo de importação").click()]);
  expect(arquivo.suggestedFilename()).toBe("modelo-financial_categories.xlsx");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Importar planilha")).toBeHidden();
  await page.getByRole("button", { name: "Mais opções" }).first().click();
  await page.getByText("Importar planilha").click();
  await expect(page.getByTestId("importar-dialogo")).toBeVisible();
  await expect(page.getByTestId("importar-arquivo")).toBeAttached();
});

// ------------------------------------------------------------------------------------------------------------------
// Correções R1 (especificação §6 e §9). O arquivo sai do MODELO baixado na própria tela e é editado com o ExcelJS;
// a prévia (`simular=1`) desfaz tudo no servidor, e nenhum teste abaixo confirma a importação de verdade: não sobra
// registro na base de e2e.

const DESCRICAO = "Descrição";

async function abrirMenuDoCadastro(page: Page) {
  await page.getByRole("button", { name: "Mais opções", exact: true }).first().click();
}

/** Menu do cadastro → "Importar planilha". Só retorna com o diálogo aberto. */
async function abrirImportacao(page: Page): Promise<Locator> {
  await abrirMenuDoCadastro(page);
  await page.getByRole("menuitem", { name: "Importar planilha" }).click();
  const dialogo = page.getByTestId("importar-dialogo");
  await expect(dialogo).toBeVisible();
  return dialogo;
}

/** Menu do cadastro → "Baixar modelo de importação", como o usuário faz; devolve o XLSX aberto e fecha o menu. */
async function baixarModelo(page: Page, destino: string): Promise<Workbook> {
  await abrirMenuDoCadastro(page);
  const [arquivo] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Baixar modelo de importação" }).click()]);
  await arquivo.saveAs(destino);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "Importar planilha" })).toBeHidden();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(destino);
  return wb;
}

/**
 * Caminho SEM acento para os arquivos que o navegador escolhe. A pasta de saída do teste leva o título dele
 * ("prévia", "—"), e o Chromium automatizado (CDP `setFileInputFiles`) não dispara `change` para caminho local com
 * caractere fora do ASCII — o arquivo nem chega à página. É peculiaridade da automação, não da tela: o seletor
 * nativo do sistema entrega o arquivo por outro caminho.
 */
function caminhoAscii(nome: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "importacao-e2e-"));
  return path.join(dir, nome);
}

/**
 * Escolhe o arquivo pelo seletor do navegador (clique no campo → file chooser), como o usuário. Escolher o MESMO
 * caminho de novo só dispara `change` se o campo tiver sido zerado: o Chromium compara a origem do arquivo e, igual,
 * não avisa a página. É exatamente o defeito que M2 cobre — por isso o caminho é o mesmo de propósito.
 */
async function escolherArquivo(page: Page, caminho: string) {
  const [seletor] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("importar-arquivo").click()]);
  await seletor.setFiles(caminho);
}

/** Índice da coluna na aba Dados pelo título, com ou sem o " *" de obrigatório. */
function coluna(dados: Worksheet, rotulo: string): number {
  let n = 0;
  dados.getRow(1).eachCell((c, i) => { if (String(c.value).replace(/ \*$/, "") === rotulo) n = i; });
  expect(n, `o modelo precisa ter a coluna "${rotulo}"`).toBeGreaterThan(0);
  return n;
}

/** Primeiro valor que o próprio modelo oferece na aba Listas para a coluna. */
function primeiroDaLista(wb: Workbook, chave: string): string {
  const listas = wb.getWorksheet("Listas");
  expect(listas, "o modelo precisa trazer a aba Listas").toBeTruthy();
  let c = 0;
  listas!.getRow(1).eachCell((x, n) => { if (String(x.value) === chave) c = n; });
  const v = c ? listas!.getRow(2).getCell(c).value : null;
  expect(v, `a aba Listas precisa ter ao menos um valor de "${chave}"`).toBeTruthy();
  return String(v);
}

/**
 * Linha 2 da aba Dados de PRODUTOS: toda coluna obrigatória (título com " *") com o primeiro valor da aba Listas, e
 * Controla estoque = Não — assim a Categoria financeira (custo), obrigatória só com Controla estoque = Sim, fica
 * fora da conta, e a única variável da linha é a Descrição (`null` = vazia).
 */
function preencherProduto(wb: Workbook, descricao: string | null) {
  const dados = wb.getWorksheet("Dados");
  expect(dados, "o modelo precisa trazer a aba Dados").toBeTruthy();
  const linha = dados!.getRow(2);
  dados!.getRow(1).eachCell((c, n) => {
    const titulo = String(c.value);
    if (titulo.endsWith(" *") && titulo !== `${DESCRICAO} *`) linha.getCell(n).value = primeiroDaLista(wb, titulo.slice(0, -2));
  });
  linha.getCell(coluna(dados!, "Controla estoque")).value = "Não";
  linha.getCell(coluna(dados!, DESCRICAO)).value = descricao;
  linha.commit();
}

async function abrirProdutos(page: Page) {
  await page.goto("/cadastros/products");
  await expect(page.locator("tbody tr").first()).toBeVisible();
}

const avisoToast = (page: Page, texto: string) => page.locator("[data-sonner-toast]").filter({ hasText: texto });

test("M2 — corrigir o arquivo e escolher o MESMO caminho de novo refaz a prévia", async ({ page }) => {
  await login(page);
  await abrirProdutos(page);
  const wb = await baixarModelo(page, caminhoAscii("modelo-products.xlsx"));
  const caminho = caminhoAscii("produtos.xlsx");
  preencherProduto(wb, null);
  await wb.xlsx.writeFile(caminho);

  const dialogo = await abrirImportacao(page);
  const previa = dialogo.getByTestId("importar-previa");
  const confirmar = dialogo.getByTestId("importar-confirmar");
  await escolherArquivo(page, caminho);
  await expect(previa, "a linha sem Descrição é recusada na prévia").toContainText("nada será gravado");
  await expect(previa.locator("tbody tr"), "o único erro é a Descrição: a correção abaixo é a única mudança").toHaveCount(1);
  await expect(previa.locator("tbody tr").first()).toContainText(DESCRICAO);
  await expect(previa.locator("tbody tr").first()).toContainText("Obrigatório.");
  await expect(confirmar, "com erro, não há botão de importar").toHaveCount(0);

  // o usuário corrige a planilha e salva POR CIMA do mesmo arquivo
  preencherProduto(wb, uniq("Produto importado E2E"));
  await wb.xlsx.writeFile(caminho);
  await escolherArquivo(page, caminho);
  await expect(previa, "o mesmo caminho, escolhido de novo, gera prévia NOVA").toContainText("nenhum erro");
  await expect(previa).not.toContainText("nada será gravado");
  await expect(previa.locator("tbody tr")).toHaveCount(0);
  await expect(confirmar).toBeVisible();
  await expect(confirmar).toHaveText("Importar 1 registro(s)");
});

test("M3 — falha de rede na prévia: aviso em português e nenhum botão de importar com a prévia antiga", async ({ page }) => {
  await login(page);
  await abrirProdutos(page);
  const wb = await baixarModelo(page, caminhoAscii("modelo-products.xlsx"));
  preencherProduto(wb, uniq("Produto rede E2E"));
  // dois caminhos com o MESMO conteúdo: a segunda escolha dispara `change` por si, e este teste não depende do M2
  const primeiro = caminhoAscii("produto-a.xlsx"); const segundo = caminhoAscii("produto-b.xlsx");
  await wb.xlsx.writeFile(primeiro); await wb.xlsx.writeFile(segundo);

  const dialogo = await abrirImportacao(page);
  const previa = dialogo.getByTestId("importar-previa");
  const confirmar = dialogo.getByTestId("importar-confirmar");
  await escolherArquivo(page, primeiro);
  await expect(confirmar, "premissa: há uma prévia boa na tela antes da falha").toBeVisible();

  const abortados: string[] = [];
  await page.route((url) => url.pathname.startsWith("/api/imports/"), async (rota) => {
    if (rota.request().method() !== "POST") return rota.fallback();
    abortados.push(rota.request().url());
    await rota.abort("internetdisconnected");
  });
  await escolherArquivo(page, segundo);
  await expect(avisoToast(page, "Não foi possível conferir o arquivo. Tente de novo.")).toBeVisible();
  expect(abortados.length, "o aviso veio da prévia que caiu na rede").toBeGreaterThan(0);
  expect(abortados.every((u) => new URL(u).searchParams.get("simular") === "1"), "só a prévia saiu").toBe(true);
  await expect(previa, "a prévia antiga some").toHaveCount(0);
  await expect(confirmar, "o botão de importar não fica disponível com estado velho").toHaveCount(0);
});

test("M4 — Pessoas › Funcionários: o diálogo avisa do filtro fixo da lista; em Todos, não há aviso", async ({ page }) => {
  await login(page);
  await page.goto("/pessoas");
  const papel = page.getByTestId("people-role");
  const funcionarios = papel.getByRole("radio", { name: "Funcionários", exact: true });
  const todos = papel.getByRole("radio", { name: "Todos", exact: true });

  await funcionarios.click();
  await expect(page).toHaveURL(/[?&]role=employee/);
  await expect(funcionarios).toHaveAttribute("aria-checked", "true");
  let dialogo = await abrirImportacao(page);
  await expect(dialogo.getByTestId("importar-aviso-filtro")).toHaveText("Esta lista mostra só registros com Funcionário = Sim. Para o registro importado aparecer aqui, preencha essa coluna na planilha.");
  await page.keyboard.press("Escape");
  await expect(dialogo).toBeHidden();

  await todos.click();
  await expect(todos).toHaveAttribute("aria-checked", "true");
  dialogo = await abrirImportacao(page);
  await expect(dialogo.getByTestId("importar-arquivo"), "premissa: o corpo do diálogo já montou").toBeAttached();
  await expect(dialogo.getByTestId("importar-aviso-filtro"), "lista sem filtro fixo não tem o que avisar").toHaveCount(0);
});

test("M5 — Novo produto: Categoria financeira (custo) é obrigatória enquanto Controla estoque = Sim", async ({ page }) => {
  await login(page);
  await page.goto("/cadastros/products/new");
  const form = page.getByTestId("b1-form");
  await form.getByRole("tab", { name: "Estoque", exact: true }).click();
  const categoria = form.locator("label", { hasText: "Categoria financeira (custo)" });
  const obrigatorio = categoria.locator("span.req");
  const controla = form.getByRole("combobox", { name: "Controla estoque", exact: true });
  const escolher = async (opcao: "Sim" | "Não") => {
    await controla.click();
    await page.locator(".cmd-panel").getByRole("option", { name: opcao, exact: true }).click();
    await expect(controla).toHaveText(opcao);
  };

  await expect(categoria).toBeVisible();
  await expect(controla, "produto novo nasce controlando estoque").toHaveText("Sim");
  await expect(obrigatorio, "Controla estoque = Sim: a categoria financeira é obrigatória").toBeVisible();
  await escolher("Não");
  await expect(obrigatorio, "Controla estoque = Não: deixa de ser obrigatória").toHaveCount(0);
  await escolher("Sim");
  await expect(obrigatorio, "de volta a Sim: volta a ser obrigatória").toBeVisible();
});

test("M6 — falha de rede ao confirmar: aviso manda conferir a listagem e o botão de importar some", async ({ page }) => {
  await login(page);
  await abrirProdutos(page);
  const wb = await baixarModelo(page, caminhoAscii("modelo-products.xlsx"));
  preencherProduto(wb, uniq("Produto gravação E2E"));
  const caminho = caminhoAscii("produto.xlsx");
  await wb.xlsx.writeFile(caminho);

  const dialogo = await abrirImportacao(page);
  const confirmar = dialogo.getByTestId("importar-confirmar");
  await escolherArquivo(page, caminho);
  await expect(confirmar, "premissa: prévia sem erro").toBeVisible();

  // só a GRAVAÇÃO cai; o pedido nunca chega ao servidor, então nada é gravado na base de e2e
  const abortados: string[] = [];
  await page.route((url) => url.pathname.startsWith("/api/imports/") && url.searchParams.get("simular") !== "1", async (rota) => {
    if (rota.request().method() !== "POST") return rota.fallback();
    abortados.push(rota.request().url());
    await rota.abort("internetdisconnected");
  });
  await confirmar.click();
  await expect(avisoToast(page, "Não foi possível confirmar a importação. Confira a listagem antes de tentar de novo.")).toBeVisible();
  expect(abortados, "o aviso veio da gravação que caiu na rede").toHaveLength(1);
  await expect(dialogo.getByTestId("importar-previa"), "a prévia some").toHaveCount(0);
  await expect(confirmar, "o botão de importar não fica disponível com estado velho").toHaveCount(0);
});
