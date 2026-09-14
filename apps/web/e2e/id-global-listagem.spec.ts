import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * PRE-BASE2-05B.1 — O ID GLOBAL NA LISTAGEM (apresentação revista na PRE-BASE2-05B.2).
 *
 * O que estes testes protegem, e que nem a API nem os testes de unidade pegam:
 *  - a coluna aparece MESMO para quem já configurou as colunas daquela tela. A preferência de colunas guarda
 *    uma lista fechada, e uma coluna criada depois jamais estaria nela: se a identidade dependesse dessa
 *    preferência, justamente os usuários antigos — os que têm registros para localizar — ficariam sem o
 *    número. Por isso o caso abaixo salva uma configuração de colunas e confere que ele continua lá;
 *  - o número da LINHA é o mesmo da tela de detalhe e o mesmo que a busca resolve — uma identidade só;
 *  - a linha continua abrindo pelo UUID. Se alguém "simplificar" a navegação usando o número, ele vira uma
 *    segunda identidade permanente, que resolve sem passar pela autorização daquele registro;
 *  - a célula mostra o NÚMERO PURO e a coluna NÃO nasce presa à esquerda (PRE-BASE2-05B.2). As duas
 *    afirmações são cobradas pelo comportamento real do navegador — texto da célula e deslocamento ao rolar
 *    —, não pela leitura do componente.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";

/** Cria uma OS pela API, com a sessão do navegador, e devolve o ID Global que o backend deu a ela. */
async function criarOrdemDeServico(page: Page): Promise<{ id: string; idGlobal: number; descricao: string }> {
  return page.evaluate(async (base: string) => {
    const sessao = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string };
    const cab = { "content-type": "application/json", authorization: `Bearer ${sessao.token}`, "x-org-id": sessao.orgId };
    const ctx = await (await fetch(`${base}/api/auth/context`, { headers: cab })).json();
    const descricao = `OS listagem ${Date.now()}`;
    const os = await (await fetch(`${base}/api/service-orders`, { method: "POST", headers: cab,
      body: JSON.stringify({ empresa_id: ctx.empresas[0].id, order_date: "2031-06-01", description: descricao, lines: [] }) })).json();
    const reg = await (await fetch(`${base}/api/registros-globais/entidade/service_orders/${os.id}`, { headers: cab })).json();
    if (!os?.id) throw new Error(`falha ao criar a OS de teste: ${JSON.stringify(os)}`);
    return { id: os.id as string, idGlobal: reg.idGlobal as number, descricao };
  }, API);
}

/** Cria um produto pela API (a porta que aloca o número) copiando as referências obrigatórias de um já existente. */
async function criarProduto(page: Page): Promise<{ id: string; idGlobal: number; descricao: string }> {
  return page.evaluate(async (base: string) => {
    const sessao = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string };
    const cab = { "content-type": "application/json", authorization: `Bearer ${sessao.token}`, "x-org-id": sessao.orgId };
    const lista = await (await fetch(`${base}/api/resources/products?pageSize=1`, { headers: cab })).json();
    // o detalhe traz também os campos que não são colunas da listagem (1ª unidade de medida, por exemplo)
    const modelo = await (await fetch(`${base}/api/resources/products/${lista.items[0].id}`, { headers: cab })).json() as Record<string, unknown>;
    const descricao = `Produto listagem ${Date.now()}`;
    const novo = await (await fetch(`${base}/api/resources/products`, { method: "POST", headers: cab,
      // `control_stock: false` evita depender da categoria financeira do produto-modelo (obrigatória só para quem controla estoque)
      body: JSON.stringify({ description: descricao, measurement_id: modelo.measurement_id, group_id: modelo.group_id, category_id: modelo.category_id, kind_id: modelo.kind_id, control_stock: false }) })).json();
    const reg = await (await fetch(`${base}/api/registros-globais/entidade/products/${novo.id}`, { headers: cab })).json();
    if (!novo?.id) throw new Error(`falha ao criar o produto de teste: ${JSON.stringify(novo)}`);
    return { id: novo.id as string, idGlobal: reg.idGlobal as number, descricao };
  }, API);
}

