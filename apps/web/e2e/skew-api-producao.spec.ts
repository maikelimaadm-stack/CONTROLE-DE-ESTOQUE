import { test, expect, type Page } from "@playwright/test";
import { login, uniq, pickRef, abrirLancamentoDeVendas, escolherTopEContinuar, escolherPrimeiroProdutoDaLinha, preencherClassificacaoFinanceira } from "./helpers";
import { criarEmpresaEConferirContador, provarContadorIncompativel } from "./skew-contador-empresa";
import { baseTemFatiaDeCadastro, cpfValido } from "./skew-fichas-cadastro";
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

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * VENDAS-A1 — A CLASSIFICAÇÃO FINANCEIRA, COM O WEB DESTE HEAD SOBRE A API DA BASE
 *
 * O web desta PR sabe mostrar e enviar `categoria_financeira_id`/`centro_custo_id`. Contra uma API que
 * não DECLARA que os entende, ele não pode fazer nenhuma das duas coisas: o `docSchema` da base é
 * `z.object` sem `.strict()` e DESCARTA os dois em silêncio — o usuário escolheria a classificação, leria
 * "salvo" e o documento nasceria sem ela. Por isso a prova do mundo legado é NO FIO: o corpo do POST que
 * saiu do navegador, não o estado da tela.
 *
 * O mundo é MEDIDO na árvore da base (`scripts/lib/classificacao-financeira.mjs`) e cada um cobra a sua
 * prova; nenhum dos dois ramos só passa.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

function baseDeclaraClassificacao(): boolean {
  const arq = path.resolve(__dirname, "../../..", ".skew-classificacao-financeira.json");
  if (!fs.existsSync(arq)) {
    throw new Error(`decisão da classificação financeira ausente (${arq}): rode scripts/skew-classificacao-financeira.mjs antes do skew. `
      + "Sem ela não há como saber qual ramo provar, e escolher o mais fácil seria certificar o que não se mediu.");
  }
  const d = JSON.parse(fs.readFileSync(arq, "utf8")) as { baseSha: string; ocorrencias: number; declara: boolean };
  expect(d.ocorrencias, "contagem ambígua não decide ramo nenhum — o produtor deveria ter reprovado antes").toBeLessThanOrEqual(1);
  const declara = d.ocorrencias === 1;
  expect(declara, "o artefato tem de ser coerente com a própria decisão que carrega").toBe(d.declara);
  expect(process.env.SKEW_BASE_TEM_CLASSIFICACAO ?? (declara ? "1" : "0"),
    "SKEW_BASE_TEM_CLASSIFICACAO não bate com a decisão recalculada — alguém fixou a variável por fora").toBe(declara ? "1" : "0");
  console.log(`[skew] VENDAS-A1 · base ${d.baseSha} ${declara ? "DECLARA" : "NÃO declara"} a classificação financeira (ocorrências=${d.ocorrencias})`);
  return declara;
}

test("VENDAS-A1 · A1-K1 — sem a capacidade declarada pela base, os campos não aparecem e NÃO viajam no POST", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const s = await sessao(page);
  const cabecalhos = { Authorization: `Bearer ${s.token}`, "X-Org-Id": s.orgId!, "Content-Type": "application/json" };
  const declara = baseDeclaraClassificacao();

  // A descoberta, lida do binário real: é ela que o web consulta para decidir.
  const desc = await page.request.get(`${API}/api/sales/sales/operation-types`, { headers: cabecalhos });
  expect(desc.status(), "premissa: a base serve a descoberta da TOP de venda").toBe(200);
  const corpoDesc = await desc.json() as { contractVersion?: number; capacidades?: { classificacaoFinanceira?: unknown } };
  expect(corpoDesc.contractVersion, "a declaração é ADITIVA: o contrato que o web da base compara continua o 1").toBe(1);

  // Uma TOP criada PELA API DA BASE, para o lançamento ter o que escolher nos dois mundos.
  const codigo = `SC${Date.now().toString(36).toUpperCase()}`;
  const criada = await page.request.post(`${API}/api/admin/tipos-operacao`, { headers: cabecalhos, data: { codigo, codigoBase: "vendas.venda", nome: `Skew classificação ${codigo}` } });
  expect(criada.status(), await criada.text()).toBe(201);
  const topId = (await criada.json() as { id: string }).id;

  await abrirLancamentoDeVendas(page, "sales");
  await escolherTopEContinuar(page, topId);
  const dados = page.getByTestId("central-vendas").getByRole("region", { name: "Dados principais" });
  await expect(dados.locator("label", { hasText: "Forma de pagamento" }), "premissa: o formulário montou").toBeVisible();
  await pickRef(page, "Cliente", "DEMO");
  await page.getByRole("button", { name: /Adicionar item/ }).click();
  await escolherPrimeiroProdutoDaLinha(page);
  const salvar = page.getByRole("button", { name: "Salvar" });

  if (!declara) {
    // MUNDO LEGADO. A base não declara; o web não oferece o que ela jogaria fora.
    expect(corpoDesc.capacidades?.classificacaoFinanceira, "a base não declara a capacidade").toBeUndefined();
    await expect(dados.locator("label", { hasText: "Natureza" }), "o campo não aparece").toHaveCount(0);
    await expect(dados.locator("label", { hasText: "Centro de resultado" }), "o campo não aparece").toHaveCount(0);
    await expect(salvar, "o Salvar segue a regra de antes: cliente e item bastam").toBeEnabled();

    // NO FIO: o POST vai de verdade para a base, e o corpo que saiu do navegador não carrega o par.
    const resposta = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/sales\/sales$/.test(new URL(r.url()).pathname));
    await salvar.click();
    const r = await resposta;
    expect(r.status(), "a base aceita o que o web enviou").toBe(201);
    const enviado = r.request().postDataJSON() as Record<string, unknown>;
    expect(enviado["tipo_operacao_id"], "premissa: o corpo capturado é o deste lançamento").toBe(topId);
    expect(Object.keys(enviado).filter((k) => k === "categoria_financeira_id" || k === "centro_custo_id"),
      "o par NÃO viaja para uma API que o descartaria em silêncio").toEqual([]);
    v.semBloqueio();
    return;
  }

  // MUNDO ATUAL. A base declara a versão que o web conhece; os campos aparecem e voltam a ser exigidos.
  expect(corpoDesc.capacidades?.classificacaoFinanceira, "a árvore da base declara, então o binário tem de servir").toBe(1);
  await expect(dados.locator("label", { hasText: "Natureza" })).toBeVisible();
  await expect(dados.locator("label", { hasText: "Centro de resultado" })).toBeVisible();
  await expect(salvar, "declarada, a classificação é exigida").toBeDisabled();
  await preencherClassificacaoFinanceira(page);
  await expect(salvar).toBeEnabled();
  v.semBloqueio();
});

/**
 * A1-K3 — A GUARDA NO BANCO CONTRA O BINÁRIO DA BASE.
 *
 * O harness comporta este caso: o banco do skew é migrado e semeado pelo HEAD (0024 e a guarda incluídas) e
 * o servidor é o binário da base — exatamente o estado de uma REVERSÃO da API depois de a 0024 subir, ou de
 * uma instância anterior ainda no pool. A venda classificada é PREPARADA NO BANCO, porque a API da base não
 * sabe gravar a classificação (descartaria os campos); é o único jeito honesto de ela existir aqui.
 */
const DB_SKEW = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, "/agro_erp_e2e") ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_e2e";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function sql(comando: string): string {
  return execFileSync("psql", [DB_SKEW, "-v", "ON_ERROR_STOP=1", "-Atc", comando], { encoding: "utf8" }).trim();
}

test("VENDAS-A1 · A1-K3 — a API da base não confirma venda classificada; a sem classificação confirma", async ({ page }) => {
  await login(page);
  const s = await sessao(page);
  const cabecalhos = { Authorization: `Bearer ${s.token}`, "X-Org-Id": s.orgId!, "Content-Type": "application/json" };
  const declara = baseDeclaraClassificacao();

  const um = async (p: string) => {
    const r = await page.request.get(`${API}${p}`, { headers: cabecalhos });
    expect(r.status(), p).toBe(200);
    const id = (await r.json() as { items: { id: string }[] }).items?.[0]?.id;
    expect(id, `o seed precisa ter registro em ${p}`).toBeTruthy();
    return id!;
  };
  const ctx = await (await page.request.get(`${API}/api/auth/context`, { headers: cabecalhos })).json() as { empresas: { id: string }[] };
  const empresa = s.empresaId ?? ctx.empresas[0]!.id;
  const cliente = await um("/api/resources/people?is_client=true&pageSize=1");
  const produto = await um("/api/resources/products?pageSize=1");
  // Duas vendas pela API DA BASE, com o corpo que ela conhece (sem classificação, sem armazém — o efeito
  // que interessa aqui é o título, e é por ele que a classificação importa).
  const criarVenda = async () => {
    const r = await page.request.post(`${API}/api/sales/sales`, { headers: cabecalhos, data: {
      empresa_id: empresa, document_date: "2026-09-01", client_id: cliente,
      items: [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }] } });
    expect(r.status(), await r.text()).toBe(201);
    const id = (await r.json() as { id: string }).id;
    expect(id, "o id vem da API e entra no SQL — tem de ser um UUID").toMatch(UUID);
    return id;
  };
  const classificada = await criarVenda();
  const semClassificacao = await criarVenda();

  // A classificação PREPARADA NO BANCO: a analítica de receita e o centro analítico da própria organização.
  const preparada = sql(`update erp.sales_documents d set
      categoria_financeira_id = (select c.id from erp.financial_categories c where c.organization_id = d.organization_id and c.kind = 'analytic' and c.nature = 'income' and c.is_active and c.deleted_at is null order by c.code limit 1),
      centro_custo_id = (select cc.id from erp.cost_centers cc where cc.organization_id = d.organization_id and cc.kind = 'analytic' and cc.is_active and cc.deleted_at is null order by cc.code limit 1)
    where d.id = '${classificada}' returning (categoria_financeira_id is not null and centro_custo_id is not null)`);
  expect(preparada.split("\n")[0], "premissa: a venda ficou classificada no banco").toBe("t");
  expect(sql(`select count(*) from pg_trigger where tgrelid = 'erp.sales_documents'::regclass and not tgisinternal and tgenabled <> 'D' and tgfoid = 'erp.venda_classificacao_financeira_guarda'::regproc`),
    "premissa: a guarda da 0024 está no banco e habilitada").toBe("1");

  const confirmar = (id: string) => page.request.post(`${API}/api/sales/sales/${id}/confirm`, { headers: cabecalhos, data: {} });
  const situacao = (id: string) => sql(`select status from erp.sales_documents where id = '${id}'`);

  const recusa = await confirmar(classificada);
  if (!declara) {
    // MUNDO LEGADO: o binário da base não grava a marca, então a guarda RECUSA — com o código que ele mapeia.
    expect(recusa.status(), "a base NÃO confirma a venda classificada pela 'primeira por código'").toBe(422);
    const erro = ((await recusa.json()) as { error: { code: string; message: string } }).error;
    expect(erro.code).toBe("VALIDATION_ERROR");
    // A recusa é a da GUARDA da 0024, e não outra validação qualquer da base: a mensagem é a do gatilho.
    expect(erro.message, "quem recusou foi a guarda da classificação").toContain("classificacao financeira");
    expect(situacao(classificada), "e nada mudou: a venda continua aberta").toBe("open");
  } else {
    // MUNDO ATUAL: a base já aplica a classificação e grava a marca; a mesma venda confirma.
    expect(recusa.status(), await recusa.text()).toBe(200);
    expect(situacao(classificada)).toBe("confirmed");
  }

  // A venda SEM classificação confirma nos dois mundos — a guarda só recusa quem ignoraria a classificação.
  const ok = await confirmar(semClassificacao);
  expect(ok.status(), await ok.text()).toBe(200);
  expect(situacao(semClassificacao)).toBe("confirmed");
});

