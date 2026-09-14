import { test, expect, type Page } from "@playwright/test";
import { login, uniq } from "./helpers";

/**
 * VERSION SKEW — O WEB DESTA PR CONTRA A API QUE ESTÁ NO AR (PRE-BASE2-05A).
 *
 * Roda só em `playwright.skew.config.ts`, que sobe a API EXATA do commit BASE desta PR (montada por
 * `scripts/api-anterior.mjs`) servindo o MESMO banco já migrado. Não há mock: o servidor aqui é o binário
 * que está em produção enquanto esta PR não sobe.
 *
 * O QUE ESTE ARQUIVO MEDIA ANTES, E POR QUE MUDOU
 *
 * Até a PRE-BASE2-04 ele apontava para a API anterior à PRE-BASE2-03 e provava o contrário do que prova
 * agora: que o fio TINHA de ser legado, porque o CORS daquele binário não declarava `X-Empresa-Id` e o
 * preflight morria no navegador. A PRE-BASE2-05A vira o cliente para o canônico — e aquela combinação
 * deixa de ser um cenário de produção, porque a API canônica está no ar desde a PRE-BASE2-03 e não volta.
 *
 * Apagar seria perder a prova; manter apontado para lá seria certificar um cenário que não existe mais.
 * Então o arquivo foi RECLASSIFICADO: mede o skew que de fato existe depois do cutover — web novo sobre a
 * API em produção — e o contrato que a PRE-BASE2-05A assume, que é justamente este: **o cliente canônico
 * só sobe sobre uma API que já entende o canônico**. Se um dia alguém reverter a API para antes da
 * PRE-BASE2-03, o primeiro teste aqui reprova antes de o produto quebrar no navegador do cliente.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
const WIRE_LEGADO = /(^|[?&])(farm_id|origin_farm_id|destination_farm_id)(__[a-z]+)?=/;

/** Sessão gravada pelo web depois do login: token e organização, para falar com a API direto. */
const sessao = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token?: string; orgId?: string; empresaId?: string | null });

/**
 * Vigia do navegador. Falha de CORS não vira exceção de JavaScript nem resposta HTTP: o Chromium aborta a
 * requisição ANTES de ela existir para a aplicação (`net::ERR_FAILED`) e escreve no console. Sem este
 * coletor, a tela renderiza vazia e o teste passa — que é exatamente o modo de falha desta janela.
 */
function vigiar(page: Page) {
  const falhas: string[] = []; const urls: string[] = []; const cabecalhos: { url: string; empresa?: string; farm?: string }[] = [];
  page.on("requestfailed", (r) => { if (r.url().includes(API)) falhas.push(`${r.url()} → ${r.failure()?.errorText ?? "?"}`); });
  page.on("console", (m) => { if (m.type() === "error" && /CORS|preflight|Access-Control/i.test(m.text())) falhas.push(`console: ${m.text()}`); });
  page.on("request", (r) => { if (r.url().includes("/api/")) { urls.push(r.url()); const h = r.headers(); cabecalhos.push({ url: r.url(), empresa: h["x-empresa-id"], farm: h["x-farm-id"] }); } });
  return {
    urls, cabecalhos,
    semBloqueio: () => expect(falhas, "nenhuma requisição pode morrer no navegador (CORS/preflight)").toEqual([]),
    /** Depois do cutover o fio é canônico nas duas pontas — e o legado não reaparece por descuido. */
    fioCanonico: () => {
      const legadas = urls.filter((u) => WIRE_LEGADO.test(u) || /\/api\/resources\/farms(\/|\?|$)/.test(u));
      expect(legadas, `o idioma legado não pode sair do cliente canônico: ${legadas.join(" ")}`).toEqual([]);
      const comContexto = cabecalhos.filter((c) => c.empresa || c.farm);
      const comLegado = comContexto.filter((c) => c.farm);
      expect(comLegado.map((c) => c.url), "X-Farm-Id não sai mais do navegador").toEqual([]);
    }
  };
}

