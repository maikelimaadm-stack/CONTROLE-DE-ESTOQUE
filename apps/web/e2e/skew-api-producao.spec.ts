import { test, expect, type Page } from "@playwright/test";
import { login, uniq } from "./helpers";
import { criarEmpresaEConferirContador, provarContadorIncompativel } from "./skew-contador-empresa";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

/**
 * VERSION SKEW — O WEB DESTA PR CONTRA A API QUE ESTÁ NO AR (PRE-BASE2-05A).
 *
 * Roda só em `playwright.skew.config.ts`, que sobe a API EXATA do commit BASE desta PR (montada por
 * `scripts/api-anterior.mjs`) servindo o MESMO banco já migrado. Não há mock: o servidor aqui é o binário
 * que está em produção enquanto esta PR não sobe.
 *
 * O QUE ESTE ARQUIVO MEDIA ANTES, E POR QUE MUDOU
 *
 * Até a PRE-BASE2-04 ele apontava para a API anterior à PRE-BASE2-03 e provava o contrário do que prova
 * agora: que o fio TINHA de ser legado, porque o CORS daquele binário não declarava `X-Empresa-Id` e o
 * preflight morria no navegador. A PRE-BASE2-05A vira o cliente para o canônico — e aquela combinação
 * deixa de ser um cenário de produção, porque a API canônica está no ar desde a PRE-BASE2-03 e não volta.
 *
 * Apagar seria perder a prova; manter apontado para lá seria certificar um cenário que não existe mais.
 * Então o arquivo foi RECLASSIFICADO: mede o skew que de fato existe depois do cutover — web novo sobre a
 * API em produção — e o contrato que a PRE-BASE2-05A assume, que é justamente este: **o cliente canônico
 * só sobe sobre uma API que já entende o canônico**. Se um dia alguém reverter a API para antes da
 * PRE-BASE2-03, o primeiro teste aqui reprova antes de o produto quebrar no navegador do cliente.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
const WIRE_LEGADO = /(^|[?&])(farm_id|origin_farm_id|destination_farm_id)(__[a-z]+)?=/;

/** Sessão gravada pelo web depois do login: token e organização, para falar com a API direto. */
const sessao = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token?: string; orgId?: string; empresaId?: string | null });

/**
 * Vigia do navegador. Falha de CORS não vira exceção de JavaScript nem resposta HTTP: o Chromium aborta a
 * requisição ANTES de ela existir para a aplicação (`net::ERR_FAILED`) e escreve no console. Sem este
 * coletor, a tela renderiza vazia e o teste passa — que é exatamente o modo de falha desta janela.
 */
function vigiar(page: Page) {
  const falhas: string[] = []; const urls: string[] = []; const cabecalhos: { url: string; empresa?: string; farm?: string }[] = [];
  page.on("requestfailed", (r) => { if (r.url().includes(API)) falhas.push(`${r.url()} → ${r.failure()?.errorText ?? "?"}`); });
  page.on("console", (m) => { if (m.type() === "error" && /CORS|preflight|Access-Control/i.test(m.text())) falhas.push(`console: ${m.text()}`); });
  page.on("request", (r) => { if (r.url().includes("/api/")) { urls.push(r.url()); const h = r.headers(); cabecalhos.push({ url: r.url(), empresa: h["x-empresa-id"], farm: h["x-farm-id"] }); } });
  return {
    urls, cabecalhos,
    semBloqueio: () => expect(falhas, "nenhuma requisição pode morrer no navegador (CORS/preflight)").toEqual([]),
    /** Depois do cutover o fio é canônico nas duas pontas — e o legado não reaparece por descuido. */
    fioCanonico: () => {
      const legadas = urls.filter((u) => WIRE_LEGADO.test(u) || /\/api\/resources\/farms(\/|\?|$)/.test(u));
      expect(legadas, `o idioma legado não pode sair do cliente canônico: ${legadas.join(" ")}`).toEqual([]);
      const comContexto = cabecalhos.filter((c) => c.empresa || c.farm);
      const comLegado = comContexto.filter((c) => c.farm);
      expect(comLegado.map((c) => c.url), "X-Farm-Id não sai mais do navegador").toEqual([]);
    }
  };
}

