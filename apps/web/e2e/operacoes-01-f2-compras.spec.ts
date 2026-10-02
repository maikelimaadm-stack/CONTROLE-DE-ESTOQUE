import type { Locator, Page, Request, Response } from "@playwright/test";
import { login, api, uniq, empresaAtiva } from "./helpers";
import { cfg4, type RegrasGeraisE2E } from "./top-config-08-comum";
import { test, expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed } from "./central-compras-fixtures";

/**
 * OPERACOES-01 F2 (decisão 279) — A CENTRAL DE COMPRAS USA AS REGRAS GERAIS DA TOP · F2C-1 e F2C-2 (API e banco REAIS).
 *
 * ┌─ O QUE ESTE ARQUIVO PROVA ──────────────────────────────────────────────────────────────────────────┐
 * │ F2C-1 TOP de Confirmação AUTOMÁTICA: o Salvar se chama "Salvar e confirmar"; o 201 traz             │
 * │       `confirmacaoAutomatica {confirmado:true}` e a situação "confirmado"; UM aviso, "Salvo e       │
 * │       confirmado."; a consulta abre CONFIRMADA. Contraste na MESMA execução: a TOP MANUAL dá "Salvar",│
 * │       o corpo de antes (sem a chave), "Salvo com sucesso" e a consulta aberta. E quem não pode      │
 * │       confirmar a compra (a sessão sem `compras.edit`) vê "Salvar" na MESMA TOP Automática.         │
 * │ F2C-2 TOP Manual com Documento sem itens PERMITIDO: sem item nenhum, o Salvar envia `itens: []` e o │
 * │       servidor grava (201), aberta e sem itens. Contraste: a TOP PROIBIDO (o neutro) mostra a       │
 * │       pendência "Inclua ao menos um item." e não envia nada.                                        │
 * │ F2C-3 RECEBER O PEDIDO com a TOP de compra Automática + Permitido: o Salvar do receber se chama     │
 * │       "Salvar e confirmar"; sem item, o receber CONTINUA pedindo item (o `/convert` sempre exige —  │
 * │       a TOP que permite não vale aqui) e nada é enviado; com o item, o `/convert` confirma a compra │
 * │       gerada, o aviso é UM "Salvo e confirmado." e a consulta abre a compra CONFIRMADA.             │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * A PREMISSA de cada passo é o que o SERVIDOR declarou no fio — o bloco `regrasGerais` de
 * `/api/compras/compras/regras-da-operacao` que a Central leu —, nunca a configuração que o teste mandou gravar: é o
 * contrato que a tela consome, e ele não depende de em que formato a TOP ficou guardada. O efeito é lido no fio (o
 * corpo do POST e a resposta) e no servidor (o GET do documento), nunca deduzido da tela.
 *
 * Cada caso monta os PRÓPRIOS cadastros pela API (fornecedor, local de estoque, produto e as TOPs) e eles saem no fim,
 * passou ou falhou (`central-compras-fixtures.ts` — a TOP que confirma sozinha não sobra no lançador de quem vier
 * depois); natureza e centro vêm do seed, pelo nome. Os documentos ficam (o ledger é imutável).
 */

const P = "central-compras";
const PORTA_DA_COMPRA = "/api/compras/compras";
const PORTA_DAS_REGRAS = "/api/compras/compras/regras-da-operacao";
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const caminho = (r: Request | Response) => new URL(r.url()).pathname;

/** O bloco que a Central lê: o neutro (a Central de antes) e as combinações que os casos usam. */
const NEUTRO = { confirmacaoAutomatica: false, aceitaSemItens: false };
const SO_AUTOMATICA = { confirmacaoAutomatica: true, aceitaSemItens: false };
const SO_PERMITIDO = { confirmacaoAutomatica: false, aceitaSemItens: true };

/** Escolhe no RefSelect da Central pelo rótulo do campo (nome escapado: nomes do seed têm colchetes). */
async function escolher(page: Page, rotulo: string, nome: string) {
  const campo = page.getByTestId("compras-central").locator("label", { hasText: rotulo }).first().locator("..");
  await campo.locator("button").first().click();
  const painel = page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nome.slice(0, 20));
  await painel.getByRole("option", { name: literal(nome.slice(0, 20)) }).first().click();
}

