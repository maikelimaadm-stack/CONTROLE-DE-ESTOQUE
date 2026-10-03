import type { Locator, Page, Request, Response } from "@playwright/test";
import { LAYOUT_DO_SISTEMA, type EstruturaLayout } from "@agro/domain";
import { login, logout, api, uniq, pickRef, empresaAtiva, preencherClassificacaoFinanceira } from "./helpers";
import { test, expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed } from "./central-compras-fixtures";
import { cfg5 } from "./top-config-08-comum";

/**
 * OPERACOES-01 · F3b (decisão 280) — A CENTRAL DE VENDAS COM O LOCAL ANTES DO PRODUTO E A PESQUISA COM O SALDO DO LOCAL
 * (API e banco REAIS; só o POST do F3B-V1 é interceptado — nada daquele caso é gravado).
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PROVA ──────────────────────────────────────────────────────────────────────────────────┐
 * │ F3B-V1 — o "Local de estoque" do CABEÇALHO (logo depois do Tipo de Operação) é estado da TELA: a linha NOVA      │
 * │   nasce com ele, a linha troca o seu sem mexer no cabeçalho, e o POST leva as chaves EXATAS de antes (as do W4)  │
 * │   — o local escolhido no cabeçalho só aparece no `warehouse_id` do item que nasceu com ele. A grade é Local →    │
 * │   Código → Produto → Estoque (o layout do sistema). Descartar volta o cabeçalho ao PADRÃO: ao vazio sem padrão   │
 * │   e, numa TOP com layout ligado cujo local tem padrão de cadastro (L1), a L1 depois de o usuário escolher L2.     │
 * │ F3B-V2 — a pesquisa de produto da SAÍDA, para quem vê o estoque: só o que tem saldo > 0 no local da linha (e o   │
 * │   produto que não controla estoque), com a coluna Estoque e "Só com saldo neste local" marcado; no fio, a rota   │
 * │   nova com `armazem_id`, `com_saldo=true`, `pagina=1`, `limite=50` e `busca`, e ZERO pedido à fonte de antes.     │
 * │   Desmarcar mostra o produto sem saldo e o pedido seguinte vai SEM `com_saldo`.                                  │
 * │ F3B-V3 — a recusa: o vendedor SEM `stocks.view` pede `com_saldo=true` (a tela pede na saída) e o servidor IGNORA │
 * │   o filtro — os três produtos aparecem, sem saldo, sem a coluna Estoque e sem o controle (sem oráculo do saldo). │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ A REGRA ANTI-VACUIDADE ───────────────────────────────────────────────────────────────────────────────────────┐
 * │ O saldo é PREMISSA lida no servidor (`/api/stock/balances`), nunca suposto. O filtro é provado pelos dois lados  │
 * │ na MESMA tela (P2 some com o controle marcado e aparece desmarcado). A recusa tem a premissa ao lado: o MESMO    │
 * │ pedido, feito por quem vê o estoque, filtra. Toda ausência (coluna, controle, pedido à fonte de antes) é lida    │
 * │ depois de um sinal que só existe no estado final (as opções da busca na tela, o pedido da rota nova no fio).    │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Cada caso cria os PRÓPRIOS cadastros pela API (dois locais da empresa ativa, três produtos com um TAG único — P1 e P2
 * controlam estoque, P3 não — e a TOP de venda no formato 5); a referência do seed vem pelo NOME. O saldo de P1 (5 em
 * L1) entra por `POST /api/stock/opening-balances`. Os cadastros saem no fim, passou ou falhou
 * (`central-compras-fixtures.ts`, com a sessão do administrador); o saldo inicial e o papel do vendedor ficam.
 */

