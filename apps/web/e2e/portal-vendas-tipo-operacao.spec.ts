import { test, expect, type Page } from "@playwright/test";
import { login, logout, api, uniq, empresaAtiva, primeiroId, pickRef, abrirLancamentoDeVendas, escolherTopEContinuar } from "./helpers";

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

/**
 * O FORMULÁRIO NÃO EXISTE ATÉ A OPERAÇÃO SER ESCOLHIDA (TOP-CONFIG-02B).
 *
 * Esta asserção é a fronteira da fatia: enquanto não há TOP válida na URL, `/new` mostra o lançador e o
 * formulário não está na árvore — não "está desabilitado". É por isso que os casos de bloqueio abaixo
 * deixaram de medir `Salvar desabilitado`: não há Salvar para desabilitar, e um `toBeDisabled()` sobre
 * elemento inexistente falharia por motivo errado.
 */
async function esperarLancadorSemFormulario(page: Page) {
  await expect(page.getByTestId("top-lancador"), "a etapa de escolha é o que está na tela").toBeVisible();
  await expect(page.getByTestId("top-contexto"), "o formulário NÃO pode ter montado").toHaveCount(0);
  await expect(page.getByRole("button", { name: "Salvar" }), "não existe Salvar fora do formulário").toHaveCount(0);
}

test("cadastra TOPs, lança pelo Portal de Vendas e o detalhe mostra o snapshot", async ({ page }) => {
  await login(page);
  const empresa = await empresaAtiva(page);
  const nomeTop = uniq("Venda de Gado a Prazo");
  const top = await cadastrarTop(page, "vendas.venda", nomeTop, { padrao: true });

  // O título do portal foi assumido formalmente nesta fatia.
  await page.goto(PORTAL);
  await expect(page.getByRole("heading", { name: "Vendas" })).toBeVisible();

  await abrirLancamentoDeVendas(page, "sales");
  // O PADRÃO vem PRÉ-SELECIONADO e VISÍVEL — mas o lançador CONTINUA na tela: pré-selecionar adianta
  // trabalho, auto-avançar decidiria pelo usuário, e é a diferença entre as duas que esta fatia defende.
  await expect(page.locator(`[data-testid="top-opcao"][data-top-id="${top.id}"] input`)).toBeChecked();
  await esperarLancadorSemFormulario(page);
  // E o lançador só oferece TOPs da família da variante.
  const opcoes = await page.getByTestId("top-opcao").allInnerTexts();
  expect(opcoes.some((o) => o.includes(nomeTop)), "a TOP de venda aparece").toBe(true);
  // Confirmando, o formulário abre já contextualizado — e a operação fica em destaque, fora do grid.
  await escolherTopEContinuar(page, top.id);
  await expect(page.getByTestId("top-contexto")).toContainText(nomeTop);
  await expect(page.getByTestId("select-tipo-operacao"), "a TOP saiu do grid de campos: ela é contexto, não campo").toHaveCount(0);

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
  await esperarLancadorSemFormulario(page);
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
    await esperarLancadorSemFormulario(page);
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
  await esperarLancadorSemFormulario(page);
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
  await expect(page.getByTestId("top-lancador"), "a tela renderizou — não houve crash").toBeVisible();
  await expect(page.getByTestId("top-nao-confirmado")).toBeVisible();
  await esperarLancadorSemFormulario(page);
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
  await expect(page.getByTestId("top-lancador"), "a tela renderizou — não houve crash").toBeVisible();
  await expect(page.getByTestId("top-nao-confirmado")).toBeVisible();
  await esperarLancadorSemFormulario(page);
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
  await esperarLancadorSemFormulario(page);
});

