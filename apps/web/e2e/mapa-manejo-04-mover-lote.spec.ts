import { test, expect, type Locator, type Page, type Response } from "@playwright/test";
import { api, login, logout, uniq } from "./helpers";
import {
  CAMADAS,
  CAMINHO_OPERACIONAL,
  OPCOES_WEBGL,
  abrirMapaNasAreas,
  aguardarAreasNoMapa,
  aguardarMapaParado,
  areaDaResposta,
  centroideDaApi,
  contarRequisicoes,
  dadosDaFonte,
  deslocar,
  diaDaApi,
  enquadrar,
  entrarComoAdmin,
  mapaPronto,
  marcadoresNaFonte,
  marcadoresPorArea,
  pontoNaPagina,
  projetar,
  proximaRespostaOperacional,
  quadrado,
  referenciasDaPecuariaMm4,
  regiao,
  renderizadas,
  semearAreas,
  type AreaSemeada,
  type PoligonoGeo,
  type Posicao,
  type RespostaOperacionalE2E
} from "./mapa-manejo-04-comum";

/**
 * MAPA-MANEJO-04 (decisão 308) — T3: MOVER LOTE PELO MAPA no /mapa-de-manejo (CAMADA 4).
 *
 * O GESTO ESCOLHE O DESTINO; ELE NÃO GRAVA NADA. Cada caso semeia as PRÓPRIAS áreas (quadrados com polígono, na
 * longitude do T3) e lotes com cabeças (mapa-manejo-04-comum.ts), abre a tela, pega a resposta REAL de
 * /api/mapa/operacional e arrasta o marcador como o usuário: `page.mouse` (down → move em passos → up) a partir do
 * pixel do CENTRÓIDE QUE A API DEU, projetado pelo próprio mapa.
 *
 *   interruptor (`interruptor-arraste`) ... nasce DESLIGADO; desligado, arrastar o marcador é pan do mapa; ligado,
 *                                          persiste (localStorage) e sobrevive ao recarregar; sem a capacidade
 *                                          `batch_module_area_transfer.create` ele nem aparece
 *   soltar na própria área / fora ........ aviso (toast) e NADA mais: nenhum diálogo, nenhum POST, a fonte `lotes`
 *                                          intacta (o marcador continua no centróide de origem)
 *   soltar em outra área ................. o formulário de movimentação que já existe, com a área de destino
 *                                          PRÉ-SELECIONADA; ZERO POST até o "Transferir"; o Transferir faz UM POST
 *                                          (201) e a resposta nova do mapa põe o lote na área destino
 *   área com dois lotes .................. pergunta QUAL lote antes do formulário
 *
 * As escritas são contadas NO FIO (`page.on("request")`), não deduzidas da tela. E a outra tela que usa o mesmo
 * formulário (Pecuária › Lotes › "Mover de local") continua com o destino VAZIO.
 */

test.use(OPCOES_WEBGL);

/** A rota que grava a movimentação (a que já existe; a tela não inventa outra). */
const CAMINHO_DA_TRANSFERENCIA = "/api/livestock/transfers/batch-to-module-area";
/** Chave da escolha do interruptor no localStorage (contrato da tela). */
const CHAVE_DO_ARRASTE = "mapa-manejo.arraste-ligado";
/** Fonte do marcador que acompanha o ponteiro durante o arraste (a fonte `lotes` nunca é mexida). */
const FONTE_DO_ARRASTADO = "lote-arrastado";
/** Lado dos quadrados semeados, em graus (o padrão de `quadrado`). */
const LADO = 0.004;
/** Origem da API (as escritas contadas são as que vão para ela). */
const ORIGEM_DA_API = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333").origin;

// ------------------------------------------------------------------------------------------------------------------
// Peças privadas deste spec
// ------------------------------------------------------------------------------------------------------------------

/** Ponto DENTRO do quadrado semeado, em frações do lado a partir do canto sudoeste. */
function dentro(g: PoligonoGeo, fx: number, fy: number): Posicao {
  const canto = g.coordinates[0]?.[0];
  expect(canto, "premissa: o polígono tem vértice").toBeTruthy();
  return [canto![0] + fx * LADO, canto![1] + fy * LADO];
}

const interruptor = (page: Page) => page.getByTestId("interruptor-arraste");
const dialogoDeMover = (page: Page) => page.getByTestId("mover-lote-dialogo");
const avisos = (page: Page) => page.locator(".erp-toast-panel--warning");

/**
 * O combobox (RefSelect) de um campo do formulário: o `<label>` com o rótulo EXATO (o `*` de obrigatório tolerado) e,
 * no MESMO campo (o pai do rótulo, como o `pickRef` de helpers.ts), o combobox. O rótulo não tem `htmlFor` ligado ao
 * RefSelect, por isso não dá para ir por `getByLabel`.
 */
function campo(escopo: Locator, rotulo: string): Locator {
  const exato = new RegExp(`^${rotulo.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}( \\*)?$`);
  return escopo.locator("label", { hasText: exato }).locator("..").getByRole("combobox");
}

const lerChave = (page: Page) => page.evaluate((k) => window.localStorage.getItem(k), CHAVE_DO_ARRASTE);

