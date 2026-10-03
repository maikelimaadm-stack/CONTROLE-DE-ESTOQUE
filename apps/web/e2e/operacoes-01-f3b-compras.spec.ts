import type { Locator, Page, Request } from "@playwright/test";
import { LAYOUT_DO_SISTEMA, type EstruturaLayout } from "@agro/domain";
import { login, api, uniq, empresaAtiva } from "./helpers";
import { test, expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed } from "./central-compras-fixtures";

/**
 * OPERACOES-01 · F3b (decisão 280) — A CENTRAL DE COMPRAS: o LOCAL ANTES DO PRODUTO e a pesquisa de produto da ENTRADA,
 * com o saldo do local. Dois cenários, com a API e o banco REAIS (o detalhe da regra da pesquisa mora no teste de API
 * `apps/api/test/integration/operacoes-01-f3b-pesquisa.test.ts`, PS-1…PS-8):
 *
 *   · F3B-C1 — o "Local de estoque" do CABEÇALHO (`central-compras-local-padrao`, logo depois da Empresa) preenche a
 *     linha NOVA, não conta como alteração, volta ao padrão no Descartar e não vai no corpo; a pesquisa do produto da
 *     linha é a NOVA
 *     (`/api/produtos/pesquisa` com o local DA LINHA) e, na entrada, mostra TUDO com o saldo — P1 "5,0000", P2 "0,0000"
 *     e P3 (não controla estoque) —, sem o controle "Só com saldo neste local" e sem `com_saldo` no fio; ZERO pedido à
 *     pesquisa de antes (`/api/resources/products/options`). O POST é o de sempre, chave por chave
 *     (`CHAVES_DO_POST_PELA_TELA`/`CHAVES_DO_ITEM_PELA_TELA` de `central-compras-desenho-b.spec.ts`, CC-7), com
 *     `itens[0].armazem_id` = o local do cabeçalho, e o servidor grava (201). E o Descartar com o padrão de cadastro
 *     PREENCHIDO: numa TOP com layout ligado cujo local tem padrão (L1), o usuário escolhe L2 no cabeçalho, e o
 *     Descartar volta a L1 — o padrão, não o vazio nem a escolha — e a linha nova seguinte nasce com L1.
 *   · F3B-C2 — a CONSULTA: a grade começa por Local de estoque → Código → Produto, e o formulário de leitura traz o
 *     Local de estoque antes do Produto — cada coluna com o valor do servidor, não só o rótulo. As duas tabelas de
 *     estoque da compra também: a prévia do "Confirmar compra" (Local de estoque → Produto) e, confirmada, a relação
 *     "Entradas no estoque" (Data → Local de estoque → Produto).
 *
 * A PREMISSA da pesquisa nova é o que a API deste HEAD DECLARA (`GET /api/produtos/pesquisa/capacidades`); contra a API
 * anterior a Central usa a pesquisa de antes — o skew nos dois sentidos mora em `operacoes-01-f3b-skew-*.spec.ts`, fora
 * desta suíte. O saldo nasce pela porta de estoque inicial e é lido de volta no servidor. Cada caso cria os PRÓPRIOS
 * cadastros (TOP, fornecedor, local de estoque, produtos com um TAG único) e eles saem no fim, passou ou falhou
 * (`central-compras-fixtures.ts`); natureza e centro vêm do seed, pelo nome. Os documentos ficam (o ledger é imutável).
 */

const P = "central-compras";
const PORTA_DA_PESQUISA = "/api/produtos/pesquisa";
const PORTA_DE_ANTES = "/api/resources/products/options";
const LAYOUTS = "/api/admin/layouts-documento";
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const caminho = (r: Request) => new URL(r.url()).pathname;

/**
 * O corpo do POST que a tela produz preenchendo Fornecedor, Natureza, Centro e um item — as MESMAS listas do CC-7
 * (`central-compras-desenho-b.spec.ts`), copiadas porque um spec não importa outro (importaria os casos dele).
 */
