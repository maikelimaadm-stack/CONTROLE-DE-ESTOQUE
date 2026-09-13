import { test, expect, type Page } from "@playwright/test";
import { login, uniq } from "./helpers";

/**
 * VERSION SKEW B — O WEB DESTA PR CONTRA A API DO COMMIT BASE (PRE-BASE2-03).
 *
 * Roda só em `playwright.skew.config.ts`, que sobe a API EXATA do commit base (montada por
 * `scripts/api-anterior.mjs`) servindo o MESMO banco já migrado por 0014, 0015 e as correções desta rodada.
 * Não há mock: o servidor aqui é o binário que está no ar enquanto esta PR não sobe.
 *
 * A migração fazenda → empresa é a única desta PR que pode derrubar o produto inteiro SEM um erro de
 * aplicação, porque o que ela muda é o FIO. Cinco coisas quebram, e nenhuma delas aparece como exceção:
 * o preflight do CORS recusa `X-Empresa-Id` e a tela não carrega; `/auth/context` devolve `farms`;
 * `/api/resources/empresas` é 404; um corpo com `empresa_id` é 422; e `empresa_id__eq` na query é
 * DESCARTADO em silêncio — o filtro não erra, ele mente.
 *
 * Por isso este arquivo é o único que fala o idioma antigo por dentro: ele mede o fio. O produto continua
 * canônico, e o teste "nenhuma tela conhece o nome antigo" é quem garante isso no mesmo navegador.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
const WIRE_LEGADO = /(^|[?&])(farm_id|origin_farm_id|destination_farm_id)(__[a-z]+)?=/;
const WIRE_CANONICO = /(^|[?&])(empresa_id|empresa_origem_id|empresa_destino_id)(__[a-z]+)?=/;

/** Sessão gravada pelo web depois do login: token e organização, para falar com a API direto. */
const sessao = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token?: string; orgId?: string; empresaId?: string | null });

/**
 * Vigia do navegador. Falha de CORS não vira exceção de JavaScript nem resposta HTTP: o Chromium aborta a
 * requisição ANTES de ela existir para a aplicação (`net::ERR_FAILED`) e escreve no console. Sem este
 * coletor, a tela renderiza vazia e o teste passa — que é exatamente o modo de falha desta janela.
 */
function vigiar(page: Page) {
  const falhas: string[] = []; const urls: string[] = [];
  page.on("requestfailed", (r) => { if (r.url().includes(API)) falhas.push(`${r.url()} → ${r.failure()?.errorText ?? "?"}`); });
  page.on("console", (m) => { if (m.type() === "error" && /CORS|preflight|Access-Control/i.test(m.text())) falhas.push(`console: ${m.text()}`); });
  page.on("request", (r) => { if (r.url().includes("/api/")) urls.push(r.url()); });
  return {
    urls,
    semBloqueio: () => expect(falhas, "nenhuma requisição pode morrer no navegador (CORS/preflight)").toEqual([]),
    /** O fio é legado nas duas pontas: é o único idioma que a API anterior entende e a nova também. */
    fioLegado: () => {
      const canonicas = urls.filter((u) => WIRE_CANONICO.test(u) || /\/api\/resources\/empresas(\/|\?|$)/.test(u));
      expect(canonicas, `o idioma canônico não pode sair no fio durante a ponte: ${canonicas.join(" ")}`).toEqual([]);
    }
  };
}

test.describe.configure({ mode: "serial" });

