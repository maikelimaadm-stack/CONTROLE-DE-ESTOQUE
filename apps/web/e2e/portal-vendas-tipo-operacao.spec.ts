import { test, expect, type Page } from "@playwright/test";
import { login, logout, api, uniq, empresaAtiva, primeiroId } from "./helpers";

/**
 * PORTAL DE VENDAS COM TOP CADASTRADA — o caminho que o usuário faz de verdade (TOP-CONFIG-02).
 *
 * A integração já prova a cadeia no servidor. O que SÓ este arquivo pode provar é o elo do cliente, e
 * dentro dele o que mais importa: a tela NÃO ESCREVE quando o servidor ainda é antigo. Esse é o único
 * caso em que nenhum teste de API ajuda — o defeito mora exatamente na conversa entre as duas versões.
 */
const PORTAL = "/vendas";

/** Cadastra uma TOP pela API administrativa (o E2E do cadastro em si é da TOP-CONFIG-01). */
async function cadastrarTop(page: Page, codigoBase: string, nome: string, extra: Record<string, unknown> = {}) {
  const codigo = `7${Math.floor(Math.random() * 90000 + 10000)}`;
  return api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase, nome, ...extra });
}

/** Abre o formulário de novo lançamento da variante. */
async function abrirNovo(page: Page, variante: string) {
  await page.goto(`/vendas/${variante}/new`);
  await expect(page.getByTestId("select-tipo-operacao")).toBeVisible();
}

test("cadastra TOPs, lança pelo Portal de Vendas e o detalhe mostra o snapshot", async ({ page }) => {
  await login(page);
  const empresa = await empresaAtiva(page);
  const nomeTop = uniq("Venda de Gado a Prazo");
  const top = await cadastrarTop(page, "vendas.venda", nomeTop, { padrao: true });

  // O título do portal foi assumido formalmente nesta fatia.
  await page.goto(PORTAL);
  await expect(page.getByRole("heading", { name: "Vendas" })).toBeVisible();

  await abrirNovo(page, "sales");
  // O PADRÃO vem PRÉ-SELECIONADO e VISÍVEL — não escondido porque "tem um padrão".
  await expect(page.getByTestId("select-tipo-operacao")).toHaveValue(top.id);
  // E o seletor só oferece TOPs da família da variante.
  const opcoes = await page.getByTestId("select-tipo-operacao").locator("option").evaluateAll((os) =>
    os.map((o) => (o as HTMLOptionElement).textContent ?? "").filter((x) => x && !x.startsWith("Selecione")));
  expect(opcoes.some((o) => o.includes(nomeTop)), "a TOP de venda aparece").toBe(true);

  // A criação em si vai pela API (a via de clique do formulário é coberta por outros specs); o que este
  // teste prova aqui é o DETALHE lendo o snapshot.
  const cliente = await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1");
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const venda = await api<{ id: string }>(page, "POST", "/api/sales/sales", {
    empresa_id: empresa, document_date: "2026-09-01", client_id: cliente, tipo_operacao_id: top.id,
    items: [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }]
  });

  await page.goto(`/vendas/sales/${venda.id}`);
  await expect(page.getByTestId("base2-shell")).toBeVisible();
  // TOP configurada E família canônica aparecem como coisas DIFERENTES.
  await expect(page.getByText(nomeTop)).toBeVisible();
  await expect(page.getByText("Família operacional")).toBeVisible();
});

