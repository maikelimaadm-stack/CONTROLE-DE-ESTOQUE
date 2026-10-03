import { test, expect, type Locator, type Page, type Request } from "@playwright/test";
import { configuracaoNeutraTopV5, type ConfiguracaoTipoOperacaoV5 } from "@agro/domain";
import { api, empresaAtiva, login, uniq } from "./helpers";
import { codigoTopE2E, excluirTopE2E } from "./top-config-08-comum";

/**
 * OPERACOES-01 F9a (decisão 286) — O LANÇAMENTO AVULSO COM A TOP FINANCEIRA E O TÍTULO PREVISTO NA CENTRAL.
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PODE PROVAR ────────────────────────────────────────────────────────────────┐
 * │ A integração (`f9a-lancamento-com-top.test.ts`, `f9a-titulo-previsto.test.ts`, `f9a-provisao-venda`) │
 * │ prova que a API aplica os padrões, recusa a troca, grava a TOP e esconde o previsto. O que ela não   │
 * │ alcança é a TELA: que a TOP é o PRIMEIRO campo e PREENCHE o tipo de título, a conta prevista e a     │
 * │ natureza e o centro da 1ª linha; que a TOP que não deixa trocar TRAVA esses campos; que o corpo leva │
 * │ `tipo_operacao_id`; e que o cartão "Previstos" filtra o previsto e o detalhe dele não oferece Baixar.│
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *   1. Nova conta a pagar: escolhe a TOP → tipo de título, conta prevista, natureza e centro preenchidos → salvar →
 *      o detalhe diz "<código> — <nome> (versão 1)" e a API grava a TOP;
 *   2. a TOP que não deixa trocar: os campos travados com o aviso, a troca da natureza volta ao padrão, e o servidor
 *      aceita o lançamento com os padrões;
 *   3. o cartão "Previstos" filtra o previsto de um pedido de venda (a provisão pela API) e o detalhe mostra o aviso do
 *      previsto, sem Baixar, Editar, Cancelar nem Duplicar.
 *
 * FIXTURES: as TOPs nascem pela API administrativa (com `padroesFinanceiros`, a porta do P3) e são excluídas no fim
 * (exclusão lógica); o previsto nasce pela provisão de verdade (o pedido de venda salvo numa TOP que provisiona) e o
 * pedido é cancelado no fim — o previsto sai cancelado, nunca apagado. O SERVIDOR é o árbitro de toda conclusão.
 */

interface Cadastro { id: string; name: string }
interface Conta { id: string; code: string; description: string }
interface SecaoE2E { provisao?: boolean; documentoTroca?: boolean; semClassificacao?: "padrao_legado" | "exigir" }
interface PadroesE2E { naturezaId?: string; centroCustoId?: string; tipoTituloId?: string; contaBancariaId?: string }
interface TopCriada { id: string; codigo: string; nome: string }

async function primeiro(page: Page, caminho: string, oQue: string): Promise<Cadastro> {
  const r = await api<{ items: Cadastro[] }>(page, "GET", caminho);
  expect(r.items?.[0], `premissa: o seed tem ${oQue}`).toBeTruthy();
  return r.items[0]!;
}
async function contaBB(page: Page): Promise<Conta> {
  const r = await api<{ items: Conta[] }>(page, "GET", "/api/financial/bank-accounts/balances");
  const bb = r.items.find((c) => c.code === "BB");
  expect(bb, "premissa: a conta BB do seed").toBeTruthy();
  return bb!;
}

/** As premissas do servidor: a Central com o financeiro pela TOP e a TOP que grava os padrões financeiros. */
async function premissasDoServidor(page: Page): Promise<void> {
  expect(await api(page, "GET", "/api/financeiro/capacidades"), "premissa: a API declara o financeiro pela TOP").toEqual({ centralFinanceira: 1, financeiroPelaTop: 1 });
  const top = await api<{ padroesFinanceiros?: number }>(page, "GET", "/api/admin/tipos-operacao/capabilities");
  expect(top.padroesFinanceiros, "premissa: a TOP grava os padrões financeiros da versão").toBe(1);
}

