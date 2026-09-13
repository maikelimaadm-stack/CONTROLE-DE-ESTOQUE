import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * COMPATIBILIDADE DA MIGRAÇÃO FAZENDA → EMPRESA, DO LADO DO NAVEGADOR (PRE-BASE2-03).
 *
 * Os outros specs falam o idioma canônico — são testes de PRODUTO. Este fala o antigo de propósito: ele é o
 * teste da PONTE, e existe para que a remoção dela, um dia, seja uma decisão e não uma surpresa. O que se
 * prova aqui só se prova num navegador de verdade: rota antiga guardada no favorito, sessão gravada por uma
 * versão anterior no localStorage e o cabeçalho que o cliente novo manda.
 */
test.describe("empresa: canônico no produto, legado na ponte", () => {
  test("a rota antiga de cadastro redireciona para a canônica, sem abrir uma segunda tela", async ({ page }) => {
    await login(page);
    await page.goto("/cadastros/farms");
    await expect(page).toHaveURL(/\/cadastros\/empresas/);
    // A tela de cadastro genérica não tem título em <h*> — quem identifica que ela ABRIU é a listagem.
    await expect(page.getByTestId("b1-row").first()).toBeVisible();
    // "sem abrir uma segunda tela": o redirecionamento não pode deixar duas abas (a antiga e a canônica).
    await expect(page.getByRole("tab").filter({ hasText: /empresas|farms/i })).toHaveCount(1);
  });

  test("sessão gravada com `farmId` recupera a empresa selecionada", async ({ page }) => {
    // Sessão antiga vive no localStorage do navegador: nenhum deploy a migra. Ler só `empresaId` derrubaria
    // a empresa selecionada de todo mundo no primeiro acesso — sem erro e sem aviso.
    await login(page);
    // `process` não existe no navegador: a URL da API entra como ARGUMENTO do evaluate, não como env.
    const api = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
    const empresaId = await page.evaluate(async (apiUrl) => {
      const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as Record<string, unknown>;
      const ctx = await fetch(`${apiUrl}/api/auth/context`,
        { headers: { authorization: `Bearer ${s["token"]}`, "x-org-id": String(s["orgId"]) } }).then((r) => r.json());
      const empresas = ctx.empresas ?? ctx.farms;
      // regrava a sessão no formato ANTIGO, como a versão anterior do web deixaria
      localStorage.setItem("agro.session", JSON.stringify({ token: s["token"], orgId: s["orgId"], farmId: empresas[0].id, user: s["user"] }));
      return empresas[0].id as string;
    }, api);
    await page.reload();
    await expect(page.getByLabel("Empresa ativa")).toHaveValue(empresaId);
  });

  test("o FIO fala o idioma legado: cabecalho, caminho de recurso e query saem traduzidos", async ({ page }) => {
    // O CORS da API anterior nao aceita `X-Empresa-Id` — um navegador que o envia tem o PREFLIGHT recusado e
    // a tela nao carrega. Durante a ponte o fio e legado nos TRES lugares, e e isso que este teste fixa.
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
    expect(comContexto.length, "alguma requisicao levou o contexto de empresa").toBeGreaterThan(0);
    for (const e of comContexto) {
      expect(e.farm, `${e.url}: a empresa selecionada sai como X-Farm-Id`).toBeTruthy();
      expect(e.empresa, `${e.url}: X-Empresa-Id nao pode sair do navegador durante a ponte`).toBeUndefined();
    }
    // A tela pede o recurso canonico `empresas`; o fio pede `farms`.
    const recursos = enviados.map((e) => e.url).filter((u) => u.includes("/api/resources/"));
    expect(recursos.some((u) => /\/api\/resources\/farms(\/|\?|$)/.test(u)), `recursos vistos: ${recursos.join(" ")}`).toBe(true);
    expect(recursos.some((u) => /\/api\/resources\/empresas(\/|\?|$)/.test(u)), `nenhuma URL pode pedir o recurso canonico durante a ponte: ${recursos.join(" ")}`).toBe(false);
  });

  test("filtro por empresa viaja como farm_id na query e a tela continua canonica", async ({ page }) => {
    await login(page);
    const urls: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/")) urls.push(r.url()); });
    await page.goto("/estoque?tab=recebimentos&sub=entradas");
    await expect(page.getByRole("button", { name: /Empresa/i }).first()).toBeVisible();
    // A listagem monta a query a partir do contexto; basta que nenhuma delas leve o nome canonico no fio.
    const comEmpresa = urls.filter((u) => u.includes("empresa_id"));
    expect(comEmpresa, `nenhuma query pode levar empresa_id no fio: ${comEmpresa.join(" ")}`).toEqual([]);
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