test("o servidor É o commit base — as cinco quebras do fio existem de verdade", async ({ page, request }) => {
  // Sem esta prova o arquivo inteiro é decorativo: contra a API NOVA todas as asserções abaixo passariam,
  // e o teste teria certificado o cenário errado — a única falha que ele não pode ter.
  await login(page);
  const s = await sessao(page);
  const auth = { authorization: `Bearer ${s.token}`, "x-org-id": String(s.orgId) };

  const ctx = await (await request.get(`${API}/api/auth/context`, { headers: auth })).json();
  expect(ctx["farms"], "a API anterior devolve a lista de empresas com o nome antigo").toBeDefined();
  expect(ctx["empresas"], "…e NÃO devolve o nome canônico: é isso que a torna a versão anterior").toBeUndefined();

  const pre = await request.fetch(`${API}/api/auth/context`, {
    method: "OPTIONS",
    headers: { origin: page.url().replace(/(https?:\/\/[^/]+).*/, "$1"), "access-control-request-method": "GET", "access-control-request-headers": "x-empresa-id" }
  });
  const permitidos = (pre.headers()["access-control-allow-headers"] ?? "").toLowerCase();
  expect(permitidos, "o CORS da API anterior declara o cabeçalho legado").toContain("x-farm-id");
  expect(permitidos, "…e não o canônico: um navegador que o enviasse teria o preflight recusado").not.toContain("x-empresa-id");

  expect((await request.get(`${API}/api/resources/empresas?pageSize=1`, { headers: auth })).status(), "o recurso canônico não existe naquele binário").toBe(404);
  expect((await request.get(`${API}/api/resources/farms?pageSize=1`, { headers: auth })).status()).toBe(200);

  const corpoCanonico = await request.post(`${API}/api/resources/warehouses`, { headers: auth, data: { empresa_id: ctx["farms"][0].id, initials: "SK1", description: "skew", type: "inputs" } });
  expect(corpoCanonico.status(), "schema .strict(): o nome canônico no corpo é campo não reconhecido").toBe(422);

  const todos = await (await request.get(`${API}/api/resources/warehouses?pageSize=100`, { headers: auth })).json();
  const canonico = await (await request.get(`${API}/api/resources/warehouses?pageSize=100&empresa_id__eq=${ctx["farms"][0].id}`, { headers: auth })).json();
  const legado = await (await request.get(`${API}/api/resources/warehouses?pageSize=100&farm_id__eq=${ctx["farms"][0].id}`, { headers: auth })).json();
  expect(canonico["total"], "o filtro canônico é DESCARTADO em silêncio — não erra, mente").toBe(todos["total"]);
  expect(legado["total"], "só o nome legado filtra de verdade").toBeLessThan(Number(todos["total"]));
});

test("entrar, carregar o contexto e escolher a empresa — sem nenhuma requisição morrer no navegador", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const seletor = page.getByLabel("Empresa ativa");
  // A API anterior respondeu `farms`; o cliente promove para `empresas` antes de a tela ver o dado.
  await expect(seletor.locator("option")).not.toHaveCount(1);   // "Todas as empresas" + as empresas reais
  await seletor.selectOption({ index: 1 });
  await expect(seletor).not.toHaveValue("");
  await page.goto("/cadastros/warehouses");
  await expect(page.getByTestId("b1-row").first()).toBeVisible();
  const s = await sessao(page);
  expect(s.empresaId, "a empresa escolhida fica na sessão com o nome canônico").toBeTruthy();
  v.semBloqueio(); v.fioLegado();
});

test("/cadastros/empresas abre contra o binário que não conhece esse recurso", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  await page.goto("/cadastros/empresas");
  // `/api/resources/empresas` é 404 naquele servidor: a tela só abre porque o fio pede `farms`.
  await expect(page.getByTestId("b1-row").first()).toBeVisible();
  expect(await page.getByTestId("b1-row").count(), "a listagem trouxe as empresas da organização").toBeGreaterThan(0);
  expect(v.urls.some((u) => /\/api\/resources\/farms(\/|\?)/.test(u)), `o fio pediu o recurso legado: ${v.urls.join(" ")}`).toBe(true);
  v.semBloqueio(); v.fioLegado();
});

test("`farm_id` volta como `empresa_id`: a coluna Empresa da listagem genérica não vem vazia", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  // A listagem genérica desenha `<campo>_label` — `empresa_id_label`, sem nenhum fallback para o nome antigo.
  // Se a promoção da RESPOSTA não acontecesse, a coluna existiria e estaria em branco: erro nenhum, dado nenhum.
  const resposta = page.waitForResponse((r) => /\/api\/resources\/warehouses\?/.test(r.url()) && r.status() === 200);
  await page.goto("/cadastros/warehouses");
  const corpo = await (await resposta).json() as { items: Record<string, unknown>[] };
  expect(corpo.items[0], "a API anterior responde com o nome antigo").toHaveProperty("farm_id");
  expect(corpo.items[0]!["empresa_id"], "…e não com o canônico").toBeUndefined();

  const colunas = await page.locator("thead th").allInnerTexts();
  const iEmpresa = colunas.findIndex((c) => /^\s*Empresa\s*$/i.test(c));
  expect(iEmpresa, `a coluna Empresa existe na tela: ${colunas.join(" | ")}`).toBeGreaterThanOrEqual(0);
  const celula = page.getByTestId("b1-row").first().locator("td").nth(iEmpresa);
  await expect(celula, "coluna Empresa preenchida = `farm_id_label` virou `empresa_id_label` no cliente").not.toHaveText("");
  v.semBloqueio(); v.fioLegado();
});

