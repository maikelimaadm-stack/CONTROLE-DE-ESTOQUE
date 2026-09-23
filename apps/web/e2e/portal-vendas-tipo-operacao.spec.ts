import { test, expect, type Page } from "@playwright/test";
import { login, logout, api, uniq, empresaAtiva, primeiroId, pickRef, abrirLancamentoDeVendas, escolherTopEContinuar, abrirAbaDoLancamento, escolherPrimeiroProdutoDaLinha } from "./helpers";

/**
 * PORTAL DE VENDAS COM TOP CADASTRADA — o caminho que o usuário faz de verdade (TOP-CONFIG-02).
 *
 * A integração já prova a cadeia no servidor. O que SÓ este arquivo pode provar é o elo do cliente, e
 * dentro dele o que mais importa: a tela NÃO ESCREVE quando o servidor ainda é antigo. Esse é o único
 * caso em que nenhum teste de API ajuda — o defeito mora exatamente na conversa entre as duas versões.
 */
const PORTAL = "/vendas";

/**
 * Cadastra uma TOP pela API administrativa (o E2E do cadastro em si é da TOP-CONFIG-01).
 *
 * O CÓDIGO VOLTA JUNTO COM O ID porque, a partir da TOP-CONFIG-03, ele é PARTE DO RÓTULO que a tela
 * escreve no botão de conversão ("Converter em 71234 — Pedido especial"). Sem o código aqui, a asserção
 * sobre esse rótulo teria de copiar um literal — e um literal copiado passa a valer mesmo quando a tela
 * deixa de nomear a operação escolhida, que é exatamente o defeito que a asserção existe para pegar.
 */
async function cadastrarTop(page: Page, codigoBase: string, nome: string, extra: Record<string, unknown> = {}) {
  const codigo = `7${Math.floor(Math.random() * 90000 + 10000)}`;
  const criado = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase, nome, ...extra });
  return { id: criado.id, codigo };
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
  await expect(page.getByTestId("central-vendas")).toBeVisible();
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
  await expect(page.getByTestId("central-vendas")).toBeVisible();
  // A PROVA QUE IMPORTA: a tela mostra o nome de ONTEM, porque lê a versão congelada.
  await expect(page.getByText(nomeV1)).toBeVisible();
  await expect(page.getByText(nomeV2), "o nome novo NÃO pode aparecer no documento antigo").toHaveCount(0);
});

