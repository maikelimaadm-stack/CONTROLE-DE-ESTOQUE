import { test, expect, type Locator, type Page, type Response } from "@playwright/test";
import { cfg4 } from "./top-config-08-comum";
import { login, uniq } from "./helpers";
import { hojeISO } from "./estoque-01-comum";

/**
 * OPERACOES-01 · F6a · K-2, SENTIDO 2 — O WEB DA BASE CONTRA A API DESTE HEAD (decisão 283; a janela "API antes do web"
 * da DEPLOYMENT, e a reversão só do web).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 2 roda em `playwright.skew-web-anterior.config.ts`, cujo `testMatch` é
 * `/skew-web-anterior\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o `playwright.config.ts` comum
 * ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (lá o web seria o deste HEAD, e o caso não mediria
 * o cliente anterior). Arquivo próprio, e não um caso em `skew-web-anterior.spec.ts`: aquele é compartilhado com as
 * fases que correm em paralelo. A identidade do bundle da base é a do caso IDENTIDADE de `skew-web-anterior.spec.ts`,
 * na MESMA execução.
 *
 * O QUE SE MEDE. A API da F6a é ADITIVA para quem não usa nada novo: o pedido de compra ganha a situação "finalizado",
 * a aprovação ao finalizar, o "aprovado para orçamento" e os orçamentos; a leitura do pedido ganha `finalizado_em`,
 * `orcamentos` e outras chaves; `operation-types` ganha `finalizacaoEOrcamento`; `proximos-passos` ganha `exigeFinalizar`;
 * a prévia da compra ganha `divergencia` SÓ quando a TOP tem a seção. O navegador roda o bundle EXATO da base — que não
 * conhece nada disso — e faz, pelas telas dela, o que faz hoje:
 *   · K2-1 recebe pelo "Receber…" um pedido ABERTO cuja TOP não exige finalizar e confirma a compra (como hoje);
 *   · K2-2 a fila Aprovações › Compras lista o pedido cuja TOP exige aprovação e o aprova; a finalização (da API nova)
 *     passa depois disso — e a consulta da base abre o pedido finalizado, sem o Receber (o declarado na DEPLOYMENT);
 *   · K2-3 a lista de Documentos de Compras não mostra o orçamento, e a consulta do pedido que tem orçamento abre.
 * Em todos, o VIGIA: nenhuma resposta 404/422/5xx da API nova ao cliente da base e nenhuma requisição morta.
 *
 * OS DADOS nascem pela API DESTE HEAD (a que está sendo julgada), pelo contexto de requisição do Playwright — fora do
 * fio do navegador, que fica só com o que o web da base pediu. A TELA é a da base (622f194): os seletores são os dela,
 * conferidos em `git show 622f194:apps/web/e2e/compras-02-receber-pedido.spec.ts` e `…/top-config-08-aprovacoes.spec.ts`.
 * Quando a base avançar além da F6 (a F6b muda a Central de Compras), estes seletores têm de ser reconferidos no commit
 * da base nova.
 *
 * FIXTURE PRÓPRIA: cada caso cria as PRÓPRIAS TOPs, produto, fornecedor e documentos. Nada é apagado (decisão 247); as
 * TOPs saem no `finally` pela exclusão lógica da própria API, para o lançador e a fila das próximas execuções no mesmo
 * banco não herdarem operações daqui.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";

/** As mensagens da API nova, escritas à mão (o contrato da F6a). */
const MSG_PENDENTE_PEDIDO = "Este pedido precisa de aprovação antes de ser finalizado.";

type Cabecalhos = Record<string, string>;
type Opcao = { id: string; label: string };
type Resposta<T> = { status: number; corpo: T };
type PedidoLido = {
  id: string; codigo: string; situacao: string; finalizado_em: string | null; aprovado_orcamento_em: string | null;
  orcamentos: { id: string; situacao: string }[]; itens: { id: string; produto_id: string; quantidade: string }[];
  compras_geradas?: { id: string; codigo: string; situacao: string }[];
};
type LinhaDaFila = { id: string; codigo: string; especie: string; situacao: string };