/* ───────────────────────────────────────────────────────────────────────────────────────────────────
 * VENDAS-A1 · R1 — A CONVERSÃO E O DETALHE CONTRA O BINÁRIO DA BASE (A1-K4, A1-K5)
 *
 * Mesmo harness de A1-K3: banco migrado e semeado pelo HEAD, servidor = binário da base. Os documentos
 * nascem PELA API DA BASE, com o corpo que ela conhece; a classificação é PREPARADA NO BANCO, porque a base
 * descartaria o par no POST e é o único jeito honesto de um documento classificado existir diante dela.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────── */
type Insumos = { empresa: string; cliente: string; produto: string };

/** Empresa, cliente e produto do seed, lidos pela própria API da base — o que ela aceitar no POST é o que ela vê. */
async function insumosDoDocumento(page: Page, cabecalhos: Record<string, string>, empresaDaSessao: string | null | undefined): Promise<Insumos> {
  const um = async (p: string) => {
    const r = await page.request.get(`${API}${p}`, { headers: cabecalhos });
    expect(r.status(), p).toBe(200);
    const id = (await r.json() as { items: { id: string }[] }).items?.[0]?.id;
    expect(id, `o seed precisa ter registro em ${p}`).toBeTruthy();
    return id!;
  };
  const ctx = await (await page.request.get(`${API}/api/auth/context`, { headers: cabecalhos })).json() as { empresas: { id: string }[] };
  return { empresa: empresaDaSessao ?? ctx.empresas[0]!.id, cliente: await um("/api/resources/people?is_client=true&pageSize=1"), produto: await um("/api/resources/products?pageSize=1") };
}

/**
 * Um documento criado PELA API DA BASE: sem classificação e sem TOP. Sem TOP a conversão cai na ponte legada
 * (orçamento → pedido → venda), que é o caminho que TODO binário anterior percorre — não uma política
 * configurada que só este cenário teria.
 */
async function criarPelaBase(page: Page, cabecalhos: Record<string, string>, variante: "budgets" | "orders" | "sales", i: Insumos): Promise<string> {
  const r = await page.request.post(`${API}/api/sales/${variante}`, { headers: cabecalhos, data: {
    empresa_id: i.empresa, document_date: "2026-09-01", client_id: i.cliente,
    items: [{ product_id: i.produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }] } });
  expect(r.status(), await r.text()).toBe(201);
  const id = (await r.json() as { id: string }).id;
  expect(id, "o id vem da API e entra no SQL — tem de ser um UUID").toMatch(UUID);
  return id;
}

/**
 * A classificação PREPARADA NO BANCO — a mesma escolha de A1-K3 (a analítica de receita e o centro analítico
 * da própria organização, pelo código), só que devolvendo o PAR: A1-K4 compara o derivado com ele, e A1-K5
 * compara o fio da base com ele. `status = 'open'` no filtro porque os dois casos falam de documento ABERTO:
 * se o documento não estivesse aberto, a preparação falharia aqui em vez de mudar o cenário em silêncio.
 */
function classificarNoBanco(id: string): { categoria: string; centro: string } {
  const linha = sql(`update erp.sales_documents d set
      categoria_financeira_id = (select c.id from erp.financial_categories c where c.organization_id = d.organization_id and c.kind = 'analytic' and c.nature = 'income' and c.is_active and c.deleted_at is null order by c.code limit 1),
      centro_custo_id = (select cc.id from erp.cost_centers cc where cc.organization_id = d.organization_id and cc.kind = 'analytic' and cc.is_active and cc.deleted_at is null order by cc.code limit 1)
    where d.id = '${id}' and d.status = 'open' returning categoria_financeira_id, centro_custo_id`).split("\n")[0] ?? "";
  const [categoria = "", centro = ""] = linha.split("|");
  expect(categoria, "premissa: o documento aberto ficou com a categoria no banco").toMatch(UUID);
  expect(centro, "premissa: o documento aberto ficou com o centro de custo no banco").toMatch(UUID);
  return { categoria, centro };
}

/**
 * A1-K4 — A GUARDA DA CONVERSÃO CONTRA O BINÁRIO DA BASE (R1-1).
 *
 * A base converte orçamento e pedido montando o derivado CAMPO A CAMPO (`docSchema.parse` sem o par): ela
 * não conhece a classificação e não a copia. Sem a guarda, o pedido — e depois a venda — nasceriam SEM
 * classificação a partir de uma origem classificada, e a venda derivada escaparia da guarda da confirmação
 * (A1-K3), que só olha a PRÓPRIA venda: a classificação escolhida se perderia no meio da cadeia e a venda
 * confirmaria pelo padrão automático. Quem fecha a porta é o gatilho `trg_sales_documents_classificacao_conversao`
 * da 0024: a conversão pela base é recusada INTEIRA — a origem não vira `converted` e nenhum derivado nasce.
 *
 * As DUAS variantes que convertem são medidas (orçamento → pedido, pedido → venda): a guarda é do INSERT do
 * derivado, e uma prova só com orçamento deixaria sem medição o elo pedido → venda — o que produz a venda que,
 * confirmada, gera o título.
 *
 * O NOME VALE NOS DOIS RAMOS, pelo mesmo motivo do caso do contador: o relatório mostra só o título, e um nome
 * que afirmasse só a recusa passaria verde no mundo em que a base CONVERTE. Qual ramo rodou sai no log da decisão.
 */
test("VENDAS-A1 · A1-K4 — conversão pela API da base: origem classificada é recusada sem derivado (ou, se a base já copia o par, converte com ele); a sem classificação converte", async ({ page }) => {
  await login(page);
  const s = await sessao(page);
  const cabecalhos = { Authorization: `Bearer ${s.token}`, "X-Org-Id": s.orgId!, "Content-Type": "application/json" };
  const declara = baseDeclaraClassificacao();

  expect(sql(`select count(*) from pg_trigger where tgrelid = 'erp.sales_documents'::regclass and not tgisinternal and tgenabled <> 'D' and tgfoid = 'erp.venda_classificacao_financeira_conversao_guarda'::regproc`),
    "premissa: a guarda da conversão da 0024 está no banco e habilitada").toBe("1");
  const insumos = await insumosDoDocumento(page, cabecalhos, s.empresaId);

  const DESTINO = { budgets: "order", orders: "sale" } as const;
  const situacao = (id: string) => sql(`select status from erp.sales_documents where id = '${id}'`);
  // O derivado é contado pelo PONTEIRO para a origem, no banco: a resposta de erro não diz o que deixou de
  // gravar, e "nenhum derivado" só é prova se for lido de onde um derivado estaria.
  const derivados = (id: string) => sql(`select count(*) from erp.sales_documents where origin_document_id = '${id}'`);

  for (const variante of ["budgets", "orders"] as const) {
    const classificada = await criarPelaBase(page, cabecalhos, variante, insumos);
    const semClassificacao = await criarPelaBase(page, cabecalhos, variante, insumos);
    const par = classificarNoBanco(classificada);
    // O corpo que a base aceita na conversão: `{ tipo_operacao_id? }`. Vazio = ponte legada, sem TOP de destino.
    const converter = (id: string) => page.request.post(`${API}/api/sales/${variante}/${id}/convert`, { headers: cabecalhos, data: {} });

    const r = await converter(classificada);
    if (!declara) {
      // MUNDO LEGADO: a base monta o derivado sem o par, e a guarda RECUSA o INSERT — com o código que a base
      // já mapeia para 422 (`fromPgError`, P0001), sem nenhuma linha nova nela.
      expect(r.status(), `a base NÃO converte ${variante} classificado: ${await r.text()}`).toBe(422);
      const erro = ((await r.json()) as { error: { code: string; message: string } }).error;
      expect(erro.code).toBe("VALIDATION_ERROR");
      // A recusa é a da guarda da CONVERSÃO — não a da confirmação (A1-K3), nem outra validação qualquer da base.
      expect(erro.message, "quem recusou foi a guarda da conversão").toContain("o documento de origem tem classificacao financeira, que este servidor nao copia");
      expect(situacao(classificada), "a transação voltou inteira: a origem continua aberta").toBe("open");
      expect(derivados(classificada), "e nenhum derivado nasceu").toBe("0");
    } else {
      // MUNDO ATUAL: a base já copia o par; a mesma origem converte e o derivado nasce com ELE — não com outro.
      expect(r.status(), await r.text()).toBe(201);
      expect((await r.json() as { kind: string }).kind).toBe(DESTINO[variante]);
      expect(situacao(classificada)).toBe("converted");
      expect(derivados(classificada)).toBe("1");
      expect(sql(`select categoria_financeira_id, centro_custo_id from erp.sales_documents where origin_document_id = '${classificada}'`),
        "o derivado herdou o MESMO par da origem").toBe(`${par.categoria}|${par.centro}`);
    }

    // A PREMISSA — o mesmo cenário sem a classificação: mesma variante, mesma rota, mesmo corpo, mesmo binário.
    // Converte nos dois mundos. Sem isto, o "zero derivado" acima poderia ser uma conversão que a base não faz
    // por motivo nenhum ligado à classificação (permissão, política, rota) — e a guarda não teria provado nada.
    const ok = await converter(semClassificacao);
    expect(ok.status(), await ok.text()).toBe(201);
    const derivado = await ok.json() as { id: string; kind: string };
    expect(derivado.kind, "a ponte legada leva ao próximo da cadeia").toBe(DESTINO[variante]);
    expect(situacao(semClassificacao), "a origem sem classificação virou convertida").toBe("converted");
    expect(derivados(semClassificacao), "e nasceu exatamente um derivado").toBe("1");
    expect(sql(`select categoria_financeira_id is null and centro_custo_id is null from erp.sales_documents where id = '${derivado.id}'`),
      "sem nada a copiar, o derivado nasce sem classificação — a guarda só recusa quem PERDERIA o par").toBe("t");
  }
});