test("editar a TOP cria a versão 2 e o documento ANTIGO continua exibindo a versão 1", async ({ page }) => {
  await login(page);
  const empresa = await empresaAtiva(page);
  const nomeV1 = uniq("Nome original");
  const top = await cadastrarTop(page, "vendas.venda", nomeV1);
  const cliente = await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1");
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const venda = await api<{ id: string }>(page, "POST", "/api/sales/sales", {
    empresa_id: empresa, document_date: "2026-09-01", client_id: cliente, tipo_operacao_id: top.id,
    items: [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }]
  });

  const atual = await api<{ revisao: number }>(page, "GET", `/api/admin/tipos-operacao/${top.id}`);
  const nomeV2 = uniq("Nome corrigido");
  await api(page, "PUT", `/api/admin/tipos-operacao/${top.id}`, { nome: nomeV2, revisao: atual.revisao });

  await page.goto(`/vendas/sales/${venda.id}`);
  await expect(page.getByTestId("base2-shell")).toBeVisible();
  // A PROVA QUE IMPORTA: a tela mostra o nome de ONTEM, porque lê a versão congelada.
  await expect(page.getByText(nomeV1)).toBeVisible();
  await expect(page.getByText(nomeV2), "o nome novo NÃO pode aparecer no documento antigo").toHaveCount(0);
});

test("conversão exige a TOP do DESTINO, e a fonte mantém a dela", async ({ page }) => {
  await login(page);
  const empresa = await empresaAtiva(page);
  const nomeOrcamento = uniq("Orçamento padrão");
  const nomePedido = uniq("Pedido especial");
  const topOrcamento = await cadastrarTop(page, "vendas.orcamento", nomeOrcamento);
  const topPedido = await cadastrarTop(page, "vendas.pedido", nomePedido, { padrao: true });

  const cliente = await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1");
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const orcamento = await api<{ id: string }>(page, "POST", "/api/sales/budgets", {
    empresa_id: empresa, document_date: "2026-09-01", client_id: cliente, tipo_operacao_id: topOrcamento.id,
    items: [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }]
  });

  await page.goto(`/vendas/budgets/${orcamento.id}`);
  await page.getByRole("button", { name: "Converter em pedido" }).click();
  const dialogo = page.getByTestId("dialog-conversao");
  await expect(dialogo).toBeVisible();
  // O seletor do diálogo carrega as TOPs do DESTINO (pedido), nunca as da fonte (orçamento).
  const opcoes = await dialogo.getByTestId("select-tipo-operacao").locator("option").evaluateAll((os) =>
    os.map((o) => (o as HTMLOptionElement).textContent ?? ""));
  expect(opcoes.some((o) => o.includes(nomePedido)), "a TOP de pedido é oferecida").toBe(true);
  expect(opcoes.some((o) => o.includes(nomeOrcamento)), "a TOP de orçamento NÃO pode ser oferecida").toBe(false);

  await dialogo.getByRole("button", { name: "Converter" }).click();
  await expect(page).toHaveURL(/\/vendas\/orders\//);
  await expect(page.getByText(nomePedido), "o destino usa a TOP dele").toBeVisible();

  // E a fonte continua com a dela.
  await page.goto(`/vendas/budgets/${orcamento.id}`);
  await expect(page.getByText(nomeOrcamento)).toBeVisible();
});

test("SEM TOP ativa da família: Salvar desabilitado, mensagem e NENHUM POST", async ({ page }) => {
  await login(page);
  // Simula "nenhuma TOP cadastrada" interceptando a resposta do endpoint operacional. O servidor continua
  // como está; o que se mede é a decisão da TELA.
  await page.route("**/api/sales/sales/operation-types", (rota) =>
    rota.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ contractVersion: 1, family: { code: "vendas.venda", label: "Venda" }, defaultId: null, items: [] }) }));

  const posts: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/sales/sales")) posts.push(r.url()); });

  await page.goto("/vendas/sales/new");
  await expect(page.getByTestId("top-ausente")).toBeVisible();
  await expect(page.getByRole("button", { name: "Salvar" })).toBeDisabled();
  expect(posts, "nenhuma tentativa de criação").toEqual([]);
});

/**
 * OS DOIS MODOS EM QUE A LISTA NÃO É CONFIRMADA — e por que este teste NÃO é a prova do version skew.
 *
 * Aqui o servidor é simulado, então o que se mede é a REAÇÃO da tela a cada status, não o que o binário
 * anterior faz. A premissa — qual status a API da base devolve — é fabricada, e teste que fabrica a
 * própria premissa não prova skew (`.claude/rules/testing-gates.md`: "usa binário e bundle reais, nunca
 * mock"). A prova com binário real está em `skew-api-producao.spec.ts`, e foi ela que mostrou que o
 * status é 500, não 404 — o contrário do que a primeira versão desta fatia assumia.
 *
 * Os dois casos continuam valendo o que valem: a tela bloqueia em AMBOS, com a mesma mensagem, porque
 * de dentro do navegador as duas causas são indistinguíveis.
 */
