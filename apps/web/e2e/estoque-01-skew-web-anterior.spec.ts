import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";
import { cadastroDeEstoque, criarTopDeEstoque, entradaConfirmadaPelaApi } from "./estoque-01-comum";

/**
 * ESTOQUE-01 · ES-K1, SENTIDO 2 — O WEB DA BASE CONTRA A API DESTA PR (janela 2 da DEPLOYMENT).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 2 roda em `playwright.skew-web-anterior.config.ts`, cujo
 * `testMatch` é `/skew-web-anterior\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o
 * `playwright.config.ts` comum ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (lá o web seria
 * o deste HEAD, e o caso não mediria o cliente anterior). O caso não foi acrescentado em `skew-web-anterior.spec.ts`
 * porque aquele arquivo é de outra PR aberta (#79): editar o mesmo arquivo seria colisão (PRE-PR-02). A identidade
 * do bundle da base é provada pelo caso IDENTIDADE de `skew-web-anterior.spec.ts`, na MESMA execução.
 *
 * O QUE SE MEDE. A API desta PR só ACRESCENTA (rotas `/api/estoque/*`, quatro famílias de TOP, quatro permissões); as
 * telas antigas do estoque não mudam. O navegador roda o bundle EXATO da base e usa o que o usuário usa: um documento
 * de estoque confirmado pela API nova (a entrada vira um movimento comum do ledger, `source_type`
 * `documentos_estoque`) aparece na Visão geral, no ledger e no Saldo da web anterior; e a TOP de uma família nova
 * aparece na lista de Tipos de Operação dela, com o rótulo que o SERVIDOR manda. Nenhuma requisição morre no
 * navegador, e nenhuma resposta é erro de contrato (404, 422, 5xx).
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";

/** Vigia do navegador (o desenho de `skew-web-anterior.spec.ts`): CORS morto e erro de contrato não passam calados. */
function vigiar(page: Page) {
  const falhas: string[] = []; const respostas: { url: string; status: number }[] = [];
  page.on("requestfailed", (r) => { if (r.url().includes(API)) falhas.push(`${r.url()} → ${r.failure()?.errorText ?? "?"}`); });
  page.on("console", (m) => { if (m.type() === "error" && /CORS|preflight|Access-Control/i.test(m.text())) falhas.push(`console: ${m.text()}`); });
  page.on("response", (r) => { if (r.url().includes("/api/")) respostas.push({ url: r.url(), status: r.status() }); });
  return {
    semBloqueio: () => expect(falhas, "nenhuma requisição do cliente em produção pode morrer no navegador").toEqual([]),
    semErroDeContrato: () => {
      const ruins = respostas.filter((r) => r.status === 404 || r.status === 422 || r.status >= 500);
      expect(ruins, `o cliente em produção não pode receber erro de contrato da API nova: ${JSON.stringify(ruins)}`).toEqual([]);
    }
  };
}

test("ESTOQUE-01 · ES-K1 (sentido 2) — o web da base contra a API deste HEAD: o documento de estoque confirmado aparece no ledger e no saldo antigos, e a TOP nova na lista de TOPs", async ({ page }) => {
  await login(page);
  // O cadastro e o documento nascem pela API DESTE HEAD (a que está sendo julgada), antes de a tela antiga abrir.
  const top = await criarTopDeEstoque(page, "entrada");
  const c = await cadastroDeEstoque(page);
  await entradaConfirmadaPelaApi(page, { top: top.id, empresa: c.empresa, armazem: c.armazem, produto: c.produto }, "5", "10");

  const v = vigiar(page);
  // A VISÃO GERAL antiga abre. Ela NÃO é a aba padrão do /estoque (o padrão é "Estoque", o saldo): a aba é pedida
  // pelo nome, que é o mesmo nos dois bundles.
  await page.goto("/estoque?tab=visao-geral");
  await expect(page.getByText("Valor em estoque").first(), "a Visão geral da web anterior abre").toBeVisible();

  // O LEDGER antigo: a entrada do documento é a linha mais nova do mês (ordem: data desc, criação desc).
  await page.goto("/estoque?tab=estoque&sub=ledger");
  const noLedger = page.getByRole("row").filter({ hasText: c.nomeProduto }).first();
  await expect(noLedger, "o movimento do documento de estoque aparece no ledger da web anterior").toBeVisible();
  await expect(noLedger).toContainText("5,0000");

  // O SALDO antigo, filtrado pelo produto: as 5 unidades.
  await page.goto(`/estoque?tab=estoque&sub=saldo&product_id=${c.produto}`);
  const noSaldo = page.getByRole("row").filter({ hasText: c.nomeProduto }).first();
  await expect(noSaldo, "o saldo do documento aparece no Saldo da web anterior").toBeVisible();
  await expect(noSaldo).toContainText("5,0000");

  // A LISTA DE TOPs da web anterior mostra a TOP da família nova (a busca é do servidor).
  await page.goto("/configuracoes?tab=operacoes&sub=tipos-operacao");
  await expect(page.getByRole("heading", { name: "Tipos de Operação" })).toBeVisible();
  await page.getByLabel("Buscar tipo de operação").fill(top.codigo);
  const daTop = page.getByRole("row").filter({ hasText: top.codigo }).first();
  await expect(daTop, "a TOP de estoque aparece na lista de TOPs da web anterior").toBeVisible();
  await expect(daTop, "com a família que o servidor declara").toContainText("estoque.entrada");

  v.semBloqueio();
  v.semErroDeContrato();
});
