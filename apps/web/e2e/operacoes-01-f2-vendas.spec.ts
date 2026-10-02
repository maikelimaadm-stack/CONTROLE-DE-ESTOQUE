import { test, expect, type Page, type Request } from "@playwright/test";
import { login, api, uniq, pickRef, adicionarItemNaCentral, escolherPrimeiroProdutoDaLinha, preencherClassificacaoFinanceira } from "./helpers";
import { criarParceiro } from "./aj02-comum";
import { cfg4, cfg5, criarTopViaApi, detalheTopNoServidor, excluirTopE2E, type RegrasGeraisE2E } from "./top-config-08-comum";

/**
 * OPERACOES-01 · F2 (decisão 279) — A CENTRAL DE VENDAS USA AS REGRAS GERAIS DA TOP (API e banco REAIS; nada mockado).
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PROVA ──────────────────────────────────────────────────────────────────────────────────┐
 * │ F2V-1 — TOP de Confirmação Automática: o servidor declara `regrasGerais.confirmacaoAutomatica` em              │
 * │   `/regras-da-operacao`, o Salvar se chama EXATAMENTE "Salvar e confirmar", o 201 traz `{ confirmado: true }`, │
 * │   aparece UM aviso de sucesso "Salvo e confirmado." e a consulta abre a venda CONFIRMADA. Contraste na MESMA   │
 * │   execução: TOP Manual → "Salvar", o 201 sem a chave, UM aviso "Salvo com sucesso" e a consulta aberta. E quem │
 * │   não pode confirmar a venda (a sessão sem `sales.edit`) vê "Salvar" na MESMA TOP Automática, sem a pílula     │
 * │   "Confirmar venda": o rótulo não promete o que o servidor não vai fazer (ele responderia "sem permissão").    │
 * │ F2V-2 — documento sem itens: TOP com "Documento sem itens" Permitido → o clique no Salvar sem item ENVIA (o    │
 * │   handler só envia com a lista de pendências vazia): o POST leva `items: []`, 201, e a consulta abre aberta com  │
 * │   0 itens. Contraste: TOP Proibido → a pendência `data-caminho="items"` "Adicione ao menos um item." e ZERO POST. │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ A REGRA ANTI-VACUIDADE ───────────────────────────────────────────────────────────────────────────────────────┐
 * │ Toda conclusão da tela tem a PREMISSA ao lado, lida no FIO: o corpo de `/regras-da-operacao` que a própria     │
 * │ tela recebeu para ESTA TOP (é ele que muda o rótulo e a pendência), e o corpo do POST que ela mandou e recebeu.   │
 * │ O rótulo só é lido com o Salvar HABILITADO — habilitado prova que as regras já chegaram (regras pendentes      │
 * │ desabilitam o botão); antes disso o rótulo é o neutro e "Salvar" passaria sem provar nada. O ZERO POST da      │
 * │ pendência é contado pelo MESMO ouvinte que, no caso Permitido, contou exatamente um POST.                      │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * A configuração da TOP nasce do neutro do domínio (`cfg4`/`cfg5`, das peças comuns da TOP-CONFIG-08, só importadas)
 * e é gravada pela API administrativa no próprio teste. Quem diz o que a TOP executa é o servidor, pela MESMA régua da
 * gravação, no `regrasGerais` do fio — é essa a premissa da tela. O formato gravado é premissa à parte (o detalhe da
 * TOP no servidor): a TOP Automática do F2V-1 é do FORMATO 5 — o que o editor grava desde a F4 (decisão 281) — e as
 * outras, do 4; os dois formatos passam pela mesma Central.
 * Cada caso cria o próprio cliente; o produto é o primeiro que a pesquisa oferece, de 1 × 40,00, SEM local de estoque
 * (nada de saldo em jogo). Nada é apagado (decisão 247): no `finally`, o que ficou aberto é cancelado e as TOPs saem
 * pela exclusão lógica da própria API, para o lançador das próximas execuções não herdar uma operação que confirma
 * sozinha.
 */