const CHAVES_DO_POST_PELA_TELA = ["categoria_financeira_id", "centro_custo_id", "data_documento", "desconto", "empresa_id", "fornecedor_id", "frete", "itens", "outras_despesas", "tipo_operacao_id"];
const CHAVES_DO_ITEM_PELA_TELA = ["armazem_id", "produto_id", "quantidade", "valor_unitario"];

type Produto = { id: string; nome: string; codigo: string };
type Saldo = { quantity: string };

/** Escolhe no RefSelect de um campo dos Dados principais (o invólucro dado) pelo nome. */
async function escolherNoCampo(page: Page, campo: Locator, nome: string) {
  await campo.locator("button").first().click();
  const painel = page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nome.slice(0, 20));
  await painel.getByRole("option", { name: literal(nome.slice(0, 20)) }).first().click();
}
/** O campo dos Dados principais pelo rótulo (nome escapado: nomes do seed têm colchetes). */
const campoPeloRotulo = (page: Page, rotulo: string) => page.getByTestId("compras-central").locator("label", { hasText: rotulo }).first().locator("..");

/**
 * O cadastro do caso: a TOP de compra, o fornecedor, o local L1 e três produtos com o mesmo TAG (uma palavra única por
 * execução, a busca): P1 e P2 controlam estoque, P3 não. P1 tem 5 em L1 (estoque inicial); P2 nasce sem saldo.
 */
async function cenario(page: Page) {
  const ref = await referenciasDoSeed(page);
  const empresa = await empresaAtiva(page);
  const tag = `F3BC${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const local = await criarCadastro(page, "warehouses", {
    empresa_id: empresa, initials: `C${Date.now().toString(36).slice(-5).toUpperCase()}`, description: `${tag} local um`, type: "inputs"
  });
  const nomeDoLocal = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${local.id}`))["description"]);
  const produto = async (sufixo: string, controlaEstoque: boolean): Promise<Produto> => {
    const p = await criarCadastro(page, "products", {
      description: `${tag} ${sufixo}`, group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id, control_stock: controlaEstoque
    });
    const lido = await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${p.id}`);
    expect(lido["control_stock"], `premissa: ${sufixo} ${controlaEstoque ? "controla" : "não controla"} estoque`).toBe(controlaEstoque);
    return { id: p.id, nome: String(lido["description"]), codigo: String(lido["code"]) };
  };
  const p1 = await produto("P1", true);
  const p2 = await produto("P2", true);
  const p3 = await produto("P3", false);
  await api(page, "POST", "/api/stock/opening-balances", { empresa_id: empresa, warehouse_id: local.id, product_id: p1.id, quantity: "5", unit_value: "3" });
  const saldo = (p: Produto) => api<Saldo>(page, "GET", `/api/stock/balances/${local.id}/${p.id}`);
  expect((await saldo(p1)).quantity, "premissa: P1 tem 5 no local").toBe("5.0000");
  expect((await saldo(p2)).quantity, "premissa: P2 não tem saldo no local").toBe("0.0000");
  const forn = await criarCadastro(page, "people", { name: uniq("F3BC forn"), person_type: "legal", is_provider: true });
  const fornecedor = { id: forn.id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${forn.id}`))["name"]) };
  const top = await criarTop(page, { codigo: codigoTop("7"), codigoBase: "compras.compra", nome: uniq("Compra F3BC") });
  // a pesquisa NOVA só existe quando a API a declara (a anterior responde 404 de rota e a Central usa a de antes)
  expect(await api(page, "GET", `${PORTA_DA_PESQUISA}/capacidades`), "premissa: a API deste HEAD declara a pesquisa de produtos")
    .toEqual({ capacidades: { pesquisaDeProdutos: 1 } });
  return { tag, empresa, local: { id: local.id, nome: nomeDoLocal }, p1, p2, p3, fornecedor, top: top.id, natureza: ref.natureza, centro: ref.centro };
}

