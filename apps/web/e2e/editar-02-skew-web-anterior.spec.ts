import type { Locator, Page, Request, Response } from "@playwright/test";
import { api, empresaAtiva, login, abrirAbaDoPainelDeCompras } from "./helpers";
import { cabecalhosDaSessao } from "./top-config-08-comum";
import { test, expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed } from "./central-compras-fixtures";
import { API, MSG_DOCUMENTO_NAO_ENCONTRADO, UUID_INEXISTENTE, vigiar, type Mundo } from "./operacoes-01-f2-skew-comum";
import { fonteDoWebContem, shaDaBase } from "./skew-fonte-da-base";

/**
 * EDITAR-02 (decisão 313) · K-2, SENTIDO 2 — O WEB DA BASE CONTRA A API DESTE HEAD (a janela "API antes do web" da
 * DEPLOYMENT, e a reversão só do web).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 2 roda em `playwright.skew-web-anterior.config.ts`, cujo `testMatch` é
 * `/skew-web-anterior\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o `playwright.config.ts` comum
 * ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (lá o web seria o deste HEAD, e o caso não mediria
 * o cliente anterior). Sem passo no CI: o job `skew` roda a config inteira, e o arquivo entra pelo nome.
 *
 * O QUE SE MEDE. Para o cliente que já está no ar, a API da EDITAR-02 é ADITIVA: duas portas novas (`GET <base>/:id/edicao`
 * e `PATCH <base>/:id`), que o web da base não chama, e uma CHAVE a mais no `GET <base>/:id` — `version` (o `d.*` lê a
 * coluna da 0063). O navegador roda o bundle EXATO da base, e faz pela tela dela o que faz hoje: CRIAR a compra e o pedido
 * pela Central (POST 201), CONSULTAR (o `GET :id` com a `version` a mais — a premissa, lida no fio), CONFIRMAR a compra
 * pela prévia (200) e CANCELAR a compra confirmada (o estorno) e o pedido (200). O VIGIA: nenhuma resposta 404/422/5xx da
 * API nova ao cliente da base e nenhuma requisição morta.
 *
 * O MUNDO DO WEB DA BASE é lido do FONTE do commit (`fonteDoWebContem`, que reprova quando não consegue ler): a pílula
 * `data-testid="compras-editar"` no `apps/web/src` da base.
 *   · LEGADO (a930fff8, sem a EDITAR-02): a consulta da base não tem o Editar, e NENHUMA pergunta ao `/edicao` nem PATCH sai;
 *   · NOVO (a base já com a EDITAR-02): a consulta da base mostra o Editar no documento aberto.
 * PREMISSA DA API: a API julgada é a deste HEAD — o `/edicao` do id inexistente responde a 404 do DOCUMENTO (a porta existe).
 *
 * Os cadastros e as TOPs nascem pela API deste HEAD (as portas de `central-compras-fixtures`, com a exclusão lógica no fim
 * do caso, passou ou falhou); os seletores são os da base (os de `compras-01-documento-de-compra.spec.ts` e de
 * `central-compras-desenho-b.spec.ts` na a930fff8). Os documentos ficam (o ledger é imutável; decisão 247).
 */

const P = "central-compras";
const caminho = (r: Request | Response) => new URL(r.url()).pathname;
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const MARCA_DO_EDITAR = 'data-testid="compras-editar"';

/** O mundo do web da base, pelo fonte do commit; e a premissa de que a API julgada tem as portas da EDITAR-02. */
async function mundos(page: Page): Promise<Mundo> {
  const cab = await cabecalhosDaSessao(page);
  const r = await page.request.get(`${API}/api/compras/compras/${UUID_INEXISTENTE}/edicao`, { headers: cab });
  expect([r.status(), ((await r.json()) as { error?: { message?: string } }).error?.message], "premissa: a API julgada é a deste HEAD (a porta /edicao existe)")
    .toEqual([404, MSG_DOCUMENTO_NAO_ENCONTRADO]);
  const sha = shaDaBase();
  const mundo: Mundo = fonteDoWebContem(sha, MARCA_DO_EDITAR) ? "novo" : "legado";
  console.log(`[skew] EDITAR-02 · K-2 · o web da base ${sha.slice(0, 8)} ${mundo === "novo" ? "TEM" : "NÃO tem"} ${MARCA_DO_EDITAR} → mundo ${mundo}`);
  return mundo;
}

