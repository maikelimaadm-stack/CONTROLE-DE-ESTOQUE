import type { Locator, Page, Request, Response } from "@playwright/test";
import { login, api, uniq, empresaAtiva, pickRef, adicionarItemNaCentral, escolherPrimeiroProdutoDaLinha, preencherClassificacaoFinanceira } from "./helpers";
import { cfg4, type RegrasGeraisE2E } from "./top-config-08-comum";
import { test, expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed } from "./central-compras-fixtures";

/**
 * OPERACOES-01 · F2 (decisão 279) — A APROVAÇÃO NA CONSULTA DO DOCUMENTO (API e banco REAIS; nada mockado).
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PROVA ──────────────────────────────────────────────────────────────────────────────────┐
 * │ F2A-1 VENDA, TOP Automática + aprovação "Sempre": o Salvar é "Salvar e confirmar"; o 201 diz que a confirmação │
 * │       ficou aguardando a aprovação, e o aviso é UM "Salvo. Este documento precisa de aprovação antes de ser    │
 * │       confirmado."; a consulta pergunta a situação (`GET /api/aprovacoes/vendas/<id>` → pendente, sem decisão) e │
 * │       mostra o bloco "Aguardando aprovação"; Aprovar abre o diálogo da fila, o POST leva SÓ a `version` que o  │
 * │       servidor tem, o 200 traz a confirmação automática, o aviso é "Aprovado e confirmado.", a venda fica      │
 * │       CONFIRMADA e o bloco some.                                                                               │
 * │ F2A-2 COMPRA, o espelho: o bloco na consulta da compra, o corpo do Aprovar VAZIO (a compra não leva versão), e a  │
 * │       compra CONFIRMADA.                                                                                       │
 * │ F2A-3 VENDA, TOP Manual + "Sempre": Reprovar exige o motivo (o botão fica desabilitado com ele vazio); com     │
 * │       "Preço alto" o POST leva motivo e versão; o bloco passa a "Reprovado" com a última decisão (quem, quando e   │
 * │       o motivo), os dois botões continuam e a venda segue ABERTA. Depois, Aprovar a mesma versão: o aviso é    │
 * │       "Aprovado." (a TOP Manual não confirma), o bloco passa a "Aprovado" com a nova última decisão, SEM os dois   │
 * │       botões (o recorte da fila: nada a decidir), e a venda segue ABERTA, à espera do Confirmar de quem confirma.  │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ A REGRA ANTI-VACUIDADE ───────────────────────────────────────────────────────────────────────────────────────┐
 * │ Toda conclusão da tela tem a PREMISSA ao lado, lida no FIO ou no SERVIDOR: o `regrasGerais` que a Central      │
 * │ recebeu para ESTA TOP (é ele que dá o rótulo do Salvar), o corpo do POST de lançar (o resultado da confirmação │
 * │ automática), o corpo da situação que a consulta recebeu (é ele que desenha o bloco), o corpo enviado e o recebido │
 * │ na decisão, e a situação do documento lida no servidor depois. O rótulo do Salvar só é lido com o botão        │
 * │ HABILITADO (regras pendentes o desabilitam; antes disso o rótulo é o neutro e passaria sem provar nada).       │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Tudo nasce no próprio caso, pela API: as TOPs (`cfg4`, o neutro do domínio com as regras pedidas — nunca um
 * literal daqui) e os cadastros saem pelas portas de `central-compras-fixtures`, que registram a exclusão lógica na
 * mesma chamada e a executam no FIM do caso, passou, falhou ou estourou o tempo — uma TOP que retém documento ou
 * confirma sozinha não sobra no lançador de quem vier depois. Natureza, centro, unidade e grupo vêm do seed, pelo
 * nome. Os documentos ficam (o ledger é imutável, decisão 247); a venda que termina aberta é CANCELADA no fim, para
 * não ficar na fila de Aprovações das próximas execuções.
 */