/**
 * As preferências de tela são PERSISTIDAS por usuário. Sem restaurar, um caso que mexe em colunas ou
 * congelamento contamina os seguintes — e o que falha depois não é o defeito, é o rastro do anterior.
 */
async function restaurarTela(page: Page) {
  await page.getByLabel("Mais opções").first().click();
  await page.getByRole("menuitem", { name: "Restaurar padrão da tela" }).click();
  const aviso = page.locator("[data-sonner-toast]").first();
  await expect(aviso).toContainText("restaurada");
  // o aviso cobre o canto onde fica "Mais opções": esperar ele sair evita um clique que não chega ao botão
  await expect(aviso).toHaveCount(0, { timeout: 15_000 });
}

test.describe("ID Global na listagem", () => {
  test("cadastro genérico: a coluna existe e o registro criado pela porta real traz o número", async ({ page }) => {
    await login(page);
    const produto = await criarProduto(page);
    await page.goto("/cadastros/products");
    await expect(page.getByRole("columnheader", { name: "ID Global" })).toBeVisible();
    const linha = page.getByTestId("b1-row").filter({ hasText: produto.descricao }).first();
    await expect(linha).toBeVisible();
    await expect(linha.getByTestId("id-global-celula").first(), "a célula mostra o número puro, sem prefixo").toHaveText(String(produto.idGlobal));
  });

  test("lançamento: o número da linha é o mesmo do registro aberto, e a URL continua sendo o UUID", async ({ page }) => {
    await login(page);
    const os = await criarOrdemDeServico(page);
    await page.goto("/os");
    const linha = page.getByTestId("b1-row").filter({ hasText: os.descricao }).first();
    await expect(linha).toBeVisible();
    await expect(linha.getByTestId("id-global-celula").first(), "a linha mostra a identidade global do registro").toHaveText(String(os.idGlobal));

    await linha.dblclick();
    await expect(page).toHaveURL(new RegExp(`/os/${os.id}`));
    expect(page.url(), "o ID Global é localizador; o endereço continua sendo o UUID").not.toContain(`/os/${os.idGlobal}`);
    // o selo do detalhe traz um texto de leitor de tela antes do número; a âncora no fim prova que nada
    // (um `#`, um zero à esquerda) voltou a ser colado nele
    await expect(page.getByTestId("id-global-registro"), "listagem e detalhe falam do mesmo número").toHaveText(new RegExp(`(^|\\s)${os.idGlobal}$`));
  });

  test("a coluna sobrevive a uma configuração de colunas salva pelo usuário", async ({ page }) => {
    await login(page);
    await page.goto("/cadastros/products");
    await expect(page.getByTestId("b1-row").first()).toBeVisible();

    // o usuário reduz as colunas em uso: a identidade NÃO é uma delas e não pode desaparecer com a escolha
    // (o caso não precisa de estado inicial limpo — a asserção vale a partir de qualquer configuração)
    await page.getByLabel("Mais opções").first().click();
    await page.getByRole("menuitem", { name: "Configurações" }).click();
    await expect(page.getByText("Configuração de colunas")).toBeVisible();
    await page.getByRole("button", { name: "Remover todas (mantém a primeira)" }).click();
    await page.getByRole("button", { name: "OK" }).click();

    await expect(page.getByRole("columnheader", { name: "ID Global" }), "a coluna de identidade não é uma preferência do usuário").toBeVisible();

    // e continua lá depois de recarregar a tela (a preferência salva não a apaga)
    await page.reload();
    await expect(page.getByRole("columnheader", { name: "ID Global" })).toBeVisible();
    await restaurarTela(page);
  });

  /**
   * IDA E VOLTA PELA TELA — o texto digitado na busca é LIDO da célula, não montado pelo teste.
   *
   * É o que amarra apresentação e entrada numa coisa só: se a grafia exibida mudar outra vez e a busca não
   * acompanhar, este caso quebra, porque o usuário faria exatamente isto — ler o número e digitá-lo.
   */
  test("o número da listagem é o mesmo que a busca global resolve", async ({ page }) => {
    await login(page);
    const os = await criarOrdemDeServico(page);
    await page.goto("/os");
    const linha = page.getByTestId("b1-row").filter({ hasText: os.descricao }).first();
    const texto = (await linha.getByTestId("id-global-celula").first().innerText()).trim();
    expect(texto, "a tela mostra o número puro").toBe(String(os.idGlobal));

    await page.keyboard.press("Control+k");
    await page.getByTestId("global-search").fill(texto);
    const resultado = page.getByTestId("nav-search-id-global-item");
    await expect(resultado).toBeVisible();
    await resultado.click();
    await expect(page).toHaveURL(new RegExp(`/os/${os.id}`));
  });
});