test.describe.configure({ mode: "serial" });

test("CONTRATO · a API da base aceita o canônico que o web atual fala", async ({ page, request }) => {
  // Sem esta prova o arquivo inteiro é decorativo: contra uma API pré-PRE-BASE2-03 as asserções abaixo
  // falhariam por CORS, e é justamente essa regressão que aqui se quer pegar antes do cliente.
  await login(page);
  const s = await sessao(page);
  const auth = { authorization: `Bearer ${s.token}`, "x-org-id": String(s.orgId) };

  const ctx = await (await request.get(`${API}/api/auth/context`, { headers: auth })).json();
  expect(ctx["empresas"], "a API em produção entrega o campo canônico").toBeDefined();

  const pre = await request.fetch(`${API}/api/auth/context`, {
    method: "OPTIONS",
    headers: { origin: page.url().replace(/(https?:\/\/[^/]+).*/, "$1"), "access-control-request-method": "GET", "access-control-request-headers": "x-empresa-id" }
  });
  const permitidos = (pre.headers()["access-control-allow-headers"] ?? "").toLowerCase();
  expect(permitidos, "o CORS declara o cabeçalho canônico — sem isso o preflight mata a tela").toContain("x-empresa-id");

  expect((await request.get(`${API}/api/resources/empresas?pageSize=1`, { headers: auth })).status(), "o recurso canônico existe").toBe(200);

  const corpoCanonico = await request.post(`${API}/api/resources/warehouses`, { headers: auth, data: { empresa_id: ctx["empresas"][0].id, initials: "SK1", description: uniq("skew"), type: "inputs" } });
  // 201 na primeira execução, 409 nas seguintes (sigla repetida). 422 seria o campo canônico NÃO reconhecido
  // pelo schema `.strict()` — exatamente a quebra que a 05A não pode ter.
  expect([201, 409], `o corpo canônico é aceito pelo schema (status ${corpoCanonico.status()}: ${await corpoCanonico.text()})`).toContain(corpoCanonico.status());

  const todos = await (await request.get(`${API}/api/resources/warehouses?pageSize=100`, { headers: auth })).json();
  const canonico = await (await request.get(`${API}/api/resources/warehouses?pageSize=100&empresa_id__eq=${ctx["empresas"][0].id}`, { headers: auth })).json();
  expect(Number(canonico["total"]), "o filtro canônico RECORTA de verdade — não é descartado em silêncio").toBeLessThan(Number(todos["total"]));

  // A PONTE DO SERVIDOR JÁ SAIU (PRE-BASE2-05B), E A BASE TAMBÉM NÃO A TEM.
  // Enquanto a base desta PR era um commit anterior à 05B, esta linha exigia 200 e distinguia os dois
  // binários pela ponte. Com a 05B mesclada, a base É canônica: exigir 200 aqui reprovaria um servidor
  // correto. Trocado pelo fato atual — e a distinção entre base e HEAD passa a ser provada pela IDENTIDADE
  // do binário, logo abaixo, que é o que ela sempre deveria ter sido: um contrato igual nos dois lados não
  // consegue dizer qual dos dois está no ar.
  const legado = await (await request.get(`${API}/api/resources/farms?pageSize=1`, { headers: auth })).status();
  expect(legado, "a chave de recurso anterior não existe mais em nenhum dos dois lados").toBe(404);
});

