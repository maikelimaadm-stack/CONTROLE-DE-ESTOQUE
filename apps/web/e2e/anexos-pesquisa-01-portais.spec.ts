import { test, expect, type Locator, type Page } from "@playwright/test";
import { api, empresaAtiva, login, primeiroId, uniq } from "./helpers";

/**
 * ANEXOS NOS PORTAIS DE VENDAS E DE COMPRAS (ANEXOS-PESQUISA-01, decisão 271).
 *
 * O botão Anexos das listas únicas (`DocList` com `entity="sales_documents"` / `"documentos_compra"`) já existia; o
 * que muda é o servidor, que passa a aceitar esses dois pais em `ATTACHMENT_PARENTS`. Abrir o diálogo não prova nada:
 * com o pai fora da whitelist o GET responde 422 e a lista fica vazia sem erro visível — o mesmo "Nenhum arquivo
 * anexado" de um documento sem anexo. O que distingue é o ciclo inteiro pela tela: o PDF SOBE, VOLTA na lista
 * (`b1-attachment` só existe para anexo persistido), BAIXA com o mesmo conteúdo e SOME ao excluir — e o servidor
 * confirma cada passo pela listagem oficial.
 *
 * A fixture nasce pela API (TOP, documento), e a data distante põe o documento na primeira página das duas listas,
 * que ordenam por data decrescente, mesmo num banco que já acumulou lançamentos de outras execuções.
 */

const DATA_DISTANTE = "2029-06-30";