test("RefSelect de Empresa e cadastro real: o corpo sai com o nome que o servidor anterior aceita", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const desc = uniq("Armazém Skew");
  await page.goto("/cadastros/warehouses/new");
  await expect(page.getByTestId("b1-form")).toBeVisible();

  // RefSelect: as opções vêm de `/api/resources/empresas/options`, que no fio vira `farms/options` (404 se não virasse).
  const campoEmpresa = page.getByTestId("b1-form").locator("label", { hasText: /^Empresa/ }).first().locator("..");
  await campoEmpresa.locator("button[type=button]").first().click();
  const opcoes = page.locator(".cmd-panel [role=option]");
  await expect(opcoes.first(), "o seletor de referência listou as empresas vindas da API anterior").toBeVisible();
  const empresaEscolhida = (await opcoes.first().innerText()).trim();
  await opcoes.first().click();

  await page.getByLabel(/^Sigla/).first().fill(`SK${Date.now().toString(36).slice(-3).toUpperCase()}`);
  await page.getByLabel(/^Descrição/).first().fill(desc);
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await page.waitForURL(/\/cadastros\/warehouses$/, { timeout: 20_000 });

  await page.getByLabel("Pesquisar", { exact: true }).click();
  await page.getByPlaceholder(/^Pesquisar por/).fill(desc);
  await page.keyboard.press("Enter");
  const linha = page.getByTestId("b1-row").filter({ hasText: desc }).first();
  await expect(linha, "o registro foi gravado pelo servidor anterior, com empresa").toBeVisible();
  expect(empresaEscolhida.length).toBeGreaterThan(0);
  v.semBloqueio(); v.fioLegado();
});

test("filtrar por empresa realmente filtra — e não só parece filtrar", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  // Sem empresa ativa a listagem traz as duas empresas; o filtro por coluna é quem recorta. Contra a API
  // anterior, um `empresa_id__eq` seria ignorado e a contagem ficaria IGUAL — o filtro que mente.
  await page.getByLabel("Empresa ativa").selectOption("");
  await page.goto("/cadastros/warehouses");
  await expect(page.getByTestId("b1-row").first()).toBeVisible();
  const antes = await page.getByTestId("b1-row").count();
  expect(antes, "o cenário só discrimina se houver armazém de mais de uma empresa").toBeGreaterThan(1);

  const faixa = page.getByLabel("Mostrar faixa de filtros");
  if (await faixa.count()) await faixa.click();
  // O nome vem do seletor da moldura, que já foi preenchido pela resposta promovida — não de uma constante
  // do seed: o teste mede o caminho do dado, não uma string que alguém pode ter copiado para os dois lados.
  const empresa = (await page.getByLabel("Empresa ativa").locator("option").nth(1).innerText()).trim();
  await page.getByRole("button", { name: "Filtro Empresa" }).click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  await painel.locator("label", { hasText: empresa }).first().click();
  await painel.getByRole("button", { name: "OK" }).click();

  await expect.poll(() => page.getByTestId("b1-row").count(), { message: "o recorte por empresa chegou ao servidor anterior" }).toBeLessThan(antes);
  const colunas = await page.locator("thead th").allInnerTexts();
  const iEmpresa = colunas.findIndex((c) => /^\s*Empresa\s*$/i.test(c));
  const empresas = new Set((await page.getByTestId("b1-row").locator(`td:nth-child(${iEmpresa + 1})`).allInnerTexts()).map((t) => t.trim()));
  expect([...empresas], "todas as linhas restantes são da empresa escolhida").toEqual([empresa]);
  expect(v.urls.some((u) => WIRE_LEGADO.test(u)), `o filtro viajou com o nome legado: ${v.urls.filter((u) => u.includes("warehouses")).join(" ")}`).toBe(true);
  v.semBloqueio(); v.fioLegado();
});

test("nenhuma tela conhece o nome antigo: a moldura do produto é canônica", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  await page.goto("/cadastros/warehouses");
  await expect(page.getByTestId("b1-row").first()).toBeVisible();
  /**
   * A auditoria é da MOLDURA (cabeçalho de coluna, rótulo de campo, aba, menu) — não do DADO. O nome de uma
   * empresa cadastrada é do usuário: "[DEMO] Fazenda Santa Luzia" continua se chamando assim depois da
   * migração, e proibir a palavra no conteúdo seria reescrever o cadastro dele, não renomear o produto.
   */
  const moldura = [
    ...await page.locator("thead th").allInnerTexts(),
    ...await page.locator("label").allInnerTexts(),
    ...await page.getByRole("tab").allInnerTexts(),
    ...await page.locator("nav a").allInnerTexts()
  ].map((t) => t.trim()).filter(Boolean);
  const nicho = moldura.filter((t) => /fazenda|farm/i.test(t));
  expect(nicho, `a moldura do produto ainda fala o nicho: ${nicho.join(" | ")}`).toEqual([]);
  expect(moldura.some((t) => /^Empresa$/i.test(t)), `a coluna canônica está desenhada: ${moldura.join(" | ")}`).toBe(true);
  expect(page.url()).not.toMatch(/farms|fazendas/);
  v.semBloqueio(); v.fioLegado();
});
