import { test, expect } from "@playwright/test";
import { api, login, uniq } from "./helpers";
import { fonteDoWebContem, shaDaBase } from "./skew-fonte-da-base";
import { vigiar } from "./operacoes-01-f2-skew-comum";
import {
  COMMITS_DA_IMPORTAR01, ExcelJS, MARCA_ANTERIOR, MARCA_DA_IMPORTAR01, abrirImportacao, abrirProdutos, caminhoAscii, escolherArquivo, excluirProduto,
  fonteDoHeadContem, primeiroDaLista, titulos, webTemAtualizar
} from "./importar-01-comum";

/**
 * IMPORTAR-01 (decisão 317) · K2, SENTIDO 2 — A WEB DA BASE (a que está no ar) CONTRA A API DESTE HEAD (a janela "API
 * antes da web").
 *
 * O nome casa com o `testMatch` de `playwright.skew-web-anterior.config.ts` (`/skew-web-anterior\.spec\.ts/`).
 *
 * O QUE SE MEDE: a web da base continua importando no CRIAR, como hoje, contra a API nova — o modelo do menu (sem
 * `acao`) é o de sempre (Produto sem coluna Código), a prévia e o "Importar tudo" saem sem `acao` e a API deste HEAD
 * responde com a forma de sempre (as mesmas chaves, nenhuma a mais). O VIGIA: nenhuma requisição morta e nenhum
 * 404/422/5xx da API nova na página.
 *
 * O MUNDO DA WEB DA BASE sai do FONTE do commit (`webTemAtualizar`: o seletor `importar-acao` em `apps/web/src`): no
 * legado a escolha da ação não existe no diálogo; no novo (a base já com a IMPORTAR-01) ela existe e começa no CRIAR.
 * PROVA REVERSA DO DETECTOR no primeiro caso, sem navegador.
 */

test("IMP01 · K2 · prova reversa do detector: a web da base sem a escolha da ação ⇒ falso; o MESMO leitor acha no mesmo commit o botão parcial que já existia ⇒ verdadeiro; este HEAD tem a marca", () => {
  expect(fonteDoHeadContem(MARCA_DA_IMPORTAR01.web, "apps/web/src"), "premissa: a web deste HEAD tem a escolha da ação").toBe(true);
  expect(webTemAtualizar(COMMITS_DA_IMPORTAR01.sem), `${COMMITS_DA_IMPORTAR01.sem.slice(0, 8)} (a base do LOTE 1): sem a escolha`).toBe(false);
  expect(fonteDoWebContem(COMMITS_DA_IMPORTAR01.sem, MARCA_ANTERIOR.web), "o leitor lê o COMMIT: no mesmo commit, o botão parcial").toBe(true);
});

test("IMP01 · K2 (sentido 2) — a web da base importa no CRIAR, como hoje, contra a API deste HEAD: modelo de sempre, pedido sem `acao`, 201 com a forma de sempre", async ({ page }) => {
  test.setTimeout(180_000);
  const sha = shaDaBase();
  const mundo = webTemAtualizar(sha) ? "novo" : "legado";
  console.log(`[skew] IMPORTAR-01 · K2 · a web da base ${sha.slice(0, 8)} ${mundo === "novo" ? "TEM" : "NÃO tem"} a escolha da ação → mundo ${mundo}`);
  await login(page);
  const v = vigiar(page);
  const criados: string[] = [];
  try {
    await abrirProdutos(page);
    await page.getByRole("button", { name: "Mais opções", exact: true }).first().click();
    const [baixado] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Baixar modelo de importação" }).click()]);
    expect(baixado.suggestedFilename()).toBe("modelo-products.xlsx");
    const destino = caminhoAscii("modelo-base.xlsx"); await baixado.saveAs(destino);
    await page.keyboard.press("Escape");
    const modelo = new ExcelJS.Workbook(); await modelo.xlsx.readFile(destino);
    expect(titulos(modelo).filter((t) => t === "Código" || t === "Código *"), "o modelo do menu é o do CRIAR: Produto sem Código").toEqual([]);
    const descricao = uniq("IMP01 Skew2 Criado");
    const dados = modelo.getWorksheet("Dados")!; const linha = dados.getRow(2);
    dados.getRow(1).eachCell((c, n) => {
      const t = String(c.value);
      if (t === "Descrição *") linha.getCell(n).value = descricao;
      else if (t === "Controla estoque") linha.getCell(n).value = "Não";
      else if (t.endsWith(" *")) linha.getCell(n).value = primeiroDaLista(modelo, t.slice(0, -2));
    });
    linha.commit();
    const arquivo = caminhoAscii("skew2.xlsx"); await modelo.xlsx.writeFile(arquivo);

    const dialogo = await abrirImportacao(page);
    if (mundo === "legado") await expect(dialogo.getByTestId("importar-acao"), "a web da base não tem a escolha da ação").toHaveCount(0);
    else await expect(dialogo.getByTestId("importar-acao")).toHaveValue("criar");
    const pedidos: string[] = [];
    page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/imports/products") pedidos.push(new URL(r.url()).search); });
    const [previa] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/imports/products"),
      escolherArquivo(page, arquivo),
    ]);
    expect(previa.status()).toBe(200);
    await expect(dialogo.getByTestId("importar-certas")).toHaveText("1 linha(s) certa(s)");
    const [gravou] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/imports/products" && new URL(r.url()).searchParams.get("simular") === "0"),
      dialogo.getByTestId("importar-confirmar").click(),
    ]);
    expect(gravou.status(), "a API deste HEAD cria pelo CRIAR da web da base").toBe(201);
    const corpo = await gravou.json() as Record<string, unknown>;
    expect(Object.keys(corpo), "a resposta do CRIAR com as chaves de sempre, nenhuma a mais").toEqual(["linhas", "gravadas", "erros", "simulacao", "modo", "certas", "com_erro", "planilha_erros_base64"]);
    expect(corpo).toMatchObject({ linhas: 1, gravadas: 1, erros: [], modo: "tudo" });
    expect(pedidos, "a web da base pede como sempre, sem `acao`").toEqual(["?simular=1", "?simular=0"]);
    await expect(dialogo).toBeHidden();
    const achados = await api<{ items: { id: string; description: string }[] }>(page, "GET", `/api/resources/products?search=${encodeURIComponent(descricao)}`);
    criados.push(...achados.items.filter((x) => x.description === descricao).map((x) => x.id));
    expect(criados.length, "o produto do CRIAR existe").toBe(1);
    v.semBloqueio();
    v.semErroDeContrato();
  } finally {
    for (const id of criados) await excluirProduto(page, id);
  }
});
