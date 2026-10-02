import { test, expect, type Page, type Locator } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { LAYOUT_DO_SISTEMA } from "@agro/domain";
import { login, api, uniq, empresaAtiva } from "./helpers";

/**
 * CENTRAL DE COMPRAS NO MOTOR DA CENTRAL (VISUAL-UX-04, docs/DECISIONS.md 276) — parte C: CC-11 a CC-14 (e CC-14a).
 *
 * ┌─ O QUE ESTE ARQUIVO PROVA ─────────────────────────────────────────────────────────────────────┐
 * │ CC-11 a consulta: abas (Totais com o total do SERVIDOR, Financeiro com as contas a pagar e o     │
 * │       contador, Estoque, Fiscal quando o layout não põe a nota nos Dados, Compras geradas no     │
 * │       pedido) e Dados adicionais com Movimento, Versão da TOP e Origem.                          │
 * │ CC-12 Ampliar e restaurar as três regiões, nada persiste; aba alterada avisa ao fechar.          │
 * │ CC-13 esqueleto com a leitura atrasada (5 barras de 34 px); reduced-motion sem animação.         │
 * │ CC-14a SEM ROLAGEM HORIZONTAL, sempre na suíte: a Central de Compras nos 13 estados do CC-14,    │
 * │        em 1440×900 e 1280×720, sem fotos — na página e na área de trabalho (onde rola),          │
 * │        com a premissa de que a Central está montada.                                             │
 * │ CC-14 evidência: pares Venda × Compra pelos MESMOS estados e tamanhos, com a mesma medida — só   │
 * │       com EVIDENCIA_DIR (o molde do VD-13): 52 fotos não rodam na suíte padrão.                  │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Toda fixture é criada pela API neste arquivo (fornecedor, cliente, armazém, TOP, produto, compra, pedido, venda) e
 * conferida no servidor — nenhuma é "a primeira da lista". Nada depende de contagem global nem do que outro spec deixou.
 */

const P = "central-compras";
const PV = "central-vendas";
const ESQUELETO = { barra: 34, quantas: 5 } as const;

/* ═════════════════════════════════════════════ fixtures ═════════════════════════════════════════════ */

type Opcao = { id: string; label: string };
const codigoTop = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function cadastrarTop(page: Page, codigoBase: "compras.compra" | "compras.pedido" | "vendas.venda", extra: Record<string, unknown> = {}) {
  const prefixo = { "compras.compra": "7", "compras.pedido": "5", "vendas.venda": "8" }[codigoBase];
  const codigo = codigoTop(prefixo);
  const nome = uniq({ "compras.compra": "Compra CC-C", "compras.pedido": "Pedido CC-C", "vendas.venda": "Venda CC-C" }[codigoBase]);
  const criado = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase, nome, ...extra });
  return { id: criado.id, codigo, nome };
}

async function cenario(page: Page) {
  const empresa = await empresaAtiva(page);
  const fornecedor = (await api<{ id: string }>(page, "POST", "/api/resources/people", { name: uniq("CC-C forn"), person_type: "legal", is_provider: true })).id;
  const armazem = (await api<{ id: string }>(page, "POST", "/api/resources/warehouses", {
    empresa_id: empresa, initials: `C${Date.now().toString(36).slice(-4).toUpperCase()}`, description: uniq("CC-C arm"), type: "inputs"
  })).id;
  const naturezas = await api<Opcao[]>(page, "GET", "/api/resources/financial_categories/options?kind=analytic&nature=expense");
  const centros = await api<Opcao[]>(page, "GET", "/api/resources/cost_centers/options?kind=analytic");
  const grupos = await api<Opcao[]>(page, "GET", "/api/resources/product_groups/options?kind=analytic");
  const un = (await api<Opcao[]>(page, "GET", "/api/resources/measurement_units/options")).find((u) => u.label.toUpperCase() === "UN");
  expect(naturezas.length && centros.length && grupos.length && un, "premissa: natureza, centro, grupo e unidade UN no seed").toBeTruthy();
  const produto = await api<{ id: string }>(page, "POST", "/api/resources/products", {
    description: uniq("CC-C produto"), group_id: grupos[0]!.id, measurement_id: un!.id, financial_category_id: naturezas[0]!.id
  });
  const topCompra = await cadastrarTop(page, "compras.compra");
  const topPedido = await cadastrarTop(page, "compras.pedido", { destinos: [{ tipoOperacaoId: topCompra.id, ordem: 0, emPartes: true }] });
  return { empresa, fornecedor, armazem, natureza: naturezas[0]!, centro: centros[0]!, grupo: grupos[0]!.id, unidade: un!.id, produto: produto.id, topCompra, topPedido };
}
type Cenario = Awaited<ReturnType<typeof cenario>>;