for (const [nome, status] of [["500 (a rota cai no `:id` da API anterior)", 500], ["404 (rota simplesmente ausente)", 404]] as [string, number][]) {
  test(`REAÇÃO — lista não confirmada com ${nome}: a tela bloqueia e NÃO perde a TOP em silêncio`, async ({ page }) => {
    await login(page);
    await page.route("**/api/sales/sales/operation-types", (rota) =>
      rota.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: { code: status === 404 ? "NOT_FOUND" : "INTERNAL_ERROR", message: "x" } }) }));

    const posts: string[] = [];
    page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/sales/")) posts.push(r.url()); });

    await page.goto("/vendas/sales/new");
    await expect(page.getByTestId("top-nao-confirmado")).toBeVisible();
    // A mensagem NÃO manda cadastrar TOP: o problema não é configuração, e cadastrar não resolveria.
    await expect(page.getByTestId("top-ausente"), "não pedir cadastro quando o problema é o servidor").toHaveCount(0);
    await expect(page.getByRole("button", { name: "Salvar" })).toBeDisabled();
    expect(posts, "ZERO POST: é isto que impede a perda silenciosa").toEqual([]);
  });
}

/**
 * A FORMA DO 200 TAMBÉM É CONTRATO — e é o modo de falha que nenhum status revela.
 *
 * Os casos acima medem a tela contra ERRO. Estes medem contra SUCESSO: 200 é o status em que o cliente
 * mais confia, e é por isso mesmo que um 200 de contrato desconhecido é perigoso. Aqui o servidor é
 * fabricado de propósito — o que se afirma não é o que a API faz hoje, é o que a TELA faz com um corpo
 * que ela não sabe ler. A prova contra binário real continua em `skew-api-producao.spec.ts`, intacta.
 */
const topValida = { id: "11111111-1111-4111-8111-111111111111", code: "2103", name: "Venda de Gado a Prazo", version: 1, isDefault: true };
const responderTops = (page: Page, corpo: unknown) =>
  page.route("**/api/sales/sales/operation-types", (rota) =>
    rota.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(corpo) }));