/**
 * A1-K5 — O DETALHE DESTE WEB SOBRE A RESPOSTA DA BASE (R1-2).
 *
 * O GET do documento na base é `select d.*`: os IDS da classificação vêm (as colunas existem no banco migrado
 * pelo HEAD), o código e o nome NÃO (o join com categoria e centro só existe no binário desta fatia em diante).
 * Uma tela que decidisse "está classificada?" pelo código diria "Não informada" e prometeria o padrão
 * automático numa venda que a guarda do banco vai RECUSAR confirmar (A1-K3) — o operador leria uma instrução
 * que o servidor desmente. A medição é contra o FIO REAL da base, capturado da própria tela, e não contra um
 * corpo fabricado.
 */
test("VENDAS-A1 · A1-K5 — venda classificada lida da API da base: o detalhe não diz 'Não informada' nem promete o padrão automático", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const s = await sessao(page);
  const cabecalhos = { Authorization: `Bearer ${s.token}`, "X-Org-Id": s.orgId!, "Content-Type": "application/json" };
  const declara = baseDeclaraClassificacao();
  const insumos = await insumosDoDocumento(page, cabecalhos, s.empresaId);
  const classificada = await criarPelaBase(page, cabecalhos, "sales", insumos);
  const semClassificacao = await criarPelaBase(page, cabecalhos, "sales", insumos);
  const par = classificarNoBanco(classificada);

  const central = page.getByTestId("central-vendas");
  const campo = (rotulo: string) => central.locator(`[data-campo="${rotulo}"]`);
  const aviso = page.getByTestId("classificacao-padrao-automatico");
  /** Abre o detalhe e devolve o corpo que a BASE respondeu à própria tela — o fio, não uma releitura. */
  const abrirDetalhe = async (id: string) => {
    const resposta = page.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname === `/api/sales/sales/${id}`);
    await page.goto(`/vendas/sales/${id}`);
    const r = await resposta;
    expect(r.status(), "premissa: a base serviu o detalhe").toBe(200);
    const corpo = await r.json() as Record<string, unknown>;
    await expect(central).toBeVisible();
    await expect(campo("Número"), "premissa: a tela desenhou ESTE documento").toContainText(String(corpo["code"]));
    return corpo;
  };

  // A PREMISSA DO AVISO — o mesmo cenário sem a classificação: venda aberta, mesma base, mesmo web. Aqui o aviso
  // APARECE; sem isto, a contagem zero do caso classificado seria satisfeita por uma tela que nunca o desenha.
  const fioSem = await abrirDetalhe(semClassificacao);
  expect([fioSem["categoria_financeira_id"], fioSem["centro_custo_id"], fioSem["status"]], "premissa: venda aberta e sem classificação").toEqual([null, null, "open"]);
  await expect(campo("Natureza")).toContainText("Não informada");
  await expect(campo("Centro de resultado")).toContainText("Não informado");
  await expect(aviso, "sem classificação, a venda aberta avisa o padrão automático — também sobre a base").toBeVisible();

  const fio = await abrirDetalhe(classificada);
  expect(fio["status"], "premissa: a venda classificada continua aberta — é nela que o aviso seria mostrado").toBe("open");
  expect([fio["categoria_financeira_id"], fio["centro_custo_id"]], "o fio da base traz os ids preparados no banco").toEqual([par.categoria, par.centro]);

  if (!declara) {
    // MUNDO LEGADO — NO FIO: a base traz o id e não traz o código nem o nome. É exatamente o corpo que a regra
    // "decide pelo id" existe para ler certo. Se a base passasse a mandar o código sem declarar a capacidade,
    // este ramo REPROVA aqui, e a decisão do mundo é revista junto — em vez de seguir verde medindo outro corpo.
    expect(fio, "a base NÃO traz o código da categoria").not.toHaveProperty("categoria_financeira_codigo");
    expect(fio, "nem o do centro de custo").not.toHaveProperty("centro_custo_codigo");
    // A positiva vem primeiro: ela espera a tela desenhar ESTE documento, e só então as ausências significam algo.
    await expect(campo("Natureza"), "com o id e sem o nome, a tela diz que está informada").toContainText("Informada");
    await expect(campo("Natureza"), "e não o contrário").not.toContainText("Não informada");
    await expect(campo("Centro de resultado")).toContainText("Informado");
    await expect(campo("Centro de resultado")).not.toContainText("Não informado");
    await expect(aviso, "classificada, a venda não promete um padrão que a guarda recusaria").toHaveCount(0);
    v.semBloqueio();
    return;
  }

  // MUNDO ATUAL — a base já faz o join: a tela mostra "código · nome" do que está gravado, lidos do banco.
  const [rotuloCategoria = "", rotuloCentro = ""] = sql(`select c.code || ' · ' || c.name, cc.code || ' · ' || cc.name
      from erp.financial_categories c, erp.cost_centers cc where c.id = '${par.categoria}' and cc.id = '${par.centro}'`).split("|");
  // Rótulo vazio faria o `toContainText` abaixo passar em qualquer tela: a leitura tem de ter trazido os dois.
  expect([rotuloCategoria, rotuloCentro], "premissa: código e nome lidos do banco").toEqual([expect.stringMatching(/^.+ · .+$/), expect.stringMatching(/^.+ · .+$/)]);
  expect(fio["categoria_financeira_codigo"], "a árvore da base declara a classificação, então o binário traz o código").toBeTruthy();
  await expect(campo("Natureza")).toContainText(rotuloCategoria);
  await expect(campo("Centro de resultado")).toContainText(rotuloCentro);
  await expect(campo("Natureza")).not.toContainText("Não informada");
  await expect(campo("Centro de resultado")).not.toContainText("Não informado");
  await expect(aviso, "classificada, a venda não fala de padrão automático").toHaveCount(0);
  v.semBloqueio();
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * VENDAS-A5-1 · A5-K1 — O DIÁLOGO "CONFIRMAR VENDA" DESTE WEB CONTRA A API DA BASE.
 *
 * O web desta PR pergunta à rota `GET /api/sales/sales/:id/previa-confirmacao` o que a confirmação vai fazer.
 * Na janela em que o Vercel sobe antes do Railway, quem responde é o binário da base — e, se ele não declara a
 * rota, a resposta é 404. O que não pode acontecer: o diálogo ficar "carregando" para sempre, tratar a
 * ausência como recusa (botão desabilitado em toda venda) ou prometer efeito que ninguém previu. O que tem de
 * acontecer: texto NEUTRO, botão HABILITADO, a confirmação funcionando pela base, e o aviso do detalhe na
 * regra da A1 (venda aberta sem classificação), porque sem a prévia a tela não sabe mais do que isso.
 *
 * O mundo é MEDIDO na árvore da base (`scripts/lib/previa-confirmacao.mjs`) e cada um cobra a sua prova;
 * nenhum dos dois ramos só passa. A venda classificada diante da base já é o caso A1-K5 (sem aviso).
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

function baseServePrevia(): boolean {
  const arq = path.resolve(__dirname, "../../..", ".skew-previa-confirmacao.json");
  if (!fs.existsSync(arq)) {
    throw new Error(`decisão da prévia da confirmação ausente (${arq}): rode scripts/skew-previa-confirmacao.mjs antes do skew. `
      + "Sem ela não há como saber qual ramo provar, e escolher o mais fácil seria certificar o que não se mediu.");
  }
  const d = JSON.parse(fs.readFileSync(arq, "utf8")) as { baseSha: string; ocorrencias: number; serve: boolean };
  expect(d.ocorrencias, "contagem ambígua não decide ramo nenhum — o produtor deveria ter reprovado antes").toBeLessThanOrEqual(1);
  const serve = d.ocorrencias === 1;
  expect(serve, "o artefato tem de ser coerente com a própria decisão que carrega").toBe(d.serve);
  // A decisão tem de ser a DESTA árvore: um arquivo sobrado de outra base decidiria sobre o binário errado.
  expect(d.baseSha, "a decisão foi medida na base que está servindo").toBe(fs.readFileSync(path.resolve(__dirname, "../../..", ".api-anterior.base"), "utf8").trim());
  expect(process.env.SKEW_BASE_TEM_PREVIA_CONFIRMACAO ?? (serve ? "1" : "0"),
    "SKEW_BASE_TEM_PREVIA_CONFIRMACAO não bate com a decisão recalculada — alguém fixou a variável por fora").toBe(serve ? "1" : "0");
  console.log(`[skew] VENDAS-A5-1 · base ${d.baseSha} ${serve ? "SERVE" : "NÃO serve"} a prévia da confirmação (ocorrências=${d.ocorrencias})`);
  return serve;
}

/** O texto NEUTRO do diálogo sem prévia — por extenso: é o contrato com o usuário. */
const TEXTO_SEM_PREVIA = "A confirmação aplica o Tipo de Operação desta venda. Não foi possível carregar a prévia dos efeitos; o servidor recusa o que não puder executar.";
/** O aviso da A1 quando a tela não tem a prévia — a regra decidida pelo id. */
const AVISO_A1 = "Sem classificação: ao confirmar, a venda usará o padrão automático (primeira natureza de receita e primeiro centro de resultado analíticos, pela ordem do código).";

