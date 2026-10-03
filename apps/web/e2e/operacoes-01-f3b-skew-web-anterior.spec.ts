import type { Page, Request, Response } from "@playwright/test";
import { login, api, uniq, pickRef, adicionarItemNaCentral, preencherClassificacaoFinanceira } from "./helpers";
import { cabecalhosDaSessao } from "./top-config-08-comum";
import { test, expect, codigoTop, criarCadastro, criarTop } from "./central-compras-fixtures";
import {
  API, CHAVES_ADITIVAS_DA_RESPOSTA, CHAVES_DA_RESPOSTA_DE_HOJE, CHAVES_DO_ITEM_DA_PESQUISA, PORTA_DA_PESQUISA, PORTA_DA_PESQUISA_DE_HOJE,
  cenarioDaPesquisa, mundoDoWebDaBaseF3b, premissaDaApiF3b, vigiar
} from "./operacoes-01-f3b-skew-comum";

/**
 * OPERACOES-01 · F3b (decisão 280) · K-2, SENTIDO 2 — O WEB DA BASE CONTRA A API DESTE HEAD (a janela "API antes do web"
 * da DEPLOYMENT, e a reversão só do web).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 2 roda em `playwright.skew-web-anterior.config.ts`, cujo `testMatch` é
 * `/skew-web-anterior\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o `playwright.config.ts` comum
 * ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (lá o web seria o deste HEAD, e o caso não mediria
 * o cliente anterior). O caso não foi acrescentado em `skew-web-anterior.spec.ts` porque aquele arquivo é compartilhado
 * com as fases que correm em paralelo: o arquivo próprio não colide com nenhuma. A identidade do bundle da base é a do
 * caso IDENTIDADE de `skew-web-anterior.spec.ts`, na MESMA execução.
 *
 * O QUE SE MEDE. A API desta fase só ACRESCENTA: a rota de leitura `GET /api/produtos/pesquisa/capacidades`, que o web
 * da base nunca chama; os parâmetros `pagina`, `com_saldo` e `controla_estoque` da pesquisa, que ele nunca manda; e três
 * chaves ao FIM da resposta da pesquisa. O que MUDA para o web da base é a ORDEM do layout do sistema de vendas: o
 * `layout-efetivo` da TOP sem layout salvo chega com o Local de estoque antes do Produto. O navegador roda o bundle
 * EXATO da base, e:
 *   · K-2a — a Central de Vendas da BASE desenha a grade na ordem do layout que a API nova manda (Local primeiro — o
 *     contrato do layout desde a A3-1), pesquisa produto em `/api/resources/products/options` (o produto sem saldo
 *     aparece) e NENHUM pedido sai para `/api/produtos/pesquisa*`; o POST leva as chaves de HOJE e a API nova grava (201);
 *     nenhuma requisição morre e nenhuma resposta da página é 404, 422 ou 5xx (`semErroDeContrato`);
 *   · K-2b — o CONTRATO ANTIGO da rota, direto na API deste HEAD: os parâmetros de HOJE (`busca`, `armazem_id`,
 *     `limite`) respondem 200, as duas chaves de hoje PRIMEIRO e as três aditivas no fim, cada item com as seis chaves de
 *     hoje e o mesmo significado (sem filtro, o produto sem saldo aparece; o saldo do local, como antes).
 *
 * O MUNDO, NESTE SENTIDO, É O DO WEB DA BASE (`mundoDoWebDaBaseF3b`, em `operacoes-01-f3b-skew-comum.ts`): a ÁRVORE da
 * base em `.api-anterior` conhece a porta "produtos/pesquisa/capacidades"? Não → legado (a base de hoje): o descrito
 * acima. Sim → novo (a base já com a F3b): a pesquisa nova, só com saldo na venda, e zero pedido à de hoje. A API deste
 * HEAD entra como PREMISSA (`premissaDaApiF3b`): ela declara a capacidade e aceita `pagina` — é ela que está sendo
 * julgada. As TOPs, os cadastros e o saldo nascem pela API deste HEAD (as portas de `central-compras-fixtures`, com a
 * exclusão lógica no fim do caso, passou ou falhou); a venda que termina aberta é cancelada no fim.
 */

const PV = "central-vendas";
const caminho = (r: Request | Response) => new URL(r.url()).pathname;
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

