import type { Locator, Page, Request, Response } from "@playwright/test";
import { getResource } from "@agro/domain";
import { login, api, uniq, empresaAtiva } from "./helpers";
import { cabecalhosDaSessao } from "./top-config-08-comum";
import { test as testeDaCentral, expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed, type Opcao } from "./central-compras-fixtures";
import { API, UUID_INEXISTENTE, vigiar, type Mundo } from "./operacoes-01-f2-skew-comum";
import { fonteDoWebContem, shaDaBase } from "./skew-fonte-da-base";
import { cnpjDeEmitenteSintetico, eanSintetico, notaSinteticaDeVariosItens } from "./compras-f7-nfe-sintetica";

/**
 * XML-01 (decisão 312) · K2, SENTIDO 2 — O WEB DA BASE CONTRA A API DESTE HEAD (a janela "API antes do web" da
 * DEPLOYMENT, e a reversão só do web).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 2 roda em `playwright.skew-web-anterior.config.ts`, cujo `testMatch` é
 * `/skew-web-anterior\.spec\.ts/` (sem âncora: casa com o fim deste nome); o `playwright.config.ts` comum ignora o mesmo
 * padrão — este arquivo NUNCA roda na suíte comum (lá o web seria o deste HEAD e o caso não mediria o cliente anterior).
 *
 * O QUE SE MEDE. A conferência da API deste HEAD é ADITIVA: ganha `capacidades: { criarProdutosDaNota: 1 }` (no fim) e,
 * no pré-preenchimento do item sem vínculo, `measurement_id` (só quando o uCom casa UMA unidade). O navegador roda o
 * bundle EXATO da base, que não conhece nada disso, e faz pela tela dela o que faz hoje:
 *   · a página da conferência RENDERIZA (nem "A importação de XML não está disponível", nem "a resposta não é a
 *     conferência que esta tela sabe ler");
 *   · o diálogo de UM item cria o produto como hoje (a pessoa escolhe Grupo, unidade e Natureza) e o item o recebe;
 *   · o "Gerar compra" gera a compra (201, ABERTA, com o total da nota).
 * PREMISSA, NO FIO: a conferência que a tela recebeu TINHA as chaves novas (é a API nova). O VIGIA: nenhuma resposta
 * 404/422/5xx da API nova ao cliente da base e nenhuma requisição morta. O mundo do WEB DA BASE é medido no fonte do
 * commit da base (`git grep` da marca do lote): com a base já no XML-01 (depois do merge), o botão do lote existe e o
 * diálogo de um item já traz a unidade — o ramo cobra isso.
 *
 * OS DADOS nascem pela API DESTE HEAD (as portas de `central-compras-fixtures`, com a exclusão lógica no fim do caso);
 * a compra e a importação ficam (ledger; decisão 247).
 */

const caminho = (r: Request | Response) => new URL(r.url()).pathname;
const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exato = (t: string, obrigatorio = false) => new RegExp(`^${escapar(t)}${obrigatorio ? "(\\s*\\*)?" : ""}$`);
const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));
const DEF_PRODUTO = getResource("products");
const rotuloDe = (campo: string) => DEF_PRODUTO?.fields.find((f) => f.name === campo)?.label ?? campo;
const MARCA_DO_LOTE = "data-testid=\"importacao-criar-produtos\"";

/** A fixture: o produto que a TELA criou, excluído (lógica) no fim do caso — verde ou não. */
const test = testeDaCentral.extend<{ produtosDaTela: Set<string> }>({
  produtosDaTela: async ({ page }, use) => {
    const ids = new Set<string>();
    await use(ids);
    if (ids.size === 0) return;
    const falhas: string[] = [];
    let cabecalhos: Record<string, string> | null = null;
    try { cabecalhos = await cabecalhosDaSessao(page); } catch (e) { falhas.push(`credencial da sessão: ${mensagem(e)}`); }
    for (const id of [...ids].reverse()) {
      if (!cabecalhos) { falhas.push(`products ${id}: não excluído (sem a credencial da sessão)`); continue; }
      try {
        const r = await page.request.fetch(`${API}/api/resources/products/${id}`, { method: "DELETE", headers: cabecalhos });
        if (!r.ok()) falhas.push(`products ${id}: ${r.status()} ${(await r.text()).slice(0, 200)}`);
      } catch (e) { falhas.push(`products ${id}: ${mensagem(e)}`); }
    }
    expect(falhas, "a limpeza excluiu o produto que a tela criou").toEqual([]);
  }
});