/** Cria um perfil de acesso pela API (porta que aloca o número) e devolve o ID Global dele. */
async function criarPerfil(page: Page): Promise<{ id: string; idGlobal: number; nome: string }> {
  return page.evaluate(async (base: string) => {
    const sessao = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string };
    const cab = { "content-type": "application/json", authorization: `Bearer ${sessao.token}`, "x-org-id": sessao.orgId };
    const nome = `Perfil listagem ${Date.now()}`;
    const novo = await (await fetch(`${base}/api/admin/roles`, { method: "POST", headers: cab,
      body: JSON.stringify({ name: nome, description: "criado pelo e2e de ID Global", permissions: ["products.view"] }) })).json();
    if (!novo?.id) throw new Error(`falha ao criar o perfil de teste: ${JSON.stringify(novo)}`);
    const reg = await (await fetch(`${base}/api/registros-globais/entidade/roles/${novo.id}`, { headers: cab })).json();
    return { id: novo.id as string, idGlobal: reg.idGlobal as number, nome };
  }, API);
}

/**
 * FIXTURES PELAS PORTAS REAIS.
 *
 * O seed de e2e traz animais e perfis, mas não traz título financeiro nem importação OFX. Sem fixture, a
 * listagem dessas duas telas abre vazia — e um teste que percorre "as células" de uma tela vazia passa sem
 * olhar nada. Os dados são criados pela MESMA porta que o usuário usaria, no banco descartável do e2e.
 */
async function semearTituloAPagar(page: Page): Promise<void> {
  const erro = await page.evaluate(async (base: string) => {
    const sessao = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string };
    const cab = { "content-type": "application/json", authorization: `Bearer ${sessao.token}`, "x-org-id": sessao.orgId };
    const um = async (url: string) => ((await (await fetch(`${base}${url}`, { headers: cab })).json()).items ?? [])[0] as { id: string } | undefined;
    const ctx = await (await fetch(`${base}/api/auth/context`, { headers: cab })).json();
    const [fornecedor, categoria, centro] = await Promise.all([
      um("/api/resources/people?is_provider=true&pageSize=1"),
      um("/api/resources/financial_categories?kind=analytic&nature=expense&pageSize=1"),
      um("/api/resources/cost_centers?kind=analytic&pageSize=1")
    ]);
    if (!fornecedor || !categoria || !centro) return `pré-condição ausente no seed: fornecedor=${!!fornecedor} categoria=${!!categoria} centro=${!!centro}`;
    const r = await fetch(`${base}/api/financial/payables`, { method: "POST", headers: cab, body: JSON.stringify({
      empresa_id: ctx.empresas[0].id, number: `LST-${Date.now()}`, person_id: fornecedor.id, amount: "123.45",
      emission_date: "2031-07-01", due_date: "2031-08-01", note: "fixture do e2e de ID Global",
      apportionment: [{ financial_category_id: categoria.id, cost_center_id: centro.id, percentage: "100" }]
    }) });
    return r.ok ? "" : `falha ao criar o título: ${await r.text()}`;
  }, API);
  expect(erro, "fixture de conta a pagar").toBe("");
}

