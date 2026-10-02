import type { Locator, Page, Response } from "@playwright/test";
import { api, empresaAtiva, login, uniq } from "./helpers";
import { cabecalhosDaSessao } from "./top-config-08-comum";
import { hojeISO } from "./estoque-01-comum";
import { test, expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed } from "./central-compras-fixtures";
import { API, vigiar } from "./operacoes-01-f2-skew-comum";

/**
 * OPERACOES-01 · F6b (decisão 283) · K-2, SENTIDO 2 — O WEB DA BASE CONTRA A API DESTE HEAD (a janela "API antes do web"
 * da DEPLOYMENT, e a reversão só do web).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 2 roda em `playwright.skew-web-anterior.config.ts`, cujo `testMatch` é
 * `/skew-web-anterior\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o `playwright.config.ts` comum
 * ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (lá o web seria o deste HEAD, e o caso não mediria
 * o cliente anterior). Arquivo próprio, e não um caso em `skew-web-anterior.spec.ts` nem no K-2 da F6a
 * (`f6a-compras-skew-web-anterior.spec.ts`, que continua como está — escolha E20 do plano F6b): este mede SÓ o que a
 * F6b muda no fio. A identidade do bundle da base é a do caso IDENTIDADE de `skew-web-anterior.spec.ts`, na MESMA execução.
 *
 * O QUE SE MEDE. A API da F6b é ADITIVA e só de leitura: `GET /api/compras/pedidos/:id/proximos-passos` ganha, no FIM,
 * `orcamentos` (o leque de TOPs de orçamento do pedido, a quem tem `orcamentos_compra.create`); a leitura do pedido
 * ganha, em cada orçamento, `condicao_pagamento_codigo`, `condicao_pagamento_nome` e `itens` (o preço de cada item); e
 * `GET /api/aprovacoes/compras/:id` lê também o pedido (o web da base não pergunta essa rota). O navegador roda o bundle
 * EXATO da base — que não conhece nada disso — e faz, pela tela dela, o que faz hoje:
 *   · K2-1 a consulta do pedido cujo leque tem compra E orçamento, aprovado para orçamento e com um orçamento (as
 *     PREMISSAS, lidas no fio do navegador: `orcamentos` nos próximos passos, `itens` e a condição no orçamento da
 *     leitura) mostra o "Receber…" só com o passo da COMPRA; receber dá 201, e a compra confirma como hoje.
 * O VIGIA: nenhuma resposta 404/422/5xx da API nova ao cliente da base e nenhuma requisição morta.
 *
 * OS DADOS nascem pela API DESTE HEAD (a que está sendo julgada), antes de o vigia nascer: as TOPs e os cadastros pelas
 * portas de `central-compras-fixtures` (a exclusão lógica no fim do caso, passou ou falhou); a condição de pagamento
 * criada aqui sai no fim pela exclusão lógica do cadastro. A TELA é a da base (622f194): os seletores são os dela, conferidos em
 * `git show 622f194:apps/web/e2e/compras-02-receber-pedido.spec.ts` e no K2-1 da F6a. Quando a base avançar além da F6b,
 * estes seletores têm de ser reconferidos no commit da base nova. Os documentos ficam (o ledger é imutável; decisão 247).
 */

const caminho = (r: Response) => new URL(r.url()).pathname;
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const ehResposta = (method: string, alvo: string) => (r: Response) => r.request().method() === method && caminho(r) === alvo;

type PassoNoFio = { tipoOperacaoId: string; codigo: string; especie: string };
type ProximosPassosNoFio = { contractVersion: number; items: PassoNoFio[]; exigeFinalizar?: boolean; orcamentos?: PassoNoFio[] };
type OrcamentoNaLeitura = {
  id: string; situacao: string; fornecedor_id: string; condicao_pagamento_id: string | null;
  condicao_pagamento_codigo?: string | null; condicao_pagamento_nome?: string | null;
  itens?: { item_pedido_orcado_id: string; valor_unitario: string; valor_total: string }[];
};
type PedidoLido = {
  id: string; codigo: string; situacao: string; aprovado_orcamento_em: string | null; itens: { id: string; produto_id: string }[];
  orcamentos: OrcamentoNaLeitura[]; compras_geradas?: { id: string; codigo: string; situacao: string }[];
};

/** A API deste HEAD declara a capacidade da F6 (as quatro de hoje, na ordem de hoje, e a nova depois): a premissa do sentido 2. */
async function premissaDaApi(page: Page) {
  const ot = await api<{ contractVersion: number; capacidades: Record<string, unknown> }>(page, "GET", "/api/compras/pedidos/operation-types");
  expect(ot.contractVersion, "o contrato que a base lê continua o 1").toBe(1);
  expect(Object.keys(ot.capacidades).slice(0, 4), "as quatro capacidades de hoje, na ordem de hoje").toEqual(["classificacaoFinanceira", "condicaoPagamento", "layoutDocumento", "regrasDaOperacao"]);
  expect(ot.capacidades["finalizacaoEOrcamento"], "premissa: a API julgada é a desta fase (declara a capacidade da F6)").toBe(1);
}

