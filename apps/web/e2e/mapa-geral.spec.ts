import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { ADMIN, api, login, uniq } from "./helpers";

/**
 * CADASTRO-AREAS-03 — o cadastro de área existe num lugar só: a ficha de Cadastro de Área (antes "Áreas / Piquetes"),
 * com o editor de contorno completo (ímã nas vizinhas, vértices, mover, histórico) DENTRO dela. "Concluir contorno"
 * devolve o polígono para a ficha sem abrir nada por cima; quem grava é o Salvar. O Mapa geral (antes Mapa de Manejo,
 * decisão 294) só mostra e leva ao cadastro. A importação de contornos (KML / GeoJSON) mora na lista do cadastro.
 *
 * MAPA-GERAL (decisão 294) — o NDVI de cada área no Mapa geral: escala fixa, legenda, atribuição do Copernicus, painel
 * com a última imagem útil, a variação, o histórico e o "Analisar agora" (o provedor fica DESLIGADO no E2E: a tela
 * mostra a recusa controlada do servidor — nenhuma conta Copernicus, nenhuma chamada de rede).
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

test("o Mapa geral só mostra: lista, resume a área clicada e leva ao Cadastro de Área; a rota antiga redireciona", async ({ page }) => {
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

  // a rota antiga do módulo (favoritos, links salvos) leva ao Mapa geral
  await page.goto("/mapa-de-manejo");
  await expect(page).toHaveURL(/\/mapa-geral$/);
  await expect(page.getByRole("heading", { name: "Mapa geral" })).toBeVisible();
  await expect(page.getByTestId("mapa-ir-areas")).toHaveText("Cadastro de Área");
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
  // área nunca analisada: o painel diz isso, e o mapa fica na cor do cadastro (sem NDVI em nenhuma área)
  await expect(resumo.getByTestId("mapa-ndvi-sem-analise")).toHaveText("Nenhuma análise por satélite desta área ainda.");
  await expect(page.getByTestId("mapa-cor-cadastro")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("mapa-legenda-ndvi")).toHaveCount(0);

  // "Abrir cadastro" leva à ficha de Cadastro de Área, com o mapa do contorno nela
  await resumo.getByTestId("mapa-abrir-cadastro").click();
  await expect(page).toHaveURL(new RegExp(`/cadastros/areas/${criada.id}$`));
  await expect(page.getByTestId("campo-mapa-area")).toBeVisible();
  await expect(page.locator('input[name="name"]')).toHaveValue(nome);
  await expect(page.getByTestId("campo-mapa-desenhar")).toHaveText("Editar contorno");
});

test.describe("contorno desenhado na ficha de Cadastro de Área", () => {
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

test("importação KML mini, na lista do Cadastro de Área, cria áreas brancas com os nomes do arquivo — e o mapa as mostra", async ({ page }) => {
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
  await page.goto("/mapa-geral");
  await expect(page.getByTestId("mapa-item-area").filter({ hasText: "MT - PASTO 06 A" })).toBeVisible();
  await expect(page.getByTestId("mapa-item-area").filter({ hasText: "MT - PASTO 07 A" })).toBeVisible();
});

test("importação KML fazenda_kaiman, na lista do Cadastro de Área, carrega os 102 polígonos", async ({ page }) => {
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

// ---------- MAPA-GERAL (decisão 294): o NDVI de cada área ----------

const BANCO = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, "/agro_erp_e2e") ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_e2e";
const sql = (c: string) => execFileSync("psql", [BANCO, "-v", "ON_ERROR_STOP=1", "-Atc", c], { encoding: "utf8" }).trim();
const FORMA_UUID = /^[0-9a-f-]{36}$/;

/**
 * Uma execução da análise gravada DIRETO no banco do E2E (o provedor fica desligado no E2E): janela, registro e imagem
 * explícitos, hash do polígono atual da área (o gatilho da 0052 confere). `obs` nulo = sem observação útil.
 */