test("VENDAS-A5-1 · A5-K1 — contra a API da base, o diálogo de confirmação cai no texto neutro com o botão habilitado e confirma (ou, se a base já serve a prévia, mostra a prévia)", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const s = await sessao(page);
  const cabecalhos = { Authorization: `Bearer ${s.token}`, "X-Org-Id": s.orgId!, "Content-Type": "application/json" };
  const serve = baseServePrevia();
  const insumos = await insumosDoDocumento(page, cabecalhos, s.empresaId);
  // Uma venda PELA BASE, sem classificação e sem TOP: o caso em que o aviso da A1 aparece e a base confirma.
  const id = await criarPelaBase(page, cabecalhos, "sales", insumos);
  const caminho = `/api/sales/sales/${id}/previa-confirmacao`;
  const ehPrevia = (r: { request(): { method(): string }; url(): string }) => r.request().method() === "GET" && new URL(r.url()).pathname === caminho;

  // O FIO, medido direto no binário da base — é isto que a tela vai receber.
  const direto = await page.request.get(`${API}${caminho}`, { headers: cabecalhos });

  const central = page.getByTestId("central-vendas");
  const aviso = page.getByTestId("classificacao-padrao-automatico");
  const dlg = page.getByTestId("confirm-dialog");
  const botao = dlg.getByTestId("confirm-dialog-confirm");
  const avisoPedido = page.waitForResponse(ehPrevia);
  await page.goto(`/vendas/sales/${id}`);
  await expect(central).toBeVisible();
  const lida = await (await page.request.get(`${API}/api/sales/sales/${id}`, { headers: cabecalhos })).json() as { code: string; status: string; categoria_financeira_id: string | null };
  expect([lida.status, lida.categoria_financeira_id], "premissa: venda aberta e sem classificação na base").toEqual(["open", null]);
  await expect(central.locator('[data-campo="Número"]'), "premissa: a tela desenhou ESTE documento").toContainText(lida.code);
  const rAviso = await avisoPedido;

  /** Abre o diálogo e devolve a resposta da pergunta que ELE fez — a espera nasce antes do clique que a dispara. */
  const abrirDialogo = async () => {
    const pedido = page.waitForResponse(ehPrevia);
    await central.getByTestId("central-vendas-acoes").getByRole("button", { name: "Confirmar venda" }).click();
    await expect(dlg.getByRole("heading", { name: "Confirmar venda" })).toBeVisible();
    return pedido;
  };
  const confirmar = async () => {
    const resposta = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/sales/sales/${id}/confirm`);
    await botao.click();
    expect((await resposta).status(), "a base confirmou o pedido deste web").toBe(200);
    expect(sql(`select status from erp.sales_documents where id = '${id}'`), "no banco: confirmada").toBe("confirmed");
  };

  if (!serve) {
    // MUNDO LEGADO — NO FIO: a base não tem a rota, e responde 404 à tela (a pergunta do aviso e a do diálogo).
    expect(direto.status(), "a base não declara a rota da prévia").toBe(404);
    expect(rAviso.status(), "o aviso perguntou e a base respondeu 404").toBe(404);
    await expect(aviso, "sem prévia, o aviso segue a regra da A1").toHaveText(AVISO_A1);
    expect((await abrirDialogo()).status(), "o diálogo perguntou ao abrir e a base respondeu 404").toBe(404);
    await expect(dlg.getByTestId("previa-confirmacao-neutra")).toHaveText(TEXTO_SEM_PREVIA);
    await expect(dlg.getByTestId("previa-confirmacao"), "nenhum efeito prometido").toHaveCount(0);
    await expect(dlg.getByTestId("previa-confirmacao-carregando"), "e não fica 'carregando' para sempre").toHaveCount(0);
    await expect(botao, "o botão fica HABILITADO: quem recusa é o servidor").toBeEnabled();
    await confirmar();
    v.semBloqueio();
    return;
  }

  // MUNDO ATUAL — a base já serve a prévia: o diálogo a mostra, em vez de tratar a base como servidor antigo.
  expect(direto.status(), "a árvore da base declara a rota, então o binário responde").toBe(200);
  const corpo = await direto.json() as { contractVersion: number; podeConfirmar: boolean };
  expect([corpo.contractVersion, corpo.podeConfirmar]).toEqual([1, true]);
  expect(rAviso.status()).toBe(200);
  await expect(aviso, "com a prévia, o aviso nomeia o par").toContainText("padrão automático — natureza");
  expect((await abrirDialogo()).status()).toBe(200);
  await expect(dlg.getByTestId("previa-confirmacao")).toBeVisible();
  await expect(dlg.getByTestId("previa-confirmacao-neutra"), "a base não é tratada como servidor antigo").toHaveCount(0);
  await expect(botao).toBeEnabled();
  await confirmar();
  v.semBloqueio();
});

/* ───────────────────────────────────────────────────────────────────────────────────────────────────
 * CADASTROS-ESTRUTURA (decisão 250) e FASES 4 a 6 · WEB NOVA × API DA BASE — os casos 3 e 4 da janela de deploy
 *
 * POR QUE ESTES CASOS TÊM DOIS RAMOS, E POR QUE ISSO NÃO É AFROUXAMENTO
 * ----------------------------------------------------------------------
 * Este bloco nasceu na #62 afirmando que "a base NUNCA terá os campos novos do Grupo (code/kind/parent_id) nem
 * o produto sem categoria/classe" e que, por isso, o comportamento era FIXO e não precisava de decisão medida.
 * Era uma verdade COM PRAZO: valia enquanto a base de uma PR era anterior à #62 e deixou de valer no instante em
 * que a #62 entrou na `main`. A partir daí a base de toda PR JÁ TEM o schema e o contrato de escrita novos — a
 * recusa 422 que CE-K3, CE-K4, PA-K1, RH-K1 e PR-K1 cobravam passou a ser 201/200, e o job ficou vermelho para
 * qualquer PR, inclusive uma de diff vazio, sem nenhuma linha de código quebrar.
 *
 * O ramo não se escolhe por SHA digitado nem por interruptor: mede-se a ÁRVORE DA BASE desta execução — a
 * migration de cada fatia, pelo nome (`scripts/lib/fichas-cadastro.mjs`, lido por `skew-fichas-cadastro.ts`) — e
 * cada mundo cobra a SUA prova:
 *
 *   base SEM a migration → exatamente a prova original: a recusa é DECLARADA (422, nada gravado) — a janela
 *                          fecha para o lado seguro, nunca grava um produto, grupo ou parceiro pela metade;
 *   base COM a migration → a prova positiva: a base ACEITA o corpo da web nova com o status exato e GRAVA os
 *                          valores que vieram, conferidos no banco por SQL — nunca "qualquer 2xx".
 *
 * Nenhum dos dois ramos só passa. A decisão volta sozinha ao mundo legado se a #62 for revertida, e REPROVA se a
 * assinatura deixar de identificar a fatia. O NOME de cada caso vale nos dois ramos; qual rodou sai no log.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────── */
async function cabecalhosDaSessao(page: Page) {
  const s = await sessao(page);
  return { Authorization: `Bearer ${s.token}`, "X-Org-Id": s.orgId!, "Content-Type": "application/json" };
}

test("CADASTROS-ESTRUTURA · CE-K3 — produto e grupo com o corpo da web NOVA: a base sem a 0025 RECUSA (422) e nada é gravado; a base com a 0025 aceita e grava o que veio", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const temArvore = baseTemFatiaDeCadastro("grupoArvore", "CE-K3");
  const grupoAnalitico = sql("select id from erp.product_groups where kind = 'analytic' and deleted_at is null and code is not null order by code limit 1");
  expect(grupoAnalitico, "premissa: o banco (migrado pelo HEAD) tem grupo analítico").toMatch(UUID);
  const unidade = sql("select id from erp.measurement_units where organization_id is null and symbol = 'un'");
  expect(unidade, "premissa: a unidade 'un' existe").toMatch(UUID);

  // (3a) PRODUTO: a web nova não manda category_id nem kind_id.
  const desc = uniq("CE-K3 produto web nova");
  const p = await page.request.post(`${API}/api/resources/products`, { headers: cab, data: { description: desc, measurement_id: unidade, group_id: grupoAnalitico, control_stock: false, is_active: true } });
  if (!temArvore) {
    // MUNDO LEGADO — a base os exige.
    expect(p.status(), await p.text()).toBe(422);
    const campos = ((await p.json()) as { error: { details?: { path: string | string[] }[] } }).error.details?.map((d) => String(d.path)) ?? [];
    expect(campos, "a recusa aponta os campos que a base exige").toEqual(expect.arrayContaining(["category_id", "kind_id"]));
    expect(sql(`select count(*) from erp.products where description = '${desc.replace(/'/g, "''")}'`), "nada gravado").toBe("0");
  } else {
    // MUNDO ATUAL — a 0025 soltou categoria e classe: a base grava o produto como veio, SEM inventar as duas.
    expect(p.status(), await p.text()).toBe(201);
    const id = (await p.json() as { id: string }).id;
    expect(id, "o id vem da API e entra no SQL — tem de ser um UUID").toMatch(UUID);
    expect(sql(`select concat_ws('|', description, group_id, measurement_id, coalesce(category_id::text, 'sem categoria'), coalesce(kind_id::text, 'sem classe'), control_stock) from erp.products where id = '${id}'`),
      "gravado como veio: o grupo e a unidade enviados, sem categoria e sem classe").toBe(`${desc}|${grupoAnalitico}|${unidade}|sem categoria|sem classe|f`);
  }

  const nome = uniq("CE-K3 grupo web nova");
  if (!temArvore) {
    // (3b) GRUPO, MUNDO LEGADO: code/kind/parent_id não existem para a base, cujo schema é .strict() → 422, não descarte.
    const g = await page.request.post(`${API}/api/resources/product_groups`, { headers: cab, data: { code: "9.99", name: nome, kind: "analytic", parent_id: null, is_active: true } });
    expect(g.status(), await g.text()).toBe(422);
    expect(sql(`select count(*) from erp.product_groups where name = '${nome.replace(/'/g, "''")}'`), "nada gravado").toBe("0");
    return;
  }
  // (3b) GRUPO, MUNDO ATUAL. Contra uma base sem `codigoAutomatico` (decisão 257 D-1) a web nova mostra o Código
  // DIGITÁVEL com a sugestão DA BASE e o envia junto com o superior — é esse o corpo que ela manda. O superior é o
  // primeiro grupo sintético raiz do seed: a raiz só comporta nove códigos de um dígito e se esgotaria em banco
  // reaproveitado; debaixo de um sintético há 99.
  const superior = sql("select id from erp.product_groups where kind = 'synthetic' and parent_id is null and deleted_at is null and code is not null order by code limit 1");
  expect(superior, "premissa: o seed tem um grupo sintético na raiz").toMatch(UUID);
  const sugestao = await page.request.get(`${API}/api/resources/product_groups/proximo-codigo?parent_id=${superior}`, { headers: cab });
  expect(sugestao.status(), "a base com a 0025 sugere o código do grupo").toBe(200);
  const { codigo } = await sugestao.json() as { codigo: string };
  expect(codigo, "premissa: a sugestão é um código de verdade, debaixo do superior").toMatch(/^\d+\.\d+$/);
  const g = await page.request.post(`${API}/api/resources/product_groups`, { headers: cab, data: { code: codigo, name: nome, kind: "analytic", parent_id: superior, is_active: true } });
  expect(g.status(), await g.text()).toBe(201);
  const grupo = (await g.json() as { id: string }).id;
  expect(grupo, "o id vem da API e entra no SQL — tem de ser um UUID").toMatch(UUID);
  expect(sql(`select concat_ws('|', code, name, kind, parent_id) from erp.product_groups where id = '${grupo}' and deleted_at is null`),
    "gravado como veio: código, nome, tipo e superior").toBe(`${codigo}|${nome}|analytic|${superior}`);
});