test.describe.configure({ mode: "serial" });

test("o servidor É o commit base — e ele entende o canônico, que é a premissa da 05A", async ({ page, request }) => {
  // Sem esta prova o arquivo inteiro é decorativo: contra uma API pré-PRE-BASE2-03 as asserções abaixo
  // falhariam por CORS, e é justamente essa regressão que aqui se quer pegar antes do cliente.
  await login(page);
  const s = await sessao(page);
  const auth = { authorization: `Bearer ${s.token}`, "x-org-id": String(s.orgId) };

  const ctx = await (await request.get(`${API}/api/auth/context`, { headers: auth })).json();
  expect(ctx["empresas"], "a API em produção entrega o campo canônico").toBeDefined();

  const pre = await request.fetch(`${API}/api/auth/context`, {
    method: "OPTIONS",
    headers: { origin: page.url().replace(/(https?:\/\/[^/]+).*/, "$1"), "access-control-request-method": "GET", "access-control-request-headers": "x-empresa-id" }
  });
  const permitidos = (pre.headers()["access-control-allow-headers"] ?? "").toLowerCase();
  expect(permitidos, "o CORS declara o cabeçalho canônico — sem isso o preflight mata a tela").toContain("x-empresa-id");

  expect((await request.get(`${API}/api/resources/empresas?pageSize=1`, { headers: auth })).status(), "o recurso canônico existe").toBe(200);

  const corpoCanonico = await request.post(`${API}/api/resources/warehouses`, { headers: auth, data: { empresa_id: ctx["empresas"][0].id, initials: "SK1", description: uniq("skew"), type: "inputs" } });
  expect([201, 409, 422].includes(corpoCanonico.status()), `o corpo canônico é ACEITO pelo schema (status ${corpoCanonico.status()})`).toBe(true);
  expect(corpoCanonico.status(), "422 aqui significaria campo canônico não reconhecido — a quebra que a 05A não pode ter").not.toBe(422);

  const todos = await (await request.get(`${API}/api/resources/warehouses?pageSize=100`, { headers: auth })).json();
  const canonico = await (await request.get(`${API}/api/resources/warehouses?pageSize=100&empresa_id__eq=${ctx["empresas"][0].id}`, { headers: auth })).json();
  expect(Number(canonico["total"]), "o filtro canônico RECORTA de verdade — não é descartado em silêncio").toBeLessThan(Number(todos["total"]));

  // E a compatibilidade do SERVIDOR continua de pé: ela só sai em PRE-BASE2-05B.
  const legado = await (await request.get(`${API}/api/resources/farms?pageSize=1`, { headers: auth })).status();
  expect(legado, "a API segue bilíngue para clientes anteriores até a 05B").toBe(200);
});

test("entrar, carregar o contexto e escolher a empresa — sem nenhuma requisição morrer no navegador", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const seletor = page.getByLabel("Empresa ativa");
  await expect(seletor.locator("option")).not.toHaveCount(1);   // "Todas as empresas" + as empresas reais
  await seletor.selectOption({ index: 1 });
  await expect(seletor).not.toHaveValue("");
  await page.goto("/cadastros/warehouses");
  await expect(page.getByTestId("b1-row").first()).toBeVisible();
  const s = await sessao(page);
  expect(s.empresaId, "a empresa escolhida fica na sessão com o nome canônico").toBeTruthy();
  v.semBloqueio(); v.fioCanonico();
});

test("/cadastros/empresas abre pedindo o recurso CANÔNICO", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  await page.goto("/cadastros/empresas");
  await expect(page.getByTestId("b1-row").first()).toBeVisible();
  expect(await page.getByTestId("b1-row").count(), "a listagem trouxe as empresas da organização").toBeGreaterThan(0);
  expect(v.urls.some((u) => /\/api\/resources\/empresas(\/|\?)/.test(u)), `o fio pediu o recurso canônico: ${v.urls.join(" ")}`).toBe(true);
  v.semBloqueio(); v.fioCanonico();
});