/** Cabeçalhos da sessão gravada pelo web da base depois do login, para falar com a API deste HEAD direto. */
async function cabecalhosDaSessao(page: Page): Promise<Cabecalhos> {
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token?: string; orgId?: string });
  return { authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}) };
}

/** A API deste HEAD pelo contexto de requisição (fora do fio do navegador), sem lançar: o status e o corpo. */
async function chamar<T>(page: Page, cab: Cabecalhos, method: "GET" | "POST", caminho: string, corpo?: unknown): Promise<Resposta<T>> {
  const r = await page.request.fetch(`${API}${caminho}`, { method, headers: cab, ...(corpo === undefined ? {} : { data: corpo }) });
  const texto = await r.text();
  return { status: r.status(), corpo: (texto ? JSON.parse(texto) : {}) as T };
}

/** A chamada com o status EXIGIDO (premissa ou fixture) — o corpo vai na mensagem quando o status diverge. */
async function exigir<T>(page: Page, cab: Cabecalhos, status: number, method: "GET" | "POST", caminho: string, corpo?: unknown): Promise<T> {
  const r = await chamar<T>(page, cab, method, caminho, corpo);
  expect(r.status, `${method} ${caminho} → ${JSON.stringify(r.corpo).slice(0, 400)}`).toBe(status);
  return r.corpo;
}

/** Vigia do navegador (o desenho de `skew-web-anterior.spec.ts`): CORS morto e erro de contrato não passam calados. */
function vigiar(page: Page) {
  const falhas: string[] = []; const respostas: { url: string; status: number }[] = [];
  page.on("requestfailed", (r) => { if (r.url().includes(API)) falhas.push(`${r.url()} → ${r.failure()?.errorText ?? "?"}`); });
  page.on("console", (m) => { if (m.type() === "error" && /CORS|preflight|Access-Control/i.test(m.text())) falhas.push(`console: ${m.text()}`); });
  page.on("response", (r) => { if (r.url().includes("/api/")) respostas.push({ url: r.url(), status: r.status() }); });
  return {
    /** Premissa anti-vacuidade: o vigia viu o web da base falar com a API. */
    viuRespostas: () => expect(respostas.length, "o vigia registrou as respostas que o web da base recebeu").toBeGreaterThan(0),
    semBloqueio: () => expect(falhas, "nenhuma requisição do cliente em produção pode morrer no navegador").toEqual([]),
    semErroDeContrato: () => {
      const ruins = respostas.filter((r) => r.status === 404 || r.status === 422 || r.status >= 500);
      expect(ruins, `o cliente em produção não pode receber erro de contrato da API nova: ${JSON.stringify(ruins)}`).toEqual([]);
    }
  };
}

