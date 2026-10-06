import { test, expect, type Response } from "@playwright/test";
import { api, login, uniq } from "./helpers";
import { chamarApi } from "./top-config-08-comum";
import { MSG_ROTA_NAO_ENCONTRADA, vigiar, type Mundo } from "./operacoes-01-f2-skew-comum";

/**
 * MAPA-GERAL (decisão 294 / 301 R2) · K-1, SENTIDO 1 — O WEB DESTE HEAD CONTRA A API DA BASE (a janela "web antes da API" da
 * DEPLOYMENT).
 *
 * O nome termina em `skew-api-producao.spec.ts`: roda SÓ em `playwright.skew.config.ts` e o `playwright.config.ts`
 * comum o ignora — lá a API seria a deste HEAD e o caso ficaria verde por vacuidade.
 *
 * O QUE SE MEDE. O Mapa geral deste HEAD pergunta `GET /api/mapa/analises-satelitais/resumo` (com `contexto=condicao`
 * quando a API entende) para pintar a condição. A base sem a rota responde a 404 de ROTA, e o mapa tem de continuar
 * sendo o de antes: as áreas listadas e no mapa, na cor do cadastro, SEM legenda de NDVI, SEM seletor de cor satélite,
 * com um aviso discreto — e nenhum erro na tela. Se a base tem o resumo mas ainda não aceita `contexto` (422), o web
 * cai no contrato anterior sem quebrar a tela.
 *
 * O MUNDO É PERGUNTADO À BASE NA HORA: a 404 de rota → legado (a base de hoje); 200 → novo (a base já com o resumo).
 * Qualquer outra resposta é defeito. Os dois ramos cobram prova POSITIVA: no legado, o pedido da tela SAIU e voltou
 * 404 de rota, e o aviso aparece; no novo, algum pedido do resumo voltou 200 e o aviso não aparece.
 */

const caminho = (r: Response) => new URL(r.url()).pathname;
const PORTA = "/api/mapa/analises-satelitais/resumo";

test("MAPA-GERAL K-1 — web deste HEAD × API da base: o Mapa geral abre; legado = áreas na cor do cadastro e aviso (404 de rota), novo = resumo 200", async ({ page }) => {
  const vigia = vigiar(page);
  await login(page);
  const ctx = await api<{ empresas?: { id: string }[] }>(page, "GET", "/api/auth/context");
  const empresa = ctx.empresas?.[0]?.id;
  expect(empresa, "premissa: há empresa visível").toBeTruthy();
  const nome = uniq("SKEW MAPA GERAL").toLocaleUpperCase("pt-BR");
  const area = await api<{ id: string }>(page, "POST", "/api/resources/areas", {
    empresa_id: empresa, name: nome, land_use: "pastagem", status: "ativa", tenure: "propria", area_ha: "50", usable_area_ha: "50", color: "#2563eb",
    geometria: { type: "Polygon", coordinates: [[[-54.9, -15.3], [-54.89, -15.3], [-54.89, -15.29], [-54.9, -15.29], [-54.9, -15.3]]] }
  });
  try {
    // O MUNDO, perguntado à base (sonda sem `contexto`: a base pré-R2 já pode ter o resumo).
    const sonda = await chamarApi<{ itens?: unknown[]; error?: { code?: string; message?: string } }>(page, "GET", PORTA);
    let mundo: Mundo;
    if (sonda.status === 404) {
      expect([sonda.corpo.error?.code, sonda.corpo.error?.message], "a 404 da base é a de ROTA (outra 404 é defeito)").toEqual(["NOT_FOUND", MSG_ROTA_NAO_ENCONTRADA]);
      mundo = "legado";
    } else {
      expect(sonda.status, "a base com a fatia responde o resumo").toBe(200);
      expect(Array.isArray(sonda.corpo.itens)).toBe(true);
      mundo = "novo";
    }
    console.log(`[skew] MAPA-GERAL · K-1 · a base responde ${sonda.status} a GET ${PORTA} → mundo ${mundo}`);

    // O MAPA GERAL deste HEAD: o pedido do resumo SAI (pode haver 422 de `contexto` e um retry sem ele).
    const pedido = page.waitForResponse((r) =>
      r.request().method() === "GET" && caminho(r) === PORTA && (r.status() === 200 || r.status() === 404)
    );
    await page.goto("/mapa-geral");
    const resposta = await pedido;
    await expect(page.getByRole("heading", { name: "Mapa geral" })).toBeVisible();
    await expect(page.getByTestId("mapa-item-area").filter({ hasText: nome }), "as áreas continuam listadas").toBeVisible();
    await expect(page.getByTestId("mapa-ndvi-erro"), "nenhum erro na tela").toHaveCount(0);
    await page.getByTestId("mapa-item-area").filter({ hasText: nome }).click();
    const painel = page.getByTestId("mapa-area-selecionada");
    await expect(painel).toContainText(nome);
    if (mundo === "legado") {
      expect(resposta.status(), "a tela perguntou, e a base respondeu a 404 de rota").toBe(404);
      await expect(page.getByTestId("mapa-ndvi-indisponivel")).toHaveText("Análise por satélite ainda não disponível neste servidor.");
      await expect(page.getByTestId("mapa-legenda-ndvi"), "sem a rota, sem legenda").toHaveCount(0);
      await expect(page.getByTestId("mapa-cor-area"), "sem a rota, sem o seletor de cor do NDVI").toHaveCount(0);
      await expect(page.getByTestId("mapa-cor-pixel")).toHaveCount(0);
      // R2: painel único CondicaoDaArea — sem a rota do resumo global, o NDVI/condição operacional não pinta nem oferece analisar pelo contrato antigo.
      await expect(painel.getByTestId("mapa-ndvi-area"), "painel legado NDVI não entra no Mapa geral").toHaveCount(0);
    } else {
      expect(resposta.status()).toBe(200);
      await expect(page.getByTestId("mapa-ndvi-indisponivel")).toHaveCount(0);
      // Painel analítico único (R2): Condição da Área — ou some em silêncio se a rota /satelite/.../resumo ainda não existir na base.
      await expect(painel.getByTestId("mapa-ndvi-area")).toHaveCount(0);
    }
    await expect(painel.getByTestId("mapa-abrir-cadastro")).toHaveAttribute("href", `/cadastros/areas/${area.id}`);
    vigia.semBloqueio();
  } finally {
    // DELETE sem corpo e sem content-type (corpo vazio com JSON é recusado), como na limpeza do spec do mapa.
    const base = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
    const status = await page.evaluate(async ({ id, base }) => {
      const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string | null; empresaId: string | null };
      const res = await fetch(`${base}/api/resources/areas/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}), ...(s.empresaId ? { "x-empresa-id": s.empresaId } : {}) } });
      return res.status;
    }, { id: area.id, base });
    expect([200, 204], "a área do teste sai (exclusão lógica)").toContain(status);
  }
});