type Detalhe = Record<string, unknown> & { codigo: string; situacao: string; valor_total: string; titulos: { id: string }[]; movimentos: unknown[]; compras_geradas?: { id: string; codigo: string }[] };
const ler = (page: Page, segmento: "compras" | "pedidos", id: string) => api<Detalhe>(page, "GET", `/api/compras/${segmento}/${id}`);

async function compraPelaApi(page: Page, c: Cenario, extra: Record<string, unknown> = {}) {
  const { id } = await api<{ id: string }>(page, "POST", "/api/compras/compras", {
    empresa_id: c.empresa, tipo_operacao_id: c.topCompra.id, fornecedor_id: c.fornecedor, data_documento: "2026-09-01",
    categoria_financeira_id: c.natureza.id, centro_custo_id: c.centro.id, frete: "7.00",
    itens: [{ produto_id: c.produto, armazem_id: c.armazem, quantidade: "3", valor_unitario: "10.00" }], ...extra
  });
  return { id, ...(await ler(page, "compras", id)) };
}

async function pedidoPelaApi(page: Page, c: Cenario) {
  const { id } = await api<{ id: string }>(page, "POST", "/api/compras/pedidos", {
    empresa_id: c.empresa, tipo_operacao_id: c.topPedido.id, fornecedor_id: c.fornecedor, data_documento: "2026-09-01",
    categoria_financeira_id: c.natureza.id, centro_custo_id: c.centro.id,
    itens: [{ produto_id: c.produto, quantidade: "10", valor_unitario: "20.00" }]
  });
  const lido = await ler(page, "pedidos", id);
  return { id, codigo: lido.codigo, itemId: (lido["itens"] as { id: string }[])[0]!.id };
}

/** O lado da VENDA do CC-14: cliente e produto (sem controle de estoque, item sem armazém) CRIADOS aqui. */
async function ladoDaVenda(page: Page, c: Cenario) {
  const cliente = (await api<{ id: string }>(page, "POST", "/api/resources/people", { name: uniq("CC-C cliente"), person_type: "legal", is_client: true })).id;
  const produto = (await api<{ id: string }>(page, "POST", "/api/resources/products", {
    description: uniq("CC-C produto venda"), group_id: c.grupo, measurement_id: c.unidade, financial_category_id: c.natureza.id, control_stock: false
  })).id;
  return { cliente, produto };
}
async function vendaPelaApi(page: Page, c: Cenario, v: { cliente: string; produto: string }, extra: Record<string, unknown> = {}) {
  const { id } = await api<{ id: string }>(page, "POST", "/api/sales/sales", {
    empresa_id: c.empresa, document_date: "2026-09-01", client_id: v.cliente,
    items: [{ product_id: v.produto, warehouse_id: null, quantity: "2", unit_price: "10.00" }], ...extra
  });
  const d = await api<{ code: string }>(page, "GET", `/api/sales/sales/${id}`);
  expect(d.code, "premissa: a venda tem código").toBeTruthy();
  return { id, codigo: d.code };
}

/* ═════════════════════════════════════════════ tela ═════════════════════════════════════════════ */

async function abrirConsulta(page: Page, doc: { id: string; codigo: string }, segmento: "compras" | "pedidos" = "compras") {
  await page.goto(`/compras/${segmento}/${doc.id}`);
  await expect(page.getByTestId(P)).toBeVisible();
  await expect(page.getByTestId(`${P}-identidade-nome`), "premissa: a tela desenhou ESTE documento").toHaveText(doc.codigo);
}