test("conversão exige a TOP do DESTINO, e a fonte mantém a dela", async ({ page }) => {
  /**
   * ATUALIZADO NA TOP-CONFIG-03 — a MESMA propriedade, pelo caminho novo.
   *
   * Antes, a tela oferecia a conversão por uma cadeia fixa e perguntava a TOP do destino num `<select>`
   * carregado da variante seguinte. Agora quem diz o que este documento pode gerar é a VERSÃO da TOP de
   * origem que ele cita (`/proximos-passos`), e o leque já vem resolvido em TOPs de destino.
   *
   * O QUE ESTE TESTE CONTINUA PROVANDO, sem afrouxar: o documento de destino nasce com a TOP DO DESTINO
   * (nunca herda a da fonte), a TOP da fonte não é oferecida como próximo passo dela mesma, e a fonte
   * continua exibindo a sua depois da conversão. Só o mecanismo de escolha mudou de `<select>` para o
   * leque do grafo.
   */
  await login(page);
  const empresa = await empresaAtiva(page);
  const nomeOrcamento = uniq("Orçamento padrão");
  const nomePedido = uniq("Pedido especial");
  const topPedido = await cadastrarTop(page, "vendas.pedido", nomePedido, { padrao: true });
  // A ARESTA É A CONFIGURAÇÃO DA ORIGEM: orçamento → este pedido. Sem ela o documento não ofereceria
  // conversão nenhuma, e o teste mediria a ponte de compatibilidade em vez do grafo.
  const topOrcamento = await cadastrarTop(page, "vendas.orcamento", nomeOrcamento,
    { destinos: [{ tipoOperacaoId: topPedido.id, ordem: 0 }] });

  const cliente = await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1");
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const orcamento = await api<{ id: string }>(page, "POST", "/api/sales/budgets", {
    empresa_id: empresa, document_date: "2026-09-01", client_id: cliente, tipo_operacao_id: topOrcamento.id,
    items: [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }]
  });

  await page.goto(`/vendas/budgets/${orcamento.id}`);
  await expect(page.getByTestId("central-vendas"), "a premissa: o documento abriu").toBeVisible();
  // O RÓTULO NOMEIA A OPERAÇÃO DE DESTINO. Um destino só não vira "Converter" genérico: o operador
  // precisa saber, ANTES do clique, em que operação o documento novo nasce.
  const acao = page.getByTestId("acao-conversao");
  await expect(acao).toHaveText(`Converter em ${topPedido.codigo} — ${nomePedido}`);
  await acao.click();

  const dialogo = page.getByTestId("dialog-conversao");
  await expect(dialogo).toBeVisible();
  // O próximo passo é a TOP DO DESTINO — provado pelo id, não pelo texto: só o id distingue "a tela
  // mostrou a TOP certa" de "a tela mostrou um texto que por acaso contém o mesmo nome".
  const unico = dialogo.getByTestId("proximo-passo-unico");
  await expect(unico).toHaveAttribute("data-top-id", topPedido.id);
  await expect(unico).toContainText(nomePedido);
  // E a TOP DA FONTE não é oferecida como próximo passo dela mesma.
  await expect(dialogo.getByText(nomeOrcamento), "a TOP de orçamento NÃO pode ser oferecida").toHaveCount(0);
  // Com um destino só não há o que escolher — e, portanto, nenhum seletor de TOP do destino: ele era a
  // pergunta da cadeia anterior, e a política já respondeu.
  await expect(dialogo.getByTestId("select-tipo-operacao"), "o grafo já respondeu qual é o destino").toHaveCount(0);

  await dialogo.getByRole("button", { name: "Converter" }).click();
  await expect(page).toHaveURL(/\/vendas\/orders\//);
  await expect(page.getByText(nomePedido), "o destino usa a TOP dele").toBeVisible();
  await expect(page.getByText(nomeOrcamento), "e NÃO herda a TOP da fonte").toHaveCount(0);

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
  await expect(page.getByTestId("central-vendas"), "legado continua abrindo").toBeVisible();
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

  /**
   * Do PORTAL, pelo caminho que o usuário faz — não por URL digitada.
   *
   * ATUALIZADO NA TOP-CONFIG-03: o `+ Novo` deixou de perguntar a VARIANTE ("Nova venda") e passou a
   * oferecer as OPERAÇÕES agrupadas por família. Escolher a operação já decide a porta, então não há
   * mais menu de documento.
   *
   * ATUALIZADO NA VISUAL-UX-01 R3: como no design, o clique ESCOLHE a operação e o `Lançar` (ou o
   * Enter, ou o duplo clique) lança. O caminho aqui é o explícito: escolher e lançar.
   */
  await page.goto(PORTAL);
  await page.getByTestId("vendas-novo").click();
  const lancador = page.getByTestId("lancador-unificado");
  await expect(lancador, "o `Novo` do portal abre o lançador unificado").toBeVisible();
  await lancador.locator(`[data-testid="lancador-top"][data-top-id="${top.id}"]`).click();
  await page.getByTestId("lancador-lancar").click();

  /**
   * A OPERAÇÃO ESCOLHIDA NO PORTAL É PEDIDO, NÃO AUTORIZAÇÃO: ela vira `?tipo_operacao_id=<uuid>` na
   * rota da variante, e lá o id é reconferido contra a lista que o SERVIDOR devolve para AQUELA
   * variante. O formulário só monta porque essa conferência passou — o que se afirma abaixo é a URL
   * (o pedido) E o contexto montado (a resposta), porque só as duas juntas separam "a tela obedeceu à
   * URL" de "a tela confirmou a operação".
   */
  await expect(page).toHaveURL(new RegExp(`/vendas/sales/new\\?tipo_operacao_id=${top.id}`));
  await expect(page.getByTestId("top-contexto"), "a escolha do portal abre o formulário já contextualizado").toContainText(nomeTop);
  await expect(page.getByTestId("top-lancador"), "e não devolve o usuário à pergunta que ele já respondeu").toHaveCount(0);

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
  /*
    A lista de opções é procurada DENTRO do painel de pesquisa, e não na página: `page.getByRole("option")`
    casaria também o `<select>` de empresa da barra superior, cuja opção nunca fica visível.
  */
  await escolherPrimeiroProdutoDaLinha(page);

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
  await abrirAbaDoLancamento(page, "Observações");
  await page.getByLabel("Observação").fill("rascunho que não pode sumir calado");
  await page.getByTestId("top-alterar").click();
  await expect(page.getByRole("dialog")).toContainText("Alterar o Tipo de Operação?");
  await expect(page.getByTestId("top-contexto"), "enquanto não confirma, o formulário continua lá").toBeVisible();
  await page.getByTestId("confirm-dialog-confirm").click();
  await esperarLancadorSemFormulario(page);
});