/** Uma TOP no FORMATO 5 pela API administrativa: a seção `financeiroPadrao` ajustada e os padrões na chave própria. */
async function criarTop(page: Page, codigoBase: string, o: { secao?: SecaoE2E; padroes?: PadroesE2E; extra?: Record<string, unknown> }): Promise<TopCriada> {
  const configuracao: ConfiguracaoTipoOperacaoV5 = configuracaoNeutraTopV5();
  configuracao.financeiroPadrao = { ...configuracao.financeiroPadrao, ...o.secao };
  const codigo = codigoTopE2E(); const nome = uniq(`F9a ${codigoBase}`);
  const r = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", {
    codigo, codigoBase, nome, configuracao, ...(o.padroes ? { padroesFinanceiros: o.padroes } : {}), ...o.extra
  });
  expect(r.id, `premissa: a TOP ${codigoBase} nasce no formato 5`).toBeTruthy();
  return { id: r.id, codigo, nome };
}

/** O campo de referência (RefSelect) de um rótulo, dentro de um escopo. */
const caixaDoCampo = (escopo: Locator, rotulo: string) => escopo.locator("label", { hasText: rotulo }).first().locator("..").getByRole("combobox");
/** A 1ª linha do rateio em R$ da Central: [natureza, centro]. */
const primeiraLinhaDoRateio = (page: Page) => page.getByTestId("fin-rateio").locator("tbody tr").first();
const ehPostDe = (caminho: string) => (r: Request) => r.method() === "POST" && new URL(r.url()).pathname === caminho;
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Escolhe a opção num seletor de referência (o `combobox` da caixa) pela busca do painel — nomes do seed têm "[DEMO]". */
async function escolher(page: Page, gatilho: Locator, busca: string) {
  await gatilho.click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(busca);
  await painel.getByRole("option", { name: new RegExp(escapar(busca.slice(0, 20)), "i") }).first().click();
}

/** Preenche o que a TOP não preenche (documento, parceiro, valor, observação) — o gesto do usuário. */
async function preencherOResto(page: Page, numero: string, parceiro: string, rotuloParceiro: string, valor: string) {
  await page.getByLabel(/^Nº do documento/).fill(numero);
  await escolher(page, caixaDoCampo(page.getByTestId("fin-lancamento"), rotuloParceiro), parceiro);
  await page.getByLabel(/^Valor\b/).first().fill(valor);
  await page.getByLabel(/^Observação/).fill(`F9a ${numero}`);
}