/** Escolhe na pesquisa do motor ancorada à célula (produto ou local de estoque) da linha — pelo NOME INTEIRO. */
async function escolherNaCelula(page: Page, celula: Locator, nome: string) {
  await celula.click();
  const pesquisa = page.getByTestId(`${P}-pesquisa`);
  await expect(pesquisa).toBeVisible();
  await pesquisa.getByPlaceholder("Pesquisar pela descrição").fill(nome);
  await pesquisa.getByRole("option", { name: literal(nome) }).first().click();
  await expect(pesquisa).toHaveCount(0);
}

/**
 * O aviso do Salvar: o toast do TIPO dado, pela descrição (o título é o fixo do tipo) — o texto certo no tom errado
 * também reprova. `avisos` conta TODOS: um Salvar dá UM aviso, nunca o novo ao lado do de antes.
 */
const avisoDoSalvar = (page: Page, tipo: "success" | "info" | "warning") =>
  page.locator(`[data-sonner-toast] .erp-toast-panel--${tipo} .erp-toast-panel__description`);
const avisos = (page: Page) => page.locator("[data-sonner-toast]");

/** O cadastro do caso: fornecedor, local de estoque e produto CRIADOS aqui; natureza e centro do seed, pelo nome. */
async function cenario(page: Page) {
  const ref = await referenciasDoSeed(page);
  const p = await criarCadastro(page, "products", { description: uniq("F2C produto"), group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id });
  const nomeProduto = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${p.id}`))["description"]);
  const empresa = await empresaAtiva(page);
  const armazem = (await criarCadastro(page, "warehouses", {
    empresa_id: empresa, initials: `F${Date.now().toString(36).slice(-4).toUpperCase()}`, description: uniq("F2C local"), type: "inputs"
  })).id;
  const nomeArmazem = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${armazem}`))["description"]);
  const fornecedor = (await criarCadastro(page, "people", { name: uniq("F2C forn"), person_type: "legal", is_provider: true })).id;
  const nomeFornecedor = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${fornecedor}`))["name"]);
  return { empresa, produto: { id: p.id, nome: nomeProduto }, armazem, nomeArmazem, fornecedor, nomeFornecedor, natureza: ref.natureza, centro: ref.centro };
}
type Cenario = Awaited<ReturnType<typeof cenario>>;

/** Uma TOP de COMPRA nova pela porta administrativa, com as regras gerais dadas (formato 4; o resto, o neutro do domínio). */
async function topDeCompra(page: Page, rotulo: string, regras: RegrasGeraisE2E) {
  const codigo = codigoTop("f2c");
  const { id } = await criarTop(page, { codigo, codigoBase: "compras.compra", nome: uniq(`F2C ${rotulo}`), configuracao: cfg4(regras) });
  return { id, codigo };
}

/**
 * Abre a criação da compra na TOP dada e devolve o bloco `regrasGerais` que o SERVIDOR mandou à Central nesta abertura
 * (a resposta é esperada desde ANTES da navegação). Espera o Salvar sair da trava "carregando": a partir daí o rótulo e
 * as pendências são os da resposta lida.
 */
async function abrirCriacao(page: Page, top: { id: string; codigo: string }, c: Cenario): Promise<unknown> {
  const regras = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === PORTA_DAS_REGRAS
    && new URL(r.url()).searchParams.get("tipo_operacao_id") === top.id);
  await page.goto(`/compras/compras/new?tipo_operacao_id=${top.id}`);
  const resposta = await regras;
  expect(resposta.status(), "premissa: o servidor respondeu as regras da operação").toBe(200);
  const corpo = await resposta.json() as Record<string, unknown>;
  await expect(page.getByTestId("compras-central")).toHaveAttribute("data-especie", "compra");
  await expect(page.getByTestId("compras-top-travada"), "a criação montou com a TOP pedida").toContainText(top.codigo);
  await expect(page.getByTestId("compras-salvar"), "o Salvar saiu da trava: as regras chegaram").toBeEnabled();
  await escolher(page, "Fornecedor", c.nomeFornecedor);
  await escolher(page, "Natureza de despesa", c.natureza.label);
  await escolher(page, "Centro de resultado", c.centro.label);
  return corpo["regrasGerais"];
}

/** Um item na grade: o produto e o local de estoque do cenário, 5 × 20,00. */
async function umItem(page: Page, c: Cenario) {
  await page.getByTestId(`${P}-adicionar-item`).click();
  const linha = page.getByTestId(`${P}-linha`).first();
  await escolherNaCelula(page, linha.getByTestId(`${P}-produto`), c.produto.nome);
  await escolherNaCelula(page, linha.getByTestId(`${P}-armazem`), c.nomeArmazem);
  await linha.getByLabel("Quantidade do item 1").fill("5");
  await linha.getByLabel("Valor unitário do item 1").fill("20");
  await expect(page.getByTestId(`${P}-subtotal`)).toContainText("100,00");
}

type CorpoDoSalvar = Record<string, unknown> & { id: string; situacao: string; confirmacaoAutomatica?: unknown };

/** Clica no Salvar e devolve a resposta do POST de lançar (a resposta é esperada desde ANTES do clique). */
async function salvarPelaTela(page: Page): Promise<{ status: number; corpo: CorpoDoSalvar; enviado: Record<string, unknown> }> {
  const post = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === PORTA_DA_COMPRA);
  await page.getByTestId("compras-salvar").click();
  const r = await post;
  return { status: r.status(), corpo: await r.json() as CorpoDoSalvar, enviado: r.request().postDataJSON() as Record<string, unknown> };
}

/** Depois do aviso, a Central abre a consulta DESTA compra, na situação que o servidor leu. */
async function consultaAbre(page: Page, id: string, situacao: "aberto" | "confirmado") {
  await expect(page, "depois do POST a Central abre a consulta da compra salva").toHaveURL(new RegExp(`/compras/compras/${id}$`));
  await expect(page.getByTestId("compras-consulta-corpo"), `a consulta abre ${situacao}`).toHaveAttribute("data-situacao", situacao);
  const noServidor = await api<{ situacao: string; itens: unknown[] }>(page, "GET", `${PORTA_DA_COMPRA}/${id}`);
  expect(noServidor.situacao, `o servidor diz ${situacao}`).toBe(situacao);
  return noServidor;
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("F2C-1 — TOP de Confirmação Automática: o Salvar se chama 'Salvar e confirmar', o POST confirma e o aviso é UM 'Salvo e confirmado.'; com a TOP Manual, 'Salvar' e 'Salvo com sucesso'; sem compras.edit, 'Salvar'", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const manual = await topDeCompra(page, "manual", {});
  const automatica = await topDeCompra(page, "automática", { confirmacao: "automatica" });
  const salvar = page.getByTestId("compras-salvar");

  // (1) CONTRASTE — TOP MANUAL: o servidor declara o neutro; o Salvar é "Salvar", o corpo é o de antes e o aviso também.
  expect(await abrirCriacao(page, manual, c), "premissa: a TOP manual declara o neutro").toEqual(NEUTRO);
  await expect(salvar, "Manual: o rótulo de antes").toHaveAttribute("aria-label", "Salvar");
  await expect(salvar).toHaveAttribute("data-dica", "Salvar");
  await umItem(page, c);
  const deAntes = await salvarPelaTela(page);
  expect(deAntes.status, "a compra manual foi salva").toBe(201);
  expect([deAntes.corpo.situacao, "confirmacaoAutomatica" in deAntes.corpo], "Manual: aberta, o corpo de antes (sem a chave)").toEqual(["aberto", false]);
  await expect(avisoDoSalvar(page, "success"), "sem a chave, o aviso de antes, byte a byte").toHaveText(["Salvo com sucesso"]);
  await expect(avisos(page), "um aviso só").toHaveCount(1);
  await consultaAbre(page, deAntes.corpo.id, "aberto");

  // (2) TOP AUTOMÁTICA: o servidor declara a confirmação automática; o Salvar diz o que vai acontecer.
  expect(await abrirCriacao(page, automatica, c), "premissa: a TOP automática declara a confirmação automática").toEqual(SO_AUTOMATICA);
  await expect(salvar, "Automática: o Salvar se chama 'Salvar e confirmar'").toHaveAttribute("aria-label", "Salvar e confirmar");
  await expect(salvar).toHaveAttribute("data-dica", "Salvar e confirmar");
  await expect(page.getByTestId(`${P}-confirmar`), "a pílula 'Confirmar compra' da criação continua").toContainText("Confirmar compra");
  await umItem(page, c);
  const confirmado = await salvarPelaTela(page);
  expect(confirmado.status, "a compra automática foi salva").toBe(201);
  expect(Object.keys(confirmado.enviado).sort(), "o corpo do POST é o mesmo da TOP manual: nenhuma chave nova").toEqual(Object.keys(deAntes.enviado).sort());
  expect([confirmado.corpo.situacao, confirmado.corpo.confirmacaoAutomatica], "o POST confirmou (a confirmação automática da TOP)").toEqual(["confirmado", { confirmado: true }]);
  await expect(avisoDoSalvar(page, "success"), "o aviso diz que confirmou").toHaveText(["Salvo e confirmado."]);
  await expect(avisos(page), "um aviso só (nada de 'Salvo com sucesso' ao lado)").toHaveCount(1);
  await consultaAbre(page, confirmado.corpo.id, "confirmado");
  await expect(page.getByTestId("confirm-dialog"), "o Salvar não abre o diálogo de Confirmar").toHaveCount(0);

  // (3) QUEM NÃO PODE CONFIRMAR A COMPRA: a MESMA TOP Automática, numa sessão cujo contexto não traz `compras.edit` (a
  //     capacidade que a confirmação automática confere). O servidor declara a mesma coisa (as regras são da TOP), e a
  //     tela não promete a confirmação: "Salvar", sem a pílula "Confirmar compra". Só a APRESENTAÇÃO muda (`can()` só
  //     esconde): nada é salvo aqui.
  const retirados: string[] = [];
  await page.route("**/api/auth/context", async (rota) => {
    const resposta = await rota.fetch();
    const corpo = await resposta.json() as { permissions: string[] };
    retirados.push(...corpo.permissions.filter((x) => x === "compras.edit"));
    await rota.fulfill({ response: resposta, json: { ...corpo, isOwner: false, permissions: corpo.permissions.filter((x) => x !== "compras.edit") } });
  });
  try {
    expect(await abrirCriacao(page, automatica, c), "premissa: o servidor declara a MESMA confirmação automática para esta TOP").toEqual(SO_AUTOMATICA);
    expect(retirados.length, "premissa: a sessão real TEM compras.edit, e o contexto que a tela leu o perdeu").toBeGreaterThan(0);
    await expect(page.getByTestId(`${P}-confirmar`), "premissa: sem compras.edit a criação não oferece 'Confirmar compra'").toHaveCount(0);
    await expect(salvar, "sem poder confirmar: o rótulo de antes, mesmo com a TOP Automática").toHaveAttribute("aria-label", "Salvar");
    await expect(salvar).toHaveAttribute("data-dica", "Salvar");
  } finally {
    await page.unroute("**/api/auth/context");
  }
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("F2C-2 — compra sem itens: com a TOP que PERMITE, o Salvar envia itens [] e o servidor grava (aberta, sem itens); com a TOP que PROÍBE, a pendência 'Inclua ao menos um item.' e nenhum POST", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const proibido = await topDeCompra(page, "proibido", {});
  const permitido = await topDeCompra(page, "permitido", { documentoSemItens: "permitido" });
  const posts: Request[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && caminho(r) === PORTA_DA_COMPRA) posts.push(r); });
  const salvar = page.getByTestId("compras-salvar");

  // (1) CONTRASTE — TOP PROIBIDO (o neutro): sem item, o clique abre a pendência e não envia nada.
  expect(await abrirCriacao(page, proibido, c), "premissa: a TOP proibido declara o neutro").toEqual(NEUTRO);
  await expect(page.getByTestId(`${P}-linha`), "premissa: nenhuma linha de item").toHaveCount(0);
  await salvar.click();
  const pilula = page.getByTestId(`${P}-pendencias`);
  await expect(pilula).toBeVisible();
  const lista = page.getByTestId(`${P}-pendencias-lista`);
  if (!(await lista.isVisible())) await pilula.click();
  await expect(lista).toBeVisible();
  const semItens = lista.locator(`[data-testid="${P}-pendencia"][data-caminho="itens"]`);
  await expect(semItens, "sem itens é pendência").toHaveCount(1);
  await expect(semItens).toContainText("Inclua ao menos um item.");
  await expect(page, "o clique com pendência não sai da criação").toHaveURL(/\/compras\/compras\/new\?/);

  // (2) TOP PERMITIDO: o servidor declara que aceita sem itens; os MESMOS passos salvam.
  expect(await abrirCriacao(page, permitido, c), "premissa: a TOP permitido declara o documento sem itens").toEqual(SO_PERMITIDO);
  await expect(page.getByTestId(`${P}-linha`), "premissa: nenhuma linha de item").toHaveCount(0);
  await expect(salvar, "Manual: o rótulo de antes").toHaveAttribute("aria-label", "Salvar");
  const vazia = await salvarPelaTela(page);
  expect(vazia.enviado["itens"], "o POST leva a lista de itens VAZIA").toEqual([]);
  expect(vazia.enviado["tipo_operacao_id"], "com a TOP que permite").toBe(permitido.id);
  expect(vazia.status, "o servidor gravou a compra sem itens").toBe(201);
  expect([vazia.corpo.situacao, "confirmacaoAutomatica" in vazia.corpo], "Manual: aberta, o corpo de antes").toEqual(["aberto", false]);
  await expect(avisoDoSalvar(page, "success")).toHaveText(["Salvo com sucesso"]);
  await expect(avisos(page), "um aviso só").toHaveCount(1);
  const gravada = await consultaAbre(page, vazia.corpo.id, "aberto");
  expect(gravada.itens, "no servidor, sem itens").toEqual([]);
  const itensDaConsulta = page.getByTestId("compras-consulta-itens");
  await expect(itensDaConsulta.getByTestId(`${P}-itens-contagem`), "a consulta mostra zero itens").toHaveText("(0)");
  await expect(itensDaConsulta.getByTestId(`${P}-grade`)).toContainText("Nenhum item neste documento.");

  // ZERO POST da TOP proibido: depois de duas navegações completas, o único POST do caso é o da TOP que permite.
  expect(posts.map((r) => (r.postDataJSON() as Record<string, unknown>)["tipo_operacao_id"]), "um POST só, o da TOP que permite").toEqual([permitido.id]);
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("F2C-3 — receber o pedido com a TOP de compra Automática + Permitido: 'Salvar e confirmar' no receber; sem item, a pendência continua e nada é enviado; com o item, o /convert confirma a compra gerada e o aviso é UM 'Salvo e confirmado.'", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  // O GRAFO, pela porta administrativa: a TOP de COMPRA (Automática + Permitido) e o Pedido de compra → Compra, "Em partes".
  const compra = await topDeCompra(page, "automática do receber", { confirmacao: "automatica", documentoSemItens: "permitido" });
  const topPedido = await criarTop(page, {
    codigo: codigoTop("f2p"), codigoBase: "compras.pedido", nome: uniq("F2C pedido"),
    destinos: [{ tipoOperacaoId: compra.id, ordem: 0, emPartes: true }]
  });
  const pedido = await api<{ id: string }>(page, "POST", "/api/compras/pedidos", {
    empresa_id: c.empresa, tipo_operacao_id: topPedido.id, fornecedor_id: c.fornecedor, data_documento: "2026-09-01",
    categoria_financeira_id: c.natureza.id, centro_custo_id: c.centro.id,
    itens: [{ produto_id: c.produto.id, quantidade: "5", valor_unitario: "20.00" }]
  });
  const lido = await api<{ situacao: string; itens: { id: string }[] }>(page, "GET", `/api/compras/pedidos/${pedido.id}`);
  expect([lido.situacao, lido.itens.length], "premissa: o pedido está aberto, com um item").toEqual(["aberto", 1]);
  const item = lido.itens[0]!.id;
  const posts: Request[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && caminho(r) === `/api/compras/pedidos/${pedido.id}/convert`) posts.push(r); });
  const salvar = page.getByTestId("compras-salvar");

  /** Abre a Central em modo RECEBER este pedido e devolve o `regrasGerais` que o servidor mandou para a TOP de compra. */
  async function abrirReceber(): Promise<unknown> {
    const regras = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === PORTA_DAS_REGRAS
      && new URL(r.url()).searchParams.get("tipo_operacao_id") === compra.id);
    await page.goto(`/compras/compras/new?tipo_operacao_id=${compra.id}&pedido=${pedido.id}`);
    const resposta = await regras;
    expect(resposta.status(), "premissa: o servidor respondeu as regras da TOP de compra do receber").toBe(200);
    await expect(page.getByTestId("compras-central"), "a Central abriu em modo receber").toHaveAttribute("data-modo", "receber");
    await expect(page.getByTestId("compras-central-receber")).toHaveAttribute("data-situacao", "pronto");
    await expect(page.getByTestId(`compras-receber-item-${item}`), "a linha do pedido").toBeVisible();
    await expect(salvar, "o Salvar saiu da trava: as regras chegaram").toBeEnabled();
    return (await resposta.json() as Record<string, unknown>)["regrasGerais"];
  }

  // (1) SEM ITEM NO RECEBER: a TOP permite documento sem itens, mas o recebimento é DOS itens do pedido — a pendência
  //     continua, e o clique não envia nada.
  expect(await abrirReceber(), "premissa: o servidor declara confirmação automática E documento sem itens").toEqual({ confirmacaoAutomatica: true, aceitaSemItens: true });
  await expect(salvar, "receber com a TOP Automática: o Salvar se chama 'Salvar e confirmar'").toHaveAttribute("aria-label", "Salvar e confirmar");
  await expect(salvar).toHaveAttribute("data-dica", "Salvar e confirmar");
  const linha = page.getByTestId(`compras-receber-item-${item}`);
  await linha.getByTestId(`${P}-selecionar-item`).click();
  await page.getByTestId("compras-itens").getByTestId(`${P}-remover-item`).click();
  await expect(linha, "premissa: a única linha saiu (a aresta é 'Em partes')").toHaveCount(0);
  await salvar.click();
  const pilula = page.getByTestId(`${P}-pendencias`);
  await expect(pilula).toBeVisible();
  const lista = page.getByTestId(`${P}-pendencias-lista`);
  if (!(await lista.isVisible())) await pilula.click();
  const semItens = lista.locator(`[data-testid="${P}-pendencia"][data-caminho="itens"]`);
  await expect(semItens, "no receber, sem itens CONTINUA pendência").toHaveCount(1);
  await expect(semItens).toContainText("Inclua ao menos um item.");
  await expect(page, "o clique com pendência não sai do receber").toHaveURL(new RegExp(`/compras/compras/new\\?.*pedido=${pedido.id}`));
  expect(posts, "ZERO POST de /convert").toHaveLength(0);

  // (2) COM O ITEM: o /convert grava a compra e a TOP dela a confirma; o aviso sai da RESPOSTA, um só.
  expect(await abrirReceber(), "premissa: a mesma declaração na reabertura").toEqual({ confirmacaoAutomatica: true, aceitaSemItens: true });
  await escolherNaCelula(page, page.getByTestId(`compras-receber-item-${item}`).getByTestId(`${P}-armazem`), c.nomeArmazem);
  await page.getByTestId("compras-numero-nota").fill(`F2C${Date.now().toString(36).toUpperCase()}`);
  await page.getByTestId("compras-serie-nota").fill("1");
  const entrada = page.getByTestId("compras-central").getByLabel("Data de entrada", { exact: true });
  await entrada.fill("05/09/2026");
  await entrada.press("Enter");
  await expect(page.getByTestId("compras-data-entrada").locator("input[type=hidden]"), "a data de entrada vira ISO no formulário").toHaveValue("2026-09-05");
  await expect(salvar).toHaveAttribute("aria-label", "Salvar e confirmar");
  const convert = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/compras/pedidos/${pedido.id}/convert`);
  await salvar.click();
  const rc = await convert;
  expect(rc.status(), "o recebimento foi gravado").toBe(201);
  const corpo = await rc.json() as CorpoDoSalvar;
  expect((rc.request().postDataJSON() as { itens: unknown[] }).itens, "o /convert levou o item do pedido").toHaveLength(1);
  expect([corpo.situacao, corpo.confirmacaoAutomatica], "a TOP da compra gerada a confirmou no fim do /convert").toEqual(["confirmado", { confirmado: true }]);
  await expect(avisoDoSalvar(page, "success"), "o aviso diz que confirmou").toHaveText(["Salvo e confirmado."]);
  await expect(avisos(page), "um aviso só (nada de 'Salvo com sucesso' ao lado)").toHaveCount(1);
  await consultaAbre(page, corpo.id, "confirmado");
  expect(posts, "um /convert só: o do receber com o item").toHaveLength(1);
});