test("CADASTROS-ESTRUTURA · CE-K4 — parâmetros: máscara de Grupos recusada pela base sem a 0025 (422) ou gravada pela base com a 0025; sem ela, salva normal", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const temArvore = baseTemFatiaDeCadastro("grupoArvore", "CE-K4");
  const antes = sql("select coalesce(parameters->'mascaras_codigo'->>'product_groups', '<nada>') from erp.organizations o join erp.organization_members m on m.organization_id = o.id join erp.users u on u.id = m.user_id where u.email = 'admin@demo.local' limit 1");
  if (!temArvore) {
    // MUNDO LEGADO: a base não conhece o cadastro `product_groups` na máscara → 422, nada muda.
    const recusa = await page.request.put(`${API}/api/admin/parameters`, { headers: cab, data: { mascaras_codigo: { product_groups: "9.99.999" } } });
    expect(recusa.status(), await recusa.text()).toBe(422);
    expect(sql("select coalesce(parameters->'mascaras_codigo'->>'product_groups', '<nada>') from erp.organizations o join erp.organization_members m on m.organization_id = o.id join erp.users u on u.id = m.user_id where u.email = 'admin@demo.local' limit 1"), "nada mudou").toBe(antes);
    const ok = await page.request.put(`${API}/api/admin/parameters`, { headers: cab, data: { mascaras_codigo: { chart_accounts: "9.99.999.9999" } } });
    expect(ok.status(), await ok.text()).toBe(200);
    return;
  }

  // MUNDO ATUAL: a base conhece a máscara de Grupos e a GRAVA. O valor enviado é DIFERENTE do que já está lá —
  // senão a conferência no banco passaria sem a gravação ter acontecido.
  const org = (await sessao(page)).orgId ?? "";
  expect(org, "o id vem da sessão e entra no SQL — tem de ser um UUID").toMatch(UUID);
  const mascarasAntes = sql(`select coalesce((parameters->'mascaras_codigo')::text, 'null') from erp.organizations where id = '${org}'`);
  const nova = antes === "9.99.999" ? "9.9.99" : "9.99.999";
  try {
    const gravada = await page.request.put(`${API}/api/admin/parameters`, { headers: cab, data: { mascaras_codigo: { product_groups: nova } } });
    expect(gravada.status(), await gravada.text()).toBe(200);
    expect(sql(`select coalesce(parameters->'mascaras_codigo'->>'product_groups', '<nada>') from erp.organizations where id = '${org}'`), "a base gravou a máscara de Grupos que veio").toBe(nova);
    // E o corpo sem ela salva normal, como no mundo legado — a mesma porta, sem a chave nova.
    const ok = await page.request.put(`${API}/api/admin/parameters`, { headers: cab, data: { mascaras_codigo: { chart_accounts: "9.99.999.9999" } } });
    expect(ok.status(), await ok.text()).toBe(200);
    expect(sql(`select coalesce(parameters->'mascaras_codigo'->>'chart_accounts', '<nada>') from erp.organizations where id = '${org}'`), "e grava o que veio").toBe("9.99.999.9999");
  } finally {
    // O banco do skew é o MESMO nos dois sentidos, e a máscara de Grupos decide o código que o sentido 2 vai
    // gerar: devolve as máscaras exatamente como estavam, em vez de deixar o cenário diferente do semeado.
    const literal = mascarasAntes.replace(/'/g, "''");
    sql(`update erp.organizations set parameters = case when '${literal}'::jsonb = 'null'::jsonb then parameters - 'mascaras_codigo'
        else jsonb_set(parameters, '{mascaras_codigo}', '${literal}'::jsonb) end where id = '${org}'`);
  }
  expect(sql(`select coalesce((parameters->'mascaras_codigo')::text, 'null') from erp.organizations where id = '${org}'`), "as máscaras voltaram ao que eram").toBe(mascarasAntes);
});

test("CADASTROS FASE 2 · IM-K1 — `modo=parcial` contra a API da base: recusa com 'Campo não reconhecido' (o que a tela reconhece) e nada é gravado; sem `modo`, a base importa como sempre", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  // o próprio modelo da base, vazio: arquivo válido que nenhuma versão grava
  const modelo = await page.request.get(`${API}/api/imports/financial_categories/modelo`, { headers: cab });
  expect(modelo.status()).toBe(200);
  const arquivo_base64 = (await modelo.body()).toString("base64");
  const antes = sql("select count(*) from erp.financial_categories");
  const r = await page.request.post(`${API}/api/imports/financial_categories?simular=1&modo=parcial`, { headers: cab, data: { arquivo_base64 } });
  expect(r.status(), await r.text()).toBe(422);
  const corpo = (await r.json()) as { error?: { code?: string; details?: { message?: string }[] }; modo?: string };
  if (corpo.error) {
    // base anterior à Fase 2: é EXATAMENTE este corpo que o diálogo traduz para "use Importar tudo"
    expect(corpo.error.code).toBe("VALIDATION_ERROR");
    expect(corpo.error.details?.map((d) => d.message)).toContain("Campo não reconhecido");
  } else {
    // base que já tem a Fase 2: aceita o modo e recusa o arquivo vazio pela leitura
    expect(corpo.modo).toBe("parcial");
  }
  // sem `modo` (prévia e "Importar tudo" da web nova): a base responde como sempre — arquivo vazio, 422 pela leitura
  const semModo = await page.request.post(`${API}/api/imports/financial_categories?simular=1`, { headers: cab, data: { arquivo_base64 } });
  expect(semModo.status(), await semModo.text()).toBe(422);
  expect(((await semModo.json()) as { erros?: { mensagem: string }[] }).erros?.[0]?.mensagem).toBe("Nenhuma linha preenchida.");
  expect(sql("select count(*) from erp.financial_categories"), "nada gravado").toBe(antes);
});

test("CADASTROS FASE 4 · PA-K1 — ficha de Parceiro da web NOVA contra a API da base: sem a 0027, grades e perfis RECUSADOS (422, schema estrito) e nada gravado; com a 0027, gravados como vieram; o corpo só do principal grava", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const temFicha = baseTemFatiaDeCadastro("fichaParceiro", "PA-K1");
  const nome = uniq("PA-K1 parceiro web nova");
  const r = await page.request.post(`${API}/api/resources/people`, { headers: cab, data: {
    name: nome, person_type: "legal", is_client: true, enderecos: [{ tipo: "entrega", logradouro: "Rua A" }], perfil_cliente: { limite_credito: "100" } } });
  if (!temFicha) {
    // MUNDO LEGADO: a base não conhece as chaves da ficha.
    expect(r.status(), await r.text()).toBe(422);
    const erro = ((await r.json()) as { error: { details?: { message?: string }[] } }).error;
    expect(erro.details?.map((d) => d.message), "a base não conhece as chaves da ficha").toContain("Campo não reconhecido");
    expect(sql(`select count(*) from erp.people where name = '${nome.replace(/'/g, "''")}'`), "nada gravado").toBe("0");
  } else {
    // MUNDO ATUAL: a base com a 0027 grava o principal, a grade e o perfil — lidos de onde cada um mora.
    expect(r.status(), await r.text()).toBe(201);
    const id = (await r.json() as { id: string }).id;
    expect(id, "o id vem da API e entra no SQL — tem de ser um UUID").toMatch(UUID);
    expect(sql(`select concat_ws('|', name, person_type, is_client) from erp.people where id = '${id}' and deleted_at is null`), "o principal").toBe(`${nome}|legal|t`);
    expect(sql(`select string_agg(concat_ws('|', tipo, logradouro), ';') from erp.parceiro_enderecos where person_id = '${id}' and deleted_at is null`), "a grade de endereços, exatamente a enviada").toBe("entrega|Rua A");
    expect(sql(`select limite_credito::text from erp.client_profiles where person_id = '${id}'`), "o perfil de cliente com o limite enviado").toBe("100.00");
    // o dado de teste fica excluído logicamente (nunca apagado), para o corpo só do principal abaixo não repetir o nome de um vivo
    sql(`update erp.people set deleted_at = now() where id = '${id}'`);
  }
  const ok = await page.request.post(`${API}/api/resources/people`, { headers: cab, data: { name: nome, person_type: "legal", is_client: true } });
  expect(ok.status(), await ok.text()).toBe(201);
});

test("CADASTROS FASE 5 · RH-K1 — ficha de RH da web NOVA contra a API da base: sem a 0028, RECUSADA (a base não conhece `funcionarios` nem o novo pelo CPF) e nada gravado; com a 0028, o novo pelo CPF e a admissão gravam", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const temRh = baseTemFatiaDeCadastro("rhFuncionarios", "RH-K1");
  const antes = sql("select count(*) from erp.people");
  if (!temRh) {
    // MUNDO LEGADO: nenhuma das três rotas existe na base.
    const novo = await page.request.post(`${API}/api/hr/funcionarios/por-cpf`, { headers: cab, data: { document: "390.533.447-05", name: uniq("RH-K1") } });
    expect(novo.status(), await novo.text()).toBe(404);
    const id = sql("select id from erp.people where is_employee and deleted_at is null order by code limit 1");
    expect((await page.request.get(`${API}/api/resources/funcionarios/${id}`, { headers: cab })).status()).toBe(404);
    const put = await page.request.put(`${API}/api/resources/funcionarios/${id}`, { headers: cab, data: { rh_admissao: { matricula: "RH-K1" } } });
    expect(put.status(), await put.text()).toBe(404);
    expect(sql("select count(*) from erp.people"), "nada gravado").toBe(antes);
    return;
  }

  // MUNDO ATUAL: a base com a 0028 faz o caminho inteiro da web nova. CPF GERADO a cada execução: o banco do skew
  // é reaproveitado, e um CPF fixo viraria "já existe" (200, criado=false) na segunda — outro caminho, não este.
  const cpf = cpfValido();
  const nome = uniq("RH-K1");
  const novo = await page.request.post(`${API}/api/hr/funcionarios/por-cpf`, { headers: cab, data: { document: cpf, name: nome } });
  expect(novo.status(), await novo.text()).toBe(201);
  const criado = await novo.json() as { id: string; criado: boolean };
  expect(criado.criado, "CPF novo: o parceiro nasce agora").toBe(true);
  expect(criado.id, "o id vem da API e entra no SQL — tem de ser um UUID").toMatch(UUID);
  expect(sql(`select concat_ws('|', document, name, is_employee) from erp.people where id = '${criado.id}' and deleted_at is null`), "gravado como Funcionário, com o CPF e o nome enviados").toBe(`${cpf}|${nome}|t`);
  expect(sql("select count(*) from erp.people"), "exatamente um parceiro novo").toBe(String(Number(antes) + 1));
  const lido = await page.request.get(`${API}/api/resources/funcionarios/${criado.id}`, { headers: cab });
  expect(lido.status(), await lido.text()).toBe(200);
  expect((await lido.json() as { id: string }).id, "a ficha lida é a deste funcionário").toBe(criado.id);
  const matricula = `RHK1-${Date.now().toString(36).toUpperCase()}`;
  const put = await page.request.put(`${API}/api/resources/funcionarios/${criado.id}`, { headers: cab, data: { rh_admissao: { matricula } } });
  expect(put.status(), await put.text()).toBe(200);
  expect(sql(`select matricula from erp.employee_profiles where person_id = '${criado.id}'`), "a admissão gravou a matrícula enviada").toBe(matricula);
  // o dado de teste fica excluído logicamente (nunca apagado)
  sql(`update erp.people set deleted_at = now() where id = '${criado.id}'`);
});