/** As chaves do POST de HOJE da Central de Vendas (a lista de W4), conjunto EXATO; e as do item. */
const CHAVES_DO_POST_DA_VENDA = [
  "categoria_financeira_id", "centro_custo_id",
  "client_id", "discount", "document_date", "driver_name", "due_date", "empresa_id", "freight", "freight_icms",
  "installment_plan", "is_deductible", "items", "note", "other_values", "payment_method_id", "proprietary_id",
  "shipping_date", "tipo_operacao_id", "transporter_id"
];
const CHAVES_DO_ITEM_DA_VENDA = ["discount", "discount_percent", "note", "product_id", "quantity", "unit_price", "warehouse_id"];

type Venda = { id: string; status: string; items: { product_id: string; warehouse_id: string | null }[] };
type PaginaNoFio = { itens: { id: string; estoque: string | null }[]; filtradoPorSaldo: boolean };

const vendaNoServidor = (page: Page, id: string) => api<Venda>(page, "GET", `/api/sales/sales/${id}`);

/** A venda que ficou aberta é cancelada no fim. */
async function cancelarAbertas(page: Page, vendas: string[]) {
  for (const id of vendas) {
    const v = await vendaNoServidor(page, id).catch(() => null);
    if (v && ["open", "approved"].includes(v.status)) await api(page, "POST", `/api/sales/sales/${id}/cancel`, {}).catch(() => undefined);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K-2a · A CENTRAL DE VENDAS DA BASE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("OP01-F3b · K-2a (sentido 2) — a Central de Vendas do web da base contra a API deste HEAD: a grade na ordem do layout novo (Local de estoque primeiro), a pesquisa de produto em `/options` sem nenhum pedido a `/api/produtos/pesquisa*`, o POST de hoje aceito (201), sem erro de contrato", async ({ page }) => {
  const mundo = mundoDoWebDaBaseF3b();
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const vendas: string[] = [];
  try {
    await premissaDaApiF3b(page, cab);
    const c = await cenarioDaPesquisa(page, "K2a");
    const { id: top } = await criarTop(page, { codigo: codigoTop("f3k2"), codigoBase: "vendas.venda", nome: uniq("F3b K-2 venda") });
    const cliente = uniq("Cliente F3bK2");
    await criarCadastro(page, "people", { name: cliente, person_type: "legal", is_client: true });
    const v = vigiar(page);

    // todo pedido (GET) às pesquisas de produto — a nova pelo PREFIXO (a rota, a capacidade e qualquer outra sob ela)
    const novas: URL[] = [];
    const deHoje: URL[] = [];
    page.on("request", (r) => {
      if (r.method() !== "GET") return;
      const u = new URL(r.url());
      if (u.pathname.startsWith(PORTA_DA_PESQUISA)) novas.push(u);
      else if (u.pathname === PORTA_DA_PESQUISA_DE_HOJE) deHoje.push(u);
    });
    const layout = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === "/api/sales/sales/layout-efetivo"
      && new URL(r.url()).searchParams.get("tipo_operacao_id") === top);
    await page.goto(`/vendas/sales/new?tipo_operacao_id=${top}`);
    await expect(page.getByTestId("top-contexto"), "o web da base abriu o formulário desta TOP").toBeVisible();

    // A ORDEM: a API nova manda o layout do sistema com o Local de estoque primeiro; o web da base desenha na ordem dele
    const l = await layout;
    expect(l.status(), "a API nova respondeu o layout efetivo ao web da base").toBe(200);
    const campos = ((await l.json() as { estrutura: { itens: { campo: string }[] } }).estrutura.itens).map((x) => x.campo);
    expect([campos[0], campos.indexOf("warehouse_id") < campos.indexOf("product_id")], "premissa: o layout da API nova põe o Local de estoque primeiro, antes do Produto")
      .toEqual(["warehouse_id", true]);
    const desenhadas = () => page.getByTestId(`${PV}-grade`).locator("thead th[data-campo]").evaluateAll((ths) => ths.map((th) => th.getAttribute("data-campo")));
    await expect.poll(desenhadas, { message: "o web da base desenha exatamente os itens do layout da API nova, na ordem dele" }).toEqual(campos);

    await pickRef(page, "Cliente", cliente);
    await adicionarItemNaCentral(page);
    const linha = page.getByTestId(`${PV}-linha`).first();
    await expect(page.getByTestId(`${PV}-linha`)).toHaveCount(1);
    const painel = page.getByTestId(`${PV}-pesquisa`);

    // o Local de estoque da LINHA, pela célula do web da base
    await linha.getByTestId(`${PV}-armazem`).click();
    await expect(painel).toBeVisible();
    await painel.getByRole("combobox").fill(c.l1.nome);
    await painel.getByRole("option", { name: literal(c.l1.nome) }).first().click();
    await expect(painel).toHaveCount(0);
    await expect(linha.getByTestId(`${PV}-armazem`)).toContainText(c.l1.nome);

    // A PESQUISA DE PRODUTO do web da base
    await linha.getByTestId(`${PV}-produto`).click();
    await expect(painel).toBeVisible();
    const resposta = page.waitForResponse((r) => {
      const u = new URL(r.url());
      if (r.request().method() !== "GET") return false;
      return mundo === "novo" ? u.pathname === PORTA_DA_PESQUISA && u.searchParams.get("busca") === c.tag
        : u.pathname === PORTA_DA_PESQUISA_DE_HOJE && u.searchParams.get("search") === c.tag;
    });
    await painel.getByRole("combobox").fill(c.tag);
    const r = await resposta;
    expect(r.status(), "a API nova respondeu a pesquisa do web da base").toBe(200);
    const opcoes = painel.getByRole("option");
    if (mundo === "legado") {
      expect(await painel.getAttribute("data-fonte"), "o painel é o da base (sem a marca da fonte que a F3b acrescentou)").toBeNull();
      expect(((await r.json()) as { id: string }[]).map((o) => o.id), "a pesquisa de hoje, sem filtro de saldo: os três, P2 (sem saldo) também").toEqual([c.p1.id, c.p2.id, c.p3.id]);
      await expect(opcoes, "o web da base mostra o que a API respondeu").toHaveCount(3);
    } else {
      await expect(painel, "a base já com a F3b: a pesquisa nova").toHaveAttribute("data-fonte", "pesquisa");
      const pagina = await r.json() as PaginaNoFio;
      expect([new URL(r.url()).searchParams.get("com_saldo"), pagina.filtradoPorSaldo, pagina.itens.map((i) => i.id)], "a saída: só com saldo no local da linha")
        .toEqual(["true", true, [c.p1.id, c.p3.id]]);
      await expect(opcoes).toHaveCount(2);
    }
    await opcoes.filter({ hasText: c.p1.nome }).click();
    await expect(painel).toHaveCount(0);
    await expect(linha.getByTestId(`${PV}-produto`)).toContainText(c.p1.nome);
    await linha.getByLabel("Quantidade").fill("1");
    await linha.getByLabel("Valor unitário").fill("10");
    await preencherClassificacaoFinanceira(page);

    // O POST do web da base: as chaves de HOJE; a API nova aceita (201) e grava o item com o local da linha
    const post = page.waitForResponse((x) => x.request().method() === "POST" && caminho(x) === "/api/sales/sales");
    await page.getByTestId(`${PV}-salvar`).click();
    const salvo = await post;
    expect(salvo.status(), "a API nova aceitou o corpo do web da base").toBe(201);
    const { id } = await salvo.json() as { id: string };
    vendas.push(id);
    const enviado = salvo.request().postDataJSON() as Record<string, unknown> & { items: Record<string, unknown>[] };
    expect(Object.keys(enviado).sort(), "o POST do web da base leva as chaves de HOJE (a lista de W4)").toEqual(CHAVES_DO_POST_DA_VENDA);
    expect(enviado.items.map((i) => Object.keys(i).sort()), "e o item, as de hoje").toEqual([CHAVES_DO_ITEM_DA_VENDA]);
    expect(enviado.items[0], "o item que a tela mostrou").toMatchObject({ product_id: c.p1.id, warehouse_id: c.l1.id });
    await expect(page, "depois do POST o web da base abre a consulta do documento salvo").toHaveURL(new RegExp(`/vendas/sales/${id}$`));
    expect((await vendaNoServidor(page, id)).items.map((i) => [i.product_id, i.warehouse_id]), "no servidor: o item gravado").toEqual([[c.p1.id, c.l1.id]]);

    // NO FIO: o web da base fala só com a pesquisa que o mundo dele conhece
    if (mundo === "legado") {
      expect(deHoje.some((u) => u.searchParams.get("search") === c.tag), "a pesquisa do web da base foi a `/api/resources/products/options`").toBe(true);
      expect(novas.map(String), "NENHUM pedido a /api/produtos/pesquisa* (nem a capacidade, nem a rota)").toEqual([]);
    } else {
      expect(novas.length, "a base já com a F3b pede a pesquisa nova").toBeGreaterThan(0);
      expect(deHoje.map(String), "e nenhuma à de hoje").toEqual([]);
    }
    v.semBloqueio();
    v.semErroDeContrato();
  } finally {
    await cancelarAbertas(page, vendas);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K-2b · O CONTRATO ANTIGO DA ROTA DE PESQUISA, NA API DESTE HEAD
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("OP01-F3b · K-2b (sentido 2) — a pesquisa de produto da API deste HEAD com os parâmetros de HOJE: 200, `itens` e `estoqueDoArmazem` primeiro e as três aditivas no fim, as seis chaves de cada item, e o mesmo significado (o produto sem saldo aparece; o saldo do local como antes)", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  await premissaDaApiF3b(page, cab);
  const c = await cenarioDaPesquisa(page, "K2b");
  const pesquisar = async (query: string) => {
    const r = await page.request.get(`${API}${PORTA_DA_PESQUISA}?${query}`, { headers: cab });
    expect(r.status(), `GET ${PORTA_DA_PESQUISA} só com os parâmetros de hoje (${query.replace(c.l1.id, "<L1>")}): 200`).toBe(200);
    const corpo = await r.json() as Record<string, unknown> & { itens: Record<string, unknown>[] };
    expect(Object.keys(corpo), "as duas chaves de hoje PRIMEIRO, as três aditivas no FIM").toEqual([...CHAVES_DA_RESPOSTA_DE_HOJE, ...CHAVES_ADITIVAS_DA_RESPOSTA]);
    expect(corpo.itens.length, "premissa: a resposta tem itens para conferir").toBeGreaterThan(0);
    for (const item of corpo.itens) expect(Object.keys(item), "cada item com as seis chaves de hoje, na ordem de hoje, nenhuma a mais").toEqual([...CHAVES_DO_ITEM_DA_PESQUISA]);
    return corpo;
  };
  const tag = encodeURIComponent(c.tag);

  // (1) COM o local: o saldo do local, como antes, e SEM filtro (o produto sem saldo aparece)
  const comLocal = await pesquisar(`busca=${tag}&armazem_id=${c.l1.id}&limite=50`);
  expect(comLocal.itens.map((i) => [i.id, i.descricao, i.estoque]), "os três, na ordem da descrição; P1 com 5, P2 SEM saldo aparece (0), P3 não controla (0)").toEqual([
    [c.p1.id, c.p1.nome, "5.0000"], [c.p2.id, c.p2.nome, "0.0000"], [c.p3.id, c.p3.nome, "0.0000"]
  ]);
  expect(comLocal.estoqueDoArmazem, "o local é visível: estoqueDoArmazem, como antes").toBe(true);
  expect([comLocal["pagina"], comLocal["temMais"], comLocal["filtradoPorSaldo"]], "as aditivas: página 1, sem mais, sem filtro").toEqual([1, false, false]);

  // (2) SEM o local: nada de saldo, como antes
  const semLocal = await pesquisar(`busca=${tag}&limite=50`);
  expect(semLocal.itens.map((i) => [i.id, i.estoque]), "sem local, os três sem saldo").toEqual([[c.p1.id, null], [c.p2.id, null], [c.p3.id, null]]);
  expect(semLocal.estoqueDoArmazem, "sem local, estoqueDoArmazem falso, como antes").toBe(false);

  // (3) o `limite` de hoje corta a lista, como antes (a página seguinte é aditiva: `temMais`)
  const doisPrimeiros = await pesquisar(`busca=${tag}&armazem_id=${c.l1.id}&limite=2`);
  expect(doisPrimeiros.itens.map((i) => i.id), "limite=2: os dois primeiros, na mesma ordem").toEqual([c.p1.id, c.p2.id]);
  expect([doisPrimeiros["pagina"], doisPrimeiros["temMais"]], "e a aditiva diz que há mais").toEqual([1, true]);
});
