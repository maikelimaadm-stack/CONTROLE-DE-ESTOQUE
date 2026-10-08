import { test, expect, type Locator, type Page } from "@playwright/test";
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

/** O campo de data do sistema é o calendário do modelo: digita-se dd/mm/aaaa no campo visível e Enter confirma. */
async function digitarData(campo: Locator, ddmmaaaa: string) {
  const visivel = campo.locator('input[type="text"]');
  await visivel.fill(ddmmaaaa);
  await visivel.press("Enter");
}

/** Painel lateral / bottom sheet da área — fechar antes de clicar na lista/toolbar. */
async function fecharDialogArea(page: Page) {
  const painel = page.getByTestId("mapa-area-selecionada");
  if (await painel.count() === 0) return;
  const fechar = page.getByTestId("dialog-area-fechar");
  if (await fechar.isVisible().catch(() => false)) await fechar.click();
  else await page.keyboard.press("Escape");
  await expect(painel).toHaveCount(0);
}

/** Família, índice e Pixel/Área ficam em Mais opções → Dados técnicos (visível). */
async function entrarDadosTecnicos(page: Page) {
  await fecharDialogArea(page);
  const mais = page.getByTestId("mapa-mais-opcoes");
  await expect(mais).toBeVisible({ timeout: 30_000 });
  if ((await page.getByTestId("mapa-mais-opcoes-painel").count()) === 0) await mais.click();
  await expect(page.getByTestId("mapa-mais-opcoes-painel")).toBeVisible();
  const btn = page.getByTestId("mapa-dados-tecnicos");
  await expect(btn).toBeVisible();
  if ((await btn.getAttribute("aria-pressed")) !== "true") await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("mapa-barra-tecnica")).toBeVisible();
}

/** Volta ao modo operacional (temas) — espelho de entrarDadosTecnicos. */
async function sairDadosTecnicos(page: Page) {
  await fecharDialogArea(page);
  const mais = page.getByTestId("mapa-mais-opcoes");
  await expect(mais).toBeVisible({ timeout: 30_000 });
  if ((await page.getByTestId("mapa-mais-opcoes-painel").count()) === 0) await mais.click();
  const btn = page.getByTestId("mapa-dados-tecnicos");
  await expect(btn).toBeVisible();
  if ((await btn.getAttribute("aria-pressed")) === "true") await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", "false");
}