/**
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * R1 CORRETIVA — O PADRÃO É DO CADASTRO, E A EDIÇÃO NÃO SE APAGA SOZINHA (TOP-CONFIG-02B R1)
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */

test("D-DEFAULT-1 — UMA TOP SEM PADRÃO NÃO É PADRÃO: nada vem marcado, e Continuar não avança", async ({ page }) => {
  await login(page);

  /**
   * A LISTA É SERVIDA PELA INTERCEPTAÇÃO, e não pelo cadastro. Não é conveniência: a pergunta deste
   * teste é sobre o CLIENTE — "dada uma lista de UM item e `defaultId` nulo, o que a tela faz?" —, e o
   * banco de e2e é compartilhado pelo arquivo inteiro. A primeira versão deste teste cadastrou uma TOP
   * de verdade e mediu 8 opções, porque os outros testes povoam a mesma família; a premissa dependia da
   * ordem de execução, que é exatamente o tipo de acoplamento que envelhece calado.
   *
   * É o mesmo recurso que os casos de contrato (500, 404, contractVersion 2, corpo truncado) já usam
   * neste arquivo pelo mesmo motivo: a resposta é a ENTRADA do comportamento sob teste.
   */
  const soUma = { id: "11111111-1111-4111-8111-111111111111", code: "70001", name: "Orçamento Único", version: 1, isDefault: false };
  await page.route("**/api/sales/budgets/operation-types", async (rota) => {
    await rota.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ contractVersion: 1, family: { code: "vendas.orcamento", label: "Orçamento de Venda" }, defaultId: null, items: [soUma] }) });
  });

  await abrirLancamentoDeVendas(page, "budgets");

  // A PREMISSA, contada e não suposta: é realmente UMA opção, e ela é a que foi servida.
  await expect(page.getByTestId("top-opcao"), "a lista precisa ter exatamente UMA TOP").toHaveCount(1);
  await expect(page.locator(`[data-testid="top-opcao"][data-top-id="${soUma.id}"]`)).toBeVisible();

  // E MESMO ASSIM ela não vem marcada: "única opção" não é "operação padrão".
  await expect(page.locator('[data-testid="top-opcao"] input[type="radio"]'), "nada pré-selecionado sem defaultId").not.toBeChecked();
  await expect(page.getByTestId("top-continuar"), "sem escolha não há como continuar").toBeDisabled();
  await expect(page.getByTestId("top-contexto"), "o formulário não pode existir").toHaveCount(0);

  // Depois do clique EXPLÍCITO do usuário, aí sim.
  await page.locator(`[data-testid="top-opcao"][data-top-id="${soUma.id}"]`).click();
  await expect(page.locator('[data-testid="top-opcao"] input[type="radio"]')).toBeChecked();
  await expect(page.getByTestId("top-continuar")).toBeEnabled();
  await expect(page.getByTestId("top-contexto"), "marcar ainda não é continuar").toHaveCount(0);

  await page.getByTestId("top-continuar").click();
  await expect(page.getByTestId("top-contexto")).toContainText(soUma.name);
});

test("D-DEFAULT-2 — PADRÃO DE VERDADE pré-seleciona, mas continua sem auto-avançar", async ({ page }) => {
  await login(page);
  const nome = uniq("Pedido Padrão");
  const top = await cadastrarTop(page, "vendas.pedido", nome, { padrao: true });

  await abrirLancamentoDeVendas(page, "orders");

  // Vem marcada porque o CADASTRO a marcou — a autoridade do padrão é o servidor, via `defaultId`.
  const opcao = page.locator(`[data-testid="top-opcao"][data-top-id="${top.id}"]`);
  await expect(opcao.locator("input[type='radio']"), "o padrão do cadastro vem marcado").toBeChecked();
  await expect(page.getByTestId("top-continuar")).toBeEnabled();

  // E O LANÇADOR CONTINUA NA TELA. Pré-selecionar adianta trabalho; auto-avançar decide pelo usuário.
  await expect(page.getByTestId("top-lancador")).toBeVisible();
  await expect(page.getByTestId("top-contexto"), "o padrão NÃO abre o formulário sozinho").toHaveCount(0);

  await page.getByTestId("top-continuar").click();
  await expect(page.getByTestId("top-contexto")).toContainText(nome);
});