/** O bloco das regras gerais como o servidor o declara (OPERACOES-01 F2). */
type RegrasGeraisNoFio = { confirmacaoAutomatica: boolean; aceitaSemItens: boolean };
type RegrasNoFio = { regrasGerais?: RegrasGeraisNoFio };
type Venda = { id: string; code: string; status: string; items: unknown[] };
type CorpoDoSalvar = { id: string; confirmacaoAutomatica?: unknown };
type CorpoEnviado = { tipo_operacao_id: string; items: { warehouse_id?: string | null }[] };

const WORKSPACE = "central-vendas";
const ehPostDeVenda = (r: Request) => r.method() === "POST" && new URL(r.url()).pathname === "/api/sales/sales";
const botaoSalvar = (page: Page) => page.getByTestId("central-vendas-salvar");
const situacaoNaConsulta = (page: Page) => page.getByTestId("central-vendas-situacao").locator("[data-status]");
/**
 * O aviso do Salvar: o toast do TIPO dado, pela descrição (o seletor de W-5b). O tipo entra no seletor: o texto certo
 * no tom errado também reprova.
 */
const avisoDoSalvar = (page: Page, tipo: "success" | "info" | "warning") =>
  page.locator(`[data-sonner-toast] .erp-toast-panel--${tipo} .erp-toast-panel__description`);
/** Todos os avisos na tela — um Salvar dá UM aviso. */
const avisos = (page: Page) => page.locator("[data-sonner-toast]");

/** Uma TOP de venda nova, com as regras gerais pedidas sobre o neutro do domínio, no formato pedido (premissa lida no servidor). */
async function criarTopDeVenda(page: Page, r: RegrasGeraisE2E, tops: string[], formato: 4 | 5 = 4): Promise<string> {
  const { id } = await criarTopViaApi(page, "vendas.venda", formato === 5 ? cfg5(r) : cfg4(r), { rotulo: "F2V vendas.venda" });
  tops.push(id);
  expect((await detalheTopNoServidor(page, id)).configuracaoSchema, `premissa: a TOP foi gravada no formato ${formato}`).toBe(formato);
  return id;
}

/**
 * Abre a criação da venda com a TOP e escolhe um cliente novo. Devolve o corpo de `/regras-da-operacao` que a PRÓPRIA
 * tela recebeu para esta TOP — o ouvinte nasce antes da navegação, então nenhuma resposta escapa.
 */
async function abrirCriacao(page: Page, top: string): Promise<RegrasNoFio> {
  const cliente = uniq("Cliente F2V");
  await criarParceiro(page, { name: cliente });
  const regras = page.waitForResponse((r) => {
    const u = new URL(r.url());
    return r.request().method() === "GET" && u.pathname === "/api/sales/sales/regras-da-operacao" && u.searchParams.get("tipo_operacao_id") === top;
  });
  await page.goto(`/vendas/sales/new?tipo_operacao_id=${top}`);
  await expect(page.getByTestId("top-contexto"), "a Central abriu o formulário desta TOP").toBeVisible();
  const resposta = await regras;
  expect(resposta.status(), "a Central perguntou as regras da operação desta TOP").toBe(200);
  const corpo = await resposta.json() as RegrasNoFio;
  await pickRef(page, "Cliente", cliente);
  return corpo;
}

/** Um item: o primeiro produto que a pesquisa oferece, 1 × 40,00 (o preenchimento de `preencherVendaNaCentral`). */
async function adicionarUmItem(page: Page) {
  await adicionarItemNaCentral(page);
  await escolherPrimeiroProdutoDaLinha(page);
  const linha = page.getByTestId("central-vendas-linha").first();
  await linha.getByLabel("Quantidade").fill("1");
  await linha.getByLabel("Valor unitário").fill("40");
}

/** Clica no Salvar e devolve o 201 (o corpo enviado e o devolvido). O aviso é conferido por quem chama, logo depois. */
async function salvar(page: Page, vendas: string[]) {
  const resposta = page.waitForResponse((r) => ehPostDeVenda(r.request()));
  await botaoSalvar(page).click();
  const r = await resposta;
  expect(r.status(), "a venda foi criada").toBe(201);
  const corpo = await r.json() as CorpoDoSalvar;
  vendas.push(corpo.id);
  return { corpo, enviado: r.request().postDataJSON() as CorpoEnviado };
}