/** Seleciona na lista após garantir que nenhum Dialog cobre a UI. */
async function selecionarAreaNaLista(page: Page, nome: string | RegExp) {
  await fecharDialogArea(page);
  await page.getByTestId("mapa-item-area").filter({ hasText: nome }).click();
  await expect(page.getByTestId("mapa-area-selecionada")).toBeVisible();
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

  // Mapa geral continua em /mapa-geral (listagem + satélite); /mapa-de-manejo é o Mapa de Manejo (só pastos)
  await page.goto("/mapa-geral");
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

  // clique NO POLÍGONO (centro projetado pelo próprio mapa) abre painel lateral — só leitura
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __mapaManejoE2E?: unknown }).__mapaManejoE2E)), { timeout: 30_000 }).toBe(true);
  // rótulos só em hover/selecionada — o polígono no canvas é a prova de enquadramento
  await expect(page.getByTestId("mapa-rotulo-area"), "sem hover/seleção não há rótulos permanentes").toHaveCount(0);
  const centro = await page.evaluate(({ lng, lat }) => {
    const m = (window as unknown as { __mapaManejoE2E: { project: (ll: [number, number]) => { x: number; y: number } } }).__mapaManejoE2E;
    return m.project([lng + 0.005, lat + 0.005]);
  }, { lng, lat });
  await expect.poll(async () => page.evaluate(({ x, y }) => {
    const m = (window as unknown as { __mapaManejoE2E: { queryRenderedFeatures: (p: [number, number], o: { layers: string[] }) => unknown[] } }).__mapaManejoE2E;
    return m.queryRenderedFeatures([x, y], { layers: ["areas-fill"] }).length;
  }, centro), { timeout: 15_000 }).toBe(1);
  const caixa = await page.getByTestId("mapa-canvas").boundingBox();
  expect(caixa).not.toBeNull();
  await page.mouse.click(caixa!.x + centro.x, caixa!.y + centro.y);
  const resumo = page.getByTestId("mapa-area-selecionada");
  await expect(resumo).toBeVisible();
  // Detalhe operacional = painel não modal (aside), não Dialog central
  await expect(resumo).toHaveJSProperty("tagName", "ASIDE");
  await expect(resumo).toHaveAttribute("aria-label", new RegExp(`Detalhe de ${nome}`, "i"));
  await expect(resumo).toContainText(nome);
  await expect(resumo).toContainText("120");
  await expect(resumo.getByTestId("mapa-abrir-cadastro")).toHaveAttribute("href", `/cadastros/areas/${criada.id}`);
  // área nunca analisada: experiência padrão Condição do pasto (sem seletor de índice)
  await expect(resumo.getByTestId("condicao-pasto-sem-analise")).toBeVisible();
  await expect(resumo.getByTestId("mapa-ndvi-area"), "painel legado NDVI ausente").toHaveCount(0);
  await expect(page.getByTestId("mapa-barra-tecnica")).toHaveCount(0);
  await expect(page.getByTestId("mapa-indice-ndvi")).toHaveCount(0);
  await expect(page.getByTestId("mapa-cor-cadastro")).toHaveCount(0);
  await expect(page.getByTestId("mapa-legenda-ndvi")).toHaveCount(0);
  await expect(page.getByTestId("legenda-condicao-pasto")).toBeVisible();
  await expect(page.getByTestId("mapa-rotulo-area").filter({ hasText: nome }), "selecionada mostra o nome").toBeVisible();
  // Dados técnicos pelo rodapé do painel (abre modo técnico da mesma área)
  await resumo.getByTestId("condicao-pasto-dados-tecnicos").click();
  await expect(page.getByTestId("mapa-dados-tecnicos")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("mapa-area-selecionada").getByTestId("condicao-area").getByTestId("condicao-sem-analise")).toContainText("não tem análise para o contorno atual");

  // "Abrir cadastro" leva à ficha de Cadastro de Área, com o mapa do contorno nela
  await page.getByTestId("mapa-area-selecionada").getByTestId("mapa-abrir-cadastro").click();
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
    select a.organization_id, a.empresa_id, a.id, 'copernicus_cdse', 'sentinel-2-l2a', 'ndvi', 'pastagem-essencial-v2', encode(sha256(convert_to(a.geometria::text, 'UTF8')), 'hex'),
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
    if (u.includes("/analises-satelitais") || u.includes("/mapa/rasters") || u.includes("/satelite/areas")) {
      pedidosSat.push(`${r.method()} ${u}`);
    }
  });
  const resumo = page.waitForResponse((r) => {
    const u = new URL(r.url());
    return u.pathname.includes("/api/mapa/analises-satelitais/resumo") && r.request().method() === "GET"
      && u.searchParams.get("contexto") === "condicao";
  });
  await page.goto("/mapa-geral");
  expect((await resumo).status(), "o mapa pede o resumo operacional (contexto=condicao)").toBe(200);
  await expect(page.getByTestId("mapa-item-area")).toHaveCount(3);
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __mapaManejoE2E?: unknown }).__mapaManejoE2E)), { timeout: 30_000 }).toBe(true);
  await expect(page.getByTestId("mapa-barra-tecnica")).toHaveCount(0);
  await entrarDadosTecnicos(page);

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
  expect(pedidosSat.filter((p) => p.includes("/analises-satelitais/resumo")).length).toBeGreaterThanOrEqual(1);
  expect(pedidosSat.some((p) => p.startsWith("GET /api/mapa/rasters")), "lista rasters sem gerar").toBe(true);

  // Painel único (Dialog central): Condição da Área (R2). Sem NdviDaArea legado. Bundle incompleto → sem observação útil.
  await selecionarAreaNaLista(page, verde.name);
  const painel = page.getByTestId("mapa-area-selecionada");
  const condicao = painel.getByTestId("condicao-area");
  await expect(condicao).toBeVisible();
  await expect(painel.getByTestId("mapa-ndvi-area"), "painel legado NDVI não entra no Mapa geral").toHaveCount(0);
  await expect(condicao.getByTestId("condicao-sem-analise")).toBeVisible();
  await expect(condicao.getByTestId("condicao-aviso-agronomico")).toContainText("não é diagnóstico");

  // SAT-BUNDLE-01B: análise individual removida do painel — só "Analisar áreas" na barra
  await expect(condicao.getByTestId("condicao-analisar-atual")).toHaveCount(0);
  await expect(condicao.getByTestId("condicao-gerar-raster")).toHaveCount(0);
  await expect(condicao.getByTestId("condicao-sem-analise-dica")).toContainText("Analisar áreas");
  expect(linhas(), "nada gravado").toBe(3);

  // área sem observação útil / nunca analisada: painel único sem número na lista
  await selecionarAreaNaLista(page, nublada.name);
  await expect(page.getByTestId("mapa-area-selecionada").getByTestId("condicao-area").getByTestId("condicao-sem-analise")).toBeVisible();
  await selecionarAreaNaLista(page, nunca.name);
  await expect(page.getByTestId("mapa-area-selecionada").getByTestId("condicao-area").getByTestId("condicao-sem-analise")).toBeVisible();

  // "Cor do cadastro": fecha o Dialog para alcançar a toolbar; a cor é EXATA.
  await selecionarAreaNaLista(page, verde.name);
  await expect.poll(() => corNoMapa(page, verde.id), { timeout: 15_000 }).toBe("#1a9850");
  await fecharDialogArea(page);
  await page.getByTestId("mapa-cor-cadastro").click();
  await expect(legenda).toHaveCount(0);
  await expect(page.getByTestId("mapa-atribuicao-copernicus-mapa"), "a lista continua com o NDVI: a atribuição fica").toHaveText("Contains modified Copernicus Sentinel data 2026");
  await expect.poll(() => corNoMapa(page, verde.id)).toBe("#306bec");
  await page.getByTestId("mapa-cor-area").click();
  await expect.poll(() => corNoMapa(page, verde.id)).toBe("#1a9850");

  // contorno redesenhado DEPOIS da análise: a análise do contorno anterior NÃO atravessa a API (nada de número "emprestado"),
  // a área fica sem análise e CINZA no modo por área — nunca na cor do cadastro, que só aparece se o usuário a escolhe
  sql(`update erp.areas set geometria = '${JSON.stringify(quadrado(-55.3005, -15.2005))}'::jsonb where id = '${verde.id}'`);
  await page.reload();
  await expect(page.getByTestId("mapa-item-area").filter({ hasText: verde.name })).toBeVisible();
  // Reload devolve a experiência padrão Condição; o painel `condicao-area` mora em Dados técnicos.
  await entrarDadosTecnicos(page);
  await selecionarAreaNaLista(page, verde.name);
  await expect(page.getByTestId("mapa-area-selecionada").getByTestId("condicao-area").getByTestId("condicao-sem-analise")).toBeVisible();
  await fecharDialogArea(page);
  await expect(page.getByTestId("mapa-item-area").filter({ hasText: verde.name }).getByTestId("mapa-item-ndvi")).toHaveCount(0);
  await page.getByTestId("mapa-cor-area").click();
  await expect.poll(() => corNoMapa(page, verde.id), { timeout: 15_000 }).toBe("#94a3b8");

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