test("C1 — REVALIDAÇÃO NÃO APAGA O FORMULÁRIO: a TOP sai da lista e o que foi digitado continua lá", async ({ page }) => {
  await login(page);
  const top = await cadastrarTop(page, "vendas.venda", uniq("Venda Em Edição"));

  await abrirLancamentoDeVendas(page, "sales");
  await escolherTopEContinuar(page, top.id);

  const rascunho = "rascunho que não pode sumir sozinho";
  await abrirAbaDoLancamento(page, "Observações");
  await page.getByLabel("Observação").fill(rascunho);

  // A lista é CONTADA, para que o teste prove que a revalidação aconteceu de fato — sem isso ele
  // passaria mesmo que nenhum refetch tivesse sido disparado, provando apenas que nada aconteceu.
  let buscas = 0;
  await page.route("**/api/sales/sales/operation-types", async (rota) => { buscas += 1; await rota.fallback(); });

  // O servidor muda de ideia DEPOIS de o formulário estar aberto e preenchido.
  const atual = await api<{ revisao: number }>(page, "GET", `/api/admin/tipos-operacao/${top.id}`);
  await api(page, "PUT", `/api/admin/tipos-operacao/${top.id}`, { ativo: false, revisao: atual.revisao });

  /**
   * O EVENTO REAL, não um atalho: `onlineManager` do React Query escuta `online` na janela, e
   * `refetchOnReconnect` (ligado por padrão) refaz toda query ATIVA. Era por aqui que o formulário
   * sumia — e o mesmo vale para a invalidação sem chave que `components/layout/shell.tsx` dispara ao
   * trocar a empresa selecionada.
   *
   * A ESPERA É OBRIGATÓRIA, e é por isso que ela está escrita aqui em vez de escondida num `waitFor`
   * genérico: `lib/query.tsx` declara `staleTime: 15_000`, e reconexão NÃO refaz query que ainda está
   * fresca. Sem passar desse prazo o `online` não dispara nada, `buscas` fica em 0 e o teste vira um
   * verde que não provou coisa alguma — foi exatamente assim que a primeira versão dele reprovou.
   */
  await page.waitForTimeout(16_000);
  await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")); });

  await expect.poll(() => buscas, { message: "a revalidação precisa ter ACONTECIDO, senão o teste não prova nada" }).toBeGreaterThan(0);

  // E o formulário continua inteiro: a validação é da ENTRADA, não de cada renderização.
  await expect(page.getByTestId("top-contexto"), "o formulário não pode ter sido desmontado").toBeVisible();
  await expect(page.getByLabel("Observação"), "o que foi digitado continua lá").toHaveValue(rascunho);
  await expect(page.getByTestId("top-lancador"), "e não voltou ao lançador por conta própria").toHaveCount(0);
});

test("C2 — O SERVIDOR AINDA MANDA: salvar com a TOP já desativada recusa, e não apaga o formulário", async ({ page }) => {
  await login(page);
  const top = await cadastrarTop(page, "vendas.venda", uniq("Venda Recusada"));

  await abrirLancamentoDeVendas(page, "sales");
  await escolherTopEContinuar(page, top.id);

  const rascunho = "precisa sobreviver à recusa";
  await abrirAbaDoLancamento(page, "Observações");
  await page.getByLabel("Observação").fill(rascunho);
  await pickRef(page, "Cliente", "DEMO");
  await page.getByRole("button", { name: /Adicionar item/ }).click();
  await escolherPrimeiroProdutoDaLinha(page);

  // A TOP é desativada DEPOIS de o formulário estar pronto para salvar.
  const atual = await api<{ revisao: number }>(page, "GET", `/api/admin/tipos-operacao/${top.id}`);
  await api(page, "PUT", `/api/admin/tipos-operacao/${top.id}`, { ativo: false, revisao: atual.revisao });

  const respostas: number[] = [];
  page.on("response", (r) => { if (r.url().endsWith("/api/sales/sales") && r.request().method() === "POST") respostas.push(r.status()); });

  await page.getByRole("button", { name: "Salvar" }).click();

  // O POST SAI e é RECUSADO pelo servidor — a trava do cliente não vira permissão.
  await expect.poll(() => respostas, { message: "o POST precisa ter sido emitido e respondido" }).toEqual([422]);
  await expect(page).not.toHaveURL(/\/vendas\/sales\/[0-9a-f-]{36}$/);

  // E a recusa não custa o trabalho do usuário: nada foi apagado, nada foi trocado por outra TOP.
  await expect(page.getByTestId("top-contexto")).toBeVisible();
  await expect(page.getByLabel("Observação")).toHaveValue(rascunho);
});