/** O seletor de referência pelo rótulo do campo (o da base, `compras-01-documento-de-compra.spec.ts`). */
async function escolher(page: Page, rotulo: string, nome: string) {
  const campo = page.getByTestId("compras-central").locator("label", { hasText: rotulo }).first().locator("..");
  await campo.locator("button").first().click();
  await page.getByPlaceholder("Pesquisar...").fill(nome.slice(0, 20));
  await page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last().getByRole("option", { name: literal(nome.slice(0, 20)) }).first().click();
}
/** Escolhe na célula da linha pela descrição INTEIRA, exigindo UMA opção (o seletor da base). */
async function escolherNaLinha(page: Page, botao: Locator, nome: string) {
  await botao.click();
  await page.getByPlaceholder("Pesquisar pela descrição").fill(nome);
  const opcao = page.getByRole("option", { name: literal(nome) });
  await expect(opcao, `o seletor da base oferece exatamente uma opção "${nome}"`).toHaveCount(1);
  await opcao.click();
}

async function cadastros(page: Page) {
  const ref = await referenciasDoSeed(page);
  const empresa = await empresaAtiva(page);
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const nome = async (recurso: string, id: string, campo: string) => String((await api<Record<string, unknown>>(page, "GET", `/api/resources/${recurso}/${id}`))[campo]);
  const produto = (await criarCadastro(page, "products", { description: `${tag} E2K2 produto`, group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id })).id;
  const fornecedor = (await criarCadastro(page, "people", { name: `${tag} E2K2 forn`, person_type: "legal", is_provider: true })).id;
  const local = (await criarCadastro(page, "warehouses", { empresa_id: empresa, initials: `K${Math.random().toString(36).slice(2, 7).toUpperCase()}`, description: `${tag} E2K2 local`, type: "inputs" })).id;
  const topCompra = (await criarTop(page, { codigo: codigoTop("E2k2c"), codigoBase: "compras.compra", nome: `${tag} E2 K2 compra` })).id;
  const topPedido = (await criarTop(page, { codigo: codigoTop("E2k2p"), codigoBase: "compras.pedido", nome: `${tag} E2 K2 pedido` })).id;
  return {
    ref, topCompra, topPedido,
    produto: { id: produto, nome: await nome("products", produto, "description") },
    fornecedor: { id: fornecedor, nome: await nome("people", fornecedor, "name") },
    local: { id: local, nome: await nome("warehouses", local, "description") }
  };
}

/** O fio do navegador: as perguntas à porta da edição e as PATCH (o web da base não conhece nenhuma das duas). */
function ouvirEdicao(page: Page) {
  const pedidos: string[] = [];
  page.on("request", (r) => { if (r.url().startsWith(API) && (r.method() === "PATCH" || caminho(r).endsWith("/edicao"))) pedidos.push(`${r.method()} ${caminho(r)}`); });
  return pedidos;
}