async function abrirAba(page: Page, prefixo: string, nome: string | RegExp) {
  const aba = page.getByTestId(`${prefixo}-painel`).getByRole("tab", { name: nome });
  await aba.click();
  await expect(aba).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId(`${prefixo}-painel`).getByRole("tabpanel")).toBeVisible();
}

async function abrirDadosAdicionais(page: Page) {
  const grupo = page.getByTestId(`${P}-dados`).getByRole("button", { name: /^Dados adicionais/ });
  await expect(grupo, "o grupo Dados adicionais existe na consulta").toBeVisible();
  if ((await grupo.getAttribute("aria-expanded")) !== "true") await grupo.click();
  await expect(grupo).toHaveAttribute("aria-expanded", "true");
}

/** Abre o leque de Ações rápidas (se fechado) e devolve o item. */
async function itemDoLeque(page: Page, prefixo: string, testId: string) {
  const leque = page.getByTestId(`${prefixo}-acoes-rapidas`);
  if ((await leque.getAttribute("aria-expanded")) !== "true") {
    await expect(page.getByTestId(testId), "o leque anterior terminou de recolher").toHaveCount(0);
    await leque.click();
  }
  await expect(leque).toHaveAttribute("aria-expanded", "true");
  const item = page.getByTestId(testId);
  await expect(item).toBeVisible();
  return item;
}

const chavesDoNavegador = (page: Page) => page.evaluate(() => ({ local: Object.keys(localStorage).sort(), sessao: Object.keys(sessionStorage).sort() }));
const reais = (v: string) => Number(v).toFixed(2).replace(".", ",");
const campo = (escopo: Locator, rotulo: string) => escopo.locator(`[data-campo="${rotulo}"]`);

/* ═════════════════════════════════════════════ CC-11 consulta ═════════════════════════════════════════════ */

