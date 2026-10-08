import { test, expect, type Locator, type Page } from "@playwright/test";
import { api, login, uniq } from "./helpers";

/**
 * PR #115 — contagens (10 áreas × 3 recortes = 30 análises) e recuperação de estimativa.
 * Corrida A/B com erro obsoleto (rede que ignora abort) está nos unitários `previa-tentativa.test.ts`.
 * Rede 100% controlada — sem Copernicus.
 */
test.use({
  launchOptions: {
    ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}),
    args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"]
  }
});

type Area = { id: string; name: string };

async function limparAreas(page: Page) {
  const lista = await api<{ items: { id: string }[] }>(page, "GET", "/api/resources/areas?pageSize=500");
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
  for (const a of lista.items ?? []) {
    await page.evaluate(async ({ id, base }) => {
      const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string | null; empresaId: string | null };
      const res = await fetch(`${base}/api/resources/areas/${id}`, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${s.token}`,
          ...(s.orgId ? { "x-org-id": s.orgId } : {}),
          ...(s.empresaId ? { "x-empresa-id": s.empresaId } : {})
        }
      });
      if (!res.ok) throw new Error(`DELETE areas ${id}: ${res.status}`);
    }, { id: a.id, base });
  }
}

async function empresaDaSessao(page: Page): Promise<string> {
  const daSessao = await page.evaluate(() => (JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { empresaId?: string | null }).empresaId ?? null);
  if (daSessao) return daSessao;
  const ctx = await api<{ empresas?: { id: string }[] }>(page, "GET", "/api/auth/context");
  return ctx.empresas![0]!.id;
}

async function digitarData(campo: Locator, ddmmaaaa: string) {
  const visivel = campo.locator('input[type="text"]');
  await visivel.fill(ddmmaaaa);
  await visivel.press("Enter");
}

test("Mapa geral: resumo 10×3 = 30 análises; erro vigente + retry; troca de período mantém B", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await limparAreas(page);
  const empresa = await empresaDaSessao(page);

  for (let i = 0; i < 10; i++) {
    const lng = -55.2 + i * 0.02;
    await api<Area>(page, "POST", "/api/resources/areas", {
      empresa_id: empresa,
      name: uniq(`CNT ${i}`).toLocaleUpperCase("pt-BR"),
      land_use: "pastagem",
      status: "ativa",
      tenure: "propria",
      area_ha: "10",
      usable_area_ha: "10",
      color: "#16a34a",
      geometria: {
        type: "Polygon",
        coordinates: [[[lng, -15.2], [lng + 0.01, -15.2], [lng + 0.01, -15.19], [lng, -15.19], [lng, -15.2]]]
      }
    });
  }

  type Corpo = { periodo: { tipo: string; data?: string; de?: string; ate?: string }; confirmar: boolean };
  let falhasIntervaloRestantes = 1;

  const cors = { "Access-Control-Allow-Origin": "*" };
  const json = (corpo: unknown, status = 200) => ({
    status, contentType: "application/json", headers: cors, body: JSON.stringify(corpo)
  });

  await page.route(/\/api\/satelite\/consultas(\?|$)/, async (rota) => {
    if (rota.request().method() !== "POST") return rota.continue();
    const corpo = rota.request().postDataJSON() as Corpo;
    if (corpo.confirmar) {
      await rota.fulfill(json({
        consulta: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          situacao: "pendente",
          total_itens: 30,
          total_concluidos: 12,
          total_falhos: 2,
          total_reaproveitados: 0,
          criado_em: "2026-10-08T12:00:00.000Z",
          concluida_em: null
        },
        total_itens: 30, reaproveitados: 0, novos: 30, areas_ignoradas: []
      }, 201));
      return;
    }
    if (corpo.periodo?.tipo === "intervalo") {
      if (falhasIntervaloRestantes > 0) {
        falhasIntervaloRestantes -= 1;
        await rota.fulfill(json({ error: "estimativa temporária" }, 503));
        return;
      }
      await rota.fulfill(json({
        total_itens: 30,
        reaproveitados: 5,
        novos: 25,
        estimativa_creditos: { minimo: "1.00", maximo: "3.00" },
        saldo_creditos_mes: "50.00",
        excede_orcamento: false,
        empresa_id: empresa,
        areas_ignoradas: []
      }));
      return;
    }
    if (corpo.periodo?.tipo === "data") {
      await rota.fulfill(json({
        total_itens: 10, reaproveitados: 0, novos: 10,
        estimativa_creditos: { minimo: "0.20", maximo: "0.40" },
        saldo_creditos_mes: "50.00", excede_orcamento: false,
        empresa_id: empresa, areas_ignoradas: []
      }));
      return;
    }
    await rota.fulfill(json({
      total_itens: 10, reaproveitados: 0, novos: 10,
      estimativa_creditos: { minimo: "0.10", maximo: "0.30" },
      saldo_creditos_mes: "50.00", excede_orcamento: false,
      empresa_id: empresa, areas_ignoradas: []
    }));
  });

  await page.route(/\/api\/satelite\/consultas\/[^/?]+/, async (rota) => {
    if (rota.request().method() !== "GET") return rota.continue();
    await rota.fulfill(json({
      consulta: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        situacao: "executando",
        total_itens: 30,
        total_concluidos: 12,
        total_falhos: 2,
        total_reaproveitados: 0,
        criado_em: "2026-10-08T12:00:00.000Z",
        concluida_em: null
      },
      itens: [], pagina: 1, tamanho: 1, tem_mais: false
    }));
  });

  await page.goto("/mapa-geral");
  await expect(page.getByTestId("mapa-item-area")).toHaveCount(10, { timeout: 30_000 });
  await page.getByTestId("mapa-nova-consulta").click();
  const modal = page.getByTestId("consulta-modal");
  await expect(modal).toBeVisible();

  if (await modal.getByTestId("consulta-periodo-tipo").count() === 0) {
    await modal.getByTestId("consulta-opcoes-avancadas-toggle").click();
  }

  // Período A (uma data) → estimativa de 10 análises
  await modal.getByTestId("consulta-periodo-tipo").selectOption("data");
  await digitarData(modal.getByTestId("consulta-data"), "10/09/2026");
  await expect(modal.getByTestId("consulta-previa-creditos")).toContainText("0,20–0,40", { timeout: 10_000 });

  // Período B (intervalo 3 meses) — primeira prévia falha (erro vigente)
  await modal.getByTestId("consulta-periodo-tipo").selectOption("intervalo");
  await digitarData(modal.getByTestId("consulta-de"), "01/07/2026");
  await digitarData(modal.getByTestId("consulta-ate"), "30/09/2026");
  await expect(modal.getByTestId("consulta-erro")).toBeVisible({ timeout: 10_000 });
  await expect(modal.getByTestId("consulta-confirmar")).toBeDisabled();

  // Retry da tentativa vigente recupera
  await modal.getByTestId("consulta-previa-retry").click();
  await expect(modal.getByTestId("consulta-previa-creditos")).toContainText("1,00–3,00", { timeout: 10_000 });
  await expect(modal.getByTestId("consulta-erro")).toHaveCount(0);

  const resumo = modal.getByTestId("consulta-linha-resumo");
  await expect(resumo).toContainText("10 áreas");
  await expect(resumo).toContainText("3 períodos");
  await expect(resumo).toContainText("30 análises");
  await expect(resumo).not.toContainText("30 áreas");
  await expect(modal.getByTestId("consulta-confirmar")).toBeEnabled();

  // Confirma e confere progresso em "análises", não "áreas"
  await modal.getByTestId("consulta-confirmar").click();
  await expect(modal.getByTestId("consulta-progresso")).toBeVisible();
  await expect(modal.getByTestId("consulta-progresso-pastos")).toContainText("análises processadas");
  await expect(modal.getByTestId("consulta-progresso-pastos")).toContainText("14 de 30");
  await expect(modal.getByTestId("consulta-progresso-pastos")).not.toContainText("14 de 30 áreas");

  await limparAreas(page);
});