test("CONTRATO 1 COM TOP VÁLIDA — a conferência deixa passar o que é bom", async ({ page }) => {
  await login(page);
  // O contrapeso dos casos acima: um gate que só sabe reprovar bloquearia a tela inteira e ninguém
  // perceberia, porque "bloqueado" também parece seguro. O caminho feliz tem de seguir vivo.
  await responderTops(page, { contractVersion: 1, family: { code: "vendas.venda", label: "Venda" }, defaultId: topValida.id, items: [topValida] });

  await page.goto("/vendas/sales/new");
  await expect(page.getByTestId("top-nao-confirmado")).toHaveCount(0);
  await expect(page.getByTestId("top-ausente")).toHaveCount(0);
  // ASSERÇÃO POSITIVA, e não só a ausência dos avisos: "não apareceu bloqueio" é satisfeito de graça por
  // uma tela que não renderizou nada. O que prova o caminho feliz é a lista TER a opção e o padrão vir
  // marcado — e o formulário AINDA não estar aberto, porque o padrão não pula a etapa.
  await expect(page.getByTestId("top-opcao")).toHaveCount(1);
  await expect(page.locator(`[data-testid="top-opcao"][data-top-id="${topValida.id}"] input`), "o padrão vem PRÉ-SELECIONADO e visível").toBeChecked();
  await expect(page.getByTestId("top-continuar")).toBeEnabled();
  await expect(page.getByTestId("top-contexto"), "pré-selecionar não é avançar").toHaveCount(0);
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

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * TOP-CONFIG-02B · A OPERAÇÃO É ESCOLHIDA ANTES DO FORMULÁRIO
 *
 * O que estes casos protegem não é a etapa em si — é a propriedade de que NÃO EXISTE caminho para o
 * formulário que não passe por uma TOP confirmada pelo SERVIDOR. A URL é pedido; quem responde é a lista.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

/** Uma TOP nova, ativa, da família pedida — a fixture de quase todos os casos abaixo. */
const topDaFamilia = (page: Page, familia: string, rotulo: string) => cadastrarTop(page, familia, uniq(rotulo));

test("E1 VENDA — do Portal ao snapshot: lançador, formulário contextualizado e o UUID no POST", async ({ page }) => {
  await login(page);
  const nomeTop = uniq("Venda a Prazo");
  const top = await cadastrarTop(page, "vendas.venda", nomeTop);

  // Do PORTAL, pelo caminho que o usuário faz — não por URL digitada.
  await page.goto(PORTAL);
  await page.getByTestId("ws-new").click();
  await page.getByRole("menuitem", { name: "Nova venda" }).click();

  await expect(page.getByTestId("top-lancador"), "o Portal leva ao lançador, não ao formulário").toBeVisible();
  await esperarLancadorSemFormulario(page);
  await escolherTopEContinuar(page, top.id);

  // O contexto operacional está em destaque, no topo — e o campo saiu do grid.
  await expect(page.getByTestId("top-contexto")).toContainText(nomeTop);
  await expect(page.getByTestId("select-tipo-operacao")).toHaveCount(0);

  // O CORPO DO POST é a prova que interessa: o UUID enviado é o da TOP VALIDADA, não o texto da URL.
  // A requisição é interceptada para que a asserção seja sobre o que o cliente MANDOU, e não sobre o que
  // o servidor conseguiu gravar — são perguntas diferentes, e só a primeira é desta fatia.
  let corpo: Record<string, unknown> | null = null;
  await page.route("**/api/sales/sales", async (rota) => {
    if (rota.request().method() !== "POST") return rota.fallback();
    corpo = rota.request().postDataJSON() as Record<string, unknown>;
    await rota.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000000" }) });
  });

  await pickRef(page, "Cliente", "DEMO");
  await page.getByRole("button", { name: /Adicionar item/ }).click();
  const linha = page.locator("tbody tr").first();
  await linha.locator("button").nth(1).click();                       // 0 = Armazém, 1 = Produto
  await page.getByPlaceholder("Pesquisar...").fill("DEMO");
  await page.getByRole("option").first().click();

  await page.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(() => corpo, { message: "o formulário precisa ter emitido o POST" }).not.toBeNull();
  expect(corpo!.tipo_operacao_id, "o UUID do corpo é exatamente a TOP escolhida no lançador").toBe(top.id);
});

for (const [variante, familia, rotulo] of [["budgets", "vendas.orcamento", "Orçamento"], ["orders", "vendas.pedido", "Pedido"]] as [string, string, string][]) {
  test(`E2/E3 ${rotulo.toUpperCase()} — a mesma etapa vale para a variante, com a família dela`, async ({ page }) => {
    await login(page);
    const nome = uniq(rotulo);
    const top = await cadastrarTop(page, familia, nome);

    await abrirLancamentoDeVendas(page, variante);
    await esperarLancadorSemFormulario(page);
    await expect(page.getByTestId("top-opcao").filter({ hasText: nome })).toHaveCount(1);
    await escolherTopEContinuar(page, top.id);

    await expect(page.getByTestId("top-contexto")).toContainText(nome);
    await expect(page.getByTestId("select-tipo-operacao"), "a TOP saiu do grid também aqui").toHaveCount(0);
  });
}

test("ISOLAMENTO ENTRE FAMÍLIAS — cada variante lista só a sua, e a TOP vizinha não abre o formulário", async ({ page }) => {
  await login(page);
  const orcamento = await topDaFamilia(page, "vendas.orcamento", "Só de Orçamento");
  const venda = await topDaFamilia(page, "vendas.venda", "Só de Venda");

  // (a) A lista de cada variante não contém a TOP da outra.
  await abrirLancamentoDeVendas(page, "sales");
  await expect(page.locator(`[data-testid="top-opcao"][data-top-id="${venda.id}"]`)).toHaveCount(1);
  await expect(page.locator(`[data-testid="top-opcao"][data-top-id="${orcamento.id}"]`), "TOP de orçamento não aparece em venda").toHaveCount(0);

  // (b) E FORÇAR pela URL não abre o formulário: o UUID existe, é desta organização e está ativo — só não
  //     pertence à lista DESTA variante. É exatamente o caso que a FK do banco não pegaria.
  const posts = vigiarPosts(page);
  await page.goto(`/vendas/sales/new?tipo_operacao_id=${orcamento.id}`);
  await expect(page.getByTestId("top-indisponivel")).toBeVisible();
  await esperarLancadorSemFormulario(page);
  expect(posts, "ZERO POST com TOP de outra família").toEqual([]);
});

test("DEEP LINK ADULTERADO — UUID inexistente e texto malformado caem na MESMA recusa", async ({ page }) => {
  await login(page);
  await topDaFamilia(page, "vendas.venda", "Venda Válida");
  const posts = vigiarPosts(page);

  for (const [caso, valor] of [
    ["UUID inexistente", "99999999-9999-4999-8999-999999999999"],
    ["texto malformado", "nao-e-uuid"],
    ["vazio", ""]
  ] as [string, string][]) {
    await page.goto(`/vendas/sales/new?tipo_operacao_id=${encodeURIComponent(valor)}`);
    await esperarLancadorSemFormulario(page);
    if (valor) {
      // Uma frase só para todas as causas: distinguir viraria oráculo de quais UUIDs existem.
      await expect(page.getByTestId("top-indisponivel"), `${caso}: a recusa é a mesma`).toBeVisible();
    } else {
      // Parâmetro vazio é "não pediu nada": lançador limpo, sem acusar erro que o usuário não cometeu.
      await expect(page.getByTestId("top-indisponivel"), "vazio não é pedido inválido").toHaveCount(0);
    }
  }
  expect(posts, "nenhum POST em nenhum dos casos").toEqual([]);
});

test("TOP DESATIVADA DEPOIS DA ESCOLHA — o formulário não reabre no refresh", async ({ page }) => {
  await login(page);
  const top = await cadastrarTop(page, "vendas.venda", uniq("Venda Temporária"));

  await abrirLancamentoDeVendas(page, "sales");
  await escolherTopEContinuar(page, top.id);

  // A TOP sai de circulação DEPOIS de o formulário já estar aberto — o link continua igual, e é o
  // servidor que muda de ideia. A revalidação acontece na lista, não num cache do cliente.
  const atual = await api<{ revisao: number }>(page, "GET", `/api/admin/tipos-operacao/${top.id}`);
  await api(page, "PUT", `/api/admin/tipos-operacao/${top.id}`, { ativo: false, revisao: atual.revisao });

  await page.reload();
  await expect(page.getByTestId("top-indisponivel")).toBeVisible();
  await esperarLancadorSemFormulario(page);
});

test("REFRESH E HISTÓRICO — a escolha sobrevive ao recarregamento e Voltar sai da criação", async ({ page }) => {
  await login(page);
  const nome = uniq("Venda Persistente");
  const top = await cadastrarTop(page, "vendas.venda", nome);

  await abrirLancamentoDeVendas(page, "sales");
  await escolherTopEContinuar(page, top.id);

  // REFRESH: a URL é o estado, então o formulário volta com a MESMA operação.
  await page.reload();
  await expect(page.getByTestId("top-contexto")).toContainText(nome);

  /**
   * VOLTAR sai da criação em vez de reabrir a pergunta. É consequência de `replace`: lançador e
   * formulário são duas caras da mesma etapa, não dois lugares no histórico. Quem quer trocar a operação
   * tem o botão "Alterar operação" — e ele avisa antes de descartar o que foi digitado.
   */
  await page.goBack();
  await expect(page.getByTestId("top-contexto"), "Voltar não devolve ao lançador").toHaveCount(0);
});

test("ALTERAR OPERAÇÃO — volta ao lançador, e avisa antes de descartar o que foi digitado", async ({ page }) => {
  await login(page);
  const top = await cadastrarTop(page, "vendas.venda", uniq("Venda Inicial"));

  await abrirLancamentoDeVendas(page, "sales");
  await escolherTopEContinuar(page, top.id);

  // (a) SEM nada digitado, a troca é imediata: perguntar aqui seria ruído que ensina a ignorar avisos.
  await page.getByTestId("top-alterar").click();
  await esperarLancadorSemFormulario(page);

  // (b) COM dado digitado, pergunta antes — e só descarta depois do "sim".
  await escolherTopEContinuar(page, top.id);
  await page.getByLabel("Observação").fill("rascunho que não pode sumir calado");
  await page.getByTestId("top-alterar").click();
  await expect(page.getByRole("dialog")).toContainText("Alterar o Tipo de Operação?");
  await expect(page.getByTestId("top-contexto"), "enquanto não confirma, o formulário continua lá").toBeVisible();
  await page.getByTestId("confirm-dialog-confirm").click();
  await esperarLancadorSemFormulario(page);
});