/**
 * A IDENTIDADE DO BINÁRIO É O SHA EXATO DA BASE — não "um commit qualquer diferente do HEAD".
 *
 * A versão anterior deste caso só exigia `anterior !== HEAD`. Isso prova que os dois lados não são o mesmo
 * commit; NÃO prova qual é o outro lado. Um commit X qualquer passaria — inclusive o commit errado que a
 * resolução por ponta de branch podia escolher, que é justamente o defeito.
 *
 * A expectativa é LIDA de `.api-anterior.base`, gravado por quem montou a árvore: uma resolução por
 * execução, sem rede e sem recálculo. Recalcular aqui reintroduziria o problema pelo outro lado — num
 * evento de `push` a resolução cai na ponta de `origin/main`, e duas leituras da ponta podem divergir
 * dentro do mesmo job. Quando o CI injeta `SKEW_BASE_COMMIT` (`pull_request.base.sha`, o SHA da base
 * CAPTURADO PARA ESTA EXECUÇÃO), a igualdade é cobrada também contra ele: é a PR declarando qual é a sua
 * base. O que se exige dele não é ser eterno — é ficar PINADO durante o run.
 *
 * O outro lado da comparação é o CHECKOUT, não "o head da PR": num evento `pull_request` o runner posiciona
 * a árvore num merge ref sintético, e exigir que ele fosse o head da PR reprovaria um CI correto. O que
 * importa é que base e checkout sejam commits DIFERENTES — senão não há skew a medir.
 */
test("IDENTIDADE · a árvore da API é exatamente o base SHA desta execução", async () => {
  const raiz = path.resolve(__dirname, "../../..");
  const rev = (cwd: string) => execFileSync("git", ["rev-parse", "HEAD"], { cwd }).toString().trim();
  // Lido do ARQUIVO, não recalculado nem importado do harness: o arquivo é o contrato entre quem monta a
  // árvore e quem a confere, e ler um arquivo não tem como divergir de si mesmo no meio do job.
  const esperada = fs.readFileSync(path.join(raiz, ".api-anterior.base"), "utf8").trim();
  expect(esperada, "`.api-anterior.base` é gravado por scripts/api-anterior.mjs ao montar a árvore").toMatch(/^[0-9a-f]{40}$/);

  const doEvento = (process.env.SKEW_BASE_COMMIT ?? "").trim();
  if (doEvento) expect(esperada, "a base usada é a que a PR declarou no evento").toBe(doEvento);

  const arvore = rev(path.join(raiz, ".api-anterior"));
  expect(arvore, "a árvore precisa estar na base EXATA, não num commit qualquer").toBe(esperada);
  expect(arvore, "e a base não pode ser o commit do checkout — seria comparar o commit com ele mesmo").not.toBe(rev(raiz));
});
/**
 * O CONTADOR DE EMPRESA, NO SENTIDO 1 (API da base). Ver `skew-contador-empresa.ts` para o porquê: é a
 * numeração — não a leitura — que a troca de contador arrisca, e quem troca o contador é a
 * PRE-BASE2-05C-2. A 05C-1 remove colunas e deixa `entity='farm'` intacto; esta prova roda desde já como
 * rede preventiva. Ela precisa criar uma Empresa DE VERDADE neste sentido e outra no sentido 2, contra o
 * MESMO banco, sem reset entre eles.
 */
// O NOME VALE NOS DOIS RAMOS, de propósito. Este caso prova coisas OPOSTAS conforme a execução atravesse
// ou não o cutover, e o relatório do CI mostra só o título: um nome que só descrevesse a alocação passaria
// verde "alocando código novo" justamente na execução em que provou a RECUSA. Quem audita de fora leria o
// contrário do que aconteceu. Qual ramo rodou sai no `console.log` de cada um.
test("contador de Empresa pela API da BASE: aloca código novo e único — ou RECUSA, se a execução atravessa o cutover", async ({ page, request }) => {
  await login(page);
  const s = await sessao(page);
  const auth = { authorization: `Bearer ${s.token}`, "x-org-id": String(s.orgId) };

  // A PR que ATRAVESSA o cutover do contador (PRE-BASE2-05C-2) inverte o que este caso cobra: ali a
  // combinação "API da base × banco deste HEAD" é PROIBIDA, e a prova passa a ser a recusa. A decisão vem
  // de `scripts/lib/cutover-contador.mjs`, que compara a constante do contador nos dois commits — e volta
  // sozinha ao normal na primeira PR cuja base já contenha o cutover. Ver o runbook do cutover.
  if (process.env.SKEW_CUTOVER_CONTADOR === "1") {
    await provarContadorIncompativel(request, API, auth, "SKEW-BASE");
    console.log("[skew] sentido 1 · cutover do contador ATRAVESSADO: a combinação proibida foi recusada, como se exige");
    return;
  }

  const codigo = await criarEmpresaEConferirContador(request, API, auth, "SKEW-BASE");
  console.log(`[skew] sentido 1 (API da base) alocou o código de Empresa ${codigo}`);
});