test("CADASTROS FASE 6 · PR-K1 — ficha de Produto da web NOVA contra a API da base: sem a 0029, controle de lote, colunas e grades novas RECUSADOS (422, schema estrito) e nada gravado; com a 0029, gravados como vieram", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const temFicha = baseTemFatiaDeCadastro("fichaProduto", "PR-K1");
  const grupo = sql("select id from erp.product_groups where deleted_at is null and kind = 'analytic' order by code limit 1");
  const unidade = sql("select id from erp.measurement_units where upper(symbol) = 'UN' order by organization_id nulls last limit 1");
  const natureza = sql("select id from erp.financial_categories where deleted_at is null and kind = 'analytic' and nature = 'expense' order by code limit 1");
  const nome = uniq("PR-K1 produto web nova");
  if (!temFicha) {
    // MUNDO LEGADO: a base não conhece os campos da ficha.
    const r = await page.request.post(`${API}/api/resources/products`, { headers: cab, data: {
      description: nome, group_id: grupo, measurement_id: unidade, financial_category_id: natureza, controle_lote: "lote", marca: "X",
      unidades: [{ measurement_id: unidade, tipo_fator: "multiply", fator: "2" }] } });
    expect(r.status(), await r.text()).toBe(422);
    const erro = ((await r.json()) as { error: { details?: { message?: string }[] } }).error;
    expect(erro.details?.map((d) => d.message), "a base não conhece os campos da ficha").toContain("Campo não reconhecido");
    expect(sql(`select count(*) from erp.products where description = '${nome.replace(/'/g, "''")}'`), "nada gravado").toBe("0");
    return;
  }

  // MUNDO ATUAL: a base com a 0029 grava a ficha. A unidade ALTERNATIVA é outra que não a padrão — a web nova não
  // deixa repetir a padrão e a base, com a 0029, recusa essa repetição por conta própria ("A unidade alternativa não
  // pode repetir a unidade padrão do produto."); o corpo do ramo legado a repetia porque ali a recusa vinha antes,
  // pelo schema estrito, e o conteúdo da grade nunca chegava a ser lido.
  const kg = sql("select id from erp.measurement_units where upper(symbol) = 'KG' order by organization_id nulls last limit 1");
  expect([grupo, unidade, natureza, kg], "premissas do seed: grupo analítico, UN, natureza de despesa e KG").toEqual([expect.stringMatching(UUID), expect.stringMatching(UUID), expect.stringMatching(UUID), expect.stringMatching(UUID)]);
  const r = await page.request.post(`${API}/api/resources/products`, { headers: cab, data: {
    description: nome, group_id: grupo, measurement_id: unidade, financial_category_id: natureza, controle_lote: "lote", marca: "X",
    unidades: [{ measurement_id: kg, tipo_fator: "multiply", fator: "2" }] } });
  expect(r.status(), await r.text()).toBe(201);
  const id = (await r.json() as { id: string }).id;
  expect(id, "o id vem da API e entra no SQL — tem de ser um UUID").toMatch(UUID);
  expect(sql(`select concat_ws('|', description, group_id, measurement_id, financial_category_id, controle_lote, has_lot, marca) from erp.products where id = '${id}' and deleted_at is null`),
    "o principal e as colunas da ficha, como vieram").toBe(`${nome}|${grupo}|${unidade}|${natureza}|lote|t|X`);
  expect(sql(`select string_agg(concat_ws('|', measurement_id, tipo_fator, fator), ';') from erp.produto_unidades where product_id = '${id}' and deleted_at is null`),
    "a grade de unidades, exatamente a enviada").toBe(`${kg}|multiply|2.000000`);
  // o dado de teste fica excluído logicamente (nunca apagado)
  sql(`update erp.products set deleted_at = now() where id = '${id}'`);
});

/* ───────────────────────────────────────────────────────────────────────────────────────────────────
 * R1-1 c (PR #62) · LT-K1 — LOTE E VALIDADE NA ENTRADA CONTRA A API DA BASE.
 *
 * As telas novas de estoque mandam lote e validade na devolução, validade na correção para cima e validade na
 * produção de ração. Os schemas da API da base NÃO são estritos e DESCARTAM essas chaves em silêncio: a devolução
 * entraria sem lote, e o ajuste para cima gravaria o lote sem a validade (a escolha automática por validade poria
 * esse lote por último) — "passa e corrompe". Por isso a API nova DECLARA `capacidades.loteNaEntrada` em
 * `/auth/context`, e sem a declaração a web não oferece nem envia esses campos.
 *
 * A decisão do ramo sai da ÁRVORE da base (o fonte que o binário roda) e é conferida contra o que o binário
 * responde: uma base que declara e não serve (ou o contrário) reprova — nenhum dos dois ramos é escolhido por
 * conveniência.
 *
 * Ramo LEGADO (a base não declara): (1) correção: o campo Validade não aparece e `expiration_date` não viaja no
 * POST — a base grava o ajuste com o lote; (2) devolução a partir de uma requisição de produto com controle de lote:
 * as colunas Lote/Validade não aparecem, `provider_lot`/`expiration_date` não viajam, e a base RECUSA (422, o gatilho
 * da 0029 exige o lote) sem gravar nada — nunca entra sem lote; (3) produção de ração: a Validade não aparece e
 * `validade` não viaja no POST.
 *
 * Ramo ATUAL (a base declara — é o caso de toda base que já contém a #62). Até aqui este ramo só conferia que os
 * campos APARECEM: uma asserção de presença é satisfeita por uma tela que mostra o campo e o joga fora no envio,
 * que é exatamente o "passa e corrompe" que a capacidade existe para impedir. Ele passa a cobrar, com o mesmo rigor
 * do ramo legado, a outra metade: o que a tela mostra VIAJA no corpo e a base GRAVA, conferido no banco —
 * (1) correção para cima com validade: `expiration_date` no POST, 201, e o movimento de entrada do lote com essa
 * validade; (2) devolução: o lote da requisição viaja, 201, e o movimento da devolução entra NESSE lote (nunca no
 * balde sem lote); (3) produção de ração de um acabado com "lote + validade": a validade viaja, 201, e fica na
 * produção e no movimento de entrada do acabado, cujo lote é o código da produção.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────── */
function baseDeclaraLoteNaEntrada(): boolean {
  const arq = path.resolve(__dirname, "../../..", ".api-anterior/apps/api/src/routes/auth.ts");
  expect(fs.existsSync(arq), `a árvore da base precisa existir (${arq}): scripts/api-anterior.mjs a monta antes do skew`).toBe(true);
  const ocorrencias = fs.readFileSync(arq, "utf8").split("loteNaEntrada: CAPACIDADE_LOTE_NA_ENTRADA").length - 1;
  expect(ocorrencias, "contagem ambígua não decide ramo nenhum").toBeLessThanOrEqual(1);
  console.log(`[skew] R1-1 c · a base ${ocorrencias === 1 ? "DECLARA" : "NÃO declara"} loteNaEntrada`);
  return ocorrencias === 1;
}