/** O web da base já tem o lote? Medido no fonte do commit da base (`git grep` da marca do botão); erro de leitura REPROVA. */
function mundoDoWebDaBase(): Mundo {
  const mundo: Mundo = fonteDoWebContem(shaDaBase(), MARCA_DO_LOTE) ? "novo" : "legado";
  console.log(`[skew] XML-01 · K2 · o web da base ${mundo === "novo" ? "CONHECE" : "NÃO conhece"} ${MARCA_DO_LOTE} → mundo ${mundo}`);
  return mundo;
}

/** Um seletor de referência (RefSelect) dentro de `container`: abre, pesquisa e escolhe a opção de rótulo EXATO. */
async function escolher(page: Page, container: Locator, rotuloDaOpcao: string, nome: string) {
  await container.locator("[role='combobox']").first().click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(rotuloDaOpcao);
  await painel.getByRole("option").filter({ has: page.locator("span.truncate", { hasText: exato(rotuloDaOpcao) }) }).first().click();
  await expect(container.locator("[role='combobox']").first(), `${nome}: o seletor ficou com a escolha`).not.toHaveClass(/is-empty/);
}

const campoDoFormulario = (raiz: Locator, rotulo: string) =>
  raiz.locator("label", { hasText: exato(rotulo, true) }).locator("..");

interface ConferenciaNoFio { capacidades?: unknown; itens: { nItem: number; vinculo: { situacao: string; preenchimento?: Record<string, unknown> } }[] }