/** O pan do mapa está ligado (o gesto de arraste o desliga só enquanto dura)? */
const panLigado = (page: Page) => page.evaluate(() =>
  Boolean((window as unknown as { __mapaManejoE2E?: { dragPan: { isEnabled(): boolean } } }).__mapaManejoE2E?.dragPan.isEnabled()));

/**
 * Conta as ESCRITAS (qualquer método que não seja leitura) para a API a partir de agora. Chame DEPOIS de semear:
 * a semeadura do teste também escreve pela página.
 */
function escritasNaApi(page: Page): () => string[] {
  const lista: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.origin === ORIGEM_DA_API && !["GET", "HEAD", "OPTIONS"].includes(r.method())) lista.push(`${r.method()} ${u.pathname}`);
  });
  return () => [...lista];
}

/** Guarda, a partir de agora, os corpos das respostas 200 de GET /api/mapa/operacional (na ordem). */
function respostasDoMapa(page: Page): () => Promise<RespostaOperacionalE2E[]> {
  const corpos: Promise<RespostaOperacionalE2E | null>[] = [];
  page.on("response", (r: Response) => {
    if (r.request().method() === "GET" && new URL(r.url()).pathname === CAMINHO_OPERACIONAL && r.status() === 200) {
      corpos.push(r.json().then((c) => c as RespostaOperacionalE2E).catch(() => null));
    }
  });
  return async () => (await Promise.all(corpos)).filter((c): c is RespostaOperacionalE2E => c !== null);
}

