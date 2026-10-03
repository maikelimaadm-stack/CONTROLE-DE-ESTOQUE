import { test, expect, type Locator, type Page, type Request, type Response } from "@playwright/test";
import { entendeSaldoInicialEstoque } from "@agro/domain";
import { login, api } from "./helpers";
import { cadastroDeEstoque } from "./estoque-01-comum";

/**
 * OPERACOES-01 F11 · K-1, SENTIDO 1 — O WEB DESTE HEAD CONTRA A API DA BASE (decisão 288; a janela "web antes da API").
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 1 roda em `playwright.skew.config.ts`, cujo `testMatch` é
 * `/skew-api-producao\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o `playwright.config.ts` comum
 * ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (lá a API seria a deste HEAD e o caso ficaria
 * verde por vacuidade). Arquivo próprio (molde `top-config-08-skew-api-producao.spec.ts`): o compartilhado
 * `skew-api-producao.spec.ts` não é desta fase.
 *
 * O QUE SE MEDE. A Implantação (Configurações › Implantação › Saldos iniciais de estoque) deste web só aponta para a
 * Central quando a API declara `capacidades.saldoInicial` no `operation-types` da entrada. O MUNDO É PERGUNTADO À BASE NA
 * HORA (o `operation-types` da entrada, direto), e a resposta que a TELA leu tem de dizer o mesmo:
 *   · MUNDO LEGADO (a base de hoje, sem a F11): a Implantação é a de hoje — o "Adicionar novo", nenhum "Lançar saldo
 *     inicial", nenhuma dica, nenhum caminho para a Central (`/estoque/movimentacoes/`) — e lançar pelo diálogo antigo dá
 *     201 e a linha aparece; o servidor tem o saldo;
 *   · MUNDO NOVO (a base já com a F11): a tela segue a resposta — sem TOP marcada, o "Adicionar novo" e a dica (e o
 *     diálogo antigo continua gravando); com TOP marcada, só o "Lançar saldo inicial".
 * Não há mock: o servidor é o binário da base, servindo o banco migrado e semeado por este HEAD.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
const ROTA_IMPLANTACAO = "/configuracoes?tab=implantacao&sub=estoque";
const DICA = "Para lançar o saldo inicial pela Central de Estoque, marque \"Lança o saldo inicial\" na aba Implantação de um tipo de operação de entrada (Configurações › Operações › Tipos de operação).";

type TopsDaEntrada = { capacidades?: unknown; items?: { saldoInicial?: unknown }[] };

/** Cabeçalhos da sessão gravada pelo web depois do login, para perguntar à base direto. Nunca impressos. */
async function cabecalhosDaSessao(page: Page): Promise<Record<string, string>> {
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token?: string; orgId?: string });
  return { authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}) };
}

/** Vigia do navegador: CORS morto não vira resposta nem exceção — sem o coletor, a tela renderizaria vazia e passaria. */
function vigiar(page: Page) {
  const falhas: string[] = []; const paraACentral: string[] = [];
  page.on("requestfailed", (r) => { if (r.url().includes(API)) falhas.push(`${r.url()} → ${r.failure()?.errorText ?? "?"}`); });
  page.on("console", (m) => { if (m.type() === "error" && /CORS|preflight|Access-Control/i.test(m.text())) falhas.push(`console: ${m.text()}`); });
  page.on("request", (r: Request) => { if (r.url().includes("/estoque/movimentacoes/")) paraACentral.push(r.url()); });
  return {
    semBloqueio: () => expect(falhas, "nenhuma requisição pode morrer no navegador (CORS/preflight)").toEqual([]),
    semCaminhoParaACentral: () => expect(paraACentral, "nenhuma requisição ao caminho da Central de Estoque").toEqual([])
  };
}

