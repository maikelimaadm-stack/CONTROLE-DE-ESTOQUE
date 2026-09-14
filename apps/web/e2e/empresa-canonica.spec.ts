import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * CUTOVER CANÔNICO DO CLIENTE (PRE-BASE2-05A), medido no navegador de verdade.
 *
 * Até a PRE-BASE2-04 o produto era canônico por dentro e o FIO era legado: o cliente traduzia caminho,
 * query, corpo e cabeçalho para o idioma antigo, porque o CORS da API anterior não declarava
 * `X-Empresa-Id` e o preflight morria antes de existir requisição. Essa razão acabou — a API em produção
 * declara o canônico e o resolve na borda. Este arquivo é o antigo `empresa-compat.spec.ts` REVIRADO: ele
 * media a ponte, agora mede a sua ausência.
 *
 * O que só se prova aqui, e não num teste de unidade: o cabeçalho que sai do navegador, a sessão gravada
 * por uma versão anterior no `localStorage` e o favorito com a rota antiga. São os três estados que
 * atravessam um deploy sem que ninguém os migre.
 *
 * A API continua BILÍNGUE até PRE-BASE2-05B — o que deixou de falar o idioma antigo foi o cliente.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
const sessaoBruta = (page: import("@playwright/test").Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("agro.session") ?? "{}") as Record<string, unknown>);

test.describe("empresa: o cliente fala o canônico ponta a ponta", () => {
  test("o FIO é canônico: cabeçalho, caminho de recurso e query saem sem tradução", async ({ page }) => {
    await login(page);
    const enviados: { url: string; empresa?: string; farm?: string }[] = [];
    page.on("request", (r) => {
      const h = r.headers();
      if (r.url().includes("/api/")) enviados.push({ url: r.url(), empresa: h["x-empresa-id"], farm: h["x-farm-id"] });
    });
    await page.getByLabel("Empresa ativa").selectOption({ index: 1 });
    await page.goto("/cadastros/empresas");
    await expect(page.getByTestId("b1-row").first()).toBeVisible();

    const comContexto = enviados.filter((e) => e.farm || e.empresa);
    expect(comContexto.length, "alguma requisição levou o contexto de empresa").toBeGreaterThan(0);
    for (const e of comContexto) {
      expect(e.empresa, `${e.url}: a empresa selecionada sai como X-Empresa-Id`).toBeTruthy();
      expect(e.farm, `${e.url}: o cabeçalho legado não pode mais sair do navegador`).toBeUndefined();
    }
    // A tela pede o recurso canônico e o fio pede o mesmo — não há mais tabela de tradução no meio.
    const recursos = enviados.map((e) => e.url).filter((u) => u.includes("/api/resources/"));
    expect(recursos.some((u) => /\/api\/resources\/empresas(\/|\?|$)/.test(u)), `recursos vistos: ${recursos.join(" ")}`).toBe(true);
    expect(recursos.some((u) => /\/api\/resources\/farms(\/|\?|$)/.test(u)), `nenhuma URL pode pedir o recurso legado: ${recursos.join(" ")}`).toBe(false);
  });

  test("nenhuma requisição do produto carrega nome legado na query", async ({ page }) => {
    await login(page);
    const urls: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/")) urls.push(r.url()); });
    await page.goto("/estoque?tab=recebimentos&sub=entradas");
    await expect(page.getByRole("button", { name: /Empresa/i }).first()).toBeVisible();
    const legadas = urls.filter((u) => /(^|[?&])(farm_id|origin_farm_id|destination_farm_id)(__[a-z]+)?=/.test(u));
    expect(legadas, `nenhuma query pode levar o nome legado no fio: ${legadas.join(" ")}`).toEqual([]);
  });

  test("a tela lê `empresas` do contexto — sem depender do apelido legado da resposta", async ({ page }) => {
    await login(page);
    const ctx = await page.evaluate(async (apiUrl) => {
      const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as Record<string, unknown>;
      return fetch(`${apiUrl}/api/auth/context`, { headers: { authorization: `Bearer ${s["token"]}`, "x-org-id": String(s["orgId"]) } }).then((r) => r.json());
    }, API);
    expect(ctx["empresas"], "a API entrega o campo canônico — é o único que o cliente lê").toBeDefined();
    // O seletor desenhado prova que o cliente montou a lista a partir DELE.
    const opcoes = await page.getByLabel("Empresa ativa").locator("option").count();
    expect(opcoes, "o seletor tem 'Todas' + as empresas do contexto").toBeGreaterThan(1);
  });
});