test("CC-11 — consulta: Totais com o total do servidor, Financeiro com as contas a pagar e o contador, Estoque, Fiscal, Compras geradas no pedido; Dados adicionais com Movimento, Versão e Origem", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const antes = await chavesDoNavegador(page);

  // COMPRA CONFIRMADA: títulos e entradas no estoque existem no servidor
  const nota = uniq("NF-CC11").replace(/\s+/g, "");
  const compra = await compraPelaApi(page, c, { numero_nota: nota, serie_nota: "7" });
  await api(page, "POST", `/api/compras/compras/${compra.id}/confirm`, {});
  const lida = await ler(page, "compras", compra.id);
  expect(lida.situacao, "premissa: a compra foi confirmada").not.toBe("aberto");
  expect(lida.titulos.length, "premissa: a confirmação gerou contas a pagar").toBeGreaterThan(0);
  expect(lida.movimentos.length, "premissa: a confirmação gerou entradas no estoque").toBeGreaterThan(0);
  await abrirConsulta(page, { id: compra.id, codigo: lida.codigo });

  const painel = page.getByTestId(`${P}-painel`);
  const nomes = (await painel.getByRole("tab").allInnerTexts()).map((n) => n.replace(/\d+/g, "").trim());
  const dados = page.getByTestId(`${P}-dados`);
  // Fiscal só é aba quando o layout NÃO põe nota, série e entrada nos Dados. O ramo esperado vem do LAYOUT (a consulta
  // desenha pelo layout do sistema da compra), nunca do que a tela mostrou — senão a tela errada escolheria o próprio
  // gabarito. Hoje o layout do sistema põe os três nos Dados: sem aba Fiscal, a nota nos Dados.
  const cabecalhoDoSistema = LAYOUT_DO_SISTEMA("compras.compra").cabecalho.map((x) => x.campo);
  const fiscalNaAba = ["numero_nota", "serie_nota", "data_entrada"].some((campo) => !cabecalhoDoSistema.includes(campo));
  expect(fiscalNaAba, "premissa: o layout do sistema da compra põe nota, série e entrada nos Dados").toBe(false);
  expect(nomes, "as abas da consulta da compra").toEqual(["Totais", "Financeiro", "Frete e transporte", "Estoque", "Observações"]);

  // TOTAIS: o total do SERVIDOR, campo travado
  await abrirAba(page, P, "Totais");
  await expect(page.getByTestId(`${P}-total`)).toContainText(reais(lida.valor_total));
  await expect(page.getByTestId("compras-consulta-total"), "o testid de antes no elemento equivalente").toBeVisible();

  // FINANCEIRO: contador = títulos do servidor; link para a conta a pagar
  await expect(painel.getByRole("tab", { name: /Financeiro/ }), "o contador de contas a pagar").toContainText(String(lida.titulos.length));
  await abrirAba(page, P, /Financeiro/);
  const fin = painel.getByRole("tabpanel");
  await expect(fin.locator(`a[href="/financeiro/contas-a-pagar/${lida.titulos[0]!.id}"]`)).toBeVisible();
  await expect(fin.locator("input:not([type=hidden]):enabled, select:enabled, textarea:enabled"), "nada editável no plano da consulta").toHaveCount(0);

  // ESTOQUE: as entradas do servidor, com contador
  await expect(painel.getByRole("tab", { name: /Estoque/ })).toContainText(String(lida.movimentos.length));
  await abrirAba(page, P, /Estoque/);
  await expect(page.getByTestId("compras-consulta-movimentos")).toBeVisible();
  await expect(page.getByTestId("compras-consulta-movimentos").getByTestId("base2-items-linha"), "uma linha por entrada do servidor").toHaveCount(lida.movimentos.length);

  // FISCAL: com nota, série e entrada nos Dados (o layout acima), a nota aparece nos Dados e não há aba Fiscal
  await expect(dados, "nota nos Dados, onde o layout a põe").toContainText(nota);
  await expect(painel.getByRole("tab", { name: "Fiscal" }), "e nenhuma aba Fiscal a repete").toHaveCount(0);

  // DADOS ADICIONAIS: Movimento, Versão da TOP, Origem "Lançamento direto"
  await abrirDadosAdicionais(page);
  await expect(campo(dados, "Movimento")).not.toBeEmpty();
  await expect(campo(dados, "Versão da TOP")).toContainText("1");
  await expect(campo(dados, "Origem")).toContainText("Lançamento direto");

  // PEDIDO: Compras geradas com o link; a compra gerada mostra a Origem com link para o pedido
  const pedido = await pedidoPelaApi(page, c);
  const gerada = await api<{ id: string }>(page, "POST", `/api/compras/pedidos/${pedido.id}/convert`, {
    tipo_operacao_id: c.topCompra.id, data_documento: "2026-09-02", categoria_financeira_id: c.natureza.id, centro_custo_id: c.centro.id,
    itens: [{ item_origem_id: pedido.itemId, armazem_id: c.armazem, quantidade: "4", valor_unitario: "20.00" }]
  });
  const doPedido = await ler(page, "pedidos", pedido.id);
  expect((doPedido.compras_geradas ?? []).map((g) => g.id), "premissa: o servidor declara a compra gerada").toEqual([gerada.id]);
  await abrirConsulta(page, pedido, "pedidos");
  const nomesDoPedido = (await painel.getByRole("tab").allInnerTexts()).map((n) => n.replace(/\d+/g, "").trim());
  expect(nomesDoPedido, "as abas da consulta do pedido").toEqual(["Totais", "Financeiro", "Frete e transporte", "Compras geradas", "Observações"]);
  await expect(page.getByTestId(`${P}-total`)).toContainText(reais(doPedido.valor_total));
  await expect(painel.getByRole("tab", { name: /Compras geradas/ })).toContainText("1");
  await abrirAba(page, P, /Compras geradas/);
  const link = page.getByTestId("compras-gerada");
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute("href", new RegExp(`/compras/compras/${gerada.id}$`));
  await expect(link).toHaveText(doPedido.compras_geradas![0]!.codigo);

  const lidaGerada = await ler(page, "compras", gerada.id);
  await abrirConsulta(page, { id: gerada.id, codigo: lidaGerada.codigo });
  await abrirDadosAdicionais(page);
  const origem = page.getByTestId("compras-origem");
  await expect(origem).toHaveAttribute("href", new RegExp(`/compras/pedidos/${pedido.id}$`));
  await expect(origem).toContainText(pedido.codigo);
  expect(await chavesDoNavegador(page), "a consulta não escreve no navegador").toEqual(antes);
});