/** Depois do aviso, a Central abre a consulta DESTE documento, na situação que o servidor leu. */
async function consultaAbre(page: Page, id: string, situacao: "open" | "confirmed"): Promise<Venda> {
  await expect(page, "depois do POST a Central abre a consulta do documento salvo").toHaveURL(new RegExp(`/vendas/sales/${id}$`));
  const lida = await api<Venda>(page, "GET", `/api/sales/sales/${id}`);
  await expect(page.getByTestId(WORKSPACE).locator('[data-campo="Número"]'), "a consulta desenhou ESTE documento").toContainText(lida.code);
  await expect(situacaoNaConsulta(page), `a consulta mostra a venda ${situacao}`).toHaveAttribute("data-status", situacao);
  expect(lida.status, "no servidor também").toBe(situacao);
  return lida;
}

/** Cancela o que ficou aberto e exclui (logicamente) as TOPs do caso. */
async function limpar(page: Page, vendas: string[], tops: string[]) {
  for (const id of vendas) {
    const v = await api<Venda>(page, "GET", `/api/sales/sales/${id}`).catch(() => null);
    if (v && ["open", "approved"].includes(v.status)) await api(page, "POST", `/api/sales/sales/${id}/cancel`, {}).catch(() => undefined);
  }
  for (const id of tops) await excluirTopE2E(page, id);
}

