import { test, expect, type Page } from "@playwright/test";
import { login, api, uniq, empresaAtiva, primeiroId } from "./helpers";

/**
 * PORTAL DE VENDAS UNIFICADO E PRÓXIMOS PASSOS PELO GRAFO (TOP-CONFIG-03) — E11 a E19 e E21.
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PODE PROVAR ────────────────────────────────────────────────────────────┐
 * │ A integração já prova, no servidor, que o grafo é lido da VERSÃO congelada e filtrado pelo      │
 * │ estado de HOJE. O que nenhum teste de API alcança é o elo do cliente: que a tela OFEREÇA        │
 * │ exatamente o leque que o servidor devolveu, que ela não escolha sozinha quando há mais de um    │
 * │ caminho, que ela não ofereça caminho nenhum quando a política é vazia, e que a lista única      │
 * │ mostre as três variantes na MESMA grade sem perder o recorte dos favoritos antigos.             │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POR QUE CADA TESTE SEMEIA O PRÓPRIO DADO ─────────────────────────────────────────────────────┐
 * │ O banco de e2e é COMPARTILHADO pela suíte inteira e acumula estado entre execuções. Nenhuma     │
 * │ asserção aqui depende de contagem global, de ordem de execução ou de "existe pelo menos um":    │
 * │ cada caso cria as TOPs e os documentos de que precisa, com nome único, e conta apenas o que ele │
 * │ mesmo colocou lá. Contar o leque de UM documento é seguro justamente porque a política é da     │
 * │ VERSÃO daquele documento — nada que outro teste cadastre entra nela.                            │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/** Uma TOP recém-cadastrada, com o código que a tela usa no rótulo do botão de conversão. */
interface Top { id: string; codigo: string; nome: string }

/**
 * Cadastra uma TOP pela API administrativa, opcionalmente já com as próximas operações declaradas.
 *
 * O E2E do EDITOR de TOP é o `top-configuracao.spec.ts`; aqui a TOP é fixture. Semear pela API mantém
 * cada caso medindo uma coisa só — quando o leque sai errado, a causa é a tela de vendas, e não sete
 * cliques de configuração que poderiam ter falhado no caminho.
 */
async function cadastrarTop(page: Page, codigoBase: string, rotulo: string, destinos: Top[] = []): Promise<Top> {
  const codigo = `8${Math.floor(Math.random() * 90000 + 10000)}`;
  const nome = uniq(rotulo);
  const criado = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", {
    codigo, codigoBase, nome,
    destinos: destinos.map((d, i) => ({ tipoOperacaoId: d.id, ordem: i }))
  });
  return { id: criado.id, codigo, nome };
}

/** Troca a lista de próximas operações de uma TOP. Devolve a versão que a edição produziu. */
async function trocarDestinos(page: Page, top: Top, destinos: Top[]): Promise<number> {
  const atual = await api<{ revisao: number }>(page, "GET", `/api/admin/tipos-operacao/${top.id}`);
  const r = await api<{ versao: number }>(page, "PUT", `/api/admin/tipos-operacao/${top.id}`, {
    revisao: atual.revisao, destinos: destinos.map((d, i) => ({ tipoOperacaoId: d.id, ordem: i }))
  });
  return r.versao;
}

/** A versão CORRENTE de uma TOP, como o cadastro a reporta. É a prova de "subiu" e de "não subiu". */
const versaoDaTop = async (page: Page, top: Top) =>
  (await api<{ versao: number }>(page, "GET", `/api/admin/tipos-operacao/${top.id}`)).versao;

const SEGMENTO: Record<string, string> = { budget: "budgets", order: "orders", sale: "sales" };

/**
 * O RÓTULO DE TIPO que o servidor resolve pelo registry de famílias. Ele não é decoração nos testes
 * abaixo: o CÓDIGO do documento é sequencial POR VARIANTE, então "0045" existe como orçamento E como
 * pedido. Localizar a linha só pelo código casaria duas linhas diferentes — e a asserção passaria a
 * medir o acaso do contador. Código + tipo é o par que identifica o documento nesta grade.
 */
const ROTULO_DE_TIPO: Record<string, string> = {
  budget: "Orçamento de venda", order: "Pedido de venda", sale: "Venda"
};

/**
 * A linha de um documento na grade única, identificada pela CÉLULA EXATA do código mais o tipo.
 *
 * `hasText` é substring: procurar "0051" casaria também a linha do documento "10051". A célula com
 * `exact: true` recorta o código inteiro, e o tipo desempata o par restante. As duas condições juntas
 * são o que torna "esta linha é o MEU documento" uma afirmação, e não uma coincidência de contador.
 */
const linhaDoDocumento = (page: Page, tabela: import("@playwright/test").Locator, variante: string, code: string) =>
  tabela.getByRole("row")
    .filter({ has: page.getByRole("cell", { name: code, exact: true }) })
    // O TIPO TAMBÉM POR CÉLULA EXATA: "Venda" é substring de "Orçamento de venda" e de "Pedido de
    // venda", então um `hasText` aqui casaria as três variantes e a asserção de recorte viraria fumaça.
    .filter({ has: page.getByRole("cell", { name: ROTULO_DE_TIPO[variante]!, exact: true }) });