function semearAnalise(areaId: string, janela: string, criado: string, obs: { inicio: string; media: string } | null) {
  expect(areaId).toMatch(FORMA_UUID);
  const autor = sql(`select id from erp.users where email='${ADMIN.email}'`);
  const fim = new Date(Date.parse(janela) + 30 * 86_400_000).toISOString();
  const c = obs !== null;
  sql(`insert into erp.analises_satelitais (organization_id, empresa_id, area_id, provedor, colecao, indice, versao_metodo, geometria_sha256,
      janela_inicio, janela_fim, resolucao_m, situacao, motivo_qualidade, observacao_inicio, observacao_fim, valor_medio, valor_minimo,
      valor_maximo, desvio_padrao, pixels_amostra, pixels_sem_dado, pixels_validos, pixels_geometria, cobertura_valida, criado_por, created_at)
    select a.organization_id, a.empresa_id, a.id, 'copernicus_cdse', 'sentinel-2-l2a', 'ndvi', 'sat01-ndvi-v1', encode(sha256(convert_to(a.geometria::text, 'UTF8')), 'hex'),
      '${janela}', '${fim}', 10, '${c ? "concluida" : "sem_observacao_util"}', ${c ? "null" : "'cobertura_insuficiente'"},
      ${c ? `'${obs.inicio}', '${obs.inicio}'::timestamptz + interval '1 day', ${obs.media}, ${obs.media} - 0.2, ${obs.media} + 0.1, 0.05, 13000, 2000, 11000, 11860, 0.9275`
        : "null, null, null, null, null, null, null, null, null, 11860, null"},
      '${autor}', '${criado}'
     from erp.areas a where a.id = '${areaId}'`);
}

/** A cor que o MAPA está pintando na área (a propriedade da fonte `areas`, não o estado da tela). */
const corNoMapa = (page: Page, id: string) => page.evaluate((id) => {
  const m = (window as unknown as { __mapaManejoE2E: { querySourceFeatures: (s: string) => { properties: Record<string, unknown> }[] } }).__mapaManejoE2E;
  const f = m.querySourceFeatures("areas").find((x) => x.properties["id"] === id);
  return f ? String(f.properties["cor_exibida"]) : null;
}, id);