/** Registra os pedidos (GET) às duas fontes da pesquisa de produto enquanto o caso corre. */
function vigiarPesquisas(page: Page) {
  const nova: URL[] = [];
  const deAntes: URL[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === PORTA_DA_PESQUISA) nova.push(u);
    else if (u.pathname === PORTA_DE_ANTES) deAntes.push(u);
  });
  return { nova, deAntes };
}

test("F3B-C1 — compra: o Local de estoque do cabeçalho preenche a linha nova, fica fora do corpo e volta ao padrão no Descartar (vazio ou o do layout); a pesquisa da entrada mostra tudo com o saldo do local da linha, sem 'só com saldo'", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const fio = vigiarPesquisas(page);

  await page.goto(`/compras/compras/new?tipo_operacao_id=${c.top}`);
  const central = page.getByTestId("compras-central");
  await expect(central).toHaveAttribute("data-especie", "compra");
  const itens = page.getByTestId("compras-itens");
  // PREMISSA: a coluna do local está na grade, ANTES do Produto — é ela que faz o campo do cabeçalho existir
  await expect(itens.locator('thead th[data-campo="armazem_id"]'), "premissa: a grade tem a coluna do local").toHaveCount(1);
  const colunas = await itens.locator("thead th[data-campo]").evaluateAll((ths) => ths.map((th) => th.getAttribute("data-campo")));
  expect(colunas.indexOf("armazem_id"), "o Local de estoque vem antes do Produto na grade").toBe(colunas.indexOf("produto_id") - 1);

  // (1) O CAMPO DO CABEÇALHO: "Local de estoque", logo depois da Empresa, vazio (a TOP não tem padrão), com a dica.
  const localPadrao = page.getByTestId(`${P}-local-padrao`);
  await expect(localPadrao).toBeVisible();
  await expect(localPadrao.locator("label")).toHaveText(/^Local de estoque/);
  await expect(localPadrao.locator("[title]").first()).toHaveAttribute("title", "Local de estoque das linhas novas. Cada item pode trocar o seu.");
  expect(await localPadrao.getAttribute("data-campo"), "não é campo do layout (sem `data-campo`)").toBeNull();
  // o vizinho de cima na coluna dos Dados principais: o invólucro da Empresa (ou o `fieldset` que a trava, com ela dentro)
  const anterior = await localPadrao.evaluate((el) => {
    const a = el.previousElementSibling;
    return a?.getAttribute("data-campo") ?? a?.querySelector("[data-campo]")?.getAttribute("data-campo") ?? null;
  });
  expect(anterior, "logo depois da Empresa").toBe("empresa_id");
  await expect(localPadrao.locator("[data-preenchido]"), "premissa: sem padrão de cadastro, o campo nasce vazio").toHaveCount(0);
  await expect(page.getByTestId(`${P}-alterado`), "premissa: a criação abre sem alteração").toHaveCount(0);

  await escolherNoCampo(page, localPadrao, c.local.nome);
  await expect(localPadrao).toContainText(c.local.nome);
  await expect(localPadrao.locator("[data-preenchido]")).toHaveCount(1);
  await expect(page.getByTestId(`${P}-alterado`), "o local do cabeçalho é estado da tela: não conta como alteração").toHaveCount(0);

  // DESCARTAR volta o local do cabeçalho ao padrão (aqui, nenhum): a escolha não sobrevive ao descarte.
  await escolherNoCampo(page, campoPeloRotulo(page, "Fornecedor"), c.fornecedor.nome);
  await expect(page.getByTestId(`${P}-alterado`), "premissa: o Fornecedor é alteração").toBeVisible();
  await page.getByTestId(`${P}-descartar`).click();
  await page.getByTestId("confirm-dialog").getByRole("button", { name: "Descartar alterações", exact: true }).click();
  await expect(page.getByTestId(`${P}-alterado`)).toHaveCount(0);
  await expect(localPadrao.locator("[data-preenchido]"), "o Descartar volta o local do cabeçalho ao padrão (vazio)").toHaveCount(0);
  await expect(localPadrao).not.toContainText(c.local.nome);

  await escolherNoCampo(page, localPadrao, c.local.nome);
  await expect(localPadrao).toContainText(c.local.nome);
  await escolherNoCampo(page, campoPeloRotulo(page, "Fornecedor"), c.fornecedor.nome);
  await escolherNoCampo(page, campoPeloRotulo(page, "Natureza de despesa"), c.natureza.label);
  await escolherNoCampo(page, campoPeloRotulo(page, "Centro de resultado"), c.centro.label);

  // (2) A LINHA NOVA nasce com o local do cabeçalho.
  await page.getByTestId(`${P}-adicionar-item`).click();
  const linha = page.getByTestId(`${P}-linha`).first();
  await expect(page.getByTestId(`${P}-linha`)).toHaveCount(1);
  await expect(linha.getByTestId(`${P}-armazem`), "a linha nova nasce com o Local de estoque do cabeçalho").toContainText(c.local.nome);

  // (3) A PESQUISA DO PRODUTO da linha: a NOVA, com o saldo do local DA LINHA; na entrada aparece tudo.
  await linha.getByTestId(`${P}-produto`).click();
  const pesquisa = page.getByTestId(`${P}-pesquisa`);
  await expect(pesquisa).toBeVisible();
  await expect(pesquisa, "a fonte é a pesquisa nova (a API declarou)").toHaveAttribute("data-fonte", "pesquisa");
  const respostaDaBusca = page.waitForResponse((r) => {
    const u = new URL(r.url());
    return r.request().method() === "GET" && u.pathname === PORTA_DA_PESQUISA && u.searchParams.get("busca") === c.tag;
  });
  await pesquisa.getByPlaceholder("Pesquisar pela descrição").fill(c.tag);
  const resposta = await respostaDaBusca;
  expect(resposta.status()).toBe(200);
  expect(await resposta.json(), "o servidor respondeu os três, com o saldo do local e sem filtrar").toMatchObject({
    itens: [{ id: c.p1.id, estoque: "5.0000" }, { id: c.p2.id, estoque: "0.0000" }, { id: c.p3.id, estoque: "0.0000" }],
    estoqueDoArmazem: true, pagina: 1, temMais: false, filtradoPorSaldo: false
  });
  const opcoes = pesquisa.getByRole("option");
  await expect(opcoes.locator('[data-coluna="descricao"]'), "os três produtos do TAG, nenhum escondido").toHaveText([c.p1.nome, c.p2.nome, c.p3.nome]);
  await expect(opcoes.locator('[data-coluna="estoque"]'), "o saldo do local da linha em cada um").toHaveText(["5,0000", "0,0000", "0,0000"]);
  await expect(pesquisa.locator('[aria-hidden] [data-coluna]'), "o cabeçalho com a coluna Estoque").toHaveText(["Código", "Descrição", "Estoque"]);
  await expect(page.getByTestId(`${P}-pesquisa-so-com-saldo`), "na entrada não há 'Só com saldo neste local'").toHaveCount(0);
  await expect(page.getByTestId(`${P}-pesquisa-mais`), "uma página só").toHaveCount(0);

  // NO FIO: todo pedido da pesquisa leva o local DA LINHA, a página e o limite — e nunca `com_saldo` (entrada).
  expect(fio.nova.length, "premissa: a pesquisa nova foi pedida").toBeGreaterThan(0);
  for (const u of fio.nova) {
    expect(u.searchParams.get("armazem_id"), "o local da linha").toBe(c.local.id);
    expect([u.searchParams.get("pagina"), u.searchParams.get("limite")], "página 1 de 50").toEqual(["1", "50"]);
    expect(u.searchParams.has("com_saldo"), "a entrada não pede 'só com saldo'").toBe(false);
    expect(u.searchParams.has("controla_estoque"), "a compra aceita produto que não controla estoque").toBe(false);
  }
  expect(fio.nova.some((u) => u.searchParams.get("busca") === c.tag), "a busca digitada foi ao servidor").toBe(true);

  // (4) ESCOLHE P2 (sem saldo: a compra é entrada, o saldo não restringe nada).
  await opcoes.filter({ hasText: c.p2.nome }).click();
  await expect(pesquisa).toHaveCount(0);
  await expect(linha.getByTestId(`${P}-produto`)).toContainText(c.p2.nome);
  await expect(linha.getByTestId(`${P}-armazem`), "escolher o produto não mexe no local da linha").toContainText(c.local.nome);
  expect(fio.deAntes.map((u) => u.toString()), "ZERO pedido à pesquisa de antes").toEqual([]);
  await linha.getByLabel("Quantidade do item 1").fill("2");
  await linha.getByLabel("Valor unitário do item 1").fill("7");
  await expect(page.getByTestId(`${P}-subtotal`)).toContainText("14,00");

  // (5) SALVAR: o POST real, com as chaves de sempre; o local do cabeçalho só aparece DENTRO do item.
  const lancar = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r.request()) === "/api/compras/compras");
  await page.getByTestId("compras-salvar").click();
  const post = await lancar;
  expect(post.status(), "o servidor gravou").toBe(201);
  const corpo = post.request().postDataJSON() as Record<string, unknown> & { itens: Record<string, unknown>[] };
  expect(Object.keys(corpo).sort(), "as MESMAS chaves do POST de hoje (nenhuma chave de local no cabeçalho)").toEqual(CHAVES_DO_POST_PELA_TELA);
  expect(corpo.itens.map((i) => Object.keys(i).sort()), "as MESMAS chaves do item").toEqual([CHAVES_DO_ITEM_PELA_TELA]);
  expect(corpo.itens[0], "o item com o produto escolhido e o local do cabeçalho").toMatchObject({ produto_id: c.p2.id, armazem_id: c.local.id });
  expect(JSON.stringify(corpo).split(c.local.id).length - 1, "o id do local aparece UMA vez: no item").toBe(1);
  await expect(page).toHaveURL(/\/compras\/compras\/[0-9a-f-]{36}$/);
  const id = /\/compras\/compras\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
  const gravada = await api<{ itens: { produto_id: string; armazem_id: string }[] }>(page, "GET", `/api/compras/compras/${id}`);
  expect(gravada.itens.map((i) => [i.produto_id, i.armazem_id]), "o servidor gravou o item com o local da linha").toEqual([[c.p2.id, c.local.id]]);

  // (6) DESCARTAR COM O PADRÃO DE CADASTRO PREENCHIDO: outra TOP de compra, com um layout ligado (a cópia do do sistema)
  // cujo Local de estoque dos itens tem o padrão L1. O cabeçalho nasce em L1; o usuário escolhe L2; o Descartar volta
  // ao PADRÃO (L1) — não ao vazio, nem à escolha — e a linha nova seguinte nasce com L1.
  const outro = await criarCadastro(page, "warehouses", {
    empresa_id: c.empresa, initials: `D${Date.now().toString(36).slice(-5).toUpperCase()}`, description: `L2 ${c.tag}`, type: "inputs"
  });
  // o nome de L2 COMEÇA diferente do de L1 (a escolha pesquisa pelos 20 primeiros caracteres)
  const l2 = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${outro.id}`))["description"]);
  const topComPadrao = (await criarTop(page, { codigo: codigoTop("7"), codigoBase: "compras.compra", nome: uniq("Compra F3BC padrão") })).id;
  const estrutura: EstruturaLayout = structuredClone(LAYOUT_DO_SISTEMA("compras.compra"));
  expect(estrutura.itens.map((x) => x.campo), "premissa: o layout do sistema da compra tem o local nos itens").toContain("armazem_id");
  estrutura.itens = estrutura.itens.map((x) => (x.campo === "armazem_id" ? { ...x, valorPadrao: { tipo: "registro" as const, id: c.local.id } } : x));
  const layout = (await api<{ id: string }>(page, "POST", LAYOUTS, { familia: "compras.compra", nome: uniq("Layout F3BC padrão"), estrutura })).id;
  let layoutVivo = true;
  try {
    await api(page, "PUT", `${LAYOUTS}/${layout}/tops`, { tipoOperacaoIds: [topComPadrao] });
    const efetivo = await api<Record<string, unknown>>(page, "GET", `/api/compras/compras/layout-efetivo?tipo_operacao_id=${topComPadrao}`);
    expect(efetivo, "premissa: o layout está ligado e o padrão do local vale").toMatchObject({ origem: "ligado", id: layout, padroesDeCadastro: { "itens.armazem_id": { id: c.local.id } } });

    await page.goto(`/compras/compras/new?tipo_operacao_id=${topComPadrao}`);
    await expect(page.getByTestId("compras-layout-efetivo"), "premissa: a Central leu o layout ligado").toHaveAttribute("data-layout-id", layout);
    await expect(localPadrao, "o cabeçalho nasce no padrão de cadastro do layout").toContainText(c.local.nome);
    await expect(localPadrao.locator("[data-preenchido]")).toHaveCount(1);
    await escolherNoCampo(page, localPadrao, l2);
    await expect(localPadrao).toContainText(l2);
    await page.getByTestId(`${P}-adicionar-item`).click();
    await expect(page.getByTestId(`${P}-linha`)).toHaveCount(1);
    await expect(page.getByTestId(`${P}-linha`).first().getByTestId(`${P}-armazem`), "a linha nova nasce com a escolha (L2)").toContainText(l2);
    await expect(page.getByTestId(`${P}-alterado`), "premissa: a linha nova é alteração").toBeVisible();
    await page.getByTestId(`${P}-descartar`).click();
    await page.getByTestId("confirm-dialog").getByRole("button", { name: "Descartar alterações", exact: true }).click();
    await expect(page.getByTestId(`${P}-linha`), "descartado: sem linhas").toHaveCount(0);
    await expect(localPadrao, "o Descartar volta ao PADRÃO do layout (L1)").toContainText(c.local.nome);
    await expect(localPadrao).not.toContainText(l2);
    await page.getByTestId(`${P}-adicionar-item`).click();
    await expect(page.getByTestId(`${P}-linha`).first().getByTestId(`${P}-armazem`), "e a linha nova nasce com o padrão").toContainText(c.local.nome);
    // a limpeza que falha reprova o caso verde (excluir o layout desliga a TOP)
    await api(page, "DELETE", `${LAYOUTS}/${layout}`, {});
    layoutVivo = false;
  } finally {
    // o caso já falhou: a limpeza não mascara a falha
    if (layoutVivo) await api(page, "DELETE", `${LAYOUTS}/${layout}`, {}).catch(() => undefined);
  }
});

test("F3B-C2 — consulta da compra: a grade começa por Local de estoque → Código → Produto, o formulário de leitura traz o Local antes do Produto, e a prévia da confirmação e as entradas no estoque também", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const { id } = await api<{ id: string }>(page, "POST", "/api/compras/compras", {
    empresa_id: c.empresa, tipo_operacao_id: c.top, fornecedor_id: c.fornecedor.id, data_documento: "2026-09-01",
    categoria_financeira_id: c.natureza.id, centro_custo_id: c.centro.id,
    itens: [{ produto_id: c.p1.id, armazem_id: c.local.id, quantidade: "3", valor_unitario: "10.00" }]
  });
  const lida = await api<{ codigo: string; itens: { produto_id: string; armazem_id: string }[] }>(page, "GET", `/api/compras/compras/${id}`);
  expect(lida.itens.map((i) => [i.produto_id, i.armazem_id]), "premissa: a compra tem o item com o local").toEqual([[c.p1.id, c.local.id]]);

  await page.goto(`/compras/compras/${id}`);
  await expect(page.getByTestId(`${P}-identidade-nome`), "premissa: a tela desenhou ESTA compra").toHaveText(lida.codigo);

  // (1) A GRADE da consulta: o Local primeiro, colado ao Código e ao Produto — e cada coluna com o valor do servidor.
  const grade = page.getByTestId(`${P}-grade`);
  await expect(grade.locator("thead th")).toHaveText(["Local de estoque", "Código", "Produto", "Quantidade", "Valor unitário", "Desconto", "Desconto %", "Total", "Lote", "Validade"]);
  const linha = page.getByTestId(`${P}-linha`);
  await expect(linha).toHaveCount(1);
  await expect(linha.locator("td").nth(0), "o Local de estoque do item").toHaveText(c.local.nome);
  await expect(linha.locator("td").nth(1), "o Código do produto").toHaveText(c.p1.codigo);
  await expect(linha.locator("td").nth(2), "o Produto").toHaveText(c.p1.nome);

  // (2) O FORMULÁRIO DE LEITURA: o Local de estoque antes do Produto, cada um com o valor do item.
  await page.getByTestId(`${P}-itens`).getByRole("button", { name: "Formulário" }).click();
  const formulario = page.getByTestId(`${P}-item-form`);
  await expect(formulario).toBeVisible();
  const campos = await formulario.locator("[data-campo]").evaluateAll((els) => els.map((e) => e.getAttribute("data-campo")));
  expect(campos.slice(0, 2), "o Local de estoque vem antes do Produto").toEqual(["Local de estoque", "Produto"]);
  expect(campos, "os campos de leitura, na ordem").toEqual(["Local de estoque", "Produto", "Estoque", "Unidade", "Quantidade", "Valor unitário", "Desconto", "Desconto %", "Total", "Lote", "Validade"]);
  await expect(formulario.locator('[data-campo="Local de estoque"] [data-parte="valor"]')).toHaveText(c.local.nome);
  await expect(formulario.locator('[data-campo="Produto"] [data-parte="valor"]')).toHaveText(`${c.p1.codigo} · ${c.p1.nome}`);

  // (3) A PRÉVIA do "Confirmar compra": a entrada no estoque começa pelo Local de estoque, antes do Produto.
  await page.getByTestId("compras-confirmar").click();
  await expect(page.getByTestId("compras-previa")).toHaveAttribute("data-situacao", "pronta");
  const previa = page.getByTestId("compras-previa-estoque");
  await expect(previa, "premissa: a prévia prevê a entrada no estoque").toHaveAttribute("data-efeito", "entrada");
  await expect(previa.locator("thead th")).toHaveText(["Local de estoque", "Produto", "Lote", "Quantidade", "Valor de entrada", "Custo unitário"]);
  await expect(previa.locator("tbody tr")).toHaveCount(1);
  await expect(previa.locator("tbody tr td").nth(0), "o Local de estoque do item").toHaveText(c.local.nome);
  await expect(previa.locator("tbody tr td").nth(1), "o Produto").toHaveText(`${c.p1.codigo} - ${c.p1.nome}`);
  await page.getByTestId("confirm-dialog-confirm").click();

  // (4) CONFIRMADA, a relação "Entradas no estoque": Data → Local de estoque → Produto, com os valores do servidor.
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "confirmado");
  const confirmada = await api<{ movimentos: { warehouse_id: string; product_id: string }[] }>(page, "GET", `/api/compras/compras/${id}`);
  expect(confirmada.movimentos.map((m) => [m.warehouse_id, m.product_id]), "premissa: uma entrada, no local do item").toEqual([[c.local.id, c.p1.id]]);
  await page.getByRole("tab", { name: /^Estoque/ }).click();
  const movimentos = page.getByTestId("compras-consulta-movimentos");
  await expect(movimentos.getByRole("columnheader")).toHaveText(["Data", "Local de estoque", "Produto", "Movimento", "Quantidade", "Custo unitário", "Custo total"]);
  const entrada = movimentos.getByTestId("base2-items-linha");
  await expect(entrada).toHaveCount(1);
  await expect(entrada.getByRole("cell").nth(1), "o Local de estoque da entrada").toHaveText(c.local.nome);
  await expect(entrada.getByRole("cell").nth(2), "o Produto da entrada").toHaveText(c.p1.nome);
});