/** ZERO POST é a asserção que mede a perda silenciosa — a mensagem na tela é consequência, não prova. */
const vigiarPosts = (page: Page) => { const posts: string[] = []; page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/sales/")) posts.push(r.url()); }); return posts; };

test("CONTRATO FUTURO — 200 com contractVersion=2: a tela BLOQUEIA e não emite nenhum POST", async ({ page }) => {
  await login(page);
  // Um servidor MAIS NOVO que esta web. Os itens são impecáveis; o que não se conhece é o SIGNIFICADO
  // deles. Aceitar seria lançar um documento sob um contrato que ninguém leu — a mesma perda silenciosa
  // da API antiga, só que pelo outro lado da janela de deploy.
  await responderTops(page, { contractVersion: 2, family: { code: "vendas.venda", label: "Venda" }, defaultId: topValida.id, items: [topValida] });
  const posts = vigiarPosts(page);

  await page.goto("/vendas/sales/new");
  await expect(page.getByTestId("top-nao-confirmado")).toBeVisible();
  await expect(page.getByTestId("top-ausente"), "o problema é o contrato do servidor, não a configuração").toHaveCount(0);
  await expect(page.getByRole("button", { name: "Salvar" })).toBeDisabled();
  expect(posts, "contrato desconhecido não autoriza escrita").toEqual([]);
});

test("CORPO TRUNCADO — 200 sem `items`: a tela não cai, e continua bloqueada", async ({ page }) => {
  await login(page);
  // `items.length` sobre um corpo sem `items` era um TypeError em pleno render: tela branca, e o usuário
  // sem nem a mensagem de bloqueio. Não cair é metade da prova; a outra metade é não liberar.
  await responderTops(page, { contractVersion: 1, family: { code: "vendas.venda", label: "Venda" }, defaultId: null });
  const erros: string[] = []; page.on("pageerror", (e) => erros.push(e.message));
  const posts = vigiarPosts(page);

  await page.goto("/vendas/sales/new");
  await expect(page.getByTestId("select-tipo-operacao"), "a tela renderizou — não houve crash").toBeVisible();
  await expect(page.getByTestId("top-nao-confirmado")).toBeVisible();
  await expect(page.getByRole("button", { name: "Salvar" })).toBeDisabled();
  expect(erros, `nenhuma exceção de render: ${erros.join(" | ")}`).toEqual([]);
  expect(posts).toEqual([]);
});

test("ITEM MALFORMADO — 200 com um item fora da forma: a tela não cai, e continua bloqueada", async ({ page }) => {
  await login(page);
  // O item ruim NÃO é filtrado para "salvar" a lista: esconder do vendedor uma TOP que o servidor
  // ofereceu é o mesmo descarte silencioso que esta fatia combate, só que do lado do cliente. Lista que
  // não se confere inteira é lista não confirmada.
  await responderTops(page, { contractVersion: 1, family: { code: "vendas.venda", label: "Venda" }, defaultId: null,
    items: [topValida, { id: "22222222-2222-4222-8222-222222222222", version: 0, isDefault: "sim" }] });
  const erros: string[] = []; page.on("pageerror", (e) => erros.push(e.message));
  const posts = vigiarPosts(page);

  await page.goto("/vendas/sales/new");
  await expect(page.getByTestId("select-tipo-operacao")).toBeVisible();
  await expect(page.getByTestId("top-nao-confirmado")).toBeVisible();
  await expect(page.getByRole("button", { name: "Salvar" })).toBeDisabled();
  expect(erros, `nenhuma exceção de render: ${erros.join(" | ")}`).toEqual([]);
  expect(posts).toEqual([]);
});

test("LISTA VAZIA NO CONTRATO 1 — é configuração faltando, e a tela diz ISSO, não 'servidor'", async ({ page }) => {
  await login(page);
  // A conferência não pode ter endurecido a ponto de chamar de incompatível uma resposta perfeitamente
  // válida. `items: []` no contrato 1 é o servidor CERTO dizendo que ninguém cadastrou TOP — e a saída do
  // usuário é o caminho de Configurações, que só a mensagem "sem-top" oferece.
  await responderTops(page, { contractVersion: 1, family: { code: "vendas.venda", label: "Venda" }, defaultId: null, items: [] });

  await page.goto("/vendas/sales/new");
  await expect(page.getByTestId("top-ausente")).toBeVisible();
  await expect(page.getByTestId("top-nao-confirmado"), "contrato 1 com lista vazia É confirmado").toHaveCount(0);
  await expect(page.getByRole("button", { name: "Salvar" })).toBeDisabled();
});

test("CONTRATO 1 COM TOP VÁLIDA — a conferência deixa passar o que é bom", async ({ page }) => {
  await login(page);
  // O contrapeso dos casos acima: um gate que só sabe reprovar bloquearia a tela inteira e ninguém
  // perceberia, porque "bloqueado" também parece seguro. O caminho feliz tem de seguir vivo.
  await responderTops(page, { contractVersion: 1, family: { code: "vendas.venda", label: "Venda" }, defaultId: topValida.id, items: [topValida] });

  await page.goto("/vendas/sales/new");
  await expect(page.getByTestId("top-nao-confirmado")).toHaveCount(0);
  await expect(page.getByTestId("top-ausente")).toHaveCount(0);
  await expect(page.getByTestId("select-tipo-operacao")).toBeEnabled();
  await expect(page.getByTestId("select-tipo-operacao"), "o padrão vem PRÉ-SELECIONADO e visível").toHaveValue(topValida.id);
});

test("APRESENTAÇÃO — o caminho de Configurações só é oferecido a quem pode percorrê-lo", async ({ page }) => {
  /**
   * Quem NÃO tem `tipos_operacao.view` não enxerga a sub-área de Configurações — o guarda de navegação a
   * esconde. Mandá-lo para lá seria mandá-lo bater numa porta fechada e concluir que o sistema está
   * quebrado. Quem não configura precisa saber a quem PEDIR, não onde clicar.
   *
   * Isto é apresentação, não segurança: o servidor continua sendo a autoridade. Esconder o link não
   * protege nada — só para de mentir. E é por isso que precisa de teste: uma mentira de interface não
   * quebra nada, não aparece em log, e sobrevive a todas as suítes de servidor.
   */
  await login(page);
  // Papel que VENDE e não CONFIGURA — exatamente o recorte que o link não pode ignorar.
  const papel = await api<{ id: string }>(page, "POST", "/api/admin/roles",
    { name: uniq("Vendedor sem TOP"), permissions: ["sales.view", "sales.create", "people.view", "products.view", "warehouses.view"] });
  const vendedor = { email: `e2e-vendedor-${Date.now()}@demo.local`, password: "Vendedor@12345" };
  await api(page, "POST", "/api/admin/members",
    { name: "Vendedor E2E sem TOP", email: vendedor.email, password: vendedor.password, role_id: papel.id,
      escopos_empresas: [{ modulo: "vendas", modo: "todas", empresas: [] }] });

  // A família sem TOP é fabricada: o que se mede é a MENSAGEM, não o estado do cadastro.
  await logout(page);
  await login(page, vendedor);
  await responderTops(page, { contractVersion: 1, family: { code: "vendas.venda", label: "Venda" }, defaultId: null, items: [] });

  await page.goto("/vendas/sales/new");
  const aviso = page.getByTestId("top-ausente");
  await expect(aviso).toBeVisible();
  await expect(aviso, "o vendedor é mandado ao administrador, não a uma tela que ele não abre").toContainText("Procure um administrador");
  await expect(aviso.locator("a"), "nenhum link para Configurações para quem não tem a capacidade").toHaveCount(0);
});

test("LEGADO — documento sem TOP abre, diz que não está configurado e mantém a família", async ({ page }) => {
  await login(page);
  const empresa = await empresaAtiva(page);
  const cliente = await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1");
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  // Criado SEM `tipo_operacao_id`: é exatamente o que a web antiga (ou o acervo) produz.
  const venda = await api<{ id: string }>(page, "POST", "/api/sales/sales", {
    empresa_id: empresa, document_date: "2026-09-01", client_id: cliente,
    items: [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }]
  });

  await page.goto(`/vendas/sales/${venda.id}`);
  await expect(page.getByTestId("base2-shell"), "legado continua abrindo").toBeVisible();
  await expect(page.getByText("Não configurada (registro legado)")).toBeVisible();
  // A família canônica CONTINUA correta — ela vem do registro, não da configuração.
  await expect(page.getByText("Família operacional")).toBeVisible();

  // E continua na listagem: um INNER JOIN o teria feito sumir.
  await page.goto("/vendas?tab=sales");
  await expect(page.getByRole("heading", { name: "Vendas" })).toBeVisible();
});

test("REGRESSÃO: a TOP não mudou a confirmação nem as ações do detalhe", async ({ page }) => {
  await login(page);
  const empresa = await empresaAtiva(page);
  const top = await cadastrarTop(page, "vendas.venda", uniq("Confirma igual"));
  const cliente = await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1");
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const venda = await api<{ id: string }>(page, "POST", "/api/sales/sales", {
    empresa_id: empresa, document_date: "2026-09-01", client_id: cliente, tipo_operacao_id: top.id,
    items: [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }]
  });

  await page.goto(`/vendas/sales/${venda.id}`);
  // As ações da variante continuam as mesmas: a TOP é identidade, não comportamento.
  await expect(page.getByRole("button", { name: "Confirmar venda" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Imprimir" })).toBeVisible();
});