test("Mapa geral: NDVI na escala fixa, legenda e atribuição; painel com última imagem, variação e histórico; 'Analisar agora' com o provedor desligado", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await limparAreas(page);
  const empresa = await empresaDaSessao(page);
  const quadrado = (lng: number, lat: number) => ({ type: "Polygon", coordinates: [[[lng, lat], [lng + 0.01, lat], [lng + 0.01, lat + 0.01], [lng, lat + 0.01], [lng, lat]]] });
  const criar = (nome: string, lng: number) => api<Area>(page, "POST", "/api/resources/areas", {
    empresa_id: empresa, name: nome, land_use: "pastagem", status: "ativa", tenure: "propria", area_ha: "100", usable_area_ha: "100", color: "#2563eb", geometria: quadrado(lng, -15.2)
  });
  const verde = await criar(uniq("NDVI VERDE").toLocaleUpperCase("pt-BR"), -55.3);
  const nublada = await criar(uniq("NDVI NUVEM").toLocaleUpperCase("pt-BR"), -55.28);
  const nunca = await criar(uniq("NDVI NUNCA").toLocaleUpperCase("pt-BR"), -55.26);
  semearAnalise(verde.id, "2026-08-01T00:00:00Z", "2026-08-10T12:00:00Z", { inicio: "2026-08-05T00:00:00Z", media: "0.55" });
  semearAnalise(verde.id, "2026-09-05T00:00:00Z", "2026-09-12T12:00:00Z", { inicio: "2026-09-10T00:00:00Z", media: "0.72" });
  semearAnalise(nublada.id, "2026-09-05T00:00:00Z", "2026-09-12T12:00:00Z", null);
  const linhas = () => Number(sql(`select count(*) from erp.analises_satelitais where area_id in ('${verde.id}','${nublada.id}','${nunca.id}')`));
  expect(linhas(), "premissa: três execuções semeadas").toBe(3);

  // Conta pedidos: um resumo (+ listagem de rasters), nenhum POST de geração e nenhuma pergunta por área antes do painel.
  const pedidosSat: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url()).pathname;
    if (u.includes("/analises-satelitais") || u.includes("/mapa/rasters")) pedidosSat.push(`${r.method()} ${u}`);
  });
  const resumo = page.waitForResponse((r) => r.url().includes("/api/mapa/analises-satelitais/resumo") && r.request().method() === "GET");
  await page.goto("/mapa-geral");
  expect((await resumo).status(), "o mapa pede o resumo de TODAS as áreas numa chamada").toBe(200);
  await expect(page.getByTestId("mapa-item-area")).toHaveCount(3);
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __mapaManejoE2E?: unknown }).__mapaManejoE2E)), { timeout: 30_000 }).toBe(true);

  // Sem raster gerado: abre em "Por área" (média sólida). 0,72 = vigor alto; sem imagem útil / nunca = cinza.
  await expect(page.getByTestId("mapa-cor-area"), "sem imagem por pixel, o mapa abre na média por área").toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => corNoMapa(page, verde.id), { timeout: 15_000 }).toBe("#1a9850");
  expect(await corNoMapa(page, nublada.id)).toBe("#94a3b8");
  expect(await corNoMapa(page, nunca.id)).toBe("#94a3b8");
  const legenda = page.getByTestId("mapa-legenda-ndvi");
  await expect(legenda).toBeVisible();
  await expect(legenda.getByTestId("mapa-legenda-classe")).toHaveText([
    "Vigor alto (0,60 ou mais)", "Vigor médio (0,40 a 0,60)", "Vigor baixo (0,20 a 0,40)", "Pouca ou nenhuma vegetação (abaixo de 0,20)"
  ]);
  await expect(legenda).toContainText("Não é biomassa");
  await expect(page.getByTestId("mapa-atribuicao-copernicus-mapa")).toHaveText("Contains modified Copernicus Sentinel data 2026");
  await expect(page.getByTestId("mapa-atribuicao-copernicus"), "atribuição só no mapa — sem duplicar no painel").toHaveCount(0);
  await expect(page.getByTestId("mapa-item-area").filter({ hasText: verde.name }).getByTestId("mapa-item-ndvi")).toHaveText("0,72");
  await expect(page.getByTestId("mapa-item-area").filter({ hasText: nunca.name }).getByTestId("mapa-item-ndvi")).toHaveCount(0);

  expect(pedidosSat.filter((p) => p.startsWith("POST")), "abrir a tela NÃO gera imagem").toEqual([]);
  expect(pedidosSat.filter((p) => p.includes("/analises-satelitais/resumo"))).toEqual(["GET /api/mapa/analises-satelitais/resumo"]);
  expect(pedidosSat.some((p) => p.startsWith("GET /api/mapa/rasters")), "lista rasters sem gerar").toBe(true);

  // painel da área: última imagem útil, classe, variação desde a imagem anterior, polígono atual
  await page.getByTestId("mapa-item-area").filter({ hasText: verde.name }).click();
  const painel = page.getByTestId("mapa-area-selecionada");
  await expect(painel.getByTestId("mapa-ndvi-valor")).toHaveText("0,72");
  await expect(painel.getByTestId("mapa-ndvi-classe")).toHaveText("Vigor alto (0,60 ou mais)");
  await expect(painel.getByTestId("mapa-ndvi-faixa")).toHaveText("Mínimo 0,52 · Máximo 0,82");
  await expect(painel.getByTestId("mapa-ndvi-imagem")).toHaveText(/^Imagem de 10\/09\/2026 · 93\s?% da área vista$/);
  await expect(painel.getByTestId("mapa-ndvi-variacao")).toHaveText("+0,17 desde a imagem de 05/08/2026");
  await expect(painel.getByTestId("mapa-ndvi-contorno-anterior")).toHaveCount(0);

  // histórico: as duas imagens, da mais recente para a mais antiga, e a linha do tempo
  await painel.getByTestId("mapa-ndvi-ver-historico").click();
  await expect(painel.getByTestId("mapa-ndvi-historico-item")).toHaveCount(2);
  await expect(painel.getByTestId("mapa-ndvi-historico-item").first()).toContainText("10/09/2026");
  await expect(painel.getByTestId("mapa-ndvi-historico-item").first()).toContainText("0,72");
  await expect(painel.getByTestId("mapa-ndvi-historico-item").last()).toContainText("05/08/2026");
  await expect(painel.getByTestId("mapa-ndvi-linha")).toBeVisible();
  await expect(page.getByTestId("mapa-atribuicao-copernicus-mapa")).toHaveCount(1);

  // "Analisar agora": o provedor está DESLIGADO no E2E — a recusa controlada do servidor aparece e nada é gravado
  const pedido = page.waitForResponse((r) => r.url().endsWith(`/api/mapa/areas/${verde.id}/analises-satelitais/ndvi`) && r.request().method() === "POST");
  await painel.getByTestId("mapa-ndvi-analisar").click();
  expect((await pedido).status()).toBe(503);
  await expect(painel.getByTestId("mapa-ndvi-aviso")).toHaveText("A análise por satélite está desligada neste ambiente.");
  expect(linhas(), "nada gravado").toBe(3);

  // a área cuja última execução não achou imagem útil: o motivo, sem número
  await page.getByTestId("mapa-item-area").filter({ hasText: nublada.name }).click();
  await expect(painel.getByTestId("mapa-ndvi-valor")).toHaveCount(0);
  await expect(painel.getByTestId("mapa-ndvi-ultima-sem-imagem")).toContainText("Sem observação útil — Nuvem, sombra ou pixel inválido cobrindo a área em todas as imagens da janela.");
  await page.getByTestId("mapa-item-area").filter({ hasText: nunca.name }).click();
  await expect(painel.getByTestId("mapa-ndvi-sem-analise")).toBeVisible();

  // "Cor do cadastro": a cor da área volta (a do cadastro, #2563eb, como o mapa a exibe), a legenda do NDVI sai. A área
  // conferida é a enquadrada agora (a seleção na lista aproxima o mapa dela) — e a cor é EXATA, nunca "diferente de".
  await page.getByTestId("mapa-item-area").filter({ hasText: verde.name }).click();
  await expect.poll(() => corNoMapa(page, verde.id), { timeout: 15_000 }).toBe("#1a9850");
  await page.getByTestId("mapa-cor-cadastro").click();
  await expect(legenda).toHaveCount(0);
  await expect(page.getByTestId("mapa-atribuicao-copernicus-mapa"), "a lista continua com o NDVI: a atribuição fica").toHaveText("Contains modified Copernicus Sentinel data 2026");
  await expect.poll(() => corNoMapa(page, verde.id)).toBe("#306bec");
  await page.getByTestId("mapa-cor-area").click();
  await expect.poll(() => corNoMapa(page, verde.id)).toBe("#1a9850");

  // contorno redesenhado DEPOIS da análise: o número fica, com o aviso de que foi calculado sobre o contorno anterior
  sql(`update erp.areas set geometria = '${JSON.stringify(quadrado(-55.3005, -15.2005))}'::jsonb where id = '${verde.id}'`);
  await page.reload();
  await page.getByTestId("mapa-item-area").filter({ hasText: verde.name }).click();
  await expect(painel.getByTestId("mapa-ndvi-valor")).toHaveText("0,72");
  await expect(painel.getByTestId("mapa-ndvi-contorno-anterior")).toHaveText("Calculado sobre o contorno anterior da área. Peça uma análise nova.");

  await limparAreas(page);
});