/** OFX mínimo e VÁLIDO para o parser do próprio sistema (um STMTTRN com DTPOSTED, TRNAMT e FITID). */
async function semearImportacaoOfx(page: Page): Promise<void> {
  const erro = await page.evaluate(async (base: string) => {
    const sessao = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string };
    const cab = { "content-type": "application/json", authorization: `Bearer ${sessao.token}`, "x-org-id": sessao.orgId };
    const conta = ((await (await fetch(`${base}/api/resources/bank_accounts?pageSize=1`, { headers: cab })).json()).items ?? [])[0] as { id: string } | undefined;
    if (!conta) return "pré-condição ausente no seed: nenhuma conta bancária";
    const ofx = ["<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>",
      "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20310701<TRNAMT>-123.45<FITID>E2E-ID-GLOBAL-1<MEMO>fixture e2e</STMTTRN>",
      "</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>"].join("\n");
    const r = await fetch(`${base}/api/financial/ofx-imports`, { method: "POST", headers: cab,
      body: JSON.stringify({ bank_account_id: conta.id, description: `Extrato e2e ${Date.now()}`, content: ofx }) });
    return r.ok ? "" : `falha ao importar OFX: ${await r.text()}`;
  }, API);
  expect(erro, "fixture de importação OFX").toBe("");
}

/**
 * TELAS QUE NÃO PASSAM PELO MODELO BASE1 (PRE-BASE2-05B.1).
 *
 * Quatro listagens montam a grade por conta própria com DataTable e por isso receberam a coluna
 * explicitamente. Sem estes casos, apagar `colunaIdGlobalTabela(...)` de qualquer uma delas passaria por
 * catálogo, enriquecimento da API, matriz das 23 entidades e N+1 sem acender nenhuma luz — o número
 * simplesmente sumiria da tela, que é exatamente o que esta fatia existe para impedir.
 */
const CUSTOM: { nome: string; rota: string; semear?: (page: Page) => Promise<void> }[] = [
  { nome: "títulos financeiros (contas a pagar)", rota: "/financeiro/contas-a-pagar", semear: semearTituloAPagar },
  { nome: "animais", rota: "/pecuaria/animais" },
  { nome: "importações OFX", rota: "/financeiro/ofx", semear: semearImportacaoOfx },
  { nome: "perfis de acesso", rota: "/admin/perfis" }
];

test.describe("ID Global nas listagens que montam a grade por conta própria", () => {
  for (const tela of CUSTOM) {
    test(`${tela.nome} — uma célula de identidade por linha, cada uma número puro ou ausência explícita`, async ({ page }) => {
      await login(page);
      if (tela.semear) await tela.semear(page);
      await page.goto(tela.rota);
      await expect(page.getByRole("columnheader", { name: "ID Global" })).toBeVisible();

      const linhas = page.getByTestId("b1-row");
      // Sem linhas, percorrer "as células" não prova nada: a pré-condição é parte do contrato do teste.
      await expect(linhas.first(), `${tela.rota} precisa ter pelo menos uma linha para a prova valer`).toBeVisible();
      const total = await linhas.count();
      const celulas = linhas.locator('[data-testid="id-global-celula"]');
      expect(await celulas.count(), "toda linha tem exatamente uma célula de identidade").toBe(total);
      // a forma é cobrada em TODA célula: um prefixo que voltasse em uma tela só já reprova aqui
      for (let i = 0; i < total; i++) await expect(celulas.nth(i)).toHaveText(/^(\d+|–)$/);
    });
  }

  test("perfis de acesso: o número da linha é o mesmo que o backend deu ao registro", async ({ page }) => {
    await login(page);
    const perfil = await criarPerfil(page);
    await page.goto("/admin/perfis");
    const linha = page.getByTestId("b1-row").filter({ hasText: perfil.nome }).first();
    await expect(linha).toBeVisible();
    await expect(linha.getByTestId("id-global-celula").first()).toHaveText(String(perfil.idGlobal));
    // a linha continua abrindo pelo UUID
    await linha.dblclick();
    await expect(page).toHaveURL(new RegExp(`/admin/perfis/${perfil.id}`));
  });
});

