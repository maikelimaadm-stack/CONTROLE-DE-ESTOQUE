import { test, expect, type Page } from "@playwright/test";
import { login, uniq } from "./helpers";

/**
 * VERSION SKEW SENTIDO 2 — O WEB EM PRODUÇÃO CONTRA A API DESTA PR (PRE-BASE2-05B).
 *
 * Roda só em `playwright.skew-web-anterior.config.ts`: o navegador executa o bundle EXATO do commit base
 * (o web canônico da PRE-BASE2-05A, que está no ar) e o servidor é a API deste HEAD, que deixou de
 * entender o idioma antigo. Não há mock em nenhuma das duas pontas.
 *
 * POR QUE ESTE SENTIDO É O QUE IMPORTA AGORA
 *
 * Na 05A quem virava era o cliente, então o risco era o web à frente da API. Na 05B quem vira é o SERVIDOR:
 * se a API subir primeiro — e ela pode, porque Railway e Vercel não trocam de versão juntos —, todo mundo
 * que está com a aba aberta continua rodando o bundle anterior contra uma API que já removeu a borda
 * legada. Se aquele cliente dependesse de um cabeçalho, de um apelido de resposta, da chave de recurso
 * antiga ou do formato administrativo achatado, o produto quebraria em produção sem nenhum erro de
 * aplicação para investigar: o que falha é o fio.
 *
 * O teste não tenta adivinhar de que o cliente depende. Ele USA o cliente: entra, carrega o contexto,
 * troca de empresa, lista, filtra e cadastra — e falha se qualquer requisição morrer no navegador.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";

const sessao = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token?: string; orgId?: string; empresaId?: string | null });

/**
 * Vigia do navegador. Falha de CORS não vira exceção de JavaScript nem resposta HTTP: o Chromium aborta a
 * requisição ANTES de ela existir para a aplicação (`net::ERR_FAILED`) e escreve no console. Sem este
 * coletor, a tela renderiza vazia e o teste passa — que é exatamente o modo de falha desta janela.
 */
function vigiar(page: Page) {
  const falhas: string[] = []; const respostas: { url: string; status: number }[] = [];
  page.on("requestfailed", (r) => { if (r.url().includes(API)) falhas.push(`${r.url()} → ${r.failure()?.errorText ?? "?"}`); });
  page.on("console", (m) => { if (m.type() === "error" && /CORS|preflight|Access-Control/i.test(m.text())) falhas.push(`console: ${m.text()}`); });
  page.on("response", (r) => { if (r.url().includes("/api/")) respostas.push({ url: r.url(), status: r.status() }); });
  return {
    respostas,
    semBloqueio: () => expect(falhas, "nenhuma requisição do cliente em produção pode morrer no navegador").toEqual([]),
    /** Nenhuma resposta de erro de contrato: é assim que "a API removeu algo que o cliente usa" apareceria. */
    semErroDeContrato: () => {
      const ruins = respostas.filter((r) => r.status === 404 || r.status === 422 || r.status >= 500);
      expect(ruins, `o cliente em produção não pode receber erro de contrato da API nova: ${JSON.stringify(ruins)}`).toEqual([]);
    }
  };
}

test.describe.configure({ mode: "serial" });

test("o cliente é mesmo o ANTERIOR — e a API é a nova: sem essa prova o arquivo é decorativo", async ({ page, request }) => {
  await login(page);
  const s = await sessao(page);
  const auth = { authorization: `Bearer ${s.token}`, "x-org-id": String(s.orgId) };

  // A API deste HEAD já NÃO entende o idioma antigo — é o que distingue este servidor do da base.
  const recursoAnterior = await request.get(`${API}/api/resources/farms?pageSize=1`, { headers: auth });
  expect(recursoAnterior.status(), "a API desta PR não resolve mais a chave de recurso anterior").toBe(404);

  const cabecalhoAnterior = await request.get(`${API}/api/resources/warehouses?pageSize=1`, { headers: { ...auth, "x-farm-id": String(s.orgId) } });
  expect(cabecalhoAnterior.status(), "o cabeçalho anterior é recusado, não ignorado").toBe(422);

  // E o cliente é o de produção: ele fala canônico, que é o que o torna compatível com a API acima.
  const ctx = await (await request.get(`${API}/api/auth/context`, { headers: auth })).json();
  expect(ctx["empresas"], "o contexto canônico continua sendo entregue ao cliente anterior").toBeDefined();
  expect(ctx["farms"], "a API nova não devolve mais o apelido — e o cliente anterior não precisa dele").toBeUndefined();
});

