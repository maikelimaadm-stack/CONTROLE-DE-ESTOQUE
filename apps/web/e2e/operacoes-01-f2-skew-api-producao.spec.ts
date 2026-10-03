import type { Locator, Page, Request, Response } from "@playwright/test";
import { login, api, uniq, empresaAtiva, primeiroId, pickRef, adicionarItemNaCentral, escolherPrimeiroProdutoDaLinha, preencherClassificacaoFinanceira, CLASSIFICACAO_DO_SEED } from "./helpers";
import { cfg4, cabecalhosDaSessao, type RegrasGeraisE2E } from "./top-config-08-comum";
import { test, expect, codigoTop, criarCadastro, criarTop, doSeed, referenciasDoSeed } from "./central-compras-fixtures";
import { MSG_ROTA_NAO_ENCONTRADA, mundoDaApiDaBase, portaDaSituacao, regrasGeraisDoCorpo, vigiar, type Mundo } from "./operacoes-01-f2-skew-comum";

/**
 * OPERACOES-01 · F2 (decisão 279) · K-1, SENTIDO 1 — O WEB DESTE HEAD CONTRA A API DA BASE (a janela "web antes da
 * API" da DEPLOYMENT, e a reversão só da API).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 1 roda em `playwright.skew.config.ts`, cujo `testMatch` é
 * `/skew-api-producao\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o `playwright.config.ts` comum
 * ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (lá a API seria a deste HEAD e o caso ficaria
 * verde por vacuidade). O caso não foi acrescentado em `skew-api-producao.spec.ts` porque aquele arquivo é
 * compartilhado com as fases que correm em paralelo: o arquivo próprio não colide com nenhuma. Sem `scripts/lib` e sem
 * passo no CI: o arquivo entra pelo nome. A prova de que cada config o enxerga do jeito certo é o `--list` de cada uma
 * (relatório da fase), e a identidade da árvore da base é a do caso IDENTIDADE de `skew-api-producao.spec.ts`.
 *
 * O MUNDO É PERGUNTADO À BASE NA HORA (`mundoDaApiDaBase`, em `operacoes-01-f2-skew-comum.ts`): o bloco `regrasGerais`
 * nas regras da operação da TOP do caso e a situação da aprovação do id inexistente — as duas portas da F2, que nascem
 * no MESMO binário (uma sem a outra reprova). Os dois ramos cobram prova POSITIVA; nenhum deles só passa:
 *   · MUNDO LEGADO (a base de hoje, sem a F2): sem o bloco, o web deste HEAD é a Central de HOJE — o Salvar se chama
 *     "Salvar" (exato) mesmo com a TOP Automática, e a pendência "ao menos um item" vale mesmo com a TOP que permite
 *     documento sem itens, com ZERO POST. O aviso do Salvar, porém, sai da RESPOSTA, e a base JÁ confirma com a TOP
 *     Automática (TOP-CONFIG-08): o aviso é "Salvo e confirmado." — a afirmação verdadeira. Na consulta, a pergunta da
 *     situação recebe o 404 de rota no fio, o bloco não aparece, e a prévia do Confirmar continua explicando a recusa
 *     da aprovação (APROVACAO_PENDENTE), como hoje;
 *   · MUNDO NOVO (a base já com a F2, depois do merge): "Salvar e confirmar", o documento sem itens salva, e o bloco
 *     da aprovação aparece pendente.
 * Em todos, nenhuma requisição morre no navegador (`semBloqueio`). Não há mock: o servidor é o binário da base,
 * servindo o banco migrado e semeado por este HEAD. As TOPs e os cadastros nascem PELA API DA BASE, pelas portas de
 * `central-compras-fixtures` (a exclusão lógica roda no fim do caso, passou ou falhou); a venda que termina aberta é
 * cancelada no fim. Os documentos ficam (o ledger é imutável).
 */

const PV = "central-vendas";
const PC = "central-compras";
const caminho = (r: Request | Response) => new URL(r.url()).pathname;
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const MENSAGEM_APROVACAO_PENDENTE = "Este documento precisa de aprovação antes de ser confirmado.";
/** A data de hoje no fuso do processo (o molde de `estoque-01-comum.ts`; o `toISOString` daria o dia em UTC). */
const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