const codigoTop = (prefixo: string) => `${prefixo}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.slice(0, 20);
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const ehResposta = (method: string, caminho: string | RegExp) => (r: Response) =>
  r.request().method() === method && (typeof caminho === "string" ? new URL(r.url()).pathname === caminho : caminho.test(new URL(r.url()).pathname));

/**
 * Escolhe na célula da linha pela descrição (o seletor da base, `compras-02-receber-pedido.spec.ts`) — pelo nome
 * INTEIRO, e exigindo UMA opção: "Almoxarifado Central 1" e "… 2" têm os mesmos 20 primeiros caracteres.
 */
async function escolherNaLinha(page: Page, botao: Locator, nome: string) {
  await botao.click();
  await page.getByPlaceholder("Pesquisar pela descrição").fill(nome);
  const opcao = page.getByRole("option", { name: literal(nome) });
  await expect(opcao, `o seletor da base oferece exatamente uma opção "${nome}"`).toHaveCount(1);
  await opcao.click();
}

/** Os cadastros de um pedido de compra, NOVOS a cada caso (produto e, quando pedido, fornecedor), pela API deste HEAD. */
async function insumos(page: Page, cab: Cabecalhos, o: { fornecedorNovo?: boolean } = {}) {
  const ctx = await exigir<{ empresas?: { id: string }[] }>(page, cab, 200, "GET", "/api/auth/context");
  const empresa = ctx.empresas?.[0]?.id;
  expect(empresa, "premissa: o contexto expõe uma empresa").toBeTruthy();
  const un = (await exigir<Opcao[]>(page, cab, 200, "GET", "/api/resources/measurement_units/options")).find((u) => u.label.toUpperCase() === "UN");
  expect(un, "premissa: o seed tem a unidade UN").toBeTruthy();
  const grupo = (await exigir<Opcao[]>(page, cab, 200, "GET", "/api/resources/product_groups/options?kind=analytic"))[0];
  const natureza = (await exigir<Opcao[]>(page, cab, 200, "GET", "/api/resources/financial_categories/options?kind=analytic&nature=expense"))[0];
  const centro = (await exigir<Opcao[]>(page, cab, 200, "GET", "/api/resources/cost_centers/options?kind=analytic"))[0];
  expect(grupo && natureza && centro, "premissa: há grupo de produto, natureza de despesa e centro analíticos").toBeTruthy();
  const produto = await exigir<{ id: string }>(page, cab, 201, "POST", "/api/resources/products",
    { description: uniq("K2 F6a produto"), group_id: grupo!.id, measurement_id: un!.id, financial_category_id: natureza!.id });
  // O Local de estoque da empresa com NOME ÚNICO na organização: o seletor da base pesquisa pela descrição em todas as
  // empresas, e o seed repete nomes entre elas ("Silo de Grãos" nas duas) — o nome repetido tornaria a escolha ambígua.
  type Armazem = { id: string; description: string };
  const daEmpresa = (await exigir<{ items: Armazem[] }>(page, cab, 200, "GET", `/api/resources/warehouses?empresa_id=${empresa}&pageSize=100`)).items;
  const todos = (await exigir<{ items: Armazem[] }>(page, cab, 200, "GET", "/api/resources/warehouses?pageSize=200")).items;
  const armazem = daEmpresa.find((a) => todos.filter((x) => x.description === a.description).length === 1);
  expect(armazem, "premissa: a empresa tem um Local de estoque de nome único na organização").toBeTruthy();
  let fornecedor: { id: string; nome: string };
  if (o.fornecedorNovo) {
    const nome = uniq("K2 F6a Fornecedor");
    fornecedor = { id: (await exigir<{ id: string }>(page, cab, 201, "POST", "/api/resources/people", { name: nome, person_type: "legal", is_provider: true })).id, nome };
  } else {
    const p = (await exigir<{ items: { id: string; name: string }[] }>(page, cab, 200, "GET", "/api/resources/people?is_provider=true&pageSize=1")).items[0];
    expect(p, "premissa: o seed tem fornecedor").toBeTruthy();
    fornecedor = { id: p!.id, nome: p!.name };
  }
  return { empresa: empresa!, natureza: natureza!.id, centro: centro!.id, produto: produto.id, armazem: { id: armazem!.id, nome: armazem!.description }, fornecedor };
}

/** Uma TOP pela API deste HEAD; o formato GRAVADO é a premissa (o que a versão congelada do documento vai carregar). */
async function criarTop(page: Page, cab: Cabecalhos, tops: string[], codigoBase: string, extra: Record<string, unknown>, formato: number) {
  const codigo = codigoTop("k2f6");
  const top = await exigir<{ id: string }>(page, cab, 201, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase, nome: uniq(`K2 F6a ${codigoBase}`), ...extra });
  tops.push(top.id);
  const d = await exigir<{ configuracaoSchema: number }>(page, cab, 200, "GET", `/api/admin/tipos-operacao/${top.id}`);
  expect(d.configuracaoSchema, `premissa: ${codigoBase} gravada no formato ${formato}`).toBe(formato);
  return { id: top.id, codigo };
}

/** Exclusão lógica das TOPs do caso (a revisão corrente é exigida). Falha aqui é registrada, sem esconder o erro do teste. */
async function excluirTops(page: Page, cab: Cabecalhos, tops: string[]) {
  for (const id of tops) {
    const d = await chamar<{ revisao?: number }>(page, cab, "GET", `/api/admin/tipos-operacao/${id}`);
    const r = await page.request.fetch(`${API}/api/admin/tipos-operacao/${id}?revisao=${d.corpo.revisao ?? ""}`, { method: "DELETE", headers: cab, data: {} });
    if (!r.ok()) console.warn(`[f6a-skew] limpeza da TOP ${id} falhou: ${r.status()}`);
  }
}

/** O pedido pela API deste HEAD: um item, com natureza e centro (vão para a compra, que gera conta a pagar). */
async function lancarPedido(page: Page, cab: Cabecalhos, i: Awaited<ReturnType<typeof insumos>>, topPedido: string, quantidade: string, unitario: string) {
  const criado = await exigir<{ id: string }>(page, cab, 201, "POST", "/api/compras/pedidos", {
    empresa_id: i.empresa, tipo_operacao_id: topPedido, fornecedor_id: i.fornecedor.id, data_documento: hojeISO(),
    categoria_financeira_id: i.natureza, centro_custo_id: i.centro, itens: [{ produto_id: i.produto, quantidade, valor_unitario: unitario }]
  });
  return exigir<PedidoLido>(page, cab, 200, "GET", `/api/compras/pedidos/${criado.id}`);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K2-1 — A BASE RECEBE O PEDIDO ABERTO (TOP SEM "EXIGIR FINALIZADO") E CONFIRMA A COMPRA, COMO HOJE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("OP01-F6a · K2-1 (sentido 2) — o web da base recebe pelo 'Receber…' o pedido ABERTO cuja TOP não exige finalizar e confirma a compra, como hoje: o pedido fica convertido", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const tops: string[] = [];
  try {
    // O GRAFO, como a base o monta hoje (TOPs sem configuração = o neutro do servidor): Pedido → Compra, "Em partes".
    const topCompra = await criarTop(page, cab, tops, "compras.compra", {}, 2);
    const topPedido = await criarTop(page, cab, tops, "compras.pedido", { destinos: [{ tipoOperacaoId: topCompra.id, ordem: 0, emPartes: true }] }, 2);
    const i = await insumos(page, cab);
    const pedido = await lancarPedido(page, cab, i, topPedido.id, "3", "7.00");
    const item = pedido.itens[0]!;

    // PREMISSA: a API julgada é a NOVA — a leitura do pedido traz as chaves da F6a, as capacidades declaram a nova no
    // FIM (as quatro de hoje, na ordem de hoje) e os próximos passos dizem que esta TOP NÃO exige finalizar.
    expect(pedido.situacao, "premissa: o pedido nasce aberto").toBe("aberto");
    expect(pedido.finalizado_em, "premissa: a API nova lê o pedido com `finalizado_em` (nulo: não finalizado)").toBeNull();
    expect(pedido.orcamentos, "premissa: e com `orcamentos` (nenhum)").toEqual([]);
    for (const segmento of ["pedidos", "compras"]) {
      const ot = await exigir<{ contractVersion: number; capacidades: Record<string, unknown> }>(page, cab, 200, "GET", `/api/compras/${segmento}/operation-types`);
      expect(ot.contractVersion, `${segmento}: o contrato que a base lê continua o 1`).toBe(1);
      expect(Object.keys(ot.capacidades).slice(0, 4), `${segmento}: as quatro capacidades de hoje, na ordem de hoje`)
        .toEqual(["classificacaoFinanceira", "condicaoPagamento", "layoutDocumento", "regrasDaOperacao"]);
      expect(ot.capacidades.finalizacaoEOrcamento, `premissa: ${segmento} declara a capacidade da F6a`).toBe(1);
    }
    const passosNaApi = await exigir<{ exigeFinalizar?: boolean; items: { codigo: string }[] }>(page, cab, 200, "GET", `/api/compras/pedidos/${pedido.id}/proximos-passos`);
    expect(passosNaApi.exigeFinalizar, "premissa: a TOP deste pedido NÃO exige finalizar (o neutro)").toBe(false);
    expect(passosNaApi.items.map((x) => x.codigo), "premissa: o passo é a TOP de compra").toEqual([topCompra.codigo]);

    const v = vigiar(page);

    // (1) A CONSULTA DA BASE: aberto, com a pílula "Receber…" do passo que a TOP declara.
    await page.goto(`/compras/pedidos/${pedido.id}`);
    await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");
    const passos = page.getByTestId("compras-proximos-passos");
    await expect(passos, "a base leu os próximos passos da API nova (chave a mais ignorada)").toHaveAttribute("data-situacao", "pronto");
    const receber = passos.getByTestId(`compras-proximo-passo-${topCompra.codigo}`);
    await expect(receber).toContainText("Receber…");
    await expect(receber).toBeEnabled();
    await receber.click();

    // (2) A CENTRAL DA BASE EM MODO RECEBER: o item do pedido com o saldo; Local de estoque, nota, série e entrada.
    await expect(page).toHaveURL(new RegExp(`/compras/compras/new\\?.*pedido=${pedido.id}`));
    const central = page.getByTestId("compras-central");
    await expect(central).toHaveAttribute("data-modo", "receber");
    await expect(page.getByTestId("compras-central-receber")).toHaveAttribute("data-situacao", "pronto");
    await expect(page.getByTestId("compras-receber-pedido")).toContainText(pedido.codigo);
    const linha = page.getByTestId(`compras-receber-item-${item.id}`);
    await expect(linha.getByTestId("central-compras-saldo-da-origem")).toHaveText("3,0000");
    await escolherNaLinha(page, linha.getByTestId("central-compras-armazem"), i.armazem.nome);
    await expect(linha.getByLabel("Quantidade do item 1"), "a quantidade começa no saldo inteiro").toHaveValue(/^3/);
    await linha.getByLabel("Valor unitário do item 1").fill("7");
    const nota = `K2${Date.now().toString(36).toUpperCase()}`;
    await page.getByTestId("compras-numero-nota").fill(nota);
    await page.getByTestId("compras-serie-nota").fill("1");
    // O calendário do produto: digita-se dd/mm/aaaa e Enter confirma (o valor vira ISO). A entrada é hoje.
    const hoje = hojeISO();
    const entrada = central.getByLabel("Data de entrada", { exact: true });
    await entrada.fill(hoje.split("-").reverse().join("/"));
    await entrada.press("Enter");
    await expect(page.getByTestId("compras-data-entrada").locator("input[type=hidden]")).toHaveValue(hoje);
    await expect(page.getByTestId("compras-total")).toContainText("21,00");
    const recebeu = page.waitForResponse(ehResposta("POST", `/api/compras/pedidos/${pedido.id}/convert`));
    await page.getByTestId("compras-salvar").click();
    expect((await recebeu).status(), "a API nova recebe o pedido ABERTO pelo corpo da base").toBe(201);

    // (3) A CONSULTA DA COMPRA DA BASE, e CONFIRMAR pela prévia — a prévia da API nova é a de hoje (sem `divergencia`).
    await expect(page).toHaveURL(/\/compras\/compras\/[0-9a-f-]{36}$/);
    const compraId = /\/compras\/compras\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
    const corpo = page.getByTestId("compras-consulta-corpo");
    await expect(corpo).toHaveAttribute("data-situacao", "aberto");
    await expect(page.getByTestId("compras-origem")).toContainText(`Pedido de compra ${pedido.codigo}`);
    const previa = page.waitForResponse(ehResposta("GET", `/api/compras/compras/${compraId}/previa-confirmacao`));
    await page.getByTestId("compras-confirmar").click();
    const corpoDaPrevia = (await (await previa).json()) as Record<string, unknown>;
    expect("divergencia" in corpoDaPrevia, "TOP sem a seção: a prévia é a de hoje, sem a chave nova").toBe(false);
    await expect(page.getByTestId("compras-previa")).toHaveAttribute("data-situacao", "pronta");
    const confirmou = page.waitForResponse(ehResposta("POST", `/api/compras/compras/${compraId}/confirm`));
    await page.getByTestId("confirm-dialog-confirm").click();
    expect((await confirmou).status(), "a API nova confirma pelo corpo da base").toBe(200);
    await expect(corpo).toHaveAttribute("data-situacao", "confirmado");

    // (4) O SERVIDOR: compra confirmada, ligada ao pedido; o pedido CONVERTIDO (o saldo zerou), nunca finalizado.
    const compra = await exigir<{ situacao: string; origem_documento_id: string; numero_nota: string }>(page, cab, 200, "GET", `/api/compras/compras/${compraId}`);
    expect(compra).toMatchObject({ situacao: "confirmado", origem_documento_id: pedido.id, numero_nota: nota });
    const depois = await exigir<PedidoLido>(page, cab, 200, "GET", `/api/compras/pedidos/${pedido.id}`);
    expect([depois.situacao, depois.finalizado_em], "o pedido recebido inteiro passa a convertido, sem passar por finalizado").toEqual(["convertido", null]);
    expect(depois.compras_geradas, "a compra gerada, confirmada").toEqual([{ id: compraId, codigo: expect.any(String), situacao: "confirmado" }]);

    // (5) A CONSULTA DA BASE MOSTRA O PEDIDO CONVERTIDO.
    await page.goto(`/compras/pedidos/${pedido.id}`);
    await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "convertido");

    v.viuRespostas();
    v.semBloqueio();
    v.semErroDeContrato();
  } finally {
    await excluirTops(page, cab, tops);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K2-2 — A FILA DA BASE LISTA O PEDIDO QUE EXIGE APROVAÇÃO E O APROVA; A FINALIZAÇÃO PASSA DEPOIS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("OP01-F6a · K2-2 (sentido 2) — a fila Aprovações › Compras da base lista o pedido cuja TOP (formato 4) exige aprovação e o aprova pela tela; depois, finalizar na API nova dá 200 e a consulta da base abre o pedido finalizado, sem Receber", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const tops: string[] = [];
  try {
    // A TOP de pedido no FORMATO 4 com "Sempre" (o que o editor da base grava): a matriz nova aceita aprovação no pedido.
    const topPedido = await criarTop(page, cab, tops, "compras.pedido", { configuracao: cfg4({ aprovacao: "sempre" }) }, 4);
    const i = await insumos(page, cab);
    const pedido = await lancarPedido(page, cab, i, topPedido.id, "2", "15.00");

    // PREMISSA NO SERVIDOR: sem aprovação, finalizar recusa (a mensagem do pedido); a fila tem o pedido, pendente.
    const antes = await chamar<{ error?: { code?: string; message?: string } }>(page, cab, "POST", `/api/compras/pedidos/${pedido.id}/finalizar`, {});
    expect([antes.status, antes.corpo.error?.code, antes.corpo.error?.message], "premissa: finalizar exige a aprovação")
      .toEqual([409, "APROVACAO_PENDENTE", MSG_PENDENTE_PEDIDO]);
    const fila = await exigir<{ items: LinhaDaFila[] }>(page, cab, 200, "GET", "/api/aprovacoes/compras?page=1&pageSize=200");
    expect(fila.items.find((l) => l.id === pedido.id), "premissa: a fila da API nova lista o pedido, pendente")
      .toMatchObject({ especie: "pedido", situacao: "pendente", codigo: pedido.codigo });

    const v = vigiar(page);

    // (1) A FILA DA BASE: a aba Compras, com a linha do pedido (a espécie que o SERVIDOR classificou), "Aguardando aprovação".
    await page.goto("/aprovacoes?tab=compras");
    await expect(page.getByTestId("aprovacoes-indisponivel"), "a API nova serve a fila").toHaveCount(0);
    await expect(page.getByTestId("aprovacoes-lista")).toHaveAttribute("data-area", "compras");
    const linha = page.locator(`[data-testid="aprovacao-linha"][data-id="${pedido.id}"]`);
    await expect(linha, "a base mostra o pedido na fila").toHaveAttribute("data-especie", "pedido");
    await expect(linha).toHaveAttribute("data-situacao", "pendente");
    await expect(linha).toHaveAttribute("data-codigo", pedido.codigo);
    await expect(page.getByRole("row").filter({ has: linha }).locator("[data-status]"), "o selo da situação").toHaveText("Aguardando aprovação");

    // (2) APROVAR PELA TELA DA BASE: o diálogo diz o código; a porta da base; 200; "Aprovado."; a linha sai.
    await page.getByTestId(`aprovacao-aprovar-${pedido.id}`).click();
    const dialogo = page.getByTestId("aprovacao-dialogo");
    await expect(dialogo.getByRole("heading", { name: `Aprovar o documento ${pedido.codigo}?` })).toBeVisible();
    const aprovou = page.waitForResponse(ehResposta("POST", `/api/aprovacoes/compras/${pedido.id}/aprovar`));
    await dialogo.getByTestId("aprovacao-confirmar").click();
    const resposta = await aprovou;
    expect(resposta.status(), "a API nova aceita a decisão da base sobre o pedido").toBe(200);
    const decisao = (await resposta.json()) as { aprovacao?: { decisao?: string } } & Record<string, unknown>;
    expect(decisao.aprovacao?.decisao).toBe("aprovado");
    expect("confirmacaoAutomatica" in decisao, "o pedido não confirma sozinho ao ser aprovado").toBe(false);
    expect(resposta.request().postDataJSON(), "o corpo da base: sem observação, vazio").toEqual({});
    await expect(page.getByTestId("aprovacao-mensagem")).toHaveText("Aprovado.");
    await expect(linha, "a linha aprovada sai da fila").toHaveCount(0);

    // (3) A DECISÃO VALE: finalizar, que recusava, passa na API nova.
    const finalizado = await exigir<{ id: string; situacao: string; finalizado_em: string | null }>(page, cab, 200, "POST", `/api/compras/pedidos/${pedido.id}/finalizar`, {});
    expect(finalizado.situacao, "aprovado, o pedido é finalizado").toBe("finalizado");
    expect(finalizado.finalizado_em, "com quando").not.toBeNull();
    expect((await exigir<PedidoLido>(page, cab, 200, "GET", `/api/compras/pedidos/${pedido.id}`)).situacao).toBe("finalizado");

    // (4) A CONSULTA DA BASE ABRE O PEDIDO FINALIZADO, e o Receber da base fica desabilitado (o declarado na DEPLOYMENT:
    // a Central da base só recebe pedido aberto; o servidor aceitaria).
    await page.goto(`/compras/pedidos/${pedido.id}`);
    await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "finalizado");
    await expect(page.getByTestId("central-compras-receber"), "a base não oferece receber o pedido finalizado").toBeDisabled();

    v.viuRespostas();
    v.semBloqueio();
    v.semErroDeContrato();
  } finally {
    await excluirTops(page, cab, tops);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K2-3 — A LISTA DE DOCUMENTOS DA BASE NÃO MOSTRA O ORÇAMENTO; A CONSULTA DO PEDIDO COM ORÇAMENTO ABRE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("OP01-F6a · K2-3 (sentido 2) — a lista de Documentos de Compras da base não mostra o orçamento criado pela API nova (aprovado para orçamento + orçamento), e a consulta do pedido que tem orçamento abre", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const tops: string[] = [];
  try {
    // O GRAFO DA F6a: TOP de orçamento e TOP de pedido com a aresta pedido → orçamento. Um fornecedor NOVO, o do pedido e
    // o do orçamento: a busca por ele na lista acharia os dois, se a lista mostrasse o orçamento.
    const topOrcamento = await criarTop(page, cab, tops, "compras.orcamento", {}, 2);
    const topPedido = await criarTop(page, cab, tops, "compras.pedido", { destinos: [{ tipoOperacaoId: topOrcamento.id, ordem: 0, emPartes: false }] }, 2);
    const i = await insumos(page, cab, { fornecedorNovo: true });
    const pedido = await lancarPedido(page, cab, i, topPedido.id, "4", "12.50");
    const aprovado = await exigir<{ aprovado_orcamento_em: string | null }>(page, cab, 200, "POST", `/api/compras/pedidos/${pedido.id}/aprovar-para-orcamento`, {});
    expect(aprovado.aprovado_orcamento_em, "premissa: o pedido foi aprovado para orçamento").not.toBeNull();
    const orcamento = await exigir<{ id: string; codigo: string; especie: string; situacao: string; pedido_orcado_id: string }>(page, cab, 201, "POST",
      `/api/compras/pedidos/${pedido.id}/orcamentos`, { tipo_operacao_id: topOrcamento.id, fornecedor_id: i.fornecedor.id, data_documento: hojeISO() });
    expect(orcamento, "premissa: o orçamento nasceu, aberto, ligado ao pedido").toMatchObject({ especie: "orcamento", situacao: "aberto", pedido_orcado_id: pedido.id });

    // PREMISSA: o orçamento EXISTE e casa com a mesma busca — a API o devolve quando pedido explicitamente (`especie`);
    // sem pedir, a lista única da API nova é a de hoje (pedido e compra).
    const busca = encodeURIComponent(i.fornecedor.nome);
    const pedindo = await exigir<{ items: { id: string; especie: string }[] }>(page, cab, 200, "GET", `/api/compras/documentos?especie=orcamento&search=${busca}`);
    expect(pedindo.items.map((x) => [x.id, x.especie]), "premissa: pedido explicitamente, o orçamento casa com a busca").toEqual([[orcamento.id, "orcamento"]]);
    const lido = await exigir<PedidoLido>(page, cab, 200, "GET", `/api/compras/pedidos/${pedido.id}`);
    expect(lido.orcamentos.map((o) => [o.id, o.situacao]), "premissa: a leitura do pedido na API nova lista o orçamento").toEqual([[orcamento.id, "aberto"]]);

    const v = vigiar(page);

    // (1) A LISTA DA BASE, com o filtro "Código / fornecedor / nota" = o fornecedor novo: a resposta que a base recebeu
    // tem o pedido e NÃO tem o orçamento; a grade, uma linha só.
    await page.goto("/compras?tab=documentos");
    await expect(page.getByTestId("compras-documentos-indisponivel"), "a API nova serve a lista").toHaveCount(0);
    await expect(page.getByRole("table").first(), "a lista da base montou").toBeVisible();
    const listou = page.waitForResponse((r) => {
      const u = new URL(r.url());
      return r.request().method() === "GET" && u.pathname === "/api/compras/documentos" && u.searchParams.get("search") === i.fornecedor.nome;
    });
    await page.getByRole("button", { name: "Filtro Código / fornecedor / nota" }).click();
    const campoDaBusca = page.getByLabel("Código / fornecedor / nota", { exact: true });
    await campoDaBusca.fill(i.fornecedor.nome);
    await campoDaBusca.press("Enter");
    const respostaDaLista = await listou;
    expect(respostaDaLista.status()).toBe(200);
    expect(new URL(respostaDaLista.url()).searchParams.get("especie"), "a base não pede espécie").toBeNull();
    const lista = (await respostaDaLista.json()) as { items: { id: string; especie: string }[] };
    expect(lista.items.map((x) => [x.id, x.especie]), "a base recebe o pedido, e só ele: o orçamento não entra na lista de hoje")
      .toEqual([[pedido.id, "pedido"]]);
    const linhas = page.getByRole("row").filter({ hasText: i.fornecedor.nome });
    await expect(linhas, "a grade da base mostra uma linha do fornecedor").toHaveCount(1);
    await expect(linhas.first()).toContainText(pedido.codigo);

    // (2) A CONSULTA DO PEDIDO QUE TEM ORÇAMENTO ABRE NA BASE (as chaves a mais da leitura são ignoradas) e os próximos
    // passos da base ficam "prontos": o destino de orçamento não vira um Receber.
    const leitura = page.waitForResponse(ehResposta("GET", `/api/compras/pedidos/${pedido.id}`));
    await page.goto(`/compras/pedidos/${pedido.id}`);
    const lidoPelaBase = (await (await leitura).json()) as PedidoLido;
    expect(lidoPelaBase.orcamentos.map((o) => o.id), "a base recebeu a leitura com o orçamento").toEqual([orcamento.id]);
    await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");
    await expect(page.getByTestId("compras-proximos-passos"), "a base leu os próximos passos").toHaveAttribute("data-situacao", "pronto");
    await expect(page.getByTestId("compras-proximos-passos-vazio"), "o destino de orçamento não é oferecido como receber").toBeVisible();
    await expect(page.locator("[data-testid^='compras-proximo-passo-']"), "nenhum passo de receber").toHaveCount(0);

    v.viuRespostas();
    v.semBloqueio();
    v.semErroDeContrato();
  } finally {
    await excluirTops(page, cab, tops);
  }
});