test("Mapa geral: painel técnico sem 'Analisar área atual' — ação única é Analisar áreas (01B)", async ({ page }) => {
  await login(page);
  await limparAreas(page);
  const empresa = await empresaDaSessao(page);
  const nome = uniq("NDVI SEM CREDENCIAL").toLocaleUpperCase("pt-BR");
  await api<Area>(page, "POST", "/api/resources/areas", {
    empresa_id: empresa, name: nome, land_use: "pastagem", status: "ativa", tenure: "propria", area_ha: "100", usable_area_ha: "100", color: "#2563eb",
    geometria: { type: "Polygon", coordinates: [[[-55.4, -15.2], [-55.39, -15.2], [-55.39, -15.19], [-55.4, -15.19], [-55.4, -15.2]]] }
  });
  await page.goto("/mapa-geral");
  await entrarDadosTecnicos(page);
  await selecionarAreaNaLista(page, nome);
  const painel = page.getByTestId("mapa-area-selecionada");
  const condicao = painel.getByTestId("condicao-area");
  await expect(condicao.getByTestId("condicao-analisar-atual")).toHaveCount(0);
  await expect(condicao.getByTestId("condicao-gerar-raster")).toHaveCount(0);
  await expect(condicao.getByTestId("condicao-nova-consulta")).toBeVisible();
  await expect(page.getByTestId("mapa-nova-consulta")).toBeVisible();
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
  // CondicaoDaArea exige o resumo do bundle (R2: painel único). Mock com observação útil e ids das análises semeadas.
  const resumoPixel = (areaId: string, analiseId: string) => ({
    area_id: areaId, versao_metodo: "pastagem-essencial-v2", ultima_tentativa: null, aviso: "x", geometria_sha256: "c".repeat(64),
    tendencia: null,
    ultima_observacao_util: {
      observacao_inicio: "2026-09-10T00:00:00.000Z", observacao_fim: "2026-09-11T00:00:00.000Z", do_poligono_atual: true,
      qualidade: {
        estado: "boa", cobertura_valida: "0.9000", indice_limitante: "ndvi", cloud_ratio: "0.0500", motivo: null,
        coberturas_por_indice: { ndvi: "0.9000", evi2: "0.9000", ndre: "0.9000", ndmi: "0.9000", msavi2: "0.9000", bsi: "0.9000" }
      },
      indices: Object.fromEntries(
        (["ndvi", "evi2", "ndre", "ndmi", "msavi2", "bsi"] as const).map((i) => [i, {
          id: i === "ndvi" ? analiseId : `analise-${i}-${areaId.slice(0, 8)}`,
          situacao: "concluida", motivo_qualidade: null, observacao_inicio: "2026-09-10T00:00:00.000Z", observacao_fim: "2026-09-11T00:00:00.000Z",
          valor_medio: "0.55", valor_minimo: "0.35", valor_maximo: "0.75", desvio_padrao: "0.05", cobertura_valida: "0.9000",
          resolucao_m: "10", resolucao_nativa_m: "10", comparacao_observacao_anterior: null
        }])
      ),
      indicadores_derivados: {
        versao: "1", experimental: true, aviso: "x", vegetacao_ativa_estimada: "media", baixa_cobertura_estimada: "baixa",
        solo_exposto_estimado: "baixo", condicao_hidrica: "media", resposta_vegetacao: "Resposta média de vegetação",
        fracoes_histograma: { vegetacao_ativa: 0.5, baixa_cobertura: 0.2, solo_exposto: 0.05 }
      }
    }
  });
  await page.route(`**/api/satelite/areas/${comRaster.id}/resumo`, async (rota) => {
    if (rota.request().method() !== "GET") return rota.continue();
    await rota.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(resumoPixel(comRaster.id, analiseCom)) });
  });
  await page.route(`**/api/satelite/areas/${semRaster.id}/resumo`, async (rota) => {
    if (rota.request().method() !== "GET") return rota.continue();
    await rota.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(resumoPixel(semRaster.id, analiseSem)) });
  });

  await page.goto("/mapa-geral");
  await expect(page.getByTestId("mapa-item-area")).toHaveCount(2);
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __mapaManejoE2E?: unknown }).__mapaManejoE2E)), { timeout: 30_000 }).toBe(true);
  await entrarDadosTecnicos(page);
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

  await selecionarAreaNaLista(page, comRaster.name);
  const painel = page.getByTestId("mapa-area-selecionada");
  const condicao = painel.getByTestId("condicao-area");
  await expect(condicao).toBeVisible();
  await expect(condicao.getByTestId("condicao-raster-info")).toContainText("10 m");
  await expect(condicao.getByTestId("condicao-gerar-raster")).toHaveCount(0);
  await expect(painel.getByTestId("mapa-ndvi-area"), "painel legado NDVI ausente").toHaveCount(0);

  // SAT-BUNDLE-01B: geração manual de raster removida da UX — backend legado permanece
  await selecionarAreaNaLista(page, semRaster.name);
  const painelSem = page.getByTestId("mapa-area-selecionada");
  await expect(painelSem.getByTestId("condicao-gerar-raster")).toHaveCount(0);
  await expect(painelSem.getByTestId("condicao-nova-consulta")).toBeVisible();
  expect(postsRaster, "sem Gerar raster na UI → zero POST Process").toBe(0);

  await limparAreas(page);
});