test("CADASTROS FASE 6 · LT-K1 — sem `capacidades.loteNaEntrada` da base, correção, devolução e produção não mostram nem enviam lote/validade e a devolução de produto com lote é RECUSADA sem gravar nada; com ela, mostram, enviam e a base grava", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const s = await sessao(page);
  const cab = await cabecalhosDaSessao(page);
  const declara = baseDeclaraLoteNaEntrada();
  const ctx = await (await page.request.get(`${API}/api/auth/context`, { headers: cab })).json() as { capacidades?: { loteNaEntrada?: unknown }; empresas?: { id: string }[] };
  expect(ctx.capacidades?.loteNaEntrada ?? null, "o binário serve exatamente o que a árvore da base declara").toBe(declara ? 1 : null);

  // premissas lidas do banco (migrado pelo HEAD): o produto semeado com lote é "lote" depois da 0029
  const empresaId = await page.evaluate(() => (JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { empresaId?: string | null }).empresaId ?? null) ?? ctx.empresas?.[0]?.id;
  expect(empresaId, "premissa: há empresa visível").toMatch(UUID);
  const produto = sql(`select id from erp.products where organization_id = '${s.orgId}' and description = 'Vacina Aftosa 50 doses' and deleted_at is null`);
  expect(produto, "premissa: o produto semeado com lote existe").toMatch(UUID);
  expect(sql(`select controle_lote from erp.products where id = '${produto}'`), "premissa: controle por lote").toBe("lote");
  const armazem = sql(`select id from erp.warehouses where organization_id = '${s.orgId}' and empresa_id = '${empresaId}' and deleted_at is null and is_active order by created_at limit 1`);
  expect(armazem, "premissa: a empresa ativa tem armazém").toMatch(UUID);

  // fixture pela PRÓPRIA API da base: saldo num lote único e uma requisição dele com o lote informado
  const lote = `LTK1-${Date.now().toString(36).toUpperCase()}`;
  const saldo = await page.request.post(`${API}/api/stock/opening-balances`, { headers: cab, data: { empresa_id: empresaId, warehouse_id: armazem, product_id: produto, quantity: "5", unit_value: "3", provider_lot: lote } });
  expect(saldo.status(), await saldo.text()).toBe(201);
  const req = await page.request.post(`${API}/api/stock/requisitions`, { headers: cab, data: { empresa_id: empresaId, requisition_date: "2026-09-22", items: [{ warehouse_id: armazem, product_id: produto, provider_lot: lote, quantity: "2" }] } });
  expect(req.status(), await req.text()).toBe(201);
  const requisicao = (await req.json() as { id: string }).id;

  // (1) CORREÇÃO, pela ação da linha do saldo (empresa, armazém, produto e lote pré-preenchidos)
  await page.goto(`/estoque?tab=estoque&sub=saldo&product_id=${produto}`);
  await page.getByRole("row").filter({ hasText: lote }).getByRole("button", { name: "Ajustar estoque" }).click();
  const dialogo = page.getByRole("dialog").filter({ hasText: "Ajustar estoque" });
  await expect(dialogo.getByLabel("Lote", { exact: true }), "premissa: o lote veio da linha").toHaveValue(lote);
  if (declara) {
    await expect(dialogo.getByLabel("Validade", { exact: true }), "declarada, a validade aparece").toBeVisible();
    // MUNDO ATUAL: o que a tela mostra VIAJA e a base GRAVA — a presença do campo sozinha não prova nada.
    await dialogo.getByLabel("Nova quantidade").fill("4");
    // o campo de data é o calendário do produto: digita-se dd/mm/aaaa e Enter confirma (o valor vira ISO)
    await dialogo.getByLabel("Validade", { exact: true }).fill("15/03/2099");
    await dialogo.getByLabel("Validade", { exact: true }).press("Enter");
    await dialogo.getByLabel("Justificativa").fill("LT-K1 ajuste para cima com validade");
    const resposta = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/stock/corrections");
    await dialogo.getByRole("button", { name: "Salvar" }).click();
    const r = await resposta;
    const enviado = r.request().postDataJSON() as Record<string, unknown>;
    expect(enviado["provider_lot"], "premissa: o corpo é o deste ajuste").toBe(lote);
    expect(enviado["expiration_date"], "a validade VIAJA para a base que a declara").toBe("2099-03-15");
    expect(r.status(), await r.text()).toBe(201);
    const correcao = (await r.json() as { id: string }).id;
    expect(correcao, "o id vem da API e entra no SQL — tem de ser um UUID").toMatch(UUID);
    expect(sql(`select string_agg(concat_ws('|', movement_type, quantity, provider_lot, expiration_date), ';') from erp.stock_movements where source_id = '${correcao}'`),
      "a base gravou a entrada de 1 no lote, COM a validade enviada").toBe(`correction_in|1.0000|${lote}|2099-03-15`);
  } else {
    await expect(dialogo.getByLabel("Validade", { exact: true }), "o campo que a base descartaria não aparece").toHaveCount(0);
    await dialogo.getByLabel("Nova quantidade").fill("4");
    await dialogo.getByLabel("Justificativa").fill("LT-K1 ajuste para cima");
    const resposta = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/stock/corrections");
    await dialogo.getByRole("button", { name: "Salvar" }).click();
    const r = await resposta;
    const enviado = r.request().postDataJSON() as Record<string, unknown>;
    expect(enviado["provider_lot"], "premissa: o corpo é o deste ajuste").toBe(lote);
    expect("expiration_date" in enviado, "a validade NÃO viaja para uma API que a descartaria").toBe(false);
    expect(r.status(), "a base grava o ajuste com o lote, como sempre").toBe(201);
  }

  // (2) DEVOLUÇÃO a partir da requisição (itens pré-preenchidos com o lote do item)
  const devolucoesAntes = sql(`select count(*) from erp.devolution_items where product_id = '${produto}'`);
  const movimentosAntes = sql(`select count(*) from erp.stock_movements where product_id = '${produto}'`);
  await page.goto(`/estoque/devolucoes/new?requisition_id=${requisicao}`);
  const linhas = page.locator("table tbody tr");
  await expect(linhas, "premissa: a linha da requisição foi pré-preenchida").toHaveCount(1);
  const cabecalhosDaTabela = page.locator("table thead th");
  if (declara) {
    await expect(cabecalhosDaTabela.filter({ hasText: /^Lote$/ })).toHaveCount(1);
    await expect(cabecalhosDaTabela.filter({ hasText: /^Validade$/ })).toHaveCount(1);
    // MUNDO ATUAL: o lote do item da requisição viaja no corpo e a devolução entra NESSE lote, com a validade
    // que viajou junto (a da linha pré-preenchida) — nunca no balde sem lote.
    const resposta = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/stock/devolutions");
    await page.getByRole("button", { name: "Salvar" }).click();
    const r = await resposta;
    const itens = (r.request().postDataJSON() as { items: Record<string, unknown>[] }).items;
    expect(itens.map((i) => i["product_id"]), "premissa: o corpo é o desta devolução").toEqual([produto]);
    expect(itens.map((i) => i["provider_lot"]), "o lote VIAJA para a base que o declara").toEqual([lote]);
    expect(r.status(), await r.text()).toBe(201);
    const devolucao = (await r.json() as { id: string }).id;
    expect(devolucao, "o id vem da API e entra no SQL — tem de ser um UUID").toMatch(UUID);
    const validadeEnviada = typeof itens[0]?.["expiration_date"] === "string" && itens[0]["expiration_date"] ? String(itens[0]["expiration_date"]) : "sem validade";
    expect(sql(`select string_agg(concat_ws('|', movement_type, quantity, provider_lot, coalesce(expiration_date::text, 'sem validade')), ';') from erp.stock_movements where source_id = '${devolucao}'`),
      "a base gravou a devolução de 2 no lote da requisição, com a validade que viajou").toBe(`devolution|2.0000|${lote}|${validadeEnviada}`);
    expect(sql(`select count(*) from erp.devolution_items where product_id = '${produto}'`), "exatamente um item de devolução").toBe(String(Number(devolucoesAntes) + 1));
    expect(sql(`select coalesce(sum(quantity), 0)::text from erp.stock_balances where product_id = '${produto}' and provider_lot = ''`), "o balde sem lote não recebeu nada").toMatch(/^0(\.0+)?$/);
  } else {
    await expect(cabecalhosDaTabela.filter({ hasText: /^Lote$/ }), "a coluna que a base descartaria não aparece").toHaveCount(0);
    await expect(cabecalhosDaTabela.filter({ hasText: /^Validade$/ })).toHaveCount(0);
    const resposta = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/stock/devolutions");
    await page.getByRole("button", { name: "Salvar" }).click();
    const r = await resposta;
    const itens = (r.request().postDataJSON() as { items: Record<string, unknown>[] }).items;
    expect(itens.map((i) => i["product_id"]), "premissa: o corpo é o desta devolução").toEqual([produto]);
    expect(itens.flatMap((i) => Object.keys(i).filter((k) => k === "provider_lot" || k === "expiration_date")), "lote e validade NÃO viajam").toEqual([]);
    // sem lote, o produto com controle NÃO entra no balde sem lote: o gatilho da 0029 recusa, nada gravado
    expect(r.status(), await r.text()).toBe(422);
    expect(sql(`select count(*) from erp.devolution_items where product_id = '${produto}'`), "nenhum item de devolução").toBe(devolucoesAntes);
    expect(sql(`select count(*) from erp.stock_movements where product_id = '${produto}'`), "nenhum movimento").toBe(movimentosAntes);
    expect(sql(`select coalesce(sum(quantity), 0)::text from erp.stock_balances where product_id = '${produto}' and provider_lot = ''`), "o balde sem lote não recebeu nada").toMatch(/^0(\.0+)?$/);
  }

  // (3) PRODUÇÃO DE RAÇÃO: a validade do produto acabado
  const formula = await page.request.post(`${API}/api/stock/feed-formulas`, { headers: cab, data: { name: uniq("LT-K1 formulação"), items: [{ product_id: produto, quantity: "1" }] } });
  expect(formula.status(), await formula.text()).toBe(201);
  const formulaId = (await formula.json() as { id: string }).id;
  await page.goto("/estoque/batidas/new");
  if (declara) {
    await expect(page.getByLabel("Validade do produto acabado"), "declarada, a validade aparece").toBeVisible();
    // MUNDO ATUAL: uma produção de verdade, que a base aceita. O acabado controla "lote + validade" — o caso em
    // que a base EXIGE a validade — e nasce pela própria base (com a 0029 ela conhece `controle_lote`); a
    // formulação passa a produzi-lo. A matéria-prima é o produto semeado, com saldo no armazém da empresa ativa.
    const grupo = sql("select id from erp.product_groups where deleted_at is null and kind = 'analytic' order by code limit 1");
    const un = sql("select id from erp.measurement_units where upper(symbol) = 'UN' order by organization_id nulls last limit 1");
    const natureza = sql("select id from erp.financial_categories where deleted_at is null and kind = 'analytic' and nature = 'expense' order by code limit 1");
    expect([grupo, un, natureza], "premissas do seed: grupo analítico, UN e natureza de despesa").toEqual([expect.stringMatching(UUID), expect.stringMatching(UUID), expect.stringMatching(UUID)]);
    const acabado = await page.request.post(`${API}/api/resources/products`, { headers: cab, data: { description: uniq("LT-K1 ração acabada"), group_id: grupo, measurement_id: un, financial_category_id: natureza, controle_lote: "lote_validade", control_stock: true, is_active: true } });
    expect(acabado.status(), await acabado.text()).toBe(201);
    const acabadoId = (await acabado.json() as { id: string }).id;
    const vinculada = await page.request.put(`${API}/api/stock/feed-formulas/${formulaId}`, { headers: cab, data: { name: uniq("LT-K1 formulação"), product_id: acabadoId, items: [{ product_id: produto, quantity: "1" }] } });
    expect(vinculada.status(), await vinculada.text()).toBe(200);
    const nomeDoArmazem = sql(`select description from erp.warehouses where id = '${armazem}'`);
    await page.reload();
    await page.getByLabel("Formulação").selectOption(formulaId);
    await pickRef(page, "Armazém de matérias-primas", nomeDoArmazem);
    await pickRef(page, "Armazém do produto acabado", nomeDoArmazem);
    await page.getByLabel("Quantidade produzida").fill("1");
    await page.getByLabel("Validade do produto acabado").fill("20/04/2099");
    await page.getByLabel("Validade do produto acabado").press("Enter");
    const resposta = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/stock/feed-batches");
    await page.getByRole("button", { name: "Salvar" }).click();
    const r = await resposta;
    const enviado = r.request().postDataJSON() as Record<string, unknown>;
    expect([enviado["formula_id"], enviado["origin_warehouse_id"], enviado["destination_warehouse_id"]], "premissa: o corpo é o desta produção").toEqual([formulaId, armazem, armazem]);
    expect(enviado["validade"], "a validade VIAJA para a base que a declara").toBe("2099-04-20");
    expect(r.status(), await r.text()).toBe(201);
    const batida = await r.json() as { id: string; code: string };
    expect(batida.id, "o id vem da API e entra no SQL — tem de ser um UUID").toMatch(UUID);
    expect(sql(`select validade::text from erp.feed_batches where id = '${batida.id}'`), "a produção gravou a validade enviada").toBe("2099-04-20");
    expect(sql(`select string_agg(concat_ws('|', product_id, provider_lot, expiration_date), ';') from erp.stock_movements where source_id = '${batida.id}' and movement_type = 'production_in'`),
      "e o acabado entrou no lote = código da produção, com essa validade").toBe(`${acabadoId}|${batida.code}|2099-04-20`);
  } else {
    await expect(page.getByLabel("Validade do produto acabado"), "o campo que a base descartaria não aparece").toHaveCount(0);
    await page.getByLabel("Formulação").selectOption(formulaId);
    await page.getByLabel("Quantidade produzida").fill("1");
    const pedido = page.waitForRequest((q) => q.method() === "POST" && new URL(q.url()).pathname === "/api/stock/feed-batches");
    await page.getByRole("button", { name: "Salvar" }).click();
    const enviado = (await pedido).postDataJSON() as Record<string, unknown>;
    expect(enviado["formula_id"], "premissa: o corpo é o desta produção").toBe(formulaId);
    expect("validade" in enviado, "a validade NÃO viaja para uma API que a descartaria").toBe(false);
  }
  v.semBloqueio();
});