type CorpoDoLancar = Record<string, unknown> & { id: string; confirmacaoAutomatica?: unknown };
type Venda = { id: string; code: string; status: string; items: unknown[] };

/** O aviso do TIPO dado, pela descrição (o seletor de W-5b); `avisos` conta todos. */
const aviso = (page: Page, tipo: "success" | "info" | "warning") =>
  page.locator(`[data-sonner-toast] .erp-toast-panel--${tipo} .erp-toast-panel__description`);
const avisos = (page: Page) => page.locator("[data-sonner-toast]");

/** O rótulo do Salvar que cada mundo exige com a TOP Automática (sem o bloco, o de hoje). */
const rotuloComAutomatica = (mundo: Mundo) => (mundo === "novo" ? "Salvar e confirmar" : "Salvar");

/** Uma TOP nova PELA API DA BASE (limpeza automática), com as regras gerais pedidas sobre o neutro do domínio. */
async function topNova(page: Page, codigoBase: "vendas.venda" | "compras.compra", r: RegrasGeraisE2E): Promise<string> {
  const { id } = await criarTop(page, { codigo: codigoTop("f2k1"), codigoBase, nome: uniq(`F2 K-1 ${codigoBase}`), configuracao: cfg4(r) });
  return id;
}

/** O corpo das regras da operação que a PRÓPRIA tela pede para a TOP (o ouvinte nasce antes da navegação). */
const regrasNoFio = (page: Page, porta: string, top: string) => page.waitForResponse((r) => r.request().method() === "GET"
  && caminho(r) === porta && new URL(r.url()).searchParams.get("tipo_operacao_id") === top);

/** O bloco que a tela recebeu, conferido contra o mundo: ausente no legado; no novo, o que a TOP declara. */
function conferirBlocoDoMundo(corpo: Record<string, unknown>, mundo: Mundo, esperadoNoNovo: { confirmacaoAutomatica: boolean; aceitaSemItens: boolean }, contexto: string) {
  const bloco = regrasGeraisDoCorpo(corpo, contexto);
  if (mundo === "legado") expect(bloco, `${contexto}: a base não manda \`regrasGerais\` (premissa do ramo legado)`).toBeUndefined();
  else expect(bloco, `${contexto}: a base declara as regras gerais da TOP`).toEqual(esperadoNoNovo);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K-1a · A CENTRAL DE VENDAS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

/** Abre a criação da venda com a TOP e escolhe um cliente novo; devolve o corpo das regras que a tela recebeu. */
async function abrirCriacaoDeVenda(page: Page, top: string): Promise<Record<string, unknown>> {
  const cliente = uniq("Cliente F2K1");
  await criarCadastro(page, "people", { name: cliente, person_type: "legal", is_client: true });
  const regras = regrasNoFio(page, "/api/sales/sales/regras-da-operacao", top);
  await page.goto(`/vendas/sales/new?tipo_operacao_id=${top}`);
  await expect(page.getByTestId("top-contexto"), "a Central abriu o formulário desta TOP").toBeVisible();
  const r = await regras;
  expect(r.status(), "a Central perguntou à base as regras da operação desta TOP").toBe(200);
  const corpo = await r.json() as Record<string, unknown>;
  await pickRef(page, "Cliente", cliente);
  return corpo;
}

/** Um item: o primeiro produto que a pesquisa oferece, 1 × 40,00, sem local de estoque (nada de saldo em jogo). */
async function umItemNaVenda(page: Page) {
  await adicionarItemNaCentral(page);
  await escolherPrimeiroProdutoDaLinha(page);
  const linha = page.getByTestId(`${PV}-linha`).first();
  await linha.getByLabel("Quantidade").fill("1");
  await linha.getByLabel("Valor unitário").fill("40");
}

/** Clica no Salvar da venda e devolve o 201 (o corpo enviado e o devolvido); o aviso é conferido por quem chama. */
async function salvarVenda(page: Page, vendas: string[]) {
  const post = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === "/api/sales/sales");
  await page.getByTestId(`${PV}-salvar`).click();
  const r = await post;
  expect(r.status(), "a base criou a venda").toBe(201);
  const corpo = await r.json() as CorpoDoLancar;
  vendas.push(corpo.id);
  await expect(page, "depois do POST a Central abre a consulta do documento salvo").toHaveURL(new RegExp(`/vendas/sales/${corpo.id}$`));
  return { corpo, enviado: r.request().postDataJSON() as { items: unknown[] } };
}

