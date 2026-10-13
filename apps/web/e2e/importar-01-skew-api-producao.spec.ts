import { test, expect, type Page } from "@playwright/test";
import type { Workbook } from "exceljs";
import { api, login, uniq } from "./helpers";
import { shaDaBase } from "./skew-fonte-da-base";
import { vigiar } from "./operacoes-01-f2-skew-comum";
import {
  COMMITS_DA_IMPORTAR01, ExcelJS, MARCA_ANTERIOR, MARCA_DA_IMPORTAR01, abrirImportacao, abrirProdutos, apiTemAtualizar, caminhoAscii, criarProduto,
  escolherArquivo, excluirProduto, fonteDaApiContem, fonteDoHeadContem, gravarPlanilha, lerProduto, primeiroDaLista, titulos
} from "./importar-01-comum";

/**
 * IMPORTAR-01 (decisão 317) · K1, SENTIDO 1 — A TELA DESTE HEAD CONTRA A API DA BASE (a janela "web antes da API" e a
 * reversão só da API).
 *
 * O nome casa com o `testMatch` de `playwright.skew.config.ts` (`/skew-api-producao\.spec\.ts/`), que o
 * `playwright.config.ts` comum ignora: este arquivo nunca roda contra a API deste HEAD.
 *
 * A DECISÃO (degrada sem quebrar): a tela deste HEAD não tem como saber, antes do primeiro pedido, se a API conhece o
 * ATUALIZAR (não há capacidade declarada — a fatia não cria nenhuma). Ela OFERECE a escolha; a PRÉVIA é o primeiro
 * pedido do ATUALIZAR, e a API da base recusa o parâmetro `acao` com o 422 "Campo não reconhecido" ANTES de abrir o
 * arquivo (consulta estrita). A tela então descarta o arquivo, volta ao CRIAR, desabilita o ATUALIZAR e diz por quê —
 * nada é gravado. O CRIAR continua valendo contra a base, com o pedido de sempre (sem `acao`).
 *
 * O MUNDO DA API DA BASE sai do FONTE do commit (`apiTemAtualizar`: a função `atualizarPlanilha` em `apps/api/src`;
 * reprova quando não consegue ler) e é CONFERIDO no fio: no legado o 422 da recusa; no novo (a base já com a IMPORTAR-01,
 * depois do merge), o ATUALIZAR completo. PROVA REVERSA DO DETECTOR no primeiro caso, sem navegador.
 */

test("IMP01 · K1 · prova reversa do detector: a base sem o ATUALIZAR ⇒ falso; o MESMO leitor acha no mesmo commit a marca que ele já tinha ⇒ verdadeiro; este HEAD tem a marca", () => {
  expect(fonteDoHeadContem(MARCA_DA_IMPORTAR01.api, "apps/api/src"), "premissa: a API deste HEAD tem o ATUALIZAR").toBe(true);
  expect(apiTemAtualizar(COMMITS_DA_IMPORTAR01.sem), `${COMMITS_DA_IMPORTAR01.sem.slice(0, 8)} (a base do LOTE 1): sem o ATUALIZAR`).toBe(false);
  expect(fonteDaApiContem(COMMITS_DA_IMPORTAR01.sem, MARCA_ANTERIOR.api), "o leitor lê o COMMIT: no mesmo commit, o `modo` parcial que já existia").toBe(true);
});

/** Linha 2 do modelo do CRIAR de produtos: os obrigatórios com o 1º valor da lista, Controla estoque = Não. */
function preencherProdutoDoCriar(wb: Workbook, descricao: string) {
  const dados = wb.getWorksheet("Dados")!; const linha = dados.getRow(2);
  dados.getRow(1).eachCell((c, n) => {
    const t = String(c.value);
    if (t === "Descrição *") linha.getCell(n).value = descricao;
    else if (t === "Controla estoque") linha.getCell(n).value = "Não";
    else if (t.endsWith(" *")) linha.getCell(n).value = primeiroDaLista(wb, t.slice(0, -2));
  });
  linha.commit();
}

async function baixarModeloDoMenu(page: Page) {
  await page.getByRole("button", { name: "Mais opções", exact: true }).first().click();
  const [arquivo] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Baixar modelo de importação" }).click()]);
  const destino = caminhoAscii("modelo-criar.xlsx"); await arquivo.saveAs(destino);
  await page.keyboard.press("Escape");
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(destino); return wb;
}

