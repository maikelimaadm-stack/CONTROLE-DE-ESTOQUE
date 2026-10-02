import { test, expect, type Page } from "@playwright/test";
import { api, login, uniq } from "./helpers";

/**
 * MAPA-01 (decisão 279) — Mapa de Manejo.
 *  1) fumaça: a página do 15º módulo abre, mostra o cabeçalho, o botão "Nova área" e a lista vazia do banco de e2e;
 *  2) editor de desenho — as FUNÇÕES do protótipo aprovado, exercidas no canvas de verdade (WebGL por SwiftShader;
 *     sem chave do Google o mapa usa o fundo liso): marcar pontos, desfazer/refazer (teclado, barra e botão direito),
 *     fechar no primeiro ponto, segurar no meio de um lado, apagar com dois cliques, mover a área e gravar. Depois a
 *     SEGUNDA área: o ímã gruda no vértice e na aresta da primeira, o Alt solta, o Shift trava o rumo em 45°, o Enter
 *     fecha — e o vértice grudado é gravado com a coordenada IDÊNTICA à da vizinha (divisa sem fresta).
 */
// WebGL no Chromium sem GPU: o SwiftShader precisa ser pedido explicitamente (opção de worker: só no topo do arquivo).
test.use({ launchOptions: { ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}), args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] } });

test("o módulo Mapa de Manejo abre e lista as áreas", async ({ page }) => {
  await login(page);
  await page.goto("/mapa-de-manejo");
  await expect(page.getByRole("heading", { name: "Mapa de Manejo" })).toBeVisible();
  await expect(page.getByTestId("mapa-nova-area")).toBeVisible();
  await expect(page.getByText("Nenhuma área cadastrada")).toBeVisible();
});