/* ═════════════════════════════════════════════ CC-12 ampliar e aba alterada ═════════════════════════════════════════════ */

test("CC-12 — Ampliar e restaurar as três regiões; Dados em duas colunas; nada persiste; aba alterada avisa ao fechar", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const compra = await compraPelaApi(page, c);
  const antes = await chavesDoNavegador(page);
  await abrirConsulta(page, compra);
  const ws = page.getByTestId(P);
  const regioes = { dados: `${P}-dados`, itens: `${P}-itens`, painel: `${P}-painel` } as const;
  for (const [regiao, testId] of Object.entries(regioes) as [keyof typeof regioes, string][]) {
    const botao = page.getByTestId(`${P}-ampliar-${regiao}`);
    await expect(botao).toHaveAccessibleName(/^Ampliar/);
    await botao.click();
    await expect(ws).toHaveAttribute("data-ampliado", regiao);
    await expect(page.getByTestId(testId), `${regiao} ampliado continua visível`).toBeVisible();
    for (const [outra, outroId] of Object.entries(regioes)) if (outra !== regiao) await expect(page.getByTestId(outroId), `ampliar ${regiao} esconde ${outra}`).toBeHidden();
    if (regiao === "dados") {
      const xs = await page.getByTestId(`${P}-dados`).locator("[data-campo]").evaluateAll((els) => [...new Set(els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => Math.round(e.getBoundingClientRect().left)))]);
      expect(xs.length, "Dados ampliado: campos em duas colunas").toBeGreaterThanOrEqual(2);
    }
    await expect(botao).toHaveAccessibleName("Restaurar layout");
    await botao.click();
    await expect(ws).not.toHaveAttribute("data-ampliado", /.+/);
    for (const id of Object.values(regioes)) await expect(page.getByTestId(id)).toBeVisible();
  }
  await page.getByTestId(`${P}-ampliar-painel`).click();
  await expect(ws).toHaveAttribute("data-ampliado", "painel");
  expect(await chavesDoNavegador(page), "ampliar não deixa rastro no navegador").toEqual(antes);
  await page.reload();
  await expect(page.getByTestId(`${P}-identidade-nome`)).toHaveText(compra.codigo);
  await expect(page.getByTestId(P), "remontar volta ao normal").not.toHaveAttribute("data-ampliado", /.+/);

  // ABA ALTERADA: a criação com algo digitado avisa ao fechar a aba do espaço de trabalho (useDirtyTab)
  await page.goto(`/compras/compras/new?tipo_operacao_id=${c.topCompra.id}`);
  await expect(page.getByTestId("compras-top-travada"), "a criação montou com a TOP").toBeVisible();
  await abrirAba(page, P, "Observações");
  await page.getByTestId("compras-observacao").fill("rascunho que não pode sumir calado");
  await expect(page.getByTestId(`${P}-alterado`)).toBeVisible();
  const aba = page.getByTestId("workspace-tabs").locator('[role="tab"][aria-selected="true"]');
  const abaDoLancamento = page.getByTestId("workspace-tab").filter({ has: page.getByLabel("Alterações não salvas") });
  await expect(abaDoLancamento, "a aba do espaço de trabalho marca a alteração").toHaveCount(1);
  await abaDoLancamento.getByRole("button", { name: /Fechar aba/ }).click();
  const dlg = page.getByTestId("confirm-dialog");
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole("heading", { name: /^Fechar .+\?$/ })).toBeVisible();
  await expect(dlg).toContainText("Existem alterações não salvas. Ao fechar, elas serão descartadas.");
  await dlg.getByRole("button", { name: "Continuar editando", exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(abaDoLancamento, "continuar editando mantém a aba").toHaveCount(1);
  await expect(page.getByTestId("compras-observacao"), "e o que foi digitado").toHaveValue("rascunho que não pode sumir calado");
  await abaDoLancamento.getByRole("button", { name: /Fechar aba/ }).click();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(abaDoLancamento, "confirmar fecha a aba").toHaveCount(0);
  await expect(aba).toBeVisible();
});

/* ═════════════════════════════════════════════ CC-13 esqueleto ═════════════════════════════════════════════ */