/**
 * RODAPÉ DE TOTAIS — alinhamento geométrico, não contagem de células.
 *
 * O defeito real que este caso pega: a coluna de identidade entra à esquerda e o `colSpan` do rodapé não
 * acompanha, então o total de Peso aparece embaixo de Entrada. Nenhum teste de contagem de colunas pegaria
 * isso; a única pergunta que importa é "o total está sob a SUA coluna?", e ela se responde comparando as
 * posições que o navegador realmente calculou.
 */
async function alinhamentoDeTotal(page: Page, rotuloDaColuna: string, indiceDoTotal: number) {
  // O cabeçalho é localizado pelo `title` do botão da coluna: o nome acessível do <th> inclui o menu e a
  // alça de redimensionar, então casá-lo por texto exato é frágil.
  const th = page.locator(`thead th:has(button[title="${rotuloDaColuna}"])`).first();
  const td = page.locator("tfoot td.num").nth(indiceDoTotal);
  await expect(th).toBeVisible();
  await expect(td).toBeVisible();
  const [a, b] = [await th.boundingBox(), await td.boundingBox()];
  expect(a, "cabeçalho medido").toBeTruthy();
  expect(b, "célula de total medida").toBeTruthy();
  return Math.abs(a!.x - b!.x);
}

test.describe("rodapé de totais alinhado mesmo com a coluna de identidade", () => {
  test("animais: o total de Peso fica sob a coluna Peso, e o de Valor sob Valor", async ({ page }) => {
    await login(page);
    await page.goto("/pecuaria/animais");
    await expect(page.getByRole("columnheader", { name: "ID Global" })).toBeVisible();
    expect(await alinhamentoDeTotal(page, "Peso (kg)", 0), "total de Peso desalinhado da coluna Peso").toBeLessThan(2);
    expect(await alinhamentoDeTotal(page, "Valor", 1), "total de Valor desalinhado da coluna Valor").toBeLessThan(2);
  });

  test("vendas (Modelo Base1): o total fica sob a coluna Total — a compensação central também é cobrada", async ({ page }) => {
    await login(page);
    await page.goto("/vendas/sales");
    await expect(page.getByRole("columnheader", { name: "ID Global" })).toBeVisible();
    expect(await alinhamentoDeTotal(page, "Total", 0), "total desalinhado da coluna Total").toBeLessThan(2);
  });

  test("contas a pagar: os totais ficam sob Valor e Saldo", async ({ page }) => {
    await login(page);
    await page.goto("/financeiro/contas-a-pagar");
    await expect(page.getByRole("columnheader", { name: "ID Global" })).toBeVisible();
    expect(await alinhamentoDeTotal(page, "Valor", 0), "total de Valor desalinhado").toBeLessThan(2);
    expect(await alinhamentoDeTotal(page, "Saldo", 1), "total de Saldo desalinhado").toBeLessThan(2);
  });
});

/**
 * A COLUNA DE IDENTIDADE NÃO PODE OFERECER CONTROLE QUE NÃO FUNCIONA.
 *
 * "Ocultar" que não oculta, "Auto ajustar" que volta ao mesmo tamanho e arraste que se desfaz ao soltar são
 * piores do que a ausência do controle: o usuário não sabe se o sistema o ignorou ou se ele errou. As
 * capacidades são declaradas na COLUNA (`hideable`/`resizable`/`freezable`/`autoFit`), então a grade
 * continua genérica e a próxima coluna travada nasce correta.
 */