/**
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * R2 — O RASCUNHO FICA; A ESCRITA, NÃO (TOP-CONFIG-02B R2)
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A R1 manteve o formulário montado quando a descoberta mudava no meio da edição — e manteve DEMAIS:
 * o Salvar continuava habilitado. Num rolling deploy isso reabre o buraco da TOP-CONFIG-02, porque a
 * API que vai receber o POST pode ser a ANTIGA, que IGNORA `tipo_operacao_id` em silêncio. "O servidor
 * devolve 422" não é garantia quando o servidor talvez não conheça o campo.
 *
 * Os testes abaixo medem as duas coisas separadamente: o rascunho SOBREVIVE e o POST NÃO SAI.
 */

/** Assume a rota de descoberta da variante e permite trocar a resposta no meio do teste. */
async function descobertaControlada(page: Page, variante: string) {
  const ctrl: { resposta: { status: number; corpo: unknown } | null; chamadas: number } = { resposta: null, chamadas: 0 };
  await page.route(`**/api/sales/${variante}/operation-types`, async (rota) => {
    ctrl.chamadas += 1;
    if (!ctrl.resposta) return rota.fallback();                       // enquanto null, o servidor real responde
    await rota.fulfill({ status: ctrl.resposta.status, contentType: "application/json", body: JSON.stringify(ctrl.resposta.corpo) });
  });
  return ctrl;
}

/**
 * Força uma revalidação REAL da descoberta e só devolve quando ela aconteceu.
 *
 * A espera não é folga: `lib/query.tsx` declara `staleTime: 15_000`, e reconexão NÃO refaz query que
 * ainda está fresca. Sem passar desse prazo o `online` não dispara nada e o teste viraria um verde que
 * não mediu coisa alguma. O retorno CONTA as chamadas para que isso seja verificável, não suposto.
 */
async function revalidar(page: Page, ctrl: { chamadas: number }) {
  const antes = ctrl.chamadas;
  await page.waitForTimeout(16_000);
  await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")); });
  await expect.poll(() => ctrl.chamadas, { message: "a revalidação precisa ter ACONTECIDO" }).toBeGreaterThan(antes);
}

/** O estado que interessa depois de uma descoberta adversa: rascunho inteiro, escrita fechada. */
async function esperarRascunhoSemEscrita(page: Page, rascunho: string, posts: string[]) {
  await expect(page.getByTestId("top-contexto"), "o formulário continua montado").toBeVisible();
  await expect(page.getByLabel("Observação"), "o que foi digitado continua lá").toHaveValue(rascunho);
  await expect(page.getByRole("button", { name: "Salvar" }), "a escrita está fechada").toBeDisabled();
  await expect(page.getByTestId("top-alterar"), "trocar de operação continua possível").toBeVisible();
  await expect(page.getByTestId("top-lancador"), "não voltou ao lançador sozinho").toHaveCount(0);
  expect(posts, "ZERO POST — o cliente JÁ SABE que não pode gravar").toEqual([]);
}

/**
 * Abre o formulário de venda com uma TOP real e o deixa PRONTO PARA SALVAR — cliente, item e um
 * rascunho identificável.
 *
 * Preencher tudo NÃO é capricho: é o que dá sentido às asserções de `Salvar desabilitado` que vêm
 * depois. Com o formulário pela metade o botão já estaria desabilitado por falta de cliente e de item,
 * e os testes de RD1–RD4 passariam mesmo se o bloqueio por capability não existisse — verdes que não
 * mediriam nada. Por isso a última linha AFIRMA que o botão está habilitado: é a premissa, provada
 * junto com a conclusão.
 */
async function formularioComRascunho(page: Page, rascunho: string) {
  const top = await cadastrarTop(page, "vendas.venda", uniq("Venda R2"));
  await abrirLancamentoDeVendas(page, "sales");
  await escolherTopEContinuar(page, top.id);
  await abrirAbaDoLancamento(page, "Observações");
  await page.getByLabel("Observação").fill(rascunho);
  await pickRef(page, "Cliente", "DEMO");
  await page.getByRole("button", { name: /Adicionar item/ }).click();
  await escolherPrimeiroProdutoDaLinha(page);
  await expect(page.getByRole("button", { name: "Salvar" }), "a PREMISSA: sem o bloqueio, este formulário salvaria").toBeEnabled();
  return top;
}