test("IMP01 · K1 (sentido 1) — a tela deste HEAD sobre a API da base: o ATUALIZAR degrada sem gravar (a base recusa `acao` antes do arquivo) e o CRIAR importa como sempre", async ({ page }) => {
  test.setTimeout(180_000);
  const sha = shaDaBase();
  const mundo = apiTemAtualizar(sha) ? "novo" : "legado";
  console.log(`[skew] IMPORTAR-01 · K1 · a API da base ${sha.slice(0, 8)} ${mundo === "novo" ? "TEM" : "NÃO tem"} o ATUALIZAR → mundo ${mundo}`);
  await login(page);
  const v = vigiar(page);
  const p = await criarProduto(page, uniq("IMP01 Skew1 Produto"));
  const antes = await lerProduto(page, p.id);
  const criados: string[] = [];
  try {
    await abrirProdutos(page);
    const dialogo = await abrirImportacao(page);
    const acao = dialogo.getByTestId("importar-acao");
    await acao.selectOption("atualizar");
    const caminho = await gravarPlanilha(["Código", "Marca"], [[p.code, "Marca Skew Nova"]], "skew1.xlsx");
    const [resposta] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/imports/products"),
      escolherArquivo(page, caminho),
    ]);
    expect(new URL(resposta.url()).search, "a prévia do ATUALIZAR leva `acao`").toBe("?simular=1&acao=atualizar");
    if (mundo === "legado") {
      expect(resposta.status(), "a base recusa o parâmetro que não conhece").toBe(422);
      expect(await resposta.json()).toEqual({ error: { code: "VALIDATION_ERROR", message: "Dados inválidos", details: [{ path: "", message: "Campo não reconhecido" }] } });
      await expect(dialogo.getByTestId("importar-sem-atualizar")).toHaveText("O servidor ainda não aceita atualizar por planilha. Nada foi gravado; para criar registros, escolha \"Criar registros novos\".");
      await expect(acao, "a tela volta ao CRIAR").toHaveValue("criar");
      await expect(acao.locator("option[value=\"atualizar\"]"), "e não oferece mais o ATUALIZAR").toBeDisabled();
      await expect(dialogo.getByTestId("importar-previa"), "nenhuma prévia de um pedido recusado").toHaveCount(0);
      await expect(dialogo.getByTestId("importar-confirmar")).toHaveCount(0);
      expect(await lerProduto(page, p.id), "nada gravado").toEqual(antes);
    } else {
      expect(resposta.status()).toBe(200);
      await expect(dialogo.getByTestId("importar-mudam")).toHaveText("1 mudam");
      await dialogo.getByTestId("importar-confirmar").click();
      await expect(dialogo).toBeHidden();
      expect((await lerProduto(page, p.id))["marca"]).toBe("Marca Skew Nova");
    }
    await page.keyboard.press("Escape");
    await expect(dialogo).toBeHidden();

    // O CRIAR, nos dois mundos, com o pedido de sempre (sem `acao`) e o modelo do menu
    const modelo = await baixarModeloDoMenu(page);
    expect(titulos(modelo).filter((t) => t === "Código" || t === "Código *"), "o modelo do CRIAR de produtos não tem Código").toEqual([]);
    const descricao = uniq("IMP01 Skew1 Criado");
    preencherProdutoDoCriar(modelo, descricao);
    const arquivo = caminhoAscii("skew1-criar.xlsx"); await modelo.xlsx.writeFile(arquivo);
    const d2 = await abrirImportacao(page);
    await expect(d2.getByTestId("importar-acao"), "a escolha começa no CRIAR").toHaveValue("criar");
    const pedidos: string[] = [];
    page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/imports/products") pedidos.push(new URL(r.url()).search); });
    await escolherArquivo(page, arquivo);
    await expect(d2.getByTestId("importar-certas")).toHaveText("1 linha(s) certa(s)");
    const [gravou] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/imports/products" && new URL(r.url()).searchParams.get("simular") === "0"),
      d2.getByTestId("importar-confirmar").click(),
    ]);
    expect(gravou.status(), "a base cria pelo CRIAR deste web").toBe(201);
    expect(pedidos, "o CRIAR sai como sempre, sem `acao`").toEqual(["?simular=1", "?simular=0"]);
    const achados = await api<{ items: { id: string; description: string }[] }>(page, "GET", `/api/resources/products?search=${encodeURIComponent(descricao)}`);
    criados.push(...achados.items.filter((x) => x.description === descricao).map((x) => x.id));
    expect(criados.length, "o produto do CRIAR existe").toBe(1);
    v.semBloqueio();
  } finally {
    for (const id of [p.id, ...criados]) await excluirProduto(page, id);
  }
});