// ---------- SATÉLITE COMPLETO (decisão 301): camadas por índice, Condição da área, Nova consulta, Comparar ----------

test("Mapa geral — condição da área: barra de camadas, só o índice ativo na rede, painel sem diagnóstico, Nova consulta com progresso e Comparar", async ({ page }) => {
  test.setTimeout(150_000);
  await login(page);
  await limparAreas(page);
  const empresa = await empresaDaSessao(page);
  const area = await api<Area>(page, "POST", "/api/resources/areas", {
    empresa_id: empresa, name: uniq("CONDICAO").toLocaleUpperCase("pt-BR"), land_use: "pastagem", status: "ativa", tenure: "propria",
    area_ha: "100", usable_area_ha: "100", color: "#2563eb",
    geometria: { type: "Polygon", coordinates: [[[-55.7, -15.4], [-55.69, -15.4], [-55.69, -15.39], [-55.7, -15.39], [-55.7, -15.4]]] }
  });

  const HASH = "c".repeat(64);
  const indices = ["ndvi", "evi2", "ndre", "ndmi", "msavi2", "bsi"] as const;
  const resumoIndice = (id: string, media: string) => ({
    id: `analise-${id}`, situacao: "concluida", motivo_qualidade: null, observacao_inicio: "2026-09-10T13:00:00.000Z", observacao_fim: "2026-09-10T13:00:01.000Z",
    valor_medio: media, valor_minimo: "0.10", valor_maximo: "0.90", desvio_padrao: "0.08", cobertura_valida: "0.8100", resolucao_m: "20", resolucao_nativa_m: "10",
    comparacao_observacao_anterior: { anterior_id: "x", anterior_valor_medio: "0.60", anterior_observacao_inicio: "2026-08-10T13:00:00.000Z", delta_percentual: 16.7, tendencia: "subiu" }
  });
  const resumo = {
    area_id: area.id, versao_metodo: "pastagem-essencial-v2", ultima_tentativa: null, aviso: "x", geometria_sha256: HASH,
    tendencia: {
      ultima: { periodo: "ultima", delta: -0.35, pontos: 3 },
      "30d": { periodo: "30d", delta: null, pontos: 1 },
      "90d": { periodo: "90d", delta: 0, pontos: 3 }
    },
    ultima_observacao_util: {
      observacao_inicio: "2026-09-10T13:00:00.000Z", observacao_fim: "2026-09-10T13:00:01.000Z", do_poligono_atual: true,
      qualidade: {
        estado: "boa", cobertura_valida: "0.8100", indice_limitante: "ndmi", cloud_ratio: "0.0500", motivo: null,
        coberturas_por_indice: { ndvi: "0.9300", evi2: "0.9300", ndre: "0.8500", ndmi: "0.8100", msavi2: "0.9300", bsi: "0.8300" }
      },
      indices: Object.fromEntries(indices.map((i) => [i, resumoIndice(i, i === "bsi" ? "0.04" : "0.72")])),
      indicadores_derivados: {
        versao: "1", experimental: true, aviso: "x", vegetacao_ativa_estimada: "alta", baixa_cobertura_estimada: "baixa", solo_exposto_estimado: "baixo",
        condicao_hidrica: "media", resposta_vegetacao: "Alta resposta de vegetação",
        fracoes_histograma: { vegetacao_ativa: 0.62, baixa_cobertura: 0.2, solo_exposto: 0.05 }
      }
    }
  };
  const item = (dia: string, media: string) => ({
    id: `h-${dia}`, situacao: "concluida", motivo_qualidade: null, geometria_sha256: HASH, do_poligono_atual: true,
    observacao_inicio: `${dia}T13:00:00.000Z`, observacao_fim: `${dia}T13:00:01.000Z`, valor_medio: media, valor_minimo: null, valor_maximo: null,
    desvio_padrao: null, cobertura_valida: "0.9000", criado_em: `${dia}T20:00:00.000Z`,
    histograma: { bins: [{ lowEdge: 0, highEdge: 0.5, count: 10 }, { lowEdge: 0.5, highEdge: 1, count: 30 }], underflowCount: 0, overflowCount: 0 }
  });
  const historico = (indice: string) => {
    const cai = indice === "ndvi" || indice === "ndre";
    const serie = cai ? ["0.70", "0.70", "0.35"] : ["0.30", "0.30", "0.30"];
    return { area_id: area.id, indice, geometria_sha256: HASH, do_poligono_atual: true, itens: [item("2026-09-10", serie[2]!), item("2026-08-10", serie[1]!), item("2026-07-10", serie[0]!)] };
  };

  const cors = { "Access-Control-Allow-Origin": "*" };
  const json = (corpo: unknown, status = 200) => ({ status, contentType: "application/json", headers: cors, body: JSON.stringify(corpo) });
  const listagensRaster: string[] = [];
  const corposConsulta: { alvo: { tipo: string; area_ids?: string[] }; periodo: Record<string, unknown>; indices: string[]; confirmar: boolean }[] = [];
  const datasListadas: string[] = [];
  let postsRasterAB = 0;
  let pollsConsulta = 0;
  const consultaId = "33333333-3333-4333-8333-333333333333";
  const dtoConsulta = (situacao: string, concluidos: number) => ({
    id: consultaId, situacao, total_itens: 2, total_concluidos: concluidos, total_falhos: 0, total_reaproveitados: 0,
    criado_em: "2026-10-05T12:00:00.000Z", concluida_em: situacao === "concluida" ? "2026-10-05T12:00:09.000Z" : null
  });

  await page.route(/\/api\/mapa\/rasters(\?|$)/, async (rota) => {
    if (rota.request().method() !== "GET") return rota.continue();
    const params = new URL(rota.request().url()).searchParams;
    listagensRaster.push(params.get("indice") ?? "");
    datasListadas.push(params.get("data_imagem") ?? "");
    await rota.fulfill(json({ itens: [], pagina: 1, tamanho: 200, tem_mais: false }));
  });
  await page.route(/\/api\/mapa\/analises-satelitais\/[^/]+\/raster$/, async (rota) => {
    if (rota.request().method() === "POST") postsRasterAB += 1;
    await rota.continue();
  });
  await page.route(`**/api/satelite/areas/${area.id}/resumo`, async (rota) => {
    if (rota.request().method() !== "GET") return rota.continue();
    await rota.fulfill(json(resumo));
  });
  await page.route(new RegExp(`/api/satelite/areas/${area.id}/historico`), async (rota) => {
    if (rota.request().method() !== "GET") return rota.continue();
    await rota.fulfill(json(historico(new URL(rota.request().url()).searchParams.get("indice") ?? "ndvi")));
  });
  await page.route(/\/api\/satelite\/consultas(\?|$)/, async (rota) => {
    if (rota.request().method() !== "POST") return rota.continue();
    const corpo = rota.request().postDataJSON() as (typeof corposConsulta)[number];
    corposConsulta.push(corpo);
    if (!corpo.confirmar) {
      await rota.fulfill(json({
        total_itens: 2, reaproveitados: 0, novos: 2, estimativa_creditos: { minimo: "0.10", maximo: "0.30" }, saldo_creditos_mes: "50.00",
        excede_orcamento: false, empresa_id: empresa, areas_ignoradas: []
      }));
      return;
    }
    await rota.fulfill(json({ consulta: dtoConsulta("pendente", 0), total_itens: 2, reaproveitados: 0, novos: 2, areas_ignoradas: [] }, 201));
  });
  await page.route(/\/api\/satelite\/consultas\/[^/?]+/, async (rota) => {
    if (rota.request().method() !== "GET") return rota.continue();
    pollsConsulta += 1;
    const concluida = pollsConsulta > 1;
    await rota.fulfill(json({ consulta: dtoConsulta(concluida ? "concluida" : "executando", concluida ? 2 : 1), itens: [], pagina: 1, tamanho: 1, tem_mais: true }));
  });

  await page.goto("/mapa-geral");
  await expect(page.getByTestId("mapa-item-area")).toHaveCount(1);

  const barra = page.getByTestId("mapa-barra-camadas");
  await expect(barra).toBeVisible({ timeout: 30_000 });
  await expect(barra.getByTestId("mapa-barra-tecnica")).toHaveCount(0);
  await expect(barra.getByTestId("mapa-grupo-indice")).toHaveCount(0);
  await expect(barra.getByTestId("mapa-grupo-camada")).toHaveCount(0);
  await expect(barra.getByTestId("mapa-nova-consulta")).toHaveText("Analisar áreas");
  await expect(barra.getByTestId("mapa-grupo-opacidade")).toHaveCount(0);
  await expect(page.getByTestId("legenda-condicao-pasto")).toBeVisible();
  await entrarDadosTecnicos(page);
  await expect(barra.getByTestId("mapa-grupo-base")).toContainText(/Satélite|chave do Google/);
  for (const [grupo, texto] of [
    ["mapa-grupo-camada", "Cobertura/Solo"], ["mapa-grupo-indice", "NDVI"], ["mapa-grupo-data", "Última imagem útil"],
    ["mapa-grupo-render", "Pixel real"], ["mapa-grupo-opacidade", "70%"], ["mapa-grupo-acao", "Analisar áreas"]
  ] as const) await expect(barra.getByTestId(grupo)).toContainText(texto);
  await expect(barra.getByTestId("mapa-camada-vigor")).toHaveAttribute("aria-pressed", "true");
  await expect(barra.getByTestId("mapa-indice-evi2")).toBeVisible();
  await expect(barra.getByTestId("mapa-indice-ndmi"), "NDMI é da família Umidade, não do Vigor").toHaveCount(0);

  // DATA: "Última imagem útil" por padrão (sem data_imagem na rede); sem área aberta não há datas para escolher
  const seletorData = barra.getByTestId("mapa-data-camada");
  await expect(seletorData).toHaveValue("ultima");
  await expect(seletorData.locator("option")).toHaveCount(1);
  expect(datasListadas.filter(Boolean), "a última imagem útil não manda data_imagem").toEqual([]);

  // só o índice ativo vai à rede: trocar de camada pede o índice novo, nunca os seis
  await expect.poll(() => listagensRaster.includes("ndvi")).toBe(true);
  await barra.getByTestId("mapa-camada-umidade").click();
  await expect(barra.getByTestId("mapa-indice-ndmi")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => listagensRaster.includes("ndmi")).toBe(true);
  expect(listagensRaster.filter((i) => !["ndvi", "ndmi"].includes(i)), "nenhum outro índice foi pedido").toEqual([]);
  // a cor por área vale para todos os índices; sem análise válida do NDMI a área fica cinza neutro — nunca no cadastro
  await expect(barra.getByTestId("mapa-cor-area")).toBeEnabled();
  await barra.getByTestId("mapa-cor-area").click();
  await expect(barra.getByTestId("mapa-cor-area")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate((id) => (window as unknown as { __mapaNdviE2E?: { indice: string; cores: Record<string, string> | null } }).__mapaNdviE2E?.cores?.[id] ?? null, area.id)).toBe("#94a3b8");
  await barra.getByTestId("mapa-camada-vigor").click();
  await expect(barra.getByTestId("mapa-indice-ndvi")).toHaveAttribute("aria-pressed", "true");

  // render e opacidade (valem no modo por pixel)
  await barra.getByTestId("mapa-cor-pixel").click();
  await expect(barra.getByTestId("mapa-render-nearest")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("mapa-render-aviso")).toHaveCount(0);
  await barra.getByTestId("mapa-render-linear").click();
  await expect(page.getByTestId("mapa-render-aviso")).toContainText("Pixel real");
  await barra.getByTestId("mapa-render-nearest").click();
  await expect(page.getByTestId("mapa-render-aviso")).toHaveCount(0);
  await barra.getByTestId("mapa-opacidade").fill("40");
  await expect(barra.getByTestId("mapa-opacidade-valor")).toHaveText("40%");

  // painel Condição da área (Dialog central em Dados técnicos)
  await selecionarAreaNaLista(page, area.name);
  const painel = page.getByTestId("mapa-area-selecionada");
  const condicao = painel.getByTestId("condicao-area");
  await expect(condicao.getByTestId("condicao-resposta-vegetacao")).toHaveText("Alta resposta de vegetação");
  await expect(condicao.getByTestId("condicao-qualidade-estado")).toHaveText("Boa");
  await expect(condicao.getByTestId("condicao-limitante")).toContainText("NDMI");
  await expect(condicao.getByTestId("condicao-solo-exposto")).toContainText("Solo exposto estimado: Baixo");
  await expect(condicao.getByTestId("condicao-indice-ndvi-valor")).toHaveText("0,72");
  await expect(condicao.getByTestId("condicao-aviso-agronomico")).toContainText("não é diagnóstico");
  await expect(condicao.getByTestId("condicao-anomalia-nivel")).toContainText("Possível alteração");
  await expect(condicao.getByTestId("condicao-vistoria")).toBeVisible();
  expect(await condicao.innerText(), "o painel não fala em praga nem em biomassa").not.toMatch(/praga|biomassa/i);

  // tendência do NDVI: delta nulo é "Dados insuficientes" (NULL ≠ 0); zero verdadeiro é "0,00"
  await expect(condicao.getByTestId("condicao-tendencia-ultima-valor")).toHaveText("−0,35");
  await expect(condicao.getByTestId("condicao-tendencia-30d-valor")).toHaveText("Dados insuficientes");
  await expect(condicao.getByTestId("condicao-tendencia-90d-valor")).toHaveText("0,00");

  // histórico por período (padrão 1 ano): as três observações do contorno atual
  await condicao.getByTestId("condicao-historico-abrir").click();
  await expect(condicao.getByTestId("condicao-historico-grafico")).toBeVisible();
  await expect(condicao.getByTestId("condicao-historico-item")).toHaveCount(3);
  await expect(condicao.getByTestId("condicao-historico-periodo")).toHaveValue("1a");
  await expect(condicao.getByTestId("condicao-historico-cobertura")).toContainText("histórico completo");
  await condicao.getByTestId("condicao-historico-periodo").selectOption("personalizado");
  await digitarData(condicao.getByTestId("condicao-historico-de"), "01/08/2026");
  await digitarData(condicao.getByTestId("condicao-historico-ate"), "31/08/2026");
  await expect(condicao.getByTestId("condicao-historico-item")).toHaveCount(1);
  await condicao.getByTestId("condicao-historico-periodo").selectOption("1a");
  await expect(condicao.getByTestId("condicao-historico-item")).toHaveCount(3);

  // DATA da camada: as datas úteis do histórico do índice ativo; escolher uma pede data_imagem e NUNCA troca de data sozinha
  await expect(seletorData.locator("option")).toHaveText([/Última imagem útil/, "10/09/2026", "10/08/2026", "10/07/2026"]);
  await seletorData.selectOption("2026-08-10");
  await expect.poll(() => datasListadas.includes("2026-08-10")).toBe(true);
  await expect(page.getByTestId("mapa-sem-imagem-data")).toContainText("Nenhuma outra data é usada no lugar");
  await expect(condicao.getByTestId("condicao-sem-imagem-data")).toContainText("10/08/2026");
  await expect(condicao.getByTestId("condicao-gerar-raster")).toHaveCount(0);
  await seletorData.selectOption("ultima");
  await expect(page.getByTestId("mapa-sem-imagem-data")).toHaveCount(0);

  // Comparar A × B (contorno único: compara)
  await condicao.getByTestId("condicao-comparar").click();
  const comparar = page.getByTestId("comparar-modal");
  await expect(comparar.getByTestId("comparar-tabela")).toBeVisible();
  await expect(comparar.getByTestId("comparar-linha-ndvi")).toBeVisible();
  await expect(comparar.getByTestId("comparar-bloqueada")).toHaveCount(0);
  await expect(comparar.getByTestId("comparar-histograma-a")).toBeVisible();
  await expect(comparar.getByTestId("comparar-histograma-b")).toBeVisible();
  // imagens A/B: nada gerado ainda; o botão existe, e o Process API só roda no clique confirmado (aqui não clicamos)
  await expect(comparar.getByTestId("comparar-imagem-a-ausente")).toBeVisible();
  await expect(comparar.getByTestId("comparar-imagem-b-ausente")).toBeVisible();
  await expect(comparar.getByTestId("comparar-gerar-imagem")).toBeVisible();
  expect(postsRasterAB, "nenhuma imagem é gerada sem o clique confirmado").toBe(0);
  await comparar.getByTestId("comparar-fechar").click();
  await expect(comparar).toHaveCount(0);

  // Analisar áreas: prévia automática (confirmar:false) + um clique (confirmar:true)
  await condicao.getByTestId("condicao-nova-consulta").click();
  const modal = page.getByTestId("consulta-modal");
  await expect(modal).toContainText("Analisar áreas");
  await expect(modal.getByTestId("consulta-selecao-empresa")).toBeChecked();
  const abrirAvancadas = async () => {
    if (await modal.getByTestId("consulta-periodo-tipo").count() === 0) {
      await modal.getByTestId("consulta-opcoes-avancadas-toggle").click();
    }
    await expect(modal.getByTestId("consulta-periodo-tipo")).toBeVisible();
  };
  // Mais opções fechadas; abrir para período "Uma data"
  await expect(modal.getByTestId("consulta-periodo-tipo")).toHaveCount(0);
  await abrirAvancadas();
  await modal.getByTestId("consulta-periodo-tipo").selectOption("data");
  await digitarData(modal.getByTestId("consulta-data"), "10/09/2026");
  await expect(modal.getByTestId("consulta-previa-creditos")).toContainText("créditos", { timeout: 10_000 });
  await expect.poll(() => corposConsulta.some((c) => c.confirmar === false && (c.periodo as { data?: string }).data === "2026-09-10")).toBe(true);
  // Trocar período: intervalo com cadência — nova prévia automática
  const nAntesIntervalo = corposConsulta.length;
  await modal.getByTestId("consulta-periodo-tipo").selectOption("intervalo");
  await digitarData(modal.getByTestId("consulta-de"), "01/07/2026");
  await digitarData(modal.getByTestId("consulta-ate"), "30/09/2026");
  await expect.poll(() => corposConsulta.length).toBeGreaterThan(nAntesIntervalo);
  expect(corposConsulta.some((c) => c.confirmar === false && JSON.stringify(c.periodo) === JSON.stringify({ tipo: "intervalo", de: "2026-07-01", ate: "2026-09-30", cadencia: "mensal" }))).toBe(true);
  // período padrão: mais recente → um clique Analisar áreas
  await modal.getByTestId("consulta-periodo-tipo").selectOption("mais_recente");
  await expect(modal.getByTestId("consulta-previa-creditos")).toContainText("créditos", { timeout: 10_000 });
  const nAntesConfirm = corposConsulta.length;
  await modal.getByTestId("consulta-confirmar").click();
  await expect(modal.getByTestId("consulta-progresso")).toBeVisible();
  await expect.poll(() => corposConsulta.length).toBeGreaterThan(nAntesConfirm);
  expect(corposConsulta.some((c) => c.confirmar === true)).toBe(true);
  await expect(modal.getByTestId("consulta-progresso")).toContainText("Concluída", { timeout: 20_000 });
  await modal.getByTestId("consulta-fechar").click();
  await expect(modal).toHaveCount(0);

  await limparAreas(page);
});