test("RD1 — ROLLING DEPLOY: a descoberta cai em 500 durante a edição; rascunho fica, Salvar fecha", async ({ page }) => {
  await login(page);
  const posts = vigiarPosts(page);
  const ctrl = await descobertaControlada(page, "sales");
  const rascunho = "venda em digitação durante o deploy";
  await formularioComRascunho(page, rascunho);

  // A PRÓXIMA descoberta cai na API anterior — a que ignoraria `tipo_operacao_id` em silêncio.
  ctrl.resposta = { status: 500, corpo: { error: { code: "INTERNAL_ERROR", message: "x" } } };
  await revalidar(page, ctrl);

  await expect(page.getByTestId("top-nao-confirmado"), "a tela diz que o servidor não confirmou").toBeVisible();
  await esperarRascunhoSemEscrita(page, rascunho, posts);
});

test("RD2 — CONTRATO FUTURO durante a edição: rascunho fica, Salvar fecha", async ({ page }) => {
  await login(page);
  const posts = vigiarPosts(page);
  const ctrl = await descobertaControlada(page, "sales");
  const rascunho = "venda em digitação contra contrato 2";
  await formularioComRascunho(page, rascunho);

  ctrl.resposta = { status: 200, corpo: { contractVersion: 2, family: { code: "vendas.venda", label: "Venda" }, defaultId: null, items: [] } };
  await revalidar(page, ctrl);

  await expect(page.getByTestId("top-nao-confirmado"), "200 de contrato desconhecido também NEGA").toBeVisible();
  await esperarRascunhoSemEscrita(page, rascunho, posts);
});

test("RD3 — A TOP SAIU DA LISTA, servidor compatível: não troca de operação, e não grava", async ({ page }) => {
  await login(page);
  const posts = vigiarPosts(page);
  const ctrl = await descobertaControlada(page, "sales");
  const rascunho = "venda cuja operação saiu de circulação";
  await formularioComRascunho(page, rascunho);
  const nomeDaSessao = await page.getByTestId("top-contexto").textContent();

  /**
   * Aqui o servidor está COMPATÍVEL — contrato 1, família certa, lista válida. O que mudou é que a
   * operação ESCOLHIDA não está mais entre as ativas, e há OUTRA no lugar dela. É o caso que separa
   * "servidor incompatível" de "operação indisponível": a mensagem é outra, e a tentação de trocar
   * sozinho para a TOP vizinha é exatamente o que não pode acontecer.
   */
  const vizinha = { id: "22222222-2222-4222-8222-222222222222", code: "70999", name: "Outra Venda Qualquer", version: 1, isDefault: false };
  ctrl.resposta = { status: 200, corpo: { contractVersion: 1, family: { code: "vendas.venda", label: "Venda" }, defaultId: null, items: [vizinha] } };
  await revalidar(page, ctrl);

  await expect(page.getByTestId("top-indisponivel"), "a recusa é a de operação indisponível").toBeVisible();
  await expect(page.getByTestId("top-nao-confirmado"), "o servidor NÃO está incompatível").toHaveCount(0);
  await esperarRascunhoSemEscrita(page, rascunho, posts);

  // E a operação da SESSÃO continua sendo a escolhida — nenhuma troca automática pela vizinha.
  await expect(page.getByTestId("top-contexto")).toHaveText(nomeDaSessao!);
  await expect(page.getByTestId("top-contexto"), "não adotou a TOP vizinha").not.toContainText(vizinha.name);
});

test("RD4 — A CAPABILITY VOLTA: Salvar reabilita e o rascunho não foi perdido no caminho", async ({ page }) => {
  await login(page);
  const posts = vigiarPosts(page);
  const ctrl = await descobertaControlada(page, "sales");
  const rascunho = "rascunho que atravessou a janela de deploy";
  await formularioComRascunho(page, rascunho);

  ctrl.resposta = { status: 500, corpo: { error: { code: "INTERNAL_ERROR", message: "x" } } };
  await revalidar(page, ctrl);
  await esperarRascunhoSemEscrita(page, rascunho, posts);

  // O deploy termina e o servidor volta a responder. Nada aqui remonta o formulário.
  ctrl.resposta = null;
  await revalidar(page, ctrl);

  await expect(page.getByTestId("top-nao-confirmado"), "o aviso some quando a causa some").toHaveCount(0);
  await expect(page.getByLabel("Observação"), "e o rascunho atravessou inteiro").toHaveValue(rascunho);
  await expect(page.getByTestId("top-contexto"), "sem precisar escolher a operação de novo").toBeVisible();
  await expect(page.getByRole("button", { name: "Salvar" }), "a escrita reabre").toBeEnabled();
});