/**
 * Cria um documento da variante pedida, já citando a TOP.
 *
 * `document_date` é uma data DISTANTE de propósito: a lista única ordena por data decrescente, e uma
 * data no futuro garante que o documento semeado esteja na PRIMEIRA página mesmo num banco que já
 * acumulou centenas de lançamentos de execuções anteriores. Sem isso, a asserção de E14 passaria a
 * depender de paginação — que é exatamente o tipo de premissa que envelhece calada.
 */
const DATA_DISTANTE = "2027-12-31";
async function criarDocumento(page: Page, variante: string, top: Top): Promise<{ id: string; code: string }> {
  const empresa = await empresaAtiva(page);
  const cliente = await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1");
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const criado = await api<{ id: string }>(page, "POST", `/api/sales/${SEGMENTO[variante]}`, {
    empresa_id: empresa, document_date: DATA_DISTANTE, client_id: cliente, tipo_operacao_id: top.id,
    items: [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }]
  });
  const lido = await api<{ code: string; kind: string }>(page, "GET", `/api/sales/${SEGMENTO[variante]}/${criado.id}`);
  expect(lido.kind, "a fixture precisa nascer na variante pedida").toBe(variante);
  return { id: criado.id, code: lido.code };
}

/** Abre o detalhe e só devolve quando a moldura montou — e quando é o documento CERTO que está nela. */
async function abrirDocumento(page: Page, variante: string, doc: { id: string; code: string }) {
  await page.goto(`/vendas/${SEGMENTO[variante]}/${doc.id}`);
  await expect(page.getByTestId("central-vendas"), "a premissa: o documento abriu").toBeVisible();
  await expect(page.getByRole("heading", { name: new RegExp(doc.code) }),
    "e é o documento da fixture, não outro que por acaso estava na tela").toBeVisible();
}

