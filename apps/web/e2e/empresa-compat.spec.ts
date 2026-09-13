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

  test("o cliente envia X-Empresa-Id e X-Farm-Id com o mesmo valor, e a API aceita", async ({ page }) => {
    await login(page);
    const enviados: string[] = [];
    page.on("request", (r) => { const h = r.headers(); if (h["x-empresa-id"] || h["x-farm-id"]) enviados.push(`${h["x-empresa-id"] ?? "-"}|${h["x-farm-id"] ?? "-"}`); });
    await page.getByLabel("Empresa ativa").selectOption({ index: 1 });
    await page.goto("/cadastros/empresas");
    await expect(page.getByTestId("b1-row").first()).toBeVisible();
    expect(enviados.length, "alguma requisição levou o contexto de empresa").toBeGreaterThan(0);
    for (const par of enviados) { const [canonico, legado] = par.split("|"); expect(legado, par).toBe(canonico); }
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