/** Salva a criação pela tela da base e devolve o id (o 201 da API nova) e a leitura da consulta que a base fez depois. */
async function salvarCriacao(page: Page, segmento: "compras" | "pedidos"): Promise<{ id: string; leitura: Record<string, unknown> }> {
  const criou = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/compras/${segmento}`);
  const leu = page.waitForResponse((r) => r.request().method() === "GET" && new RegExp(`^/api/compras/${segmento}/[0-9a-f-]{36}$`).test(caminho(r)));
  await page.getByTestId("compras-salvar").click();
  const r = await criou;
  expect(r.status(), `a API nova cria pelo corpo da base (${segmento})`).toBe(201);
  const id = ((await r.json()) as { id: string }).id;
  await expect(page).toHaveURL(new RegExp(`/compras/${segmento}/${id}$`));
  const leitura = await leu;
  expect(leitura.status()).toBe(200);
  return { id, leitura: (await leitura.json()) as Record<string, unknown> };
}

/**
 * Este spec roda o WEB DA BASE sobre a API deste HEAD (skew sentido 2). Na base, Cancelar ainda mora no leque
 * (Ações rápidas); a pílula na barra é desta fatia — por isso abre o leque, e não clica a pílula.
 */
async function itemDoLeque(page: Page, testId: string) {
  const leque = page.getByTestId(`${P}-acoes-rapidas`);
  if ((await leque.getAttribute("aria-expanded")) !== "true") await leque.click();
  await expect(leque).toHaveAttribute("aria-expanded", "true");
  const item = page.getByTestId(testId);
  await expect(item).toBeVisible();
  return item;
}

async function cancelarPelaTela(page: Page, segmento: "compras" | "pedidos", id: string, rotuloDoBotao: string) {
  // O aviso da ação anterior (o "Sucesso" do confirmar) cobre o leque enquanto está na tela: espera ele sair.
  await expect(page.locator("[data-sonner-toast]"), "o aviso da ação anterior saiu da frente do leque").toHaveCount(0, { timeout: 20_000 });
  const cancelou = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/compras/${segmento}/${id}/cancel`);
  await (await itemDoLeque(page, "compras-cancelar")).click();
  await page.getByTestId("confirm-dialog").getByRole("button", { name: rotuloDoBotao }).click();
  expect((await cancelou).status(), `a API nova cancela pelo corpo da base (${segmento})`).toBeLessThan(300);
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "cancelado");
}

async function editarNoMundo(page: Page, mundo: Mundo, contexto: string) {
  if (mundo === "legado") await expect(page.getByTestId("compras-editar"), `${contexto}: o web da base não tem o Editar`).toHaveCount(0);
  else await expect(page.getByTestId("compras-editar"), `${contexto}: o web da base já tem o Editar`).toBeVisible();
}