const situacaoDaVenda = (page: Page) => page.getByTestId(`${PV}-situacao`).locator("[data-status]");
const vendaNoServidor = (page: Page, id: string) => api<Venda>(page, "GET", `/api/sales/sales/${id}`);

/** A venda que ficou aberta é cancelada no fim (fora da fila de Aprovações das próximas execuções). */
async function cancelarAbertas(page: Page, vendas: string[]) {
  for (const id of vendas) {
    const v = await vendaNoServidor(page, id).catch(() => null);
    if (v && ["open", "approved"].includes(v.status)) await api(page, "POST", `/api/sales/sales/${id}/cancel`, {}).catch(() => undefined);
  }
}

test("OP01-F2 · K-1a (sentido 1) — a Central de Vendas deste web sobre a API da base: sem `regrasGerais`, 'Salvar' exato com a TOP Automática, o aviso 'Salvo e confirmado.' lido da resposta da base, e 'ao menos um item' com ZERO POST mesmo com a TOP que permite; com o bloco, 'Salvar e confirmar' e a venda sem itens salva", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const vendas: string[] = [];
  try {
    const automatica = await topNova(page, "vendas.venda", { confirmacao: "automatica" });
    const permitido = await topNova(page, "vendas.venda", { confirmacao: "manual", documentoSemItens: "permitido" });
    const mundo = await mundoDaApiDaBase(page, cab, "vendas", automatica);

    // (1) TOP AUTOMÁTICA: o rótulo é o do mundo; a base confirma no POST; o aviso sai da RESPOSTA, um só.
    conferirBlocoDoMundo(await abrirCriacaoDeVenda(page, automatica), mundo, { confirmacaoAutomatica: true, aceitaSemItens: false }, "venda, TOP Automática");
    await umItemNaVenda(page);
    await preencherClassificacaoFinanceira(page);
    const salvar = page.getByTestId(`${PV}-salvar`);
    await expect(salvar, "habilitado: as regras chegaram (regras pendentes desabilitam o Salvar)").toBeEnabled();
    await expect(salvar, `mundo ${mundo}: o nome acessível do Salvar com a TOP Automática, exato`).toHaveAttribute("aria-label", rotuloComAutomatica(mundo));
    await expect(salvar, "e a dica também").toHaveAttribute("data-dica", rotuloComAutomatica(mundo));
    const confirmada = await salvarVenda(page, vendas);
    expect(confirmada.corpo.confirmacaoAutomatica, "a base JÁ confirma com a TOP Automática (TOP-CONFIG-08), nos dois mundos").toEqual({ confirmado: true });
    await expect(aviso(page, "success"), "o aviso lido da resposta da base: a afirmação verdadeira").toHaveText(["Salvo e confirmado."]);
    await expect(avisos(page), "um aviso só (nada de 'Salvo com sucesso' ao lado)").toHaveCount(1);
    await expect(situacaoDaVenda(page), "a consulta mostra a venda confirmada").toHaveAttribute("data-status", "confirmed");
    expect((await vendaNoServidor(page, confirmada.corpo.id)).status, "na base também").toBe("confirmed");

    // (2) TOP QUE PERMITE DOCUMENTO SEM ITENS: sem o bloco, a pendência de hoje e nada enviado; com ele, salva.
    const posts: string[] = [];
    const contar = (r: Request) => { if (r.method() === "POST" && caminho(r) === "/api/sales/sales") posts.push(r.url()); };
    page.on("request", contar);
    conferirBlocoDoMundo(await abrirCriacaoDeVenda(page, permitido), mundo, { confirmacaoAutomatica: false, aceitaSemItens: true }, "venda, TOP Permitido");
    await preencherClassificacaoFinanceira(page);
    await expect(page.getByTestId(`${PV}-linha`), "premissa: nenhum item na grade").toHaveCount(0);
    await expect(salvar, "habilitado: as regras chegaram").toBeEnabled();
    await expect(salvar, "TOP Manual: 'Salvar' nos dois mundos").toHaveAttribute("aria-label", "Salvar");
    if (mundo === "legado") {
      await salvar.click();
      await expect(page.getByTestId(`${PV}-pendencias`), "o clique sem item mostra UMA pendência").toHaveText(/1 pendência/);
      const daLista = page.getByTestId(`${PV}-pendencias-lista`).getByTestId(`${PV}-pendencia`);
      await expect(daLista, "só o item falta (o resto do documento está pronto)").toHaveCount(1);
      await expect(daLista, "é a pendência dos itens, a de hoje").toHaveAttribute("data-caminho", "items");
      await expect(daLista).toContainText("Adicione ao menos um item.");
      // A pendência visível prova que o handler voltou ANTES do POST (os dois caminhos são exclusivos).
      expect(posts, "ZERO POST: sem o bloco, a Central de hoje não envia documento sem itens").toEqual([]);
    } else {
      const semItens = await salvarVenda(page, vendas);
      expect(semItens.enviado.items, "o POST levou a venda sem itens").toEqual([]);
      expect(posts, "um POST, o desta venda").toHaveLength(1);
      expect("confirmacaoAutomatica" in semItens.corpo, "TOP Manual: sem a chave").toBe(false);
      await expect(situacaoDaVenda(page), "a consulta mostra a venda aberta").toHaveAttribute("data-status", "open");
      expect((await vendaNoServidor(page, semItens.corpo.id)).items, "na base: a venda gravada sem itens").toEqual([]);
    }
    page.off("request", contar);
    v.semBloqueio();
  } finally {
    await cancelarAbertas(page, vendas);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K-1b · A CENTRAL DE COMPRAS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

/** Escolhe no RefSelect da Central de Compras pelo rótulo do campo (nome escapado: nomes do seed têm colchetes). */
async function escolher(page: Page, rotulo: string, nome: string) {
  const campo = page.getByTestId("compras-central").locator("label", { hasText: rotulo }).first().locator("..");
  await campo.locator("button").first().click();
  const painel = page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nome.slice(0, 20));
  await painel.getByRole("option", { name: literal(nome.slice(0, 20)) }).first().click();
}

/** Escolhe na pesquisa do motor ancorada à célula (produto ou local de estoque) da linha — pelo NOME INTEIRO. */
async function escolherNaCelula(page: Page, celula: Locator, nome: string) {
  await celula.click();
  const pesquisa = page.getByTestId(`${PC}-pesquisa`);
  await expect(pesquisa).toBeVisible();
  await pesquisa.getByPlaceholder("Pesquisar pela descrição").fill(nome);
  await pesquisa.getByRole("option", { name: literal(nome) }).first().click();
  await expect(pesquisa).toHaveCount(0);
}

/** O cadastro do caso PELA API DA BASE: fornecedor, local de estoque e produto; natureza e centro do seed, pelo nome. */
async function cenarioDaCompra(page: Page) {
  const ref = await referenciasDoSeed(page);
  const p = await criarCadastro(page, "products", { description: uniq("F2K1 produto"), group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id });
  const nomeProduto = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${p.id}`))["description"]);
  const empresa = await empresaAtiva(page);
  const armazem = (await criarCadastro(page, "warehouses", {
    empresa_id: empresa, initials: `K${Date.now().toString(36).slice(-4).toUpperCase()}`, description: uniq("F2K1 local"), type: "inputs"
  })).id;
  const nomeArmazem = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${armazem}`))["description"]);
  const fornecedor = (await criarCadastro(page, "people", { name: uniq("F2K1 forn"), person_type: "legal", is_provider: true })).id;
  const nomeFornecedor = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${fornecedor}`))["name"]);
  return { nomeProduto, nomeArmazem, nomeFornecedor, natureza: ref.natureza, centro: ref.centro };
}
type CenarioDaCompra = Awaited<ReturnType<typeof cenarioDaCompra>>;

/** Abre a criação da compra com a TOP e o cabeçalho preenchido; devolve o corpo das regras que a tela recebeu. */
async function abrirCriacaoDeCompra(page: Page, top: string, c: CenarioDaCompra): Promise<Record<string, unknown>> {
  const regras = regrasNoFio(page, "/api/compras/compras/regras-da-operacao", top);
  await page.goto(`/compras/compras/new?tipo_operacao_id=${top}`);
  const r = await regras;
  expect(r.status(), "a Central perguntou à base as regras da operação desta TOP").toBe(200);
  const corpo = await r.json() as Record<string, unknown>;
  await expect(page.getByTestId("compras-central")).toHaveAttribute("data-especie", "compra");
  await expect(page.getByTestId("compras-salvar"), "o Salvar saiu da trava: as regras chegaram").toBeEnabled();
  await escolher(page, "Fornecedor", c.nomeFornecedor);
  await escolher(page, "Natureza de despesa", c.natureza.label);
  await escolher(page, "Centro de resultado", c.centro.label);
  return corpo;
}

/** Clica no Salvar da compra e devolve o POST (o corpo enviado e o devolvido) — o ouvinte nasce antes do clique. */
async function salvarCompra(page: Page) {
  const post = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === "/api/compras/compras");
  await page.getByTestId("compras-salvar").click();
  const r = await post;
  expect(r.status(), "a base criou a compra").toBe(201);
  const corpo = await r.json() as CorpoDoLancar;
  await expect(page, "depois do POST a Central abre a consulta da compra salva").toHaveURL(new RegExp(`/compras/compras/${corpo.id}$`));
  return { corpo, enviado: r.request().postDataJSON() as { itens: unknown[] } };
}

test("OP01-F2 · K-1b (sentido 1) — a Central de Compras deste web sobre a API da base: sem `regrasGerais`, 'Salvar' exato com a TOP Automática, 'Salvo e confirmado.' lido da resposta, e 'Inclua ao menos um item.' com ZERO POST mesmo com a TOP que permite; com o bloco, 'Salvar e confirmar' e a compra sem itens salva", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const c = await cenarioDaCompra(page);
  const automatica = await topNova(page, "compras.compra", { confirmacao: "automatica" });
  const permitido = await topNova(page, "compras.compra", { confirmacao: "manual", documentoSemItens: "permitido" });
  const mundo = await mundoDaApiDaBase(page, cab, "compras", automatica);
  const salvar = page.getByTestId("compras-salvar");
  const consulta = page.getByTestId("compras-consulta-corpo");

  // (1) TOP AUTOMÁTICA: o rótulo é o do mundo; a base confirma no POST; o aviso sai da RESPOSTA, um só.
  conferirBlocoDoMundo(await abrirCriacaoDeCompra(page, automatica, c), mundo, { confirmacaoAutomatica: true, aceitaSemItens: false }, "compra, TOP Automática");
  await expect(salvar, `mundo ${mundo}: o nome acessível do Salvar com a TOP Automática, exato`).toHaveAttribute("aria-label", rotuloComAutomatica(mundo));
  await expect(salvar, "e a dica também").toHaveAttribute("data-dica", rotuloComAutomatica(mundo));
  await page.getByTestId(`${PC}-adicionar-item`).click();
  const linha = page.getByTestId(`${PC}-linha`).first();
  await escolherNaCelula(page, linha.getByTestId(`${PC}-produto`), c.nomeProduto);
  await escolherNaCelula(page, linha.getByTestId(`${PC}-armazem`), c.nomeArmazem);
  await linha.getByLabel("Quantidade do item 1").fill("5");
  await linha.getByLabel("Valor unitário do item 1").fill("20");
  await expect(page.getByTestId(`${PC}-subtotal`)).toContainText("100,00");
  const confirmada = await salvarCompra(page);
  expect([confirmada.corpo["situacao"], confirmada.corpo.confirmacaoAutomatica], "a base JÁ confirma com a TOP Automática, nos dois mundos")
    .toEqual(["confirmado", { confirmado: true }]);
  await expect(aviso(page, "success"), "o aviso lido da resposta da base: a afirmação verdadeira").toHaveText(["Salvo e confirmado."]);
  await expect(avisos(page), "um aviso só").toHaveCount(1);
  await expect(consulta, "a consulta mostra a compra confirmada").toHaveAttribute("data-situacao", "confirmado");
  expect((await api<{ situacao: string }>(page, "GET", `/api/compras/compras/${confirmada.corpo.id}`)).situacao, "na base também").toBe("confirmado");

  // (2) TOP QUE PERMITE DOCUMENTO SEM ITENS: sem o bloco, a pendência de hoje e nada enviado; com ele, salva.
  const posts: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && caminho(r) === "/api/compras/compras") posts.push(r.url()); });
  conferirBlocoDoMundo(await abrirCriacaoDeCompra(page, permitido, c), mundo, { confirmacaoAutomatica: false, aceitaSemItens: true }, "compra, TOP Permitido");
  await expect(page.getByTestId(`${PC}-linha`), "premissa: nenhuma linha de item").toHaveCount(0);
  await expect(salvar, "TOP Manual: 'Salvar' nos dois mundos").toHaveAttribute("aria-label", "Salvar");
  if (mundo === "legado") {
    await salvar.click();
    const pilula = page.getByTestId(`${PC}-pendencias`);
    await expect(pilula, "o clique sem item mostra a pílula de pendências").toBeVisible();
    const lista = page.getByTestId(`${PC}-pendencias-lista`);
    if (!(await lista.isVisible())) await pilula.click();
    await expect(lista).toBeVisible();
    const semItens = lista.locator(`[data-testid="${PC}-pendencia"][data-caminho="itens"]`);
    await expect(semItens, "sem o bloco, a pendência de hoje").toHaveCount(1);
    await expect(semItens).toContainText("Inclua ao menos um item.");
    await expect(page, "o clique com pendência não sai da criação").toHaveURL(/\/compras\/compras\/new\?/);
    expect(posts, "ZERO POST: sem o bloco, a Central de hoje não envia compra sem itens").toEqual([]);
  } else {
    const vazia = await salvarCompra(page);
    expect(vazia.enviado.itens, "o POST levou a compra sem itens").toEqual([]);
    expect(posts, "um POST, o desta compra").toHaveLength(1);
    expect([vazia.corpo["situacao"], "confirmacaoAutomatica" in vazia.corpo], "TOP Manual: aberta, sem a chave").toEqual(["aberto", false]);
    await expect(consulta, "a consulta mostra a compra aberta").toHaveAttribute("data-situacao", "aberto");
    expect((await api<{ itens: unknown[] }>(page, "GET", `/api/compras/compras/${vazia.corpo.id}`)).itens, "na base: sem itens").toEqual([]);
  }
  v.semBloqueio();
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K-1c · A APROVAÇÃO NA CONSULTA
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("OP01-F2 · K-1c (sentido 1) — a consulta da venda deste web sobre a API da base: sem a rota da situação, o 404 de rota chega no fio, o bloco da aprovação não aparece e a prévia do Confirmar explica a aprovação pendente, como hoje; com a rota, o bloco pendente", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const vendas: string[] = [];
  try {
    const top = await topNova(page, "vendas.venda", { confirmacao: "manual", aprovacao: "sempre" });
    const mundo = await mundoDaApiDaBase(page, cab, "vendas", top);

    // A venda nasce PELA API DA BASE, com um item e a classificação do seed: aberta e aguardando a aprovação.
    const cliente = await criarCadastro(page, "people", { name: uniq("Cliente F2K1c"), person_type: "legal", is_client: true });
    const natureza = await doSeed(page, "/api/resources/financial_categories/options?kind=analytic&nature=income", CLASSIFICACAO_DO_SEED.categoria.nome);
    const centro = await doSeed(page, "/api/resources/cost_centers/options?kind=analytic", CLASSIFICACAO_DO_SEED.centro.nome);
    const venda = await api<CorpoDoLancar>(page, "POST", "/api/sales/sales", {
      empresa_id: await empresaAtiva(page), document_date: hojeISO(), client_id: cliente.id, tipo_operacao_id: top,
      categoria_financeira_id: natureza.id, centro_custo_id: centro.id,
      items: [{ product_id: await primeiroId(page, "/api/resources/products?pageSize=1"), warehouse_id: null, quantity: "1", unit_price: "10.00" }]
    });
    vendas.push(venda.id);
    expect("confirmacaoAutomatica" in venda, "premissa: TOP Manual, o 201 sem a chave").toBe(false);
    const lida = await vendaNoServidor(page, venda.id);
    expect(lida.status, "premissa: a base lançou a venda aberta").toBe("open");

    // A CONSULTA: a pergunta da situação sai na montagem, e o que volta no fio decide o que a tela pode mostrar.
    const situacaoNoFio = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === portaDaSituacao("vendas", venda.id));
    await page.goto(`/vendas/sales/${venda.id}`);
    await expect(page.getByTestId(PV), "a consulta da venda da base abre na Central, a do documento certo").toHaveAttribute("aria-label", new RegExp(lida.code));
    await expect(situacaoDaVenda(page), "aberta").toHaveAttribute("data-status", "open");
    const s = await situacaoNoFio;
    const corpoDaSituacao = await s.json() as Record<string, unknown> & { error?: { code?: string; message?: string } };
    const bloco = page.getByTestId(`${PV}-aprovacao`);
    if (mundo === "legado") {
      expect([s.status(), corpoDaSituacao.error?.code, corpoDaSituacao.error?.message], "premissa: a base não tem a rota — o 404 de rota chegou no fio (não morreu)")
        .toEqual([404, "NOT_FOUND", MSG_ROTA_NAO_ENCONTRADA]);
      await expect(bloco, "sem a rota, nenhum bloco de aprovação").toHaveCount(0);
    } else {
      expect([s.status(), corpoDaSituacao], "a base serve a situação: pendente, sem decisão").toEqual([200, { situacao: "pendente", ultimaDecisao: null }]);
      await expect(bloco, "com a rota, o bloco pendente").toHaveAttribute("data-situacao", "pendente");
      await expect(page.getByTestId(`${PV}-aprovacao-situacao`)).toHaveText("Aguardando aprovação");
    }

    // A PRÉVIA DO CONFIRMAR, nos dois mundos: é ela que explica a recusa da aprovação, como hoje.
    const previaNoFio = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === `/api/sales/sales/${venda.id}/previa-confirmacao`);
    await page.getByTestId(`${PV}-confirmar`).click();
    const previa = await (await previaNoFio).json() as { podeConfirmar: boolean; recusas?: { code: string; message: string }[] };
    expect([previa.podeConfirmar, (previa.recusas ?? []).map((x) => [x.code, x.message])], "a base prevê a recusa da aprovação")
      .toEqual([false, [["APROVACAO_PENDENTE", MENSAGEM_APROVACAO_PENDENTE]]]);
    const dialogo = page.getByTestId("confirm-dialog");
    await expect(dialogo.getByTestId("previa-confirmacao-recusa-mensagem"), "a prévia mostra a mensagem do servidor, palavra por palavra").toHaveText(MENSAGEM_APROVACAO_PENDENTE);
    await expect(dialogo.getByTestId("confirm-dialog-confirm"), "e o Confirmar fica desabilitado").toBeDisabled();
    await dialogo.getByRole("button", { name: "Voltar", exact: true }).click();
    await expect(dialogo).toHaveCount(0);
    if (mundo === "legado") await expect(bloco, "depois da prévia, o bloco continua ausente (o erro da pergunta não vira aviso nem bloco)").toHaveCount(0);
    await expect(avisos(page), "nenhum aviso apareceu pela pergunta que a base não conhece").toHaveCount(0);
    v.semBloqueio();
  } finally {
    await cancelarAbertas(page, vendas);
  }
});