test("CC-13 — esqueleto com a leitura atrasada: cinco barras de 34 px com brilho; reduced-motion sem animação", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const compra = await compraPelaApi(page, c);
  for (const movimento of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion: movimento });
    let soltar!: () => void;
    const segura = new Promise<void>((ok) => { soltar = ok; });
    await page.route(`**/api/compras/compras/${compra.id}`, async (rota) => { if (rota.request().method() === "GET") await segura; await rota.continue(); });
    await page.goto(`/compras/compras/${compra.id}`);
    const esqueleto = page.getByTestId(`${P}-esqueleto`);
    await expect(esqueleto, "a leitura pendente monta a Central com o esqueleto").toBeVisible();
    const barras = await esqueleto.evaluate((raiz, alt) => [...raiz.querySelectorAll<HTMLElement>("*")]
      .filter((el) => Math.round(el.getBoundingClientRect().height) === alt)
      .map((el) => ({ animacao: getComputedStyle(el).animationName, duracao: getComputedStyle(el).animationDuration })), ESQUELETO.barra);
    expect(barras.length, "cinco barras de 34 px").toBe(ESQUELETO.quantas);
    if (movimento === "reduce") expect(barras.every((b) => b.animacao === "none" || parseFloat(b.duracao) === 0), "reduced-motion: sem animação").toBe(true);
    else expect(barras.some((b) => b.animacao !== "none" && parseFloat(b.duracao) > 0), "sem a preferência, há brilho — senão o caso acima seria vazio").toBe(true);
    soltar();
    await expect(page.getByTestId(`${P}-identidade-nome`)).toHaveText(compra.codigo);
    await expect(esqueleto).toHaveCount(0);
    await page.unroute(`**/api/compras/compras/${compra.id}`);
  }
});

/* ═════════════════════════════════════════════ CC-14 sem rolagem e evidência ═════════════════════════════════════════════ */

const TAMANHOS = [[1440, 900], [1280, 720]] as const;

type Lado = {
  lado: "venda" | "compra"; prefixo: string; aberto: { id: string; codigo: string }; confirmado: { id: string; codigo: string };
  rotaCriacao: string; rotaConsulta: (id: string) => string; rotaLeitura: (id: string) => string;
  observacao: () => Locator; confirmar: string; abas: readonly string[];
};

/** O lado da COMPRA dos dois casos: uma compra aberta e uma confirmada, pela API, com a premissa conferida no servidor. */
async function ladoDaCompra(page: Page, c: Cenario): Promise<Lado> {
  const compra = await compraPelaApi(page, c);
  const compraConfirmada = await compraPelaApi(page, c);
  await api(page, "POST", `/api/compras/compras/${compraConfirmada.id}/confirm`, {});
  expect((await ler(page, "compras", compraConfirmada.id)).situacao, "premissa: a compra confirmada").not.toBe("aberto");
  return {
    lado: "compra", prefixo: P, aberto: compra, confirmado: compraConfirmada,
    rotaCriacao: `/compras/compras/new?tipo_operacao_id=${c.topCompra.id}`, rotaConsulta: (id) => `/compras/compras/${id}`, rotaLeitura: (id) => `**/api/compras/compras/${id}`,
    observacao: () => page.getByTestId("compras-observacao"), confirmar: "Confirmar compra", abas: ["Totais", "Financeiro", "Frete e transporte"]
  };
}

/**
 * OS ESTADOS DO CC-14, na ordem — os MESMOS para o CC-14a (sem fotos) e o CC-14 (com fotos): `cena` é chamada com a
 * tela parada em cada um (13 por lado e por tamanho).
 */