test("EDITAR-02 · K-2 (sentido 2) — o web da base sobre a API deste HEAD: cria a compra pela Central (201), consulta (o GET :id com a `version` a mais, ignorada), confirma pela prévia (200) e cancela com estorno (200); cria o pedido (201), consulta e cancela (200); nenhuma pergunta à edição, nenhuma PATCH, nenhuma resposta 404/422/5xx", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  const mundo = await mundos(page);
  const c = await cadastros(page);

  const v = vigiar(page);
  const daEdicao = ouvirEdicao(page);

  // (1) A COMPRA: criar pela Central da base (fornecedor, natureza, centro e um item no local), consultar, confirmar, cancelar.
  await page.goto(`/compras/compras/new?tipo_operacao_id=${c.topCompra}`);
  await expect(page.getByTestId("compras-central")).toHaveAttribute("data-especie", "compra");
  await escolher(page, "Fornecedor", c.fornecedor.nome);
  await abrirAbaDoPainelDeCompras(page, "Rateio e classificação");
  // Sentido 2 = WEB DA BASE: rótulos da base (`Natureza de despesa`), não os deste HEAD.
  await escolher(page, "Natureza de despesa", c.ref.natureza.label);
  await escolher(page, "Centro de resultado", c.ref.centro.label);
  // Decisão 319: Local de estoque padrão acima da grade (sem célula por linha).
  await escolher(page, "Local de estoque", c.local.nome);
  const itens = page.getByTestId("compras-itens");
  await itens.getByTestId(`${P}-adicionar-item`).click();
  const linha = itens.getByTestId(`${P}-linha`).first();
  await escolherNaLinha(page, linha.getByTestId(`${P}-produto`), c.produto.nome);
  await linha.getByLabel("Quantidade do item 1").fill("3");
  await linha.getByLabel("Valor unitário do item 1").fill("11");
  await expect(page.getByTestId("compras-total")).toContainText("33,00");
  const compra = await salvarCriacao(page, "compras");
  expect([compra.leitura["situacao"], compra.leitura["version"]], "premissa no fio: a consulta da base recebeu a `version` a mais (0, o documento recém-criado)").toEqual(["aberto", "0"]);
  const corpo = page.getByTestId("compras-consulta-corpo");
  await expect(corpo).toHaveAttribute("data-situacao", "aberto");
  await expect(page.getByTestId(`${P}-identidade-nome`), "a consulta da base desenhou o documento").toHaveText(String(compra.leitura["codigo"]));
  await expect(page.getByTestId("compras-consulta-total")).toContainText("33,00");
  await editarNoMundo(page, mundo, "a compra aberta");

  const confirmou = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/compras/compras/${compra.id}/confirm`);
  await page.getByTestId("compras-confirmar").click();
  await expect(page.getByTestId("compras-previa")).toHaveAttribute("data-situacao", "pronta");
  await page.getByTestId("confirm-dialog-confirm").click();
  expect((await confirmou).status(), "a API nova confirma pelo corpo da base").toBe(200);
  await expect(corpo).toHaveAttribute("data-situacao", "confirmado");
  await cancelarPelaTela(page, "compras", compra.id, "Cancelar compra");
  const compraNoServidor = await api<{ situacao: string; version: string; movimentos: unknown[] }>(page, "GET", `/api/compras/compras/${compra.id}`);
  expect(compraNoServidor.situacao, "no servidor: cancelada").toBe("cancelado");
  expect(BigInt(compraNoServidor.version), "e a versão subiu nas escritas da base (confirmar, cancelar) — pelo gatilho, sem a base saber").toBeGreaterThanOrEqual(2n);

  // (2) O PEDIDO: criar pela Central da base (fornecedor e um item), consultar, cancelar.
  await page.goto(`/compras/pedidos/new?tipo_operacao_id=${c.topPedido}`);
  await expect(page.getByTestId("compras-central")).toHaveAttribute("data-especie", "pedido");
  await escolher(page, "Fornecedor", c.fornecedor.nome);
  await itens.getByTestId(`${P}-adicionar-item`).click();
  const linhaDoPedido = itens.getByTestId(`${P}-linha`).first();
  await escolherNaLinha(page, linhaDoPedido.getByTestId(`${P}-produto`), c.produto.nome);
  await linhaDoPedido.getByLabel("Quantidade do item 1").fill("4");
  await linhaDoPedido.getByLabel("Valor unitário do item 1").fill("5");
  const pedido = await salvarCriacao(page, "pedidos");
  expect([pedido.leitura["situacao"], pedido.leitura["version"]], "premissa no fio: a leitura do pedido também traz a `version`").toEqual(["aberto", "0"]);
  await expect(corpo).toHaveAttribute("data-situacao", "aberto");
  await expect(page.getByTestId(`${P}-identidade-nome`)).toHaveText(String(pedido.leitura["codigo"]));
  await editarNoMundo(page, mundo, "o pedido aberto");
  await cancelarPelaTela(page, "pedidos", pedido.id, "Cancelar pedido de compra");
  expect((await api<{ situacao: string }>(page, "GET", `/api/compras/pedidos/${pedido.id}`)).situacao, "no servidor: o pedido cancelado").toBe("cancelado");

  await page.waitForLoadState("networkidle");
  if (mundo === "legado") expect(daEdicao, "o web da base não pergunta à edição nem manda PATCH").toEqual([]);
  v.semBloqueio();
  v.semErroDeContrato();
});