/**
 * Escolhe na célula da linha pela descrição (o seletor da base, `compras-02-receber-pedido.spec.ts`) — pelo nome
 * INTEIRO, e exigindo UMA opção.
 */
async function escolherNaLinha(page: Page, botao: Locator, nome: string) {
  await botao.click();
  await page.getByPlaceholder("Pesquisar pela descrição").fill(nome);
  const opcao = page.getByRole("option", { name: literal(nome) });
  await expect(opcao, `o seletor da base oferece exatamente uma opção "${nome}"`).toHaveCount(1);
  await opcao.click();
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K2-1 — A BASE RECEBE O PEDIDO CUJO LEQUE TEM ORÇAMENTO (APROVADO PARA ORÇAMENTO, COM UM ORÇAMENTO)
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("OP01-F6b · K2-1 (sentido 2) — o web da base recebe o pedido cujo leque tem compra e orçamento (aprovado para orçamento, com um orçamento): o fio leva `orcamentos` nos próximos passos e os itens e a condição no orçamento da leitura; a tela da base mostra só o passo da compra, recebe (201) e confirma como hoje", async ({ page }) => {
  await login(page);
  await premissaDaApi(page);
  const condicoes: string[] = [];
  try {
    // O GRAFO DA F6: TOP de compra e TOP de orçamento (o neutro do servidor) e a TOP de pedido com as duas arestas.
    const ref = await referenciasDoSeed(page);
    const empresa = await empresaAtiva(page);
    const topCompra = { codigo: codigoTop("6k2c") };
    const topOrcamento = { codigo: codigoTop("6k2o") };
    const idCompra = (await criarTop(page, { codigo: topCompra.codigo, codigoBase: "compras.compra", nome: uniq("F6b K2-1 compra") })).id;
    const idOrcamento = (await criarTop(page, { codigo: topOrcamento.codigo, codigoBase: "compras.orcamento", nome: uniq("F6b K2-1 orçamento") })).id;
    const idPedido = (await criarTop(page, {
      codigo: codigoTop("6k2p"), codigoBase: "compras.pedido", nome: uniq("F6b K2-1 pedido"),
      destinos: [{ tipoOperacaoId: idCompra, ordem: 0, emPartes: true }, { tipoOperacaoId: idOrcamento, ordem: 1, emPartes: false }]
    })).id;

    // OS CADASTROS: produto, Local de estoque (nome ÚNICO na organização: o seletor da base pesquisa pela descrição em
    // todas as empresas) e dois fornecedores (o do pedido e o do orçamento); a condição de pagamento do orçamento.
    const produto = (await criarCadastro(page, "products", { description: uniq("F6bK2 produto"), group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id })).id;
    const localNome = uniq("F6bK2 local");
    const local = (await criarCadastro(page, "warehouses", { empresa_id: empresa, initials: `K${Math.random().toString(36).slice(2, 7).toUpperCase()}`, description: localNome, type: "inputs" })).id;
    expect(String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${local}`))["description"]), "premissa: o Local de estoque do caso").toBe(localNome);
    const fornecedorDoPedido = (await criarCadastro(page, "people", { name: uniq("F6bK2 forn pedido"), person_type: "legal", is_provider: true })).id;
    const fornecedorDoOrcamento = (await criarCadastro(page, "people", { name: uniq("F6bK2 forn orçamento"), person_type: "legal", is_provider: true })).id;
    const { id: condicaoId } = await api<{ id: string }>(page, "POST", "/api/resources/condicoes_pagamento", {
      nome: uniq("F6bK2 30 dias"), parcelas: 1, dias_primeira_parcela: 30, modo: "intervalo", intervalo_dias: 30, entrada: false, is_active: true
    });
    condicoes.push(condicaoId);
    const condicao = await api<{ code: string | null; nome: string }>(page, "GET", `/api/resources/condicoes_pagamento/${condicaoId}`);
    expect(condicao.code, "premissa: o servidor gerou o código da condição").toBeTruthy();

    // O PEDIDO (3 × 7,00), APROVADO PARA ORÇAMENTO, COM UM ORÇAMENTO (6,50, com a condição) — tudo pela API deste HEAD.
    const { id: pedidoId } = await api<{ id: string }>(page, "POST", "/api/compras/pedidos", {
      empresa_id: empresa, tipo_operacao_id: idPedido, fornecedor_id: fornecedorDoPedido, data_documento: hojeISO(),
      categoria_financeira_id: ref.natureza.id, centro_custo_id: ref.centro.id, itens: [{ produto_id: produto, quantidade: "3", valor_unitario: "7.00" }]
    });
    const aprovado = await api<{ aprovado_orcamento_em: string | null }>(page, "POST", `/api/compras/pedidos/${pedidoId}/aprovar-para-orcamento`, {});
    expect(aprovado.aprovado_orcamento_em, "premissa: o pedido foi aprovado para orçamento").toBeTruthy();
    const antes = await api<PedidoLido>(page, "GET", `/api/compras/pedidos/${pedidoId}`);
    const item = antes.itens[0]!;
    const orcamento = await api<{ id: string; situacao: string }>(page, "POST", `/api/compras/pedidos/${pedidoId}/orcamentos`, {
      tipo_operacao_id: idOrcamento, fornecedor_id: fornecedorDoOrcamento, data_documento: hojeISO(), condicao_pagamento_id: condicaoId,
      itens: [{ item_pedido_id: item.id, valor_unitario: "6.50" }]
    });
    expect(orcamento.situacao, "premissa: o orçamento nasceu aberto").toBe("aberto");

    // O VIGIA nasce AGORA: só o que o web da base pede e recebe daqui em diante.
    const v = vigiar(page);

    // (1) A CONSULTA DA BASE. As PREMISSAS no fio do navegador: a leitura do pedido traz o orçamento com os itens e a
    //     condição (A3), e os próximos passos trazem `orcamentos` (A2) — as chaves que a base não conhece.
    const leituraNoFio = page.waitForResponse(ehResposta("GET", `/api/compras/pedidos/${pedidoId}`));
    const passosNoFio = page.waitForResponse(ehResposta("GET", `/api/compras/pedidos/${pedidoId}/proximos-passos`));
    await page.goto(`/compras/pedidos/${pedidoId}`);
    const leitura = await leituraNoFio;
    expect(leitura.status()).toBe(200);
    const lido = (await leitura.json()) as PedidoLido;
    expect(lido.orcamentos.map((o) => ({ id: o.id, situacao: o.situacao, codigo: o.condicao_pagamento_codigo, nome: o.condicao_pagamento_nome, itens: o.itens })),
      "premissa no fio: a leitura que a base recebeu traz o orçamento com a condição e o preço do item (as chaves novas)").toEqual([{
      id: orcamento.id, situacao: "aberto", codigo: condicao.code, nome: condicao.nome,
      itens: [{ item_pedido_orcado_id: item.id, valor_unitario: "6.500000", valor_total: "19.50" }]
    }]);
    const passos = await passosNoFio;
    expect(passos.status()).toBe(200);
    const corpoDosPassos = (await passos.json()) as ProximosPassosNoFio;
    expect(Object.keys(corpoDosPassos), "premissa no fio: `orcamentos` no FIM dos próximos passos").toEqual(["contractVersion", "politicaConfigurada", "items", "exigeFinalizar", "orcamentos"]);
    expect([corpoDosPassos.items.map((x) => [x.codigo, x.especie]), (corpoDosPassos.orcamentos ?? []).map((x) => [x.codigo, x.especie]), corpoDosPassos.exigeFinalizar],
      "premissa no fio: os passos de receber só a compra; o leque de orçamento, a TOP de orçamento; não exige finalizar")
      .toEqual([[[topCompra.codigo, "compra"]], [[topOrcamento.codigo, "orcamento"]], false]);

    // (2) A TELA DA BASE: aberto, os próximos passos prontos, o "Receber…" pelo passo da COMPRA — e nenhum outro passo.
    await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");
    const proximos = page.getByTestId("compras-proximos-passos");
    await expect(proximos, "a base leu os próximos passos da API nova (chave a mais ignorada)").toHaveAttribute("data-situacao", "pronto");
    const receber = proximos.getByTestId(`compras-proximo-passo-${topCompra.codigo}`);
    await expect(receber).toContainText("Receber…");
    await expect(receber).toBeEnabled();
    await expect(page.locator("[data-testid^='compras-proximo-passo-']"), "só o passo da compra: o orçamento não vira um Receber").toHaveCount(1);
    await receber.click();

    // (3) A CENTRAL DA BASE EM MODO RECEBER: o item com o saldo; Local de estoque, nota, série e entrada; 201.
    await expect(page).toHaveURL(new RegExp(`/compras/compras/new\\?.*pedido=${pedidoId}`));
    const central = page.getByTestId("compras-central");
    await expect(central).toHaveAttribute("data-modo", "receber");
    await expect(page.getByTestId("compras-central-receber")).toHaveAttribute("data-situacao", "pronto");
    await expect(page.getByTestId("compras-receber-pedido")).toContainText(lido.codigo);
    const linha = page.getByTestId(`compras-receber-item-${item.id}`);
    await expect(linha.getByTestId("central-compras-saldo-da-origem")).toHaveText("3,0000");
    await escolherNaLinha(page, linha.getByTestId("central-compras-armazem"), localNome);
    await expect(linha.getByLabel("Quantidade do item 1"), "a quantidade começa no saldo inteiro").toHaveValue(/^3/);
    await linha.getByLabel("Valor unitário do item 1").fill("7");
    const nota = `K6${Date.now().toString(36).toUpperCase()}`;
    await page.getByTestId("compras-numero-nota").fill(nota);
    await page.getByTestId("compras-serie-nota").fill("1");
    const hoje = hojeISO();
    const entrada = central.getByLabel("Data de entrada", { exact: true });
    await entrada.fill(hoje.split("-").reverse().join("/"));
    await entrada.press("Enter");
    await expect(page.getByTestId("compras-data-entrada").locator("input[type=hidden]")).toHaveValue(hoje);
    await expect(page.getByTestId("compras-total")).toContainText("21,00");
    const recebeu = page.waitForResponse(ehResposta("POST", `/api/compras/pedidos/${pedidoId}/convert`));
    await page.getByTestId("compras-salvar").click();
    expect((await recebeu).status(), "a API nova recebe o pedido que tem orçamento pelo corpo da base").toBe(201);

    // (4) A CONSULTA DA COMPRA DA BASE e CONFIRMAR pela prévia (a TOP da compra sem a seção da divergência: o corpo de hoje).
    await expect(page).toHaveURL(/\/compras\/compras\/[0-9a-f-]{36}$/);
    const compraId = /\/compras\/compras\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
    const corpo = page.getByTestId("compras-consulta-corpo");
    await expect(corpo).toHaveAttribute("data-situacao", "aberto");
    await expect(page.getByTestId("compras-origem")).toContainText(`Pedido de compra ${lido.codigo}`);
    const previa = page.waitForResponse(ehResposta("GET", `/api/compras/compras/${compraId}/previa-confirmacao`));
    await page.getByTestId("compras-confirmar").click();
    const corpoDaPrevia = (await (await previa).json()) as Record<string, unknown>;
    expect("divergencia" in corpoDaPrevia, "TOP sem a seção: a prévia é a de hoje, sem a chave nova").toBe(false);
    await expect(page.getByTestId("compras-previa")).toHaveAttribute("data-situacao", "pronta");
    const confirmou = page.waitForResponse(ehResposta("POST", `/api/compras/compras/${compraId}/confirm`));
    await page.getByTestId("confirm-dialog-confirm").click();
    expect((await confirmou).status(), "a API nova confirma pelo corpo da base").toBe(200);
    await expect(corpo).toHaveAttribute("data-situacao", "confirmado");

    // (5) O SERVIDOR: a compra confirmada, do pedido; o pedido CONVERTIDO (o saldo zerou); o orçamento continua ABERTO
    //     (receber não cascateia nos orçamentos — o comportamento de hoje, escolha E7).
    const compra = await api<{ situacao: string; origem_documento_id: string; numero_nota: string }>(page, "GET", `/api/compras/compras/${compraId}`);
    expect(compra).toMatchObject({ situacao: "confirmado", origem_documento_id: pedidoId, numero_nota: nota });
    const depois = await api<PedidoLido>(page, "GET", `/api/compras/pedidos/${pedidoId}`);
    expect(depois.situacao, "o pedido recebido inteiro passa a convertido").toBe("convertido");
    expect(depois.compras_geradas, "a compra gerada, confirmada").toEqual([{ id: compraId, codigo: expect.any(String), situacao: "confirmado" }]);
    expect(depois.orcamentos.map((o) => [o.id, o.situacao]), "o orçamento continua aberto (sem cascata)").toEqual([[orcamento.id, "aberto"]]);

    v.semBloqueio();
    v.semErroDeContrato();
  } finally {
    // A condição do caso sai das listas de quem roda depois pela exclusão LÓGICA do cadastro (`softDelete` no registry;
    // nada é apagado). As TOPs e os outros cadastros saem pela limpeza da fixture. A falha aqui é registrada, sem
    // esconder o erro do caso.
    const cab = await cabecalhosDaSessao(page).catch(() => null);
    for (const id of condicoes) {
      const r = cab ? await page.request.fetch(`${API}/api/resources/condicoes_pagamento/${id}`, { method: "DELETE", headers: cab }) : null;
      if (!r?.ok()) console.warn(`[f6b-skew] a condição ${id} não foi excluída: ${r ? r.status() : "sem a credencial da sessão"}`);
    }
  }
});
