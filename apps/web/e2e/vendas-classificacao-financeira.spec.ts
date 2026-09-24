import { test, expect, type Page } from "@playwright/test";
import { login, api, uniq, pickRef, empresaAtiva, primeiroId, abrirLancamentoDeVendas, escolherTopEContinuar, escolherPrimeiroProdutoDaLinha, preencherClassificacaoFinanceira, CLASSIFICACAO_DO_SEED } from "./helpers";

/**
 * VENDAS-A1 — A CLASSIFICAÇÃO FINANCEIRA NO DOCUMENTO DE VENDA, PELA TELA.
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PROVA ──────────────────────────────────────────────────────────────────┐
 * │ A API aceita e valida o par (categoria financeira, centro de custo) — isso é da integração. Aqui │
 * │ se mede o que a TELA promete: os dois campos existem em Dados principais, o Salvar não libera    │
 * │ sem eles nas TRÊS variantes, o lookup só OFERECE o que a API aceitaria (analítica de receita;    │
 * │ centro analítico), o detalhe mostra "código · nome" do que foi gravado, a conversão carrega a    │
 * │ classificação até a venda, e o documento SEM classificação diz em voz alta que a confirmação     │
 * │ vai usar o padrão automático — em vez de deixar o campo vazio parecendo um defeito.              │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ A REGRA ANTI-VACUIDADE ───────────────────────────────────────────────────────────────────────┐
 * │ "O lookup não oferece a categoria sintética" só prova alguma coisa se a sintética EXISTE e o     │
 * │ servidor a devolveria sem o filtro. Por isso cada ausência vem precedida da premissa lida da     │
 * │ API sem o filtro — a mesma porta de opções, na mesma busca —, e de uma presença positiva (a      │
 * │ analítica de receita aparece). Sem isso, um seed que perdesse as sintéticas deixaria o teste     │
 * │ verde com o filtro removido.                                                                     │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

const WORKSPACE = "central-vendas";
type Variante = "budgets" | "orders" | "sales";
const FAMILIA: Record<Variante, string> = { budgets: "vendas.orcamento", orders: "vendas.pedido", sales: "vendas.venda" };

/** TOP própria por caso, prefixo 6 para não colidir com os specs vizinhos (5 é da Central, 7 do portal). */
async function cadastrarTop(page: Page, variante: Variante) {
  const codigo = `6${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const criado = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase: FAMILIA[variante], nome: uniq("Classificação A1") });
  return { id: criado.id, codigo };
}

async function abrirCriacao(page: Page, variante: Variante) {
  const top = await cadastrarTop(page, variante);
  await abrirLancamentoDeVendas(page, variante);
  await escolherTopEContinuar(page, top.id);
  await expect(page.getByTestId(WORKSPACE)).toBeVisible();
  return top;
}

/** O campo de leitura do detalhe, pelo rótulo (`data-campo`), dentro da Central. */
const campo = (page: Page, rotulo: string) => page.getByTestId(WORKSPACE).locator(`[data-campo="${rotulo}"]`);

type Opcao = { id: string; label: string; code: string | null };
const opcoes = (page: Page, recurso: string, busca: string) =>
  api<Opcao[]>(page, "GET", `/api/resources/${recurso}/options?search=${encodeURIComponent(busca)}`);

/** Abre o RefSelect do campo, digita a busca e devolve o painel — só depois de a resposta filtrada chegar. */
async function buscarNoLookup(page: Page, rotulo: string, recurso: string, busca: string) {
  const campoDoForm = page.locator("label", { hasText: rotulo }).first().locator("..");
  const painelAberto = page.locator("[data-radix-popper-content-wrapper]");
  if (!(await painelAberto.count())) await campoDoForm.locator("button").first().click();
  // A busca é conferida DECODIFICADA: o cliente codifica espaço como "+", e comparar o texto cru da URL
  // esperaria para sempre por uma grafia que nunca sai.
  const resposta = page.waitForResponse((r) => { const u = new URL(r.url()); return u.pathname.endsWith(`/api/resources/${recurso}/options`) && u.searchParams.get("search") === busca; });
  await page.getByPlaceholder("Pesquisar...").fill(busca);
  const r = await resposta;
  return { painel: painelAberto.last(), url: r.url(), corpo: await r.json() as Opcao[] };
}

async function fecharLookup(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-radix-popper-content-wrapper]")).toHaveCount(0);
}

test("A1-W1 — venda nova: os dois campos, Salvar só com os dois, lookups filtrados e o detalhe com código · nome", async ({ page }) => {
  await login(page);
  await abrirCriacao(page, "sales");
  const ws = page.getByTestId(WORKSPACE);
  const dados = ws.getByRole("region", { name: "Dados principais" });

  // Os dois campos moram em Dados principais, logo depois de "Forma de pagamento".
  await expect(dados.locator("label", { hasText: "Categoria financeira" })).toBeVisible();
  await expect(dados.locator("label", { hasText: "Centro de custo" })).toBeVisible();
  const rotulos = await dados.locator("label").allInnerTexts();
  const pos = (r: string) => rotulos.findIndex((t) => t.includes(r));
  expect(pos("Forma de pagamento"), "premissa: a forma de pagamento está na região").toBeGreaterThanOrEqual(0);
  expect([pos("Categoria financeira"), pos("Centro de custo")], "a ordem do contrato: forma de pagamento → categoria → centro")
    .toEqual([pos("Forma de pagamento") + 1, pos("Forma de pagamento") + 2]);

  // Salvar: com cliente e item, falta SÓ a classificação — e é ela que segura o botão.
  const salvar = page.getByRole("button", { name: "Salvar" });
  await pickRef(page, "Cliente", "DEMO");
  await page.getByRole("button", { name: /Adicionar item/ }).click();
  await escolherPrimeiroProdutoDaLinha(page);
  await expect(salvar, "cliente e item sem classificação: não salva").toBeDisabled();

  /**
   * O LOOKUP DE CATEGORIA SÓ OFERECE ANALÍTICA DE RECEITA. A premissa é lida primeiro, na MESMA porta de
   * opções e com a MESMA busca, mas sem o filtro: as sintéticas de receita e a analítica de despesa do seed
   * existem e seriam devolvidas. Só então a ausência na tela prova o filtro — e não um seed diferente.
   */
  const semFiltroReceitas = await opcoes(page, "financial_categories", "Receitas");
  expect(semFiltroReceitas.map((o) => o.label), "premissa: sem o filtro, 'Receitas' devolve as SINTÉTICAS do seed")
    .toEqual(expect.arrayContaining(["RECEITAS", "Receitas da Pecuária", "Receitas Agrícolas"]));
  const semFiltroEnergia = await opcoes(page, "financial_categories", "Energia");
  expect(semFiltroEnergia.map((o) => o.label), "premissa: sem o filtro, 'Energia' devolve a analítica de DESPESA do seed").toContain("Energia Elétrica");
  const proibidas = new Set([...semFiltroReceitas, ...semFiltroEnergia].map((o) => o.id));

  const receitas = await buscarNoLookup(page, "Categoria financeira", "financial_categories", "Receitas");
  expect(receitas.url, "o lookup pede o recorte ao SERVIDOR").toMatch(/kind=analytic/);
  expect(receitas.url).toMatch(/nature=income/);
  expect(receitas.corpo.filter((o) => proibidas.has(o.id)).map((o) => o.label), "nenhuma sintética chega ao lookup").toEqual([]);
  await expect(receitas.painel.getByRole("option"), "a busca 'Receitas' só casa sintéticas — nada é oferecido").toHaveCount(0);
  await expect(receitas.painel.getByText("Nenhum resultado")).toBeVisible();

  const energia = await buscarNoLookup(page, "Categoria financeira", "financial_categories", "Energia");
  expect(energia.corpo.filter((o) => proibidas.has(o.id)).map((o) => o.label), "a categoria de despesa não chega ao lookup").toEqual([]);
  await expect(energia.painel.getByRole("option"), "a despesa analítica não é oferecida").toHaveCount(0);

  // E a presença positiva: a analítica de receita do seed É oferecida — senão as ausências acima seriam vácuo.
  const boi = await buscarNoLookup(page, "Categoria financeira", "financial_categories", CLASSIFICACAO_DO_SEED.categoria.nome);
  await expect(boi.painel.getByRole("option", { name: new RegExp(CLASSIFICACAO_DO_SEED.categoria.nome) })).toHaveCount(1);
  await fecharLookup(page);

  // O LOOKUP DE CENTRO SÓ OFERECE ANALÍTICO — mesma premissa, mesma porta.
  const semFiltroAdm = await opcoes(page, "cost_centers", "Administração");
  expect(semFiltroAdm.map((o) => o.label), "premissa: sem o filtro, o centro SINTÉTICO do seed é devolvido").toContain("Administração");
  const adm = await buscarNoLookup(page, "Centro de custo", "cost_centers", "Administração");
  expect(adm.url).toMatch(/kind=analytic/);
  expect(adm.corpo.map((o) => o.id).filter((id) => semFiltroAdm.some((s) => s.id === id)), "o centro sintético não chega ao lookup").toEqual([]);
  await expect(adm.painel.getByRole("option"), "o sintético não é oferecido").toHaveCount(0);
  const geral = await buscarNoLookup(page, "Centro de custo", "cost_centers", CLASSIFICACAO_DO_SEED.centro.nome);
  await expect(geral.painel.getByRole("option", { name: new RegExp(CLASSIFICACAO_DO_SEED.centro.nome) }), "o analítico é oferecido").toHaveCount(1);
  await fecharLookup(page);

  // UM SÓ não basta: o par é a regra, na tela como no servidor.
  await pickRef(page, "Categoria financeira", CLASSIFICACAO_DO_SEED.categoria.nome);
  await expect(salvar, "só a categoria: não salva").toBeDisabled();
  await pickRef(page, "Centro de custo", CLASSIFICACAO_DO_SEED.centro.nome);
  await expect(salvar, "com o par, salva").toBeEnabled();

  const resposta = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/sales\/sales$/.test(new URL(r.url()).pathname));
  await salvar.click();
  const criada = await resposta;
  expect(criada.status()).toBe(201);
  const enviado = criada.request().postDataJSON() as Record<string, unknown>;
  const { id } = await criada.json() as { id: string };

  // O que foi gravado é o que a tela mostra — pelo id conferido na API, não só pelo texto.
  const lido = await api<Record<string, unknown>>(page, "GET", `/api/sales/sales/${id}`);
  expect([lido["categoria_financeira_id"], lido["centro_custo_id"]], "o servidor gravou o par que viajou no corpo")
    .toEqual([enviado["categoria_financeira_id"], enviado["centro_custo_id"]]);
  await expect(page).toHaveURL(new RegExp(`/vendas/sales/${id}`));
  await expect(campo(page, "Categoria financeira")).toContainText(`${CLASSIFICACAO_DO_SEED.categoria.codigo} · ${CLASSIFICACAO_DO_SEED.categoria.nome}`);
  await expect(campo(page, "Centro de custo")).toContainText(`${CLASSIFICACAO_DO_SEED.centro.codigo} · ${CLASSIFICACAO_DO_SEED.centro.nome}`);
  await expect(page.getByTestId("classificacao-padrao-automatico"), "classificada, a venda não fala de padrão automático").toHaveCount(0);
});

test("A1-W2 — orçamento e pedido exigem os campos, e a conversão leva a classificação até a venda", async ({ page }) => {
  await login(page);
  const salvar = page.getByRole("button", { name: "Salvar" });

  // O PEDIDO também exige — a conversão só copia, então pedido sem classificação viraria venda sem conserto.
  await abrirCriacao(page, "orders");
  await pickRef(page, "Cliente", "DEMO");
  await page.getByRole("button", { name: /Adicionar item/ }).click();
  await escolherPrimeiroProdutoDaLinha(page);
  await expect(salvar, "pedido sem classificação: não salva").toBeDisabled();
  await preencherClassificacaoFinanceira(page);
  await expect(salvar, "pedido com o par: salva").toBeEnabled();

  // O ORÇAMENTO, que é o começo da cadeia, exige igual — e é dele que a conversão parte.
  await abrirCriacao(page, "budgets");
  await pickRef(page, "Cliente", "DEMO");
  await page.getByRole("button", { name: /Adicionar item/ }).click();
  await escolherPrimeiroProdutoDaLinha(page);
  await expect(salvar, "orçamento sem classificação: não salva").toBeDisabled();
  await preencherClassificacaoFinanceira(page);
  await expect(salvar).toBeEnabled();
  const resposta = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/sales\/budgets$/.test(new URL(r.url()).pathname));
  await salvar.click();
  expect((await resposta).status()).toBe(201);
  const orcamento = await (await resposta).json() as { id: string };
  const lidoOrcamento = await api<Record<string, unknown>>(page, "GET", `/api/sales/budgets/${orcamento.id}`);
  expect(lidoOrcamento["categoria_financeira_codigo"], "o orçamento gravou a classificação escolhida").toBe(CLASSIFICACAO_DO_SEED.categoria.codigo);

  // A cadeia inteira pela porta de conversão: orçamento → pedido → venda. Cada destino herda o par.
  const pedido = await api<{ id: string; kind: string }>(page, "POST", `/api/sales/budgets/${orcamento.id}/convert`, {});
  expect(pedido.kind).toBe("order");
  const venda = await api<{ id: string; kind: string }>(page, "POST", `/api/sales/orders/${pedido.id}/convert`, {});
  expect(venda.kind).toBe("sale");
  const lidaVenda = await api<Record<string, unknown>>(page, "GET", `/api/sales/sales/${venda.id}`);
  expect([lidaVenda["categoria_financeira_id"], lidaVenda["centro_custo_id"]], "a venda herdou o MESMO par do orçamento")
    .toEqual([lidoOrcamento["categoria_financeira_id"], lidoOrcamento["centro_custo_id"]]);

  await page.goto(`/vendas/sales/${venda.id}`);
  await expect(page.getByTestId(WORKSPACE)).toBeVisible();
  await expect(campo(page, "Origem"), "premissa: a venda nasceu da conversão").toContainText("Convertido");
  await expect(campo(page, "Categoria financeira")).toContainText(`${CLASSIFICACAO_DO_SEED.categoria.codigo} · ${CLASSIFICACAO_DO_SEED.categoria.nome}`);
  await expect(campo(page, "Centro de custo")).toContainText(`${CLASSIFICACAO_DO_SEED.centro.codigo} · ${CLASSIFICACAO_DO_SEED.centro.nome}`);
  await expect(page.getByTestId("classificacao-padrao-automatico")).toHaveCount(0);
});

test("A1-W3 — documento sem classificação (cliente anterior, pela API): categoria 'Não informada', centro 'Não informado' e, na venda aberta, o padrão automático", async ({ page }) => {
  await login(page);
  const empresa = await empresaAtiva(page);
  const cliente = await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1");
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  // O corpo de um cliente anterior: sem os dois campos. A API aceita e o documento nasce sem classificação.
  const criada = await api<{ id: string }>(page, "POST", "/api/sales/sales", {
    empresa_id: empresa, document_date: "2026-09-01", client_id: cliente,
    items: [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }]
  });
  const lida = await api<Record<string, unknown>>(page, "GET", `/api/sales/sales/${criada.id}`);
  expect([lida["categoria_financeira_id"], lida["centro_custo_id"], lida["status"]], "premissa: venda aberta e sem classificação").toEqual([null, null, "open"]);

  await page.goto(`/vendas/sales/${criada.id}`);
  await expect(page.getByTestId(WORKSPACE)).toBeVisible();
  await expect(campo(page, "Categoria financeira")).toContainText("Não informada");
  // "Centro de custo" é masculino: "Não informado" (R1). `toContainText` não confunde as duas formas — uma não contém a outra.
  await expect(campo(page, "Centro de custo")).toContainText("Não informado");
  const frase = page.getByTestId("classificacao-padrao-automatico");
  await expect(frase, "a venda aberta avisa como a confirmação vai classificar").toBeVisible();
  await expect(frase).toContainText("padrão automático");

  // Confirmada, a frase deixa de ser verdade (o padrão já foi aplicado) e some; o campo continua dizendo a verdade.
  await api(page, "POST", `/api/sales/sales/${criada.id}/confirm`, {});
  await page.reload();
  await expect(page.getByTestId(WORKSPACE)).toBeVisible();
  await expect(page.getByTestId("central-vendas-situacao").locator("[data-status]"), "premissa: a venda foi confirmada").toHaveAttribute("data-status", "confirmed");
  await expect(campo(page, "Categoria financeira")).toContainText("Não informada");
  await expect(campo(page, "Centro de custo")).toContainText("Não informado");
  await expect(page.getByTestId("classificacao-padrao-automatico"), "venda confirmada não promete padrão futuro").toHaveCount(0);
});