const WORKSPACE = "central-vendas";
/** O layout do sistema de vendas (decisão 280): o Local de estoque antes do produto, o Código junto do Produto. */
const ROTULOS_DA_GRADE = ["Local de estoque", "Código", "Produto", "Estoque", "Quantidade", "Valor unitário", "Desconto", "Desconto %", "Total"];
/** As chaves do corpo do POST e do item — as MESMAS do W4 de `central-vendas-workspace.spec.ts` (o contrato de antes). */
const CHAVES_DO_CORPO = [
  "categoria_financeira_id", "centro_custo_id",
  "client_id", "discount", "document_date", "driver_name", "due_date", "empresa_id", "freight", "freight_icms",
  "installment_plan", "is_deductible", "items", "note", "other_values", "payment_method_id", "proprietary_id",
  "shipping_date", "tipo_operacao_id", "transporter_id"
];
const CHAVES_DO_ITEM = ["discount", "discount_percent", "note", "product_id", "quantity", "unit_price", "warehouse_id"];
const PORTA_DA_PESQUISA = "/api/produtos/pesquisa";
const PORTA_DE_ANTES = "/api/resources/products/options";
const LAYOUTS = "/api/admin/layouts-documento";

const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const painelDePesquisa = (page: Page) => page.getByTestId("central-vendas-pesquisa");
const linha = (page: Page, i: number) => page.getByTestId("central-vendas-linha").nth(i);
const campoDoLocal = (page: Page) => page.getByTestId("central-vendas-local-padrao");
/** Os títulos das colunas da grade, sem a coluna do círculo de seleção (sem texto). */
const cabecalhos = async (page: Page) => (await page.getByTestId("central-vendas-grade").locator("thead th").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
/** As descrições das opções da pesquisa, na ordem da tela (pela coluna, não pela posição). */
const descricoes = (painel: Locator) => painel.getByRole("option").locator('[data-coluna="descricao"]').allInnerTexts();

type Cadastro = { id: string; nome: string };
type Cenario = { empresa: string; tag: string; l1: Cadastro; l2: Cadastro; p1: Cadastro; p2: Cadastro; p3: Cadastro; top: string };
type ItemNoFio = { id: string; descricao: string | null; estoque: string | null };
type PaginaNoFio = { itens: ItemNoFio[]; estoqueDoArmazem: boolean; pagina: number; temMais: boolean; filtradoPorSaldo: boolean };

/**
 * O cenário: L1 e L2 da empresa ativa (a da Central), P1 e P2 que controlam estoque, P3 que não controla, todos com o
 * TAG na descrição; 5 de P1 em L1 (premissa lida no servidor); a TOP de venda no formato 5 (o neutro do domínio).
 */
async function cenario(page: Page): Promise<Cenario> {
  const empresa = await empresaAtiva(page);
  const tag = `f3bv${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const ref = await referenciasDoSeed(page);
  const local = async (rotulo: string): Promise<Cadastro> => {
    const { id } = await criarCadastro(page, "warehouses", { empresa_id: empresa, initials: `${rotulo}${Math.random().toString(36).slice(2, 7).toUpperCase()}`, description: `F3B-V ${rotulo} ${tag}`, type: "inputs" });
    const lido = await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${id}`);
    expect(lido["empresa_id"], `premissa: ${rotulo} é da empresa do documento`).toBe(empresa);
    return { id, nome: String(lido["description"]) };
  };
  const produto = async (rotulo: string, controla: boolean): Promise<Cadastro> => {
    const { id } = await criarCadastro(page, "products", {
      description: `F3B-V ${rotulo} ${tag}`, group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id, control_stock: controla
    });
    const lido = await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${id}`);
    expect(lido["control_stock"], `premissa: ${rotulo} ${controla ? "controla" : "NÃO controla"} estoque`).toBe(controla);
    return { id, nome: String(lido["description"]) };
  };
  const l1 = await local("L1");
  const l2 = await local("L2");
  const p1 = await produto("P1", true);
  const p2 = await produto("P2", true);
  const p3 = await produto("P3", false);
  await api(page, "POST", "/api/stock/opening-balances", { empresa_id: empresa, warehouse_id: l1.id, product_id: p1.id, quantity: "5", unit_value: "3" });
  const saldo = (arm: Cadastro, prod: Cadastro) => api<{ quantity: string }>(page, "GET", `/api/stock/balances/${arm.id}/${prod.id}`).then((s) => s.quantity);
  expect(await saldo(l1, p1), "premissa: P1 tem 5 em L1").toBe("5.0000");
  expect(await saldo(l1, p2), "premissa: P2 não tem saldo em L1").toBe("0.0000");
  expect(await saldo(l2, p1), "premissa: P1 não tem saldo em L2").toBe("0.0000");
  const { id: top } = await criarTop(page, { codigo: codigoTop("5"), codigoBase: "vendas.venda", nome: uniq("F3B-V venda"), configuracao: cfg5() });
  return { empresa, tag, l1, l2, p1, p2, p3, top };
}

/** Abre a criação da venda com a TOP e só devolve com o formulário montado. */
async function abrirCriacao(page: Page, top: string) {
  await page.goto(`/vendas/sales/new?tipo_operacao_id=${top}`);
  await expect(page.getByTestId(WORKSPACE)).toBeVisible();
  await expect(page.getByTestId("top-contexto"), "a Central abriu o formulário desta TOP").toBeVisible();
}

/** Escolhe o "Local de estoque" do cabeçalho (o RefSelect do campo) e confere que o campo o mostra. */
async function escolherLocalDoCabecalho(page: Page, nome: string) {
  const campo = campoDoLocal(page);
  await campo.locator("button").first().click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nome);
  await painel.getByRole("option", { name: literal(nome) }).first().click();
  await expect(campo, "o cabeçalho mostra o local escolhido").toContainText(nome);
}

/** Pesquisa na célula da linha (produto ou local) pelo NOME inteiro e escolhe. */
async function escolherNaCelula(page: Page, celula: Locator, nome: string) {
  await celula.click();
  const painel = painelDePesquisa(page);
  await expect(painel).toBeVisible();
  await painel.getByRole("combobox").fill(nome);
  await painel.getByRole("option", { name: literal(nome) }).first().click();
  await expect(painel).toHaveCount(0);
  await expect(celula).toContainText(nome);
}

/** Os pedidos a uma porta, pelo caminho EXATO, com a query string lida. */
function ouvirPedidos(page: Page, caminho: string) {
  const pedidos: URLSearchParams[] = [];
  page.on("request", (r: Request) => { const u = new URL(r.url()); if (r.method() === "GET" && u.pathname === caminho) pedidos.push(u.searchParams); });
  return pedidos;
}
/** A query de um pedido como objeto (chave → valor), para a comparação EXATA (parâmetro repetido reprova). */
const comoObjeto = (q: URLSearchParams) => {
  const chaves = [...q.keys()];
  expect(new Set(chaves).size, "nenhum parâmetro repetido no pedido").toBe(chaves.length);
  return Object.fromEntries(q.entries());
};
/** A resposta da pesquisa nova para a busca dada (o ouvinte nasce ANTES da digitação). */
const respostaDaBusca = (page: Page, busca: string) => page.waitForResponse((r: Response) => {
  const u = new URL(r.url());
  return r.request().method() === "GET" && u.pathname === PORTA_DA_PESQUISA && u.searchParams.get("busca") === busca;
});

/** Intercepta o POST de criação e devolve o corpo enviado (sem gravar nada no banco) — o molde `capturarPost` do W20. */
async function capturarPost(page: Page) {
  const capturado: { corpo: Record<string, unknown> | null } = { corpo: null };
  await page.route("**/api/sales/sales", async (rota) => {
    if (rota.request().method() !== "POST") return rota.continue();
    capturado.corpo = rota.request().postDataJSON() as Record<string, unknown>;
    await rota.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000000" }) });
  });
  return capturado;
}

test("F3B-V1 — o Local de estoque do cabeçalho preenche só as linhas novas, a linha troca o seu, a grade é Local → Código → Produto → Estoque, o POST é o de antes, e o Descartar volta ao padrão (vazio ou o do layout)", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  await abrirCriacao(page, c.top);

  // PREMISSAS: o layout que vale é o do sistema, e a grade (ainda sem linha) tem as colunas na ordem nova
  await expect(page.getByTestId("central-layout-efetivo"), "premissa: o layout que vale é o do sistema").toHaveAttribute("data-origem", "sistema");
  expect(await cabecalhos(page), "a grade: Local de estoque → Código → Produto → Estoque → …").toEqual(ROTULOS_DA_GRADE);
  // o campo do cabeçalho mora logo depois do Tipo de Operação, vazio (o layout do sistema não tem padrão de local)
  expect(await page.getByTestId("top-contexto").evaluate((el) => el.nextElementSibling?.getAttribute("data-testid") ?? null),
    "o Local de estoque do cabeçalho vem logo depois do Tipo de Operação").toBe("central-vendas-local-padrao");
  await expect(campoDoLocal(page)).toContainText("Local de estoque");
  await expect(campoDoLocal(page).locator('[data-preenchido="true"]'), "premissa: o cabeçalho começa vazio").toHaveCount(0);
  expect(await campoDoLocal(page).getAttribute("data-campo"), "não é campo do layout: sem data-campo").toBeNull();

  // L1 no cabeçalho → a linha NOVA nasce com L1
  await escolherLocalDoCabecalho(page, c.l1.nome);
  await expect(campoDoLocal(page).locator('[data-preenchido="true"]')).toHaveCount(1);
  await expect(page.getByTestId("central-vendas-alterado"), "o local do cabeçalho não conta como alteração do documento").toHaveCount(0);
  await page.getByTestId("central-vendas-adicionar-item").click();
  await expect(page.getByTestId("central-vendas-linha")).toHaveCount(1);
  await expect(page.getByTestId("central-vendas-alterado"), "premissa: a linha nova, sim, é alteração (o ponto acende)").toBeVisible();
  await expect(linha(page, 0).getByTestId("central-vendas-armazem"), "a linha nova nasceu com o local do cabeçalho").toContainText(c.l1.nome);

  // a LINHA troca o seu (L2) — o cabeçalho continua L1 — e a linha seguinte nasce com L1
  await escolherNaCelula(page, linha(page, 0).getByTestId("central-vendas-armazem"), c.l2.nome);
  await expect(campoDoLocal(page), "trocar o local da linha não mexe no cabeçalho").toContainText(c.l1.nome);
  await expect(campoDoLocal(page)).not.toContainText(c.l2.nome);
  await page.getByTestId("central-vendas-adicionar-item").click();
  await expect(page.getByTestId("central-vendas-linha")).toHaveCount(2);
  await expect(linha(page, 1).getByTestId("central-vendas-armazem"), "a linha 2 nasce com o local do cabeçalho").toContainText(c.l1.nome);
  await expect(linha(page, 0).getByTestId("central-vendas-armazem"), "e a linha 1 continua com o seu").toContainText(c.l2.nome);

  // os produtos: P3 (não controla estoque) na linha de L2, P1 (5 em L1) na linha de L1 — os dois passam pelo filtro
  await escolherNaCelula(page, linha(page, 0).getByTestId("central-vendas-produto"), c.p3.nome);
  await escolherNaCelula(page, linha(page, 1).getByTestId("central-vendas-produto"), c.p1.nome);
  await pickRef(page, "Cliente", "DEMO");
  await preencherClassificacaoFinanceira(page);

  const post = await capturarPost(page);
  await page.getByTestId("central-vendas-salvar").click();
  await expect.poll(() => post.corpo, { message: "o POST precisa ter saído" }).not.toBeNull();
  const corpo = post.corpo!;
  expect(Object.keys(corpo).sort(), "o corpo tem EXATAMENTE as chaves de antes (as do W4): o local do cabeçalho não vai").toEqual(CHAVES_DO_CORPO);
  const itens = corpo["items"] as Record<string, unknown>[];
  for (const item of itens) expect(Object.keys(item).sort(), "o item tem as chaves de antes").toEqual(CHAVES_DO_ITEM);
  expect(itens.map((i) => i["warehouse_id"]), "o local de CADA linha: L2 (trocado na linha) e L1 (do cabeçalho)").toEqual([c.l2.id, c.l1.id]);
  expect(itens.map((i) => i["product_id"]), "premissa: os produtos escolhidos").toEqual([c.p3.id, c.p1.id]);
  expect(JSON.stringify(corpo).split(c.l1.id).length - 1, "o id de L1 aparece UMA vez no corpo: só no item que nasceu com ele").toBe(1);
  expect(corpo["tipo_operacao_id"]).toBe(c.top);

  // DESCARTAR: numa criação nova, o cabeçalho com L1 e uma linha — Descartar volta o cabeçalho ao vazio (sem padrão do
  // layout), e a linha seguinte nasce SEM local
  await page.unroute("**/api/sales/sales");
  await abrirCriacao(page, c.top);
  await escolherLocalDoCabecalho(page, c.l1.nome);
  await page.getByTestId("central-vendas-adicionar-item").click();
  await expect(linha(page, 0).getByTestId("central-vendas-armazem"), "premissa: a linha nasceu com L1").toContainText(c.l1.nome);
  await page.getByTestId("central-vendas-descartar").click();
  const dlg = page.getByTestId("confirm-dialog");
  await dlg.getByRole("button", { name: "Descartar alterações", exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId("central-vendas-linha"), "descartado: sem linhas").toHaveCount(0);
  await expect(campoDoLocal(page), "o campo continua na tela").toBeVisible();
  await expect(campoDoLocal(page).locator('[data-preenchido="true"]'), "o cabeçalho voltou ao vazio").toHaveCount(0);
  await expect(campoDoLocal(page)).not.toContainText(c.l1.nome);
  await page.getByTestId("central-vendas-adicionar-item").click();
  await expect(linha(page, 0).getByTestId("central-vendas-armazem"), "e a linha nova nasce sem local").toHaveText("—");

  // DESCARTAR COM O PADRÃO DE CADASTRO PREENCHIDO: outra TOP de venda, com um layout ligado (a cópia do do sistema) cujo
  // Local de estoque dos itens tem o padrão L1. O cabeçalho nasce em L1; o usuário escolhe L2; o Descartar (que remonta
  // o formulário) volta ao PADRÃO (L1) — não ao vazio, nem à escolha — e a linha nova seguinte nasce com L1.
  const { id: topComPadrao } = await criarTop(page, { codigo: codigoTop("5"), codigoBase: "vendas.venda", nome: uniq("F3B-V venda com padrão"), configuracao: cfg5() });
  const estrutura: EstruturaLayout = structuredClone(LAYOUT_DO_SISTEMA("vendas.venda"));
  expect(estrutura.itens.map((x) => x.campo), "premissa: o layout do sistema da venda tem o local nos itens").toContain("warehouse_id");
  estrutura.itens = estrutura.itens.map((x) => (x.campo === "warehouse_id" ? { ...x, valorPadrao: { tipo: "registro" as const, id: c.l1.id } } : x));
  const layout = (await api<{ id: string }>(page, "POST", LAYOUTS, { familia: "vendas.venda", nome: uniq("Layout F3B-V padrão"), estrutura })).id;
  let layoutVivo = true;
  try {
    await api(page, "PUT", `${LAYOUTS}/${layout}/tops`, { tipoOperacaoIds: [topComPadrao] });
    const efetivo = await api<Record<string, unknown>>(page, "GET", `/api/sales/sales/layout-efetivo?tipo_operacao_id=${topComPadrao}`);
    expect(efetivo, "premissa: o layout está ligado e o padrão do local vale").toMatchObject({ origem: "ligado", id: layout, padroesDeCadastro: { "itens.warehouse_id": { id: c.l1.id } } });

    await abrirCriacao(page, topComPadrao);
    await expect(page.getByTestId("central-layout-efetivo"), "premissa: a Central leu o layout ligado").toHaveAttribute("data-layout-id", layout);
    await expect(campoDoLocal(page), "o cabeçalho nasce no padrão de cadastro do layout").toContainText(c.l1.nome);
    await expect(campoDoLocal(page).locator('[data-preenchido="true"]')).toHaveCount(1);
    await escolherLocalDoCabecalho(page, c.l2.nome);
    await page.getByTestId("central-vendas-adicionar-item").click();
    await expect(linha(page, 0).getByTestId("central-vendas-armazem"), "a linha nova nasce com a escolha (L2)").toContainText(c.l2.nome);
    await page.getByTestId("central-vendas-descartar").click();
    await dlg.getByRole("button", { name: "Descartar alterações", exact: true }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByTestId("central-vendas-linha"), "descartado: sem linhas").toHaveCount(0);
    await expect(campoDoLocal(page), "o Descartar volta ao PADRÃO do layout (L1)").toContainText(c.l1.nome);
    await expect(campoDoLocal(page)).not.toContainText(c.l2.nome);
    await page.getByTestId("central-vendas-adicionar-item").click();
    await expect(linha(page, 0).getByTestId("central-vendas-armazem"), "e a linha nova nasce com o padrão").toContainText(c.l1.nome);
    // a limpeza que falha reprova o caso verde (excluir o layout desliga a TOP)
    await api(page, "DELETE", `${LAYOUTS}/${layout}`, {});
    layoutVivo = false;
  } finally {
    // o caso já falhou: a limpeza não mascara a falha
    if (layoutVivo) await api(page, "DELETE", `${LAYOUTS}/${layout}`, {}).catch(() => undefined);
  }
});

test("F3B-V2 — saída, quem vê o estoque: só com saldo no local da linha (e o que não controla estoque), com a coluna Estoque; desmarcar mostra tudo", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const daPesquisa = ouvirPedidos(page, PORTA_DA_PESQUISA);
  const deAntes = ouvirPedidos(page, PORTA_DE_ANTES);
  await abrirCriacao(page, c.top);
  await escolherLocalDoCabecalho(page, c.l1.nome);
  await page.getByTestId("central-vendas-adicionar-item").click();
  await expect(linha(page, 0).getByTestId("central-vendas-armazem"), "premissa: a linha está em L1").toContainText(c.l1.nome);

  await linha(page, 0).getByTestId("central-vendas-produto").click();
  const painel = painelDePesquisa(page);
  await expect(painel, "a fonte é a pesquisa nova (a API declarou a capacidade)").toHaveAttribute("data-fonte", "pesquisa");
  const filtrada = respostaDaBusca(page, c.tag);
  await painel.getByRole("combobox").fill(c.tag);
  const r1 = await filtrada;
  const pagina1 = await r1.json() as PaginaNoFio;
  expect([pagina1.filtradoPorSaldo, pagina1.estoqueDoArmazem], "premissa: o servidor aplicou o filtro e mostra o saldo").toEqual([true, true]);

  // a tela: P1 (5) e P3 (não controla estoque); P2 (sem saldo em L1) não
  await expect.poll(() => descricoes(painel), { message: "com o filtro: P1 e P3, na ordem do servidor" }).toEqual([c.p1.nome, c.p3.nome]);
  await expect(painel.locator('[aria-hidden] > [data-coluna]'), "o cabeçalho da pesquisa: Código | Descrição | Estoque").toHaveText(["Código", "Descrição", "Estoque"]);
  const opcao = (nome: string) => painel.getByRole("option").filter({ hasText: nome });
  await expect(opcao(c.p1.nome).locator('[data-coluna="estoque"]'), "o saldo de P1 em L1").toHaveText("5,0000");
  await expect(opcao(c.p3.nome).locator('[data-coluna="estoque"]'), "P3 não controla estoque: sem saldo").toHaveText("0,0000");
  const controle = page.getByTestId("central-vendas-pesquisa-so-com-saldo");
  await expect(controle).toContainText("Só com saldo neste local");
  await expect(controle.getByRole("checkbox"), "na saída, o controle vem marcado").toBeChecked();

  // o fio: a rota nova com os parâmetros novos; nenhum pedido à fonte de antes
  const comABusca = daPesquisa.filter((q) => q.get("busca") === c.tag).map(comoObjeto);
  expect(comABusca, "o pedido da busca, com o filtro: local da LINHA, com_saldo, página 1 de 50").toEqual([
    { busca: c.tag, armazem_id: c.l1.id, limite: "50", pagina: "1", com_saldo: "true" }
  ]);
  expect(deAntes.map(String), "nenhum pedido à fonte de antes").toEqual([]);

  // desmarcar: P2 aparece (sem saldo) e o pedido seguinte vai SEM com_saldo
  const semFiltro = respostaDaBusca(page, c.tag);
  await controle.getByRole("checkbox").uncheck();
  const pagina2 = await (await semFiltro).json() as PaginaNoFio;
  expect([pagina2.filtradoPorSaldo, pagina2.estoqueDoArmazem], "sem o filtro, o saldo continua à vista").toEqual([false, true]);
  await expect.poll(() => descricoes(painel), { message: "sem o filtro: os três" }).toEqual([c.p1.nome, c.p2.nome, c.p3.nome]);
  await expect(opcao(c.p2.nome).locator('[data-coluna="estoque"]'), "P2 aparece com o saldo zero").toHaveText("0,0000");
  await expect(controle.getByRole("checkbox")).not.toBeChecked();
  expect(daPesquisa.filter((q) => q.get("busca") === c.tag).map(comoObjeto).at(-1), "o pedido seguinte, sem com_saldo").toEqual(
    { busca: c.tag, armazem_id: c.l1.id, limite: "50", pagina: "1" }
  );

  // escolhe P1: a célula mostra P1 e a coluna Estoque da GRADE mostra o saldo do local
  await opcao(c.p1.nome).click();
  await expect(painel).toHaveCount(0);
  await expect(linha(page, 0).getByTestId("central-vendas-produto")).toContainText(c.p1.nome);
  const colunas = await page.getByTestId("central-vendas-grade").locator("thead th").allInnerTexts();
  const iEstoque = colunas.map((t) => t.trim()).indexOf("Estoque");
  expect(iEstoque, "premissa: a grade tem a coluna Estoque").toBeGreaterThan(0);
  await expect(linha(page, 0).locator("td").nth(iEstoque), "a coluna Estoque da grade: o saldo de P1 em L1").toHaveText("5,0000");
  expect(deAntes.map(String), "nenhum pedido à fonte de antes em todo o caso").toEqual([]);
});

/**
 * A RECUSA — o vendedor que lança venda e vê produto, SEM `stocks.view`. O papel nasce pela API (o molde do W-5c de
 * `top-config-08-centrais.spec.ts`): vender, ver cliente, produto e local — com o escopo EXPLÍCITO na empresa do
 * cadastro em vendas e em estoque (o local é cadastro do módulo de estoque). O filtro "só com saldo" para quem não vê o
 * saldo seria um oráculo: o produto sumiria conforme o estoque. O servidor o ignora.
 */
test("F3B-V3 — recusa: o vendedor sem stocks.view pede com_saldo=true e o servidor ignora — os três aparecem, sem saldo, sem a coluna Estoque e sem o controle", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  // PREMISSA: o MESMO pedido, por quem vê o estoque, FILTRA (P2 some) — a recusa abaixo não é falta de dado
  const doAdministrador = await api<PaginaNoFio>(page, "GET", `${PORTA_DA_PESQUISA}?busca=${c.tag}&armazem_id=${c.l1.id}&limite=50&pagina=1&com_saldo=true`);
  expect([doAdministrador.filtradoPorSaldo, doAdministrador.itens.map((i) => i.id)], "premissa: para quem vê o estoque, o pedido filtra").toEqual([true, [c.p1.id, c.p3.id]]);

  const marca = Date.now().toString(36);
  const credencial = { email: `vendedor.f3b.${marca}@e2e.local`, password: "Demo@12345" };
  const papel = await api<{ id: string }>(page, "POST", "/api/admin/roles", {
    name: `Vendedor sem estoque F3B ${marca}`, permissions: ["sales.view", "sales.create", "people.view", "products.view", "warehouses.view"]
  });
  await api(page, "POST", "/api/admin/members", {
    name: "Vendedor F3B E2E", email: credencial.email, password: credencial.password, role_id: papel.id,
    escopos_empresas: [{ modulo: "vendas", modo: "selecionadas", empresas: [c.empresa] }, { modulo: "estoque", modo: "selecionadas", empresas: [c.empresa] }]
  });
  let comoVendedor = false;
  try {
    await logout(page);
    await login(page, credencial);
    comoVendedor = true;
    const contexto = await api<{ isOwner: boolean; permissions: string[] }>(page, "GET", "/api/auth/context");
    expect([contexto.isOwner, contexto.permissions.includes("products.view"), contexto.permissions.includes("sales.create"), contexto.permissions.includes("stocks.view")],
      "premissa: não é dono, vê produto, lança venda e NÃO vê estoque").toEqual([false, true, true, false]);
    expect(await empresaAtiva(page), "premissa: a empresa da Central dele é a dos locais").toBe(c.empresa);

    const deAntes = ouvirPedidos(page, PORTA_DE_ANTES);
    await abrirCriacao(page, c.top);
    await escolherLocalDoCabecalho(page, c.l1.nome);
    await page.getByTestId("central-vendas-adicionar-item").click();
    await expect(linha(page, 0).getByTestId("central-vendas-armazem"), "premissa: a linha está em L1").toContainText(c.l1.nome);
    await linha(page, 0).getByTestId("central-vendas-produto").click();
    const painel = painelDePesquisa(page);
    await expect(painel, "a fonte é a pesquisa nova (a capacidade vale para todo membro)").toHaveAttribute("data-fonte", "pesquisa");
    const resposta = respostaDaBusca(page, c.tag);
    await painel.getByRole("combobox").fill(c.tag);
    const r = await resposta;

    // o fio: a tela PEDIU o filtro (é saída, com local na linha) — e o servidor o ignorou, sem saldo para ninguém
    const pedido = new URL(r.url()).searchParams;
    expect(comoObjeto(pedido), "o pedido leva com_saldo=true").toEqual({ busca: c.tag, armazem_id: c.l1.id, limite: "50", pagina: "1", com_saldo: "true" });
    const corpo = await r.json() as PaginaNoFio;
    expect([corpo.filtradoPorSaldo, corpo.estoqueDoArmazem], "o servidor ignorou o filtro e não mostra saldo").toEqual([false, false]);
    expect(corpo.itens.map((i) => [i.id, i.estoque]), "os três, nenhum some, estoque nulo em todos").toEqual([[c.p1.id, null], [c.p2.id, null], [c.p3.id, null]]);

    // a tela: os três, sem a coluna Estoque e sem o controle (lidos DEPOIS das opções na tela)
    await expect.poll(() => descricoes(painel), { message: "os três produtos (nenhum some)" }).toEqual([c.p1.nome, c.p2.nome, c.p3.nome]);
    await expect(painel.locator('[aria-hidden] > [data-coluna]'), "o cabeçalho da pesquisa sem Estoque").toHaveText(["Código", "Descrição"]);
    await expect(painel.locator('[data-coluna="estoque"]'), "nenhuma célula de estoque").toHaveCount(0);
    await expect(page.getByTestId("central-vendas-pesquisa-so-com-saldo"), "sem o controle 'Só com saldo neste local'").toHaveCount(0);
    expect(deAntes.map(String), "nenhum pedido à fonte de antes").toEqual([]);
    await page.keyboard.press("Escape");
    await expect(painel).toHaveCount(0);
  } finally {
    // de volta ao administrador: a limpeza dos cadastros do caso é pela sessão dele (o vendedor não exclui)
    if (comoVendedor) {
      await logout(page).catch(() => page.evaluate(() => localStorage.removeItem("agro.session")));
      await login(page);
    }
  }
});