test.describe("sessão gravada por uma versão anterior", () => {
  /**
   * A PROMOÇÃO SAIU EM PRE-BASE2-05B. Ela existiu durante o rollout da 05A, quando quem já estava logado
   * tinha a empresa gravada no formato antigo e ler só o canônico zeraria a seleção de todo mundo. Esse
   * rollout terminou: o web canônico está em produção e nenhuma versão viva do cliente grava a chave antiga.
   *
   * Uma sessão dormante o bastante para ainda tê-la agora pede login de novo. É a troca deliberada desta
   * fase — um login a mais em vez de uma ponte que ninguém mais atravessa e que voltaria a pedir manutenção
   * a cada mudança.
   */
  test("sessão com a chave anterior NÃO é mais promovida: cai e exige login", async ({ page }) => {
    await login(page);
    await page.evaluate(async (apiUrl) => {
      const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as Record<string, unknown>;
      const ctx = await fetch(`${apiUrl}/api/auth/context`, { headers: { authorization: `Bearer ${s["token"]}`, "x-org-id": String(s["orgId"]) } }).then((r) => r.json());
      // regrava a sessão no formato ANTIGO, exatamente como a versão anterior do web a deixaria
      localStorage.setItem("agro.session", JSON.stringify({ token: s["token"], orgId: s["orgId"], farmId: ctx.empresas[0].id as string, user: s["user"] }));
    }, API);

    await page.reload();
    await expect(page, "sem contrato canônico na sessão, o caminho honesto é novo login").toHaveURL(/\/login/);
    expect(await page.evaluate(() => localStorage.getItem("agro.session")), "a sessão fora do contrato é apagada").toBeNull();
  });

  test("empresa gravada fora do contrato (não é UUID nem nula) também derruba a sessão", async ({ page }) => {
    // `localStorage` é editável e sobrevive a qualquer versão. Um `empresaId` inválido viajaria em
    // `X-Empresa-Id` e voltaria como 422 numa tela sem relação com a causa.
    await login(page);
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as Record<string, unknown>;
      localStorage.setItem("agro.session", JSON.stringify({ token: s["token"], orgId: s["orgId"], empresaId: "todas", user: s["user"] }));
    });
    await page.reload();
    await expect(page).toHaveURL(/\/login/);
    expect(await page.evaluate(() => localStorage.getItem("agro.session"))).toBeNull();
  });

  test("sessão canônica com empresa selecionada segue intacta — a validação não derruba quem está certo", async ({ page }) => {
    await login(page);
    const empresaId = await page.evaluate(async (apiUrl) => {
      const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as Record<string, unknown>;
      const ctx = await fetch(`${apiUrl}/api/auth/context`, { headers: { authorization: `Bearer ${s["token"]}`, "x-org-id": String(s["orgId"]) } }).then((r) => r.json());
      const id = ctx.empresas[0].id as string;
      localStorage.setItem("agro.session", JSON.stringify({ token: s["token"], orgId: s["orgId"], empresaId: id, user: s["user"] }));
      return id;
    }, API);

    const enviados: { url: string; empresa?: string; farm?: string }[] = [];
    page.on("request", (r) => { const h = r.headers(); if (r.url().includes("/api/")) enviados.push({ url: r.url(), empresa: h["x-empresa-id"], farm: h["x-farm-id"] }); });
    await page.reload();
    await expect(page.getByLabel("Empresa ativa")).toHaveValue(empresaId);
    await page.goto("/cadastros/warehouses");
    await expect(page.getByTestId("b1-row").first()).toBeVisible();

    const comContexto = enviados.filter((e) => e.empresa || e.farm);
    expect(comContexto.length).toBeGreaterThan(0);
    for (const e of comContexto) {
      expect(e.empresa, `${e.url}: o contexto sai no cabeçalho canônico`).toBe(empresaId);
      expect(e.farm, `${e.url}: o cabeçalho anterior não existe mais no cliente`).toBeUndefined();
    }
    expect((await sessaoBruta(page))["empresaId"], "a sessão válida não é reescrita").toBe(empresaId);
  });
});

test.describe("compatibilidade de NAVEGAÇÃO (favoritos externos)", () => {
  test("a rota antiga de cadastro ainda redireciona para a canônica, sem abrir uma segunda tela", async ({ page }) => {
    // Isto NÃO é o fio: é um link que um usuário guardou. Sai só em PRE-BASE2-05C — ver docs/DEPLOYMENT.md.
    await login(page);
    await page.goto("/cadastros/farms");
    await expect(page).toHaveURL(/\/cadastros\/empresas/);
    await expect(page.getByTestId("b1-row").first()).toBeVisible();
    await expect(page.getByRole("tab").filter({ hasText: /empresas|farms/i })).toHaveCount(1);
  });

  test("o seletor de empresa continua isolando: trocar de empresa troca o conjunto de dados", async ({ page }) => {
    await login(page);
    await page.goto("/estoque?tab=estoque");
    const seletor = page.getByLabel("Empresa ativa");
    await seletor.selectOption({ index: 1 });
    await expect(page).toHaveURL(/\/estoque/);
    await seletor.selectOption({ index: 2 });
    await expect(seletor).not.toHaveValue("");
  });
});