/** A TOP congelada no documento, como o servidor a devolve. É o que prova QUAL operação foi usada. */
const topDoDocumento = async (page: Page, variante: string, id: string) =>
  (await api<{ tipo_operacao: { id: string } | null }>(page, "GET", `/api/sales/${SEGMENTO[variante]}/${id}`)).tipo_operacao;

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * E11 — DUAS TOPs DE DESTINO: as DUAS aparecem, e a tela não escolhe por ninguém
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("E11 — origem com DUAS próximas operações mostra as duas, e não escolhe sozinha", async ({ page }) => {
  await login(page);
  const pedidoA = await cadastrarTop(page, "vendas.pedido", "Pedido à vista E11");
  const pedidoB = await cadastrarTop(page, "vendas.pedido", "Pedido a prazo E11");
  const orcamento = await cadastrarTop(page, "vendas.orcamento", "Orçamento E11", [pedidoA, pedidoB]);
  const doc = await criarDocumento(page, "budget", orcamento);

  await abrirDocumento(page, "budget", doc);
  const acao = page.getByTestId("acao-conversao");
  // COM MAIS DE UM CAMINHO O BOTÃO NÃO NOMEIA NENHUM: nomear um deles no rótulo insinuaria um padrão
  // que a política não declarou. O convite é ao diálogo, onde a escolha aparece inteira.
  await expect(acao, "com dois destinos o rótulo não pode eleger um deles").toHaveText("Converter");
  await acao.click();

  const dialogo = page.getByTestId("dialog-conversao");
  await expect(dialogo).toBeVisible();
  // O NÚMERO É A PROVA: exatamente duas opções, e são EXATAMENTE as duas configuradas — não uma lista
  // que por acaso tem dois itens quaisquer.
  const opcoes = dialogo.getByTestId("proximo-passo-opcao");
  await expect(opcoes, "as DUAS próximas operações são oferecidas").toHaveCount(2);
  await expect(dialogo.locator(`[data-testid="proximo-passo-opcao"][data-top-id="${pedidoA.id}"]`)).toBeVisible();
  await expect(dialogo.locator(`[data-testid="proximo-passo-opcao"][data-top-id="${pedidoB.id}"]`)).toBeVisible();
  // Com dois caminhos não existe "único": esse é o desenho de um destino só, e confundir os dois
  // esconderia a escolha justamente onde ela precisa acontecer.
  await expect(dialogo.getByTestId("proximo-passo-unico")).toHaveCount(0);

  // NADA PRÉ-SELECIONADO, e Converter fechado enquanto o usuário não decide.
  await expect(dialogo.locator('input[name="proximo-passo"]:checked'), "duas opções, e NENHUMA marcada").toHaveCount(0);
  const converter = dialogo.getByRole("button", { name: "Converter" });
  await expect(converter, "sem escolha explícita não converte").toBeDisabled();

  // Depois do clique do usuário, aí sim — e é a opção DELE que fica marcada.
  await dialogo.locator(`[data-testid="proximo-passo-opcao"][data-top-id="${pedidoB.id}"]`).click();
  await expect(dialogo.locator(`[data-testid="proximo-passo-opcao"][data-top-id="${pedidoB.id}"] input`)).toBeChecked();
  await expect(dialogo.locator(`[data-testid="proximo-passo-opcao"][data-top-id="${pedidoA.id}"] input`)).not.toBeChecked();
  await expect(converter).toBeEnabled();
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * E12 — EDITAR OS DESTINOS CRIA A VERSÃO N+1, e o documento ANTIGO continua na política antiga
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("E12 — editar os destinos sobe a versão, e o documento ANTIGO continua vendo a política antiga", async ({ page }) => {
  await login(page);
  const pedidoV1 = await cadastrarTop(page, "vendas.pedido", "Pedido da versão 1");
  const pedidoV2 = await cadastrarTop(page, "vendas.pedido", "Pedido da versão 2");
  const orcamento = await cadastrarTop(page, "vendas.orcamento", "Orçamento E12", [pedidoV1]);

  expect(await versaoDaTop(page, orcamento), "a TOP nasce na versão 1").toBe(1);
  const antigo = await criarDocumento(page, "budget", orcamento);

  // A PREMISSA, antes da edição: o documento antigo enxerga o destino da versão 1.
  await abrirDocumento(page, "budget", antigo);
  await page.getByTestId("acao-conversao").click();
  await expect(page.getByTestId("dialog-conversao").getByTestId("proximo-passo-unico"))
    .toHaveAttribute("data-top-id", pedidoV1.id);

  // A EDIÇÃO: trocar a lista de destinos é mudar CONTEÚDO, e conteúdo cria versão.
  expect(await trocarDestinos(page, orcamento, [pedidoV2]), "destino alterado é versão nova").toBe(2);

  // O DOCUMENTO ANTIGO NÃO MUDA DE POLÍTICA. Esta é a razão de a política morar na versão: se ela
  // morasse no cadastro, a edição de hoje reescreveria retroativamente o que um documento de ontem
  // podia virar, e a conversão que já aconteceu ficaria sem explicação.
  await abrirDocumento(page, "budget", antigo);
  await page.getByTestId("acao-conversao").click();
  const dialogoAntigo = page.getByTestId("dialog-conversao");
  await expect(dialogoAntigo.getByTestId("proximo-passo-unico"), "continua sendo o destino da versão 1")
    .toHaveAttribute("data-top-id", pedidoV1.id);
  await expect(dialogoAntigo.getByText(pedidoV2.nome), "o destino NOVO não pode aparecer no documento antigo").toHaveCount(0);

  // E O DOCUMENTO NOVO NASCE NA POLÍTICA NOVA — sem isso, o teste acima seria satisfeito por uma tela
  // que simplesmente ignora os destinos.
  const novo = await criarDocumento(page, "budget", orcamento);
  await abrirDocumento(page, "budget", novo);
  await page.getByTestId("acao-conversao").click();
  await expect(page.getByTestId("dialog-conversao").getByTestId("proximo-passo-unico"))
    .toHaveAttribute("data-top-id", pedidoV2.id);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * E13 — DESTINO DESATIVADO some do leque, e a versão da ORIGEM não se mexe
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("E13 — destino desativado deixa de ser oferecido, sem alterar a versão da origem", async ({ page }) => {
  await login(page);
  const ativo = await cadastrarTop(page, "vendas.pedido", "Pedido que fica");
  const desativado = await cadastrarTop(page, "vendas.pedido", "Pedido que sai");
  const orcamento = await cadastrarTop(page, "vendas.orcamento", "Orçamento E13", [ativo, desativado]);
  const doc = await criarDocumento(page, "budget", orcamento);

  // PREMISSA CONTADA: os DOIS eram oferecidos. Sem esta metade, "sumiu" seria satisfeito por um leque
  // que nunca teve o segundo item — e o teste passaria com a política inteira quebrada.
  await abrirDocumento(page, "budget", doc);
  await page.getByTestId("acao-conversao").click();
  await expect(page.getByTestId("dialog-conversao").getByTestId("proximo-passo-opcao")).toHaveCount(2);

  const versaoAntes = await versaoDaTop(page, orcamento);
  const atual = await api<{ revisao: number }>(page, "GET", `/api/admin/tipos-operacao/${desativado.id}`);
  await api(page, "PUT", `/api/admin/tipos-operacao/${desativado.id}`, { ativo: false, revisao: atual.revisao });

  // AGORA SOBRA UM — e com um só o desenho é o do destino único, não uma lista de um item.
  await abrirDocumento(page, "budget", doc);
  await page.getByTestId("acao-conversao").click();
  const dialogo = page.getByTestId("dialog-conversao");
  await expect(dialogo.getByTestId("proximo-passo-unico"), "o destino ativo continua oferecido")
    .toHaveAttribute("data-top-id", ativo.id);
  await expect(dialogo.getByTestId("proximo-passo-opcao"), "e não há mais escolha a fazer").toHaveCount(0);
  await expect(dialogo.getByText(desativado.nome), "o destino desativado sumiu do leque").toHaveCount(0);

  // A VERSÃO DA ORIGEM NÃO SE MEXEU. Disponibilidade é PRESENTE (estado de hoje da TOP de destino);
  // política é HISTÓRIA (a versão). Se desativar um destino subisse a versão da origem, o histórico
  // passaria a registrar uma decisão que o administrador da origem nunca tomou.
  expect(await versaoDaTop(page, orcamento), "desativar o DESTINO não versiona a ORIGEM").toBe(versaoAntes);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * E14 — A LISTA ÚNICA: orçamento, pedido e venda na MESMA grade
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("E14 — a lista única mostra orçamento, pedido e venda na MESMA grade", async ({ page }) => {
  await login(page);
  const docs = {
    budget: await criarDocumento(page, "budget", await cadastrarTop(page, "vendas.orcamento", "Orçamento E14")),
    order: await criarDocumento(page, "order", await cadastrarTop(page, "vendas.pedido", "Pedido E14")),
    sale: await criarDocumento(page, "sale", await cadastrarTop(page, "vendas.venda", "Venda E14"))
  };
  await page.goto("/vendas");
  await expect(page.getByRole("heading", { name: "Vendas" })).toBeVisible();
  const lista = page.getByTestId("vendas-documentos");
  await expect(lista, "o portal tem UMA lista de documentos").toBeVisible();
  // SEM FILTRO DE TIPO: é esta ausência que torna a asserção seguinte uma prova de unificação.
  await expect(lista).toHaveAttribute("data-kind", "");
  await expect(lista.locator("thead th", { hasText: "Tipo de documento" }).first()).toBeVisible();

  // AS TRÊS VARIANTES, na MESMA `<table>` — provado pelo ancestral comum, não por "aparecem na página".
  const tabela = lista.locator("table").first();
  for (const variante of ["budget", "order", "sale"] as const) {
    await expect(linhaDoDocumento(page, tabela, variante, docs[variante].code),
      `o ${ROTULO_DE_TIPO[variante]} ${docs[variante].code} está na MESMA grade que os outros dois`).toHaveCount(1);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * E15 — `+ NOVO`: as TOPs de TODAS as famílias de Vendas, e a escolha abre a porta certa
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("E15 — `+ Novo` lista as TOPs de todas as famílias de Vendas, e a escolhida abre o formulário certo", async ({ page }) => {
  await login(page);
  const tops = {
    "vendas.orcamento": await cadastrarTop(page, "vendas.orcamento", "Orçamento E15"),
    "vendas.pedido": await cadastrarTop(page, "vendas.pedido", "Pedido E15"),
    "vendas.venda": await cadastrarTop(page, "vendas.venda", "Venda E15")
  };

  await page.goto("/vendas");
  await page.getByTestId("vendas-novo").click();
  const lancador = page.getByTestId("lancador-unificado");
  await expect(lancador).toBeVisible();

  // UM GRUPO POR FAMÍLIA, e a TOP de cada uma DENTRO do grupo dela. Procurar a TOP na página inteira
  // passaria mesmo que os três grupos estivessem trocados entre si.
  for (const [familia, top] of Object.entries(tops)) {
    const grupo = lancador.locator(`[data-testid="lancador-grupo"][data-familia="${familia}"]`);
    await expect(grupo, `a família ${familia} tem grupo próprio`).toHaveCount(1);
    await expect(grupo.locator(`[data-testid="lancador-top"][data-top-id="${top.id}"]`),
      "a TOP aparece no grupo da família DELA").toHaveCount(1);
  }

  /**
   * A ESCOLHA DECIDE A PORTA. Escolher a TOP de ORÇAMENTO tem de abrir `/vendas/budgets/new`: é esta a
   * propriedade que o lançador unificado existe para entregar — o usuário nomeia a OPERAÇÃO, e quem
   * traduz para a tabela é o produto. Abrir a porta errada com a TOP certa seria o defeito silencioso:
   * a rota recusaria a TOP de outra família e o operador veria "operação indisponível" sem entender.
   */
  // O DUPLO CLIQUE é o gesto de lançar do design (VISUAL-UX-01 R3): o clique simples só escolhe.
  await lancador.locator(`[data-testid="lancador-top"][data-top-id="${tops["vendas.orcamento"].id}"]`).dblclick();
  await expect(page).toHaveURL(new RegExp(`/vendas/budgets/new\\?tipo_operacao_id=${tops["vendas.orcamento"].id}`));
  await expect(page.getByTestId("top-contexto"), "e o formulário abre já contextualizado na operação escolhida")
    .toContainText(tops["vendas.orcamento"].nome);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * E16 — SEM TRANSIÇÃO NÃO HÁ PRÓXIMO PASSO (e a ausência é da política, não da tela)
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("E16 — documento cuja operação não declara transição NÃO oferece conversão", async ({ page }) => {
  await login(page);
  const semDestino = await cadastrarTop(page, "vendas.orcamento", "Orçamento sem saída");
  const pedido = await cadastrarTop(page, "vendas.pedido", "Pedido E16");
  const comDestino = await cadastrarTop(page, "vendas.orcamento", "Orçamento com saída", [pedido]);

  const mudo = await criarDocumento(page, "budget", semDestino);
  const falante = await criarDocumento(page, "budget", comDestino);

  /**
   * A PREMISSA E A CONCLUSÃO NO MESMO TESTE, com o MESMO usuário, a MESMA variante e o MESMO estado.
   *
   * "Não há botão de conversão" é satisfeito de graça por um documento cancelado, por falta de
   * capacidade, por uma tela que não renderizou ou por um defeito que apagou a ação de todo mundo. O
   * contraste com um orçamento IRMÃO — mesma família, mesma situação, só com a política configurada —
   * é o que separa "a política está vazia" de "a conversão sumiu".
   */
  await abrirDocumento(page, "budget", falante);
  await expect(page.getByTestId("acao-conversao"), "premissa: com política, a conversão é oferecida").toBeVisible();

  /**
   * A MEDIÇÃO ESPERA A RESPOSTA — corrigido na R1, e o defeito era real.
   *
   * A tela do documento monta ANTES de perguntar a política (a consulta de próximos passos depende do
   * `kind`, que só se conhece depois de o DOCUMENTO chegar). Durante essa ida e volta o estado é
   * `carregando`, nenhuma conversão é oferecida, e `toHaveCount(0)` resolve no primeiro poll. Escrito
   * como estava, este teste passaria IGUAL se a tela voltasse a oferecer a cadeia antiga aqui: o botão
   * surgiria um instante depois de o teste ter seguido adiante. "Imprimir" não salvava — ele é
   * renderizado incondicionalmente e aparece junto com a moldura.
   */
  const respostaPolitica = page.waitForResponse((r) =>
    r.url().includes(`/${mudo.id}/proximos-passos`) && r.request().method() === "GET");
  await abrirDocumento(page, "budget", mudo);
  const politicaServida = await (await respostaPolitica).json() as { politicaConfigurada?: boolean; items?: unknown[] };
  expect(politicaServida.politicaConfigurada,
    "premissa: a política FOI declarada — `cadastrarTop` manda `destinos`, então nem o vazio é silêncio").toBe(true);
  expect(politicaServida.items, "e ela não tem nenhum destino").toHaveLength(0);

  // AGORA a ausência é afirmação, e não atraso.
  await expect(page.getByTestId("acao-conversao"), "sem transição declarada, nenhuma conversão").toHaveCount(0);
  await expect(page.getByTestId("dialog-conversao"), "e nenhum diálogo pendurado na árvore").toHaveCount(0);
  // As OUTRAS ações do documento continuam lá: é o que prova que a tela montou inteira e que só a
  // conversão está ausente.
  await expect(page.getByRole("button", { name: "Imprimir" }), "a tela montou: as demais ações seguem").toBeVisible();
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * E17 / E18 — A CONVERSÃO USA EXATAMENTE A TOP ESCOLHIDA
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("E17 — orçamento com transição para pedido converte usando EXATAMENTE a TOP escolhida", async ({ page }) => {
  await login(page);
  const pedido = await cadastrarTop(page, "vendas.pedido", "Pedido E17");
  const orcamento = await cadastrarTop(page, "vendas.orcamento", "Orçamento E17", [pedido]);
  const doc = await criarDocumento(page, "budget", orcamento);

  await abrirDocumento(page, "budget", doc);
  await expect(page.getByTestId("acao-conversao"), "o rótulo nomeia a operação de destino")
    .toHaveText(`Converter em ${pedido.codigo} — ${pedido.nome}`);
  await page.getByTestId("acao-conversao").click();
  const dialogo = page.getByTestId("dialog-conversao");
  await expect(dialogo.getByTestId("proximo-passo-unico")).toHaveAttribute("data-top-id", pedido.id);
  await dialogo.getByRole("button", { name: "Converter" }).click();

  // A tela leva ao documento NOVO, na porta da variante dele.
  await expect(page).toHaveURL(/\/vendas\/orders\/[0-9a-f-]{36}$/);
  const idNovo = page.url().split("/").pop()!;

  /**
   * A PROVA É O SNAPSHOT NO SERVIDOR, não o texto da tela. O texto poderia estar certo com o registro
   * errado — é a TOP CONGELADA no documento derivado que diz qual operação de fato foi usada, e ela é
   * a única resposta que sobrevive a um recarregamento.
   */
  const topGravada = await topDoDocumento(page, "order", idNovo);
  expect(topGravada?.id, "o pedido nasceu com a TOP de destino escolhida").toBe(pedido.id);

  // E a ORIGEM ficou convertida — a conversão é uma transição, não uma cópia.
  await abrirDocumento(page, "budget", doc);
  await expect(page.getByTestId("central-vendas-situacao").locator("[data-status]").first()).toHaveText(/Convertid/i);
});

test("E18 — pedido com DUAS TOPs de venda converte na que o usuário escolheu, não na primeira", async ({ page }) => {
  await login(page);
  const vendaA = await cadastrarTop(page, "vendas.venda", "Venda à vista E18");
  const vendaB = await cadastrarTop(page, "vendas.venda", "Venda a prazo E18");
  const pedido = await cadastrarTop(page, "vendas.pedido", "Pedido E18", [vendaA, vendaB]);
  const doc = await criarDocumento(page, "order", pedido);

  await abrirDocumento(page, "order", doc);
  await page.getByTestId("acao-conversao").click();
  const dialogo = page.getByTestId("dialog-conversao");
  await expect(dialogo.getByTestId("proximo-passo-opcao"), "as duas vendas são oferecidas").toHaveCount(2);

  /**
   * ESCOLHE-SE A SEGUNDA, de propósito. Com a primeira, uma tela que ignorasse a escolha e convertesse
   * sempre no primeiro item do leque passaria no teste — e o defeito só apareceria em produção, na
   * primeira organização com dois caminhos configurados.
   */
  await dialogo.locator(`[data-testid="proximo-passo-opcao"][data-top-id="${vendaB.id}"]`).click();
  await dialogo.getByRole("button", { name: "Converter" }).click();

  await expect(page).toHaveURL(/\/vendas\/sales\/[0-9a-f-]{36}$/);
  const idNovo = page.url().split("/").pop()!;
  const topGravada = await topDoDocumento(page, "sale", idNovo);
  expect(topGravada?.id, "a venda nasceu com a SEGUNDA TOP, a que foi escolhida").toBe(vendaB.id);
  expect(topGravada?.id, "e não com a primeira do leque").not.toBe(vendaA.id);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * E19 — URL ANTIGA E ABA ANTIGA continuam abrindo o MESMO recorte, agora na lista única
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("E19 — a URL e a aba antigas entram na lista única JÁ FILTRADA, com o Tipo escolhido e removível", async ({ page }) => {
  await login(page);
  // Um documento de CADA tipo, para que "o filtro recortou" seja verificável: com um tipo só na base,
  // uma lista sem filtro nenhum pareceria filtrada.
  const orcamento = await criarDocumento(page, "budget", await cadastrarTop(page, "vendas.orcamento", "Orçamento E19"));
  const venda = await criarDocumento(page, "sale", await cadastrarTop(page, "vendas.venda", "Venda E19"));

  /**
   * OS DOIS CAMINHOS LEGADOS, medidos separadamente porque são mecanismos DIFERENTES: `/vendas/budgets`
   * é rota antiga (resolvida por `redirects.mjs`) e `?tab=budgets` é aba antiga (resolvida por
   * `LEGACY_TABS`). Um deles pode quebrar sozinho.
   */
  for (const [caso, url] of [["rota antiga", "/vendas/budgets"], ["aba antiga", "/vendas?tab=budgets"]] as [string, string][]) {
    await page.goto(url);
    await expect(page, `${caso}: a URL é canonicalizada para a lista única já filtrada`)
      .toHaveURL(/\/vendas\?.*tab=documentos.*kind=budget|\/vendas\?.*kind=budget.*tab=documentos/);

    const lista = page.getByTestId("vendas-documentos");
    await expect(lista, `${caso}: nenhum favorito antigo vira 404`).toBeVisible();
    await expect(lista, `${caso}: o recorte não se perdeu no caminho`).toHaveAttribute("data-kind", "budget");

    // O TIPO ESCOLHIDO NA BARRA — é ele que torna o recorte visível e removível, em vez de um filtro
    // invisível que o usuário não sabe que está ligado (VISUAL-UX-01 R3: a pílula "Tipo" do design).
    const tipo = page.getByTestId("vendas-tipo");
    await expect(tipo, `${caso}: a barra diz qual tipo está escolhido`).toHaveAttribute("data-valor", "budget");
    await expect(tipo, `${caso}: com o rótulo humano`).toContainText("Orçamento de venda");

    // E O RECORTE É REAL: o orçamento está, a venda não.
    const tabela = lista.locator("table").first();
    await expect(linhaDoDocumento(page, tabela, "budget", orcamento.code), `${caso}: o orçamento está na lista`).toHaveCount(1);
    await expect(linhaDoDocumento(page, tabela, "sale", venda.code),
      `${caso}: a venda não pode aparecer num recorte de orçamentos`).toHaveCount(0);
  }

  // REMOVÍVEL: o tipo é FILTRO, e filtro se tira na mesma tela. Era isso que as três abas não permitiam.
  await page.getByTestId("vendas-tipo").click();
  const todos = page.getByRole("menuitemradio", { name: "Todos os tipos" });
  await expect(page.getByRole("menuitemradio", { name: "Orçamento de venda" }), "o tipo aceso é o do recorte").toHaveAttribute("aria-checked", "true");
  await todos.click();
  const lista = page.getByTestId("vendas-documentos");
  await expect(lista).toHaveAttribute("data-kind", "");
  const tabela = lista.locator("table").first();
  await expect(linhaDoDocumento(page, tabela, "budget", orcamento.code), "sem filtro, o orçamento continua").toHaveCount(1);
  await expect(linhaDoDocumento(page, tabela, "sale", venda.code), "e a venda volta à mesma grade").toHaveCount(1);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * E21 — ORÇAMENTO → VENDA DIRETA: o ÚNICO formato em que o grafo e a cadeia fixa discordam
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * ┌─ POR QUE ESTE TESTE EXISTE, SENDO QUE P1 JÁ PROVA A CONVERSÃO DIRETA NO SERVIDOR ───────────────┐
 * │ `sales-conversao-permissao.test.ts` (P1) prova, na API, que orçamento → venda direta converte    │
 * │ com `sales.create` e SEM `orders.create`. O assunto de P1 é a CAPACIDADE. O assunto daqui é o    │
 * │ CAMINHO, e ele só existe no cliente: que a TELA ofereça essa saída, que o rótulo nomeie a venda, │
 * │ que a navegação termine na porta de vendas e que o documento derivado nasça `sale`.              │
 * │                                                                                                  │
 * │ NENHUM PERFIL DE PERMISSÃO É MONTADO AQUI — e é essa a razão de o teste não duplicar P1. O       │
 * │ administrador padrão do harness tem `sales.create`, então o leque não é filtrado por `can()` e a │
 * │ capacidade sai da equação inteira: o que sobra medido é a rota que a tela escolhe.                │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ A LACUNA REAL QUE ELE FECHA, E QUE NENHUM E2E DESTE REPOSITÓRIO FECHAVA ───────────────────────┐
 * │ A cadeia de compatibilidade do web é `{ budget: "order", order: "sale" }`                        │
 * │ (`features/sales/proximos-passos.ts`, `ARESTAS_DE_COMPATIBILIDADE`). Em TODO caso de conversão   │
 * │ já coberto — E12, E13, E17 (orçamento → pedido) e E18 (pedido → venda), mais "conversão exige a  │
 * │ TOP do DESTINO" em `portal-vendas-tipo-operacao.spec.ts` — o destino que o GRAFO declara COINCIDE │
 * │ com o destino que a cadeia fixa escolheria. Uma regressão em que a tela ignorasse a política e    │
 * │ voltasse a decidir o destino pela cadeia manteria todos eles VERDES: mesma variante de destino,   │
 * │ mesma URL final.                                                                                  │
 * │                                                                                                   │
 * │ Orçamento → VENDA é o único formato em que as duas respostas divergem: o grafo diz `sale`, a      │
 * │ cadeia diria `order`. É aqui, e só aqui, que a cadeia fixa cai — e por isso este teste afirma o   │
 * │ destino nos três lugares onde ela apareceria (rótulo do botão, conteúdo do diálogo, URL final).   │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
test("E21 — orçamento cuja política vai DIRETO à venda pula o pedido: rótulo, leque e rota são da venda", async ({ page }) => {
  await login(page);

  /**
   * A TOP DE PEDIDO É A ARMADILHA, e ela precisa estar ATIVA para a armadilha funcionar.
   *
   * Se a tela caísse na ponte, o diálogo não ficaria vazio: ele montaria o `select-tipo-operacao` da
   * cadeia anterior, carregado com as TOPs ATIVAS da família de pedido — e esta estaria lá dentro. Sem
   * uma TOP de pedido ativa no banco, "nenhum pedido é oferecido" seria satisfeito de graça por um
   * cadastro vazio, e a asserção mediria a ausência de fixture em vez da ausência da ponte.
   */
  const pedidoForaDaPolitica = await cadastrarTop(page, "vendas.pedido", "Pedido fora da política E21");
  /**
   * O NOME DA TOP DE VENDA NÃO CONTÉM A PALAVRA "VENDA", de propósito. O passo único exibe o rótulo da
   * FAMÍLIA logo abaixo do nome; se o nome também dissesse "Venda", afirmar que a família à vista é a de
   * venda seria satisfeito pelo próprio nome, e a asserção não provaria nada sobre o que o servidor
   * resolveu.
   */
  const venda = await cadastrarTop(page, "vendas.venda", "Faturamento direto E21");
  const orcamento = await cadastrarTop(page, "vendas.orcamento", "Orçamento direto ao faturamento E21", [venda]);

  /**
   * PREMISSA 1 — A POLÍTICA É MESMO A QUE O TESTE AFIRMA, lida do cadastro e não suposta do `POST`.
   *
   * `destinosConfigurados` é o discriminador da correção R1, e ele é a premissa de tudo o que vem
   * depois: com `false`, a tela cairia legitimamente na ponte e este teste estaria medindo a cadeia
   * anterior achando que mede o grafo. E o `codigoBase` do destino é a outra metade — é ele que faz o
   * grafo DISCORDAR da cadeia fixa. Um destino da família de pedido deixaria as duas respostas iguais
   * de novo, e o teste voltaria a ser uma cópia de E17.
   */
  const politica = await api<{ destinosConfigurados: boolean; destinos: { tipoOperacaoId: string; codigoBase: string }[] }>(
    page, "GET", `/api/admin/tipos-operacao/${orcamento.id}`);
  expect(politica.destinosConfigurados, "premissa: a política foi DECLARADA — sem isso a tela usaria a ponte, por direito").toBe(true);
  expect(politica.destinos.map((d) => [d.tipoOperacaoId, d.codigoBase]),
    "premissa: o único destino é a TOP de VENDA — é o que faz o grafo discordar da cadeia fixa").toEqual([[venda.id, "vendas.venda"]]);

  const doc = await criarDocumento(page, "budget", orcamento);
  await abrirDocumento(page, "budget", doc);

  /**
   * O RÓTULO É O PRIMEIRO LUGAR ONDE A CADEIA FIXA CAIRIA — e a comparação é EXATA, não `contains`.
   *
   * Na ponte o botão nomeia a FAMÍLIA do destino da cadeia anterior e leria "Converter em Pedido de
   * venda" (é exatamente o que CV1 afirma em `portal-vendas-tipo-operacao.spec.ts`). No grafo com um
   * destino só, ele nomeia a TOP: código e nome, os dois vindos do servidor. São dois textos que não se
   * confundem, então esta única asserção já separa os dois mundos.
   */
  const acao = page.getByTestId("acao-conversao");
  await expect(acao, "o botão nomeia a TOP de VENDA — não a família 'Pedido de venda' da cadeia anterior")
    .toHaveText(`Converter em ${venda.codigo} — ${venda.nome}`);
  await acao.click();

  const dialogo = page.getByTestId("dialog-conversao");
  await expect(dialogo).toBeVisible();
  const unico = dialogo.getByTestId("proximo-passo-unico");
  // O ID É A PROVA DE IDENTIDADE: só ele distingue "a tela mostrou a TOP certa" de "a tela mostrou um
  // texto que por acaso coincide".
  await expect(unico, "o único próximo passo é a TOP de venda").toHaveAttribute("data-top-id", venda.id);
  // E A FAMÍLIA À VISTA É A DE VENDA — não-vacuoso porque o nome da TOP não contém a palavra.
  await expect(unico, "a família exibida é a da VENDA, resolvida pelo servidor").toContainText("Venda");

  /**
   * NENHUMA OFERTA DE PEDIDO, pelos TRÊS jeitos em que ela apareceria. As três asserções não são a
   * mesma escrita de três formas: elas trancam mecanismos distintos.
   */
  // (1) O seletor da cadeia anterior nem existe na árvore: é o sinal inequívoco de que a ponte não foi
  //     usada. Grafo e ponte são mutuamente exclusivos por construção — este é o teste dessa exclusão.
  await expect(dialogo.getByTestId("select-tipo-operacao"), "a política respondeu: a ponte não está em jogo").toHaveCount(0);
  // (2) A TOP de pedido ATIVA que existe no banco não entrou em lugar nenhum do diálogo — nem como
  //     opção do leque, nem como item do seletor da ponte.
  await expect(dialogo.getByText(pedidoForaDaPolitica.nome),
    "uma TOP de pedido ativa que a política não declarou não pode ser oferecida").toHaveCount(0);
  // (3) E a família da cadeia anterior não é sequer mencionada.
  await expect(dialogo.getByText("Pedido de venda"), "nenhuma menção à família do destino da cadeia fixa").toHaveCount(0);
  // Com um destino só não há escolha a fazer: o desenho de leque é o de dois ou mais.
  await expect(dialogo.getByTestId("proximo-passo-opcao"), "um destino não é uma escolha").toHaveCount(0);

  await dialogo.getByRole("button", { name: "Converter" }).click();

  /**
   * A ROTA FINAL É A SEGUNDA QUEDA DA CADEIA FIXA. O segmento de destino é derivado da VARIANTE do
   * passo escolhido; se viesse da cadeia, a tela levaria a `/vendas/orders/…` — e, como nenhum pedido
   * foi criado, a `404` apareceria em cima de uma conversão que de fato deu certo.
   */
  await expect(page, "a navegação termina na porta de VENDAS, não na de pedidos").toHaveURL(/\/vendas\/sales\/[0-9a-f-]{36}$/);
  const idNovo = page.url().split("/").pop()!;

  /**
   * E A VARIANTE É CONFERIDA NO SERVIDOR, não pelo texto da tela. A porta `/api/sales/sales/:id` filtra
   * por `kind`: um documento `order` responderia 404 nela. Ler 200 aqui já é prova de variante, e o
   * `kind` do corpo a torna explícita em vez de implícita no código de status.
   */
  const derivado = await api<{ kind: string; tipo_operacao: { id: string } | null }>(page, "GET", `/api/sales/sales/${idNovo}`);
  expect(derivado.kind, "o documento derivado é uma VENDA no servidor").toBe("sale");
  expect(derivado.tipo_operacao?.id, "e nasceu com a TOP de venda que a política declarou").toBe(venda.id);

  /**
   * A FONTE FICOU CONVERTIDA — e o derivado dela é ESTE, e é só ele.
   *
   * A lista de derivados é o que prova que NENHUM pedido intermediário foi criado no caminho. Sem ela,
   * "a venda existe" seria compatível com uma tela que tivesse gerado um pedido antes e navegado para a
   * venda depois — o encadeamento que a política desta operação existe justamente para pular.
   */
  const fonte = await api<{ status: string; derived: { id: string; kind: string }[] }>(page, "GET", `/api/sales/budgets/${doc.id}`);
  expect(fonte.status, "conversão é transição, não cópia: a fonte ficou convertida").toBe("converted");
  expect(fonte.derived.map((x) => [x.id, x.kind]),
    "um único derivado, e ele é a venda — nenhum pedido intermediário foi criado").toEqual([[idNovo, "sale"]]);

  // E a tela da fonte diz a mesma coisa que o servidor: o estado do banco chega ao operador.
  await abrirDocumento(page, "budget", doc);
  await expect(page.getByTestId("central-vendas-situacao").locator("[data-status]").first(),
    "a fonte aparece convertida também na tela").toHaveText(/Convertid/i);
});
