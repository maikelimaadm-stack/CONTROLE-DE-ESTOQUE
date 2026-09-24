import { test, expect, type Page, type Response } from "@playwright/test";
import { login, api, uniq, empresaAtiva, primeiroId, abrirLancamentoDeVendas, escolherTopEContinuar, CLASSIFICACAO_DO_SEED } from "./helpers";

/**
 * VENDAS-A5-1 — A CONFIRMAÇÃO HONESTA, PELA TELA.
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PROVA ──────────────────────────────────────────────────────────────────┐
 * │ Que a prévia e a confirmação saem da MESMA função do servidor é prova da integração (A5-C*, P1). │
 * │ Aqui se mede o que a TELA faz com ela: o diálogo "Confirmar venda" pergunta ao ABRIR (no fio),   │
 * │ segura o botão enquanto a resposta não chega, escreve o efeito que o servidor previu — e não o   │
 * │ que a tela imagina —, desabilita o botão diante de uma recusa prevista e, sem a prévia (API      │
 * │ anterior, 404), cai num texto NEUTRO com o botão habilitado, porque quem recusa é o servidor.    │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ A REGRA ANTI-VACUIDADE ───────────────────────────────────────────────────────────────────────┐
 * │ Toda frase conferida na tela é conferida também contra o CORPO que o servidor devolveu à própria  │
 * │ tela (capturado no fio) ou contra o cadastro lido pela API — nunca contra uma constante que o     │
 * │ teste inventou. E toda ausência ("o botão está desabilitado", "o texto antigo sumiu") vem com a   │
 * │ PREMISSA ao lado: o mesmo cenário, corrigido, habilita o botão; a mesma tela mostra o texto novo. │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

const WORKSPACE = "central-vendas";
const caminhoDaPrevia = (id: string) => `/api/sales/sales/${id}/previa-confirmacao`;
/** A resposta da prévia DESTA venda, como o navegador a recebeu. */
const ehPrevia = (id: string) => (r: Response) => r.request().method() === "GET" && new URL(r.url()).pathname === caminhoDaPrevia(id);

/** O texto NEUTRO, escrito aqui por extenso de propósito: é o contrato com o usuário, e mudá-lo tem de ser decisão visível. */
const TEXTO_NEUTRO = "A confirmação aplica o Tipo de Operação desta venda. Não foi possível carregar a prévia dos efeitos; o servidor recusa o que não puder executar.";
/** O aviso da A1 quando a tela NÃO tem a prévia — a regra decidida pelo id, que continua valendo contra a API anterior. */
const AVISO_SEM_PREVIA = "Sem classificação: ao confirmar, a venda usará o padrão automático (primeira categoria de receita e primeiro centro de custo analíticos, pela ordem do código).";

type ItemDaClassificacao = { id: string; codigo: string; nome: string };
type Previa = {
  contractVersion: number; podeConfirmar: boolean;
  recusas: { code: string; message: string; details?: unknown }[];
  estoque: { efeito: "baixa" | "nenhum" | null; itensQueBaixam: number; itensSemArmazem: number };
  financeiro: { efeito: "receber" | "nenhum" | null; valor: string | null; primeiroVencimento: string | null;
    classificacao: { origem: "documento" | "padrão legado"; categoria: ItemDaClassificacao; centro: ItemDaClassificacao } | null };
};
type Venda = Record<string, unknown> & { id: string; status: string; code: string; total: string; titles: { id: string; amount: string }[] };