test.describe("editor de desenho do Mapa de Manejo", () => {
  /** Meia largura, em px a partir do centro do mapa, do quadrado da primeira área. */
  const L = 100;
  type Area = { nome: string; geometria: { type: string; coordinates: number[][][] } | null };

  /**
   * Cada tentativa desenha numa faixa própria do mapa (deslocada 250 px por tentativa): as áreas gravadas por uma
   * tentativa anterior continuam no banco e seriam alvo do ímã nos mesmos pixels.
   */
  async function abrirEditor(page: Page) {
    const nova = page.getByTestId("mapa-nova-area");
    await expect(nova, "o mapa precisa carregar (WebGL) para liberar o desenho").toBeEnabled({ timeout: 30_000 });
    await nova.click();
    await expect(page.getByTestId("mapa-instrucao")).toBeVisible();
    const box = await page.getByTestId("mapa-canvas").boundingBox();
    expect(box, "o canvas do mapa precisa estar na tela").not.toBeNull();
    const faixa = (test.info().retry + test.info().repeatEachIndex) * 250;
    const cx = box!.x + box!.width / 2 - 150 + faixa, cy = box!.y + box!.height / 2;
    return (dx: number, dy: number) => ({ x: cx + dx, y: cy + dy });
  }

  test("desenha com as ferramentas do editor, grava, e a segunda área gruda na primeira", async ({ page }) => {
    await login(page);
    await page.goto("/mapa-de-manejo");
    const pontos = page.getByTestId("mapa-ponto");
    const acao = page.getByTestId("mapa-acao");
    const confirmar = page.getByTestId("mapa-confirmar");

    // ---------- 1ª área (ímã desligado: numa nova tentativa, a área da anterior está nos mesmos pixels) ----------
    const em = await abrirEditor(page);
    const clicar = (dx: number, dy: number, opts?: { button?: "right" }) => { const p = em(dx, dy); return page.mouse.click(p.x, p.y, opts); };
    const botaoIma = page.getByRole("button", { name: "Ligar ou desligar o ímã" });
    await botaoIma.click();
    await expect(acao).toHaveText("Ímã desligado");
    await clicar(-L, -L); await clicar(L, -L); await clicar(L, L);
    await expect(pontos).toHaveCount(3);
    await expect(page.getByTestId("mapa-medida-pontos")).toHaveText("3");
    await expect(page.getByTestId("mapa-lado"), "aberta: um rótulo de medida por lado traçado").toHaveCount(2);
    await expect(pontos.first()).toHaveAttribute("data-origem", "livre");
    await expect(page.getByTestId("mapa-medida-area")).not.toHaveText("0,00");
    await expect(confirmar).toHaveText(/Fechar polígono/);

    // desfazer / refazer: teclado, barra de ferramentas e botão direito
    await page.keyboard.press("Control+z"); await expect(pontos).toHaveCount(2);
    await page.keyboard.press("Control+Shift+z"); await expect(pontos).toHaveCount(3);
    await page.getByTestId("mapa-desfazer").click(); await expect(pontos).toHaveCount(2);
    await page.getByTestId("mapa-refazer").click(); await expect(pontos).toHaveCount(3);
    await clicar(0, L + 50, { button: "right" }); await expect(pontos).toHaveCount(2);
    await page.keyboard.press("Control+y"); await expect(pontos).toHaveCount(3);

    // 4º ponto, e fecha clicando no primeiro
    await clicar(-L, L);
    await clicar(-L, -L);
    await expect(acao).toHaveText("Fechado no primeiro ponto");
    await expect(confirmar).toHaveText(/Gravar área/);
    await expect(page.getByTestId("mapa-lado"), "fechada: os 4 lados").toHaveCount(4);

    // segurar no meio de um lado cria um ponto; dois cliques num ponto o apagam
    const meio = em(0, -L);
    await page.mouse.move(meio.x, meio.y); await page.mouse.down(); await page.mouse.move(meio.x, meio.y - 40, { steps: 4 }); await page.mouse.up();
    await expect(acao).toHaveText("Ponto do meio virou vértice");
    await expect(pontos).toHaveCount(5);
    const novo = em(0, -L - 40);
    await page.mouse.dblclick(novo.x, novo.y);
    await expect(acao).toHaveText("Ponto 2 apagado");
    await expect(pontos).toHaveCount(4);

    // segurar dentro da área fechada move tudo; desfazer devolve
    const antes = await pontos.first().textContent();
    const dentro = em(-L / 2, L / 2);
    await page.mouse.move(dentro.x, dentro.y); await page.mouse.down(); await page.mouse.move(dentro.x + 30, dentro.y, { steps: 4 }); await page.mouse.up();
    await expect(acao).toHaveText("Área movida");
    await expect(pontos.first()).not.toHaveText(antes ?? "");
    await page.keyboard.press("Control+z");
    await expect(pontos.first()).toHaveText(antes ?? "");

    const primeira = uniq("Talhão E2E");
    await confirmar.click();
    await expect(page.getByTestId("mapa-form-tamanho"), "o tamanho vem calculado do desenho").not.toHaveValue("");
    await page.getByTestId("mapa-form-nome").fill(primeira);
    await page.getByTestId("mapa-form-salvar").click();
    await expect(page.getByTestId("mapa-instrucao")).toBeHidden();
    await expect(page.getByTestId("mapa-item-area").filter({ hasText: primeira })).toBeVisible();

    // ---------- 2ª área: ímã ----------
    await abrirEditor(page);
    await botaoIma.click();
    await expect(acao).toHaveText("Ímã ligado");
    const perto = em(L + 6, -L - 5);
    await page.mouse.move(perto.x, perto.y);
    await expect(page.getByTestId("mapa-ima-dica")).toContainText("Ímã — vértice");
    await expect(page.getByTestId("mapa-ima-dica")).toContainText("divisa de");
    await page.mouse.click(perto.x, perto.y);
    await expect(pontos.nth(0)).toHaveAttribute("data-origem", "vertice");
    await expect(acao).toHaveText(/^Ponto grudou no vértice de /);

    await clicar(L + 8, 0);
    await expect(pontos.nth(1)).toHaveAttribute("data-origem", "aresta");
    await expect(page.getByTestId("mapa-medida-grudados")).toHaveText("2");

    await page.keyboard.down("Alt"); await clicar(L + 6, L + 5); await page.keyboard.up("Alt");
    await expect(pontos.nth(2), "com Alt o ímã solta: ponto livre mesmo perto do canto").toHaveAttribute("data-origem", "livre");

    await page.keyboard.down("Shift");
    const longe = em(L + 60, L + 80); await page.mouse.move(longe.x, longe.y);
    await expect(page.getByTestId("mapa-rumo")).toHaveText(/^(0|45|90|135|180|225|270|315)°$/);
    await page.keyboard.up("Shift");

    await page.keyboard.press("Enter");
    await expect(acao).toHaveText("Fechado com Enter");
    const segunda = uniq("Divisa E2E");
    await confirmar.click();
    await page.getByTestId("mapa-form-nome").fill(segunda);
    await page.getByTestId("mapa-form-salvar").click();
    await expect(page.getByTestId("mapa-item-area").filter({ hasText: segunda })).toBeVisible();

    // a divisa não tem fresta: o vértice grudado é a MESMA coordenada de uma área vizinha
    const lista = await api<{ items: Area[] }>(page, "GET", "/api/resources/mapa_areas?pageSize=500");
    const gravada = lista.items.find((a) => a.nome === segunda);
    const anel = gravada?.geometria?.coordinates[0] ?? [];
    expect(anel.length, "polígono canônico: 3 pontos + o de fechamento").toBe(4);
    const v = anel[0]!;
    const vizinhas = lista.items.filter((a) => a.nome !== segunda);
    expect(vizinhas.some((a) => (a.geometria?.coordinates[0] ?? []).some((c) => c[0] === v[0] && c[1] === v[1])), "o vértice grudado tem de ser idêntico ao da vizinha").toBe(true);
  });
});