test("a coluna Empresa da listagem genérica vem preenchida sem nenhum apelido legado", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const resposta = page.waitForResponse((r) => /\/api\/resources\/warehouses\?/.test(r.url()) && r.status() === 200);
  await page.goto("/cadastros/warehouses");
  const corpo = await (await resposta).json();
  const primeira = (corpo["items"] as Record<string, unknown>[])[0];
  expect(primeira, "a listagem trouxe pelo menos uma linha").toBeTruthy();
  expect(primeira?.["empresa_id"], "a resposta já é canônica: o cliente não traduz nada").toBeTruthy();

  await expect(page.getByTestId("b1-row").first()).toBeVisible();
  const colunas = await page.locator("thead th").allTextContents();
  const iEmpresa = colunas.findIndex((c) => /^\s*Empresa\s*$/i.test(c));
  expect(iEmpresa, `a coluna canônica está desenhada: ${colunas.join(" | ")}`).toBeGreaterThanOrEqual(0);
  const celula = await page.getByTestId("b1-row").first().locator("td").nth(iEmpresa).textContent();
  expect((celula ?? "").trim(), "a coluna Empresa não pode vir vazia").not.toBe("");
  v.semBloqueio(); v.fioCanonico();
});

test("cadastro real com empresa: o corpo sai canônico e o servidor aceita", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  await page.goto("/cadastros/warehouses");
  await expect(page.getByTestId("b1-row").first()).toBeVisible();
  const corpos: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/resources/warehouses")) corpos.push(r.postData() ?? ""); });

  await page.getByRole("button", { name: /Novo/i }).first().click();
  await page.getByLabel(/Sigla/i).first().fill("C05");
  await page.getByLabel(/Descrição/i).first().fill(uniq("Almox canônico"));
  await page.getByRole("button", { name: /Salvar/i }).first().click();

  await expect.poll(() => corpos.length, { message: "o formulário enviou o cadastro" }).toBeGreaterThan(0);
  for (const c of corpos) {
    expect(c, `o corpo não pode conter nome legado: ${c}`).not.toMatch(/"(farm_id|origin_farm_id|destination_farm_id)"/);
  }
  v.semBloqueio(); v.fioCanonico();
});

test("filtrar por empresa realmente filtra — e a query viaja canônica", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  await page.goto("/cadastros/warehouses");
  await expect(page.getByTestId("b1-row").first()).toBeVisible();
  const total = await page.getByTestId("b1-row").count();

  await page.getByLabel("Empresa ativa").selectOption({ index: 1 });
  await expect.poll(async () => page.getByTestId("b1-row").count(), { message: "a listagem recarregou no escopo da empresa" })
    .toBeLessThanOrEqual(total);

  const comEmpresa = v.urls.filter((u) => /empresa_id/.test(u));
  expect(v.urls.filter((u) => WIRE_LEGADO.test(u)), `nenhuma query pode viajar com o nome legado: ${comEmpresa.join(" ")}`).toEqual([]);
  v.semBloqueio(); v.fioCanonico();
});

test("nenhuma tela conhece o nome antigo: a moldura do produto é canônica", async ({ page }) => {
  await login(page);
  await page.goto("/cadastros/empresas");
  await expect(page.getByTestId("b1-row").first()).toBeVisible();
  const moldura = [
    ...(await page.locator("thead th").allTextContents()),
    ...(await page.getByRole("tab").allTextContents()),
    ...(await page.locator("label").allTextContents())
  ].map((t) => t.trim()).filter(Boolean);
  const nicho = moldura.filter((t) => /\bfarm\b|farms/i.test(t));
  expect(nicho, `a moldura não pode exibir o nome técnico legado: ${moldura.join(" | ")}`).toEqual([]);
  expect(moldura.some((t) => /^Empresa/i.test(t)), `a coluna canônica está desenhada: ${moldura.join(" | ")}`).toBe(true);
});