/** Um PDF mínimo, válido o bastante para o tipo declarado; o conteúdo é a prova do download. */
const pdfPequeno = (marca: string) => Buffer.from(`%PDF-1.4\n% ${marca}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);

async function cadastrarTop(page: Page, codigoBase: string, rotulo: string): Promise<string> {
  const codigo = `7${Math.floor(Math.random() * 90000 + 10000)}`;
  return (await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase, nome: uniq(rotulo) })).id;
}

/**
 * A linha do documento na grade, pela CÉLULA EXATA do código mais a do tipo: o código é sequencial por espécie,
 * então o mesmo número pode existir como pedido e como venda (ou compra) na mesma lista.
 */
const linhaDoDocumento = (page: Page, lista: Locator, codigo: string, tipo: string) =>
  lista.getByTestId("b1-row")
    .filter({ has: page.getByRole("cell", { name: codigo, exact: true }) })
    .filter({ has: page.getByRole("cell", { name: tipo, exact: true }) });

/** Seleciona a linha, abre Anexos, envia o PDF, baixa, exclui — e confere cada passo no servidor. */
async function cicloDeAnexo(page: Page, lista: Locator, linha: Locator, entidade: string, id: string, marca: string) {
  await expect(linha, "premissa: o documento da fixture está na lista, uma vez só").toHaveCount(1);
  const anexar = lista.getByTestId("b1-attach");
  await expect(anexar, "sem seleção o botão fica desligado").toBeDisabled();
  await linha.getByRole("cell").nth(2).click();
  await expect(linha).toHaveAttribute("aria-selected", "true");
  await expect(anexar).toBeEnabled();
  await anexar.click();

  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByRole("heading", { name: /Anexos —/ })).toBeVisible();
  await expect(dialogo).toContainText("Nenhum arquivo anexado.");

  // ENVIAR
  // A marca só tem letras, dígitos e "_": o servidor higieniza o nome do arquivo ao guardar, e o teste fixa a
  // identidade do anexo, não a regra de higienização.
  const nomeArquivo = `${marca}.pdf`;
  const conteudo = pdfPequeno(marca);
  await dialogo.getByLabel("Nome do anexo").fill(`Comprovante ${marca}`);
  await dialogo.locator('input[aria-label="Selecionar arquivos"]').setInputFiles({ name: nomeArquivo, mimeType: "application/pdf", buffer: conteudo });
  const anexo = dialogo.getByTestId("b1-attachment");
  await expect(anexo, "o servidor aceitou o pai e o anexo voltou na lista").toHaveCount(1);
  await expect(anexo).toContainText(nomeArquivo);
  await expect(anexo).toContainText(`Comprovante ${marca}`);
  const noServidor = await api<{ items: { id: string; file_name: string; entity: string }[] }>(page, "GET", `/api/attachments?entity=${entidade}&entity_id=${id}`);
  expect(noServidor.items.map((a) => [a.entity, a.file_name]), "o anexo está sob o documento, pela entidade da lista").toEqual([[entidade, nomeArquivo]]);

  // BAIXAR — o arquivo que desce é o que subiu, byte a byte
  const [download] = await Promise.all([page.waitForEvent("download"), anexo.getByRole("button", { name: `Baixar ${nomeArquivo}` }).click()]);
  expect(download.suggestedFilename()).toBe(nomeArquivo);
  const caminho = await download.path();
  expect(caminho, "o download terminou").toBeTruthy();
  const { readFile } = await import("node:fs/promises");
  expect((await readFile(caminho!)).equals(conteudo), "o conteúdo baixado é o enviado").toBe(true);

  // EXCLUIR
  await anexo.getByRole("button", { name: `Excluir ${nomeArquivo}` }).click();
  const confirmar = page.getByTestId("confirm-dialog");
  await expect(confirmar).toContainText(nomeArquivo);
  await confirmar.getByTestId("confirm-dialog-confirm").click();
  await expect(confirmar).toBeHidden();
  await expect(dialogo.getByTestId("b1-attachment"), "o anexo excluído sai da lista").toHaveCount(0);
  await expect(dialogo).toContainText("Nenhum arquivo anexado.");
  const depois = await api<{ items: unknown[] }>(page, "GET", `/api/attachments?entity=${entidade}&entity_id=${id}`);
  expect(depois.items, "e o servidor não o lista mais").toHaveLength(0);
}

test("AX-W1 — Portal de Vendas: marcar uma venda → Anexos → enviar PDF → aparece → baixar → excluir", async ({ page }) => {
  await login(page);
  const top = await cadastrarTop(page, "vendas.venda", "Venda AX-W1");
  const empresa = await empresaAtiva(page);
  const cliente = await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1");
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const criada = await api<{ id: string }>(page, "POST", "/api/sales/sales", {
    empresa_id: empresa, document_date: DATA_DISTANTE, client_id: cliente, tipo_operacao_id: top,
    items: [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }]
  });
  const venda = await api<{ code: string; kind: string }>(page, "GET", `/api/sales/sales/${criada.id}`);
  expect(venda.kind, "premissa: a fixture é uma venda").toBe("sale");

  await page.goto("/vendas");
  const lista = page.getByTestId("vendas-documentos");
  await expect(lista).toBeVisible();
  await cicloDeAnexo(page, lista, linhaDoDocumento(page, lista, venda.code, "Venda"), "sales_documents", criada.id, `ax_w1_${Date.now().toString(36)}`);
});

test("AX-W2 — Portal de Compras: marcar uma compra → Anexos → enviar PDF → aparece → baixar → excluir", async ({ page }) => {
  await login(page);
  const top = await cadastrarTop(page, "compras.compra", "Compra AX-W2");
  const empresa = await empresaAtiva(page);
  const fornecedor = await primeiroId(page, "/api/resources/people?is_provider=true&pageSize=1");
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  // A TOP de Compra padrão gera conta a pagar: sem natureza e centro de resultado o servidor recusa (422).
  const naturezas = await api<{ id: string }[]>(page, "GET", "/api/resources/financial_categories/options?kind=analytic&nature=expense");
  const centros = await api<{ id: string }[]>(page, "GET", "/api/resources/cost_centers/options?kind=analytic");
  expect(naturezas.length && centros.length, "premissa: há natureza de despesa e centro analíticos").toBeTruthy();
  const criada = await api<{ id: string }>(page, "POST", "/api/compras/compras", {
    empresa_id: empresa, tipo_operacao_id: top, fornecedor_id: fornecedor, data_documento: DATA_DISTANTE,
    categoria_financeira_id: naturezas[0]!.id, centro_custo_id: centros[0]!.id,
    itens: [{ produto_id: produto, quantidade: "1", valor_unitario: "10.00" }]
  });
  const compra = await api<{ codigo: string; especie: string }>(page, "GET", `/api/compras/compras/${criada.id}`);
  expect(compra.especie, "premissa: a fixture é uma compra").toBe("compra");

  await page.goto("/compras");
  const lista = page.getByTestId("compras-documentos");
  await expect(lista).toBeVisible();
  await expect(lista.getByTestId("b1-row").first()).toBeVisible();
  await cicloDeAnexo(page, lista, linhaDoDocumento(page, lista, compra.codigo, "Compra"), "documentos_compra", criada.id, `ax_w2_${Date.now().toString(36)}`);
});