/* ───────────────────────────────────────────────────────────────────────────────────────────────────
 * CADASTROS AJUSTES 01 · AJ-K1..AJ-K3 — o web NOVO contra a API da BASE (seção 7 da missão).
 *
 * A base (d91a772 em produção) responde 500 à busca de referência SEM texto e não declara `codigoAutomatico`,
 * `moverComFilhos` nem `consultaCnpjJanela`. O ramo sai do que o binário DA BASE responde / declara — nunca
 * escolhido por conveniência:
 *   AJ-K1 busca sem texto: 500 → "Não foi possível carregar a lista." + [Tentar de novo]; texto livre nunca
 *         vira valor e não há "digite o código" (isso é só para a rota AUSENTE, 404);
 *   AJ-K2 sem as capacidades: Código digitável com sugestão, Mover só de folha, sem "Numeração dos cadastros";
 *   AJ-K3 ficha de Parceiro: os campos da 0030 não viajam no PUT (a base é estrita: viraria 422).
 * ─────────────────────────────────────────────────────────────────────────────────────────────────── */
function baseDeclaraCapacidade(nome: string): boolean {
  const arq = path.resolve(__dirname, "../../..", ".api-anterior/apps/api/src/routes/auth.ts");
  expect(fs.existsSync(arq), `a árvore da base precisa existir (${arq})`).toBe(true);
  const n = fs.readFileSync(arq, "utf8").split(`${nome}:`).length - 1;
  expect(n, "contagem ambígua não decide ramo nenhum").toBeLessThanOrEqual(1);
  console.log(`[skew] AJUSTES 01 · a base ${n === 1 ? "DECLARA" : "NÃO declara"} ${nome}`);
  return n === 1;
}

test("CADASTROS AJUSTES 01 · AJ-K1 — busca de referência sem texto contra a base: 500 vira \"Tentar de novo\", nunca texto livre", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const direto = await page.request.get(`${API}/api/referencias/bancos?pageSize=30`, { headers: cab });
  const quebrada = direto.status() >= 500;
  console.log(`[skew] AJ-K1 · a base responde ${direto.status()} à busca sem texto`);
  const porCodigo: string[] = [];
  page.on("request", (r) => { if (/\/api\/referencias\/bancos\/[^?]/.test(r.url())) porCodigo.push(r.url()); });
  await page.goto("/cadastros/people/new");
  await page.getByTestId("ficha-em-abas").getByRole("tab", { name: "Financeiro" }).click();
  const campo = page.getByLabel("Banco", { exact: true });
  await campo.click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  if (quebrada) {
    await expect(painel).toContainText("Não foi possível carregar a lista.");
    await expect(page.getByTestId("referencia-tentar-de-novo")).toBeVisible();
    await expect(page.getByTestId("referencia-codigo"), "500 não é rota ausente: nada de \"digite o código\"").toHaveCount(0);
  } else {
    await expect(painel.getByRole("option").first()).toBeVisible();
  }
  await painel.getByLabel("Pesquisar opção").fill("meu banco");
  await page.keyboard.press("Escape");
  await expect(campo).not.toContainText("meu banco");
  expect(porCodigo, "texto livre não virou GET por código").toEqual([]);
});

test("CADASTROS AJUSTES 01 · AJ-K2 — sem codigoAutomatico/moverComFilhos da base: Código digitável com sugestão, Mover só de folha, sem Numeração dos cadastros", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const declara = { codigo: baseDeclaraCapacidade("codigoAutomatico"), mover: baseDeclaraCapacidade("moverComFilhos") };
  const ctx = await (await page.request.get(`${API}/api/auth/context`, { headers: cab })).json() as { capacidades?: Record<string, unknown> };
  expect(ctx.capacidades?.["codigoAutomatico"] ?? null, "o binário serve o que a árvore da base declara").toBe(declara.codigo ? 1 : null);
  expect(ctx.capacidades?.["moverComFilhos"] ?? null).toBe(declara.mover ? 1 : null);
  expect(declara.codigo, "as duas capacidades entram juntas (decisão 257 D): base com uma só é estado que ninguém publicou").toBe(declara.mover);
  if (declara.codigo) {
    // MUNDO ATUAL — a base já é a desta missão: a web nova NÃO trata a base como servidor antigo. Código gerado e
    // só leitura com a prévia, o "Mover…" do galho e a Numeração dos cadastros aparecem.
    const previsto = await (await page.request.get(`${API}/api/resources/financial_categories/proximo-codigo`, { headers: cab })).json() as { codigo: string };
    await page.goto("/cadastros/financial_categories/new");
    await expect(page.getByTestId("codigo-previsto")).toHaveText(`será gerado ao salvar: ${previsto.codigo}`);
    await page.goto("/cadastros/financial_categories?visao=arvore");
    await page.getByTestId("arvore-tela").getByTestId("arvore-no").filter({ hasText: "RECEITAS" }).first().getByRole("button", { name: /RECEITAS/ }).click();
    await expect(page.getByTestId("arvore-mover"), "o Mover do galho, mesmo com filhos").toBeVisible();
    await page.goto("/admin/parametros");
    await expect(page.getByTestId("numeracao-cadastros")).toBeVisible();
    v.semBloqueio();
    return;
  }

  // Código digitável, com a sugestão da base
  const sugestao = await (await page.request.get(`${API}/api/resources/financial_categories/proximo-codigo`, { headers: cab })).json() as { codigo: string };
  await page.goto("/cadastros/financial_categories/new");
  const codigo = page.getByLabel(/^Código/).first();
  await expect(codigo).toBeEditable();
  await expect(codigo).toHaveValue(sugestao.codigo);
  // árvore: registro com filhos não oferece Mover (a base recusa); a folha oferece o Mover de hoje; sem o "Mover…" novo
  await page.goto("/cadastros/financial_categories?visao=arvore");
  const arvore = page.getByTestId("arvore-tela");
  await arvore.getByTestId("arvore-no").filter({ hasText: "RECEITAS" }).first().getByRole("button", { name: /RECEITAS/ }).click();
  await expect(page.getByTestId("arvore-mover-com-filhos")).toBeVisible();
  await expect(page.getByTestId("arvore-mover")).toHaveCount(0);
  await arvore.getByTestId("arvore-no").filter({ hasText: "Venda de Boi Gordo" }).first().getByRole("button", { name: /Venda de Boi Gordo/ }).click();
  await expect(page.getByRole("button", { name: "Mover", exact: true })).toBeVisible();
  await expect(page.getByTestId("arvore-codigo-previsto")).toHaveCount(0);
  // Parametrizações: a seção nova não aparece (a base não tem /admin/numeracao)
  await page.goto("/admin/parametros");
  await expect(page.getByText("Parametrizações da Organização"), "premissa: a tela de parâmetros carregou").toBeVisible();
  await expect(page.getByTestId("numeracao-cadastros")).toHaveCount(0);
  v.semBloqueio();
});

test("CADASTROS AJUSTES 01 · AJ-K3 — ficha de Parceiro da web NOVA salva contra a base: os campos da 0030 não viajam, 200", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const r = await page.request.post(`${API}/api/resources/people`, { headers: cab, data: { name: uniq("AJ-K3 parceiro"), person_type: "legal", is_client: true } });
  expect(r.status(), await r.text()).toBe(201);
  const id = (await r.json() as { id: string }).id;
  await page.goto(`/cadastros/people/${id}`);
  const ficha = page.getByTestId("ficha-em-abas");
  await expect(ficha).toBeVisible();
  for (const rotulo of ["Matriz", "Site", "Caixa postal", "Latitude", "E-mail para NF-e", "Calcula FUNRURAL"]) await expect(page.getByLabel(rotulo, { exact: true }), `${rotulo} não aparece contra a base`).toHaveCount(0);
  const editar = page.getByRole("button", { name: "Editar" });
  if (await editar.count()) await editar.first().click();
  await page.getByLabel("Nome Social/Fantasia").fill(uniq("AJ-K3 renomeado"));
  const resposta = page.waitForResponse((x) => x.request().method() === "PUT" && new URL(x.url()).pathname === `/api/resources/people/${id}`);
  await page.getByRole("button", { name: "Salvar" }).click();
  const put = await resposta;
  const enviado = put.request().postDataJSON() as Record<string, unknown>;
  const novos = ["matriz_id", "rg", "caepf", "sexo", "site", "caixa_postal", "latitude", "longitude", "email_nfe", "calcula_funrural"].filter((k) => k in enviado);
  expect(novos, "nenhum campo da 0030 viaja para a base").toEqual([]);
  expect(put.status(), await put.text()).toBe(200);
  sql(`update erp.people set deleted_at = now() where id = '${id}'`);
});