test("Mapa geral: o resumo do NDVI falha (500) — as áreas continuam no mapa, o aviso aparece e 'Tentar de novo' pede outra vez", async ({ page }) => {
  await login(page);
  let pedidos = 0;
  await page.route("**/api/mapa/analises-satelitais/resumo**", async (rota) => {
    pedidos += 1;
    await rota.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "Falha interna" } }) });
  });
  await page.goto("/mapa-geral");
  await expect(page.getByRole("heading", { name: "Mapa geral" })).toBeVisible();
  const aviso = page.getByTestId("mapa-ndvi-erro");
  await expect(aviso).toContainText("Não foi possível carregar o NDVI das áreas.");
  await expect(page.getByTestId("mapa-legenda-ndvi")).toHaveCount(0);
  await expect(page.getByTestId("mapa-cor-area"), "sem resumo, sem seletor de NDVI").toHaveCount(0);
  await expect(page.getByTestId("mapa-cor-pixel")).toHaveCount(0);
  const antes = pedidos;
  expect(antes, "premissa: a tela pediu o resumo").toBeGreaterThanOrEqual(1);
  await aviso.getByRole("button", { name: "Tentar de novo" }).click();
  await expect.poll(() => pedidos).toBe(antes + 1);
});

test("Mapa geral: 'Analisar agora' com a integração ligada e SEM credencial (503 `configuracao`) diz o que falta no servidor", async ({ page }) => {
  await login(page);
  await limparAreas(page);
  const empresa = await empresaDaSessao(page);
  const nome = uniq("NDVI SEM CREDENCIAL").toLocaleUpperCase("pt-BR");
  const area = await api<Area>(page, "POST", "/api/resources/areas", {
    empresa_id: empresa, name: nome, land_use: "pastagem", status: "ativa", tenure: "propria", area_ha: "100", usable_area_ha: "100", color: "#2563eb",
    geometria: { type: "Polygon", coordinates: [[[-55.4, -15.2], [-55.39, -15.2], [-55.39, -15.19], [-55.4, -15.19], [-55.4, -15.2]]] }
  });
  // O 503 do contrato da SAT-01 para "ligada sem credencial" (o E2E roda com a integração DESLIGADA: aqui o servidor é simulado só nesta rota).
  await page.route(`**/api/mapa/areas/${area.id}/analises-satelitais/ndvi`, (rota) => rota.fulfill({
    status: 503, contentType: "application/json",
    body: JSON.stringify({ error: { code: "CONSULTA_INDISPONIVEL", message: "A análise por satélite está desligada neste ambiente.", details: { motivo: "configuracao" } } })
  }));
  await page.goto("/mapa-geral");
  await page.getByTestId("mapa-item-area").filter({ hasText: nome }).click();
  const painel = page.getByTestId("mapa-area-selecionada");
  await painel.getByTestId("mapa-ndvi-analisar").click();
  await expect(painel.getByTestId("mapa-ndvi-aviso")).toHaveText("A análise por satélite está ligada, mas a credencial do Copernicus não está configurada no servidor da API.");
  await limparAreas(page);
});