type CorpoDoLancar = Record<string, unknown> & { id: string; confirmacaoAutomatica?: unknown };
type CorpoDaSituacao = { situacao: string; ultimaDecisao: null | { decisao: string; observacao: string | null; decididoPor: { id: string; nome: string }; decididoEm: string } };
type Venda = { id: string; code: string; status: string; version: string | number };
type Decisao = "aprovar" | "reprovar";

/** Os textos EXATOS (os da Central de Estoque e os da fila de Aprovações — o pedido do Maike). */
const MSG_SALVO_AGUARDANDO_APROVACAO = "Salvo. Este documento precisa de aprovação antes de ser confirmado.";
const MSG_SALVO_COM_SUCESSO = "Salvo com sucesso";
const MSG_APROVADO_E_CONFIRMADO = "Aprovado e confirmado.";
const MSG_APROVADO = "Aprovado.";
const AGUARDANDO = { confirmado: false, motivo: "aguardando_aprovacao" } as const;

const PV = "central-vendas";
const PC = "central-compras";
const caminho = (r: Request | Response) => new URL(r.url()).pathname;
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * O aviso do TIPO dado, pela descrição (o seletor de W-5b): o texto certo no tom errado também reprova. `avisos`
 * conta TODOS os que estão na tela.
 */
const aviso = (page: Page, tipo: "success" | "info" | "warning" | "error") =>
  page.locator(`[data-sonner-toast] .erp-toast-panel--${tipo} .erp-toast-panel__description`);
const avisos = (page: Page) => page.locator("[data-sonner-toast]");

/** A resposta da situação da aprovação que a CONSULTA pede (o GET de UM documento da área). */
const ehSituacaoNoFio = (area: "vendas" | "compras") => (r: Response) =>
  r.request().method() === "GET" && new RegExp(`^/api/aprovacoes/${area}/[0-9a-f-]{36}$`).test(caminho(r));

/** O usuário da sessão, como o servidor o conhece (quem decide é ele: o nome aparece na última decisão). */
const usuarioDaSessao = async (page: Page) => (await api<{ user: { id: string; name: string } }>(page, "GET", "/api/auth/context")).user;

/** Uma TOP nova pela porta administrativa (limpeza automática), com as regras gerais pedidas sobre o neutro do domínio. */
async function topNova(page: Page, codigoBase: "vendas.venda" | "compras.compra", r: RegrasGeraisE2E): Promise<string> {
  const { id } = await criarTop(page, { codigo: codigoTop("f2a"), codigoBase, nome: uniq(`F2A ${codigoBase}`), configuracao: cfg4(r) });
  return id;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * A VENDA
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Abre a criação da venda com a TOP, escolhe um cliente novo, um item (o primeiro produto que a pesquisa oferece,
 * 1 × 40,00, sem local de estoque) e a classificação do seed. Devolve o `regrasGerais` que a PRÓPRIA tela recebeu
 * para esta TOP — o ouvinte nasce antes da navegação, então nenhuma resposta escapa. Só volta com o Salvar habilitado.
 */
async function prepararVenda(page: Page, top: string): Promise<unknown> {
  const cliente = uniq("Cliente F2A");
  await criarCadastro(page, "people", { name: cliente, person_type: "legal", is_client: true });
  const regras = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === "/api/sales/sales/regras-da-operacao"
    && new URL(r.url()).searchParams.get("tipo_operacao_id") === top);
  await page.goto(`/vendas/sales/new?tipo_operacao_id=${top}`);
  await expect(page.getByTestId("top-contexto"), "a Central abriu o formulário desta TOP").toBeVisible();
  const resposta = await regras;
  expect(resposta.status(), "premissa: a Central perguntou as regras da operação desta TOP").toBe(200);
  const corpo = await resposta.json() as Record<string, unknown>;
  await pickRef(page, "Cliente", cliente);
  await adicionarItemNaCentral(page);
  await escolherPrimeiroProdutoDaLinha(page);
  const linha = page.getByTestId(`${PV}-linha`).first();
  await linha.getByLabel("Quantidade").fill("1");
  await linha.getByLabel("Valor unitário").fill("40");
  await preencherClassificacaoFinanceira(page);
  await expect(page.getByTestId(`${PV}-salvar`), "habilitado: as regras chegaram (regras pendentes desabilitam o Salvar)").toBeEnabled();
  return corpo["regrasGerais"];
}