async function percorrerEstados(page: Page, l: Lado, cena: (nome: string) => Promise<void>) {
  const consulta = async (doc: { id: string; codigo: string }) => {
    await page.goto(l.rotaConsulta(doc.id));
    await expect(page.getByTestId(`${l.prefixo}-identidade-nome`), `${l.lado}: a tela desenhou ESTE documento`).toHaveText(doc.codigo);
  };
  // criação
  await page.goto(l.rotaCriacao);
  await expect(page.getByTestId(l.prefixo)).toBeVisible();
  await expect(page.getByTestId(`${l.prefixo}-descartar`)).toBeVisible();
  await cena("novo-documento");
  await abrirAba(page, l.prefixo, "Observações");
  await l.observacao().fill("rascunho da evidência");
  await page.getByTestId(`${l.prefixo}-descartar`).click();
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  await cena("descartando");
  await page.getByTestId("confirm-dialog").getByRole("button", { name: "Descartar alterações", exact: true }).click();
  await expect(page.getByTestId(`${l.prefixo}-alterado`), "descartado: nada sujo antes de sair").toHaveCount(0);
  // consulta
  await consulta(l.aberto);
  await cena("view-documento");
  for (const aba of l.abas) { await abrirAba(page, l.prefixo, aba); await cena(aba === "Frete e transporte" ? "frete" : aba.toLowerCase()); }
  await abrirAba(page, l.prefixo, "Financeiro");
  await page.getByTestId(`${l.prefixo}-ampliar-painel`).click();
  await cena("financeiro-ampliado");
  await page.getByTestId(`${l.prefixo}-ampliar-painel`).click();
  await page.getByTestId(`${l.prefixo}-divisor-horizontal`).focus(); await page.keyboard.press("Home");
  await cena("painel-estreito");
  await page.keyboard.press("End");
  await cena("painel-largo");
  await page.getByTestId(`${l.prefixo}-acoes`).getByRole("button", { name: l.confirmar }).click();
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  await cena("confirmando");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
  await (await itemDoLeque(page, l.prefixo, `${l.prefixo}-documentos`)).click();
  await expect(page.getByTestId(`${l.prefixo}-documentos-lista`)).toBeVisible();
  await cena("multi-view");
  await page.keyboard.press("Escape");
  await consulta(l.confirmado);
  await cena("confirmado");
  // carregando: a leitura do documento fica segura no fio
  let soltar!: () => void;
  const segura = new Promise<void>((ok) => { soltar = ok; });
  await page.route(l.rotaLeitura(l.aberto.id), async (rota) => { if (rota.request().method() === "GET") await segura; await rota.continue(); });
  await page.goto(l.rotaConsulta(l.aberto.id));
  await expect(page.getByTestId(`${l.prefixo}-esqueleto`)).toBeVisible();
  await cena("carregando");
  soltar();
  await expect(page.getByTestId(`${l.prefixo}-identidade-nome`)).toHaveText(l.aberto.codigo);
  await page.unroute(l.rotaLeitura(l.aberto.id));
}

/**
 * SEM ROLAGEM HORIZONTAL, com a PREMISSA de que a Central está montada na área de trabalho. Mede o critério de antes (a
 * página: `documentElement`) E a área de trabalho (`active-workspace`): a casca do app tem a altura da janela e
 * `overflow-hidden`, e o conteúdo rola DENTRO da área (`overflow-auto`) — uma Central larga demais rola ali, e a página,
 * sozinha, continuaria sem rolagem (verde que não prova nada).
 */
async function semRolagemHorizontal(page: Page, l: Lado, rotulo: string) {
  await expect(page.getByTestId("active-workspace").getByTestId(l.prefixo), `premissa: ${rotulo} — a Central está montada na área de trabalho`).toBeVisible();
  const medida = await page.evaluate(() => {
    const raiz = document.documentElement;
    const area = document.querySelector<HTMLElement>('[data-testid="active-workspace"]');
    return { pagina: raiz.scrollWidth - raiz.clientWidth, area: area ? area.scrollWidth - area.clientWidth : null };
  });
  expect(medida.area, `premissa: ${rotulo} — a área de trabalho existe`).not.toBeNull();
  expect(medida.pagina, `${rotulo}: rolagem horizontal na página`).toBeLessThanOrEqual(0);
  expect(medida.area!, `${rotulo}: rolagem horizontal na área de trabalho`).toBeLessThanOrEqual(0);
}

/**
 * CC-14a — A PROVA DE "SEM ROLAGEM HORIZONTAL" DA CENTRAL DE COMPRAS, SEMPRE NA SUÍTE: os MESMOS estados do CC-14 (lado
 * da compra), em 1440×900 e 1280×720, sem fotos. O CC-14 grava a evidência e só roda com EVIDENCIA_DIR; esta prova não
 * pode depender dele.
 */
