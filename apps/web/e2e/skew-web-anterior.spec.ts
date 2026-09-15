import { test, expect, type Page } from "@playwright/test";
import { login, uniq } from "./helpers";
import { criarEmpresaEConferirContador } from "./skew-contador-empresa";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

/**
 * VERSION SKEW SENTIDO 2 — O WEB EM PRODUÇÃO CONTRA A API DESTA PR.
 *
 * Roda só em `playwright.skew-web-anterior.config.ts`: o navegador executa o bundle EXATO do commit BASE
 * DESTA PR — seja ele qual for — e o servidor é a API deste HEAD. Não há mock em nenhuma das duas pontas.
 *
 * A base NÃO é uma fase nomeada. Ela é o `pull_request.base.sha`, e por isso a identidade é provada por SHA
 * (último caso deste arquivo), não por comportamento HTTP: desde que a 05B mesclou, os dois lados já são
 * canônicos, e um teste que tentasse distinguir base de HEAD pelo contrato passaria contra os DOIS
 * servidores — certificando o cenário errado com a aparência de rigor.
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

/**
 * O CONTADOR DE EMPRESA, NO SENTIDO 2 (API deste HEAD) — a outra metade da prova.
 *
 * O banco é o MESMO do sentido 1 e não há reset entre as duas execuções. Então a Empresa criada ali já está
 * gravada quando esta roda, e a exigência "maior que todos os códigos existentes, sem repetir nenhum" passa
 * a atravessar os dois binários. É essa travessia que a transição de contador da PRE-BASE2-05C-1 quebraria:
 * com `entity='farm'` e `entity='empresa'` como duas linhas de `erp.code_sequences`, os dois lados emitiriam
 * o mesmo próximo número e o segundo cadastro morreria no `unique (organization_id, code)`.
 *
 * Nenhum valor é fixado (`N === 3`): o banco do e2e é semeado e reutilizado, e um número esperado viraria
 * falha por acumulação. O que se cobra é a RELAÇÃO, que é o que o contrato garante.
 */
test("criar Empresa pela API DESTE HEAD, no mesmo banco do sentido 1, também aloca código novo e único", async ({ page, request }) => {
  await login(page);
  const s = await sessao(page);
  const auth = { authorization: `Bearer ${s.token}`, "x-org-id": String(s.orgId) };
  const codigo = await criarEmpresaEConferirContador(request, API, auth, "SKEW-HEAD");
  console.log(`[skew] sentido 2 (API deste HEAD) alocou o código de Empresa ${codigo}`);
});

/**
 * A IDENTIDADE DO BINÁRIO É O SHA EXATO DA BASE — não "um commit qualquer diferente do HEAD".
 *
 * A versão anterior deste caso só exigia `anterior !== HEAD`. Isso prova que os dois lados não são o mesmo
 * commit; NÃO prova qual é o outro lado. Um commit X qualquer passaria — inclusive o commit errado que a
 * resolução por ponta de branch podia escolher, que é justamente o defeito.
 *
 * A expectativa é LIDA de `.api-anterior.base`, gravado por quem montou a árvore: uma resolução por
 * execução, sem rede e sem recálculo. Recalcular aqui reintroduziria o problema pelo outro lado — num
 * evento de `push` a resolução cai na ponta de `origin/main`, e duas leituras da ponta podem divergir
 * dentro do mesmo job. Quando o CI injeta `SKEW_BASE_COMMIT` (`pull_request.base.sha`, imutável), a
 * igualdade é cobrada também contra ele: é a PR declarando qual é a sua base.
 */
test("o BUNDLE do navegador vem EXATAMENTE do commit da base da PR", async () => {
  const raiz = path.resolve(__dirname, "../../..");
  const rev = (cwd: string) => execFileSync("git", ["rev-parse", "HEAD"], { cwd }).toString().trim();
  // Lido do ARQUIVO, não recalculado nem importado do harness: o arquivo é o contrato entre quem monta a
  // árvore e quem a confere, e ler um arquivo não tem como divergir de si mesmo no meio do job.
  const esperada = fs.readFileSync(path.join(raiz, ".api-anterior.base"), "utf8").trim();
  expect(esperada, "`.api-anterior.base` é gravado por scripts/api-anterior.mjs ao montar a árvore").toMatch(/^[0-9a-f]{40}$/);

  const doEvento = (process.env.SKEW_BASE_COMMIT ?? "").trim();
  if (doEvento) expect(esperada, "a base usada é a que a PR declarou no evento").toBe(doEvento);

  const arvore = rev(path.join(raiz, ".api-anterior"));
  expect(arvore, "a árvore precisa estar na base EXATA, não num commit qualquer").toBe(esperada);
  expect(arvore, "e a base não pode ser este HEAD — seria comparar o commit com ele mesmo").not.toBe(rev(raiz));
});