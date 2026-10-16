import type { Page, Request, Response } from "@playwright/test";
import { configuracaoNeutraTopV5 } from "@agro/domain";
import { api, empresaAtiva, login, logout, uniq, abrirObservacaoDaCompra, abrirAbaDoPainelDeCompras } from "./helpers";
import { chamarApi } from "./top-config-08-comum";
import { hojeISO } from "./estoque-01-comum";
import { test, expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed } from "./central-compras-fixtures";

/**
 * EDITAR-02 (F1, decisão 313) — EDITAR A COMPRA E O PEDIDO DE COMPRA ABERTOS, PELA TELA.
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PROVA ──────────────────────────────────────────────────────────────────────┐
 * │ A integração (`apps/api/test/integration/editar-02-patch.test.ts` e `editar-02-edicao.test.ts`)      │
 * │ prova a PATCH e o `GET /edicao` no servidor; o unitário (`edicao.test.ts`), as contas puras da tela. │
 * │ O que nenhum dos dois alcança é o ELO: a consulta oferece (ou não) o "Editar", a Central abre em     │
 * │ modo edição com o documento GRAVADO, o Salvar manda no fio `{ version, ...só o que mudou }` e o     │
 * │ servidor grava — a consulta volta com o valor novo e a versão sobe (lida no `GET :id`).              │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * O SERVIDOR É O ÁRBITRO. Cada caso lê a premissa e a conclusão na API (o `GET :id`, o `GET /edicao`) ou no FIO (o
 * corpo da PATCH que a tela mandou, o `/edicao` que ela recebeu); a tela é conferida por `data-testid`, papéis e rótulos.
 * Os motivos das recusas são escritos por extenso (o texto é contrato) e conferidos IGUAIS ao `motivo` do servidor.
 *
 * FIXTURE PRÓPRIA (`central-compras-fixtures.ts`): TOPs, produtos, fornecedor e local nascem no caso e saem no fim pela
 * exclusão lógica; natureza e centro vêm do seed pelo nome. Os documentos ficam (o ledger é imutável; nada se apaga —
 * decisão 247). O papel e o membro do caso restrito ficam (como nos specs de compras que criam usuário). 1440×900.
 */

test.use({ viewport: { width: 1440, height: 900 } });

const P = "central-compras";
type Especie = "compra" | "pedido";
const SEGMENTO: Record<Especie, string> = { compra: "compras", pedido: "pedidos" };

/* Os textos que a tela e o servidor dizem (escritos por extenso: o texto é contrato). */
const MOTIVO_CONFIRMADA = "Esta compra está confirmada: a entrada no estoque e as contas a pagar já foram lançadas e não se editam. Para corrigir, cancele a compra (o cancelamento estorna o estoque e as contas) e lance de novo.";
const MOTIVO_CANCELADO = "Este documento está cancelado: não há o que editar.";
const motivoDaCompraViva = (codigo: string) => `Este pedido já gerou a compra ${codigo}: editar o pedido desmentiria a compra. Cancele a compra para editar o pedido.`;
const MOTIVO_FORNECEDOR_DA_COMPRA_DO_PEDIDO = "O fornecedor da compra gerada de um pedido é o do pedido; ele não muda.";
const MOTIVO_FORNECEDOR_DO_PEDIDO_COM_COMPRA = "O fornecedor do pedido de compra não muda depois que o pedido gerou compra.";
const MSG_DOCUMENTO_MUDOU = "Este documento mudou desde que você o abriu. Recarregue antes de salvar.";
const MSG_ALTERACOES_SALVAS = "Alterações salvas";
const MSG_NADA_MUDOU = "Nada mudou: o documento continua como estava.";

/* ═════════════════════════════════════ A FIXTURE ═════════════════════════════════════ */

interface Cenario {
  empresa: string; natureza: string; centro: string; local: { id: string; nome: string };
  produtoA: string; produtoB: string; fornecedor: string; topCompra: string; topPedido: string;
}