test("F9a · 1 — conta a pagar: a TOP primeiro preenche tipo de título, conta prevista, natureza e centro; salva com a TOP, e o detalhe diz código, nome e versão", async ({ page }) => {
  await login(page);
  await premissasDoServidor(page);
  const natureza = await primeiro(page, "/api/resources/financial_categories?kind=analytic&nature=expense&pageSize=1", "uma natureza de despesa analítica");
  const centro = await primeiro(page, "/api/resources/cost_centers?kind=analytic&pageSize=1", "um centro de resultado analítico");
  const tipo = await primeiro(page, "/api/resources/title_types?pageSize=1", "um tipo de título");
  const fornecedor = await primeiro(page, "/api/resources/people?is_provider=true&pageSize=1", "um fornecedor");
  const conta = await contaBB(page);
  const top = await criarTop(page, "financeiro.conta_a_pagar", { padroes: { naturezaId: natureza.id, centroCustoId: centro.id, tipoTituloId: tipo.id, contaBancariaId: conta.id } });
  try {
    // PREMISSA (API): a TOP está na lista do lançamento a pagar, com os quatro padrões e a troca liberada.
    const lista = await api<{ itens: { id: string; versao: number; secao: { documentoTroca: boolean }; padroes: Record<string, { id: string } | null> }[] }>(page, "GET", "/api/financeiro/tops?direcao=pagar");
    const naLista = lista.itens.find((t) => t.id === top.id);
    expect(naLista, "premissa: a TOP aparece no lançamento a pagar").toBeTruthy();
    expect([naLista!.versao, naLista!.secao.documentoTroca], "premissa: versão 1, o documento troca (o neutro)").toEqual([1, true]);
    expect([naLista!.padroes["natureza"]?.id, naLista!.padroes["centro"]?.id, naLista!.padroes["tipoTitulo"]?.id, naLista!.padroes["conta"]?.id]).toEqual([natureza.id, centro.id, tipo.id, conta.id]);

    await page.goto("/financeiro/contas-a-pagar/new");
    const forma = page.getByTestId("fin-lancamento");
    await expect(forma).toBeVisible();
    const seletor = forma.getByTestId("fin-lancamento-top");
    await expect(seletor, "a TOP é o primeiro campo, e nada vem escolhido (o lançamento de hoje)").toHaveValue("");
    await expect(caixaDoCampo(forma, "Tipo de título"), "premissa: antes da TOP, o tipo de título está vazio").not.toContainText(tipo.name);

    await seletor.selectOption(top.id);
    await expect(caixaDoCampo(forma, "Tipo de título"), "a TOP preenche o tipo de título").toContainText(tipo.name);
    await expect(caixaDoCampo(forma, "Conta prevista"), "a TOP preenche a conta prevista").toContainText(conta.description);
    const linha = primeiraLinhaDoRateio(page);
    await expect(linha.getByRole("combobox").nth(0), "a TOP preenche a natureza da 1ª linha").toContainText(natureza.name);
    await expect(linha.getByRole("combobox").nth(1), "e o centro de resultado").toContainText(centro.name);
    await expect(forma.getByTestId("fin-padroes-travados"), "a troca está liberada: nada travado").toHaveCount(0);
    await expect(caixaDoCampo(forma, "Tipo de título")).toBeEnabled();

    const numero = `F9A1-${Date.now().toString(36)}`.toUpperCase();
    await preencherOResto(page, numero, fornecedor.name, "Fornecedor", "321.45");
    await expect(page.getByTestId("fin-rateio-diferenca")).toHaveText("Rateio fechado");
    const post = page.waitForRequest(ehPostDe("/api/financial/payables"));
    const resposta = page.waitForResponse((r) => ehPostDe("/api/financial/payables")(r.request()));
    await forma.getByRole("button", { name: "Salvar" }).click();
    const corpo = (await post).postDataJSON() as Record<string, unknown> & { apportionment: { financial_category_id: string; cost_center_id: string }[] };
    expect((await resposta).status(), "o servidor aceita o lançamento com a TOP").toBe(201);
    expect(corpo["tipo_operacao_id"], "o corpo leva a TOP escolhida").toBe(top.id);
    expect([corpo["title_type_id"], corpo["conta_prevista_id"]], "e os padrões aplicados").toEqual([tipo.id, conta.id]);
    expect(corpo.apportionment.map((a) => [a.financial_category_id, a.cost_center_id])).toEqual([[natureza.id, centro.id]]);

    await expect(page).toHaveURL(/\/financeiro\/contas-a-pagar\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop()!;
    const campoTop = page.locator('[data-testid="base2-field"][data-campo="Tipo de operação"]');
    await expect(campoTop, "o detalhe diz a TOP de origem com a versão").toContainText(`${top.codigo} — ${top.nome} (versão 1)`);
    const titulo = await api<{ tipo_operacao_id: string | null; tipo_operacao: { id: string; versao: number } | null; title_type_id: string; conta_prevista_id: string }>(page, "GET", `/api/financial/payables/${id}`);
    expect([titulo.tipo_operacao_id, titulo.tipo_operacao?.versao, titulo.title_type_id, titulo.conta_prevista_id], "conclusão no servidor: a TOP, a versão e os padrões gravados").toEqual([top.id, 1, tipo.id, conta.id]);
  } finally {
    await excluirTopE2E(page, top.id);
  }
});

test("F9a · 2 — a TOP que não deixa trocar: tipo de título, conta, natureza e centro do rateio travados com o aviso; safra e área livres; o servidor aceita", async ({ page }) => {
  await login(page);
  await premissasDoServidor(page);
  const natureza = await primeiro(page, "/api/resources/financial_categories?kind=analytic&nature=income&pageSize=1", "uma natureza de receita analítica");
  const centro = await primeiro(page, "/api/resources/cost_centers?kind=analytic&pageSize=1", "um centro de resultado analítico");
  const tipo = await primeiro(page, "/api/resources/title_types?pageSize=1", "um tipo de título");
  const cliente = await primeiro(page, "/api/resources/people?is_client=true&pageSize=1", "um cliente");
  const conta = await contaBB(page);
  const top = await criarTop(page, "financeiro.conta_a_receber", { secao: { documentoTroca: false }, padroes: { naturezaId: natureza.id, centroCustoId: centro.id, tipoTituloId: tipo.id, contaBancariaId: conta.id } });
  try {
    const lista = await api<{ itens: { id: string; secao: { documentoTroca: boolean } }[] }>(page, "GET", "/api/financeiro/tops?direcao=receber");
    expect(lista.itens.find((t) => t.id === top.id)?.secao.documentoTroca, "premissa: a TOP não deixa o documento trocar os padrões").toBe(false);

    await page.goto("/financeiro/contas-a-receber/new");
    const forma = page.getByTestId("fin-lancamento");
    await expect(forma).toBeVisible();
    await expect(caixaDoCampo(forma, "Tipo de título"), "premissa: sem TOP, nada travado").toBeEnabled();
    await forma.getByTestId("fin-lancamento-top").selectOption(top.id);

    await expect(forma.getByTestId("fin-padroes-travados")).toHaveText("Esta operação não deixa trocar os padrões.");
    await expect(caixaDoCampo(forma, "Tipo de título"), "o tipo de título da TOP, travado").toBeDisabled();
    await expect(caixaDoCampo(forma, "Tipo de título")).toContainText(tipo.name);
    await expect(caixaDoCampo(forma, "Conta prevista"), "a conta prevista da TOP, travada").toBeDisabled();
    await expect(caixaDoCampo(forma, "Conta prevista")).toContainText(conta.description);
    await expect(forma.getByTestId("fin-rateio-travado")).toHaveText("A operação fixa a natureza e o centro de resultado de todas as linhas do rateio.");
    const linha = primeiraLinhaDoRateio(page).getByRole("combobox");
    // Natureza e centro do padrão, TRAVADOS na linha (o servidor recusaria a troca); safra e área continuam livres.
    await expect(linha.nth(0)).toContainText(natureza.name);
    await expect(linha.nth(0), "a natureza da TOP, travada no rateio").toBeDisabled();
    await expect(linha.nth(1)).toContainText(centro.name);
    await expect(linha.nth(1), "o centro da TOP, travado no rateio").toBeDisabled();
    await expect(linha.nth(2), "a safra continua livre").toBeEnabled();
    await expect(linha.nth(3), "a área continua livre").toBeEnabled();

    const numero = `F9A2-${Date.now().toString(36)}`.toUpperCase();
    await preencherOResto(page, numero, cliente.name, "Cliente", "150.00");
    const post = page.waitForRequest(ehPostDe("/api/financial/receivables"));
    const resposta = page.waitForResponse((x) => ehPostDe("/api/financial/receivables")(x.request()));
    await forma.getByRole("button", { name: "Salvar" }).click();
    const corpo = (await post).postDataJSON() as Record<string, unknown> & { apportionment: { financial_category_id: string }[] };
    expect((await resposta).status(), "com os padrões, o servidor aceita a TOP que não deixa trocar").toBe(201);
    expect([corpo["tipo_operacao_id"], corpo["title_type_id"], corpo["conta_prevista_id"], corpo.apportionment[0]!.financial_category_id]).toEqual([top.id, tipo.id, conta.id, natureza.id]);
    await expect(page).toHaveURL(/\/financeiro\/contas-a-receber\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop()!;
    const titulo = await api<{ tipo_operacao_id: string | null; apportionments: { financial_category_id: string }[] }>(page, "GET", `/api/financial/receivables/${id}`);
    expect([titulo.tipo_operacao_id, titulo.apportionments.map((a) => a.financial_category_id)], "conclusão no servidor: a TOP e a natureza do padrão").toEqual([top.id, [natureza.id]]);
  } finally {
    await excluirTopE2E(page, top.id);
  }
});

test("F9a · 3 — o cartão Previstos filtra o previsto do pedido de venda; o detalhe do previsto mostra o aviso e não oferece Baixar, Editar, Cancelar nem Duplicar", async ({ page }) => {
  await login(page);
  await premissasDoServidor(page);
  const empresa = await empresaAtiva(page);
  const produto = await primeiro(page, "/api/resources/products?pageSize=1", "um produto");
  const cliente = await api<{ id: string; name: string }>(page, "POST", "/api/resources/people", { name: uniq("F9a Cliente previsto"), person_type: "legal", is_client: true });
  const topPedido = await criarTop(page, "vendas.pedido", { secao: { provisao: true } });
  let pedidoId: string | null = null;
  try {
    const pedido = await api<{ id: string }>(page, "POST", "/api/sales/orders", {
      empresa_id: empresa, document_date: new Date().toISOString().slice(0, 10), client_id: cliente.id, tipo_operacao_id: topPedido.id,
      items: [{ product_id: produto.id, warehouse_id: null, quantity: "1", unit_price: "432.10" }]
    });
    pedidoId = pedido.id;
    const doc = await api<{ code: string }>(page, "GET", `/api/sales/orders/${pedido.id}`);

    // PREMISSA (API): o pedido salvo provisionou UM previsto de 432,10 — fora da lista padrão, só na situação "Previsto".
    type Pagina = { items: { id: string; situacao: string; liquido: string; status: string }[]; total: number; cartoes: Record<string, { quantidade: number; valor: string; disponivel?: boolean }> };
    const busca = encodeURIComponent(cliente.name);
    const previstos = await api<Pagina>(page, "GET", `/api/financeiro/titulos?direcao=receivable&situacao=previsto&busca=${busca}`);
    expect(previstos.items.map((i) => [i.situacao, i.liquido]), "premissa: a provisão criou o previsto do pedido").toEqual([["previsto", "432.10"]]);
    const padrao = await api<Pagina>(page, "GET", `/api/financeiro/titulos?direcao=receivable&busca=${busca}`);
    expect(padrao.total, "premissa: a lista padrão não mostra o previsto").toBe(0);
    expect(padrao.cartoes["previstos"], "premissa: o cartão conta o previsto do recorte").toEqual({ quantidade: 1, valor: "432.10", disponivel: true });
    const previstoId = previstos.items[0]!.id;

    await page.goto("/financeiro?tab=titulos&sub=receber");
    const central = page.getByTestId("fin-titulos");
    await expect(central).toBeVisible();
    await central.getByLabel("Busca").fill(cliente.name);
    await central.getByRole("button", { name: "Filtrar" }).click();
    await expect(central.getByText("Nenhum título neste filtro"), "sem o cartão, a lista padrão não traz o previsto").toBeVisible();
    const cartao = page.getByTestId("fin-cartao-previstos");
    await expect(cartao, "o cartão Previstos está ligado").toBeEnabled();
    await expect(cartao).not.toHaveAttribute("title", /.+/);
    await expect(cartao.getByTestId("fin-cartao-quantidade")).toHaveText("1");
    await cartao.click();
    await expect(cartao).toHaveAttribute("aria-pressed", "true");
    const linha = central.locator("tbody tr").filter({ hasText: `PED-${doc.code}` });
    await expect(linha, "o cartão filtra o previsto do pedido").toHaveCount(1);
    await expect(linha.locator("[data-status]")).toHaveText("Previsto");

    // O previsto selecionado não se baixa em lote: o botão desabilita e diz por quê.
    await linha.getByLabel("Selecionar linha").click();
    await expect(page.getByTestId("fin-lote-baixar")).toBeDisabled();
    await expect(page.getByTestId("fin-lote-baixar")).toHaveAttribute("title", "Título previsto não recebe baixa");

    await page.goto(`/financeiro/contas-a-receber/${previstoId}`);
    await expect(page.getByTestId("base2-shell")).toBeVisible();
    await expect(page.getByTestId("fin-aviso-previsto")).toContainText("Título previsto: ele dá lugar ao título de verdade quando o documento é faturado");
    for (const acao of ["Baixar", "Editar", "Cancelar", "Duplicar"]) await expect(page.getByRole("button", { name: acao, exact: true }), `o previsto não oferece ${acao}`).toHaveCount(0);
    await expect(page.locator('[data-testid="base2-field"][data-campo="Origem"]'), "a origem pelo nome, nunca o valor cru").toContainText(`Pedido de venda ${doc.code}`);
    await expect(page.locator('[data-testid="base2-field"][data-campo="Tipo de operação"]')).toContainText(`${topPedido.codigo} — ${topPedido.nome} (versão 1)`);
  } finally {
    // O pedido cancelado cancela o previsto (com trilha; nada apagado) — o banco compartilhado não guarda promessa viva.
    if (pedidoId) await api(page, "POST", `/api/sales/orders/${pedidoId}/cancel`, { reason: "Limpeza do E2E da F9a" }).catch((e: unknown) => console.warn(`[f9a] cancelar o pedido ${pedidoId} falhou: ${String(e)}`));
    await excluirTopE2E(page, topPedido.id);
  }
});
