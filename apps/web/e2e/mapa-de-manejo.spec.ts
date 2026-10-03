import { test, expect, type Page } from "@playwright/test";
import { api, login, uniq } from "./helpers";

/**
 * CADASTRO-AREAS-03 — o cadastro de área existe num lugar só: a ficha de Áreas/Piquetes, com o editor de contorno
 * completo (ímã nas vizinhas, vértices, mover, histórico) DENTRO dela. "Concluir contorno" devolve o polígono para a
 * ficha sem abrir nada por cima; quem grava é o Salvar. O Mapa de Manejo só mostra e leva ao cadastro. A importação
 * de contornos (KML / GeoJSON) mora na lista de Áreas/Piquetes.
 */
test.use({ launchOptions: { ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}), args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] } });

type Area = { id: string; name: string; color: string | null; area_ha: string | number | null; geometria: { type: string; coordinates: number[][][] } | null };

async function limparAreas(page: Page) {
  const lista = await api<{ items: { id: string }[] }>(page, "GET", "/api/resources/areas?pageSize=500");
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
  // DELETE sem corpo e sem content-type (o helper `api` manda JSON, e corpo vazio com JSON é recusado)
  for (const a of lista.items ?? []) {
    await page.evaluate(async ({ id, base }) => {
      const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string | null; empresaId: string | null };
      const res = await fetch(`${base}/api/resources/areas/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}), ...(s.empresaId ? { "x-empresa-id": s.empresaId } : {}) } });
      if (!res.ok) throw new Error(`DELETE areas ${id}: ${res.status}`);
    }, { id: a.id, base });
  }
  const depois = await api<{ items: { id: string }[] }>(page, "GET", "/api/resources/areas?pageSize=500");
  expect(depois.items.length, "premissa: o teste começa sem áreas visíveis").toBe(0);
}

async function empresaDaSessao(page: Page): Promise<string> {
  const daSessao = await page.evaluate(() => (JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { empresaId?: string | null }).empresaId ?? null);
  if (daSessao) return daSessao;
  const ctx = await api<{ empresas?: { id: string }[] }>(page, "GET", "/api/auth/context");
  const id = ctx.empresas?.[0]?.id;
  expect(id, "premissa: há empresa visível").toBeTruthy();
  return id!;
}

const areas = async (page: Page) => (await api<{ items: Area[] }>(page, "GET", "/api/resources/areas?pageSize=500")).items;

test("o Mapa de Manejo só mostra: lista, resume a área clicada e leva ao cadastro de Áreas/Piquetes", async ({ page }) => {
  test.setTimeout(90_000);
  await login(page);
  await limparAreas(page);
  const empresa = await empresaDaSessao(page);
  const nome = uniq("Pasto Mapa").toLocaleUpperCase("pt-BR");
  const [lng, lat] = [-55.1, -15.1];
  const criada = await api<Area>(page, "POST", "/api/resources/areas", {
    empresa_id: empresa, name: nome, land_use: "pastagem", status: "ativa", tenure: "propria", area_ha: "120", usable_area_ha: "110", color: "#16a34a",
    geometria: { type: "Polygon", coordinates: [[[lng, lat], [lng + 0.01, lat], [lng + 0.01, lat + 0.01], [lng, lat + 0.01], [lng, lat]]] }
  });

  await page.goto("/mapa-de-manejo");
  await expect(page.getByRole("heading", { name: "Mapa de Manejo" })).toBeVisible();
  // só visualização: nada de desenho, importação ou ficha por cima
  for (const id of ["mapa-nova-area", "mapa-cadastro-sem-contorno", "mapa-importacao", "mapa-confirmar", "campo-mapa-desenhar", "mapa-ficha-cadastro"]) {
    await expect(page.getByTestId(id), `o mapa não tem mais "${id}"`).toHaveCount(0);
  }
  await expect(page.getByTestId("mapa-cadastrar-area")).toHaveAttribute("href", `/cadastros/areas/new?empresa_id=${empresa}`);
  await expect(page.getByTestId("mapa-ir-areas")).toHaveAttribute("href", "/configuracoes?tab=pecuaria&sub=areas");
  const item = page.getByTestId("mapa-item-area").filter({ hasText: nome });
  await expect(item).toBeVisible();
  await expect(page.getByTestId("mapa-item-area")).toHaveCount(1);

  // clique NO POLÍGONO (centro projetado pelo próprio mapa) abre o resumo — só leitura
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __mapaManejoE2E?: unknown }).__mapaManejoE2E)), { timeout: 30_000 }).toBe(true);
  await expect(page.getByTestId("mapa-rotulo-area").filter({ hasText: nome }), "a área aparece no mapa, enquadrada").toBeVisible({ timeout: 15_000 });
  const centro = await page.evaluate(({ lng, lat }) => {
    const m = (window as unknown as { __mapaManejoE2E: { project: (ll: [number, number]) => { x: number; y: number } } }).__mapaManejoE2E;
    return m.project([lng + 0.005, lat + 0.005]);
  }, { lng, lat });
  // premissa: o polígono já está NO CANVAS naquele ponto (o rótulo é DOM e aparece antes do WebGL terminar a fonte)
  await expect.poll(async () => page.evaluate(({ x, y }) => {
    const m = (window as unknown as { __mapaManejoE2E: { queryRenderedFeatures: (p: [number, number], o: { layers: string[] }) => unknown[] } }).__mapaManejoE2E;
    return m.queryRenderedFeatures([x, y], { layers: ["areas-fill"] }).length;
  }, centro), { timeout: 15_000 }).toBe(1);
  const caixa = await page.getByTestId("mapa-canvas").boundingBox();
  expect(caixa).not.toBeNull();
  await page.mouse.click(caixa!.x + centro.x, caixa!.y + centro.y);
  const resumo = page.getByTestId("mapa-area-selecionada");
  await expect(resumo).toBeVisible();
  await expect(resumo).toContainText(nome);
  await expect(resumo).toContainText("120,00 ha");
  await expect(page.getByRole("dialog"), "o resumo não é janela nem ficha").toHaveCount(0);
  await expect(resumo.getByTestId("mapa-abrir-cadastro")).toHaveAttribute("href", `/cadastros/areas/${criada.id}`);

  // "Abrir cadastro" leva à ficha de Áreas/Piquetes, com o mapa do contorno nela
  await resumo.getByTestId("mapa-abrir-cadastro").click();
  await expect(page).toHaveURL(new RegExp(`/cadastros/areas/${criada.id}$`));
  await expect(page.getByTestId("campo-mapa-area")).toBeVisible();
  await expect(page.locator('input[name="name"]')).toHaveValue(nome);
  await expect(page.getByTestId("campo-mapa-desenhar")).toHaveText("Editar contorno");
});

test.describe("contorno desenhado na ficha de Áreas/Piquetes", () => {
  const L = 100;

  /** Abre o editor da ficha e devolve o conversor de deslocamento (px a partir do centro de trabalho) para a tela. */
  async function abrirEditor(page: Page) {
    const desenhar = page.getByTestId("campo-mapa-desenhar");
    await page.getByTestId("campo-mapa-area").scrollIntoViewIfNeeded();
    await expect(desenhar, "o mapa precisa carregar (WebGL) para liberar o desenho").toBeEnabled({ timeout: 30_000 });
    await desenhar.click();
    await expect(page.getByTestId("mapa-instrucao")).toBeVisible();
    await expect(page.getByTestId("mapa-barra-ima")).toBeVisible();
    const box = await page.getByTestId("mapa-canvas").boundingBox();
    expect(box, "o canvas do mapa precisa estar na tela").not.toBeNull();
    const faixa = (test.info().retry + test.info().repeatEachIndex) * 250;
    const cx = box!.x + box!.width / 2 - 150 + faixa, cy = box!.y + box!.height / 2;
    return (dx: number, dy: number) => ({ x: cx + dx, y: cy + dy });
  }

  /** "Concluir contorno" devolve o polígono para a ficha: nenhuma janela abre, o editor fecha e os hectares chegam. */
  async function gravarContorno(page: Page) {
    const confirmar = page.getByTestId("mapa-confirmar");
    await expect(confirmar).toHaveText(/Concluir contorno/);
    await confirmar.click();
    await expect(page.getByRole("dialog"), "concluir o contorno não abre janela nenhuma").toHaveCount(0);
    await expect(page.getByTestId("mapa-ficha-cadastro")).toHaveCount(0);
    await expect(page.getByTestId("mapa-instrucao")).toBeHidden();
    await expect(page.getByTestId("campo-mapa-ha")).toBeVisible();
    await expect(page.getByTestId("campo-mapa-desenhar")).toHaveText("Editar contorno");
    await expect(page.getByTestId("campo-mapa-falta-salvar"), "avisa que quem grava é o Salvar da ficha").toBeVisible();
  }

  async function escolherCor(page: Page, cor: string) {
    await page.getByRole("combobox", { name: "Cor", exact: true }).click();
    await page.getByRole("option", { name: cor, exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Cor", exact: true })).toContainText(cor);
  }

  async function salvar(page: Page) {
    const resposta = page.waitForResponse((r) => ["POST", "PUT"].includes(r.request().method()) && /\/api\/resources\/areas(\/[0-9a-f-]+)?$/.test(new URL(r.url()).pathname));
    await page.getByRole("button", { name: "Salvar" }).click();
    const r = await resposta;
    expect(r.status(), await r.text()).toBeLessThan(300);
    return r.request().postDataJSON() as Record<string, unknown>;
  }

  test("desenha com as ferramentas do editor na ficha, grava sem janela, e a segunda área gruda na primeira", async ({ page }) => {
    test.setTimeout(180_000);
    await login(page);
    await limparAreas(page);
    const empresa = await empresaDaSessao(page);
    await page.goto(`/cadastros/areas/new?empresa_id=${empresa}`);
    const pontos = page.getByTestId("mapa-medida-pontos");
    const acao = page.getByTestId("mapa-acao");
    const confirmar = page.getByTestId("mapa-confirmar");

    const em = await abrirEditor(page);
    const clicar = (dx: number, dy: number, opts?: { button?: "right" }) => { const p = em(dx, dy); return page.mouse.click(p.x, p.y, opts); };

    // ímã liga/desliga no ícone (padrão 8 px, vértice+aresta); sem vizinhas → pontos livres
    await expect(page.getByTestId("mapa-ima-toggle")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("mapa-ima-toggle").click();
    await expect(page.getByTestId("mapa-ima-toggle")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("mapa-ima-toggle").click();
    await expect(page.getByTestId("mapa-ima-toggle")).toHaveAttribute("aria-pressed", "true");
    await clicar(-L, -L); await clicar(L, -L); await clicar(L, L);
    await expect(pontos).toHaveText("3");
    await expect(page.getByTestId("mapa-medida-area")).not.toHaveText("0,00");
    await expect(confirmar).toHaveText(/Fechar polígono/);
    await expect(page.getByTestId("mapa-lado")).toHaveCount(0);
    await page.getByTestId("mapa-metragem-toggle").click();
    await expect(page.getByTestId("mapa-metragem-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("mapa-lado"), "aberta: um rótulo de medida por lado traçado").toHaveCount(2);

    await page.keyboard.press("Control+z"); await expect(pontos).toHaveText("2");
    await page.keyboard.press("Control+Shift+z"); await expect(pontos).toHaveText("3");
    await page.getByTestId("mapa-desfazer").click(); await expect(pontos).toHaveText("2");
    await page.getByTestId("mapa-refazer").click(); await expect(pontos).toHaveText("3");
    await clicar(0, L + 50, { button: "right" }); await expect(pontos).toHaveText("2");
    await page.keyboard.press("Control+y"); await expect(pontos).toHaveText("3");

    await clicar(-L, L);
    await clicar(-L, -L);
    await expect(acao).toHaveText("Fechado no primeiro ponto");
    await expect(confirmar).toHaveText(/Concluir contorno/);
    await expect(page.getByTestId("mapa-lado"), "fechada: os 4 lados").toHaveCount(4);

    // com o desenho aberto, o Salvar da ficha é RECUSADO com aviso (o desenho não se perde em silêncio) — nada é enviado
    const envios: string[] = [];
    page.on("request", (r) => { if (["POST", "PUT"].includes(r.method()) && new URL(r.url()).pathname.startsWith("/api/resources/areas")) envios.push(r.method()); });
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(acao).toHaveText("Conclua ou cancele o contorno antes de salvar");
    await expect(page.getByText("Conclua o contorno antes de salvar").first()).toBeVisible();
    await expect(page.getByTestId("mapa-instrucao"), "o desenho continua aberto").toBeVisible();
    await expect(pontos).toHaveText("4");
    expect(envios, "nenhum POST/PUT sai com o desenho aberto").toEqual([]);

    const meio = em(0, -L);
    await page.mouse.move(meio.x, meio.y); await page.mouse.down(); await page.mouse.move(meio.x, meio.y - 40, { steps: 4 }); await page.mouse.up();
    await expect(acao).toHaveText("Ponto do meio virou vértice");
    await expect(pontos).toHaveText("5");
    const novo = em(0, -L - 40);
    await page.mouse.dblclick(novo.x, novo.y);
    await expect(acao).toHaveText("Ponto 2 apagado");
    await expect(pontos).toHaveText("4");

    // mover a área só com a mãozinha ligada
    const dentro = em(-L / 2, L / 2);
    await page.mouse.move(dentro.x, dentro.y); await page.mouse.down(); await page.mouse.move(dentro.x + 30, dentro.y, { steps: 4 }); await page.mouse.up();
    await expect(acao).not.toHaveText("Área movida");
    await page.getByTestId("mapa-mover-area-toggle").click();
    await expect(page.getByTestId("mapa-mover-area-toggle")).toHaveAttribute("aria-pressed", "true");
    await page.mouse.move(dentro.x, dentro.y); await page.mouse.down(); await page.mouse.move(dentro.x + 30, dentro.y, { steps: 4 }); await page.mouse.up();
    await expect(acao).toHaveText("Área movida");
    await page.keyboard.press("Control+z");
    await expect(acao).not.toHaveText("Área movida");

    await gravarContorno(page);
    // os hectares vêm do desenho (aba Medidas da ficha)
    await page.getByRole("tab", { name: "Medidas" }).click();
    await expect(page.locator('input[name="area_ha"]'), "a área total vem calculada do contorno").not.toHaveValue("");
    await expect(page.locator('input[name="usable_area_ha"]'), "a área útil vazia herda a total").not.toHaveValue("");
    await page.getByRole("tab", { name: "Principal" }).click();
    const primeira = uniq("Talhão E2E").toLocaleUpperCase("pt-BR");
    await page.locator('input[name="name"]').fill(primeira);
    await escolherCor(page, "Verde claro");
    const corpo = await salvar(page);
    expect((corpo["geometria"] as { type?: string } | null)?.type, "o contorno da ficha viaja no corpo do Salvar").toBe("Polygon");

    const gravadas = await areas(page);
    const a1 = gravadas.find((a) => a.name === primeira);
    expect(a1?.color, "a cor escolhida na lista é a gravada").toBe("#92ca25");
    expect(a1?.geometria?.coordinates[0]?.length, "4 vértices + o de fechamento").toBe(5);
    expect(Number(a1?.area_ha), "a área total gravada é a do desenho").toBeGreaterThan(0);

    // ---------- 2ª área: o ímã da ficha gruda no vértice e na aresta REAIS da 1ª ----------
    await page.goto(`/cadastros/areas/new?empresa_id=${empresa}`);
    const em2 = await abrirEditor(page);
    await expect.poll(async () => page.evaluate(() => {
      const w = window as unknown as { __editorContornoE2E?: unknown; __editorContornoVizinhasE2E?: unknown[] };
      return Boolean(w.__editorContornoE2E) && (w.__editorContornoVizinhasE2E?.length ?? 0) > 0;
    }), { timeout: 15_000 }).toBe(true);

    // Dispara mousemove/click no MapLibre (evita overlay/toolbar interceptando o mouse da página).
    async function imaEm(alvo: "vertice" | "aresta") {
      await page.evaluate(({ nome, alvo }) => {
        const w = window as unknown as {
          __editorContornoE2E?: { project: (ll: [number, number]) => { x: number; y: number }; fire: (type: string, ev: Record<string, unknown>) => void };
          __editorContornoVizinhasE2E?: { name: string; geometria: { coordinates: number[][][] } | null }[];
        };
        const m = w.__editorContornoE2E;
        if (!m) throw new Error("mapa e2e não exposto");
        const area = (w.__editorContornoVizinhasE2E ?? []).find((a) => a.name === nome);
        const anel = area?.geometria?.coordinates?.[0] ?? [];
        if (anel.length < 3) throw new Error("área vizinha sem anel");
        const v0 = anel[0]!, v1 = anel[1]!;
        const ll: [number, number] = alvo === "vertice" ? [v0[0]!, v0[1]!] : [(v0[0]! + v1[0]!) / 2, (v0[1]! + v1[1]!) / 2];
        const point = m.project(ll);
        const fake = { altKey: false, shiftKey: false, button: 0, detail: 1, preventDefault() { /* */ } };
        m.fire("mousemove", { point, lngLat: { lng: ll[0], lat: ll[1] }, originalEvent: fake });
        m.fire("click", { point, lngLat: { lng: ll[0], lat: ll[1] }, originalEvent: fake });
      }, { nome: primeira, alvo });
    }

    await imaEm("vertice");
    await expect(acao).toHaveText(`Ponto grudou no vértice de ${primeira}`);
    await expect(page.getByTestId("mapa-medida-grudados")).toHaveText("1");
    await imaEm("aresta");
    await expect(acao).toHaveText(`Ponto grudou na aresta de ${primeira}`);
    await expect(page.getByTestId("mapa-medida-grudados")).toHaveText("2");

    const livre = em2(L + 6, L + 5);
    await page.keyboard.down("Alt"); await page.mouse.click(livre.x, livre.y); await page.keyboard.up("Alt");
    await expect(acao).toHaveText("Ponto marcado");

    // a ficha enquadra a vizinha, então o mouse pode cair sobre a divisa dela: Alt solta o ímã e Shift trava o rumo
    await page.keyboard.down("Alt"); await page.keyboard.down("Shift");
    const longe = em2(L + 60, L + 80); await page.mouse.move(longe.x, longe.y);
    await expect(page.getByTestId("mapa-rumo")).toHaveText(/^(0|45|90|135|180|225|270|315)°$/);
    await page.keyboard.up("Shift"); await page.keyboard.up("Alt");

    await page.keyboard.press("Enter");
    await expect(acao).toHaveText("Fechado com Enter");
    await gravarContorno(page);
    const segunda = uniq("Divisa E2E").toLocaleUpperCase("pt-BR");
    await page.locator('input[name="name"]').fill(segunda);
    await salvar(page);

    const lista = await areas(page);
    const gravada = lista.find((a) => a.name === segunda);
    const anel = gravada?.geometria?.coordinates[0] ?? [];
    expect(anel.length, "polígono canônico: 3 pontos + o de fechamento").toBe(4);
    const v = anel[0]!;
    const daPrimeira = lista.find((a) => a.name === primeira)?.geometria?.coordinates[0] ?? [];
    expect(daPrimeira.some((c) => c[0] === v[0] && c[1] === v[1]), "o vértice grudado é idêntico ao da vizinha").toBe(true);

    // ---------- edição: o contorno salvo volta ao editor, muda, e o Salvar grava o novo ----------
    await page.goto(`/cadastros/areas/${a1!.id}`);
    await expect(page.locator('input[name="name"]')).toHaveValue(primeira);
    const antes = JSON.stringify(a1!.geometria);
    await abrirEditor(page);
    await expect(confirmar, "o contorno salvo entra fechado").toHaveText(/Concluir contorno/);
    await expect(pontos).toHaveText("4");
    // arrasta um vértice do contorno salvo (o primeiro), na projeção do próprio mapa
    const vertice = await page.evaluate(({ v }) => {
      const m = (window as unknown as { __editorContornoE2E: { project: (ll: [number, number]) => { x: number; y: number } } }).__editorContornoE2E;
      return m.project([v[0]!, v[1]!]);
    }, { v: a1!.geometria!.coordinates[0]![0]! });
    const caixa = await page.getByTestId("mapa-canvas").boundingBox();
    const de = { x: caixa!.x + vertice.x, y: caixa!.y + vertice.y };
    await page.mouse.move(de.x, de.y); await page.mouse.down(); await page.mouse.move(de.x - 25, de.y - 25, { steps: 5 }); await page.mouse.up();
    await expect(acao).toHaveText("Ponto solto");
    await gravarContorno(page);
    const editado = uniq("Talhão Edit").toLocaleUpperCase("pt-BR");
    await page.locator('input[name="name"]').fill(editado);
    await escolherCor(page, "Laranja");
    await salvar(page);
    const apos = (await areas(page)).find((a) => a.id === a1!.id);
    expect(apos?.name).toBe(editado);
    expect(apos?.color).toBe("#f5a01b");
    expect(JSON.stringify(apos?.geometria), "o contorno editado é o gravado").not.toBe(antes);
  });
});

test("importação KML mini, na lista de Áreas/Piquetes, cria áreas brancas com os nomes do arquivo — e o mapa as mostra", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await limparAreas(page);
  await page.goto("/configuracoes?tab=pecuaria&sub=areas");
  await page.getByTestId("areas-importar-contornos").click();
  await page.getByTestId("areas-importacao-arquivo").setInputFiles("e2e/fixtures/mapa-import-mini.kml");
  await expect(page.getByTestId("areas-importacao-progresso")).toContainText(/concluída/i, { timeout: 60_000 });
  const importadas = (await areas(page)).filter((a) => a.name.includes("PASTO 06 A") || a.name.includes("PASTO 07 A"));
  expect(importadas.length).toBeGreaterThanOrEqual(2);
  for (const a of importadas) {
    expect(a.color, "importação sempre branca").toBe("#f8f9fa");
    expect(a.geometria?.type, "com o contorno do arquivo").toBe("Polygon");
  }
  await page.goto("/mapa-de-manejo");
  await expect(page.getByTestId("mapa-item-area").filter({ hasText: "MT - PASTO 06 A" })).toBeVisible();
  await expect(page.getByTestId("mapa-item-area").filter({ hasText: "MT - PASTO 07 A" })).toBeVisible();
});

test("importação KML fazenda_kaiman, na lista de Áreas/Piquetes, carrega os 102 polígonos", async ({ page }) => {
  test.setTimeout(300_000);
  await login(page);
  await limparAreas(page);
  await page.goto("/configuracoes?tab=pecuaria&sub=areas");
  await page.getByTestId("areas-importar-contornos").click();
  await page.getByTestId("areas-importacao-arquivo").setInputFiles("e2e/fixtures/fazenda_kaiman_1-2025-12-11_08-10-39.kml");
  await expect(page.getByTestId("areas-importacao-progresso")).toContainText(/102/, { timeout: 240_000 });
  await expect(page.getByTestId("areas-importacao-progresso")).toContainText(/concluída/i, { timeout: 240_000 });
  const lista = await areas(page);
  expect(lista.length, "102 polígonos do KML").toBe(102);
  expect(lista.every((a) => a.color === "#f8f9fa"), "todas brancas").toBe(true);
  expect(lista.some((a) => a.name.includes("PASTO"))).toBe(true);
});