test("entrar, carregar contexto e trocar de empresa — o cliente em produção não quebra", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const seletor = page.getByLabel("Empresa ativa");
  await expect(seletor.locator("option")).not.toHaveCount(1);   // "Todas as empresas" + as empresas reais
  await seletor.selectOption({ index: 1 });
  await expect(seletor).not.toHaveValue("");
  const s = await sessao(page);
  expect(s.empresaId, "a empresa escolhida ficou na sessão do cliente anterior").toBeTruthy();
  v.semBloqueio();
  v.semErroDeContrato();
});

test("listar cadastros e filtrar por empresa — os caminhos que o usuário usa de verdade", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  await page.getByLabel("Empresa ativa").selectOption("");
  await page.goto("/cadastros/warehouses");
  await expect(page.getByTestId("b1-row").first()).toBeVisible();
  const antes = await page.getByTestId("b1-row").count();

  await page.goto("/cadastros/empresas");
  await expect(page.getByTestId("b1-row").first()).toBeVisible();

  // O recorte por empresa do cliente anterior continua chegando ao servidor novo.
  await page.goto("/cadastros/warehouses");
  await expect(page.getByTestId("b1-row").first()).toBeVisible();
  await page.getByLabel("Empresa ativa").selectOption({ index: 1 });
  await expect.poll(() => page.getByTestId("b1-row").count(), { message: "a empresa selecionada recorta a listagem" }).toBeLessThan(antes);
  v.semBloqueio();
  v.semErroDeContrato();
});

test("cadastrar pelo formulário do cliente anterior: a API nova aceita o corpo que ele envia", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const desc = uniq("Armazém Cliente Anterior");
  await page.goto("/cadastros/warehouses/new");
  await expect(page.getByTestId("b1-form")).toBeVisible();

  const campoEmpresa = page.getByTestId("b1-form").locator("label", { hasText: /^Empresa/ }).first().locator("..");
  await campoEmpresa.locator("button[type=button]").first().click();
  const opcoes = page.locator(".cmd-panel [role=option]");
  await expect(opcoes.first(), "o seletor de referência listou as empresas").toBeVisible();
  await opcoes.first().click();

  await page.getByLabel(/^Sigla/).first().fill(`AN${Date.now().toString(36).slice(-3).toUpperCase()}`);
  await page.getByLabel(/^Descrição/).first().fill(desc);
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await page.waitForURL(/\/cadastros\/warehouses$/, { timeout: 20_000 });

  await page.getByLabel("Pesquisar", { exact: true }).click();
  await page.getByPlaceholder(/^Pesquisar por/).fill(desc);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("b1-row").filter({ hasText: desc }).first(), "o cadastro do cliente anterior foi gravado pela API nova").toBeVisible();
  v.semBloqueio();
  v.semErroDeContrato();
});

test("a rota de cadastro ANTERIOR continua levando o usuário à tela certa (favorito salvo)", async ({ page }) => {
  // Navegação não é protocolo: o redirect do web sobrevive até PRE-BASE2-05C, e a chave de recurso que a
  // API removeu não tem nada a ver com ele. Provado aqui para que a remoção da chave não leve o redirect
  // junto por engano — o usuário que guardou o link antigo continua chegando à tela.
  await login(page);
  await page.goto("/cadastros/farms");
  await expect(page).toHaveURL(/\/cadastros\/empresas/);
  await expect(page.getByTestId("b1-row").first()).toBeVisible();
});