test.describe("capacidades da coluna de identidade", () => {
  test("ID Global não oferece menu de coluna nem alça de redimensionar; uma coluna normal continua oferecendo", async ({ page }) => {
    await login(page);
    await page.goto("/cadastros/products");
    await expect(page.getByRole("columnheader", { name: "ID Global" })).toBeVisible();
    await restaurarTela(page);

    await expect(page.getByLabel("Abrir menu da coluna ID Global"), "coluna de identidade não tem menu").toHaveCount(0);
    await expect(page.getByLabel("Redimensionar ID Global"), "coluna de identidade não tem alça de arraste").toHaveCount(0);

    // controle de coluna comum permanece intacto — a capacidade é por coluna, não um bloqueio global
    await expect(page.getByLabel("Abrir menu da coluna Descrição")).toHaveCount(1);
    await expect(page.getByLabel("Redimensionar Descrição")).toHaveCount(1);
    await page.getByLabel("Abrir menu da coluna Descrição").click();
    await expect(page.getByRole("menuitem", { name: "Ocultar coluna" })).toBeEnabled();
    await expect(page.getByRole("menuitem", { name: "Auto ajustar coluna" })).toBeEnabled();
    await page.keyboard.press("Escape");
  });

  test("ID Global permanece a PRIMEIRA coluna e NÃO nasce congelada", async ({ page }) => {
    await login(page);
    await page.goto("/cadastros/products");
    await expect(page.getByTestId("b1-row").first()).toBeVisible();
    await restaurarTela(page);
    const primeiro = page.locator("thead th").nth(1); // 0 = célula de seleção
    // ordem e pinagem são decisões DIFERENTES: a identidade continua à frente das colunas de negócio (quem a
    // põe ali é quem monta a lista), e deixou de ficar grudada na borda (PRE-BASE2-05B.2)
    await expect(primeiro).toContainText("ID Global");
    await expect(primeiro, "a identidade deixou de ser pinada").not.toHaveClass(/is-frozen/);
    await expect(page.locator("thead th.is-frozen"), "sem congelamento configurado, nenhuma coluna nasce presa").toHaveCount(0);
  });
});

/**
 * PINAGEM DE VERDADE — a diferença entre "o usuário não solta" e "está preso".
 *
 * `freezable: false` só impede o usuário de mexer; quem prende uma coluna à borda é `pinned: "left"`. A
 * PRE-BASE2-05B.2 tirou a segunda da identidade e manteve a primeira, e a distinção só aparece no
 * comportamento real do navegador ao rolar na horizontal — uma classe CSS ausente provaria bem menos.
 *
 * Medir a coluna de negócio JUNTO é o que dá sentido à medida da identidade: se a grade não transbordasse,
 * ou se a rolagem não acontecesse, as duas ficariam paradas e um teste ingênuo passaria sem olhar nada.
 */
async function deslocamentoAoRolar(page: Page, rotuloDaColunaQueRola: string) {
  const th = page.locator('thead th:has-text("ID Global")').first();
  const outra = page.locator(`thead th:has(button[title="${rotuloDaColunaQueRola}"])`).first();
  await expect(th).toBeVisible();
  await expect(outra).toBeVisible();
  const antes = { id: (await th.boundingBox())!.x, outra: (await outra.boundingBox())!.x };
  // rola o contêiner da grade de verdade; se não houver transbordo horizontal, o caso não vale
  const rolagem = await page.evaluate(() => {
    const el = document.querySelector("table")?.parentElement as HTMLElement | null;
    if (!el) return 0;
    el.scrollLeft = el.scrollWidth;
    return el.scrollLeft;
  });
  await page.waitForTimeout(150);
  const depois = { id: (await th.boundingBox())!.x, outra: (await outra.boundingBox())!.x };
  return { rolagem, deslocamentoIdentidade: Math.abs(depois.id - antes.id), deslocamentoOutra: Math.abs(depois.outra - antes.outra) };
}