test("V1 — A TRAVA NÃO ATRAVESSA A VARIANTE: TOP de venda não abre formulário de pedido", async ({ page }) => {
  await login(page);
  const posts = vigiarPosts(page);
  const top = await cadastrarTop(page, "vendas.venda", uniq("Venda Só Dela"));

  await abrirLancamentoDeVendas(page, "sales");
  await escolherTopEContinuar(page, top.id);
  await expect(page.getByTestId("top-contexto"), "a sessão de VENDA está aberta e travada").toBeVisible();

  /**
   * O MESMO UUID, agora pedido explicitamente na variante errada. A TOP existe, está ativa e é
   * desta organização — só não é da FAMÍLIA de pedido. A recusa é a mesma de sempre.
   *
   * NOTA HONESTA SOBRE O ALCANCE DESTE TESTE: ele prova a FRONTEIRA, não o ciclo de vida. O caso em
   * que a instância sobreviveria a uma troca de `kind` não é alcançável neste runtime, e eu tentei:
   * `history.pushState` atualiza o pathname mas NÃO o `params` (o `kind` é resolvido no servidor),
   * então nem troca de variante acontece; e uma navegação de verdade entre variantes remonta o
   * componente, matando a trava antes que a chave precise ser consultada. Não há, a partir da tela do
   * formulário, um caminho client-side para a outra variante COM query — o "+ Novo" mora no Portal.
   *
   * Por isso o `kind` na chave é defesa ESTRUTURAL, e está escrito assim de propósito: a garantia não
   * pode depender de "o Next remonta, certo?", que é exatamente o tipo de premissa que uma atualização
   * de framework revoga em silêncio. A reversa R14 é, coerentemente, NÃO OBSERVÁVEL — e isso está
   * declarado no relatório em vez de fabricado como vermelho.
   */
  await page.goto(`/vendas/orders/new?tipo_operacao_id=${top.id}`);
  await expect(page.getByTestId("top-indisponivel"), "TOP de outra família é recusada").toBeVisible();
  await esperarLancadorSemFormulario(page);
  expect(posts, "e nada foi gravado no caminho").toEqual([]);
});

/**
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * CV1/CV2 — O DIÁLOGO DE CONVERSÃO DA CADEIA DE COMPATIBILIDADE (ainda vivo na TOP-CONFIG-03)
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Estes dois casos medem o `<select>` de TOP do DESTINO, que é o diálogo ANTERIOR ao grafo. Ele não
 * desapareceu: durante o rolling deploy a web NOVA conversa com a API ANTIGA, onde `/proximos-passos`
 * não existe, e nesse caso a tela cai justamente nele em vez de esconder a conversão de quem depende
 * dela. O que estes testes provam — "uma TOP única não é um padrão", "o padrão do CADASTRO vem
 * escolhido e continua trocável" — continua valendo exatamente ali.
 *
 * Por isso a descoberta de próximos passos é derrubada de propósito: sem isso, o servidor REAL confirma
 * a política, o documento não tem transição nenhuma configurada e a conversão simplesmente não é
 * oferecida — o teste morreria esperando um botão que a fatia nova acerta em não mostrar.
 */
async function derrubarProximosPassos(page: Page, segmento: string, status = 404) {
  await page.route(`**/api/sales/${segmento}/*/proximos-passos`, (rota) =>
    rota.fulfill({ status, contentType: "application/json",
      body: JSON.stringify({ error: { code: "NOT_FOUND", message: "x" } }) }));
}