test("F2V-1 — TOP Automática: o Salvar se chama 'Salvar e confirmar', salva confirmando e avisa 'Salvo e confirmado.' (um aviso); TOP Manual: 'Salvar', 'Salvo com sucesso' e a consulta aberta; sem sales.edit, 'Salvar'", async ({ page }) => {
  await login(page);
  const vendas: string[] = []; const tops: string[] = [];
  try {
    // (1) O CONTRASTE — TOP Manual: o servidor declara que o Salvar não confirma, e a Central é a de antes.
    const manual = await criarTopDeVenda(page, { confirmacao: "manual" }, tops);
    const regrasManual = await abrirCriacao(page, manual);
    expect(regrasManual.regrasGerais, "o servidor declara: a TOP Manual não confirma ao salvar").toEqual({ confirmacaoAutomatica: false, aceitaSemItens: false });
    await adicionarUmItem(page);
    await preencherClassificacaoFinanceira(page);
    await expect(botaoSalvar(page), "habilitado: as regras chegaram (regras pendentes desabilitam o Salvar)").toBeEnabled();
    await expect(botaoSalvar(page), "TOP Manual: o rótulo de antes").toHaveAttribute("aria-label", "Salvar");
    await expect(botaoSalvar(page), "e a dica também").toHaveAttribute("data-dica", "Salvar");
    const deHoje = await salvar(page, vendas);
    expect(deHoje.enviado.tipo_operacao_id, "o corpo leva a TOP Manual").toBe(manual);
    expect("confirmacaoAutomatica" in deHoje.corpo, "TOP Manual: o 201 de antes, sem a chave").toBe(false);
    await expect(avisoDoSalvar(page, "success"), "sem a chave, o aviso de antes, byte a byte").toHaveText(["Salvo com sucesso"]);
    await expect(avisos(page), "um aviso só").toHaveCount(1);
    await consultaAbre(page, deHoje.corpo.id, "open");

    // (2) TOP AUTOMÁTICA, no FORMATO 5 (o que o editor grava desde a F4): o servidor declara a confirmação no Salvar,
    //     a Central diz isso ANTES de salvar, e o aviso sai da RESPOSTA.
    const automatica = await criarTopDeVenda(page, { confirmacao: "automatica" }, tops, 5);
    const regrasAutomatica = await abrirCriacao(page, automatica);
    expect(regrasAutomatica.regrasGerais, "o servidor declara: a TOP Automática confirma ao salvar (e pede item)").toEqual({ confirmacaoAutomatica: true, aceitaSemItens: false });
    await adicionarUmItem(page);
    await preencherClassificacaoFinanceira(page);
    await expect(botaoSalvar(page), "habilitado: as regras chegaram").toBeEnabled();
    await expect(botaoSalvar(page), "TOP Automática: o nome acessível do Salvar, exato").toHaveAttribute("aria-label", "Salvar e confirmar");
    await expect(botaoSalvar(page), "e a dica também").toHaveAttribute("data-dica", "Salvar e confirmar");
    await expect(page.getByTestId(WORKSPACE).getByRole("button", { name: "Salvar e confirmar", exact: true }), "um botão só com esse nome: o Salvar").toHaveCount(1);
    const confirmada = await salvar(page, vendas);
    expect(confirmada.enviado.tipo_operacao_id, "o corpo leva a TOP Automática").toBe(automatica);
    // Premissa: o item vai SEM local de estoque (nada de saldo em jogo) — a confirmação não depende do estoque desta base.
    expect(confirmada.enviado.items.map((i) => i.warehouse_id ?? null), "premissa: um item, sem local de estoque").toEqual([null]);
    expect(confirmada.corpo.confirmacaoAutomatica, "o servidor confirmou no fim do POST").toEqual({ confirmado: true });
    await expect(avisoDoSalvar(page, "success"), "o aviso lido da resposta").toHaveText(["Salvo e confirmado."]);
    await expect(avisos(page), "um aviso só (nada de 'Salvo com sucesso' ao lado)").toHaveCount(1);
    await consultaAbre(page, confirmada.corpo.id, "confirmed");

    // (3) QUEM NÃO PODE CONFIRMAR A VENDA: a MESMA TOP Automática, numa sessão cujo contexto não traz `sales.edit` (a
    //     capacidade que a confirmação automática confere). O servidor declara a mesma coisa — as regras são da TOP,
    //     não de quem pergunta —, e a tela não promete a confirmação: "Salvar", sem a pílula "Confirmar venda". Só a
    //     APRESENTAÇÃO muda (`can()` só esconde): nada é salvo aqui; o "sem permissão" do servidor é provado na API.
    const retirados: string[] = [];
    await page.route("**/api/auth/context", async (rota) => {
      const resposta = await rota.fetch();
      const corpo = await resposta.json() as { permissions: string[] };
      retirados.push(...corpo.permissions.filter((p) => p === "sales.edit"));
      await rota.fulfill({ response: resposta, json: { ...corpo, isOwner: false, permissions: corpo.permissions.filter((p) => p !== "sales.edit") } });
    });
    try {
      const semConfirmar = await abrirCriacao(page, automatica);
      expect(retirados.length, "premissa: a sessão real TEM sales.edit, e o contexto que a tela leu o perdeu").toBeGreaterThan(0);
      expect(semConfirmar.regrasGerais, "premissa: o servidor declara a MESMA confirmação automática para esta TOP").toEqual({ confirmacaoAutomatica: true, aceitaSemItens: false });
      await preencherClassificacaoFinanceira(page);
      await expect(botaoSalvar(page), "habilitado: as regras chegaram").toBeEnabled();
      await expect(page.getByTestId("central-vendas-confirmar"), "premissa: sem sales.edit a tela não oferece 'Confirmar venda'").toHaveCount(0);
      await expect(botaoSalvar(page), "sem poder confirmar: o rótulo de antes, mesmo com a TOP Automática").toHaveAttribute("aria-label", "Salvar");
      await expect(botaoSalvar(page), "e a dica também").toHaveAttribute("data-dica", "Salvar");
      await expect(page.getByTestId(WORKSPACE).getByRole("button", { name: "Salvar e confirmar", exact: true }), "nenhum botão promete a confirmação").toHaveCount(0);
    } finally {
      await page.unroute("**/api/auth/context");
    }
  } finally {
    await limpar(page, vendas, tops);
  }
});