/**
 * Clica no Salvar e devolve o 201 (o corpo devolvido) e a SITUAÇÃO DA APROVAÇÃO que a consulta pediu ao abrir. Os dois
 * ouvintes nascem ANTES do clique: depois do POST a Central navega para a consulta, e a pergunta sai na montagem.
 */
async function salvarVenda(page: Page, vendas: string[]) {
  const post = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === "/api/sales/sales");
  const situacao = page.waitForResponse(ehSituacaoNoFio("vendas"));
  await page.getByTestId(`${PV}-salvar`).click();
  const r = await post;
  expect(r.status(), "a venda foi criada").toBe(201);
  const corpo = await r.json() as CorpoDoLancar;
  vendas.push(corpo.id);
  await expect(page, "depois do POST a Central abre a consulta do documento salvo").toHaveURL(new RegExp(`/vendas/sales/${corpo.id}$`));
  const s = await situacao;
  expect(caminho(s), "a consulta perguntou a situação DESTE documento").toBe(`/api/aprovacoes/vendas/${corpo.id}`);
  expect(s.status(), "a API respondeu a situação").toBe(200);
  return { corpo, situacao: await s.json() as CorpoDaSituacao };
}

const situacaoDaVenda = (page: Page) => page.getByTestId(`${PV}-situacao`).locator("[data-status]");
const vendaNoServidor = (page: Page, id: string) => api<Venda>(page, "GET", `/api/sales/sales/${id}`);

