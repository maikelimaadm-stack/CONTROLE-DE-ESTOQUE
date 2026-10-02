import { test, expect, type Page } from "@playwright/test";
import { api, login, uniq } from "./helpers";

/**
 * MAPA-01 — Mapa de Manejo (UX: ímã só ícone a 8 px, sem lateral de desenho, paleta 9 cores).
 */
test.use({ launchOptions: { ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}), args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] } });

async function limparAreas(page: Page) {
  const lista = await api<{ items: { id: string }[] }>(page, "GET", "/api/resources/mapa_areas?pageSize=500");
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
  for (const a of lista.items ?? []) {
    await page.evaluate(async ({ id, base }) => {
      const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string | null; empresaId: string | null };
      const res = await fetch(`${base}/api/resources/mapa_areas/${id}`, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${s.token}`,
          ...(s.orgId ? { "x-org-id": s.orgId } : {}),
          ...(s.empresaId ? { "x-empresa-id": s.empresaId } : {})
        }
      });
      if (!res.ok) throw new Error(`DELETE mapa_areas ${id}: ${res.status}`);
    }, { id: a.id, base });
  }
}

test("o módulo Mapa de Manejo abre e lista as áreas", async ({ page }) => {
  await login(page);
  await limparAreas(page);
  await page.goto("/mapa-de-manejo");
  await expect(page.getByRole("heading", { name: "Mapa de Manejo" })).toBeVisible();
  await expect(page.getByTestId("mapa-nova-area")).toBeVisible();
  await expect(page.getByText("Nenhuma área cadastrada")).toBeVisible();
});

test.describe("editor de desenho do Mapa de Manejo", () => {
  const L = 100;
  type Area = { nome: string; cor: string | null; geometria: { type: string; coordinates: number[][][] } | null };

  async function abrirEditor(page: Page) {
    const nova = page.getByTestId("mapa-nova-area");
    await expect(nova, "o mapa precisa carregar (WebGL) para liberar o desenho").toBeEnabled({ timeout: 30_000 });
    await nova.click();
    await expect(page.getByTestId("mapa-instrucao")).toBeVisible();
    await expect(page.getByTestId("mapa-barra-ima")).toBeVisible();
    const box = await page.getByTestId("mapa-canvas").boundingBox();
    expect(box, "o canvas do mapa precisa estar na tela").not.toBeNull();
    const faixa = (test.info().retry + test.info().repeatEachIndex) * 250;
    const cx = box!.x + box!.width / 2 - 150 + faixa, cy = box!.y + box!.height / 2;
    return (dx: number, dy: number) => ({ x: cx + dx, y: cy + dy });
  }

  test("desenha com as ferramentas do editor, grava, e a segunda área gruda na primeira", async ({ page }) => {
    await login(page);
    await limparAreas(page);
    await page.goto("/mapa-de-manejo");
    const pontos = page.getByTestId("mapa-medida-pontos");
    const acao = page.getByTestId("mapa-acao");
    const confirmar = page.getByTestId("mapa-confirmar");

    const em = await abrirEditor(page);
    const clicar = (dx: number, dy: number, opts?: { button?: "right" }) => { const p = em(dx, dy); return page.mouse.click(p.x, p.y, opts); };

    // ímã fixo (ícone só; 8 px, vértice+aresta); mapa vazio → pontos livres
    await clicar(-L, -L); await clicar(L, -L); await clicar(L, L);
    await expect(pontos).toHaveText("3");
    await expect(page.getByTestId("mapa-lado"), "aberta: um rótulo de medida por lado traçado").toHaveCount(2);
    await expect(page.getByTestId("mapa-medida-area")).not.toHaveText("0,00");
    await expect(confirmar).toHaveText(/Fechar polígono/);

    await page.keyboard.press("Control+z"); await expect(pontos).toHaveText("2");
    await page.keyboard.press("Control+Shift+z"); await expect(pontos).toHaveText("3");
    await page.getByTestId("mapa-desfazer").click(); await expect(pontos).toHaveText("2");
    await page.getByTestId("mapa-refazer").click(); await expect(pontos).toHaveText("3");
    await clicar(0, L + 50, { button: "right" }); await expect(pontos).toHaveText("2");
    await page.keyboard.press("Control+y"); await expect(pontos).toHaveText("3");

    await clicar(-L, L);
    await clicar(-L, -L);
    await expect(acao).toHaveText("Fechado no primeiro ponto");
    await expect(confirmar).toHaveText(/Gravar área/);
    await expect(page.getByTestId("mapa-lado"), "fechada: os 4 lados").toHaveCount(4);

    const meio = em(0, -L);
    await page.mouse.move(meio.x, meio.y); await page.mouse.down(); await page.mouse.move(meio.x, meio.y - 40, { steps: 4 }); await page.mouse.up();
    await expect(acao).toHaveText("Ponto do meio virou vértice");
    await expect(pontos).toHaveText("5");
    const novo = em(0, -L - 40);
    await page.mouse.dblclick(novo.x, novo.y);
    await expect(acao).toHaveText("Ponto 2 apagado");
    await expect(pontos).toHaveText("4");

    const dentro = em(-L / 2, L / 2);
    await page.mouse.move(dentro.x, dentro.y); await page.mouse.down(); await page.mouse.move(dentro.x + 30, dentro.y, { steps: 4 }); await page.mouse.up();
    await expect(acao).toHaveText("Área movida");
    await page.keyboard.press("Control+z");
    await expect(acao).not.toHaveText("Área movida");

    const primeira = uniq("Talhão E2E").toLocaleUpperCase("pt-BR");
    await confirmar.click();
    await expect(page.getByTestId("mapa-form-tamanho"), "o tamanho vem calculado do desenho").not.toHaveValue("");
    await expect(page.getByTestId("mapa-cor-opcao")).toHaveCount(9);
    await expect(page.locator('[data-testid="mapa-cor-opcao"][aria-checked="true"]')).toHaveCount(1);
    await page.getByRole("radio", { name: "Verde claro", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Verde claro", exact: true })).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("mapa-form-nome").fill(primeira);
    await page.getByTestId("mapa-form-salvar").click();
    await expect(page.getByTestId("mapa-instrucao")).toBeHidden();
    await expect(page.getByTestId("mapa-item-area").filter({ hasText: primeira })).toBeVisible();

    // ---------- 2ª área: ímã (tolerância padrão 8 px) ----------
    await abrirEditor(page);
    const perto = em(L + 5, -L - 4);
    await page.mouse.move(perto.x, perto.y);
    await expect(page.getByTestId("mapa-ima-marca")).toHaveAttribute("data-tipo", "vertice");
    await page.mouse.click(perto.x, perto.y);
    await expect(acao).toHaveText(/^Ponto grudou no vértice de /);
    await expect(page.getByTestId("mapa-medida-grudados")).toHaveText("1");

    await clicar(L + 4, 0);
    await expect(acao).toHaveText(/^Ponto grudou na aresta de /);
    await expect(page.getByTestId("mapa-medida-grudados")).toHaveText("2");

    await page.keyboard.down("Alt"); await clicar(L + 6, L + 5); await page.keyboard.up("Alt");
    await expect(acao).toHaveText("Ponto marcado");

    await page.keyboard.down("Shift");
    const longe = em(L + 60, L + 80); await page.mouse.move(longe.x, longe.y);
    await expect(page.getByTestId("mapa-rumo")).toHaveText(/^(0|45|90|135|180|225|270|315)°$/);
    await page.keyboard.up("Shift");

    await page.keyboard.press("Enter");
    await expect(acao).toHaveText("Fechado com Enter");
    const segunda = uniq("Divisa E2E").toLocaleUpperCase("pt-BR");
    await confirmar.click();
    await page.getByTestId("mapa-form-nome").fill(segunda);
    await page.getByTestId("mapa-form-salvar").click();
    await expect(page.getByTestId("mapa-item-area").filter({ hasText: segunda })).toBeVisible();

    const lista = await api<{ items: Area[] }>(page, "GET", "/api/resources/mapa_areas?pageSize=500");
    expect(lista.items.find((a) => a.nome === primeira)?.cor, "a cor escolhida na paleta é a gravada").toBe("#92ca25");
    const gravada = lista.items.find((a) => a.nome === segunda);
    const anel = gravada?.geometria?.coordinates[0] ?? [];
    expect(anel.length, "polígono canônico: 3 pontos + o de fechamento").toBe(4);
    const v = anel[0]!;
    const vizinhas = lista.items.filter((a) => a.nome !== segunda);
    expect(vizinhas.some((a) => (a.geometria?.coordinates[0] ?? []).some((c) => c[0] === v[0] && c[1] === v[1])), "o vértice grudado tem de ser idêntico ao da vizinha").toBe(true);

    // ---------- edição da ficha ----------
    await page.getByTestId("mapa-item-area").filter({ hasText: primeira }).click();
    await expect(page.getByTestId("mapa-ficha-edicao")).toBeVisible();
    const editado = uniq("Talhão Edit").toLocaleUpperCase("pt-BR");
    await page.getByTestId("mapa-edit-nome").fill(editado);
    await page.getByTestId("mapa-edit-cor").getByRole("radio", { name: "Laranja", exact: true }).click();
    await page.getByTestId("mapa-edit-salvar").click();
    await expect(page.getByTestId("mapa-item-area").filter({ hasText: editado })).toBeVisible();
    const apos = await api<{ items: Area[] }>(page, "GET", "/api/resources/mapa_areas?pageSize=500");
    expect(apos.items.find((a) => a.nome === editado)?.cor).toBe("#f5a01b");
  });
});