/** Escolhe num RefSelect DENTRO do diálogo, pelo rótulo do campo (o painel de pesquisa é o último aberto). */
async function escolherNoDialogo(page: Page, dialogo: Locator, rotulo: string, nome: string) {
  await dialogo.locator("label", { hasText: rotulo }).first().locator("..").locator("button").first().click();
  const painel = page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nome.slice(0, 20));
  await painel.getByRole("option", { name: new RegExp(nome.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).first().click();
}

test("OP01-F11 · K-1 (sentido 1) — a Implantação deste web contra a API da base: sem `saldoInicial` declarado, a tela de hoje, e o diálogo antigo grava (201)", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  // A PERGUNTA À BASE, antes de qualquer tela.
  const direto = await page.request.get(`${API}/api/estoque/entradas/operation-types`, { headers: cab });
  expect(direto.status(), "premissa: a base serve as TOPs de entrada").toBe(200);
  const daBase = (await direto.json()) as TopsDaEntrada;
  const declara = entendeSaldoInicialEstoque(daBase.capacidades);
  console.log(`[skew] OP01-F11 · K-1 · a base ${declara ? "DECLARA" : "NÃO declara"} capacidades.saldoInicial → mundo ${declara ? "novo" : "legado"}`);
  if (!declara) {
    expect(Object.keys((daBase.capacidades ?? {}) as object), "no legado, nenhuma chave da F11").not.toContain("saldoInicial");
    for (const it of daBase.items ?? []) expect(Object.keys(it), "no legado, o item não diz `saldoInicial`").not.toContain("saldoInicial");
  }

  const c = await cadastroDeEstoque(page);
  const v = vigiar(page);
  const lida = page.waitForResponse((r: Response) => new URL(r.url()).pathname === "/api/estoque/entradas/operation-types" && r.request().method() === "GET");
  await page.goto(ROTA_IMPLANTACAO);
  await expect(page.getByRole("heading", { name: "Estoques Iniciais" }), "premissa: a Implantação abriu").toBeVisible();
  const daTela = (await (await lida).json()) as TopsDaEntrada;
  expect(entendeSaldoInicialEstoque(daTela.capacidades), "a resposta que a tela leu diz o mesmo que a base disse").toBe(declara);
  const marcadas = declara ? (daTela.items ?? []).filter((x) => x.saldoInicial === true).length : 0;
  const adicionar = page.getByRole("button", { name: "Adicionar novo" });

  if (marcadas > 0) {
    // Mundo novo com TOP marcada: uma porta só, a da Central.
    await expect(page.getByTestId("implantacao-saldo-inicial")).toBeVisible();
    await expect(adicionar).toHaveCount(0);
    v.semBloqueio();
    return;
  }
  await expect(adicionar, "o 'Adicionar novo' de hoje").toBeVisible();
  await expect(page.getByTestId("implantacao-saldo-inicial"), "nenhum 'Lançar saldo inicial'").toHaveCount(0);
  if (declara) await expect(page.getByTestId("implantacao-saldo-inicial-dica"), "mundo novo sem TOP marcada: a dica").toHaveText(DICA);
  else {
    await expect(page.getByTestId("implantacao-saldo-inicial-dica"), "legado: nenhuma dica").toHaveCount(0);
    await expect(page.getByText("Os saldos iniciais lançados pela Central de Estoque", { exact: false }), "legado: o subtítulo de hoje").toHaveCount(0);
  }

  // O DIÁLOGO ANTIGO grava pela rota antiga da base: 201, a linha aparece, o servidor tem o saldo.
  await adicionar.click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByRole("heading", { name: "Novo estoque inicial" })).toBeVisible();
  await escolherNoDialogo(page, dialogo, "Local de estoque", c.nomeArmazem);
  await escolherNoDialogo(page, dialogo, "Produto", c.nomeProduto);
  await dialogo.getByLabel("Quantidade total").fill("3");
  await dialogo.getByLabel("Valor unitário").fill("4");
  const post = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/stock/opening-balances");
  await dialogo.getByRole("button", { name: "Salvar" }).click();
  const r = await post;
  expect(r.status(), `a rota antiga da base grava: ${await r.text()}`).toBe(201);
  await expect(dialogo).toBeHidden();
  await expect(page.locator("table").getByText(c.nomeProduto).first(), "a linha aparece na lista").toBeVisible();
  const saldo = await api<{ quantity: string }>(page, "GET", `/api/stock/balances/${c.armazem}/${c.produto}`);
  expect(saldo.quantity, "o servidor tem o saldo inicial").toBe("3.0000");
  expect(page.url(), "a tela não saiu da Implantação").toContain("/configuracoes");
  v.semCaminhoParaACentral();
  v.semBloqueio();
});