// ---------- SAT-07 (decisão 298): gradiente por pixel ----------

/** PNG cinza 4×4 escrito com o mesmo contrato da SAT-06 (byte 0 = sem dado). */
const PNG_NDVI_4X4 = Buffer.from(
  // pixels: [0,80,200,0 / 0,40,220,0 / 0,120,160,0 / 0,0,0,0] via escreverPngCinza8
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAAAAACMmsGiAAAAGUlEQVR4nGNgCDjBwMCgcYeBgaFiAQMYAAAndAM1iF6PqwAAAABJRU5ErkJggg==",
  "base64"
);

test("Mapa geral SAT-07: gradiente por pixel, sem POST ao abrir, troca de modo sem rede, miniatura e gerar deliberado", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await limparAreas(page);
  const empresa = await empresaDaSessao(page);
  const quadrado = (lng: number, lat: number) => ({ type: "Polygon", coordinates: [[[lng, lat], [lng + 0.01, lat], [lng + 0.01, lat + 0.01], [lng, lat + 0.01], [lng, lat]]] });
  const comRaster = await api<Area>(page, "POST", "/api/resources/areas", {
    empresa_id: empresa, name: uniq("PIX VERDE").toLocaleUpperCase("pt-BR"), land_use: "pastagem", status: "ativa", tenure: "propria",
    area_ha: "100", usable_area_ha: "100", color: "#2563eb", geometria: quadrado(-55.5, -15.3)
  });
  const semRaster = await api<Area>(page, "POST", "/api/resources/areas", {
    empresa_id: empresa, name: uniq("PIX CINZA").toLocaleUpperCase("pt-BR"), land_use: "pastagem", status: "ativa", tenure: "propria",
    area_ha: "100", usable_area_ha: "100", color: "#2563eb", geometria: quadrado(-55.48, -15.3)
  });
  semearAnalise(comRaster.id, "2026-09-01T00:00:00Z", "2026-09-12T12:00:00Z", { inicio: "2026-09-10T00:00:00Z", media: "0.55" });
  semearAnalise(semRaster.id, "2026-09-01T00:00:00Z", "2026-09-12T12:00:00Z", { inicio: "2026-09-10T00:00:00Z", media: "0.55" });
  const analiseCom = sql(`select id from erp.analises_satelitais where area_id = '${comRaster.id}' and situacao = 'concluida' order by observacao_inicio desc limit 1`);
  const analiseSem = sql(`select id from erp.analises_satelitais where area_id = '${semRaster.id}' and situacao = 'concluida' order by observacao_inicio desc limit 1`);
  expect(analiseCom).toMatch(FORMA_UUID);
  expect(analiseSem).toMatch(FORMA_UUID);

  const rasterId = "11111111-1111-4111-8111-111111111111";
  const rasterNovoId = "22222222-2222-4222-8222-222222222222";
  const cantos: [[number, number], [number, number], [number, number], [number, number]] = [
    [-55.5, -15.29], [-55.49, -15.29], [-55.49, -15.3], [-55.5, -15.3]
  ];
  const dto = {
    id: rasterId, analise_id: analiseCom, area_id: comRaster.id, indice: "ndvi", tipo: "valores",
    data_imagem: "2026-09-10", largura: 4, altura: 4, cantos_lnglat: cantos,
    escala_min: -0.2, escala_max: 1, resolucao_m: 10, resolucao_reduzida: false,
    url_assinada: `/api/mapa/rasters/${rasterId}/arquivo?t=teste`, expira_em: "2099-01-01T00:00:00.000Z"
  };

  let postsRaster = 0;
  let getsArquivo = 0;
  let getsLista = 0;
  const rastersPorArea = new Map<string, typeof dto>([[comRaster.id, dto]]);
  const corsPng = {
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS"
  };

  // Arquivo ANTES da listagem (rota mais específica primeiro).
  await page.route(/\/api\/mapa\/rasters\/[^/]+\/arquivo/, async (rota) => {
    if (rota.request().method() === "OPTIONS") {
      await rota.fulfill({ status: 204, headers: corsPng });
      return;
    }
    getsArquivo += 1;
    await rota.fulfill({ status: 200, contentType: "image/png", headers: corsPng, body: PNG_NDVI_4X4 });
  });
  await page.route(/\/api\/mapa\/rasters(\?|$)/, async (rota) => {
    if (rota.request().method() !== "GET") return rota.continue();
    getsLista += 1;
    const u = new URL(rota.request().url());
    const ids = (u.searchParams.get("area_ids") ?? "").split(",").filter(Boolean);
    const itens = ids.flatMap((id) => {
      const r = rastersPorArea.get(id);
      return r ? [r] : [];
    });
    await rota.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ itens, pagina: 1, tamanho: 50, tem_mais: false })
    });
  });
  await page.route(`**/api/mapa/analises-satelitais/${analiseSem}/raster`, async (rota) => {
    if (rota.request().method() !== "POST") return rota.continue();
    postsRaster += 1;
    const gerado = {
      ...dto,
      id: rasterNovoId,
      analise_id: analiseSem,
      area_id: semRaster.id,
      cantos_lnglat: [[-55.48, -15.29], [-55.47, -15.29], [-55.47, -15.3], [-55.48, -15.3]] as typeof cantos,
      url_assinada: `/api/mapa/rasters/${rasterNovoId}/arquivo?t=teste`,
      resolucao_reduzida: true,
      resolucao_m: 20
    };
    rastersPorArea.set(semRaster.id, gerado);
    await rota.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ raster: gerado, reutilizada: true }) });
  });
  await page.route(`**/api/mapa/areas/${comRaster.id}/analises-satelitais/ultima**`, async (rota) => {
    await rota.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ analise: { id: analiseCom }, ultima_observacao_util: { id: analiseCom } }) });
  });
  await page.route(`**/api/mapa/areas/${semRaster.id}/analises-satelitais/ultima**`, async (rota) => {
    await rota.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ analise: { id: analiseSem }, ultima_observacao_util: { id: analiseSem } }) });
  });

  await page.goto("/mapa-geral");
  await expect(page.getByTestId("mapa-item-area")).toHaveCount(2);
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __mapaManejoE2E?: unknown }).__mapaManejoE2E)), { timeout: 30_000 }).toBe(true);
  // Espera a listagem mockada e o bitmap colorido antes de exigir o modo.
  await expect.poll(() => getsLista, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(() => getsArquivo, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => page.evaluate(() => {
    const e = (window as unknown as { __mapaNdviE2E?: { modo?: string; rasters?: Record<string, { temImagem: boolean; erro?: string | null }> } }).__mapaNdviE2E;
    return e ? { modo: e.modo, rasters: e.rasters } : null;
  }), { timeout: 30_000 }).toEqual(expect.objectContaining({
    modo: "pixel",
    rasters: expect.objectContaining({ [comRaster.id]: expect.objectContaining({ temImagem: true }) })
  }));
  await expect(page.getByTestId("mapa-cor-pixel")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("mapa-legenda-gradiente")).toBeVisible();
  await expect(page.getByTestId("mapa-legenda-ndvi")).toContainText("Não é biomassa");
  expect(postsRaster, "abrir a tela NÃO dispara POST de raster").toBe(0);
  const getsArquivoAposCarga = getsArquivo;
  const getsListaAposCarga = getsLista;

  await expect.poll(async () => page.evaluate(() => {
    const e = (window as unknown as { __mapaNdviE2E: { amostrar: (id: string, x: number, y: number) => number[] | null; rasters: Record<string, { temImagem: boolean }> } }).__mapaNdviE2E;
    const id = Object.keys(e.rasters).find((k) => e.rasters[k]?.temImagem);
    if (!id) return null;
    const a = e.amostrar(id, 1, 0);
    const b = e.amostrar(id, 2, 0);
    if (!a || !b) return null;
    return { a, b, dif: a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2], alphaA: a[3], alphaB: b[3] };
  }), { timeout: 20_000 }).toMatchObject({ dif: true, alphaA: 255, alphaB: 255 });

  const alpha0 = await page.evaluate(() => {
    const e = (window as unknown as { __mapaNdviE2E: { amostrar: (id: string, x: number, y: number) => number[] | null; rasters: Record<string, { temImagem: boolean }> } }).__mapaNdviE2E;
    const id = Object.keys(e.rasters).find((k) => e.rasters[k]?.temImagem)!;
    return e.amostrar(id, 0, 0)?.[3] ?? null;
  });
  expect(alpha0, "byte 0 → alfa 0").toBe(0);

  await page.getByTestId("mapa-cor-area").click();
  await expect(page.getByTestId("mapa-cor-area")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("mapa-cor-pixel").click();
  await expect(page.getByTestId("mapa-cor-pixel")).toHaveAttribute("aria-pressed", "true");
  expect(getsArquivo, "troca de modo não baixa PNG de novo").toBe(getsArquivoAposCarga);
  expect(getsLista, "troca de modo não lista de novo").toBe(getsListaAposCarga);

  await expect.poll(() => page.evaluate((id) => {
    const m = (window as unknown as { __mapaManejoE2E: { querySourceFeatures: (s: string) => { properties: Record<string, unknown> }[] } }).__mapaManejoE2E;
    const f = m.querySourceFeatures("areas").find((x) => x.properties["id"] === id);
    return f ? Number(f.properties["opacidade_fill"]) : null;
  }, semRaster.id)).toBeLessThan(0.5);

  await page.getByTestId("mapa-item-area").filter({ hasText: comRaster.name }).click();
  const painel = page.getByTestId("mapa-area-selecionada");
  await expect(painel.getByTestId("mapa-ndvi-miniatura")).toBeVisible();
  await expect(painel.getByTestId("mapa-ndvi-raster-meta")).toContainText("10 m");
  await expect(painel.getByTestId("mapa-ndvi-gerar-imagem")).toHaveCount(0);

  await page.getByTestId("mapa-item-area").filter({ hasText: semRaster.name }).click();
  await expect(painel.getByTestId("mapa-ndvi-gerar-imagem")).toBeVisible({ timeout: 15_000 });
  await painel.getByTestId("mapa-ndvi-gerar-imagem").click();
  await expect(painel.getByTestId("mapa-ndvi-gerar-confirmacao")).toContainText("consome crédito");
  await painel.getByTestId("mapa-ndvi-gerar-confirmar").click();
  await expect(painel.getByTestId("mapa-ndvi-aviso")).toContainText("não houve custo");
  await expect(painel.getByTestId("mapa-ndvi-resolucao-reduzida")).toContainText("20 m");
  expect(postsRaster, "POST só no clique confirmado").toBe(1);

  await limparAreas(page);
});