/** Uma TOP própria por caso (prefixo 4: 5 é da Central, 6 da A1, 7 e 8 do portal, 9 do editor). */
async function cadastrarTop(page: Page, codigoBase: "vendas.venda" | "vendas.orcamento" | "vendas.pedido") {
  const codigo = `4${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return (await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase, nome: uniq("Prévia A5") })).id;
}

/** O par do seed, pelos IDS que a API tem — a venda classificada é gravada com eles. */
async function parDoSeed(page: Page) {
  const categoria = await primeiroId(page, `/api/resources/financial_categories?code=${CLASSIFICACAO_DO_SEED.categoria.codigo}&kind=analytic&nature=income&pageSize=1`);
  const centro = await primeiroId(page, `/api/resources/cost_centers?code=${CLASSIFICACAO_DO_SEED.centro.codigo}&kind=analytic&pageSize=1`);
  return { categoria, centro };
}

/** Empresa e cliente do seed, pela MESMA regra do app (`empresaAtiva`). */
async function insumos(page: Page) {
  return { empresa: await empresaAtiva(page), cliente: await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1") };
}

/** Uma venda pela API, com o corpo que a tela manda. Sem `tipo_operacao_id`: a política é a legada. */
async function criarVenda(page: Page, corpo: Record<string, unknown>) {
  const criada = await api<{ id: string }>(page, "POST", "/api/sales/sales", { document_date: "2026-09-01", ...corpo });
  return criada.id;
}

const lerVenda = (page: Page, id: string) => api<Venda>(page, "GET", `/api/sales/sales/${id}`);

/** Status e corpo de uma chamada que PODE ser recusada — o `api()` dos helpers lança em qualquer não-2xx. */
async function tentar(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; corpo: Record<string, unknown> }> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
  return page.evaluate(async ({ method, path, body, base }) => {
    const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string | null };
    const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await res.text();
    return { status: res.status, corpo: (t ? JSON.parse(t) : {}) as Record<string, unknown> };
  }, { method, path, body, base });
}

/** Abre o detalhe da venda e espera a tela desenhar ESTE documento (o número vem do servidor). */
async function abrirDetalhe(page: Page, id: string) {
  const lida = await lerVenda(page, id);
  await page.goto(`/vendas/sales/${id}`);
  const ws = page.getByTestId(WORKSPACE);
  await expect(ws).toBeVisible();
  await expect(ws.locator('[data-campo="Número"]'), "premissa: a tela desenhou ESTE documento").toContainText(lida.code);
  return ws;
}

const botaoConfirmarVenda = (page: Page) => page.getByTestId(WORKSPACE).getByTestId("central-vendas-acoes").getByRole("button", { name: "Confirmar venda" });
const dialogo = (page: Page) => page.getByTestId("confirm-dialog");
const botaoDoDialogo = (page: Page) => dialogo(page).getByTestId("confirm-dialog-confirm");
async function fecharDialogo(page: Page) {
  await dialogo(page).getByRole("button", { name: "Fechar", exact: true }).filter({ hasText: /^Fechar$/ }).click();
  await expect(dialogo(page)).toHaveCount(0);
}
/** "2026-09-01" → "01/09/2026": a data que o servidor devolveu, na forma em que a tela a escreve. */
const dataBR = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const rotulo = (x: ItemDaClassificacao) => `${x.codigo} · ${x.nome}`;

/** Garante saldo do produto no armazém: estoque inicial (uma vez por banco) e a premissa lida do saldo. */
async function garantirSaldo(page: Page, empresa: string, warehouse: string, produto: string) {
  const r = await tentar(page, "POST", "/api/stock/opening-balances", { empresa_id: empresa, warehouse_id: warehouse, product_id: produto, quantity: "1000", unit_value: "10" });
  // 201 na primeira execução contra o banco; nas seguintes o estoque inicial já existe e a API recusa o duplicado.
  expect([201, 409, 422], `estoque inicial: ${JSON.stringify(r.corpo)}`).toContain(r.status);
  if (r.status !== 201) expect((r.corpo["error"] as { code?: string } | undefined)?.code, "a única recusa aceita é a do duplicado").toBe("DUPLICATE_DOCUMENT");
  return saldo(page, warehouse, produto);
}
const saldo = async (page: Page, warehouse: string, produto: string) =>
  Number((await api<{ totals: { quantity: string } }>(page, "GET", `/api/stock/balances?warehouse_id=${warehouse}&product_id=${produto}`)).totals.quantity);

test.describe.configure({ mode: "serial" });

test("A5-W1 — venda classificada: a prévia é pedida AO ABRIR, o botão espera por ela, e o diálogo diz estoque e contas a receber com código · nome", async ({ page }) => {
  await login(page);
  const { empresa, cliente } = await insumos(page);
  const par = await parDoSeed(page);
  const warehouse = await primeiroId(page, `/api/resources/warehouses?empresa_id=${empresa}&initials=ALM&pageSize=1`);
  const produto = await primeiroId(page, `/api/resources/products?search=${encodeURIComponent("Ração Confinamento")}&pageSize=1`);
  expect(await garantirSaldo(page, empresa, warehouse, produto), "premissa: há saldo para a baixa que a prévia vai prometer").toBeGreaterThanOrEqual(1);

  // DOIS itens: um com armazém (baixa) e um sem (fica de fora) — a frase tem de dizer os dois números.
  const id = await criarVenda(page, {
    empresa_id: empresa, client_id: cliente, categoria_financeira_id: par.categoria, centro_custo_id: par.centro,
    items: [{ product_id: produto, warehouse_id: warehouse, quantity: "1", unit_price: "50.00" }, { product_id: produto, warehouse_id: null, quantity: "1", unit_price: "50.00" }]
  });

  // Quem pergunta à prévia, e quando. O aviso não pergunta por venda CLASSIFICADA; então, antes do clique, zero.
  const pedidas: string[] = [];
  page.on("request", (r) => { if (r.method() === "GET" && new URL(r.url()).pathname === caminhoDaPrevia(id)) pedidas.push(r.url()); });
  const ws = await abrirDetalhe(page, id);
  await expect(ws.getByTestId("classificacao-padrao-automatico"), "premissa: classificada, sem aviso de padrão").toHaveCount(0);
  expect(pedidas, "nada de prévia antes de abrir o diálogo: nenhuma resposta antiga decide o botão").toEqual([]);

  // A prévia é SEGURADA no fio até o teste soltar: enquanto ela não chega, o botão não pode confirmar.
  let soltar!: () => void;
  const segura = new Promise<void>((r) => { soltar = r; });
  await page.route(`**${caminhoDaPrevia(id)}`, async (route) => { await segura; await route.continue(); });
  const resposta = page.waitForResponse(ehPrevia(id));
  await botaoConfirmarVenda(page).click();
  await expect(dialogo(page).getByRole("heading", { name: "Confirmar venda" })).toBeVisible();
  await expect(dialogo(page).getByTestId("previa-confirmacao-carregando"), "carregando: a tela ainda não sabe o efeito").toBeVisible();
  await expect(botaoDoDialogo(page), "e por isso o botão fica desabilitado").toBeDisabled();
  expect(pedidas, "a pergunta saiu no CLIQUE que abriu o diálogo — uma, e só uma").toHaveLength(1);
  soltar();
  const r = await resposta;
  expect(r.status(), "a API deste HEAD serve a prévia").toBe(200);
  const previa = await r.json() as Previa;
  await page.unroute(`**${caminhoDaPrevia(id)}`);

  // O CORPO — é dele que a tela tira as frases. Conferido primeiro, para as frases abaixo não serem vácuo.
  expect(previa.contractVersion).toBe(1);
  expect([previa.podeConfirmar, previa.recusas], "premissa: nada impede esta venda").toEqual([true, []]);
  expect(previa.estoque, "um item com armazém baixa, um sem armazém fica de fora").toEqual({ efeito: "baixa", itensQueBaixam: 1, itensSemArmazem: 1 });
  expect(previa.financeiro.efeito).toBe("receber");
  expect(previa.financeiro.classificacao?.origem, "a classificação DO DOCUMENTO, não o recuo").toBe("documento");
  expect([previa.financeiro.classificacao?.categoria.id, previa.financeiro.classificacao?.centro.id], "o par gravado na venda").toEqual([par.categoria, par.centro]);
  expect([previa.financeiro.classificacao?.categoria.codigo, previa.financeiro.classificacao?.categoria.nome]).toEqual([CLASSIFICACAO_DO_SEED.categoria.codigo, CLASSIFICACAO_DO_SEED.categoria.nome]);
  expect([previa.financeiro.classificacao?.centro.codigo, previa.financeiro.classificacao?.centro.nome]).toEqual([CLASSIFICACAO_DO_SEED.centro.codigo, CLASSIFICACAO_DO_SEED.centro.nome]);
  const venda = await lerVenda(page, id);
  expect(previa.financeiro.valor, "o valor previsto é o total do documento").toBe(venda.total);
  // Sem parcelamento e sem vencimento, o título vence na data do documento (a mesma conta de `createTitles`).
  expect(previa.financeiro.primeiroVencimento, "premissa: sem plano, o vencimento é a data do documento").toBe("2026-09-01");

  // A TELA — as duas linhas, com "código · nome" dos dois cadastros.
  await expect(dialogo(page).getByTestId("previa-confirmacao")).toBeVisible();
  await expect(dialogo(page).getByTestId("previa-confirmacao-estoque")).toHaveText("Baixa o estoque de 1 item. 1 item sem armazém fica de fora.");
  const financeiro = dialogo(page).getByTestId("previa-confirmacao-financeiro");
  await expect(financeiro).toContainText(/^Gera contas a receber de R\$\s*100,00/);
  await expect(financeiro).toContainText(`primeiro vencimento ${dataBR(previa.financeiro.primeiroVencimento!)}`);
  await expect(financeiro).toContainText(`categoria ${rotulo(previa.financeiro.classificacao!.categoria)} · centro ${rotulo(previa.financeiro.classificacao!.centro)}.`);
  await expect(financeiro, "origem documento: nada de padrão automático").not.toContainText("padrão automático");
  // A promessa antiga saiu do diálogo — inclusive o detalhe técnico que não é do usuário.
  await expect(dialogo(page), "a frase fixa de antes não volta").not.toContainText("Baixa o estoque dos itens com armazém e gera as contas a receber");
  await expect(dialogo(page)).not.toContainText("atômica e idempotente");
  // W12 continua valendo com o diálogo aberto: nenhuma peça da área de execução da TOP na tela de venda.
  await expect(page.locator('[data-testid^="top-execucao"]')).toHaveCount(0);
  await expect(page.getByText("Usar configuração da TOP")).toHaveCount(0);

  // CONFIRMA — e a execução é a que foi prevista: 1 unidade baixada (o item com armazém) e título gerado.
  await expect(botaoDoDialogo(page), "com a prévia pronta e sem recusa, o botão habilita").toBeEnabled();
  const antes = await saldo(page, warehouse, produto);
  const confirmacao = page.waitForResponse((x) => x.request().method() === "POST" && new URL(x.url()).pathname === `/api/sales/sales/${id}/confirm`);
  await botaoDoDialogo(page).click();
  expect((await confirmacao).status(), "o servidor confirmou").toBe(200);
  await expect(page.getByTestId("central-vendas-situacao").locator("[data-status]")).toHaveAttribute("data-status", "confirmed");
  const confirmada = await lerVenda(page, id);
  expect(confirmada.status).toBe("confirmed");
  expect(antes - await saldo(page, warehouse, produto), "baixou exatamente os itens com armazém previstos (1 × 1)").toBe(previa.estoque.itensQueBaixam);
  expect(confirmada.titles.length, "previu contas a receber, e elas existem").toBeGreaterThan(0);
  expect(confirmada.titles.reduce((s, t) => s + Number(t.amount), 0), "no valor previsto").toBe(Number(previa.financeiro.valor));
});

test("A5-W2 — venda sem classificação: o diálogo e o aviso do detalhe nomeiam o par do padrão automático — o primeiro por código, e o mesmo que a confirmação usa", async ({ page }) => {
  await login(page);
  const { empresa, cliente } = await insumos(page);
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  // O corpo de um cliente anterior à A1: sem o par. Sem armazém: o que interessa aqui é o título.
  const id = await criarVenda(page, { empresa_id: empresa, client_id: cliente, items: [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }] });
  const venda = await lerVenda(page, id);
  expect([venda["categoria_financeira_id"], venda["centro_custo_id"], venda.status], "premissa: aberta e sem classificação").toEqual([null, null, "open"]);

  // O PAR ESPERADO, lido da própria prévia...
  const previa = await api<Previa>(page, "GET", caminhoDaPrevia(id));
  expect([previa.podeConfirmar, previa.financeiro.efeito, previa.financeiro.classificacao?.origem], "premissa: vai gerar título pelo recuo").toEqual([true, "receber", "padrão legado"]);
  const c = previa.financeiro.classificacao!;
  // ...E conferido contra o cadastro: a primeira analítica de receita e o primeiro centro analítico, pelo código.
  // A listagem é a porta de leitura do cadastro, ordenada pelo servidor — a mesma pergunta que o recuo faz.
  const primeiraCategoria = (await api<{ items: { id: string; code: string; name: string }[] }>(page, "GET", "/api/resources/financial_categories?kind=analytic&nature=income&sort=code&dir=asc&pageSize=1")).items[0];
  const primeiroCentro = (await api<{ items: { id: string; code: string; name: string }[] }>(page, "GET", "/api/resources/cost_centers?kind=analytic&sort=code&dir=asc&pageSize=1")).items[0];
  expect([c.categoria.id, c.categoria.codigo, c.categoria.nome], "a categoria do recuo é a primeira por código").toEqual([primeiraCategoria?.id, primeiraCategoria?.code, primeiraCategoria?.name]);
  expect([c.centro.id, c.centro.codigo, c.centro.nome], "o centro do recuo é o primeiro por código").toEqual([primeiroCentro?.id, primeiroCentro?.code, primeiroCentro?.name]);

  // O AVISO DO DETALHE nomeia o par — com a prévia, e não mais a regra genérica da A1.
  const avisoPedido = page.waitForResponse(ehPrevia(id));
  const ws = await abrirDetalhe(page, id);
  expect((await avisoPedido).status(), "o aviso pergunta à prévia (venda aberta sem classificação)").toBe(200);
  await expect(ws.getByTestId("classificacao-padrao-automatico"))
    .toHaveText(`Sem classificação: ao confirmar, a venda usará o padrão automático — categoria ${rotulo(c.categoria)} · centro ${rotulo(c.centro)}.`);

  // O DIÁLOGO pergunta de novo ao abrir e diz a mesma coisa, marcando que é o padrão automático.
  const doDialogo = page.waitForResponse(ehPrevia(id));
  await botaoConfirmarVenda(page).click();
  const corpoDoDialogo = await (await doDialogo).json() as Previa;
  expect(corpoDoDialogo.financeiro.classificacao, "a pergunta do diálogo devolveu o MESMO par").toEqual(c);
  await expect(dialogo(page).getByTestId("previa-confirmacao-financeiro"))
    .toContainText(`categoria ${rotulo(c.categoria)} · centro ${rotulo(c.centro)} (padrão automático).`);
  await expect(botaoDoDialogo(page)).toBeEnabled();

  // E A CONFIRMAÇÃO USA ESSE PAR: a trilha da confirmação registra o rateio com a categoria e o centro previstos.
  const confirmacao = page.waitForResponse((x) => x.request().method() === "POST" && new URL(x.url()).pathname === `/api/sales/sales/${id}/confirm`);
  await botaoDoDialogo(page).click();
  expect((await confirmacao).status()).toBe(200);
  const trilha = await api<{ items: { action: string; metadata: { classificacaoFinanceira?: { origem: string; categoriaFinanceiraId: string; centroCustoId: string } } | null }[] }>(page, "GET", `/api/admin/audit?entity=sales_documents&entity_id=${id}`);
  const confirm = trilha.items.filter((i) => i.action === "confirm");
  expect(confirm, "uma confirmação na trilha").toHaveLength(1);
  expect(confirm[0]!.metadata?.classificacaoFinanceira, "o título usou exatamente o par que a tela anunciou")
    .toEqual({ origem: "padrão legado", categoriaFinanceiraId: c.categoria.id, centroCustoId: c.centro.id });
  await expect(page.getByTestId("central-vendas-situacao").locator("[data-status]")).toHaveAttribute("data-status", "confirmed");
  await expect(ws.getByTestId("classificacao-padrao-automatico"), "confirmada, o aviso de algo futuro some").toHaveCount(0);
});

test("A5-W3 — categoria inativada depois de salvar: o diálogo mostra a recusa do servidor e o botão fica desabilitado; reativada, habilita", async ({ page }) => {
  await login(page);
  const { empresa, cliente } = await insumos(page);
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const { centro } = await parDoSeed(page);
  // UMA CATEGORIA SÓ DESTE CASO, pela API de cadastro: inativar a do seed quebraria os specs vizinhos que a
  // escolhem, e um código filho de "1.03" nunca vira a "primeira por código" do recuo (A5-W2).
  const pai = await primeiroId(page, "/api/resources/financial_categories?code=1.03&kind=synthetic&pageSize=1");
  const { codigo } = await api<{ codigo: string }>(page, "GET", `/api/resources/financial_categories/proximo-codigo?parent_id=${pai}`);
  const categoria = (await api<{ id: string }>(page, "POST", "/api/resources/financial_categories", { code: codigo, name: uniq("Receita A5-W3"), nature: "income", kind: "analytic", parent_id: pai })).id;
  const id = await criarVenda(page, { empresa_id: empresa, client_id: cliente, categoria_financeira_id: categoria, centro_custo_id: centro,
    items: [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }] });

  // DEPOIS de salvar, o cadastro muda: a categoria é inativada pela porta de cadastro.
  await api(page, "PUT", `/api/resources/financial_categories/${categoria}`, { is_active: false });
  const previa = await api<Previa>(page, "GET", caminhoDaPrevia(id));
  expect(previa.podeConfirmar, "a prévia prevê a recusa").toBe(false);
  const recusa = previa.recusas[0]!;
  // A MENSAGEM É A DA CONFIRMAÇÃO: o mesmo pedido de confirmar, agora, é recusado com o mesmo código e texto — e sem efeito.
  const direto = await tentar(page, "POST", `/api/sales/sales/${id}/confirm`, {});
  expect(direto.status, "a confirmação recusa agora").toBe(422);
  const erro = direto.corpo["error"] as { code: string; message: string };
  expect([erro.code, erro.message], "a prévia antecipa EXATAMENTE a recusa da confirmação").toEqual([recusa.code, recusa.message]);
  expect((await lerVenda(page, id)).status, "e a recusa não mexeu no documento").toBe("open");

  const ws = await abrirDetalhe(page, id);
  await expect(ws.getByTestId("classificacao-padrao-automatico"), "classificada: nada de padrão automático").toHaveCount(0);
  const r1 = page.waitForResponse(ehPrevia(id));
  await botaoConfirmarVenda(page).click();
  expect((await r1).status()).toBe(200);
  const alerta = dialogo(page).getByTestId("previa-confirmacao-recusa");
  await expect(alerta).toBeVisible();
  await expect(alerta.getByTestId("previa-confirmacao-recusa-mensagem").first(), "a mensagem é a do servidor, palavra por palavra").toHaveText(recusa.message);
  await expect(dialogo(page).getByTestId("previa-confirmacao"), "com recusa prevista, nenhuma linha de efeito é prometida").toHaveCount(0);
  await expect(botaoDoDialogo(page), "e o botão Confirmar fica desabilitado").toBeDisabled();
  await fecharDialogo(page);

  // A PREMISSA: o MESMO documento, com a categoria reativada, habilita o botão — e a pergunta é refeita ao reabrir.
  await api(page, "PUT", `/api/resources/financial_categories/${categoria}`, { is_active: true });
  const r2 = page.waitForResponse(ehPrevia(id));
  await botaoConfirmarVenda(page).click();
  const depois = await (await r2).json() as Previa;
  expect(depois.podeConfirmar, "reativada, a prévia libera").toBe(true);
  await expect(dialogo(page).getByTestId("previa-confirmacao")).toBeVisible();
  await expect(dialogo(page).getByTestId("previa-confirmacao-recusa")).toHaveCount(0);
  await expect(botaoDoDialogo(page), "o mesmo botão, agora habilitado").toBeEnabled();
  await fecharDialogo(page);
});

test("A5-W4 — dica da criação da venda e diálogo de cancelamento com o texto novo; a dica de orçamento e pedido não mudou", async ({ page }) => {
  await login(page);
  const DICA_VENDA = "O que a confirmação faz no estoque e no financeiro depende do Tipo de Operação e é mostrado antes de confirmar.";
  const DICA_COMERCIAL = "Documento comercial sem efeito em estoque/financeiro até ser convertido em venda confirmada.";
  const dicaDaIdentidade = () => page.getByTestId(WORKSPACE).locator("[data-dica][role='img']");

  // A DICA de cada variante, no ícone da identidade do lançamento (onde ela é mostrada ao passar o ponteiro).
  for (const [variante, familia, esperada] of [["sales", "vendas.venda", DICA_VENDA], ["budgets", "vendas.orcamento", DICA_COMERCIAL], ["orders", "vendas.pedido", DICA_COMERCIAL]] as const) {
    const top = await cadastrarTop(page, familia);
    await abrirLancamentoDeVendas(page, variante);
    await escolherTopEContinuar(page, top);
    await expect(dicaDaIdentidade(), `${variante}: a identidade tem UMA dica`).toHaveCount(1);
    await expect(dicaDaIdentidade(), `${variante}: o texto da dica`).toHaveAttribute("data-dica", esperada);
    // A promessa antiga não sobrevive em outro ponto da mesma tela (a positiva acima é a premissa: o formulário montou).
    await expect(page.locator('[data-dica*="baixa o estoque dos itens com armazém"]'), `${variante}: a promessa de antes não aparece`).toHaveCount(0);
  }

  // O DIÁLOGO DE CANCELAMENTO fala só do que a tela oferece: documento que NÃO confirmou.
  const { empresa, cliente } = await insumos(page);
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const aberta = await criarVenda(page, { empresa_id: empresa, client_id: cliente, items: [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }] });
  const ws = await abrirDetalhe(page, aberta);
  await ws.getByTestId("central-vendas-mais-acoes").click();
  await page.getByTestId("central-vendas-mais-acoes-menu").getByRole("menuitem", { name: "Cancelar venda…" }).click();
  await expect(dialogo(page).getByRole("heading", { name: "Cancelar documento" })).toBeVisible();
  await expect(dialogo(page)).toContainText("O documento será cancelado. Ele não movimentou estoque nem gerou conta a receber.");
  await expect(dialogo(page), "a frase sobre venda confirmada saiu: a tela nunca a alcança").not.toContainText("Vendas confirmadas têm estoque e títulos estornados.");
  await fecharDialogo(page);

  // POR QUE A FRASE É VERDADE: venda confirmada não oferece cancelamento na tela. Premissa: o menu existe e tem o histórico.
  await api(page, "POST", `/api/sales/sales/${aberta}/confirm`, {});
  await page.reload();
  await expect(page.getByTestId("central-vendas-situacao").locator("[data-status]"), "premissa: confirmada").toHaveAttribute("data-status", "confirmed");
  await page.getByTestId(WORKSPACE).getByTestId("central-vendas-mais-acoes").click();
  const menu = page.getByTestId("central-vendas-mais-acoes-menu");
  await expect(menu.getByRole("menuitem", { name: "Histórico de alterações" }), "premissa: o menu abriu").toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /^Cancelar/ }), "confirmada, a tela não oferece cancelar").toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("A5-W4b — sem a prévia (rota forçada a 404): o diálogo mostra o texto neutro, o botão fica HABILITADO e a confirmação funciona", async ({ page }) => {
  await login(page);
  const { empresa, cliente } = await insumos(page);
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const id = await criarVenda(page, { empresa_id: empresa, client_id: cliente, items: [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }] });

  // A API ANTERIOR NA JANELA DE DEPLOY, simulada no fio: a rota não existe → 404. A resposta real é buscada e só o
  // STATUS e o corpo trocam, para os cabeçalhos de CORS continuarem os do servidor — senão o navegador descartaria a
  // resposta por CORS e o teste mediria uma falha de rede, não um 404.
  const interceptadas: string[] = [];
  await page.route(`**${caminhoDaPrevia(id)}`, async (route) => {
    const real = await route.fetch();
    interceptadas.push(route.request().url());
    await route.fulfill({ response: real, status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_FOUND", message: "Route GET not found" } }) });
  });

  const avisoPedido = page.waitForResponse(ehPrevia(id));
  const ws = await abrirDetalhe(page, id);
  expect((await avisoPedido).status(), "premissa: o aviso perguntou e recebeu 404").toBe(404);
  // Sem a prévia, o aviso segue a regra da A1 (venda aberta sem classificação) — o texto genérico, sem par.
  await expect(ws.getByTestId("classificacao-padrao-automatico")).toHaveText(AVISO_SEM_PREVIA);

  const doDialogo = page.waitForResponse(ehPrevia(id));
  await botaoConfirmarVenda(page).click();
  expect((await doDialogo).status(), "o diálogo também perguntou e recebeu 404").toBe(404);
  expect(interceptadas.length, "as duas perguntas passaram pela rota forçada").toBeGreaterThanOrEqual(2);
  await expect(dialogo(page).getByTestId("previa-confirmacao-neutra")).toHaveText(TEXTO_NEUTRO);
  await expect(dialogo(page).getByTestId("previa-confirmacao"), "sem prévia, nenhum efeito é prometido").toHaveCount(0);
  await expect(dialogo(page).getByTestId("previa-confirmacao-carregando"), "e não fica 'carregando' para sempre").toHaveCount(0);
  await expect(botaoDoDialogo(page), "o botão fica HABILITADO: quem recusa é o servidor").toBeEnabled();

  const confirmacao = page.waitForResponse((x) => x.request().method() === "POST" && new URL(x.url()).pathname === `/api/sales/sales/${id}/confirm`);
  await botaoDoDialogo(page).click();
  expect((await confirmacao).status(), "e a confirmação segue funcionando").toBe(200);
  expect((await lerVenda(page, id)).status).toBe("confirmed");
});

/**
 * Uma TOP de venda no FORMATO 2 com a execução CONFIGURADA nos dois eixos — o que a fase 2 da 04A liga. A
 * configuração parte do corpo que o PRÓPRIO servidor devolveu para a TOP recém-criada (o neutro dele), e só
 * os dois eixos mudam: nada de uma segunda cópia do neutro neste arquivo.
 */
async function topFormato2(page: Page, estoque: "nenhuma" | "saida", financeiro: "nenhuma" | "receber", exigencias: { exigeFormaPagamento?: boolean } = {}) {
  const id = await cadastrarTop(page, "vendas.venda");
  const d = await api<{ revisao: number; configuracao: { valor: Record<string, Record<string, unknown>> } }>(page, "GET", `/api/admin/tipos-operacao/${id}`);
  const v = d.configuracao.valor;
  await api(page, "PUT", `/api/admin/tipos-operacao/${id}`, { revisao: d.revisao, configuracao: { ...v, versaoSchema: 2,
    execucao: { estoque: "configurada", financeiro: "configurada" },
    estoque: { ...v["estoque"], atualizacao: estoque }, financeiro: { ...v["financeiro"], atualizacao: financeiro, ...exigencias } } });
  return id;
}

test("A5-W2b — TOP formato 2 (gate ligado): 'nenhum' + a receber e saída + 'nenhum' — o diálogo diz o efeito da TOP, e o aviso do padrão só existe quando haverá conta a receber", async ({ page }) => {
  await login(page);
  const { empresa, cliente } = await insumos(page);
  const warehouse = await primeiroId(page, `/api/resources/warehouses?empresa_id=${empresa}&initials=ALM&pageSize=1`);
  const produto = await primeiroId(page, `/api/resources/products?search=${encodeURIComponent("Ração Confinamento")}&pageSize=1`);
  expect(await garantirSaldo(page, empresa, warehouse, produto), "premissa: há saldo para a baixa do caso de saída").toBeGreaterThanOrEqual(1);

  // Os DOIS casos são a premissa um do outro: cada "não" de um é o "sim" do outro, na mesma venda de 1 item com armazém.
  const casos = [
    { nome: "estoque nenhum + a receber", estoque: "nenhuma" as const, financeiro: "receber" as const, efeitos: ["nenhum", "receber"], baixa: 0, titulo: true },
    { nome: "saída + financeiro nenhum", estoque: "saida" as const, financeiro: "nenhuma" as const, efeitos: ["baixa", "nenhum"], baixa: 1, titulo: false },
  ];
  for (const caso of casos) {
    const top = await topFormato2(page, caso.estoque, caso.financeiro);
    // SEM classificação: é a venda em que a regra da A1 mostraria o aviso do padrão automático a qualquer custo.
    const id = await criarVenda(page, { empresa_id: empresa, client_id: cliente, tipo_operacao_id: top,
      items: [{ product_id: produto, warehouse_id: warehouse, quantity: "1", unit_price: "10.00" }] });
    const venda = await lerVenda(page, id);
    expect([venda["categoria_financeira_id"], venda.status], `${caso.nome}: premissa — aberta e sem classificação`).toEqual([null, "open"]);

    const avisoPedido = page.waitForResponse(ehPrevia(id));
    const ws = await abrirDetalhe(page, id);
    const corpo = await (await avisoPedido).json() as Previa;
    // O CORPO primeiro: a execução é a CONFIGURADA, e nada impede a venda.
    expect([corpo.podeConfirmar, corpo.estoque.efeito, corpo.financeiro.efeito], caso.nome).toEqual([true, ...caso.efeitos]);

    // O DIÁLOGO pergunta de novo e escreve o efeito DESTA TOP — não a frase de sempre ("baixa e gera").
    const doDialogo = page.waitForResponse(ehPrevia(id));
    await botaoConfirmarVenda(page).click();
    expect((await doDialogo).status(), caso.nome).toBe(200);
    await expect(dialogo(page).getByTestId("previa-confirmacao"), `${caso.nome}: a prévia está PRONTA no diálogo`).toBeVisible();
    const linhaEstoque = dialogo(page).getByTestId("previa-confirmacao-estoque");
    const linhaFinanceira = dialogo(page).getByTestId("previa-confirmacao-financeiro");
    if (caso.titulo) {
      await expect(linhaEstoque, caso.nome).toHaveText("Não movimenta estoque.");
      await expect(linhaFinanceira, caso.nome).toContainText(/^Gera contas a receber de R\$\s*10,00/);
      await expect(linhaFinanceira, `${caso.nome}: o título vai pelo recuo, e a linha diz isso`).toContainText("(padrão automático).");
      // O AVISO do detalhe existe — com o par que a prévia nomeou.
      const c = corpo.financeiro.classificacao!;
      await expect(ws.getByTestId("classificacao-padrao-automatico"), caso.nome)
        .toHaveText(`Sem classificação: ao confirmar, a venda usará o padrão automático — categoria ${rotulo(c.categoria)} · centro ${rotulo(c.centro)}.`);
    } else {
      await expect(linhaEstoque, caso.nome).toHaveText("Baixa o estoque de 1 item.");
      await expect(linhaFinanceira, caso.nome).toHaveText("Não gera conta a receber.");
      // SEM título não há padrão automático a anunciar. A ausência é lida com a prévia PRONTA (a linha acima já
      // está desenhada, e aviso e diálogo leem a MESMA resposta) — não é o "nada" de quem ainda carrega.
      expect(corpo.financeiro.classificacao, `${caso.nome}: o servidor não resolveu classificação`).toBeNull();
      await expect(ws.getByTestId("classificacao-padrao-automatico"), `${caso.nome}: a regra da A1 não vale com a prévia`).toHaveCount(0);
    }
    await expect(botaoDoDialogo(page), caso.nome).toBeEnabled();

    // CONFIRMA — e o efeito é o anunciado, contado no saldo e nos títulos.
    const antes = await saldo(page, warehouse, produto);
    const confirmacao = page.waitForResponse((x) => x.request().method() === "POST" && new URL(x.url()).pathname === `/api/sales/sales/${id}/confirm`);
    await botaoDoDialogo(page).click();
    expect((await confirmacao).status(), caso.nome).toBe(200);
    const confirmada = await lerVenda(page, id);
    expect(confirmada.status, caso.nome).toBe("confirmed");
    expect(antes - await saldo(page, warehouse, produto), `${caso.nome}: baixa`).toBe(caso.baixa);
    expect(confirmada.titles.length > 0, `${caso.nome}: título`).toBe(caso.titulo);
  }
});

test("A5-W3b — venda sem classificação com recusa prevista (exigência da TOP): o aviso do padrão automático NÃO aparece — ele fala de uma confirmação que não vai acontecer", async ({ page }) => {
  await login(page);
  const { empresa, cliente } = await insumos(page);
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const formaDePagamento = await primeiroId(page, "/api/resources/payment_methods?pageSize=1");
  // A receber CONFIGURADO, exigindo forma de pagamento. Sem classificação no documento: o título iria pelo recuo.
  const top = await topFormato2(page, "nenhuma", "receber", { exigeFormaPagamento: true });
  const itens = [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }];

  const casos = [
    { nome: "sem forma de pagamento (recusada)", extra: {}, podeConfirmar: false },
    // A PREMISSA: a MESMA TOP, com a forma de pagamento, é confirmável — e aí o aviso existe, com o par.
    { nome: "com forma de pagamento (confirmável)", extra: { payment_method_id: formaDePagamento }, podeConfirmar: true },
  ];
  for (const caso of casos) {
    const id = await criarVenda(page, { empresa_id: empresa, client_id: cliente, tipo_operacao_id: top, items: itens, ...caso.extra });
    const avisoPedido = page.waitForResponse(ehPrevia(id));
    const ws = await abrirDetalhe(page, id);
    const corpo = await (await avisoPedido).json() as Previa;
    // O CORPO: o planejamento seguiu além da exigência e resolveu o recuo — o par EXISTE na resposta, e só a
    // regra da tela (pode confirmar?) decide se ele vira aviso. Sem esse par no corpo, a ausência abaixo seria vácuo.
    expect([corpo.podeConfirmar, corpo.financeiro.efeito, corpo.financeiro.classificacao?.origem], caso.nome).toEqual([caso.podeConfirmar, "receber", "padrão legado"]);
    if (!caso.podeConfirmar) expect(corpo.recusas.map((r) => r.code), caso.nome).toEqual(["TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA"]);

    // O diálogo com a prévia PRONTA — recusa ou linhas — e, lendo a MESMA resposta, o aviso.
    const doDialogo = page.waitForResponse(ehPrevia(id));
    await botaoConfirmarVenda(page).click();
    await doDialogo;
    const aviso = ws.getByTestId("classificacao-padrao-automatico");
    if (!caso.podeConfirmar) {
      await expect(dialogo(page).getByTestId("previa-confirmacao-recusa-mensagem").first(), caso.nome).toHaveText(corpo.recusas[0]!.message);
      await expect(botaoDoDialogo(page), caso.nome).toBeDisabled();
      await expect(aviso, `${caso.nome}: "ao confirmar, usará" não vale para uma confirmação recusada`).toHaveCount(0);
    } else {
      await expect(dialogo(page).getByTestId("previa-confirmacao"), caso.nome).toBeVisible();
      await expect(botaoDoDialogo(page), caso.nome).toBeEnabled();
      const c = corpo.financeiro.classificacao!;
      await expect(aviso, caso.nome).toHaveText(`Sem classificação: ao confirmar, a venda usará o padrão automático — categoria ${rotulo(c.categoria)} · centro ${rotulo(c.centro)}.`);
    }
    await fecharDialogo(page);
  }
});

test("A5-W4c — prévia com defeito (500, contractVersion 2, corpo incoerente): texto neutro, botão HABILITADO, e o aviso volta à regra da A1", async ({ page }) => {
  await login(page);
  const { empresa, cliente } = await insumos(page);
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const id = await criarVenda(page, { empresa_id: empresa, client_id: cliente, items: [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }] });

  // PREMISSA: o corpo REAL desta venda é um contrato 1 válido, que a tela usaria — cada defeito abaixo é
  // aplicado SOBRE ele, então o texto neutro só pode vir do defeito.
  const real = await api<Previa>(page, "GET", caminhoDaPrevia(id));
  expect([real.contractVersion, real.podeConfirmar, real.financeiro.efeito], "premissa: a prévia real é usável").toEqual([1, true, "receber"]);

  const DEFEITOS: { nome: string; status: number; corpo: (p: Record<string, unknown>) => unknown }[] = [
    { nome: "servidor com defeito (500)", status: 500, corpo: () => ({ error: { code: "INTERNAL_ERROR", message: "Erro interno" } }) },
    { nome: "contrato de outra versão (2)", status: 200, corpo: (p) => ({ ...p, contractVersion: 2 }) },
    // "A receber" sem valor: a forma de cada campo está certa, a COERÊNCIA não — lido, viraria "R$ 0,00".
    { nome: "conta a receber sem valor", status: 200, corpo: (p) => ({ ...p, financeiro: { ...(p["financeiro"] as Record<string, unknown>), valor: null } }) },
    { nome: "'pode confirmar' com recusa", status: 200, corpo: (p) => ({ ...p, recusas: [{ code: "VALIDATION_ERROR", message: "contradição" }] }) },
    // "Pode confirmar" sem política: lido, viraria um diálogo sem linha nenhuma e o botão habilitado.
    { nome: "'pode confirmar' sem política", status: 200, corpo: (p) => ({ ...p,
      estoque: { efeito: null, itensQueBaixam: 0, itensSemArmazem: 0 }, financeiro: { efeito: null, valor: null, primeiroVencimento: null, classificacao: null } }) },
  ];
  let defeito = DEFEITOS[0]!;
  const servidas: string[] = [];
  await page.route(`**${caminhoDaPrevia(id)}`, async (route) => {
    // A resposta REAL é buscada e só status e corpo trocam: os cabeçalhos de CORS continuam os do servidor.
    const r = await route.fetch();
    const p = await r.json() as Record<string, unknown>;
    servidas.push(defeito.nome);
    await route.fulfill({ response: r, status: defeito.status, contentType: "application/json", body: JSON.stringify(defeito.corpo(p)) });
  });

  // O AVISO, com a prévia com defeito: a regra da A1 (venda aberta sem classificação), sem par inventado.
  const avisoPedido = page.waitForResponse(ehPrevia(id));
  const ws = await abrirDetalhe(page, id);
  expect((await avisoPedido).status(), "premissa: o aviso perguntou e recebeu o defeito").toBe(500);
  await expect(ws.getByTestId("classificacao-padrao-automatico")).toHaveText(AVISO_SEM_PREVIA);

  for (const d of DEFEITOS) {
    defeito = d;
    const doDialogo = page.waitForResponse(ehPrevia(id));
    await botaoConfirmarVenda(page).click();
    expect((await doDialogo).status(), d.nome).toBe(d.status);
    await expect(dialogo(page).getByTestId("previa-confirmacao-neutra"), d.nome).toHaveText(TEXTO_NEUTRO);
    await expect(dialogo(page).getByTestId("previa-confirmacao"), `${d.nome}: nenhum efeito prometido`).toHaveCount(0);
    await expect(dialogo(page).getByTestId("previa-confirmacao-recusa"), `${d.nome}: nenhuma recusa inventada`).toHaveCount(0);
    await expect(botaoDoDialogo(page), `${d.nome}: quem recusa é o servidor`).toBeEnabled();
    // E o aviso, que lê a MESMA resposta, também cai na regra da A1.
    await expect(ws.getByTestId("classificacao-padrao-automatico"), d.nome).toHaveText(AVISO_SEM_PREVIA);
    await fecharDialogo(page);
  }
  expect(servidas, "cada defeito passou pela rota forçada (o aviso + um por abertura)").toEqual([DEFEITOS[0]!.nome, ...DEFEITOS.map((d) => d.nome)]);

  // A PREMISSA DO BOTÃO: habilitado com o texto neutro, ele confirma de verdade.
  defeito = DEFEITOS[1]!;
  const doDialogo = page.waitForResponse(ehPrevia(id));
  await botaoConfirmarVenda(page).click();
  await doDialogo;
  await expect(dialogo(page).getByTestId("previa-confirmacao-neutra")).toBeVisible();
  const confirmacao = page.waitForResponse((x) => x.request().method() === "POST" && new URL(x.url()).pathname === `/api/sales/sales/${id}/confirm`);
  await botaoDoDialogo(page).click();
  expect((await confirmacao).status()).toBe(200);
  expect((await lerVenda(page, id)).status).toBe("confirmed");
});