/** O que há no ponto da página: "canvas" (o do mapa) ou a tag/testid do que cobre. */
const oQueHaNoPonto = (page: Page, p: { x: number; y: number }) => page.evaluate(({ x, y }) => {
  const m = (window as unknown as { __mapaManejoE2E?: { getCanvas(): HTMLCanvasElement } }).__mapaManejoE2E;
  const el = document.elementFromPoint(x, y);
  if (!m || !el) return "nada";
  if (el === m.getCanvas()) return "canvas";
  return `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[data-testid=${el.getAttribute("data-testid")}]` : ""}`;
}, p);

/** O mapa inteiro na janela, o canvas no tamanho do contêiner e o mapa parado (antes de qualquer gesto). */
async function prepararMapa(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __mapaManejoE2E?: { getContainer(): HTMLElement } }).__mapaManejoE2E?.getContainer()
    .scrollIntoView({ block: "nearest", inline: "nearest" }));
  await expect.poll(() => page.evaluate(() => {
    const m = (window as unknown as { __mapaManejoE2E?: { getCanvas(): HTMLCanvasElement; getContainer(): HTMLElement } }).__mapaManejoE2E;
    if (!m) return false;
    const [canvas, conteiner] = [m.getCanvas().getBoundingClientRect(), m.getContainer().getBoundingClientRect()];
    return Math.abs(canvas.width - conteiner.width) < 1 && Math.abs(canvas.height - conteiner.height) < 1;
  }), { message: "o canvas do mapa acompanhou o tamanho do contêiner" }).toBe(true);
  await aguardarMapaParado(page);
}

/** Espera o marcador da área DESENHADO no pixel do centróide da API (fallback ou ícone, com a folga de 6 px da seleção). */
async function marcadorDesenhadoEm(page: Page, areaId: string, centroide: Posicao, mensagem: string): Promise<void> {
  await expect.poll(async () => (await renderizadas(page, [CAMADAS.lotesFallback, CAMADAS.lotesIcone], { posicao: centroide, raioPx: 6 }))
    .some((f) => f.propriedades["area_id"] === areaId), { message: mensagem }).toBe(true);
}

/** O ponto da fonte `lotes` da área está EXATAMENTE no centróide da API (a fonte não foi mexida pelo gesto). */
async function pontoDaFonteNoCentroide(page: Page, areaId: string, centroide: Posicao, mensagem: string): Promise<void> {
  const fs = await marcadoresNaFonte(page, [areaId]);
  expect(fs, `${mensagem}: um ponto da área na fonte lotes`).toHaveLength(1);
  const [lon, lat] = fs[0]!.coordenadas as [number, number];
  expect(Math.abs(lon - centroide[0]), `${mensagem}: longitude = a do centróide da API`).toBeLessThan(1e-9);
  expect(Math.abs(lat - centroide[1]), `${mensagem}: latitude = a do centróide da API`).toBeLessThan(1e-9);
}

type Destino = Posicao | { pagina: { x: number; y: number } };

/**
 * Arrasta o marcador como o usuário, com o mouse: pressiona no pixel de `de` (posição geográfica), passa do limiar
 * (3 px) com um primeiro movimento curto e vai em passos até `para` (posição geográfica, ou um ponto da página fora
 * do mapa); `antesDeSoltar` roda com o botão ainda pressionado. Antes, confere que o ponto de partida (e o de chegada,
 * quando no mapa) está livre sobre o canvas.
 */
async function arrastarMarcador(page: Page, de: Posicao, para: Destino, antesDeSoltar?: () => Promise<void>): Promise<{ inicio: { x: number; y: number }; fim: { x: number; y: number } }> {
  await prepararMapa(page);
  const inicio = await pontoNaPagina(page, de);
  expect(await oQueHaNoPonto(page, inicio), `o marcador (${Math.round(inicio.x)}, ${Math.round(inicio.y)}) está livre sobre o canvas`).toBe("canvas");
  const fim = Array.isArray(para) ? await pontoNaPagina(page, para) : para.pagina;
  if (Array.isArray(para)) expect(await oQueHaNoPonto(page, fim), `o ponto de soltar (${Math.round(fim.x)}, ${Math.round(fim.y)}) está livre sobre o canvas`).toBe("canvas");
  await page.mouse.move(inicio.x, inicio.y);
  await page.mouse.down();
  await page.mouse.move(inicio.x + 8, inicio.y + 6, { steps: 4 });
  await page.mouse.move(fim.x, fim.y, { steps: 15 });
  if (antesDeSoltar) await antesDeSoltar();
  await page.mouse.up();
  return { inicio, fim };
}

/** Liga o interruptor (premissa: desligado) e confere o estado marcado e guardado. */
async function ligarArraste(page: Page): Promise<void> {
  const botao = interruptor(page);
  await expect(botao, "premissa: o interruptor nasce desligado").toHaveAttribute("aria-pressed", "false");
  await botao.click();
  await expect(botao, "ligado, o interruptor fica marcado").toHaveAttribute("aria-pressed", "true");
  await expect(botao).toHaveAttribute("data-ligado", "sim");
}

/** Semeia origem (com os lotes pedidos) e uma OUTRA área vazia ao lado, na região do caso. */
async function semearOrigemEOutra(page: Page, empresa: string, caso: number, rotulo: string, lotes: { cabecas: number; categoria?: "Garrote" | "Novilha" }[]): Promise<[AreaSemeada, AreaSemeada]> {
  const o = regiao("T3", caso);
  // entrada 5 dias antes do `hoje` da API (a régua da rota): a transferência (datada de hoje) nunca cai antes do início
  const entrada = await diaDaApi(page, -5);
  const [origem, outra] = await semearAreas(page, empresa, [
    { rotulo: `${rotulo} origem`, geometria: quadrado(o), lotes: lotes.map((l) => ({ ...l, entrada })) },
    { rotulo: `${rotulo} outra`, geometria: quadrado(deslocar(o, 0.007)) }
  ]);
  return [origem!, outra!];
}

/** Nada abriu e nada foi gravado depois de um soltar que não escolhe destino. */
async function nadaAbriuNemGravou(page: Page, posts: { total: () => number }, escritas: () => string[], motivo: string): Promise<void> {
  await page.waitForTimeout(600); // o soltar decide no mesmo evento: qualquer diálogo ou POST já teria saído
  await expect(dialogoDeMover(page), `${motivo}: nenhum diálogo de mover`).toHaveCount(0);
  await expect(page.getByRole("dialog"), `${motivo}: nenhum diálogo`).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Transferir", exact: true }), `${motivo}: nenhum formulário de movimentação`).toHaveCount(0);
  expect(posts.total(), `${motivo}: ZERO POST de transferência`).toBe(0);
  expect(escritas(), `${motivo}: nenhuma escrita na API`).toEqual([]);
  expect(await dadosDaFonte(page, FONTE_DO_ARRASTADO), `${motivo}: o marcador arrastado sumiu (volta ao centróide)`).toEqual([]);
  expect(await panLigado(page), `${motivo}: o pan do mapa foi religado`).toBe(true);
}

// ------------------------------------------------------------------------------------------------------------------
// Casos
// ------------------------------------------------------------------------------------------------------------------

test("MM4-5a — o interruptor nasce DESLIGADO (arrastar desligado só faz pan); ligar persiste ao recarregar", async ({ page }) => {
  test.setTimeout(150_000);
  const empresa = await entrarComoAdmin(page);
  const [origem, outra] = await semearOrigemEOutra(page, empresa, 1, "5a", [{ cabecas: 8 }]);
  await page.evaluate((k) => window.localStorage.removeItem(k), CHAVE_DO_ARRASTE);
  expect(await lerChave(page), "premissa: localStorage limpo").toBeNull();
  const posts = contarRequisicoes(page, CAMINHO_DA_TRANSFERENCIA, "POST");
  const escritas = escritasNaApi(page);

  const resposta = await abrirMapaNasAreas(page, [origem, outra]);
  const c = centroideDaApi(areaDaResposta(resposta, origem.id));
  const destino = dentro(outra.geometria, 0.5, 0.35);

  // nasce DESLIGADO: visível (o admin tem a capacidade), não marcado
  const botao = interruptor(page);
  await expect(botao, "o admin (com a capacidade) vê o interruptor").toBeVisible();
  await expect(botao, "o interruptor nasce DESLIGADO").toHaveAttribute("aria-pressed", "false");
  await expect(botao).toHaveAttribute("data-ligado", "nao");
  expect(await lerChave(page), "nascer desligado não guarda 'ligado'").not.toBe("true");

  // desligado: arrastar o marcador até a outra área move o MAPA (pan) e não abre nada
  await marcadorDesenhadoEm(page, origem.id, c, "premissa: o marcador da origem está desenhado no centróide da API");
  await prepararMapa(page);
  const antes = await projetar(page, c);
  const { inicio, fim } = await arrastarMarcador(page, c, destino, async () => {
    expect(await dadosDaFonte(page, FONTE_DO_ARRASTADO), "desligado, nenhum marcador acompanha o ponteiro").toEqual([]);
  });
  await aguardarMapaParado(page);
  const depois = await projetar(page, c);
  const gesto = { x: fim.x - inicio.x, y: fim.y - inicio.y };
  const pan = { x: depois.x - antes.x, y: depois.y - antes.y };
  expect(Math.hypot(pan.x, pan.y), `desligado, o arraste moveu o MAPA (pan de ${Math.round(Math.hypot(pan.x, pan.y))} px para um gesto de ${Math.round(Math.hypot(gesto.x, gesto.y))} px)`)
    .toBeGreaterThan(Math.hypot(gesto.x, gesto.y) * 0.5);
  expect(pan.x * gesto.x + pan.y * gesto.y, "o mapa andou no sentido do gesto").toBeGreaterThan(0);
  await expect(avisos(page), "desligado, nenhum aviso de arraste").toHaveCount(0);
  await nadaAbriuNemGravou(page, posts, escritas, "desligado");
  await pontoDaFonteNoCentroide(page, origem.id, c, "desligado, a fonte lotes ficou intacta");

  // ligar: marcado e guardado
  await botao.click();
  await expect(botao, "ligado, o interruptor fica marcado").toHaveAttribute("aria-pressed", "true");
  await expect(botao).toHaveAttribute("data-ligado", "sim");
  expect(await lerChave(page), "a escolha foi guardada no localStorage").toBe("true");

  // recarregar: continua ligado
  const proxima = proximaRespostaOperacional(page);
  await page.reload();
  await proxima;
  await mapaPronto(page);
  await expect(interruptor(page), "depois de recarregar, o interruptor continua LIGADO").toHaveAttribute("aria-pressed", "true");
  await expect(interruptor(page)).toHaveAttribute("data-ligado", "sim");

  // e o ligado guardado VALE: o mesmo arraste agora escolhe destino (abre o formulário) — e nada grava
  await aguardarAreasNoMapa(page, [origem.id, outra.id]);
  await enquadrar(page, [origem.geometria, outra.geometria]);
  await marcadorDesenhadoEm(page, origem.id, c, "depois de recarregar, o marcador está no centróide da API");
  await arrastarMarcador(page, c, destino);
  await expect(dialogoDeMover(page), "ligado (guardado), soltar em outra área abre o diálogo de mover").toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialogoDeMover(page)).toHaveCount(0);
  expect(posts.total(), "fechar sem confirmar: ZERO POST").toBe(0);
  expect(escritas(), "nenhuma escrita na API no caso inteiro").toEqual([]);
});

test("MM4-5b — sem batch_module_area_transfer.create o interruptor NÃO aparece (nem com 'ligado' guardado)", async ({ page }) => {
  test.setTimeout(150_000);
  const empresa = await entrarComoAdmin(page);
  const [origem, outra] = await semearOrigemEOutra(page, empresa, 2, "5b", [{ cabecas: 5 }]);
  // perfil RESTRITO: vê áreas, objetos, ícones, retiros, módulos e até a LISTA de transferências — sem criar transferência
  const permissoes = ["batch_area.view", "batch_module_area_transfer.view", "map_objects.view", "icon_config.view", "retiros.view", "grazing_modules.view"];
  const papel = await api<{ id: string }>(page, "POST", "/api/admin/roles", { name: uniq("MM4 sem mover lote"), permissions: permissoes });
  const restrito = { email: `e2e-mm4-sem-mover-${Date.now()}@demo.local`, password: "Leitor@12345" };
  await api(page, "POST", "/api/admin/members", {
    name: "MM4 sem mover lote", email: restrito.email, password: restrito.password, role_id: papel.id,
    escopos_empresas: [{ modulo: "pecuaria", modo: "selecionadas", empresas: [empresa] }]
  });
  await logout(page);
  await login(page, restrito);
  const contexto = await api<{ permissions?: string[] }>(page, "GET", "/api/auth/context");
  expect(contexto.permissions ?? [], "premissa: o perfil vê as áreas").toContain("batch_area.view");
  expect(contexto.permissions ?? [], "premissa: o perfil NÃO cria transferência").not.toContain("batch_module_area_transfer.create");
  // a escolha guardada diz "ligado": sem a capacidade, ela não vale
  await page.evaluate((k) => window.localStorage.setItem(k, "true"), CHAVE_DO_ARRASTE);
  const posts = contarRequisicoes(page, CAMINHO_DA_TRANSFERENCIA, "POST");
  const escritas = escritasNaApi(page);

  const resposta = await abrirMapaNasAreas(page, [origem, outra]);
  const daApi = areaDaResposta(resposta, origem.id);
  expect(daApi.lotes.map((l) => l.lote.id), "premissa: o restrito enxerga o lote na origem").toEqual([origem.lotes[0]!.id]);
  const c = centroideDaApi(daApi);

  // a tela funciona (barra e encaixe dos controles, marcador desenhado) — só o interruptor não existe
  await expect(page.getByTestId("mapa-barra-operacional")).toBeVisible();
  await expect(page.getByTestId("seletor-coloracao"), "o encaixe da barra (onde o interruptor ficaria) está desenhado").toBeVisible();
  await marcadorDesenhadoEm(page, origem.id, c, "premissa: o marcador da origem está desenhado para o restrito");
  await expect(interruptor(page), "sem a capacidade de criar transferência, o interruptor NÃO aparece").toHaveCount(0);

  // e arrastar o marcador continua sendo só pan: nada abre, nada grava
  await prepararMapa(page);
  const antes = await projetar(page, c);
  await arrastarMarcador(page, c, dentro(outra.geometria, 0.5, 0.35), async () => {
    expect(await dadosDaFonte(page, FONTE_DO_ARRASTADO), "sem a capacidade, nenhum marcador acompanha o ponteiro").toEqual([]);
  });
  await aguardarMapaParado(page);
  const depois = await projetar(page, c);
  expect(Math.hypot(depois.x - antes.x, depois.y - antes.y), "sem a capacidade, o arraste é pan do mapa").toBeGreaterThan(20);
  await expect(avisos(page)).toHaveCount(0);
  await nadaAbriuNemGravou(page, posts, escritas, "sem a capacidade");
});

test("MM4-5c — soltar na PRÓPRIA área avisa e não abre formulário; o marcador continua no centróide", async ({ page }) => {
  test.setTimeout(150_000);
  const empresa = await entrarComoAdmin(page);
  const [origem, outra] = await semearOrigemEOutra(page, empresa, 3, "5c", [{ cabecas: 12 }]);
  const posts = contarRequisicoes(page, CAMINHO_DA_TRANSFERENCIA, "POST");
  const escritas = escritasNaApi(page);
  const resposta = await abrirMapaNasAreas(page, [origem, outra]);
  const c = centroideDaApi(areaDaResposta(resposta, origem.id));
  await ligarArraste(page);
  await marcadorDesenhadoEm(page, origem.id, c, "premissa: o marcador da origem está desenhado no centróide da API");

  // solta num canto da PRÓPRIA área (longe do centróide, ainda dentro do quadrado)
  await arrastarMarcador(page, c, dentro(origem.geometria, 0.2, 0.25), async () => {
    const arrastado = await dadosDaFonte(page, FONTE_DO_ARRASTADO);
    expect(arrastado, "premissa: o gesto foi reconhecido — o marcador acompanha o ponteiro").toHaveLength(1);
    expect(arrastado[0]?.propriedades["area_id"]).toBe(origem.id);
    await pontoDaFonteNoCentroide(page, origem.id, c, "durante o arraste, a fonte lotes não se mexe");
  });

  const aviso = avisos(page).filter({ hasText: "Arraste para outra área" });
  await expect(aviso, "soltar na própria área avisa").toHaveCount(1);
  await expect(aviso).toContainText(origem.nome);
  await expect(aviso, "o aviso é anunciado (role=status)").toHaveAttribute("role", "status");
  await nadaAbriuNemGravou(page, posts, escritas, "na própria área");
  await pontoDaFonteNoCentroide(page, origem.id, c, "na própria área, o marcador continua no centróide de origem");
  await marcadorDesenhadoEm(page, origem.id, c, "na própria área, o marcador continua desenhado no centróide de origem");
  expect((await marcadoresPorArea(page, [origem.id, outra.id]))[outra.id], "a outra área continua sem marcador").toBe(0);
});

test("MM4-5d — soltar FORA de qualquer polígono avisa e não abre formulário", async ({ page }) => {
  test.setTimeout(150_000);
  const empresa = await entrarComoAdmin(page);
  const [origem, outra] = await semearOrigemEOutra(page, empresa, 4, "5d", [{ cabecas: 4 }]);
  const posts = contarRequisicoes(page, CAMINHO_DA_TRANSFERENCIA, "POST");
  const escritas = escritasNaApi(page);
  const resposta = await abrirMapaNasAreas(page, [origem, outra]);
  const c = centroideDaApi(areaDaResposta(resposta, origem.id));
  await ligarArraste(page);
  await marcadorDesenhadoEm(page, origem.id, c, "premissa: o marcador da origem está desenhado no centróide da API");

  // 1) no vão entre os dois quadrados (a origem vai até +0,004°, a outra começa em +0,007°): nenhum polígono ali
  const [lon0, lat0] = regiao("T3", 4);
  const vao: Posicao = [lon0 + 0.0055, lat0 + LADO / 2];
  // premissa: nenhuma área da resposta tem o vão sequer na CAIXA do polígono (fora da caixa ⇒ fora do polígono)
  const caixasComOVao = resposta.areas.filter((a) => {
    const g = a["geometria"] as PoligonoGeo | null;
    const anel = g?.type === "Polygon" ? g.coordinates[0] ?? [] : [];
    if (anel.length === 0) return false;
    const lons = anel.map((p) => p[0]);
    const lats = anel.map((p) => p[1]);
    return vao[0] >= Math.min(...lons) && vao[0] <= Math.max(...lons) && vao[1] >= Math.min(...lats) && vao[1] <= Math.max(...lats);
  }).map((a) => a.name);
  expect(caixasComOVao, "premissa: o vão não está em área nenhuma da resposta").toEqual([]);
  expect(resposta.areas.filter((a) => a["geometria"]).length, "premissa: a resposta tem polígonos (a conta acima não é vazia)").toBeGreaterThanOrEqual(2);
  await arrastarMarcador(page, c, vao, async () => {
    expect(await dadosDaFonte(page, FONTE_DO_ARRASTADO), "premissa: o gesto foi reconhecido").toHaveLength(1);
  });
  const foraDoPoligono = avisos(page).filter({ hasText: "Solte o lote sobre uma área do mapa" });
  await expect(foraDoPoligono, "soltar fora de qualquer polígono avisa").toHaveCount(1);
  await expect(foraDoPoligono).toContainText(origem.nome);
  await nadaAbriuNemGravou(page, posts, escritas, "fora de qualquer polígono");
  await pontoDaFonteNoCentroide(page, origem.id, c, "fora de qualquer polígono, o marcador continua no centróide de origem");

  // 2) fora do MAPA: sobre o título da página (soltar fora do canvas também é "fora de qualquer área")
  const titulo = page.getByTestId("mapa-de-manejo").getByRole("heading", { name: "Mapa de Manejo", exact: true });
  await prepararMapa(page); // a mesma rolagem que o arraste faz: o ponto do título é medido depois dela
  const caixa = await titulo.boundingBox();
  expect(caixa, "premissa: o título da página está desenhado").not.toBeNull();
  const sobreOTitulo = { x: caixa!.x + caixa!.width / 2, y: caixa!.y + caixa!.height / 2 };
  expect(sobreOTitulo.y, "premissa: o título está na janela").toBeGreaterThan(0);
  expect(await oQueHaNoPonto(page, sobreOTitulo), "premissa: o ponto de soltar é o título, fora do canvas").toBe("h1");
  // o aviso anterior sai (5 s) antes: o próximo aviso é deste soltar, não sobra do primeiro
  await expect(avisos(page), "premissa: o aviso do primeiro soltar já saiu").toHaveCount(0, { timeout: 15_000 });
  await arrastarMarcador(page, c, { pagina: sobreOTitulo });
  await expect(avisos(page).filter({ hasText: "Solte o lote sobre uma área do mapa" }), "soltar fora do mapa também avisa").toHaveCount(1);
  await nadaAbriuNemGravou(page, posts, escritas, "fora do mapa");
  await pontoDaFonteNoCentroide(page, origem.id, c, "fora do mapa, o marcador continua no centróide de origem");
});

test("MM4-5e — soltar em OUTRA área abre o formulário com o destino pré-selecionado; ZERO POST até o Transferir; depois UM POST", async ({ page }) => {
  test.setTimeout(150_000);
  const empresa = await entrarComoAdmin(page);
  const [origem, destino] = await semearOrigemEOutra(page, empresa, 5, "5e", [{ cabecas: 9 }]);
  const lote = origem.lotes[0]!;
  const posts = contarRequisicoes(page, CAMINHO_DA_TRANSFERENCIA, "POST");
  const escritas = escritasNaApi(page);
  const resposta = await abrirMapaNasAreas(page, [origem, destino]);
  const daOrigem = areaDaResposta(resposta, origem.id);
  const doDestino = areaDaResposta(resposta, destino.id);
  expect(daOrigem.lotes.map((l) => l.lote.id), "premissa: o lote está na origem").toEqual([lote.id]);
  expect(doDestino.lotes, "premissa: o destino está vazio").toEqual([]);
  const c = centroideDaApi(daOrigem);
  await ligarArraste(page);
  await marcadorDesenhadoEm(page, origem.id, c, "premissa: o marcador da origem está desenhado no centróide da API");

  await arrastarMarcador(page, c, dentro(destino.geometria, 0.5, 0.35), async () => {
    const arrastado = await dadosDaFonte(page, FONTE_DO_ARRASTADO);
    expect(arrastado, "durante o arraste, um marcador acompanha o ponteiro").toHaveLength(1);
    expect(arrastado[0]?.propriedades["area_id"]).toBe(origem.id);
    await pontoDaFonteNoCentroide(page, origem.id, c, "durante o arraste, o marcador de origem continua no centróide");
  });

  // o formulário de movimentação, com o destino do mapa
  const dialogo = dialogoDeMover(page);
  await expect(dialogo, "soltar em outra área abre o diálogo de mover").toBeVisible();
  await expect(dialogo.getByRole("heading", { name: `Mover lote para ${destino.nome}` })).toBeVisible();
  await expect(dialogo, "o diálogo diz de onde o lote sai").toContainText(`Saindo de ${origem.nome}`);
  const transferir = dialogo.getByRole("button", { name: "Transferir", exact: true });
  await expect(transferir, "o formulário que já existe (com o botão Transferir) está no diálogo").toBeVisible();
  const area = campo(dialogo, "Área / piquete");
  await expect(area, "o campo de destino está PRÉ-SELECIONADO").not.toHaveClass(/is-empty/);
  await expect(area, "o destino pré-selecionado é a área onde o lote foi solto").toHaveText(destino.nome);
  await expect(campo(dialogo, "Lote"), "o lote da origem está no formulário").toContainText(lote.descricao);
  await expect(transferir, "com lote e destino, o Transferir está habilitado").toBeEnabled();
  await expect(avisos(page), "soltar em outra área não é aviso").toHaveCount(0);

  // ZERO POST até o Confirmar — e o marcador continua no centróide de origem
  await page.waitForTimeout(800);
  expect(posts.total(), "ZERO POST de transferência depois de abrir o formulário").toBe(0);
  expect(escritas(), "nenhuma escrita na API antes do Transferir").toEqual([]);
  expect(await dadosDaFonte(page, FONTE_DO_ARRASTADO), "o marcador arrastado sumiu").toEqual([]);
  await pontoDaFonteNoCentroide(page, origem.id, c, "antes do Transferir, o marcador está na origem");
  expect((await marcadoresPorArea(page, [origem.id, destino.id]))[destino.id], "antes do Transferir, o destino não tem marcador").toBe(0);

  // Transferir: exatamente UM POST (201), com o destino do mapa
  const respostas = respostasDoMapa(page);
  const respostaDoPost = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === CAMINHO_DA_TRANSFERENCIA);
  await transferir.click();
  const post = await respostaDoPost;
  expect(post.status(), "o POST da transferência foi aceito").toBe(201);
  const corpo = post.request().postDataJSON() as { batch_id?: string; area_id?: string | null; grazing_module_id?: string | null; corral_id?: string | null };
  expect(corpo.batch_id, "o POST leva o lote da origem").toBe(lote.id);
  expect(corpo.area_id, "o POST leva a área onde o lote foi solto (o valor pré-selecionado)").toBe(destino.id);
  expect(corpo.corral_id ?? null).toBeNull();
  await expect(dialogo, "gravado, o diálogo fecha").toHaveCount(0);

  // a resposta NOVA do mapa põe o lote no destino, e o marcador muda de área
  let nova: RespostaOperacionalE2E | undefined;
  await expect.poll(async () => {
    nova = (await respostas()).find((r) => r.areas.find((a) => a.id === destino.id)?.lotes.some((l) => l.lote.id === lote.id));
    return Boolean(nova);
  }, { message: "uma resposta nova de /api/mapa/operacional mostra o lote na área destino", timeout: 20_000 }).toBe(true);
  expect(areaDaResposta(nova!, origem.id).lotes, "na resposta nova, a origem ficou sem o lote").toEqual([]);
  const cDestino = centroideDaApi(areaDaResposta(nova!, destino.id));
  await expect.poll(() => marcadoresPorArea(page, [origem.id, destino.id]), { message: "o marcador mudou de área" })
    .toEqual({ [origem.id]: 0, [destino.id]: 1 });
  await pontoDaFonteNoCentroide(page, destino.id, cDestino, "o marcador está no centróide do destino");
  expect(posts.total(), "exatamente UM POST de transferência").toBe(1);
  expect(escritas(), "a única escrita é o POST da transferência").toEqual([`POST ${CAMINHO_DA_TRANSFERENCIA}`]);
});

test("MM4-5f — área com 2 lotes: pergunta QUAL lote antes do formulário; o escolhido vai para o formulário", async ({ page }) => {
  test.setTimeout(150_000);
  const empresa = await entrarComoAdmin(page);
  const [origem, destino] = await semearOrigemEOutra(page, empresa, 6, "5f", [{ cabecas: 6 }, { cabecas: 14, categoria: "Novilha" }]);
  const posts = contarRequisicoes(page, CAMINHO_DA_TRANSFERENCIA, "POST");
  const escritas = escritasNaApi(page);
  const resposta = await abrirMapaNasAreas(page, [origem, destino]);
  const daOrigem = areaDaResposta(resposta, origem.id);
  expect(daOrigem.lotes, "premissa: dois lotes na origem").toHaveLength(2);
  expect(new Set(daOrigem.lotes.map((l) => l.lote.id)), "premissa: os dois lotes semeados").toEqual(new Set(origem.lotes.map((l) => l.id)));
  expect(await marcadoresPorArea(page, [origem.id]), "premissa: UM marcador para a área de dois lotes").toEqual({ [origem.id]: 1 });
  // o escolhido é o que NÃO vem primeiro na resposta: prova que a tela não pega "o primeiro"
  const primeiro = origem.lotes.find((l) => l.id === daOrigem.lotes[0]!.lote.id)!;
  const escolhido = origem.lotes.find((l) => l.id === daOrigem.lotes[1]!.lote.id)!;
  const c = centroideDaApi(daOrigem);
  await ligarArraste(page);
  await marcadorDesenhadoEm(page, origem.id, c, "premissa: o marcador da origem está desenhado no centróide da API");

  await arrastarMarcador(page, c, dentro(destino.geometria, 0.5, 0.35), async () => {
    expect(await dadosDaFonte(page, FONTE_DO_ARRASTADO), "premissa: o gesto foi reconhecido").toHaveLength(1);
  });

  // primeiro a pergunta: qual lote?
  const dialogo = dialogoDeMover(page);
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByRole("heading", { name: "Qual lote mover?" }), "área com dois lotes PERGUNTA qual lote").toBeVisible();
  const escolha = dialogo.getByTestId("escolher-lote");
  await expect(escolha).toBeVisible();
  await expect(escolha.getByRole("button"), "uma opção por lote presente").toHaveCount(2);
  for (const l of origem.lotes) await expect(dialogo.getByTestId(`escolher-lote-${l.id}`), `opção do lote ${l.descricao}`).toContainText(l.descricao);
  await expect(dialogo.getByRole("button", { name: "Transferir", exact: true }), "antes de escolher, nenhum formulário").toHaveCount(0);
  await expect(campo(dialogo, "Área / piquete")).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(posts.total(), "perguntar não grava: ZERO POST").toBe(0);

  // escolhe o SEGUNDO → o formulário com aquele lote e o destino do mapa
  await dialogo.getByTestId(`escolher-lote-${escolhido.id}`).click();
  await expect(escolha, "escolhido o lote, a pergunta sai").toHaveCount(0);
  await expect(dialogo.getByRole("heading", { name: `Mover lote para ${destino.nome}` })).toBeVisible();
  await expect(campo(dialogo, "Lote"), "o formulário traz o lote ESCOLHIDO").toContainText(escolhido.descricao);
  await expect(campo(dialogo, "Lote")).not.toContainText(primeiro.descricao);
  await expect(campo(dialogo, "Área / piquete"), "e o destino pré-selecionado").toHaveText(destino.nome);
  await page.waitForTimeout(500);
  expect(posts.total(), "escolher o lote não grava: ZERO POST").toBe(0);
  expect(escritas(), "nenhuma escrita antes do Transferir").toEqual([]);

  // Transferir grava o lote escolhido — só ele
  const respostas = respostasDoMapa(page);
  const respostaDoPost = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === CAMINHO_DA_TRANSFERENCIA);
  await dialogo.getByRole("button", { name: "Transferir", exact: true }).click();
  const post = await respostaDoPost;
  expect(post.status()).toBe(201);
  const corpo = post.request().postDataJSON() as { batch_id?: string; area_id?: string | null };
  expect(corpo.batch_id, "o POST leva o lote ESCOLHIDO").toBe(escolhido.id);
  expect(corpo.area_id, "e o destino do mapa").toBe(destino.id);
  let nova: RespostaOperacionalE2E | undefined;
  await expect.poll(async () => {
    nova = (await respostas()).find((r) => r.areas.find((a) => a.id === destino.id)?.lotes.some((l) => l.lote.id === escolhido.id));
    return Boolean(nova);
  }, { message: "a resposta nova mostra o lote escolhido no destino", timeout: 20_000 }).toBe(true);
  expect(areaDaResposta(nova!, origem.id).lotes.map((l) => l.lote.id), "o outro lote ficou na origem").toEqual([primeiro.id]);
  await expect.poll(() => marcadoresPorArea(page, [origem.id, destino.id]), { message: "um marcador em cada área agora" })
    .toEqual({ [origem.id]: 1, [destino.id]: 1 });
  expect(posts.total(), "exatamente UM POST").toBe(1);
});

test("MM4-5 (Pecuária) — o 'Mover de local' da Pecuária não mudou: Área / piquete vem VAZIO e o Transferir está lá", async ({ page }) => {
  test.setTimeout(120_000);
  const empresa = await entrarComoAdmin(page);
  // um lote PRÓPRIO (sem área), achado pela busca da listagem — nada de depender do primeiro da lista
  const descricao = uniq("MM4 Lote Pecuaria");
  const criado = await api<{ id: string }>(page, "POST", "/api/resources/batches", {
    empresa_id: empresa, batch_date: "2026-09-01", description: descricao, species_id: referenciasDaPecuariaMm4().especie, batch_type: "pasture"
  });
  expect(criado.id, "premissa: o lote foi criado").toMatch(/^[0-9a-f-]{36}$/);
  const posts = contarRequisicoes(page, CAMINHO_DA_TRANSFERENCIA, "POST");

  await page.goto("/pecuaria?tab=rebanho&sub=lotes");
  await page.getByLabel("Pesquisar", { exact: true }).click();
  await page.getByPlaceholder(/^Pesquisar por/).fill(descricao);
  await page.keyboard.press("Enter");
  const linha = page.getByTestId("b1-row").filter({ hasText: descricao });
  await expect(linha, "premissa: a busca achou o lote").toHaveCount(1);
  await linha.click();
  await page.getByLabel("Mais opções").click();
  await page.getByRole("menuitem", { name: /Mover de local/ }).click();

  const dialogo = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Mover lote de local" }) });
  await expect(dialogo, "o diálogo da Pecuária abriu").toBeVisible();
  await expect(dialogoDeMover(page), "é o diálogo da Pecuária, não o do mapa").toHaveCount(0);
  await expect(campo(dialogo, "Lote"), "o lote da linha continua pré-preenchido").toContainText(descricao);
  const area = campo(dialogo, "Área / piquete");
  await expect(area, "o campo Área / piquete existe").toHaveCount(1);
  await expect(area, "sem o mapa, Área / piquete vem VAZIO").toHaveClass(/is-empty/);
  await expect(area).toHaveText("Selecione");
  const transferir = dialogo.getByRole("button", { name: "Transferir", exact: true });
  await expect(transferir, "o botão Transferir está lá").toBeVisible();
  await expect(transferir, "sem destino, o Transferir continua desabilitado (como sempre)").toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialogo).toHaveCount(0);
  expect(posts.total(), "abrir e fechar o diálogo da Pecuária não grava").toBe(0);
});