/** Os cadastros do caso: dois produtos, um fornecedor e um local próprios; a TOP de compra e a de pedido (→ compra, em partes). */
async function cenario(page: Page, rotulo: string): Promise<Cenario> {
  const ref = await referenciasDoSeed(page);
  const empresa = await empresaAtiva(page);
  const produto = async (nome: string) => (await criarCadastro(page, "products", {
    description: uniq(`E2 ${rotulo} ${nome}`), group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id
  })).id;
  const produtoA = await produto("produto A"); const produtoB = await produto("produto B");
  const fornecedor = (await criarCadastro(page, "people", { name: uniq(`E2 ${rotulo} forn`), person_type: "legal", is_provider: true })).id;
  const l = await criarCadastro(page, "warehouses", { empresa_id: empresa, initials: `E${Math.random().toString(36).slice(2, 7).toUpperCase()}`, description: uniq(`E2 ${rotulo} local`), type: "inputs" });
  const local = { id: l.id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${l.id}`))["description"]) };
  const topCompra = (await criarTop(page, { codigo: codigoTop("E2c"), codigoBase: "compras.compra", nome: uniq(`E2 ${rotulo} compra`) })).id;
  const topPedido = (await criarTop(page, {
    codigo: codigoTop("E2p"), codigoBase: "compras.pedido", nome: uniq(`E2 ${rotulo} pedido`), destinos: [{ tipoOperacaoId: topCompra, ordem: 0, emPartes: true }]
  })).id;
  return { empresa, natureza: ref.natureza.id, centro: ref.centro.id, local, produtoA, produtoB, fornecedor, topCompra, topPedido };
}

type ItemLido = { id: string; produto_id: string; quantidade: string; valor_unitario: string; observacao: string | null };
type DocLido = {
  id: string; codigo: string; situacao: string; version?: string; observacao: string | null; valor_total: string;
  categoria_financeira_id: string | null; centro_custo_id: string | null; itens: ItemLido[];
  compras_geradas?: { id: string; codigo: string; situacao: string }[];
};
const ler = (page: Page, especie: Especie, id: string) => api<DocLido>(page, "GET", `/api/compras/${SEGMENTO[especie]}/${id}`);

/** A compra aberta, pela API: A 5 × 20,00 e B 2 × 5,00 no local do caso, com natureza e centro. */
async function compraAberta(page: Page, c: Cenario, extra: Record<string, unknown> = {}): Promise<DocLido> {
  const { id } = await api<{ id: string }>(page, "POST", "/api/compras/compras", {
    empresa_id: c.empresa, tipo_operacao_id: c.topCompra, fornecedor_id: c.fornecedor, data_documento: hojeISO(),
    categoria_financeira_id: c.natureza, centro_custo_id: c.centro, observacao: "observação gravada",
    itens: [{ produto_id: c.produtoA, armazem_id: c.local.id, quantidade: "5", valor_unitario: "20.00" }, { produto_id: c.produtoB, armazem_id: c.local.id, quantidade: "2", valor_unitario: "5.00" }],
    ...extra
  });
  const lido = await ler(page, "compra", id);
  expect([lido.situacao, lido.version], "premissa: a compra nasce aberta, na versão 0").toEqual(["aberto", "0"]);
  return lido;
}

/** O pedido aberto, pela API: A 10 × 10,00. */
async function pedidoAberto(page: Page, c: Cenario): Promise<DocLido> {
  const { id } = await api<{ id: string }>(page, "POST", "/api/compras/pedidos", {
    empresa_id: c.empresa, tipo_operacao_id: c.topPedido, fornecedor_id: c.fornecedor, data_documento: hojeISO(),
    categoria_financeira_id: c.natureza, centro_custo_id: c.centro, observacao: "pedido gravado",
    itens: [{ produto_id: c.produtoA, quantidade: "10", valor_unitario: "10.00" }]
  });
  const lido = await ler(page, "pedido", id);
  expect([lido.situacao, lido.version], "premissa: o pedido nasce aberto, na versão 0").toEqual(["aberto", "0"]);
  return lido;
}

/** Receber `quantidade` do item do pedido (o `/convert` de hoje): a compra gerada, aberta. */
async function receber(page: Page, c: Cenario, pedido: DocLido, quantidade: string): Promise<DocLido> {
  const { id } = await api<{ id: string }>(page, "POST", `/api/compras/pedidos/${pedido.id}/convert`, {
    tipo_operacao_id: c.topCompra, data_documento: hojeISO(), categoria_financeira_id: c.natureza, centro_custo_id: c.centro,
    itens: [{ item_origem_id: pedido.itens[0]!.id, quantidade, valor_unitario: "10.00", armazem_id: c.local.id }]
  });
  const lido = await ler(page, "compra", id);
  expect(lido.situacao, "premissa: a compra gerada nasce aberta").toBe("aberto");
  return lido;
}

/* ═════════════════════════════════════ A TELA ═════════════════════════════════════ */

const central = (page: Page) => page.getByTestId("compras-central");
const editar = (page: Page) => page.getByTestId("compras-editar");
const linhas = (page: Page) => page.getByTestId("compras-itens").getByTestId(`${P}-linha`);
const toast = (page: Page, texto: string) => page.locator("[data-sonner-toast]").filter({ hasText: texto });
const caminho = (r: Request | Response) => new URL(r.url()).pathname;

/** A consulta do documento, aberta e assentada (o nome é o código do documento; a situação, a pedida). */
async function abrirConsulta(page: Page, especie: Especie, doc: DocLido, situacao = "aberto") {
  await page.goto(`/compras/${SEGMENTO[especie]}/${doc.id}`);
  await expect(page.getByTestId(`${P}-identidade-nome`), "premissa: a consulta desenhou ESTE documento").toHaveText(doc.codigo);
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", situacao);
}

/** Clica em Editar e espera a Central em modo edição, carregada pelo `/edicao` (devolvido como a tela o recebeu). */
async function abrirEdicao(page: Page, especie: Especie, doc: DocLido): Promise<Record<string, unknown>> {
  const doFio = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === `/api/compras/${SEGMENTO[especie]}/${doc.id}/edicao`);
  await expect(editar(page), "o Editar está habilitado").toBeEnabled();
  await editar(page).click();
  const resposta = await doFio;
  expect(resposta.status(), "o /edicao respondeu").toBe(200);
  const corpo = (await resposta.json()) as Record<string, unknown>;
  await expect(central(page), "a Central abriu NO LUGAR da consulta, em modo edição").toHaveAttribute("data-modo", "edicao");
  await expect(central(page), "com o documento salvo").toHaveAttribute("data-documento-id", doc.id);
  await expect(central(page)).not.toHaveAttribute("data-situacao", "carregando");
  await expect(page.getByTestId("compras-salvar"), "o Salvar destravou (layout e regras do /edicao)").toBeEnabled();
  return corpo;
}

/** Salva a edição e devolve a PATCH que saiu no fio (corpo e status) — e só ela: nenhum POST de criação. */
async function salvarEdicao(page: Page, especie: Especie, doc: DocLido): Promise<{ corpo: Record<string, unknown>; status: number; chave: string | undefined }> {
  const alvo = `/api/compras/${SEGMENTO[especie]}/${doc.id}`;
  const resposta = page.waitForResponse((r) => r.request().method() === "PATCH" && caminho(r) === alvo);
  await page.getByTestId("compras-salvar").click();
  const r = await resposta;
  return { corpo: r.request().postDataJSON() as Record<string, unknown>, status: r.status(), chave: r.request().headers()["idempotency-key"] };
}

async function abrirAba(page: Page, nome: string) {
  const aba = page.getByTestId(`${P}-painel`).getByRole("tab", { name: nome });
  await aba.click();
  await expect(aba).toHaveAttribute("aria-selected", "true");
}

/** Observação na edição (Dados principais) ou na consulta (aba Observações do painel). */
async function abrirObservacao(page: Page, onde: "edicao" | "consulta") {
  if (onde === "edicao") await abrirObservacaoDaCompra(page);
  else await abrirAba(page, "Observações");
}

/** O Editar presente e DESABILITADO, com o motivo em `data-motivo` e na dica — o MESMO texto que o `/edicao` responde. */
async function editarDesabilitado(page: Page, especie: Especie, doc: DocLido, motivo: string) {
  await expect(editar(page), "o Editar aparece (quem vê tem .edit e .view)").toBeVisible();
  await expect(editar(page), "e está desabilitado").toBeDisabled();
  await expect(editar(page), "com o motivo em data-motivo").toHaveAttribute("data-motivo", motivo);
  await expect(editar(page), "e na dica").toHaveAttribute("data-dica", motivo);
  const doServidor = await api<{ podeEditar: boolean; motivo: string | null }>(page, "GET", `/api/compras/${SEGMENTO[especie]}/${doc.id}/edicao`);
  expect([doServidor.podeEditar, doServidor.motivo], "o motivo da tela é o MESMO do servidor (a mesma recusa da PATCH)").toEqual([false, motivo]);
}

/** Conta as escritas de documento de compra que a página manda (PATCH e POST em /api/compras/{compras|pedidos}). */
function contarEscritas(page: Page) {
  const escritas: string[] = [];
  const ouvir = (r: Request) => {
    if ((r.method() === "PATCH" || r.method() === "POST") && /^\/api\/compras\/(compras|pedidos)(\/|$)/.test(caminho(r))) escritas.push(`${r.method()} ${caminho(r)}`);
  };
  page.on("request", ouvir);
  return { escritas, parar: () => page.off("request", ouvir) };
}

/* ═════════════════════════════════════ E2-1 — A COMPRA ABERTA ═════════════════════════════════════ */

test("E2-1 — compra ABERTA: Editar → a Central em modo edição com o gravado → muda a observação e a quantidade de um item → Salvar manda { version, ...só o que mudou } → a consulta volta com o valor novo e a versão sobe; o item salvo não tem o Remover, o item novo tem", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const c = await cenario(page, "E2-1");
  const doc = await compraAberta(page, c);
  const [a, b] = doc.itens;
  expect([a?.produto_id, b?.produto_id], "premissa: A e B, na ordem").toEqual([c.produtoA, c.produtoB]);

  await abrirConsulta(page, "compra", doc);
  await expect(editar(page), "a compra aberta: Editar habilitado, sem motivo").not.toHaveAttribute("data-motivo", /.+/);
  const edicao = await abrirEdicao(page, "compra", doc);
  expect([edicao["podeEditar"], edicao["version"]], "o /edicao que a tela recebeu: pode editar, versão 0").toEqual([true, "0"]);

  // A EDIÇÃO NÃO CONFIRMA (P4): Salvar, nunca "Salvar e confirmar", e sem a pílula Confirmar compra.
  await expect(page.getByTestId("compras-salvar")).toHaveAttribute("aria-label", "Salvar");
  await expect(page.getByTestId(`${P}-confirmar`), "sem Confirmar compra na edição").toHaveCount(0);
  await expect(linhas(page), "os dois itens salvos").toHaveCount(2);

  // O ITEM SALVO NÃO SAI (P1): marcado, sem o Remover. A quantidade sem teto (a compra não veio de pedido).
  await linhas(page).nth(0).getByTestId(`${P}-selecionar-item`).click();
  await expect(linhas(page).nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId(`${P}-remover-item`), "o item salvo não tem o Remover").toHaveCount(0);
  const quantidade = linhas(page).nth(0).getByLabel("Quantidade do item 1");
  await expect(quantidade).toHaveValue(/^5/);
  await expect(quantidade, "sem origem, nenhum teto na quantidade").not.toHaveAttribute("max", /.*/);

  // O ITEM NOVO DA EDIÇÃO SAI ANTES DE SALVAR: Adicionar → a linha nova tem o Remover → some.
  await page.getByTestId("compras-itens").getByTestId(`${P}-adicionar-item`).click();
  await expect(linhas(page)).toHaveCount(3);
  await expect(page.getByTestId(`${P}-remover-item`), "o item novo tem o Remover").toHaveCount(1);
  await page.getByTestId(`${P}-remover-item`).click();
  await expect(linhas(page)).toHaveCount(2);

  // A MUDANÇA: a quantidade de A (5 → 6) e a observação.
  await linhas(page).nth(0).getByTestId(`${P}-selecionar-item`).click();
  await linhas(page).nth(0).getByLabel("Quantidade do item 1").fill("6");
  await abrirObservacao(page, "edicao");
  await expect(page.getByTestId("compras-observacao"), "a observação GRAVADA").toHaveValue("observação gravada");
  await page.getByTestId("compras-observacao").fill("observação editada E2-1");
  await expect(page.getByTestId(`${P}-alterado`), "a identidade acende o ponto de alteração").toHaveCount(1);

  const patch = await salvarEdicao(page, "compra", doc);
  expect(patch.status, "a PATCH gravou").toBe(200);
  expect(patch.chave, "com Idempotency-Key").toBeTruthy();
  expect(patch.corpo, "o corpo: a versão lida e SÓ o que mudou; os itens completos, por id, só com o campo alterado").toEqual({
    version: "0", observacao: "observação editada E2-1", itens: [{ id: a!.id, quantidade: "6" }, { id: b!.id }]
  });
  await expect(toast(page, MSG_ALTERACOES_SALVAS)).toBeVisible();

  // A CONSULTA volta, no lugar, com o valor novo — e o servidor gravou, com a versão +1.
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");
  await expect(page.getByTestId("compras-consulta-total"), "6 × 20,00 + 2 × 5,00").toContainText("130,00");
  await abrirObservacao(page, "consulta");
  await expect(page.getByTestId(`${P}-painel`).getByRole("tabpanel")).toContainText("observação editada E2-1");
  const depois = await ler(page, "compra", doc.id);
  expect({ version: depois.version, observacao: depois.observacao, valor_total: depois.valor_total, itens: depois.itens.map((i) => [i.id, i.quantidade]) },
    "o GET :id: a versão subiu 1, a observação e a quantidade novas, os mesmos itens").toEqual({
    version: "1", observacao: "observação editada E2-1", valor_total: "130.00", itens: [[a!.id, "6.0000"], [b!.id, "2.0000"]]
  });
});

/* ═════════════════════════════════════ E2-2 — O PEDIDO ABERTO ═════════════════════════════════════ */

test("E2-2 — pedido ABERTO: Salvar sem mudar nada não manda nada (zero PATCH) e volta à consulta; Editar → muda a observação e a quantidade → a consulta e o GET :id com o valor novo e a versão +1", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const c = await cenario(page, "E2-2");
  const doc = await pedidoAberto(page, c);
  const item = doc.itens[0]!;

  await abrirConsulta(page, "pedido", doc);
  // NADA MUDOU: o Salvar não vai ao servidor.
  await abrirEdicao(page, "pedido", doc);
  const fio = contarEscritas(page);
  await page.getByTestId("compras-salvar").click();
  await expect(toast(page, MSG_NADA_MUDOU)).toBeVisible();
  await expect(page.getByTestId("compras-consulta-corpo"), "volta à consulta").toHaveAttribute("data-situacao", "aberto");
  await page.waitForTimeout(300);
  expect(fio.escritas, "ZERO escrita: nada mudou").toEqual([]);
  fio.parar();
  expect((await ler(page, "pedido", doc.id)).version, "a versão não subiu").toBe("0");

  // A EDIÇÃO: a quantidade (10 → 12) e a observação.
  await abrirEdicao(page, "pedido", doc);
  await expect(page.getByTestId("compras-numero-nota"), "o pedido não tem nota").toHaveCount(0);
  await linhas(page).nth(0).getByTestId(`${P}-selecionar-item`).click();
  await expect(page.getByTestId(`${P}-remover-item`), "o item salvo do pedido não tem o Remover").toHaveCount(0);
  await linhas(page).nth(0).getByLabel("Quantidade do item 1").fill("12");
  await abrirObservacao(page, "edicao");
  await page.getByTestId("compras-observacao").fill("pedido editado E2-2");
  const patch = await salvarEdicao(page, "pedido", doc);
  expect(patch.status, "a PATCH do pedido gravou").toBe(200);
  expect(patch.corpo).toEqual({ version: "0", observacao: "pedido editado E2-2", itens: [{ id: item.id, quantidade: "12" }] });
  await expect(toast(page, MSG_ALTERACOES_SALVAS)).toBeVisible();
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");
  await expect(page.getByTestId("compras-consulta-total"), "12 × 10,00").toContainText("120,00");
  const depois = await ler(page, "pedido", doc.id);
  expect({ version: depois.version, situacao: depois.situacao, observacao: depois.observacao, valor_total: depois.valor_total, quantidade: depois.itens.map((i) => i.quantidade) })
    .toEqual({ version: "1", situacao: "aberto", observacao: "pedido editado E2-2", valor_total: "120.00", quantidade: ["12.0000"] });
});

/* ═════════════════════════════════════ E2-3 — QUEM SÓ VÊ ═════════════════════════════════════ */

test("E2-3 — quem tem .view sem .edit: a consulta abre e o Editar NÃO aparece (compra e pedido); o servidor recusa a PATCH e o /edicao com 403; o administrador, no mesmo documento, tem o Editar", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const c = await cenario(page, "E2-3");
  const compra = await compraAberta(page, c);
  const pedido = await pedidoAberto(page, c);
  // PREMISSA anti-vacuidade: no MESMO documento, quem tem .edit e .view vê o Editar habilitado.
  await abrirConsulta(page, "compra", compra);
  await expect(editar(page), "premissa: o administrador tem o Editar").toBeEnabled();

  const papel = await api<{ id: string }>(page, "POST", "/api/admin/roles", { name: uniq("Leitor de compras E2"), permissions: ["compras.view", "pedidos_compra.view"] });
  const leitor = { email: `e2e-editar02-${Date.now().toString(36)}@demo.local`, password: "Leitor@12345" };
  await api(page, "POST", "/api/admin/members", {
    name: "Leitor de compras E2", email: leitor.email, password: leitor.password, role_id: papel.id,
    escopos_empresas: [{ modulo: "compras", modo: "todas", empresas: [] }]
  });
  await logout(page);
  try {
    await login(page, leitor);
    for (const [especie, doc] of [["compra", compra], ["pedido", pedido]] as const) {
      await abrirConsulta(page, especie, doc);
      await page.waitForLoadState("networkidle");
      await expect(editar(page), `${especie}: sem .edit, o Editar não aparece`).toHaveCount(0);
      const p = await chamarApi(page, "PATCH", `/api/compras/${SEGMENTO[especie]}/${doc.id}`, { version: "0", observacao: "não pode" });
      const g = await chamarApi(page, "GET", `/api/compras/${SEGMENTO[especie]}/${doc.id}/edicao`);
      expect([p.status, g.status], `${especie}: a PATCH e o /edicao recusam quem não tem .edit`).toEqual([403, 403]);
    }
  } finally {
    await logout(page);
    await login(page);
  }
  for (const [especie, doc] of [["compra", compra], ["pedido", pedido]] as const) {
    const lido = await ler(page, especie, doc.id);
    expect([lido.version, lido.observacao], `${especie}: nada gravado`).toEqual(["0", doc.observacao]);
  }
});

/* ═════════════════ E2-4 — DESABILITADO COM O MOTIVO; A COMPRA GERADA DE PEDIDO (TETO, SEM ITEM NOVO) ═════════════════ */

test("E2-4 — Editar DESABILITADO com o motivo do servidor: pedido com compra viva (aponta a compra), compra confirmada, compra cancelada; a compra gerada de pedido abre com o produto e o fornecedor travados, a quantidade com max = o saldo, sem item novo; a criação continua sem max; o pedido só com compra cancelada edita com o fornecedor travado", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  const c = await cenario(page, "E2-4");
  const pedido = await pedidoAberto(page, c);
  const gerada = await receber(page, c, pedido, "4");

  // (1) O PEDIDO COM COMPRA VIVA: desabilitado, e o motivo aponta a compra pelo código.
  await abrirConsulta(page, "pedido", pedido);
  await editarDesabilitado(page, "pedido", pedido, motivoDaCompraViva(gerada.codigo));

  // (2) A COMPRA GERADA DE PEDIDO: o produto travado, o fornecedor travado (com o motivo), a quantidade até o saldo, sem
  // item novo (nem Adicionar, nem Duplicar) e sem Remover.
  await abrirConsulta(page, "compra", gerada);
  const edicao = await abrirEdicao(page, "compra", gerada);
  const limites = edicao["limites"] as { itemNovo: string | null; itens: { id: string; quantidadeMaxima: string | null }[] };
  expect(limites.itemNovo, "premissa no fio: a compra do pedido não aceita item novo").not.toBeNull();
  expect(limites.itens.map((i) => [i.id, i.quantidadeMaxima]), "premissa no fio: o teto do item é o saldo do pedido (10 − 0 de outras compras)").toEqual([[gerada.itens[0]!.id, "10.0000"]]);
  await expect(linhas(page)).toHaveCount(1);
  await expect(linhas(page).nth(0).getByTestId(`${P}-produto`), "o produto vem do pedido: travado").toHaveAttribute("data-travado", "");
  await linhas(page).nth(0).getByTestId(`${P}-selecionar-item`).click();
  const quantidade = linhas(page).nth(0).getByLabel("Quantidade do item 1");
  await expect(quantidade, "a quantidade com max = o saldo do item do pedido").toHaveAttribute("max", "10.0000");
  await expect(page.getByTestId(`${P}-adicionar-item`), "sem item novo: nada de Adicionar").toHaveCount(0);
  await expect(page.getByTestId(`${P}-adicionar-vazio`)).toHaveCount(0);
  await expect(page.getByTestId(`${P}-duplicar-item`), "nem Duplicar").toHaveCount(0);
  await expect(page.getByTestId(`${P}-remover-item`), "nem Remover (o item salvo não sai)").toHaveCount(0);
  await expect(central(page).locator(`fieldset[data-travado-na-edicao="true"][data-motivo="${MOTIVO_FORNECEDOR_DA_COMPRA_DO_PEDIDO}"]`),
    "o fornecedor travado, com o motivo do servidor").toHaveCount(1);
  await quantidade.fill("5");
  const patch = await salvarEdicao(page, "compra", gerada);
  expect([patch.status, patch.corpo], "até o saldo grava").toEqual([200, { version: "0", itens: [{ id: gerada.itens[0]!.id, quantidade: "5" }] }]);
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");
  expect((await ler(page, "compra", gerada.id)).itens.map((i) => i.quantidade), "a compra gerada com 5").toEqual(["5.0000"]);

  // (3) A COMPRA CONFIRMADA: desabilitado, com o caminho do estorno no motivo.
  await api(page, "POST", `/api/compras/compras/${gerada.id}/confirm`, {});
  await abrirConsulta(page, "compra", gerada, "confirmado");
  await editarDesabilitado(page, "compra", gerada, MOTIVO_CONFIRMADA);

  // (4) A COMPRA CANCELADA (o cancelamento estorna): desabilitado, "não há o que editar".
  await api(page, "POST", `/api/compras/compras/${gerada.id}/cancel`, {});
  await abrirConsulta(page, "compra", gerada, "cancelado");
  await editarDesabilitado(page, "compra", gerada, MOTIVO_CANCELADO);

  // (5) O PEDIDO SÓ COM A COMPRA CANCELADA (D4): o Editar volta; o fornecedor fica travado, com o motivo do servidor.
  await abrirConsulta(page, "pedido", pedido);
  await abrirEdicao(page, "pedido", pedido);
  await expect(central(page).locator(`fieldset[data-travado-na-edicao="true"][data-motivo="${MOTIVO_FORNECEDOR_DO_PEDIDO_COM_COMPRA}"]`),
    "o fornecedor do pedido que gerou compra, travado").toHaveCount(1);
  await expect(page.getByTestId(`${P}-descartar`), "sem alteração, o ✕ é Voltar à consulta").toHaveAttribute("aria-label", "Voltar à consulta");
  await page.getByTestId(`${P}-descartar`).click();
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");

  // (6) A CRIAÇÃO NÃO GANHA TETO: a linha nova sem max (a grade de hoje).
  await page.goto(`/compras/compras/new?tipo_operacao_id=${c.topCompra}`);
  await expect(central(page)).toHaveAttribute("data-modo", "lancar");
  await page.getByTestId("compras-itens").getByTestId(`${P}-adicionar-item`).click();
  await expect(linhas(page).nth(0).getByLabel("Quantidade do item 1"), "a criação: a quantidade sem max").not.toHaveAttribute("max", /.*/);
});

/* ═════════════════════════════════════ E2-5 — O PEDIDO CANCELADO ═════════════════════════════════════ */

test("E2-5 — pedido CANCELADO: Editar desabilitado com o motivo próprio, o mesmo do servidor", async ({ page }) => {
  await login(page);
  const c = await cenario(page, "E2-5");
  const pedido = await pedidoAberto(page, c);
  await api(page, "POST", `/api/compras/pedidos/${pedido.id}/cancel`, {});
  await abrirConsulta(page, "pedido", pedido, "cancelado");
  await editarDesabilitado(page, "pedido", pedido, MOTIVO_CANCELADO);
});

/* ═════════════════════════════════════ E2-6 — O DOCUMENTO MUDOU (409) ═════════════════════════════════════ */

test("E2-6 — o documento mudou por fora com a edição aberta: Salvar → 409 → o diálogo com a mensagem do servidor e 'Recarregar o documento' → recarrega o gravado (o valor novo, a versão nova) e a próxima gravação vale", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const c = await cenario(page, "E2-6");
  const doc = await compraAberta(page, c);

  await abrirConsulta(page, "compra", doc);
  await abrirEdicao(page, "compra", doc);
  await abrirObservacao(page, "edicao");
  await page.getByTestId("compras-observacao").fill("a minha alteração");

  // POR FORA: outra aba (a mesma sessão, pela API) grava antes — a versão vai a 1.
  const fora = await api<DocLido>(page, "PATCH", `/api/compras/compras/${doc.id}`, { version: "0", observacao: "mudou por fora" });
  expect([fora.version, fora.observacao], "premissa: a gravação de fora subiu a versão").toEqual(["1", "mudou por fora"]);

  const recusada = await salvarEdicao(page, "compra", doc);
  expect([recusada.status, recusada.corpo["version"]], "a PATCH da tela leva a versão que ela leu, e é recusada").toEqual([409, "0"]);
  const conflito = page.getByTestId("compras-edicao-conflito");
  await expect(conflito, "o diálogo do conflito, com a mensagem do servidor").toHaveText(MSG_DOCUMENTO_MUDOU);
  await expect(page.getByTestId("confirm-dialog-confirm")).toHaveText("Recarregar o documento");
  expect((await ler(page, "compra", doc.id)).observacao, "a recusa não gravou nada").toBe("mudou por fora");

  // RECARREGAR: o /edicao de novo, com a versão 1 e o valor de fora (o rascunho sai, de propósito).
  const relido = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === `/api/compras/compras/${doc.id}/edicao`);
  await page.getByTestId("confirm-dialog-confirm").click();
  const corpoRelido = (await (await relido).json()) as Record<string, unknown>;
  expect(corpoRelido["version"], "recarregou a versão nova").toBe("1");
  await expect(conflito).toHaveCount(0);
  await expect(central(page)).toHaveAttribute("data-modo", "edicao");
  await expect(page.getByTestId("compras-salvar")).toBeEnabled();
  await abrirObservacao(page, "edicao");
  await expect(page.getByTestId("compras-observacao"), "o formulário mostra o gravado de fora").toHaveValue("mudou por fora");

  // A PRÓXIMA GRAVAÇÃO, sobre a versão recarregada, vale.
  await page.getByTestId("compras-observacao").fill("depois de recarregar");
  const ok = await salvarEdicao(page, "compra", doc);
  expect([ok.status, ok.corpo], "agora com a versão 1").toEqual([200, { version: "1", observacao: "depois de recarregar" }]);
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");
  const depois = await ler(page, "compra", doc.id);
  expect([depois.version, depois.observacao]).toEqual(["2", "depois de recarregar"]);
});

/* ═════════════════════════════════ E2-7 — A EDIÇÃO NÃO SEMEIA A 311 ═════════════════════════════════ */

test("E2-7 — a compra salva com natureza e centro NULOS (o par vem da TOP, decisão 311): a criação semeia, a edição NÃO; salvar outra coisa não manda o par e o gravado continua nulo", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const c = await cenario(page, "E2-7");
  // A TOP do caso no formato 5, com o par natureza + centro nos padrões financeiros (o documento troca).
  const top = (await criarTop(page, {
    codigo: codigoTop("E2t"), codigoBase: "compras.compra", nome: uniq("E2-7 compra com padrões"), configuracao: configuracaoNeutraTopV5(),
    padroesFinanceiros: { naturezaId: c.natureza, centroCustoId: c.centro, tipoTituloId: null, formaPagamentoId: null, contaBancariaId: null }
  })).id;
  const doc = await compraAberta(page, { ...c, topCompra: top }, { categoria_financeira_id: null, centro_custo_id: null });
  expect([doc.categoria_financeira_id, doc.centro_custo_id], "premissa: o gravado sem o par (a TOP o dá)").toEqual([null, null]);
  // Natureza/centro moram em Rateio e classificação (decisão 319), não nos Dados.
  const campo = (c: string) => central(page).locator(`[data-campo="${c}"]`);

  // PREMISSA anti-vacuidade: na CRIAÇÃO com a mesma TOP, natureza e centro chegam SEMEADOS.
  await page.goto(`/compras/compras/new?tipo_operacao_id=${top}`);
  await expect(central(page)).toHaveAttribute("data-modo", "lancar");
  await abrirAbaDoPainelDeCompras(page, "Rateio e classificação");
  await expect(campo("categoria_financeira_id"), "premissa: a criação semeia a natureza da TOP").toHaveAttribute("data-padrao-top", "semeado");
  await expect(campo("centro_custo_id"), "premissa: e o centro").toHaveAttribute("data-padrao-top", "semeado");

  // A EDIÇÃO: o /edicao traz os padrões da TOP (a tela os conhece), e NADA é semeado.
  await abrirConsulta(page, "compra", doc);
  const edicao = await abrirEdicao(page, "compra", doc);
  expect(JSON.stringify((edicao["regras"] as Record<string, unknown>)["padroes"]), "premissa no fio: o /edicao traz o par da TOP").toContain(c.natureza);
  await expect(central(page).locator('[data-padrao-top="semeado"]'), "na edição, nenhum campo semeado pela TOP").toHaveCount(0);
  await abrirAbaDoPainelDeCompras(page, "Rateio e classificação");
  await expect(campo("categoria_financeira_id").getByRole("combobox"), "a natureza continua vazia").toHaveClass(/is-empty/);
  await expect(campo("centro_custo_id").getByRole("combobox"), "o centro continua vazio").toHaveClass(/is-empty/);

  await abrirObservacao(page, "edicao");
  await page.getByTestId("compras-observacao").fill("só a observação, E2-7");
  const patch = await salvarEdicao(page, "compra", doc);
  expect([patch.status, patch.corpo], "o corpo sem o par: só a versão e a observação").toEqual([200, { version: "0", observacao: "só a observação, E2-7" }]);
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");
  const depois = await ler(page, "compra", doc.id);
  expect([depois.version, depois.observacao, depois.categoria_financeira_id, depois.centro_custo_id], "o gravado: a versão +1, a observação, e o par NULO").toEqual(["1", "só a observação, E2-7", null, null]);
});