test("entrar, carregar o contexto e escolher a empresa — sem nenhuma requisição morrer no navegador", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const seletor = page.getByLabel("Empresa ativa");
  await expect(seletor.locator("option")).not.toHaveCount(1);   // "Todas as empresas" + as empresas reais
  await seletor.selectOption({ index: 1 });
  await expect(seletor).not.toHaveValue("");
  await page.goto("/cadastros/warehouses");
  await expect(page.getByTestId("b1-row").first()).toBeVisible();
  const s = await sessao(page);
  expect(s.empresaId, "a empresa escolhida fica na sessão com o nome canônico").toBeTruthy();
  v.semBloqueio(); v.fioCanonico();
});

test("/cadastros/empresas abre pedindo o recurso CANÔNICO", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  await page.goto("/cadastros/empresas");
  await expect(page.getByTestId("b1-row").first()).toBeVisible();
  expect(await page.getByTestId("b1-row").count(), "a listagem trouxe as empresas da organização").toBeGreaterThan(0);
  expect(v.urls.some((u) => /\/api\/resources\/empresas(\/|\?)/.test(u)), `o fio pediu o recurso canônico: ${v.urls.join(" ")}`).toBe(true);
  v.semBloqueio(); v.fioCanonico();
});

test("a resposta já é canônica: a coluna Empresa da listagem genérica não vem vazia", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  // A listagem genérica desenha `<campo>_label` — `empresa_id_label`. Antes isso só funcionava porque o
  // cliente promovia `farm_id_label`; agora a API entrega o canônico e não há promoção nenhuma no meio.
  const resposta = page.waitForResponse((r) => /\/api\/resources\/warehouses\?/.test(r.url()) && r.status() === 200);
  await page.goto("/cadastros/warehouses");
  const corpo = await (await resposta).json() as { items: Record<string, unknown>[] };
  expect(corpo.items[0]?.["empresa_id"], "a API em produção responde com o nome canônico").toBeTruthy();

  const colunas = await page.locator("thead th").allInnerTexts();
  const iEmpresa = colunas.findIndex((c) => /^\s*Empresa\s*$/i.test(c));
  expect(iEmpresa, `a coluna Empresa existe na tela: ${colunas.join(" | ")}`).toBeGreaterThanOrEqual(0);
  const celula = page.getByTestId("b1-row").first().locator("td").nth(iEmpresa);
  await expect(celula, "coluna Empresa preenchida direto de `empresa_id_label`").not.toHaveText("");
  v.semBloqueio(); v.fioCanonico();
});

