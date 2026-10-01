import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * ESTOQUE-01 · ES-K1, SENTIDO 1 — A ABA MOVIMENTAÇÕES DESTE WEB CONTRA A API DA BASE (janela 3 da DEPLOYMENT).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O version skew roda em `playwright.skew.config.ts`, cujo `testMatch` é a
 * expressão `/skew-api-producao\.spec\.ts/` — sem âncora, então ela casa também com o fim deste nome; e o
 * `playwright.config.ts` comum ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (onde a API seria
 * a deste HEAD e o caso ficaria verde por vacuidade). O caso não foi acrescentado em `skew-api-producao.spec.ts`
 * porque aquele arquivo é de outra PR aberta (#79): editar o mesmo arquivo seria colisão (PRE-PR-02). A prova de que
 * os dois configs o enxergam do jeito certo é o `--list` de cada um (relatório da fatia), e a identidade da árvore
 * da base é provada pelo caso IDENTIDADE de `skew-api-producao.spec.ts`, na MESMA execução, contra o MESMO servidor.
 *
 * O QUE SE MEDE. A base anterior à ESTOQUE-01 não tem `GET /api/estoque/documentos` (404): a aba tem de dizer que
 * as movimentações estão indisponíveis nesta versão do servidor — nunca uma lista vazia, que afirmaria "não há
 * documentos" —, e o resto do /estoque (Visão geral, Saldo, Movimentações do ledger) continua funcionando. A
 * pergunta é feita à base ANTES da tela, e decide o ramo: base que já serve a porta (depois do merge) mostra a
 * lista, sem o aviso. Não há mock: o servidor é o binário da base.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";

/** Cabeçalhos da sessão gravada pelo web depois do login, para perguntar à base direto. */
async function cabecalhosDaSessao(page: Page): Promise<Record<string, string>> {
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token?: string; orgId?: string });
  return { authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}) };
}

/**
 * Vigia do navegador (o mesmo desenho de `skew-api-producao.spec.ts`): falha de CORS não vira exceção nem resposta
 * HTTP — o Chromium aborta a requisição antes de ela existir para a aplicação. Sem o coletor, a tela renderiza
 * vazia e o teste passa, que é exatamente o modo de falha desta janela.
 */
function vigiar(page: Page) {
  const falhas: string[] = [];
  page.on("requestfailed", (r) => { if (r.url().includes(API)) falhas.push(`${r.url()} → ${r.failure()?.errorText ?? "?"}`); });
  page.on("console", (m) => { if (m.type() === "error" && /CORS|preflight|Access-Control/i.test(m.text())) falhas.push(`console: ${m.text()}`); });
  return { semBloqueio: () => expect(falhas, "nenhuma requisição pode morrer no navegador (CORS/preflight)").toEqual([]) };
}

test("ESTOQUE-01 · ES-K1 (sentido 1) — sem a porta do documento de estoque na base, a aba Movimentações diz \"indisponíveis nesta versão do servidor\" e o resto do /estoque segue", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const direto = await page.request.get(`${API}/api/estoque/documentos?page=1&pageSize=1`, { headers: cab });
  const ausente = direto.status() === 404;
  console.log(`[skew] ES-K1 · a base responde ${direto.status()} a GET /api/estoque/documentos`);
  expect([200, 404], "a base ou serve a porta ou não a conhece — outro código é defeito, não skew").toContain(direto.status());

  await page.goto("/estoque?tab=movimentacoes");
  const aba = page.getByTestId("estoque-movimentacoes");
  await expect(aba, "a aba nova monta nos dois mundos").toBeVisible();
  const aviso = page.getByTestId("estoque-movimentacoes-indisponivel");
  if (ausente) {
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText("indisponíveis nesta versão do servidor");
    await expect(aba.getByRole("table"), "nada de lista vazia afirmando que não há documentos").toHaveCount(0);
    await expect(page.getByTestId("estoque-novo"), "nenhum `+ Novo` para uma porta que a base não tem").toHaveCount(0);
  } else {
    await expect(aba.getByRole("table").first(), "a base serve a porta: a lista aparece").toBeVisible();
    await expect(aviso).toHaveCount(0);
  }

  // O RESTO DO /estoque não depende da porta nova: Visão geral, Saldo e o ledger abrem com dados do servidor.
  await page.goto("/estoque?tab=visao-geral");
  await expect(page.getByText("Valor em estoque").first(), "a Visão geral abre").toBeVisible();
  await expect(aviso, "a Visão geral não depende da porta nova").toHaveCount(0);
  await page.goto("/estoque?tab=estoque&sub=saldo");
  await expect(page.getByRole("heading", { name: "Saldo de Estoque" }), "o Saldo abre").toBeVisible();
  await expect(page.getByRole("table").first()).toBeVisible();
  await page.goto("/estoque?tab=estoque&sub=ledger");
  await expect(page.getByRole("table").first(), "o ledger abre").toBeVisible();
  await expect(aviso).toHaveCount(0);
  v.semBloqueio();
});