test("F2V-2 — documento sem itens: com a TOP Permitido a venda salva sem item (POST com items: [], 201, consulta aberta com 0 itens); com a TOP Proibido, a pendência 'Adicione ao menos um item.' e ZERO POST", async ({ page }) => {
  await login(page);
  const vendas: string[] = []; const tops: string[] = [];
  const posts: string[] = [];
  page.on("request", (r) => { if (ehPostDeVenda(r)) posts.push(r.url()); });
  try {
    // (1) PERMITIDO: o servidor declara que a TOP aceita documento sem itens — a pendência de item não bloqueia.
    const permitido = await criarTopDeVenda(page, { confirmacao: "manual", documentoSemItens: "permitido" }, tops);
    const regrasPermitido = await abrirCriacao(page, permitido);
    expect(regrasPermitido.regrasGerais, "o servidor declara: a TOP aceita documento sem itens (e não confirma)").toEqual({ confirmacaoAutomatica: false, aceitaSemItens: true });
    await preencherClassificacaoFinanceira(page);
    await expect(page.getByTestId("central-vendas-linha"), "premissa: nenhum item na grade").toHaveCount(0);
    await expect(botaoSalvar(page), "habilitado: as regras chegaram").toBeEnabled();
    await expect(botaoSalvar(page), "TOP Manual: o rótulo de antes").toHaveAttribute("aria-label", "Salvar");
    const semItens = await salvar(page, vendas);
    // A PROVA é o POST: o handler só envia com a lista de pendências VAZIA — com "ao menos um item" valendo, o MESMO
    // clique abriria a pendência e nada sairia (o contraste do Proibido, abaixo). Não se procura a pendência na tela
    // DEPOIS do POST: a Central já navegou para a consulta, e a ausência ali não provaria nada.
    expect(semItens.enviado.items, "o POST levou a venda sem itens").toEqual([]);
    expect(posts, "o ouvinte do fio contou o POST (o mesmo que conta o ZERO abaixo)").toHaveLength(1);
    expect("confirmacaoAutomatica" in semItens.corpo, "TOP Manual: o 201 de antes, sem a chave").toBe(false);
    await expect(avisoDoSalvar(page, "success")).toHaveText(["Salvo com sucesso"]);
    await expect(avisos(page), "um aviso só").toHaveCount(1);
    const lida = await consultaAbre(page, semItens.corpo.id, "open");
    expect(lida.items, "no servidor: a venda foi gravada sem itens").toEqual([]);
    await expect(page.getByTestId("central-vendas-itens-contagem"), "a consulta mostra 0 itens").toHaveText("(0)");

    // (2) PROIBIDO — os MESMOS passos: a pendência de item volta, e nada é enviado.
    const proibido = await criarTopDeVenda(page, { confirmacao: "manual", documentoSemItens: "proibido" }, tops);
    const regrasProibido = await abrirCriacao(page, proibido);
    expect(regrasProibido.regrasGerais, "o servidor declara: a TOP pede ao menos um item").toEqual({ confirmacaoAutomatica: false, aceitaSemItens: false });
    await preencherClassificacaoFinanceira(page);
    await expect(page.getByTestId("central-vendas-linha"), "premissa: nenhum item na grade").toHaveCount(0);
    await expect(botaoSalvar(page), "habilitado: as regras chegaram").toBeEnabled();
    const antes = posts.length;
    await botaoSalvar(page).click();
    await expect(page.getByTestId("central-vendas-pendencias"), "o clique sem item mostra UMA pendência").toHaveText(/1 pendência/);
    const daLista = page.getByTestId("central-vendas-pendencias-lista").getByTestId("central-vendas-pendencia");
    await expect(daLista, "só o item falta (o resto do documento está pronto)").toHaveCount(1);
    await expect(daLista, "é a pendência dos itens").toHaveAttribute("data-caminho", "items");
    await expect(daLista, "com o texto de antes").toContainText("Adicione ao menos um item.");
    // A pendência visível prova que o handler tomou o caminho que volta ANTES do POST (os dois são exclusivos).
    expect(posts.length - antes, "ZERO POST — a guarda está no handler").toBe(0);
  } finally {
    await limpar(page, vendas, tops);
  }
});