test("CV1 — CONVERSÃO SEM PADRÃO: nada vem escolhido, e Converter só libera depois da escolha", async ({ page }) => {
  await login(page);
  const empresa = await empresaAtiva(page);
  const topOrcamento = await cadastrarTop(page, "vendas.orcamento", uniq("Orçamento CV1"));
  const cliente = await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1");
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const orcamento = await api<{ id: string }>(page, "POST", "/api/sales/budgets", {
    empresa_id: empresa, document_date: "2026-09-01", client_id: cliente, tipo_operacao_id: topOrcamento.id,
    items: [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }]
  });

  /**
   * A lista do DESTINO é servida aqui porque a organização do e2e é compartilhada: outro teste pode já
   * ter marcado uma TOP de pedido como padrão, e aí `defaultId` não seria nulo. A pergunta deste teste
   * é sobre o CLIENTE — "com `defaultId` nulo, ele inventa um padrão?" —, e a resposta não pode
   * depender da ordem de execução.
   */
  const unica = { id: "33333333-3333-4333-8333-333333333333", code: "70777", name: "Pedido Sem Padrão", version: 1, isDefault: false };
  await page.route("**/api/sales/orders/operation-types", (rota) =>
    rota.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ contractVersion: 1, family: { code: "vendas.pedido", label: "Pedido de Venda" }, defaultId: null, items: [unica] }) }));

  // A API ANTERIOR à TOP-CONFIG-03 — é o único cenário em que este diálogo ainda aparece.
  await derrubarProximosPassos(page, "budgets");

  await page.goto(`/vendas/budgets/${orcamento.id}`);
  await expect(page.getByTestId("central-vendas"), "a premissa: o orçamento abriu").toBeVisible();
  const acao = page.getByTestId("acao-conversao");
  // NA COMPATIBILIDADE O RÓTULO NOMEIA A FAMÍLIA do destino — é tudo o que se sabe antes de perguntar
  // as TOPs. Afirmar o rótulo aqui é o que distingue "caiu na cadeia anterior" de "leu o grafo".
  await expect(acao, "sem política confirmada, o destino é a família da cadeia anterior").toHaveText("Converter em Pedido de venda");
  await acao.click();
  const dialogo = page.getByTestId("dialog-conversao");
  await expect(dialogo).toBeVisible();
  // E nenhum próximo passo do grafo pode ter sido desenhado: o servidor não confirmou política nenhuma.
  await expect(dialogo.getByTestId("proximo-passo-unico")).toHaveCount(0);
  await expect(dialogo.getByTestId("proximo-passo-opcao")).toHaveCount(0);

  // UMA opção, e MESMO ASSIM nada escolhido: uma TOP única não é um padrão.
  await expect(dialogo.getByTestId("select-tipo-operacao")).toHaveValue("");
  await expect(dialogo.getByRole("button", { name: "Converter" }), "sem escolha não converte").toBeDisabled();

  await dialogo.getByTestId("select-tipo-operacao").selectOption(unica.id);
  await expect(dialogo.getByRole("button", { name: "Converter" }), "depois da escolha explícita, libera").toBeEnabled();
});

test("CV2 — CONVERSÃO COM PADRÃO REAL: vem pré-selecionado e visível, e pode ser trocado", async ({ page }) => {
  await login(page);
  const empresa = await empresaAtiva(page);
  const topOrcamento = await cadastrarTop(page, "vendas.orcamento", uniq("Orçamento CV2"));
  const cliente = await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1");
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const orcamento = await api<{ id: string }>(page, "POST", "/api/sales/budgets", {
    empresa_id: empresa, document_date: "2026-09-01", client_id: cliente, tipo_operacao_id: topOrcamento.id,
    items: [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }]
  });

  const padrao = { id: "44444444-4444-4444-8444-444444444444", code: "70555", name: "Pedido Padrão CV2", version: 1, isDefault: true };
  const outra = { id: "55555555-5555-4555-8555-555555555555", code: "70556", name: "Pedido Alternativo", version: 1, isDefault: false };
  await page.route("**/api/sales/orders/operation-types", (rota) =>
    rota.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ contractVersion: 1, family: { code: "vendas.pedido", label: "Pedido de Venda" }, defaultId: padrao.id, items: [padrao, outra] }) }));

  await derrubarProximosPassos(page, "budgets");

  await page.goto(`/vendas/budgets/${orcamento.id}`);
  await expect(page.getByTestId("central-vendas"), "a premissa: o orçamento abriu").toBeVisible();
  await page.getByTestId("acao-conversao").click();
  const dialogo = page.getByTestId("dialog-conversao");
  await expect(dialogo).toBeVisible();

  await expect(dialogo.getByTestId("select-tipo-operacao"), "o padrão do CADASTRO vem escolhido").toHaveValue(padrao.id);
  await expect(dialogo.getByRole("button", { name: "Converter" })).toBeEnabled();
  // Pré-selecionar não é decidir: o campo continua à vista e trocável.
  await dialogo.getByTestId("select-tipo-operacao").selectOption(outra.id);
  await expect(dialogo.getByTestId("select-tipo-operacao")).toHaveValue(outra.id);
});