/** A conferência traz as chaves NOVAS: a capacidade (própria, a ÚLTIMA chave) e a unidade do item sem vínculo. */
function chavesNovas(conf: ConferenciaNoFio, unidade: string, contexto: string) {
  expect(conf.capacidades, `${contexto}: a capacidade do lote declarada`).toEqual({ criarProdutosDaNota: 1 });
  expect(Object.keys(conf).at(-1), `${contexto}: \`capacidades\` é a ÚLTIMA chave (aditivo)`).toBe("capacidades");
  expect(conf.itens[0]?.vinculo.situacao, `${contexto}: o item 1 sem vínculo`).toBe("nenhum");
  expect(conf.itens[0]?.vinculo.preenchimento?.["measurement_id"], `${contexto}: o pré-preenchimento com a unidade do uCom`).toBe(unidade);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K2 · A CONFERÊNCIA DA BASE LÊ A CONFERÊNCIA NOVA, CRIA O PRODUTO PELO ITEM E GERA A COMPRA
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("XML-01 · K2 (sentido 2) — a conferência da base sobre a API deste HEAD: a conferência com as chaves novas (lidas no fio) renderiza, o diálogo de um item cria o produto como hoje e o Gerar compra gera a compra (201)", async ({ page, produtosDaTela }) => {
  test.setTimeout(180_000);
  const mundo = mundoDoWebDaBase();
  await login(page);
  const empresa = await empresaAtiva(page);
  const ref = await referenciasDoSeed(page);
  const kg = (await api<Opcao[]>(page, "GET", "/api/resources/measurement_units/options")).filter((u) => u.label.trim().toUpperCase() === "KG");
  expect(kg.map((u) => u.label), "premissa: o seed tem UMA unidade KG").toHaveLength(1);
  const rodada = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
  const emitente = cnpjDeEmitenteSintetico();
  const forn = await criarCadastro(page, "people", { name: uniq("XML01 K2 forn"), person_type: "legal", is_provider: true, document: emitente });
  const arm = await criarCadastro(page, "warehouses", { empresa_id: empresa, initials: `K${rodada.slice(-4)}`, description: uniq(`XML01 K2 local ${rodada}`), type: "inputs" });
  const local = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${arm.id}`))["description"]);
  const top = (await criarTop(page, { codigo: codigoTop("x1k"), codigoBase: "compras.compra", nome: uniq("Compra XML01 K2") })).id;
  const ean = eanSintetico();
  const item = { codigo: `K2-${rodada}-01`, descricao: `XMLK2 adubo ${rodada}`, unidade: "KG", ncm: "31052000", ean, quantidade: "100", valorUnitario: "2.50", valorProdutos: "250.00" };
  const nota = notaSinteticaDeVariosItens({ emitenteCnpj: emitente, emitenteNome: `Emitente sintético ${uniq("K2")}`, itens: [item] });
  const imp = await api<{ id: string }>(page, "POST", "/api/compras/importacoes", { nome_arquivo: `nfe-${nota.numero}.xml`, arquivo_base64: Buffer.from(nota.xml, "utf8").toString("base64"), empresa_id: empresa });

  // PREMISSA: a API julgada é a deste HEAD — a conferência com as chaves novas e a rota do lote (422 do corpo vazio).
  chavesNovas(await api<ConferenciaNoFio>(page, "GET", `/api/compras/importacoes/${imp.id}`), kg[0]!.id, "a API deste HEAD");
  const cab = await cabecalhosDaSessao(page);
  const sonda = await page.request.post(`${API}/api/compras/importacoes/${UUID_INEXISTENTE}/criar-produtos`, { headers: { ...cab, "content-type": "application/json" }, data: {} });
  expect(sonda.status(), "premissa: a API deste HEAD tem a rota do lote (o corpo vazio é recusado, não a rota)").toBe(422);

  const v = vigiar(page);
  const pedidosAoLote: string[] = [];
  page.on("request", (r) => { if (r.url().startsWith(API) && caminho(r).endsWith("/criar-produtos")) pedidosAoLote.push(`${r.method()} ${caminho(r)}`); });
  const leitura = page.waitForResponse((x) => x.request().method() === "GET" && caminho(x) === `/api/compras/importacoes/${imp.id}`);
  await page.goto(`/compras/importacoes/${imp.id}`);
  const lida = await leitura;
  expect(lida.status()).toBe(200);
  chavesNovas((await lida.json()) as ConferenciaNoFio, kg[0]!.id, "no fio, a conferência que o web da base recebeu");

  // A PÁGINA RENDERIZA: nem "indisponível", nem "não sei ler".
  const raiz = page.getByTestId("importacao-conferencia");
  await expect(raiz, "a conferência da base desenhou, pendente").toHaveAttribute("data-situacao", "pendente");
  await expect(page.getByText("A importação de XML não está disponível"), "não é a tela de indisponível").toHaveCount(0);
  await expect(page.getByText("A resposta do servidor não é a conferência que esta tela sabe ler."), "a base leu a conferência nova").toHaveCount(0);
  await page.getByTestId("importacao-top").selectOption(top);
  await page.getByTestId("importacao-aba-itens-rotulo").click();
  await expect(page.getByTestId("importacao-item-1"), "o item 1, sem vínculo").toHaveAttribute("data-vinculo", "nenhum");
  if (mundo === "legado") await expect(page.getByTestId("importacao-criar-produtos"), "o web da base não conhece o lote").toHaveCount(0);
  else await expect(page.getByTestId("importacao-criar-produtos"), "o web da base (já no XML-01) mostra o lote").toHaveAttribute("data-quantidade", "1");
  await escolher(page, page.getByTestId("importacao-item-1-local"), local, "Local do item 1");

  // O DIÁLOGO DE UM ITEM, como hoje.
  await page.getByTestId("importacao-item-1-criar-produto").click();
  const dialogo = page.getByTestId("importacao-cadastro-products");
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByTestId("b1-form"), "o formulário carregou").toBeVisible();
  await expect(dialogo.locator("input[name='description']"), "o preset da base: a descrição").toHaveValue(item.descricao);
  await expect(dialogo.getByTestId("ref-ncm-codigo").first(), "a NCM").toHaveValue(/^3105\.?20\.?00$/);
  await expect(dialogo.locator("input[name='barcode']"), "o código de barras").toHaveValue(ean);
  const campoUnidade = campoDoFormulario(dialogo, rotuloDe("measurement_id"));
  const unidadeNoForm = campoUnidade.locator("[role='combobox']").first();
  if (mundo === "legado") {
    await expect(unidadeNoForm, "o web da base ignora o measurement_id novo: a unidade vem vazia, como hoje").toHaveClass(/is-empty/);
    await escolher(page, campoUnidade, kg[0]!.label, "Unidade do produto");
  } else {
    await expect(unidadeNoForm, "o web da base (já no XML-01) traz a unidade").not.toHaveClass(/is-empty/);
  }
  await escolher(page, campoDoFormulario(dialogo, rotuloDe("group_id")), ref.grupo.label, "Grupo do produto");
  await dialogo.getByRole("tab", { name: "Custos e venda" }).click();
  await escolher(page, campoDoFormulario(dialogo, rotuloDe("financial_category_id")), ref.natureza.label, "Natureza de custo do produto");
  const post = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === "/api/resources/products");
  await dialogo.getByRole("button", { name: "Salvar", exact: true }).click();
  const resposta = await post;
  expect(resposta.status(), `a API nova cria o produto do web da base: ${resposta.status()}`).toBe(201);
  const row = (await resposta.json()) as { id: string; description: string };
  produtosDaTela.add(row.id);
  expect(resposta.request().postDataJSON(), "o produto com a nota e a unidade").toMatchObject({ description: item.descricao, ncm_code: item.ncm, barcode: ean, measurement_id: kg[0]!.id });
  await expect(dialogo, "o diálogo fecha").toBeHidden();
  await expect(page.getByTestId("importacao-item-1-produto").locator("[role='combobox']").first(), "o item recebe o produto").toContainText(row.description);

  // O "GERAR COMPRA" da base: natureza e centro do documento, e a compra ABERTA.
  await page.getByTestId("importacao-aba-financeiro-rotulo").click();
  await escolher(page, page.getByTestId("importacao-natureza"), ref.natureza.label, "Natureza de despesa da compra");
  await escolher(page, page.getByTestId("importacao-centro"), ref.centro.label, "Centro de resultado da compra");
  const gerar = page.getByTestId("importacao-gerar-compra");
  await expect(gerar).toBeEnabled();
  const postGerar = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/compras/importacoes/${imp.id}/gerar-compra`);
  await gerar.click();
  const rg = await postGerar;
  expect(rg.status(), `a API nova gera a compra do web da base: ${rg.status()}`).toBe(201);
  const enviado = rg.request().postDataJSON() as { fornecedor_id: string; itens: { n_item: number; produto_id: string }[] };
  expect([enviado.fornecedor_id, enviado.itens.map((i) => [i.n_item, i.produto_id])], "o corpo da base: o fornecedor e o produto criado").toEqual([forn.id, [[1, row.id]]]);
  const compra = (await rg.json()) as { id: string; situacao: string; valor_total: string; importacao_id: string };
  expect(compra, "a compra nasce ABERTA, com o total da nota").toMatchObject({ situacao: "aberto", valor_total: nota.vNF, importacao_id: imp.id });
  await expect(page, "a base abre a consulta da compra").toHaveURL(new RegExp(`/compras/compras/${compra.id}$`));

  if (mundo === "legado") expect(pedidosAoLote, "o web da base nunca chama /criar-produtos").toEqual([]);
  v.semBloqueio();
  v.semErroDeContrato();
});