/** A venda que ficou aberta é cancelada no fim (fora da fila de Aprovações das próximas execuções). */
async function cancelarAbertas(page: Page, vendas: string[]) {
  for (const id of vendas) {
    const v = await vendaNoServidor(page, id).catch(() => null);
    if (v && ["open", "approved"].includes(v.status)) await api(page, "POST", `/api/sales/sales/${id}/cancel`, {}).catch(() => undefined);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * A DECISÃO NA CONSULTA (as mesmas peças nas duas Centrais)
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

const dialogo = (page: Page) => page.getByTestId("aprovacao-dialogo");

/** Clica em Aprovar/Reprovar do bloco e confere o diálogo da fila, com o título EXATO do documento. */
async function abrirDecisao(page: Page, prefixo: string, decisao: Decisao, codigo: string): Promise<Locator> {
  await page.getByTestId(`${prefixo}-${decisao}`).click();
  const d = dialogo(page);
  await expect(d, "a decisão abre o diálogo da fila de Aprovações").toBeVisible();
  const titulo = `${decisao === "aprovar" ? "Aprovar" : "Reprovar"} o documento ${codigo}?`;
  await expect(d.getByRole("heading", { name: titulo, exact: true }), "o título diz a decisão e o código do documento").toBeVisible();
  return d;
}

/** Envia a decisão pelo botão do diálogo e devolve o POST (o corpo enviado e o recebido) — o ouvinte nasce antes do clique. */
async function enviarDecisao(page: Page, area: "vendas" | "compras", id: string, decisao: Decisao) {
  const post = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/aprovacoes/${area}/${id}/${decisao}`);
  await dialogo(page).getByTestId("aprovacao-confirmar").click();
  const r = await post;
  return { status: r.status(), enviado: r.request().postDataJSON() as Record<string, unknown>, corpo: await r.json() as Record<string, unknown> };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("F2A-1 — venda, TOP Automática + aprovação 'Sempre': 'Salvar e confirmar' → aguardando aprovação ('Salvo. Este documento precisa de aprovação…') → bloco pendente na consulta → Aprovar (só a version) → 'Aprovado e confirmado.' e a venda confirmada, sem o bloco", async ({ page }) => {
  await login(page);
  const vendas: string[] = [];
  try {
    const top = await topNova(page, "vendas.venda", { confirmacao: "automatica", aprovacao: "sempre" });

    // (1) A CRIAÇÃO: o servidor declara a confirmação no Salvar, e a Central diz isso ANTES de salvar.
    expect(await prepararVenda(page, top), "premissa: o servidor declara que a TOP confirma ao salvar (e pede item)")
      .toEqual({ confirmacaoAutomatica: true, aceitaSemItens: false });
    await expect(page.getByTestId(`${PV}-salvar`), "TOP Automática: o nome acessível do Salvar, exato").toHaveAttribute("aria-label", "Salvar e confirmar");

    // (2) O SALVAR: a confirmação automática esbarra na aprovação; o aviso sai da RESPOSTA, um só.
    const { corpo, situacao } = await salvarVenda(page, vendas);
    expect(corpo.confirmacaoAutomatica, "o servidor salvou e a confirmação ficou aguardando a aprovação").toEqual(AGUARDANDO);
    await expect(aviso(page, "info"), "o aviso da aprovação pendente, letra por letra, no tom informativo").toHaveText([MSG_SALVO_AGUARDANDO_APROVACAO]);
    await expect(avisos(page), "um aviso só (nada de 'Salvo com sucesso' ao lado)").toHaveCount(1);
    const salva = await vendaNoServidor(page, corpo.id);
    expect(salva.status, "no servidor, a venda está aberta").toBe("open");
    await expect(situacaoDaVenda(page), "a consulta mostra a venda aberta").toHaveAttribute("data-status", "open");
    await expect(page.getByTestId(PV).locator('[data-campo="Número"]'), "a consulta desenhou ESTE documento").toContainText(salva.code);

    // (3) A SITUAÇÃO: o que a consulta recebeu no fio é o que o bloco mostra.
    expect(situacao, "a situação no fio: pendente, sem decisão nenhuma").toEqual({ situacao: "pendente", ultimaDecisao: null });
    const bloco = page.getByTestId(`${PV}-aprovacao`);
    await expect(bloco, "o bloco da aprovação aparece pendente").toHaveAttribute("data-situacao", "pendente");
    await expect(page.getByTestId(`${PV}-aprovacao-situacao`), "com o selo do vocabulário de situação").toHaveText("Aguardando aprovação");
    await expect(page.getByTestId(`${PV}-aprovacao-decisao`), "sem decisão, sem a frase da última decisão").toHaveCount(0);

    // (4) APROVAR: o diálogo da fila; o corpo leva SÓ a versão que o servidor tem (a do conteúdo que a tela mostra).
    await abrirDecisao(page, PV, "aprovar", salva.code);
    await expect(dialogo(page).getByTestId("aprovacao-observacao"), "aprovar oferece a observação (opcional)").toHaveValue("");
    await expect(dialogo(page).getByTestId("aprovacao-confirmar"), "sem observação, Aprovar já está habilitado").toBeEnabled();
    const decidida = await enviarDecisao(page, "vendas", corpo.id, "aprovar");
    expect(Object.keys(decidida.enviado).sort(), "o corpo do Aprovar: exatamente a versão (sem observação, nenhuma chave a mais)").toEqual(["version"]);
    expect(String(decidida.enviado["version"]), "a versão é a do documento no servidor").toBe(String(salva.version));
    expect(decidida.status, "o servidor aprovou").toBe(200);
    expect(decidida.corpo["aprovacao"], "a decisão gravada é a aprovação").toMatchObject({ decisao: "aprovado" });
    expect(decidida.corpo["confirmacaoAutomatica"], "e a aprovação disparou a confirmação automática").toEqual({ confirmado: true });

    // (5) O EFEITO: o aviso da fila, a venda confirmada (tela e servidor), e o bloco some.
    await expect(aviso(page, "success"), "o aviso da aprovação, letra por letra").toHaveText([MSG_APROVADO_E_CONFIRMADO]);
    await expect(dialogo(page), "o diálogo fechou").toHaveCount(0);
    await expect(situacaoDaVenda(page), "a consulta mostra a venda confirmada").toHaveAttribute("data-status", "confirmed");
    expect((await vendaNoServidor(page, corpo.id)).status, "no servidor também").toBe("confirmed");
    await expect(bloco, "documento confirmado: não há o que aprovar, e o bloco some").toHaveCount(0);
  } finally {
    await cancelarAbertas(page, vendas);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * A COMPRA
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

/** Escolhe no RefSelect da Central de Compras pelo rótulo do campo (nome escapado: nomes do seed têm colchetes). */
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
  const pesquisa = page.getByTestId(`${PC}-pesquisa`);
  await expect(pesquisa).toBeVisible();
  await pesquisa.getByPlaceholder("Pesquisar pela descrição").fill(nome);
  await pesquisa.getByRole("option", { name: literal(nome) }).first().click();
  await expect(pesquisa).toHaveCount(0);
}

/** O cadastro do caso: fornecedor, local de estoque e produto CRIADOS aqui; natureza e centro do seed, pelo nome. */
async function cenarioDaCompra(page: Page) {
  const ref = await referenciasDoSeed(page);
  const p = await criarCadastro(page, "products", { description: uniq("F2A produto"), group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id });
  const nomeProduto = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${p.id}`))["description"]);
  const empresa = await empresaAtiva(page);
  const armazem = (await criarCadastro(page, "warehouses", {
    empresa_id: empresa, initials: `A${Date.now().toString(36).slice(-4).toUpperCase()}`, description: uniq("F2A local"), type: "inputs"
  })).id;
  const nomeArmazem = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${armazem}`))["description"]);
  const fornecedor = (await criarCadastro(page, "people", { name: uniq("F2A forn"), person_type: "legal", is_provider: true })).id;
  const nomeFornecedor = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${fornecedor}`))["name"]);
  return { nomeProduto, nomeArmazem, nomeFornecedor, natureza: ref.natureza, centro: ref.centro };
}