// ---------- SAT-COND-01: mapa categórico de condição do pasto ----------

test("Mapa geral SAT-COND-01: condição padrão, legenda ha/%, filtro, ESC, lista e Dados técnicos", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await limparAreas(page);
  const empresa = await empresaDaSessao(page);
  const quadrado = (lng: number, lat: number) => ({ type: "Polygon", coordinates: [[[lng, lat], [lng + 0.01, lat], [lng + 0.01, lat + 0.01], [lng, lat + 0.01], [lng, lat]]] });
  const pastoA = await api<Area>(page, "POST", "/api/resources/areas", {
    empresa_id: empresa, name: uniq("COND A").toLocaleUpperCase("pt-BR"), land_use: "pastagem", status: "ativa", tenure: "propria",
    area_ha: "80", usable_area_ha: "80", color: "#2563eb", geometria: quadrado(-55.6, -15.35)
  });
  const pastoB = await api<Area>(page, "POST", "/api/resources/areas", {
    empresa_id: empresa, name: uniq("COND B").toLocaleUpperCase("pt-BR"), land_use: "pastagem", status: "ativa", tenure: "propria",
    area_ha: "50", usable_area_ha: "50", color: "#2563eb", geometria: quadrado(-55.58, -15.35)
  });

  const classe = (codigo: number, id: string, nome: string, cor: string, ha: string, pct: string, pixels: number) => ({
    codigo, id, nome, cor, pixels, proporcao: "0.1", area_estimada_ha: ha, area_estimada_percentual: pct
  });
  const resumoA = {
    versao_classificador: "condicao-pasto-v2", experimental: true, resolucao_m: 20,
    area_total_ha: "80.00", area_lida_ha: "76.00", area_sem_leitura_ha: "4.00", cobertura_valida: "0.9500",
    pixels_universo: 100, pixels_sem_leitura: 5,
    classes: [
      classe(0, "sem_leitura", "Sem leitura", "#9E9E9E", "4.00", "5.0", 5),
      classe(1, "vegetacao_ativa_boa_cobertura", "Vegetação ativa · boa cobertura", "#1B5E20", "54.40", "68.0", 68),
      classe(2, "vegetacao_ativa_cobertura_moderada", "Vegetação ativa · cobertura moderada", "#7CB342", "12.00", "15.0", 15),
      classe(3, "baixa_cobertura", "Baixa cobertura", "#F9A825", "4.00", "5.0", 5),
      classe(4, "possivel_estresse_hidrico", "Possível estresse hídrico", "#EF6C00", "1.60", "2.0", 2),
      classe(5, "solo_exposto_estimado", "Solo exposto estimado", "#BF360C", "4.00", "5.0", 5),
      classe(6, "agua", "Água", "#1565C0", "0.00", "0.0", 0)
    ],
    area_potencialmente_produtiva_ha: "66.40", area_potencialmente_produtiva_percentual: "83.0",
    aviso: "Estimativa espectral", avisos: [] as string[]
  };
  const resumoB = {
    ...resumoA, area_total_ha: "50.00",
    classes: resumoA.classes.map((c) => c.codigo === 5
      ? { ...c, area_estimada_ha: "12.00", area_estimada_percentual: "24.0", pixels: 24 }
      : c.codigo === 1
        ? { ...c, area_estimada_ha: "20.00", area_estimada_percentual: "40.0", pixels: 40 }
        : c)
  };
  const dto = (areaId: string, mapaId: string, resumo: typeof resumoA, cantos: number[][]) => ({
    id: mapaId, area_id: areaId, mapa: "condicao_pasto", tipo: "classificacao", data_imagem: "2026-10-05",
    largura: 4, altura: 4, cantos_lnglat: cantos, resolucao_m: 20, resolucao_analitica_m: 20,
    geometria_sha256: "a".repeat(64), area_total_ha: resumo.area_total_ha, resumo,
    url_assinada: `/api/mapa/condicao-pasto/${mapaId}/arquivo?t=teste`,
    expira_em: "2099-01-01T00:00:00.000Z", versao_classificador: "condicao-pasto-v2"
  });
  const mapaA = "11111111-1111-4111-8111-111111111111";
  const mapaB = "22222222-2222-4222-8222-222222222222";

  const cors = { "Access-Control-Allow-Origin": "*" };
  await page.route(/\/api\/mapa\/condicao-pasto(\?|$)/, async (rota) => {
    if (rota.request().method() !== "GET") return rota.continue();
    const ids = new URL(rota.request().url()).searchParams.get("area_ids") ?? "";
    const itens = [];
    if (ids.includes(pastoA.id)) itens.push(dto(pastoA.id, mapaA, resumoA, [[-55.6, -15.34], [-55.59, -15.34], [-55.59, -15.35], [-55.6, -15.35]]));
    if (ids.includes(pastoB.id)) itens.push(dto(pastoB.id, mapaB, resumoB, [[-55.58, -15.34], [-55.57, -15.34], [-55.57, -15.35], [-55.58, -15.35]]));
    await rota.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ itens, pagina: 1, tamanho: 200, tem_mais: false }) });
  });
  await page.route(/\/api\/mapa\/condicao-pasto\/[^/]+\/arquivo/, async (rota) => {
    if (rota.request().method() === "OPTIONS") { await rota.fulfill({ status: 204, headers: cors }); return; }
    await rota.fulfill({ status: 200, contentType: "image/png", headers: cors, body: PNG_NDVI_4X4 });
  });

  await page.goto("/mapa-geral");
  await expect(page.getByTestId("mapa-barra-tecnica")).toHaveCount(0);
  await expect(page.getByTestId("mapa-indice-ndvi")).toHaveCount(0);
  const legenda = page.getByTestId("legenda-condicao-pasto");
  await expect(legenda).toBeVisible({ timeout: 30_000 });
  await expect(legenda.getByTestId("legenda-ha-solo_exposto_estimado")).toBeVisible();
  await expect(legenda.getByTestId("legenda-pct-vegetacao_ativa_boa_cobertura")).toBeVisible();
  await expect(page.getByTestId("mapa-item-badge")).toHaveCount(2);

  await page.getByTestId("legenda-classe-solo_exposto_estimado").click();
  await expect(page.getByTestId("dialog-classe-condicao")).toBeVisible();
  await expect(page.getByTestId("painel-classe-condicao")).toBeVisible();
  await expect(page.getByTestId("dialog-classe-condicao")).toContainText("Solo exposto estimado");
  await expect(page.getByTestId("mapa-item-area").nth(0)).toContainText(pastoB.name);

  await page.getByTestId("dialog-classe-fechar").click();
  await expect(page.getByTestId("dialog-classe-condicao")).toHaveCount(0);
  await expect(page.getByTestId("painel-classe-condicao")).toHaveCount(0);
  await expect(page.getByTestId("mapa-atualizando")).toHaveCount(0);

  // Reabre e fecha pelo rodapé (overlay do Dialog impede segundo clique na legenda)
  await page.getByTestId("legenda-classe-solo_exposto_estimado").click({ timeout: 30_000 });
  await expect(page.getByTestId("dialog-classe-condicao")).toBeVisible();
  await page.getByTestId("dialog-classe-fechar").click();
  await expect(page.getByTestId("dialog-classe-condicao")).toHaveCount(0);

  await selecionarAreaNaLista(page, pastoA.name);
  await expect(page.getByTestId("mapa-area-selecionada")).toBeVisible();
  await expect(page.getByTestId("painel-area-condicao")).toBeVisible();
  await expect(page.getByTestId("painel-area-condicao")).toContainText("%");
  await expect(page.getByTestId("condicao-area")).toHaveCount(0);
  await expect(page.getByTestId("condicao-pasto-analisar")).toHaveCount(0);
  await expect(page.getByTestId("condicao-pasto-gerar-mapa")).toHaveCount(0);

  await page.getByTestId("condicao-pasto-dados-tecnicos").click();
  await expect(page.getByTestId("mapa-indice-ndvi")).toBeVisible();
  await expect(page.getByTestId("mapa-indice-evi2")).toBeVisible();
  await expect(page.getByTestId("condicao-area")).toBeVisible();

  // Dialog técnico permanece aberto após Dados técnicos — fechar e voltar ao modo operacional pela toolbar
  await sairDadosTecnicos(page);
  await expect(page.getByTestId("mapa-indice-ndvi")).toHaveCount(0);
  await expect(page.getByTestId("legenda-condicao-pasto")).toBeVisible();

  await limparAreas(page);
});