test.describe("a identidade ROLA com as demais colunas (PRE-BASE2-05B.2)", () => {
  test("Modelo Base1 (produtos)", async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 700, height: 800 });
    await page.goto("/cadastros/products");
    await expect(page.getByTestId("b1-row").first()).toBeVisible();
    await restaurarTela(page);
    const r = await deslocamentoAoRolar(page, "Descrição");
    expect(r.rolagem, "a grade precisa transbordar para que a rolagem prove algo").toBeGreaterThan(0);
    expect(r.deslocamentoOutra, "uma coluna de negócio acompanha a rolagem").toBeGreaterThan(10);
    expect(r.deslocamentoIdentidade, "a identidade acompanha a rolagem como qualquer outra coluna").toBeGreaterThan(10);
  });

  test("grade própria (animais) — onde nenhum congelamento é configurado", async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 700, height: 800 });
    await page.goto("/pecuaria/animais");
    await expect(page.getByTestId("b1-row").first()).toBeVisible();
    const r = await deslocamentoAoRolar(page, "Categoria");
    expect(r.rolagem, "a grade precisa transbordar para que a rolagem prove algo").toBeGreaterThan(0);
    expect(r.deslocamentoOutra, "uma coluna de negócio acompanha a rolagem").toBeGreaterThan(10);
    expect(r.deslocamentoIdentidade, "a identidade acompanha a rolagem como qualquer outra coluna").toBeGreaterThan(10);
  });

  /**
   * O CONGELAMENTO DO USUÁRIO CONTINUA INTEIRO — soltar a identidade não podia custar o recurso.
   *
   * Havia DOIS mecanismos prendendo a identidade: `pinned: "left"` na coluna e um `+1` incondicional no
   * `frozen` que o Base1List passa à grade. Tirar só o primeiro deixaria as listagens do Modelo Base1
   * exatamente como antes, e o caso passaria por engano nas telas de `DataTable`. Por isso o piso é cobrado
   * aqui: ZERO ao abrir.
   *
   * Quando o usuário congela, a identidade vai junto — não por decisão da coluna, mas porque colunas fixas
   * são um prefixo contíguo: não existe prender a 1ª coluna de negócio deixando solta a que está à esquerda
   * dela. Descongelar volta a zero, e não a um piso.
   */
  test("nada nasce congelado, e o congelamento escolhido pelo usuário continua funcionando", async ({ page }) => {
    await login(page);
    await page.goto("/cadastros/products");
    await expect(page.getByTestId("b1-row").first()).toBeVisible();
    await restaurarTela(page);
    // a identidade segue sem menu: ela não é congelável POR ELA MESMA, o que é outra pergunta
    await expect(page.getByLabel("Abrir menu da coluna ID Global")).toHaveCount(0);

    const congeladas = page.locator("thead th.is-frozen");
    await expect(congeladas, "sem escolha do usuário, nenhuma coluna começa congelada").toHaveCount(0);
    // "Congelar coluna" congela ATÉ ela (contagem à esquerda): identidade + Código + Descrição
    await page.getByLabel("Abrir menu da coluna Descrição").click();
    await page.getByRole("menuitem", { name: "Congelar coluna" }).click();
    await expect(congeladas, "o congelamento do usuário leva junto o que está à esquerda").toHaveCount(3);
    await page.getByLabel("Abrir menu da coluna Descrição").click();
    await page.getByRole("menuitem", { name: "Descongelar colunas" }).click();
    await expect(congeladas, "descongelar volta a ZERO — não existe mais piso estrutural").toHaveCount(0);
    await expect(page.locator("thead th").nth(1), "a identidade continua sendo a primeira coluna").toContainText("ID Global");
    await restaurarTela(page);
  });
});

/**
 * REGRESSÃO DO MENU DE COLUNA COMUM (bloqueador B).
 *
 * Corrigir o menu da identidade não pode mudar o menu das outras: "não aplicável por capacidade" e
 * "aplicável, mas indisponível agora" continuam sendo coisas diferentes na interface.
 */
test.describe("menu das colunas comuns permanece como era", () => {
  test("coluna sem filtro declarado mantém o item de filtro DESABILITADO, não ausente", async ({ page }) => {
    await login(page);
    await page.goto("/pecuaria/animais");
    await expect(page.getByTestId("b1-row").first()).toBeVisible();
    // DataTable não passa nenhum manipulador de coluna: todos os itens existem e todos ficam desabilitados
    await page.getByLabel("Abrir menu da coluna Categoria").click();
    for (const item of ["Abrir filtro avançado", "Auto ajustar coluna", "Ocultar coluna"]) {
      await expect(page.getByRole("menuitem", { name: item }), `${item} continua visível`).toBeVisible();
      await expect(page.getByRole("menuitem", { name: item }), `${item} continua desabilitado`).toBeDisabled();
    }
    await page.keyboard.press("Escape");
  });
});
