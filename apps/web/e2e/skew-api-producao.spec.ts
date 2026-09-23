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
/**
 * A DECISÃO DO CUTOVER DO CONTADOR, LIDA DO ARTEFATO — nunca inferida, nunca suposta.
 *
 * O arquivo é gravado por `scripts/skew-cutover-contador.mjs` (o mesmo passo que exporta a variável) e
 * carrega os DOIS insumos: a constante do contador na base e a deste HEAD. Ausência do arquivo é falha, não
 * "então não atravessa": supor o ramo fácil é justamente como um gate se autoaprova.
 */
function lerDecisaoDoCutover(): { base: string; head: string; atravessa: boolean } {
  const arq = path.resolve(__dirname, "../../..", ".skew-cutover-contador.json");
  if (!fs.existsSync(arq)) {
    throw new Error(`decisão do cutover ausente (${arq}): rode scripts/skew-cutover-contador.mjs antes do skew. `
      + "Sem ela não há como saber qual ramo provar, e escolher o mais fácil seria certificar o que não se mediu.");
  }
  return JSON.parse(fs.readFileSync(arq, "utf8"));
}

test("contador de Empresa pela API da BASE: aloca código novo e único — ou RECUSA, se a execução atravessa o cutover", async ({ page, request }) => {
  await login(page);
  const s = await sessao(page);
  const auth = { authorization: `Bearer ${s.token}`, "x-org-id": String(s.orgId) };

  // A PR que ATRAVESSA o cutover do contador (PRE-BASE2-05C-2) inverte o que este caso cobra: ali a
  // combinação "API da base × banco deste HEAD" é PROIBIDA, e a prova passa a ser a recusa. A decisão vem
  // de `scripts/lib/cutover-contador.mjs`, que compara a constante do contador nos dois commits — e volta
  // sozinha ao normal na primeira PR cuja base já contenha o cutover. Ver o runbook do cutover.
  //
  // E A DECISÃO NÃO VEM DA VARIÁVEL DE AMBIENTE. `SKEW_CUTOVER_CONTADOR` é uma string mutável: um `env:`
  // de workflow prevalece sobre o que o passo decisor escreveu em `$GITHUB_ENV`, e o ramo invertido
  // passaria a rodar com o log do CI afirmando o contrário. Como o ramo "atravessa" só exige que o
  // cadastro seja RECUSADO, um interruptor preso em "1" faria este caso aceitar QUALQUER falha — 500,
  // timeout, regressão de permissão — como prova de sucesso, para sempre. Então aqui se RECALCULA a
  // partir do artefato que o decisor gravou, e a variável é só CONFERÊNCIA: divergir REPROVA.
  const decisao = lerDecisaoDoCutover();
  const atravessa = decisao.base !== decisao.head;
  expect(atravessa, "o artefato tem de ser coerente com a própria decisão que carrega").toBe(decisao.atravessa);
  expect(process.env.SKEW_CUTOVER_CONTADOR ?? "0",
    "SKEW_CUTOVER_CONTADOR não bate com a decisão recalculada — alguém fixou a variável por fora")
    .toBe(atravessa ? "1" : "0");

  if (atravessa) {
    await provarContadorIncompativel(request, API, auth, "SKEW-BASE");
    console.log(`[skew] sentido 1 · cutover do contador ATRAVESSADO ('${decisao.base}' → '${decisao.head}'): a combinação proibida foi recusada, como se exige`);
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

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * TOP-CONFIG-02 · A DESCOBERTA DE CAPACIDADE, CONTRA O BINÁRIO REAL DA BASE
 *
 * A fatia faz o Portal de Vendas perguntar ao servidor quais Tipos de Operação ele aceita, ANTES de
 * oferecer o formulário. A razão é uma perda silenciosa: `docSchema` é `z.object` sem `.strict()`, então
 * a API da base DESCARTA `tipo_operacao_id` sem erro — o documento nasceria sem TOP e o usuário leria
 * "salvo". Quem se protege é o cliente, porque o defeito mora no binário que já está no ar.
 *
 * POR QUE ESTE TESTE PRECISA EXISTIR AQUI, E NÃO SÓ NO E2E NORMAL. A primeira versão desta fatia
 * afirmava — em código, em teste com mock e em `docs/DECISIONS.md` — que a API anterior responde 404.
 * É falso, e só o binário real mostra: a base não tem a rota estática, mas tem `${base}/:id`; o roteador
 * casa o nó paramétrico, "operation-types" entra num `where d.id=$1` de coluna `uuid`, o Postgres devolve
 * 22P02, `fromPgError` não mapeia 22P02, e o cliente recebe 500. O mock respondia 404 e certificava um
 * caminho que produção nunca percorre.
 *
 * POR QUE ESTES DOIS CASOS TÊM DOIS RAMOS, E POR QUE ISSO NÃO É AFROUXAMENTO
 * --------------------------------------------------------------------------
 * "A base não tem o endpoint" é uma verdade COM PRAZO. Valia enquanto a base era anterior à #47 e deixou
 * de valer no instante em que a #47 entrou na `main` — sem que nenhuma linha de código a quebrasse. Toda
 * PR aberta depois disso, INCLUSIVE UMA DE DIFF VAZIO, reprovava aqui: o gate cobrava um passado que não
 * volta.
 *
 * O ramo não se escolhe por SHA digitado nem por interruptor de ambiente: mede-se a ÁRVORE DA BASE desta
 * execução (`scripts/lib/capacidade-top.mjs`), e cada mundo cobra a SUA prova —
 *
 *   base SEM a rota  → exatamente a prova original da #47: a base responde 500 e a tela BLOQUEIA;
 *   base COM a rota  → a prova positiva: a base responde 200 com `contractVersion` 1, e o web NÃO trata
 *                      um servidor compatível como servidor antigo.
 *
 * Nenhum dos dois é um ramo que apenas passa, e é isso que separa isto de desligar o gate. A decisão volta
 * sozinha ao mundo legado se alguém reverter a #47, e REPROVA de vez se a assinatura da rota deixar de
 * identificar o que promete identificar.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * A DECISÃO DA CAPACIDADE DA BASE, LIDA DO ARTEFATO — nunca inferida, nunca suposta.
 *
 * Gêmea de `lerDecisaoDoCutover`, e pela mesma razão: o arquivo é gravado por
 * `scripts/skew-capacidade-top.mjs` (o mesmo passo que exporta a variável) e carrega o insumo que produziu
 * a decisão. Ausência do arquivo é FALHA, não "então é o mundo legado" — supor o ramo fácil é justamente
 * como um gate se autoaprova.
 */
function lerDecisaoDaCapacidadeTop(): { baseSha: string; ocorrencias: number; capaz: boolean } {
  const arq = path.resolve(__dirname, "../../..", ".skew-capacidade-top.json");
  if (!fs.existsSync(arq)) {
    throw new Error(`decisão da capacidade de TOP ausente (${arq}): rode scripts/skew-capacidade-top.mjs antes do skew. `
      + "Sem ela não há como saber qual ramo provar, e escolher o mais fácil seria certificar o que não se mediu.");
  }
  return JSON.parse(fs.readFileSync(arq, "utf8"));
}

/**
 * RECALCULA o ramo a partir do insumo gravado e CONFERE a variável de ambiente contra ele.
 *
 * `SKEW_BASE_TEM_TOP` é string mutável: um `env:` de workflow prevalece sobre o que o passo escreveu em
 * `$GITHUB_ENV`. Se ela fosse a autoridade, fixá-la por fora trocaria o ramo com o log do CI afirmando o
 * contrário — exatamente o interruptor que o cutover do contador já levou de red team. Aqui ela só
 * CONFERE: divergência REPROVA em vez de escolher.
 */
function baseTemCapacidadeTop(): boolean {
  const d = lerDecisaoDaCapacidadeTop();
  expect(d.ocorrencias, "contagem ambígua não decide ramo nenhum — o produtor deveria ter reprovado antes").toBeLessThanOrEqual(1);
  const capaz = d.ocorrencias === 1;
  expect(capaz, "o artefato tem de ser coerente com a própria decisão que carrega").toBe(d.capaz);
  expect(process.env.SKEW_BASE_TEM_TOP ?? (capaz ? "1" : "0"),
    "SKEW_BASE_TEM_TOP não bate com a decisão recalculada — alguém fixou a variável por fora")
    .toBe(capaz ? "1" : "0");
  console.log(`[skew] TOP-CONFIG-02 · base ${d.baseSha} ${capaz ? "TEM" : "NÃO tem"} a descoberta de capacidade (ocorrências=${d.ocorrencias})`);
  return capaz;
}

test("TOP-CONFIG-02 · a descoberta de capacidade, medida contra o binário real da base", async ({ page }) => {
  await login(page);
  const s = await sessao(page);
  const cabecalhos = { Authorization: `Bearer ${s.token}`, "X-Org-Id": s.orgId! };
  const capaz = baseTemCapacidadeTop();

  // premissa viva: a rota de listagem da MESMA variante funciona neste binário. Sem ela, um 500 abaixo
  // poderia ser servidor caído, e o teste mediria outra coisa.
  expect((await page.request.get(`${API}/api/sales/budgets?pageSize=1`, { headers: cabecalhos })).status(),
    "premissa: a API da base serve a listagem de orçamentos").toBe(200);

  for (const variante of ["budgets", "orders", "sales"]) {
    const r = await page.request.get(`${API}/api/sales/${variante}/operation-types`, { headers: cabecalhos });

    if (!capaz) {
      // MUNDO LEGADO — a prova original da #47, preservada.
      //
      // A base não tem a rota estática, mas tem `${base}/:id`; o roteador casa o nó paramétrico,
      // "operation-types" entra num `where d.id=$1` de coluna `uuid`, o Postgres devolve 22P02,
      // `fromPgError` não mapeia 22P02, e o cliente recebe 500. Se um dia a base passar a devolver 404
      // (porque ganhou validação de uuid), este teste reprova e o cliente é revisto junto — que é o ponto.
      expect(r.status(), `a API da base NÃO tem /api/sales/${variante}/operation-types`).not.toBe(200);
      expect(r.status(), `medido contra o binário da base: /api/sales/${variante}/operation-types`).toBe(500);
      continue;
    }

    // MUNDO ATUAL — a base JÁ serve a descoberta, e o que se cobra é a FORMA do contrato que o cliente lê.
    expect(r.status(), `a árvore da base registra a rota, então o binário tem de servi-la: /api/sales/${variante}/operation-types`).toBe(200);
    const corpo = await r.json() as { contractVersion?: number; family?: { code?: string }; items?: unknown; defaultId?: unknown };
    expect(corpo.contractVersion, "é por este número que o cliente distingue 'ausente' de 'presente com outro formato'").toBe(1);
    expect(corpo.family?.code, `a família canônica da variante ${variante} tem de vir declarada`).toBeTruthy();
    expect(Array.isArray(corpo.items), "`items` é a lista de TOPs aceitas — vazia é legítimo, ausente não").toBe(true);
    expect(corpo, "`defaultId` é declarado; null é resposta legítima, ausente não é").toHaveProperty("defaultId");
  }
});

test("TOP-CONFIG-02 · sobre a API da base, a tela de lançamento não perde a TOP em silêncio", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const capaz = baseTemCapacidadeTop();

  const posts: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/sales/")) posts.push(r.url()); });

  await page.goto("/vendas/sales/new");

  if (!capaz) {
    /**
     * MUNDO LEGADO — a prova que o mock não dava: com o SERVIDOR REAL da base, a tela chega ao estado de
     * bloqueio, e não ao estado "pronto" com o campo vazio, que gravaria um documento sem TOP em silêncio.
     */
    await expect(page.getByTestId("top-nao-confirmado")).toBeVisible();
    await expect(page.getByTestId("top-ausente"), "não é problema de configuração, é do servidor").toHaveCount(0);
    /**
     * A TOP-CONFIG-02B trocou a âncora, e para melhor: antes se exigia `Salvar` DESABILITADO; agora o
     * formulário nem é montado sem operação confirmada, então o que se cobra é que ele NÃO EXISTA. É uma
     * afirmação mais forte — um `disabled` some com uma linha removida por engano; um componente que não
     * está na árvore não tem botão para reabilitar.
     */
    await expect(page.getByTestId("top-lancador"), "a etapa de escolha está na tela").toBeVisible();
    await expect(page.getByTestId("top-contexto"), "o formulário NÃO pode ter montado contra a API da base").toHaveCount(0);
    await expect(page.getByTestId("top-continuar"), "sem lista confirmada não há como continuar").toHaveCount(0);
    expect(posts, "ZERO POST contra a API da base: é isto que impede a perda silenciosa").toEqual([]);
    v.semBloqueio();
    return;
  }

  /**
   * MUNDO ATUAL — a propriedade simétrica, e a que importa daqui para a frente: o web deste HEAD reconhece
   * a capacidade da API da base e NÃO a trata como servidor antigo. `top-nao-confirmado` é o estado "não
   * consegui perguntar"; vê-lo aqui significaria que o cliente desistiu da descoberta contra um servidor
   * que responde — e passaria a bloquear lançamento por um defeito que não existe.
   *
   * `top-ausente` é aceitável e não se confunde com aquilo: é "perguntei, e esta organização não tem TOP
   * ativa para a variante" — configuração, não incompatibilidade. Exigir TOP semeada aqui seria cobrar do
   * cenário uma garantia que ele não dá.
   */
  await expect(page.getByTestId("top-nao-confirmado"),
    "a base responde a descoberta: tratá-la como servidor antigo é o defeito que este ramo procura").toHaveCount(0);

  /**
   * E UMA ASSERÇÃO POSITIVA, porque a de cima sozinha é VÁCUO.
   *
   * `toHaveCount(0)` é satisfeito de graça por uma tela que não renderizou nada — inclusive por uma tela
   * quebrada. Sem uma afirmação sobre o que EXISTE, este ramo viraria verde permanente, que é o modo de
   * falhar que `.claude/rules/testing-gates.md` chama de reprovação.
   *
   * O que se exige, então, é que a etapa de escolha esteja de pé contra o binário real da base. A LISTA
   * em si não é exigida: o cenário não garante TOP cadastrada, e `top-ausente` (nenhuma TOP ativa) é
   * resposta legítima de um servidor capaz. O lançador estar montado é o que distingue "o web entendeu a
   * API da base" de "o web desistiu".
   */
  await expect(page.getByTestId("top-lancador"), "o lançador monta contra a API da base — o web reconheceu a capacidade").toBeVisible();
  await expect(page.getByTestId("top-erro"), "e não é um erro explicado pelo servidor").toHaveCount(0);
  expect(posts, "a tela não dispara POST sozinha, em nenhum dos dois mundos").toEqual([]);
  v.semBloqueio();
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * TOP-CONFIG-04A — A EXECUÇÃO CONFIGURADA, COM O WEB DESTE HEAD SOBRE A API DA BASE
 *
 * O web desta PR sabe gravar o formato 2 da configuração (o bloco `execucao`). Contra uma API que não
 * declara o bloco, ele tem de se comportar como cliente do formato 1: esconder a área de execução, gravar
 * no formato 1 — e nunca depender de a API "aceitar e ignorar" o formato novo. A prova de que isso importa
 * é medida no binário real: a API da base RECUSA o formato 2, explicitamente.
 *
 * O mundo é MEDIDO na árvore da base (`scripts/lib/execucao-top.mjs`) e cada um cobra a sua prova; nenhum
 * dos dois ramos só passa.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

function baseDeclaraExecucaoTop(): boolean {
  const arq = path.resolve(__dirname, "../../..", ".skew-execucao-top.json");
  if (!fs.existsSync(arq)) {
    throw new Error(`decisão da execução configurada ausente (${arq}): rode scripts/skew-execucao-top.mjs antes do skew. `
      + "Sem ela não há como saber qual ramo provar, e escolher o mais fácil seria certificar o que não se mediu.");
  }
  const d = JSON.parse(fs.readFileSync(arq, "utf8")) as { baseSha: string; ocorrencias: number; declara: boolean };
  expect(d.ocorrencias, "contagem ambígua não decide ramo nenhum — o produtor deveria ter reprovado antes").toBeLessThanOrEqual(1);
  const declara = d.ocorrencias === 1;
  expect(declara, "o artefato tem de ser coerente com a própria decisão que carrega").toBe(d.declara);
  expect(process.env.SKEW_BASE_TEM_EXECUCAO_TOP ?? (declara ? "1" : "0"),
    "SKEW_BASE_TEM_EXECUCAO_TOP não bate com a decisão recalculada — alguém fixou a variável por fora").toBe(declara ? "1" : "0");
  console.log(`[skew] TOP-CONFIG-04A · base ${d.baseSha} ${declara ? "DECLARA" : "NÃO declara"} a execução configurada (ocorrências=${d.ocorrencias})`);
  return declara;
}

test("TOP-CONFIG-04A · a execução configurada, medida contra o binário real da base", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const s = await sessao(page);
  const cabecalhos = { Authorization: `Bearer ${s.token}`, "X-Org-Id": s.orgId!, "Content-Type": "application/json" };
  const declara = baseDeclaraExecucaoTop();

  const cap = await page.request.get(`${API}/api/admin/tipos-operacao/capabilities`, { headers: cabecalhos });
  expect(cap.status(), "premissa: a base serve as capacidades da administração de TOP").toBe(200);
  const capacidades = await cap.json() as { contractVersion?: number; execucao?: { suportado?: boolean; versaoSchema?: number } };
  expect(capacidades.contractVersion, "o contrato que o web lê continua o 1, nos dois mundos").toBe(1);

  // Uma TOP criada PELA API DA BASE — o que ela grava é a verdade daquele binário.
  const codigo = `SK${Date.now().toString(36).toUpperCase()}`;
  const criada = await page.request.post(`${API}/api/admin/tipos-operacao`, { headers: cabecalhos,
    data: { codigo, codigoBase: "vendas.venda", nome: `Skew execução ${codigo}` } });
  expect(criada.status(), await criada.text()).toBe(201);
  const id = (await criada.json() as { id: string }).id;
  const detalhe = async () => (await (await page.request.get(`${API}/api/admin/tipos-operacao/${id}`, { headers: cabecalhos })).json()) as
    { versao: number; revisao: number; configuracaoSchema: number; configuracao: { valor: Record<string, unknown> } };

  // A MESMA TELA, nos dois mundos: o editor da TOP, aberto pela busca.
  const abrirEditor = async () => {
    await page.goto("/configuracoes?tab=operacoes&sub=tipos-operacao");
    await page.getByLabel("Buscar tipo de operação").fill(codigo);
    const linha = page.getByRole("row").filter({ hasText: codigo });
    await expect(linha).toHaveCount(1);
    await linha.getByRole("button", { name: "Mais opções" }).click();
    await page.getByRole("menuitem", { name: "Editar" }).click();
    const forma = page.getByTestId("form-tipo-operacao");
    await expect(forma).toBeVisible();
    await forma.getByTestId("top-aba-execucao").click();
    return forma;
  };

  if (!declara) {
    // MUNDO LEGADO. A base não conhece o formato 2: não o declara, grava o 1 e RECUSA o 2 com o código de
    // skew — o que prova que o web não pode depender de "aceitar e ignorar".
    expect(capacidades.execucao, "a base não declara o bloco `execucao`").toBeUndefined();
    const d = await detalhe();
    expect(d.configuracaoSchema, "a base grava o formato 1").toBe(1);
    const formato2 = { ...d.configuracao.valor, versaoSchema: 2, execucao: { estoque: "legado", financeiro: "legado" } };
    const recusa = await page.request.put(`${API}/api/admin/tipos-operacao/${id}`, { headers: cabecalhos, data: { configuracao: formato2, revisao: d.revisao } });
    expect(recusa.status(), "a base RECUSA o formato 2 — explicitamente").toBe(422);
    expect(((await recusa.json()) as { error: { code: string } }).error.code).toBe("TIPO_OPERACAO_CONFIGURACAO_SCHEMA_NAO_SUPORTADO");

    // O web deste HEAD, sobre essa base: a área diz que o servidor não oferece execução, e a gravação sai
    // no formato 1 — sem `execucao` no corpo.
    const forma = await abrirEditor();
    await expect(forma.getByTestId("top-execucao-nao-suportado"), "a tela diz que este servidor não oferece execução").toBeVisible();
    await expect(forma.getByTestId("top-campo-execucao-estoque"), "e nenhum seletor de execução é oferecido").toHaveCount(0);
    const corpos: unknown[] = [];
    page.on("request", (r) => { if (r.method() === "PUT" && r.url().includes(`/api/admin/tipos-operacao/${id}`)) corpos.push(r.postDataJSON()); });
    await forma.getByTestId("top-aba-geral").click();
    await forma.getByTestId("top-campo-geral-observacao").selectOption("true");
    const resposta = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(`/api/admin/tipos-operacao/${id}`));
    await forma.getByTestId("top-salvar").click();
    expect((await resposta).status(), "a base aceita o que o web enviou").toBe(200);
    expect(corpos, "uma gravação").toHaveLength(1);
    const enviada = (corpos[0] as { configuracao: Record<string, unknown> }).configuracao;
    expect(enviada.versaoSchema, "o web gravou no formato que a base conhece").toBe(1);
    expect("execucao" in enviada, "e sem o bloco que ela recusaria").toBe(false);
    const depois = await detalhe();
    expect([depois.versao, depois.configuracaoSchema], "a base criou a versão 2, no formato 1").toEqual([d.versao + 1, 1]);
    v.semBloqueio();
    return;
  }

  // MUNDO ATUAL. A base declara o bloco; o web o reconhece e mostra a área — não a trata como servidor antigo.
  expect(capacidades.execucao, "a árvore da base declara o bloco, então o binário tem de servi-lo").toMatchObject({ suportado: true, versaoSchema: 2 });
  const forma = await abrirEditor();
  await expect(forma.getByTestId("top-execucao"), "a área de execução monta contra a base").toBeVisible();
  await expect(forma.getByTestId("top-execucao-nao-suportado"), "e a base não é tratada como servidor antigo").toHaveCount(0);
  v.semBloqueio();
});