test("RefSelect de Empresa e cadastro real: o corpo sai CANÔNICO e o servidor aceita", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const desc = uniq("Armazém Canônico");
  const corpos: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/resources/warehouses")) corpos.push(r.postData() ?? ""); });

  await page.goto("/cadastros/warehouses/new");
  await expect(page.getByTestId("b1-form")).toBeVisible();

  // As opções vêm de `/api/resources/empresas/options` — sem tradução de caminho no meio.
  const campoEmpresa = page.getByTestId("b1-form").locator("label", { hasText: /^Empresa/ }).first().locator("..");
  await campoEmpresa.locator("button[type=button]").first().click();
  const opcoes = page.locator(".cmd-panel [role=option]");
  await expect(opcoes.first(), "o seletor de referência listou as empresas").toBeVisible();
  await opcoes.first().click();

  await page.getByLabel(/^Sigla/).first().fill(`CN${Date.now().toString(36).slice(-3).toUpperCase()}`);
  await page.getByLabel(/^Descrição/).first().fill(desc);
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await page.waitForURL(/\/cadastros\/warehouses$/, { timeout: 20_000 });

  expect(corpos.length, "o formulário enviou o cadastro").toBeGreaterThan(0);
  for (const c of corpos) expect(c, `o corpo não pode conter nome legado: ${c}`).not.toMatch(/"(farm_id|origin_farm_id|destination_farm_id)"/);

  await page.getByLabel("Pesquisar", { exact: true }).click();
  await page.getByPlaceholder(/^Pesquisar por/).fill(desc);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("b1-row").filter({ hasText: desc }).first(), "o registro foi gravado com empresa").toBeVisible();
  v.semBloqueio(); v.fioCanonico();
});

test("filtrar por empresa realmente filtra — e a query viaja canônica", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  await page.getByLabel("Empresa ativa").selectOption("");
  await page.goto("/cadastros/warehouses");
  await expect(page.getByTestId("b1-row").first()).toBeVisible();
  const antes = await page.getByTestId("b1-row").count();
  expect(antes, "o cenário só discrimina se houver armazém de mais de uma empresa").toBeGreaterThan(1);

  const faixa = page.getByLabel("Mostrar faixa de filtros");
  if (await faixa.count()) await faixa.click();
  const empresa = (await page.getByLabel("Empresa ativa").locator("option").nth(1).innerText()).trim();
  await page.getByRole("button", { name: "Filtro Empresa" }).click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  await painel.locator("label", { hasText: empresa }).first().click();
  await painel.getByRole("button", { name: "OK" }).click();

  await expect.poll(() => page.getByTestId("b1-row").count(), { message: "o recorte por empresa chegou ao servidor" }).toBeLessThan(antes);
  const colunas = await page.locator("thead th").allInnerTexts();
  const iEmpresa = colunas.findIndex((c) => /^\s*Empresa\s*$/i.test(c));
  const empresas = new Set((await page.getByTestId("b1-row").locator(`td:nth-child(${iEmpresa + 1})`).allInnerTexts()).map((t) => t.trim()));
  expect([...empresas], "todas as linhas restantes são da empresa escolhida").toEqual([empresa]);
  expect(v.urls.some((u) => /empresa_id(__[a-z]+)?=/.test(u)), `o filtro viajou com o nome canônico: ${v.urls.filter((u) => u.includes("warehouses")).join(" ")}`).toBe(true);
  v.semBloqueio(); v.fioCanonico();
});

test("nenhuma tela conhece o nome antigo: a moldura do produto é canônica", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  await page.goto("/cadastros/warehouses");
  await expect(page.getByTestId("b1-row").first()).toBeVisible();
  /**
   * A auditoria é da MOLDURA (cabeçalho de coluna, rótulo de campo, aba, menu) — não do DADO. O nome de uma
   * empresa cadastrada é do usuário: "[DEMO] Fazenda Santa Luzia" continua se chamando assim depois da
   * migração, e proibir a palavra no conteúdo seria reescrever o cadastro dele, não renomear o produto.
   */
  const moldura = [
    ...await page.locator("thead th").allInnerTexts(),
    ...await page.locator("label").allInnerTexts(),
    ...await page.getByRole("tab").allInnerTexts(),
    ...await page.locator("nav a").allInnerTexts()
  ].map((t) => t.trim()).filter(Boolean);
  const nicho = moldura.filter((t) => /fazenda|farm/i.test(t));
  expect(nicho, `a moldura do produto ainda fala o nicho: ${nicho.join(" | ")}`).toEqual([]);
  expect(moldura.some((t) => /^Empresa$/i.test(t)), `a coluna canônica está desenhada: ${moldura.join(" | ")}`).toBe(true);
  expect(page.url()).not.toMatch(/farms|fazendas/);
  v.semBloqueio(); v.fioCanonico();
});