test("F2A-2 — compra, TOP Automática + aprovação 'Sempre': 'Salvar e confirmar' → aguardando aprovação → bloco pendente na consulta da compra → Aprovar (corpo vazio) → 'Aprovado e confirmado.' e a compra confirmada, sem o bloco", async ({ page }) => {
  await login(page);
  const c = await cenarioDaCompra(page);
  const top = await topNova(page, "compras.compra", { confirmacao: "automatica", aprovacao: "sempre" });

  // (1) A CRIAÇÃO: as regras desta TOP no fio, e o Salvar que diz o que vai acontecer.
  const regras = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === "/api/compras/compras/regras-da-operacao"
    && new URL(r.url()).searchParams.get("tipo_operacao_id") === top);
  await page.goto(`/compras/compras/new?tipo_operacao_id=${top}`);
  const rr = await regras;
  expect(rr.status(), "premissa: o servidor respondeu as regras da operação").toBe(200);
  expect((await rr.json() as Record<string, unknown>)["regrasGerais"], "premissa: o servidor declara que a TOP confirma ao salvar (e pede item)")
    .toEqual({ confirmacaoAutomatica: true, aceitaSemItens: false });
  await expect(page.getByTestId("compras-central")).toHaveAttribute("data-especie", "compra");
  const salvar = page.getByTestId("compras-salvar");
  await expect(salvar, "o Salvar saiu da trava: as regras chegaram").toBeEnabled();
  await expect(salvar, "TOP Automática: o Salvar se chama 'Salvar e confirmar'").toHaveAttribute("aria-label", "Salvar e confirmar");
  await escolher(page, "Fornecedor", c.nomeFornecedor);
  await escolher(page, "Natureza de despesa", c.natureza.label);
  await escolher(page, "Centro de resultado", c.centro.label);
  await page.getByTestId(`${PC}-adicionar-item`).click();
  const linha = page.getByTestId(`${PC}-linha`).first();
  await escolherNaCelula(page, linha.getByTestId(`${PC}-produto`), c.nomeProduto);
  await escolherNaCelula(page, linha.getByTestId(`${PC}-armazem`), c.nomeArmazem);
  await linha.getByLabel("Quantidade do item 1").fill("5");
  await linha.getByLabel("Valor unitário do item 1").fill("20");
  await expect(page.getByTestId(`${PC}-subtotal`)).toContainText("100,00");

  // (2) O SALVAR: aberta e aguardando a aprovação; o aviso sai da RESPOSTA, um só.
  const post = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === "/api/compras/compras");
  const situacaoNoFio = page.waitForResponse(ehSituacaoNoFio("compras"));
  await salvar.click();
  const rp = await post;
  expect(rp.status(), "a compra foi criada").toBe(201);
  const corpo = await rp.json() as CorpoDoLancar;
  expect([corpo["situacao"], corpo.confirmacaoAutomatica], "o servidor salvou aberta, com a confirmação aguardando a aprovação").toEqual(["aberto", AGUARDANDO]);
  await expect(aviso(page, "info"), "o aviso da aprovação pendente, letra por letra, no tom informativo").toHaveText([MSG_SALVO_AGUARDANDO_APROVACAO]);
  await expect(avisos(page), "um aviso só").toHaveCount(1);
  await expect(page, "depois do POST a Central abre a consulta da compra salva").toHaveURL(new RegExp(`/compras/compras/${corpo.id}$`));
  const consulta = page.getByTestId("compras-consulta-corpo");
  await expect(consulta, "a consulta abre a compra aberta").toHaveAttribute("data-situacao", "aberto");
  const lida = await api<{ codigo: string; situacao: string }>(page, "GET", `/api/compras/compras/${corpo.id}`);
  expect(lida.situacao, "no servidor, aberta").toBe("aberto");

  // (3) A SITUAÇÃO: o que a consulta recebeu no fio é o que o bloco mostra.
  const s = await situacaoNoFio;
  expect(caminho(s), "a consulta perguntou a situação DESTA compra").toBe(`/api/aprovacoes/compras/${corpo.id}`);
  expect([s.status(), await s.json()], "a situação no fio: pendente, sem decisão nenhuma").toEqual([200, { situacao: "pendente", ultimaDecisao: null }]);
  const bloco = page.getByTestId(`${PC}-aprovacao`);
  await expect(bloco, "o bloco da aprovação aparece pendente").toHaveAttribute("data-situacao", "pendente");
  await expect(page.getByTestId(`${PC}-aprovacao-situacao`)).toHaveText("Aguardando aprovação");

  // (4) APROVAR: a compra não leva versão, e sem observação o corpo é VAZIO.
  await abrirDecisao(page, PC, "aprovar", lida.codigo);
  const decidida = await enviarDecisao(page, "compras", corpo.id, "aprovar");
  expect(decidida.enviado, "o corpo do Aprovar da compra: nenhuma chave").toEqual({});
  expect(decidida.status, "o servidor aprovou").toBe(200);
  expect(decidida.corpo["aprovacao"], "a decisão gravada é a aprovação").toMatchObject({ decisao: "aprovado" });
  expect(decidida.corpo["confirmacaoAutomatica"], "e a aprovação disparou a confirmação automática").toEqual({ confirmado: true });

  // (5) O EFEITO: o aviso, a compra confirmada (tela e servidor), e o bloco some.
  await expect(aviso(page, "success"), "o aviso da aprovação, letra por letra").toHaveText([MSG_APROVADO_E_CONFIRMADO]);
  await expect(consulta, "a consulta mostra a compra confirmada").toHaveAttribute("data-situacao", "confirmado");
  expect((await api<{ situacao: string }>(page, "GET", `/api/compras/compras/${corpo.id}`)).situacao, "no servidor também").toBe("confirmado");
  await expect(bloco, "compra confirmada: o bloco some").toHaveCount(0);
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("F2A-3 — venda, TOP Manual + aprovação 'Sempre': Reprovar exige o motivo; com 'Preço alto' o POST leva motivo e version, o bloco fica 'Reprovado' com a última decisão, os botões continuam e a venda segue aberta; Aprovar depois → 'Aprovado.', o bloco 'Aprovado' sem botões e a venda aberta", async ({ page }) => {
  await login(page);
  const vendas: string[] = [];
  try {
    const eu = await usuarioDaSessao(page);
    const top = await topNova(page, "vendas.venda", { confirmacao: "manual", aprovacao: "sempre" });

    // (1) A CRIAÇÃO E O SALVAR DE ANTES: a TOP Manual não confirma ao salvar, e a Central é a de antes.
    expect(await prepararVenda(page, top), "premissa: o servidor declara que a TOP Manual não confirma ao salvar").toEqual({ confirmacaoAutomatica: false, aceitaSemItens: false });
    await expect(page.getByTestId(`${PV}-salvar`), "TOP Manual: o rótulo de antes").toHaveAttribute("aria-label", "Salvar");
    const { corpo, situacao } = await salvarVenda(page, vendas);
    expect("confirmacaoAutomatica" in corpo, "TOP Manual: o 201 de antes, sem a chave").toBe(false);
    await expect(aviso(page, "success"), "sem a chave, o aviso de antes").toHaveText([MSG_SALVO_COM_SUCESSO]);
    await expect(avisos(page), "um aviso só").toHaveCount(1);
    const salva = await vendaNoServidor(page, corpo.id);
    expect(situacao, "a situação no fio: pendente, sem decisão nenhuma").toEqual({ situacao: "pendente", ultimaDecisao: null });
    const bloco = page.getByTestId(`${PV}-aprovacao`);
    await expect(bloco).toHaveAttribute("data-situacao", "pendente");

    // (2) REPROVAR SEM MOTIVO: o botão fica desabilitado (a premissa do motivo obrigatório).
    const d = await abrirDecisao(page, PV, "reprovar", salva.code);
    await expect(d.getByTestId("aprovacao-motivo"), "o motivo começa vazio").toHaveValue("");
    await expect(d.getByTestId("aprovacao-confirmar"), "sem motivo, Reprovar fica desabilitado").toBeDisabled();

    // (3) COM O MOTIVO: o POST leva o motivo e a versão do documento no servidor.
    await d.getByTestId("aprovacao-motivo").fill("Preço alto");
    await expect(d.getByTestId("aprovacao-confirmar"), "com o motivo, habilita").toBeEnabled();
    const decidida = await enviarDecisao(page, "vendas", corpo.id, "reprovar");
    expect(Object.keys(decidida.enviado).sort(), "o corpo do Reprovar: o motivo e a versão, nada mais").toEqual(["motivo", "version"]);
    expect([decidida.enviado["motivo"], String(decidida.enviado["version"])], "o motivo digitado e a versão do servidor").toEqual(["Preço alto", String(salva.version)]);
    expect(decidida.status, "o servidor reprovou").toBe(200);
    expect(decidida.corpo["aprovacao"], "a decisão gravada é a reprovação").toMatchObject({ decisao: "reprovado" });
    expect("confirmacaoAutomatica" in decidida.corpo, "reprovar nunca confirma").toBe(false);

    // (4) O BLOCO: "Reprovado", com quem, quando e o motivo — e a decisão no servidor é a mesma.
    await expect(dialogo(page), "o diálogo fechou").toHaveCount(0);
    await expect(bloco, "o bloco passa a reprovado").toHaveAttribute("data-situacao", "reprovado");
    await expect(page.getByTestId(`${PV}-aprovacao-situacao`), "com o selo do vocabulário de situação").toHaveText("Reprovado");
    const noServidor = await api<CorpoDaSituacao>(page, "GET", `/api/aprovacoes/vendas/${corpo.id}`);
    expect(noServidor.situacao, "no servidor: reprovado").toBe("reprovado");
    expect(noServidor.ultimaDecisao, "a última decisão no servidor: a reprovação, com o motivo e quem decidiu")
      .toMatchObject({ decisao: "reprovado", observacao: "Preço alto", decididoPor: { id: eu.id, nome: eu.name } });
    // A data e a hora, formatadas pelo PRÓPRIO navegador (o mesmo locale e fuso da tela) a partir do que o servidor gravou.
    const quando = await page.evaluate((iso) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }), noServidor.ultimaDecisao!.decididoEm);
    const frase = page.getByTestId(`${PV}-aprovacao-decisao`);
    await expect(frase, "a frase começa por quem reprovou e termina no motivo")
      .toHaveText(new RegExp(`^${escapar(`Última decisão: Reprovado por ${eu.name} em `)}.+${escapar(". Motivo: Preço alto")}$`));
    await expect(frase, "com a data e a hora da decisão").toHaveText(`Última decisão: Reprovado por ${eu.name} em ${quando}. Motivo: Preço alto`);

    // (5) REPROVADO NÃO FECHA NADA: os dois botões continuam (pode-se aprovar depois) e a venda segue aberta.
    await expect(page.getByTestId(`${PV}-aprovar`), "Aprovar continua").toBeVisible();
    await expect(page.getByTestId(`${PV}-reprovar`), "Reprovar continua").toBeVisible();
    await expect(situacaoDaVenda(page), "a venda segue aberta na consulta").toHaveAttribute("data-status", "open");
    expect((await vendaNoServidor(page, corpo.id)).status, "e no servidor").toBe("open");
    await expect(aviso(page, "error"), "nenhum aviso de erro").toHaveCount(0);
    await expect(aviso(page, "warning"), "nenhum aviso de alerta").toHaveCount(0);

    // (6) APROVAR DEPOIS DA REPROVAÇÃO: a decisão não mexe na versão da venda, e a TOP Manual não confirma — o bloco
    //     passa a "Aprovado", com a nova última decisão, e já não oferece decidir (o recorte da fila).
    const reprovada = await vendaNoServidor(page, corpo.id);
    expect(String(reprovada.version), "premissa: reprovar não mudou a versão da venda").toBe(String(salva.version));
    await abrirDecisao(page, PV, "aprovar", salva.code);
    const aprovada = await enviarDecisao(page, "vendas", corpo.id, "aprovar");
    expect([Object.keys(aprovada.enviado), String(aprovada.enviado["version"])], "o corpo do Aprovar: só a versão do servidor").toEqual([["version"], String(salva.version)]);
    expect(aprovada.status, "o servidor aprovou").toBe(200);
    expect(aprovada.corpo["aprovacao"], "a decisão gravada é a aprovação").toMatchObject({ decisao: "aprovado" });
    expect("confirmacaoAutomatica" in aprovada.corpo, "TOP Manual: aprovar não confirma").toBe(false);
    await expect(aviso(page, "success"), "o aviso da fila para a aprovação sem confirmação, letra por letra").toHaveText([MSG_APROVADO]);
    await expect(dialogo(page), "o diálogo fechou").toHaveCount(0);
    await expect(bloco, "o bloco passa a aprovado").toHaveAttribute("data-situacao", "aprovado");
    await expect(page.getByTestId(`${PV}-aprovacao-situacao`), "com o selo do vocabulário de situação").toHaveText("Aprovado");
    const depois = await api<CorpoDaSituacao>(page, "GET", `/api/aprovacoes/vendas/${corpo.id}`);
    expect(depois.situacao, "no servidor: aprovado").toBe("aprovado");
    expect(depois.ultimaDecisao, "a última decisão no servidor: a aprovação, sem observação, de quem decidiu")
      .toMatchObject({ decisao: "aprovado", observacao: null, decididoPor: { id: eu.id, nome: eu.name } });
    const quandoAprovou = await page.evaluate((iso) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }), depois.ultimaDecisao!.decididoEm);
    await expect(frase, "a frase da nova última decisão, sem observação").toHaveText(`Última decisão: Aprovado por ${eu.name} em ${quandoAprovou}.`);
    await expect(page.getByTestId(`${PV}-aprovar`), "aprovado: nada a decidir, Aprovar sai").toHaveCount(0);
    await expect(page.getByTestId(`${PV}-reprovar`), "e Reprovar também").toHaveCount(0);
    await expect(situacaoDaVenda(page), "a venda segue aberta (a TOP Manual espera o Confirmar)").toHaveAttribute("data-status", "open");
    expect((await vendaNoServidor(page, corpo.id)).status, "e no servidor").toBe("open");
  } finally {
    await cancelarAbertas(page, vendas);
  }
});