test("CC-14a — sem rolagem horizontal: a Central de Compras em todos os estados do CC-14, em 1440×900 e 1280×720 (sem fotos)", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const l = await ladoDaCompra(page, c);
  const medidas: string[] = [];
  for (const [w, h] of TAMANHOS) {
    await page.setViewportSize({ width: w, height: h });
    await percorrerEstados(page, l, async (nome) => {
      await semRolagemHorizontal(page, l, `${nome} (compra, ${w}×${h})`);
      medidas.push(`${nome}@${w}x${h}`);
    });
  }
  expect(medidas.length, "13 estados × 2 tamanhos: nenhum ficou sem medida").toBe(13 * 2);
});

/**
 * PARES VENDA × COMPRA por estado, em 1440×900 e 1280×720: `<cena>__venda__<w>x<h>.png` ao lado de
 * `<cena>__compra__<w>x<h>.png`, na pasta EVIDENCIA_DIR (fora do commit). O MOLDE DO VD-13 (central-vendas-desenho):
 * sem EVIDENCIA_DIR o caso é pulado, com anotação — 52 fotos em até 300 s não são prova de regra e não rodam na suíte
 * padrão; quem grava a evidência informa a pasta. A prova "sem rolagem horizontal" da compra que roda SEMPRE é o CC-14a.
 */
test("CC-14 — evidência: pares Venda × Compra por estado em 1440×900 e 1280×720, sem rolagem horizontal", async ({ page }, info) => {
  const pasta = process.env.EVIDENCIA_DIR;
  test.skip(!pasta, "EVIDENCIA_DIR não definido: a evidência visual só é gravada quando a pasta é informada");
  test.setTimeout(300_000);
  fs.mkdirSync(pasta!, { recursive: true });
  await login(page);
  const c = await cenario(page);
  const topVenda = await cadastrarTop(page, "vendas.venda");
  const v = await ladoDaVenda(page, c);
  const venda = await vendaPelaApi(page, c, v, { tipo_operacao_id: topVenda.id, installment_plan: { installments: 2, first_due_date: "2026-10-15", mode: "interval", interval_days: 30 } });
  const vendaConfirmada = await vendaPelaApi(page, c, v, { tipo_operacao_id: topVenda.id });
  await api(page, "POST", `/api/sales/sales/${vendaConfirmada.id}/confirm`, {});
  const lados: Lado[] = [
    {
      lado: "venda", prefixo: PV, aberto: venda, confirmado: vendaConfirmada,
      rotaCriacao: `/vendas/sales/new?tipo_operacao_id=${topVenda.id}`, rotaConsulta: (id) => `/vendas/sales/${id}`, rotaLeitura: (id) => `**/api/sales/sales/${id}`,
      observacao: () => page.getByTestId(`${PV}-painel`).getByLabel("Observação"), confirmar: "Confirmar venda", abas: ["Totais", "Financeiro", "Frete e transporte"]
    },
    await ladoDaCompra(page, c)
  ];

  const fotos: string[] = [];
  for (const [w, h] of TAMANHOS) {
    await page.setViewportSize({ width: w, height: h });
    for (const l of lados) {
      await percorrerEstados(page, l, async (cena) => {
        await semRolagemHorizontal(page, l, `${cena} (${l.lado}, ${w}×${h})`);
        await page.mouse.move(5, h - 5); await page.waitForTimeout(450);
        const arquivo = path.join(pasta!, `${cena}__${l.lado}__${w}x${h}.png`);
        await page.screenshot({ path: arquivo });
        fotos.push(arquivo);
      });
    }
  }
  // cada cena tem o PAR: a mesma cena e a mesma viewport nos dois lados
  const semPar = fotos.filter((f) => f.includes("__venda__") && !fotos.includes(f.replace("__venda__", "__compra__")));
  expect(semPar, "toda foto da venda tem a da compra ao lado").toEqual([]);
  expect(fotos.length, "13 cenas × 2 lados × 2 viewports").toBe(13 * 2 * 2);
  info.annotations.push({ type: "evidencia", description: `${fotos.length} fotos (pares Venda × Compra) em ${pasta}` });
});
